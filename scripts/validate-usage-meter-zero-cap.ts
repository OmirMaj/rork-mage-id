// validate-usage-meter-zero-cap.ts — a quota bar whose cap is zero must not
// paint itself full.
//
// THE BUG THIS PINS (2026-09-02 launch-readiness audit, finding #11).
// app/(tabs)/settings/index.tsx drew the "Advanced" AI meter as
//
//     width: `${Math.min((aiSmartUsed / aiSmartLimit) * 100, 100)}%`
//
// with no zero guard. aiSmartLimit is LIMITS[tier].smart and LIMITS.free.smart
// is 0, so on EVERY brand-new account that is 0 / 0 -> NaN, Math.min(NaN, 100)
// -> NaN, and the template literal produced the string 'NaN%'.
//
// 'NaN%' is not a resolvable dimension. React Native (and react-native-web)
// discard the unparseable width, Yoga falls back to `auto`, and the parent
// View's default alignItems:'stretch' makes the fill span the whole track. The
// result was a COMPLETELY FULL brand-orange bar, labelled "Advanced: 0 of 0",
// on the Settings tab of an account that had made zero AI calls. The one meter
// whose job is to sell the upgrade was visibly lying about consumption.
//
// A silent NaN is invisible to tsc (`${NaN}` is a perfectly good string) and
// invisible to a snapshot that only diffs text, so this guard EVALUATES the
// real width expressions lifted out of the source against hostile numbers:
//
//   * everything zero          -> the free-tier first-run state (0/0 = NaN)
//   * used > 0 with cap 0      -> the other divide-by-zero (n/0 = Infinity)
//   * a normal half-used quota -> proves the guard didn't flatten the meter
//
// Anything that does not stringify to a plain 0-100 percentage fails. Scope is
// deliberately this one screen: a repo-wide sweep would need a real evaluator
// for 78 other bar expressions, and a guard that guesses is a guard that gets
// muted.
//
// Run: bun run scripts/validate-usage-meter-zero-cap.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? `\n        ${detail}` : ''); }
}

const SETTINGS = 'app/(tabs)/settings/index.tsx';
const settings = src(SETTINGS);

// Comments quote the very expression this guard forbids (the header above does
// it too), so every "must not appear" check runs on comment-stripped source.
function code(s: string): string {
  return s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}
const settingsCode = code(settings);

// ── 1. the caps that make this guard necessary are still zero ───────────────
// Re-read from source rather than hard-coding, so re-tiering shows up here
// instead of quietly turning this file into a no-op.
console.log('\n1. the zero caps that produce the divide-by-zero still exist:');

const freeSmart = utils_freeSmartCap();
ok('LIMITS.free.smart is readable from utils/aiRateLimiterCore.ts', freeSmart !== null,
  'the LIMITS table moved or was reshaped — this guard is blind, fix the regex');
ok('LIMITS.free.smart is still 0 (the free tier really has no advanced quota)',
  freeSmart === 0,
  `read ${freeSmart}. If free now has an advanced allowance, the zero-cap branch in ` +
  'Settings is dead copy — remove it and this check deliberately, do not leave both.');

const freeTakeoff = hooks_freeTakeoffCap();
ok('TAKEOFF_PAGES_CAP_BY_TIER.free is readable from hooks/useUsageStatus.ts', freeTakeoff !== null);
ok('TAKEOFF_PAGES_CAP_BY_TIER.free is still 0', freeTakeoff === 0, `read ${freeTakeoff}`);

