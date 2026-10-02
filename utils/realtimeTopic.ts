// utils/realtimeTopic.ts — one realtime topic per mount.
//
// realtime-js's `supabase.channel(topic)` returns the EXISTING channel when a
// channel with that topic is still registered. Two mounts of the same screen
// (a desktop stack keeps screens alive; a fast remount races the async
// removeChannel of the last one) then share one channel: the second mount's
// `.on(...)` lands after `subscribe()` and realtime-js THROWS ("cannot add
// `postgres_changes` callbacks for realtime:… after `subscribe()`"), which the
// root error boundary shows as "This screen hit an error". And the old
// workaround (skip when a channel already exists) left the second mount with
// no live updates at all.
//
// postgres_changes channels authorise by the table's RLS, not by the topic,
// so every mount can safely own its own topic. Presence channels are
// different (peers must share a topic): see hooks/useSchedulePresence.ts.

let seq = 0;

/** `base` plus a per-mount suffix, so no two mounts ever share a channel. */
export function mountTopic(base: string): string {
  seq += 1;
  return `${base}:m${seq}`;
}
