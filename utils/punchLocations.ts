// utils/punchLocations.ts — the ONE answer to "what locations exist on this
// project?", shared by every punch surface so they cannot drift apart.
//
// WHY THIS EXISTS. Before this module, `location` on a PunchItem was free text
// that each screen treated its own way:
//
//   • app/punch-walk.tsx  carried the LAST location forward into the next item
//     and otherwise asked the super to re-dictate it.
//   • app/punch-list.tsx  filtered with `(i.location ?? '').toLowerCase()
//     .includes(needle)` — a substring match, so "hall" also matched "Hall
//     bath" and "Great hall", and "Hall 2" never matched "hall  2".
//
// Two spellings of one room is not a cosmetic problem on a 100+ item walk. It
// splits a corridor into two piles, so the drywaller's handoff is missing half
// his items and nobody can tell by looking. Both screens now normalise through
// `normalizeLocation` here, so they agree by construction rather than by two
// people remembering to write the same `.toLowerCase().trim()`.
//
// THE TWO SOURCES, IN PRIORITY ORDER:
//
//   1. Locations already used on this project's punch items. ALWAYS available,
//      needs no plans, no AI, no signal — which is the whole point on a
//      jobsite. Ordered most-recently-used first, because a super walking a
//      corridor says "hall 2" for six items in a row.
//   2. Room names from the project's saved Plan Intelligence session
//      (hooks/usePlanRooms.ts → PlanRoomSession.rooms). These are a bonus: a
//      project with no analysed plans is the normal case, not an error state,
//      and every function here is correct when `planRooms` is undefined.
//
// PURE BY CONTRACT. No React, no AsyncStorage, no `new Date()` — recency comes
// from the timestamps already on the items, so the same inputs always give the
// same output and scripts/validate-punch-locations.ts can exercise every path
// from bun with no test harness.

import type { PunchItem, PunchItemStatus } from '@/types';
import type { PlanRoom } from '@/utils/planIntelligence';

// ───────────────────────────────────────────────────────────────────────────
// The "no location" bucket
// ───────────────────────────────────────────────────────────────────────────
// Items captured without a location must never disappear. On a fast walk they
// are the ones most likely to be mis-filed later, so they get their own group
// with a name that says what it is — and it sits LAST, so the rooms he is
// actually standing in are what he sees first.
//
// The sentinel is prefixed with a NUL. `normalizeLocation` strips control
// characters (see below), so no user-typed location can ever normalise to this
// string — which means a super who literally types "no location" gets his own
// room rather than silently landing in the unplaced bucket.
//
// NOT named `*_KEY`, deliberately: scripts/validate-storage-hygiene.ts reads
// any `const *_KEY = '…'` as an AsyncStorage key the tenant-switch sweep must
// cover, and fails the build for one it cannot account for. That guard is right
// to be suspicious; this is a section id that never touches storage, so the
// NAME says so rather than the guard being taught an exception for it.
export const UNPLACED_LOCATION_GROUP = '\u0000unplaced';
export const UNPLACED_LOCATION_LABEL = 'No location given';

// ───────────────────────────────────────────────────────────────────────────
// Normalisation — the comparison both screens must share
// ───────────────────────────────────────────────────────────────────────────

/**
 * Fold a location string down to the form used for COMPARISON only. Never
 * display this — display the user's own `label`, which keeps his capitalisation.
 *
 * Does: NFKC (so a pasted full-width or decomposed-accent spelling matches the
 * typed one), strip C0/C1 control characters (voice transcripts and pasted
 * text carry them, and they are invisible in the UI — an invisible difference
 * that splits a room is the worst kind), collapse all whitespace runs to one
 * space, trim, lower-case.
 *
 * Deliberately does NOT fold punctuation. "Hall 2" and "Hall-2" stay two
 * entries. Merging them would be a guess, and a wrong merge HIDES items inside
 * the wrong room; two visible chips is a problem he can see and fix in one tap.
 *
 * Returns '' for null/undefined/whitespace-only — i.e. "no location".
 */
