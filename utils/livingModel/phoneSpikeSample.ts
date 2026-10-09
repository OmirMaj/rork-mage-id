// utils/livingModel/phoneSpikeSample.ts — the sample jobs the phone 3D check draws
// (app/dev-phone-3d.tsx, lane PHONE3D). PURE: no React, no storage.
//
// The seven-room apartment and the ten-week schedule are a COPY of the Living
// Model's own fixture (__tests__/fixtures/livingModelJobs.ts). They are copied,
// not imported, because Metro leaves __tests__ out of every bundle, which is
// right. scripts/validate-phone-3d.ts fails if the copy and the fixture ever
// differ. The forty-room grid exists only to time a larger model.
import { addOpening, addRoom, emptyJobModel, makeRectRoom } from './modelCore';
import type { ReplayClock, ReplayTask, ReportPoint } from './replayCore';
import type { JobModel, QuarterTurn, RoomKind } from './types';
import { feetToMetres as ft } from '@/utils/roomScan/units';

type Row = [id: string, name: string, kind: RoomKind, w: number, l: number, x: number, y: number, turn?: QuarterTurn];

function build(projectId: string, rows: Row[]): JobModel {
  let m = emptyJobModel(projectId);
  for (const [id, name, kind, w, l, x, y, turn] of rows) {
    m = addRoom(m, makeRectRoom({ id, name, kind, widthM: ft(w), lengthM: ft(l), heightM: ft(8), placement: { xM: ft(x), yM: ft(y), rotationDeg: turn ?? 0 } }));
  }
  return m;
}

export function spikeSevenRoomJob(): JobModel {
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
export function spikeTenWeekSchedule(): { tasks: ReplayTask[]; points: ReportPoint[]; clock: ReplayClock } {
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

const WHOLE_HOUSE = ['demo', 'frame', 'elec', 'insp', 'insul', 'dry', 'paint', 'trim', 'clean'];

/** Forty rooms, eight across and five deep, each 12 by 10 feet with a door, and a window on the outside row. */
export function spikeFortyRoomJob(): JobModel {
  const kinds: RoomKind[] = ['bedroom', 'bathroom', 'kitchen', 'living', 'hall', 'closet'];
  let m = emptyJobModel('p-forty');
  const links: Record<string, string[]> = {};
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 8; col++) {
      const id = `r${row}-${col}`;
      const kind = kinds[(row * 8 + col) % kinds.length];
      m = addRoom(m, makeRectRoom({ id, name: `Room ${row * 8 + col + 1}`, kind, widthM: ft(12), lengthM: ft(10), heightM: ft(8), placement: { xM: ft(col * 12), yM: ft(row * 10), rotationDeg: 0 } }));
      m = addOpening(m, { roomId: id, wallId: `${id}-w3`, id: `${id}-door`, kind: 'door', widthM: ft(2.67) });
      if (row === 0) m = addOpening(m, { roomId: id, wallId: `${id}-w1`, id: `${id}-win`, kind: 'window', widthM: ft(4) });
      links[id] = kind === 'bathroom' || kind === 'kitchen' ? [...WHOLE_HOUSE, 'plumb'] : [...WHOLE_HOUSE];
    }
  }
  return { ...m, links };
}
