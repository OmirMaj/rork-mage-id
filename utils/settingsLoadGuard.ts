// utils/settingsLoadGuard.ts — the rules that keep a GC's REAL company profile
// from being replaced by DEFAULT / blank settings. Pure (no React, no RN), so
// scripts/validate-settings-load-guard.ts executes them under Bun.
//
// WHY THIS EXISTS (post-ship review, findings 13 / 14 / 15 / 105 / 106). The
// settings loader in contexts/ProjectContext.tsx had three ways to put blanks
// where his profile was, and each one ended in a full-row profiles UPDATE:
//
//   13  A failed first read with no device copy resolved with DEFAULT_SETTINGS,
//       and the data effect marked that as "loaded". The proposal ask sheet
//       then asked his company name again and the save sent '' contact
//       details, 10 % contingency and 'United States' over his real row.
//   14  An edit made while the profile was still loading was held as a
//       snapshot built on DEFAULT — a whole `branding` object with every
//       other field blank — and merged WHOLESALE onto the row when it landed.
//   15  The launch read, started before an edit, landed after it and was
//       committed (and saved to the device) anyway, so the edit snapped back
//       and the next settings write erased it from the server.
//
// The rules, one function each:
//   · settingsReadFallback — what the loader resolves with when the read did
//     not produce a row. DEFAULT only for a local-only session; never for a
//     failure, and "no row" (PGRST116) is a failure (see the function).
//   · firstProfileReadTimeoutMs / settingsHoldsBoot / sameSettings — the
//     first read is bounded but can still finish on a slow link, a Retry
//     never puts the splash back over the app, and a refetch that changed
//     nothing is not a new `settings`.
//   · settingsAfterRead — a row read that raced a write on this device keeps
//     the device's values and owes one re-read.
//   · heldSettingsPatch / mergeHeldPatches / applyHeldSettings — a pre-load
//     edit is held as ONLY the fields he changed, and lands one level deep.
//   · profileGateNotice / savedTermsView — what a blocked control or a label
//     says while the profile is loading or could not be loaded.

import type { AppSettings, PaymentSplit } from '@/types';
import { resolvePaymentSplit, resolveWarrantyMonths } from '@/utils/paymentTerms';

// ─── Reads ───────────────────────────────────────────────────────────────────

/** How long a FIRST read (nothing loaded, no device copy) may take before it
 *  counts as failed. A GC with no cached profile is blocked from every
 *  client document until it lands; on Android an OkHttp request has no
 *  timeout at all, so without this a stalled read held him forever. A read
 *  with a device copy behind it keeps the platform's own timeout — he is not
 *  blocked, and a slow read of a large row (a logo data URI) should still
 *  land. */
export const FIRST_PROFILE_READ_TIMEOUT_MS = 15_000;
/** The ceiling the per-attempt deadline doubles up to. */
export const MAX_PROFILE_READ_TIMEOUT_MS = 120_000;

/**
 * The deadline for the next first read, given how many first reads for this
 * account have already failed. The deadline covers the whole response, body
 * included (postgrest's abortSignal spans fetch and body read), and a real
 * profiles row can be ~235 KB (a logo data URI in the row): at ~100 kbps
 * that alone is ~19 s. A fixed 15 s on every attempt meant that read could
 * NEVER land on a slow link — each attempt and each Retry died at the same
 * point. So the deadline doubles per failure (15 → 30 → 60 → 120 s): a
 * stalled link is still reported in 15 s, and a slow one gets a window it
 * can finish in.
 */
export function firstProfileReadTimeoutMs(priorFailures: number): number {
  const n = Math.max(0, Math.min(Math.floor(priorFailures) || 0, 10));
  return Math.min(FIRST_PROFILE_READ_TIMEOUT_MS * 2 ** n, MAX_PROFILE_READ_TIMEOUT_MS);
}

export type SettingsReadFallback =
  | { resolve: AppSettings; source: 'device' | 'loaded' | 'local_only' }
  | { fail: string };

