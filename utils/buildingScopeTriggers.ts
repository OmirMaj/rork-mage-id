// utils/buildingScopeTriggers.ts — "The Building Prices Itself" (Bet 1), first
// slice: two rules that read the building's AGE and the job's scope.
//
//   RRP   Lead-safe setup (EPA RRP): a residential job, built before 1978, and
//         the scope touches paint, demolition, drywall, windows or doors.
//   ACP5  Asbestos survey (NYC ACP-5): an NYC jobsite, built before 1987 (1987
//         itself fires with the April-1 line; 1988 and later never fire).
//
// HONESTY (scripts/validate-building-scope-triggers.ts):
//   • No year → nothing fires. A PLUTO 0 is "unknown", never a year.
//   • Pricing goes ONLY through utils/scopePricing.scopeRateFor. No rate of his
//     → "Needs price" (priced:false, total null, kept out of the total). This
//     file holds no dollar amount.
//   • The lines are reminders to check. Nothing here says the building has
//     lead paint or asbestos; each result carries the source of its year as a
//     chip ("PLUTO lists built 1931" / "You entered 1955").
//
// Its own family type: validate-code-scope-triggers pins the nine model-code
// families on utils/codeScopeTriggers, so these two never join that table.
//
// Pure — no React, no storage, no network, no clock (the current year is
// passed in).
import type { ChangeOrder, ProjectType } from '@/types';
import type { CostDatabase } from '@/utils/costDatabase';
import {
  buildScopeIndex, isInContractScope, normalizeScopeText, phraseInNorm,
  type CoverageResult, type ScopeLine,
} from '@/utils/scopeCoverage';
import { scopeRateCaption, scopeRateFor } from '@/utils/scopePricing';
import { toCents } from '@/utils/brain/scopeCoDraft';
import { isNycJobsite } from '@/utils/buildingRecord';
import { MAX_SEED_RATE, canonicalSeedUnit, type SeededRateDraft } from '@/utils/costSeedCore';
import {
  ACP5_BOOK_TRADE, ACP5_REQUIRES, ACP5_TOPIC, PLUTO_FOOTER, RRP_BOOK_TRADE, RRP_EXEMPTION, RRP_REQUIRES,
  RRP_TOPIC, acp5Why, bothChip, enteredChip, plutoChip, rrpWhy,
} from '@/utils/buildingScopeCopy';

export type BuildingRuleFamily = 'EPA' | 'NYC-DOB';

export interface BuildingYear {
  year: number;
  source: 'pluto' | 'entered';
  /** PLUTO version (or the record's as-of day) for 'pluto'; the entered-on day for 'entered'. */
  asOf: string | null;
}

export interface BuildingScopeRule {
  id: 'rrp' | 'acp5';
  family: BuildingRuleFamily;
  /** The line name on a change order. */
  topic: string;
  requires: string;
  /** Scope phrases that fire the rule. Empty = the rule does not need a scope phrase (ACP-5). */
  triggers: string[];
  coveredBy: string[];
  price: { trade: string; unit: 'ea'; qty: 1 };
}

/** The scope words that make the building's age matter for lead-safe work. */
export const BUILDING_TRIGGER_PHRASES: readonly string[] = [
  'paint', 'painting', 'demo', 'demolition', 'drywall', 'sheetrock', 'window', 'windows',
  'door', 'doors', 'sanding', 'plaster', 'trim',
];

export const BUILDING_SCOPE_RULES: readonly BuildingScopeRule[] = [
  {
    id: 'rrp', family: 'EPA', topic: RRP_TOPIC, requires: RRP_REQUIRES,
    triggers: [...BUILDING_TRIGGER_PHRASES],
    coveredBy: ['lead-safe', 'lead safe', 'rrp', 'lead abatement'],
    price: { trade: RRP_BOOK_TRADE, unit: 'ea', qty: 1 },
  },
  {
    id: 'acp5', family: 'NYC-DOB', topic: ACP5_TOPIC, requires: ACP5_REQUIRES,
    triggers: [],
    coveredBy: ['acp-5', 'acp5', 'asbestos survey', 'asbestos investigation'],
    price: { trade: ACP5_BOOK_TRADE, unit: 'ea', qty: 1 },
  },
];

