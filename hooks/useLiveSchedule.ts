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
//
// ONE CHANNEL PER MOUNT. realtime-js's `supabase.channel(topic)` returns the
// EXISTING channel when the topic matches. The phone Schedule tab stays mounted
// under the stack, so Schedule Pro pushed over it for the same job used to get
// the tab's already-subscribed channel back (a listener added after subscribe
// is ignored), and its removeChannel on unmount then tore down the tab's
// subscription too — the tab went silently stale. Every mount now owns its
// topic: `project-live:<id>:<scope>`, where scope is the caller's name for
// itself plus a per-mount id, so even two mounts of the same screen differ.

import { useEffect, useRef } from 'react';

let mountSeq = 0;
import { supabase } from '@/lib/supabase';
import { scheduleCopyFromRow, type ServerScheduleCopy } from '@/utils/fieldScheduleUpdate';

/** A live copy of the row's schedule — utils/fieldScheduleUpdate.ts
 *  ServerScheduleCopy has the fields and why activeBaselineId is carried (#86). */
export type LiveScheduleCopy = ServerScheduleCopy;
/** Read a projects row's `schedule` (a realtime payload.new.schedule, or a
 *  re-read of the column) the one way every live path reads it. */
export const liveScheduleCopyFromRow = scheduleCopyFromRow;

export function useLiveSchedule(
  projectId: string | undefined,
  onPeerSchedule: (copy: LiveScheduleCopy) => void,
  onGap?: () => void,
  /** The caller's name for itself in the channel topic ('schedule-pro',
   *  'schedule-tab'); a per-mount id is appended either way. */
  scope: string = 'schedule',
) {
  const mountIdRef = useRef<number | null>(null);
  if (mountIdRef.current == null) { mountSeq += 1; mountIdRef.current = mountSeq; }
  const topicSuffix = `${scope}-${mountIdRef.current}`;
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
      .channel(`project-live:${projectId}:${topicSuffix}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` },
        (payload) => {
          const copy = liveScheduleCopyFromRow((payload.new as { schedule?: unknown } | null)?.schedule);
          if (copy) cbRef.current(copy);
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
  }, [projectId, topicSuffix]);
}
