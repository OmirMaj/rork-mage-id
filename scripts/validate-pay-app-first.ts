// scripts/validate-pay-app-first.ts — the job's FIRST pay application, started
// on the Bill This Month screen with no progress invoice made first (Easier
// Pay Applications, Phase 1b; utils/payApp/firstApplication.ts).
//
// WHAT THIS HOLDS
//   A. By running it: the first application's lines are the linked estimate's
//      and the approved change orders through Period To; this period is ZERO
//      on every line; nothing is carried; the retainage rate is the one on
//      record or 0 with a note that none is on record (never a made-up rate);
//      a job with no linked estimate, or with an application already, is
//      refused; the figures are the ones the pay application screen's own
//      first-period seed gives.
//   B. By reading the screens: Bill This Month tries the roll forward first
//      and the first application second; the entry is behind the owner-preview
//      gate; the screen says it is a first application and where the retainage
//      rate came from.
//   C. Planted mutations: each line above is broken once, in memory, and its
//      rule must go red.
//
// Run: bun run scripts/validate-pay-app-first.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChangeOrder, CompanyBranding, Project, SavedAIAPayApp } from '../types';
import { computeAIATotals } from '../utils/aiaBilling';
import { changeOrderLineCount, firstApplicationState, startFirstApplication } from '../utils/payApp/firstApplication';
import { rollForwardNextApplication } from '../utils/payApp/rollForward';
import { buildPeriodInvoice } from '../utils/payApp/periodInvoice';
import { SUGGEST_COPY } from '../utils/payApp/suggestCopy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ═══ A. By running it ═══════════════════════════════════════════════════════
const item = (id: string, name: string, lineTotal: number) => ({ materialId: id, name, category: 'general', unit: 'LS', quantity: 1, unitPrice: lineTotal, markup: 0, lineTotal, bulkPrice: lineTotal, usesBulk: false, supplier: '' });
const PROJECT = {
  id: 'p1', name: 'Alder Street Kitchen', location: '14 Alder Street', description: 'Kitchen and bath',
  linkedEstimate: { id: 'e1', items: [item('demo', 'Demolition', 4400), item('frame', 'Framing', 9900.5), item('tile', 'Tile', 4347)], grandTotal: 18647.5 },
  retainagePercent: 10,
} as unknown as Project;
const BRAND = { companyName: 'Example Builders' } as CompanyBranding;
const co = (id: string, amount: number, status: string, date: string) => ({ id, projectId: 'p1', number: 1, description: `CO ${id}`, changeAmount: amount, status, date, updatedAt: `${date}T12:00:00.000Z`, lineItems: [] }) as unknown as ChangeOrder;
const COS = [co('c1', 1480, 'approved', '2026-10-05'), co('c2', 900, 'approved', '2026-11-20'), co('c3', 700, 'submitted', '2026-10-06')];
const TODAY = '2026-10-08';
const base = { project: PROJECT, saved: [] as SavedAIAPayApp[], changeOrders: COS, contract: null, branding: BRAND, invoices: [], today: TODAY };

