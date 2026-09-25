// scripts/validate-schedule-ai-scheduled-start.ts — the Schedule Pro AI is
// shown where each task is SCHEDULED, not the pin he typed (wave 6c, lane DB;
// deferred from 6a).
//
// A task pinned to day 1 behind a 10-day predecessor sits on day 11: CPM, not
// the pin, decides where the bar is. The AI drawer serialized `task.startDay`
// (the pin), so the model reasoned from a start that was nowhere on screen,
// and an answer that restated the task's REAL start came back as a move to
// day 11 — "1 change proposed" for a change that changes nothing. Pinned here:
//   - scheduledStartOrdinal: calendar mode (a dated schedule) converts the
//     CPM early start to a working ordinal; raw-day mode takes it as-is; no
//     CPM row falls back to the pin;
//   - serializeSchedule (every prompt) and aiBulkEdit's selected lines print
//     start=<scheduled>;
//   - mergeBulkUpdates compares a proposed startDay against the scheduled
//     start when given one, and against the pin without (the 6a contract).
//
// mageAI is stubbed with Bun.plugin (as validate-copilot-edit-relay-contract
// does): every call records its params and returns the canned answer.
//
// Run: bun run scripts/validate-schedule-ai-scheduled-start.ts
import type { ScheduleTask } from '../types';

type OnLoadResult = { contents: string; loader: 'ts' };
type BunPluginBuilder = { onLoad: (opts: { filter: RegExp }, cb: () => OnLoadResult) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-schedule-ai-scheduled-start must run under bun (needs Bun.plugin)\n');
  process.exit(1);
}
Bun!.plugin({
  name: 'stub-mage-ai',
  setup(build) {
    build.onLoad({ filter: /utils\/mageAI\.ts$/ }, () => ({
      contents: 'export async function mageAI(p) { return globalThis.__fakeAI(p); }',
      loader: 'ts',
    }));
  },
});

const { scheduledStartOrdinal, aiBulkEdit, aiAskSchedule, aiDetectRisks, mergeBulkUpdates } = await import('../utils/scheduleAI');
const { runCpm } = await import('../utils/cpm');

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, why = '') => { if (c) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, why); } };

const mk = (id: string, title: string, startDay: number, durationDays: number, deps: string[] = []): ScheduleTask => ({
  id, title, phase: 'P', durationDays, startDay, progress: 0, crew: 'Crew', dependencies: deps, notes: '', status: 'not_started',
} as ScheduleTask);
// A 10 days; B pinned to day 1 but waiting on A → scheduled day 11.
const TASKS: ScheduleTask[] = [mk('a', 'Framing', 1, 10), mk('b', 'Drywall', 1, 5, ['a'])];

const seen: { params: { prompt?: string } | null } = { params: null };
let answer: unknown = { summary: 's', updates: [] };
(globalThis as { __fakeAI?: unknown }).__fakeAI = async (p: { prompt?: string }) => {
  seen.params = p;
  return typeof answer === 'string' ? { success: true, data: answer } : { success: true, data: answer };
};

console.log('\nscheduledStartOrdinal — the start the engine scheduled, on the pin\'s scale:');
{
  const raw = runCpm(TASKS, {});
  ok('raw-day mode (no start date): B pinned 1 behind a 10-day A → 11', scheduledStartOrdinal(TASKS[1], raw) === 11, String(scheduledStartOrdinal(TASKS[1], raw)));
  ok('raw-day mode: A stays on 1', scheduledStartOrdinal(TASKS[0], raw) === 1);
  // Mon 2026-03-02, Mon-Fri: A runs Mar 2–13, B starts Mon Mar 16 = calendar
  // index 15 = working day 11.
  const scale = { scheduleStartDate: '2026-03-02', workingDaysPerWeek: 5, nonWorkingDates: [] as string[] };
  const cal = runCpm(TASKS, scale);
  ok('calendar mode: the engine\'s early start is a calendar index (15)', cal.perTask.get('b')?.es === 15, String(cal.perTask.get('b')?.es));
  ok('calendar mode: it is reported as working day 11, not 15', scheduledStartOrdinal(TASKS[1], cal, scale) === 11, String(scheduledStartOrdinal(TASKS[1], cal, scale)));
  ok('no CPM row (a cycle / unknown id) → the pin', scheduledStartOrdinal(mk('x', 'X', 7, 1), cal, scale) === 7);
  // Closures move it too: a holiday on Tue Mar 3 pushes A to Mar 16 and B to
  // Tue Mar 17 (calendar 16) — still working day 11 of the schedule.
  const hol = { ...scale, nonWorkingDates: ['2026-03-03'] };
  const calHol = runCpm(TASKS, hol);
  ok('with a closure the ordinal is still 11 (closures are not working days)', scheduledStartOrdinal(TASKS[1], calHol, hol) === 11, String(scheduledStartOrdinal(TASKS[1], calHol, hol)));
}

