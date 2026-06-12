// useLastPlanner — local-first store for the Last Planner production-control
// layer: per-project readiness CONSTRAINTS + weekly COMMITMENTS (which feed
// the PPC scorecard). Persisted under `tertiary_last_planner` in AsyncStorage
// and shared across screens via the react-query cache, same as
// useMaterialReceipts. Cloud sync is an intentional follow-up.
//
// Keyed by projectId so a GC's lookahead/WWP/PPC is scoped per job.

import { useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { generateUUID } from '@/utils/generateId';
import type {
  Constraint, ConstraintCategory, WeeklyCommitment, VarianceReason,
} from '@/utils/lastPlanner';

const KEY = 'tertiary_last_planner';
const QK = ['last-planner'] as const;

interface ProjectBucket {
  constraints: Constraint[];
  commitments: WeeklyCommitment[];
}
type Store = Record<string, ProjectBucket>;

async function load(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}
async function persist(store: Store): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(store));
  } catch (err) {
    console.log('[lastPlanner] persist failed:', err);
  }
}

function bucket(store: Store, projectId: string): ProjectBucket {
  return store[projectId] ?? { constraints: [], commitments: [] };
}

export function useLastPlanner(projectId: string | null | undefined) {
  const queryClient = useQueryClient();

  const { data: store = {} as Store, isLoading } = useQuery({
    queryKey: QK,
    queryFn: load,
  });

  const mutation = useMutation({
    mutationFn: async (next: Store) => { await persist(next); return next; },
    onSuccess: next => queryClient.setQueryData(QK, next),
  });

  const apply = useCallback((mut: (b: ProjectBucket) => ProjectBucket) => {
    if (!projectId) return;
    const current = (queryClient.getQueryData<Store>(QK)) ?? store;
    const next: Store = { ...current, [projectId]: mut(bucket(current, projectId)) };
    mutation.mutate(next);
  }, [projectId, queryClient, store, mutation]);

  const constraints = useMemo(
    () => (projectId ? bucket(store, projectId).constraints : []),
    [store, projectId],
  );
  const commitments = useMemo(
    () => (projectId ? bucket(store, projectId).commitments : []),
    [store, projectId],
  );

  // ── Constraints ──
  const addConstraint = useCallback((input: {
    taskId: string; category: ConstraintCategory; description: string; needBy?: string; owner?: string;
  }) => {
    const c: Constraint = {
      id: generateUUID(), taskId: input.taskId, category: input.category,
      description: input.description.trim(), status: 'open',
      needBy: input.needBy, owner: input.owner?.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    apply(b => ({ ...b, constraints: [c, ...b.constraints] }));
  }, [apply]);

  const toggleConstraint = useCallback((constraintId: string) => {
    apply(b => ({
      ...b,
      constraints: b.constraints.map(c => c.id === constraintId
        ? (c.status === 'open'
            ? { ...c, status: 'cleared' as const, clearedAt: new Date().toISOString() }
            : { ...c, status: 'open' as const, clearedAt: undefined })
        : c),
    }));
  }, [apply]);

  const removeConstraint = useCallback((constraintId: string) => {
    apply(b => ({ ...b, constraints: b.constraints.filter(c => c.id !== constraintId) }));
  }, [apply]);

  // ── Commitments ──
  const setCommit = useCallback((taskId: string, weekStart: string, committed: boolean) => {
    apply(b => {
      const exists = b.commitments.some(c => c.taskId === taskId && c.weekStart === weekStart);
      const commitments = exists
        ? b.commitments.map(c => (c.taskId === taskId && c.weekStart === weekStart
            ? { ...c, committed } : c))
        : [...b.commitments, { taskId, weekStart, committed }];
      return { ...b, commitments };
    });
  }, [apply]);

  const reviewCommit = useCallback((
    taskId: string, weekStart: string,
    outcome: 'done' | 'missed', varianceReason?: VarianceReason,
  ) => {
    apply(b => ({
      ...b,
      commitments: b.commitments.map(c => (c.taskId === taskId && c.weekStart === weekStart
        ? { ...c, outcome, varianceReason: outcome === 'missed' ? varianceReason : undefined } : c)),
    }));
  }, [apply]);

  return {
    constraints, commitments,
    addConstraint, toggleConstraint, removeConstraint,
    setCommit, reviewCommit,
    isLoading,
  };
}
