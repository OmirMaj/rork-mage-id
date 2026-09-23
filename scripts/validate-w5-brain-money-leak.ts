// scripts/validate-w5-brain-money-leak.ts — Profit Leak History and the
// prediction-ledger reads after audit wave 5 (2026-09-22):
//   #22       a graded scan is filed from the grader's own fields (itemsBilled /
//             itemsEaten / dollarsBilled), so "Converted" fills, a mixed scan
//             is "partly billed", and the page's recovery rate equals the
//             brain's accuracy report on the same rows;
//   #104/#122 a failed ledger read is reported as a failure (never as "no
//             scans"), is never cached, and the screen and the Morning Brief
//             act on the difference.
//
// utils/brain/predictionLedger.ts imports lib/supabase and utils/offlineQueue
// at module scope; both are replaced with controllable stand-ins BEFORE the
// module is imported, so the real loaders run against a scripted PostgREST.
//
// Run via: bun run scripts/validate-w5-brain-money-leak.ts

// `bun:test` has no type declarations in this repo's tsc program, so it is
// reached through a variable specifier; bun resolves it at runtime.
const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
};
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrainPredictionReadRow } from '../utils/brain/types';

// ── The scripted server ─────────────────────────────────────────────────────
type Reply = { data: unknown; error: { message: string } | null } | 'throw';
const replies: Reply[] = [];
let selects = 0;
function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'not', 'order', 'limit', 'in', 'eq']) b[m] = () => b;
  b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    selects++;
    const r = replies.shift() ?? { data: [], error: null };
    if (r === 'throw') reject(new TypeError('Network request failed'));
    else resolve(r);
  };
  return b;
}
const supabase = {
  from: () => builder(),
  auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
};
mock.module('@/lib/supabase', () => ({ supabase, isSupabaseConfigured: true }));
mock.module('@/utils/offlineQueue', () => ({ supabaseWrite: async () => true, onQueueFlushed: () => () => {} }));
mock.module('@/utils/generateId', () => ({ generateUUID: () => 'uuid' }));

const ledger = await import('../utils/brain/predictionLedger');
const { buildAccuracyReport } = await import('../utils/brain/accuracyReport');
const { buildTrackRecord } = await import('../utils/brain/trackRecord');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// ── Fixtures: rows exactly as gradeLeak resolves them ──────────────────────
const leakRow = (
  id: string,
  prices: number[],
  outcome: Record<string, unknown> | null,
): BrainPredictionReadRow => ({
  id, kind: 'leak_flag', subject_id: `rep-${id}`, project_id: 'p1', user_id: 'u1',
  predicted_at: '2026-07-01T12:00:00.000Z',
  resolved_at: outcome ? '2026-08-30T12:00:00.000Z' : null,
  payload: { reportId: `rep-${id}`, items: prices.map((estPrice, i) => ({ category: 'Extra', description: `item ${i}`, estPrice })) },
  outcome,
} as unknown as BrainPredictionReadRow);

// The audit's repro: $1,200 drywall patch flagged, a $1,100 approved CO within
// 60 days → the grader writes itemsBilled 1, itemsEaten 0.
const ALL_BILLED = leakRow('a', [1_200], { reportId: 'rep-a', itemsBilled: 1, itemsEaten: 0, dollarsBilled: 1_200, dollarsEaten: 0, closedNoMatch: false });
const NONE_BILLED = leakRow('b', [800, 400], { reportId: 'rep-b', itemsBilled: 0, itemsEaten: 2, dollarsBilled: 0, dollarsEaten: 1_200, closedNoMatch: true });
// Mixed, on an OPEN job past the window: gradeLeak raises itemsEaten for the
// unmatched item but leaves its $700 out of dollarsEaten (reads $0).
const MIXED = leakRow('c', [2_000, 700], { reportId: 'rep-c', itemsBilled: 1, itemsEaten: 1, dollarsBilled: 2_000, dollarsEaten: 0, closedNoMatch: false });
const LEGACY = leakRow('d', [500], { resolution: 'co_raised', coId: 'co-1' });
const OPEN = leakRow('e', [300, 200], null);

