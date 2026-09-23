// validate-w5-home-clone.ts — audit wave 5, #60: "Duplicate" on Home copies a
// job's scope, never its client, its closeout ticks or its field progress.
//
// The defect: Home built the copy as `{ ...source, <a few resets> }`. The copy
// of 'Smith Kitchen' kept the Smiths as primaryContact — which the lien-waiver
// document prints as property owner and no screen can edit — plus the Handover
// ticks, the schedule's progress / actuals / baselines, the estimate history,
// the QuickBooks customer link and a zoning-confirmed structuredAddress. The fix
// is a WHITELIST (utils/projectClone.cloneProjectAsTemplate); this runs it.
//
// Run: bun run scripts/validate-w5-home-clone.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneProjectAsTemplate, cloneNameFor } from '../utils/projectClone';
import type { Project, ScheduleTask } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const NOW = '2026-09-23T15:00:00.000Z';
const OLD = '2025-11-02T10:00:00.000Z';

function task(id: string, over: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id, title: `Task ${id}`, phase: 'Framing', durationDays: 4, startDay: 3, progress: 0,
    crew: 'Framers', dependencies: [], notes: 'Smith dog bites — text Pat before entering', status: 'not_started', ...over,
  } as ScheduleTask;
}

const source: Project = {
  id: 'src', name: 'Smith Kitchen', type: 'remodel', location: '12 Oak St, Austin, TX',
  squareFootage: 420, quality: 'premium', description: 'Full gut kitchen',
  scope: { projectType: 'remodel', sizeSqft: '420', location: 'Austin', quality: 'high_end', scope: 'gut', timelineWeeks: '8', specialRequirements: '', targetBudget: '90000', updatedAt: OLD },
  primaryContact: { name: 'Pat Smith', phone: '555', email: 'pat@smith.test' },
  leadSource: 'referral', targetTimelineNotes: 'before Thanksgiving',
  structuredAddress: { street: '12 Oak St', city: 'Austin', state: 'TX', zip: '78701', zoningDistrict: 'SF-3', zoningSource: 'confirmed', zoningConfirmedAt: OLD },
  locationLatitude: 30.2, locationLongitude: -97.7, locationGeocodedAt: OLD,
  createdAt: OLD, updatedAt: OLD, status: 'closed', closedAt: OLD,
  substantialCompletionDate: '2025-12-01', warrantyWalkCompletedAt: '2026-11-01', photoCount: 63,
  estimate: null,
  linkedEstimate: { id: 'le1', items: [{ id: 'i1' } as never], globalMarkup: 20, baseTotal: 75000, markupTotal: 15000, grandTotal: 90000, createdAt: OLD },
  estimateVersions: [{ id: 'v1', revNumber: 1, snapshot: {} as never, grandTotal: 88000, reason: 'manual', createdAt: OLD }],
  collaborators: [{ id: 'c1' } as never], ownerUserId: 'someone-else', myRole: 'editor', financialsLoaded: true,
  clientPortal: { portalId: 'P-1', accessToken: 'secret' } as never,
  publicProfile: { enabled: true } as never,
  targetBudget: { amount: 90000, setAt: OLD, setBy: 'gc', note: 'agreed' },
  contractMode: 'gmp', gmpCap: 95000, contractorFeePercent: 12,
  retainagePercent: 10, noticePeriodDays: 7, contractTermsLoaded: true,
  handoverChecklist: { walkthrough: OLD, keys: OLD },
  qboCustomerId: 'QB-9', qboSyncedAt: OLD,
  schedule: {
    id: 'sch-src', name: 'Smith Kitchen schedule', projectId: 'src', startDate: '2025-09-01',
    workingDaysPerWeek: 5, bufferDays: 2, totalDurationDays: 40, criticalPathDays: 38, laborAlignmentScore: 80,
    healthScore: 91, riskItems: [{ id: 'r1', title: 'Smiths away in Oct', detail: '12 Oak St', severity: 'medium' }], activeBaselineId: 'b1',
    baseline: { savedAt: OLD, tasks: [] },
    baselines: [{ id: 'b1', name: 'Original', savedAt: OLD, tasks: [{ id: 't1', startDay: 1, endDay: 4 }] }],
    weatherDelayLog: [{} as never], scenarios: [{ id: 's1', name: 'x', createdAt: OLD, tasks: [] }], activeScenarioId: 's1',
    nonWorkingDates: ['2025-11-27'], updatedAt: OLD,
    tasks: [
      task('t1', {
        startDay: 1, progress: 100, status: 'done', actualStartDay: 1, actualEndDay: 5,
        actualStartDate: '2025-09-01', actualEndDate: '2025-09-05',
        photos: [{ uri: 'x', timestamp: OLD }], subscribers: ['u1'], baselineStartDay: 1, baselineEndDay: 4,
        checklist: [{ id: 'k', label: 'Rebar', done: true }],
        anchorType: 'must-start-on', anchorDate: '2025-09-01', deadline: '2025-09-10',
        sourceEventRef: { feature: 'rfi', id: 'r1' },
      }),
      task('t2', { startDay: 6, durationDays: 7, dependencies: ['t1'], progress: 40, status: 'in_progress', anchorType: 'as-late-as-possible' }),
    ],
  },
} as unknown as Project;
// The field-update path stamps this onto a task without it being on the type.
(source.schedule!.tasks[0] as unknown as Record<string, unknown>).fieldEditedAt = { progress: OLD };

