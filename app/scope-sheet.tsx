// scope-sheet.tsx — AI Scope Sheet: turn a priced estimate into a defensible
// inclusions / exclusions / clarifications / assumptions / allowances document.
//
// The estimator's narrative is the most-lost piece of the estimate handoff —
// the number transfers, the "what's in / what's out / what we assumed" doesn't.
// This drafts it straight off the estimate (utils/scopeSheet → AI relay, with a
// deterministic fallback), then lets the GC edit every line before it goes into
// a proposal or contract. Persisted per-project (local) so it's there at
// contract, buyout, and change-order time.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform, Share,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  RefreshCw, Copy, Share2, Plus, Trash2, Check, X,
  CircleCheck, CircleMinus, CircleHelp, Info, Wallet, AlertTriangle, Pencil,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import UpgradeSheet from '@/components/UpgradeSheet';
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ScopeSheet, ScopeSheetItem } from '@/types';
import { showAlert } from '@/utils/alert';
import {
  generateScopeSheet, loadScopeSheet, saveScopeSheet, scopeSheetToText, estimateTotalOf,
} from '@/utils/scopeSheet';

type SectionKey = 'inclusions' | 'exclusions' | 'clarifications' | 'assumptions' | 'allowances';

const SECTIONS: { key: SectionKey; title: string; subtitle: string; icon: typeof Check }[] = [
  { key: 'inclusions',     title: 'Inclusions',     subtitle: "What you're providing",        icon: CircleCheck },
  { key: 'exclusions',     title: 'Exclusions',     subtitle: "What's NOT in the price",       icon: CircleMinus },
  { key: 'clarifications', title: 'Clarifications', subtitle: 'Pin these down before signing', icon: CircleHelp },
  { key: 'assumptions',    title: 'Assumptions',    subtitle: 'What the price depends on',     icon: Info },
  { key: 'allowances',     title: 'Allowances',     subtitle: 'Placeholder budgets',           icon: Wallet },
];

function money(n: number): string {
  return '$' + Math.round(n || 0).toLocaleString('en-US');
}

