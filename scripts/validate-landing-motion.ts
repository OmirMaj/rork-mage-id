// validate-landing-motion.ts — the landing's guard (slick round 3, lane C).
//
//   bun run scripts/validate-landing-motion.ts        (package.json: test:landing-motion)
//
// A skeleton that was actually on screen hands over to its content with a
// short fade, and the first rows of the most-visited lists land on a short
// stagger (components/animations/Landing.tsx). At rest NOTHING may change, and
// the empty state arrives once and then sits still. Text-only (the files
// import react-native, which bun cannot load):
//
//   1. Landing.tsx arms only on a loading phase ≥ LANDING_MIN_LOADING_MS by
//      Date.now(), honours Reduce Motion, caps the rows (ROWS), drops rows
//      first asked for after LANDING_WINDOW_MS, passes nativeDriver (never a
//      literal true), and gives web rows no translateY.
//   2. Each adopting screen calls useLanding( BEFORE its `if (isLoading)`
//      early return (a hook after an early return breaks the rules of hooks).
//   3. The three discover lists and mage-id-bids wrap their rows in a
//      LandingSlot fed by the row getter; in mage-id-bids ONLY the
//      filteredBrowse map does (the location-unknown list restarts at index 0
//      and would run a second cascade at once).
//   4. Every screen-root LandingSlot passes `fill` (the roots are flex: 1 and
//      a bare wrapper would collapse them): Summary ×4 including its desktop
//      return, Home's contractor root and both persona roots.
//   5. EmptyState: no Animated.loop, no pulse, no literal useNativeDriver:
//      true; it rises on Motion.spring.rise and honours Reduce Motion.
//   6. RATCHET: `Animated.loop(` in components/EmptyState.tsx stays at 0.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Blank out comments (strings kept), preserving offsets. From validate-motion.ts. */
export function stripComments(src: string): string {
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

const failures: string[] = [];
let checks = 0;
function check(ok: boolean, msg: string) {
  checks++;
  if (!ok) failures.push(msg);
}
const count = (s: string, re: RegExp) => (s.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? []).length;

// ── 1. Landing.tsx ────────────────────────────────────────────────────────
const LANDING = 'components/animations/Landing.tsx';
const landing = stripComments(read(LANDING));
check(/export const LANDING_MIN_LOADING_MS = 120\b/.test(landing), `${LANDING}: LANDING_MIN_LOADING_MS must be exported as 120`);
check(/Date\.now\(\) - loadingSince\.current >= LANDING_MIN_LOADING_MS/.test(landing), `${LANDING}: arming must compare Date.now() - loadingSince against LANDING_MIN_LOADING_MS`);
check(/!armed\.current\s*&&/.test(landing), `${LANDING}: arming must be once per mount (guarded on !armed.current)`);
check(/&& !reduce\b/.test(landing) && /\buseReducedMotion\(\)/.test(landing) && /\breducedMotion\(\)/.test(landing),
  `${LANDING}: Reduce Motion must gate arming (useReducedMotion) and each start (reducedMotion())`);
check(/export const ROWS = \d+/.test(landing) && /index >= rowsCap\.current/.test(landing), `${LANDING}: rows must be capped at ROWS`);
check(/export const LANDING_WINDOW_MS = \d+/.test(landing) && /since > LANDING_WINDOW_MS/.test(landing), `${LANDING}: rows first asked for after LANDING_WINDOW_MS must be dropped`);
check(!/useNativeDriver:\s*true/.test(landing), `${LANDING}: never a literal useNativeDriver: true (pass nativeDriver)`);
check(count(landing, /useNativeDriver: nativeDriver/) >= 3, `${LANDING}: every Animated call (fade timing, row timing, row spring) passes nativeDriver`);
check(/Motion\.spring\.rise/.test(landing), `${LANDING}: the row rise must use Motion.spring.rise`);
check(!/bounciness|friction|Easing\.bounce|Easing\.elastic|react-native-reanimated|from 'moti'/.test(landing), `${LANDING}: no bounciness/friction/bounce/elastic, no reanimated/moti`);
{
  // The web branch: `rise` exists only off the web, and the transform only with it.
  const webGate = /const rise = web \? null : new Animated\.Value\(/.test(landing);
  const onlyWithRise = /\(rise\s*\?\s*\{ opacity, transform: \[\{ translateY: rise \}\] \}\s*:\s*\{ opacity \}\)/.test(landing);
  check(webGate && onlyWithRise && count(landing, /translateY/) === 1,
    `${LANDING}: web rows must be opacity-only (translateY only when rise exists, rise null on web)`);
}
check(/const FILL: ViewStyle = \{ flex: 1 \}/.test(landing) && /fill \? \[FILL, style\] : style/.test(landing), `${LANDING}: LandingSlot fill must add { flex: 1 }`);
check(/if \(!style\) return <>\{children\}<\/>;/.test(landing), `${LANDING}: an unarmed LandingSlot must render its children alone`);

// ── 2–4. The adopting screens ─────────────────────────────────────────────
function hookBeforeEarlyReturn(rel: string, hook: RegExp) {
  const src = stripComments(read(rel));
  const h = src.search(hook);
  check(h >= 0, `${rel}: must call useLanding(isLoading)`);
  const early = src.search(/\n  if \(isLoading\) \{/);
  if (early >= 0) check(h >= 0 && h < early, `${rel}: useLanding( must come BEFORE the \`if (isLoading)\` early return`);
  return src;
}

const SUMMARY = 'app/(tabs)/summary/index.tsx';
const summary = hookBeforeEarlyReturn(SUMMARY, /const landing = useLanding\(isLoading\);/);
check(count(summary, /<LandingSlot style=\{landing\.fade\} fill>/) === 4, `${SUMMARY}: all four roots after the skeleton (sourceFailed, empty, desktop, phone) wrap in <LandingSlot style={landing.fade} fill>`);
check(count(summary, /<LandingSlot\b/) === 4, `${SUMMARY}: no other LandingSlot (no row cascade on Summary)`);
{
  const desk = summary.search(/if \(isDesktop\) \{\s*return \(\s*<LandingSlot style=\{landing\.fade\} fill>/);
  check(desk >= 0, `${SUMMARY}: the isDesktop return must be wrapped too`);
}
{
  // The skeleton itself is never wrapped.
  const early = summary.search(/\n  if \(isLoading\) \{/);
  const block = early >= 0 ? summary.slice(early, summary.indexOf('\n  }\n', early)) : '';
  check(early >= 0 && !/LandingSlot/.test(block), `${SUMMARY}: the skeleton return must not be wrapped`);
}

const HOME = 'app/(tabs)/(home)/index.tsx';
const home = hookBeforeEarlyReturn(HOME, /const landing = useLanding\(isLoading\);/);
check(/return <LandingSlot style=\{landing\.fade\} fill><ClientHome \/><\/LandingSlot>;/.test(home), `${HOME}: the client persona root must be wrapped with fill`);
check(/return <LandingSlot style=\{landing\.fade\} fill><PropertyManagerHome \/><\/LandingSlot>;/.test(home), `${HOME}: the property-manager persona root must be wrapped with fill`);
check(/return \(\s*<LandingSlot style=\{landing\.fade\} fill>\s*<View style=\{\[styles\.container, \{ backgroundColor: themeColors\.bg \}\]\}>\s*<FlatList/.test(home), `${HOME}: the contractor FlatList root must be wrapped with fill`);
check(count(home, /<LandingSlot\b/) === 3, `${HOME}: exactly three LandingSlots (no row wraps: ProjectCard cascades on its own)`);
check(!/landing\.row\(/.test(home), `${HOME}: project rows are never wrapped`);

const LISTS: [string, string][] = [
  ['app/(tabs)/discover/bids.tsx', 'renderBid'],
  ['app/(tabs)/discover/companies.tsx', 'renderCompany'],
  ['app/(tabs)/discover/hire.tsx', 'renderJob'],
];
for (const [rel, fn] of LISTS) {
  const src = hookBeforeEarlyReturn(rel, /const \{ row: landingRow \} = useLanding\(isLoading\);/);
  const at = src.indexOf(`const ${fn} = useCallback(`);
  const end = at >= 0 ? src.indexOf('\n  ), [', at) : -1;
  const body = at >= 0 && end > at ? src.slice(at, src.indexOf('\n', end + 1)) : '';
  check(/\(\{ item, index \}/.test(body), `${rel}: ${fn} must take ({ item, index })`);
  check(/<LandingSlot style=\{landingRow\(index\)\}>/.test(body), `${rel}: ${fn} must wrap its row in <LandingSlot style={landingRow(index)}>`);
  check(/\], \[[^\]]*\blandingRow\]\);|, landingRow\]\);/.test(body), `${rel}: ${fn}'s deps must include landingRow (it is stable)`);
  check(!/fill/.test(body), `${rel}: a row wrap never passes fill`);
  const hire = rel.endsWith('hire.tsx');
  if (hire) {
    const gate = src.search(/\n  if \(!HIRE_ENABLED\) \{/);
    const h = src.search(/useLanding\(isLoading\)/);
    check(gate < 0 || (h >= 0 && h < gate), `${rel}: useLanding( must come before the HIRE_ENABLED early return`);
  }
}

const BIDS = 'app/(tabs)/mage-id-bids/index.tsx';
{
  const src = hookBeforeEarlyReturn(BIDS, /const landing = useLanding\(isLoading\);/);
  const iso = src.search(/const isLoading = mode === 'browse'/);
  const h = src.search(/const landing = useLanding\(isLoading\);/);
  const ret = src.indexOf('\n  return (', iso);
  check(iso >= 0 && h > iso && h < ret, `${BIDS}: useLanding(isLoading) must come after isLoading and before the return`);
  check(/filteredBrowse\.map\(\(r, i\) => \(\s*<LandingSlot key=\{r\.id\} style=\{landing\.row\(i\)\}>\{renderBrowseCard\(r\)\}<\/LandingSlot>\s*\)\)/.test(src),
    `${BIDS}: the filteredBrowse map must wrap each card in <LandingSlot key={r.id} style={landing.row(i)}>`);
  check(/locationUnknownBrowse\.map\(r => renderBrowseCard\(r\)\)/.test(src), `${BIDS}: the locationUnknownBrowse map must stay unwrapped`);
  check(count(src, /landing\.row\(/) === 1, `${BIDS}: landing.row( appears exactly once (filteredBrowse only; not 'mine', not location-unknown)`);
  const card = src.indexOf('const renderBrowseCard = useCallback(');
  const cardEnd = src.indexOf('\n  }, [', card);
  check(card >= 0 && cardEnd > card && !/LandingSlot|landing\./.test(src.slice(card, cardEnd)), `${BIDS}: renderBrowseCard itself is unchanged`);
}

// ── 5–6. EmptyState ───────────────────────────────────────────────────────
const EMPTY = 'components/EmptyState.tsx';
{
  const raw = read(EMPTY);
  const src = stripComments(raw);
  const loops = count(src, /Animated\.loop\(/);
  const BASELINE_LOOPS = 0;
  check(loops <= BASELINE_LOOPS, `${EMPTY}: RATCHET — Animated.loop( count is ${loops}, baseline ${BASELINE_LOOPS} (the halo never breathes)`);
  check(!/\bpulse\b/.test(src), `${EMPTY}: no pulse value`);
  check(!/haloScale|haloOpacity/.test(src), `${EMPTY}: no halo interpolations`);
  check(!/useNativeDriver:\s*true/.test(src), `${EMPTY}: never a literal useNativeDriver: true`);
  check(count(src, /useNativeDriver: nativeDriver/) === 2, `${EMPTY}: both entrance animations pass nativeDriver`);
  check(/Animated\.spring\(rise, \{ toValue: 0, \.\.\.Motion\.spring\.rise/.test(src), `${EMPTY}: the rise uses Motion.spring.rise`);
  check(/reducedMotion\(\)/.test(src) && /if \(reducedMotion\(\)\) \{\s*enter\.setValue\(1\);\s*rise\.setValue\(0\);\s*return;/.test(src), `${EMPTY}: Reduce Motion rests both values and animates nothing`);
  check(/const ENTER_RISE = 12;/.test(src), `${EMPTY}: the rise starts at 12 (first-frame golden unchanged)`);
  check(/const HALO_OPACITY = 0\.6;/.test(src) && /styles\.halo, \{ backgroundColor: accentColor \+ '14', opacity: HALO_OPACITY \}/.test(src), `${EMPTY}: the halo is static at opacity 0.6`);
  check(!/transform: \[\{ scale/.test(src), `${EMPTY}: the halo carries no transform`);
  check(!/bounciness|friction|Easing\.bounce|Easing\.elastic/.test(src), `${EMPTY}: no bounciness/friction/bounce/elastic`);
}

if (failures.length) {
  console.error(`validate-landing-motion: ${failures.length} of ${checks} checks FAILED`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.info(`validate-landing-motion: ${checks} checks passed`);
