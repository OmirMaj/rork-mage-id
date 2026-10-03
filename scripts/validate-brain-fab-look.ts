// validate-brain-fab-look.ts — the Brain FAB wears "Struck Spark" (option E,
// design-previews/ai-button-options.html, the founder's pick) WITHOUT changing
// what the button does.
//
// What it pins:
//   1. the spark paths are the design's (SP2 flat-tipped main, SP pointed mini);
//   2. the tap / long-press / press-in / press-out handlers are the originals —
//      the only line the redesign may add to them is the hold look's
//      setHolding(...) — and they are wired to the same props;
//   3. testID, accessibility role/label/hint, the 56pt hit area, the position
//      and the BRAIN_FAB_CLEARANCE inputs are intact;
//   4. every animated prop is transform or opacity and every animation runs on
//      the shared native-driver flag;
//   5. Reduce Motion has a still path, idle never loops (loops start only past
//      a state guard), and BrainFab itself still has no Animated.loop;
//   6. the disc is flat accentFill (no gradient) and `thinking` is an optional
//      prop that defaults to false.
//
// Pure node:fs; fileURLToPath + join because the repo path contains a space.
// Run via: bun scripts/validate-brain-fab-look.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

let failed = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

const fab = stripComments(read('components/brain/BrainFab.tsx'));
const mark = stripComments(read('components/brain/StruckSparkMark.tsx'));

// ── 1. the design's paths ───────────────────────────────────────────────────
console.log('brain-fab-look — the mark:');
const SP2 = 'M11.2 .8h1.6l1.1 9.3 9.3 1.1v1.6l-9.3 1.1-1.1 9.3h-1.6l-1.1-9.3-9.3-1.1v-1.6l9.3-1.1z';
const SP = 'M12 .8 13.9 10.1 23.2 12 13.9 13.9 12 23.2 10.1 13.9.8 12 10.1 10.1Z';
const constOf = (name: string) => mark.match(new RegExp(`export const ${name} =\\s*'([^']*)'`))?.[1];
ok('STRUCK_SPARK_PATH is the design\'s flat-tipped spark (SP2)', constOf('STRUCK_SPARK_PATH') === SP2, `got ${constOf('STRUCK_SPARK_PATH')}`);
ok('POINTED_SPARK_PATH is the design\'s pointed mini spark (SP)', constOf('POINTED_SPARK_PATH') === SP, `got ${constOf('POINTED_SPARK_PATH')}`);
ok('the glyph is an SVG path in a 24×24 viewBox', /<Svg[^>]*viewBox="0 0 24 24"/.test(mark) && /<Path d=\{pointed \? POINTED_SPARK_PATH : STRUCK_SPARK_PATH\}/.test(mark));
ok('main spark white, mini spark mint #B9E4C1 and pointed', /StruckSparkMark size=\{SPARK_MAIN\.size\} color="#FFFFFF" \/>/.test(mark)
  && /SPARK_MINT = '#B9E4C1'/.test(mark) && /StruckSparkMark size=\{SPARK_MINI\.size\} color=\{SPARK_MINT\} pointed \/>/.test(mark));
ok('placements are the design\'s 58pt spots scaled to 56pt', /SPARK_MAIN = \{ size: 27, left: 12\.5, top: 16\.5 \}/.test(mark)
  && /SPARK_MINI = \{ size: 10, left: 35, top: 9\.5 \}/.test(mark));

// ── 2. handlers are the originals ───────────────────────────────────────────
console.log('\nbrain-fab-look — behaviour unchanged:');
/** The body of `const <name> = useCallback(...)`, without the hold look's setHolding lines. */
function handler(name: string): string {
  const start = fab.indexOf(`const ${name} = useCallback(`);
  if (start < 0) return '';
  const end = fab.indexOf('}, [', start);
  const deps = fab.slice(end, fab.indexOf(']);', end) + 3);
  return norm(fab.slice(start, end).replace(/^\s*setHolding\((true|false)\);\s*$/gm, '') + deps);
}
const ORIGINAL: Record<string, string> = {
  onPressIn: `const onPressIn = useCallback(() => { if (reducedMotion()) return; Animated.spring(press, { toValue: 0.94, ...Motion.spring.snap, useNativeDriver: nativeDriver }).start(); }, [press]);`,
  onPressOut: `const onPressOut = useCallback(() => { if (reducedMotion()) { press.setValue(1); return; } Animated.spring(press, { toValue: 1, ...Motion.spring.snap, useNativeDriver: nativeDriver }).start(); }, [press]);`,
  handlePress: `const handlePress = useCallback(() => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); const cleaned = segments.map(s => s.replace(/[()]/g, '')).filter(Boolean); const screen = cleaned[cleaned.length - 1]; const projectId = anchorProjectIdFor(screen, globalParams); if (isDesktopWeb) { openAsk({ screen, projectId: projectId ?? undefined }); return; } router.push( screen ? { pathname: '/ask', params: projectId ? { screen, projectId } : { screen } } : '/ask', ); }, [router, segments, globalParams, isDesktopWeb, openAsk]);`,
  handleLongPress: `const handleLongPress = useCallback(() => { if (Platform.OS === 'web' || !openVoice) return; void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); openVoice({ autoStart: true }); }, [openVoice]);`,
};
for (const [name, want] of Object.entries(ORIGINAL)) {
  const got = handler(name);
  ok(`${name} is the original (only setHolding added)`, got === norm(want), `got: ${got}`);
}
ok('setHolding(true) only in the long-press, past the web/no-mic guard', (fab.match(/setHolding\(true\)/g) ?? []).length === 1
  && /if \(Platform\.OS === 'web' \|\| !openVoice\) return;\s*setHolding\(true\);/.test(fab));
