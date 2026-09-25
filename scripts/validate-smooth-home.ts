// smooth-l4-validate.ts — the smoothness pass, lane 4: the gliding segmented
// indicator, Home's filter glide, the shared skeleton pulse and the quiet sync
// poll.
//
//   bun run scripts/validate-smooth-home.ts
//
// Two halves:
//   1. The pure rules, imported from the components themselves (react-native
//      and the app's context modules are stubbed; bun cannot parse RN):
//        - planSegmentGlide / edgeSprings / sameRect (SegmentedControl): when a
//          value change glides, and which edge leads;
//        - the indicator geometry: a w0-wide view centred at (L+R)/2 and scaled
//          by (R-L)/w0 covers exactly [L, R], and rests at scaleX 1;
//        - entranceStagger (ProjectCard): 30 ms apart, the first five only;
//        - shimmerCounter (Skeleton): the first subscriber starts the one loop,
//          the last one out stops it;
//        - statusEqual / unsavedEqual (useSyncStatus): a quiet poll sets no state.
//   2. The wiring, read as text: the indicator is non-interactive and hidden
//      from assistive tech, no segment paints its own fill while one flies,
//      layoutNext() sits on the line before the setState it animates, the burn
//      bar is a native-driver scaleX, and the poll is 30 s.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
};

if (typeof Bun === 'undefined') {
  console.error('\nsmooth-l4-validate must run under bun (needs Bun.plugin to stub react-native)\n');
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

Bun.plugin({
  name: 'smooth-l4-stubs',
  setup(build) {
    const obj = (exports: Record<string, unknown>): VirtualModule => ({ exports, loader: 'object' });
    build.module('react-native', () => obj({
      Platform: { OS: 'ios', select: (o: Record<string, unknown>) => ('ios' in o ? o.ios : o.default) },
      Dimensions: { get: () => ({ width: 390, height: 844 }), addEventListener: () => ({ remove() {} }) },
      StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s, hairlineWidth: 1 },
      Animated: {
        Value: FakeValue, View: Comp, timing: fakeAnim, spring: fakeAnim, loop: fakeAnim,
        sequence: fakeAnim, parallel: fakeAnim, add: noop, subtract: noop, multiply: noop, divide: noop,
      },
      Easing: { out: () => noop, inOut: () => noop, cubic: noop, sin: noop, ease: noop },
      AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(false), addEventListener: noop },
      LayoutAnimation: { configureNext: noop },
      AppState: { addEventListener: () => ({ remove: noop }) },
      Pressable: Comp, ScrollView: Comp, Text: Comp, View: Comp, TouchableOpacity: Comp,
    }));
    build.module('expo-haptics', () => obj({ selectionAsync: () => Promise.resolve(), impactAsync: () => Promise.resolve(), ImpactFeedbackStyle: {} }));
    // Every icon name the imported components pull in, each a null component.
    const icons: Record<string, unknown> = {};
    for (const n of ['Building2', 'Hammer', 'Plus', 'PenLine', 'Store', 'Trees', 'Home', 'LayoutGrid', 'Paintbrush',
      'Droplets', 'Zap', 'Boxes', 'Wrench', 'ChevronRight', 'MapPin']) icons[n] = Comp;
    build.module('lucide-react-native', () => obj(icons));
    build.module('@react-native-async-storage/async-storage', () => obj({ default: { multiGet: async () => [] } }));
    build.module('@/contexts/ThemeContext', () => obj({ useTheme: () => ({ colors: {} }) }));
    build.module('@/hooks/useThemedStyles', () => obj({ useThemedStyles: () => ({}) }));
    build.module('@/utils/offlineQueue', () => obj({
      currentSessionUserId: async () => null, onQueueChanged: () => noop, onQueueFlushed: () => noop,
      partitionQueueForSession: () => ({ own: [] }),
    }));
  },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let passes = 0;
let failures = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passes += 1; console.log('  PASS  ' + name); return; }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
}

