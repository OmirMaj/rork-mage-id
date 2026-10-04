// utils/aiConsentAccount.ts — the wiring that tells the ACCOUNT the answer to
// "Use AI features?" and reads back what the account says. The rules are
// utils/aiConsentSyncCore (pure, run under bun by
// scripts/validate-ai-consent-server.ts); this file only connects them to
// AsyncStorage, the one profiles read and the one rpc write.
//
// Imported only by components, hooks and screens. utils/aiConsent must never
// import it (about 50 bun validators import AI utils through that file).
//
// THE PHONE IS THE QUEUE. The stored answer plus one small record (the "meta":
// who answered, when, whether the account has heard it) are the durable state.
// Every push is built fresh from them, so it carries the answer's real age when
// it finally lands. Nothing is put on the offline queue: a queued profiles
// write would share a record key with the settings save, would freeze its
// payload, and would be dropped by a sign-out.
//
// THE ONE WRITE is set_my_ai_consent through supabaseRpcOnline: online-only,
// never queued, never written to the Not-saved ledger, never toasted, and
// called with no `record`, so it neither waits behind nor blocks any profiles
// write. The server keeps answers in order (a no always lands; a yes must be
// newer than the last no). This module never writes public.profiles directly.
//
// KEEP TRYING. A send that fails (no signal, the server refused it) leaves the
// record undelivered and arms ONE timer: AI_CONSENT_RETRY_MS later the same run
// happens again, and again after that, until a send lands, nothing is waiting,
// or someone else signs in. The phone has no "back online" signal to wait for
// (the app has no NetInfo; react-query's onlineManager only hears the browser's
// online/offline events), so a clock is the only trigger that is real on an
// iPhone while the app stays open. components/AiConsentAccountSync adds app
// start, the foreground and sign-out.
//
// A YES ON THE ACCOUNT IS NEVER COPIED ONTO A PHONE. This module never grants
// on the phone's gate and never writes the phone's answer key; the device
// answer is read straight from storage (the gate keeps its in-memory answer
// when a read throws, and that must never be pushed).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseRpcOnline } from '@/utils/offlineQueue';
import {
  AI_CONSENT_META_KEY,
  AI_CONSENT_QUESTION_VERSION,
  AI_CONSENT_STORAGE_KEY,
  ensureAiConsent,
  resetAiConsent,
} from '@/utils/aiConsent';
import { parseAiConsent, type AiConsentState } from '@/utils/aiConsentCore';
import {
  accountAiConsentFromRead,
  decideReconcile,
  isMissingAiConsentFunction,
  metaForAnswer,
  parseAiConsentMeta,
  parseSetConsentResult,
  type AccountAiConsent,
  type AiAnswer,
  type AiConsentMeta,
} from '@/utils/aiConsentSyncCore';

export interface AccountAiSnapshot {
  /** Whose account this snapshot describes (null = signed out). */
  userId: string | null;
  /** What the account says, or why it could not be read. 'unread' = not read yet. */
  account: AccountAiConsent | 'unread';
  /** The answer this phone still has to deliver to the account, if any. */
  pending: AiAnswer | null;
  /** True once a reconcile run has looked at this phone's answer for this user. */
  ready: boolean;
  /** The phone answer `pending` was worked out from (null = not looked yet).
   *  Settings says nothing about the account while the phone's answer has moved
   *  on from it: an answer given a moment ago has not been weighed yet. */
  seen: AiConsentState | null;
  /** An attempt to deliver `pending` FAILED and none has succeeded since. False
   *  while the first send is still in flight, so Settings does not say "has not
   *  been told yet" about a send that is about to land. */
  sendFailed: boolean;
}

export interface AccountAiHost {
  isWeb: boolean;
  /** Asks the account-scoped question (the web app); true only for "Allow". */
  askAccount: () => Promise<boolean>;
}

