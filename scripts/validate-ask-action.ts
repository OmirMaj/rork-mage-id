// scripts/validate-ask-action.ts — Ask MAGE "do it for me" (lane AIDO).
//
// Pins utils/oneMind/askAction.ts: which typed / spoken sentences are requests
// (and for which Copilot capability, on which job, by which schedule route),
// which are questions Ask must keep answering, the how-to offer, and the
// outcome rule that "Saved: …" needs a record in ProjectContext — never a
// navigation. Plus source pins on app/copilot.tsx (the autostart prop and the
// lines other validators already pin) and on askAction.ts staying pure.
//
// Pure imports only. Run: bun run scripts/validate-ask-action.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  detectAskActions,
  howToOffer,
  snapshotForAction,
  actionOutcome,
  refreshPrecondition,
  needsJobPick,
  ASK_ACTION_MAX,
  ASK_ACTION_NOUN_ROWS,
  type AskActionData,
  type AskActionProposal,
  type AskProjectLike,
} from '../utils/oneMind/askAction';
import { INTENTS, SCHEDULE_EDIT_INTENT } from '../utils/copilot/intentTable';
import { PROJECT_FREE } from '../utils/copilot/projectScope';
import { isAppHowTo } from '../utils/oneMind/composePrompt';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}

// ─── fixtures ──────────────────────────────────────────────────────────────

const task = (id: string, title: string) => ({ id, title, startDay: 1, durationDays: 2, dependencies: [] });
const HEN: AskProjectLike = {
  id: 'p-hen', name: 'Henderson Remodel', status: 'in_progress', updatedAt: '2026-09-30T10:00:00Z',
  linkedEstimate: { id: 'est-hen', items: [{ id: 'l1' }], grandTotal: 42000 },
  schedule: { id: 'sch-hen', tasks: [task('t1', 'Rough-in plumbing'), task('t2', 'Drywall hang')] },
};
const LAKE: AskProjectLike = {
  id: 'p-lake', name: 'Lakewood Residence', status: 'in_progress', updatedAt: '2026-09-29T10:00:00Z',
  linkedEstimate: { id: 'est-lake', items: [], grandTotal: 9000 },
  schedule: { id: 'sch-lake', tasks: [task('t9', 'Framing')] },
};
const MAPLE: AskProjectLike = { // has an estimate, no schedule yet
  id: 'p-maple', name: 'Maplewood Kitchen', status: 'estimated', updatedAt: '2026-09-28T10:00:00Z',
  linkedEstimate: { id: 'est-maple', items: [], grandTotal: 5000 }, schedule: null,
};
const OAK: AskProjectLike = { // no estimate, no schedule
  id: 'p-oak', name: 'Oakridge Deck', status: 'estimated', updatedAt: '2026-09-27T10:00:00Z',
  linkedEstimate: null, schedule: null,
};
const ALL = [HEN, LAKE, MAPLE, OAK];

const ids = (list: AskActionProposal[]) => list.map((p) => p.capabilityId).join(',');
const one = (text: string, anchor: string | null = null, projects = ALL) => detectAskActions(text, { projects, anchorProjectId: anchor });

