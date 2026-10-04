// utils/aiConsentSyncCore.ts — telling the ACCOUNT the answer to "Use AI
// features?", as pure logic (no react-native, no AsyncStorage, no supabase) so
// scripts/validate-ai-consent-server.ts can run every rule under bun.
//
// WHY. The phone's gate (utils/aiConsentCore) rules this app's own AI buttons.
// Two server paths use AI with no tap in the app (the Friday client recap and
// Ask Your Home); they obey public.profiles.ai_consent, read by
// supabase/functions/_shared/aiConsent.ts. This file decides what the phone
// SENDS to the account and what the screens SAY about it. The wiring
// (storage, the one read, the one write) is utils/aiConsentAccount.
//
// THE RULES THAT MATTER.
//   - The phone is the queue: the stored answer plus one small record ("meta":
//     who answered, when, whether the account has heard it). Every push is
//     built fresh from them, so it always carries the answer's real age.
//   - A no is sent even when nothing else is known about it (fail closed).
//   - A yes is sent only when it is tied to the signed-in person and to a time.
//     A yes left on the phone by someone else, or one with no record, is never
//     sent: the account is asked again instead.
//   - The server is the judge of order (set_my_ai_consent, migration
//     20261004090000). The account's value is not consulted here beyond "the
//     column is not there yet".
//   - A screen says something about the account only when the account could be
//     read. 'unread', 'unavailable', 'missing_column' and 'no_profile' say
//     nothing.

import type { AiConsentState } from './aiConsentCore';

export type AiAnswer = 'granted' | 'declined';

/** What the account says. null = the row exists and the column is NULL: "never
 *  told". 'no_profile' = the read succeeded and returned no row. */
export type AccountAiConsent = 'granted' | 'declined' | null | 'no_profile' | 'missing_column' | 'unavailable';

/** uid: who was signed in when the person answered (null = nobody). at:
 *  Date.now() at the answer. delivered: the account has heard THIS answer (it
 *  may have refused a stale yes; that is still heard). */
export interface AiConsentMeta { uid: string | null; answer: AiAnswer; at: number; delivered: boolean }

const isAnswer = (v: unknown): v is AiAnswer => v === 'granted' || v === 'declined';

/** The stored record, or null for anything that is not exactly one. */
export function parseAiConsentMeta(raw: string | null | undefined): AiConsentMeta | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as { uid?: unknown; answer?: unknown; at?: unknown; delivered?: unknown };
  if (!isAnswer(o.answer)) return null;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null;
  if (typeof o.delivered !== 'boolean') return null;
  if (!(o.uid === null || (typeof o.uid === 'string' && o.uid.length > 0))) return null;
  return { uid: o.uid, answer: o.answer, at: o.at, delivered: o.delivered };
}

/** The record written the moment the person answers: not yet heard by the account. */
export function metaForAnswer(answer: AiAnswer, uid: string | null | undefined, nowMs: number): AiConsentMeta {
  return { uid: uid || null, answer, at: nowMs, delivered: false };
}

/** The profiles read failed because the column is not there yet (the app is
 *  ahead of the migration). */
export function isMissingAiConsentColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const m = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return m.includes('ai_consent') && (m.includes('does not exist') || m.includes('could not find'));
}

/** The rpc failed because set_my_ai_consent is not there yet. */
export function isMissingAiConsentFunction(message: string | null | undefined): boolean {
  if (typeof message !== 'string') return false;
  const m = message.toLowerCase();
  if (!m.includes('set_my_ai_consent')) return false;
  return m.includes('pgrst202') || m.includes('could not find the function');
}

/** What a `select('ai_consent') … maybeSingle()` result means. Never throws. */
export function accountAiConsentFromRead(
  result: { data?: { ai_consent?: unknown } | null; error?: { code?: string; message?: string } | null } | null | undefined,
): AccountAiConsent {
  try {
    if (!result) return 'unavailable';
    if (result.error) return isMissingAiConsentColumn(result.error) ? 'missing_column' : 'unavailable';
    if (result.data === null || result.data === undefined) return 'no_profile';
    const v = (result.data as { ai_consent?: unknown }).ai_consent;
    return isAnswer(v) ? v : null;
  } catch {
    return 'unavailable';
  }
}

/** What set_my_ai_consent answered. ok:true means the account HEARD the answer
 *  (applied or refused as stale); `account` is what the account says now. */
export function parseSetConsentResult(
  data: unknown,
): { ok: true; account: 'granted' | 'declined' | null; applied: boolean } | { ok: false; reason: string } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, reason: 'bad_response' };
  const o = data as { ok?: unknown; applied?: unknown; ai_consent?: unknown; reason?: unknown };
  if (o.ok === true) {
    if (isAnswer(o.ai_consent)) return { ok: true, account: o.ai_consent, applied: o.applied === true };
    if (o.ai_consent === null) return { ok: true, account: null, applied: o.applied === true };
    return { ok: false, reason: 'bad_response' };
  }
  if (o.ok === false) return { ok: false, reason: String(o.reason) };
  return { ok: false, reason: 'bad_response' };
}

