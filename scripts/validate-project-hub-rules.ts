// validate-project-hub-rules.ts — the project hub (app/project-detail.tsx) and
// the two job screens it opens that gate on the project, not only on the
// viewer's own plan (app/field-ticket.tsx, app/permits.tsx).
//
// Post-ship workflow audit, wave 3, lane project-hub:
//   #39  a SENT change order was in no chip but "All", while its Approve row
//        still showed under the list;
//   #71  a free GC's "Enable Client Portal" wrote enabled=true, then paywalled
//        him, and the link pill sent him back to that paywall;
//   #91/#171  tile locks and the T&M / Permits screens asked only the
//        viewer's OWN tier, so an invited foreman met "upgrade" on the work he
//        was invited to do (and false locks on tiles that did open);
//   #92  a collaborator saw the Money group, Client Portal, Edit and Delete —
//        and Delete / Edit "worked" locally while RLS matched 0 rows;
//   #143 RFI / submittal lists silently cut at 5, oldest-overdue RFIs hidden;
//   #173 "Team (1)" whatever the roster; #174 the foreman labelled "You (Owner)".
//
// The pure rules live at module level in the screens and are LIFTED OUT and
// RUN here (the carriedOpenBook pattern in validate-portal-owner) — the
// screens import react-native, so they cannot be imported under bun.
//
// Run: bun run scripts/validate-project-hub-rules.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calendarDayOf } from '../utils/calendarDate';
import { resolveProjectAccess, COLLABORATOR_PROJECT_FEATURES, OWNER_ONLY_FEATURES } from '../utils/collaboratorAccess';
// #129 (wave 4): the Team count moved to the pure module (it takes `hasData`).
import { teamCountLabel } from '../utils/projectRole';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function expect(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

// ── Lifting ──────────────────────────────────────────────────────────────────
type Bun = { Transpiler: new (o: { loader: string }) => { transformSync(src: string): string } };
function sliceDecl(src: string, head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`not found: ${head}`);
  // A one-line const ends at its semicolon.
  if (head.startsWith('const ')) return src.slice(start, src.indexOf(';\n', start) + 2);
  // A function / object literal ends at the first column-0 closer after it.
  const end = src.slice(start).search(/\n(\}|\};)\n/);
  if (end < 0) throw new Error(`no end for: ${head}`);
  const tail = src.slice(start + end).match(/^\n(\}|\};)\n/)![0];
  return src.slice(start, start + end + tail.length);
}
function lift<T>(file: string, heads: string[], exportNames: string[]): T | null {
  try {
    const src = read(file);
    const body = heads.map(h => sliceDecl(src, h)).join('\n');
    const BunRt = (globalThis as unknown as { Bun: Bun }).Bun;
    const js = new BunRt.Transpiler({ loader: 'ts' }).transformSync(`${body}\nexport { ${exportNames.join(', ')} };`);
    return new Function(`${js.replace(/export \{[^}]*\};?/, '')}\nreturn { ${exportNames.join(', ')} };`)() as T;
  } catch (err) {
    ok(`${file}: ${exportNames.join(', ')} could be lifted out`, false, String(err));
    return null;
  }
}

const PD = 'app/project-detail.tsx';
const pdRaw = read(PD);
const pd = pdRaw.replace(/\s+/g, ' ');

type Role = 'owner' | 'editor' | 'viewer' | 'field' | null;
type Perms = { showMoney: boolean; showClientPortal: boolean; canDelete: boolean; canLeave: boolean; editBlockedReason: string | null };
const hub = lift<{
  isPendingCO: (c: { status: string }) => boolean;
  hubLockedTileKeys: (a: { canAccessProject: (f: string) => boolean; canAccessOwnTier: (f: string) => boolean; roleLoading: boolean }) => Set<string>;
  hubPermissions: (r: Role) => Perms;
  sortRFIsForHub: <T extends { number: number; status: string; dateRequired?: string | null }>(rows: T[], filter: string, dueDay: (v: string | null | undefined) => string | null) => T[];
  sortSubmittalsForHub: <T extends { currentStatus: string }>(rows: T[]) => T[];
  hubTileVisible: (key: string, p: { showMoney: boolean; showClientPortal: boolean }) => boolean;
  tileLockReason: (key: string, role: Role, tier: string | null) => string;
  leaveFailureMessage: (r: { reached: boolean; serverError: string | null; ok: boolean }) => string | null;
}>(PD, [
  'function isPendingCO(', 'function hubLockedTileKeys(', 'function hubPermissions(',
  'function sortRFIsForHub<', 'function sortSubmittalsForHub<', 'const HUB_MONEY_TILE_KEYS', 'function hubTileVisible(',
  'function tileLockReason(', 'function leaveFailureMessage(',
], ['isPendingCO', 'hubLockedTileKeys', 'hubPermissions', 'sortRFIsForHub', 'sortSubmittalsForHub', 'hubTileVisible', 'tileLockReason', 'leaveFailureMessage']);

