// validate-postchain-wave3.ts — the wave-3 post-chain handoffs, applied after
// the lanes joined. Each check runs the real code where it is pure, and pins
// the call site where the fix is wiring. Run: bun run scripts/validate-postchain-wave3.ts
//
//  #51  portal + .ics date tasks where the ENGINE puts them, not the stored pin
//  #65  WIP prices overtime by the GC's rule (parity with Job Costing)
//  #41  a T&M ticket becomes a CO only for the project owner; no voice CO on a
//       job he was invited to
//  #37  an approved CO whose days were deferred can be placed from the CO screen
//  #61  an unpriced-labor alert routes to where rates are set
//  #60  an unsent submittal is "not sent yet", never "0d in review"
//  #3c  bill-from-estimate shares the session invoice-number max
//  #49  the invoice send awaits its own INSERT before minting a pay link
//  #131 the in-app CO signature record carries the frozen tax like the portal's
//  #124 a blocked print window says so on every PDF screen
//  #133 a backdated payment still pairs with QuickBooks; payments feed prints his day
//  #50  the demo's actuals are calendar indices; the AI preview names the scale
//  #74  the plan screens re-read the server on focus
//  #147 the submittal cycle form closes an open cycle in place
//  weather a photo-drafted DFR never invents the day's weather

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScheduleTask, Project, ClientPortalSettings } from '../types';
import { portalPlacedTasks, buildPortalSnapshot } from '../utils/portalSnapshot';
import { suggestCostToDateWithSource } from '../utils/wip';
import { fieldTicketConvertBlockReason, FIELD_TICKET_GC_CREATES_COS } from '../utils/fieldTicketCore';
import { nextInvoiceNumberFrom, noteIssuedInvoiceNumber, sessionIssuedInvoiceMax } from '../utils/billingFlowCore';
import { buildCOConsentRecord, coCarriesTax } from '../utils/portalOwnerCore';
import { seedDemoSchedule } from '../utils/demoSchedule';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

