// validate-active-project — the job context (wave 6b, lane L2).
//
// WHAT IT PROVES. The desktop shell now has an answer to "which job am I in",
// and three surfaces act on it: the sidebar's THIS JOB rows carry it, the job
// switcher swaps it, and a pick in any project tool's picker sets it. If that
// answer is wrong it is wrong everywhere at once, and the worst wrong answer
// is ANOTHER ACCOUNT's job on a shared laptop. Everything that decides the
// answer lives in utils/activeProject.ts (pure) so it can be exercised here
// under bun; contexts/ActiveProjectContext.tsx only wires state, storage and
// the URL to it, and the source checks at the bottom pin that wiring.
//
// Run: bun run scripts/validate-active-project.ts
// Pure node:fs + the pure module; no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ACTIVE_PROJECT_KEY, RECENT_PROJECTS_KEY, SIDEBAR_SECTIONS_KEY, RECENT_MAX, RECENT_VISIBLE,
  isEligibleJob, resolveActiveProjectId, pushRecent, visibleRecent, jobSwitcherList,
  normalizeRoutePath, projectParamFor, urlProjectIdFrom,
  stampActive, stampRecent, readStampedActive, readStampedRecent, parseSectionState,
  jobScopedTarget, jobSwitchTarget,
} from '../utils/activeProject';
import { APP_STORAGE_PREFIXES } from '../utils/localCacheKeys';
import { FEATURE_REGISTRY } from '../utils/featureRegistry';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `expected ${e}, got ${a}`);
}

type Status = 'draft' | 'estimated' | 'in_progress' | 'completed' | 'closed';
const job = (id: string, status: Status, updatedAt: string, name = `Job ${id}`) =>
  ({ id, name, status, updatedAt });

const A = job('a', 'in_progress', '2026-09-01T00:00:00Z', 'Henderson Residence');
const B = job('b', 'in_progress', '2026-09-20T00:00:00Z', 'Okafor Duplex');
const C = job('c', 'estimated', '2026-09-22T00:00:00Z', 'Chan Kitchen');
const CLOSED = job('x', 'closed', '2026-09-23T00:00:00Z', 'Old Warehouse');
const SAMPLE = job('s', 'in_progress', '2026-09-23T12:00:00Z', 'Sample — Kitchen Remodel');
const ALL = [A, B, C, CLOSED, SAMPLE];

console.log('\nactive-project validation:');

// ── Storage keys sit inside the tenant sweep ────────────────────────────────
console.log('\nstorage keys:');
for (const key of [ACTIVE_PROJECT_KEY, RECENT_PROJECTS_KEY, SIDEBAR_SECTIONS_KEY]) {
  ok(`${key} is under an APP_STORAGE_PREFIXES prefix (wiped on sign-out / tenant switch)`,
    APP_STORAGE_PREFIXES.some(p => key.startsWith(p)) && key.startsWith('mageid_'));
}
eq('the three keys are the ones the spec names',
  [ACTIVE_PROJECT_KEY, RECENT_PROJECTS_KEY, SIDEBAR_SECTIONS_KEY],
  ['mageid_active_project', 'mageid_recent_projects', 'mageid_sidebar_sections']);

// ── Eligibility ─────────────────────────────────────────────────────────────
console.log('\neligibility:');
ok('an in-progress job is eligible', isEligibleJob(A));
ok('an estimated job is eligible', isEligibleJob(C));
ok('a closed job is not', !isEligibleJob(CLOSED));
ok('a sample job ("Sample — …", em dash) is not', !isEligibleJob(SAMPLE));
ok('a hyphenated "Sample - …" is a real job, not a sample (server uses the em dash)',
  isEligibleJob(job('h', 'in_progress', '', 'Sample - Real Client')));

// ── Resolution order ────────────────────────────────────────────────────────
console.log('\nresolution order (URL → stored → recent → newest in-progress):');
eq('1. a live job in the URL wins over everything',
  resolveActiveProjectId({ urlProjectId: 'c', storedId: 'a', recentIds: ['b'], projects: ALL }), 'c');
eq('1. a CLOSED job in the URL falls through to the stored pick',
  resolveActiveProjectId({ urlProjectId: 'x', storedId: 'a', recentIds: ['b'], projects: ALL }), 'a');
eq('1. a SAMPLE job in the URL falls through',
  resolveActiveProjectId({ urlProjectId: 's', storedId: 'a', recentIds: [], projects: ALL }), 'a');
eq("1. an id not in this user's list (deleted, or another account's) falls through",
  resolveActiveProjectId({ urlProjectId: 'other-tenant', storedId: 'a', recentIds: [], projects: ALL }), 'a');
