// utils/demoJob/model.ts — the Demo Job's Living Model (pure).
//
// Four floors of the seven, because a job model holds 60 rooms
// (modelCore.MAX_ROOMS) and the replay draws one floor at a time:
//
//   Level 1  the podium: two retail bays, the residential lobby, the service
//            corridor, back of house and the two stairs (7 rooms). The bays,
//            the lobby and the loading room each have a door to the outside;
//   Level 2  one room per apartment, the corridor, the lobby, the stairs (12);
//   Level 4  room by room: eight apartments (each a living room and kitchen,
//            a bedroom and a bath), the corridor, the lobby, the stairs (28);
//   Level 7  one room per apartment, as Level 2 (12).
//
// 59 rooms. Every room is ticked against the schedule tasks of ITS OWN level,
// so on any one day of Job Replay the floors stand at different stages: the
// lower floors are ahead of the upper ones, as the schedule has them.
//
// A floor is kept at the model level one below its number, so the app's own
// label ("Floor 4") is the floor's real number. The plan sheets
// (scripts/demo-job/draw-plans.ts, assets/demo-job/) are drawn from
// `modelRoomSpecs` below, so the sheets and the model cannot disagree.
//
// Made only with the Living Model's own core (utils/livingModel/modelCore):
// makeRectRoom, addRoom, addOpening, setRoomTaskLink, setTaskStage. Nothing is
// written into the model by hand. The model is saved on the device that taps
// Create (utils/livingModel/store), like any model in this phase.
import { GRID_M, addOpening, addRoom, emptyJobModel, makeRectRoom, setRoomTaskLink, setTaskStage } from '@/utils/livingModel/modelCore';
import type { JobModel, RoomKind } from '@/utils/livingModel/types';
import { RES_LEVELS } from './schedule';

/** The floor drawn room by room. */
export const MODEL_LEVEL = 4;
/** The floors drawn one room per apartment. */
export const UNIT_LEVELS = [2, 7] as const;
/** Every floor in the model, by its real number. */
export const MODEL_LEVELS = [1, 2, 4, 7] as const;
/** The editor's grid is half a foot, so a foot is two grid steps: every room lands on the grid. */
const feetToMetres = (ft: number): number => ft * 2 * GRID_M;
export const CEILING_FT = 9;
export const PODIUM_CEILING_FT = 16;
export const UNIT_W = 25;
export const UNIT_D = 30;
export const CORRIDOR_D = 6;
export const WINDOW_FT = 5;
export const DOOR_FT = 3;
/** A retail bay's storefront. */
const STOREFRONT_FT = 24;
/** The building's outline in feet, in the model's own axes (x right, y down the page). */
export const FOOTPRINT = { x0: -25, y0: 0, x1: UNIT_W * 4 + 10, y1: UNIT_D * 2 + CORRIDOR_D } as const;

export interface RoomSpec {
  /** The floor's real number: 1, 2, 4 or 7. */
  floor: number;
  key: string; name: string; kind: RoomKind; x: number; y: number; w: number; l: number; tasks: string[];
  /** Feet. 9 where left out. */
  ceiling?: number;
  window?: 1 | 3; door?: 1 | 2 | 3 | 4;
  /** Feet. 5 where left out. */
  windowFt?: number;
  /** A second door, to the outside: the wall it is on and its middle, in feet from the room's left edge (a top or bottom wall) or its top edge (a side wall). */
  entry?: { wall: 1 | 2 | 3 | 4; at: number };
}

const floorTaskSets = (n: number) => {
  const L = `l${n}`;
  const shell = [`${L}-frame`, `${L}-elec`, `${L}-spk`, `${L}-insp`, `${L}-insul`, `${L}-dry`, `${L}-paint`, `${L}-floor`, `${L}-punch`];
  const unitRoom = [...shell, `${L}-hvac`, `${L}-trim`];
  const wetRoom = [...unitRoom, `${L}-plumb`, `${L}-cab`];
  const corridor = [`${L}-frame`, `${L}-elec`, `${L}-hvac`, `${L}-spk`, `${L}-insp`, `${L}-insul`, `${L}-dry`, `${L}-paint`, 'common'];
  const stair = ['stairs', `${L}-dry`, `${L}-paint`, 'common'];
  return { unitRoom, wetRoom, corridor, stair };
};

