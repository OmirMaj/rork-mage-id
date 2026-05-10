// draw-periods.tsx — lender-facing Draw Period dashboard.
//
// Pre-fix: a GC running a loan-funded residential job tracked the
// AIA G702/G703 pay app, sub invoices, and lien waivers as siblings
// with no shared "this is for THIS draw" grouping. PM audit's #4
// missing primitive — every loan-funded job runs this monthly
// ritual. The data model and migration shipped earlier
// (create_draw_periods_and_sub_change_requests.sql); this screen
// closes the loop.
//
// What you see:
//   - Cross-project list of draw periods, status pivot front-and-
//     center (open / submitted / approved / funded / closed).
//   - Each card shows: project, draw # + label, period range, $
//     requested → approved → funded, lien-waiver progress
//     (count vs. number of subs in scope), and an AIA pay-app
//     link when one is attached.
//   - Inline status transition buttons drive the next-action loop:
//     open → submitted → approved → funded → closed. Each
//     transition stamps the corresponding timestamp.
//   - "+ New draw" → minimal compose modal: project, label,
//     start/end dates. Auto-numbers as max(existing for project) + 1.
//
// We deliberately keep amount + invoice/waiver linking on the
// detail / AIA pay-app screen rather than this dashboard — the
// dashboard is for the GC's "where are all my draws" rollup;
// detail editing happens elsewhere so this screen stays scannable.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Plus, FileText, ChevronRight, X, Check, ChevronDown, DollarSign,
  Banknote, FileCheck2, Calendar, AlertCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useDrawPeriods } from '@/hooks/useDrawPeriods';
import EmptyState from '@/components/EmptyState';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { DrawPeriod, DrawPeriodStatus } from '@/types';

type FilterKey = 'active' | 'awaiting_funding' | 'closed' | 'all';

const STATUS_LABEL: Record<DrawPeriodStatus, string> = {
  open: 'Open',
  submitted: 'Submitted',
  approved: 'Approved',
  funded: 'Funded',
  closed: 'Closed',
};

function statusTint(status: DrawPeriodStatus): string {
  switch (status) {
    case 'open': return Colors.info;
    case 'submitted': return Colors.warning;
    case 'approved': return Colors.primary;
    case 'funded': return Colors.success;
    case 'closed': return Colors.textMuted;
  }
}

function nextStatusLabel(status: DrawPeriodStatus): string | null {
  switch (status) {
    case 'open': return 'Mark submitted';
    case 'submitted': return 'Mark approved';
    case 'approved': return 'Mark funded';
    case 'funded': return 'Close draw';
    case 'closed': return null;
  }
}

function nextStatus(status: DrawPeriodStatus): DrawPeriodStatus | null {
  switch (status) {
    case 'open': return 'submitted';
    case 'submitted': return 'approved';
    case 'approved': return 'funded';
    case 'funded': return 'closed';
    case 'closed': return null;
  }
}

function formatDateRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function DrawPeriodsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, aiaPayApps, invoices } = useProjects();
  const { draws, addDraw, updateDraw, loading } = useDrawPeriods();
  const [filter, setFilter] = useState<FilterKey>('active');
  const [composerOpen, setComposerOpen] = useState(false);

  const projectName = useMemo(
    () => new Map(projects.map(p => [p.id, p.name])),
    [projects],
  );

  const filtered = useMemo(() => {
    if (filter === 'active') return draws.filter(d => d.status === 'open' || d.status === 'submitted');
    if (filter === 'awaiting_funding') return draws.filter(d => d.status === 'approved');
    if (filter === 'closed') return draws.filter(d => d.status === 'closed' || d.status === 'funded');
    return draws;
  }, [draws, filter]);

  // Total funded YTD across all draws — useful as a sanity check
  // on the dashboard. The GC sees "$245k drawn this year" at a
  // glance instead of compiling it monthly for a banker call.
  const fundedYTD = useMemo(() => {
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime();
    return draws
      .filter(d => d.fundedAt && Date.parse(d.fundedAt) >= yearStart)
      .reduce((s, d) => s + (d.amountFunded ?? 0), 0);
  }, [draws]);

  const counts = useMemo(() => ({
    active: draws.filter(d => d.status === 'open' || d.status === 'submitted').length,
    awaiting: draws.filter(d => d.status === 'approved').length,
    closed: draws.filter(d => d.status === 'closed' || d.status === 'funded').length,
    all: draws.length,
  }), [draws]);

  const advanceStatus = useCallback((draw: DrawPeriod) => {
    const next = nextStatus(draw.status);
    if (!next) return;
    const now = new Date().toISOString();
    const patch: Partial<DrawPeriod> = { status: next };
    if (next === 'submitted') patch.submittedAt = now;
    if (next === 'approved') patch.approvedAt = now;
    if (next === 'funded') patch.fundedAt = now;
    if (next === 'closed') patch.closedAt = now;

    Alert.alert(
      `${nextStatusLabel(draw.status)}?`,
      `Move "${draw.label}" to ${STATUS_LABEL[next]}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            updateDraw(draw.id, patch);
            if (Platform.OS !== 'web') {
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            }
          },
        },
      ],
    );
  }, [updateDraw]);

  const openAIA = useCallback((draw: DrawPeriod) => {
    if (!draw.aiaPayAppId) {
      Alert.alert(
        'No AIA pay app linked',
        'Open the AIA pay app screen and create one for this period, then link it back to this draw.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open AIA pay app',
            onPress: () => router.push({
              pathname: '/aia-pay-app' as never,
              params: { projectId: draw.projectId } as never,
            }),
          },
        ],
      );
      return;
    }
    router.push({
      pathname: '/aia-pay-app' as never,
      params: { id: draw.aiaPayAppId } as never,
    });
  }, [router]);

  const lienWaiverProgress = useCallback((draw: DrawPeriod): { collected: number; expected: number } => {
    // Lien-waiver convention for residential draw lending: one
    // conditional waiver per invoice the GC included in the draw.
    // Some lenders require a second (final / unconditional) waiver
    // upon funding — that's tracked downstream on each waiver row.
    // For dashboard rollup we use 1 waiver per linked invoice as
    // the expected count. `invoices` is read from context so the
    // count refreshes when invoices are added/removed elsewhere.
    void invoices;
    const expected = draw.invoiceIds.length;
    return { collected: draw.lienWaiverIds.length, expected };
  }, [invoices]);

  if (!loading && draws.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{
            title: 'Draw Periods',
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
          }}
        />
        <EmptyState
          icon={<Banknote size={36} color={Colors.primary} strokeWidth={1.6} />}
          title="No draw periods yet"
          message="Tap + below to start your first draw. We'll group invoices, lien waivers, and the AIA pay app under each period so you have a single rollup the lender wants to see."
        />
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 16 }]}
          activeOpacity={0.85}
          onPress={() => setComposerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="New draw"
        >
          <Plus size={20} color={Colors.background} />
          <Text style={styles.fabText}>New draw</Text>
        </TouchableOpacity>

        <DrawComposerModal
          visible={composerOpen}
          projects={projects}
          existingDraws={draws}
          onClose={() => setComposerOpen(false)}
          onSave={(input) => {
            addDraw(input);
            setComposerOpen(false);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Draw Periods',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 88 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Draws</Text>
          <Text style={styles.headerCount}>{draws.length}</Text>
        </View>
        <Text style={styles.headerSub}>
          {fundedYTD > 0 ? `${formatMoney(fundedYTD)} funded YTD · ` : ''}
          {counts.active > 0 ? `${counts.active} active` : 'No active draws'}
          {counts.awaiting > 0 ? ` · ${counts.awaiting} awaiting funding` : ''}
        </Text>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {([
            { key: 'active' as const, label: `Active (${counts.active})` },
            { key: 'awaiting_funding' as const, label: `Awaiting funding (${counts.awaiting})` },
            { key: 'closed' as const, label: `Funded / Closed (${counts.closed})` },
            { key: 'all' as const, label: `All (${counts.all})` },
          ]).map(c => {
            const active = filter === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => {
                  setFilter(c.key);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
                }}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.85}
                testID={`draw-filter-${c.key}`}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Cards */}
        {filtered.length === 0 ? (
          <View style={styles.subEmpty}>
            <Text style={styles.subEmptyText}>Nothing in this filter.</Text>
          </View>
        ) : (
          filtered.map(d => {
            const tint = statusTint(d.status);
            const lien = lienWaiverProgress(d);
            const lienComplete = lien.expected > 0 && lien.collected >= lien.expected;
            const aiaApp = aiaPayApps.find(a => a.id === d.aiaPayAppId);
            return (
              <View key={d.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardProject} numberOfLines={1}>
                      {projectName.get(d.projectId) ?? 'Unknown project'}
                    </Text>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {d.label}
                    </Text>
                    <Text style={styles.cardSub} numberOfLines={1}>
                      <Calendar size={11} color={Colors.textMuted} />{' '}
                      {formatDateRange(d.periodStart, d.periodEnd)}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: tint + '15', borderColor: tint }]}>
                    <Text style={[styles.statusPillText, { color: tint }]}>
                      {STATUS_LABEL[d.status]}
                    </Text>
                  </View>
                </View>

                {/* Money flow row */}
                <View style={styles.moneyRow}>
                  <MoneyCell
                    label="Requested"
                    value={d.amountRequested}
                    tint={Colors.info}
                  />
                  <View style={styles.moneyDivider} />
                  <MoneyCell
                    label="Approved"
                    value={d.amountApproved}
                    tint={Colors.primary}
                  />
                  <View style={styles.moneyDivider} />
                  <MoneyCell
                    label="Funded"
                    value={d.amountFunded}
                    tint={Colors.success}
                  />
                </View>

                {/* Lien waiver + AIA mini-row */}
                <View style={styles.miniRow}>
                  <View style={styles.miniCell}>
                    <FileCheck2
                      size={12}
                      color={lienComplete ? Colors.success : (lien.expected > 0 ? Colors.warning : Colors.textMuted)}
                    />
                    <Text style={[styles.miniText, lienComplete && { color: Colors.success }]}>
                      {lien.expected > 0
                        ? `${lien.collected} of ${lien.expected} lien waiver${lien.expected === 1 ? '' : 's'}`
                        : 'No invoices linked yet'}
                    </Text>
                  </View>
                  <View style={styles.miniCell}>
                    <FileText size={12} color={aiaApp ? Colors.primary : Colors.textMuted} />
                    <Text style={[styles.miniText, aiaApp && { color: Colors.primary }]}>
                      {aiaApp ? `AIA pay app #${aiaApp.applicationNumber}` : 'No AIA pay app'}
                    </Text>
                  </View>
                </View>

                {/* Actions */}
                <View style={styles.cardActions}>
                  {nextStatusLabel(d.status) && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionPrimary]}
                      onPress={() => advanceStatus(d)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={nextStatusLabel(d.status) ?? ''}
                      testID={`advance-${d.id}`}
                    >
                      <Check size={14} color={Colors.background} />
                      <Text style={[styles.actionBtnText, { color: Colors.background }]}>
                        {nextStatusLabel(d.status)}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionSecondary]}
                    onPress={() => openAIA(d)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Open AIA pay app"
                  >
                    <FileText size={14} color={Colors.text} />
                    <Text style={[styles.actionBtnText, { color: Colors.text }]}>AIA pay app</Text>
                    <ChevronRight size={14} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>

                {!lienComplete && lien.expected > 0 && (
                  <View style={styles.warningBar}>
                    <AlertCircle size={11} color={Colors.warning} />
                    <Text style={styles.warningText}>
                      {lien.expected - lien.collected} lien waiver
                      {lien.expected - lien.collected === 1 ? '' : 's'} still needed for funding.
                    </Text>
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Floating add button */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 16 }]}
        activeOpacity={0.85}
        onPress={() => setComposerOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="New draw"
        testID="draw-add"
      >
        <Plus size={20} color={Colors.background} />
        <Text style={styles.fabText}>New draw</Text>
      </TouchableOpacity>

      <DrawComposerModal
        visible={composerOpen}
        projects={projects}
        existingDraws={draws}
        onClose={() => setComposerOpen(false)}
        onSave={(input) => {
          addDraw(input);
          setComposerOpen(false);
          if (Platform.OS !== 'web') {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
        }}
      />
    </View>
  );
}

function MoneyCell({ label, value, tint }: { label: string; value?: number; tint: string }) {
  const display = value != null && value > 0 ? formatMoney(value) : '—';
  const muted = value == null || value === 0;
  return (
    <View style={{ flex: 1, alignItems: 'center' as const }}>
      <View style={styles.moneyIconWrap}>
        <DollarSign size={11} color={muted ? Colors.textMuted : tint} />
        <Text style={styles.moneyLabel}>{label}</Text>
      </View>
      <Text style={[styles.moneyValue, { color: muted ? Colors.textMuted : tint }]} numberOfLines={1}>
        {display}
      </Text>
    </View>
  );
}

// ─── Composer modal ─────────────────────────────────────────────
function DrawComposerModal({
  visible, projects, existingDraws, onClose, onSave,
}: {
  visible: boolean;
  projects: ReturnType<typeof useProjects>['projects'];
  existingDraws: DrawPeriod[];
  onClose: () => void;
  onSave: (input: Omit<DrawPeriod, 'id' | 'createdAt' | 'updatedAt'>) => void;
}) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const reset = useCallback(() => {
    setProjectId(null);
    setLabel('');
    setPeriodStart('');
    setPeriodEnd('');
  }, []);

  // Auto-suggest a label like "Draw 4 — June 2026" based on the
  // next number for this project + the start date's month.
  const suggestedLabel = useMemo(() => {
    if (!projectId) return '';
    const projDraws = existingDraws.filter(d => d.projectId === projectId);
    const next = (projDraws.reduce((m, d) => Math.max(m, d.number), 0)) + 1;
    const monthLabel = periodStart
      ? new Date(periodStart).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : '';
    return monthLabel ? `Draw ${next} — ${monthLabel}` : `Draw ${next}`;
  }, [projectId, existingDraws, periodStart]);

  const handleSave = useCallback(() => {
    if (!projectId) {
      Alert.alert('Pick a project', 'Choose which project this draw is for.');
      return;
    }
    if (!periodStart || !periodEnd) {
      Alert.alert('Period required', 'Set the start and end dates for this draw period.');
      return;
    }
    const projDraws = existingDraws.filter(d => d.projectId === projectId);
    const number = (projDraws.reduce((m, d) => Math.max(m, d.number), 0)) + 1;
    onSave({
      projectId,
      number,
      label: label.trim() || suggestedLabel,
      periodStart,
      periodEnd,
      status: 'open',
      invoiceIds: [],
      lienWaiverIds: [],
    });
    reset();
  }, [projectId, periodStart, periodEnd, label, suggestedLabel, existingDraws, onSave, reset]);

  const selectedProject = projects.find(p => p.id === projectId);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => { reset(); onClose(); }}
    >
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={() => { reset(); onClose(); }} style={styles.modalClose}>
            <X size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>New draw period</Text>
          <TouchableOpacity onPress={handleSave} style={styles.modalSave} testID="draw-save">
            <Check size={18} color={Colors.background} />
            <Text style={styles.modalSaveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.label}>Project</Text>
          <TouchableOpacity
            style={styles.field}
            onPress={() => setPickerOpen(o => !o)}
            activeOpacity={0.85}
          >
            <Text style={[styles.fieldText, !selectedProject && styles.fieldPlaceholder]}>
              {selectedProject?.name ?? 'Pick a project'}
            </Text>
            <ChevronDown size={16} color={Colors.textMuted} />
          </TouchableOpacity>
          {pickerOpen && (
            <View style={styles.pickerList}>
              {projects.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={styles.pickerItem}
                  onPress={() => {
                    setProjectId(p.id);
                    setPickerOpen(false);
                  }}
                >
                  <Text style={styles.pickerItemText}>{p.name}</Text>
                  {p.id === projectId ? <Check size={14} color={Colors.primary} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row' as const, gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Period start</Text>
              <TextInput
                value={periodStart}
                onChangeText={setPeriodStart}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
                testID="draw-period-start"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Period end</Text>
              <TextInput
                value={periodEnd}
                onChangeText={setPeriodEnd}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
                testID="draw-period-end"
              />
            </View>
          </View>

          <Text style={styles.label}>Label (optional)</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={suggestedLabel || 'Draw 4 — June 2026'}
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
          />

          <Text style={styles.helperText}>
            Invoices, lien waivers, and the AIA pay app are linked from each draw's detail flow.
            This new draw starts in &quot;Open&quot; status — link the AIA pay app, then mark it submitted
            when you send the package to the lender.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    marginTop: 6,
  },
  headerTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  headerCount: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: Colors.primary,
  },
  headerSub: {
    paddingHorizontal: 16,
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginBottom: 12,
  },

  chipRow: { flexDirection: 'row' as const, gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: Colors.textSecondary },
  chipTextActive: { color: Colors.background },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden' as const,
  },
  cardHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12,
    padding: 14,
  },
  cardProject: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  cardTitle: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    marginTop: 2,
    letterSpacing: -0.2,
  },
  cardSub: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },

  moneyRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 14,
    paddingBottom: 12,
    paddingTop: 4,
  },
  moneyDivider: { width: 1, backgroundColor: Colors.borderLight },
  moneyIconWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 2,
    marginBottom: 2,
  },
  moneyLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: Colors.textMuted,
  },
  moneyValue: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    letterSpacing: -0.2,
  },

  miniRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderLight,
    backgroundColor: Colors.surfaceAlt,
  },
  miniCell: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  miniText: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    fontWeight: '600' as const,
  },

  cardActions: {
    flexDirection: 'row' as const,
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.borderLight,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 11,
    borderRadius: Tokens.radius.md,
  },
  actionPrimary: { backgroundColor: Colors.primary },
  actionSecondary: { backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.borderLight },
  actionBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const },

  warningBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: Colors.warning + '12',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.warning + '40',
  },
  warningText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.warning,
    fontWeight: '600' as const,
  },

  subEmpty: { paddingHorizontal: 24, paddingVertical: 24 },
  subEmptyText: { fontSize: Type.body.fontSize, color: Colors.textMuted, textAlign: 'center' as const },

  fab: {
    position: 'absolute' as const,
    right: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  fabText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.background,
  },

  // Modal
  modalRoot: { flex: 1, backgroundColor: Colors.background },
  modalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  modalClose: { padding: 4 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: Colors.text },
  modalSave: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.primary,
  },
  modalSaveText: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: Colors.background },
  modalBody: { padding: 16, gap: 6, paddingBottom: 60 },

  label: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
    marginTop: 14,
    marginBottom: 6,
  },
  field: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  fieldText: { fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '600' as const, flex: 1 },
  fieldPlaceholder: { color: Colors.textMuted, fontWeight: '500' as const },
  pickerList: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginTop: 6,
    overflow: 'hidden' as const,
  },
  pickerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  pickerItemText: { fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '500' as const },

  input: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: Type.body.fontSize,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  helperText: {
    marginTop: 16,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
});