ok('the handlers are wired to the same props', /onPress=\{handlePress\}/.test(fab)
  && /onLongPress=\{canHoldForVoice \? handleLongPress : undefined\}/.test(fab)
  && /onPressIn=\{onPressIn\}/.test(fab) && /onPressOut=\{onPressOut\}/.test(fab)
  && /const canHoldForVoice = Platform\.OS !== 'web' && !!openVoice;/.test(fab));

// ── 3. testID / a11y / geometry ─────────────────────────────────────────────
ok('testID="brain-fab" and the a11y role/label/hint', /testID="brain-fab"/.test(fab) && /accessibilityRole="button"/.test(fab)
  && /accessibilityLabel="Ask MAGE"/.test(fab)
  && /accessibilityHint=\{canHoldForVoice \? 'Hold to record a voice note' : undefined\}/.test(fab));
const wrap = fab.match(/fabWrap: \{([\s\S]*?)\n {2}\},/)?.[1] ?? '';
const disc = fab.match(/\n {2}fab: \{([\s\S]*?)\n {2}\},/)?.[1] ?? '';
const num = (block: string, key: string) => Number(block.match(new RegExp(`\\b${key}: (\\d+)`))?.[1]);
ok('the disc (the hit area) is 56×56, ≥ 44pt', num(disc, 'width') === 56 && num(disc, 'height') === 56, `w=${num(disc, 'width')} h=${num(disc, 'height')}`);
ok('the wrapper is 56×56 at right 20', num(wrap, 'width') === 56 && num(wrap, 'height') === 56 && num(wrap, 'right') === 20);
ok('position + clearance inputs unchanged (insets.bottom + 70 + lift, +48 on web)',
  /bottom: insets\.bottom \+ 70 \+ lift \+ \(Platform\.OS === 'web' \? 48 : 0\)/.test(fab));
ok('the neutral elevation stays (Shadow.medium spread, elevation 12, zIndex 40); no accent shadow',
  /\.\.\.Shadow\.medium/.test(wrap) && /elevation: 12/.test(wrap) && /zIndex: 40/.test(wrap) && !/shadowColor:\s*colors\./.test(fab));
