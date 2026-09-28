// moments-checks/capsule.ts: the Commit Capsule's checks (lane CAPSULE).
// Run by scripts/validate-moments.ts, which passes the shared helpers.
//
// C1  every MOMENT_SPRING entry has ζ in [0.75, 1.05]
// C2  dock/contractTrail/expand/homeLead equal Motion.spring snap/glideTrail/rise/glideLead (designTokens TEXT)
// C3  capsuleMath: the resistance curve, its native table, the rubber bands
// C4  shouldCommit / lockStep / notchStep truth tables
// C5  runCommit: the honest-outcome rules (fake clock)
// C6  resolvePlan: only 'confirmed' is ever 'success' (exhaustive)
// C7  lintMomentCopy, then every string literal in components/moments/** and utils/moments/**
// C8  no hex / rgb() / rgba() literal, no inline fontSize
// C9  no reanimated / GestureDetector / masked view / lottie / skia / confetti / bounce tokens
// C10 the drag is an Animated.event on the native driver; every useNativeDriver is `nativeDriver`
// C11 no LayoutAnimation / layoutNext on the slider subtree
// C12 CapsuleTone is exactly 'brand' | 'ink' | 'warning'
// C13 the success tone and the check legs are driven only inside Success/Confirmed functions
// C14 the button mode: an 'activate' action, announcements, a Confirm and a Cancel segment
// C15 Reduce Motion comes from '@/components/ui/motion' only
// C16 mutation proof: each of C5, C6, C7, C12, C13 is run against a mutant and must go red
//
// Mutants are written to $MOMENTS_MUT_DIR (kept, for the report) or a temp dir (removed).

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { MomentsCtx } from '../validate-moments';
import { MOMENT_SPRING, dampingRatio } from '../../utils/moments/motionSpec';
import {
  bodyScale, disabledTable, lockStep, notchStep, resist, resistanceTable, rubber, shouldCommit,
} from '../../utils/moments/capsuleMath';
import * as commitResultReal from '../../utils/moments/commitResult';
import * as copyReal from '../../utils/moments/copy';

type CommitMod = typeof commitResultReal;
type CopyMod = typeof copyReal;
type Fails = string[];

const MOMENT_DIRS = ['components/moments', 'utils/moments'];
const SIGNLINE_SEAL = /components\/moments\/signing\//;

// ─────────────────────────────────────────────────────────────────────────────
// small helpers
// ─────────────────────────────────────────────────────────────────────────────

function interp(x: number, t: { inputRange: number[]; outputRange: number[] }): number {
  const I = t.inputRange;
  const O = t.outputRange;
  if (x <= I[0]) return O[0];
  if (x >= I[I.length - 1]) return O[O.length - 1];
  for (let i = 1; i < I.length; i++) {
    if (x <= I[i]) return O[i - 1] + ((O[i] - O[i - 1]) * (x - I[i - 1])) / (I[i] - I[i - 1]);
  }
  return O[O.length - 1];
}

/** A fake clock for setTimeout/clearTimeout; advance(ms) fires due timers in order. */
function fakeClock() {
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  let now = 0;
  let seq = 0;
  const q: { id: number; at: number; cb: () => void }[] = [];
  (globalThis as any).setTimeout = (cb: () => void, ms?: number) => { const id = ++seq; q.push({ id, at: now + (ms ?? 0), cb }); return id; };
  (globalThis as any).clearTimeout = (id: number) => { const i = q.findIndex((t) => t.id === id); if (i >= 0) q.splice(i, 1); };
  return {
    pendingDelays: () => q.map((t) => t.at - now),
    advance(ms: number) {
      now += ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at);
        const t = q[0];
        if (!t || t.at > now) break;
        q.shift();
        t.cb();
      }
    },
    restore() { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; },
  };
}

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

