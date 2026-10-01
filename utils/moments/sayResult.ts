// sayResult.ts: the toast a slide leaves behind once its sheet is gone.
//
// The founder (2026-10-01): "it just slides and no pop up screen comes up to
// confirm it". The capsule's own result pill lives inside the sheet, and the
// sheet closes after the result hold, so the only confirmation he saw went
// away with it. SlideToConfirm now hands every result it delivers to
// sayCommitResult, which says it in the app-wide toast (NailItToast), so the
// answer outlives the sheet.
//
// THE RULES (moments plan, honesty):
//   - The green check is ONLY for status 'confirmed' (a write the server has).
//   - queued: a neutral clock toast with the slide's own words ("Saved on this
//     phone · sends when online"), never green. A legal record never gets
//     here as queued (runCommit turns it into refused).
//   - refused: the error toast with the reason (what did not happen).
//   - timeout: a neutral alert toast with the message ("No answer yet. Check
//     CO #4 before trying again."), never green and never "nothing was saved".
//   - quiet: no toast haptic, for a result the capsule already played (its own
//     success / light / warning buzz).
//
// Every sentence is the result's own (the site's copy, already translated);
// the only fallback is momentCopy().queued, which follows the app language.

import { nailIt, notice, oops } from '@/components/animations/NailItToast';
import type { CommitResult } from '@/utils/moments/commitResult';
import { momentCopy } from '@/utils/moments/copy';

export interface SayResultOptions {
  /** Skip the toast's haptic: the capsule already played this result's own. */
  quiet?: boolean;
}

/** Says a slide's result in the app-wide toast. Never throws. */
export function sayCommitResult(r: CommitResult | null | undefined, opts: SayResultOptions = {}): void {
  if (!r) return;
  const toast = { quiet: !!opts.quiet };
  try {
    switch (r.status) {
      case 'confirmed':
        nailIt(r.title, toast);
        return;
      case 'queued':
        notice(r.title ?? momentCopy().queued, { ...toast, icon: 'clock' });
        return;
      case 'refused':
        oops(r.reason, toast);
        return;
      case 'timeout':
        notice(r.message, { ...toast, icon: 'alert' });
        return;
      default:
        return;
    }
  } catch {
    /* a toast must never break the moment that asked for it */
  }
}
