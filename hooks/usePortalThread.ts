import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWriteDetailed, onQueueFlushed, onQueueChanged, onQueueDropped, getOwnOfflineQueue, type WriteOutcome } from '@/utils/offlineQueue';
import { oops } from '@/components/animations/NailItToast';
import { generateUUID } from '@/utils/generateId';
import type { PortalMessage, ClientCOApproval } from '@/types';

// Fetches the GC↔client message thread for a project AND any pending CO
// approvals. RLS scopes both tables to projects the GC owns.
//
// HISTORY — the messages query used to filter by `.eq('project_id', ...)`.
// That returned an empty list in production because the actual inserts on
// `portal_messages` (from both the web portal page and the GC's sendMessage
// mutation) only populate `portal_id`, never `project_id`. The bidirectional
// thread was effectively broken. Filtering by `portal_id` (which BOTH sides
// always set) fixed it; we now also write `project_id` on new GC sends so
// future rows are properly tagged for analytics.
//
// CO approvals continue to filter by `project_id` — the approval insert in
// the web portal sets it explicitly (see marketing/portal/index.html).

interface MessageRow {
  id: string;
  portal_id: string;
  project_id: string | null;
  invite_id: string | null;
  author_type: 'client' | 'gc';
  author_name: string | null;
  body: string;
  read_by_gc: boolean;
  read_by_client: boolean;
  created_at: string;
}

interface ApprovalRow {
  id: string;
  portal_id: string;
  project_id: string | null;
  invite_id: string | null;
  change_order_id: string;
  decision: 'approved' | 'declined';
  signer_name: string | null;
  signer_email: string | null;
  note: string | null;
  created_at: string;
}

function rowToMessage(r: MessageRow): PortalMessage {
  return {
    id: r.id,
    projectId: r.project_id ?? '',
    portalId: r.portal_id,
    authorType: r.author_type,
    authorName: r.author_name ?? '',
    inviteId: r.invite_id ?? undefined,
    body: r.body,
    createdAt: r.created_at,
    readByGc: r.read_by_gc,
    readByClient: r.read_by_client,
  };
}

// A queued `portal_messages` insert payload is the MessageRow the send built
// (see sendMessageMutation) — but it comes back from storage as untyped JSON,
// so check the fields the thread renders before trusting it.
function queuedRowToMessage(d: Record<string, unknown>): PortalMessage | null {
  if (typeof d.id !== 'string' || typeof d.portal_id !== 'string' || typeof d.body !== 'string') return null;
  return rowToMessage({
    id: d.id,
    portal_id: d.portal_id,
    project_id: typeof d.project_id === 'string' ? d.project_id : null,
    invite_id: typeof d.invite_id === 'string' ? d.invite_id : null,
    author_type: d.author_type === 'client' ? 'client' : 'gc',
    author_name: typeof d.author_name === 'string' ? d.author_name : null,
    body: d.body,
    read_by_gc: d.read_by_gc !== false,
    read_by_client: d.read_by_client === true,
    created_at: typeof d.created_at === 'string' ? d.created_at : new Date().toISOString(),
  });
}

function rowToApproval(r: ApprovalRow): ClientCOApproval {
  return {
    id: r.id,
    portalId: r.portal_id,
    projectId: r.project_id ?? undefined,
    inviteId: r.invite_id ?? undefined,
    changeOrderId: r.change_order_id,
    decision: r.decision,
    signerName: r.signer_name ?? undefined,
    signerEmail: r.signer_email ?? undefined,
    note: r.note ?? undefined,
    createdAt: r.created_at,
  };
}

interface UsePortalThreadOpts {
  projectId: string | undefined;
  /** REQUIRED for the message thread — the messages table is keyed off
   *  portal_id. If absent we return empty (so the hook still mounts
   *  cleanly on screens that don't yet know the portal). */
  portalId: string | undefined;
}

/** A sent message the server list does not carry yet, held until a fetch that
 *  post-dates `since` has completed (or the server list contains it). */
interface BridgedMessage { message: PortalMessage; since: number }

