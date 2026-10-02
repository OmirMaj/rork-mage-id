// scripts/validate-ask-look.ts — Ask MAGE's look and motion (lane AILOOK).
//
// The founder said Ask MAGE looked outdated and named the Claude app as the
// reference: your words glide up into the conversation as a neutral bubble, a
// quiet thinking row appears, the answer fades in as plain text with its
// sources under it. Flat, no gradients, no glow, no wobble, and Reduce Motion
// keeps the states while dropping the movement.
//
// This guard holds:
//   NUMBERS (components/brain/ask/askMotion.ts, imported — it has no imports)
//     - every spring's damping ratio ζ = d / (2·√(k·m)) is in [0.75, 1.05];
//     - send.spring == Motion.spring.rise, sendPress.spring == Motion.spring.snap,
//       answer.fadeMs == Motion.duration.enter, chips.staggerMs == Motion.stagger,
//       thinking.fadeMs == Motion.duration.fade — read from the TEXT of
//       constants/designTokens.ts (bun cannot import it: it pulls react-native);
//     - the dots never run into their next cycle; the thinking gate stays under
//       200 ms and "Still working" waits at least 8 s;
//     - the reduced plans carry no travel, no scale, no stagger;
//     - the dots' clock ranges are seamless (last sample == first).
//   SOURCE (comment-stripped AskConversation.tsx + components/brain/ask/*)
//     - no LinearGradient, no shadowColor (no glow), no Animated.loop left in
//       AskConversation (the breathe loop is gone), no Animated.sequence in a
//       loop (it freezes while JS is busy);
//     - every Animated.timing / spring / loop passes `useNativeDriver: nativeDriver`
//       and no `useNativeDriver: true|false` literal exists;
//     - AskMessage and AskThinking read useReducedMotion();
//     - no import of utils/moments or react-native-reanimated; no raw hex;
//     - AskConversation imports useAskCopy + AskActionCard and calls no t();
//     - the user bubble is surfaceAlt, never accentFill;
//     - the thinking row is not a progressbar (it has no value to report).
//
// Pure: imports askMotion.ts only; everything else is read as text.
// Run: bun run scripts/validate-ask-look.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ASK_MOTION, sendEntry, dotPhase, answerEntry, chipDelay, dotRanges,
} from '../components/brain/ask/askMotion';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; }
};

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail.split('\n').join('\n        ') : ''));
}

/** Blank out // and /* *\/ comments; strings and newlines kept. */
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
    i++;
  }
  return out.join('');
}

type Spring = { stiffness: number; damping: number; mass: number };
const zeta = (s: Spring) => s.damping / (2 * Math.sqrt(s.stiffness * s.mass));

console.log('\nAsk MAGE look — numbers:');

// ── every spring in ASK_MOTION ──────────────────────────────────────────────
const springs: [string, Spring][] = [];
(function walk(node: unknown, path: string) {
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (typeof o.stiffness === 'number' && typeof o.damping === 'number' && typeof o.mass === 'number') {
    springs.push([path, o as unknown as Spring]);
    return;
  }
  for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
})(ASK_MOTION, '');
ok('ASK_MOTION has the two springs (send, sendPress)', springs.length >= 2, `found: ${springs.map(([p]) => p).join(', ')}`);
for (const [p, s] of springs) {
  const z = zeta(s);
  ok(`ASK_MOTION.${p}: ζ = ${z.toFixed(3)} in [0.75, 1.05]`, Number.isFinite(z) && z >= 0.75 && z <= 1.05,
    `{ stiffness: ${s.stiffness}, damping: ${s.damping}, mass: ${s.mass} } — below 0.75 wobbles, above 1.05 crawls.`);
}

// ── equal to the Motion tokens (designTokens TEXT) ──────────────────────────
const tokens = stripComments(read('constants/designTokens.ts'));
const motionBlock = tokens.slice(Math.max(0, tokens.indexOf('export const Motion = {')));
const springBlock = motionBlock.slice(Math.max(0, motionBlock.indexOf('spring: {')));
function tokenSpring(name: string): Spring | null {
  const m = new RegExp(`\\b${name}:\\s*\\{([^}]*)\\}`).exec(springBlock);
  if (!m) return null;
  const num = (k: string) => Number((new RegExp(`\\b${k}:\\s*([\\d.]+)`).exec(m[1]) ?? [])[1]);
  return { stiffness: num('stiffness'), damping: num('damping'), mass: num('mass') };
}
function tokenNumber(re: RegExp): number {
  return Number((re.exec(motionBlock) ?? [])[1]);
}
const same = (a: Spring | null, b: Spring) => !!a && a.stiffness === b.stiffness && a.damping === b.damping && a.mass === b.mass;
const rise = tokenSpring('rise');
const snap = tokenSpring('snap');
ok('send.spring == Motion.spring.rise', same(rise, ASK_MOTION.send.spring),
  `ours ${JSON.stringify(ASK_MOTION.send.spring)} vs rise ${JSON.stringify(rise)}`);
