// useMaterialReceipts — local-first store for snapped supplier invoices.
//
// V1 persists to AsyncStorage under the `mageid_material_receipts` key (the
// app's convention for newer project sub-collections) and shares state across
// screens via the react-query cache, the same data layer the rest of the app
// uses. Cloud sync (a Supabase table behind the offline queue) and the
// commitment.paidToDate server rollup are intentional follow-ups (see the
// Material Tracking PR description).

import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { MaterialReceipt } from '@/types';

const RECEIPTS_KEY = 'mageid_material_receipts';
const QUERY_KEY = ['material-receipts'] as const;

async function load(): Promise<MaterialReceipt[]> {
  try {
    const raw = await AsyncStorage.getItem(RECEIPTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MaterialReceipt[]) : [];
  } catch {
    return [];
  }
}

async function persist(receipts: MaterialReceipt[]): Promise<void> {
  try {
    await AsyncStorage.setItem(RECEIPTS_KEY, JSON.stringify(receipts));
  } catch (err) {
    console.log('[materialReceipts] persist failed:', err);
  }
}

export function useMaterialReceipts() {
  const queryClient = useQueryClient();

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: load,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async (next: MaterialReceipt[]) => { await persist(next); return next; },
    onSuccess: (next) => { queryClient.setQueryData(QUERY_KEY, next); },
  });

  const current = useCallback(
    () => (queryClient.getQueryData<MaterialReceipt[]>(QUERY_KEY) ?? receipts),
    [queryClient, receipts],
  );

  const addReceipt = useCallback((r: MaterialReceipt) => {
    save.mutate([r, ...current()]);
  }, [save, current]);

  const updateReceipt = useCallback((id: string, updates: Partial<MaterialReceipt>) => {
    save.mutate(current().map(r => (r.id === id ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r)));
  }, [save, current]);

  const deleteReceipt = useCallback((id: string) => {
    save.mutate(current().filter(r => r.id !== id));
  }, [save, current]);

  const getReceiptsForProject = useCallback(
    (projectId: string) => receipts.filter(r => r.projectId === projectId),
    [receipts],
  );

  return { receipts, isLoading, addReceipt, updateReceipt, deleteReceipt, getReceiptsForProject };
}
