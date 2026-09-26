/**
 * validate-loader.ts — the native loading mark (ToppingOutMark) and the
 * web-only crane.
 *
 * Run: bun run scripts/validate-loader.ts
 *
 * WHY. On iOS/Android the SVG crane ran on the JS driver and its load came off
 * the hook (react-native-svg's native setNativeProps drops originX/originY).
 * The replacement is plain Views on ONE native loop. That only stays true
 * while the loop shape, the interpolations and the platform gate stay exactly
 * as built; each rule below fails the build the moment one drifts:
 *
 *  1. ToppingOutMark.tsx: no react-native-svg, no createAnimatedComponent, no
 *     `useNativeDriver: false`, no Animated.sequence/parallel/stagger/delay/
 *     spring, no `easing:` inside `.interpolate({`; every useNativeDriver is
 *     the `nativeDriver` identifier; exactly one Animated.loop wrapping one
 *     Animated.timing (the only loop RN runs natively with iterations).
 *  2. The animated style keys are opacity and translateY only.
 *  3. The timeline maths (utils/loaderTimeline.ts): strictly increasing input
 *     ranges inside [0, 1]; each floor's opacity and translate equal at t=0 and
 *     t=1 (a seamless wrap); hidden at t=0; the whole tower in place for ≥ 600
 *     ms; the landing monotonic with ≤ 0.5 % overshoot, on Motion.spring.rise
 *     with ζ in [0.75, 1.05]; FLOOR_START strictly increasing; CYCLE_MS in
 *     [2800, 3600].
 *  4. Reduce Motion: useReducedMotion from '@/components/ui/motion' and a
 *     branch with no translateY.
 *  5. CraneLoader.tsx: the Platform.OS === 'web' gate lives inside
 *     `export function CraneSvg` (read at render, never module scope), and the
 *     web crane's body is pinned by sha256 so it cannot drift.
 *  6. EstimateLoadingOverlay passes `animate={visible}`.
 *  7. No hex colour in ToppingOutMark.tsx (theme tokens only).
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Range } from '../utils/loaderTimeline';

// constants/designTokens.ts imports react-native (Platform), which bun cannot
// parse. utils/loaderTimeline.ts reads Motion from it, so stub react-native
// with the one export designTokens touches, then import dynamically.
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('validate-loader must run under bun (needs Bun.plugin to stub react-native)');
  process.exit(1);
}
Bun.plugin({
  name: 'validate-loader-stubs',
  setup(build) {
    build.module('react-native', () => ({
      loader: 'object',
      exports: { Platform: { OS: 'ios', select: (o: Record<string, unknown>) => ('ios' in o ? o.ios : o.default) } },
    }));
  },
});
const { Motion } = await import('../constants/designTokens');
const {
  CYCLE_MS, EXIT_START, FLOORS, FLOOR_START, LAND_FRAC, PULSE_MS,
  dampingRatio, evalRange, floorRanges, pulseRange, sampleSpring, springPeak,
} = await import('../utils/loaderTimeline');

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** The web crane's function body at the time the native mark was built. */
const CRANE_WEB_SHA256 = '0deeaf60ab77159c2c5878fe3fbb913722831cbfe54453c8fe5097b50b9fcfe0';

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; return; }
  failures++;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

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

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

// ── 1 + 2 + 4 + 7: ToppingOutMark.tsx ──────────────────────────────────────
const MARK_PATH = 'components/loaders/ToppingOutMark.tsx';
const markSrc = read(MARK_PATH);
const mark = code(markSrc);

