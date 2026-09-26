// validate-takeoff-conditions.ts — pins the desktop takeoff's pure core (wave 4):
// utils/takeoff/conditions (quantities in one reference frame, pricing on the
// cent grid, the rollup), utils/takeoff/viewTransform (zoom / pan / snap) and
// utils/takeoff/conditionPush (the estimate UPSERT with markup INSIDE
// lineTotal). The money checks run the phone's own append block (lifted from
// app/area-takeoff.tsx) beside ours on the same numbers.
// Run: bun run scripts/validate-takeoff-conditions.ts
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REF_W, EMPTY_TAKEOFF_DOC, parseTakeoffDoc, measurementQuantity, conditionTotals, pushQuantity,
  rateToCents, priceCondition, defaultConditionColor, rollup,
  type TakeoffCondition, type TakeoffMeasurement, type TakeoffDoc, type SheetCal,
} from '../utils/takeoff/conditions';
import {
  MIN_SCALE, MAX_SCALE, fitRect, zoomAt, panBy, canvasToNorm, normToCanvas, fitToPoints, snap45, type ViewT,
} from '../utils/takeoff/viewTransform';
import { pushLinesFrom, applyTakeoffPush, pushBlockReason, type PushLine } from '../utils/takeoff/conditionPush';
import { feetPerPixel, polygonAreaSqFt, polylineLengthFt, type NormPoint } from '../utils/takeoffGeometry';
import { TAKEOFF_CONDITION_PALETTE } from '../constants/colors';
import type { CostBookEntry, CostDatabase } from '../utils/costDatabase';
import { roundCents } from '../utils/invoiceBilling';
import { estimatesEqual } from '../utils/estimateCommit';
import { recomputeEstimate } from '../utils/copilot/estimateEdit/estimateOps';
import { seedAIAPayApplicationFromInvoice, reconcileAIASov } from '../utils/aiaBilling';
import { isAppStorageKey } from '../utils/localCacheKeys';
import type { Invoice, LinkedEstimate, LinkedEstimateItem, Project } from '../types';

