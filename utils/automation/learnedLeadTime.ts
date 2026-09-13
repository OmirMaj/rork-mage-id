// utils/automation/learnedLeadTime.ts — the first producer of
// `LeadTimeSource: 'learned'` in this repo. Pure: no React, no RN, no storage,
// no network. scripts/validate-learned-lead-time.ts drives it under bun.
//
// WHAT WAS BROKEN
//   utils/automation/leadTimeLibrary.ts has shipped a four-member provenance
//   union since v1 — default | jurisdiction | learned | ai_estimate — and its
//   own header said 'learned' "is reserved for the prediction ledger". Nothing
//   produced it. Meanwhile the Construction AI Roadmap tab printed the model's
//   `leadTimeDays` BARE ("{permit.leadTimeDays}d lead"), turned it into a
//   calendar date ("Book by: …"), and turned THAT into a red severity:'high'
//   banner reading "book-by date passed" — a number a language model sized
//   from free text, rendered as a deadline the contractor schedules against.
//
// WHAT IS ACTUALLY TRUE, AND WHAT THAT FORCES
//   Permit review time varies by permit type, by season, by whether the
//   submission was complete. A single integer is the wrong shape for it. So
//   when there IS enough history this module ships a RANGE (the observed min
//   and max) alongside the median it books against, and the range is in the
//   chip text — "18–34d across your 4" is a truer thing to hand a contractor
//   than "25d".
//
//   And there is a second true thing that limits the scope of this file: the
//   contractor's own records can learn PERMIT REVIEW time and nothing else,
//   and a Roadmap PERMIT row renders only a CHIP — no book-by date. So
//   'learned' relabels a chip honestly; it does not and cannot move any date
//   the contractor schedules against. The unlock for that is recording a
//   requested-on day for PermitInspection, which nothing in the schema does.
//   `Permit.appliedDate` → `Permit.approvedDate` are two real dated columns, so
//   the elapsed review is a measurement. An INSPECTION book-ahead lead is not
//   recorded anywhere — PermitInspection has `scheduledFor` (the day of the
//   visit) but no field for the day it was requested, so the lead cannot be
//   derived from it. Rather than invent one, inspections keep the existing
//   ai_estimate / seeded-default resolution and say so. Learning a number we
//   do not have is exactly the failure this file exists to end.
//
// THE SAMPLE FLOOR (utils/brain/accuracyReport.ts:8 — "suppress any kind with
// n < 3"; the same floor utils/permitInspectionFacts.ts uses)
//   Two permits cannot support a forecast. Below LEARNED_LEAD_FLOOR this
//   module returns NO learned value at all — the caller falls back to the
//   labelled seeded default — while still reporting `observed`, the raw count,
//   so the surface can say "1 permit on file, not enough to learn from" rather
//   than pretending the record is empty.

import type { Permit, PermitType } from '@/types';
import { parseCalendarDay } from '@/utils/calendarDate';
import {
  getLeadTime,
  leadTimeChipText,
  type LeadTime,
  type LeadTimeConfidence,
} from '@/utils/automation/leadTimeLibrary';
import { sameAuthority } from '@/utils/permitInspectionFacts';

/** Below this many completed permits, no lead is learned. */
export const LEARNED_LEAD_FLOOR = 3;

/** Above this many, a type-matched learned lead is allowed 'high'. */
const LEARNED_HIGH_CONFIDENCE_AT = 6;

const MS_DAY = 86400000;

/**
 * One measured review: a permit whose appliedDate and approvedDate are both
 * real calendar days, in that order.
 */
export interface ReviewSample {
  permitId: string;
  type: PermitType;
  days: number;
  appliedDate: string;
  approvedDate: string;
}

/** A lead the contractor's own file supports. */
export interface LearnedLead {
  /** The value to BOOK AGAINST: the median, clamped to at least 1 day. This is
   *  a scheduling decision, not a measurement — never print it as a median. */
  days: number;
  /** The measured median, unclamped. `0` when his record really is same-day.
   *  Carried separately because printing the clamped value as "median 1"
   *  beside a "0–0 days" range is an arithmetic impossibility on its face. */
  medianRaw: number;
  /** The honest spread. minDays may legitimately be 0 (same-day issuance). */
  minDays: number;
  maxDays: number;
  n: number;
  /** True when the spread is too wide for the median to describe it. A
   *  3d/3d/400d record is not a 3-day lead at medium confidence. */
  dispersed: boolean;
  /** 'type' — every sample is the same permit type as the question.
   *  'all_types' — the type alone was below the floor, so the record was
   *  widened across permit types and the label must say so. */
  scope: 'type' | 'all_types';
  permitType?: PermitType;
  authority: string;
  confidence: LeadTimeConfidence;
}

