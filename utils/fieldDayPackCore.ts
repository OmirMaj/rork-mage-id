// utils/fieldDayPackCore.ts — WHAT a person on a jobsite needs cached forward
// for the day, and how honest we are allowed to be about it.
//
// Pure module: no react-native, no AsyncStorage, no expo-image. It only decides
// which projects and which sheets are in scope, and how to describe what is
// actually on the device. utils/planPrefetch.ts does the fetching and the
// persisting; hooks/useFieldDayPack.ts mounts it; scripts/validate-field-daypack.ts
// drives every function here directly.
//
// ── What is ALREADY offline, and therefore NOT this file's job ───────────────
// MAGE persists the text a crew needs through the contexts' write-through
// caches, not through a special offline mode:
//   • projects (with their schedule tasks)  — ProjectContext, `mageid_projects`
//   • punch items, RFIs, daily reports      — ProjectContext, `mageid_punch_items` …
//   • subcontractors and contacts           — ProjectContext, `mageid_subcontractors`,
//                                             `mageid_contacts`
//   • companies, crew                       — CompaniesContext / CrewContext
// Every one of those reads local first and writes the server response back to
// disk. So "the super can read today's tasks, the punch list and the sub's
// phone number with no signal" is already TRUE — it is simply invisible, and
// nothing warms it for a job the user has not opened.
//
// Two things were genuinely missing, and they are what this file exists for:
//
//   1. BINARY assets were warmed for ONE project — the one whose detail screen
//      you happened to open — capped at 12 sheets, with no budget shared across
//      the jobs you are actually visiting today. A super with three sites got
//      the plans for whichever one he tapped last.
//
//   2. Nothing recorded WHAT was warmed or WHEN, so no surface could tell the
//      user whether they were prepared or say how old the copy is. A cached
//      read renders identically to a live one.
//
// ── The budget, and why it is small ─────────────────────────────────────────
// This app has no NetInfo / expo-network dependency, so it CANNOT tell wifi
// from cellular. Every number below is therefore sized to be acceptable on a
// metered connection rather than optimal on wifi: at most
// MAX_DAY_PACK_PROJECTS jobs, at most MAX_SHEETS_PER_PROJECT sheets each, at
// most MAX_DAY_PACK_SHEETS in total. A construction sheet render is commonly
// 1–3 MB, so the ceiling is roughly 16–48 MB per warm, and a warm is allowed at
// most once every WARM_MIN_INTERVAL_MS.
//
// ── Where the bytes live (audit #80) ────────────────────────────────────────
// The pack used to warm expo-image's disk cache while the plan viewer and the
// Plans list render with react-native's <Image>, which never reads that cache
// — so "Saved for offline: 8 sheets" covered nothing the super could open in
// the basement, and after a cold start offline a sheet's imageUri is a bare
// storage path that nothing can fetch. Now the warm DOWNLOADS each sheet into
// a per-user folder in the app's documents directory (utils/planSheetLocalFiles)
// and records storagePath → file in a `mageid_`-prefixed map; the viewer and
// the list render that file when it exists. A sheet counts only when its file
// landed with bytes in it.
//
// ── Eviction, stated honestly ───────────────────────────────────────────────
// Each warm keeps the files for the sheets it allocated and deletes the rest of
// this user's folder, and deletes any OTHER user's folder outright (a tenant
// switch on a shared phone). What is bounded is INTAKE (the budget above), the
// FILES (one pack's worth) and the RECORD (one entry, overwritten each warm).
// `evictDayPackRecord` below prunes the record's project list to what is still
// in scope so the UI never claims coverage for a job that has left the
// horizon.

/** Projects considered for a pack. Today + tomorrow: a super who loses signal
 *  in a basement this afternoon is often still out there tomorrow morning, and
 *  the marginal cost of one extra day is bounded by the same total budget. */
export const DAY_PACK_HORIZON_DAYS = 2;

/** Ceiling on jobs in one pack. Beyond four sites in a day the budget per job
 *  is too thin to be worth the data. */
export const MAX_DAY_PACK_PROJECTS = 4;

/** Ceiling on sheets warmed for any one job, so a 200-sheet hospital set cannot
 *  starve the other jobs in the pack. */
export const MAX_SHEETS_PER_PROJECT = 8;

/** Ceiling on sheets across the whole pack. See "The budget" above. */
export const MAX_DAY_PACK_SHEETS = 16;

/** Minimum spacing between warms. */
export const WARM_MIN_INTERVAL_MS = 3 * 60 * 60 * 1000;

/** Past this age the pack is described as possibly out of date. */
export const DAY_PACK_STALE_AFTER_MS = 8 * 60 * 60 * 1000;

