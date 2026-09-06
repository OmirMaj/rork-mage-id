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
//
// Scoped by slicing rather than by a character window. The terminal branch now
// opens with two early-outs that both `break` — the no-live-bearer check (A4)
// and the RLS retry-once (SYNC-F1), the second of which contains its own
// `group.slice(index + 1)` — so a distance-bounded regex either matched the
// wrong slice or ran out of room. The drop path starts at its own log line.
const terminalDropStart = loop.indexOf('Terminal error, discarding mutation');
const terminalDropEnd = terminalDropStart === -1 ? -1 : loop.indexOf('break;', terminalDropStart);
const terminalDrop = terminalDropStart === -1 || terminalDropEnd === -1
  ? '' : loop.slice(terminalDropStart, terminalDropEnd);
ok('the terminal drop path was located', terminalDrop.length > 0,
  'the log line it is anchored on was renamed — re-read this guard before trusting it');
ok('the terminal branch drops the dependent mutations',
  /const orphaned = group\.slice\(index \+ 1\);/.test(terminalDrop)
    && /gDropped\.push\(\.\.\.orphaned\)/.test(terminalDrop),
  'if an insert is permanently rejected its dependent edits can never apply; ' +
  'leaving them queued turns them into 0-row no-ops that report SUCCESS');
