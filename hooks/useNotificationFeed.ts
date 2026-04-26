import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// Reads notification_outbox rows the GC owns and surfaces them as an
// in-app feed. Pairs with push + email — push is the urgent ping, this
// is the durable history with deep-link tap-throughs.

export interface NotificationFeedItem {
  id: string;
  eventType: string;
  sourceTable: string | null;
  sourceId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
  pushStatus: string | null;
  emailStatus: string | null;
}

interface Row {
  id: string;
  event_type: string;
  source_table: string | null;
  source_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  push_status: string | null;
  email_status: string | null;
}

function rowToItem(r: Row): NotificationFeedItem {
  return {
    id: r.id,
    eventType: r.event_type,
    sourceTable: r.source_table,
    sourceId: r.source_id,
    payload: r.payload ?? {},
    createdAt: r.created_at,
    readAt: r.read_at,
    pushStatus: r.push_status,
    emailStatus: r.email_status,
  };
}

export function useNotificationFeed() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!user?.id && isSupabaseConfigured;

  const query = useQuery({
    queryKey: ['notificationFeed', user?.id ?? null],
    enabled,
    queryFn: async (): Promise<NotificationFeedItem[]> => {
      const { data, error } = await supabase
        .from('notification_outbox')
        .select('id, event_type, source_table, source_id, payload, created_at, read_at, push_status, email_status')
        .eq('recipient_user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(80);
      if (error) {
        console.log('[useNotificationFeed] fetch failed', error.message);
        return [];
      }
      return ((data ?? []) as Row[]).map(rowToItem);
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const markReadMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from('notification_outbox')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notificationFeed', user?.id ?? null] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notification_outbox')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notificationFeed', user?.id ?? null] });
    },
  });

  const markRead = useCallback(
    (ids: string[] | string) => markReadMutation.mutate(Array.isArray(ids) ? ids : [ids]),
    [markReadMutation],
  );
  const dismiss = useCallback(
    (id: string) => dismissMutation.mutate(id),
    [dismissMutation],
  );
  const markAllRead = useCallback(() => {
    const ids = (query.data ?? []).filter(i => !i.readAt).map(i => i.id);
    markReadMutation.mutate(ids);
  }, [query.data, markReadMutation]);

  const items = query.data ?? [];
  const unreadCount = useMemo(() => items.filter(i => !i.readAt).length, [items]);

  return {
    items,
    unreadCount,
    isLoading: query.isLoading,
    markRead,
    markAllRead,
    dismiss,
    refetch: query.refetch,
  };
}
