// utils/scopeGaps.ts — Scope Code Gaps engine.
//
// For each starter rule (utils/codeScopeTriggers) that the job's scope fires,
// decide: is the item already in scope (utils/scopeCoverage), does it apply at
// this jobsite (utils/codeJurisdiction), and what would it cost at HIS rate
// (utils/scopePricing — the one pricing path)? Nothing here invents a
// quantity: a rule with no starter quantity and none typed is "needs a
// quantity", priced at nothing, and kept out of the total.
//
// Money in integer cents: a gap's total is quantity × (unit rate in cents),
// rounded once — exactly what utils/brain/scopeCoDraft puts on the CO line, so
// the card and the change order reconcile to the cent.
//
// Pure — no React, no storage, no network.
import type { ChangeOrder, ProjectType } from '@/types';
import type { CostDatabase } from '@/utils/costDatabase';
import {
  normalizeState, resolveCodeJurisdiction, type ResolvedCodeJurisdiction,
} from '@/utils/codeJurisdiction';
import {
  buildScopeIndex, isInContractScope, normalizeScopeText, phraseInNorm,
  type CoverageResult, type ScopeLine,
} from '@/utils/scopeCoverage';
import { scopeRateCaption, scopeRateFor } from '@/utils/scopePricing';
import { toCents } from '@/utils/brain/scopeCoDraft';
import { CODE_SCOPE_RULES, type CodeScopeRule } from '@/utils/codeScopeTriggers';

export type GapState = 'gap' | 'in_scope' | 'already_covered' | 'n_a' | 'suppressed';

export interface PricedScopeGap {
  rule: CodeScopeRule;
  state: GapState;
  triggeredBy: string;
  coverage: CoverageResult;
  jurisdictionNote: string | null;
  suppressedReason: string | null;
  priced: boolean;
  unitRate: number | null;
  quantity: number | null;
  needsQuantity: boolean;
  totalCents: number | null;
  rateCaption: string;
}

export type ScopeGapDismissals = Record<string, { verdict: 'already_covered' | 'n_a'; at: string }>;

export interface ScopeGapsInput {
  lines: readonly ScopeLine[];
  scopeNotes?: readonly (string | null | undefined)[];
  jobKind: 'residential' | 'commercial';
  projectType?: ProjectType | null;
  address?: { city?: string; county?: string; state?: string } | null;
  changeOrders?: readonly ChangeOrder[];
  projectId?: string;
  costDb: CostDatabase;
  dismissals?: ScopeGapDismissals;
  quantities?: Record<string, number>;
  /** Test seam: defaults to the shipped starter table. */
  rules?: readonly CodeScopeRule[];
  /** The one pricing path; defaults to utils/scopePricing.scopeRateFor. The
   *  card passes it explicitly so the shared path is visible at the call site. */
  rateFor?: typeof scopeRateFor;
}

export interface ScopeGapsResult {
  gaps: PricedScopeGap[];
  totalCents: number;
  needsPriceCount: number;
  resolved: ResolvedCodeJurisdiction;
}

/** The words a message uses to ask for a quantity in this unit. */
export function scopeGapUnitWord(unit: string): string {
  switch ((unit || '').toLowerCase()) {
    case 'ea': return 'how many';
    case 'lf': return 'how many linear feet';
    case 'sf': return 'how many square feet';
    default: return 'the quantity';
  }
}

export const NO_STATE_NOTE = 'Depends on your location — no state on file';
export const NO_NEC_NOTE = 'Depends on your NEC edition — not on file for this jurisdiction';

function yearOf(edition: string | undefined): number | null {
  const m = /(19|20)\d{2}/.exec(edition ?? '');
  return m ? Number(m[0]) : null;
}

