// useEstimateCalibration — local-first store for APPLIED calibration factors.
//
// utils/estimateCalibration computes the suggested corrections; this hook
// remembers which ones the GC actually chose to apply. V1 persists to
// AsyncStorage under the `mageid_estimate_calibration` key (the app's
// convention for newer project sub-collections) and shares state across
// screens via the react-query cache — the same pattern as useMaterialReceipts.
// Cloud sync (a Supabase table behind the offline queue) is an intentional
// follow-up, as is reading the applied factors inside the estimate wizard.

import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface AppliedCalibration {
  category: string;
  multiplier: number;
  appliedAt: string;
}

const CALIBRATION_KEY = 'mageid_estimate_calibration';
const QUERY_KEY = ['estimate-calibration'] as const;

async function load(): Promise<AppliedCalibration[]> {
  try {
    const raw = await AsyncStorage.getItem(CALIBRATION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppliedCalibration[]) : [];
  } catch {
    return [];
  }
}

async function persist(corrections: AppliedCalibration[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CALIBRATION_KEY, JSON.stringify(corrections));
  } catch (err) {
    console.log('[estimateCalibration] persist failed:', err);
  }
}

export function useEstimateCalibration() {
  const queryClient = useQueryClient();

  const { data: corrections = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: load,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async (next: AppliedCalibration[]) => { await persist(next); return next; },
    onSuccess: (next) => { queryClient.setQueryData(QUERY_KEY, next); },
  });

  const current = useCallback(
    () => (queryClient.getQueryData<AppliedCalibration[]>(QUERY_KEY) ?? corrections),
    [queryClient, corrections],
  );

  /** Apply (or re-apply with a new factor) a correction for a category. */
  const applyCorrection = useCallback((category: string, multiplier: number) => {
    const next: AppliedCalibration = { category, multiplier, appliedAt: new Date().toISOString() };
    save.mutate([next, ...current().filter(c => c.category !== category)]);
  }, [save, current]);

  /** Remove the applied correction for a category. */
  const removeCorrection = useCallback((category: string) => {
    save.mutate(current().filter(c => c.category !== category));
  }, [save, current]);

  const getCorrection = useCallback(
    (category: string) => corrections.find(c => c.category === category),
    [corrections],
  );

  return { corrections, isLoading, applyCorrection, removeCorrection, getCorrection };
}