let pass = 0; let fail = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// ── #51 portal dates from the engine ─────────────────────────────────────────
console.log('\n#51 the portal dates tasks where the engine puts them');
{
  const T = (id: string, startDay: number, durationDays: number, dependencies: string[] = [], extra: Partial<ScheduleTask> = {}) =>
    ({ id, title: id, phase: 'P', startDay, durationDays, dependencies, progress: 0, status: 'not_started', crew: '', notes: '', ...extra }) as unknown as ScheduleTask;
  // B's stored pin (day 1) predates A: the engine starts it after A finishes.
  const tasks = [T('A', 1, 5), T('B', 1, 3, ['A'])];
  const undated = portalPlacedTasks({ tasks });
  ok('undated: the dependent task starts on working day 6, not its stale pin', undated.find(t => t.id === 'B')?.startDay === 6, JSON.stringify(undated));
  const dated = portalPlacedTasks({ tasks, startDate: '2026-09-07', workingDaysPerWeek: 5 });
  const b = dated.find(t => t.id === 'B');
  ok('dated Mon 7 Sep, 5-day weeks: B is working day 6 (Mon 14), 3 days long', b?.startDay === 6 && b.durationDays === 3, JSON.stringify(b));
  const cyc = portalPlacedTasks({ tasks: [T('X', 2, 2, ['Y']), T('Y', 4, 2, ['X'])] });
  ok('a cycle never throws, and every task is still on the page', cyc.length === 2);

  const project = {
    id: 'p1', name: 'Job', createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', status: 'active',
    schedule: { id: 's', name: 'S', projectId: 'p1', startDate: '2026-09-07', workingDaysPerWeek: 5, tasks, totalDurationDays: 5, criticalPathDays: 5, laborAlignmentScore: 0, createdAt: '', updatedAt: '' },
  } as unknown as Project;
  const snap = buildPortalSnapshot({ project, portal: { enabled: true, showSchedule: true } as unknown as ClientPortalSettings });
  const pb = snap.sections.schedule?.tasks.find(t => t.id === 'B');
  ok('the snapshot ships the engine placement', pb?.startDay === 6, JSON.stringify(pb));
  ok('…and the hero finish is the engine finish (working day 8 = Wed 16 Sep), not the pins\' Fri 11', snap.project.targetDate === '2026-09-16', String(snap.project.targetDate));
  const src = read('utils/portalSnapshot.ts');
  ok('the milestones read the placed tasks too', /return placedTasks\s*\n\s*\.filter\(t => t\.isMilestone\)/.test(src));
  const ics = read('utils/icsGenerator.ts');
  ok('the .ics export places each task through the engine (scheduledTaskRange)',
    /scheduleTaskToEvent\(project, anchor\.date, schedule, t, placements\.get\(t\.id\)\)/.test(ics) && /scheduledPlacements\(runCpm\(/.test(ics));
}

// ── #65 WIP overtime by the rule ────────────────────────────────────────────
console.log('\n#65 WIP prices overtime by the GC\'s rule, never the stored per-shift figure');
{
  const timeEntries = [
    { id: 't2', projectId: 'p1', trade: 'laborer', status: 'clocked_out', totalHours: 300, overtimeHours: 40 },
  ] as never;
  const none = suggestCostToDateWithSource([], [], {
    projectId: 'p1', timeEntries, laborRates: { laborer: 42 }, overtimeMultiplier: 1.5,
    overtimeRule: { weeklyThreshold: null, dailyThreshold: null, weekStartsOn: 1 },
  });
  ok('a stored 40 h of "overtime" is not priced when the rule allocates none', Math.abs(none.labor - 300 * 42) < 0.005, String(none.labor));
  const src = read('utils/wip.ts');
  ok('the labour leg prices overtimeFor(ot, e.id), allocated once over every entry',
    /const ot = computeOvertime\(timeEntries, overtimeRule\);/.test(src)
    && /priceLaborEntry\(\{ totalHours: e\.totalHours, overtimeHours: overtimeFor\(ot, e\.id\) \}, rate, overtimeMultiplier\)/.test(src)
    && !/priceLaborEntry\(e, rate, overtimeMultiplier\)/.test(src));
  for (const f of ['app/ask.tsx', 'app/reports.tsx', 'app/margin-alerts.tsx', 'app/judges.tsx', 'app/wip-report.tsx', 'app/portfolio-margin.tsx', 'app/budget-dashboard.tsx', 'app/client-portal-setup.tsx', 'app/margin-risk.tsx', 'components/ProjectHero.tsx']) {
    const s = read(f);
    ok(`${f} hands the GC's rule to its cost sources`, /overtimeMultiplier, overtimeRule(, isLoading: ratesLoading)? \} = useLaborRates\(\)/.test(s) && (s.match(/overtimeMultiplier, overtimeRule, equipment/g) ?? []).length >= 2);
  }
}

// ── #41 owner-only change orders ────────────────────────────────────────────
console.log('\n#41 only the project owner turns work into a change order');
{
  ok('the owner (cached row) converts, even offline with no role read', fieldTicketConvertBlockReason(null, 'u1', 'u1') === null);
  ok('a live owner role converts', fieldTicketConvertBlockReason('owner', undefined, 'u1') === null);
  for (const r of ['editor', 'field', 'viewer'] as const) {
    ok(`a ${r} seat is refused with the reason`, fieldTicketConvertBlockReason(r, 'gc', 'u2') === FIELD_TICKET_GC_CREATES_COS);
  }
  ok('an unresolved role waits, a failed read says so', /Checking/.test(fieldTicketConvertBlockReason(null, 'gc', 'u2') ?? '') && /Couldn’t confirm/.test(fieldTicketConvertBlockReason(null, 'gc', 'u2', true) ?? ''));
  const ft = read('app/field-ticket.tsx');
  const conv = ft.slice(ft.indexOf('const handleConvert = useCallback('), ft.indexOf('// ── Price a signed ticket'));
  ok('handleConvert refuses before addChangeOrder / ticketConversionPatch',
    conv.indexOf('if (convertBlockReason) {') >= 0 && conv.indexOf('if (convertBlockReason) {') < conv.indexOf('addChangeOrder(co)'));
  ok('the Bill it button is off with the reason shown', /disabled=\{!gate\.canConvert \|\| !!convertBlockReason\}/.test(ft) && /testID="ticket-convert-owner-only">\{convertBlockReason\}/.test(ft));
  const mic = read('components/UniversalMicButton.tsx');
  const coBranch = mic.slice(mic.indexOf("} else if (parsed.kind === 'co') {"), mic.indexOf('ctx.addChangeOrder({'));
  ok('a voice CO on a job he was invited to is refused before ctx.addChangeOrder', /if \(proj\.myRole\) \{[\s\S]*Your GC creates change orders on this job[\s\S]*return;/.test(coBranch));
}

// ── #37 place deferred CO days from the CO screen ───────────────────────────
console.log('\n#37 a portal-approved CO\'s days can be placed where the push lands');
{
  const co = read('app/change-order.tsx');
  ok('an approved, unplaced CO with a schedule shows "Place +Nd on the schedule"',
    /existingCO\?\.status === 'approved'\s*\n\s*&& \(existingCO\.scheduleImpactDays \?\? 0\) > 0\s*\n\s*&& !existingCO\.scheduleImpactApplied/.test(co) && /testID="co-place-days"/.test(co));
  ok('…through the preview in its place intent, with an explicit anchor and no status change',
    /intent="place"/.test(co) && /updateChangeOrder\(co\.id, \{\}, \{ anchorTaskId \}\);/.test(co));
}

// ── #61 unpriced labor routes to the rates ──────────────────────────────────
console.log('\n#61 an unpriced-labor alert opens Time Tracking, where rates are set');
ok('margin-alerts routes unpriced_labor to /time-tracking for its project',
  // (wave 4 #104 adds openRates + rateTrade after projectId — the sheet opens on the trade.)
  /a\.kind === 'unpriced_labor'\s*\n?\s*\? \{ pathname: '\/time-tracking', params: \{ projectId: a\.projectId[,\s}]/.test(read('app/margin-alerts.tsx')));

// ── #60 unsent submittals ───────────────────────────────────────────────────
console.log('\n#60 an unsent submittal is not "0d in review"');
{
  const oac = read('utils/oacEngine.ts');
  ok('the OAC agenda ages a submittal from its last cycle, says "not sent yet", and never warns on it',
    /export function submittalReviewAgeDays\(/.test(oac) && /age == null \? 'not sent yet'/.test(oac) && /\(submittalReviewAgeDays\(s\) \?\? 0\) > 14/.test(oac)
    && !/daysBetween\(s\.submittedDate\)/.test(oac));
  ok('report-inbox and documents read an empty submittedDate with ||',
    /dayOrInstantDate\(s\.submittedDate \|\| s\.createdAt\)/.test(read('app/report-inbox.tsx')) && /s\.submittedDate \|\| s\.createdAt \|\|/.test(read('app/documents.tsx')));
}

// ── #3c shared invoice-number session max ───────────────────────────────────
console.log('\n#3c bill-from-estimate never re-issues a number invoice.tsx just used');
{
  sessionIssuedInvoiceMax.clear();
  noteIssuedInvoiceNumber('pX', 7);
  ok('a number issued this session is skipped even when the list has not caught up', nextInvoiceNumberFrom([{ number: 3 }], sessionIssuedInvoiceMax.get('pX') ?? 0) === 8);
  sessionIssuedInvoiceMax.clear();
  const bfe = read('app/bill-from-estimate.tsx');
  ok('bill-from-estimate reads the shared max and records what it issues',
    /nextInvoiceNumberFrom\(existingInvoices, sessionIssuedInvoiceMax\.get\(projectId\) \?\? 0\)/.test(bfe) && /noteIssuedInvoiceNumber\(inv\.projectId, inv\.number\);/.test(bfe));
  ok('invoice.tsx uses the SAME map (no module-local copy left)', !/const sessionIssuedInvoiceMax = new Map/.test(read('app/invoice.tsx')));
}

// ── #49 await the invoice INSERT ────────────────────────────────────────────
console.log('\n#49 the send awaits its own INSERT before minting');
{
  const inv = read('app/invoice.tsx');
  ok('a refused insert is told apart from a queued one',
    /const outcome = await awaitInvoiceInsert\(workingInvoice\.id\)/.test(inv) && /if \(outcome === 'failed'\) insertState = 'failed';/.test(inv)
    // Wave 4 #39 (invoice-send): a refused insert no longer emails a
    // Pay-button-less invoice — it stops before the mint and the email and
    // says to Retry it from the sync badge.
    && /if \(insertState === 'failed'\) \{\s*showAlert\('Invoice not sent', invoiceInsertRefusedMessage\(workingInvoice\.number\)\);\s*return;/.test(inv));
}

// ── #131 in-app CO record carries the frozen tax ────────────────────────────
console.log('\n#131 the in-app signed CO record names the tax the same way the portal does');
{
  ok('coCarriesTax: only a non-zero frozen tax with a total', coCarriesTax({ taxAmount: 36, totalWithTax: 486 }) && !coCarriesTax({ taxAmount: 0, totalWithTax: 450 }) && !coCarriesTax({ taxAmount: 36 }));
  const html = read('marketing/portal/index.html');
  const lift = (name: string): string => {
    const i = html.indexOf(`function ${name}(`);
    let depth = 0; let j = html.indexOf('{', i);
    for (; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}') { depth--; if (depth === 0) break; } }
    return html.slice(i, j + 1);
  };
  const vars = html.slice(html.indexOf('var ESIGN_DISCLOSURE_VERSION'), html.indexOf('function sha256Hex('));
  const portalRecord = new Function(`${lift('esignTidy')}\n${vars}\n${lift('buildCOConsentRecord')}\nreturn buildCOConsentRecord;`)() as (f: Record<string, unknown>) => string;
  const args = {
    decision: 'approved' as const, portalId: 'portal-1', changeOrderId: 'co1', changeOrderNumber: 3, description: 'Add outlet',
    changeAmount: 450, newContractTotal: 10_450, signerName: 'Jane Doe', signedAt: '2026-09-18T12:00:00.000Z',
    timezoneOffsetMinutes: -300, signatureHash: 'abc', signatureStrokeCount: 4, userAgent: 'UA', taxAmount: 36, totalWithTax: 486,
  };
  ok('a TAXED record is byte-identical in the app and on the portal page', portalRecord(args) === buildCOConsentRecord(args));
  ok('client-view signs with the frozen tax exactly when the portal would',
    /taxAmount: coCarriesTax\(approvalCO\) \? approvalCO\.taxAmount : undefined,\s*\n\s*totalWithTax: coCarriesTax\(approvalCO\) \? approvalCO\.totalWithTax : undefined,/.test(read('app/client-view.tsx')));
}

// ── #124 blocked print window ───────────────────────────────────────────────
console.log('\n#124 a blocked PDF window says so');
{
  // utils/platformFile imports react-native, so the two pure pieces are lifted
  // out of the file and run (the same bytes the screens import).
  const pf = read('utils/platformFile.ts');
  const constLine = pf.slice(pf.indexOf('export const PRINT_WINDOW_BLOCKED_MESSAGE'), pf.indexOf(';', pf.indexOf('export const PRINT_WINDOW_BLOCKED_MESSAGE')) + 1);
  const fnStart = pf.indexOf('export function pdfFailureMessage(');
  const fnSrc = pf.slice(fnStart, pf.indexOf('\n}\n', fnStart) + 3);
  const BunRt = (globalThis as unknown as { Bun: { Transpiler: new (o: { loader: string }) => { transformSync(src: string): string } } }).Bun;
  const js = new BunRt.Transpiler({ loader: 'ts' }).transformSync(`${constLine}\n${fnSrc}`).replace(/export /g, '');
  const lifted = new Function(`${js}\nreturn { PRINT_WINDOW_BLOCKED_MESSAGE, pdfFailureMessage };`)() as { PRINT_WINDOW_BLOCKED_MESSAGE: string; pdfFailureMessage: (e: unknown, f: string) => string };
  const { PRINT_WINDOW_BLOCKED_MESSAGE, pdfFailureMessage } = lifted;
  ok('both blocked-window throws use the shared sentence family', /throw new Error\(PRINT_WINDOW_BLOCKED_MESSAGE\)/.test(pf));
  ok('the blocked-window sentence reaches the user', pdfFailureMessage(new Error(PRINT_WINDOW_BLOCKED_MESSAGE), 'x') === PRINT_WINDOW_BLOCKED_MESSAGE);
  ok('…the Print variant too', /Allow pop-ups/.test(pdfFailureMessage(new Error('Your browser blocked the PDF window. Allow pop-ups for app.mageid.app and tap Print again.'), 'x')));
  ok('…while any other failure keeps the screen\'s own words', pdfFailureMessage(new Error('boom'), 'Failed to generate PDF.') === 'Failed to generate PDF.');
  for (const f of ['app/submittal.tsx', 'app/field-ticket.tsx', 'app/invoice.tsx', 'app/project-detail.tsx', 'app/(tabs)/estimate/full.tsx']) {
    ok(`${f} passes its PDF failure through pdfFailureMessage`, /pdfFailureMessage\((err|e), /.test(read(f)));
  }
}

// ── #133 received day ───────────────────────────────────────────────────────
console.log('\n#133 the day he says the money arrived');
{
  const LEDGER = '../supabase/functions/_shared/paymentLedger.ts';
  const L = await import(LEDGER) as { pairDistanceMs: (e: Record<string, unknown>, p: Record<string, unknown>) => number | null };
  const keyedToday = { id: 'e1', amount: 500, method: 'check', date: '2026-09-18T15:00:00.000Z' };
  const bookkeeper = { id: 'Q1', applied: 500, txnDate: '2026-09-05', createdAt: '2026-09-18T16:00:00.000Z' };
  ok('a cheque backdated past the window pairs with the bookkeeper\'s copy dated that day',
    L.pairDistanceMs({ ...keyedToday, receivedDate: '2026-09-05' }, bookkeeper) !== null);
  ok('…and without his received day it would not', L.pairDistanceMs(keyedToday, bookkeeper) === null);
  const pay = read('app/payments.tsx');
  ok('the payments feed dates an entry by paymentReceivedAt and prints it through dayOrInstantDate',
    /paymentReceivedAt\(\{ date: entry\.date \?\? entry\.receivedAt, receivedDate: entry\.receivedDate \}\)/.test(pay)
    && /dayOrInstantDate\(payment\.createdAt\)\.toLocaleDateString/.test(pay) && !/new Date\(payment\.createdAt\)/.test(pay));
}

// ── #50 scale honesty ───────────────────────────────────────────────────────
console.log('\n#50 actuals are calendar indices everywhere they are written or shown');
{
  const find = (ts: ScheduleTask[]) => ts.find(t => t.title.startsWith('Clear & grub'));
  const undated = find(seedDemoSchedule());
  const dated = find(seedDemoSchedule({ scheduleStartDate: '2026-09-07', workingDaysPerWeek: 5 }));
  ok('undated demo: calendar = working, nothing moves', undated?.actualEndDay === 6, String(undated?.actualEndDay));
  ok('dated demo (Mon start, 5-day weeks): working day 6 is calendar day 8', dated?.actualEndDay === 8, String(dated?.actualEndDay));
  ok('Schedule Pro seeds the demo on its own calendar', /commit\(\(\) => seedDemoSchedule\(summaryScale\)\);/.test(read('app/schedule-pro.tsx')));
  const ai = read('components/schedule/AIAssistantPanel.tsx');
  ok('the AI preview says "calendar day", never a bare "start day"', /started calendar day \$\{patch\.actualStartDay\}/.test(ai) && !/`start day \$\{patch\.actualStartDay\}`/.test(ai));
  const sheet = read('components/schedule/mobile/TaskDetailSheet.tsx');
  ok('the task sheet follows a peer\'s progress while the slider is idle',
    /if \(!task \|\| sliderActiveRef\.current\) return;\s*\n\s*setPctDraft\(task\.progress \?\? 0\);\s*\n\s*\}, \[task\?\.progress\]\);/.test(sheet) && /onChange=\{onSliderChange\}/.test(sheet));
}

// ── #74 plans re-read on focus ──────────────────────────────────────────────
console.log('\n#74 the plan screens re-read the server');
{
  const plans = read('app/plans.tsx');
  ok('Plans re-reads on focus and on pull-to-refresh',
    /useFocusEffect\(useCallback\(\(\) => \{ void refetchPlansFromServer\(\); \}, \[refetchPlansFromServer\]\)\);/.test(plans)
    && /refreshControl=\{<RefreshControl refreshing=\{plansRefreshing\}/.test(plans));
  ok('the viewer re-reads on focus', /useFocusEffect\(useCallback\(\(\) => \{ void refetchPlansFromServer\(\); \}, \[refetchPlansFromServer\]\)\);/.test(read('app/plan-viewer.tsx')));
}

// ── collaborator gates the post-chain closed ────────────────────────────────
console.log('\ncollaborator gates: DFR incident chip, RFI log');
{
  const dfr = read('app/daily-report.tsx');
  ok('the DFR "Case filed" chip links only the OWNER, through the project-aware gate',
    /linkedIncident && isProjectOwner && canAccessOnProject\('safety_management'\) \?/.test(dfr)
    && /const \{ canAccess: canAccessOnProject \} = useProjectAccess\(projectId \|\| undefined\);/.test(dfr)
    && !/canAccess\('safety_management'\)/.test(dfr));
  const pd = read('app/project-detail.tsx');
  const log = pd.slice(pd.indexOf('const handleExportRFILog = useCallback('), pd.indexOf('const handleGenerateCloseoutPacket'));
  ok('the RFI log refuses while any of the job\'s RFIs still wait for their server number (#148)',
    // Wave 4 #29 (team-hub): only a queued INSERT means "no number yet".
    /const queue = await getOfflineQueue\(\);\s*const waiting = projectRFIs\.filter\(r => insertStillQueued\(queue, 'rfis', r\.id\)\)\.length;/.test(log)
    && log.indexOf('if (waiting > 0) {') >= 0 && log.indexOf('if (waiting > 0) {') < log.indexOf('await generateRFILogPDF('));
}

// ── weather ─────────────────────────────────────────────────────────────────
console.log('\nweather: a photo draft never invents the day\'s weather');
ok('generateDFRFromPhotos drops a model weather reading when none was logged',
  /const weatherKnown = !!weatherStr && !\/\^\\s\*not \(recorded\|specified\)\\s\*\$\/i\.test\(weatherStr\);/.test(read('utils/voiceDFRParser.ts'))
  && /if \(result\.weather && weatherKnown\) \{/.test(read('utils/voiceDFRParser.ts')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
