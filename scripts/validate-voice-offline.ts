// validate-voice-offline.ts — guards offline persistence for voice dictation.
//
// WHY: a super stood in a basement with no signal, dictated ninety seconds of a
// daily report, and lost all of it. utils/transcribeAudio.ts throws on any
// fetch failure; VoiceCaptureModal read the recorded file's URI inside the try
// block that threw, kept no reference to it, and mapped the next tap to a
// BRAND-NEW recording. Re-dictating failed identically, because he was still in
// the basement. Meanwhile app/onboarding.tsx promises "Works offline."
//
// The five things this file exists to keep true, in the order they matter:
//
//   1. A failed transcription ENQUEUES the recording instead of discarding it.
//   2. The queued recording survives a restart — including an iOS container
//      path that changed under it.
//   3. The retry budget TERMINATES. An unbounded retry is a dead task at the
//      head of the queue forever.
//   4. Giving up is VISIBLE. A recording silently discarded after N failures is
//      the same bug in a slower form, and there is no server-side copy of a
//      dictation to recover it from.
//   5. The storage key carries an approved prefix, so the queue is inside the
//      tenant wipe and one contractor's dictation cannot be read by the next
//      person to sign in on a shared site-office phone.
//
// The pure core is RUN for real; the RN-bound shell and the modal are pinned by
// source, because neither can be imported outside Metro. Every source pin is
// written so that reverting the fix flips it — this repo has shipped guards
// that were green and broken, and the mutation log for this one is in the
// agent report that introduced it.
//
// Run: bun run scripts/validate-voice-offline.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  AUDIO_MAX_QUEUE,
  AUDIO_MAX_RETRIES,
  AUDIO_QUEUE_DIRNAME,
  AUDIO_QUEUE_KEY,
  READY_TRANSCRIPT_TTL_MS,
  applyTranscribeOutcome,
  audioExtFromUri,
  classifyTranscribeError,
  classifyTranscribeResult,
  enqueueAudioTranscription,
  formatClipLength,
  giveUpMessage,
  isAudioTranscribeTask,
  parseAudioQueue,
  pendingForContext,
  pruneAudioQueue,
  readyForContext,
  reconcileAudioQueue,
  resolveTaskUri,
  savedOfflineMessage,
  serializeAudioQueue,
  sortAudioQueue,
  stagedFileName,
  takeReadyTranscript,
  voiceContextKey,
  type AudioTranscribeTask,
  type GiveUpReason,
} from '../utils/audioTranscribeCore';
import { APP_STORAGE_PREFIXES, isAppStorageKey, selectTenantKeysToWipe } from '../utils/localCacheKeys';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string): string => { try { return readFileSync(join(ROOT, p), 'utf8'); } catch { return ''; } };
// Comments in these files legitimately quote the bug they replaced, so a pin
// that reads prose would report a shipped fix as missing — or pass on a fix
// that exists only in a comment. Compare against CODE.
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

