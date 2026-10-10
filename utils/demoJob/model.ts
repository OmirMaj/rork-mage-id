// utils/demoJob/model.ts — the Demo Job's Living Model (pure).
//
// One typical residential floor, Level 4: eight apartments on a corridor (each
// a living room and kitchen, a bedroom and a bath), the corridor, two stairs
// and the elevator lobby. 28 rooms, every one ticked against the Level 4
// schedule tasks that happen in it, so Job Replay walks the floor from wall
// panels to finishes.
//
// Made only with the Living Model's own core (utils/livingModel/modelCore):
// makeRectRoom, addRoom, addOpening, setRoomTaskLink, setTaskStage. Nothing is
// written into the model by hand. The model is saved on the device that taps
// Create (utils/livingModel/store), like any model in this phase.
import { GRID_M, addOpening, addRoom, emptyJobModel, makeRectRoom, setRoomTaskLink, setTaskStage } from '@/utils/livingModel/modelCore';
import type { JobModel, RoomKind } from '@/utils/livingModel/types';
import { RES_LEVELS } from './schedule';

export const MODEL_LEVEL = 4;
/** The editor's grid is half a foot, so a foot is two grid steps: every room lands on the grid. */
const feetToMetres = (ft: number): number => ft * 2 * GRID_M;
const CEILING_FT = 9;
const UNIT_W = 25;
const UNIT_D = 30;
const CORRIDOR_D = 6;

interface RoomSpec { key: string; name: string; kind: RoomKind; x: number; y: number; w: number; l: number; tasks: string[]; window?: 1 | 3; door?: 1 | 2 | 3 | 4 }

const L = `l${MODEL_LEVEL}`;
const SHELL = [`${L}-frame`, `${L}-elec`, `${L}-spk`, `${L}-insp`, `${L}-insul`, `${L}-dry`, `${L}-paint`, `${L}-floor`, `${L}-punch`];
const UNIT_ROOM = [...SHELL, `${L}-hvac`, `${L}-trim`];
const WET_ROOM = [...UNIT_ROOM, `${L}-plumb`, `${L}-cab`];

export function modelRoomSpecs(): RoomSpec[] {
  const rooms: RoomSpec[] = [];
  for (let i = 0; i < 8; i += 1) {
    const north = i < 4;
    const col = i % 4;
    const unit = `${MODEL_LEVEL}0${i + 1}`;
    const x = col * UNIT_W;
    const y0 = north ? 0 : UNIT_D + CORRIDOR_D;
    // The bath sits against the corridor, the bedroom against the outside wall.
    const bedY = north ? y0 : y0 + 12;
    const bathY = north ? y0 + 18 : y0;
    // Wall 1 is the top of a room, wall 3 the bottom: the outside wall is the top on the north side.
    const outside: 1 | 3 = north ? 1 : 3;
    const inside: 1 | 3 = north ? 3 : 1;
    rooms.push({ key: `${unit}-living`, name: `Unit ${unit} Living Room and Kitchen`, kind: 'living', x, y: y0, w: 15, l: UNIT_D, tasks: WET_ROOM, window: outside, door: inside });
    rooms.push({ key: `${unit}-bed`, name: `Unit ${unit} Bedroom`, kind: 'bedroom', x: x + 15, y: bedY, w: 10, l: 18, tasks: UNIT_ROOM, window: outside, door: 4 });
    rooms.push({ key: `${unit}-bath`, name: `Unit ${unit} Bath`, kind: 'bathroom', x: x + 15, y: bathY, w: 10, l: 12, tasks: WET_ROOM, door: 4 });
  }
  const corridorTasks = [`${L}-frame`, `${L}-elec`, `${L}-hvac`, `${L}-spk`, `${L}-insp`, `${L}-insul`, `${L}-dry`, `${L}-paint`, 'common'];
  rooms.push({ key: 'corridor', name: `Level ${MODEL_LEVEL} Corridor`, kind: 'hall', x: 0, y: UNIT_D, w: UNIT_W * 4, l: CORRIDOR_D, tasks: corridorTasks });
  rooms.push({ key: 'lobby', name: `Level ${MODEL_LEVEL} Elevator Lobby`, kind: 'hall', x: -15, y: UNIT_D - 6, w: 15, l: 18, tasks: [...corridorTasks, 'elev'], door: 2 });
  rooms.push({ key: 'stair1', name: 'Stair 1', kind: 'other', x: -25, y: UNIT_D - 6, w: 10, l: 18, tasks: ['stairs', `${L}-dry`, `${L}-paint`, 'common'], door: 2 });
  rooms.push({ key: 'stair2', name: 'Stair 2', kind: 'other', x: UNIT_W * 4, y: UNIT_D - 6, w: 10, l: 18, tasks: ['stairs', `${L}-dry`, `${L}-paint`, 'common'], door: 4 });
  return rooms;
}

export function buildDemoModel(id: (key: string) => string): JobModel {
  let model = emptyJobModel(id('project'));
  for (const r of modelRoomSpecs()) {
    const roomId = id(`room:${r.key}`);
    model = addRoom(model, makeRectRoom({
      id: roomId,
      name: r.name,
      kind: r.kind,
      widthM: feetToMetres(r.w),
      lengthM: feetToMetres(r.l),
      heightM: feetToMetres(CEILING_FT),
      level: 0,
      placement: { xM: feetToMetres(r.x), yM: feetToMetres(r.y), rotationDeg: 0 },
    }));
    if (r.window) model = addOpening(model, { roomId, wallId: `${roomId}-w${r.window}`, id: `${roomId}-win`, kind: 'window', widthM: feetToMetres(5) });
    if (r.door) model = addOpening(model, { roomId, wallId: `${roomId}-w${r.door}`, id: `${roomId}-door`, kind: 'door', widthM: feetToMetres(3) });
    for (const t of r.tasks) model = setRoomTaskLink(model, roomId, id(`task:${t}`), true);
  }
  // Stage overrides. "Wall Panels and Floor Deck" has the word "floor" in it, which the
  // stage table reads as finishes. It is framing, on every level, so it is said here.
  for (const n of RES_LEVELS) model = setTaskStage(model, id(`task:l${n}-frame`), 'framing');
  // The stairs and shafts are steel and masonry: drawn as framing, not as Other Work.
  model = setTaskStage(model, id('task:stairs'), 'framing');
  // Common area finishes reads as finishes already; the elevator is Other Work, which is right.
  return model;
}

export type { JobModel };
