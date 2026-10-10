// scripts/demo-job/draw-plans.ts — draws the Demo Job's three plan sheets.
//
//   bun run scripts/demo-job/draw-plans.ts <out-dir>
//
// Writes a-101.svg, a-102.svg and a-301.svg into <out-dir>. render.sh beside
// this file turns them into the PNG files in assets/demo-job/ that the app
// bundles. The floor plans are drawn from utils/demoJob/model.ts
// `modelRoomSpecs`, the same rooms the Living Model is made of, so a sheet and
// the model cannot disagree (scripts/validate-demo-job.ts rule P1 re-draws
// them and compares).
//
// Every sheet says it is a sample and not for construction. There is no seal,
// no signature and no licence number on any of them, and there must never be.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CEILING_FT, DOOR_FT, FOOTPRINT, WINDOW_FT, MODEL_LEVEL, PODIUM_CEILING_FT, UNIT_D, UNIT_W, CORRIDOR_D, modelRoomSpecs, type RoomSpec } from '../../utils/demoJob/model';
import { DEMO_PLAN_SHEETS, PLAN_IMAGE } from '../../utils/demoJob/planSheets';
import { ADDRESS, ARCHITECT, PROJECT_TITLE } from '../../utils/demoJob/planSheets';

const W = PLAN_IMAGE.w;
const H = PLAN_IMAGE.h;
const INK = '#1b1f23';
const SOFT = '#6b7278';
const FAINT = '#c9cdd1';
const TB_W = 400; // title block
const M = 36; // sheet margin
const FONT = "font-family='Helvetica, Arial, sans-serif'";

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (x: number, y: number, s: string, size: number, o: { anchor?: string; weight?: number; fill?: string; spacing?: number; rotate?: number } = {}): string =>
  `<text x='${x}' y='${y}' ${FONT} font-size='${size}' text-anchor='${o.anchor ?? 'start'}' font-weight='${o.weight ?? 400}' fill='${o.fill ?? INK}'${o.spacing ? ` letter-spacing='${o.spacing}'` : ''}${o.rotate ? ` transform='rotate(${o.rotate} ${x} ${y})'` : ''}>${esc(s)}</text>`;
const line = (x1: number, y1: number, x2: number, y2: number, w = 1, stroke = INK, dash = ''): string =>
  `<line x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}' stroke='${stroke}' stroke-width='${w}'${dash ? ` stroke-dasharray='${dash}'` : ''}/>`;
const feetInches = (ft: number): string => `${Math.floor(ft)}'-${Math.round((ft % 1) * 12)}"`;

