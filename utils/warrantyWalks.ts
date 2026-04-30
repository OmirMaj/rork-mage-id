// Warranty walk reminders — 11-month walks before 1-year contractor
// warranty expires.
//
// On most residential / light-commercial contracts (AIA A201 §12.2) the
// contractor's workmanship warranty runs one year from the date of
// substantial completion. Best practice is to walk the project with
// the owner at the 11-month mark to surface latent defects BEFORE the
// warranty expires — anything missed becomes the owner's problem.
//
// This file derives upcoming walks from the project list and exposes
// them to the home screen banner. No new screens, no database changes
// beyond the two fields on Project (substantialCompletionDate,
// warrantyWalkCompletedAt).

import type { Project } from '@/types';

const ONE_DAY_MS = 86_400_000;
const ONE_MONTH_MS = 30 * ONE_DAY_MS;

export interface WarrantyWalkAlert {
  project: Project;
  /** Days until the 11-month walk (negative = past 11 months). */
  daysUntilWalk: number;
  /** ISO date the walk should happen by. */
  walkDueDate: string;
  /** ISO date the warranty expires (12 months from SC). */
  warrantyExpiresAt: string;
  /** Severity for UI: 'upcoming' (1-2mo away), 'soon' (within 30d), 'urgent' (within 7d / past) */
  severity: 'upcoming' | 'soon' | 'urgent';
}

/**
 * Find projects with a substantial completion date that's between
 * ~9 and ~12 months ago AND haven't logged a warranty walk yet.
 * Sorted by how soon the walk needs to happen.
 */
export function getUpcomingWarrantyWalks(projects: Project[]): WarrantyWalkAlert[] {
  const now = Date.now();
  const out: WarrantyWalkAlert[] = [];

  for (const p of projects) {
    if (!p.substantialCompletionDate) continue;
    if (p.warrantyWalkCompletedAt) continue;

    const sc = new Date(p.substantialCompletionDate).getTime();
    if (isNaN(sc)) continue;

    // 11-month walk target = SC + 11 months
    const walkDate = sc + 11 * ONE_MONTH_MS;
    const warrantyExpires = sc + 12 * ONE_MONTH_MS;
    const daysUntilWalk = Math.round((walkDate - now) / ONE_DAY_MS);

    // Only surface when the walk is within ~3 months ahead OR up to a
    // month past due (after that, the warranty is expired and the
    // walk is mostly archival — we still flag it as urgent so the GC
    // sees they missed it).
    const daysUntilWarrantyExpires = Math.round((warrantyExpires - now) / ONE_DAY_MS);
    if (daysUntilWalk > 90) continue;          // not yet relevant
    if (daysUntilWarrantyExpires < -30) continue; // long-expired warranty

    let severity: WarrantyWalkAlert['severity'] = 'upcoming';
    if (daysUntilWalk <= 7) severity = 'urgent';
    else if (daysUntilWalk <= 30) severity = 'soon';

    out.push({
      project: p,
      daysUntilWalk,
      walkDueDate: new Date(walkDate).toISOString(),
      warrantyExpiresAt: new Date(warrantyExpires).toISOString(),
      severity,
    });
  }

  // Sort: most urgent first
  out.sort((a, b) => a.daysUntilWalk - b.daysUntilWalk);
  return out;
}

/** Friendly label for the banner. */
export function describeWalkTiming(alert: WarrantyWalkAlert): string {
  const d = alert.daysUntilWalk;
  if (d < 0) return `${Math.abs(d)} day${Math.abs(d) === 1 ? '' : 's'} overdue`;
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  if (d < 14) return `due in ${d} days`;
  if (d < 60) return `due in ${Math.round(d / 7)} weeks`;
  return `due in ${Math.round(d / 30)} months`;
}
