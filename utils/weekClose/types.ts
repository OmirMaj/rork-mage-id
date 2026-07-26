// utils/weekClose/types.ts
//
// Shared types for the Friday Close week-close ritual surface.
// Zero React, Zero network — pure data shapes.

import type { BriefItem, BriefRoute, BriefSeverity } from '@/utils/brief/composeBrief';

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
   * True when ALL five legs are empty (no unbilled > $500, no overdue invoices,
   * no WWP PPC computable, no lookahead tasks, no unsent client items).
   * Shows the honest quiet line instead of inflating noise (G10).
   */
  allQuiet: boolean;
}

/** AsyncStorage key holding the local date (YYYY-MM-DD) the week-close modal
 *  was last opened/dismissed. Registered in LOCAL_USER_CACHE_KEYS (F0). */
export const WEEK_CLOSE_LAST_SEEN_KEY = 'mageid_week_close_last_seen';
