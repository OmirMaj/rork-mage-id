// validate-sync-status.ts — the offline guarantee may only be described truthfully.
//
// WHAT THIS PROTECTS. MAGE keeps three durable offline queues and, until this
// campaign, showed the user ONE of them and could not see a write that had
// permanently failed. Two lies came out of that, both reachable by a real
// contractor:
//
//   1. "3 changes queued" on a phone holding 3 mutations, 40 unsent photos and
//      a 90-second dictation.
//   2. A write that exhausted MAX_RETRIES is REMOVED from the queue, so the
//      depth went DOWN and the pill got quieter as the work was lost. The only
//      trace was a toast fired during a background flush, into an unmounted
//      toast host.
//
// The invariants below are the ones that keep those from coming back. Most are
// BEHAVIOURAL — they call utils/syncStatusCore and utils/syncLedger and check
// the answers, so a rename cannot evade them. The handful of source pins at the
// end exist only where there is no injection seam (a require inside a queue's
// drop path, a key literal duplicated across two modules).
//
// Run via: bun run test:sync-status

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeSyncStatus,
  describeDepths,
  totalPending,
  type SyncStatusInput,
} from '../utils/syncStatusCore';
import {
  MAX_SYNC_FAILURES,
  SYNC_FAILURE_KEY,
  failureLabels,
  labelForTable,
  mergeFailures,
  ownFailures,
  parseFailures,
  type SyncFailure,
} from '../utils/syncLedger';
import { OFFLINE_WRITE_QUEUE_KEYS, selectTenantKeysToWipe } from '../utils/localCacheKeys';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

const base = (over: Partial<SyncStatusInput> = {}): SyncStatusInput => ({
  depths: { writes: 0, photos: 0, dictations: 0 },
  failures: { count: 0, labels: [] },
  readFailed: false,
  signedIn: true,
  ...over,
});

const fx = (id: string, at: number, over: Partial<SyncFailure> = {}): SyncFailure => ({
  id, kind: 'write', label: 'Daily report', reason: 'retried 5 times', at, userId: 'u1', ...over,
});

console.log('\n── 1. all three queues are counted, not just the text one ──────');
{
  const s = computeSyncStatus(base({ depths: { writes: 3, photos: 40, dictations: 1 } }));
  ok('pending is the sum of all three queues', s.pending === 44, `got ${s.pending}`);
  ok('photos alone make the pill visible',
    computeSyncStatus(base({ depths: { writes: 0, photos: 2, dictations: 0 } })).visible === true);
  ok('a dictation alone makes the pill visible',
    computeSyncStatus(base({ depths: { writes: 0, photos: 0, dictations: 1 } })).visible === true);
  ok('the badge quotes the total, not the text queue', s.badge.includes('44'), s.badge);
  ok('the title names every non-empty queue',
    s.title.includes('3 changes') && s.title.includes('40 photos') && s.title.includes('1 recording'), s.title);
  ok('totalPending clamps a negative depth to zero',
    totalPending({ writes: -5, photos: 2, dictations: 0 }) === 2);
}

console.log('\n── 2. pending and failed are never the same number ─────────────');
{
  const s = computeSyncStatus(base({
    depths: { writes: 10, photos: 0, dictations: 0 },
    failures: { count: 2, labels: ['Daily report — retried 5 times'] },
  }));
  ok('failed is not folded into pending', s.pending === 10, `got ${s.pending}`);
  ok('failed is reported separately', s.failed === 2, `got ${s.failed}`);
  ok('a failure outranks a larger pending count in the badge', s.tone === 'failed', s.tone);
  ok('the badge says the failures did NOT sync', /didn’t sync/.test(s.badge), s.badge);
  ok('the failed badge does not quote the pending total', !s.badge.includes('10'), s.badge);
  ok('the failed detail still mentions the pending work', s.detail.includes('10 changes'), s.detail);
  ok('the failed detail says it will NOT be sent', /will not be sent/.test(s.detail), s.detail);
  ok('the failed detail never promises a later sync of the failures',
    !/will sync|will be sent automatically/.test(s.detail.split('still queued')[0]), s.detail);
  ok('the failed detail lists what failed', s.detail.includes('Daily report'), s.detail);
}

