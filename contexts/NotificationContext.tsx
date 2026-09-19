import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, type Href } from 'expo-router';
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
// The one event -> screen table, shared with the notify edge function's email
// buttons and the in-app inbox (audit round 2, #12). Pure TS, no Deno globals.
import { notificationRoute, routeHref } from '@/supabase/functions/notify/routes';
import { coRealtimeShouldRefetch } from '@/utils/projectContextPure';

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
      // Server and local pushes carry `kind`; its screen comes from the shared
      // table (supabase/functions/notify/routes.ts), the same one the email
      // buttons and the inbox read. This handler used to keep its own copy,
      // which sent a signed-CO tap to the portal setup screen instead of the
      // change order (audit round 2, #12).
      const kind = data?.kind as string | undefined;

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
      // A website lead was inserted on the server seconds ago; the lead list
      // is read once and has no realtime, so re-read it before the screen
      // opens (lead-detail also waits for a fresh read before seeding a form).
      if (kind === 'lead_received') void queryClient.invalidateQueries({ queryKey: ['leads'] });
      const route = kind ? notificationRoute(kind, data as Record<string, unknown>) : null;
      if (route) {
        // Every pathname in the table is checked against app/ by
        // scripts/validate-notification-routes.ts — typed routes cannot see
        // through a runtime table, the validator does.
        router.push(routeHref(route) as Href);
        return;
      }

      // Pre-`kind` pushes (marketplace chat, bid responses, legacy CO pings).
      if (conversationId) {
        router.push(`/messages?id=${conversationId}`);
      } else if (bidId) {
        router.push(`/bid-detail?id=${bidId}`);
      } else if (changeOrderId) {
        router.push(`/change-order?coId=${changeOrderId}`);
      }
    });

    return () => {
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
        responseListenerRef.current = null;
      }
    };
  }, [isAuthenticated, user, router, queryClient]);

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
          // Not only a status change (#40): the client's sealed e-signature is
          // an audit-only append on the server (co_append_audit /
          // portal_submit_co_approval_signed), and it never reached the GC's
          // screen. utils/projectContextPure.coRealtimeShouldRefetch.
          if (coRealtimeShouldRefetch(r, oldR)) {
            console.log('[Realtime] Change order changed:', r.id, r.status);
            void queryClient.invalidateQueries({ queryKey: ['changeOrders'] });
          }
        },
      )
      // #56: the architect's answer (submit_pro_response) and a reply-portal
      // review cycle are server-side UPDATEs of the GC's own rfis/submittals
      // rows; nothing re-read those lists until a cold relaunch, so he kept
      // editing the pre-answer copy. Filtered to his rows (the loader keeps
      // any row with a queued write of his own, so an echo cannot undo it).
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rfis', filter: `user_id=eq.${user.id}` },
        () => { void queryClient.invalidateQueries({ queryKey: ['rfis'] }); },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'submittals', filter: `user_id=eq.${user.id}` },
        () => { void queryClient.invalidateQueries({ queryKey: ['submittals'] }); },
      )
      .subscribe((status) => {
        console.log('[NotificationContext] Bid/CO/RFI/submittal realtime status:', status);
      });

    return () => {
      void supabase.removeChannel(bidChannel);
    };
  }, [isAuthenticated, user, queryClient]);

  // ── The app-icon badge (audit round 2, #17) ───────────────────────────
  // ONE number: the signed-in user's unread notification_outbox rows — the rows
  // the inbox lists, counted on the server (the inbox feed stops at 80 rows) and
  // the same count notify / morning-digest now send as a push's `badge`. It
  // used to be a hard-coded 1 on every push that nothing in the running app
  // ever cleared (the only clearBadge caller was the switched-off marketplace
  // chat), plus a local badgeCount/incrementBadge pair that no code called.
  // Re-read on sign-in, on every return to the foreground, and whenever a
  // screen that changes read state asks (the inbox after Mark read / Mark all
  // read / Clear). Signed out → 0, so the next person on a shared phone does
  // not inherit a stranger's number.
  const syncBadge = useCallback(async (): Promise<void> => {
    if (Platform.OS === 'web') return;
    try {
      if (!user?.id) {
        await Notifications.setBadgeCountAsync(0);
        return;
      }
      const { count, error } = await supabase
        .from('notification_outbox')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', user.id)
        .is('read_at', null)
        .not('event_type', 'in', '(daily_digest_sent)');
      // A failed read leaves the icon as it is rather than guessing a number.
      if (error || typeof count !== 'number') return;
      await Notifications.setBadgeCountAsync(count);
    } catch { /* badge is best-effort; never throw into a caller's tap */ }
  }, [user?.id]);

  useEffect(() => {
    void syncBadge();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void syncBadge();
    });
    return () => sub.remove();
  }, [syncBadge]);

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
    syncBadge,
    maybeAskForPush,
  }), [pushToken, syncBadge, maybeAskForPush]);
});
