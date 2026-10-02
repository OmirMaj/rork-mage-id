// validate-motion-adopt-a.ts — lane MOTIONADOPT-A's guard (wave 4 motion adoption, part A).
//
//   bun run scripts/validate-motion-adopt-a.ts        (package.json: test:motion-adopt-a)
//
// Four screens (+ two SHOULD rows) adopted the motion kit instead of their own
// motion code. These checks hold the adoption honest:
//
//   VA1 each shipped row imports its kit parts from '@/components/motion/kit'
//       (beatSchedule from '@/utils/motion/kit') and uses them;
//   VA2 no home-made motion left: useNativeDriver literals only on the
//       allowlist, no looped sequences, ThinkingStates / QuizQuestionCard /
//       MessageBubble carry no animation code of their own;
//   VA3 honesty: the loading steps are never timed, the fun-fact interval is
//       the overlay's only interval, a receipt tick only renders in the 'done'
//       block, client messages never pass a bare `live`;
//   VA4 caps ≤ 8 and no kit part inside a FlatList / SectionList renderItem;
//   VA5 Reduce Motion read only through useReducedMotion; beatSchedule gets it;
//   VA6 the skills check contract (StackPush only under intro || question,
//       the reducer pins, a decorative QuizQuestionCard renders no testID);
//   VA7 the ratchet print (owned files: 2 literals, 0 looped sequences; the
//       repo-wide K6 counts with validate-motion-kit's own regex).
//
// Every site file is read as TEXT, comment-stripped (stripComments / group are
// copies of validate-motion-kit's: that script runs on import).
//
// MUTATION PROOF: set MOTIONADOPT_A_MUT_DIR to a directory that mirrors repo
// paths; a file found there is read INSTEAD of the repo copy.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beatSchedule } from '../utils/motion/kit/checkQueue';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MUT = process.env.MOTIONADOPT_A_MUT_DIR;

/** The rows that landed (A1-A4 are MUSTs; A5 / A6 shipped in this lane too). */
const SHIPPED = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'] as const;
type Row = (typeof SHIPPED)[number];
const shipped = (r: Row) => (SHIPPED as readonly string[]).includes(r);

const F = {
  thinking: 'components/ThinkingStates.tsx',
  overlay: 'components/EstimateLoadingOverlay.tsx',
  copilot: 'components/copilot/CopilotShell.tsx',
  skills: 'app/skills-check.tsx',
  quizCard: 'components/learn/QuizQuestionCard.tsx',
  messages: 'app/client-messages.tsx',
  thread: 'hooks/usePortalThread.ts',
  gantt: 'components/schedule/InteractiveGantt.tsx',
  plans: 'components/plans/AskPlansPanel.tsx',
  construction: 'components/construction/AskConstructionMode.tsx',
} as const;

const OWNED: string[] = [
  F.thinking, F.overlay, F.copilot, F.skills, F.quizCard, F.messages, F.thread,
  ...(shipped('A5') ? [F.gantt] : []),
  ...(shipped('A6') ? [F.plans, F.construction] : []),
];

/** useNativeDriver: true|false literals that must stay (JS-driven props). */
const LITERAL_ALLOW: Record<string, number> = {
  [F.messages]: 1, // the send button's backgroundColor spring
  ...(shipped('A5') ? { [F.gantt]: 1 } : {}), // the SVG strokeDashoffset dash loop
};

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

/** Blank out // and /* *\/ comments (strings kept, newlines kept). A copy of validate-motion-kit's. */
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

/** The balanced (…) / {…} / […] group that opens at `open`. A copy of validate-motion-kit's. */
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