export type ReconcileDecision =
  | { push: { answer: AiAnswer; ageMs: number | null } }
  | {
    push: null;
    reason: 'not_configured' | 'signed_out' | 'missing_column' | 'no_device_answer' | 'not_this_user'
      | 'delivered' | 'no_meta' | 'clock_moved';
  };

/** One reconcile run: what, if anything, this phone sends to the account now. */
export function decideReconcile(input: {
  userId: string | null | undefined;
  supabaseConfigured: boolean;
  account: AccountAiConsent | 'unread';
  device: AiConsentState;
  meta: AiConsentMeta | null;
  nowMs: number;
}): ReconcileDecision {
  const { userId, supabaseConfigured, account, device, meta, nowMs } = input;
  // 1
  if (!supabaseConfigured) return { push: null, reason: 'not_configured' };
  if (!userId) return { push: null, reason: 'signed_out' };
  // 2 — the column is not there, so the function is not there either.
  if (account === 'missing_column') return { push: null, reason: 'missing_column' };
  // 3
  if (device === 'unknown') return { push: null, reason: 'no_device_answer' };
  // 4 — someone else's answer survived on this phone; it is never sent to this account.
  if (meta && meta.uid !== null && meta.uid !== userId) return { push: null, reason: 'not_this_user' };
  // 5
  const metaOk = !!meta && meta.uid === userId && meta.answer === device;
  // 6 — a no is sent even with nothing else known (fail closed).
  if (device === 'declined') {
    if (metaOk && meta) {
      if (meta.delivered) return { push: null, reason: 'delivered' };
      return { push: { answer: 'declined', ageMs: nowMs >= meta.at ? nowMs - meta.at : null } };
    }
    return { push: { answer: 'declined', ageMs: null } };
  }
  // 7 — a yes is sent only when it is tied to this person and a time.
  if (!metaOk || !meta) return { push: null, reason: 'no_meta' };
  if (meta.delivered) return { push: null, reason: 'delivered' };
  if (nowMs < meta.at) return { push: null, reason: 'clock_moved' };
  return { push: { answer: 'granted', ageMs: nowMs - meta.at } };
}

/** The note on a job's Client portal screen. OWNER ONLY: the server gates on
 *  the project OWNER's answer and a phone knows only its own user's, so a
 *  collaborator's screen says nothing about it. */
export function portalAccountNote(input: {
  owner: boolean;
  isWeb: boolean;
  ready: boolean;
  device: AiConsentState;
  account: AccountAiConsent | 'unread';
  pending: AiAnswer | null;
}): { note: 'none' | 'not_allowed' | 'web_allowed'; action: 'allow' | 'turn_off' | null } {
  const { owner, isWeb, ready, device, account, pending } = input;
  if (!owner || !ready) return { note: 'none', action: null };
  if (account === 'granted') {
    return isWeb ? { note: 'web_allowed', action: 'turn_off' } : { note: 'none', action: null };
  }
  if (account === 'declined' || account === null) {
    // That yes is on its way: say nothing until the account has answered it.
    if (device === 'granted' && pending === 'granted') return { note: 'none', action: null };
    return { note: 'not_allowed', action: 'allow' };
  }
  return { note: 'none', action: null };
}

/** The line under Settings → AI features (phones): what the account says.
 *  seen: the phone answer `pending` was worked out from. The line speaks only
 *  while that is the answer the phone has NOW. In between (an answer given a
 *  moment ago that the sync has not weighed yet, or the question on screen) it
 *  says nothing, so no sentence or button appears for a few frames and goes.
 *  sendFailed: an attempt to deliver `pending` to the account has FAILED (and
 *  none has succeeded since). While this phone's no is still on its first way
 *  out the line says nothing: "has not been told yet … tries again" is shown
 *  only once a send really failed, so it never flashes during a send that is
 *  about to land. */
export function settingsAccountLine(input: {
  ready: boolean;
  device: AiConsentState;
  seen: AiConsentState | null;
  account: AccountAiConsent | 'unread';
  pending: AiAnswer | null;
  sendFailed: boolean;
}): { line: 'none' | 'also_allowed' | 'allowed' | 'not_told_yet' | 'not_allowed'; action: 'allow' | 'turn_off' | null } {
  const { ready, device, seen, account, pending, sendFailed } = input;
  if (!ready) return { line: 'none', action: null };
  // Only the exact same answer counts: a missing `seen` says nothing.
  if (seen !== device) return { line: 'none', action: null };
  if (account === 'granted') {
    if (device === 'granted') return { line: 'also_allowed', action: null };
    if (device === 'declined' && pending === 'declined') {
      // Only the exact value true counts: a missing flag says nothing.
      return sendFailed === true ? { line: 'not_told_yet', action: 'turn_off' } : { line: 'none', action: null };
    }
    return { line: 'allowed', action: 'turn_off' };
  }
  if (account === 'declined' || account === null) {
    if (device === 'granted') {
      return pending === 'granted' ? { line: 'none', action: null } : { line: 'not_allowed', action: 'allow' };
    }
    if (device === 'declined') return { line: 'not_allowed', action: null };
    return { line: 'none', action: null };
  }
  return { line: 'none', action: null };
}
