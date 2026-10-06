// utils/roomScan/quantitiesCore.ts — a room model to the numbers a contractor prices.
//
// Pure. Every figure is worked out from the model at the moment it is asked
// for, so a typed correction (utils/roomScan/editsCore.ts) changes the
// quantities with no second step.
//
// The rules, each pinned by scripts/validate-scan-room.ts:
//   Floor area      shoelace on the closed outline. An OPEN outline has no floor area: null, never a guess.
//   Perimeter       the sum of the outline walls' lengths.
//   Gross wall      length times height per outline wall (a slanted wall's own shape when iOS 17 gives one).
//   Openings        width times height of every door, window and opening, clipped to its wall, counted ONCE.
//   Net wall        gross less openings.
//   Ceiling         the floor area. A ceiling that varies is flagged and shown as the flat equivalent.
//   Baseboard       perimeter less the widths of doors and of openings that start at the floor.
//   Crown           perimeter less the widths of openings that reach the ceiling.
//   Casing          two legs and a head per door, one side.
//   Fixtures        kitchen and bath objects, counted by kind. Furniture is not a quantity.
// No waste is added here. Waste belongs to pricing, where it is added once.

import { CEILING_TOL_M, FLOOR_TOL_M, polygonArea } from './geometryCore';
import { M_TO_FT, metresToFeet, metresToInches, nominalDoorWidthIn, sqMetresToSqFeet } from './units';
import type {
  DoorSize, QuantityFlag, RoomScan, ScanFact, ScanOpening, ScanQuantities, ScanWall, WindowSize,
} from './types';

/** Apple's objects that are priced work in a kitchen or bath. Everything else (bed, sofa, chair, table ...) is ignored. */
export const FIXTURE_CATEGORIES = [
  'toilet', 'sink', 'bathtub', 'stove', 'oven', 'refrigerator', 'dishwasher', 'washerDryer',
] as const;

/** Apple's stated single-room limit: about 30 ft a side. */
export const SIZE_LIMIT_M = 30 / M_TO_FT;

function wallHeight(w: ScanWall, scan: RoomScan): number {
  return w.heightM > 0 ? w.heightM : scan.ceilingHeightM.typical;
}

/** One wall's face area in square metres. */
export function wallAreaM2(w: ScanWall, scan: RoomScan): number {
  if (w.polygon && w.polygon.length >= 3 && w.lengthSource === 'scan' && w.scanLengthM > 0) {
    const a = polygonArea(w.polygon.map((p) => ({ x: p.u, y: p.v })));
    // The shape is in the wall's own plane at Apple's width; carry it to the outline length.
    if (a > 0) return a * (w.lengthM / w.scanLengthM);
  }
  return w.lengthM * wallHeight(w, scan);
}

/** The part of an opening's width that lies on its wall. */
export function clippedWidthM(o: ScanOpening, wall: ScanWall): number {
  const lo = Math.max(0, o.offsetM);
  const hi = Math.min(wall.lengthM, o.offsetM + o.widthM);
  return Math.max(0, hi - lo);
}

function clippedHeightM(o: ScanOpening, wall: ScanWall, scan: RoomScan): number {
  const h = wallHeight(wall, scan);
  return h > 0 ? Math.max(0, Math.min(o.heightM, h - o.sillM)) : o.heightM;
}