ok('sendPress.spring == Motion.spring.snap', same(snap, ASK_MOTION.sendPress.spring),
  `ours ${JSON.stringify(ASK_MOTION.sendPress.spring)} vs snap ${JSON.stringify(snap)}`);
const enter = tokenNumber(/\benter:\s*(\d+)/);
const fade = tokenNumber(/\bfade:\s*(\d+)/);
const stagger = tokenNumber(/\bstagger:\s*(\d+)/);
ok(`answer.fadeMs (${ASK_MOTION.answer.fadeMs}) == Motion.duration.enter (${enter})`, ASK_MOTION.answer.fadeMs === enter);
ok(`chips.staggerMs (${ASK_MOTION.chips.staggerMs}) == Motion.stagger (${stagger})`, ASK_MOTION.chips.staggerMs === stagger);
ok(`thinking.fadeMs (${ASK_MOTION.thinking.fadeMs}) == Motion.duration.fade (${fade})`, ASK_MOTION.thinking.fadeMs === fade);
ok(`chips.fadeMs (${ASK_MOTION.chips.fadeMs}) == Motion.duration.fade (${fade})`, ASK_MOTION.chips.fadeMs === fade);

// ── the dots ────────────────────────────────────────────────────────────────
const D = ASK_MOTION.thinking.dot;
ok(`dots never overlap their next cycle: 2*${D.riseMs} + ${D.count - 1}*${D.staggerMs} <= ${D.periodMs}`,
  2 * D.riseMs + (D.count - 1) * D.staggerMs <= D.periodMs);
const phases = Array.from({ length: D.count }, (_, i) => dotPhase(i));
ok('dotPhase(i): start i*stagger, up = down = rise, rest = period - 2*rise',
  phases.every((p, i) => p.startMs === i * D.staggerMs && p.upMs === D.riseMs && p.downMs === D.riseMs
    && p.restMs === D.periodMs - 2 * D.riseMs && p.restMs >= 0));
const ranges = Array.from({ length: D.count }, (_, i) => dotRanges(i));
ok(`dotRanges: ${D.samples} samples on [0, 1], increasing input`,
  ranges.every((r) => r.opacity.inputRange.length === D.samples && r.scale.outputRange.length === D.samples
    && r.opacity.inputRange[0] === 0 && r.opacity.inputRange[D.samples - 1] === 1
    && r.opacity.inputRange.every((x, k, a) => k === 0 || x > a[k - 1])));
ok('dotRanges: seamless loop (last sample == first) for opacity and scale',
  ranges.every((r) => r.opacity.outputRange[0] === r.opacity.outputRange[D.samples - 1]
    && r.scale.outputRange[0] === r.scale.outputRange[D.samples - 1]));
ok(`dotRanges: opacity within [${D.low}, ${D.high}], scale within [${D.scaleLow}, 1], and each dot reaches its rest`,
  ranges.every((r) => r.opacity.outputRange.every((v) => v >= D.low - 1e-9 && v <= D.high + 1e-9)
    && r.scale.outputRange.every((v) => v >= D.scaleLow - 1e-9 && v <= 1 + 1e-9)
    && r.opacity.outputRange.some((v) => v === D.low)));
ok('dotRanges: the dots are out of phase (dot 1 differs from dot 0)',
  JSON.stringify(ranges[0]?.opacity.outputRange) !== JSON.stringify(ranges[1]?.opacity.outputRange));

// ── timing ──────────────────────────────────────────────────────────────────
ok(`thinking.delayMs (${ASK_MOTION.thinking.delayMs}) < 200 (a fast answer never flashes the row, a slow one is acknowledged)`,
  ASK_MOTION.thinking.delayMs < 200);
