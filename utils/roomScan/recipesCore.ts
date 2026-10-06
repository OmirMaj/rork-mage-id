// utils/roomScan/recipesCore.ts — which quantities a kind of room is priced from.
//
// Pure data. One row is one draft estimate line: which scan quantity it reads,
// its unit, the trade it looks up first in the contractor's own cost book, the
// words used to find his own trade name when that first lookup misses, the
// waste added ONCE at pricing, and where a catalog price may come from when he
// has no price of his own.
//
// THE WORDS MATTER. utils/takeoffPricing.matchOwnRate matches a line to a book
// trade by word overlap. A count line carries only words that name the THING
// ("toilet", "door"), never the trade family ("plumbing"): a book rate for
// "Plumbing, each" could be a valve, and pricing a toilet from it would be a
// wrong number wearing the "Your Price" label.

import type { ConditionKind, WastePct } from '@/utils/takeoff/conditions';
import type { RoomType, ScanQuantities } from './types';

export type RecipeKey =
  | 'floor_tile' | 'floor' | 'wall_drywall' | 'wall_paint' | 'ceiling_paint' | 'baseboard'
  | 'door' | 'window' | 'toilet' | 'sink' | 'bathtub';

export interface RecipeLine {
  key: RecipeKey;
  kind: ConditionKind;
  /** The trade tried first, exactly, in his cost book. */
  defaultTrade: string;
  /** Words for the fuzzy match when the exact trade is not in his book. */
  matchWords: string;
  wastePct: WastePct;
  /** constants/materials category (and one named item for a count line), or null when the catalog has nothing honest to offer. */
  catalog: { category: string; item?: string } | null;
}

const FLOOR_TILE: RecipeLine = { key: 'floor_tile', kind: 'area', defaultTrade: 'Tile', matchWords: 'floor tile flooring', wastePct: 10, catalog: { category: 'flooring' } };
const FLOOR: RecipeLine = { key: 'floor', kind: 'area', defaultTrade: 'Flooring', matchWords: 'floor flooring', wastePct: 10, catalog: { category: 'flooring' } };
const WALL_DRYWALL: RecipeLine = { key: 'wall_drywall', kind: 'area', defaultTrade: 'Drywall', matchWords: 'drywall sheetrock', wastePct: 10, catalog: null };
const WALL_PAINT: RecipeLine = { key: 'wall_paint', kind: 'area', defaultTrade: 'Painting', matchWords: 'paint painting walls', wastePct: 0, catalog: null };
const CEILING_PAINT: RecipeLine = { key: 'ceiling_paint', kind: 'area', defaultTrade: 'Painting', matchWords: 'paint painting ceiling', wastePct: 0, catalog: null };
const BASEBOARD: RecipeLine = { key: 'baseboard', kind: 'linear', defaultTrade: 'Baseboard', matchWords: 'baseboard base trim', wastePct: 10, catalog: null };
const DOOR: RecipeLine = { key: 'door', kind: 'count', defaultTrade: 'Interior Door', matchWords: 'interior door doors', wastePct: 0, catalog: { category: 'windows', item: 'Prehung Interior Door' } };
const TOILET: RecipeLine = { key: 'toilet', kind: 'count', defaultTrade: 'Toilet', matchWords: 'toilet', wastePct: 0, catalog: { category: 'plumbing', item: 'Toilet Standard' } };
const BATH_SINK: RecipeLine = { key: 'sink', kind: 'count', defaultTrade: 'Vanity Sink', matchWords: 'sink vanity lavatory', wastePct: 0, catalog: { category: 'plumbing', item: 'Bathroom Vanity Sink' } };
const KITCHEN_SINK: RecipeLine = { key: 'sink', kind: 'count', defaultTrade: 'Kitchen Sink', matchWords: 'sink kitchen', wastePct: 0, catalog: { category: 'plumbing', item: 'Kitchen Sink' } };
const BATHTUB: RecipeLine = { key: 'bathtub', kind: 'count', defaultTrade: 'Bathtub', matchWords: 'bathtub tub', wastePct: 0, catalog: null };

export const ROOM_RECIPES: Record<RoomType, readonly RecipeLine[]> = {
  bathroom: [FLOOR_TILE, WALL_DRYWALL, WALL_PAINT, CEILING_PAINT, BASEBOARD, DOOR, TOILET, BATH_SINK, BATHTUB],
  kitchen: [FLOOR, WALL_DRYWALL, WALL_PAINT, CEILING_PAINT, BASEBOARD, DOOR, KITCHEN_SINK],
  bedroom: [FLOOR, WALL_PAINT, CEILING_PAINT, BASEBOARD, DOOR],
  room: [FLOOR, WALL_PAINT, CEILING_PAINT, BASEBOARD, DOOR],
};

export const ROOM_TYPES: readonly RoomType[] = ['bathroom', 'kitchen', 'bedroom', 'room'];

/** The scan quantity a recipe line reads, before waste. null when the scan cannot say (an open outline has no floor). */
export function recipeQuantity(key: RecipeKey, q: ScanQuantities): number | null {
  const fixture = (c: string) => q.fixtures.find((f) => f.category === c)?.count ?? 0;
  switch (key) {
    case 'floor_tile':
    case 'floor': return q.floorAreaSF;
    case 'wall_drywall':
    case 'wall_paint': return q.netWallSF;
    case 'ceiling_paint': return q.ceilingAreaSF;
    case 'baseboard': return q.baseboardLF;
    case 'door': return q.doorCount;
    case 'window': return q.windowCount;
    case 'toilet': return fixture('toilet');
    case 'sink': return fixture('sink');
    case 'bathtub': return fixture('bathtub');
  }
}

/** English line names. The screen passes the person's language instead (hooks/useRoomScanCopy.ts). */
export const RECIPE_NAMES_EN: Record<RecipeKey, string> = {
  floor_tile: 'Floor Tile',
  floor: 'Flooring',
  wall_drywall: 'Drywall, Walls',
  wall_paint: 'Paint, Walls',
  ceiling_paint: 'Paint, Ceiling',
  baseboard: 'Baseboard',
  door: 'Interior Door, Hung',
  window: 'Window',
  toilet: 'Set Toilet',
  sink: 'Set Sink',
  bathtub: 'Set Bathtub',
};
