// components/plans/AskPlansPanel.tsx — "Ask Your Plans" question box.
//
// Lets a GC type a plain-English question about their uploaded plan set and
// get a grounded, cited answer with a tap-to-jump to the relevant sheet.
// Also exposes Index / re-index to extract + embed sheets into project memory.
//
// Gate: 'ask_your_plans' (Business) through useProjectAccess — own tier OR the
// collaborator grant for THIS project (#73/#161). A collaborator's questions
// run against the index the project owner built, metered on the owner's plan
// (project-memory-search resolves the owner server-side), so the grant is no
// longer an honest upsell turned into a 403. Only the owner builds the index;
// a collaborator sees why Index is not offered. If locked, an upsell card with
// a way to upgrade is shown instead.
//
// #78: answers come only from CURRENT sheets. On open, and whenever the sheet
// list changes, a free manifest check says how many sheets changed since the
// last index; opening the panel never prunes anything.

import React, { useState, useCallback, useRef, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { onlineManager } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Search, RefreshCw, BookOpen, Lock, ArrowRight, AlertTriangle, Square, CheckSquare,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { Button } from '@/components/ui';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { askPlans, indexPlanSheets, readPlanIndexManifest, type PlanIndexResult } from '@/utils/plans/askYourPlans';
import { summarizePlanIndex, type IndexTone } from '@/utils/plans/memoryIndexCore';
import {
  planBatchRenumber, chainColumnsPatch, planControlBlock, effectivePlanRole, type PlanRoleStatus, staleMatchesNote, changedSinceIndexLabel,
  type TitleBlockSuggestion, type PlanRole,
} from '@/utils/plans/revisionActions';
import type { PlanSheet } from '@/types';

interface Props {
  projectId: string;
  sheets: PlanSheet[];
  /** Where "See Business plan" goes. Defaults to the paywall screen. */
  onUpgrade?: () => void;
}

export default function AskPlansPanel({ projectId, sheets, onUpgrade }: Props) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess, role } = useProjectAccess(projectId);
  const roleState = useProjectRoleState(projectId);
  // Web react-query pauses the role read offline — neither loading nor errored.
  const offline = useSyncExternalStore(onlineManager.subscribe, () => !onlineManager.isOnline(), () => false);
  const { getProject } = useProjects();
  const { user } = useAuth();
  // The job's owner keeps Index through a failed/offline role read.
  const seatRole = effectivePlanRole(role, getProject(projectId), user?.id);

  if (!canAccess('ask_your_plans')) {
    // The gating contract: never an upsell while the role is still resolving
    // (a collaborator would see a paywall flash), a retry on a failed read.
    if (roleState.isLoading) {
      return <View style={styles.upsellCard}><ActivityIndicator size="small" color={t.accent} /></View>;
    }
    if (roleState.isError || (offline && role === null)) {
      return (
        <View style={styles.upsellCard}>
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={styles.upsellSub}>Couldn&apos;t check your access to this job&apos;s plans.</Text>
            <Button label="Try again" variant="secondary" size="sm" onPress={roleState.refetch} />
          </View>
        </View>
      );
    }
    if (role === null) {
      return (
        <View style={styles.upsellCard}>
          <Text style={[styles.upsellSub, { flex: 1 }]}>You don&apos;t have access to this project&apos;s plans.</Text>
        </View>
      );
    }
    return <UpsellCard t={t} styles={styles} onUpgrade={onUpgrade ?? (() => router.push('/paywall' as never))} />;
  }

  return <AskPlansPanelInner projectId={projectId} sheets={sheets} role={seatRole} roleStatus={{ isError: roleState.isError, offline }} onRetryRole={roleState.refetch} t={t} styles={styles} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner (authenticated) panel
// ─────────────────────────────────────────────────────────────────────────────

type AskState = 'idle' | 'asking' | 'answered' | 'error';
type IndexState = 'idle' | 'indexing' | 'done' | 'error';

