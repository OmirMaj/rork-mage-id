// utils/roomScan/editsCore.ts — hand corrections to a scan.
//
// A phone scan can be off by an inch or more, so every number on the plan can
// be replaced by one read off a tape. Three rules, each pinned by
// scripts/validate-scan-room.ts:
//
//   1. A correction is RECORDED: `scan.edits` gains one row with the value
//      before, the value after, when, and `by: 'typed'`. Nothing is overwritten
//      silently, and the app never corrects a scan by itself.
//   2. A correction RECOMPUTES: the outline is walked again from the new
//      lengths, so the floor area, the wall area and every run change with it.
//   3. A correction is MARKED: the wall (or opening, or ceiling) carries
//      `'typed'` as its source, and the plan draws it differently.
//
// ── KEEPING THE OUTLINE CLOSED ──────────────────────────────────────────────
// Lengthening one wall of a closed room opens the outline by exactly that
// much. In a real room the wall across from it is that much longer too, so the
// longest wall running the opposite way (within about ten degrees) that nobody
// has typed is moved by the same amount and marked 'adjusted', which the plan
// says in words. If there is no such wall, or every one of them was typed, the
// outline is left open, the floor area is withheld, and the person is told the
// typed lengths do not close. The scan is never stretched to fit a tape.
//
// Pure: the caller passes the clock.

import { SNAP_M, dist } from './geometryCore';
import type { Pt, RoomScan, ScanEdit, ScanWall } from './types';

const unit = (a: Pt, b: Pt): Pt => {
  const n = Math.hypot(b.x - a.x, b.y - a.y);
  return n > 0 ? { x: (b.x - a.x) / n, y: (b.y - a.y) / n } : { x: 1, y: 0 };
};

/** A length a person may type: over an inch, under 200 ft. */
export function isUsableLength(m: number): boolean {
  return Number.isFinite(m) && m > 0.025 && m < 61;
}

/** Walk the outline walls end to end from their lengths and directions. */
function rewalk(scan: RoomScan, walls: ScanWall[]): Pick<RoomScan, 'walls' | 'floor' | 'closure'> {
  if (!scan.closure.closed && scan.closure.cause === 'scan') {
    // Open as scanned: there is no outline to walk. Lengths change, positions stay.
    return { walls, floor: [], closure: scan.closure };
  }
  const outline = walls.filter((w) => w.onOutline);
  if (outline.length < 3) return { walls, floor: scan.floor, closure: scan.closure };
  const start = outline[0].a;
  let cursor = start;
  const moved = new Map<string, ScanWall>();
  const floor: Pt[] = [];
  for (const w of outline) {
    const d = unit(w.a, w.b);
    const a = cursor;
    const b = { x: a.x + d.x * w.lengthM, y: a.y + d.y * w.lengthM };
    floor.push(a);
    moved.set(w.id, { ...w, a, b });
    cursor = b;
  }
  const residual = dist(cursor, start);
  const closed = residual <= SNAP_M;
  return {
    walls: walls.map((w) => moved.get(w.id) ?? w),
    floor: closed ? floor : [],
    closure: closed
      ? { closed: true, gapM: residual, gaps: 0, gapWallIds: [], cause: 'scan' }
      : { closed: false, gapM: residual, gaps: 1, gapWallIds: [outline[outline.length - 1].id, outline[0].id], cause: 'typed' },
  };
}

function record(scan: RoomScan, edit: Omit<ScanEdit, 'by'>): ScanEdit[] {
  return [...scan.edits, { ...edit, by: 'typed' }];
}

