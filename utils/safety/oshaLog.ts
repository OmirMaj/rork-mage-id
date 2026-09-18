// oshaLog.ts — pure OSHA Form 300 log assembly + serializers.
// No React Native / expo imports (the validator runs this under bun).
// The RN export glue (expo-print PDF, expo-sharing CSV) lives in
// utils/safety/oshaExport.ts and re-uses the builders here.
//
// Maps SafetyIncident records where oshaRecordable === true onto the OSHA 300
// column layout. Column outcomes are read from the incident's OWN recorded
// case-outcome fields — the most-serious-outcome rule for the G–J
// classification (fatality → days-away → restriction → other), the numeric
// daysAway/daysRestricted for cols K/L, and the explicit oshaIllnessType for
// col M. `severity` is an internal RISK rating, NOT a recorded outcome, so it
// is deliberately not used for any OSHA column.

import type { SafetyIncident, OshaIllnessType } from '@/types';
import { hasRestriction, isOshaRecordable } from './osha';
import { toCalendarDayString } from '@/utils/calendarDate';

export type { OshaIllnessType };
export type OshaClassification = 'death' | 'days_away' | 'restricted' | 'other';

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

/** OSHA most-serious-outcome rule (cols G–J): a case is classified by the single
 *  most severe recorded outcome, read from the incident's own fields — never
 *  from the internal severity rating. */
function classificationForOutcome(inc: SafetyIncident): OshaClassification {
  if (inc.fatality) return 'death';
  if ((inc.daysAway ?? 0) > 0) return 'days_away';
  // Column J, same rule the classifier uses: a counted day of restriction is a
  // restricted case even when the toggle was left off (audit round 2, #1).
  if (hasRestriction(inc)) return 'restricted';
  return 'other';
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
    classification: classificationForOutcome(inc),
    daysAway: inc.daysAway ?? 0,          // col K — recorded on the incident
    daysRestricted: inc.daysRestricted ?? 0, // col L — recorded on the incident
    illnessType: inc.oshaIllnessType ?? 'injury', // col M — explicit; default physical injury
  };
}

/**
 * Does this stored incident belong on the 300?
 *
 * The stored `oshaRecordable` flag OR the classifier re-run over the incident's
 * own recorded outcome fields. The re-run exists because the flag is a snapshot
 * of whatever classifier was live when the case was saved, and before audit
 * round 2 (#1) that classifier ignored the day-restricted count and rejected
 * every illness not typed 'injury'. Those cases are sitting in the register with
 * `oshaRecordable: false` and the evidence that they are recordable right beside
 * it; re-classifying here puts them on the log without a data migration.
 * It is a union, never a replacement: a case someone recorded stays recorded.
 */
export function isRecordableCase(inc: SafetyIncident): boolean {
  if (inc.oshaRecordable) return true;
  return isOshaRecordable({
    type: inc.type,
    treatment: inc.treatment ?? 'none',
    daysAway: inc.daysAway ?? 0,
    daysRestricted: inc.daysRestricted ?? 0,
    restrictedDuty: !!inc.restrictedDuty,
    lostConsciousness: !!inc.lostConsciousness,
    fatality: !!inc.fatality,
    oshaIllnessType: inc.oshaIllnessType,
  });
}

/** Build the full OSHA 300 log: recordable incidents only, scoped to a single
 *  calendar `year` (the OSHA 300 is a per-year, per-establishment form), sorted
 *  oldest→newest, numbered 1..N. Omit `year` to include every year (used by the
 *  pure-function validator). */
export function buildOsha300Log(incidents: SafetyIncident[], year?: string): Osha300Row[] {
  const recordable = incidents
    .filter(isRecordableCase)
    .filter((i) => !year || (i.occurredAt ?? '').slice(0, 4) === year)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
  return recordable.map((inc, idx) => oshaRowFromIncident(inc, idx + 1));
}

