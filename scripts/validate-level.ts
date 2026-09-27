/**
 * validate-level.ts — "The Level", MAGE ID's one loading system (replaces
 * validate-loader.ts, which guarded the retired ToppingOutMark).
 *
 * Run: bun run scripts/validate-level.ts
 *
 * WHY. Every loader draws the spirit level the native splash shows; its bubble
 * seeks on ONE shared native clock and settles only when the work is done.
 * That only stays smooth (and honest) while the maths, the loop shape, the
 * theme access and the entry points stay exactly as built. Each rule below
 * fails the build the moment one drifts:
 *
 *  A. Maths: ranges strictly increasing in [0, 1]; seam equality; 25 / 33
 *     samples; the 24-segment sine within 0.9 % of amplitude; one period in
 *     [1300, 1440]; one Reduce-Motion period; the splash retract fractions.
 *  B. Geometry: the four anchor rows; MONOTONIC and CLEARANCE for every
 *     integer width 20…120; the splash clearance; the splash radii.
 *  C. Gate: the scope table and the reducer's cases.
 *  D. Source rules over components/loaders/** (comment-stripped).
 *  E. Entry points: CraneLoader / ConstructionLoader (+ one ADVISORY warn).
 *  F. Retired files are gone and nothing imports them.
 *  G. Splash constants (shape only; the PNG pixel assertions live in the
 *     SPLASHPX lane's scripts/validate-level-splash.ts).
 *  H. ActivityIndicator ratchet.
 *  I. Motion.loader is LOADER.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// constants/designTokens.ts imports react-native (Platform), which bun cannot
// parse. Stub it with the one export designTokens touches, then import
// dynamically. utils/levelTimeline.ts and utils/loadingGate.ts are RN-free.
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('validate-level must run under bun (needs Bun.plugin to stub react-native)');
  process.exit(1);
}
Bun.plugin({
  name: 'validate-level-stubs',
  setup(build) {
    build.module('react-native', () => ({
      loader: 'object',
      exports: { Platform: { OS: 'ios', select: (o: Record<string, unknown>) => ('ios' in o ? o.ios : o.default) } },
    }));
  },
});
const L = await import('../utils/levelTimeline');
const G = await import('../utils/loadingGate');
const { Motion } = await import('../constants/designTokens');

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const relp = (p: string) => relative(ROOT, p).split(sep).join('/');

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; return; }
  failures++;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

/** Source with // and /* *\/ comments blanked, so prose cannot trip a rule. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

/** The text of the balanced (...) or {...} group opening at `open`. */
function group(src: string, open: number): string {
  const o = src[open];
  const c = o === '(' ? ')' : o === '{' ? '}' : ']';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c) { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

function walk(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs)) {
    const p = join(abs, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (e !== 'node_modules') out.push(...walk(relp(p), re)); }
    else if (re.test(e) && !/\.d\.ts$/.test(e)) out.push(relp(p));
  }
  return out;
}

const strictlyUp = (xs: readonly number[]) => xs.every((x, k) => x >= 0 && x <= 1 && (k === 0 || x > xs[k - 1]));
const seam = (ys: readonly number[]) => ys[0] === ys[ys.length - 1];

// ── A. Maths ─────────────────────────────────────────────────────────────────
check('A LEVEL_PERIOD_MS in [1300, 1440]', L.LEVEL_PERIOD_MS >= 1300 && L.LEVEL_PERIOD_MS <= 1440, String(L.LEVEL_PERIOD_MS));
check('A exactly one Reduce-Motion period (1.6 × the period)', L.LEVEL_RM_PERIOD_MS === 2240 && near(L.LEVEL_RM_PERIOD_MS, 1.6 * L.LEVEL_PERIOD_MS, 1e-6));
check('A LOADER carries the one period and the one RM period', L.LOADER.periodMs === L.LEVEL_PERIOD_MS && L.LOADER.rmPeriodMs === L.LEVEL_RM_PERIOD_MS);
check('A SAMPLES is 25', L.SAMPLES === 25);
check('A levelInput: 25 samples, strictly increasing, 0 … 1', L.levelInput.length === 25 && strictlyUp(L.levelInput)
  && L.levelInput[0] === 0 && L.levelInput[24] === 1);
