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

// Excel 1-based predecessor convention: the edge fn now assigns sourceId = i+1
// so a predecessor cell "1" references the FIRST task (the sheet's visible row).
const xlsxRows: ImportedScheduleRow[] = [
  { sourceId: '1', title: 'Excavate', rawDuration: '2d' },
  { sourceId: '2', title: 'Foundation', rawDuration: '3d', rawPredecessors: '1' },
  { sourceId: '3', title: 'Framing', rawDuration: '4d', rawPredecessors: '2' },
];
const xlsx = mapRowsToScheduleTasks(xlsxRows, { scheduleStartDate: '2026-01-01', workingDaysPerWeek: 5 });
const found = xlsx.tasks.find(t => t.title === 'Foundation')!;
assert(found.dependencyLinks!.length === 1 && found.dependencyLinks![0].taskId === xlsx.tasks[0].id, "excel predecessor '1' resolves to the first task");

// WBS rebuild: outline levels [1,2,2,1] → parent chain + summary flagging.
const wbsRows: ImportedScheduleRow[] = [
  { sourceId: '1', title: 'Sitework', outlineLevel: 1 },
  { sourceId: '2', title: 'Clear', outlineLevel: 2 },
  { sourceId: '3', title: 'Grade', outlineLevel: 2 },
  { sourceId: '4', title: 'Foundations', outlineLevel: 1 },
];
const wbs = mapRowsToScheduleTasks(wbsRows, { scheduleStartDate: '2026-01-01', workingDaysPerWeek: 5 }).tasks;
const [site, clear, grade, found2] = wbs;
assert(clear.parentId === site.id && grade.parentId === site.id, 'children point to nearest lower-level parent');
assert(found2.parentId === undefined, 'level-1 sibling has no parent');
assert(site.isSummary === true && found2.isSummary === undefined, 'parent flagged isSummary, leaf not');

// Constraint mapping: constraintType 4 + constraintDate → anchorType/anchorDate.
const conRow: ImportedScheduleRow = { sourceId: '1', title: 'Pour', constraintType: 4, constraintDate: '2026-02-01' };
const conTask = mapRowsToScheduleTasks([conRow], { scheduleStartDate: '2026-01-01', workingDaysPerWeek: 5 }).tasks[0];
assert(conTask.anchorType === 'start-no-earlier', 'constraintType 4 → start-no-earlier');
assert(conTask.anchorDate === '2026-02-01', 'constraintDate carried to anchorDate');

// startDay compression on a 5-day week: 7 calendar days out → working day 6.
const compRow: ImportedScheduleRow = { sourceId: '1', title: 'Delayed', rawStart: '2026-01-08' };
const compTask = mapRowsToScheduleTasks([compRow], { scheduleStartDate: '2026-01-01', workingDaysPerWeek: 5 }).tasks[0];
assert(compTask.startDay === 6, '7 calendar days @ 5-day week → startDay 6');

// Unparseable predecessor tokens are surfaced (not dropped silently).
const badPred = mapRowsToScheduleTasks([
  { sourceId: '1', title: 'Note dep', rawPredecessors: 'see note' },
], { scheduleStartDate: '2026-01-01', workingDaysPerWeek: 5 });
assert(badPred.warnings.some(w => w.code === 'bad_predecessor'), 'unparseable predecessor warned (bad_predecessor)');

if (failed) { console.error(`\n${failed} schedule-import checks failed`); process.exit(1); }
console.log('✓ schedule-import validator passed');