eq('2. the stored pick beats the recent list',
  resolveActiveProjectId({ urlProjectId: null, storedId: 'c', recentIds: ['a'], projects: ALL }), 'c');
eq('2. a stored id that is gone falls through to recent',
  resolveActiveProjectId({ urlProjectId: null, storedId: 'gone', recentIds: ['x', 'c', 'a'], projects: ALL }), 'c');
eq('3. recent skips closed / sample / missing and takes the first live one',
  resolveActiveProjectId({ urlProjectId: null, storedId: null, recentIds: ['gone', 's', 'x', 'a'], projects: ALL }), 'a');
eq('4. with nothing else, the most recently UPDATED in-progress job (B beats A; C is estimated)',
  resolveActiveProjectId({ urlProjectId: null, storedId: null, recentIds: [], projects: ALL }), 'b');
eq('4. a sample job is never the fallback even when it is the newest in-progress',
  resolveActiveProjectId({ urlProjectId: null, storedId: null, recentIds: [], projects: [A, SAMPLE] }), 'a');
eq('no eligible in-progress job and nothing stored → null (no guessing)',
  resolveActiveProjectId({ urlProjectId: null, storedId: null, recentIds: [], projects: [C, CLOSED, SAMPLE] }), null);
eq('an empty project list → null whatever storage says (cold start / signed out)',
  resolveActiveProjectId({ urlProjectId: 'a', storedId: 'a', recentIds: ['a'], projects: [] }), null);
eq('an unparseable updatedAt ranks as oldest, not as NaN',
  resolveActiveProjectId({ urlProjectId: null, storedId: null, recentIds: [],
    projects: [job('n', 'in_progress', 'not a date'), job('m', 'in_progress', '2026-01-01T00:00:00Z')] }), 'm');

// ── MRU ────────────────────────────────────────────────────────────────────
console.log('\nrecent list:');
const exists = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);
eq('pushRecent puts the job first', pushRecent(['a', 'b'], 'c', exists), ['c', 'a', 'b']);
eq('pushRecent dedupes (re-opening moves it to the front)', pushRecent(['a', 'b', 'c'], 'b', exists), ['b', 'a', 'c']);
eq('pushRecent prunes ids that no longer exist', pushRecent(['a', 'gone', 'b'], 'c', exists), ['c', 'a', 'b']);
eq(`pushRecent caps at RECENT_MAX (${RECENT_MAX})`,
  pushRecent(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], 'j', exists).length, RECENT_MAX);
eq('RECENT_MAX is 8 and RECENT_VISIBLE is 5 (spec)', [RECENT_MAX, RECENT_VISIBLE], [8, 5]);
eq('visibleRecent drops closed, sample and missing, keeps MRU order',
  visibleRecent(['x', 'b', 's', 'gone', 'a'], ALL), ['b', 'a']);
eq('visibleRecent shows at most 5',
  visibleRecent(['a', 'b', 'c', 'd', 'e', 'f'], [A, B, C, ...['d', 'e', 'f'].map(i => job(i, 'draft', ''))]).length, 5);
eq('visibleRecent dedupes a hand-edited list', visibleRecent(['a', 'a', 'b'], ALL), ['a', 'b']);

// ── Job switcher list ───────────────────────────────────────────────────────
console.log('\njob switcher list:');
const D = job('d', 'draft', '2026-09-23T00:00:00Z', 'Diaz Deck');
eq('recent first (MRU order), then in-progress by newest, then the rest by newest',
  jobSwitcherList([A, B, C, D, CLOSED, SAMPLE], ['c'], '').map(p => p.id), ['c', 'b', 'a', 'd']);
eq('closed and sample jobs are never offered', jobSwitcherList(ALL, ['x', 's'], '').some(p => p.id === 'x' || p.id === 's'), false);
eq('type-to-filter is a case-insensitive substring of the name',
  jobSwitcherList([A, B, C, D], [], 'OKA').map(p => p.id), ['b']);
eq('a filter with no match is empty (the UI says so)', jobSwitcherList([A, B], [], 'zzz').length, 0);
eq('a whitespace-only filter is no filter', jobSwitcherList([A, B], [], '   ').length, 2);