for (const [name, ys] of [['driftUnit', L.driftUnit], ['speedUnit', L.speedUnit], ['rmBreath', L.rmBreath]] as const) {
  check(`A ${name} has 25 samples`, ys.length === 25, String(ys.length));
  check(`A ${name} seam: sample 0 === sample 24`, seam(ys), `${ys[0]} / ${ys[24]}`);
  check(`A ${name} rounded to 4 decimals`, ys.every((y) => near(Math.round(y * 1e4) / 1e4, y, 1e-12)));
}
check('A driftUnit seam is 0/0, speedUnit 1/1, rmBreath 1/1', L.driftUnit[0] === 0 && L.speedUnit[0] === 1 && L.rmBreath[0] === 1);
check('A rmBreath spans 1 → 0.5 → 1', L.rmBreath[12] === 0.5 && Math.max(...L.rmBreath) === 1 && Math.min(...L.rmBreath) === 0.5);
check('A speedUnit is 0 at the turnarounds (k = 6, 18)', L.speedUnit[6] === 0 && L.speedUnit[18] === 0);
check('A beatRange strictly increasing, seam .8/.8', strictlyUp(L.beatRange.inputRange) && seam(L.beatRange.outputRange)
  && L.beatRange.outputRange[0] === 0.8 && L.beatRange.inputRange.length === L.beatRange.outputRange.length);
{
  let maxErr = 0;
  const drift = { inputRange: L.levelInput, outputRange: L.driftUnit };
  for (let i = 0; i <= 4800; i++) {
    const t = i / 4800;
    maxErr = Math.max(maxErr, Math.abs(L.evalRange(drift, t) - Math.sin(2 * Math.PI * t)));
  }
  check('A 24-segment sine chord error ≤ 0.9 % of amplitude', maxErr <= 0.009, `${(maxErr * 100).toFixed(3)} %`);
}
for (const phi of [0, 0.1, 0.34, 0.9]) {
  const w = L.skeletonWave(phi);
  check(`A skeletonWave(${phi}): 33 samples, strictly increasing 0…1, seam`, w.inputRange.length === 33 && w.outputRange.length === 33
    && strictlyUp(w.inputRange) && w.inputRange[0] === 0 && w.inputRange[32] === 1 && seam(w.outputRange));
  check(`A skeletonWave(${phi}) within [alpha·(1 − dip), alpha]`, w.outputRange.every((y) => y <= 0.09 + 1e-9 && y >= 0.09 * 0.6 - 1e-4));
}
check('A skeletonPhase: unindexed = 0, row·0.10 + col·0.04 mod 1', L.skeletonPhase() === 0 && L.skeletonPhase(3) === 0.3
  && L.skeletonPhase(2, 3) === 0.32 && L.skeletonPhase(12) === 0.2);
{
  const R = L.retractRanges;
  const F = L.RETRACT_FRACTIONS;
  const e = L.LOADER.splash.exit;
  for (const [name, r] of Object.entries(R)) {
    check(`A retract ${name}: strictly increasing 0…1, same length`, strictlyUp(r.inputRange) && r.inputRange[0] === 0
      && r.inputRange[r.inputRange.length - 1] === 1 && r.inputRange.length === r.outputRange.length);
  }
  check('A LOADER.splash.exit is the one set of numbers', e.ampMs === 280 && e.retractAtMs === 180 && e.retractSpanMs === 300
    && e.trackMs === 220 && e.bubbleOutAtMs === 260 && e.bubbleOutMs === 160 && e.inkAtMs === 180 && e.inkMs === 300);
  check('A retract fractions reproduce the exit numbers (.7333 / .2667 / .8)', F.trackEnd === 0.7333 && F.bubbleStart === 0.2667 && F.bubbleEnd === 0.8,
    JSON.stringify(F));
  const ts = R.trackScaleX;
  const zeroAt = ts.inputRange[ts.outputRange.indexOf(0)];
  check('A trackScaleX reaches 0 exactly at .7333 and holds 0', zeroAt === F.trackEnd && ts.outputRange[0] === 1
    && L.evalRange(ts, F.trackEnd - 0.01) > 0 && L.evalRange(ts, 1) === 0);
  check('A trackScaleX is monotonic non-increasing', ts.outputRange.every((y, k) => k === 0 || y <= ts.outputRange[k - 1]));
  for (const [name, r, end] of [['bubbleScale', R.bubbleScale, 0.6], ['bubbleOpacity', R.bubbleOpacity, 0]] as const) {
    check(`A ${name} flat at 1 until exactly .2667`, L.evalRange(r, F.bubbleStart) === 1 && L.evalRange(r, F.bubbleStart + 0.01) < 1);
    check(`A ${name} reaches ${end} exactly at .8 and holds`, L.evalRange(r, F.bubbleEnd) === end && L.evalRange(r, F.bubbleEnd - 0.01) > end
      && L.evalRange(r, 1) === end);
    check(`A ${name} monotonic non-increasing`, r.outputRange.every((y, k) => k === 0 || y <= r.outputRange[k - 1]));
  }
  // ACCELERATE-sampled (ease-in): the first half moves less than the second.
  const mid = L.evalRange(R.bubbleOpacity, (F.bubbleStart + F.bubbleEnd) / 2);
  check('A bubble fade is ease-in (accelerate): > 0.5 left at mid-span', mid > 0.55, mid.toFixed(3));
}
{
  const p = L.plateau(0.5, (x) => x);
  check('A plateau: flat 0 before d, inner after', p(0.25) === 0 && p(0.5) === 0 && near(p(0.75), 0.5) && p(1) === 1);
  check('A plateau(0) is the inner curve', L.plateau(0, (x) => x * x)(0.5) === 0.25);
  check('A bezier ends at 0 and 1; DECELERATE fast out, ACCELERATE slow in', L.DECELERATE(0) === 0 && L.DECELERATE(1) === 1
    && L.DECELERATE(0.5) > 0.8 && L.ACCELERATE(0.5) < 0.35 && near(L.STANDARD(0.5), 0.7756, 5e-3));
  check('A easeOutCubic / easeInOutSine endpoints', L.easeOutCubic(0) === 0 && L.easeOutCubic(1) === 1 && near(L.easeInOutSine(0.5), 0.5));
  const et = L.enterTimings(150);
  check('A enter with the default 150 ms reveal: vis 320 (150 flat), amp 630 (150 flat)', et.visTotal === 320 && et.ampTotal === 630
    && near(et.visPlateau, 150 / 320) && near(et.ampPlateau, 150 / 630));
  const e0 = L.enterTimings(0);
  check('A enter with d = 0: no plateau', e0.visPlateau === 0 && e0.ampPlateau === 0 && e0.visTotal === 170 && e0.ampTotal === 480);
  const S = L.LOADER.settle;
  check('A settle: amp 280 @0, lvl 100 @160, vis 140 @200 (gone at +340), content 200 @200 rising 6', S.ampMs === 280 && S.lvlAtMs === 160
    && S.lvlMs === 100 && S.visAtMs === 200 && S.visMs === 140 && S.contentAtMs === 200 && S.contentMs === 200 && S.contentRise === 6
    && S.visAtMs + S.visMs === 340);
  check('A fade exit 120, RM settle 160, elapsed after 8000', L.LOADER.fadeExitMs === 120 && L.LOADER.rmSettleMs === 160
    && L.LOADER.workProgress.elapsedAfterMs === 8000);
}

