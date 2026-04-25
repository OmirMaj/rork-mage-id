// planPrefetch
//
// Pre-warm the device cache with a project's plan sheet PNGs the moment a
// project is opened. The intent: when a super walks onto the site (where
// signal usually drops), the plans they're going to need are already on
// disk and pinch-zoom is instant rather than a 3 MB download per sheet.
//
// We use `Image.prefetch` from `expo-image` (available since SDK 50). It
// drops the bytes into the same cache the <Image> component reads from,
// so subsequent renders are zero-network. We deliberately do NOT block the
// project-detail render on this; it's fire-and-forget.
//
// Cap: prefetch up to MAX_PREFETCH sheets. For a 200-sheet hospital set we
// don't want to silently chew 400 MB of cellular data on tap. The sheets
// most likely to be opened first are the ones at the top of the list, so
// we prefetch in array order.
//
// Note: we tolerate a stub Image.prefetch (some test envs lack it). On
// failure we no-op rather than surfacing an error \u2014 prefetch is an
// optimization, not a contract.

import { Image } from 'expo-image';
import type { PlanSheet } from '@/types';

const MAX_PREFETCH = 12;

/**
 * Fire-and-forget prefetch of plan sheet images to the on-disk cache.
 * Returns immediately; the caller does not need to await it.
 */
export function prefetchProjectPlans(sheets: PlanSheet[] | null | undefined): void {
  if (!sheets || sheets.length === 0) return;
  const targets = sheets
    .filter((s) => !!s.imageUri && /^https?:/i.test(s.imageUri))
    .slice(0, MAX_PREFETCH);

  if (targets.length === 0) return;

  // expo-image accepts an array OR a single URL; we use the array form so
  // it can dedupe + parallelize internally.
  const uris = targets.map((s) => s.imageUri);
  // Image.prefetch returns a promise but we ignore the result \u2014 it's an
  // optimization. Logging the count is useful for telemetry on cache hit
  // rates if we ever want to instrument.
  Image.prefetch(uris).then(
    () => {
      console.log('[planPrefetch] prefetched', uris.length, 'sheets');
    },
    (err: unknown) => {
      console.log('[planPrefetch] prefetch failed:', (err as Error)?.message);
    },
  );
}
