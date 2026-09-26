// components/scopeGaps/ScopeGapsCard.tsx — "Code items your scope usually
// triggers": the Scope Code Gaps card.
//
// It runs the hand-written STARTER rule table (utils/codeScopeTriggers) over
// the job's scope and shows the items that such scope usually needs and that
// are not in the estimate or a captured change order — each priced at HIS
// rate through the one pricing path (hooks/useScopeCostBook +
// utils/scopePricing.scopeRateFor), never at an invented one.
//
// HONESTY
//   • The table ships labelled "not yet reviewed by you" (SCOPE_GAPS_STARTER_LABEL)
//     until the founder signs off the rule sheet. Family-level only, never a
//     code section; his AHJ decides.
//   • No quantity is invented: a rule without a starter quantity asks for one,
//     and nothing is added or drafted until it has one.
//   • Nothing is sent. "Add to change-order draft" creates a DRAFT he opens,
//     prices and sends himself. Its client-facing description carries no code
//     claim; the rule's rationale lives only in an internal audit entry.
//   • Already covered / N/A marks live on this device only (AsyncStorage key
//     mageid_scope_gaps, swept at sign-out) and the card says so.
//
// Two modes (C4): 'project' derives everything from the project; 'cart' is the
// project-less estimator review screen with a remembered Home/Commercial toggle.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ChevronDown, ChevronRight, ListChecks } from 'lucide-react-native';
import { Button, Card, SegmentedControl } from '@/components/ui';
import { routeHref } from '@/components/desktop/RowLink';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useScopeCostBook } from '@/hooks/useScopeCostBook';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatMoney } from '@/utils/formatters';
import { groundingFactsFor, jobsiteAddressForProject } from '@/utils/codeJurisdiction';
import type { ScopeLine } from '@/utils/scopeCoverage';
import { scopeRateFor } from '@/utils/scopePricing';
import {
  evaluateScopeGaps, scopeGapUnitWord, type PricedScopeGap, type ScopeGapDismissals,
} from '@/utils/scopeGaps';
import {
  CODE_SCOPE_RULES, CODE_SCOPE_RULES_REVIEW, SCOPE_GAPS_STARTER_LABEL, type CodeScopeRule,
} from '@/utils/codeScopeTriggers';
import { buildScopeCoDraft, findScopeDraft, CODE_GAP_DRAFT_ACTION } from '@/utils/brain/scopeCoDraft';
import { isLeakDraftOwner } from '@/utils/brain/leakCoDraft';

export type ScopeGapsCardProps =
  | { mode: 'project'; projectId: string; testID?: string }
  | { mode: 'cart'; lines: readonly ScopeLine[]; storageKey: string; onAddLine?: (gap: PricedScopeGap) => boolean; testID?: string };

type JobKind = 'residential' | 'commercial';
interface StoredEntry { dismissals: ScopeGapDismissals; jobKind?: JobKind }

export const SCOPE_GAPS_STORAGE_KEY = 'mageid_scope_gaps';
const DEVICE_NOTE = 'Your Already covered / N/A marks are kept on this device until you sign out.';
const CART_NOTE = "Not linked to a job, so there is no location: editions and state rules aren't checked. Home rules shown; switch to Commercial for commercial rules.";
const EMPTY_TEXT = 'No items from the starter list fired for this scope. This is not a code check.';

