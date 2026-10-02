// validate-motion-kit.ts — the motion kit's guard (lane MOTIONKIT).
//
//   bun run scripts/validate-motion-kit.ts        (package.json: test:motion-kit)
//
// The kit (components/motion/kit, utils/motion/kit, marketing/assets/
// motion-kit.{js,css}) moves things that ARRIVE in front of the reader. These
// checks hold it to the rules that make that cheap and honest:
//
//   K1 the files exist and both barrels export every part;
//   K2 the numbers (executed): springs in the ζ band and equal to Motion.spring,
//      durations equal to Motion.duration, caps and budgets, the web durations,
//      every Reduce Motion plan (no travel, no scale, no stagger, ≤ 100 ms, the
//      same end state), and the chat numbers equal to AILOOK's ASK_MOTION;
//   K3 the pure maths, executed (stagger, partial sums, range, glide, dots,
//      beats, budget, the spring against an independent 1 ms solver);
//   K4 the source rules over components/motion/kit (transform / opacity only,
//      the native driver, one loop shape, no easing in interpolate, timers,
//      Reduce Motion, imports, colours, keyframes);
//   K5 the marketing kit: CSS and JS rules, the JS executed next to the app's
//      numbers, and its size;
//   K6 two ratchets the adopters lower (useNativeDriver literals, looped
//      sequences).
//
// Imports ONLY utils/motion/kit/** (pure) and, when it exists,
// components/brain/ask/askMotion.ts; every other file is read as TEXT.
//
// MUTATION PROOF: set MOTIONKIT_MUT_DIR to a directory that mirrors repo
// paths; any file found there is read (or imported) INSTEAD of the repo copy.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MUT = process.env.MOTIONKIT_MUT_DIR;

/** Measured 2026-10-01 on base 00d2b515, comment-stripped. NEVER RAISE; adopters lower them. */
const BASELINE_NATIVE_DRIVER_LITERALS = 85;
const BASELINE_LOOPED_SEQUENCES = 11;

let failures = 0;
const failed: string[] = [];
function ok(name: string, condition: boolean, detail?: string) {
  if (condition) { console.log('  PASS  ' + name); return; }
  failures += 1;
  failed.push(name);
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail.split('\n').join('\n        ') : ''));
}

function read(rel: string): string {
  if (MUT && existsSync(join(MUT, rel))) return readFileSync(join(MUT, rel), 'utf8');
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
}
const exists = (rel: string) => (MUT && existsSync(join(MUT, rel))) || existsSync(join(ROOT, rel));

/** Blank out // and /* *\/ comments (strings kept, newlines kept). A copy of validate-motion's. */
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

/** The balanced (…) / {…} / […] group that opens at `open`. */
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
/** Every group that follows `needle` (needle ends right before the opening bracket). */
function groupsAfter(src: string, needle: string): string[] {
  const out: string[] = [];
  let i = src.indexOf(needle);
  while (i >= 0) {
    const at = i + needle.length;
    if (src[at] === '(' || src[at] === '{') out.push(group(src, at));
    i = src.indexOf(needle, i + 1);
  }
  return out;
}

function walk(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  const go = (abs: string) => {
    let entries: string[] = [];
    try { entries = readdirSync(abs); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(abs, e);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) go(p);
      else if (re.test(e) && !/\.d\.ts$/.test(e)) out.push(relative(ROOT, p).split(sep).join('/'));
    }
  };
  go(join(ROOT, dir));
  return out.sort();
}

const line = (src: string, idx: number) => src.slice(0, idx).split('\n').length;

// ── loading the pure kit (from the mutation mirror when it holds a copy) ──────

const PURE_DIR = 'utils/motion/kit';
let tmp: string | null = null;
function pureRoot(): string {
  const mutDir = MUT ? join(MUT, PURE_DIR) : null;
  if (!mutDir || !existsSync(mutDir)) return join(ROOT, PURE_DIR);
  tmp = mkdtempSync(join(tmpdir(), 'motionkit-'));
  cpSync(join(ROOT, PURE_DIR), tmp, { recursive: true });
  cpSync(mutDir, tmp, { recursive: true });
  return tmp;
}

type Kit = typeof import('../utils/motion/kit/index');

