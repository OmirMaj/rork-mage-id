import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useRootNavigationState, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/contexts/AuthContext';
import { useCoreData, useProjectActions } from '@/contexts/ProjectContext';
import { supabase } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { showAlert } from '@/utils/alert';
import {
  registerForPushNotifications,
  addNotificationResponseListener,
  addNotificationReceivedListener,
} from '@/utils/notifications';
import { refreshForNotification, refreshThenOpen } from '@/utils/notificationTapRefresh';
import {
  decidePushAsk, pushAskCopy,
  type PushAskMoment, type PushPermission,
} from '@/utils/pushPermissionAsk';
import { usePortalApprovalReconciler } from '@/hooks/usePortalApprovalReconciler';
// The one push-tap handler (LS-4): the live listener AND the cold-start read
// both route through it, with one handled-id set so a tap never navigates
// twice. It reads the one event -> screen table shared with the notify edge
// function's email buttons and the in-app inbox (audit round 2, #12).
import {
  handleNotificationResponse, createHandledResponses, type TapResponseLike,
} from '@/utils/notificationTap';
import { routeHref, type NotificationRoute } from '@/supabase/functions/notify/routes';
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

/** The SDK's last notification response, or null where it cannot be read (web,
 *  a build without the native module, a test mock without it, or a throw). */
function readLastResponse(): TapResponseLike | null {
  if (Platform.OS === 'web') return null;
  try {
    const get = (Notifications as { getLastNotificationResponse?: () => TapResponseLike | null }).getLastNotificationResponse;
    return typeof get === 'function' ? get() : null;
  } catch {
    return null;
  }
}

/** Forget the SDK's last response once it has been acted on. Best-effort. */
function clearLastResponse(): void {
  if (Platform.OS === 'web') return;
  try {
    const clear = (Notifications as { clearLastNotificationResponse?: () => void }).clearLastNotificationResponse;
    if (typeof clear === 'function') clear();
  } catch { /* nothing to clear on this build */ }
}