/**
 * Past this age the pack no longer claims coverage.
 *
 * The files themselves outlive it (they are keyed by storage path, not by a
 * 24 h signed url, so a re-mint no longer orphans them), but a day-old copy of
 * a drawing set is one an ASI may have replaced, and a pack that has not been
 * refreshed in a day means the phone has not had signal to check. Past this
 * age the pack reports `expired` and the UI says "reconnect to refresh" rather
 * than "ready" — the conservative side of the claim.
 */
export const DAY_PACK_EXPIRES_AFTER_MS = 24 * 60 * 60 * 1000;

/** One job's share of a pack, as recorded after the warm actually ran. */
export interface DayPackProjectRecord {
  projectId: string;
  projectName: string;
  /** Sheets whose bytes the prefetch confirmed. MEASURED, never assumed. */
  sheetsWarmed: number;
  /** Sheets this job has that were eligible (http(s), in the pack's scope). */
  sheetsEligible: number;
}

/** What is on the device, and when it got there. Persisted as-is. */
export interface DayPackRecord {
  warmedAt: number;
  /** Whose pack this is. Another tenant's coverage is not this user's. */
  userId: string;
  projects: DayPackProjectRecord[];
  /** Total confirmed sheets — the sum of `sheetsWarmed`, kept for cheap reads. */
  sheetsWarmed: number;
  /** True when the budget cut the pack short, so the UI can say "partial". */
  truncated: boolean;
}

export type DayPackFreshness = 'none' | 'fresh' | 'stale' | 'expired';

/** A project as the pack selector sees it. Deliberately structural, so the
 *  validator can drive this without constructing a whole `Project`. */
export interface DayPackCandidate {
  projectId: string;
  projectName: string;
  /** Sheet urls for this project, in the order the user is likeliest to open. */
  sheetUris: string[];
}

/** One job's allocation, before anything is fetched. */
export interface DayPackAllocation {
  projectId: string;
  projectName: string;
  uris: string[];
  /** Eligible sheets this job had, so a truncation is visible in the record. */
  eligible: number;
}

export interface DayPackPlan {
  allocations: DayPackAllocation[];
  /** True when at least one eligible sheet was left out by a cap. */
  truncated: boolean;
}

/** Only a network url benefits from a prefetch. A `file://` capture is already
 *  on the device and a `data:` uri is already in the row; prefetching either
 *  spends budget to move bytes from the device to the device. */
export function isPrefetchableSheetUri(uri: string | null | undefined): boolean {
  return typeof uri === 'string' && /^https?:\/\//i.test(uri);
}

/**
 * Which jobs are in the pack, and in what order.
 *
 * TODAY FIRST, always. A job that is on today's board and tomorrow's appears
 * once, at its today position — a super standing on a site this afternoon needs
 * that site's sheets more than a site he reaches tomorrow morning, and the
 * round-robin below hands the earlier positions their sheet first.
 *
 * Order in equals order out within each band, so the pack is deterministic and
 * a validator can pin it.
 */
export function rankDayPackProjects(
  todayProjectIds: readonly string[],
  tomorrowProjectIds: readonly string[],
  maxProjects: number = MAX_DAY_PACK_PROJECTS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...todayProjectIds, ...tomorrowProjectIds]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, Math.max(0, maxProjects));
}

/**
 * Fair-share allocation of one budget across the day's jobs.
 *
 * Round-robin rather than "first job takes its fill", because the failure this
 * replaces is exactly a first-come cap: the project you opened got 12 sheets
 * and the two sites you are driving to got none. Round-robin also returns
 * unspent share automatically — a job with 2 sheets simply stops taking turns
 * and the rest flows to the jobs that still have sheets.
 *
 * Deterministic: candidate order in, candidate order out.
 */
