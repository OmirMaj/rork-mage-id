// scripts/validate-demo-job.ts — the owner's Demo Job (utils/demoJob, app/demo-job.tsx).
//
// Run: bun run scripts/validate-demo-job.ts   (package.json test:demo-job, in the ship-check chain)
//
// The builder writes a made-up $23M job into the founder's REAL account, so the
// rules below are the liability rules, not style:
//   A  the numbers agree everywhere (one source, checked from the outside)
//   B  the schedule is real logic and matches the app's own engine
//   C  every reference resolves, every id is unique
//   D  everything is plainly fiction (example.com, 555-01xx, "Demo" in the name)
//   E  no fabricated evidence (no signature, seal, verification, live weather, AI)
//   F  nothing leaves the account (data and source, and the server fences it leans on)
//   G  the demo teaches and reports nothing (cost book, benchmark, brain, tax, payroll, analytics)
//   H  creation is resumable and idempotent, removal is complete
//   I  owner only, one kill switch
//   J  the screen says what it does, in English and Spanish
//   K  the calendar is local-day, repeatable, the same on a weekend
//   L  the Living Model is sound and its floor follows the schedule
//   M  the app's own job cost, critical path and replay engines read the job the same way
// Review round (independent review of the builder): D3 a dropped rename is said;
// E3 every review cycle is disclaimed; F4 the morning brief and the assistant
// connector leave sample jobs out; G4 One Mind and the bid advisor never see the
// demo; H5 only the job with the builder's stamp is found or deleted, and the
// confirmation names it; H6 removal asks the server and sweeps nothing unless
// the job is gone; H7 presence is by id, so an edited record is not written
// twice; H8 nothing is offered before the project list is read, and a second
// tap is stopped by a ref.
// Every rule has at least one planted mutation that must turn it red.
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { makeFakeApp as makeFakeAppRaw, fakeRecordCount, type FakeApp } from '../__tests__/fixtures/demoJobFakeApp';
import { EN as EN_SHARD } from '../i18n/catalog/en/office.demo-job.generated';
import { ES_OFFICE_DEMO_JOB } from '../i18n/catalog/es/office/demoJob';
import { sourceHash } from '../i18n/hash';
import type { Project } from '../types';
import { computeAIATotals } from '../utils/aiaBilling';
import { buildCostDatabase } from '../utils/costDatabase';
import { demoJobAllowedWith } from '../utils/demoJob/allowed';
import { buildDemoJob, type DemoJob } from '../utils/demoJob/build';
import { DATA_DAY, demoSeedDayFromStart, makeDemoClock } from '../utils/demoJob/clock';
import { REVIEW_TYPED_NOTE } from '../utils/demoJob/fieldRecords';
import { DEMO_LEAD_SOURCE, DEMO_PROJECT_NAME, DEMO_RENAME_KEPT_REASON, DEMO_RENAME_KEPT_TITLE, demoRenameDropped, demoSafeUpdates, isDemoProject, isDemoProjectName, isKnownDemoProjectId, isStampedDemoProject, noteDemoScope } from '../utils/demoJob/marker';
import { BASE_COST, BUDGET_COST, CONTRACT_SUM_TO_DATE, ORIGINAL_CONTRACT_SUM, PAID_PAY_APPS, PAY_APP_PERIOD_END, projectedFinalCost, projectedMarginPercent } from '../utils/demoJob/money';
import { demoSubcontractorIds, withoutDemoPayees } from '../utils/demoJob/payees';
import { schedulePercentOn } from '../utils/demoJob/schedule';
import { EMAIL_RULE, PHONE_RULE } from '../utils/demoJob/world';
import { DEMO_DELETE_TABLES, NOT_THE_BUILDERS_REASON, QUEUE_CAP, QUEUE_ROOM_NEEDED, STILL_THERE_REASON, createDemoJob, demoAccountIds, demoStatus, existingDemoProjects, removeDemoJob } from '../utils/demoJob/writer';
import { computeCalibration } from '../utils/estimateCalibration';
import { netBalanceDue } from '../utils/invoiceBilling';
import { computeJobCost } from '../utils/jobCostEngine';
import { runCpm } from '../utils/cpm';
import { buildReplayInput } from '../utils/livingModel/replayInput';
import { roomMoment } from '../utils/livingModel/replayCore';
import { isSampleTimeEntry } from '../utils/laborSamples';
import { MAX_ROOMS, validateModel } from '../utils/livingModel/modelCore';
import { resolveStage, stageForTask } from '../utils/livingModel/stageCore';
import { MAX_MODEL_CHARS } from '../utils/livingModel/storeCore';
import { countsTowardFreeCap } from '../utils/projectCap';
import { isSampleProject, sampleSendPlan } from '../utils/sampleGuard';
import { recalculateStartDays } from '../utils/scheduleEngine';
import { isDemoJobEvent } from '../utils/analytics';
import { aggregateTypeMargin, realizedMarginPct } from '../utils/judges/typeMargin';
import { withoutDemoFacts } from '../utils/oneMind/demoFence';
import type { OneMindBundle } from '../utils/oneMind/factBlocks';
import { buildTypeProfitability } from '../utils/portfolio/typeProfitability';
import { isSampleProjectName as serverIsSampleProjectName } from '../supabase/functions/_shared/sampleFence';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const ls = (dir: string): string[] => readdirSync(join(ROOT, dir)).filter((f) => statSync(join(ROOT, dir, f)).isFile()).map((f) => `${dir}/${f}`);

const USER = 'user-0001';
const PID = '3b1f6c0e-2a4d-4e8f-9a11-5c7d9e0f1a2b';
const SEED = '2026-10-09';
const mkJob = (today = SEED, projectId = PID): DemoJob => buildDemoJob({ userId: USER, projectId, today, contractorName: 'Example Builder' });

/** The builder's own source: everything that decides what is written and how. */
const BUILDER_FILES = [...ls('utils/demoJob'), 'hooks/useDemoJobPorts.ts', 'components/demoJob/DemoJobScreen.tsx', 'app/demo-job.tsx'];
/** Files that keep the demo out of a learning or reporting path, and the call that does it. */
const EXCLUSIONS: readonly [string, string, string][] = [
  ['utils/costDatabase.ts', 'withoutDemoProjects(projectsIn)', 'the cost book and the shared benchmark'],
  ['utils/costDatabase.ts', 'withoutDemoRows(receiptsIn, demoIds)', 'receipts into the cost book'],
  ['utils/estimateCalibration.ts', 'if (isDemoProject(project)) continue;', 'bid calibration'],
  ['utils/analytics.ts', 'if (isDemoJobEvent(properties)) return;', 'analytics events'],
  ['contexts/ProjectContext.tsx', 'noteDemoScope(projects)', 'the demo id registry'],
  ['contexts/ProjectContext.tsx', 'if (isDemoProject(project)) noteDemoProjectId(project.id);', 'the registry at create'],
  ['contexts/ProjectContext.tsx', 'if (isDemoProject(project)) return;', 'the geocoder'],
  ['contexts/ProjectContext.tsx', 'const rawUpdates = demoSafeUpdates(prior, updatesIn);', 'the rename guard'],
  ['utils/brain/predictionLedger.ts', 'if (isKnownDemoProjectId(projectId)) return;', 'brain predictions'],
  ['hooks/useBrainGrading.ts', '.filter((r) => !isKnownDemoProjectId(r.project_id))', 'brain grading and accuracy reports'],
  ['components/MarginAlertManager.tsx', 'projects: withoutDemoProjects(projects)', 'margin alert notifications'],
  ['hooks/useWeekClose.ts', 'withoutDemoRows(invoices, demoProjectIdSet(projects))', 'the background payment forecast'],
  ['app/payment-predictions.tsx', 'return withoutDemoRows(invoices, demoIds);', 'payment predictions'],
  ['hooks/useLeakCoDrafts.ts', 'projects: withoutDemoProjects(projects)', 'self-drafted change orders'],
  ['app/tax-1099-export.tsx', 'withoutDemoPayees(projects, allSubcontractors, allCommitments)', 'the 1099 export'],
  ['app/insurance-audit.tsx', 'withoutDemoPayees(projects, allSubcontractors, allCommitments)', 'the insurance audit pack'],
  ['utils/oneMind/answer.ts', 'const bundle = withoutDemoFacts(bundleIn);', 'One Mind, where the bundle is read (every prompt and fallback answer)'],
  ['components/brain/AskConversation.tsx', 'return withoutDemoFacts({', 'One Mind, where the bundle is built'],
  ['utils/judges/typeMargin.ts', 'if (isDemoProject(project)) return null;', 'realized margin (the bid advisor, type profitability, prediction grading)'],
  ['utils/judges/typeMargin.ts', '|| isDemoProject(p)) continue;', 'the bid advisor\'s margin by job type'],
  ['utils/portfolio/typeProfitability.ts', 'if (!isClosed(p) || isDemoProject(p)) continue;', 'the count of closed jobs behind type profitability'],
];
/** Server reads that leave sample jobs out: [file, the code that does it, how many times it must appear, what]. */
const SERVER_FENCES: readonly [string, string, number, string][] = [
  ['supabase/functions/morning-digest/index.ts', '.filter((p) => !isSampleProjectName(p.name))', 2, 'the morning brief (the jobs it briefs, and the jobs whose open RFIs it counts)'],
  ['supabase/functions/morning-digest/index.ts', "import { isSampleProjectName } from '../_shared/sampleFence.ts';", 1, 'the morning brief uses the shared sample rule'],
  ['supabase/functions/mcp/index.ts', 'if (!isSampleProjectName(r.name)) m[r.id] = r.name;', 2, 'the assistant connector\'s project names (and so its RFIs)'],
  ['supabase/functions/mcp/index.ts', '.filter(offSample(owned.sampleIds))', 3, 'the assistant connector\'s invoices and change orders'],
  ['supabase/functions/mcp/index.ts', '.filter((p) => !isSampleProjectName(p.name as string | null))', 1, 'the assistant connector\'s project list'],
  ['supabase/functions/mcp/index.ts', '!isSampleCompany(s.company_name)', 1, 'the assistant connector\'s subcontractor list'],
  ['supabase/functions/mcp/index.ts', 'Across ${owned.real} project(s)', 1, 'the assistant connector\'s project count'],
  ['supabase/functions/mcp/index.ts', 'import { isSampleProjectName } from "../_shared/sampleFence.ts";', 1, 'the assistant connector uses the shared sample rule'],
];
/** Server and app fences the demo leans on by being a sample-named job. Read only: this lane changes none of them. */
const FENCES: readonly [string, string, string][] = [
  ['supabase/functions/invoice-dunning/index.ts', "skip('sample_project')", 'payment reminders skip a sample job'],
  ['supabase/functions/create-payment-link/index.ts', 'sample_project', 'no pay link on a sample job'],
  ['supabase/functions/qbo-sync/index.ts', "skipped: 'sample_project'", 'no QuickBooks push of a sample job'],
  ['supabase/functions/coi-expiry-watch/index.ts', ".not('coi_expiry', 'is', null)", 'insurance reminders only read subs that have an expiry date'],
  ['supabase/functions/homeowner-weekly-digest/index.ts', 'weeklyDigest', 'the client digest only reads projects that turned it on'],
  ['utils/projectCap.ts', "export const SAMPLE_PROJECT_PREFIX = 'Sample — ';", 'the sample prefix itself'],
  ['utils/laborSamples.ts', 'isSampleTimeEntry', 'shifts on a sample job are not learned from'],
  ['utils/timeClockPayroll.ts', 'if (isSampleTimeEntry(e)) continue;', 'shifts on a sample job are not in payroll'],
];
/** Words that may not appear in the builder's source: each is a way to reach someone, sign something, or call a model. */
const FORBIDDEN_CALLS = [
  'functions.invoke', '/functions/v1', 'sendEmail', 'emailService', 'requestLienWaiverSignature', 'recordPaperLienWaiver', 'recordHomeownerSignature',
  'addCollaborator', 'sendToClientPortal', 'batchSendToClientPortal', 'writePortalMessage', 'addPortalMessage', 'addBidPackage', 'addLead', 'awardBidPackage',
  'create-payment-link', 'mintPayLink', 'clockIn', 'scheduleNotification', 'sendLocalNotification', 'aiService', 'mageAI', 'curateSelectionsAI',
  'approveChangeOrder', 'updateChangeOrder', 'recordInvoicePayment', 'signFieldTicket', 'closeProject', 'addIncident', 'setContractStatus',
  'saveAIAPayAppOnline', 'triggerQboSync', 'upsertSubPortalLink', 'upsertPrequalPacket', 'weatherDelayLog', 'startClaimInvite', 'surfaceToMarketplace',
];
/** The only modules hooks/useDemoJobPorts.ts may import: the builder's whole reach. */
const PORT_IMPORTS = [
  'react', '@react-native-async-storage/async-storage', '@/contexts/AuthContext', '@/contexts/CrewContext', '@/contexts/ProjectContext',
  '@/contexts/SafetyContext', '@/hooks/useTimeEntries', '@/hooks/useOnline', '@/utils/contractEngine', '@/utils/lienWaiverEngine',
  '@/utils/livingModel/store', '@/utils/livingModel/storeCore', '@/utils/offlineQueue', '@/utils/selectionsEngine', '@/utils/tutorial/sandbox',
  '@/utils/demoJob/writer',
];

