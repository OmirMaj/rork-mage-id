// validate-records-open-before-load.ts — guards for the "records open before
// load" hotfix lane (post-ship review 2026-09-18: #1, #2, #24, #30, #42, #43,
// #145).
//
//   #1  A daily report opened by id before the report list has loaded (a web
//       refresh on /daily-report?reportId=) mounted a BLANK form, and Save /
//       Submit / the leave prompt's "Save draft" wrote it over the real day.
//       The screen now gates on ProjectContext's `dailyReportsLoaded` (loading →
//       editor, or "not found"), the editor is keyed on the report, and
//       handleSave refuses a named report it does not hold, or a draft save
//       over a submitted one.
//   #24 / #42 / #145  Client Outbox (and the voice mic for a CO) linked with
//       `?id=` to screens that read coId / invoiceId / rfiId / submittalId /
//       reportId — a blank NEW record opened in place of the one listed. Every
//       outbox route is checked against the target screen's OWN
//       useLocalSearchParams keys here.
//   #43 The CO gate waits on `changeOrdersLoaded` (the query settling), not a
//       fixed 4 s clock, and never mounts the editor before the projects land.
//       (Its state matrix is evaluated by validate-notification-routes.ts.)
//   #2  "Send & Save" said "saved" when nothing was: the CO is now validated
//       before the email, written ONCE after it with the status the send earned,
//       and the message states the email outcome and the write outcome
//       (synced / queued / failed / pending) separately.
//   #30 A failed contract read seeded a fresh draft, and signing it inserted a
//       second live contract. loadActiveContract keeps "could not read" apart
//       from "none"; saveContractDetailed refuses an id-less insert when the
//       job has a live contract; a partial unique index backs it.
//
// Pure helpers are evaluated from their `>>> name` / `<<< name` blocks, and
// contractEngine's load/save are EXECUTED against a scripted fake Supabase —
// the real code, not a copy.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { notificationRefreshPlan } from '../utils/notificationTapRefresh';

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
const transpile = (src: string) => new Transpiler({ loader: 'ts' }).transformSync(src);

function evalBlock<T>(file: string, marker: string, names: string[]): T | null {
  const src = read(file);
  const start = src.indexOf(`// >>> ${marker}`);
  const end = src.indexOf(`// <<< ${marker}`);
  ok(`${file} carries the ${marker} marker block`, start > -1 && end > start);
  if (!(start > -1 && end > start)) return null;
  const js = transpile(src.slice(start, end).replace(/^export /gm, ''));
  return new Function(`${js}\nreturn { ${names.join(', ')} };`)() as T;
}