export function allocateSheetBudget(
  candidates: readonly DayPackCandidate[],
  opts: {
    maxProjects?: number;
    maxPerProject?: number;
    maxTotal?: number;
  } = {},
): DayPackPlan {
  const maxProjects = opts.maxProjects ?? MAX_DAY_PACK_PROJECTS;
  const maxPerProject = opts.maxPerProject ?? MAX_SHEETS_PER_PROJECT;
  const maxTotal = opts.maxTotal ?? MAX_DAY_PACK_SHEETS;

  const inScope = candidates.slice(0, Math.max(0, maxProjects));
  // A job dropped by the project cap still had eligible sheets we are not
  // taking — that is a truncation and the record must say so.
  let truncated = candidates.length > inScope.length
    && candidates.slice(inScope.length).some((c) => c.sheetUris.some(isPrefetchableSheetUri));

  const eligible = inScope.map((c) => ({
    projectId: c.projectId,
    projectName: c.projectName,
    pool: c.sheetUris.filter(isPrefetchableSheetUri),
  }));

  const taken = new Map<string, string[]>();
  for (const e of eligible) taken.set(e.projectId, []);

  let total = 0;
  let round = 0;
  // Bounded by maxPerProject rounds; each round hands at most one sheet per job.
  while (round < maxPerProject && total < maxTotal) {
    let handedOutThisRound = false;
    for (const e of eligible) {
      if (total >= maxTotal) break;
      const next = e.pool[round];
      if (next === undefined) continue;
      taken.get(e.projectId)!.push(next);
      total++;
      handedOutThisRound = true;
    }
    if (!handedOutThisRound) break; // every pool exhausted
    round++;
  }

  const allocations: DayPackAllocation[] = eligible.map((e) => {
    const uris = taken.get(e.projectId)!;
    if (uris.length < e.pool.length) truncated = true;
    return {
      projectId: e.projectId,
      projectName: e.projectName,
      uris,
      eligible: e.pool.length,
    };
  }).filter((a) => a.uris.length > 0);

  return { allocations, truncated };
}

/** Bounded-concurrency map. Small and local — pulling in a dependency for six
 *  lines would be worse. Lives here rather than beside the fetcher so the whole
 *  warm loop is drivable by a validator. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Parallel fetches during a warm. Four keeps the pack quick without starving
 *  the foreground of bandwidth on a truck-stop 4G bar. */
export const WARM_CONCURRENCY = 4;

/**
 * Run the warm and build the record — the whole "what actually landed" loop,
 * with the fetcher injected.
 *
 * WHY THE SEAM EXISTS. The count on this record is a claim to a contractor
 * standing in a basement, and it was previously guarded only by source greps
 * for `results.filter(Boolean).length` and `mapLimit(a.uris`. Mutating
 * planPrefetch's `warmOne` to `return true` — so every allocated sheet is
 * recorded as confirmed no matter what the network did — left all of those
 * greps satisfied and the suite green, while the card read "Saved for offline:
 * 16 sheets across 4 jobs" for a pack in which nothing arrived. With the loop
 * here, scripts/validate-field-daypack drives it with a stub that fails a known
 * number of urls and asserts the number that comes out.
 *
 * `warm` may reject or resolve anything; only an explicit `true` counts. A
 * thrown prefetch and a `false` prefetch are the same fact — the bytes are not
 * on the device — and an ambiguous answer is not a measurement.
 *
 * Returns null when NOTHING landed, so the caller writes no record: stamping a
 * fresh `warmedAt` on a pack of zero would both claim a warm that did not
 * happen and lock out the next attempt for WARM_MIN_INTERVAL_MS.
 */
export async function buildDayPackRecord(
  userId: string,
  plan: DayPackPlan,
  warm: (uri: string) => Promise<unknown>,
  opts: { now?: number; concurrency?: number } = {},
): Promise<DayPackRecord | null> {
  if (!userId) return null;
  if (plan.allocations.length === 0) return null;

  const confirm = async (uri: string): Promise<boolean> => {
    try { return (await warm(uri)) === true; } catch { return false; }
  };

  const projects: DayPackProjectRecord[] = [];
  // A sheet the budget allocated but the network dropped is a partial pack too,
  // not only a budget truncation — the user's "am I covered" answer is the same
  // either way. Tracked against what was ALLOCATED (not against the cap), so
  // the comparison stays right when a caller overrides the caps.
  let missedAllocation = false;
  for (const a of plan.allocations) {
    const results = await mapLimit(a.uris, opts.concurrency ?? WARM_CONCURRENCY, confirm);
    const warmed = results.filter(Boolean).length;
    if (warmed < a.uris.length) missedAllocation = true;
    projects.push({
      projectId: a.projectId,
      projectName: a.projectName,
      sheetsWarmed: warmed,
      sheetsEligible: a.eligible,
    });
  }

  const warmedTotal = projects.reduce((n, p) => n + p.sheetsWarmed, 0);
  if (warmedTotal === 0) return null;

  return {
    warmedAt: opts.now ?? Date.now(),
    userId,
    projects,
    sheetsWarmed: warmedTotal,
    truncated: plan.truncated || missedAllocation,
  };
}

/**
 * How old the pack is, and whether it may still be believed.
 *
 * `expired` is not a politer `stale`: past DAY_PACK_EXPIRES_AFTER_MS the signed
 * urls that keyed the cached bytes are dead, so the coverage claim is void, not
 * merely aged. A record belonging to another user is `none` — someone else's
 * jobsite is not this user's readiness.
 */