/**
 * The profiles read produced no row. What the settings loader does:
 *   · this account's settings are already loaded → keep them (a refetch that
 *     failed tells us nothing new, and the device copy can lag the state).
 *     The SAME object, so a failed refetch is not a new `settings` identity
 *     that re-runs every effect keyed on it;
 *   · a device copy exists → that copy (DEFAULT under it for absent keys);
 *   · a local-only session (no account / no backend) → DEFAULT, the only
 *     settings it will ever have;
 *   · anything else → FAIL. Resolving DEFAULT here is finding 13: the data
 *     effect would mark blanks as his profile and the next save would write
 *     them over his row. Failing leaves settingsLoaded false, lets React
 *     Query retry, and gives the gate an error to offer Retry on.
 *
 * "No row" (PostgREST PGRST116) is a failure too, NOT a new account. Every
 * auth user gets a profiles row in the same transaction that creates him
 * (the on_auth_user_created trigger, handle_new_user; prod: 30 users, 30
 * rows, 0 without), so a signed-in GC never legitimately has none. What
 * does return zero rows is the read going out WITHOUT his JWT: when auth-js
 * cannot refresh an expired token (flaky LTE, a GoTrue 5xx) it hands back
 * no session and supabase-js sends the anon key, and the `auth.uid() = id`
 * policy then matches nothing. Treating that as "new account" resolved
 * DEFAULT, marked it loaded, and the next save blanked his row — finding 13
 * by another door. And a row that truly were missing could not be written
 * anyway: the whole-row save is an UPDATE, which would match nothing.
 */
export function settingsReadFallback(input: {
  canSync: boolean;
  loaded: AppSettings | null;
  cached: Partial<AppSettings> | null | undefined;
  defaults: AppSettings;
}): SettingsReadFallback {
  const { canSync, loaded, cached, defaults } = input;
  if (loaded) return { resolve: loaded, source: 'loaded' };
  if (cached && typeof cached === 'object') return { resolve: { ...defaults, ...cached }, source: 'device' };
  if (!canSync) return { resolve: { ...defaults }, source: 'local_only' };
  return { fail: 'Your company profile could not be loaded and there is no copy on this device.' };
}

/**
 * Whether the settings read may hold the cold-start splash (CoreData
 * `isLoading` → the root layout's CraneLoader, which REPLACES the whole
 * navigation stack). Only the first attempt for this account, and only until
 * it has settled one way or the other.
 *
 * Why not plain `settingsQuery.isLoading`: once the loader could throw with
 * no data (finding 13), every refetch of that errored query — the gate's
 * Retry, the reachability Retry, a web window refocus, a reconnect — put it
 * back in `pending` + `fetching`, which IS isLoading. The Stack unmounted
 * under him for a whole retry cycle: the screen he pressed Retry on, and any
 * unsaved draft on it, were gone. `settledForOwner` is sticky per account and
 * set the moment the first attempt fails or data lands; a cancelled-and-
 * reverted query cannot un-set it.
 */
export function settingsHoldsBoot(input: {
  isLoading: boolean;
  settledForOwner: boolean;
}): boolean {
  return input.isLoading && !input.settledForOwner;
}

/** Deep equality for a settings object — the data effect skips committing a
 *  refetch that changed nothing, so `settings` keeps its identity and the
 *  effects keyed on it (the portal lite sync, the sub-portal snapshot) do
 *  not re-run a publish for every refetch. */