console.log('\n── 3. a pending state promises exactly what the queue delivers ─');
{
  const s = computeSyncStatus(base({ depths: { writes: 1, photos: 0, dictations: 0 } }));
  ok('tone is pending', s.tone === 'pending', s.tone);
  ok('it promises an automatic retry', /automatically/.test(s.detail), s.detail);
  ok('it warns that the badge turns red on failure', /turns red/.test(s.detail), s.detail);
  ok('singular grammar for one item', s.title.startsWith('1 change'), s.title);
  ok('web copy says "on this device"',
    computeSyncStatus(base({ depths: { writes: 1, photos: 0, dictations: 0 } }), 'web').detail.includes('on this device'));
  ok('native copy says "on your phone"', s.detail.includes('on your phone'), s.detail);
}

console.log('\n── 4. "could not read" is never rendered as "all clear" ────────');
{
  // Depths deliberately NON-ZERO: two of the four keys parsed fine before the
  // third threw, so there IS a number in hand — and it is a number about a
  // device we could not finish reading. A fixture of all-zeros would make the
  // "quotes no depth" assertion below true of itself.
  const s = computeSyncStatus(base({ readFailed: true, depths: { writes: 6, photos: 3, dictations: 0 } }));
  ok('an unreadable queue is visible', s.visible === true);
  ok('…with its own tone, not clear', s.tone === 'unknown', s.tone);
  ok('…and says it could not check', /Couldn’t check/.test(s.title), s.title);
  ok('…and never claims nothing is waiting', !/all clear|nothing/i.test(s.badge), s.badge);
  ok('…and reassures that nothing was deleted', /Nothing has been deleted/.test(s.detail), s.detail);
  ok('…and quotes no depth it could not read', s.pending === 0 && s.failed === 0,
    `pending ${s.pending}, failed ${s.failed}`);
  const clear = computeSyncStatus(base());
  ok('a genuinely empty, readable device stays invisible', clear.visible === false && clear.tone === 'clear');

  // THE REGRESSION THIS PINS. The ledger and the queues are separate reads —
  // parseFailures never throws, each queue parse raises readFailed on its own —
  // so a single corrupt queue used to demote a RED "2 didn't sync" to a neutral
  // "Sync unknown" whose body read "Nothing has been deleted". The user was
  // affirmatively reassured about two writes that were permanently gone.
  const both = computeSyncStatus(base({
    readFailed: true,
    depths: { writes: 7, photos: 0, dictations: 0 },
    failures: { count: 2, labels: ['Daily report — retried 5 times'] },
  }));
  ok('a known failure OUTRANKS an unreadable queue', both.tone === 'failed', both.tone);
  ok('…the badge stays red and names the count', both.badge === '2 didn’t sync', both.badge);
  ok('…the user is NOT told nothing has been deleted',
    !/Nothing has been deleted/.test(both.detail), both.detail);
  ok('…the failure is still named', both.detail.includes('Daily report'), both.detail);
  ok('…and the unreadable pending depth is disclosed, not quoted',
    /couldn’t read/.test(both.detail) && !/7 changes/.test(both.detail) && both.pending === 0,
    `pending ${both.pending} — ${both.detail}`);
}

console.log('\n── 5. no session means no claim about the device ───────────────');
{
  const s = computeSyncStatus(base({
    signedIn: false,
    depths: { writes: 9, photos: 9, dictations: 9 },
    failures: { count: 4, labels: ['x'] },
  }));
  ok('nothing is shown without a session', s.visible === false, s.tone);
  ok('…and no count leaks out', s.pending === 0 && s.failed === 0);
}

console.log('\n── 6. describeDepths ───────────────────────────────────────────');
{
  ok('empty is the empty string', describeDepths({ writes: 0, photos: 0, dictations: 0 }) === '');
  ok('one part, no conjunction', describeDepths({ writes: 2, photos: 0, dictations: 0 }) === '2 changes');
  ok('two parts join with "and"',
    describeDepths({ writes: 1, photos: 2, dictations: 0 }) === '1 change and 2 photos',
    describeDepths({ writes: 1, photos: 2, dictations: 0 }));
  ok('three parts use a comma then "and"',
    describeDepths({ writes: 1, photos: 2, dictations: 3 }) === '1 change, 2 photos and 3 recordings',
    describeDepths({ writes: 1, photos: 2, dictations: 3 }));
  ok('order is fixed regardless of magnitude',
    describeDepths({ writes: 1, photos: 99, dictations: 1 }).indexOf('change')
      < describeDepths({ writes: 1, photos: 99, dictations: 1 }).indexOf('photo'));
}

