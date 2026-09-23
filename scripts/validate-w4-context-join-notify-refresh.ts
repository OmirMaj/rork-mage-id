// validate-w4-context-join-notify-refresh.ts — wave 4, lane context-join.
//
//   #82 (MAJOR) a "Client paid" notice opened with the app in the foreground
//        landed on an invoice still showing the full balance, Record Payment
//        and a Pay link. Every path a notice reaches the app through — the
//        push tap, the push received listener, the inbox row, the outbox
//        INSERT realtime callback — now re-reads what the notice makes stale
//        from ONE table (utils/notificationTapRefresh), the money kinds
//        through the GUARDED refetchInvoicesNow (never a raw invalidate of
//        ['invoices', …], which skips the in-flight-write hold), and a tap on
//        a money notice waits for that read (bounded) before it opens.
//   #46/#54 punch_marked_ready → ['punchItems']; lead/report/pro-response kinds.
//   #33  the rfis/submittals UPDATE listeners are no longer filtered to the
//        GC's own user_id (RLS decides what each subscriber hears).
//   #133 the inbox's field_report_filed body branches on portal_status.
//   carried: the safety_incident_filed inbox row (no severity), the punch row
//        naming the item, #87's fifth caller, #40's ledger hold, the RFI
//        reopen wording.
//
// Run via: bun run scripts/validate-w4-context-join-notify-refresh.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  notificationRefreshPlan, refreshForNotification, refreshThenOpen, fieldReportNoticeBody,
  INVOICE_REFRESH_KINDS,
} from '../utils/notificationTapRefresh';
import { planProDocEdit } from '../utils/projectContextPure';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const NC = read('contexts/NotificationContext.tsx');
const INBOX = read('app/notifications-inbox.tsx');
const FEED = read('hooks/useNotificationFeed.ts');
const CTX = read('contexts/ProjectContext.tsx');