const first = startFirstApplication(base);
ok('a job with a linked estimate and no application can start its first one', firstApplicationState(PROJECT, []) === 'can_start' && !!first);
const app = first!.app;
ok('it is application 1, with no period start and Period To on the last day of this month', app.applicationNumber === 1 && app.periodFrom === undefined && app.periodTo === '2026-10-31' && first!.period.to === '2026-10-31' && first!.carriedFrom === null);
ok('the application date opens on the period end when that is later than today', app.applicationDate === '2026-10-31' && startFirstApplication({ ...base, today: '2026-10-31' })!.app.applicationDate === '2026-10-31');
const estLines = app.lines.filter(l => !/CO c/.test(l.description));
ok('one line per estimate item, at the estimate\'s own value, in the estimate\'s order', estLines.length === 3 && estLines.map(l => l.scheduledValue).join(',') === '4400,9900.5,4347' && estLines.map(l => l.description).join('|') === 'Demolition|Framing|Tile', JSON.stringify(app.lines.map(l => [l.description, l.scheduledValue])));
ok('a change order approved on or before Period To is a line; one approved later, or not approved, is not', app.lines.length === 4 && app.lines.some(l => l.scheduledValue === 1480) && !app.lines.some(l => l.scheduledValue === 900 || l.scheduledValue === 700) && app.netChangeByCO === 1480, JSON.stringify(app.lines.map(l => l.scheduledValue)));
ok('starting bills nothing: this period, previous work and stored materials are zero on every line', app.lines.every(l => l.thisPeriod === 0 && l.fromPreviousApp === 0 && l.materialsPresentlyStored === 0));
const totals = computeAIATotals(app);
ok('so the payment due is zero and nothing is held', totals.currentPaymentDue === 0 && totals.totalRetainage === 0 && app.lessPreviousCertificates === 0, JSON.stringify(totals));
ok('line 1 is the estimate (no signed contract on file), and the contract sum to date adds the approved change order', app.originalContractSum === 18647.5 && app.contractSumToDate === 20127.5 && app.sovBasis === 'linked_estimate');
ok('the schedule of values adds up to the contract sum to date', Math.abs(app.lines.reduce((s, l) => s + l.scheduledValue, 0) - app.contractSumToDate) < 0.005);
ok('line ids are unique', new Set(app.lines.map(l => l.id)).size === app.lines.length);
ok('the retainage rate is the one typed on the job, and the note says where it came from', app.retainagePercent === 10 && first!.notes.some(n => n.kind === 'retainage_from_record' && n.percent === 10 && n.label.length > 0));
ok('the first note says this is a first application and how many lines it has', first!.notes[0].kind === 'first_application' && (first!.notes[0] as { lineCount: number }).lineCount === 4);

