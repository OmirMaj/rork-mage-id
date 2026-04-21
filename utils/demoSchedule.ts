// demoSchedule.ts — seed a realistic, complex residential-construction
// schedule so we can stress-test the CPM engine + Interactive Gantt.
//
// The schedule is based on a ~10-week single-family-home build. It has:
//   * 6 phases (Site → Foundation → Framing → MEP → Finishes → Closeout)
//   * ~35 tasks with real-world dependencies
//   * A few tasks already showing progress + actuals (so you can see the
//     green actual bars + variance badges immediately)
//   * A baseline on every task (so the baseline ghost stripe shows underneath)
//   * One intentional conflict (two tasks share a crew + overlap) so the
//     resource-leveling warning lights up
//
// NOTE: This is a dev helper. In production we'd gate it behind a flag.

import type { ScheduleTask } from '@/types';
import { createId, generateWbsCodes } from './scheduleEngine';

interface SeedSpec {
  alias: string;                   // local alias, used in `deps`
  title: string;
  phase: string;
  durationDays: number;
  deps?: string[];                  // local aliases (resolved below)
  crew?: string;
  crewSize?: number;
  isMilestone?: boolean;
  progress?: number;                // 0-100
  actualStartOffset?: number;       // day number where actual started (1-indexed)
  actualEndOffset?: number;         // day number where actual finished
  status?: ScheduleTask['status'];
  isWeatherSensitive?: boolean;
}