// ─────────────────────────────────────────────────────────────────────
// Reading the record
// ─────────────────────────────────────────────────────────────────────

/**
 * Every permit with this authority whose review actually completed.
 *
 * Rejected, and why each rejection matters:
 *   - a missing or unparseable date: not a measurement.
 *   - approvedDate BEFORE appliedDate: bad data (a typo, or a permit back-
 *     filled after the fact). A negative review time would drag a median down
 *     and hand the contractor an earlier book-by date than his record supports.
 *   - a same-day approval (0 days) is KEPT. It is a real observation and it
 *     belongs in the range; only the value booked against is clamped to 1, so
 *     the lead can never collapse to a same-day anchor (leadTimeLibrary's
 *     positive-days invariant).
 */
export function reviewSamplesFor(
  permits: readonly Permit[],
  authority: string | null | undefined,
): ReviewSample[] {
  const auth = (authority ?? '').trim();
  if (!auth) return [];
  const out: ReviewSample[] = [];
  for (const p of permits) {
    if (!sameAuthority(p.jurisdiction, auth)) continue;
    const applied = parseCalendarDay(p.appliedDate);
    const approved = parseCalendarDay(p.approvedDate);
    if (!applied || !approved) continue;
    const days = Math.round((approved.getTime() - applied.getTime()) / MS_DAY);
    if (!Number.isFinite(days) || days < 0) continue;
    out.push({
      permitId: p.id,
      type: p.type,
      days,
      appliedDate: p.appliedDate,
      approvedDate: p.approvedDate as string,
    });
  }
  return out;
}

/** Lower median: for an even count, the lower of the two middles. Deterministic
 *  and never invents a half-day the record does not contain. */