// The app tsconfig has no bun types; declare the one Bun API used here.
declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(code: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const eq = <T,>(name: string, got: T, want: T) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// ── fixtures ────────────────────────────────────────────────────────────────
const cond = (over: Partial<TakeoffCondition> = {}): TakeoffCondition => ({
  id: 'c1', name: '5/8 drywall', kind: 'area', trade: 'Drywall', rateOverride: null,
  wastePct: 0, heightFt: null, color: '#94A3B8', createdAt: '2026-09-26', ...over,
});
const meas = (over: Partial<TakeoffMeasurement> = {}): TakeoffMeasurement => ({
  id: 'm1', conditionId: 'c1', sheetId: 'A1', kind: 'area',
  points: [{ x: 0.1, y: 0.1 }, { x: 0.6, y: 0.15 }, { x: 0.55, y: 0.7 }, { x: 0.12, y: 0.5 }],
  createdAt: '2026-09-26', aspect: 1.294, ...over,
});
const CAL: SheetCal = { p1: { x: 0.1, y: 0.2 }, p2: { x: 0.7, y: 0.35 }, realDistanceFt: 42 };
const entry = (trade: string, unit: string, rate: number, provenance: CostBookEntry['provenance'] = 'earned'): CostBookEntry => ({
  key: `${trade.toLowerCase()}|${unit.toLowerCase()}`, trade, unit, sampleCount: 6, jobCount: 3,
  personalRate: rate, variability: 0.1, spreadMeaningful: true, bidBias: 0, baseline: rate,
  suggestedRate: rate, confidence: 'high', totalActual: rate * 100, lastSeen: '2026-01-01', samples: [], provenance,
} as unknown as CostBookEntry);
const DB: CostDatabase = {
  entries: [entry('Drywall', 'SF', 3.337), entry('Framing', 'SF', 412.337), entry('Electrical', 'EA', 145, 'seeded')],
  jobsAnalyzed: 3, tradesTracked: 3, overallBidAccuracy: null, asOf: '2026-09-26',
};

// ── 1. quantities in the reference frame == the phone's maths ──────────────
console.log('\nquantities (one reference frame, the phone\'s answer):');
for (const aspect of [0.707, 1.294, 1.6]) {
  // The phone measures in the displayed image rect — any size with this aspect.
  const rw = 391.5, rh = rw / aspect;
  const phoneFtpp = feetPerPixel(CAL, rw, rh)!;
  const m = meas({ aspect });
  const phoneArea = polygonAreaSqFt(m.points, rw, rh, phoneFtpp);
  ok(`area @ aspect ${aspect} equals the phone's shoelace (${phoneArea.toFixed(3)} SF)`, near(measurementQuantity(m, CAL)!, phoneArea));
  const lin = meas({ kind: 'linear', aspect });
  const phoneLen = polylineLengthFt(lin.points, rw, rh, phoneFtpp);
  ok(`linear @ aspect ${aspect} equals the phone's polyline (${phoneLen.toFixed(3)} LF)`, near(measurementQuantity(lin, CAL)!, phoneLen));
  // …and a 3× bigger displayed rect gives the same number (zoom never moves it).
  const big = polygonAreaSqFt(m.points, rw * 3, rh * 3, feetPerPixel(CAL, rw * 3, rh * 3)!);
  ok(`area @ aspect ${aspect} is independent of the displayed size`, near(big, phoneArea));
}
ok('REF_W is 1000', REF_W === 1000);
eq('count = points.length, needs no scale', measurementQuantity(meas({ kind: 'count' }), null), 4);
eq('area with no calibration is null (not measured), never 0', measurementQuantity(meas(), null), null);
eq('linear with no calibration is null', measurementQuantity(meas({ kind: 'linear' }), null), null);
eq('a 0 ft calibration is no calibration', measurementQuantity(meas(), { ...CAL, realDistanceFt: 0 }), null);
eq('coincident calibration points are no calibration', measurementQuantity(meas(), { ...CAL, p2: CAL.p1 }), null);
eq('area with 2 points measures 0 (degenerate, but scaled)', measurementQuantity(meas({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), CAL), 0);

// A measurement on a scaled sheet measures whatever sheet is "active".
const calFor2 = (id: string) => (id === 'A1' || id === 'A2' ? CAL : null);
const twoSheets = [meas(), meas({ id: 'm2', sheetId: 'A2' }), meas({ id: 'm3', sheetId: 'S1' })];
const tAll = conditionTotals(cond(), twoSheets, calFor2);
eq('both scaled sheets measure; the unscaled one is counted, not zero',
  [tAll.measuredCount, tAll.unmeasuredCount, tAll.unmeasuredSheetIds], [2, 1, ['S1']]);
ok('net = the two scaled measurements', near(tAll.net, 2 * measurementQuantity(meas(), CAL)!));
const tA2 = conditionTotals(cond(), twoSheets, calFor2, 'A2');
eq('sheetFilter limits to one sheet', [tA2.measuredCount, tA2.unmeasuredCount], [1, 0]);
const coreSrc = readFileSync(join(ROOT, 'utils/takeoff/conditions.ts'), 'utf8');
ok('no aspectFor exists — the aspect travels on the measurement', !/aspectFor/.test(coreSrc));

// waste / wallSf
const sq: NormPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.2 }, { x: 0, y: 0.2 }];
const CAL100: SheetCal = { p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, realDistanceFt: 100 };
const sqM = meas({ points: sq, aspect: 1 });
eq('a 100 × 20 ft rectangle is 2,000 SF', Math.round(measurementQuantity(sqM, CAL100)! * 1e6) / 1e6, 2000);
const w10 = conditionTotals(cond({ wastePct: 10 }), [sqM], () => CAL100);
ok('10% waste: billable = net × 1.10', near(w10.billable, 2200) && near(w10.net, 2000));
const cnt = conditionTotals(cond({ kind: 'count', wastePct: 20 }), [meas({ kind: 'count' })], () => null);
eq('count ignores waste and needs no scale', [cnt.net, cnt.billable, cnt.unmeasuredCount, cnt.unit], [4, 4, 0, 'EA']);
const linM = meas({ kind: 'linear', points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], aspect: 1 });
const wall = conditionTotals(cond({ kind: 'linear', wastePct: 10, heightFt: 9 }), [linM], () => CAL100);
ok('linear with height: wallSf = billable LF × height (priced unit stays LF)',
  near(wall.billable, 55) && near(wall.wallSf!, 495) && wall.unit === 'LF');