interface Ctx {
  job: DemoJob;
  src: Record<string, string>;
  /** Planted: a stand-in app that misbehaves, to prove the H rules notice. */
  tweak?: (app: FakeApp) => void;
  /** Planted: a builder that misbehaves, to prove the K rule notices. */
  build?: (day: string) => DemoJob;
}
const loadSrc = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const f of new Set([...BUILDER_FILES, ...EXCLUSIONS.map((e) => e[0]), ...FENCES.map((e) => e[0]), ...SERVER_FENCES.map((e) => e[0]), 'app/(tabs)/settings/index.tsx', 'constants/featureFlags.ts', 'app/_layout.tsx', 'hooks/useDemoJobCopy.ts', 'hooks/useTimeEntries.ts'])) out[f] = read(f);
  return out;
};

const money = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const eq = (out: string[], what: string, got: number, want: number): void => { if (Math.abs(got - want) > 0.005) out.push(`${what}: ${money(got)}, expected ${money(want)}`); };

/** Source without its comment lines (a rule that forbids a word must not trip on the comment explaining why). */
const codeOf = (text: string): string => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const count = (text: string, needle: string): number => text.split(needle).length - 1;
/** Each needle must be in the file's code; the message names what was lost. */
const pins = (out: string[], src: Record<string, string>, list: readonly [string, string, string][]): void => {
  for (const [file, needle, what] of list) if (!codeOf(src[file]).includes(needle)) out.push(`${file}: ${what}`);
};

