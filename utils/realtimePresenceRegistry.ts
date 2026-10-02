// utils/realtimePresenceRegistry.ts — one shared presence channel per topic.
//
// Presence peers must share a topic (`schedule:<projectId>`, which the
// private-channel RLS policy also requires), so presence can't use a
// per-mount topic the way postgres_changes channels do (utils/realtimeTopic.ts).
// realtime-js returns the EXISTING channel for a repeated topic, and adding a
// listener to a channel that already subscribed THROWS ("cannot add `presence`
// callbacks for realtime:schedule:… after `subscribe()`"). That crashed the
// web app whenever the presence effect re-ran (a profile name loading, a
// second mount on the desktop stack) while the previous channel's async
// removeChannel was still pending.
//
// So: one channel per topic, created once with its listener attached BEFORE
// subscribe, shared by every mount through a ref count, and removed only when
// the last mount leaves. A new acquire waits for a removal still in flight.
// The client is injected so the logic is testable without a socket
// (scripts/validate-realtime-topics.ts).

export interface PresenceClientLike<C> {
  channel(topic: string, opts: { config: { private: boolean; presence: { key: string } } }): C;
  /** Attach the presence 'sync' listener (called once per channel, before subscribe). */
  onSync(channel: C, cb: () => void): void;
  subscribe(channel: C, cb: (status: string) => void): void;
  track(channel: C, payload: Record<string, unknown>): unknown;
  removeChannel(channel: C): Promise<unknown>;
  setAuth?: () => Promise<unknown>;
}

interface Entry<C> {
  channel: C;
  refs: number;
  listeners: Set<() => void>;
  subscribed: boolean;
  lastTrack: Record<string, unknown> | null;
}

export interface PresenceLease<C> {
  channel: C;
  /** Track this user's presence now, and again after every re-subscribe. */
  track(payload: Record<string, unknown>): void;
  release(): void;
}

export function createPresenceRegistry<C>(client: PresenceClientLike<C>) {
  const entries = new Map<string, Entry<C>>();
  const removing = new Map<string, Promise<unknown>>();

  function create(topic: string, presenceKey: string): Entry<C> {
    const channel = client.channel(topic, { config: { private: true, presence: { key: presenceKey } } });
    const entry: Entry<C> = { channel, refs: 0, listeners: new Set(), subscribed: false, lastTrack: null };
    // The ONLY listener on this channel, attached before subscribe; mounts
    // register with the registry instead of with the channel.
    client.onSync(channel, () => { for (const fn of entry.listeners) fn(); });
    void (async () => {
      // A private join is authorised by the user's JWT, which the socket only
      // carries after setAuth() resolves: subscribe after it, never before.
      try { await client.setAuth?.(); } catch { /* the join is refused; presence stays empty */ }
      if (entries.get(topic) !== entry) return;
      client.subscribe(channel, (status) => {
        if (status !== 'SUBSCRIBED') return;
        entry.subscribed = true;
        if (entry.lastTrack) void client.track(channel, entry.lastTrack);
      });
    })();
    return entry;
  }

  /** Join `topic`; `onSync` runs on every presence sync. Resolves after any
   *  removal of the same topic still in flight has finished. */
  async function acquire(topic: string, presenceKey: string, onSync: () => void): Promise<PresenceLease<C>> {
    const pending = removing.get(topic);
    if (pending) { try { await pending; } catch { /* removal failed; create anyway */ } }
    let entry = entries.get(topic);
    if (!entry) { entry = create(topic, presenceKey); entries.set(topic, entry); }
    const e = entry;
    e.refs += 1;
    e.listeners.add(onSync);
    let released = false;
    return {
      channel: e.channel,
      track(payload) {
        if (released) return;
        e.lastTrack = payload;
        if (e.subscribed) void client.track(e.channel, payload);
      },
      release() {
        if (released) return;
        released = true;
        e.listeners.delete(onSync);
        e.refs -= 1;
        if (e.refs > 0 || entries.get(topic) !== e) return;
        entries.delete(topic);
        const p = client.removeChannel(e.channel);
        removing.set(topic, p);
        void p.finally(() => { if (removing.get(topic) === p) removing.delete(topic); });
      },
    };
  }

  return { acquire, _size: () => entries.size };
}
