// validate-health-notifyops.ts — health lane NOTIFYOPS (2026-09-27).
//
//   LS-4  a push tapped while the app was KILLED opened Home, not the screen it
//         named: the response listener is only added after the session
//         restore, and nothing read getLastNotificationResponse(). The tap
//         routing now lives in utils/notificationTap.ts (pure) and BOTH the
//         live listener and a cold-start read go through it, deduped by the
//         response id.
//   LS-7  the "reached 8h, clock X out" local reminder (kind 'shift_alert')
//         opened nothing: the shared route table had no case for it.
//   LS-5  a VIEWER seat got the full create/save UI for RFIs, submittals,
//         punch items, field tickets and photo markup; every insert/update
//         policy needs can_access_project(…, 'field'), so each save landed
//         optimistically and then failed as "Not saved".
//   SUPA-H1 fetch-external-data answered 200 {success:true} (and pinged the
//         heartbeat) while SAM.gov refused its key on every page; cached_bids
//         stopped moving on 2026-06-22 and Discover showed it as live. Now a
//         refused key / zero-row pull fails the run (502, no heartbeat), the
//         cron gets a 30 s timeout, no-deadline bids age out, and the client
//         has a pure freshness label.
//
// Fail-before: NOTIFYOPS_ROOT=<dir holding the 2859f55b copies> bun scripts/validate-health-notifyops.ts
// (the new pure modules do not exist there, so their checks fail too).

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = process.env.NOTIFYOPS_ROOT ?? join(__dirname, '..');
const has = (p: string) => existsSync(join(ROOT, p));
const read = (p: string) => (has(p) ? readFileSync(join(ROOT, p), 'utf8') : '');
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
async function load<T>(p: string): Promise<T | null> {
  if (!has(p)) return null;
  try { return (await import(join(ROOT, p))) as T; } catch (e) { console.log(`  (could not import ${p}: ${String(e).slice(0, 160)})`); return null; }
}

/** The body of `const <name> = useCallback(` up to its closing deps line. */
function callbackBody(src: string, name: string): string {
  const i = src.indexOf(`const ${name} = useCallback(`);
  if (i < 0) return '';
  const end = src.indexOf('\n  }, [', i);
  return end < 0 ? src.slice(i, i + 4000) : src.slice(i, end);
}
/** True when `if (<flag>)` guards the handler before its first write call. */
function guardedBefore(body: string, flag: string, writeCall: RegExp): boolean {
  const g = body.search(new RegExp(`if \\(${flag}\\) \\{`));
  const w = body.search(writeCall);
  return g > -1 && (w < 0 || g < w);
}

type Route = { pathname: string; params: Record<string, string> };
type RoutesMod = { notificationRoute: (e: string, d: Record<string, unknown> | null | undefined) => Route | null; routeHref: (r: Route) => string };
type TapPlan = { kind: string; href?: string; eventKind?: string | null };
type TapMod = {
  routeForNotificationResponse: (r: unknown) => TapPlan;
  createHandledResponses: () => { claim: (id: string | null) => boolean };
  notificationResponseId: (r: unknown) => string | null;
  handleNotificationResponse: (r: unknown, h: { claim: (id: string | null) => boolean }, deps: unknown) => boolean;
};
type CollabMod = {
  canWriteProjectRecords?: (r: unknown) => boolean;
  projectRecordWriteBlock?: (r: unknown) => string | null;
  collaboratorMayAccess: (r: unknown, f: string) => boolean;
};
type SourceResult = { name: string; ok: boolean; skipped: boolean; rows: number; error: string | null };
type SourceMod = {
  sourceVerdict: (i: Record<string, unknown>) => SourceResult;
  cycleOutcome: (s: SourceResult[], ts: string) => { allOk: boolean; status: number; failedSources: string[]; body: Record<string, unknown> };
};
type FreshMod = { bidsFeedFreshness: (rows: unknown, now: Date | number) => { newestFetchedAt: string | null; ageHours: number | null; label: string; stale: boolean; notChecked: boolean } };