console.log('\n#22 — a graded scan is filed from the grader’s fields:');
{
  ok('all items matched an approved CO → converted', ledger.classifyLeakOutcome(ALL_BILLED) === 'converted');
  ok('no item matched → eaten', ledger.classifyLeakOutcome(NONE_BILLED) === 'eaten');
  ok('some matched, some not → partial (never filed as eaten)', ledger.classifyLeakOutcome(MIXED) === 'partial');
  ok('legacy co_raised / coId still counts as converted', ledger.classifyLeakOutcome(LEGACY) === 'converted');
  ok('not graded yet → open', ledger.classifyLeakOutcome(OPEN) === 'open');

  const rows = [ALL_BILLED, NONE_BILLED, MIXED, LEGACY, OPEN];
  const s = ledger.summarizeLeakHistory(rows);
  ok('Converted total = Σ dollarsBilled (legacy row: its whole estimate)', s.convertedTotal === 1_200 + 0 + 2_000 + 500, String(s.convertedTotal));
  ok('Eaten total = Σ (estimate − billed) — the mixed scan’s $700 counts though dollarsEaten reads $0',
    s.eatenTotal === 0 + 1_200 + 700 + 0, String(s.eatenTotal));
  ok('Open total = Σ estPrice of ungraded scans', s.openTotal === 500 && s.openCount === 1);
  ok('a partly billed scan counts under both Converted and Eaten',
    s.billedScanCount === 3 && s.unbilledScanCount === 2 && s.partialCount === 1,
    JSON.stringify(s));

  // THE PAGE AND THE BRAIN CANNOT DISAGREE AGAIN. buildAccuracyReport is what
  // ReadyToBillCard / the brief read ("N of M flagged items recovered via COs").
  const graded = rows.filter(r => r.resolved_at);
  const leakAcc = buildAccuracyReport(graded).rows.find(r => r.kind === 'leak_flag');
  ok('the accuracy report has a leak row for these rows', !!leakAcc);
  ok('the page’s item recovery rate equals the brain’s leak rate on the same rows',
    leakAcc?.rate != null && s.itemRecoveryRate != null && Math.abs(leakAcc.rate - s.itemRecoveryRate) < 1e-12,
    `${leakAcc?.rate} vs ${s.itemRecoveryRate}`);
  ok('…which is itemsBilled / (itemsBilled + itemsEaten)', s.itemsBilled === 2 && s.itemsGraded === 5);

  // …and with the track record's verdict: a scan the receipts call a 'hit'
  // (itemsBilled > 0) is never filed as eaten.
  const receipts = buildTrackRecord(graded);
  for (const r of graded.filter(g => typeof (g.outcome as { itemsBilled?: unknown })?.itemsBilled === 'number')) {
    const verdict = receipts.find(x => x.id === r.id)?.verdict;
    const bucket = ledger.classifyLeakOutcome(r);
    ok(`track record ${verdict} ↔ history ${bucket} (${r.id})`,
      verdict === 'hit' ? bucket !== 'eaten' : bucket === 'eaten');
  }

  const screen = read('app/profit-leak-history.tsx');
  const code = strip(screen);
  ok('the screen classifies through classifyLeakOutcome, not a private rule',
    /bucket: classifyLeakOutcome\(row\)/.test(code) && !/outcome\.resolution === 'co_raised'/.test(code));
  ok('…totals through summarizeLeakHistory, not Σ estTotal per bucket',
    /setSummary\(summarizeLeakHistory\(raw\)\)/.test(code) && !/convertedRows\.reduce/.test(code));
  ok('the screen never says the owner declined (code, not the comment that explains why)', !/owner declined/i.test(code));
  ok('Eaten says what the grader knows: no matching approved CO within 60 days',
    /No matching approved change order found within 60 days/.test(code));
}

