// validate-tutorial-placement.ts — the spotlight's geometry.
//
// WHY IT MATTERS. The spotlight is four dim rects around an EMPTY hole, and
// the real control under the hole takes the real touch. If the four rects and
// the hole do not tile the layer exactly, a gap is a tap that reaches the
// screen behind the dim (he presses something the coach never pointed at),
// and an overlap is a lit strip of the real control that swallows the tap.
// The card must never cover the hole, must sit above the keyboard, and must
// keep a 16 px gutter on a 320 px phone. The hand's fingertip must land on
// the control, or the gesture points at nothing.
//
// Run: bun run scripts/validate-tutorial-placement.ts

import {
  cardWidth,
  dimRects,
  handPoint,
  holeRect,
  placeCard,
  rectVisibleIn,
  scrollOffsetFor,
  HOLE_PAD,
} from '../utils/tutorial/placement';
import type { Rect, Size } from '../utils/tutorial/types';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const PHONE: Size = { w: 390, h: 844 };
const SE: Size = { w: 320, h: 568 };
const WIDE: Size = { w: 1280, h: 800 };
const INSETS = { top: 47, bottom: 34 };

const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
const inside = (r: Rect, L: Size) => r.x >= 0 && r.y >= 0 && r.x + r.w <= L.w + 1e-9 && r.y + r.h <= L.h + 1e-9 && r.w >= 0 && r.h >= 0;

/** Tiling: every piece inside the layer, no two overlap, areas sum to the layer. */
function tiles(hole: Rect, L: Size): { ok: boolean; why: string } {
  const pieces = [hole, ...dimRects(hole, L)];
  for (const p of pieces) if (!inside(p, L)) return { ok: false, why: `piece outside layer ${JSON.stringify(p)}` };
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      if (overlap(pieces[i], pieces[j]) > 0) return { ok: false, why: `overlap ${i}/${j}` };
    }
  }
  const sum = pieces.reduce((s, p) => s + area(p), 0);
  return Math.abs(sum - L.w * L.h) < 1e-6 ? { ok: true, why: '' } : { ok: false, why: `area ${sum} ≠ ${L.w * L.h}` };
}

// ── hole + dims ─────────────────────────────────────────────────────────────
console.log('hole and dims');
{
  const h = holeRect({ x: 100, y: 200, w: 120, h: 44 }, PHONE);
  eq('hole = target grown by the pad', h, { x: 100 - HOLE_PAD, y: 200 - HOLE_PAD, w: 120 + 2 * HOLE_PAD, h: 44 + 2 * HOLE_PAD });
  eq('hole clamped at the top-left corner', holeRect({ x: 2, y: 3, w: 50, h: 40 }, PHONE), { x: 0, y: 0, w: 60, h: 51 });
  eq('hole clamped at the bottom-right corner', holeRect({ x: 350, y: 820, w: 60, h: 40 }, PHONE), { x: 342, y: 812, w: 48, h: 32 });
  eq('a target entirely off the layer gives a zero hole, never a negative one', holeRect({ x: 500, y: 900, w: 40, h: 40 }, PHONE), { x: 390, y: 844, w: 0, h: 0 });
  const cases: [string, Rect, Size][] = [
    ['mid-screen control', { x: 100, y: 200, w: 120, h: 44 }, PHONE],
    ['top-left corner control', { x: 0, y: 0, w: 60, h: 40 }, PHONE],
    ['bottom bar Save', { x: 16, y: 780, w: 358, h: 52 }, PHONE],
    ['full-bleed plan canvas', { x: 0, y: 90, w: 390, h: 700 }, PHONE],
    ['SE-width row', { x: 8, y: 300, w: 304, h: 60 }, SE],
    ['desktop sidebar item', { x: 12, y: 400, w: 220, h: 36 }, WIDE],
    ['off-layer target', { x: 500, y: 900, w: 40, h: 40 }, PHONE],
    ['fractional measure (RN-web)', { x: 10.5, y: 33.25, w: 99.75, h: 40.125 }, PHONE],
  ];
  for (const [name, target, L] of cases) {
    const t = tiles(holeRect(target, L), L);
    ok(`4 dims + hole tile the layer exactly — ${name}`, t.ok, t.why);
  }
}