// ── B. Geometry ──────────────────────────────────────────────────────────────
{
  const rows: Record<number, [number, number, number, number, number | null, number, number]> = {
    20: [7, 4, 5, 1.5, null, 0.1, 0.06],
    36: [10, 5, 8, 1.5, 7, 0.12, 0.08],
    64: [14, 6, 16, 1.5, 9, 0.14, 0.1],
    120: [18, 7, 28, 2, 10, 0.14, 0.1],
  };
  for (const [w, [bw, bh, amp, th, ch, st, sq]] of Object.entries(rows)) {
    const g = L.levelGeometry(Number(w));
    check(`B anchor ${w}: bubble ${bw}×${bh}, amp ${amp}, track ${th}, caps ${ch ?? 'none'}, stretch ${st}, squash ${sq}`,
      near(g.bubble.w, bw) && near(g.bubble.h, bh) && near(g.amp, amp) && near(g.track.h, th)
      && (ch == null ? g.caps === null : !!g.caps && near(g.caps.h, ch) && near(g.caps.w, th))
      && near(g.stretch, st) && near(g.squash, sq), JSON.stringify(g));
  }
  check('B track opacity 0.30 ≤ 36 px, 0.25 above', L.levelGeometry(36).track.opacity === 0.3 && L.levelGeometry(37).track.opacity === 0.25);
  check('B caps begin at 28 px at height 6', L.levelGeometry(27).caps === null && !!L.levelGeometry(28).caps && near(L.levelGeometry(28).caps!.h, 6));
  check('B graduations only ≥ 96 px, 1 wide, ±0.086·width', L.levelGeometry(95).grads === null && !!L.levelGeometry(96).grads
    && near(L.levelGeometry(120).grads!.w, 1) && near(L.levelGeometry(120).grads!.h, 6)
    && near(L.levelGeometry(120).grads!.xL + 0.5, 60 - 0.086 * 120, 1e-9));
  check('B classes S ≤ 24 < M ≤ 48 < L ≤ 96 < XL', L.levelGeometry(24).cls === 'S' && L.levelGeometry(25).cls === 'M'
    && L.levelGeometry(48).cls === 'M' && L.levelGeometry(49).cls === 'L' && L.levelGeometry(96).cls === 'L' && L.levelGeometry(97).cls === 'XL');
  check('B widths clamp to [20, 120]', L.levelGeometry(8).boxW === 20 && L.levelGeometry(400).boxW === 120);
  let prev = L.levelGeometry(20);
  const monoBad: string[] = [];
  const clearBad: string[] = [];
  const minBad: string[] = [];
  for (let w = 20; w <= 120; w++) {
    const g = L.levelGeometry(w);
    if (w > 20) {
      if (g.bubble.w < prev.bubble.w || g.bubble.h < prev.bubble.h || g.amp < prev.amp || g.track.h < prev.track.h
        || (g.caps && prev.caps && g.caps.h < prev.caps.h)) monoBad.push(String(w));
    }
    if (L.levelClearance(w) < 1.5 - 1e-9) clearBad.push(`${w}:${L.levelClearance(w).toFixed(3)}`);
    if (g.track.h < 1 || g.bubble.h < 4 || (g.caps && g.caps.w < 1)) minBad.push(String(w));
    const boxH = Math.max(g.caps?.h ?? 0, g.bubble.h, g.track.h);
    if (!near(g.boxH, boxH) || !near(g.track.w, g.boxW - 2 * (g.caps ? g.caps.w : 0))) minBad.push(`${w}:box`);
    prev = g;
  }
  check('B MONOTONIC: bubbleW, bubbleH, amp, capH, trackH non-decreasing 20…120', monoBad.length === 0, monoBad.join(','));
  check('B CLEARANCE: bubble edge at full amplitude ≥ 1.5 px inside the track end / cap, 20…120', clearBad.length === 0, clearBad.join(','));
  check('B nothing thinner than 1, bubble never shorter than 4; box + track spans consistent', minBad.length === 0, minBad.join(','));
  const P = L.NATIVE_SPLASH_PX;
  const bc = (P.bubble.x0 + P.bubble.x1) / 2;
  const hw = (P.bubble.x1 - P.bubble.x0) / 2;
  check('B splash clearance: 512.5 ± AMP ± 33.5 inside 301…723', bc === 512.5 && hw === 33.5
    && bc - L.NATIVE_SPLASH_AMP_PX - hw >= P.track.x0 && bc + L.NATIVE_SPLASH_AMP_PX + hw <= P.track.x1);
  const sp = L.levelParts(168.1, 'splash');
  const s = 168.1 / 438;
  check('B splash parts: track radius 0 (SQUARE, NATIVE_SPLASH_RADII_PX), caps 4·s, bubble 13·s; no grads, no lvl', sp.splash
    && sp.track.radius === 0 && near(sp.capL!.radius, 4 * s) && near(sp.bubble.radius, 13 * s) && sp.grads === null && !sp.hasLvl
    && near(sp.amp, 110 * s) && near(sp.trackOpacity, 64 / 255) && near(sp.capOpacity, 64 / 255)
    && near(sp.boxW, 168.1) && near(sp.boxH, 30 * s) && near(sp.bubble.left, (479 - 293) * s) && near(sp.bubble.width, 67 * s));
  check('B levelParts reads NATIVE_SPLASH_RADII_PX for the splash', /NATIVE_SPLASH_RADII_PX/.test(code(read('utils/levelTimeline.ts')).slice(code(read('utils/levelTimeline.ts')).indexOf('export function levelParts'))));
  const t64 = L.levelParts(64, 'accent');
  check('B table parts: track h/2 radius, lvl from 64, onAccent track .35, muted .30', near(t64.track.radius, 0.75) && t64.hasLvl
    && !L.levelParts(63, 'accent').hasLvl && L.levelParts(20, 'onAccent').trackOpacity === 0.35 && L.levelParts(64, 'muted').trackOpacity === 0.3);
}

