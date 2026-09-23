// scripts/validate-w6a-entry-points.ts — the scheduler AI's ENTRY POINTS after
// audit wave 6 (lane A2). The founder: "I asked it to create multiple new
// tasks, but I got only 1 acknowledged." Lane A fixes the editor itself; this
// pins the doors that lead to it and the builder/mic bugs beside them:
//
//   E7  the Copilot hub sent EVERY schedule request to the builder, which
//       regenerates the plan from the estimate — "add three tasks after
//       rough-in" on a running job now opens the EDITOR on that job, seeded;
//   E6  an iPhone had no AI way to change a running schedule — the phone gets
//       the same "Tell me what to change" bar + ScheduleEditPanel, committing
//       through applyToProjectSchedule + the buildScheduleFromTasks scalars;
//   E8  the global mic's arrays were typed as strings and emptied — the pure
//       half (blank-echo removal, one-update-one-task matching, the edit
//       route) is here; the relay payload is validate-w6a-entry-mageai.ts;
//   B4  build-by-voice threw away the crew, phasing and weather buffer he
//       stated, and any non-empty string skipped the start-date question;
//   B5  Discover › Schedule › "Answer a few quick questions" ran the whole
//       interview and ended on "No project." — the job is now picked first.
//
// Heavy modules (mageAI, the schedule generator) are replaced BEFORE import.
// Run via: bun run scripts/validate-w6a-entry-points.ts

const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
};
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── stand-ins ────────────────────────────────────────────────────────────────
mock.module('@/utils/mageAI', () => ({ mageAI: async () => ({ success: false, data: null }) }));
type Generated = { tasks: { crewSize?: number }[]; schedule: { tasks: { crewSize?: number }[]; bufferDays?: number; startDate?: string } };
// Held in a box: TS narrows a `let` assigned only inside a callback to null.
const box: { generated: Generated | null; constraints?: unknown } = { generated: null };
mock.module('@/utils/autoScheduleFromEstimate', () => ({
  generateScheduleFromEstimate: async (...args: unknown[]) => {
    box.constraints = args[4];
    const tasks = [{ crewSize: 6 }, { crewSize: 2 }, { crewSize: 4 }];
    box.generated = { tasks, schedule: { tasks: tasks.map((t) => ({ ...t })), bufferDays: 3 } };
    return box.generated;
  },
  stashDraft: () => {},
}));

