// hooks/useMdBuildingRecord.ts — the Baltimore (Maryland) building record for
// one job: Baltimore City or Baltimore County open data, whichever parcel
// layer contains the confirmed point.
//
// `supported` is isMdJobsite(addr). When it is false every hook below is still
// CALLED (rules of hooks) but each body early-outs: react-query is
// `enabled: false`, nothing touches AsyncStorage, nothing reaches the network,
// and the phase is 'unsupported'.
//
// The first lookup is a TAP, never automatic: a geocoder point can land on a
// neighbour's parcel or on the street, and "Baltimore, MD" is also a County
// mailing name, so the contractor confirms the parcel (and with it City or
// County) once. The confirmation persists under mdParcelConfirmKey(project.id)
// with the lookup text and is dropped the moment the job's address no longer
// produces that text. After that, opening the job loads the record on its own
// (react-query 12 h, plus the last copy on disk for an offline visit).

import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@/types';
import { jobsiteAddressForProject } from '@/utils/codeJurisdiction';
import {
  buildingLookupText,
  isMdJobsite,
  mdBuildingRecordCacheKey,
  mdParcelConfirmKey,
  summarizeMdBuildingRecord,
  type BuildingRecordSummary,
  type MdBuildingRecord,
  type MdCandidate,
  type MdSide,
} from '@/utils/buildingRecord';
import { fetchMdRecord, fetchMdResolve } from '@/utils/buildingRecordClient';

/** What mdParcelConfirmKey(projectId) holds on disk. */
export interface StoredMdConfirm {
  side: MdSide;
  key: string;
  label: string;
  lat: number;
  lon: number;
  lookupText: string;
}

export interface MdBuildingRecordState {
  supported: boolean;
  phase: 'unsupported' | 'no_address' | 'idle' | 'resolving' | 'confirm' | 'loading' | 'ready' | 'error';
  candidates: MdCandidate[];
  confirmed: StoredMdConfirm | null;
  record: MdBuildingRecord | null;
  summary: BuildingRecordSummary;
  side: MdSide | null;
  error: string | null;
  /** Set when both parcel layers were read and neither holds the address
   *  (phase is then 'idle'): not an error and not zero. */
  outside: { county: string | null } | null;
  lookup(): void;
  confirm(c: MdCandidate): void;
  changeBuilding(): void;
  refresh(): void;
}

const HOUR_MS = 60 * 60 * 1000;
export const MD_BUILDING_RECORD_STALE_MS = 12 * HOUR_MS;

export const MD_NO_MATCH_TEXT = 'No Baltimore parcel found at this address, so nothing was checked.';
const UNREADABLE_TEXT = 'The building lookup returned something MAGE could not read, so nothing was checked.';

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseStoredConfirm(raw: string | null): StoredMdConfirm | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredMdConfirm> | null;
    if (!v || typeof v !== 'object') return null;
    if (v.side !== 'baltimore_city' && v.side !== 'baltimore_county') return null;
    const lat = finite(v.lat);
    const lon = finite(v.lon);
    if (typeof v.key !== 'string' || typeof v.lookupText !== 'string' || lat === null || lon === null) return null;
    return { side: v.side, key: v.key, label: typeof v.label === 'string' ? v.label : '', lat, lon, lookupText: v.lookupText };
  } catch {
    return null;
  }
}

export function mdParcelConfirmQueryKey(projectId: string | null, lookupText: string | null) {
  return ['building-md-confirm', projectId ?? '', lookupText ?? ''] as const;
}

/** The street address when the job has one, else the free-text location when
 *  it starts with a house number (most jobs are location-only). */
export function mdLookupText(addr: ReturnType<typeof jobsiteAddressForProject>, location: string | null): string | null {
  if (addr.street.trim()) return buildingLookupText(addr, location);
  const loc = (location ?? '').trim();
  return /^\d/.test(loc) ? loc : null;
}