/** Evaluate a whole pure module (type-only imports stripped by the transpiler). */
function evalBlockWhole<T>(file: string, names: string[]): T | null {
  try {
    const js = transpile(read(file).replace(/^import [^;]+;$/gm, '').replace(/^export /gm, ''));
    return new Function(`${js}\nreturn { ${names.join(', ')} };`)() as T;
  } catch (e) {
    ok(`${file} evaluates`, false, String(e));
    return null;
  }
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

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
/** The body of a `const name = useCallback(` up to its deps array. */
function callbackBody(code: string, name: string): string {
  const i = code.indexOf(`const ${name} = useCallback(`);
  if (i < 0) return '';
  const j = code.indexOf('\n  }, [', i);
  return j < 0 ? '' : code.slice(i, j);
}

async function main() {
  // ── #24 / #42 / #145: outbox routes name params their screens read ──────────
  console.log('\n#24 #42 #145 Client Outbox routes match each screen\'s params');
  const OUTBOX = read('app/client-outbox.tsx');
  const rStart = OUTBOX.indexOf('const routeForKind =');
  const rEnd = OUTBOX.indexOf('\n  };', rStart);
  const routeBody = rStart > 0 && rEnd > rStart ? OUTBOX.slice(rStart, rEnd) : '';
  ok('routeForKind found', routeBody.length > 0);
  const routes: [string, string, string, string][] = [...routeBody.matchAll(/case '([a-z_]+)':\s*return `(\/[a-z-]+)(?:\?([^`]*))?`/g)]
    .map(m => [m[0], m[1], m[2], m[3] ?? '']);
  // aia_pay_app is built in a block (invoice-keyed); its template strings are checked the same way.
  for (const m of routeBody.matchAll(/`(\/aia-pay-app)\?([^`]*)`/g)) routes.push([m[0], 'aia_pay_app', m[1], m[2]]);
  ok('every sendable kind has a route (9 kinds + the unlinked pay-app fallback)', routes.length >= 10, String(routes.length));
  for (const m of routes) {
    const [, kind, path, query] = m;
    const file = screenFile(path);
    if (!file) { ok(`${kind} → ${path} is a real screen`, false); continue; }
    const keys = screenParamKeys(read(file));
    const pairs = query.split('&').filter(Boolean).map(p => p.split('='));
    const unread = pairs.map(([k]) => k).filter(k => !keys.has(k));
    ok(`${kind} → ${path} sends only params ${file} reads`, unread.length === 0, `unread: ${unread.join(',')}; screen reads: ${[...keys].join(',')}`);
    // The item's own id must ride on the key the screen LOOKS IT UP by — never
    // a bare `id` unless that really is the screen's record key.
    const idKey = pairs.find(([, v]) => v === '${id}')?.[0];
    if (idKey) ok(`${kind}: the item id rides on \`${idKey}\`, not a generic id`, idKey !== 'id', `key ${idKey}`);
  }
  const want: Record<string, string> = {
    change_order: '/change-order?coId=${id}&projectId=${pid}',
    invoice: '/invoice?invoiceId=${id}&projectId=${pid}',
    rfi: '/rfi?rfiId=${id}&projectId=${pid}',
    submittal: '/submittal?submittalId=${id}&projectId=${pid}',
    daily_report: '/daily-report?reportId=${id}&projectId=${pid}',
    warranty: '/warranties?projectId=${pid}',
  };
  for (const [k, v] of Object.entries(want)) {
    ok(`outbox ${k} opens ${v}`, routeBody.includes(`case '${k}':`) && routeBody.includes('`' + v + '`'));
  }

  // The mic's CO push, and any other /change-order push, names coId.
  const MIC = read('components/UniversalMicButton.tsx');
  ok('the voice mic opens the drafted CO by coId, on its project',
    /router\.push\(\{ pathname: '\/change-order', params: \{ coId: newId, projectId: proj\.id \} \}\)/.test(MIC));
  const pushers = ['components/UniversalMicButton.tsx', 'app/client-outbox.tsx'];
  for (const f of pushers) {
    const code = stripComments(read(f));
    ok(`${f} never opens /change-order with a bare id`,
      !/\/change-order\?id=/.test(code) && !/pathname: '\/change-order'[^}]*params: \{ id:/.test(code));
  }

  // ── #1: the daily report does not mount before its report has loaded ────────
  console.log('\n#1 daily report opened before the reports load');
  const dfr = evalBlock<{ dfrOpenState: (o: { reportId: string | null; found: boolean; reportsLoaded: boolean; projectPending: boolean }) => string }>(
    'app/daily-report.tsx', 'dfr-open-gate', ['dfrOpenState']);
  if (dfr) {
    const g = (o: Partial<{ reportId: string | null; found: boolean; reportsLoaded: boolean; projectPending: boolean }>) =>
      dfr.dfrOpenState({ reportId: 'r1', found: false, reportsLoaded: false, projectPending: false, ...o });
    ok('a named report still loading → loading, never the blank editor', g({}) === 'loading');
    ok('a named report once loaded and present → the editor', g({ found: true, reportsLoaded: true }) === 'editor');
    ok('a named report the loaded list lacks → missing (not a spinner, not a new report)', g({ reportsLoaded: true }) === 'missing');
    ok('no report named → the editor (a new report is what was asked for)', g({ reportId: null }) === 'editor');
    // Review round 1: the cold-start signed-out pass fills dailyReports from
    // the device cache, so `found` can be an hours-old copy. The editor seeds
    // from it once and never re-seeds, so Save wrote the old copy over the day.
    ok('a named report found in the device copy before the account\'s reports load → loading, not the editor', g({ found: true }) === 'loading');
    ok('the URL\'s project still loading → loading (no stale-project picker flash)', g({ reportId: null, projectPending: true }) === 'loading' && g({ found: true, reportsLoaded: true, projectPending: true }) === 'loading');
  }
  const DFR = read('app/daily-report.tsx');
  const dfrCode = stripComments(DFR);
  const gateStart = dfrCode.indexOf('export default function DailyReportScreen()');
  const innerStart = dfrCode.indexOf('function DailyReportInner(');
  const gateBody = gateStart > 0 && innerStart > gateStart ? dfrCode.slice(gateStart, innerStart) : '';
  ok('the default export is the gate, reading dailyReportsLoaded', /dailyReportsLoaded/.test(gateBody) && /dfrOpenState\(/.test(gateBody));
  ok('…which accepts `id` as an alias for reportId', /const reportId = params\.reportId \?\? params\.id \?\? null;/.test(gateBody));
  ok('…and mounts the editor keyed on the report, so every field seeds from it',
    /<DailyReportInner key=\{found\?\.id \?\? 'new'\} reportId=\{found\?\.id\} projectIdOverride=\{found\?\.projectId\} \/>/.test(gateBody));
  // Review round 1: a cold-start deep link has nothing to pop — a bare
  // router.back() there is a dead button, and the loading state had no exit.
  ok('…whose loading and not-found states both exit through useSafeBack, never a bare router.back()',
    /const goBack = useSafeBack\(\);/.test(gateBody) && !/router\.back\(\)/.test(gateBody)
    && /testID="dfr-open-loading-back"/.test(gateBody) && /onPress=\{goBack\} testID="dfr-open-back"/.test(gateBody));
  ok('…with a Retry on the not-found state', /onPress=\{retryRemoteReads\}/.test(gateBody) && gateBody.includes('dfr-open-${state}'));
  const innerHead = dfrCode.slice(innerStart, innerStart + 3000);
  ok('the editor takes reportId from the gate, not from the URL', !/useLocalSearchParams<\{[^}]*reportId/.test(innerHead));
  const save = callbackBody(dfrCode, 'handleSave');
  const guardAt = save.indexOf('if (reportId && !existingReport) {');
  const firstWrite = Math.min(...['updateDailyReport(', 'addDailyReport(', 'addIncident(', 'updateIncident('].map(w => { const i = save.indexOf(w); return i < 0 ? Infinity : i; }));
  ok('handleSave refuses a named report it does not hold — before any write', guardAt > 0 && guardAt < firstWrite, `guard ${guardAt}, first write ${firstWrite}`);
  ok('…and says why', /showAlert\('Not saved',/.test(save.slice(guardAt, guardAt + 400)));
  const sentAt = save.indexOf("if (status === 'draft' && !silent && savedRecord?.status === 'sent') {");
  ok('handleSave refuses a draft save over a submitted report, before any write', sentAt > 0 && sentAt < firstWrite);
  const back = callbackBody(dfrCode, 'handleBack');
  ok('leaving a submitted report never offers "Save draft"', /if \(!isDirty \|\| existingReport\?\.status === 'sent'\) \{ goBack\(\); return; \}/.test(back));
  // Round-2 integration: the gate got the safe back, the editor behind it did
  // not — after Save/Submit, the chevron and the leave prompt a cold-started
  // /daily-report?reportId= (push, web refresh) had nothing to pop.
  {
    const inner = innerStart > 0 ? dfrCode.slice(innerStart) : '';
    ok('the editor exits through useSafeBack everywhere (save, submit, no-work day, send, chevron, leave prompt) — no bare router.back()',
      /const goBack = useSafeBack\(\);/.test(inner.slice(0, 3000)) && !/router\.back\(\)/.test(inner)
        && /if \(!silent\) goBack\(\);/.test(callbackBody(dfrCode, 'handleSave')));
  }

  // ── Loaded flags from ProjectContext ────────────────────────────────────────
  console.log('\nProjectContext exposes per-collection loaded flags');
  const CTX = read('contexts/ProjectContext.tsx');
  for (const [coll, q, setter, flag] of [
    ['changeOrders', 'changeOrdersQuery', 'setChangeOrders', 'setChangeOrdersLoadedFor'],
    ['dailyReports', 'dailyReportsQuery', 'setDailyReports', 'setDailyReportsLoadedFor'],
  ] as const) {
    const re = new RegExp(`useEffect\\(\\(\\) => \\{\\s*if \\(!${q}\\.data\\) return;\\s*${setter}\\(${q}\\.data\\);\\s*${flag}\\(userId \\?\\? ''\\);\\s*\\}, \\[${q}\\.data, userId\\]\\);`);
    ok(`${coll}: the flag is raised in the same effect that commits the rows, keyed by account`, re.test(CTX));
    // Integration round 1: EXECUTE the flag's own expression across the
    // cold-start null → account transition. While auth is still resolving,
    // userId is null and the signed-out cache pass has stamped '' — the old
    // expression (`xLoadedFor === (userId ?? '')`) called that loaded, so the
    // editor opened on the device copy and then closed under him.
    const exprM = CTX.match(new RegExp(`const ${coll}Loaded = ([^;]+);`));
    ok(`${coll}Loaded compares against the CURRENT account, and is false while auth resolves`, !!exprM && /!authLoading/.test(exprM[1]) && exprM[1].includes(`${coll}LoadedFor === (userId ?? '')`));
    if (exprM) {
      const flagOf = new Function('authLoading', `${coll}LoadedFor`, 'userId', `return ${exprM[1]};`) as (a: boolean, f: string | null, u: string | null) => boolean;
      ok(`${coll}: cold start — auth resolving, signed-out cache pass stamped '' → NOT loaded`, flagOf(true, '', null) === false);
      ok(`${coll}: auth resolved to account A, only the '' pass landed → NOT loaded`, flagOf(false, '', 'A') === false);
      ok(`${coll}: account A's own rows landed → loaded`, flagOf(false, 'A', 'A') === true);
      ok(`${coll}: genuinely signed out (auth done, no user) → the device copy counts as loaded`, flagOf(false, '', null) === true);
      ok(`${coll}: control — the old expression opened the editor during the cold-start window`, ((f: string | null, u: string | null) => f === (u ?? ''))('', null) === true);
    }
    ok(`${coll}Loaded is exposed and memo-tracked`, new RegExp(`${coll}, ${coll}Loaded, `).test(CTX) && new RegExp(`\\[${coll}, ${coll}Loaded, `).test(CTX));
  }

  // ── #43: the CO gate waits on the change-order query ───────────────────────
  console.log('\n#43 change-order gate waits on the query, and on the projects');
  const COSRC = read('app/change-order.tsx');
  const coCode = stripComments(COSRC);
  ok('the gate reads changeOrdersLoaded and feeds it to coGateState',
    /const \{ changeOrders, changeOrdersLoaded, projectsLoaded, retryRemoteReads \} = useProjects\(\);/.test(coCode)
    && /changeOrdersLoaded,\s*graceOver,\s*\}\);/.test(coCode));
  ok('…the grace clock only starts once the change orders have loaded',
    /if \(!coId \|\| target \|\| !projectsLoaded \|\| !changeOrdersLoaded \|\| graceOver\) return;/.test(coCode));
  ok('…and the editor needs its project loaded (CO\'s or the URL\'s)', /needsProject: !!target \|\| !!paramProjectId,/.test(coCode));

  // ── #2: Send & Save reports what happened ───────────────────────────────────
  console.log('\n#2 Send & Save says what actually happened');
  type Outcome = 'sent' | 'composer_opened' | 'cancelled' | 'failed';
  type W = 'synced' | 'queued' | 'failed' | 'local' | 'pending';
  const co = evalBlock<{
    coSaveBlocker: (o: { description: string; lineItemCount: number }) => { title: string; message: string } | null;
    coStatusForSend: (e: Outcome, s: string | undefined) => string;
    coSendReport: (o: { number: number; email: Outcome; emailError?: string; status: string; write: W; recipient: string }) => { title: string; message: string };
    coSendFinishedLabel: (e: Outcome, w: W) => string;
  }>('app/change-order.tsx', 'co-send-outcome', ['coSaveBlocker', 'coStatusForSend', 'coSendReport', 'coSendFinishedLabel']);
  if (co) {
    ok('an empty description or no lines is refused', !!co.coSaveBlocker({ description: '  ', lineItemCount: 2 }) && !!co.coSaveBlocker({ description: 'Add outlet', lineItemCount: 0 }) && co.coSaveBlocker({ description: 'Add outlet', lineItemCount: 1 }) === null);
    ok('only a real send submits', co.coStatusForSend('sent', 'draft') === 'submitted' && co.coStatusForSend('sent', undefined) === 'submitted');
    ok('a failed send or an unsent composer keeps a new/draft CO a draft', co.coStatusForSend('failed', undefined) === 'draft' && co.coStatusForSend('composer_opened', 'draft') === 'draft');
    ok('…and never downgrades an already-submitted CO', co.coStatusForSend('failed', 'submitted') === 'submitted' && co.coStatusForSend('composer_opened', 'under_review') === 'under_review');
    const writes: W[] = ['synced', 'queued', 'failed', 'local', 'pending'];
    for (const email of ['failed', 'composer_opened'] as Outcome[]) {
      for (const write of writes) {
        const r = co.coSendReport({ number: 7, email, emailError: 'Not sent. We opened a draft in your email app — review it and press Send there.', status: 'draft', write, recipient: 'Dana' });
        ok(`email ${email} / write ${write}: says NOT sent and never "emailed"`, /NOT sent/.test(r.message) && !/emailed/.test(r.message) && r.title === 'Email not sent', r.message);
        if (write === 'failed') ok(`email ${email} / write failed: does not claim MAGE saved it`, /could not save it/.test(r.message) && /on this device only/.test(r.message) && !/is saved/.test(r.message), r.message);
        // Integration round 1: 'failed' also covers a server error / outage and
        // a failed enqueue, so the message must not name a cause as fact, and
        // it is read AFTER the screen closed, so no "before you leave" advice
        // and no "save again" (a re-save of a never-inserted CO is a 0-row
        // update that reads as success).
        if (write === 'failed') ok(`email ${email} / write failed: names no cause it cannot know, no leave-screen or re-save advice`, !/refused|not lost to signal|before you leave|tap Save|save once more/i.test(r.message) && /will not sync/.test(r.message), r.message);
        if (email === 'composer_opened') ok(`composer opened / write ${write}: tells him to Mark submitted once he has sent it`, /tap Mark submitted/.test(r.message), r.message);
        if (email === 'failed') ok(`email failed / write ${write}: no Mark-submitted advice (nothing can have gone out)`, !/Mark submitted/.test(r.message), r.message);
        // Round-2 integration: 'queued' is also returned ONLINE (an update
        // queued behind an earlier offline create), so no "when you have signal".
        if (write === 'queued') ok(`email ${email} / write queued: says it will reach MAGE on the next sync, not a guessed cause`, /next sync/.test(r.message) && !/signal/.test(r.message), r.message);
        if (write === 'pending') ok(`email ${email} / write pending: says still reaching MAGE`, /still reaching MAGE/.test(r.message), r.message);
      }
    }
    const sentFailed = co.coSendReport({ number: 7, email: 'sent', status: 'submitted', write: 'failed', recipient: 'Dana' });
    ok('sent but the write failed: title and body say it is not saved', sentFailed.title === 'Sent — not saved to MAGE' && /could not save it/.test(sentFailed.message));
    const sentOk = co.coSendReport({ number: 7, email: 'sent', status: 'submitted', write: 'synced', recipient: 'Dana' });
    ok('sent and synced: "emailed to Dana … It is saved."', /emailed to Dana/.test(sentOk.message) && /It is saved\./.test(sentOk.message));
    // Integration round 3: the off-screen close label read "Sent — close" for
    // every outcome, including an email that never went out.
    ok('the off-screen close label says "Sent" only for a real send, and flags a failed save',
      co.coSendFinishedLabel('sent', 'synced') === 'Sent — close' && co.coSendFinishedLabel('sent', 'queued') === 'Sent — close'
        && co.coSendFinishedLabel('sent', 'failed') === 'Sent, not saved — close'
        && (['failed', 'composer_opened'] as Outcome[]).every(e => writes.every(w => !/^Sent/.test(co.coSendFinishedLabel(e, w)) && /Not sent/.test(co.coSendFinishedLabel(e, w)))));
    ok('no doubled full stop after a reason that ends in one', !/\.\./.test(co.coSendReport({ number: 7, email: 'composer_opened', emailError: 'Saved to your Drafts — it has not been sent yet.', status: 'draft', write: 'synced', recipient: '' }).message));
  }
  const send = callbackBody(coCode, 'handleConfirmSend');
  const blockAt = send.indexOf('coSaveBlocker(');
  const emailAt = send.indexOf('await sendEmail(');
  const persistAt = send.indexOf('persistCO(');
  ok('the form is validated BEFORE the email goes out', blockAt > 0 && emailAt > blockAt);
  ok('the CO is written after the send, with coStatusForSend', persistAt > emailAt && /const status = coStatusForSend\(result\.outcome, existingCO\?\.status\);/.test(send));
  const between = send.slice(emailAt, persistAt);
  const earlyReturns = [...between.matchAll(/\breturn;/g)].length;
  // Two exits, neither after anything went out: the composer he dismissed, and
  // a sendEmail that THREW (no result, nothing sent) — both say nothing saved.
  ok('the only early returns between the send and the write are the dismissed composer and a send that threw', earlyReturns === 2
    && /if \(result\.outcome === 'cancelled'\) \{[\s\S]{0,300}return;\s*\}/.test(between)
    && /catch \(e\) \{[\s\S]{0,300}nothing was saved[\s\S]{0,120}return;\s*\}/.test(between), `returns: ${earlyReturns}`);
  // Review round 1: the email await and the up-to-8 s write report left Save
  // to Project / Send & Save live over the form; a second tap wrote a second CO.
  const lockAt = send.indexOf('sendingRef.current = true;');
  ok('Send & Save takes the in-flight lock before the email goes out', lockAt > 0 && lockAt < emailAt && /if \(sendingRef\.current\) return;\s*sendingRef\.current = true;\s*setSendInFlight\(true\);/.test(send));
  ok('…releases it on every path that stays on the screen (cancelled, refused write, threw, no recipient)',
    /if \(result\.outcome === 'cancelled'\) \{\s*releaseSending\(\);/.test(send) && /if \(!saved\) \{ releaseSending\(\); return; \}/.test(send)
    && /catch \(e\) \{[\s\S]{0,120}releaseSending\(\);/.test(send) && /\} else \{\s*releaseSending\(\);\s*\}\s*$/.test(send));
  // Integration round 1: through useSafeBack — a cold-opened form (deep link,
  // web refresh of /change-order?coId=) has nothing to pop, and a bare
  // router.back() left Save and Send disabled as "Sending…" for good.
  ok('…and keeps it through the pop (nothing may write after the report), leaving through a safe back that works cold — and only while still on top (he may have left during the write wait)',
    !/releaseSending\(\);\s*showAlert\(report\.title/.test(send) && /showAlert\(report\.title, report\.message\);\s*(?:\/\/[^\n]*\s*)*if \(mountedRef\.current && navigation\.isFocused\(\)\) goBack\(\);/.test(send)
      && !/router\.back\(\)/.test(send) && /const goBack = useSafeBack\(\);/.test(coCode));
  // Round-2 integration: he left during the write wait, so the pop is skipped
  // and the form stays mounted under him — the lock stays (a new CO would
  // duplicate), but the bar must stop saying "Sending…".
  ok('a send that finished off-screen swaps the bar for a final close labelled by its OUTCOME (lock kept, no false "Sending…" or "Sent")',
    /if \(mountedRef\.current && navigation\.isFocused\(\)\) goBack\(\);\s*else if \(mountedRef\.current\) setSendFinished\(coSendFinishedLabel\(result\.outcome, write\)\);/.test(send)
      && /\{!isLocked && sendFinished && \([\s\S]{0,200}label=\{sendFinished\}\s*onPress=\{goBack\}/.test(coCode)
      && !/label="Sent — close"/.test(coCode)
      && /\{!isLocked && !sendFinished && \(/.test(coCode));
  ok('handleSave and the Send & Save button refuse while a send is in flight', /const handleSave = useCallback\([^)]*\) => \{\s*if \(sendingRef\.current\) return;/.test(coCode)
    && /const handleSendPress = useCallback\(\(\) => \{\s*if \(sendingRef\.current\) return;/.test(coCode));
  ok('…and the controls are disabled and say "Sending…"', /label="Save to Project"[\s\S]{0,160}disabled=\{sendInFlight\}/.test(coCode)
    && /label=\{sendInFlight \? 'Sending…' : 'Send & Save'\}[\s\S]{0,120}disabled=\{sendInFlight\}/.test(coCode)
    && /onPress=\{handleConfirmSend\} disabled=\{sendInFlight\}/.test(coCode));
  ok('the write outcome is awaited (with a timeout) before the report', /await Promise\.race<RecordWriteOutcome \| 'pending'>\(\[/.test(send) && /coSendReport\(\{/.test(send));
  ok('the old false claim is gone', !/Change order saved but email could not be sent/.test(COSRC));
  ok('handleSave no longer carries the write itself (persistCO does, with no navigation)',
    /const handleSave = useCallback\(\(status: 'draft' \| 'submitted', recipientName\?: string, recipientEmail\?: string\) => \{\s*if \(sendingRef\.current\) return;\s*const saved = persistCO\(/.test(coCode)
    && !/router\.back\(\)/.test(callbackBody(coCode, 'persistCO')));
  const addBody = CTX.slice(CTX.indexOf('const addChangeOrders = useCallback('), CTX.indexOf('const addChangeOrder = useCallback('));
  ok('addChangeOrders reports its write through supabaseWriteDetailed', /supabaseWriteDetailed\('change_orders', 'insert'/.test(addBody) && /return worstWriteOutcome\(outcomes\);/.test(addBody));
  const updBody = CTX.slice(CTX.indexOf('const updateChangeOrder = useCallback('), CTX.indexOf('const getChangeOrdersForProject = useCallback('));
  ok('updateChangeOrder returns its write outcome', /return supabaseWriteDetailed\('change_orders', 'update'/.test(updBody) && /if \(!canSync\) return 'local';/.test(updBody));
  const wStart = CTX.indexOf('export function worstWriteOutcome(');
  const worst = new Function(`${transpile(CTX.slice(wStart, CTX.indexOf('\n}\n', wStart) + 2).replace(/^export /, ''))}\nreturn worstWriteOutcome;`)() as (o: string[]) => string;
  ok('one failed insert makes the batch failed; queued beats synced', worst(['synced', 'failed', 'queued']) === 'failed' && worst(['synced', 'queued']) === 'queued' && worst(['synced']) === 'synced');

  // ── #30: contract load failure is not "no contract" ─────────────────────────
  console.log('\n#30 a failed contract read never seeds a second contract');
  const ENGINE = read('utils/contractEngine.ts');
  // Execute the real module with its imports replaced by a scripted Supabase.
  type Resp = { data: unknown; error: { message: string; code?: string } | null } | 'throw';
  const script: { reads: Resp[]; upserts: Resp[]; upsertCalls: number; readCalls: number } = { reads: [], upserts: [], upsertCalls: 0, readCalls: 0 };
  const settle = (r: Resp | undefined) => { if (r === 'throw') return Promise.reject(new TypeError('Network request failed')); return Promise.resolve(r ?? { data: null, error: null }); };
  const fakeSupabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: () => {
      let mode: 'read' | 'upsert' = 'read';
      const b: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'is', 'order', 'limit']) b[k] = () => b;
      b.upsert = () => { mode = 'upsert'; script.upsertCalls++; return b; };
      b.maybeSingle = () => mode === 'upsert' ? settle(script.upserts.shift()) : (script.readCalls++, settle(script.reads.shift()));
      return b;
    },
  };
  const engineJs = transpile(ENGINE
    .replace(/^export (type )?\{[\s\S]*?\} from '[^']+';$/gm, '')
    .replace(/^import[\s\S]*?from '[^']+';$/gm, '')
    .replace(/^export /gm, ''));
  const eng = new Function('supabase', 'isSupabaseConfigured', 'effectiveEstimateTotal', 'contractScheduleFromSplit', 'contractWarrantyText', 'suggestContractTimeline',
    `${engineJs}\nreturn { loadActiveContract, fetchActiveContract, saveContractDetailed, saveContract };`)(
    fakeSupabase, true, () => 0, () => [], () => '', () => ({})) as {
      loadActiveContract: (p: string) => Promise<{ ok: boolean; contract?: { id: string } | null; error?: string }>;
      fetchActiveContract: (p: string) => Promise<unknown>;
      saveContractDetailed: (c: Record<string, unknown>) => Promise<{ ok: boolean; reason?: string; existing?: { id: string }; contract?: { id: string } }>;
    };
  const row = (id: string, status = 'signed') => ({ id, project_id: 'p1', user_id: 'u1', version: 1, superseded_by: null, title: 'Construction Agreement', contract_value: 1000, scope_text: '', terms_text: '', warranty_text: '', payment_schedule: [], allowances: [], status, created_at: '', updated_at: '' });
  const reset = (reads: Resp[], upserts: Resp[] = []) => { script.reads = reads; script.upserts = upserts; script.upsertCalls = 0; script.readCalls = 0; };
  reset([{ data: null, error: { message: 'Failed to fetch' } }]);
  let l = await eng.loadActiveContract('p1');
  ok('a read error is { ok: false }, not "no contract"', l.ok === false && l.error === 'Failed to fetch');
  reset(['throw']);
  l = await eng.loadActiveContract('p1');
  ok('a thrown network error is { ok: false } too', l.ok === false);
  reset([{ data: null, error: null }]);
  l = await eng.loadActiveContract('p1');
  ok('only an answered read with no row means "no contract yet"', l.ok === true && l.contract === null);
  reset([{ data: null, error: { message: 'x' } }]);
  ok('fetchActiveContract (read-only callers) still collapses a failure to null', (await eng.fetchActiveContract('p1')) === null);
  const draft = { projectId: 'p1', version: 1, title: 'Construction Agreement', contractValue: 1000, scopeText: '', termsText: '', warrantyText: '', paymentSchedule: [], allowances: [], status: 'draft' };
  reset([{ data: row('live'), error: null }]);
  let sres = await eng.saveContractDetailed({ ...draft });
  ok('an id-less save on a job with a live contract is refused as a duplicate — nothing written', sres.ok === false && sres.reason === 'duplicate' && sres.existing?.id === 'live' && script.upsertCalls === 0);
  reset([{ data: null, error: { message: 'offline' } }]);
  sres = await eng.saveContractDetailed({ ...draft });
  ok('an id-less save whose live-contract check fails writes nothing', sres.ok === false && sres.reason === 'failed' && script.upsertCalls === 0);
  reset([{ data: row('old', 'void'), error: null }], [{ data: row('new', 'draft'), error: null }]);
  sres = await eng.saveContractDetailed({ ...draft });
  ok('a void contract may be replaced by a new one', sres.ok === true && sres.contract?.id === 'new');
  reset([{ data: null, error: null }], [{ data: row('new', 'draft'), error: null }]);
  sres = await eng.saveContractDetailed({ ...draft });
  ok('a first contract saves', sres.ok === true && script.upsertCalls === 1);
  reset([], [{ data: row('c1', 'draft'), error: null }]);
  sres = await eng.saveContractDetailed({ ...draft, id: 'c1' });
  ok('saving an existing contract (has an id) does not pre-check', sres.ok === true && script.readCalls === 0 && script.upsertCalls === 1);
  reset([{ data: null, error: null }, { data: row('winner'), error: null }], [{ data: null, error: { message: 'duplicate key', code: '23505' } }]);
  sres = await eng.saveContractDetailed({ ...draft });
  ok('the unique index refusing a raced insert comes back as a duplicate, with the winner', sres.ok === false && sres.reason === 'duplicate' && sres.existing?.id === 'winner');

  const CON = read('app/contract.tsx');
  const conCode = stripComments(CON);
  const loadStart = conCode.indexOf('useEffect(() => {', conCode.indexOf('const contractRef = useRef(contract);'));
  const loadEnd = conCode.indexOf('}, [project?.id, user?.id, loadSeq]);', loadStart);
  const loadBody = loadStart > 0 && loadEnd > loadStart ? conCode.slice(loadStart, loadEnd) : '';
  const failAt = loadBody.indexOf('if (!load.ok) {');
  ok('the load effect reads loadActiveContract and bails on a failed read BEFORE any draft is seeded',
    /const load = await loadActiveContract\(p\.id\);/.test(loadBody) && failAt > 0 && failAt < loadBody.indexOf('buildDraftContract(')
    && /setLoadFailed\(load\.error\);[\s\S]{0,60}return;/.test(loadBody.slice(failAt, failAt + 200)));
  const failRender = conCode.indexOf('if (!loading && loadFailed) {');
  ok('a failed read renders "Couldn\'t load this job\'s contract" with Retry, ahead of the editor',
    failRender > 0 && failRender < conCode.indexOf('if (loading || !contract) {') && /testID="contract-load-retry"/.test(conCode) && /setLoadSeq\(n => n \+ 1\)/.test(conCode));
  ok('the load-failed screen has a working exit (useSafeBack) beside Retry',
    /const goBack = useSafeBack\(\);/.test(conCode) && /testID="contract-load-retry"\s*\/>\s*<Button label="Go back" variant="secondary" onPress=\{goBack\}/.test(conCode));
  ok('no contract write in the screen bypasses the duplicate check', !/\bsaveContract\(/.test(conCode) && (conCode.match(/saveContractDetailed\(/g) ?? []).length === 2);
  // The focus re-check is REPLAYED, not pattern-matched: review round 1 found
  // its deps keyed on the `contract` object, so each read's setContract re-ran
  // the effect — an endless read loop on a signed contract, a read per
  // keystroke on a draft. The real block runs under useFocusEffect's semantics
  // (expo-router re-runs the callback on every dep change while focused).
  const focusAt = CON.indexOf('useFocusEffect(', CON.indexOf('const contractRef = useRef(contract);'));
  let blockStart = focusAt;
  const primAt = CON.lastIndexOf('const focusContractId', focusAt);
  if (primAt > 0 && focusAt - primAt < 400) blockStart = primAt;
  const blockEnd = focusAt > 0 ? CON.indexOf('\n  );', focusAt) : -1;
  const focusBlock = focusAt > 0 && blockEnd > focusAt && CON.slice(focusAt, blockEnd).includes('loadActiveContract(') ? CON.slice(blockStart, blockEnd + 5) : '';
  ok('the contract focus re-check block is found', focusBlock.length > 0);
  type Row = { id: string; projectId: string; status: string; body: string; updatedAt: string };
  async function replayFocus(start: Row, reply: () => Row | null, typing = 0) {
    const run = new Function('ctx', `const { useFocusEffect, useCallback, contract, project, contractRef, loadActiveContract, setContract, setTermsSource, showAlert } = ctx;\n${transpile(focusBlock)}`);
    let state: Row = start;
    let prevDeps: unknown[] | null = null;
    // In a holder so TS does not narrow it across the closure assignments.
    const eff: { cleanup?: () => void } = {};
    let reads = 0; let sets = 0; let dirty = true;
    const project = { id: 'p1' };
    const contractRef = { current: state as Row | null };
    const render = () => {
      dirty = false;
      contractRef.current = state;
      let deps: unknown[] = [];
      run({
        contract: state, project, contractRef,
        useCallback: (f: () => unknown, d: unknown[]) => { deps = d; return f; },
        useFocusEffect: (cb: () => (() => void) | void) => {
          if (!prevDeps || deps.length !== prevDeps.length || deps.some((v, i) => !Object.is(v, prevDeps![i]))) {
            if (eff.cleanup) eff.cleanup();
            prevDeps = deps;
            eff.cleanup = cb() ?? undefined;
          }
        },
        loadActiveContract: async () => { reads++; await new Promise(r => setTimeout(r, 1)); const c = reply(); return { ok: true, contract: c ? { ...c } : null }; },
        setContract: (c: Row) => { sets++; state = c; dirty = true; },
        setTermsSource: () => {}, showAlert: () => {},
      });
    };
    render();
    for (let k = 0; k < typing; k++) { state = { ...state, body: state.body + 'x' }; render(); }
    for (let i = 0; i < 60; i++) { await new Promise(r => setTimeout(r, 2)); if (dirty) render(); }
    if (eff.cleanup) eff.cleanup();
    return { reads, sets, state };
  }
  if (focusBlock) {
    const signed: Row = { id: 'c1', projectId: 'p1', status: 'signed', body: 'scope', updatedAt: 't1' };
    const r1 = await replayFocus(signed, () => signed);
    ok('a signed contract is read ONCE on focus (no read loop)', r1.reads === 1, `reads ${r1.reads}`);
    ok('…and an unchanged row does not re-render the screen', r1.sets === 0, `sets ${r1.sets}`);
    const flipped: Row = { ...signed, body: 'scope + milestone invoiced' };
    const r2 = await replayFocus(signed, () => flipped);
    ok('a changed row (milestone flipped, same updatedAt) is adopted once', r2.reads === 1 && r2.sets === 1 && r2.state.body === flipped.body, `reads ${r2.reads} sets ${r2.sets}`);
    const draft: Row = { id: '', projectId: 'p1', status: 'draft', body: '', updatedAt: '' };
    const r3 = await replayFocus(draft, () => null, 25);
    ok('typing 25 characters into an unsaved draft costs ONE read, not one per keystroke', r3.reads === 1, `reads ${r3.reads}`);
    const r4 = await replayFocus(draft, () => signed);
    // Adopting the live row changes id/status once (one follow-up read of the
    // now-signed contract), then it settles — bounded, not a loop.
    ok('an unsaved draft is replaced by the job\'s live contract when one turns up, then settles', r4.reads === 2 && r4.sets === 1 && r4.state.id === 'c1', `reads ${r4.reads} sets ${r4.sets}`);
  }
  const MIG = 'supabase/migrations/20260918200000_project_contracts_one_live_per_project.sql';
  ok('the partial unique index backs it (one live contract per job)', existsSync(join(ROOT, MIG))
    && /create unique index if not exists project_contracts_one_live_per_project\s+on public\.project_contracts \(project_id\)\s+where superseded_by is null and status <> 'void';/.test(read(MIG)));

  console.log('\n#9 (integration) the website-lead alert never opens a blank, saveable lead');
  const leadGate = evalBlock<{ leadOpenState: (o: { leadId: string | null; found: boolean; leadsLoaded: boolean; refreshSettled: boolean }) => string }>(
    'app/lead-detail.tsx', 'lead-open-gate', ['leadOpenState']);
  if (leadGate) {
    const st = (o: Partial<{ leadId: string | null; found: boolean; leadsLoaded: boolean; refreshSettled: boolean }>) =>
      leadGate.leadOpenState({ leadId: 'L1', found: false, leadsLoaded: true, refreshSettled: false, ...o });
    ok('a new lead (no id) opens the form', st({ leadId: null, leadsLoaded: false }) === 'editor');
    ok('a lead the list does not hold yet waits for the fresh read (no blank form)', st({}) === 'loading');
    ok('a cached hit before this account\'s list lands still waits', st({ found: true, leadsLoaded: false }) === 'loading');
    ok('the loaded lead opens the form', st({ found: true }) === 'editor');
    ok('still absent after the fresh read → "Lead not found", never a form', st({ refreshSettled: true }) === 'missing');
    ok('arriving after the fresh read → the form', st({ found: true, refreshSettled: true }) === 'editor');
  }
  const LEAD = read('app/lead-detail.tsx');
  const LEAD_CODE = stripComments(LEAD);
  const leadGateBody = LEAD_CODE.slice(LEAD_CODE.indexOf('export default function LeadDetailScreen'), LEAD_CODE.indexOf('function LeadDetailEditor'));
  ok('the default export is the gate: leadsLoaded + a fresh read + keyed editor', /leadsLoaded/.test(leadGateBody) && /refreshLeads\(\)/.test(leadGateBody)
    && /leadOpenState\(/.test(leadGateBody) && /<LeadDetailEditor key=\{found\?\.id \?\? 'new'\} \/>/.test(leadGateBody));
  ok('the gate states "Lead not found" with Try again and Go back', /Lead not found/.test(leadGateBody) && /lead-open-retry/.test(leadGateBody) && /lead-open-back/.test(leadGateBody));
  ok('Save refuses when the named lead has gone (no silent no-op)', /if \(!isNew && !existing\) \{\s*showAlert\('Not saved'/.test(callbackBody(LEAD_CODE, 'saveAndExit')));
  const PC = stripComments(read('contexts/ProjectContext.tsx'));
  ok('ProjectContext: leadsLoaded is keyed by account, and false while auth resolves', /setLeadsLoadedFor\(userId \?\? ''\)/.test(PC) && /const leadsLoaded = !authLoading && leadsLoadedFor === \(userId \?\? ''\);/.test(PC));
  ok('ProjectContext: refreshLeads refetches THIS account\'s leads', /const refreshLeads = useCallback\(async \(\) => \{\s*await queryClient\.refetchQueries\(\{ queryKey: \['leads', userId\] \}\);/.test(PC));
  const NCTX = stripComments(read('contexts/NotificationContext.tsx'));
  // Wave 4 #82: the tap re-reads through the shared utils/notificationTapRefresh
  // table (refreshThenOpen, before the route opens); lead_received → ['leads'].
  ok('tapping a lead_received push invalidates the lead list',
    /void refreshThenOpen\(kind, data as Record<string, unknown>, refreshDeps, \(\) => \{\s*router\.push\(routeHref\(route\) as Href\);/.test(NCTX)
    && JSON.stringify(notificationRefreshPlan('lead_received', {}).queryKeys) === '[["leads"]]');

  // ── Integration round 1: a CO edit never overtakes its own queued create ──
  console.log('\nupdateChangeOrder queues behind a queued insert of the same CO');
  const iw = evalBlockWhole<{ insertStillQueued: (q: { table: string; operation: string; data?: Record<string, unknown> }[], t: string, id: string) => boolean }>(
    'utils/invoiceWrites.ts', ['insertStillQueued']);
  if (iw) {
    const q = [{ table: 'change_orders', operation: 'insert', data: { id: 'co1' } }, { table: 'invoices', operation: 'insert', data: { id: 'co2' } }];
    ok('a queued change_orders insert of this id is found', iw.insertStillQueued(q, 'change_orders', 'co1'));
    ok('another table\'s insert with the same id is not', !iw.insertStillQueued(q, 'change_orders', 'co2'));
    ok('an update entry is not a create', !iw.insertStillQueued([{ table: 'change_orders', operation: 'update', data: { id: 'co1' } }], 'change_orders', 'co1'));
  }
  const ucoBody = callbackBody(PC, 'updateChangeOrder');
  const qCheck = ucoBody.indexOf("insertStillQueued(await getOfflineQueue(), 'change_orders', id)");
  // Integration round 2 (data-sync): the write carries this edit's audit ids
  // (`rides`) so a Discard drops exactly them — same calls, one more argument.
  const qAdd = ucoBody.indexOf("addToOfflineQueue({ table: 'change_orders', operation: 'update', data: coPayload, ...(rides.length > 0 ? { rides } : {}) })");
  const direct = ucoBody.indexOf("supabaseWriteDetailed('change_orders', 'update', coPayload, rides.length > 0 ? { rides } : undefined)");
  ok('updateChangeOrder checks the queue for its own create before the direct UPDATE', qCheck > 0 && direct > qCheck, `${qCheck} / ${direct}`);
  ok('…queues the update behind it and reports queued, never synced', qAdd > qCheck && qAdd < direct && /return 'queued';/.test(ucoBody.slice(qAdd, direct)));
  ok('…and an unreadable queue counts as holding the create', /catch \{ createQueued = true; \}/.test(ucoBody));

  // ── Integration round 2: …nor its own create still ON THE WIRE ──
  // The mic drafts a CO and opens it ~250 ms later; Send & Save on a weak link
  // could send the UPDATE while the INSERT was still in flight — a 0-row
  // "success". Executed: updateChangeOrder's write tail, run against a stub
  // insert we resolve by hand.
  console.log('\nupdateChangeOrder waits for an in-flight insert of the same CO');
  const addCoBody = callbackBody(PC, 'addChangeOrders');
  ok('addChangeOrders holds each insert by id until it reports',
    /changeOrderInsertsRef\.current\.set\(finalCo\.id, insert\)/.test(addCoBody) && /changeOrderInsertsRef\.current\.delete\(finalCo\.id\)/.test(addCoBody));
  ok('the account reset drops them with the other mirror refs', /changeOrderInsertsRef\.current = new Map\(\);/.test(PC));
  const tailEnd = "return supabaseWriteDetailed('change_orders', 'update', coPayload, rides.length > 0 ? { rides } : undefined);";
  const tailFrom = (body: string, start: string) => {
    const a = body.indexOf(start); const b = body.indexOf(tailEnd);
    return a < 0 || b < 0 ? '' : body.slice(a, b + tailEnd.length);
  };
  type WOutcome = 'synced' | 'queued' | 'failed';
  // `ledgerHolds`: the insert was refused and its payload is under Not saved.
  // The stub then answers as the REAL supabaseWriteDetailed does since data-sync
  // round 1 (offlineQueue's ledger-first guard, executed in
  // __tests__/sync/offline-queue.test.ts): parked behind it — 'failed', nothing
  // sent.
  const runTail = async (tail: string, insert: Promise<WOutcome> | undefined, queueAfter: () => { table: string; operation: string; data?: Record<string, unknown> }[], ledgerHolds = false) => {
    const log: string[] = [];
    const fn = new Function('id', 'changeOrderInsertsRef', 'insertStillQueued', 'getOfflineQueue', 'addToOfflineQueue', 'supabaseWriteDetailed', 'coPayload', 'rides',
      `${transpile(`const __t = async () => { ${tail} };`)}\nreturn __t();`);
    const refs = { current: new Map<string, Promise<WOutcome>>(insert ? [['co1', insert]] : []) };
    const out = await fn('co1', refs, iw!.insertStillQueued, async () => queueAfter(),
      async (e: { operation: string }) => { log.push(`queue:${e.operation}`); },
      async (_t: string, op: string) => {
        if (ledgerHolds) { log.push(`parked:${op}`); return 'failed'; }
        log.push(`direct:${op}`); return 'synced';
      },
      { id: 'co1' }, []) as WOutcome;
    return { out, log };
  };
  const deferred = () => { let resolve!: (o: WOutcome) => void; const p = new Promise<WOutcome>(r => { resolve = r; }); return { p, resolve }; };
  const newTail = tailFrom(ucoBody, 'const pendingInsert = changeOrderInsertsRef.current.get(id);');
  const oldTail = tailFrom(ucoBody, 'let createQueued = false;');
  ok('the tail is found', newTail.length > 0 && oldTail.length > 0);
  if (iw && newTail && oldTail) {
    // CONTROL — the round-1 code: the insert is on the wire (not queued yet).
    {
      const d = deferred(); let queue: { table: string; operation: string; data?: Record<string, unknown> }[] = [];
      const run = runTail(oldTail, d.p, () => queue);
      await new Promise(r => setTimeout(r, 5));
      queue = [{ table: 'change_orders', operation: 'insert', data: { id: 'co1' } }]; d.resolve('queued');
      const { out, log } = await run;
      ok('control: the round-1 tail sends the UPDATE while the insert is still in flight (the 0-row "It is saved.")', out === 'synced' && log.join() === 'direct:update', `${out} ${log.join()}`);
    }
    // Insert in flight, then it fails over to the queue → the update queues behind it.
    {
      const d = deferred(); let queue: { table: string; operation: string; data?: Record<string, unknown> }[] = [];
      let settled = false;
      const run = runTail(newTail, d.p, () => queue).then(r => { settled = true; return r; });
      await new Promise(r => setTimeout(r, 5));
      ok('…the fixed tail writes nothing while the insert is on the wire', !settled);
      queue = [{ table: 'change_orders', operation: 'insert', data: { id: 'co1' } }]; d.resolve('queued');
      const { out, log } = await run;
      ok('…insert queued → the update queues behind it and reports queued', out === 'queued' && log.join() === 'queue:update', `${out} ${log.join()}`);
    }
    // Insert in flight, then lands → the direct UPDATE goes after it.
    {
      const d = deferred();
      const run = runTail(newTail, d.p, () => []);
      await new Promise(r => setTimeout(r, 5));
      d.resolve('synced');
      const { out, log } = await run;
      ok('…insert landed → the direct UPDATE follows it', out === 'synced' && log.join() === 'direct:update', `${out} ${log.join()}`);
    }
    // Insert refused / could not be queued → the row does not exist. Data-sync
    // round 1: the edit is no longer dropped with a bare 'failed' (Retry then
    // landed the pre-edit draft) — it goes to the write path, which parks it
    // behind the refused insert under Not saved. Still 'failed', still never
    // SENT (never a 0-row "saved").
    {
      const d = deferred();
      const run = runTail(newTail, d.p, () => [], true);
      d.resolve('failed');
      const { out, log } = await run;
      ok('…insert failed → the update is parked behind it (reports failed, sends nothing — never a 0-row "saved")', out === 'failed' && log.join() === 'parked:update', `${out} ${log.join()}`);
    }
    // No insert of this CO on this device → unchanged direct path.
    {
      const { out, log } = await runTail(newTail, undefined, () => []);
      ok('…no insert pending → the direct UPDATE as before', out === 'synced' && log.join() === 'direct:update', `${out} ${log.join()}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
