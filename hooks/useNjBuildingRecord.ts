// hooks/useNjBuildingRecord.ts — the New Jersey building record for one job.
//
// `supported` is isNjJobsite(addr) && !isNycJobsite(addr). When it is false
// every hook below is still CALLED (rules of hooks) but each body early-outs:
// react-query is `enabled: false`, nothing touches AsyncStorage, nothing
// reaches the network, and the phase is 'unsupported'.
//
// The first lookup is a TAP ('Look up this lot'), never automatic: the Census
// point for a street address sits on the street centreline, so the search
// returns the lots around it and a record for the wrong lot is worse than no
// record. The contractor confirms the tax lot once — even when exactly one lot
// matches the street address; the confirmation persists under
// njParcelConfirmKey(project.id) with the lookup text and is dropped the moment
// the job's address no longer produces that text. After that, opening the job
// loads the record on its own (react-query, 12 h).

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@/types';
import { jobsiteAddressForProject } from '@/utils/codeJurisdiction';
import {
  buildingLookupText,
  isNjJobsite,
  isNycJobsite,
  njParcelConfirmKey,
  summarizeNjBuildingRecord,
  type NjBuildingRecord,
  type NjBuildingRecordSummary,
  type NjParcelCandidate,
} from '@/utils/buildingRecord';
import { fetchNjBuildingRecord } from '@/utils/buildingRecordClient';

export interface NjBuildingRecordState {
  supported: boolean;
  phase: 'unsupported' | 'no_address' | 'idle' | 'resolving' | 'confirm' | 'loading' | 'ready' | 'error';
  candidates: NjParcelCandidate[];
  confirmed: StoredParcelConfirm | null;
  record: NjBuildingRecord | null;
  summary: NjBuildingRecordSummary;
  error: string | null;
  lookup(): void;
  confirm(c: NjParcelCandidate): void;
  changeLot(): void;
  refresh(): void;
}

/** What njParcelConfirmKey(projectId) holds on disk. */
export interface StoredParcelConfirm {
  muniCode: string;
  muniName: string | null;
  block: string;
  lot: string;
  qualifier: string | null;
  propLoc: string | null;
  lookupText: string;
}

const HOUR_MS = 60 * 60 * 1000;
export const NJ_BUILDING_RECORD_STALE_MS = 12 * HOUR_MS;

export const NJ_NO_MATCH_TEXT = 'No tax lot found at this address, so nothing was checked.';
const UNREADABLE_TEXT = 'The building lookup returned something MAGE could not read, so nothing was checked.';

function parseStoredConfirm(raw: string | null): StoredParcelConfirm | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredParcelConfirm> | null;
    if (!v || typeof v !== 'object') return null;
    if (typeof v.muniCode !== 'string' || typeof v.block !== 'string' || typeof v.lot !== 'string' || typeof v.lookupText !== 'string') return null;
    return {
      muniCode: v.muniCode,
      muniName: typeof v.muniName === 'string' ? v.muniName : null,
      block: v.block,
      lot: v.lot,
      qualifier: typeof v.qualifier === 'string' ? v.qualifier : null,
      propLoc: typeof v.propLoc === 'string' ? v.propLoc : null,
      lookupText: v.lookupText,
    };
  } catch {
    return null;
  }
}

export function njParcelConfirmQueryKey(projectId: string | null, lookupText: string | null) {
  return ['building-parcel-confirm', projectId ?? '', lookupText ?? ''] as const;
}