// ── C. Gate ──────────────────────────────────────────────────────────────────
{
  const T = G.GATE;
  const want: Record<string, [number, number, string]> = {
    button: [120, 400, 'fade'], inline: [150, 400, 'fade'], section: [150, 400, 'settle'],
    screen: [200, 500, 'settle'], skeleton: [100, 400, 'fade'], knownSlow: [0, 600, 'settle'],
  };
  check('C GATE has exactly the six scopes', Object.keys(T).sort().join() === Object.keys(want).sort().join());
  for (const [k, [d, m, e]] of Object.entries(want)) {
    const c = T[k as keyof typeof T];
    check(`C GATE.${k} = ${d}/${m} ${e}`, !!c && c.delayMs === d && c.minMs === m && c.exit === e, JSON.stringify(c));
  }
  check('C LOADER.gate is GATE; button reveal 120 / hold 400', L.LOADER.gate === T && L.LOADER.button.revealMs === 120 && L.LOADER.button.minHoldMs === 400);
  const st = G.gateStart(1000);
  check('C gateStart → pending', st.phase === 'pending' && st.startedAt === 1000);
  check('C gateVisible: screen hidden at 199 ms, shown at 200', !G.gateVisible(st, 'screen', 1199) && G.gateVisible(st, 'screen', 1200));
  check('C knownSlow is visible at once', G.gateVisible(st, 'knownSlow', 1000));
  const r100 = G.gateReady(st, 'screen', 1100);
  check('C screen ready at 100 ms → skip (done)', r100.action === 'skip' && r100.state.phase === 'done');
  const r300 = G.gateReady(st, 'screen', 1300);
  check('C screen ready at 300 ms → hold 400', typeof r300.action === 'object' && r300.action.kind === 'hold' && r300.action.ms === 400
    && r300.state.phase === 'holding', JSON.stringify(r300));
  const r900 = G.gateReady(st, 'screen', 1900);
  check('C screen ready at 900 ms → exit', r900.action === 'exit' && r900.state.phase === 'exiting');
  const rb = G.gateReady(st, 'button', 1100);
  check('C button ready at 100 ms → skip (no busy visual)', rb.action === 'skip');
  const rs = G.gateRestart(r300.state, 1400);
  check('C restart during holding → shown, no second delay', rs.phase === 'shown' && G.gateVisible(rs, 'screen', 1400)
    && G.gateReady(rs, 'screen', 1401).action !== 'skip');
  const rx = G.gateRestart(r900.state, 2000);
  check('C restart during exiting → shown', rx.phase === 'shown');
  check('C restart in any other phase is a no-op', G.gateRestart(st, 1500) === st);
  // The hook's snapshot reducer end to end.
  let s = G.gateInitial(true, 0);
  check('C snapshot: loading at mount → show, not exiting', s.show && !s.exiting && s.gate.phase === 'pending');
  s = G.gateStep(s, false, 'screen', 300);
  check('C snapshot: ready at 300 → holding 400, still showing, wasShown', s.show && !s.exiting && s.holdMs === 400 && s.wasShown && s.gate.phase === 'holding');
  s = G.gateHoldElapsed(s);
  check('C snapshot: hold elapsed → exiting', s.exiting && s.gate.phase === 'exiting');
  const back = G.gateStep(s, true, 'screen', 750);
  check('C snapshot: loading again while exiting → shown, not exiting', back.show && !back.exiting && back.gate.phase === 'shown');
  s = G.gateExited(s);
  check('C snapshot: exited → unmounted', !s.show && !s.exiting && s.gate.phase === 'done');
  const fast = G.gateStep(G.gateInitial(true, 0), false, 'screen', 100);
  check('C snapshot: ready inside the delay → skip: unmount, no Arrive', !fast.show && !fast.wasShown && !fast.exiting);
  const again = G.gateStep(fast, true, 'screen', 5000);
  check('C snapshot: loading after done starts a fresh delay', again.show && again.gate.phase === 'pending' && again.gate.startedAt === 5000);
  check('C snapshot: idle at mount when not loading', !G.gateInitial(false, 0).show);
  check('C exit durations: settle 340, fade 120, RM 160; backstop 150', G.gateExitMs('screen', false) === 340 && G.gateExitMs('inline', false) === 120
    && G.gateExitMs('screen', true) === 160 && G.GATE_BACKSTOP_MS === 150);
  check('C the gate hook\'s exiting backstop only catches a LOST callback: exitMs + GATE_LOST_CALLBACK_MS (500)', G.GATE_LOST_CALLBACK_MS === 500
    && /gateExitMs\(scope, reduce\) \+ GATE_LOST_CALLBACK_MS\)/.test(code(read('hooks/useLoadingGate.ts'))));
}

