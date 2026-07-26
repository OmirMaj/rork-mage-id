// utils/weekClose/types.ts
//
// Shared types for the Friday Close week-close ritual surface.
// Zero React, Zero network — pure data shapes + one pure date helper.

import { localDateISO, type BriefItem, type BriefRoute, type BriefSeverity } from '@/utils/brief/composeBrief';

// Re-export so consumers only need to import from this file.
export type { BriefItem, BriefRoute, BriefSeverity };

// ─── Week-close leg ───────────────────────────────────────────────────────────

export type WeekCloseLegId = 'bill' | 'chase' | 'close' | 'commit' | 'clients';

export interface WeekCloseLeg {
  /** Stable identifier for the leg. */
  id: WeekCloseLegId;
  /** Display title shown in the week-close screen. */
  title: string;
  /** Deep-link rows. Empty = leg has nothing to show this week (still rendered
   *  with an honest "nothing here" line in the UI). */
  items: BriefItem[];
}

// ─── Week-close output ────────────────────────────────────────────────────────

export interface WeekClose {
  /** Local calendar date (YYYY-MM-DD) the close was composed for. */
  dateISO: string;
  /** Five legs, always present, always in bill→chase→close→commit→clients order. */
  legs: WeekCloseLeg[];
  /**
   * True when no leg carries OPEN WORK (no unbilled > $500, no overdue
   * invoices, no WWP PPC computable, no lookahead tasks, no unsent client
   * items). Items flagged `informational` (evergreen reminders/notices) do
   * not count — a close with only those still shows the honest quiet line
   * instead of inflating noise (G10).
   */
  allQuiet: boolean;
}

/** AsyncStorage key holding the LOCAL date (YYYY-MM-DD) the week-close modal
 *  was last opened/dismissed. Registered in LOCAL_USER_CACHE_KEYS (F0). */
export const WEEK_CLOSE_LAST_SEEN_KEY = 'mageid_week_close_last_seen';

/**
 * The ONE definition of "today" for WEEK_CLOSE_LAST_SEEN_KEY — the LOCAL
 * calendar date. Every writer (week-close.tsx mount/markDone) and reader
 * (WeekCloseCard's same-ISO-week check) must use this helper: a UTC stamp
 * (`toISOString().slice(0,10)`) is already MONDAY of the next ISO week on
 * Sunday evenings in the Americas, which would suppress the following week's
 * card entirely.
 */
export function weekCloseTodayISO(now: Date = new Date()): string {
  return localDateISO(now);
}
