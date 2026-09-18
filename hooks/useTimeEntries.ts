// useTimeEntries — real backend for the Crew Time Tracking screen.
//
// Pre-audit (May 2026), `app/time-tracking.tsx` was MOCK_TIME_ENTRIES +
// local React state. Clock-ins didn't persist past navigation. This hook
// replaces the mock with a Supabase-backed CRUD that mirrors the same
// offline-queue + AsyncStorage pattern used for invoices, change orders,
// and daily reports.
//
// Storage flow:
//  - Local source of truth: AsyncStorage `mageid_time_entries` keyed by
//    user. Reads are synchronous from React state, hydrated on mount.
//  - Server mirror: Supabase `time_entries` table via `supabaseWrite()`
//    from utils/offlineQueue.ts. Writes are queued so airplane-mode
//    clock-ins don't drop on the floor.
//  - Read sync: when the user signs in, we pull every entry from
//    Supabase and merge into the local store (server wins on conflict).
//
// ONE STORE, NOT ONE PER MOUNT (audit round 2, field-ops #8). This used to be
// a plain hook holding its entries in useState, and it had two live mounts:
// the Time Tracking screen and the global voice mic (components/
// UniversalMicButton, mounted on every screen by BrainSurface). The copies
// never talked. Each wrote its WHOLE array to `mageid_time_entries`, so a
// voice log on the mic's launch-time copy erased the morning's clock-ins from
// the mirror job cost / WIP / budget read — and each copy re-posted a shift
// alert for every clocked-in entry into its own id map, so clock-out on the
// screen could not cancel the mic's (or a previous launch's) alert, and the
// foreman got "Jose reached 8h" after Jose went home. The state now lives in
// useTimeEntriesStore, mounted ONCE by contexts/TimeEntriesContext
// (TimeEntriesProvider in app/_layout.tsx); useTimeEntries() reads that one
// store and keeps its old return shape for every caller.
//
// TWO SETS, NOT ONE (audit round 2 #28). `entries` is the signed-in user's OWN
// timesheet — pulled `.eq('user_id', me)` — and it is what clockIn / clockOut
// / delete write back through supabaseWrite. It stays that way. The crew hours
// OTHER people logged on this user's jobs (a foreman clocking four framers in
// on the GC's Henderson) were never read at all, so the GC's job costing, WIP,
// budget dashboard and cost book showed $0 self-perform labour on every job a
// foreman ran. Those rows now arrive in a SEPARATE read, `teamEntries`, stored
// under its own key and merged only into the read-only mirror
// (mergeTimeEntriesMirror / loadTimeEntriesMirror). They are never merged into
// `entries`: that array holds the open shift clock-out acts on, and a GC who
// could see a foreman's open shift as his own could clock it out or delete it.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import { scheduleLocalNotificationAt, cancelScheduledNotification } from '@/utils/notifications';
import { toCalendarDayString, todayCalendarDay } from '@/utils/calendarDate';
import type { TimeEntry, TimeEntryStatus } from '@/types';

/** Exported for the read-only labor-samples bridge (hooks/useLaborRates.ts
 *  useLaborCostSamples) so the mirror key never drifts between the two. */
export const TIME_ENTRIES_STORAGE_KEY = 'mageid_time_entries';
/** The react-query key hooks/useLaborRates.useTimeEntriesMirror reads the
 *  mirror under. The store invalidates it after every write so job cost, WIP
 *  and the budget dashboard re-read the storage the store just wrote, instead
 *  of the copy they cached when they mounted. Must equal useLaborRates'
 *  ENTRIES_MIRROR_QUERY (scripts/validate-time-clock-store.ts pins it). */
export const TIME_ENTRIES_MIRROR_QUERY_KEY = ['time-entries-mirror'] as const;
/** Crew hours OTHER people logged on this user's jobs (#28). Read-only here:
 *  never written back to the server, never merged into `entries`. `mageid_`
 *  prefix, so the tenant-switch sweep removes it with everything else. */
export const TIME_ENTRIES_TEAM_STORAGE_KEY = 'mageid_time_entries_team';
const STORAGE_KEY = TIME_ENTRIES_STORAGE_KEY;
const SHIFT_ALERT_HOURS_KEY = 'mageid_shift_alert_hours';
const DEFAULT_SHIFT_ALERT_HOURS = 8;
export const SHIFT_ALERT_NOTIF_PREFIX = 'shift-alert:';
export const SHIFT_ALERT_KIND = 'shift_alert';
/** Don't post an alert due in under 30s — the OS rejects past triggers and a
 *  0-second notification is noise; the in-app banner covers that moment. */
const SHIFT_ALERT_MIN_LEAD_MS = 30_000;

interface DBRow {
  id: string;
  user_id: string;
  project_id: string;
  project_name: string;
  worker_id: string;
  worker_name: string;
  trade: string;
  clock_in: string;
  clock_out: string | null;
  break_minutes: number;
  break_started_at: string | null;
  total_hours: number;
  overtime_hours: number;
  status: TimeEntryStatus;
  notes: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  date: string;
}

function fromDB(r: DBRow): TimeEntry {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    workerId: r.worker_id,
    workerName: r.worker_name,
    trade: r.trade ?? '',
    clockIn: r.clock_in,
    clockOut: r.clock_out ?? undefined,
    breakMinutes: r.break_minutes ?? 0,
    breakStartedAt: r.break_started_at ?? undefined,
    totalHours: Number(r.total_hours ?? 0),
    overtimeHours: Number(r.overtime_hours ?? 0),
    status: r.status,
    notes: r.notes ?? undefined,
    gpsLat: r.gps_lat ?? undefined,
    gpsLng: r.gps_lng ?? undefined,
    date: r.date,
  };
}