const SC = await import('../components/ui/SegmentedControl');
const { Motion } = await import('../constants/designTokens');
const PC = await import('../components/ProjectCard');
const SK = await import('../components/Skeleton');
const SS = await import('../hooks/useSyncStatus');
const { computeSyncStatus } = await import('../utils/syncStatusCore');

// ── 1. planSegmentGlide ─────────────────────────────────────────────────────
{
  const a = { x: 3, y: 3, w: 80, h: 32 };
  const b = { x: 85, y: 3, w: 100, h: 32 };
  const right = SC.planSegmentGlide(a, b, false);
  ok('a measured change on one line glides', right !== null);
  ok('…moving right: the right edge leads, the left trails',
    !!right && right.movingRight && right.rightSpring === Motion.spring.glideLead && right.leftSpring === Motion.spring.glideTrail);
  const left = SC.planSegmentGlide(b, a, false);
  ok('…moving left: the left edge leads, the right trails',
    !!left && !left.movingRight && left.leftSpring === Motion.spring.glideLead && left.rightSpring === Motion.spring.glideTrail);
  ok('…and it carries the exact from / to boxes', !!right && right.from === a && right.to === b);
  ok('Reduce Motion: no glide (today\'s instant swap)', SC.planSegmentGlide(a, b, true) === null);
  ok('an unmeasured source: no glide', SC.planSegmentGlide(undefined, b, false) === null);
  ok('an unmeasured target: no glide', SC.planSegmentGlide(a, undefined, false) === null);
  ok('a zero-width segment: no glide', SC.planSegmentGlide({ ...a, w: 0 }, b, false) === null);
  ok('a zero-height target: no glide', SC.planSegmentGlide(a, { ...b, h: 0 }, false) === null);
  ok('a wrapped row (different line): no cross-line travel', SC.planSegmentGlide(a, { ...b, y: 40 }, false) === null);
  ok('lead is the stiffer spring, trail the softer (the stretch)',
    Motion.spring.glideLead.stiffness > Motion.spring.glideTrail.stiffness);
  ok('sameRect: equal boxes', SC.sameRect(a, { ...a }));
  ok('sameRect: a one-pixel wider box is a move', !SC.sameRect(a, { ...a, w: 81 }));
}

// ── 2. the indicator's geometry (the formula SegmentedControl renders) ──────
{
  // translateX = (L+R)/2 - w0/2 on a view at left 0, width w0; scaleX = (R-L)/w0
  // about the view's centre. Its painted box is centre ± (w0·scaleX)/2.
  const box = (L: number, R: number, w0: number) => {
    const tx = (L + R) / 2 - w0 / 2;
    const sx = (R - L) / w0;
    const centre = tx + w0 / 2;
    return { left: centre - (w0 * sx) / 2, right: centre + (w0 * sx) / 2, sx };
  };
  const mid = box(40, 190, 100);
  ok('mid-flight the painted box is exactly [L, R]', Math.abs(mid.left - 40) < 1e-9 && Math.abs(mid.right - 190) < 1e-9);
  const rest = box(85, 185, 100);
  ok('at rest scaleX is exactly 1 (the radius is exact)', rest.sx === 1 && rest.left === 85 && rest.right === 185);
  const src = strip(read('components/ui/SegmentedControl.tsx'));
  ok('the component renders that formula',
    src.includes('Animated.subtract(Animated.multiply(Animated.add(L, R), 0.5), glideW0 / 2)')
    && src.includes('Animated.divide(Animated.subtract(R, L), glideW0)'));
}

// ── 3. entranceStagger ─────────────────────────────────────────────────────
{
  const got = [0, 1, 2, 3, 4, 5, 8, 49].map(PC.entranceStagger);
  ok('stagger is 30 ms apart and caps at the fifth card', JSON.stringify(got) === JSON.stringify([0, 30, 60, 90, 120, 120, 120, 120]), JSON.stringify(got));
  ok('a negative index does not delay', PC.entranceStagger(-3) === 0);
}

