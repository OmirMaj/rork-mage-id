// commitResult.ts: one honest answer for every commit (moments wave, lane CAPSULE).
//
// Pure TS (its one import, utils/networkErrors, has no imports of its own), so
// bun runs the real function in scripts/moments-checks/capsule.ts.
//
// THE RULES THIS FILE EXISTS FOR (both judges' must-fix lists):
//   - Success is shown only on a real `confirmed`. resolvePlan is the ONLY
//     place that decides what the capsule plays, and nothing but `confirmed`
//     maps to 'success'.
//   - A legal record (signature, certify, seal) is never queued: a 'queued'
//     answer for one becomes refused, "Nothing was signed".
//   - An unknown outcome (no answer in 20 s, or the connection dropped) only
//     says "Nothing was saved" when the write is safe to repeat. Anything else
//     says it may still have gone through: "No answer yet. Check CO #4 before
//     trying again." A GC who reads "nothing was saved" pays twice.
//   - It never throws.

import { isTransportError } from '@/utils/networkErrors';

export type CommitStatus = 'confirmed' | 'queued' | 'refused' | 'timeout';

export type CommitResult =
  | { status: 'confirmed'; title: string; detail?: string; next?: string; announce?: string }
  | { status: 'queued'; title?: string; next?: string; announce?: string }
  | { status: 'refused'; reason: string; next?: string; announce?: string }
  | { status: 'timeout'; message: string; announce?: string };

/**
 * Step 0 (lane MOMSTEP0): the outcome lines as WHOLE SENTENCES from the site's
 * copy file (utils/moments/sites/*). Each one, when present, is used exactly
 * as given; when absent the English frames below are the fallback
 * (genericRefusedCopy(verb), timeoutCopy(subject), legalQueuedCopy(verb),
 * transportCopy(verb, true), offlineLegalReason()). A sentence is never
 * assembled from a translated verb or noun: Spanish past participles agree in
 * gender ("No aprobado" / "No aprobada"), so every site passes its own
 * sentences (docs/I18N.md §3.5; scripts/moments-checks/rules.ts enforces it).
 */
export interface CommitOutcomeCopy {
  /** The generic refused line: a write that answered with no reason of its own, or threw a non-transport error. */
  refused?: string;
  /** The timeout line (no answer in time, or a transport drop on a write that cannot be repeated). */
  timeout?: string;
  /** Legal record answered 'queued' (it can never be): "Not certified. Certifying needs a connection, so nothing was certified." */
  legalQueued?: string;
  /** An idempotent write's transport drop: "Not recorded. The connection dropped, so nothing was saved." */
  transport?: string;
  /** The disabled reason for a legal control while offline (default offlineLegalReason()). */
  offline?: string;
}

export interface CommitWriteOptions {
  /** Safe to repeat. Only an idempotent write may ever say "Nothing was saved" on an unknown outcome. */
  idempotent: boolean;
  /** Legal record (signature, certify, seal): never queued. A 'queued' answer becomes refused. */
  legal?: boolean;
  /**
   * The thing to check on a timeout: 'CO #4' -> "No answer yet. Check CO #4 before trying again."
   * English fallback only: a site that passes copy.timeout never needs it.
   */
  subject?: string;
  /**
   * Past participle for refused copy: 'recorded' -> "Not recorded. ..."
   * English fallback only: a site that passes copy.refused (and copy.legalQueued) never needs it.
   */
  verb?: string;
  /** Whole-sentence outcome lines (Step 0). Each overrides its English frame. */
  copy?: CommitOutcomeCopy;
  /** Default 20000. */
  timeoutMs?: number;
  /** Default 500 (busy always reads; no fake delay beyond it). */
  minBusyMs?: number;
}

export const COMMIT_TIMEOUT_MS = 20000;
export const COMMIT_MIN_BUSY_MS = 500;

// ── Wave-next W2 (lane ESTOOLS): the frames in any other language ────────
// The frames below splice an English verb or noun into a sentence, which
// Spanish cannot do (its past participles agree in gender). So in any
// language but English each frame answers ONE verb-free whole sentence from
// a provider the i18n layer binds (utils/moments/sealText.ts
// installMomentLanguage). The provider answers null in English, so every
// English output here is byte-identical. Only a site that breaks the
// moment-copy rule ever reaches a frame (scripts/moments-checks/rules.ts).
// This file stays import-free beyond networkErrors: the moments checks load
// copies of it on their own.