/** Brace-matched body ranges of every named function (declarations and const arrows). */
function functionRanges(code: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  const re = /(?:function\s+(\w+)\s*\(|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]*?)?=>\s*\{)/g;
  for (const m of code.matchAll(re)) {
    const name = m[1] ?? m[2];
    let from = m.index! + m[0].length - 1;
    if (m[1]) {
      // a declaration: skip the parameter list (its types may hold braces) to the body
      let paren = 0;
      for (let i = m.index! + m[0].length - 1; i < code.length; i++) {
        if (code[i] === '(') paren++;
        else if (code[i] === ')') { paren--; if (paren === 0) { from = i; break; } }
      }
    }
    const open = code.indexOf('{', from);
    if (open < 0) continue;
    let depth = 0;
    let end = -1;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end > 0) out.push({ name, start: open, end });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// C5 / C6 / C7 / C12 / C13 as pure functions (so C16 can run them on mutants)
// ─────────────────────────────────────────────────────────────────────────────

async function checkRunCommit(m: CommitMod): Promise<Fails> {
  const f: Fails = [];
  const base = { idempotent: false, subject: 'CO #4', verb: 'recorded' };
  const expectTimeout = 'No answer yet. Check CO #4 before trying again.';
  const nothingSaved = /nothing was saved/i;

  // confirmed passes through
  {
    const r = await m.runCommit(async () => ({ status: 'confirmed', title: 'CO #4 approved · $52,400.00' }), base);
    if (r.status !== 'confirmed' || r.title !== 'CO #4 approved · $52,400.00') f.push(`confirmed did not pass: ${JSON.stringify(r)}`);
  }
  // legal + queued -> refused, legalQueuedCopy
  {
    const r = await m.runCommit(async () => ({ status: 'queued' }), { ...base, legal: true, verb: 'signed' });
    if (r.status !== 'refused' || r.reason !== 'Not signed. Signing needs a connection, so nothing was signed.') f.push(`legal+queued: ${JSON.stringify(r)}`);
  }
  // non-legal queued stays queued
  {
    const r = await m.runCommit(async () => ({ status: 'queued' }), base);
    if (r.status !== 'queued') f.push(`queued (not legal) became ${r.status}`);
  }
  // never-resolving, non-idempotent: timeout at exactly 20000 ms on a fake clock
  {
    const clock = fakeClock();
    try {
      let late: unknown = null;
      const p = m.runCommit(() => new Promise<never>(() => {}), { ...base, onLateResult: (r) => { late = r; } });
      const delays = clock.pendingDelays();
      if (!delays.includes(m.COMMIT_TIMEOUT_MS) || m.COMMIT_TIMEOUT_MS !== 20000) f.push(`default timeout is not a 20000 ms timer: ${delays.join(',')}`);
      let settled: any = null;
      p.then((r) => { settled = r; });
      clock.advance(19999); await flush();
      if (settled) f.push('settled before 20 s');
      clock.advance(1); await flush();
      if (!settled || settled.status !== 'timeout' || settled.message !== expectTimeout) f.push(`non-idempotent timeout: ${JSON.stringify(settled)}`);
      if (settled && nothingSaved.test(JSON.stringify(settled))) f.push('a non-idempotent timeout said "nothing was saved"');
      if (late) f.push('onLateResult fired with no late answer');
    } finally { clock.restore(); }
  }
  // never-resolving, idempotent: refused, nothing was saved
  {
    const clock = fakeClock();
    try {
      let settled: any = null;
      m.runCommit(() => new Promise<never>(() => {}), { ...base, idempotent: true }).then((r) => { settled = r; });
      clock.advance(20000); await flush();
      if (!settled || settled.status !== 'refused' || settled.reason !== 'Not recorded. The connection dropped, so nothing was saved.') f.push(`idempotent timeout: ${JSON.stringify(settled)}`);
    } finally { clock.restore(); }
  }
  // thrown transport error
  {
    const r1 = await m.runCommit(async () => { throw new TypeError('Network request failed'); }, base);
    if (r1.status !== 'timeout' || nothingSaved.test(JSON.stringify(r1))) f.push(`transport, non-idempotent: ${JSON.stringify(r1)}`);
    const r2 = await m.runCommit(async () => { throw new Error('Failed to fetch'); }, { ...base, idempotent: true });
    if (r2.status !== 'refused' || !nothingSaved.test((r2 as any).reason ?? '')) f.push(`transport, idempotent: ${JSON.stringify(r2)}`);
  }
  // thrown non-transport: the server answered no
  {
    const r = await m.runCommit(async () => { throw new Error('new row violates check constraint'); }, { ...base, verb: 'approved' });
    if (r.status !== 'refused' || r.reason !== 'Not approved. Something went wrong on our side.') f.push(`non-transport throw: ${JSON.stringify(r)}`);
  }
  // a late answer goes to onLateResult only
  {
    const clock = fakeClock();
    try {
      let resolveWrite: (r: any) => void = () => {};
      const lates: any[] = [];
      let settled: any = null;
      m.runCommit(() => new Promise<any>((res) => { resolveWrite = res; }), { ...base, timeoutMs: 1000, onLateResult: (r) => lates.push(r) })
        .then((r) => { settled = r; });
      clock.advance(1000); await flush();
      resolveWrite({ status: 'confirmed', title: 'Payment recorded' }); await flush();
      if (!settled || settled.status !== 'timeout') f.push(`late answer changed the settled result: ${JSON.stringify(settled)}`);
      if (lates.length !== 1 || lates[0].status !== 'confirmed') f.push(`late answer not handed to onLateResult: ${JSON.stringify(lates)}`);
    } finally { clock.restore(); }
  }
  // an on-time answer never reaches onLateResult
  {
    const lates: any[] = [];
    await m.runCommit(async () => ({ status: 'confirmed', title: 'Paid in full · Balance $0.00' }), { ...base, onLateResult: (r) => lates.push(r) });
    await flush();
    if (lates.length) f.push('an on-time answer reached onLateResult');
  }
  // never throws: sync throw, garbage answer, a throwing isTransport
  {
    try {
      const a = await m.runCommit((() => { throw new Error('boom'); }) as any, base);
      const b = await m.runCommit((async () => undefined) as any, base);
      const c = await m.runCommit(async () => { throw new Error('x'); }, { ...base, isTransport: () => { throw new Error('bad predicate'); } });
      if (a.status !== 'refused' || b.status !== 'refused' || c.status !== 'refused') f.push(`not normalised: ${JSON.stringify([a, b, c])}`);
    } catch (e) {
      f.push(`runCommit threw: ${String(e)}`);
    }
  }
  return f;
}

function checkResolvePlan(m: CommitMod): Fails {
  const f: Fails = [];
  const results: any[] = [
    { status: 'confirmed', title: 'Done' },
    { status: 'queued' },
    { status: 'refused', reason: 'Not recorded. Something went wrong on our side.' },
    { status: 'timeout', message: 'No answer yet. Check CO #4 before trying again.' },
  ];
  for (const r of results) {
    for (const legal of [undefined, false, true]) {
      for (const resultIcon of [undefined, 'check', 'lock', 'flag'] as const) {
        const p = m.resolvePlan(r, { legal, resultIcon });
        let want: string;
        if (r.status === 'confirmed') want = (resultIcon ?? 'check') === 'check' ? 'success' : 'neutral-done';
        else if (r.status === 'queued') want = legal ? 'uncommit' : 'queued';
        else if (r.status === 'refused') want = 'uncommit';
        else want = 'timeout';
        if (p !== want) f.push(`${r.status} legal=${legal} icon=${resultIcon}: ${p} (want ${want})`);
        if (p === 'success' && r.status !== 'confirmed') f.push(`${r.status} mapped to success`);
      }
    }
  }
  return f;
}

const FIXED_COPY = [
  'Not recorded. The connection dropped, so nothing was saved.',
  'No answer yet. Check CO #4 before trying again.',
  'Not signed. Signing needs a connection, so nothing was signed.',
  "You're offline. Signing needs a connection.",
  'Not approved. Something went wrong on our side.',
  'Saved on this phone · sends when online',
  'Double-tap, then confirm',
  'Slide to approve · +$4,200.00',
  'Paid in full · Balance $0.00',
  'CO #4 approved · $52,400.00',
  'Period locked · Sep 2026',
  'Awarded · override recorded',
  'Confirm approve · +$4,200.00. Button. Cancel. Button.',
];

function checkLint(m: CopyMod): Fails {
  const f: Fails = [];
  const must = (s: string, why: string) => { if (m.lintMomentCopy(s).length === 0) f.push(`did not flag ${why}: ${JSON.stringify(s)}`); };
  must(`Not recorded ${String.fromCharCode(0x2014)} the connection dropped.`, 'an em dash');
  must('Approved!', 'an exclamation mark');
  must('Slide to approve · $4,200', 'an amount without cents');
  must('Slide to record $4.5', 'a one-digit cents amount');
  must('Slide To Approve Now', 'Title Case');
  must('slide to approve · $4,200.00', 'a leading lowercase letter');
  must('Slide to  approve', 'a double space');
  must('Slide to approve ', 'a trailing space');
  must(`Not signed ${String.fromCharCode(0x2013)} offline`, 'an en dash between words');
  for (const s of FIXED_COPY) {
    const r = m.lintMomentCopy(s);
    if (r.length) f.push(`flagged the fixed copy ${JSON.stringify(s)}: ${r.join(', ')}`);
  }
  if (m.MOMENT_COPY.srHint !== 'Double-tap, then confirm') f.push(`MOMENT_COPY.srHint is ${JSON.stringify(m.MOMENT_COPY.srHint)}`);
  if (m.MOMENT_COPY.queued !== 'Saved on this phone · sends when online') f.push(`MOMENT_COPY.queued is ${JSON.stringify(m.MOMENT_COPY.queued)}`);
  return f;
}

/** The literal strings a user could read, from comment-stripped code (templates with ${…} -> X). */
function copyLiterals(code: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const m of code.matchAll(re)) {
    const before = code.slice(Math.max(0, m.index! - 24), m.index!);
    if (/(?:\bfrom|\bimport|require\(|jest\.mock\(|import\()\s*$/.test(before)) continue;
    let text = m[1] ?? m[2] ?? m[3] ?? '';
    if (m[3] != null) text = text.replace(/\$\{[^}]*\}/g, 'X');
    text = text.replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (!/\s/.test(text) || !/[A-Za-z]/.test(text)) continue;
    if (/^[a-z0-9-]+$/.test(text)) continue;
    if (/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(text)) continue; // SVG path data / viewBox
    out.push({ text, line: code.slice(0, m.index!).split('\n').length });
  }
  return out;
}

function checkToneUnion(colorsSrc: string, others: { path: string; code: string }[]): Fails {
  const f: Fails = [];
  const m = colorsSrc.match(/export\s+type\s+CapsuleTone\s*=\s*([^;]+);/);
  if (!m) return ['utils/moments/colors.ts declares no `export type CapsuleTone = …;`'];
  const members = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  const extra = m[1].replace(/'[^']*'/g, '').replace(/[\s|]/g, '');
  if (JSON.stringify(members) !== JSON.stringify(['brand', 'ink', 'warning']) || extra) f.push(`CapsuleTone = ${m[1].trim()}`);
  for (const o of others) {
    if (/\btype\s+CapsuleTone\s*=/.test(o.code)) f.push(`${o.path} re-declares CapsuleTone`);
    if (/\btone=\{?\s*['"](?:danger|destructive|void)['"]/.test(o.code)) f.push(`${o.path} passes a destructive commit tone`);
  }
  return f;
}

const SUCCESS_DRIVE = /(?:\btw|\bsp|Animated\.(?:timing|spring))\(\s*[\w.]*\b(?:tone\.success|checkShort|checkLong)\b|\b(?:tone\.success|checkShort|checkLong)\.setValue\(/g;

function checkSuccessGate(files: { path: string; code: string }[]): Fails {
  const f: Fails = [];
  for (const { path, code } of files) {
    if (SIGNLINE_SEAL.test(path)) continue; // the seal is the line skin's success, played via playConfirmed
    const ranges = functionRanges(code);
    for (const m of code.matchAll(SUCCESS_DRIVE)) {
      const at = m.index!;
      const inside = ranges.some((r) => at > r.start && at < r.end && /Success|Confirmed/.test(r.name));
      if (!inside) f.push(`${path}:${code.slice(0, at).split('\n').length} drives ${m[0].trim()} outside a Success/Confirmed function`);
    }
  }
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function run(ctx: MomentsCtx): Promise<void> {
  const { ok, read, stripComments, listFiles } = ctx;
  const files = MOMENT_DIRS.flatMap((d) => listFiles(d, ['.ts', '.tsx'])).map((path) => ({ path, raw: read(path), code: stripComments(read(path)) }));
  const coreFiles = files.filter((x) => x.path.startsWith('components/moments/core/') || x.path === 'components/moments/SlideToConfirm.tsx');
  const componentFiles = files.filter((x) => x.path.startsWith('components/moments/'));

  // C1
  for (const [name, cfg] of Object.entries(MOMENT_SPRING)) {
    const z = dampingRatio(cfg);
    ok(`C1 MOMENT_SPRING.${name}: ζ ${z.toFixed(3)} in [0.75, 1.05]`, z >= 0.75 && z <= 1.05);
  }

  // C2
  {
    const tokens = stripComments(read('constants/designTokens.ts'));
    const block = tokens.slice(tokens.indexOf('spring: {'));
    const preset = (n: string) => {
      const m = block.match(new RegExp(`\\b${n}:\\s*\\{([^}]*)\\}`));
      const num = (k: string) => Number(((m?.[1] ?? '').match(new RegExp(`\\b${k}:\\s*([\\d.]+)`)) ?? [])[1]);
      return { stiffness: num('stiffness'), damping: num('damping'), mass: num('mass') };
    };
    const pairs: [keyof typeof MOMENT_SPRING, string][] = [['dock', 'snap'], ['contractTrail', 'glideTrail'], ['expand', 'rise'], ['homeLead', 'glideLead']];
    for (const [ours, theirs] of pairs) {
      const t = preset(theirs);
      const o = MOMENT_SPRING[ours];
      ok(`C2 MOMENT_SPRING.${ours} == Motion.spring.${theirs} (${t.stiffness}/${t.damping}/${t.mass})`,
        t.stiffness === o.stiffness && t.damping === o.damping && t.mass === o.mass,
        `ours ${o.stiffness}/${o.damping}/${o.mass}`);
    }
  }

  // C3
  {
    const T0 = 294;
    ok('C3 resist(0) = 0', Math.abs(resist(0, T0)) < 1e-9);
    ok('C3 resist(24) = 24 (±1e-3)', Math.abs(resist(24, T0) - 24) <= 1e-3, `resist(24) = ${resist(24, T0)}`);
    const h = 0.001;
    const slope = (resist(24, T0) - resist(24 - h, T0)) / h;
    ok('C3 slope at 24 within 0.02 of 1', Math.abs(slope - 1) <= 0.02, `slope ${slope.toFixed(4)}`);
    ok('C3 resist(T) = T', Math.abs(resist(T0, T0) - T0) < 1e-9);
    let mono = true;
    for (let x = -60; x < T0 + 140; x += 0.25) if (resist(x + 0.25, T0) < resist(x, T0)) mono = false;
    ok('C3 resist is monotone on [-60, T+140]', mono);
    for (const T of [150, 262, 320]) {
      const tbl = resistanceTable(T);
      let worst = 0;
      let at = 0;
      for (let x = -60; x <= T + 140; x += 0.5) {
        const e = Math.abs(interp(x, tbl) - resist(x, T));
        if (e > worst) { worst = e; at = x; }
      }
      const inc = tbl.inputRange.every((x, i) => i === 0 || x > tbl.inputRange[i - 1]);
      ok(`C3 resistanceTable(${T}) reproduces resist within 0.25 pt (worst ${worst.toFixed(3)} at ${at}), ${tbl.inputRange.length} stops, increasing`, worst <= 0.25 && inc);
    }
    ok('C3 rubber dim 12 below 0', Math.abs(resist(-30, 262) - rubber(-30, 12)) < 1e-9 && Math.abs(rubber(-60, 12) + 8.8) < 1e-9);
    ok('C3 rubber dim 14 past T', Math.abs(resist(262 + 40, 262) - (262 + rubber(40, 14))) < 1e-9);
    const dt = disabledTable();
    let dWorst = 0;
    for (let x = -200; x <= 200; x += 0.5) dWorst = Math.max(dWorst, Math.abs(interp(x, dt) - rubber(x, 10)));
    ok(`C3 disabledTable reproduces rubber(x, 10) both ways (worst ${dWorst.toFixed(3)})`, dWorst <= 0.25 && interp(200, dt) < 10 && interp(-200, dt) > -10);
    ok('C3 bodyScale clamps to [0, 1] and is 0 when the caps meet',
      bodyScale(100, 44, 56, 350) === 0 && bodyScale(410, 4, 56, 350) === 1 && Math.abs(bodyScale(235, 4, 56, 350) - 0.5) < 1e-9);
  }

  // C4
  {
    const T = 294;
    const sc = (locked: boolean, progress: number, vx: number, f: number) => shouldCommit({ locked, progress, vx, f, T });
    ok('C4 shouldCommit: locked commits', sc(true, 0.1, 0, 30));
    ok('C4 shouldCommit: p .55, vx 900, projection reaching T commits', sc(false, 0.55, 900, T - 900 * 0.099));
    ok('C4 shouldCommit: p .54 fails', !sc(false, 0.54, 2000, 0.54 * T));
    ok('C4 shouldCommit: vx 899 fails', !sc(false, 0.8, 899, 0.8 * T));
    ok('C4 shouldCommit: projection short of T fails', !sc(false, 0.56, 900, T - 900 * 0.099 - 1));
    ok('C4 lockStep: .85 locks', lockStep(false, 0.85, 0.85));
    ok('C4 lockStep: .84 does not lock', !lockStep(false, 0.84, 0.85));
    ok('C4 lockStep: .79 stays locked', lockStep(true, 0.79, 0.85));
    ok('C4 lockStep: .77 unlocks', !lockStep(true, 0.77, 0.85));
    // notches: one per notch per pass, at most 3, re-arm at -0.06
    let n = 0;
    let fires = 0;
    for (let p = 0; p <= 0.84; p += 0.01) { const s = notchStep(n, p, 0.85); n = s.n; if (s.fire) fires++; }
    ok('C4 notchStep: a full pass fires exactly 3', fires === 3 && n === 3, `fires ${fires}, n ${n}`);
    let back = notchStep(1, 0.2, 0.85);
    ok('C4 notchStep: 0.20 under notch 1 does not re-arm (hysteresis)', back.n === 1 && !back.fire);
    back = notchStep(1, 0.18, 0.85);
    ok('C4 notchStep: 0.18 re-arms notch 1', back.n === 0 && !back.fire);
    ok('C4 notchStep: and 0.26 fires it again', notchStep(back.n, 0.26, 0.85).fire);
    ok('C4 notchStep: never fires at or past the threshold', !notchStep(2, 0.9, 0.85).fire && !notchStep(2, 0.75, 0.70).fire);
  }

  // C5
  const c5 = await checkRunCommit(commitResultReal);
  ok('C5 runCommit: confirmed passes; legal+queued refused; 20 s timeout never says "nothing was saved" unless idempotent; transport/non-transport throws; late answers; never throws',
    c5.length === 0, c5.join('\n'));

  // C6
  const c6 = checkResolvePlan(commitResultReal);
  ok('C6 resolvePlan: exhaustive over 4 statuses x legal x resultIcon; only confirmed is success', c6.length === 0, c6.join('\n'));

  // C7
  const c7 = checkLint(copyReal);
  ok('C7 lintMomentCopy flags em dash, "!", no cents, Title Case, leading lowercase, spacing; passes the fixed copy', c7.length === 0, c7.join('\n'));
  {
    const bad: string[] = [];
    let count = 0;
    for (const x of files) {
      for (const lit of copyLiterals(x.code)) {
        count++;
        const r = copyReal.lintMomentCopy(lit.text);
        if (r.length) bad.push(`${x.path}:${lit.line} ${JSON.stringify(lit.text)}: ${r.join(', ')}`);
      }
    }
    ok(`C7 every copy string in components/moments/** and utils/moments/** lints clean (${count} strings)`, bad.length === 0, bad.join('\n'));
  }

  // C8
  {
    const hits: string[] = [];
    for (const x of files) {
      const lines = x.code.split('\n');
      lines.forEach((l, i) => {
        if (/['"`]#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})['"`]/.test(l)) hits.push(`${x.path}:${i + 1} hex colour`);
        if (/\brgba?\(/.test(l)) hits.push(`${x.path}:${i + 1} rgb()/rgba()`);
        if (/\bfontSize\s*:/.test(l)) hits.push(`${x.path}:${i + 1} inline fontSize`);
      });
    }
    ok('C8 no hex / rgb() / rgba() literal and no inline fontSize in components/moments/**, utils/moments/**', hits.length === 0, hits.join('\n'));
  }

  // C9
  {
    const hits: string[] = [];
    const bannedImport = /from\s+['"](?:react-native-reanimated|@react-native-masked-view[^'"]*|lottie-react-native|lottie[^'"]*|@shopify\/react-native-skia)['"]/;
    const bannedToken = /\bGestureDetector\b|\bGesture\.|\bConfetti\b|\bfireConfetti\b|\bfireWebConfetti\b|\bbounciness\b|\bfriction\b|Easing\.bounce|Easing\.elastic|\bscaleXY\b/;
    for (const x of files) {
      x.code.split('\n').forEach((l, i) => {
        if (bannedImport.test(l)) hits.push(`${x.path}:${i + 1} ${l.trim()}`);
        const t = l.match(bannedToken);
        if (t) hits.push(`${x.path}:${i + 1} ${t[0]}`);
      });
    }
    ok('C9 no reanimated / GestureDetector / Gesture. / masked view / lottie / skia / confetti / bounciness / friction / bounce / elastic / scaleXY', hits.length === 0, hits.join('\n'));
  }

  // C10
  {
    const hook = stripComments(read('components/moments/core/useCommitCapsule.ts'));
    const events = [...hook.matchAll(/Animated\.event\(\s*\[\s*\{\s*nativeEvent:\s*\{\s*translationX:[^}]*\}\s*\}\s*\]\s*,\s*\{([^}]*)\}/g)];
    ok('C10 useCommitCapsule drives the drag with Animated.event on translationX, `useNativeDriver: nativeDriver`',
      events.length >= 1 && events.every((e) => /useNativeDriver:\s*nativeDriver\b/.test(e[1])), `found ${events.length}`);
    ok('C10 the legacy PanGestureHandler (never GestureDetector) wraps the head',
      /<PanGestureHandler\b/.test(stripComments(read('components/moments/core/CapsuleShape.tsx'))) && /onHandlerStateChange/.test(hook));
    const bad: string[] = [];
    let n = 0;
    for (const x of componentFiles) {
      for (const m of x.code.matchAll(/useNativeDriver\s*:\s*([^,}\n]+)/g)) {
        n++;
        if (m[1].trim() !== 'nativeDriver') bad.push(`${x.path}:${x.code.slice(0, m.index!).split('\n').length} useNativeDriver: ${m[1].trim()}`);
      }
    }
    ok(`C10 every useNativeDriver in components/moments/** is exactly \`nativeDriver\` (${n})`, bad.length === 0, bad.join('\n'));
  }

  // C11
  {
    const hits = coreFiles.filter((x) => /\bLayoutAnimation\b|\blayoutNext\b/.test(x.code)).map((x) => x.path);
    ok('C11 no LayoutAnimation / layoutNext in components/moments/core/** or SlideToConfirm.tsx', hits.length === 0, hits.join('\n'));
  }

  // C12
  const c12 = checkToneUnion(stripComments(read('utils/moments/colors.ts')), files.filter((x) => x.path !== 'utils/moments/colors.ts'));
  ok("C12 CapsuleTone is exactly 'brand' | 'ink' | 'warning' (no danger/destructive/void)", c12.length === 0, c12.join('\n'));

  // C13
  const c13 = checkSuccessGate(files);
  ok('C13 tone.success and the check legs are driven only inside Success/Confirmed functions', c13.length === 0, c13.join('\n'));

  // C14
  {
    const hook = stripComments(read('components/moments/core/useCommitCapsule.ts'));
    const slide = stripComments(read('components/moments/SlideToConfirm.tsx'));
    ok("C14 accessibilityActions [{ name: 'activate' }] + onAccessibilityAction -> openConfirm",
      /accessibilityActions:\s*\[\s*\{\s*name:\s*'activate'/.test(hook) && /actionName\s*===\s*'activate'/.test(hook));
    ok('C14 announce( on busy, result, failure and the Confirm/Cancel open', (hook.match(/\bannounce\(/g) ?? []).length >= 6);
    ok('C14 SR mode renders a Confirm segment (focus target) and a Cancel segment',
      /ref=\{capsule\.confirmRef\}/.test(slide) && /onPress=\{capsule\.confirm\}/.test(slide) && /onPress=\{capsule\.cancel\}/.test(slide) && />Cancel</.test(slide));
    ok('C14 setAccessibilityFocus moves focus to Confirm (and back on Cancel)', /setAccessibilityFocus/.test(hook) && /focusLater\(confirmRef/.test(hook) && /focusLater\(headRef/.test(hook));
  }

  // C15
  {
    const bad: string[] = [];
    for (const x of componentFiles) {
      if (/isReduceMotionEnabled|reduceMotionChanged|prefers-reduced-motion/.test(x.code)) bad.push(`${x.path}: a private Reduce Motion store`);
      if (/\b(?:reducedMotion|useReducedMotion)\b/.test(x.code) && !/from\s+'@\/components\/ui\/motion'/.test(x.code)) bad.push(`${x.path}: reduced motion not from '@/components/ui/motion'`);
    }
    const hookRaw = read('components/moments/core/useCommitCapsule.ts');
    ok("C15 Reduce Motion is read from '@/components/ui/motion' only", bad.length === 0 && /from '@\/components\/ui\/motion'/.test(hookRaw), bad.join('\n'));
  }

  // C16 mutation proof
  {
    const keep = process.env.MOMENTS_MUT_DIR;
    const dir = keep ?? mkdtempSync(join(tmpdir(), 'moments-mut-'));
    mkdirSync(dir, { recursive: true });
    const nwAbs = join(ctx.root, 'utils', 'networkErrors.ts');
    const commitSrc = readFileSync(join(ctx.root, 'utils/moments/commitResult.ts'), 'utf8').replace("from '@/utils/networkErrors'", `from ${JSON.stringify(nwAbs)}`);
    const copySrc = readFileSync(join(ctx.root, 'utils/moments/copy.ts'), 'utf8');
    const mutate = (src: string, from: string | RegExp, to: string, label: string): string => {
      const out = src.replace(from, to);
      if (out === src) throw new Error(`mutant ${label}: anchor not found`);
      return out;
    };
    // Every mutant is written BEFORE the first import: bun caches a directory's
    // listing on first resolve, so a file written after that is not found.
    const pending: [string, string][] = [];
    const stage = (name: string, src: string) => { pending.push([name, src]); return name; };
    const load = async (name: string) => import(pathToFileURL(join(dir, `${name}.ts`)).href);
    const results: [string, boolean][] = [];
    try {
      const n1 = stage('c5-legal-queued-kept', mutate(commitSrc, /if \(opts\.legal\) return \{ status: 'refused', reason: legalQueuedCopy\(opts\.verb\) \};/, '', 'c5a'));
      const n2 = stage('c5-timeout-says-nothing-saved', mutate(commitSrc, /return opts\.idempotent\s*\?\s*\{ status: 'refused', reason: transportCopy\(opts\.verb, true\) \}\s*:\s*\{ status: 'timeout', message: timeoutCopy\(opts\.subject\) \};/, "return { status: 'refused', reason: transportCopy(opts.verb, true) };", 'c5b'));
      const n3 = stage('c5-late-overrides', mutate(commitSrc, /const n = normalise\(r, opts\);\s*if \(!settle\(n\)\) late\(n\);/, 'const n = normalise(r, opts); settle(n); late(n);', 'c5c'));
      const n4 = stage('c6-refused-success', mutate(commitSrc, /case 'refused':\s*default:\s*return 'uncommit';/, "case 'refused':\n    default:\n      return 'success';", 'c6a'));
      const n5 = stage('c6-lock-success', mutate(commitSrc, "return (o.resultIcon ?? 'check') === 'check' ? 'success' : 'neutral-done';", "return 'success';", 'c6b'));
      const n6 = stage('c7-no-emdash-rule', mutate(copySrc, /if \(s\.includes\(EM_DASH\)\) out\.push\('[^']*'\);/, '', 'c7a'));
      const n7 = stage('c7-no-cents-rule', mutate(copySrc, /if \(\/\\\$\\d\[\\d,\]\*[^\n]*\n/, '\n', 'c7b'));
      for (const [name, src] of pending) writeFileSync(join(dir, `${name}.ts`), src);
      results.push(['C5 red on mutant: legal+queued stays queued', (await checkRunCommit(await load(n1))).length > 0]);
      results.push(['C5 red on mutant: an unknown outcome always says "nothing was saved"', (await checkRunCommit(await load(n2))).length > 0]);
      results.push(['C5 red on mutant: every answer also reaches onLateResult', (await checkRunCommit(await load(n3))).length > 0]);
      results.push(['C6 red on mutant: refused -> success', checkResolvePlan(await load(n4)).length > 0]);
      results.push(['C6 red on mutant: confirmed + lock -> success', checkResolvePlan(await load(n5)).length > 0]);
      results.push(['C7 red on mutant: the em dash rule removed', checkLint(await load(n6)).length > 0]);
      results.push(['C7 red on mutant: the cents rule removed', checkLint(await load(n7)).length > 0]);
      const colorsCode = stripComments(read('utils/moments/colors.ts'));
      const tone = mutate(colorsCode, "'brand' | 'ink' | 'warning'", "'brand' | 'ink' | 'warning' | 'danger'", 'c12');
      writeFileSync(join(dir, 'c12-colors.ts'), tone);
      results.push(["C12 red on mutant: CapsuleTone gains 'danger'", checkToneUnion(tone, []).length > 0]);
      const hookCode = stripComments(read('components/moments/core/useCommitCapsule.ts'));
      const leak = mutate(hookCode, 'const toneV = timeout ? v.tone.neutral : v.tone.danger;', 'const toneV = timeout ? v.tone.neutral : v.tone.danger; tw(v.tone.success, 1, 100);', 'c13');
      writeFileSync(join(dir, 'c13-useCommitCapsule.ts'), leak);
      results.push(['C13 red on mutant: resolveUncommit drives tone.success', checkSuccessGate([{ path: 'components/moments/core/useCommitCapsule.ts', code: leak }]).length > 0]);
      const leak2 = mutate(hookCode, 'const toneV = timeout ? v.tone.neutral : v.tone.danger;', 'const toneV = timeout ? v.tone.neutral : v.tone.danger; v.checkLong.setValue(1);', 'c13b');
      results.push(['C13 red on mutant: resolveUncommit sets a check leg', checkSuccessGate([{ path: 'components/moments/core/useCommitCapsule.ts', code: leak2 }]).length > 0]);
    } catch (e) {
      results.push([`C16 mutants built (${String(e)})`, false]);
    } finally {
      if (!keep) rmSync(dir, { recursive: true, force: true });
    }
    for (const [name, red] of results) ok(`C16 ${name}`, red, 'The check stayed green on a mutant: it does not bite.');
  }
}
