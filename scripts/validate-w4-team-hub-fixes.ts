// scripts/validate-w4-team-hub-fixes.ts
//
// Wave 4 · lane team-hub. Pins the fixes for:
//   #8/#128  Leave project flushes, counts what is still queued, and says so
//            (Cancel / Sync first / Leave anyway) — never "nothing is deleted";
//   #111/#130 accept-invite and the Home invite card re-read the project list
//            before opening the job; project-detail holds its loader while the
//            list re-reads and a just-joined job is "hasn't loaded", not "not found";
//   #126     a collaborator read that failed IN TRANSPORT serves the stamped
//            field/editor role as paused (no paywall offline);
//   #129     the Team roster never says "No collaborators yet" for a read that
//            failed or is paused; Invite is off with its reason; the count
//            needs data; a same-role pending re-send keeps its token;
//   carries  #38 billing buttons owner-only with the reason, #15 the lite
//            portal publish carries the job's pay apps, #63 "Filed by" on
//            daily report rows, #29 the RFI log export counts queued INSERTs only.
//
// Screens import react-native, so the screen side is pinned by source; the
// decisions are pure (utils/projectRole) and run here.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveRoleState, rosterView, inviteBlockedReason, teamCountLabel, filedByLine,
  leaveDialogCopy, leftProjectMessage, settleWithin, missingProjectView, LEAVE_SYNCED_STAYS,
} from '../utils/projectRole';
import { isTransportError } from '../utils/networkErrors';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');

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
/** The text between two markers (first `from`, then the next `to` after it). */
function between(src: string, from: string, to: string): string {
  const s = src.indexOf(from);
  if (s < 0) return '';
  const e = src.indexOf(to, s + from.length);
  return e < 0 ? '' : src.slice(s, e);
}

const PD_RAW = read('app/project-detail.tsx');
const PD = flat(PD_RAW);
const CM = flat(read('components/collaborators/CollaboratorsManager.tsx'));
const PIC_RAW = read('components/collaborators/PendingInvitesCard.tsx');
const AI_RAW = read('app/accept-invite.tsx');
const UPC = flat(read('hooks/useProjectCollaborators.ts'));
const UPR = flat(read('hooks/useProjectRole.ts'));
const INV = flat(read('supabase/functions/project-invite/index.ts'));