function toDB(e: TimeEntry, userId: string): Omit<DBRow, 'created_at' | 'updated_at'> {
  return {
    id: e.id,
    user_id: userId,
    project_id: e.projectId,
    project_name: e.projectName,
    worker_id: e.workerId,
    worker_name: e.workerName,
    trade: e.trade,
    clock_in: e.clockIn,
    clock_out: e.clockOut ?? null,
    break_minutes: e.breakMinutes,
    break_started_at: e.breakStartedAt ?? null,
    total_hours: e.totalHours,
    overtime_hours: e.overtimeHours,
    status: e.status,
    notes: e.notes ?? null,
    gps_lat: e.gpsLat ?? null,
    gps_lng: e.gpsLng ?? null,
    date: e.date,
  };
}

/**
 * Compute total + overtime hours from a clock-in/clock-out pair minus
 * break minutes. Standard "anything over 8 hours/day is OT" rule —
 * adjust here when the GC sets a custom OT policy.
 */
export function computeShiftHours(clockIn: string, clockOut: string, breakMinutes: number): { totalHours: number; overtimeHours: number } {
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  const grossHours = Math.max(0, ms / 3_600_000);
  const totalHours = Math.max(0, grossHours - breakMinutes / 60);
  const overtimeHours = Math.max(0, totalHours - 8);
  return {
    totalHours: Math.round(totalHours * 100) / 100,
    overtimeHours: Math.round(overtimeHours * 100) / 100,
  };
}

/**
 * The LOCAL calendar day a shift was worked (field-ops #9).
 *
 * Read it from the clock-in instant, not from `entry.date`. clockIn wrote
 * `date` as the UTC day (the ISO string's date half) until this fix, so
 * every shift punched after ~5 pm Pacific is on disk and in Supabase
 * `time_entries` filed under TOMORROW. Fixing only the writer would leave
 * those rows wrong forever; deriving the day from the instant fixes old and
 * new rows the same way with no data migration. `date` is the fallback for a
 * row whose clockIn is missing or unparseable.
 */
export function timeEntryDay(entry: Pick<TimeEntry, 'clockIn' | 'date'>): string {
  if (entry.clockIn) {
    const d = new Date(entry.clockIn);
    if (!Number.isNaN(d.getTime())) return toCalendarDayString(d);
  }
  return entry.date;
}

/** Clock time for the payroll CSV: the LOCAL wall clock, 'YYYY-MM-DD HH:MM'
 *  (24h). The raw ISO instant pasted a 6:30 am punch into QuickBooks as
 *  '…T13:30:00.000Z'. An unparseable value passes through unchanged — showing
 *  the bookkeeper the raw value beats hiding a data bug. */