export function evaluateScopeGaps(input: ScopeGapsInput): ScopeGapsResult {
  const rules = input.rules ?? CODE_SCOPE_RULES;
  const resolved = resolveCodeJurisdiction(input.address ?? {});
  const state = normalizeState(input.address?.state) || null;
  const known = resolved.kind !== 'unknown' ? resolved : null;
  const adopted = known ? known.entry.codes : [];
  const authority = known ? known.entry.authorityName : null;

  // Trigger text: each estimate line and each scope note.
  const triggerSources: { label: string; norm: string }[] = [];
  input.lines.forEach((l, i) => {
    const name = (l?.name ?? '').trim();
    const norm = normalizeScopeText(`${name} ${l?.category ?? ''}`);
    if (norm) triggerSources.push({ label: `line ${i + 1} "${name}"`, norm });
  });
  for (const n of input.scopeNotes ?? []) {
    const norm = normalizeScopeText(n ?? '');
    if (norm) triggerSources.push({ label: 'your scope notes', norm });
  }

  const index = buildScopeIndex({
    estimateLines: input.lines,
    changeOrders: input.changeOrders,
    projectId: input.projectId,
    scopeNotes: input.scopeNotes,
  });

  const gaps: PricedScopeGap[] = [];
  let totalCents = 0;
  let needsPriceCount = 0;

  for (const rule of rules) {
    if (rule.projects === 'res' && input.jobKind !== 'residential') continue;
    if (rule.projects === 'com' && input.jobKind !== 'commercial') continue;

    const hit = triggerSources.find(s =>
      !(rule.excludeLinePhrases ?? []).some(x => phraseInNorm(s.norm, x))
      && rule.triggers.some(t => phraseInNorm(s.norm, t)));
    const byType = !!input.projectType && (rule.projectTypes ?? []).includes(input.projectType);
    if (!hit && !byType) continue;
    const triggeredBy = hit ? hit.label : 'your project type';

    // Jurisdiction.
    let suppressedReason: string | null = null;
    let jurisdictionNote: string | null = null;
    if (rule.onlyStates) {
      if (state && !rule.onlyStates.includes(state)) suppressedReason = `doesn't usually apply in ${state}`;
      else if (!state) jurisdictionNote = NO_STATE_NOTE;
    }
    if (!suppressedReason && rule.editionGate) {
      const row = adopted.find(c => c.family === rule.editionGate!.family);
      const year = row ? yearOf(row.edition) : null;
      if (year == null) jurisdictionNote = jurisdictionNote ?? NO_NEC_NOTE;
      else if (year < rule.editionGate.minYear) suppressedReason = `your adopted NEC ${year} predates this`;
    }
    if (!suppressedReason && !jurisdictionNote && known && !adopted.some(c => c.family === rule.family)) {
      jurisdictionNote = `${authority}'s adoption record doesn't list the ${rule.family}; its own code has its own version of this — confirm with your AHJ`;
    }

    // Coverage (a remembered dismissal overrides it).
    const coverage = isInContractScope({ phrases: rule.coveredBy }, index);
    let gapState: GapState = coverage.covered ? 'in_scope' : 'gap';
    const dismissed = input.dismissals?.[rule.id];
    if (dismissed && (dismissed.verdict === 'already_covered' || dismissed.verdict === 'n_a')) gapState = dismissed.verdict;
    if (suppressedReason) gapState = 'suppressed';

    // Quantity — his, or the rule's starter guess; never invented.
    const typed = input.quantities?.[rule.id];
    const quantity = typeof typed === 'number' && Number.isFinite(typed) && typed > 0 ? typed : rule.price.qty;
    const needsQuantity = quantity == null;

    // Price — the one pricing path.
    const entry = (input.rateFor ?? scopeRateFor)(input.costDb, rule.price.trade, rule.price.unit);
    const priced = !!entry && entry.suggestedRate > 0;
    const unitRate = priced ? entry!.suggestedRate : null;
    const rowCents = priced && quantity != null ? Math.round(quantity * toCents(unitRate!)) : null;

    if (gapState === 'gap') {
      if (rowCents != null) totalCents += rowCents;
      if (!priced || quantity == null) needsPriceCount += 1;
    }

    gaps.push({
      rule, state: gapState, triggeredBy, coverage, jurisdictionNote, suppressedReason,
      priced, unitRate, quantity, needsQuantity, totalCents: rowCents, rateCaption: scopeRateCaption(entry),
    });
  }

  return { gaps, totalCents, needsPriceCount, resolved };
}
