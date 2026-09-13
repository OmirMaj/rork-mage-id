import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/contexts/AuthContext';
import { useCoreData } from '@/contexts/ProjectContext';
import { supabase } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { showAlert } from '@/utils/alert';
import {
  registerForPushNotifications,
  addNotificationResponseListener,
} from '@/utils/notifications';
import {
  decidePushAsk, pushAskCopy,
  type PushAskMoment, type PushPermission,
} from '@/utils/pushPermissionAsk';
import { usePortalApprovalReconciler } from '@/hooks/usePortalApprovalReconciler';

/** Records that this device has had its one contextual push ask. `mageid_` so
 *  the tenant-switch sweep in utils/localCacheKeys.ts covers it: the record
 *  belongs to the person who was asked, so the next contractor to sign in on a
 *  shared site iPad is evaluated fresh rather than inheriting a stranger's "no".
 *  Evaluated, not necessarily asked — the OS answer is device-wide, so if the
 *  first contractor tapped Don't Allow, the second one gets no dialog either
 *  (decidePushAsk returns canAskAgain:false) and their token is only earned
 *  once someone turns notifications on in iOS Settings. What the sweep buys is
 *  that a grant already on the device is picked up for the NEW user and their
 *  own push_token written, instead of the app deciding it had already dealt
 *  with this person. */
const PUSH_ASK_KEY = 'mageid_push_ask_v1';

