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

const SECTIONS: Section[] = [
  {
    name: 'A1 — BrandSplash holds for the app and hands off (no glow, no wobble)',
    run: () => {
      const s = code('components/BrandSplash.tsx');
      ok('no settle glow (settleGlow / bubbleGlow are gone)', !/settleGlow|bubbleGlow/.test(s));
      ok('imports setLaunchPhase from the launch curtain',
        /import\s*\{[^}]*\bsetLaunchPhase\b[^}]*\}\s*from\s*'@\/components\/launch\/launchCurtain'/.test(s));
      ok('reads getBootReady() before exiting', /getBootReady\(\)/.test(s));
      ok("sets 'lifting' at the exit and 'open' in finish()",
        /setLaunchPhase\('lifting'\)/.test(s) && /doneRef\.current = true;[\s\S]{0,400}setLaunchPhase\('open'\)/.test(s));
      const exitBy = num(s, 'EXIT_BY_MS');
      const exitMs = num(s, 'EXIT_MS');
      const max = num(s, 'SPLASH_MAX_LIFETIME_MS');
      const cap = num(s, 'FLY_CAP_MS');
      const fade = num(s, 'FLY_FADE_MS');
      ok(`EXIT_BY_MS + EXIT_MS < SPLASH_MAX_LIFETIME_MS (${exitBy} + ${exitMs} < ${max})`,
        exitBy != null && exitMs != null && max != null && exitBy + exitMs < max);
      ok('the exit is bounded by its own timer: setTimeout(finish, EXIT_MS + 50)', /setTimeout\(finish, EXIT_MS \+ 50\)/.test(s));
      ok(`EXIT_BY_MS + EXIT_MS + 50 < SPLASH_MAX_LIFETIME_MS`, exitBy != null && exitMs != null && max != null && exitBy + exitMs + 50 < max);
      ok(`the fly's cap + cross-fade fit inside EXIT_MS (${cap} + ${fade} ≤ ${exitMs})`,
        cap != null && fade != null && exitMs != null && cap + fade <= exitMs);
      ok('the module-scope markLaunchPending() is guarded by JEST_WORKER_ID',
        /const UNDER_JEST = typeof process !== 'undefined' && process\.env\?\.JEST_WORKER_ID != null;\s*\nif \(!UNDER_JEST\) markLaunchPending\(\);/.test(s));
      ok('the ink is its own layer (the outer overlay no longer paints it)',
        /overlay:\s*\{(?![^}]*backgroundColor)[^}]*\}/.test(s) && /styles\.ink, \{ opacity: inkOpacity \}/.test(s));
      ok('the bubble spring is BUBBLE_SPRING (ζ≈0.81), not the old 12/150/0.9',
        /Animated\.spring\(bubbleX, \{ toValue: 0, \.\.\.BUBBLE_SPRING/.test(s) && !/damping: 12, stiffness: 150/.test(s));
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
      // login/signup still carry the shake / press-scale literals on base; those
      // animations are lane A2's (errors, buttons), which adds the two files here.
      const owned = files.filter((f) => f !== 'app/login.tsx' && f !== 'app/signup.tsx');
      const literal = owned.filter((f) => /useNativeDriver:\s*true/.test(code(f)));
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
  // Lane A2 appends its sections here.
];

console.log('validate-front-door-motion');
for (const section of SECTIONS) {
  console.log(`\n${section.name}`);
  section.run();
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