/** The frames' whole-sentence stand-ins, in the app's language. */
export interface MomentFrameWords {
  /** genericRefusedCopy(verb) */
  refused: string;
  /** timeoutCopy(subject) */
  timeout: string;
  /** legalQueuedCopy(verb) */
  legalQueued: string;
  /** transportCopy(verb, true) */
  transport: string;
  /** transportCopy(verb, false) */
  transportUnknown: string;
  /** offlineLegalReason('signing') */
  offlineSigning: string;
  /** offlineLegalReason('certifying') */
  offlineCertifying: string;
  /** A confirmed answer with no title of its own. */
  done: string;
}

let frameWordsProvider: (() => MomentFrameWords | null) | null = null;

/** Bound once by the i18n layer. null (or a provider answering null) = English. */
export function bindMomentFrames(provider: (() => MomentFrameWords | null) | null): void {
  frameWordsProvider = provider;
}

function framesNow(): MomentFrameWords | null {
  try {
    return frameWordsProvider ? frameWordsProvider() : null;
  } catch {
    return null;
  }
}

/** "No answer yet. Check CO #4 before trying again." */
export function timeoutCopy(subject: string = ''): string {
  const w = framesNow();
  if (w) return w.timeout;
  const s = subject.trim();
  return s ? `No answer yet. Check ${s} before trying again.` : 'No answer yet. Check the record before trying again.';
}

/**
 * The connection dropped. Idempotent: "Not recorded. The connection dropped,
 * so nothing was saved." A write that cannot be repeated never says nothing
 * was saved (runCommit never asks for that form; it uses timeoutCopy).
 */
export function transportCopy(verb: string, idempotent: boolean): string {
  const w = framesNow();
  if (w) return idempotent ? w.transport : w.transportUnknown;
  if (idempotent) return `Not ${verb}. The connection dropped, so nothing was saved.`;
  return 'No answer yet. The connection dropped, so it may still go through.';
}

/** "Not signed. Signing needs a connection, so nothing was signed." */
export function legalQueuedCopy(verb: string): string {
  const w = framesNow();
  if (w) return w.legalQueued;
  return `Not ${verb}. Signing needs a connection, so nothing was ${verb}.`;
}

/** "Not recorded. Something went wrong on our side." */
export function genericRefusedCopy(verb: string): string {
  const w = framesNow();
  if (w) return w.refused;
  return `Not ${verb}. Something went wrong on our side.`;
}

/** Which legal act the offline reason names (Step 0). Whole sentences, never a noun passed into a frame. */
export type OfflineLegalKind = 'signing' | 'certifying';

const OFFLINE_LEGAL_REASON: Record<OfflineLegalKind, string> = {
  signing: "You're offline. Signing needs a connection.",
  certifying: "You're offline. Certifying needs a connection.",
};

/** The disabled reason for a legal slide while offline. Default 'signing' (byte-identical to the original). */
export function offlineLegalReason(kind: OfflineLegalKind = 'signing'): string {
  const w = framesNow();
  if (w) return kind === 'certifying' ? w.offlineCertifying : w.offlineSigning;
  return OFFLINE_LEGAL_REASON[kind] ?? OFFLINE_LEGAL_REASON.signing;
}

/** The English fallback verb when a site passed none (it should pass copy.* instead). */
const FALLBACK_VERB = 'saved';

/** A site sentence counts only when it has words in it; a blank one falls back to the frame. */
function given(s: string | undefined): string | undefined {
  return typeof s === 'string' && s.trim() ? s : undefined;
}

/** The refused line a write resolves to: the site's sentence, else the English frame. */
function refusedLine(opts: CommitWriteOptions): string {
  return given(opts.copy?.refused) ?? genericRefusedCopy(opts.verb ?? FALLBACK_VERB);
}

/** The timeout line: the site's sentence, else the English frame. */
function timeoutLine(opts: CommitWriteOptions): string {
  return given(opts.copy?.timeout) ?? timeoutCopy(opts.subject ?? '');
}

/** The legal+queued refusal: the site's sentence, else the English frame. Exported for the capsule's uncommit. */
export function legalQueuedLine(opts: CommitWriteOptions): string {
  return given(opts.copy?.legalQueued) ?? legalQueuedCopy(opts.verb ?? FALLBACK_VERB);
}

/** The disabled reason a legal control shows while offline: the site's sentence, else offlineLegalReason(). */
export function offlineReasonLine(opts: Pick<CommitWriteOptions, 'copy'>): string {
  return given(opts.copy?.offline) ?? offlineLegalReason();
}

