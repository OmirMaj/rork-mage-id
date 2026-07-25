// scripts/validate-prediction-ledger.ts
// Run: bun scripts/validate-prediction-ledger.ts
// Imports from predictionLedgerCore (no RN/Supabase) so bun can execute it directly.
import { buildPredictionRow, dedupeBySubject } from '@/utils/brain/predictionLedgerCore';
import type { BrainPredictionReadRow } from '@/utils/brain/types';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); failures++; }
  else { console.log(`PASS: ${msg}`); }
}

// 1. buildPredictionRow shape
const row = buildPredictionRow('pace_suggestion_applied', 'task-1', { aiOriginalDays: 5, paceDays: 4 }, 'proj-1');
assert(typeof row.id === 'string' && row.id.length > 0, 'row.id is non-empty string');
assert(/^[0-9a-f-]{32,36}$/i.test(row.id), 'row.id looks like UUID');
assert(row.kind === 'pace_suggestion_applied', 'row.kind is correct');
assert(row.subject_id === 'task-1', 'row.subject_id is correct');
assert(row.project_id === 'proj-1', 'row.project_id is correct');
assert(typeof row.predicted_at === 'string', 'row.predicted_at is string');
assert(!isNaN(Date.parse(row.predicted_at)), 'row.predicted_at is valid ISO');
assert(row.payload['aiOriginalDays'] === 5, 'payload preserved');

// 2. Injectable clock
const fixedTime = '2026-01-01T00:00:00.000Z';
const row2 = buildPredictionRow('leak_flag', 'report-1', {}, null, () => fixedTime);
assert(row2.predicted_at === fixedTime, 'injectable clock used');
assert(row2.project_id === null, 'null project_id preserved');

// 3. dedupeBySubject keeps earliest
const earlier: BrainPredictionReadRow = {
  id: 'a', user_id: 'u1', kind: 'pace_suggestion_applied', subject_id: 'task-1',
  payload: {}, project_id: null, predicted_at: '2026-01-01T00:00:00Z',
  resolved_at: null, outcome: null,
};
const later: BrainPredictionReadRow = {
  id: 'b', user_id: 'u1', kind: 'pace_suggestion_applied', subject_id: 'task-1',
  payload: {}, project_id: null, predicted_at: '2026-01-02T00:00:00Z',
  resolved_at: null, outcome: null,
};
const deduped = dedupeBySubject([later, earlier]); // later first, earlier second
assert(deduped.length === 1, 'dedupe collapses duplicates to 1');
assert(deduped[0].id === 'a', 'dedupe keeps earliest (id=a)');

// 4. dedupe with multiple kinds and subjects
const rows: BrainPredictionReadRow[] = [
  { id: 'c', user_id: 'u1', kind: 'leak_flag', subject_id: 'r1', payload: {}, project_id: null, predicted_at: '2026-01-01T10:00:00Z', resolved_at: null, outcome: null },
  { id: 'd', user_id: 'u1', kind: 'pace_suggestion_applied', subject_id: 'task-2', payload: {}, project_id: null, predicted_at: '2026-01-01T09:00:00Z', resolved_at: null, outcome: null },
  { id: 'e', user_id: 'u1', kind: 'leak_flag', subject_id: 'r1', payload: {}, project_id: null, predicted_at: '2026-01-01T11:00:00Z', resolved_at: null, outcome: null },
];
const deduped2 = dedupeBySubject(rows);
assert(deduped2.length === 2, 'two unique (kind,subject_id) pairs → 2 rows');
const leakRow = deduped2.find(r => r.kind === 'leak_flag');
assert(leakRow?.id === 'c', 'leak_flag keeps earliest (id=c)');
assert(deduped2.find(r => r.kind === 'pace_suggestion_applied')?.id === 'd', 'pace row preserved');

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll prediction-ledger tests passed');
