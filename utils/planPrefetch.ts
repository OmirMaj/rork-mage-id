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
// ── What "warmed" means, exactly (audit #80) ────────────────────────────────
// The day pack DOWNLOADS each sheet to a file on the phone
// (utils/planSheetLocalFiles), and the plan viewer and the Plans list render
// that file. It used to `Image.prefetch` into expo-image's disk cache instead,
// on the premise that the viewer read the same cache — it does not: both
// screens render react-native's <Image>, which never looks there, and the
// cache was keyed by a signed url that changes on every re-mint and cannot be
// looked up at all after a cold start offline. So "Saved for offline: 8
// sheets" covered nothing he could open in the basement. Now:
//
//   • the file is keyed by the durable storage path, so a re-signed url and an
//     offline cold start (imageUri = bare path) both still find it;
//   • we count what LANDED — a file that exists with bytes in it — per url,
//     with a small concurrency limit. A count we did not measure is a count we
//     are not allowed to show;
//   • prefetchProjectPlans below still warms expo-image's cache for the one
//     project whose detail screen is open. It makes no offline claim.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import type { PlanSheet } from '@/types';
import { downloadSheetToDevice, commitPlanSheetFiles } from '@/utils/planSheetLocalFiles';
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
 *  one contractor must not be told he is "ready offline" for another's jobs.
 *  `_v2` since #80: a record under the old key counted expo-image cache hits
 *  the viewer never read, so it must not be believed after this ships. */
export const DAY_PACK_KEY = 'mageid_field_daypack_v2';
const LEGACY_DAY_PACK_KEY = 'mageid_field_daypack';

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
 * Bounds the CLAIM: the record must not tell the user he is covered for a job
 * that rolled off yesterday. The files themselves are trimmed by the next warm
 * (commitPlanSheetFiles). See the eviction note in fieldDayPackCore's header.
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

  // One url, one measured answer: true only when the file landed with bytes
  // (planSheetLocalFiles). buildDayPackRecord counts only an explicit `true`
  // and treats a rejection as `false`, so the counting rule lives in one
  // testable place.
  const warmOne = (uri: string): Promise<boolean> => downloadSheetToDevice(userId, uri);
  // The whole "how many actually landed" loop lives in the pure core so a
  // validator can drive it with a fetcher that fails a known number of urls.
  // Everything this file adds is the real fetcher and the storage.
  const record = await buildDayPackRecord(userId, plan, warmOne, { now: opts.now });
  // Keep this pack's files (landed now or earlier), delete the rest and any
  // other account's folder, and persist the path → file map the viewer reads.
  await commitPlanSheetFiles(userId, plan.allocations.flatMap(a => a.uris));
  try { await AsyncStorage.removeItem(LEGACY_DAY_PACK_KEY); } catch {/* best effort */}
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
