// app/qbo-review.tsx — the QBO cost confirm queue (F6, Friday Close campaign).
//
// Staged Purchase/Bill lines pulled by qbo-reconciler land here for explicit
// per-line review. G11: NOTHING reaches job costs or the cost book without a
// confirmation on this screen — there is no silent bulk path. "Confirm all"
// exists only for MAPPED, non-duplicate lines and always names its count.
//
// Confirm → materialize as MaterialReceipt{origin:'qbo'} with a deterministic
// id (utils/qbo/qboCostMap) + mark the staged row confirmed via the offline
// queue. The receipt flows to job-cost actuals and the cost book downstream
// with zero engine edits (D2). Reject → row marked rejected, never resurfaces.
//
// On mount: idempotent re-materialization sweep — confirmed rows whose
// deterministic receipt id is missing locally (post-cache-wipe / new device)
// are re-added. The staging table is the durable truth.
//
// Business+ (matches the server's requireTier on the QBO functions).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, CheckCircle2, X, AlertTriangle, FolderOpen, Inbox,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useProjects } from '@/contexts/ProjectContext';
import { useQboCostLines } from '@/hooks/useQboCostLines';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import {
  stagedLineToReceipt, findLikelyDuplicate, qboReceiptId, type QboCostLineRow,
} from '@/utils/qbo/qboCostMap';
import { supabaseWrite } from '@/utils/offlineQueue';
import { recordDidForYou } from '@/utils/brain/didForYou';
import { formatMoney } from '@/utils/formatters';

// ─── Business gate ────────────────────────────────────────────────────────────

