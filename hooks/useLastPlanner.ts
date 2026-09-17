// useLastPlanner — local-first store for the Last Planner production-control
// layer: per-project readiness CONSTRAINTS + weekly COMMITMENTS (which feed
// the PPC scorecard). Persisted under `mageid_last_planner` in AsyncStorage,
// shared across screens via the react-query cache, and mirrored to Supabase
// (last_planner_* tables, supabase/migrations/20260916150000_last_planner_
// cloud_mirror.sql).
//
// Keyed by projectId so a GC's lookahead/WWP/PPC is scoped per job.
//
// WHY THE CLOUD LOAD LIVES IN THIS FILE. The mirror used to hydrate inside
// app/last-planner.tsx, so the Friday Close card and Ask — which read the store
// without mounting that screen — stayed empty on a fresh device or after a
// sign-out until someone opened the Last Planner once. Now the ONE query below
// (lastPlannerQueryOptions) does local load + cloud merge, and every reader goes
// through it: the screen via useLastPlanner, the others via fetchLastPlannerStore
// / loadAllConstraints. Nothing outside this file reads the storage key.
//
// The merge and backfill rules are pure and pinned in utils/lastPlanner
// (hydrateLastPlannerStore, createLastPlannerLoader) + scripts/validate-last-planner.ts.

import { useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { generateUUID } from '@/utils/generateId';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWriteDetailed, getOwnOfflineQueueDetailed } from '@/utils/offlineQueue';
import {
  LAST_PLANNER_TABLES, commitmentRowId, dispatchRowId, pendingRowKey,
  touchedWrites, createLastPlannerLoader, writeStoreToCache,
  LAST_PLANNER_QUERY_KEY, LAST_PLANNER_MUTATION_KEY, lastPlannerQueryKey,
  type Constraint, type ConstraintCategory, type WeeklyCommitment, type VarianceReason,
  type LastPlannerRowWrite, type LastPlannerSyncState, type LastPlannerStore, type LastPlannerSnapshot,
} from '@/utils/lastPlanner';

export type { LastPlannerSnapshot };

/** The AsyncStorage key. Exported so nothing else re-types it; read it only via this module. */
export const LAST_PLANNER_STORAGE_KEY = 'mageid_last_planner';
// Query/mutation keys live in utils/lastPlanner (so the validator runs the
// loader with the hook's real mutation key); re-exported so callers import
// every planner key from this one module.
export { LAST_PLANNER_QUERY_KEY, LAST_PLANNER_MUTATION_KEY, lastPlannerQueryKey };

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

async function loadLocal(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(LAST_PLANNER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}
async function persist(store: Store): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_PLANNER_STORAGE_KEY, JSON.stringify(store));
  } catch (err) {
    console.warn('[lastPlanner] persist failed:', err);
  }
}

function bucket(store: Store, projectId: string): ProjectBucket {
  return store[projectId] ?? { constraints: [], commitments: [], dispatches: [] };
}

// The one loader for the app. Its sequencing (seed, merge, persist, backfill,
// and the "is this hydrate still current" checks) lives in utils/lastPlanner
// createLastPlannerLoader so validate-last-planner can run it against the real
// query cache; this file only supplies the device and network I/O.
const loader = createLastPlannerLoader({
  queryKey: lastPlannerQueryKey,
  mutationKey: LAST_PLANNER_MUTATION_KEY,
  cloudEnabled: () => isSupabaseConfigured,
  loadLocal,
  persist,
  unpersistIfUnchanged: async (written) => {
    try {
      const raw = await AsyncStorage.getItem(LAST_PLANNER_STORAGE_KEY);
      if (raw === JSON.stringify(written)) await AsyncStorage.removeItem(LAST_PLANNER_STORAGE_KEY);
    } catch (err) {
      console.warn('[lastPlanner] could not take back a stale store:', err);
    }
  },
  fetchCloud: async () => {
    const [c, m, d] = await Promise.all([
      supabase.from(LAST_PLANNER_TABLES.constraints).select('*'),
      supabase.from(LAST_PLANNER_TABLES.commitments).select('*'),
      supabase.from(LAST_PLANNER_TABLES.dispatches).select('*'),
    ]);
    // Covers "table not migrated yet" too: keep working from the device.
    const readError = c.error ?? m.error ?? d.error;
    if (readError) throw readError;
    return { constraints: c.data ?? [], commitments: m.data ?? [], dispatches: d.data ?? [] };
  },
  readQueue: getOwnOfflineQueueDetailed,
  // Throws are handled by the loader ("unknown": no backfill, no take-back).
  sessionUserId: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user?.id ?? null;
  },
  upsert: w => supabaseWriteDetailed(w.table, 'upsert', w.row),
  now: Date.now,
});

/** The one query every reader of the store shares (local load + cloud merge). */
export function lastPlannerQueryOptions(queryClient: QueryClient, userId: string | null | undefined) {
  const uid = userId ?? null;
  return {
    queryKey: lastPlannerQueryKey(uid),
    queryFn: () => loader.loadSnapshot(queryClient, uid),
    // Several readers mount together (home's Friday Close, Ask, the screen);
    // one network merge between them is enough.
    staleTime: 30_000,
  };
}

/** The whole store, merged with the cloud when signed in. Never throws. */
export async function fetchLastPlannerStore(
  queryClient: QueryClient, userId: string | null | undefined,
): Promise<LastPlannerStore> {
  try {
    return (await queryClient.fetchQuery(lastPlannerQueryOptions(queryClient, userId))).store;
  } catch {
    return loadLocal();
  }
}