/** Every string in a value, with the path it sits at. */
function strings(v: unknown, path = '', out: [string, string][] = []): [string, string][] {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
  return out;
}
/** Every key in a value that holds something (not undefined, null, '', [] or false), with its path. */
function setKeys(v: unknown, path = '', out: [string, string, unknown][] = []): [string, string, unknown][] {
  if (Array.isArray(v)) v.forEach((x, i) => setKeys(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const empty = x === undefined || x === null || x === '' || x === false || (Array.isArray(x) && x.length === 0);
      if (!empty) out.push([path ? `${path}.${k}` : k, k, x]);
      setKeys(x, path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}
/** The records of a job, without its clock and id-maker. */
const dataOf = (job: DemoJob): Record<string, unknown> => {
  const { clock: _c, id: _i, input: _n, ...rest } = job;
  return rest;
};

interface Rule { id: string; what: string; run: (c: Ctx) => string[] | Promise<string[]> }

const RULES: Rule[] = [
  // ── A. Numbers ────────────────────────────────────────────────────────────
  { id: 'A1', what: 'the schedule of values sums to the original contract sum', run: ({ job }) => {
    const out: string[] = [];
    const le = job.project.linkedEstimate!;
    eq(out, 'schedule of values at cost', BASE_COST, 20_000_000);
    eq(out, 'original contract sum', ORIGINAL_CONTRACT_SUM, 22_400_000);
    eq(out, 'linked estimate lines', le.items.reduce((s, i) => s + i.lineTotal, 0), le.grandTotal);
    eq(out, 'linked estimate cost', le.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0), le.baseTotal);
    eq(out, 'base plus markup', le.baseTotal + le.markupTotal, le.grandTotal);
    eq(out, 'estimate grand total', job.project.estimate!.grandTotal, ORIGINAL_CONTRACT_SUM);
    eq(out, 'linked estimate grand total', le.grandTotal, ORIGINAL_CONTRACT_SUM);
    for (const i of le.items) eq(out, `line ${i.name}`, i.lineTotal, i.unitPrice * i.quantity * (1 + i.markup / 100));
    return out;
  } },
  { id: 'A2', what: 'change orders reconcile: 7 approved for +$640,000, 2 pending, 1 rejected', run: ({ job }) => {
    const out: string[] = [];
    const cos = job.changeOrders;
    const approved = cos.filter((c) => c.status === 'approved');
    if (approved.length !== 7) out.push(`${approved.length} approved, expected 7`);
    if (cos.filter((c) => c.status === 'submitted' || c.status === 'under_review').length !== 2) out.push('expected 2 pending');
    if (cos.filter((c) => c.status === 'rejected').length !== 1) out.push('expected 1 rejected');
    eq(out, 'approved total', approved.reduce((s, c) => s + c.changeAmount, 0), 640_000);
    eq(out, 'contract sum to date', CONTRACT_SUM_TO_DATE, 23_040_000);
    for (const c of cos) {
      eq(out, `CO ${c.number} lines`, c.lineItems.reduce((s, l) => s + l.total, 0), c.changeAmount);
      eq(out, `CO ${c.number} new total`, c.newContractTotal, c.originalContractValue + (c.priorApprovedChangesTotal ?? 0) + c.changeAmount);
      eq(out, `CO ${c.number} original`, c.originalContractValue, ORIGINAL_CONTRACT_SUM);
    }
    const last = [...approved].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).pop();
    if (last) eq(out, 'last approved CO total', last.newContractTotal, 23_040_000);
    return out;
  } },
  { id: 'A3', what: 'pay applications 1 to 9 are monotonic, never over the contract sum, and total by the app\'s own formula', run: ({ job }) => {
    const out: string[] = [];
    if (job.payApps.length !== 9) out.push(`${job.payApps.length} pay applications`);
    let prevDone = 0;
    let prevEarned = 0;
    let prevLines = new Map<string, number>();
    job.payApps.forEach((a, i) => {
      const n = i + 1;
      if (a.applicationNumber !== n) out.push(`application ${n} is numbered ${a.applicationNumber}`);
      const t = computeAIATotals(a);
      for (const k of Object.keys(a.totals) as (keyof typeof a.totals)[]) eq(out, `app ${n} ${k}`, a.totals[k], t[k]);
      eq(out, `app ${n} scheduled value`, a.totals.totalScheduledValue, a.contractSumToDate);
      eq(out, `app ${n} contract sum`, a.contractSumToDate, a.originalContractSum + a.netChangeByCO);
      eq(out, `app ${n} line 7`, a.lessPreviousCertificates, prevEarned);
      if (a.totals.totalCompletedAndStored < prevDone) out.push(`app ${n} completed went down`);
      if (a.totals.totalCompletedAndStored > a.contractSumToDate + 0.005) out.push(`app ${n} bills more than the contract sum`);
      if (a.totals.currentPaymentDue < 0) out.push(`app ${n} payment due is negative`);
      for (const l of a.lines) {
        const done = l.fromPreviousApp + l.thisPeriod;
        if (Math.abs(done) > Math.abs(l.scheduledValue) + 0.005) out.push(`app ${n} line ${l.itemNo} is over-billed`);
        if (Math.sign(done) * Math.sign(l.scheduledValue) < 0) out.push(`app ${n} line ${l.itemNo} has the wrong sign`);
        eq(out, `app ${n} line ${l.itemNo} carried forward`, l.fromPreviousApp, prevLines.get(l.itemNo) ?? 0);
        if (l.materialsPresentlyStored !== 0) out.push(`app ${n} line ${l.itemNo} has stored material`);
      }
      prevLines = new Map(a.lines.map((l) => [l.itemNo, l.fromPreviousApp + l.thisPeriod] as const));
      prevDone = a.totals.totalCompletedAndStored;
      prevEarned = a.totals.totalEarnedLessRetainage;
    });
    const last = job.payApps[job.payApps.length - 1];
    if (last) eq(out, 'application 9 contract sum to date', last.contractSumToDate, 23_040_000);
    return out;
  } },
  { id: 'A4', what: 'invoices match their pay applications: 1 to 8 paid in full net of retainage, 9 out and not yet due', run: ({ job }) => {
    const out: string[] = [];
    if (job.invoices.length !== job.payApps.length) out.push('one invoice per pay application');
    const dataDate = new Date(job.clock.atDay(job.clock.dataDate, 23, 59)).getTime();
    job.invoices.forEach((inv, i) => {
      const app = job.payApps[i];
      if (!app || app.invoiceId !== inv.id) { out.push(`invoice ${inv.number} is not linked to application ${i + 1}`); return; }
      eq(out, `invoice ${inv.number} subtotal`, inv.subtotal, app.lines.reduce((s, l) => s + l.thisPeriod, 0));
      eq(out, `invoice ${inv.number} lines`, inv.lineItems.reduce((s, l) => s + l.total, 0), inv.subtotal);
      eq(out, `invoice ${inv.number} total`, inv.totalDue, inv.subtotal + inv.taxAmount);
      const paid = i < PAID_PAY_APPS;
      eq(out, `invoice ${inv.number} paid`, inv.amountPaid, paid ? app.totals.currentPaymentDue : 0);
      eq(out, `invoice ${inv.number} payments`, inv.payments.reduce((s, p) => s + p.amount, 0), inv.amountPaid);
      eq(out, `invoice ${inv.number} balance`, netBalanceDue(inv), paid ? 0 : app.totals.currentPaymentDue);
      if (inv.status !== (paid ? 'paid' : 'sent')) out.push(`invoice ${inv.number} status ${inv.status}`);
      // Nothing may be overdue on the day the job is made: an overdue invoice is what a reminder is sent for.
      if (!paid && new Date(inv.dueDate).getTime() <= dataDate) out.push(`invoice ${inv.number} is already due`);
      if (inv.status === 'overdue') out.push(`invoice ${inv.number} is overdue`);
    });
    return out;
  } },
  { id: 'A5', what: 'billing follows the schedule: about 55 to 60 percent billed, the schedule at or ahead of it', run: ({ job }) => {
    const out: string[] = [];
    const last = job.payApps[job.payApps.length - 1];
    const billed = last.totals.percentComplete;
    const tasks = job.project.schedule!.tasks;
    const sched = tasks.reduce((s, t) => s + t.durationDays * t.progress, 0) / tasks.reduce((s, t) => s + t.durationDays, 0);
    if (billed < 54 || billed > 61) out.push(`billed to date ${billed.toFixed(1)} percent`);
    if (sched < 55 || sched > 64) out.push(`schedule ${sched.toFixed(1)} percent complete`);
    if (Math.abs(sched - schedulePercentOn(DATA_DAY)) > 0.06) out.push(`schedule percent ${sched.toFixed(2)} against ${schedulePercentOn(DATA_DAY)}`);
    if (billed > sched + 0.05) out.push(`billed ${billed.toFixed(1)} is ahead of the schedule ${sched.toFixed(1)}`);
    if (sched - billed > 8) out.push('billing lags the schedule by more than a month of work');
    return out;
  } },
  { id: 'A6', what: 'the budget: margin 8 to 10 percent, exactly two divisions over, nothing paid past its commitment', run: ({ job }) => {
    const out: string[] = [];
    const m = projectedMarginPercent();
    if (m < 8 || m > 10) out.push(`projected margin ${m} percent`);
    const over = projectedFinalCost().byDiv.filter((d) => d.over > 0).map((d) => d.div);
    if (over.join(',') !== '03,09') out.push(`divisions over budget: ${over.join(', ') || 'none'}`);
    for (const c of job.commitments) {
      const value = c.amount + (c.changeAmount ?? 0);
      if ((c.paidToDate ?? 0) > Math.max(0, value)) out.push(`${c.number} is paid past its value`);
      if ((c.paidToDate ?? 0) < 0) out.push(`${c.number} paid is negative`);
    }
    if (job.project.retainagePercent !== 10) out.push('project retainage is not 10');
    return out;
  } },
  // ── B. Schedule ───────────────────────────────────────────────────────────
  { id: 'B1', what: '80 to 120 tasks whose dates the app\'s own engine agrees with', run: ({ job }) => {
    const out: string[] = [];
    const tasks = job.project.schedule!.tasks;
    if (tasks.length < 80 || tasks.length > 120) out.push(`${tasks.length} tasks`);
    const again = recalculateStartDays(tasks.map((t) => ({ ...t })));
    for (const t of tasks) {
      const a = again.find((x) => x.id === t.id);
      if (!a || a.startDay !== t.startDay) out.push(`${t.title}: day ${t.startDay}, the engine says ${a?.startDay}`);
    }
    const ids = new Set(tasks.map((t) => t.id));
    for (const t of tasks) {
      for (const d of t.dependencies) if (!ids.has(d)) out.push(`${t.title} waits on a task that is not there`);
      if ((t.dependencyLinks ?? []).map((l) => l.taskId).join() !== t.dependencies.join()) out.push(`${t.title}: links and dependencies differ`);
      if (t.durationDays < 1) out.push(`${t.title} has no duration`);
    }
    if (tasks.filter((t) => t.dependencies.length === 0).length !== 1) out.push('exactly one task starts the job');
    return out;
  } },
  { id: 'B2', what: 'an 18-month job in month 11: progress, actual dates and the finish are consistent', run: ({ job }) => {
    const out: string[] = [];
    const s = job.project.schedule!;
    const finish = Math.max(...s.tasks.map((t) => t.startDay + t.durationDays - 1));
    if (finish !== s.totalDurationDays || finish !== job.finishDay) out.push(`finish day ${finish} against ${s.totalDurationDays}`);
    if (finish < 365 || finish > 395) out.push(`finish on working day ${finish}: not about 18 months`);
    if (s.startDate !== job.clock.startDate) out.push('start date');
    if (job.clock.dayOf(DATA_DAY) !== job.clock.dataDate) out.push('the data day is not the data date');
    for (const t of s.tasks) {
      const end = t.startDay + t.durationDays - 1;
      const want = end <= DATA_DAY ? 'done' : t.startDay <= DATA_DAY ? 'in_progress' : 'not_started';
      if (t.status !== want) out.push(`${t.title} is ${t.status}, expected ${want}`);
      if ((t.status === 'done') !== (t.progress === 100)) out.push(`${t.title} progress ${t.progress}`);
      if (t.status === 'not_started' && (t.progress !== 0 || t.actualStartDate)) out.push(`${t.title} has not started and has progress`);
      if (t.actualStartDate && t.actualStartDate > job.clock.dataDate) out.push(`${t.title} started in the future`);
      if (t.actualEndDate && (t.actualEndDate > job.clock.dataDate || t.actualEndDate < (t.actualStartDate ?? ''))) out.push(`${t.title} actual dates out of order`);
      if (!!t.actualEndDate !== (t.status === 'done')) out.push(`${t.title} actual finish`);
    }
    return out;
  } },
  { id: 'B3', what: 'a baseline for every task, a critical path to the finish, late tasks with a recorded reason, no weather log', run: ({ job }) => {
    const out: string[] = [];
    const s = job.project.schedule!;
    if (s.baseline?.tasks.length !== s.tasks.length) out.push('baseline is not for every task');
    const late = s.tasks.filter((t) => (t.baselineEndDay ?? 0) - (t.baselineStartDay ?? 0) < t.durationDays);
    if (late.length < 2 || late.length > 4) out.push(`${late.length} tasks run over their baseline`);
    for (const t of late) if (!/over\./.test(t.notes)) out.push(`${t.title} is late with no reason`);
    for (const t of s.tasks) if (t.baselineStartDay === undefined || t.baselineEndDay === undefined) out.push(`${t.title} has no baseline`);
    const crit = s.tasks.filter((t) => t.isCriticalPath);
    if (crit.length < 10) out.push('no critical path');
    const lastTask = [...s.tasks].sort((a, b) => (a.startDay + a.durationDays) - (b.startDay + b.durationDays)).pop();
    if (!lastTask?.isCriticalPath) out.push('the last task is not critical');
    // The app only writes a weather delay from a live reading. The demo has none, so it writes none.
    if ((s.weatherDelayLog ?? []).length || (s.weatherAlerts ?? []).length) out.push('the schedule carries weather records');
    if (job.delayEvents.some((d) => d.cause === 'weather')) out.push('a delay is blamed on weather');
    if (s.startDayBasis !== undefined) out.push('startDayBasis is set (only a user answer may set it)');
    return out;
  } },
  // ── C. References ─────────────────────────────────────────────────────────
  { id: 'C1', what: 'every reference resolves and every id is unique', run: ({ job }) => {
    const out: string[] = [];
    const pid = job.project.id;
    const tasks = new Set(job.project.schedule!.tasks.map((t) => t.id));
    const subs = new Set(job.subcontractors.map((s) => s.id));
    const commitments = new Set(job.commitments.map((c) => c.id));
    const invoices = new Set(job.invoices.map((i) => i.id));
    const deliveries = new Set(job.deliveries.map((d) => d.id));
    const cos = new Set(job.changeOrders.map((c) => c.id));
    const rfis = new Set(job.rfis.map((r) => r.id));
    const sov = new Set(job.project.linkedEstimate!.items.map((i) => i.materialId));
    const need = (set: Set<string>, id: string | undefined | null, what: string) => { if (id && !set.has(id)) out.push(`${what} points at nothing`); };
    job.project.schedule!.tasks.forEach((t) => need(subs, t.assignedSubId, `task ${t.title} sub`));
    job.commitments.forEach((c) => { need(subs, c.subcontractorId, `${c.number} sub`); (c.linkedEstimateItems ?? []).forEach((i) => need(sov, i, `${c.number} estimate line`)); });
    job.cois.forEach((c) => need(subs, c.subcontractorId, 'certificate sub'));
    job.punchItems.forEach((p) => { need(subs, p.assignedSubId, 'punch sub'); need(tasks, p.linkedTaskId, 'punch task'); });
    job.rfis.forEach((r) => need(tasks, r.linkedTaskId, `RFI ${r.number} task`));
    job.submittals.forEach((s) => need(tasks, s.linkedTaskId, `submittal ${s.title} task`));
    job.changeOrders.forEach((c) => (c.scheduleImpactTaskIds ?? []).forEach((t) => need(tasks, t, `CO ${c.number} task`)));
    job.payApps.forEach((a) => { need(invoices, a.invoiceId, `application ${a.applicationNumber} invoice`); a.lines.forEach((l) => need(tasks, l.linkedTaskId, 'pay line task')); });
    job.deliveries.forEach((d) => need(commitments, d.commitmentId, 'delivery commitment'));
    job.reservations.forEach((r) => need(deliveries, r.deliveryId, 'reservation delivery'));
    job.delayEvents.forEach((d) => { need(cos, d.changeOrderId, 'delay change order'); d.impactedTaskIds.forEach((t) => need(tasks, t, 'delay task')); d.evidence.forEach((e) => need(e.kind === 'rfi' ? rfis : cos, e.id, 'delay evidence')); });
    job.lienWaivers.forEach((w) => { need(commitments, w.commitmentId, 'waiver commitment'); need(subs, w.subCompanyId, 'waiver sub'); need(invoices, w.invoiceId, 'waiver invoice'); });
    job.photos.forEach((p) => need(tasks, job.id(`task:${p.task}`), 'photo task'));
    const scoped: { projectId?: string | null }[] = [...job.commitments, ...job.changeOrders, ...job.invoices, ...job.payApps, ...job.dailyReports, ...job.rfis, ...job.submittals, ...job.punchItems, ...job.permits, ...job.oacMeetings, ...job.warranties, ...job.toolboxTalks, ...job.hazards, ...job.deliveries, ...job.reservations, ...job.delayEvents, ...job.fieldTickets, ...job.lienWaivers, job.contract, job.buildingAccess, ...job.selections.map((s) => s.category)];
    if (scoped.some((r) => r.projectId !== pid)) out.push('a record belongs to another project');
    if (job.model.projectId !== pid || job.project.schedule!.projectId !== pid) out.push('the model or the schedule belongs to another project');
    const ids: string[] = [];
    // A baseline row carries its task's id on purpose, and a delay's evidence names the record it points at.
    for (const [path, k, v] of setKeys(dataOf(job))) if (k === 'id' && typeof v === 'string' && !path.includes('.baseline.') && !path.includes('.evidence[')) ids.push(v);
    const seen = new Set<string>();
    for (const i of ids) { if (seen.has(i)) out.push(`id used twice: ${i}`); seen.add(i); }
    job.rfis.forEach((r, i) => { if (r.number !== i + 1) out.push('RFI numbers are not in order'); });
    return out;
  } },
  // ── D. Fiction ────────────────────────────────────────────────────────────
  { id: 'D1', what: 'the project is named a demo, on a sample job, at a made-up address', run: ({ job }) => {
    const out: string[] = [];
    const p = job.project;
    if (!p.name.includes('Demo')) out.push('the word Demo is not in the name');
    if (p.name !== DEMO_PROJECT_NAME) out.push(`name is ${p.name}`);
    if (!isSampleProject(p)) out.push('not a sample job');
    if (!isDemoProject(p) || !isDemoProjectName(p.name)) out.push('isDemoProject is false');
    if (p.leadSource !== DEMO_LEAD_SOURCE) out.push('the second marker is not stamped');
    if (!/Example Wharf Street, Baltimore, MD/.test(p.location)) out.push('address');
    if (!/made-up/i.test(p.description)) out.push('the description does not say the job is made up');
    // It cannot be renamed out of the sample name, or lose its second marker; any other edit, and any other job, passes.
    const out1: Partial<Project> = demoSafeUpdates(p, { name: 'Harbor Point Mixed-Use', description: 'x' } as Partial<Project>);
    if (out1.name !== undefined || out1.description !== 'x') out.push('a demo job can be renamed out of its sample name');
    if ((demoSafeUpdates(p, { leadSource: 'referral' } as Partial<Project>)).leadSource !== undefined) out.push('a demo job can lose its second marker');
    if (demoSafeUpdates(p, { name: `${p.name} (Copy)` }).name !== `${p.name} (Copy)`) out.push('a demo job cannot be renamed at all');
    const real = { name: 'A Real Job', leadSource: 'referral' };
    const edit = { name: 'Renamed' };
    if (demoSafeUpdates(real, edit) !== edit) out.push('a real job\'s rename is touched');
    return out;
  } },
  { id: 'D2', what: 'every email is at example.com and every phone number is 555-01xx', run: ({ job }) => {
    const out: string[] = [];
    for (const [path, s] of strings(dataOf(job))) {
      for (const m of s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? []) if (!EMAIL_RULE.test(m)) out.push(`${path}: ${m}`);
      for (const m of s.match(/\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g) ?? []) if (!PHONE_RULE.test(m)) out.push(`${path}: ${m}`);
      if (/^https?:\/\//.test(s)) out.push(`${path}: a link`);
    }
    for (const s of job.subcontractors) { if (!EMAIL_RULE.test(s.email)) out.push(`${s.companyName} email`); if (!PHONE_RULE.test(s.phone)) out.push(`${s.companyName} phone`); if (!/^Sample /.test(s.companyName)) out.push(`${s.companyName} is not plainly made up`); }
    for (const c of job.contacts) { if (!EMAIL_RULE.test(c.email)) out.push(`${c.lastName} email`); if (!PHONE_RULE.test(c.phone)) out.push(`${c.lastName} phone`); if (!/^(Sample|Example) /.test(c.companyName)) out.push(`${c.companyName} is not plainly made up`); }
    for (const c of job.crew) { if (!EMAIL_RULE.test(c.email ?? '')) out.push(`${c.fullName} email`); if (!PHONE_RULE.test(c.phone ?? '')) out.push(`${c.fullName} phone`); }
    return out;
  } },
  { id: 'D3', what: 'a rename the demo job refuses is said to the user, in one sentence', run: ({ job, src }) => {
    const out: string[] = [];
    const p = job.project;
    const tell = (prior: { name?: string | null; leadSource?: string | null }, asked: Partial<Project>): boolean => demoRenameDropped(prior, asked, demoSafeUpdates(prior, asked));
    if (!tell(p, { name: 'Harbor Point Mixed-Use' })) out.push('a dropped rename is not noticed');
    if (tell(p, { name: `${p.name} (Copy)` })) out.push('a rename that was kept is reported as dropped');
    if (tell(p, { description: 'x' })) out.push('an edit with no rename is reported as a dropped rename');
    if (tell({ name: 'A Real Job', leadSource: 'referral' }, { name: 'Renamed' })) out.push('a real job\'s rename is reported as dropped');
    if ((DEMO_RENAME_KEPT_REASON.match(/[.?!]/g) ?? []).length !== 1 || !DEMO_RENAME_KEPT_REASON.endsWith('.')) out.push('the reason is not one sentence');
    if (/—|&|!|e\.g\./.test(DEMO_RENAME_KEPT_REASON + DEMO_RENAME_KEPT_TITLE)) out.push('the reason has a dash, an and sign or an exclamation mark');
    if (!/sample name/.test(DEMO_RENAME_KEPT_REASON)) out.push('the reason does not say why');
    pins(out, src, [['contexts/ProjectContext.tsx', 'if (demoRenameDropped(prior, updatesIn, rawUpdates)) showAlert(DEMO_RENAME_KEPT_TITLE, DEMO_RENAME_KEPT_REASON);', 'a dropped rename is no longer said']]);
    return out;
  } },
  // ── E. No fabricated evidence ─────────────────────────────────────────────
  { id: 'E1', what: 'no signature, seal, verification, certificate or delivery stamp is set on any record', run: ({ job }) => {
    const out: string[] = [];
    const banned = /signature|^signedAt$|signedPdf|^sealedAt$|^sealId$|contentHash|documentHash|VerifiedAt$|^idVerified$|^validation$|^authorization$|^approvers$|^distributedAt$|^distributionLog$|^sentAt$|^signRequestedAt$|^payLink|^qbo|^shareToken$|^dunning|^evidencePath$|^amountCertified$|^homeownerSummary|^claimToken$|^claimedBy/;
    for (const [path, k] of setKeys(dataOf(job))) if (banned.test(k)) out.push(`${path} is set`);
    for (const w of job.lienWaivers) { if (w.status !== 'received') out.push('a lien waiver is not "received"'); if (!/on paper/.test(w.notes)) out.push('a lien waiver does not say it is on paper'); }
    if (job.contract.status !== 'draft') out.push('the contract is not a draft');
    for (const t of job.fieldTickets) if (t.status !== 'draft') out.push('a field ticket is not a draft');
    for (const c of job.changeOrders) {
      if (c.status !== 'approved' && c.status !== 'rejected') continue;
      if (!(c.auditTrail ?? []).some((a) => /recorded by the contractor/.test(a.detail ?? '') && /No client signature/.test(a.detail ?? ''))) out.push(`CO ${c.number} does not say who recorded the answer`);
    }
    for (const m of job.oacMeetings) if (m.status === 'distributed') out.push('meeting minutes are marked distributed');
    for (const t of job.toolboxTalks) if (t.attendees.some((a) => a.signedAt)) out.push('a toolbox talk has a sign-in time');
    return out;
  } },
  { id: 'E2', what: 'weather is typed by hand, nothing is marked as read from a live source or written by AI', run: ({ job }) => {
    const out: string[] = [];
    for (const d of job.dailyReports) {
      if (d.weather.isManual !== true) out.push(`${d.date} weather is not marked typed`);
      if (d.weather.source || d.weather.readAt || d.weather.readDay) out.push(`${d.date} weather carries a live-source stamp`);
      if (d.origin || d.leakScan) out.push(`${d.date} carries a voice or scan stamp`);
      if (d.incident?.oshaRecordable !== undefined) out.push(`${d.date} answers the OSHA question`);
      if (d.incident?.peopleInvolved) out.push(`${d.date} names a person in an incident`);
      if (d.workProgress) out.push(`${d.date} would rewrite schedule progress`);
    }
    for (const [path, k, v] of setKeys(dataOf(job))) {
      if (k === 'source' && (v === 'ai' || v === 'ai_generated' || v === 'openweather')) out.push(`${path} is ${String(v)}`);
      if (k === 'aiGenerated' || k === 'xray' || k === 'aiTopicSource' && v !== 'manual') out.push(`${path} is set`);
      if (k === 'priceSource') out.push(`${path} is set`);
    }
    if (job.dailyReports.filter((d) => d.incident?.hasIncident).length !== 1) out.push('expected one first-aid note in the daily reports');
    return out;
  } },
  { id: 'E3', what: 'every submittal review cycle says it was typed in by the contractor, with or without a comment', run: ({ job }) => {
    const out: string[] = [];
    let bare = 0;
    for (const s of job.submittals) {
      for (const c of s.reviewCycles ?? []) {
        if (!(c.comments ?? '').endsWith(REVIEW_TYPED_NOTE)) out.push(`${s.title}, cycle ${c.cycleNumber}: a reviewer and a result with no "typed in by the contractor"`);
        if (c.comments === REVIEW_TYPED_NOTE) bare += 1;
      }
    }
    if (bare === 0) out.push('no review cycle is without a comment: this check proves nothing');
    return out;
  } },
  // ── F. Nothing leaves the account ─────────────────────────────────────────
  { id: 'F1', what: 'no record can be addressed to anyone: portal off, nobody invited, no client email, no insurance expiry', run: ({ job }) => {
    const out: string[] = [];
    const p = job.project;
    // No client portal settings at all: a project row that carries a portal id makes the server mint a live portal key.
    if (p.clientPortal) out.push('the project carries client portal settings (a portal id makes the server mint a portal key)');
    for (const [path, k] of setKeys(dataOf(job))) if (/^portalId$|^accessToken$|^passcode$/.test(k)) out.push(`${path} is set`);
    if (p.primaryContact?.email) out.push('the project has a client email');
    if ((p.collaborators ?? []).length) out.push('the project has collaborators');
    if (p.publicProfile) out.push('the project has a public page');
    if (p.status !== 'in_progress' || p.closedAt) out.push('the job is not open');
    for (const i of job.invoices) if (i.billToEmail) out.push(`invoice ${i.number} has a bill-to email`);
    // The server's daily insurance check emails the account for any sub with an expiry date, sample job or not.
    for (const s of job.subcontractors) if (s.coiExpiry) out.push(`${s.companyName} has an insurance expiry date`);
    for (const c of job.cois) for (const cov of c.coverages ?? []) if (cov.expiresAt || cov.aiExpiresAt) out.push('a certificate has an expiry date');
    for (const m of job.oacMeetings) for (const a of m.attendees) if (a.email) out.push('a meeting attendee has an email');
    for (const w of job.lienWaivers) if ((w as { subEmail?: string }).subEmail) out.push('a lien waiver has a sub email');
    for (const d of job.delayEvents) if (d.notices.length) out.push('a delay carries a notice');
    for (const c of job.crew) if (c.isPublic !== false) out.push(`${c.fullName} is public`);
    if ('incidents' in job || 'bidPackages' in job || 'leads' in job || 'portalMessages' in job) out.push('the job has a record kind it must not have');
    return out;
  } },
  { id: 'F2', what: 'the builder\'s source cannot reach anyone, sign anything or call a model', run: ({ src }) => {
    const out: string[] = [];
    for (const f of BUILDER_FILES) {
      const code = src[f].split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const w of FORBIDDEN_CALLS) if (code.includes(w)) out.push(`${f} mentions ${w}`);
      if (/from '@\/lib\/supabase'|supabase\.from\(|fetch\(/.test(code)) out.push(`${f} talks to the server directly`);
    }
    const ports = src['hooks/useDemoJobPorts.ts'];
    const imports = [...ports.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const i of imports) if (!PORT_IMPORTS.includes(i)) out.push(`the ports import ${i}`);
    if (DEMO_DELETE_TABLES.join() !== 'cois,oac_meetings,delay_events,field_tickets') out.push('the delete tables changed');
    if (!/queueDelete: \(table, id\) => supabaseWrite\(table, 'delete', \{ id \}\)/.test(ports)) out.push('queueDelete is not a delete by id');
    if ((ports.match(/supabaseWrite\(/g) ?? []).length !== 1) out.push('the ports write to the queue more than once');
    if (!/addManualEntry: time\.addManualEntry/.test(ports)) out.push('time entries are not manual entries');
    return out;
  } },
  { id: 'F3', what: 'the fences the demo leans on are still in the server and the app', run: ({ src }) =>
    FENCES.filter(([file, needle]) => !src[file].includes(needle)).map(([file, , what]) => `${file}: ${what}`) },
  { id: 'F4', what: 'the morning brief and the assistant connector leave sample jobs out', run: ({ job, src }) => {
    const out: string[] = [];
    for (const [file, needle, n, what] of SERVER_FENCES) {
      const got = count(codeOf(src[file]), needle);
      if (got !== n) out.push(`${file}: ${what} (${got} of ${n})`);
    }
    // The server's rule, run: the demo's name is a sample name, a real job's is not.
    if (!serverIsSampleProjectName(job.project.name) || serverIsSampleProjectName('Harbor Point Mixed-Use')) out.push('the server does not read the demo\'s name as a sample job');
    for (const sub of job.subcontractors) if (!sub.companyName.startsWith('Sample ')) out.push(`${sub.companyName} would be listed by the assistant connector`);
    return out;
  } },
  // ── G. Teaches and reports nothing ────────────────────────────────────────
  { id: 'G1', what: 'the cost book and bid calibration learn nothing from the demo, even closed', run: ({ job }) => {
    const out: string[] = [];
    const closedDemo: Project = { ...job.project, status: 'closed', closedAt: job.clock.at(DATA_DAY, 12) };
    const real: Project = { ...closedDemo, name: 'Harbor Point Mixed-Use', leadSource: 'referral' };
    const control = buildCostDatabase([real], job.commitments);
    if (control.entries.length + (control.entriesAwaitingEvidence?.length ?? 0) === 0 && control.jobsAnalyzed === 0) out.push('the control job taught the cost book nothing: this check proves nothing');
    const db = buildCostDatabase([closedDemo], job.commitments);
    if (db.entries.length || db.jobsAnalyzed || (db.entriesAwaitingEvidence?.length ?? 0)) out.push(`a closed demo job taught the cost book ${db.entries.length} rates`);
    const renamed = buildCostDatabase([{ ...closedDemo, name: 'Renamed By Hand' }], job.commitments);
    if (renamed.entries.length || renamed.jobsAnalyzed) out.push('a renamed demo job taught the cost book');
    const cal = computeCalibration({ projects: [closedDemo], commitments: job.commitments });
    if (cal.hasData) out.push('a closed demo job fed bid calibration');
    return out;
  } },
  { id: 'G2', what: 'each learning and reporting path has its demo exclusion in the source', run: ({ src }) =>
    EXCLUSIONS.filter(([file, needle]) => !src[file].includes(needle)).map(([file, , what]) => `${file}: ${what} no longer leaves the demo out`) },
  { id: 'G3', what: 'tax, audit, payroll, the free plan and analytics do not count the demo', run: ({ job }) => {
    const out: string[] = [];
    const other = { id: 'real-sub' };
    const otherC = { id: 'real-c', projectId: 'real-project' };
    const kept = withoutDemoPayees([job.project, { id: 'real-project', name: 'A Real Job' }], [...job.subcontractors, other], [...job.commitments, otherC]);
    if (kept.subcontractors.length !== 1 || kept.subcontractors[0] !== other) out.push('demo subs reach the 1099 export');
    if (kept.commitments.length !== 1 || kept.commitments[0] !== otherC) out.push('demo subcontracts reach the 1099 export');
    if (demoSubcontractorIds([job.project]).size !== job.subcontractors.length) out.push('not every demo sub is recognised');
    if (!isSampleTimeEntry({ projectName: job.project.name })) out.push('demo shifts reach payroll and the labor rates');
    if (countsTowardFreeCap(job.project, USER)) out.push('the demo takes the free plan\'s project slot');
    if (!sampleSendPlan(job.project, 'owner@example.com').sample) out.push('the demo is not fenced as a sample job');
    noteDemoScope([job.project]);
    if (!isKnownDemoProjectId(job.project.id) || !isDemoJobEvent({ project_id: job.project.id })) out.push('demo events are not dropped');
    if (isDemoJobEvent({ project_id: 'real-project' }) || isDemoJobEvent({})) out.push('real events are dropped');
    noteDemoScope([]);
    if (isKnownDemoProjectId(job.project.id)) out.push('the registry is not emptied on sign-out');
    return out;
  } },
  { id: 'G4', what: 'One Mind and the bid advisor never see the demo: no fact in a prompt, no margin by job type', run: ({ job }) => {
    const out: string[] = [];
    const pid = job.project.id;
    const closedDemo: Project = { ...job.project, status: 'closed', closedAt: job.clock.at(DATA_DAY, 12) };
    const control: Project = { ...closedDemo, name: 'Harbor Point Mixed-Use', leadSource: 'referral' };
    if (realizedMarginPct(control, job.commitments, job.changeOrders) === null) out.push('the control job has no realized margin: this check proves nothing');
    if (realizedMarginPct(closedDemo, job.commitments, job.changeOrders) !== null) out.push('a closed demo job has a realized margin (it would grade bid predictions)');
    if (aggregateTypeMargin([control], control.type, job.commitments, job.changeOrders).jobCount !== 1) out.push('the control job is not in the margin by type: this check proves nothing');
    if (aggregateTypeMargin([closedDemo], closedDemo.type, job.commitments, job.changeOrders).jobCount !== 0) out.push('a closed demo job feeds the bid advisor\'s margin by job type');
    if (buildTypeProfitability([closedDemo], job.commitments, job.changeOrders).coverage.closedTotal !== 0) out.push('a closed demo job is counted in type profitability');
    // One Mind: the bundle with the demo, one real job and one real row of each kind.
    const real = { id: 'real-project', name: 'A Real Job', status: 'in_progress' };
    const row = { id: 'real-row', projectId: 'real-project' };
    const realSub = { id: 'real-sub', companyName: 'His Own Electric' };
    const bundle = {
      projects: [job.project, real], commitments: [...job.commitments, row], changeOrders: [...job.changeOrders, row], invoices: [...job.invoices, row],
      rfis: [...job.rfis, row], leads: [], dailyReports: [...job.dailyReports, row], permits: [...job.permits, row], submittals: [...job.submittals, row],
      punchItems: [...job.punchItems, row], expiringCertifications: [], bidResponses: [], aiaPayApps: [...job.payApps, row], receipts: [row],
      laborSamples: [{ projectId: pid }, row],
      costSources: { subcontractors: [...job.subcontractors, realSub], timeEntries: [{ id: 't', projectId: pid }, row], equipment: [...job.equipment, { id: 'his-machine', currentProjectId: 'real-project' }], permits: [...job.permits, row], receipts: [row] },
      constraints: { [pid]: [{ id: 'c' }], 'real-project': [{ id: 'c2' }] },
    } as unknown as OneMindBundle;
    const fenced = withoutDemoFacts(bundle);
    const text = JSON.stringify(fenced);
    if (text.includes(pid) || text.includes('Harbor Point') || text.includes('Sample ')) out.push('a demo fact is still in the One Mind bundle');
    const lists: [string, unknown[] | undefined][] = [
      ['projects', fenced.projects], ['commitments', fenced.commitments], ['change orders', fenced.changeOrders], ['invoices', fenced.invoices], ['RFIs', fenced.rfis],
      ['daily reports', fenced.dailyReports], ['permits', fenced.permits], ['submittals', fenced.submittals], ['punch items', fenced.punchItems], ['pay applications', fenced.aiaPayApps],
      ['receipts', fenced.receipts], ['labor samples', fenced.laborSamples], ['cost subs', fenced.costSources?.subcontractors], ['cost shifts', fenced.costSources?.timeEntries],
      ['cost equipment', fenced.costSources?.equipment], ['cost permits', fenced.costSources?.permits],
    ];
    for (const [what, list] of lists) if (list?.length !== 1) out.push(`One Mind ${what}: ${list?.length} left, expected the one real row`);
    if (Object.keys(fenced.constraints ?? {}).join() !== 'real-project') out.push('the demo\'s constraints are still in the bundle');
    const onlyReal = { ...bundle, projects: [real] } as unknown as OneMindBundle;
    if (withoutDemoFacts(onlyReal) !== onlyReal) out.push('a bundle with no demo job is rebuilt');
    return out;
  } },
  // ── H. Resumable, idempotent, removable ───────────────────────────────────
  { id: 'H1', what: 'create writes everything once, and a second run writes nothing', run: async ({ job, tweak }) => {
    const out: string[] = [];
    const makeFakeApp = () => { const a = makeFakeAppRaw(); tweak?.(a); return a; };
    const app = makeFakeApp();
    const r = await createDemoJob(job, app.ports, () => {});
    if (!r.ok) out.push(`create failed: ${JSON.stringify(r.failures)}`);
    const st = await demoStatus(job, app.ports);
    if (st.state !== 'complete') out.push(`state ${st.state}: ${st.areas.filter((a) => a.present !== a.total).map((a) => a.key).join(', ')}`);
    const want: [string, number, number][] = [
      ['projects', app.lists.projects.length, 1], ['subcontractors', app.lists.subcontractors.length, job.subcontractors.length], ['contacts', app.lists.contacts.length, job.contacts.length],
      ['commitments', app.lists.commitments.length, job.commitments.length], ['certificates', app.lists.cois.length, job.cois.length], ['change orders', app.lists.changeOrders.length, job.changeOrders.length],
      ['invoices', app.lists.invoices.length, 9], ['pay applications', app.lists.aiaPayApps.length, 9], ['daily reports', app.lists.dailyReports.length, 30], ['RFIs', app.lists.rfis.length, job.rfis.length],
      ['submittals', app.lists.submittals.length, job.submittals.length], ['punch items', app.lists.punchItems.length, job.punchItems.length], ['permits', app.lists.permits.length, job.permits.length],
      ['meetings', app.lists.oacMeetings.length, job.oacMeetings.length], ['warranties', app.lists.warranties.length, job.warranties.length], ['toolbox talks', app.lists.toolboxTalks.length, job.toolboxTalks.length],
      ['hazards', app.lists.hazards.length, job.hazards.length], ['deliveries', app.lists.deliveries.length, job.deliveries.length], ['access rules', app.lists.buildingAccessRules.length, 1],
      ['reservations', app.lists.accessReservations.length, job.reservations.length], ['delays', app.lists.delayEvents.length, job.delayEvents.length], ['equipment', app.lists.equipment.length, job.equipment.length],
      ['field tickets', app.lists.fieldTickets.length, job.fieldTickets.length], ['crew', app.lists.crew.length, job.crew.length], ['time entries', app.lists.timeEntries.length, job.timeEntries.length],
      ['photos', app.lists.projectPhotos.length, job.photos.length], ['plan sheets', app.lists.planSheets.length, 1], ['lien waivers', app.engineRows.lienWaivers.size, job.lienWaivers.length],
      ['contracts', app.engineRows.contracts.size, 1], ['selections', app.engineRows.selections.size, job.selections.length], ['models', app.models.size, 1], ['safety incidents', app.lists.safetyIncidents.length, 0],
    ];
    for (const [what, got, n] of want) if (got !== n) out.push(`${what}: ${got}, expected ${n}`);
    const before = app.adds();
    const again = await createDemoJob(job, app.ports, () => {});
    if (!again.ok || app.adds() !== before) out.push(`a second run made ${app.adds() - before} more writes`);
    // The whole job is well inside the offline queue's cap, with the room the writer asks for.
    if (before > QUEUE_ROOM_NEEDED - 50 || QUEUE_ROOM_NEEDED >= QUEUE_CAP) out.push(`${before} writes against room for ${QUEUE_ROOM_NEEDED}`);
    return out;
  } },
  { id: 'H2', what: 'a job cut off part way is finished without a duplicate, from any cut point', run: async ({ job, tweak }) => {
    const out: string[] = [];
    const makeFakeApp = () => { const a = makeFakeAppRaw(); tweak?.(a); return a; };
    for (const cut of [1, 7, 40, 95, 180, 215]) {
      const app = makeFakeApp();
      app.set({ stopAfterAdds: cut });
      await createDemoJob(job, app.ports, () => {}).catch(() => undefined);
      const mid = await demoStatus(job, app.ports);
      if (mid.state !== 'partial') out.push(`cut at ${cut}: state ${mid.state}`);
      app.set({ stopAfterAdds: null });
      const r = await createDemoJob(job, app.ports, () => {});
      const st = await demoStatus(job, app.ports);
      if (!r.ok || st.state !== 'complete') out.push(`cut at ${cut}: not finished`);
      const whole = makeFakeAppRaw();
      await createDemoJob(job, whole.ports, () => {});
      if (fakeRecordCount(app) !== fakeRecordCount(whole)) out.push(`cut at ${cut}: ${fakeRecordCount(app)} records, a clean run makes ${fakeRecordCount(whole)}`);
      if (app.lists.projects.length !== 1) out.push(`cut at ${cut}: ${app.lists.projects.length} projects`);
    }
    return out;
  } },
  { id: 'H3', what: 'one demo at a time, a full queue refuses, a failed area is reported and the rest continues, offline works', run: async ({ job, tweak }) => {
    const out: string[] = [];
    const makeFakeApp = () => { const a = makeFakeAppRaw(); tweak?.(a); return a; };
    const twin = makeFakeApp();
    await createDemoJob(job, twin.ports, () => {});
    const second = mkJob(SEED, '9c2e4a6b-1d3f-4b5a-8c7e-0f1a2b3c4d5e');
    const r2 = await createDemoJob(second, twin.ports, () => {});
    if (r2.refused !== 'exists_elsewhere' || twin.lists.projects.length !== 1) out.push('a second demo job was made beside the first');
    const full = makeFakeApp();
    full.set({ queued: QUEUE_CAP - QUEUE_ROOM_NEEDED + 1 });
    const rf = await createDemoJob(job, full.ports, () => {});
    if (rf.refused !== 'queue_full' || full.adds() !== 0) out.push('a full queue did not refuse');
    const drop = makeFakeApp();
    drop.set({ dropAdds: 'commitments' });
    const rd = await createDemoJob(job, drop.ports, () => {});
    if (rd.ok || rd.failures.length !== 1 || rd.failures[0].key !== 'commitments' || !rd.failures[0].message) out.push('a failed area was not reported by itself');
    if (drop.lists.dailyReports.length !== 30 || drop.models.size !== 1) out.push('the areas after a failed one did not run');
    const off = makeFakeApp();
    off.set({ online: false });
    const ro = await createDemoJob(job, off.ports, () => {});
    const keys = ro.failures.map((f) => f.key).sort().join();
    if (keys !== 'contract,lienWaivers,planSheet,selections') out.push(`offline failures: ${keys}`);
    if (ro.failures.some((f) => f.code !== 'offline')) out.push('offline is not said as offline');
    if (off.lists.dailyReports.length !== 30 || off.lists.projects.length !== 1 || off.models.size !== 1) out.push('offline did not write the rest');
    off.set({ online: true });
    if (!(await createDemoJob(job, off.ports, () => {})).ok) out.push('back online did not finish the job');
    const noProject = makeFakeApp();
    noProject.set({ dropAdds: 'projects' });
    await createDemoJob(job, noProject.ports, () => {});
    if (fakeRecordCount(noProject) !== 0) out.push('records were written with no project');
    return out;
  } },
  { id: 'H4', what: 'removal deletes everything created, refuses whole when the project cannot go, and a new job can be made after', run: async ({ job, tweak }) => {
    const out: string[] = [];
    const makeFakeApp = () => { const a = makeFakeAppRaw(); tweak?.(a); return a; };
    const app = makeFakeApp();
    app.lists.subcontractors.push({ id: 'his-own-sub' });
    app.lists.contacts.push({ id: 'his-own-contact' });
    app.lists.timeEntries.push({ id: 'his-own-shift', projectId: 'real-project' });
    app.lists.equipment.push({ id: 'his-own-machine' });
    app.lists.projects.push({ id: 'real-project', name: 'A Real Job' });
    const mine = fakeRecordCount(app);
    await createDemoJob(job, app.ports, () => {});
    const made = fakeRecordCount(app) - mine;
    const res = await removeDemoJob(job.project.id, app.ports);
    if (!res.ok) out.push('removal was refused');
    if (fakeRecordCount(app) !== mine) out.push(`${fakeRecordCount(app) - mine} of ${made} records are left`);
    if (!app.lists.subcontractors.some((s) => s.id === 'his-own-sub') || !app.lists.projects.some((p) => p.id === 'real-project') || !app.lists.equipment.some((e) => e.id === 'his-own-machine') || !app.lists.timeEntries.some((e) => e.id === 'his-own-shift')) out.push('removal took a record that was not the demo\'s');
    const deleted = (table: string) => app.serverDeletes.filter((d) => d.table === table).length;
    const acct = demoAccountIds(job.project.id);
    const wantDeletes: [string, number][] = [['projects', 1], ['cois', job.cois.length], ['oac_meetings', job.oacMeetings.length], ['delay_events', job.delayEvents.length], ['field_tickets', job.fieldTickets.length], ['time_entries', job.timeEntries.length], ['equipment', acct.equipment.length], ['crew_members', acct.crew.length], ['contacts', acct.contacts.length], ['subcontractors', acct.subcontractors.length]];
    for (const [table, n] of wantDeletes) if (deleted(table) !== n) out.push(`${table}: ${deleted(table)} server deletes, expected ${n}`);
    if (acct.subcontractors.length !== job.subcontractors.length || acct.contacts.length !== job.contacts.length || acct.crew.length !== job.crew.length || acct.equipment.slice().sort().join() !== job.equipment.map((e) => e.id).sort().join()) out.push('removal does not know every account-level record');
    if (!app.log.includes('removeJobModel') || app.models.size) out.push('the Living Model was left on the device');
    const next = mkJob(SEED, '7a7a7a7a-1111-4222-8333-444455556666');
    if (!(await createDemoJob(next, app.ports, () => {})).ok) out.push('a job could not be made after removal');
    // A job with a safety incident added by hand is kept by law: nothing else is touched.
    const held = makeFakeApp();
    await createDemoJob(job, held.ports, () => {});
    held.lists.safetyIncidents.push({ id: 'i1', projectId: job.project.id });
    const count = fakeRecordCount(held);
    const refused = await removeDemoJob(job.project.id, held.ports);
    if (refused.ok || !refused.reason) out.push('a job with a safety incident was removed');
    if (fakeRecordCount(held) !== count || held.serverDeletes.length) out.push('a refused removal still deleted something');
    return out;
  } },
  { id: 'H5', what: 'the builder finds, finishes and deletes only the job with its stamp, and the confirmation names the jobs and their count', run: async ({ job, src, tweak }) => {
    const out: string[] = [];
    const makeFakeApp = () => { const a = makeFakeAppRaw(); tweak?.(a); return a; };
    const app = makeFakeApp();
    // A job somebody named by hand (or a copy of the demo): the sample name, no stamp.
    const lookalike = { id: 'hand-named', name: `${DEMO_PROJECT_NAME} (My Copy)` };
    app.lists.projects.push(lookalike);
    app.lists.dailyReports.push({ id: 'his-report', projectId: 'hand-named' });
    if (!isDemoProject(lookalike)) out.push('a job with the demo name is no longer left out of the learning paths');
    if (isStampedDemoProject(lookalike) || !isStampedDemoProject(job.project)) out.push('the stamp test reads the name');
    if (isStampedDemoProject({ name: 'Renamed By Hand', leadSource: DEMO_LEAD_SOURCE }) !== true) out.push('a stamped job is not found once renamed');
    if (existingDemoProjects(app.ports.world()).length !== 0) out.push('the builder counts a hand-named job as its own');
    const before = fakeRecordCount(app);
    const refused = await removeDemoJob('hand-named', app.ports);
    if (refused.ok || refused.reason !== NOT_THE_BUILDERS_REASON) out.push('removal accepted a job that only has the name');
    if (fakeRecordCount(app) !== before || app.serverDeletes.length || app.deleteCalls.length) out.push('removal touched a job that only has the name');
    const made = await createDemoJob(job, app.ports, () => {});
    const found = existingDemoProjects(app.ports.world());
    if (!made.ok || found.length !== 1 || found[0].id !== job.project.id || found[0].name !== DEMO_PROJECT_NAME) out.push('the builder did not make and find its own job beside a hand-named one');
    if (app.lists.dailyReports.filter((r) => r.projectId === 'hand-named').length !== 1) out.push('the builder wrote into a hand-named job');
    await removeDemoJob(job.project.id, app.ports);
    if (!app.lists.projects.some((p) => p.id === 'hand-named') || !app.lists.dailyReports.some((r) => r.id === 'his-report')) out.push('removing the demo took a hand-named job with it');
    if (/isDemoProject\(/.test(codeOf(src['utils/demoJob/writer.ts']))) out.push('the writer tests the name (isDemoProject): it may only test the stamp');
    pins(out, src, [
      ['utils/demoJob/marker.ts', 'return !!project && project.leadSource === DEMO_LEAD_SOURCE;', 'the stamp test is no longer the stamp alone'],
      ['utils/demoJob/writer.ts', 'return world.projects.filter((p) => isStampedDemoProject(p)).map(', 'the builder no longer finds its job by the stamp alone'],
      ['utils/demoJob/writer.ts', 'if (project && !isStampedDemoProject(project)) return { ok: false, reason: NOT_THE_BUILDERS_REASON };', 'removal no longer refuses a job without the stamp'],
      ['components/demoJob/DemoJobScreen.tsx', "copy.confirmRemoveBody(confirmJobs.length, confirmJobs.map((j) => j.name).join(', '))", 'the confirmation no longer names the jobs and their count'],
      ['components/demoJob/DemoJobScreen.tsx', 'for (const p of named) {', 'Remove no longer deletes exactly the jobs it named'],
      ['components/demoJob/DemoJobScreen.tsx', 'if (!still.has(p.id)) continue;', 'Remove no longer re-checks the stamp before each delete'],
    ]);
    const en = EN_SHARD as Record<string, string>;
    if (!/^Remove 1 demo job .*\{names\}/.test(en['office.demoJob.confirmRemoveOneBody'] ?? '')) out.push('the confirmation for one job does not say the count and the name');
    if (!/\{count\} demo jobs .*\{names\}/.test(en['office.demoJob.confirmRemoveManyBody'] ?? '')) out.push('the confirmation for several jobs does not say the count and the names');
    return out;
  } },
  { id: 'H6', what: 'removal lets the server be asked about safety records, and sweeps nothing unless the job is gone', run: async ({ job, src, tweak }) => {
    const out: string[] = [];
    const makeFakeApp = () => { const a = makeFakeAppRaw(); tweak?.(a); return a; };
    // An incident only the server knows of (logged on another phone): this device's list is empty.
    const app = makeFakeApp();
    await createDemoJob(job, app.ports, () => {});
    app.set({ serverIncidents: 1 });
    const before = fakeRecordCount(app);
    const res = await removeDemoJob(job.project.id, app.ports);
    if (res.ok || !res.reason) out.push('a job with a safety record on the server was removed');
    if (fakeRecordCount(app) !== before || app.serverDeletes.length || app.log.includes('removeJobModel')) out.push('a refused removal still deleted something');
    if (app.deleteCalls.length !== 1 || app.deleteCalls.some((c) => c.opts !== undefined)) out.push('the delete was handed a count from this device, so the server was never asked');
    // The app says yes and the job is still there: nothing else may go.
    const kept = makeFakeApp();
    await createDemoJob(job, kept.ports, () => {});
    kept.set({ deleteKeepsJob: true });
    const count0 = fakeRecordCount(kept);
    const stuck = await removeDemoJob(job.project.id, kept.ports);
    if (stuck.ok || stuck.reason !== STILL_THERE_REASON) out.push('removal reported success with the job still in the account');
    if (fakeRecordCount(kept) !== count0 || kept.serverDeletes.length || kept.log.includes('removeJobModel') || kept.log.some((l) => l.startsWith('queueDelete'))) out.push('subs, contacts, crew, shifts or stray rows were swept with the job still in the account');
    if (/safetyIncidentCount/.test(codeOf(src['utils/demoJob/writer.ts']))) out.push('the writer hands the delete a safety count');
    pins(out, src, [
      ['utils/demoJob/writer.ts', 'const res = await ports.actions().deleteProject(projectId);', 'the delete is no longer called with the id alone'],
      ['utils/demoJob/writer.ts', 'if (stillThere()) return { ok: false, reason: STILL_THERE_REASON };', 'removal no longer stops when the job is still there'],
      ['utils/demoJob/writer.ts', 'deleteProject: (id: string) => Promise<', 'the delete port takes more than the id'],
      ['hooks/useDemoJobPorts.ts', 'deleteProject: (id) => api.deleteProject(id),', 'the port can pass the app\'s delete a count'],
    ]);
    return out;
  } },
  { id: 'H7', what: 'presence is by the builder\'s own id: Finish Creating adds no duplicate of a record the user edited', run: async ({ job, src, tweak }) => {
    const out: string[] = [];
    const makeFakeApp = () => { const a = makeFakeAppRaw(); tweak?.(a); return a; };
    const app = makeFakeApp();
    const first = await createDemoJob(job, app.ports, () => {});
    if (!first.ok) out.push(`create failed: ${JSON.stringify(first.failures)}`);
    const ownIds: [string, string[]][] = [['submittal', job.submittals.map((r) => r.id)], ['permit', job.permits.map((r) => r.id)], ['machine', job.equipment.map((r) => r.id)], ['shift', job.timeEntries.map((r) => r.id)]];
    for (const [what, ids] of ownIds) if (ids.length === 0 || ids.some((id) => !/^[0-9a-f-]{36}$/.test(id))) out.push(`a ${what} has no id of the builder's own`);
    // The user edits the very fields the builder used to look for: a title, a permit number, a serial number, a worker's name and day.
    const edit = (key: 'submittals' | 'permits' | 'equipment' | 'timeEntries', change: Record<string, unknown>) => {
      const rows = app.lists[key] as Record<string, unknown>[];
      const [field, value] = Object.entries(change)[0];
      for (let i = 0; i < rows.length; i += 1) rows[i] = { ...rows[i], ...change, [field]: `${String(value)} ${i}` };
    };
    edit('submittals', { title: 'Retitled by hand' });
    edit('permits', { permitNumber: 'RENUMBERED' });
    edit('equipment', { serialNumber: 'NEW-SERIAL' });
    edit('timeEntries', { workerName: 'Renamed Worker', date: '2020-01-01' });
    // One record really is missing, so this is "Finish Creating".
    app.lists.dailyReports = app.lists.dailyReports.slice(1);
    if ((await demoStatus(job, app.ports)).state !== 'partial') out.push('a job missing one daily report does not read as part way');
    const before = app.adds();
    const again = await createDemoJob(job, app.ports, () => {});
    if (!again.ok || app.adds() - before !== 1) out.push(`finishing made ${app.adds() - before} writes, expected the 1 missing daily report`);
    const want: [string, number, number][] = [['submittals', app.lists.submittals.length, job.submittals.length], ['permits', app.lists.permits.length, job.permits.length], ['equipment', app.lists.equipment.length, job.equipment.length], ['time entries', app.lists.timeEntries.length, job.timeEntries.length], ['daily reports', app.lists.dailyReports.length, job.dailyReports.length]];
    for (const [what, got, n] of want) if (got !== n) out.push(`${what}: ${got} after finishing, expected ${n}`);
    // An edited machine is still the demo's, and still goes when the job is removed.
    await removeDemoJob(job.project.id, app.ports);
    if (app.lists.equipment.length || app.lists.timeEntries.length) out.push('an edited machine or shift was left behind by removal');
    pins(out, src, [
      ['utils/demoJob/writer.ts', "batchArea(ports, 'submittals', job.submittals, (s) => s.id, (w) => idsOf(w.submittals),", 'submittals are no longer found by id'],
      ['utils/demoJob/writer.ts', "byId('permits', job.permits,", 'permits are no longer found by id'],
      ['utils/demoJob/writer.ts', "byId('equipment', job.equipment,", 'equipment is no longer found by id'],
      ['utils/demoJob/writer.ts', "byId('timeEntries', job.timeEntries,", 'shifts are no longer found by id'],
      ['hooks/useDemoJobPorts.ts', 'api.addPermit(permit, { id })', 'the permit is not handed the builder\'s id'],
      ['hooks/useDemoJobPorts.ts', 'api.addEquipment(equip, { id })', 'the machine is not handed the builder\'s id'],
      ['hooks/useDemoJobPorts.ts', '{ ids: subs.map((s) => s.id) }', 'the submittals are not handed the builder\'s ids'],
      ['hooks/useTimeEntries.ts', 'id: args.id ?? generateUUID(),', 'a manual shift ignores the id it is handed'],
      ['contexts/ProjectContext.tsx', 'const newPermit: Permit = { ...permit, id: opts?.id ?? generateUUID(), createdAt: now, updatedAt: now };', 'addPermit ignores the id it is handed'],
      ['contexts/ProjectContext.tsx', 'const newEquip: Equipment = { ...equip, id: opts?.id ?? generateUUID(), createdAt: now };', 'addEquipment ignores the id it is handed'],
      ['contexts/ProjectContext.tsx', 'buildSubmittal(subs[i], working, opts?.ids?.[i])', 'addSubmittals ignores the ids it is handed'],
    ]);
    return out;
  } },
  { id: 'H8', what: 'nothing is offered or written before the project list is read, and a second tap is stopped by a ref', run: async ({ job, src, tweak }) => {
    const out: string[] = [];
    const makeFakeApp = () => { const a = makeFakeAppRaw(); tweak?.(a); return a; };
    const app = makeFakeApp();
    app.set({ ready: false });
    const early = await createDemoJob(job, app.ports, () => {});
    if (early.refused !== 'not_ready' || app.adds() !== 0) out.push('a job was written before the project list was read');
    app.set({ ready: true });
    if (!(await createDemoJob(job, app.ports, () => {})).ok) out.push('a job could not be made once the list was read');
    const screen = codeOf(src['components/demoJob/DemoJobScreen.tsx']);
    if (/if \(phase !== 'idle'\) return;/.test(screen)) out.push('a second tap is stopped by state, which two taps in one frame both pass');
    if (count(screen, 'running.current = true;') !== 2 || count(screen, 'running.current = false;') !== 2) out.push('create and remove do not each take and release the one-at-a-time ref');
    pins(out, src, [
      ['components/demoJob/DemoJobScreen.tsx', 'const running = useRef(false);', 'the one-at-a-time guard is not a ref'],
      ['components/demoJob/DemoJobScreen.tsx', 'if (!ready || running.current) return;', 'Create runs before the list is read, or twice'],
      ['components/demoJob/DemoJobScreen.tsx', 'if (!ready || !named || named.length === 0 || running.current) return;', 'Remove runs before the list is read, or twice'],
      ['components/demoJob/DemoJobScreen.tsx', 'if (!ready) return;', 'the screen reads the account before the list is read'],
      ['components/demoJob/DemoJobScreen.tsx', ") : phase === 'checking' ? null : (", 'the buttons are drawn while the screen is still checking'],
      ['app/demo-job.tsx', 'ready={projectsLoaded}', 'the route does not tell the screen when the project list is read'],
      ['hooks/useDemoJobPorts.ts', 'ready: () => apiRef.current.projectsLoaded,', 'the ports do not know when the project list is read'],
      ['utils/demoJob/writer.ts', "if (!ports.ready()) return { ok: false, failures: [], refused: 'not_ready' };", 'the writer creates before the project list is read'],
    ]);
    return out;
  } },
  // ── I. Owner only ─────────────────────────────────────────────────────────
  { id: 'I1', what: 'owner only, behind one kill switch read in one place', run: ({ src }) => {
    const out: string[] = [];
    if (!demoJobAllowedWith(true, 'omirmajeed2000@gmail.com')) out.push('the owner is refused');
    if (demoJobAllowedWith(true, 'someone@example.com') || demoJobAllowedWith(true, null) || demoJobAllowedWith(true, '')) out.push('a non-owner is allowed with the flag on');
    if (demoJobAllowedWith(false, 'omirmajeed2000@gmail.com')) out.push('the kill switch does not stop the owner');
    if (!/export const DEMO_JOB_BUILDER_ENABLED = true;/.test(src['constants/featureFlags.ts'])) out.push('the flag is missing or off');
    for (const f of [...BUILDER_FILES, 'app/(tabs)/settings/index.tsx', 'app/_layout.tsx']) if (f !== 'utils/demoJob/allowed.ts' && src[f].includes('DEMO_JOB_BUILDER_ENABLED')) out.push(`${f} reads the flag`);
    const route = src['app/demo-job.tsx'];
    const gate = route.indexOf("if (!user?.id || !demoJobAllowed(user.email)) return <Redirect href=\"/(tabs)/(home)\" />;");
    if (gate < 0 || gate > route.indexOf('return <DemoJobBuilder')) out.push('the route does not redirect a non-owner before the builder mounts');
    if (/use(DemoJobPorts|Projects|DemoJobCopy)\(\)/.test(route.slice(route.indexOf('export default function DemoJobRoute'), route.indexOf('function DemoJobBuilder')))) out.push('the route mounts builder hooks before the gate');
    const settings = src['app/(tabs)/settings/index.tsx'];
    if (!/\{demoJobAllowed\(user\?\.email\) \? \(\s*<TouchableOpacity[\s\S]{0,200}router\.push\('\/demo-job'\)/.test(settings)) out.push('the Settings row is not behind the owner check');
    if ((settings.match(/\/demo-job/g) ?? []).length !== 1) out.push('Settings links to the builder more than once');
    if (!src['app/_layout.tsx'].includes('<Stack.Screen name="demo-job"')) out.push('the route is not registered');
    return out;
  } },
  // ── J. Copy ───────────────────────────────────────────────────────────────
  { id: 'J1', what: 'the screen says what it does and what it never does, in English and Spanish', run: ({ src }) => {
    const out: string[] = [];
    const en = EN_SHARD as Record<string, string>;
    const es = ES_OFFICE_DEMO_JOB as Record<string, { s: string; src: string }>;
    if (en['office.demoJob.introBody'] !== 'This creates a made-up job in your account so you can try every screen. Nothing is sent to anyone. Remove it any time.') out.push('the intro sentence changed');
    if (!/No se le envía nada a nadie/.test(es['office.demoJob.introBody']?.s ?? '')) out.push('Spanish does not say nothing is sent');
    if (!/saved on this device only/.test(en['office.demoJob.modelBody'] ?? '')) out.push('the screen does not say the model is device-local');
    if (!/morning brief/.test(en['office.demoJob.briefBody'] ?? '')) out.push('the screen does not warn about the morning brief');
    if (!/offline/.test(en['office.demoJob.offlineBody'] ?? '')) out.push('the screen does not say what offline means');
    if (en['office.demoJob.settingsRowLabel'] !== 'Demo Job (Owner Preview)') out.push('the Settings row label changed');
    for (const k of Object.keys(en)) {
      if (!es[k]) out.push(`no Spanish for ${k}`);
      else if (es[k].src !== sourceHash(en[k])) out.push(`stale Spanish for ${k}`);
      for (const text of [en[k], es[k]?.s ?? '']) if (/—|&|e\.g\.|→|!/.test(text)) out.push(`${k}: a dash, an and sign, an arrow or an exclamation mark`);
    }
    const screen = src['components/demoJob/DemoJobScreen.tsx'];
    for (const key of ['introBody', 'limitsBody', 'modelBody', 'briefBody', 'offlineBody', 'confirmRemoveBody']) if (!screen.includes(`copy.${key}`)) out.push(`the screen does not show ${key}`);
    if (/>\s*[A-Z][a-z]+ [a-z]+[^<{]*</.test(screen.replace(/\{[^}]*\}/g, ''))) out.push('the screen has a hard-coded sentence');
    return out;
  } },
  // ── K. Calendar ───────────────────────────────────────────────────────────
  { id: 'K1', what: 'the calendar is repeatable: weekends, year ends and a later finish give the same job', run: ({ build }) => {
    const out: string[] = [];
    const mkJob = build ?? ((day: string) => buildDemoJob({ userId: USER, projectId: PID, today: day, contractorName: 'Example Builder' }));
    for (const day of ['2026-10-09', '2026-10-10', '2026-10-11', '2027-01-01', '2026-03-08', '2026-11-01', '2028-02-29']) {
      const c = makeDemoClock(day);
      const dow = (d: string) => new Date(`${d}T12:00:00`).getDay();
      if (dow(c.startDate) === 0 || dow(c.startDate) === 6) out.push(`${day}: the job starts on a weekend`);
      if (dow(c.dataDate) === 0 || dow(c.dataDate) === 6 || c.dataDate > day) out.push(`${day}: data date ${c.dataDate}`);
      if (c.dayOf(DATA_DAY) !== c.dataDate || c.dayOf(1) !== c.startDate) out.push(`${day}: ordinals do not match dates`);
      if (demoSeedDayFromStart(c.startDate) !== c.dataDate) out.push(`${day}: the seed day cannot be worked back from the start date`);
      const a = JSON.stringify(dataOf(mkJob(day)));
      const b = JSON.stringify(dataOf(mkJob(c.dataDate)));
      if (a !== b) out.push(`${day}: finishing later would make different records`);
      if (a !== JSON.stringify(dataOf(mkJob(day)))) out.push(`${day}: two builds differ`);
      if (/T\d\d:\d\d:\d\d\.\d{3}Z"/.test(a) === false) out.push(`${day}: no timestamps`);
    }
    const j = mkJob('2026-10-11');
    if (j.dailyReports.some((d) => { const w = new Date(`${d.date}T12:00:00`).getDay(); return w === 0 || w === 6; })) out.push('a daily report falls on a weekend');
    if (j.dailyReports[j.dailyReports.length - 1].date >= j.clock.dataDate) out.push('a daily report is dated today or later');
    return out;
  } },
  // ── L. Living Model ───────────────────────────────────────────────────────
  { id: 'L1', what: 'the Living Model is sound: a typical floor, every room ticked against real tasks, stages said where a title misleads', run: ({ job }) => {
    const out: string[] = [];
    const m = job.model;
    const chk = validateModel(m);
    if (!chk.ok || chk.errors.length || chk.warnings.length) out.push(`the model has issues: ${[...chk.errors, ...chk.warnings].map((i) => i.code).join(', ')}`);
    if (m.rooms.length !== 28 || m.rooms.length > MAX_ROOMS) out.push(`${m.rooms.length} rooms`);
    if (m.rooms.filter((r) => /^Unit 40\d /.test(r.name)).length !== 24) out.push('not eight apartments of three rooms');
    if (JSON.stringify(m).length > MAX_MODEL_CHARS / 4) out.push('the model is large');
    const tasks = new Map(job.project.schedule!.tasks.map((t) => [t.id, t] as const));
    const rooms = new Set(m.rooms.map((r) => r.id));
    for (const [roomId, ids] of Object.entries(m.links)) {
      if (!rooms.has(roomId)) out.push('a link names a room that is not there');
      for (const t of ids) if (!tasks.has(t)) out.push('a room is ticked against a task that is not there');
    }
    for (const r of m.rooms) {
      const linked = (m.links[r.id] ?? []).map((t) => tasks.get(t)!);
      const stages = new Set(linked.map((t) => resolveStage(t.title, t.tradeKey, m.stages?.[t.id]).stage));
      for (const s of ['framing', 'drywall', 'finishes']) if (!stages.has(s as never)) out.push(`${r.name} never reaches ${s}`);
      if (!/^Stair/.test(r.name) && !stages.has('rough_in' as never)) out.push(`${r.name} has no rough-in`);
    }
    const frame = job.project.schedule!.tasks.find((t) => t.title === 'Level 4 Wall Panels and Floor Deck')!;
    if (stageForTask(frame.title, frame.tradeKey).stage === 'framing') out.push('the framing override is no longer needed: remove it');
    if (resolveStage(frame.title, frame.tradeKey, m.stages?.[frame.id]).stage !== 'framing') out.push('wall panels are not drawn as framing');
    if (m.updatedAt !== '') out.push('the model claims a save time before it is saved');
    return out;
  } },
  // ── M. The app's own engines read the job the same way ───────────────────
  { id: 'M1', what: 'job costing, the critical path engine and Job Replay read the job as the generator means it', run: ({ job }) => {
    const out: string[] = [];
    const jc = computeJobCost({ project: job.project, commitments: job.commitments, changeOrders: job.changeOrders });
    // The engine sums unrounded cents; a cent of difference is rounding, a dollar is not.
    const near = (what: string, got: number, want: number) => { if (Math.abs(got - want) > 0.02) out.push(`${what}: ${money(got)}, expected ${money(want)}`); };
    near('job cost budget', jc.budget, BUDGET_COST);
    eq(out, 'job cost committed', jc.committed, job.commitments.reduce((s, c) => s + c.amount + (c.changeAmount ?? 0), 0));
    near('job cost projected final', jc.projectedFinal, projectedFinalCost().total);
    const over = jc.byPhase.filter((p) => p.status === 'over').map((p) => p.phase).sort().join(' | ');
    if (over !== '03 Concrete | 09 Finishes') out.push(`the job cost screen shows over budget: ${over || 'nothing'}`);
    if (jc.byPhase.some((p) => p.status === 'unbudgeted')) out.push('a commitment has no budget line');
    if (jc.byPhase.length !== 23) out.push(`${jc.byPhase.length} budget lines, expected 22 divisions and Change Orders`);
    if (jc.actual <= 0 || jc.actual > jc.committed) out.push('paid to date is not between zero and what is committed');
    const margin = ((CONTRACT_SUM_TO_DATE - jc.projectedFinal) / CONTRACT_SUM_TO_DATE) * 100;
    if (margin < 8 || margin > 10) out.push(`the job cost engine projects a ${margin.toFixed(1)} percent margin`);
    const tasks = job.project.schedule!.tasks;
    const cpm = runCpm(tasks);
    if (cpm.projectFinish !== job.project.schedule!.totalDurationDays) out.push(`the engine finishes on day ${cpm.projectFinish}`);
    if (cpm.conflicts.length) out.push(`${cpm.conflicts.length} schedule conflicts`);
    for (const t of tasks) {
      const r = cpm.perTask.get(t.id);
      if (!r || r.es !== t.startDay) out.push(`${t.title}: the engine starts it on day ${r?.es}`);
      else if (r.isCritical !== !!t.isCriticalPath) out.push(`${t.title}: critical ${t.isCriticalPath}, the engine says ${r.isCritical}`);
    }
    const now = new Date(`${job.clock.dataDate}T10:00:00`);
    const input = buildReplayInput(job.project.schedule, job.dailyReports, now, job.model.stages ?? {});
    if (input.clock.todayOffset !== DATA_DAY || input.clock.totalDays !== job.finishDay || input.futureReports !== 0) out.push(`the replay clock: today ${input.clock.todayOffset}, ${input.clock.totalDays} days`);
    const byId = new Map(input.tasks.map((t) => [t.id, t] as const));
    const room = job.model.rooms[0];
    const linked = (job.model.links[room.id] ?? []).map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
    const seen: string[] = [];
    for (let off = 1; off <= job.finishDay; off += 1) {
      const stage = roomMoment(linked, input.points, off, input.clock, 'planned').stage;
      if (seen[seen.length - 1] !== stage) seen.push(stage);
    }
    // Solid up to today (Level 4 is in drywall), and nothing after today is drawn as built.
    const walk = seen.join(' > ');
    if (walk !== 'not_started > framing > rough_in > insulation > drywall') out.push(`Job Replay walks the room: ${walk}`);
    const end = roomMoment(linked, input.points, job.finishDay, input.clock, 'planned');
    if (!((end.ghost as Record<string, number | null>).finishes ?? 0)) out.push('Job Replay has no finishes planned ahead for the room');
    return out;
  } },
];

// ── planted mutations ───────────────────────────────────────────────────────
type Mut = { rule: string; name: string; plant: (c: Ctx) => Ctx };
const clone = (job: DemoJob): DemoJob => {
  const data = JSON.parse(JSON.stringify(dataOf(job))) as Omit<DemoJob, 'clock' | 'id' | 'input'>;
  return { ...data, clock: job.clock, id: job.id, input: job.input } as DemoJob;
};
const data = (rule: string, name: string, f: (j: DemoJob) => void): Mut => ({ rule, name, plant: (c) => { const job = clone(c.job); f(job); return { ...c, job }; } });
const app = (rule: string, name: string, tweak: (a: FakeApp) => void): Mut => ({ rule, name, plant: (c) => ({ ...c, tweak }) });
const text = (rule: string, name: string, file: string, from: string | RegExp, to: string): Mut => ({ rule, name, plant: (c) => {
  const before = c.src[file];
  const after = before.replace(from, to);
  if (after === before) throw new Error(`nothing to replace in ${file}`);
  return { ...c, src: { ...c.src, [file]: after } };
} });

const MUTATIONS: Mut[] = [
  data('A1', 'a schedule of values line off by a dollar', (j) => { j.project.linkedEstimate!.items[3].lineTotal += 1; }),
  data('A1', 'the estimate total differs from the contract', (j) => { j.project.estimate!.grandTotal -= 1000; }),
  data('A2', 'a pending change order approved', (j) => { j.changeOrders[7].status = 'approved'; }),
  data('A2', 'a change order line off', (j) => { j.changeOrders[0].lineItems[0].total += 50; }),
  data('A3', 'an application bills past the contract sum', (j) => { j.payApps[8].lines[2].thisPeriod += 20_000_000; }),
  data('A3', 'completed work goes down', (j) => { j.payApps[5].lines[2].thisPeriod = -5_000_000; }),
  data('A3', 'line 7 not carried forward', (j) => { j.payApps[4].lessPreviousCertificates = 0; }),
  data('A3', 'a stale total', (j) => { j.payApps[2].totals.currentPaymentDue += 1; }),
  data('A4', 'the open invoice is already due', (j) => { j.invoices[8].dueDate = j.clock.at(DATA_DAY - 5, 9); }),
  data('A4', 'a paid invoice short by retainage', (j) => { j.invoices[1].amountPaid -= 100; j.invoices[1].payments[0].amount -= 100; }),
  data('A4', 'an invoice marked overdue', (j) => { j.invoices[8].status = 'overdue'; }),
  data('A5', 'billing ahead of the schedule', (j) => { for (const t of j.project.schedule!.tasks) t.progress = Math.round(t.progress * 0.8); }),
  data('A6', 'a commitment paid past its value', (j) => { j.commitments[0].paidToDate = j.commitments[0].amount * 2; }),
  data('B1', 'a task starts before its predecessor ends', (j) => { j.project.schedule!.tasks[20].startDay -= 3; }),
  data('B1', 'a dependency on a task that is not there', (j) => { j.project.schedule!.tasks[30].dependencies.push('nope'); }),
  data('B2', 'a finished task with no actual finish', (j) => { delete j.project.schedule!.tasks[5].actualEndDate; }),
  data('B2', 'a future task with progress', (j) => { const t = j.project.schedule!.tasks.find((x) => x.status === 'not_started')!; t.progress = 20; }),
  data('B3', 'a weather delay written with no live reading', (j) => { j.project.schedule!.weatherDelayLog = [{}] as never; }),
  data('B3', 'a late task with its reason removed', (j) => { for (const t of j.project.schedule!.tasks) t.notes = ''; }),
  data('B3', 'startDayBasis forged', (j) => { j.project.schedule!.startDayBasis = 'workingOrdinal'; }),
  data('C1', 'a punch item for a sub that is not there', (j) => { j.punchItems[0].assignedSubId = 'gone'; }),
  data('C1', 'an id used twice', (j) => { j.hazards[1].id = j.hazards[0].id; }),
  data('C1', 'a record on another project', (j) => { j.rfis[0].projectId = 'other'; }),
  data('D1', 'the sample prefix dropped from the name', (j) => { j.project.name = 'Demo: Harbor Point Mixed-Use'; j.project.leadSource = undefined; }),
  data('D1', 'the word Demo dropped from the name', (j) => { j.project.name = 'Sample — Harbor Point Mixed-Use'; }),
  data('D2', 'a real-looking email', (j) => { j.contacts[0].email = 'dana@harborpoint.com'; }),
  data('D2', 'a phone outside 555-01xx', (j) => { j.subcontractors[2].phone = '(410) 555-2345'; }),
  data('D2', 'an email hidden in a note', (j) => { j.rfis[3].question += ' Write to pm@realfirm.com.'; }),
  data('E1', 'a client signature on a change order', (j) => { j.changeOrders[0].approvers = [{ id: 'a', name: 'Dana', email: 'dana.placeholder@example.com', role: 'Client', required: true, order: 1, status: 'approved' }]; }),
  data('E1', 'a signed lien waiver', (j) => { (j.lienWaivers[0] as { status: string }).status = 'signed'; }),
  data('E1', 'a signature on the contract', (j) => { (j.contract as { gcSignature?: unknown }).gcSignature = { name: 'x', role: 'gc', signedAt: 'now' }; }),
  data('E1', 'a verified insurance stamp', (j) => { j.subcontractors[0].coiVerifiedAt = j.clock.at(10, 9); }),
  data('E1', 'an authorized field ticket', (j) => { j.fieldTickets[0].status = 'signed'; }),
  data('E1', 'a toolbox talk sign-in time', (j) => { j.toolboxTalks[0].attendees[0].signedAt = j.clock.at(100, 7); }),
  data('E2', 'weather marked as read from a live source', (j) => { j.dailyReports[4].weather.source = 'openweather'; j.dailyReports[4].weather.isManual = false; }),
  data('E2', 'an OSHA answer on the first-aid note', (j) => { const d = j.dailyReports.find((x) => x.incident)!; d.incident!.oshaRecordable = false; }),
  data('F1', 'the client portal switched on', (j) => { j.project.clientPortal = { enabled: true } as never; }),
  data('F1', 'portal settings that are off but carry a portal id (the server would mint a live portal key)', (j) => { j.project.clientPortal = { enabled: false, portalId: 'demo-1234abcd', invites: [] } as never; }),
  data('F1', 'a portal id hidden on another record', (j) => { (j.contract as unknown as { portalId: string }).portalId = 'demo-1234abcd'; }),
  data('F1', 'an insurance expiry date on a sub', (j) => { j.subcontractors[1].coiExpiry = '2027-01-01'; }),
  data('F1', 'an insurance expiry date on a certificate', (j) => { j.cois[0].coverages![0].expiresAt = '2027-01-01'; }),
  data('F1', 'a client email on the project', (j) => { j.project.primaryContact!.email = 'dana.placeholder@example.com'; }),
  data('F1', 'a bill-to email on an invoice', (j) => { j.invoices[8].billToEmail = 'dana.placeholder@example.com'; }),
  data('F1', 'the job closed', (j) => { j.project.status = 'closed'; }),
  text('F2', 'the writer sends an email', 'utils/demoJob/writer.ts', 'await ports.model.remove(projectId);', 'await ports.model.remove(projectId); await sendEmail({});'),
  text('F2', 'the ports import the notifier', 'hooks/useDemoJobPorts.ts', "import { isOfflineNow } from '@/hooks/useOnline';", "import { isOfflineNow } from '@/hooks/useOnline';\nimport { notify } from '@/utils/notifications';"),
  text('F2', 'time entries by clocking in (which schedules a shift alert)', 'hooks/useDemoJobPorts.ts', 'addManualEntry: time.addManualEntry', 'addManualEntry: time.clockIn'),
  text('F2', 'the builder approves a change order through the approval path', 'utils/demoJob/writer.ts', 'a.addChangeOrders(cs)', 'a.addChangeOrders(cs); void a.approveChangeOrder'),
  text('F2', 'the screen calls a model', 'components/demoJob/DemoJobScreen.tsx', "import { Button } from '@/components/ui';", "import { Button } from '@/components/ui';\nimport { mageAI } from '@/utils/mageAI';"),
  text('F3', 'the reminder function loses its sample skip', 'supabase/functions/invoice-dunning/index.ts', "skip('sample_project')", "skip('x')"),
  text('F3', 'the sample prefix changes', 'utils/projectCap.ts', "export const SAMPLE_PROJECT_PREFIX = 'Sample — ';", "export const SAMPLE_PROJECT_PREFIX = 'Sample - ';"),
  text('F3', 'the insurance check reads every sub', 'supabase/functions/coi-expiry-watch/index.ts', ".not('coi_expiry', 'is', null)", ''),
  ...EXCLUSIONS.map(([file, needle, what]) => text('G2', `${what}: exclusion removed`, file, needle, '/* removed */')),
  data('G1', 'the marker read only from the name (a renamed job would teach)', (j) => { j.project.leadSource = 'referral'; j.project.name = 'Renamed By Hand'; }),
  data('G3', 'a job that is not a sample', (j) => { j.project.name = 'Harbor Point Mixed-Use'; }),
  app('H1', 'an app that gives an invoice a new id (the builder could not find it again)', (a) => {
    const add = a.ports.actions().addInvoice;
    let n = 0;
    a.ports.actions().addInvoice = (i) => { n += 1; if (n > 9) return add({ ...i, id: `again-${n}` }); return add(n === 3 ? { ...i, id: 'lost' } : i); };
  }),
  app('H2', 'an app that keeps two copies of a daily report', (a) => {
    const add = a.ports.actions().addDailyReport;
    let done = false;
    a.ports.actions().addDailyReport = (d) => { add(d); if (!done && a.lists.projects.length) { done = true; a.lists.dailyReports.push({ id: 'twin', projectId: d.projectId }); } };
  }),
  app('H3', 'an app whose queue length cannot be read as full', (a) => { a.ports.queuedWrites = async () => 0; }),
  app('H4', 'an app that will not delete a subcontractor', (a) => { a.ports.actions().deleteSubcontractor = () => undefined; }),
  app('H4', 'an app that keeps the Living Model', (a) => { a.ports.model.remove = async () => undefined; }),
  text('D3', 'a dropped rename said to nobody', 'contexts/ProjectContext.tsx', 'if (demoRenameDropped(prior, updatesIn, rawUpdates)) showAlert(DEMO_RENAME_KEPT_TITLE, DEMO_RENAME_KEPT_REASON);', ''),
  data('E3', 'a review cycle with a reviewer and a result and no disclaimer', (j) => { const c = j.submittals.flatMap((x) => x.reviewCycles ?? []).find((x) => x.comments === REVIEW_TYPED_NOTE)!; delete c.comments; }),
  data('E3', 'a reviewer\'s comment with the disclaimer cut off', (j) => { const c = j.submittals.flatMap((x) => x.reviewCycles ?? []).find((x) => (x.comments ?? '').length > REVIEW_TYPED_NOTE.length)!; c.comments = c.comments!.replace(` ${REVIEW_TYPED_NOTE}`, ''); }),
  ...SERVER_FENCES.map(([file, needle, , what]) => text('F4', `${what}: fence removed`, file, needle, '/* removed */')),
  data('F4', 'a demo sub the assistant connector would list', (j) => { j.subcontractors[0].companyName = 'Harbor Earthwork Co.'; }),
  data('G4', 'a job that is not marked as a demo (the fences must be what keeps it out)', (j) => { j.project.name = 'Harbor Point Mixed-Use'; j.project.leadSource = 'referral'; }),
  text('H5', 'the builder finds its job by the name as well', 'utils/demoJob/writer.ts', 'return world.projects.filter((p) => isStampedDemoProject(p)).map(', 'return world.projects.filter((p) => isDemoProject(p)).map('),
  text('H5', 'the stamp test also accepts the name', 'utils/demoJob/marker.ts', 'return !!project && project.leadSource === DEMO_LEAD_SOURCE;', 'return !!project && (project.leadSource === DEMO_LEAD_SOURCE || isDemoProjectName(project.name));'),
  text('H5', 'removal no longer refuses a job without the stamp', 'utils/demoJob/writer.ts', 'if (project && !isStampedDemoProject(project)) return { ok: false, reason: NOT_THE_BUILDERS_REASON };', ''),
  text('H5', 'Remove loops over every match it can find', 'components/demoJob/DemoJobScreen.tsx', 'for (const p of named) {', 'for (const p of existingDemoProjects(ports.world())) {'),
  text('H5', 'a confirmation that names nothing', 'components/demoJob/DemoJobScreen.tsx', "copy.confirmRemoveBody(confirmJobs.length, confirmJobs.map((j) => j.name).join(', '))", 'copy.confirmRemoveBody(1, \'\')'),
  text('H6', 'the delete is handed this device\'s count again', 'utils/demoJob/writer.ts', 'const res = await ports.actions().deleteProject(projectId);', 'const res = await ports.actions().deleteProject(projectId, { safetyIncidentCount: 0 });'),
  text('H6', 'the sweep runs with the job still there', 'utils/demoJob/writer.ts', 'if (stillThere()) return { ok: false, reason: STILL_THERE_REASON };', ''),
  text('H6', 'the port passes the app\'s delete through whole', 'hooks/useDemoJobPorts.ts', 'deleteProject: (id) => api.deleteProject(id),', 'deleteProject: api.deleteProject,'),
  app('H6', 'an app whose delete is handed a count of zero from the device', (a) => {
    const del = a.ports.actions().deleteProject as unknown as (id: string, opts?: { safetyIncidentCount?: number }) => Promise<{ ok: true } | { ok: false; reason: string }>;
    a.ports.actions().deleteProject = (id) => del(id, { safetyIncidentCount: 0 });
  }),
  text('H7', 'permits found by their number again', 'utils/demoJob/writer.ts', "byId('permits', job.permits,", "listArea(ports, 'permits', job.permits,"),
  text('H7', 'the app\'s add ignores the id it is handed', 'contexts/ProjectContext.tsx', 'const newPermit: Permit = { ...permit, id: opts?.id ?? generateUUID(), createdAt: now, updatedAt: now };', 'const newPermit: Permit = { ...permit, id: generateUUID(), createdAt: now, updatedAt: now };'),
  app('H7', 'an app that gives a permit an id of its own', (a) => {
    const add = a.ports.actions().addPermit;
    let n = 0;
    a.ports.actions().addPermit = (p) => add({ ...p, id: `app-made-${(n += 1)}` });
  }),
  text('H8', 'a second tap stopped by state, not a ref', 'components/demoJob/DemoJobScreen.tsx', 'if (!ready || running.current) return;', "if (phase !== 'idle') return;"),
  text('H8', 'the buttons drawn while still checking', 'components/demoJob/DemoJobScreen.tsx', ") : phase === 'checking' ? null : (", ') : ('),
  text('H8', 'a route that says the list is always read', 'app/demo-job.tsx', 'ready={projectsLoaded}', 'ready'),
  app('H8', 'an app that says its list is read when it is not', (a) => { a.ports.ready = () => true; }),
  { rule: 'K1', name: 'a builder that reads the tap day, not the data date', plant: (c) => ({ ...c, build: (day) => { const j = buildDemoJob({ userId: USER, projectId: PID, today: day, contractorName: 'Example Builder' }); j.project.updatedAt = `${day}T12:00:00.000Z`; return j; } }) },
  text('I1', 'the route mounts the builder for anyone', 'app/demo-job.tsx', "if (!user?.id || !demoJobAllowed(user.email)) return <Redirect href=\"/(tabs)/(home)\" />;", 'if (!user?.id) return null;'),
  text('I1', 'the Settings row shown to every owner-section viewer', 'app/(tabs)/settings/index.tsx', '{demoJobAllowed(user?.email) ? (', '{true ? ('),
  text('I1', 'a second reader of the kill switch', 'app/demo-job.tsx', "import { generateUUID } from '@/utils/generateId';", "import { generateUUID } from '@/utils/generateId';\nimport { DEMO_JOB_BUILDER_ENABLED } from '@/constants/featureFlags';"),
  text('I1', 'the kill switch removed', 'constants/featureFlags.ts', 'export const DEMO_JOB_BUILDER_ENABLED = true;', ''),
  text('J1', 'a hard-coded sentence on the screen', 'components/demoJob/DemoJobScreen.tsx', '<Text style={styles.note}>{copy.whatBody}</Text>', '<Text style={styles.note}>Real data from your account</Text>'),
  text('J1', 'the screen stops saying the model is device-local', 'components/demoJob/DemoJobScreen.tsx', '<Text style={styles.note}>{copy.modelBody}</Text>', ''),
  data('M1', 'a change order subcontract bought against its division (the screen would show a third division over)', (j) => { const c = j.commitments.find((x) => x.number === 'SCO-001')!; c.phase = '31 Earthwork'; }),
  data('M1', 'a task the engine would start on another day', (j) => { j.project.schedule!.tasks[40].startDay += 2; }),
  data('M1', 'the room loses its framing task', (j) => { const r = j.model.rooms[0]; j.model.links[r.id] = j.model.links[r.id].slice(1); }),
  data('L1', 'a room ticked against a task that is not there', (j) => { const k = Object.keys(j.model.links)[0]; j.model.links[k].push('nope'); }),
  data('L1', 'the framing stage override removed', (j) => { delete j.model.stages; }),
  data('L1', 'two rooms on top of each other', (j) => { j.model.rooms[1].placement = { ...j.model.rooms[0].placement }; }),
];

// ── run ─────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
console.log('validate-demo-job: the owner\'s Demo Job\n');
const base: Ctx = { job: mkJob(), src: loadSrc() };
for (const r of RULES) {
  const problems = await r.run(base);
  if (problems.length === 0) { pass += 1; console.log(`  ✓ ${r.id}  ${r.what}`); }
  else { fail += 1; console.log(`  ✗ ${r.id}  ${r.what}`); for (const p of problems.slice(0, 12)) console.log(`        ${p}`); }
}

console.log('\n── planted mutations (each must turn its own rule red)');
const caught = new Set<string>();
for (const m of MUTATIONS) {
  const rule = RULES.find((r) => r.id === m.rule);
  let red = false;
  let how = 'the rule stayed green';
  try {
    if (!rule) throw new Error(`no rule ${m.rule}`);
    red = (await rule.run(m.plant(base))).length > 0;
  } catch (e) {
    // A rule that throws on mutated data has also refused it, but a mutation that cannot be planted is a broken test.
    if (e instanceof Error && /nothing to replace|no rule/.test(e.message)) how = `mutation could not be planted: ${e.message}`;
    else red = true;
  }
  if (red) { pass += 1; caught.add(m.rule); } else { fail += 1; console.log(`  ✗ ${m.rule}  NOT CAUGHT: ${m.name} (${how})`); }
}
console.log(`  ${caught.size} of ${RULES.length} rules caught a planted mutation`);
const unproven = RULES.map((r) => r.id).filter((id) => !caught.has(id));
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

const j = base.job;
console.log(`\n  the job: ${j.project.schedule!.tasks.length} tasks, finish day ${j.finishDay}, contract ${money(CONTRACT_SUM_TO_DATE)}, billed ${j.payApps[8].totals.percentComplete.toFixed(1)}%, schedule ${schedulePercentOn(DATA_DAY)}%, margin ${projectedMarginPercent()}%, last period ends day ${PAY_APP_PERIOD_END[8]}`);
console.log(`\n${fail === 0 ? '✓' : '✗'} validate-demo-job: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