// ─────────────────────────────────────────────────────────────────────────
// OSHA 300A — the annual summary (audit round 2, safety-compliance #4).
//
// The 300 case list alone does not meet 1904.32: the employer must total the
// log, certify it and post the 300A Feb 1 – Apr 30. Two halves, built
// separately on purpose:
//
//  1. COLUMN TOTALS (G–M). Pure arithmetic over the rows buildOsha300Log already
//     returns, so it needs no new data and ships on the 300 PDF and CSV as-is.
//  2. HOURS WORKED + AVERAGE EMPLOYEES — the TRIR / DART denominators. MAGE only
//     sees crew clocked in through the app (no office staff, no salaried staff,
//     no employee-vs-sub flag on the roster), so its figure comes in LOW, and a
//     low hours figure makes the rate look WORSE than it is — the one number a
//     prequal or insurance renewal holds against him. So the time-tracking total
//     is only ever a pre-fill, labelled with where it came from, and a rate is
//     only computed from numbers he has confirmed. DFR manpower is deliberately
//     NOT a source: it counts subcontractors' crews, whose hours are not this
//     employer's.
// ─────────────────────────────────────────────────────────────────────────

export interface Osha300ATotals {
  /** Cols G–J: number of cases by most-serious outcome. */
  deaths: number;
  daysAwayCases: number;
  restrictedCases: number;
  otherCases: number;
  /** Cols K, L: total days. */
  totalDaysAway: number;
  totalDaysRestricted: number;
  /** Cols M(1)–M(6): number of cases by injury / illness type. */
  byType: Record<OshaIllnessType, number>;
  totalCases: number;
}

export function buildOsha300ATotals(rows: Osha300Row[]): Osha300ATotals {
  const byType: Record<OshaIllnessType, number> = {
    injury: 0, skin: 0, respiratory: 0, poisoning: 0, hearing: 0, other_illness: 0,
  };
  const t: Osha300ATotals = {
    deaths: 0, daysAwayCases: 0, restrictedCases: 0, otherCases: 0,
    totalDaysAway: 0, totalDaysRestricted: 0, byType, totalCases: rows.length,
  };
  for (const r of rows) {
    if (r.classification === 'death') t.deaths++;
    else if (r.classification === 'days_away') t.daysAwayCases++;
    else if (r.classification === 'restricted') t.restrictedCases++;
    else t.otherCases++;
    t.totalDaysAway += Math.max(0, r.daysAway || 0);
    t.totalDaysRestricted += Math.max(0, r.daysRestricted || 0);
    byType[r.illnessType] = (byType[r.illnessType] ?? 0) + 1;
  }
  return t;
}

/** The slice of a TimeEntry the hours pre-fill reads. Structural so this module
 *  stays free of the time-tracking hook. */
export interface HoursEntryLike {
  workerId: string;
  projectId: string;
  date: string;          // 'YYYY-MM-DD'
  /** When present, the day the shift was worked is its LOCAL clock-in day.
   *  Entries written before the calendar-day fix hold the UTC day in `date`,
   *  so an evening shift on Dec 31 landed in next year's pre-fill and a
   *  Sunday-evening shift in the following Monday-anchored week. */
  clockIn?: string;
  totalHours: number;
}

/** Same rule as utils/dfrClockCrew.clockInLocalDay: the local day of the
 *  clock-in instant, falling back to the stored date. */
function workedDay(e: HoursEntryLike): string {
  if (e.clockIn) {
    const d = new Date(e.clockIn);
    if (!Number.isNaN(d.getTime())) return toCalendarDayString(d);
  }
  return e.date ?? '';
}

export interface HoursPrefill {
  /** Sum of totalHours for entries dated in the year (and project, if scoped). */
  totalHours: number;
  /** Mean distinct workers per week, over the weeks that had any clock-in. */
  averageEmployees: number;
  entryCount: number;
  weekCount: number;
  /** What the numbers are, in one sentence, for the label under the fields. */
  sourceLabel: string;
}

/** Monday-anchored week key for a calendar day, computed on day numbers (no
 *  Date parsing of 'YYYY-MM-DD', which is UTC midnight and shifts a day west
 *  of Greenwich). */
function weekKey(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  // Days since 1970-01-01 via Date.UTC — a pure calendar count, no zone.
  const n = Math.floor(Date.UTC(y, mo - 1, d) / 86400000);
  // 1970-01-01 was a Thursday; shift so weeks start Monday.
  const monday = n - ((n + 3) % 7);
  return String(monday);
}

