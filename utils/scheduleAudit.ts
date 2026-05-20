// scheduleAudit — append-only log of every schedule mutation.
//
// Closes the gap that P6's audit famously misses: dependency / logic
// changes. Every CPM-affecting edit lands here with timestamp + user +
// before/after. Bounded at 500 entries on the project; older entries
// roll off (FIFO).
//
// Storage: AsyncStorage (key `tertiary_schedule_audit::<projectId>`).
// The Settings → Schedule audit viewer reads from here.
//
// The field `ProjectSchedule.auditLog` used to exist for "ride-with-
// the-schedule" persistence, but nothing ever populated it and v2.1
// removed it. AsyncStorage is the sole storage path now; cap at 500
// entries via FIFO trim.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScheduleAuditEntry } from '@/types';

const STORAGE_KEY_PREFIX = 'tertiary_schedule_audit::';
const MAX_ENTRIES = 500;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function buildAuditEntry(
  partial: Omit<ScheduleAuditEntry, 'id' | 'at'>,
): ScheduleAuditEntry {
  return { ...partial, id: generateId(), at: new Date().toISOString() };
}

/**
 * Append an entry to a schedule's existing audit log, capped at
 * MAX_ENTRIES (FIFO eviction). Returns the new array — caller persists
 * via updateProject. Pure function; no side effects.
 */
export function appendAuditEntry(
  existing: ScheduleAuditEntry[] | undefined,
  partial: Omit<ScheduleAuditEntry, 'id' | 'at'>,
): ScheduleAuditEntry[] {
  const entry = buildAuditEntry(partial);
  const next = [entry, ...(existing ?? [])].slice(0, MAX_ENTRIES);
  return next;
}

/**
 * Diff helper: given a "before" task and an "after" task, return a
 * brief one-line summary describing what changed. Used by the audit
 * UI so a row says "Drywall: duration 5d → 7d, started" rather than
 * dumping the whole task object.
 */
export function summarizeTaskDiff(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
): string {
  if (!before || !after) return 'edited';
  const parts: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (before[k] === after[k]) continue;
    if (k === 'progress') parts.push(`progress ${before[k] ?? 0}% → ${after[k] ?? 0}%`);
    else if (k === 'durationDays') parts.push(`duration ${before[k]}d → ${after[k]}d`);
    else if (k === 'startDay') parts.push(`start day ${before[k]} → ${after[k]}`);
    else if (k === 'crew') parts.push(`crew → ${after[k] || '(none)'}`);
    else if (k === 'status') parts.push(`status → ${after[k]}`);
    else if (k === 'dependencies') parts.push('dependencies changed');
    else parts.push(`${k} changed`);
  }
  return parts.length === 0 ? 'edited' : parts.join(' · ');
}

// ─────────────────────────────────────────────
// AsyncStorage side-channel
// ─────────────────────────────────────────────

function asyncKey(projectId: string): string {
  return `${STORAGE_KEY_PREFIX}${projectId}`;
}

export async function loadAuditFromAsyncStorage(projectId: string): Promise<ScheduleAuditEntry[]> {
  if (!projectId) return [];
  try {
    const raw = await AsyncStorage.getItem(asyncKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ScheduleAuditEntry[]) : [];
  } catch { return []; }
}

export async function appendAuditToAsyncStorage(
  projectId: string,
  entry: ScheduleAuditEntry,
): Promise<void> {
  if (!projectId) return;
  try {
    const existing = await loadAuditFromAsyncStorage(projectId);
    const next = [entry, ...existing].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(asyncKey(projectId), JSON.stringify(next));
  } catch (e) { console.log('[audit] async save failed', e); }
}

/** UI helper — group entries by day for the audit viewer. */
export function groupAuditByDay(entries: ScheduleAuditEntry[]): { day: string; entries: ScheduleAuditEntry[] }[] {
  const map = new Map<string, ScheduleAuditEntry[]>();
  for (const e of entries) {
    const day = e.at.split('T')[0];
    const arr = map.get(day) ?? [];
    arr.push(e);
    map.set(day, arr);
  }
  return Array.from(map.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, entries]) => ({ day, entries }));
}
