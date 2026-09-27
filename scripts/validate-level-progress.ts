// validate-level-progress.ts — honest long waits (loader lane CONTENT-B).
//
//   bun run scripts/validate-level-progress.ts      (package.json: test:level-progress)
//
// Long AI jobs used to fake progress: a code-check checklist that ticked off on
// 1700 ms timers, rotating labels, a beam loop that hitched whenever JS was
// busy and snapped five lit marks off in one frame. This guard holds the fix:
//
//   A. progressMath.ts — the ONE table the native loop and the web keyframes
//      both play: an eased sweep sampled at 25 points, a laser invisible at
//      the wrap, marks that light exactly when the drawn laser crosses them
//      and decay over 600 ms, the web frames equal to the native ranges.
//   B. WorkProgress.tsx — the elapsed interval only updates elapsed text; the
//      count rule is a scaleX FLIP from the left; no percent anywhere; the web
//      crane only behind a >= 120 test with Platform.OS read at render.
//   C. CodeCheckLoader.tsx — one linear native loop, only off the web; no
//      sequence / delay / 0 ms reset; `activeStep` never drives anything;
//      "What we check" without a real stepIndex; "Recalling the code" kept.
//   D. codeCheckCss.ts — keyframes only inside StyleSheet.create, 'ms'
//      strings, fill mode 'backwards' only, frames from the shared table.
//   E. extract-submittals / compare-drawings — the analyzing branch renders
//      WorkProgress with a typical range, no CraneLoader, no rotating labels.
//
// Pure: node:fs + the pure progressMath module (no react-native import).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as P from '../components/loaders/progressMath';
import { evalRange } from '../utils/levelTimeline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

let passes = 0;
let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; return; }
  failures++;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const strictlyUp = (xs: readonly number[]) => xs.every((x, k) => k === 0 || x > xs[k - 1]);

/** Comments blanked (strings and template literals respected), newlines kept. */
function code(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && n === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
    i++;
  }
  return out;
}

/** The balanced (...) / {...} group opening at `open`. */
function group(src: string, open: number): string {
  const o = src[open];
  const cl = o === '(' ? ')' : o === '{' ? '}' : ']';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === cl) { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return src.slice(open);
}

/** The body of the block that follows `anchor` (its first `{`). '' when the anchor is missing. */
function blockAfter(src: string, anchor: string | RegExp): string {
  const m = typeof anchor === 'string' ? { index: src.indexOf(anchor), len: anchor.length } : (() => {
    const r = anchor.exec(src);
    return { index: r ? r.index : -1, len: r ? r[0].length : 0 };
  })();
  if (m.index < 0) return '';
  const open = src.indexOf('{', m.index + m.len - 1);
  return open < 0 ? '' : group(src, open);
}

/** The body of `function name(...) { ... }` (the brace AFTER the parameter list). */
function fnBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return '';
  const open = at + `function ${name}`.length;
  const params = group(src, open);
  const brace = src.indexOf('{', open + params.length);
  return brace < 0 ? '' : group(src, brace);
}

/** Every setInterval(...) call's argument group. */
function intervals(src: string): string[] {
  const out: string[] = [];
  let i = src.indexOf('setInterval(');
  while (i >= 0) {
    out.push(group(src, i + 'setInterval'.length));
    i = src.indexOf('setInterval(', i + 1);
  }
  return out;
}

const HEX = /#[0-9a-fA-F]{3,8}\b/;

