// utils/payApp/sovSpreadsheet.ts — the schedule of values, in and out of a
// spreadsheet. Easier Pay Applications, Phase 1.
//
// OUT: the continuation sheet in the standard column order (A to J), as
// comma-separated text for a file or tab-separated text for the clipboard, so
// the contractor can type or paste his figures into the software his owner
// requires. The headers are MAGE ID's own plain words. The export carries no
// form name, no publisher's name and no logo, and the product never says it
// fills anyone's official form (SOV_EXPORT_COPY.claim is the one sentence).
//
// IN: a schedule of values from pasted text or a .csv / .tsv file. Nothing is
// written until the contractor has seen the mapping and confirmed it, and:
//   • a row is never silently dropped: every row is imported, or counted as
//     blank, or counted as a total row, or listed as unreadable with why;
//   • an import onto an application that already has money on it never writes
//     column D, E or F and never removes a line;
//   • a cell that is not an amount is never read as zero, and a number the
//     app would have to guess at (a comma used for decimals, spaces between
//     digits, a percent sign in a money column) is listed as unreadable;
//   • text that a spreadsheet would run as a formula is exported with a
//     leading single quote, and the import takes that quote back off.
//
// Spreadsheet (.xlsx) files are not read in this phase: no spreadsheet library
// ships in the app. Save As CSV, or copy the cells and paste.
//
// Pure: text in, values out. No file system, no clipboard, no clock.
import {
  computeAIATotals, g703LineFigures,
  type AIAPayApplication, type AIASOVLine,
} from '@/utils/aiaBilling';
import { roundCents } from '@/utils/invoiceBilling';
import { MAX_PASTE_ROWS } from '@/utils/pasteRows';

// ── Export ──────────────────────────────────────────────────────────────────

/** Column headers, in the standard continuation-sheet order A to J. MAGE ID's own words. */
export const SOV_EXPORT_HEADERS: readonly string[] = [
  'Item No.',
  'Description of Work',
  'Scheduled Value',
  'From Previous Application',
  'This Period',
  'Materials Presently Stored',
  'Total Completed and Stored to Date',
  'Percent',
  'Balance to Finish',
  'Retainage',
];
/** A to F: the columns a person types. G to J are sums the receiving software works out itself. */
export const SOV_ENTRY_COLUMN_COUNT = 6;

export const SOV_EXPORT_COPY = {
  claim: 'Export your figures to type or paste into the software your owner requires.',
  copyForSpreadsheet: 'Copy for Spreadsheet',
  exportCsv: 'Export CSV',
  copyCover: 'Copy Cover Figures',
  entryOnly: 'Entry Columns Only',
  entryOnlyHint: 'Item through stored only, for software that works out the totals itself.',
  includeHeader: 'Header Row',
  copiedTitle: 'Copied',
  copiedBody: (rows: number) => `${rows} ${rows === 1 ? 'line' : 'lines'} copied. Paste into your spreadsheet.`,
  coverCopiedBody: 'Cover figures copied. Paste into your spreadsheet.',
  exportFailedTitle: 'Couldn’t Export',
  exportFailedBody: 'The file could not be made. Try again.',
} as const;

const num2 = (n: number): string => (Number.isFinite(n) ? roundCents(n).toFixed(2) : '0.00');

export interface SovExportOptions {
  /** A to F only. */
  entryOnly?: boolean;
  /** Default true. */
  header?: boolean;
}

/**
 * A spreadsheet runs a cell that starts with = + - @ (or a tab or a carriage
 * return) as a formula. A description is his own text, never a formula, so a
 * text cell that starts that way leaves with a single quote in front, which a
 * spreadsheet shows as plain text. A cell that already starts with a single
 * quote gets one too, so `unguardTextCell` can take exactly one back off and
 * the round trip returns what he typed.
 */