const P = '11111111-2222-3333-4444-555555555555';
const resp = (id: string | null, data: Record<string, unknown>) => ({ notification: { request: { identifier: id, content: { data } } } });
const respAt = (id: string | null, date: number, data: Record<string, unknown>) => ({ notification: { date, request: { identifier: id, content: { data } } } });

async function main() {
  // ── LS-7 ────────────────────────────────────────────────────────────────
  console.log('\nLS-7 the shift alert opens Time Tracking');
  const routes = await load<RoutesMod>('supabase/functions/notify/routes.ts');
  const r = routes?.notificationRoute('shift_alert', { kind: 'shift_alert', entryId: 'te-1' }) ?? null;
  ok('shift_alert (kind + entryId) routes to /time-tracking', !!r && routes!.routeHref(r) === '/time-tracking', JSON.stringify(r));
  const r2 = routes?.notificationRoute('shift_alert', { projectId: P }) ?? null;
  ok('shift_alert carrying a job opens Time Tracking on it', !!r2 && routes!.routeHref(r2) === `/time-tracking?projectId=${P}`);
  ok('app/time-tracking.tsx is the real screen and reads projectId', /useLocalSearchParams<\{ projectId\?: string/.test(readFileSync(join(__dirname, '..', 'app/time-tracking.tsx'), 'utf8')));

  // ── LS-4 ────────────────────────────────────────────────────────────────
  console.log('\nLS-4 one tap handler, live AND cold start');
  const tap = await load<TapMod>('utils/notificationTap.ts');
  ok('utils/notificationTap.ts exists and imports', !!tap);
  if (tap) {
    const paid = tap.routeForNotificationResponse(resp('n1', { kind: 'client_invoice_paid', projectId: P, invoiceId: 'inv-9' }));
    ok('client_invoice_paid → /invoice with project + invoice ids', paid.kind === 'route' && paid.href === `/invoice?projectId=${P}&invoiceId=inv-9`, JSON.stringify(paid));
    const shift = tap.routeForNotificationResponse(resp('n2', { kind: 'shift_alert', entryId: 'te-1' }));
    ok('shift_alert → /time-tracking', shift.kind === 'route' && shift.href === '/time-tracking', JSON.stringify(shift));
    const ask = tap.routeForNotificationResponse(resp('n3', { kind: 'ask_seed', seed: 'why is margin down?', screen: 'margin' }));
    ok('ask_seed → Ask with the seed and screen', ask.kind === 'ask' && ask.href === '/ask?seed=why%20is%20margin%20down%3F&screen=margin', JSON.stringify(ask));
    ok('bare ask_seed → /ask', tap.routeForNotificationResponse(resp('n4', { kind: 'ask_seed' })).href === '/ask');
    ok('legacy conversationId → /messages', tap.routeForNotificationResponse(resp('n5', { conversationId: 'c1' })).href === '/messages?id=c1');
    ok('legacy bidId → /bid-detail', tap.routeForNotificationResponse(resp('n6', { bidId: 'b1' })).href === '/bid-detail?id=b1');
    ok('legacy changeOrderId → /change-order', tap.routeForNotificationResponse(resp('n7', { changeOrderId: 'co1' })).href === '/change-order?coId=co1');
    ok('kinded push with nothing openable → refresh only', tap.routeForNotificationResponse(resp('n8', { kind: 'lien_waiver_signed' })).kind === 'refresh');
    ok('no data → none', tap.routeForNotificationResponse(resp('n9', {})).kind === 'none' && tap.routeForNotificationResponse(null).kind === 'none');
    ok('response id with no delivery date is the request identifier', tap.notificationResponseId(resp('abc', {})) === 'abc' && tap.notificationResponseId({}) === null);
    ok('response id keys the DELIVERY: identifier@date', tap.notificationResponseId(respAt('abc', 1790000000000, {})) === 'abc@1790000000000');
    ok('a non-finite date falls back to the identifier', tap.notificationResponseId(respAt('abc', Number.NaN, {})) === 'abc');
    ok('no identifier → null even with a date', tap.notificationResponseId(respAt(null, 1790000000000, {})) === null);
    // expo-notifications serializes notification.date as SECONDS (a double) on
    // iOS and MILLISECONDS on Android. The key normalises both to whole ms.
    ok('iOS seconds double → whole ms in the key', tap.notificationResponseId(respAt('abc', 1790000000.1234, {})) === 'abc@1790000000123');
    ok('the same instant in iOS seconds and Android ms gives the same key',
      tap.notificationResponseId(respAt('abc', 1790000000.5, {})) === tap.notificationResponseId(respAt('abc', 1790000000500, {})));
    ok('a zero / negative date falls back to the identifier',
      tap.notificationResponseId(respAt('abc', 0, {})) === 'abc' && tap.notificationResponseId(respAt('abc', -5, {})) === 'abc');

    const h = tap.createHandledResponses();
    ok('dedupe: first claim of an id is true', h.claim('x-1') === true);
    ok('dedupe: second claim of the same id is false', h.claim('x-1') === false);
    ok('dedupe: another id is still claimable', h.claim('x-2') === true);
    ok('dedupe: a response with no id is never swallowed', h.claim(null) === true && h.claim(null) === true);

    // The shared handler, driven like the context drives it: the listener and
    // the cold-start read hand it the SAME response — one navigation.
    const pushes: string[] = [];
    const refreshed: string[] = [];
    const deps = {
      push: (href: string) => { pushes.push(href); },
      refreshDeps: { invalidate: () => undefined, refetchInvoicesNow: async () => undefined },
      // The context's openRoute: refresh first, then open (routeHref of the route).
      openRoute: (kind: string, _d: unknown, route: Route) => { refreshed.push(kind); pushes.push(routes ? routes.routeHref(route) : ''); },
      refreshForNotification: (kind: string) => { refreshed.push(kind); },
    };
    const handled = tap.createHandledResponses();
    const launch = resp('launch-1', { kind: 'client_invoice_paid', projectId: P, invoiceId: 'inv-9' });
    const first = tap.handleNotificationResponse(launch, handled, deps);
    const second = tap.handleNotificationResponse(launch, handled, deps);
    ok('listener + cold-start read of one tap navigate exactly once', first === true && second === false && pushes.length === 1 && pushes[0] === `/invoice?projectId=${P}&invoiceId=inv-9`, JSON.stringify({ first, second, pushes }));
    ok('a money notice re-reads before it opens (openRoute gets the table route)', refreshed[0] === 'client_invoice_paid');
    tap.handleNotificationResponse(resp('legacy-1', { kind: 'old_kind', conversationId: 'c1' }), handled, deps);
    ok('a kinded legacy push refreshes AND opens its legacy screen', pushes[1] === '/messages?id=c1' && refreshed.includes('old_kind'));
    ok('a null response does nothing', tap.handleNotificationResponse(null, handled, deps) === false);

    // A repeating local reminder reuses ONE request identifier for every
    // delivery ('mageid-morning-brief-nudge', 'mageid-lineup-reminder-<day>',
    // 'mageid-week-close-nudge'). Same identifier + same date = the same tap
    // (listener + cold start): once. Same identifier + a later date = the next
    // delivery: it must open again, in the same app session.
    const MON = Date.UTC(2026, 8, 28, 11, 0, 0);
    const TUE = Date.UTC(2026, 8, 29, 11, 0, 0);
    const nudge = (at: number) => respAt('mageid-morning-brief-nudge', at, { kind: 'morning_brief' });
    const rh = tap.createHandledResponses();
    const before = pushes.length;
    const monFirst = tap.handleNotificationResponse(nudge(MON), rh, deps);
    const monAgain = tap.handleNotificationResponse(nudge(MON), rh, deps);
    const tue = tap.handleNotificationResponse(nudge(TUE), rh, deps);
    ok('reminder: same identifier + same date is claimed once', monFirst === true && monAgain === false, JSON.stringify({ monFirst, monAgain }));
    ok('reminder: same identifier + a later date is claimable (the next delivery opens)', tue === true && pushes.length - before === 2, JSON.stringify({ tue, opened: pushes.slice(before) }));
    const lineup = (at: number) => respAt('mageid-lineup-reminder-1', at, { kind: 'morning_brief' });
    const w1 = tap.handleNotificationResponse(lineup(MON), rh, deps);
    const w2 = tap.handleNotificationResponse(lineup(MON + 7 * 86400000), rh, deps);
    ok('weekly reminder: week 2 opens after week 1 was tapped', w1 === true && w2 === true, JSON.stringify({ w1, w2 }));
    // The same reminder on iOS, where the date arrives in seconds.
    const iosNudge = (atMs: number) => respAt('mageid-week-close-nudge', atMs / 1000 + 0.000123, { kind: 'morning_brief' });
    const iosFirst = tap.handleNotificationResponse(iosNudge(MON), rh, deps);
    const iosAgain = tap.handleNotificationResponse(iosNudge(MON), rh, deps);
    const iosNext = tap.handleNotificationResponse(iosNudge(TUE), rh, deps);
    ok('iOS (seconds date): one tap once, the next day\'s delivery opens again', iosFirst === true && iosAgain === false && iosNext === true, JSON.stringify({ iosFirst, iosAgain, iosNext }));
  }

  const CTX = code('contexts/NotificationContext.tsx');
  const RAW_CTX = read('contexts/NotificationContext.tsx');
  ok('context reads getLastNotificationResponse (the launch tap)', /getLastNotificationResponse/.test(CTX));
  ok('the read is guarded: web skipped, missing function skipped, throw caught', /Platform\.OS === 'web'\) return null/.test(CTX) && /typeof get === 'function'/.test(CTX) && /catch\s*\{\s*return null;/.test(CTX));
  ok('context clears the last response once acted on (SDK exposes clearLastNotificationResponse)', /clearLastNotificationResponse/.test(CTX) && /if \(acted\) clearLastResponse\(\)/.test(CTX));
  // The cold-start effect: waits for auth, the first-run gates and the navigator.
  const coldIdx = CTX.indexOf('const launch = readLastResponse()');
  const coldEffect = coldIdx > -1 ? CTX.slice(CTX.lastIndexOf('useEffect(() => {', coldIdx), coldIdx + 200) : '';
  ok('cold-start read runs only after the auth gate', /if \(!isAuthenticated \|\| !user\) return;/.test(coldEffect));
  ok('…after the first-run gates settle (persona + onboarding)', /coreLoading \|\| userRole === null \|\| hasSeenOnboarding !== true\) return;/.test(coldEffect));
  ok('…and only once the root navigator is ready', /if \(!navReady\) return;/.test(coldEffect) && /useRootNavigationState\(\)/.test(CTX));
  ok('cold-start read goes through the shared handler', /if \(launch\) actOnResponse\(launch\)/.test(coldEffect));
  const listenerIdx = CTX.indexOf('addNotificationResponseListener((response)');
  ok('the live listener goes through the same shared handler', listenerIdx > -1 && /actOnResponse\(response\)/.test(CTX.slice(listenerIdx, listenerIdx + 600)));
  ok('actOnResponse calls handleNotificationResponse with ONE handled-id ref', /handleNotificationResponse\(response, handledResponsesRef\.current,/.test(CTX) && /useRef\(createHandledResponses\(\)\)/.test(CTX));
  ok('context keeps no second copy of the routing (no notificationRoute / legacy branches)', !/notificationRoute\(/.test(CTX) && !/bid-detail\?id=/.test(CTX) && RAW_CTX.length > 0);

  // ── LS-5 ────────────────────────────────────────────────────────────────
  console.log('\nLS-5 viewer seats: filing is off and says why');
  const collab = await load<CollabMod>('utils/collaboratorAccess.ts');
  const cw = collab?.canWriteProjectRecords;
  const wb = collab?.projectRecordWriteBlock;
  ok('canWriteProjectRecords + projectRecordWriteBlock are exported', typeof cw === 'function' && typeof wb === 'function');
  if (cw && wb && collab) {
    ok('owner / editor / field may file', cw('owner') && cw('editor') && cw('field'));
    ok('viewer may not', cw('viewer') === false);
    ok('null / undefined (own job, no project picked) may file', cw(null) && cw(undefined));
    ok('the viewer reason names the role and who to ask', wb('viewer') === 'You have view access to this project. Filing needs Field or Editor access. Ask the project owner.', String(wb('viewer')));
    ok('no reason for a seat that may file', [ 'owner', 'editor', 'field', null, undefined ].every((x) => wb(x) === null));
    ok('FEATURE_ROLES unchanged: a viewer still READS RFIs / punch / photos', collab.collaboratorMayAccess('viewer', 'rfis_submittals') && collab.collaboratorMayAccess('viewer', 'punch_list_closeout') && collab.collaboratorMayAccess('viewer', 'photo_documentation'));
  }
  const IMPORT = /import \{ projectRecordWriteBlock \} from '@\/utils\/collaboratorAccess'/;
  const SCREENS: { file: string; flag: string; handlers: [string, RegExp][]; reason: RegExp }[] = [
    { file: 'app/rfi.tsx', flag: 'writeBlock', handlers: [['handleSave', /addRFI\(|persistForm\(/]], reason: /testID="rfi-save-viewer"/ },
    { file: 'app/submittal.tsx', flag: 'writeBlock', handlers: [['handleSave', /addSubmittal\(|persistForm\(/], ['persistForm', /updateSubmittal\(/], ['handleAddCycle', /addReviewCycle\(/]], reason: /testID="submittal-save-viewer"/ },
    { file: 'app/punch-list.tsx', flag: 'recordWriteBlock', handlers: [
      ['handleSave', /addPunchItem\(|updatePunchItem\(/], ['handleApplyTemplate', /addPunchItem\(/], ['fileWalkShots', /addPunchItems\(/], ['handleStatusChange', /updatePunchItem\(/],
      // Fix round 1: every other punch_items UPDATE path a viewer can reach.
      ['handleReject', /updatePunchItem\(/], ['runBulkUpdate', /updatePunchItems\(/], ['bulkSetStatus', /updatePunchItems\(/], ['moveItem', /updatePunchItem\(/],
    ], reason: /testID="punch-viewer-block"/ },
    { file: 'app/submittal.tsx', flag: 'writeBlock', handlers: [['takeScheduleDate', /updateSubmittal\(/]], reason: /testID="submittal-save-viewer"/ },
    { file: 'app/field-ticket.tsx', flag: 'writeBlock', handlers: [['handleSign', /signFieldTicket\(/], ['handleSaveUnsigned', /addFieldTicket\(/], ['handleVoid', /updateFieldTicket\(/]], reason: /testID="ticket-viewer-block"/ },
    { file: 'app/photo-annotator.tsx', flag: 'writeBlock', handlers: [['handleSave', /updateProjectPhoto\(/]], reason: /testID="photo-markup-viewer-block"/ },
    { file: 'app/punch-walk.tsx', flag: 'writeBlock', handlers: [['handleSave', /onAdd\(/]], reason: /testID="walk-viewer-block"/ },
    { file: 'app/ai-punch.tsx', flag: 'writeBlock', handlers: [['handleAnalyze', /analyzePunchPhotos|fetch\(|invoke\(/], ['handleSaveOne', /addPunchItem\(/], ['handleSaveAll', /addPunchItems\(/]], reason: /testID="ai-punch-viewer-block"/ },
  ];
  for (const s of SCREENS) {
    const src = code(s.file);
    ok(`${s.file} imports projectRecordWriteBlock`, IMPORT.test(src));
    ok(`${s.file} derives ${s.flag} from the seat`, new RegExp(`const ${s.flag} = projectRecordWriteBlock\\(`).test(src));
    for (const [h, write] of s.handlers) {
      const body = callbackBody(src, h);
      ok(`${s.file} ${h} returns early on ${s.flag} before it writes`, body.length > 0 && guardedBefore(body, s.flag, write), body ? '' : 'handler not found');
    }
    ok(`${s.file} shows the reason where the control is`, s.reason.test(src));
  }
  // The save controls themselves are disabled for a viewer.
  const rfiSrc = code('app/rfi.tsx');
  const viewerOff = /const viewerSaveOff = writeBlock \? \{ disabled: true \} : null;/.test(rfiSrc);
  ok('rfi Create/Update button is disabled on writeBlock', viewerOff && /disabled=\{!!responseConflict\} \{\.\.\.viewerSaveOff\}[^\n]*testID="rfi-save"/.test(rfiSrc));
  // rfi "Save changes" (handleSaveInPlace -> persistForm) has two entry points,
  // both off for a viewer: the button (above) and the desktop Cmd+S hotkey.
  ok('rfi Save changes button is disabled on writeBlock', viewerOff && /disabled=\{!!responseConflict\} \{\.\.\.viewerSaveOff\}[^\n]*testID="rfi-save-in-place"/.test(rfiSrc));
  ok('rfi Cmd+S / Cmd+Enter is disabled on writeBlock and says why', /disabled: !!responseConflict \|\| !!writeBlock,\s*reason: writeBlock \?\? RFI_RESPONSE_CONFLICT_REASON,/.test(rfiSrc));
  ok('rfi sends are blocked on writeBlock', /const sendBlock = existingRFI \? \(writeBlock \?\?/.test(rfiSrc));
  ok('submittal Create/Update button is disabled on writeBlock', /disabled=\{writeBlock \? true : undefined\}[^\n]*testID="submittal-save"/.test(code('app/submittal.tsx')));
  ok('punch Add Item / Update button is disabled on recordWriteBlock', /disabled=\{recordWriteBlock \? true : undefined\}[^\n]*testID="save-punch-item"/.test(code('app/punch-list.tsx')));
  {
    const punchSrc = code('app/punch-list.tsx');
    // The edit sheet's StatusPipeline writes status straight to the row: its
    // advance returns early with the reason for a viewer. (The anchor text
    // `onAdvance={(next) => {` is pinned by validate-punch-export G2, so the
    // control is guarded rather than hidden.)
    const pIdx = punchSrc.indexOf('<StatusPipeline');
    const pipe = pIdx > -1 ? punchSrc.slice(pIdx, punchSrc.indexOf('/>', punchSrc.indexOf('updatePunchItem(editingItem.id, patch)', pIdx))) : '';
    ok('punch edit-sheet StatusPipeline advance returns early on recordWriteBlock before it writes', pipe.length > 0 && /onAdvance=\{\(next\) => \{/.test(pipe) && guardedBefore(pipe.slice(pipe.indexOf('onAdvance=')), 'recordWriteBlock', /updatePunchItem\(/) && /if \(recordWriteBlock\) \{\s*showAlert\(t\('field\.punch\.cantChangeStatus', "Can't Change Status"\), recordWriteBlock\);\s*return;/.test(pipe));
    // The row rail's Reject opens a note modal; a viewer is told why up front
    // instead of typing a note that cannot be saved.
    const rIdx = punchSrc.indexOf('onReject: item => {');
    const rej = rIdx > -1 ? punchSrc.slice(rIdx, rIdx + 400) : '';
    ok('punch row Reject tells a viewer why before opening the note modal', /latestActions\.current\.recordWriteBlock/.test(rej) && rej.indexOf('recordWriteBlock') < rej.indexOf('setShowRejectModal'));
  }
  {
    const subSrc = code('app/submittal.tsx');
    // Cmd+S runs handleSave / handleSaveInPlace -> persistForm, both guarded
    // above (they alert the reason). The call itself is pinned byte-for-byte by
    // validate-g-logs, so the hotkey is not re-shaped here.
    ok('submittal Cmd+S reaches only guarded handlers (handleSaveInPlace -> persistForm)', /usePrimaryAction\(existingSubmittal \? handleSaveInPlace : handleSave, /.test(subSrc) && /const handleSaveInPlace = useCallback\(\(\) => \{\s*if \(!persistForm\(\)\) return;/.test(subSrc));
    ok('submittal "Update to <date>" button is disabled on writeBlock', /onPress=\{takeScheduleDate\} disabled=\{writeBlock \? true : undefined\}/.test(subSrc) && /testID="submittal-take-schedule-viewer"/.test(subSrc));
  }
  ok('field-ticket detail "Get signature now" shows the viewer reason next to it', /testID="ticket-sign-existing"[\s\S]{0,200}testID="ticket-detail-viewer-block"/.test(code('app/field-ticket.tsx')));
  ok('field-ticket Save + Get signature are disabled on writeBlock', (code('app/field-ticket.tsx').match(/disabled=\{!readiness\.ready \|\| !!writeBlock\}/g) ?? []).length === 2);
  ok('punch walk Save is disabled on writeBlock', /disabled=\{!draft\.description\.trim\(\) \|\| !!writeBlock\}/.test(code('app/punch-walk.tsx')));
  ok('AI punch Run AI + Save all are disabled on writeBlock', /disabled=\{busy \|\| pickedPhotos\.length === 0 \|\| !!writeBlock\}/.test(code('app/ai-punch.tsx')) && /disabled=\{saving \|\| !!writeBlock\}/.test(code('app/ai-punch.tsx')));

  // ── SUPA-H1 ─────────────────────────────────────────────────────────────
  console.log('\nSUPA-H1 a dead provider key fails the sync out loud');
  const src = await load<SourceMod>('supabase/functions/fetch-external-data/sourceStatus.ts');
  ok('sourceStatus.ts exists and imports', !!src);
  if (src) {
    const v = src.sourceVerdict;
    ok('401 with a key → failed', v({ name: 'sam', keyPresent: true, failedStatuses: [401], rows: 0 }).ok === false);
    ok('403 → failed even with rows', v({ name: 'sam', keyPresent: true, failedStatuses: [403], rows: 50 }).ok === false);
    ok('0 rows with a key → failed', v({ name: 'sam', keyPresent: true, rows: 0 }).ok === false);
    ok('no key → skipped, not failed', (() => { const x = v({ name: 'sam', keyPresent: false, rows: 0 }); return x.ok && x.skipped; })());
    ok('not due (weekly Places) → skipped, not failed', (() => { const x = v({ name: 'google_places', keyPresent: true, notDue: true, rows: 0 }); return x.ok && x.skipped; })());
    ok('a thrown error → failed', v({ name: 'adzuna', keyPresent: true, rows: 0, error: 'TypeError' }).ok === false);
    ok('a failed cache write → failed', v({ name: 'sam', keyPresent: true, rows: 120, writeError: 'rls' }).ok === false);
    ok('rows and no auth failure → ok (a stray 500 page is partial, not dead)', (() => { const x = v({ name: 'sam', keyPresent: true, failedStatuses: [500], rows: 200 }); return x.ok && !x.skipped && x.error === null; })());
    const good = [v({ name: 'sam', keyPresent: true, rows: 200 }), v({ name: 'google_places', keyPresent: true, notDue: true, rows: 0 })];
    const allOk = src.cycleOutcome(good, 't');
    ok('all ok / skipped → 200 success, heartbeat allowed', allOk.allOk && allOk.status === 200 && allOk.body.success === true);
    const bad = src.cycleOutcome([v({ name: 'sam', keyPresent: true, failedStatuses: [401], rows: 0 }), v({ name: 'adzuna', keyPresent: true, rows: 90 })], 't');
    ok('any failure → 502 {success:false, failedSources:[sam], sources}', !bad.allOk && bad.status === 502 && bad.body.success === false && JSON.stringify(bad.body.failedSources) === '["sam"]' && Array.isArray(bad.body.sources));
  }
  const FN = code('supabase/functions/fetch-external-data/index.ts');
  ok('index.ts imports the verdicts from ./sourceStatus.ts', /from '\.\/sourceStatus\.ts'/.test(FN));
  ok('fetchSamPage reports the failed status instead of a bare []', /failedStatus: r\.status/.test(FN));
  ok('each provider pushes a verdict (sam, adzuna, google_places)', ['sam', 'adzuna', 'google_places'].every((n) => new RegExp(`sourceVerdict\\(\\{ name: '${n}'`).test(FN)));
  const hbIdx = FN.indexOf("Deno.env.get('BETTERSTACK_HEARTBEAT_FETCH_EXTERNAL')");
  const allOkIdx = FN.indexOf('if (outcome.allOk) {');
  const elseIdx = FN.indexOf('} else {', allOkIdx);
  ok('the heartbeat is pinged ONLY inside the all-ok branch', allOkIdx > -1 && hbIdx > allOkIdx && hbIdx < elseIdx && (FN.match(/BETTERSTACK_HEARTBEAT_FETCH_EXTERNAL/g) ?? []).length === 1);
  ok('the response status comes from the outcome (502 on failure)', /status: outcome\.status/.test(FN) && !/success: true, message: 'Data fetch cycle complete'/.test(FN));
  ok('cleanup deletes no-deadline bids posted > 60 days ago', /\.from\('cached_bids'\)\.delete\(\)\.is\('response_deadline', null\)\.lt\('posted_date', sixtyDaysAgo\)/.test(FN) && /60 \* 24 \* 60 \* 60 \* 1000/.test(FN));
  ok('the old past-deadline delete is kept', /\.lt\('response_deadline', now\)\.not\('response_deadline', 'is', null\)/.test(FN));
  const MIG = read('supabase/migrations/20260927100000_fetch_external_data_cron_timeout.sql');
  ok('cron migration re-schedules the same job with a 30 s timeout', /cron\.schedule\('fetch-external-data-schedule', '0 6,12,18,22 \* \* \*'/.test(MIG) && /timeout_milliseconds := 30000/.test(MIG));
  ok('cron migration carries no literal key (repo pattern)', /current_setting\('app\.settings\.service_role_key', true\)/.test(MIG) && /private\.cron_auth/.test(MIG) && !/eyJ[A-Za-z0-9_-]{10,}/.test(MIG));

  const fresh = await load<FreshMod>('utils/bidsFreshness.ts');
  ok('utils/bidsFreshness.ts exists and imports', !!fresh);
  if (fresh) {
    const f = fresh.bidsFeedFreshness;
    const now = Date.parse('2026-09-27T12:00:00Z');
    const empty = f([], now);
    ok('no rows → "Not checked", never fresh / never 0', empty.label === 'Not checked' && empty.notChecked && !empty.stale && empty.ageHours === null);
    ok('rows without fetched_at → "Not checked"', f([{ fetched_at: null }, {}], now).label === 'Not checked');
    const june = f([{ fetched_at: '2026-06-22T22:00:26Z' }, { fetched_at: '2026-04-11T02:24:30Z' }], now);
    ok('prod today (newest 2026-06-22) → stale, "Updated 96 days ago"', june.stale && june.label === 'Updated 96 days ago' && june.newestFetchedAt === '2026-06-22T22:00:26.000Z', JSON.stringify(june));
    ok('3 hours old → not stale, "Updated 3 hours ago"', (() => { const x = f([{ fetched_at: '2026-09-27T09:00:00Z' }], now); return !x.stale && x.label === 'Updated 3 hours ago'; })());
    ok('48 h exactly is not yet stale; 49 h is', !f([{ fetched_at: '2026-09-25T12:00:00Z' }], now).stale && f([{ fetched_at: '2026-09-25T11:00:00Z' }], now).stale);
    ok('under an hour → "Updated just now"', f([{ fetched_at: '2026-09-27T11:30:00Z' }], now).label === 'Updated just now');
    ok('a future fetched_at clamps to 0, not negative', f([{ fetched_at: '2026-09-28T12:00:00Z' }], now).ageHours === 0);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