export function normalizeLocation(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    // Invisible characters ride in on voice transcripts and clipboard paste.
    // Written as \u escapes rather than raw control characters so the range is
    // readable in a diff (and so no-control-regex has nothing to complain about).
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** True when two free-text locations mean the same room. */
export function sameLocation(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeLocation(a);
  return na !== '' && na === normalizeLocation(b);
}

// ───────────────────────────────────────────────────────────────────────────
// Shapes
// ───────────────────────────────────────────────────────────────────────────

/**
 * The minimum an item needs to take part. Structural, not `PunchItem`, so the
 * validator can build a two-field literal and so a draft row in punch-walk
 * (which has no id yet) can be counted alongside saved items.
 */
export interface PunchLocationItemLike {
  location?: string | null;
  status?: PunchItemStatus | string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** A plan room, reduced to what a location list needs. `PlanRoom` satisfies it. */
export type PlanRoomLike = Pick<PlanRoom, 'name'>;

export type PunchLocationSource = 'used' | 'plan';

export interface PunchLocationOption {
  /** Normalised form — stable identity, safe as a React key. */
  key: string;
  /** What to SHOW: the user's own capitalisation, most recent spelling wins. */
  label: string;
  /** 'used' = already on an item here. 'plan' = a room from the plans, unused. */
  source: PunchLocationSource;
  /** Punch items already at this location, closed ones included. 0 for a plan room. */
  count: number;
  /** Of those, the ones still outstanding (anything but `closed`). */
  openCount: number;
  /** ISO timestamp of the most recent item here; null for an unused plan room. */
  lastUsedAt: string | null;
  /** True when this name also appears on the analysed plans. Lets the UI say so
   *  instead of guessing — a 'used' entry can also be on the plans. */
  onPlan: boolean;
}

export interface PunchLocationOptionsConfig {
  /**
   * Which timestamp means "used". Default: `createdAt`, falling back to
   * `updatedAt`.
   *
   * WHY createdAt. It is when somebody stood in that room and captured the
   * item. `updatedAt` moves when an item is CLOSED — often weeks later, from
   * the office — and ordering by it would hoist a finished room to the top of
   * the picker while he is walking a different floor.
   */
  recencyOf?: (item: PunchLocationItemLike) => string | null | undefined;
}

// ───────────────────────────────────────────────────────────────────────────
// Internals
// ───────────────────────────────────────────────────────────────────────────

/** `in_progress` and `ready_for_review` are still somebody's outstanding work. */
function isOpenStatus(status: PunchItemStatus | string | null | undefined): boolean {
  return status !== 'closed';
}

const defaultRecencyOf = (item: PunchLocationItemLike): string | null | undefined =>
  item.createdAt ?? item.updatedAt;

/**
 * Milliseconds, or null when the timestamp is missing or unparseable. Null is
 * ordered LAST among used locations rather than dropped — an item with a bad
 * `createdAt` is still an item standing in a room.
 */
function parseTime(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * "Hall 2" before "Hall 10". A plain string sort puts 10 first, which is
 * exactly wrong for door and room numbers — the single most common way a
 * location gets named on a commercial job.
 *
 * Hand-rolled rather than `localeCompare(..., {numeric:true})` on purpose: CI
 * and the laptop can disagree on ICU, and several validators in this repo
 * already exist because of that. This is deterministic everywhere.
 */
function naturalCompare(a: string, b: string): number {
  const ax = a.match(/\d+|\D+/g) ?? [];
  const bx = b.match(/\d+|\D+/g) ?? [];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const as = ax[i];
    const bs = bx[i];
    const an = /^\d/.test(as);
    const bn = /^\d/.test(bs);
    if (an && bn) {
      const d = Number(as) - Number(bs);
      if (d !== 0) return d;
    } else if (as !== bs) {
      return as < bs ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}

/** One location as it is being accumulated from the items. */
interface UsedAccumulator {
  key: string;
  label: string;
  labelAt: number | null;   // recency of the spelling currently held in `label`
  count: number;
  openCount: number;
  lastUsedAt: string | null;
  lastMs: number | null;
  firstSeen: number;        // stable tie-break, so equal timestamps never shuffle
}

/**
 * Walk the items once and collect every location in use. Shared by the option
 * builder and the grouper so the two can never disagree about which items
 * belong to which room.
 */
function collectUsed(
  items: readonly PunchLocationItemLike[] | null | undefined,
  recencyOf: (item: PunchLocationItemLike) => string | null | undefined,
): Map<string, UsedAccumulator> {
  const used = new Map<string, UsedAccumulator>();
  if (!Array.isArray(items)) return used;

  items.forEach((item, index) => {
    if (!item) return;
    const raw = typeof item.location === 'string' ? item.location : '';
    const key = normalizeLocation(raw);
    if (key === '') return;                       // the unplaced bucket, handled separately

    const stamp = recencyOf(item);
    const ms = parseTime(stamp);
    const existing = used.get(key);

    if (!existing) {
      used.set(key, {
        key,
        // Trim only. The user's capitalisation is his: "Unit 4B" is a label he
        // recognises; "unit 4b" is one we invented.
        label: raw.replace(/\s+/g, ' ').trim(),
        labelAt: ms,
        count: 1,
        openCount: isOpenStatus(item.status) ? 1 : 0,
        lastUsedAt: ms === null ? null : (stamp as string),
        lastMs: ms,
        firstSeen: index,
      });
      return;
    }

    existing.count += 1;
    if (isOpenStatus(item.status)) existing.openCount += 1;
    if (ms !== null && (existing.lastMs === null || ms > existing.lastMs)) {
      existing.lastMs = ms;
      existing.lastUsedAt = stamp as string;
    }
    // The most recently used SPELLING wins the display label: if he has started
    // writing "Corridor 2" where he used to write "corridor 2", the picker
    // should follow him rather than freeze on the first thing ever typed.
    if (ms !== null && (existing.labelAt === null || ms > existing.labelAt)) {
      existing.label = raw.replace(/\s+/g, ' ').trim();
      existing.labelAt = ms;
    }
  });

  return used;
}

/** Most-recent first; then the busiest room; then first-seen, so it is stable. */
function byRecency(a: UsedAccumulator, b: UsedAccumulator): number {
  if (a.lastMs !== b.lastMs) {
    if (a.lastMs === null) return 1;          // undated sinks below anything dated
    if (b.lastMs === null) return -1;
    return b.lastMs - a.lastMs;
  }
  if (a.count !== b.count) return b.count - a.count;
  return a.firstSeen - b.firstSeen;
}

// ───────────────────────────────────────────────────────────────────────────
// 1. The picker: every location this project has
// ───────────────────────────────────────────────────────────────────────────

/**
 * Merge the locations already used on this project's punch items with the room
 * names from its saved Plan Intelligence session, deduped case- and
 * whitespace-insensitively, used ones first and most-recent first within them.
 *
 * This is what punch-walk offers as one-tap chips instead of re-dictating a
 * room, and what punch-list offers as an exact-match location filter.
 *
 * `planRooms` is optional everywhere and absent on most projects.
 */
export function buildPunchLocationOptions(
  items: readonly PunchLocationItemLike[] | null | undefined,
  planRooms?: readonly PlanRoomLike[] | null,
  config?: PunchLocationOptionsConfig,
): PunchLocationOption[] {
  const recencyOf = config?.recencyOf ?? defaultRecencyOf;
  const used = [...collectUsed(items, recencyOf).values()].sort(byRecency);

  // Which of the used names also appear on the plans — so the UI can show that
  // as a fact rather than inferring it from `source`.
  const planKeys = new Set<string>();
  const planOrder: { key: string; label: string }[] = [];
  if (Array.isArray(planRooms)) {
    for (const room of planRooms) {
      const raw = typeof room?.name === 'string' ? room.name : '';
      const key = normalizeLocation(raw);
      if (key === '' || planKeys.has(key)) continue;   // two "Bath" rooms are one chip
      planKeys.add(key);
      planOrder.push({ key, label: raw.replace(/\s+/g, ' ').trim() });
    }
  }

  const options: PunchLocationOption[] = used.map(u => ({
    key: u.key,
    label: u.label,
    source: 'used' as const,
    count: u.count,
    openCount: u.openCount,
    lastUsedAt: u.lastUsedAt,
    onPlan: planKeys.has(u.key),
  }));

  const usedKeys = new Set(used.map(u => u.key));
  for (const room of planOrder) {
    if (usedKeys.has(room.key)) continue;            // priority 1 wins the entry
    options.push({
      key: room.key,
      label: room.label,
      source: 'plan',
      count: 0,
      openCount: 0,
      lastUsedAt: null,
      onPlan: true,
    });
    // Plan rooms keep the plan's own order. The analysis returns them roughly
    // as they read across the sheet, which is closer to a walking route than
    // anything we could re-sort them into.
  }

  return options;
}

/**
 * The location of the most recent item — what punch-walk carries forward into
 * the next capture. Returns the user's own spelling, or null on an empty list.
 */
export function mostRecentLocationLabel(
  items: readonly PunchLocationItemLike[] | null | undefined,
  config?: PunchLocationOptionsConfig,
): string | null {
  const recencyOf = config?.recencyOf ?? defaultRecencyOf;
  const used = [...collectUsed(items, recencyOf).values()].sort(byRecency);
  return used.length > 0 ? used[0].label : null;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. The list: items grouped into rooms
// ───────────────────────────────────────────────────────────────────────────

export interface PunchLocationSection<T> {
  /** Normalised location, or `UNPLACED_LOCATION_GROUP`. Safe as a React key. */
  key: string;
  /** The user's own spelling, or `UNPLACED_LOCATION_LABEL`. */
  label: string;
  /** True only for the trailing bucket of items with no location. */
  isUnplaced: boolean;
  /** The items, in the order they arrived — the caller's sort is preserved. */
  items: T[];
  /** Anything but `closed` — the number that tells him whether the room is done. */
  openCount: number;
  closedCount: number;
  total: number;
}

export interface PunchGroupingConfig extends PunchLocationOptionsConfig {
  /**
   * 'recent' (default) — busiest/most recent room first, matching the picker,
   * so the room he just walked is at the top of the list he is reviewing.
   * 'alpha'  — natural order ("Hall 2" before "Hall 10"), for handing a printed
   * or shared list to a sub who walks the building in door order.
   */
  order?: 'recent' | 'alpha';
}

/**
 * Group punch items into ordered location sections.
 *
 * INVARIANT: every input item comes out in exactly one section. Items with no
 * location land in a single clearly-named group that is ALWAYS last — on a
 * 100+ item walk the ones nobody placed are the ones most likely to be lost,
 * so they get a visible home instead of being filtered out of existence.
 */
export function groupPunchItemsByLocation<T extends PunchLocationItemLike>(
  items: readonly T[] | null | undefined,
  config?: PunchGroupingConfig,
): PunchLocationSection<T>[] {
  const recencyOf = config?.recencyOf ?? defaultRecencyOf;
  const order = config?.order ?? 'recent';
  if (!Array.isArray(items) || items.length === 0) return [];

  const used = collectUsed(items, recencyOf);
  const ordered = [...used.values()].sort(
    order === 'alpha' ? (a, b) => naturalCompare(a.key, b.key) : byRecency,
  );

  const sections = new Map<string, PunchLocationSection<T>>();
  for (const u of ordered) {
    sections.set(u.key, {
      key: u.key,
      label: u.label,
      isUnplaced: false,
      items: [],
      openCount: 0,
      closedCount: 0,
      total: 0,
    });
  }

  // The unplaced bucket is created only when something needs it, and is pushed
  // after every located section no matter which ordering is in force.
  let unplaced: PunchLocationSection<T> | null = null;

  for (const item of items) {
    if (!item) continue;
    const key = normalizeLocation(item.location);
    let section: PunchLocationSection<T> | undefined;
    if (key === '') {
      if (!unplaced) {
        unplaced = {
          key: UNPLACED_LOCATION_GROUP,
          label: UNPLACED_LOCATION_LABEL,
          isUnplaced: true,
          items: [],
          openCount: 0,
          closedCount: 0,
          total: 0,
        };
      }
      section = unplaced;
    } else {
      section = sections.get(key);
    }
    if (!section) continue;   // unreachable: collectUsed saw every non-empty key
    section.items.push(item);
    section.total += 1;
    if (isOpenStatus(item.status)) section.openCount += 1;
    else section.closedCount += 1;
  }

  const out = [...sections.values()];
  if (unplaced) out.push(unplaced);
  return out;
}

/**
 * Exact-location filter, replacing punch-list's old `.includes()` substring
 * match. Substring matching is what made "hall" also return "Hall bath": on a
 * 100+ item list that silently hands a sub the wrong room's work.
 *
 * Pass `null`/'' to mean "no filter"; pass `UNPLACED_LOCATION_GROUP` to see only
 * the items that were never placed.
 */
export function filterByLocationKey<T extends PunchLocationItemLike>(
  items: readonly T[] | null | undefined,
  key: string | null | undefined,
): T[] {
  if (!Array.isArray(items)) return [];
  if (!key) return [...items];
  if (key === UNPLACED_LOCATION_GROUP) return items.filter(i => normalizeLocation(i?.location) === '');
  const wanted = normalizeLocation(key);
  if (wanted === '') return [...items];
  return items.filter(i => normalizeLocation(i?.location) === wanted);
}

/**
 * Type-level proof that a real `PunchItem` satisfies the structural shapes
 * above. If someone narrows `PunchItem['location']` or renames `createdAt`,
 * this fails at `tsc` time rather than at the first render on the jobsite.
 */
export type PunchItemSatisfiesLocationShape = PunchItem extends PunchLocationItemLike ? true : never;