console.log('\nthe prompts print start=<scheduled>:');
{
  const raw = runCpm(TASKS, {});
  answer = 'B starts day 11.';
  await aiAskSchedule(TASKS, raw, 'when does drywall start?', new Date(2026, 2, 2));
  const p = seen.params?.prompt ?? '';
  ok('Ask: T2 | Drywall | start=11 (not the pin 1)', /T2 \| Drywall \| start=11 \|/.test(p), p.split('\n').find((l: string) => l.startsWith('T2')) ?? '');
  ok('Ask: the header names start as the scheduled working day', /start = scheduled working day/.test(p));
  const askScale = { scheduleStartDate: '2026-03-02', workingDaysPerWeek: 5 };
  await aiAskSchedule(TASKS, runCpm(TASKS, askScale), 'when does drywall start?', new Date(2026, 2, 2), askScale);
  const pc = seen.params?.prompt ?? '';
  ok('Ask (dated schedule): the calendar is threaded through — T2 start=11, not calendar 15', /T2 \| Drywall \| start=11 \|/.test(pc), pc.split('\n').find((l: string) => l.startsWith('T2')) ?? '');
  answer = { summary: 's', findings: [] };
  const scale = { scheduleStartDate: '2026-03-02', workingDaysPerWeek: 5 };
  await aiDetectRisks(TASKS, runCpm(TASKS, scale), scale);
  const r = seen.params?.prompt ?? '';
  ok('Risks (dated schedule): T2 start=11, the working day — not calendar 15', /T2 \| Drywall \| start=11 \|/.test(r), r.split('\n').find((l: string) => l.startsWith('T2')) ?? '');
}

console.log('\nbulk edit — the selected lines and the merge use the scheduled start:');
{
  const raw = runCpm(TASKS, {});
  answer = { summary: 's', updates: [{ alias: 'T2', startDay: 11 }] };
  const echo = await aiBulkEdit(TASKS, raw, ['b'], 'keep drywall where it is');
  const p = seen.params?.prompt ?? '';
  ok('the selected line prints T2: Drywall | start=11', /T2: Drywall \| start=11 \|/.test(p), p.split('\n').find((l: string) => l.startsWith('T2:')) ?? '');
  ok('an echo of its REAL start (11) yields 0 patches', echo.patches.length === 0, JSON.stringify(echo.patches));

  answer = { summary: 's', updates: [{ alias: 'T2', startDay: 13 }] };
  const move = await aiBulkEdit(TASKS, raw, ['b'], 'push drywall 2 days');
  ok('a real move (13) is still one patch, startDay 13', move.patches.length === 1 && move.patches[0].patch.startDay === 13, JSON.stringify(move.patches));

  answer = { summary: 's', updates: [{ alias: 'T2', startDay: 1 }] };
  const pin = await aiBulkEdit(TASKS, raw, ['b'], 'start drywall on day 1');
  ok('restating the old PIN (1) is now a change: it is not where the task is', pin.patches.length === 1 && pin.patches[0].patch.startDay === 1, JSON.stringify(pin.patches));

  const scale = { scheduleStartDate: '2026-03-02', workingDaysPerWeek: 5 };
  answer = { summary: 's', updates: [{ alias: 'T2', startDay: 11 }] };
  const calEcho = await aiBulkEdit(TASKS, runCpm(TASKS, scale), ['b'], 'keep it', scale);
  ok('dated schedule: an echo of working day 11 is 0 patches', calEcho.patches.length === 0, JSON.stringify(calEcho.patches));
}

console.log('\nmergeBulkUpdates — without a start map it keeps the 6a pin contract:');
{
  const byAlias = new Map([['T2', 'b']]);
  const sel = new Set(['b']);
  const noMap = mergeBulkUpdates(TASKS, [{ alias: 'T2', startDay: 1 }], byAlias, sel);
  ok('no map: startDay equal to the pin (1) is no change', noMap.length === 0, JSON.stringify(noMap));
  const withMap = mergeBulkUpdates(TASKS, [{ alias: 'T2', startDay: 11 }], byAlias, sel, new Map([['b', 11]]));
  ok('map: startDay equal to the scheduled start (11) is no change', withMap.length === 0, JSON.stringify(withMap));
  const moved = mergeBulkUpdates(TASKS, [{ alias: 'T2', startDay: 11 }], byAlias, sel);
  ok('no map: 11 against the pin 1 is a change (why the map exists)', moved.length === 1, JSON.stringify(moved));
}

// Integration (phase B): the behaviour above runs each ai* with a scale, but
// dropping the scale from ONE call site still passed. Pin the threading.
console.log('\nthe scale reaches every prompt (source pins):');
{
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const ai = readFileSync(join(root, 'utils/scheduleAI.ts'), 'utf8');
  const calls = ai.match(/serializeSchedule\([^)]*\)/g) ?? [];
  ok('every serializeSchedule call in scheduleAI passes dayScale (risks, optimize, ask, delay, bulk)',
    calls.length === 6 && calls.slice(1).every((c) => /, dayScale\)$/.test(c)), calls.join(' · '));
  const panel = readFileSync(join(root, 'components/schedule/AIAssistantPanel.tsx'), 'utf8');
  ok('AIAssistantPanel hands its dayScale to aiBulkEdit, aiDetectRisks, aiOptimizeSchedule and aiAskSchedule',
    /await aiBulkEdit\(tasks, cpm, Array\.from\(selectedIds\), instruction, dayScale\)/.test(panel) && /await aiDetectRisks\(tasks, cpm, dayScale\)/.test(panel)
    && /await aiOptimizeSchedule\(tasks, cpm, dayScale\)/.test(panel) && /await aiAskSchedule\([^)]*, dayScale\)/.test(panel));
  const pro = readFileSync(join(root, 'app/schedule-pro.tsx'), 'utf8');
  ok('Schedule Pro gives the desktop pane\'s assistant its summary scale', /\bdayScale: summaryScale,/.test(pro));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