eq('area has no wallSf', w10.wallSf, null);

// parse
console.log('\nparseTakeoffDoc (never throws, drops malformed rows):');
const rawDoc = JSON.stringify({
  version: 1,
  conditions: [cond(), { id: '', name: 'x', kind: 'area' }, { id: 'c9', name: 'bad kind', kind: 'volume' }],
  measurements: [meas(), meas({ id: 'noAspect', aspect: undefined as unknown as number }), meas({ id: 'zero', aspect: 0 }),
    { ...meas({ id: 'nanAspect' }), aspect: null }, meas({ id: 'orphan', conditionId: 'gone' }),
    meas({ id: 'badPt', points: [{ x: 0.1, y: 'a' as unknown as number }] })],
});
const parsed = parseTakeoffDoc(rawDoc);
eq('keeps the good condition only', parsed.conditions.map(c => c.id), ['c1']);
eq('drops a measurement without a finite aspect > 0, orphans and bad points', parsed.measurements.map(m => m.id), ['m1']);
eq('missing pushed → {}', parsed.pushed, {});
for (const bad of [null, undefined, '', '{', 'null', '[]', '42', '{"conditions":7}']) {
  let threw = false; let d: TakeoffDoc | null = null;
  try { d = parseTakeoffDoc(bad as string | null | undefined); } catch { threw = true; }
  ok(`parse(${JSON.stringify(bad)}) → empty doc, no throw`, !threw && !!d && d.conditions.length === 0 && d.version === 1);
}
ok('EMPTY_TAKEOFF_DOC is frozen', Object.isFrozen(EMPTY_TAKEOFF_DOC) && Object.isFrozen(EMPTY_TAKEOFF_DOC.conditions));
eq('pushed round-trips (strings only)', parseTakeoffDoc(JSON.stringify({ conditions: [], measurements: [], pushed: { c1: 'mat1', c2: 5 } })).pushed, { c1: 'mat1' });

// ── 2. price ────────────────────────────────────────────────────────────────
console.log('\nprice (override > book > none; cents are integers):');
eq('pushQuantity rounds SF/LF, keeps EA', [pushQuantity('area', 2200.4), pushQuantity('linear', 54.5), pushQuantity('count', 7)], [2200, 55, 7]);
eq('rateToCents puts the rate on the cent grid', [rateToCents(3.337), rateToCents(412.337), rateToCents(0.015)], [334, 41234, 2]);
const pOver = priceCondition(DB, cond({ rateOverride: 5.5 }), 2000);
eq('override wins over the book', [pOver.rateSource, pOver.rateCents, pOver.amountCents], ['override', 550, 1_100_000]);
const pBook = priceCondition(DB, cond(), 2000);
eq('book: his Drywall|SF rate on the cent grid', [pBook.rateSource, pBook.rate, pBook.rateCents, pBook.amountCents], ['book', 3.337, 334, 668_000]);
ok('amountCents is an integer', Number.isInteger(pBook.amountCents!) && Number.isInteger(pOver.amountCents!));
const pNone = priceCondition(DB, cond({ trade: null }), 2000);
eq('no trade, no override → null rate and null amount (never $0)', [pNone.rate, pNone.rateCents, pNone.amountCents, pNone.rateSource], [null, null, null, null]);
const pMiss = priceCondition(DB, cond({ trade: 'Roofing' }), 2000);
eq('a trade with no history is unpriced, not an engine rate', pMiss.amountCents, null);
eq('a 0 override falls back to the book', priceCondition(DB, cond({ rateOverride: 0 }), 10).rateSource, 'book');

// rollup
const DOC: TakeoffDoc = {
  version: 1,
  conditions: [cond(), cond({ id: 'c2', name: 'Outlets', kind: 'count', trade: 'Electrical' }), cond({ id: 'c3', name: 'Roof', trade: 'Roofing' }),
    cond({ id: 'c4', name: 'Framing', trade: 'Framing' })],
  measurements: [meas({ points: sq, aspect: 1 }), meas({ id: 'k', conditionId: 'c2', kind: 'count' }),
    meas({ id: 'r', conditionId: 'c3', points: sq, aspect: 1 }), meas({ id: 'f', conditionId: 'c4', points: sq, aspect: 1 })],
  pushed: {},
};
const R = rollup(DOC, DB, () => CAL100);
eq('rollup counts: 3 priced, 1 unpriced', [R.pricedCount, R.unpricedCount], [3, 1]);
eq('fromYourJobsCount excludes a seeded entry', R.fromYourJobsCount, 2);
eq('costCents = Σ priced amountCents only', R.costCents, 2000 * 334 + 4 * 14500 + 2000 * 41234);

