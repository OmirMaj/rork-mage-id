// validate-level-content.ts — the Level, lane CONTENT-A: skeletons that
// breathe on ONE native loop, the busy Button, the Spinner primitive and one
// haptics module.
//
//   bun run scripts/validate-level-content.ts
//
// Two halves:
//   1. Pure rules, imported from the files themselves (react-native, expo-haptics
//      and the theme / icon / LevelMark modules are stubbed; bun cannot parse RN):
//        - skeletonCss: 33 keyframe stops equal to CORE's skeletonWave(0); every
//          phase bucket's CSS delay reproduces the native phase (same wave,
//          same direction) within half a bucket; strings for every duration;
//        - haptics: a 400 ms de-dupe window PER notification type; web no-op;
//        - busyExit (Button): no visual under 120 ms, then a 400 ms minimum hold;
//        - revealStagger (SkeletonReveal): 30 ms apart for the first six rows;
//        - the Reduce-Motion skeleton opacity 0.09 × 0.8.
//   2. Source rules, comment-stripped: the one-loop shape, the ink fill, the
//      LevelMark props on the Button (the armed tree's reveal and clock belong
//      to spinO), no per-press haptic, the toast through utils/haptics, the
//      Spinner's role and no colour literal, the five orange spinners gone.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
};

if (typeof Bun === 'undefined') {
  console.error('\nvalidate-level-content must run under bun (needs Bun.plugin to stub react-native)\n');
  process.exit(1);
}

const noop = () => {};
const Comp = () => null;
class FakeValue {
  v: number;
  constructor(v: number) { this.v = v; }
  setValue(v: number) { this.v = v; }
  stopAnimation() {}
  interpolate() { return this; }
}
const fakeAnim = () => ({ start: noop, stop: noop, reset: noop });

/** The stubbed platform (mutable per check) and every haptic the stub received. */
const platform = { OS: 'ios' as string };
const buzzes: string[] = [];

Bun.plugin({
  name: 'level-content-stubs',
  setup(build) {
    const obj = (exports: Record<string, unknown>): VirtualModule => ({ exports, loader: 'object' });
    build.module('react-native', () => obj({
      Platform: {
        get OS() { return platform.OS; },
        select: (o: Record<string, unknown>) => (platform.OS in o ? o[platform.OS] : o.default),
      },
      Dimensions: { get: () => ({ width: 390, height: 844 }), addEventListener: () => ({ remove() {} }) },
      StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {}, absoluteFillObject: {} },
      Animated: {
        Value: FakeValue, View: Comp, timing: fakeAnim, spring: fakeAnim, loop: fakeAnim,
        sequence: fakeAnim, parallel: fakeAnim, add: noop, subtract: noop, multiply: noop, divide: noop,
      },
      Easing: { out: () => noop, in: () => noop, inOut: () => noop, bezier: () => noop, cubic: noop, sin: noop, ease: noop, linear: noop },
      AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: noop, announceForAccessibility: noop },
      LayoutAnimation: { configureNext: noop },
      PixelRatio: { roundToNearestPixel: (v: number) => v },
      Pressable: Comp, ScrollView: Comp, Text: Comp, View: Comp, TouchableOpacity: Comp,
    }));
    build.module('expo-haptics', () => obj({
      notificationAsync: (t: string) => { buzzes.push(`note:${t}`); return Promise.resolve(); },
      selectionAsync: () => { buzzes.push('select'); return Promise.resolve(); },
      impactAsync: (s: string) => { buzzes.push(`impact:${s}`); return Promise.resolve(); },
      NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
      ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
    }));
    build.module('lucide-react-native', () => obj({ Check: Comp }));
    build.module('@/contexts/ThemeContext', () => obj({ useTheme: () => ({ colors: {} }) }));
    build.module('@/hooks/useThemedStyles', () => obj({ useThemedStyles: () => ({}) }));
    build.module('@/utils/useResponsiveLayout', () => obj({ useResponsiveLayout: () => ({ isDesktop: false }) }));
    build.module('@/components/loaders/LevelMark', () => obj({ default: Comp, useLevelReveal: () => 1 }));
  },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Blanks comments, keeps strings (the scripts/validate-motion.ts stripper). */
function strip(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') {
      if (src[i] === '\n') { mode = 'code'; i++; continue; }
      blank(i); i++; continue;
    }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    else if ((mode === 'sq' || mode === 'dq') && src[i] === '\n') mode = 'code';
    i++;
  }
  return out.join('');
}
const code = (rel: string) => strip(read(rel));
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