const FORMULA_LEAD = /^[=+\-@\t\r']/;
export function guardTextCell(cell: string): string {
  return FORMULA_LEAD.test(cell) ? `'${cell}` : cell;
}
/** The import's half: one leading single quote comes off when a guarded character follows it. */
export function unguardTextCell(cell: string): string {
  return cell.startsWith("'") && FORMULA_LEAD.test(cell.slice(1)) ? cell.slice(1) : cell;
}

/** The byte-order mark a spreadsheet needs to read a UTF-8 file's accents and inch marks. */
export const CSV_BOM = '\uFEFF';

/** The rows of the export: text in A and B, plain numbers (two decimals, no symbol, no separators) after. */
export function sovExportRows(app: Pick<AIAPayApplication, 'lines'>, opts: SovExportOptions = {}): string[][] {
  const width = opts.entryOnly ? SOV_ENTRY_COLUMN_COUNT : SOV_EXPORT_HEADERS.length;
  const rows: string[][] = [];
  if (opts.header !== false) rows.push(SOV_EXPORT_HEADERS.slice(0, width));
  for (const l of app.lines) {
    const f = g703LineFigures(l);
    rows.push([
      guardTextCell(l.itemNo),
      guardTextCell(l.description),
      num2(l.scheduledValue),
      num2(l.fromPreviousApp),
      num2(l.thisPeriod),
      num2(l.materialsPresentlyStored),
      num2(f.completedAndStored),
      f.percent == null ? '' : f.percent.toFixed(2),
      num2(f.balanceToFinish),
      num2(f.retainage),
    ].slice(0, width));
  }
  return rows;
}

function quoteCell(cell: string, delimiter: string): string {
  return cell.includes(delimiter) || /["\r\n]/.test(cell) || /^\s|\s$/.test(cell)
    ? `"${cell.replace(/"/g, '""')}"`
    : cell;
}

/** Rows as delimited text, quoted where a cell needs it (RFC 4180). */
export function toDelimited(rows: readonly (readonly string[])[], delimiter: ',' | '\t'): string {
  return rows.map(r => r.map(c => quoteCell(c, delimiter)).join(delimiter)).join('\r\n');
}

export function sovExportCsv(app: Pick<AIAPayApplication, 'lines'>, opts?: SovExportOptions): string {
  return toDelimited(sovExportRows(app, opts), ',');
}

export function sovExportTsv(app: Pick<AIAPayApplication, 'lines'>, opts?: SovExportOptions): string {
  return toDelimited(sovExportRows(app, opts), '\t');
}

/** The CSV as it is written to a FILE: the same text behind a byte-order mark. */
export function sovExportCsvFile(app: Pick<AIAPayApplication, 'lines'>, opts?: SovExportOptions): string {
  return `${CSV_BOM}${sovExportCsv(app, opts)}`;
}

/** Cover figures 1 to 9 as label, value: his own numbers under MAGE ID's own labels. */
export function coverFigureRows(app: AIAPayApplication): string[][] {
  const t = computeAIATotals(app);
  return [
    ['1. Original Contract Sum', num2(app.originalContractSum)],
    ['2. Net Change by Change Orders', num2(app.netChangeByCO)],
    ['3. Contract Sum to Date', num2(app.contractSumToDate)],
    ['4. Total Completed and Stored to Date', num2(t.totalCompletedAndStored)],
    ['5. Retainage', num2(t.totalRetainage)],
    ['6. Total Earned Less Retainage', num2(t.totalEarnedLessRetainage)],
    ['7. Less Previous Certificates', num2(app.lessPreviousCertificates)],
    ['8. Current Payment Due', num2(t.currentPaymentDue)],
    ['9. Balance to Finish, Including Retainage', num2(t.balanceToFinish)],
  ];
}

export function sovExportFileName(applicationNumber: number): string {
  return `schedule-of-values-application-${applicationNumber}.csv`;
}

// ── Import: read ────────────────────────────────────────────────────────────

/**
 * Delimited text to cells. Tab-separated when the first line holds a tab, else
 * comma-separated. Quotes, doubled quotes, delimiters and line breaks inside
 * quotes, CRLF and a leading byte-order mark are all read.
 */
export function parseDelimited(text: string): string[][] {
  return readDelimited(text).rows;
}

export interface DelimitedRead {
  rows: string[][];
  /** 1-based row where a quotation mark opens and never closes, or null. */
  unterminatedQuoteRow: number | null;
}

/** parseDelimited, plus whether a quoted cell was left open (the rows after it cannot be told apart). */
export function readDelimited(text: string): DelimitedRead {
  const src = text.replace(/^\uFEFF/, '');
  const firstBreak = src.search(/[\r\n]/);
  const firstLine = firstBreak < 0 ? src : src.slice(0, firstBreak);
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let quoteOpenedOnRow = 0;
  const endCell = () => { row.push(wasQuoted ? cell : cell.trim()); cell = ''; wasQuoted = false; };
  const endRow = () => { endCell(); rows.push(row); row = []; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === '') { quoted = true; wasQuoted = true; cell = ''; quoteOpenedOnRow = rows.length + 1; continue; }
    if (ch === delimiter) { endCell(); continue; }
    if (ch === '\r') { if (src[i + 1] === '\n') i++; endRow(); continue; }
    if (ch === '\n') { endRow(); continue; }
    cell += ch;
  }
  const unterminatedQuoteRow = quoted ? quoteOpenedOnRow : null;
  if (cell !== '' || wasQuoted || row.length > 0) endRow();
  // A trailing line break is not a row.
  while (rows.length && rows[rows.length - 1].every(c => c === '')) rows.pop();
  return { rows, unterminatedQuoteRow };
}

// ── Import: money ───────────────────────────────────────────────────────────

export type MoneyCellProblem = 'percent' | 'comma_decimal' | 'spaces' | 'decimals' | 'not_amount';
export type MoneyCell = { ok: true; value: number } | { ok: false; problem: MoneyCellProblem };

/**
 * A money cell, read strictly. Accepted: digits with an optional decimal point
 * and up to two decimal places (more only when they are zeros), commas as
 * thousands separators in groups of three, one currency symbol, a leading
 * minus, and parentheses for a negative. Anything the app would have to GUESS
 * at is a problem and is never a number: "1.234,56" and "1,5" (a comma for
 * decimals), "1 234,56" (spaces between digits), "50%" (a percent in a money
 * column), "1.234" (three decimals).
 */
export function parseMoneyCell(raw: string): MoneyCell {
  let s = String(raw ?? '').trim();
  const bad = (problem: MoneyCellProblem): MoneyCell => ({ ok: false, problem });
  if (!s) return bad('not_amount');
  if (s.includes('%')) return bad('percent');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1).trim(); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1).trim(); }
  if (/^[$\u20AC\u00A3]/.test(s)) s = s.slice(1).trim();
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1).trim(); }
  if (/^\d[\d.,]*\s+[\d.,\s]*\d$/.test(s) || /^\d[\d\s]*\s\d/.test(s)) return bad('spaces');
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d+,\d{1,2}$/.test(s) || /^\d{1,3}(,\d{3})*,\d{1,2}$/.test(s)) return bad('comma_decimal');
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/.exec(s);
  if (!m || (m[1] == null && !m[2])) return bad('not_amount');
  if (m[2] && m[2].replace(/0+$/, '').length > 2) return bad('decimals');
  const n = Number.parseFloat(`${(m[1] ?? '0').replace(/,/g, '')}.${m[2] || '0'}`);
  if (!Number.isFinite(n)) return bad('not_amount');
  return { ok: true, value: negative ? -n : n };
}