export function computeQuantities(scan: RoomScan, opts: { casingSides?: 1 | 2 } = {}): ScanQuantities {
  const flags = new Set<QuantityFlag>();
  const outline = scan.walls.filter((w) => w.onOutline);
  const byId = new Map(outline.map((w) => [w.id, w]));
  const closed = scan.closure.closed && scan.floor.length >= 3;
  if (!closed) flags.add(scan.closure.cause === 'typed' ? 'typed_lengths_do_not_close' : 'not_closed');
  if (scan.walls.some((w) => !w.onOutline)) flags.add('walls_off_outline');
  if (outline.some((w) => w.confidence === 'low' && w.lengthSource === 'scan')) flags.add('low_confidence_wall');
  if (outline.some((w) => w.curved)) flags.add('curved_wall');

  const ceil = scan.ceilingHeightM;
  if (!ceil.known) flags.add('ceiling_height_missing');
  else if (ceil.max - ceil.min > CEILING_TOL_M) flags.add('ceiling_varies');

  const perimeterM = outline.reduce((s, w) => s + w.lengthM, 0);
  const floorM2 = closed ? polygonArea(scan.floor) : null;

  // Each opening once, however many times it appears in the list.
  const seen = new Set<string>();
  const openings = scan.openings.filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));

  let openingM2 = 0;
  let baseboardOutM = 0;
  let crownOutM = 0;
  let casingM = 0;
  for (const o of openings) {
    const wall = o.wallId ? byId.get(o.wallId) : undefined;
    if (!wall) { flags.add('opening_without_wall'); continue; }
    const w = clippedWidthM(o, wall);
    const h = clippedHeightM(o, wall, scan);
    openingM2 += w * h;
    const atFloor = o.sillM < FLOOR_TOL_M;
    if (o.kind === 'door' || (o.kind === 'opening' && atFloor)) baseboardOutM += w;
    const wh = wallHeight(wall, scan);
    if (o.kind === 'opening' && wh > 0 && o.sillM + o.heightM >= wh - CEILING_TOL_M) crownOutM += w;
  }
  const doorsList = openings.filter((o) => o.kind === 'door');
  const windowsList = openings.filter((o) => o.kind === 'window');
  for (const d of doorsList) casingM += (2 * d.heightM + d.widthM) * (opts.casingSides ?? 1);

  const grossM2 = ceil.known ? outline.reduce((s, w) => s + wallAreaM2(w, scan), 0) : null;

  // The room's reach along and across its longest wall.
  if (outline.length) {
    const longest = outline.reduce((m, w) => (w.lengthM > m.lengthM ? w : m));
    const ang = Math.atan2(longest.b.y - longest.a.y, longest.b.x - longest.a.x);
    const c = Math.cos(-ang);
    const s = Math.sin(-ang);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const w of outline) for (const p of [w.a, w.b]) { xs.push(p.x * c - p.y * s); ys.push(p.x * s + p.y * c); }
    if (Math.max(...xs) - Math.min(...xs) > SIZE_LIMIT_M || Math.max(...ys) - Math.min(...ys) > SIZE_LIMIT_M) flags.add('over_size_limit');
  }

  const doorMap = new Map<string, DoorSize>();
  for (const d of doorsList) {
    const widthIn = Math.round(metresToInches(d.widthM));
    const heightIn = Math.round(metresToInches(d.heightM));
    const key = `${widthIn}x${heightIn}`;
    const row = doorMap.get(key) ?? { widthIn, heightIn, nominalWidthIn: nominalDoorWidthIn(metresToInches(d.widthM)), count: 0 };
    row.count++;
    doorMap.set(key, row);
  }
  const winMap = new Map<string, WindowSize>();
  for (const w of windowsList) {
    const widthIn = Math.round(metresToInches(w.widthM));
    const heightIn = Math.round(metresToInches(w.heightM));
    const key = `${widthIn}x${heightIn}`;
    const row = winMap.get(key) ?? { widthIn, heightIn, count: 0 };
    row.count++;
    winMap.set(key, row);
  }
  const fixtureMap = new Map<string, number>();
  for (const o of scan.objects) {
    if (!(FIXTURE_CATEGORIES as readonly string[]).includes(o.category)) continue;
    fixtureMap.set(o.category, (fixtureMap.get(o.category) ?? 0) + 1);
  }
  const fixtures = FIXTURE_CATEGORIES.filter((c) => fixtureMap.has(c)).map((c) => ({ category: c as string, count: fixtureMap.get(c) as number }));

  const floorAreaSF = floorM2 == null ? null : sqMetresToSqFeet(floorM2);
  const grossWallSF = grossM2 == null ? null : sqMetresToSqFeet(grossM2);
  const openingSF = grossM2 == null ? null : sqMetresToSqFeet(openingM2);
  return {
    floorAreaSF,
    ceilingAreaSF: floorAreaSF,
    grossWallSF,
    openingSF,
    netWallSF: grossWallSF == null || openingSF == null ? null : Math.max(0, grossWallSF - openingSF),
    perimeterLF: metresToFeet(perimeterM),
    baseboardLF: Math.max(0, metresToFeet(perimeterM - baseboardOutM)),
    crownLF: Math.max(0, metresToFeet(perimeterM - crownOutM)),
    casingLF: metresToFeet(casingM),
    doorCount: doorsList.length,
    windowCount: windowsList.length,
    openingCount: openings.filter((o) => o.kind === 'opening').length,
    doors: [...doorMap.values()],
    windows: [...winMap.values()],
    fixtures,
    fixtureCount: fixtures.reduce((s, f) => s + f.count, 0),
    flags: [...flags],
  };
}