// ── A. The shared table ──────────────────────────────────────────────────────
{
  const sweep = P.codeCheckSweepUnit();
  check('A sweep: 25 eased samples over [0, 0.86] + the hold at 1 (26 inputs)', sweep.inputRange.length === 26
    && sweep.inputRange[0] === 0 && near(sweep.inputRange[24], P.CODE_CHECK_SWEEP_END) && sweep.inputRange[25] === 1,
  JSON.stringify(sweep.inputRange));
  check('A sweep inputs strictly increasing', strictlyUp(sweep.inputRange));
  check('A sweep outputs run 0 → 1, never backwards, held at 1', sweep.outputRange[0] === 0 && sweep.outputRange[24] === 1
    && sweep.outputRange[25] === 1 && sweep.outputRange.every((y, k) => k === 0 || y >= sweep.outputRange[k - 1]));
  check('A sweep is easeInOutCubic sampled (midpoint 0.5, quarter 0.0625)', near(sweep.outputRange[12], 0.5, 1e-4)
    && near(sweep.outputRange[6], 0.0625, 1e-4));
  check('A the loop is 3000 ms, the laser 35 %, the sweep ends at 0.86', P.CODE_CHECK_SWEEP_MS === 3000
    && P.CODE_CHECK_LASER_OPACITY === 0.35 && P.CODE_CHECK_SWEEP_END === 0.86);

  const y = P.codeCheckLaserY(300);
  check('A laserY: 0 at t = 0, sheetH from the sweep end to the wrap', y.outputRange[0] === 0 && y.outputRange[24] === 300
    && y.outputRange[25] === 300 && JSON.stringify(y.inputRange) === JSON.stringify(sweep.inputRange));
  const op = P.codeCheckLaserOpacity;
  check('A laser opacity [0,.06,.80,.86,1] → [0,1,1,0,0] (invisible at the wrap: the seam)',
    JSON.stringify(op.inputRange) === JSON.stringify([0, 0.06, 0.8, 0.86, 1]) && JSON.stringify(op.outputRange) === JSON.stringify([0, 1, 1, 0, 0]));
  check('A the laser is dark whenever it is at the bottom or jumping back', evalRange(op, 0.86) === 0 && evalRange(op, 0.93) === 0 && evalRange(op, 1) === 0 && evalRange(op, 0) === 0);

  check('A MARK_STOPS unchanged (uneven on purpose)', JSON.stringify(P.MARK_STOPS) === JSON.stringify([0.18, 0.33, 0.47, 0.62, 0.79]));
  for (const stop of P.MARK_STOPS) {
    const r = P.codeCheckMarkOpacity(stop);
    const lit = r.inputRange[2];
    check(`A mark ${stop}: 5 strictly increasing inputs from 0 to 1`, r.inputRange.length === 5 && strictlyUp(r.inputRange)
      && r.inputRange[0] === 0 && r.inputRange[4] === 1, JSON.stringify(r.inputRange));
    check(`A mark ${stop}: [0,0,1,0,0] — dark at t = 0 and t = 1`, JSON.stringify(r.outputRange) === JSON.stringify([0, 0, 1, 0, 0]));
    check(`A mark ${stop}: lights when the DRAWN laser reaches its height`, near(evalRange(sweep, lit), stop, 1e-3),
      `laser at ${evalRange(sweep, lit)} when lit`);
    check(`A mark ${stop}: 0.04 lead, 0.20 decay (600 ms), dark before 0.99`, near(lit - r.inputRange[1], 0.04, 1e-4)
      && near(r.inputRange[3], Math.min(lit + 0.2, 0.99), 1e-4) && r.inputRange[3] <= 0.99 && near(0.2 * P.CODE_CHECK_SWEEP_MS, 600));
    check(`A mark ${stop}: fully decayed while the laser is still visible`, r.inputRange[3] <= op.inputRange[2]);
  }

  // The web frames ARE the native ranges.
  const frames = P.codeCheckLaserFrames(300);
  const pcts = frames.map((f) => parseFloat(f.pct));
  check('A laser frames: percentage keys strictly increasing, 0 % … 100 %', strictlyUp(pcts) && pcts[0] === 0 && pcts[pcts.length - 1] === 100
    && frames.every((f) => /^\d+(\.\d+)?%$/.test(f.pct)));
  check('A laser frames: opacity 0 at 0 % and 100 % (the seam)', frames[0].opacity === 0 && frames[frames.length - 1].opacity === 0);
  check('A laser frames: translateY(px) strings, 0px at 0 %, sheetH at 100 %', frames.every((f) => /^translateY\(-?\d+(\.\d+)?px\)$/.test(f.transform ?? ''))
    && frames[0].transform === 'translateY(0px)' && frames[frames.length - 1].transform === 'translateY(300px)');
  const union = new Set([...y.inputRange, ...op.inputRange]);
  check('A laser frames: one frame at every breakpoint of either native range', frames.length === union.size);
  let framesMatch = true;
  for (const f of frames) {
    const t = parseFloat(f.pct) / 100;
    const ty = parseFloat((f.transform ?? '').replace(/[^\d.-]/g, ''));
    if (!near(ty, evalRange(y, t), 1e-3) || !near(f.opacity, evalRange(op, t), 1e-3)) framesMatch = false;
  }
  check('A laser frames equal the native ranges at every key', framesMatch);
  check('A frames carry transform / opacity only', frames.every((f) => Object.keys(f).every((k) => k === 'pct' || k === 'transform' || k === 'opacity')));
  let marksMatch = true;
  for (const stop of P.MARK_STOPS) {
    const r = P.codeCheckMarkOpacity(stop);
    const mf = P.codeCheckMarkFrames(stop);
    if (mf.length !== 5 || mf.some((f, i) => !near(parseFloat(f.pct) / 100, r.inputRange[i], 1e-6) || f.opacity !== r.outputRange[i] || f.transform)) marksMatch = false;
    if (mf[0].opacity !== 0 || mf[4].opacity !== 0 || mf[0].pct !== '0%' || mf[4].pct !== '100%') marksMatch = false;
  }
  check('A mark frames equal the native mark ranges (opacity only, 0 at 0 % and 100 %)', marksMatch);

  // WorkProgress numbers.
  check('A formatElapsed: 0:00, 0:14, 1:12, 10:05; negative / NaN → 0:00', P.formatElapsed(0) === '0:00' && P.formatElapsed(14000) === '0:14'
    && P.formatElapsed(14999) === '0:14' && P.formatElapsed(72000) === '1:12' && P.formatElapsed(605000) === '10:05'
    && P.formatElapsed(-5) === '0:00' && P.formatElapsed(Number.NaN) === '0:00');
  check('A elapsedLine: "0:14 · usually 20–40 s", bare "0:14" without a range', P.elapsedLine(14000, 'usually 20–40 s') === '0:14 · usually 20–40 s'
    && P.elapsedLine(14000) === '0:14' && P.elapsedLine(14000, '  ') === '0:14');
  check('A formatTook: "1.2 s" under a minute, m:ss above', P.formatTook(1234) === '1.2 s' && P.formatTook(500) === '0.5 s' && P.formatTook(72000) === '1:12');
  check('A fillScale: done / total, clamped; no total → 0', P.fillScale({ done: 12, total: 48 }) === 0.25 && P.fillScale({ done: 60, total: 48 }) === 1
    && P.fillScale({ done: 3, total: 0 }) === 0 && P.fillScale({ done: -1, total: 4 }) === 0 && P.fillScale(undefined) === 0);
  check('A countLine: "12 of 48 pages" (no percent)', P.countLine({ done: 12, total: 48, unit: 'pages' }) === '12 of 48 pages'
    && P.countLine({ done: 3, total: 9 }) === '3 of 9');
  check('A the fill FLIP is 240 ms', P.WORK_FILL_MS === 240);
  check('A wrapIndex wraps a list index (and survives an empty list)', P.wrapIndex(3, 4) === 3 && P.wrapIndex(4, 4) === 0 && P.wrapIndex(9, 4) === 1
    && P.wrapIndex(2, 0) === 0 && P.wrapIndex(-1, 4) === 3);
}