function frame(sheet: (typeof DEMO_PLAN_SHEETS)[number], body: string, drawnFrom: string): string {
  const scaleNote = 'Not to Scale';
  const x = W - M - TB_W;
  const tb: string[] = [];
  tb.push(`<rect x='${x}' y='${M}' width='${TB_W}' height='${H - 2 * M}' fill='#ffffff' stroke='${INK}' stroke-width='2'/>`);
  tb.push(text(x + 24, M + 60, ARCHITECT.toUpperCase(), 26, { weight: 700, spacing: 2 }));
  tb.push(text(x + 24, M + 88, 'A made-up firm for a made-up job', 15, { fill: SOFT }));
  tb.push(line(x, M + 120, x + TB_W, M + 120, 2));
  tb.push(text(x + 24, M + 156, 'PROJECT', 13, { fill: SOFT, spacing: 2 }));
  tb.push(text(x + 24, M + 190, PROJECT_TITLE, 24, { weight: 700 }));
  tb.push(text(x + 24, M + 218, ADDRESS[0], 17));
  tb.push(text(x + 24, M + 242, ADDRESS[1], 17));
  tb.push(line(x, M + 274, x + TB_W, M + 274, 1));
  // The notice. The largest words in the title block after the sheet number.
  tb.push(`<rect x='${x + 20}' y='${M + 300}' width='${TB_W - 40}' height='236' fill='none' stroke='${INK}' stroke-width='3'/>`);
  tb.push(text(x + TB_W / 2, M + 348, 'SAMPLE DRAWING', 30, { anchor: 'middle', weight: 700, spacing: 2 }));
  tb.push(text(x + TB_W / 2, M + 388, 'NOT FOR CONSTRUCTION', 22, { anchor: 'middle', weight: 700, spacing: 1 }));
  const notice = ['Made up to show how MAGE ID works.', 'This building, this address and this', 'firm do not exist. No architect or', 'engineer drew or reviewed this sheet.', 'Do not build, price or permit from it.'];
  notice.forEach((s, i) => tb.push(text(x + TB_W / 2, M + 424 + i * 23, s, 16, { anchor: 'middle', fill: INK })));
  tb.push(line(x, M + 566, x + TB_W, M + 566, 1));
  tb.push(text(x + 24, M + 602, 'ISSUE', 13, { fill: SOFT, spacing: 2 }));
  tb.push(text(x + 24, M + 632, 'Demonstration Set', 19));
  tb.push(text(x + 24, M + 684, 'SCALE', 13, { fill: SOFT, spacing: 2 }));
  tb.push(text(x + 24, M + 714, scaleNote, 19));
  tb.push(text(x + 24, M + 766, 'DRAWN FROM', 13, { fill: SOFT, spacing: 2 }));
  tb.push(text(x + 24, M + 796, drawnFrom, 19));
  tb.push(line(x, H - M - 330, x + TB_W, H - M - 330, 2));
  tb.push(text(x + 24, H - M - 292, 'SHEET TITLE', 13, { fill: SOFT, spacing: 2 }));
  sheet.titleLines.forEach((s, i) => tb.push(text(x + 24, H - M - 252 + i * 34, s.toUpperCase(), 26, { weight: 700 })));
  tb.push(line(x, H - M - 150, x + TB_W, H - M - 150, 2));
  tb.push(text(x + 24, H - M - 112, 'SHEET', 13, { fill: SOFT, spacing: 2 }));
  tb.push(text(x + 24, H - M - 34, sheet.sheetNumber, 84, { weight: 700 }));
  return [
    `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}'>`,
    `<rect width='${W}' height='${H}' fill='#ffffff'/>`,
    `<rect x='${M}' y='${M}' width='${W - 2 * M}' height='${H - 2 * M}' fill='none' stroke='${INK}' stroke-width='4'/>`,
    body,
    tb.join(''),
    '</svg>',
  ].join('\n');
}

// ── floor plans ─────────────────────────────────────────────────────────────
const PX = 12.4; // pixels per foot
const AREA_W = W - 2 * M - TB_W;
const OX = M + (AREA_W - (FOOTPRINT.x1 - FOOTPRINT.x0) * PX) / 2 - FOOTPRINT.x0 * PX + 14;
const OY = 330;
const px = (ft: number): number => Math.round((OX + ft * PX) * 10) / 10;
const py = (ft: number): number => Math.round((OY + ft * PX) * 10) / 10;

/** The two ends of a room's wall, in feet. Wall 1 is the top, 2 the right, 3 the bottom, 4 the left. */
function wallEnds(r: RoomSpec, wall: 1 | 2 | 3 | 4): [number, number, number, number] {
  if (wall === 1) return [r.x, r.y, r.x + r.w, r.y];
  if (wall === 2) return [r.x + r.w, r.y, r.x + r.w, r.y + r.l];
  if (wall === 3) return [r.x, r.y + r.l, r.x + r.w, r.y + r.l];
  return [r.x, r.y, r.x, r.y + r.l];
}

