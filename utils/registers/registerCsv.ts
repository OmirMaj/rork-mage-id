// utils/registers/registerCsv.ts — the registers' CSV file name and the
// Contacts and Crew column lists (wave 6d, lane R1).
//
// The other registers (subs, COI vault, leads, deliveries, documents) export
// their own column lists from their row files (lanes R2 and R3); they share
// the file name and the column type from here.
//
// An UNKNOWN value is null, which utils/dataTable.rowsToCsv writes as an EMPTY
// cell — never '—' and never 0, so a spreadsheet SUM or COUNT is not lied to.
//
// PURE: type-only '@/types' imports plus pure utils — scripts/validate-
// registers.ts executes it under bun.

import type { Contact } from '@/types';
import { fileSlug } from '../logs/logRoutes';
import { contactDisplayName } from './contactRows';
import { CREW_ID_LABEL, type CrewRegisterRow } from './crewRows';

/** One CSV column: rowsToCsv's column shape, with csvValue required. */
export interface RegisterCsvColumn<T> {
  key: string;
  label: string;
  csvValue: (row: T) => string | number | null;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * `${stem}[-${fileSlug(projectName)}]-YYYY-MM-DD.csv` on the LOCAL calendar
 * day (the day on his wall calendar, not the UTC slice that names tomorrow
 * from 8 pm Eastern). A project name adds its slug; none adds nothing.
 */
export function registerCsvFileName(stem: string, date: Date, projectName?: string | null): string {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date(0);
  const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const project = typeof projectName === 'string' && projectName.trim() ? `-${fileSlug(projectName)}` : '';
  return `${stem}${project}-${day}.csv`;
}

/** '' (or whitespace) is unknown, not a value. */
const text = (s: string | null | undefined): string | null => (typeof s === 'string' && s.trim() ? s.trim() : null);

export const CONTACT_CSV_COLUMNS: readonly RegisterCsvColumn<Contact>[] = [
  { key: 'name', label: 'Name', csvValue: (c) => text(contactDisplayName(c)) },
  { key: 'first', label: 'First name', csvValue: (c) => text(c.firstName) },
  { key: 'last', label: 'Last name', csvValue: (c) => text(c.lastName) },
  { key: 'company', label: 'Company', csvValue: (c) => text(c.companyName) },
  { key: 'role', label: 'Role', csvValue: (c) => text(c.role) },
  { key: 'email', label: 'Email', csvValue: (c) => text(c.email) },
  { key: 'phone', label: 'Phone', csvValue: (c) => text(c.phone) },
  { key: 'address', label: 'Address', csvValue: (c) => text(c.address) },
  // A real count (0 is "linked to no project", which is known).
  { key: 'projects', label: 'Linked projects', csvValue: (c) => (Array.isArray(c.linkedProjectIds) ? c.linkedProjectIds.length : null) },
  { key: 'notes', label: 'Notes', csvValue: (c) => text(c.notes) },
];

export const CREW_CSV_COLUMNS: readonly RegisterCsvColumn<CrewRegisterRow>[] = [
  { key: 'name', label: 'Name', csvValue: (r) => text(r.name) },
  { key: 'status', label: 'Status', csvValue: (r) => (r.active ? 'Active' : 'Inactive') },
  { key: 'id', label: 'ID', csvValue: (r) => CREW_ID_LABEL[r.idBadge] },
  { key: 'trades', label: 'Trades', csvValue: (r) => text(r.trades) },
  { key: 'certs', label: 'Certifications', csvValue: (r) => r.certCount },
  { key: 'certExpiring', label: 'Certs expiring', csvValue: (r) => r.certExpiring },
  { key: 'certExpired', label: 'Certs expired', csvValue: (r) => r.certExpired },
  { key: 'projects', label: 'Projects', csvValue: (r) => r.projectCount },
  { key: 'claimed', label: 'Claimed', csvValue: (r) => (r.claimed ? 'Yes' : 'No') },
  { key: 'phone', label: 'Phone', csvValue: (r) => text(r.phone) },
  { key: 'email', label: 'Email', csvValue: (r) => text(r.email) },
];

/** The column lists this lane owns. R2 and R3 export theirs from their row files. */
export const REGISTER_CSV = {
  contacts: CONTACT_CSV_COLUMNS,
  crew: CREW_CSV_COLUMNS,
} as const;
