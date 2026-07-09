// validate-schedule-import.ts — unit tests for the pure schedule-import mapper
// (utils/scheduleImport.ts). Run via: bun run scripts/validate-schedule-import.ts
//
// Bun executes TypeScript natively — we import the module and exercise the pure
// functions directly. No mocking: utils/scheduleImport.ts has zero React/Supabase deps.

import {
  mapRowsToScheduleTasks,
  parseDurationDays,
  parsePredecessorString,
  MSPDI_LINK_TYPE,
  MSPDI_CONSTRAINT_TYPE,
} from '../utils/scheduleImport';
import type { ImportedScheduleRow } from '../types';

let failed = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('✗', m); failed++; } };

// Duration parsing
assert(parseDurationDays('PT40H0M0S') === 5, 'PT40H = 5d @ 8h');
assert(parseDurationDays('2 wks') === 10, '2 wks = 10d');
assert(parseDurationDays('3d') === 3, '3d = 3');
assert(parseDurationDays('4') === 4, 'bare 4 = 4');
assert(parseDurationDays(undefined) === 1, 'missing = 1');

// Link + constraint tables
assert(MSPDI_LINK_TYPE[1] === 'FS' && MSPDI_LINK_TYPE[3] === 'SS' && MSPDI_LINK_TYPE[0] === 'FF' && MSPDI_LINK_TYPE[2] === 'SF', 'link types');
assert(MSPDI_CONSTRAINT_TYPE[4] === 'start-no-earlier' && MSPDI_CONSTRAINT_TYPE[7] === 'finish-no-later', 'constraint types');

// Predecessor parsing
const p = parsePredecessorString('3FS+2d, 5SS');
assert(p.length === 2 && p[0].type === 'FS' && p[0].lagDays === 2 && p[1].type === 'SS', 'predecessor parse');

// Mapping: dangling dep dropped + warned; links remapped to new ids
const rows: ImportedScheduleRow[] = [
  { sourceId: '1', title: 'A', rawDuration: '2d', rawStart: '2026-01-01' },
  { sourceId: '2', title: 'B', rawDuration: '3d', rawStart: '2026-01-03', rawPredecessors: '1FS, 9FS' },
  { sourceId: '3', title: '', rawDuration: '1d' }, // empty title → skipped
];
const { tasks, warnings } = mapRowsToScheduleTasks(rows, { scheduleStartDate: '2026-01-01', workingDaysPerWeek: 7 });
assert(tasks.length === 2, 'empty-title row skipped');
const b = tasks.find(t => t.title === 'B')!;
assert(b.dependencyLinks!.length === 1 && b.dependencyLinks![0].taskId === tasks[0].id, 'valid link remapped to new id');
assert(warnings.some(w => w.code === 'dangling_dep'), 'dangling dep warned');
assert(warnings.some(w => w.code === 'empty_title'), 'empty title warned');

// Milestone: 0-duration
const ms = mapRowsToScheduleTasks([{ sourceId: '1', title: 'M', milestone: true }], { scheduleStartDate: '2026-01-01', workingDaysPerWeek: 7 }).tasks[0];
assert(ms.durationDays === 0 && ms.isMilestone === true, 'milestone 0-duration');

if (failed) { console.error(`\n${failed} schedule-import checks failed`); process.exit(1); }
console.log('✓ schedule-import validator passed');
