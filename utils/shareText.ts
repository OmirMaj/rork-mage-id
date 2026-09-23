// shareText.ts — one share that works on every platform the app ships to.
//
// WHY. react-native-web's Share.share REJECTS outright when navigator.share is
// absent, which is desktop Firefox and Chromium on Linux, and it is unavailable
// on desktop Chrome for macOS/Linux too. Seventeen call sites across sixteen
// files called it raw inside `try { ... } catch { /* user cancelled */ }`, so on
// those browsers every share button threw instantly and the catch silently
// swallowed it as if the user had chosen to cancel.
//
// The result was a button that did nothing, reported nothing, and — because the
// catch was labelled "user cancelled" — looked deliberate in code review.
//
// Two failures were being conflated and both are handled here:
//   • NOT SUPPORTED — navigator.share does not exist. Copy to the clipboard
//     instead; the user still gets the text and can paste it anywhere.
//   • CANCELLED — the user dismissed a sheet that DID open. Web Share rejects
//     with AbortError. That is not a failure and must not show an error, but it
//     also must not be reported as success (several callers flip a "sent" flag
//     on the success path).
//
// Callers get a discriminated result instead of an exception, so "it worked",
// "they changed their mind" and "this browser can't" stop being the same event.

import { Platform, Share } from 'react-native';
import { copyToClipboard } from '@/utils/clipboard';

export type ShareOutcome =
  /** The share sheet closed without the user dismissing it. On iOS that means
   *  he picked a target (Share.share resolved with sharedAction); on web the
   *  Web Share promise resolved. On ANDROID it only means the chooser opened:
   *  Android's Share.share always resolves with sharedAction, even when he
   *  backs out of the chooser, so a cancel there cannot be detected and still
   *  reads as 'shared'. That is platform behaviour, not something to paper
   *  over with a guess. */
  | 'shared'
  /** The user dismissed the sheet. Not an error — do not toast. */
  | 'cancelled'
  /** No share sheet available; the text is on the clipboard instead. */
  | 'copied'
  /** Nothing worked — the caller should surface a real error. */
  | 'failed';

/** True when a share sheet can actually open here. */
export function canShare(): boolean {
  if (Platform.OS !== 'web') return true;
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Share some text, falling back to the clipboard where sharing is impossible.
 *
 * `url` is appended to the message on web rather than passed through: the Web
 * Share API treats `url` as a separate field that several browsers drop when a
 * `text` is also supplied, which quietly loses the pay link / portal link that
 * was the entire reason for sharing.
 */
export async function shareText(opts: {
  message: string;
  title?: string;
  url?: string;
}): Promise<ShareOutcome> {
  const { message, title, url } = opts;

  if (!canShare()) {
    const body = url ? `${message}\n\n${url}` : message;
    return (await copyToClipboard(body)) ? 'copied' : 'failed';
  }

  try {
    const r = await Share.share(
      Platform.OS === 'web' && url
        ? { message: `${message}\n\n${url}`, title }
        : { message, title, url },
    );
    // iOS does NOT reject when he taps X on the share sheet — it RESOLVES with
    // { action: dismissedAction } (audit 2026-09-23 #54). Returning 'shared'
    // for that marked a Quick Quote / Smart Proposal "sent" and logged a
    // Waiting On chase that never left the phone. Tested on the result, not
    // the platform: web rejects on cancel (the catch below) and resolves
    // sharedAction otherwise, and Android always resolves sharedAction.
    if (r?.action === Share.dismissedAction) return 'cancelled';
    return 'shared';
  } catch (e) {
    // AbortError is the user closing the sheet. Treat it as the cancel it is —
    // not as a failure, and not as a success either.
    if (e instanceof Error && (e.name === 'AbortError' || /abort|cancel/i.test(e.message))) {
      return 'cancelled';
    }
    const body = url ? `${message}\n\n${url}` : message;
    return (await copyToClipboard(body)) ? 'copied' : 'failed';
  }
}
