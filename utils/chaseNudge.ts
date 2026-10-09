// ============================================================================
// utils/chaseNudge.ts — ONE way to chase someone (UX wave, Lane A, item A7).
//
// Moved out of app/waiting-on.tsx, where `sendNudge` and `recordChase` lived as
// component closures. Two surfaces now send a follow-up: /waiting-on (every
// chase row and every preventive warning) and the desktop Action Required dock
// ("Nudge" on an overdue RFI or a stale submittal). A second copy of the send
// for the second surface is how the two would drift into recording different
// things, so both call this file:
//
//   • appendChase — the chase-log updater waiting-on's recordChase ran inline,
//     verbatim: one FollowUpChase appended, lastFollowUpAt written beside it in
//     the same statement, status 'chased'.
//   • recordChaseToLog — the same append for a surface that does NOT hold the
//     log in state (the dock): read the stored log, append, write it back, and
//     tell any mounted /waiting-on so its in-memory copy (which it persists
//     wholesale) takes the chase instead of overwriting it.
//   • chaseRecipientEmail — who to address, only when the record says so
//     exactly (an address in the holder field, the assigned sub's email, or ONE
//     contact / sub whose name matches the holder). Never a guess: two matches
//     is no address.
//   • sendNudge — hand the drafted words out of the app and report HOW they
//     left, or null when nothing left:
//       - on the web with a known address it opens a pre-addressed email
//         (buildMailtoUrl) and then ASKS "Did you send it?" — an opened mail
//         client proves nothing (the work-order.tsx dispatch rule), so the
//         chase is logged only on "Sent";
//       - otherwise the OS share sheet with the clipboard as the fallback,
//         exactly as waiting-on did it (shareText's result read the same way:
//         a cancel records nothing — audit 2026-09-23 #54).
//
// PURE: no React Native import. Every IO call (share, clipboard, alert, open a
// URL, storage) is injected, so scripts/validate-ux-lane-a.ts drives every
// branch under bun.
//
// HONESTY: a logged chase says the follow-up LEFT the app. It never says it was
// delivered or read — see the FollowUpChase note in types/index.ts. A web email
// is logged with via 'share' (it went to a mail client he confirmed he sent
// from); FollowUpChase['via'] has no 'email' member and widening it is a types
// change outside this lane.
// ============================================================================

import type { FollowUpChase, FollowUpHold } from '@/types';
import type { AlertButton } from '@/utils/alertCore';
import { buildMailtoUrl } from '@/utils/mailtoComposer';

/** The chase log's storage key. MUST equal app/waiting-on.tsx's
 *  FOLLOW_UP_HOLDS_KEY (scripts/validate-chase-log.ts pins that screen's own
 *  literal; scripts/validate-ux-lane-a.ts pins that the two agree). */
export const CHASE_LOG_KEY = 'mageid_follow_up_holds';

export type ChaseVia = FollowUpChase['via'];

export interface ChaseEntry {
  /** `${kind}:${id}` for a chase item (waiting-on's chaseHoldId), or a
   *  preventive FollowUp's own id. */
  id: string;
  projectId: string;
  via: ChaseVia;
  message: string;
  /** ISO instant of the tap. */
  at: string;
}

export type ChaseLog = Record<string, FollowUpHold>;

/** The hold id a chase item is filed under — waiting-on's chaseHoldId rule,
 *  for callers that are not ChaseItems (the dock's RFI / submittal rows). */
export function chaseLogId(kind: 'rfi' | 'submittal', recordId: string): string {
  return `${kind}:${recordId}`;
}

/**
 * Append one chase to the log. Pure (React may run a state updater twice).
 * Moved verbatim from waiting-on's recordChase updater.
 */
export function appendChase(prev: ChaseLog, e: ChaseEntry): ChaseLog {
  const chase: FollowUpChase = { at: e.at, via: e.via, message: e.message };
  const existing = prev[e.id];
  const chases = [...(existing?.chases ?? []), chase];
  const hold: FollowUpHold = {
    ...existing,
    id: e.id,
    projectId: e.projectId,
    // His ENGAGEMENT with the item, not the record's own status — the RFI is
    // still open, he has just now chased it (see FollowUpStatus).
    status: 'chased',
    chases,
    // Denormalised from the array it is written beside, in the same
    // statement, so the two can never disagree.
    lastFollowUpAt: e.at,
    createdAt: existing?.createdAt ?? e.at,
    updatedAt: e.at,
  };
  return { ...prev, [e.id]: hold };
}

