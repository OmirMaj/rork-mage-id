// validate-w5-join-core-delete.ts — wave 5, lane w5-join-core.
//
//   #61 / CONTRACT 22  Deleting a job cascaded its injury and near-miss
//        records off the OSHA 300 log (kept 5 years). deleteProject(id, opts)
//        now refuses — BEFORE anything on the phone changes — when the job
//        has incidents ('<Job> has N injury/near-miss records…', action
//        'mark_closed'), and when it cannot check ('Can’t check this job’s
//        safety records offline…'). The shipped callback is RUN here against
//        stubs, so "before any local change" is observed, not read.
//   #44  Sign-out releases this phone's push token while the session still
//        lives — directly (not queued), bounded, never blocking sign-out.
//   #150 / CONTRACT 24  useProjects().refreshAll() is the foreground re-read.
//   #85  a field ticket UPDATE never carries user_id.
//   #138 clearing a permit's expiry still reaches the server as NULL.
//   #3/#4 (settings) reloadLocalMirrors empties the in-memory plan lists
//        after "Reset this device" and re-reads them.
//
// Run via: bun run scripts/validate-w5-join-core-delete.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deleteProjectRefusal, deleteProjectSafetyRefusal, localSafetyIncidentCount,
  DELETE_NOT_OWNER_REASON, SAFETY_CHECK_OFFLINE_REASON, DELETE_SAFETY_ACTION,
} from '../utils/projectContextPure';
import { runCallback } from './validate-context-money-portal-writes';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passes = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

const PC = read('contexts/ProjectContext.tsx');
type DeleteResult = { ok: boolean; reason?: string; action?: string };