export function formatClockForCsv(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${toCalendarDayString(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── Shift alerts: identified by entry, not by whichever mount posted them ──
//
// scheduleLocalNotificationAt returns an OS id the caller must remember. The
// old hook remembered it in a per-mount ref, and the OS queue outlives that
// ref: after a relaunch, or on a second mount, clock-out had no id to cancel
// and the stale alert fired after the shift ended. Every shift alert carries
// `data: { kind: 'shift_alert', entryId }`, including the ones already queued
// on devices by earlier builds, so the store asks the OS what is queued and
// cancels by ENTRY. The `shift-alert:<entryId>` identifier is matched too, for
// when utils/notifications learns to pass a deterministic identifier.

export interface ScheduledShiftAlert {
  identifier: string;
  entryId: string | null;
}

/** Pick the shift alerts out of the OS's scheduled-notification list. */
export function scheduledShiftAlertsFrom(
  requests: readonly { identifier: string; content?: { data?: unknown } | null }[],
): ScheduledShiftAlert[] {
  const out: ScheduledShiftAlert[] = [];
  for (const r of requests) {
    const data = (r.content?.data ?? null) as { kind?: unknown; entryId?: unknown } | null;
    const byData = !!data && data.kind === SHIFT_ALERT_KIND;
    const byId = typeof r.identifier === 'string' && r.identifier.startsWith(SHIFT_ALERT_NOTIF_PREFIX);
    if (!byData && !byId) continue;
    const entryId = byData && typeof data?.entryId === 'string'
      ? data.entryId
      : byId ? r.identifier.slice(SHIFT_ALERT_NOTIF_PREFIX.length) : null;
    out.push({ identifier: r.identifier, entryId });
  }
  return out;
}

/** OS ids of every queued alert for one entry — however many mounts posted one. */
export function shiftAlertIdsForEntry(scheduled: ScheduledShiftAlert[], entryId: string): string[] {
  return scheduled.filter(s => s.entryId === entryId).map(s => s.identifier);
}

/** When a clocked-in shift crosses the threshold: clock-in + threshold + the
 *  break minutes already taken, so a worker isn't alerted for break time. */
export function shiftAlertFireAtMs(entry: Pick<TimeEntry, 'clockIn' | 'breakMinutes'>, thresholdHours: number): number {
  return new Date(entry.clockIn).getTime() + thresholdHours * 3_600_000 + (entry.breakMinutes ?? 0) * 60_000;
}

/**
 * Bring the OS queue in line with the entries. EVERY queued shift alert is
 * cancelled — stale ones (the shift ended, the entry was deleted, another
 * account's) and duplicates alike — and exactly one is re-posted per shift
 * still on the clock. A shift on break gets none (resume re-posts it); one
 * whose alert is due in under 30s gets none. Idempotent: run it twice and the
 * queue is the same.
 */
export function planShiftAlertReconcile(
  scheduled: ScheduledShiftAlert[],
  entries: TimeEntry[],
  thresholdHours: number,
  nowMs: number,
): { cancel: string[]; schedule: { entry: TimeEntry; fireAtMs: number }[] } {
  const cancel = scheduled.map(s => s.identifier);
  const schedule: { entry: TimeEntry; fireAtMs: number }[] = [];
  for (const e of entries) {
    if (e.status !== 'clocked_in') continue;
    const fireAtMs = shiftAlertFireAtMs(e, thresholdHours);
    if (fireAtMs - nowMs < SHIFT_ALERT_MIN_LEAD_MS) continue;
    schedule.push({ entry: e, fireAtMs });
  }
  return { cancel, schedule };
}

async function listScheduledShiftAlerts(): Promise<ScheduledShiftAlert[]> {
  if (Platform.OS === 'web') return [];
  try {
    return scheduledShiftAlertsFrom(await Notifications.getAllScheduledNotificationsAsync());
  } catch (err) {
    console.warn('[useTimeEntries] Could not read scheduled notifications:', err);
    return [];
  }
}

/** Merge two entry lists by id; `winner` overrides `base` on conflict. */
function mergeById(base: TimeEntry[], winner: TimeEntry[]): TimeEntry[] {
  const byId = new Map<string, TimeEntry>();
  base.forEach(e => byId.set(e.id, e));
  winner.forEach(e => byId.set(e.id, e));
  return Array.from(byId.values());
}

/** A shift someone else logged on one of this user's jobs, with its author.
 *  `onOwnedProject` is stamped at fetch time: true only when the job is one
 *  this user OWNS (not an editor/viewer seat on another contractor's job). */
export type TeamTimeEntry = TimeEntry & { loggedByUserId: string; onOwnedProject?: boolean };

/**
 * The team rows that may reach this user's COSTING mirror: those on projects
 * he owns. The mirror feeds company-wide surfaces — the cost book
 * (useLaborCostSamples), OSHA 300A hours, WIP — and an editor/viewer seat on
 * another contractor's job would otherwise push THAT company's crew hours and
 * rates into this company's books. A row without the flag (persisted before
 * the flag existed) is left out until the next pull re-stamps it: fail closed.
 * Editor/viewer team hours still reach the daily report via `teamEntries`.
 */
/**
 * The columns the TEAM read asks for — everything the two readers of team rows
 * use (costing: hours / overtime / worker / trade / day; the daily report's
 * crew block, utils/dfrClockCrew: status / clock times / worker / trade) and
 * NOTHING else. The read covers editor and viewer seats on other contractors'
 * jobs, so `select('*')` shipped that company's crew GPS fixes and shift
 * notes onto this user's device, where nothing reads them (integration round
 * 3). RLS would allow it; this app has no reason to fetch it.
 * scripts/validate-time-clock-store.ts pins that the team read uses this list
 * and that it never names gps_lat, gps_lng or notes.
 */
export const TEAM_TIME_ENTRY_COLUMNS =
  'id, user_id, project_id, project_name, worker_id, worker_name, trade, clock_in, clock_out, break_minutes, break_started_at, total_hours, overtime_hours, status, date';

/** Drop the location and free-text fields from a team row. Applied on fetch
 *  (belt and braces behind TEAM_TIME_ENTRY_COLUMNS) and on hydrate, so a
 *  copy persisted by an older build that read `*` is scrubbed on next launch
 *  instead of waiting for a pull that might fail. Pure, for the validator. */
export function teamRowForDevice(e: TeamTimeEntry): TeamTimeEntry {
  const { gpsLat: _lat, gpsLng: _lng, notes: _notes, ...rest } = e;
  return rest;
}

export function costingTeamRows(team: TeamTimeEntry[]): TeamTimeEntry[] {
  return team.filter(e => e.onOwnedProject === true);
}

/**
 * The read-only labour view job costing / WIP / budget / the cost book use:
 * the user's own shifts plus the team's on his jobs. Own wins on an id clash
 * (it may carry an un-synced local edit), and nothing is counted twice.
 */
export function mergeTimeEntriesMirror(own: TimeEntry[], team: TimeEntry[]): TimeEntry[] {
  const ids = new Set(own.map(e => e.id));
  return [...own, ...team.filter(e => !ids.has(e.id))];
}

/** Read the costing mirror from storage: the own-shift key plus the team
 *  rows on OWNED projects (costingTeamRows). hooks/useLaborRates'
 *  useTimeEntriesMirror uses this as its queryFn. */
export async function loadTimeEntriesMirror(): Promise<TimeEntry[]> {
  const read = async (key: string): Promise<TimeEntry[]> => {
    try {
      const raw = await AsyncStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as TimeEntry[]) : [];
    } catch {
      return [];
    }
  };
  const team = (await read(TIME_ENTRIES_TEAM_STORAGE_KEY)) as TeamTimeEntry[];
  return mergeTimeEntriesMirror(await read(STORAGE_KEY), costingTeamRows(team));
}

/**
 * Which projects' team hours this user should see: the ones he OWNS, plus the
 * ones he is an accepted EDITOR, VIEWER or FIELD member of. FIELD is in since
 * integration round 1: a superintendent on field access files the daily
 * report, and without the foreman's clock-ins from the other phone his roster
 * said "nobody clocked in" as fact. This read is hours only
 * (TEAM_TIME_ENTRY_COLUMNS carries no rate, GPS or notes), RLS already returns
 * these rows to a field seat (time_entries_collab_select), and a seat's rows
 * never reach costing — costingTeamRows keeps only OWNED jobs — so his cost
 * book still cannot learn from another contractor's crew. Pure, for the
 * validator.
 */
export function teamScopeProjectIds(
  owned: { id: string }[],
  memberships: { project_id: string; role: string; status?: string }[],
): string[] {
  const ids = new Set(owned.map(p => String(p.id)));
  for (const m of memberships) {
    if (m.status && m.status !== 'accepted') continue;
    if (m.role === 'editor' || m.role === 'viewer' || m.role === 'field') ids.add(String(m.project_id));
  }
  return [...ids].filter(Boolean);
}

/** Minimum gap between foreground re-pulls of own + team hours. */
const FOREGROUND_PULL_MIN_MS = 5 * 60 * 1000;

/** PostgREST caps a URL; keep each `.in()` short. */
const TEAM_IN_CHUNK = 100;
/** Rows asked for per page of the team read. PostgREST also caps a response
 *  at the API's max_rows (Supabase default 1000) and says nothing when it
 *  does — so the read pages until a page comes back EMPTY, never stopping at a
 *  merely short one (a lower server cap would look short). */
const TEAM_PAGE = 1000;
/** Safety stop for a server that ignores the range and repeats a page. */
const TEAM_MAX_PAGES = 200;

/**
 * The time-entry store. Mount it ONCE — contexts/TimeEntriesContext's
 * TimeEntriesProvider does — and read it with useTimeEntries(). A second
 * mount is a second copy of the array writing the same storage key: the
 * lost-update bug this split exists to prevent.
 */
export function useTimeEntriesStore() {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [hydrated, setHydrated] = useState<boolean>(false);
  // Other people's shifts on this user's jobs (#28) — see the header.
  const [teamEntries, setTeamEntries] = useState<TeamTimeEntry[]>([]);
  const [teamHydrated, setTeamHydrated] = useState<boolean>(false);
  // Latest committed entries, for side effects (notifications, queued writes)
  // that must not run inside a setState updater — React may call an updater
  // twice, and each call would queue a second write and a second alert.
  const entriesRef = useRef<TimeEntry[]>(entries);
  entriesRef.current = entries;

  // Shift-end alert threshold (default 8h, user-configurable). When a
  // crew member crosses this on a single shift, a push notification
  // fires on the device that clocked them in. Persisted so it survives
  // app restarts.
  const [shiftAlertHours, setShiftAlertHoursState] = useState<number>(DEFAULT_SHIFT_ALERT_HOURS);
  // The stored threshold loads async. Reconciling before it lands would post
  // every alert at the default 8h and then have to redo them.
  const [alertHoursLoaded, setAlertHoursLoaded] = useState(false);
  const shiftAlertHoursRef = useRef(shiftAlertHours);
  shiftAlertHoursRef.current = shiftAlertHours;
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SHIFT_ALERT_HOURS_KEY).then(raw => {
      if (cancelled || !raw) return;
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0 && n <= 24) setShiftAlertHoursState(n);
    }).catch(() => {}).finally(() => { if (!cancelled) setAlertHoursLoaded(true); });
    return () => { cancelled = true; };
  }, []);
  const setShiftAlertHours = useCallback((hours: number) => {
    const clamped = Math.max(1, Math.min(24, hours));
    setShiftAlertHoursState(clamped);
    void AsyncStorage.setItem(SHIFT_ALERT_HOURS_KEY, String(clamped));
  }, []);

  // ── Shift-alert queue ────────────────────────────────────────────────
  // Every notification operation runs in order through one promise chain, so
  // a clock-in's schedule can't interleave with a reconcile's cancel-all and
  // be wiped (or doubled) by it.
  const alertChainRef = useRef<Promise<void>>(Promise.resolve());
  const enqueueAlertOp = useCallback((op: () => Promise<void>) => {
    alertChainRef.current = alertChainRef.current
      .then(op)
      .catch(err => { console.warn('[useTimeEntries] Shift-alert operation failed:', err); });
  }, []);
  const postShiftAlert = useCallback(async (entry: TimeEntry, fireAtMs: number) => {
    if (fireAtMs - Date.now() < SHIFT_ALERT_MIN_LEAD_MS) return;
    const hours = shiftAlertHoursRef.current;
    await scheduleLocalNotificationAt({
      title: `${entry.workerName} reached ${hours}h`,
      body: `Time to clock ${entry.workerName.split(' ')[0]} out for the day.`,
      fireAt: new Date(fireAtMs),
      data: { kind: SHIFT_ALERT_KIND, entryId: entry.id },
    });
  }, []);
  const cancelAlertsForEntry = useCallback(async (entryId: string) => {
    const ids = shiftAlertIdsForEntry(await listScheduledShiftAlerts(), entryId);
    for (const id of ids) await cancelScheduledNotification(id);
  }, []);
  /** Replace whatever is queued for this entry with one alert at fireAtMs. */
  const rescheduleShiftAlert = useCallback((entry: TimeEntry, fireAtMs: number) => {
    enqueueAlertOp(async () => {
      await cancelAlertsForEntry(entry.id);
      await postShiftAlert(entry, fireAtMs);
    });
  }, [enqueueAlertOp, cancelAlertsForEntry, postShiftAlert]);
  const cancelShiftAlert = useCallback((entryId: string) => {
    enqueueAlertOp(() => cancelAlertsForEntry(entryId));
  }, [enqueueAlertOp, cancelAlertsForEntry]);

  // ── Hydrate from AsyncStorage on mount ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          // Merge rather than replace: anything written before hydration
          // finished (a voice log in the first second after launch) is newer
          // than the disk copy and must survive it.
          if (Array.isArray(parsed)) setEntries(prev => mergeById(parsed as TimeEntry[], prev));
        }
      } catch (err) {
        console.warn('[useTimeEntries] Failed to hydrate from storage:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // The team copy loads the same way. No merge needed: nothing writes it
  // before the first server pull, which runs after hydration.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(TIME_ENTRIES_TEAM_STORAGE_KEY)
      .then(raw => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setTeamEntries((parsed as TeamTimeEntry[]).map(teamRowForDevice));
      })
      .catch(err => { console.warn('[useTimeEntries] Failed to hydrate team hours:', err); })
      .finally(() => { if (!cancelled) setTeamHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  // Bumped whenever the entries may disagree with the OS alert queue: after
  // hydration, after a server pull, after an account switch.
  const [alertReconcileNonce, setAlertReconcileNonce] = useState(0);

  // ── Reset on user transition ───────────────────────────────────────
  // When the userId changes (sign out, sign in as different user), we MUST
  // clear local entries so user A's data doesn't leak into user B's session.
  // Without this guard, entries from the previous user stay in React state
  // AND get written back to AsyncStorage under the new session — a real
  // data-leak risk on shared/family devices. Tracked across renders via a
  // ref so we only react to actual transitions, not initial mount.
  //
  // "Initial" means once auth has RESOLVED. This store now mounts at app
  // launch, where user is null for the moment the session restore takes; the
  // null → user step that follows is not a switch, and treating it as one
  // wiped the device's un-synced clock-ins on every cold start.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (authLoading) return;
    const last = lastUserIdRef.current;
    // First resolved run: just record. No clearing.
    if (last === undefined) {
      lastUserIdRef.current = userId;
      return;
    }
    // Transition detected (last user ≠ current user, including null↔value)
    if (last !== userId) {
      lastUserIdRef.current = userId;
      setEntries([]);
      setTeamEntries([]);
      void AsyncStorage.removeItem(STORAGE_KEY);
      void AsyncStorage.removeItem(TIME_ENTRIES_TEAM_STORAGE_KEY);
      setAlertReconcileNonce(n => n + 1);
    }
  }, [userId, authLoading]);

  // ── Pull from Supabase once we have a session ──────────────────────
  // `pullNonce` lets a screen ask for a fresh pull (refresh()). With one
  // app-lifetime store, "pull on mount" would otherwise mean once per launch,
  // where the per-screen hook used to re-pull every time Time Tracking opened.
  const [pullNonce, setPullNonce] = useState(0);
  const refresh = useCallback(() => setPullNonce(n => n + 1), []);
  // And on return to the foreground, at most every FOREGROUND_PULL_MIN_MS.
  // refresh()'s only caller is Time Tracking's mount, so without this the
  // TEAM hours a foreman logged today reached the GC's Job Costing / WIP /
  // margin screens only after a relaunch or a visit to Time Tracking — a
  // crew total a whole session stale (integration round 3). Throttled so
  // flipping between apps on site is not a pull per flip.
  const lastForegroundPullRef = useRef<number>(Date.now());
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      const now = Date.now();
      if (now - lastForegroundPullRef.current < FOREGROUND_PULL_MIN_MS) return;
      lastForegroundPullRef.current = now;
      setPullNonce(n => n + 1);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!hydrated || !userId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('time_entries')
          .select('*')
          .eq('user_id', userId)
          .order('clock_in', { ascending: false });
        if (cancelled) return;
        if (error) {
          console.warn('[useTimeEntries] Server fetch failed:', error.message);
          return;
        }
        const fromServer = (data as DBRow[] | null ?? []).map(fromDB);
        // Server wins on conflict — entries that exist server-side
        // override local-only versions of the same id. Local-only
        // entries (offline clock-ins not yet flushed) are preserved.
        setEntries(prev => mergeById(prev, fromServer));
        // A shift clocked out on another device is clocked out here now;
        // its alert on this device must go.
        setAlertReconcileNonce(n => n + 1);
      } catch (err) {
        console.warn('[useTimeEntries] Server fetch threw:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, userId, pullNonce]);

  // ── Pull the TEAM's hours on this user's jobs (#28) ─────────────────
  // time_entries_collab_select is `auth.uid() = user_id OR
  // can_access_project(project_id)`, so RLS already returns a foreman's rows
  // to the project owner (and nothing to an outsider). The scope is still
  // explicit — owned + editor/viewer projects (teamScopeProjectIds) — so a
  // field membership on someone else's job never feeds this user's costing.
  // A failed read keeps the last good copy rather than showing $0 labour.
  useEffect(() => {
    if (!hydrated || !teamHydrated || !userId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const [ownedRes, memberRes] = await Promise.all([
          supabase.from('projects').select('id').eq('user_id', userId),
          supabase.from('project_collaborators').select('project_id, role, status').eq('user_id', userId).eq('status', 'accepted'),
        ]);
        if (cancelled) return;
        if (ownedRes.error || memberRes.error) {
          console.warn('[useTimeEntries] Team scope read failed:', ownedRes.error?.message ?? memberRes.error?.message);
          return;
        }
        const scope = teamScopeProjectIds(
          (ownedRes.data ?? []) as { id: string }[],
          (memberRes.data ?? []) as { project_id: string; role: string; status?: string }[],
        );
        // Owned vs. seat, per row — see costingTeamRows.
        const ownedIds = new Set(((ownedRes.data ?? []) as { id: string }[]).map(p => String(p.id)));
        const team: TeamTimeEntry[] = [];
        // Paged (integration round 1): one unpaged read per chunk returned at
        // most max_rows, newest first, and REPLACED the team copy — once a
        // GC's jobs passed that many crew shifts the oldest hours dropped out
        // of job cost, WIP and OSHA hours without a word. A failure part-way
        // still keeps the last good copy (return before setTeamEntries).
        const seenIds = new Set<string>();
        for (let i = 0; i < scope.length; i += TEAM_IN_CHUNK) {
          const chunk = scope.slice(i, i + TEAM_IN_CHUNK);
          let from = 0;
          for (let page = 0; page < TEAM_MAX_PAGES; page++) {
            const { data, error } = await supabase
              .from('time_entries')
              .select(TEAM_TIME_ENTRY_COLUMNS)
              .neq('user_id', userId)
              .in('project_id', chunk)
              .order('clock_in', { ascending: false })
              // A unique tie-break so pages never overlap or skip rows that
              // share a clock_in.
              .order('id', { ascending: true })
              .range(from, from + TEAM_PAGE - 1);
            if (cancelled) return;
            if (error) {
              console.warn('[useTimeEntries] Team hours fetch failed:', error.message);
              return;
            }
            const rows = (data as DBRow[] | null) ?? [];
            if (rows.length === 0) break;
            for (const r of rows) {
              const id = String(r.id);
              if (seenIds.has(id)) continue;
              seenIds.add(id);
              team.push(teamRowForDevice({ ...fromDB(r), loggedByUserId: r.user_id, onOwnedProject: ownedIds.has(String(r.project_id)) }));
            }
            from += rows.length;
          }
        }
        setTeamEntries(team);
      } catch (err) {
        console.warn('[useTimeEntries] Team hours fetch threw:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, teamHydrated, userId, pullNonce]);

  useEffect(() => {
    if (!teamHydrated) return;
    let cancelled = false;
    AsyncStorage.setItem(TIME_ENTRIES_TEAM_STORAGE_KEY, JSON.stringify(teamEntries))
      .then(() => {
        if (!cancelled) void queryClient.invalidateQueries({ queryKey: TIME_ENTRIES_MIRROR_QUERY_KEY });
      })
      .catch(err => { console.warn('[useTimeEntries] Failed to persist team hours:', err); });
    return () => { cancelled = true; };
  }, [teamEntries, teamHydrated, queryClient]);

  // ── Persist to AsyncStorage on every change ────────────────────────
  // The persist effect handles writing on EVERY entries change including
  // the merge above. Pre-fix the merge inside the pull also wrote to
  // AsyncStorage, racing with this effect. Single writer here is cleaner —
  // and, since the store is mounted once, it is the ONLY writer of this key
  // in the app. Once the write lands, the mirror query job cost / WIP / the
  // budget dashboard read is invalidated so they re-read it.
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
      .then(() => {
        if (!cancelled) void queryClient.invalidateQueries({ queryKey: TIME_ENTRIES_MIRROR_QUERY_KEY });
      })
      .catch(err => { console.warn('[useTimeEntries] Failed to persist entries:', err); });
    return () => { cancelled = true; };
  }, [entries, hydrated, queryClient]);

  // ── Reconcile shift alerts with the OS queue ────────────────────────
  // Runs after hydration, after each server pull, on an account switch, and
  // when the threshold changes. It cancels every queued shift alert and
  // re-posts one per clocked-in shift — so an alert left queued by a killed
  // launch, an older build or a previous account is gone, and a relaunch
  // never adds a second.
  useEffect(() => {
    if (!hydrated || !alertHoursLoaded) return;
    enqueueAlertOp(async () => {
      const plan = planShiftAlertReconcile(
        await listScheduledShiftAlerts(), entriesRef.current, shiftAlertHoursRef.current, Date.now(),
      );
      for (const id of plan.cancel) await cancelScheduledNotification(id);
      for (const s of plan.schedule) await postShiftAlert(s.entry, s.fireAtMs);
    });
  }, [hydrated, alertHoursLoaded, alertReconcileNonce, shiftAlertHours, enqueueAlertOp, postShiftAlert]);

  // ── Mutators ──────────────────────────────────────────────────────
  const clockIn = useCallback((args: {
    projectId: string;
    projectName: string;
    workerId: string;
    workerName: string;
    trade?: string;
    notes?: string;
    gpsLat?: number;
    gpsLng?: number;
  }): TimeEntry => {
    const now = new Date();
    const entry: TimeEntry = {
      id: generateUUID(),
      projectId: args.projectId,
      projectName: args.projectName,
      workerId: args.workerId,
      workerName: args.workerName,
      trade: args.trade ?? '',
      clockIn: now.toISOString(),
      breakMinutes: 0,
      totalHours: 0,
      overtimeHours: 0,
      status: 'clocked_in',
      notes: args.notes,
      gpsLat: args.gpsLat,
      gpsLng: args.gpsLng,
      // The LOCAL day (field-ops #9). toISOString() named tomorrow for any
      // clock-in after ~5 pm Pacific. Readers use timeEntryDay() regardless.
      date: todayCalendarDay(now),
    };
    setEntries(prev => [entry, ...prev]);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('time_entries', 'insert', toDB(entry, userId));
    }
    // Schedule the shift-end alert. Fire at clockIn + threshold hours;
    // we re-schedule on resume-from-break to account for break time.
    rescheduleShiftAlert(entry, shiftAlertFireAtMs(entry, shiftAlertHoursRef.current));
    return entry;
  }, [userId, rescheduleShiftAlert]);

  const startBreak = useCallback((entryId: string) => {
    // Persist breakStartedAt on the row so cold-restart recovery works.
    // Pre-fix the timestamp lived in a useRef in the screen and was
    // lost on remount → resume always recorded zero minutes.
    const now = new Date().toISOString();
    setEntries(prev => prev.map(e =>
      e.id === entryId ? { ...e, status: 'break' as const, breakStartedAt: now } : e,
    ));
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('time_entries', 'update', {
        id: entryId, status: 'break', break_started_at: now,
      });
    }
    // Cancel the pending shift-alert. resumeFromBreak will re-schedule
    // it with an adjusted target time so the worker isn't penalized for
    // their break minutes.
    cancelShiftAlert(entryId);
  }, [userId, cancelShiftAlert]);

  /**
   * Resume from break. The hook computes the elapsed break minutes from
   * `breakStartedAt` on the row — caller doesn't need to track timestamps
   * itself. If breakStartedAt is somehow missing (legacy row, manual edit),
   * we fall back to the explicit `breakDurationMinutes` arg, then to 0.
   */
  const resumeFromBreak = useCallback((entryId: string, breakDurationMinutesFallback?: number) => {
    const e = entriesRef.current.find(x => x.id === entryId);
    if (!e) return;
    // Compute minutes from persisted timestamp first; fall back to arg.
    let elapsed = 0;
    if (e.breakStartedAt) {
      const ms = Date.now() - new Date(e.breakStartedAt).getTime();
      elapsed = Math.max(0, Math.round(ms / 60000));
    } else if (typeof breakDurationMinutesFallback === 'number') {
      elapsed = Math.max(0, breakDurationMinutesFallback);
    }
    const newBreakTotal = e.breakMinutes + elapsed;
    const updated: TimeEntry = {
      ...e,
      status: 'clocked_in',
      breakMinutes: newBreakTotal,
      breakStartedAt: undefined,
    };
    setEntries(prev => prev.map(x => x.id === entryId
      ? { ...x, status: 'clocked_in' as const, breakMinutes: newBreakTotal, breakStartedAt: undefined }
      : x));
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('time_entries', 'update', {
        id: e.id, status: 'clocked_in', break_minutes: newBreakTotal, break_started_at: null,
      });
    }
    // Re-schedule the shift-end alert. Fire time = clockIn + threshold +
    // accumulated break — so the worker effectively gets their break
    // minutes back. Off-by-a-minute is fine.
    rescheduleShiftAlert(updated, shiftAlertFireAtMs(updated, shiftAlertHoursRef.current));
  }, [userId, rescheduleShiftAlert]);

  const clockOut = useCallback((entryId: string) => {
    const now = new Date();
    const e = entriesRef.current.find(x => x.id === entryId);
    if (e) {
      const { totalHours, overtimeHours } = computeShiftHours(e.clockIn, now.toISOString(), e.breakMinutes);
      setEntries(prev => prev.map(x => x.id === entryId
        ? { ...x, status: 'clocked_out' as const, clockOut: now.toISOString(), totalHours, overtimeHours }
        : x));
      if (userId && isSupabaseConfigured) {
        void supabaseWrite('time_entries', 'update', {
          id: e.id,
          status: 'clocked_out',
          clock_out: now.toISOString(),
          total_hours: totalHours,
          overtime_hours: overtimeHours,
        });
      }
    }
    // Already clocked out — cancel any pending shift-end alert, whichever
    // mount or launch posted it.
    cancelShiftAlert(entryId);
  }, [userId, cancelShiftAlert]);

  const updateEntry = useCallback((entryId: string, patch: Partial<TimeEntry>) => {
    setEntries(prev => prev.map(e => e.id === entryId ? { ...e, ...patch } : e));
    if (userId && isSupabaseConfigured) {
      // Map camelCase patch fields back to snake_case for the DB.
      const dbPatch: Record<string, unknown> = { id: entryId };
      if (patch.notes !== undefined) dbPatch.notes = patch.notes ?? null;
      if (patch.breakMinutes !== undefined) dbPatch.break_minutes = patch.breakMinutes;
      if (patch.totalHours !== undefined) dbPatch.total_hours = patch.totalHours;
      if (patch.overtimeHours !== undefined) dbPatch.overtime_hours = patch.overtimeHours;
      if (patch.status !== undefined) dbPatch.status = patch.status;
      void supabaseWrite('time_entries', 'update', dbPatch);
    }
  }, [userId]);

  const deleteEntry = useCallback((entryId: string) => {
    setEntries(prev => prev.filter(e => e.id !== entryId));
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('time_entries', 'delete', { id: entryId });
    }
    // A deleted live shift must not still page the foreman.
    cancelShiftAlert(entryId);
  }, [userId, cancelShiftAlert]);

  // ── Derived views ─────────────────────────────────────────────────
  const liveEntries = useMemo(() => entries.filter(e => e.status !== 'clocked_out'), [entries]);
  const historyEntries = useMemo(() =>
    entries.filter(e => e.status === 'clocked_out')
      .sort((a, b) => timeEntryDay(b).localeCompare(timeEntryDay(a)) || b.clockIn.localeCompare(a.clockIn)),
    [entries]
  );

  // Log a COMPLETED shift in one shot (used by voice field-capture: "3 hours
  // framing"). Unlike clockIn/clockOut, this records a finished entry with a
  // known duration — clockIn defaults to 8:00 on the given day, clockOut is
  // clockIn + hours, and totals are computed the same way the live flow does.
  const addManualEntry = useCallback((args: {
    projectId: string;
    projectName: string;
    workerName: string;
    trade?: string;
    hours: number;
    notes?: string;
    date?: string;
  }): TimeEntry => {
    // Local day (field-ops #9): the UTC day turned "2 hours punch" said at
    // 6 pm Friday into a Saturday 8 am shift.
    const day = args.date ?? todayCalendarDay();
    const clockInDate = new Date(`${day}T08:00:00`);
    const clockOutDate = new Date(clockInDate.getTime() + Math.max(args.hours, 0) * 3_600_000);
    const { totalHours, overtimeHours } = computeShiftHours(
      clockInDate.toISOString(), clockOutDate.toISOString(), 0,
    );
    const entry: TimeEntry = {
      id: generateUUID(),
      projectId: args.projectId,
      projectName: args.projectName,
      workerId: 'self',
      workerName: args.workerName,
      trade: args.trade ?? '',
      clockIn: clockInDate.toISOString(),
      clockOut: clockOutDate.toISOString(),
      breakMinutes: 0,
      totalHours,
      overtimeHours,
      status: 'clocked_out',
      notes: args.notes,
      date: day,
    };
    setEntries(prev => [entry, ...prev]);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('time_entries', 'insert', toDB(entry, userId));
    }
    return entry;
  }, [userId]);

  return useMemo(() => ({
    entries,
    /** Read-only: other people's shifts on this user's jobs (#28). */
    teamEntries,
    liveEntries,
    historyEntries,
    hydrated,
    refresh,
    clockIn,
    addManualEntry,
    startBreak,
    resumeFromBreak,
    clockOut,
    updateEntry,
    deleteEntry,
    shiftAlertHours,
    setShiftAlertHours,
  }), [
    entries, teamEntries, liveEntries, historyEntries, hydrated, refresh, clockIn, addManualEntry, startBreak,
    resumeFromBreak, clockOut, updateEntry, deleteEntry, shiftAlertHours, setShiftAlertHours,
  ]);
}