// ── 4. shimmerCounter ──────────────────────────────────────────────────────
{
  let starts = 0;
  let stops = 0;
  const c = SK.shimmerCounter(() => { starts += 1; }, () => { stops += 1; });
  c.acquire(); c.acquire(); c.acquire();
  ok('three skeletons mount: ONE loop starts', starts === 1 && stops === 0 && c.count() === 3);
  c.release(); c.release();
  ok('two unmount: the loop keeps running for the last', stops === 0 && c.count() === 1);
  c.release();
  ok('the last unmounts: the loop stops', stops === 1 && c.count() === 0);
  c.release();
  ok('an extra release is a no-op (never negative, never a second stop)', stops === 1 && c.count() === 0);
  c.acquire();
  ok('a new first subscriber starts it again', starts === 2);
  ok('the pulse range matches the web keyframe (0.5 ↔ 0.85), static 0.6',
    SK.SHIMMER_LOW === 0.5 && SK.SHIMMER_HIGH === 0.85 && SK.SHIMMER_STATIC === 0.6);
}

// ── 5. statusEqual / unsavedEqual ──────────────────────────────────────────
{
  const input = {
    depths: { writes: 2, photos: 1, dictations: 0 },
    failures: { count: 0, labels: [] as string[] },
    readFailed: false,
    signedIn: true,
  };
  const s1 = computeSyncStatus(input);
  const s2 = computeSyncStatus({ ...input, depths: { ...input.depths } });
  ok('the same queue read twice is equal (a quiet poll keeps the old object)', SS.statusEqual(s1, s2));
  ok('one more queued write is a change', !SS.statusEqual(s1, computeSyncStatus({ ...input, depths: { ...input.depths, writes: 3 } })));
  ok('a queued photo moving to a recording is a change',
    !SS.statusEqual(s1, computeSyncStatus({ ...input, depths: { writes: 2, photos: 0, dictations: 1 } })));
  ok('a read failure is a change', !SS.statusEqual(s1, computeSyncStatus({ ...input, readFailed: true })));
  ok('signing out is a change', !SS.statusEqual(s1, computeSyncStatus({ ...input, signedIn: false })));
  const f1 = computeSyncStatus({ ...input, failures: { count: 1, labels: ['Daily report'] } });
  const f2 = computeSyncStatus({ ...input, failures: { count: 1, labels: ['Invoice'] } });
  ok('a different failed label is a change', !SS.statusEqual(f1, f2));

  const line = { id: 'a', label: 'Daily report', line: 'Not saved', canRetry: true, writes: 1, discards: 'edit' as const };
  ok('unsaved rows: same rows are equal', SS.unsavedEqual([line], [{ ...line }]));
  ok('unsaved rows: a new row is a change', !SS.unsavedEqual([line], [line, { ...line, id: 'b' }]));
  ok('unsaved rows: a changed reason on the same id is a change', !SS.unsavedEqual([line], [{ ...line, line: 'Not saved — offline' }]));
  ok('unsaved rows: retry becoming impossible is a change', !SS.unsavedEqual([line], [{ ...line, canRetry: false }]));
  ok('unsaved rows: a different discard kind is a change', !SS.unsavedEqual([line], [{ ...line, discards: 'delete' }]));
  ok('unsaved rows: order matters', !SS.unsavedEqual([line, { ...line, id: 'b' }], [{ ...line, id: 'b' }, line]));
}