export type SovField = 'itemNo' | 'description' | 'scheduled' | 'previous' | 'thisPeriod' | 'stored';
export const SOV_FIELDS: readonly SovField[] = ['itemNo', 'description', 'scheduled', 'previous', 'thisPeriod', 'stored'];
export type SovColumnMapping = Partial<Record<SovField, number>>;

export const SOV_FIELD_LABEL: Record<SovField, string> = {
  itemNo: 'Item No.',
  description: 'Description of Work',
  scheduled: 'Scheduled Value',
  previous: 'From Previous Application',
  thisPeriod: 'This Period',
  stored: 'Materials Presently Stored',
};

/** A computed column (G to J) is never an input, whatever word it shares with one. */
const COMPUTED_HEADER = /total|balance|percent|%|retain/i;
/** In this order: "From Previous Application" must not be read as a description of work. */
const HEADER_WORDS: [SovField, RegExp][] = [
  ['previous', /previous|prior/i],
  ['thisPeriod', /this\s*period|work\s*this|current/i],
  ['stored', /stored/i],
  ['scheduled', /scheduled|value|amount|budget/i],
  ['description', /description|work|scope|name/i],
  ['itemNo', /item|\bno\b|#|number/i],
];

/**
 * A header that names the CONTRACT is never this period's work, whatever other
 * word it carries: "Current Contract Value" is column C. Reading it as This
 * Period would bill the whole contract in one month.
 */
const NEVER_THIS_PERIOD = /contract|scheduled|value|budget|\bsum\b/i;

export interface SovColumnDetection {
  hasHeader: boolean;
  mapping: SovColumnMapping;
  /** Widest row, so the mapping screen can offer every column. */
  columnCount: number;
}

/** Guess which column is which: by header words when the first row is a header, else by position. */
export function detectSovColumns(rows: readonly (readonly string[])[]): SovColumnDetection {
  const columnCount = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const first = rows[0] ?? [];
  const mapping: SovColumnMapping = {};
  const looksLikeHeader = first.length > 0
    && first.every(c => !parseMoneyCell(c).ok)
    && first.some(c => HEADER_WORDS.some(([, re]) => re.test(c)));
  if (looksLikeHeader) {
    const taken = new Set<number>();
    for (const [field, re] of HEADER_WORDS) {
      // "Total Completed and Stored to Date" is not the stored column, and
      // "Balance to Finish" is not anything a person enters.
      const idx = first.findIndex((c, i) => !taken.has(i) && !COMPUTED_HEADER.test(c) && re.test(c)
        && !(field === 'thisPeriod' && NEVER_THIS_PERIOD.test(c)));
      if (idx >= 0) { mapping[field] = idx; taken.add(idx); }
    }
    return { hasHeader: true, mapping, columnCount };
  }
  if (columnCount === 2) return { hasHeader: false, mapping: { description: 0, scheduled: 1 }, columnCount };
  const positional: SovField[] = ['itemNo', 'description', 'scheduled', 'previous', 'thisPeriod', 'stored'];
  positional.forEach((f, i) => { if (i < columnCount && columnCount >= 3) mapping[f] = i; });
  return { hasHeader: false, mapping, columnCount };
}

// ── Import: plan ────────────────────────────────────────────────────────────

export interface SovImportRow {
  /** 1-based row in the pasted text or file, counting the header. */
  rowNumber: number;
  itemNo: string;
  description: string;
  scheduledValue: number;
  /** Set only when the column was mapped and the cell held an amount. */
  fromPreviousApp?: number;
  thisPeriod?: number;
  materialsPresentlyStored?: number;
}

export interface SovImportBadRow { rowNumber: number; reason: string; cells: string[] }

export interface SovImportPlan {
  rows: SovImportRow[];
  /** Blank description and blank scheduled value. */
  skippedBlank: number;
  /** "Total" / "Grand Total" rows, left out and counted. */
  skippedTotals: number;
  /** Listed, never imported, never read as zero. */
  bad: SovImportBadRow[];
  sumScheduled: number;
  /** True when description and scheduled value are both mapped. */
  mappable: boolean;
  /** Rows past the cap (MAX_PASTE_ROWS), not read. Counted and said, never dropped silently. */
  overCap: number;
  /** Item numbers that are in the file more than once, as he wrote them. */
  duplicateItemNos: string[];
}

/** The most rows one import reads. */
export const SOV_IMPORT_ROW_CAP = MAX_PASTE_ROWS;

/** Why a money cell was not read. Each ends the sentence `"<cell>" …`. */
export const MONEY_PROBLEM_COPY: Record<MoneyCellProblem, string> = {
  percent: 'has a percent sign, and this column holds dollar amounts.',
  comma_decimal: 'looks like it uses a comma for decimals. Type it like 1,234.56.',
  spaces: 'has spaces between the digits. Type it like 1,234.56.',
  decimals: 'has more than two decimal places.',
  not_amount: 'is not an amount.',
};

export const SOV_IMPORT_COPY = {
  title: 'Import Schedule of Values',
  open: 'Import Schedule of Values',
  pasteHint: 'Paste rows copied from a spreadsheet, or pick a .csv or .tsv file. Nothing changes until you confirm.',
  pasteLabel: 'Pasted Rows',
  pickFile: 'Pick a File',
  readRows: 'Read Rows',
  mappingHeading: 'Columns',
  mappingHint: 'These are the first rows under each column the app picked. Change a column if it picked wrong.',
  notMapped: 'Not Used',
  firstRowIsHeader: 'First Row Is a Header',
  summaryHeading: 'What Will Be Imported',
  needColumns: 'Pick the description and scheduled value columns to continue.',
  rowsLine: (n: number) => `${n} ${n === 1 ? 'row' : 'rows'} read`,
  blankLine: (n: number) => `${n} blank ${n === 1 ? 'row' : 'rows'} left out`,
  totalsLine: (n: number) => `${n} total ${n === 1 ? 'row' : 'rows'} left out`,
  badLine: (n: number) => `${n} ${n === 1 ? 'row' : 'rows'} could not be read and will not be imported`,
  badRow: (rowNumber: number, reason: string) => `Row ${rowNumber}: ${reason}`,
  badScheduled: (cell: string, problem: MoneyCellProblem = 'not_amount') =>
    (cell.trim() ? `"${cell}" ${MONEY_PROBLEM_COPY[problem]}` : 'The scheduled value is blank.'),
  badMoney: (label: string, cell: string, problem: MoneyCellProblem = 'not_amount') => `${label} "${cell}" ${MONEY_PROBLEM_COPY[problem]}`,
  overCapLine: (cap: number, n: number) =>
    `Only the first ${cap} rows are read. ${n} ${n === 1 ? 'row' : 'rows'} past that will not be imported. Import the rest separately.`,
  duplicateLine: (itemNos: string[]) =>
    `${itemNos.length === 1 ? `Item number ${itemNos[0]} is` : `Item numbers ${itemNos.join(', ')} are`} in the file more than once. `
    + 'When lines are matched by item number, only the first row updates a line. The others are added as new lines.',
  unterminatedQuoteBody: (row: number) =>
    `A quotation mark opens on row ${row} and never closes, so the rows after it cannot be told apart. Close the quotation mark in that cell and try again.`,
  afterImportLabel: 'Schedule of Values After Import',
  contractLabel: 'Contract Sum to Date',
  differenceLabel: 'Difference from Contract Sum',
  noDifference: 'No difference',
  replaceAll: 'Replace the Schedule of Values',
  replaceAllHint: 'No line has money on it yet, so the imported rows become the schedule of values. Previous work, this period and stored materials are written from the file where you picked those columns.',
  updateAndAdd: 'Update Matching Lines, Add the Rest',
  updateAndAddHint: 'Lines with the same item number get the imported description and scheduled value. Rows with a new item number are added at zero. Billed amounts stay as they are and no line is removed.',
  appendAll: 'Add All as New Lines',
  appendAllHint: 'Every imported row is added as a new line at zero. Nothing on the lines you have changes.',
  cancel: 'Cancel',
  back: 'Back',
  couldNotRead: 'Couldn’t Read That',
  emptyBody: 'No rows were found. Paste rows from a spreadsheet, or pick a .csv or .tsv file.',
  spreadsheetFileBody: 'That looks like a spreadsheet file. Save it as CSV first, or copy the cells and paste them here.',
  nothingToImport: 'No row can be imported. Check the columns above.',
  doneTitle: 'Schedule of Values Imported',
  doneBody: (updated: number, added: number) => {
    const parts: string[] = [];
    if (updated > 0) parts.push(`${updated} ${updated === 1 ? 'line' : 'lines'} updated`);
    if (added > 0) parts.push(`${added} ${added === 1 ? 'line' : 'lines'} added`);
    return `${parts.join(', ') || 'No lines changed'}. Look the lines over before you save.`;
  },
} as const;

/** A row that is only a sum: "Total", "Grand Total:", "Subtotal". */
const TOTAL_WORD = /^\s*(grand\s+|sub\s*)?totals?\b[\s:.]*$/i;
/** "Total Contract" with no item number is a sum row too; "Total Station Layout" as item 4 is work. */
const TOTAL_LEAD = /^\s*(grand\s+|sub\s*)?totals?\b/i;
const isTotalRow = (itemNo: string, description: string): boolean =>
  TOTAL_WORD.test(description) || TOTAL_WORD.test(itemNo) || (!itemNo && TOTAL_LEAD.test(description));

/**
 * An item number as it is compared: trimmed, lower case, and a decimal part of
 * only zeros dropped, so "3.0" is "3". "1.10" stays "1.10": in an outline that
 * is item ten of section one, not item one.
 */
export function itemKey(s: string): string {
  const t = s.trim().toLowerCase();
  const m = /^(\d+)\.0+$/.exec(t);
  return m ? m[1] : t;
}

/** Read the mapped rows. Every source row lands in exactly one of: rows, blank, totals, bad, past the cap. */
export function planSovImport(input: {
  rows: readonly (readonly string[])[];
  mapping: SovColumnMapping;
  hasHeader: boolean;
}): SovImportPlan {
  const { mapping } = input;
  const plan: SovImportPlan = {
    rows: [], skippedBlank: 0, skippedTotals: 0, bad: [], sumScheduled: 0,
    mappable: mapping.description != null && mapping.scheduled != null,
    overCap: 0, duplicateItemNos: [],
  };
  if (!plan.mappable) return plan;
  const at = (r: readonly string[], f: SovField): string => {
    const i = mapping[f];
    return i == null ? '' : String(r[i] ?? '').trim();
  };
  const all = input.hasHeader ? input.rows.slice(1) : input.rows;
  const body = all.slice(0, SOV_IMPORT_ROW_CAP);
  plan.overCap = all.length - body.length;
  body.forEach((r, i) => {
    const rowNumber = i + 1 + (input.hasHeader ? 1 : 0);
    // Text cells: the quote the export put in front of a formula-like cell comes back off.
    const itemNo = unguardTextCell(at(r, 'itemNo')).trim();
    const description = unguardTextCell(at(r, 'description')).trim();
    const scheduledText = at(r, 'scheduled');
    if (!description && !scheduledText) { plan.skippedBlank += 1; return; }
    if (isTotalRow(itemNo, description)) {
      plan.skippedTotals += 1;
      return;
    }
    const scheduled = parseMoneyCell(scheduledText);
    if (!scheduled.ok) {
      plan.bad.push({ rowNumber, reason: SOV_IMPORT_COPY.badScheduled(scheduledText, scheduled.problem), cells: [...r] });
      return;
    }
    const row: SovImportRow = { rowNumber, itemNo, description, scheduledValue: roundCents(scheduled.value) };
    const money: [SovField, 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored'][] = [
      ['previous', 'fromPreviousApp'], ['thisPeriod', 'thisPeriod'], ['stored', 'materialsPresentlyStored'],
    ];
    for (const [field, key] of money) {
      if (mapping[field] == null) continue;
      const text = at(r, field);
      if (!text) { row[key] = 0; continue; }
      const n = parseMoneyCell(text);
      if (!n.ok) {
        plan.bad.push({ rowNumber, reason: SOV_IMPORT_COPY.badMoney(SOV_FIELD_LABEL[field], text, n.problem), cells: [...r] });
        return;
      }
      row[key] = roundCents(n.value);
    }
    plan.rows.push(row);
  });
  plan.sumScheduled = roundCents(plan.rows.reduce((s, r) => s + r.scheduledValue, 0));
  const seen = new Map<string, number>();
  const firstSpelling = new Map<string, string>();
  for (const r of plan.rows) {
    if (!r.itemNo) continue;
    const k = itemKey(r.itemNo);
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (!firstSpelling.has(k)) firstSpelling.set(k, r.itemNo);
  }
  plan.duplicateItemNos = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => firstSpelling.get(k) ?? k);
  return plan;
}