console.log('\ncloneProjectAsTemplate (#60):');
const clone = cloneProjectAsTemplate(source, NOW, { id: 'new-id', name: 'Smith Kitchen (copy)', scheduleId: 'new-sched' });
const c = clone as unknown as Record<string, unknown>;

// ── The old client, and everything that names or bills him ────────────────
for (const k of ['primaryContact', 'leadSource', 'targetTimelineNotes', 'structuredAddress', 'estimateVersions',
  'qboCustomerId', 'qboSyncedAt', 'clientPortal', 'publicProfile', 'collaborators']) {
  ok(`drops ${k}`, c[k] === undefined, JSON.stringify(c[k]));
}
// ── The old job's lifecycle and the loader's per-load stamps ───────────────
for (const k of ['closedAt', 'substantialCompletionDate', 'warrantyWalkCompletedAt', 'photoCount',
  'locationLatitude', 'locationLongitude', 'locationGeocodedAt',
  'ownerUserId', 'myRole', 'financialsLoaded', 'contractTermsLoaded', 'retainagePercent', 'noticePeriodDays']) {
  ok(`drops ${k}`, c[k] === undefined, JSON.stringify(c[k]));
}
ok('handoverChecklist starts empty ({}), nothing ticked on Handover',
  !!clone.handoverChecklist && Object.keys(clone.handoverChecklist).length === 0, JSON.stringify(clone.handoverChecklist));
ok('status is draft, dates are now', clone.status === 'draft' && clone.createdAt === NOW && clone.updatedAt === NOW);
ok('id and name are the caller\'s', clone.id === 'new-id' && clone.name === 'Smith Kitchen (copy)');
ok('default name is "<name> (copy)"', cloneNameFor(source) === 'Smith Kitchen (copy)'
  && cloneProjectAsTemplate(source, NOW, { id: 'x' }).name === 'Smith Kitchen (copy)');

// ── The scope the comment promises ─────────────────────────────────────────
ok('keeps type / location / sf / quality / description',
  clone.type === 'remodel' && clone.location === source.location && clone.squareFootage === 420
  && clone.quality === 'premium' && clone.description === 'Full gut kitchen');
ok('keeps scope and linkedEstimate', clone.scope === source.scope && clone.linkedEstimate === source.linkedEstimate);
ok('keeps the contract model', clone.contractMode === 'gmp' && clone.gmpCap === 95000 && clone.contractorFeePercent === 12);
ok('keeps a GC-set targetBudget', clone.targetBudget?.amount === 90000 && clone.targetBudget?.setBy === 'gc');
{
  const clientBudget = cloneProjectAsTemplate(
    { ...source, targetBudget: { amount: 70000, setAt: OLD, setBy: 'client', clientName: 'Pat Smith', proposalId: 'pp1' } },
    NOW, { id: 'y' });
  ok('drops a CLIENT-proposed targetBudget (the old homeowner\'s number and name)', clientBudget.targetBudget === undefined,
    JSON.stringify(clientBudget.targetBudget));
}
ok('no schedule → null schedule', cloneProjectAsTemplate({ ...source, schedule: null }, NOW, { id: 'z' }).schedule === null);