type SendResult = { ok: true; account: 'granted' | 'declined' | null; applied: boolean } | { ok: false };

let snap: AccountAiSnapshot = { userId: null, account: 'unread', pending: null, ready: false, seen: null, sendFailed: false };
const listeners = new Set<() => void>();
/** Every answer and every reconcile run is appended here, so runs never overlap. */
let chain: Promise<void> = Promise.resolve();
/** Meta writes, in the order the answers were given; never behind the network. */
let metaWrites: Promise<void> = Promise.resolve();
/** set_my_ai_consent is not on the server yet (this session). */
let functionMissing = false;
let host: AccountAiHost | null = null;
/** Bumped whenever the account's value is set from a write's answer, so a read
 *  that started earlier cannot overwrite it with what the account said before. */
let accountSeq = 0;

/** A send that failed is tried again this long after, while the app stays open. */
export const AI_CONSENT_RETRY_MS = 30_000;
let retryMs = AI_CONSENT_RETRY_MS;
/** The one armed retry (null = none). */
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function setSnap(next: Partial<AccountAiSnapshot>): void {
  snap = { ...snap, ...next };
  listeners.forEach((fn) => { try { fn(); } catch { /* a listener never breaks the sync */ } });
}

// ── The timed retry ────────────────────────────────────────────────────────

function clearRetry(): void {
  if (retryTimer === null) return;
  clearTimeout(retryTimer);
  retryTimer = null;
}

/** One more run for `userId` after the retry delay. Only ever one timer: arming
 *  replaces the one before. The run it starts arms the next one if it fails too. */
function armRetry(userId: string): void {
  clearRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void reconcileAiConsent(userId);
  }, retryMs);
}

/** TESTS ONLY (scripts/validate-ai-consent-server.ts and the jest suite): a
 *  short retry delay so the timed retry can be watched. No app file calls it. */
export function setAiConsentRetryMsForTests(ms: number | null): void {
  retryMs = ms === null ? AI_CONSENT_RETRY_MS : ms;
}

// ── Local reads and the meta write ─────────────────────────────────────────

/** The phone's stored answer. A read that THROWS is 'unknown': never the
 *  gate's in-memory value. */
async function readDeviceAnswer(): Promise<AiConsentState> {
  try {
    return parseAiConsent(await AsyncStorage.getItem(AI_CONSENT_STORAGE_KEY));
  } catch {
    return 'unknown';
  }
}

async function readMeta(): Promise<AiConsentMeta | null> {
  try {
    return parseAiConsentMeta(await AsyncStorage.getItem(AI_CONSENT_META_KEY));
  } catch {
    return null;
  }
}

async function writeMeta(m: AiConsentMeta): Promise<void> {
  try {
    await AsyncStorage.setItem(AI_CONSENT_META_KEY, JSON.stringify(m));
  } catch {
    // Not written: a no is still sent with no record (fail closed); a yes is not.
  }
}

// ── The snapshot ───────────────────────────────────────────────────────────

export function getAccountAiSnapshot(): AccountAiSnapshot {
  return snap;
}

