// validate-inspection-prep.ts — Inspection Ready (step 2, lane L3).
//
// Drives the REAL utils/inspectionPrep.ts under bun on a fixed LOCAL clock,
// and reads the sheet / AI source files as text for the honesty pins.
//
// Run via: bun run test:inspection-prep

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREP_DISCLAIMER,
  PREP_STORAGE_KEY,
  PREP_WINDOW_DAYS,
  buildChecklist,
  buildRecallPrompt,
  inspectionCategoryFor,
  punchForPrepItem,
  recordInspectionResult,
  upcomingInspectionsFor,
  type PrepItem,
  type UpcomingInspection,
} from '../utils/inspectionPrep';
import { decodePermitInspectionNotes, encodePermitInspectionNotes, foldCurrentInspection } from '../utils/permitInspectionHistory';
import { inspectionHistoryFactsFor } from '../utils/permitInspectionFacts';
import { groundingFactsFor, resolveCodeJurisdiction } from '../utils/codeJurisdiction';
import { toCalendarDayString } from '../utils/calendarDate';
import type { LinkedEstimateItem, Permit, PermitInspection, Project, ScheduleTask } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}${why ? ` — ${why}` : ''}`); }
}

// ── Fixed LOCAL clock: noon, Fri 25 Sep 2026 ────────────────────────────────
const NOW = new Date(2026, 8, 25, 12);
const day = (offset: number) => toCalendarDayString(new Date(2026, 8, 25 + offset));
const NOW_ISO = NOW.toISOString();

let idSeq = 0;
const newId = () => `id-${++idSeq}`;

const AUTH = 'City of Portland Bureau of Development Services';

function mkProject(over: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Rex St Remodel',
    location: 'Portland, OR',
    ...over,
  } as unknown as Project;
}

function mkPermit(over: Partial<Permit> = {}): Permit {
  return {
    id: 'perm-1',
    projectId: 'proj-1',
    projectName: 'Rex St Remodel',
    type: 'electrical',
    jurisdiction: AUTH,
    status: 'inspection_scheduled',
    appliedDate: '2026-07-01',
    fee: 100,
    ...over,
  } as Permit;
}

function mkTask(over: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id: 'task-1',
    title: 'Task',
    phase: 'General',
    durationDays: 1,
    startDay: 1,
    progress: 0,
    crew: '',
    dependencies: [],
    status: 'not_started',
    ...over,
  } as unknown as ScheduleTask;
}

function mkSchedule(tasks: ScheduleTask[], startDate?: string): NonNullable<Project['schedule']> {
  return {
    id: 'sched-1',
    name: 'Schedule',
    projectId: 'proj-1',
    startDate,
    workingDaysPerWeek: 7,
    totalDurationDays: 10,
    criticalPathDays: 10,
    laborAlignmentScore: 0,
    tasks,
    updatedAt: NOW_ISO,
  } as unknown as NonNullable<Project['schedule']>;
}

function row(over: Partial<PermitInspection>): PermitInspection {
  return { id: `row-${++idSeq}`, name: 'Inspection', scheduledFor: day(-10), result: 'scheduled', recordedAt: NOW_ISO, ...over };
}

function estItem(name: string, csiDivision: string | undefined, category = 'subcontractor'): LinkedEstimateItem {
  return {
    materialId: name, name, category, unit: 'LS', quantity: 1, unitPrice: 1, bulkPrice: 1, markup: 0,
    usesBulk: false, lineTotal: 1, supplier: '', ...(csiDivision ? { csiDivision } : {}),
  } as LinkedEstimateItem;
}

// ═══ 1. upcomingInspectionsFor ═════════════════════════════════════════════
console.log('\n1. upcoming inspections');
{
  ok('PREP_WINDOW_DAYS is 3', PREP_WINDOW_DAYS === 3);
  const p = mkProject();
  const permits = [
    mkPermit({ id: 'd0', phase: 'Rough electrical', inspectionDate: day(0) }),
    mkPermit({ id: 'd3', phase: 'Final electrical', inspectionDate: day(3) }),
    mkPermit({ id: 'd4', phase: 'Too far', inspectionDate: day(4) }),
    mkPermit({ id: 'dm1', phase: 'Yesterday', inspectionDate: day(-1) }),
    mkPermit({ id: 'called', phase: 'Called already', inspectionDate: day(1), status: 'inspection_passed' }),
    mkPermit({ id: 'other-job', projectId: 'proj-2', phase: 'Other job', inspectionDate: day(1) }),
  ];
  const up = upcomingInspectionsFor(p, permits, NOW);
  const names = up.map((u) => u.name);
  ok('day 0 included', names.includes('Rough electrical'));
  ok('day 3 included', names.includes('Final electrical'));
  ok('day 4 excluded', !names.includes('Too far'));
  ok('past day excluded', !names.includes('Yesterday'));
  ok('a head already passed is not upcoming', !names.includes('Called already'));
  ok('another job\'s permit is not this job\'s', !names.includes('Other job'));
  const d0 = up.find((u) => u.name === 'Rough electrical')!;
  ok('permit key = permit:<id>:<day>', d0.key === `permit:d0:${day(0)}`);
  ok('permit authority = jurisdiction trimmed', d0.authority === AUTH);
  ok('daysUntil 0 for today', d0.daysUntil === 0);
  ok('category from the name', d0.category === 'electrical');
  ok('sorted by day', up.every((u, i) => i === 0 || up[i - 1].day <= u.day));
  // A booked head + a differently named scheduled row on the same day: two
  // inspections, two distinct keys (React keys + prep state never shared).
  const twin = upcomingInspectionsFor(p, [mkPermit({ id: 'tw', phase: 'Rough plumbing', status: 'inspection_scheduled', inspectionDate: day(1),
    inspectionNotes: encodePermitInspectionNotes('', [row({ name: 'Framing inspection', scheduledFor: day(1), result: 'scheduled' })]) })], NOW);
  ok('same-day twins: both listed', twin.length === 2);
  ok('same-day twins: distinct keys', new Set(twin.map((u) => u.key)).size === twin.length);
  ok('same-day twins: the head keeps the plain key', twin.some((u) => u.name === 'Rough plumbing' && u.key === `permit:tw:${day(1)}`));

  // A scheduled history row in the window, with no head.
  const withRow = mkPermit({
    id: 'rows', phase: '', inspectionDate: undefined, status: 'approved',
    inspectionNotes: encodePermitInspectionNotes('', [row({ name: 'Underground plumbing', scheduledFor: day(2) })]),
  });
  const up2 = upcomingInspectionsFor(p, [withRow], NOW);
  ok('a scheduled history row is upcoming', up2.length === 1 && up2[0].name === 'Underground plumbing' && up2[0].day === day(2));
  // No name anywhere -> 'Inspection', never the permit type.
  const nameless = upcomingInspectionsFor(p, [mkPermit({ id: 'nn', phase: '', inspectionDate: day(1) })], NOW);
  ok('no phase, no row name -> "Inspection" (never invented from type)', nameless[0]?.name === 'Inspection');
  // Head + same-day scheduled row with the same name collapse.
  const dup = mkPermit({
    id: 'dup', phase: 'Rough electrical', inspectionDate: day(1),
    inspectionNotes: encodePermitInspectionNotes('', [row({ name: 'Rough electrical', scheduledFor: day(1) })]),
  });
  ok('head + same-day same-name row collapse', upcomingInspectionsFor(p, [dup], NOW).length === 1);

  // Schedule tasks.
  const tasks = [
    mkTask({ id: 't-insp', title: 'Framing inspection', startDay: 1 }),
    mkTask({ id: 't-road', title: 'Rough-in plumbing', startDay: 2, sourceEventRef: { feature: 'permitRoadmap', id: 'r1' } }),
    mkTask({ id: 't-done', title: 'Insulation inspection', startDay: 1, status: 'done' }),
    mkTask({ id: 't-100', title: 'Drywall inspection', startDay: 1, progress: 100 }),
    mkTask({ id: 't-plain', title: 'Hang cabinets', startDay: 1 }),
    mkTask({ id: 't-far', title: 'Final inspection', startDay: 6 }),
  ];
  const dated = mkProject({ schedule: mkSchedule(tasks, day(0)) });
  const upT = upcomingInspectionsFor(dated, [], NOW);
  const tNames = upT.map((u) => u.name);
  ok('an "inspection" task on a dated schedule is included', tNames.includes('Framing inspection'));
  ok('a roadmap-tagged task is included', tNames.includes('Rough-in plumbing'));
  ok('a done task is skipped', !tNames.includes('Insulation inspection'));
  ok('a 100% task is skipped', !tNames.includes('Drywall inspection'));
  ok('a task that is not an inspection is skipped', !tNames.includes('Hang cabinets'));
  ok('a task beyond the window is skipped', !tNames.includes('Final inspection'));
  const road = upT.find((u) => u.name === 'Rough-in plumbing')!;
  ok('task key = task:<id>:<day>', road?.key === `task:t-road:${day(1)}`);
  ok('task source carries the task id', road?.source.kind === 'task' && road.taskId === 't-road' && road.taskName === 'Rough-in plumbing');
  ok('task authority null when the address resolves no issuing authority', road?.authority === null);
  const nyc = mkProject({ location: 'Brooklyn, NY', schedule: mkSchedule(tasks, day(0)) });
  ok('task authority from the jobsite address', upcomingInspectionsFor(nyc, [], NOW)[0]?.authority === 'New York City Department of Buildings');

  const undated = mkProject({ schedule: mkSchedule(tasks, undefined) });
  ok('an UNDATED schedule yields no task inspection', upcomingInspectionsFor(undated, [], NOW).length === 0);

  // Permit + task, same day + name (case-insensitive) -> one, the permit.
  const both = mkProject({ schedule: mkSchedule([mkTask({ id: 't-x', title: 'framing INSPECTION', startDay: 1 })], day(0)) });
  const upB = upcomingInspectionsFor(both, [mkPermit({ id: 'px', type: 'building', phase: 'Framing inspection', inspectionDate: day(0) })], NOW);
  ok('duplicates collapse (permit wins)', upB.length === 1 && upB[0].source.kind === 'permit');
}

// ═══ 2. inspectionCategoryFor ═══════════════════════════════════════════════
console.log('\n2. category table');
{
  const table: [string, string | null, string | null][] = [
    ['Rough electrical', null, 'electrical'],
    ['Wiring cover', null, 'electrical'],
    ['Service upgrade', null, 'electrical'],
    ['Panel change', null, 'electrical'],
    ['Water service', null, 'plumbing'],
    ['Gas test', null, 'plumbing'],
    ['Underground drain', null, 'plumbing'],
    ['Rough plumbing', null, 'plumbing'],
    ['Footing', null, 'structural'],
    ['Foundation', null, 'structural'],
    ['Framing', null, 'structural'],
    ['Rebar / slab', null, 'structural'],
    ['Fire blocking', null, 'egress_fire'],
    ['Egress window', null, 'egress_fire'],
    ['Smoke alarms', null, 'egress_fire'],
    ['ADA ramp', null, 'accessibility'],
    ['Accessibility walk', null, 'accessibility'],
    ['Zoning setback', null, 'zoning'],
    ['Site grading', null, 'zoning'],
    ['Final', 'electrical', 'electrical'],
    ['Final', 'plumbing', 'plumbing'],
    ['Rough-in', 'fire', 'egress_fire'],
    ['Final', 'building', null],
    ['Final', null, null],
  ];
  for (const [name, type, want] of table) {
    const got = inspectionCategoryFor(name, type as Permit['type'] | null);
    ok(`"${name}"${type ? ` (${type})` : ''} -> ${want}`, got === want, `got ${got}`);
  }
}

// ═══ 3. history ═════════════════════════════════════════════════════════════
console.log('\n3. history (verbatim)');
const failedNote = 'Missing bonding jumper at water heater';
const historyPermits: Permit[] = [
  mkPermit({ id: 'cur', phase: 'Rough electrical', inspectionDate: day(2) }),
  mkPermit({
    id: 'old', projectId: 'proj-0', projectName: 'Maple St', permitNumber: 'ELE-1',
    status: 'inspection_passed', inspectionDate: day(-30),
    inspectionNotes: encodePermitInspectionNotes('', [
      row({ name: 'Rough electrical', scheduledFor: day(-40), result: 'failed', notes: failedNote }),
    ]),
  }),
  mkPermit({
    id: 'sea', projectId: 'proj-9', projectName: 'Elsewhere', jurisdiction: 'City of Seattle',
    status: 'inspection_failed', inspectionDate: day(-20),
    inspectionNotes: encodePermitInspectionNotes('', [
      row({ name: 'Rough electrical', scheduledFor: day(-20), result: 'failed', notes: 'SEATTLE-ONLY NOTE' }),
    ]),
  }),
];
const upcoming = upcomingInspectionsFor(mkProject(), historyPermits, NOW);
const insp = upcoming.find((u) => u.name === 'Rough electrical')!;
{
  const built = buildChecklist({ inspection: insp, project: mkProject(), permits: historyPermits });
  const facts = inspectionHistoryFactsFor(historyPermits, insp.authority, insp.category);
  const hist = built.items.filter((i) => i.group === 'history');
  ok('history items equal the facts quotes, byte for byte',
    hist.length === Math.min(4, facts.quotes.length) && hist.every((h, i) => h.text === facts.quotes[i].line));
  ok('history has the failed note', hist.some((h) => h.text.includes(`"${failedNote}"`)));
  ok('history why = "From your inspection record"', hist.every((h) => h.why === 'From your inspection record'));
  ok('history quoteDate = quote date', hist.every((h, i) => h.quoteDate === facts.quotes[i].date));
  ok('a permit under another authority is not quoted', !hist.some((h) => h.text.includes('SEATTLE-ONLY NOTE')));
  ok('the history grounding is returned', built.history.kind === facts.kind && built.history.chipLabel === facts.chipLabel);

  const noAuth: UpcomingInspection = { ...insp, authority: null };
  const built2 = buildChecklist({ inspection: noAuth, project: mkProject(), permits: historyPermits });
  ok('no authority -> no history items', built2.items.filter((i) => i.group === 'history').length === 0);
  ok('no authority -> the grounding says why', built2.history.kind === 'unknown' && built2.history.chipLabel.length > 0);

  // cap 4
  const many = [mkPermit({
    id: 'many', projectId: 'proj-0', status: 'approved',
    inspectionNotes: encodePermitInspectionNotes('', [1, 2, 3, 4, 5, 6].map((n) =>
      row({ name: 'Rough electrical', scheduledFor: day(-50 - n), result: 'failed', notes: `note ${n}` }))),
  })];
  ok('history capped at 4', buildChecklist({ inspection: insp, project: mkProject(), permits: many }).items.filter((i) => i.group === 'history').length === 4);
}

// ═══ 4. scope ═══════════════════════════════════════════════════════════════
console.log('\n4. scope (this job\'s estimate)');
const estProject = mkProject({
  linkedEstimate: {
    id: 'e', globalMarkup: 0, baseTotal: 0, markupTotal: 0, grandTotal: 0, createdAt: NOW_ISO,
    items: [
      estItem('Electrical rough-in and trim', '26'),
      estItem('Plumbing rough-in', '22'),
      estItem('200A panel upgrade', undefined, 'material'),
      estItem('Tile floor', '09', 'material'),
      estItem('Framing labor', '06', 'labor'),
    ],
  },
} as Partial<Project>);
{
  const built = buildChecklist({ inspection: insp, project: estProject, permits: [] });
  const scope = built.items.filter((i) => i.group === 'scope');
  ok('electrical scope = the csi-26 line + the panel line', scope.length === 2
    && scope.some((s) => s.text.startsWith('Electrical rough-in and trim'))
    && scope.some((s) => s.text.startsWith('200A panel upgrade')));
  ok('no plumbing / tile / framing line on an electrical inspection', !scope.some((s) => /Plumbing|Tile|Framing/.test(s.text)));
  ok('scope text carries quantity and unit', scope.every((s) => / \(1 LS\)$/.test(s.text)));
  ok('each scope why names its line', scope.every((s) => s.why === `From this job's estimate: ${s.text.replace(/ \(1 LS\)$/, '')}`));
  const plumb: UpcomingInspection = { ...insp, name: 'Rough plumbing', category: 'plumbing' };
  const ps = buildChecklist({ inspection: plumb, project: estProject, permits: [] }).items.filter((i) => i.group === 'scope');
  ok('plumbing scope = only the plumbing line', ps.length === 1 && ps[0].text.startsWith('Plumbing rough-in'));
  const none: UpcomingInspection = { ...insp, name: 'Final', category: null };
  ok('whole-record inspection -> no scope guess', buildChecklist({ inspection: none, project: estProject, permits: [] }).items.filter((i) => i.group === 'scope').length === 0);
}