function opening(r: RoomSpec, wall: 1 | 2 | 3 | 4, kind: 'door' | 'window', widthFt: number, atFt?: number): string {
  const [x1, y1, x2, y2] = wallEnds(r, wall);
  const horizontal = y1 === y2;
  // The middle of the wall, or `atFt` from the room's left edge (a top or bottom wall) or top edge (a side wall).
  const cx = atFt != null && horizontal ? x1 + atFt : (x1 + x2) / 2;
  const cy = atFt != null && !horizontal ? y1 + atFt : (y1 + y2) / 2;
  const a = horizontal ? [cx - widthFt / 2, cy] : [cx, cy - widthFt / 2];
  const b = horizontal ? [cx + widthFt / 2, cy] : [cx, cy + widthFt / 2];
  const out: string[] = [];
  // The gap in the wall.
  out.push(line(px(a[0]), py(a[1]), px(b[0]), py(b[1]), 9, '#ffffff'));
  if (kind === 'window') {
    const off = 3;
    for (const d of [-off, 0, off]) out.push(horizontal ? line(px(a[0]), py(a[1]) + d, px(b[0]), py(b[1]) + d, 1.4) : line(px(a[0]) + d, py(a[1]), px(b[0]) + d, py(b[1]), 1.4));
    return out.join('');
  }
  // The leaf swings into the room, hinged at `a`.
  const into = wall === 1 ? [0, 1] : wall === 3 ? [0, -1] : wall === 4 ? [1, 0] : [-1, 0];
  const tip = [a[0] + into[0] * widthFt, a[1] + into[1] * widthFt];
  out.push(line(px(a[0]), py(a[1]), px(tip[0]), py(tip[1]), 2));
  const rad = widthFt * PX;
  const cross = (b[0] - a[0]) * (tip[1] - a[1]) - (b[1] - a[1]) * (tip[0] - a[0]);
  out.push(`<path d='M ${px(b[0])} ${py(b[1])} A ${rad} ${rad} 0 0 ${cross > 0 ? 1 : 0} ${px(tip[0])} ${py(tip[1])}' fill='none' stroke='${INK}' stroke-width='1.2'/>`);
  return out.join('');
}

function stairTreads(r: RoomSpec): string {
  const out: string[] = [];
  for (let t = 3; t < r.l - 2; t += 1) out.push(line(px(r.x + 1), py(r.y + t), px(r.x + r.w - 1), py(r.y + t), 1, SOFT));
  out.push(line(px(r.x + r.w / 2), py(r.y + 3), px(r.x + r.w / 2), py(r.y + r.l - 3), 2));
  return out.join('');
}

function label(r: RoomSpec, lines: string[], size: number, at = 0.5): string {
  const cx = px(r.x + r.w / 2);
  const cy = py(r.y + r.l * at) - ((lines.length - 1) * (size + 4)) / 2 + size / 3;
  return lines.map((s, i) => text(cx, cy + i * (size + 4), s, i === 0 ? size : size - 3, { anchor: 'middle', weight: i === 0 ? 700 : 400, fill: i === 0 ? INK : SOFT })).join('');
}

function labelFor(r: RoomSpec, typical: boolean): string {
  const size = `${feetInches(r.w)} x ${feetInches(r.l)}`;
  const area = `${(r.w * r.l).toLocaleString('en-US')} SF`;
  if (/Stair/.test(r.name)) return text(px(r.x + r.w / 2), py(r.y) + 22, r.name.replace(/^Level \d+ /, '').toUpperCase(), 13, { anchor: 'middle', weight: 700 });
  if (r.kind === 'bathroom') return label(r, ['BATH', size], 15, 0.22);
  if (r.kind === 'bedroom') return label(r, ['BEDROOM', size, area], 15, 0.24);
  if (r.kind === 'living') {
    const unit = r.name.match(/Unit (\d)(\d\d)/);
    const tag = unit ? (typical ? `UNIT _${unit[2]}` : `UNIT ${unit[1]}${unit[2]}`) : '';
    return label(r, [tag, 'LIVING ROOM', 'AND KITCHEN', size, area], 16);
  }
  if (/Corridor/.test(r.name)) return label(r, [`${r.name.replace(/^Level \d+ /, '').toUpperCase()}   ${size}`], 15);
  if (/Lobby/.test(r.name)) return label(r, [...(typical ? ['ELEVATOR', 'LOBBY'] : ['LOBBY AND', 'ELEVATORS']), size], 13);
  if (r.key === 'l1:boh') return label(r, ['MAIL, BIKE ROOM, LOADING AND UTILITY ROOMS', size, area], 18);
  return label(r, [r.name.toUpperCase(), size, area], 20);
}