function task(over: Partial<AudioTranscribeTask> = {}): AudioTranscribeTask {
  return {
    id: 'aq-1', userId: 'user-1', fileRef: 'aq-1.wav', staged: true,
    uploadName: 'recording.wav', contentType: 'audio/wav',
    contextKey: 'daily-report-harbor-view', contextLabel: 'Daily Report — Harbor View',
    durationMs: 92_000, queuedAt: 1_000, retryCount: 0, status: 'pending', ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n1. a failed transcription is kept, not thrown away:');
// ═══════════════════════════════════════════════════════════════════════════

// The exact strings utils/transcribeAudio.ts throws. If these stop classifying
// as transient the basement case burns its retry budget and the dictation is
// deleted — which is the original bug with extra steps.
expect('"Transcription service unreachable" is transient',
  classifyTranscribeError(new Error('Transcription service unreachable. Network request failed')), 'transient');
expect('a raw RN fetch TypeError is transient',
  classifyTranscribeError(new TypeError('Network request failed')), 'transient');
expect('"Failed to fetch" (web) is transient', classifyTranscribeError(new Error('Failed to fetch')), 'transient');
expect('a timeout is transient', classifyTranscribeError(new Error('Request timed out')), 'transient');

// The whole point: a transient failure re-queues UNCHANGED. A budget spent
// while merely offline is a budget that runs out on a week-long jobsite.
{
  const t = task({ retryCount: 3 });
  const d = applyTranscribeOutcome(t, 'transient', '');
  ok('offline keeps the recording queued', d.keep && !d.dropped);
  expect('…and does NOT spend the retry budget', d.task.retryCount, 3);
  expect('…and leaves the audio reference alone', d.task.fileRef, t.fileRef);
}

// The end-to-end shape of the fix: the error the modal catches turns into a
// queued task, and the queue holds the recording.
{
  const err = new Error('Transcription service unreachable. Network request failed');
  const outcome = classifyTranscribeError(err);
  const { queue, dropped, deduped } = enqueueAudioTranscription([], task(), AUDIO_MAX_QUEUE);
  ok('the failure the modal catches does not settle', outcome !== 'success');
  expect('the recording is in the queue', queue.length, 1);
  expect('nothing was shed to put it there', dropped.length, 0);
  ok('the queued entry still points at audio', queue[0].status === 'pending' && queue[0].fileRef.length > 0);
  ok('it was appended, not merged over something', !deduped);
}

// Two failures on the SAME file (the automatic drain and the "Transcribe now"
// button seconds apart) must not queue the audio twice — and must not reset the
// budget of the entry already there.
{
  const first = task({ id: 'aq-1', queuedAt: 1_000, retryCount: 2 });
  const again = task({ id: 'aq-2', queuedAt: 9_000, retryCount: 0 });
  const { queue, deduped } = enqueueAudioTranscription([first], again, AUDIO_MAX_QUEUE);
  expect('a re-save of the same recording does not duplicate it', queue.length, 1);
  ok('…it is recorded as a dedupe', deduped);
  expect('…and cannot reset the retry budget by being re-saved', queue[0].retryCount, 2);
  expect('…nor jump the queue by being re-saved', queue[0].queuedAt, 1_000);
}

// A distinct recording is a distinct entry, even for the same form.
{
  const { queue } = enqueueAudioTranscription([task({ id: 'aq-1', fileRef: 'aq-1.wav' })],
    task({ id: 'aq-2', fileRef: 'aq-2.wav', queuedAt: 2_000 }), AUDIO_MAX_QUEUE);
  expect('a second recording queues alongside the first', queue.length, 2);
}

// A 200 that contains no words. Retrying the same bytes gets the same answer
// forever, so this settles — but loudly, never as an empty success.
expect('an empty transcript is not success', classifyTranscribeResult(''), 'no-speech');
expect('whitespace is not speech', classifyTranscribeResult('   \n '), 'no-speech');
expect('a real transcript is success', classifyTranscribeResult('poured the slab at eight'), 'success');
{
  const d = applyTranscribeOutcome(task(), 'no-speech', '');
  ok('no-speech is settled, not retried forever', !d.keep && d.dropped);
  expect('…and it is reported', d.gaveUp, 'no-speech');
}

// A success does NOT discard the entry — the transcript has to reach the form
// that asked for it, which is the part that has no analogue in the photo queue.
{
  const d = applyTranscribeOutcome(task(), 'success', '  poured the slab at eight  ', AUDIO_MAX_RETRIES, 5_000);
  ok('a transcript is held for its surface, not dropped', d.keep && !d.dropped);
  expect('…as a ready entry', d.task.status, 'ready');
  expect('…carrying the trimmed text', d.task.transcript, 'poured the slab at eight');
  expect('…stamped when it landed', d.task.transcribedAt, 5_000);
  ok('…with the audio reference cleared so it cannot be re-uploaded',
    d.task.fileRef === '' && d.task.staged === false);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n2. it survives a restart:');
// ═══════════════════════════════════════════════════════════════════════════

// AsyncStorage is a string store: a restart is exactly this round trip.
{
  const before = [task({ id: 'aq-1' }), task({ id: 'aq-2', status: 'ready', fileRef: '', staged: false, transcript: 'slab poured', transcribedAt: 2_000 })];
  const after = parseAudioQueue(serializeAudioQueue(before));
  expect('everything queued before the restart is still there', after.length, 2);
  expect('the pending recording keeps its file reference', after[0].fileRef, 'aq-1.wav');
  expect('…and its owner, so the tenant boundary survives too', after[0].userId, 'user-1');
  expect('…and the transcript waiting to be used is still there', after[1].transcript, 'slab poured');
}

// The reason a task stores a NAME and not an absolute path: an iOS app's
// container directory is a UUID that changes on reinstall and can change across
// OS updates. A persisted file:// would point at nothing while the bytes are
// still on the phone, and the drain would call that terminal and drop the
// dictation it was holding.
{
  const monday = 'file:///var/mobile/Containers/Data/Application/AAAA-1111/Documents/mageid-audio-queue/';
  const wednesday = 'file:///var/mobile/Containers/Data/Application/BBBB-2222/Documents/mageid-audio-queue/';
  const t = parseAudioQueue(serializeAudioQueue([task({ fileRef: stagedFileName('aq-1', 'wav') })]))[0];
  expect('the audio resolves under the container it was staged in',
    resolveTaskUri(t, monday), `${monday}aq-1.wav`);
  expect('…and under a container whose uuid changed under it',
    resolveTaskUri(t, wednesday), `${wednesday}aq-1.wav`);
  ok('nothing persisted pins the old container', !JSON.stringify(t).includes('AAAA-1111'));
}

// When staging failed we queue the recorder's own URI rather than dropping the
// dictation — and that one is used verbatim, not joined onto our folder.
expect('an unstaged recording keeps the absolute uri it was handed',
  resolveTaskUri(task({ staged: false, fileRef: 'file:///tmp/cache/rec.wav' }), 'file:///doc/queue/'),
  'file:///tmp/cache/rec.wav');

// A corrupt or hand-edited blob must cost only the entries it corrupted, and
// must never throw on a path that runs while the app is booting.
expect('a truncated blob reads as an empty queue', parseAudioQueue('[{"id":"aq'), []);
expect('a non-array reads as an empty queue', parseAudioQueue('{"id":"aq-1"}'), []);
expect('no stored value reads as an empty queue', parseAudioQueue(null), []);
{
  const mixed = JSON.stringify([task(), { id: 'aq-2' }, task({ id: 'aq-3', status: 'pending', fileRef: '' })]);
  const parsed = parseAudioQueue(mixed);
  expect('half-written entries are dropped, good ones kept', parsed.length, 1);
  ok('a pending entry with no audio is not a task', !isAudioTranscribeTask(task({ fileRef: '' })));
  ok('a ready entry with no transcript is not a task',
    !isAudioTranscribeTask(task({ status: 'ready', fileRef: '', transcript: '' })));
  ok('an untagged entry is not a task — it could be adopted by the next tenant',
    !isAudioTranscribeTask(task({ userId: '' })));
}

// A dictation recorded DURING a drain must survive the drain's write-back.
{
  const inFlush = task({ id: 'aq-1' });
  const recordedMidDrain = task({ id: 'aq-2', queuedAt: 5_000 });
  const kept = applyTranscribeOutcome(inFlush, 'transient', '').task;
  const next = reconcileAudioQueue([inFlush, recordedMidDrain], new Set(['aq-1']), new Map([['aq-1', kept]]));
  expect('both entries survive the write-back', next.map((t) => t.id), ['aq-1', 'aq-2']);
  const settled = reconcileAudioQueue([inFlush, recordedMidDrain], new Set(['aq-1']), new Map());
  expect('a settled entry leaves and the mid-drain one stays', settled.map((t) => t.id), ['aq-2']);
}

expect('drain order is oldest-first — dictation transcribes in the order it was spoken',
  sortAudioQueue([task({ id: 'b', queuedAt: 9 }), task({ id: 'a', queuedAt: 2 })]).map((t) => t.id), ['a', 'b']);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n3. the retry budget terminates:');
// ═══════════════════════════════════════════════════════════════════════════

// Driven as an actual loop with a hard ceiling, so an unbounded budget FAILS
// here instead of hanging the validator.
{
  let t = task();
  let rounds = 0;
  let ended: ReturnType<typeof applyTranscribeOutcome> | null = null;
  while (rounds < 1_000) {
    rounds++;
    const d = applyTranscribeOutcome(t, 'retryable', '');
    if (!d.keep) { ended = d; break; }
    t = d.task;
  }
  ok('a server error that never clears eventually gives up', ended !== null && ended.dropped,
    `still retrying after ${rounds} rounds`);
  expect('…after exactly the declared budget', rounds, AUDIO_MAX_RETRIES);
  expect('…and it is reported as exhaustion', ended?.gaveUp, 'retries-exhausted');
}

// The counter must move on every retryable failure, or the loop above never ends.
expect('each retryable failure spends one attempt',
  applyTranscribeOutcome(task({ retryCount: 1 }), 'retryable', '').task.retryCount, 2);

// A half-written or hand-edited entry off disk can carry a nonsense counter,
// and `-1e9 + 1 >= 6` is false forever — the budget would never terminate for
// exactly the entry most likely to be junk.
{
  let t = task({ retryCount: -1_000_000 });
  let rounds = 0;
  let dropped = false;
  while (rounds < 1_000) {
    rounds++;
    const d = applyTranscribeOutcome(t, 'retryable', '');
    if (!d.keep) { dropped = true; break; }
    t = d.task;
  }
  ok('a corrupt negative retry counter still terminates', dropped, `still retrying after ${rounds} rounds`);
  expect('…on the same budget as everything else', rounds, AUDIO_MAX_RETRIES);
}

// A caller that reports success with nothing to show for it is describing
// no-speech. A `ready` task holding an empty transcript fails
// isAudioTranscribeTask, so it would be swept away by the next parse — a
// dictation that disappears with nothing said about it.
{
  const d = applyTranscribeOutcome(task(), 'success', '   ');
  ok('a blank "success" is settled as no-speech, not written as a ready entry',
    !d.keep && d.dropped && d.gaveUp === 'no-speech');
  const kept = applyTranscribeOutcome(task(), 'success', 'slab poured').task;
  expect('…while a real transcript survives the round trip that would have dropped it',
    parseAudioQueue(serializeAudioQueue([kept])).length, 1);
}

// "returned 4299" is not a 429. Reading a status out of a longer number turns
// a hard failure into the rate limit that clears on its own, so the entry never
// spends its budget and sits at the head of the queue for good.
expect('a status is read as a whole number, not a prefix of a longer one',
  classifyTranscribeError(new Error('Transcription server returned 4299 bad things')), 'retryable');

// Offline must NOT terminate. Ten thousand transient failures in a row is a
// week in a basement, not a reason to delete the recording.
{
  let t = task();
  let dropped = false;
  for (let i = 0; i < 10_000; i++) {
    const d = applyTranscribeOutcome(t, 'transient', '');
    if (!d.keep) { dropped = true; break; }
    t = d.task;
  }
  ok('ten thousand offline attempts never drop the dictation', !dropped);
  expect('…and the budget is untouched', t.retryCount, 0);
}

// Status classification is the other half of the budget: the wrong bucket
// either burns it in a minute or never ends.
expect('a 5xx is retryable', classifyTranscribeError(new Error('Transcription server returned 502. bad gateway')), 'retryable');
expect('a 429 is transient — the proxy allows 60 uploads/hour and that clears on its own',
  classifyTranscribeError(new Error('Transcription server returned 429. Transcription limit reached (60 uploads per hour).')), 'transient');
expect('a 401 is retryable, not terminal — transcribeAudio falls back to the anon key on a token blip',
  classifyTranscribeError(new Error('Transcription server returned 401. Sign in is required to transcribe audio.')), 'retryable');
expect('a 400 about the body is terminal', classifyTranscribeError(new Error('Transcription server returned 400. Expected multipart/form-data')), 'terminal');
expect('413 too large is terminal', classifyTranscribeError(new Error('Transcription server returned 413. Audio is too large')), 'terminal');
expect('a missing file is terminal, not retried against nothing',
  classifyTranscribeError(new Error('The recording file no longer exists.')), 'terminal');
expect('ENOENT is terminal', classifyTranscribeError(new Error('ENOENT: no such file or directory')), 'terminal');
expect('a status-carrying object is read too', classifyTranscribeError({ status: 415, message: 'unsupported' }), 'terminal');
// Order matters: a file that vanished while the phone was offline reads as
// BOTH "no such file" and (via a 5xx-less message) as a network string in some
// vendors' wording. The missing file has to win, or the queue keeps a dead task
// at its head for the whole retry budget.
expect('a missing file beats a network-shaped message',
  classifyTranscribeError(new Error('Network error: no such file or directory')), 'terminal');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n4. giving up is visible:');
// ═══════════════════════════════════════════════════════════════════════════

// Every drop carries a reason, and every reason has something to say. A drop
// with a null reason is a silent discard, which is the bug.
{
  const drops: [TranscribeOutcomeLike, GiveUpReason][] = [
    ['no-speech', 'no-speech'],
    ['terminal', 'terminal'],
  ];
  for (const [outcome, reason] of drops) {
    const d = applyTranscribeOutcome(task(), outcome, '');
    ok(`${outcome} reports "${reason}" rather than dropping quietly`, d.dropped && d.gaveUp === reason);
  }
  const exhausted = applyTranscribeOutcome(task({ retryCount: AUDIO_MAX_RETRIES - 1 }), 'retryable', '');
  ok('retry exhaustion reports itself', exhausted.dropped && exhausted.gaveUp === 'retries-exhausted');
}
{
  // A kept task must never claim a give-up, or the shell would announce a loss
  // that did not happen and the user would re-record for nothing.
  const kept = applyTranscribeOutcome(task(), 'transient', '');
  ok('a kept dictation reports no loss', !kept.dropped && kept.gaveUp === null);
  const success = applyTranscribeOutcome(task(), 'success', 'slab poured');
  ok('a transcribed dictation reports no loss', !success.dropped && success.gaveUp === null);
}

// The message a user actually reads. It has to name the clip and say what to
// do; "something went wrong" is how a lost report goes unnoticed for a week.
{
  const reasons: GiveUpReason[] = ['no-speech', 'terminal', 'retries-exhausted', 'queue-cap', 'expired'];
  const seen = new Set<string>();
  for (const r of reasons) {
    const msg = giveUpMessage(r, task());
    ok(`"${r}" has something to say`, msg.length > 20, msg);
    ok(`…and names the dictation it lost`, msg.includes('1:32') && msg.includes('Daily Report — Harbor View'), msg);
    seen.add(msg);
  }
  expect('every reason reads differently — one generic sentence explains nothing', seen.size, reasons.length);
  ok('three of them tell the user to re-record, because only they can',
    reasons.filter((r) => /re-record/i.test(giveUpMessage(r, task()))).length >= 3);
}

expect('clip length is spoken in minutes and seconds', formatClipLength(92_000), '1:32');
expect('…and pads the seconds', formatClipLength(64_000), '1:04');
expect('…and survives a missing duration', formatClipLength(NaN), '0:00');

// Shedding at the cap is a loss like any other, and is announced like one.
{
  const full = Array.from({ length: 3 }, (_, i) => task({ id: `aq-${i}`, fileRef: `aq-${i}.wav`, queuedAt: i }));
  const { queue, dropped } = enqueueAudioTranscription(full, task({ id: 'aq-new', fileRef: 'new.wav', queuedAt: 99 }), 3);
  expect('the cap sheds oldest-first', dropped.map((t) => t.id), ['aq-0']);
  expect('…and keeps the newest recording', queue.map((t) => t.id), ['aq-1', 'aq-2', 'aq-new']);
  ok('…and the shed one has a sentence waiting for it', giveUpMessage('queue-cap', dropped[0]).length > 20);
}

// The cap exists because each PENDING entry pins ~2.9 MB of WAV on disk. A
// `ready` entry is a few KB of the user's own words with no audio behind it, so
// shedding one to make room for a recording throws away text that already
// exists — and then tells the user to "re-record it", which is both a loss and
// a lie about what happened.
{
  const readyOnes = Array.from({ length: 3 }, (_, i) => task({
    id: `r${i}`, status: 'ready', fileRef: '', staged: false, transcript: `words ${i}`, transcribedAt: i, queuedAt: i,
  }));
  const { queue, dropped, droppedReady } = enqueueAudioTranscription(
    readyOnes, task({ id: 'rec', fileRef: 'rec.wav', queuedAt: 99 }), 3);
  expect('a finished transcript is never shed to make room for a recording', dropped.map((t) => t.id), []);
  expect('…and none of them is lost at all while the cap is about audio',
    queue.map((t) => t.id), ['r0', 'r1', 'r2', 'rec']);
  expect('…so nothing is announced as a queue-cap loss', droppedReady.map((t) => t.id), []);
}
{
  // Transcripts are still bounded — a phone that never reopens the form must
  // not grow the row forever — but they leave under the sentence that fits:
  // the words were made, nobody collected them.
  const many = Array.from({ length: 4 }, (_, i) => task({
    id: `r${i}`, status: 'ready', fileRef: '', staged: false, transcript: `w${i}`, transcribedAt: i, queuedAt: i,
  }));
  const { droppedReady } = enqueueAudioTranscription(many, task({ id: 'rec', fileRef: 'rec.wav', queuedAt: 99 }), 3);
  expect('uncollected transcripts are capped too, oldest-first', droppedReady.map((t) => t.id), ['r0']);
  const shedReady = droppedReady[0] ?? task();
  ok('…and the sentence does not tell the user to redo work that already happened',
    !/re-record/i.test(giveUpMessage('expired', shedReady)), giveUpMessage('expired', shedReady));
}

// Dedupe is scoped to one user. On a shared site-office phone two tenants can
// hold the same unstaged cache URI, and merging across that line hands one
// contractor's queue entry — id, budget and all — to the other.
{
  const mine = task({ id: 'mine', userId: 'user-1', staged: false, fileRef: 'file:///cache/AV/rec.wav' });
  const theirs = task({ id: 'theirs', userId: 'user-2', staged: false, fileRef: 'file:///cache/AV/rec.wav' });
  const { queue, deduped } = enqueueAudioTranscription([mine], theirs);
  ok('one tenant’s recording never merges over another’s', !deduped);
  expect('…both entries survive, each tagged to its own user',
    queue.map((t) => `${t.id}:${t.userId}`), ['mine:user-1', 'theirs:user-2']);
}

// A transcript nobody collected expires — said out loud, because text
// disappearing between two visits to the same screen is unexplainable.
{
  const now = 10_000_000_000;
  const fresh = task({ id: 'fresh', status: 'ready', fileRef: '', staged: false, transcript: 'a', transcribedAt: now - 1_000 });
  const stale = task({ id: 'stale', status: 'ready', fileRef: '', staged: false, transcript: 'b', transcribedAt: now - READY_TRANSCRIPT_TTL_MS - 1 });
  const pending = task({ id: 'pending' });
  const { queue, expired } = pruneAudioQueue([fresh, stale, pending], now);
  expect('an old uncollected transcript expires', expired.map((t) => t.id), ['stale']);
  expect('a fresh one and any pending audio stay', queue.map((t) => t.id), ['fresh', 'pending']);
  ok('an expiry has a sentence waiting for it', giveUpMessage('expired', stale).length > 20);
}
ok('a pending recording is NEVER expired by age — that would be the silent discard again',
  pruneAudioQueue([task({ queuedAt: 0 })], 10_000_000_000).expired.length === 0);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n5. the storage key is inside the tenant boundary:');
// ═══════════════════════════════════════════════════════════════════════════

ok('the queue key carries an approved prefix',
  APP_STORAGE_PREFIXES.some((p) => AUDIO_QUEUE_KEY.startsWith(p)),
  `${AUDIO_QUEUE_KEY} matches none of ${APP_STORAGE_PREFIXES.join(', ')} — invisible to the tenant wipe`);
ok('…which is what makes it app-owned to the sweep', isAppStorageKey(AUDIO_QUEUE_KEY));
expect('…and a tenant switch removes it',
  selectTenantKeysToWipe(['sb-abc-auth-token', AUDIO_QUEUE_KEY, 'mageid_theme']), [AUDIO_QUEUE_KEY]);
ok('the key is not a Supabase/Stripe/RevenueCat key by accident',
  !/^sb-|^__stripe|^rc_/.test(AUDIO_QUEUE_KEY));
ok('the staging folder is namespaced to this app',
  AUDIO_QUEUE_DIRNAME.startsWith('mageid-'), AUDIO_QUEUE_DIRNAME);

// Ownership is enforced when a surface asks what it is holding, not only at
// wipe time: the persisted queue can carry another tenant's recordings right up
// until the switch drops them.
{
  const mine = task({ id: 'mine' });
  const theirs = task({ id: 'theirs', userId: 'user-2' });
  const otherForm = task({ id: 'other', contextKey: 'invoice-notes' });
  const readyMine = task({ id: 'ready', status: 'ready', fileRef: '', staged: false, transcript: 'slab poured', transcribedAt: 3 });
  const all = [mine, theirs, otherForm, readyMine];
  expect('a form sees only its own pending dictation, for this user',
    pendingForContext(all, 'daily-report-harbor-view', 'user-1').map((t) => t.id), ['mine']);
  expect('…and only its own finished transcripts',
    readyForContext(all, 'daily-report-harbor-view', 'user-1').map((t) => t.id), ['ready']);
  expect('the other tenant sees nothing of ours',
    pendingForContext(all, 'daily-report-harbor-view', 'user-2').map((t) => t.id), ['theirs']);
}

// The context key is what sends a transcript back to the form that asked for
// it — two projects' daily reports must not collect each other's words. The
// readable part of the key is TRUNCATED, and truncation on its own was a
// collision: construction project names are long and routinely differ only at
// the end, so these two slugged identically and Unit A's daily report would
// have offered Unit B's dictation for pasting into it.
{
  const a = voiceContextKey("Dictate today's report",
    'for Riverside Commons Multifamily Redevelopment — Building 3 Podium Level Unit A');
  const b = voiceContextKey("Dictate today's report",
    'for Riverside Commons Multifamily Redevelopment — Building 3 Podium Level Unit B');
  ok('two long project names that differ only past the truncation get different keys', a !== b, `${a}\n      ${b}`);
  ok('…and the key still reads like the screen it came from', a.startsWith('dictate-today-s-report-'), a);
  ok('…and is still storage-safe', /^[a-z0-9-]+$/.test(a), a);
  ok('two surfaces made only of punctuation do not collapse together',
    voiceContextKey('—', '—') !== voiceContextKey('!!', '??'),
    'both slug to nothing; only the hash of the full string keeps them apart');
}
ok('two projects get different context keys',
  voiceContextKey('Voice dictation', 'for Harbor View — Daily Report')
    !== voiceContextKey('Voice dictation', 'for Union Street — Daily Report'));
expect('the key is stable for the same surface',
  voiceContextKey('Voice dictation', 'for Harbor View — Daily Report'),
  voiceContextKey('Voice dictation', 'for Harbor View — Daily Report'));
ok('the key is storage-safe', /^[a-z0-9-]+$/.test(voiceContextKey('Voice dictation', 'for Harbor View — Daily Report')));

// Handing a transcript to its form removes it in the same step, or re-opening
// the screen offers text the user already pasted in.
{
  const ready = task({ id: 'r1', status: 'ready', fileRef: '', staged: false, transcript: 'slab poured', transcribedAt: 3 });
  const first = takeReadyTranscript([ready, task({ id: 'p1' })], 'r1');
  expect('the transcript is handed over', first.taken?.transcript, 'slab poured');
  expect('…and is gone from the queue', first.queue.map((t) => t.id), ['p1']);
  expect('taking it twice yields nothing', takeReadyTranscript(first.queue, 'r1').taken, null);
  expect('a pending recording cannot be taken as a transcript', takeReadyTranscript([task({ id: 'p1' })], 'p1').taken, null);
}

expect('a recorded wav is recognised', audioExtFromUri('file:///cache/AV/recording-1.wav'), 'wav');
expect('android m4a is recognised', audioExtFromUri('file:///cache/rec.m4a'), 'm4a');
expect('an extensionless uri falls back to wav (what iOS capture produces)', audioExtFromUri('file:///cache/rec'), 'wav');
expect('a staged name cannot escape the queue folder', stagedFileName('../../etc/passwd', 'wav'), '.._.._etc_passwd.wav');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe shell and the modal are wired to it:');
// ═══════════════════════════════════════════════════════════════════════════

const coreSrc = read('utils/audioTranscribeCore.ts');
const coreCode = stripComments(coreSrc);
const shellCode = stripComments(read('utils/audioTranscribeQueue.ts'));
const modalCode = stripComments(read('components/VoiceCaptureModal.tsx'));

ok('all three files exist', coreCode.length > 0 && shellCode.length > 0 && modalCode.length > 0);

// bun cannot parse `react-native`, so the moment the core imports it — directly
// or transitively — every assertion above silently stops running.
{
  const coreImports = [...coreCode.matchAll(/^\s*import\s[\s\S]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
  expect('the core has no imports at all — nothing can drag react-native in', coreImports, []);
  ok('the RN-bound shell is a separate module', /from 'react-native'/.test(shellCode));
}

// The queue holds a path, never audio. AsyncStorage's budget is a few MB total
// and one ninety-second WAV is ~2.9 MB.
ok('queue entries carry a file reference, never bytes',
  !/base64|Uint8Array|arrayBuffer|blob\(\)/.test(coreCode),
  'audio bytes in an AsyncStorage-backed queue blow its budget with the first recording');

// THE BUG: the URI must be held outside the try block that throws.
ok('the modal keeps the recorded uri outside the try that throws',
  /let recordedUri: string \| null = null;/.test(modalCode) && /recordedUri = uri;/.test(modalCode),
  'a URI read inside the try is destroyed by the throw a no-signal jobsite guarantees');
// stopAndUnloadAsync and setAudioModeAsync both run BEFORE the assignment
// above and both can throw — a phone call that interrupted the session leaves
// expo-av already unloaded, and unloading twice throws. Without asking the
// recorder for the file one more time, that path is still the original discard.
ok('an interrupted recording is salvaged from the recorder rather than dropped',
  /if \(!recordedUri\) \{[\s\S]{0,300}?const salvaged = recording\.getURI\?\.\(\);[\s\S]{0,200}?recordedUri = salvaged;/.test(modalCode),
  'a throw from stopAndUnloadAsync leaves recordedUri null and the ninety seconds on the floor');
ok('the modal enqueues on a failed transcription',
  /await queueAudioTranscription\(\{/.test(modalCode) && /localUri: recordedUri,/.test(modalCode),
  'without this the catch block is the discard');
ok('a saved recording is NOT reported as transcribed',
  /setStep\('saved'\)/.test(modalCode)
    && !/setStep\('saved'\)[\s\S]{0,200}onTranscriptReady/.test(modalCode),
  'handing the form an empty transcript looks exactly like success and hides the loss');
ok('the modal tells the user it is saved, and says it will transcribe later',
  /savedOfflineMessage\(/.test(coreCode) && /savedOfflineMessage\(saved\.task\)/.test(modalCode));
{
  const saved = savedOfflineMessage(task());
  ok('…and that sentence promises saving, not transcription',
    /saved/i.test(saved) && /signal/i.test(saved) && !/transcribed\b/i.test(saved), saved);
}

// The other half of the bug: the next tap used to be what destroyed the
// recording. It is now safe because the audio is already staged and queued.
ok("the next tap starts a new recording only once the old one is on disk",
  /if \(step === 'idle' \|\| step === 'error' \|\| step === 'saved'\) void startRecording\(\);/.test(modalCode),
  'a saved state that cannot record again is a dead end, and one that records without saving first is the old bug');

// The transcript has to come home.
ok('the modal shows dictation this surface saved offline',
  /getContextDictation\(contextKey\)/.test(modalCode) && /pendingNoticeMessage\(/.test(modalCode));
ok('…offers a manual retry rather than making the user wait for a timer',
  /processAudioTranscribeQueue\(\)/.test(modalCode) && /Transcribe now/.test(modalCode));
ok('…and hands a finished transcript to the form, removing it in the same step',
  /await takeTranscript\(readyClip\.id\)/.test(modalCode) && /onTranscriptReady\(text\)/.test(modalCode));
ok('every caller gets the offline path without being edited',
  /queueKey \?\? voiceContextKey\(title, contextLine\)/.test(modalCode),
  'a required prop would leave every existing voice surface on the old lossy path');

// Staging out of the OS-evictable cache is what makes "saved" true two days later.
// Named at the construction site, not "documentDirectory appears somewhere in
// the file": switching queueDir() to cacheDirectory sailed through the first
// version of this pin, because stageRecording's own `!FileSystem.documentDirectory`
// guard clause still satisfied it — a queue staging into the directory the OS
// reclaims, reported as green.
ok('the shell stages the recording into documentDirectory',
  /function queueDir\(\): string \{\s*return `\$\{FileSystem\.documentDirectory \?\? ''\}\$\{AUDIO_QUEUE_DIRNAME\}`;/.test(shellCode),
  'expo-av writes into the cache directory, which the OS reclaims under storage pressure');
ok('…and stages nothing into the cache directory at all',
  !/cacheDirectory/.test(shellCode),
  'a recording queued on Monday with no signal would simply not exist on Wednesday');
ok('…by copy-then-move, so a drain never meets a half-written file',
  /copyAsync\(\{ from: localUri, to: staged \}\)/.test(shellCode) && /moveAsync\(\{ from: staged/.test(shellCode),
  'a drain that reads a target mid-copy classifies ENOENT as terminal and drops the dictation');
ok('…and resolves the path against the CURRENT container every time',
  /resolveTaskUri\(task, dir\)/.test(shellCode),
  'a persisted absolute file:// breaks when the iOS container uuid changes');
ok('a staging failure still queues the recording',
  /fileRef: stagedName \?\? input\.localUri,/.test(shellCode),
  'refusing to queue because the copy failed throws away the dictation for a disk hiccup');

// Every give-up path in the shell must reach the user.
ok('the shell announces every give-up',
  /if \(decision\.gaveUp\) announceAfterWrite\.push\(\{ reason: decision\.gaveUp, task: decision\.task \}\);/.test(shellCode)
    && /for \(const a of announceAfterWrite\) announceGiveUp\(a\.reason, a\.task\);/.test(shellCode),
  'a drop without an announcement is the silent discard this module exists to end');
ok('…including the ones the cap and the TTL cause',
  /announceGiveUp\('queue-cap', d\)/.test(shellCode)
    && /announceAfterWrite\.push\(\{ reason: 'expired', task: t \}\)/.test(shellCode)
    && /for \(const d of merged\.droppedReady\) announceGiveUp\('expired', d\);/.test(shellCode));

// ORDERING. The audio may not be unlinked, and a transcription may not be
// claimed, until the reconcile has actually written the transcript to disk. A
// drain runs for minutes across several uploads; if the write throws or iOS
// kills the backgrounded app in the gap, an eagerly-deleted recording leaves
// the queue saying `pending` over a file that is gone — the next drain reads
// ENOENT, calls it terminal, and BOTH the dictation and its transcript are
// lost. That is the original bug, arrived at through the fix for it.
{
  const write = shellCode.indexOf('const persisted = await withQueueLock');
  const unlink = shellCode.indexOf('for (const t of unlinkAfterWrite) void discardRecording(t);');
  const notify = shellCode.indexOf('for (const t of transcribedAfterWrite) notifyTranscribed(t);');
  const announce = shellCode.indexOf('for (const a of announceAfterWrite) announceGiveUp(a.reason, a.task);');
  ok('the audio is deleted only after the write-back has landed', write > 0 && unlink > write,
    'deleting on success writes the transcript to memory and the deletion to disk');
  ok('…and the loss is announced only then too', write > 0 && announce > write);
  ok('…and so is the good news', write > 0 && notify > write);
  ok('nothing in the upload loop deletes a recording inline',
    !/(discardRecording\(task\)|notifyTranscribed\(decision)/.test(shellCode),
    'an inline discard is the eager deletion this ordering exists to prevent');
}

// Both read-modify-write sites take the THROWING read. getAudioTranscribeQueue()
// answers a storage refusal with [], and a write on top of that empty array
// erases every dictation still waiting for signal — with no server-side copy to
// get them back from.
ok('the enqueue merges onto the real queue, never onto a swallowed read failure',
  /const current = await readQueueOrThrow\(\);\s*const \{ queue, dropped, droppedReady \} = enqueueAudioTranscription/.test(shellCode),
  'a storage hiccup would otherwise wipe every other pending dictation');
ok('…and so does the drain’s write-back',
  /const current = await readQueueOrThrow\(\);\s*if \(current\.length === 0\) return \[\] as AudioTranscribeTask\[\];/.test(shellCode),
  'a swallowed read failure here writes nothing, and the deferred deletes then unlink audio the queue still calls pending');
ok('a refused save takes its own staged copy back off disk',
  /if \(stagedName\) \{[\s\S]{0,200}deleteAsync\(`\$\{queueDir\(\)\}\$\{stagedName\}`/.test(shellCode),
  'a ~3 MB orphan per refusal fills the phone of the user we just told we could not help');
ok('a fire-and-forget drain never rejects at its caller',
  /inFlight = runAudioTranscribeQueue\(\)\s*\.catch\(/.test(shellCode),
  'OfflineSyncManager voids this call; a rejection nobody caught is a warning in place of a queue that kept the work');
ok('…through the toast the rest of the app uses, and Sentry',
  /NailItToast/.test(shellCode) && /Sentry/.test(shellCode));
ok('the shell says so when a dictation finally transcribes',
  /function notifyTranscribed/.test(shellCode) && /nailIt\(/.test(shellCode),
  'text that arrives with no word of it is text nobody goes back for');

// Concurrency and the tenant boundary in the shell.
// Named site by site rather than "a lock appears somewhere in the file": the
// first draft of this pin was `withQueueLock(async () => { …lazy… writeQueue(`,
// and a mutation that took the lock OFF the drain's write-back sailed through
// it, because the enqueue's own locked block still satisfied the pattern. Each
// read-modify-write has to be named where it is.
ok('the drain’s write-back runs under the lock',
  /const persisted = await withQueueLock\(async \(\) => \{/.test(shellCode),
  'an unlocked write-back clobbers a dictation recorded during the drain');
ok('the enqueue runs under the same lock',
  /const merged = await withQueueLock\(async \(\) => \{[\s\S]{0,600}?const \{ queue, dropped, droppedReady \} = enqueueAudioTranscription/.test(shellCode),
  'an unlocked enqueue is overwritten by the write-back of a drain already in the air');
ok('…and there is one lock, serialising both',
  /^let queueLock: Promise<unknown> = Promise\.resolve\(\);$/m.test(shellCode)
    && /function withQueueLock<T>\(fn: \(\) => Promise<T>\): Promise<T>/.test(shellCode));
ok('overlapping drains are coalesced',
  /if \(inFlight\) return inFlight;/.test(shellCode),
  'two drains on one snapshot upload the same audio twice');
ok('a drain is bound to the session it started under',
  /const sessionUserId = await currentSessionUserId\(\);/.test(shellCode)
    && /\(await currentSessionUserId\(\)\) !== sessionUserId/.test(shellCode),
  'a drain that outlives a sign-out sends the previous tenant’s dictation under the new JWT');
ok('a signed-out device queues rather than dispatching',
  /if \(!sessionUserId\) return \{ \.\.\.EMPTY_FLUSH, foreign: queue\.length \};/.test(shellCode),
  'dispatching with no session 401s every entry and burns the retry budget');
ok('a recording is refused rather than saved untagged',
  /if \(!userId\) \{\s*return \{ saved: false/.test(shellCode),
  'an untagged recording can be adopted by whoever signs in next on a shared phone');
ok('the queue can be emptied on a tenant switch, under the same lock',
  /export async function clearAudioTranscribeQueue\(\): Promise<void> \{\s*const cleared = await withQueueLock\(/.test(shellCode),
  'an unlocked wipe races the write-back still in the air and resurrects the previous tenant’s dictation');
ok('…and narrowed to an arriving user, like the other two queues',
  /export async function retainAudioTranscribeQueueForUser/.test(shellCode));
ok('enqueueing never throws at a caller mid-recording',
  /export async function queueAudioTranscription[\s\S]*?try \{[\s\S]*?\} catch \(err\) \{[\s\S]*?return \{ saved: false/.test(shellCode),
  'a throw here loses the recording at the exact moment the whole module exists to keep it');

// A drain that re-arms on `remaining > 0` alone is a hot loop re-uploading
// multi-MB WAVs on a phone with no signal.
ok('the opportunistic drain re-arms only on evidence, never on "still offline"',
  /if \(queuedSinceSnapshot \|\| \(res\.transcribed > 0 && res\.remaining > 0\)\) scheduleOpportunisticDrain\(\);/.test(shellCode),
  'a bare remaining > 0 never terminates offline');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

// Local alias so the drop table above reads as data rather than a cast.
type TranscribeOutcomeLike = Parameters<typeof applyTranscribeOutcome>[1];
