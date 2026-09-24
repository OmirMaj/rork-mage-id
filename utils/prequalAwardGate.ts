// utils/prequalAwardGate.ts — what an award says about a sub's prequal packet.
//
// Pure (type-only imports) so scripts/validate-prequal-engine.ts (section 9) executes it.
//
// The award dialog in app/buyout-package.tsx used to re-run the auto-review on
// whatever answers the packet held and never looked at its status (Q5,
// 2026-09-24). Two wrong results followed:
//   • a sub the GC had INVITED but who had not filled the form in yet was judged
//     as if he had submitted it blank — about seven blockers and the red
//     "Compliance risk" override — while a sub never invited got a quiet note.
//     Inviting a sub made awarding to him look riskier than not inviting him.
//   • a sub the GC had REJECTED, whose typed answers happened to pass, was
//     awarded with no warning at all: the GC's own decision was invisible.
//
// The rule now, by status (the GC's decision outranks the robot's):
//   approved                     → nothing (a lapsed approval gets a note)
//   draft / invited / in_progress→ note: sent, not yet submitted (pending)
//   submitted                    → note: awaiting your review, plus the
//                                  auto-review's failed blockers as blockers
//                                  (what the sub actually submitted fails them)
//   needs_changes                → note, with the GC's own note
//   rejected                     → BLOCKER, with the date and the GC's note
//   expired                      → note: send a renewal
//
// The "no packet at all" note stays in buyout-package.tsx beside the
// "Request prequal" button it pairs with.

import type { PrequalPacket } from '@/types';
import type { PrequalReviewResult } from '@/utils/prequalEngine';

export interface PrequalAwardLeg {
  blockers: string[];
  notes: string[];
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A stored packet date for a dialog line: date-only strings read as that day
 *  (pinned to UTC, or a US time zone prints the day before), timestamps as the
 *  local day. Null when it does not parse. */
function dayLabel(value: string | undefined): string | null {
  if (!value) return null;
  const dateOnly = DATE_ONLY.test(value);
  const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) });
}

function withNote(note: string | undefined): string {
  const n = (note ?? '').trim();
  return n ? `: "${n}"` : '';
}

export function prequalAwardLeg(
  packet: PrequalPacket,
  review: PrequalReviewResult | null,
  subName: string,
  nowMs: number,
): PrequalAwardLeg {
  const blockers: string[] = [];
  const notes: string[] = [];
  const on = dayLabel(packet.reviewedAt);
  const onText = on ? ` on ${on}` : '';

  switch (packet.status) {
    case 'approved': {
      // The approval runs to expiresAt (min of a year and the COI date the sub
      // gave). Past it the approval has lapsed; the COI leg of the gate judges
      // the insurance itself from the vault.
      const exp = packet.expiresAt ? new Date(DATE_ONLY.test(packet.expiresAt) ? `${packet.expiresAt}T00:00:00Z` : packet.expiresAt).getTime() : NaN;
      if (Number.isFinite(exp) && exp <= nowMs) {
        notes.push(`${subName}'s prequal approval lapsed${dayLabel(packet.expiresAt) ? ` on ${dayLabel(packet.expiresAt)}` : ''} — send a renewal from Prequal.`);
      }
      break;
    }
    case 'draft':
    case 'invited':
    case 'in_progress':
      notes.push(`Prequal sent to ${subName}, not yet submitted — pending, not a failure.`);
      break;
    case 'submitted': {
      notes.push(`${subName}'s prequal is awaiting your review in Prequal.`);
      for (const f of review?.findings ?? []) {
        if (!f.passed && f.severity === 'blocker') blockers.push(f.note ? `${f.label} — ${f.note}` : f.label);
      }
      break;
    }
    case 'needs_changes':
      notes.push(`You sent ${subName}'s prequal back for changes${onText}${withNote(packet.reviewerNotes)} — not resubmitted yet.`);
      break;
    case 'rejected':
      blockers.push(`You rejected ${subName}'s prequal${onText}${withNote(packet.reviewerNotes)}.`);
      break;
    case 'expired':
      notes.push(`${subName}'s prequal has expired — send a renewal from Prequal.`);
      break;
    default:
      notes.push(`${subName}'s prequal is in an unrecognised state ("${String(packet.status)}") — open it in Prequal.`);
  }
  return { blockers, notes };
}