// ═══ 5. recall ══════════════════════════════════════════════════════════════
console.log('\n5. recall groups');
{
  const built = buildChecklist({
    inspection: insp, project: mkProject(), permits: [],
    recall: {
      items: [
        { text: 'GFCI protection where required', codeRef: 'NEC 2023 210.8', confidence: 'high', why: 'Wet locations' },
        { text: 'Box fill', codeRef: '', confidence: 'med', why: 'Common callback' },
        { text: 'Bonding of metal gas piping', codeRef: '', confidence: 'low', why: 'Not sure it applies' },
      ],
      followUps: [
        { question: 'Any basement bedrooms?', options: ['Yes', 'No', 'Not sure'] },
        { question: 'Bad', options: ['only one'] },
      ],
    },
  });
  const recall = built.items.filter((i) => i.group === 'recall');
  const verify = built.items.filter((i) => i.group === 'verify');
  ok('high + med land in recall', recall.length === 2);
  ok('low confidence lands in verify', verify.length === 1 && verify[0].text === 'Bonding of metal gas piping');
  ok('codeRef kept when the model gave one', recall.find((r) => r.text.startsWith('GFCI'))?.codeRef === 'NEC 2023 210.8');
  ok('codeRef ABSENT when the model gave ""', !('codeRef' in (recall.find((r) => r.text === 'Box fill') ?? {})) && !('codeRef' in verify[0]));
  ok('follow-ups need 2-4 options', built.followUps.length === 1 && built.followUps[0].question === 'Any basement bedrooms?');
  const ids = built.items.map((i) => i.id);
  const again = buildChecklist({ inspection: insp, project: mkProject(), permits: [], recall: {
    items: [{ text: 'Box fill', codeRef: '', confidence: 'med', why: 'x' }], followUps: [] } });
  ok('item ids are stable hashes of group + text', again.items[0].id === built.items.find((i) => i.text === 'Box fill')!.id && new Set(ids).size === ids.length);
  const lots = buildChecklist({ inspection: insp, project: mkProject(), permits: [], recall: {
    items: Array.from({ length: 12 }, (_, n) => ({ text: `item ${n}`, codeRef: '', confidence: n % 2 ? 'low' as const : 'high' as const, why: '' })),
    followUps: [] } });
  ok('recall + verify capped at 8', lots.items.filter((i) => i.group === 'recall' || i.group === 'verify').length === 8);
}

