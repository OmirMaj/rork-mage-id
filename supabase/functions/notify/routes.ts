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
    // Wave 3 (#48 and the carried events). Snake_case from the outbox payload,
    // camelCase from the push data — pick() reads both.
    case 'client_invoice_paid':
    case 'client_payment_failed': {
      const invoiceId = pick(d, 'invoice_id', 'invoiceId');
      if (projectId && invoiceId) return { pathname: '/invoice', params: { projectId, invoiceId } };
      return projectId ? { pathname: '/project-detail', params: { id: projectId } } : null;
    }
    case 'field_report_filed': {
      const reportId = pick(d, 'report_id', 'reportId');
      if (projectId && reportId) return { pathname: '/daily-report', params: { projectId, reportId } };
      return projectId ? { pathname: '/project-detail', params: { id: projectId } } : null;
    }
    case 'pro_response_received': {
      // The push's own `kind` is the event name, so the RFI/submittal kind
      // rides as proKind there; the outbox payload names it `kind`.
      const kind = pick(d, 'pro_kind', 'proKind') ?? str(d.kind);
      const itemId = pick(d, 'item_id', 'itemId');
      if (projectId && itemId && kind === 'rfi') return { pathname: '/rfi', params: { projectId, rfiId: itemId } };
      if (projectId && itemId && kind === 'submittal') return { pathname: '/submittal', params: { projectId, submittalId: itemId } };
      return projectId ? { pathname: '/project-detail', params: { id: projectId } } : null;
    }
    case 'punch_marked_ready': {
      // Wave 4 (#51/#54): the item itself — punch-list reads ?itemId=, re-reads
      // the list, switches to the list the item is on, filters to its status
      // and scrolls to it. The trigger names it punch_item_id; the push data
      // carries itemId.
      const itemId = pick(d, 'punch_item_id', 'punchItemId', 'item_id', 'itemId');
      if (!projectId) return null;
      return { pathname: '/punch-list', params: itemId ? { projectId, itemId } : { projectId } };
    }
    case 'safety_incident_filed': {
      // Wave 4 (#119): the case itself — safety-incidents opens ?incidentId=
      // into its form once the list has it (RLS: author or project owner).
      const incidentId = pick(d, 'incident_id', 'incidentId');
      if (projectId && incidentId) return { pathname: '/safety-incidents', params: { projectId, incidentId } };
      return projectId ? { pathname: '/safety-incidents', params: { projectId } } : null;
    }
    // Wave 5 (CONTRACT 8): the three sub-side events raised by AFTER triggers.
    case 'bid_invite_received': {
      // The package the sub bid on — buyout-package reads ?packageId=.
      const packageId = pick(d, 'package_id', 'packageId');
      return packageId ? { pathname: '/buyout-package', params: { packageId } } : null;
    }
    case 'lien_waiver_signed':
      // The job's waiver list (lien-waivers reads ?projectId=); the signed
      // waiver shows there with its signature.
      return projectId ? { pathname: '/lien-waivers', params: { projectId } } : null;
    case 'prequal_submitted': {
      // CONTRACT 8: THE packet the sub just submitted. app/prequal-manager.tsx
      // reads ?packetId= and opens that packet's review once the list has it.
      // The trigger payload carries packet_id; the push carries packetId. With
      // no id it still opens the manager (the packet is listed as Submitted).
      const packetId = pick(d, 'packet_id', 'packetId');
      return { pathname: '/prequal-manager', params: packetId ? { packetId } : {} };
    }
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