// ── card placement ──────────────────────────────────────────────────────────
console.log('card placement');
{
  const cardH = 120;
  const topTarget = holeRect({ x: 16, y: 110, w: 358, h: 56 }, PHONE);
  const a = placeCard({ hole: topTarget, cardH, layer: PHONE, insets: INSETS, keyboardH: 0, wide: false });
  eq('a target near the top puts the card below', a.side, 'below');
  ok('…without covering the hole', overlap({ x: a.x, y: a.y, w: a.width, h: cardH }, topTarget) === 0);

  const save = holeRect({ x: 16, y: 770, w: 358, h: 52 }, PHONE);
  const b = placeCard({ hole: save, cardH, layer: PHONE, insets: INSETS, keyboardH: 0, wide: false });
  eq('the bottom Save puts the card above', b.side, 'above');
  ok('…without covering the hole', overlap({ x: b.x, y: b.y, w: b.width, h: cardH }, save) === 0);
  ok('…and below the safe-area top', b.y >= INSETS.top);

  const pct = holeRect({ x: 16, y: 380, w: 180, h: 44 }, PHONE);
  const kb = 336;
  const c = placeCard({ hole: pct, cardH, layer: PHONE, insets: INSETS, keyboardH: kb, wide: false });
  ok('keyboard up: the card sits above the keyboard', c.y + cardH <= PHONE.h - kb, JSON.stringify(c));
  ok('keyboard up: …and does not cover the % field', overlap({ x: c.x, y: c.y, w: c.width, h: cardH }, pct) === 0);
  const lowField = holeRect({ x: 16, y: 470, w: 180, h: 44 }, PHONE);
  const c2 = placeCard({ hole: lowField, cardH, layer: PHONE, insets: INSETS, keyboardH: kb, wide: false });
  ok('keyboard up, field just above it: card above the field, above the keyboard', c2.side === 'above' && c2.y + cardH <= PHONE.h - kb, JSON.stringify(c2));

  const se = placeCard({ hole: holeRect({ x: 8, y: 300, w: 304, h: 60 }, SE), cardH, layer: SE, insets: { top: 20, bottom: 0 }, keyboardH: 0, wide: false });
  // Literal 16, not CARD_GUTTER: the spec fixes the gutter, and comparing
  // against the constant could never go red when the constant drifts.
  eq('320 px wide: 16 px gutters both sides', [se.x, SE.w - (se.x + se.width)], [16, 16]);
  eq('card width: 360 max on a phone', cardWidth(430, false), 360);
  eq('card width: 420 max wide', cardWidth(1280, true), 420);
  const edge = placeCard({ hole: holeRect({ x: 340, y: 200, w: 40, h: 40 }, PHONE), cardH, layer: PHONE, insets: INSETS, keyboardH: 0, wide: false });
  ok('a hole at the right edge keeps the card inside the gutter', edge.x + edge.width <= PHONE.w - 16 && edge.x >= 16, JSON.stringify(edge));
  ok('…and its caret is clamped onto the card', edge.caretX !== null && edge.caretX >= 20 && edge.caretX <= edge.width - 20, JSON.stringify(edge));
  const centred = placeCard({ hole: holeRect({ x: 150, y: 200, w: 90, h: 40 }, PHONE), cardH, layer: PHONE, insets: INSETS, keyboardH: 0, wide: false });
  ok('caret points at the hole centre when the card can centre', centred.caretX !== null && Math.abs(centred.x + centred.caretX - 195) < 1e-6, JSON.stringify(centred));

  // Mid-screen field that, keyboard-blind, would get the card BELOW it —
  // straight under the keyboard. With the keyboard counted it goes above.
  const midField = holeRect({ x: 16, y: 338, w: 180, h: 28 }, PHONE);
  const c3 = placeCard({ hole: midField, cardH: 160, layer: PHONE, insets: INSETS, keyboardH: kb, wide: false });
  ok('keyboard up, mid-screen field: the card clears the keyboard', c3.y + 160 <= PHONE.h - kb && overlap({ x: c3.x, y: c3.y, w: c3.width, h: 160 }, midField) === 0, JSON.stringify(c3));

  const bigWithRoom = holeRect({ x: 0, y: 58, w: 390, h: 564 }, PHONE);
  const bw = placeCard({ hole: bigWithRoom, cardH, layer: PHONE, insets: INSETS, keyboardH: 0, wide: false });
  eq('a hole over 60 % docks even when a side has room (the plan canvas with a toolbar below)', bw.side, 'top');

  const plan = holeRect({ x: 0, y: 90, w: 390, h: 700 }, PHONE);
  const d = placeCard({ hole: plan, cardH, layer: PHONE, insets: INSETS, keyboardH: 0, wide: false });
  eq('a hole over 60 % of the layer (the plan canvas) docks the card at the top', [d.side, d.caretX], ['top', null]);
  ok('…under the safe area', d.y >= INSETS.top);

  const tall = placeCard({ hole: holeRect({ x: 16, y: 300, w: 358, h: 200 }, PHONE), cardH: 360, layer: PHONE, insets: INSETS, keyboardH: 0, wide: false });
  eq('neither side has room (Dynamic Type) → dock', tall.side, 'top');
}