export function usePortalThread({ projectId, portalId }: UsePortalThreadOpts) {
  const queryClient = useQueryClient();
  const enabled = !!portalId && isSupabaseConfigured;

  const messagesQ = useQuery({
    queryKey: ['portalMessages', portalId],
    enabled,
    queryFn: async (): Promise<PortalMessage[]> => {
      if (!portalId) return [];
      const { data, error } = await supabase
        .from('portal_messages')
        .select('*')
        .eq('portal_id', portalId)
        .order('created_at', { ascending: true });
      if (error) {
        console.log('[usePortalThread] msg fetch failed:', error.message);
        return [];
      }
      return ((data ?? []) as MessageRow[]).map(rowToMessage);
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const approvalsQ = useQuery({
    queryKey: ['portalCoApprovals', projectId],
    enabled: !!projectId && isSupabaseConfigured,
    queryFn: async (): Promise<ClientCOApproval[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('change_order_approvals')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) {
        console.log('[usePortalThread] CO approvals fetch failed:', error.message);
        return [];
      }
      return ((data ?? []) as ApprovalRow[]).map(rowToApproval);
    },
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

  // SYNC-F8: the GC's send used to be a fire-and-forget insert — no onError,
  // no queue — while the composer cleared and buzzed "sent" regardless. Now the
  // row carries a client-generated id and goes through the offline queue: it
  // either lands ('synced'), is queued for the next flush ('queued'), or is
  // lost ('failed') — and the screen keeps the text in that last case.
  //
  // A9: the echo of a QUEUED message is derived from the persisted offline
  // queue itself — not component state — so a message sent offline is still in
  // the thread after the screen unmounts and remounts, right up to the flush.
  // (The previous `localSent` state died with the screen: leave and come back
  // while still offline and your own message had vanished.) `bridge` then
  // carries a message across the gap between "left the queue / landed" and
  // "the server list has been re-fetched", so the thread never blinks.
  const [queuedEcho, setQueuedEcho] = useState<PortalMessage[]>([]);
  const [bridge, setBridge] = useState<BridgedMessage[]>([]);
  const lastQueued = useRef(new Map<string, PortalMessage>());
  // A6 (round 3): ids of queued sends the flush gave up on (terminal error /
  // retry exhaustion). They never reached the server, so they must not be
  // bridged "until the next fetch" the way a landed message is — they are gone.
  const droppedIds = useRef(new Set<string>());

  const readQueuedEcho = useCallback(async () => {
    if (!portalId) return;
    let rows: PortalMessage[];
    try {
      // A6 (round 4): the OWN-session partition, not the raw queue. On a shared
      // device the persisted queue can still hold the previous tenant's entries
      // (they are dropped by the tenant switch, not by the flush) — echoing them
      // would print another contractor's message into this user's thread, and it
      // would never leave, because no flush under this JWT will ever send it.
      rows = (await getOwnOfflineQueue())
        .filter((m) => m.table === 'portal_messages' && m.operation === 'insert' && m.data?.portal_id === portalId)
        .map((m) => queuedRowToMessage(m.data ?? {}))
        .filter((m): m is PortalMessage => m !== null);
    } catch {
      return; // unreadable queue — keep whatever we last saw
    }
    const nowQueued = new Map(rows.map((m) => [m.id, m] as const));
    // Anything that was queued a moment ago and is not any more has just
    // been flushed (or dropped, which the queue toasts about) — keep showing
    // it until the next server fetch has had its say.
    const left: BridgedMessage[] = [];
    const since = Date.now();
    for (const [id, message] of lastQueued.current) {
      if (!nowQueued.has(id) && !droppedIds.current.has(id)) left.push({ message, since });
    }
    lastQueued.current = nowQueued;
    setQueuedEcho(rows);
    if (left.length > 0) setBridge((prev) => [...prev, ...left]);
  }, [portalId]);

  useEffect(() => {
    lastQueued.current = new Map();
    setQueuedEcho([]);
    void readQueuedEcho();
    // Fires after every enqueue and after every flush write-back.
    return onQueueChanged(() => { void readQueuedEcho(); });
  }, [readQueuedEcho]);

  // A6: a queued send the flush permanently dropped. The generic queue toast
  // can only say "portal_messages"; the person who typed it needs to know WHICH
  // message did not go. So it is named here in their own words, taken out of
  // the thread at once (not bridged like a landed message), and the server
  // list is re-pulled so nothing stale lingers. The entries are returned as
  // claimed, which keeps the generic toast quiet for them.
  useEffect(() => {
    if (!portalId) return;
    return onQueueDropped((dropped) => {
      const mine = dropped.filter((m) => m.table === 'portal_messages' && m.operation === 'insert' && m.data?.portal_id === portalId);
      if (mine.length === 0) return;
      const ids = new Set<string>();
      for (const m of mine) if (typeof m.data?.id === 'string') ids.add(m.data.id);
      for (const id of ids) droppedIds.current.add(id);
      setBridge((prev) => prev.filter((b) => !ids.has(b.message.id)));
      setQueuedEcho((prev) => prev.filter((m) => !ids.has(m.id)));
      void queryClient.invalidateQueries({ queryKey: ['portalMessages', portalId] });
      // A6 (round 4): ONE toast per flush, not one per message. A flush that
      // gives up on a thread gives up on all of it at once (same table, same
      // terminal cause), so N sends used to stack N toasts on the host — the
      // last one wins the screen and the user is told the least.
      const excerptOf = (m: (typeof mine)[number]): string => {
        const body = typeof m.data?.body === 'string' ? m.data.body.replace(/\s+/g, ' ').trim() : '';
        return body.length > 60 ? `${body.slice(0, 57)}…` : body;
      };
      const first = excerptOf(mine[0]);
      if (mine.length === 1) {
        oops(first ? `Message didn't send: “${first}” — please re-send it.` : "A message didn't send — please re-send it.");
      } else {
        oops(first
          ? `${mine.length} messages didn't send, starting with “${first}” — please re-send them.`
          : `${mine.length} messages didn't send — please re-send them.`);
      }
      return mine;
    });
  }, [portalId, queryClient]);

  // A bridged message is done once the server list carries it, or once a fetch
  // that started after it left the queue has completed (dataUpdatedAt is the
  // completion time of the last successful fetch).
  useEffect(() => {
    if (bridge.length === 0) return;
    const server = messagesQ.data;
    if (!server) return;
    const serverIds = new Set(server.map((m) => m.id));
    const fetchedAt = messagesQ.dataUpdatedAt;
    const next = bridge.filter((b) => !serverIds.has(b.message.id) && b.since >= fetchedAt);
    if (next.length !== bridge.length) setBridge(next);
  }, [messagesQ.data, messagesQ.dataUpdatedAt, bridge]);

  const sendMessageMutation = useMutation({
    mutationFn: async (args: { portalId: string; projectId?: string; body: string; authorName?: string }): Promise<{ outcome: WriteOutcome; message: PortalMessage }> => {
      const row: MessageRow = {
        id: generateUUID(),
        portal_id: args.portalId,
        // Set project_id so future rows are properly tagged. Old rows
        // (incl. messages from the web portal) may still be null — fine,
        // we filter by portal_id which is always set.
        project_id: args.projectId ?? null,
        invite_id: null,
        author_type: 'gc',
        author_name: args.authorName ?? null,
        body: args.body,
        read_by_gc: true,
        read_by_client: false,
        created_at: new Date().toISOString(),
      };
      const outcome = await supabaseWriteDetailed('portal_messages', 'insert', { ...row });
      if (outcome === 'failed') throw new Error('Message did not send');
      return { outcome, message: rowToMessage(row) };
    },
    onSuccess: ({ outcome, message }) => {
      if (outcome === 'synced') {
        // Landed directly: show it until the refetch below returns it.
        setBridge((prev) => [...prev, { message, since: Date.now() }]);
        void queryClient.invalidateQueries({ queryKey: ['portalMessages', portalId] });
      }
      // 'queued': the offline queue holds the row and readQueuedEcho (fired by
      // the enqueue's onQueueChanged) already shows it.
    },
  });

  // Merge the server list with the queued echo and the bridge, oldest first.
  const messages = useMemo((): PortalMessage[] => {
    const server = messagesQ.data ?? [];
    if (queuedEcho.length === 0 && bridge.length === 0) return server;
    const seen = new Set(server.map((m) => m.id));
    const extra: PortalMessage[] = [];
    for (const m of [...queuedEcho, ...bridge.map((b) => b.message)]) {
      if (m.portalId !== portalId || seen.has(m.id) || droppedIds.current.has(m.id)) continue;
      seen.add(m.id);
      extra.push(m);
    }
    if (extra.length === 0) return server;
    return [...server, ...extra].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [messagesQ.data, queuedEcho, bridge, portalId]);

  // A queued send just landed in a flush — pull the server's copy.
  useEffect(() => {
    if (!enabled) return;
    return onQueueFlushed((tables) => {
      if (tables.has('portal_messages')) {
        void queryClient.invalidateQueries({ queryKey: ['portalMessages', portalId] });
      }
    });
  }, [enabled, portalId, queryClient]);

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('portal_messages')
        .update({ read_by_gc: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['portalMessages', portalId] });
    },
  });

  // Client-authored send. client-view.tsx (the in-app portal preview the
  // client actually types into) pre-fix wrote to a LOCAL AsyncStorage
  // store while the GC read Supabase here — so client→GC replies were
  // silently lost. This inserts the row the GC's portal_id query sees.
  const sendClientMessageMutation = useMutation({
    mutationFn: async (args: { portalId: string; projectId?: string; body: string; authorName?: string; inviteId?: string }) => {
      const { error } = await supabase.from('portal_messages').insert({
        portal_id: args.portalId,
        project_id: args.projectId ?? null,
        invite_id: args.inviteId ?? null,
        author_type: 'client',
        author_name: args.authorName ?? null,
        body: args.body,
        read_by_client: true,
        read_by_gc: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['portalMessages', portalId] });
    },
  });

  // Resolves with the write's outcome so the composer can decide what to do
  // with the text — never rejects.
  const sendMessage = useCallback(
    async (args: { portalId: string; projectId?: string; body: string; authorName?: string }): Promise<WriteOutcome> => {
      try {
        return (await sendMessageMutation.mutateAsync(args)).outcome;
      } catch {
        return 'failed';
      }
    },
    [sendMessageMutation],
  );

  const sendClientMessage = useCallback(
    (args: { portalId: string; projectId?: string; body: string; authorName?: string; inviteId?: string }) =>
      sendClientMessageMutation.mutate(args),
    [sendClientMessageMutation],
  );

  // Realtime subscription — invalidates the cached queries the moment
  // a portal message or CO approval lands. Filtered by portal_id so we
  // pick up rows from the web portal (which doesn't set project_id).
  useEffect(() => {
    if (!enabled || !portalId) return;
    const channelName = `portal-thread-${portalId}`;
    const existing = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existing) return;

    const channel = supabase.channel(channelName);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'portal_messages', filter: `portal_id=eq.${portalId}` },
      () => { void queryClient.invalidateQueries({ queryKey: ['portalMessages', portalId] }); },
    );
    if (projectId) {
      channel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'change_order_approvals', filter: `project_id=eq.${projectId}` },
        () => { void queryClient.invalidateQueries({ queryKey: ['portalCoApprovals', projectId] }); },
      );
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, portalId, projectId, queryClient]);

  return {
    messages,
    unreadFromClient: messages.filter(m => m.authorType === 'client' && !m.readByGc),
    coApprovals: approvalsQ.data ?? [],
    sendMessage,
    sendClientMessage,
    markRead: (id: string) => markReadMutation.mutate(id),
    isSending: sendMessageMutation.isPending,
    isSendingClient: sendClientMessageMutation.isPending,
    refetchMessages: messagesQ.refetch,
    refetchApprovals: approvalsQ.refetch,
  };
}
