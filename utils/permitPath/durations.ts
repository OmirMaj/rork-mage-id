// utils/permitPath/durations.ts — how long a station takes, and ONLY from a
// source that measured or stated it (PLAN §6.4):
//   1. a dated department answer for this jurisdiction,
//   2. NYC DOB's measured review time (approved filings, at or above the floor),
//   3. the GC's own permits with this authority (learned, at or above the floor),
//   4. LPC's stated legal maximum, labelled as a maximum,
// and otherwise "Not known yet". The model-authored leadTimeDays is never read:
// resolvePermitReviewLead is always called with authoredDays null, and its
// result is used only when it reports a learned or measured lead.

import type { Permit } from '@/types';
import { resolvePermitReviewLead, type MeasuredReviewLead } from '@/utils/automation/learnedLeadTime';
import { PP_COPY } from '@/utils/permitPath/copy';
import type { DeptAnswerRef, Duration, JurisdictionKey, SourceRef, StationId } from '@/utils/permitPath/types';

/** A department's answer as the GC saved it (PPASK's jurisdiction_answers row). */
export interface SavedDeptAnswer {
  id: string;
  jurisdictionKey: JurisdictionKey;
  /** The question it answers. PPASK rows answer several at once and carry
   *  `questionIds` instead; either (or both) is matched. */
  questionId?: string;
  questionIds?: readonly string[];
  answerText: string;
  answeredOn: string;
  saidBy: string | null;
  channel: string;
  sourceUrl: string | null;
}

/** NYC LPC "Apply" page (PLAN V8), read 2026-10-02: Permit for Minor Work 20,
 *  Certificate of No Effect 30, Certificate of Appropriateness 90 working days. */
export const LPC_STATED_MAX_SOURCE: SourceRef = Object.freeze({
  label: 'NYC LPC · Apply',
  url: 'https://www.nyc.gov/site/lpc/applications/apply.page',
  checkedOn: '2026-10-02',
});

const unknownDuration = (): Duration => ({ kind: 'unknown', label: PP_COPY.durations.unknown, detail: null, source: null, answer: null });

/** A department question that asks how long a station takes: '<pack>.<x>_time'. */
export function isDurationQuestionId(id: string): boolean {
  return /(^|\.)[a-z0-9_]*_time$/.test(id);
}

export function answerRef(a: SavedDeptAnswer): DeptAnswerRef {
  return { id: a.id, answeredOn: a.answeredOn, saidBy: a.saidBy, channel: a.channel, sourceUrl: a.sourceUrl };
}

function answers(a: SavedDeptAnswer, questionIds: readonly string[]): boolean {
  if (typeof a.questionId === 'string' && questionIds.includes(a.questionId)) return true;
  return Array.isArray(a.questionIds) && a.questionIds.some((q) => questionIds.includes(q));
}

/**
 * The saved answer to `questionIds` for exactly this jurisdiction key, latest
 * answeredOn first (ties broken by id, so input order never matters). Never
 * matches under 'UNRESOLVED' — that key pools every unplaced job.
 */
export function latestAnswer(
  deptAnswers: readonly SavedDeptAnswer[],
  jurisdictionKey: JurisdictionKey,
  questionIds: readonly string[],
): SavedDeptAnswer | null {
  if (!jurisdictionKey || jurisdictionKey === 'UNRESOLVED') return null;
  let best: SavedDeptAnswer | null = null;
  for (const a of deptAnswers) {
    if (a.jurisdictionKey !== jurisdictionKey || !answers(a, questionIds)) continue;
    if (!a.answerText || !a.answerText.trim()) continue;
    if (!best || a.answeredOn > best.answeredOn || (a.answeredOn === best.answeredOn && a.id > best.id)) best = a;
  }
  return best;
}

export interface DurationInputs {
  jurisdictionKey: JurisdictionKey;
  deptAnswers: readonly SavedDeptAnswer[];
  /** The active department questions on this station that ask for a time. */
  durationQuestionIds: readonly string[];
  /** True when the route carries an LPC permit item (checks station). */
  lpcApplies: boolean;
  /** Every permit the GC has (the learned tier reads his history with this authority). */
  permits: readonly Permit[];
  measured: MeasuredReviewLead | null;
  authority: string | null;
}

export function durationFor(station: StationId, inputs: DurationInputs): Duration {
  const said = latestAnswer(inputs.deptAnswers, inputs.jurisdictionKey, inputs.durationQuestionIds);
  if (said) {
    return { kind: 'department_said', label: PP_COPY.durations.departmentSaid(said.answerText, said.answeredOn), detail: null, source: null, answer: answerRef(said) };
  }

  if (station === 'review') {
    const m = inputs.measured;
    if (m) {
      // Measured alone: no permits, so the learned tier cannot answer first.
      const r = resolvePermitReviewLead({ permits: [], authority: inputs.authority, permitType: null, authoredDays: null, measured: m });
      if (r.lead.source === 'jurisdiction' && r.learned === null && r.hardDate && r.lead.days === m.days) {
        return { kind: 'measured', label: PP_COPY.durations.measured(m.days, m.n), detail: PP_COPY.durations.measuredDetail, source: null, answer: null };
      }
    }
    const r = resolvePermitReviewLead({ permits: inputs.permits, authority: inputs.authority, permitType: null, authoredDays: null, measured: null });
    if (r.lead.source === 'learned' && r.learned) {
      const l = r.learned;
      return { kind: 'your_records', label: PP_COPY.durations.yourRecords(l.n), detail: PP_COPY.durations.yourRecordsDetail(l.medianRaw, l.minDays, l.maxDays), source: null, answer: null };
    }
    return unknownDuration();
  }

  if (station === 'checks' && inputs.lpcApplies) {
    return { kind: 'stated_max', label: PP_COPY.durations.lpcStatedMax, detail: PP_COPY.durations.lpcStatedMaxDetail, source: LPC_STATED_MAX_SOURCE, answer: null };
  }

  return unknownDuration();
}
