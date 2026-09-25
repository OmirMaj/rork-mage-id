// validate-motion.ts — the motion system's guard (smoothness pass, lane 1).
//
//   bun run scripts/validate-motion.ts        (package.json: test:motion)
//
// The founder asked for an app that feels smooth: springs with a tiny
// overshoot at most, content that swaps with a short fade, soft web hovers —
// never bouncy, never a glow, never dead time. components/ui/motion.ts is the
// one place that motion is built. This file holds the rules that keep it that
// way, text-only (designTokens imports react-native, which bun cannot load):
//
//   1. motion.ts exists and the '@/components/ui' barrel re-exports it.
//   2. Every Motion.spring preset has a damping ratio
//      ζ = damping / (2·√(stiffness·mass)) inside [0.75, 1.05]: a hair of
//      overshoot at most, never a wobble, never a sluggish crawl.
//   3. No `scaleXY` in code (comments may explain why): a create/delete
//      scaleXY LayoutAnimation SIGABRTs on Fabric under a transform.
//   4. `animationKeyframes` only in motion.ts: an inline keyframe object is
//      silently dropped by react-native-web; only StyleSheet.create compiles it.
//   5. No `transitionDuration:` / `animationDuration:` with a bare number: RN-web
//      turns a number into px, so the duration silently becomes 0.
//   6. MOTION_CSS ships in WEB_DOCUMENT_CSS, only under
//      `prefers-reduced-motion: no-preference`, never transitions opacity /
//      transform / size / position (TouchableOpacity's fade and the Gantt
//      drags would lag the pointer), never uses !important, and every
//      transition rule's selectors start with `:where(` (zero specificity, so
//      an RN-web component class such as TouchableOpacity's always wins).
//   7. A RATCHET on `bounciness:`, `friction:`, `Easing.bounce` and
//      `Easing.elastic` in app/, components/ and hooks/: the count may only
//      fall. Later lanes lower it by moving springs onto Motion.spring; they
//      lower BASELINE here in the same change.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { MOTION_CSS, WEB_DOCUMENT_CSS } from '../components/desktop/webDocument';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/** Measured 2026-09-25 after lane 1 (comment-stripped source). NEVER RAISE. */
const BASELINE = 20;

let failures = 0;
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log('  PASS  ' + name); return; }
  failures += 1;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail.split('\n').join('\n        ') : ''));
}

function read(rel: string): string {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
}

/** Blank out // and /* *\/ comments (strings kept, newlines kept). */
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

function collect(dirs: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(dir, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(e) && !/\.d\.ts$/.test(e)) out.push(p);
    }
  };
  for (const d of dirs) walk(join(ROOT, d));
  return out;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join('/');
const SOURCES = collect(['app', 'components', 'hooks']).map((p) => ({ path: rel(p), code: stripComments(readFileSync(p, 'utf8')) }));

/** `path:line` for every match of `re` in comment-stripped code. */
function hits(re: RegExp, filter: (path: string) => boolean = () => true): string[] {
  const found: string[] = [];
  for (const { path, code } of SOURCES) {
    if (!filter(path)) continue;
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    for (const m of code.matchAll(g)) found.push(`${path}:${code.slice(0, m.index).split('\n').length}`);
  }
  return found;
}

console.log('validate-motion');

// ── 1. motion.ts exists and the barrel re-exports it ─────────────────────────
const motionSrc = read('components/ui/motion.ts');
const barrel = stripComments(read('components/ui/index.ts'));
ok('components/ui/motion.ts exists', motionSrc.length > 0);
ok("the '@/components/ui' barrel re-exports ./motion", /export\s*\{[^}]*\}\s*from\s*'\.\/motion'/.test(barrel));
for (const name of ['nativeDriver', 'reducedMotion', 'subscribeReducedMotion', 'useReducedMotion', 'layoutNext', 'useRiseOnOpen', 'useSwapFade', 'webMotion', 'registerWithMotion']) {
  ok(`motion.ts exports ${name} and the barrel carries it`,
    new RegExp(`export\\s+(?:const|function)\\s+${name}\\b`).test(motionSrc) && new RegExp(`\\b${name}\\b`).test(barrel));
}

// ── 2. every spring preset's damping ratio is in [0.75, 1.05] ────────────────
const tokens = stripComments(read('constants/designTokens.ts'));
const motionBlock = tokens.slice(tokens.indexOf('export const Motion = {'));
const springStart = motionBlock.indexOf('spring: {');
const springBody = springStart >= 0 ? motionBlock.slice(springStart + 'spring: {'.length, motionBlock.indexOf('\n  },', springStart)) : '';
const presets = [...springBody.matchAll(/(\w+):\s*\{([^}]*)\}/g)].map((m) => {
  const num = (k: string) => Number((m[2].match(new RegExp(`\\b${k}:\\s*([\\d.]+)`)) ?? [])[1]);
  return { name: m[1], damping: num('damping'), stiffness: num('stiffness'), mass: num('mass'), raw: m[2] };
});
ok('Motion.spring parses (snap, settled, heavy, rise, glideLead, glideTrail present)',
  ['snap', 'settled', 'heavy', 'rise', 'glideLead', 'glideTrail'].every((n) => presets.some((p) => p.name === n)),
  `found: ${presets.map((p) => p.name).join(', ') || '(none)'}`);