// ── The schedule: the plan survives, the execution does not ─────────────────
const sch = clone.schedule!;
const s = sch as unknown as Record<string, unknown>;
ok('schedule has the new ids', sch.id === 'new-sched' && sch.projectId === 'new-id');
ok('schedule name follows the copy', sch.name === 'Smith Kitchen (copy) schedule', sch.name);
for (const k of ['startDate', 'activeBaselineId', 'baseline', 'baselines', 'healthScore', 'weatherDelayLog',
  'weatherAlerts', 'scenarios', 'activeScenarioId', 'fragnets']) {
  ok(`schedule drops ${k}`, s[k] === undefined, JSON.stringify(s[k]));
}
ok('schedule keeps the calendar and durations', sch.workingDaysPerWeek === 5 && sch.bufferDays === 2
  && sch.totalDurationDays === 40 && (sch.nonWorkingDates ?? []).join() === '2025-11-27');
const [t1, t2] = sch.tasks;
ok('every task: progress 0, not_started', sch.tasks.every(t => t.progress === 0 && t.status === 'not_started'));
ok('startDay kept EXACTLY (no rebase — the finish-day jump)', t1.startDay === 1 && t2.startDay === 6);
ok('ids, titles, durations and dependencies kept', t1.id === 't1' && t2.title === 'Task t2' && t2.durationDays === 7
  && t2.dependencies.join() === 't1');
const t1r = t1 as unknown as Record<string, unknown>;
for (const k of ['actualStartDay', 'actualEndDay', 'actualStartDate', 'actualEndDate', 'photos', 'subscribers',
  'baselineStartDay', 'baselineEndDay', 'sourceEventRef', 'anchorDate', 'deadline', 'fieldEditedAt', 'anchorType']) {
  ok(`task drops ${k}`, t1r[k] === undefined, JSON.stringify(t1r[k]));
}
ok("every task's free-text notes start empty (they were the old job's — review of #60)",
  sch.tasks.every(t => t.notes === ''), JSON.stringify(sch.tasks.map(t => t.notes)));
ok("the schedule's risk list starts empty (the old job's risks)", Array.isArray(sch.riskItems) && sch.riskItems.length === 0,
  JSON.stringify(sch.riskItems));
ok('checklist items kept, un-ticked', t1.checklist?.length === 1 && t1.checklist[0].done === false && t1.checklist[0].label === 'Rebar');
ok('an ALAP anchor (no date) is plan, and stays', t2.anchorType === 'as-late-as-possible');
ok('the source object is not mutated', source.schedule!.tasks[0].progress === 100
  && (source.schedule!.tasks[0] as unknown as Record<string, unknown>).fieldEditedAt !== undefined
  && source.primaryContact?.name === 'Pat Smith');

// ── Home uses it, behind project-cap's gate ────────────────────────────────
console.log('\nhome duplicate handler:');
const home = readFileSync(join(ROOT, 'app/(tabs)/(home)/index.tsx'), 'utf8');
const code = home.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const dupStart = code.indexOf("if (id !== 'duplicate' || ref.kind !== 'project') return;");
const dup = dupStart >= 0 ? code.slice(dupStart, code.indexOf('addProject(clone);', dupStart)) : '';
ok('the duplicate handler is found', dup.length > 0);
ok('it builds the copy with cloneProjectAsTemplate', /cloneProjectAsTemplate\(source, new Date\(\)\.toISOString\(\), \{/.test(dup));
ok('it no longer spreads the source project', !/\.\.\.source\b/.test(dup), dup);
ok('the cap gate still runs before the copy is built',
  dup.search(/!canCreateProject\(realProjectCount\)/) >= 0
  && dup.search(/!canCreateProject\(realProjectCount\)/) < dup.indexOf('cloneProjectAsTemplate('));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
