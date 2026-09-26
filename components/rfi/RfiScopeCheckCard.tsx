// components/rfi/RfiScopeCheckCard.tsx — "Did this answer add work?"
//
// On a SAVED, answered RFI, compares the architect's answer with the job's
// contracted scope (the Profit Leak prompt shape + parser, feature 'profitLeak'
// on the existing relay), prices each added item on HIS rates through the one
// shared pricing path (useScopeCostBook + scopeRateFor — the same book and key
// Scope Code Gaps uses), shows which items already look covered by his
// estimate lines / change orders, and drafts a change order on an explicit tap.
//
// Honesty:
// - It reads the SAVED rfi, so unsaved typing never triggers a paid call.
// - Covered items are shown with the reason, never silently dropped.
// - An item with no price of his is said to have none; it never reads as $0.
// - The headline money is the same integer-cent sum the drafted CO carries.
// - Draft only: status stays 'draft', nothing is sent, the portal is untouched.
// - Verdicts ('not a change', 'nothing found') live on this device until he
//   signs out (mageid_ key → the sign-out sweep); the one durable link is the
//   draft marker in the CO's synced audit trail, which wins over everything.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { CheckCircle2, AlertTriangle, FileSignature } from 'lucide-react-native';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useScopeCostBook } from '@/hooks/useScopeCostBook';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Card, Button } from '@/components/ui';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { mageAI } from '@/utils/mageAI';
import { buildScopeSummary } from '@/utils/profitLeak/scopeSummary';
import { hashLeakText } from '@/utils/profitLeak/leakPrompt';
import {
  buildRfiScopePrompt,
  hashRfiAnswer,
  parseRfiScopeResult,
  rfiScopeHeadline,
  RFI_SCOPE_CHECKS_KEY,
  RFI_SCOPE_SCHEMA_HINT,
} from '@/utils/profitLeak/rfiScopePrompt';
import { isLeakDraftOwner } from '@/utils/brain/leakCoDraft';
import { buildScopeCoDraft, findScopeDraft, RFI_DRAFT_ACTION, toCents } from '@/utils/brain/scopeCoDraft';
import { buildScopeIndex, isInContractScope } from '@/utils/scopeCoverage';
import { scopeRateFor, scopeRateCaption } from '@/utils/scopePricing';
import { formatMoney } from '@/utils/formatters';
import type { Project, RFI } from '@/types';

export const RFI_SCOPE_NEEDS_ESTIMATE =
  'Link an estimate to this job first. The check compares the answer with your contracted scope.';
export const RFI_SCOPE_OWNER_ONLY = 'Only the project owner drafts change orders.';

type StoredVerdict = {
  verdict: 'not_a_change' | 'none_found';
  answerHash: string;
  at: string;
  estimateLines?: number;
  changeOrders?: number;
};

interface CheckedItem {
  description: string;
  quote: string;
  trade: string;
  unit: string;
  quantity: number;
  rateUsed: number | null;
  caption: string;
  covered: boolean;
  explain: string;
}

interface LiveResult {
  answerHash: string;
  at: string;
  estimateLines: number;
  changeOrders: number;
  items: CheckedItem[];
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'limit'; message: string }
  | { kind: 'failed'; error: string };

async function readVerdicts(): Promise<Record<string, StoredVerdict>> {
  try {
    const raw = await AsyncStorage.getItem(RFI_SCOPE_CHECKS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, StoredVerdict>) : {};
  } catch {
    return {};
  }
}