for (const p of presets) {
  const zeta = p.damping / (2 * Math.sqrt(p.stiffness * p.mass));
  ok(`Motion.spring.${p.name}: ζ = ${Number.isFinite(zeta) ? zeta.toFixed(3) : 'NaN'} in [0.75, 1.05], stiffness/damping/mass only`,
    Number.isFinite(zeta) && zeta >= 0.75 && zeta <= 1.05 && !/bounciness|friction|tension|speed/.test(p.raw),
    `{${p.raw.trim()}} — below 0.75 wobbles on release; above 1.05 crawls into place.`);
}
ok('Motion.duration carries swap and layout', /\bswap:\s*\d+/.test(motionBlock) && /\blayout:\s*\d+/.test(motionBlock));
ok("Motion.css.easeOut is a CSS timing-function string", /easeOut:\s*'cubic-bezier\([^)]*\)'/.test(motionBlock));

// ── 3. no scaleXY in code ────────────────────────────────────────────────────
const scale = hits(/\bscaleXY\b/);
ok('no `scaleXY` outside comments in app/, components/, hooks/', scale.length === 0,
  `A create/delete scaleXY LayoutAnimation SIGABRTs on Fabric under a transform. Use layoutNext() (opacity only):\n${scale.join('\n')}`);

// ── 4. keyframes only in motion.ts ───────────────────────────────────────────
const keyframes = hits(/\banimationKeyframes\b/, (p) => p !== 'components/ui/motion.ts');
ok('`animationKeyframes` appears only in components/ui/motion.ts', keyframes.length === 0,
  `Inline keyframes are silently dropped by react-native-web. Use webMotion(key) / registerWithMotion():\n${keyframes.join('\n')}`);

// ── 5. CSS durations are strings ─────────────────────────────────────────────
const bare = hits(/\b(?:transitionDuration|animationDuration|transitionDelay|animationDelay)\s*:\s*-?[\d.]/);
ok('no transition/animation duration or delay with a bare number', bare.length === 0,
  `RN-web turns a number into px — write '140ms':\n${bare.join('\n')}`);

// ── 6. the global CSS layer ──────────────────────────────────────────────────
ok('MOTION_CSS is part of WEB_DOCUMENT_CSS', MOTION_CSS.length > 0 && WEB_DOCUMENT_CSS.includes(MOTION_CSS));
ok('MOTION_CSS transitions only under prefers-reduced-motion: no-preference',
  MOTION_CSS.includes('prefers-reduced-motion: no-preference')
  && MOTION_CSS.indexOf('transition') > MOTION_CSS.indexOf('prefers-reduced-motion: no-preference'));
const FORBIDDEN = /^(opacity|transform|width|height|left|top|right|bottom|all|inset|translate|scale|rotate)$/i;
const badProps = [...MOTION_CSS.matchAll(/transition-property\s*:\s*([^;}]+)/g)]
  .flatMap((m) => m[1].split(',').map((s) => s.trim()))
  .filter((prop) => FORBIDDEN.test(prop));
ok('MOTION_CSS never transitions opacity, transform, size or position', badProps.length === 0 && !/\btransition\s*:/.test(MOTION_CSS),
  `found: ${badProps.join(', ') || 'a `transition:` shorthand'} — TouchableOpacity and the Gantt drags would lag the pointer.`);
ok('MOTION_CSS never uses !important (it would break ActivityIndicator and Modal animationend)', !MOTION_CSS.includes('!important'));
ok('MOTION_CSS never forces animation-duration', !/animation-duration/.test(MOTION_CSS));
// A global transition rule must have ZERO specificity. `:is(a[href], …)` takes
// its most specific argument's weight, (0,1,1), and beats every RN-web atomic
// class (0,1,0) — it overrode TouchableOpacity's own `transition-property:
// opacity` (the release fade snapped) and any webMotion('rotateGlide') inside a
// role=button. Every top-level selector of a rule that sets transition-* must
// therefore start with `:where(` so a component's own class always wins.
const splitTopLevel = (sel: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
};
const heavySelectors = [...MOTION_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => /transition-/.test(m[2]))
  .flatMap((m) => splitTopLevel(m[1]))
  .filter((sel) => !sel.startsWith(':where('));
ok('MOTION_CSS transition rules use zero-specificity :where( selectors only',
  heavySelectors.length === 0 && /transition-/.test(MOTION_CSS),
  `found: ${heavySelectors.join(' | ')} — it would beat RN-web's class-level transitions (TouchableOpacity's fade, rotateGlide).`);

// ── 7. the bounce ratchet ────────────────────────────────────────────────────
const bouncy = hits(/\bbounciness\s*:|\bfriction\s*:|\bEasing\.bounce\b|\bEasing\.elastic\b/);
ok(`bounciness / friction / Easing.bounce / Easing.elastic: ${bouncy.length} <= BASELINE ${BASELINE}`, bouncy.length <= BASELINE,
  `Use Motion.spring presets (stiffness/damping/mass) instead:\n${bouncy.join('\n')}`);
if (bouncy.length < BASELINE) {
  console.log(`  NOTE  the count fell to ${bouncy.length} — lower BASELINE in scripts/validate-motion.ts to lock it in.`);
}

if (failures > 0) {
  console.log(`\n✗ validate-motion: ${failures} failing check(s)`);
  process.exit(1);
}
console.log('\n✓ validate-motion: springs settle, keyframes compile, the web glides stay colour-only');
