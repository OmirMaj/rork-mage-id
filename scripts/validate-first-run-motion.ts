// validate-first-run-motion.ts — slick-3 lane B: the first run moves like the
// rest of the app, and the persona pick has no dead time and no flash.
//
// Text-only (bun). Pins:
//   1. PersonaSwitchOverlay has no settle glow and no second (echo) ring.
//   2. Every spring in the five first-run files has a damping ratio
//      ζ = damping / (2·√(stiffness·mass)) inside [0.75, 1.05]: a literal
//      config, a named local const, a Motion.spring.* preset or an
//      edgeSprings()/planSegmentGlide() edge (the glide presets).
//   3. No `useNativeDriver: true` literal in them (nativeDriver instead).
//   4. persona-select and onboarding read Reduce Motion from the motion store
//      (useReducedMotion), never their own AccessibilityInfo listener.
//   5. persona-select: the role write starts in handlePick BEFORE the overlay
//      shows; it can never leave a bare rejecting promise; commitRole holds at
//      gate.ready() before every completeOnboarding() / router call; only
//      handleOverlayDone releases that hold; the overlay's onSettled never
//      navigates.
//   6. PersonaSwitchOverlay bounds the onSettled await with HOLD_CAP_MS.
//   7. onboarding routes both step changes through goStep and renders
//      GlideDots for the step dots and the pips.
//   8. onboarding-paywall glides with planSegmentGlide; GlideDots uses
//      edgeSprings and the Reduce Motion store.
//
// Run: bun run scripts/validate-first-run-motion.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// Copied from scripts/validate-motion.ts (importing it would run its checks).
function stripComments(src: string): string {
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

let failures = 0;
function ok(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

const FILES = {
  overlay: 'components/PersonaSwitchOverlay.tsx',
  persona: 'app/persona-select.tsx',
  onboarding: 'app/onboarding.tsx',
  paywall: 'app/onboarding-paywall.tsx',
  dots: 'components/animations/GlideDots.tsx',
} as const;
const code = Object.fromEntries(
  Object.entries(FILES).map(([k, p]) => [k, stripComments(read(p))]),
) as Record<keyof typeof FILES, string>;

/** The balanced (...) or {...} starting at `open`. */
function balanced(src: string, open: number): string {
  const o = src[open];
  const c = o === '(' ? ')' : o === '{' ? '}' : ']';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === c) { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}
/** The body of `const name = useCallback(` … up to its matching close paren. */
function callbackBody(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = useCallback(`);
  if (at < 0) return '';
  return balanced(src, src.indexOf('(', at + `const ${name} = useCallback`.length));
}

// ── 1. no glow, no echo ring ───────────────────────────────────────────────
console.log('\nPersonaSwitchOverlay — no glow, no echo ring:');
ok('no settleGlow / bubbleGlow', !/settleGlow|bubbleGlow/.test(code.overlay));
ok('no ring2 (the echo ring)', !/ring2/.test(code.overlay));

// ── 2. every spring's damping ratio ─────────────────────────────────────────
console.log('\nsprings — ζ inside [0.75, 1.05]:');
const PRESETS = new Set(['snap', 'rise', 'glideLead', 'glideTrail']);
const EDGE_SPREAD = /^\.\.\.(springs|plan)\.(leftSpring|rightSpring)$/;
const zeta = (d: number, k: number, m: number) => d / (2 * Math.sqrt(k * m));
const num = (cfg: string, key: string) => {
  const m = new RegExp(`\\b${key}\\s*:\\s*([0-9.]+)`).exec(cfg);
  return m ? Number(m[1]) : undefined;
};
function zetaOfLiteral(cfg: string): number | null {
  const d = num(cfg, 'damping');
  const k = num(cfg, 'stiffness');
  const m = num(cfg, 'mass') ?? 1;
  if (d === undefined || k === undefined) return null;
  return zeta(d, k, m);
}
for (const [key, src] of Object.entries(code)) {
  const file = FILES[key as keyof typeof FILES];
  let count = 0;
  for (const m of src.matchAll(/Animated\.spring\(/g)) {
    count++;
    const call = balanced(src, m.index! + 'Animated.spring'.length);
    const cfgAt = call.indexOf('{');
    const cfg = cfgAt >= 0 ? balanced(call, cfgAt) : '';
    const line = src.slice(0, m.index).split('\n').length;
    const where = `${file}:${line}`;
    if (/\b(bounciness|friction|tension|speed)\s*:/.test(cfg)) { ok(`${where} uses no bounciness/friction/tension/speed`, false, cfg); continue; }
    const spread = /\.\.\.([A-Za-z_.]+)/.exec(cfg)?.[0];
    if (spread) {
      const preset = /^\.\.\.Motion\.spring\.(\w+)$/.exec(spread)?.[1];
      if (preset) { ok(`${where} Motion.spring.${preset} is a sanctioned preset`, PRESETS.has(preset)); continue; }
      if (EDGE_SPREAD.test(spread)) { ok(`${where} ${spread.slice(3)} is a glide edge (edgeSprings)`, /edgeSprings|planSegmentGlide/.test(src)); continue; }
      const local = /^\.\.\.([A-Z_][A-Z0-9_]*)$/.exec(spread)?.[1];
      const decl = local ? new RegExp(`const ${local}\\s*=\\s*(\\{[^}]*\\})`).exec(src)?.[1] : undefined;
      const z = decl ? zetaOfLiteral(decl) : null;
      ok(`${where} ${spread.slice(3)} ζ=${z?.toFixed(2) ?? '?'}`, z !== null && z >= 0.75 && z <= 1.05, decl ?? 'unresolved spread');
      continue;
    }
    const z = zetaOfLiteral(cfg);
    ok(`${where} literal ζ=${z?.toFixed(2) ?? '?'}`, z !== null && z >= 0.75 && z <= 1.05, cfg);
  }
  if (count === 0 && key !== 'paywall') ok(`${file} has springs to check`, false, 'no Animated.spring found');
}
ok('no Easing.bounce / Easing.elastic in the five files',
  !Object.values(code).some((s) => /\bEasing\.(bounce|elastic)\b/.test(s)));

// ── 3. nativeDriver, never a literal ───────────────────────────────────────
console.log('\nuseNativeDriver:');
for (const [key, src] of Object.entries(code)) {
  const file = FILES[key as keyof typeof FILES];
  ok(`${file}: no useNativeDriver: true literal`, !/useNativeDriver\s*:\s*true\b/.test(src));
}

// ── 4. Reduce Motion from the store ─────────────────────────────────────────
console.log('\nReduce Motion:');
for (const key of ['persona', 'onboarding'] as const) {
  ok(`${FILES[key]}: no private AccessibilityInfo listener`, !/AccessibilityInfo/.test(code[key]));
  ok(`${FILES[key]}: reads useReducedMotion()`, /const reduceMotion = useReducedMotion\(\);/.test(code[key]));
}
ok('persona-select still passes reduceMotion to the overlay', /reduceMotion=\{reduceMotion\}/.test(code.persona));

// ── 5. the pick: no dead time, no flash, nothing navigates under the overlay ──
console.log('\npersona-select — the pick:');
{
  const P = code.persona;
  const commit = callbackBody(P, 'commitRole');
  const pick = callbackBody(P, 'handlePick');
  const settled = callbackBody(P, 'handleOverlaySettled');
  const done = callbackBody(P, 'handleOverlayDone');
  ok('commitRole, handlePick, handleOverlaySettled and handleOverlayDone exist',
    !!commit && !!pick && !!settled && !!done);

  const startAt = pick.indexOf('void commitRole(role,');
  const showAt = pick.indexOf('setShowOverlay(true)');
  ok('handlePick starts the role write BEFORE the overlay shows', startAt >= 0 && showAt > startAt);
  ok('…through a PickRun whose prepared promise only ever resolves (no reject)',
    /run\.prepared = new Promise<boolean>\(\(resolve\) =>/.test(pick) && !/\breject\b/.test(pick));
  ok('…and commitRole catches everything (its catch awaits gate.failed())',
    /^\(async \(role: UserRole, gate: PickGate\) => \{\s*try \{/.test(commit)
    && /\} catch \(err\) \{\s*await gate\.failed\(\);/.test(commit));

  // The hold precedes every completeOnboarding() / router call on each path.
  const invAt = commit.indexOf('if (invitedProject) {');
  const inv = invAt >= 0 ? balanced(commit, commit.indexOf('{', invAt)) : '';
  const rest = invAt >= 0 ? commit.slice(invAt + inv.length) : commit;
  const firstNav = (s: string) => {
    const hits = [s.indexOf('completeOnboarding()'), s.indexOf('router.')].filter((i) => i >= 0);
    return hits.length ? Math.min(...hits) : -1;
  };
  const holdInv = inv.indexOf('await gate.ready();');
  ok('invited path: gate.ready() before its first completeOnboarding() / router call',
    holdInv >= 0 && firstNav(inv) > holdInv);
  const catchAt = rest.indexOf('} catch (err) {');
  const main = catchAt >= 0 ? rest.slice(0, catchAt) : rest;
  const holdMain = main.indexOf('await gate.ready();');
  ok('main path: gate.ready() before its first completeOnboarding() / router call',
    holdMain >= 0 && firstNav(main) > holdMain);
  ok('…and after the setUserRole write and the invite lookup',
    main.indexOf('await setUserRole(role);') < holdMain && main.indexOf('await settleWithin(') < holdMain);

  ok('onSettled never navigates, never releases the hold, never starts the write',
    !/router\.|\.release\(|commitRole|completeOnboarding/.test(settled));
  ok('…it only hides the list under the scrim, on success, while the pick is current',
    /if \(ok && pickRef\.current === run\) hideListUnderOverlay\(\);/.test(settled));
  ok('only handleOverlayDone releases the hold', (P.match(/\.release\(\)/g) ?? []).filter((x) => x).length === 1
    && /run\.release\(\);/.test(done));
  ok('…past the cap (still unsettled) it restores the list first', /if \(!run\.settled\) restoreList\(\);\s*run\.release\(\);/.test(done));
  ok('the overlay is wired: originRect, onSettled, onDone',
    /originRect=\{overlayRect\}/.test(P) && /onSettled=\{handleOverlaySettled\}/.test(P) && /onDone=\{handleOverlayDone\}/.test(P));
  ok('hideListUnderOverlay sets listHiddenRef and the entrance respects it',
    /listHiddenRef\.current = true;/.test(P) && /useEffect\(\(\) => \{\s*if \(listHiddenRef\.current\) return;/.test(P));
  ok('each role card rises on its own Animated host (ref kept, collapsable={false})',
    /<Animated\.View\s+key=\{role\}\s+ref=\{[^}]*cardRefs\.current\[role\] = r;[^}]*\}\}\s+collapsable=\{false\}/.test(P));
}

// ── 6. the overlay's hold is bounded ───────────────────────────────────────
console.log('\nPersonaSwitchOverlay — the hold:');
ok('HOLD_CAP_MS = 5000', /HOLD_CAP_MS = 5000;/.test(code.overlay));
ok('the onSettled await is raced against HOLD_CAP_MS', /Promise\.race\(\[settled, wait\(HOLD_CAP_MS, timers\)\]\)/.test(code.overlay));
ok('a rejection from onSettled is caught', /await settle\(\); \}\)\(\)\.catch\(/.test(code.overlay));
ok('the Modal stays animationType="none", transparent, statusBarTranslucent',
  /<Modal\s+visible=\{mounted\}\s+transparent\s+animationType="none"\s+statusBarTranslucent/.test(code.overlay));

// ── 7. onboarding ──────────────────────────────────────────────────────────
console.log('\nonboarding:');
{
  const O = code.onboarding;
  ok('handleStarted → goStep(\'preview\')', /goStep\('preview'\);/.test(callbackBody(O, 'handleStarted')));
  ok('handlePreviewNext → goStep(\'rates\')', /goStep\('rates'\);/.test(callbackBody(O, 'handlePreviewNext')));
  const setSteps = [...O.matchAll(/setStep\(/g)].length;
  ok('setStep is called only inside goStep (twice: reduced + after the exit)',
    setSteps === 2 && (callbackBody(O, 'goStep').match(/setStep\(/g) ?? []).length === 2, `found ${setSteps}`);
  ok('the steps\' CTAs ignore taps while a step is leaving',
    /if \(exitingRef\.current\) return;/.test(callbackBody(O, 'handleStarted'))
    && /const advance = \(\) => \{\s*if \(exitingRef\.current\) return;/.test(O));
  ok('GlideDots renders the step dots', /<GlideDots\s+count=\{STEPS\.length\}\s+active=\{STEPS\.indexOf\(step\)\}/.test(O));
  ok('GlideDots renders the pips', /<GlideDots\s+count=\{PREVIEW_CARDS\.length\}\s+active=\{cardIndex\}/.test(O));
  ok('each step body slides: translateX after translateY (3 bodies)',
    (O.match(/transform: \[\{ translateY: lift \}, \{ translateX: slideX \}\]/g) ?? []).length === 3);
}

// ── 8. the paywall and GlideDots ───────────────────────────────────────────
console.log('\nonboarding-paywall + GlideDots:');
/** The unaliased names a file imports from `from`. */
function importsFrom(src: string, from: string): string[] {
  const esc = from.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const m = new RegExp(`import \\{([^}]*)\\} from '${esc}';`).exec(src);
  return m ? m[1].split(',').map((x) => x.trim()).filter((x) => x && !/\sas\s/.test(x)).map((x) => x.replace(/^type\s+/, '')) : [];
}
const SEG = '@/components/ui/SegmentedControl';
const MOTION = '@/components/ui/motion';
ok('onboarding-paywall imports planSegmentGlide (unaliased) and calls it',
  importsFrom(code.paywall, SEG).includes('planSegmentGlide') && /\bplanSegmentGlide\(periodRects\.current\[prev\]/.test(code.paywall));
ok('…and never paints periodOptionActive under a glide',
  (code.paywall.match(/&& !periodGlide && styles\.periodOptionActive/g) ?? []).length === 2);
ok('GlideDots imports edgeSprings (unaliased) and calls it',
  importsFrom(code.dots, SEG).includes('edgeSprings') && /\bedgeSprings\(/.test(code.dots));
ok('GlideDots reads the Reduce Motion store (reducedMotion() + useReducedMotion(), unaliased)',
  importsFrom(code.dots, MOTION).includes('reducedMotion') && importsFrom(code.dots, MOTION).includes('useReducedMotion')
  && /\breducedMotion\(\)/.test(code.dots) && /\buseReducedMotion\(\)/.test(code.dots));

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll first-run motion checks passed.');
process.exit(failures ? 1 : 0);