/** The corridor, the elevator lobby and the two stairs of a residential floor. The room-by-room floor keeps its first keys and names. */
function coreRooms(n: number): RoomSpec[] {
  const t = floorTaskSets(n);
  const own = n === MODEL_LEVEL;
  const k = (key: string): string => (own ? key : `l${n}:${key}`);
  const stair = (i: 1 | 2): string => (own ? `Stair ${i}` : `Level ${n} Stair ${i}`);
  return [
    { floor: n, key: k('corridor'), name: `Level ${n} Corridor`, kind: 'hall', x: 0, y: UNIT_D, w: UNIT_W * 4, l: CORRIDOR_D, tasks: t.corridor },
    { floor: n, key: k('lobby'), name: `Level ${n} Elevator Lobby`, kind: 'hall', x: -15, y: UNIT_D - 6, w: 15, l: 18, tasks: [...t.corridor, 'elev'], door: 2 },
    { floor: n, key: k('stair1'), name: stair(1), kind: 'other', x: -25, y: UNIT_D - 6, w: 10, l: 18, tasks: t.stair, door: 2 },
    { floor: n, key: k('stair2'), name: stair(2), kind: 'other', x: UNIT_W * 4, y: UNIT_D - 6, w: 10, l: 18, tasks: t.stair, door: 4 },
  ];
}

/** Where apartment `i` (0 to 7) of a floor sits: four on the north side, four on the south. */
function unitBox(n: number, i: number) {
  const north = i < 4;
  const x = (i % 4) * UNIT_W;
  const y0 = north ? 0 : UNIT_D + CORRIDOR_D;
  // Wall 1 is the top of a room, wall 3 the bottom: the outside wall is the top on the north side.
  const outside: 1 | 3 = north ? 1 : 3;
  const inside: 1 | 3 = north ? 3 : 1;
  return { unit: `${n}0${i + 1}`, north, x, y0, outside, inside };
}

/** Level 4, room by room. */
function detailedFloor(n: number): RoomSpec[] {
  const t = floorTaskSets(n);
  const rooms: RoomSpec[] = [];
  for (let i = 0; i < 8; i += 1) {
    const { unit, north, x, y0, outside, inside } = unitBox(n, i);
    // The bath sits against the corridor, the bedroom against the outside wall.
    const bedY = north ? y0 : y0 + 12;
    const bathY = north ? y0 + 18 : y0;
    rooms.push({ floor: n, key: `${unit}-living`, name: `Unit ${unit} Living Room and Kitchen`, kind: 'living', x, y: y0, w: 15, l: UNIT_D, tasks: t.wetRoom, window: outside, door: inside });
    rooms.push({ floor: n, key: `${unit}-bed`, name: `Unit ${unit} Bedroom`, kind: 'bedroom', x: x + 15, y: bedY, w: 10, l: 18, tasks: t.unitRoom, window: outside, door: 4 });
    rooms.push({ floor: n, key: `${unit}-bath`, name: `Unit ${unit} Bath`, kind: 'bathroom', x: x + 15, y: bathY, w: 10, l: 12, tasks: t.wetRoom, door: 4 });
  }
  return [...rooms, ...coreRooms(n)];
}

/** Levels 2 and 7, one room per apartment. */
function unitFloor(n: number): RoomSpec[] {
  const t = floorTaskSets(n);
  const rooms: RoomSpec[] = [];
  for (let i = 0; i < 8; i += 1) {
    const { unit, x, y0, outside, inside } = unitBox(n, i);
    rooms.push({ floor: n, key: `l${n}:${unit}`, name: `Unit ${unit}`, kind: 'living', x, y: y0, w: UNIT_W, l: UNIT_D, tasks: t.wetRoom, window: outside, door: inside });
  }
  return [...rooms, ...coreRooms(n)];
}

