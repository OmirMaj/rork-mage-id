// hooks/useLiveSchedule.ts
//
// Live schedule sync (Phase 2). Subscribes to the project row over Supabase
// Realtime; when the persisted schedule changes (a peer's save), hands the new
// task list to the caller, which merges it into its working copy via
// mergeScheduleTasks (protecting the local user's selected task) and re-runs CPM.
//
// No echo-suppression needed: merging the local user's own persisted write is
// idempotent (incoming == their working copy for every non-protected task).

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScheduleTask } from '@/types';

export function useLiveSchedule(
  projectId: string | undefined,
  onPeerSchedule: (tasks: ScheduleTask[]) => void,
) {
  const cbRef = useRef(onPeerSchedule);
  cbRef.current = onPeerSchedule;

  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`project-live:${projectId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        (payload) => {
          const schedule = (payload.new as { schedule?: { tasks?: ScheduleTask[] } })?.schedule;
          const tasks = schedule?.tasks;
          if (Array.isArray(tasks)) cbRef.current(tasks);
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [projectId]);
}
