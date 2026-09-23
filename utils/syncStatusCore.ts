// utils/syncStatusCore.ts — one honest answer to "is my work saved?"
//
// Pure module: no react-native, no AsyncStorage, no supabase. It turns raw
// queue depths into the status a UI may show, and into the exact words it may
// use. hooks/useSyncStatus.ts does the reading; scripts/validate-sync-status.ts
// drives every function here directly.
//
// ── Why this file exists ────────────────────────────────────────────────────
// MAGE keeps THREE durable offline queues, and the pill counted ONE of them:
//
//   mageid_offline_queue          text mutations   utils/offlineQueue.ts
//   mageid_photo_upload_queue     photo bytes      utils/photoUploadQueue.ts
//   mageid_audio_transcribe_queue untranscribed    utils/audioTranscribeQueue.ts
//                                 dictation
//
// So a super with 3 queued reports, 40 unsent jobsite photos and a 90-second
// dictation was shown "3 changes queued". The number was true about one queue
// and false about the device.
//
// ── The distinction the old pill could not make ─────────────────────────────
// A queue entry that exhausts its retry budget, or hits a terminal error, is
// REMOVED from the queue. Before this file the only trace was a toast fired at
// the moment of the drop — which, if the app was backgrounded or the toast host
// unmounted, nobody ever saw — and a Sentry breadcrumb the user cannot read.
// The depth then went DOWN, so the pill got quieter as work was lost.
//
// `pending` and `failed` are therefore separate fields that are never summed.
// Pending means "still going to be sent". Failed means "will not be sent, and
// you need to re-enter it". Adding them would produce a number that means
// neither.
//
// ── unknown ≠ zero ──────────────────────────────────────────────────────────
// Every queue reader in this repo swallows a storage failure and returns `[]`,
// which is right for the flush path and wrong for a status indicator: it turns
// "we could not look" into "all clear". `readFailed` carries that third state
// through, and the copy says "couldn't check" rather than showing a green nothing.
//
// But "we could not look" must never DEMOTE something we already know. A
// recorded failure outranks `readFailed`, because the ledger is a separate read
// from the queues: one corrupt queue used to turn a red "2 didn't sync" into a
// neutral "Sync unknown" that told the user nothing had been deleted. See the
// precedence comment in computeSyncStatus.

/** Raw depths, as read from the device. */
export interface SyncQueueDepths {
  writes: number;
  photos: number;
  dictations: number;
}

/** A write that will NOT be retried. See utils/syncLedger.ts for the record. */
export interface SyncFailureSummary {
  count: number;
  /** Human labels for the distinct things that failed, newest first, deduped. */
  labels: string[];
  /** How many of `count` the ledger can resend as they were (#1, wave 4).
   *  Absent = 0: a note recorded before payloads were kept, a photo or a
   *  dictation can only be dismissed. */
  retryable?: number;
}

/** One row of the "not saved" sheet: one record, whatever number of its
 *  writes failed. */
export interface UnsavedLine {
  /** A ledger id of the record — what Retry / Discard are called with. */
  id: string;
  label: string;
  /** "Not saved to MAGE — <reason>". */
  line: string;
  canRetry: boolean;
  /** How many of the record's writes this line stands for. */
  writes: number;
  /** What Discard throws away — decides the confirm's words (a dropped edit
   *  is not a lost record, and a dropped delete brings the record back). */
  discards: UnsavedDiscardKind;
}

/**
 * What discarding a record's unsaved writes means for it:
 *   create  — some write was its INSERT: it never reached MAGE, and goes.
 *   edit    — MAGE has the record; only this change is dropped.
 *   delete  — the delete is dropped; the record stays on MAGE and comes back.
 *   unknown — an upsert (create or edit, the ledger cannot tell) or a note
 *             recorded without its operation.
 */
export type UnsavedDiscardKind = 'create' | 'edit' | 'delete' | 'unknown';

/** Pure: the kind for one record's failed writes. An INSERT anywhere wins —
 *  if the record itself never landed, every later edit of it goes with it. */
export function discardKindFor(operations: readonly (string | undefined)[]): UnsavedDiscardKind {
  if (operations.includes('insert')) return 'create';
  if (operations.includes('delete')) return 'delete';
  if (operations.length > 0 && operations.every((o) => o === 'update' || o === 'rpc')) return 'edit';
  return 'unknown';
}