check('1 no react-native-svg', !/react-native-svg/.test(mark));
check('1 no createAnimatedComponent', !/createAnimatedComponent/.test(mark));
check('1 no useNativeDriver: false', !/useNativeDriver\s*:\s*false/.test(mark));
for (const k of ['sequence', 'parallel', 'stagger', 'delay', 'spring']) {
  check(`1 no Animated.${k}`, !new RegExp(`Animated\\.${k}\\b`).test(mark));
}
{
  let idx = mark.indexOf('.interpolate(');
  let n = 0;
  let easingInside = false;
  while (idx >= 0) {
    n++;
    const g = group(mark, idx + '.interpolate'.length);
    if (/\beasing\s*:/.test(g)) easingInside = true;
    idx = mark.indexOf('.interpolate(', idx + 1);
  }
  check('1 interpolations exist', n >= 2, `found ${n}`);
  check('1 no easing: inside .interpolate({', !easingInside);
}
{
  const uses = mark.match(/useNativeDriver\s*:\s*[^,}\n]+/g) ?? [];
  check('1 useNativeDriver present', uses.length >= 1);
  check('1 every useNativeDriver is nativeDriver', uses.every((u) => /useNativeDriver\s*:\s*nativeDriver\s*$/.test(u.trim())), uses.join(' | '));
  check('1 nativeDriver comes from components/ui/motion',
    /import\s*\{[^}]*\bnativeDriver\b[^}]*\}\s*from\s*'@\/components\/ui\/motion'/.test(mark));
}
{
  const loops = count(mark, /Animated\.loop\(/g);
  const timings = count(mark, /Animated\.timing\(/g);
  check('1 exactly one Animated.loop', loops === 1, `found ${loops}`);
  check('1 exactly one Animated.timing', timings === 1, `found ${timings}`);
  const at = mark.indexOf('Animated.loop(');
  const inner = at >= 0 ? group(mark, at + 'Animated.loop'.length).slice(1).trim() : '';
  check('1 the loop wraps the timing directly', /^Animated\.timing\(/.test(inner), inner.slice(0, 40));
  check('1 the timing is linear', /easing\s*:\s*Easing\.linear\b/.test(inner));
  check('1 the loop is started and stopped', /\.start\(\)/.test(mark) && /\.stop\(\)/.test(mark));
}
{
  // 2: every animated value lands on opacity or translateY only.
  const keys = new Set<string>();
  for (const m of mark.matchAll(/(\w+)\s*:\s*(?:anim\[i\]\.\w+|pulse\b|t\.interpolate)/g)) keys.add(m[1]);
  const bad = [...keys].filter((k) => k !== 'opacity' && k !== 'translateY');
  check('2 animated style keys are opacity / translateY only', bad.length === 0 && keys.has('opacity') && keys.has('translateY'), [...keys].join(','));
  check('2 no scale / rotate / width animation', !/\b(scale|scaleX|scaleY|rotate|rotation)\s*:/.test(mark));
}
// 4: Reduce Motion.
check('4 imports useReducedMotion from @/components/ui/motion',
  /import\s*\{[^}]*\buseReducedMotion\b[^}]*\}\s*from\s*'@\/components\/ui\/motion'/.test(mark));
{
  const m = mark.match(/!animate\s*\|\|\s*reduce\s*\?\s*(\{[^}]*\})/);
  check('4 a static branch for !animate / reduce with no translateY', !!m && !/translateY/.test(m[1]), m?.[1] ?? 'missing');
  check('4 the reduce duration is PULSE_MS', /reduce\s*\?\s*PULSE_MS\s*:\s*CYCLE_MS/.test(mark));
  check('4 the pulse sits on the wrapper under reduce', /animate\s*&&\s*reduce\s*\?\s*\{\s*opacity:\s*pulse\s*\}/.test(mark));
}
// 7: no hex.
check('7 no hex colour in ToppingOutMark', !/#[0-9a-fA-F]{3,8}\b/.test(mark));
check('7 colours come from useTheme', /useTheme\(\)/.test(mark) && /colors\.accent/.test(mark));
check('7 no shadow / glow', !/shadow|elevation|glow/i.test(mark));
check('accessibility: decorative (hidden from readers)',
  /importantForAccessibility="no-hide-descendants"/.test(mark) && /accessibilityElementsHidden/.test(mark));
check('footprint: the crane box (size × size·300/340)', /height:\s*\(size \* 300\) \/ 340/.test(mark));

// ── 3: the timeline maths ─────────────────────────────────────────────────
const strictlyUp = (xs: number[]) => xs.every((x, k) => x >= 0 && x <= 1 && (k === 0 || x > xs[k - 1]));
const sameLen = (r: Range) => r.inputRange.length === r.outputRange.length;
const MS = (f: number) => f * CYCLE_MS;

check('3 CYCLE_MS in [2800, 3600]', CYCLE_MS >= 2800 && CYCLE_MS <= 3600, String(CYCLE_MS));
check('3 PULSE_MS positive', PULSE_MS > 0);
check('3 pulse range strictly increasing, seamless', strictlyUp(pulseRange.inputRange)
  && pulseRange.inputRange[0] === 0 && pulseRange.inputRange[pulseRange.inputRange.length - 1] === 1
  && pulseRange.outputRange[0] === pulseRange.outputRange[pulseRange.outputRange.length - 1]
  && pulseRange.outputRange.every((v) => v > 0 && v <= 1));
{
  const starts = Array.from({ length: FLOORS }, (_, i) => FLOOR_START(i));
  check('3 FLOOR_START strictly increasing', starts.every((s, k) => k === 0 || s > starts[k - 1]), starts.join(','));
  check('3 FLOORS is 5', FLOORS === 5);
}
for (let i = 0; i < FLOORS; i++) {
  const { opacity, translateY } = floorRanges(i);
  check(`3 floor ${i} opacity range well-formed`, sameLen(opacity) && strictlyUp(opacity.inputRange), opacity.inputRange.join(','));
  check(`3 floor ${i} translate range well-formed`, sameLen(translateY) && strictlyUp(translateY.inputRange), translateY.inputRange.join(','));
  check(`3 floor ${i} ranges span [0, 1]`,
    opacity.inputRange[0] === 0 && opacity.inputRange[opacity.inputRange.length - 1] === 1
    && translateY.inputRange[0] === 0 && translateY.inputRange[translateY.inputRange.length - 1] === 1);
  check(`3 floor ${i} seam: opacity equal at t=0 and t=1`, evalRange(opacity, 0) === evalRange(opacity, 1));
  check(`3 floor ${i} seam: translate equal at t=0 and t=1`, evalRange(translateY, 0) === evalRange(translateY, 1));
  check(`3 floor ${i} hidden at t=0`, evalRange(opacity, 0) === 0);
  check(`3 floor ${i} opacity within [0, 1]`, opacity.outputRange.every((v) => v >= 0 && v <= 1));
  // The whole tower is in place across [FLOOR_START(4)+LAND_FRAC, EXIT_START].
  const a = FLOOR_START(FLOORS - 1) + LAND_FRAC;
  let held = true;
  for (let k = 0; k <= 200; k++) {
    const t = a + ((EXIT_START - a) * k) / 200;
    if (Math.abs(evalRange(opacity, t) - 1) > 1e-9 || Math.abs(evalRange(translateY, t)) > 1e-9) held = false;
  }
  check(`3 floor ${i} in place through the hold`, held);
}
{
  const holdMs = MS(EXIT_START - (FLOOR_START(FLOORS - 1) + LAND_FRAC));
  check('3 the finished tower holds ≥ 600 ms', holdMs >= 600, `${holdMs.toFixed(0)} ms`);
}
{
  const rise = Motion.spring.rise;
  const z = dampingRatio(rise);
  check('3 landing uses Motion.spring.rise with ζ in [0.75, 1.05]', z >= 0.75 && z <= 1.05, z.toFixed(3));
  const land = sampleSpring();
  check('3 landing samples default to Motion.spring.rise', JSON.stringify(land) === JSON.stringify(sampleSpring(rise, 10, 400)));
  check('3 landing samples monotonic', land.every((x, k) => k === 0 || x >= land[k - 1]), land.map((x) => x.toFixed(3)).join(','));
  check('3 landing ends exactly in place', land[land.length - 1] === 1);
  const peak = springPeak(rise);
  check('3 landing overshoot ≤ 0.5 %', peak <= 1.005, `peak ${peak.toFixed(5)}`);
  // The translate outputs follow the samples: monotonic toward 0 during the landing.
  const { translateY } = floorRanges(0);
  const s = FLOOR_START(0);
  const landing = translateY.inputRange
    .map((x, k) => ({ x, y: translateY.outputRange[k] }))
    .filter((p) => p.x >= s && p.x <= s + LAND_FRAC + 1e-12)
    .map((p) => p.y);
  check('3 the landing translate is monotonic to 0', landing.length >= 10
    && landing.every((y, k) => k === 0 || y <= landing[k - 1]) && landing[landing.length - 1] === 0, landing.join(','));
}

// ── 5: CraneLoader.tsx ────────────────────────────────────────────────────
const craneSrc = read('components/CraneLoader.tsx');
{
  const at = craneSrc.indexOf('export function CraneSvg(');
  check('5 export function CraneSvg exists', at >= 0);
  const bodyOpen = at >= 0 ? craneSrc.indexOf('{', craneSrc.indexOf(')', craneSrc.indexOf('}:', at)) ) : -1;
  const body = bodyOpen >= 0 ? group(craneSrc, bodyOpen) : '';
  check("5 the Platform.OS === 'web' gate is inside CraneSvg", /Platform\.OS\s*===\s*'web'/.test(body), body.slice(0, 80));
  check('5 CraneSvg renders ToppingOutMark off the web', /<ToppingOutMark\b[^>]*animate=\{animate\}/.test(body));
  check('5 CraneSvg renders CraneSvgWeb on the web', /<CraneSvgWeb\b/.test(body));
  // Module scope: no Platform.OS read outside a function body.
  const codeCrane = code(craneSrc);
  let depth = 0;
  let moduleScopeRead = false;
  for (let i = 0; i < codeCrane.length; i++) {
    const ch = codeCrane[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0 && codeCrane.startsWith('Platform.OS', i)) moduleScopeRead = true;
  }
  check('5 no module-scope Platform.OS read', !moduleScopeRead);
  const w = craneSrc.indexOf('function CraneSvgWeb(');
  const end = w >= 0 ? craneSrc.indexOf('\n}\n', w) : -1;
  const webBody = w >= 0 && end >= 0 ? craneSrc.slice(w, end + 2) : '';
  const sha = createHash('sha256').update(webBody).digest('hex');
  check('5 the web crane body is pinned (sha256)', sha === CRANE_WEB_SHA256, sha);
  check('5 the full-screen wrapper keeps testID crane-loader', /testID="crane-loader"/.test(craneSrc));
}

// ── 6: EstimateLoadingOverlay ─────────────────────────────────────────────
check('6 EstimateLoadingOverlay passes animate={visible}',
  /<CraneSvg size=\{288\} animate=\{visible\} \/>/.test(read('components/EstimateLoadingOverlay.tsx')));

// ── Phase 2: ConstructionLoader 'lg' on native ────────────────────────────
{
  const cl = code(read('components/ConstructionLoader.tsx'));
  check("phase 2: ConstructionLoader gates 'lg' native to ToppingOutMark at render",
    /const toppingOut = size === 'lg' && Platform\.OS !== 'web';/.test(cl) && /<ToppingOutMark size=\{dims\.svg \* 1\.6\} \/>/.test(cl));
  check('phase 2: the JS-driven SVG loop does not start under ToppingOutMark', /if \(toppingOut\) return;/.test(cl));
}

if (failures > 0) {
  console.error(`\nvalidate-loader: ${failures} failed, ${passes} passed`);
  process.exit(1);
}
console.info(`validate-loader: all ${passes} checks passed`);