function utils_freeSmartCap(): number | null {
  const m = src('utils/aiRateLimiterCore.ts').match(/free:\s*\{[^}]*smart:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
function hooks_freeTakeoffCap(): number | null {
  const m = src('hooks/useUsageStatus.ts')
    .match(/TAKEOFF_PAGES_CAP_BY_TIER[^=]*=\s*\{[^}]*free:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

// ── 2. every percentage width in Settings survives a zero cap ───────────────
console.log('\n2. every bar-fill width in Settings evaluates to a real percentage:');

const widths = [...settingsCode.matchAll(/width:\s*`\$\{([\s\S]*?)\}%`/g)].map(m => m[1].trim());
ok('the bar-fill widths are still template percentages this guard can read',
  widths.length >= 3,
  `found ${widths.length} — expected the daily AI, advanced AI and takeoff meters. ` +
  'If the markup changed shape, re-point the regex rather than dropping the check.');

/**
 * Stands in for any identifier the scenario does not name. Numerically 0,
 * every property is another ZERO, and calling it yields ZERO — so a bar added
 * later is still evaluated under an all-zero worst case instead of blowing up
 * this guard with a ReferenceError.
 */
const ZERO: any = new Proxy(function zeroFn() { return ZERO; } as any, {
  get(_t, prop) {
    if (prop === Symbol.toPrimitive) return () => 0;
    if (prop === 'valueOf') return () => 0;
    if (prop === 'toString') return () => '0';
    return ZERO;
  },
  apply() { return ZERO; },
});

function evaluateWidth(expr: string, vals: Record<string, unknown>): string {
  const scope = new Proxy({ ...vals, Math }, {
    has: () => true,
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      return k in t ? (t as any)[k] : ZERO;
    },
  });
  // `with` needs a sloppy-mode function; Function-constructor bodies are
  // sloppy regardless of this module being strict.
  const fn = new Function('__scope', `with (__scope) { return \`\${${expr}}%\`; }`);
  return String(fn(scope));
}

const PERCENT = /^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/;

const SCENARIOS: { label: string; vals: Record<string, unknown>; expect: 'zero' | 'half' }[] = [
  {
    // The free-tier first run that shipped the bug: nothing used, no cap.
    label: 'free tier, nothing used, cap 0 (0/0 = NaN)',
    expect: 'zero',
    vals: {
      aiUsed: 0, aiLimit: 0, aiSmartUsed: 0, aiSmartLimit: 0,
      takeoffQuota: { used: 0, cap: 0 },
    },
  },
  {
    // The other divide-by-zero. Note that Math.min(Infinity, 100) CLAMPS to a
    // perfectly well-formed '100%' — a full bar is the same lie as NaN%, so
    // 'is it a valid percentage' is not enough here: a zero cap must be 0%.
    label: 'usage recorded against a cap of 0 (n/0 = Infinity, clamps to a full bar)',
    expect: 'zero',
    vals: {
      aiUsed: 3, aiLimit: 0, aiSmartUsed: 3, aiSmartLimit: 0,
      takeoffQuota: { used: 3, cap: 0 },
    },
  },
  {
    // Sanity: the guards must not have flattened every meter to 0.
    label: 'a normal half-used quota still reads 50%',
    expect: 'half',
    vals: {
      aiUsed: 3, aiLimit: 6, aiSmartUsed: 3, aiSmartLimit: 6,
      takeoffQuota: { used: 3, cap: 6 },
    },
  },
];

for (const s of SCENARIOS) {
  const results = widths.map(w => {
    try { return evaluateWidth(w, s.vals); } catch (err) { return `THREW: ${String(err)}`; }
  });
  const want = s.expect === 'zero' ? '0%' : '50%';
  const bad = results
    .map((r, i) => ({ r, w: widths[i] }))
    .filter(({ r }) => !PERCENT.test(r) || r !== want);
  ok(`${s.label} -> ${results.join(', ')}`, bad.length === 0,
    bad.map(b => `got ${b.r}, want ${want}  from  ${b.w}`).join('\n        '));
}

const halfUsed = widths.map(w => evaluateWidth(w, SCENARIOS[2].vals));
ok('the half-used scenario really is half, not a guard that zeroed the meter',
  halfUsed.every(r => r === '50%'), halfUsed.join(', '));

// ── 3. "0 of 0" is never shown to the user ──────────────────────────────────
// A zero cap is not "you used it all", it is "not on this plan". The bar is
// dropped and the copy says so, otherwise an empty meter under
// "Advanced: 0 of 0" still reads as a broken widget.
console.log('\n3. a zero cap says "upgrade to unlock" instead of rendering a meter:');

// `after` is written so that a MISSING branch fails rather than passing on
// indexOf's -1 — the first version of this check did exactly that against the
// pre-fix file, which would have made it a dark guard.
function after(label: string, branch: string): boolean {
  const b = settingsCode.indexOf(branch);
  const l = settingsCode.indexOf(label);
  return b >= 0 && l > b;
}

ok('the Advanced AI row is behind an aiSmartLimit > 0 branch',
  /\{aiSmartLimit > 0 \? \(/.test(settingsCode),
  'without the branch a free user sees the literal text "Advanced: 0 of 0"');
ok('the zero-cap Advanced copy is "Advanced AI: upgrade to unlock"',
  settings.includes('Advanced AI: upgrade to unlock'));
ok('the "Advanced: {used} of {limit}" label only exists inside that branch',
  after('Advanced: {aiSmartUsed} of {aiSmartLimit}', '{aiSmartLimit > 0 ? ('));

ok('the Takeoff row is behind a takeoffQuota.cap > 0 branch',
  /\{takeoffQuota\.cap > 0 \? \(/.test(settingsCode),
  'without the branch a free user sees "Takeoff: 0 of 0 pages this month"');
ok('the zero-cap Takeoff copy is "Takeoff pages: upgrade to unlock"',
  settings.includes('Takeoff pages: upgrade to unlock'));
ok('the "Takeoff: {used} of {cap}" label only exists inside that branch',
  after('Takeoff: {takeoffQuota.used} of {takeoffQuota.cap}', '{takeoffQuota.cap > 0 ? ('));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