/** The body of the Discard confirm, per kind. Every sentence must be true. */
export function discardConfirmBody(kind: UnsavedDiscardKind): string {
  switch (kind) {
    case 'create':
      return 'It was never saved to MAGE. Discarding removes it from this phone and it cannot be recovered.';
    case 'edit':
      return 'Your change was not saved to MAGE. Discarding drops the change — MAGE keeps the last saved version, and this phone goes back to it.';
    case 'delete':
      return 'The delete was not saved to MAGE. Discarding cancels it — the record stays on MAGE and will reappear on this phone.';
    default:
      return 'This change was not saved to MAGE. Discarding drops it for good — if the record was never saved, it is removed from this phone; if it was, MAGE keeps the last saved version.';
  }
}

/** The minimum a ledger entry must say for a line to be drawn from it. */
export interface UnsavedSource {
  id: string;
  label: string;
  reason: string;
  at: number;
  canRetry: boolean;
  /** The write's operation ('insert' | 'update' | …); absent for a note. */
  operation?: string;
  /** table + record id; entries of one record share it. Absent = its own. */
  recordKey?: string;
}

export const NOT_SAVED_LEAD = 'Not saved to MAGE — ';

/**
 * One line per record, newest first. A record is retryable only if EVERY
 * write of it can be resent — a line offering Retry that silently skips the
 * refused INSERT would resend the edit onto nothing.
 */
export function unsavedLines(sources: readonly UnsavedSource[]): UnsavedLine[] {
  const byRecord = new Map<string, UnsavedSource[]>();
  for (const f of sources) {
    const key = f.recordKey ?? `id:${f.id}`;
    const list = byRecord.get(key) ?? [];
    list.push(f);
    byRecord.set(key, list);
  }
  const lines: (UnsavedLine & { at: number })[] = [];
  for (const list of byRecord.values()) {
    const newest = [...list].sort((a, b) => b.at - a.at)[0];
    lines.push({
      id: newest.id,
      label: newest.label,
      line: `${NOT_SAVED_LEAD}${newest.reason}`,
      canRetry: list.every((f) => f.canRetry),
      writes: list.length,
      discards: discardKindFor(list.map((f) => f.operation)),
      at: newest.at,
    });
  }
  return lines.sort((a, b) => b.at - a.at).map(({ at: _at, ...line }) => line);
}

export interface SyncStatusInput {
  depths: SyncQueueDepths;
  failures: SyncFailureSummary;
  /** True when storage refused a read, so the numbers above mean nothing. */
  readFailed: boolean;
  /** False when there is no session — nothing on the device is anyone's yet. */
  signedIn: boolean;
}

export type SyncTone = 'clear' | 'pending' | 'failed' | 'unknown';

export interface SyncStatus {
  tone: SyncTone;
  /** Items still queued, across all three queues. Never includes failures. */
  pending: number;
  /** Items that gave up. Never included in `pending`. */
  failed: number;
  depths: SyncQueueDepths;
  /** True when the pill must render. */
  visible: boolean;
  /** One short line for the badge. */
  badge: string;
  /** The dialog title when the badge is tapped. */
  title: string;
  /** The dialog body. Every sentence must be true of the device right now. */
  detail: string;
}

/** Depth totals. Exported so a caller can count without building a status. */
export function totalPending(d: SyncQueueDepths): number {
  return Math.max(0, d.writes) + Math.max(0, d.photos) + Math.max(0, d.dictations);
}

/** "3 changes, 12 photos and 1 recording" — only the non-empty parts, in a
 *  fixed order so the string does not shuffle between polls. */
