// hooks/useBuildingRecord.ts — the NYC building record for one job.
//
// NYC FIRST. `supported` is isNycJobsite(jobsiteAddressForProject(project)).
// When it is false every hook below is still CALLED (rules of hooks) but each
// body early-outs: react-query is `enabled: false`, no effect touches
// AsyncStorage, nothing reaches the network, and the phase is 'unsupported'.
// A Portland job renders exactly what it rendered before this file existed.
//
// The first lookup is a TAP ('Look up this building at DOB'), never automatic:
// NYC's address search can return more than one building for one street
// address, and a record for the wrong BIN is worse than no record. The
// contractor confirms the building once; the confirmation persists under
// buildingConfirmKey(project.id) and is discarded the moment the job's address
// no longer produces the same lookup text. After that, opening the job loads
// the record on its own.
//
// The record is cached twice: in react-query (12 h) and on disk under
// buildingRecordCacheKey(bin, bbl), so an offline visit shows the last copy
// with the day it was fetched rather than nothing.

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@/types';
import { jobsiteAddressForProject } from '@/utils/codeJurisdiction';
import {
  buildingConfirmKey,
  buildingLookupText,
  buildingRecordCacheKey,
  isNycJobsite,
  summarizeBuildingRecord,
  type BuildingCandidate,
  type BuildingRecord,
  type BuildingRecordSummary,
} from '@/utils/buildingRecord';
import { invokeBuildingRecord } from '@/utils/buildingRecordClient';

export interface BuildingRecordState {
  supported: boolean;
  phase: 'unsupported' | 'no_address' | 'idle' | 'resolving' | 'confirm' | 'loading' | 'ready' | 'error';
  candidates: BuildingCandidate[];
  confirmed: BuildingCandidate | null;
  record: BuildingRecord | null;
  summary: BuildingRecordSummary;
  error: string | null;
  lookup(): void;
  confirm(c: BuildingCandidate): void;
  changeBuilding(): void;
  refresh(): void;
}

/** What buildingConfirmKey(projectId) holds on disk. */
export interface StoredBuildingConfirm {
  bin: string;
  bbl: string;
  label: string;
  borough: string;
  padVersion: string | null;
  lookupText: string;
}

const HOUR_MS = 60 * 60 * 1000;
export const BUILDING_RECORD_STALE_MS = 12 * HOUR_MS;

const NO_MATCH_TEXT =
  "NYC's address search found no building at this address — nothing was checked. Check the job's street address.";
const UNREADABLE_TEXT = 'The building lookup returned something MAGE could not read — nothing was checked.';

function parseStoredConfirm(raw: string | null): StoredBuildingConfirm | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredBuildingConfirm> | null;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.bin !== 'string' || typeof v.bbl !== 'string' || typeof v.lookupText !== 'string') return null;
    return {
      bin: v.bin,
      bbl: v.bbl,
      label: typeof v.label === 'string' ? v.label : '',
      borough: typeof v.borough === 'string' ? v.borough : '',
      padVersion: typeof v.padVersion === 'string' ? v.padVersion : null,
      lookupText: v.lookupText,
    };
  } catch {
    return null;
  }
}

/** The react-query key the confirmed building lives under. Shared with
 *  useReviewBenchmark so a confirmation on the card reaches every reader. */
export function buildingConfirmQueryKey(projectId: string | null, lookupText: string | null) {
  return ['building-confirm', projectId ?? '', lookupText ?? ''] as const;
}

/**
 * The job's NYC context: whether it is supported, the lookup text, and the
 * confirmed building (null until the contractor confirms one, and null again
 * once the address stops matching what was confirmed).
 */
export function useConfirmedBuilding(project: Project | null | undefined): {
  supported: boolean;
  projectId: string | null;
  lookupText: string | null;
  confirmed: StoredBuildingConfirm | null;
  confirmLoaded: boolean;
} {
  const addr = useMemo(() => jobsiteAddressForProject(project), [project]);
  const supported = isNycJobsite(addr);
  const projectId = project?.id ?? null;
  const lookupText = supported ? buildingLookupText(addr, project?.location ?? null) : null;

  const q = useQuery({
    queryKey: buildingConfirmQueryKey(projectId, lookupText),
    enabled: supported && !!projectId && !!lookupText,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<StoredBuildingConfirm | null> => {
      if (!projectId || !lookupText) return null;
      const key = buildingConfirmKey(projectId);
      let stored: StoredBuildingConfirm | null = null;
      try {
        stored = parseStoredConfirm(await AsyncStorage.getItem(key));
      } catch {
        return null;
      }
      if (stored && stored.lookupText !== lookupText) {
        // The job's address moved: the building he confirmed is for another
        // address. Drop it rather than show a record for the wrong BIN.
        try { await AsyncStorage.removeItem(key); } catch { /* best effort */ }
        return null;
      }
      return stored;
    },
  });

  const confirmed = supported && q.data && q.data.lookupText === lookupText ? q.data : null;
  return {
    supported,
    projectId,
    lookupText,
    confirmed,
    confirmLoaded: !supported || !lookupText || q.isFetched,
  };
}