ok('desktop still opens the dock and steps aside while it shows', /if \(isDesktopWeb && dock\.showing\) return null;/.test(fab)
  && /if \(HIDDEN_ROOTS\.has\(/.test(fab));

// ── 4. native driver, transform/opacity only ────────────────────────────────
console.log('\nbrain-fab-look — motion:');
for (const [file, src] of [['BrainFab', fab], ['StruckSparkMark', mark]] as const) {
  const calls = src.match(/Animated\.(timing|spring)\([\s\S]*?\)\s*(?:\.start\(\)|,|\)|;)/g) ?? [];
  const bad = calls.filter(c => !/useNativeDriver: nativeDriver/.test(c));
  ok(`${file}: every Animated.timing/spring runs on the native-driver flag (${calls.length})`, calls.length > 0 && bad.length === 0, bad.join(' | '));
  const vals = [...src.matchAll(/const (\w+) = useRef\(new Animated\.Value\(/g)].map(m => m[1]);
  if (file === 'StruckSparkMark') vals.push('r'); // the ripples' map variable
  // …and anything derived from one (const x = cond ? 0.3 : clock.interpolate(…)).
  for (const m of src.matchAll(/const (\w+) = [^;\n]*\b(\w+)\.interpolate\(/g)) if (vals.includes(m[2])) vals.push(m[1]);
  const ALLOWED = new Set(['opacity', 'scale', 'rotate', 'translateY', 'transform']);
  const offenders: string[] = [];
  for (const m of src.matchAll(/(\w+):\s*(?:Animated\.add\()?(\w+)(\.interpolate\(|\s*[,}\]])/g)) {
    const [, key, id] = m;
    if (vals.includes(id) && !ALLOWED.has(key) && key !== 'toValue') offenders.push(`${key}: ${id}`);
  }
  ok(`${file}: animated values drive only transform/opacity`, offenders.length === 0, offenders.join(', '));
}
ok('no `useNativeDriver: false` anywhere', !/useNativeDriver:\s*false/.test(fab + mark));

// ── 5. reduced motion + idle is still ───────────────────────────────────────
ok('BrainFab has no Animated.loop (the FAB does not breathe)', !/Animated\.loop/.test(fab));
ok('BrainFab press keeps its Reduce Motion path', /if \(reducedMotion\(\)\) return;/.test(fab) && /if \(reducedMotion\(\)\) \{ press\.setValue\(1\); return; \}/.test(fab));
ok('the mark reads Reduce Motion as state (re-renders when it flips)', (mark.match(/const still = useReducedMotion\(\);/g) ?? []).length === 2);
const effects = mark.split('useEffect(() => {').slice(1).map(e => e.slice(0, e.indexOf('}, [')));
const loopy = effects.filter(e => /Animated\.loop|\bspin\(/.test(e));
ok('three looping effects (throb, ratchet+blink, ripples)', loopy.length === 3, `found ${loopy.length}`);
for (const [i, e] of loopy.entries()) {
  const guard = e.search(/if \((?:!holding \|\| thinking \|\| still|!thinking \|\| still|!holding)\) return;/);
  const loop = e.search(/Animated\.loop|\bspin\(/);
  const stillGuard = e.search(/if \(still\)|\|\| still\)/);
  ok(`loop effect ${i + 1}: a state guard and a Reduce Motion return precede the loop`, guard >= 0 && guard < loop && stillGuard >= 0 && stillGuard < loop);
  ok(`loop effect ${i + 1}: cleans up (stops) its loops`, /return \(\) => .*[sS]top\w*\(\)|return spin\(/.test(e));
}
// The motion kit's K6.2 ratchet: a loop wraps ONE Animated.timing, never a sequence.
const loops = mark.match(/Animated\.loop\(([^\n]*)/g) ?? [];
ok(`every Animated.loop wraps a single Animated.timing (${loops.length})`, loops.length === 2
  && loops.every(l => /^Animated\.loop\(Animated\.timing\(/.test(l) && (l.match(/Animated\.\w+\(/g) ?? []).length === 2));
ok('the keyframes are the design\'s: throb 1→1.12, ratchet 90° by 32% / hold / 180° by 82%, blink to .25',
  /THROB = track\(\[\[0, 0\.5, 1, 1\.12, SINE\], \[0\.5, 1, 1\.12, 1, SINE\]\]\)/.test(mark)
  && /RATCHET = track\(\[\[0, 0\.32, 0, 90, OUT\], \[0\.32, 0\.5, 90, 90, HOLD\], \[0\.5, 0\.82, 90, 180, OUT\], \[0\.82, 1, 180, 180, HOLD\]\]\)/.test(mark)
  && /BLINK = track\(\[\[0, 0\.5, 1, 0\.25, SINE\], \[0\.5, 1, 0\.25, 1, SINE\]\]\)/.test(mark)
  && /spin\(throb, 900\)/.test(mark) && /spin\(turn, 2400\)/.test(mark) && /spin\(blink, 2400\)/.test(mark));
ok('Reduce Motion stills: dimmed mini while thinking, one still ripple while holding',
  /const miniOpacity = thinking && still \? 0\.3 : blink\.interpolate\(BLINK\);/.test(mark) && /opacity: holding && i === 0 \? 0\.4 : 0, transform: \[\{ scale: 1\.28 \}\]/.test(mark));

// ── 6. the look ─────────────────────────────────────────────────────────────
console.log('\nbrain-fab-look — the disc:');
ok('flat accentFill disc, no gradient', /backgroundColor: colors\.accentFill/.test(fab) && !/LinearGradient/.test(fab));
ok('the spark face + teal rings are mounted (rings behind the disc, theme success teal)',
  /<StruckSparkRings holding=\{holding\} color=\{colors\.success\} diameter=\{FAB_SIZE\} \/>\s*<AnimatedPressable/.test(fab)
  && /<StruckSparkFace holding=\{holding\} thinking=\{thinking\} \/>/.test(fab));
ok('`thinking` is optional and defaults to false', /export function BrainFab\(\{ thinking = false \}: \{ thinking\?: boolean \} = \{\}\)/.test(fab));
ok('the rings never hit-test', (mark.match(/<View pointerEvents="none" style=\{StyleSheet\.absoluteFill\}>/g) ?? []).length === 2);
ok('the hold look clears when the finger lifts and when the FAB hides',
  /const onPressOut = useCallback\(\(\) => \{\s*setHolding\(false\);/.test(fab) && /if \(hidden\) setHolding\(false\);/.test(fab));

if (failed) { console.log(`\n✗ brain-fab-look: ${failed} failed`); process.exit(1); }
console.log('\n✓ brain-fab-look: all checks passed');