const noRate = startFirstApplication({ ...base, project: { ...PROJECT, retainagePercent: undefined } as Project });
ok('with no rate on record the application opens at 0 and says none is on record: no rate is made up', !!noRate && noRate.app.retainagePercent === 0 && noRate.notes.some(n => n.kind === 'retainage_not_on_record') && !noRate.notes.some(n => n.kind === 'retainage_from_record'));
const carried = startFirstApplication({ ...base, project: { ...PROJECT, retainagePercent: undefined } as Project, invoices: [{ id: 'i1', number: 4, status: 'sent', retentionPercent: 5, createdAt: '2026-09-01T12:00:00.000Z' }] });
ok('an earlier invoice that held a rate gives the rate, with its number in the label', carried?.app.retainagePercent === 5 && carried.notes.some(n => n.kind === 'retainage_from_record' && /#4/.test(n.label)));

const NO_EST = { ...PROJECT, linkedEstimate: undefined } as Project;
ok('a job with no linked estimate, or an empty one, cannot start a first application here', firstApplicationState(NO_EST, []) === 'no_estimate' && startFirstApplication({ ...base, project: NO_EST }) === null
  && firstApplicationState({ ...PROJECT, linkedEstimate: { ...PROJECT.linkedEstimate!, items: [] } } as Project, []) === 'no_estimate');
const SAVED = [{ id: 's1', projectId: 'p1', applicationNumber: 1, periodTo: '2026-09-30', lines: [{ id: 'sov_demo', itemNo: '1', description: 'Demolition', scheduledValue: 4400, fromPreviousApp: 0, thisPeriod: 2200, materialsPresentlyStored: 0, retainagePercent: 10 }], retainagePercent: 10, originalContractSum: 18647.5, netChangeByCO: 0, contractSumToDate: 18647.5 }] as unknown as SavedAIAPayApp[];
ok('a job that already has an application rolls forward instead: no second "first"', firstApplicationState(PROJECT, SAVED) === 'has_application' && startFirstApplication({ ...base, saved: SAVED }) === null && !!rollForwardNextApplication({ project: PROJECT, saved: SAVED, changeOrders: COS, contract: null, today: TODAY }));
ok('an application saved on ANOTHER job, or one saved with no lines, does not stop this job\'s first', firstApplicationState(PROJECT, [{ ...SAVED[0], projectId: 'other' }]) === 'can_start' && firstApplicationState(PROJECT, [{ ...SAVED[0], lines: [] }]) === 'can_start');
ok('the same day gives the same application (no clock, no random id)', JSON.stringify(startFirstApplication(base)) === JSON.stringify(first));
const frozenItems = PROJECT.linkedEstimate!.items.map(i => Object.freeze({ ...i }));
let threw = false;
try { startFirstApplication({ ...base, project: Object.freeze({ ...PROJECT, linkedEstimate: Object.freeze({ ...PROJECT.linkedEstimate!, items: Object.freeze(frozenItems) }) }) as unknown as Project }); } catch { threw = true; }
ok('starting does not change the job or its estimate', !threw);

// The period invoice made when he saves: only what he entered.
const nothing = buildPeriodInvoice({ projectId: 'p1', lines: app.lines, estimateItems: PROJECT.linkedEstimate!.items, applicationNumber: 1, number: 1, now: '2026-10-08T12:00:00.000Z', taxRate: 0, terms: { paymentTerms: 'net_30', confirmed: false }, newInvoiceId: () => 'inv', newLineId: () => 'ln' });
ok('with nothing entered there is no invoice to save', nothing === null);
const entered = app.lines.map((l, i) => (i === 0 ? { ...l, thisPeriod: 2200 } : l));
const inv = buildPeriodInvoice({ projectId: 'p1', lines: entered, estimateItems: PROJECT.linkedEstimate!.items, applicationNumber: 1, number: 1, now: '2026-10-08T12:00:00.000Z', taxRate: 0, terms: { paymentTerms: 'net_30', confirmed: false }, newInvoiceId: () => 'inv', newLineId: () => 'ln' });
ok('with one line entered the invoice behind the period carries that line and no due date he did not confirm', !!inv && inv.lineItems.length === 1 && inv.subtotal === 2200 && inv.dueDate === '', JSON.stringify(inv && [inv.lineItems.length, inv.subtotal, inv.dueDate]));

// The words.
const WORDS = [SUGGEST_COPY.firstEntryLabel, SUGGEST_COPY.firstEntryHint, SUGGEST_COPY.firstNoEstimateHint, SUGGEST_COPY.firstHeading(1, 0), SUGGEST_COPY.firstHeading(10, 2), SUGGEST_COPY.firstLead, SUGGEST_COPY.firstPeriodNoStart, SUGGEST_COPY.retainageFromRecord('10', 'from your contract'), SUGGEST_COPY.retainageNotOnRecord];
ok('the words: no dash, no and-sign, and no word that calls anything approved, compliant or ready to submit', // "Approved Change Order" is the status in the contractor's own change order log, not a word about this application.
  WORDS.every(w => !/[—–&]/.test(w) && !/\b(approved|compliant|verified|accurate|guarantee|ready to submit|valid|will be accepted|safe)\b/i.test(w.replace(/Approved Change Orders?/g, ''))), WORDS.find(w => /[—–&]/.test(w)) ?? '');
ok('the heading counts estimate lines and approved change orders apart', SUGGEST_COPY.firstHeading(1, 0) === '1 Line from the Linked Estimate' && SUGGEST_COPY.firstHeading(10, 2) === '10 Lines from the Linked Estimate and 2 Approved Change Orders' && SUGGEST_COPY.firstHeading(3, 1) === '3 Lines from the Linked Estimate and 1 Approved Change Order');
ok('the change order lines are counted from the lines themselves', changeOrderLineCount(app.lines) === 1 && (first!.notes[0] as { changeOrderLines: number }).changeOrderLines === 1);
ok('the rate line is a sentence', SUGGEST_COPY.retainageFromRecord('10', 'from your contract') === 'Retainage opens at 10%, from your contract.');

// ═══ B. By reading the screens ══════════════════════════════════════════════
type Files = Map<string, string>;
const FIRST = 'utils/payApp/firstApplication.ts';
const BTM = 'components/payApp/BillThisMonth.tsx';
const SCREEN = 'app/aia-pay-app.tsx';
const REAL: Files = new Map([FIRST, BTM, SCREEN, 'utils/payApp/rollForward.ts'].map((f) => [f, read(f)] as const));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

interface Rule { name: string; run: (f: Files) => string[] }
const RULES: Rule[] = [
  { name: 'the first application is built by the screen\'s own first-period seed, from an invoice that bills nothing, and refuses anything else', run: (f) => {
    const src = strip(f.get(FIRST)!);
    const out: string[] = [];
    if (!/seedAIAPayApplicationFromInvoice\(nothingBilled, project, approvedThroughPeriod, input\.branding, \{/.test(src)) out.push('the lines are not built by the pay application\'s own seed');
    if (!/lineItems: \[\]/.test(src)) out.push('the invoice handed to the seed bills something');
    if (!/if \(firstApplicationState\(project, input\.saved\) !== 'can_start'\) return null;/.test(src)) out.push('a job that cannot start a first application gets one');
    if (!/if \(app\.sovBasis !== 'linked_estimate' \|\| app\.lines\.length === 0\) return null;/.test(src)) out.push('a schedule that is not the linked estimate\'s is opened');
    if (!/if \(app\.lines\.some\(l => l\.thisPeriod !== 0 \|\| l\.fromPreviousApp !== 0 \|\| l\.materialsPresentlyStored !== 0\)\) return null;/.test(src)) out.push('an application that already bills something is opened');
    if (!/const rate = resolveRetainagePercent\(/.test(src) || /retainagePercent: (5|10)\b|\?\? (5|10)\b/.test(src)) out.push('the retainage rate is not the one on record');
    if (!/rate\.needsAsk\s+\? \{ kind: 'retainage_not_on_record' \}/.test(src)) out.push('a job with no rate on record is not told so');
    if (/Date\.now|new Date\(\)|Math\.random|AsyncStorage|supabase|fetch\(/.test(src)) out.push('the file reads a clock, storage or the network');
    if (!/applicationNumber: 1,/.test(src) || !/lessPreviousCertificates: 0,/.test(src) || !/periodFrom: undefined,/.test(src)) out.push('a first application is not number 1 with nothing carried');
    return out;
  } },
  { name: 'Bill This Month rolls forward first and starts a first application only when there is nothing to roll forward', run: (f) => {
    const src = strip(f.get(BTM)!);
    const out: string[] = [];
    if (!/rollRef\.current = rollForwardNextApplication\(\{ project, saved, changeOrders, contract, today \}\)\s+\?\? \(settings\?\.branding \? startFirstApplication\(\{/.test(src)) out.push('the roll forward is not tried first');
    if (!/invoices: invoices\.filter\(i => i\.projectId === project\.id\),/.test(src)) out.push('the rate is read from another job\'s invoices');
    if (!/roll\.carriedFrom \? null : <Text style=\{styles\.lead\} testID="btm-first">\{SUGGEST_COPY\.firstLead\}/.test(src)) out.push('the screen does not say this is a first application');
    if (!/roll\.carriedFrom \? SUGGEST_COPY\.carriedHeading\(roll\.carriedFrom\.applicationNumber\) : SUGGEST_COPY\.firstHeading\(app\.lines\.length - changeOrderLineCount\(app\.lines\), changeOrderLineCount\(app\.lines\)\)/.test(src)) out.push('the heading says "carried forward" on a first application');
    if (!/n\.kind === 'retainage_not_on_record' \? \(\s+<Text key="rn" style=\{styles\.fieldError\}/.test(src) || !/n\.kind === 'retainage_from_record' \? \(/.test(src)) out.push('the screen does not say where the retainage rate came from');
    if ((src.match(/rollRef\.current = /g) ?? []).length !== 1) out.push('the lines are built more than once per opening');
    return out;
  } },
  { name: 'the entry is behind the owner-preview gate, off during a tutorial, and only where a first application can start', run: (f) => {
    const src = strip(f.get(SCREEN)!);
    const out: string[] = [];
    if (!/const firstState = project \? firstApplicationState\(project, savedForProject\) : 'no_estimate';/.test(src)) out.push('the screen does not ask whether a first application can start');
    if (!/const canStartFirst = easy && !practiceProjectId && firstState === 'can_start';/.test(src)) out.push('the entry is not behind the gate');
    if (!/\{canStartFirst \? \(\s+<View[^>]*testID="aia-first-application-entry">/.test(src)) out.push('the entry shows when a first application cannot start');
    if (!/easy && !practiceProjectId && firstState === 'no_estimate' \? \(\s+<Text[^>]*testID="aia-first-application-no-estimate">\{SUGGEST_COPY\.firstNoEstimateHint\}/.test(src)) out.push('a job with no linked estimate is not told why it cannot start here');
    if (!/if \(easy && billThisMonthOpen\) \{/.test(src)) out.push('Bill This Month opens for someone the gate does not allow');
    if ((src.match(/testID="aia-first-application"/g) ?? []).length !== 1) out.push('there is more than one first-application button');
    return out;
  } },
];
for (const r of RULES) { const bad = r.run(REAL); ok(r.name, bad.length === 0, bad.join(' | ')); }

// ═══ C. Planted mutations ═══════════════════════════════════════════════════
const PLANTS: [string, number, string, string, string][] = [
  ['a default retainage rate is made up', 0, FIRST, "const rate = resolveRetainagePercent({ priorInvoices: [...input.invoices], project, payApps: [] });", "const rate = { percent: 10, needsAsk: false, label: 'standard' };"],
  ['the made-up invoice bills a line', 0, FIRST, 'lineItems: [], notes:', "lineItems: [{ id: 'x', name: 'Mobilization', total: 500 }], notes:"],
  ['a job with an application gets a second first', 0, FIRST, "  if (firstApplicationState(project, input.saved) !== 'can_start') return null;\n", ''],
  ['a schedule rebuilt from nothing is opened', 0, FIRST, "  if (app.sovBasis !== 'linked_estimate' || app.lines.length === 0) return null;\n", ''],
  ['the check that starting bills nothing is dropped', 0, FIRST, "  if (app.lines.some(l => l.thisPeriod !== 0 || l.fromPreviousApp !== 0 || l.materialsPresentlyStored !== 0)) return null;\n", ''],
  ['a job with no rate on record is not told', 0, FIRST, "      rate.needsAsk\n        ? { kind: 'retainage_not_on_record' }\n        : ", '      '],
  ['the file reads the clock', 0, FIRST, '  const to = endOfMonth(today);', '  const to = endOfMonth(new Date().toISOString().slice(0, 10));'],
  ['the first application is tried before the roll forward', 1, BTM, "rollRef.current = rollForwardNextApplication({ project, saved, changeOrders, contract, today })\n      ?? (settings?.branding ? startFirstApplication({", "rollRef.current = (settings?.branding ? startFirstApplication({"],
  ['the heading says carried forward on a first application', 1, BTM, 'roll.carriedFrom ? SUGGEST_COPY.carriedHeading(roll.carriedFrom.applicationNumber) : SUGGEST_COPY.firstHeading(app.lines.length - changeOrderLineCount(app.lines), changeOrderLineCount(app.lines))', 'SUGGEST_COPY.carriedHeading(roll.carriedFrom?.applicationNumber ?? 0)'],
  ['the screen stops saying no rate is on record', 1, BTM, "n.kind === 'retainage_not_on_record' ? (", "n.kind === 'retainage_not_on_record' && false ? ("],
  ['the rate is read from every job\'s invoices', 1, BTM, 'invoices: invoices.filter(i => i.projectId === project.id),', 'invoices,'],
  ['the entry is opened to everyone', 2, SCREEN, "const canStartFirst = easy && !practiceProjectId && firstState === 'can_start';", "const canStartFirst = firstState === 'can_start';"],
  ['the entry shows on a job that cannot start one', 2, SCREEN, '{canStartFirst ? (', '{easy ? ('],
  ['Bill This Month opens without the gate', 2, SCREEN, 'if (easy && billThisMonthOpen) {', 'if (billThisMonthOpen) {'],
];
let caught = 0;
for (const [what, ruleIndex, file, from, to] of PLANTS) {
  const src = REAL.get(file)!;
  if (!src.includes(from)) { ok(`plant "${what}": its anchor is in ${file}`, false, from.slice(0, 80)); continue; }
  const mutated: Files = new Map(REAL);
  mutated.set(file, src.replace(from, to));
  const bad = RULES[ruleIndex].run(mutated);
  if (bad.length > 0) caught++;
  ok(`plant "${what}" turns its rule red`, bad.length > 0);
}

console.log(`\n${failed === 0 ? '✓' : '✗'} validate-pay-app-first: ${passed} passed, ${failed} failed (${caught} of ${PLANTS.length} planted mutations caught)`);
process.exit(failed === 0 ? 0 : 1);