export function prefillHoursFromTimeEntries(
  entries: HoursEntryLike[],
  year: string,
  projectId?: string,
): HoursPrefill {
  let totalHours = 0;
  let entryCount = 0;
  const workersByWeek = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!e) continue;
    const day = workedDay(e);
    if (day.slice(0, 4) !== year) continue;
    if (projectId && e.projectId !== projectId) continue;
    const h = Number(e.totalHours);
    if (!Number.isFinite(h) || h <= 0) continue;
    totalHours += h;
    entryCount++;
    const wk = weekKey(day);
    if (!wk) continue;
    if (!workersByWeek.has(wk)) workersByWeek.set(wk, new Set());
    workersByWeek.get(wk)!.add(e.workerId || '(unnamed)');
  }
  const weekCount = workersByWeek.size;
  let sum = 0;
  for (const set of workersByWeek.values()) sum += set.size;
  const averageEmployees = weekCount > 0 ? Math.round(sum / weekCount) : 0;
  totalHours = Math.round(totalHours * 10) / 10;
  const sourceLabel = entryCount === 0
    ? `No MAGE time-tracking entries for ${year}${projectId ? ' on this project' : ''}. Enter hours worked from payroll.`
    : `From MAGE time tracking — ${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} over ${weekCount} week${weekCount === 1 ? '' : 's'}. `
      + 'Crew clocked in through the app only: add office, salaried and off-app hours from payroll.';
  return { totalHours, averageEmployees, entryCount, weekCount, sourceLabel };
}

/**
 * Cases per 200,000 hours (100 full-time workers × 50 weeks × 40 hours).
 * Null — not zero, not Infinity — when there is no confirmed hours figure: a
 * rate over an unknown denominator is a guess, and a "0.00" would be a lie.
 */
export function incidentRatePer200k(cases: number, hoursWorked: number): number | null {
  if (!Number.isFinite(hoursWorked) || hoursWorked <= 0) return null;
  if (!Number.isFinite(cases) || cases < 0) return null;
  return Math.round(((cases * 200000) / hoursWorked) * 100) / 100;
}

/** TRIR counts every recordable case; DART counts days-away + restricted
 *  (cols H + I). Deaths are in TRIR only, as OSHA's definitions have it. */
export function osha300ARates(totals: Osha300ATotals, confirmedHours: number): { trir: number | null; dart: number | null } {
  return {
    trir: incidentRatePer200k(totals.totalCases, confirmedHours),
    dart: incidentRatePer200k(totals.daysAwayCases + totals.restrictedCases, confirmedHours),
  };
}

/** What the export prints about the 300A denominators. Only numbers the user
 *  CONFIRMED on the screen reach a printed page. */
export interface Osha300ASummaryInput {
  hoursWorked: number;
  averageEmployees: number;
  /** One line on where the hours came from. */
  hoursSource: string;
  /** True when the screen is scoped to one project: the numbers are a project
   *  rate, never a certifiable establishment 300A. */
  projectScoped: boolean;
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
    '',
    ...osha300ATotalsCsvLines(buildOsha300ATotals(rows)),
  ];
  return lines.join('\n');
}

/** The column totals block the 300A carries forward — appended to the CSV so
 *  the February sum is not a hand job in a spreadsheet. */
export function osha300ATotalsCsvLines(t: Osha300ATotals): string[] {
  return [
    'Totals (Form 300A columns G–M)',
    'Deaths (G),Days-away cases (H),Job transfer / restriction cases (I),Other recordable cases (J),Days away (K),Days of restriction / transfer (L)',
    [t.deaths, t.daysAwayCases, t.restrictedCases, t.otherCases, t.totalDaysAway, t.totalDaysRestricted].join(','),
    'Injuries (M1),Skin disorders (M2),Respiratory conditions (M3),Poisonings (M4),Hearing loss (M5),All other illnesses (M6)',
    [t.byType.injury, t.byType.skin, t.byType.respiratory, t.byType.poisoning, t.byType.hearing, t.byType.other_illness].join(','),
  ];
}