export function subscribeAccountAi(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** A different person (or nobody) is signed in: forget what the last account said. */
export function resetAccountAi(userId: string | null): void {
  functionMissing = false;
  accountSeq += 1;
  clearRetry();
  setSnap({ userId, account: 'unread', pending: null, ready: false, seen: null, sendFailed: false });
}

export function setAccountAiHost(h: AccountAiHost | null): void {
  host = h;
}

// ── THE ONLY READ ──────────────────────────────────────────────────────────

/** What the account says now. A result that arrives after the signed-in user
 *  changed, or after a write already told us something newer, is dropped. On
 *  'unavailable' the last thing read for this same user this session stays.
 *  Never throws. */
export async function refreshAccountAiConsent(userId: string): Promise<AccountAiConsent> {
  const seq = accountSeq;
  let got: AccountAiConsent;
  try {
    const res = await supabase.from('profiles').select('ai_consent').eq('id', userId).maybeSingle();
    got = accountAiConsentFromRead(res);
  } catch {
    got = 'unavailable';
  }
  if (snap.userId !== userId || seq !== accountSeq) return got;
  if (got === 'unavailable' && snap.account !== 'unread') return got;
  setSnap({ account: got });
  return got;
}

// ── THE ONLY WRITE ─────────────────────────────────────────────────────────

/** Sends one answer for `userId`. Nothing is sent unless that person is the one
 *  signed in right now: the function writes the CALLER's row, so an answer must
 *  never ride on someone else's session. */
async function sendAnswer(userId: string, answer: AiAnswer, ageMs: number | null): Promise<SendResult> {
  try {
    if (snap.userId !== userId) return { ok: false };
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user?.id !== userId) return { ok: false };
    const res = await supabaseRpcOnline<unknown>('set_my_ai_consent', {
      p_answer: answer,
      p_age_ms: ageMs,
      p_version: AI_CONSENT_QUESTION_VERSION,
    });
    if (res.status !== 'synced') {
      if (isMissingAiConsentFunction(res.error)) functionMissing = true;
      return { ok: false };
    }
    const parsed = parseSetConsentResult(res.data);
    return parsed.ok ? parsed : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** The account answered a write: show what it says now, and what this phone
 *  still has to deliver (re-read, no network). Only for the signed-in user. */
async function noteAccountAnswered(userId: string, account: 'granted' | 'declined' | null): Promise<void> {
  const device = await readDeviceAnswer();
  const d = decideReconcile({
    userId,
    supabaseConfigured: isSupabaseConfigured,
    account: snap.userId === userId ? snap.account : 'unread',
    device,
    meta: await readMeta(),
    nowMs: Date.now(),
  });
  if (snap.userId !== userId) return;
  accountSeq += 1;
  setSnap({ account, pending: d.push ? d.push.answer : null, seen: device, sendFailed: false });
}

/** A send of `answer` for `userId` did not reach the account: say so, but only
 *  while that answer is still the one waiting. */
function noteSendFailed(userId: string, answer: AiAnswer): void {
  if (snap.userId === userId && snap.pending === answer) setSnap({ sendFailed: true });
}

async function runReconcile(userId: string | null, opts?: { onlyDeclined?: boolean }): Promise<void> {
  const device = await readDeviceAnswer();
  const meta = await readMeta();
  const d = decideReconcile({
    userId,
    supabaseConfigured: isSupabaseConfigured,
    account: snap.userId === userId ? snap.account : 'unread',
    device,
    meta,
    nowMs: Date.now(),
  });
  const pending = d.push ? d.push.answer : null;
  // A failure is remembered only for the answer it happened to: a new answer
  // (or nothing waiting) starts clean.
  if (snap.userId === userId) setSnap({ pending, ready: true, seen: device, sendFailed: pending !== null && pending === snap.pending && snap.sendFailed });
  // Nothing is waiting: nothing to try again.
  if (!d.push || !userId) { if (snap.userId === userId) clearRetry(); return; }
  if (opts?.onlyDeclined && d.push.answer !== 'declined') return;
  const { answer } = d.push;
  if (functionMissing) { noteSendFailed(userId, answer); return; }
  const r = await sendAnswer(userId, answer, d.push.ageMs);
  // Not heard: the record stays undelivered, and this same run happens again
  // after the retry delay (and at the next foreground or app start).
  if (!r.ok) {
    noteSendFailed(userId, answer);
    if (snap.userId === userId) armRetry(userId);
    return;
  }
  if (snap.userId === userId) clearRetry();
  // The account heard it (applied, or refused as stale: both are "heard"). Mark
  // the record delivered ONLY IF it still describes the answer just pushed.
  const after = await readMeta();
  const builtFromMeta = !!meta && meta.uid === userId && meta.answer === answer;
  if (builtFromMeta && meta) {
    if (after && after.uid === meta.uid && after.answer === meta.answer && after.at === meta.at) {
      await writeMeta({ ...after, delivered: true });
    }
  } else if ((await readDeviceAnswer()) === answer && !(after && after.uid !== null && after.uid !== userId)) {
    // A no pushed with no usable record: write the record it lacked.
    await writeMeta({ uid: userId, answer, at: after && after.answer === answer ? after.at : Date.now(), delivered: true });
  }
  await noteAccountAnswered(userId, r.account);
}

/** Appends `job` to the chain and resolves with its result; never rejects. */
function enqueue<T>(job: () => Promise<T>, fallback: T): Promise<T> {
  const run = chain.then(job).catch(() => fallback);
  chain = run.then(() => undefined);
  return run;
}

/** The person answered on this phone (the gate's answer event): write the
 *  record, then one reconcile run. Never throws. */
export function noteAiAnswer(userId: string | null, answer: AiAnswer): Promise<void> {
  const meta = metaForAnswer(answer, userId, Date.now());
  // Before anything is awaited: this answer is the one waiting now. Settings
  // then goes straight to saying nothing until the account has answered,
  // instead of describing the account against an answer it has not weighed.
  if (userId && snap.userId === userId) setSnap({ pending: answer, seen: answer, sendFailed: false });
  // On disk at once and in answer order; never behind a request still in flight.
  const written = (metaWrites = metaWrites.then(() => writeMeta(meta)).catch(() => undefined));
  return enqueue(async () => {
    await written;
    await runReconcile(userId);
  }, undefined);
}

/** One reconcile run: send what the account has not heard. Never throws. */
export function reconcileAiConsent(userId: string | null, opts?: { onlyDeclined?: boolean }): Promise<void> {
  return enqueue(() => runReconcile(userId, opts), undefined);
}

/** Resolves when every answer / reconcile run so far has settled, or after
 *  `timeoutMs`, whichever is first. */
export function settleAiConsentSync(timeoutMs = 4000): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void chain.then(() => { clearTimeout(timer); resolve(); });
  });
}