// colour
console.log('\ncolour:');
eq('drywall → slate', defaultConditionColor('5/8 Drywall', null, []), '#94A3B8');
eq('the ten trade families map to the spec hues',
  ['Partition', 'LVT', 'Stud wall', 'Electrical', 'Plumbing', 'Ductwork', 'Roofing', 'Slab', 'Demo', 'Paint'].map(n => defaultConditionColor(n, null, [])),
  ['#94A3B8', '#22C55E', '#A855F7', '#EAB308', '#0EA5E9', '#14B8A6', '#06B6D4', '#3B82F6', '#EF4444', '#EC4899']);
eq('trade drives it too', defaultConditionColor('Level 2', 'Plumbing', []), '#0EA5E9');
eq('unknown → first unused palette entry', defaultConditionColor('Widgets', null, ['#94A3B8', '#22C55E']), '#A855F7');
eq('all used → round robin', defaultConditionColor('Widgets', null, [...TAKEOFF_CONDITION_PALETTE, 'x']), TAKEOFF_CONDITION_PALETTE[1]);
eq('palette is the 12 spec hues', TAKEOFF_CONDITION_PALETTE.length, 12);

// ── 3. view maths ───────────────────────────────────────────────────────────
console.log('\nview transform:');
const canvas = { w: 1100, h: 760 };
const paper = fitRect(canvas, 1.294);
ok('fitRect contain-fits with the pad and keeps the aspect',
  near(paper.w / paper.h, 1.294) && paper.left >= 24 - 1e-9 && paper.top >= 24 - 1e-9 && near(paper.left * 2 + paper.w, 1100));
const views: ViewT[] = [{ scale: 1, tx: 0, ty: 0 }, { scale: 2.5, tx: -300, ty: 120 }, { scale: 0.4, tx: 90, ty: -40 }, { scale: 7.9, tx: -4000, ty: -2500 }];
const probe: NormPoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.3141, y: 0.2718 }, { x: 0.999, y: 0.001 }];
let rt = true;
for (const v of views) for (const p of probe) {
  const c = normToCanvas(v, paper, p);
  const back = canvasToNorm(v, paper, c.x, c.y);
  if (!back || Math.abs(back.x - p.x) > 1e-9 || Math.abs(back.y - p.y) > 1e-9) rt = false;
}
ok('canvasToNorm ∘ normToCanvas round-trips to 1e-9 at several zooms/pans', rt);
eq('outside the sheet → null', canvasToNorm(views[0], paper, 1, 1), null);
let fixed = true;
for (const v of views) {
  const cx = 612.5, cy = 301.25;
  const before = canvasToNorm(v, paper, cx, cy);
  const z = zoomAt(v, 1.37, cx, cy, paper);
  const after = canvasToNorm(z, paper, cx, cy);
  if (before && (!after || Math.abs(before.x - after.x) > 1e-9 || Math.abs(before.y - after.y) > 1e-9)) fixed = false;
}
ok('zoomAt keeps the image point under the cursor fixed', fixed);
const zNoPaper = zoomAt({ scale: 1.5, tx: 30, ty: -10 }, 2, 400 - paper.left, 300 - paper.top);
const zPaper = zoomAt({ scale: 1.5, tx: 30, ty: -10 }, 2, 400, 300, paper);
ok('paper-relative and canvas+paper call forms agree', near(zNoPaper.tx, zPaper.tx) && near(zNoPaper.ty, zPaper.ty));
eq('zoomAt clamps to MAX_SCALE', zoomAt({ scale: 6, tx: 0, ty: 0 }, 10, 100, 100).scale, MAX_SCALE);
eq('zoomAt clamps to MIN_SCALE', zoomAt({ scale: 0.2, tx: 0, ty: 0 }, 0.01, 100, 100).scale, MIN_SCALE);
const cl = { scale: 6, tx: 17, ty: 9 };
const clz = zoomAt(cl, 10, 500, 400, paper);
const clBefore = canvasToNorm(cl, paper, 500, 400)!;
const clAfter = canvasToNorm(clz, paper, 500, 400)!;
ok('…and the fixed point still holds at the clamped scale', near(clBefore.x, clAfter.x) && near(clBefore.y, clAfter.y));
eq('panBy moves by the delta', panBy({ scale: 2, tx: 1, ty: 2 }, 10, -5), { scale: 2, tx: 11, ty: -3 });
const fit = fitToPoints(canvas, paper, [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.3 }]);
const tl = normToCanvas(fit, paper, { x: 0.2, y: 0.2 }), br = normToCanvas(fit, paper, { x: 0.4, y: 0.3 });
ok('fitToPoints frames the points inside the canvas with the pad',
  tl.x >= 48 - 1e-6 && tl.y >= 48 - 1e-6 && br.x <= canvas.w - 48 + 1e-6 && br.y <= canvas.h - 48 + 1e-6);