/**
 * What the app can say about a scan, as plain facts. There is no score and no
 * percentage: "4 of 4 walls found", "Outline did not close", "Wall 2 was typed
 * by hand". The screen turns each into a sentence (hooks/useRoomScanCopy.ts).
 */
export function scanFacts(scan: RoomScan, q: ScanQuantities): ScanFact[] {
  const facts: ScanFact[] = [];
  const outline = scan.walls.filter((w) => w.onOutline);
  const label = (id: string) => scan.walls.find((w) => w.id === id)?.label ?? '';
  const found = outline.length;
  const needed = found + scan.closure.gaps;
  facts.push({ kind: 'walls_found', tone: scan.closure.closed ? 'ok' : 'check', found, needed });
  if (scan.closure.closed) {
    facts.push({ kind: 'outline_closed', tone: 'ok' });
  } else if (scan.closure.cause === 'typed') {
    facts.push({ kind: 'typed_open', tone: 'check', gapM: scan.closure.gapM, wallLabels: scan.closure.gapWallIds.map(label) });
  } else {
    facts.push({ kind: 'outline_open', tone: 'check', gapM: scan.closure.gapM, wallLabels: scan.closure.gapWallIds.map(label) });
  }
  const low = outline.filter((w) => w.confidence === 'low' && w.lengthSource === 'scan');
  if (low.length) facts.push({ kind: 'low_confidence', tone: 'check', count: low.length, wallLabels: low.map((w) => w.label) });
  if (q.flags.includes('ceiling_height_missing')) facts.push({ kind: 'ceiling_missing', tone: 'check' });
  if (q.flags.includes('ceiling_varies')) facts.push({ kind: 'ceiling_varies', tone: 'check' });
  const curved = outline.filter((w) => w.curved);
  if (curved.length) facts.push({ kind: 'curved', tone: 'check', count: curved.length, wallLabels: curved.map((w) => w.label) });
  if (q.flags.includes('over_size_limit')) facts.push({ kind: 'over_size', tone: 'check' });
  const off = scan.walls.filter((w) => !w.onOutline);
  if (off.length) facts.push({ kind: 'off_outline', tone: 'check', count: off.length, wallLabels: off.map((w) => w.label) });
  const typed = scan.edits.length;
  if (typed) facts.push({ kind: 'typed_by_hand', tone: 'ok', count: typed });
  const adjusted = outline.filter((w) => w.lengthSource === 'adjusted');
  if (adjusted.length) facts.push({ kind: 'adjusted', tone: 'ok', count: adjusted.length, wallLabels: adjusted.map((w) => w.label) });
  return facts;
}

/**
 * Why a draft cannot be priced yet, or null. A blocked button says why.
 * A low-confidence wall must be looked at (typed over) before pricing, and an
 * open outline has no floor to price.
 */
export function pricingBlock(q: ScanQuantities): 'not_closed' | 'typed_lengths_do_not_close' | 'low_confidence_wall' | 'ceiling_height_missing' | null {
  if (q.flags.includes('typed_lengths_do_not_close')) return 'typed_lengths_do_not_close';
  if (q.flags.includes('not_closed')) return 'not_closed';
  if (q.flags.includes('ceiling_height_missing')) return 'ceiling_height_missing';
  if (q.flags.includes('low_confidence_wall')) return 'low_confidence_wall';
  return null;
}