function njLookupText(addr: ReturnType<typeof jobsiteAddressForProject>, location: string | null): string | null {
  if (addr.street.trim()) return buildingLookupText(addr, location);
  const loc = (location ?? '').trim();
  return /^\d/.test(loc) ? loc : null;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function useNjBuildingRecord(project: Project | null | undefined): NjBuildingRecordState {
  const queryClient = useQueryClient();
  const addr = useMemo(() => jobsiteAddressForProject(project), [project]);
  const supported = isNjJobsite(addr) && !isNycJobsite(addr);
  const projectId = project?.id ?? null;
  // The Census geocoder needs a house number: a street, or a free-text
  // location that starts with one. "Hoboken, NJ" alone is 'no_address'.
  const lookupText = supported ? njLookupText(addr, project?.location ?? null) : null;
  const lat = finite(project?.locationLatitude);
  const lon = finite(project?.locationLongitude);

  const [candidates, setCandidates] = useState<NjParcelCandidate[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const confirmQuery = useQuery({
    queryKey: njParcelConfirmQueryKey(projectId, lookupText),
    enabled: supported && !!projectId && !!lookupText,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<StoredParcelConfirm | null> => {
      if (!projectId || !lookupText) return null;
      const key = njParcelConfirmKey(projectId);
      let stored: StoredParcelConfirm | null = null;
      try {
        stored = parseStoredConfirm(await AsyncStorage.getItem(key));
      } catch {
        return null;
      }
      if (stored && stored.lookupText !== lookupText) {
        // The job's address moved: the lot he confirmed is for another address.
        try { await AsyncStorage.removeItem(key); } catch { /* best effort */ }
        return null;
      }
      return stored;
    },
  });
  const stored = supported && confirmQuery.data && confirmQuery.data.lookupText === lookupText ? confirmQuery.data : null;
  const confirmLoaded = !supported || !lookupText || confirmQuery.isFetched;

  // A new job or a new address starts the lookup over.
  useEffect(() => {
    if (!supported) return;
    setCandidates([]);
    setResolveError(null);
    setResolving(false);
  }, [supported, projectId, lookupText]);

  const muni = stored?.muniCode ?? '';
  const block = stored?.block ?? '';
  const lot = stored?.lot ?? '';

  const recordQuery = useQuery({
    queryKey: ['building-record-nj', muni, block, lot],
    enabled: supported && !!muni,
    staleTime: NJ_BUILDING_RECORD_STALE_MS,
    retry: false,
    queryFn: async (): Promise<NjBuildingRecord> => {
      const res = await fetchNjBuildingRecord({ mode: 'nj_record', muniCode: muni, block, lot });
      if (res.status === 'nj_record') return res.record;
      // Only fixed texts reach the screen.
      throw new Error(res.status === 'error' ? res.error : UNREADABLE_TEXT);
    },
  });

  const lookup = useCallback(() => {
    if (!supported || !lookupText) return;
    setResolving(true);
    setResolveError(null);
    setCandidates([]);
    void (async () => {
      const res = await fetchNjBuildingRecord({ mode: 'nj_resolve', text: lookupText, lat, lon });
      setResolving(false);
      if (res.status === 'nj_candidates') {
        if (res.candidates.length === 0) setResolveError(NJ_NO_MATCH_TEXT);
        else setCandidates(res.candidates);
      } else if (res.status === 'error') {
        setResolveError(res.error);
      } else {
        setResolveError(UNREADABLE_TEXT);
      }
    })();
  }, [supported, lookupText, lat, lon]);

  const confirm = useCallback((c: NjParcelCandidate) => {
    if (!supported || !projectId || !lookupText) return;
    const value: StoredParcelConfirm = {
      muniCode: c.muniCode,
      muniName: c.muniName ?? null,
      block: c.block,
      lot: c.lot,
      qualifier: c.qualifier ?? null,
      propLoc: c.propLoc ?? null,
      lookupText,
    };
    queryClient.setQueryData(njParcelConfirmQueryKey(projectId, lookupText), value);
    setCandidates([]);
    setResolveError(null);
    void AsyncStorage.setItem(njParcelConfirmKey(projectId), JSON.stringify(value)).catch(() => {});
  }, [supported, projectId, lookupText, queryClient]);

  const changeLot = useCallback(() => {
    if (!supported || !projectId) return;
    queryClient.setQueryData(njParcelConfirmQueryKey(projectId, lookupText), null);
    void AsyncStorage.removeItem(njParcelConfirmKey(projectId)).catch(() => {});
    lookup();
  }, [supported, projectId, lookupText, queryClient, lookup]);

  const refresh = useCallback(() => {
    if (!supported) return;
    if (muni) void recordQuery.refetch();
    else lookup();
  }, [supported, muni, recordQuery, lookup]);

  const record: NjBuildingRecord | null = supported && muni ? recordQuery.data ?? null : null;
  const summary = useMemo(() => summarizeNjBuildingRecord(record), [record]);

  let phase: NjBuildingRecordState['phase'];
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
    confirmed: stored,
    record,
    summary,
    error,
    lookup,
    confirm,
    changeLot,
    refresh,
  };
}

export default useNjBuildingRecord;
