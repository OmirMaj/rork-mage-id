// utils/tutorial/learn/fixturesA.ts — the sample inputs lane A's three
// tutorials offer (estimate-first, change-order-draft, field-ticket-log).
// Pure data plus pure helpers: no React, no RN, no context.
//
// HONEST SEAMS (the same rule as ../fixtures.ts). Each fixture stands in for
// exactly one real input:
//   • the estimate wizard's AI answer, ON THE SAMPLE JOB ONLY while a run is
//     live, and only when the scope is the sample sentence below (normalized,
//     exact). Anything he types himself is refused there with a reason — the
//     wizard never calls the AI on a sample during a run (app/estimate-wizard
//     generate(), pinned by scripts/validate-tutorial-learn-a.ts);
//   • a change-order description and one priced line the user still adds
//     with his own tap;
//   • a field-ticket work line, its reason chip and one labor row.
// The result is labelled on screen with SAMPLE_NO_CREDITS_LABEL.
//
// MONEY IS INTEGER CENTS here (spec M6). The wizard's EstimateResult is in
// dollars, so sampleWizardResult() converts once, at the edge, and every
// total is the sum of its lines — scripts/validate-tutorial-learn-a.ts pins
// that the lines foot to the totals to the cent.

import type { EstimateResult, WizardAnswers } from '@/utils/scopeQuestions';
import { SAMPLE_ESTIMATE_LINES } from '../fixtures';

// ── Estimate wizard ─────────────────────────────────────────────────────────

/** The one scope sentence the sample run prices with the bundled result. */
export const SAMPLE_SCOPE =
  'Gut the kitchen and two hall baths in a 1980s ranch. New cabinets, counters, tile, fixtures and paint.';

/** Normalize before comparing (lower-case, dashes to spaces, punctuation
 *  dropped, whitespace collapsed): an exact match only, so an edited scope is
 *  "his own words" and is refused on the sample instead of priced. */
export function normalizeScope(s: string): string {
  return (s ?? '').toLowerCase().replace(/[–—-]/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/** True only for the sample sentence (modulo case, punctuation, spacing). */
export function isSampleScope(s: string): boolean {
  return normalizeScope(s) === normalizeScope(SAMPLE_SCOPE);
}

/** The answers the wizard seeds on the sample during a run. The scope stays
 *  EMPTY: describing the job is step 1, his to do (or 'Do it for me').
 *  location is a market (city, state), never the sample's street address. */
export const SAMPLE_WIZARD_ANSWERS: Readonly<Omit<WizardAnswers, 'scope'>> = {
  projectType: 'Kitchen Remodel',
  sizeSqft: '820',
  location: 'Glen Ridge, NJ',
  quality: 'standard',
  timelineWeeks: '',
  specialRequirements: '',
  targetBudget: '',
};

/** The key of the scope question in utils/scopeQuestions SCOPE_STEPS (the
 *  wizard looks its index up, so a reordered question list still lands here). */
export const SAMPLE_SCOPE_STEP_ID = 'scope' as const;

export interface SampleWizardLineCents {
  category: string;
  description: string;
  quantity: number;
  unit: string;
  unitCostCents: number;
  totalCents: number;
}

/**
 * The bundled answer: the sample job's own 8 estimate lines (../fixtures
 * SAMPLE_ESTIMATE_LINES) at COST — the wizard's result is always cost, and the
 * screen prices it at HIS markup (utils/estimateMarkup), exactly like an AI
 * answer. unitPrice there is the pre-markup cost in whole dollars, so every
 * line is a whole number of cents. Contingency and permits are 0: the lines
 * already carry the whole job, and inventing a separate figure would be a
 * number nobody priced.
 */
export const SAMPLE_WIZARD_LINES_CENTS: readonly SampleWizardLineCents[] = SAMPLE_ESTIMATE_LINES.map(l => ({
  category: l.category,
  description: l.name,
  quantity: l.quantity,
  unit: l.unit,
  unitCostCents: Math.round(l.unitPrice * 100),
  totalCents: Math.round(l.unitPrice * 100) * l.quantity,
}));

export const SAMPLE_WIZARD_SUBTOTAL_CENTS = SAMPLE_WIZARD_LINES_CENTS.reduce((s, l) => s + l.totalCents, 0);
export const SAMPLE_WIZARD_CONTINGENCY_CENTS = 0;
export const SAMPLE_WIZARD_PERMITS_CENTS = 0;
export const SAMPLE_WIZARD_TOTAL_CENTS = SAMPLE_WIZARD_SUBTOTAL_CENTS + SAMPLE_WIZARD_CONTINGENCY_CENTS + SAMPLE_WIZARD_PERMITS_CENTS;

export const SAMPLE_WIZARD_SUMMARY = 'Kitchen and two hall baths in a 1980s ranch, priced from the sample job’s eight lines.';

/** SAMPLE_WIZARD_LINES_CENTS as the wizard's EstimateResult (dollars). No
 *  confidence (an absent score is never shown as an earned one), no refine
 *  questions (refining is an AI call). A fresh object per call. */
export function sampleWizardResult(): EstimateResult {
  return {
    summary: SAMPLE_WIZARD_SUMMARY,
    lineItems: SAMPLE_WIZARD_LINES_CENTS.map(l => ({
      category: l.category,
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unitCost: l.unitCostCents / 100,
      total: l.totalCents / 100,
    })),
    subtotal: SAMPLE_WIZARD_SUBTOTAL_CENTS / 100,
    contingency: SAMPLE_WIZARD_CONTINGENCY_CENTS / 100,
    permits: SAMPLE_WIZARD_PERMITS_CENTS / 100,
    total: SAMPLE_WIZARD_TOTAL_CENTS / 100,
    notes: [],
    confidence: undefined,
    refineWith: [],
  };
}

/** The note on the revision the sample save writes (app/estimate-wizard). */
export const SAMPLE_ESTIMATE_REVISION_NOTE = 'Practice estimate from the tutorial';

/** Dollars (as the screens hold them) to integer cents for a payload. */
export function toCents(dollars: number): number {
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
}

// ── Change order ────────────────────────────────────────────────────────────

/** 'Do it for me' on the description, and the one line the user adds. The
 *  line's cost is what HE pays; the add sheet prices it at his own markup
 *  (app/change-order.tsx handleAddNewItem), so the CO's total is his. */
export const CO_SAMPLE = {
  description: 'Add a recessed light over the island',
  reason: 'Client request',
  line: { name: 'Recessed light over the island', quantity: 1, unit: 'ea', unitCostCents: 42_500 },
} as const;

/** The sample line's cost in cents (quantity × unit cost). */
export const CO_SAMPLE_LINE_COST_CENTS = CO_SAMPLE.line.quantity * CO_SAMPLE.line.unitCostCents;

// ── Field ticket ────────────────────────────────────────────────────────────

/** reason is one of app/field-ticket.tsx REASON_CHIPS (saved verbatim); the
 *  labor row is hours only — rates are the office's, after the signature. */
export const TICKET_SAMPLE = {
  work: 'Ran a new 20 A circuit to the island after the owner moved it two feet.',
  reason: 'Owner / rep directive',
  labor: { trade: 'Electrician', hours: 3 },
} as const;