type RunOpts = CommitWriteOptions & {
  isTransport?: (err: unknown) => boolean;
  onLateResult?: (r: CommitResult) => void;
  /** Accepted for API stability; the timeout itself runs on setTimeout (jest fake timers drive it). */
  now?: () => number;
};

function unknownOutcome(opts: RunOpts): CommitResult {
  return opts.idempotent
    ? { status: 'refused', reason: given(opts.copy?.transport) ?? transportCopy(opts.verb ?? FALLBACK_VERB, true) }
    : { status: 'timeout', message: timeoutLine(opts) };
}

/** Whatever the write handed back, as exactly one well-formed CommitResult. */
function normalise(r: unknown, opts: RunOpts): CommitResult {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
  const announce = str(o.announce);
  switch (o.status) {
    case 'confirmed': {
      const title = str(o.title);
      if (!title) return { status: 'confirmed', title: framesNow()?.done ?? 'Done', detail: str(o.detail), next: str(o.next), announce };
      return { status: 'confirmed', title, detail: str(o.detail), next: str(o.next), announce };
    }
    case 'queued':
      if (opts.legal) return { status: 'refused', reason: legalQueuedLine(opts) };
      return { status: 'queued', title: str(o.title), next: str(o.next), announce };
    case 'refused':
      return { status: 'refused', reason: str(o.reason) ?? refusedLine(opts), next: str(o.next), announce };
    case 'timeout':
      // As returned: the write itself says it does not know. Never "nothing was saved".
      return { status: 'timeout', message: str(o.message) ?? timeoutLine(opts), announce };
    default:
      return { status: 'refused', reason: refusedLine(opts) };
  }
}

/**
 * Normalises any write into exactly one CommitResult. Never throws.
 *  - resolves {status} as returned, EXCEPT legal && queued -> refused(legalQueuedCopy(verb)).
 *  - no answer within timeoutMs -> idempotent ? refused(transportCopy(verb, true)) : timeout(timeoutCopy(subject)).
 *  - thrown transport error -> the same unknown-outcome rule (it may still go through).
 *  - any other thrown error -> refused(genericRefusedCopy(verb)) (a server that answered "no").
 *  - a late answer after the timeout fired goes to opts.onLateResult only.
 */
export function runCommit(write: () => Promise<CommitResult>, opts: RunOpts): Promise<CommitResult> {
  const timeoutMs = opts.timeoutMs ?? COMMIT_TIMEOUT_MS;
  const isTransport = opts.isTransport ?? isTransportError;
  return new Promise<CommitResult>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (r: CommitResult): boolean => {
      if (settled) return false;
      settled = true;
      if (timer != null) clearTimeout(timer);
      resolve(r);
      return true;
    };
    const late = (r: CommitResult) => {
      try { opts.onLateResult?.(r); } catch { /* a late listener must never throw into the void */ }
    };
    timer = setTimeout(() => { settle(unknownOutcome(opts)); }, timeoutMs);
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(write());
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then(
      (r) => {
        const n = normalise(r, opts);
        if (!settle(n)) late(n);
      },
      (err) => {
        let n: CommitResult;
        try {
          n = isTransport(err) ? unknownOutcome(opts) : { status: 'refused', reason: refusedLine(opts) };
        } catch {
          n = { status: 'refused', reason: refusedLine(opts) };
        }
        if (!settle(n)) late(n);
      },
    );
  });
}

/** The visual plan a result maps to. The ONLY place that decides what the capsule plays. */
export type ResolvePlan = 'success' | 'neutral-done' | 'queued' | 'uncommit' | 'timeout';

/**
 * confirmed + check -> 'success'; confirmed + lock|flag -> 'neutral-done';
 * queued -> legal ? 'uncommit' : 'queued'; refused -> 'uncommit'; timeout -> 'timeout'.
 * Nothing but 'confirmed' ever maps to 'success'.
 */
export function resolvePlan(r: CommitResult, o: { legal?: boolean; resultIcon?: 'check' | 'lock' | 'flag' }): ResolvePlan {
  switch (r.status) {
    case 'confirmed':
      return (o.resultIcon ?? 'check') === 'check' ? 'success' : 'neutral-done';
    case 'queued':
      return o.legal ? 'uncommit' : 'queued';
    case 'timeout':
      return 'timeout';
    case 'refused':
    default:
      return 'uncommit';
  }
}