async function main() {
  // ── #126 · a transport failure serves the stamped role, paused ────────────
  console.log('\n#126 role offline');
  const base = { projectId: 'p1', uid: 'u1', ownerUserId: 'gc', collaborators: [], isLoading: false, isPending: false, inCache: true, fetchPaused: false };
  expect('isError + transport + cached field → field, paused, not an error',
    resolveRoleState({ ...base, isError: true, cachedRole: 'field', errorIsTransport: true }),
    { role: 'field', isLoading: false, isError: false, isPaused: true });
  expect('…and the same for an editor stamp',
    resolveRoleState({ ...base, isError: true, cachedRole: 'editor', errorIsTransport: true }).role, 'editor');
  expect('a viewer stamp keeps the error answer (Retry)',
    resolveRoleState({ ...base, isError: true, cachedRole: 'viewer', errorIsTransport: true }),
    { role: null, isLoading: false, isError: true, isPaused: false });
  expect('an error the SERVER sent (RLS / 5xx) keeps the error answer, even with a field stamp',
    resolveRoleState({ ...base, isError: true, cachedRole: 'field', errorIsTransport: false }).isError, true);
  expect('no stamp keeps the error answer',
    resolveRoleState({ ...base, isError: true, cachedRole: null, errorIsTransport: true }).isError, true);
  expect('the owner is still the owner on any failure',
    resolveRoleState({ ...base, ownerUserId: 'u1', isError: true, cachedRole: null, errorIsTransport: false }).role, 'owner');
  ok('isTransportError: RN "Network request failed" is transport, a 57014 statement timeout is not',
    isTransportError(new Error('Network request failed')) && !isTransportError({ code: '57014', message: 'canceling statement due to statement timeout' }));
  ok('useProjectRoleState passes errorIsTransport from isTransportError(error) (call shape unchanged)',
    /errorIsTransport: !!projectId && isError && isTransportError\(error\)/.test(UPR)
    && /export function useProjectRoleState\(projectId: string \| undefined\): ProjectRoleState/.test(UPR));
  ok('useProjectCollaborators exposes the failed read\'s error', /error: query\.error,/.test(UPC));

  // ── #129 · the roster says what it knows ──────────────────────────────────
  console.log('\n#129 team roster');
  expect('failed read, nothing read → error', rosterView({ isLoading: false, isError: true, isPaused: false, hasData: false, count: 0 }), 'error');
  expect('paused offline, nothing read → offline', rosterView({ isLoading: false, isError: false, isPaused: true, hasData: false, count: 0 }), 'offline');
  expect('first read in flight → loading', rosterView({ isLoading: true, isError: false, isPaused: false, hasData: false, count: 0 }), 'loading');
  expect('answered, no rows → empty (the only "No collaborators yet")', rosterView({ isLoading: false, isError: false, isPaused: false, hasData: true, count: 0 }), 'empty');
  expect('answered with rows, a later refresh failed → still the list', rosterView({ isLoading: false, isError: true, isPaused: false, hasData: true, count: 2 }), 'list');
  ok('Invite is blocked with a reason while the roster is unknown',
    !!inviteBlockedReason('error') && !!inviteBlockedReason('offline') && !!inviteBlockedReason('loading')
    && inviteBlockedReason('empty') === null && inviteBlockedReason('list') === null);
  ok('useProjectCollaborators exposes isPaused (fetchStatus paused) and hasData (data present)',
    /isPaused: query\.fetchStatus === 'paused',/.test(UPC) && /hasData: query\.data !== undefined,/.test(UPC));
  ok('CollaboratorsManager derives the view from the read\'s state',
    /const view = rosterView\(\{ isLoading, isError, isPaused, hasData, count: collaborators\.length \}\);/.test(CM));
  ok('"No collaborators yet" renders only for view === \'empty\'',
    /view === 'empty' \? \( <Text[^>]*>No collaborators yet/.test(CM) && !/collaborators\.length === 0 \? \(/.test(CM));
  ok('error/offline render their line, and error offers Retry (refetch)',
    /view === 'error' \|\| view === 'offline' \?/.test(CM) && /onPress=\{refetch\} testID="collab-roster-retry"/.test(CM));
  ok('Send invite is disabled by inviteBlocked and prints the reason',
    /disabled=\{!validEmail \|\| invite\.isPending \|\| !!inviteBlocked\}/.test(CM) && /testID="collab-invite-blocked">\{inviteBlocked\}/.test(CM)
    && /if \(inviteBlocked\) \{ showAlert\(/.test(CM));
  expect('count: no data → no number', teamCountLabel({ hasData: false, viewerIsOwner: true, rows: [] }), null);
  expect('count: answered, owner alone → 1', teamCountLabel({ hasData: true, viewerIsOwner: true, rows: [] }), '1');
  ok('project-invite reads the existing row\'s invite_token',
    /select=id,role,status,invite_token&limit=1/.test(INV));
  ok('…reuses it for a PENDING row re-sent in the SAME role only',
    /if \(existing\?\.status === "pending" && existing\.role === role && existing\.invite_token\) \{ reuseToken = existing\.invite_token; \}/.test(INV)
    && /const token = reuseToken \?\? newToken\(\);/.test(INV));

  // ── #8 / #128 · Leave says what it would discard ──────────────────────────
  console.log('\n#8/#128 leave project');
  const zero = leaveDialogCopy('Henderson', 0);
  const three = leaveDialogCopy('Henderson', 3);
  const one = leaveDialogCopy('Henderson', 1);
  ok('nothing queued: plain Leave, base copy, no promise that nothing is deleted',
    zero.leaveLabel === 'Leave' && !zero.offerSyncFirst && zero.message.includes(LEAVE_SYNCED_STAYS) && !/Nothing on the job is deleted/.test(zero.message));
  ok('3 queued: says the number, discards, Sync first + Leave anyway',
    three.offerSyncFirst && three.leaveLabel === 'Leave anyway'
    && three.message.startsWith("3 changes on this job haven't reached the cloud yet. Leaving now discards them."));
  ok('1 queued: singular', one.message.startsWith("1 change on this job hasn't reached the cloud yet. Leaving now discards it."));
  expect('"You left" names the dropped count', leftProjectMessage('Henderson', true, 2),
    "You're no longer on Henderson, and it has left this device. 2 changes you had not synced could not be sent.");
  expect('…and says nothing extra when none dropped', leftProjectMessage('Henderson', true, 0), "You're no longer on Henderson, and it has left this device.");
  ok('the old promise is gone from the screen', !/Nothing on the job is deleted/.test(PD_RAW));
  const flush = between(PD_RAW, 'const flushThenCountForLeave = useCallback(', '}, [id, flushPendingProjectSyncs, countQueuedForProject]);');
  const iFlush = flush.indexOf('flushPendingProjectSyncs()');
  const iQueue = flush.indexOf('processOfflineQueue()');
  const iPhoto = flush.indexOf('processPhotoUploadQueue()');
  const iCount = flush.indexOf('countQueuedForProject(id)');
  ok('pre-leave: flushPendingProjectSyncs → processOfflineQueue → processPhotoUploadQueue → countQueuedForProject',
    iFlush > 0 && iQueue > iFlush && iPhoto > iQueue && iCount > iPhoto, `${iFlush} ${iQueue} ${iPhoto} ${iCount}`);
  const leave = between(PD_RAW, 'const handleLeave = useCallback(() => {', 'const handleLeaveRef = useRef(handleLeave);');
  ok('handleLeave counts BEFORE the dialog opens, and builds it from the count',
    leave.indexOf('await flushThenCountForLeave()') > 0
    && leave.indexOf('await flushThenCountForLeave()') < leave.indexOf('showAlert(copy.title, copy.message')
    // Integration round 3: with the Not-saved part of the count (a sync never sends it).
    // Wave-4 final fix: and the platform's button room (Android shows 3).
    && /const copy = leaveDialogCopy\(name, pending, unsaved, Platform\.OS === 'android' \? 3 : 4\);/.test(leave));
  const dialog = leave.slice(leave.indexOf('void (async () => {\n      setCheckingLeave(true);'));
  ok('"Sync first" re-runs the whole check; the server call happens only on the destructive button',
    /copy\.offerSyncFirst \? \[\{ text: 'Sync first', onPress: \(\) => \{ handleLeaveRef\.current\(\); \} \}\]/.test(flat(dialog))
    && dialog.length > 0 && !/functions\.invoke/.test(dialog) && /await runLeave\(\);/.test(dialog)
    && leave.indexOf("functions.invoke('project-invite'") < leave.indexOf('setCheckingLeave(true)'));
  ok('a plain Leave re-counts at the tap and falls back to the count dialog',
    // Integration round 3: > the count the dialog showed (Not-saved lines alone looped at > 0).
    /if \(!copy\.offerSyncFirst\) \{ const now = await countQueuedForProject\(id\)[^;]*; if \(now > pending\) \{ handleLeaveRef\.current\(\); return; \} \}/.test(flat(leave)));
  const run = between(leave, 'const runLeave = async () => {', 'void (async () => {\n      setCheckingLeave(true);');
  ok('runLeave reports the sweep\'s dropped count in "You left"',
    /await \(forgot\.dropped \?\? Promise\.resolve\(0\)\)/.test(run) && /leftProjectMessage\(name, forgot\.ok, dropped\)/.test(run));

  // ── #111 / #130 · a job he just joined is never "not found" ───────────────
  console.log('\n#111/#130 just joined');
  expect('list re-reading → loader', missingProjectView({ projectsLoaded: true, projectsFetching: true, deleting: false, justJoined: false }), 'loading');
  expect('list not loaded → loader', missingProjectView({ projectsLoaded: false, projectsFetching: false, deleting: false, justJoined: false }), 'loading');
  expect('finished read, just joined → joined', missingProjectView({ projectsLoaded: true, projectsFetching: false, deleting: false, justJoined: true }), 'joined');
  expect('finished read, not joined → not_found', missingProjectView({ projectsLoaded: true, projectsFetching: false, deleting: false, justJoined: false }), 'not_found');
  ok('project-detail reads projectsFetching and the justJoined param into missingProjectView',
    /projectsFetching: !!projectsFetching, deleting: deletingRef\.current, justJoined: justJoinedParam === '1'/.test(PD)
    && /if \(missing === 'loading'\)/.test(PD) && /if \(missing === 'joined'\)/.test(PD) && /testID="project-just-joined-retry"/.test(PD));
  expect('settleWithin: resolved', await settleWithin(Promise.resolve(1), 50), 'done');
  expect('settleWithin: rejected', await settleWithin(Promise.reject(new Error('x')), 50), 'failed');
  expect('settleWithin: still out', await settleWithin(new Promise(() => {}), 10), 'timeout');
  const acc = between(AI_RAW, 'await AsyncStorage.removeItem(PENDING_KEY);\n    // #111', "setStatus('done');");
  ok('accept-invite awaits the projects refetch BEFORE status done, then invalidates the rest',
    /await settleWithin\(queryClient\.refetchQueries\(\{ queryKey: \['projects', user\?\.id\] \}\), 8000\);/.test(acc)
    && acc.indexOf('await settleWithin(') < acc.indexOf("q.queryKey[0] !== 'projects'")
    && !/void queryClient\.invalidateQueries\(\);/.test(AI_RAW));
  ok('accept-invite opens the job with justJoined=1 (both pushes and the stash)',
    (AI_RAW.match(/params: \{ id: projectId, justJoined: '1' \}/g) ?? []).length === 2
    && /project-detail\?id=\$\{encodeURIComponent\(projectId\)\}&justJoined=1/.test(AI_RAW));
  const pic = between(PIC_RAW, 'const accept = useCallback(', '}, [qc, query, router, userId]);');
  ok('the Home invite card awaits the ["projects", userId] refetch before it pushes',
    /await settleWithin\(qc\.refetchQueries\(\{ queryKey: \['projects', userId\] \}, \{ throwOnError: true \}\), 8000\)/.test(pic)
    && pic.indexOf('await settleWithin(') < pic.indexOf("router.push({ pathname: '/project-detail'"));
  ok('…a failed re-read stays on the card with an inline message; a push carries justJoined',
    /if \(projectsRead === 'failed'\) \{[\s\S]{0,400}setErrorById[\s\S]{0,200}return;/.test(pic)
    && /params: \{ id: body\.projectId \?\? inv\.projectId, justJoined: '1' \}/.test(pic));

  // ── carries ────────────────────────────────────────────────────────────────
  console.log('\ncarries');
  ok('#38: the hub bill gate is invoiceRoleGate (the #41 rule shared with app/invoice.tsx)',
    /const billGate = invoiceRoleGate\(\{ hasProject: !!project,[\s\S]{0,400}ownedLocally: !!project\?\.ownerUserId && !!authUser\?\.id && project\.ownerUserId === authUser\.id, \}\);/.test(PD));
  const billing = between(PD_RAW, '{billBlockedReason ? (', '</>)}');
  ok('#38: a blocked viewer/editor sees the reason IN PLACE of Bill by voice / Quick / Progress / Full',
    /testID="invoice-bill-blocked">\{billBlockedReason\}/.test(billing)
    && ['add-invoice-voice-btn', 'add-quick-invoice-btn', 'add-progress-bill-btn', 'add-full-invoice-btn'].every(t => billing.includes(`testID="${t}"`))
    && billing.indexOf(') : (<>') > billing.indexOf('invoice-bill-blocked')
    && billing.indexOf(') : (<>') < billing.indexOf('add-invoice-voice-btn'));
  ok('#38: no billing button outside the gate',
    (PD_RAW.match(/testID="add-quick-invoice-btn"/g) ?? []).length === 1 && (PD_RAW.match(/capabilityId: 'invoice'/g) ?? []).length === 1);
  // Integration round 1: under the provider's AIA freshness gate, not "non-empty".
  ok('#15: the lite publish passes the AIA list only while it is the server\'s', /\.\.\.\(portalAiaListServerRead \? \{ aiaPayApps: projectAIAPayApps \} : \{\}\),/.test(PD));
  const collabs = [{ userId: 'f1', name: 'Luis Ortiz', email: 'luis@x.co' }, { userId: 'f2', name: '', email: 'sam@x.co' }];
  expect('#63: a collaborator by name', filedByLine({ filedByUserId: 'f1', viewerId: 'gc', ownerUserId: 'gc', collaborators: collabs }), 'Filed by Luis Ortiz');
  expect('#63: no name → email', filedByLine({ filedByUserId: 'f2', viewerId: 'gc', ownerUserId: 'gc', collaborators: collabs }), 'Filed by sam@x.co');
  expect('#63: unresolved → a team member, never a guess', filedByLine({ filedByUserId: 'zz', viewerId: 'f1', ownerUserId: 'gc', collaborators: [] }), 'Filed by a team member');
  expect('#63: his own report → nothing', filedByLine({ filedByUserId: 'f1', viewerId: 'f1', ownerUserId: 'gc', collaborators: collabs }), null);
  expect('#63: the owner\'s → "the job\'s owner"', filedByLine({ filedByUserId: 'gc', viewerId: 'f1', ownerUserId: 'gc', collaborators: collabs }), "Filed by the job's owner");
  expect('#63: no author on record → nothing', filedByLine({ filedByUserId: undefined, viewerId: 'f1', ownerUserId: 'gc', collaborators: collabs }), null);
  ok('#63: DFR rows print filedByLine from dr.filedByUserId and the roster',
    /filedByLine\(\{ filedByUserId: dr\.filedByUserId, viewerId: authUser\?\.id, ownerUserId: project\.ownerUserId, collaborators: teamRoster\.collaborators, \}\)/.test(PD));
  const rfiLog = between(PD_RAW, 'const handleExportRFILog = useCallback(', '}, [project, projectRFIs, branding]);');
  ok('#29: the RFI log holds only for RFIs whose INSERT is still queued',
    /projectRFIs\.filter\(r => insertStillQueued\(queue, 'rfis', r\.id\)\)/.test(rfiLog) && !/pendingIdsForTable/.test(PD_RAW));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