/** Replace one wall's length with a taped one. Returns the same scan when the value is unusable or unchanged. */
export function correctWallLength(scan: RoomScan, wallId: string, toM: number, at: string): RoomScan {
  const wall = scan.walls.find((w) => w.id === wallId);
  if (!wall || !isUsableLength(toM)) return scan;
  // Typing the number the scan already shows is how a person CONFIRMS a wall:
  // it is recorded and marked typed. Typing it twice changes nothing.
  if (wall.lengthSource === 'typed' && Math.abs(toM - wall.lengthM) < 1e-6) return scan;
  const delta = toM - wall.lengthM;
  const edits = record(scan, { at, target: `wall:${wallId}`, field: 'lengthM', from: wall.lengthM, to: toM });
  let walls = scan.walls.map((w) => (w.id === wallId ? { ...w, lengthM: toM, lengthSource: 'typed' as const } : w));
  if (wall.onOutline && (scan.closure.closed || scan.closure.cause === 'typed')) {
    const d = unit(wall.a, wall.b);
    let pick: ScanWall | null = null;
    for (const w of walls) {
      if (w.id === wallId || !w.onOutline || w.lengthSource === 'typed') continue;
      const e = unit(w.a, w.b);
      if (d.x * e.x + d.y * e.y > -0.985) continue; // not running the opposite way
      if (w.lengthM + delta <= 0.025) continue;
      if (!pick || w.lengthM > pick.lengthM) pick = w;
    }
    if (pick) {
      const id = pick.id;
      walls = walls.map((w) => (w.id === id ? { ...w, lengthM: w.lengthM + delta, lengthSource: 'adjusted' as const } : w));
    }
  }
  const next: RoomScan = { ...scan, edits };
  return { ...next, ...rewalk(next, walls) };
}

/** Replace the ceiling height with a taped one. Every wall takes it; a slanted wall's shape is dropped. */
export function correctCeilingHeight(scan: RoomScan, toM: number, at: string): RoomScan {
  if (!isUsableLength(toM) || (scan.ceilingHeightM.known && scan.ceilingHeightM.source === 'typed' && Math.abs(toM - scan.ceilingHeightM.typical) < 1e-6)) return scan;
  const edits = record(scan, { at, target: 'ceiling', field: 'heightM', from: scan.ceilingHeightM.typical, to: toM });
  const walls = scan.walls.map((w) => {
    const next: ScanWall = { ...w, heightM: toM };
    delete next.polygon;
    return next;
  });
  return { ...scan, edits, walls, ceilingHeightM: { known: true, min: toM, max: toM, typical: toM, source: 'typed' } };
}

/** Replace a door, window or opening's width or height with a taped one. */
export function correctOpening(scan: RoomScan, openingId: string, field: 'widthM' | 'heightM', toM: number, at: string): RoomScan {
  const o = scan.openings.find((x) => x.id === openingId);
  if (!o || !isUsableLength(toM) || Math.abs(toM - o[field]) < 1e-6) return scan;
  const edits = record(scan, { at, target: `opening:${openingId}`, field, from: o[field], to: toM });
  const openings = scan.openings.map((x) => {
    if (x.id !== openingId) return x;
    return field === 'widthM'
      // Keep the opening centred where the scan saw it.
      ? { ...x, offsetM: x.offsetM + (x.widthM - toM) / 2, widthM: toM, widthSource: 'typed' as const }
      : { ...x, heightM: toM, heightSource: 'typed' as const };
  });
  return { ...scan, edits, openings };
}

/** One wall measured with a tape, kept beside the scan's value. Never scales the scan. */
export function addTapeCheck(scan: RoomScan, wallId: string, tapeM: number, at: string): RoomScan {
  const wall = scan.walls.find((w) => w.id === wallId);
  if (!wall || !isUsableLength(tapeM)) return scan;
  return { ...scan, tapeChecks: [...scan.tapeChecks, { wallId, scanM: wall.scanLengthM, tapeM, at }] };
}

export function renameScan(scan: RoomScan, name: string): RoomScan {
  // An empty name is kept as empty (he cleared the field): pricing asks for one.
  const n = name.trim().slice(0, 60);
  return n !== scan.name ? { ...scan, name: n } : scan;
}
