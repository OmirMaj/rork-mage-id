// validate-ledger-coverage.ts — never write a prediction you cannot grade.
//
// SCOPE NOTE: validate-prediction-ledger.ts is a SEPARATE, pre-existing guard that
// unit-tests buildPredictionRow + dedupeBySubject. This one checks the STRUCTURAL
// invariant across call sites. Both are needed; do not merge them.
//
// WHY THIS EXISTS. The brain's grading sweep reads OPEN predictions with
// `.order('predicted_at', {ascending: true}).limit(200)` (predictionLedger.ts).
// That window is the only way a prediction ever reaches a grader. So a row that
// can NEVER resolve does not merely waste a row — it permanently occupies a
// slot in a bounded, oldest-first queue.
//
// app/judges.tsx shipped exactly that. Describe-mode wrote `judges_verdict`
// with `subject_id = generateUUID()` and no projectId, so gradeJudges bailed
// twice over and the row could never resolve. Unique subject_ids meant
// dedupeBySubject could never collapse them either. After ~200 describe runs
// the sweep would fetch 200 ungradeable rows on every pass and no gradeable
// prediction would ever enter grading again — the pace book and the leak gate
// stop learning, the accuracy surfaces freeze on a stale resolved set, and
// NOTHING ERRORS. The app looks fine and the brain is dead.
//
// THE INVARIANT: every PredictionKind that has a WRITER must be resolvable.
// A kind may be unwritten (reserved for later), and a kind may be skipped by
// the resolver — but it may never be BOTH written and skipped.
//
// Run via: bun run test:ledger-coverage

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Kinds the resolver deliberately does not handle. Each needs a reason. */
const INTENTIONALLY_UNRESOLVABLE: Record<string, string> = {
  leveling_adjustment:
    'Reserved. No writer exists yet — the schedule leveller does not record one. ' +
    'Safe precisely BECAUSE nothing writes it; adding a writer without a grader ' +
    'would reintroduce the starvation bug this guard exists to prevent.',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const typesSrc = readFileSync(join(ROOT, 'utils', 'brain', 'types.ts'), 'utf8');
const unionMatch = typesSrc.match(/export type PredictionKind =([\s\S]*?);/);
if (!unionMatch) {
  console.error('✗ validate-prediction-ledger: could not parse the PredictionKind union. Fix the guard.');
  process.exit(1);
}
const ALL_KINDS = [...unionMatch[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);

const resolverSrc = readFileSync(join(ROOT, 'utils', 'brain', 'resolveOutcomes.ts'), 'utf8');
// A kind is "handled" when the resolver has a case that does real work — a bare
// `case 'x':` followed immediately by break/continue is a skip, not a handler.
const RESOLVED = new Set(
  [...resolverSrc.matchAll(/case '([a-z_]+)':\s*\{/g)].map(m => m[1]),
);

// Find every kind actually written, and where.
const writers = new Map<string, string[]>();
for (const dir of ['app', 'components', 'utils', 'hooks', 'contexts']) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('recordPrediction')) continue;
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      // recordPrediction( is usually followed by the kind on the next line.
      if (!/recordPrediction\s*\(/.test(line)) return;
      const window = lines.slice(i, i + 3).join(' ');
      const m = window.match(/'([a-z_]+)'/);
      if (!m) return;
      const kind = m[1];
      if (!ALL_KINDS.includes(kind)) return;
      if (!writers.has(kind)) writers.set(kind, []);
      writers.get(kind)!.push(`${relative(ROOT, file)}:${i + 1}`);
    });
  }
}

if (writers.size === 0) {
  console.error('✗ validate-prediction-ledger: found ZERO recordPrediction call sites.');
  console.error('  The guard stopped matching. Fix the guard, do not delete it.');
  process.exit(1);
}

let failed = false;

// ── THE INVARIANT ───────────────────────────────────────────────────────────
for (const [kind, sites] of writers) {
  const resolvable = RESOLVED.has(kind);
  const excused = kind in INTENTIONALLY_UNRESOLVABLE;
  if (!resolvable || excused) {
    failed = true;
    console.error(`\n✗ '${kind}' is WRITTEN but cannot RESOLVE.`);
    console.error(`  written at: ${sites.join(', ')}`);
    console.error(excused
      ? `  It is listed as intentionally-unresolvable: ${INTENTIONALLY_UNRESOLVABLE[kind]}`
      : `  resolveOutcomes.ts has no working case for it.`);
    console.error('  Rows of this kind never leave the open window. fetchOpenPredictions');
    console.error('  takes the OLDEST 200, so they accumulate until the grading sweep is');
    console.error('  fully starved and the brain silently stops learning.');
    console.error('  Fix: give it a grader, or do not record it.');
  }
}