console.log('\n#104 / #122 — a failed ledger read is not an empty ledger:');
{
  ledger.invalidatePredictionCache();
  replies.push({ data: null, error: { message: 'FetchError: offline' } });
  const failed = await ledger.fetchOpenPredictionsResult(['leak_flag']);
  ok('a PostgREST error comes back as { ok: false }', failed.ok === false);
  replies.push('throw');
  const thrown = await ledger.fetchResolvedPredictionsResult(['leak_flag']);
  ok('a thrown fetch comes back as { ok: false }', thrown.ok === false);

  // THE CACHE HALF. The old loader returned [] INSIDE readCache, so the failure
  // was served as "no rows" for 30 s. Now the next read goes back to the server.
  const before = selects;
  replies.push({ data: [OPEN], error: null });
  const retry = await ledger.fetchOpenPredictionsResult(['leak_flag']);
  ok('the failure was not cached — the next read queried again', selects === before + 1);
  ok('…and returned the real rows', retry.ok && retry.rows.length === 1);

  // The swallow contract the other five callers rely on is unchanged, and its
  // failure is not cached either.
  ledger.invalidatePredictionCache();
  replies.push({ data: null, error: { message: 'offline' } });
  const swallowed = await ledger.fetchOpenPredictions(['leak_flag']);
  ok('fetchOpenPredictions still swallows a failure to []', Array.isArray(swallowed) && swallowed.length === 0);
  replies.push({ data: [OPEN], error: null });
  const after = await ledger.fetchOpenPredictions(['leak_flag']);
  ok('…and the swallowed failure did not poison the cache for the next caller', after.length === 1);

  ledger.invalidatePredictionCache();
  replies.push({ data: null, error: null });
  const empty = await ledger.fetchResolvedPredictionsResult(['leak_flag']);
  ok('`data: null` with no error is a successful empty read, not a failure', empty.ok && empty.rows.length === 0);

  ledger.invalidatePredictionCache();
  replies.push({ data: [OPEN, { ...OPEN, id: 'e2' }], error: null });
  const deduped = await ledger.fetchOpenPredictionsDedupedResult(['leak_flag']);
  ok('the deduped Result read dedupes by subject like fetchOpenPredictionsDeduped', deduped.ok && deduped.rows.length === 1);

  const code = strip(read('app/profit-leak-history.tsx'));
  ok('History reads through the Result variants',
    /fetchOpenPredictionsDedupedResult\(\['leak_flag'\]\)/.test(code) && /fetchResolvedPredictionsResult\(\['leak_flag'\]\)/.test(code));
  ok('…keeps the previous rows on failure (setRows only on success)',
    /if \(!open\.ok \|\| !resolved\.ok\) \{[\s\S]*?setLoadError\([\s\S]*?return;\s*\}/.test(code));
  ok('…shows the failure, not "No profit leak scans yet", when it has nothing',
    /Couldn't load your profit leak scans/.test(code) && /!loadError && rows\.length === 0/.test(code));
  ok('…with a Retry that drops the read cache before reloading',
    /invalidatePredictionCache\(\);\s*try \{ await load\(\); \}/.test(code) && /testID="leak-history-retry"/.test(code));
  ok('…and a pull-to-refresh', /<RefreshControl refreshing=\{refreshing\} onRefresh=\{reload\}/.test(code));
  ok('…and dashes, not zeros, on the chips when nothing was ever read',
    /count === null \? '—' : count/.test(code) && /count=\{noData \? null :/.test(code));

  const brief = strip(read('hooks/useMorningBrief.ts'));
  ok('the Morning Brief states a leak count only when the read worked',
    /const res = await fetchOpenPredictionsDedupedResult\(\['leak_flag'\]\);\s*if \(res\.ok\) \{/.test(brief)
      && !/fetchOpenPredictionsDeduped\(/.test(brief));
  ok('…so a failure leaves openLeakFlags null and composeBrief’s report-scan fallback runs',
    /next\.openLeakFlags = \{ count: res\.rows\.length, estTotal \};/.test(brief));
  ok('…and the accuracy line is never built from a failed read',
    /if \(res\.ok\) next\.accuracyReport = buildAccuracyReport\(res\.rows\);/.test(brief));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
