import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { PortalMessage, ClientCOApproval } from '@/types';

// Fetches the GC↔client message thread for a project AND any pending CO
// approvals. RLS scopes both tables to projects the GC owns.

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

export function usePortalThread(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const enabled = !!projectId && isSupabaseConfigured;

  const messagesQ = useQuery({
    queryKey: ['portalMessages', projectId],
    enabled,
    queryFn: async (): Promise<PortalMessage[]> => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from('portal_messages')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) {
        console.log('[usePortalThread] msg fetch failed:', error.message);
        return [];
      }
      return ((data ?? []) as MessageRow[]).map(rowToMessage);
    },
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
  });

  const approvalsQ = useQuery({
    queryKey: ['portalCoApprovals', projectId],
    enabled,
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
    mutationFn: async (args: { portalId: string; body: string; authorName?: string }) => {
      const { error } = await supabase.from('portal_messages').insert({
        portal_id: args.portalId,
        author_type: 'gc',
        author_name: args.authorName ?? null,
        body: args.body,
        read_by_gc: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['portalMessages', projectId] });
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
      void queryClient.invalidateQueries({ queryKey: ['portalMessages', projectId] });
    },
  });

  const sendMessage = useCallback(
    (args: { portalId: string; body: string; authorName?: string }) =>
      sendMessageMutation.mutate(args),
    [sendMessageMutation],
  );

  // Realtime subscription — invalidates the cached queries the moment
  // a portal message or CO approval lands. Listeners registered BEFORE
  // .subscribe(); existing-channel guard prevents the strict-mode
  // double-subscribe warning.
  useEffect(() => {
    if (!enabled || !projectId) return;
    const channelName = `portal-thread-${projectId}`;
    const existing = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existing) return;

    const channel = supabase.channel(channelName);
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'portal_messages', filter: `project_id=eq.${projectId}` },
      () => { void queryClient.invalidateQueries({ queryKey: ['portalMessages', projectId] }); },
    );
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'change_order_approvals', filter: `project_id=eq.${projectId}` },
      () => { void queryClient.invalidateQueries({ queryKey: ['portalCoApprovals', projectId] }); },
    );
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, projectId, queryClient]);

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
