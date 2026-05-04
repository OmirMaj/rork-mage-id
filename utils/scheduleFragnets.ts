// scheduleFragnets — reusable task templates that drag onto a schedule
// with their dependency network intact. Asta calls these "task pools";
// P6 calls them "Fragnets" (Fragmentary Networks). We expose the same.
//
// Lifecycle:
//   1. User picks a chunk of tasks on an existing schedule + saves them
//      as a fragnet via `captureFragnet(tasks, name)`. We snapshot the
//      title / phase / duration / dependencies, normalize ids, and
//      store the resulting `ScheduleFragnet` on the project (or in a
//      cross-project library).
//   2. User opens a different schedule and drops the fragnet via
//      `applyFragnet(fragnet, atDay, idPrefix)`. We materialize new
//      tasks at the requested start day, remap fragnet-local ids to
//      fresh project ids, and re-wire dependencies.
//
// Storage: project-scoped on `ProjectSchedule.fragnets`. A future global
// library can live in AsyncStorage or a Supabase table — the same
// captureFragnet output works as the unit of exchange.

import type { ScheduleFragnet, ScheduleTask } from '@/types';

function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Snapshot a list of tasks as a fragnet. The earliest task becomes
 * fragnet day-1; all other tasks rebase relative to that.
 */
export function captureFragnet(
  tasks: ScheduleTask[],
  args: { name: string; category?: string; description?: string },
): ScheduleFragnet {
  if (tasks.length === 0) {
    throw new Error('Cannot capture an empty fragnet — pick at least one task.');
  }
  const minStart = Math.min(...tasks.map(t => t.startDay));
  const taskIds = new Set(tasks.map(t => t.id));
  return {
    id: generateId('frag'),
    name: args.name,
    category: args.category,
    description: args.description,
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      phase: t.phase,
      durationDays: t.durationDays,
      startDay: t.startDay - minStart + 1,
      // Keep only dependencies that point to other tasks in the same
      // fragnet — external deps are dropped, the user re-wires after
      // applying.
      dependencies: (t.dependencies ?? []).filter(d => taskIds.has(d)),
      isMilestone: t.isMilestone,
    })),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Materialize a fragnet's tasks onto a target schedule. Returns the new
 * tasks (caller appends to schedule + commits). Each task gets a fresh
 * id; dependencies are remapped to the new ids.
 */
export function applyFragnet(
  fragnet: ScheduleFragnet,
  args: { atDay: number; phaseOverride?: string; idPrefix?: string },
): ScheduleTask[] {
  const { atDay, phaseOverride, idPrefix = 'task' } = args;
  // Step 1: build id remap.
  const idMap = new Map<string, string>();
  for (const t of fragnet.tasks) {
    idMap.set(t.id, generateId(idPrefix));
  }
  // Step 2: emit new tasks.
  return fragnet.tasks.map(t => ({
    id: idMap.get(t.id)!,
    title: t.title,
    phase: phaseOverride ?? t.phase,
    durationDays: Math.max(1, t.durationDays),
    startDay: Math.max(1, atDay + t.startDay - 1),
    progress: 0,
    crew: '',
    dependencies: t.dependencies.map(d => idMap.get(d)).filter((x): x is string => !!x),
    notes: '',
    status: 'not_started',
    isMilestone: t.isMilestone,
  }));
}

/** Update a fragnet on the project's library — replaces the matched id. */
export function upsertFragnet(
  library: ScheduleFragnet[],
  fragnet: ScheduleFragnet,
): ScheduleFragnet[] {
  const idx = library.findIndex(f => f.id === fragnet.id);
  if (idx < 0) return [...library, fragnet];
  const next = [...library];
  next[idx] = { ...fragnet, updatedAt: new Date().toISOString() };
  return next;
}

export function deleteFragnet(library: ScheduleFragnet[], id: string): ScheduleFragnet[] {
  return library.filter(f => f.id !== id);
}