// ── Cross-surface: a chase recorded where the log is not in state ───────────

type ChaseListener = (e: ChaseEntry) => void;
const listeners = new Set<ChaseListener>();

/** /waiting-on subscribes while mounted, so a chase the dock records lands in
 *  its in-memory log (which it persists wholesale) instead of being overwritten
 *  by its next write. Returns the unsubscribe. */
export function onChaseRecorded(fn: ChaseListener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export interface ChaseStorage {
  getItem: (k: string) => Promise<string | null>;
  setItem: (k: string, v: string) => Promise<void>;
}

/** Parse a stored log; anything unreadable is an empty log, never a throw. */
export function parseChaseLog(raw: string | null | undefined): ChaseLog {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as ChaseLog) : {};
  } catch {
    return {};
  }
}

/**
 * Record a chase from a surface that does not hold the log (the dock): read,
 * append, write, notify. A mounted /waiting-on hears it through
 * onChaseRecorded. A failed write still notifies (the screen's own persist is
 * then the write that lands).
 */
export async function recordChaseToLog(e: ChaseEntry, storage: ChaseStorage): Promise<void> {
  try {
    const prev = parseChaseLog(await storage.getItem(CHASE_LOG_KEY));
    await storage.setItem(CHASE_LOG_KEY, JSON.stringify(appendChase(prev, e)));
  } catch {
    /* the notify below still reaches a mounted waiting-on */
  }
  for (const fn of [...listeners]) {
    try { fn(e); } catch { /* one listener cannot stop the rest */ }
  }
}

// ── Who to address ──────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const norm = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const usable = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t && EMAIL_RE.test(t) && EMAIL_RE.exec(t)?.[0] === t ? t : null;
};

export interface ChaseContactLike { firstName?: string; lastName?: string; companyName?: string; email?: string }
export interface ChaseSubLike { id: string; companyName?: string; contactName?: string; email?: string }

/**
 * The address a follow-up can be sent to, or null. Only an exact statement on
 * the record counts:
 *   1. an email written in the holder field ("tom@arch.com" or
 *      "Tom Reyes <tom@arch.com>");
 *   2. the assigned sub's email (RFI.assignedSubId);
 *   3. exactly ONE address among contacts / subs whose full name, company or
 *      contact name equals the holder text. Two different addresses is an
 *      ambiguity, and an ambiguity is no address.
 */
