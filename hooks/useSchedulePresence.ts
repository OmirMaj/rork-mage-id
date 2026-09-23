// hooks/useSchedulePresence.ts
//
// Supabase Realtime Presence for the collaborative schedule (Phase 2). Tracks
// who's viewing the schedule and which task each person has selected/is editing,
// on a per-project channel. Peers' selected tasks drive the soft-lock in the
// Gantt so two people don't grab the same bar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface SchedulePeer {
  userId: string;
  name: string;
  color: string;
  selectedTaskId: string | null;
}

/** Stable, readable color per user (HSL from a hash of the user id). */
export function colorForUser(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 65% 45%)`;
}

export function useSchedulePresence(
  projectId: string | undefined,
  self: { userId: string; name: string } | null,
) {
  const [peers, setPeers] = useState<SchedulePeer[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const selectedRef = useRef<string | null>(null);
  const selfColor = useMemo(() => (self ? colorForUser(self.userId) : '#888'), [self?.userId]);

  useEffect(() => {
    if (!projectId || !self) return;
    // PRIVATE channel (#169). A public channel named `schedule:<projectId>`
    // was readable with the anon key alone, and the project id is not a
    // secret (the homeowner portal carries it; a removed collaborator keeps
    // it), so anyone holding it could list who was editing and track() a fake
    // peer into PresenceBar. Private channels are authorised by RLS on
    // realtime.messages — migration 20260923160000 allows SELECT / INSERT on
    // 'schedule:<id>' topics only to authenticated users who pass
    // can_access_project(<id>, 'viewer'). ORDER: that migration ships BEFORE
    // this code; a private join with no policy is refused and presence dies
    // silently.
    const channel = supabase.channel(`schedule:${projectId}`, {
      config: { private: true, presence: { key: self.userId } },
    });
    channelRef.current = channel;
    let cancelled = false;

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<SchedulePeer>();
      const list: SchedulePeer[] = [];
      for (const key of Object.keys(state)) {
        const metas = state[key];
        if (metas && metas.length) {
          const m = metas[metas.length - 1];
          // A peer is keyed by its presence key (its own user id). A meta that
          // claims a different userId than the key it arrived under is a
          // forged identity — drop it rather than show it.
          if (m.userId !== key) continue;
          list.push({ userId: m.userId, name: m.name, color: m.color, selectedTaskId: m.selectedTaskId ?? null });
        }
      }
      setPeers(list.filter((p) => p.userId !== self.userId));
    });

    // The join is authorised by the user's JWT, which the realtime socket
    // only carries once setAuth() has handed it the current session token —
    // subscribe after it resolves, never before (a join with the anon key is
    // refused by the private-channel policy).
    void (async () => {
      try {
        await supabase.realtime.setAuth();
      } catch (err) {
        console.log('[SchedulePresence] realtime setAuth failed:', err);
      }
      if (cancelled) return;
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ userId: self.userId, name: self.name, color: selfColor, selectedTaskId: selectedRef.current });
        }
      });
    })();

    return () => {
      cancelled = true;
      channelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [projectId, self?.userId, self?.name, selfColor]);

  const setSelectedTask = useCallback((taskId: string | null) => {
    if (selectedRef.current === taskId) return;
    selectedRef.current = taskId;
    const ch = channelRef.current;
    if (ch && self) {
      void ch.track({ userId: self.userId, name: self.name, color: selfColor, selectedTaskId: taskId });
    }
  }, [self?.userId, self?.name, selfColor]);

  return { peers, setSelectedTask, selfColor };
}
