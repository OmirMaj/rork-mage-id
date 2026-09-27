#!/usr/bin/env bun
/**
 * validate-front-door-motion — slick round 3, the front door.
 *
 * Text-only (no React). A list of named SECTIONS; lane A1 owns the first ones
 * (the cold-start hand-off and the reload veil), lane A2 appends its own
 * section for the auth-screen form motion at the end of SECTIONS.
 *
 *   bun run scripts/validate-front-door-motion.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOADER } from '../utils/levelTimeline';
import * as Stage from '../components/launch/splashStage';
const { splashWordmarkBox } = Stage;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Copied from scripts/validate-motion.ts: comments blanked, strings and newlines kept. */
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
    i++;
  }
  return out.join('');
}

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : '')); }
}

const code = (rel: string) => stripComments(read(rel));
const num = (src: string, name: string): number | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(\\d+(?:\\.\\d+)?)\\b`).exec(src);
  return m ? Number(m[1]) : null;
};
const zeta = (d: number, s: number, m: number) => d / (2 * Math.sqrt(s * m));

/** Motion.spring presets, parsed from constants/designTokens.ts. */
function motionSprings(): Record<string, { damping: number; stiffness: number; mass: number }> {
  const src = code('constants/designTokens.ts');
  const block = /spring:\s*\{([\s\S]*?)\n\s{2}\},/.exec(src)?.[1] ?? '';
  const out: Record<string, { damping: number; stiffness: number; mass: number }> = {};
  for (const m of block.matchAll(/(\w+):\s*\{\s*damping:\s*([\d.]+),\s*stiffness:\s*([\d.]+),\s*mass:\s*([\d.]+)\s*\}/g)) {
    out[m[1]] = { damping: Number(m[2]), stiffness: Number(m[3]), mass: Number(m[4]) };
  }
  return out;
}

/**
 * Every spring in `src`: each `Animated.spring(…, { … })` config must spread a
 * Motion.spring preset or a local const whose ζ is in range, or carry inline
 * damping/stiffness/mass in range. Every `{ damping, stiffness, mass }` literal
 * in the file is checked as well. Returns the problems.
 */
function springProblems(file: string, src: string): string[] {
  const presets = motionSprings();
  const problems: string[] = [];
  const inRange = (z: number) => z >= 0.75 && z <= 1.05;
  const literal = /\{\s*(?:toValue:[^,}]+,\s*)?damping:\s*([\d.]+),\s*stiffness:\s*([\d.]+),\s*mass:\s*([\d.]+)/g;
  for (const m of src.matchAll(literal)) {
    const z = zeta(Number(m[1]), Number(m[2]), Number(m[3]));
    if (!inRange(z)) problems.push(`${file}: spring ζ=${z.toFixed(2)} (damping ${m[1]}, stiffness ${m[2]}, mass ${m[3]})`);
  }
  for (const m of src.matchAll(/Animated\.spring\(\s*[^,]+,\s*\{([^}]*)\}/g)) {
    const cfg = m[1];
    const preset = /\.\.\.Motion\.spring\.(\w+)/.exec(cfg);
    const local = /\.\.\.([A-Z][A-Z0-9_]+)\b/.exec(cfg);
    if (preset) {
      const p = presets[preset[1]];
      if (!p) problems.push(`${file}: unknown Motion.spring.${preset[1]}`);
      else if (!inRange(zeta(p.damping, p.stiffness, p.mass))) problems.push(`${file}: Motion.spring.${preset[1]} out of range`);
    } else if (local) {
      const def = new RegExp(`const\\s+${local[1]}\\s*=\\s*\\{\\s*damping:\\s*([\\d.]+),\\s*stiffness:\\s*([\\d.]+),\\s*mass:\\s*([\\d.]+)`).exec(src);
      if (!def) problems.push(`${file}: spring spreads ${local[1]}, which is not a { damping, stiffness, mass } const`);
      else if (!inRange(zeta(Number(def[1]), Number(def[2]), Number(def[3])))) problems.push(`${file}: ${local[1]} ζ out of range`);
    } else if (!/damping:/.test(cfg)) {
      problems.push(`${file}: a spring with no damping/stiffness/mass and no preset`);
    }
  }
  if (/\bbounciness\s*:|\bfriction\s*:|Easing\.bounce|Easing\.elastic/.test(src)) problems.push(`${file}: bounciness / friction / bounce / elastic`);
  return problems;
}

type Section = { name: string; run: () => void };

/** The splash wordmark: Type.serifTitle (28 / 34 in the display face — Barlow since the 2026-09-16 rebrand; it
 *  was Fraunces 28 / 32) with 3.4 tracking, in NATIVE_SPLASH_FG. The 32 pt splashWordmarkBox is bottom-anchored
 *  and centres its text, so the 2 pt taller line box overflows it by 1 pt each side and moves no pixel of the level. */
const WORDMARK_STYLE = /\.\.\.Type\.serifTitle,[^\n]*\n\s*letterSpacing: 3\.4,\s*color: NATIVE_SPLASH_FG/;
const serifTitle28 = () => /serifTitle:\s*\{[^}]*fontFamily: 'Barlow_600SemiBold', fontSize: 28, lineHeight: 34\b/.test(read('constants/typography.ts'));

const SECTIONS: Section[] = [
  {
    name: 'A1 — BrandSplash continues the native splash, holds for the app and hands off (lane LAUNCH)',
    run: () => {
      const raw = read('components/BrandSplash.tsx');
      const s = code('components/BrandSplash.tsx');
      ok('no settle glow (settleGlow / bubbleGlow are gone)', !/settleGlow|bubbleGlow/.test(s));
      ok('imports setLaunchPhase from the launch curtain',
        /import\s*\{[^}]*\bsetLaunchPhase\b[^}]*\}\s*from\s*'@\/components\/launch\/launchCurtain'/.test(s));
      ok('reads getBootReady() before exiting', /getBootReady\(\)/.test(s));
      ok("sets 'lifting' at the exit and 'open' in finish()",
        /setLaunchPhase\('lifting'\)/.test(s) && /doneRef\.current = true;[\s\S]{0,400}setLaunchPhase\('open'\)/.test(s));
      const exitMs = num(s, 'EXIT_MS');
      const max = num(s, 'SPLASH_MAX_LIFETIME_MS');
      const cap = num(s, 'FLY_CAP_MS');
      const fade = num(s, 'FLY_FADE_MS');
      ok(`SPLASH_MAX_LIFETIME_MS === 8000 === LOADER.splash.failsafeMs (${max}, ${LOADER.splash.failsafeMs})`,
        max === 8000 && LOADER.splash.failsafeMs === 8000);
      ok('no EXIT_BY_MS (the forced 2300 ms exit only ever uncovered a second loader)', !/EXIT_BY_MS/.test(s));
      ok('the exit is bounded by its own timer: setTimeout(finish, EXIT_MS + 50)', /setTimeout\(finish, EXIT_MS \+ 50\)/.test(s));
      ok(`EXIT_MS + 50 < SPLASH_MAX_LIFETIME_MS (${exitMs} + 50 < ${max})`, exitMs != null && max != null && exitMs + 50 < max);
      ok(`the fly's cap + cross-fade fit inside EXIT_MS (${cap} + ${fade} ≤ ${exitMs})`,
        cap != null && fade != null && exitMs != null && cap + fade <= exitMs);
      const ex = LOADER.splash.exit;
      ok(`the signed-in exit fits inside EXIT_MS (retractAtMs + retractSpanMs = ${ex.retractAtMs + ex.retractSpanMs} ≤ ${exitMs}; inkAtMs + inkMs = ${ex.inkAtMs + ex.inkMs})`,
        exitMs != null && ex.retractAtMs + ex.retractSpanMs <= exitMs && ex.inkAtMs + ex.inkMs <= exitMs);
      ok('the module-scope markLaunchPending() is guarded by JEST_WORKER_ID',
        /const UNDER_JEST = typeof process !== 'undefined' && process\.env\?\.JEST_WORKER_ID != null;\s*\nif \(!UNDER_JEST\) markLaunchPending\(\);/.test(s));
      ok('the ink is its own layer (the outer overlay no longer paints it)',
        /overlay:\s*\{(?![^}]*backgroundColor)[^}]*\}/.test(s) && /styles\.ink, \{ opacity: inkOpacity \}/.test(s));
      ok('the ink is NATIVE_SPLASH_BG', /ink:\s*\{\s*backgroundColor: NATIVE_SPLASH_BG,?\s*\}/.test(s));
      ok('no expo-haptics import (a launch is not a success event)', !/expo-haptics/.test(s) && !/Haptics\./.test(s));
      ok('no hex colour literal in BrandSplash.tsx (NATIVE_SPLASH_* + the derived accent only)', !/#[0-9a-fA-F]{3,8}\b/.test(s));
      ok('no Animated.delay( (delays are plateaus baked into easing)', !/Animated\.delay\(/.test(s));
      const springs = [...s.matchAll(/Animated\.spring\(\s*(\w+)/g)].map((m) => m[1]);
      ok(`the only spring is the wordmark fly (springs on: ${springs.join(', ') || 'none'})`,
        springs.length === 1 && springs[0] === 'fly' && !/BUBBLE_SPRING|bubbleX/.test(s));
      ok('LevelMark is rendered with tone="splash" and revealDelayMs={0} (no <Image> of the PNG)',
        /<LevelMark\s+tone="splash"[\s\S]{0,200}revealDelayMs=\{0\}/.test(s) && !/<Image\b/.test(s));
      ok('LevelMark animate is tied to the reduce-motion probe (never a bare literal true)',
        /animate=\{reduceMotion !== true\}/.test(s) && !/animate=\{true\}/.test(s));
      ok('the level sits at splashRect(width, height, Platform.OS)', /splashRect\(width, height, Platform\.OS\)/.test(s));
      // The probe frame is gone: no early `return <View …/>` of bare ink before the level renders.
      const firstLevel = s.indexOf('<LevelMark');
      const earlyReturn = /return\s*\(?\s*<(Animated\.)?View\b/.exec(s);
      ok('no early return of a bare ink View before the LevelMark renders (the probe frame is gone)',
        firstLevel > 0 && (earlyReturn == null || earlyReturn.index > s.lastIndexOf('return (', firstLevel) - 1)
        && !/if \(reduceMotion === null\) \{?\s*return/.test(s));
      ok('a setInterval readiness backstop exists and is cleared',
        /const backstop = setInterval\(tryExit, READY_BACKSTOP_MS\)/.test(s) && /clearInterval\(backstop\)/.test(s) && num(s, 'READY_BACKSTOP_MS') === 500);
      ok('the fast-boot line comes from LOADER.splash.aliveAtMs (levelTimeline is RN-free)',
        /const ALIVE_MS = SPLASH\.aliveAtMs;/.test(s) && /const SPLASH = LOADER\.splash;/.test(s)
        && /from '@\/utils\/levelTimeline'/.test(s) && LOADER.splash.aliveAtMs === 400);
      ok('the `live` and `onFirstFrame` props exist (live defaults to true)',
        /live\?: boolean;/.test(s) && /onFirstFrame\?: \(\) => void;/.test(s) && /\{ onDone, live = true, onFirstFrame \}/.test(s));
      ok('onFirstFrame fires once, from the root onLayout plus one requestAnimationFrame',
        /onLayout=\{onRootLayout\}/.test(s) && /requestAnimationFrame\(\(\) => onFirstFrameRef\.current\?\.\(\)\)/.test(s));
      ok('BrandSplash neither imports nor calls useTheme (it renders outside ThemeProvider)',
        !/useTheme/.test(s) && !/ThemeContext/.test(s));
      ok('it publishes the stage: alive, hue, wordmark, finished',
        /setSplashStage\(\{ alive: true \}\)/.test(s) && /setSplashStage\(\{ hue: true \}\)/.test(s)
        && /setSplashStage\(\{ wordmark: true \}\)/.test(s) && /setSplashStage\(\{ finished: true \}\)/.test(s));
      ok('finish(): doneRef → overlayOpacity 0 → setSplashStage finished → open → onDone()',
        /doneRef\.current = true;[\s\S]{0,400}overlayOpacity\.setValue\(0\);[\s\S]{0,300}setSplashStage\(\{ finished: true \}\);[\s\S]{0,200}setLaunchPhase\('open'\);\s*onDone\(\);/.test(s));
      ok('the wordmark box is the shared splashWordmarkBox(rect); Type.serifTitle (Barlow 28/34) + 3.4 tracking, NATIVE_SPLASH_FG',
        /splashWordmarkBox\(rect\)/.test(s) && WORDMARK_STYLE.test(s) && serifTitle28());
      ok('the eyebrow, the 44 pt wordmark and the old literals are gone',
        !/THE OPERATING SYSTEM FOR BUILDERS/.test(raw) && !/fontSize: 44/.test(s)
        && !/\b(INK|CREAM|FOG|AMBER|AMBER_SOFT|LINE|NOTCH|T_LABEL|T_TRACK|T_BUBBLE|BUBBLE_START_X|REDUCED_HOLD_MS)\b/.test(s));
      ok('the hue layer is the derived accent, only when it differs from the baked orange',
        /deriveAccentPalette\(getCustomPrimary\(\), 'dark'\)\.accent/.test(s) && /toUpperCase\(\) !== NATIVE_SPLASH_ACCENT/.test(s));
    },
  },
  {
    name: 'A1 — BootShell is a still replica until BrandSplash finishes, then adopts its stage (lane LAUNCH)',
    run: () => {
      const b = code('components/loaders/BootShell.tsx');
      ok('subscribes to the splash stage (useSplashStage)', /const stage = useSplashStage\(\);/.test(b));
      ok('adopts only on stage.finished while the app is not ready', /if \(!stage\.finished \|\| adopted \|\| getBootReady\(\)\) return;/.test(b));
      const sets = [...b.matchAll(/\.setValue\(1\)/g)].length;
      ok('amp.setValue(1) only on the adopted-alive path', /if \(stage\.alive\) amp\.setValue\(1\);/.test(b)
        && (b.match(/amp\.setValue\(/g) ?? []).length === 1, `${sets} .setValue(1)`);
      ok('no timer at all (nothing can start before `finished`; the +500 ms wordmark is a plateau)',
        !/setTimeout|setInterval|requestAnimationFrame/.test(b) && /plateau\(LOADER\.splash\.wordmarkAtMs \/ total, DECELERATE\)/.test(b));
      ok('no useTheme (NATIVE_SPLASH_* + Type only)', !/useTheme/.test(b));
      ok('the same splashRect, LevelMark tone and wordmark box as BrandSplash',
        /splashRect\(width, height, Platform\.OS\)/.test(b) && /tone="splash"/.test(b) && /splashWordmarkBox\(rect\)/.test(b)
        && WORDMARK_STYLE.test(b));
      ok('holds the shared clock from mount (animate={!reduce}); a11y progressbar "Loading MAGE ID"',
        /animate=\{!reduce\}/.test(b) && /accessibilityRole="progressbar"/.test(b) && /accessibilityLabel="Loading MAGE ID"/.test(b));
      ok('no hex colour literal', !/#[0-9a-fA-F]{3,8}\b/.test(b));
      const box = splashWordmarkBox({ markTop: 420.2, markH: 168.1 * 30 / 438 });
      ok(`splashWordmarkBox: bottom edge 28 pt above the level's centre (${(box.top + box.height).toFixed(2)})`,
        Math.abs(box.top + box.height - (420.2 + (168.1 * 30 / 438) / 2 - 28)) < 1e-9 && box.height === 32 && box.left === 0 && box.right === 0);
      // The stage store: all false at first; merge; notify ONLY on a change; reset clears.
      Stage.__resetSplashStageForTests();
      let calls = 0;
      const off = Stage.subscribeSplashStage(() => { calls++; });
      const s0 = Stage.getSplashStage();
      ok('splashStage starts all false', !s0.alive && !s0.wordmark && !s0.hue && !s0.finished);
      Stage.setSplashStage({ alive: true });
      Stage.setSplashStage({ alive: true });
      const s1 = Stage.getSplashStage();
      ok('setSplashStage merges and notifies once per real change (a new object only then)',
        calls === 1 && s1.alive && !s1.wordmark && s1 !== s0);
      Stage.setSplashStage({ wordmark: true, alive: true });
      ok('a patch keeps the other flags', calls === 2 && Stage.getSplashStage().alive && Stage.getSplashStage().wordmark);
      Stage.setSplashStage({});
      ok('an empty patch does not notify', calls === 2 && Stage.getSplashStage() === Stage.getSplashStage());
      off();
      Stage.__resetSplashStageForTests();
      ok('__resetSplashStageForTests restores all false', !Stage.getSplashStage().alive && !Stage.getSplashStage().wordmark);
    },
  },
  {
    name: 'A1 — the launch curtain can never stay down',
    run: () => {
      const c = code('components/launch/launchCurtain.ts');
      ok("the phase defaults to 'open'", /let phase: LaunchPhase = 'open';/.test(c));
      ok('a heal timer exists, and heal() stores open AND notifies',
        /setTimeout\(heal,/.test(c) && /function heal\(\): void \{[\s\S]{0,200}phase = 'open';\s*notify\(\);/.test(c));
      ok('the clock read reopens a stale curtain', /Date\.now\(\) - coveredAt > LAUNCH_STALE_MS\) return 'open'/.test(c));
      ok('memory only (no AsyncStorage)', !/AsyncStorage/.test(c));
      const stale = num(c, 'LAUNCH_STALE_MS');
      const max = num(code('components/BrandSplash.tsx'), 'SPLASH_MAX_LIFETIME_MS');
      ok(`LAUNCH_STALE_MS (${stale}) > SPLASH_MAX_LIFETIME_MS (${max})`, stale != null && max != null && stale > max);
    },
  },
  {
    name: 'A1 — springs, drivers and easing in every front-door file',
    run: () => {
      const files = [
        'components/BrandSplash.tsx', 'app/login.tsx', 'app/signup.tsx', 'components/auth/authMotion.tsx',
        'components/launch/launchCurtain.ts', 'components/launch/ReloadVeil.tsx',
      ];
      const problems = files.flatMap((f) => springProblems(f, code(f)));
      ok('every spring has ζ in [0.75, 1.05]; no bounciness / friction / bounce / elastic', problems.length === 0, problems.join('\n        '));
      // Lane A2 converted login/signup (the shake and the press-scale timing are
      // gone), so every front-door file is held to it now.
      const literal = files.filter((f) => /useNativeDriver:\s*true/.test(code(f)));
      ok('no `useNativeDriver: true` literal (nativeDriver from motion.ts instead)', literal.length === 0, literal.join(', '));
    },
  },
  {
    name: 'A1 — _layout wires the curtain and the veil',
    run: () => {
      const l = code('app/_layout.tsx');
      const ready = l.indexOf('setBootReady(!bootstrapping)');
      const loader = l.indexOf("if (navMode === 'loader')");
      ok('setBootReady( runs above the loader early return', ready >= 0 && loader > ready);
      ok("renders <ReloadVeil active={navMode === 'stack+overlay'} />", /<ReloadVeil active=\{navMode === 'stack\+overlay'\} \/>/.test(l));
      ok('the inline reload overlay is gone from _layout', !/testID="root-nav-reload-overlay"/.test(l));
      const v = code('components/launch/ReloadVeil.tsx');
      ok('the veil renders nothing until it has been active', /if \(!mounted\) return null;/.test(v) && /useState\(active\)/.test(v));
      ok('the veil waits VEIL_GRACE_MS before it shows', /setTimeout\(show, VEIL_GRACE_MS\)/.test(v));
      ok('the veil honours Reduce Motion', /reducedMotion\(\)/.test(v));
      ok('the veil draws the plain level: <ScreenLoader revealDelayMs={0} /> (no "MAGE ID" crane)',
        /<ScreenLoader revealDelayMs=\{0\} \/>/.test(v) && !/CraneLoader/.test(v));
      ok('VEIL_MIN_MS = LOADER.gate.screen.minMs (500) gates the fade-out start',
        /const VEIL_MIN_MS = LOADER\.gate\.screen\.minMs;/.test(v) && LOADER.gate.screen.minMs === 500
        && /const hold = shownAtRef\.current \+ VEIL_MIN_MS - Date\.now\(\);\s*if \(hold > 0\) holdRef\.current = setTimeout\(fadeOut, hold\);/.test(v));
      ok('a re-activation during the hold cancels it', /A re-activation during the hold cancels it\.\s*\n\s*if \(holdRef\.current != null\) \{ clearTimeout\(holdRef\.current\);/.test(read('components/launch/ReloadVeil.tsx')));
    },
  },
  {
    name: 'A1 — login and signup adopt the entrance',
    run: () => {
      for (const [f, n] of [['app/login.tsx', 9], ['app/signup.tsx', 8]] as const) {
        const s = code(f);
        ok(`${f}: useLaunchEntrance(${n}) and useLaunchTarget()`,
          new RegExp(`useLaunchEntrance\\(${n}\\)`).test(s) && /useLaunchTarget\(\)/.test(s));
        ok(`${f}: the wordmark style is a ternary on showWordmark (the unarmed tree is unchanged)`,
          /style=\{entrance\.showWordmark \? styles\.\w+ : \[styles\.\w+, HIDDEN\]\}/.test(s));
        ok(`${f}: the wordmark takes onLayout only through layoutProps (absent at rest)`,
          /ref=\{launchTarget\.ref\}\s*\{\.\.\.launchTarget\.layoutProps\}/.test(s) && !/onLayout=\{launchTarget\.onLayout\}/.test(s));
        const slots = [...s.matchAll(/<Slot style=\{entrance\.slot\((\d+)\)\}>/g)].map((m) => Number(m[1]));
        ok(`${f}: slots 0…${n - 1}, each once`, slots.length === n && slots.every((x, i) => x === i), slots.join(','));
      }
    },
  },
  {
    name: 'A1 — authMotion entrance: unarmed at rest, Reduce Motion off',
    run: () => {
      const a = code('components/auth/authMotion.tsx');
      ok('reads Reduce Motion', /reducedMotion\(\)|useReducedMotion\(\)/.test(a));
      ok('Slot returns the children unchanged when the style is null',
        /if \(!style\) return <>\{children\}<\/>;/.test(a));
      ok('arming is decided once, from the launch phase at the first render',
        /const \[armed\] = useState\(\(\) => \{[\s\S]{0,200}getLaunchPhase\(\)[\s\S]{0,120}'covered'[\s\S]{0,40}'lifting'/.test(a));
      ok('useLaunchTarget hands out onLayout only when the first render saw a launch',
        /const \[live\] = useState\(\(\) => getLaunchPhase\(\) !== 'open'\)/.test(a) && /live \? \{ onLayout \} : \{\}/.test(a));
      ok('a local LAUNCH_STALE_MS timer heals and re-renders', /setHealed\(true\)/.test(a) && /LAUNCH_STALE_MS\)/.test(a));
    },
  },
  // ── Lane A2 — the form motion ──────────────────────────────────────────────
  {
    name: 'A2 — errors are calm: no shake, the banner eases in, the offending field tints',
    run: () => {
      for (const f of ['app/login.tsx', 'app/signup.tsx']) {
        const s = code(f);
        ok(`${f}: no shakeAnim / translateX: shakeAnim / shake()`,
          !/shakeAnim/.test(s) && !/translateX:\s*shakeAnim/.test(s) && !/\bshake\(\)/.test(s));
        const sets = [...s.matchAll(/setErrorMessage\(/g)].length;
        ok(`${f}: setErrorMessage is called only inside setError, right after layoutNext()`,
          sets === 1 && /if \(flips\) layoutNext\(\);\s*\n\s*setErrorMessage\(msg\);/.test(s), `${sets} setErrorMessage( calls`);
        ok(`${f}: setError flips on SHOW / HIDE only (a ref of what is showing)`,
          /const flips = !!msg !== errorShownRef\.current;\s*errorShownRef\.current = !!msg;/.test(s));
        ok(`${f}: the banner is wrapped in Slot with a fade that is null at rest (useSwapFade)`,
          /const bannerFade = useSwapFade\(errorMessage\);/.test(s)
          && /<Slot style=\{bannerFade\}>\s*<View style=\{styles\.errorBanner\}>/.test(s));
        ok(`${f}: "Fill in every field." tints each EMPTY field (danger FieldRing)`,
          /setEmailDanger\(emailEmpty\);[\s\S]{0,120}setError\('Fill in every field\.'\)/.test(s)
          && /tone=\{emailDanger \? 'danger' : 'accent'\}/.test(s) && /tone=\{passwordDanger \? 'danger' : 'accent'\}/.test(s));
        ok(`${f}: an edit of a tinted field clears its tint`,
          /if \(emailDanger\) setEmailDanger\(false\);/.test(s) && /if \(passwordDanger\) setPasswordDanger\(false\);/.test(s));
        ok(`${f}: the error haptics are kept`,
          (s.match(/Haptics\.NotificationFeedbackType\.Error/g) ?? []).length >= 2);
      }
      const l = code('app/login.tsx');
      ok('login: "That email address looks off" tints the email field',
        /setEmailDanger\(true\);\s*setError\('That email address looks off/.test(l));
    },
  },
  {
    name: 'A2 — fields: a focus ring on every input row, the LAST child, danger outranks focus',
    run: () => {
      const rings = (s: string) => [...s.matchAll(/<FieldRing visible=\{([^}]*)\} tone=\{(\w+)Danger \? 'danger' : 'accent'\} radius=\{Tokens\.radius\.lg\} \/>\s*<\/View>/g)];
      const l = code('app/login.tsx');
      const s = code('app/signup.tsx');
      ok('login: 2 rings (email, password), each closing its input row', rings(l).length === 2, `${rings(l).length}`);
      ok('signup: 3 rings (name, email, password), each closing its input row', rings(s).length === 3, `${rings(s).length}`);
      ok('every ring is visible on focus OR danger',
        [...rings(l), ...rings(s)].every((m) => new RegExp(`\\|\\| ${m[2]}Danger$`).test(m[1].trim())));
      ok('focus is driven by onFocus / onBlur', (l.match(/onFocus=\{/g) ?? []).length === 2 && (s.match(/onFocus=\{/g) ?? []).length === 3
        && (l.match(/onBlur=\{/g) ?? []).length === 2 && (s.match(/onBlur=\{/g) ?? []).length === 3);
    },
  },
  {
    name: 'A2 — the commit morph and the press spring on the submit buttons',
    run: () => {
      const l = code('app/login.tsx');
      const s = code('app/signup.tsx');
      for (const [f, src, ids] of [['app/login.tsx', l, ['login-submit', 'login-magic-link']], ['app/signup.tsx', s, ['signup-submit']]] as const) {
        for (const id of ids) {
          const at = src.indexOf(`testID="${id}"`);
          const asb = src.lastIndexOf('<AuthSubmitButton', at);
          const plain = Math.max(src.lastIndexOf('<TouchableOpacity', at), src.lastIndexOf('<Pressable', at));
          ok(`${f}: ${id} is an <AuthSubmitButton>`, at > 0 && asb > plain);
        }
        ok(`${f}: the press is usePressSpring on the existing wrapper (no 80 ms timing scale)`,
          /const press = usePressSpring\(\);/.test(src) && /<Animated\.View style=\{press\.style\}>\s*<AuthSubmitButton/.test(src)
          && /onPressIn=\{press\.onPressIn\}/.test(src) && !/buttonScale/.test(src) && !/duration: 80\b/.test(src));
      }
      ok("login: 'done' right before goAfterSignIn (no hold), 'loading' while submitting",
        /setSignedIn\(true\);\s*goAfterSignIn\(\);/.test(l)
        && /const submitPhase = signedIn \? 'done' : isSubmitting \? 'loading' : 'idle';/.test(l));
      ok('login: the magic link morphs while it sends',
        /phase=\{isMagicLinkLoading \? 'loading' : 'idle'\}/.test(l));
      ok('signup: the check holds CONFIRM_HOLD_MS (0 under Reduce Motion), then the modal opens',
        num(s, 'CONFIRM_HOLD_MS') === 420
        && /setSubmitDone\(true\);\s*const hold = reducedMotion\(\) \? 0 : CONFIRM_HOLD_MS;/.test(s)
        && /setTimeout\(openConfirm, hold\)/.test(s)
        && /if \(!mountedRef\.current\) return;\s*setPendingEmail\(confirmedEmail\);\s*setShowConfirmModal\(true\);/.test(s));
      ok('signup: the hold timer is cleared on unmount',
        /mountedRef\.current = false;\s*if \(confirmTimerRef\.current\) clearTimeout\(confirmTimerRef\.current\);/.test(s));
    },
  },
  {
    name: 'A2 — the magic-link success and the password block ease in (login)',
    run: () => {
      const l = code('app/login.tsx');
      ok('layoutNext() before setMagicLinkSent(true)', /layoutNext\(\);\s*setMagicLinkSent\(true\);/.test(l));
      ok('…and before the reset, only when it WAS sent',
        /if \(magicLinkSent\) \{\s*layoutNext\(\);\s*setMagicLinkSent\(false\);\s*\}/.test(l)
        && (l.match(/setMagicLinkSent\(false\)/g) ?? []).length === 1);
      ok("the swap area fades with useSwapFade(magicLinkSent ? 'sent' : 'idle') in a Slot",
        /const magicSwap = useSwapFade\(magicLinkSent \? 'sent' : 'idle'\);/.test(l) && /<Slot style=\{magicSwap\}>/.test(l));
      ok('layoutNext() before setShowPasswordMode(true), the reveal armed by the toggle',
        /layoutNext\(\);\s*setShowPasswordMode\(true\);/.test(l) && /onPress=\{openPasswordMode\}/.test(l)
        && /<Slot style=\{passwordReveal \? passwordReveal\.style : null\}>/.test(l));
      ok('the reveal is 200 ms opacity + Motion.spring.rise over 8 pt; focus after 60 ms, native only',
        num(l, 'PASSWORD_REVEAL_MS') === 200 && num(l, 'PASSWORD_RISE') === 8 && num(l, 'PASSWORD_FOCUS_MS') === 60
        && /Animated\.spring\(passwordReveal\.translateY, \{ toValue: 0, \.\.\.Motion\.spring\.rise/.test(l)
        && /if \(Platform\.OS === 'web'\) return undefined;\s*const t = setTimeout\(\(\) => passwordRef\.current\?\.focus\(\), PASSWORD_FOCUS_MS\);/.test(l));
      ok('the reveal is never armed under Reduce Motion', /if \(!reducedMotion\(\)\) \{\s*const opacity = new Animated\.Value\(0\);/.test(l));
      ok("A1's slot 7 still wraps the password block", /<Slot style=\{entrance\.slot\(7\)\}>[\s\S]*<Slot style=\{passwordReveal/.test(l));
    },
  },
  {
    name: 'A2 — the signup hero is the login ink, not the accent',
    run: () => {
      const s = code('app/signup.tsx');
      const top = /topSection:\s*\{([^}]*)\}/.exec(s)?.[1] ?? '';
      ok("signup topSection paints '#0B0D10' (no accentFill background)", /backgroundColor:\s*'#0B0D10'/.test(top) && !/accentFill/.test(top), top.trim());
    },
  },
  {
    name: 'A2 — the confirm card rises into place',
    run: () => {
      const m = code('components/ConfirmEmailModal.tsx');
      ok('ConfirmEmailModal uses useRiseOnOpen(visible, 20)', /const rise = useRiseOnOpen\(visible, 20\);/.test(m));
      ok('both cards go through Card, whose rise style is LAST and which is a plain View at rest',
        (m.match(/<Card rise=\{rise\} style=\{styles\.card\}/g) ?? []).length === 2
        && /if \(!rise\) return <View style=\{style\}/.test(m) && /<Animated\.View style=\{\[style, rise\]\}/.test(m));
      ok('both Modals keep animationType="fade" (the scrim fades)', (m.match(/animationType="fade"/g) ?? []).length === 2);
      ok('no `useNativeDriver: true` in ConfirmEmailModal', !/useNativeDriver:\s*true/.test(m));
      const problems = springProblems('components/ConfirmEmailModal.tsx', m);
      ok('ConfirmEmailModal: every spring ζ in range; no bounciness / friction', problems.length === 0, problems.join('; '));
    },
  },
  {
    name: 'A2 — authMotion form pieces: null until armed, Reduce Motion, a11y',
    run: () => {
      const a = code('components/auth/authMotion.tsx');
      const ring = a.slice(a.indexOf('export function FieldRing'), a.indexOf('export type SubmitPhase'));
      ok('FieldRing returns null until armed', /if \(!armed\.current \|\| !opacity\.current\) return null;/.test(ring));
      ok('FieldRing arms on the first change of visible OR tone', /visible !== first\.current\.visible \|\| tone !== first\.current\.tone/.test(ring));
      ok('FieldRing: RING_MS 140, touch-through, hidden from a11y, reduce motion jumps',
        num(a, 'RING_MS') === 140 && /pointerEvents="none"/.test(ring) && /accessibilityElementsHidden/.test(ring)
        && /if \(reducedMotion\(\)\) \{ v\.setValue\(to\); return undefined; \}/.test(ring));
      const btn = a.slice(a.indexOf('export function AuthSubmitButton'), a.indexOf('export function usePressSpring'));
      ok('AuthSubmitButton arms only on a phase CHANGE against the committed phase',
        /if \(!armed\.current && phase !== committed\.current\)/.test(btn));
      ok('AuthSubmitButton unarmed idle renders leading + <Text style={textStyle}>{label}</Text> + trailing',
        /\{leading\}\s*<Text style=\{textStyle\}>\{label\}<\/Text>\s*\{trailing\}\s*<\/>\s*\);\s*\}/.test(btn));
      ok('AuthSubmitButton: MORPH_MS 140, SETTLE_MS 200, the check springs on Motion.spring.snap',
        num(a, 'MORPH_MS') === 140 && num(a, 'SETTLE_MS') === 200
        && /Animated\.spring\(v\.checkS, \{ toValue: 1, \.\.\.Motion\.spring\.snap/.test(btn));
      ok('AuthSubmitButton: both layers hidden from a11y; reduce motion jumps every value',
        (btn.match(/importantForAccessibility="no-hide-descendants"/g) ?? []).length === 2
        && /if \(reducedMotion\(\)\) \{\s*v\.labelO\.setValue/.test(btn));
      const ps = a.slice(a.indexOf('export function usePressSpring'));
      ok('usePressSpring: 0.97 on Motion.spring.snap; Reduce Motion never scales',
        num(a, 'PRESS_SCALE') === 0.97 && (ps.match(/\.\.\.Motion\.spring\.snap/g) ?? []).length === 2
        && /if \(reducedMotion\(\)\) return;/.test(ps) && /if \(reducedMotion\(\)\) \{ scale\.setValue\(1\); return; \}/.test(ps));
      ok('no reanimated / moti import', !/from 'react-native-reanimated'|from 'moti'/.test(a));
    },
  },
];

console.log('validate-front-door-motion');
for (const section of SECTIONS) {
  console.log(`\n${section.name}`);
  section.run();
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
