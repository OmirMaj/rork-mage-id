// hooks/useLiveSchedule.ts
//
// Live schedule sync (Phase 2). Subscribes to the project row over Supabase
// Realtime; when the persisted schedule changes (a peer's save — or this
// device's own), hands the new task list and its save stamp
// (`schedule.updatedAt`) to the caller.
//
// Every event includes this device's OWN saves coming back, and they are not
// harmless: one can arrive after a newer save already left (saves ~1 s apart,
// or an offline queue replaying), holding values older than the working copy.
// Schedule Pro places each event in time by its stamp and only ever adopts a
// server copy while it has nothing of its own still leaving
// (utils/scheduleMerge.ts). Realtime does not replay what it missed while the
// socket was down (a sleeping laptop, iOS background), so `onGap` fires when
// the channel subscribes again after a drop — the caller re-reads the row.

import { useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { ScheduleTask } from '@/types';

export interface LiveScheduleCopy {
  tasks: ScheduleTask[];
  stamp: string | null;
  /** The row's named baselines (utils/scheduleMerge.ts ScheduleCopy has why). */
  baselines?: unknown[];
}

export function useLiveSchedule(
  projectId: string | undefined,
  onPeerSchedule: (copy: LiveScheduleCopy) => void,
  onGap?: () => void,
) {
  const cbRef = useRef(onPeerSchedule);
  cbRef.current = onPeerSchedule;
  const gapRef = useRef(onGap);
  gapRef.current = onGap;

  useEffect(() => {
    if (!projectId) return;
    // The first SUBSCRIBED is the join; any later one follows a drop
    // (CHANNEL_ERROR / TIMED_OUT / CLOSED, then realtime-js rejoins).
    let joined = false;
    let dropped = false;
    const channel = supabase
      .channel(`project-live:${projectId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        (payload) => {
          const schedule = (payload.new as { schedule?: { tasks?: ScheduleTask[]; updatedAt?: unknown; baselines?: unknown } })?.schedule;
          const tasks = schedule?.tasks;
          if (!Array.isArray(tasks)) return;
          const stamp = typeof schedule?.updatedAt === 'string' ? schedule.updatedAt : null;
          cbRef.current({ tasks, stamp, baselines: Array.isArray(schedule?.baselines) ? schedule.baselines : undefined });
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (joined && dropped) gapRef.current?.();
          joined = true;
          dropped = false;
        } else {
          dropped = true;
        }
      });

    return () => { void supabase.removeChannel(channel); };
  }, [projectId]);
}
