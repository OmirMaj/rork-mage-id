// scripts/validate-context-integrator-access.ts — wave 3, lane context-integrator.
//
// #90: when the GC removes a foreman, the job leaves the foreman's phone and
// the app stops treating him as its owner. Executes the pure decisions and
// pins the provider lines that apply them (the loader + hydration pass are
// also EXECUTED by validate-session-load-integrity's #90 cases; roleForUser /
// resolveRoleState by validate-collaborator-invite).
// Run: bun run scripts/validate-context-integrator-access.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  revokedCachedProjectIds, queuedEntryRevokedProject, noLongerHaveAccessReason, revocationConfirmed, childProjectMap, listsHoldRevoked,
} from '../utils/projectContextPure';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const CTX = read('contexts/ProjectContext.tsx');
const OQ = read('utils/offlineQueue.ts');

let passed = 0; let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j + end.length);
}

console.log('\n#90 — which cached jobs a successful read says he lost:');
{
  const cached = [
    { id: 'gc-job', name: 'Henderson', ownerUserId: 'gc', myRole: 'field' as const },
    { id: 'legacy-shared', name: 'Old', myRole: 'editor' as const },
    { id: 'my-offline-create', name: 'New' },
    { id: 'mine', ownerUserId: 'foreman' },
    { id: 'still-shared', ownerUserId: 'gc', myRole: 'field' as const },
  ];
  const got = revokedCachedProjectIds(cached, new Set(['still-shared']), 'foreman');
  ok('a known other owner not returned → removed', got.has('gc-job'));
  ok('a legacy cache (no owner stamp) with a collaborator role not returned → removed', got.has('legacy-shared'));
  ok('his own offline create (no owner, no role) → KEPT (never lock an owner out)', !got.has('my-offline-create'));
  ok('his own job not returned (e.g. just created) → KEPT', !got.has('mine'));
  ok('a shared job the server still returns → kept', !got.has('still-shared'));
  ok('the zero-row read (nothing returned) removes only the foreign ones',
    [...revokedCachedProjectIds(cached, new Set(), 'foreman')].sort().join() === 'gc-job,legacy-shared,still-shared');
  ok('no user → nothing is removed', revokedCachedProjectIds(cached, new Set(), null).size === 0);
}

