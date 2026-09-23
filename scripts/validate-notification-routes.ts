// validate-notification-routes.ts — guards for the notification channel
// (audit round 2, wave 2: findings #12, #13, #16, #17).
//
//   #12 ONE ROUTE TABLE. The email buttons (notify), the push tap
//       (NotificationContext) and the inbox (notifications-inbox) each kept a
//       table, and two were wrong: "Reply in MAGE ID" and "You won the bid"
//       sent `?projectId=` to screens that read `id` ("Project not found"),
//       "View change order" sent no CO id (a blank new CO, numbered next), and
//       a signed-CO push tap opened the portal setup screen. All three now read
//       supabase/functions/notify/routes.ts. This script checks every route in
//       it against the TARGET SCREEN'S OWN useLocalSearchParams keys, so a
//       screen renaming its param fails here, not in a GC's inbox — and that no
//       surface has grown its own copy back. It also evaluates change-order's
//       deep-link gate: a link naming a CO never renders the blank editor.
//   #13 A CO IS NAMED BY ITS NUMBER. notify reads the change_orders row (scoped
//       to the project), writes number / amount / project name into the stored
//       payload, and quotes a decline's reason; the inbox shows the reason too.
//   #16 THE HOMEOWNER IS TOLD. A GC portal row raises portal_reply; notify
//       mails the last client writer's invite (else all), batches bursts, and
//       honours the homeowner's unsubscribe. (The trigger itself is executed in
//       PGlite by the scratchpad harness; here its text is pinned.)
//   #17 THE BADGE MEANS SOMETHING. No hard-coded `badge: 1`; pushes carry the
//       recipient's unread count; the app re-syncs the icon from the server
//       count on foreground and whenever the inbox's unread count moves.
//
// Pure helpers inside the Deno function / screens are evaluated from their
// `>>> name` / `<<< name` marker blocks — the real code, not a copy.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;

function evalBlock<T>(file: string, marker: string, names: string[]): T | null {
  const src = read(file);
  const start = src.indexOf(`// >>> ${marker}`);
  const end = src.indexOf(`// <<< ${marker}`);
  ok(`${file} carries the ${marker} marker block`, start > -1 && end > start);
  if (!(start > -1 && end > start)) return null;
  const js = new Transpiler({ loader: 'ts' }).transformSync(src.slice(start, end).replace(/^export /gm, ''));
  return new Function(`${js}\nreturn { ${names.join(', ')} };`)() as T;
}

/** The body of one `case 'x': { ... }` (up to the next top-level case). */
function caseBody(src: string, label: string): string {
  const i = src.indexOf(`case '${label}':`);
  if (i < 0) return '';
  const next = src.slice(i + 10).search(/\n {4}case '[a-z_]+':/);
  return next < 0 ? src.slice(i) : src.slice(i, i + 10 + next);
}

interface Route { pathname: string; params: Record<string, string> }
type RoutesMod = {
  notificationRoute: (e: string, d: Record<string, unknown> | null | undefined) => Route | null;
  routeHref: (r: Route) => string;
};

/** Every key any useLocalSearchParams<{...}> in the screen declares. */
function screenParamKeys(src: string): Set<string> {
  const keys = new Set<string>();
  const re = /useLocalSearchParams<\{([\s\S]*?)\}>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    for (const k of m[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\??\s*:/g)) keys.add(k[1]);
  }
  return keys;
}