// ── Route ↔ job ────────────────────────────────────────────────────────────
console.log('\nroute and URL:');
eq('normalizeRoutePath strips groups', normalizeRoutePath('/(tabs)/(home)'), '/');
eq('normalizeRoutePath keeps real segments', normalizeRoutePath('/(tabs)/discover/schedule'), '/discover/schedule');
eq('client-portal-setup reads ?id', projectParamFor('/client-portal-setup'), 'id');
eq('project-detail reads ?id', projectParamFor('/project-detail'), 'id');
eq('rfi reads ?projectId', projectParamFor('/rfi'), 'projectId');
eq('a grouped route is matched group-free', projectParamFor('/(tabs)/schedule'), 'projectId');
eq('URL: ?projectId counts on any route', urlProjectIdFrom('/rfi', { projectId: 'a' }), 'a');
eq("URL: ?id on /invoice is NOT a job (it is the invoice's id)", urlProjectIdFrom('/invoice', { id: 'inv-1' }), null);
eq('URL: ?id on /project-detail is the job', urlProjectIdFrom('/project-detail', { id: 'a' }), 'a');
eq('URL: an array param takes the first value', urlProjectIdFrom('/rfi', { projectId: ['a', 'b'] }), 'a');
eq('URL: an empty param is no job', urlProjectIdFrom('/rfi', { projectId: '' }), null);
eq('URL: ?projectId beats ?id', urlProjectIdFrom('/project-detail', { projectId: 'b', id: 'a' }), 'b');

// ── Stamped storage: the second tenant lock ─────────────────────────────────
console.log('\nstamped storage (never another account\'s job):');
eq('active id round-trips for its owner', readStampedActive(stampActive('u1', 'a'), 'u1'), 'a');
eq("another user reads null from u1's active id", readStampedActive(stampActive('u1', 'a'), 'u2'), null);
eq('a signed-out read is null', readStampedActive(stampActive('u1', 'a'), null), null);
eq('a cleared pick reads null', readStampedActive(stampActive('u1', null), 'u1'), null);
eq('a pre-stamp bare string (legacy / hand-written) is ignored', readStampedActive('a', 'u1'), null);
eq('malformed JSON is ignored', readStampedActive('{nope', 'u1'), null);
eq('recent round-trips for its owner', readStampedRecent(stampRecent('u1', ['a', 'b']), 'u1'), ['a', 'b']);
eq("another user reads [] from u1's recent list", readStampedRecent(stampRecent('u1', ['a']), 'u2'), []);
eq('recent read drops non-strings and duplicates', readStampedRecent(JSON.stringify({ uid: 'u1', ids: ['a', 3, 'a', '', 'b'] }), 'u1'), ['a', 'b']);
eq('recent read caps at RECENT_MAX', readStampedRecent(stampRecent('u1', 'abcdefghijk'.split('')), 'u1').length, RECENT_MAX);
eq('section state keeps booleans only', parseSectionState(JSON.stringify({ BUSINESS: true, FINANCE: 'yes', X: 1 })), { BUSINESS: true });
eq('section state: an array or garbage is {}', [parseSectionState('[true]'), parseSectionState('garbage'), parseSectionState(null)], [{}, {}, {}]);

// ── Sidebar targets ─────────────────────────────────────────────────────────
console.log('\nsidebar row targets:');
eq('no active job → the bare route (the screen asks, as before)',
  jobScopedTarget('/rfi', { projectScoped: true, activeProjectId: null }), { pathname: '/rfi' });
eq('a projectScoped row carries ?projectId',
  jobScopedTarget('/rfi', { projectScoped: true, activeProjectId: 'a' }), { pathname: '/rfi', params: { projectId: 'a' } });
eq('client-portal-setup carries the job as ?id (the param it reads)',
  jobScopedTarget('/client-portal-setup', { projectScoped: true, activeProjectId: 'a' }),
  { pathname: '/client-portal-setup', params: { id: 'a' } });
eq('a global row never carries a job it would ignore',
  jobScopedTarget('/wip-report', { projectScoped: false, activeProjectId: 'a' }), { pathname: '/wip-report' });
eq('a jobRoute replaces the route when there is a job (Schedule → the schedule tab)',
  jobScopedTarget('/(tabs)/discover/schedule', { projectScoped: false, jobRoute: '/(tabs)/schedule', activeProjectId: 'a' }),
  { pathname: '/(tabs)/schedule', params: { projectId: 'a' } });
eq('…and not when there is none (the on-ramp lists every job)',
  jobScopedTarget('/(tabs)/discover/schedule', { projectScoped: false, jobRoute: '/(tabs)/schedule', activeProjectId: null }),
  { pathname: '/(tabs)/discover/schedule' });

console.log('\njob switcher targets:');
const stay = new Map<string, string>([['/rfi', '/rfi'], ['/schedule', '/(tabs)/schedule'], ['/client-portal-setup', '/client-portal-setup']]);
eq('on a project tool, picking a job stays on the tool',
  jobSwitchTarget('/rfi', 'b', stay), { pathname: '/rfi', params: { projectId: 'b' } });
eq('on a grouped tool (the schedule tab resolves to /schedule), it stays too',
  jobSwitchTarget('/schedule', 'b', stay), { pathname: '/(tabs)/schedule', params: { projectId: 'b' } });