export type TimeEntriesStore = ReturnType<typeof useTimeEntriesStore>;

/** The one store's React context. Provided by contexts/TimeEntriesContext;
 *  lives here (not there) so this module never imports the context module and
 *  the two can't form an import cycle. */
export const TimeEntriesStoreContext = createContext<TimeEntriesStore | null>(null);

/**
 * Read the app's single time-entry store. Same return shape the per-mount hook
 * had, plus refresh(). Throws outside TimeEntriesProvider rather than quietly
 * creating a private copy — a private copy is exactly the bug.
 */
export function useTimeEntries(): TimeEntriesStore {
  const store = useContext(TimeEntriesStoreContext);
  if (!store) {
    throw new Error('useTimeEntries() must be used inside <TimeEntriesProvider> (contexts/TimeEntriesContext).');
  }
  return store;
}

/**
 * Build a CSV payload of time entries for payroll export. Columns match
 * what QuickBooks and Sage payroll modules typically expect:
 *   Date, Worker, Trade, Project, Clock In, Clock Out, Break (min),
 *   Hours, Overtime, Notes
 *
 * Date is the local day the shift was worked (timeEntryDay) and the clock
 * columns are local wall-clock times — the device's time zone, which is the
 * jobsite's for the foreman who punched them.
 *
 * Returns the CSV string ready to be written to disk or copied to
 * clipboard. Caller decides delivery (Share sheet, email attachment).
 */
export function buildTimeEntriesCSV(entries: TimeEntry[]): string {
  const escape = (v: string | undefined): string => {
    if (!v) return '';
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  };
  const header = ['Date', 'Worker', 'Trade', 'Project', 'Clock In', 'Clock Out', 'Break (min)', 'Hours', 'Overtime', 'Notes'].join(',');
  const rows = entries.map(e => [
    escape(timeEntryDay(e)),
    escape(e.workerName),
    escape(e.trade),
    escape(e.projectName),
    escape(formatClockForCsv(e.clockIn)),
    escape(formatClockForCsv(e.clockOut)),
    String(e.breakMinutes),
    e.totalHours.toFixed(2),
    e.overtimeHours.toFixed(2),
    escape(e.notes),
  ].join(','));
  return [header, ...rows].join('\n');
}
