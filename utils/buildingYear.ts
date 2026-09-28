// utils/buildingYear.ts — where a project's year built comes from (Bet 1).
//
// In order: (1) a year the GC entered for this project (device-local in this
// slice, AsyncStorage key BUILDING_YEAR_KEY); (2) else, NYC only, PLUTO's
// yearBuilt from the building record once hooks/useBuildingRecord is in phase
// 'ready' with a record (which may be the on-disk copy); (3) else none.
// Entered wins over PLUTO; the chip then shows both.
//
// Pure — no React, no storage, no network. The hook
// (hooks/useBuildingYear.ts) owns the reads and writes; this file parses what
// it reads so a malformed value can never throw.
import type { BuildingRecord, MdBuildingRecord } from '@/utils/buildingRecord';
import { normalizeYearBuilt, type BuildingYear } from '@/utils/buildingScopeTriggers';

/** A mageid_ key, so the sign-out sweep (utils/localCacheKeys) clears it. */
export const BUILDING_YEAR_KEY = 'mageid_building_year';

export interface EnteredYear { year: number; enteredAt: string }
export type EnteredYears = Record<string, EnteredYear>;

/** The stored map, or {} for anything unreadable. Never throws. Drops rows
 *  that are not a plausible year (the upper bound is the year passed in). */
export function parseBuildingYears(raw: string | null | undefined, currentYear: number): EnteredYears {
  if (!raw) return {};
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return {}; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: EnteredYears = {};
  for (const [id, row] of Object.entries(v as Record<string, unknown>)) {
    if (!id || !row || typeof row !== 'object') continue;
    const r = row as { year?: unknown; enteredAt?: unknown };
    const year = normalizeYearBuilt(r.year, currentYear);
    if (year == null) continue;
    out[id] = { year, enteredAt: typeof r.enteredAt === 'string' ? r.enteredAt : '' };
  }
  return out;
}

export function withEnteredYear(map: EnteredYears, projectId: string, year: number, nowISO: string): EnteredYears {
  return { ...map, [projectId]: { year, enteredAt: nowISO } };
}

export function withoutEnteredYear(map: EnteredYears, projectId: string): EnteredYears {
  if (!(projectId in map)) return map;
  const next = { ...map };
  delete next[projectId];
  return next;
}

/** The entered year as a BuildingYear (asOf = the entered-on day). */
export function enteredBuildingYear(row: EnteredYear | null | undefined, currentYear: number): BuildingYear | null {
  const year = row ? normalizeYearBuilt(row.year, currentYear) : null;
  if (year == null) return null;
  return { year, source: 'entered', asOf: row!.enteredAt ? row!.enteredAt.slice(0, 10) : null };
}

/** PLUTO's year from the building-record hook's state. Only phase 'ready' with
 *  a record counts; every other phase is "unavailable" (null), never 0. */
export function plutoBuildingYear(
  state: { phase: string; record: BuildingRecord | null } | null | undefined,
  currentYear: number,
): BuildingYear | null {
  if (!state || state.phase !== 'ready' || !state.record) return null;
  const parcel = state.record.parcel;
  const year = normalizeYearBuilt(parcel?.yearBuilt, currentYear);
  if (year == null) return null;
  const fetched = typeof state.record.fetchedAt === 'string' && state.record.fetchedAt ? state.record.fetchedAt.slice(0, 10) : null;
  return { year, source: 'pluto', asOf: parcel.plutoVersion ?? parcel.asOf ?? fetched };
}

/** The Baltimore record's year (City Real Property YEAR_BUILD or County
 *  YEAR_BUILT) from useMdBuildingRecord's state. Only phase 'ready' with a
 *  record counts; md.ts already turns 0 / '0000' into null, and
 *  normalizeYearBuilt drops anything else implausible — never 0. The source is
 *  the side of the parcel the contractor confirmed. */
export function mdRecordBuildingYear(
  state: { phase: string; record: MdBuildingRecord | null } | null | undefined,
  currentYear: number,
): BuildingYear | null {
  if (!state || state.phase !== 'ready' || !state.record) return null;
  const parcel = state.record.parcel;
  if (!parcel || parcel.status !== 'ok' || !parcel.found) return null;
  const year = normalizeYearBuilt(parcel.yearBuilt, currentYear);
  if (year == null) return null;
  const fetched = typeof state.record.fetchedAt === 'string' && state.record.fetchedAt ? state.record.fetchedAt.slice(0, 10) : null;
  return { year, source: state.record.side, asOf: parcel.asOf ?? fetched };
}

/** Entered wins; PLUTO is kept alongside so the chip can name both. */
export function resolveBuildingYear(entered: BuildingYear | null, pluto: BuildingYear | null): { year: BuildingYear | null; pluto: BuildingYear | null } {
  return { year: entered ?? pluto, pluto };
}