function floorPlan(sheet: (typeof DEMO_PLAN_SHEETS)[number], floor: number, typical: boolean, caption: string): string {
  const rooms = modelRoomSpecs().filter((r) => r.floor === floor);
  const out: string[] = [];
  // Column grid: one line per apartment party wall, one per corridor wall.
  const cols = [0, 1, 2, 3, 4].map((i) => i * UNIT_W);
  const rows = [0, UNIT_D, UNIT_D + CORRIDOR_D, UNIT_D * 2 + CORRIDOR_D];
  cols.forEach((c, i) => {
    out.push(line(px(c), py(-9), px(c), py(FOOTPRINT.y1 + 4), 1, FAINT, '14 5 3 5'));
    out.push(`<circle cx='${px(c)}' cy='${py(-9) - 20}' r='20' fill='#ffffff' stroke='${INK}' stroke-width='1.6'/>`);
    out.push(text(px(c), py(-9) - 13, String(i + 1), 19, { anchor: 'middle', weight: 700 }));
  });
  rows.forEach((r, i) => {
    out.push(line(px(FOOTPRINT.x0 - 4), py(r), px(FOOTPRINT.x1 + 4), py(r), 1, FAINT, '14 5 3 5'));
    out.push(`<circle cx='${px(FOOTPRINT.x0 - 4) - 20}' cy='${py(r)}' r='20' fill='#ffffff' stroke='${INK}' stroke-width='1.6'/>`);
    out.push(text(px(FOOTPRINT.x0 - 4) - 20, py(r) + 7, 'ABCD'[i], 19, { anchor: 'middle', weight: 700 }));
  });
  // Walls: every room's four sides. A wall two rooms share is drawn twice in the same place.
  for (const r of rooms) out.push(`<rect data-room='${r.key}' x='${px(r.x)}' y='${py(r.y)}' width='${(r.w * PX).toFixed(1)}' height='${(r.l * PX).toFixed(1)}' fill='#ffffff' fill-opacity='0.92' stroke='${INK}' stroke-width='5'/>`);
  // The outside walls again, heavier.
  const outer = `M ${px(0)} ${py(0)} H ${px(100)} V ${py(24)} H ${px(110)} V ${py(42)} H ${px(100)} V ${py(66)} H ${px(0)} V ${py(42)} H ${px(-25)} V ${py(24)} H ${px(0)} Z`;
  out.push(`<path d='${outer}' fill='none' stroke='${INK}' stroke-width='9' stroke-linejoin='miter'/>`);
  for (const r of rooms) {
    if (/Stair/.test(r.name)) out.push(stairTreads(r));
    if (r.window) out.push(opening(r, r.window, 'window', r.windowFt ?? WINDOW_FT));
    if (r.door) out.push(opening(r, r.door, 'door', DOOR_FT));
    if (r.entry) out.push(opening(r, r.entry.wall, 'door', DOOR_FT, r.entry.at));
    out.push(labelFor(r, typical));
  }
  // Overall dimensions.
  const dy = py(FOOTPRINT.y1) + 54;
  out.push(line(px(0), dy, px(100), dy, 1.4), line(px(0), dy - 9, px(0), dy + 9, 1.4), line(px(100), dy - 9, px(100), dy + 9, 1.4));
  cols.slice(1, 4).forEach((c) => out.push(line(px(c), dy - 6, px(c), dy + 6, 1.2)));
  cols.slice(0, 4).forEach((c) => out.push(text(px(c + UNIT_W / 2), dy - 8, `25'-0"`, 15, { anchor: 'middle', fill: SOFT })));
  out.push(text(px(50), dy + 28, `100'-0"`, 17, { anchor: 'middle', weight: 700 }));
  const dx = px(FOOTPRINT.x1) + 46;
  out.push(line(dx, py(0), dx, py(66), 1.4), line(dx - 9, py(0), dx + 9, py(0), 1.4), line(dx - 9, py(66), dx + 9, py(66), 1.4));
  out.push(text(dx + 28, py(33), `66'-0"`, 17, { anchor: 'middle', weight: 700, rotate: -90 }));
  // Title, north arrow, bar.
  const ty = H - M - 150;
  out.push(text(M + 60, ty, caption.toUpperCase(), 34, { weight: 700, spacing: 1 }));
  out.push(line(M + 60, ty + 14, M + 760, ty + 14, 3));
  out.push(text(M + 60, ty + 46, 'Sample drawing, not for construction. Sizes are the rooms typed into the job model.', 18, { fill: SOFT }));
  const nx = M + AREA_W - 110;
  const ny = ty + 30;
  out.push(`<circle cx='${nx}' cy='${ny}' r='38' fill='none' stroke='${INK}' stroke-width='2'/>`);
  out.push(`<path d='M ${nx} ${ny - 34} L ${nx + 13} ${ny + 20} L ${nx} ${ny + 8} L ${nx - 13} ${ny + 20} Z' fill='${INK}'/>`);
  out.push(text(nx, ny - 48, 'N', 22, { anchor: 'middle', weight: 700 }));
  return frame(sheet, out.join('\n'), 'The same rooms as the job model');
}

