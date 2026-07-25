// scripts/validate-didforyou-ledger.ts
// Run: bun scripts/validate-didforyou-ledger.ts
import { parseDidForYouEntries, appendDidForYouEntry, DID_FOR_YOU_KEY } from '@/utils/brain/didForYou';
import type { DidForYouEntry } from '@/utils/brain/didForYou';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); failures++; }
  else { console.log(`PASS: ${msg}`); }
}

// 1. parseDidForYouEntries — null input
assert(parseDidForYouEntries(null).length === 0, 'null input → empty array');

// 2. parseDidForYouEntries — empty string
assert(parseDidForYouEntries('').length === 0, 'empty string → empty array');

// 3. parseDidForYouEntries — invalid JSON
assert(parseDidForYouEntries('not-json').length === 0, 'invalid JSON → empty array');

// 4. parseDidForYouEntries — non-array JSON
assert(parseDidForYouEntries('{"foo":"bar"}').length === 0, 'object JSON → empty array');

// 5. parseDidForYouEntries — valid array
const entry1: DidForYouEntry = { id: 'dfy_1', at: '2026-01-01T00:00:00Z', text: 'Did task A', projectId: 'proj-1' };
const entry2: DidForYouEntry = { id: 'dfy_2', at: '2026-01-02T00:00:00Z', text: 'Did task B' };
const raw = JSON.stringify([entry1, entry2]);
const parsed = parseDidForYouEntries(raw);
assert(parsed.length === 2, 'parses 2 entries correctly');
assert(parsed[0].id === 'dfy_1', 'first entry id correct');
assert(parsed[1].text === 'Did task B', 'second entry text correct');
assert(parsed[0].projectId === 'proj-1', 'projectId preserved');
assert(parsed[1].projectId === undefined, 'optional projectId absent when not set');

// 6. appendDidForYouEntry — basic append
const newEntry: DidForYouEntry = { id: 'dfy_3', at: '2026-01-03T00:00:00Z', text: 'Did task C' };
const appended = appendDidForYouEntry([entry1, entry2], newEntry);
assert(appended.length === 3, 'append increases length by 1');
assert(appended[2].id === 'dfy_3', 'new entry appended at end');

// 7. appendDidForYouEntry — append to empty
const fromEmpty = appendDidForYouEntry([], newEntry);
assert(fromEmpty.length === 1, 'append to empty array gives length 1');
assert(fromEmpty[0].id === 'dfy_3', 'entry present in result');

// 8. FIFO cap — exactly at cap (200)
const base: DidForYouEntry[] = Array.from({ length: 200 }, (_, i) => ({
  id: `dfy_${i}`,
  at: `2026-01-01T00:00:0${String(i).padStart(2, '0')}Z`,
  text: `entry ${i}`,
}));
// Base has 200 entries, adding one more should prune to 200 (newest 200)
const overflow: DidForYouEntry = { id: 'dfy_overflow', at: '2026-06-01T00:00:00Z', text: 'overflow entry' };
const capped = appendDidForYouEntry(base, overflow);
assert(capped.length === 200, 'FIFO cap enforced at 200');
assert(capped[capped.length - 1].id === 'dfy_overflow', 'newest entry kept at end');
assert(capped[0].id === 'dfy_1', 'oldest entry pruned (dfy_0 removed)');

// 9. FIFO cap — well below cap
const small: DidForYouEntry[] = Array.from({ length: 5 }, (_, i) => ({
  id: `dfy_s${i}`,
  at: new Date().toISOString(),
  text: `small ${i}`,
}));
const smallResult = appendDidForYouEntry(small, overflow);
assert(smallResult.length === 6, 'below cap: no pruning');

// 10. DID_FOR_YOU_KEY constant
assert(DID_FOR_YOU_KEY === 'mageid_brain_ledger', 'DID_FOR_YOU_KEY is mageid_brain_ledger');

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll did-for-you ledger tests passed');