// ── B. WorkProgress.tsx ──────────────────────────────────────────────────────
{
  const f = 'components/loaders/WorkProgress.tsx';
  const src = code(read(f));
  const ivs = intervals(src);
  check('B WorkProgress: setInterval only updates elapsed text (setNow) or the facts footer — never a title / label',
    ivs.length >= 1 && ivs.every((g) => (/setNow\(Date\.now\(\)\)/.test(g) || /setFactIdx/.test(g)) && !/title|label|setTitle|setLabel/i.test(g))
    && ivs.some((g) => /setNow\(Date\.now\(\)\)/.test(g)), ivs.join(' | '));
  check('B WorkProgress: the title shown is the prop (or the summary once done), never an index into a list',
    /const shownTitle = done \? summary \?\? title : title;/.test(src) && !/labels?\[/.test(src));
  check('B WorkProgress: the determinate fill is scaleX with transformOrigin left', /scaleX:\s*fill/.test(src) && /transformOrigin:\s*'left'/.test(src));
  check('B WorkProgress: no animated width', !/width:\s*fill\b/.test(src) && !/fill\.interpolate/.test(src));
  check("B WorkProgress: no '%' anywhere — no percent bar, no percent text (indices wrap through progressMath.wrapIndex)", !src.includes('%'));
  check('B WorkProgress: the rule renders only with a real count', /\{count \? \(/.test(src) && /fillScale\(count\)/.test(src));
  const body = fnBody(src, 'WorkProgress');
  check('B WorkProgress: Platform.OS read inside the component (never module scope)',
    body.includes("Platform.OS === 'web'") && !src.replace(body, '').includes('Platform.OS'));
  check('B WorkProgress: the web crane only behind a >= 120 test', /craneW >= CRANE_MIN_W\s*\n?\s*\? <CraneSvg size=\{craneW\} \/>/.test(src)
    && /const CRANE_MIN_W = 120;/.test(src) && /Math\.min\(width \* 0\.5, CRANE_MAX_W\)/.test(src) && /const CRANE_MAX_W = 280;/.test(src)
    && (src.match(/<CraneSvg\b/g) ?? []).length === 1);
  check('B WorkProgress: native / narrow web → The Level at 64 with no reveal plateau', /<LevelMark size=\{64\} revealDelayMs=\{0\} done=\{done\} \/>/.test(src));
  check('B WorkProgress: summary holds LOADER.workProgress.summaryHoldMs, then onDone', /LOADER\.workProgress\.summaryHoldMs/.test(src));
  check('B WorkProgress: progressbar role, live-region title, count value', /accessibilityRole="progressbar"/.test(src)
    && /accessibilityLiveRegion="polite"/.test(src) && /accessibilityValue=\{count \?/.test(src));
  {
    // VoiceOver: an `accessible` View reads as one element and hides its
    // children, so the progressbar group holds only the mark + title + elapsed;
    // the count, steps, actions and facts footer are its siblings.
    const at = src.indexOf('accessibilityRole="progressbar"');
    const group = at >= 0 ? src.slice(at, src.indexOf('</View>', at)) : '';
    check('B WorkProgress: the progressbar group is only mark + title + elapsed (actions / facts reachable by VoiceOver)',
      at >= 0 && /\{mark\}/.test(group) && /-title`/.test(group) && /-elapsed`/.test(group)
      && !/onCancel|onBackground|hasFacts|steps|countLine|\{count \? \(/.test(group));
  }
  check('B WorkProgress: Cancel / background render only when passed', /\{onCancel \? \(/.test(src) && /\{onBackground \? \(/.test(src));
  check('B WorkProgress: no hex literal', !HEX.test(src), (src.match(HEX) ?? [''])[0]);
}

// ── C. CodeCheckLoader.tsx ───────────────────────────────────────────────────
{
  const f = 'components/CodeCheckLoader.tsx';
  const raw = read(f);
  const src = code(raw);
  check('C CodeCheckLoader: no Animated.sequence / Animated.delay', !/Animated\.(sequence|delay)\b/.test(src));
  check('C CodeCheckLoader: no `duration: 0` reset', !/duration:\s*0\b/.test(src));
  check('C CodeCheckLoader: no setValue (never reset a running loop)', !/\.setValue\(/.test(src));
  const uses = src.match(/\bactiveStep\b/g) ?? [];
  check('C CodeCheckLoader: `activeStep` appears only in the props type — never destructured, never in a condition',
    uses.length === 1 && /\n\s*activeStep\?: number;/.test(src), `${uses.length} use(s)`);
  check("C CodeCheckLoader: 'What we check' header", src.includes('What we check'));
  check('C CodeCheckLoader: the optional real stepIndex prop', /\n\s*stepIndex\?: number;/.test(src));
  check('C CodeCheckLoader: ticks / current row only from a real stepIndex', /if \(!real\) return 'neutral';/.test(src)
    && /const real = typeof stepIndex === 'number'/.test(src));
  check("C CodeCheckLoader: 'Recalling the code' kept, 'Reading the code that governs' absent", src.includes('Recalling the code') && !src.includes('Reading the code that governs'));
  check("C CodeCheckLoader: typical defaults to 'usually 5–20 s' and shows under the headline", /typical = 'usually 5–20 s'/.test(src) && /elapsedLine\(now - mountedAt, typical\)/.test(src));
  const loops = src.match(/Animated\.loop\(/g) ?? [];
  const nativeBody = fnBody(src, 'SheetMotionNative');
  const webBody = fnBody(src, 'SheetMotionWeb');
  check('C CodeCheckLoader: exactly one Animated.loop, inside SheetMotionNative', loops.length === 1 && nativeBody.includes('Animated.loop('));
  const loopArg = group(nativeBody, nativeBody.indexOf('Animated.loop(') + 'Animated.loop'.length);
  check('C CodeCheckLoader: the loop is one linear, non-interaction timing on the native driver', /^\(\s*Animated\.timing\(/.test(loopArg)
    && (loopArg.match(/Animated\.timing\(/g) ?? []).length === 1 && /easing:\s*Easing\.linear\b/.test(loopArg)
    && /isInteraction:\s*false\b/.test(loopArg) && /useNativeDriver:\s*nativeDriver\b/.test(loopArg) && /duration:\s*CODE_CHECK_SWEEP_MS\b/.test(loopArg));
  check('C CodeCheckLoader: the web path has no Animated at all', webBody.length > 0 && !/Animated\./.test(webBody) && /codeCheckLaserStyle\(sheetH\)/.test(webBody)
    && /codeCheckMarkStyle\(i\)/.test(webBody));
  const main = fnBody(src, 'CodeCheckLoader');
  check('C CodeCheckLoader: Platform.OS read at render; web → SheetMotionWeb, else SheetMotionNative; Reduce Motion → neither',
    /const web = Platform\.OS === 'web';/.test(main) && /reduce \? null : web\s*\n?\s*\? <SheetMotionWeb/.test(main)
    && /: <SheetMotionNative/.test(main) && !src.replace(main, '').includes('Platform.OS'));
  check('C CodeCheckLoader: the native curves come from the shared table (no local inputRange)', !/inputRange\s*:/.test(src)
    && /codeCheckLaserY\(sheetH\)/.test(nativeBody) && /codeCheckLaserOpacity/.test(nativeBody) && /codeCheckMarkOpacity\(stop\)/.test(nativeBody));
  check('C CodeCheckLoader: no useNativeDriver literal, no easing inside interpolate', !/useNativeDriver:\s*(true|false)\b/.test(src)
    && !/\.interpolate\(\{[^}]*easing\s*:/.test(src));
  check('C CodeCheckLoader: no glow layer (the laser is a line)', !/beamGlow|glow/i.test(src));
  check('C CodeCheckLoader: no hex literal', !HEX.test(src), (src.match(HEX) ?? [''])[0]);
}

// ── D. codeCheckCss.ts ───────────────────────────────────────────────────────
{
  const f = 'components/loaders/css/codeCheckCss.ts';
  const src = code(read(f));
  const creates: string[] = [];
  let ci = src.indexOf('StyleSheet.create(');
  while (ci >= 0) { creates.push(group(src, ci + 'StyleSheet.create'.length)); ci = src.indexOf('StyleSheet.create(', ci + 1); }
  const kfTotal = (src.match(/animationKeyframes/g) ?? []).length;
  const kfInside = creates.reduce((n, g) => n + (g.match(/animationKeyframes/g) ?? []).length, 0);
  check('D codeCheckCss: every animationKeyframes lives inside StyleSheet.create', kfTotal >= 2 && kfTotal === kfInside, `${kfInside}/${kfTotal}`);
  const durs = [...src.matchAll(/animation(?:Duration|Delay)\s*:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  const constMs = (id: string) => new RegExp(`const ${id} = \`\\$\\{\\w+\\}ms\`;`).test(src);
  check("D codeCheckCss: every duration / delay is a string ending in 'ms'", durs.length >= 4
    && durs.every((v) => /^'\d+ms'$/.test(v) || (/^[A-Z_]+$/.test(v) && constMs(v))), durs.join(', '));
  const fills = [...src.matchAll(/animationFillMode\s*:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
  check("D codeCheckCss: fill mode 'backwards' only (never 'both')", fills.length >= 2 && fills.every((v) => v === "'backwards'") && !/'both'/.test(src));
  check('D codeCheckCss: keyframe entries carry transform / opacity only', /type Keyframes = Record<string, \{ transform\?: string; opacity: number \}>;/.test(src)
    && !/(?:width|height|top|left|backgroundColor)\s*:/.test(src));
  check('D codeCheckCss: frames come from the shared table (progressMath), no local numeric table',
    /codeCheckLaserFrames\(h\)/.test(src) && /codeCheckMarkFrames\(stop\)/.test(src) && /from '@\/components\/loaders\/progressMath'/.test(src)
    && !/\[\s*0\s*,\s*0?\.\d/.test(src));
  check('D codeCheckCss: linear, infinite', (src.match(/animationTimingFunction:\s*'linear'/g) ?? []).length === creates.length
    && (src.match(/animationIterationCount:\s*'infinite'/g) ?? []).length === creates.length);
  check('D codeCheckCss: no hex literal', !HEX.test(src));
}

// ── E. The two analyzing branches ────────────────────────────────────────────
for (const [f, anchor, title, typical] of [
  ['app/extract-submittals.tsx', "if (step === 'uploading' || step === 'analyzing') {", "step === 'uploading' ? 'Rendering pages' : 'Reading the spec book'", 'usually 60–90 s'],
  ['app/compare-drawings.tsx', "if (step === 'analyzing') {", '"Comparing sheets"', 'usually 30–60 s'],
] as const) {
  const src = code(read(f));
  const block = blockAfter(src, anchor);
  check(`E ${f}: the analyzing branch exists`, block.length > 0);
  check(`E ${f}: renders WorkProgress with the real phase and typical="${typical}"`, /<WorkProgress\b/.test(block)
    && block.includes(`typical="${typical}"`) && block.includes(title));
  check(`E ${f}: no CraneLoader and no rotating labels in the branch`, !/CraneLoader/.test(block) && !/\blabels=/.test(block));
  check(`E ${f}: facts kept as the footer`, /facts=\{CONSTRUCTION_FACTS\}/.test(block));
  check(`E ${f}: imports WorkProgress; no unused CraneLoader import`, /import WorkProgress from '@\/components\/loaders\/WorkProgress';/.test(src)
    && (!/import CraneLoader\b/.test(src) || (src.match(/\bCraneLoader\b/g) ?? []).length > 1));
}

if (failures > 0) {
  console.error(`\nvalidate-level-progress: ${failures} failed, ${passes} passed`);
  process.exit(1);
}
console.info(`validate-level-progress: all ${passes} checks passed`);
