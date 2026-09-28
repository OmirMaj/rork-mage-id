// validate-money-rounding.ts — money and numbers round half away from zero, in
// decimal space, and print the same digits on iPhone and on the web.
//
//   bun run scripts/validate-money-rounding.ts   (package.json: test:money-rounding)
//
// THE DEFECT (2026-09-27). utils/formatters handed raw floats to
// toLocaleString with fixed fraction digits. Hermes (the iOS engine) formats
// through Apple's NumberFormatter, which rounds an exact half to EVEN; browsers
// and Node round it away from zero. formatMoney(1234.5, 0) printed "$1,234" on
// iPhone and "$1,235" on the web: one invoice, two totals. The Spanish
// foundation work reproduced it on the real Hermes binary. Now every formatter
// rounds first with roundHalfAwayFromZero (on the decimal digits, so 1.005 →
// 1.01 as written), and no formatter ever meets a tie.
//
// (a) On this engine, over thousands of random and edge inputs (ties at 0-3
//     places, their float neighbours, negatives, .005 cases, float-sum
//     artefacts, large values, NaN / null / ±Infinity / -0):
//       - roundHalfAwayFromZero === an independent BigInt reference, always;
//       - every formatter's new output === its old output for every NON-tie;
//       - === the half-away-from-zero value for every tie;
//       - the toLocaleString paths are byte-identical for ties too, because
//         browsers already round half away: the web does not change. Only
//         toFixed (which rounds the binary value: 1.15 is 1.1499…) moves.
// (b) The same formatters run on the repo's Hermes binary, and under node and
//     bun: the new output is identical on all three for every input below
//     2^53 (above it Hermes prints integers from their shortest digits and V8
//     from their exact binary value, a difference no money reaches and this
//     change does not touch, so there it asserts only "unchanged"). Skips
//     (exit 0, loudly) when the binary is missing: non-Mac CI.
// (c) Source ratchet: every toLocaleString in utils/ that formats with fixed
//     fraction digits (or as currency) rounds through roundHalfAwayFromZero,
//     or its value is already whole cents (the allowlist says why).

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { formatMoney, formatMoneyShort, formatNumber, roundHalfAwayFromZero } from '../utils/formatters';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HERMES = join(ROOT, 'node_modules/react-native/sdks/hermesc/osx-bin/hermes');