function screenFile(pathname: string): string | null {
  const seg = pathname.replace(/^\//, '');
  for (const cand of [`app/${seg}.tsx`, `app/${seg}/index.tsx`, `app/(tabs)/${seg}.tsx`, `app/(tabs)/${seg}/index.tsx`]) {
    if (existsSync(join(ROOT, cand))) return cand;
  }
  return null;
}

const P = '11111111-2222-3333-4444-555555555555';
const CO = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FULL: Record<string, unknown> = {
  project_id: P, change_order_id: CO, rfp_id: 'rfp-1', sub_id: 'sub-1', lead_id: 'lead-1',
  invoice_id: 'inv-1', report_id: 'dr-1', item_id: 'item-1', kind: 'rfi', incident_id: 'inc-1',
};
const EVENTS = [
  'portal_message', 'budget_proposal', 'co_approval', 'contract_signed', 'selection_chosen',
  'closeout_binder_sent', 'closeout_binder_sent_confirmation', 'sub_invoice', 'sub_invoice_submitted',
  'sub_invoice_reviewed', 'nearby_rfp_posted', 'bid_question_asked', 'bid_question_answered',
  'rfp_awarded', 'lead_received', 'margin_alert', 'morning_brief', 'week_close',
  'client_invoice_paid', 'client_payment_failed', 'field_report_filed', 'pro_response_received', 'punch_marked_ready',
  'safety_incident_filed',
];

async function main() {
  // A variable specifier: tsc refuses a literal '.ts' import path, bun does not care.
  const ROUTES = '../supabase/functions/notify/routes.ts';
  const routes = (await import(ROUTES)) as RoutesMod;

  console.log('\n#12 one route table, checked against each screen');
  for (const ev of EVENTS) {
    for (const data of [FULL, { projectId: P, changeOrderId: CO, rfpId: 'rfp-1', subId: 'sub-1', leadId: 'lead-1' }, {}]) {
      const r = routes.notificationRoute(ev, data);
      if (!r) continue;
      const file = screenFile(r.pathname);
      if (!file) { ok(`${ev} → ${r.pathname} is a real screen`, false); continue; }
      const keys = screenParamKeys(read(file));
      const bad = Object.keys(r.params).filter((k) => !keys.has(k));
      ok(`${ev} → ${routes.routeHref(r)} sends only params ${file} reads`, bad.length === 0, `unread: ${bad.join(',')}; screen reads: ${[...keys].join(',')}`);
    }
  }
  const at = (ev: string, d: Record<string, unknown> = FULL) => {
    const r = routes.notificationRoute(ev, d);
    return r ? routes.routeHref(r) : null;
  };
  ok('client message opens its thread by `id`', at('portal_message') === `/client-messages?id=${P}`, String(at('portal_message')));
  ok('"You won the bid" opens project-detail by `id`', at('rfp_awarded') === `/project-detail?id=${P}`, String(at('rfp_awarded')));
  ok('a CO decision opens THAT change order', at('co_approval') === `/change-order?projectId=${P}&coId=${CO}`, String(at('co_approval')));
  ok('a push with camelCase changeOrderId opens the same CO', at('co_approval', { projectId: P, changeOrderId: CO }) === `/change-order?projectId=${P}&coId=${CO}`);
  ok('a CO decision without a CO id opens the project, never a blank CO', at('co_approval', { project_id: P }) === `/project-detail?id=${P}`);
  ok('the morning brief row opens the brief', at('morning_brief', {}) === '/brief');
  ok('a website lead opens the lead', at('lead_received') === '/lead-detail?leadId=lead-1');
  ok('an unknown event opens nothing', routes.notificationRoute('something_new', FULL) === null);
  // Wave 3 (#48 + carried events): each opens THE record, never a blank editor.
  ok('"Client paid" opens that invoice', at('client_invoice_paid') === `/invoice?projectId=${P}&invoiceId=inv-1`, String(at('client_invoice_paid')));
  ok('a payment-failed push (camelCase) opens the same invoice', at('client_payment_failed', { projectId: P, invoiceId: 'inv-1' }) === `/invoice?projectId=${P}&invoiceId=inv-1`);
  ok('a paid event with no invoice id opens the project, never a new invoice', at('client_invoice_paid', { project_id: P }) === `/project-detail?id=${P}`);
  ok('a filed daily report opens that report', at('field_report_filed') === `/daily-report?projectId=${P}&reportId=dr-1`);
  ok('an RFI response opens that RFI', at('pro_response_received') === `/rfi?projectId=${P}&rfiId=item-1`);
  ok('a submittal response opens that submittal', at('pro_response_received', { ...FULL, kind: 'submittal' }) === `/submittal?projectId=${P}&submittalId=item-1`);
  ok('a push carries the pro kind as proKind (its own kind is the event)', at('pro_response_received', { projectId: P, itemId: 'item-1', kind: 'pro_response_received', proKind: 'submittal' }) === `/submittal?projectId=${P}&submittalId=item-1`);
  // Wave 4 (#51/#54): the item itself, not the whole list.
  ok('a punch item marked ready opens that item (trigger payload: punch_item_id)', at('punch_marked_ready', { project_id: P, punch_item_id: 'pi-1', sub_name: 'Rivera' }) === `/punch-list?projectId=${P}&itemId=pi-1`, String(at('punch_marked_ready', { project_id: P, punch_item_id: 'pi-1' })));
  ok('a punch-ready push (camelCase itemId) opens the same item', at('punch_marked_ready', { projectId: P, itemId: 'pi-1', kind: 'punch_marked_ready' }) === `/punch-list?projectId=${P}&itemId=pi-1`);
  ok('a punch-ready event with no item id still opens the job\'s punch list', at('punch_marked_ready', { project_id: P }) === `/punch-list?projectId=${P}`);
  ok('notify pushes the punch item id (payload.punch_item_id), not the undefined item_id', /itemId: payload\.punch_item_id \?\? payload\.item_id/.test(read('supabase/functions/notify/index.ts')));
  // Wave 4 (#119): a foreman's incident report opens THAT case in Safety.
  ok('a filed incident opens that case', at('safety_incident_filed') === `/safety-incidents?projectId=${P}&incidentId=inc-1`, String(at('safety_incident_filed')));
  ok('an incident push (camelCase) opens the same case', at('safety_incident_filed', { projectId: P, incidentId: 'inc-1', kind: 'safety_incident_filed' }) === `/safety-incidents?projectId=${P}&incidentId=inc-1`);
  ok('an incident event with no case id opens the job\'s incidents', at('safety_incident_filed', { project_id: P }) === `/safety-incidents?projectId=${P}`);
  ok('param values are URI-encoded', routes.routeHref({ pathname: '/x', params: { a: 'b&c=d' } }) === '/x?a=b%26c%3Dd');

  console.log('\n#12 no surface keeps its own table');
  const NOTIFY = read('supabase/functions/notify/index.ts');
  const CTX = read('contexts/NotificationContext.tsx');
  const INBOX = read('app/notifications-inbox.tsx');
  ok('notify imports the shared table', /from "\.\/routes\.ts"/.test(NOTIFY));
  ok('notify builds no in-app link by hand (`${APP_BASE}/…`)', !/\$\{APP_BASE\}\//.test(NOTIFY), (NOTIFY.match(/.*\$\{APP_BASE\}\/.*/g) ?? []).join(' | '));
  ok('the old projectDeepLink helper is gone', !/projectDeepLink/.test(NOTIFY));
  ok('"View change order" passes the CO id', /appLink\('co_approval', \{ project_id: projectId, change_order_id: coId \}\)/.test(NOTIFY));
  ok('"You won the bid" goes through the table', /appLink\('rfp_awarded'/.test(caseBody(NOTIFY, 'rfp_awarded')));
  for (const [name, src] of [['NotificationContext', CTX], ['notifications-inbox', INBOX]] as const) {
    ok(`${name} imports notificationRoute`, /import \{ notificationRoute, routeHref \} from '@\/supabase\/functions\/notify\/routes'/.test(src));
    ok(`${name} hard-codes no notification screen`, !/['`]\/(client-portal-setup|client-messages|contract|selections|closeout-binder|rfp-detail|project-detail|sub-portal-setup|brief|week-close|margin-risk|margin-alerts)\?/.test(src.replace(/\/\/.*$/gm, '')));
  }

  console.log('\n#12 change-order deep-link gate');
  type CoGateIn = { coId: string | null; found: boolean; needsProject: boolean; projectsLoaded: boolean; changeOrdersLoaded: boolean; graceOver: boolean };
  const gate = evalBlock<{ coGateState: (o: CoGateIn) => string }>('app/change-order.tsx', 'co-deep-link-gate', ['coGateState']);
  if (gate) {
    const g = (o: Partial<CoGateIn>) => gate.coGateState({ coId: CO, found: false, needsProject: true, projectsLoaded: true, changeOrdersLoaded: true, graceOver: true, ...o });
    ok('no coId → the editor (a new CO is what was asked for)', g({ coId: null }) === 'editor');
    ok('coId found → the editor', g({ found: true }) === 'editor');
    ok('coId found but its project not loaded → loading (no stale picker, no $0 contract)', g({ found: true, projectsLoaded: false }) === 'loading');
    ok('a plain ?projectId= link waits for the projects too', g({ coId: null, projectsLoaded: false }) === 'loading' && g({ coId: null, needsProject: false, projectsLoaded: false }) === 'editor');
    ok('coId not loaded yet → loading, not a blank new CO', g({ projectsLoaded: false, changeOrdersLoaded: false, graceOver: false }) === 'loading');
    ok('projects loaded but change orders still loading → loading, however long it takes', g({ changeOrdersLoaded: false }) === 'loading');
    ok('coId still arriving after the CO list → loading', g({ graceOver: false }) === 'loading');
    ok('coId never arrives → missing, not a blank new CO', g({}) === 'missing');
    // Review round 1: a cold start fills changeOrders from the device cache
    // before the account's rows land — a "found" CO can be a stale copy the
    // editor would seed from once and then save back over the newer row.
    ok('coId found in the device copy but the account\'s change orders not loaded → loading', g({ found: true, changeOrdersLoaded: false }) === 'loading' && g({ found: true, changeOrdersLoaded: false, needsProject: false }) === 'loading');
  }
  const COSRC = read('app/change-order.tsx');
  ok('the screen routes through the gate', /return <ChangeOrderGate \/>/.test(COSRC) && /key=\{target\?\.id \?\? 'new'\}/.test(COSRC));

  console.log('\n#13 a change order is named by its number');
  const fmt = evalBlock<{
    fmtMoneyCents: (v: unknown) => string | null;
    coLabel: (n: unknown) => string;
    widgetBallparkText: (s: unknown) => string | null;
    scopeWithoutBallpark: (s: unknown) => string;
    replyRecipients: (inv: unknown, last: string | null, cap?: number) => { inviteId: string | null; email: string; name: string | null }[];
    badgeFromUnread: (n: number | null) => number | null;
    coAmountIsZero: (v: unknown) => boolean;
    portalBodyForEmail: (s: string) => string;
  }>('supabase/functions/notify/index.ts', 'notify-format', ['fmtMoneyCents', 'coLabel', 'widgetBallparkText', 'scopeWithoutBallpark', 'replyRecipients', 'badgeFromUnread', 'coAmountIsZero', 'portalBodyForEmail']);
  if (fmt) {
    ok('CO 7 reads "CO #7"', fmt.coLabel(7) === 'CO #7' && fmt.coLabel('7') === 'CO #7');
    ok('a uuid is never printed as a CO number', fmt.coLabel('9b1e44c0') === 'a change order' && fmt.coLabel(CO) === 'a change order' && fmt.coLabel(undefined) === 'a change order');
    ok('money to the cent', fmt.fmtMoneyCents(4812.5) === '$4,812.50' && fmt.fmtMoneyCents('4812') === '$4,812' && fmt.fmtMoneyCents(-250.05) === '-$250.05');
    ok('no amount → no line (not "$0")', fmt.fmtMoneyCents(null) === null && fmt.fmtMoneyCents('abc') === null);
  }
  if (fmt) {
    ok('a $0 CO is recognised as no cost change', fmt.coAmountIsZero(0) && fmt.coAmountIsZero('0.00') && fmt.coAmountIsZero(0.001));
    ok('…but a real amount or a missing one is not', !fmt.coAmountIsZero(12.5) && !fmt.coAmountIsZero(null) && !fmt.coAmountIsZero(''));
  }
  const CO_CASE = caseBody(NOTIFY, 'co_approval');
  ok('a $0 CO prints no amount in push/subject and says "No cost change"', /const coAmount = coNoCost \? null : fmtMoneyCents\(payload\.co_amount\)/.test(CO_CASE) && /coNoCost \? emailStatRow\('Amount', 'No cost change'\)/.test(CO_CASE));
  ok('the CO row is read scoped to the project as well as the id', /change_orders\?id=eq\.\$\{coId\}&project_id=eq\.\$\{projectCtx\.id\}/.test(CO_CASE));
  ok('the integer number is converted with String()', /payload\.co_number = String\(co\.number\)/.test(CO_CASE));
  ok('amount / new total land in the stored payload', /payload\.co_amount = /.test(CO_CASE) && /New contract total/.test(CO_CASE));
  ok('a decline quotes the homeowner\'s reason', /!isApproved && note \? emailQuote\(note\)/.test(CO_CASE));
  ok('no CO is ever named by a uuid slice', !/coId\.slice\(0, 8\)/.test(NOTIFY));
  ok('the project name is written into the stored payload', /if \(projectCtx\.id\) payload\.project_name = projectCtx\.name;/.test(NOTIFY));
  const INBOX_CO = caseBody(INBOX, 'co_approval');
  ok('the inbox shows a decline\'s reason', /decision === 'declined' && typeof p\.note === 'string'/.test(INBOX_CO));
  ok('the inbox no longer claims "Synced to your CO record"', !/Synced to your CO record/.test(INBOX));
  ok('the morning brief row shows its own title and body', /case 'morning_brief':[\s\S]{0,300}p\.title[\s\S]{0,200}p\.body/.test(INBOX));

  console.log('\n#16 the homeowner is told when the GC replies');
  const MIG = read('supabase/migrations/20260918140000_portal_reply_and_website_lead_notify.sql');
  const GC_AT = MIG.indexOf("elsif NEW.author_type = 'gc'");
  const GC_BRANCH = GC_AT < 0 ? '' : MIG.slice(GC_AT, MIG.indexOf("'portal_reply'", GC_AT));
  ok('the trigger raises portal_reply for a GC row', GC_BRANCH.length > 0 && /perform public\.fire_notify\(\s*$/.test(GC_BRANCH));
  // Cross-tenant (integration review 2026-09-18): the old INSERT policy bound
  // project_id only, and notify resolves the project portal-first, so a GC row
  // naming another contractor's portal emailed THAT contractor's homeowner.
  // Three locks; PGlite replay: scratchpad/pgtest/portal_reply_xtenant_fixed.mjs.
  const POLICY = MIG.slice(MIG.indexOf('create policy "gc inserts own portal messages"'), MIG.indexOf('create policy "gc updates read receipts"'));
  ok('lock 1: the gc INSERT policy binds portal_id to the caller\'s project', /drop policy if exists "gc inserts own portal messages"/.test(MIG) && /p\.user_id = auth\.uid\(\)\s+and p\.client_portal ->> 'portalId' = portal_messages\.portal_id/.test(POLICY));
  const UPD = MIG.slice(MIG.indexOf('create policy "gc updates read receipts"'), MIG.indexOf('create or replace function public.trg_notify_portal_message'));
  ok('lock 1: UPDATE cannot re-point a row at another portal (WITH CHECK)', /with check \([\s\S]*client_portal ->> 'portalId' = portal_messages\.portal_id/.test(UPD));
  ok('lock 2: the trigger raises only when the row\'s project owns the portal', /if not exists \(\s+select 1 from public\.projects p\s+where p\.id::text = NEW\.project_id\s+and p\.client_portal ->> 'portalId' = NEW\.portal_id\s+\) then\s+return NEW;/.test(GC_BRANCH));
  ok('system notices (no author_name) raise nothing (#23/#44 snapshot lag)', /elsif NEW\.author_type = 'gc'\s+and nullif\(btrim\(coalesce\(NEW\.author_name, ''\)\), ''\) is not null then/.test(MIG));
  {
    // Wave 3 widened the set: the money / field / design-team events are
    // raised only by stripe-webhook and the database triggers, never a JWT.
    const m = /SERVICE_ONLY_EVENTS: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\)/.exec(NOTIFY);
    const members = new Set((m?.[1] ?? '').match(/'[a-z_]+'/g)?.map((x) => x.slice(1, -1)) ?? []);
    const need = ['portal_reply', 'lead_received', 'client_invoice_paid', 'client_payment_failed', 'field_report_filed', 'pro_response_received', 'punch_marked_ready', 'safety_incident_filed'];
    ok('notify refuses the trigger-only events (portal_reply, lead_received, wave-3 money/field/design events) from anything but a trusted caller',
      need.every((e) => members.has(e)) && /!isService && SERVICE_ONLY_EVENTS\.has\(event\)/.test(NOTIFY),
      `missing: ${need.filter((e) => !members.has(e)).join(',')}`);
  }
  const REPLY = caseBody(NOTIFY, 'portal_reply');
  ok('the reply honours the homeowner\'s unsubscribe (portal_message key)', /sendIfNotSuppressed\(/.test(REPLY) && /eventKey: 'portal_message'/.test(REPLY));
  ok('lock 3: notify refuses a row whose project does not own the portal', /uuidOrNull\(payload\.project_id\)\?\.toLowerCase\(\) !== projectCtx\.id\.toLowerCase\(\)/.test(REPLY) && /skipped_portal_mismatch/.test(REPLY)
    && REPLY.indexOf('skipped_portal_mismatch') < REPLY.indexOf('sendIfNotSuppressed('));
  ok('notify skips an author-less system notice', /if \(!strOrNull\(payload\.author_name\)\)[\s\S]{0,160}skipped_system_notice/.test(REPLY));
  ok('the reply links the tokenized portal', /href: portalUrl/.test(REPLY) && /if \(!portalUrl\)/.test(REPLY));
  ok('bursts batch on an unread earlier reply', /batched_unread/.test(REPLY) && /read_by_client !== true/.test(REPLY));
  ok('the send is logged as a client outbox row', /recipient_kind: 'client'/.test(REPLY));
  // GC-authored rows include the app's own send/recall notices, so the email
  // must not claim the contractor "replied".
  ok('the portal email does not say "replied"', !/\breplied\b/.test(REPLY.replace(/\/\/.*$/gm, '')) && /sent you a message · \$\{projectName\}/.test(REPLY));
  if (fmt) ok('a system notice loses its in-app "Tap to review."', fmt.portalBodyForEmail('📋 New Change Order from your builder. Tap to review.') === '📋 New Change Order from your builder.');
  if (fmt) {
    const inv = [
      { id: 'i1', email: 'Sarah@x.com', name: 'Sarah Lee' },
      { id: 'i2', email: 'tom@x.com', name: 'Tom' },
      { id: 'i3', email: 'sarah@x.com', name: 'dup' },
      { id: 'i4', email: 'not-an-email', name: 'bad' },
    ];
    const toLast = fmt.replyRecipients(inv, 'i2');
    ok('the reply goes to the invite that wrote last', toLast.length === 1 && toLast[0].email === 'tom@x.com');
    const toAll = fmt.replyRecipients(inv, null);
    ok('nobody wrote yet → every invite, de-duplicated, valid addresses only', toAll.length === 2 && toAll[0].email === 'sarah@x.com');
    ok('a vanished invite → every invite', fmt.replyRecipients(inv, 'gone').length === 2);
    ok('no invites → nobody', fmt.replyRecipients(undefined, null).length === 0);
  }

  console.log('\n#17 the badge means something');
  ok('no hard-coded badge: 1', !/badge:\s*1\b/.test(NOTIFY));
  ok('the GC push carries the unread count', /badgeFromUnread\(await unreadCountFor\(gcUserId\)\)/.test(NOTIFY));
  if (fmt) {
    ok('unread 4 + this push → badge 5', fmt.badgeFromUnread(4) === 5 && fmt.badgeFromUnread(0) === 1);
    ok('an unreadable count sends no badge (not a made-up 1)', fmt.badgeFromUnread(null) === null && fmt.badgeFromUnread(-1) === null);
  }
  ok('the dead badgeCount / incrementBadge pair is gone', !/incrementBadge|badgeCount/.test(CTX.replace(/\/\/.*$/gm, '')));
  ok('the app sets the icon from the server count', /setBadgeCountAsync\(count\)/.test(CTX) && /count: 'exact', head: true/.test(CTX) && /\.is\('read_at', null\)/.test(CTX));
  ok('…on every return to the foreground', /next === 'active'\) void syncBadge\(\)/.test(CTX));
  // A digest marker row is never opened, so counting it would pin the badge.
  ok('the app badge count excludes daily_digest_sent', /\.not\('event_type', 'in', '\(daily_digest_sent\)'\)/.test(CTX));
  ok('the push badge count excludes daily_digest_sent', /read_at=is\.null&event_type=neq\.daily_digest_sent/.test(NOTIFY));
  ok('the inbox re-syncs when its unread count moves', /\[feed\.unreadCount, feed\.isLoading, syncBadge\]/.test(INBOX));

  // Mark all read clears the SERVER's unread set (what the icon badge counts),
  // not only the 80 rows the feed loaded.
  {
    const feed = read('hooks/useNotificationFeed.ts');
    const at = feed.indexOf('const markAllReadMutation');
    const body = at >= 0 ? feed.slice(at, at + 700) : '';
    ok('markAllRead updates every unread row of this recipient on the server',
      /\.eq\('recipient_user_id', user\.id\)\s*\.is\('read_at', null\)/.test(body)
      && /markAllReadMutation\.mutate\(\)/.test(feed));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

void main();