let passes = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      invalidate: (k: string[]) => { calls.push(`invalidate:${k.join('/')}`); },
      refetchInvoicesNow: async () => { calls.push('refetchInvoicesNow'); },
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n#82 — the one refresh table');
  for (const k of ['client_invoice_paid', 'client_payment_failed']) {
    const p = notificationRefreshPlan(k, {});
    ok(`${k} runs the guarded invoices re-read`, p.invoices === true && p.queryKeys.length === 0);
    ok(`${k} is in INVOICE_REFRESH_KINDS`, INVOICE_REFRESH_KINDS.has(k));
  }
  ok('punch_marked_ready invalidates ["punchItems"] (#46/#54)',
    JSON.stringify(notificationRefreshPlan('punch_marked_ready', {}).queryKeys) === '[["punchItems"]]');
  ok('lead_received invalidates ["leads"]',
    JSON.stringify(notificationRefreshPlan('lead_received', {}).queryKeys) === '[["leads"]]');
  ok('field_report_filed invalidates ["dailyReports"]',
    JSON.stringify(notificationRefreshPlan('field_report_filed', {}).queryKeys) === '[["dailyReports"]]');
  ok('pro_response_received (push proKind rfi) → ["rfis"]',
    JSON.stringify(notificationRefreshPlan('pro_response_received', { proKind: 'rfi' }).queryKeys) === '[["rfis"]]');
  ok('pro_response_received (outbox kind submittal) → ["submittals"]',
    JSON.stringify(notificationRefreshPlan('pro_response_received', { kind: 'submittal' }).queryKeys) === '[["submittals"]]');
  ok('pro_response_received with no kind → both lists',
    JSON.stringify(notificationRefreshPlan('pro_response_received', {}).queryKeys) === '[["rfis"],["submittals"]]');
  ok('safety_incident_filed → nothing extra (SafetyContext re-reads itself)',
    (() => { const p = notificationRefreshPlan('safety_incident_filed', {}); return !p.invoices && p.queryKeys.length === 0; })());
  ok('an unknown or missing kind → nothing',
    (() => { const a = notificationRefreshPlan('whatever', {}); const b = notificationRefreshPlan(undefined, {}); return !a.invoices && !a.queryKeys.length && !b.invoices && !b.queryKeys.length; })());

  {
    const r = recorder();
    await refreshForNotification('client_invoice_paid', { invoice_id: 'i1' }, r.deps);
    ok('a money notice calls refetchInvoicesNow and NEVER a raw invoices invalidate',
      r.calls.includes('refetchInvoicesNow') && !r.calls.some((c) => c.startsWith('invalidate:invoices')), r.calls.join(','));
  }
  {
    const r = recorder();
    await refreshForNotification('punch_marked_ready', {}, r.deps);
    ok('a punch notice invalidates punchItems only', r.calls.join(',') === 'invalidate:punchItems', r.calls.join(','));
  }
  {
    // A failing read never rejects out of the refresh (the tap still opens).
    let threw = false;
    try {
      await refreshForNotification('client_payment_failed', {}, {
        invalidate: () => { throw new Error('x'); },
        refetchInvoicesNow: async () => { throw new Error('offline'); },
      });
    } catch { threw = true; }
    ok('a failed re-read does not reject', !threw);
  }

  console.log('\n#82 — a money tap waits for the read (bounded) before it opens');
  {
    const order: string[] = [];
    await refreshThenOpen('client_invoice_paid', {}, {
      invalidate: () => {},
      refetchInvoicesNow: async () => { await sleep(30); order.push('read'); },
    }, () => order.push('open'), 1000);
    ok('read answers first, then the screen opens', order.join(',') === 'read,open', order.join(','));
  }
  {
    const order: string[] = [];
    const t0 = Date.now();
    await refreshThenOpen('client_invoice_paid', {}, {
      invalidate: () => {},
      refetchInvoicesNow: () => new Promise<void>(() => { /* dead signal: never answers */ }),
    }, () => order.push('open'), 60);
    ok('a read that never answers still opens after the bound', order.join(',') === 'open' && Date.now() - t0 < 1000);
  }
  {
    const order: string[] = [];
    await refreshThenOpen('punch_marked_ready', {}, {
      invalidate: async () => { await sleep(40); order.push('read'); },
      refetchInvoicesNow: async () => {},
    }, () => order.push('open'), 1000);
    ok('a non-money notice opens at once (its list re-renders in place)', order[0] === 'open', order.join(','));
  }

  console.log('\n#133 — field report body branches on portal_status');
  ok("'sent' says it is already on the homeowner's portal",
    fieldReportNoticeBody({ portal_status: 'sent' }) === "It's already on the homeowner's portal and will be in Friday's update. Hide it if it shouldn't be.");
  ok('a draft says to review it first',
    fieldReportNoticeBody({ portal_status: 'draft' }) === 'Review it before anything goes to the homeowner.');
  // Integration round 1: parity with notify's three branches.
  ok("'sent' but NOT in the weekly digest never promises Friday's update",
    fieldReportNoticeBody({ portal_status: 'sent', in_weekly_digest: false }) === "It's already on the homeowner's portal. Hide it if it shouldn't be.");
  ok('no portal_status (older trigger) makes neither promise',
    fieldReportNoticeBody({}) === 'Open it to check what the homeowner can see.'
    && fieldReportNoticeBody(undefined) === 'Open it to check what the homeowner can see.');
  ok("the report's own day leads, in notify's format",
    fieldReportNoticeBody({ portal_status: 'draft', report_date: '2026-09-14' }) === 'Report for Mon, Sep 14. Review it before anything goes to the homeowner.');
  ok('a garbled day is dropped, never echoed',
    fieldReportNoticeBody({ portal_status: 'draft', report_date: '2026-02-31' }) === 'Review it before anything goes to the homeowner.'
    && fieldReportNoticeBody({ portal_status: 'draft', report_date: 'Monday' }) === 'Review it before anything goes to the homeowner.');
  {
    // Parity: every tail the inbox can print is one notify prints.
    const NOTIFY = read('supabase/functions/notify/index.ts');
    const block = NOTIFY.slice(NOTIFY.indexOf("case 'field_report_filed':"), NOTIFY.indexOf('const rows: [string, string, boolean?][]', NOTIFY.indexOf("case 'field_report_filed':")));
    const tails = [
      fieldReportNoticeBody({ portal_status: 'sent' }), fieldReportNoticeBody({ portal_status: 'sent', in_weekly_digest: false }),
      fieldReportNoticeBody({ portal_status: 'draft' }), fieldReportNoticeBody({}),
    ];
    ok('each inbox branch is word-for-word a branch of notify', block.length > 0 && tails.every(t => block.includes(t)), tails.filter(t => !block.includes(t)).join(' | '));
  }

  console.log('\nNotificationContext wiring');
  ok('#33: no rfis/submittals listener is filtered to user_id',
    !/table: 'rfis', filter:/.test(NC) && !/table: 'submittals', filter:/.test(NC) && !/user_id=eq\./.test(NC));
  ok('#33: both UPDATE listeners are still there',
    /\{ event: 'UPDATE', schema: 'public', table: 'rfis' \}/.test(NC) && /\{ event: 'UPDATE', schema: 'public', table: 'submittals' \}/.test(NC));
  ok('the tap routes through refreshThenOpen, with router.push inside the open callback',
    /void refreshThenOpen\(kind, data as Record<string, unknown>, refreshDeps, \(\) => \{\s*router\.push\(routeHref\(route\) as Href\);/.test(NC));
  ok('no bare router.push(routeHref(route)) outside the refresh',
    (NC.match(/router\.push\(routeHref\(route\)/g) ?? []).length === 1);
  ok('a received listener re-reads the notice\'s list',
    /addNotificationReceivedListener\(\(notification\) => \{[\s\S]{0,300}refreshForNotification\(k, d, refreshDeps\)/.test(NC));
  ok('the received listener is removed on cleanup', /receivedListenerRef\.current\.remove\(\)/.test(NC));
  ok('refreshDeps carry the guarded refetchInvoicesNow from the stable actions',
    /const \{ refetchInvoicesNow \} = useProjectActions\(\);/.test(NC) && /refetchInvoicesNow,\s*\}\), \[queryClient, refetchInvoicesNow\]\)/.test(NC));
  ok('no raw invoices invalidate anywhere on the notification paths',
    ![NC, INBOX, FEED].some((s) => /queryKey: \[['"]invoices['"]/.test(s)));

  console.log('\nInbox wiring');
  ok('handleTap refreshes then opens, with the guarded money read',
    /void refreshThenOpen\(item\.eventType, item\.payload, \{[\s\S]{0,200}refetchInvoicesNow,\s*\}, \(\) => \{[\s\S]{0,80}if \(link\) router\.push\(link as Href\);/.test(INBOX));
  ok('the inbox never opens a row before (or outside) the refresh',
    (INBOX.match(/router\.push\(link as Href\)/g) ?? []).length === 1);
  ok('the row says it is checking while the money read runs',
    /openingId === item\.id \?/.test(INBOX) && /extraData=\{openingId\}/.test(INBOX));
  ok('safety_incident_filed has an inbox row (ShieldAlert, "Incident report")',
    /safety_incident_filed: \{ icon: <ShieldAlert[^\n]*label: 'Incident report' \}/.test(INBOX));
  {
    const m = INBOX.match(/case 'safety_incident_filed': \{([\s\S]*?)\n    \}/);
    ok('the incident summary never prints severity', !!m && !/severity/.test(m[1]) && /filed an incident report/.test(m[1]));
  }
  ok('field_report_filed summary reads portal_status through fieldReportNoticeBody',
    /fieldReportNoticeBody\(p\)/.test(INBOX));
  {
    const m = INBOX.match(/case 'punch_marked_ready': \{([\s\S]*?)\n    \}/);
    ok('the punch summary names the item (description, location, sub_note)',
      !!m && /p\.description/.test(m[1]) && /p\.location/.test(m[1]) && /p\.sub_note/.test(m[1]));
  }

  console.log('\nOutbox realtime (web has no push)');
  ok('the outbox INSERT callback re-reads the notice\'s list',
    /event: 'INSERT', schema: 'public', table: 'notification_outbox'[\s\S]{0,600}refreshForNotification\(row\.event_type, data, refreshDepsRef\.current\)/.test(FEED));

  console.log('\nCarried ProjectContext handoffs');
  ok('#87: the DFR field-progress path merges the server-written stamps',
    /mergeWrittenStamps\(applyFieldTaskPatches\(live\.tasks, accepted\), sent\.stamps\)/.test(CTX));
  ok('#40: appendCoAudit holds entries while a write of the CO is parked in the sync ledger',
    /queued = \(await queuedIdsFor\('change_orders'\)\)\.has\(coId\)\s*\|\| \(await unsavedWriteIds\('change_orders'\)\)\.has\(coId\);/.test(CTX));
  ok('#40: retryPendingCoAudit skips ledger-parked COs too',
    /queued = new Set\(\[\.\.\.await queuedIdsFor\('change_orders'\), \.\.\.await unsavedWriteIds\('change_orders'\)\]\)/.test(CTX));
  {
    const base = { id: 'r1', updatedAt: '2026-09-01T00:00:00Z', status: 'closed' } as const;
    const a = planProDocEdit({ kind: 'rfi', before: { ...base }, updates: { status: 'open' } as never, nowIso: 'x', sending: true });
    const b = planProDocEdit({ kind: 'rfi', before: { ...base, response: 'Use #5 bar', dateResponded: '2026-09-02' } as never, updates: { status: 'open' } as never, nowIso: 'x', sending: true });
    ok('reopen refusal on an RFI closed with no answer says "keep the RFI closed"',
      !a.ok && /keep the RFI closed/.test((a as { reason: string }).reason) && !/as answered/.test((a as { reason: string }).reason),
      JSON.stringify(a));
    ok('reopen refusal on an answered RFI still says "as answered"',
      !b.ok && /keep the RFI as answered/.test((b as { reason: string }).reason), JSON.stringify(b));
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