// ── RULE 2: the TS union must match the SQL CHECK ───────────────────────────
// brain_predictions constrains `kind` with a hard CHECK, not an enum:
//
//   kind text not null check (kind in ('pace_suggestion_applied', ...))
//
// Add a kind in TypeScript without widening that CHECK and Postgres rejects
// every insert with 23514 — which recordPrediction swallows, because it is
// fire-and-forget by design so a ledger failure never breaks the host flow.
// The result is "capture" that writes nothing, discovered months later staring
// at an empty table. Exactly the silent-rejection shape as the
// notification_outbox recipient_kind bug, one table over.
{
  const migPath = join(ROOT, 'supabase', 'migrations', '20260725120000_brain_predictions.sql');
  const mig = readFileSync(migPath, 'utf8');
  const check = mig.match(/kind\s+text\s+not\s+null\s+check\s*\(\s*kind\s+in\s*\(([\s\S]*?)\)\s*\)/i);
  if (!check) {
    console.error('✗ could not parse the kind CHECK in 20260725120000_brain_predictions.sql.');
    console.error('  The guard stopped matching — fix the guard, do not delete it.');
    process.exit(1);
  }
  const sqlKinds = new Set([...check[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]));

  for (const kind of ALL_KINDS) {
    if (!sqlKinds.has(kind)) {
      failed = true;
      console.error(`\n✗ '${kind}' is a PredictionKind but is NOT in the SQL CHECK constraint.`);
      console.error('  Postgres rejects every insert (23514) and recordPrediction swallows it.');
      console.error('  Capture silently writes nothing.');
      console.error('  Fix: widen the CHECK in a migration BEFORE shipping the writer.');
    }
  }
  for (const kind of sqlKinds) {
    if (!ALL_KINDS.includes(kind)) {
      failed = true;
      console.error(`\n✗ '${kind}' is allowed by the SQL CHECK but is not a PredictionKind.`);
      console.error('  Dead vocabulary in the schema — remove it, or add the type.');
    }
  }
}

// ── RULE 3: subject_id must identify a real subject ─────────────────────────
// The kind-level check above would NOT have caught the judges bug, because
// `judges_verdict` IS resolvable — pick mode grades fine. It was one payload
// SHAPE that could not. The generalisable smell is the subject_id: a freshly
// minted UUID identifies nothing, so dedupeBySubject (keyed `kind::subject_id`)
// can never collapse repeat runs, and every call adds a permanent row to a
// bounded oldest-first window. A subject_id must point at something real — a
// task id, a project id, a bid id — so the same subject re-predicted collapses
// to one open row instead of N.
for (const dir of ['app', 'components', 'utils', 'hooks', 'contexts']) {
  for (const file of walk(join(ROOT, dir))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('recordPrediction')) continue;
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/recordPrediction\s*\(/.test(line)) return;
      // The subject_id is the 2nd argument — within ~3 lines of the call.
      const window = lines.slice(i, i + 4).join('\n');
      if (/generateUUID\s*\(\s*\)|generateId\s*\(\s*\)|crypto\.randomUUID/.test(window)) {
        failed = true;
        console.error(`\n✗ ${relative(ROOT, file)}:${i + 1} — recordPrediction with a FRESHLY GENERATED subject_id.`);
        console.error('  A random id identifies no subject, so dedupeBySubject can never');
        console.error('  collapse repeats and every call permanently occupies a slot in the');
        console.error('  oldest-200 open window that feeds grading. This starves the sweep.');
        console.error('  Fix: pass the id of the thing being predicted about (task/project/bid).');
      }
    });
  }
}

// ── stale excuses ───────────────────────────────────────────────────────────
for (const kind of Object.keys(INTENTIONALLY_UNRESOLVABLE)) {
  if (!ALL_KINDS.includes(kind)) {
    failed = true;
    console.error(`\n✗ '${kind}' is excused here but is no longer a PredictionKind. Remove the stale entry.`);
  }
}

// ── informational: reserved kinds ───────────────────────────────────────────
const unwritten = ALL_KINDS.filter(k => !writers.has(k));

if (failed) {
  console.error('\n✗ validate-ledger-coverage failed\n');
  process.exit(1);
}

console.log(
  `✓ validate-ledger-coverage: ${writers.size} written kind(s), all resolvable` +
  (unwritten.length ? ` · reserved (unwritten): ${unwritten.join(', ')}` : ''),
);