// ═══ 6. prompt ══════════════════════════════════════════════════════════════
console.log('\n6. recall prompt');
const jurisdiction = groundingFactsFor(resolveCodeJurisdiction({ city: 'Seattle', state: 'WA' }));
let samplePrompt = '';
{
  const covered: PrepItem[] = buildChecklist({ inspection: insp, project: estProject, permits: historyPermits }).items;
  const a = buildRecallPrompt({ inspection: insp, project: estProject, jurisdiction, covered, answers: {} });
  samplePrompt = a.prompt;
  ok('no persona / licence line', !/licensed|stake your license|You are a/i.test(a.prompt));
  ok('carries the jurisdiction promptBlock verbatim', a.prompt.includes(jurisdiction.promptBlock));
  ok('names the inspection and day', a.prompt.includes(`INSPECTION: Rough electrical on ${insp.day}`));
  ok('has ALREADY COVERED with the history + scope texts', a.prompt.includes('ALREADY COVERED (do not repeat):')
    && covered.every((c) => a.prompt.includes(c.text)));
  ok('forbids figures', a.prompt.includes('Never state a dimension'));
  ok('says it cannot look anything up', a.prompt.includes('You cannot look anything up.'));
  ok('codeRef only when certain', a.prompt.includes('Give a codeRef only when you are certain of it'));
  ok('max 3 follow-ups rule', a.prompt.includes('Ask at most 3 follow-up questions'));
  const b = buildRecallPrompt({ inspection: insp, project: estProject, jurisdiction, covered, answers: { 'Any basement bedrooms?': 'Yes' } });
  ok('cacheKey changes with the answers', a.cacheKey !== b.cacheKey);
  ok('answers reach the prompt', b.prompt.includes('Any basement bedrooms? Yes'));
  const c = buildRecallPrompt({ inspection: insp, project: estProject, jurisdiction, covered, answers: { b: '2', a: '1' } });
  const d = buildRecallPrompt({ inspection: insp, project: estProject, jurisdiction, covered, answers: { a: '1', b: '2' } });
  ok('cacheKey is order-independent over answers', c.cacheKey === d.cacheKey);
  ok('cacheKey shape', a.cacheKey.startsWith(`inspection_prep::${insp.key}::${jurisdiction.cacheKey}::`));
  const unknownJ = groundingFactsFor(resolveCodeJurisdiction({ city: 'Portland', state: 'OR' }));
  const u = buildRecallPrompt({ inspection: insp, project: estProject, jurisdiction: unknownJ, covered, answers: {} });
  ok('unknown jurisdiction -> leave every codeRef empty', u.prompt.includes('leave every codeRef empty') && !a.prompt.includes('leave every codeRef empty'));
}

