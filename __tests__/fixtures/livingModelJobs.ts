// __tests__/fixtures/livingModelJobs.ts — two hand-worked jobs for the Living Model.
//
// Used by scripts/validate-living-model.ts, the jest smoke suite and the
// screenshot harness. Sizes are typed in FEET here and every answer below was
// worked out by hand, in feet, before the code was run.
//
// THREE ROOMS (a small remodel)
//   Kitchen 12 x 10 at (0, 0)      120 sq ft
//   Bath     8 x 10 at (12, 0)      80 sq ft   touches the kitchen along x = 12
//   Hall    20 x  4 at (0, 10)      80 sq ft   touches both along y = 10
//   box: x 0 to 20, y 0 to 14       280 sq ft in all, no overlap
//
// SEVEN ROOMS (an apartment, 28 ft square)
//   Living Room 16 x 14 at (0, 0)   224
//   Kitchen     12 x 14 at (16, 0)  168
//   Hall        28 x  4 at (0, 14)  112
//   Bedroom 1   12 x 10 at (0, 18)  120
//   Bath        typed 10 x 6, turned a quarter turn, so it stands 6 x 10 at (12, 18)   60
//   Closet       4 x 10 at (18, 18)  40
//   Bedroom 2    6 x 10 at (22, 18)  60
//   box: x 0 to 28, y 0 to 28       784 sq ft in all (28 x 28), no overlap
import { addOpening, addRoom, emptyJobModel, makeRectRoom } from '@/utils/livingModel/modelCore';
import type { ReplayClock, ReplayTask, ReportPoint } from '@/utils/livingModel/replayCore';
import type { JobModel, QuarterTurn, RoomKind } from '@/utils/livingModel/types';
import { feetToMetres as ft } from '@/utils/roomScan/units';

type Row = [id: string, name: string, kind: RoomKind, w: number, l: number, x: number, y: number, turn?: QuarterTurn];

function build(projectId: string, rows: Row[]): JobModel {
  let m = emptyJobModel(projectId);
  for (const [id, name, kind, w, l, x, y, turn] of rows) {
    m = addRoom(m, makeRectRoom({ id, name, kind, widthM: ft(w), lengthM: ft(l), heightM: ft(8), placement: { xM: ft(x), yM: ft(y), rotationDeg: turn ?? 0 } }));
  }
  return m;
}

export function threeRoomJob(): JobModel {
  let m = build('p-three', [
    ['kitchen', 'Kitchen', 'kitchen', 12, 10, 0, 0],
    ['bath', 'Bath', 'bathroom', 8, 10, 12, 0],
    ['hall', 'Hall', 'hall', 20, 4, 0, 10],
  ]);
  m = addOpening(m, { roomId: 'kitchen', wallId: 'kitchen-w3', id: 'k-door', kind: 'door', widthM: ft(3) });
  m = addOpening(m, { roomId: 'kitchen', wallId: 'kitchen-w1', id: 'k-win', kind: 'window', widthM: ft(4) });
  m = addOpening(m, { roomId: 'bath', wallId: 'bath-w3', id: 'b-door', kind: 'door', widthM: ft(2.5) });
  m = addOpening(m, { roomId: 'bath', wallId: 'bath-w2', id: 'b-win', kind: 'window', widthM: ft(2) });
  return m;
}
export const THREE_ROOM_ANSWERS = { boxFt: { minX: 0, minY: 0, maxX: 20, maxY: 14 }, areasSqFt: { kitchen: 120, bath: 80, hall: 80 }, totalSqFt: 280 } as const;