export function sameSettings(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => sameSettings(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // An explicit `undefined` and an absent key are the same answer (JSON drops
  // both; the device copy never has the former).
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!sameSettings(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * profiles columns the whole-row settings save writes (ProjectContext
 * saveSettingsMutation). A queued profiles update carrying any of them means
 * the server row is older than this device until the queue flushes. The terms
 * columns are not here — their own pending rule lives in paymentTerms.ts —
 * and neither are onboarding_complete / user_role, whose writes say nothing
 * about these fields.
 */
export const SETTINGS_ROW_COLUMNS = [
  'location', 'units', 'tax_rate', 'contingency_rate',
  'company_name', 'contact_name', 'email', 'phone', 'address', 'license_number',
  'license_state', 'license_expiry', 'tagline', 'logo_uri', 'signature_data',
  'theme_colors', 'biometrics_enabled', 'dfr_recipients',
  'digest_enabled', 'digest_hour', 'digest_channels', 'digest_timezone', 'financing',
] as const;

export function settingsRowWritePending(
  queue: readonly { table: string; operation: string; data: Record<string, unknown> }[],
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  return queue.some((e) => e.table === 'profiles' && e.operation === 'update' && e.data?.id === userId
    && SETTINGS_ROW_COLUMNS.some((c) => c in e.data));
}

/**
 * Wave-4 final fix (round 8) · The profiles row with this session's Not-saved
 * settings lines laid over it — the same rule as the projects loader
 * (utils/projectContextPure overlayUnsavedRow): the columns a refused
 * whole-row save carries win, every other column is the server's. Lines are
 * applied oldest to newest (a later line's column wins, as Retry replays
 * them). Only SETTINGS_ROW_COLUMNS: payment terms keep their own rule
 * (paymentTermsAfterLoad, which already counts a Not-saved terms line).
 *
 * Why: the device copy kept for a Not-saved save (settingsAfterRead
 * rowWriteUnsaved) lives in memory and the AsyncStorage cache, and a
 * same-user re-auth sweep empties the cache. The next cold launch then read
 * the row alone — the server's 7.5 % over his refused 8.25 % — and his next
 * settings save, even an unrelated one, folded 7.5 % into the line. The
 * ledger survives the sweep, so the row read through it keeps his answer.
 */
export function settingsRowWithUnsaved(
  row: Record<string, unknown>,
  lines: readonly { operation: string; data: Record<string, unknown>; queuedAt?: number }[],
  userId: string | null | undefined,
): Record<string, unknown> {
  if (!userId) return row;
  const mine = lines
    .filter((l) => l.operation === 'update' && l.data?.id === userId)
    .sort((a, b) => (a.queuedAt ?? 0) - (b.queuedAt ?? 0));
  if (mine.length === 0) return row;
  const out: Record<string, unknown> = { ...row };
  for (const l of mine) {
    for (const c of SETTINGS_ROW_COLUMNS) if (c in l.data) out[c] = l.data[c];
  }
  return out;
}

/**
 * A row read landed. Whether it may replace the settings on this device.
 *
 * It may NOT when a settings write on this device could be newer than the row:
 * one was made while the read was out (the sequence moved), a whole-row write
 * was on the wire as the read began or as it returned (supabaseWrite tries the
 * network before it queues, so the queue cannot see it yet), or one is still
 * queued offline. Then the device's settings are at least as fresh as the row
 * for every field this device can edit: keep them whole, do not save the row
 * to the device copy, and re-read once the writes have landed so fields
 * changed on another device still arrive.
 *
 * Only while this account's settings are loaded. Before that the device holds
 * DEFAULT, and writes are HELD rather than sent (they land on the row via
 * applyHeldSettings), so the row always wins.
 *
 * Wave-4 final fix · `rowWriteUnsaved`: a whole-row save of this session sits
 * under Not saved. The device copy is kept (it is the only copy of his edit)
 * but NO re-read is owed: nothing will land it but his Retry, and Retry and
 * Discard re-read 'settings' themselves (ProjectContext rereadLedgerTables).
 * Counting the line as "queued" owed a re-read that the queue-only readiness
 * check always passed — the re-read was held by the line again and owed
 * another, a select('*') of his profile row per pass, forever.
 */
export function settingsAfterRead(input: {
  fromRow: AppSettings;
  current: AppSettings;
  currentLoaded: boolean;
  writeSeqAtStart: number;
  writeSeqNow: number;
  rowWritesInFlightAtStart: number;
  rowWritesInFlightNow: number;
  rowWriteQueued: boolean;
  rowWriteUnsaved?: boolean;
}): { settings: AppSettings; kept: 'row' | 'device'; persist: boolean; rereadOwed: boolean } {
  const raced = input.writeSeqNow !== input.writeSeqAtStart
    || input.rowWritesInFlightAtStart > 0
    || input.rowWritesInFlightNow > 0
    || input.rowWriteQueued;
  if (input.currentLoaded && raced) {
    return { settings: { ...input.current }, kept: 'device', persist: false, rereadOwed: true };
  }
  if (input.currentLoaded && input.rowWriteUnsaved) {
    return { settings: { ...input.current }, kept: 'device', persist: false, rereadOwed: false };
  }
  return { settings: input.fromRow, kept: 'row', persist: true, rereadOwed: false };
}

/**
 * Whether the re-read a raced load owed (settingsAfterRead → rereadOwed) can
 * run NOW. Only when nothing this device wrote is still out: a whole-row or
 * terms write on the wire settles later and runs the check again from its
 * own `finally`; one queued offline runs it when the queue flushes. When
 * every write already settled while the read was out (or the race was a
 * terms write), nothing else would ever run it — the loader calls this as it
 * returns, or the device keeps a stale value for a field another device
 * changed and the next whole-row write sends that value back.
 */
export function owedSettingsRereadReady(input: {
  owed: boolean;
  rowWritesInFlight: number;
  termsWritesInFlight: number;
  profilesWriteQueued: boolean;
}): boolean {
  return input.owed
    && input.rowWritesInFlight === 0
    && input.termsWritesInFlight === 0
    && !input.profilesWriteQueued;
}

// ─── Edits made before the profile loaded ───────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Blank in every spelling a screen seeds from DEFAULT: absent, null, '',
 *  false, an empty list. Two blanks are the same answer. */
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true;
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

/**
 * The part of a pre-load updateSettings call that is really HIS: only the
 * fields whose value differs from what the screen was showing (`base`, the
 * DEFAULT-based settings in state before the load). A screen that writes a
 * whole `branding` object built from blank fields — Company Profile's state
 * picker, logo, signature and Save; Get Verified — would otherwise replace
 * his saved company name, contact, phone, address and licence with ''.
 * Nested objects the base already has (branding) are diffed field by field;
 * one it does not have is held whole (there is nothing it could be compared
 * with). Returns null when nothing changed.
 */
export function heldSettingsPatch(base: AppSettings, updates: Partial<AppSettings>): Partial<AppSettings> | null {
  const out: Record<string, unknown> = {};
  const b = base as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(updates as Record<string, unknown>)) {
    const was = b[key];
    if (isPlainObject(value) && isPlainObject(was)) {
      const sub: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (!sameValue(v, was[k])) sub[k] = v;
      }
      if (Object.keys(sub).length > 0) out[key] = sub;
    } else if (!sameValue(value, was)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? (out as Partial<AppSettings>) : null;
}

/** Two held patches, the later winning — one level deep, so a held licence
 *  state and a later held logo both survive. */
export function mergeHeldPatches(earlier: Partial<AppSettings> | null, later: Partial<AppSettings> | null): Partial<AppSettings> | null {
  if (!earlier) return later;
  if (!later) return earlier;
  const out: Record<string, unknown> = { ...(earlier as Record<string, unknown>) };
  for (const [key, value] of Object.entries(later as Record<string, unknown>)) {
    const prev = out[key];
    out[key] = isPlainObject(value) && isPlainObject(prev) ? { ...prev, ...value } : value;
  }
  return out as Partial<AppSettings>;
}

/** The loaded row with the held patch on top, one level deep: a held
 *  `branding: { licenseState }` changes his licensing state and nothing else. */
export function applyHeldSettings(loaded: AppSettings, held: Partial<AppSettings> | null): AppSettings {
  if (!held) return loaded;
  const out: Record<string, unknown> = { ...(loaded as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(held as Record<string, unknown>)) {
    const prev = out[key];
    out[key] = isPlainObject(value) && isPlainObject(prev) ? { ...prev, ...value } : value;
  }
  return out as unknown as AppSettings;
}

// ─── What a blocked control and a label say ─────────────────────────────────

/** Shown when a gate is pressed while the profile read is still out. */
export const PROFILE_LOADING_REASON = 'Loading your company profile — try again in a second.';
export const PROFILE_FAILED_TITLE = 'Couldn’t load your company profile';
/** Said plainly, with what still works: his jobs are on the phone; what
 *  waits is anything that prints his company details or terms. */
export const PROFILE_FAILED_REASON = 'MAGE can’t be reached right now — check your signal. Your jobs on this phone still open and save. Anything that prints your company name, contact details or payment terms waits until your profile loads.';

/** The alert a profile-gated press shows before the profile has loaded. */
export function profileGateNotice(input: { failed: boolean }): { title: string; message: string } {
  return input.failed
    ? { title: PROFILE_FAILED_TITLE, message: PROFILE_FAILED_REASON }
    : { title: 'One second', message: PROFILE_LOADING_REASON };
}

export type SavedTermsStatus = 'loading' | 'failed' | 'ready';

/** Short labels for a row whose value is not known yet. Never 'Not set': he
 *  may well have set it. */
export const SAVED_TERMS_PENDING_LABEL: Record<Exclude<SavedTermsStatus, 'ready'>, string> = {
  loading: 'Loading…',
  failed: 'Couldn’t load',
};

/**
 * His saved payment split and warranty, or why they are not known yet. Before
 * the load `settings` is DEFAULT_SETTINGS, which has neither — so the old
 * labels said "Not set" about terms he had in fact set. Until `settingsLoaded`
 * the answer is withheld (split / months null) and the status says why.
 */
export function savedTermsView(input: {
  settings: Pick<AppSettings, 'paymentSplit' | 'warrantyMonths'>;
  settingsLoaded: boolean;
  failed: boolean;
}): { status: SavedTermsStatus; split: PaymentSplit | null; warrantyMonths: number | null } {
  if (!input.settingsLoaded) {
    return { status: input.failed ? 'failed' : 'loading', split: null, warrantyMonths: null };
  }
  return {
    status: 'ready',
    split: resolvePaymentSplit({ settings: input.settings }).split,
    warrantyMonths: resolveWarrantyMonths(input.settings),
  };
}
