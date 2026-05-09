import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  registerForPushNotifications,
  addNotificationResponseListener,
} from '@/utils/notifications';
import { usePortalApprovalReconciler } from '@/hooks/usePortalApprovalReconciler';

export const [NotificationProvider, useNotifications] = createContextHook(() => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [badgeCount, setBadgeCount] = useState(0);
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  // Watch for portal CO approvals and fold them onto the underlying
  // ChangeOrder records. Runs on a 90s poll while the GC is signed in.
  usePortalApprovalReconciler();

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    // Persist a freshly-acquired Expo push token + the platform it
    // came from. The platform column lets the notify edge function
    // target only iOS / only Android when a feature flag rolls out
    // unevenly (e.g. iOS-first APNs entitlement). Idempotent — re-runs
    // are cheap because the row update is bounded to user.id.
    const persistToken = async (token: string) => {
      setPushToken(token);
      if (!user.id) return;
      try {
        await supabase
          .from('profiles')
          .update({
            push_token: token,
            push_token_platform: Platform.OS,
            push_token_updated_at: new Date().toISOString(),
          })
          .eq('id', user.id);
        console.log('[NotificationContext] Push token saved to Supabase');
      } catch (err) {
        console.log('[NotificationContext] Failed to save push token:', err);
      }
    };

    console.log('[NotificationContext] Registering for push notifications');
    void registerForPushNotifications().then((token) => {
      if (token) {
        console.log('[NotificationContext] Push token obtained');
        void persistToken(token);
      }
    });

    // Expo can rotate the push token at any time (app reinstall, OS
    // restore, FCM/APNs server-side rotation). Without listening for
    // that, the GC's phone will silently stop receiving pushes when
    // the server still sends to the old token. Hook the rotation
    // event so the new token lands in profiles within seconds.
    const tokenRotationSub = Notifications.addPushTokenListener((event) => {
      const newToken = (event as { data?: string } | undefined)?.data;
      if (typeof newToken === 'string' && newToken.length > 0) {
        console.log('[NotificationContext] Push token rotated by OS');
        void persistToken(newToken);
      }
    });

    responseListenerRef.current = addNotificationResponseListener((response) => {
      console.log('[NotificationContext] Notification tapped:', response.notification.request.content);
      const data = response.notification.request.content.data;

      const conversationId = data?.conversationId as string | undefined;
      const bidId = data?.bidId as string | undefined;
      const changeOrderId = data?.changeOrderId as string | undefined;
      // New: portal-driven events from the notify edge function. The
      // dispatcher sends `kind` to disambiguate; route to the right
      // surface so a tap from the lock screen lands the GC exactly
      // where they need to act.
      const kind = data?.kind as string | undefined;
      const projectId = data?.projectId as string | undefined;

      if (kind === 'portal_message' && projectId) {
        router.push(`/client-portal-setup?id=${projectId}`);
        return;
      }
      if (kind === 'budget_proposal' && projectId) {
        router.push(`/client-portal-setup?id=${projectId}`);
        return;
      }
      if (kind === 'co_approval' && projectId) {
        router.push(`/client-portal-setup?id=${projectId}`);
        return;
      }
      if (kind === 'sub_invoice') {
        router.push('/sub-portals');
        return;
      }

      if (conversationId) {
        router.push(`/messages?id=${conversationId}`);
      } else if (bidId) {
        router.push(`/bid-detail?id=${bidId}`);
      } else if (changeOrderId) {
        router.push(`/change-order?id=${changeOrderId}`);
      }
    });

    return () => {
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
        responseListenerRef.current = null;
      }
      try { tokenRotationSub.remove(); } catch { /* ok */ }
    };
  }, [isAuthenticated, user, router]);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    console.log('[NotificationContext] Setting up bid response realtime listener');

    const bidChannel = supabase
      .channel('realtime-bid-notifications')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'public_bids' },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          const oldR = payload.old as Record<string, unknown>;
          if (r.status !== oldR.status) {
            console.log('[Realtime] Bid status changed:', r.id, r.status);
            void queryClient.invalidateQueries({ queryKey: ['public_bids'] });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'change_orders' },
        (payload) => {
          const r = payload.new as Record<string, unknown>;
          const oldR = payload.old as Record<string, unknown>;
          if (r.status !== oldR.status) {
            console.log('[Realtime] Change order status changed:', r.id, r.status);
            void queryClient.invalidateQueries({ queryKey: ['changeOrders'] });
          }
        },
      )
      .subscribe((status) => {
        console.log('[NotificationContext] Bid/CO realtime status:', status);
      });

    return () => {
      void supabase.removeChannel(bidChannel);
    };
  }, [isAuthenticated, user, queryClient]);

  const clearBadge = useCallback(async () => {
    setBadgeCount(0);
    if (Platform.OS !== 'web') {
      try {
        await Notifications.setBadgeCountAsync(0);
      } catch { /* ok */ }
    }
  }, []);

  const incrementBadge = useCallback(() => {
    setBadgeCount(prev => {
      const next = prev + 1;
      if (Platform.OS !== 'web') {
        void Notifications.setBadgeCountAsync(next).catch(() => {});
      }
      return next;
    });
  }, []);

  return useMemo(() => ({
    pushToken,
    badgeCount,
    clearBadge,
    incrementBadge,
  }), [pushToken, badgeCount, clearBadge, incrementBadge]);
});
