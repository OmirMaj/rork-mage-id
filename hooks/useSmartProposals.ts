// useSmartProposals — local-first store for tiered Smart Proposals.
//
// Same shape as useMaterialReceipts: persists to AsyncStorage under the
// `tertiary_smart_proposals` key (the app's convention for newer project
// sub-collections) and shares state across screens via the react-query cache.
// Cloud sync is an intentional follow-up — proposal accept/decline already
// closes the learning loop by flipping the linked Lead, which DOES sync.

import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { SmartProposal } from '@/utils/proposalBuilder';

const PROPOSALS_KEY = 'tertiary_smart_proposals';
const QUERY_KEY = ['smart-proposals'] as const;

async function load(): Promise<SmartProposal[]> {
  try {
    const raw = await AsyncStorage.getItem(PROPOSALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SmartProposal[]) : [];
  } catch {
    return [];
  }
}

async function persist(proposals: SmartProposal[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PROPOSALS_KEY, JSON.stringify(proposals));
  } catch (err) {
    console.warn('[smartProposals] persist failed:', err);
  }
}

export function useSmartProposals() {
  const queryClient = useQueryClient();

  const { data: proposals = [], isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: load,
    staleTime: Infinity,
  });

  const save = useMutation({
    mutationFn: async (next: SmartProposal[]) => { await persist(next); return next; },
    onSuccess: (next) => { queryClient.setQueryData(QUERY_KEY, next); },
  });

  const current = useCallback(
    () => (queryClient.getQueryData<SmartProposal[]>(QUERY_KEY) ?? proposals),
    [queryClient, proposals],
  );

  const addProposal = useCallback((p: SmartProposal) => {
    save.mutate([p, ...current()]);
  }, [save, current]);

  const updateProposal = useCallback((id: string, updates: Partial<SmartProposal>) => {
    save.mutate(current().map(p => (p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p)));
  }, [save, current]);

  const removeProposal = useCallback((id: string) => {
    save.mutate(current().filter(p => p.id !== id));
  }, [save, current]);

  const getProposalsForProject = useCallback(
    (projectId: string) => proposals.filter(p => p.projectId === projectId),
    [proposals],
  );

  return { proposals, isLoading, addProposal, updateProposal, removeProposal, getProposalsForProject };
}
