// scripts/validate-pay-app-easy.ts — Easier Pay Applications, Phase 1 (lane
// PAYAPP-1): Bill This Month, the Rejection Check, the spreadsheet import and
// export, the lock at send, and the two wording clean-ups. Each is a RULE, and
// every rule has planted mutations it must catch.
//
// The feature is DARK (constants/featureFlags.ts PAY_APP_EASY_ENABLED = false)
// with an owner preview. What these rules hold:
//
//   C1  CARRY-FORWARD: the next application starts from the last one's own
//       lines; previous work is the last D + E, stored is the balance carried,
//       line 7 is cumulative and follows what was certified, the number is the
//       next one, and THIS PERIOD IS ZERO on every line
//   C2  a negotiated schedule of values survives the month boundary untouched
//       (ids, item numbers, descriptions, scheduled values, both rates);
//       retainage is never stepped down
//   C3  the period: From is the day after the last period ended, To is the
//       last day of that month, built from calendar days (month ends, a leap
//       day), with no Date object and no clock in the module
//   C4  a change order approved inside the new period arrives as a line at
//       zero; one approved after Period To does not
//   C5  the input is only read (deep-frozen) and the answer is deterministic
//   S1  NO PROJECT AVERAGE: a line with no linked schedule task gets "No
//       suggestion" and says why
//   S2  where a percent comes from: the newest daily report on or before the
//       period end, else the task; several tasks weighted by duration; stored
//       material counts; never backwards, never on a deductive line, never a
//       whole-percent round
//   S3  the percent arithmetic is the pay application screen's own, to the
//       cent, on 500 random lines
//   S4  NEVER COUNTED UNTIL ACCEPTED: building suggestions changes no figure
//       and no total; only acceptSuggestion / enterPercent write a line, and
//       the screens call them only from the contractor's tap or keystroke
//   R1  every Rejection Check rule trips on its own fixture, the clean
//       fixture trips none, and the one-cent tolerance holds at 0.00 / 0.01 /
//       0.02
//   R2  the check never blocks and never gives a verdict: the result has no
//       field to gate on, Continue Anyway is never disabled, the lead sentence
//       and the "Not Checked by MAGE ID" block are always drawn, a rule that
//       did not run is never listed as having flagged nothing
//   R3  the certify sheet opens only after the check was shown for the figures
//       on screen
//   W1  wording: none of the banned words in any sentence of the feature, the
//       two narrow exceptions pinned; clear results read "Nothing flagged";
//       no computed deadline; Title Case labels; no dash used as punctuation
//   X1  spreadsheet: export then import returns A to F exactly for 200 random
//       schedules (quotes, commas, tabs, line breaks, negatives); the standard
//       column order; no form name in the export
//   X2  import never drops a row silently, never reads a bad cell as zero,
//       leaves total rows out and counts them, and on an application with
//       money on it never writes D, E or F and never removes a line
//   L1  LOCK AT SEND: a record stamped at certify is locked with no pay link;
//       the stamp is set once, rides in the snapshot sidecar (no column), and
//       is written only for the owner preview
//   L2  the New York lien deadline card is hidden behind LIEN_CLOCK_ENABLED =
//       false, and the code is still there
//   L3  a locked record reads "Sent Record"; "Certified Record" is gone
//   E1  FLAG OFF: PAY_APP_EASY_ENABLED is false, read in one file, and every
//       entry point on the pay application screen asks the gate
//   E2  the core is pure: no React, no storage, no network, no clock
//
// The modules under utils/payApp are EXECUTED from a copy of their source (a
// "world"), so a planted mutation is a real edit to the code that then runs.
// Everything they import from outside utils/payApp is the real module.
//
// Run: bun run scripts/validate-pay-app-easy.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as realAia from '../utils/aiaBilling';
import * as realInvoiceBilling from '../utils/invoiceBilling';
import * as realChangeOrderBilling from '../utils/changeOrderBilling';
import * as realFormatters from '../utils/formatters';
import * as realBillCore from '../utils/billFromEstimateCore';
import * as realRetainage from '../utils/retainage';
import * as realDataTable from '../utils/dataTable';
import { aiaRowToSaved, savedToAiaRow } from '../utils/projectContextPure';
import type { ChangeOrder, SavedAIAPayApp } from '../types';
import type { AIAPayApplication, AIASOVLine } from '../utils/aiaBilling';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// ── the world a rule looks at (a mutation hands it an edited copy) ──────────
type World = Record<string, string>;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = `${dir}/${name}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(rel);
  }
}
const SCANNED: string[] = [];
for (const d of ['app', 'components', 'utils', 'hooks', 'contexts', 'constants']) walk(d, SCANNED);
const SHIPPED: World = {};
for (const f of SCANNED) SHIPPED[f] = read(f);

/** Module specifiers that are loaded from the world (so a mutation runs). */
const WORLD_MODULES: Record<string, string> = {
  '@/constants/featureFlags': 'constants/featureFlags.ts',
  '@/utils/owner': 'utils/owner.ts',
  '@/utils/payApp/allowed': 'utils/payApp/allowed.ts',
  '@/utils/payApp/days': 'utils/payApp/days.ts',
  '@/utils/payApp/suggestCopy': 'utils/payApp/suggestCopy.ts',
  '@/utils/payApp/suggestPercent': 'utils/payApp/suggestPercent.ts',
  '@/utils/payApp/rollForward': 'utils/payApp/rollForward.ts',
  '@/utils/payApp/periodInvoice': 'utils/payApp/periodInvoice.ts',
  '@/utils/payApp/rejectionCopy': 'utils/payApp/rejectionCopy.ts',
  '@/utils/payApp/rejectionCheck': 'utils/payApp/rejectionCheck.ts',
  '@/utils/payApp/sovSpreadsheet': 'utils/payApp/sovSpreadsheet.ts',
  '@/utils/payApp/sendLock': 'utils/payApp/sendLock.ts',
  '@/utils/payApp/saveRecord': 'utils/payApp/saveRecord.ts',
};
const PURE_CORE = Object.values(WORLD_MODULES).filter(p => p.startsWith('utils/payApp/'));
const REAL_MODULES: Record<string, unknown> = {
  '@/utils/aiaBilling': realAia,
  '@/utils/invoiceBilling': realInvoiceBilling,
  '@/utils/changeOrderBilling': realChangeOrderBilling,
  '@/utils/formatters': realFormatters,
  '@/utils/billFromEstimateCore': realBillCore,
  '@/utils/retainage': realRetainage,
  '@/utils/dataTable': realDataTable,
};

type Mod = Record<string, any>;
const jsCache = new Map<string, string>();
function toJs(source: string): string {
  let js = jsCache.get(source);
  if (js === undefined) {
    js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    jsCache.set(source, js);
  }
  return js;
}
function loader(w: World): (spec: string) => Mod {
  const loaded = new Map<string, Mod>();
  const load = (spec: string): Mod => {
    const path = WORLD_MODULES[spec];
    if (!path) {
      const real = REAL_MODULES[spec];
      if (!real) throw new Error(`validate-pay-app-easy: the core imports ${spec}, which this harness does not know`);
      return real as Mod;
    }
    const hit = loaded.get(path);
    if (hit) return hit;
    const mod: { exports: Mod } = { exports: {} };
    loaded.set(path, mod.exports);
    new Function('module', 'exports', 'require', toJs(w[path] ?? ''))(mod, mod.exports, load);
    loaded.set(path, mod.exports);
    return mod.exports;
  };
  return load;
}

// ── fixtures ────────────────────────────────────────────────────────────────
const OWNER = 'omirmajeed2000@gmail.com';
const freeze = <T>(o: T): T => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) freeze(v);
  }
  return o;
};
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const cents = (n: number): number => Math.round(n * 100);

function line(id: string, itemNo: string, description: string, C: number, D: number, E: number, F = 0, rate = 10): AIASOVLine {
  return { id, itemNo, description, scheduledValue: C, fromPreviousApp: D, thisPeriod: E, materialsPresentlyStored: F, retainagePercent: rate };
}
function savedApp(over: Partial<SavedAIAPayApp> & { lines: AIASOVLine[]; applicationNumber: number }): SavedAIAPayApp {
  const base = {
    id: `rec-${over.applicationNumber}`, projectId: 'p1', invoiceId: `inv-${over.applicationNumber}`,
    applicationDate: '2026-09-30', periodTo: '2026-09-30',
    ownerName: 'Harbor Street LLC', contractorName: 'Smith Builders', projectName: 'Harbor Street Renovation',
    originalContractSum: 3000, netChangeByCO: 500, contractSumToDate: 3500,
    retainagePercent: 10, lessPreviousCertificates: 0, savedAt: '2026-09-30T12:00:00.000Z',
  };
  const merged = { ...base, ...over } as SavedAIAPayApp;
  const t = realAia.computeAIATotals(realAia.applicationFromSavedRecord({ ...merged, totals: undefined as never }));
  return {
    ...merged,
    totals: over.totals ?? {
      totalScheduledValue: t.totalScheduledValue, totalCompletedAndStored: t.totalCompletedAndStored,
      totalRetainage: t.totalRetainage, totalEarnedLessRetainage: t.totalEarnedLessRetainage,
      currentPaymentDue: t.currentPaymentDue, balanceToFinish: t.balanceToFinish, percentComplete: t.percentComplete,
    },
  };
}
const co = (id: string, number: number, changeAmount: number, status: string, approvedOn: string): ChangeOrder => ({
  id, number, projectId: 'p1', description: `Change ${number}`, changeAmount, status, date: approvedOn, updatedAt: approvedOn,
} as unknown as ChangeOrder);

/** The clean Rejection Check fixture: Application 4 after Application 3. */
function cleanCheck(): { app: AIAPayApplication; prior: SavedAIAPayApp; saved: SavedAIAPayApp[]; changeOrders: ChangeOrder[]; statedRetainagePercent?: number; statedRetainageOrigin?: string } {
  const prior = savedApp({
    applicationNumber: 3, lessPreviousCertificates: 180,
    lines: [
      line('sov_m1', '1', 'Framing', 1000, 200, 300),
      line('sov_m2', '2', 'Rough Plumbing', 2000, 0, 500, 400),
      line('sov_co:co1', '3', 'CO #1 — Added Beam', 500, 0, 0),
    ],
  });
  const app: AIAPayApplication = {
    applicationNumber: 4, applicationDate: '2026-10-31', periodFrom: '2026-10-01', periodTo: '2026-10-31',
    ownerName: 'Harbor Street LLC', contractorName: 'Smith Builders', projectName: 'Harbor Street Renovation',
    originalContractSum: 3000, netChangeByCO: 500, contractSumToDate: 3500,
    retainagePercent: 10, lessPreviousCertificates: 1260,
    lines: [
      line('sov_m1', '1', 'Framing', 1000, 500, 200),
      line('sov_m2', '2', 'Rough Plumbing', 2000, 500, 300, 400),
      line('sov_co:co1', '3', 'CO #1 — Added Beam', 500, 0, 100),
    ],
  };
  return { app, prior, saved: [prior], changeOrders: [co('co1', 1, 500, 'approved', '2026-09-10')], statedRetainagePercent: 10, statedRetainageOrigin: 'you entered it for this project' };
}

interface CheckCase { rule: string; what: string; expect: string[]; edit: (f: ReturnType<typeof cleanCheck>) => void }
const CHECK_CASES: CheckCase[] = [
  { rule: 'line_over_value', what: 'a line billed past its scheduled value', expect: ['line_over_value'], edit: (f) => { f.app.lines[0].thisPeriod = 600; } },
  { rule: 'total_over_contract', what: 'an off-contract row takes the total past the contract', expect: ['total_over_contract'], edit: (f) => { f.app.lines.push(line('sov_manual_x', '4', 'Extra', 0, 0, 1600)); } },
  { rule: 'sov_not_footing', what: 'the schedule of values does not add up to the contract', expect: ['sov_not_footing'], edit: (f) => { f.app.lines[0].scheduledValue = 1100; } },
  { rule: 'previous_mismatch', what: 'previous work differs from the last application', expect: ['previous_mismatch'], edit: (f) => { f.app.lines[0].fromPreviousApp = 520; } },
  { rule: 'previous_line_missing', what: 'a billed line from last time is gone', expect: ['previous_line_missing'], edit: (f) => { f.prior.lines.push(line('sov_gone', '9', 'Temporary Power', 0, 0, 50)); } },
  { rule: 'line7_mismatch', what: 'less previous certificates differs', expect: ['line7_mismatch'], edit: (f) => { f.app.lessPreviousCertificates = 1000; } },
  { rule: 'stored_in_previous', what: 'stored fell and work did not rise by it', expect: ['stored_in_previous'], edit: (f) => { f.app.lines[1].materialsPresentlyStored = 100; f.app.lines[1].thisPeriod = 100; } },
  { rule: 'went_backwards', what: 'a negative this period', expect: ['went_backwards'], edit: (f) => { f.app.lines[0].thisPeriod = -50; } },
  { rule: 'retainage', what: 'a line at a rate other than the rate on record', expect: ['retainage_rate'], edit: (f) => { f.app.lines[0].retainagePercent = 5; } },
  { rule: 'retainage', what: 'mixed rates with no rate on record', expect: ['retainage_mixed'], edit: (f) => { f.statedRetainagePercent = undefined; f.app.lines[0].retainagePercent = 5; } },
  { rule: 'co_billed_not_approved', what: 'a line bills a change order that is only submitted', expect: ['co_billed_not_approved'], edit: (f) => { f.changeOrders.push(co('co2', 2, 0, 'submitted', '2026-10-02')); f.app.lines[0].description = 'Framing per CO #2'; } },
  { rule: 'co_approved_missing', what: 'an approved change order is not on the sheet', expect: ['co_approved_missing'], edit: (f) => { f.changeOrders.push(co('co3', 3, 0, 'approved', '2026-10-05')); } },
  { rule: 'co_summary_mismatch', what: 'line 2 differs from the change order log', expect: ['co_summary_mismatch'], edit: (f) => { (f.changeOrders[0] as { changeAmount: number }).changeAmount = 600; } },
  { rule: 'contract_sum_math', what: 'line 3 is not line 1 plus line 2', expect: ['contract_sum_math'], edit: (f) => { f.app.originalContractSum = 2900; } },
  { rule: 'cover_vs_sheet', what: 'sub-cent lines make the cover and the sheet differ', expect: ['cover_vs_sheet'], edit: (f) => { for (let i = 0; i < 6; i++) f.app.lines.push(line(`sov_manual_s${i}`, String(5 + i), `Small ${i}`, 0, 0, 0.004)); } },
  { rule: 'payment_not_positive', what: 'the last certificate was above what this one earns', expect: ['payment_not_positive'], edit: (f) => { f.prior.amountCertified = 2000; f.app.lessPreviousCertificates = 2180; } },
  { rule: 'dates_invalid', what: 'an application date that is not a date', expect: ['dates_invalid'], edit: (f) => { f.app.applicationDate = '10/31/26'; } },
  { rule: 'period_order', what: 'period from after period to', expect: ['period_gap', 'period_order'], edit: (f) => { f.app.periodFrom = '2026-11-05'; } },
  { rule: 'period_sequence', what: 'the period starts before the last one ended', expect: ['period_overlap'], edit: (f) => { f.app.periodFrom = '2026-09-30'; } },
  { rule: 'period_sequence', what: 'a gap after the last period', expect: ['period_gap'], edit: (f) => { f.app.periodFrom = '2026-10-05'; } },
  { rule: 'app_date_before_period_end', what: 'the application date is before the period ends', expect: ['app_date_before_period_end'], edit: (f) => { f.app.applicationDate = '2026-10-15'; } },
  { rule: 'number_sequence', what: 'the number skips', expect: ['number_sequence'], edit: (f) => { f.app.applicationNumber = 6; } },
  { rule: 'number_sequence', what: 'the number is used twice', expect: ['number_sequence'], edit: (f) => { f.saved.push(savedApp({ applicationNumber: 4, id: 'dup', lines: [] })); } },
  { rule: 'nothing_billed', what: 'no work and no stored change', expect: ['nothing_billed'], edit: (f) => { f.prior.amountCertified = 0; f.app.lessPreviousCertificates = 180; f.app.lines = f.prior.lines.map(l => ({ ...l, fromPreviousApp: l.fromPreviousApp + l.thisPeriod, thisPeriod: 0 })); } },
];
const PHASE_ONE_RULES = [...new Set(CHECK_CASES.map(c => c.rule))];

// ── the rules ───────────────────────────────────────────────────────────────
type Rule = (w: World) => string[];
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function rollFixture(): { p1: SavedAIAPayApp; p2: SavedAIAPayApp; cos: ChangeOrder[] } {
  // Application 1: applied and (no certificate recorded). Application 2: the
  // architect certified BELOW what was applied for.
  const p1 = savedApp({
    applicationNumber: 1, applicationDate: '2026-01-31', periodTo: '2026-01-31', netChangeByCO: 0, contractSumToDate: 3000, storedRetainagePercent: 0,
    lines: [
      { ...line('sov_m1', '1.0', 'Div 06, Framing (negotiated)', 1000, 0, 400), storedRetainagePercent: 0 },
      { ...line('sov_manual_a', '2.1', 'Millwork, split A', 1200, 0, 0, 300, 5), storedRetainagePercent: 0 },
      line('sov_manual_b', '2.2', 'Millwork, split B', 800, 0, 100),
    ],
  });
  const l7 = realAia.seedLessPreviousCertificates(p1);
  const p2base = savedApp({
    applicationNumber: 2, applicationDate: '2026-02-28', periodTo: '2026-02-28', netChangeByCO: 0, contractSumToDate: 3000, storedRetainagePercent: 0,
    lessPreviousCertificates: l7,
    lines: [
      { ...line('sov_m1', '1.0', 'Div 06, Framing (negotiated)', 1000, 400, 250), storedRetainagePercent: 0 },
      { ...line('sov_manual_a', '2.1', 'Millwork, split A', 1200, 0, 200, 100, 5), storedRetainagePercent: 0 },
      line('sov_manual_b', '2.2', 'Millwork, split B', 800, 100, 0),
    ],
  });
  const p2: SavedAIAPayApp = { ...p2base, amountCertified: 300 };
  return { p1, p2, cos: [co('coA', 1, 250, 'approved', '2026-03-10'), co('coB', 2, 900, 'approved', '2026-04-02'), co('coC', 3, 70, 'submitted', '2026-03-05')] };
}
const PROJECT = { id: 'p1', name: 'Harbor Street Renovation', location: '1 Harbor St', description: 'Renovation', primaryContact: undefined } as never;

const RULES: Record<string, Rule> = {
  'C1 carry-forward': (w) => {
    const bad: string[] = [];
    const { rollForwardNextApplication } = loader(w)('@/utils/payApp/rollForward');
    const { p1, p2, cos } = rollFixture();
    const input = freeze({ project: PROJECT, saved: [p1, p2], changeOrders: cos, contract: null, today: '2026-03-20' });
    const r = rollForwardNextApplication(input);
    if (!r) return ['no result for a project with two saved applications'];
    const a: AIAPayApplication = r.app;
    if (a.applicationNumber !== 3) bad.push(`application number ${a.applicationNumber}, expected 3`);
    if (r.carriedFrom.applicationNumber !== 2) bad.push(`carried from ${r.carriedFrom.applicationNumber}, expected 2`);
    const byId = new Map(a.lines.map(l => [l.id, l]));
    const want: [string, number, number][] = [['sov_m1', 650, 0], ['sov_manual_a', 200, 100], ['sov_manual_b', 100, 0]];
    for (const [id, D, F] of want) {
      const l = byId.get(id);
      if (!l) { bad.push(`line ${id} is missing`); continue; }
      if (cents(l.fromPreviousApp) !== cents(D)) bad.push(`${id}: previous work ${l.fromPreviousApp}, expected ${D}`);
      if (cents(l.materialsPresentlyStored) !== cents(F)) bad.push(`${id}: stored ${l.materialsPresentlyStored}, expected ${F}`);
    }
    for (const l of a.lines) if (l.thisPeriod !== 0) bad.push(`${l.id}: this period opens at ${l.thisPeriod}, not 0`);
    // Line 7 is cumulative and follows the certificate: 1's line 6, plus what 2 certified.
    const l7 = realAia.seedLessPreviousCertificates(p1) + 300;
    if (cents(a.lessPreviousCertificates) !== cents(l7)) bad.push(`line 7 is ${a.lessPreviousCertificates}, expected ${l7} (certified below applied)`);
    // The third application in a row, from the second's own roll.
    const p3 = { ...savedApp({ applicationNumber: 3, periodTo: a.periodTo, applicationDate: a.periodTo, lessPreviousCertificates: a.lessPreviousCertificates, netChangeByCO: a.netChangeByCO, contractSumToDate: a.contractSumToDate, lines: a.lines.map(l => (l.id === 'sov_m1' ? { ...l, thisPeriod: 100 } : l)) }) };
    const r4 = rollForwardNextApplication({ project: PROJECT, saved: [p1, p2, p3], changeOrders: cos, contract: null, today: '2026-04-20' });
    if (!r4) bad.push('no fourth application');
    else {
      if (r4.app.applicationNumber !== 4) bad.push(`fourth application is numbered ${r4.app.applicationNumber}`);
      const m1 = r4.app.lines.find((l: AIASOVLine) => l.id === 'sov_m1');
      if (!m1 || cents(m1.fromPreviousApp) !== cents(750)) bad.push(`fourth application: previous work ${m1?.fromPreviousApp}, expected 750`);
      if (cents(r4.app.lessPreviousCertificates) !== cents(p3.totals.totalEarnedLessRetainage)) bad.push('fourth application: line 7 is not the third application\'s line 6');
    }
    if (rollForwardNextApplication({ project: PROJECT, saved: [], changeOrders: [], contract: null, today: '2026-03-20' }) !== null) bad.push('a project with no earlier application did not return null');
    return bad;
  },
  'C2 negotiated schedule of values survives': (w) => {
    const bad: string[] = [];
    const { rollForwardNextApplication } = loader(w)('@/utils/payApp/rollForward');
    const { p1, p2 } = rollFixture();
    const r = rollForwardNextApplication({ project: PROJECT, saved: [p1, p2], changeOrders: [], contract: null, today: '2026-03-20' });
    if (!r) return ['no result'];
    const keep = (l: AIASOVLine) => ({ id: l.id, itemNo: l.itemNo, description: l.description, scheduledValue: l.scheduledValue, retainagePercent: l.retainagePercent, storedRetainagePercent: l.storedRetainagePercent });
    if (!same(r.app.lines.map(keep), p2.lines.map(keep))) bad.push('ids, item numbers, descriptions, scheduled values or rates changed across the month boundary');
    if (r.app.retainagePercent !== p2.retainagePercent || r.app.storedRetainagePercent !== p2.storedRetainagePercent) bad.push('the cover retainage rates did not carry');
    if (cents(r.app.originalContractSum) !== cents(p2.originalContractSum)) bad.push('line 1 did not carry');
    if (r.app.ownerName !== p2.ownerName || r.app.contractorName !== p2.contractorName) bad.push('the header did not carry');
    return bad;
  },
  'C3 the period is calendar days': (w) => {
    const bad: string[] = [];
    const load = loader(w);
    const { dayAfter, endOfMonth, daysBetween } = load('@/utils/payApp/days');
    const { rollForwardNextApplication } = load('@/utils/payApp/rollForward');
    const after: [string, string][] = [['2026-01-31', '2026-02-01'], ['2026-02-28', '2026-03-01'], ['2028-02-28', '2028-02-29'], ['2028-02-29', '2028-03-01'], ['2026-12-31', '2027-01-01'], ['2026-04-30', '2026-05-01'], ['2026-11-01', '2026-11-02']];
    for (const [a, b] of after) if (dayAfter(a) !== b) bad.push(`the day after ${a} is ${dayAfter(a)}, expected ${b}`);
    const ends: [string, string][] = [['2026-02-01', '2026-02-28'], ['2028-02-10', '2028-02-29'], ['2026-04-15', '2026-04-30'], ['2026-12-01', '2026-12-31'], ['2100-02-01', '2100-02-28'], ['2000-02-01', '2000-02-29']];
    for (const [a, b] of ends) if (endOfMonth(a) !== b) bad.push(`the end of the month of ${a} is ${endOfMonth(a)}, expected ${b}`);
    if (daysBetween('2026-09-30', '2026-10-05') !== 5 || daysBetween('2028-02-28', '2028-03-01') !== 2) bad.push('daysBetween is wrong');
    if (dayAfter('3/31/26') !== null || endOfMonth('2026-02-30') !== null) bad.push('a value that is not a calendar day was read as one');
    const { p1, p2 } = rollFixture();
    const r = rollForwardNextApplication({ project: PROJECT, saved: [p1, p2], changeOrders: [], contract: null, today: '2026-03-20' });
    if (!r || r.period.from !== '2026-03-01' || r.period.to !== '2026-03-31' || r.period.toIsDefault !== true) bad.push(`period is ${JSON.stringify(r?.period)}, expected Mar 1 to Mar 31 as a default`);
    if (r && (r.app.periodFrom !== '2026-03-01' || r.app.periodTo !== '2026-03-31')) bad.push('the application does not carry the period');
    for (const f of ['utils/payApp/days.ts', 'utils/payApp/rollForward.ts']) {
      if (/\bnew Date\b|Date\.now|86400000|86_400_000|toISOString/.test(stripComments(w[f] ?? ''))) bad.push(`${f}: builds a day from a Date or from milliseconds`);
    }
    return bad;
  },
  'C4 change orders by period': (w) => {
    const bad: string[] = [];
    const { rollForwardNextApplication, restatePeriodTo } = loader(w)('@/utils/payApp/rollForward');
    const { p1, p2, cos } = rollFixture();
    const r = rollForwardNextApplication({ project: PROJECT, saved: [p1, p2], changeOrders: cos, contract: null, today: '2026-03-20' });
    if (!r) return ['no result'];
    const inLine = r.app.lines.find((l: AIASOVLine) => l.id === 'sov_co:coA');
    if (!inLine) bad.push('a change order approved inside the period is not on the application');
    else if (inLine.thisPeriod !== 0 || inLine.fromPreviousApp !== 0 || cents(inLine.scheduledValue) !== 25000) bad.push('the new change order line is not a zero line at its amount');
    if (r.app.lines.some((l: AIASOVLine) => l.id === 'sov_co:coB')) bad.push('a change order approved after Period To is on the application');
    if (r.app.lines.some((l: AIASOVLine) => l.id === 'sov_co:coC')) bad.push('a change order that is only submitted is on the application');
    if (cents(r.app.netChangeByCO) !== 25000 || cents(r.app.contractSumToDate) !== cents(p2.originalContractSum) + 25000) bad.push('lines 2 and 3 do not state the change orders through Period To');
    const later = restatePeriodTo(r.app, cos, '2026-04-30');
    if (!later.lines.some((l: AIASOVLine) => l.id === 'sov_co:coB')) bad.push('moving Period To later did not bring in the later change order');
    const typed = restatePeriodTo(r.app, cos, '4/30');
    if (typed.periodTo !== '4/30' || !same(typed.lines, r.app.lines)) bad.push('a Period To that is not a date changed the lines');
    return bad;
  },
  'C5 input is only read, answer is deterministic': (w) => {
    const bad: string[] = [];
    const load = loader(w);
    const { rollForwardNextApplication } = load('@/utils/payApp/rollForward');
    const { suggestForLines } = load('@/utils/payApp/suggestPercent');
    const { runRejectionCheck } = load('@/utils/payApp/rejectionCheck');
    const { p1, p2, cos } = rollFixture();
    const input = freeze({ project: PROJECT, saved: [p1, p2], changeOrders: cos, contract: null, today: '2026-03-20' });
    try {
      const a = rollForwardNextApplication(input);
      const b = rollForwardNextApplication(input);
      if (!same(a, b)) bad.push('rollForwardNextApplication gives two answers for one input');
      const f = freeze(cleanCheck());
      if (!same(runRejectionCheck(f), runRejectionCheck(f))) bad.push('runRejectionCheck gives two answers for one input');
      suggestForLines(freeze({ lines: f.app.lines, tasks: [{ id: 't', title: 'T', progress: 50, durationDays: 2, linkedEstimateItems: ['m1'] }], dailyReports: [], periodTo: '2026-10-31' }));
    } catch (e) {
      bad.push(`a frozen input was written to: ${e instanceof Error ? e.message : String(e)}`);
    }
    return bad;
  },

  'S1 no project average': (w) => {
    const bad: string[] = [];
    const { suggestForLines } = loader(w)('@/utils/payApp/suggestPercent');
    const lines = [line('sov_m1', '1', 'Framing', 1000, 0, 0), line('sov_m2', '2', 'Drywall', 1000, 0, 0), line('sov_manual_z', '3', 'Added by hand', 500, 0, 0), line('sov_co:co1', '4', 'CO #1', 500, 0, 0)];
    // Every task on the job is far along. Only m1 is linked.
    const tasks = [
      { id: 't1', title: 'Framing', progress: 80, durationDays: 5, linkedEstimateItems: ['m1'] },
      { id: 't2', title: 'Site Work', progress: 90, durationDays: 9, linkedEstimateItems: [] },
      { id: 't3', title: 'Roofing', progress: 70, durationDays: 4 },
    ];
    const r = suggestForLines({ lines, tasks, dailyReports: [], periodTo: '2026-10-31' });
    if (r.sov_m1?.kind !== 'suggest') bad.push('the linked line got no suggestion');
    for (const id of ['sov_m2', 'sov_manual_z', 'sov_co:co1']) {
      const x = r[id];
      if (!x || x.kind !== 'none') { bad.push(`${id}: a line with no linked task got a suggestion (${JSON.stringify(x)})`); continue; }
      if (x.reason !== 'no_linked_task') bad.push(`${id}: reason is ${x.reason}`);
      if (!/^No suggestion\. No schedule task is linked to this line\.$/.test(x.sentence)) bad.push(`${id}: the sentence does not say why ("${x.sentence}")`);
    }
    const src = stripComments(w['utils/payApp/suggestPercent.ts'] ?? '');
    if (/legacyEvmMetrics|scheduleEarnedValue|percentComplete|projectPct/.test(src)) bad.push('utils/payApp/suggestPercent.ts reads a project-wide percent');
    return bad;
  },
  'S2 where a percent comes from': (w) => {
    const bad: string[] = [];
    const { suggestForLines, estimateKeyOfLineId } = loader(w)('@/utils/payApp/suggestPercent');
    const one = (l: AIASOVLine, tasks: unknown[], reports: unknown[] = [], periodTo = '2026-10-31') => suggestForLines({ lines: [l], tasks, dailyReports: reports, periodTo })[l.id];
    const t = (id: string, progress: number, durationDays = 5, keys: string[] = ['m1']) => ({ id, title: id === 't1' ? 'Framing' : `Task ${id}`, progress, durationDays, linkedEstimateItems: keys });
    const L = line('sov_m1', '1', 'Framing', 1000, 200, 0);
    // The task alone.
    let x = one(L, [t('t1', 40)]);
    if (x.kind !== 'suggest' || x.suggestion.percent !== 40 || cents(x.suggestion.thisPeriod) !== 20000 || x.suggestion.source.kind !== 'schedule_task') bad.push(`task progress alone: ${JSON.stringify(x)}`);
    else if (x.suggestion.sentence !== 'Schedule: Framing is marked 40%.') bad.push(`sentence: "${x.suggestion.sentence}"`);
    // A daily report beats a stale task; the newest on or before the period end wins; later ones are ignored.
    const reports = [
      { date: '2026-10-10', workProgress: [{ taskId: 't1', taskName: 'Framing', phase: '', pct: 55 }] },
      { date: '2026-10-28', workProgress: [{ taskId: 't1', taskName: 'Framing', phase: '', pct: 85 }] },
      { date: '2026-11-03', workProgress: [{ taskId: 't1', taskName: 'Framing', phase: '', pct: 100 }] },
      { date: '2026-10-29', workProgress: [{ taskId: 'other', taskName: 'Other', phase: '', pct: 99 }] },
    ];
    x = one(L, [t('t1', 40)], reports);
    if (x.kind !== 'suggest' || x.suggestion.percent !== 85 || x.suggestion.source.kind !== 'daily_report' || x.suggestion.source.reportDate !== '2026-10-28') bad.push(`daily report: ${JSON.stringify(x)}`);
    else if (x.suggestion.sentence !== 'Daily report: Framing reported 85% on Oct 28.') bad.push(`sentence: "${x.suggestion.sentence}"`);
    // The line's own link wins over the estimate key.
    x = one({ ...L, linkedTaskId: 't9' }, [t('t1', 40), t('t9', 60, 5, [])]);
    if (x.kind !== 'suggest' || x.suggestion.percent !== 60) bad.push(`linkedTaskId: ${JSON.stringify(x)}`);
    // Several tasks: weighted by duration, said so, not rounded to a whole percent.
    x = one(L, [t('t1', 30, 1), t('t2', 60, 2), t('t3', 61, 3)]);
    const weighted = (30 * 1 + 60 * 2 + 61 * 3) / 6;
    if (x.kind !== 'suggest' || Math.abs(x.suggestion.percent - weighted) > 1e-9 || x.suggestion.source.kind !== 'schedule_tasks_weighted') bad.push(`weighted: ${JSON.stringify(x)}`);
    else {
      if (!/3 linked tasks, weighted by duration/.test(x.suggestion.sentence)) bad.push(`the weighting is not stated: "${x.suggestion.sentence}"`);
      if (cents(x.suggestion.thisPeriod) !== cents(1000 * weighted / 100 - 200)) bad.push(`weighted dollars ${x.suggestion.thisPeriod} (whole-percent rounding?)`);
    }
    // Stored material counts toward the percent.
    x = one(line('sov_m1', '1', 'Framing', 1000, 200, 0, 300), [t('t1', 75)]);
    if (x.kind !== 'suggest' || cents(x.suggestion.thisPeriod) !== 25000) bad.push(`stored counted: ${JSON.stringify(x)}`);
    // Behind what is billed: nothing, and never a negative.
    x = one(line('sov_m1', '1', 'Framing', 1000, 550, 0), [t('t1', 40)]);
    if (x.kind !== 'none' || x.reason !== 'would_go_backwards' || x.sentence !== 'Schedule shows 40%. Already billed 55%. Nothing suggested.') bad.push(`backwards: ${JSON.stringify(x)}`);
    x = one(line('sov_m1', '1', 'Framing', 1000, 400, 0), [t('t1', 40)]);
    if (x.kind !== 'none' || x.reason !== 'nothing_new') bad.push(`level: ${JSON.stringify(x)}`);
    // A deductive line, a line billed in full, a task with no progress.
    x = one(line('sov_m1', '1', 'Credit', -500, 0, 0), [t('t1', 40)]);
    if (x.kind !== 'none' || x.reason !== 'not_positive_value') bad.push(`deductive: ${JSON.stringify(x)}`);
    x = one(line('sov_m1', '1', 'Demo', 1000, 1000, 0), [t('t1', 100)]);
    if (x.kind !== 'none' || x.reason !== 'billed_in_full') bad.push(`billed in full: ${JSON.stringify(x)}`);
    x = one(L, [t('t1', 0)]);
    if (x.kind !== 'none' || x.reason !== 'no_progress_reported') bad.push(`no progress: ${JSON.stringify(x)}`);
    // Never past the scheduled value.
    x = one(L, [t('t1', 140)]);
    if (x.kind !== 'suggest' || cents(x.suggestion.thisPeriod) !== 80000) bad.push(`over 100: ${JSON.stringify(x)}`);
    if (estimateKeyOfLineId('sov_m1__2') !== 'm1' || estimateKeyOfLineId('sov_co:abc') !== null || estimateKeyOfLineId('sov_manual_k1') !== null || estimateKeyOfLineId('sov_imp_a_1') !== null) bad.push('estimateKeyOfLineId reads a change order, hand-added or imported line as an estimate line');
    return bad;
  },
  'S3 the percent arithmetic is the screen\'s own': (w) => {
    const bad: string[] = [];
    const { thisPeriodForPercent } = loader(w)('@/utils/payApp/suggestPercent');
    // The formula as app/aia-pay-app.tsx applyPercentToLine had it before the lift.
    const old = (l: AIASOVLine, percent: number): number => {
      const totalCompleted = Math.max(0, Math.min(l.scheduledValue, l.scheduledValue * (percent / 100)));
      const thisPeriod = Math.max(0, totalCompleted - l.fromPreviousApp - l.materialsPresentlyStored);
      return Math.round(thisPeriod * 100) / 100;
    };
    let seed = 20261009;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    for (let i = 0; i < 500; i++) {
      const C = Math.round(rnd() * 20000000) / 100 - (i % 25 === 0 ? 50000 : 0);
      const l = line(`l${i}`, String(i), '', C, Math.round(rnd() * Math.abs(C) * 60) / 100, 0, Math.round(rnd() * Math.abs(C) * 30) / 100);
      const p = Math.round(rnd() * 12000) / 100;
      if (thisPeriodForPercent(l, p) !== old(l, p)) { bad.push(`line ${i}: ${thisPeriodForPercent(l, p)} != ${old(l, p)} at ${p}%`); if (bad.length > 4) break; }
    }
    const screen = stripComments(w['app/aia-pay-app.tsx'] ?? '');
    if (!/thisPeriod: thisPeriodForPercent\(l, percent\)/.test(screen)) bad.push('app/aia-pay-app.tsx applyPercentToLine no longer uses thisPeriodForPercent');
    return bad;
  },
  'S4 never counted until accepted': (w) => {
    const bad: string[] = [];
    const load = loader(w);
    const { suggestForLines, acceptSuggestion, enterPercent, tallyOpenSuggestions } = load('@/utils/payApp/suggestPercent');
    const { rollForwardNextApplication } = load('@/utils/payApp/rollForward');
    const { buildPeriodInvoice } = load('@/utils/payApp/periodInvoice');
    const { p1, p2 } = rollFixture();
    const roll = rollForwardNextApplication({ project: PROJECT, saved: [p1, p2], changeOrders: [], contract: null, today: '2026-03-20' });
    if (!roll) return ['no roll-forward'];
    const app: AIAPayApplication = roll.app;
    const before = JSON.stringify(app);
    const totalsBefore = JSON.stringify(realAia.computeAIATotals(app));
    const tasks = [{ id: 't1', title: 'Framing', progress: 90, durationDays: 5, linkedEstimateItems: ['m1'] }];
    let results: Record<string, { kind: string; suggestion?: { lineId: string; thisPeriod: number; percent: number; sentence: string } }>;
    try {
      results = suggestForLines({ lines: freeze(clone(app.lines)), tasks, dailyReports: [], periodTo: app.periodTo });
      suggestForLines({ lines: app.lines, tasks, dailyReports: [], periodTo: app.periodTo });
    } catch (e) {
      return [`building suggestions wrote to a line: ${e instanceof Error ? e.message : String(e)}`];
    }
    if (JSON.stringify(app) !== before) bad.push('building suggestions changed the application');
    if (JSON.stringify(realAia.computeAIATotals(app)) !== totalsBefore) bad.push('building suggestions changed a total');
    if (app.lines.some(l => l.thisPeriod !== 0)) bad.push('a line has money in this period before any accept');
    const s = results.sov_m1;
    if (!s || s.kind !== 'suggest' || !s.suggestion) return [...bad, 'the linked line has no suggestion to test the accept with'];
    // The suggestion is real money waiting (so "not in the total" means something).
    if (!(s.suggestion.thisPeriod > 0)) bad.push('the open suggestion is worth nothing');
    const tally = tallyOpenSuggestions(results, {});
    if (tally.open !== 1 || cents(tally.openAmount) !== cents(s.suggestion.thisPeriod)) bad.push(`tally of open suggestions is ${JSON.stringify(tally)}`);
    if (buildPeriodInvoice({ projectId: 'p1', lines: app.lines, applicationNumber: 3, number: 9, now: '2026-03-20T12:00:00.000Z', taxRate: 0, paymentTerms: 'net_30', retainagePercent: 10, newInvoiceId: () => 'i', newLineId: () => 'l' }) !== null) bad.push('an invoice was made from an application with nothing accepted');
    // Accept: exactly that line, exactly that amount.
    const m1 = app.lines.find(l => l.id === 'sov_m1') as AIASOVLine;
    const accepted: AIASOVLine = acceptSuggestion(m1, s.suggestion);
    if (cents(accepted.thisPeriod) !== cents(s.suggestion.thisPeriod) || accepted.suggestedPercent !== s.suggestion.percent || accepted.suggestionSource !== s.suggestion.sentence) bad.push('acceptSuggestion did not put the suggestion on the line with its source');
    if (m1.thisPeriod !== 0) bad.push('acceptSuggestion changed the line it was given');
    const other = app.lines.find(l => l.id === 'sov_manual_b') as AIASOVLine;
    if (acceptSuggestion(other, s.suggestion) !== other) bad.push('a suggestion for one line was accepted onto another');
    if (tallyOpenSuggestions(results, { sov_m1: 'accepted' }).open !== 0 || tallyOpenSuggestions(results, { sov_m1: 'changed' }).open !== 0) bad.push('an accepted or changed line still counts as open');
    const typed: AIASOVLine = enterPercent(m1, 70, s.suggestion);
    if (cents(typed.thisPeriod) !== cents(1000 * 0.7 - m1.fromPreviousApp) || typed.suggestedPercent !== s.suggestion.percent) bad.push('enterPercent did not keep what was suggested beside what he typed');
    const afterAccept = { ...app, lines: app.lines.map(l => (l.id === 'sov_m1' ? accepted : l)) };
    const inv = buildPeriodInvoice({ projectId: 'p1', lines: afterAccept.lines, applicationNumber: 3, number: 9, now: '2026-03-20T12:00:00.000Z', taxRate: 0, paymentTerms: 'net_30', retainagePercent: 10, newInvoiceId: () => 'i', newLineId: () => 'l' });
    if (!inv || inv.lineItems.length !== 1 || cents(inv.subtotal) !== cents(accepted.thisPeriod) || inv.status !== 'draft' || inv.type !== 'progress') bad.push('the invoice behind the period is not the accepted lines, as a draft progress invoice');
    else if (inv.lineItems[0].sourceEstimateItemId !== 'm1' || inv.lineItems[0].billedPercent == null) bad.push('the invoice line does not carry sourceEstimateItemId and billedPercent');
    // The screens: only his tap or keystroke writes a line.
    const btm = stripComments(w['components/payApp/BillThisMonth.tsx'] ?? '');
    if (/\buseEffect\b|\buseLayoutEffect\b/.test(btm)) bad.push('components/payApp/BillThisMonth.tsx has an effect (nothing may apply itself)');
    const writers = [...btm.matchAll(/const (\w+) = useCallback\(/g)].map(m => m[1]);
    const bodyOf = (name: string): string => { const i = btm.indexOf(`const ${name} = useCallback(`); const j = btm.indexOf('\n  }, [', i); return i < 0 || j < 0 ? '' : btm.slice(i, j); };
    for (const name of writers) {
      const body = bodyOf(name);
      const writes = /acceptSuggestion\(|enterPercent\(/.test(body);
      if (writes && !['accept', 'typePercent', 'acceptAll'].includes(name)) bad.push(`BillThisMonth: ${name} writes a line's this period`);
    }
    if ((btm.match(/acceptSuggestion\(/g) ?? []).length !== 2 || (btm.match(/enterPercent\(/g) ?? []).length !== 1) bad.push('BillThisMonth: acceptSuggestion / enterPercent are called somewhere new');
    if (!/showAlert\(SUGGEST_COPY\.acceptAllTitle, SUGGEST_COPY\.acceptAllBody\(tally\.open, tally\.openAmount\)/.test(btm)) bad.push('BillThisMonth: Accept All does not confirm with the count and the total');
    if (!/const totals = useMemo\(\(\) => \(app \? computeAIATotals\(app\) : null\), \[app\]\)/.test(btm)) bad.push('BillThisMonth: the footer total is not the application\'s own arithmetic');
    if (!/const workThis = roundCents\(app\.lines\.reduce\(\(s, l\) => s \+ l\.thisPeriod, 0\)\)/.test(btm)) bad.push('BillThisMonth: Work This Application does not add up thisPeriod alone');
    if (/openAmount/.test(btm.replace(/SUGGEST_COPY\.acceptAllBody\(tally\.open, tally\.openAmount\)/, ''))) bad.push('BillThisMonth: the open suggestions\' amount is used outside the Accept All confirm');
    if (!/\{tally\.open > 0 \? \(\s*<Text[^>]*>\{SUGGEST_COPY\.notAccepted\(tally\.open\)\}<\/Text>/.test(btm)) bad.push('BillThisMonth: the footer does not say how many suggestions are not in the total');
    const screen = stripComments(w['app/aia-pay-app.tsx'] ?? '');
    const a = screen.indexOf('if (easy) {', screen.indexOf('const handleSyncFromSchedule = useCallback('));
    const b = screen.indexOf('if (!project?.schedule || !project.linkedEstimate || !app) {', a);
    const easyPath = a < 0 || b < 0 ? '' : screen.slice(a, b);
    if (!easyPath) bad.push('app/aia-pay-app.tsx: the suggest path of Sync From Schedule is gone');
    else {
      if (/applyPercentToLine|updateLine|setApp\(|legacyEvmMetrics/.test(easyPath)) bad.push('app/aia-pay-app.tsx: Suggest from Schedule writes a line or reads the project average');
      if (!/setSuggestions\(found\)/.test(easyPath) || !/return;\s*\}\s*$/.test(easyPath)) bad.push('app/aia-pay-app.tsx: Suggest from Schedule does not stop at showing suggestions');
    }
    if ((screen.match(/acceptSuggestion\(/g) ?? []).length !== 1 || !/const acceptLineSuggestion = useCallback\(\(lineId: string\) => \{[\s\S]{0,400}acceptSuggestion\(line, r\.suggestion\)/.test(screen)) bad.push('app/aia-pay-app.tsx: acceptSuggestion is called outside the Accept tap');
    return bad;
  },

  'R1 every rule trips on its own fixture': (w) => {
    const bad: string[] = [];
    const { runRejectionCheck, CHECK_TOLERANCE } = loader(w)('@/utils/payApp/rejectionCheck');
    const ids = (r: { flagged: { id: string }[] }): string[] => [...new Set(r.flagged.map(f => f.id))].sort();
    const clean = runRejectionCheck(cleanCheck());
    if (clean.flagged.length) bad.push(`the clean fixture is flagged: ${ids(clean).join(', ')}`);
    const cleanIds = new Set<string>(clean.ranClean.map((c: { id: string }) => c.id));
    for (const rule of PHASE_ONE_RULES) if (!cleanIds.has(rule)) bad.push(`${rule}: did not run on the clean fixture`);
    for (const c of CHECK_CASES) {
      const f = cleanCheck();
      c.edit(f);
      const got = ids(runRejectionCheck(f));
      if (!same(got, [...c.expect].sort())) bad.push(`${c.rule} (${c.what}): flagged [${got.join(', ')}], expected [${c.expect.join(', ')}]`);
    }
    if (CHECK_TOLERANCE !== 0.01) bad.push(`the tolerance is ${CHECK_TOLERANCE}, not one cent`);
    const edge = (edit: (f: ReturnType<typeof cleanCheck>, d: number) => void, id: string) => {
      for (const [d, flagged] of [[0, false], [0.01, false], [0.02, true]] as [number, boolean][]) {
        const f = cleanCheck();
        edit(f, d);
        const hit = runRejectionCheck(f).flagged.some((x: { id: string }) => x.id === id);
        if (hit !== flagged) bad.push(`${id}: a difference of ${d.toFixed(2)} is ${hit ? '' : 'not '}flagged`);
      }
    };
    edge((f, d) => { f.app.lessPreviousCertificates = 1260 + d; }, 'line7_mismatch');
    edge((f, d) => { f.app.lines[0].fromPreviousApp = 500 + d; }, 'previous_mismatch');
    edge((f, d) => { f.app.lines[0].scheduledValue = 1000 + d; }, 'sov_not_footing');
    edge((f, d) => { f.app.netChangeByCO = 500 + d; f.app.originalContractSum = 3000 - d; }, 'co_summary_mismatch');
    // Each finding names its line where it has one, and every sentence is filled in.
    const f = cleanCheck();
    f.app.lines[0].thisPeriod = 600;
    const over = runRejectionCheck(f).flagged[0];
    if (!over || over.lineId !== 'sov_m1' || over.action?.label !== 'Go to Line 1') bad.push('a line finding does not point at its line');
    else if (over.detail !== 'Billed to date $1,100.00 against $1,000.00. Over by $100.00.') bad.push(`money is not shown with commas and two decimals: "${over.detail}"`);
    return bad;
  },
  'R2 the check never blocks and gives no verdict': (w) => {
    const bad: string[] = [];
    const load = loader(w);
    const { runRejectionCheck } = load('@/utils/payApp/rejectionCheck');
    const { REJECTION_COPY } = load('@/utils/payApp/rejectionCopy');
    const clean = runRejectionCheck(cleanCheck());
    if (!same(Object.keys(clean).sort(), ['flagged', 'notRun', 'ranClean'])) bad.push(`the result carries a field to gate on: ${Object.keys(clean).join(', ')}`);
    for (const c of clean.ranClean) if (typeof c.label !== 'string' || !c.label || Object.keys(c).sort().join() !== 'id,label') bad.push(`a clean row carries more than its label: ${JSON.stringify(c)}`);
    if (REJECTION_COPY.nothingFlagged !== 'Nothing flagged') bad.push('a clean row does not read "Nothing flagged"');
    if (REJECTION_COPY.title !== 'Rejection Check' || REJECTION_COPY.subtitle !== 'Things a Reviewer May Question') bad.push('the title or subtitle changed');
    if (REJECTION_COPY.lead !== 'Sums and comparisons run on your own numbers. They do not say this application is correct or that it will be accepted.') bad.push('the lead sentence changed');
    if (REJECTION_COPY.notCheckedLabel !== 'Not checked by MAGE ID:' || REJECTION_COPY.notCheckedBody !== 'what your contract allows, whether the work is done, lien and notice deadlines, which waiver form applies. Ask your attorney.') bad.push('the Not Checked by MAGE ID block changed');
    if (REJECTION_COPY.continueAnyway !== 'Continue Anyway') bad.push('Continue Anyway changed');
    // The three Phase 2 rules are named as not run, and a rule that did not run is never clean.
    const notRun = new Set<string>(clean.notRun.map((n: { id: string }) => n.id));
    for (const id of ['stored_no_backup', 'checklist_missing', 'notary_checklist']) if (!notRun.has(id)) bad.push(`${id} is not listed as not run`);
    const first = cleanCheck();
    const noPrior = runRejectionCheck({ ...first, prior: null, saved: [], app: { ...first.app, applicationNumber: 1 } });
    const ran = new Set<string>(noPrior.ranClean.map((c: { id: string }) => c.id));
    for (const id of ['previous_mismatch', 'previous_line_missing', 'line7_mismatch', 'stored_in_previous', 'period_sequence']) {
      if (ran.has(id)) bad.push(`${id} is listed as "nothing flagged" on a first application, where it cannot run`);
      if (!noPrior.notRun.some((n: { id: string; why: string }) => n.id === id && !!n.why)) bad.push(`${id} is not listed as not run, with why, on a first application`);
    }
    for (const r of [clean, noPrior]) {
      const a = new Set<string>(r.ranClean.map((c: { id: string }) => c.id));
      for (const n of r.notRun) if (a.has(n.id)) bad.push(`${n.id} is both not run and clean`);
    }
    // The sheet.
    const sheet = stripComments(w['components/payApp/RejectionCheckSheet.tsx'] ?? '');
    const cont = /<Button\s+label=\{REJECTION_COPY\.continueAnyway\}[\s\S]*?\/>/.exec(sheet)?.[0] ?? '';
    if (!cont) bad.push('the sheet has no Continue Anyway button');
    else if (/disabled|loading/.test(cont)) bad.push('Continue Anyway can be disabled');
    if (!/\{onContinue \? \(/.test(sheet)) bad.push('Continue Anyway is not drawn whenever the caller is on the way to certify');
    const lead = sheet.indexOf('{REJECTION_COPY.lead}');
    const heading = sheet.indexOf('REJECTION_COPY.flaggedHeading(');
    if (lead < 0 || heading < 0 || lead > heading) bad.push('the lead sentence is not drawn above the list');
    else if (/flagged\.length\s*[>=!]/.test(sheet.slice(sheet.indexOf('{result ? ('), lead))) bad.push('the lead sentence depends on what was flagged');
    const nc = sheet.indexOf('{REJECTION_COPY.notCheckedLabel}');
    if (nc < 0 || sheet.indexOf('REJECTION_COPY.notCheckedBody') < nc) bad.push('the Not Checked by MAGE ID block is not drawn');
    else {
      const open = sheet.lastIndexOf('<Text style={styles.notChecked}', nc);
      const cond = sheet.slice(sheet.lastIndexOf(') : null}', open), open);
      if (open < 0 || /\? \(\s*$/.test(cond.trimEnd())) bad.push('the Not Checked by MAGE ID block is conditional');
    }
    if (/\bCheck\b[^'"]*from 'lucide-react-native'|CheckCircle|CircleCheck|BadgeCheck|ShieldCheck|t\.success|colors\.success|✓|✔/.test(sheet + stripComments(w['components/payApp/styles.ts'] ?? ''))) bad.push('the check draws a tick or a pass colour');
    if (/score|percentPassed|passRate/i.test(sheet)) bad.push('the check shows a score');
    // Not saved, not printed.
    for (const f of ['utils/payApp/saveRecord.ts', 'utils/aiaBilling.ts', 'utils/projectContextPure.ts']) {
      if (/rejectionCheck|runRejectionCheck|CheckResult/.test(stripComments(w[f] ?? ''))) bad.push(`${f}: the check result reaches the saved record or the PDF`);
    }
    return bad;
  },
  'R3 the certify sheet opens only after the check was shown': (w) => {
    const bad: string[] = [];
    const { checkFingerprint } = loader(w)('@/utils/payApp/rejectionCheck');
    const f = cleanCheck();
    const base = checkFingerprint(f.app);
    const moved: [string, (a: AIAPayApplication) => void][] = [
      ['this period', (a) => { a.lines[0].thisPeriod += 0.01; }], ['stored', (a) => { a.lines[1].materialsPresentlyStored += 1; }],
      ['previous work', (a) => { a.lines[0].fromPreviousApp += 1; }], ['scheduled value', (a) => { a.lines[0].scheduledValue += 1; }],
      ['a line rate', (a) => { a.lines[0].retainagePercent = 5; }], ['line 7', (a) => { a.lessPreviousCertificates += 1; }],
      ['period to', (a) => { a.periodTo = '2026-10-30'; }], ['the number', (a) => { a.applicationNumber = 5; }],
      ['a new line', (a) => { a.lines.push(line('sov_manual_n', '9', 'New', 0, 0, 0)); }],
    ];
    for (const [what, edit] of moved) { const a = clone(f.app); edit(a); if (checkFingerprint(a) === base) bad.push(`changing ${what} does not bring the check back`); }
    if (checkFingerprint(clone(f.app)) !== base) bad.push('the same figures give a different fingerprint');
    const screen = stripComments(w['app/aia-pay-app.tsx'] ?? '');
    const i = screen.indexOf('const requestGenerate = useCallback(');
    const j = screen.indexOf('const continueToCertify = useCallback(');
    const k = screen.indexOf('const onBilledThisMonth = useCallback(');
    if (i < 0 || j < i || k < j) return [...bad, 'app/aia-pay-app.tsx: requestGenerate / continueToCertify not found'];
    const req = screen.slice(i, j);
    const gate = req.indexOf("if (easy && checkShownForRef.current !== checkFingerprint(app)) {");
    const open = req.indexOf('setShowPreExportConfirm(true)');
    if (gate < 0 || open < gate || !/setCheckOpen\('certify'\);\s*return;/.test(req.slice(gate, open))) bad.push('requestGenerate opens the certify sheet without the check having been shown for these figures');
    const cont = screen.slice(j, k);
    if (!/checkShownForRef\.current = checkFingerprint\(app\);[\s\S]*setShowPreExportConfirm\(true\);/.test(cont)) bad.push('Continue Anyway does not record the figures and open the certify sheet');
    if (/if \((?!\!app\))/.test(cont)) bad.push('Continue Anyway has a condition (the check must never block)');
    const outside = screen.slice(0, i) + screen.slice(k);
    if (/setShowPreExportConfirm\(true\)/.test(outside)) bad.push('the certify sheet is opened from somewhere that skips the check');
    if (!/onContinue=\{checkOpen === 'certify' \? continueToCertify : undefined\}/.test(screen)) bad.push('the sheet on the way to certify does not offer Continue Anyway');
    return bad;
  },

  'W1 wording': (w) => {
    const bad: string[] = [];
    const load = loader(w);
    const { allRejectionCopy, REJECTION_BANNED_WORDS } = load('@/utils/payApp/rejectionCopy');
    const { allSuggestCopy, SUGGEST_BANNED_WORDS } = load('@/utils/payApp/suggestCopy');
    const { SOV_EXPORT_COPY, SOV_IMPORT_COPY, SOV_EXPORT_HEADERS, SOV_FIELD_LABEL } = load('@/utils/payApp/sovSpreadsheet');
    const { SEND_LOCK_COPY } = load('@/utils/payApp/sendLock');
    const { runRejectionCheck } = load('@/utils/payApp/rejectionCheck');
    const has = (text: string, word: string): boolean => new RegExp(`(^|[^a-z])${word.replace(/ /g, '\\s+')}([^a-z]|$)`, 'i').test(text);
    // The app's own verdict words, banned in every sentence of the feature.
    const EVERYWHERE = ['compliant', 'verified', 'valid', 'passed', 'pass', 'ready to submit', 'ready', 'sufficient', 'guaranteed', 'will be paid', 'all clear'];
    for (const must of ['approved', 'compliant', 'verified', 'correct', 'ready', 'pass', 'valid', 'accepted', 'certified']) {
      if (!REJECTION_BANNED_WORDS.includes(must)) bad.push(`the banned list lost "${must}"`);
    }
    for (const must of ['verified', 'confirmed', 'earned', 'approved', 'certified', 'compliant']) {
      if (!SUGGEST_BANNED_WORDS.includes(must)) bad.push(`the suggestion banned list lost "${must}"`);
    }
    const allowed = (id: string, word: string): boolean =>
      // A change order's own status in the contractor's log.
      (word === 'approved' && /^(label:)?co_/.test(id))
      // What the check does NOT say, said once.
      || ((word === 'correct' || word === 'accepted') && id === 'lead')
      // The list of what is not checked names deadlines as not checked.
      || (word === 'deadline' && id === 'not_checked');
    const rejection: { id: string; text: string }[] = allRejectionCopy();
    // Plus every sentence the fixtures actually produce.
    for (const c of CHECK_CASES) {
      const f = cleanCheck(); c.edit(f);
      for (const x of runRejectionCheck(f).flagged) rejection.push({ id: x.id, text: x.summary }, { id: x.id, text: x.detail });
    }
    for (const { id, text } of rejection) {
      for (const word of REJECTION_BANNED_WORDS as string[]) if (has(text, word) && !allowed(id, word)) bad.push(`Rejection Check (${id}): "${word}" in "${text}"`);
    }
    const lead = rejection.find(r => r.id === 'lead')?.text ?? '';
    if (!/do not say this application is correct or that it will be accepted/.test(lead)) bad.push('the lead no longer denies "correct" and "accepted"');
    for (const text of allSuggestCopy() as string[]) {
      for (const word of [...(SUGGEST_BANNED_WORDS as string[]), ...EVERYWHERE]) if (has(text, word)) bad.push(`Bill This Month: "${word}" in "${text}"`);
    }
    const other: string[] = [];
    const collect = (o: Record<string, unknown>) => { for (const v of Object.values(o)) { if (typeof v === 'string') other.push(v); else if (typeof v === 'function') other.push(String((v as (...a: unknown[]) => unknown)('2', '3', 'x'))); } };
    collect(SOV_EXPORT_COPY); collect(SOV_IMPORT_COPY); collect(SEND_LOCK_COPY); collect(SOV_FIELD_LABEL);
    other.push(...(SOV_EXPORT_HEADERS as string[]));
    for (const text of other) {
      for (const word of [...EVERYWHERE, 'approved', 'correct', 'verified']) if (has(text, word)) bad.push(`"${word}" in "${text}"`);
    }
    // No computed deadline, and house style, in every string of the feature.
    const every = [...rejection.map(r => r.text), ...(allSuggestCopy() as string[]), ...other];
    for (const text of every) {
      if (/\bdue (date|by)\b|\bdue on [A-Z0-9]|\bdeadline\b|\bfile by\b|\bexpires?\b|\blate\b/.test(text) && text !== rejection.find(r => r.id === 'not_checked')?.text) bad.push(`a deadline or due date: "${text}"`);
      if (/[—–]| - |&|\be\.g\.|→/.test(text)) bad.push(`house style (dash, ampersand, e.g. or arrow): "${text}"`);
      if (/\$\d[\d,]*(?!\.\d\d)(?:\b|$)/.test(text.replace(/\$\d[\d,]*\.\d\d/g, ''))) bad.push(`money without two decimals: "${text}"`);
    }
    // The export claim, and nothing about filling anyone's form.
    if (SOV_EXPORT_COPY.claim !== 'Export your figures to type or paste into the software your owner requires.') bad.push('the export claim changed');
    for (const text of every) if (/fills? (in |out )?the (aia|official)|official form/i.test(text)) bad.push(`claims to fill the official form: "${text}"`);
    // Labels the screens write themselves.
    for (const f of ['components/payApp/BillThisMonth.tsx', 'components/payApp/BillThisMonthLine.tsx', 'components/payApp/RejectionCheckSheet.tsx', 'components/payApp/SovImportSheet.tsx', 'components/payApp/SovSpreadsheetBar.tsx', 'components/payApp/SuggestionRow.tsx']) {
      const src = stripComments(w[f] ?? '');
      for (const word of ['approved', 'compliant', 'verified', 'ready to submit', 'all clear', 'passed']) if (has(src.replace(/import[^;]+;/g, ''), word)) bad.push(`${f}: "${word}"`);
    }
    return bad;
  },

  'X1 export and round trip': (w) => {
    const bad: string[] = [];
    const S = loader(w)('@/utils/payApp/sovSpreadsheet');
    const want = ['Item No.', 'Description of Work', 'Scheduled Value', 'From Previous Application', 'This Period', 'Materials Presently Stored', 'Total Completed and Stored to Date', 'Percent', 'Balance to Finish', 'Retainage'];
    if (!same(S.SOV_EXPORT_HEADERS, want)) bad.push('the export is not in the standard column order A to J');
    const f = cleanCheck();
    const rows: string[][] = S.sovExportRows(f.app);
    if (!same(rows[2], ['2', 'Rough Plumbing', '2000.00', '500.00', '300.00', '400.00', '1200.00', '60.00', '800.00', '120.00'])) bad.push(`an exported row is ${JSON.stringify(rows[2])}`);
    if (S.sovExportRows(f.app, { entryOnly: true })[0].length !== 6 || S.sovExportRows(f.app, { header: false }).length !== f.app.lines.length) bad.push('entry-only or no-header export is wrong');
    const cover: string[][] = S.coverFigureRows(f.app);
    if (cover.length !== 9 || cover[7][1] !== '540.00' || cover[3][1] !== '2000.00') bad.push(`cover figures are ${JSON.stringify(cover)}`);
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const bits = ['Framing', 'Tile, floor', '"Quoted" scope', 'Tab\there', 'Two\nlines', ' leading space', 'trailing ', '12" pipe', 'a,b,"c"', 'Level 2 — east', '', '=SUM(A1)', 'Total station layout'];
    const money = () => Math.round((rnd() - 0.15) * 5000000) / 100;
    for (let n = 0; n < 200; n++) {
      const lines: AIASOVLine[] = [];
      const count = 1 + Math.floor(rnd() * 12);
      for (let i = 0; i < count; i++) {
        const desc = bits[Math.floor(rnd() * bits.length)] || `Line ${i}`;
        lines.push(line(`l${i}`, rnd() < 0.2 ? `${i + 1}.${Math.floor(rnd() * 9)}` : String(i + 1), desc, money(), money(), money(), money()));
      }
      const app = { ...f.app, lines };
      for (const [name, text] of [['csv', S.sovExportCsv(app)], ['tsv', S.sovExportTsv(app)]] as [string, string][]) {
        const parsed: string[][] = S.parseDelimited(text);
        const det = S.detectSovColumns(parsed);
        const plan = S.planSovImport({ rows: parsed, mapping: det.mapping, hasHeader: det.hasHeader });
        const got = plan.rows.map((r: { itemNo: string; description: string; scheduledValue: number; fromPreviousApp?: number; thisPeriod?: number; materialsPresentlyStored?: number }) => [r.itemNo, r.description, cents(r.scheduledValue), cents(r.fromPreviousApp ?? NaN), cents(r.thisPeriod ?? NaN), cents(r.materialsPresentlyStored ?? NaN)]);
        // Spaces around a cell are not part of it: an import trims them.
        const exp = lines.map(l => [l.itemNo.trim(), l.description.trim(), cents(l.scheduledValue), cents(l.fromPreviousApp), cents(l.thisPeriod), cents(l.materialsPresentlyStored)]);
        if (!det.hasHeader || !same(got, exp) || plan.bad.length || plan.skippedBlank || plan.skippedTotals) {
          bad.push(`${name} round trip ${n}: columns A to F did not come back exactly: ${JSON.stringify({ got: got.find((g: unknown, i: number) => !same(g, exp[i])), exp: exp.find((e, i) => !same(e, got[i])), bad: plan.bad, blank: plan.skippedBlank, totals: plan.skippedTotals, header: det.hasHeader })}`);
          break;
        }
      }
      if (bad.length) break;
    }
    const text = S.sovExportCsv(f.app) + S.sovExportTsv(f.app) + S.toDelimited(S.coverFigureRows(f.app), '\t') + S.sovExportFileName(4);
    if (/AIA|G702|G703|American Institute/i.test(text)) bad.push('the export carries a form name');
    const src = stripComments(w['utils/payApp/sovSpreadsheet.ts'] ?? '');
    if (/G70[23]|\bAIA\b/.test(src.replace(/import[^;]+;/g, '').replace(/\b(computeAIATotals|AIAPayApplication|AIASOVLine|aiaBilling)\b/g, ''))) bad.push('utils/payApp/sovSpreadsheet.ts writes a form name into a string');
    return bad;
  },
  'X2 import is never silent': (w) => {
    const bad: string[] = [];
    const S = loader(w)('@/utils/payApp/sovSpreadsheet');
    const text = [
      'Item No.,Description of Work,Scheduled Value,From Previous Application',
      '1,Framing,"1,200.00",100',
      '2,Tile,TBD,0',
      ',,,',
      '3,Credit,(250.00),0',
      '4,Total Station Layout,300,0',
      '5,Paint,400,n/a',
      ',Total,1650.00,100',
      'Grand Total,,1650.00,',
    ].join('\r\n');
    const rows: string[][] = S.parseDelimited(text);
    const det = S.detectSovColumns(rows);
    if (!det.hasHeader || det.mapping.itemNo !== 0 || det.mapping.description !== 1 || det.mapping.scheduled !== 2 || det.mapping.previous !== 3) bad.push(`header detection: ${JSON.stringify(det)}`);
    const plan = S.planSovImport({ rows, mapping: det.mapping, hasHeader: det.hasHeader });
    if (plan.rows.length + plan.skippedBlank + plan.skippedTotals + plan.bad.length !== rows.length - 1) bad.push('a row is in none of: imported, blank, total, unreadable');
    if (plan.rows.length !== 3) bad.push(`${plan.rows.length} rows imported, expected 3`);
    if (plan.skippedTotals !== 2) bad.push(`${plan.skippedTotals} total rows left out, expected 2`);
    if (plan.skippedBlank !== 1) bad.push(`${plan.skippedBlank} blank rows, expected 1`);
    if (plan.bad.length !== 2 || plan.bad[0].rowNumber !== 3 || plan.bad[1].rowNumber !== 7) bad.push(`unreadable rows: ${JSON.stringify(plan.bad.map((b: { rowNumber: number }) => b.rowNumber))}, expected rows 3 and 7`);
    if (plan.rows.some((r: { description: string }) => r.description === 'Tile' || r.description === 'Paint')) bad.push('a row with a cell that is not an amount was imported (read as zero)');
    const credit = plan.rows.find((r: { description: string }) => r.description === 'Credit');
    if (!credit || credit.scheduledValue !== -250) bad.push('(250.00) was not read as a negative');
    if (!plan.rows.some((r: { description: string }) => r.description === 'Total Station Layout')) bad.push('a line of work whose name starts with Total was left out as a total row');
    if (cents(plan.sumScheduled) !== cents(1200 - 250 + 300)) bad.push(`the sum is ${plan.sumScheduled}`);
    // No header: by position. Tabs: tab-separated.
    const pos = S.detectSovColumns(S.parseDelimited('1\tFraming\t1200\n2\tTile\t800'));
    if (pos.hasHeader || pos.mapping.itemNo !== 0 || pos.mapping.description !== 1 || pos.mapping.scheduled !== 2) bad.push(`positional detection: ${JSON.stringify(pos)}`);
    // "Total Completed and Stored to Date" is never taken for the stored column.
    const full = S.detectSovColumns([['Item No.', 'Description of Work', 'Scheduled Value', 'From Previous Application', 'This Period', 'Total Completed and Stored to Date', 'Materials Presently Stored', 'Balance to Finish', 'Retainage']]);
    if (full.mapping.stored !== 6 || full.mapping.thisPeriod !== 4) bad.push(`computed columns are read as input: ${JSON.stringify(full.mapping)}`);
    // Onto an application WITH money: D, E, F and every line stay.
    const f = cleanCheck();
    const billed = freeze(clone(f.app));
    const incoming = { rows: [
      { rowNumber: 2, itemNo: '1', description: 'Framing, revised', scheduledValue: 1500, fromPreviousApp: 9999, thisPeriod: 8888, materialsPresentlyStored: 7777 },
      { rowNumber: 3, itemNo: '9', description: 'New Scope', scheduledValue: 700, fromPreviousApp: 111, thisPeriod: 222, materialsPresentlyStored: 333 },
    ] };
    if (!same(S.sovImportModesFor(billed), ['update_and_append', 'append'])) bad.push('Replace is offered on an application with money on it');
    const refused = S.applySovImport({ app: billed, plan: incoming, mode: 'replace_all', idSeed: 'x' });
    if (refused.refused !== 'has_money' || refused.app !== billed) bad.push('replace_all ran on an application with money on it');
    for (const mode of ['update_and_append', 'append']) {
      const out = S.applySovImport({ app: billed, plan: incoming, mode, idSeed: 'x' });
      for (const l of billed.lines) {
        const now = out.app.lines.find((x: AIASOVLine) => x.id === l.id);
        if (!now) { bad.push(`${mode}: a line was removed`); continue; }
        if (now.fromPreviousApp !== l.fromPreviousApp || now.thisPeriod !== l.thisPeriod || now.materialsPresentlyStored !== l.materialsPresentlyStored) bad.push(`${mode}: D, E or F changed on ${l.id}`);
        if (now.retainagePercent !== l.retainagePercent) bad.push(`${mode}: a rate changed on ${l.id}`);
      }
      const added = out.app.lines.filter((x: AIASOVLine) => !billed.lines.some(l => l.id === x.id));
      if (added.some((x: AIASOVLine) => x.fromPreviousApp !== 0 || x.thisPeriod !== 0 || x.materialsPresentlyStored !== 0)) bad.push(`${mode}: a new line on a billed application carries money`);
      if (new Set(out.app.lines.map((x: AIASOVLine) => x.id)).size !== out.app.lines.length) bad.push(`${mode}: two lines share an id`);
      if (mode === 'update_and_append') {
        const one = out.app.lines.find((x: AIASOVLine) => x.id === 'sov_m1');
        if (out.updated !== 1 || out.added !== 1 || one?.scheduledValue !== 1500 || one?.description !== 'Framing, revised') bad.push('update_and_append did not update the matching line and add the other');
      } else if (out.updated !== 0 || out.added !== 2) bad.push('append did not add every row');
    }
    // Onto a schedule with no money: the imported rows become the lines, D to F from the file.
    const empty = { ...f.app, lines: f.app.lines.map(l => ({ ...l, fromPreviousApp: 0, thisPeriod: 0, materialsPresentlyStored: 0 })) };
    const first = S.applySovImport({ app: empty, plan: incoming, mode: 'replace_all', idSeed: 'x' });
    if (first.refused || first.app.lines.length !== 2 || first.app.lines[0].fromPreviousApp !== 9999 || first.app.lines[1].thisPeriod !== 222) bad.push('a first import did not create the lines with their D, E and F');
    // The sheet: nothing is written before the last tap.
    const sheet = stripComments(w['components/payApp/SovImportSheet.tsx'] ?? '');
    if ((sheet.match(/onApply\(/g) ?? []).length !== 1 || !/const apply = useCallback\(\(mode: SovImportMode\) => \{[\s\S]{0,400}onApply\(outcome\.app/.test(sheet)) bad.push('SovImportSheet writes before the contractor picks how the rows land');
    if (/\buseEffect\b/.test(sheet)) bad.push('SovImportSheet has an effect');
    return bad;
  },

  'L1 lock at send': (w) => {
    const bad: string[] = [];
    const { payAppLock, withSentLock } = loader(w)('@/utils/payApp/sendLock');
    if (payAppLock({}).locked || payAppLock(null).locked) bad.push('a draft is locked');
    const sent = payAppLock({ sentLockedAt: '2026-10-09T12:00:00.000Z' });
    if (!sent.locked || sent.reason !== 'sent') bad.push('a record stamped at send with no pay link is not locked');
    if (payAppLock({ payLinkUrl: 'https://x', sentLockedAt: 'y' }).reason !== 'pay_link' || payAppLock({ paidAt: 'z', payLinkUrl: 'x' }).reason !== 'paid' || payAppLock({ pendingBankPayment: true }).reason !== 'payment_pending') bad.push('a pay link, a payment or a pending bank payment no longer locks, or the reasons are out of order');
    if (!realAia.payAppEditability({ hasSavedRecord: true, isLocked: sent.locked, editRequested: true }).isReadOnly) bad.push('a locked record can be edited');
    const rec = { id: 'r', sentLockedAt: undefined as string | undefined };
    const stamped = withSentLock(rec, '2026-10-09T12:00:00.000Z', true);
    if (stamped.sentLockedAt !== '2026-10-09T12:00:00.000Z' || rec.sentLockedAt !== undefined) bad.push('withSentLock did not stamp a copy');
    if (withSentLock(stamped, '2027-01-01T00:00:00.000Z', true).sentLockedAt !== '2026-10-09T12:00:00.000Z') bad.push('the stamp moved on a second certify');
    if (withSentLock(rec, '2026-10-09T12:00:00.000Z', false) !== rec) bad.push('a record was stamped outside the owner preview');
    // It rides in the sidecar: no new column, and it comes back.
    const prior = cleanCheck().prior;
    const row = savedToAiaRow({ ...prior, sentLockedAt: '2026-10-09T12:00:00.000Z' }, 'u1');
    if ('sent_locked_at' in row || 'sentLockedAt' in row) bad.push('the stamp is sent as a column (that needs a migration)');
    if (aiaRowToSaved(row).sentLockedAt !== '2026-10-09T12:00:00.000Z') bad.push('the stamp does not survive the round trip through the row');
    if (JSON.stringify(savedToAiaRow(prior, 'u1').snapshot_totals).includes('sentLockedAt')) bad.push('a record with no stamp writes one');
    if ('sentLockedAt' in aiaRowToSaved(row).totals) bad.push('the stamp leaked into totals');
    const screen = stripComments(w['app/aia-pay-app.tsx'] ?? '');
    if (!/const lockState = payAppLock\(\{[\s\S]{0,260}sentLockedAt: savedForThisAppNumber\?\.sentLockedAt,\s*\}\);\s*const isLocked = lockState\.locked;/.test(screen)) bad.push('app/aia-pay-app.tsx: isLocked is not payAppLock with the send stamp');
    if (!/const rec = built \? withSentLock\(\{ \.\.\.built, id: pinCertifyRecordId\(built\.id\) \}, new Date\(\)\.toISOString\(\), easy\) : null;/.test(screen)) bad.push('app/aia-pay-app.tsx: certify does not stamp the record (owner preview only)');
    if ((screen.match(/withSentLock\(/g) ?? []).length !== 1) bad.push('app/aia-pay-app.tsx: the stamp is written somewhere other than certify');
    if (!/sentLockedAt: existing\?\.sentLockedAt,/.test(screen)) bad.push('app/aia-pay-app.tsx: a re-save would drop the stamp');
    return bad;
  },
  'L2 the lien deadline card is hidden': (w) => {
    const bad: string[] = [];
    const flags = stripComments(w['constants/featureFlags.ts'] ?? '');
    if (!/export const LIEN_CLOCK_ENABLED: boolean = false;/.test(flags)) bad.push('LIEN_CLOCK_ENABLED is not false');
    const inv = stripComments(w['app/invoice.tsx'] ?? '');
    const mounts = [...inv.matchAll(/<LienClockCard\b/g)];
    if (mounts.length !== 1) bad.push(`app/invoice.tsx mounts the card ${mounts.length} times`);
    if (!/\{LIEN_CLOCK_ENABLED && existingInvoice && effectiveStatus === 'overdue' && daysPastDue >= 30 \? \(\s*<LienClockCard/.test(inv)) bad.push('app/invoice.tsx: the card is not behind LIEN_CLOCK_ENABLED');
    for (const [f, src] of Object.entries(w)) {
      if (f === 'app/invoice.tsx' || f === 'components/invoice/LienClockCard.tsx') continue;
      if (/<LienClockCard\b|lienClockFor\(/.test(stripComments(src)) && f !== 'utils/lienRightsClock.ts') bad.push(`${f}: shows the lien deadline`);
    }
    if (!w['utils/lienRightsClock.ts'] || !/export function lienClockFor\(/.test(w['utils/lienRightsClock.ts'])) bad.push('utils/lienRightsClock.ts was deleted (hide it, keep the code)');
    if (!w['components/invoice/LienClockCard.tsx'] || !/export function LienClockCard\(/.test(w['components/invoice/LienClockCard.tsx'])) bad.push('components/invoice/LienClockCard.tsx was deleted (hide it, keep the code)');
    return bad;
  },
  'L3 a locked record reads Sent Record': (w) => {
    const bad: string[] = [];
    for (const [f, src] of Object.entries(w)) {
      if (/['"`>]\s*Certified Record\b/.test(stripComments(src))) bad.push(`${f}: "Certified Record"`);
    }
    const aia = stripComments(w['utils/aiaBilling.ts'] ?? '');
    const i = aia.indexOf('export function payAppReviewNotice(');
    if (!/if \(state\.isLocked\) \{\s*return \{\s*title: 'Sent Record',/.test(aia.slice(i, i + 900))) bad.push('utils/aiaBilling.ts: the locked review notice is not titled "Sent Record"');
    if (w === SHIPPED && realAia.payAppReviewNotice({ isLocked: true }).title !== 'Sent Record') bad.push('payAppReviewNotice({ isLocked: true }).title is not "Sent Record"');
    return bad;
  },

  'E1 flag off, one reader, every entry gated': (w) => {
    const bad: string[] = [];
    const flags = stripComments(w['constants/featureFlags.ts'] ?? '');
    if (!/export const PAY_APP_EASY_ENABLED: boolean = false;/.test(flags)) bad.push('PAY_APP_EASY_ENABLED is not false');
    const A = loader(w)('@/utils/payApp/allowed');
    if (A.payAppEasyAllowed('someone@example.com') !== false || A.payAppEasyAllowed(null) !== false || A.payAppEasyAllowed(undefined) !== false || A.payAppEasyAllowed('') !== false) bad.push('someone who is not the owner is let in while the flag is off');
    if (A.payAppEasyAllowed(OWNER) !== true || A.payAppEasyAllowed(`  ${OWNER.toUpperCase()} `) !== true) bad.push('the owner account is not let in');
    if (A.payAppEasyAllowedWith(false, 'someone@example.com') !== false || A.payAppEasyAllowedWith(true, 'someone@example.com') !== true) bad.push('payAppEasyAllowedWith does not follow the flag');
    if (A.payAppEasyIsOwnerPreview() !== true) bad.push('the feature does not call itself an owner preview while the flag is off');
    for (const [f, src] of Object.entries(w)) {
      if (f === 'constants/featureFlags.ts' || f === 'utils/payApp/allowed.ts') continue;
      if (/PAY_APP_EASY_ENABLED/.test(stripComments(src))) bad.push(`${f}: reads PAY_APP_EASY_ENABLED itself`);
    }
    // Who mounts the feature's screens.
    for (const [f, src] of Object.entries(w)) {
      if (f.startsWith('components/payApp/') || f === 'app/aia-pay-app.tsx') continue;
      if (/from '@\/components\/payApp\//.test(stripComments(src))) bad.push(`${f}: mounts an Easier Pay Applications screen`);
    }
    const screen = stripComments(w['app/aia-pay-app.tsx'] ?? '');
    if (!/const easy = payAppEasyAllowed\(user\?\.email\);/.test(screen)) bad.push('app/aia-pay-app.tsx: `easy` is not the gate\'s answer');
    if ((screen.match(/\beasy = /g) ?? []).length !== 1) bad.push('app/aia-pay-app.tsx: `easy` is assigned more than once');
    for (const tag of ['BillThisMonth', 'RejectionCheckSheet', 'SovImportSheet', 'SovSpreadsheetBar', 'SuggestionRow']) {
      const uses = [...screen.matchAll(new RegExp(`<${tag}\\b`, 'g'))];
      if (uses.length === 0) { bad.push(`app/aia-pay-app.tsx: <${tag}> is not mounted`); continue; }
      for (const u of uses) {
        const before = screen.slice(Math.max(0, (u.index ?? 0) - 1000), u.index);
        if (!/\beasy\b/.test(before)) bad.push(`app/aia-pay-app.tsx: a <${tag}> is not behind \`easy\``);
      }
    }
    if (!/const canBillThisMonth = easy && /.test(screen)) bad.push('app/aia-pay-app.tsx: the Bill This Month button is not behind `easy`');
    if (!/\{easy \? SUGGEST_COPY\.suggestButton : 'Sync from Schedule'\}/.test(screen)) bad.push('app/aia-pay-app.tsx: the Sync button changes for everyone');
    return bad;
  },
  'E2 the core is pure': (w) => {
    const bad: string[] = [];
    for (const f of PURE_CORE) {
      const src = stripComments(w[f] ?? '');
      if (!src) { bad.push(`${f} is missing`); continue; }
      if (/from 'react'|from 'react-native'|from 'expo|AsyncStorage|supabase|fetch\(|XMLHttpRequest/.test(src)) bad.push(`${f}: imports React, storage or the network`);
      if (/Date\.now\(|new Date\(\)|Math\.random\(/.test(src)) bad.push(`${f}: reads the clock or a random number`);
    }
    for (const f of ['utils/payApp/suggestPercent.ts', 'utils/payApp/rejectionCheck.ts', 'utils/payApp/rollForward.ts']) {
      if (/aiRelay|gemini|anthropic|openai|invoke\(/i.test(stripComments(w[f] ?? ''))) bad.push(`${f}: calls a model`);
    }
    return bad;
  },
};

// ── run ─────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
console.log('validate-pay-app-easy\n\n── the shipped tree');
for (const [name, rule] of Object.entries(RULES)) {
  let bad: string[];
  try { bad = rule(SHIPPED); } catch (e) { bad = [`the rule threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`]; }
  if (bad.length === 0) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}\n      ${bad.slice(0, 12).join('\n      ')}${bad.length > 12 ? `\n      … and ${bad.length - 12} more` : ''}`); }
}

// ── planted mutations ───────────────────────────────────────────────────────
interface Mutation { rule: keyof typeof RULES | string; what: string; plant: (w: World) => void }
const sub = (file: string, from: string | RegExp, to: string) => (w: World): void => {
  const before = w[file] ?? '';
  const after = typeof from === 'string' ? before.split(from).join(to) : before.replace(from, to);
  if (after === before) throw new Error(`mutation anchor not found in ${file}: ${String(from).slice(0, 80)}`);
  w[file] = after;
};
const RF = 'utils/payApp/rollForward.ts';
const SP = 'utils/payApp/suggestPercent.ts';
const RC = 'utils/payApp/rejectionCheck.ts';
const SS = 'utils/payApp/sovSpreadsheet.ts';
const SCREEN = 'app/aia-pay-app.tsx';
const BTM = 'components/payApp/BillThisMonth.tsx';
const SHEET = 'components/payApp/RejectionCheckSheet.tsx';

const MUTATIONS: Mutation[] = [
  // Carry-forward.
  { rule: 'C1 carry-forward', what: 'previous work is not carried (D stays the last D)', plant: sub(RF, 'return carryForwardPriorLines(opening, asPrior);', 'return opening;') },
  { rule: 'C1 carry-forward', what: 'this period is carried over instead of opening at zero', plant: sub(RF, 'return { ...rest, thisPeriod: 0 };', 'return { ...rest };') },
  { rule: 'C1 carry-forward', what: 'line 7 ignores what the architect certified', plant: sub(RF, 'lessPreviousCertificates: seedLessPreviousCertificates(prior),', 'lessPreviousCertificates: roundCents(prior.totals?.totalEarnedLessRetainage ?? 0),') },
  { rule: 'C1 carry-forward', what: 'the number is the last number again', plant: sub(RF, 'const applicationNumber = nextApplicationNumber(saved, undefined);', 'const applicationNumber = nextApplicationNumber(saved, undefined) - 1;') },
  { rule: 'C1 carry-forward', what: 'rolls forward with nothing to start from', plant: sub(RF, 'if (saved.length === 0) return null;', 'if (saved.length === 0) return { app: {} as never, carriedFrom: { applicationNumber: 0 }, period: { to: input.today, toIsDefault: true }, notes: [] };') },
  { rule: 'C2 negotiated schedule of values survives', what: 'retainage is stepped down by the app', plant: sub(RF, 'retainagePercent: prior.retainagePercent,', 'retainagePercent: prior.retainagePercent / 2,') },
  { rule: 'C2 negotiated schedule of values survives', what: 'item numbers are rewritten 1 to N', plant: sub(RF, 'return carryForwardPriorLines(opening, asPrior);', 'return carryForwardPriorLines(opening, asPrior).map((l, i) => ({ ...l, itemNo: String(i + 1) }));') },
  { rule: 'C2 negotiated schedule of values survives', what: 'line 1 is not carried', plant: sub(RF, 'originalContractSum: roundCents(prior.originalContractSum),', 'originalContractSum: 0,') },
  { rule: 'C3 the period is calendar days', what: 'every month has 31 days', plant: sub('utils/payApp/days.ts', "  if (r.d < daysInMonth(r.y, r.m)) return write({ ...r, d: r.d + 1 });", '  if (r.d < 31) return write({ ...r, d: r.d + 1 });') },
  { rule: 'C3 the period is calendar days', what: 'no leap day', plant: sub('utils/payApp/days.ts', "if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;", 'if (m === 2) return 28;') },
  { rule: 'C3 the period is calendar days', what: 'Period To is the day the period starts', plant: sub(RF, 'const to = endOfMonth(from);', 'const to = from ?? null;') },
  { rule: 'C3 the period is calendar days', what: 'Period From is built with milliseconds', plant: sub(RF, 'const from = dayAfter(latestDay) ?? undefined;', 'const from = new Date(new Date(latestDay).getTime() + 86400000).toISOString().slice(0, 10);') },
  { rule: 'C4 change orders by period', what: 'change orders approved after Period To are swept in', plant: sub(RF, 'splitApprovedCOsByPeriod([...changeOrders], periodTo).inPeriod', '[...splitApprovedCOsByPeriod([...changeOrders], periodTo).inPeriod, ...splitApprovedCOsByPeriod([...changeOrders], periodTo).afterPeriod]') },
  { rule: 'C4 change orders by period', what: 'new change orders are not added', plant: sub(RF, 'const app = restatePeriodTo(base, input.changeOrders, to);', 'const app = base;') },
  { rule: 'C4 change orders by period', what: 'a Period To that is not a date restates the lines', plant: sub(RF, 'if (!isCalendarDay(periodTo)) return next;', '') },
  { rule: 'C5 input is only read, answer is deterministic', what: 'rolling forward zeroes the saved record in place', plant: sub(RF, 'const asPrior = prior.lines.map(savedLineToSov);', 'prior.lines.forEach((l) => { l.thisPeriod = 0; }); const asPrior = prior.lines.map(savedLineToSov);') },
  { rule: 'C5 input is only read, answer is deterministic', what: 'the check sorts the caller\'s lines', plant: sub(RC, 'const totals = computeAIATotals(app);', 'app.lines.sort((a, b) => a.itemNo.localeCompare(b.itemNo)); const totals = computeAIATotals(app);') },

  // Suggestions.
  { rule: 'S1 no project average', what: 'the project average is back on unlinked lines', plant: sub(SP, "if (linked.length === 0) return none('no_linked_task');", "if (linked.length === 0) { const avg = tasks.reduce((s, t) => s + t.progress, 0) / Math.max(1, tasks.length); return { kind: 'suggest', suggestion: { lineId: line.id, percent: avg, thisPeriod: thisPeriodForPercent(line, avg), source: { kind: 'schedule_tasks_weighted', taskIds: tasks.map(t => t.id), count: tasks.length }, sentence: 'Schedule: project progress.' } }; }") },
  { rule: 'S1 no project average', what: 'an unlinked line borrows every task', plant: sub(SP, "  if (!key) return [];\n  return tasks.filter(t => (t.linkedEstimateItems ?? []).includes(key));", '  if (!key) return [...tasks];\n  const own = tasks.filter(t => (t.linkedEstimateItems ?? []).includes(key));\n  return own.length ? own : [...tasks];') },
  { rule: 'S1 no project average', what: 'the reason is not said', plant: sub('utils/payApp/suggestCopy.ts', "no_linked_task: 'No suggestion. No schedule task is linked to this line.',", "no_linked_task: 'No suggestion.',") },
  { rule: 'S2 where a percent comes from', what: 'a daily report dated after the period end counts', plant: sub(SP, 'if (!day || day > periodTo) continue;', 'if (!day) continue;') },
  { rule: 'S2 where a percent comes from', what: 'the oldest daily report wins', plant: sub(SP, 'if (!best || day > best.day || (day === best.day && pct > best.pct)) best = { day, pct };', 'if (!best || day < best.day) best = { day, pct };') },
  { rule: 'S2 where a percent comes from', what: 'daily reports are ignored', plant: sub(SP, 'if (best) return { pct: best.pct, reportDate: best.day };', '') },
  { rule: 'S2 where a percent comes from', what: 'rounded to a whole percent, as the old sync did', plant: sub(SP, '      ? weighted / weightSum', '      ? Math.round(weighted / weightSum)') },
  { rule: 'S2 where a percent comes from', what: 'several tasks are averaged, not weighted', plant: sub(SP, 'const w = Number.isFinite(t.durationDays) && t.durationDays > 0 ? t.durationDays : 0;', 'const w = 1;') },
  { rule: 'S2 where a percent comes from', what: 'a suggestion on a deductive line', plant: sub(SP, "if (!(line.scheduledValue > 0)) return none('not_positive_value');", '') },
  { rule: 'S2 where a percent comes from', what: 'a zero suggestion is offered when the schedule is behind', plant: sub(SP, '  if (!(thisPeriod > 0)) {', '  if (thisPeriod < 0) {') },
  { rule: 'S2 where a percent comes from', what: 'the line\'s own task link is ignored', plant: sub(SP, '    if (own) return [own];', '') },
  { rule: 'S3 the percent arithmetic is the screen\'s own', what: 'stored material no longer counts toward the percent', plant: sub(SP, 'const thisPeriod = Math.max(0, totalCompleted - line.fromPreviousApp - line.materialsPresentlyStored);', 'const thisPeriod = Math.max(0, totalCompleted - line.fromPreviousApp);') },
  { rule: 'S3 the percent arithmetic is the screen\'s own', what: 'a percent can bill past the scheduled value', plant: sub(SP, 'const totalCompleted = Math.max(0, Math.min(line.scheduledValue, line.scheduledValue * (percent / 100)));', 'const totalCompleted = Math.max(0, line.scheduledValue * (percent / 100));') },
  { rule: 'S3 the percent arithmetic is the screen\'s own', what: 'the screen keeps its own copy of the formula', plant: sub(SCREEN, 'return { ...l, thisPeriod: thisPeriodForPercent(l, percent), ...(kept ?? {}) };', 'return { ...l, thisPeriod: roundCents(Math.max(0, l.scheduledValue * (percent / 100) - l.fromPreviousApp)), ...(kept ?? {}) };') },
  { rule: 'S4 never counted until accepted', what: 'building suggestions writes them onto the lines', plant: sub(SP, "  return { kind: 'suggest', suggestion: { lineId: line.id, percent, thisPeriod, source, sentence } };", "  line.thisPeriod = thisPeriod;\n  return { kind: 'suggest', suggestion: { lineId: line.id, percent, thisPeriod, source, sentence } };") },
  { rule: 'S4 never counted until accepted', what: 'Bill This Month accepts everything when it opens', plant: sub(BTM, '  const tally = useMemo(', "  React.useEffect(() => { setApp(prev => (prev ? { ...prev, lines: prev.lines.map(l => { const r = suggestions[l.id]; return r && r.kind === 'suggest' ? acceptSuggestion(l, r.suggestion) : l; }) } : prev)); }, [suggestions]);\n  const tally = useMemo(") },
  { rule: 'S4 never counted until accepted', what: 'the footer adds the open suggestions to the work total', plant: sub(BTM, 'const workThis = roundCents(app.lines.reduce((s, l) => s + l.thisPeriod, 0));', 'const workThis = roundCents(app.lines.reduce((s, l) => s + l.thisPeriod, 0) + tally.openAmount);') },
  { rule: 'S4 never counted until accepted', what: 'Accept All skips the confirm', plant: sub(BTM, 'showAlert(SUGGEST_COPY.acceptAllTitle, SUGGEST_COPY.acceptAllBody(tally.open, tally.openAmount), [', 'void ([') },
  { rule: 'S4 never counted until accepted', what: 'the footer stops saying what is not in the total', plant: sub(BTM, '{tally.open > 0 ? (', '{tally.open > 99 ? (') },
  { rule: 'S4 never counted until accepted', what: 'Suggest from Schedule applies each suggestion at once', plant: sub(SCREEN, '      setSuggestions(found);\n', "      setSuggestions(found);\n      Object.values(found).forEach((r) => { if (r.kind === 'suggest') applyPercentToLine(r.suggestion.lineId, r.suggestion.percent); });\n") },
  { rule: 'S4 never counted until accepted', what: 'Suggest from Schedule falls through to the old project average', plant: sub(SCREEN, "        showAlert(SUGGEST_COPY.noneFoundTitle, SUGGEST_COPY.noneFoundBody);\n      }\n      return;\n    }", "        showAlert(SUGGEST_COPY.noneFoundTitle, SUGGEST_COPY.noneFoundBody);\n      }\n    }") },
  { rule: 'S4 never counted until accepted', what: 'accepting one line\'s suggestion lands on any line', plant: sub(SP, '  if (s.lineId !== line.id) return line;', '') },
  { rule: 'S4 never counted until accepted', what: 'an untouched suggestion is counted as accepted', plant: sub(SP, "    if ((states[lineId] ?? 'untouched') !== 'untouched') continue;", "    if ((states[lineId] ?? 'accepted') !== 'untouched') continue;") },
  { rule: 'S4 never counted until accepted', what: 'the invoice behind the period bills lines with nothing entered', plant: sub('utils/payApp/periodInvoice.ts', 'return lines.filter(l => roundCents(l.thisPeriod) > 0);', 'return [...lines];') },

  // Rejection Check: switching any one rule off must turn its fixture red.
  ...PHASE_ONE_RULES.map((id): Mutation => ({
    rule: 'R1 every rule trips on its own fixture', what: `the ${id} rule is switched off`,
    plant: sub(RC, '    const outcome = rule.run();', `    const outcome = rule.id === '${id}' ? [] : rule.run();`),
  })),
  { rule: 'R1 every rule trips on its own fixture', what: 'the tolerance is widened to a dollar', plant: sub(RC, 'export const CHECK_TOLERANCE = 0.01;', 'export const CHECK_TOLERANCE = 1;') },
  { rule: 'R1 every rule trips on its own fixture', what: 'a one-cent difference is flagged', plant: sub(RC, 'Math.abs(roundCents(a - b)) > CHECK_TOLERANCE;', 'Math.abs(roundCents(a - b)) >= CHECK_TOLERANCE;') },
  { rule: 'R1 every rule trips on its own fixture', what: 'a finding no longer points at its line', plant: sub(RC, "    action: { kind: 'line', lineId: l.id, itemNo: l.itemNo, label: REJECTION_COPY.goToLine(l.itemNo) },", '') },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'the result grows an "ok" field', plant: sub(RC, 'const result: CheckResult = { flagged: [], ranClean: [], notRun: [] };', 'const result: CheckResult = { flagged: [], ranClean: [], notRun: [], ok: true } as CheckResult;') },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'Continue Anyway is disabled while anything is flagged', plant: sub(SHEET, "              variant={fix && onGoToLine ? 'secondary' : 'primary'}", "              variant={fix && onGoToLine ? 'secondary' : 'primary'}\n              disabled={!!result && result.flagged.length > 0}") },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'the lead sentence is dropped', plant: sub(SHEET, /<Text style=\{styles\.lead\} testID=\{`\$\{testID\}-lead`\}>\{REJECTION_COPY\.lead\}<\/Text>/, '') },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'the Not Checked by MAGE ID block is dropped', plant: sub(SHEET, /<Text style=\{styles\.notChecked\}[\s\S]*?<\/Text>[\s\S]*?<\/Text>/, '') },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'the Not Checked block shows only when something is flagged', plant: sub(SHEET, '          <Text style={styles.notChecked} testID={`${testID}-not-checked`}>', '          {result.flagged.length > 0 ? (\n          <Text style={styles.notChecked} testID={`${testID}-not-checked`}>') },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'a clean row says "Passed"', plant: sub('utils/payApp/rejectionCopy.ts', "nothingFlagged: 'Nothing flagged',", "nothingFlagged: 'Passed',") },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'the lead promises the application is correct', plant: sub('utils/payApp/rejectionCopy.ts', 'They do not say this application is correct or that it will be accepted.', 'This application is correct.') },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'rules that cannot run are listed as clean', plant: sub(RC, '      result.notRun.push({ id: rule.id, label: rule.label, why: outcome.notRun });', '      result.ranClean.push({ id: rule.id, label: rule.label });') },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'a green tick is drawn on clean rows', plant: sub(SHEET, "import { Pressable, Text, View } from 'react-native';", "import { Pressable, Text, View } from 'react-native';\nimport { CheckCircle } from 'lucide-react-native';") },
  { rule: 'R2 the check never blocks and gives no verdict', what: 'the check result is stored on the record', plant: sub('utils/payApp/saveRecord.ts', '    savedAt: input.savedAt,', '    savedAt: input.savedAt,\n    rejectionCheck: undefined,') },
  { rule: 'R3 the certify sheet opens only after the check was shown', what: 'the certify sheet opens without the check', plant: sub(SCREEN, 'if (easy && checkShownForRef.current !== checkFingerprint(app)) {', 'if (false) {') },
  { rule: 'R3 the certify sheet opens only after the check was shown', what: 'the check blocks the send while anything is flagged', plant: sub(SCREEN, '    checkShownForRef.current = checkFingerprint(app);\n    setCheckOpen(null);', '    if (rejectionCheck && rejectionCheck.flagged.length > 0) return;\n    checkShownForRef.current = checkFingerprint(app);\n    setCheckOpen(null);') },
  { rule: 'R3 the certify sheet opens only after the check was shown', what: 'the fingerprint ignores this period', plant: sub(RC, 'l.id, l.itemNo, c(l.scheduledValue), c(l.fromPreviousApp), c(l.thisPeriod), c(l.materialsPresentlyStored),', 'l.id, l.itemNo, c(l.scheduledValue), c(l.fromPreviousApp), c(l.materialsPresentlyStored),') },
  { rule: 'R3 the certify sheet opens only after the check was shown', what: 'on the way to certify there is no Continue Anyway', plant: sub(SCREEN, "onContinue={checkOpen === 'certify' ? continueToCertify : undefined}", 'onContinue={undefined}') },

  // Wording.
  { rule: 'W1 wording', what: 'a suggestion says the percent is verified', plant: sub('utils/payApp/suggestCopy.ts', '`Schedule: ${name} is marked ${fmtPct(progress)}%.`', '`Schedule: ${name} is verified at ${fmtPct(progress)}%.`') },
  { rule: 'W1 wording', what: 'a clean check label says compliant', plant: sub('utils/payApp/rejectionCopy.ts', "retainage: (rate?: number) => (rate != null ? `Retainage equals your ${fmtPct(rate)}% rate` : 'Lines carry one retainage rate'),", "retainage: (rate?: number) => (rate != null ? `Retainage is compliant at ${fmtPct(rate)}%` : 'Lines carry one retainage rate'),") },
  { rule: 'W1 wording', what: 'a finding says what the reviewer will do', plant: sub('utils/payApp/rejectionCopy.ts', "summary: 'Total billed is over the contract sum to date',", "summary: 'This will not be approved',") },
  { rule: 'W1 wording', what: 'the heading reads "Ready To Submit"', plant: sub('utils/payApp/rejectionCopy.ts', "(n === 0 ? 'Nothing Flagged' :", "(n === 0 ? 'Ready To Submit' :") },
  { rule: 'W1 wording', what: 'a date is called a deadline', plant: sub('utils/payApp/suggestCopy.ts', "periodToDefault: 'Period to is set to the end of the month. Change it if your period ends on another day.',", "periodToDefault: 'Your deadline to bill is the end of the month.',") },
  { rule: 'W1 wording', what: 'the export says it fills the official form', plant: sub(SS, "claim: 'Export your figures to type or paste into the software your owner requires.',", "claim: 'Fills the official form for you.',") },
  { rule: 'W1 wording', what: 'an em dash in a sentence', plant: sub('utils/payApp/suggestCopy.ts', "billed_in_full: 'Billed in full. Nothing to enter.',", "billed_in_full: 'Billed in full — nothing to enter.',") },
  { rule: 'W1 wording', what: 'money without cents', plant: sub('utils/payApp/rejectionCopy.ts', 'const money = (n: number): string => formatMoney(n, 2);', 'const money = (n: number): string => formatMoney(n, 0);') },

  // Spreadsheet.
  { rule: 'X1 export and round trip', what: 'a form name in the header row', plant: sub(SS, "  'Item No.',\n  'Description of Work',", "  'G703 Item No.',\n  'Description of Work',") },
  { rule: 'X1 export and round trip', what: 'the columns are out of the standard order', plant: sub(SS, "      num2(l.fromPreviousApp),\n      num2(l.thisPeriod),", "      num2(l.thisPeriod),\n      num2(l.fromPreviousApp),") },
  { rule: 'X1 export and round trip', what: 'cells are written without quoting', plant: sub(SS, "    ? `\"${cell.replace(/\"/g, '\"\"')}\"`\n    : cell;", '    ? cell\n    : cell;') },
  { rule: 'X1 export and round trip', what: 'thousands separators in the numbers', plant: sub(SS, "(Number.isFinite(n) ? roundCents(n).toFixed(2) : '0.00')", "(Number.isFinite(n) ? roundCents(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00')") },
  { rule: 'X2 import is never silent', what: 'a cell that is not an amount is read as zero', plant: sub(SS, "    if (scheduled === null) {\n      plan.bad.push({ rowNumber, reason: SOV_IMPORT_COPY.badScheduled(scheduledText), cells: [...r] });\n      return;\n    }\n    const row: SovImportRow = { rowNumber, itemNo, description, scheduledValue: roundCents(scheduled) };", '    const row: SovImportRow = { rowNumber, itemNo, description, scheduledValue: roundCents(scheduled ?? 0) };') },
  { rule: 'X2 import is never silent', what: 'unreadable rows are dropped without a word', plant: sub(SS, "      plan.bad.push({ rowNumber, reason: SOV_IMPORT_COPY.badScheduled(scheduledText), cells: [...r] });\n", '') },
  { rule: 'X2 import is never silent', what: 'total rows are imported as lines', plant: sub(SS, '    if (isTotalRow(itemNo, description)) {', '    if (false) {') },
  { rule: 'X2 import is never silent', what: 'any description starting with Total is thrown out', plant: sub(SS, 'TOTAL_WORD.test(description) || TOTAL_WORD.test(itemNo) || (!itemNo && TOTAL_LEAD.test(description));', 'TOTAL_LEAD.test(description) || TOTAL_LEAD.test(itemNo);') },
  { rule: 'X2 import is never silent', what: 'replace is allowed on an application with money on it', plant: sub(SS, "  if (mode === 'replace_all' && hasMoney) return { app, updated: 0, added: 0, refused: 'has_money' };", '') },
  { rule: 'X2 import is never silent', what: 'an update overwrites previous work', plant: sub(SS, 'lines[target] = { ...lines[target], description: r.description || lines[target].description, scheduledValue: r.scheduledValue };', 'lines[target] = { ...lines[target], description: r.description || lines[target].description, scheduledValue: r.scheduledValue, fromPreviousApp: r.fromPreviousApp ?? lines[target].fromPreviousApp };') },
  { rule: 'X2 import is never silent', what: 'a new line on a billed application carries the file\'s money', plant: sub(SS, '      lines.push(fresh(r, lines.length + 1, false));', '      lines.push(fresh(r, lines.length + 1, true));') },
  { rule: 'X2 import is never silent', what: 'the total column is taken for stored materials', plant: sub(SS, 'const idx = first.findIndex((c, i) => !taken.has(i) && !COMPUTED_HEADER.test(c) && re.test(c));', 'const idx = first.findIndex((c, i) => !taken.has(i) && re.test(c));') },

  // Lock at send, and the clean-ups.
  { rule: 'L1 lock at send', what: 'the lock still depends on the pay link', plant: sub('utils/payApp/sendLock.ts', "  if (facts.sentLockedAt) return { locked: true, reason: 'sent' };\n", '') },
  { rule: 'L1 lock at send', what: 'a second certify moves the stamp', plant: sub('utils/payApp/sendLock.ts', '  if (rec.sentLockedAt) return rec;\n', '') },
  { rule: 'L1 lock at send', what: 'everyone is stamped, not only the preview', plant: sub('utils/payApp/sendLock.ts', '  if (!allowed) return rec;\n', '') },
  { rule: 'L1 lock at send', what: 'the screen goes back to the pay link alone', plant: sub(SCREEN, 'const isLocked = lockState.locked;', "const isLocked = lockState.locked && lockState.reason !== 'sent';") },
  { rule: 'L1 lock at send', what: 'certify stops stamping', plant: sub(SCREEN, 'withSentLock({ ...built, id: pinCertifyRecordId(built.id) }, new Date().toISOString(), easy)', '({ ...built, id: pinCertifyRecordId(built.id) })') },
  { rule: 'L1 lock at send', what: 'a plain save stamps the record too', plant: sub(SCREEN, '    const rec = buildSavedRecord();\n    if (!rec) return;\n', '    const rec = withSentLock(buildSavedRecord() as SavedAIAPayApp, new Date().toISOString(), easy);\n    if (!rec) return;\n') },
  { rule: 'L2 the lien deadline card is hidden', what: 'LIEN_CLOCK_ENABLED is flipped on', plant: sub('constants/featureFlags.ts', 'export const LIEN_CLOCK_ENABLED: boolean = false;', 'export const LIEN_CLOCK_ENABLED: boolean = true;') },
  { rule: 'L2 the lien deadline card is hidden', what: 'the invoice screen mounts the card without the flag', plant: sub('app/invoice.tsx', "{LIEN_CLOCK_ENABLED && existingInvoice && effectiveStatus === 'overdue'", "{existingInvoice && effectiveStatus === 'overdue'") },
  { rule: 'L2 the lien deadline card is hidden', what: 'the card is mounted on another screen', plant: (w) => { w['app/pay-deadlines.tsx'] = "import { LienClockCard } from '@/components/invoice/LienClockCard';\nexport default function P() { return <LienClockCard projectId=\"p\" />; }"; } },
  { rule: 'L2 the lien deadline card is hidden', what: 'the clock code is deleted instead of hidden', plant: (w) => { delete w['utils/lienRightsClock.ts']; } },
  { rule: 'L3 a locked record reads Sent Record', what: '"Certified Record" is back on the locked banner', plant: sub('utils/aiaBilling.ts', "title: 'Sent Record',", "title: 'Certified Record',") },
  { rule: 'L3 a locked record reads Sent Record', what: 'a new screen titles a record "Certified Record"', plant: (w) => { w['components/payApp/Stamp.tsx'] = "export const Stamp = () => <Text>Certified Record</Text>;"; } },

  // The gate.
  { rule: 'E1 flag off, one reader, every entry gated', what: 'PAY_APP_EASY_ENABLED is flipped on', plant: sub('constants/featureFlags.ts', 'export const PAY_APP_EASY_ENABLED: boolean = false;', 'export const PAY_APP_EASY_ENABLED: boolean = true;') },
  { rule: 'E1 flag off, one reader, every entry gated', what: 'the gate lets everyone in', plant: sub('utils/payApp/allowed.ts', 'return flagOn === true || isOwner(userEmail);', 'return true;') },
  { rule: 'E1 flag off, one reader, every entry gated', what: 'the gate ignores the owner list', plant: sub('utils/payApp/allowed.ts', 'return flagOn === true || isOwner(userEmail);', 'return flagOn === true;') },
  { rule: 'E1 flag off, one reader, every entry gated', what: 'a screen reads the flag itself', plant: sub(BTM, "import { Button } from '@/components/ui';", "import { Button } from '@/components/ui';\nimport { PAY_APP_EASY_ENABLED } from '@/constants/featureFlags';") },
  { rule: 'E1 flag off, one reader, every entry gated', what: '`easy` is true for everyone', plant: sub(SCREEN, 'const easy = payAppEasyAllowed(user?.email);', 'const easy = true;') },
  { rule: 'E1 flag off, one reader, every entry gated', what: 'the Rejection Check sheet is mounted for everyone', plant: sub(SCREEN, '      {easy ? (\n        <RejectionCheckSheet', '      {app ? (\n        <RejectionCheckSheet') },
  { rule: 'E1 flag off, one reader, every entry gated', what: 'the spreadsheet bar is shown to everyone', plant: sub(SCREEN, '          {easy ? (\n            <SovSpreadsheetBar', '          {app ? (\n            <SovSpreadsheetBar') },
  { rule: 'E1 flag off, one reader, every entry gated', what: 'Bill This Month is offered to everyone', plant: sub(SCREEN, 'const canBillThisMonth = easy && savedForProject', 'const canBillThisMonth = savedForProject') },
  { rule: 'E1 flag off, one reader, every entry gated', what: 'the Sync button is relabelled for everyone', plant: sub(SCREEN, "{easy ? SUGGEST_COPY.suggestButton : 'Sync from Schedule'}", '{SUGGEST_COPY.suggestButton}') },
  { rule: 'E1 flag off, one reader, every entry gated', what: 'another screen mounts Bill This Month', plant: (w) => { w['app/invoice.tsx'] = `import { BillThisMonth } from '@/components/payApp/BillThisMonth';\n${w['app/invoice.tsx']}`; } },
  { rule: 'E2 the core is pure', what: 'the roll-forward reads the clock', plant: sub(RF, "applicationDate: dayKeyOf(input.today) ?? input.today,", 'applicationDate: new Date().toISOString().slice(0, 10),') },
  { rule: 'E2 the core is pure', what: 'the check reads device storage', plant: sub(RC, "import { roundCents } from '@/utils/invoiceBilling';", "import { roundCents } from '@/utils/invoiceBilling';\nimport AsyncStorage from '@react-native-async-storage/async-storage';\nvoid AsyncStorage;") },
  { rule: 'E2 the core is pure', what: 'a suggestion asks a model', plant: sub(SP, 'const periodTo = dayKeyOf(input.periodTo);', 'const periodTo = dayKeyOf(input.periodTo); void fetch(\'https://example.com/gemini\');') },
];

console.log('\n── planted mutations (each must turn its own rule red)');
const proven = new Set<string>();
for (const m of MUTATIONS) {
  const w: World = { ...SHIPPED };
  let caught = false;
  let how = '';
  try {
    m.plant(w);
    const rule = RULES[m.rule as string];
    if (!rule) throw new Error(`no such rule: ${m.rule}`);
    let bad: string[];
    try { bad = rule(w); } catch (e) { bad = [`threw: ${e instanceof Error ? e.message : String(e)}`]; }
    caught = bad.length > 0;
    how = caught ? bad[0] : 'the rule stayed green';
  } catch (e) {
    how = `mutation could not be planted: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (caught) { pass += 1; proven.add(m.rule as string); console.log(`  ✓ ${m.rule}: ${m.what}`); }
  else { fail += 1; console.log(`  ✗ ${m.rule}: ${m.what}\n      ${how}`); }
}
const unproven = Object.keys(RULES).filter(r => !proven.has(r));
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-pay-app-easy: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