// ═══ 7. recordInspectionResult ══════════════════════════════════════════════
console.log('\n7. recording a result');
{
  // head path
  const p = mkPermit({ id: 'h', phase: 'Rough electrical', inspectionDate: day(2) });
  const patch = recordInspectionResult(p, { name: 'Rough electrical', day: day(2), result: 'failed', notes: 'Missing firestop', inspectorName: 'R. Diaz' }, NOW_ISO, newId);
  ok('head path sets status', patch.status === 'inspection_failed');
  ok('head path sets inspectionDate', patch.inspectionDate === day(2));
  const dec = decodePermitInspectionNotes(patch.inspectionNotes);
  ok('head path round-trips through decode', dec.notes === 'Missing firestop'
    && dec.inspections.length === 1 && dec.inspections[0].result === 'failed'
    && dec.inspections[0].notes === 'Missing firestop' && dec.inspections[0].inspectorName === 'R. Diaz');
  ok('inspections returned = decoded rows', JSON.stringify(patch.inspections) === JSON.stringify(dec.inspections));

  // older-day: head untouched, row appended
  const older = recordInspectionResult(p, { name: 'Underground', day: day(-5), result: 'passed', notes: '' }, NOW_ISO, newId);
  ok('older day leaves the head untouched', !('status' in older) && !('inspectionDate' in older));
  const decO = decodePermitInspectionNotes(older.inspectionNotes);
  ok('older day appends one row', decO.inspections.length === 1 && decO.inspections[0].scheduledFor === day(-5) && decO.inspections[0].result === 'passed');

  // an existing failed row + notes survive
  const withFailed = mkPermit({
    id: 'wf', phase: 'Rough electrical', inspectionDate: day(2), status: 'inspection_scheduled',
    inspectionNotes: encodePermitInspectionNotes('', [row({ name: 'Rough electrical', scheduledFor: day(-3), result: 'failed', notes: 'Box fill at J-3' })]),
  });
  const pr = recordInspectionResult(withFailed, { name: 'Rough electrical', day: day(2), result: 'passed', notes: '' }, NOW_ISO, newId);
  const decF = decodePermitInspectionNotes(pr.inspectionNotes).inspections;
  ok('an earlier failed row and its notes survive', decF.some((r) => r.result === 'failed' && r.notes === 'Box fill at J-3' && r.scheduledFor === day(-3)));
  const pr2 = recordInspectionResult(withFailed, { name: 'Other', day: day(-6), result: 'passed', notes: '' }, NOW_ISO, newId);
  ok('...on the history-only path too', decodePermitInspectionNotes(pr2.inspectionNotes).inspections.some((r) => r.result === 'failed' && r.notes === 'Box fill at J-3'));

  // LEGACY called head, no rows, then a new pass on a later day
  const legacy = mkPermit({ id: 'lg', phase: 'Rough electrical', status: 'inspection_failed', inspectionDate: day(-7), inspectionNotes: 'Missing firestop at riser' });
  const lp = recordInspectionResult(legacy, { name: 'Rough electrical', day: day(0), result: 'passed', notes: '' }, NOW_ISO, newId);
  const lrows = decodePermitInspectionNotes(lp.inspectionNotes).inspections;
  ok('legacy head: a failed row for D1 keeps "Missing firestop at riser"',
    lrows.some((r) => r.scheduledFor === day(-7) && r.result === 'failed' && r.notes === 'Missing firestop at riser'));
  ok('legacy head: the new pass is the head', lp.status === 'inspection_passed' && lp.inspectionDate === day(0)
    && lrows.some((r) => r.scheduledFor === day(0) && r.result === 'passed'));
  // A scheduled row on an older day resolves in place (no double row).
  const sched = mkPermit({ id: 'sc', inspectionDate: day(3), inspectionNotes: encodePermitInspectionNotes('', [row({ name: 'Footing', scheduledFor: day(-2), result: 'scheduled' })]) });
  const sp = decodePermitInspectionNotes(recordInspectionResult(sched, { name: 'Footing', day: day(-2), result: 'failed', notes: 'Clean the trench' }, NOW_ISO, newId).inspectionNotes).inspections;
  ok('an older-day scheduled row resolves in place', sp.length === 1 && sp[0].result === 'failed' && sp[0].notes === 'Clean the trench');

  // IDEMPOTENT UNDER THE PERMITS-SCREEN FOLD. Every later save on the permits
  // screen runs foldCurrentInspection(head, phase) — the head we return must
  // already be in the history under its own name, so that fold adds nothing.
  const refold = (base: Permit, patch: Partial<Permit>) => {
    const after = { ...base, ...patch } as Permit;
    const d = decodePermitInspectionNotes(after.inspectionNotes);
    const folded = foldCurrentInspection({
      inspections: d.inspections, status: after.status, inspectionDate: (after.inspectionDate ?? '').slice(0, 10),
      inspectionNotes: d.notes, phase: patch.phase ?? base.phase, inspectorName: after.inspectorName, now: NOW_ISO, newId,
    });
    return { before: d.inspections, folded };
  };
  const same = (a: PermitInspection[], b: PermitInspection[]) => JSON.stringify(a) === JSON.stringify(b);

  // Scenario A: booked 'Rough plumbing' for D+2; a task 'Framing inspection'
  // records Fail on D+2.
  const booked = mkPermit({ id: 'sa', phase: 'Rough plumbing', status: 'inspection_scheduled', inspectionDate: day(2), inspectionNotes: '' });
  const pa = recordInspectionResult(booked, { name: 'Framing inspection', day: day(2), result: 'failed', notes: 'Missing hurricane ties' }, NOW_ISO, newId);
  ok('A: the head is renamed to the inspection that was called', pa.phase === 'Framing inspection' && pa.status === 'inspection_failed');
  const ra = refold(booked, pa);
  ok('A: the booked Rough plumbing row still exists, still scheduled',
    ra.before.some((r) => r.name === 'Rough plumbing' && r.scheduledFor === day(2) && r.result === 'scheduled'));
  ok('A: the failed row is named Framing inspection and carries the note',
    ra.before.some((r) => r.name === 'Framing inspection' && r.result === 'failed' && r.notes === 'Missing hurricane ties'));
  ok('A: the note is on exactly one row', ra.before.filter((r) => r.notes === 'Missing hurricane ties').length === 1);
  ok('A: the permits-screen re-fold adds no row and changes nothing', same(ra.before, ra.folded));
  const factsA = inspectionHistoryFactsFor([{ ...booked, ...pa, inspectionNotes: encodePermitInspectionNotes(decodePermitInspectionNotes(pa.inspectionNotes).notes, ra.folded) } as Permit], AUTH, null);
  ok('A: no fact claims Rough plumbing failed', !JSON.stringify(factsA).includes('Rough plumbing — failed') && !/Rough plumbing[^"]*Missing hurricane ties/.test(JSON.stringify(factsA)));

  // A phase-empty permit whose only history row is a booked 'Rough electrical'.
  const noPhase = mkPermit({ id: 'np', phase: undefined, status: 'inspection_scheduled', inspectionDate: day(2),
    inspectionNotes: encodePermitInspectionNotes('', [row({ name: 'Rough electrical', scheduledFor: day(2), result: 'scheduled' })]) });
  const pn = recordInspectionResult(noPhase, { name: 'Rough electrical', day: day(2), result: 'failed', notes: 'No AFCI' }, NOW_ISO, newId);
  const rn = refold(noPhase, pn);
  ok('phase-empty: the booked row resolves in place (one row)', rn.before.length === 1 && rn.before[0].result === 'failed' && rn.before[0].name === 'Rough electrical');
  ok('phase-empty: the head takes the row name', pn.phase === 'Rough electrical');
  ok('phase-empty: re-fold is a no-op', same(rn.before, rn.folded));

  // A correction of the head itself (same name, same day) stays one row.
  const pc = recordInspectionResult({ ...booked, ...pa } as Permit, { name: 'Framing inspection', day: day(2), result: 'passed', notes: 'Ties installed' }, NOW_ISO, newId);
  const rc = refold({ ...booked, ...pa } as Permit, pc);
  ok('correction: still one Framing row, now passed', rc.before.filter((r) => r.name === 'Framing inspection').length === 1
    && rc.before.some((r) => r.name === 'Framing inspection' && r.result === 'passed'));
  ok('correction: re-fold is a no-op', same(rc.before, rc.folded));
  // A called head on an earlier day survives as its own row when the next one is recorded.
  const pl = recordInspectionResult({ ...booked, ...pa } as Permit, { name: 'Rough plumbing', day: day(3), result: 'passed', notes: '' }, NOW_ISO, newId);
  const rl = refold({ ...booked, ...pa } as Permit, pl);
  ok('later day: the earlier failed Framing row keeps its note', rl.before.some((r) => r.name === 'Framing inspection' && r.result === 'failed' && r.notes === 'Missing hurricane ties'));
  ok('later day: re-fold is a no-op', same(rl.before, rl.folded));
}

// ═══ 8. punchForPrepItem ════════════════════════════════════════════════════
console.log('\n8. punch item');
{
  const item: PrepItem = { id: 'history_x', group: 'history', text: 'Bond the water heater', why: 'From your inspection record' };
  idSeq = 100;
  const pi = punchForPrepItem(item, insp, NOW_ISO, newId);
  ok('id from newId', pi.id === 'id-101');
  ok('projectId = inspection.projectId', pi.projectId === insp.projectId);
  ok('location ""', pi.location === '');
  ok('listType crew (internal)', pi.listType === 'crew');
  ok('assignedSub "" (unassigned)', pi.assignedSub === '');
  ok('dueDate = the day before', pi.dueDate === day(1) && insp.day === day(2));
  ok('description names the inspection', pi.description === 'Before Rough electrical: Bond the water heater');
  ok('priority high for history', pi.priority === 'high');
  ok('status open, timestamps = now', pi.status === 'open' && pi.createdAt === NOW_ISO && pi.updatedAt === NOW_ISO);
  ok('priority medium otherwise', punchForPrepItem({ ...item, group: 'recall' }, insp, NOW_ISO, newId).priority === 'medium');
  ok('no linked task for a permit source', pi.linkedTaskId === undefined);
  const taskInsp: UpcomingInspection = { ...insp, key: 'task:t1:x', source: { kind: 'task', taskId: 't1' }, taskId: 't1', taskName: 'Framing inspection', permitId: null };
  const tp = punchForPrepItem(item, taskInsp, NOW_ISO, newId);
  ok('linkedTaskId / linkedTaskName for a task source', tp.linkedTaskId === 't1' && tp.linkedTaskName === 'Framing inspection');
  const today: UpcomingInspection = { ...insp, day: day(0), daysUntil: 0 };
  ok('an inspection TODAY is due today, never yesterday', punchForPrepItem(item, today, NOW_ISO, newId).dueDate === day(0));
}

// ═══ 9-11. source pins ══════════════════════════════════════════════════════
console.log('\n9-11. source pins');
{
  ok('PREP_DISCLAIMER is exact', PREP_DISCLAIMER === 'Prep list, not a code review. The inspector and the AHJ decide.');
  const sheet = readFileSync(join(ROOT, 'components/inspectionPrep/InspectionReadySheet.tsx'), 'utf8');
  ok('the sheet renders {PREP_DISCLAIMER}', /<Text[^>]*>\{PREP_DISCLAIMER\}<\/Text>/.test(sheet));
  ok('the sheet never renders a model disclaimer', !/\b(recall|answer|res|data|result)\??\.disclaimer\b/.test(sheet));
  const ai = readFileSync(join(ROOT, 'utils/inspectionPrepAI.ts'), 'utf8');
  ok('the recall schema has no disclaimer field', !/disclaimer\s*:/.test(ai));
  ok('PREP_STORAGE_KEY starts with mageid_', PREP_STORAGE_KEY.startsWith('mageid_'));
  ok("inspectionPrepAI.ts contains feature: 'ai_code_check'", ai.includes("feature: 'ai_code_check'"));
  // ...and it is the mageAI CALL that carries it, not a comment.
  const call = /mageAI\(\{([\s\S]*?)\}\)/.exec(ai.replace(/\/\/.*$/gm, ''));
  ok("the mageAI call itself is tagged feature: 'ai_code_check'", !!call && /\bfeature:\s*'ai_code_check'/.test(call[1]));
  ok('the sheet has onRequestClose on its Modal', /<Modal[^>]*onRequestClose=/.test(sheet));
}

if (process.env.PRINT_PROMPT) console.log(`\n--- sample recall prompt ---\n${samplePrompt}\n---`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