// ─── 1. positives (capability / job / route) ───────────────────────────────
console.log('\nrequests:');
{
  const r = one('create a project for the Henderson kitchen');
  ok('"create a project for the Henderson kitchen" → [new_project]', ids(r) === 'new_project', ids(r));
  ok('… with projectId \'\' (PROJECT_FREE beats the Henderson name match)', r[0]?.projectId === '' && !r[0]?.projectName, JSON.stringify(r[0]));
  ok('… seed is his words, trimmed', r[0]?.seed === 'create a project for the Henderson kitchen');
  ok('… origin request, no precondition', r[0]?.origin === 'request' && r[0]?.precondition.ok === true);
}
{
  const r = one('build the schedule', MAPLE.id);
  ok('"build the schedule" anchored on a job with an estimate and 0 tasks → schedule / build', ids(r) === 'schedule' && r[0]?.schedule?.kind === 'build', JSON.stringify(r[0]?.schedule));
  ok('… on that job, not blocked', r[0]?.projectId === MAPLE.id && r[0]?.precondition.ok === true);
}
{
  const r = one('build the schedule', HEN.id);
  ok('"build the schedule" anchored on a job WITH tasks → build (rebuild-shaped, as the hub routes it)', ids(r) === 'schedule' && r[0]?.schedule?.kind === 'build' && r[0]?.projectId === HEN.id, JSON.stringify(r[0]?.schedule));
}
{
  const r = one('add three tasks after rough-in', HEN.id);
  const s = r[0]?.schedule;
  ok('"add three tasks after rough-in" anchored on a job with tasks → schedule / edit', ids(r) === 'schedule' && s?.kind === 'edit', JSON.stringify(s));
  ok('… the editor gets his words', s?.kind === 'edit' && s.seed === 'add three tasks after rough-in' && s.projectId === HEN.id);
  ok('… the editor needs no estimate (not blocked)', r[0]?.precondition.ok === true);
}
{
  const r = one('add three tasks after rough-in', null);
  const s = r[0]?.schedule;
  ok('the same words with no job named and two running schedules → pick', ids(r) === 'schedule' && s?.kind === 'pick', JSON.stringify(s));
  ok('… the candidates are the two running jobs', s?.kind === 'pick' && s.candidates.map((c) => c.id).sort().join(',') === 'p-hen,p-lake' && s.then === 'edit');
  ok('… no job yet', r[0]?.projectId === '');
}
{
  const r = one('build the schedule', null);
  ok('"build the schedule" with no job named → build with no job (the Copilot\'s own gate picks one)', r[0]?.schedule?.kind === 'build' && r[0]?.projectId === '', JSON.stringify(r[0]?.schedule));
}
{
  const r = one('can you write an RFI about the beam on Henderson');
  ok('"can you write an RFI about the beam on Henderson" → rfi on Henderson', ids(r) === 'rfi' && r[0]?.projectId === HEN.id && r[0]?.projectName === HEN.name, JSON.stringify(r[0]));
}
{
  const r = one("start today's daily report", LAKE.id);
  ok('"start today\'s daily report" anchored → daily_report on the anchor', ids(r) === 'daily_report' && r[0]?.projectId === LAKE.id);
  const curly = one('start today’s daily report', LAKE.id);
  ok('… the curly apostrophe a phone keyboard types too', ids(curly) === 'daily_report');
}
ok('"bill the owner for demo" → invoice', ids(one('bill the owner for demo', HEN.id)) === 'invoice');
ok('"price out the bathroom" → estimate', ids(one('price out the bathroom', HEN.id)) === 'estimate');
{
  const withEst = one('update the estimate', HEN.id);
  const noEst = one('update the estimate', OAK.id);
  ok('"update the estimate" on a job WITH a linked estimate → estimateEdit', ids(withEst) === 'estimateEdit', ids(withEst));
  ok('… labelled "Change the estimate"', withEst[0]?.label === 'Change the estimate');
  ok('… on a job WITHOUT one → estimate', ids(noEst) === 'estimate', ids(noEst));
}
{
  const r = one('log a near miss and add a punch item for the door', HEN.id);
  ok('"log a near miss and add a punch item for the door" → [safety_incident, punch] in order', ids(r) === 'safety_incident,punch', ids(r));
}
const ROWS: [string, string][] = [
  ['add a submittal for the window package', 'submittal'],
  ['send over a shop drawing', ''], // "send" is not a DO verb: stays a question for One Mind
  ['create a shop drawing submittal', 'submittal'],
  ['log a warranty on the roof', 'warranty'],
  ['run a toolbox talk on ladders', 'toolbox_talk'],
  ['start a tailgate talk', 'toolbox_talk'],
  ['create a JHA for the roof tear-off', 'jha'],
  ['write up a job hazard analysis for demo', 'jha'],
  ['add a lead for the Smith basement', 'lead'],
  ['log a new inquiry from the Garcias', 'lead'],
  ['add a permit for the electrical', 'permit'],
  ['log a hazard at the stair opening', 'hazard'],
  ['record an unsafe condition by the trench', 'hazard'],
  ['add a CO for 2 extra days', 'change_order'],
  ['write a change order for the tile upgrade', 'change_order'],
  ['create a request for information about the footing', 'rfi'],
  ['add the cracked tile to the punch list', 'punch'],
  ['log the day', 'daily_report'],
  ['start a daily log', 'daily_report'],
  ['file a DFR', 'daily_report'],
  ['create a progress draw', 'invoice'],
  ['record an injury on site', 'safety_incident'],
  ['make a quote for the deck', 'estimate'],
  ['open a new job for the Parkers', 'new_project'],
  ['set up a new project', 'new_project'],
  ['do the daily report', 'daily_report'],
  ['ok mage, start the schedule', 'schedule'],
  ['please make a timeline', 'schedule'],
];
console.log('\nM2 rows:');
for (const [text, want] of ROWS) {
  const got = ids(one(text, HEN.id));
  ok(`"${text}" → ${want || '[]'}`, got === want, `got ${got || '[]'}`);
}
{
  const r = one('build the schedule', OAK.id);
  const pc = r[0]?.precondition;
  ok('"build the schedule" on a job with no estimate → precondition no_estimate, with the projectScope copy', pc?.ok === false && pc.kind === 'no_estimate' && /no estimate yet/.test(pc.message), JSON.stringify(pc));
}
{
  const r = one('add an RFI and add a punch item and log a near miss and start a daily report', HEN.id);
  ok(`at most ${ASK_ACTION_MAX} workflows from one sentence`, r.length === ASK_ACTION_MAX, ids(r));
}
{
  const r = one('build the schedule and price out the bathroom', HEN.id);
  ok('schedule rows come last (S1)', ids(r) === 'estimate,schedule', ids(r));
}
{
  const r = one('push framing a week', LAKE.id);
  ok('"push framing a week" on a job with a Framing task → the schedule editor', ids(r) === 'schedule' && r[0]?.schedule?.kind === 'edit', JSON.stringify(r));
}
{
  const edit = one('add three tasks after rough-in', HEN.id)[0];
  ok('a schedule EDIT is labelled "Change the schedule" (SCHEDULE_EDIT_INTENT.label)', edit?.label === SCHEDULE_EDIT_INTENT.label, edit?.label);
  const pickEdit = one('add three tasks after rough-in', null)[0];
  ok('… and so is a pick that opens the editor', pickEdit?.schedule?.kind === 'pick' && pickEdit.label === SCHEDULE_EDIT_INTENT.label, pickEdit?.label);
  const build = one('build the schedule', MAPLE.id)[0];
  ok('the builder keeps the INTENTS label "Schedule"', build?.label === INTENTS.find((i) => i.id === 'schedule')?.label, build?.label);
  const starting = one('start building the schedule', HEN.id)[0];
  ok('"start building the schedule" → the builder, with his own words as the seed', starting?.schedule?.kind === 'build' && starting.schedule.seed === 'start building the schedule', JSON.stringify(starting?.schedule));
  const opening = one('open the schedule', HEN.id)[0];
  ok('"open the schedule" on a job with tasks → view it (not the editor)', opening?.schedule?.kind === 'view' && opening.projectId === HEN.id, JSON.stringify(opening?.schedule));
  const openPick = one('open the schedule', null)[0];
  ok('… with no job named and two running → pick, then view', openPick?.schedule?.kind === 'pick' && openPick.schedule.then === 'view', JSON.stringify(openPick?.schedule));
}
{
  const labels = new Map(INTENTS.map((i) => [i.id, i.label]));
  const all = ROWS.map(([t]) => one(t, HEN.id)).flat();
  const editorDoor = (p: AskActionProposal) => p.capabilityId === 'schedule' && (p.schedule?.kind === 'edit' || (p.schedule?.kind === 'pick' && p.schedule.then === 'edit'));
  ok('every label comes from INTENTS (the editor door from SCHEDULE_EDIT_INTENT)', all.every((p) => p.capabilityId === 'estimateEdit' || p.label === (editorDoor(p) ? SCHEDULE_EDIT_INTENT.label : labels.get(p.capabilityId))));
  ok('SCHEDULE_EDIT_INTENT is still the editor label source', SCHEDULE_EDIT_INTENT.label === 'Change the schedule');
}

