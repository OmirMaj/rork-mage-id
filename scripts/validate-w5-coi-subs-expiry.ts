// validate-w5-coi-subs-expiry.ts — COI reminders start over after a renewal
// (audit #28).
//
// coi-expiry-watch dedups on coi_last_warned_threshold and nothing ever
// cleared it: after a sub's COI hit the 7-day warning and was renewed, the
// next year's 30 / 14 / 7-day emails were all suppressed (`30 < 7` is false)
// and the GC's first word was "COI expired". It also filtered rows with a TEXT
// `coi_expiry <= cutoff`, which dropped a hand-typed '9/30/2026' unread.
//
// The function's pure block (between its `pure: begin` / `pure: end` markers)
// is extracted and RUN here — the edge function itself imports esm.sh and
// calls Deno.serve at load, so it can't be imported. Then the I/O half is
// pinned by source: the marker write carries coi_last_warned_for, and the
// text filter is gone.
//
// Run: bun run scripts/validate-w5-coi-subs-expiry.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const fnSrc = readFileSync(join(ROOT, 'supabase/functions/coi-expiry-watch/index.ts'), 'utf8');
const from = fnSrc.indexOf('// ── pure: begin');
const to = fnSrc.indexOf('// ── pure: end');
if (from < 0 || to < from) {
  console.error('\n✗ coi-expiry-watch lost its `pure: begin` / `pure: end` markers — restore them so this guard can run the real rule.\n');
  process.exit(1);
}
const { Transpiler } = (globalThis as unknown as {
  Bun: { Transpiler: new (o: { loader: string }) => { transformSync(src: string): string } };
}).Bun;
// SubRow is referenced as a type only; declare it so the transpile is clean.
const js = new Transpiler({ loader: 'ts' }).transformSync(`type SubRow = Record<string, unknown>;\n${fnSrc.slice(from, to)}`);
type Row = { coi_expiry: string | null; coi_last_warned_at: string | null; coi_last_warned_threshold: number | null; coi_last_warned_for: string | null };
const { parseExpiryDay, daysBetweenDays, pickThreshold, shouldWarn } = new Function(
  `${js}\nreturn { parseExpiryDay, daysBetweenDays, pickThreshold, shouldWarn };`,
)() as {
  parseExpiryDay: (raw: string | null) => string | null;
  daysBetweenDays: (a: string, b: string) => number;
  pickThreshold: (d: number) => 30 | 14 | 7 | 0 | null;
  shouldWarn: (t: 30 | 14 | 7 | 0, sub: Row, nowMs?: number) => boolean;
};

const NOW = Date.parse('2026-09-23T13:00:00Z');

