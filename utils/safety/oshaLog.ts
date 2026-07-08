// oshaLog.ts — pure OSHA Form 300 log assembly + serializers.
// No React Native / expo imports (the validator runs this under bun).
// The RN export glue (expo-print PDF, expo-sharing CSV) lives in
// utils/safety/oshaExport.ts and re-uses the builders here.
//
// Maps Wave-A SafetyIncident records where oshaRecordable === true onto the
// OSHA 300 column layout. Column outcomes (classification, days away/restricted,
// illness type) are DERIVED heuristically from the incident's severity + type
// because Wave A's SafetyIncident does not yet carry explicit OSHA outcome
// fields. When those fields are added, tighten oshaRowFromIncident — the row
// SHAPE stays the same.

import type { SafetyIncident } from '@/types';

export type OshaClassification = 'death' | 'days_away' | 'restricted' | 'other';
export type OshaIllnessType = 'injury' | 'skin' | 'respiratory' | 'poisoning' | 'hearing' | 'other_illness';

export interface OshaEstablishment {
  name: string;
  year: string; // 'YYYY'
}

export interface Osha300Row {
  caseNo: string;          // sequential 1..N within the log
  employeeName: string;    // first injured person, or '—'
  jobTitle: string;        // that person's role, or '—'
  dateOfIncident: string;  // 'YYYY-MM-DD'
  location: string;        // "where the event occurred"
  description: string;     // injury description if present, else incident description
  classification: OshaClassification; // OSHA 300 cols G–J
  daysAway: number;        // col K
  daysRestricted: number;  // col L
  illnessType: OshaIllnessType; // cols M(1)–M(6)
}

export const OSHA_CLASS_LABEL: Record<OshaClassification, string> = {
  death: 'Death',
  days_away: 'Days away from work',
  restricted: 'Job transfer / restriction',
  other: 'Other recordable case',
};

export const OSHA_ILLNESS_LABEL: Record<OshaIllnessType, string> = {
  injury: 'Injury',
  skin: 'Skin disorder',
  respiratory: 'Respiratory condition',
  poisoning: 'Poisoning',
  hearing: 'Hearing loss',
  other_illness: 'All other illnesses',
};

function classificationForSeverity(sev: SafetyIncident['severity']): OshaClassification {
  switch (sev) {
    case 'critical': return 'death';
    case 'high':     return 'days_away';
    case 'medium':   return 'restricted';
    default:         return 'other';
  }
}

function illnessForType(type: SafetyIncident['type']): OshaIllnessType {
  switch (type) {
    case 'environmental': return 'respiratory';
    case 'injury':        return 'injury';
    default:              return 'injury';
  }
}

/** Assemble a single OSHA 300 row from an incident and its 1-based case number. */
export function oshaRowFromIncident(inc: SafetyIncident, caseNumber: number): Osha300Row {
  const person = inc.peopleInvolved && inc.peopleInvolved.length > 0 ? inc.peopleInvolved[0] : undefined;
  return {
    caseNo: String(caseNumber),
    employeeName: person?.name ?? '—',
    jobTitle: person?.role ?? '—',
    dateOfIncident: (inc.occurredAt ?? '').slice(0, 10),
    location: inc.location ?? '',
    description: person?.injuryDescription || inc.description || '',
    classification: classificationForSeverity(inc.severity),
    daysAway: 0,        // no field on SafetyIncident yet — see header note
    daysRestricted: 0,  // no field on SafetyIncident yet — see header note
    illnessType: illnessForType(inc.type),
  };
}

/** Build the full OSHA 300 log: recordable incidents only, sorted oldest→newest,
 *  numbered 1..N. */
export function buildOsha300Log(incidents: SafetyIncident[]): Osha300Row[] {
  const recordable = incidents
    .filter((i) => i.oshaRecordable)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
  return recordable.map((inc, idx) => oshaRowFromIncident(inc, idx + 1));
}

/** RFC-4180-ish CSV cell escaping: quote when the value has a comma, quote,
 *  or newline; double interior quotes. */
export function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function osha300ToCsv(rows: Osha300Row[], est: OshaEstablishment): string {
  const header = ['Case No.', 'Employee', 'Job Title', 'Date', 'Location', 'Description', 'Classification', 'Days Away', 'Days Restricted', 'Type'];
  const lines: string[] = [
    'OSHA Form 300 — Log of Work-Related Injuries and Illnesses',
    `Establishment:,${csvCell(est.name)},Year:,${csvCell(est.year)}`,
    '',
    header.join(','),
    ...rows.map((r) => [
      r.caseNo, r.employeeName, r.jobTitle, r.dateOfIncident, r.location, r.description,
      OSHA_CLASS_LABEL[r.classification], String(r.daysAway), String(r.daysRestricted), OSHA_ILLNESS_LABEL[r.illnessType],
    ].map(csvCell).join(',')),
  ];
  return lines.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Branded printable HTML for the OSHA 300 log. Pure string — consumed by
 *  utils/safety/oshaExport.ts via expo-print. */
export function buildOsha300Html(rows: Osha300Row[], est: OshaEstablishment): string {
  const body = rows.length
    ? rows.map((r) => `
        <tr>
          <td class="num">${esc(r.caseNo)}</td>
          <td>${esc(r.employeeName)}</td>
          <td>${esc(r.jobTitle)}</td>
          <td>${esc(r.dateOfIncident)}</td>
          <td>${esc(r.location)}</td>
          <td>${esc(r.description)}</td>
          <td>${esc(OSHA_CLASS_LABEL[r.classification])}</td>
          <td class="num">${r.daysAway}</td>
          <td class="num">${r.daysRestricted}</td>
          <td>${esc(OSHA_ILLNESS_LABEL[r.illnessType])}</td>
        </tr>`).join('')
    : `<tr><td colspan="10" class="empty">No recordable cases for ${esc(est.year)}.</td></tr>`;
  const capturedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>OSHA 300 Log — ${esc(est.name)} — ${esc(est.year)}</title>
<style>
  @page { size: A4 landscape; margin: 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; margin: 0; font-size: 11px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 10px; border-bottom: 2px solid #FF9500; margin-bottom: 14px; }
  header .brand { font-size: 10px; font-weight: 800; color: #FF9500; letter-spacing: 3px; text-transform: uppercase; }
  header h1 { font-size: 18px; margin: 4px 0 0; }
  header .meta { text-align: right; font-size: 10px; color: #555; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { font-size: 9px; text-transform: uppercase; color: #666; text-align: left; padding: 6px 8px; border-bottom: 1.5px solid #ccc; letter-spacing: 0.5px; }
  td { font-size: 10px; padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.empty { text-align: center; color: #888; padding: 24px; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 16px; font-size: 9px; color: #888; text-align: right; }
</style></head>
<body>
  <header>
    <div>
      <div class="brand">MAGE Safety · OSHA Form 300</div>
      <h1>${esc(est.name)}</h1>
    </div>
    <div class="meta">
      <div>Log year: <b>${esc(est.year)}</b></div>
      <div>Recordable cases: <b>${rows.length}</b></div>
      <div>Generated: ${esc(capturedOn)}</div>
    </div>
  </header>
  <table>
    <thead><tr>
      <th>Case</th><th>Employee</th><th>Job Title</th><th>Date</th><th>Location</th>
      <th>Description</th><th>Classification</th><th>Days Away</th><th>Days Restr.</th><th>Type</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  <footer>Generated by MAGE ID · OSHA 300 Log · ${esc(capturedOn)} — verify against your recordkeeping before posting.</footer>
</body></html>`;
}
