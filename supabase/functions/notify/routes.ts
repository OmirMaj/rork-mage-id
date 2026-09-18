// supabase/functions/notify/routes.ts
//
// THE one event -> screen table for every GC notification (audit round 2, #12).
//
// Three surfaces open a notification and each used to carry its own table:
// the email buttons built here in notify, the push-tap handler in
// contexts/NotificationContext.tsx, and the in-app inbox's deepLinkFor in
// app/notifications-inbox.tsx. They disagreed. The inbox was right; the other
// two sent `?projectId=` to screens that read `id` ("Reply in MAGE ID" and "You
// won the bid" both opened on "Project not found"), sent "View change order"
// without the CO id (the screen then numbered a fresh blank CO), and sent a
// co_approval push tap to the portal setup screen.
//
// So this file is pure — no imports, no Deno globals — and BOTH runtimes read
// it: notify/index.ts imports it as `./routes.ts` and the app imports it as
// `@/supabase/functions/notify/routes`. scripts/validate-notification-routes.ts
// checks every param named here against the target screen's
// useLocalSearchParams keys, so a screen renaming its param fails the build
// instead of an email button.

export interface NotificationRoute {
  /** Expo Router path, leading slash, no query. */
  pathname: string;
  /** Query params the target screen reads. Only non-empty strings. */
  params: Record<string, string>;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** First non-empty string among `keys` — payloads are snake_case (trigger
 *  rows, outbox payload) and push data is camelCase, and both land here. */
function pick(data: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = str(data[k]);
    if (v) return v;
  }
  return null;
}

/**
 * Where a notification opens, or null when it names nothing openable (the tap
 * is then a no-op rather than a wrong screen). `event` is the outbox
 * event_type OR the push `kind` — the two differ only for `sub_invoice` and
 * `closeout_binder_sent_confirmation`, which are aliased below.
 */
export function notificationRoute(event: string, data: Record<string, unknown> | null | undefined): NotificationRoute | null {
  const d = data ?? {};
  const projectId = pick(d, 'project_id', 'projectId');
  switch (event) {
    case 'portal_message':
      // The thread itself, where he types the reply the email asks for.
      // client-messages reads `id` (app/client-messages.tsx).
      return projectId ? { pathname: '/client-messages', params: { id: projectId } } : null;
    case 'budget_proposal':
      // Proposals are accepted / countered on the portal setup screen.
      return projectId ? { pathname: '/client-portal-setup', params: { id: projectId } } : null;
    case 'co_approval': {
      const coId = pick(d, 'change_order_id', 'changeOrderId', 'coId');
      if (projectId && coId) return { pathname: '/change-order', params: { projectId, coId } };
      return projectId ? { pathname: '/project-detail', params: { id: projectId } } : null;
    }
    case 'contract_signed':
      return projectId ? { pathname: '/contract', params: { projectId } } : null;
    case 'selection_chosen':
      return projectId ? { pathname: '/selections', params: { projectId } } : null;
    case 'closeout_binder_sent':
    case 'closeout_binder_sent_confirmation':
      return projectId ? { pathname: '/closeout-binder', params: { projectId } } : null;
    case 'sub_invoice':
    case 'sub_invoice_submitted':
    case 'sub_invoice_reviewed': {
      const subId = pick(d, 'sub_id', 'subId');
      if (projectId && subId) return { pathname: '/sub-portal-setup', params: { projectId, subId } };
      return { pathname: '/sub-portals', params: {} };
    }
    case 'nearby_rfp_posted':
    case 'bid_question_asked':
    case 'bid_question_answered': {
      const rfpId = pick(d, 'rfp_id', 'rfpId', 'bid_id');
      return rfpId ? { pathname: '/rfp-detail', params: { bidId: rfpId } } : null;
    }
    case 'rfp_awarded':
      // project-detail reads `id`, not `projectId` (app/project-detail.tsx).
      return projectId ? { pathname: '/project-detail', params: { id: projectId } } : null;
    case 'lead_received': {
      const leadId = pick(d, 'lead_id', 'leadId');
      return leadId ? { pathname: '/lead-detail', params: { leadId } } : { pathname: '/leads', params: {} };
    }
    case 'margin_alert':
      // A single-job alert lands on that job's Margin Risk; a roll-up on the inbox.
      return projectId ? { pathname: '/margin-risk', params: { projectId } } : { pathname: '/margin-alerts', params: {} };
    case 'morning_brief':
      // The local nudge and the morning-digest push/outbox row both open the brief.
      return { pathname: '/brief', params: {} };
    case 'week_close':
      return { pathname: '/week-close', params: {} };
    default:
      return null;
  }
}

/** `/path?k=v&k2=v2`, every value URI-encoded. */
export function routeHref(route: NotificationRoute): string {
  const q = Object.entries(route.params)
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return q ? `${route.pathname}?${q}` : route.pathname;
}