// ── hand ────────────────────────────────────────────────────────────────────
console.log('gesture hand');
{
  const within = (p: { x: number; y: number }, h: Rect) => p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h;
  const targets: Rect[] = [
    { x: 100, y: 200, w: 120, h: 44 },
    { x: 350, y: 820, w: 30, h: 20 },
    { x: 0, y: 0, w: 12, h: 12 },
    { x: 0, y: 90, w: 390, h: 700 },
  ];
  for (const t of targets) {
    const h = holeRect(t, PHONE);
    ok(`tap: fingertip inside the hole ${JSON.stringify(t)}`, within(handPoint(h, 'tap'), h), JSON.stringify(handPoint(h, 'tap')));
  }
  const canvas = { x: 0, y: 90, w: 390, h: 700 };
  const hc = holeRect(canvas, PHONE);
  const kitchen = handPoint(hc, 'tap-point', canvas, { x: 0.2, y: 0.3 });
  eq('tap-point: lands on the normalized point (the Kitchen label)', kitchen, { x: 78, y: 300 });
  ok('tap-point: out-of-range point still clamped inside the hole', within(handPoint(hc, 'tap-point', canvas, { x: 1.5, y: -2 }), hc));
}

// ── visibility / scroll ─────────────────────────────────────────────────────
console.log('visibility and scroll');
{
  const view: Rect = { x: 0, y: 0, w: 390, h: 844 };
  eq('fully visible', rectVisibleIn({ x: 16, y: 300, w: 358, h: 60 }, view, 72), { visible: true, scroll: null });
  eq('below the fold → scroll down', rectVisibleIn({ x: 16, y: 1200, w: 358, h: 60 }, view, 72), { visible: false, scroll: 'down' });
  eq('above → scroll up', rectVisibleIn({ x: 16, y: -300, w: 358, h: 60 }, view, 72), { visible: false, scroll: 'up' });
  eq('inside the 72 px margin counts as not visible', rectVisibleIn({ x: 16, y: 790, w: 358, h: 40 }, view, 72).visible, false);
  eq('scroll offset puts the target 35 % down', scrollOffsetFor(1500, 800), 1220);
  eq('scroll offset never negative', scrollOffsetFor(100, 800), 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