export const RRP_CUTOFF_YEAR = 1978; // built BEFORE this year
export const ACP5_LAST_YEAR = 1987; // 1987 fires with the April-1 line; after it, never

/** A whole year between 1600 and `currentYear`, else null. PLUTO's 0 (unknown) → null. */
export function normalizeYearBuilt(v: unknown, currentYear: number): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < 1600 || n > currentYear) return null;
  return n;
}

/** The source chip: which year the rules used, and where it came from. */
export function buildingYearChip(year: BuildingYear, pluto?: BuildingYear | null): string {
  if (year.source === 'entered') {
    return pluto && pluto.source === 'pluto' ? bothChip(year.year, pluto.year) : enteredChip(year.year);
  }
  return plutoChip(year.year);
}

export type BuildingGapState = 'gap' | 'in_scope' | 'already_covered' | 'n_a';

export interface PricedBuildingGap {
  rule: BuildingScopeRule;
  state: BuildingGapState;
  triggeredBy: string;
  coverage: CoverageResult;
  jurisdictionNote: null;
  suppressedReason: null;
  priced: boolean;
  unitRate: number | null;
  quantity: number;
  needsQuantity: false;
  totalCents: number | null;
  rateCaption: string;
  building: {
    /** The dismissals-map key ('bldg:<id>'), namespaced away from the code rules. */
    dismissKey: string;
    year: number;
    sourceChip: string;
    /** Why this line is here, in order (the age line, then the rule's own caveat). */
    lines: string[];
    /** PLUTO's caveat, only when the rules used PLUTO's year. */
    footer: string | null;
  };
}

export type BuildingDismissals = Record<string, { verdict: 'already_covered' | 'n_a'; at: string }>;

export interface BuildingRulesInput {
  lines: readonly ScopeLine[];
  scopeNotes?: readonly (string | null | undefined)[];
  jobKind: 'residential' | 'commercial';
  projectType?: ProjectType | null;
  address?: { city?: string; county?: string; state?: string } | null;
  year: BuildingYear | null;
  /** PLUTO's year when he entered his own, so the chip can show both. */
  pluto?: BuildingYear | null;
  costDb: CostDatabase;
  changeOrders?: readonly ChangeOrder[];
  projectId?: string;
  dismissals?: BuildingDismissals;
  /** The one pricing path; defaults to utils/scopePricing.scopeRateFor. */
  rateFor?: typeof scopeRateFor;
}

export function buildingDismissKey(ruleId: string): string {
  return `bldg:${ruleId}`;
}

/** Trigger text sources, labelled the way utils/scopeGaps labels them. */
function triggerSources(lines: readonly ScopeLine[], notes: readonly (string | null | undefined)[] | undefined) {
  const out: { label: string; norm: string }[] = [];
  lines.forEach((l, i) => {
    const name = (l?.name ?? '').trim();
    const norm = normalizeScopeText(`${name} ${l?.category ?? ''}`);
    if (norm) out.push({ label: `line ${i + 1} "${name}"`, norm });
  });
  for (const n of notes ?? []) {
    const norm = normalizeScopeText(n ?? '');
    if (norm) out.push({ label: 'your scope notes', norm });
  }
  return out;
}

/** True when the scope touches something the building's age matters for.
 *  The card asks for a year only then (a deck with no year stays quiet). */
export function scopeHasBuildingTrigger(lines: readonly ScopeLine[], notes?: readonly (string | null | undefined)[]): boolean {
  return triggerSources(lines, notes).some(s => BUILDING_TRIGGER_PHRASES.some(t => phraseInNorm(s.norm, t)));
}