export function sevenRoomJob(): JobModel {
  let m = build('p-seven', [
    ['living', 'Living Room', 'living', 16, 14, 0, 0],
    ['kitchen', 'Kitchen', 'kitchen', 12, 14, 16, 0],
    ['hall', 'Hall', 'hall', 28, 4, 0, 14],
    ['bed1', 'Bedroom 1', 'bedroom', 12, 10, 0, 18],
    ['bath', 'Bath', 'bathroom', 10, 6, 12, 18, 90],
    ['closet', 'Closet', 'closet', 4, 10, 18, 18],
    ['bed2', 'Bedroom 2', 'bedroom', 6, 10, 22, 18],
  ]);
  const add = (roomId: string, wall: number, kind: 'door' | 'window', w: number, at?: number) => {
    m = addOpening(m, { roomId, wallId: `${roomId}-w${wall}`, id: `${roomId}-${kind}-${wall}`, kind, widthM: ft(w), centreAlongM: at != null ? ft(at) : undefined });
  };
  add('living', 1, 'window', 6);
  add('living', 4, 'window', 5);
  add('living', 3, 'door', 3, 4);
  add('kitchen', 1, 'window', 4);
  add('kitchen', 3, 'door', 3, 6);
  add('bed1', 1, 'door', 2.67, 3);
  add('bed1', 3, 'window', 5);
  add('bath', 4, 'door', 2.5);
  add('closet', 1, 'door', 2.5);
  add('bed2', 1, 'door', 2.67);
  add('bed2', 3, 'window', 3);
  // Every room gets the whole-house tasks; the wet rooms get the plumbing; the bath gets the tile; the kitchen the cabinets.
  const all = ['demo', 'frame', 'elec', 'insp', 'insul', 'dry', 'paint', 'trim', 'clean'];
  const links: Record<string, string[]> = {};
  for (const r of m.rooms) links[r.id] = [...all];
  links.kitchen.push('plumb', 'cab');
  links.bath.push('plumb', 'tile');
  return { ...m, links };
}
export const SEVEN_ROOM_ANSWERS = {
  boxFt: { minX: 0, minY: 0, maxX: 28, maxY: 28 },
  areasSqFt: { living: 224, kitchen: 168, hall: 112, bed1: 120, bath: 60, closet: 40, bed2: 60 },
  totalSqFt: 784,
} as const;

/**
 * A ten-week schedule on a five-day week, and what was reported by the end of
 * day 28. Task: [id, title, stage, first day, days, progress, status].
 * Reported: demolition, framing, both rough-ins, the inspection and the
 * insulation are finished; drywall is at 30 (the plan says 5 of 8 days, 62.5);
 * nothing after it has anything reported.
 */
export function tenWeekSchedule(): { tasks: ReplayTask[]; points: ReportPoint[]; clock: ReplayClock } {
  const T = (id: string, title: string, stage: ReplayTask['stage'], startDay: number, durationDays: number, progress: number, status: ReplayTask['status']): ReplayTask =>
    ({ id, title, stage, startDay, durationDays, progress, status, actualEndOffset: null, actualStartOffset: null });
  const tasks: ReplayTask[] = [
    T('demo', 'Demo', 'demolition', 1, 5, 100, 'done'),
    T('frame', 'Framing', 'framing', 6, 7, 100, 'done'),
    T('plumb', 'Rough plumbing', 'rough_in', 13, 5, 100, 'done'),
    T('elec', 'Rough electrical', 'rough_in', 13, 7, 100, 'done'),
    T('insp', 'Rough inspection', 'other', 20, 1, 100, 'done'),
    T('insul', 'Insulation', 'insulation', 21, 3, 0, 'not_started'),
    T('dry', 'Drywall', 'drywall', 24, 8, 30, 'in_progress'),
    T('tile', 'Tile', 'finishes', 32, 5, 0, 'not_started'),
    T('paint', 'Paint', 'finishes', 37, 6, 0, 'not_started'),
    T('trim', 'Trim and doors', 'finishes', 41, 6, 0, 'not_started'),
    T('cab', 'Kitchen cabinets', 'finishes', 43, 5, 0, 'not_started'),
    T('clean', 'Final clean', 'other', 48, 3, 0, 'not_started'),
  ];
  const points: ReportPoint[] = [
    { taskId: 'demo', offset: 3, pct: 60 }, { taskId: 'demo', offset: 5, pct: 100 },
    { taskId: 'frame', offset: 9, pct: 50 }, { taskId: 'frame', offset: 13, pct: 100 },
    { taskId: 'plumb', offset: 15, pct: 40 }, { taskId: 'plumb', offset: 18, pct: 100 },
    { taskId: 'elec', offset: 16, pct: 50 }, { taskId: 'elec', offset: 20, pct: 100 },
    { taskId: 'insp', offset: 21, pct: 100 },
    { taskId: 'insul', offset: 22, pct: 50 }, { taskId: 'insul', offset: 24, pct: 100 },
    { taskId: 'dry', offset: 27, pct: 20 },
  ];
  return { tasks, points, clock: { totalDays: 50, workingDaysPerWeek: 5, todayOffset: 28, hasStartDate: true } };
}