// ── #39 · one pending predicate, approve rows under their own row ────────────
console.log('\n#39 change orders');
if (hub) {
  const statuses = ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'revised', 'void'];
  expect('pending = submitted, under_review, revised, draft',
    statuses.filter(s => hub.isPendingCO({ status: s })), ['draft', 'submitted', 'under_review', 'revised']);
}
ok('the Pending count reads isPendingCO', /pending: changeOrders\.filter\(isPendingCO\)\.length/.test(pd));
ok('…and so does the Pending filter', /if \(coFilter === 'pending'\) return isPendingCO\(c\);/.test(pd));
ok('no second hand-written pending predicate is left behind',
  !/c\.status === 'under_review' \|\| c\.status === 'draft' \|\| c\.status === 'revised'/.test(pd));
ok('the Approve / Reject row renders inside ITS CO row\'s fragment, under the active filter',
  /\.map\(co => \( <React\.Fragment key=\{co\.id\}> <TouchableOpacity[\s\S]{0,1600}<\/TouchableOpacity> \{co\.status === 'submitted' && \( <View style=\{styles\.coApproveRow\}/.test(pd));
ok('…and no free-standing approve list over ALL submitted COs remains',
  !/changeOrders\.filter\(co => co\.status === 'submitted'\)\.map/.test(pd));

// ── #171 / #91 · locks ask the same question the screens ask ────────────────
console.log('\n#171 / #91 tile locks');
if (hub) {
  const ownFree = () => false;
  // A free foreman on a Business GC's job: the grant opens field work.
  const grant = (f: string) => resolveProjectAccess(false, 'field', f);
  const foreman = hub.hubLockedTileKeys({ canAccessProject: grant, canAccessOwnTier: ownFree, roleLoading: false });
  for (const k of ['punchList', 'rfis', 'submittals', 'changeOrders', 'fieldTickets', 'plans', 'safety', 'timeTracking']) {
    ok(`free foreman on an invited job: '${k}' is not locked`, !foreman.has(k));
  }
  ok('…Permits stays locked (job_costing is OWNER_ONLY)', foreman.has('permits'));
  ok('…the Client Portal stays locked on his own tier', foreman.has('clientPortal'));
  // A free owner on his own job: every paid tile locked.
  const ownerGrant = (f: string) => resolveProjectAccess(false, 'owner', f);
  const freeOwner = hub.hubLockedTileKeys({ canAccessProject: ownerGrant, canAccessOwnTier: ownFree, roleLoading: false });
  expect('free owner: every paid tile carries a lock',
    ['punchList', 'rfis', 'submittals', 'changeOrders', 'fieldTickets', 'plans', 'safety', 'permits', 'clientPortal', 'timeTracking'].every(k => freeOwner.has(k)), true);
  // #62: a viewer seat gets no crew clock; the tile says why, not "Needs Business".
  const viewer = hub.hubLockedTileKeys({ canAccessProject: (f: string) => resolveProjectAccess(false, 'viewer', f), canAccessOwnTier: ownFree, roleLoading: false });
  ok('a free viewer seat: Time Tracking is locked', viewer.has('timeTracking'));
  expect('…with the seat reason, not a plan upsell', hub.tileLockReason('timeTracking', 'viewer', 'business'), 'Clocking crew in needs a field or editor seat');
  // A Business owner: the own-tier half opens it even though crew_time_tracking is not a tier key.
  const bizOwner = hub.hubLockedTileKeys({ canAccessProject: (f: string) => resolveProjectAccess(f === 'subcontractor_management', 'owner', f), canAccessOwnTier: (f: string) => f === 'subcontractor_management', roleLoading: false });
  ok('a Business owner: Time Tracking is not locked', !bizOwner.has('timeTracking'));
  // While the role read is in flight: no project-scoped lock is guessed.
  const loading = hub.hubLockedTileKeys({ canAccessProject: ownerGrant, canAccessOwnTier: ownFree, roleLoading: true });
  expect('role still loading: no project-scoped lock flashes', ['punchList', 'rfis', 'plans', 'safety'].some(k => loading.has(k)), false);
  const pro = hub.hubLockedTileKeys({ canAccessProject: () => true, canAccessOwnTier: () => true, roleLoading: false });
  expect('a paying owner sees no locks', pro.size, 0);
  // The grant list is what makes the foreman case true — pin its premise.
  ok('premise: the field features are in COLLABORATOR_PROJECT_FEATURES',
    ['punch_list_closeout', 'rfis_submittals', 'change_orders_invoicing', 'plan_markup', 'safety_management'].every(f => COLLABORATOR_PROJECT_FEATURES.has(f)));
  ok('premise: job_costing is OWNER_ONLY', OWNER_ONLY_FEATURES.has('job_costing'));
  expect('a collaborator is told whose permits these are',
    hub.tileLockReason('permits', 'field', 'pro'), 'Permits are managed by the project owner');
  expect('the owner is told the plan', hub.tileLockReason('permits', 'owner', 'pro'), 'Needs Pro');
  expect('a Business tile names Business', hub.tileLockReason('safety', 'owner', 'business'), 'Needs Business');
}
ok('lockedTileKeys is built from useProjectAccess(id) through hubLockedTileKeys',
  /const \{ canAccess: canAccessProject \} = useProjectAccess\(id\);/.test(pd)
  && /hubLockedTileKeys\(\{ canAccessProject: f => canAccessProject\(/.test(pd)
  && /roleLoading: roleState\.isLoading/.test(pd));
ok('the role state is read with the pinned call shape', /const roleState = useProjectRoleState\(id\);/.test(pd));
ok('Financial Health locks stay on his OWN tier', /const lockJobCosting = !canAccess\('job_costing'\);/.test(pd)
  && /const lockBudgetDashboard = !canAccess\('full_budget_dashboard'\);/.test(pd));
ok('a locked tile prints its reason', /lockReason \? \( <Text style=\{\[styles\.sectionTileStatus/.test(pd)
  && /testID=\{`section-tile-lock-reason-\$\{tile\.key\}`\}/.test(pd));

// ── #81 · a Safety tile in Field Ops ─────────────────────────────────────────
console.log('\n#81 safety tile');
ok('Field Ops lists a safety tile', /key: 'field',[\s\S]{0,200}'timeTracking', 'safety'/.test(pd));
ok('…which opens /safety on this job', /if \(tile\.key === 'safety'\) \{ router\.push\(\{ pathname: '\/safety' as any, params: \{ projectId: id \} \}\); return; \}/.test(pd));

// ── #92 · the job's own controls follow the role ─────────────────────────────
console.log('\n#92 role-scoped hub');
if (hub) {
  const o = hub.hubPermissions('owner');
  const e = hub.hubPermissions('editor');
  const v = hub.hubPermissions('viewer');
  const f = hub.hubPermissions('field');
  const n = hub.hubPermissions(null);
  expect('owner: money, portal, delete, edit', [o.showMoney, o.showClientPortal, o.canDelete, o.canLeave, o.editBlockedReason], [true, true, true, false, null]);
  expect('editor: money, edit, leave — NOT delete (RLS refuses an editor\'s delete)', [e.showMoney, e.showClientPortal, e.canDelete, e.canLeave, e.editBlockedReason], [true, false, false, true, null]);
  expect('viewer: money read-only, no portal, leave, edit blocked', [v.showMoney, v.showClientPortal, v.canDelete, v.canLeave], [true, false, false, true]);
  ok('…and the viewer is told why he cannot edit', !!v.editBlockedReason && /view-only/.test(v.editBlockedReason));
  expect('field: no money, no portal, leave', [f.showMoney, f.showClientPortal, f.canDelete, f.canLeave], [false, false, false, true]);
  ok('…and the field seat is told why he cannot edit', !!f.editBlockedReason && /owner or an editor/.test(f.editBlockedReason));
  expect('unconfirmed role fails CLOSED', [n.showMoney, n.showClientPortal, n.canDelete, n.canLeave], [false, false, false, false]);
  ok('…with a reason that names the connection, not a guess', !!n.editBlockedReason && /confirmed/.test(n.editBlockedReason));
  expect('field: the Money tiles are hidden', ['invoices', 'changeOrders', 'budget', 'contract', 'linkedEstimate'].map(k => hub.hubTileVisible(k, f)), [false, false, false, false, false]);
  expect('field: field tiles stay', ['dailyReports', 'punchList', 'fieldTickets', 'plans'].map(k => hub.hubTileVisible(k, f)), [true, true, true, true]);
  expect('editor: the Client Portal tile is hidden', hub.hubTileVisible('clientPortal', e), false);
  expect('owner: every tile shows', ['invoices', 'clientPortal', 'budget'].map(k => hub.hubTileVisible(k, o)), [true, true, true]);
  // Leave's failure copy.
  ok('leave: unreachable server says he is still on the job',
    /still on this job/.test(hub.leaveFailureMessage({ reached: false, serverError: null, ok: false }) ?? ''));
  ok('leave: an undeployed action reads as "not available yet", never as done',
    /isn't available on the server yet/.test(hub.leaveFailureMessage({ reached: true, serverError: 'Unknown action: leave', ok: false }) ?? ''));
  ok('leave: a server refusal is quoted', /Not a collaborator/.test(hub.leaveFailureMessage({ reached: true, serverError: 'Not a collaborator', ok: false }) ?? ''));
  expect('leave: a confirmed leave is no failure', hub.leaveFailureMessage({ reached: true, serverError: null, ok: true }), null);
}
ok('the hub role is the live read, else the cached role with the owner from his row',
  /const hubRole = roleState\.role \?\? pricingRoleFor\(project\?\.myRole \?\? null, project\?\.ownerUserId, authUser\?\.id\);/.test(pd));
ok('tiles are filtered through hubTileVisible', /const visibleTiles = allTiles\.filter\(t => hubTileVisible\(t\.key, hubPerms\)\);/.test(pd));
ok('a ?tile= deep link into a hidden section lands on the grid', /if \(!hubTileVisible\(tileParam, hubPerms\)\)/.test(pd));
ok('Delete Project renders only for the owner', /\{hubPerms\.canDelete \? \( <TouchableOpacity style=\{styles\.deleteButton\} onPress=\{handleDelete\}/.test(pd));
ok('handleDelete itself refuses a non-owner before any local cascade',
  /const handleDelete = useCallback\(\(\) => \{[\s\S]{0,400}if \(!hubPerms\.canDelete\) \{[\s\S]{0,500}return;/.test(pdRaw));
ok('a collaborator gets Leave project', /hubPerms\.canLeave \? \( <TouchableOpacity[\s\S]{0,200}onPress=\{handleLeave\}/.test(pd));
ok('Leave calls project-invite {action:\'leave\', projectId}',
  /supabase\.functions\.invoke\('project-invite', \{ body: \{ action: 'leave', projectId: id \} \}\)/.test(pd));
ok('…and only after the server confirms re-reads, without deleteProject',
  (() => {
    // #8/#128 (wave 4): the server call is handleLeave's inner runLeave,
    // reached only after the pre-leave flush + count and the confirm.
    const s = pdRaw.indexOf('const handleLeave = useCallback(');
    const body = pdRaw.slice(s, pdRaw.indexOf('}, [id, leaving', s));
    return body.indexOf('leaveFailureMessage(') > 0
      && body.indexOf('leaveFailureMessage(') < body.indexOf("invalidateQueries({ queryKey: ['projects'] })")
      && !/deleteProject\(/.test(body);
  })());
ok('every edit entry point goes through requestEdit',
  /onPress=\{requestEdit\} style=\{\{ padding: 6 \}\}/.test(pd) && /onPress=\{requestEdit\} activeOpacity=\{0\.7\} testID="edit-project-bottom-btn"/.test(pd)
  && /deepLinkConsumed\.current = true; requestEdit\(\);/.test(pd) && !/onPress=\{openEditModal\}/.test(pd));
ok('a blocked edit prints its reason under the button', /testID="edit-project-blocked-reason"/.test(pd));

// ── #173 / #174 · the Team ───────────────────────────────────────────────────
console.log('\n#173 / #174 team');
{
  // #129: loading, a failed read and a read paused offline are all "no data"
  // — the paused one used to print "1" (0 accepted + the owner).
  const rows = [{ status: 'accepted' }, { status: 'accepted' }, { status: 'pending' }];
  expect('owner: members + pending', teamCountLabel({ hasData: true, viewerIsOwner: true, rows }), '3 + 1 pending');
  expect('owner, all accepted', teamCountLabel({ hasData: true, viewerIsOwner: true, rows: rows.slice(0, 2) }), '3');
  expect('owner alone', teamCountLabel({ hasData: true, viewerIsOwner: true, rows: [] }), '1');
  expect('no data (loading / failed / paused offline): no number, not a guessed 1', teamCountLabel({ hasData: false, viewerIsOwner: true, rows: [] }), null);
  expect('collaborator (RLS shows only his row): no number', teamCountLabel({ hasData: true, viewerIsOwner: false, rows: [{ status: 'accepted' }] }), null);
}
ok('#129: project-detail feeds the count the roster\'s hasData, not "not loading and not failed"',
  /teamCountLabel\(\{ hasData: teamRoster\.hasData,/.test(pd) && !/isError: teamRoster\.isError/.test(pd));
ok('the count reads useProjectCollaborators (same key as the Team list)', /const teamRoster = useProjectCollaborators\(project\?\.id\);/.test(pd));
ok('no count reads the legacy project.collaborators any more',
  !/project\.collaborators/.test(pdRaw) && !/collaborators\.length \+ 1/.test(pdRaw));
ok('"You (Owner)" renders only for the owner', /\{hubRole === 'owner' \? \( <View style=\{styles\.collabMember\} testID="team-owner-row-self">[\s\S]{0,400}You \(Owner\)/.test(pd));
ok('…anyone else sees a neutral "Project owner" and "You · <role>", never his own email as the owner\'s',
  /testID="team-owner-row-other"[\s\S]{0,500}Project owner/.test(pd) && /You · \$\{ROLE_LABELS\[hubRole\]\}/.test(pd)
  && (pd.match(/branding\.email \|\| 'Set email in settings'/g) ?? []).length === 1);

// ── #143 · the full RFI / submittal logs, overdue first ──────────────────────
console.log('\n#143 RFI / submittal lists');
if (hub) {
  const rfis = [
    { number: 9, status: 'open', dateRequired: '2026-09-30' },
    { number: 8, status: 'open', dateRequired: null },
    { number: 7, status: 'open', dateRequired: '2026-09-02T12:00:00.000Z' }, // DatePickerModal instant
    { number: 6, status: 'open', dateRequired: '2026-09-10' },
  ];
  expect('open: earliest due day first, undated last',
    hub.sortRFIsForHub(rfis, 'open', calendarDayOf).map(r => r.number), [7, 6, 9, 8]);
  expect('other chips keep the context order', hub.sortRFIsForHub(rfis, 'all', calendarDayOf).map(r => r.number), [9, 8, 7, 6]);
  const subs = [
    { n: 1, currentStatus: 'approved' }, { n: 2, currentStatus: 'pending' }, { n: 3, currentStatus: 'revise_resubmit' },
    { n: 4, currentStatus: 'rejected' }, { n: 5, currentStatus: 'pending' },
  ];
  expect('submittals: action-needed first, stable within a rank',
    hub.sortSubmittalsForHub(subs).map(s => s.n), [3, 4, 2, 5, 1]);
}
ok('no .slice(0, 5) on the RFI list', !/\.slice\(0, 5\)\.map\(rfi =>/.test(pd));
ok('no .slice(0, 5) on the submittal list', !/projectSubmittals\.slice\(0, 5\)/.test(pd));
ok('the RFI list is sorted through sortRFIsForHub with calendarDayOf', /\}\), rfiFilter, calendarDayOf\)\.map\(rfi =>/.test(pd));
ok('the overdue flag reads the due DAY (calendarDayOf) for mixed shapes',
  /daysUntilCalendarDay\(calendarDayOf\(rfi\.dateRequired\)\)/.test(pd));
ok('submittals are sorted through sortSubmittalsForHub', /sortSubmittalsForHub\(projectSubmittals\)\.map\(sub =>/.test(pd));

// ── #71 · the Client Portal is gated before any write ───────────────────────
console.log('\n#71 client portal');
ok('the entitlement is his own tier on client_portal', /const portalEntitled = canAccess\('client_portal'\);/.test(pd));
{
  const lockedAt = pd.indexOf('!portalEntitled ? ( // #71: locked BEFORE any write');
  const writeAt = pd.indexOf('clientPortal: { enabled: true,');
  ok('Enable renders a locked control (no write) when not entitled, ahead of the enabling write',
    lockedAt > 0 && writeAt > lockedAt && /testID="portal-enable-locked"/.test(pd)
    && /onPress=\{openPortalPaywall\}/.test(pd.slice(lockedAt, writeAt)) && !/updateProject/.test(pd.slice(lockedAt, pd.indexOf('testID="portal-enable-btn"'))));
}
ok('…and says why', /Client portal is a Pro feature<\/Text>/.test(pd));
ok('copy refuses without the entitlement', /const handleCopyPortalLink = useCallback\(async \(\) => \{ if \(!portalEntitled\) \{ openPortalPaywall\(\); return; \}/.test(pd));
ok('Messages and Advanced settings route to the paywall without it',
  /portalEntitled \? navigateFromTile\(\{ pathname: '\/client-messages'[^)]*\) : openPortalPaywall\(\)/.test(pd)
  && /portalEntitled \? navigateFromTile\(\{ pathname: '\/client-portal-setup'[^)]*\) : openPortalPaywall\(\)/.test(pd));
ok('the inline switches are disabled without it', /disabled=\{!portalEntitled\}/.test(pd) && /if \(!id \|\| !portalEntitled\) return;/.test(pd));
ok('the false "open Client Portal and tap Save" copy is gone', !/tap Save/.test(pdRaw) && !/open Client Portal and Save/.test(pdRaw));
ok('…replaced by the truth: the server mints the key on enable', /created on the server when the portal is turned on/.test(pd));
ok('the paywall is mounted OUTSIDE the tile sheet', /<Paywall visible=\{portalPaywallOpen\} feature="Client Portal" requiredTier=\{requiredTierFor\('client_portal'\)\}/.test(pd));

// ── client-portal handoff · one lite-sync, no second copy of the merge ───────
console.log('\nportal lite sync');
ok('project-detail publishes through syncPortalSnapshotLite, with permits',
  /void syncPortalSnapshotLite\(project\.id, \{ project, userId: authUser\?\.id, settings, settingsLoaded,[\s\S]{0,300}permits: projectPermits,[\s\S]{0,1200}\}\);/.test(pd));
// #15 (wave 4): the job's pay apps ride along — but only under the provider's
// AIA freshness gate (integration round 1: a non-empty but stale list dropped
// a pay app shared from another device; otherwise the section is carried).
ok('#15: the lite publish passes the job\'s AIA pay apps only while the AIA list is the server\'s',
  /\.\.\.\(portalAiaListServerRead \? \{ aiaPayApps: projectAIAPayApps \} : \{\}\),/.test(pd)
  && !/projectAIAPayApps\.length > 0 \? \{ aiaPayApps/.test(pd)
  && /\}, \[project, portalListsServerRead, portalAiaListServerRead, authUser\?\.id,/.test(pd)
  && /projectWarranties, projectPermits, projectAIAPayApps\]\);/.test(pd));
ok('…and holds no inline copy of the merge or the upsert',
  !/from\('portal_snapshots'\)/.test(pdRaw) && !/function carriedOpenBook\(/.test(pdRaw) && !/buildPortalSnapshot\(/.test(pdRaw)
  && !/PROJECT_DETAIL_SUPABASE_ANON_KEY/.test(pdRaw));

// ── #70 / #94 · a cold-opened job has a way out ──────────────────────────────
console.log('\n#70 / #94 header');
ok('headerLeft is offered only when there is nothing to pop',
  /\.\.\.\(canGoBack \? \{\} : \{ headerLeft \}\)/.test(pd) && /router\.replace\('\/\(tabs\)\/\(home\)'\)/.test(pd));

// ── app/field-ticket.tsx · #91 gate on the resolved job; #99 blinding kept ──
console.log('\nfield-ticket');
const FT = 'app/field-ticket.tsx';
const ftRaw = read(FT);
const ft = ftRaw.replace(/\s+/g, ' ');
type Gate = (a: { ownTier: boolean; projectGrant: boolean; roleLoading: boolean; roleError: boolean; role: string | null }) => string;
const ftl = lift<{ fieldTicketGate: Gate }>(FT, ['function fieldTicketGate('], ['fieldTicketGate']);
if (ftl) {
  const g = ftl.fieldTicketGate;
  expect('own Pro opens it', g({ ownTier: true, projectGrant: false, roleLoading: true, roleError: false, role: null }), 'open');
  expect('free, role loading: spinner, not a paywall', g({ ownTier: false, projectGrant: false, roleLoading: true, roleError: false, role: null }), 'loading');
  expect('free, read failed: retry', g({ ownTier: false, projectGrant: false, roleLoading: false, roleError: true, role: null }), 'error');
  expect('free foreman with the grant: open', g({ ownTier: false, projectGrant: true, roleLoading: false, roleError: false, role: 'field' }), 'open');
  expect('free, settled null role: no access (never spins)', g({ ownTier: false, projectGrant: false, roleLoading: false, roleError: false, role: null }), 'no_access');
  expect('free owner of the job: the paywall', g({ ownTier: false, projectGrant: false, roleLoading: false, roleError: false, role: 'owner' }), 'paywall');
}
ok('the gate reads useProjectAccess on the RESOLVED project (pick or URL)',
  /const \{ canAccess, canAccessOwnTier \} = useProjectAccess\(activeProjectId \|\| undefined\);/.test(ft));
{
  const pickerAt = ftRaw.indexOf('if (!activeProjectId || !project) {');
  const gateAt = ftRaw.indexOf("if (!canAccess('change_orders_invoicing')) {");
  ok('…and runs AFTER the project resolves, not before the picker', pickerAt > 0 && gateAt > pickerAt);
}
ok('the default export no longer paywalls on his own tier up front',
  !/export default function FieldTicketScreen\(\) \{ const router = useRouter\(\); const \{ canAccess \} = useTierAccess\(\);/.test(ft));
ok('#99 kept: money blinding fails closed on the pricing role',
  /const moneyBlinded = !canViewFinancials\(pricingRole\);/.test(ft) && /pricingRoleFor\(projectRole, project\?\.ownerUserId, user\?\.id\)/.test(ft));

// ── app/permits.tsx · owner-only, said as such ───────────────────────────────
console.log('\npermits');
const PM = 'app/permits.tsx';
type PGate = (a: { ownTier: boolean; hasProject: boolean; role: string | null; roleLoading: boolean; roleError: boolean }) => string;
const pml = lift<{ permitsGate: PGate }>(PM, ['function permitsGate('], ['permitsGate']);
if (pml) {
  const g = pml.permitsGate;
  expect('own Pro opens it', g({ ownTier: true, hasProject: true, role: 'field', roleLoading: false, roleError: false }), 'open');
  expect('collaborator (field): owner-only note, not a paywall', g({ ownTier: false, hasProject: true, role: 'field', roleLoading: false, roleError: false }), 'owner_only');
  expect('collaborator (editor): owner-only note', g({ ownTier: false, hasProject: true, role: 'editor', roleLoading: false, roleError: false }), 'owner_only');
  expect('free owner: the paywall', g({ ownTier: false, hasProject: true, role: 'owner', roleLoading: false, roleError: false }), 'paywall');
  expect('no job named (Tools): the paywall', g({ ownTier: false, hasProject: false, role: null, roleLoading: false, roleError: false }), 'paywall');
  expect('role loading: spinner', g({ ownTier: false, hasProject: true, role: null, roleLoading: true, roleError: false }), 'loading');
  expect('read failed: retry', g({ ownTier: false, hasProject: true, role: null, roleLoading: false, roleError: true }), 'error');
  expect('settled null role: no access', g({ ownTier: false, hasProject: true, role: null, roleLoading: false, roleError: false }), 'no_access');
}
ok('the collaborator is told "Permits are managed by the project owner"', /Permits are managed by the project owner/.test(read(PM)));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
