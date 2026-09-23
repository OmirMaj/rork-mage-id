// utils/projectCap.ts — the free plan's one-project cap, counted the way the
// server counts it (audit wave 5, #58 / #127 / #57 / #155).
//
// WHY THIS EXISTS. The cap is enforced by the database trigger
// enforce_free_tier_project_cap (20260922100000, restated in 20260923040000).
// Its count is:
//
//     select count(*) from projects
//      where user_id = NEW.user_id and name not like 'Sample — %'
//
// — every non-sample project the user OWNS, finished or not. Home used to count
// every project in the list, including jobs another contractor shared with him,
// so a free foreman invited to one GC job was paywalled from creating his own
// first project, which the server would have accepted.
//
// Two things this module deliberately does NOT do:
//   • It does not exempt `type = 'awarded_rfp'`. The trigger exempts only the
//     award's own INSERT (award_rfp creating the row); once the awarded job
//     exists it counts like any other row he owns. Excluding it here would let
//     the app promise a create the server then refuses (productDecision #127 —
//     if the founder decides awarded jobs are free, this function, the trigger
//     count and the plan copy change together).
//   • It does not decide the tier. useTierAccess().canCreateProject compares
//     this count with the tier's maxProjects.
//
// Pure (no React, no RN) so scripts/validate-w5-project-cap-count.ts can run
// it under Bun.

import type { Project } from '@/types';

/**
 * The exact prefix the server treats as demo data: 'Sample', a space, an EM
 * DASH (U+2014), a space. Byte-identical to the trigger's `LIKE 'Sample — %'`
 * — a hyphen or en dash here would count a sample the server ignores.
 */
export const SAMPLE_PROJECT_PREFIX = 'Sample — ';

/** True when `name` is a demo project's name (seeded samples and their copies). */
export function isSampleProjectName(name: string | null | undefined): boolean {
  return typeof name === 'string' && name.startsWith(SAMPLE_PROJECT_PREFIX);
}

/**
 * True when `p` uses up the free plan's project slot for `userId`: it is not a
 * sample AND he owns it. Ownership is ProjectContext's owned test — an unset
 * ownerUserId counts as owned (a job created on this phone before its first
 * sync, or a cache predating the field), so an offline first job still counts.
 */
export function countsTowardFreeCap(
  p: Pick<Project, 'name' | 'ownerUserId'>,
  userId: string | null | undefined,
): boolean {
  if (isSampleProjectName(p.name)) return false;
  return !p.ownerUserId || p.ownerUserId === userId;
}

/** How many of `projects` count toward the free plan's one-project cap. */
export function capProjectCount(
  projects: readonly Pick<Project, 'name' | 'ownerUserId'>[],
  userId: string | null | undefined,
): number {
  let n = 0;
  for (const p of projects) if (countsTowardFreeCap(p, userId)) n += 1;
  return n;
}

/**
 * Data import is a project-create path too (integration review, wave 5): every
 * project in a backup is claimed by the importer (ownerUserId = him), so each
 * non-sample one takes a slot, and the server refuses every INSERT past the
 * cap. The screen used to report all of them imported while the server kept
 * one. This splits the NEW projects of a file, in file order, into the ones
 * the plan admits and the ones it holds back.
 *
 * `canCreateAt(count)` is useTierAccess().canCreateProject — "may he create
 * one more with `count` already counted?" — so a paid plan admits everything
 * and the free plan admits up to its one slot. Samples are always admitted
 * and never counted, as the trigger does.
 */
export function partitionImportForCap<T extends Pick<Project, 'name'>>(
  incomingNew: readonly T[],
  currentCapCount: number,
  canCreateAt: (count: number) => boolean,
): { admit: T[]; held: T[] } {
  const admit: T[] = [];
  const held: T[] = [];
  let count = currentCapCount;
  for (const p of incomingNew) {
    if (isSampleProjectName(p.name)) { admit.push(p); continue; }
    if (canCreateAt(count)) { admit.push(p); count += 1; } else { held.push(p); }
  }
  return { admit, held };
}
