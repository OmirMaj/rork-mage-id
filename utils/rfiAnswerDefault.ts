// ============================================================================
// utils/rfiAnswerDefault.ts — typing the answer marks the RFI answered
// (UX wave, Lane B3).
//
// "The architect calls with the answer and there's nowhere to write it until I
// change the status." The answer box now sits under the question on every
// saved RFI, and typing into it on an OPEN RFI moves the status to Answered —
// shown as a chip he can change back. Clearing the text before saving puts it
// back to Open. Picking Open again ("Keep it open") sticks until he clears and
// retypes, so the default never fights him.
//
// It only ever moves open → answered. A record that is already answered,
// closed or void is never touched here (the regression rule, #55, lives in
// rfiRegressionReason). The save path stamps dateResponded when the answer was
// typed, as it always has.
//
// Pure. scripts/validate-ux-lane-b.ts runs it under bun.
// ============================================================================

import type { RFI } from '@/types';

type Status = RFI['status'];

export interface AnswerStatusState {
  status: Status;
  /** true while the status is Answered only because the answer was typed. */
  auto: boolean;
  /** true once he chose "Keep it open" over the default. */
  keepOpen: boolean;
}

export function initialAnswerState(status: Status): AnswerStatusState {
  return { status, auto: false, keepOpen: false };
}

/**
 * The status after the answer text changes.
 * - recordStatus: the SAVED record's status. Only an open record defaults.
 */
export function afterAnswerEdit(prev: AnswerStatusState, answer: string, recordStatus: Status): AnswerStatusState {
  if (recordStatus !== 'open') return prev;
  const has = answer.trim().length > 0;
  if (has && prev.status === 'open' && !prev.keepOpen) return { status: 'answered', auto: true, keepOpen: false };
  if (!has && prev.auto) return { status: 'open', auto: false, keepOpen: false };
  // Cleared after "Keep it open": the next answer may default again.
  if (!has && prev.keepOpen) return { ...prev, keepOpen: false };
  return prev;
}

/** He picked a status himself (the Status picker or the chip). */
export function afterStatusPick(prev: AnswerStatusState, status: Status): AnswerStatusState {
  // Re-picking Open while it is already open is not an override.
  return { status, auto: false, keepOpen: status === 'open' && (prev.status !== 'open' || prev.keepOpen) };
}

/** The chip under the answer while the default is in force. */
export function answeredChipText(state: AnswerStatusState): string | null {
  return state.auto && state.status === 'answered' ? 'Will save as Answered' : null;
}

export const KEEP_OPEN_LABEL = 'Keep it open';
export const RECORD_ANSWER_LABEL = 'Record the answer';
