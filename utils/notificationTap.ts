// utils/notificationTap.ts — LS-4 / LS-7 (health lane NOTIFYOPS).
//
// THE ONE push-tap handler. Two paths reach it, and they must never both
// navigate for the same tap:
//
//   1. the LIVE listener (addNotificationResponseReceivedListener) — a tap
//      while the app is running or backgrounded;
//   2. the COLD START read (Notifications.getLastNotificationResponse) — a tap
//      that LAUNCHED a killed app. expo-notifications hands that response to
//      JS once, at module create, before the session restore; the live
//      listener is only added after auth resolves, so it never heard the
//      launch tap and every "Client paid" / "CO approved" / portal-message push
//      tapped from a closed app landed on Home.
//
// Both go through handleNotificationResponse with the same handled-id set,
// so whichever runs second is a no-op. The id is the DELIVERY, not the
// request: `<request.identifier>@<notification.date>`. Local reminders reuse
// one fixed identifier for every delivery ('mageid-morning-brief-nudge',
// 'mageid-lineup-reminder-<weekday>', 'mageid-week-close-nudge'), so an
// identifier-only key swallowed every later tap of the same reminder in one
// app session. Both paths receive the same response object for one tap (same
// identifier, same date), so the double-navigation guard still holds.
//
// The event -> screen table itself is supabase/functions/notify/routes.ts,
// shared with the notify edge function's email buttons and the inbox. This
// file decides only WHICH route a push opens (the kinded table, the ask_seed
// shortcut, the pre-`kind` legacy ids) and in what order the stale list is
// re-read (utils/notificationTapRefresh). Pure apart from the injected deps,
// so scripts/validate-health-notifyops.ts drives it with bun.

import { notificationRoute, routeHref } from '@/supabase/functions/notify/routes';
import type { NotificationRoute } from '@/supabase/functions/notify/routes';
import type { NotificationRefreshDeps } from '@/utils/notificationTapRefresh';

/** The slice of an expo-notifications NotificationResponse this handler reads. */
export interface TapResponseLike {
  notification?: {
    request?: {
      identifier?: string | null;
      content?: { data?: Record<string, unknown> | null } | null;
    } | null;
    /** When this delivery was presented (ms since epoch; expo-notifications sets it). */
    date?: number | null;
  } | null;
}

export type TapPlan =
  /** ask_seed: open Ask, no list to re-read. */
  | { kind: 'ask'; href: string }
  /** A kinded push the shared table routes: re-read what it makes stale, then open. */
  | { kind: 'route'; eventKind: string; data: Record<string, unknown>; route: NotificationRoute; href: string }
  /** A pre-`kind` push (marketplace chat, bid response, legacy CO ping). */
  | { kind: 'legacy'; eventKind: string | null; data: Record<string, unknown>; href: string }
  /** A kinded push that names nothing openable: re-read its list, open nothing. */
  | { kind: 'refresh'; eventKind: string; data: Record<string, unknown> }
  | { kind: 'none' };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * The id of this DELIVERY: `<request identifier>@<notification date>` when the
 * date is a finite number, the bare identifier otherwise, null with no
 * identifier. A repeating local reminder keeps its identifier across
 * deliveries; its date changes, so each delivery is its own tap.
 */
export function notificationResponseId(response: TapResponseLike | null | undefined): string | null {
  const identifier = str(response?.notification?.request?.identifier);
  if (!identifier) return null;
  const date = response?.notification?.date;
  return typeof date === 'number' && Number.isFinite(date) ? `${identifier}@${date}` : identifier;
}

/** Where a tapped push opens. Pure. */
export function routeForNotificationResponse(response: TapResponseLike | null | undefined): TapPlan {
  const raw = response?.notification?.request?.content?.data;
  const data: Record<string, unknown> = raw && typeof raw === 'object' ? raw : {};
  const kind = str(data.kind);

  if (kind === 'ask_seed') {
    // A margin/brief push can open MAGE already answering the question the
    // alert raised. A bare ask_seed simply opens Ask.
    const seed = str(data.seed);
    const screen = str(data.screen);
    return { kind: 'ask', href: seed ? routeHref({ pathname: '/ask', params: screen ? { seed, screen } : { seed } }) : '/ask' };
  }

  const route = kind ? notificationRoute(kind, data) : null;
  if (kind && route) return { kind: 'route', eventKind: kind, data, route, href: routeHref(route) };

  // Pre-`kind` pushes (marketplace chat, bid responses, legacy CO pings).
  const conversationId = str(data.conversationId);
  const bidId = str(data.bidId);
  const changeOrderId = str(data.changeOrderId);
  const legacyHref = conversationId ? `/messages?id=${conversationId}`
    : bidId ? `/bid-detail?id=${bidId}`
      : changeOrderId ? `/change-order?coId=${changeOrderId}`
        : null;
  if (legacyHref) return { kind: 'legacy', eventKind: kind, data, href: legacyHref };
  if (kind) return { kind: 'refresh', eventKind: kind, data };
  return { kind: 'none' };
}

/**
 * The handled-response set both paths share. `claim(id)` is true the FIRST
 * time an id is seen and false after, so the live listener and the cold-start
 * read never both navigate. A response with no id cannot be deduped and is
 * always claimable (the SDK always sets one on device).
 */
export function createHandledResponses(): { claim: (id: string | null) => boolean; has: (id: string) => boolean } {
  const seen = new Set<string>();
  return {
    claim(id) {
      if (!id) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    },
    has: (id) => seen.has(id),
  };
}

export interface TapDeps {
  push: (href: string) => void;
  refreshDeps: NotificationRefreshDeps;
  /** A kinded route: re-read what the notice makes stale, THEN open the
   *  route. The context implements it with utils/notificationTapRefresh's
   *  refreshThenOpen + router.push(routeHref(route)) — the wiring
   *  validate-w4-context-join-notify-refresh and
   *  validate-records-open-before-load pin in contexts/NotificationContext. */
  openRoute: (kind: string, data: Record<string, unknown>, route: NotificationRoute) => void;
  refreshForNotification: (kind: string, data: Record<string, unknown>, deps: NotificationRefreshDeps) => Promise<void> | void;
}

/**
 * Act on one tapped push. Returns false when this response was already
 * handled (the other path got it first) — nothing happens then.
 *
 * The notice was written by the server seconds ago; the list it is about was
 * read at launch. A kinded route re-reads what the notice makes stale BEFORE
 * the screen opens (#82: "Client paid" opened an invoice still showing the
 * full balance). A money notice waits for its read, bounded.
 */
export function handleNotificationResponse(
  response: TapResponseLike | null | undefined,
  handled: { claim: (id: string | null) => boolean },
  deps: TapDeps,
): boolean {
  if (!response) return false;
  if (!handled.claim(notificationResponseId(response))) return false;
  const plan = routeForNotificationResponse(response);
  switch (plan.kind) {
    case 'ask':
      deps.push(plan.href);
      break;
    case 'route':
      // Every pathname in the table is checked against app/ by
      // scripts/validate-notification-routes.ts — typed routes cannot see
      // through a runtime table, the validator does.
      deps.openRoute(plan.eventKind, plan.data, plan.route);
      break;
    case 'legacy':
      if (plan.eventKind) void deps.refreshForNotification(plan.eventKind, plan.data, deps.refreshDeps);
      deps.push(plan.href);
      break;
    case 'refresh':
      void deps.refreshForNotification(plan.eventKind, plan.data, deps.refreshDeps);
      break;
    case 'none':
      break;
  }
  return true;
}