export function useMdBuildingRecord(project: Project | null | undefined): MdBuildingRecordState {
  const queryClient = useQueryClient();
  const addr = useMemo(() => jobsiteAddressForProject(project), [project]);
  const supported = isMdJobsite(addr);
  const projectId = project?.id ?? null;
  const lookupText = supported ? mdLookupText(addr, project?.location ?? null) : null;
  const lat = finite(project?.locationLatitude);
  const lon = finite(project?.locationLongitude);

  const [candidates, setCandidates] = useState<MdCandidate[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [outside, setOutside] = useState<{ county: string | null } | null>(null);
  const [cached, setCached] = useState<MdBuildingRecord | null>(null);

  const confirmQuery = useQuery({
    queryKey: mdParcelConfirmQueryKey(projectId, lookupText),
    enabled: supported && !!projectId && !!lookupText,
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<StoredMdConfirm | null> => {
      if (!projectId || !lookupText) return null;
      const key = mdParcelConfirmKey(projectId);
      let stored: StoredMdConfirm | null = null;
      try {
        stored = parseStoredConfirm(await AsyncStorage.getItem(key));
      } catch {
        return null;
      }
      if (stored && stored.lookupText !== lookupText) {
        // The job's address moved: the parcel confirmed is for another address.
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
    setOutside(null);
  }, [supported, projectId, lookupText]);

  const side: MdSide | null = stored?.side ?? null;
  const key = stored?.key ?? '';

  // The last copy on disk, for an offline visit.
  useEffect(() => {
    if (!supported || !side || !key) {
      if (supported) setCached(null);
      return;
    }
    let live = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(mdBuildingRecordCacheKey(side, key));
        if (!live) return;
        const rec = raw ? (JSON.parse(raw) as MdBuildingRecord) : null;
        setCached(rec && rec.jurisdiction === 'md' && rec.side === side && rec.key === key && rec.parcel && rec.permits ? rec : null);
      } catch {
        if (live) setCached(null);
      }
    })();
    return () => { live = false; };
  }, [supported, side, key]);

  const recordQuery = useQuery({
    queryKey: ['building-record-md', side ?? '', key],
    enabled: supported && !!side && !!key && !!stored,
    staleTime: MD_BUILDING_RECORD_STALE_MS,
    retry: false,
    queryFn: async (): Promise<MdBuildingRecord> => {
      if (!stored) throw new Error(UNREADABLE_TEXT);
      const res = await fetchMdRecord(stored.side, stored.key, stored.lat, stored.lon);
      if (res.status === 'md_record') {
        try {
          await AsyncStorage.setItem(mdBuildingRecordCacheKey(stored.side, stored.key), JSON.stringify(res.record));
        } catch { /* the cache is a convenience, not the record */ }
        return res.record;
      }
      // Only fixed texts reach the screen.
      throw new Error(res.status === 'error' ? res.error : UNREADABLE_TEXT);
    },
  });

  const lookup = useCallback(() => {
    if (!supported || !lookupText) return;
    setResolving(true);
    setResolveError(null);
    setCandidates([]);
    setOutside(null);
    void (async () => {
      const res = await fetchMdResolve(lookupText, lat, lon);
      setResolving(false);
      if (res.status === 'md_candidates') {
        if (res.candidates.length === 0) setResolveError(MD_NO_MATCH_TEXT);
        else setCandidates(res.candidates);
      } else if (res.status === 'md_outside') {
        setOutside({ county: res.county });
      } else if (res.status === 'error') {
        setResolveError(res.error);
      } else {
        setResolveError(UNREADABLE_TEXT);
      }
    })();
  }, [supported, lookupText, lat, lon]);

  const confirm = useCallback((c: MdCandidate) => {
    if (!supported || !projectId || !lookupText) return;
    const value: StoredMdConfirm = { side: c.side, key: c.key, label: c.label, lat: c.lat, lon: c.lon, lookupText };
    queryClient.setQueryData(mdParcelConfirmQueryKey(projectId, lookupText), value);
    setCandidates([]);
    setResolveError(null);
    setOutside(null);
    void AsyncStorage.setItem(mdParcelConfirmKey(projectId), JSON.stringify(value)).catch(() => {});
  }, [supported, projectId, lookupText, queryClient]);

  const changeBuilding = useCallback(() => {
    if (!supported || !projectId) return;
    queryClient.setQueryData(mdParcelConfirmQueryKey(projectId, lookupText), null);
    void AsyncStorage.removeItem(mdParcelConfirmKey(projectId)).catch(() => {});
    lookup();
  }, [supported, projectId, lookupText, queryClient, lookup]);

  const refresh = useCallback(() => {
    if (!supported) return;
    if (stored) void recordQuery.refetch();
    else lookup();
  }, [supported, stored, recordQuery, lookup]);

  const record: MdBuildingRecord | null = supported && stored ? recordQuery.data ?? cached : null;
  const summary = useMemo(() => summarizeMdBuildingRecord(record), [record]);

  let phase: MdBuildingRecordState['phase'];
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
    side: supported ? side : null,
    error,
    outside: supported && !stored && phase === 'idle' ? outside : null,
    lookup,
    confirm,
    changeBuilding,
    refresh,
  };
}

export default useMdBuildingRecord;