async function main() {
  console.log('validate-motion-kit');
  const base = pureRoot();
  let K: Kit;
  try {
    K = (await import(pathToFileURL(join(base, 'index.ts')).href)) as Kit;
  } catch (e) {
    ok('utils/motion/kit loads under bun (no imports outside the folder)', false, String(e));
    finish();
    return;
  }

  // ── K1 files and barrels ───────────────────────────────────────────────────
  const PURE = ['kitSpec', 'springMath', 'stagger', 'chatStack', 'accumulate', 'rangeGeometry', 'focusGlide', 'checkQueue', 'budgetMath', 'plans', 'index'];
  const PARTS = ['StaggerList', 'ChatTurn', 'ThinkingRow', 'CheckSync', 'CountRoll', 'AccumulateCards', 'RangeSettle', 'FileInto', 'PriorityGrid', 'FocusMarker', 'StackPush', 'CornerTags', 'MatrixFill'];
  const FILES = [
    ...PURE.map((f) => `${PURE_DIR}/${f}.ts`),
    ...PARTS.map((f) => `components/motion/kit/${f}.tsx`),
    'components/motion/kit/FocusPush.ts', 'components/motion/kit/useEntrance.ts', 'components/motion/kit/useSeenKeys.ts',
    'components/motion/kit/budget.ts', 'components/motion/kit/index.ts', 'components/motion/kit/css/kitCss.ts',
    'components/motion/kit/css/README.txt', 'components/motion/kit/__demo__/KitGallery.tsx',
    'marketing/assets/motion-kit.js', 'marketing/assets/motion-kit.css', 'scripts/motion-kit-demo/index.html',
    '__tests__/smoke/motion-kit.test.tsx', '__tests__/web/motion-kit.webtest.tsx', '__tests__/web/motion-kit-marketing.webtest.ts',
  ];
  const missing = FILES.filter((f) => !exists(f));
  ok(`K1 every kit file exists (${FILES.length})`, missing.length === 0, missing.join('\n'));
  const cBarrel = stripComments(read('components/motion/kit/index.ts'));
  const NAMES = ['ChatTurn', 'ThinkingRow', 'ThinkingDots', 'StaggerList', 'useStagger', 'CheckSync', 'useCheckBeat', 'CountRoll', 'AccumulateCards',
    'RangeSettle', 'useFileInto', 'FileIntoLayer', 'PriorityGrid', 'FocusMarker', 'useFocusRects', 'StackPush', 'useFocusPush', 'CornerTags', 'MatrixFill',
    'useEntrance', 'useSeenKeys'];
  const notExported = NAMES.filter((n) => !new RegExp(`export\\s*\\{[^}]*\\b${n}\\b`).test(cBarrel));
  ok('K1 components/motion/kit/index.ts exports every part', notExported.length === 0, notExported.join(', '));
  const pBarrel = stripComments(read(`${PURE_DIR}/index.ts`));
  const notStarred = PURE.filter((f) => f !== 'index' && !pBarrel.includes(`export * from './${f}'`));
  ok('K1 utils/motion/kit/index.ts re-exports every pure module', notStarred.length === 0, notStarred.join(', '));

  // ── K2 numbers ─────────────────────────────────────────────────────────────
  const tokens = stripComments(read('constants/designTokens.ts'));
  const motionBlock = tokens.slice(tokens.indexOf('export const Motion = {'));
  const springStart = motionBlock.indexOf('spring: {');
  const springBody = springStart >= 0 ? motionBlock.slice(springStart + 'spring: {'.length, motionBlock.indexOf('\n  },', springStart)) : '';
  const tokenSprings: Record<string, { damping: number; stiffness: number; mass: number }> = {};
  for (const m of springBody.matchAll(/(\w+):\s*\{([^}]*)\}/g)) {
    const num = (k: string) => Number((m[2].match(new RegExp(`\\b${k}:\\s*([\\d.]+)`)) ?? [])[1]);
    tokenSprings[m[1]] = { damping: num('damping'), stiffness: num('stiffness'), mass: num('mass') };
  }
  const durStart = motionBlock.indexOf('duration: {');
  const durBody = motionBlock.slice(durStart, motionBlock.indexOf('\n  },', durStart));
  const dur = (k: string) => Number((durBody.match(new RegExp(`\\n\\s*${k}:\\s*(\\d+)`)) ?? [])[1]);
  const tokenStagger = Number((motionBlock.match(/\n\s*stagger:\s*(\d+)/) ?? [])[1]);
  const tokenEaseOut = (motionBlock.match(/easeOut:\s*'([^']*)'/) ?? [])[1];
  const bez = (k: string) => ((motionBlock.match(new RegExp(`${k}:\\s*\\[([^\\]]*)\\]`)) ?? [])[1] ?? '').split(',').map((x) => Number(x.trim()));

  const band = (s: { stiffness: number; damping: number; mass: number }) => { const z = K.dampingRatio(s); return z >= 0.75 && z <= 1.05; };
  const allSprings: [string, { stiffness: number; damping: number; mass: number }][] = [
    ...Object.entries(K.KIT_SPRING).map(([k, v]) => [`KIT_SPRING.${k}`, v] as [string, typeof v]),
    ['CHAT_STACK.send.spring', K.CHAT_STACK.send.spring], ['CHAT_STACK.sendPress.spring', K.CHAT_STACK.sendPress.spring],
  ];
  const outBand = allSprings.filter(([, s]) => !band(s)).map(([n, s]) => `${n}: ζ ${K.dampingRatio(s).toFixed(3)}`);
  ok('K2.1 every kit and chat spring has ζ in [0.75, 1.05]', outBand.length === 0, outBand.join('\n'));
  const drift = Object.entries(K.KIT_SPRING).filter(([k, v]) => {
    const t = tokenSprings[k];
    return !t || t.stiffness !== v.stiffness || t.damping !== v.damping || t.mass !== v.mass;
  }).map(([k]) => k);
  ok('K2.2 each KIT_SPRING equals Motion.spring.<same name> (designTokens text)', drift.length === 0 && Object.keys(tokenSprings).length > 0, drift.join(', '));
  const DUR = ['tap', 'fade', 'enter', 'exit', 'swap', 'layout', 'glide', 'hold'] as const;
  const durDrift = DUR.filter((k) => K.KIT_MS[k] !== dur(k)).map((k) => `${k}: ${K.KIT_MS[k]} vs ${dur(k)}`);
  ok('K2.3 KIT_MS.tap…hold equal Motion.duration', durDrift.length === 0, durDrift.join('\n'));
  ok(`K2.3 KIT_STAGGER.ms (${K.KIT_STAGGER.ms}) equals Motion.stagger (${tokenStagger})`, K.KIT_STAGGER.ms === tokenStagger);
  ok('K2.3 KIT_WEB.easeOut equals Motion.css.easeOut', K.KIT_WEB.easeOut === tokenEaseOut, `${K.KIT_WEB.easeOut} vs ${tokenEaseOut}`);
  const bezEq = (a: readonly number[], b: number[]) => a.length === 4 && a.every((x, i) => x === b[i]);
  ok('K2.3 KIT_BEZIER out / in / inOut equal Motion.easing decelerate / accelerate / standard',
    bezEq(K.KIT_BEZIER.out, bez('decelerate')) && bezEq(K.KIT_BEZIER.in, bez('accelerate')) && bezEq(K.KIT_BEZIER.inOut, bez('standard')));
  ok('K2.3 KIT_WEB.easeIn / easeInOut are those beziers as CSS',
    K.KIT_WEB.easeIn === `cubic-bezier(${K.KIT_BEZIER.in.join(', ')})` && K.KIT_WEB.easeInOut === `cubic-bezier(${K.KIT_BEZIER.inOut.join(', ')})`);

  ok(`K2.4 KIT_STAGGER.cap (${K.KIT_STAGGER.cap}) ≤ 8 and KIT_CAPS.list / matrixRows ≤ 8`, K.KIT_STAGGER.cap <= 8 && K.KIT_CAPS.list <= 8 && K.KIT_CAPS.matrixRows <= 8);
  let seqMax = 0;
  for (let n = 1; n <= 500; n++) seqMax = Math.max(seqMax, K.sequenceMs(n));
  ok(`K2.4 sequenceMs(n) ≤ 465 for n in 1..500 (max ${seqMax})`, seqMax <= 465);
  const L0 = K.rangeLayout(100000, 250000, 180000, 320, 80);
  const samplePlans = (r: boolean) => [
    K.planChatTurn(r, 'user', 'page'), K.planChatTurn(r, 'user', 'panel'), K.planChatTurn(r, 'assistant'), K.planThinkingRow(r),
    K.planStaggerList(r, 30), K.planCheckSync(r, 6), K.planCountRoll(r, 9), K.planAccumulateCards(r, 9),
    K.planRangeSettle(r, L0), K.planRangeSettle(r, K.rangeLayout(5, 5, null, 320, 80)), K.planFileInto(r, 5), K.planPriorityGrid(r, 4),
    K.planFocusMarker(r), K.planStackPush(r, 1), K.planStackPush(r, -1), K.planFocusPush(r), K.planCornerTags(r), K.planMatrixFill(r, 12),
  ];
  const longOnes: string[] = [];
  for (const p of samplePlans(false)) {
    for (const s of p.steps) {
      if (s.kind === 'decor' && s.target === 'dots') continue; // the one loop (thinking dots)
      const ms = Math.max(s.durationMs, s.spring ? K.webMsFor(s.spring) : 0);
      if (ms > 320) longOnes.push(`${p.part}.${s.target}: ${ms} ms`);
    }
  }
  ok('K2.4 every one-shot entrance ≤ 320 ms', longOnes.length === 0, longOnes.join('\n'));
  let accMax = 0; let burstMax = 0;
  for (let n = 1; n <= 60; n++) { accMax = Math.max(accMax, K.accumulateMs(n)); burstMax = Math.max(burstMax, K.burstMs(n)); }
  ok(`K2.4 the longest accumulate ≤ 600 ms (${accMax}) and the longest check burst ≤ 540 ms (${burstMax})`, accMax <= 600 && burstMax <= 540);
  const tags = K.planCornerTags(false);
  const tagsEnd = Math.max(...tags.steps.map((s) => s.delayMs + s.durationMs));
  ok(`K2.4 corner tags done ≤ 400 ms (${tagsEnd})`, tagsEnd <= 400);
  ok(`K2.4 the per-screen budget is ${K.KIT_CAPS.screenNodes} ≤ 24`, K.KIT_CAPS.screenNodes <= 24);
  const ruleOld = (r: boolean) => K.planPriorityGrid(r, 4).steps.find((s) => s.target === 'rule-old');
  const ro = ruleOld(false); const rr = ruleOld(true);
  ok(`K2.4 PriorityGrid: an old rule fades out over 120 ms (${ro?.durationMs}), 100 ms reduced (${rr?.durationMs}), opacity only, then unmounts`,
    !!ro && !!rr && ro.durationMs === 120 && rr.durationMs === K.KIT_MS.reducedFade && ro.delayMs === 0 && ro.kind === 'transient' && ro.to.opacity === 0 && ro.spring === null
      && ro.to.translateX === 0 && ro.to.translateY === 0 && ro.to.scale === 1 && ro.to.scaleX === 1);

  const WEB_MS = { rise: 280, snap: 180, glideLead: 200, glideTrail: 300, sheet: 270 } as const;
  const webBad = (Object.keys(WEB_MS) as (keyof typeof WEB_MS)[])
    .filter((k) => K.webMsFor(k) !== WEB_MS[k] || K.webMsFor(k) < 150 || K.webMsFor(k) > 320)
    .map((k) => `${k}: ${K.webMsFor(k)} (want ${WEB_MS[k]})`);
  ok('K2.5 webMsFor(): rise 280, snap 180, glideLead 200, glideTrail 300, sheet 270, each in [150, 320]', webBad.length === 0, webBad.join('\n'));

  const motionPlans = samplePlans(false);
  const reducedPlans = samplePlans(true);
  const rp: string[] = [];
  reducedPlans.forEach((p, i) => {
    rp.push(...K.reducedProblems(p));
    rp.push(...K.sameEnd(motionPlans[i], p).map((x) => `${p.part}: ${x}`));
  });
  const covered = new Set(reducedPlans.map((p) => p.part));
  const uncovered = K.KIT_PARTS.filter((p) => !covered.has(p));
  ok('K2.6 every part has a Reduce Motion plan: no translate, no scale, no stagger, ≤ 100 ms, the same end state',
    rp.length === 0 && uncovered.length === 0, [...rp, ...uncovered.map((u) => `${u}: no plan checked`)].join('\n'));

  // AILOOK.txt M1 ASK_MOTION, held here as literals (C6: two numbers for one motion can never exist).
  const ASK_M1 = {
    send: { fromY: { page: 56, panel: 44 }, fromScale: 0.98, fadeMs: 120, spring: { stiffness: 260, damping: 31, mass: 1 } },
    thinking: { delayMs: 140, fadeMs: 160, fromY: 6, stillWorkingAfterMs: 10000,
      dot: { count: 3, size: 6, gap: 5, periodMs: 1200, riseMs: 360, staggerMs: 160, low: 0.3, high: 1, scaleLow: 0.8 } },
    thinkingOut: { fadeMs: 120 },
    answer: { delayMs: 60, fadeMs: 220, fromY: 8 },
    chips: { delayMs: 120, staggerMs: 35, fadeMs: 160 },
    sendPress: { scale: 0.92, spring: { stiffness: 420, damping: 34, mass: 1 } },
    jump: { showAfterPx: 160, fadeMs: 160 },
    reduced: { fadeMs: 100 },
  };
  /** Every leaf of `a` equals the same path in `b` (b may carry more keys). */
  const leafDiff = (a: unknown, b: unknown, path = ''): string[] => {
    if (a !== null && typeof a === 'object') {
      if (b === null || typeof b !== 'object') return [`${path}: missing`];
      return Object.entries(a as Record<string, unknown>).flatMap(([k, v]) => leafDiff(v, (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
    }
    return a === b ? [] : [`${path}: ${String(b)} (AILOOK: ${String(a)})`];
  };
  const chatDrift = leafDiff(ASK_M1, K.CHAT_STACK);
  ok('K2.7 CHAT_STACK equals AILOOK M1 ASK_MOTION on every key', chatDrift.length === 0, chatDrift.join('\n'));
  if (exists('components/brain/ask/askMotion.ts')) {
    try {
      const askPath = MUT && existsSync(join(MUT, 'components/brain/ask/askMotion.ts')) ? join(MUT, 'components/brain/ask/askMotion.ts') : join(ROOT, 'components/brain/ask/askMotion.ts');
      const A = (await import(pathToFileURL(askPath).href)) as { ASK_MOTION?: unknown };
      const d = leafDiff(A.ASK_MOTION ?? {}, K.CHAT_STACK).concat(leafDiff(ASK_M1, A.ASK_MOTION ?? {}));
      ok('K2.7 components/brain/ask/askMotion.ts ASK_MOTION equals CHAT_STACK', d.length === 0, d.join('\n'));
    } catch (e) {
      ok('K2.7 components/brain/ask/askMotion.ts loads under bun', false, String(e));
    }
  } else {
    console.log('  NOTE  components/brain/ask/askMotion.ts does not exist yet (AILOOK); parity is checked against the M1 literal table');
  }
  const D = K.CHAT_STACK.thinking.dot;
  ok(`K2.7 the dots never overlap their next cycle: 2·${D.riseMs} + ${D.count - 1}·${D.staggerMs} ≤ ${D.periodMs}`, 2 * D.riseMs + (D.count - 1) * D.staggerMs <= D.periodMs);
  ok('K2.7 thinking.delayMs < 200 and stillWorkingAfterMs ≥ 8000', K.CHAT_STACK.thinking.delayMs < 200 && K.CHAT_STACK.thinking.stillWorkingAfterMs >= 8000);
  const sR = ['page', 'panel'].map((v) => K.sendEntry(v as 'page' | 'panel', true));
  ok('K2.7 sendEntry(reduced) → { fromY 0, fromScale 1, fadeMs 100, spring false } (both variants)',
    sR.every((e) => e.fromY === 0 && e.fromScale === 1 && e.fadeMs === 100 && e.spring === false));
  ok('K2.7 sendEntry page > panel > 0', K.sendEntry('page', false).fromY > K.sendEntry('panel', false).fromY && K.sendEntry('panel', false).fromY > 0);
  const aR = K.answerEntry(true);
  ok('K2.7 answerEntry(reduced) → { 0, 100, 0 }; chipDelay(3, true) 0; chipDelay(3, false) 120 + 3·35; chip 8+ arrives with chip 7',
    aR.delayMs === 0 && aR.fadeMs === 100 && aR.fromY === 0 && K.chipDelay(3, true) === 0
    && K.chipDelay(3, false) === K.CHAT_STACK.chips.delayMs + 3 * K.CHAT_STACK.chips.staggerMs && K.chipDelay(20, false) === K.chipDelay(7, false));
  const dp = K.dotPhase(2);
  ok('K2.7 dotPhase(i) = { i·160, 360, 360, 480 }', dp.startMs === 320 && dp.upMs === 360 && dp.downMs === 360 && dp.restMs === 480);

  // ── K3 pure behaviour ──────────────────────────────────────────────────────
  ok('K3 staggerDelay(i) = i·35 below the cap, null from the cap on',
    [0, 1, 7].every((i) => K.staggerDelay(i) === i * 35) && [8, 9, 30].every((i) => K.staggerDelay(i) === null) && K.staggerDelay(-1) === null);
  let seed = 20261001;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const sumBad: string[] = [];
  for (let f = 0; f < 200; f++) {
    const parts = Array.from({ length: 1 + Math.floor(rand() * 20) }, () => Math.floor(rand() * 5_000_000));
    const s = K.partialSums(parts);
    const total = parts.reduce((a, b) => a + b, 0);
    if (!s.every(Number.isInteger)) sumBad.push(`fixture ${f}: a non-integer`);
    if (s.some((x, i) => i > 0 && x < s[i - 1])) sumBad.push(`fixture ${f}: not monotone`);
    if (s[s.length - 1] !== total) sumBad.push(`fixture ${f}: last ${s[s.length - 1]} ≠ total ${total}`);
    const shown = K.shownSteps(s);
    if (shown.length > 6 || shown[shown.length - 1] !== total) sumBad.push(`fixture ${f}: shown steps end ${shown[shown.length - 1]} / ${shown.length}`);
  }
  ok('K3 partialSums on 200 integer-cent fixtures: integers, monotone, last === total; ≤ 6 shown, ending on the total', sumBad.length === 0, sumBad.slice(0, 5).join('\n'));
  const rl = K.rangeLayout(100, 200, 500, 300, 60);
  const rs = K.rangeLayout(200, 200, 150, 300, 60);
  const rc = K.rangeLayout(100, 200, null, 100, { low: 60, high: 60 });
  let overlap = false;
  for (let w = 40; w <= 600; w += 7) for (let lw = 10; lw <= 200; lw += 13) {
    const l = K.rangeLayout(1, 2, 1.5, w, lw);
    if (K.labelsOverlap(l, lw, lw)) overlap = true;
  }
  ok('K3 rangeLayout clamps expected, never overlaps labels, returns no motion for high ≤ low',
    rl.expected === 200 && rl.expectedX === 300 && rs.single && rs.lowFromX === 0 && rs.highFromX === 0 && rc.stacked && rc.lowFromX === 0 && !overlap);
  const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  ok('K3 planFocusGlide → null when reduced / unmeasured / zero-size / cross-column',
    K.planFocusGlide(R(0, 0, 10, 10), R(0, 20, 10, 10), 'y', true) === null
    && K.planFocusGlide(undefined, R(0, 20, 10, 10), 'y', false) === null
    && K.planFocusGlide(R(0, 0, 0, 10), R(0, 20, 10, 10), 'y', false) === null
    && K.planFocusGlide(R(0, 0, 10, 10), R(40, 20, 10, 10), 'y', false) === null
    && K.planFocusGlide(R(0, 0, 10, 10), R(0, 20, 10, 10), 'y', false)?.forward === true);
  let edgeErr = 0;
  for (const [L, Rr, w0] of [[0, 10, 10], [12, 80, 30], [5, 6, 40], [-20, 300, 120]]) {
    const t = K.edgeTransform(L, Rr, w0);
    const c = w0 / 2 + t.translate;
    edgeErr = Math.max(edgeErr, Math.abs(c - (t.scale * w0) / 2 - L), Math.abs(c + (t.scale * w0) / 2 - Rr));
  }
  ok('K3 edgeTransform reproduces L and R exactly', edgeErr < 1e-9);
  const dotBad: string[] = [];
  for (let i = 0; i < D.count; i++) {
    const r = K.dotRanges(i);
    for (const [name, rg, lo, hi] of [['opacity', r.opacity, D.low, D.high], ['scale', r.scale, D.scaleLow, 1]] as const) {
      if (rg.inputRange.length !== D.samples || rg.inputRange.some((x, k) => Math.abs(x - k / (D.samples - 1)) > 1e-12)) dotBad.push(`dot ${i} ${name}: input is not k/24`);
      if (rg.outputRange[D.samples - 1] !== rg.outputRange[0]) dotBad.push(`dot ${i} ${name}: out[24] ≠ out[0]`);
      if (rg.outputRange.some((v) => v < lo - 1e-9 || v > hi + 1e-9)) dotBad.push(`dot ${i} ${name}: outside [${lo}, ${hi}]`);
    }
  }
  ok('K3 dotRanges: input k/24, out[24] === out[0], values in [low, high] / [scaleLow, 1]', dotBad.length === 0, dotBad.join('\n'));
  const beatBad: string[] = [];
  for (let n = 1; n <= 12; n++) {
    const b = K.beatSchedule(n, false);
    if (new Set(b).size > 4) beatBad.push(`n=${n}: ${new Set(b).size} beats`);
    for (let i = 1; i < b.length; i++) if (b[i] !== b[i - 1] && b[i] - b[i - 1] < 120) beatBad.push(`n=${n}: gap ${b[i] - b[i - 1]}`);
    if (K.beatSchedule(n, true).some((x) => x !== 0)) beatBad.push(`n=${n}: a reduced gap`);
  }
  let q = { burstAt: 0, count: 0 };
  const ticks: number[] = [];
  for (const now of [1000, 1000, 1000, 1010, 1020, 1500]) { const r = K.queueBeat(q, now, false); q = r.queue; ticks.push(now + r.delayMs); }
  const distinct = [...new Set(ticks)].sort((a, b) => a - b);
  if (distinct.some((t, i) => i > 0 && t - distinct[i - 1] < 120)) beatBad.push(`queueBeat ticks ${ticks.join(',')}`);
  ok('K3 beatSchedule / queueBeat: gaps ≥ 120 ms, ≤ 4 beats a burst, none when reduced', beatBad.length === 0, beatBad.join('\n'));
  let leases: { until: number; n: number }[] = [];
  let maxLive = 0; let grantedAt0 = 0;
  for (let t = 0; t < 2000; t += 10) {
    const g = K.grant(leases, t, 1 + Math.floor(rand() * 9), 100 + Math.floor(rand() * 400));
    leases = g.leases;
    if (t === 0) grantedAt0 = g.granted;
    maxLive = Math.max(maxLive, K.inFlight(leases, t));
  }
  const burst = K.grant([], 0, 30, 300);
  ok(`K3 the budget never grants more than 24 nodes at once (peak ${maxLive}); 30 at once → 24`, maxLive <= 24 && burst.granted === 24 && grantedAt0 > 0);
  const fine = (tMs: number, s: { stiffness: number; damping: number; mass: number }) => {
    let x = 0; let v = 0;
    for (let i = 0; i < Math.round(tMs); i++) { const a = (-s.stiffness * (x - 1) - s.damping * v) / s.mass; v += a * 0.001; x += v * 0.001; }
    return x;
  };
  let springErr = 0;
  for (const s of Object.values(K.KIT_SPRING)) for (let t = 0; t <= 1000; t += 25) springErr = Math.max(springErr, Math.abs(K.springAt(t, s, 0, 1) - fine(t, s)));
  ok(`K3 springAt matches an independent 1 ms solver within 1e-3 on the frame grid (max ${springErr.toExponential(2)})`, springErr <= 1e-3);

  // ── K4 source rules ────────────────────────────────────────────────────────
  const KIT_FILES = walk('components/motion/kit', /\.(ts|tsx)$/);
  const PURE_FILES = walk(PURE_DIR, /\.ts$/);
  const src = (f: string) => stripComments(read(f));
  const k41: string[] = []; const k42: string[] = []; const k43: string[] = []; const k44: string[] = []; const k45: string[] = [];
  const k46: string[] = []; const k47: string[] = []; const k48: string[] = []; const k49: string[] = []; const k410: string[] = [];
  const TIMER_FILES = new Set(['components/motion/kit/ThinkingRow.tsx', 'components/motion/kit/CountRoll.tsx', 'components/motion/kit/CheckSync.tsx']);
  for (const f of KIT_FILES) {
    const s = src(f);
    // K4.1 — validate-level D's detector, seeded with every Animated.Value id in the file.
    const ids = new Set<string>();
    for (const m of s.matchAll(/(\w+)\s*=\s*(?:useRef\()?new Animated\.Value/g)) ids.add(m[1]);
    // …and every name that holds an interpolation or an Animated maths node.
    for (const m of s.matchAll(/(\w+)\s*=\s*(?:[\w.]+\.interpolate\(|Animated\.(?:add|subtract|multiply|divide|diffClamp|modulo)\()/g)) ids.add(m[1]);
    const animatedValue = (v: string) => /interpolate\(|Animated\.(?:add|subtract|multiply|divide|Value|diffClamp|modulo)/.test(v) || [...ids].some((id) => new RegExp(`^\\s*${id}\\b`).test(v));
    const LAYOUT = 'width|height|left|top|right|bottom|start|end|margin\\w*|padding\\w*|flex\\w*|borderRadius|borderWidth|backgroundColor|color|borderColor|tintColor|fontSize|lineHeight|letterSpacing|shadow\\w*|elevation|zIndex|minWidth|maxWidth|minHeight|maxHeight';
    // `key: value` object literals.
    for (const m of s.matchAll(new RegExp(`\\b(${LAYOUT})\\s*:\\s*([^,}\\n]*)`, 'g'))) {
      if (animatedValue(m[2])) k41.push(`${f}:${line(s, m.index ?? 0)} ${m[1]}: ${m[2].trim()}`);
    }
    // Styles built by assignment: `style.top = v`, `style['top'] = v`, Object.assign(style, { top: v }) is the literal case above.
    for (const m of s.matchAll(new RegExp(`(?:\\.(${LAYOUT})|\\[\\s*['"\`](${LAYOUT})['"\`]\\s*\\])\\s*=(?!=)\\s*([^;\\n]*)`, 'g'))) {
      if (animatedValue(m[3])) k41.push(`${f}:${line(s, m.index ?? 0)} .${m[1] ?? m[2]} = ${m[3].trim()}`);
    }
    // K4.2
    for (const m of s.matchAll(/useNativeDriver\s*:\s*(true|false)\b/g)) k42.push(`${f}:${line(s, m.index ?? 0)} useNativeDriver: ${m[1]}`);
    for (const fn of ['Animated.timing', 'Animated.spring', 'Animated.decay']) {
      for (const g of groupsAfter(s, fn)) if (!/useNativeDriver\s*:\s*nativeDriver\b/.test(g)) k42.push(`${f}: ${fn}${g.slice(0, 60).replace(/\s+/g, ' ')}… without useNativeDriver: nativeDriver`);
    }
    // K4.3
    for (const g of groupsAfter(s, 'Animated.loop')) {
      const inner = g.slice(1, -1).trim();
      const bad: string[] = [];
      if (f !== 'components/motion/kit/ThinkingRow.tsx') bad.push('a loop outside ThinkingRow.tsx');
      if (!/^Animated\.timing\(/.test(inner) || (inner.match(/Animated\.timing\(/g) ?? []).length !== 1) bad.push('not exactly one Animated.timing');
      if (!/easing\s*:\s*Easing\.linear\b/.test(inner)) bad.push('not Easing.linear');
      if (!/isInteraction\s*:\s*false\b/.test(inner)) bad.push('no isInteraction: false');
      if (/Animated\.(sequence|stagger|delay|spring|parallel)\b/.test(inner)) bad.push('sequence/stagger/delay/spring inside');
      if (bad.length) k43.push(`${f}: ${bad.join('; ')}`);
    }
    // K4.4
    for (const g of groupsAfter(s, '.interpolate')) {
      if (/\beasing\s*:/.test(g)) k44.push(`${f}: easing inside .interpolate`);
      if (!/extrapolate\s*:\s*'clamp'/.test(g)) k44.push(`${f}: .interpolate${g.slice(0, 50).replace(/\s+/g, ' ')}… without extrapolate: 'clamp'`);
    }
    // K4.5
    for (const re of [/setNativeProps/, /requestAnimationFrame/, /\bsetInterval\b/, /\bLayoutAnimation\b/, /\bscaleXY\b/]) if (re.test(s)) k45.push(`${f}: ${re.source}`);
    if (/\bsetTimeout\(/.test(s) && (!TIMER_FILES.has(f) || !/\bclearTimeout\b/.test(s))) k45.push(`${f}: setTimeout ${TIMER_FILES.has(f) ? 'without clearTimeout' : 'outside ThinkingRow / CountRoll / CheckSync'}`);
    // K4.6
    const base0 = f.split('/').pop()!.replace(/\.(tsx|ts)$/, '');
    if ([...PARTS, 'FocusPush'].includes(base0)) {
      if (!/\buseReducedMotion\(\)/.test(s)) k46.push(`${f}: never calls useReducedMotion()`);
      if (!new RegExp(`\\bplan${base0}\\(`).test(s)) k46.push(`${f}: never calls plan${base0}(`);
    }
    // K4.7
    for (const m of s.matchAll(/from\s+'([^']+)'/g)) {
      if (/react-native-reanimated|utils\/moments|expo-linear-gradient|lottie/.test(m[1])) k47.push(`${f}: imports ${m[1]}`);
    }
    // K4.8
    if (/['"`]#[0-9a-fA-F]{3,8}\b/.test(s) || /\brgba?\(/.test(s)) k48.push(`${f}: a colour literal`);
    if (/\b(shadow(Color|Opacity|Radius|Offset)|elevation)\s*:/.test(s)) k48.push(`${f}: a shadow / elevation key`);
    // K4.9
    if (/\banimationKeyframes\b/.test(s) && f !== 'components/motion/kit/css/kitCss.ts') k49.push(`${f}: animationKeyframes outside css/kitCss.ts`);
    for (const m of s.matchAll(/\b(animationDuration|animationDelay|transitionDuration|transitionDelay)\s*:\s*([^,}\n]+)/g)) {
      const v = m[2].trim();
      const okVal = /^'\d+ms'$/.test(v) || /^ms\(/.test(v) || /^duration$/.test(v) || /^`/.test(v);
      if (!okVal) k49.push(`${f}:${line(s, m.index ?? 0)} ${m[1]}: ${v} (a string ending in 'ms')`);
    }
    for (const m of s.matchAll(/\banimationFillMode\s*:\s*([^,}\n]+)/g)) if (m[1].trim() !== "'backwards'") k49.push(`${f}: animationFillMode ${m[1].trim()}`);
    if (/animationKeyframes/.test(s)) {
      for (const m of s.matchAll(/(?:['"]\d+%['"]|\bfrom|\bto)\s*:\s*\{([^{}]*)\}/g)) {
        for (const k of m[1].matchAll(/(\w+)\s*:/g)) if (k[1] !== 'transform' && k[1] !== 'opacity') k49.push(`${f}: keyframe key ${k[1]}`);
      }
    }
    // K4.10
    if (/useNativeDriver/.test(s) && !/import\s*\{[^}]*\bnativeDriver\b[^}]*\}\s*from\s*'@\/components\/ui\/motion'/.test(s)) k410.push(f);
  }
  for (const f of PURE_FILES) {
    for (const m of src(f).matchAll(/(?:from|import)\s+'([^']+)'/g)) if (!m[1].startsWith('./')) k47.push(`${f}: imports ${m[1]} (pure files import only this folder)`);
  }
  ok('K4.1 animated style keys are opacity / transform only', k41.length === 0, k41.join('\n'));
  ok('K4.2 no useNativeDriver literal; every timing / spring / decay passes useNativeDriver: nativeDriver', k42.length === 0, k42.join('\n'));
  ok('K4.3 every Animated.loop wraps ONE linear, non-interaction Animated.timing, and only in ThinkingRow.tsx', k43.length === 0, k43.join('\n'));
  ok("K4.4 no easing inside .interpolate; every interpolate clamps", k44.length === 0, k44.join('\n'));
  ok('K4.5 no setNativeProps / rAF / setInterval / LayoutAnimation / scaleXY; setTimeout only in the 3 timer files, cleared', k45.length === 0, k45.join('\n'));
  ok('K4.6 every part calls useReducedMotion() and its plan<Name>(', k46.length === 0, k46.join('\n'));
  ok('K4.7 no reanimated / utils/moments / linear-gradient / lottie; pure files import only their folder', k47.length === 0, k47.join('\n'));
  ok('K4.8 no colour literal, no shadow / elevation key in the kit', k48.length === 0, k48.join('\n'));
  ok("K4.9 keyframes only in css/kitCss.ts: transform / opacity, durations as 'ms' strings, fill 'backwards'", k49.length === 0, k49.join('\n'));
  ok('K4.10 every file using useNativeDriver imports nativeDriver from @/components/ui/motion', k410.length === 0, k410.join('\n'));
  const double = walk('app', /\.(ts|tsx)$/).concat(walk('components', /\.(ts|tsx)$/), walk('hooks', /\.(ts|tsx)$/))
    .filter((f) => { const s = src(f); return /\bStaggerList\b/.test(s) && /\brevealStagger\b/.test(s) && /import/.test(s); });
  ok('K4.11 no file imports both StaggerList and revealStagger (no double stagger)', double.length === 0, double.join('\n'));

  // ── K5 marketing kit ───────────────────────────────────────────────────────
  const cssRaw = read('marketing/assets/motion-kit.css');
  const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const mediaAt = css.search(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{/);
  const media = mediaAt >= 0 ? group(css, css.indexOf('{', mediaAt)) : '';
  const mediaStart = mediaAt >= 0 ? css.indexOf('{', mediaAt) : -1;
  const inMedia = (i: number) => mediaStart >= 0 && i > mediaStart && i < mediaStart + media.length;
  const c1: string[] = [];
  const ANIMATED_OK = /^(transform|opacity)$/;
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const body = group(css, (m.index ?? 0) + m[0].length - 1);
    if (!m[1].startsWith('mk-')) c1.push(`@keyframes ${m[1]}: not mk-*`);
    for (const p of body.matchAll(/([\w-]+)\s*:/g)) if (!ANIMATED_OK.test(p[1])) c1.push(`@keyframes ${m[1]} animates ${p[1]}`);
    if (!inMedia(m.index ?? 0)) c1.push(`@keyframes ${m[1]} outside the no-preference block`);
  }
  for (const m of css.matchAll(/(?:^|[;{\s])(transition(?:-property)?)\s*:\s*([^;}]+)/g)) {
    const props = m[1] === 'transition-property'
      ? m[2].split(',').map((x) => x.trim())
      : m[2].split(',').map((x) => x.trim().split(/\s+/)[0]);
    for (const p of props) if (!ANIMATED_OK.test(p)) c1.push(`a transition on ${p}`);
  }
  for (const m of css.matchAll(/(?:^|[;{\s])(animation(?:-name|-duration|-delay|-timing-function|-fill-mode|-iteration-count)?|transition(?:-property|-duration|-timing-function|-delay)?)\s*:/g)) {
    if (!inMedia(m.index ?? 0)) c1.push(`${m[1]} outside @media (prefers-reduced-motion: no-preference) (line ${line(css, m.index ?? 0)})`);
  }
  if (/!important/.test(css)) c1.push('!important');
  if (/\b(backdrop-filter|filter|box-shadow)\s*:/.test(media)) c1.push('filter / backdrop-filter / box-shadow inside the motion block');
  for (const m of css.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((x) => x.trim()).filter(Boolean);
    const isFrame = sels.every((x) => /^(from|to|\d+(\.\d+)?%)$/.test(x));
    if (isFrame) continue;
    for (const sel of sels) if (!sel.startsWith('.mk-') && !sel.startsWith('[data-mk')) c1.push(`selector ${sel}`);
    if (/will-change/.test(m[2]) && !sels.every((x) => x.startsWith('.mk-run'))) c1.push(`will-change outside .mk-run (${m[1].trim()})`);
  }
  for (const m of css.matchAll(/animation(?:-fill-mode)?\s*:\s*([^;}]+)/g)) if (/\b(forwards|both)\b/.test(m[1])) c1.push(`fill mode in "${m[1].trim()}"`);
  for (const m of css.matchAll(/cubic-bezier\(([^)]*)\)/g)) {
    const n = m[1].split(',').map((x) => Number(x.trim()));
    if (n.length !== 4 || n[1] < 0 || n[1] > 1 || n[3] < 0 || n[3] > 1) c1.push(`overshooting ${m[0]}`);
  }
  ok('K5.1 motion-kit.css: transform / opacity only, all motion under no-preference, mk- selectors, no !important, no overshoot, fill never forwards / both',
    c1.length === 0 && media.length > 0, c1.join('\n') || (media.length ? '' : 'no @media (prefers-reduced-motion: no-preference) block'));

  const jsRaw = read('marketing/assets/motion-kit.js');
  const js = stripComments(jsRaw);

  // K5.5 — a custom property is a timing curve OR a number, never both. An
  // un-indexed item inherits the nearest --mk-<name>; when that is a curve,
  // calc() is invalid and its delay silently falls to 0 s (the stagger cap breaks).
  const curveVars = new Set([...css.matchAll(/(--mk-[\w-]+)\s*:\s*(?:cubic-bezier|steps|ease|linear)\b/g)].map((m) => m[1]));
  const numVars = new Set<string>();
  for (const m of css.matchAll(/calc\(/g)) for (const v of group(css, (m.index ?? 0) + 4).matchAll(/var\(\s*(--mk-[\w-]+)/g)) numVars.add(v[1]);
  for (const m of css.matchAll(/var\(\s*(--mk-[\w-]+)\s*,\s*-?[\d.]/g)) numVars.add(m[1]);
  for (const m of js.matchAll(/\bprop\(\s*\w+\s*,\s*'([\w-]+)'/g)) numVars.add('--mk-' + m[1]);
  const clash = [...curveVars].filter((v) => numVars.has(v));
  const curveUse: string[] = [];
  for (const m of css.matchAll(/(?:animation|transition)(?:-timing-function)?\s*:\s*([^;}]+)/g)) {
    for (const v of m[1].matchAll(/var\(\s*(--mk-[\w-]+)/g)) if (!curveVars.has(v[1]) && !/calc\(/.test(m[1])) curveUse.push(`${v[1]} used as a curve but never declared as one`);
  }
  ok('K5.5 no --mk-* custom property is both a timing curve and a number (stagger index, calc, JS --mk-*)', clash.length === 0 && curveUse.length === 0,
    clash.map((v) => `${v} is a curve and a number`).concat(curveUse).join('\n'));

  // K5.6 — the stack's chapter sits above every depth layer until the group plays, then is gone.
  const cssRules = [...css.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const zOf = (r: { body: string }) => Number((r.body.match(/z-index\s*:\s*(-?\d+)/) ?? [])[1]);
  const depthZ = Math.max(...cssRules.filter((r) => /^\.mk-d\d$/.test(r.sel)).map(zOf).filter(Number.isFinite));
  const chapterZ = Math.max(-Infinity, ...cssRules.filter((r) => r.sel.split(',').some((x) => /^\.mk-stacked\s*>\s*\[data-mk-chapter\]$/.test(x.trim()))).map(zOf).filter(Number.isFinite));
  const chapterGone = cssRules.some((r) => r.sel.split(',').some((x) => /\.mk-done/.test(x) && /\[data-mk-chapter\]$/.test(x.trim())) && /opacity\s*:\s*0\b/.test(r.body) && /pointer-events\s*:\s*none/.test(r.body));
  const chapterFades = /\.mk-in\s+\[data-mk-chapter\]\s*\{[^}]*animation\s*:\s*mk-out\s+160ms/.test(css);
  const stackFadesIn = cssRules.some((r) => /\.mk-stacked\.mk-in\s*>\s*\[data-mk-card\]/.test(r.sel) && /animation\s*:\s*mk-fade\s+160ms/.test(r.body) && !/transform/.test(r.body));
  ok(`K5.6 stack: chapter z-index ${chapterZ} above every depth layer (${depthZ}), cross-fades 160 ms into the stack, and is hidden (pointer-events none) once played`,
    Number.isFinite(depthZ) && chapterZ > depthZ && chapterGone && chapterFades && stackFadesIn,
    [!(chapterZ > depthZ) && 'the chapter is not above the depth layers', !chapterGone && 'no .mk-done rule hides the chapter', !chapterFades && 'the chapter does not fade out over 160 ms', !stackFadesIn && 'the stack does not fade in (opacity only) over 160 ms'].filter(Boolean).join('\n'));

  // K5.7 — the push-in scales the ≤ 720×720 frame, never the section around it.
  const groupPush = cssRules.filter((r) => r.sel.split(',').some((x) => /\.mk-pushed$/.test(x.trim())) && /transform\s*:/.test(r.body));
  const framePush = cssRules.some((r) => /\.mk-pushed\s+\[data-mk-frame\]$/.test(r.sel) && /scale\(1\.06\)/.test(r.body));
  const gate = /g\.frame\.w\s*<=\s*720\s*&&\s*g\.frame\.h\s*<=\s*720/.test(js);
  ok('K5.7 focus-push: the transform sits on [data-mk-frame], gated on a frame ≤ 720×720', groupPush.length === 0 && framePush && gate,
    [groupPush.length && `the group itself is transformed: ${groupPush.map((r) => r.sel).join(' | ')}`, !framePush && 'no .mk-pushed [data-mk-frame] scale(1.06) rule', !gate && 'the JS gate is not w ≤ 720 && h ≤ 720'].filter(Boolean).join('\n'));

  // K5.8 — at most 3 flyers: the rest carry mk-rest (no fly), the 3rd carries the +N chip.
  const restOff = cssRules.some((r) => /\.mk-in\s+\[data-mk-doc\]\.mk-rest$/.test(r.sel) && /animation\s*:\s*none/.test(r.body));
  const restJs = /classList\.toggle\(\s*'mk-rest'\s*,\s*i\s*>=\s*d\s*\)/.test(js) && /d\s*=\s*SPEC\.caps\.flyers/.test(js) && /setAttribute\(\s*'data-mk-more'/.test(js);
  ok('K5.8 file: docs past SPEC.caps.flyers get mk-rest (animation: none) and the 3rd carries data-mk-more', restOff && restJs,
    [!restOff && 'no .mk-in [data-mk-doc].mk-rest { animation: none }', !restJs && 'the JS does not cap the flyers at SPEC.caps.flyers with a +N chip'].filter(Boolean).join('\n'));
  const c2: string[] = [];
  if (!/^\s*\(function\s*\(/.test(js)) c2.push('not one IIFE');
  if ((js.match(/\(function\s*\(window/g) ?? []).length !== 1) c2.push('not exactly one top-level IIFE');
  if (!/'use strict'/.test(js)) c2.push("no 'use strict'");
  if (/https?:/.test(js) || /\bgsap\b|\bLenis\b|\bjQuery\b/i.test(js)) c2.push('a remote URL, gsap, Lenis or jQuery');
  if (!/IntersectionObserver/.test(js)) c2.push('no IntersectionObserver');
  if (!/matchMedia\(\s*'\(prefers-reduced-motion: reduce\)'\s*\)/.test(js) || !/addEventListener\(\s*'change'|addListener\(/.test(js)) c2.push('no reduce media query with a change listener');
  if (/addEventListener\(\s*['"]scroll/.test(js)) c2.push('a scroll listener');
  const mAt = js.indexOf('function measure(');
  const mBody = mAt >= 0 ? group(js, js.indexOf('{', mAt)) : '';
  const mStart = mAt >= 0 ? js.indexOf('{', mAt) : -1;
  for (const m of js.matchAll(/getBoundingClientRect|\boffset(?:Top|Left|Width|Height|Parent)\b|\bclient(?:Width|Height|Top|Left)\b|\bscroll(?:Width|Height|Top|Left)\b|getComputedStyle/g)) {
    const i = m.index ?? 0;
    if (!(mStart >= 0 && i > mStart && i < mStart + mBody.length)) c2.push(`layout read ${m[0]} outside measure() (line ${line(js, i)})`);
  }
  for (const m of js.matchAll(/\.style\.(\w+)\s*=/g)) if (!/^(transform|opacity)$/.test(m[1])) c2.push(`style write .style.${m[1]}`);
  for (const m of js.matchAll(/\.style\.setProperty\(\s*([^,]+),/g)) if (!/^'--mk-/.test(m[1].trim())) c2.push(`setProperty(${m[1].trim()})`);
  if (/\.(innerHTML|innerText|outerHTML)\s*=|cssText|setAttribute\(\s*'style'/.test(js)) c2.push('innerHTML / innerText / cssText / a style attribute write');
  for (const m of js.matchAll(/(?:setAttribute|removeAttribute)\(\s*([^,)]+)/g)) if (m[1].trim() !== "'data-mk-more'") c2.push(`attribute write ${m[1].trim()} (only data-mk-more, the flyers' +N chip)`);
  if (/createElement|appendChild|insertBefore|\.append\(|\.prepend\(|insertAdjacent/.test(js)) c2.push('the kit creates or moves DOM nodes');
  for (const m of js.matchAll(/(\w+)\.textContent\s*=/g)) {
    if (!new RegExp(`\\b${m[1]}\\s*=\\s*el\\.querySelector\\('\\[data-mk-count\\]'\\)`).test(js)) c2.push(`textContent written on ${m[1]} (only [data-mk-count])`);
  }
  ok('K5.2 motion-kit.js: one strict IIFE, IntersectionObserver, a live reduce query, no scroll listener, reads only in measure(), writes only transform / opacity / --mk-* / classes / the counter text',
    c2.length === 0, c2.join('\n'));

  type MM = { spec?: unknown; springAt?: (t: number, c: unknown, f: number, to: number) => number };
  let MageMotion: MM | null = null;
  try {
    const win: Record<string, unknown> = {};
    new Function('window', 'document', jsRaw)(win, undefined);
    MageMotion = (win.MageMotion as MM) ?? null;
  } catch (e) {
    ok('K5.3 motion-kit.js executes with a bare window', false, String(e));
  }
  const wantSpec = { spring: K.KIT_SPRING, ms: K.KIT_MS, stagger: K.KIT_STAGGER, dist: K.KIT_DIST, scale: K.KIT_SCALE, opacity: K.KIT_OPACITY, caps: K.KIT_CAPS, web: K.KIT_WEB, chat: K.CHAT_STACK };
  const deepDiff = (a: unknown, b: unknown, path = ''): string[] => {
    if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object') {
      const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
      return [...keys].flatMap((k) => deepDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
    }
    return a === b ? [] : [`${path}: ${String(a)} (app: ${String(b)})`];
  };
  const specDiff = MageMotion ? deepDiff(MageMotion.spec, wantSpec) : ['MageMotion not exposed'];
  ok('K5.3 MageMotion.spec deep-equals kitSpec + CHAT_STACK', specDiff.length === 0, specDiff.slice(0, 10).join('\n'));
  let portErr = Infinity;
  if (MageMotion?.springAt) {
    portErr = 0;
    for (const s of Object.values(K.KIT_SPRING)) for (let t = 0; t <= 800; t += 3.7) portErr = Math.max(portErr, Math.abs(MageMotion.springAt(t, s, 0, 1) - K.springAt(t, s, 0, 1)));
  }
  ok(`K5.3 MageMotion.springAt equals springAt on a grid within 1e-3 (max ${Number.isFinite(portErr) ? portErr.toExponential(2) : '—'})`, portErr <= 1e-3);
  const jsGz = gzipSync(Buffer.from(jsRaw)).length;
  ok(`K5.4 motion-kit.js ≤ 16 000 bytes raw (${Buffer.byteLength(jsRaw)}) and ≤ 5 200 gzip (${jsGz}); motion-kit.css ≤ 6 000 raw (${Buffer.byteLength(cssRaw)})`,
    Buffer.byteLength(jsRaw) <= 16000 && jsGz <= 5200 && Buffer.byteLength(cssRaw) <= 6000);

  // ── K6 ratchets ────────────────────────────────────────────────────────────
  const APP = walk('app', /\.(ts|tsx|js|jsx)$/).concat(walk('components', /\.(ts|tsx|js|jsx)$/), walk('hooks', /\.(ts|tsx|js|jsx)$/));
  let literals = 0; let looped = 0;
  const loopHits: string[] = [];
  for (const f of APP) {
    const s = src(f);
    literals += (s.match(/useNativeDriver\s*:\s*(true|false)\b/g) ?? []).length;
    for (const g of groupsAfter(s, 'Animated.loop')) {
      const inner = g.slice(1, -1).trim();
      const single = /^Animated\.timing\(/.test(inner) && (inner.match(/Animated\.\w+\(/g) ?? []).length === 1;
      if (!single) { looped += 1; loopHits.push(f); }
    }
  }
  ok(`K6.1 useNativeDriver: true|false literals in app/, components/, hooks/: ${literals} ≤ BASELINE ${BASELINE_NATIVE_DRIVER_LITERALS}`, literals <= BASELINE_NATIVE_DRIVER_LITERALS);
  ok(`K6.2 Animated.loop calls that are not one Animated.timing: ${looped} ≤ BASELINE ${BASELINE_LOOPED_SEQUENCES}`, looped <= BASELINE_LOOPED_SEQUENCES, loopHits.join('\n'));
  if (literals < BASELINE_NATIVE_DRIVER_LITERALS) console.log(`  NOTE  the literal count fell to ${literals} — lower BASELINE_NATIVE_DRIVER_LITERALS to lock it in.`);
  if (looped < BASELINE_LOOPED_SEQUENCES) console.log(`  NOTE  the looped-sequence count fell to ${looped} — lower BASELINE_LOOPED_SEQUENCES to lock it in.`);

  finish();
}

function finish() {
  if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } }
  if (failures > 0) {
    console.log(`\n✗ validate-motion-kit: ${failures} failing check(s)`);
    console.log('FAILED: ' + failed.map((f) => f.split(' ')[0]).join(' '));
    process.exit(1);
  }
  console.log('\n✓ validate-motion-kit: the kit moves only transform and opacity, on the native driver, with a Reduce Motion path and real numbers');
}

void main();
