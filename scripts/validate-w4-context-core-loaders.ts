// validate-w4-context-core-loaders.ts — wave 4, lane context-core: the
// ProjectContext write path and the list loaders.
//
//   #3  a punch item with no dueDate (Brain mic, sample jobs) was refused by
//       the server (due_date NOT NULL) and then vanished from the list.
//   #1  a record whose write the server refused lived only on the phone, and
//       the next list read deleted it — the loaders now keep every id the sync
//       ledger names (utils/syncLedger.unsavedWriteIds) as well as queued ids.
//   #4  a job's children raced the job's own create write and were refused;
//       utils/offlineQueue orders them behind the job's slot; this side hands
//       every child INSERT over in the same tick and addProject returns how
//       the job's create ended.
//   #5  a pay application / invoice / commitment whose write was still on the
//       wire dropped off the list (or reverted) when the list re-read.
//   #6  a list load for an account that had signed out wrote that account's
//       rows back into the cache after the sign-out wipe.
//   #8/#128 "Leave project" counts what leaving would discard, and the leave
//       sweep drops the job's queued photos too.
//   #23/#24/#32 RFI / submittal deletes, queued review cycles, and batch
//       creates handed over in creation order.
//   #86 a live schedule copy carries the active baseline id.
//   #111/#130 projectsFetching is the projects query's own isFetching.
//
// Behaviour is executed wherever the code can run outside React: the pure
// helpers directly, and the provider's own callbacks (punchItemToRow,
// sendNumberedInsertsInOrder, touchedWrite, the stale-account
// retry rule) transpiled out of the source and run with stubs. Wiring that
// only exists inside the provider is pinned from the source.
//
// Run: bun run scripts/validate-w4-context-core-loaders.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  absorbedScheduleMeta, childProjectMap, countQueuedEntriesForProject, deviceRowsWrittenDuringRead,
  mergeLocalOnly, mergeServerKeepingPending, queuedEntryRevokedProject, type QueueEntryLike,
} from '../utils/projectContextPure';
import { withActiveBaselineId } from '../utils/scheduleOps';
import { mergeEditedSchedule } from '../utils/scheduleEngine';
import type { ProjectSchedule } from '../types';

