// usePlanRooms — local-first store for the Plan Intelligence flow.
//
// Two pieces of state, both AsyncStorage-backed and shared across screens via
// the react-query cache (same data layer as useMaterialReceipts):
//
//   - memory   (`tertiary_plan_room_memory`)   — the per-room-type learning
//     state: sqft correction factors, learned $/SF rates, recent notes. This
//     is GLOBAL (not per project): the AI's read on "how this GC's plans run"
//     transfers between jobs — that's the whole point.
//   - sessions (`tertiary_plan_room_sessions`) — the last confirmed room set
//     per project, so reopening a project shows where the GC left off instead
//     of forcing a re-analyze.
//
// Cloud sync is an intentional follow-up (same posture as material receipts).

import { useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PlanRoom, PlanRoomMemory } from '@/utils/planIntelligence';

const MEMORY_KEY = 'tertiary_plan_room_memory';
const SESSIONS_KEY = 'tertiary_plan_room_sessions';
const MEMORY_QK = ['plan-room-memory'] as const;
const SESSIONS_QK = ['plan-room-sessions'] as const;

export interface PlanRoomSession {
  projectId: string;
  planSheetId?: string;
  imageUri?: string;
  rooms: PlanRoom[];
  updatedAt: string;
}

type SessionMap = Record<string, PlanRoomSession>;

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function persistJson(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.log('[planRooms] persist failed:', err);
  }
}

export function usePlanRooms() {
  const queryClient = useQueryClient();

  const { data: memory = {} as PlanRoomMemory, isLoading: memoryLoading } = useQuery({
    queryKey: MEMORY_QK,
    queryFn: () => loadJson<PlanRoomMemory>(MEMORY_KEY, {}),
  });

  const { data: sessions = {} as SessionMap, isLoading: sessionsLoading } = useQuery({
    queryKey: SESSIONS_QK,
    queryFn: () => loadJson<SessionMap>(SESSIONS_KEY, {}),
  });

  const memoryMutation = useMutation({
    mutationFn: async (next: PlanRoomMemory) => {
      await persistJson(MEMORY_KEY, next);
      return next;
    },
    onSuccess: next => queryClient.setQueryData(MEMORY_QK, next),
  });

  const sessionsMutation = useMutation({
    mutationFn: async (next: SessionMap) => {
      await persistJson(SESSIONS_KEY, next);
      return next;
    },
    onSuccess: next => queryClient.setQueryData(SESSIONS_QK, next),
  });

  const setMemory = useCallback((next: PlanRoomMemory) => {
    memoryMutation.mutate(next);
  }, [memoryMutation]);

  const saveSession = useCallback((session: PlanRoomSession) => {
    const current = (queryClient.getQueryData<SessionMap>(SESSIONS_QK)) ?? sessions;
    sessionsMutation.mutate({ ...current, [session.projectId]: session });
  }, [queryClient, sessions, sessionsMutation]);

  const getSession = useCallback((projectId: string): PlanRoomSession | null => {
    return sessions[projectId] ?? null;
  }, [sessions]);

  return {
    memory,
    setMemory,
    sessions,
    saveSession,
    getSession,
    isLoading: memoryLoading || sessionsLoading,
  };
}