export function dayPackFreshness(
  record: DayPackRecord | null | undefined,
  now: number,
  sessionUserId: string | null,
): DayPackFreshness {
  if (!record || !sessionUserId || record.userId !== sessionUserId) return 'none';
  if (record.sheetsWarmed <= 0) return 'none';
  const age = now - record.warmedAt;
  // A clock that moved backwards (timezone change, manual set) must not read as
  // a fresh pack from the future.
  if (age < 0) return 'stale';
  if (age >= DAY_PACK_EXPIRES_AFTER_MS) return 'expired';
  if (age >= DAY_PACK_STALE_AFTER_MS) return 'stale';
  return 'fresh';
}

/** May a warm run now? Spacing only — the caller still checks connectivity. */
export function shouldWarmNow(
  record: DayPackRecord | null | undefined,
  now: number,
  sessionUserId: string | null,
  minIntervalMs: number = WARM_MIN_INTERVAL_MS,
): boolean {
  if (!sessionUserId) return false;
  if (!record || record.userId !== sessionUserId) return true;
  const age = now - record.warmedAt;
  if (age < 0) return true; // clock moved back; re-warming is the safe answer
  return age >= minIntervalMs;
}

/**
 * Retract coverage for jobs that have left the horizon.
 *
 * This frees no bytes — see the header. It stops the record from claiming a job
 * that is no longer today's, which is the only part of the claim we control.
 */
export function evictDayPackRecord(
  record: DayPackRecord | null | undefined,
  inScopeProjectIds: readonly string[],
): DayPackRecord | null {
  if (!record) return null;
  const keep = new Set(inScopeProjectIds);
  const projects = record.projects.filter((p) => keep.has(p.projectId));
  if (projects.length === record.projects.length) return record;
  return {
    ...record,
    projects,
    sheetsWarmed: projects.reduce((n, p) => n + p.sheetsWarmed, 0),
  };
}

/** Local clock-time label, e.g. "7:12 AM". Kept here so the copy builder below
 *  is pure and the validator can pin the exact strings. */