let passes = 0;
let failures = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passes += 1; console.log('  PASS  ' + name); return; }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}

const L = await import('../utils/levelTimeline');
const CSS = await import('../components/loaders/css/skeletonCss');
const H = await import('../utils/haptics');
const SK = await import('../components/Skeleton');
const SR = await import('../components/loaders/SkeletonReveal');
const BTN = await import('../components/ui/Button');

const frac = (x: number) => ((x % 1) + 1) % 1;
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

// ── 1. skeletonCss: the web wave is the native wave ─────────────────────────
console.log('\nskeletonCss — the web breath wave');
{
  const wave0 = L.skeletonWave(0);
  const frames = CSS.skeletonKeyframes();
  const keys = Object.keys(frames);
  const want = Array.from({ length: 33 }, (_, k) => `${Number(((k * 100) / 32).toFixed(4))}%`);
  ok('33 keyframe stops at 0%, 3.125%, … 100%', keys.length === 33 && JSON.stringify(keys) === JSON.stringify(want), keys.slice(0, 4).join(', '));
  ok('…their opacities are exactly skeletonWave(0) (absolute alpha, not a multiplier)',
    keys.every((k, i) => frames[k].opacity === wave0.outputRange[i]));
  ok('…and opacity is the only keyframe property', keys.every((k) => JSON.stringify(Object.keys(frames[k])) === '["opacity"]'));
  ok('rest 0.09, deepest dip 0.09 × 0.6', Math.max(...wave0.outputRange) === 0.09 && near(Math.min(...wave0.outputRange), 0.054, 1e-3));

  // Every bucket's registered style (StyleSheet.create is the identity under the stub).
  const styles = Array.from({ length: CSS.SKELETON_BUCKETS }, (_, b) => CSS.skeletonWaveStyle(frac(-(b / 16))) as unknown as Record<string, unknown>);
  ok('16 buckets', CSS.SKELETON_BUCKETS === 16);
  ok('every duration and delay is a STRING; 1600ms, linear, infinite',
    styles.every((s) => s.animationDuration === '1600ms' && s.animationTimingFunction === 'linear'
      && s.animationIterationCount === 'infinite' && typeof s.animationDelay === 'string'));
  ok("fill mode 'backwards' on every bucket", styles.every((s) => s.animationFillMode === 'backwards'));
  const delays = Array.from({ length: 16 }, (_, b) => CSS.skeletonBucketDelay(b));
  ok('bucket b delays −round(b/16 × 1600) ms', delays.every((d, b) => d === `-${Math.round((b / 16) * 1600)}ms`), delays.slice(0, 3).join(', '));

  /** CSS opacity at cycle time t for a block of phase φ: a delay of −D shows keyframe (t + D). */
  const cssAt = (phase: number, t: number) => {
    const b = CSS.skeletonBucketFor(phase);
    return L.evalRange(wave0, frac(t + b / 16));
  };
  const phases: number[] = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 7; c++) phases.push(L.skeletonPhase(r, c));
  phases.push(0, 0.5, 0.25, 0.9999, 0.03125, 0.96875);
  let worstBucket = 0;
  for (const p of phases) {
    const b = CSS.skeletonBucketFor(p);
    const shift = frac(-b / 16);
    const err = Math.min(Math.abs(shift - p), 1 - Math.abs(shift - p));
    worstBucket = Math.max(worstBucket, err);
  }
  ok('each phase takes the NEAREST bucket (≤ half a bucket, 1/32 of a cycle)', worstBucket <= 1 / 32 + 1e-9, String(worstBucket));
  // Exact on the bucket grid; within the slope × half a bucket elsewhere.
  let exact = true;
  for (const p of [0, 0.25, 0.5, 0.75, 0.125]) {
    for (let k = 0; k <= 64; k++) {
      const t = k / 64;
      if (!near(cssAt(p, t), L.evalRange(L.skeletonWave(p), t), 1e-3)) exact = false;
    }
  }
  ok('on the bucket grid the web opacity equals the native one at every time sample', exact);
  let worst = 0;
  for (const p of phases) for (let k = 0; k <= 128; k++) {
    const t = k / 128;
    worst = Math.max(worst, Math.abs(cssAt(p, t) - L.evalRange(L.skeletonWave(p), t)));
  }
  ok('everywhere else within 0.012 opacity (half a bucket of the steepest slope)', worst <= 0.012, String(worst));
  // Direction: the dip reaches a later row LATER, on both platforms.
  const dipAt = (f: (t: number) => number) => {
    let bestT = 0; let best = Infinity;
    for (let k = 0; k < 256; k++) { const t = k / 256; const v = f(t); if (v < best) { best = v; bestT = t; } }
    return bestT;
  };
  const d0 = dipAt((t) => cssAt(0, t));
  const d3 = dipAt((t) => cssAt(0.25, t));
  const n0 = dipAt((t) => L.evalRange(L.skeletonWave(0), t));
  const n3 = dipAt((t) => L.evalRange(L.skeletonWave(0.25), t));
  ok('the wave travels the same way on the web as on the phone (a later phase dips later)',
    near(frac(d3 - d0), 0.25, 1 / 128) && near(frac(n3 - n0), 0.25, 1 / 128), `web ${d0}→${d3}, native ${n0}→${n3}`);
}