export default function ScopeSheetScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { getProject } = useProjects();
  const { tier } = useSubscription();
  const project = useMemo(() => (projectId ? getProject(projectId) : null), [projectId, getProject]);

  const [sheet, setSheet] = useState<ScopeSheet | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: SectionKey; index: number } | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!projectId) { setLoading(false); return; }
      const existing = await loadScopeSheet(projectId);
      if (alive) { setSheet(existing); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [projectId]);

  const persist = useCallback((next: ScopeSheet) => {
    setSheet(next);
    void saveScopeSheet(next);
  }, []);

  const generate = useCallback(async (forceRegenerate: boolean) => {
    if (!project) return;

    // Rate-limit / tier gate. generateScopeSheet goes through the paid smart
    // relay (utils/scopeSheet → mageAI, tier:'smart'); pre-fix this screen
    // had NO gate while every sibling AI-estimating screen does. We meter it
    // on the shared 'aiEstimateWizard' feature (the Pro estimating key): free
    // gets its lifetime trials, then the UpgradeSheet; Pro+ is bounded by the
    // smart-daily cap. Blocked → show the upgrade sheet and stop before spend.
    const limit = await checkAILimit(tier, 'smart', 'aiEstimateWizard');
    if (!limit.allowed) {
      setUpgradeLimit(limit);
      return;
    }

    setGenerating(true);
    setWarning(null);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const { sheet: s, warning: w } = await generateScopeSheet(project, { forceRegenerate });
      persist(s);
      setWarning(w ?? null);
      // Only count usage when the AI relay actually produced the draft — the
      // deterministic heuristic fallback (offline / capped / empty) must not
      // burn a trial or a daily call.
      if (s.source === 'ai') void recordAIUsage('smart', 'aiEstimateWizard');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      showAlert('Could not generate', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setGenerating(false);
    }
  }, [project, persist, tier]);

  // ── item mutations ─────────────────────────────────────────────────────────
  const commitEdit = useCallback(() => {
    if (!sheet || !editing) return;
    const text = draft.trim();
    const list = [...sheet[editing.key]];
    if (!text) {
      list.splice(editing.index, 1); // empty = discard (covers a cancelled "Add")
    } else {
      list[editing.index] = { ...list[editing.index], text };
    }
    persist({ ...sheet, [editing.key]: list });
    setEditing(null);
    setDraft('');
  }, [sheet, editing, draft, persist]);

  const deleteItem = useCallback((key: SectionKey, index: number) => {
    if (!sheet) return;
    const list = [...sheet[key]];
    list.splice(index, 1);
    persist({ ...sheet, [key]: list });
  }, [sheet, persist]);

  const addItem = useCallback((key: SectionKey) => {
    if (!sheet) return;
    const list: ScopeSheetItem[] = [...sheet[key], { text: '' }];
    persist({ ...sheet, [key]: list });
    setEditing({ key, index: list.length - 1 });
    setDraft('');
  }, [sheet, persist]);

  const copyAll = useCallback(async () => {
    if (!sheet) return;
    await Clipboard.setStringAsync(scopeSheetToText(sheet, project?.name));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    showAlert('Copied', 'Scope sheet copied to clipboard.');
  }, [sheet, project?.name]);

  const shareAll = useCallback(async () => {
    if (!sheet) return;
    try { await Share.share({ message: scopeSheetToText(sheet, project?.name) }); } catch { /* user cancelled */ }
  }, [sheet, project?.name]);

  // ── render ───────────────────────────────────────────────────────────────
  if (!project) {
    return (
      <View style={[styles.container, styles.center]}>
        <Stack.Screen options={{ title: 'Scope Sheet' }} />
        <Text style={styles.emptyText}>Open this from a project to draft its scope sheet.</Text>
      </View>
    );
  }

  const currentTotal = estimateTotalOf(project);
  const estimateChanged = !!sheet && Math.round(sheet.estimateTotal) !== Math.round(currentTotal);
  const itemCount = sheet
    ? sheet.inclusions.length + sheet.exclusions.length + sheet.clarifications.length + sheet.assumptions.length + sheet.allowances.length
    : 0;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Scope Sheet' }} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {/* Header card */}
        <View style={styles.headerCard}>
          <Text style={styles.projectName} numberOfLines={1}>{project.name}</Text>
          <Text style={styles.headerMeta}>
            {project.type || 'Project'} · estimate {money(currentTotal)}
            {sheet ? ` · ${itemCount} item${itemCount === 1 ? '' : 's'}` : ''}
          </Text>
          {sheet && (
            <View style={styles.badgeRow}>
              <View style={[styles.srcBadge, sheet.source === 'ai' ? styles.srcAi : styles.srcHeuristic]}>
                {sheet.source === 'ai' && <MageAIMark size={11} color={t.accent} />}
                <Text style={[styles.srcText, { color: sheet.source === 'ai' ? t.accent : t.textSecondary }]}>
                  {sheet.source === 'ai' ? 'AI draft' : 'Starter draft'}
                </Text>
              </View>
              <Text style={styles.genAt}>edited {sheet.generatedAt.slice(0, 10)}</Text>
            </View>
          )}
        </View>

        {warning && (
          <View style={styles.warnCard}>
            <AlertTriangle size={14} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.warnText}>{warning}</Text>
          </View>
        )}

        {estimateChanged && (
          <View style={styles.warnCard}>
            <AlertTriangle size={14} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.warnText}>
              The estimate changed since this sheet was written ({money(sheet!.estimateTotal)} → {money(currentTotal)}). Regenerate to refresh it.
            </Text>
          </View>
        )}

        {/* Empty state */}
        {!sheet && !loading && (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIcon}><MageAIMark size={26} color={t.accent} /></View>
            <Text style={styles.emptyTitle}>Draft the scope from your estimate</Text>
            <Text style={styles.emptyBody}>
              MAGE reads your estimate line items and drafts the inclusions, exclusions, clarifications, assumptions, and
              allowances — the scope language that protects your margin at change-order time. Edit anything before you send it.
            </Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => generate(false)} disabled={generating} activeOpacity={0.85} testID="generate-scope-sheet">
              {generating ? <ActivityIndicator color={Colors.textOnAccent} /> : <><MageAIMark size={16} color={Colors.textOnAccent} /><Text style={styles.primaryBtnText}>Generate scope sheet</Text></>}
            </TouchableOpacity>
          </View>
        )}

        {loading && !sheet && <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />}

        {/* Sections */}
        {sheet && SECTIONS.map(({ key, title, subtitle, icon: Icon }) => {
          const items = sheet[key];
          return (
            <View key={key} style={styles.section}>
              <View style={styles.sectionHead}>
                <Icon size={16} color={t.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>{title}</Text>
                  <Text style={styles.sectionSub}>{subtitle}</Text>
                </View>
                <Text style={styles.sectionCount}>{items.length}</Text>
              </View>

              {items.map((item, index) => {
                const isEditing = editing?.key === key && editing.index === index;
                if (isEditing) {
                  return (
                    <View key={index} style={styles.editRow}>
                      <TextInput
                        style={styles.editInput}
                        value={draft}
                        onChangeText={setDraft}
                        placeholder="Describe this scope line…"
                        placeholderTextColor={t.textMuted}
                        multiline
                        autoFocus
                        testID={`scope-edit-${key}-${index}`}
                      />
                      <View style={styles.editActions}>
                        <TouchableOpacity onPress={commitEdit} style={styles.editBtn} hitSlop={8}><Check size={18} color={t.success} strokeWidth={1.75} /></TouchableOpacity>
                        <TouchableOpacity onPress={() => { setEditing(null); setDraft(''); if (!item.text.trim()) deleteItem(key, index); }} style={styles.editBtn} hitSlop={8}><X size={18} color={t.textMuted} strokeWidth={1.75} /></TouchableOpacity>
                      </View>
                    </View>
                  );
                }
                return (
                  <View key={index} style={styles.itemRow}>
                    <View style={styles.bullet} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemText}>{item.text}</Text>
                      <View style={styles.itemMetaRow}>
                        {item.trade ? <Text style={styles.tradeChip}>{item.trade}</Text> : null}
                        {item.risk && item.risk !== 'low' ? (
                          <View style={[styles.riskChip, item.risk === 'high' ? styles.riskHigh : styles.riskMed]}>
                            <AlertTriangle size={9} color={item.risk === 'high' ? t.danger : t.accent} strokeWidth={1.75} />
                            <Text style={[styles.riskText, { color: item.risk === 'high' ? t.danger : t.accent }]}>
                              {item.risk === 'high' ? 'dispute risk' : 'confirm'}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      {item.note ? <Text style={styles.itemNote}>{item.note}</Text> : null}
                    </View>
                    <View style={styles.itemActions}>
                      <TouchableOpacity onPress={() => { setEditing({ key, index }); setDraft(item.text); }} hitSlop={8}><Pencil size={15} color={t.textMuted} strokeWidth={1.75} /></TouchableOpacity>
                      <TouchableOpacity onPress={() => deleteItem(key, index)} hitSlop={8}><Trash2 size={15} color={t.danger} strokeWidth={1.75} /></TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              <TouchableOpacity style={styles.addRow} onPress={() => addItem(key)} activeOpacity={0.7} testID={`scope-add-${key}`}>
                <Plus size={14} color={t.accent} strokeWidth={1.75} />
                <Text style={styles.addText}>Add {title.toLowerCase().replace(/s$/, '')}</Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {sheet && (
          <Text style={styles.footnote}>
            Drafted from your estimate — review every line before it goes in a proposal or contract. Not legal advice.
          </Text>
        )}
      </ScrollView>

      {/* Action bar */}
      {sheet && (
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 10 }]}>
          <TouchableOpacity style={styles.barBtn} onPress={() => generate(true)} disabled={generating} activeOpacity={0.8} testID="regenerate-scope-sheet">
            {generating ? <ActivityIndicator size="small" color={t.accent} /> : <RefreshCw size={16} color={t.accent} strokeWidth={1.75} />}
            <Text style={styles.barBtnText}>Regenerate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.barBtn} onPress={copyAll} activeOpacity={0.8}>
            <Copy size={16} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.barBtnText}>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.barBtn, styles.barBtnPrimary]} onPress={shareAll} activeOpacity={0.8}>
            <Share2 size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
            <Text style={[styles.barBtnText, { color: Colors.textOnAccent }]}>Share</Text>
          </TouchableOpacity>
        </View>
      )}

      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="AI Scope Sheet"
        onClose={() => setUpgradeLimit(null)}
      />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { padding: 16 },

  headerCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 16,
    borderWidth: 1, borderColor: t.line, marginBottom: 12,
  },
  projectName: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text },
  headerMeta: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginTop: 3 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  srcBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full },
  srcAi: { backgroundColor: `${t.accent}15` },
  srcHeuristic: { backgroundColor: t.surfaceAlt },
  srcText: { fontSize: Type.caption2.fontSize, fontWeight: '700' },
  genAt: { fontSize: Type.caption2.fontSize, color: t.textMuted },

  warnCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: `${t.accent}0E`, borderWidth: 1, borderColor: `${t.accent}33`,
    borderRadius: Tokens.radius.md, padding: 11, marginBottom: 12,
  },
  warnText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  emptyCard: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 24,
    borderWidth: 1, borderColor: t.line, alignItems: 'center', gap: 10, marginTop: 8,
  },
  emptyIcon: {
    width: 52, height: 52, borderRadius: Tokens.radius.card,
    backgroundColor: `${t.accent}15`, alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: Type.headline.fontSize, fontWeight: '800', color: t.text, textAlign: 'center' },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', lineHeight: 19 },
  emptyText: { fontSize: Type.body.fontSize, color: t.textSecondary, textAlign: 'center' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accent, paddingVertical: 14, paddingHorizontal: 20,
    borderRadius: Tokens.radius.card, marginTop: 6, alignSelf: 'stretch',
  },
  primaryBtnText: { color: Colors.textOnAccent, fontWeight: '700', fontSize: Type.subhead.fontSize },

  section: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line, padding: 14, marginBottom: 12,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sectionTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  sectionSub: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 1 },
  sectionCount: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.textMuted },

  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
  bullet: { width: 5, height: 5, borderRadius: Tokens.radius.full, backgroundColor: t.accent, marginTop: 7 },
  itemText: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tradeChip: { fontSize: Type.caption2.fontSize, fontWeight: '600', color: t.textSecondary, backgroundColor: t.surfaceAlt, paddingHorizontal: 7, paddingVertical: 2, borderRadius: Tokens.radius.sm, overflow: 'hidden' },
  riskChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.sm },
  riskHigh: { backgroundColor: `${t.danger}18` },
  riskMed: { backgroundColor: `${t.accent}18` },
  riskText: { fontSize: Type.caption2.fontSize, fontWeight: '700' },
  itemNote: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontStyle: 'italic', marginTop: 3, lineHeight: 16 },
  itemActions: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 2 },

  editRow: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, gap: 8 },
  editInput: {
    backgroundColor: t.bg, borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.accent,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: Type.footnote.fontSize, color: t.text, minHeight: 40,
  },
  editActions: { flexDirection: 'row', alignSelf: 'flex-end', gap: 16 },
  editBtn: { padding: 2 },

  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10 },
  addText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.accent },

  footnote: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 16, marginTop: 4, paddingHorizontal: 8 },

  actionBar: {
    flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10,
    backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.line,
  },
  barBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Tokens.radius.card, backgroundColor: t.surfaceAlt,
  },
  barBtnPrimary: { backgroundColor: t.accent },
  barBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },
});