export function evaluateBuildingRules(input: BuildingRulesInput): PricedBuildingGap[] {
  const y = input.year;
  if (!y || !Number.isInteger(y.year) || y.year < 1600) return [];
  const sources = triggerSources(input.lines, input.scopeNotes);
  const nyc = isNycJobsite(input.address ?? {});
  const commercial = input.jobKind !== 'residential' || input.projectType === 'commercial';
  const index = buildScopeIndex({
    estimateLines: input.lines,
    changeOrders: input.changeOrders,
    projectId: input.projectId,
    scopeNotes: input.scopeNotes,
  });
  const chip = buildingYearChip(y, input.pluto);
  const footer = y.source === 'pluto' ? PLUTO_FOOTER : null;

  const out: PricedBuildingGap[] = [];
  for (const rule of BUILDING_SCOPE_RULES) {
    let triggeredBy: string;
    let lines: string[];
    if (rule.id === 'rrp') {
      if (commercial || y.year >= RRP_CUTOFF_YEAR) continue;
      const hit = sources.find(s => rule.triggers.some(t => phraseInNorm(s.norm, t)));
      if (!hit) continue;
      triggeredBy = hit.label;
      lines = [rrpWhy(y.year, hit.label), RRP_EXEMPTION];
    } else {
      if (!nyc || y.year > ACP5_LAST_YEAR) continue;
      triggeredBy = 'an NYC jobsite';
      lines = [acp5Why(y.year)];
    }

    const coverage = isInContractScope({ phrases: rule.coveredBy }, index);
    const dismissKey = buildingDismissKey(rule.id);
    let state: BuildingGapState = coverage.covered ? 'in_scope' : 'gap';
    const dismissed = input.dismissals?.[dismissKey];
    if (dismissed && (dismissed.verdict === 'already_covered' || dismissed.verdict === 'n_a')) state = dismissed.verdict;

    // Price — the one pricing path, never a typical number.
    const entry = (input.rateFor ?? scopeRateFor)(input.costDb, rule.price.trade, rule.price.unit);
    const priced = !!entry && entry.suggestedRate > 0;
    const unitRate = priced ? entry!.suggestedRate : null;
    const totalCents = priced ? Math.round(rule.price.qty * toCents(unitRate!)) : null;

    out.push({
      rule, state, triggeredBy, coverage, jurisdictionNote: null, suppressedReason: null,
      priced, unitRate, quantity: rule.price.qty, needsQuantity: false, totalCents,
      rateCaption: scopeRateCaption(entry),
      building: { dismissKey, year: y.year, sourceChip: chip, lines, footer },
    });
  }
  return out;
}

// ── "Set your price" ─────────────────────────────────────────────────────────

/** His typed amount in integer cents ("1,140", "1140.5", "$1,140.50"), or null
 *  for anything that is not a positive amount the cost_seeds table can store.
 *  More than two decimals is not a price in cents → null (never rounded away). */
export function parsePriceCents(text: string): number | null {
  const t = String(text ?? '').trim().replace(/^\$/, '').replace(/,/g, '').trim();
  const m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(t);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number(((m[2] ?? '') + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_SEED_RATE * 100) return null;
  return cents;
}

/** The seed draft a rate he sets on the card becomes — trade = the rule's book
 *  label, unit = one each, rate in dollars from integer cents. Committed with
 *  costSeedCore.draftsToSeeds + hooks/useCostSeeds.addSeeds, exactly as
 *  app/cost-seed's manual form does, so scopeRateFor then finds it with
 *  provenance 'seeded' ("a rate you set"). Never a learned (measured) rate. */
export function buildingSeedDraft(rule: BuildingScopeRule, cents: number): SeededRateDraft {
  const unit = canonicalSeedUnit(rule.price.unit) ?? rule.price.unit.toUpperCase();
  const rate = cents / 100;
  return { trade: rule.price.trade, unit, rate, raw: `${rule.price.trade}, ${unit}, ${rate.toFixed(2)}` };
}