// ── 6. wiring ──────────────────────────────────────────────────────────────
{
  const seg = strip(read('components/ui/SegmentedControl.tsx'));
  ok('the indicator is non-interactive and hidden from assistive tech',
    /key="glide-indicator"\s+pointerEvents="none"\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/.test(seg));
  ok('…and carries no role', !/glide-indicator"[\s\S]{0,200}accessibilityRole/.test(seg));
  ok('the underline bar flies on the target segment\'s own bottom edge (a wrapped row has two lines)',
    /top: underline \? glide\.to\.y \+ glide\.to\.h - 2 : glide\.to\.y/.test(seg) && !/bottom: underline \? 0/.test(seg));
  ok('no segment paints its own fill or underline while one flies',
    /!underline && on && !glide && styles\.segOn/.test(seg)
    && /underline && on && !glide && \{ borderBottomColor: colors\.accent \}/.test(seg)
    && /isDesktop && underline && on && !glide && \{ borderBottomColor: colors\.accent \}/.test(seg));
  ok('the indicator is the first child of the row and of the phone ScrollView content',
    (seg.match(/\{indicator\}\s*\{segments\}/g) ?? []).length === 2);
  ok('the pill reuses segOn\'s recipe', /indicatorPill: \{\s*\.\.\.cardSurface\(t, \{ radius: 'sm', pad: 'none', bordered: false \}\),\s*\.\.\.Tokens\.shadow\.subtle,/.test(seg));
  ok('springs on the native driver', (seg.match(/useNativeDriver: nativeDriver/g) ?? []).length === 2);
  ok('the selection haptic stays', /Haptics\.selectionAsync\(\)/.test(seg));
  ok('every segment is measured', /onLayout=\{measure\(opt\.value\)\}/.test(seg));

  const home = strip(read('app/(tabs)/(home)/index.tsx'));
  ok('Home stage chip: layoutNext() on the line before pickStatusFilter',
    /layoutNext\(\);\n\s*pickStatusFilter\(chip\.key\);/.test(home));
  ok('Home passes skipEntrance once the list has painted',
    /skipEntrance=\{listPaintedRef\.current\}/.test(home)
    && /if \(projects\.length > 0\) listPaintedRef\.current = true;/.test(home));

  const inbox = strip(read('components/SmartInbox.tsx'));
  ok('SmartInbox: layoutNext() before Show-more, Collapse and dismiss',
    /layoutNext\(\);\n\s*setExpanded\(true\);/.test(inbox)
    && /layoutNext\(\);\n\s*setExpanded\(false\);/.test(inbox)
    && /layoutNext\(\);\n\s*dismiss\(item\.id\);/.test(inbox));

  const card = strip(read('components/ProjectCard.tsx'));
  ok('burn bar: static width, native-driver scaleX from the left edge',
    /transform: \[\{ scaleX: burnAnim \}\]/.test(card) && /transformOrigin: 'left'/.test(card)
    && !/outputRange: \['0%', '100%'\]/.test(card) && !/useNativeDriver: false/.test(card));
  ok('entrance honours skipEntrance and Reduce Motion (zero duration, no delay)',
    /const instant = skipEntrance \|\| reducedMotion\(\);/.test(card)
    && /duration: instant \? 0 : 220,/.test(card) && /delay: instant \? 0 : entranceStagger\(index\),/.test(card));

  const sk = strip(read('components/Skeleton.tsx'));
  ok('Skeleton: no per-instance loop, the web pulse on the root', !/useRef\(new Animated\.Value/.test(sk) && /webMotion\('pulse'\)/.test(sk));
  ok('Skeleton roots are hidden from assistive tech', (sk.match(/\{\.\.\.A11Y_HIDDEN\}/g) ?? []).length === 3);

  const sync = strip(read('hooks/useSyncStatus.ts'));
  ok('the sync poll is 30 s', /const POLL_INTERVAL_MS = 30_000;/.test(sync));
  ok('photo / voice uploads (no queue event) keep a 4 s re-read while either queue holds work',
    /const UPLOAD_POLL_MS = 4_000;/.test(sync) && /const uploadsPending = status\.depths\.photos \+ status\.depths\.dictations > 0;/.test(sync)
    && /if \(!uploadsPending\) return;\s*const fast = setInterval\(\(\) => \{ void refresh\(\); \}, UPLOAD_POLL_MS\);/.test(sync));
  ok('a quiet re-read sets no new state',
    /setStatus\(\(prev\) => \(statusEqual\(prev, next\) \? prev : next\)\)/.test(sync)
    && /setUnsaved\(\(prev\) => \(unsavedEqual\(prev, lines\) \? prev : lines\)\)/.test(sync));
}

console.log(`\n  ${passes} passed, ${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