/** Second page of the PDF: the 300A summary. A project-scoped export is titled
 *  as a project rate so it can never be posted as the establishment's 300A. */
function buildOsha300APageHtml(t: Osha300ATotals, est: OshaEstablishment, sum: Osha300ASummaryInput): string {
  const rates = osha300ARates(t, sum.hoursWorked);
  const fmt = (n: number | null) => (n == null ? '—' : n.toFixed(2));
  const title = sum.projectScoped
    ? `Project rate summary — ${esc(est.year)} (not the establishment 300A)`
    : `OSHA Form 300A — Summary of Work-Related Injuries and Illnesses — ${esc(est.year)}`;
  return `
  <section class="page-300a">
    <h2>${title}</h2>
    <p class="note">Hours worked and average employees as confirmed in MAGE. ${esc(sum.hoursSource)}
    Rates are cases × 200,000 ÷ hours worked. The 300A must be certified by a company executive and posted Feb 1 – Apr 30.</p>
    <table>
      <tbody>
        <tr><td>Deaths (G)</td><td class="num">${t.deaths}</td><td>Injuries (M1)</td><td class="num">${t.byType.injury}</td></tr>
        <tr><td>Days-away cases (H)</td><td class="num">${t.daysAwayCases}</td><td>Skin disorders (M2)</td><td class="num">${t.byType.skin}</td></tr>
        <tr><td>Job transfer / restriction cases (I)</td><td class="num">${t.restrictedCases}</td><td>Respiratory conditions (M3)</td><td class="num">${t.byType.respiratory}</td></tr>
        <tr><td>Other recordable cases (J)</td><td class="num">${t.otherCases}</td><td>Poisonings (M4)</td><td class="num">${t.byType.poisoning}</td></tr>
        <tr><td>Days away from work (K)</td><td class="num">${t.totalDaysAway}</td><td>Hearing loss (M5)</td><td class="num">${t.byType.hearing}</td></tr>
        <tr><td>Days of job transfer / restriction (L)</td><td class="num">${t.totalDaysRestricted}</td><td>All other illnesses (M6)</td><td class="num">${t.byType.other_illness}</td></tr>
        <tr><td>Annual average number of employees</td><td class="num">${sum.averageEmployees}</td><td>Total hours worked by all employees</td><td class="num">${sum.hoursWorked}</td></tr>
        <tr><td>TRIR (total recordable incident rate)</td><td class="num">${fmt(rates.trir)}</td><td>DART rate</td><td class="num">${fmt(rates.dart)}</td></tr>
      </tbody>
    </table>
  </section>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Branded printable HTML for the OSHA 300 log. Pure string — consumed by
 *  utils/safety/oshaExport.ts via expo-print. */
export function buildOsha300Html(rows: Osha300Row[], est: OshaEstablishment, summary?: Osha300ASummaryInput): string {
  const totals = buildOsha300ATotals(rows);
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
  tfoot td { font-weight: 700; border-top: 1.5px solid #ccc; }
  .page-300a { page-break-before: always; }
  .page-300a h2 { font-size: 16px; margin: 0 0 4px; }
  .page-300a .note { font-size: 10px; color: #555; margin: 0 0 12px; line-height: 1.5; }
  .page-300a table td { font-size: 11px; }
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
    <tfoot><tr class="totals">
      <td colspan="6">Totals — G ${totals.deaths} · H ${totals.daysAwayCases} · I ${totals.restrictedCases} · J ${totals.otherCases}</td>
      <td>M1 ${totals.byType.injury} · M2 ${totals.byType.skin} · M3 ${totals.byType.respiratory} · M4 ${totals.byType.poisoning} · M5 ${totals.byType.hearing} · M6 ${totals.byType.other_illness}</td>
      <td class="num">${totals.totalDaysAway}</td>
      <td class="num">${totals.totalDaysRestricted}</td>
      <td></td>
    </tr></tfoot>
  </table>
  ${summary ? buildOsha300APageHtml(totals, est, summary) : ''}
  <footer>Generated by MAGE ID · OSHA 300 Log · ${esc(capturedOn)} — verify against your recordkeeping before posting.</footer>
</body></html>`;
}
