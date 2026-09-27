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
  not_started: 'Not started',
  in_progress: 'In progress',
  on_hold: 'On hold',
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
  building: 'Building permit',
  electrical: 'Electrical permit',
  plumbing: 'Plumbing permit',
  mechanical: 'Mechanical permit',
  demolition: 'Demolition permit',
  grading: 'Grading permit',
  fire: 'Fire permit',
  occupancy: 'Certificate of occupancy',
  special_inspection: 'Special inspection',
  hot_work: 'Hot work permit',
  shutdown: 'System shutdown permit',
  after_hours: 'After-hours work permit',
  landlord_approval: 'Landlord approval',
  elevator_dock: 'Elevator and dock reservation',
  other: 'Permit',
};

/** Extra permit types the app has seen in imported / legacy data. */
const EXTRA_PERMIT_TYPE_LABEL: Record<string, string> = {
  fire_alarm: 'Fire alarm permit',
  sprinkler: 'Sprinkler permit',
  sign: 'Sign permit',
  roofing: 'Roofing permit',
};

export function permitTypeLabel(type: string | null | undefined): string {
  if (type == null || String(type).trim() === '') return 'Permit';
  const key = String(type).trim().toLowerCase();
  const known = (PERMIT_TYPE_LABEL as Record<string, string>)[key] ?? EXTRA_PERMIT_TYPE_LABEL[key];
  if (known) return known;
  return `${humanizeEnum(key)} permit`;
}