export const [NotificationProvider, useNotifications] = createContextHook(() => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  // NotificationProvider is mounted below ProjectProvider (app/_layout.tsx), so
  // the onboarding flag is readable here — it is what keeps the contextual push
  // ask from firing inside first-run. useCoreData rather than useProjects: this
  // provider only needs that one flag, and subscribing to all seven domain
  // contexts would re-run it on every unrelated invoice or punch-item change.
  const { hasSeenOnboarding } = useCoreData();
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [badgeCount, setBadgeCount] = useState(0);
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);

  // Watch for portal CO approvals and fold them onto the underlying
  // ChangeOrder records. Runs on a 90s poll while the GC is signed in.
  usePortalApprovalReconciler();

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    console.log('[NotificationContext] Registering for push notifications');
    void registerForPushNotifications().then(async (token) => {
      if (token) {
        setPushToken(token);
        console.log('[NotificationContext] Push token obtained');

        if (user.id) {
          // Route through the offline queue. A direct .update() here both
          // lost the token in airplane mode AND silently swallowed failures:
          // supabase-js RESOLVES (never rejects) on an RLS/constraint error,
          // so the try/catch never fired and the returned { error } was
          // ignored. supabaseWrite enqueues transient/offline writes for
          // retry on reconnect and toasts + reports genuine terminal
          // failures. Update op keyed on the user id.
          await supabaseWrite('profiles', 'update', { id: user.id, push_token: token });
          console.log('[NotificationContext] Push token save routed through offline queue');
        }
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
      if (kind === 'margin_alert') {
        // A single-job alert lands on that job's Margin Risk; a roll-up lands
        // on the alerts inbox to triage.
        router.push(projectId ? `/margin-risk?projectId=${projectId}` : '/margin-alerts');
        return;
      }
      if (kind === 'morning_brief') {
        // The local nudge (utils/brief/nudge.ts) and the server digest push
        // (morning-digest edge fn) both land here — open the brief itself.
        router.push('/brief');
        return;
      }
      if (kind === 'week_close') {
        // The local Friday Close nudge (utils/weekClose/nudge.ts) — open the
        // week-close modal directly.
        router.push('/week-close');
        return;
      }
      if (kind === 'ask_seed') {
        // A margin/brief push can open MAGE already answering the question the
        // alert raised, instead of dropping the user on a raw table. The backend
        // payload (seed/screen) is additive — until it ships, a bare ask_seed
        // simply opens Ask, and older pushes fall through unchanged.
        const seed = data?.seed as string | undefined;
        const screen = data?.screen as string | undefined;
        router.push(seed
          ? { pathname: '/ask', params: { seed, ...(screen ? { screen } : {}) } }
          : '/ask');
        return;
      }

      // PRODUCT-F8: the seven server push kinds that fell through to a no-op.
      // Field names come from supabase/functions/notify/index.ts pushData —
      // `rfpId` for the RFP family, `projectId` (+portalId) for the portal family.
      const rfpId = data?.rfpId as string | undefined;
      if ((kind === 'nearby_rfp_posted' || kind === 'bid_question_asked' || kind === 'bid_question_answered') && rfpId) {
        router.push(`/rfp-detail?bidId=${rfpId}`);
        return;
      }
      if (kind === 'rfp_awarded' && projectId) {
        router.push(`/project-detail?id=${projectId}`);
        return;
      }
      if (kind === 'contract_signed' && projectId) {
        router.push(`/contract?projectId=${projectId}`);
        return;
      }
      if (kind === 'selection_chosen' && projectId) {
        router.push(`/selections?projectId=${projectId}`);
        return;
      }
      if (kind === 'closeout_binder_sent_confirmation' && projectId) {
        router.push(`/closeout-binder?projectId=${projectId}`);
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

  // ── The one contextual push ask ────────────────────────────────────────
  // The effect above registers a token only when permission was ALREADY
  // granted in an earlier session. Nothing in the app raised the dialog except
  // a toggle inside Settings → Notifications, so the notify function, the
  // outbox, morning-digest and invoice-dunning all had no device to reach for
  // a user who never went looking for that screen. This is where that is
  // fixed, and it is the ONLY other place in the app that passes
  // `prompt: true` — a second permission path would race this one and could
  // spend the single iOS dialog with no context attached.
  //
  // 'idle' → free to evaluate; 'busy' → an evaluation is in flight;
  // 'settled' → this session has finished with it, whatever the answer.
  const askStateRef = useRef<'idle' | 'busy' | 'settled'>('idle');

  const enablePush = useCallback(async () => {
    const token = await registerForPushNotifications({ prompt: true });
    if (!token) return;
    setPushToken(token);
    if (user?.id) {
      // Same reasoning as the registration effect: through the offline queue so
      // a token earned on jobsite connectivity is retried rather than lost, and
      // an RLS failure surfaces instead of resolving silently.
      await supabaseWrite('profiles', 'update', { id: user.id, push_token: token });
    }
  }, [user?.id]);

  const maybeAskForPush = useCallback(async (moment: PushAskMoment): Promise<void> => {
    if (askStateRef.current !== 'idle') return;
    askStateRef.current = 'busy';
    try {
      const isWeb = Platform.OS === 'web';
      const stored = isWeb ? null : await AsyncStorage.getItem(PUSH_ASK_KEY);
      const perms = isWeb
        ? { status: 'undetermined' as const, canAskAgain: false }
        : await Notifications.getPermissionsAsync();

      const decision = decidePushAsk({
        platform: Platform.OS,
        hasSeenOnboarding,
        signedIn: isAuthenticated && !!user,
        alreadyAsked: stored !== null,
        permission: (perms.status as PushPermission) ?? 'undetermined',
        canAskAgain: perms.canAskAgain !== false,
      });

      if (!decision.ask) {
        if (decision.remember) {
          await AsyncStorage.setItem(PUSH_ASK_KEY, JSON.stringify({
            askedAt: new Date().toISOString(), moment, outcome: decision.because,
          }));
          askStateRef.current = 'settled';
          // Permission already granted but no token on the profile yet (a
          // reinstall, or a token write that failed while offline) — take it
          // without a dialog.
          if (perms.status === 'granted' && !pushToken) void enablePush();
        } else {
          // Everything the decision refuses WITHOUT recording it: still loading
          // the onboarding flag, signed out, mid-onboarding — and also web and
          // "already asked", which are settled but need no new record. The ref
          // goes back to idle for all of them because the transient ones are
          // the ones that matter: latching shut on a render that landed while
          // ProjectContext was still loading would cost the user the ask for
          // the life of the install. Re-evaluating costs one AsyncStorage read
          // and one permissions read per qualifying moment; getting it wrong
          // costs the ask itself.
          askStateRef.current = 'idle';
        }
        return;
      }

      // Record the ask BEFORE the dialog goes up, not after. A soft ask that is
      // dismissed by a backgrounding, a crash, or a fast second call must still
      // count as the one ask — "never asked twice" is the promise, and a
      // write-after-answer loses that race.
      await AsyncStorage.setItem(PUSH_ASK_KEY, JSON.stringify({
        askedAt: new Date().toISOString(), moment, outcome: 'prompted',
      }));
      askStateRef.current = 'settled';

      // Soft ask first. Declining here costs nothing: the OS dialog is never
      // raised, so the one permanent iOS answer stays unspent and the user can
      // still turn notifications on later from Settings → Notifications.
      const copy = pushAskCopy(moment);
      showAlert(copy.title, copy.body, [
        { text: copy.decline, style: 'cancel' },
        { text: copy.confirm, onPress: () => { void enablePush(); } },
      ]);
    } catch (err) {
      // A storage or permissions read that throws must not leave the ask
      // latched shut forever.
      askStateRef.current = 'idle';
      console.warn('[NotificationContext] push ask skipped:', err);
    }
  }, [hasSeenOnboarding, isAuthenticated, user, pushToken, enablePush]);

  return useMemo(() => ({
    pushToken,
    badgeCount,
    clearBadge,
    incrementBadge,
    maybeAskForPush,
  }), [pushToken, badgeCount, clearBadge, incrementBadge, maybeAskForPush]);
});