/** Level 1, the podium. The stairs and the lobby stand under the ones above. */
function podiumFloor(): RoomSpec[] {
  // Columns and shear walls, then the retail and lobby rough-in, then the shell finishes.
  const shell = ['pod-col', 'l1-mep', 'l1-fin'];
  const c = PODIUM_CEILING_FT;
  return [
    { floor: 1, key: 'l1:retail-a', name: 'Retail A', kind: 'other', x: 0, y: 0, w: 50, l: UNIT_D, tasks: [...shell, 'storefront'], ceiling: c, window: 1, windowFt: STOREFRONT_FT, door: 3, entry: { wall: 1, at: 44 } },
    { floor: 1, key: 'l1:retail-b', name: 'Retail B', kind: 'other', x: 50, y: 0, w: 50, l: UNIT_D, tasks: [...shell, 'storefront'], ceiling: c, window: 1, windowFt: STOREFRONT_FT, door: 3, entry: { wall: 1, at: 6 } },
    { floor: 1, key: 'l1:service', name: 'Level 1 Service Corridor', kind: 'hall', x: 0, y: UNIT_D, w: UNIT_W * 4, l: CORRIDOR_D, tasks: shell, ceiling: c },
    { floor: 1, key: 'l1:boh', name: 'Mail, Bike Room, Loading and Utility Rooms', kind: 'other', x: 0, y: UNIT_D + CORRIDOR_D, w: UNIT_W * 4, l: UNIT_D, tasks: shell, ceiling: c, door: 1, entry: { wall: 3, at: 85 } },
    { floor: 1, key: 'l1:lobby', name: 'Residential Lobby and Elevators', kind: 'hall', x: -15, y: UNIT_D - 6, w: 15, l: 18, tasks: [...shell, 'elev', 'common'], ceiling: c, door: 2, entry: { wall: 1, at: 7.5 } },
    { floor: 1, key: 'l1:stair1', name: 'Level 1 Stair 1', kind: 'other', x: -25, y: UNIT_D - 6, w: 10, l: 18, tasks: ['pod-col', 'stairs', 'common'], ceiling: c, door: 2 },
    { floor: 1, key: 'l1:stair2', name: 'Level 1 Stair 2', kind: 'other', x: UNIT_W * 4, y: UNIT_D - 6, w: 10, l: 18, tasks: ['pod-col', 'stairs', 'common'], ceiling: c, door: 4 },
  ];
}

/** Every room of the model, floor by floor from the podium up. */
export function modelRoomSpecs(): RoomSpec[] {
  return [...podiumFloor(), ...unitFloor(UNIT_LEVELS[0]), ...detailedFloor(MODEL_LEVEL), ...unitFloor(UNIT_LEVELS[1])];
}

/** The core's walls run clockwise from the top left corner, so the bottom wall runs right to left and the left wall bottom to top. */
function entryAlong(r: RoomSpec): number {
  const e = r.entry!;
  if (e.wall === 3) return r.w - e.at;
  if (e.wall === 4) return r.l - e.at;
  return e.at;
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
      heightM: feetToMetres(r.ceiling ?? CEILING_FT),
      // "Floor 4" in the app is model level 3.
      level: r.floor - 1,
      placement: { xM: feetToMetres(r.x), yM: feetToMetres(r.y), rotationDeg: 0 },
    }));
    if (r.window) model = addOpening(model, { roomId, wallId: `${roomId}-w${r.window}`, id: `${roomId}-win`, kind: 'window', widthM: feetToMetres(r.windowFt ?? WINDOW_FT) });
    if (r.door) model = addOpening(model, { roomId, wallId: `${roomId}-w${r.door}`, id: `${roomId}-door`, kind: 'door', widthM: feetToMetres(DOOR_FT) });
    if (r.entry) model = addOpening(model, { roomId, wallId: `${roomId}-w${r.entry.wall}`, id: `${roomId}-entry`, kind: 'door', widthM: feetToMetres(DOOR_FT), centreAlongM: feetToMetres(entryAlong(r)) });
    for (const t of r.tasks) model = setRoomTaskLink(model, roomId, id(`task:${t}`), true);
  }
  // Stage overrides. "Wall Panels and Floor Deck" has the word "floor" in it, which the
  // stage table reads as finishes. It is framing, on every level, so it is said here.
  for (const n of RES_LEVELS) model = setTaskStage(model, id(`task:l${n}-frame`), 'framing');
  // The stairs and shafts are steel and masonry: drawn as framing, not as Other Work.
  model = setTaskStage(model, id('task:stairs'), 'framing');
  // The podium's structure is concrete columns and shear walls, which the stage table
  // leaves under Other Work. On Level 1 they are what stands where framing stands above.
  model = setTaskStage(model, id('task:pod-col'), 'framing');
  // Common area finishes reads as finishes already; the elevator is Other Work, which is right.
  return model;
}

export type { JobModel };