export const [NotificationProvider, useNotifications] = createContextHook(() => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isAuthenticated } = useAuth();
  // NotificationProvider is mounted below ProjectProvider (app/_layout.tsx), so
  // the onboarding flag is readable here — it is what keeps the contextual push
  // ask from firing inside first-run. useCoreData rather than useProjects: this
  // provider only needs that one flag, and subscribing to all seven domain
  // contexts would re-run it on every unrelated invoice or punch-item change.
  const { hasSeenOnboarding, userRole, isLoading: coreLoading } = useCoreData();
  // #82: the guarded invoices re-read. From the stable-actions bucket, so it
  // costs this provider no re-renders.
  const { refetchInvoicesNow } = useProjectActions();
  const [pushToken, setPushToken] = useState<string | null>(null);
  const responseListenerRef = useRef<Notifications.EventSubscription | null>(null);
  const receivedListenerRef = useRef<Notifications.EventSubscription | null>(null);
  // LS-4: ids of the push responses already acted on this session — shared by
  // the live listener and the cold-start read so a tap never navigates twice.
  const handledResponsesRef = useRef(createHandledResponses());
  // The root navigator has mounted (expo-router's readiness signal); pushing
  // before it is a no-op or a crash on a cold start. This subscribes the
  // provider to navigation state, so its body re-runs on each navigation; the
  // context value is memoised, so consumers do not re-render with it.
  const rootNavState = useRootNavigationState();
  const navReady = !!rootNavState?.key;

  // The deps utils/notificationTapRefresh drives: prefix invalidation for the
  // plain lists, the guarded money re-read for the invoice kinds.
  const refreshDeps = useMemo(() => ({
    invalidate: (queryKey: string[]) => queryClient.invalidateQueries({ queryKey }),
    refetchInvoicesNow,
  }), [queryClient, refetchInvoicesNow]);

  // The one tap handler's deps: the same router.push the live listener has
  // always used, the refresh table, and the handled-id set. A kinded route
  // re-reads through the shared refresh table BEFORE it opens (#82).
  const actOnResponse = useCallback((response: TapResponseLike | null | undefined): boolean => {
    const acted = handleNotificationResponse(response, handledResponsesRef.current, {
      push: (href) => router.push(href as Href),
      refreshDeps,
      openRoute: (kind: string, data: Record<string, unknown>, route: NotificationRoute) => {
        void refreshThenOpen(kind, data as Record<string, unknown>, refreshDeps, () => {
          router.push(routeHref(route) as Href);
        });
      },
      refreshForNotification,
    });
    // Once acted on, the SDK's "last response" must not replay it (a later
    // effect re-run, or the next account signing in on a shared phone).
    if (acted) clearLastResponse();
    return acted;
  }, [router, refreshDeps]);

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
      // Server and local pushes carry `kind`; its screen comes from the shared
      // table (supabase/functions/notify/routes.ts) via utils/notificationTap —
      // the same handler the cold-start read below uses.
      actOnResponse(response);
    });

    // #82 (c): a notice that lands while the app is OPEN re-reads its list
    // right away, tapped or not — the banner says "Client paid" and the
    // invoice he may already be looking at should agree without a tap.
    receivedListenerRef.current = addNotificationReceivedListener((notification) => {
      const d = notification.request.content.data as Record<string, unknown> | undefined;
      const k = d?.kind;
      if (typeof k === 'string') void refreshForNotification(k, d, refreshDeps);
    });

    return () => {
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
        responseListenerRef.current = null;
      }
      if (receivedListenerRef.current) {
        receivedListenerRef.current.remove();
        receivedListenerRef.current = null;
      }
    };
  }, [isAuthenticated, user, refreshDeps, actOnResponse]);

  // ── LS-4: the tap that LAUNCHED the app ──────────────────────────────────
  // expo-notifications delivers a cold-start tap to JS once, when its module
  // is created — before the session restore, so the listener above (added
  // only once auth resolves) never hears it, and the push opened Home. The SDK
  // keeps that response as its "last response"; read it once the app can
  // actually open the screen: signed in, the first-run gates in app/_layout
  // settled (persona chosen, onboarding seen — otherwise its redirect would
  // replace the screen), and the root navigator mounted. Same handler, same
  // handled-id set: a tap the listener already acted on is a no-op here.
  // Deliberately excluded: a claimed crew worker with no persona yet
  // (userRole === null). app/_layout lets him stay ONLY on /crew and sends
  // any other route to persona-select, so opening the push's screen would
  // just bounce him there; the SDK keeps the response (it is only cleared
  // once acted on), so it opens after he picks a persona. Mirrors app/_layout's
  // own replay gate, which also waits for userRole !== null.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (coreLoading || userRole === null || hasSeenOnboarding !== true) return;
    if (!navReady) return;
    const launch = readLastResponse();
    if (launch) actOnResponse(launch);
  }, [isAuthenticated, user, coreLoading, userRole, hasSeenOnboarding, navReady, actOnResponse]);

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
      // review cycle are server-side UPDATEs of rfis/submittals rows; nothing
      // re-read those lists until a foreground return, so he kept editing the
      // pre-answer copy. #33 (wave 4): NOT filtered to user_id — a row a
      // teammate raised carries the teammate's id, so the GC never heard the
      // architect answer it. Realtime applies each subscriber's SELECT RLS
      // (rfis_collab_select / submittals_collab_select: own row OR
      // can_access_project, a SECURITY DEFINER helper), so he receives exactly
      // the rows he can read — and a teammate now hears the GC's rows too. The
      // loader keeps any row with a queued write of his own, so an echo
      // cannot undo it, whoever raised the row.
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rfis' },
        () => { void queryClient.invalidateQueries({ queryKey: ['rfis'] }); },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'submittals' },
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
