// validate-level-web.ts — the web level + the web crane (lane WEB).
//
//   bun run scripts/validate-level-web.ts        (package.json: test:level-web)
//
// On react-native-web, Animated runs in JS on requestAnimationFrame, so every
// Animated loader freezes exactly while the page is busy. The web level
// (components/loaders/LevelMarkWeb.tsx) and the web crane
// (components/loaders/CraneMarkWeb.tsx) therefore move through CSS keyframes
// the browser composites (components/loaders/css/levelCss.ts, craneCss.ts).
// RN-web's CSS passthrough fails SILENTLY on every mistake this file guards:
// an inline keyframe is dropped, a bare-number duration becomes px, fill
// 'both' re-roots fixed-position UI, a keyframe on a layout property runs on
// the main thread, an identical restart keyframe never restarts.
//
// The css modules are imported for real with a stub 'react-native' whose
// StyleSheet.create records what it registers, so the sampled crane stops,
// the seam and the level periods are recomputed here, not pattern-matched.
// Source rules run on comment-stripped text (the legacy marker on raw text).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── A stub react-native: StyleSheet.create records every registered object ──
const registered = new WeakSet<object>();
let createCalls = 0;
// Bun's runtime plugin API, typed locally (the repo's tsconfig has no bun types).
type BunBuild = { module(spec: string, load: () => { exports: Record<string, unknown>; loader: 'object' }): void };
const bun = (globalThis as unknown as { Bun?: { plugin(p: { name: string; setup(build: BunBuild): void }): void } }).Bun;
if (!bun) {
  console.error('validate-level-web: run with bun (bun run scripts/validate-level-web.ts)');
  process.exit(1);
}
bun.plugin({
  name: 'validate-level-web-rn-stub',
  setup(build) {
    build.module('react-native', () => ({
      exports: {
        StyleSheet: {
          create: (o: Record<string, object>) => {
            createCalls += 1;
            for (const v of Object.values(o)) if (v && typeof v === 'object') registered.add(v);
            return o;
          },
          absoluteFill: {},
        },
        Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default },
        PixelRatio: { roundToNearestPixel: (x: number) => x },
      },
      loader: 'object',
    }));
  },
});

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; return; }
  failures++;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const read = (rel: string) => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
/** Source with // and /* *\/ comments blanked, so prose cannot trip a rule. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}

const LEVEL_WEB = 'components/loaders/LevelMarkWeb.tsx';
const CRANE_WEB = 'components/loaders/CraneMarkWeb.tsx';
const LEVEL_CSS = 'components/loaders/css/levelCss.ts';
const CRANE_CSS = 'components/loaders/css/craneCss.ts';
const MINE = [LEVEL_WEB, CRANE_WEB, LEVEL_CSS, CRANE_CSS];

for (const f of MINE) check(`${f} exists`, existsSync(join(ROOT, f)));
const src = Object.fromEntries(MINE.map((f) => [f, code(read(f))])) as Record<string, string>;
const levelSrc = src[LEVEL_WEB];
const craneSrc = src[CRANE_WEB];

const L = await import('../components/loaders/css/levelCss');
const C = await import('../components/loaders/css/craneCss');
const TL = await import('../utils/levelTimeline');

// ── 1. keyframes: only in the css modules, only through StyleSheet.create ────
for (const f of [LEVEL_WEB, CRANE_WEB]) {
  check(`1 ${f}: no animationKeyframes (keyframes live in components/loaders/css/)`, !/animationKeyframes/.test(src[f]));
  check(`1 ${f}: imports no unregistered *Raw builder from the css modules`, !/\b\w+Raw\b/.test(src[f]));
}
for (const f of [LEVEL_CSS, CRANE_CSS]) {
  check(`1 ${f}: registers through StyleSheet.create`, /StyleSheet\.create\(/.test(src[f]));
}

type Style = Record<string, unknown>;
/** Every public, REGISTERED style the components can reach, with a label. */
const beforeCalls = createCalls;
const lg = TL.levelGeometry(120);
const pub: [string, Style][] = [
  ['levelDriftStyle(28)', L.levelDriftStyle(28) as Style],
  ['levelDriftStyle(28, twin)', L.levelDriftStyle(28, 'twin') as Style],
  ['levelDriftStyle(5)', L.levelDriftStyle(5) as Style],
  ['levelStretchStyle', L.levelStretchStyle(lg.stretch, lg.squash) as Style],
  ['levelStretchStyle twin', L.levelStretchStyle(lg.stretch, lg.squash, 'twin') as Style],
  ['levelBeatStyle', L.levelBeatStyle() as Style],
  ['levelBeatStyle twin', L.levelBeatStyle('twin') as Style],
  ['levelRevealStyle(150)', L.levelRevealStyle(150) as Style],
  ['LEVEL_CSS.breath', L.LEVEL_CSS.breath as Style],
];
for (const size of [120, 288]) {
  const s = C.craneStyles(size) as Record<string, Style>;
  for (const [k, v] of Object.entries(s)) pub.push([`craneStyles(${size}).${k}`, v]);
}
for (const [name, s] of pub) {
  check(`1 ${name} went through StyleSheet.create`, registered.has(s));
  check(`1 ${name} carries keyframes`, Array.isArray(s.animationKeyframes) && (s.animationKeyframes as unknown[]).length === 1);
}
// memoised: a second call registers nothing new; the drift keys on amp rounded to 0.5 px
const callsNow = createCalls;
L.levelDriftStyle(28.1);
L.levelStretchStyle(lg.stretch, lg.squash);
C.craneStyles(288);
check('1 memoised: repeat calls (28.1 → 28) register no new class', createCalls === callsNow && L.levelDriftStyle(28.1) === L.levelDriftStyle(28));
check('1 each distinct style registers once', callsNow - beforeCalls >= 9);