async function main() {
  console.log('\n#61 the safety rule (pure)');
  ok('no records → no refusal', deleteProjectSafetyRefusal('Henderson', 0) === null && deleteProjectSafetyRefusal('Henderson', undefined) === null);
  ok('one record → the singular sentence',
    deleteProjectSafetyRefusal('Henderson', 1) === 'Henderson has 1 injury/near-miss record on your OSHA 300 log, which must be kept for 5 years. Mark the project Closed instead.');
  ok('three → plural', /has 3 injury\/near-miss records on your OSHA 300 log/.test(deleteProjectSafetyRefusal('Henderson', 3) ?? ''));
  ok('deleteProjectRefusal: the owner rule first, then the safety rule',
    deleteProjectRefusal({ ownerUserId: 'gc', name: 'H' }, 'u1', { incidentCount: 2 }) === DELETE_NOT_OWNER_REASON
      && /OSHA 300/.test(deleteProjectRefusal({ ownerUserId: 'u1', name: 'H' }, 'u1', { incidentCount: 2 }) ?? '')
      && deleteProjectRefusal({ ownerUserId: 'u1', name: 'H' }, 'u1') === null);
  ok('the offline sentence', SAFETY_CHECK_OFFLINE_REASON === 'Can’t check this project’s safety records offline. Try again with signal.');
  ok('the device count: cached incidents + queued incident inserts, each id once',
    localSafetyIncidentCount('p1',
      [{ id: 'i1', projectId: 'p1' }, { id: 'i2', projectId: 'p2' }],
      [
        { table: 'safety_incidents', operation: 'insert', data: { id: 'i1', project_id: 'p1' } },
        { table: 'safety_incidents', operation: 'insert', data: { id: 'i3', project_id: 'p1' } },
        { table: 'safety_incidents', operation: 'delete', data: { id: 'i4' } },
        { table: 'jhas', operation: 'insert', data: { id: 'j1', project_id: 'p1' } },
      ]) === 2);

  console.log('\n#61 deleteProject, RUN against stubs — every refusal comes before any local change');
  const job = { id: 'p1', name: 'Henderson', ownerUserId: 'u1' };
  const harness = (extra: Record<string, unknown>) => {
    const calls: string[] = [];
    const scope = {
      projects: [job], userId: 'u1', deleteProjectRefusal, deleteProjectSafetyRefusal, SAFETY_CHECK_OFFLINE_REASON, DELETE_SAFETY_ACTION,
      projectsRef: { current: [job] },
      setProjects: () => { calls.push('setProjects'); },
      saveProjectsMutation: { mutate: () => { calls.push('save'); } },
      forgetProjectsLocally: () => { calls.push('forget'); },
      forgetProjectsLocallyRef: { current: () => { calls.push('forget'); } },
      syncProjectToSupabase: (_p: unknown, action: string) => { calls.push(`sync:${action}`); },
      safetyIncidentCountForDelete: async () => { calls.push('count'); return 0; },
      ...extra,
    };
    const del = runCallback<(id: string, opts?: { safetyIncidentCount?: number }) => Promise<DeleteResult>>(PC, 'deleteProject', scope, calls);
    return { del, calls };
  };
  {
    const { del, calls } = harness({});
    const res = await del('p1', { safetyIncidentCount: 2 });
    ok('a passed count > 0 → refused with the OSHA sentence and action mark_closed, nothing touched, the server never asked',
      res.ok === false && /2 injury\/near-miss records/.test(res.reason ?? '') && res.action === 'mark_closed' && calls.length === 0, calls.join());
  }
  {
    const { del, calls } = harness({ safetyIncidentCountForDelete: async () => { calls.push('count'); return null; } });
    const res = await del('p1');
    ok('no count and the server cannot be asked → refused offline, nothing touched',
      res.ok === false && res.reason === SAFETY_CHECK_OFFLINE_REASON && !res.action && calls.join() === 'count', calls.join());
  }
  {
    const { del, calls } = harness({ safetyIncidentCountForDelete: async () => { calls.push('count'); return 1; } });
    const res = await del('p1');
    ok('no count, the check finds one → refused, nothing touched', res.ok === false && res.action === 'mark_closed' && calls.join() === 'count', calls.join());
  }
  {
    const { del, calls } = harness({});
    const res = await del('p1');
    ok('no count, the check finds none → deleted: row, cascade, server delete', res.ok === true && calls.join() === 'count,setProjects,save,forget,sync:delete', calls.join());
  }
  {
    const { del, calls } = harness({});
    const res = await del('p1', { safetyIncidentCount: 0 });
    ok('a passed count of 0 → deleted without asking anyone', res.ok === true && !calls.includes('count') && calls.includes('sync:delete'), calls.join());
  }
  {
    const { del, calls } = harness({ projects: [{ ...job, ownerUserId: 'gc', myRole: 'editor' }] });
    const res = await del('p1', { safetyIncidentCount: 5 });
    ok('a job he does not own → the owner refusal, first', res.ok === false && res.reason === DELETE_NOT_OWNER_REASON && calls.length === 0, calls.join());
  }
  ok('the type answers { ok: false, reason, action? }', /deleteProject: \(id: string, opts\?: \{ safetyIncidentCount\?: number \}\) => Promise<DeleteProjectResult>;/.test(PC));
  const counter = PC.slice(PC.indexOf('const safetyIncidentCountForDelete = async'), PC.indexOf('const deleteProject = useCallback('));
  ok('the no-count check: device incidents + queue first, then a head count on safety_incidents for a server-known job, bounded',
    /localSafetyIncidentCount\(projectId, cached, queue\)/.test(counter)
      && /from\('safety_incidents'\)\.select\('id', \{ count: 'exact', head: true \}\)\.eq\('project_id', projectId\)/.test(counter)
      && /if \(!serverProjectIdsRef\.current\.has\(projectId\)\) return 0;/.test(counter)
      && /setTimeout\(\(\) => resolve\(null\), 8000\)/.test(counter));

  console.log('\n#44 sign-out releases the push token while the session lives');
  {
    const auth = read('contexts/AuthContext.tsx');
    const logout = auth.slice(auth.indexOf('const logout = useCallback('), auth.indexOf('const deleteAccount = useCallback('));
    // Fast sign-out (utils/signOutTiming): the flush and the token release run
    // side by side inside ONE awaited Promise.all, and that await closes before
    // the session is touched. Comments are stripped first, so prose that names
    // these calls cannot satisfy (or break) the order.
    const code = logout.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const both = /await Promise\.all\(\[\s*flushQueuesBeforeSignOut\(\),\s*plan\.releasePushToken \? releasePushTokenBeforeSignOut\(\) : Promise\.resolve\(\),\s*\]\);/.exec(code);
    const bothEnd = both ? both.index + both[0].length : -1;
    const signOut = code.indexOf('await supabase.auth.signOut()');
    const anySignOut = code.indexOf('supabase.auth.signOut(');
    const localSignOut = code.indexOf("await supabase.auth.signOut({ scope: 'local' })");
    const wipe = code.indexOf('await wipeLocalUserCache();');
    ok('order: flush and token release (together, both awaited) → sign out → wipe',
      !!both && bothEnd > 0 && bothEnd < signOut && signOut < wipe);
    ok('nothing signs the session out before the flush and the release have settled',
      !!both && anySignOut > bothEnd && anySignOut === signOut + 'await '.length);
    ok('the flush and the release are each called exactly once in logout',
      (code.match(/flushQueuesBeforeSignOut\(/g) ?? []).length === 1 && (code.match(/releasePushTokenBeforeSignOut\(/g) ?? []).length === 1);
    ok('a failed (or skipped) global sign-out falls back to the local one, before the wipe',
      /if \(error\) \{[\s\S]*?await supabase\.auth\.signOut\(\{ scope: 'local' \}\);/.test(code) && localSignOut > signOut && localSignOut < wipe);
    ok('the wipe always runs: not inside the error branch, not conditional',
      /\n      await wipeLocalUserCache\(\);\n/.test(code) && (code.match(/wipeLocalUserCache\(/g) ?? []).length === 1);
    ok('offline starts nothing that only waits on the network: no token release, no global sign-out',
      /const plan = planSignOut\(\{ offline: isOfflineNow\(\) \}\);/.test(code)
        && /const \{ error \} = plan\.tryGlobal \? await supabase\.auth\.signOut\(\) : \{ error: new Error\(/.test(code)
        && /if \(!plan\.tryGlobal && typeof markLogoutUnreachable === 'function'\) markLogoutUnreachable\(\);/.test(code));
    ok('a second tap joins the sign-out already running',
      /if \(logoutInFlight\.current\) return logoutInFlight\.current;/.test(code)
        && code.indexOf('if (logoutInFlight.current) return logoutInFlight.current;') < code.indexOf('setSigningOut(true);'));
    ok('the button says what it is waiting for: saving while work is queued, then signing out',
      /setSignOutPhase\(signOutPhaseAtStart\(pendingCount\)\);/.test(code)
        && code.indexOf('setSignOutPhase(signOutPhaseAtStart(pendingCount));') < (both ? both.index : -1)
        && code.indexOf("setSignOutPhase('signing-out');") > bothEnd && code.indexOf("setSignOutPhase('signing-out');") < signOut
        && /setSigningOut\(false\);\s*setSignOutPhase\(null\);/.test(code));
    const fn = auth.slice(auth.indexOf('async function releasePushTokenBeforeSignOut('), auth.indexOf('async function wipeLocalUserCache('));
    ok('a DIRECT update of the three push columns on his own profile (not through the queue)',
      /supabase\.from\('profiles'\)\s*\.update\(\{ push_token: null, push_token_platform: null, push_token_updated_at: null \}\)\s*\.eq\('id', uid\)/.test(fn)
        && !/supabaseWrite/.test(fn));
    // Fix round 1: only THIS device's token. profiles holds one push_token;
    // an unconditional clear from the web app or a second phone silenced the
    // phone that really holds it.
    ok('only THIS device\'s token is released: filtered on push_token = the device token',
      /\.eq\('id', uid\)\s*\.eq\('push_token', thisToken\)/.test(fn)
        && /const thisToken = await registerForPushNotifications\(\{ prompt: false \}\);\s*if \(!thisToken\) return;/.test(fn));
    ok('web (no push token) releases nothing', /if \(Platform\.OS === 'web'\) return;/.test(fn.slice(0, fn.indexOf('getSession'))));
    ok('the token read sits inside the 3 s bound (never prompts)',
      fn.indexOf('registerForPushNotifications') > fn.indexOf('const release = async') && /Promise\.race\(\[\s*release\(\),/.test(fn));
    ok('bounded and never throws (a failure never blocks sign-out)', /Promise\.race\(/.test(fn) && /PUSH_RELEASE_TIMEOUT_MS = 3000/.test(auth) && /catch \(err\)/.test(fn));
  }

  console.log('\nfast sign-out: the timing rules (utils/signOutTiming), executed');
  {
    const T = await import('../utils/signOutTiming');
    ok('one /logout request may take 4 s, no more', T.SIGN_OUT_NETWORK_CEILING_MS === 4000);
    ok('online: release the token and try the global sign-out',
      T.planSignOut({ offline: false }).releasePushToken === true && T.planSignOut({ offline: false }).tryGlobal === true);
    ok('offline: neither is started',
      T.planSignOut({ offline: true }).releasePushToken === false && T.planSignOut({ offline: true }).tryGlobal === false);
    ok('the scope of a /logout URL: none = global, local, others',
      T.logoutScopeOf('https://x.supabase.co/auth/v1/logout') === 'global'
        && T.logoutScopeOf('https://x.supabase.co/auth/v1/logout?scope=global') === 'global'
        && T.logoutScopeOf('https://x.supabase.co/auth/v1/logout?scope=local') === 'local'
        && T.logoutScopeOf('https://x.supabase.co/auth/v1/logout?scope=others') === 'others');
    ok('only GoTrue\'s /logout is a logout URL (not the token refresh, not a table named logout)',
      T.isLogoutUrl('https://x.supabase.co/auth/v1/logout?scope=local') && T.isLogoutUrl('https://x.supabase.co/auth/v1/logout')
        && !T.isLogoutUrl('https://x.supabase.co/auth/v1/token?grant_type=refresh_token')
        && !T.isLogoutUrl('https://x.supabase.co/rest/v1/logout?select=*')
        && !T.isLogoutUrl('https://x.supabase.co/auth/v1/logout-everywhere'));
    ok('a GLOBAL sign-out is always sent, whatever was unreachable a moment ago',
      T.logoutRequestPlan({ scope: 'global', msSinceUnreachable: 0 }) === 'send'
        && T.logoutRequestPlan({ scope: 'global', msSinceUnreachable: null }) === 'send'
        && T.logoutRequestPlan({ scope: 'others', msSinceUnreachable: 10 }) === 'send');
    ok('a LOCAL sign-out is sent when nothing says the server is out of reach',
      T.logoutRequestPlan({ scope: 'local', msSinceUnreachable: null }) === 'send'
        && T.logoutRequestPlan({ scope: 'local', msSinceUnreachable: T.LOGOUT_UNREACHABLE_MEMORY_MS }) === 'send'
        && T.logoutRequestPlan({ scope: 'local', msSinceUnreachable: -5 }) === 'send');
    ok('a LOCAL sign-out right after an unanswered /logout does not wait on the network again',
      T.logoutRequestPlan({ scope: 'local', msSinceUnreachable: 0 }) === 'answer-locally'
        && T.logoutRequestPlan({ scope: 'local', msSinceUnreachable: T.LOGOUT_UNREACHABLE_MEMORY_MS - 1 }) === 'answer-locally');
    ok('no reply: a local sign-out is answered here (the session dies); a global one reports the failure',
      T.logoutFailurePlan('local') === 'answer-locally' && T.logoutFailurePlan('global') === 'rethrow' && T.logoutFailurePlan('others') === 'rethrow');
    ok('a reply: a local sign-out the server answers with an error is still answered here; a global reply is passed on as it came',
      T.logoutReplyPlan({ scope: 'local', ok: false }) === 'answer-locally' && T.logoutReplyPlan({ scope: 'local', ok: true }) === 'pass'
        && T.logoutReplyPlan({ scope: 'global', ok: false }) === 'pass' && T.logoutReplyPlan({ scope: 'others', ok: false }) === 'pass');
    ok('the busy caption: saving only while work is queued',
      T.signOutPhaseAtStart(0) === 'signing-out' && T.signOutPhaseAtStart(1) === 'saving' && T.signOutPhaseAtStart(40) === 'saving'
        && T.signOutBusyLabel('saving') === 'Saving changes…' && T.signOutBusyLabel('signing-out') === 'Signing out…'
        && T.signOutBusyLabel(null) === 'Signing out…' && T.signOutBusyLabel(undefined) === 'Signing out…');

    const lib = read('lib/supabase.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const bounded = lib.slice(lib.indexOf('async function boundedLogoutFetch('), lib.indexOf('export const sessionGuardedFetch'));
    ok('lib/supabase: every /logout goes through the bounded fetch, before any other request handling',
      /const requestUrl = urlOf\(input\);\s*if \(isLogoutUrl\(requestUrl\)\) return boundedLogoutFetch\(input, init, requestUrl\);\s*const response = await fetch\(input, init\);/.test(lib));
    ok('lib/supabase: the request is aborted at the ceiling, and the timer is always cleared',
      /setTimeout\(\(\) => controller\.abort\(\), SIGN_OUT_NETWORK_CEILING_MS\)/.test(bounded)
        && /signal: controller\.signal/.test(bounded) && /finally \{\s*if \(timer\) clearTimeout\(timer\);/.test(bounded));
    ok('lib/supabase: no reply → remembered, a local sign-out answered here, anything else rethrown',
      /catch \(err\) \{\s*markLogoutUnreachable\(\);\s*if \(logoutFailurePlan\(scope\) === 'answer-locally'\) return localLogoutAnswer\(\);\s*throw err;/.test(bounded));
    ok('lib/supabase: a reply is weighed by the same rule before it is returned',
      /const response = await fetch\(input, controller \? \{ \.\.\.init, signal: controller\.signal \} : init\);\s*return logoutReplyPlan\(\{ scope, ok: response\.ok \}\) === 'answer-locally' \? localLogoutAnswer\(\) : response;/.test(bounded));
    ok('lib/supabase: the local answer is the one auth-js reads as "remove the session" (403 session_not_found)',
      /error_code: 'session_not_found'/.test(lib) && /new Response\(body, \{ status: 403/.test(lib));
    const settings = read('app/(tabs)/settings/index.tsx');
    ok('Settings: the busy caption and its accessibility label come from the phase',
      /testID="logout-busy-label">\{signOutBusyLabel\(signOutPhase\)\}<\/Text>/.test(settings)
        && /accessibilityLabel=\{signingOut \? signOutBusyLabel\(signOutPhase\) : 'Sign Out'\}/.test(settings));
    const notif = read('utils/notifications.ts');
    ok('the sign-out token read (prompt: false) is answered from the token this process already fetched; registering callers still fetch',
      /if \(opts\.prompt === false && knownExpoPushToken\) return knownExpoPushToken;\s*const tokenData = await Notifications\.getExpoPushTokenAsync\(\{ projectId \}\);\s*knownExpoPushToken = tokenData\.data;/.test(notif)
        && notif.indexOf("if (finalStatus !== 'granted')") < notif.indexOf('if (opts.prompt === false && knownExpoPushToken)'));
  }

  console.log('\n#150 / CONTRACT 24 refreshAll');
  ok('refreshAll is the foreground pass, on the context', /const refreshAll = refetchAllOnForeground;/.test(PC) && /refreshAll: \(\) => Promise<void>;/.test(PC) && /portalAiaListServerRead: portalAiaFresh,\s*refreshAll,/.test(PC));

  console.log('\n#85 a field ticket UPDATE never carries user_id');
  {
    const upd = PC.slice(PC.indexOf('const updateFieldTicket = useCallback('), PC.indexOf('const updateFieldTicket = useCallback(') + 2500);
    ok('user_id is taken off the row before the update is queued',
      /const \{ user_id: _owner, \.\.\.updateRow \} = fieldTicketRow\(next\);/.test(upd) && /supabaseWrite\('field_tickets', 'update', updateRow\)/.test(upd));
  }

  console.log('\n#138 clearing a permit expiry reaches the server as NULL');
  {
    const permitToRow = runCallback<(p: Record<string, unknown>) => Record<string, unknown>>(PC, 'permitToRow', { userId: 'u1' });
    const row = permitToRow({ id: 'pm1', projectId: 'p1', type: 'building', status: 'approved', expiresDate: '', approvedDate: '2026-09-01' });
    ok("expiresDate '' → expires_date null (a cleared date is sent, not skipped)", 'expires_date' in row && row.expires_date === null);
    const upd = PC.slice(PC.indexOf('const updatePermit = useCallback('), PC.indexOf('const updatePermit = useCallback(') + 900);
    ok('updatePermit still writes the whole row (so the null goes out)', /supabaseWrite\('permits', 'update', permitToRow\(next\)\)/.test(upd));
  }

  console.log('\n#3/#4 (settings) Reset this device — the in-memory plan lists');
  {
    const rl = PC.slice(PC.indexOf('const reloadLocalMirrors = useCallback('), PC.indexOf('const reloadLocalMirrors = useCallback(') + 1200);
    ok('reloadLocalMirrors empties the plan lists and re-runs the replacing hydration',
      /planSheetsRef\.current = \[\];/.test(rl) && /setPlanSheets\(\[\]\); setDrawingPins\(\[\]\); setPlanMarkups\(\[\]\); setPlanCalibrations\(\[\]\);/.test(rl) && /await hydratePlansFromServer\(\);/.test(rl));
    ok('…and is on the context', /reloadLocalMirrors: \(\) => Promise<void>;/.test(PC) && /refreshAll,\s*reloadLocalMirrors,/.test(PC));
  }

  console.log(`\n${failures === 0 ? '✓' : '✗'} validate-w5-join-core-delete: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

void main();