ok('fitToPoints centres them', near((tl.x + br.x) / 2, canvas.w / 2) && near((tl.y + br.y) / 2, canvas.h / 2));
eq('fitToPoints of nothing is the identity', fitToPoints(canvas, paper, []), { scale: 1, tx: 0, ty: 0 });
const A = 2;
const h = snap45({ x: 0.2, y: 0.5 }, { x: 0.5, y: 0.52 }, A);
eq('snap45: near-horizontal snaps to exactly horizontal', h.y, 0.5);
const vv = snap45({ x: 0.2, y: 0.2 }, { x: 0.21, y: 0.6 }, A);
eq('snap45: near-vertical snaps to exactly vertical', vv.x, 0.2);
const d = snap45({ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.41 }, A);
ok('snap45: 45° is measured in REAL space (dx × aspect === dy)', near((d.x - 0.2) * A, d.y - 0.2) && d.x > 0.2);
eq('snap45: the aspect decides the angle (38.7° on paper is 21.8° real on a 2:1 sheet → horizontal)',
  snap45({ x: 0.2, y: 0.2 }, { x: 0.3, y: 0.28 }, 2).y, 0.2);
const edge = snap45({ x: 0.9, y: 0.5 }, { x: 1.4, y: 0.52 }, 1);
ok('snap45 never leaves the sheet', edge.x <= 1 && edge.y === 0.5);

// ── 4. MONEY ────────────────────────────────────────────────────────────────
console.log('\nmoney — the push (markup inside lineTotal):');
const lift = (file: string, begin: string, end: string): string => {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const from = src.indexOf(begin);
  const to = src.indexOf(end);
  if (from < 0 || to < 0) { console.error(`  ✗ sentinels missing in ${file}`); process.exit(1); }
  return new Bun.Transpiler({ loader: 'ts' }).transformSync(src.slice(from + begin.length, to));
};
const phoneAppend = new Function(
  'est', 'costLineTotal', 'category', 'qty', 'effectiveRate', 'name', 'unit', 'roundCents', 'generateUUID',
  `${lift('app/area-takeoff.tsx', '// --- BEGIN takeoff append ---', '// --- END takeoff append ---')}\nreturn next;`,
) as (est: LinkedEstimate, cost: number, category: string, qty: number, rate: number, name: string, unit: string,
  round: (n: number) => number, uuid: () => string) => LinkedEstimate;

const sumLines = (e: LinkedEstimate) => roundCents(e.items.reduce((s, i) => s + i.lineTotal, 0));
const foots = (e: LinkedEstimate) => sumLines(e) === e.grandTotal && roundCents(e.grandTotal - e.baseTotal) === e.markupTotal;
const cleanEstimate = (): LinkedEstimate => ({
  id: 'e1', globalMarkup: 18, baseTotal: 100_000, markupTotal: 18_000, grandTotal: 118_000, createdAt: '2026-01-01',
  items: [{
    materialId: 'm1', name: 'Base scope', category: 'Framing', unit: 'ea', quantity: 1, unitPrice: 100_000,
    bulkPrice: 100_000, markup: 18, usesBulk: false, lineTotal: 118_000, supplier: '',
  }],
});
let gen = 0;
const newId = () => `gen_${++gen}`;
const line = (over: Partial<PushLine> = {}): PushLine => ({
  conditionId: 'c1', name: '5/8 drywall', trade: 'Drywall', unit: 'SF', quantity: 2000, rate: 3.34, priceSource: 'learned', ...over,
});