console.log('\n── 7. the failure ledger ───────────────────────────────────────');
{
  const merged = mergeFailures([fx('a', 100)], [fx('a', 200), fx('b', 300)]);
  ok('the same drop is not recorded twice', merged.length === 2, JSON.stringify(merged.map((m) => m.id)));
  ok('newest first', merged[0].id === 'b', merged[0].id);
  ok('the surviving copy of a duplicate is the incoming one',
    merged.find((m) => m.id === 'a')!.at === 200);

  const many = mergeFailures([], Array.from({ length: MAX_SYNC_FAILURES + 15 }, (_, i) => fx(`x${i}`, i)));
  ok('the ledger is capped', many.length === MAX_SYNC_FAILURES, `got ${many.length}`);
  ok('…and the cap keeps the NEWEST', many[0].at === MAX_SYNC_FAILURES + 14, String(many[0].at));

  ok('an entry with no id is refused', mergeFailures([], [fx('', 1)]).length === 0);

  const all = [fx('a', 1, { userId: 'u1' }), fx('b', 2, { userId: 'u2' }), fx('c', 3, { userId: undefined })];
  const own = ownFailures(all, 'u1');
  ok('another tenant’s lost paperwork is not shown', own.length === 1 && own[0].id === 'a',
    JSON.stringify(own.map((o) => o.id)));
  ok('an UNTAGGED failure belongs to nobody', !own.some((o) => o.id === 'c'));
  ok('no session, no failures', ownFailures(all, null).length === 0);

  const labels = failureLabels([fx('a', 1), fx('b', 2), fx('c', 3, { label: 'Photo record' })]);
  ok('identical failures collapse with a count', labels.some((l) => l.includes('×2')), JSON.stringify(labels));
  ok('distinct failures stay distinct', labels.length === 2, JSON.stringify(labels));
  ok('a label carries the reason', labels[0].includes('retried 5 times'), labels[0]);

  ok('a known table gets a human name', labelForTable('daily_reports') === 'Daily report');
  ok('an unknown table falls back to the true raw name', labelForTable('weird_table') === 'weird_table');
}

console.log('\n── 8. the ledger parser refuses to invent entries ──────────────');
{
  ok('null reads as empty', parseFailures(null).length === 0);
  ok('garbage reads as empty', parseFailures('{{{').length === 0);
  ok('a non-array reads as empty', parseFailures('{"id":"a"}').length === 0);
  ok('an entry with an unknown kind is dropped',
    parseFailures(JSON.stringify([{ id: 'a', kind: 'nope', at: 1 }])).length === 0);
  ok('an entry with no timestamp is dropped',
    parseFailures(JSON.stringify([{ id: 'a', kind: 'write' }])).length === 0);
  const good = parseFailures(JSON.stringify([{ id: 'a', kind: 'photo', at: 5 }]));
  ok('a valid entry survives with safe defaults',
    good.length === 1 && good[0].label.length > 0 && good[0].reason.length > 0,
    JSON.stringify(good));
}