function toCandidate(c: StoredBuildingConfirm): BuildingCandidate {
  return { bin: c.bin, bbl: c.bbl, label: c.label, borough: c.borough, padVersion: c.padVersion };
}

export function useBuildingRecord(project: Project | null | undefined): BuildingRecordState {
  const queryClient = useQueryClient();
  const { supported, projectId, lookupText, confirmed: stored, confirmLoaded } = useConfirmedBuilding(project);

  const [candidates, setCandidates] = useState<BuildingCandidate[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [cached, setCached] = useState<BuildingRecord | null>(null);

  const bin = stored?.bin ?? '';
  const bbl = stored?.bbl ?? '';

  // A new job or a new address starts the lookup over.
  useEffect(() => {
    if (!supported) return;
    setCandidates([]);
    setResolveError(null);
    setResolving(false);
  }, [supported, projectId, lookupText]);

  // The last copy on disk, for an offline visit.
  useEffect(() => {
    if (!supported || !bin) {
      if (supported) setCached(null);
      return;
    }
    let live = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(buildingRecordCacheKey(bin, bbl));
        if (!live) return;
        const rec = raw ? (JSON.parse(raw) as BuildingRecord) : null;
        setCached(rec && rec.bin === bin && rec.bbl === bbl && Array.isArray(rec.datasets) ? rec : null);
      } catch {
        if (live) setCached(null);
      }
    })();
    return () => { live = false; };
  }, [supported, bin, bbl]);

  const recordQuery = useQuery({
    queryKey: ['building-record', bin, bbl],
    enabled: supported && !!bin,
    staleTime: BUILDING_RECORD_STALE_MS,
    retry: false,
    queryFn: async (): Promise<BuildingRecord> => {
      const res = await invokeBuildingRecord({ mode: 'record', bin, bbl });
      if (res.status === 'record') {
        try {
          await AsyncStorage.setItem(buildingRecordCacheKey(bin, bbl), JSON.stringify(res.record));
        } catch { /* the cache is a convenience, not the record */ }
        return res.record;
      }
      // Only fixed texts reach the screen (the client and the function both
      // replace raw errors with one sentence).
      throw new Error(res.status === 'error' ? res.error : res.status === 'unsupported' ? res.reason : UNREADABLE_TEXT);
    },
  });

  const lookup = useCallback(() => {
    if (!supported || !lookupText) return;
    setResolving(true);
    setResolveError(null);
    setCandidates([]);
    void (async () => {
      const res = await invokeBuildingRecord({ mode: 'resolve', text: lookupText });
      setResolving(false);
      if (res.status === 'candidates') {
        if (res.candidates.length === 0) setResolveError(NO_MATCH_TEXT);
        else setCandidates(res.candidates);
      } else if (res.status === 'error') {
        setResolveError(res.error);
      } else if (res.status === 'unsupported') {
        setResolveError(res.reason);
      } else {
        setResolveError(UNREADABLE_TEXT);
      }
    })();
  }, [supported, lookupText]);

  const confirm = useCallback((c: BuildingCandidate) => {
    if (!supported || !projectId || !lookupText) return;
    const value: StoredBuildingConfirm = {
      bin: c.bin,
      bbl: c.bbl,
      label: c.label,
      borough: c.borough,
      padVersion: c.padVersion ?? null,
      lookupText,
    };
    queryClient.setQueryData(buildingConfirmQueryKey(projectId, lookupText), value);
    setCandidates([]);
    setResolveError(null);
    void AsyncStorage.setItem(buildingConfirmKey(projectId), JSON.stringify(value)).catch(() => {});
  }, [supported, projectId, lookupText, queryClient]);

  const changeBuilding = useCallback(() => {
    if (!supported || !projectId) return;
    queryClient.setQueryData(buildingConfirmQueryKey(projectId, lookupText), null);
    void AsyncStorage.removeItem(buildingConfirmKey(projectId)).catch(() => {});
    lookup();
  }, [supported, projectId, lookupText, queryClient, lookup]);

  const refresh = useCallback(() => {
    if (!supported) return;
    if (bin) void recordQuery.refetch();
    else lookup();
  }, [supported, bin, recordQuery, lookup]);

  const record: BuildingRecord | null = supported && bin ? recordQuery.data ?? cached : null;
  const summary = useMemo(() => summarizeBuildingRecord(record), [record]);

  let phase: BuildingRecordState['phase'];
  let error: string | null = null;
  if (!supported) phase = 'unsupported';
  else if (!lookupText) phase = 'no_address';
  else if (!confirmLoaded) phase = 'loading';
  else if (stored) {
    if (record) phase = 'ready';
    else if (recordQuery.isError) {
      phase = 'error';
      error = recordQuery.error instanceof Error ? recordQuery.error.message : UNREADABLE_TEXT;
    } else phase = 'loading';
  } else if (resolving) phase = 'resolving';
  else if (candidates.length > 0) phase = 'confirm';
  else if (resolveError) {
    phase = 'error';
    error = resolveError;
  } else phase = 'idle';

  return {
    supported,
    phase,
    candidates: supported ? candidates : [],
    confirmed: stored ? toCandidate(stored) : null,
    record,
    summary,
    error,
    lookup,
    confirm,
    changeBuilding,
    refresh,
  };
}

export default useBuildingRecord;
