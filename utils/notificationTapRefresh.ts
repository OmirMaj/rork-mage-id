/**
 * utils/notificationTapRefresh.ts — wave 4 (#82, #46/#54, #33's neighbours).
 *
 * ONE table of "this notice means that list on the device is now stale", read
 * by every path a notice reaches the app through:
 *   - the push TAP handler (contexts/NotificationContext),
 *   - the push RECEIVED listener (same file) — so the list is already fresh
 *     when the banner lands, whether or not he taps it,
 *   - the inbox row press (app/notifications-inbox.tsx handleTap),
 *   - the outbox INSERT realtime callback (hooks/useNotificationFeed) — the
 *     only signal on web, which gets no push.
 *
 * Why it exists: the notice is written by the SERVER (stripe-webhook, a sub's
 * portal, the architect's reply link, a foreman's report) while the lists it
 * talks about are read at launch, on pull-to-refresh and on a foreground
 * return. A tap while the app is open changes none of those, so "Client paid
 * Invoice #7" opened an invoice still showing the full balance with Record
 * Payment and a Pay link on offer (#82) — the notice said paid, the screen
 * said unpaid.
 *
 * The invoice kinds go through ProjectContext.refetchInvoicesNow, NEVER a raw
 * invalidate of ['invoices', …]: that re-read is held (and owed) while this
 * device has an invoice write on the wire, which a bare invalidate would skip
 * and put the pre-edit row back on screen.
 *
 * Pure apart from the injected deps, so scripts/validate-w4-context-join-
 * notify-refresh.ts drives it directly.
 */

import { formatCalendarDay, parseCalendarDay } from '@/utils/calendarDate';

/** Every kind whose notice means the money on the device is stale.
 *  ar_pay_link_failed is not emitted today; it is listed so a future webhook
 *  notice about a dead pay link lands on a fresh invoice without a code change. */
export const INVOICE_REFRESH_KINDS: ReadonlySet<string> = new Set([
  'client_invoice_paid',
  'client_payment_failed',
  'ar_pay_link_failed',
]);

export interface NotificationRefreshPlan {
  /** Query-key PREFIXES to invalidate (react-query prefix-matches, so
   *  ['punchItems'] also reaches ['punchItems', userId]). */
  queryKeys: string[][];
  /** Run the guarded invoices + AIA re-read. */
  invoices: boolean;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** What a notice of `kind` makes stale. `data` is the push data (camelCase)
 *  or the outbox payload (snake_case) — both spellings are read. */
export function notificationRefreshPlan(
  kind: string | null | undefined,
  data?: Record<string, unknown> | null,
): NotificationRefreshPlan {
  const d = data ?? {};
  if (!kind) return { queryKeys: [], invoices: false };
  if (INVOICE_REFRESH_KINDS.has(kind)) return { queryKeys: [], invoices: true };
  switch (kind) {
    case 'punch_marked_ready':
      // #46 part (a) / #54: the sub's Ready is a server-side UPDATE the punch
      // list has no realtime for.
      return { queryKeys: [['punchItems']], invoices: false };
    case 'lead_received':
      return { queryKeys: [['leads']], invoices: false };
    case 'field_report_filed':
      return { queryKeys: [['dailyReports']], invoices: false };
    case 'pro_response_received': {
      // The push's own `kind` IS the event name, so the RFI/submittal kind
      // rides as proKind there; the outbox payload names it `kind`.
      const pro = str(d.pro_kind) ?? str(d.proKind) ?? str(d.kind);
      if (pro === 'rfi') return { queryKeys: [['rfis']], invoices: false };
      if (pro === 'submittal') return { queryKeys: [['submittals']], invoices: false };
      return { queryKeys: [['rfis'], ['submittals']], invoices: false };
    }
    // safety_incident_filed: nothing extra — SafetyContext re-reads itself
    // (realtime + utils/safety/safetyRefresh), and a second read here would
    // only race it.
    default:
      return { queryKeys: [], invoices: false };
  }
}

export interface NotificationRefreshDeps {
  invalidate: (queryKey: string[]) => Promise<unknown> | unknown;
  refetchInvoicesNow: () => Promise<void>;
}

/** Start every re-read the notice calls for. Resolves when they have answered;
 *  never rejects (a failed read leaves the cached list, which the screens
 *  already label). */
export async function refreshForNotification(
  kind: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
  deps: NotificationRefreshDeps,
): Promise<void> {
  const plan = notificationRefreshPlan(kind, data);
  const reads: Promise<unknown>[] = [];
  for (const key of plan.queryKeys) {
    reads.push(Promise.resolve().then(() => deps.invalidate(key)));
  }
  if (plan.invoices) reads.push(Promise.resolve().then(() => deps.refetchInvoicesNow()));
  await Promise.all(reads.map((r) => r.catch(() => undefined)));
}

/** How long a TAP waits for the money re-read before it opens the screen. The
 *  read is started either way (the invoice screen then sees it in flight);
 *  this only keeps a normal round trip from showing the stale balance at all,
 *  without letting a dead signal hold the tap hostage. */
export const TAP_REFRESH_WAIT_MS = 1500;

/** Refresh, then open — waiting at most `waitMs`, and only when the notice is
 *  about money (the other lists re-render in place when their read lands). */
export async function refreshThenOpen(
  kind: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
  deps: NotificationRefreshDeps,
  open: () => void,
  waitMs: number = TAP_REFRESH_WAIT_MS,
): Promise<void> {
  const refresh = refreshForNotification(kind, data, deps);
  if (notificationRefreshPlan(kind, data).invoices) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      refresh,
      new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); }),
    ]);
    if (timer) clearTimeout(timer);
  }
  open();
}

/** The inbox's field_report_filed body (#133, CONTRACT 10): the trigger fires
 *  on the transition to 'sent', carrying the report's portal_status, whether
 *  it is in the weekly digest, and its calendar day. The SAME three branches
 *  as the push and email (supabase/functions/notify fieldReport copy):
 *    - 'sent'  → already on the portal; "and will be in Friday's update" ONLY
 *      when in_weekly_digest is not false (notify drops that clause);
 *    - 'draft' → waiting on the GC;
 *    - missing (a row from the older trigger during the deploy window) →
 *      neither promise, "open it to check what the homeowner can see".
 *  The report's own day leads when the payload carries a valid one — a Monday
 *  report filed on Wednesday must not read as today's. */
export interface FieldReportNoticePayload {
  portal_status?: unknown;
  in_weekly_digest?: unknown;
  report_date?: unknown;
}
export function fieldReportNoticeBody(p: FieldReportNoticePayload | null | undefined): string {
  const status = p?.portal_status === 'sent' ? 'sent' : p?.portal_status === 'draft' ? 'draft' : null;
  const tail = status === 'sent'
    ? (p?.in_weekly_digest === false
      ? "It's already on the homeowner's portal. Hide it if it shouldn't be."
      : "It's already on the homeowner's portal and will be in Friday's update. Hide it if it shouldn't be.")
    : status === 'draft'
      ? 'Review it before anything goes to the homeowner.'
      : 'Open it to check what the homeowner can see.';
  const raw = typeof p?.report_date === 'string' ? p.report_date.trim() : '';
  // Strict 'YYYY-MM-DD' and a real date, or no day at all — never a guess
  // (formatCalendarDay echoes an unparseable value back, so parse first).
  const day = /^\d{4}-\d{2}-\d{2}$/.test(raw) && parseCalendarDay(raw)
    ? formatCalendarDay(raw, { weekday: 'short', month: 'short', day: 'numeric' })
    : '';
  return day ? `Report for ${day}. ${tail}` : tail;
}