// ── Import: apply ───────────────────────────────────────────────────────────

/**
 * 'replace_all'      only when NO line carries money: the imported rows become the lines.
 * 'update_and_append' lines matched by item number take the imported description and scheduled
 *                    value; unmatched rows are added at zero.
 * 'append'           every row is added as a new line at zero.
 */
export type SovImportMode = 'replace_all' | 'update_and_append' | 'append';

const lineMoney = (l: Pick<AIASOVLine, 'fromPreviousApp' | 'thisPeriod' | 'materialsPresentlyStored'>): number =>
  Math.abs(l.fromPreviousApp || 0) + Math.abs(l.thisPeriod || 0) + Math.abs(l.materialsPresentlyStored || 0);

/** True when any line has billed or stored money on it: the import may then only update and add. */
export function applicationHasMoney(app: Pick<AIAPayApplication, 'lines'>): boolean {
  return app.lines.some(l => lineMoney(l) > 0.005);
}

/** The modes the screen may offer for this application. */
export function sovImportModesFor(app: Pick<AIAPayApplication, 'lines'>): SovImportMode[] {
  return applicationHasMoney(app) ? ['update_and_append', 'append'] : ['replace_all', 'update_and_append', 'append'];
}

export interface SovImportOutcome {
  app: AIAPayApplication;
  updated: number;
  added: number;
  /** Set, with the application returned unchanged, when the mode is not allowed. */
  refused?: 'has_money';
}