// ── 2–4. durations are strings in ms; fill 'backwards'; keyframes transform/opacity only
const TIME_KEYS = ['animationDuration', 'animationDelay', 'transitionDuration', 'transitionDelay'];
for (const [name, s] of pub) {
  for (const k of TIME_KEYS) {
    if (!(k in s)) continue;
    check(`2 ${name}.${k} is a string ending in ms`, typeof s[k] === 'string' && /^-?\d+(\.\d+)?ms$/.test(s[k] as string), String(s[k]));
  }
  check(`2 ${name} has a string animationDuration`, typeof s.animationDuration === 'string');
  check(`3 ${name}.animationFillMode is 'backwards'`, s.animationFillMode === 'backwards', String(s.animationFillMode));
  const frames = (s.animationKeyframes as Record<string, Style>[])[0] ?? {};
  const keys = new Set<string>();
  for (const stop of Object.values(frames)) for (const k of Object.keys(stop)) keys.add(k);
  check(`4 ${name}: keyframes animate transform / opacity only`, [...keys].every((k) => k === 'transform' || k === 'opacity') && keys.size > 0, [...keys].join(','));
  const strTransforms = Object.values(frames).every((stop) => !('transform' in stop) || typeof stop.transform === 'string');
  check(`4 ${name}: keyframe transforms are strings`, strTransforms);
}
for (const f of MINE) {
  check(`2 ${f}: no bare-number duration / delay`, !/\b(?:animationDuration|animationDelay|transitionDuration|transitionDelay)\s*:\s*-?[\d.]/.test(src[f]));
  const fills = [...src[f].matchAll(/animationFillMode\s*:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  check(`3 ${f}: animationFillMode only 'backwards'`, fills.every((v) => v === "'backwards'"), fills.join(' | '));
  check(`3 ${f}: never fill mode 'both'`, !/['"]both['"]/.test(src[f]));
  check(`${f}: no hex colour (theme tokens only)`, !/#[0-9a-fA-F]{3,8}\b/.test(src[f]));
}

// ── 5–7. file rules ─────────────────────────────────────────────────────────
check('5 CraneMarkWeb.tsx no longer carries the LEGACY-SVG-CRANE marker (validate-level rule D applies in full)', !/LEGACY-SVG-CRANE/.test(read(CRANE_WEB)));
for (const [f, s] of [[LEVEL_WEB, levelSrc], [CRANE_WEB, craneSrc]] as const) {
  check(`6 ${f}: never destructures useTheme()`, !/const\s*\{[^}]*\}\s*=\s*useTheme\(\)/.test(s) && /const theme = useTheme\(\)/.test(s));
  check(`6 ${f}: falls back to splashFallbackColors()`, /theme\?\.colors \?\? splashFallbackColors\(\)/.test(s));
  check(`7 ${f}: imports nothing from react-native-svg`, !/react-native-svg/.test(s));
}
check('7 CraneMarkWeb imports no Animated', !/\bAnimated\b/.test(craneSrc));
check('7 CraneMarkWeb: no requestAnimationFrame / setInterval / setTimeout', !/requestAnimationFrame|setInterval|setTimeout/.test(craneSrc));
check('7 LevelMarkWeb: no requestAnimationFrame / setInterval', !/requestAnimationFrame|setInterval/.test(levelSrc));
check('7 LevelMarkWeb: no Animated loop / timing (JS motion)', !/Animated\.(loop|timing|spring|sequence)/.test(levelSrc));

// ── 8. LevelMarkWeb: Reduce Motion, settle, twin ─────────────────────────────
check("8 LevelMarkWeb reads Reduce Motion through components/ui/motion", /import \{[^}]*\buseReducedMotion\b[^}]*\} from '@\/components\/ui\/motion'/.test(levelSrc)
  && /useReducedMotion\(\)/.test(levelSrc) && !/AccessibilityInfo|matchMedia/.test(levelSrc));
check('8 LevelMarkWeb geometry from levelParts(size, tone) and levelPalette', /levelParts\(size, tone\)/.test(levelSrc) && /levelPalette\(tone, color, colors\)/.test(levelSrc));
check('8 settle: reads the live matrices with getComputedStyle', /getComputedStyle/.test(levelSrc) && /\.transform\b/.test(levelSrc));
check("8 settle: glides the drift to translateX(0px) and the bubble to scale(1, 1)", L.LEVEL_SETTLE.centre === 'translateX(0px)' && L.LEVEL_SETTLE.round === 'scale(1, 1)'
  && /freezeAndGlide\(dom\(driftRef\.current\), LEVEL_SETTLE\.centre\)/.test(levelSrc) && /freezeAndGlide\(dom\(bubbleRef\.current\), LEVEL_SETTLE\.round\)/.test(levelSrc));
{
  const fg = levelSrc.slice(levelSrc.indexOf('function freezeAndGlide'), levelSrc.indexOf('function freezeAndFade'));
  const order = ['liveTransform(', "animation = 'none'", 'style.transform = live', 'reflow(', 'LEVEL_SETTLE.glide', 'style.transform = target'].map((s) => fg.indexOf(s));
  check('8 settle order: read live → animation none → pin the matrix → reflow → transition → target', order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), order.join(','));
}
check('8 settle runs in a layout effect (before paint / re-render)', /useLayoutEffect\(\(\) => \{\s*const was = prevDone\.current;/.test(levelSrc));
check('8 settle numbers: glide 280 ms ease-out cubic; lvl 100 ms at 160; vis 140 ms at 200; fade 120; RM 160',
  L.LEVEL_SETTLE.glide === 'transform 280ms cubic-bezier(0.33, 1, 0.68, 1)' && L.LEVEL_SETTLE.lvl === 'opacity 100ms linear 160ms'
  && L.LEVEL_SETTLE.vis === 'opacity 140ms cubic-bezier(0.4, 0, 1, 1) 200ms' && L.LEVEL_SETTLE.fade === 'opacity 120ms cubic-bezier(0.4, 0, 1, 1)'
  && L.LEVEL_SETTLE.rm === 'opacity 160ms cubic-bezier(0.4, 0, 1, 1)');
check('8 onSettled: container opacity transitionend + backstop exit + 150, called at most once',
  /propertyName === 'opacity'/.test(levelSrc) && /e\.target === container/.test(levelSrc)
  && /setTimeout\(finish, levelExitMs\([^)]*\) \+ LEVEL_BACKSTOP_MS\)/.test(levelSrc) && L.LEVEL_BACKSTOP_MS === 150
  && /if \(settledRef\.current\) return;\s*settledRef\.current = true;/.test(levelSrc)
  && L.levelExitMs('settle', false) === 340 && L.levelExitMs('fade', false) === 120 && L.levelExitMs('settle', true) === 160);
check('8 a restart re-arms the drift with the byte-different TWIN', /levelDriftStyle\(parts\.amp, twin\)/.test(levelSrc) && /restarts\.current % 2 === 1 \? 'twin' : 'main'/.test(levelSrc));
{
  const main = L.levelDriftRaw(28) as Style;
  const tw = L.levelDriftRaw(28, 'twin') as Style;
  const mf = (main.animationKeyframes as Style[])[0];
  const tf = (tw.animationKeyframes as Style[])[0];
  check('8 twin keyframes are byte-different (a different RN-web animation-name)', JSON.stringify(mf) !== JSON.stringify(tf));
  check('8 twin keyframes are the same motion', JSON.stringify(Object.values(mf)) === JSON.stringify(Object.values(tf)));
  const st = (L.levelStretchRaw(0.14, 0.1) as Style).animationKeyframes as Style[];
  const stt = (L.levelStretchRaw(0.14, 0.1, 'twin') as Style).animationKeyframes as Style[];
  check('8 stretch twin byte-different, same motion', JSON.stringify(st[0]) !== JSON.stringify(stt[0]) && JSON.stringify(Object.values(st[0])) === JSON.stringify(Object.values(stt[0])));
  const bt = (L.levelBeatRaw() as Style).animationKeyframes as Style[];
  const btt = (L.levelBeatRaw('twin') as Style).animationKeyframes as Style[];
  check('8 beat twin byte-different, same motion', JSON.stringify(bt[0]) !== JSON.stringify(btt[0]) && JSON.stringify(Object.values(bt[0])) === JSON.stringify(Object.values(btt[0])));
}
check('8 Reduce Motion: no drift / stretch / beat classes, the breath instead', /const moving = animate && !reduce;/.test(levelSrc)
  && /const drifting = moving && /.test(levelSrc) && /reduce \? LEVEL_CSS\.breath/.test(levelSrc));
check('8 animate={false}: a static branch with no classes', /if \(!animate\) \{\s*return \(/.test(levelSrc));
check('8 revealDelayMs 0 → no reveal animation', /const reveal = revealDelayMs > 0 \? levelRevealStyle\(revealDelayMs\) : null;/.test(levelSrc));
check('8 host values subscribe with addListener and clean up', ['hostAmp', 'retract', 'hueMix'].every((v) => new RegExp(`${v}\\.addListener\\(`).test(levelSrc) && new RegExp(`${v}\\.removeListener\\(id\\)`).test(levelSrc)));
check('8 retract reads CORE retractRanges (track, bubble scale + opacity)', /retractRanges\.trackScaleX/.test(levelSrc) && /retractRanges\.bubbleScale/.test(levelSrc) && /retractRanges\.bubbleOpacity/.test(levelSrc));

// ── 9. the crane's ONE timeline ──────────────────────────────────────────────
const T = C.CRANE_TIMELINE;
check('9 the timeline table carries every event: 1400 2400 2500 2700 2800 3600 4900 5200 6000',
  T.outEnd === 1400 && T.lowerEnd === 2400 && T.set === 2500 && T.riseStart === 2700 && T.colsEnd === 2800 && T.riseEnd === 3600
  && T.backEnd === 4900 && T.pickEnd === 5200 && T.cycle === 6000 && C.CRANE_CYCLE_MS === 6000);
check('9 the beam → slab hand-over is ONE 1 % step', near(T.setEnd - T.set, C.CRANE_CYCLE_MS / 100));
check('9 CraneMarkWeb holds no timeline number of its own', !/\b(1400|2400|2500|2700|2800|3600|4900|5200|6000)\b/.test(craneSrc));
const stops = C.craneStopTimes();
check('9 stops strictly increase from 0 to 6000', stops[0] === 0 && stops[stops.length - 1] === 6000 && stops.every((t, i) => i === 0 || t > stops[i - 1]));
for (let p = 0; p <= 100; p += 2) check(`9 a stop every 2 % (${p} %)`, stops.includes((6000 * p) / 100));
for (const [k, v] of Object.entries(T)) check(`9 an exact stop at ${k} (${v} ms)`, stops.includes(v));
const chans = ['trolley', 'pendulum', 'drop', 'beam', 'slab', 'cols', 'tower'] as const;
for (const n of chans) {
  const s = C.craneSamples(n);
  check(`9 ${n}: seam — stop 0 === stop 100`, s[0][1] === s[s.length - 1][1], `${s[0][1]} vs ${s[s.length - 1][1]}`);
}
// Continuous channels arrive at their start value: nothing jumps at the wrap.
for (const n of ['trolley', 'pendulum', 'drop', 'beam'] as const) {
  check(`9 ${n}: the value just before 6000 equals the value at 0`, near(C.craneChannel[n](5999.999), C.craneChannel[n](0), 1e-4));
}
// The tower seam is VISUAL: sunk one floor with the new floor shown == not sunk, hidden.
check('9 tower: 0 at the start, exactly one floor at the 99.99 % stop', C.craneChannel.tower(0) === 0 && near(C.craneChannel.tower(C.CRANE_WRAP_MS), 1, 1e-5));
check('9 new slab + columns hidden at 0, shown at 99.99 %', C.craneChannel.slab(0) === 0 && C.craneChannel.cols(0) === 0
  && C.craneChannel.slab(C.CRANE_WRAP_MS) === 1 && C.craneChannel.cols(C.CRANE_WRAP_MS) === 1);
check('9 at the set: trolley out, hook down, pendulum still', C.craneChannel.trolley(T.set) === 1 && C.craneChannel.drop(T.set) === 1 && C.craneChannel.pendulum(T.set) === 0);
{
  let ok = true;
  for (let t = T.set; t <= T.setEnd; t += 5) if (!near(C.craneChannel.beam(t) + C.craneChannel.slab(t), 1, 1e-9)) ok = false;
  check('9 beam and new slab hand over on the SAME stops (beam + slab = 1 through the step)', ok);
}
check('9 the beam is on the hook through the swing and the lower, back on by 5200', [0, 700, 1400, 2000, 2400].every((t) => C.craneChannel.beam(t) === 1)
  && C.craneChannel.beam(3000) === 0 && C.craneChannel.beam(T.pickEnd) === 1);
check('9 the hook only lowers once the trolley is out, and rises before it returns', C.craneChannel.drop(T.outEnd) === 0 && C.craneChannel.trolley(T.outEnd) === 1
  && C.craneChannel.drop(T.riseEnd) === 0 && C.craneChannel.trolley(T.riseEnd) === 1);
{
  const peak = Math.max(...Array.from({ length: 601 }, (_, i) => Math.abs(C.craneChannel.pendulum(i * 10))));
  check('9 the pendulum never swings past 2.5°', peak <= 2.5 + 1e-9 && peak >= 2.4, String(peak));
  check('9 outbound: the load lags (hook LEFT = +CSS rotate) then overshoots right at the stop',
    C.craneChannel.pendulum(350) > 0 && C.craneChannel.pendulum(T.outEnd) < 0 && C.craneChannel.pendulum(T.outSwingSettled) === 0);
  check('9 return: lags right then overshoots left at the stop', C.craneChannel.pendulum(3925) < 0 && C.craneChannel.pendulum(T.backEnd) > 0);
}
for (const size of [120, 180, 288, 340, 400]) {
  const g = C.craneGeometry(size);
  check(`9 geometry ${size}: box is size × size·300/340`, g.W === size && near(g.H, (size * 300) / 340));
  check(`9 geometry ${size}: the set beam and the new slab are the SAME pixels`, g.beamLeft + g.trolleyDx === g.newSlabLeft && g.beamTop + g.hookDy === g.newSlabTop
    && [g.trolleyDx, g.hookDy, g.floorPx, g.beamLeft, g.beamTop].every(Number.isInteger));
  check(`9 geometry ${size}: the cable ends at the hook at rest and fully lowered`, near(C.craneCableScale(g, 0) * g.cableFull, g.cableRest, 0.01) && C.craneCableScale(g, 1) === 1);
  // Recompute the registered keyframes from the channels.
  const frames = C.craneFrames(g, 'trolley');
  check(`9 geometry ${size}: trolley frames = the sampled channel`, Object.keys(frames).length === stops.length
    && stops.every((t) => (frames[C.cranePct(t)] as { transform: string }).transform === C.craneValue(g, 'trolley', C.craneChannel.trolley(t === 6000 ? 0 : t))));
  const tower = C.craneFrames(g, 'tower');
  check(`9 geometry ${size}: tower sinks exactly one floor (${g.floorPx}px) before the seam`, (tower['99.99%'] as { transform: string }).transform === `translateY(${g.floorPx}px)`
    && (tower['0%'] as { transform: string }).transform === 'translateY(0px)' && (tower['100%'] as { transform: string }).transform === 'translateY(0px)');
  for (const l of C.CRANE_LAYERS) {
    const f = C.craneFrames(g, l);
    check(`9 geometry ${size}: ${l} frames 0 % === 100 %`, JSON.stringify(f['0%']) === JSON.stringify(f['100%']));
  }
}
for (const [name, s] of pub.filter(([n]) => n.startsWith('crane'))) {
  check(`9 ${name}: 6000ms, linear, infinite, delay 0ms`, s.animationDuration === '6000ms' && s.animationTimingFunction === 'linear'
    && s.animationIterationCount === 'infinite' && s.animationDelay === '0ms');
}

// ── 10. the level's periods derive from the timeline ─────────────────────────
{
  const d = L.levelDriftRaw(28) as Style;
  const st = L.levelStretchRaw(0.14, 0.1) as Style;
  const b = L.levelBeatRaw() as Style;
  const br = L.LEVEL_CSS.breath as Style;
  const rv = L.levelRevealRaw(150) as Style;
  check('10 drift: 700ms (= LEVEL_PERIOD_MS / 2), sine per sweep, alternate, infinite, delay −350ms (= −P/4)',
    d.animationDuration === `${TL.LEVEL_PERIOD_MS / 2}ms` && d.animationDuration === '700ms' && d.animationTimingFunction === 'cubic-bezier(0.37, 0, 0.63, 1)'
    && d.animationDirection === 'alternate' && d.animationIterationCount === 'infinite' && d.animationDelay === `-${TL.LEVEL_PERIOD_MS / 4}ms`);
  const df = (d.animationKeyframes as Record<string, { transform: string }>[])[0];
  check('10 drift: translateX(−A) → translateX(A)', df['0%'].transform === 'translateX(-28px)' && df['100%'].transform === 'translateX(28px)');
  check('10 stretch: in phase with the drift (700ms, linear, delay 0ms)', st.animationDuration === '700ms' && st.animationTimingFunction === 'linear' && st.animationDelay === '0ms');
  const sf = (st.animationKeyframes as Record<string, { transform: string }>[])[0];
  check('10 stretch: 9 stops; max at 0 % and 100 % (centre crossings), round at 50 % (turnaround)', Object.keys(sf).length === 9
    && sf['0%'].transform === 'scale(1.14, 0.9)' && sf['100%'].transform === 'scale(1.14, 0.9)' && sf['50%'].transform === 'scale(1, 1)');
  check('10 stretch 25 %: the cos(π/4) level', sf['25%'].transform === `scale(${Math.round((1 + 0.14 * Math.SQRT1_2) * 1e4) / 1e4}, ${Math.round((1 - 0.1 * Math.SQRT1_2) * 1e4) / 1e4})`);
  const bf = (b.animationKeyframes as Record<string, { opacity: number }>[])[0];
  check('10 beat: 0.8 at each centre crossing, 0 between (beatRange folded onto a sweep)', b.animationDuration === '700ms' && bf['0%'].opacity === 0.8
    && bf['100%'].opacity === 0.8 && bf['14%'].opacity === 0 && bf['86%'].opacity === 0 && TL.beatRange.inputRange[1] === 0.07);
  check('10 Reduce Motion breath: 1120ms (= LEVEL_RM_PERIOD_MS / 2), ease-in-out, alternate, opacity 1 → 0.5', br.animationDuration === `${TL.LEVEL_RM_PERIOD_MS / 2}ms`
    && br.animationTimingFunction === 'ease-in-out' && br.animationDirection === 'alternate'
    && JSON.stringify((br.animationKeyframes as unknown[])[0]) === JSON.stringify({ from: { opacity: 1 }, to: { opacity: 0.5 } }));
  check('10 reveal: 170ms (LOADER.enter.visFadeMs), delay = the prop, 0 → 1', rv.animationDuration === `${TL.LOADER.enter.visFadeMs}ms` && rv.animationDelay === '150ms'
    && JSON.stringify((rv.animationKeyframes as unknown[])[0]) === JSON.stringify({ from: { opacity: 0 }, to: { opacity: 1 } }));
  check('10 levelCss derives its periods in source', /LEVEL_PERIOD_MS \/ 2/.test(src[LEVEL_CSS]) && /LEVEL_RM_PERIOD_MS \/ 2/.test(src[LEVEL_CSS]) && /-LEVEL_PERIOD_MS \/ 4/.test(src[LEVEL_CSS]));
}

// ── 11. CORE's gate (read-only cross-check) ─────────────────────────────────
{
  const crane = code(read('components/CraneLoader.tsx'));
  check('11 components/CraneLoader.tsx renders CraneMarkWeb only on web at size ≥ 120',
    /if \(Platform\.OS === 'web' && size >= 120\) return <CraneMarkWeb size=\{size\} \/>;/.test(crane) && (crane.match(/<CraneMarkWeb\b/g) ?? []).length === 1);
  const mark = code(read('components/loaders/LevelMark.tsx'));
  check("11 components/loaders/LevelMark.tsx delegates the web to LevelMarkWeb", /if \(Platform\.OS === 'web'\) return <LevelMarkWeb \{\.\.\.props\} \/>/.test(mark));
}

if (failures > 0) {
  console.error(`\n✗ validate-level-web: ${failures} failing, ${passes} passing`);
  process.exit(1);
}
console.info(`✓ validate-level-web: ${passes} checks — the web level and crane move on the compositor, one 6 s crane cycle, seamless`);