export default function QboReviewScreen() {
  const router = useRouter();
  const { isBusinessOrAbove } = useTierAccess();
  if (!isBusinessOrAbove) {
    return (
      <Paywall
        visible={true}
        feature="QuickBooks Cost Review"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <QboReviewInner />;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDay(raw: string | null | undefined): string {
  if (!raw) return 'No date';
  const t = Date.parse(raw.length === 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(t)) return raw;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Inner screen ─────────────────────────────────────────────────────────────

function QboReviewInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects } = useProjects();
  const { stagedLines, confirmedLines, isLoading, patchLine } = useQboCostLines();
  const { receipts, isLoading: receiptsLoading, addReceipts } = useMaterialReceipts();

  // Confirm-time project assignments for unmapped lines (line id → project id).
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [pickerFor, setPickerFor] = useState<QboCostLineRow | null>(null);

  const projectName = useCallback(
    (id: string | null | undefined) => projects.find(p => p.id === id)?.name ?? null,
    [projects],
  );
  const effectiveProject = useCallback(
    (row: QboCostLineRow): string | null => assignments[row.id] ?? row.project_id,
    [assignments],
  );

  // ── Idempotent re-materialization sweep (once per mount, when both stores
  //    are loaded): confirmed rows whose deterministic receipt id is missing
  //    locally get re-added — post-wipe / new-device recovery.
  const sweptRef = useRef(false);
  useEffect(() => {
    if (sweptRef.current || isLoading || receiptsLoading) return;
    sweptRef.current = true;
    try {
      const haveIds = new Set(receipts.map(r => r.id));
      const missing: ReturnType<typeof stagedLineToReceipt>[] = [];
      for (const row of confirmedLines) {
        if (haveIds.has(qboReceiptId(row))) continue;
        missing.push(stagedLineToReceipt(row));
      }
      // Single atomic add — looping addReceipt would race itself.
      addReceipts(missing.filter((r): r is NonNullable<typeof r> => r != null));
    } catch {
      // Recovery sweep is best-effort — the staging table remains the truth.
    }
  }, [isLoading, receiptsLoading, confirmedLines, receipts, addReceipts]);

  // ── Duplicate detection against SCANNED receipts (D2 guard). ──
  // stagedLines is passed so the heuristic can compare the scan's total
  // against the WHOLE QBO transaction (sum of sibling lines), not just this
  // one categorized line — the QBO norm is multi-line splits.
  const duplicateOf = useCallback(
    (row: QboCostLineRow) => findLikelyDuplicate(receipts, row, stagedLines),
    [receipts, stagedLines],
  );

  // ── Confirm / reject ──
  // Marks the row confirmed (durable via the offline queue, G3) and returns
  // the materialized receipt. Receipt ADDITION is the caller's job: single
  // confirms add directly; the bulk path collects and adds atomically via
  // addReceipts (looped addReceipt calls race each other).
  const confirmLine = useCallback((row: QboCostLineRow) => {
    const projectId = effectiveProject(row);
    if (!projectId) return null;
    const receipt = stagedLineToReceipt(row, { projectId });
    if (!receipt) return null;
    void supabaseWrite('qbo_cost_lines', 'update', {
      id: row.id, status: 'confirmed', project_id: projectId,
    });
    patchLine(row.id, { status: 'confirmed', project_id: projectId });
    return receipt;
  }, [effectiveProject, patchLine]);

  const onConfirm = useCallback((row: QboCostLineRow) => {
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const receipt = confirmLine(row);
    if (!receipt) return;
    // Atomic path even for a single receipt: rapid sequential confirms via
    // addReceipt race each other (each mutate snapshots the cache before the
    // previous persist lands, clobbering the earlier receipt while its
    // staging row already reads 'confirmed'). addReceipts reads current()
    // and dedupes existing ids internally, replacing the stale
    // receipts.some(...) closure check too.
    addReceipts([receipt]);
    const name = projectName(receipt.projectId);
    recordDidForYou(
      `Filed ${formatMoney(row.amount)} QBO cost${name ? ` to ${name}` : ''}`,
      receipt.projectId,
    );
  }, [confirmLine, addReceipts, projectName]);

  const onReject = useCallback((row: QboCostLineRow) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    void supabaseWrite('qbo_cost_lines', 'update', { id: row.id, status: 'rejected' });
    patchLine(row.id, { status: 'rejected' });
  }, [patchLine]);

  // ── "Confirm all" — MAPPED, non-duplicate lines only, count in the label
  //    (G11: never a silent bulk path; flagged duplicates stay per-line). ──
  const bulkEligible = useMemo(
    () => stagedLines.filter(row => effectiveProject(row) != null && !duplicateOf(row)),
    [stagedLines, effectiveProject, duplicateOf],
  );

  const onConfirmAllMapped = useCallback(() => {
    if (bulkEligible.length === 0) return;
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    let total = 0;
    const projectIds = new Set<string>();
    const toAdd: NonNullable<ReturnType<typeof confirmLine>>[] = [];
    for (const row of bulkEligible) {
      const receipt = confirmLine(row);
      if (!receipt) continue;
      toAdd.push(receipt);
      total += row.amount;
      projectIds.add(receipt.projectId);
    }
    // One atomic add for the whole batch (dedupes existing ids internally).
    addReceipts(toAdd);
    if (toAdd.length > 0) {
      const onlyId = projectIds.size === 1 ? [...projectIds][0] : undefined;
      const where = onlyId
        ? ` to ${projectName(onlyId) ?? 'your job'}`
        : ` across ${projectIds.size} jobs`;
      recordDidForYou(
        `Filed ${toAdd.length} QBO cost${toAdd.length === 1 ? '' : 's'}${where} — ${formatMoney(total)}`,
        onlyId,
      );
    }
  }, [bulkEligible, confirmLine, addReceipts, projectName]);

  // ── Grouping: vendor + txn_date sections, newest first. ──
  const groups = useMemo(() => {
    const m = new Map<string, { vendor: string; day: string | null; doc: string | null; rows: QboCostLineRow[] }>();
    for (const row of stagedLines) {
      const vendor = (row.vendor ?? '').trim() || 'QuickBooks';
      const key = `${vendor}|${row.txn_date ?? ''}|${row.doc_number ?? ''}`;
      const g = m.get(key);
      if (g) g.rows.push(row);
      else m.set(key, { vendor, day: row.txn_date, doc: row.doc_number, rows: [row] });
    }
    return Array.from(m.values()).sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''));
  }, [stagedLines]);

  const pickerProjects = useMemo(() => {
    const rank = (s: string) => (s === 'in_progress' ? 0 : s === 'planning' ? 1 : 2);
    return [...projects].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
  }, [projects]);

  const assignProject = useCallback((row: QboCostLineRow, projectId: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setAssignments(prev => ({ ...prev, [row.id]: projectId }));
    setPickerFor(null);
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>QuickBooks · costs</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {stagedLines.length > 0
              ? `${stagedLines.length} cost${stagedLines.length === 1 ? '' : 's'} to review`
              : 'Cost review'}
          </Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 96 }} showsVerticalScrollIndicator={false}>
        {stagedLines.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Inbox size={32} color={t.textMuted} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>
              {isLoading ? 'Checking QuickBooks…' : 'No QBO costs waiting'}
            </Text>
            <Text style={styles.emptyBody}>
              Purchases and bills you enter in QuickBooks land here about every 30 minutes. Confirm each one to file it into job costs and your price book — nothing is filed without you.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.introNote}>
              Pulled from QuickBooks. Confirm to file into job costs and your cost book; reject anything that isn&apos;t a job cost. Rejected lines never come back.
            </Text>

            {groups.map(group => (
              <View key={`${group.vendor}|${group.day ?? ''}|${group.doc ?? ''}`} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{group.vendor}</Text>
                    <Text style={styles.cardSub}>
                      {fmtDay(group.day)}{group.doc ? ` · ${group.doc}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.cardTotal}>
                    {formatMoney(group.rows.reduce((a, r) => a + r.amount, 0))}
                  </Text>
                </View>

                {group.rows.map(row => {
                  const projId = effectiveProject(row);
                  const projName = projectName(projId);
                  const dup = duplicateOf(row);
                  return (
                    <View key={row.id} style={styles.lineRow}>
                      <View style={styles.lineTop}>
                        <Text style={styles.lineDesc} numberOfLines={2}>
                          {(row.description ?? '').trim() || (row.account_name ?? '').trim() || 'QuickBooks cost'}
                        </Text>
                        <Text style={styles.lineAmount}>{formatMoney(row.amount)}</Text>
                      </View>
                      {row.account_name ? (
                        <Text style={styles.lineMeta}>{row.account_name}</Text>
                      ) : null}

                      {/* Project chip: mapped shows the job; unmapped demands assignment. */}
                      <TouchableOpacity
                        style={[styles.projectChip, !projId && styles.projectChipUnmapped]}
                        onPress={() => setPickerFor(row)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityLabel={projName ? `Change project, currently ${projName}` : 'Assign a project'}
                      >
                        <FolderOpen size={12} color={projId ? t.accent : '#7A4500'} strokeWidth={2} />
                        <Text style={[styles.projectChipText, !projId && styles.projectChipTextUnmapped]}>
                          {projName ?? 'Assign project'}
                        </Text>
                      </TouchableOpacity>

                      {/* Scanned-receipt double-count warning (D2). */}
                      {dup && (
                        <View style={styles.dupChip}>
                          <AlertTriangle size={12} color="#7A4500" strokeWidth={2} />
                          <Text style={styles.dupChipText}>
                            Looks like the receipt you scanned {dup.receiptDate ? fmtDay(dup.receiptDate) : 'recently'} ({formatMoney(dup.total)}). Confirming counts this cost twice — reject it here if it&apos;s the same purchase.
                          </Text>
                        </View>
                      )}

                      <View style={styles.lineActions}>
                        <TouchableOpacity
                          style={styles.rejectBtn}
                          onPress={() => onReject(row)}
                          activeOpacity={0.8}
                          accessibilityRole="button"
                          accessibilityLabel="Reject — not a job cost"
                          testID={`qbo-reject-${row.id}`}
                        >
                          <X size={14} color={t.textSecondary} strokeWidth={2} />
                          <Text style={styles.rejectText}>Reject</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.confirmBtn, !projId && styles.confirmBtnDisabled]}
                          onPress={() => onConfirm(row)}
                          disabled={!projId}
                          activeOpacity={0.85}
                          accessibilityRole="button"
                          accessibilityLabel={projId ? `Confirm and file to ${projName}` : 'Assign a project before confirming'}
                          testID={`qbo-confirm-${row.id}`}
                        >
                          <CheckCircle2 size={14} color="#FFFFFF" strokeWidth={2} />
                          <Text style={styles.confirmText}>{projId ? 'Confirm' : 'Needs project'}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Explicit, counted bulk confirm — mapped + non-duplicate only (G11). */}
      {bulkEligible.length > 1 && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={styles.bulkBtn}
            onPress={onConfirmAllMapped}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Confirm ${bulkEligible.length} mapped costs`}
            testID="qbo-confirm-all-mapped"
          >
            <CheckCircle2 size={16} color="#FFFFFF" strokeWidth={2} />
            <Text style={styles.bulkBtnText}>
              Confirm {bulkEligible.length} mapped — {formatMoney(bulkEligible.reduce((a, r) => a + r.amount, 0))}
            </Text>
          </TouchableOpacity>
          <Text style={styles.bulkNote}>
            Unassigned and possible-duplicate lines stay for one-by-one review.
          </Text>
        </View>
      )}

      {/* Project picker */}
      <Modal visible={pickerFor != null} transparent animationType="fade" onRequestClose={() => setPickerFor(null)}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHead}>
              <Text style={styles.pickerTitle}>File this cost to…</Text>
              <TouchableOpacity onPress={() => setPickerFor(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close picker">
                <X size={18} color={t.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 380 }}>
              {pickerProjects.length === 0 ? (
                <Text style={styles.pickerEmpty}>No projects yet — create one first.</Text>
              ) : (
                pickerProjects.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.pickerRow}
                    onPress={() => pickerFor && assignProject(pickerFor, p.id)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                  >
                    <FolderOpen size={15} color={t.accent} strokeWidth={1.75} />
                    <Text style={styles.pickerRowText} numberOfLines={1}>{p.name}</Text>
                    {p.status === 'in_progress' && <Text style={styles.pickerRowBadge}>active</Text>}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  introNote: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginBottom: 14, paddingHorizontal: 2 },

  emptyWrap: { alignItems: 'center' as const, paddingTop: 72, paddingHorizontal: 24, gap: 10 },
  emptyTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center' as const, lineHeight: 19 },

  card: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 12,
  },
  cardHead: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  cardSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 1 },
  cardTotal: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },

  lineRow: { paddingTop: 12, gap: 6 },
  lineTop: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  lineDesc: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text, lineHeight: 18 },
  lineAmount: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  lineMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  projectChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: Tokens.radius.full,
    backgroundColor: t.accentSoft,
  },
  projectChipUnmapped: { backgroundColor: '#FFF4E0' },
  projectChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent },
  projectChipTextUnmapped: { color: '#7A4500' },

  dupChip: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 6,
    backgroundColor: '#FFF4E0', borderRadius: Tokens.radius.md,
    paddingHorizontal: 10, paddingVertical: 7,
  },
  dupChipText: { flex: 1, fontSize: Type.caption1.fontSize, color: '#7A4500', fontWeight: '600' as const, lineHeight: 16 },

  lineActions: { flexDirection: 'row' as const, gap: 8, marginTop: 2 },
  rejectBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 5,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surfaceAlt,
  },
  rejectText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  confirmBtn: {
    flex: 1,
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    paddingVertical: 9, borderRadius: Tokens.radius.md, backgroundColor: t.accent,
  },
  confirmBtnDisabled: { opacity: 0.45 },
  confirmText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },

  footer: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 10, backgroundColor: t.bg,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  bulkBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 13,
  },
  bulkBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  bulkNote: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center' as const, marginTop: 6 },

  pickerBackdrop: {
    flex: 1, backgroundColor: 'rgba(15,17,21,0.45)',
    alignItems: 'center' as const, justifyContent: 'center' as const, padding: 24,
  },
  pickerSheet: {
    width: '100%', maxWidth: 420, backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line,
    padding: 16,
  },
  pickerHead: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const,
    marginBottom: 8,
  },
  pickerTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  pickerEmpty: { fontSize: Type.footnote.fontSize, color: t.textMuted, paddingVertical: 16, textAlign: 'center' as const },
  pickerRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  pickerRowText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  pickerRowBadge: {
    fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.success,
    textTransform: 'uppercase' as const, letterSpacing: 0.4,
  },
});