/** A small handful of canned fragnets for first-time users — drag any
 *  onto a fresh schedule to instantly see how the feature works. */
export const STARTER_FRAGNETS: ScheduleFragnet[] = [
  {
    id: 'starter_bath_rough_in',
    name: 'Bathroom rough-in',
    category: 'Plumbing / MEP',
    description: '8 tasks, ~7 working days. Demo through cap + inspection.',
    tasks: [
      { id: 't1', title: 'Demo existing fixtures', phase: 'Demo', durationDays: 1, startDay: 1, dependencies: [] },
      { id: 't2', title: 'Open walls + ceiling', phase: 'Demo', durationDays: 1, startDay: 2, dependencies: ['t1'] },
      { id: 't3', title: 'Plumbing rough-in (DWV + supply)', phase: 'MEP', durationDays: 2, startDay: 3, dependencies: ['t2'] },
      { id: 't4', title: 'Electrical rough-in', phase: 'MEP', durationDays: 1, startDay: 3, dependencies: ['t2'] },
      { id: 't5', title: 'HVAC vent runs', phase: 'MEP', durationDays: 1, startDay: 4, dependencies: ['t2'] },
      { id: 't6', title: 'Inspection — rough-in', phase: 'Inspection', durationDays: 1, startDay: 5, dependencies: ['t3', 't4', 't5'], isMilestone: true },
      { id: 't7', title: 'Insulation', phase: 'Insulation', durationDays: 1, startDay: 6, dependencies: ['t6'] },
      { id: 't8', title: 'Drywall + cap inspection', phase: 'Drywall', durationDays: 1, startDay: 7, dependencies: ['t7'] },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'starter_kitchen_finish',
    name: 'Kitchen finish-out',
    category: 'Finishes',
    description: '7 tasks, ~10 working days. Cabinets through punch.',
    tasks: [
      { id: 't1', title: 'Cabinet install', phase: 'Cabinets', durationDays: 2, startDay: 1, dependencies: [] },
      { id: 't2', title: 'Countertop template', phase: 'Cabinets', durationDays: 1, startDay: 3, dependencies: ['t1'] },
      { id: 't3', title: 'Backsplash tile', phase: 'Tile', durationDays: 2, startDay: 4, dependencies: ['t1'] },
      { id: 't4', title: 'Countertop install', phase: 'Cabinets', durationDays: 1, startDay: 8, dependencies: ['t2'] },
      { id: 't5', title: 'Plumbing trim — sink + DW', phase: 'MEP', durationDays: 1, startDay: 9, dependencies: ['t4'] },
      { id: 't6', title: 'Appliance install', phase: 'Appliances', durationDays: 1, startDay: 10, dependencies: ['t5'] },
      { id: 't7', title: 'Punch + final clean', phase: 'Closeout', durationDays: 1, startDay: 11, dependencies: ['t6'] },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'starter_foundation',
    name: 'Spread footing foundation',
    category: 'Concrete',
    description: '6 tasks, ~8 working days. Excavation through inspection.',
    tasks: [
      { id: 't1', title: 'Excavate footings', phase: 'Sitework', durationDays: 1, startDay: 1, dependencies: [] },
      { id: 't2', title: 'Form footings', phase: 'Concrete', durationDays: 1, startDay: 2, dependencies: ['t1'] },
      { id: 't3', title: 'Place rebar', phase: 'Concrete', durationDays: 1, startDay: 3, dependencies: ['t2'] },
      { id: 't4', title: 'Inspection — footings', phase: 'Inspection', durationDays: 1, startDay: 4, dependencies: ['t3'], isMilestone: true },
      { id: 't5', title: 'Pour footings', phase: 'Concrete', durationDays: 1, startDay: 5, dependencies: ['t4'] },
      { id: 't6', title: 'Cure + strip forms', phase: 'Concrete', durationDays: 3, startDay: 6, dependencies: ['t5'] },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];