/**
 * Put the planned rows on the application. `idSeed` makes the new line ids
 * (passed in so this stays pure); ids are checked against the lines already
 * there.
 */
export function applySovImport(input: {
  app: AIAPayApplication;
  plan: Pick<SovImportPlan, 'rows'>;
  mode: SovImportMode;
  idSeed: string;
}): SovImportOutcome {
  const { app, plan, mode } = input;
  const hasMoney = applicationHasMoney(app);
  if (mode === 'replace_all' && hasMoney) return { app, updated: 0, added: 0, refused: 'has_money' };

  const used = new Set(app.lines.map(l => l.id));
  let serial = 0;
  const newId = (): string => {
    let id = '';
    do { serial += 1; id = `sov_imp_${input.idSeed}_${serial}`; } while (used.has(id));
    used.add(id);
    return id;
  };
  const fresh = (r: SovImportRow, position: number, withMoney: boolean): AIASOVLine => ({
    id: newId(),
    itemNo: r.itemNo || String(position),
    description: r.description,
    scheduledValue: r.scheduledValue,
    // D, E and F come from the file ONLY on a schedule of values that had no
    // money on it. On a billed application a new line opens at zero.
    fromPreviousApp: withMoney ? (r.fromPreviousApp ?? 0) : 0,
    thisPeriod: withMoney ? (r.thisPeriod ?? 0) : 0,
    materialsPresentlyStored: withMoney ? (r.materialsPresentlyStored ?? 0) : 0,
    retainagePercent: app.retainagePercent,
    storedRetainagePercent: app.storedRetainagePercent,
  });

  if (mode === 'replace_all') {
    const lines = plan.rows.map((r, i) => fresh(r, i + 1, true));
    return { app: { ...app, lines }, updated: 0, added: lines.length };
  }

  const lines = app.lines.map(l => ({ ...l }));
  let updated = 0;
  let added = 0;
  const claimed = new Set<number>();
  for (const r of plan.rows) {
    let target = -1;
    if (mode === 'update_and_append' && r.itemNo) {
      target = lines.findIndex((l, i) => !claimed.has(i) && itemKey(l.itemNo) === itemKey(r.itemNo));
    }
    if (target >= 0) {
      claimed.add(target);
      // A, B and C only. D, E, F, the rates and the id are the line's own.
      lines[target] = { ...lines[target], description: r.description || lines[target].description, scheduledValue: r.scheduledValue };
      updated += 1;
    } else {
      lines.push(fresh(r, lines.length + 1, false));
      added += 1;
    }
  }
  return { app: { ...app, lines }, updated, added };
}

/**
 * What the schedule of values would add up to if the rows landed this way.
 * The figure the contractor compares with his contract sum is the RESULT, not
 * the sum of the file: an update keeps the lines the file does not name, and
 * an append keeps all of them.
 */
export function sovImportPreview(input: {
  app: AIAPayApplication;
  plan: Pick<SovImportPlan, 'rows'>;
  mode: SovImportMode;
}): { total: number; difference: number; updated: number; added: number; refused: boolean } {
  const out = applySovImport({ ...input, idSeed: 'preview' });
  const total = roundCents(out.app.lines.reduce((s, l) => s + l.scheduledValue, 0));
  return {
    total,
    difference: roundCents(total - input.app.contractSumToDate),
    updated: out.updated,
    added: out.added,
    refused: !!out.refused,
  };
}