async function writeVerdict(rfiId: string, v: StoredVerdict): Promise<boolean> {
  try {
    const all = await readVerdicts();
    all[rfiId] = v;
    await AsyncStorage.setItem(RFI_SCOPE_CHECKS_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : iso;
};

const centsText = (cents: number): string => formatMoney(cents / 100, cents % 100 === 0 ? 0 : 2);

export function RfiScopeCheckCard({ rfi, project }: { rfi: RFI; project: Project }) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { getChangeOrdersForProject, addChangeOrder } = useProjects();
  const costDb = useScopeCostBook();
  const { tier } = useSubscription();
  const { user } = useAuth();

  const answerHash = hashRfiAnswer(rfi);
  const [stored, setStored] = useState<StoredVerdict | null>(null);
  const [live, setLive] = useState<LiveResult | null>(null);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState(false);
  const runningRef = useRef(false);
  const draftingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    void readVerdicts().then(all => { if (alive) setStored(all[rfi.id] ?? null); });
    return () => { alive = false; };
  }, [rfi.id]);

  const cos = getChangeOrdersForProject(project.id);
  const existingDraft = useMemo(
    () => findScopeDraft(cos, { action: RFI_DRAFT_ACTION, detail: rfi.id }),
    [cos, rfi.id],
  );

  const estimateItems = project.linkedEstimate?.items ?? [];
  const isOwner = isLeakDraftOwner(project, user?.id);
  const blockedReason = estimateItems.length === 0
    ? RFI_SCOPE_NEEDS_ESTIMATE
    : !isOwner ? RFI_SCOPE_OWNER_ONLY : null;

  // A remembered verdict for an older answer is ignored — the answer changed.
  const verdict = stored && stored.answerHash === answerHash ? stored : null;
  const result = live && live.answerHash === answerHash ? live : null;

  const runCheck = useCallback(async () => {
    if (runningRef.current || blockedReason) return;
    // Busy before any await, so a double tap cannot fire a second paid call.
    runningRef.current = true;
    setRun({ kind: 'busy' });
    setDraftError(null);
    try {
      const limit = await checkAILimit(tier, 'fast', 'profitLeak');
      if (!limit.allowed) {
        setRun({ kind: 'limit', message: limit.message ?? 'You have used today’s AI checks on this plan.' });
        return;
      }
      const projectCOs = getChangeOrdersForProject(project.id);
      const scope = buildScopeSummary(project, projectCOs);
      const res = await mageAI({
        prompt: buildRfiScopePrompt(scope, {
          number: rfi.number,
          subject: rfi.subject,
          question: rfi.question ?? '',
          response: rfi.response ?? '',
          linkedDrawing: rfi.linkedDrawing ?? null,
        }),
        tier: 'fast',
        maxTokens: 1200,
        feature: 'profitLeak',
        schemaHint: RFI_SCOPE_SCHEMA_HINT,
        cacheKey: `rfiscope_${rfi.id}_${hashRfiAnswer(rfi)}_${hashLeakText(scope, '', [])}`,
        cacheHours: 720,
      });
      if (!res.success) {
        setRun({ kind: 'failed', error: res.error ?? '' });
        return;
      }
      if (!res.fromCache) void recordAIUsage('fast', 'profitLeak');

      const parsed = parseRfiScopeResult(res.data);
      const index = buildScopeIndex({
        estimateLines: project.linkedEstimate?.items ?? [],
        changeOrders: projectCOs,
        projectId: project.id,
        scopeNotes: [project.scope?.scope, project.scope?.specialRequirements, project.description],
      });
      const items: CheckedItem[] = parsed.map(item => {
        const entry = scopeRateFor(costDb, item.trade, item.unit);
        const rateUsed = entry && entry.suggestedRate > 0 ? entry.suggestedRate : null;
        const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
        const coverage = isInContractScope({ description: item.description }, index);
        return {
          description: item.description,
          quote: item.reportQuote,
          trade: item.trade,
          unit: item.unit,
          quantity,
          rateUsed,
          caption: scopeRateCaption(entry),
          covered: coverage.covered,
          explain: coverage.explain,
        };
      });
      const at = new Date().toISOString();
      const next: LiveResult = {
        answerHash: hashRfiAnswer(rfi),
        at,
        estimateLines: index.counts.estimateLines,
        changeOrders: index.counts.changeOrders,
        items,
      };
      setLive(next);
      // Added scope goes to the CO by default; items that look covered stay
      // out until he moves them in.
      setSelected(items.map(i => !i.covered));
      if (items.length === 0) {
        const v: StoredVerdict = {
          verdict: 'none_found', answerHash: next.answerHash, at,
          estimateLines: next.estimateLines, changeOrders: next.changeOrders,
        };
        setStored(v);
        void writeVerdict(rfi.id, v);
      }
      setRun({ kind: 'idle' });
    } catch (err) {
      setRun({ kind: 'failed', error: err instanceof Error ? err.message : String(err) });
    } finally {
      runningRef.current = false;
    }
  }, [blockedReason, tier, getChangeOrdersForProject, project, rfi, costDb]);

  const markNotAChange = useCallback(async () => {
    const v: StoredVerdict = { verdict: 'not_a_change', answerHash, at: new Date().toISOString() };
    const ok = await writeVerdict(rfi.id, v);
    setStoreError(!ok);
    setStored(v);
    setLive(null);
  }, [answerHash, rfi.id]);

  const chosen = useMemo(
    () => (result ? result.items.filter((_, i) => selected[i]) : []),
    [result, selected],
  );
  const headline = useMemo(() => rfiScopeHeadline(chosen), [chosen]);

  const draftCO = useCallback(async () => {
    if (draftingRef.current || chosen.length === 0) return;
    if (!isLeakDraftOwner(project, user?.id)) { setDraftError(RFI_SCOPE_OWNER_ONLY); return; }
    draftingRef.current = true;
    setDrafting(true);
    setDraftError(null);
    try {
      const co = buildScopeCoDraft({
        project,
        existingCOs: getChangeOrdersForProject(project.id),
        lines: chosen.map(i => ({ name: i.description, quantity: i.quantity, unit: i.unit, unitRate: i.rateUsed })),
        description: `Change from RFI #${rfi.number} response: ${rfi.subject}.`,
        reason: 'Design change from RFI response',
        marker: { action: RFI_DRAFT_ACTION, detail: rfi.id },
        nowISO: new Date().toISOString(),
      });
      const out = await addChangeOrder(co);
      if (out === 'failed') {
        setDraftError('Couldn’t save the draft change order. Nothing was sent. Try again.');
        return;
      }
      router.push({ pathname: '/change-order', params: { projectId: project.id, coId: co.id } });
    } catch {
      setDraftError('Couldn’t save the draft change order. Nothing was sent. Try again.');
    } finally {
      draftingRef.current = false;
      setDrafting(false);
    }
  }, [chosen, project, user?.id, getChangeOrdersForProject, rfi.number, rfi.subject, rfi.id, addChangeOrder, router]);

  // Only a SAVED answer on an answered / closed RFI.
  if (!rfi.response?.trim() || (rfi.status !== 'answered' && rfi.status !== 'closed')) return null;

  const busy = run.kind === 'busy';
  const blockedNote = blockedReason ? <Text style={styles.blocked} testID="rfiscope-blocked">{blockedReason}</Text> : null;
  const runStatus = run.kind === 'limit'
    ? <Text style={styles.warn} testID="rfiscope-limit">{run.message}</Text>
    : run.kind === 'failed'
      ? <Text style={styles.warn} testID="rfiscope-failed">The check failed. Nothing was saved. Try again in a moment.{run.error ? ` ${run.error}` : ''}</Text>
      : null;
  const checkAgain = (
    <Button
      label="Check again"
      variant="secondary"
      size="sm"
      onPress={() => { void runCheck(); }}
      loading={busy}
      disabled={!!blockedReason}
      testID="rfiscope-check-again"
    />
  );

  let body: React.ReactNode;
  if (existingDraft) {
    body = (
      <View style={styles.row}>
        <FileSignature size={16} color={t.text} strokeWidth={1.75} />
        <Text style={[styles.text, styles.flex]}>Drafted CO #{existingDraft.number} from this answer</Text>
        <Button
          label="Open CO"
          variant="secondary"
          size="sm"
          onPress={() => router.push({ pathname: '/change-order', params: { projectId: project.id, coId: existingDraft.id } })}
          testID="rfiscope-open-co"
        />
      </View>
    );
  } else if (result && result.items.length > 0) {
    const adds = result.items.map((it, i) => ({ it, i })).filter(x => !x.it.covered);
    const covered = result.items.map((it, i) => ({ it, i })).filter(x => x.it.covered);
    const renderItem = ({ it, i }: { it: CheckedItem; i: number }) => {
      const on = !!selected[i];
      const lineCents = it.rateUsed != null ? Math.round(it.quantity * toCents(it.rateUsed)) : null;
      return (
        <View key={i} style={styles.item} testID={`rfiscope-item-${i}`}>
          <Text style={styles.itemDesc}>{it.description}</Text>
          {it.quote ? <Text style={styles.quote}>“{it.quote}”</Text> : null}
          <Text style={styles.meta}>
            {it.quantity} {it.unit} · {lineCents != null ? `${centsText(lineCents)} · ${it.caption}` : it.caption}
          </Text>
          {it.covered && it.explain ? <Text style={styles.meta}>{it.explain}</Text> : null}
          <TouchableOpacity
            onPress={() => setSelected(prev => { const next = [...prev]; next[i] = !on; return next; })}
            style={[styles.toggle, on && styles.toggleOn]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            testID={`rfiscope-toggle-${i}`}
          >
            <Text style={styles.toggleText}>
              {it.covered ? (on ? 'On the CO — tap to keep it out' : 'Move to the CO') : (on ? 'On the CO — tap to leave out' : 'Leave off the CO — tap to add')}
            </Text>
          </TouchableOpacity>
        </View>
      );
    };
    body = (
      <>
        <View style={styles.row}>
          <AlertTriangle size={16} color={t.warningLabel} strokeWidth={1.75} />
          <Text style={[styles.headline, styles.flex]} testID="rfiscope-headline">
            {chosen.length > 0 ? headline.text : 'No items picked for a change order.'}
          </Text>
        </View>
        {adds.length > 0 ? (
          <View style={styles.group}>
            <Text style={styles.groupLabel}>Adds scope</Text>
            {adds.map(renderItem)}
          </View>
        ) : null}
        {covered.length > 0 ? (
          <View style={styles.group}>
            <Text style={styles.groupLabel}>Looks already in your scope</Text>
            {covered.map(renderItem)}
          </View>
        ) : null}
        <Text style={styles.meta}>
          Compared with {result.estimateLines} estimate line(s) and {result.changeOrders} change order(s). Checked {dayLabel(result.at)}. Nothing is sent: the change order opens as a draft for you to price and send.
        </Text>
        <View style={styles.actions}>
          <Button
            label="Draft CO"
            onPress={() => { void draftCO(); }}
            loading={drafting}
            disabled={chosen.length === 0 || !isOwner}
            testID="rfiscope-draft"
          />
          <Button
            label="Not a change"
            variant="secondary"
            onPress={() => { void markNotAChange(); }}
            disabled={drafting}
            testID="rfiscope-not-change"
          />
        </View>
        {chosen.length === 0 ? <Text style={styles.blocked}>Pick at least one item to draft a change order.</Text> : null}
        {!isOwner ? <Text style={styles.blocked}>{RFI_SCOPE_OWNER_ONLY}</Text> : null}
        {draftError ? <Text style={styles.warn} testID="rfiscope-draft-error">{draftError}</Text> : null}
      </>
    );
  } else if (result || verdict?.verdict === 'none_found') {
    const n = result ? result.estimateLines : verdict?.estimateLines;
    const m = result ? result.changeOrders : verdict?.changeOrders;
    const at = result ? result.at : verdict!.at;
    body = (
      <>
        <View style={styles.row}>
          <CheckCircle2 size={16} color={t.success} strokeWidth={1.75} />
          <Text style={[styles.text, styles.flex]} testID="rfiscope-none">
            Nothing in this answer reads as added scope. Compared with {n ?? 0} estimate line(s) and {m ?? 0} change order(s). Checked {dayLabel(at)}.
          </Text>
        </View>
        <View style={styles.actions}>{checkAgain}</View>
        {blockedNote}
      </>
    );
  } else if (verdict?.verdict === 'not_a_change') {
    body = (
      <>
        <Text style={styles.text} testID="rfiscope-not-change-note">
          Marked not a change on {dayLabel(verdict.at)} (kept on this device until you sign out)
        </Text>
        {storeError ? <Text style={styles.warn}>Couldn’t save that mark on this device, so it will not be remembered.</Text> : null}
        <View style={styles.actions}>{checkAgain}</View>
        {blockedNote}
      </>
    );
  } else {
    body = (
      <>
        <Text style={styles.text}>Did this answer add work? MAGE compares it with your estimate lines and change orders.</Text>
        <View style={styles.actions}>
          <Button
            label="Check the answer"
            onPress={() => { void runCheck(); }}
            loading={busy}
            disabled={!!blockedReason}
            testID="rfiscope-check"
          />
        </View>
        {blockedNote}
      </>
    );
  }

  return (
    <View testID="rfiscope-card" style={styles.wrap}>
      <Card pad={Tokens.spacing.md}>
        <Card.Title>Scope check</Card.Title>
        <View style={styles.body}>
          {body}
          {existingDraft ? null : runStatus}
        </View>
      </Card>
    </View>
  );
}

export default RfiScopeCheckCard;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { marginBottom: 12 },
  body: { marginTop: 8, gap: 8 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  text: { ...Type.subhead, color: t.text },
  headline: { ...Type.subheadEmphasized, color: t.text },
  meta: { ...Type.footnote, color: t.textMuted },
  blocked: { ...Type.footnote, color: t.textMuted },
  warn: { ...Type.footnote, color: t.dangerLabel },
  group: { gap: 8, marginTop: 4 },
  groupLabel: { ...Type.footnoteEmphasized, color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  item: { gap: 3, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
  itemDesc: { ...Type.subheadEmphasized, color: t.text },
  quote: { ...Type.footnote, color: t.textSecondary, fontStyle: 'italic' },
  toggle: {
    alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.sm, borderWidth: 1, borderColor: t.line,
  },
  toggleOn: { borderColor: t.text },
  toggleText: { ...Type.footnoteEmphasized, color: t.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
});
