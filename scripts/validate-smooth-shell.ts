// smooth-l2-shell-guard.ts — the app shell's motion rules (smoothness pass, lane 2).
//
//   bun run scripts/validate-smooth-shell.ts
//
// Text-only (the files import react-native, which bun cannot load). It pins
// what the smoothness pass changed in the shell every screen shares, so a
// later edit cannot quietly bring back the bounce, the glow or the dead time:
//
//   1. CreateMenu's MODAL_ROUTES is EXACTLY the set of routes the menu can open
//      that app/_layout.tsx presents as `presentation: 'modal'`. A modal route
//      missing from it is pushed while the sheet is still dismissing (iOS
//      refuses to present it); a pushed route wrongly in it waits a dead beat.
//   2. CreateMenu navigates a non-modal row BEFORE it closes (no fixed timer),
//      defers a modal row to onDismiss (+ the timeout fallback), and never
//      slides.
//   3. The phone tab bar cross-fades with the app's swap spec (off under Reduce
//      Motion), and the tab icon neither bounces nor uses bounciness.
//   4. The Brain FAB does not breathe (no Animated.loop), has no accent glow,
//      uses the neutral Shadow.medium, springs on Motion presets, and glides a
//      lift through a translateY that rests at 0.
//   5. AlertHost keeps the last alert displayed while the desktop Modal fades
//      out, and its handlers stay inert on a null `current`.
//   6. UniversalSearch fades on desktop web and still slides on a phone.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source without // line comments and block comments (comments may explain history). */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let failed = 0;
function ok(label: string, pass: boolean, detail = ''): void {
  if (pass) console.log(`  PASS  ${label}`);
  else { failed++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}

// ── 1. Modal routes ─────────────────────────────────────────────────────────

/** Route names app/_layout.tsx registers with presentation 'modal'. */
export function modalRoutesInLayout(layoutSrc: string): Set<string> {
  const out = new Set<string>();
  const screens = layoutSrc.match(/<Stack\.Screen\b[\s\S]*?\/>/g) ?? [];
  for (const block of screens) {
    if (!/presentation:\s*['"]modal['"]/.test(block)) continue;
    const name = block.match(/name=["']([^"']+)["']/)?.[1];
    if (name) out.add(`/${name}`);
  }
  return out;
}

/** The route paths (no query) of every `href:` in CreateMenu's OPTIONS. */
export function createMenuHrefPaths(menuSrc: string): Set<string> {
  const start = menuSrc.indexOf('const OPTIONS');
  const end = menuSrc.indexOf('];', start);
  const body = menuSrc.slice(start, end);
  const out = new Set<string>();
  for (const m of body.matchAll(/href:\s*'([^']+)'/g)) out.add(m[1].split('?')[0]);
  return out;
}

/** The literal members of CreateMenu's MODAL_ROUTES set. */
export function declaredModalRoutes(menuSrc: string): Set<string> {
  const m = menuSrc.match(/const MODAL_ROUTES[^=]*=\s*new Set\(\[([^\]]*)\]\)/);
  const out = new Set<string>();
  if (!m) return out;
  for (const s of m[1].matchAll(/'([^']+)'/g)) out.add(s[1]);
  return out;
}

const layoutSrc = read('app/_layout.tsx');
const menuRaw = read('components/CreateMenu.tsx');
const menu = code('components/CreateMenu.tsx');

const layoutModal = modalRoutesInLayout(layoutSrc);
ok('app/_layout.tsx still registers modal routes (the parser found some)', layoutModal.size >= 5, `found ${[...layoutModal].join(', ')}`);
const hrefs = createMenuHrefPaths(menuRaw);
ok('CreateMenu OPTIONS parsed', hrefs.size >= 20, `found ${hrefs.size}`);
const expected = new Set([...hrefs].filter((h) => layoutModal.has(h)));
const declared = declaredModalRoutes(menuRaw);
const missing = [...expected].filter((h) => !declared.has(h));
const extra = [...declared].filter((h) => !expected.has(h));
ok('MODAL_ROUTES lists every modal route the menu opens', missing.length === 0, `missing: ${missing.join(', ')}`);
ok('MODAL_ROUTES lists nothing that is pushed (a dead beat)', extra.length === 0, `not modal / not in OPTIONS: ${extra.join(', ')}`);

// ── 2. CreateMenu flow ──────────────────────────────────────────────────────

const goBody = menu.match(/const go = useCallback\(([\s\S]*?)\n  \}, \[/)?.[1] ?? '';
ok('go(): a non-modal row navigates, THEN closes', /if \(!presentsModal\) \{\s*nav\(\);\s*handleClose\(\);\s*return;/.test(goBody));
ok('go(): a modal row is parked for onDismiss + a timeout fallback', /pendingNav\.current = nav;[\s\S]*setTimeout\(runPending/.test(goBody));
ok('the Modal runs the parked navigation from onDismiss', /onDismiss=\{runPending\}/.test(menu));
ok('runPending clears before it runs (exactly once)', /pendingNav\.current = null;\s*nav\?\.\(\);/.test(menu));
ok('no router.push waits on a fixed 280 ms timer any more', !/setTimeout\(\(\) => \{\s*router\.push/.test(menu));
ok('the sheet fades, never slides', /animationType="fade"/.test(menu) && !/animationType=\{?["']slide/.test(menu));
ok('the card rises (phone) / pops in (desktop web) and crossfades list <-> picker',
  /<Animated\.View style=\{\[styles\.sheet,[^\n]*desktopWeb \? webMotion\('popIn'\) : rise, swap\]\}>/.test(menu));

// ── 3. Tabs ─────────────────────────────────────────────────────────────────

const tabs = code('app/(tabs)/_layout.tsx');
ok('phone tabs cross-fade; Reduce Motion zeroes the fade instead of switching it off (switching remounts every iOS tab)', /animation: 'fade',/.test(tabs) && !/animation: reduced/.test(tabs));
ok('the fade uses the swap duration with an ease-out (not the 150 ms linear stock spec)',
  /transitionSpec:\s*\{\s*animation: 'timing',\s*config: \{ duration: reduced \? 0 : Motion\.duration\.swap, easing: Easing\.out\(Easing\.cubic\) \}/.test(tabs));
ok('desktop scenes fade in with the web fadeIn keyframe', /sceneStyle: [^\n]*webMotion\('fadeIn'\)/.test(tabs));
ok('the tab icon has no bounce (no bounciness, no 1.08 overshoot)', !/bounciness/.test(tabs) && !/1\.08/.test(tabs));
ok('the tab focus springs on Motion.spring.rise with the shared driver flag',
  /Animated\.spring\(focus, \{[\s\S]*?\.\.\.Motion\.spring\.rise,[\s\S]*?useNativeDriver: nativeDriver/.test(tabs));

// ── 4. Brain FAB ────────────────────────────────────────────────────────────

const fab = code('components/brain/BrainFab.tsx');
ok('the FAB does not breathe (no Animated.loop)', !/Animated\.loop/.test(fab));
ok('no accent glow (shadowColor: colors.accent)', !/shadowColor:\s*colors\./.test(fab));
ok('the neutral Shadow.medium elevation', /\.\.\.Shadow\.medium/.test(fab));
ok('no friction / tension / bounciness springs', !/\b(friction|tension|bounciness):/.test(fab));
ok('press springs to 0.94 on Motion.spring.snap', /toValue: 0\.94, \.\.\.Motion\.spring\.snap/.test(fab));
ok('hide/show springs on Motion.spring.rise', /Animated\.spring\(anim, \{ toValue, \.\.\.Motion\.spring\.rise/.test(fab));
ok('a lift glides through translateY = hide/show + liftOffset (rests at 0)',
  /translateY: Animated\.add\(anim\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[48, 0\] \}\), liftOffset\)/.test(fab));
ok('the lift offset takes up the jump the same frame (added to any offset still in flight), then springs to 0',
  /liftOffset\.stopAnimation\(\);\s*liftOffset\.setValue\(liftNow\.current \+ delta\);\s*Animated\.spring\(liftOffset, \{ toValue: 0/.test(fab)
  && /liftOffset\.addListener\(\(\{ value \}\) => \{ liftNow\.current = value; \}\)/.test(fab));

// ── 5. AlertHost ────────────────────────────────────────────────────────────

const alert = code('components/AlertHost.tsx');
ok('the last alert stays displayed on desktop web while it fades out',
  /const shown = current \?\? \(desktopWeb \? lastRef\.current : null\);/.test(alert) && /if \(!shown\) return null;/.test(alert));
ok('the prompt input reseeds only when a new alert is current (the fade-out copy keeps its text)',
  /if \(current\) setText\(current\.prompt\?\.defaultValue \?\? ''\);/.test(alert));
ok('the Modal is visible only while an alert is current', /<Modal visible=\{current !== null\}/.test(alert));
ok('close() is inert on a null current', /const close = useCallback\(\(btn\?: AlertButton\) => \{\s*if \(!current\) return;/.test(alert));
ok('onDismiss is inert on a null current', /const onDismiss = useCallback\(\(\) => \{\s*if \(!current\) return;/.test(alert));
ok('the card style is a ternary (no trailing null on a phone)', /style=\{popIn \? \[styles\.card, popIn\] : styles\.card\}/.test(alert));

// ── 6. UniversalSearch ──────────────────────────────────────────────────────

const search = code('components/UniversalSearch.tsx');
ok('Cmd+K fades on desktop web, slides on a phone', /animationType=\{desktopWeb \? 'fade' : 'slide'\}/.test(search));
ok('the pop-in is appended only when present (phone array unchanged)', /\.\.\.\(popIn \? \[popIn\] : \[\]\)/.test(search));

if (failed) {
  console.log(`\n✗ smooth-l2-shell-guard: ${failed} failed`);
  process.exit(1);
}
console.log('\n✓ smooth-l2-shell-guard: the shell fades, springs and glides — no bounce, no glow, no dead beat');