// ─── 2. negatives (Ask keeps answering) ────────────────────────────────────
console.log('\nquestions and statements (no card):');
const NEG = [
  'Which RFIs are late?',
  'what is my margin on Henderson',
  'is this project over budget?',
  'show me the schedule',
  'how do I create a project',
  'show me how to create a project',
  "don't create a new project",
  'do not create a new project',
  'I created a project yesterday',
  'the schedule slipped',
  'can you tell me when framing finishes',
  'the sub will submit the submittal friday',
  "I'll create the RFI tomorrow",
  'do I have any open punch items?',
  'open the Henderson job',
  'add lead paint abatement to the scope',
  'make sure the schedule is right',
  'x'.repeat(10) + ' create a project ' + 'y'.repeat(590),
];
for (const t of NEG) {
  const r = one(t, HEN.id);
  ok(`"${t.length > 60 ? t.slice(0, 40) + '… (' + t.length + ' chars)' : t}" → []`, r.length === 0, ids(r));
}
ok('the how-to is still a how-to (composePrompt.isAppHowTo)', isAppHowTo('how do I create a project'));

// Every M2 row: at least one positive above and one negative here.
console.log('\nM2 rows — negatives:');
const NEG_BY_ROW: Record<string, string[]> = {
  jha: ['the JHA is done', "we'll write up the JHA later"],
  rfi: ['Which RFIs are late?'],
  change_order: ['add tile to the co', 'did the owner sign the change order?'],
  daily_report: ['the daily report is late', "I'll file the daily report tonight"],
  submittal: ['the sub will submit the submittal friday', 'send over a shop drawing'],
  punch: ['do I have any open punch items?'],
  invoice: ['is the invoice paid?', "don't bill the owner yet"],
  safety_incident: ['was there an incident today?', 'we did not record an incident'],
  toolbox_talk: ['who ran the toolbox talk', "I'll run the toolbox talk monday"],
  hazard: ['the hazard was fixed', "don't log that hazard"],
  warranty: ['when does the roof warranty expire', "never mind, don't add the warranty"],
  permit: ['the permit came back', 'the expediter should file the permit'],
  lead: ['add lead paint abatement to the scope'],
  estimate: ['what does the estimate say', 'the sub will price out the bathroom'],
  schedule: ['show me the schedule', 'make sure the schedule is right'],
  new_project: [
    'open the Henderson job', "don't create a new project",
    'add a photo to the job', 'add a crew to the job', 'make a copy of the job', 'start the Henderson job', 'start a Henderson job', 'set up the job',
  ],
};
for (const [row, list] of Object.entries(NEG_BY_ROW)) {
  for (const t of list) {
    const r = one(t, HEN.id);
    ok(`[${row}] "${t}" → []`, r.length === 0, ids(r));
  }
}
{
  const posRows = new Set(ROWS.map(([, w]) => w).filter(Boolean));
  const missingPos = ASK_ACTION_NOUN_ROWS.filter((id) => !posRows.has(id));
  const missingNeg = ASK_ACTION_NOUN_ROWS.filter((id) => !(NEG_BY_ROW[id]?.length));
  ok(`all ${ASK_ACTION_NOUN_ROWS.length} M2 rows have a positive`, ASK_ACTION_NOUN_ROWS.length === 16 && missingPos.length === 0, missingPos.join(','));
  ok('… and a negative', missingNeg.length === 0, missingNeg.join(','));
}
{
  const keep = one('create a kitchen project for the Parkers');
  ok('"create a kitchen project for the Parkers" is still a new project', ids(keep) === 'new_project', ids(keep));
  const fresh = one('start the new project for the Parkers');
  ok('"start the new project for the Parkers" is still a new project', ids(fresh) === 'new_project', ids(fresh));
}