// (a) APPEND foots, and moves the totals exactly like the phone block.
const est0 = cleanEstimate();
const a = applyTakeoffPush(est0, [line({ quantity: 1234, rate: 3.37 })], {}, newId);
const phone = phoneAppend(cleanEstimate(), 1234 * 3.37, 'Drywall', 1234, 3.37, 'x', 'SF', roundCents, () => 'p');
ok('(a) the estimate foots before', foots(est0));
ok('(a) APPEND foots: Σ lineTotal === grandTotal, grand − base === markup', foots(a.next));
eq('(a) …and base/markup/grand move exactly like the phone block',
  [a.next.baseTotal, a.next.markupTotal, a.next.grandTotal], [phone.baseTotal, phone.markupTotal, phone.grandTotal]);
eq('(a) the appended line: phone lineTotal and markup, his condition name, carries the condition id',
  [a.next.items[1].lineTotal, a.next.items[1].markup, a.next.items[1].name, a.next.items[1].category, a.next.items[1].sourceTakeoffConditionId, a.next.items[1].priceSource],
  [phone.items[1].lineTotal, phone.items[1].markup, '5/8 drywall', 'Drywall', 'c1', 'learned']);
eq('(a) added/updated/pushed bookkeeping', [a.added, a.updated, a.pushed, a.beforeGrand, a.afterGrand],
  [1, 0, { c1: a.next.items[1].materialId }, 118_000, a.next.grandTotal]);

// (b) PANEL == PUSH on 3-decimal book rates.
const docB: TakeoffDoc = {
  version: 1,
  conditions: [cond({ id: 'd', name: 'Drywall', trade: 'Drywall' }), cond({ id: 'f', name: 'Framing', trade: 'Framing' })],
  measurements: [meas({ id: 'md', conditionId: 'd', points: sq, aspect: 1 }), meas({ id: 'mf', conditionId: 'f', points: sq, aspect: 1 })],
  pushed: {},
};
const RB = rollup(docB, DB, () => CAL100);
const PB = pushLinesFrom(RB.rows);
eq('(b) the push quantity and rate are exactly what the panel priced (rate on the cent grid)',
  PB.lines.map(l => [l.quantity, l.rate]), [[2000, 3.34], [2000, 412.34]]);
const b = applyTakeoffPush(cleanEstimate(), PB.lines, {}, newId);
const panelCents = RB.rows.reduce((s, r) => s + (r.price.amountCents ?? 0), 0);
eq('(b) PANEL == PUSH: Σ amountCents === the baseTotal delta in cents === rollup.costCents',
  [panelCents, Math.round((b.next.baseTotal - 100_000) * 100), RB.costCents], [panelCents, panelCents, panelCents]);
ok('(b) …and the estimate still foots', foots(b.next));

// (c) re-push of the SAME lines is idempotent.
const c2 = applyTakeoffPush(b.next, PB.lines, b.pushed, newId);
ok('(c) re-push of the same lines changes nothing (estimatesEqual)', estimatesEqual(b.next, c2.next));
eq('(c) …0 added, 0 updated, same pushed map', [c2.added, c2.updated, c2.pushed], [0, 0, b.pushed]);

// (d) changed quantity UPDATES; the line keeps its own edited markup.
const edited: LinkedEstimate = recomputeEstimate({
  ...b.next, items: b.next.items.map(i => (i.sourceTakeoffConditionId === 'd' ? { ...i, markup: 25 } : i)),
});
ok('(d) setup: his edit (25% on the drywall line) foots', foots(edited));
const dLines = PB.lines.map(l => (l.conditionId === 'd' ? { ...l, quantity: 2500 } : l));
const dd = applyTakeoffPush(edited, dLines, b.pushed, newId);
const dLine = dd.next.items.find(i => i.sourceTakeoffConditionId === 'd')!;
eq('(d) UPDATE: no new line, his 25% kept, quantity moved', [dd.next.items.length, dLine.markup, dLine.quantity, dd.added, dd.updated],
  [edited.items.length, 25, 2500, 0, 1]);