declare const Bun: { Transpiler: new (o: { loader: 'ts' | 'tsx' }) => { transformSync(code: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CTX = readFileSync(resolve(ROOT, process.env.PROJECT_CONTEXT_PATH ?? 'contexts/ProjectContext.tsx'), 'utf8');

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`); }
}

/** The text between `start` and the bracket that closes the first `(` / `{`
 *  opened at or after it — balanced, skipping strings, template literals and
 *  comments well enough for this file's code. */
function balancedFrom(src: string, start: number, open: '(' | '{'): string {
  const close = open === '(' ? ')' : '}';
  const i = src.indexOf(open, start);
  if (i < 0) return '';
  let depth = 0;
  let k = i;
  let quote: string | null = null;
  for (; k < src.length; k++) {
    const c = src[k];
    const n = src[k + 1];
    if (quote) {
      if (c === '\\') { k++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { k = src.indexOf('\n', k); if (k < 0) return ''; continue; }
    if (c === '/' && n === '*') { k = src.indexOf('*/', k) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') { depth--; if (depth === 0) break; }
  }
  return src.slice(i, k + 1).startsWith(open) && src[k] === close ? src.slice(i, k + 1) : '';
}

/** The function a `const NAME = useCallback(<fn>, deps)` wraps, as source. */
function callbackSource(name: string): string {
  const at = CTX.indexOf(`const ${name} = useCallback(`);
  if (at < 0) return '';
  const call = balancedFrom(CTX, at + `const ${name} = useCallback`.length, '(');
  // Strip the outer parens and the trailing `, [deps]`.
  const inner = call.slice(1, -1);
  const depsAt = inner.lastIndexOf(', [');
  return depsAt < 0 ? inner : inner.slice(0, depsAt);
}

const transpiler = new Bun.Transpiler({ loader: 'ts' });
/** Compile a function's TS source into a callable, with `stubs` in scope. */
function compile<F>(fnSource: string, stubs: Record<string, unknown>): F {
  const js = transpiler.transformSync(`export const __fn = ${fnSource};`).replace(/export\s+const\s+__fn\s*=/, 'return ');
  const names = Object.keys(stubs);
  return new Function(...names, js)(...names.map((n) => stubs[n])) as F;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#3 — a punch item with no due date still sends due_date:');
{
  const src = callbackSource('punchItemToRow');
  ok('punchItemToRow is found in the provider', src.length > 0);
  let row: Record<string, unknown> = {};
  try {
    const toRow = compile<(i: Record<string, unknown>) => Record<string, unknown>>(src, {
      userId: 'u1', durablePhotoValue: () => '', punchListTypeOf: () => 'punch',
    });
    // The Brain mic's payload: no dueDate, no assignedSub.
    row = JSON.parse(JSON.stringify(toRow({
      id: 'p1', projectId: 'j1', description: 'master bath light fixture loose', location: 'Master bath',
      priority: 'medium', status: 'open', createdAt: 'x', updatedAt: 'x',
    })));
  } catch (err) {
    ok('punchItemToRow runs', false, String(err));
  }
  ok('the JSON body carries due_date (NOT NULL column) — blank, not missing', row.due_date === '', JSON.stringify(row.due_date));
  ok('a real due date is sent as it is', (() => {
    try {
      const toRow = compile<(i: Record<string, unknown>) => Record<string, unknown>>(src, {
        userId: 'u1', durablePhotoValue: () => '', punchListTypeOf: () => 'punch',
      });
      return toRow({ id: 'p2', projectId: 'j1', dueDate: '2026-10-01' }).due_date === '2026-10-01';
    } catch { return false; }
  })());
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#1 — a refused record survives a trusted read that does not return it:');
{
  const row = { id: 'r1', projectId: 'j1' };
  ok('mergeLocalOnly drops an unkept device row (the old keep set: queue only)', mergeLocalOnly([], [row], new Set()).length === 0);
  ok('…and keeps it once the ledger id is in the keep set', mergeLocalOnly([], [row], new Set(['r1'])).length === 1);
  ok('unsavedWriteIds is imported from utils/syncLedger', /import \{[^}]*\bunsavedWriteIds\b[^}]*\} from '@\/utils\/syncLedger'/.test(CTX));
  const tables = ['change_orders', 'invoices', 'commitments', 'daily_reports', 'punch_items', 'photos', 'rfis', 'submittals', 'permits', 'aia_pay_apps', 'warranties'];
  for (const t of tables) {
    ok(`the ${t} loader keeps the ledger's refused ids with the queued ones`, CTX.includes(`...await queuedIdsFor('${t}'), ...await unsavedWriteIds('${t}')`));
  }
  // No list merge falls back to the queue-only keep set.
  const bare = [...CTX.matchAll(/merge(?:LocalOnly|ServerKeepingPending)\([^\n]*await queuedIdsFor\('(\w+)'\)(?!, \.\.\.await unsavedWriteIds\('\1'\))/g)].length;
  ok('no loader merge keeps queued ids alone', bare === 0, `${bare} merge(s) still use queuedIdsFor`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#4 — a job\'s children wait on the job\'s own create write:');
{
  // The ordering lives in utils/offlineQueue (a child's direct write holds its
  // own record slot and waits on the job's; a refusal while the job is still
  // pending is queued behind it) — validate-w4-sync-queue-ordering pins that
  // side. This side: the job's create takes its slot in the same tick
  // (immediate run), and every child INSERT is handed over in the same tick,
  // never after an await (awaiting left the child's slot free, so an edit of
  // it could overtake its INSERT).
  const childSends: [string, RegExp][] = [
    ['change_orders', /const insert = supabaseWriteDetailed\('change_orders', 'insert', \{/],
    ['invoices', /const insert = touchedWrite\(proDocWriteTouchRef, finalInvoice\.id, \(\) => supabaseWriteDetailed\('invoices', 'insert', \{/],
    ['daily_reports', /void touchedWrite\(proDocWriteTouchRef, finalReport\.id, \(\) => supabaseWrite\('daily_reports', 'insert', \{/],
    ['punch_items', /void touchedWrite\(proDocWriteTouchRef, item\.id, \(\) => supabaseWrite\('punch_items', 'insert', punchItemToRow\(item\)\)\)/],
    ['photos', /void touchedWrite\(proDocWriteTouchRef, finalPhoto\.id, \(\) => supabaseWrite\('photos', 'insert', \{/],
    ['rfis', /void touchedWrite\(proDocWriteTouchRef, newRfi\.id, \(\) => supabaseWrite\('rfis', 'insert', rfiToRow\(newRfi\)\)\)/],
    ['permits', /void touchedWrite\(proDocWriteTouchRef, newPermit\.id, \(\) => supabaseWrite\('permits', 'insert', permitToRow\(newPermit\)\)\)/],
    ['warranties', /void touchedWrite\(proDocWriteTouchRef, fresh\.id, \(\) => supabaseWrite\('warranties', 'insert', warrantyToRow\(fresh\)\)\)/],
  ];
  for (const [t, re] of childSends) ok(`${t}: the INSERT is handed to the ordered writer in the same tick`, re.test(CTX));
  const runStart = CTX.indexOf('    const run = async () => {');
  const immediateSend = CTX.slice(runStart, CTX.indexOf("await supabaseWrite('projects', 'upsert'", runStart));
  ok('the immediate (new-job) upsert reaches the writer with no await before it',
    /if \(!opts\?\.immediate\) \{\s*try \{ behindQueue = \(await ownQueuedProjectIds/.test(immediateSend)
    && /if \(!shared && !opts\?\.immediate && !serverProjectIdsRef\.current\.has\(project\.id\)\) await seedServerProjectIds\(\);/.test(immediateSend));
  const sync = CTX.slice(CTX.indexOf('const syncProjectToSupabase = useCallback'), CTX.indexOf('const flushPendingProjectSyncs = useCallback'));
  ok('syncProjectToSupabase records an immediate upsert in projectCreateWritesRef', /opts\?\.immediate && action === 'upsert'/.test(sync) && /projectCreateWritesRef\.current\.set\(project\.id/.test(sync));
  ok('…and settles it from the projects write when the run ends (synced / queued / failed)',
    /createLanded = landed;/.test(sync) && /if \(createLanded\) settleCreate\('synced'\);\s*else void queuedIdsFor\('projects'\)\.then\(\(q\) => settleCreate\(q\.has\(project\.id\) \? 'queued' : 'failed'\)/.test(sync));
  ok('addProject returns the create write\'s outcome', /return projectCreateWritesRef\.current\.get\(project\.id\) \?\?/.test(CTX) && /addProject: \(project: Project\) => Promise<WriteOutcome>;/.test(CTX));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#5 — money rows written while a read is out keep their device copy:');
{
  // touchedWrite, compiled from the provider's module scope (the whole
  // declaration: signature and body).
  const at = CTX.indexOf('async function touchedWrite<T>(');
  const sigEnd = at < 0 ? -1 : CTX.indexOf('): Promise<T> {', at);
  const body = sigEnd < 0 ? '' : balancedFrom(CTX, sigEnd + '): Promise<T> '.length, '{');
  const decl = sigEnd < 0 ? '' : `${CTX.slice(at, sigEnd)}): Promise<T> ${body}`;
  ok('touchedWrite is found', body.length > 0);
  type TW = (ref: { current: Map<string, { inFlight: number; settledAt: number }> }, id: string, send: () => Promise<unknown>) => Promise<unknown>;
  const touchedWrite = compile<TW>(`(() => { type WriteTouches = Map<string, { inFlight: number; settledAt: number }>; ${decl}; return touchedWrite; })()`, {});
  const touches = { current: new Map<string, { inFlight: number; settledAt: number }>() };
  const readStartedAt = Date.now() - 5;
  let land: () => void = () => undefined;
  const upsert = touchedWrite(touches, 'aia-1', () => new Promise<void>((r) => { land = r; }));
  const device = [{ id: 'aia-1', figures: 'corrected' }];
  const kept = deviceRowsWrittenDuringRead(touches.current, readStartedAt, device);
  const merged = mergeServerKeepingPending([{ id: 'aia-1', figures: 'pre-edit' }], device, kept.keep, { deletedIds: kept.gone });
  ok('a pay app whose upsert is on the wire keeps the corrected device copy through a re-read', merged.length === 1 && merged[0].figures === 'corrected', JSON.stringify(merged));
  const first = mergeServerKeepingPending([], device, kept.keep, { deletedIds: kept.gone });
  ok('a FIRST pay app whose upsert is on the wire survives an empty trusted read', first.length === 1);
  land();
  await upsert;
  const after = deviceRowsWrittenDuringRead(touches.current, readStartedAt, device);
  ok('…and still counts once settled after the read started', after.keep.has('aia-1'));
  const later = deviceRowsWrittenDuringRead(touches.current, Date.now() + 1000, device);
  ok('a read that starts after the write settled takes the server row', !later.keep.has('aia-1'));

  for (const [table, key] of [['invoices', 'Invoice'], ['commitments', 'Commitment'], ['aia_pay_apps', 'SavedAIAPayApp']] as const) {
    const from = CTX.indexOf(`.from('${table}').select('*')`);
    const start = CTX.lastIndexOf('queryFn: async () => {', from);
    const block = CTX.slice(start, CTX.indexOf('return loadLocal<', from));
    const readAt = block.indexOf('const readStartedAt = Date.now()');
    ok(`the ${table} loader takes readStartedAt BEFORE its SELECT`, readAt > 0 && readAt < block.indexOf(`.from('${table}')`));
    ok(`the ${table} loader keeps rows written during the read (deviceRowsWrittenDuringRead)`, /deviceRowsWrittenDuringRead\(proDocWriteTouchRef\.current, readStartedAt, prior/.test(block) && block.includes(`${key}[]`));
    // …and its merge USES both halves: the kept ids and the touched-but-gone ids.
    const touched = /const (touched\w+) = deviceRowsWrittenDuringRead\(/.exec(block)?.[1] ?? '';
    const mergeLine = block.split('\n').find((l) => /merge(?:LocalOnly|ServerKeepingPending)\(mapped,/.test(l)) ?? '';
    ok(`the ${table} merge keeps ${touched || '<touched>'}.keep and deletes ${touched || '<touched>'}.gone`,
      !!touched && mergeLine.includes(`...${touched}.keep`) && mergeLine.includes(`...${touched}.gone`), mergeLine.trim());
  }
  const invBlock = CTX.slice(CTX.indexOf(".from('invoices').select('*')"), CTX.indexOf('return loadLocal<Invoice[]>'));
  ok('the invoices loader keeps this device\'s INSERTs still reporting', invBlock.includes('...invoiceInsertsRef.current.keys()'));
  ok('addInvoice\'s INSERT is touched', /const insert = touchedWrite\(proDocWriteTouchRef, finalInvoice\.id, \(\) => supabaseWriteDetailed\('invoices', 'insert'/.test(CTX));
  ok('updateInvoice\'s write is touched for its whole life', /const invoiceWrite: Promise<boolean> = touchedWrite\(proDocWriteTouchRef, id, async \(\) => \{/.test(CTX));
  ok('addAIAPayApp\'s upsert is touched', /touchedWrite\(proDocWriteTouchRef, finalApp\.id, \(\) => supabaseWrite\('aia_pay_apps', 'upsert'/.test(CTX));
  ok('deleteAIAPayApp and the displaced de-dupe deletes are touched', (CTX.match(/touchedWrite\(proDocWriteTouchRef, (?:a\.id|id), \(\) => supabaseWrite\('aia_pay_apps', 'delete'/g) ?? []).length === 2);
  ok('commitment inserts (add + award), update and delete are touched',
    (CTX.match(/touchedWrite\(proDocWriteTouchRef, (?:c\.id|commitment\.id), \(\) => supabaseWrite\('commitments', 'insert'/g) ?? []).length === 2
    && /touchedWrite\(proDocWriteTouchRef, id, \(\) => updateBehindQueuedInsert\('commitments'/.test(CTX)
    && /touchedWrite\(proDocWriteTouchRef, id, \(\) => supabaseWrite\('commitments', 'delete'/.test(CTX));
  ok('no untracked aia_pay_apps / commitments write is left', !/void supabaseWrite\('(?:aia_pay_apps|commitments)'/.test(CTX));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#6 — a load for a signed-out account writes nothing and is not retried:');
{
  const clsAt = CTX.indexOf('class StaleAccountLoadError extends Error');
  const cls = clsAt < 0 ? '' : CTX.slice(clsAt, clsAt + 'class StaleAccountLoadError extends Error '.length) + balancedFrom(CTX, clsAt + 'class StaleAccountLoadError extends Error'.length, '{');
  const fnAt = CTX.indexOf('function retryUnlessStaleAccount(');
  const fnSigEnd = fnAt < 0 ? -1 : CTX.indexOf('): boolean {', fnAt);
  const fn = fnSigEnd < 0 ? '' : `${CTX.slice(fnAt, fnSigEnd)}): boolean ${balancedFrom(CTX, fnSigEnd + '): boolean '.length, '{')}`;
  let retry: ((n: number, e: unknown) => boolean) | null = null;
  let Stale: (new () => Error) | null = null;
  try {
    const out = compile<{ retryUnlessStaleAccount: (n: number, e: unknown) => boolean; StaleAccountLoadError: new () => Error }>(
      `(() => { ${cls}\n${fn}\nreturn { retryUnlessStaleAccount, StaleAccountLoadError }; })()`, {});
    retry = out.retryUnlessStaleAccount; Stale = out.StaleAccountLoadError;
  } catch (err) {
    ok('the retry rule compiles', false, String(err));
  }
  ok('a stale-account error is never retried', !!retry && !!Stale && retry(0, new Stale!()) === false);
  ok('any other error keeps the app-wide budget (2)', !!retry && retry(0, new Error('x')) && retry(1, new Error('x')) && !retry(2, new Error('x')));
  ok('…and the app-wide "Failed to fetch" rule it replaces (never retried)', !!retry && retry(0, new TypeError('Failed to fetch')) === false);

  const save = CTX.slice(CTX.indexOf('const saveOwnedLocal = async'), CTX.indexOf('const saveOwnedLocal = async') + 260);
  ok('saveOwnedLocal checks the live account BEFORE writing', /if \(liveUserIdRef\.current !== loadUserId\) throw new StaleAccountLoadError\(\);\s*\n\s*await saveLocal\(key, data\);/.test(save), save);

  // Every server-first child list query: no bare cache write, a rethrow past
  // its fallback, and the retry rule.
  const excluded = new Set(['projects', 'settings', 'onboarding', 'user_role']);
  const queries = [...CTX.matchAll(/useQuery\(\{\n\s*queryKey: \['([\w]+)', userId\]/g)];
  let checked = 0;
  for (const q of queries) {
    const key = q[1];
    if (excluded.has(key)) continue;
    const start = q.index ?? 0;
    const block = balancedFrom(CTX, start + 'useQuery'.length, '(');
    if (!/supabase\s*\.from\(/.test(block)) continue;
    checked++;
    const bare = /await saveLocal\(/.test(block);
    const rethrow = /catch \(err\) \{ if \(err instanceof StaleAccountLoadError\) throw err;/.test(block);
    const retries = block.includes('retry: retryUnlessStaleAccount');
    ok(`['${key}'] saves only through saveOwnedLocal, rethrows the stale error, never retries it`, !bare && rethrow && retries && block.includes('saveOwnedLocal(userId,'),
      `bare=${bare} rethrow=${rethrow} retry=${retries}`);
  }
  ok('every server-first child list was checked (≥ 28)', checked >= 28, `checked ${checked}`);
  const wr = CTX.slice(CTX.indexOf("from('warranties').select('*')"), CTX.indexOf("from('warranties').select('*')") + 4000);
  ok('the warranties effect writes its cache only for the live account', /if \(!cancelled && liveUserIdRef\.current === userId\) \{\s*\n\s*portalWarrantyBaseRef/.test(wr));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#8/#128 — "Leave project" counts exactly what leaving discards:');
{
  const queue: QueueEntryLike[] = [
    { table: 'daily_reports', operation: 'insert', data: { id: 'd1', project_id: 'job' } },
    { table: 'punch_items', operation: 'update', data: { id: 'p1', status: 'closed' } }, // no project_id: via the map
    { table: 'projects', operation: 'upsert', data: { id: 'job' } },
    { table: 'daily_reports', operation: 'insert', data: { id: 'd2', project_id: 'other' } },
    { table: 'punch_items', operation: 'update', data: { id: 'p9' } }, // unknown row
  ];
  const map = childProjectMap([[{ id: 'p1', projectId: 'job' }, { id: 'p2', projectId: 'other' }]], new Set(['job']));
  const n = countQueuedEntriesForProject(queue, 'job', map);
  const sweep = queue.filter((e) => queuedEntryRevokedProject(e, new Set(['job']), map) === 'job').length;
  ok('child UPDATEs tie to the job through the record map (3 entries)', n === 3, `got ${n}`);
  ok('the count equals what the sweep\'s matcher discards', n === sweep);
  ok('an empty project id counts nothing', countQueuedEntriesForProject(queue, '', map) === 0);
  const cq = CTX.slice(CTX.indexOf('const countQueuedForProject = useCallback'), CTX.indexOf('const forgetSharedProject = useCallback'));
  ok('countQueuedForProject reads THIS session\'s queue, the same map, and the photo queue',
    cq.includes('getOwnOfflineQueue()') && cq.includes('childProjectMapFromListsAndCaches(') && cq.includes('countQueuedPhotoUploadsForProject(projectId)') && cq.includes('countQueuedEntriesForProject('));
  const sw = CTX.slice(CTX.indexOf('const sweepRevokedJobs = ('), CTX.indexOf('const countQueuedForProject = useCallback'));
  ok('the leave / revocation sweep drops the job\'s queued photos too', /discardQueuedPhotoUploads\(\(t\) => \(t\.projectId && ids\.has\(t\.projectId\)/.test(sw));
  // Integration round 2: plus the job's Not-saved lines, noted.
  ok('…and counts them in what it reports (writes + unsaved + photos)', /photos = await discardQueuedPhotoUploads\(/.test(sw) && /return writes \+ unsaved \+ photos;/.test(sw));
  const fs = CTX.slice(CTX.indexOf('const forgetSharedProject = useCallback'), CTX.indexOf('const forgetSharedProject = useCallback') + 2200);
  ok('forgetSharedProject hands back how many changes went', /return \{ ok: true, dropped \};/.test(fs));
  ok('countQueuedForProject replaces the PRE-STEP stub on the stable actions', /\n\s*countQueuedForProject,\n/.test(CTX) && !CTX.includes('countQueuedForProjectStub'));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#111/#130 — projectsFetching is real:');
{
  ok('projectsFetching reads the projects query', /projectsFetching: projectsQuery\.isFetching,/.test(CTX));
  ok('…and the core memo re-renders on it', /projectsQuery\.isLoading, projectsQuery\.isFetching,/.test(CTX));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#86 — a live copy carries the active baseline:');
{
  type B = { id: string };
  const store = { baselines: [{ id: 'v1' }] as B[], activeBaselineId: 'v1' };
  const m = absorbedScheduleMeta<B>(store, { baselines: [{ id: 'v1' }, { id: 'v2' }], activeBaselineId: 'v2' }, true);
  ok('a whole absorb takes the copy\'s baselines AND its active id', m.baselines?.length === 2 && m.activeBaselineId === 'v2');
  const held = absorbedScheduleMeta<B>(store, { baselines: [{ id: 'v1' }, { id: 'v2' }], activeBaselineId: 'v2' }, false);
  ok('with a local write unconfirmed, the phone keeps its own (a pending lock survives a peer echo)', held.activeBaselineId === 'v1' && held.baselines?.length === 1);
  ok('null clears the active baseline', absorbedScheduleMeta<B>(store, { activeBaselineId: null }, true).activeBaselineId === undefined);
  ok('an absent key leaves it', absorbedScheduleMeta<B>(store, { baselines: [{ id: 'v1' }] }, true).activeBaselineId === 'v1');
  ok('a copy without the baselines key keeps the stored baselines (older event shape)', absorbedScheduleMeta<B>(store, { activeBaselineId: 'v1' }, true).baselines === store.baselines);
  // The regression the finding describes: absorb, then the next save.
  const existing = { tasks: [], baselines: store.baselines, activeBaselineId: 'v1', updatedAt: 'a' } as unknown as ProjectSchedule;
  const absorbed = withActiveBaselineId({ ...existing, baselines: m.baselines } as ProjectSchedule, m.activeBaselineId);
  const saved = mergeEditedSchedule(absorbed, { ...absorbed, tasks: [] } as ProjectSchedule) as ProjectSchedule & { activeBaselineId?: string; baselines?: B[] };
  ok('the phone\'s next save keeps [v1, v2] and v2 (v2 is no longer deleted on the server)', saved.baselines?.length === 2 && saved.activeBaselineId === 'v2', JSON.stringify({ b: saved.baselines, a: saved.activeBaselineId }));
  const cleared = withActiveBaselineId({ ...existing } as ProjectSchedule, absorbedScheduleMeta<B>(store, { activeBaselineId: null }, true).activeBaselineId) as ProjectSchedule & { activeBaselineId?: string };
  ok('a cleared id removes the key', !Object.prototype.hasOwnProperty.call(cleared, 'activeBaselineId'));
  const abs = CTX.slice(CTX.indexOf('const absorbServerSchedule = useCallback'), CTX.indexOf('const absorbServerSchedule = useCallback') + 3500);
  ok('absorbServerSchedule applies it through withActiveBaselineId', /withActiveBaselineId\(\{ \.\.\.x\.schedule, tasks: next, updatedAt: stamp, baselines \}, meta\.activeBaselineId\)/.test(abs));
  ok('its no-change check compares the active id', /meta\.activeBaselineId === p\.schedule\.activeBaselineId\) return;/.test(abs));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#32 — batch RFIs / submittals go out one at a time, in order:');
{
  const src = callbackSource('sendNumberedInsertsInOrder');
  ok('sendNumberedInsertsInOrder is found', src.length > 0);
  // utils/offlineQueue orders numbered creates of one project (a per-project
  // slot; validate-w4-sync-queue-ordering pins that side). This side must
  // hand every row over in creation order, in the same tick — so every row's
  // own slot is held at once and no edit of a later row can overtake it.
  type SN = (table: string, rows: Record<string, unknown>[]) => void;
  const log: string[] = [];
  const fn = compile<SN>(src, {
    proDocWriteTouchRef: { current: new Map() },
    touchedWrite: (_r: unknown, _id: string, send: () => Promise<string>) => send(),
    supabaseWrite: (_t: string, op: string, row: Record<string, unknown>) => { log.push(`${op}:${row.id}`); return new Promise<boolean>(() => undefined); },
  });
  fn('submittals', [{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }]);
  ok('every row is handed to the ordered writer in creation order, in this tick', log.join(',') === 'insert:s1,insert:s2,insert:s3,insert:s4', log.join(','));
  ok('addRFIs and addSubmittals use it', (CTX.match(/if \(canSync\) sendNumberedInsertsInOrder\('(?:rfis|submittals)', rows\)/g) ?? []).length === 2);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#23/#24 — deletes and queued review cycles are ordered and read the refs:');
{
  const drfi = callbackSource('deleteRFI');
  const dsub = callbackSource('deleteSubmittal');
  ok('deleteRFI reads rfisRef (not the render\'s list) and its write is touched', drfi.includes('rfisRef.current.filter') && drfi.includes("touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('rfis', 'delete'"));
  ok('deleteSubmittal reads submittalsRef and its write is touched', dsub.includes('submittalsRef.current.filter') && dsub.includes("touchedWrite(proDocWriteTouchRef, id, () => supabaseWrite('submittals', 'delete'"));
  const rc = callbackSource('addReviewCycle');
  ok('a cycle for a submittal whose INSERT is queued is appended to the queue itself', /if \(hold\) return viaQueue\(true, hold\);/.test(rc) && /if \(enqueue\) void addToOfflineQueue\(\{ table: 'submittals', operation: 'update', data: cyclePatch \}\)/.test(rc));
  // context-records #29: the hold is INSERT-or-cycle-patch (submittalCycleQueueHold), still defaulting to 'insert'.
  ok('an unreadable queue counts as holding the INSERT', /let hold: 'insert' \| 'cycle_patch' \| null = 'insert';\s*try \{ hold = submittalCycleQueueHold\(await getOfflineQueue\(\), submittalId\); \} catch \{/.test(rc));
  const sp = callbackSource('sendProDocPatch');
  ok('sendProDocPatch adopts the server stamp only on \'synced\'', /if \(outcome === 'synced'\) void adoptProDocStamp/.test(sp));
}

console.log(`\nvalidate-w4-context-core-loaders: ${failed === 0 ? 'OK' : 'FAILED'} — ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
