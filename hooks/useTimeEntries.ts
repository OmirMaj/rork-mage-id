// useTimeEntries — real backend for the Crew Time Tracking screen.
//
// Pre-audit (May 2026), `app/time-tracking.tsx` was MOCK_TIME_ENTRIES +
// local React state. Clock-ins didn't persist past navigation. This hook
// replaces the mock with a Supabase-backed CRUD that mirrors the same
// offline-queue + AsyncStorage pattern used for invoices, change orders,
// and daily reports.
//
// Storage flow:
//  - Local source of truth: AsyncStorage `tertiary_time_entries` keyed by
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

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import type { TimeEntry, TimeEntryStatus } from '@/types';

const STORAGE_KEY = 'tertiary_time_entries';

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
          const merged = Array.from(byId.values());
          // Persist merged view back to AsyncStorage.
          void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          return merged;
        });
      } catch (err) {
        console.warn('[useTimeEntries] Server fetch threw:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [hydrated, userId]);

  // ── Persist to AsyncStorage on every change ────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }, [entries, hydrated]);

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
    return entry;
  }, [userId]);

  const startBreak = useCallback((entryId: string) => {
    setEntries(prev => prev.map(e =>
      e.id === entryId ? { ...e, status: 'break' as const } : e,
    ));
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('time_entries', 'update', { id: entryId, status: 'break' });
    }
  }, [userId]);

  const resumeFromBreak = useCallback((entryId: string, breakDurationMinutes: number) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== entryId) return e;
      const newBreakTotal = e.breakMinutes + Math.max(0, breakDurationMinutes);
      const updated = { ...e, status: 'clocked_in' as const, breakMinutes: newBreakTotal };
      if (userId && isSupabaseConfigured) {
        void supabaseWrite('time_entries', 'update', {
          id: e.id, status: 'clocked_in', break_minutes: newBreakTotal,
        });
      }
      return updated;
    }));
  }, [userId]);

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
  }, [userId]);

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

  return {
    entries,
    liveEntries,
    historyEntries,
    hydrated,
    clockIn,
    startBreak,
    resumeFromBreak,
    clockOut,
    updateEntry,
    deleteEntry,
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
