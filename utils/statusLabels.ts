// statusLabels.ts — the one place a stored status / type enum becomes words a
// person reads (docs/VOICE.md §6 "Status labels").
//
// Pure: no react-native / expo imports, so the bun validators can import it
// (scripts/validate-status-labels.ts). Every schedule surface that shows a
// task status reads TASK_STATUS_LABEL / taskStatusLabel, so a status never
// renders in Title Case on one screen and sentence case on the next.

import type { PermitType, TaskStatus } from '@/types';

/** Task status → sentence-case label. Keys are the stored enum values. */
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  on_hold: 'On Hold',
  done: 'Complete',
};

/**
 * Acronyms that stay upper-case when an enum value is humanized. Keys are the
 * lower-case form the enum stores.
 */
const ACRONYMS: Record<string, string> = {
  ach: 'ACH',
  rfi: 'RFI',
  rfis: 'RFIs',
  co: 'CO',
  cos: 'COs',
  coi: 'COI',
  aia: 'AIA',
  wip: 'WIP',
  pdf: 'PDF',
  osha: 'OSHA',
  hvac: 'HVAC',
  mep: 'MEP',
  gc: 'GC',
  't&m': 'T&M',
  tm: 'T&M',
  jha: 'JHA',
  oac: 'OAC',
  ppe: 'PPE',
  sov: 'SOV',
  ahj: 'AHJ',
  csv: 'CSV',
};

/**
 * A stored enum value → a sentence-case label.
 *   'pending_review' → 'Pending review', 'net_30' → 'Net 30', 'ach' → 'ACH'.
 * Only the first word is capitalized; acronyms in ACRONYMS stay upper-case.
 * '' / null / undefined → ''.
 */
export function humanizeEnum(v: string | null | undefined): string {
  if (v == null) return '';
  const words = String(v)
    .trim()
    .replace(/[_\-\s]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length === 0) return '';
  return words
    .map((raw, i) => {
      const lower = raw.toLowerCase();
      const acronym = ACRONYMS[lower];
      if (acronym) return acronym;
      if (i === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
      return lower;
    })
    .join(' ');
}

/** Any task status (or an unknown string) → its label. */
export function taskStatusLabel(s: TaskStatus | string | null | undefined): string {
  if (s == null || s === '') return TASK_STATUS_LABEL.not_started;
  const known = (TASK_STATUS_LABEL as Record<string, string>)[s];
  return known ?? humanizeEnum(s);
}

/** Permit type → the name a GC says out loud ("Building permit"). */
export const PERMIT_TYPE_LABEL: Record<PermitType, string> = {
  building: 'Building Permit',
  electrical: 'Electrical Permit',
  plumbing: 'Plumbing Permit',
  mechanical: 'Mechanical Permit',
  demolition: 'Demolition Permit',
  grading: 'Grading Permit',
  fire: 'Fire Permit',
  occupancy: 'Certificate of Occupancy',
  special_inspection: 'Special Inspection',
  hot_work: 'Hot Work Permit',
  shutdown: 'System Shutdown Permit',
  after_hours: 'After-Hours Work Permit',
  landlord_approval: 'Landlord Approval',
  elevator_dock: 'Elevator and Dock Reservation',
  other: 'Permit',
};

/** Extra permit types the app has seen in imported / legacy data. */
const EXTRA_PERMIT_TYPE_LABEL: Record<string, string> = {
  fire_alarm: 'Fire Alarm Permit',
  sprinkler: 'Sprinkler Permit',
  sign: 'Sign Permit',
  roofing: 'Roofing Permit',
};

export function permitTypeLabel(type: string | null | undefined): string {
  if (type == null || String(type).trim() === '') return 'Permit';
  const key = String(type).trim().toLowerCase();
  const known = (PERMIT_TYPE_LABEL as Record<string, string>)[key] ?? EXTRA_PERMIT_TYPE_LABEL[key];
  if (known) return known;
  return `${humanizeEnum(key)} permit`;
}