/** The "Allow" buttons. ALWAYS shows a question; never a silent grant.
 *  Phone: the phone's own question (the same two calls as Settings → AI
 *  features On); the gate's answer event does the write. Web: the
 *  account-scoped question, then the write; the web gate is not touched. */
export async function askAiConsentForAccount(userId: string | null): Promise<'allowed' | 'not_allowed' | 'failed'> {
  const h = host;
  if (!h || !userId) return 'failed';
  try {
    if (!h.isWeb) {
      await resetAiConsent();
      const yes = await ensureAiConsent();
      await settleAiConsentSync();
      return yes ? 'allowed' : 'not_allowed';
    }
    const yes = await h.askAccount();
    const answer: AiAnswer = yes ? 'granted' : 'declined';
    const r = await enqueue<SendResult>(() => sendAnswer(userId, answer, 0), { ok: false });
    if (!r.ok) return 'failed';
    await noteAccountAnswered(userId, r.account);
    if (!yes) return 'not_allowed';
    return r.account === 'granted' ? 'allowed' : 'failed';
  } catch {
    return 'failed';
  }
}

/** "Turn off" (web) and "Turn off for my account" (phone Settings): a no given
 *  NOW. Does not touch the phone's own gate. True when the account heard it. */
export async function turnOffAiForAccount(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const r = await enqueue<SendResult>(() => sendAnswer(userId, 'declined', 0), { ok: false });
    if (!r.ok) return false;
    const meta = await readMeta();
    if (meta && meta.uid === userId && meta.answer === 'declined' && !meta.delivered) {
      await writeMeta({ ...meta, delivered: true });
    }
    await noteAccountAnswered(userId, r.account);
    return r.account !== 'granted';
  } catch {
    return false;
  }
}