export function chaseRecipientEmail(
  holder: { text?: string | null; subId?: string | null },
  book: { contacts?: readonly ChaseContactLike[] | null; subs?: readonly ChaseSubLike[] | null },
): string | null {
  const text = (holder.text ?? '').trim();
  const inText = EMAIL_RE.exec(text)?.[0];
  if (inText) return inText;
  if (holder.subId) {
    const sub = (book.subs ?? []).find(s => s.id === holder.subId);
    const e = usable(sub?.email);
    if (e) return e;
  }
  const want = norm(text);
  if (!want) return null;
  const found = new Set<string>();
  for (const c of book.contacts ?? []) {
    const full = norm(`${c.firstName ?? ''} ${c.lastName ?? ''}`);
    if (full === want || norm(c.companyName) === want) {
      const e = usable(c.email);
      if (e) found.add(e.toLowerCase());
    }
  }
  for (const s of book.subs ?? []) {
    if (norm(s.companyName) === want || norm(s.contactName) === want) {
      const e = usable(s.email);
      if (e) found.add(e.toLowerCase());
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

/** 'RFI #12 · Henderson Kitchen' — the follow-up email's subject. */
export function chaseMailSubject(kind: 'rfi' | 'submittal', number: number | string | null | undefined, projectName: string | null | undefined): string {
  const label = kind === 'rfi' ? 'RFI' : 'Submittal';
  const num = number === null || number === undefined || number === '' ? '' : ` #${number}`;
  const job = (projectName ?? '').trim();
  return `${label}${num}${job ? ` · ${job}` : ''}`;
}

// ── Send ────────────────────────────────────────────────────────────────────

export type ShareResult = 'shared' | 'cancelled' | 'copied' | 'failed';

export interface SendNudgeDeps {
  platform: string;
  /** utils/shareText shareText. */
  shareText: (o: { message: string }) => Promise<ShareResult>;
  /** utils/shareText canShare. */
  canShare: () => boolean;
  /** utils/alert showAlert. */
  showAlert: (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: { cancelable?: boolean; onDismiss?: () => void },
  ) => void;
  /** Linking.openURL. */
  openURL: (url: string) => Promise<unknown>;
  /** A light haptic on the phone (the caller decides; web passes nothing). */
  haptic?: () => void;
}

export interface SendNudgeInput {
  message: string;
  /** A resolved address (chaseRecipientEmail). Used on the web only. */
  to?: string | null;
  subject?: string;
  /** Who it is for, for the "Did you send it?" line. */
  toName?: string | null;
}

export const DID_YOU_SEND_TITLE = 'Did you send it?';
export const DID_YOU_SEND_YES = 'Log as Sent';
export const DID_YOU_SEND_NO = 'Not Sent';

/**
 * Hand one drafted follow-up out of the app. Resolves how it left ('share' /
 * 'clipboard') — the caller logs the chase with that — or null when nothing
 * left (a cancel, a "Not Sent", a failure). Never throws.
 */
export async function sendNudge(input: SendNudgeInput, deps: SendNudgeDeps): Promise<ChaseVia | null> {
  deps.haptic?.();
  const message = input.message;

  // Web + a known address: a pre-addressed email, then ASK. openURL resolves
  // on the web even with no mail handler, so "it opened" is not evidence.
  const to = deps.platform === 'web' ? usable(input.to) : null;
  if (to) {
    let opened = false;
    try {
      await deps.openURL(buildMailtoUrl({ to, subject: input.subject, body: message.split('\n') }));
      opened = true;
    } catch {
      opened = false;
    }
    if (opened) {
      return new Promise<ChaseVia | null>(resolve => {
        let settled = false;
        const done = (v: ChaseVia | null) => { if (!settled) { settled = true; resolve(v); } };
        const who = (input.toName ?? '').trim() || to;
        deps.showAlert(
          DID_YOU_SEND_TITLE,
          `MAGE can't see your email. Log this follow-up only once it has actually gone to ${who}.`,
          [
            { text: DID_YOU_SEND_NO, style: 'cancel', onPress: () => done(null) },
            { text: DID_YOU_SEND_YES, onPress: () => done('share') },
          ],
          { cancelable: true, onDismiss: () => done(null) },
        );
      });
    }
    // The mail client would not open: fall through to the clipboard path.
  }

  // The share sheet, clipboard fallback — waiting-on's original send.
  const couldOpenSheet = deps.canShare();
  let outcome: ShareResult;
  try {
    outcome = await deps.shareText({ message });
  } catch {
    outcome = 'failed';
  }
  if (outcome === 'cancelled') return null;
  if (outcome === 'shared') return 'share';
  // 'copied' — the text IS on his clipboard (no share sheet here, or the sheet
  // failed), which is exactly the claim a clipboard chase records.
  const via: ChaseVia | null = outcome === 'copied' ? 'clipboard' : null;
  if (!couldOpenSheet) {
    deps.showAlert(
      outcome === 'copied' ? 'Follow-Up Copied' : 'Could Not Copy',
      outcome === 'copied'
        ? (to ? 'Your mail app did not open, so the follow-up is on your clipboard. Paste it into an email or text.'
          : 'No address is on file for them, so the follow-up is on your clipboard. Paste it into your email or text to send it.')
        : 'Select the follow-up text and copy it manually.',
    );
    return via;
  }
  deps.showAlert(
    outcome === 'copied' ? 'Follow-Up Copied Instead' : 'Could Not Open Share',
    outcome === 'copied' ? 'Sharing was unavailable, so the follow-up is on your clipboard.'
      : 'Copy the follow-up from the item instead.',
  );
  return via;
}