eq('(d) totals move by the delta', [dd.next.baseTotal, dd.next.grandTotal],
  [roundCents(edited.baseTotal + 500 * 3.34), roundCents(edited.grandTotal + roundCents(roundCents(2500 * 3.34) * 1.25) - roundCents(roundCents(2000 * 3.34) * 1.25))]);
ok('(d) …and still foot', foots(dd.next));

// (e) UPDATE of a line he switched to bulk: the delta is against q × bulkPrice.
const bulked: LinkedEstimate = recomputeEstimate({
  ...b.next, items: b.next.items.map(i => (i.sourceTakeoffConditionId === 'd' ? { ...i, usesBulk: true, bulkPrice: 2.9 } : i)),
});
ok('(e) setup: the bulk switch foots', foots(bulked));
const e = applyTakeoffPush(bulked, dLines, b.pushed, newId);
eq('(e) baseTotal moves by new cost − q × bulkPrice (not × unitPrice)', e.next.baseTotal,
  roundCents(bulked.baseTotal + roundCents(2500 * 3.34) - roundCents(2000 * 2.9)));
ok('(e) Σ lineTotal === grandTotal and grand − base === markup, to the cent', foots(e.next));
eq('(e) the line is back on unit pricing at the pushed rate', (() => { const l = e.next.items.find(i => i.sourceTakeoffConditionId === 'd')!; return [l.usesBulk, l.unitPrice, l.bulkPrice]; })(), [false, 3.34, 3.34]);

// (f) fallback match by the materialId the last push wrote.
const stripped: LinkedEstimate = { ...b.next, items: b.next.items.map(i => { const { sourceTakeoffConditionId: _s, ...rest } = i; return rest as LinkedEstimateItem; }) };
const f = applyTakeoffPush(stripped, dLines, b.pushed, newId);
eq('(f) a stripped id still UPDATES (no duplicate) and is restamped',
  [f.next.items.length, f.added, f.next.items.filter(i => i.sourceTakeoffConditionId === 'd').length, f.next.items.find(i => i.materialId === b.pushed.d)?.quantity],
  [stripped.items.length, 0, 1, 2500]);
ok('(f) …and foots', foots(f.next));
const noMap = applyTakeoffPush(stripped, dLines, {}, newId);
eq('(f) without the map it can only append (why doc.pushed is kept)', noMap.added, 2);

// (g) the field survives recomputeEstimate.
eq('(g) sourceTakeoffConditionId survives recomputeEstimate',
  recomputeEstimate(b.next).items.map(i => i.sourceTakeoffConditionId ?? null), [null, 'd', 'f']);
ok('(g) a pushed estimate is a fixed point of recomputeEstimate', estimatesEqual(recomputeEstimate(b.next), b.next));

// (h) skips.
const docH: TakeoffDoc = {
  version: 1,
  conditions: [cond({ id: 'nr', trade: null }), cond({ id: 'nq' }), cond({ id: 'nm' })],
  measurements: [meas({ id: 'a', conditionId: 'nr', points: sq, aspect: 1, sheetId: 'OK' }), meas({ id: 'b', conditionId: 'nm', sheetId: 'NOSCALE' })],
  pushed: {},
};
const H = pushLinesFrom(rollup(docH, DB, s => (s === 'OK' ? CAL100 : null)).rows);
eq('(h) unpriced → no_rate; nothing drawn → no_quantity; unscaled sheet → not_measured',
  H.skipped, [{ conditionId: 'nr', reason: 'no_rate' }, { conditionId: 'nq', reason: 'no_quantity' }, { conditionId: 'nm', reason: 'not_measured' }]);
eq('(h) nothing pushes', H.lines.length, 0);
eq('(h) override pushes with no priceSource; seeded book → seeded',
  pushLinesFrom(rollup({ ...DOC, conditions: [cond({ rateOverride: 7 }), DOC.conditions[1]] }, DB, () => CAL100).rows).lines.map(l => l.priceSource ?? null),
  [null, 'seeded']);
