// hooks/useSchedulePresence.ts
//
// Supabase Realtime Presence for the collaborative schedule (Phase 2). Tracks
// who's viewing the schedule and which task each person has selected/is editing,
// on a per-project channel. Peers' selected tasks drive the soft-lock in the
// Gantt so two people don't grab the same bar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { createPresenceRegistry, type PresenceLease } from '@/utils/realtimePresenceRegistry';

/** One registry for the app: every mount of the schedule shares one channel per job. */
const presenceRegistry = createPresenceRegistry<RealtimeChannel>({
  channel: (topic, opts) => supabase.channel(topic, opts),
  onSync: (ch, cb) => { ch.on('presence', { event: 'sync' }, cb); },
  subscribe: (ch, cb) => { ch.subscribe((status) => cb(status)); },
  track: (ch, payload) => ch.track(payload),
  removeChannel: (ch) => supabase.removeChannel(ch),
  setAuth: () => supabase.realtime.setAuth(),
});

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
  const leaseRef = useRef<PresenceLease<RealtimeChannel> | null>(null);
  const selectedRef = useRef<string | null>(null);
  const selfColor = useMemo(() => (self ? colorForUser(self.userId) : '#888'), [self?.userId]);

  useEffect(() => {
    if (!projectId || !self) return;
    // PRIVATE channel (#169). A public channel named `schedule:<projectId>`
    // was readable with the anon key alone, and the project id is not a
    // secret, so anyone holding it could list who was editing and track() a
    // fake peer into PresenceBar. Private channels are authorised by RLS on
    // realtime.messages — migration 20260923160000 allows SELECT / INSERT on
    // 'schedule:<id>' topics only to users who pass can_access_project(<id>,
    // 'viewer').
    //
    // SHARED, ref-counted channel (utils/realtimePresenceRegistry.ts): this
    // effect re-runs when the name loads, and the desktop stack can keep two
    // mounts alive, so a fresh supabase.channel() here got back the previous,
    // already-subscribed channel and realtime-js threw "cannot add `presence`
    // callbacks … after `subscribe()`" — the web app's "This screen hit an
    // error" on any page.
    let cancelled = false;
    let lease: PresenceLease<RealtimeChannel> | null = null;
    const onSync = () => {
      const ch = lease?.channel;
      if (!ch) return;
      const state = ch.presenceState<SchedulePeer>();
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
    };
    void (async () => {
      try {
        const l = await presenceRegistry.acquire(`schedule:${projectId}`, self.userId, onSync);
        if (cancelled) { l.release(); return; }
        lease = l;
        leaseRef.current = l;
        l.track({ userId: self.userId, name: self.name, color: selfColor, selectedTaskId: selectedRef.current });
        onSync();
      } catch (err) {
        // Presence is a nicety: it must never take the screen down.
        console.log('[SchedulePresence] presence unavailable:', err);
      }
    })();

    return () => {
      cancelled = true;
      if (leaseRef.current === lease) leaseRef.current = null;
      lease?.release();
      lease = null;
    };
  }, [projectId, self?.userId, self?.name, selfColor]);

  const setSelectedTask = useCallback((taskId: string | null) => {
    if (selectedRef.current === taskId) return;
    selectedRef.current = taskId;
    const l = leaseRef.current;
    if (l && self) {
      l.track({ userId: self.userId, name: self.name, color: selfColor, selectedTaskId: taskId });
    }
  }, [self?.userId, self?.name, selfColor]);

  return { peers, setSelectedTask, selfColor };
}