async function readAll(): Promise<Record<string, StoredEntry>> {
  try {
    const raw = await AsyncStorage.getItem(SCOPE_GAPS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as Record<string, StoredEntry> : {};
  } catch {
    return {};
  }
}

async function writeEntry(storageKey: string, entry: StoredEntry): Promise<void> {
  try {
    const all = await readAll();
    all[storageKey] = entry;
    await AsyncStorage.setItem(SCOPE_GAPS_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // The mark still holds for this session; a failed write only means it is not remembered.
  }
}

const money = (dollars: number) => formatMoney(dollars, 2);
const s = (n: number) => (n === 1 ? '' : 's');

export function ScopeGapsCard(props: ScopeGapsCardProps): React.ReactElement | null {
  const styles = useThemedStyles(makeStyles);
  const { colors: t } = useTheme();
  const router = useRouter();
  const costDb = useScopeCostBook();
  const { getProject, getChangeOrdersForProject, addChangeOrder } = useProjects();
  const { user } = useAuth();

  const projectId = props.mode === 'project' ? props.projectId : null;
  const project = projectId ? getProject(projectId) : null;
  const storageKey = props.mode === 'project' ? `project:${props.projectId}` : props.storageKey;

  // ── remembered marks (device only) ──
  const [dismissals, setDismissals] = useState<ScopeGapDismissals>({});
  const [cartJobKind, setCartJobKind] = useState<JobKind>('residential');
  useEffect(() => {
    let alive = true;
    void readAll().then(all => {
      if (!alive) return;
      const e = all[storageKey];
      setDismissals(e?.dismissals && typeof e.dismissals === 'object' ? e.dismissals : {});
      if (e?.jobKind === 'commercial' || e?.jobKind === 'residential') setCartJobKind(e.jobKind);
    });
    return () => { alive = false; };
  }, [storageKey]);

  const persist = useCallback((next: ScopeGapDismissals, jobKind: JobKind) => {
    void writeEntry(storageKey, props.mode === 'cart' ? { dismissals: next, jobKind } : { dismissals: next });
  }, [storageKey, props.mode]);

  // ── quantities (component state only, never persisted) ──
  const [qtyText, setQtyText] = useState<Record<string, string>>({});
  const quantities = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, txt] of Object.entries(qtyText)) {
      const n = Number(txt);
      if (txt.trim() !== '' && Number.isFinite(n) && n > 0) out[id] = n;
    }
    return out;
  }, [qtyText]);
  // A starter quantity he has cleared or made invalid is no quantity at all —
  // the engine must not fall back to the starter guess behind his back.
  const rules = useMemo<readonly CodeScopeRule[]>(() => CODE_SCOPE_RULES.map(r => {
    const txt = qtyText[r.id];
    return txt !== undefined && quantities[r.id] === undefined ? { ...r, price: { ...r.price, qty: null } } : r;
  }), [qtyText, quantities]);

  // ── inputs ──
  const cartLines = props.mode === 'cart' ? props.lines : null;
  const projectItems = project?.linkedEstimate?.items;
  const lines = useMemo<readonly ScopeLine[]>(
    () => cartLines ?? projectItems ?? [],
    [cartLines, projectItems],
  );
  const scopeNotes = useMemo(
    () => (project ? [project.scope?.scope, project.scope?.specialRequirements, project.description] : []),
    [project],
  );
  const changeOrders = useMemo(
    () => (projectId ? getChangeOrdersForProject(projectId) : []),
    [projectId, getChangeOrdersForProject],
  );
  const address = useMemo(() => {
    if (!project) return null;
    const a = jobsiteAddressForProject(project);
    return { city: a.city, county: a.county, state: a.state };
  }, [project]);
  const jobKind: JobKind = props.mode === 'project'
    ? (project?.type === 'commercial' ? 'commercial' : 'residential')
    : cartJobKind;
  const contracted = !!project && (project.status === 'in_progress' || project.status === 'completed');

  const result = useMemo(() => evaluateScopeGaps({
    lines, scopeNotes, jobKind,
    projectType: project?.type ?? null,
    address, changeOrders, projectId: projectId ?? undefined,
    costDb, dismissals, quantities, rules, rateFor: scopeRateFor,
  }), [lines, scopeNotes, jobKind, project?.type, address, changeOrders, projectId, costDb, dismissals, quantities, rules]);

  // ── actions ──
  const [openGroup, setOpenGroup] = useState<'in' | 'off' | 'mine' | null>(null);
  const [rowMsg, setRowMsg] = useState<Record<string, string>>({});
  const [added, setAdded] = useState<Record<string, true>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef(false);

  const mark = useCallback((ruleId: string, verdict: 'already_covered' | 'n_a' | null) => {
    const next = { ...dismissals };
    if (verdict) next[ruleId] = { verdict, at: new Date().toISOString() };
    else delete next[ruleId];
    setDismissals(next);
    persist(next, cartJobKind);
  }, [dismissals, persist, cartJobKind]);

  const switchJobKind = useCallback((k: JobKind) => {
    setCartJobKind(k);
    persist(dismissals, k);
  }, [persist, dismissals]);

  const draftCo = useCallback(async (gap: PricedScopeGap) => {
    if (!project || !projectId || busyRef.current || gap.quantity == null) return;
    busyRef.current = true;
    setBusyId(gap.rule.id);
    try {
      const rule = gap.rule;
      const nowISO = new Date().toISOString();
      const co = buildScopeCoDraft({
        project,
        existingCOs: changeOrders,
        lines: [{ name: rule.topic, quantity: gap.quantity, unit: rule.price.unit, unitRate: gap.unitRate }],
        description: `Added scope: ${rule.topic}.`,
        reason: 'Added scope',
        marker: { action: CODE_GAP_DRAFT_ACTION, detail: `${projectId}:${rule.id}` },
        internalNote: `Scope Code Gaps starter rule ${rule.id} (${rule.family}: ${rule.topic}), not yet reviewed by the founder. Triggered by ${gap.triggeredBy}.`,
        nowISO,
      });
      const out = await addChangeOrder(co);
      if (out === 'failed') {
        setRowMsg(m => ({ ...m, [rule.id]: 'Couldn’t save the draft change order. Nothing was sent. Try again.' }));
        return;
      }
      router.push({ pathname: '/change-order', params: { projectId, coId: co.id } });
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }, [project, projectId, changeOrders, addChangeOrder, router]);

  if (props.mode === 'project') {
    if (!project) return null;
    const hasNotes = scopeNotes.some(n => (n ?? '').trim() !== '');
    if (lines.length === 0 && !hasNotes) return null;
  }

  const gaps = result.gaps.filter(g => g.state === 'gap');
  const inScope = result.gaps.filter(g => g.state === 'in_scope');
  const suppressed = result.gaps.filter(g => g.state === 'suppressed');
  const mine = result.gaps.filter(g => g.state === 'already_covered' || g.state === 'n_a');
  const grounding = groundingFactsFor(result.resolved);
  const chip = grounding.grounded ? grounding.chipLabel : 'Edition unknown — confirm with your AHJ.';
  const subLabel = CODE_SCOPE_RULES_REVIEW.status === 'founder_reviewed'
    ? `Reviewed ${CODE_SCOPE_RULES_REVIEW.reviewedOn}. Family-level, never a code section. Your AHJ decides.`
    : SCOPE_GAPS_STARTER_LABEL;
  const n = gaps.length;

  const renderAction = (gap: PricedScopeGap) => {
    const rule = gap.rule;
    const unitWord = scopeGapUnitWord(rule.price.unit);
    if (props.mode === 'cart') {
      if (added[rule.id]) return <Text style={styles.okText}>Added to this estimate.</Text>;
      const reason = !gap.priced
        ? 'No price of yours yet — add it in the estimator with your price.'
        : gap.quantity == null ? `Enter ${unitWord} first.`
          : !props.onAddLine ? 'This screen can’t add lines to an estimate.' : null;
      return (
        <View style={styles.actionBlock}>
          <Button
            label="Add line" size="sm" variant="secondary" disabled={!!reason}
            onPress={() => { if (props.onAddLine?.(gap)) setAdded(a => ({ ...a, [rule.id]: true })); }}
            testID={`scopegaps-add-${rule.id}`}
          />
          {reason ? <Text style={styles.reason}>{reason}</Text> : null}
        </View>
      );
    }
    if (!contracted) {
      return (
        <View style={styles.actionBlock}>
          <Button
            label="Open the estimator" size="sm" variant="secondary"
            onPress={() => router.replace(routeHref('/(tabs)/estimate/full', { projectId: projectId! }))}
            testID={`scopegaps-estimator-${rule.id}`}
          />
        </View>
      );
    }
    const existing = findScopeDraft(changeOrders, { action: CODE_GAP_DRAFT_ACTION, detail: `${projectId}:${rule.id}` });
    if (existing) {
      return (
        <View style={styles.inlineRow}>
          <Text style={styles.okText}>{`In CO #${existing.number}`}</Text>
          <Button
            label="Open" size="sm" variant="ghost"
            onPress={() => router.push({ pathname: '/change-order', params: { projectId: projectId!, coId: existing.id } })}
            testID={`scopegaps-open-${rule.id}`}
          />
        </View>
      );
    }
    const owner = isLeakDraftOwner(project!, user?.id);
    const reason = !owner
      ? 'Only the project owner drafts change orders.'
      : gap.quantity == null ? `Enter ${unitWord} first.` : null;
    return (
      <View style={styles.actionBlock}>
        <Button
          label="Add to change-order draft" size="sm" variant="secondary"
          disabled={!!reason || busyId !== null} loading={busyId === rule.id}
          onPress={() => { void draftCo(gap); }}
          testID={`scopegaps-draft-${rule.id}`}
        />
        {reason ? <Text style={styles.reason}>{reason}</Text> : null}
        {!reason && !gap.priced ? <Text style={styles.reason}>Drafts at $0 — price it on the change order.</Text> : null}
        {rowMsg[rule.id] ? <Text style={styles.errorText}>{rowMsg[rule.id]}</Text> : null}
      </View>
    );
  };

  const renderGap = (gap: PricedScopeGap) => {
    const rule = gap.rule;
    const txt = qtyText[rule.id];
    const shown = txt !== undefined ? txt : rule.price.qty != null ? String(rule.price.qty) : '';
    const starter = txt === undefined && rule.price.qty != null;
    const priceLine = !gap.priced
      ? 'No price of yours yet'
      : gap.totalCents != null
        ? `Your price: ${money(gap.totalCents / 100)} · ${gap.rateCaption}`
        : `${money(gap.unitRate ?? 0)} per ${rule.price.unit} · ${gap.rateCaption} · enter a quantity`;
    return (
      <View key={rule.id} style={styles.row} testID={`scopegaps-row-${rule.id}`}>
        <Text style={styles.requires}>{rule.requires}</Text>
        <Text style={styles.meta}>{`Why: ${gap.triggeredBy} → ${rule.family}: ${rule.topic}`}</Text>
        {gap.jurisdictionNote ? <Text style={styles.meta}>{gap.jurisdictionNote}</Text> : null}
        <View style={styles.inlineRow}>
          <TextInput
            value={shown}
            onChangeText={v => setQtyText(q => ({ ...q, [rule.id]: v.replace(/[^0-9.]/g, '') }))}
            keyboardType="decimal-pad"
            placeholder="Qty"
            placeholderTextColor={t.textMuted}
            style={styles.qtyInput}
            accessibilityLabel={`Quantity for ${rule.topic}, ${rule.price.unit}`}
            testID={`scopegaps-qty-${rule.id}`}
          />
          <Text style={styles.meta}>{rule.price.unit}</Text>
          {starter ? <Text style={styles.meta}>starter guess — change it</Text> : null}
        </View>
        <Text style={styles.price}>{priceLine}</Text>
        {renderAction(gap)}
        <View style={styles.inlineRow}>
          <Button label="Already covered" size="sm" variant="ghost" onPress={() => mark(rule.id, 'already_covered')} testID={`scopegaps-covered-${rule.id}`} />
          <Button label="N/A" size="sm" variant="ghost" onPress={() => mark(rule.id, 'n_a')} testID={`scopegaps-na-${rule.id}`} />
        </View>
      </View>
    );
  };

  const group = (key: 'in' | 'off' | 'mine', label: string, items: PricedScopeGap[], detail: (g: PricedScopeGap) => string, undo?: boolean) => {
    if (items.length === 0) return null;
    const open = openGroup === key;
    const Icon = open ? ChevronDown : ChevronRight;
    return (
      <View style={styles.group}>
        <TouchableOpacity
          onPress={() => setOpenGroup(open ? null : key)}
          style={styles.inlineRow}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          testID={`scopegaps-group-${key}`}
        >
          <Icon size={16} color={t.textSecondary} />
          <Text style={styles.groupLabel}>{label}</Text>
        </TouchableOpacity>
        {open ? items.map(g => (
          <View key={g.rule.id} style={styles.groupItem}>
            <Text style={styles.meta}>{`${g.rule.family}: ${g.rule.topic} — ${detail(g)}`}</Text>
            {undo ? <Button label="Undo" size="sm" variant="ghost" onPress={() => mark(g.rule.id, null)} testID={`scopegaps-undo-${g.rule.id}`} /> : null}
          </View>
        )) : null}
      </View>
    );
  };

  return (
    <View testID={props.testID ?? 'scopegaps-card'} style={styles.root}>
      <Card>
        <View style={styles.inlineRow}>
          <ListChecks size={18} color={t.textSecondary} />
          <Text style={styles.cardHeading}>Code items your scope usually triggers</Text>
        </View>
        <Text style={styles.meta}>{subLabel}</Text>
        <Text style={styles.chip}>{chip}</Text>

        {props.mode === 'cart' ? (
          <View style={styles.toggleBlock}>
            <SegmentedControl<JobKind>
              options={[{ value: 'residential', label: 'Home job' }, { value: 'commercial', label: 'Commercial job' }]}
              value={cartJobKind}
              onChange={switchJobKind}
              size="sm"
              accessibilityLabel="Job kind"
              testID="scopegaps-jobkind"
            />
            <Text style={styles.meta}>{CART_NOTE}</Text>
          </View>
        ) : null}

        {result.gaps.length === 0 ? (
          <Text style={styles.body}>{EMPTY_TEXT}</Text>
        ) : (
          <>
            <Text style={styles.body}>{`${n} item${s(n)} your scope usually triggers ${n === 1 ? 'is' : 'are'} not in this estimate.`}</Text>
            {gaps.map(renderGap)}
            {group('in', `${inScope.length} already in your estimate`, inScope, g => g.coverage.explain)}
            {group('off', `${suppressed.length} rule${s(suppressed.length)} don't apply here`, suppressed, g => g.suppressedReason ?? '')}
            {group('mine', `${mine.length} marked by you`, mine, g => (g.state === 'n_a' ? 'N/A' : 'Already covered'), true)}
            {result.totalCents > 0 || result.needsPriceCount > 0 ? (
              <Text style={styles.footer}>
                {[
                  result.totalCents > 0 ? `+${money(result.totalCents / 100)} you'd otherwise eat` : null,
                  result.needsPriceCount > 0 ? `${result.needsPriceCount} item${s(result.needsPriceCount)} need a price or a quantity` : null,
                ].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
            <Text style={styles.meta}>{DEVICE_NOTE}</Text>
          </>
        )}
      </Card>
    </View>
  );
}

export default ScopeGapsCard;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { marginVertical: Tokens.spacing.xs },
  cardHeading: { ...Type.headline, color: t.text, flexShrink: 1 },
  body: { ...Type.subhead, color: t.text, marginTop: Tokens.spacing.xs },
  meta: { ...Type.footnote, color: t.textSecondary, marginTop: Tokens.spacing.xxs, flexShrink: 1 },
  chip: {
    ...Type.caption1, color: t.textSecondary, backgroundColor: t.neutralSoft,
    paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs,
    borderRadius: Tokens.radius.xs, marginTop: Tokens.spacing.xs, alignSelf: 'flex-start',
  },
  toggleBlock: { marginTop: Tokens.spacing.sm },
  row: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line,
    marginTop: Tokens.spacing.sm, paddingTop: Tokens.spacing.sm,
  },
  requires: { ...Type.subheadEmphasized, color: t.text },
  inlineRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
  qtyInput: {
    ...Type.subhead, color: t.text, minWidth: 72,
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.sm,
    paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs,
  },
  price: { ...Type.subhead, color: t.text, marginTop: Tokens.spacing.xxs },
  actionBlock: { marginTop: Tokens.spacing.xs, alignItems: 'flex-start' },
  reason: { ...Type.footnote, color: t.textSecondary, marginTop: Tokens.spacing.xxs },
  okText: { ...Type.footnoteEmphasized, color: t.successLabel },
  errorText: { ...Type.footnote, color: t.dangerLabel, marginTop: Tokens.spacing.xxs },
  group: { marginTop: Tokens.spacing.sm },
  groupLabel: { ...Type.subheadEmphasized, color: t.textSecondary },
  groupItem: { marginLeft: Tokens.spacing.md, marginTop: Tokens.spacing.xxs },
  footer: { ...Type.subheadEmphasized, color: t.text, marginTop: Tokens.spacing.sm },
});