const withOverride = applyTakeoffPush(b.next, [line({ conditionId: 'd', name: 'Drywall', rate: 7, priceSource: undefined })], b.pushed, newId);
ok('(h) re-pushing with an override drops the stale book priceSource', !('priceSource' in withOverride.next.items.find(i => i.sourceTakeoffConditionId === 'd')!));

// (i) the AIA-F11 case: $40,000 onto $118,000 @ 18% foots G703 = G702.
const iRes = applyTakeoffPush(cleanEstimate(), [line({ quantity: 40_000, rate: 1 })], {}, newId);
eq('(i) the $40,000 line at SELL; contract $165,200', [iRes.next.items[1].lineTotal, iRes.next.grandTotal, iRes.next.baseTotal, iRes.next.markupTotal],
  [47_200, 165_200, 140_000, 25_200]);
const cert = (est: LinkedEstimate) => reconcileAIASov(seedAIAPayApplicationFromInvoice({
  id: 'inv1', projectId: 'p1', number: 1, type: 'progress', status: 'sent', issueDate: '2026-03-31', dueDate: '2026-04-30',
  lineItems: [], subtotal: 0, taxAmount: 0, totalDue: 0, amountPaid: 0, retentionPercent: 10,
} as unknown as Invoice, { id: 'p1', name: 'Job', status: 'active', linkedEstimate: est } as unknown as Project, [], { companyName: 'GC' } as never));
eq('(i) G703 column C foots to G702 line 3', [cert(iRes.next).difference, cert(iRes.next).reconciled], [0, true]);
eq('(i) …and after a re-push with a new quantity', cert(applyTakeoffPush(iRes.next, [line({ quantity: 41_234, rate: 1.07 })], iRes.pushed, newId).next).reconciled, true);

// pushBlockReason
console.log('\npushBlockReason:');
const proj = { id: 'p1', name: 'Job', linkedEstimate: cleanEstimate() } as unknown as Project;
eq('no project', pushBlockReason(null, [line()]), 'Pick a job to push to.');
eq('no lines', pushBlockReason(proj, []), 'Nothing to push — every condition needs a quantity and a rate.');
eq('no estimate on the job', pushBlockReason({ ...proj, linkedEstimate: undefined } as unknown as Project, [line()]),
  'This job has no estimate yet — start one in Estimate, then push.');
eq('pushable', pushBlockReason(proj, [line()]), null);

// ── 5. source pins ──────────────────────────────────────────────────────────
console.log('\nsource pins:');
const hookSrc = readFileSync(join(ROOT, 'hooks/useTakeoffConditions.ts'), 'utf8');
const prefix = /export const TAKEOFF_DOC_KEY_PREFIX = '([^']+)'/.exec(hookSrc)?.[1] ?? '';
ok(`storage key prefix is mageid_ and swept on sign-out (${prefix})`, prefix === 'mageid_takeoff_conditions::' && isAppStorageKey(`${prefix}p1`));
ok('the hook guards every AsyncStorage call', (hookSrc.match(/AsyncStorage\.(getItem|setItem)/g) ?? []).length === 2
  && /try \{\s*void AsyncStorage\.setItem/.test(hookSrc) && /try \{\s*AsyncStorage\.getItem/.test(hookSrc));
ok('undo/redo carry the current push bookkeeping forward', /pushed: cur\.pushed/.test(hookSrc) && (hookSrc.match(/keepPush\(target, cur\)/g) ?? []).length === 2);
for (const fname of readdirSync(join(ROOT, 'utils/takeoff'))) {
  const src = readFileSync(join(ROOT, 'utils/takeoff', fname), 'utf8');
  ok(`utils/takeoff/${fname} imports no react / react-native / storage`, !/from '(react|react-native|@react-native-async-storage\/async-storage)'/.test(src));
}
const typesSrc = readFileSync(join(ROOT, 'types/index.ts'), 'utf8');
ok('LinkedEstimateItem.sourceTakeoffConditionId is declared optional', /interface LinkedEstimateItem \{[\s\S]*?sourceTakeoffConditionId\?: string;[\s\S]*?\n\}/.test(typesSrc));
const pushSrc = readFileSync(join(ROOT, 'utils/takeoff/conditionPush.ts'), 'utf8');
ok('the push never recomputes the whole estimate', !/recomputeEstimate\(|withMarkup\(/.test(pushSrc));

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} validate-takeoff-conditions: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
