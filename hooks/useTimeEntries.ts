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
// The hook intentionally does NOT live in ProjectContext because time
// entries cross projects (one worker, multiple projects in a day) and
// the existing context shape is already heavy. Lift to a context if a
// second screen ever needs the data.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import { scheduleLocalNotificationAt, cancelScheduledNotification } from '@/utils/notifications';
import type { TimeEntry, TimeEntryStatus } from '@/types';

/** Exported for the read-only labor-samples bridge (hooks/useLaborRates.ts
 *  useLaborCostSamples) so the mirror key never drifts between the two. */
export const TIME_ENTRIES_STORAGE_KEY = 'mageid_time_entries';
const STORAGE_KEY = TIME_ENTRIES_STORAGE_KEY;
const SHIFT_ALERT_HOURS_KEY = 'mageid_shift_alert_hours';
const DEFAULT_SHIFT_ALERT_HOURS = 8;
const SHIFT_ALERT_NOTIF_PREFIX = 'shift-alert:';

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

export function useTimeEntries() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [hydrated, setHydrated] = useState<boolean>(false);

  // Shift-end alert threshold (default 8h, user-configurable). When a
  // crew member crosses this on a single shift, a push notification
  // fires on the device that clocked them in. Persisted so it survives
  // app restarts.
  const [shiftAlertHours, setShiftAlertHoursState] = useState<number>(DEFAULT_SHIFT_ALERT_HOURS);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SHIFT_ALERT_HOURS_KEY).then(raw => {
      if (cancelled || !raw) return;
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0 && n <= 24) setShiftAlertHoursState(n);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const setShiftAlertHours = useCallback((hours: number) => {
    const clamped = Math.max(1, Math.min(24, hours));
    setShiftAlertHoursState(clamped);
    void AsyncStorage.setItem(SHIFT_ALERT_HOURS_KEY, String(clamped));
  }, []);

  // Map of entryId → OS notification id, so we can cancel a pending
  // alert when a crew member clocks out / goes on break before the
  // threshold fires. Kept in a ref because it's purely side-effect
  // bookkeeping and shouldn't trigger renders.
  const scheduledAlertIdsRef = useRef<Record<string, string | null>>({});
  const scheduleShiftAlert = useCallback(async (entry: TimeEntry, fireAtMs: number) => {
    // Don't schedule a notification for a moment in the past or for a
    // shift that's already over the threshold — the OS rejects past
    // triggers and a 0-second notification is just noise.
    const msUntil = fireAtMs - Date.now();
    if (msUntil < 30_000) return; // < 30s: skip; the user will see the in-app banner instead
    const id = await scheduleLocalNotificationAt({
      title: `${entry.workerName} reached ${shiftAlertHours}h`,
      body: `Time to clock ${entry.workerName.split(' ')[0]} out for the day.`,
      fireAt: new Date(fireAtMs),
      data: { kind: 'shift_alert', entryId: entry.id },
    });
    scheduledAlertIdsRef.current[entry.id] = id;
  }, [shiftAlertHours]);
  const cancelShiftAlert = useCallback(async (entryId: string) => {
    const id = scheduledAlertIdsRef.current[entryId];
    if (id) {
      await cancelScheduledNotification(id);
      scheduledAlertIdsRef.current[entryId] = null;
    }
  }, []);

  // ── Hydrate from AsyncStorage on mount ─────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          setEntries(JSON.parse(raw) as TimeEntry[]);
        }
      } catch (err) {
        console.warn('[useTimeEntries] Failed to hydrate from storage:', err);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Reset on user transition ───────────────────────────────────────
  // When the userId changes (sign out, sign in as different user), we MUST
  // clear local entries so user A's data doesn't leak into user B's session.
  // Without this guard, entries from the previous user stay in React state
  // AND get written back to AsyncStorage under the new session — a real
  // data-leak risk on shared/family devices. Tracked across renders via a
  // ref so we only react to actual transitions, not initial mount.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const last = lastUserIdRef.current;
    // First run: just record. No clearing on initial mount.
    if (last === undefined) {
      lastUserIdRef.current = userId;
      return;
    }
    // Transition detected (last user ≠ current user, including null↔value)
    if (last !== userId) {
      lastUserIdRef.current = userId;
      setEntries([]);
      void AsyncStorage.removeItem(STORAGE_KEY);
    }
  }, [userId]);

  // ── Pull from Supabase once we have a session ──────────────────────
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
        setEntries(prev => {
          const byId = new Map<string, TimeEntry>();
          prev.forEach(e => byId.set(e.id, e));
          fromServer.forEach(e => byId.set(e.id, e));
          return Array.from(byId.values());
        });
      } catch (err) {
        console.warn('[useTimeEntries] Server fetch threw:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, userId]);

  // ── Persist to AsyncStorage on every change ────────────────────────
  // The persist effect handles writing on EVERY entries change including
  // the merge above. Pre-fix the merge inside the pull also wrote to
  // AsyncStorage, racing with this effect. Single writer here is cleaner.
  useEffect(() => {
    if (!hydrated) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries, hydrated]);

  // ── Restore pending shift alerts after app restart ──────────────────
  // OS notification queues survive a reload, but our ref-based id map
  // doesn't. On hydrate, walk every still-clocked-in entry and (re)post
  // its alert. Older expo-notifications scheduled before the reload will
  // also fire if they were never canceled — the OS dedupes by content
  // sometimes, but worst case the user sees the same alert twice for a
  // forgotten-to-clock-out shift. Acceptable; better than missing it.
  const reschedRanRef = useRef(false);
  useEffect(() => {
    if (!hydrated || reschedRanRef.current) return;
    reschedRanRef.current = true;
    const live = entries.filter(e => e.status === 'clocked_in' || e.status === 'break');
    for (const e of live) {
      if (e.status === 'break') continue; // alert resumes when they come back
      const fireAtMs = new Date(e.clockIn).getTime()
        + shiftAlertHours * 3_600_000
        + e.breakMinutes * 60_000;
      void scheduleShiftAlert(e, fireAtMs);
    }
  }, [hydrated, entries, shiftAlertHours, scheduleShiftAlert]);

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
      date: now.toISOString().split('T')[0],
    };
    setEntries(prev => [entry, ...prev]);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('time_entries', 'insert', toDB(entry, userId));
    }
    // Schedule the shift-end alert. Fire at clockIn + threshold hours;
    // we re-schedule on resume-from-break to account for break time.
    void scheduleShiftAlert(entry, now.getTime() + shiftAlertHours * 3_600_000);
    return entry;
  }, [userId, scheduleShiftAlert, shiftAlertHours]);

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
    void cancelShiftAlert(entryId);
  }, [userId, cancelShiftAlert]);

  /**
   * Resume from break. The hook computes the elapsed break minutes from
   * `breakStartedAt` on the row — caller doesn't need to track timestamps
   * itself. If breakStartedAt is somehow missing (legacy row, manual edit),
   * we fall back to the explicit `breakDurationMinutes` arg, then to 0.
   */
  const resumeFromBreak = useCallback((entryId: string, breakDurationMinutesFallback?: number) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      // Compute minutes from persisted timestamp first; fall back to arg.
      let elapsed = 0;
      if (e.breakStartedAt) {
        const ms = Date.now() - new Date(e.breakStartedAt).getTime();
        elapsed = Math.max(0, Math.round(ms / 60000));
      } else if (typeof breakDurationMinutesFallback === 'number') {
        elapsed = Math.max(0, breakDurationMinutesFallback);
      }
      const newBreakTotal = e.breakMinutes + elapsed;
      const updated = {
        ...e,
        status: 'clocked_in' as const,
        breakMinutes: newBreakTotal,
        breakStartedAt: undefined,
      };
      if (userId && isSupabaseConfigured) {
        void supabaseWrite('time_entries', 'update', {
          id: e.id, status: 'clocked_in', break_minutes: newBreakTotal, break_started_at: null,
        });
      }
      // Re-schedule the shift-end alert. Fire time = clockIn + threshold +
      // accumulated break — so the worker effectively gets their break
      // minutes back. Off-by-a-minute is fine.
      const fireAtMs = new Date(updated.clockIn).getTime()
        + shiftAlertHours * 3_600_000
        + newBreakTotal * 60_000;
      void scheduleShiftAlert(updated, fireAtMs);
      return updated;
    }));
  }, [userId, scheduleShiftAlert, shiftAlertHours]);

  const clockOut = useCallback((entryId: string) => {
    const now = new Date();
    setEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      const { totalHours, overtimeHours } = computeShiftHours(e.clockIn, now.toISOString(), e.breakMinutes);
      const updated: TimeEntry = {
        ...e,
        status: 'clocked_out',
        clockOut: now.toISOString(),
        totalHours,
        overtimeHours,
      };
      if (userId && isSupabaseConfigured) {
        void supabaseWrite('time_entries', 'update', {
          id: e.id,
          status: 'clocked_out',
          clock_out: now.toISOString(),
          total_hours: totalHours,
          overtime_hours: overtimeHours,
        });
      }
      return updated;
    }));
    // Already clocked out — cancel any pending shift-end alert.
    void cancelShiftAlert(entryId);
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
  }, [userId]);

  // ── Derived views ─────────────────────────────────────────────────
  const liveEntries = useMemo(() => entries.filter(e => e.status !== 'clocked_out'), [entries]);
  const historyEntries = useMemo(() =>
    entries.filter(e => e.status === 'clocked_out')
      .sort((a, b) => b.date.localeCompare(a.date) || b.clockIn.localeCompare(a.clockIn)),
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
    const day = args.date ?? new Date().toISOString().split('T')[0];
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

  return {
    entries,
    liveEntries,
    historyEntries,
    hydrated,
    clockIn,
    addManualEntry,
    startBreak,
    resumeFromBreak,
    clockOut,
    updateEntry,
    deleteEntry,
    shiftAlertHours,
    setShiftAlertHours,
  };
}

/**
 * Build a CSV payload of time entries for payroll export. Columns match
 * what QuickBooks and Sage payroll modules typically expect:
 *   Date, Worker, Trade, Project, Clock In, Clock Out, Break (min),
 *   Hours, Overtime, Notes
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
    escape(e.date),
    escape(e.workerName),
    escape(e.trade),
    escape(e.projectName),
    escape(e.clockIn),
    escape(e.clockOut ?? ''),
    String(e.breakMinutes),
    e.totalHours.toFixed(2),
    e.overtimeHours.toFixed(2),
    escape(e.notes),
  ].join(','));
  return [header, ...rows].join('\n');
}