export function clockLabel(at: number): string {
  const d = new Date(at);
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m < 10 ? `0${m}` : m} ${suffix}`;
}

/**
 * One line of TRUE copy about the pack.
 *
 * Rules this obeys, and the reason each exists:
 *   • never say "ready offline" for an expired pack — the bytes are orphaned
 *     (DAY_PACK_EXPIRES_AFTER_MS);
 *   • never present a count we did not measure — `sheetsWarmed` is what the
 *     prefetch confirmed, not what we asked for;
 *   • a stale pack says so in the same breath as the count, not in a tooltip;
 *   • a `truncated` pack says "partial", because "3 jobs ready" when the budget
 *     dropped a fourth is a claim the user would act on;
 *   • the count is stated AGAINST THE DAY. "Saved for offline: 4 sheets across
 *     1 job" is a true sentence and a false impression when the board holds two
 *     jobs and the second has nothing on the device — the super reads coverage
 *     and drives to the site that has none. `jobsToday` is the denominator; a
 *     shortfall is named, not left to be inferred from a number the reader
 *     would have to remember.
 *
 * `jobsToday` is what the surface says it is showing (TodayOnSite's own job
 * count). Pass 0 / omit it where there is no such denominator; a shortfall is
 * only ever reported when we have one and it exceeds what the pack covers.
 */
export function describeDayPack(
  record: DayPackRecord | null | undefined,
  freshness: DayPackFreshness,
  jobsToday: number = 0,
): string {
  const day = Math.max(0, Math.trunc(jobsToday));
  if (freshness === 'none' || !record) {
    // NOT "not saved yet" — that reads as a safeguard that failed, and the
    // commonest way to reach this line is a contractor who has simply never
    // uploaded a plan sheet, for whom there is nothing to save and nothing
    // wrong. State the device, not a verdict.
    return 'No plan sheets saved on this device.';
  }
  if (freshness === 'expired') {
    return 'Offline plan copies have expired — reconnect to refresh them.';
  }
  const jobs = record.projects.filter((p) => p.sheetsWarmed > 0).length;
  const jobWord = jobs === 1 ? 'job' : 'jobs';
  const sheetWord = record.sheetsWarmed === 1 ? 'sheet' : 'sheets';
  const head = record.truncated
    ? `Partial offline copy: ${record.sheetsWarmed} ${sheetWord} across ${jobs} ${jobWord}`
    : `Saved for offline: ${record.sheetsWarmed} ${sheetWord} across ${jobs} ${jobWord}`;
  const when = `saved ${clockLabel(record.warmedAt)}`;
  const short = day > jobs ? ` · ${day - jobs} of today’s ${day} jobs not saved` : '';
  return freshness === 'stale'
    ? `${head} · ${when}${short} · may be out of date`
    : `${head} · ${when}${short}`;
}

/** Tolerant parse of the persisted record. A shape we do not recognise is
 *  treated as absent rather than trusted — a half-written record must not be
 *  rendered as coverage. */
export function parseDayPackRecord(raw: string | null | undefined): DayPackRecord | null {
  if (!raw) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.warmedAt !== 'number' || !Number.isFinite(v.warmedAt)) return null;
  if (typeof v.userId !== 'string' || v.userId.length === 0) return null;
  if (!Array.isArray(v.projects)) return null;
  const projects: DayPackProjectRecord[] = [];
  for (const p of v.projects) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    if (typeof r.projectId !== 'string' || typeof r.projectName !== 'string') continue;
    const warmed = typeof r.sheetsWarmed === 'number' && Number.isFinite(r.sheetsWarmed) ? r.sheetsWarmed : 0;
    const elig = typeof r.sheetsEligible === 'number' && Number.isFinite(r.sheetsEligible) ? r.sheetsEligible : warmed;
    projects.push({
      projectId: r.projectId,
      projectName: r.projectName,
      sheetsWarmed: Math.max(0, Math.trunc(warmed)),
      sheetsEligible: Math.max(0, Math.trunc(elig)),
    });
  }
  return {
    warmedAt: v.warmedAt,
    userId: v.userId,
    projects,
    // Recompute rather than trust: the sum is the only number the copy quotes.
    sheetsWarmed: projects.reduce((n, p) => n + p.sheetsWarmed, 0),
    truncated: v.truncated === true,
  };
}


// ── #80 The on-device sheet files ───────────────────────────────────────────

/** storagePath → the file the warm downloaded, for ONE user. Persisted under a
 *  `mageid_` key so AuthContext's tenant sweep drops it on an account switch. */
export interface PlanSheetFileMap {
  userId: string;
  files: Record<string, { uri: string; savedAt: number }>;
}

/** Tolerant parse: an unrecognised shape is treated as no files, never as
 *  coverage. */
export function parsePlanSheetFileMap(raw: string | null | undefined): PlanSheetFileMap | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.userId !== 'string' || !r.userId) return null;
  const files: PlanSheetFileMap['files'] = {};
  if (r.files && typeof r.files === 'object') {
    for (const [path, entry] of Object.entries(r.files as Record<string, unknown>)) {
      const e = entry as { uri?: unknown; savedAt?: unknown } | null;
      if (!path || !e || typeof e.uri !== 'string' || !/^file:\/\//i.test(e.uri)) continue;
      files[path] = { uri: e.uri, savedAt: typeof e.savedAt === 'number' && Number.isFinite(e.savedAt) ? e.savedAt : 0 };
    }
  }
  return { userId: r.userId, files };
}

/**
 * The local file to render for a sheet, or null. Only THIS session's map
 * answers: a map another account wrote on this phone is never used, even for
 * the moment between a tenant switch and the sweep.
 */
export function localSheetFileFor(
  map: PlanSheetFileMap | null | undefined,
  sessionUserId: string | null | undefined,
  storagePath: string | null | undefined,
): string | null {
  if (!map || !sessionUserId || map.userId !== sessionUserId) return null;
  const key = (storagePath ?? '').trim();
  if (!key) return null;
  return map.files[key]?.uri ?? null;
}

/** A stable, filesystem-safe name for a storage path (the path itself has
 *  slashes and a project uuid). The extension is kept so the image decoder
 *  gets a hint. */
export function planSheetFileName(storagePath: string, hash: (s: string) => string): string {
  const ext = /\.(png|jpe?g|webp)$/i.exec(storagePath)?.[1]?.toLowerCase() ?? 'png';
  return `${hash(storagePath)}.${ext}`;
}

/** Which of this user's files survive a warm: the sheets this pack allocated
 *  (landed now, or kept from an earlier warm whose file still exists). Anything
 *  else is deleted, so the folder never grows past one pack. */
export function filesToKeep(
  map: PlanSheetFileMap | null,
  userId: string,
  allocatedPaths: readonly string[],
): PlanSheetFileMap {
  const keep: PlanSheetFileMap['files'] = {};
  const prior = map && map.userId === userId ? map.files : {};
  for (const p of allocatedPaths) if (prior[p]) keep[p] = prior[p];
  return { userId, files: keep };
}