// Tasks in logical build order. `deps` references other entries by alias.
const SPEC: SeedSpec[] = [
  // --- Phase 1: Site prep -------------------------------------------------
  { alias: 'kickoff', title: 'Project kickoff & permits filed', phase: 'Site', durationDays: 0, isMilestone: true, status: 'done', progress: 100, actualStartOffset: 1, actualEndOffset: 1 },
  { alias: 'survey',  title: 'Site survey & staking', phase: 'Site', durationDays: 2, deps: ['kickoff'], crew: 'Surveyor', status: 'done', progress: 100, actualStartOffset: 1, actualEndOffset: 2 },
  { alias: 'clear',   title: 'Clear & grub site',     phase: 'Site', durationDays: 3, deps: ['survey'], crew: 'Excavation', crewSize: 3, status: 'done', progress: 100, actualStartOffset: 3, actualEndOffset: 6, isWeatherSensitive: true },
  { alias: 'erosion', title: 'Erosion control',       phase: 'Site', durationDays: 1, deps: ['clear'], crew: 'Excavation', status: 'done', progress: 100, actualStartOffset: 6, actualEndOffset: 6 },
  { alias: 'tempUt',  title: 'Temporary utilities',   phase: 'Site', durationDays: 2, deps: ['clear'], crew: 'Electric', status: 'done', progress: 100, actualStartOffset: 7, actualEndOffset: 8 },

  // --- Phase 2: Foundation -----------------------------------------------
  { alias: 'excavate', title: 'Excavate footings & basement', phase: 'Foundation', durationDays: 4, deps: ['clear', 'erosion'], crew: 'Excavation', crewSize: 3, status: 'done', progress: 100, actualStartOffset: 7, actualEndOffset: 11 },
  { alias: 'foundFormwork', title: 'Foundation formwork & rebar', phase: 'Foundation', durationDays: 3, deps: ['excavate'], crew: 'Concrete', crewSize: 4, status: 'done', progress: 100, actualStartOffset: 11, actualEndOffset: 14 },
  { alias: 'pourFound', title: 'Pour foundation walls', phase: 'Foundation', durationDays: 2, deps: ['foundFormwork'], crew: 'Concrete', status: 'done', progress: 100, actualStartOffset: 14, actualEndOffset: 15 },
  { alias: 'foundCure', title: 'Foundation cure & strip forms', phase: 'Foundation', durationDays: 3, deps: ['pourFound'], crew: 'Concrete', status: 'in_progress', progress: 65, actualStartOffset: 16 },
  { alias: 'foundInsp', title: 'Foundation inspection', phase: 'Inspections', durationDays: 1, deps: ['foundCure'], isMilestone: false },
  { alias: 'waterproof', title: 'Waterproof foundation', phase: 'Foundation', durationDays: 2, deps: ['foundInsp'], crew: 'Waterproofing' },
  { alias: 'backfill', title: 'Backfill foundation', phase: 'Foundation', durationDays: 2, deps: ['waterproof'], crew: 'Excavation' },
  { alias: 'slabPrep', title: 'Slab prep & vapor barrier', phase: 'Foundation', durationDays: 2, deps: ['backfill'], crew: 'Concrete' },
  { alias: 'pourSlab', title: 'Pour slab', phase: 'Foundation', durationDays: 1, deps: ['slabPrep'], crew: 'Concrete' },

  // --- Phase 3: Framing --------------------------------------------------
  { alias: 'frameFloor1', title: 'Frame 1st floor deck', phase: 'Framing', durationDays: 3, deps: ['pourSlab'], crew: 'Framing', crewSize: 5 },
  { alias: 'frameWalls1', title: 'Frame 1st floor walls', phase: 'Framing', durationDays: 4, deps: ['frameFloor1'], crew: 'Framing', crewSize: 5 },
  { alias: 'frameFloor2', title: 'Frame 2nd floor deck', phase: 'Framing', durationDays: 2, deps: ['frameWalls1'], crew: 'Framing' },
  { alias: 'frameWalls2', title: 'Frame 2nd floor walls', phase: 'Framing', durationDays: 3, deps: ['frameFloor2'], crew: 'Framing' },
  { alias: 'frameRoof',   title: 'Frame roof trusses & sheathing', phase: 'Framing', durationDays: 4, deps: ['frameWalls2'], crew: 'Framing', crewSize: 5, isWeatherSensitive: true },
  { alias: 'frameInsp',   title: 'Rough framing inspection', phase: 'Inspections', durationDays: 1, deps: ['frameRoof'] },
  { alias: 'roofing',     title: 'Install roofing', phase: 'Framing', durationDays: 3, deps: ['frameInsp'], crew: 'Roofing', isWeatherSensitive: true },
  { alias: 'windows',     title: 'Install windows & exterior doors', phase: 'Framing', durationDays: 2, deps: ['frameInsp'], crew: 'Framing' },
  { alias: 'weatherTight', title: 'Weather-tight milestone', phase: 'Framing', durationDays: 0, deps: ['roofing', 'windows'], isMilestone: true },

  // --- Phase 4: MEP rough-in --------------------------------------------
  // Note: plumbing + electrical + HVAC run in parallel — shared crew conflict
  // between plumbing rough-in and HVAC (both using "Mechanical" crew) to
  // trigger the leveling warning.
  { alias: 'plumbRough', title: 'Plumbing rough-in', phase: 'MEP', durationDays: 5, deps: ['weatherTight'], crew: 'Mechanical', crewSize: 2 },
  { alias: 'elecRough',  title: 'Electrical rough-in', phase: 'MEP', durationDays: 5, deps: ['weatherTight'], crew: 'Electric', crewSize: 3 },
  { alias: 'hvacRough',  title: 'HVAC rough-in', phase: 'MEP', durationDays: 4, deps: ['weatherTight'], crew: 'Mechanical', crewSize: 2 },
  { alias: 'mepInsp',    title: 'MEP inspection', phase: 'Inspections', durationDays: 1, deps: ['plumbRough', 'elecRough', 'hvacRough'] },

  // --- Phase 5: Finishes -------------------------------------------------
  { alias: 'insulation',  title: 'Insulation', phase: 'Interior', durationDays: 3, deps: ['mepInsp'], crew: 'Insulation' },
  { alias: 'drywall',     title: 'Hang & finish drywall', phase: 'Drywall', durationDays: 6, deps: ['insulation'], crew: 'Drywall', crewSize: 4 },
  { alias: 'interiorPaint', title: 'Interior paint', phase: 'Finishes', durationDays: 4, deps: ['drywall'], crew: 'Paint' },
  { alias: 'cabinets',    title: 'Install cabinets', phase: 'Finishes', durationDays: 3, deps: ['interiorPaint'], crew: 'Finish Carp' },
  { alias: 'countertops', title: 'Countertops template + install', phase: 'Finishes', durationDays: 5, deps: ['cabinets'], crew: 'Finish Carp' },
  { alias: 'flooring',    title: 'Flooring', phase: 'Finishes', durationDays: 4, deps: ['interiorPaint'], crew: 'Flooring' },
  { alias: 'trim',        title: 'Interior trim & doors', phase: 'Finishes', durationDays: 3, deps: ['flooring'], crew: 'Finish Carp' },
  { alias: 'fixtures',    title: 'Plumbing & electrical fixtures', phase: 'Finishes', durationDays: 2, deps: ['trim', 'countertops'], crew: 'Mechanical' },

  // --- Phase 6: Closeout -------------------------------------------------
  { alias: 'landscaping', title: 'Landscaping', phase: 'Landscaping', durationDays: 4, deps: ['backfill'], crew: 'Landscaping', isWeatherSensitive: true },
  { alias: 'finalClean',  title: 'Final clean', phase: 'Finishes', durationDays: 2, deps: ['fixtures'], crew: 'Cleaning' },
  { alias: 'finalInsp',   title: 'Final inspection & C/O', phase: 'Inspections', durationDays: 1, deps: ['finalClean', 'landscaping'] },
  { alias: 'turnover',    title: 'Client walkthrough & turnover', phase: 'General', durationDays: 0, deps: ['finalInsp'], isMilestone: true },
];