// ── 2. haptics: one buzz per type per 400 ms ────────────────────────────────
console.log('\nutils/haptics — one module, de-duped');
{
  const realNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    const reset = () => { H.__resetHapticsForTests(); buzzes.length = 0; };
    const notes = () => buzzes.filter((b) => b.startsWith('note:'));
    platform.OS = 'ios';
    reset();
    ok('the window is 400 ms', H.HAPTIC_DEDUPE_MS === 400);
    H.haptic.success();
    now += 399;
    H.haptic.success();
    ok('success twice inside 400 ms → ONE buzz (the Button morph + the toast)', notes().length === 1 && notes()[0] === 'note:success', buzzes.join(','));
    now += 1;
    H.haptic.success();
    ok('…at exactly 400 ms apart it is still ONE (the Button hold can end exactly 400 after the toast)', notes().length === 1);
    now += 1;
    H.haptic.success();
    ok('…past 400 ms it buzzes again', notes().length === 2);
    reset();
    H.haptic.success();
    H.haptic.error();
    H.haptic.warning();
    ok('the window is PER TYPE: success, error and warning all buzz', JSON.stringify(notes()) === JSON.stringify(['note:success', 'note:error', 'note:warning']), buzzes.join(','));
    H.haptic.error();
    ok('…and a second error inside the window does not', notes().length === 3);
    reset();
    H.haptic.select(); H.haptic.select(); H.haptic.tap();
    ok('select and tap are not de-duped (select → selectionAsync, tap → impact Light)',
      JSON.stringify(buzzes) === JSON.stringify(['select', 'select', 'impact:light']), buzzes.join(','));
    reset();
    platform.OS = 'web';
    H.haptic.success(); H.haptic.error(); H.haptic.select(); H.haptic.tap();
    ok('web: every call is a no-op', buzzes.length === 0, buzzes.join(','));
    platform.OS = 'ios';
    H.haptic.success();
    ok('…and a web call never consumed the window', notes().length === 1);
    now += 50;
    H.__resetHapticsForTests();
    H.haptic.success();
    ok('__resetHapticsForTests forgets the window', notes().length === 2);
  } finally {
    Date.now = realNow;
    platform.OS = 'ios';
  }
}

// ── 3. busyExit / revealStagger / the Reduce-Motion opacity ─────────────────
console.log('\nthe busy button, the reveal stagger, Reduce Motion');
{
  const e = (at: number) => BTN.busyExit(1000, 1000 + at);
  ok('ends at +80 → never shown, no hold', JSON.stringify(e(80)) === '{"shown":false,"holdMs":0}');
  ok('ends at +119 → never shown', e(119).shown === false && e(119).holdMs === 0);
  ok('ends at +120 → shown, holds the full 400', e(120).shown && e(120).holdMs === 400);
  ok('ends at +300 → holds until +520 (220 more)', e(300).shown && e(300).holdMs === 220);
  ok('ends at +520 → no hold left', e(520).shown && e(520).holdMs === 0);
  ok('ends at +2000 → no hold', e(2000).holdMs === 0);
  ok('the numbers are LOADER.button (120 / 400)', L.LOADER.button.revealMs === 120 && L.LOADER.button.minHoldMs === 400);

  const got = [0, 1, 2, 3, 4, 5, 6, 7, 40].map(SR.revealStagger);
  ok('revealStagger: 30 ms apart for the first six rows, none from the seventh', JSON.stringify(got) === JSON.stringify([0, 30, 60, 90, 120, 150, 0, 0, 0]), JSON.stringify(got));
  ok('revealStagger: a negative or non-finite index does not delay', SR.revealStagger(-2) === 0 && SR.revealStagger(Number.NaN) === 0);

  ok('Reduce Motion skeleton opacity: 0.09 × 0.8 = 0.072', SK.SKELETON_STATIC_OPACITY === 0.072, String(SK.SKELETON_STATIC_OPACITY));
  ok('an unindexed block sits at phase 0; card 2 row 0 at 0.2 (CORE skeletonPhase)', L.skeletonPhase(undefined, undefined) === 0 && L.skeletonPhase(2, 0) === 0.2);
}