export function medianDays(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/** True when the observed maximum is more than this multiple of the median.
 *  Above it the median is not describing the sample any more. */
const DISPERSION_FACTOR = 4;

function buildLearned(
  samples: ReviewSample[],
  scope: 'type' | 'all_types',
  permitType: PermitType | undefined,
  authority: string,
): LearnedLead {
  const days = samples.map((s) => s.days);
  const medianRaw = medianDays(days);
  const maxDays = Math.max(...days);
  // Confidence used to be a pure function of n: three samples of 3d, 3d and
  // 400d were reported as "medium confidence · 3–400d" while the prompt told
  // the model the range "is a measurement of this contractor with this
  // office". A count is not a measure of agreement. A record that disagrees
  // with itself is demoted one step and the chip says why.
  const dispersed = maxDays > Math.max(1, medianRaw) * DISPERSION_FACTOR;
  const base: LeadTimeConfidence =
    scope === 'all_types'
      ? 'low'
      : samples.length >= LEARNED_HIGH_CONFIDENCE_AT
        ? 'high'
        : 'med';
  const confidence: LeadTimeConfidence = dispersed
    ? (base === 'high' ? 'med' : 'low')
    : base;
  return {
    days: Math.max(1, medianRaw),
    medianRaw,
    minDays: Math.min(...days),
    maxDays,
    n: samples.length,
    dispersed,
    scope,
    permitType,
    authority,
    confidence,
  };
}

/**
 * What the contractor's own permits say a review takes with this authority.
 *
 * Type-matched first — a demolition permit and a full building permit are not
 * the same queue. Only when the type alone is below the floor does the record
 * widen across every permit type with this authority, and a widened lead is
 * 'all_types' / 'low' so the label can say what it did. `null` when even the
 * widened record is below the floor: below the floor there is no forecast.
 */
export function learnedPermitReviewLead(
  permits: readonly Permit[],
  authority: string | null | undefined,
  permitType?: PermitType | null,
): LearnedLead | null {
  const auth = (authority ?? '').trim();
  if (!auth) return null;
  const all = reviewSamplesFor(permits, auth);
  if (permitType) {
    const typed = all.filter((s) => s.type === permitType);
    if (typed.length >= LEARNED_LEAD_FLOOR) return buildLearned(typed, 'type', permitType, auth);
  }
  if (all.length >= LEARNED_LEAD_FLOOR) return buildLearned(all, 'all_types', undefined, auth);
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// The resolution the Roadmap screen renders
// ─────────────────────────────────────────────────────────────────────

/**
 * A lead, its provenance, the exact chip text, and whether a DATE derived from
 * it may be raised as a hard deadline.
 */
export interface ResolvedRoadmapLead {
  lead: LeadTime;
  learned: LearnedLead | null;
  /** Completed permits seen with this authority, INCLUDING below the floor.
   *  This is what lets a surface say "1 on file, not enough yet" honestly. */
  observed: number;
  /** EXACTLY the chip text. Built from leadTimeChipText so the Roadmap and the
   *  auto-schedule review sheet share one idiom. */
  chipLabel: string;
  /** Short provenance clause for a flag message. */
  sourceLabel: string;
  /**
   * TRUE only for `learned` and `jurisdiction` — the two sources that are a
   * measurement of something. A book-by date computed from a number a model
   * invented is not a deadline that has passed; neither is one computed from a
   * national placeholder for an office nothing was measured about. The
   * Roadmap's overdue banner must not go red on either.
   */
  hardDate: boolean;
}

function rangeDetail(l: LearnedLead): string {
  const span = l.minDays === l.maxDays ? `${l.minDays}d` : `${l.minDays}–${l.maxDays}d`;
  const what = l.scope === 'type' && l.permitType
    ? `your ${l.n} ${l.permitType.replace(/_/g, ' ')} permits`
    : `your ${l.n} permits (all types)`;
  // The booked value is clamped to >= 1 day; when that is NOT what his record
  // measured, the chip says both numbers rather than passing the clamp off as
  // the measurement.
  const clamp = l.medianRaw !== l.days ? `, median ${l.medianRaw}d — booked at ${l.days}d` : '';
  const spread = l.dispersed ? ' — wide spread, treat as unsettled' : '';
  return `${span} across ${what}${clamp}${spread}`;
}

/**
 * Resolve the lead for a ROADMAP PERMIT row.
 *
 * Order, most-grounded first:
 *   1. learned   — the contractor's own dated records, at or above the floor.
 *   2. jurisdiction — a real AHJ dataset. JURISDICTION_OVERRIDES ships empty,
 *      so in practice this is unreachable today; it is in the order because
 *      the library's resolution order says it is, not because it fires.
 *   3. ai_estimate — the model's authored `leadTimeDays`, kept ABOVE the
 *      seeded national default because the model at least saw this project's
 *      scope, and kept LABELLED because it saw nothing else. This is the same
 *      precedence utils/automation/roadmapToScheduleWork.ts already uses, so
 *      the two paths cannot disagree about the same roadmap.
 *   4. default   — the seeded national placeholder, labelled as one, and NOT
 *      a hard date: it knows nothing about this authority at all.
 */
export function resolvePermitReviewLead(args: {
  permits: readonly Permit[];
  authority: string | null | undefined;
  permitType?: PermitType | null;
  /** The model's `RoadmapPermit.leadTimeDays`, if it authored a positive one. */
  authoredDays?: number | null;
}): ResolvedRoadmapLead {
  const auth = (args.authority ?? '').trim();
  const observed = reviewSamplesFor(args.permits, auth).length;
  const onFile = permitsWithAuthority(args.permits, auth);
  const learned = learnedPermitReviewLead(args.permits, auth, args.permitType);

  if (learned) {
    const lead: LeadTime = { days: learned.days, source: 'learned', confidence: learned.confidence };
    return {
      lead,
      learned,
      observed,
      chipLabel: leadTimeChipText(lead, rangeDetail(learned)),
      sourceLabel: 'from your own permit history',
      hardDate: true,
    };
  }

  const fromLibrary = getLeadTime('permit_review', auth || undefined);
  if (fromLibrary.source === 'jurisdiction') {
    return {
      lead: fromLibrary,
      learned: null,
      observed,
      chipLabel: leadTimeChipText(fromLibrary),
      sourceLabel: 'from a jurisdiction dataset',
      hardDate: true,
    };
  }

  const authored = Math.round(args.authoredDays ?? 0);
  if (Number.isFinite(authored) && authored > 0) {
    const lead: LeadTime = { days: authored, source: 'ai_estimate', confidence: 'low' };
    return {
      lead,
      learned: null,
      observed,
      chipLabel: leadTimeChipText(lead, belowFloorNote(observed, onFile)),
      sourceLabel: 'an AI estimate, not your record',
      hardDate: false,
    };
  }

  return {
    lead: fromLibrary,
    learned: null,
    observed,
    chipLabel: leadTimeChipText(fromLibrary, belowFloorNote(observed, onFile)),
    sourceLabel: 'a seeded national default, not your record',
    // A national placeholder for an office nothing was measured about is LESS
    // grounded than the ai_estimate that at least saw this project's scope. It
    // used to be the one allowed to turn the overdue banner red.
    hardDate: false,
  };
}

/**
 * Resolve the book-ahead lead for a ROADMAP INSPECTION row.
 *
 * There is deliberately no 'learned' branch. `PermitInspection` records the day
 * of the visit and not the day it was requested, so a book-ahead lead cannot be
 * measured from the contractor's file. Producing one anyway — by reusing the
 * permit-review median, say — would be a fabricated number wearing the one
 * label in this union that means "measured", which is worse than the bare
 * integer this whole change exists to stop rendering.
 */
export function resolveInspectionLead(args: {
  authority: string | null | undefined;
  authoredDays?: number | null;
}): ResolvedRoadmapLead {
  const auth = (args.authority ?? '').trim();
  const fromLibrary = getLeadTime('dob_inspection', auth || undefined);
  if (fromLibrary.source === 'jurisdiction') {
    return {
      lead: fromLibrary,
      learned: null,
      observed: 0,
      chipLabel: leadTimeChipText(fromLibrary),
      sourceLabel: 'from a jurisdiction dataset',
      hardDate: true,
    };
  }
  const authored = Math.round(args.authoredDays ?? 0);
  if (Number.isFinite(authored) && authored > 0) {
    const lead: LeadTime = { days: authored, source: 'ai_estimate', confidence: 'low' };
    return {
      lead,
      learned: null,
      observed: 0,
      chipLabel: leadTimeChipText(lead),
      sourceLabel: 'an AI estimate, not your record',
      hardDate: false,
    };
  }
  return {
    lead: fromLibrary,
    learned: null,
    observed: 0,
    chipLabel: leadTimeChipText(fromLibrary),
    sourceLabel: 'a seeded national default, not your record',
    hardDate: false,
  };
}

/** Permits with this authority, whatever their state. Distinct from
 *  `observed`, which counts only the ones whose review actually COMPLETED —
 *  three permits still in review used to be reported as "no permit history
 *  here yet" to a contractor with three permits on file. */
export function permitsWithAuthority(
  permits: readonly Permit[],
  authority: string | null | undefined,
): number {
  const auth = (authority ?? '').trim();
  if (!auth) return 0;
  return permits.filter((p) => sameAuthority(p.jurisdiction, auth)).length;
}

function belowFloorNote(observed: number, onFile: number): string {
  const open = Math.max(0, onFile - observed);
  if (observed <= 0) {
    return open > 0
      ? `no completed review here yet (${open} permit${open === 1 ? '' : 's'} still open)`
      : 'no permit history here yet';
  }
  const openTail = open > 0 ? `, ${open} still open` : '';
  return `${observed} completed review${observed === 1 ? '' : 's'} on file — under ${LEARNED_LEAD_FLOOR}, too few to learn from${openTail}`;
}

/**
 * A prompt block naming what the contractor's own permit record says about
 * review time. Same discipline as utils/permitInspectionFacts.ts: one string,
 * built once, and an explicit "no record" rather than silence.
 */
export function leadTimeFactsFor(
  permits: readonly Permit[],
  authority: string | null | undefined,
): { promptBlock: string; grounded: boolean } {
  const auth = (authority ?? '').trim();
  if (!auth) {
    return {
      promptBlock:
        "CONTRACTOR'S PERMIT REVIEW HISTORY: unavailable — MAGE has no issuing authority for this address. Do not state how long a review takes here; say the lead is unconfirmed.",
      grounded: false,
    };
  }
  const learned = learnedPermitReviewLead(permits, auth, null);
  if (!learned) {
    const observed = reviewSamplesFor(permits, auth).length;
    return {
      promptBlock:
        `CONTRACTOR'S PERMIT REVIEW HISTORY with ${auth}: ${observed === 0 ? 'no completed permit on file' : `${observed} completed permit${observed === 1 ? '' : 's'} on file, under the ${LEARNED_LEAD_FLOOR}-permit floor`}. ` +
        'You have no measured review time for this authority. Give leadTimeDays as your own rough estimate and do not present it as local knowledge.',
      grounded: false,
    };
  }
  return {
    promptBlock:
      `CONTRACTOR'S PERMIT REVIEW HISTORY with ${auth} (measured from his own applied → approved dates): ` +
      `${learned.n} completed permits, ${learned.minDays}–${learned.maxDays} days, median ${learned.medianRaw}` +
      `${learned.medianRaw !== learned.days ? ` (booked at ${learned.days} — a lead is never zero days)` : ''}. ` +
      `${learned.dispersed ? 'That spread is wide enough that the median does not describe it; treat the range as unsettled and say so. ' : ''}` +
      'Use that range when you size leadTimeDays for this authority; it is a measurement of this contractor with this office, not a national average.',
    grounded: true,
  };
}