ok(`thinking.stillWorkingAfterMs (${ASK_MOTION.thinking.stillWorkingAfterMs}) >= 8000`,
  ASK_MOTION.thinking.stillWorkingAfterMs >= 8000);

// ── the plans ───────────────────────────────────────────────────────────────
for (const v of ['page', 'panel'] as const) {
  const r = sendEntry(v, true);
  ok(`sendEntry('${v}', reduced) = { fromY 0, fromScale 1, fadeMs 100, spring false }`,
    r.fromY === 0 && r.fromScale === 1 && r.fadeMs === 100 && r.spring === false, JSON.stringify(r));
}
const sp = sendEntry('page', false);
const sq = sendEntry('panel', false);
ok(`sendEntry page fromY (${sp.fromY}) > panel fromY (${sq.fromY}) > 0, on the spring`,
  sp.fromY > sq.fromY && sq.fromY > 0 && sp.spring && sq.spring);
ok(`sendEntry(motion).fromScale (${sp.fromScale}) is a hair under 1`, sp.fromScale < 1 && sp.fromScale >= 0.95);
const ar = answerEntry(true);
ok('answerEntry(reduced): fromY 0, no delay', ar.fromY === 0 && ar.delayMs === 0, JSON.stringify(ar));
const am = answerEntry(false);
ok('answerEntry(motion) = the answer numbers', am.delayMs === ASK_MOTION.answer.delayMs && am.fadeMs === ASK_MOTION.answer.fadeMs && am.fromY === ASK_MOTION.answer.fromY);
ok('chipDelay(3, reduced) === 0 (no stagger under Reduce Motion)', chipDelay(3, true) === 0);
ok('chipDelay(3, motion) === delayMs + 3*staggerMs',
  chipDelay(3, false) === ASK_MOTION.chips.delayMs + 3 * ASK_MOTION.chips.staggerMs, String(chipDelay(3, false)));
ok(`chipDelay caps at ${ASK_MOTION.chips.cap} slots (a long list never trails on)`,
  chipDelay(50, false) === chipDelay(ASK_MOTION.chips.cap - 1, false));

// ═══ SOURCE RULES ═══════════════════════════════════════════════════════════

console.log('\nAsk MAGE look — source:');

const ASK_DIR = 'components/brain/ask';
let askFiles: string[] = [];
try { askFiles = readdirSync(join(ROOT, ASK_DIR)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${ASK_DIR}/${f}`); } catch { /* reported */ }
const CONV = 'components/brain/AskConversation.tsx';
const MSG = `${ASK_DIR}/AskMessage.tsx`;
const THINK = `${ASK_DIR}/AskThinking.tsx`;
for (const f of [MSG, THINK, `${ASK_DIR}/AskJumpLatest.tsx`, `${ASK_DIR}/askMotion.ts`]) {
  ok(`${f} exists`, askFiles.includes(f));
}
const files = [CONV, ...askFiles.filter((f) => f.endsWith('.tsx'))];
const src: Record<string, string> = {};
for (const f of [CONV, ...askFiles]) src[f] = stripComments(read(f));

ok('no LinearGradient anywhere in Ask (flat surfaces only)',
  files.every((f) => !/\bLinearGradient\b|expo-linear-gradient/.test(src[f])),
  files.filter((f) => /\bLinearGradient\b|expo-linear-gradient/.test(src[f])).join(', '));
ok('no shadowColor in AskConversation.tsx (no glow on the send button, the mark or a halo)',
  !/\bshadowColor\b/.test(src[CONV]));
ok('no shadowColor in the ask/ components', askFiles.every((f) => !/\bshadowColor\b/.test(src[f])));
ok('no Animated.loop left in AskConversation.tsx (the breathe loop is gone)', !/Animated\.loop\b/.test(src[CONV]));
ok('no Animated.sequence in Ask (a looped sequence restarts through JS and freezes while an answer parses)',
  files.every((f) => !/Animated\.sequence\b/.test(src[f])));

/** The balanced (...) argument text of every `Animated.<kind>(` call. */
function calls(code: string, kind: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`Animated\\.${kind}\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < code.length && depth > 0) {
      if (code[j] === '(') depth++;
      else if (code[j] === ')') depth--;
      j++;
    }
    out.push(code.slice(m.index + m[0].length, j - 1));
  }
  return out;
}
const badDriver: string[] = [];
let callCount = 0;
for (const f of files) {
  for (const kind of ['timing', 'spring', 'loop']) {
    for (const args of calls(src[f], kind)) {
      callCount++;
      if (!/useNativeDriver:\s*nativeDriver\b/.test(args)) badDriver.push(`${f}: Animated.${kind}(${args.replace(/\s+/g, ' ').slice(0, 90)}…)`);
    }
  }
}
ok(`every Animated.timing / spring / loop (${callCount}) passes useNativeDriver: nativeDriver`,
  callCount > 0 && badDriver.length === 0, badDriver.join('\n'));
