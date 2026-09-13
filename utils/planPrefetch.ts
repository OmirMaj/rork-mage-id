// planPrefetch — pull the day's plan sheets onto the device before the signal
// goes away, and write down honestly what actually landed.
//
// Two entry points, deliberately different:
//
//   prefetchProjectPlans(sheets)   fire-and-forget, one project, called from
//                                  app/project-detail.tsx when a project opens.
//                                  Unchanged signature and unchanged behaviour
//                                  for that caller.
//
//   warmFieldDayPack(candidates)   the field day pack: ONE budget shared across
//                                  every jobsite scheduled today and tomorrow,
//                                  awaited, and recorded. Mounted from
//                                  contexts/ProjectContext via
//                                  hooks/useFieldDayPack.
//
// Selection, budget, fairness and the copy all live in the pure
// utils/fieldDayPackCore.ts; this file does the fetching and the storage.
//
// ── What "warmed" means, exactly ────────────────────────────────────────────
// `Image.prefetch` from expo-image drops bytes into the same disk cache the
// <Image> component reads from, keyed BY URL. Two consequences we do not paper
// over:
//
//   • It is a session-and-a-day guarantee, not a permanent one. A Storage-
//     backed sheet's `imageUri` is a 24 h signed url (planSheetUrls
//     .PLAN_SHEET_URL_TTL_SECONDS). When ProjectContext re-mints it, the token
//     changes, the cache key changes, and these bytes are orphaned. That is why
//     fieldDayPackCore reports `expired` past 24 h and the UI stops claiming
//     coverage. The scenario this DOES cover is the real one: warm in the truck
//     with signal, drive into a basement, open the sheets.
//
//   • We count what the prefetch CONFIRMS. `Image.prefetch` resolves to a
//     boolean, and the batch form returns ONE boolean for the whole array — so
//     a single failure inside a batch of eight is indistinguishable from eight
//     successes. The pack therefore fetches per-url with a small concurrency
//     limit and counts the `true`s. A count we did not measure is a count we
//     are not allowed to show.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import type { PlanSheet } from '@/types';
import {
  MAX_DAY_PACK_PROJECTS,
  MAX_DAY_PACK_SHEETS,
  MAX_SHEETS_PER_PROJECT,
  allocateSheetBudget,
  buildDayPackRecord,
  evictDayPackRecord,
  parseDayPackRecord,
  type DayPackCandidate,
  type DayPackRecord,
} from '@/utils/fieldDayPackCore';

const MAX_PREFETCH = 12;

/** `mageid_` prefixed, so AuthContext's tenant sweep drops it on a switch —
 *  one contractor must not be told he is "ready offline" for another's jobs. */
export const DAY_PACK_KEY = 'mageid_field_daypack';

/**
 * Fire-and-forget prefetch of one project's plan sheets to the on-disk cache.
 * Returns immediately; the caller does not need to await it.
 *
 * Kept exactly as it was for app/project-detail.tsx — this is the "you opened
 * this job, its sheets should be instant" path, which is a different job from
 * the day pack and should not start awaiting or writing records.
 */
export function prefetchProjectPlans(sheets: PlanSheet[] | null | undefined): void {
  if (!sheets || sheets.length === 0) return;
  const targets = sheets
    .filter((s) => !!s.imageUri && /^https?:/i.test(s.imageUri))
    .slice(0, MAX_PREFETCH);

  if (targets.length === 0) return;

  const uris = targets.map((s) => s.imageUri);
  Image.prefetch(uris).then(
    () => {
      console.log('[planPrefetch] prefetched', uris.length, 'sheets');
    },
    (err: unknown) => {
      console.log('[planPrefetch] prefetch failed:', (err as Error)?.message);
    },
  );
}

/** One url, one measured answer. `Image.prefetch` is typed `Promise<boolean>`;
 *  buildDayPackRecord counts only an explicit `true` and treats a rejection as
 *  a `false`, so this stays a thin pass-through and the counting rule lives in
 *  one testable place. */
function warmOne(uri: string): Promise<boolean> {
  return Image.prefetch(uri);
}

export async function readDayPackRecord(): Promise<DayPackRecord | null> {
  try {
    return parseDayPackRecord(await AsyncStorage.getItem(DAY_PACK_KEY));
  } catch {
    return null;
  }
}

export async function clearDayPackRecord(): Promise<void> {
  try { await AsyncStorage.removeItem(DAY_PACK_KEY); } catch {/* best effort */}
}

/**
 * Retract coverage for jobs no longer in the day's horizon.
 *
 * Frees no bytes — expo-image owns the disk cache and offers only an
 * all-or-nothing clear. What this bounds is the CLAIM: the record must not tell
 * the user he is covered for a job that rolled off yesterday. See the eviction
 * note in fieldDayPackCore's header.
 */
export async function pruneDayPackRecord(inScopeProjectIds: readonly string[]): Promise<DayPackRecord | null> {
  const current = await readDayPackRecord();
  const pruned = evictDayPackRecord(current, inScopeProjectIds);
  if (pruned === current) return current;
  try {
    if (!pruned || pruned.projects.length === 0) await AsyncStorage.removeItem(DAY_PACK_KEY);
    else await AsyncStorage.setItem(DAY_PACK_KEY, JSON.stringify(pruned));
  } catch {/* best effort — the in-memory answer is still the pruned one */}
  return pruned;
}

export interface WarmDayPackOptions {
  maxProjects?: number;
  maxPerProject?: number;
  maxTotal?: number;
  now?: number;
}

/**
 * Warm the day pack and persist what actually landed.
 *
 * Returns the record it wrote, or null when there was nothing eligible to warm
 * (no session, no jobs today, or every sheet is already a device-local file).
 * Never throws: a failed warm leaves the previous record alone rather than
 * replacing a true claim with a worse one.
 */
export async function warmFieldDayPack(
  userId: string,
  candidates: readonly DayPackCandidate[],
  opts: WarmDayPackOptions = {},
): Promise<DayPackRecord | null> {
  if (!userId) return null;
  const plan = allocateSheetBudget(candidates, {
    maxProjects: opts.maxProjects ?? MAX_DAY_PACK_PROJECTS,
    maxPerProject: opts.maxPerProject ?? MAX_SHEETS_PER_PROJECT,
    maxTotal: opts.maxTotal ?? MAX_DAY_PACK_SHEETS,
  });

  // The whole "how many actually landed" loop lives in the pure core so a
  // validator can drive it with a fetcher that fails a known number of urls.
  // Everything this file adds is the real fetcher and the storage.
  const record = await buildDayPackRecord(userId, plan, warmOne, { now: opts.now });
  if (!record) {
    // Nothing reached the device (or nothing was eligible). Writing a record
    // now would stamp a fresh `warmedAt` on a pack of zero and reset the retry
    // spacing for three hours.
    if (plan.allocations.length > 0) {
      console.log('[planPrefetch] day pack warmed nothing (offline?) — leaving the previous record alone');
    }
    return null;
  }

  const warmedTotal = record.sheetsWarmed;
  const projects = record.projects;
  try {
    await AsyncStorage.setItem(DAY_PACK_KEY, JSON.stringify(record));
  } catch (err) {
    console.warn('[planPrefetch] could not record the day pack:', (err as Error)?.message);
  }
  console.log('[planPrefetch] day pack:', warmedTotal, 'sheets across', projects.length, 'job(s)');
  return record;
}