ok('the terminal branch does not drop a write the server never actually judged (A4)',
  /if \(!\(await bearerStillLive\(\)\)\) \{/.test(loop)
    && loop.indexOf('bearerStillLive') < (terminalDropStart === -1 ? 0 : terminalDropStart),
  'after the access token expires supabase-js sends the ANON key, and the RLS ' +
  'refusal that comes back reads as terminal — it is not a verdict on the write');

ok('dropped dependents are COUNTED as failed, not silently discarded',
  /gFailed \+= orphaned\.length/.test(loop),
  'the count is what surfaces the loss to the user instead of hiding it');

ok('retry-exhaustion also drops its dependents',
  /MAX_RETRIES[\s\S]{0,600}?orphaned/.test(loop));

// The transient branch must still not spend retry budget — the guarantee that
// made this bug possible is also the one worth keeping. Bounded to the
// transient block itself (from its `if (isNetworkError` to its `break;`) so a
// legitimate bump in a LATER branch cannot be mistaken for one here.
const transientStart = loop.indexOf('if (isNetworkError(err)');
const transientEnd = transientStart === -1 ? -1 : loop.indexOf('break;', transientStart);
const transientBlock = transientStart === -1 || transientEnd === -1 ? '' : loop.slice(transientStart, transientEnd);
ok('the transient branch was located', transientBlock.length > 0);
ok('the transient branch still does NOT bump retryCount',
  transientBlock.length > 0 && !/retryCount\+\+/.test(transientBlock),
  'a device that is merely offline must never burn its retry budget');

// ── Final-push audit 2026-09-03 (SYNC-F1 / F4 / F6) ─────────────────────────
console.log('\noffline queue ordering, idempotent re-sends, record keys:');

// SYNC-F6 — medium-sweep #24 was marked closed but never implemented: the
// record key fell back to the per-mutation id, so two project_financials /
// building_access_rules upserts for ONE project (payloads carry project_id,
// never id) ran concurrently and the older could win. Pin the widened fallback.
ok('the record key falls back through project_id / portal_id / sub_portal_id before mutation.id (SYNC-F6)',
  /d\.id \?\? d\.project_id \?\? d\.portal_id \?\? d\.sub_portal_id \?\? mutation\.id/.test(code),
  'rows keyed by project_id / portal_id must serialize per record, not race per mutation');

// SYNC-F1 — every child table's INSERT policy needs the project row to exist
// and Postgres evaluates it before the FK, so projects groups must finish
// (write-back included) before any child group is dispatched.
ok('projects groups are tiered first, project_financials second, everything else after (SYNC-F1)',
  /table === 'projects' \? 0 : table === 'project_financials' \? 1 : 2/.test(code),
  'a child dispatched in the same batch as its parent is rejected by RLS and dropped');
ok('an RLS rejection on a projects-dependent insert is retried once (SYNC-F1)',
  /isRlsRejection\(msg\) && dependsOnProjectRow\(mutation\) && !mutation\.rlsRetried/.test(loop)
    && /mutation\.rlsRetried = true;[\s\S]{0,120}?mutation\.retryCount\+\+;[\s\S]{0,200}?gRemaining\.push\(\.\.\.group\.slice\(index \+ 1\)\)/.test(loop),
  'the child must be kept (whole group, in order) for the flush after its parent lands');

// SYNC-F4 — a kill mid-flush re-sends inserts that already landed; the PK
// duplicate is success, and each group reconciles storage the moment it ends.
ok('a primary-key duplicate on INSERT is treated as success (SYNC-F4)',
  /if \(error && isAlreadyLandedInsert\(error\)\)[\s\S]{0,200}?error = null;/.test(loop),
  'a re-sent insert must not drop the record\'s dependent updates as orphans');
ok('a duplicate on a non-primary-key constraint stays a real conflict (SYNC-F4)',
  /constraint\.endsWith\('_pkey'\)/.test(code),
  'a duplicate document number is a genuine conflict, not a re-send');
ok('write-back happens per group, right after the group finishes (SYNC-F4)',
  /const result = await processGroup\(group\);[\s\S]{0,200}?await writeBackGroup\(group, result\)/.test(code),
  'one write-back after every batch leaves the whole flush as the kill window');

// ── Review 2026-09-05 (B1 / B2 / A7) ────────────────────────────────────────
console.log('\noffline queue is bound to one session; children wait for their parent:');

// B1 — the flush used to snapshot storage once and let each group resolve its
// bearer at send time, so the previous user's queue went out under the next
// user's JWT (gotrue's SIGNED_IN starts a drain before completeSignIn drops the
// queue) or anonymously (after the 20 s sign-out ceiling). Pin every piece:
// the tag at enqueue, the no-session early return, the foreign-tag skip, the
// legacy-marker rule, and the re-check before every batch AND every send.
ok('every enqueue records the signed-in user (B1a)',
  /const userId = \(await currentSessionUser\(\)\)\?\.id;/.test(code)
    && /\.\.\.\(userId \? \{ userId \} : \{\}\)/.test(code),
  'an untagged entry cannot be told apart from another tenant\'s');
ok('a flush with no session sends nothing and keeps everything (B1b)',
  /const flushUser = await currentSessionUser\(\);\s*if \(!flushUser\) \{[\s\S]{0,300}?return \{ processed: 0, failed: 0, remaining: 0, foreign: queue\.length \};/.test(code),
  'a signed-out device must not dispatch anonymously — and A3: with no session ' +
  'nothing is anyone\'s, so those entries are `foreign`, never `remaining`');
// The ours/not-ours split lives in one exported pure function so the flush, the
// depth hook and the sign-out dialog cannot drift apart on what "queued" means.
ok('entries tagged for another user are skipped, not dispatched (B1d)',
  /if \(m\.userId === sessionUserId\) own\.push\(m\);/.test(code)
    && /else foreign\.push\(m\);/.test(code)
    && /partitionQueueForSession\(queue, flushUserId, marker\)/.test(code),
  'the previous tenant\'s writes must never go out under this JWT');
ok('an untagged entry is adopted only when the last-user marker names the session user (B1a legacy rule)',
  /else if \(!m\.userId && marker === sessionUserId\) own\.push\(\{ \.\.\.m, userId: sessionUserId \}\);/.test(code)
    && /AsyncStorage\.getItem\(LAST_USER_ID_KEY\)/.test(code),
  'pre-tagging entries need the device marker to vouch for them');
// A4 — getSession() is not a local read: with an expired access token it goes
// to the network FIRST, so an enqueue on a captive-portal Wi-Fi stalled behind
// it, and a write made after an hour offline was queued UNTAGGED.
ok('the signed-in user is kept from the auth state feed, not fetched per enqueue (A4)',
  /supabase\.auth\.onAuthStateChange\(\(_event, session\) => \{\s*knownSessionUser = sessionUserOf\(session\);/.test(code)
    && /if \(knownSessionUser !== undefined\) return knownSessionUser;/.test(code),
  'tagging and the mid-flush identity check must not be able to block on the network');
ok('…and getSession() is still the fallback while the feed has said nothing (A4)',
  /function primeSessionUser\(\)[\s\S]{0,400}?await supabase\.auth\.getSession\(\)/.test(code),
  'a cold start has no state-change event yet; unknown must not read as signed out');
ok('the session is re-read before every batch (B1c)',
  /for \(let i = 0; i < tier\.length; i \+= MAX_CONCURRENCY\) \{\s*if \(!\(await sessionStillOurs\(\)\)\) break;/.test(code),
  'a flush that outlives the session must stop between batches');
ok('…and before every single send inside a group, keeping the untouched remainder (B1c)',
  /if \(!\(await sessionStillOurs\(\)\)\) \{\s*gRemaining\.push\(\.\.\.group\.slice\(index\)\);\s*break;/.test(loop),
  'the bearer is resolved at send time — the check has to sit right before it');
ok('a lost session is sticky for the rest of the flush',
  /stopped = true;/.test(code) && /if \(stopped\) return false;/.test(code),
  'the same user signing back in mid-flush starts a new drain; the old one must not resume');

// B2 — the RLS retry-once budget was burned by every flush in which the parent
// had not landed, so a slow uplink (projects upsert times out twice, child
// insert reaches the server both times) dropped the child as terminal. Now a
// child whose parent stayed queued or was dropped is not dispatched at all.
ok('projects groups that did not land are collected after tier 0 (B2)',
  /const landed = result\.remaining\.length === 0 && result\.dropped\.length === 0;\s*if \(result\.doomsChildren\) parentDoomed\.add\(pid\);\s*else if \(!landed\) parentPending\.add\(pid\);/.test(code),
  '"remaining OR dropped" — both mean the child cannot succeed yet; a doomed ' +
  'parent (A5) is classified first because its children never get another turn');
ok('a child of a pending parent is held untouched — no dispatch, no rlsRetried, no retry budget (B2)',
  /if \(pid && parentPending\.has\(pid\)\) \{\s*heldForParent \+= group\.length;\s*continue;\s*\}/.test(code),
  'holding must skip the group entirely; sending it spends the one RLS retry');
ok('held children are decided BEFORE the tier is dispatched (B2)',
  code.indexOf('parentPending.has(pid)') < code.indexOf('await runTier(runnable)'),
  'the gate has to sit in front of runTier, not inside the group loop');

// A7 — a project deleted in the same flush takes its queued children with it:
// they would only RLS-fail against a row that is gone and toast about work the
// user discarded on purpose.
ok('children of a project deleted in this flush are discarded without a dispatch (A7)',
  /else if \(group\[group\.length - 1\]\.operation === 'delete'\) parentDeleted\.add\(pid\);/.test(code)
    && /if \(pid && parentDeleted\.has\(pid\)\) \{[\s\S]{0,500}?await writeBackGroup\(group, \{ processed: 0, failed: 0, remaining: \[\], dropped: \[\], processedTables: new Set\(\), doomsChildren: false \}\);/.test(code),
  'the delete landed; its children are moot and must not be sent or reported');

// A5 — a `projects` write dropped for a reason that proves the row is not
// there (a dropped INSERT) or not this user's (an UPSERT refused for ACCESS)
// takes its children out now, in the same report, instead of holding them one
// flush and then spending their one RLS retry on a refusal that was certain.
ok('only a drop that PROVES the children cannot land dooms them (A5)',
  /function dropDoomsChildren\(mutation: OfflineMutation, message: string\): boolean \{\s*if \(mutation\.table !== 'projects'\) return false;\s*if \(mutation\.operation === 'insert'\) return true;\s*return mutation\.operation === 'upsert' && isAccessRejection\(message\);/.test(code),
  'an upsert dropped for its PAYLOAD is often an edit of a project that DOES ' +
  'exist on the server — those children keep the B2 hold');
ok('doomed children leave storage without a dispatch and are counted as failed (A5)',
  /if \(pid && parentDoomed\.has\(pid\)\) \{[\s\S]{0,500}?dropped: group, processedTables: new Set\(\), doomsChildren: false \}\);\s*doomedChildren\.push\(\.\.\.group\);/.test(code)
    && /failed \+= doomedChildren\.length;/.test(code));
ok('…and are reported in the SAME toast as the parent that took them down (A5)',
  /dropped\.push\(\.\.\.doomedChildren\);[\s\S]{0,200}?if \(dropped\.length > 0\) \{\s*notifyDroppedWrites\(dropped, /.test(code),
  'one report per flush — a rejected project and its children are one loss, not four');

// A3 — `remaining` is the OWN-tenant count. Counting another tenant's leftovers
// re-armed OfflineSyncManager's backoff forever (no retry under this JWT will
// ever send them) and told the wrong person about work that was never theirs.
ok('a flush reports remaining and foreign separately (A3)',
  /export interface FlushResult \{ processed: number; failed: number; remaining: number; foreign: number \}/.test(code)
    && /return \{ remaining: now\.own\.length, foreign: now\.foreign\.length \};/.test(code));
{
  const layout = readFileSync(join(ROOT, 'app', '_layout.tsx'), 'utf8');
  ok('OfflineSyncManager backs off on `remaining` alone, never on foreign entries (A3)',
    /remaining: res\.remaining \+ photos\.remaining/.test(layout) && !/res\.foreign/.test(layout),
    'another tenant\'s queue is the tenant switch\'s to drop, not a reason to retry forever');
  const depthHook = readFileSync(join(ROOT, 'hooks', 'useOfflineQueueDepth.ts'), 'utf8');
  ok('the depth pill counts only this session\'s entries (A3)',
    /getOwnOfflineQueue\(\)/.test(depthHook) && !/[^n]getOfflineQueue\(\)/.test(depthHook));
  const settings = readFileSync(join(ROOT, 'app', '(tabs)', 'settings', 'index.tsx'), 'utf8');
  ok('the sign-out dialog counts only this session\'s entries (A3)',
    /getOwnOfflineQueue\(\)/.test(settings),
    '"3 changes will be lost" must not be counting another tenant\'s leftovers');
  // A6 (round 4): the portal thread echoes QUEUED sends back into the message
  // list. Reading the raw queue printed the previous tenant's message into this
  // user's thread on a shared device — and it never left, because no flush under
  // this JWT will ever send it.
  const portal = readFileSync(join(ROOT, 'hooks', 'usePortalThread.ts'), 'utf8');
  ok('the portal thread echoes only this session\'s queued sends (A6)',
    /getOwnOfflineQueue\(\)/.test(portal) && !/[^n]getOfflineQueue\(\)/.test(portal),
    'the raw queue can hold another tenant\'s portal_messages insert');
  // A6: one toast per flush. The drop listener used to call oops() per message,
  // so a flush that gave up on a thread stacked N toasts on the host and the
  // user read only the last.
  const dropHandler = portal.slice(portal.indexOf('return onQueueDropped('));
  const dropBody = dropHandler.slice(0, dropHandler.indexOf('return mine;'));
  ok('…and reports a dropped batch in ONE toast, not one per message (A6)',
    dropBody.length > 0 && !/for \(const m of mine\) \{[\s\S]{0,400}?oops\(/.test(dropBody)
      && (dropBody.match(/\boops\(/g) ?? []).length <= 3,
    'N dropped sends must not stack N toasts — the last one wins the screen');
}

// ── A1 (review 2026-09-05, round 4): the MARKER is read before the QUEUE ─────
// Every tenant-switch path empties the queue FIRST and writes the last-user
// marker AFTER (AuthContext: clearOfflineQueue / retainOfflineQueueForUser, then
// writeLastUser). A flush that reads the queue first and the marker second can
// therefore pair a PRE-clear snapshot with a POST-clear marker — and every
// untagged entry in that stale snapshot is then adopted as the new session's own
// and dispatched under their JWT, which is the whole leak the tagging exists to
// close. Marker-then-queue is monotonically safe; queue-then-marker is not.
console.log('\nsession identity: the last-user marker is read before the queue (A1):');
for (const [fn, start] of [
  ['runOfflineQueue', 'async function runOfflineQueue'],
  ['getOwnOfflineQueue', 'export async function getOwnOfflineQueue'],
] as const) {
  const at = code.indexOf(start);
  const body = at === -1 ? '' : code.slice(at, at + 2000);
  const markerAt = body.indexOf('await readLastUserMarker()');
  const queueAt = body.indexOf('await getOfflineQueue()');
  ok(`${fn} reads the marker before the queue`,
    at !== -1 && markerAt !== -1 && queueAt !== -1 && markerAt < queueAt,
    at === -1 ? 'function renamed — re-read this guard' : 'a post-clear marker over a pre-clear queue adopts the previous tenant\'s untagged writes');
  ok(`${fn} does not race the two (no Promise.all around them)`,
    body.length > 0 && !/Promise\.all\(\[\s*getOfflineQueue\(\)/.test(body),
    'racing them is the same defect with no ordering at all');
}

// ── Follow-up 2026-09-05: the pre-sign-out flush lands parents before bytes ──
console.log('\nsign-out / token-handoff flush: offline queue first, then photos:');

// Since 20260904100400_storage_membership_policies.sql a photo upload is
// refused under RLS until its `projects` row exists. AuthContext's
// flushQueuesBeforeSignOut (sign-out, and beginSessionFromToken's flush under
// the previous tenant) used to RACE the two queues with Promise.allSettled, so
// a photo taken on a project created offline hit Storage before the project
// upsert had landed and spent its one chance before the session died on an
// RLS refusal. OfflineSyncManager already chains them; this pins the same
// order here. The ceiling must still bound the pair.
const authSrc = readFileSync(join(ROOT, 'contexts', 'AuthContext.tsx'), 'utf8');
const authCode = authSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const flushStart = authCode.indexOf('async function flushQueuesBeforeSignOut');
const flushEnd = flushStart === -1 ? -1 : authCode.indexOf('\n}\n', flushStart);
const flushFn = flushStart === -1 || flushEnd === -1 ? '' : authCode.slice(flushStart, flushEnd);
ok('flushQueuesBeforeSignOut was located', flushFn.length > 0,
  'renamed or restructured — re-read this guard before trusting it');
ok('the two queues are not raced (no Promise.all / Promise.allSettled inside it)',
  flushFn.length > 0 && !/Promise\.all(?:Settled)?\s*\(/.test(flushFn),
  'a photo whose project row is still in the text queue is refused under RLS when the two run together');
{
  const offlineAt = flushFn.indexOf('await processOfflineQueue()');
  const photosAt = flushFn.indexOf('await processPhotoUploadQueue()');
  ok('the offline queue is awaited BEFORE the photo queue starts',
    offlineAt !== -1 && photosAt !== -1 && offlineAt < photosAt,
    'project rows must land first; the photo policy depends on them');
}
ok('a leg that throws does not skip the other (each is its own try/catch)',
  /try \{\s*await processOfflineQueue\(\);\s*\} catch/.test(flushFn)
    && /try \{\s*await processPhotoUploadQueue\(\);\s*\} catch/.test(flushFn),
  'an unexpected throw in the text flush must not leave the photos unflushed');
ok('the ceiling still bounds the pair, so the sign-out button cannot hang',
  /Promise\.race\(\[flush, ceiling\]\)/.test(flushFn) && /SIGN_OUT_FLUSH_CEILING_MS/.test(flushFn));
ok('beginSessionFromToken flushes through the same function (the previous tenant\'s photos land after their rows too)',
  /const beginSessionFromToken = useCallback[\s\S]{0,600}?await flushQueuesBeforeSignOut\(\);/.test(authCode));

// ── BLOCKING 2 + A2 (review 2026-09-05, round 3): the queue's fate on a new
// session. Two separate defects lived in this one block.
console.log('\nonNewSessionEstablished: whose queue survives a new session:');

const establishStart = authCode.indexOf('const onNewSessionEstablished = useCallback');
const establishEnd = establishStart === -1 ? -1 : authCode.indexOf('await wipeLocalUserCache({ dropOfflineQueue: !keepQueue })', establishStart);
const establish = establishStart === -1 || establishEnd === -1 ? '' : authCode.slice(establishStart, establishEnd);
ok('onNewSessionEstablished was located', establish.length > 0,
  'renamed or restructured — re-read this guard before trusting it');

// BLOCKING 2. The narrowing used to require `handoff && !handoff.sameUser`, so
// the ONE caller that cannot run the pre-session step — app/reset-password.tsx
// on web, where supabase-js's own detectSessionInUrl redeems the recovery token
// and there is no handoff to pass — fell through to `keepQueue = queue.length > 0`
// and kept the WHOLE queue. On a marker-less install (fresh browser profile,
// storage cleared) that is the previous tenant's queue, and the marker written
// moments later is what lets the next flush adopt every untagged entry in it.
ok('a MISSING handoff is treated as "not the same user", like handoff.sameUser === false (BLOCKING 2)',
  /if \(last === null && incoming && !handoff\?\.sameUser\) \{/.test(establish),
  'requiring `handoff &&` here exempted the web password-reset path from the narrowing');
ok('…and the narrowing keeps only entries TAGGED for the arriving user',
  /retainOfflineQueueForUser\(incomingId\)/.test(establish)
    && /retainPhotoUploadQueueForUser\(incomingId\)/.test(establish),
  'an untagged entry may be another tenant\'s, and the marker written below would adopt it');

// A2. Both queues are emptied through their own module, under the same lock as
// the flush's read-modify-write. A bare multiRemove lost that race: the 20 s
// sign-out ceiling lets a flush outlive the wipe, still holding a pre-wipe
// snapshot, and its write-back re-created the key with the previous tenant's
// entries seconds later.
ok('the narrowing runs under the queue locks, not as a raw setItem here (A2)',
  !/AsyncStorage\.setItem\('mageid_offline_queue'/.test(authCode)
    && !/AsyncStorage\.setItem\('mageid_photo_upload_queue'/.test(authCode),
  'AuthContext duplicated the key literal and wrote it outside utils/offlineQueue\'s lock');
ok('the wipe empties the queues through clearOfflineQueue / clearPhotoUploadQueue (A2)',
  /await clearOfflineQueue\(\);\s*await clearPhotoUploadQueue\(\);/.test(authCode),
  'both must go through the module that owns the key and its lock');
ok('nothing in AuthContext removes the write-queue keys directly any more (A2)',
  !/OFFLINE_WRITE_QUEUE_KEYS/.test(authCode),
  'a multiRemove of these keys is the unlocked path a live flush writes back behind');
ok('…including the prefix sweep, which is pinned to dropOfflineQueue: false (A2)',
  /selectTenantKeysToWipe\(allKeys, \{ dropOfflineQueue: false \}\)/.test(authCode),
  'the sweep\'s multiRemove is unlocked too — the locked clears above cover both keys');

if (fail > 0) {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(1);
}
console.log(`\n${pass} passed, 0 failed\n`);