// ── the section ─────────────────────────────────────────────────────────────
function section(sheet: (typeof DEMO_PLAN_SHEETS)[number]): string {
  const S = 10.4; // pixels per foot
  const floorFt = CEILING_FT + 1; // a 9 ft ceiling and a foot of floor
  const levels = [0, PODIUM_CEILING_FT, ...[1, 2, 3, 4, 5].map((i) => PODIUM_CEILING_FT + i * floorFt)];
  const roofFt = PODIUM_CEILING_FT + 6 * floorFt;
  const x0 = M + 280;
  const ground = H - M - 360;
  const sx = (ft: number): number => Math.round((x0 + (ft - FOOTPRINT.x0) * S) * 10) / 10;
  const sy = (ft: number): number => Math.round((ground - ft * S) * 10) / 10;
  const out: string[] = [];
  // Ground and footings.
  out.push(`<rect x='${sx(-32)}' y='${ground}' width='${149 * S}' height='70' fill='#eceeef'/>`);
  out.push(line(sx(-32), ground, sx(117), ground, 4));
  for (const c of [-25, 0, 25, 50, 75, 100, 110]) out.push(`<rect x='${sx(c) - 22}' y='${ground + 6}' width='44' height='20' fill='${INK}'/>`);
  // Podium (concrete, drawn solid) and the six framed floors.
  out.push(`<rect x='${sx(-25)}' y='${sy(PODIUM_CEILING_FT)}' width='${135 * S}' height='${PODIUM_CEILING_FT * S}' fill='#ffffff' stroke='${INK}' stroke-width='7'/>`);
  out.push(`<rect x='${sx(-25)}' y='${sy(roofFt)}' width='${135 * S}' height='${(roofFt - PODIUM_CEILING_FT) * S}' fill='#ffffff' stroke='${INK}' stroke-width='5'/>`);
  out.push(`<rect x='${sx(-25)}' y='${sy(PODIUM_CEILING_FT) - 7}' width='${135 * S}' height='14' fill='${INK}'/>`);
  for (const l of levels.slice(2)) out.push(`<rect x='${sx(-25)}' y='${sy(l) - 3}' width='${135 * S}' height='6' fill='${INK}'/>`);
  out.push(`<rect x='${sx(-25)}' y='${sy(roofFt) - 5}' width='${135 * S}' height='10' fill='${INK}'/>`);
  // Parapet and the elevator overrun.
  out.push(line(sx(-25), sy(roofFt), sx(-25), sy(roofFt + 3.5), 5), line(sx(110), sy(roofFt), sx(110), sy(roofFt + 3.5), 5));
  out.push(`<rect x='${sx(-15)}' y='${sy(roofFt + 12)}' width='${15 * S}' height='${12 * S}' fill='#ffffff' stroke='${INK}' stroke-width='4'/>`);
  out.push(text(sx(-7.5), sy(roofFt + 12) - 10, 'ELEVATOR OVERRUN', 13, { anchor: 'middle', fill: SOFT }));
  // Shafts through every floor, then the party walls on the framed floors.
  for (const c of [-15, 0, 100]) out.push(line(sx(c), sy(0), sx(c), sy(roofFt), 4));
  for (const c of [25, 50, 75]) out.push(line(sx(c), sy(PODIUM_CEILING_FT), sx(c), sy(roofFt), 2.5));
  out.push(line(sx(50), sy(0), sx(50), sy(PODIUM_CEILING_FT), 3));
  // Stairs: a zigzag in each shaft, floor by floor.
  for (const [a, b] of [[-25, -15], [100, 110]] as const) {
    levels.forEach((l, i) => {
      const top = i + 1 < levels.length ? levels[i + 1] : roofFt;
      const mid = (l + top) / 2;
      out.push(`<polyline points='${sx(a + 1)},${sy(l)} ${sx(b - 1)},${sy(mid)} ${sx(a + 1)},${sy(top)}' fill='none' stroke='${SOFT}' stroke-width='1.6'/>`);
    });
  }
  // Elevator cars.
  out.push(`<rect x='${sx(-13)}' y='${sy(8)}' width='${5 * S}' height='${8 * S}' fill='none' stroke='${SOFT}' stroke-width='1.6'/>`);
  // Names.
  out.push(text(sx(25), sy(PODIUM_CEILING_FT / 2) + 6, 'RETAIL A', 20, { anchor: 'middle', weight: 700 }));
  out.push(text(sx(75), sy(PODIUM_CEILING_FT / 2) + 6, 'RETAIL B', 20, { anchor: 'middle', weight: 700 }));
  levels.slice(1).forEach((l, i) => {
    [0, 1, 2, 3].forEach((u) => out.push(text(sx(u * UNIT_W + UNIT_W / 2), sy(l + floorFt / 2) + 5, `UNIT ${i + 2}0${u + 1}`, 14, { anchor: 'middle', fill: i + 2 === MODEL_LEVEL || i + 2 === 2 || i + 2 === 7 ? INK : SOFT, weight: 400 })));
  });
  // Level tags on the right.
  const tagX = sx(110) + 30;
  const tag = (ft: number, name: string) => {
    out.push(line(sx(110) + 6, sy(ft), tagX + 150, sy(ft), 1, SOFT, '10 5'));
    out.push(`<path d='M ${tagX} ${sy(ft)} l 12 -14 l 12 14 Z' fill='${INK}'/>`);
    out.push(text(tagX + 34, sy(ft) - 6, name, 17, { weight: 700 }));
    out.push(text(tagX + 34, sy(ft) + 15, ft === 0 ? `0'-0"` : `+${feetInches(ft)}`, 14, { fill: SOFT }));
  };
  levels.forEach((l, i) => tag(l, `LEVEL ${i + 1}`));
  tag(roofFt, 'ROOF');
  // Notes on the left.
  const nx = M + 60;
  out.push(text(nx, sy(PODIUM_CEILING_FT / 2) - 6, 'CONCRETE PODIUM', 15, { weight: 700 }), text(nx, sy(PODIUM_CEILING_FT / 2) + 14, 'Columns and shear walls', 14, { fill: SOFT }));
  out.push(text(nx, sy(PODIUM_CEILING_FT + 3 * floorFt) - 6, 'SIX FLOORS OF', 15, { weight: 700 }), text(nx, sy(PODIUM_CEILING_FT + 3 * floorFt) + 14, 'LIGHT-GAUGE FRAMING', 15, { weight: 700 }), text(nx, sy(PODIUM_CEILING_FT + 3 * floorFt) + 34, 'Eight apartments a floor', 14, { fill: SOFT }));
  const ty = H - M - 150;
  out.push(text(M + 60, ty, 'BUILDING SECTION, LOOKING NORTH', 34, { weight: 700, spacing: 1 }));
  out.push(line(M + 60, ty + 14, M + 760, ty + 14, 3));
  out.push(text(M + 60, ty + 46, 'Sample drawing, not for construction. Cut through the north row of apartments and both stairs.', 18, { fill: SOFT }));
  out.push(text(M + 60, ty + 76, `The job model holds the rooms of Levels 1, 2, ${MODEL_LEVEL} and 7. Footings, the roof and the overrun are drawn here only.`, 18, { fill: SOFT }));
  return frame(sheet, out.join('\n'), 'A made-up section for the demo');
}

export function drawDemoPlans(): Record<string, string> {
  const [a101, a102, a301] = DEMO_PLAN_SHEETS;
  return {
    [a101.key]: floorPlan(a101, 1, false, 'Level 1 Floor Plan'),
    [a102.key]: floorPlan(a102, MODEL_LEVEL, true, 'Typical Floor Plan, Levels 2 to 7'),
    [a301.key]: section(a301),
  };
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: bun run scripts/demo-job/draw-plans.ts <out-dir>');
  mkdirSync(dir, { recursive: true });
  for (const [key, svg] of Object.entries(drawDemoPlans())) writeFileSync(join(dir, `${key}.svg`), svg);
  console.log(`wrote ${Object.keys(drawDemoPlans()).length} sheets to ${dir}`);
}