console.log('\n── 9. source pins (no injection seam exists for these) ─────────');
{
  const queue = strip(read('utils', 'offlineQueue.ts'));
  ok('the drop path writes the durable ledger',
    /recordSyncFailures\(/.test(queue) && /syncLedger/.test(queue), 'notifyDroppedWrites no longer records');
  ok('…before the toast, which is a no-op when the host is unmounted',
    queue.indexOf('recordSyncFailures') < queue.indexOf('NailItToast'));
  ok('…for every dropped entry, not only the unclaimed ones',
    queue.indexOf('recordSyncFailures') < queue.indexOf('const claimed'));
  // Scoped to the function body on purpose: `readFailed: true` also appears in
  // retainOfflineQueueForUser, so a whole-file grep for it stays green after
  // this function stops reporting the failure.
  const detailedFn = queue.slice(queue.indexOf('export async function getOwnOfflineQueueDetailed'));
  const detailedBody = detailedFn.slice(0, detailedFn.indexOf('\n}\n') + 1);
  ok('the queue exposes a read that can report a storage failure',
    detailedBody.length > 0 && /catch\s*\{[\s\S]*readFailed: true/.test(detailedBody),
    'getOwnOfflineQueueDetailed no longer distinguishes "unreadable" from "empty"');

  const ledger = read('utils', 'syncLedger.ts');
  ok('the ledger key carries the mageid_ prefix the tenant sweep matches',
    /SYNC_FAILURE_KEY = 'mageid_/.test(ledger));
  // The ledger SURVIVES a same-user re-auth, with the write queues it describes.
  // It was left out of that list once, and AuthContext's sweep — which runs on
  // every sign-in, keepQueue included — destroyed the red "2 didn't sync" notice
  // on the exact event (a magic link) the queues beside it are preserved for.
  // Driven through the real selector, not grepped: this is a behaviour.
  const kept = selectTenantKeysToWipe(
    ['mageid_offline_queue', 'mageid_sync_failures', 'mageid_projects'],
    { dropOfflineQueue: false },
  );
  ok('a same-user re-auth keeps the record of what did NOT sync',
    !kept.includes('mageid_sync_failures'),
    'the red badge is destroyed by the magic link the queue exemption exists for');
  ok('…alongside the queue it describes', !kept.includes('mageid_offline_queue'));
  ok('…while ordinary caches still go', kept.includes('mageid_projects'));
  ok('a deliberate sign-out still drops it',
    selectTenantKeysToWipe(['mageid_sync_failures'], { dropOfflineQueue: true })
      .includes('mageid_sync_failures'),
    'another contractor must not inherit it on a shared device');
  ok('…and cross-tenant safety comes from the tag, not the sweep',
    ownFailures([fx('a', 1, { userId: 'other' })], 'u1').length === 0);
  ok('…and the exempted literal is the ledger’s own key, not a stale copy',
    OFFLINE_WRITE_QUEUE_KEYS.includes(SYNC_FAILURE_KEY), SYNC_FAILURE_KEY);

  const hook = read('hooks', 'useSyncStatus.ts');
  // Scoped to the multiGet ARGUMENT LIST, not the file: every one of these
  // names also appears in the import block, so a whole-file grep stays green
  // after a key is dropped from the read.
  const mg = hook.slice(hook.indexOf('multiGet(['));
  const mgArgs = mg.slice(0, mg.indexOf(']'));
  ok('the hook reads all three queue keys plus the ledger, in one read',
    ['OFFLINE_QUEUE_KEY', 'PHOTO_QUEUE_KEY', 'AUDIO_QUEUE_KEY', 'SYNC_FAILURE_KEY']
      .every((k) => mgArgs.includes(k)),
    `multiGet reads only: ${mgArgs.replace(/\s+/g, ' ').trim()}`);
  ok('…and each queue contributes its own depth',
    /writes = partitionQueueForSession/.test(hook)
    && /photos = \(Array\.isArray\(queue\)/.test(hook)
    && /dictations = parseAudioQueue/.test(hook));
  ok('…and an unreadable key is reported, not counted as zero',
    /readFailed = true/.test(hook) && (hook.match(/readFailed = true/g) ?? []).length >= 3,
    'each queue parse must be able to raise readFailed on its own');
  ok('…and the ledger key literal matches utils/syncLedger',
    hook.includes('SYNC_FAILURE_KEY') && /SYNC_FAILURE_KEY = 'mageid_sync_failures'/.test(read('utils', 'syncLedger.ts')));
  ok('…and the duplicated text-queue key literal matches utils/offlineQueue',
    /const OFFLINE_QUEUE_KEY = 'mageid_offline_queue'/.test(hook)
    && /const OFFLINE_QUEUE_KEY = 'mageid_offline_queue'/.test(read('utils', 'offlineQueue.ts')));
  ok('…and only counts dictations that still need transcribing',
    /status === 'pending'/.test(hook), 'a ready transcript is not unsynced work');
  // A3, for the hook the pill ACTUALLY renders. scripts/validate-offline-group-abort
  // pins this invariant on hooks/useOfflineQueueDepth, which no longer has a
  // consumer — so that check now guards a hook nobody shows. These three are the
  // live ones: every queue, and the ledger, scoped to the session before a
  // number reaches the user. The persisted queues can each hold the PREVIOUS
  // contractor's work, kept only until the tenant switch drops it.
  ok('…text queue: scoped through partitionQueueForSession, with the marker',
    /partitionQueueForSession\(Array\.isArray\(queue\) \? queue : \[\], userId, marker\)/.test(hook));
  ok('…photo queue: scoped to entries tagged for this session',
    /\.filter\(\(t\) => t\?\.userId === userId\)/.test(hook));
  ok('…dictation queue: scoped to entries tagged for this session',
    /t\.userId === userId && t\.status === 'pending'/.test(hook));
  ok('…the failure ledger: scoped through ownFailures',
    /ownFailures\(parseFailures\(raw\.get\(SYNC_FAILURE_KEY\)\), userId\)/.test(hook));
  ok('…and no session means the hook claims nothing at all',
    /if \(!userId\) \{\s*\n?\s*next = EMPTY;/.test(hook));

  const pill = strip(read('components', 'OfflineSyncPill.tsx'));
  ok('the pill reads the whole-device status',
    /useSyncStatus/.test(pill), 'the pill is back on the single-queue depth hook');
  ok('…and no longer reads the single-queue depth hook', !/useOfflineQueueDepth/.test(pill));
  // PIN THE CALL, NOT THE IDENTIFIER. This was `/\{detail\}|detail,/` over the
  // whole file, which the destructuring line and the useCallback dep array both
  // satisfy — so replacing BOTH showAlert bodies with hard-coded strings
  // ("Your work is saved and will sync.") left the suite green while the user
  // read a sentence no §2 assertion had ever seen. Slice the handler and pin
  // the arguments actually passed.
  const press = pill.slice(pill.indexOf('const onPress'));
  const pressBody = press.slice(0, press.indexOf('], [visible'));
  ok('…the pill has an onPress body to pin', pressBody.length > 0 && pressBody.includes('showAlert'));
  ok('…and the plain state shows the core’s own title and detail, unedited',
    /showAlert\(title, detail\)/.test(pressBody.replace(/\s+/g, ' ')),
    'the pill is writing its own reassurance instead of the pinned copy');
  // Wave 4 (#1): the failed state opens a sheet instead of an alert. It must
  // still show the core's own title and detail (not a sentence of its own),
  // one row per record in the core's "Not saved to MAGE — …" words, and a
  // Retry ONLY where the ledger kept what it takes to resend — a Retry on a
  // photo note or a pre-payload entry would be the spinner that lies.
  ok('…and the failed state opens the sheet, which renders the core’s title and detail',
    // Wave-4 final fix: through presentSheet, which always presents (pinned
    // in validate-w4-integration-data-sync).
    /if \(tone === 'failed'\) \{\s*presentSheet\(\);/.test(pressBody)
      && /const presentSheet = useCallback\(\(\) => \{\s*if \(!sheetOpenRef\.current\) \{ setSheetOpen\(true\); return; \}/.test(pill)
      && /<Text style=\{styles\.sheetTitle\}>\{title\}<\/Text>/.test(pill)
      && /\{detail\.split\(/.test(pill),
    'the failed sheet must carry "will not be sent" from the core, not its own reassurance');
  ok('…one row per unsaved record, in the core’s own words',
    /unsaved\.map\(\(line\) =>/.test(pill) && /\{line\.line\}/.test(pill));
  ok('…and quotes status.badge rather than a locally built count', /status\.badge/.test(pill));
  ok('…and offers Retry only where the write can really be resent',
    /\{line\.canRetry \? \(\s*<Button\s+label="Retry"/.test(pill)
      && (pill.match(/label="Retry"/g) ?? []).length === 1,
    'Retry must be gated on canRetry (isRetryableFailure), never offered for work that is gone');
  ok('…and says a dismiss does not recover the data',
    /does NOT recover/.test(pill));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
