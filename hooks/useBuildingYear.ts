// hooks/useBuildingYear.ts — a project's year built for the building-age
// lines (Bet 1): the year he entered (device-local), else PLUTO's once the
// NYC building record is loaded, else none.
//
// WHAT MOUNTING THIS DOES. It calls hooks/useBuildingRecord, which never
// starts the FIRST lookup (that stays a deliberate tap on the Building record
// card) and, for a job outside NYC, keeps every query `enabled: false`. For a
// building the contractor has ALREADY confirmed, it enables the record query
// under the same react-query key the Building record card uses
// (['building-record', bin, bbl], 12 h cache + disk copy), so react-query
// dedupes it: at most one extra fetch when the cache is cold, none when the
// card already loaded it. This hook never calls lookup, confirm, changeBuilding
// or refresh.
//
// STORAGE. BUILDING_YEAR_KEY (mageid_, swept at sign-out), a JSON map
// { [projectId]: { year, enteredAt } }. Every read and write is wrapped — a
// throwing store (private window, blocked site data) still leaves the year in
// memory for this session. One module-level copy, so two mounts agree on the
// same frame (the hooks/useBackcharges.ts pattern).
import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Project } from '@/types';
import { useBuildingRecord } from '@/hooks/useBuildingRecord';
import { useMdBuildingRecord } from '@/hooks/useMdBuildingRecord';
import type { BuildingYear } from '@/utils/buildingScopeTriggers';
import {
  BUILDING_YEAR_KEY, enteredBuildingYear, mdRecordBuildingYear, parseBuildingYears, plutoBuildingYear, resolveBuildingYear,
  withEnteredYear, withoutEnteredYear, type EnteredYears,
} from '@/utils/buildingYear';

let shared: EnteredYears = {};
let sharedLoaded = false;
const listeners = new Set<() => void>();

function publish(next: EnteredYears) {
  shared = next;
  sharedLoaded = true;
  listeners.forEach(l => l());
}

async function readAll(currentYear: number): Promise<EnteredYears | null> {
  try {
    return parseBuildingYears(await AsyncStorage.getItem(BUILDING_YEAR_KEY), currentYear);
  } catch {
    return null;
  }
}

async function writeAll(map: EnteredYears): Promise<void> {
  try {
    await AsyncStorage.setItem(BUILDING_YEAR_KEY, JSON.stringify(map));
  } catch {
    // Device-local; the in-memory copy still holds the year for this session.
  }
}

export interface BuildingYearState {
  /** The year the rules use: entered, else PLUTO, else null. */
  year: BuildingYear | null;
  /** The public record's year when it is loaded (shown next to an entered one):
   *  PLUTO's for an NYC job, the Baltimore City / County record's for a Baltimore one. */
  pluto: BuildingYear | null;
  entered: BuildingYear | null;
  /** NYC jobsite (the building-record hook supports it). */
  isNyc: boolean;
  currentYear: number;
  setEntered: (year: number) => void;
  clearEntered: () => void;
}

export function useBuildingYear(project: Project | null | undefined): BuildingYearState {
  const currentYear = new Date().getFullYear();
  const record = useBuildingRecord(project);
  // Baltimore: inert (no network, no storage) for any job outside Maryland, and
  // never starts the first lookup (the card's tap does).
  const mdRecord = useMdBuildingRecord(project);
  const [, setTick] = useState(0);
  const projectId = project?.id ?? null;

  useEffect(() => {
    let alive = true;
    const l = () => { if (alive) setTick(t => t + 1); };
    listeners.add(l);
    // The disk copy is the truth on every mount (after a sign-out sweep it is
    // empty, so the in-memory copy of the last account is dropped with it).
    void readAll(currentYear).then(map => {
      if (!alive) return;
      if (map) publish(map);
      else if (!sharedLoaded) publish(shared);
    });
    return () => { alive = false; listeners.delete(l); };
  }, [currentYear]);

  const row = projectId ? shared[projectId] : undefined;
  const entered = useMemo(() => enteredBuildingYear(row, currentYear), [row, currentYear]);
  const pluto = useMemo(
    () => plutoBuildingYear({ phase: record.phase, record: record.record }, currentYear)
      ?? mdRecordBuildingYear({ phase: mdRecord.phase, record: mdRecord.record }, currentYear),
    [record.phase, record.record, mdRecord.phase, mdRecord.record, currentYear],
  );
  const resolved = useMemo(() => resolveBuildingYear(entered, pluto), [entered, pluto]);

  const setEntered = useCallback((year: number) => {
    if (!projectId) return;
    const next = withEnteredYear(shared, projectId, year, new Date().toISOString());
    publish(next);
    void writeAll(next);
  }, [projectId]);

  const clearEntered = useCallback(() => {
    if (!projectId) return;
    const next = withoutEnteredYear(shared, projectId);
    publish(next);
    void writeAll(next);
  }, [projectId]);

  return {
    year: resolved.year,
    pluto: resolved.pluto,
    entered,
    isNyc: record.supported,
    currentYear,
    setEntered,
    clearEntered,
  };
}

export default useBuildingYear;
