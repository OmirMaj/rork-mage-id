// toolboxRoster.ts — pre-fill the toolbox sign-in sheet from the job's crew.
//
// WHY THIS EXISTS (audit round 2, safety-compliance #5b). The foreman typed
// every attendee's name one at a time on a phone at 6:45am, while
// CrewMember.projectIds already said exactly who is assigned to this job
// (written by app/crew.tsx). Retyping twelve names is why sign-in sheets end up
// half-filled. The sheet now starts with the assigned crew as UNSIGNED rows he
// can remove for anyone absent; nobody is ever pre-signed.
//
// The crew member's id goes in SafetyAttendee.subId (the attendee's existing
// person-reference field), which is what makes the certification chip an exact
// join rather than a name match. Pure, validated under bun.

import type { SafetyAttendee } from '@/types';

export interface RosterMemberLike {
  id: string;
  fullName: string;
  status?: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Append the assigned crew who are not already on the sheet.
 * - Already on the sheet = same crew id, OR (for a hand-typed row with no id)
 *   the same name. The name check only PREVENTS a duplicate row; it never links
 *   a typed row to a crew member, because a name match is a guess.
 * - Inactive members are skipped: they are off the job.
 * - Existing rows (signed or not) are returned untouched and first.
 */
export function prefillAttendeesFromCrew(
  existing: SafetyAttendee[],
  crew: RosterMemberLike[],
): SafetyAttendee[] {
  const ids = new Set(existing.map(a => a.subId).filter((v): v is string => !!v));
  const typedNames = new Set(existing.filter(a => !a.subId).map(a => norm(a.name)));
  const added: SafetyAttendee[] = [];
  for (const m of crew) {
    if (!m?.id || !m.fullName?.trim()) continue;
    if (m.status && m.status !== 'active') continue;
    if (ids.has(m.id) || typedNames.has(norm(m.fullName))) continue;
    ids.add(m.id);
    added.push({ name: m.fullName.trim(), subId: m.id });
  }
  return [...existing, ...added];
}