console.log('\n#90 — his queued writes for a removed job go to the failure path, by name:');
{
  const ids = new Set(['gc-job']);
  const child = new Map([['dfr-1', 'gc-job'], ['dfr-mine', 'mine']]);
  ok('a projects row by id', queuedEntryRevokedProject({ table: 'projects', operation: 'upsert', data: { id: 'gc-job' } }, ids, child) === 'gc-job');
  ok('project_financials by project_id', queuedEntryRevokedProject({ table: 'project_financials', operation: 'upsert', data: { project_id: 'gc-job' } }, ids, child) === 'gc-job');
  ok('a child insert by project_id', queuedEntryRevokedProject({ table: 'daily_reports', operation: 'insert', data: { id: 'x', project_id: 'gc-job' } }, ids, child) === 'gc-job');
  ok('a child UPDATE patch (no project_id) through the device copy of the record', queuedEntryRevokedProject({ table: 'daily_reports', operation: 'update', data: { id: 'dfr-1' } }, ids, child) === 'gc-job');
  ok('his own job\'s writes are kept', queuedEntryRevokedProject({ table: 'daily_reports', operation: 'update', data: { id: 'dfr-mine' } }, ids, child) === null
    && queuedEntryRevokedProject({ table: 'projects', operation: 'upsert', data: { id: 'mine' } }, ids, child) === null);
  ok('the sentence names the job', noLongerHaveAccessReason('Henderson') === 'You no longer have access to Henderson'
    && noLongerHaveAccessReason('  ') === 'You no longer have access to this job');
  const dq = slice(OQ, 'export async function discardQueuedWrites(', '\n}\n');
  // Integration round 1: as NOTES — a write to a job he left can never land,
  // so the sheet must not offer it a Retry.
  ok('offlineQueue.discardQueuedWrites rewrites the queue under the lock and reports every drop through notifyDroppedWrites',
    /await withQueueLock\(async \(\) => \{/.test(dq) && /for \(const \[reason, entries\] of byReason\) await notifyDroppedWrites\(entries, reason, \{ asNotes: true \}\);/.test(dq)
      && /notifyQueueChanged\(remaining\)/.test(dq));
}

console.log('\n#90 — the provider applies it:');
{
  const qf = slice(CTX, "queryKey: ['projects', userId],", 'const settingsQuery = useQuery({');
  ok('a successful ZERO-row projects read is the server\'s answer when trusted (it used to fall through to the whole cache)',
    /if \(!error && data && \(data\.length > 0 \|\| await emptyReadTrusted\(userId, bearerBefore\)\)\) \{/.test(qf)
      && qf.indexOf('const bearerBefore = await readBearer();') >= 0
      && qf.indexOf('const bearerBefore = await readBearer();') < qf.indexOf(".from('projects')"));
  ok('the loader computes the removed jobs against the device cache AND memory, and keeps them out of the list and the cache',
    /let revoked = revokedCachedProjectIds\(\[\.\.\.localForMerge, \.\.\.projectsRef\.current\], remoteIds, userId\);/.test(qf)
      && qf.indexOf('const merged = revoked.size > 0') < qf.indexOf('await saveLocal(PROJECTS_KEY, merged);'));
  // Review round 1: forgetting a job discards its unsent writes — never on a
  // single zero-row read.
  ok('revocationConfirmed: rows came back → confirmed; zero rows need the second read', revocationConfirmed({ rowCount: 3, confirmedEmpty: false })
    && !revocationConfirmed({ rowCount: 0, confirmedEmpty: false }) && revocationConfirmed({ rowCount: 0, confirmedEmpty: true }));
  ok('...and the loader drops the verdict unless it is confirmed, BEFORE the plan uses it',
    /if \(revoked\.size > 0 && !revocationConfirmed\(\{ rowCount: data\.length, confirmedEmpty: data\.length === 0 && await confirmNoProjects\(userId\) \}\)\) \{\s*revoked = new Set\(\);\s*\}/.test(qf)
      && qf.indexOf('revoked = new Set();') < qf.indexOf('const plan = planProjectsLoad('));
  const confirm = slice(CTX, 'const confirmNoProjects = async (loadUserId: string | null): Promise<boolean> => {', '\n  };');
  ok('...the confirming read is its own SELECT under a bearer checked before AND after it',
    /const bearerBefore = await readBearer\(\);\s*if \(!bearerBefore\) return false;/.test(confirm)
      && /supabase\.from\('projects'\)\.select\('id'\)\.limit\(1\)/.test(confirm)
      && /return await emptyReadTrusted\(loadUserId, bearerBefore\);/.test(confirm));
  ok('a job the server returns again (re-invited) is no longer swept', /for \(const id of remoteIds\) revokedSweepRef\.current\.delete\(id\);/.test(qf));

  // Review round 1: the record → job map comes from memory AND the device
  // caches (cold launch: the lists may not have hydrated yet).
  const ids = new Set(['gc-job']);
  const map = childProjectMap([[], [{ id: 'dfr-1', projectId: 'gc-job' }, { id: 'mine', projectId: 'p3' }], null], ids);
  ok('childProjectMap: a record found only in a device cache still ties its queued UPDATE to the removed job',
    map.get('dfr-1') === 'gc-job' && !map.has('mine') && map.size === 1);
  ok('listsHoldRevoked: a late-hydrating list with the job\'s records is seen; one without is not',
    listsHoldRevoked([[{ projectId: 'p3' }], [{ projectId: 'gc-job' }]], ids) && !listsHoldRevoked([[{ projectId: 'p3' }]], ids)
      && !listsHoldRevoked([[{ projectId: 'gc-job' }]], new Set()));
  const sweep = slice(CTX, 'const sweepRevokedJobs = (ids: ReadonlySet<string>, names: ReadonlyMap<string, string>): Promise<number> => {', '\n  };');
  const mapHelper = slice(CTX, 'const childProjectMapFromListsAndCaches = async (', '\n  };');
  ok('the sweep drops the jobs\' child records locally (the delete cascade, no server write), then builds the map from memory AND every device cache',
    // Wave 4 #8/#128: the map is built by childProjectMapFromListsAndCaches,
    // shared with countQueuedForProject so the Leave count equals the sweep.
    /forgetProjectsLocally\(ids\);/.test(sweep) && !/syncProjectToSupabase/.test(sweep)
      && /const childProject = await childProjectMapFromListsAndCaches\(memory, ids\);/.test(sweep)
      && /REVOKED_SWEEP_CACHE_KEYS\.map\(k =>\s*loadLocal/.test(mapHelper) && /return childProjectMap\(\[\.\.\.memory, \.\.\.disk\], ids\);/.test(mapHelper));
  ok('...sends their queued writes to the failure path with the job\'s name',
    /discardQueuedWrites\(\(m\) => \{\s*const pid = queuedEntryRevokedProject\(m, ids, childProject\);/.test(sweep) && /noLongerHaveAccessReason\(names\.get\(pid\)\)/.test(sweep));
  const keysBlock = slice(CTX, 'const REVOKED_SWEEP_CACHE_KEYS = [', '] as const;');
  ok('...the cache keys cover every list the old in-memory map read',
    ['CHANGE_ORDERS_KEY', 'INVOICES_KEY', 'COMMITMENTS_KEY', 'DAILY_REPORTS_KEY', 'FIELD_TICKETS_KEY', 'PUNCH_ITEMS_KEY', 'PHOTOS_KEY', 'RFIS_KEY',
      'SUBMITTALS_KEY', 'PERMITS_KEY', 'AIA_PAY_APPS_KEY', 'WARRANTIES_KEY', 'PLAN_SHEETS_KEY', 'DRAWING_PINS_KEY', 'PLAN_MARKUPS_KEY',
      'PLAN_CALIBRATIONS_KEY', 'OAC_MEETINGS_KEY', 'DELAY_EVENTS_KEY', 'DELIVERIES_KEY'].every(k => keysBlock.includes(k)));
  const cleanup = slice(CTX, 'if (!revokedCleanup || revokedCleanup.size === 0) return;', '}, [revokedCleanup]);');
  ok('the one-time cleanup records the jobs for later sweeps and runs the sweep',
    /for \(const \[pid, name\] of names\) revokedSweepRef\.current\.set\(pid, name\);/.test(cleanup) && /sweepRevokedJobs\(ids, names\)\.then\(tell,/.test(cleanup));
  ok('...and tells him once, counting only what was really unsent', /showAlert\(\s*'No longer on a job',/.test(cleanup) && /unsent > 0 \?/.test(cleanup));
  const late = slice(CTX, 'const swept = revokedSweepRef.current;', '}, revokedSweepLists as unknown[]);');
  ok('a list that hydrates AFTER the cleanup is swept again (silently)',
    /if \(!listsHoldRevoked\(revokedSweepLists, ids\)\) return;/.test(late) && /sweepRevokedJobs\(ids, new Map\(swept\)\)/.test(late) && !/showAlert/.test(late));
  const del = slice(CTX, 'const deleteProject = useCallback(', '}, [userId, projects, saveProjectsMutation, syncProjectToSupabase, forgetProjectsLocally, canSync, seedServerProjectIds]);');
  ok('deleteProject still refuses a non-owner first, then cascades through the same forgetProjectsLocally',
    del.indexOf('deleteProjectRefusal(toDelete, userId)') >= 0 && del.indexOf('deleteProjectRefusal') < del.indexOf('forgetProjectsLocally(new Set([id]));'));
  const fsp = slice(CTX, 'const forgetSharedProject = useCallback((id: string)', '}, [userId, saveProjectsMutation, forgetProjectsLocally]);');
  ok('forgetSharedProject (Leave) refuses a job he owns, drops the row + children locally, never writes a server delete',
    /if \(!p\.ownerUserId \|\| p\.ownerUserId === userId\) \{\s*return \{ ok: false, reason:/.test(fsp)
      && /sweepRevokedJobs\(new Set\(\[id\]\), new Map\(\[\[id, p\.name \?\? ''\]\]\)\)/.test(fsp)
      && /revokedSweepRef\.current\.set\(id, p\.name \?\? ''\);/.test(fsp)
      && !/syncProjectToSupabase/.test(fsp));
  ok('...and a job he left is not later announced as "the owner removed you"',
    /leftByMeRef\.current\.add\(id\);/.test(fsp) && /const toldIds = \[\.\.\.ids\]\.filter\(pid => !leftByMeRef\.current\.has\(pid\)\);/.test(CTX));
  ok('the cached-role hint the role hook reads is exported and tolerant outside the provider',
    /export function useCachedProjectRoleHint\(projectId: string \| undefined\)/.test(CTX) && /const core = useContext\(CoreDataContext\);/.test(CTX));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