let failures = 0;
let passes = 0;
const firstFails = new Map<string, number>();
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passes++; return; }
  failures++;
  // Print the first few of each kind, count the rest.
  const key = name.replace(/\(.*$/, '');
  const n = (firstFails.get(key) ?? 0) + 1;
  firstFails.set(key, n);
  if (n <= 5) console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ── The reference: half away from zero on the shortest decimal, in BigInt ───
// Deliberately NOT the helper's code path (that walks characters and carries).

/** The number's shortest round-trip digits, spelled out without an exponent. */
function decimalString(abs: number): string {
  const s = String(abs);
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(s);
  if (!m) return s;
  const digits = m[1] + (m[2] ?? '');
  const exp = Number(m[3]);
  if (exp >= 0) return digits + '0'.repeat(exp - (digits.length - 1));
  return '0.' + '0'.repeat(-exp - 1) + digits;
}
/** A tie at `d` places: exactly d+1 decimals, the last one a 5. */
function isTie(v: number, d: number): boolean {
  if (!Number.isFinite(v)) return false;
  const s = decimalString(Math.abs(v));
  const i = s.indexOf('.');
  return i >= 0 && s.length - i - 1 === d + 1 && s.endsWith('5');
}
function refRound(v: number, d: number): number {
  if (!Number.isFinite(v)) return v;
  const s = decimalString(Math.abs(v));
  const [ip, fp = ''] = s.split('.');
  let k = BigInt(ip + fp.slice(0, d).padEnd(d, '0'));
  if (fp.length > d && fp.charCodeAt(d) >= 53) k += 1n;
  const ks = k.toString().padStart(d + 1, '0');
  const r = Number(d ? `${ks.slice(0, ks.length - d)}.${ks.slice(ks.length - d)}` : ks);
  return v < 0 || Object.is(v, -0) ? -r : r;
}

// ── The shared module: the OLD formatters (verbatim, 44d0de68) + every case ──
// Written to a temp dir, imported here for (a) and bundled for Hermes in (b),
// so the three engines run byte-identical code.
const LIB_SRC = `
import { formatMoney, formatMoneyShort, formatNumber, roundHalfAwayFromZero as r } from '${join(ROOT, 'utils/formatters')}';

function safeNum(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}
export function oldFormatMoney(n: number | null | undefined, decimals = 0): string {
  const num = safeNum(n);
  const abs = Math.abs(num);
  const formatted = '$' + abs.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return num < 0 ? '-' + formatted : formatted;
}
export function oldFormatMoneyShort(n: number | null | undefined): string {
  const num = safeNum(n);
  const abs = Math.abs(num);
  let formatted: string;
  if (abs >= 1000000) formatted = \`$\${(abs / 1000000).toFixed(1)}M\`;
  else if (abs >= 10000) formatted = \`$\${(abs / 1000).toFixed(0)}K\`;
  else formatted = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return num < 0 ? '-' + formatted : formatted;
}
export function oldFormatNumber(n: number | null | undefined, decimals = 0): string {
  return safeNum(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

type X = number | null | undefined;
const num = (x: X): number => (typeof x === 'number' ? x : 0);
const fixed = (d: number) => ({ minimumFractionDigits: d, maximumFractionDigits: d });
const currency = (d: number) => ({ style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d });

/** kind: which value reaches the rounding step (for the tie test in (a)). */
export interface Case { name: string; kind: 'money' | 'number' | 'short' | 'raw'; d: number; toLocale: boolean; run(x: X): [string, string]; }
export const CASES: Case[] = [
  ...[0, 1, 2, 3].map((d): Case => ({ name: \`formatMoney(x, \${d})\`, kind: 'money', d, toLocale: true, run: (x) => [formatMoney(x, d), oldFormatMoney(x, d)] })),
  ...[0, 1, 2].map((d): Case => ({ name: \`formatNumber(x, \${d})\`, kind: 'number', d, toLocale: true, run: (x) => [formatNumber(x, d), oldFormatNumber(x, d)] })),
  { name: 'formatMoneyShort(x)', kind: 'short', d: -1, toLocale: false, run: (x) => [formatMoneyShort(x), oldFormatMoneyShort(x)] },
  ...[0, 1, 2].map((d): Case => ({ name: \`toLocaleString en-US \${d} places\`, kind: 'raw', d, toLocale: true,
    run: (x) => [r(num(x), d).toLocaleString('en-US', fixed(d)), num(x).toLocaleString('en-US', fixed(d))] })),
  ...[0, 2].map((d): Case => ({ name: \`toLocaleString USD currency \${d} places\`, kind: 'raw', d, toLocale: true,
    run: (x) => [r(num(x), d).toLocaleString('en-US', currency(d) as Intl.NumberFormatOptions), num(x).toLocaleString('en-US', currency(d) as Intl.NumberFormatOptions)] })),
  { name: 'toLocaleString en-US maximumFractionDigits 2', kind: 'raw', d: 2, toLocale: true,
    run: (x) => [r(num(x), 2).toLocaleString('en-US', { maximumFractionDigits: 2 }), num(x).toLocaleString('en-US', { maximumFractionDigits: 2 })] },
  // On the magnitude, as formatMoneyShort uses it ((-0.4).toFixed(0) is "-0" but (-0).toFixed(0) is "0").
  ...[0, 1, 2].map((d): Case => ({ name: \`toFixed(\${d}) of |x|\`, kind: 'raw', d, toLocale: false,
    run: (x) => [r(Math.abs(num(x)), d).toFixed(d), Math.abs(num(x)).toFixed(d)] })),
];
export const decode = (t: string): X => (t === 'null' ? null : t === 'undefined' ? undefined : Number(t));
export function runAll(tokens: string[]): { n: string[][]; o: string[][] } {
  const n: string[][] = [];
  const o: string[][] = [];
  for (const t of tokens) {
    const x = decode(t);
    const nn: string[] = [];
    const oo: string[] = [];
    for (const c of CASES) { const [a, b] = c.run(x); nn.push(a); oo.push(b); }
    n.push(nn);
    o.push(oo);
  }
  return { n, o };
}
`;

// ── Inputs (deterministic) ───────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260927);
const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
function nextUp(x: number): number {
  if (x === 0) return Number.MIN_VALUE;
  f64[0] = x;
  i64[0] += x > 0 ? 1n : -1n;
  return f64[0];
}
const nextDown = (x: number): number => -nextUp(-x);
const int = (max: number) => Math.floor(rnd() * max);

const EDGES: (number | null | undefined)[] = [
  0, -0, 0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5, 1234.5, -1234.5, 1234.45, 1234.55, 0.05, 0.15, 0.25, 0.35, 0.45,
  1.005, 1.015, 1.025, 1.045, 2.675, 1.125, 1.375, 1.625, 1.875, 12.345, 0.125, 8.675, 10.235, 1.0005, 1.00049,
  0.4, -0.4, 0.49999999999999994, 999.5, 999.95, 9999.5, 9999.4, 10000, 99999.5, 999499, 999500, 999999.5,
  1050000, 1150000, 1250000, 1350000, 1450000, 12500, 13500, 10500, 15250, 0.1 + 0.2, 1.1 * 3, 0.07 * 100,
  4.35 * 100, 1.15, 1.25, 1.35, 1.45, 1.55, 1.65, 1e-7, 5e-7, 1.5e-7, 1e-6, 1e15 + 0.5, 2 ** 52 + 0.5, 2 ** 51 + 0.25,
  2 ** 53, Number.MAX_SAFE_INTEGER, 1e16, 1e20, 1e21, 1.5e21, 1e25, Number.MAX_VALUE, Number.MIN_VALUE, Number.EPSILON,
  NaN, Infinity, -Infinity, null, undefined, 63360, 63360.5, 1250.5, 82.125, -82.125,
];
const inputs: (number | null | undefined)[] = [...EDGES];
const push = (x: number) => { inputs.push(x, -x); };
for (let i = 0; i < 300; i++) {
  // Decimal ties at 0-3 places and their float neighbours.
  const d = int(4);
  const mag = 10 ** int(9);
  const frac = d === 0 ? '' : String(int(10 ** d)).padStart(d, '0');
  const tie = Number(`${int(mag)}.${frac}5`);
  push(tie);
  push(nextUp(tie));
  push(nextDown(tie));
}
for (let i = 0; i < 80; i++) {
  // formatMoneyShort's three branches, each on a tie: $x.x5M, $xx.5K, $x.5
  push((10 + int(9990)) * 1e5 + 5e4);
  push(10500 + int(989) * 1000);
  push(int(9999) + 0.5);
}
for (let i = 0; i < 250; i++) push(int(2 ** 24) / 8); // exact binary ties (x.5, x.25, x.125 …)
for (let i = 0; i < 300; i++) push(int(1e9) / 100); // whole cents
for (let i = 0; i < 300; i++) push(int(1e9) / 1000); // mills: a tie at 2 places when the last digit is 5
for (let i = 0; i < 300; i++) push(rnd() * 10 ** (int(19) - 3)); // full precision, 1e-3 … 1e15
for (let i = 0; i < 200; i++) {
  let s = 0; // cents summed in floating point: the artefacts real totals carry
  for (let k = 0, n = 2 + int(8); k < n; k++) s += int(100000) / 100;
  push(s);
  push(s * (1 + int(20) / 100)); // with a markup
}
for (let i = 0; i < 100; i++) push(int(2 ** 53)); // big whole numbers
for (let i = 0; i < 50; i++) push(rnd() * 1e19); // past 2^53
const numeric = (x: number | null | undefined): x is number => typeof x === 'number';
console.info(`inputs: ${inputs.length}`);

const dir = mkdtempSync(join(tmpdir(), 'money-rounding-'));
try {
  const libPath = join(dir, 'lib.ts');
  writeFileSync(libPath, LIB_SRC);
  const lib = await import(libPath) as {
    CASES: { name: string; kind: 'money' | 'number' | 'short' | 'raw'; d: number; toLocale: boolean; run(x: number | null | undefined): [string, string] }[];
    oldFormatMoney(n: number | null | undefined, d?: number): string;
    runAll(tokens: string[]): { n: string[][]; o: string[][] };
  };

  // ── (a) this engine ────────────────────────────────────────────────────────
  // The helper against the reference, for every input and 0-3 places.
  for (const x of inputs) {
    if (!numeric(x)) continue;
    for (const d of [0, 1, 2, 3]) {
      const got = roundHalfAwayFromZero(x, d);
      const want = refRound(x, d);
      check(`a helper(${x}, ${d}) === reference`, Object.is(got, want) || (Number.isNaN(got) && Number.isNaN(want)), `got ${got}, want ${want}`);
      if (Number.isFinite(got) && Math.abs(x) < 2 ** 53 / 10 ** d) {
        const s = decimalString(Math.abs(got));
        const places = s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
        check(`a helper(${x}, ${d}) has at most ${d} places`, places <= d, s);
      }
    }
  }
  check('a helper: non-finite and out-of-range places come back untouched',
    Number.isNaN(roundHalfAwayFromZero(NaN, 2)) && roundHalfAwayFromZero(Infinity, 2) === Infinity
    && roundHalfAwayFromZero(-Infinity, 0) === -Infinity && roundHalfAwayFromZero(1.5, -1) === 1.5
    && roundHalfAwayFromZero(1.5, NaN) === 1.5 && roundHalfAwayFromZero(1.5, 101) === 1.5
    && roundHalfAwayFromZero(1.25, 1.9) === 1.3 && Object.is(roundHalfAwayFromZero(-0, 2), -0)
    && Object.is(roundHalfAwayFromZero(-0.4, 0), -0));

  const tiesSeen = new Map<string, number>();
  const toFixedMoved: string[] = [];
  for (const x of inputs) {
    for (const c of lib.CASES) {
      const [nw, od] = c.run(x);
      const label = `${c.name} @ ${String(x)}`;
      if (c.kind === 'short') {
        const n0 = typeof x === 'number' && Number.isFinite(x) ? x : 0;
        const abs = Math.abs(n0);
        const [q, d] = abs >= 1e6 ? [abs / 1e6, 1] : abs >= 1e4 ? [abs / 1e3, 0] : [abs, 0];
        const body = abs >= 1e6 ? `$${refRound(q, 1).toFixed(1)}M` : abs >= 1e4 ? `$${refRound(q, 0).toFixed(0)}K`
          : '$' + refRound(q, 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        const want = n0 < 0 ? '-' + body : body;
        check(`a ${label}: half away from zero`, nw === want, `got ${nw}, want ${want}`);
        if (isTie(q, d)) tiesSeen.set(c.name, (tiesSeen.get(c.name) ?? 0) + 1);
        else check(`a ${label}: a non-tie prints as before`, nw === od, `new ${nw}, old ${od}`);
        if (abs < 1e4) check(`a ${label}: the toLocaleString branch is unchanged on this engine (web)`, nw === od, `new ${nw}, old ${od}`);
        continue;
      }
      const v = typeof x === 'number' && Number.isFinite(x) ? x : c.kind === 'raw' && typeof x === 'number' ? x : 0;
      const at = c.kind === 'money' ? Math.abs(v) : v;
      if (isTie(at, c.d)) {
        tiesSeen.set(c.name, (tiesSeen.get(c.name) ?? 0) + 1);
        // The old code fed the resolved value prints it with no rounding at all.
        const want = c.run(refRound(v, c.d))[1];
        check(`a ${label}: a tie goes away from zero`, nw === want, `got ${nw}, want ${want}`);
        if (!c.toLocale && nw !== od) toFixedMoved.push(`${label}: ${od} → ${nw}`);
      } else {
        check(`a ${label}: a non-tie prints as before`, nw === od, `new ${nw}, old ${od}`);
      }
      if (c.toLocale) check(`a ${label}: unchanged on this engine (browsers already round half away)`, nw === od, `new ${nw}, old ${od}`);
    }
  }
  for (const c of lib.CASES) {
    const n = tiesSeen.get(c.name) ?? 0;
    check(`a ${c.name}: the inputs exercise ties (${n})`, n >= 50, `${n} ties`);
  }
  console.info(`(a) ties exercised: ${[...tiesSeen.values()].reduce((a, b) => a + b, 0)}; toFixed ties that now round away (binary below the tie): ${toFixedMoved.length}, e.g. ${toFixedMoved.slice(0, 3).join('; ')}`);

  // Pinned: what the founder sees.
  const pin = (name: string, got: string | null, want: string) => check(`a pinned ${name}`, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  pin('formatMoney(1234.5)', formatMoney(1234.5), '$1,235');
  pin('formatMoney(-1234.5)', formatMoney(-1234.5), '-$1,235');
  pin('formatMoney(0.5)', formatMoney(0.5), '$1');
  pin('formatMoney(2.5)', formatMoney(2.5), '$3');
  pin('formatMoney(1.005, 2)', formatMoney(1.005, 2), '$1.01');
  pin('formatMoney(2.675, 2)', formatMoney(2.675, 2), '$2.68');
  pin('formatMoney(1.125, 2)', formatMoney(1.125, 2), '$1.13');
  pin('formatMoney(-0.4) keeps its old sign', formatMoney(-0.4), '-$0');
  pin('formatMoney(null)', formatMoney(null), '$0');
  pin('formatMoney(-0, 2)', formatMoney(-0, 2), '$0.00');
  pin('formatNumber(2.5)', formatNumber(2.5), '3');
  pin('formatNumber(-2.5)', formatNumber(-2.5), '-3');
  pin('formatNumber(1234.45, 1)', formatNumber(1234.45, 1), '1,234.5');
  pin('formatMoneyShort(1234.5)', formatMoneyShort(1234.5), '$1,235');
  pin('formatMoneyShort(1150000) (toFixed read 1.1499…)', formatMoneyShort(1150000), '$1.2M');
  pin('formatMoneyShort(-12500)', formatMoneyShort(-12500), '-$13K');
  pin('formatMoneyShort(1234567)', formatMoneyShort(1234567), '$1.2M');

  // The other utils/ money helpers that now round first (pure, importable here).
  const { logMoney } = await import('../utils/logs/logRoutes');
  const { formatMeasured } = await import('../utils/fieldMeasuredQuantity');
  const { formatUsd } = await import('../utils/tutorial/defs/invoiceToSelf');
  const { replaceWarning } = await import('../utils/copilot/estimate/estimatePricing');
  const { formatCurrency } = await import('../utils/cashFlowEngine');
  pin('logMoney(1.125)', logMoney(1.125), '$1.13');
  pin('logMoney(-1.125)', logMoney(-1.125), '-$1.13');
  pin('logMoney(1234.5)', logMoney(1234.5), '$1,234.50');
  pin('formatUsd(1.125)', formatUsd(1.125), '$1.13');
  pin('formatUsd(63360)', formatUsd(63360), '$63,360');
  pin('formatUsd(63360.5)', formatUsd(63360.5), '$63,360.50');
  pin('formatMeasured(12.125, SF)', formatMeasured(12.125, 'SF'), `${(12.13).toLocaleString(undefined, { maximumFractionDigits: 2 })} SF`);
  pin('formatMeasured(2600, LF)', formatMeasured(2600, 'LF'), `${(2600).toLocaleString()} LF`);
  pin('replaceWarning(1.125)', replaceWarning({ items: [{} as never], grandTotal: 1.125 }), 'This replaces your current 1-line estimate ($1.13). The old version is saved.');
  pin('cashFlowEngine formatCurrency(1234.5)', formatCurrency(1234.5), '$1,235');
  pin('cashFlowEngine formatCurrency(-1234.5)', formatCurrency(-1234.5), '-$1,235');

  // ── (b) the repo's Hermes binary vs node vs bun ─────────────────────────────
  // react-native's npm package ships osx-bin/hermes on every OS, so on Linux CI the
  // file EXISTS but is a macOS executable (spawn fails with ENOEXEC). Skip loudly on
  // any non-darwin host, exactly like validate-i18n-hermes; the Mac gate runs (b).
  if (process.platform !== 'darwin' || !existsSync(HERMES)) {
    console.warn(`! validate-money-rounding (b) SKIPPED: ${process.platform !== 'darwin' ? `host is ${process.platform}; the Hermes binary is macOS-only` : `no Hermes binary at ${HERMES}`}. Run on a Mac before a release.`);
  } else {
    const tokens = inputs.map((x) => String(x));
    const probe = join(dir, 'probe.ts');
    const bundle = join(dir, 'probe.js');
    writeFileSync(probe, `import { runAll } from './lib';
const out = runAll(${JSON.stringify(tokens)});
const s = JSON.stringify(out);
const print0 = (globalThis as { print?: (s: string) => void }).print;
if (print0) print0(s); else console.log(s);
`);
    const b = spawnSync('bun', ['build', probe, '--target=browser', '--format=iife', `--outfile=${bundle}`], { encoding: 'utf8' });
    if (b.status !== 0) {
      check('b bun build of the probe', false, b.stderr + b.stdout);
    } else {
      // The three engines run at once (Hermes alone takes ~6 s: Apple builds a
      // NumberFormatter per call).
      const run = (cmd: string) => new Promise<{ n: string[][]; o: string[][] } | null>((resolve) => {
        const p = spawn(cmd, [bundle]);
        let out = '';
        let err = '';
        p.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
        p.stderr.on('data', (c: Buffer) => { err += c.toString('utf8'); });
        p.on('error', (e) => { check(`b ${cmd} ran the probe`, false, String(e)); resolve(null); });
        p.on('close', (code) => {
          if (code !== 0) { check(`b ${cmd} ran the probe`, false, err.slice(0, 400)); resolve(null); return; }
          resolve(JSON.parse(out.trim().split('\n').pop() as string));
        });
      });
      const [hermes, node, bunOut] = await Promise.all([run(HERMES), run('node'), run('bun')]);
      if (hermes && node && bunOut) {
        let oldDiverged = 0;
        let compared = 0;
        const oldExamples: string[] = [];
        inputs.forEach((x, i) => {
          // Past 2^53, and ±Infinity / NaN (Hermes prints "+∞" and a bare "NaN" where
          // V8 prints "∞" and "$NaN"): engine differences the formatters never
          // reach (safeNum makes them 0) and this change does not touch.
          const big = typeof x === 'number' && (Math.abs(x) >= 2 ** 53 || !Number.isFinite(x));
          lib.CASES.forEach((c, k) => {
            const label = `${c.name} @ ${String(x)}`;
            if (big) {
              for (const [eng, out] of [['hermes', hermes], ['node', node], ['bun', bunOut]] as const) {
                check(`b ${eng} ${label}: unchanged past 2^53 / non-finite`, out.n[i][k] === out.o[i][k], `new ${out.n[i][k]}, old ${out.o[i][k]}`);
              }
              return;
            }
            compared++;
            check(`b hermes === node: ${label}`, hermes.n[i][k] === node.n[i][k], `hermes ${hermes.n[i][k]}, node ${node.n[i][k]}`);
            check(`b bun === node: ${label}`, bunOut.n[i][k] === node.n[i][k], `bun ${bunOut.n[i][k]}, node ${node.n[i][k]}`);
            if (hermes.o[i][k] !== node.o[i][k]) {
              oldDiverged++;
              if (oldExamples.length < 3) oldExamples.push(`${label}: iPhone ${hermes.o[i][k]} vs web ${node.o[i][k]}`);
            }
          });
        });
        // The harness can see the defect: the OLD code disagreed on this binary.
        console.info(`(b) Hermes: ${compared} formatted values below 2^53 identical to node and bun. The old formatters disagreed on ${oldDiverged} of them, e.g. ${oldExamples.join('; ')}`);
        const i = inputs.indexOf(1234.5);
        const k = lib.CASES.findIndex((c) => c.name === 'formatMoney(x, 0)');
        check('b pinned on Hermes: formatMoney(1234.5) is $1,235 (it was $1,234)', hermes.n[i][k] === '$1,235', `${hermes.n[i][k]} (old ${hermes.o[i][k]})`);
      }
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ── (c) source ratchet over utils/ ───────────────────────────────────────────
/** Source with // and /* *\/ comments blanked, so prose cannot trip a rule. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1: string) => p1 + ' '.repeat(m.length - p1.length));
}
function walk(d: string, out: string[]): string[] {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
function group(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}
/** The expression `.toLocaleString(` is called on: `abs`, `(cents / 100)`, `roundHalfAwayFromZero(n, 2)`. */
function receiver(src: string, dot: number): string {
  let j = dot - 1;
  if (src[j] === ')') {
    let depth = 0;
    for (; j >= 0; j--) {
      if (src[j] === ')') depth++;
      else if (src[j] === '(' && --depth === 0) break;
    }
    j--;
  }
  while (j >= 0 && /[\w.$]/.test(src[j])) j--;
  return src.slice(j + 1, dot).trim();
}
// Whole cents already: the value has at most 2 places, so no tie reaches the
// formatter. Each is `file → receiver`, with the line that makes it whole.
const WHOLE_CENTS: Record<string, { receiver: string; why: RegExp }[]> = {
  'utils/recoveredValue.ts': [{ receiver: '(cents / 100)', why: /const cents = Math\.round\(n \* 100\);/ }],
  'utils/stripe.ts': [{ receiver: '(serverBalanceCents / 100)', why: /serverBalanceCents\?: number/ }],
  'utils/emailLayout.ts': [{ receiver: 'Math.abs(cents)', why: /const cents = Math\.round\(v \* 100\) \/ 100;/ }],
  'utils/estimateEmailBody.ts': [{ receiver: '(cents / 100)', why: /const toCents = \(n: number\): number => Math\.round\(/ }],
  'utils/subCompliance.ts': [{ receiver: '(Math.round(n * 100) / 100)', why: /Math\.round\(n \* 100\) \/ 100/ }],
  'utils/takeoff/starterConditions.ts': [{ receiver: '(cents / 100)', why: /const cents = Math\.round\(rate \* 100\);/ }],
  'utils/pdfDesign.ts': [{ receiver: 'rounded', why: /const rounded = Math\.round\(Math\.abs\(Number\(n\)\) \* factor\) \/ factor;/ }],
  'utils/aiaBilling.ts': [{ receiver: 'billedToDate', why: /const billedToDate = roundCents\(/ }],
};
{
  const files = walk(join(ROOT, 'utils'), []);
  const offenders: string[] = [];
  let sites = 0;
  for (const f of files) {
    const rel = relative(ROOT, f);
    const src = code(readFileSync(f, 'utf8'));
    check(`c ${rel}: no Intl.NumberFormat (format through toLocaleString after roundHalfAwayFromZero, or extend this validator)`, !/Intl\.NumberFormat\s*\(/.test(src));
    let at = src.indexOf('.toLocaleString(');
    while (at >= 0) {
      const args = group(src, at + '.toLocaleString'.length);
      if (/FractionDigits|currency/.test(args)) {
        sites++;
        const recv = receiver(src, at);
        const rounded = /^roundHalfAwayFromZero\(/.test(recv)
          || (/^\w+$/.test(recv) && new RegExp(`\\b(?:const|let)\\s+${recv}\\s*=\\s*roundHalfAwayFromZero\\(`).test(src));
        const allowed = (WHOLE_CENTS[rel] ?? []).some((w) => w.receiver === recv && w.why.test(src));
        if (!rounded && !allowed) offenders.push(`${rel}: ${recv}.toLocaleString${args.replace(/\s+/g, ' ').slice(0, 80)}`);
      }
      at = src.indexOf('.toLocaleString(', at + 1);
    }
  }
  check(`c every fixed-places toLocaleString in utils/ rounds first or is whole cents (${sites} sites)`, offenders.length === 0,
    `\n    ${offenders.join('\n    ')}\n    → wrap the value in roundHalfAwayFromZero(value, places) from utils/formatters`);
  check('c the scan found the known sites', sites >= 20, `${sites}`);
  for (const [rel, list] of Object.entries(WHOLE_CENTS)) {
    const src = code(readFileSync(join(ROOT, rel), 'utf8'));
    for (const w of list) check(`c allowlist still true: ${rel} ${w.receiver}`, src.includes(`${w.receiver}.toLocaleString(`) && w.why.test(src));
  }
}

if (failures > 0) {
  for (const [k, n] of firstFails) if (n > 5) console.error(`      … ${n - 5} more of: ${k}`);
  console.error(`\n✗ validate-money-rounding: ${failures} failing, ${passes} passing`);
  process.exit(1);
}
console.info(`✓ validate-money-rounding: ${passes} checks — half away from zero, the same digits on Hermes, node and bun`);