// ─── 3. how-to offer (M5) ──────────────────────────────────────────────────
console.log('\nhow-to offer:');
{
  const a = howToOffer('how do I create a project', { projects: ALL, anchorProjectId: null });
  ok('"how do I create a project" → new_project offer', a?.capabilityId === 'new_project' && a.origin === 'howto' && a.projectId === '', JSON.stringify(a));
  ok('… hands over no words (the question is not the job)', a?.seed === '');
  const s = howToOffer('how do I build a schedule', { projects: ALL, anchorProjectId: MAPLE.id });
  ok('"how do I build a schedule" → schedule offer (build)', s?.capabilityId === 'schedule' && s.origin === 'howto' && s.schedule?.kind === 'build', JSON.stringify(s));
  ok('"how do I find my invoices" → null', howToOffer('how do I find my invoices', { projects: ALL }) === null);
  ok('a request is not a how-to offer', howToOffer('create a project', { projects: ALL }) === null);
}

// ─── 3b. the job line ("You'll pick the job next") ─────────────────────────
console.log('\njob line:');
{
  const np = one('create a project for the Henderson kitchen')[0];
  ok('a new project never says "pick the job next" (PROJECT_FREE: /copilot shows no picker)', !!np && needsJobPick(np) === false);
  const lead = one('add a lead for the Smith basement')[0];
  ok('… nor does a lead', !!lead && needsJobPick(lead) === false);
  const offer = howToOffer('how do I create a project', { projects: ALL });
  ok('… nor the how-to offer for a new project', !!offer && needsJobPick(offer) === false);
  const rfi = one('write an RFI about the beam', null)[0];
  ok('an RFI with no job named DOES (the Copilot gate picks it)', !!rfi && rfi.projectId === '' && needsJobPick(rfi) === true);
  const rfiJob = one('write an RFI about the beam', HEN.id)[0];
  ok('… but not once the job is known', !!rfiJob && needsJobPick(rfiJob) === false);
  const pick = one('add three tasks after rough-in', null)[0];
  ok('a schedule pick lists the jobs itself (no pick-next line)', !!pick && needsJobPick(pick) === false);
}