const it = await import('../utils/copilot/intentTable');
const vp = await import('../utils/voiceActionParser');
const ds = await import('../utils/copilot/schedule/dateSignal');
const sc = await import('../utils/copilot/schedule/scheduleCapability');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra: unknown = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra !== '' ? `\n      ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''); }
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const read = (p: string) => strip(readFileSync(join(ROOT, p), 'utf8'));

// The founder's own sentence (the audit's repro).
const ASK = 'Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days';
const job = (id: string, n: number, name = id) => ({ id, name, schedule: n > 0 ? { tasks: Array.from({ length: n }, (_, i) => ({ id: `${id}-t${i}` })) } : null });

// ── E7: the hub's schedule split ─────────────────────────────────────────────
console.log('\nE7 — a schedule request on a job with tasks opens the EDITOR, seeded:');
{
  const r = it.routeScheduleRequest({ text: ASK, projectId: 'henderson', projects: [job('henderson', 47), job('other', 3)] });
  ok('named job with 47 tasks + "add three tasks" → edit that job', r.kind === 'edit' && r.projectId === 'henderson', r);
  ok('…carrying his exact words as the seed', r.kind === 'edit' && r.seed === ASK);
  const b = it.routeScheduleRequest({ text: ASK, projectId: 'empty', projects: [job('empty', 0)] });
  ok('named job with NO tasks → the builder (nothing to edit)', b.kind === 'build' && b.projectId === 'empty' && b.seed === ASK, b);
  const rb = it.routeScheduleRequest({ text: 'Rebuild the schedule from the estimate', projectId: 'henderson', projects: [job('henderson', 47)] });
  ok('"rebuild the schedule" on a running job → the builder, as asked', rb.kind === 'build', rb);
  ok('"create a new schedule" is a rebuild, not an edit', it.routeScheduleRequest({ text: 'create a new schedule for this job', projectId: 'henderson', projects: [job('henderson', 5)] }).kind === 'build');
  ok('a bare tile tap (no words) keeps the builder the tile always opened', it.routeScheduleRequest({ text: '', projectId: 'henderson', projects: [job('henderson', 5)] }).kind === 'build');
  const one = it.routeScheduleRequest({ text: ASK, projectId: '', projects: [job('a', 0), job('henderson', 47)] });
  ok('no job named, ONE running schedule → edit it', one.kind === 'edit' && one.projectId === 'henderson', one);
  const pick = it.routeScheduleRequest({ text: ASK, projectId: '', projects: [job('a', 2, 'Alder St'), job('b', 9, 'Birch Ave'), job('c', 0)] });
  ok('no job named, SEVERAL running → ask which (only jobs with tasks offered)', pick.kind === 'pick' && JSON.stringify(pick.candidates) === JSON.stringify([{ id: 'a', name: 'Alder St' }, { id: 'b', name: 'Birch Ave' }]), pick);
  ok('no job named, none running → the builder (its gate picks a job)', it.routeScheduleRequest({ text: ASK, projectId: '', projects: [job('a', 0)] }).kind === 'build');
  const href = it.scheduleEditHref('henderson', ASK, 'n1');
  ok('the edit route is the Schedule tab with projectId + focus nonce + editSeed', href.pathname === '/(tabs)/schedule' && href.params.projectId === 'henderson' && href.params.focus === 'n1' && href.params.editSeed === ASK, href);
  ok('an arrival opens the editor ONCE (sticky tab params)', it.claimScheduleEditSeed('henderson:n1:x') === true && it.claimScheduleEditSeed('henderson:n1:x') === false && it.claimScheduleEditSeed('henderson:n2:x') === true);
  const TITLES = ['Rough-in electrical', 'Cabinets', 'Drywall hang', 'Framing', 'Trim'];
  ok('edit-shaped: add tasks / push a week / remove a task / move to day 30 (with the job\'s titles)',
    ['Add three tasks after rough-in', 'push cabinets back a week', 'remove the paint task', 'move drywall to day 30', 'insert a milestone before trim', 'push framing a week'].every((u) => it.isScheduleEditUtterance(u, TITLES)));
  ok('not edit-shaped: a rebuild, a question, a daily log',
    !['rebuild the schedule', 'when does framing finish?', 'framed the third floor today'].some((u) => it.isScheduleEditUtterance(u, TITLES)));
  // Review round 1: the mic will ask this BEFORE its own parser, so every
  // other document kind must stay with the parser — even on a running job.
  const OTHER_KINDS = [
    'create an RFI about the beam after framing',
    'add a change order for 2 extra days',
    'delete the punch item in the kitchen',
    'add a note that the inspector came',
    'move the meeting to Tuesday',
    'add an invoice line for 2 days of framing labor',
    'create a submittal for the cabinets before trim',
    'add a CO for 3 more days of drywall',
    'add a new lead, Jane wants a kitchen after the holidays',
  ];
  const leaked = OTHER_KINDS.filter((u) => it.isScheduleEditUtterance(u, TITLES));
  ok('RFI / change order / punch / note / meeting / invoice / submittal / CO / lead never open the schedule editor', leaked.length === 0, leaked);
  ok('an edit verb with no schedule noun and no task of THIS job is not an edit ("push the delivery back a week")',
    !it.isScheduleEditUtterance('push the delivery back a week', TITLES) && !it.isScheduleEditUtterance('push framing a week'));
  ok('"redo the drywall task" is an EDIT of one task; "redo the schedule" is a rebuild',
    it.routeScheduleRequest({ text: 'redo the drywall task', projectId: 'henderson', projects: [job('henderson', 5)] }).kind === 'edit'
    && it.routeScheduleRequest({ text: 'redo the schedule', projectId: 'henderson', projects: [job('henderson', 5)] }).kind === 'build'
    && it.routeScheduleRequest({ text: 'redo the whole plan from scratch', projectId: 'henderson', projects: [job('henderson', 5)] }).kind === 'build');
  const q = it.routeScheduleRequest({ text: 'what is the critical path', projectId: 'henderson', projects: [job('henderson', 5)] });
  ok('a question with no edit verb ("what is the critical path") opens the schedule, not the editor or the builder', q.kind === 'view' && q.projectId === 'henderson', q);
  ok('…but "can you add a task after drywall?" is still an edit', it.routeScheduleRequest({ text: 'can you add a task after drywall?', projectId: 'henderson', projects: [job('henderson', 5)] }).kind === 'edit');
  const qp = it.routeScheduleRequest({ text: 'when does framing finish?', projectId: '', projects: [job('a', 2, 'Alder St'), job('b', 9, 'Birch Ave')] });
  ok('a question with several running jobs asks which, then OPENS it (then: view)', qp.kind === 'pick' && qp.then === 'view', qp);
  ok('the edit pick opens the editor (then: edit)', pick.kind === 'pick' && pick.then === 'edit');
  const vh = it.scheduleViewHref('henderson', 'n9');
  ok('the view route clears a sticky seed (editSeed: \'\') so it can never reopen an old edit', vh.pathname === '/(tabs)/schedule' && vh.params.projectId === 'henderson' && vh.params.editSeed === '', vh);
  ok('INTENTS is unchanged (16) — the split is about the JOB, which the classifier cannot see', it.INTENTS.length === 16 && it.INTENTS.some((i) => i.id === 'schedule'));
}

const hub = read('app/copilot-hub.tsx');
ok('the hub routes a classified `schedule` through the split, not straight to /copilot',
  /o\.action\.capabilityId === 'schedule'\) goSchedule\(scheduleRoute\(o\.action\.text\), 'replace'\)/.test(hub));
ok('queue cards and tiles take the same split', /if \(capabilityId === 'schedule'\) \{ goSchedule\(scheduleRoute\(seed\), 'push'\); return; \}/.test(hub));
ok('an edit route opens scheduleEditHref; several running jobs show a picker', /r\.kind === 'edit'\) \{[^}]*scheduleEditHref\(r\.projectId, r\.seed\)/.test(hub) && /copilot-hub-schedule-pick/.test(hub));
{
  // Review round 2 (iPhone): the hub is a native modal; a '(tabs)' push from
  // inside it lands UNDER the sheet and the editor Modal is refused by UIKit.
  const n = (kind: string, how: 'push' | 'replace', platform: string, canGoBack = true) =>
    it.hubScheduleNav({ kind: kind as never, how, platform, canGoBack });
  ok('iOS/Android: an edit or view arrival dismisses the hub, THEN navigates (tile, queue card, pick card, submit)',
    ['ios', 'android'].every((p) => ['edit', 'view'].every((k) => n(k, 'push', p) === 'dismiss-then-push' && n(k, 'replace', p) === 'dismiss-then-push')));
  ok('…with nothing behind the hub (cold deep link) it is replaced, never pushed under itself', n('edit', 'push', 'ios', false) === 'replace');
  ok('the builder (itself a modal) and the web keep what they did',
    n('build', 'push', 'ios') === 'push' && n('build', 'replace', 'ios') === 'replace' && n('edit', 'push', 'web') === 'push' && n('edit', 'replace', 'web') === 'replace');
  ok('the wait is the codebase\'s iOS guard (350ms), none elsewhere', it.MODAL_DISMISS_DELAY_MS('ios') === 350 && it.MODAL_DISMISS_DELAY_MS('android') === 0);
  ok('the hub uses it: back() first, then push after the delay',
    /hubScheduleNav\(\{ kind: r\.kind, how, platform: Platform\.OS, canGoBack: router\.canGoBack\(\) \}\)/.test(hub)
    && /mode === 'dismiss-then-push'\) \{\s*router\.back\(\);\s*setTimeout\(\(\) => router\.push\(href\), MODAL_DISMISS_DELAY_MS\(Platform\.OS\)\);/.test(hub));
}
{
  // Review round 3: on iPhone a schedule card that opens the Schedule tab
  // dismisses the hub, and the other queued cards live only in its state.
  // "Add three tasks after rough-in and invoice the owner for demo" — tapping
  // the schedule card first lost the invoice. Schedule cards go LAST.
  const { hubOutcome, scheduleCardsLast, SCHEDULE_CARD_LAST_COPY } = await import('../utils/copilot/hubRouting');
  const q = hubOutcome({ actions: [
    { capabilityId: 'schedule', text: 'add three tasks after rough-in', label: 'Add tasks' },
    { capabilityId: 'invoice', text: 'invoice the owner for demo', label: 'Invoice demo' },
    { capabilityId: 'rfi', text: 'RFI on the beam', label: 'RFI' },
  ] }, 'Add three tasks after rough-in and invoice the owner for demo, and an RFI on the beam');
  ok('the queue lists the schedule card LAST, the others in spoken order',
    q.kind === 'queue' && q.actions.map((a) => a.capabilityId).join() === 'invoice,rfi,schedule', q);
  ok('scheduleCardsLast is stable and leaves a queue with no schedule card alone',
    scheduleCardsLast([{ capabilityId: 'rfi', text: 'a', label: 'a' }, { capabilityId: 'punch', text: 'b', label: 'b' }]).map((a) => a.text).join() === 'a,b');
  ok('the schedule card that leaves the hub says to handle the others first',
    /const leavesHub = a\.capabilityId === 'schedule' && \['edit', 'view'\]\.includes\(scheduleRoute\(a\.text\)\.kind\)/.test(hub)
    && /\{leavesHub && <Text[^>]*testID="copilot-hub-queue-schedule-last">\{SCHEDULE_CARD_LAST_COPY\}<\/Text>\}/.test(hub)
    && /handle the others first/.test(SCHEDULE_CARD_LAST_COPY));
}
ok('the split sees the job list (routeScheduleRequest over his projects)', /routeScheduleRequest\(\{\s*text: seed,\s*projectId: projectId \?\? '',\s*projects: projectId \? projects : pickableProjects\(projects\)/.test(hub));

// ── E6: the phone gets the editor ────────────────────────────────────────────
console.log('\nE6 — iPhone: "Tell me what to change" + ScheduleEditPanel:');
const mob = read('components/schedule/mobile/MobileScheduleScreen.tsx');
ok('ScheduleEditPanel is mounted on the phone screen', /<ScheduleEditPanel[\s\S]{0,400}commit=\{commitAiEdit\}/.test(mob));
ok('…fed the stored tasks and the memoised cpm options its preview runs on', /<ScheduleEditPanel[\s\S]{0,400}tasks=\{tasks\}[\s\S]{0,120}cpmOptions=\{editCpmOptions\}/.test(mob) && /const editCpmOptions = useMemo\(/.test(mob));
{
  const body = mob.slice(mob.indexOf('const commitAiEdit = useCallback'), mob.indexOf('const onUpdateTask = useCallback'));
  ok('the commit reflows through applyToProjectSchedule (dependents move, critical path stamped)', /applyToProjectSchedule\(activeSchedule, nextTasks, editCpmOptions\)\.tasks/.test(body));
  ok('…and recomputes the derived scalars with buildScheduleFromTasks + the live finish', /buildScheduleFromTasks\([\s\S]*criticalPathDays: cpmAfter\.projectFinish/.test(body) && /totalDurationDays: built\.totalDurationDays/.test(body) && /criticalPathDays: built\.criticalPathDays/.test(body));
  ok('…keeping every sidecar field of the schedule (spread, not rebuilt)', /\.\.\.activeSchedule,\s*tasks: reflowed/.test(body));
  ok('…refusing out loud on field / view-only access instead of writing a change the server drops', /if \(writePath !== 'row'\) \{[\s\S]*setFieldNotice\(/.test(body));
  ok('…and writing one History row for the AI change', /describeMobileScheduleEdit\([\s\S]*reason: 'AI schedule change'/.test(body) && /appendAuditToAsyncStorage/.test(body));
  ok('it does NOT go through saveTasks (which keeps stored startDays and drops the previewed ripple)', !/saveTasks\(/.test(body));
}
ok('the bar is shown to owner / editor only, on a schedule with tasks', /writePath === 'row' && \(\s*<TouchableOpacity\s+style=\{styles\.copilotBar\}/.test(mob) && /mobile-schedule-copilot-bar/.test(mob));
ok('a hub arrival (editSeed) opens the editor once, on the routed job', /routeEditSeed/.test(mob) && /claimScheduleEditSeed\(`\$\{routeProjectId\}:\$\{routeFocus \?\? ''\}:\$\{routeEditSeed\}`\)/.test(mob) && /seed=\{editSeed\}/.test(mob));
const tab = read('app/(tabs)/schedule/index.tsx');
ok('the tablet / web Schedule tab honours the same editSeed arrival', /claimScheduleEditSeed\(/.test(tab) && /seed=\{editSeed\}/.test(tab) && /refuseScheduleWrite\('AI schedule change'\)/.test(tab));
// Review round 4: the claim lives in module memory, so on the web (the seed in
// the query string) a reload re-opened the editor pre-filled. Each host clears
// the param right after claiming it.
{
  const claimThenClear = /claimScheduleEditSeed\([^\n]*\)\) return;\n(?:\s*\/\/[^\n]*\n)*\s*navigation\.setParams\(\{ editSeed: '' \} as never\);/;
  ok('the phone clears editSeed from the route once claimed', claimThenClear.test(mob));
  // A reload empties module memory: simulate one with a second module instance
  // over the same web storage.
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  // A query suffix gives a fresh module instance (Bun); a variable path keeps
  // tsc from trying to resolve the suffixed specifier.
  const intentPath = '../utils/copilot/intentTable.ts';
  const pageA = (await import(`${intentPath}?reload=a`)) as typeof import('../utils/copilot/intentTable');
  const pageB = (await import(`${intentPath}?reload=b`)) as typeof import('../utils/copilot/intentTable');
  const arrival = 'henderson:n9:Add three tasks after rough-in';
  ok('a reload of the same arrival does not re-open the editor (claim kept in web storage)', pageA.claimScheduleEditSeed(arrival) === true && pageB.claimScheduleEditSeed(arrival) === false);
  ok('…a NEW arrival (new focus nonce) still opens it after a reload', pageB.claimScheduleEditSeed('henderson:n10:Add three tasks after rough-in') === true);
  ok('…the stored claim is a hash under mageid_, never his words', [...mem.keys()].join() === 'mageid_claimed_edit_seeds' && !/rough-in/.test(mem.get('mageid_claimed_edit_seeds') ?? ''));
  delete (globalThis as { localStorage?: unknown }).localStorage;
  ok('the tablet / web tab clears editSeed from the route once claimed', claimThenClear.test(tab));
}
const panel = read('components/copilot/ScheduleEditPanel.tsx');
ok('ScheduleEditPanel forwards `seed` to CopilotShell (lane A surface the hub and mic depend on)', /seed/.test(panel) && /<CopilotShell[\s\S]{0,400}seed=\{seed\}/.test(panel));

// ── E8: the global mic (pure half) ───────────────────────────────────────────
console.log('\nE8 — the mic: blank echoes, one update → one task, add-task → editor:');
{
  const base = { kind: 'field_update', lineItems: [{ name: '', description: '', quantity: 1, unit: 'lump', unitPrice: 0, priceStated: false }], invoiceLineItems: [], fieldTimeEntries: [{ trade: '', hours: 0, notes: '' }, { trade: 'Framing', hours: 6, notes: '' }], fieldScheduleUpdates: [{ taskName: '', progressPercent: 0 }, { taskName: 'framing', progressPercent: 80 }], fieldMaterials: ['', '40 sheets drywall'] } as never;
  const c = vp.dropBlankVoiceEntries(base) as { lineItems: unknown[]; fieldTimeEntries: unknown[]; fieldScheduleUpdates: unknown[]; fieldMaterials: string[] };
  ok('an echoed blank example is never filed (line item, hours row, progress row, material)', c.lineItems.length === 0 && c.fieldTimeEntries.length === 1 && c.fieldScheduleUpdates.length === 1 && c.fieldMaterials.join() === '40 sheets drywall', c);
  const tasks = [{ id: 'd1', title: 'Drywall hang' }, { id: 'd2', title: 'Drywall tape' }, { id: 'f', title: 'Framing' }, { id: 'p', title: 'Prime and paint' }];
  const m = vp.matchFieldScheduleUpdates(tasks, [{ taskName: 'framing', progressPercent: 100 }, { taskName: 'drywall', progressPercent: 80 }, { taskName: 'roofing', progressPercent: 50 }, { taskName: 'paint', progressPercent: 30 }, { taskName: 'Drywall Tape', progressPercent: 140 }]);
  ok('"framing" → Framing only', m.matched.some((x) => x.taskId === 'f' && x.pct === 100));
  ok('"drywall" fits two tasks → ambiguous, NOT applied to both', m.ambiguous.length === 1 && m.ambiguous[0].candidates.length === 2 && !m.matched.some((x) => x.taskId === 'd1'), m);
  ok('"roofing" names nothing → reported, not dropped', JSON.stringify(m.unmatched) === JSON.stringify(['roofing']));
  ok('an exact title wins and % is clamped to 100', m.matched.some((x) => x.taskId === 'd2' && x.pct === 100));
  ok('"paint" → the one task containing it', m.matched.some((x) => x.taskId === 'p' && x.pct === 30));
  const route = vp.scheduleEditRouteForTranscript(ASK, { id: 'henderson', schedule: { tasks: [{ title: 'Rough-in electrical' }] } } as never);
  ok('"add three tasks…" into the mic on a running job → the editor route, seeded', !!route && route.params.projectId === 'henderson' && route.params.editSeed === ASK);
  ok('…but not on a job with no schedule, and not for a daily log', vp.scheduleEditRouteForTranscript(ASK, { id: 'x', schedule: { tasks: [] } } as never) === null && vp.scheduleEditRouteForTranscript('framed the third floor, 6 hours', { id: 'h', schedule: { tasks: [{ title: 'Framing' }] } } as never) === null);
  const running = { id: 'h', schedule: { tasks: [{ title: 'Framing' }, { title: 'Drywall hang' }] } } as never;
  ok('…and never for an RFI / change order / punch item on that running job',
    ['create an RFI about the beam after framing', 'add a change order for 2 extra days', 'delete the punch item in the kitchen'].every((u) => vp.scheduleEditRouteForTranscript(u, running) === null));
  // Review round 2: the mic asks this BEFORE its parser, so a false yes
  // throws away a field log. Task-title matching is gone from the mic path —
  // only an explicit schedule noun + an edit verb opens the editor.
  const field = { id: 'h', schedule: { tasks: ['Demo', 'Rough framing', 'Plumbing rough-in', 'Electrical rough-in', 'Drywall hang', 'Drywall tape', 'Cabinets install', 'Tile install', 'Prime and paint', 'Concrete pour', 'Deck framing', 'Roofing', 'Final clean'].map((title) => ({ title })) } } as never;
  const FIELD_TALK = [
    'add 6 hours framing today',
    'add eight hours for the tile guys',
    'we cut the tile in the master bath today',
    'cut and hung drywall in the basement, about half done',
    'drywall hang is done, move the crew to tape tomorrow',
    'move the dumpster before the concrete pour',
    'extend the deck four feet, owner wants it bigger',
    'add a window in the basement and extend the deck, six grand total',
    'add 40 sheets of drywall delivered',
    'framing inspection passed, add that',
    'push framing a week',
    'add 6 hours to the framing task',
    'the drywall task is 80% done',
    'move the drywall task, it is finished',
    // critic 2's field dictation (a task word, an edit verb, no schedule noun)
    'Add that the drywall delivery came in this morning',
    'We cut in the windows and started insulation',
    'Second shift finished the drywall tape on the upper floor',
    'Had to move the dumpster so the countertops truck could get in',
    'Electrician will pull wire for the electrical rough-in tomorrow',
    'Put in the kitchen cabinets today, cabinet install is about half done',
    // daily-log status talk that names the schedule without asking to change it
    'tile guys are behind schedule, we cut the master bath today',
    'framing is on schedule, add a note that the crane left',
    'we are ahead of schedule so we moved the crew to the deck',
    // time, material, progress and daily-log dictation in plain words
    'log 8 hours for Mike on framing',
    'got 30 bags of thinset and 12 boxes of tile',
    'plumbing rough-in is at 60 percent',
    'daily log: rain in the morning, drywall crew started at noon',
    // Review round 3 (critic's scratch run of the round-2 rule): a bare 'log',
    // 'level' as a FLOOR, and a delay REPORTED in a daily log all went to the
    // editor. The mic now routes only an imperative add of new tasks.
    'Add to the log that the framing crew started the roof task',
    'Put in the log that the schedule slipped because of rain',
    'Add to today\'s log: drywall crew started the second floor task',
    'Main level drywall is going up, schedule is tight',
    'Crew is working on level 2 today, the pour task starts tomorrow',
    'Electrician on level 1 pulling wire, the schedule looks good',
    'Lower level is framed, upper level starts Monday per the schedule',
    'Rain all day, site shut down, this will push the schedule a day',
    'Inspector did not show, that will delay the schedule',
    'Framing crew called out today, this is going to push the schedule',
    'Lumber is late again, might have to shift the schedule',
    'Move the crew to the tape task tomorrow',
    'Pull two guys off framing and put them on the drywall task',
    'Add to the schedule notes that the crane is coming Thursday',
    'Drop off the lift on level 2 for the drywall schedule',
    // …and the round-2 edits that are not adds go back to the parser, as at
    // 6065b326 (it files "push framing a week" as a schedule field update).
    'push the cabinets task back a week',
    'remove the paint task',
    'move the tile activity to day 30',
    // Review round 4 (critic's run of the round-3 rule on an owner seat):
    // "activity" is a daily-log word, and a task / milestone noun followed by
    // a log, progress or time word is dictation.
    'Add an activity: framing crew installed the second floor joists',
    'Add activities for today: poured footings, set anchor bolts',
    'Create an activity log entry: plumber finished rough-in on level 2',
    'Add task progress: drywall hang is 80 percent, framing done',
    'Add task time: 6 hours framing for Joe',
    'Add tasks done today: framing and sheathing',
    'Add milestone reached: framing inspection passed today',
    'add tasks completed today: framing and blocking',
    // Review round 5 (critic's mic-route3 run on an owner seat): the log word
    // sits AFTER a comma, a dash or "we", where the task-noun lookahead can't
    // see it. The whole-utterance marker (MIC_LOG_MARKER) refuses them.
    'Add tasks we did today: framing, sheathing, 8 hours',
    'Add tasks — framing crew 8 hours, drywall delivered',
    'Okay add a task, we got the drywall delivered today, 40 sheets',
    'Add a new task, framing is 80 percent done',
    'Add tasks we finished today: framing and sheathing',
    'Add task complete: framing',
    'Add milestone: framing inspection passed',
  ];
  const swallowed = FIELD_TALK.filter((u) => vp.scheduleEditRouteForTranscript(u, field) !== null);
  ok('field talk on a running job (hours, done, %, delivered, log, level, a delay report, push/move/remove) stays with the parser', swallowed.length === 0, swallowed);
  const EDITS = [
    'add a task after drywall hang',
    'insert a milestone before trim',
    'Please add two new tasks after framing',
    'Can you add a task for the final walkthrough',
    'add tasks for drywall hang and tape after rough-in',
    'okay, add another task after paint: touch-up 2 days',
    "let's add 3 tasks after rough-in",
    'create a new milestone for substantial completion',
    // Round 4 widening: "schedule", "add in", "throw in" as the verb.
    'Schedule three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days',
    'Add in two tasks after framing: blocking 1 day, sheathing 2 days',
    'Throw in a task after drywall hang: sand 1 day',
  ];
  const missed = EDITS.filter((u) => !vp.scheduleEditRouteForTranscript(u, field));
  ok('…while an imperative add of new tasks at the start still opens the editor', missed.length === 0, missed);
  ok('…but not when it names another document ("add a task to the punch list")', vp.scheduleEditRouteForTranscript('add a task to the punch list for the trim', field) === null);
  ok('the founder\'s own sentence opens the editor from the mic',
    !!vp.scheduleEditRouteForTranscript('Add three tasks after rough-in: drywall hang 4 days, drywall tape 3 days, prime and paint 5 days', field));
  // A seat that cannot write the plan keeps the parse: the editor would only
  // refuse, and his words would never have been filed.
  const seat = (myRole: string | undefined) => ({ ...(field as object), myRole }) as never;
  ok('a field or viewer seat is never sent to the editor (its words are parsed as before)',
    vp.scheduleEditRouteForTranscript(EDITS[0], seat('field')) === null && vp.scheduleEditRouteForTranscript(EDITS[0], seat('viewer')) === null);
  ok('…an owner (no role) or editor seat is', !!vp.scheduleEditRouteForTranscript(EDITS[0], seat(undefined)) && !!vp.scheduleEditRouteForTranscript(EDITS[0], seat('editor')));
  ok('the mic rule is the anchored imperative-add regex, nothing looser',
    /const MIC_ADD_TASK = \/\^\\s\*/.test(read('utils/copilot/intentTable.ts')) && /return MIC_ADD_TASK\.test\(t\);/.test(read('utils/copilot/intentTable.ts')));
  ok('the mic uses the strict predicate, not the title-matching one',
    /isMicScheduleEditUtterance\(words\)/.test(read('utils/voiceActionParser.ts')) && !/isScheduleEditUtterance\(/.test(read('utils/voiceActionParser.ts')));
}

// ── B4: build-by-voice keeps what he states ──────────────────────────────────
console.log('\nB4 — build-by-voice: typed hint, coerced answers, a real start day:');
{
  // The COMMITTED relay's rule (supabase/functions/ai/index.ts before wave 6):
  // a null example → a required STRING; every key required.
  const oldInfer = (val: unknown): Record<string, unknown> => {
    if (val === null || val === undefined) return { type: 'string' };
    if (Array.isArray(val)) return { type: 'array', items: val.length > 0 ? oldInfer(val[0]) : { type: 'string' } };
    if (typeof val === 'object') { const properties: Record<string, unknown> = {}; for (const [k, v] of Object.entries(val as object)) properties[k] = oldInfer(v); return { type: 'object', properties, required: Object.keys(val as object) }; }
    return { type: typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : 'string' };
  };
  const turn = sc.scheduleCapability.buildTurnPrompt({ transcript: 'x', draft: {}, grounding: { facts: [], data: {} }, asking: null });
  const hint = turn.schemaHint as Record<string, unknown>;
  ok('no null in the hint (a null becomes a required string the model must fill)', Object.values(hint).every((v) => v !== null), hint);
  const props = (oldInfer(hint).properties ?? {}) as Record<string, { type: string }>;
  ok('crewCap is decoded as a NUMBER, phased / weatherBuffer as strings with an "unknown" sentinel', props.crewCap?.type === 'number' && hint.phased === 'unknown' && hint.weatherBuffer === 'unknown' && hint.crewCap === 0 && hint.startDate === '', props);
  ok('the prompt tells the model the sentinels', /"unknown" unless they said so/.test(turn.prompt) && /0 unless they gave a crew size/.test(turn.prompt));

  const merge = (ai: Record<string, unknown>, transcript: string, draft = {}) => sc.scheduleCapability.mergeDraft(draft, ai, { transcript, asking: null } as never);
  const stated = merge({ startDate: '', phased: 'yes', longLeadMilestones: [], crewCap: '4', weatherBuffer: 'no' }, 'crew of four, phase it, no weather buffer');
  ok('"crew of four, phase it, no weather buffer" → crewCap 4, phased true, weatherBuffer false', stated.crewCap === 4 && stated.phased === true && stated.weatherBuffer === false, stated);
  const silent = merge({ startDate: '', phased: 'unknown', longLeadMilestones: [], crewCap: 0, weatherBuffer: 'unknown' }, 'gut bath, standard finishes');
  ok('nothing said → all still null, so the interview still ASKS', silent.startDate === null && silent.phased === null && silent.crewCap === null && silent.weatherBuffer === null, silent);
  ok('a real boolean / number from a newer relay is still taken', (() => { const d = merge({ phased: false, crewCap: 3, weatherBuffer: true }, 'x'); return d.phased === false && d.crewCap === 3 && d.weatherBuffer === true; })());
  ok('an earlier answer survives a turn that says nothing', merge({ phased: 'unknown', crewCap: 0 }, 'ok', { phased: true, crewCap: 5 }).crewCap === 5);
  ok('"null" / "unknown" / "end of March" are NOT a start date, even with a date signal', ['null', 'unknown', 'end of March', ''].every((v) => merge({ startDate: v }, 'break ground end of March').startDate === null));
  // Days relative to the real today: the merge judges plausibility against it.
  const { todayCalendarDay, addCalendarDays, parseCalendarDay, toCalendarDayString } = await import('../utils/calendarDate');
  const TODAY = todayCalendarDay();
  const inDays = (n: number) => toCalendarDayString(addCalendarDays(parseCalendarDay(TODAY)!, n));
  ok('a full ISO timestamp keeps its calendar day', merge({ startDate: `${inDays(20)}T00:00:00Z` }, 'break ground in three weeks').startDate === inDays(20));
  ok('dateSignal: an impossible day is rejected', ds.normalizeStartDate('2026-02-31') === null && ds.shouldAcceptStartDate('2026-02-31', 'in March', false) === false);
  ok('dateSignal: a real day with a signal is accepted', ds.shouldAcceptStartDate('2026-03-30', 'end of March', false, '2026-03-01') === true);

  // Integration review, wave 6: "end of March" had no today to count from.
  ok('the builder prompt carries TODAY, so relative dates have an anchor', turn.prompt.includes(`TODAY: ${TODAY}`), turn.prompt.split('\n').filter((l) => /TODAY/.test(l)));
  ok('a wrong-YEAR conversion (a year ago) is not accepted — the start question is asked instead', merge({ startDate: inDays(-365 + 7) }, 'break ground end of March').startDate === null);
  ok('…nor one past two years out', merge({ startDate: inDays(731) }, 'break ground next spring').startDate === null);
  ok('…while a job that broke ground a few weeks ago, or starts next year, is kept', merge({ startDate: inDays(-30) }, 'we started 4 weeks ago').startDate === inDays(-30) && merge({ startDate: inDays(300) }, 'next summer').startDate === inDays(300));
  ok('…the same window when he is answering the start-date question', sc.scheduleCapability.mergeDraft({}, { startDate: inDays(-400) }, { transcript: 'March 30', asking: { field: 'startDate', question: 'q' } } as never).startDate === null);

  await sc.scheduleCapability.apply({ startDate: 'garbage', crewCap: 4, weatherBuffer: false }, { project: { linkedEstimate: { items: [{}] } }, projectId: 'p', ctx: {}, tier: 'pro' } as never);
  ok('apply holds the plan to the stated crew (no task over 4, both copies)', !!box.generated && box.generated.tasks.every((t) => (t.crewSize ?? 0) <= 4) && box.generated.schedule.tasks.every((t) => (t.crewSize ?? 0) <= 4) && box.generated.tasks[1].crewSize === 2, box.generated);
  ok('…"no weather buffer" zeroes the schedule buffer', box.generated?.schedule.bufferDays === 0);
  ok('…and never writes a start date parseCalendarDay cannot read', box.generated?.schedule.startDate === undefined);
  await sc.scheduleCapability.apply({ startDate: '2026-03-30', weatherBuffer: null }, { project: { linkedEstimate: { items: [{}] } }, projectId: 'p', ctx: {}, tier: 'pro' } as never);
  ok('an unstated buffer and crew leave the generated plan alone; a real day is written', box.generated?.schedule.bufferDays === 3 && box.generated?.tasks[0].crewSize === 6 && box.generated?.schedule.startDate === '2026-03-30');
  ok('…and unstated phasing reaches the generator as null (its prompt is then unchanged)', JSON.stringify(box.constraints) === JSON.stringify({ phased: null }), box.constraints);
  // "Phase it by area" was asked, captured and then dropped (handoff 3).
  await sc.scheduleCapability.apply({ phased: true }, { project: { linkedEstimate: { items: [{}] } }, projectId: 'p', ctx: {}, tier: 'pro' } as never);
  ok('"phase it by area" reaches the generator', JSON.stringify(box.constraints) === JSON.stringify({ phased: true }), box.constraints);
  const { phasingInstruction } = await import('../utils/copilot/schedule/scheduleGaps');
  ok('…as a prompt line: phased → area by area; overlap → not phased; unstated → nothing', /PHASED BY AREA/.test(phasingInstruction(true)) && /may overlap/.test(phasingInstruction(false)) && phasingInstruction(null) === '' && phasingInstruction(undefined) === '');
  const gen = read('utils/autoScheduleFromEstimate.ts');
  ok('…and the generator puts that line into its prompt', /const phasing = phasingInstruction\(constraints\?\.phased\);/.test(gen) && /\$\{phasing \? `10\. \$\{phasing\}\\n` : ''\}/.test(gen));
}

// ── B5: Discover's builder picks the job first ───────────────────────────────
console.log('\nB5 — the AI Schedule Builder asks for the job BEFORE the questions:');
const sbi = read('components/schedule/ScheduleBuilderInterview.tsx');
{
  const pickerAt = sbi.indexOf('if (!project) {');
  ok('a no-job arrival renders the job picker', pickerAt > 0 && /sb-job-picker/.test(sbi) && /pickableProjects\(projects\)/.test(sbi));
  ok('…before any question card, follow-up call or generation can run', pickerAt < sbi.indexOf('if (fetchingFollowups)') && pickerAt < sbi.indexOf("if (phase === 'generating')") && pickerAt < sbi.indexOf('<Animated.View'));
  ok('…with "Create a project first" when he has none', /Create a project first/.test(sbi) && /capabilityId: 'new_project'/.test(sbi));
  ok('picking a job starts the interview on it with its own defaults', /setPickedId\(p\.id\);\s*setAnswers\(defaultAnswers\(p\)\);/.test(sbi));
  ok('a job with a running schedule says a replace is reviewed first', /you’ll review before anything replaces it/.test(sbi));
}
const disc = read('app/(tabs)/discover/schedule.tsx');
ok('Discover still opens the builder with no projectId (the builder now asks)', /case 'interview':\s*router\.push\(\{ pathname: '\/schedule-builder' \}/.test(disc));

// ── Web width (the founder's "boxes so stretched out") ───────────────────────
console.log('\nWeb width — the schedule front doors this lane owns are column-capped:');
ok('Discover › Schedule (the sidebar\'s landing): the existing-schedule rows share the on-ramp\'s column', /existingSection: \{[^}]*maxWidth: 552,[^}]*alignSelf: 'center'/.test(disc));
ok('the AI Schedule Builder\'s question card + progress share the job picker\'s 640 column', /<View style=\{styles\.pickerColumn\}>\s*<View style=\{styles\.progressTrack\}>/.test(sbi) && /<Animated\.View style=\{\[styles\.card, styles\.pickerColumn, cardStyle\]\}>/.test(sbi));
ok('the Copilot hub body is capped and centred', /body: \{[^}]*maxWidth: 720,[^}]*alignSelf: 'center'/.test(hub));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