// ── 4. source rules ─────────────────────────────────────────────────────────
console.log('\nSkeleton.tsx');
{
  const sk = code('components/Skeleton.tsx');
  ok('no Animated.sequence (the loop shape RN restarted from JS every 900 ms)', !/Animated\.sequence\b/.test(sk));
  ok('exactly one Animated.loop', count(sk, /Animated\.loop\(/g) === 1);
  const loopAt = sk.indexOf('Animated.loop(');
  const loopBody = loopAt < 0 ? '' : sk.slice(loopAt, sk.indexOf('}));', loopAt));
  ok('…wrapping ONE linear Animated.timing, isInteraction: false, period LOADER.skeleton.periodMs, native driver',
    count(loopBody, /Animated\.timing\(/g) === 1 && /easing: Easing\.linear/.test(loopBody) && /isInteraction: false/.test(loopBody)
    && /duration: LOADER\.skeleton\.periodMs/.test(loopBody) && /useNativeDriver: nativeDriver/.test(loopBody), loopBody);
  ok('uses CORE\'s skeletonWave and skeletonPhase', /\bskeletonWave\(/.test(sk) && /\bskeletonPhase\(/.test(sk)
    && /import \{[^}]*\bskeletonWave\b[^}]*\} from '@\/utils\/levelTimeline'/.test(sk));
  ok('index / col are OPTIONAL props', /index\?: number;/.test(sk) && /col\?: number;/.test(sk)
    && /export function SkeletonRow\(\{ style, index \}: \{ style\?: ViewStyle; index\?: number \}\)/.test(sk)
    && /export function SkeletonCard\(\{ style, index \}: \{ style\?: ViewStyle; index\?: number \}\)/.test(sk));
  ok('an unindexed block is phase 0', /index === undefined \? 0 : skeletonPhase\(index, col\)/.test(sk));
  ok('ListSkeleton gives card i index i', /<SkeletonCard key=\{i\} index=\{i\} \/>/.test(sk));
  ok('blocks are ink: backgroundColor colors.text', count(sk, /backgroundColor: colors\.text/g) >= 2);
  ok('colors.line is only the card border and the divider (never a block fill)',
    count(sk, /colors\.line/g) === 2 && /borderColor: colors\.line/.test(sk) && /cardStyles\.divider, \{ backgroundColor: colors\.line \}/.test(sk));
  ok('no alpha suffix on a token', !/colors\.\w+\s*\+\s*['"`]/.test(sk));
  ok('no per-instance Animated.Value', !/useRef\(new Animated\.Value/.test(sk));
  ok('one interpolation per phase (a module-level cache)', /const waveNodes = new Map</.test(sk) && /extrapolate: 'clamp'/.test(sk));
  ok('Reduce Motion: no loop acquired, the static opacity', /const animate = !web && !reduce;/.test(sk) && /if \(reduce\) return \(\) => STATIC;/.test(sk));
  ok('web: no loop, the registered CSS bucket', /if \(web\) return \(phase\) => \[WEB_REST, skeletonWaveStyle\(phase\)\];/.test(sk));
  ok('SkeletonHero: 3 KPIs 48 tall + a 2 × 3 grid 72 tall, radius 12, gap 8',
    /kpi: \{ flex: 1, height: 48, borderRadius: Tokens\.radius\.card \}/.test(sk) && /tile: \{ flex: 1, height: 72, borderRadius: Tokens\.radius\.card \}/.test(sk)
    && /wrapper: \{ gap: 8 \}/.test(sk) && /\[1, 2\]\.map/.test(sk) && count(sk, /\[0, 1, 2\]\.map/g) === 2);
  ok('SkeletonTable: header 40 % × 12, rows of 3 cells flex 3/1/1, 12 tall, radius 4, 14 apart',
    /header: \{ width: '40%' as const, height: 12, borderRadius: 4 \}/.test(sk) && /const TABLE_FLEX = \[3, 1, 1\] as const;/.test(sk)
    && /cell: \{ height: 12, borderRadius: 4 \}/.test(sk) && /wrapper: \{ gap: 14 \}/.test(sk) && /rows = 5/.test(sk));
}

console.log('\nskeletonCss.ts');
{
  const css = code('components/loaders/css/skeletonCss.ts');
  ok('keyframes registered through StyleSheet.create', /animationKeyframes: KEYFRAMES/.test(css) && /StyleSheet\.create\(RAW\)/.test(css));
  ok("fill mode 'backwards' only", /animationFillMode: 'backwards'/.test(css) && !/'both'|'forwards'/.test(css));
  ok('durations and delays are template STRINGS', /animationDuration: `\$\{LOADER\.skeleton\.periodMs\}ms`/.test(css) && /return `-\$\{Math\.round/.test(css));
  ok('the timing comes from LOADER (no re-declared 1600)', !/\b1600\b/.test(css));
}

console.log('\nButton.tsx — the busy state');
{
  const b = code('components/ui/Button.tsx');
  ok('no ActivityIndicator', !/ActivityIndicator/.test(b));
  ok('LevelMark size={20} tone="onAccent" in both trees', count(b, /<LevelMark\b[\s\S]{0,80}?size=\{20\}\s+tone="onAccent"/g) === 2);
  const armedAt = b.indexOf('key={busy.episode}');
  const armed = armedAt < 0 ? '' : b.slice(b.lastIndexOf('<LevelMark', armedAt), b.indexOf('/>', armedAt));
  ok('the armed-tree level: a key per busy episode, revealDelayMs={0}, exit="none", no done',
    !!armed && /revealDelayMs=\{0\}/.test(armed) && /exit="none"/.test(armed) && !/\bdone=/.test(armed), armed);
  ok('…animate is bound to the busy visual, never a literal', /animate=\{busyVisual\b/.test(armed) && !/animate=\{true\}/.test(b));
  ok('the busy visual is on from the press until its fade-out ends',
    /const busyVisual = armed\.current && \(phase === 'loading' \|\| busy\.tail\);/.test(b));
  ok('the static-tree level waits LOADER.button.revealMs itself', /revealDelayMs=\{LOADER\.button\.revealMs\} exit="none" \/>/.test(b));
  ok('busy + disabled from the PROP at the press; the hold keeps the press blocked, busy false',
    /accessibilityState=\{armed\.current \? \{ disabled: isDisabled \|\| holdActive, busy: phase === 'loading' \}/.test(b)
    && /disabled=\{isDisabled \|\| holdActive\}/.test(b) && /const isDisabled = disabled \|\| loading \|\| done;/.test(b));
  ok('the reveal and the level fade are plateaus on LOADER.button.revealMs (no JS timer for motion)',
    /plateau\(B\.revealMs \/ labelMs, ACCELERATE\)/.test(b) && /plateau\(levelAt \/ levelMs, DECELERATE\)/.test(b)
    && /const labelMs = B\.revealMs \+ BUSY_LABEL_FADE_MS;/.test(b) && /const levelAt = B\.revealMs \+ BUSY_LEVEL_LAG_MS;/.test(b)
    && /const BUSY_LABEL_FADE_MS = 120;/.test(b) && /const BUSY_LEVEL_LAG_MS = 60;/.test(b) && /const BUSY_LEVEL_FADE_MS = 160;/.test(b)
    && /const BUSY_LABEL_LIFT = -4;/.test(b));
  ok('the snap-to-idle (loading ended inside 120 ms) runs only for an episode entered through enterBusy — a Button that MOUNTED loading keeps its hidden label',
    /if \(!busy\.tail && enteredBusy\.current\) \{/.test(b) && /const enterBusy = \(\) => \{\s*enteredBusy\.current = true;/.test(b)
    && count(b, /v\.labelO\.setValue\(1\)/g) === 1);
  ok('the minimum hold is busyExit on LOADER.button, one timer for the remainder',
    /shownAt \+ LOADER\.button\.minHoldMs - now/.test(b) && count(b, /setTimeout\(/g) === 2 /* the hold + useCommitFeedback */);
  ok('imports haptic from @/utils/haptics; no Haptics.* left', /import \{ haptic \} from '@\/utils\/haptics';/.test(b) && !/\bHaptics\./.test(b) && !/expo-haptics/.test(b));
  ok('no per-press haptic: handlePress only calls onPress', !/selectionAsync/.test(b) && /const handlePress = \(\) => \{\s*onPress\(\);\s*\};/.test(b));
  ok('the done morph buzzes haptic.success() on iOS only', /if \(Platform\.OS === 'ios'\) \{\s*haptic\.success\(\);\s*\}/.test(b));
  ok('the Reduce Motion setValue block is intact, labelY after it',
    /if \(reducedMotion\(\)\) \{\s*v\.labelO\.setValue\(to\.labelO\);\s*v\.spinO\.setValue\(to\.spinO\);\s*v\.checkO\.setValue\(to\.checkO\);\s*v\.tintO\.setValue\(to\.tintO\);\s*v\.labelY\.setValue\(0\);/.test(b));
  ok('Reduce Motion enter: no translate, the 120 ms reveal is a jump at the end of one timing',
    /v\.labelY\.setValue\(0\);\s*parts = \[jump\(v\.labelO, 0\), jump\(v\.spinO, 1\)/.test(b) && /duration: B\.revealMs, easing: plateau\(1, linear\)/.test(b));
  ok('the label row lifts on labelY', /transform: \[\{ translateY: values\.current\.labelY \}\]/.test(b));
}

console.log('\nNailItToast, haptics, Spinner, the AI panels');
{
  const toast = code('components/animations/NailItToast.tsx');
  ok('NailItToast: no direct Haptics.notificationAsync', !/Haptics\.notificationAsync/.test(toast) && !/expo-haptics/.test(toast));
  ok('NailItToast: error → haptic.error(), else haptic.success()', /if \(event\.kind === 'error'\) haptic\.error\(\);\s*else haptic\.success\(\);/.test(toast));

  const h = code('utils/haptics.ts');
  ok('utils/haptics: a 400 ms window compared per type', /export const HAPTIC_DEDUPE_MS = 400;/.test(h) && /now - lastFired\[kind\] <= HAPTIC_DEDUPE_MS/.test(h));
  ok('utils/haptics: web returns before anything fires', count(h, /if \(Platform\.OS === 'web'\) return/g) === 2);
  ok('utils/haptics: every call swallows its rejection', /maybe\.catch\(\(\) => \{\}\)/.test(h));

  const sp = code('components/ui/Spinner.tsx');
  ok('Spinner: no colour literal', !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(sp));
  ok('Spinner: accessibilityRole="progressbar", a label, accessible', /accessibilityRole="progressbar"/.test(sp) && /accessibilityLabel=\{label\}/.test(sp) && /\baccessible\b/.test(sp));
  ok("Spinner: row 20 / panel 36, the inline reveal (150)", /row: 20, panel: 36/.test(sp) && /revealDelayMs=\{LOADER\.gate\.inline\.delayMs\}/.test(sp) && L.LOADER.gate.inline.delayMs === 150);
  ok('the barrel exports Spinner', /export \{ Spinner\b[^}]*\} from '\.\/Spinner';/.test(code('components/ui/index.ts')));

  for (const f of ['components/AISubEvaluator.tsx', 'components/AIEquipmentAdvice.tsx', 'components/AIEstimateValidator.tsx', 'components/AIBidScorecard.tsx']) {
    const src = code(f);
    const bad = src.split('\n').filter((l) => /ActivityIndicator/.test(l) && /#FF6A1A/i.test(l));
    ok(`${f}: no orange ActivityIndicator; the Spinner instead`, bad.length === 0 && /<Spinner tone="accent" \/>/.test(src), bad.join('\n'));
  }
}

// Information for the orchestrator: CORE's ratchet counts <ActivityIndicator in app/, components/, hooks/.
{
  let n = 0;
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${e}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx|js|jsx)$/.test(e)) n += count(code(rel), /<ActivityIndicator\b/g);
    }
  };
  for (const d of ['app', 'components', 'hooks']) walk(d);
  console.log(`\n  NOTE  <ActivityIndicator count in app/ components/ hooks/: ${n}`);
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
