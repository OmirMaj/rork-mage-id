// scripts/validate-w4-punch-gc-fixes.ts — wave 4, lane punch-gc.
//
//   #51  a sub's "Mark fixed" sweep: WHICH item (description, room, his note),
//        one push per sub per ~10 minutes ("and N more"), and the tap opens
//        the item (punch_item_id → itemId).
//   #54  the tap re-reads the punch list and says "Refreshing…" until it
//        settles; pull-to-refresh re-reads it too.
//   #56  punch-walk saves '' — never 'Unspecified'; the list words it.
//   #57  the export carries the sub's note (validate-punch-export runs it).
//   #127 the punch-list gate: invited free-plan foreman gets in; loading /
//        error / paused / missing instead of a Business paywall.
//   HANDOFF (punch-sub-portal, CONTRACT 12): every move out of Review back to
//        work stamps rejectedAt + a note; the rejection box rule.
//
// Pure rules (utils/punchGcCore, the notify text block, the coalescing block
// with stubbed I/O) are EXECUTED; screen wiring is pinned on comment-stripped
// source.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  punchStatusPatch, punchRejectionBox, punchLocationText, invitedPunchProjects,
  punchGateAnswer, punchFocusFor, isPunchReject, PUNCH_REJECT_DEFAULT_NOTE, PUNCH_NO_ROOM_TEXT,
  punchFocusStep, punchItemFromQueryCache, punchItemsQueryKey, type PunchFocusApplied,
} from '../utils/punchGcCore';
import type { PunchItem } from '../types';
import { QueryClient, QueryObserver } from '@tanstack/query-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
const between = (src: string, a: string, b: string) => {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = src.indexOf(b, i + a.length);
  return j < 0 ? src.slice(i) : src.slice(i, j);
};

const NOW = '2026-09-19T15:00:00.000Z';

console.log('\nHANDOFF (CONTRACT 12): a move out of Review is a reject that stamps rejectedAt');
{
  const r = punchStatusPatch({ status: 'ready_for_review' }, 'open', NOW, '  wrong outlet  ');
  ok('Review → Open stamps rejectedAt = now', r.rejectedAt === NOW, JSON.stringify(r));
  ok('...with the typed note, trimmed', r.rejectionNote === 'wrong outlet');
  ok('...and the status named', r.status === 'open');
  const d = punchStatusPatch({ status: 'ready_for_review' }, 'in_progress', NOW);
  ok('Review → In progress is a reject too, with the default note the portal reads as "no reason given"',
    d.rejectedAt === NOW && d.rejectionNote === PUNCH_REJECT_DEFAULT_NOTE && PUNCH_REJECT_DEFAULT_NOTE === 'Rejected — needs rework');
  const start = punchStatusPatch({ status: 'open' }, 'in_progress', NOW);
  ok('Start (Open → In progress) is NOT a reject: no rejectedAt, no note', !('rejectedAt' in start) && !('rejectionNote' in start) && start.status === 'in_progress');
  const close = punchStatusPatch({ status: 'ready_for_review' }, 'closed', NOW);
  ok('Close stamps closedAt and never rejectedAt', close.closedAt === NOW && !('rejectedAt' in close) && close.status === 'closed');
  const reopen = punchStatusPatch({ status: 'closed' }, 'open', NOW);
  ok('reopening a CLOSED item is not a reject (the trigger only guards Review)', !('rejectedAt' in reopen));
  ok('isPunchReject matrix', isPunchReject('ready_for_review', 'open') && isPunchReject('ready_for_review', 'in_progress')
    && !isPunchReject('ready_for_review', 'closed') && !isPunchReject('in_progress', 'open') && !isPunchReject(undefined, 'open'));
}

console.log('\nthe rejection-box rule');
{
  ok('red while the item is back on the sub (open)', punchRejectionBox({ status: 'open', rejectionNote: 'redo' })?.tone === 'active');
  ok('red while in progress', punchRejectionBox({ status: 'in_progress', rejectionNote: 'redo' })?.tone === 'active');
  const h = punchRejectionBox({ status: 'ready_for_review', rejectionNote: 'redo' });
  ok('muted "Previously returned: …" once he marked it fixed again', h?.tone === 'history' && h.text === 'Previously returned: redo', JSON.stringify(h));
  ok('muted on a closed item too', punchRejectionBox({ status: 'closed', rejectionNote: 'redo' })?.tone === 'history');
  ok('nothing without a note', punchRejectionBox({ status: 'open', rejectionNote: '  ' }) === null);
}

