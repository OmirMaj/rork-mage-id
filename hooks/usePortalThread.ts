import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
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

  const sendMessageMutation = useMutation({
    mutationFn: async (args: { portalId: string; projectId?: string; body: string; authorName?: string }) => {
      const { error } = await supabase.from('portal_messages').insert({
        portal_id: args.portalId,
        // Set project_id so future rows are properly tagged. Old rows
        // (incl. messages from the web portal) may still be null — fine,
        // we filter by portal_id which is always set.
        project_id: args.projectId ?? null,
        author_type: 'gc',
        author_name: args.authorName ?? null,
        body: args.body,
        read_by_gc: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['portalMessages', portalId] });
    },
  });

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

  const sendMessage = useCallback(
    (args: { portalId: string; projectId?: string; body: string; authorName?: string }) =>
      sendMessageMutation.mutate(args),
    [sendMessageMutation],
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
    messages: messagesQ.data ?? [],
    unreadFromClient: (messagesQ.data ?? []).filter(m => m.authorType === 'client' && !m.readByGc),
    coApprovals: approvalsQ.data ?? [],
    sendMessage,
    markRead: (id: string) => markReadMutation.mutate(id),
    isSending: sendMessageMutation.isPending,
    refetchMessages: messagesQ.refetch,
    refetchApprovals: approvalsQ.refetch,
  };
}