/** A JSX opening tag's text from `<Name` to its closing `>` (brace-aware). */
function tagAt(src: string, at: number): string {
  let depth = 0;
  for (let i = at + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' || ch === '(') depth++;
    else if (ch === '}' || ch === ')') depth--;
    else if (ch === '>' && depth === 0 && src[i - 1] !== '=') return src.slice(at, i + 1);
  }
  return src.slice(at);
}
function tags(src: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(tagAt(src, m.index));
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

const code = (rel: string) => stripComments(read(rel));
const S: Record<string, string> = Object.fromEntries(OWNED.map((f) => [f, code(f)]));

/** The names a file imports from a module (named imports only). */
function importsFrom(src: string, mod: string): string[] {
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${mod.replace(/[/.@-]/g, (c) => '\\' + c)}['"]`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) out.push(name);
    }
  }
  return out;
}

/** Used = a JSX tag or a call, past its import. */
function uses(src: string, name: string): boolean {
  return new RegExp(`<${name}\\b`).test(src) || new RegExp(`\\b${name}\\(`).test(src);
}

const KIT_PARTS = [
  'ChatTurn', 'ThinkingRow', 'ThinkingDots', 'StaggerList', 'useStagger', 'CheckSync', 'useCheckBeat', 'useCheckBeats',
  'CountRoll', 'AccumulateCards', 'RangeSettle', 'useFileInto', 'FileIntoLayer', 'PriorityGrid', 'FocusMarker',
  'useFocusRects', 'StackPush', 'useFocusPush', 'CornerTags', 'MatrixFill', 'useEntrance', 'useSeenKeys', 'useDotClock',
];

function main() {
  // ── VA1 kit sites ──────────────────────────────────────────────────────────
  console.log('VA1 kit sites');
  const sites: [Row, string, string[], string[]][] = [
    ['A1', F.thinking, ['StaggerList', 'ThinkingDots'], []],
    ['A1', F.overlay, ['ThinkingDots'], []],
    ['A2', F.copilot, ['ThinkingRow', 'useCheckBeat'], ['beatSchedule']],
    ['A3', F.skills, ['StackPush'], []],
    ['A4', F.messages, ['ChatTurn', 'useSeenKeys'], []],
    ['A5', F.gantt, ['useFocusPush'], []],
    ['A6', F.plans, ['ThinkingRow', 'ChatTurn'], []],
    ['A6', F.construction, ['ChatTurn'], []],
  ];
  for (const [row, file, kit, pure] of sites) {
    if (!shipped(row)) continue;
    const s = S[file];
    const fromKit = importsFrom(s, '@/components/motion/kit');
    const fromPure = importsFrom(s, '@/utils/motion/kit');
    const missing = [
      ...kit.filter((n) => !fromKit.includes(n) || !uses(s, n)),
      ...pure.filter((n) => !fromPure.includes(n) || !uses(s, n)),
    ];
    ok(`VA1 ${row} ${file} imports and uses ${[...kit, ...pure].join(', ')}`, missing.length === 0, missing.length ? 'missing / unused: ' + missing.join(', ') : undefined);
  }
  ok('VA1 A4 usePortalThread exposes `loaded` (isFetched || isError)', /loaded:\s*messagesQ\.isFetched\s*\|\|\s*messagesQ\.isError/.test(S[F.thread]));
  ok('VA1 A4 client-messages reads threadQ.loaded', /threadQ\.loaded/.test(S[F.messages]));

  // ── VA2 no home-made motion ────────────────────────────────────────────────
  console.log('VA2 no home-made motion');
  let ownedLiterals = 0;
  let ownedLooped = 0;
  for (const f of OWNED) {
    const s = S[f];
    const lit = (s.match(/useNativeDriver\s*:\s*(true|false)\b/g) ?? []).length;
    ownedLiterals += lit;
    ok(`VA2 ${f}: useNativeDriver literals ${lit} = allowlist ${LITERAL_ALLOW[f] ?? 0}`, lit === (LITERAL_ALLOW[f] ?? 0));
    let looped = 0;
    for (const g of groupsAfter(s, 'Animated.loop')) {
      const inner = g.slice(1, -1).trim();
      const single = /^Animated\.timing\(/.test(inner) && (inner.match(/Animated\.\w+\(/g) ?? []).length === 1;
      if (!single) looped += 1;
    }
    ownedLooped += looped;
    if (looped) ok(`VA2 ${f}: no Animated.loop around anything but one Animated.timing (${looped})`, false);
  }
  ok('VA2 no owned file loops a sequence', ownedLooped === 0);
  const th = S[F.thinking];
  ok('VA2 ThinkingStates has no Animated.timing / spring / loop and no new Animated.Value',
    !/Animated\.(timing|spring|loop)\b/.test(th) && !/new\s+Animated\.Value/.test(th));
  ok('VA2 QuizQuestionCard has no Animated.timing( of its own', !/Animated\.timing\(/.test(S[F.quizCard]) && !/new\s+Animated\.Value/.test(S[F.quizCard]));
  const msg = S[F.messages];
  const bStart = msg.indexOf('function MessageBubble');
  const bEnd = msg.indexOf('function outboxMessage');
  const bubble = bStart >= 0 && bEnd > bStart ? msg.slice(bStart, bEnd) : '';
  ok('VA2 MessageBubble found (function MessageBubble … function outboxMessage)', bubble.length > 0);
  ok('VA2 MessageBubble has no Animated.spring( and no new Animated.Value', bubble.length > 0 && !/Animated\.spring\(/.test(bubble) && !/new\s+Animated\.Value/.test(bubble));

  // ── VA3 honesty ────────────────────────────────────────────────────────────
  console.log('VA3 honesty');
  ok('VA3 ThinkingStates renders every step: no setInterval / setTimeout / useState', !/\b(setInterval|setTimeout|useState)\b/.test(th));
  const ov = S[F.overlay];
  const intervals = (ov.match(/\bsetInterval\(/g) ?? []).length;
  const effects = groupsAfter(ov, 'useEffect');
  const factEffect = effects.find((g) => /\bsetInterval\(/.test(g));
  ok(`VA3 EstimateLoadingOverlay: exactly one setInterval (${intervals}), inside the effect that reads FUN_FACTS`,
    intervals === 1 && !!factEffect && /FUN_FACTS/.test(factEffect));
  const cp = S[F.copilot];
  const doneAt = cp.indexOf("state.phase === 'done' && landed");
  const nextAt = doneAt >= 0 ? cp.indexOf('state.phase ===', doneAt + 10) : -1;
  const landedSites: number[] = [];
  { const re = /<LandedRow\b/g; let m: RegExpExecArray | null; while ((m = re.exec(cp))) landedSites.push(m.index); }
  ok(`VA3 <LandedRow renders only inside the 'done' block (${landedSites.length} site(s))`,
    doneAt >= 0 && nextAt > doneAt && landedSites.length >= 1 && landedSites.every((i) => i > doneAt && i < nextAt));
  ok('VA3 the receipt rows are built from landed.landed (a real Apply result)', /landed\.landed\.map\(\(l, i\) => \(\s*<LandedRow/.test(cp));
  ok('VA3 at most 8 receipt ticks move: <LandedRow armed={i < 8}> feeds useCheckBeat(\'done\', delayMs, armed)',
    /<LandedRow\b[^>]*\barmed=\{i < 8\}/.test(cp) && /useCheckBeat\('done', delayMs, armed\)/.test(cp));
  const bareLive = (t: string) => /\slive(\s|\/|>)/.test(t) || /\slive=\{\s*true\s*\}/.test(t);
  const msgTurns = tags(msg, 'ChatTurn');
  ok(`VA3 client-messages: ChatTurn's live is an expression (${msgTurns.length} tag(s)), never bare / {true}`,
    msgTurns.length >= 1 && msgTurns.every((t) => /\slive=\{(?!\s*true\s*\})/.test(t) && !bareLive(t)));
  ok('VA3 client-messages: live = the newest message, first time shown, after the seed',
    /seededRef\.current\s*&&\s*newestId\s*&&\s*!seenMsgs\.has\(newestId\)/.test(msg) && /live=\{item\.message\.id === liveId\}/.test(msg));
  for (const f of OWNED) {
    if (f === F.plans || f === F.construction || f === F.messages) continue;
    const bad = tags(S[f], 'ChatTurn').filter(bareLive);
    if (bad.length) ok(`VA3 ${f}: no bare ChatTurn live outside the allowlist`, false);
  }

  // ── VA4 caps and scroll ────────────────────────────────────────────────────
  console.log('VA4 caps and scroll');
  for (const f of OWNED) {
    const s = S[f];
    const caps: number[] = [];
    for (const name of KIT_PARTS) {
      for (const t of tags(s, name)) {
        const m = t.match(/\scap=\{\s*([^}]+)\}/);
        if (m) caps.push(Number(m[1].trim()));
      }
      for (const g of groupsAfter(s, name)) {
        const m = g.match(/\bcap\s*:\s*([^,}\s]+)/);
        if (m) caps.push(Number(m[1].trim()));
      }
    }
    if (caps.length) ok(`VA4 ${f}: every kit cap ≤ 8 (${caps.join(', ')})`, caps.every((c) => Number.isFinite(c) && c <= 8));
    let inList = false;
    for (const list of ['FlatList', 'SectionList']) {
      for (const t of tags(s, list)) {
        const at = t.indexOf('renderItem=');
        if (at < 0) continue;
        let body = group(t, at + 'renderItem='.length);
        const id = body.slice(1, -1).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(id)) {
          // A named renderer: its definition's body (the first {…} group after
          // the name; for an arrow, the group after `=>`).
          const def = s.search(new RegExp(`(const|function)\\s+${id}\\b`));
          if (def >= 0) {
            const arrow = s.indexOf('=>', def);
            const from = arrow >= 0 && arrow - def < 400 ? arrow : def;
            const open = s.slice(from).search(/[({]/);
            body = open >= 0 ? group(s, from + open) : '';
          }
        }
        if (KIT_PARTS.some((n) => uses(body, n))) inList = true;
      }
    }
    ok(`VA4 ${f}: no kit part inside a FlatList / SectionList renderItem`, !inList);
  }

  // ── VA5 Reduce Motion ──────────────────────────────────────────────────────
  console.log('VA5 Reduce Motion');
  for (const f of OWNED) {
    const s = S[f];
    ok(`VA5 ${f}: no AccessibilityInfo.isReduceMotionEnabled / reduceMotionChanged / prefers-reduced-motion`,
      !/isReduceMotionEnabled|reduceMotionChanged|prefers-reduced-motion/.test(s));
    if (/\buseReducedMotion\(/.test(s)) {
      ok(`VA5 ${f}: useReducedMotion comes from '@/components/ui/motion'`, importsFrom(s, '@/components/ui/motion').includes('useReducedMotion'));
    }
    const calls = groupsAfter(s, 'beatSchedule').filter((g) => g.startsWith('('));
    if (calls.length) {
      const bound = [...s.matchAll(/const\s+(\w+)\s*=\s*useReducedMotion\(\)/g)].map((m) => m[1]);
      const args = calls.map((g) => g.slice(1, -1).split(',').map((a) => a.trim()));
      ok(`VA5 ${f}: every beatSchedule( passes the useReducedMotion() value (${args.map((a) => a[1] ?? '—').join(', ')})`,
        bound.length > 0 && args.every((a) => a.length >= 2 && bound.includes(a[1])));
    }
  }
  // beatSchedule's numbers the receipt rides (executed).
  ok('VA5 beatSchedule(3,false) = 0/120/240; (5,false) caps at 4 beats; (3,true) = 0/0/0',
    JSON.stringify(beatSchedule(3, false)) === '[0,120,240]'
    && JSON.stringify(beatSchedule(5, false)) === '[0,120,240,360,360]'
    && JSON.stringify(beatSchedule(3, true)) === '[0,0,0]');

  // ── VA6 skills check contract ──────────────────────────────────────────────
  console.log('VA6 skills check contract');
  const sk = S[F.skills];
  const stackAt = sk.indexOf('<StackPush');
  const before = stackAt >= 0 ? sk.slice(Math.max(0, stackAt - 200), stackAt) : '';
  ok('VA6 StackPush renders only under `phase.kind === \'intro\' || question`',
    stackAt >= 0 && (sk.match(/<StackPush\b/g) ?? []).length === 1 && /\{phase\.kind === 'intro' \|\| question \? \(\s*$/.test(before));
  ok('VA6 the reducer pins: `const phase = state.phase;`, `<QuizResultCard phase={phase}`, useReducer(quizReducer,',
    sk.includes('const phase = state.phase;') && sk.includes('<QuizResultCard phase={phase}') && sk.includes('useReducer(quizReducer,'));
  const stackTag = stackAt >= 0 ? sk.slice(stackAt, stackAt + group(sk, sk.indexOf('renderCard={', stackAt) + 'renderCard='.length).length + 2000) : '';
  ok('VA6 behind cards are empty shells (i > qIndex draws no question)', /\) : i < qIndex \? \([\s\S]*?decorative[\s\S]*?\) : \(\s*<View style=\{styles\.shell\} \/>/.test(stackTag));
  ok('VA6 skills-check no longer passes reduceMotion to the card', !/reduceMotion=\{/.test(sk));
  const qc = S[F.quizCard];
  const testIds = [...qc.matchAll(/testID=\{?([^\s>]+)/g)].map((m) => m[1]);
  ok('VA6 QuizQuestionCard has a `decorative` prop', /decorative\?\s*:\s*boolean/.test(qc));
  ok(`VA6 QuizQuestionCard: every testID goes through tid() (none when decorative) (${testIds.length})`,
    testIds.length > 0 && testIds.every((t) => t.startsWith('tid(')) && /const tid = \(id: string\) => \(decorative \? undefined : id\)/.test(qc));
  ok('VA6 decorative: no announcement, choices as plain Views, hidden from accessibility',
    /if \(!answered \|\| decorative\) return;/.test(qc) && /if \(decorative\) return <View/.test(qc)
    && /accessibilityElementsHidden=\{decorative\}/.test(qc));

  // ── VA7 ratchet print ──────────────────────────────────────────────────────
  console.log('VA7 ratchets');
  const allow = Object.values(LITERAL_ALLOW).reduce((a, b) => a + b, 0);
  ok(`VA7 owned files: useNativeDriver literals ${ownedLiterals} = ${allow} (the allowlist), looped sequences ${ownedLooped} = 0`,
    ownedLiterals === allow && ownedLooped === 0);
  const APP = walk('app', /\.(ts|tsx|js|jsx)$/).concat(walk('components', /\.(ts|tsx|js|jsx)$/), walk('hooks', /\.(ts|tsx|js|jsx)$/));
  let literals = 0; let looped = 0;
  for (const f of APP) {
    const s = code(f);
    literals += (s.match(/useNativeDriver\s*:\s*(true|false)\b/g) ?? []).length;
    for (const g of groupsAfter(s, 'Animated.loop')) {
      const inner = g.slice(1, -1).trim();
      const single = /^Animated\.timing\(/.test(inner) && (inner.match(/Animated\.\w+\(/g) ?? []).length === 1;
      if (!single) looped += 1;
    }
  }
  console.log(`  NOTE  repo-wide K6 (validate-motion-kit's regex): useNativeDriver literals = ${literals}, looped sequences = ${looped}`);

  console.log('');
  if (failures) {
    console.log(`validate-motion-adopt-a: ${failures} FAILED\n  - ${failed.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('validate-motion-adopt-a: all checks passed');
}

main();