console.log('\n#56 no room given');
{
  ok("'' is no room", punchLocationText('') === null && punchLocationText(undefined) === null);
  ok("the legacy 'Unspecified' placeholder is no room (any case)", punchLocationText('Unspecified') === null && punchLocationText(' unspecified ') === null);
  ok('a real room passes through, whitespace collapsed', punchLocationText('  Unit  4B ') === 'Unit 4B');
  ok('the words are "No room given"', PUNCH_NO_ROOM_TEXT === 'No room given');
  const walk = strip(read('app/punch-walk.tsx'));
  ok('punch-walk saves the trimmed room, never a placeholder', /location: draft\.location\.trim\(\),/.test(walk) && !/'Unspecified'/.test(walk));
  ok('punch-walk no longer tells him it "files under Unspecified"', !/Unspecified/.test(walk));
  const pl = strip(read('app/punch-list.tsx'));
  ok("the list folds legacy 'Unspecified' items into no room (one group, no room chip)",
    /getPunchItemsForProject\(projectId \?\? ''\)\.map\(i => \(\s*i\.location && punchLocationText\(i\.location\) === null \? \{ \.\.\.i, location: '' \} : i\s*\)\)/.test(pl));
  ok('one wording on the list: the unplaced header, the chip and the filter summary say PUNCH_NO_ROOM_TEXT',
    /label: section\.isUnplaced \? PUNCH_NO_ROOM_TEXT : section\.label,/.test(pl)
    && /if \(filterLocationKey === UNPLACED_LOCATION_GROUP\) return PUNCH_NO_ROOM_TEXT;/.test(pl)
    && /\{PUNCH_NO_ROOM_TEXT\} \(\{unplacedCount\}\)/.test(pl)
    && !/No location given|No location \(/.test(pl));
}

console.log('\n#127 the punch-list gate');
{
  const base = { projectId: undefined as string | undefined, ownTier: false, projectAllowed: false, invitedCount: 0, role: null, isLoading: false, isError: false, isPaused: false };
  ok('no project, his own Business tier → in', punchGateAnswer({ ...base, ownTier: true }) === 'allow');
  ok('no project, free tier, invited to one job → in (the picker lists that job)', punchGateAnswer({ ...base, invitedCount: 1 }) === 'allow');
  ok('no project, free tier, no invites → paywall (his own plan is the answer)', punchGateAnswer(base) === 'paywall');
  const job = { ...base, projectId: 'p1' };
  ok('a project he may open → in', punchGateAnswer({ ...job, projectAllowed: true, role: 'field' }) === 'allow');
  ok('role read in flight → loading, never a paywall', punchGateAnswer({ ...job, isLoading: true }) === 'loading');
  ok('role read failed → error (retry)', punchGateAnswer({ ...job, isError: true }) === 'error');
  ok('offline, no role on the phone, with a reason → paused', punchGateAnswer({ ...job, isPaused: true, reason: 'not on this phone' }) === 'paused');
  ok('settled null role → missing ("ask the owner to invite you")', punchGateAnswer(job) === 'missing');
  ok('a settled role the grant does not cover (canAccess said no) → paywall', punchGateAnswer({ ...job, role: 'viewer' }) === 'paywall');
  const projects = [{ id: 'a', myRole: 'field' }, { id: 'b', myRole: 'editor' }, { id: 'c', myRole: 'viewer' }, { id: 'd', myRole: 'owner' }, { id: 'e' }] as { id: string; myRole?: string }[];
  const inv = invitedPunchProjects(projects as never[]) as unknown as { id: string }[];
  // FEATURE_ROLES leaves punch open to every collaborator seat (editor,
  // viewer, field) — never the owner's own job, which his own tier decides.
  ok('invited jobs = his collaborator seats (never his own, never a job with no seat)', inv.map(p => p.id).join(',') === 'a,b,c', inv.map(p => p.id).join(','));

  const list = strip(read('app/punch-list.tsx'));
  const screen = between(list, 'export default function PunchListScreen()', 'function PunchGateView(');
  ok('the screen gate runs punchGateAnswer with the role state, and its answer decides',
    /const answer = punchGateAnswer\(\{[\s\S]{0,120}invitedCount: invited\.length,\s+role: roleState\.role,\s+isLoading: roleState\.isLoading,\s+isError: roleState\.isError,\s+isPaused: roleState\.isPaused,/.test(screen)
    && /if \(answer === 'allow'\) return <PunchListScreenInner ownTier=\{ownTier\} \/>;/.test(screen)
    && /useProjectRoleState\(gateProjectId\)/.test(screen));
  ok('the paywall tier is derived (requiredTierFor), never typed "business"', /requiredTier=\{requiredTierFor\('punch_list_closeout'\)\}/.test(screen) && !/requiredTier="business"/.test(screen));
  ok('loading / error / paused / missing render the gate view, not the paywall', /<PunchGateView state=\{answer\}/.test(screen));
  ok('the Try again button refetches the role', /roleState\.refetch\(\)/.test(screen));
  ok('the picker is limited to the invited jobs without his own tier', /ownTier \? projects : invitedPunchProjects\(projects\)/.test(list) && /projects=\{pickableProjects\}/.test(list));
}

console.log('\n#51/#54 opening the item from a notification');
{
  const list = strip(read('app/punch-list.tsx'));
  ok('punch-list reads the itemId param', /itemId: focusItemId \} = useLocalSearchParams<\{[\s\S]*?itemId\?: string;/.test(list));
  ok('the tap re-reads the signed-in user\'s punch query (exact key) and says Refreshing… until it settles',
    /invalidateQueries\(\{ queryKey: punchKey, exact: true \}\)[\s\S]{0,200}\.finally\(\(\) => \{\s*if \(!live\) return;[\s\S]{0,260}setRefreshState\('done'\);/.test(list)
    && /Refreshing…/.test(list));
  ok('offline (a paused read) is said, not spun', /fetchStatus === 'paused'/.test(list) && /No signal/.test(list));
  // The reviewer's repro: the status must come from the SETTLED query cache,
  // not from the provider's mirror (one render behind when the read settles).
  ok('when the read settles, the fresh item is taken from the signed-in user\'s query ONLY',
    /setFreshFocus\(punchItemFromQueryCache\(queryClient\.getQueryData\(punchKey\), focusItemId, projectId \?\? ''\)\);\s*setRefreshState\('done'\);/.test(list));
  // Review round 2: a launch-time ['punchItems', null] entry lingers inactive
  // (never refetched) and a prefix-wide read met it first. The key must be the
  // provider's own expression, and no punch read on this screen's focus path
  // may be prefix-wide.
  ok('the focus key is the provider\'s key for the signed-in user, and re-runs the focus when auth resolves',
    /const punchKey = useMemo\(\(\) => punchItemsQueryKey\(user\?\.id\), \[user\?\.id\]\);/.test(list)
    && /\}, \[focusItemId, queryClient, projectId, focusNonce, punchKey\]\);/.test(list));
  ok('the pause check looks at the same exact query', /findAll\(\{ queryKey: punchKey, exact: true \}\)[\s\S]{0,80}fetchStatus === 'paused'/.test(list));
  ok('no prefix-wide getQueriesData read of punchItems on the screen', !/getQueriesData\(/.test(list));
  {
    const ctx = strip(read('contexts/ProjectContext.tsx'));
    ok('the provider still keys its punch query [\'punchItems\', userId] with userId = user?.id ?? null',
      /queryKey: \['punchItems', userId\],/.test(ctx) && /const userId = user\?\.id \?\? null;/.test(ctx));
    ok('punchItemsQueryKey mirrors it', JSON.stringify(punchItemsQueryKey(undefined)) === '["punchItems",null]'
      && JSON.stringify(punchItemsQueryKey(null)) === '["punchItems",null]' && JSON.stringify(punchItemsQueryKey('u1')) === '["punchItems","u1"]');
  }
  ok('the focus runs through punchFocusStep with the fresh item and the phone copy',
    /const step = punchFocusStep\(\{\s*phase: refreshState,\s*loaded: punchItemsLoaded,\s*applied: focusAppliedRef\.current,\s*view: \{ list: activeList, status: filterStatus \},\s*fresh: freshFocus,\s*phoneItem: allItems\.find\(i => i\.id === focusItemId\),\s*\}\);/.test(list));
  ok('focus switches to the step\'s list and status, clearing filters that could hide it',
    /setActiveList\(step\.list\);[\s\S]{0,200}setFilterStatus\(step\.status\);[\s\S]{0,80}setFilterSub\(''\);/.test(list));
  ok('the old one-shot snapshot focus is gone', !/punchFocusFor\(item\)/.test(list) && !/setFilterStatus\(plan\.status\)/.test(list));
  ok('the banner has a real Refresh / Try again control (pull-to-refresh does nothing on web)',
    /<Button\s+label=\{refreshState === 'offline' \? 'Try again' : 'Refresh'\}[\s\S]{0,120}onPress=\{retryFocus\}/.test(list)
    && /const retryFocus = useCallback\(\(\) => setFocusNonce\(n => n \+ 1\), \[\]\);/.test(list)
    && /\}, \[focusItemId, queryClient, projectId, focusNonce, punchKey\]\);/.test(list));
  ok('no copy tells him to "pull down"', !/[Pp]ull down/.test(list));
  ok('the remembered list cannot land late and hide it', /if \(!focusListLockRef\.current\) setActiveList\(stored\.list\);/.test(list));
  ok('scrolls to the row and marks it', /scrollToIndex\(\{ index/.test(list) && /focused && styles\.punchCardFocused/.test(list));
  ok('an item no longer there is said ("isn’t on this punch list")', /isn’t on this punch list/.test(list));
  ok('pull-to-refresh re-reads the list', /refreshControl=\{<RefreshControl refreshing=\{pullRefreshing\} onRefresh=\{onPullRefresh\}/.test(list));
  const focus = punchFocusFor({ id: 'x', status: 'ready_for_review', listType: 'crew' } as PunchItem);
  ok('punchFocusFor: the item\'s own list and status', focus?.list === 'crew' && focus.status === 'ready_for_review');
  ok('punchFocusFor: nothing to focus → null', punchFocusFor(undefined) === null);

  // punchFocusStep — the rule, executed.
  const it = (status: PunchItem['status'], extra: Partial<PunchItem> = {}) => ({ id: 'x', projectId: 'p1', status, ...extra }) as PunchItem;
  const view = { list: 'punch' as const, status: 'all' as const };
  const S = (o: Partial<Parameters<typeof punchFocusStep>[0]>) => punchFocusStep({ phase: 'done', loaded: true, applied: null, view, fresh: null, phoneItem: undefined, ...o });
  ok('step: nothing is chosen while the read is in flight', S({ phase: 'refreshing', phoneItem: it('open') }).kind === 'none');
  ok('step: nothing before the list has loaded', S({ loaded: false, phoneItem: it('open') }).kind === 'none');
  const repro = S({ fresh: { known: true, item: it('ready_for_review') }, phoneItem: it('open') });
  ok('step (the repro): the phone copy says Open, the settled read says Review → filter to Review',
    repro.kind === 'apply' && repro.status === 'ready_for_review' && repro.from === 'fresh', JSON.stringify(repro));
  const off = S({ phase: 'offline', phoneItem: it('open') });
  ok('step: offline focuses on the phone copy', off.kind === 'apply' && off.status === 'open' && off.from === 'phone');
  const phoneApplied: PunchFocusApplied = { from: 'phone', list: 'punch', status: 'open' };
  ok('step: offline does not re-apply', S({ phase: 'offline', applied: phoneApplied, view: { list: 'punch', status: 'open' }, phoneItem: it('open') }).kind === 'none');
  const reaim = S({ applied: phoneApplied, view: { list: 'punch', status: 'open' }, fresh: { known: true, item: it('ready_for_review') }, phoneItem: it('open') });
  ok('step: signal back → the phone-copy focus is re-aimed at the fresh status', reaim.kind === 'apply' && reaim.status === 'ready_for_review');
  ok('step: ...unless he changed the filter himself since (his answer stands)',
    S({ applied: phoneApplied, view: { list: 'punch', status: 'all' }, fresh: { known: true, item: it('ready_for_review') } }).kind === 'settle');
  ok('step: a fresh focus is final (his later filter taps are never yanked back)',
    S({ applied: { from: 'fresh', list: 'punch', status: 'ready_for_review' }, view, fresh: { known: true, item: it('closed') } }).kind === 'none');
  ok('step: the settled read has no such item → missing (even if the phone copy still has it)',
    S({ fresh: { known: true }, phoneItem: it('open') }).kind === 'missing');
  ok('step: phone-copy missing, then the read finds it → applied', S({ applied: { from: 'phone', missing: true }, fresh: { known: true, item: it('ready_for_review') } }).kind === 'apply');
  ok('step: a cache with no data at all falls back to the phone copy', (() => { const r = S({ fresh: { known: false }, phoneItem: it('in_progress') }); return r.kind === 'apply' && r.status === 'in_progress'; })());
  const crew = S({ fresh: { known: true, item: it('ready_for_review', { listType: 'crew' }) } });
  ok('step: the item\'s own list', crew.kind === 'apply' && crew.list === 'crew');

  // punchItemFromQueryCache — one query's data, never a scan of several
  const data = [it('open', { id: 'y' }), it('ready_for_review')];
  ok('cache lookup: finds the item in the query\'s data', punchItemFromQueryCache(data, 'x', 'p1').item?.status === 'ready_for_review');
  ok('cache lookup: an item from another job is not here', (() => { const r = punchItemFromQueryCache(data, 'x', 'p2'); return r.known && !r.item; })());
  ok('cache lookup: an array without the item is known-but-missing', (() => { const r = punchItemFromQueryCache(data, 'zz', 'p1'); return r.known && !r.item; })());
  ok('cache lookup: no data → known false', !punchItemFromQueryCache(undefined, 'x', 'p1').known);

  // The row rail on a Review item: Close / Reject, never Start.
  const row = between(list, 'const PunchRow = React.memo', 'const NO_SESSION_IDS');
  ok('a Review row offers Close and Reject; Start only on Open', /item\.status === 'open' && \([\s\S]{0,300}>Start</.test(row)
    && /item\.status === 'ready_for_review' && \([\s\S]{0,700}>Close<[\s\S]{0,500}>Reject</.test(row));
  ok('rows word an empty room', /PUNCH_NO_ROOM_TEXT/.test(row) && /punchLocationText\(item\.location\)/.test(row));
  ok('rows apply the rejection-box rule', /punchRejectionBox\(item\)/.test(row) && /rejection\.tone === 'active'/.test(row));

  const reject = between(list, 'const handleReject = useCallback', '}, [rejectionNote');
  ok('the Reject modal writes through punchStatusPatch with his note (rejectedAt stamped)',
    // Integration round 2 (field): the item's previous rejectedAt rides along so
    // the new stamp is later than it (punchRejectStamp).
    /punchStatusPatch\(\{ status: item\?\.status \?\? 'ready_for_review', rejectedAt: item\?\.rejectedAt \}, 'open', new Date\(\)\.toISOString\(\), rejectionNote\)/.test(reject));
  const bulk = between(list, 'const bulkSetStatus = useCallback', 'const bulkMove = useCallback');
  ok('bulk status: Review items moved back are written as rejects, the rest as a plain move',
    /isPunchReject\(i\.status, next\)/.test(bulk) && /updatePunchItems\(rejects, punchStatusPatch\(\{ status: 'ready_for_review', rejectedAt: latestRejectedAt\(rejectItems\) \}, next, nowIso\)\)/.test(bulk));
  ok('bulk status: sending marked-fixed work back asks first', /Send \$\{n\} item/.test(bulk) && /onPress: run/.test(bulk));
}

console.log('\n#51 notify: which item, coalesced, the tap opens it');
{
  const NOTIFY = read('supabase/functions/notify/index.ts');
  type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
  const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
  const blk = (m: string) => {
    const a = NOTIFY.indexOf(`// >>> ${m}`); const b = NOTIFY.indexOf(`// <<< ${m}`);
    ok(`notify carries the ${m} block`, a > -1 && b > a);
    return a > -1 && b > a ? NOTIFY.slice(a, b) : '';
  };
  const js = (ts: string) => new Transpiler({ loader: 'ts' }).transformSync(ts.replace(/^export /gm, ''));
  type Text = { pushBody: string; emailSubject: string; title: string; rows: [string, string, boolean?][]; ctaLabel: string } | null;
  const T = new Function(`${js(blk('notify-format') + '\n' + blk('wave3-notify-text'))}\nreturn wave3NotifyText;`)() as (e: string, p: Record<string, unknown>, n: string) => Text;
  const t = T('punch_marked_ready', { sub_name: 'Rivera Drywall', description: 'Outlet cover cracked', location: 'Unit 4B', sub_note: 'Replaced, see closet side' }, 'Watermark 9F');
  ok('push names the item and the room', t?.pushBody === 'Rivera Drywall marked “Outlet cover cracked” (Unit 4B) ready for your review.', t?.pushBody);
  ok('email rows: From / Item / Location / Sub’s note', JSON.stringify(t?.rows.map(r => r[0])) === JSON.stringify(['From', 'Item', 'Location', 'Sub’s note']), JSON.stringify(t?.rows));
  ok('the subject names the item', /marked “Outlet cover cracked” ready · Watermark 9F/.test(t?.emailSubject ?? ''));
  const nr = T('punch_marked_ready', { sub_name: 'Rivera', description: 'x' }, 'J');
  ok('no room → "No room given" in the email, nothing invented in the push', nr?.rows.find(r => r[0] === 'Location')?.[1] === 'No room given' && !/\(/.test(nr?.pushBody ?? ''));
  const long = T('punch_marked_ready', { sub_name: 'R', description: 'a'.repeat(300), sub_note: 'b'.repeat(900) }, 'J');
  ok('description and note are clipped', (long?.rows.find(r => r[0] === 'Item')?.[1].length ?? 999) <= 80 && (long?.rows.find(r => r[0] === 'Sub’s note')?.[1].length ?? 999) <= 200);
  const more = T('punch_marked_ready', { sub_name: 'Rivera', description: 'x', more_count: 11 }, 'J');
  ok('the next loud alert says "and N more"', /And 11 more from Rivera since the last alert/.test(more?.pushBody ?? '') && !!more?.rows.find(r => r[1] === '11 more'), more?.pushBody);
  const bare = T('punch_marked_ready', { sub_name: 'Rivera' }, 'J');
  ok('an older payload with no description still reads', bare?.pushBody === 'Rivera marked a punch item ready for your review.', bare?.pushBody);
  ok('the rows are escaped where they meet HTML (dispatch)', /emailStatRow\(k, escapeHtml\(v\)/.test(NOTIFY));

  // Coalescing, with the rate counter and the outbox read stubbed.
  const coalesceSrc = js(blk('punch-ready-coalesce'));
  type Co = (gc: string, pid: string | null, p: Record<string, unknown>) => Promise<{ quiet: boolean; more: number }>;
  const make = (limit: (scope: string) => boolean, rows: (path: string) => unknown) => {
    const scopes: string[] = []; const paths: string[] = [];
    const fn = new Function('exceedsRateLimit', 'sbGet', `${coalesceSrc}\nreturn punchReadyCoalesce;`)(
      async (scope: string, cap: number) => { scopes.push(`${scope}|${cap}`); return limit(scope); },
      async (path: string) => { paths.push(path); return rows(path); },
    ) as Co;
    return { fn, scopes, paths };
  };
  void (async () => {
    // The reviewer's ordering, with the installed @tanstack/query-core: a
    // provider that mirrors the query into its own state one render later
    // (here: a macrotask after the observer hears the data), and the screen's
    // invalidate().finally. At .finally the mirror is still the launch copy;
    // the cache is already fresh — and the focus must be chosen from it.
    {
      let serverStatus: PunchItem['status'] = 'open';
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const obs = new QueryObserver(qc, {
        queryKey: ['punchItems', 'u1'],
        queryFn: async () => [({ id: 'x', projectId: 'p1', status: serverStatus }) as PunchItem],
      });
      let mirror: PunchItem[] = [];
      const unsub = obs.subscribe(r => { const d = r.data; if (d) setTimeout(() => { mirror = d; }, 0); });
      await obs.refetch();
      await new Promise(r => setTimeout(r, 5));
      ok('ordering setup: the phone copy says Open', mirror[0]?.status === 'open');
      serverStatus = 'ready_for_review'; // the sub marks it fixed
      let atDone: { phone?: PunchItem; fresh?: { known: boolean; item?: PunchItem } } = {};
      await qc.invalidateQueries({ queryKey: ['punchItems'] }).finally(() => {
        atDone = { phone: mirror.find(i => i.id === 'x'), fresh: punchItemFromQueryCache(qc.getQueryData(punchItemsQueryKey('u1')), 'x', 'p1') };
      });
      ok('ordering: at .finally the mirror is STILL the launch copy (the bug condition)', atDone.phone?.status === 'open', atDone.phone?.status);
      const oldPlan = punchFocusFor(atDone.phone);
      const step = punchFocusStep({ phase: 'done', loaded: true, applied: null, view: { list: 'punch', status: 'all' }, fresh: atDone.fresh ?? null, phoneItem: atDone.phone });
      await new Promise(r => setTimeout(r, 5)); // the mirror catches up
      const visibleUnder = (status: string | undefined) => mirror.filter(i => i.status === status).some(i => i.id === 'x');
      ok('ordering: the OLD snapshot rule would filter to Open and hide the item', oldPlan?.status === 'open' && !visibleUnder(oldPlan?.status));
      ok('ordering: the step filters to Review and the focused row stays visible once the list catches up',
        step.kind === 'apply' && step.status === 'ready_for_review' && visibleUnder(step.kind === 'apply' ? step.status : undefined), JSON.stringify(step));
      unsub();
      qc.clear();
    }

    // Review round 2, the cold-start tap: the provider rendered once before
    // auth resolved, so a ['punchItems', null] query loaded the phone copy
    // (Open) and now sits INACTIVE in the cache (gcTime 5 min). invalidate
    // never refetches it, and it iterates before the signed-in user's entry.
    // Driven with the installed @tanstack/query-core, the same calls the
    // screen makes: exact invalidate + getQueryData(punchItemsQueryKey(uid)).
    {
      let serverStatus: PunchItem['status'] = 'open';
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 300_000 } } });
      const phone = [({ id: 'x', projectId: 'p1', status: 'open' }) as PunchItem];
      const nullObs = new QueryObserver(qc, { queryKey: punchItemsQueryKey(null), queryFn: async () => phone });
      const unNull = nullObs.subscribe(() => {});
      await nullObs.refetch();
      unNull(); // auth resolved: the provider now observes the user's key instead
      const userObs = new QueryObserver(qc, {
        queryKey: punchItemsQueryKey('u1'),
        queryFn: async () => [({ id: 'x', projectId: 'p1', status: serverStatus }) as PunchItem],
      });
      const unUser = userObs.subscribe(() => {});
      await userObs.refetch();
      serverStatus = 'ready_for_review'; // the sub marks it fixed; the push arrives
      let fresh: { known: boolean; item?: PunchItem } | undefined;
      let oldScan: PunchItem | undefined;
      await qc.invalidateQueries({ queryKey: punchItemsQueryKey('u1'), exact: true }).finally(() => {
        fresh = punchItemFromQueryCache(qc.getQueryData(punchItemsQueryKey('u1')), 'x', 'p1');
        // The round-1 lookup: first hit across every ['punchItems', *] entry.
        for (const [, d] of qc.getQueriesData<PunchItem[]>({ queryKey: ['punchItems'] })) {
          const hit = Array.isArray(d) ? d.find(p => p.id === 'x') : undefined;
          if (hit) { oldScan = hit; break; }
        }
      });
      const keys = qc.getQueriesData({ queryKey: ['punchItems'] }).map(([k]) => JSON.stringify(k));
      ok('stale sibling setup: the null-key entry is cached, inactive and sits AHEAD of the user\'s entry',
        keys[0] === '["punchItems",null]' && keys[1] === '["punchItems","u1"]'
        && qc.getQueryCache().find({ queryKey: punchItemsQueryKey(null), exact: true })?.isActive() === false, keys.join(' '));
      ok('stale sibling: the round-1 prefix scan answers Open (the reviewer\'s bug)', oldScan?.status === 'open', oldScan?.status);
      const step = punchFocusStep({ phase: 'done', loaded: true, applied: null, view: { list: 'punch', status: 'all' }, fresh: fresh ?? null, phoneItem: phone[0] });
      ok('stale sibling: the focus reads the signed-in user\'s query and filters to Review',
        step.kind === 'apply' && step.status === 'ready_for_review', JSON.stringify(step));
      unUser();
      qc.clear();
    }

    const counts = new Map<string, number>();
    const c1 = make(s => { const n = (counts.get(s) ?? 0) + 1; counts.set(s, n); return n > 1; },
      path => (path.includes('push_status=eq.coalesced') ? [{ id: 1 }, { id: 2 }] : [{ created_at: '2026-09-19T14:00:00Z' }]));
    const first = await c1.fn('gc-1', 'p-1', { sub_name: 'Rivera Drywall' });
    const second = await c1.fn('gc-1', 'p-1', { sub_name: 'Rivera Drywall' });
    const other = await c1.fn('gc-1', 'p-1', { sub_name: 'ABC Electric' });
    ok('the first mark in the window is loud and counts the quiet ones before it', first.quiet === false && first.more === 2, JSON.stringify(first));
    ok('the second mark from the same sub in the window is quiet (inbox only)', second.quiet === true, JSON.stringify(second));
    ok('another sub on the same job is its own window', other.quiet === false);
    ok('the window key is GC + job + sub + a 10-minute window, cap 1',
      /^notify:punch_ready:gc-1:p-1:rivera drywall:\d+\|1$/.test(c1.scopes[0] ?? ''), c1.scopes[0]);
    ok('"and N more" counts only coalesced rows after the last loud row for this GC, job and sub',
      c1.paths.some(p => /push_status=eq\.coalesced/.test(p) && /created_at=gt\.2026-09-19T14%3A00%3A00Z/.test(p) && /payload->>sub_name=eq\.Rivera%20Drywall/.test(p) && /recipient_user_id=eq\.gc-1/.test(p)));
    ok('a loud row with no push token (NULL status) still counts as loud', c1.paths.some(p => /or=\(push_status\.is\.null,push_status\.neq\.coalesced\)/.test(p)));
    const c2 = make(() => false, () => { throw new Error('down'); });
    const failOpen = await c2.fn('gc-1', 'p-1', { sub_name: 'R' });
    ok('a failed count fails OPEN: loud, no "and N more"', failOpen.quiet === false && failOpen.more === 0);

    const DISPATCH = strip(NOTIFY);
    ok('dispatchOne: a quiet row sends no push and no email', /const allowPush = !spec\.quiet && kind === 'gc'/.test(DISPATCH) && /const allowEmail = !spec\.quiet && prefAllows/.test(DISPATCH));
    ok('dispatchOne: a quiet row is still written to the inbox, marked coalesced',
      /if \(spec\.quiet\) \{ pushStatus = 'coalesced'; emailStatus = 'coalesced'; \}/.test(DISPATCH));
    ok('the punch case coalesces and passes quiet through', /event === 'punch_marked_ready' \? await punchReadyCoalesce\(gcUserId, projectId, payload\)/.test(DISPATCH) && /quiet: co\.quiet,/.test(DISPATCH));
    ok('the push carries the punch item id', /itemId: payload\.punch_item_id \?\? payload\.item_id \?\? undefined/.test(DISPATCH));

    const ROUTES = read('supabase/functions/notify/routes.ts');
    ok('the route reads punch_item_id (trigger) and itemId (push)', /pick\(d, 'punch_item_id', 'punchItemId', 'item_id', 'itemId'\)/.test(ROUTES));

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })();
}