console.log('\nshouldWarn — a renewal is a fresh cycle:');
{
  const renewed: Row = { coi_expiry: '2026-10-23', coi_last_warned_threshold: 7, coi_last_warned_at: '2025-10-16T13:00:00Z', coi_last_warned_for: '2025-10-23' };
  ok('last warned at 7 for the OLD expiry; renewed expiry now 30 days out → warns', shouldWarn(30, renewed, NOW) === true);
  ok('…and at 14 and 7 of the new cycle', shouldWarn(14, renewed, NOW) && shouldWarn(7, renewed, NOW));
  const same: Row = { coi_expiry: '2026-10-23', coi_last_warned_threshold: 7, coi_last_warned_at: '2026-10-16T13:00:00Z', coi_last_warned_for: '2026-10-23' };
  ok('the SAME expiry already warned at 7 → the 30-day does not re-fire', shouldWarn(30, same, NOW) === false);
  ok('…nor the 7-day again', shouldWarn(7, same, NOW) === false);
  const sameAt30: Row = { ...same, coi_last_warned_threshold: 30 };
  ok('same expiry warned at 30 → the tighter 14 still fires', shouldWarn(14, sameAt30, NOW) === true);
  const legacy: Row = { coi_expiry: '2026-10-23', coi_last_warned_threshold: 0, coi_last_warned_at: '2026-09-20T13:00:00Z', coi_last_warned_for: null };
  ok('markers with no coi_last_warned_for (written before this) do not suppress a cycle', shouldWarn(30, legacy, NOW) === true);
  const overdue: Row = { coi_expiry: '2026-09-01', coi_last_warned_threshold: 0, coi_last_warned_at: '2026-09-20T13:00:00Z', coi_last_warned_for: '2026-09-01' };
  ok('overdue re-warns weekly: 3 days since the last → no', shouldWarn(0, overdue, NOW) === false);
  ok('…8 days since → yes', shouldWarn(0, { ...overdue, coi_last_warned_at: '2026-09-15T13:00:00Z' }, NOW) === true);
  ok('last = 0 then renewed → the new 30-day fires', shouldWarn(30, { ...overdue, coi_expiry: '2026-10-20' }, NOW) === true);
  ok('never warned → warns', shouldWarn(30, { coi_expiry: '2026-10-20', coi_last_warned_threshold: null, coi_last_warned_at: null, coi_last_warned_for: null }, NOW));
  // Review round 1: the same day in two formats is the SAME cycle — the Subs
  // form keeps '10/23/2026', the vault's sync writes '2026-10-23'.
  const flipped: Row = { ...same, coi_expiry: '10/23/2026' };
  ok("'10/23/2026' against a marker for '2026-10-23' is the same cycle (no re-send)", shouldWarn(30, flipped, NOW) === false && shouldWarn(7, flipped, NOW) === false);
  ok('…and the other way round', shouldWarn(30, { ...same, coi_last_warned_for: '10/23/2026' }, NOW) === false);
  ok('an unparseable marker never suppresses a cycle', shouldWarn(30, { ...same, coi_last_warned_for: 'soon' }, NOW) === true);
}

console.log('\nparseExpiryDay — calendar days, including what a GC types:');
{
  ok("'2026-10-23' → itself", parseExpiryDay('2026-10-23') === '2026-10-23');
  ok("'9/30/2026' (the text filter dropped it) → 2026-09-30", parseExpiryDay('9/30/2026') === '2026-09-30');
  ok('an ISO instant → its date part', parseExpiryDay('2026-10-23T00:00:00.000Z') === '2026-10-23');
  ok("'2026-02-30' → null (not a day)", parseExpiryDay('2026-02-30') === null);
  ok("'next year' → null (counted as unreadable, no reminder)", parseExpiryDay('next year') === null && parseExpiryDay('') === null);
  ok('days between two calendar days', daysBetweenDays('2026-09-23', '2026-10-23') === 30 && daysBetweenDays('2026-09-23', '2026-09-22') === -1);
  ok('pickThreshold buckets', pickThreshold(30) === 30 && pickThreshold(14) === 14 && pickThreshold(7) === 7 && pickThreshold(0) === 0 && pickThreshold(31) === null);
}

console.log('\nthe I/O half:');
{
  const body = fnSrc.slice(to);
  const fnCode = fnSrc.replace(/^\s*\/\/.*$/gm, '');
  ok('the text filter `.lte(\'coi_expiry\', …)` is gone', !/\.lte\('coi_expiry'/.test(fnCode));
  ok('coi_last_warned_for is selected', /coi_last_warned_threshold,coi_last_warned_for'\)/.test(body));
  ok('each row is parsed as a calendar day in code', /const expiryDay = parseExpiryDay\(sub\.coi_expiry\);/.test(body)
    && /if \(!expiryDay\) \{ unreadableDates \+= 1; continue; \}/.test(body));
  ok('the marker write stores the expiry it was for, as the normalized calendar day',
    /coi_last_warned_threshold: threshold,\s*(?:\/\/[^\n]*\n\s*)+coi_last_warned_for: expiryDay,/.test(body));
  ok('no Date.parse of the expiry itself (UTC-midnight drift)', !/Date\.parse\(sub\.coi_expiry\)/.test(fnCode));
  ok('the email no longer promises reminders stop at the 30-day threshold', !/We'll stop reminding once the date passes the 30-day threshold/.test(fnSrc));
}

console.log(`\nvalidate-w5-coi-subs-expiry: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