// ─── 4. outcome (M6) ───────────────────────────────────────────────────────
console.log('\noutcome:');
const empty = (projects: AskProjectLike[] = ALL): AskActionData => ({
  projects, changeOrders: [], rfis: [], dailyReports: [], punchItems: [], invoices: [], submittals: [], permits: [], leads: [],
});
{
  const p = one('create a project for the Henderson kitchen')[0];
  const before = snapshotForAction(p, empty());
  const after = empty([...ALL, { id: 'p-new', name: 'Henderson Kitchen' }]);
  const o = actionOutcome(p, before, after);
  ok('a new project id appears → saved, labelled with its name, linked to it', o.kind === 'saved' && o.label === 'Henderson Kitchen' && o.href?.pathname === '/project-detail' && o.href.params.id === 'p-new', JSON.stringify(o));
  ok('no change → nothing', actionOutcome(p, before, empty()).kind === 'nothing');
  ok('navigation alone (a route change, the same records) is never saved', actionOutcome(p, snapshotForAction(p, empty()), empty()).kind !== 'saved');
}
{
  const p = one('can you write an RFI about the beam on Henderson')[0];
  const before = snapshotForAction(p, { ...empty(), rfis: [{ id: 'r1', projectId: HEN.id, number: 1, subject: 'Old' }] });
  const other = { ...empty(), rfis: [{ id: 'r1', projectId: HEN.id }, { id: 'r2', projectId: LAKE.id, number: 7, subject: 'Lakewood beam' }] };
  ok('an RFI on ANOTHER job → nothing', actionOutcome(p, before, other).kind === 'nothing');
  const mine = { ...empty(), rfis: [{ id: 'r1', projectId: HEN.id }, { id: 'r3', projectId: HEN.id, number: 2, subject: 'Beam size' }] };
  const o = actionOutcome(p, before, mine);
  ok('an RFI on this job → saved "RFI #2: Beam size", opens the job', o.kind === 'saved' && o.label === 'RFI #2: Beam size' && o.href?.params.id === HEN.id, JSON.stringify(o));
}
{
  const p = one('add three tasks after rough-in', HEN.id)[0];
  const before = snapshotForAction(p, empty());
  const grown: AskProjectLike = { ...HEN, schedule: { id: 'sch-hen', tasks: [...(HEN.schedule!.tasks as unknown[]), task('t3', 'Inspection')] } };
  const o = actionOutcome(p, before, empty([grown, LAKE, MAPLE, OAK]));
  ok('schedule task count changes → saved, links to the schedule', o.kind === 'saved' && o.href?.pathname === '/(tabs)/schedule' && o.href.params.projectId === HEN.id, JSON.stringify(o));
  ok('an editor run that changed nothing claims nothing (unobserved, not "nothing")', actionOutcome(p, before, empty()).kind === 'unobserved');
  const lakeGrew = empty([HEN, { ...LAKE, schedule: { id: 'sch-lake', tasks: [task('t9', 'Framing'), task('t10', 'Roof')] } }, MAPLE, OAK]);
  ok('a schedule change on ANOTHER job is not this one\'s', actionOutcome(p, before, lakeGrew).kind !== 'saved');
  const progressed = empty([{ ...HEN, schedule: { id: 'sch-hen', tasks: [{ ...task('t1', 'Rough-in plumbing'), progress: 60, status: 'in_progress' }, task('t2', 'Drywall hang')] } }, LAKE, MAPLE, OAK]);
  ok('a progress / status update (a teammate\'s sync) is not a saved schedule edit', actionOutcome(p, before, progressed).kind !== 'saved');
  const moved = empty([{ ...HEN, schedule: { id: 'sch-hen', tasks: [{ ...task('t1', 'Rough-in plumbing'), startDay: 6 }, task('t2', 'Drywall hang')] } }, LAKE, MAPLE, OAK]);
  ok('a task moved (same id, same count) IS a saved edit', actionOutcome(p, before, moved).kind === 'saved');
}
{
  const p = one('build the schedule', MAPLE.id)[0];
  const before = snapshotForAction(p, empty());
  ok('builder with no schedule written → nothing', actionOutcome(p, before, empty()).kind === 'nothing');
  const built = empty([HEN, LAKE, { ...MAPLE, schedule: { id: 'sch-maple', tasks: [task('m1', 'Demo')] } }, OAK]);
  {
    const o = actionOutcome(p, before, built);
    ok('builder writes a schedule → saved "Schedule · Maplewood Kitchen"', o.kind === 'saved' && o.label === 'Schedule · Maplewood Kitchen', JSON.stringify(o));
  }
}
{
  const p = one('update the estimate', HEN.id)[0];
  const before = snapshotForAction(p, empty());
  const edited = empty([{ ...HEN, linkedEstimate: { id: 'est-hen', items: [{ id: 'l1' }, { id: 'l2' }], grandTotal: 43500 } }, LAKE, MAPLE, OAK]);
  ok('an estimate edit (same id, new lines) → saved', actionOutcome(p, before, edited).kind === 'saved');
  ok('an estimate left alone → nothing', actionOutcome(p, before, empty()).kind === 'nothing');
}
{
  const p = one('create a JHA for the roof tear-off', HEN.id)[0];
  ok('jha → unobserved (Ask cannot see that record; the card claims nothing)', actionOutcome(p, snapshotForAction(p, empty()), empty()).kind === 'unobserved');
  for (const t of ['log a near miss', 'log a warranty on the roof', 'run a toolbox talk', 'log a hazard at the stairs']) {
    const q = one(t, HEN.id)[0];
    ok(`"${t}" → unobserved`, !!q && actionOutcome(q, snapshotForAction(q, empty()), empty()).kind === 'unobserved');
  }
}
{
  const p = one('add a lead for the Smith basement')[0];
  const o = actionOutcome(p, snapshotForAction(p, empty()), { ...empty(), leads: [{ id: 'L1', name: 'Smith basement' }] });
  ok('lead → saved with its name, no link', o.kind === 'saved' && o.label === 'Smith basement' && !o.href, JSON.stringify(o));
}
{
  const p = one('build the schedule', OAK.id)[0];
  const later = refreshPrecondition(p, [HEN, LAKE, MAPLE, { ...OAK, linkedEstimate: { id: 'est-oak' } }]);
  ok('a card blocked on "no estimate yet" un-blocks once the estimate exists', p.precondition.ok === false && later.precondition.ok === true);
}

