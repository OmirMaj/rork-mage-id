// utils/subTradeMatch.ts — match a generated schedule task to a sub on the
// roster, and REFUSE when the match is not obvious.
//
// WHY THIS EXISTS. `ScheduleTask.assignedSubId` is the join key half the
// product quietly depends on: resource levelling groups by it, the buyout and
// commitment flow reads it, crew presence reads it, and the follow-up engine's
// COI rule joins it against `Subcontractor.coiExpiry` to answer "is this crew's
// insurance going to be valid on the day they are booked."
//
// It is empty. Across seven live projects and 44 schedule tasks, built over
// seven months and including a real commercial fit-out, the field is set on
// ZERO of them. It has exactly two writers: a manual chip picker in the
// schedule editor and punch-walk. The AI schedule builder — which produces
// most tasks — never sets it, so the key the app needs most is the one nobody
// fills in.
//
// WHAT THIS DOES NOT DO. It does not guess. utils/autoScheduleFromEstimate.ts
// leaves `crew` deliberately empty with a long comment ending "Empty is the
// honest value: the generator does not know who is doing this work," and that
// judgement is correct — a wrong sub on a task is worse than no sub, because
// every consumer above would then be confidently wrong. So this matches ONLY
// when exactly one subcontractor on the roster carries the task's trade. Two
// drywall subs means no assignment, and the manual picker stays the answer.
//
// Pure: no React, no clock, no I/O.

import { normalizeTradeKey } from '@/utils/laborSamples';

/** The shape this needs off a Subcontractor — kept structural so the matcher
 *  can be exercised without building a whole domain object. */
export interface TradeCandidate {
  id: string;
  companyName: string;
  trade: string;
  /** Project ids this sub is on. An empty roster is treated as "available to
   *  every project", which is how the app behaves elsewhere. */
  assignedProjects?: string[];
}

export interface SubTradeMatch {
  subId: string;
  subName: string;
  /** Why this one, in words the schedule screen can print verbatim. */
  reason: string;
}

/** Why no assignment was made. Surfaced so the UI can say something useful
 *  rather than silently leaving the field blank. */
export type SubTradeRefusal =
  | { kind: 'no_trade_on_task' }
  | { kind: 'no_sub_for_trade'; trade: string }
  | { kind: 'ambiguous'; trade: string; candidates: string[] };

export type SubTradeOutcome =
  | { matched: true; match: SubTradeMatch }
  | { matched: false; refusal: SubTradeRefusal };

/**
 * Phase names the schedule generator produces that are not a trade anybody
 * subcontracts. Assigning a sub to "Punch List" or "Permitting" would be
 * noise, so they never match.
 */
const NON_TRADE_PHASES = new Set([
  'permitting', 'permits', 'design', 'procurement', 'mobilization',
  'punch list', 'punch', 'closeout', 'inspection', 'inspections',
  'above-ceiling inspection', 'commissioning',
  'general', 'general conditions', 'management', 'milestone',
]);

/**
 * Two vocabularies name the same work with different words.
 *
 * SCHEDULE_PHASES is what the generator is told to produce, and it is phrased
 * as a stage of the job: "Demo", "Ceilings", "Low Voltage". SubTrade is what a
 * company on the roster calls itself, and it is phrased as a business:
 * "Demolition", "Acoustical Ceilings", "Low Voltage / Cabling". The matcher
 * compares them with plain equality after normalisation, so without this map
 * the demolition contractor is simply never matched to the demo phase — the
 * join fails silently and the assignment is quietly skipped, which looks
 * exactly like "no sub for that trade".
 *
 * That was already true before the two lists grew; it is worth writing down
 * now because extending both at once is precisely when the gap gets wider
 * without anybody noticing. Keys and values are normalised keys, not labels.
 *
 * ONLY RENAMES BELONG HERE. Every entry is the same scope under two words —
 * the company that does "Demolition" is the company that does the "Demo"
 * phase, with no judgement in between. Phases that merely OVERLAP a trade are
 * deliberately absent, and the first draft of this map had four of them:
 * Structure→Concrete (it could as easily be steel or framing), Building
 * Envelope→Roofing (or glazing, or waterproofing), Interior→Drywall, and
 * Site Work→Landscaping, which is simply wrong — site work on a commercial
 * job is excavation and utilities and the landscaper is nowhere near it.
 *
 * Each of those would have produced a confident, wrong `assignedSubId` on a
 * join key that levelling, buyout, crew presence and the COI check all read.
 * A missed match costs a manual pick; a wrong one corrupts four features. The
 * module refuses ambiguity everywhere else and this map does not get an
 * exception.
 */
