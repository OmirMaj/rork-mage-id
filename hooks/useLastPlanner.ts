// useLastPlanner — local-first store for the Last Planner production-control
// layer: per-project readiness CONSTRAINTS + weekly COMMITMENTS (which feed
// the PPC scorecard). Persisted under `mageid_last_planner` in AsyncStorage
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

const KEY = 'mageid_last_planner';
const QK = ['last-planner'] as const;

interface ProjectBucket {
  constraints: Constraint[];
  commitments: WeeklyCommitment[];
  dispatches?: CrewDispatchRecord[];
}

/** Record of pushing a crew their committed week (for "sent" state). */
export interface CrewDispatchRecord {
  crewKey: string;
  weekStart: string;
  channel: 'email' | 'share';
  sentAt: string;
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
    console.warn('[lastPlanner] persist failed:', err);
  }
}

function bucket(store: Store, projectId: string): ProjectBucket {
  return store[projectId] ?? { constraints: [], commitments: [], dispatches: [] };
}

/**
 * Every project's constraints, read straight from the store — for callers (One
 * Mind's readiness lookahead) that need the whole constraint book at once
 * without mounting the per-project hook. Local-only, so it reflects constraints
 * logged on this device. Never throws.
 */
export async function loadAllConstraints(): Promise<Record<string, Constraint[]>> {
  const store = await load();
  const out: Record<string, Constraint[]> = {};
  for (const [projectId, b] of Object.entries(store)) {
    if (b?.constraints?.length) out[projectId] = b.constraints;
  }
  return out;
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
  const dispatches = useMemo(
    () => (projectId ? bucket(store, projectId).dispatches ?? [] : []),
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

  const markDispatched = useCallback((crewKey: string, weekStart: string, channel: 'email' | 'share') => {
    apply(b => {
      const rest = (b.dispatches ?? []).filter(d => !(d.crewKey === crewKey && d.weekStart === weekStart));
      return { ...b, dispatches: [...rest, { crewKey, weekStart, channel, sentAt: new Date().toISOString() }] };
    });
  }, [apply]);

  return {
    constraints, commitments, dispatches,
    addConstraint, toggleConstraint, removeConstraint,
    setCommit, reviewCommit, markDispatched,
    isLoading,
  };
}