/**
 * Build ~35 realistic tasks with dependencies, baselines, and a handful of
 * actuals pre-filled so the as-built UI shows something interesting on load.
 */
export function seedDemoSchedule(): ScheduleTask[] {
  // First pass: assign ids.
  const idByAlias = new Map<string, string>();
  for (const spec of SPEC) {
    idByAlias.set(spec.alias, createId('task'));
  }

  // Second pass: compute startDays by walking the dependency graph (simple
  // topo, since SPEC is already in dep order).
  const endDayByAlias = new Map<string, number>();
  const startByAlias = new Map<string, number>();

  for (const spec of SPEC) {
    let earliestStart = 1;
    for (const depAlias of spec.deps ?? []) {
      const depEnd = endDayByAlias.get(depAlias);
      if (depEnd != null) earliestStart = Math.max(earliestStart, depEnd + 1);
    }
    startByAlias.set(spec.alias, earliestStart);
    // A milestone (duration=0) ends on the same day it starts.
    const end = spec.durationDays === 0
      ? earliestStart
      : earliestStart + spec.durationDays - 1;
    endDayByAlias.set(spec.alias, end);
  }

  // Third pass: build ScheduleTask objects.
  const tasks: ScheduleTask[] = SPEC.map(spec => {
    const id = idByAlias.get(spec.alias)!;
    const startDay = startByAlias.get(spec.alias)!;
    const endDay = endDayByAlias.get(spec.alias)!;
    const dependencies = (spec.deps ?? [])
      .map(a => idByAlias.get(a))
      .filter((x): x is string => Boolean(x));

    const task: ScheduleTask = {
      id,
      title: spec.title,
      phase: spec.phase,
      durationDays: spec.durationDays,
      startDay,
      progress: spec.progress ?? 0,
      crew: spec.crew ?? '',
      crewSize: spec.crewSize,
      dependencies,
      notes: '',
      status: spec.status ?? 'not_started',
      isMilestone: spec.isMilestone,
      isWeatherSensitive: spec.isWeatherSensitive,
      // Baseline = planned start/end, captured as the "original promise."
      baselineStartDay: startDay,
      baselineEndDay: endDay,
    };

    // As-built values (if pre-filled in the spec). We also nudge a few tasks
    // to show variance: e.g. the clear/grub actually took an extra day so the
    // +1d late badge appears.
    if (spec.actualStartOffset != null) {
      task.actualStartDay = spec.actualStartOffset;
    }
    if (spec.actualEndOffset != null) {
      task.actualEndDay = spec.actualEndOffset;
    }

    return task;
  });

  // Introduce a small, visible variance so the UI is interesting:
  // - "Clear & grub" was supposed to take 3 days (baseline 3-5), but actual
  //   was 3-6 due to rain. We already set actualEndOffset=6 above.
  // - Bump "Foundation formwork" actual start by +1 so it shows a late-start
  //   badge.
  const formwork = tasks.find(t => t.title.startsWith('Foundation formwork'));
  if (formwork && formwork.baselineStartDay != null) {
    formwork.actualStartDay = formwork.baselineStartDay + 1;
  }

  return generateWbsCodes(tasks);
}
