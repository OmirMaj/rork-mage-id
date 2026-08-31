// validate-offline-group-abort.ts — a failed mutation must stop its record.
//
// WHY THIS EXISTS. utils/offlineQueue groups queued mutations by record to
// preserve intra-record ordering (insert → update → delete). The processing
// loop used to `continue` past a failure to the NEXT mutation for the same
// record, which defeats the grouping and loses work silently:
//
//   A contractor working offline — the normal jobsite state — creates a change
//   order and approves it up to $7,500 in the same session. On flush the INSERT
//   fails (FK: the parent project row has not synced yet). The loop continues
//   to the queued UPDATE, which runs `update(rest).eq('id', id)` against a row
//   that does not exist. Zero rows match and PostgREST returns NO ERROR, so
//   gProcessed++ fires and the mutation is discarded at write-back. The insert
//   then succeeds on a later flush carrying its ORIGINAL $5,000 payload.
//
// The approval is gone from the server, from every other device and from the
// homeowner's portal — and because changeOrdersQuery is server-first and calls
// saveLocal, the device that made the edit reverts to match on next launch.
// Create-then-delete resurrects the deleted row permanently.
//
// This is a SOURCE guard rather than a runtime one: the loop is inside
// flushQueue, wrapped in a Supabase client and AsyncStorage, with no injection
// seam. Pinning the structure is what this repo does in that situation (see
// scripts/validate-portal-state-roundtrip.ts). What it pins:
//
//   1. the loop is indexed, so the remainder of a group can be re-queued
//   2. NO failure branch uses `continue` (that is the bug, verbatim)
//   3. transient and retryable re-queue `group.slice(index + 1)`
//   4. terminal and retry-exhausted DROP the remainder and COUNT it as failed,
//      so the loss is reported rather than hidden
//
// Run via: bun run test:offline-group-abort

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'utils', 'offlineQueue.ts'), 'utf8');
// Strip comments — this file documents the OLD broken behaviour verbatim, and
// prose describing a bug must not read as the bug.
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

console.log('\noffline queue group abort (a failure stops its record):');

// Isolate the per-group loop: from the `for (... of group...)` to the return of
// the group tally. Bounding it keeps a `continue` elsewhere in the file from
// reading as a false positive.
const loopStart = code.indexOf('of group.entries())');
const loopEnd = code.indexOf('return { processed: gProcessed');
ok('the per-group loop was located', loopStart !== -1 && loopEnd > loopStart,
  'the loop was renamed or restructured — re-read this guard before trusting it');
const loop = loopStart === -1 ? '' : code.slice(loopStart, loopEnd);

ok('the loop is indexed (group.entries()), not a bare for-of',
  /for \(const \[index, mutation\] of group\.entries\(\)\)/.test(code),
  'without the index the remainder of a group cannot be re-queued or dropped');

ok('no failure branch uses `continue`',
  !/\bcontinue;/.test(loop),
  'a `continue` carries on to the next mutation for the SAME record, which is ' +
  'the defect: the follow-up update matches 0 rows, PostgREST reports no error, ' +
  'and the edit is discarded as a success');

// Transient must keep the whole remainder — the offline-first guarantee.
ok('the transient branch re-queues the rest of the group',
  /gRemaining\.push\(mutation\);[\s\S]{0,400}?gRemaining\.push\(\.\.\.group\.slice\(index \+ 1\)\);/.test(loop),
  'an offline device must keep every later edit for the record, in order');

// Terminal must drop the remainder AND count it, so the user is told.
ok('the terminal branch drops the dependent mutations',
  /isTerminalError[\s\S]{0,900}?group\.slice\(index \+ 1\)[\s\S]{0,400}?gDropped\.push\(\.\.\.orphaned\)/.test(loop),
  'if an insert is permanently rejected its dependent edits can never apply; ' +
  'leaving them queued turns them into 0-row no-ops that report SUCCESS');

ok('dropped dependents are COUNTED as failed, not silently discarded',
  /gFailed \+= orphaned\.length/.test(loop),
  'the count is what surfaces the loss to the user instead of hiding it');

ok('retry-exhaustion also drops its dependents',
  /MAX_RETRIES[\s\S]{0,600}?orphaned/.test(loop));

// The transient branch must still not spend retry budget — the guarantee that
// made this bug possible is also the one worth keeping.
ok('the transient branch still does NOT bump retryCount',
  !/isNetworkError[\s\S]{0,500}?retryCount\+\+/.test(loop),
  'a device that is merely offline must never burn its retry budget');

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