eq('on client-portal-setup it swaps ?id',
  jobSwitchTarget('/client-portal-setup', 'b', stay), { pathname: '/client-portal-setup', params: { id: 'b' } });
eq('anywhere else it opens the job Overview',
  jobSwitchTarget('/wip-report', 'b', stay), { pathname: '/project-detail', params: { id: 'b' } });
eq('on Home it opens the job Overview', jobSwitchTarget('/', 'b', stay), { pathname: '/project-detail', params: { id: 'b' } });
eq('on project-detail it opens the other job Overview',
  jobSwitchTarget('/project-detail', 'b', stay), { pathname: '/project-detail', params: { id: 'b' } });

// ── Every projectScoped screen reads the param the job is sent under ────────
// jobScopedTarget and ToolProjectPicker both send the job under
// projectParamFor(route). A screen that reads a different name gets nothing
// and shows the picker — the exact dead end this wave removes — so check each
// screen reads the param it is sent.
console.log('\nprojectScoped screens read the param they are sent:');
for (const e of FEATURE_REGISTRY) {
  if (!e.projectScoped) continue;
  const rel = e.route.replace(/^\//, '');
  const file = [join('app', `${rel}.tsx`), join('app', rel, 'index.tsx')].find(f => existsSync(join(ROOT, f)));
  if (!file) { ok(`${e.route}: screen exists`, false); continue; }
  const src = read(file);
  const param = projectParamFor(e.route);
  const readsIt = param === 'id'
    ? /useLocalSearchParams<\{[^}]*\bid\??:/.test(src)
    : /useLocalSearchParams<\{[^}]*\bprojectId\??:/.test(src) || /params\.projectId\b/.test(src);
  ok(`${e.route} reads ?${param}`, readsIt, `${file} does not read '${param}' from useLocalSearchParams`);
}

// ── Wiring (source level) ───────────────────────────────────────────────────
console.log('\nwiring:');
const ctx = read(join('contexts', 'ActiveProjectContext.tsx'));
ok('the provider hydrates per user and resets in-memory state first',
  /setStored\(\{ \.\.\.EMPTY, uid, hydrated: !uid \}\)/.test(ctx) && /\[uid, setStored\]/.test(ctx),
  "on a user change the previous account's job must leave memory before the new read resolves");
ok('stored values are read through the uid stamp',
  /readStampedActive\(rawActive, uid\)/.test(ctx) && /readStampedRecent\(rawRecent, uid\)/.test(ctx));
ok('writes are stamped with the CURRENT user and refused across a user change',
  /if \(!owner \|\| prev\.uid !== owner\) return;/.test(ctx) && /stampActive\(owner, id\)/.test(ctx));
ok('a write before hydration is deferred, not allowed to clobber the stored list',
  /if \(!prev\.hydrated\) \{ pendingRef\.current = \{ id \}; return; \}/.test(ctx));
ok('the URL leads: a live job in the URL becomes the active job',
  /urlProjectIdFrom\(pathname, params\)/.test(ctx) && /setActiveProject\(urlProjectId\)/.test(ctx));
ok('what the context exposes is resolved, never raw storage',
  /resolveActiveProjectId\(\{/.test(ctx) && /visibleRecent\(stored\.recent, projects\)/.test(ctx));
ok('with no provider the hook is inert (the picker can call it anywhere)',
  /createContextHook<ActiveProjectValue>\([\s\S]*\}, INERT\);/.test(ctx));

const layout = read(join('app', '_layout.tsx'));
const pp = layout.indexOf('<ProjectProvider>');
const ap = layout.indexOf('<ActiveProjectProvider>');
const ppEnd = layout.indexOf('</ProjectProvider>');
const apEnd = layout.indexOf('</ActiveProjectProvider>');
ok('ActiveProjectProvider is mounted inside ProjectProvider (it reads the project list)',
  pp > 0 && ap > pp && apEnd > ap && ppEnd > apEnd);
const sidebarAt = layout.indexOf('<DesktopSidebar');
const rootNavAt = layout.indexOf('function RootLayoutNav');
ok('the desktop sidebar renders below the provider (inside RootLayoutNav)',
  sidebarAt > rootNavAt && rootNavAt > 0 && /<RootLayoutNav\s*\/>/.test(layout.slice(ap, apEnd)),
  'RootLayoutNav must be rendered inside <ActiveProjectProvider>');

const switcher = read(join('components', 'desktop', 'JobSwitcher.tsx'));
ok('the job switcher lists through jobSwitcherList', /jobSwitcherList\(projects, recentProjectIds, query\)/.test(switcher));
ok('the job switcher binds no Cmd/Ctrl shortcut (Cmd+P is the browser\'s Print)',
  !/metaKey|ctrlKey/.test(switcher.replace(/\/\/.*$/gm, '')));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