const literal = files.filter((f) => /useNativeDriver:\s*(?:true|false)\b/.test(src[f]));
ok('no `useNativeDriver: true|false` literal (true warns on every web frame)', literal.length === 0, literal.join(', '));
ok('the dots run on one linear timing inside Animated.loop, isInteraction false',
  calls(src[THINK] ?? '', 'loop').some((a) => /Animated\.timing\(/.test(a) && /Easing\.linear/.test(a) && /isInteraction:\s*false/.test(a)));
ok('dot interpolations clamp and carry no easing', /extrapolate:\s*'clamp'/.test(src[THINK] ?? '')
  && !/interpolate\(\{[^}]*easing/.test(src[THINK] ?? ''));

for (const f of [MSG, THINK]) {
  ok(`${f} reads Reduce Motion (useReducedMotion())`,
    /\buseReducedMotion\(\)/.test(src[f] ?? '') || /from '@\/components\/motion\/kit'/.test(src[f] ?? ''));
}
const banned = files.filter((f) => /from\s+'(?:@\/utils\/moments[^']*|react-native-reanimated)'/.test(src[f]) || /utils\/moments\//.test(src[f]));
ok('no import from utils/moments or react-native-reanimated', banned.length === 0, banned.join(', '));
const hexFiles = askFiles.filter((f) => /['"`]#[0-9a-fA-F]{3,8}['"`]/.test(src[f]));
ok('no raw hex colours in components/brain/ask (theme tokens only)', hexFiles.length === 0, hexFiles.join(', '));

ok('AskConversation imports useAskCopy and AskActionCard',
  /import \{ useAskCopy \} from '@\/hooks\/useAskCopy';/.test(src[CONV]) && /import \{ AskActionCard \} from '@\/components\/brain\/AskActionCard';/.test(src[CONV]));
ok('AskConversation calls no t() of its own (every new string is in useAskCopy)', !/(?<![\w$.])t\(/.test(src[CONV]));
ok('AskConversation renders the do-it card, the thinking row and the turn component',
  /<AskActionCard\b/.test(src[CONV]) && /<AskThinking\b/.test(src[CONV]) && /<AskMessage\b/.test(src[CONV]));
ok('AskConversation shows a Sources label only over real citations',
  /citations\.length > 0 && \(/.test(src[CONV]) && /askCopy\.lookSources/.test(src[CONV]));
ok('the send button says why it is disabled (accessibilityHint + accessibilityState)',
  /accessibilityHint=\{sendHint\}/.test(src[CONV]) && /accessibilityState=\{\{ disabled: sendBlocked \}\}/.test(src[CONV])
  && /askCopy\.lookSendHintBusy/.test(src[CONV]) && /askCopy\.lookSendHintEmpty/.test(src[CONV]));

function entryBody(code: string, key: string): string {
  const at = code.search(new RegExp(`\\n\\s+${key}:\\s*\\{`));
  if (at < 0) return '';
  const open = code.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}') { depth--; if (depth === 0) return code.slice(open, j + 1); }
  }
  return '';
}
const bubble = entryBody(src[MSG] ?? '', 'userBubble');
ok('the user bubble is surfaceAlt, never accentFill (the accent never becomes the background)',
  /backgroundColor:\s*t\.surfaceAlt\b/.test(bubble) && !/accentFill|accent\b/.test(bubble), bubble.replace(/\s+/g, ' '));
ok('the thinking row is not a progressbar (it has no value), and is announced politely',
  !/progressbar/.test(src[THINK] ?? '') && /accessibilityLiveRegion="polite"/.test(src[THINK] ?? ''));
ok('the thinking row carries testID ask-thinking; the turns ask-turn-user / ask-turn-assistant',
  /testID="ask-thinking"/.test(src[THINK] ?? '') && /'ask-turn-user'/.test(src[MSG] ?? '') && /'ask-turn-assistant'/.test(src[MSG] ?? ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
