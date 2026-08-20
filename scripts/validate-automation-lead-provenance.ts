// validate-automation-lead-provenance.ts — pins the HONESTY invariant of the
// roadmap→schedule adapter (utils/automation/roadmapToScheduleWork.ts).
//
// THE BLOCKER THIS PINS (spec cardinal rule "automation must never present a
// guess as truth"):
//   RoadmapInspection.leadTimeDays is an LLM output from generateRoadmap
//   (zod-defaulted to 3), grounded only in free-text project.location. There is
//   NO jurisdiction dataset behind it (JURISDICTION_OVERRIDES ships empty in v1).
//   So an AUTHORED inspection lead must surface as source:'ai_estimate',
//   confidence:'low' — an unverified guess the contractor confirms — and NEVER
//   as source:'jurisdiction'/confidence:'high'.
//
// Invariants:
//   • AUTHORED lead (leadTimeDays > 0) → source 'ai_estimate', confidence 'low',
//     days === the authored value. NEVER 'jurisdiction', NEVER 'high'.
//   • NO authored lead (leadTimeDays <= 0) → falls back to the library default
//     for the inspection kind, carrying that provenance (source 'default')
//     through untouched — still never 'jurisdiction' without a real dataset.
//   • ONLY a real JURISDICTION_OVERRIDES hit may carry source:'jurisdiction'
//     (v1 ships empty, so no inspection lead is ever 'jurisdiction').
//   • 'ai_estimate' is a real member of LeadTimeSource (the enum was extended).
// Run: bun run scripts/validate-automation-lead-provenance.ts

import {
  roadmapToScheduleWork,
} from '../utils/automation/roadmapToScheduleWork';
import { getLeadTime } from '../utils/automation/leadTimeLibrary';
import type { ScheduleTask, ProjectSchedule, RoadmapInspection } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

function task(id: string, over: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id, title: id, phase: 'General', durationDays: 3, startDay: 10, progress: 0,
    crew: '', dependencies: [], notes: '', status: 'not_started', ...over,
  };
}

function insp(id: string, over: Partial<RoadmapInspection> = {}): RoadmapInspection {
  return {
    id, type: 'building', title: `Inspection ${id}`, description: '',
    gatesTaskHint: '', leadTimeDays: 5, status: 'pending', ...over,
  };
}

function sched(tasks: ScheduleTask[]): ProjectSchedule {
  return {
    id: 'sch', name: 'S', projectId: 'p', startDate: '2026-09-01',
    workingDaysPerWeek: 5, bufferDays: 0, tasks,
    totalDurationDays: 0, criticalPathDays: 0, laborAlignmentScore: 0, riskItems: [],
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
}

console.log('\nautomation lead provenance (honesty):');

// ── AUTHORED lead → ai_estimate / low, NEVER jurisdiction / high ──
{
  const schedule = sched([task('t_framing', { title: 'Framing' })]);
  const inspections = [
    insp('rmi_authored', { title: 'Framing inspection', gatesTaskHint: 'Framing', leadTimeDays: 8 }),
  ];
  // Even with a jurisdiction string passed, an authored lead is an AI guess —
  // it must NOT be relabeled jurisdiction just because a jurisdiction arg exists.
  const [line] = roadmapToScheduleWork(inspections, schedule, 'new york, ny');
  ok('authored lead keeps its days', line.leadTime.days === 8, `got ${line.leadTime.days}`);
  ok('authored lead is source ai_estimate', line.leadTime.source === 'ai_estimate', `got ${line.leadTime.source}`);
  ok('authored lead is confidence low', line.leadTime.confidence === 'low', `got ${line.leadTime.confidence}`);
  ok('authored lead is NOT jurisdiction', line.leadTime.source !== 'jurisdiction');
  ok('authored lead is NOT high confidence', line.leadTime.confidence !== 'high');
}

// ── NO authored lead → library default provenance (never jurisdiction) ──
{
  const schedule = sched([task('t_framing', { title: 'Framing' })]);
  const libDefault = getLeadTime('dob_inspection');
  const [line] = roadmapToScheduleWork(
    [insp('rmi_unauthored', { gatesTaskHint: 'Framing', leadTimeDays: 0 })],
    schedule,
  );
  ok('unauthored lead falls back to library default days', line.leadTime.days === libDefault.days, `got ${line.leadTime.days} want ${libDefault.days}`);
  ok('unauthored lead source is default (library)', line.leadTime.source === 'default', `got ${line.leadTime.source}`);
  ok('unauthored lead source is NOT ai_estimate', line.leadTime.source !== 'ai_estimate');
}

// ── v1 JURISDICTION_OVERRIDES is empty: nothing surfaces as 'jurisdiction' ──
{
  const schedule = sched([task('t_framing', { title: 'Framing' })]);
  const lines = roadmapToScheduleWork(
    [
      insp('a', { gatesTaskHint: 'Framing', leadTimeDays: 8 }),
      insp('b', { gatesTaskHint: 'Framing', leadTimeDays: 0 }),
    ],
    schedule,
    'new york, ny',
  );
  ok('no inspection lead is ever labeled jurisdiction in v1', lines.every((l) => l.leadTime.source !== 'jurisdiction'));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