// ── D. Source rules over components/loaders/** ───────────────────────────────
const MARKER = '// LEGACY-SVG-CRANE: moved verbatim by CORE; the WEB lane rebuilds this file as composited CSS divs and deletes this marker.';
const LOADER_FILES = walk('components/loaders', /\.(ts|tsx)$/);
check('D components/loaders holds the level files', ['LevelMark.tsx', 'levelClock.ts', 'Loading.tsx', 'Arrive.tsx', 'ScreenLoader.tsx', 'BootShell.tsx', 'themeFallback.ts', 'LevelMarkWeb.tsx']
  .every((f) => LOADER_FILES.includes(`components/loaders/${f}`)), LOADER_FILES.join(','));
const HEX = /#[0-9a-fA-F]{3,8}\b/;
for (const f of LOADER_FILES) {
  const raw = read(f);
  if (f === 'components/loaders/CraneMarkWeb.tsx' && raw.includes(MARKER)) {
    console.info('NOTE: CraneMarkWeb.tsx exempt (legacy marker present)');
    continue;
  }
  const src = code(raw);
  // no easing inside interpolate
  let idx = src.indexOf('.interpolate(');
  let easingInside = false;
  while (idx >= 0) {
    if (/\beasing\s*:/.test(group(src, idx + '.interpolate'.length))) easingInside = true;
    idx = src.indexOf('.interpolate(', idx + 1);
  }
  check(`D ${f}: no easing: inside .interpolate({`, !easingInside);
  check(`D ${f}: no useNativeDriver: true|false literal`, !/useNativeDriver\s*:\s*(true|false)\b/.test(src));
  const loopBad: string[] = [];
  let li = src.indexOf('Animated.loop(');
  while (li >= 0) {
    const inner = group(src, li + 'Animated.loop'.length).slice(1, -1).trim();
    const timings = (inner.match(/Animated\.timing\(/g) ?? []).length;
    if (!/^Animated\.timing\(/.test(inner) || timings !== 1) loopBad.push('not exactly one Animated.timing');
    if (!/easing\s*:\s*Easing\.linear\b/.test(inner)) loopBad.push('not Easing.linear');
    if (!/isInteraction\s*:\s*false\b/.test(inner)) loopBad.push('no isInteraction: false');
    if (/Animated\.(sequence|stagger|delay|spring|parallel)\b/.test(inner)) loopBad.push('sequence/stagger/delay inside');
    li = src.indexOf('Animated.loop(', li + 1);
  }
  check(`D ${f}: every Animated.loop wraps exactly one linear, non-interaction Animated.timing`, loopBad.length === 0, loopBad.join('; '));
  check(`D ${f}: no setNativeProps`, !/setNativeProps/.test(src));
  const animIds = new Set(['vis', 'amp', 'lvl', 'drive', 'clock', 'hueMix', 'retract']);
  for (const m of src.matchAll(/(\w+)\s*=\s*(?:useRef\()?new Animated\.Value/g)) animIds.add(m[1]);
  const layoutBad: string[] = [];
  for (const m of src.matchAll(/\b(width|height|left|top|right|bottom|backgroundColor)\s*:\s*([^,}\n]*)/g)) {
    const v = m[2];
    if (/interpolate\(|Animated\./.test(v) || [...animIds].some((id) => new RegExp(`^\\s*${id}\\b`).test(v))) layoutBad.push(`${m[1]}: ${v.trim()}`);
  }
  check(`D ${f}: animated style keys are opacity / transform only`, layoutBad.length === 0, layoutBad.join(' | '));
  const kfBad: string[] = [];
  for (const m of src.matchAll(/(?:['"]?\d+%['"]?|\bfrom|\bto)\s*:\s*\{([^{}]*)\}/g)) {
    if (!/animationKeyframes/.test(src)) break;
    for (const k of m[1].matchAll(/(\w+)\s*:/g)) if (k[1] !== 'transform' && k[1] !== 'opacity') kfBad.push(k[1]);
  }
  check(`D ${f}: keyframes animate transform / opacity only`, kfBad.length === 0, kfBad.join(','));
  check(`D ${f}: no hex colour (NATIVE_SPLASH_* only, from utils/levelTimeline.ts)`, !HEX.test(src), (src.match(HEX) ?? [''])[0]);
  const destructure = /const\s*\{[^}]*\}\s*=\s*useTheme\(\)/.test(src);
  const member = /useTheme\(\)\s*\./.test(src);
  const calls = (src.match(/useTheme\(\)/g) ?? []).length;
  const whole = (src.match(/const theme = useTheme\(\)/g) ?? []).length;
  check(`D ${f}: useTheme() assigned whole and read with ?. (null-safe outside the provider)`,
    !destructure && !member && calls === whole && !/\btheme\.(?!\?)/.test(src.replace(/\btheme\?\./g, '')));
}
{
  const mark = code(read('components/loaders/LevelMark.tsx'));
  const web = code(read('components/loaders/LevelMarkWeb.tsx'));
  check('D LevelMark.tsx / LevelMarkWeb.tsx import nothing from react-native-svg', !/react-native-svg/.test(mark) && !/react-native-svg/.test(web));
  check('D LevelMark.tsx: no createAnimatedComponent', !/createAnimatedComponent/.test(mark));
  const receivers = [...mark.matchAll(/(\w+)\.stopAnimation\(/g)].map((m) => m[1]);
  check('D LevelMark.tsx calls stopAnimation ONLY on amp', receivers.length >= 1 && receivers.every((r) => r === 'amp'), receivers.join(','));
  const rmAt = mark.search(/if \(reduce\) \{\s*(?:\/\/[^\n]*\n\s*)*return \{ breath:/);
  const rmBlock = rmAt >= 0 ? group(mark, mark.indexOf('{', rmAt)) : '';
  check('D LevelMark has a Reduce-Motion branch that builds no translateX (the bubble breathes on rmBreath)', rmAt >= 0 && /rmBreath/.test(rmBlock)
    && !/translateX/.test(rmBlock) && mark.indexOf('translateX', rmAt) > rmAt + rmBlock.length);
  check('D LevelMark: transform order exactly translateX, scaleX, scaleY', /transform:\s*\[\{ translateX \}, \{ scaleX \}, \{ scaleY \}\]/.test(mark));
  check('D LevelMark: the drift is multiply(clock channel, amp) and the stretch add(1, multiply(…))',
    /Animated\.multiply\(ch\(driftUnit, parts\.amp\), drive\)/.test(mark) && /Animated\.add\(1, Animated\.multiply\(ch\(speedUnit, parts\.stretch\), drive\)\)/.test(mark)
    && /Animated\.add\(1, Animated\.multiply\(ch\(speedUnit, -parts\.squash\), drive\)\)/.test(mark));
  check("D LevelMark: Platform read at render — `if (Platform.OS === 'web') return <LevelMarkWeb`", /if \(Platform\.OS === 'web'\) return <LevelMarkWeb \{\.\.\.props\} \/>/.test(mark));
  check('D LevelMark / LevelMarkWeb draw geometry from levelParts (splash radii from NATIVE_SPLASH_RADII_PX, see B)',
    /levelParts\(size, tone\)/.test(mark) && /levelParts\(size, tone\)/.test(web));
  check('D LevelMark: pixel snapping via PixelRatio.roundToNearestPixel', /PixelRatio\.roundToNearestPixel/.test(mark));
  check('D LevelMark: decorative (hidden from screen readers, no touches)', /accessibilityElementsHidden: true/.test(mark)
    && /importantForAccessibility: 'no-hide-descendants'/.test(mark) && /pointerEvents: 'none'/.test(mark));
  check('D LevelMark: a lost completion callback is backstopped (exitMs + 150, from when the exit really starts)',
    /const exitMs = exitMsFor\(exitKind, reduce\);/.test(mark) && /backstopRef\.current = setTimeout\(finish, ms\)/.test(mark)
    && (mark.match(/armBackstop\(exitMs \+ 150\)/g) ?? []).length === 3);
  check('D LevelMark: the stopAnimation settle re-arms its backstop at settle start (a stalled callback never cuts the settle)',
    /const startSettle = \(withAmp: boolean\) => \{\s*if \(settledRef\.current \|\| !prevDone\.current\) return;\s*armBackstop\(exitMs \+ 150\);/.test(mark)
    && /armBackstop\(exitMs \+ GATE_LOST_CALLBACK_MS\);\s*amp\.stopAnimation\(\(\) => startSettle\(true\)\)/.test(mark));
  check('D LevelMark: the clock comes from useLevelClock', /useLevelClock\(animate\)/.test(mark));
  const clock = code(read('components/loaders/levelClock.ts'));
  check('D levelClock.ts: no stopAnimation', !/stopAnimation/.test(clock));
  const setValues = (clock.match(/\.setValue\(/g) ?? []).length;
  check('D levelClock.ts: setValue only as the first-acquire reset, right before the loop starts', setValues === 1
    && /value\.setValue\(0\);\s*loop = Animated\.loop\(/.test(clock), `${setValues} setValue`);
  check('D levelClock.ts: exactly one Animated.loop, stopped only by the last release', (clock.match(/Animated\.loop\(/g) ?? []).length === 1
    && (clock.match(/\.stop\(\)/g) ?? []).length === 1);
  check('D levelClock.ts: web acquires nothing', /Platform\.OS !== 'web'/.test(clock));
  const boot = code(read('components/loaders/BootShell.tsx'));
  // LAUNCH completed BootShell with the splash's adopted wordmark (an
  // Animated.Text driven by the shared splash stage), so the rule pins that
  // path instead of "no wordmark": never a plain <Text>, only the stage.
  check('D BootShell: no useTheme, no timers, splash tone at splashRect; a wordmark only via the adopted splash stage', !/useTheme/.test(boot) && !/<Text\b/.test(boot)
    && /useSplashStage\(\)/.test(boot) && !/setTimeout|setInterval/.test(boot) && /tone="splash"/.test(boot) && /splashRect\(width, height, Platform\.OS\)/.test(boot)
    && /animate=\{!reduce\}/.test(boot) && /revealDelayMs=\{0\}/.test(boot) && /exit="none"/.test(boot));
  const arrive = code(read('components/loaders/Arrive.tsx'));
  check('D Arrive: null style unless armed; never a setState on completion', /finished\.current \? null : motion\.current/.test(arrive) && !/useState/.test(arrive));
  const readme = join(ROOT, 'components/loaders/css/README.txt');
  check('D components/loaders/css/README.txt exists', existsSync(readme));
}
{
  // hex: only the NATIVE_SPLASH_* lines of utils/levelTimeline.ts may carry one.
  const lt = code(read('utils/levelTimeline.ts')).split('\n');
  const bad = lt.filter((l) => HEX.test(l) && !/^export const NATIVE_SPLASH_[A-Z_]+ = '#[0-9A-F]{6}';$/.test(l.trim()));
  check('D utils/levelTimeline.ts: hex only on NATIVE_SPLASH_* lines', bad.length === 0, bad.join(' | '));
  for (const f of ['components/ConstructionLoader.tsx', 'components/CraneLoader.tsx']) {
    check(`D ${f}: no hex colour`, !HEX.test(code(read(f))));
  }
  const lt2 = code(read('utils/levelTimeline.ts'));
  check('D utils/levelTimeline.ts imports nothing from react-native (or designTokens)', !/from ['"]react-native['"]/.test(lt2) && !/designTokens/.test(lt2)
    && [...lt2.matchAll(/from ['"]([^'"]+)['"]/g)].every((m) => m[1] === './loadingGate'));
  const lg = code(read('utils/loadingGate.ts'));
  check('D utils/loadingGate.ts imports nothing', !/\bfrom ['"]/.test(lg));
}

// ── E. Entry points ─────────────────────────────────────────────────────────
{
  const craneRaw = read('components/CraneLoader.tsx');
  const crane = code(craneRaw);
  check('E CraneLoader.tsx imports no react-native-svg', !/react-native-svg/.test(crane));
  const at = crane.indexOf('export function CraneSvg(');
  const bodyOpen = at >= 0 ? crane.indexOf('{', crane.indexOf(')', crane.indexOf('}:', at))) : -1;
  const body = bodyOpen >= 0 ? group(crane, bodyOpen) : '';
  check("E the Platform.OS === 'web' test lives inside export function CraneSvg", /Platform\.OS === 'web'/.test(body), body.slice(0, 80));
  check('E CraneSvg web ≥ 120 → CraneMarkWeb, else the box + level', /Platform\.OS === 'web' && size >= 120\) return <CraneMarkWeb size=\{size\} \/>/.test(body)
    && /<LevelMark size=\{craneMarkWidth\(size\)\} animate=\{animate\} \/>/.test(body));
  check('E CraneSvg box is exactly size × size·300/340 (testID crane-svg)', /testID="crane-svg"/.test(body)
    && /width: size, height: \(size \* VB_H\) \/ VB_W/.test(body) && /const VB_W = 340;/.test(crane) && /const VB_H = 300;/.test(crane));
  check('E craneMarkWidth: size < 60 ? size : clamp(round(size·0.6), 36, 120)',
    /return size < 60 \? size : clamp\(Math\.round\(size \* 0\.6\), 36, 120\);/.test(crane));
  let depth = 0;
  let moduleScopeRead = false;
  for (let i = 0; i < crane.length; i++) {
    const ch = crane[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0 && crane.startsWith('Platform.OS', i)) moduleScopeRead = true;
  }
  check('E CraneLoader.tsx: no module-scope Platform.OS read', !moduleScopeRead);
  check("E the 'MAGE ID' heuristic is gone (LAUNCH P3): no label routing, no BootShell / ScreenLoader import, a plain default label",
    !/THIS IS A DOCUMENTED HEURISTIC/.test(craneRaw) && !/label === 'MAGE ID'/.test(crane)
    && !/import (BootShell|ScreenLoader)\b/.test(crane) && /label = 'Loading'/.test(crane));
  check('E CraneLoader keeps testID crane-loader; the label is a Type.headline status line', /testID="crane-loader"/.test(crane) && /Type\.headline/.test(crane)
    && !/serifLargeTitle/.test(crane));
  check('E CraneLoader facts eyebrow is textMuted (was accent)', /WHILE WE WORK/.test(crane) && /Type\.monoCaption, styles\.factEyebrow, \{ color: colors\.textMuted \}/.test(crane));

  const cl = code(read('components/ConstructionLoader.tsx'));
  check('E ConstructionLoader.tsx imports no react-native-svg, no Easing.back', !/react-native-svg/.test(cl) && !/Easing\.back/.test(cl));
  const intervals = [...cl.matchAll(/setInterval\(/g)].map((m) => group(cl, m.index! + 'setInterval'.length));
  check('E ConstructionLoader: the only setInterval updates the elapsed text (none sets a label index)', intervals.length <= 1
    && intervals.every((g) => /setNow\(Date\.now\(\)\)/.test(g) && !/idx|index/i.test(g)) && !/setLabelIdx|labelIdx/.test(cl));
  check('E ConstructionLoader maps sm/md/lg → 20/36/64', /MARK_W: Record<LoaderSize, number> = \{ sm: 20, md: 36, lg: 64 \};/.test(cl));
  check('E ConstructionLoader shows labels[0], never a later stage', /labels\.length > 0 \? labels\[0\] : label/.test(cl));
  check('E ConstructionLoader keeps testID construction-loader + progressbar', /testID="construction-loader"/.test(cl) && /accessibilityRole="progressbar"/.test(cl));
  check('E ConstructionLoader keeps every prop in its interface', ['size', 'scene', 'label', 'labels', 'labelIntervalMs', 'style', 'colorTop', 'colorMid', 'colorBase']
    .every((p) => new RegExp(`\\b${p}\\?:`).test(cl)));

  // ADVISORY — never fails, never counts.
  const overlay = read('components/EstimateLoadingOverlay.tsx');
  if (!/<CraneSvg size=\{288\} animate=\{visible\} \/>/.test(overlay)) {
    console.warn('WARN  E (advisory) components/EstimateLoadingOverlay.tsx no longer passes `animate={visible}` to CraneSvg (owned by the d6r X1 lane)');
  }
}

// ── F. Retired ───────────────────────────────────────────────────────────────
{
  const retired = ['components/loaders/ToppingOutMark.tsx', 'utils/loaderTimeline.ts', 'scripts/validate-loader.ts'];
  for (const r of retired) check(`F ${r} does not exist`, !existsSync(join(ROOT, r)));
  const offenders: string[] = [];
  const self = 'scripts/validate-level.ts';
  for (const dir of ['app', 'components', 'hooks', 'utils', 'scripts', '__tests__']) {
    for (const f of walk(dir, /\.(ts|tsx|js|jsx)$/)) {
      if (f === self) continue;
      const src = read(f);
      if (/from ['"][^'"]*(ToppingOutMark|loaderTimeline)['"]|validate-loader\.ts|require\(['"][^'"]*(ToppingOutMark|loaderTimeline)/.test(src)) offenders.push(f);
    }
  }
  check('F nothing imports the retired files', offenders.length === 0, offenders.join(', '));
}

// ── G. Splash constants (shape only) ─────────────────────────────────────────
{
  check('G NATIVE_SPLASH_PX equals the measured boxes', JSON.stringify(L.NATIVE_SPLASH_PX) === JSON.stringify({
    capL: { x0: 293, x1: 301, y0: 497, y1: 527 },
    capR: { x0: 723, x1: 731, y0: 497, y1: 527 },
    track: { x0: 301, x1: 723, y0: 508, y1: 516 },
    bubble: { x0: 479, x1: 546, y0: 499, y1: 525 },
  }));
  check('G NATIVE_SPLASH_RADII_PX = { track: 0, cap: 4, bubble: 13 }', JSON.stringify(L.NATIVE_SPLASH_RADII_PX) === JSON.stringify({ track: 0, cap: 4, bubble: 13 }));
  check('G splash colours', L.NATIVE_SPLASH_ACCENT === '#FF6A1A' && L.NATIVE_SPLASH_CAP === '#F4EFE6' && L.NATIVE_SPLASH_BG === '#0B0D10' && L.NATIVE_SPLASH_FG === '#F4EFE6');
  check('G splash alphas 64 / 64, amplitude 110, stretch .14, squash .10', L.NATIVE_SPLASH_TRACK_ALPHA === 64 && L.NATIVE_SPLASH_CAP_ALPHA === 64
    && L.NATIVE_SPLASH_AMP_PX === 110 && L.NATIVE_SPLASH_STRETCH === 0.14 && L.NATIVE_SPLASH_SQUASH === 0.1);
  const r = L.splashRect(393, 852, 'ios');
  check('G splashRect(393, 852, ios) → markLeft 112.45, markTop 420.2, markW 168.1', near(r.markLeft, 112.45, 0.01) && near(r.markTop, 420.2, 0.1)
    && near(r.markW, 168.1, 0.1), JSON.stringify(r));
  const w = L.splashRect(1512, 945, 'web');
  check('G splashRect on web caps markW at 240', near(w.markW, 240, 1e-9) && near(L.splashRect(393, 852, 'web').markW, 168.1, 0.1));
  const pr = L.splashPartRects(1);
  check('G splashPartRects are relative to the mark box', pr.capL.left === 0 && pr.capL.top === 0 && pr.capR.left === 430 && pr.track.left === 8
    && pr.track.top === 11 && pr.bubble.left === 186 && pr.bubble.width === 67 && pr.bubble.height === 26);
}

// ── H. ActivityIndicator ratchet ─────────────────────────────────────────────
// CROSS-RUN COUPLING: the parallel d6r run (X1/X2/X3) edits files this scan
// covers and may add spinners; the orchestrator re-measures and resets this
// baseline after the d6r merge. Measured on the untouched base 974162b3: 238.
// Re-measured on the integrated tree (The Level + main ac528d3b, d6r phases A+B
// merged, P1/P2/P3 applied): 231. It may only go down.
const ACTIVITY_INDICATOR_BASELINE = 231;
{
  let n = 0;
  for (const dir of ['app', 'components', 'hooks']) {
    for (const f of walk(dir, /\.(ts|tsx|js|jsx)$/)) n += (code(read(f)).match(/<ActivityIndicator\b/g) ?? []).length;
  }
  check(`H <ActivityIndicator count ${n} ≤ baseline ${ACTIVITY_INDICATOR_BASELINE}`, n <= ACTIVITY_INDICATOR_BASELINE);
  if (n < ACTIVITY_INDICATOR_BASELINE) console.info(`NOTE: <ActivityIndicator count fell to ${n}; lower ACTIVITY_INDICATOR_BASELINE`);
}

// ── I. Motion.loader ─────────────────────────────────────────────────────────
check('I Motion.loader exists and is LOADER', (Motion as unknown as { loader?: unknown }).loader === L.LOADER);
check('I designTokens imports LOADER from @/utils/levelTimeline', /import \{ LOADER \} from '@\/utils\/levelTimeline';/.test(read('constants/designTokens.ts')));

if (failures > 0) {
  console.error(`\nvalidate-level: ${failures} failed, ${passes} passed`);
  process.exit(1);
}
console.info(`validate-level: all ${passes} checks passed`);