const PHASE_TRADE_ALIASES: Record<string, string> = {
  'demo': 'demolition',
  'ceilings': 'acoustical ceilings',
  'low voltage': 'low voltage / cabling',
};

/** Resolve a phase's normalised key onto the trade vocabulary. */
function tradeKeyForPhase(raw: string): string {
  const key = normalizeTradeKey(raw);
  return PHASE_TRADE_ALIASES[key] ?? key;
}

/**
 * Match one task's phase to exactly one sub on the roster.
 *
 * `phase` is the generator's own word for the work ("Drywall", "Electrical").
 * It is compared through the SAME normalizer the labour book and crew presence
 * use (`normalizeTradeKey`), so a match here means the same thing it means
 * everywhere else in the app rather than being a third private notion of trade.
 */
export function matchSubForPhase(
  phase: string | undefined,
  subs: readonly TradeCandidate[],
  projectId: string,
): SubTradeOutcome {
  const raw = (phase ?? '').trim();
  if (!raw) return { matched: false, refusal: { kind: 'no_trade_on_task' } };

  if (NON_TRADE_PHASES.has(raw.toLowerCase())) {
    return { matched: false, refusal: { kind: 'no_trade_on_task' } };
  }
  const key = tradeKeyForPhase(raw);
  if (!key || key === 'general') {
    return { matched: false, refusal: { kind: 'no_trade_on_task' } };
  }

  const onThisJob = subs.filter(s =>
    !s.assignedProjects?.length || s.assignedProjects.includes(projectId));

  const hits = onThisJob.filter(s => normalizeTradeKey(s.trade) === key);

  if (hits.length === 0) {
    return { matched: false, refusal: { kind: 'no_sub_for_trade', trade: raw } };
  }
  // TWO drywall subs is not a decision the app gets to make for him. Silence
  // here is the point of the whole module.
  if (hits.length > 1) {
    return {
      matched: false,
      refusal: { kind: 'ambiguous', trade: raw, candidates: hits.map(h => h.companyName) },
    };
  }

  const only = hits[0];
  return {
    matched: true,
    match: {
      subId: only.id,
      subName: only.companyName,
      reason: `${only.companyName} is the only ${raw.toLowerCase()} sub on this job`,
    },
  };
}

/** One line appended to the task's `rationale`, so the schedule says out loud
 *  that the app chose this and on what basis. Never silent.
 *
 *  NOT `assumption` — that is a BOOLEAN flag on ScheduleTask (types/index.ts:602);
 *  `rationale` (599) is the string the generator already writes its reasoning
 *  into, which is where a reader looks for why a task says what it says. */
export function assignmentNote(match: SubTradeMatch): string {
  return `Assigned to ${match.subName} — ${match.reason}. Change it on the task if that is wrong.`;
}

/** A short, honest summary for the generator's result banner. */
export function summariseAssignments(outcomes: readonly SubTradeOutcome[]): string {
  const matched = outcomes.filter(o => o.matched).length;
  const ambiguous = outcomes.filter(o => !o.matched && o.refusal.kind === 'ambiguous').length;
  if (matched === 0 && ambiguous === 0) return '';
  const parts: string[] = [];
  if (matched > 0) parts.push(`${matched} task${matched === 1 ? '' : 's'} assigned to a sub by trade`);
  if (ambiguous > 0) parts.push(`${ambiguous} left unassigned — more than one sub for that trade`);
  return parts.join('; ') + '.';
}