/**
 * Every project's constraints — for callers (One Mind's readiness lookahead)
 * that need the whole constraint book at once without mounting the
 * per-project hook. Goes through the shared query, so it includes constraints
 * logged on another device. Never throws.
 */
export async function loadAllConstraints(
  queryClient: QueryClient, userId: string | null | undefined,
): Promise<Record<string, Constraint[]>> {
  const store = await fetchLastPlannerStore(queryClient, userId);
  const out: Record<string, Constraint[]> = {};
  for (const [projectId, b] of Object.entries(store)) {
    if (b?.constraints?.length) out[projectId] = b.constraints;
  }
  return out;
}

export function useLastPlanner(projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const key = useMemo(() => lastPlannerQueryKey(userId), [userId]);

  const { data, isLoading } = useQuery(lastPlannerQueryOptions(queryClient, userId));
  const store = useMemo<Store>(() => data?.store ?? {}, [data]);
  const syncState: LastPlannerSyncState = data?.sync ?? 'pending';

  const mutation = useMutation({
    // Same key the loader waits on: without it a tap made mid-hydrate is
    // neither awaited nor seen by the merge, and is dropped from disk.
    mutationKey: LAST_PLANNER_MUTATION_KEY,
    mutationFn: async (vars: { next: Store; writes: LastPlannerRowWrite[] }) => { await persist(vars.next); return vars; },
    onSuccess: ({ next, writes }) => {
      // Keeps the query's timestamp: a tap mid-hydrate must not make the
      // device copy look server-fresh to the next reader.
      writeStoreToCache(queryClient, key, next);
      // Only rows the mutator named are pushed. A write built on a cache
      // snapshot can carry stale copies of OTHER rows; pushing the whole diff
      // would upload those over another device's newer ones.
      if (userId && isSupabaseConfigured) {
        for (const w of writes) void loader.sendRow(userId, w);
      }
    },
  });

  /** `touched`: pendingRowKey of each row this change is allowed to push. */
  const apply = useCallback((touched: string[], mut: (b: ProjectBucket) => ProjectBucket) => {
    if (!projectId) return;
    const current = queryClient.getQueryData<LastPlannerSnapshot>(key)?.store ?? store;
    const before = bucket(current, projectId);
    const after = mut(before);
    const next: Store = { ...current, [projectId]: after };
    const writes = userId ? touchedWrites(projectId, userId, before, after, touched) : [];
    mutation.mutate({ next, writes });
  }, [projectId, queryClient, key, store, mutation, userId]);

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

  const commitKey = useCallback((taskId: string, weekStart: string) =>
    (projectId ? [pendingRowKey(LAST_PLANNER_TABLES.commitments, commitmentRowId(projectId, taskId, weekStart))] : []),
  [projectId]);

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
    apply([pendingRowKey(LAST_PLANNER_TABLES.constraints, c.id)],
      b => ({ ...b, constraints: [c, ...b.constraints] }));
  }, [apply]);

  const toggleConstraint = useCallback((constraintId: string) => {
    apply([pendingRowKey(LAST_PLANNER_TABLES.constraints, constraintId)], b => ({
      ...b,
      constraints: b.constraints.map(c => c.id === constraintId
        ? (c.status === 'open'
            ? { ...c, status: 'cleared' as const, clearedAt: new Date().toISOString() }
            : { ...c, status: 'open' as const, clearedAt: undefined })
        : c),
    }));
  }, [apply]);

  // Local-only: a disappearance is never turned into a server write (see
  // utils/lastPlanner diffBucketWrites). No UI calls this today.
  const removeConstraint = useCallback((constraintId: string) => {
    apply([], b => ({ ...b, constraints: b.constraints.filter(c => c.id !== constraintId) }));
  }, [apply]);

  // ── Commitments ──
  const setCommit = useCallback((taskId: string, weekStart: string, committed: boolean) => {
    apply(commitKey(taskId, weekStart), b => {
      const exists = b.commitments.some(c => c.taskId === taskId && c.weekStart === weekStart);
      const commitments = exists
        ? b.commitments.map(c => (c.taskId === taskId && c.weekStart === weekStart
            ? { ...c, committed } : c))
        : [...b.commitments, { taskId, weekStart, committed }];
      return { ...b, commitments };
    });
  }, [apply, commitKey]);

  const reviewCommit = useCallback((
    taskId: string, weekStart: string,
    outcome: 'done' | 'missed', varianceReason?: VarianceReason,
  ) => {
    apply(commitKey(taskId, weekStart), b => ({
      ...b,
      commitments: b.commitments.map(c => (c.taskId === taskId && c.weekStart === weekStart
        ? { ...c, outcome, varianceReason: outcome === 'missed' ? varianceReason : undefined } : c)),
    }));
  }, [apply, commitKey]);

  const markDispatched = useCallback((crewKey: string, weekStart: string, channel: 'email' | 'share') => {
    const touched = projectId ? [pendingRowKey(LAST_PLANNER_TABLES.dispatches, dispatchRowId(projectId, crewKey, weekStart))] : [];
    apply(touched, b => {
      const rest = (b.dispatches ?? []).filter(d => !(d.crewKey === crewKey && d.weekStart === weekStart));
      return { ...b, dispatches: [...rest, { crewKey, weekStart, channel, sentAt: new Date().toISOString() }] };
    });
  }, [apply, projectId]);

  return {
    constraints, commitments, dispatches,
    addConstraint, toggleConstraint, removeConstraint,
    setCommit, reviewCommit, markDispatched,
    isLoading,
    /** 'local-only' = the server copy could not be reached (or signed out). */
    syncState,
  };
}
