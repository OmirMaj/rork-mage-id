// commitAdapters.ts: a data-layer answer as exactly one CommitResult (moments Step 0, lane MOMSTEP0).
//
// Pure, no runtime imports beyond utils/moments/copy (itself import-free), so
// bun runs these for real in scripts/moments-checks/adapters.ts.
//
// PLAN RULE 1 (binding): success only on a real server confirmation.
//   - 'synced' is the only answer that becomes `confirmed`.
//   - 'local' (ProjectContext RecordWriteOutcome: this device only, because no
//     account is signed in to send it as; the row is in AsyncStorage and
//     nowhere else) is NEVER confirmed. It is the queued look with its own
//     words: "Saved on this phone only" / "Sign in to send it to your account."
//   - 'queued' is the honest "not yet": the capsule's default label
//     "Saved on this phone · sends when online".
//   - 'failed' / 'refused' is refused with the site's own sentence.
//   - 'unknown' (the request may have left) is a timeout: never "nothing was
//     saved", the site's own "No answer yet. Check CO #4 before trying again."
//
// Every sentence comes from the CALLER as a whole sentence (the moment-copy
// rule): no verb or subject is ever passed in and framed here, so the W3
// Spanish lanes translate each sentence as one key (docs/I18N.md §3.5).
//
// A legal site never reaches fromWriteOutcome (legal writes are online-only
// and use fromOnlineOutcome). If one did, runCommit's legal + queued ->
// refused rule still applies to the 'queued' and 'local' answers.

import type { CommitResult } from '@/utils/moments/commitResult';
import { LOCAL_ONLY_NEXT, LOCAL_ONLY_TITLE } from '@/utils/moments/copy';

/** A queue-backed write's answer (supabaseWriteDetailed + ProjectContext's 'local'). */
export type WriteOutcomeLike = 'synced' | 'queued' | 'failed' | 'local';

/** An online-only write's answer (utils/offlineQueue supabaseWriteOnline / supabaseRpcOnline). */
export type OnlineOutcome = 'synced' | 'refused' | 'unknown';

/**
 * Why an online-only write was refused, when the data layer knows (the
 * `code` on OnlineWriteResult). 'earlier_change_pending': a queued write of
 * the same record is still waiting on this phone and would have been
 * overtaken; nothing was sent. 'earlier_change_unsaved': the same, but the
 * earlier write is under Not saved. 'offline': the device was offline at the
 * call; nothing was sent. 'sealed': a signed record's content cannot change
 * (ProjectContext.signFieldTicket); nothing was sent.
 */
export type OnlineRefusalCode =
  | 'offline'
  | 'earlier_change_pending'
  | 'earlier_change_unsaved'
  | 'no_account'
  | 'not_configured'
  | 'session_changed'
  | 'no_row'
  | 'server'
  | 'invalid'
  | 'sealed';

/** An online answer with its reason code (what supabaseWriteOnlineDetailed returns). */
export interface OnlineOutcomeWithCode {
  status: OnlineOutcome;
  code?: OnlineRefusalCode;
}

/** The confirmed words: the stored record, first. */
export interface ConfirmedCopy {
  title: string;
  detail?: string;
  next?: string;
  announce?: string;
}

/** Whole sentences for a queue-backed write's other answers. */
export interface WriteOutcomeWords {
  /** 'failed': "Not approved. Something went wrong on our side." */
  refused: string;
  /** 'queued': the site's own "not yet" line; default MOMENT_COPY.queued via the capsule. */
  queued?: string;
  /** 'queued': a what-happens-next line, only when it is true. */
  queuedNext?: string;
}

/** Whole sentences for an online-only write's other answers. */
export interface OnlineOutcomeWords {
  /** 'refused': "Not signed. Something went wrong on our side. The signature is kept." */
  refused: string;
  /** 'unknown': "No answer yet. Check FT-12 before trying again." */
  timeout: string;
  /** code 'earlier_change_pending': default EARLIER_CHANGE_PENDING_REASON is the site's to pick; omitted = `refused`. */
  earlierPending?: string;
  /** code 'earlier_change_unsaved'; omitted = `refused`. */
  earlierUnsaved?: string;
  /** code 'offline'; omitted = `refused`. */
  offline?: string;
  /** code 'sealed' (a signed record's content cannot change); omitted = `refused`. */
  sealed?: string;
}

function confirmed(ok: ConfirmedCopy): CommitResult {
  return {
    status: 'confirmed',
    title: ok.title,
    ...(ok.detail ? { detail: ok.detail } : {}),
    ...(ok.next ? { next: ok.next } : {}),
    ...(ok.announce ? { announce: ok.announce } : {}),
  };
}

/**
 * A queue-backed write (supabaseWriteDetailed, ProjectContext.approveChangeOrder,
 * closeProjectDetailed, useTimeEntries.clockOutDetailed, WipContext.lockPeriodDetailed)
 * as one CommitResult. Only 'synced' confirms. Anything unrecognised is refused.
 */
export function fromWriteOutcome(o: WriteOutcomeLike, ok: ConfirmedCopy, words: WriteOutcomeWords): CommitResult {
  switch (o) {
    case 'synced':
      return confirmed(ok);
    case 'queued':
      return {
        status: 'queued',
        ...(words.queued ? { title: words.queued } : {}),
        ...(words.queuedNext ? { next: words.queuedNext } : {}),
      };
    case 'local':
      // On this device only: never a green tick, never "sends when online"
      // (it will not, until someone signs in).
      return { status: 'queued', title: LOCAL_ONLY_TITLE, next: LOCAL_ONLY_NEXT };
    case 'failed':
    default:
      return { status: 'refused', reason: words.refused };
  }
}

/**
 * An online-only write (supabaseWriteOnline, supabaseRpcOnline, signFieldTicket,
 * saveAIAPayAppOnline, setContractStatusDetailed, saveCloseoutBinderDetailed)
 * as one CommitResult. Takes the bare status or the detailed answer with its
 * code. Only 'synced' confirms; 'unknown' is a timeout (it may have landed).
 */
export function fromOnlineOutcome(
  o: OnlineOutcome | OnlineOutcomeWithCode,
  ok: ConfirmedCopy,
  words: OnlineOutcomeWords,
): CommitResult {
  const status = typeof o === 'string' ? o : o?.status;
  const code = typeof o === 'string' ? undefined : o?.code;
  switch (status) {
    case 'synced':
      return confirmed(ok);
    case 'unknown':
      return { status: 'timeout', message: words.timeout };
    case 'refused':
    default: {
      const reason =
        (code === 'earlier_change_pending' && words.earlierPending)
        || (code === 'earlier_change_unsaved' && words.earlierUnsaved)
        || (code === 'offline' && words.offline)
        || (code === 'sealed' && words.sealed)
        || words.refused;
      return { status: 'refused', reason };
    }
  }
}
