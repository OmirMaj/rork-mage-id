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
    deleteProjectSafetyRefusal('Henderson', 1) === 'Henderson has 1 injury/near-miss record on your OSHA 300 log, which must be kept for 5 years. Mark the job Closed instead.');
  ok('three → plural', /has 3 injury\/near-miss records on your OSHA 300 log/.test(deleteProjectSafetyRefusal('Henderson', 3) ?? ''));
  ok('deleteProjectRefusal: the owner rule first, then the safety rule',
    deleteProjectRefusal({ ownerUserId: 'gc', name: 'H' }, 'u1', { incidentCount: 2 }) === DELETE_NOT_OWNER_REASON
      && /OSHA 300/.test(deleteProjectRefusal({ ownerUserId: 'u1', name: 'H' }, 'u1', { incidentCount: 2 }) ?? '')
      && deleteProjectRefusal({ ownerUserId: 'u1', name: 'H' }, 'u1') === null);
  ok('the offline sentence', SAFETY_CHECK_OFFLINE_REASON === 'Can’t check this job’s safety records offline — try again with signal.');
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
    const flush = logout.indexOf('await flushQueuesBeforeSignOut();');
    const release = logout.indexOf('await releasePushTokenBeforeSignOut();');
    const signOut = logout.indexOf('await supabase.auth.signOut();');
    const wipe = logout.indexOf('await wipeLocalUserCache();');
    ok('order: flush → release the token → sign out → wipe', flush > 0 && flush < release && release < signOut && signOut < wipe);
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