function AskPlansPanelInner({
  projectId, sheets, role, roleStatus, onRetryRole, t, styles,
}: Props & { role: PlanRole; roleStatus: PlanRoleStatus; onRetryRole?: () => void; t: ThemeColors; styles: ReturnType<typeof makeStyles> }) {
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const { updatePlanSheet } = useProjects();
  const { user } = useAuth();
  const canSyncSheets = !!user?.id && isSupabaseConfigured;
  // Only the owner builds the index (it spends the owner's plan reads).
  const indexBlock = planControlBlock(role, 'index', roleStatus);

  const [question, setQuestion] = useState('');
  const [askState, setAskState] = useState<AskState>('idle');
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<{ ref: string; sheetId: string }[]>([]);
  const [noneFound, setNoneFound] = useState(false);
  const [weakGrounding, setWeakGrounding] = useState(false);
  // The SEARCH failed, which is not "your plans don't say". Kept apart from
  // `answer` so a server refusal can never be worded as a plan answer.
  const [searchFailed, setSearchFailed] = useState<string | null>(null);

  const [indexState, setIndexState] = useState<IndexState>('idle');
  const [indexResult, setIndexResult] = useState<PlanIndexResult | null>(null);
  const [indexProgress, setIndexProgress] = useState<{ done: number; total: number } | null>(null);
  const [staleDropped, setStaleDropped] = useState(0);
  // #78: sheets changed since the last index, from a free manifest read.
  // null = unknown (never claim "up to date" on a failed read).
  const [changedCount, setChangedCount] = useState<number | null>(null);
  // Plans-revisions handoff (#75): numbers the index run read off title blocks,
  // offered for his yes — never written silently.
  const [titleReview, setTitleReview] = useState<(TitleBlockSuggestion & { use: boolean })[] | null>(null);

  // Keyed on what the manifest depends on — the current sheets' identity and
  // fingerprint inputs — so a re-render with the same set does not re-ask.
  const currentKey = useMemo(
    () => sheets.filter(s => !s.superseded).map(s => `${s.id}:${s.storagePath ?? ''}:${s.sheetNumber ?? ''}:${s.name}`).join('|'),
    [sheets],
  );
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  useEffect(() => {
    let live = true;
    if (!currentKey) { setChangedCount(0); return; }
    void readPlanIndexManifest(projectId, sheetsRef.current, false).then((man) => {
      if (live) setChangedCount(man ? man.staleIds.size : null);
    });
    return () => { live = false; };
  }, [projectId, currentKey]);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q || askState === 'asking') return;
    setAskState('asking');
    setAnswer('');
    setCitations([]);
    setNoneFound(false);
    setWeakGrounding(false);
    setSearchFailed(null);
    setStaleDropped(0);
    try {
      const result = await askPlans(projectId, q, sheets);
      setStaleDropped(result.staleDropped);
      setAnswer(result.answer);
      setCitations(result.citations);
      setNoneFound(result.noneFound);
      setWeakGrounding(result.weakGrounding);
      setSearchFailed(result.searchFailed);
      setAskState(result.searchFailed ? 'error' : 'answered');
    } catch {
      setAnswer('');
      setCitations([]);
      setNoneFound(false);
      setWeakGrounding(false);
      setSearchFailed("the plan search could not be reached");
      setAskState('error');
    }
  }, [projectId, question, askState, sheets]);

  const handleIndex = useCallback(async () => {
    if (indexState === 'indexing' || indexBlock) return;
    setIndexState('indexing');
    setIndexResult(null);
    setIndexProgress(null);
    try {
      const result = await indexPlanSheets(projectId, sheets, (done, total) => setIndexProgress({ done, total }));
      setIndexResult(result);
      setIndexState('done');
      setChangedCount(result.skipped.length);
      // Duplicates are offered but not pre-ticked: two pages can't both be A-201.
      if (result.titleBlockSuggestions.length > 0) {
        setTitleReview(result.titleBlockSuggestions.map(sg => ({ ...sg, use: !sg.duplicate })));
      }
    } catch {
      setIndexState('error');
    } finally {
      setIndexProgress(null);
    }
  }, [projectId, sheets, indexState, indexBlock]);

  // Apply the confirmed numbers exactly as app/plans.tsx applyTitleNumbers
  // does: one ordered plan against the set as it is now, chain columns through
  // the offline queue.
  const applyTitleNumbers = useCallback(() => {
    if (!titleReview) return;
    const accepted = titleReview.filter(i => i.use).map(i => ({ sheetId: i.sheetId, sheetNumber: i.sheetNumber }));
    setTitleReview(null);
    if (accepted.length === 0) return;
    const plan = planBatchRenumber(accepted, sheetsRef.current.filter(s => s.projectId === projectId));
    const now = new Date().toISOString();
    for (const p of plan.patches) {
      updatePlanSheet(p.id, p.updates);
      const chain = chainColumnsPatch(p.updates);
      if (canSyncSheets && chain) void supabaseWrite('plan_sheets', 'update', { id: p.id, ...chain, updated_at: now });
    }
  }, [titleReview, projectId, updatePlanSheet, canSyncSheets]);

  const jumpToSheet = useCallback((sheetId: string) => {
    router.push({ pathname: '/plan-viewer', params: { sheetId } });
  }, [router]);

  // Superseded revisions are never indexed — the count on the button is the
  // count the run will actually try to cover.
  const currentCount = sheets.filter(s => !s.superseded).length;
  // What the run did, worded by summarizePlanIndex: "All 60 sheets indexed",
  // "Indexed 41 of 60 — 19 not searchable", or "0 of 60 … can't use your plans
  // yet". The old label said "Indexing complete" in success green when NOTHING
  // was indexed (every web run), and the next answer was "not in your plans".
  const summary = indexState === 'done' && indexResult ? summarizePlanIndex(indexResult) : null;
  const indexLabel = (() => {
    if (indexState === 'indexing') {
      if (indexProgress && indexProgress.total > 0) return `Reading sheet ${Math.min(indexProgress.done + 1, indexProgress.total)} of ${indexProgress.total}…`;
      return `Checking ${currentCount} sheet${currentCount === 1 ? '' : 's'}…`;
    }
    if (summary) return summary.label;
    if (indexState === 'error') return 'Indexing failed — try again';
    const changed = changedSinceIndexLabel(changedCount);
    if (changed) return changed;
    return currentCount > 0 ? `Index ${currentCount} sheet${currentCount === 1 ? '' : 's'}` : 'Index plans';
  })();
  const changedWarning = !summary && indexState !== 'indexing' && indexState !== 'error' && (changedCount ?? 0) > 0;
  const toneColor = (tone: IndexTone | undefined): string =>
    tone === 'success' ? t.successLabel
      : tone === 'warning' ? t.warningLabel
        : tone === 'danger' ? t.dangerLabel
          : t.textMuted;
  const indexColor = indexState === 'error' ? t.dangerLabel : changedWarning ? t.warningLabel : toneColor(summary?.tone);
  // A citation can only open a CURRENT sheet this device has — a chip on a
  // superseded copy would open the drawing the answer must not come from.
  const liveCitations = citations.filter(c => sheets.some(s => s.id === c.sheetId && !s.superseded));
  const staleNote = staleMatchesNote(staleDropped, !!answer);

  return (
    <View style={styles.panel}>
      {/* Header */}
      <View style={styles.panelHeader}>
        <BookOpen size={16} color={t.accent} strokeWidth={1.75} />
        <Text style={styles.panelTitle}>Ask Your Plans</Text>
      </View>

      {/* Input row */}
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={question}
          onChangeText={setQuestion}
          placeholder="Ask your plans…"
          placeholderTextColor={t.textMuted}
          returnKeyType="send"
          onSubmitEditing={() => void handleAsk()}
          editable={askState !== 'asking'}
          multiline={false}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!question.trim() || askState === 'asking') && styles.sendBtnDisabled]}
          onPress={() => void handleAsk()}
          disabled={!question.trim() || askState === 'asking'}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Ask"
        >
          {askState === 'asking' ? (
            <ActivityIndicator size="small" color={Colors.textOnAccent} />
          ) : (
            <Search size={16} color={Colors.textOnAccent} strokeWidth={1.75} />
          )}
        </TouchableOpacity>
      </View>

      {/* Loading state */}
      {askState === 'asking' && (
        <Text style={styles.statusText}>Reading your plans…</Text>
      )}

      {/* Answer */}
      {(askState === 'answered' || askState === 'error') && answer ? (
        <View style={styles.answerCard}>
          <Text style={styles.answerText}>{answer}</Text>

          {/* Citations */}
          {liveCitations.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.citationRow}
            >
              {liveCitations.map(({ ref, sheetId }) => (
                <TouchableOpacity
                  key={sheetId}
                  style={styles.citationChip}
                  onPress={() => jumpToSheet(sheetId)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`Jump to Sheet ${ref}`}
                >
                  <Text style={styles.citationChipText}>Sheet {ref}</Text>
                  <ArrowRight size={11} color={t.accent} strokeWidth={2} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* Grounding chip. The answer came from the nearest sheets even
              though none of them scored as a confident match, so it is
              presented as a lead to check, not as a fact off the drawing. */}
          {weakGrounding && (
            <View style={styles.weakRow}>
              <AlertTriangle size={12} color={t.warningLabel} strokeWidth={2} />
              <Text style={styles.weakText}>
                Weak match — no sheet scored as a close match to that question. Open the cited sheet and verify before you build to this.
              </Text>
            </View>
          )}

          {/* None-found message */}
          {noneFound && staleDropped === 0 && (
            <Text style={styles.noneFoundText}>
              I couldn't find that in the indexed plans — try rephrasing, or index new sheets below.
            </Text>
          )}
        </View>
      ) : null}

      {/* #78: older-revision matches were left out — said, never silently
          answered from, and never worded as "not in your plans". */}
      {(askState === 'answered' || askState === 'error') && staleNote ? (
        <View style={styles.weakRow} testID="ask-plans-stale-note">
          <AlertTriangle size={12} color={t.warningLabel} strokeWidth={2} />
          <Text style={styles.weakText}>{staleNote}</Text>
        </View>
      ) : null}

      {/* The search itself failed or was refused. Deliberately NOT the
          none-found line: #19's harm was a server error reading as "it isn't
          in your plans", which teaches the PM to distrust correct answers. */}
      {askState === 'error' && searchFailed ? (
        <View style={styles.weakRow}>
          <AlertTriangle size={12} color={t.dangerLabel} strokeWidth={2} />
          <Text style={[styles.weakText, { color: t.dangerLabel }]}>
            Couldn&apos;t search your plans just now — {searchFailed}. Your plans may still hold the answer.
          </Text>
        </View>
      ) : null}

      {/* Index / re-index action — the owner's; a collaborator is told why. */}
      {indexBlock ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.skipText} testID="ask-plans-index-blocked">{indexBlock}</Text>
          {roleStatus.isError && onRetryRole ? (
            <Button label="Try again" variant="secondary" size="sm" onPress={onRetryRole} testID="ask-plans-role-retry" />
          ) : null}
        </View>
      ) : (
      <TouchableOpacity
        style={[styles.indexBtn, indexState === 'indexing' && styles.indexBtnActive]}
        onPress={() => void handleIndex()}
        disabled={indexState === 'indexing'}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel={indexLabel}
      >
        {indexState === 'indexing' ? (
          <ActivityIndicator size="small" color={t.accent} />
        ) : (
          <RefreshCw size={13} color={indexColor} strokeWidth={1.75} />
        )}
        <Text style={[styles.indexBtnText, { color: indexColor }]}>
          {indexLabel}
        </Text>
      </TouchableOpacity>
      )}

      {/* Title-block numbers the run read, offered for his yes (#75). A
          misread number would supersede the wrong sheet, so each is shown as
          a reading and only the ticked ones are saved. */}
      {titleReview && titleReview.length > 0 ? (
        <View style={styles.skipList} testID="ask-plans-title-review">
          <Text style={styles.skipText}>Read by AI from the title blocks — check each against the sheet.</Text>
          {titleReview.map(item => (
            <TouchableOpacity
              key={item.sheetId}
              style={styles.titleRow}
              onPress={() => setTitleReview(r => r ? r.map(i => i.sheetId === item.sheetId ? { ...i, use: !i.use } : i) : r)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.use }}
            >
              {item.use
                ? <CheckSquare size={14} color={t.accent} strokeWidth={1.75} />
                : <Square size={14} color={t.textMuted} strokeWidth={1.75} />}
              <Text style={[styles.skipText, { flex: 1 }]} numberOfLines={2}>
                Title block reads {item.sheetNumber} — use it? · {item.label}{item.duplicate ? ` · another page also reads ${item.sheetNumber}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              label={titleReview.some(i => i.use) ? `Use ${titleReview.filter(i => i.use).length} number${titleReview.filter(i => i.use).length === 1 ? '' : 's'}` : 'Tick a number to use it'}
              size="sm"
              onPress={applyTitleNumbers}
              disabled={!titleReview.some(i => i.use)}
            />
            <Button label="Not now" size="sm" variant="ghost" onPress={() => setTitleReview(null)} />
          </View>
        </View>
      ) : null}

      {/* Why sheets are not searchable — the plan-extract refusal in its own
          words (monthly cap, hourly limit, unreadable sheet), grouped. Without
          this, "not found" in an answer could silently mean "never indexed". */}
      {summary && summary.reasons.length > 0 ? (
        <View style={styles.skipList} accessibilityRole="summary">
          {summary.reasons.slice(0, 3).map(line => (
            <Text key={line} style={styles.skipText}>{line}</Text>
          ))}
          {summary.reasons.length > 3 ? (
            <Text style={styles.skipText}>+{summary.reasons.length - 3} more reasons</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsell card (shown when not Business+)
// ─────────────────────────────────────────────────────────────────────────────

function UpsellCard({ t, styles, onUpgrade }: { t: ThemeColors; styles: ReturnType<typeof makeStyles>; onUpgrade: () => void }) {
  return (
    <View style={styles.upsellCard}>
      <Lock size={15} color={t.accent} strokeWidth={1.75} />
      <View style={{ flex: 1, gap: 8 }}>
        <View>
          <Text style={styles.upsellTitle}>Ask your plans in plain English</Text>
          <Text style={styles.upsellSub}>
            Type a question, get a cited answer with a tap-to-jump to the sheet — Business plan.
          </Text>
        </View>
        {/* #163: the lock used to have no way through it. */}
        <Button label="See Business plan" size="sm" variant="secondary" onPress={onUpgrade} testID="ask-plans-upgrade" />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  panel: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.line,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },

  panelHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7,
  },
  panelTitle: {
    ...Type.subheadline,
    fontWeight: '700' as const,
    color: t.text,
  },

  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    borderColor: t.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...Type.subhead,
    color: t.text,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },

  statusText: {
    ...Type.caption1,
    color: t.textMuted,
    fontWeight: '500' as const,
  },

  answerCard: {
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    borderColor: t.line,
    padding: 12,
    gap: 10,
  },
  answerText: {
    ...Type.body,
    color: t.text,
    lineHeight: 22,
  },

  citationRow: {
    flexDirection: 'row' as const,
    gap: 8,
  },
  citationChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    backgroundColor: t.accent + '14',
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: t.accent + '44',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  citationChipText: {
    ...Type.caption1,
    color: t.accent,
    fontWeight: '700' as const,
  },

  noneFoundText: {
    ...Type.caption1,
    color: t.textMuted,
    lineHeight: 17,
  },

  weakRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 6,
  },
  weakText: {
    ...Type.caption1,
    color: t.warningLabel,
    lineHeight: 17,
    flex: 1,
  },

  indexBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: t.line,
  },
  indexBtnActive: {
    opacity: 0.7,
  },
  indexBtnText: {
    ...Type.caption1,
    color: t.textMuted,
    fontWeight: '600' as const,
  },

  skipList: {
    gap: 3,
  },
  titleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingVertical: 4,
  },
  skipText: {
    ...Type.caption1,
    color: t.textSecondary,
    lineHeight: 16,
  },

  upsellCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    backgroundColor: t.accent + '0D',
    borderRadius: Tokens.radius.card,
    borderWidth: 1,
    borderColor: t.accent + '33',
    padding: 14,
    marginBottom: 14,
  },
  upsellTitle: {
    ...Type.subhead,
    fontWeight: '700' as const,
    color: t.text,
    marginBottom: 3,
  },
  upsellSub: {
    ...Type.caption1,
    color: t.textSecondary,
    lineHeight: 16,
  },
});
