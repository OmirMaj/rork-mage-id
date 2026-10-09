// utils/livingModel/types.ts — the JOB MODEL: one job, many rooms.
//
// The Living Model, Phase 1 (dark behind LIVING_MODEL_ENABLED, owner preview).
// Pure data: no React, no React Native, no storage.
//
// A room here IS the scanner's room model. The shape of a room (walls with end
// points, openings on a wall, fixtures, the floor outline, the ceiling height)
// is taken from utils/roomScan/types.ts and is not forked: `RoomShape` is a
// Pick of RoomScan. What this file adds is everything the scanner never had:
// where a room sits on a floor, which floor, what kind of room it is, and
// which schedule tasks a person said happen in it.
//
// Lengths are METRES everywhere, as in the scanner. Feet and inches exist only
// at the edge (utils/roomScan/units.ts).
//
// PLAN AXES. A placed room is kept in "drawing" axes: x runs right and y runs
// DOWN the page, so the editor and the flat views draw the numbers as they are.
// A scan arrives with y up (utils/roomScan/geometryCore.planPoint); the one
// place that turns it over is modelCore.roomFromScan.
//
// THIS IS A SCHEMATIC. Nothing here is a survey and nothing is to scale for
// building. A typed room is a rectangle the person typed. A scanned room keeps
// the scanner's own caveat (a phone scan can be off by an inch or more).

import type { RoomScan } from '@/utils/roomScan/types';

/** The scanner's room geometry, reused as it is. */
export type RoomShape = Pick<RoomScan, 'walls' | 'openings' | 'objects' | 'floor' | 'ceilingHeightM'>;

export type RoomKind =
  | 'kitchen' | 'bathroom' | 'bedroom' | 'living' | 'dining' | 'hall'
  | 'closet' | 'laundry' | 'garage' | 'basement' | 'office' | 'other';

export const ROOM_KINDS: readonly RoomKind[] = [
  'kitchen', 'bathroom', 'bedroom', 'living', 'dining', 'hall',
  'closet', 'laundry', 'garage', 'basement', 'office', 'other',
];

/** Quarter turns only in this phase. */
export type QuarterTurn = 0 | 90 | 180 | 270;

/**
 * Where a room sits on its floor. (xM, yM) is the top left corner of the box
 * around the room AFTER it is turned, so a turn keeps that corner where it is
 * and a snapped room stays snapped.
 */
export interface Placement {
  xM: number;
  yM: number;
  rotationDeg: QuarterTurn;
}

export interface PlacedRoom {
  id: string;
  /** Typed by the person. Never invented for a typed room. A scan brings the name he gave it. */
  name: string;
  kind: RoomKind;
  /** 0 is the first floor drawn, 1 the floor above it, -1 the floor below. */
  level: number;
  placement: Placement;
  /** 'typed' = a rectangle from typed sizes. 'scan' = dropped in from a saved scan. */
  source: 'typed' | 'scan';
  /** The saved scan this room came from, when it came from one. */
  scanId?: string;
  /** The room geometry in its OWN axes (before the placement), metres. */
  room: RoomShape;
}

export interface JobModel {
  version: 1;
  projectId: string;
  rooms: PlacedRoom[];
  /**
   * Room id to the schedule task ids a person TICKED for it. A suggestion is
   * never written here: only modelCore.setRoomTaskLink and
   * linkCore.confirmSuggestions (both called from a tap) add an id.
   */
  links: Record<string, string[]>;
  /** ISO. '' for a model nobody has saved yet. */
  updatedAt: string;
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export type ModelIssueCode =
  | 'not_a_number'
  | 'duplicate_room_id'
  | 'no_walls'
  | 'outline_open'
  | 'ceiling_missing'
  | 'opening_off_wall'
  | 'rooms_overlap'
  | 'link_to_missing_room'
  | 'name_missing';

export interface ModelIssue {
  code: ModelIssueCode;
  /** 'error' = the model cannot be drawn as it is. 'warning' = it draws, and the person should look. */
  level: 'error' | 'warning';
  roomIds: string[];
}

export interface ModelCheck {
  ok: boolean;
  errors: ModelIssue[];
  warnings: ModelIssue[];
}

/** One wall in world metres with its holes, for anything that draws. */
export interface WorldOpening {
  id: string;
  kind: 'door' | 'window' | 'opening';
  /** Along the wall from end `a`, metres. */
  s0: number;
  s1: number;
  /** Bottom and top above the floor, metres. */
  y0: number;
  y1: number;
}

export interface WorldWall {
  id: string;
  label: string;
  a: { x: number; y: number };
  b: { x: number; y: number };
  lengthM: number;
  heightM: number;
  /** Unit vector pointing INTO the room, in plan axes. */
  inward: { x: number; y: number };
  openings: WorldOpening[];
}