// ─── 5. source pins ────────────────────────────────────────────────────────
console.log('\nsource pins:');
const host = src('app/copilot.tsx');
ok('app/copilot.tsx sends the seed as the first turn only on autostart=1', /autoSubmitSeed=\{autostart === '1' && typeof seed === 'string' \? seed : undefined\}/.test(host));
ok('… and still pre-fills the box with the seed', /seed=\{typeof seed === 'string' \? seed : undefined\}/.test(host));
ok('… pin kept: the gate runs before the shell (validate-w5-copilot-scope)', /copilotPrecondition\(capabilityId, project\)/.test(host) && host.indexOf('if (!gateOpen)') < host.indexOf('<CopilotShell'));
ok('… pin kept: the ctx bag (validate-w5-join-screens-wiring / validate-cost-seed)', /canCreateProject: capGate\.canCreate, addProject: gatedAddProject, markupDecided, markup: globalMarkup, receipts, laborSamples, seeds \}/.test(host));
const pure = src('utils/oneMind/askAction.ts');
const importLines = pure.split('\n').filter((l) => /^\s*import\b|\bfrom\s+['"]/.test(l)).join('\n');
ok('askAction.ts imports nothing from react / react-native / mageAI / the registry',
  !/from ['"](react|react-native)['"]/.test(importLines) && !/mageAI/.test(importLines) && !/registry/.test(importLines), importLines);
ok('PROJECT_FREE is still {new_project, lead}', PROJECT_FREE.has('new_project') && PROJECT_FREE.has('lead') && PROJECT_FREE.size === 2);
ok('INTENTS stays 16', INTENTS.length === 16);
const card = src('components/brain/AskActionCard.tsx');
ok('the card shows no success colour', !/\.success|successSoft|successLabel|CheckCircle|Check\b/.test(card));
ok('the card is flat (no gradient, no shadow)', !/LinearGradient|shadowColor|shadowOpacity|elevation:/.test(card));
for (const id of ['ask-action-card', 'ask-action-start', 'ask-action-answer-instead', 'ask-action-status', 'ask-action-open-result', 'ask-action-pick-', 'ask-action-estimate-first']) {
  ok(`testID ${id}`, card.includes(`"${id}`) || card.includes(`\`${id}`));
}
ok('the card\'s "pick the job next" line is needsJobPick (never on a new project / lead)', /needsJobPick\(p\) \? copy\.pickJobNext : null/.test(card));
ok('a blocked Start prints its reason beside it and as the hint', /accessibilityHint=\{blocked \? blockedReason : undefined\}/.test(card) && /\{blockedReason\}<\/Text>/.test(card));
const hook = src('hooks/useAskAction.ts');
ok('the hook never writes (no add/update/save calls)', !/\b(add|update|save|delete)[A-Z]\w*\(/.test(hook.replace(/\/\/.*$/gm, '')));
ok('the hook stores nothing (no AsyncStorage / localStorage)', !/AsyncStorage|localStorage/.test(hook));
ok('the first "saved" outcome is kept (a later record elsewhere never relabels it)', /if \(s\.saved\) return s\.saved;/.test(hook) && /if \(o\.kind === 'saved'\) s\.saved = o;/.test(hook));
ok('Start opens /copilot with autostart only when there are words to send', /seed: p\.seed, autostart: '1'/.test(hook));
const copy = src('hooks/useAskCopy.ts');
ok('every Ask string is keyed under ai.ask.', (copy.match(/\bt\('([^']+)'/g) ?? []).every((m) => m.startsWith("t('ai.ask.")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