export function describeDepths(d: SyncQueueDepths): string {
  const parts: string[] = [];
  if (d.writes > 0) parts.push(`${d.writes} change${d.writes === 1 ? '' : 's'}`);
  if (d.photos > 0) parts.push(`${d.photos} photo${d.photos === 1 ? '' : 's'}`);
  if (d.dictations > 0) parts.push(`${d.dictations} recording${d.dictations === 1 ? '' : 's'}`);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The whole status, including the words.
 *
 * `platform` only decides between "on your phone" and "on this device" — no
 * behaviour depends on it.
 */
export function computeSyncStatus(
  input: SyncStatusInput,
  platform: 'native' | 'web' = 'native',
): SyncStatus {
  const depths: SyncQueueDepths = {
    writes: Math.max(0, input.depths.writes),
    photos: Math.max(0, input.depths.photos),
    dictations: Math.max(0, input.depths.dictations),
  };
  const pending = totalPending(depths);
  const failed = Math.max(0, input.failures.count);
  const where = platform === 'web' ? 'on this device' : 'on your phone';

  if (!input.signedIn) {
    // No session: getOwn*Queue() correctly returns nothing, and "0 queued" would
    // be a claim about a device we are not allowed to read for anybody.
    return {
      tone: 'clear', pending: 0, failed: 0, depths,
      visible: false, badge: '', title: '', detail: '',
    };
  }

  // Failures dominate the badge — INCLUDING over `readFailed`. A queue that is
  // draining normally is a reassurance; work that is gone is an action item,
  // and it must not be hidden behind a larger pending count OR behind a read
  // error.
  //
  // This ordering was the other way round once, and it was a lie a contractor
  // could hit. The ledger and the queues are separate reads — the ledger parse
  // never throws, while each queue parse raises `readFailed` on its own — so
  // one corrupt queue turned a RED "2 didn't sync" into a neutral "Sync
  // unknown" whose body said "Nothing has been deleted". Two writes were on
  // record as permanently dropped and the user was affirmatively reassured. A
  // known failure is the most certain thing we hold; it outranks not knowing.
  if (failed > 0) {
    const what = input.failures.labels.length > 0
      ? `\n\nWhat failed:\n• ${input.failures.labels.slice(0, 6).join('\n• ')}`
      : '';
    // When a queue would not parse we do not know the pending depth, so we do
    // not quote one. Saying so is the honest half of the same message.
    const alsoPending = input.readFailed
      ? `\n\nMAGE also couldn’t read this device’s queue, so we can’t tell you what else is still waiting.`
      : pending > 0
        ? `\n\n${describeDepths(depths)} ${pending === 1 ? 'is' : 'are'} still queued and will sync when you have signal.`
        : '';
    // #1 (wave 4): the ledger now keeps what it takes to resend most
    // failures, and the sheet behind this badge offers Retry for those. The
    // copy says exactly that — and still says they will NOT be sent on their
    // own, because nothing is ever resent without his tap.
    const retryable = Math.min(failed, Math.max(0, input.failures.retryable ?? 0));
    const one = failed === 1;
    const action = retryable === failed
      ? `Tap Retry to send ${one ? 'it' : 'them'} again, or Discard to remove ${one ? 'it' : 'them'} from ${where} for good.`
      : retryable === 0
        ? `You need to re-enter ${one ? 'it' : 'them'}.`
        : `Tap Retry to send the ones that can be sent again; the rest you need to re-enter.`;
    return {
      tone: 'failed', pending: input.readFailed ? 0 : pending, failed, depths,
      visible: true,
      badge: `${failed} didn’t sync`,
      title: `${failed} item${one ? '' : 's'} not saved to MAGE`,
      detail:
        `${one ? 'It is' : 'They are'} not on the server and will not be sent unless you retry — MAGE has stopped trying. `
        + `${action}${what}${alsoPending}`,
    };
  }

  if (input.readFailed) {
    // Nothing is on record as dropped — the ledger read fine and was empty —
    // so the only thing we cannot vouch for is what is still WAITING, and the
    // count we could not read is not reported as one.
    return {
      tone: 'unknown', pending: 0, failed: 0, depths,
      visible: true,
      badge: 'Sync unknown',
      title: 'Couldn’t check your sync queue',
      detail: `This device wouldn’t let MAGE read its saved-work queue, so we can’t tell you what is still waiting. Nothing has been deleted — reopen the app to try again.`,
    };
  }

  if (pending > 0) {
    return {
      tone: 'pending', pending, failed: 0, depths,
      visible: true,
      badge: `${pending} waiting to sync`,
      title: `${describeDepths(depths)} waiting to sync`,
      detail:
        `Saved ${where} and not yet on the server. MAGE sends ${pending === 1 ? 'it' : 'them'} automatically `
        + `the next time you have signal or wifi — you can close the app, it keeps ${pending === 1 ? 'it' : 'them'}. `
        + `If something can’t be sent after several tries, this badge turns red and tells you exactly what.`,
    };
  }

  return {
    tone: 'clear', pending: 0, failed: 0, depths,
    visible: false, badge: '', title: '', detail: '',
  };
}
