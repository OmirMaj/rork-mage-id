// scripts/validate-plans-access-ask-core.ts — wave 3, lane plans-access-ask.
//
// Pins the seven findings this lane closed, by DRIVING the pure helpers where
// there is one and by reading the source only where the fix is wiring:
//
//   #73  a foreman invited on a free account hit a Pro paywall on Plans and on
//        a sheet (incl. a punch item's "On plan" chip); the owner-only controls
//        he now sees say why they are off.
//   #77  a pin RFI told the architect to look at "the marked location" and sent
//        no image of the sheet; Compare RFIs sent neither revision.
//   #78  Ask Your Plans answered from a superseded sheet after a new revision
//        was filed, and nothing said the index was out of date.
//   #80  "Saved for offline: 8 sheets" covered a cache the viewer never reads.
//   #161 the plan index was per-user and the tier the caller's own, so nobody
//        but the GC could use the index he paid for.
//   #163 "Ask your plans" opened the room-estimating screen.
//   #164 a pin RFI's due date was a UTC instant — day 15 on some screens.
//
// Run via: bun run scripts/validate-plans-access-ask-core.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  planScreenGate, planControlBlock, effectivePlanRole, rfiFromPin, pinPositionPhrase, attachableSheetUri,
  rfiFromCandidate, rfiFromChange, splitMatchesByCurrentSheet, staleMatchesNote, changedSinceIndexLabel,
} from '../utils/plans/revisionActions';
import {
  parsePlanSheetFileMap, localSheetFileFor, filesToKeep, planSheetFileName,
} from '../utils/fieldDayPackCore';
import {
  planScopeFor, allPlanDocIds, planOnlySources, mayWritePlanIndex, tierMeets, ownerPlanRefusal,
} from '../supabase/functions/project-memory-embed/planScope';
import { FEATURE_REGISTRY } from '../utils/featureRegistry';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments stripped — a rule about CODE must not be satisfied by
 *  prose describing the bug it prevents. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
/** The body of `name` up to its first top-level closing brace line. */
const fnBody = (src: string, start: string) => {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const rest = src.slice(i);
  const end = rest.indexOf('\n}\n');
  return end < 0 ? rest : rest.slice(0, end);
};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#73 the plan screens open for the job, not only for the tier');
{
  const g = (o: Partial<Parameters<typeof planScreenGate>[0]>) =>
    planScreenGate({ canAccess: false, roleLoading: false, roleError: false, role: 'owner', ...o });
  ok('project access (tier OR grant) opens the screen', g({ canAccess: true, role: 'field' }) === 'open');
  ok('a role read in flight is a spinner, never a paywall flash', g({ roleLoading: true, role: null }) === 'loading');
  ok('a failed role read is a retry, not an upgrade prompt', g({ roleError: true, role: null }) === 'error');
  ok('a null role after loading is "no access", never a spinner forever', g({ role: null }) === 'no_access');
  ok('a free OWNER still meets the paywall', g({ role: 'owner' }) === 'locked');
  ok('own-tier access does not wait for the role read', g({ canAccess: true, roleLoading: true, role: null }) === 'open');

  ok('field cannot import (owner quota / editor+ storage) and is told why', /owner or an editor/.test(planControlBlock('field', 'import') ?? ''));
  ok('viewer cannot compare, with a reason', !!planControlBlock('viewer', 'compare'));
  ok('an editor may import and compare', planControlBlock('editor', 'import') === null && planControlBlock('editor', 'compare') === null);
  ok('only the owner deletes a sheet', planControlBlock('editor', 'delete') !== null && planControlBlock('owner', 'delete') === null);
  ok('field cannot start a room estimate', !!planControlBlock('field', 'estimate'));
  // wave 4 #114: the server lets an editor index (planScope mayWritePlanIndex);
  // viewer and field seats stay refused, in the server's own words.
  ok('the owner or an editor builds the Ask index; viewer / field do not',
    planControlBlock('editor', 'index') === null && planControlBlock('owner', 'index') === null
    && !!planControlBlock('viewer', 'index') && !!planControlBlock('field', 'index')
    && /owner or an editor indexes/.test(planControlBlock('field', 'index') ?? ''));
  ok('an unresolved role is refused as "checking", not waved through', /Checking/.test(planControlBlock(null, 'import') ?? ''));
  // Round 2: a null role is refused with the sentence true for WHY it is null.
  ok('a FAILED role read says so and points at Try again (not "checking")',
    /Couldn\u2019t check your role on this job/.test(planControlBlock(null, 'delete', { isError: true }) ?? '')
    && !/Checking/.test(planControlBlock(null, 'delete', { isError: true }) ?? ''));
  ok('an offline-paused role read says it waits for signal', /offline/.test(planControlBlock(null, 'import', { offline: true }) ?? ''));
  ok('an offline-paused read on the screen gate is the retry, never "no access"', g({ role: null, offline: true }) === 'error');
  ok('the job\'s owner (projects.user_id) keeps his controls through a failed read',
    effectivePlanRole(null, { ownerUserId: 'u1' }, 'u1') === 'owner'
    && planControlBlock(effectivePlanRole(null, { ownerUserId: 'u1' }, 'u1'), 'delete', { isError: true }) === null);
  ok('…but a collaborator\'s null role is never inferred', effectivePlanRole(null, { ownerUserId: 'gc' }, 'u1') === null
    && effectivePlanRole(null, {}, 'u1') === null && effectivePlanRole('viewer', { ownerUserId: 'u1' }, 'u1') === 'viewer');
  ok('a viewer may not mark up, and is told to ask for a field seat', /field seat/.test(planControlBlock('viewer', 'markup') ?? ''));
  ok('field / editor / owner may mark up', ['field', 'editor', 'owner'].every(r => planControlBlock(r as 'field', 'markup') === null));
  ok('an unresolved role may not mark up', !!planControlBlock(null, 'markup'));

  const plans = code('app/plans.tsx');
  ok('Plans gates on useProjectAccess(projectId), not the own-tier hook',
    /useProjectAccess\(projectId\)/.test(plans) && /const planAccess = canAccess\('plan_markup'\);/.test(plans)
    && /planScreenGate\(\{ canAccess: planAccess,/.test(plans) && /if \(!planAccess\) \{\n\s+return gate === 'locked'/.test(plans)
    && !/const \{ canAccess[^}]*\} = useTierAccess\(\)/.test(plans));
  ok('Plans honours the loading / error / no-access states',
    /gate === 'loading'/.test(plans) && /onRetry=\{roleState\.refetch\}/.test(plans) && /don&apos;t have access to this project/.test(plans));
  ok('Plans import / delete / compare / estimate say why for this seat',
    /if \(importBlock\) \{ showAlert/.test(plans) && /const block = deleteBlockFor\(sheet\);\s*if \(block\) \{ showAlert/.test(plans)
    && /if \(compareBlock\) \{ showAlert/.test(plans) && /if \(estimateBlock\) \{ showAlert/.test(plans));
  ok('Plans\' controls act on the owner-aware role and the read\'s status, with a Try again',
    /const seatRole = effectivePlanRole\(role, project, authUser\?\.id\);/.test(plans)
    && /sheetDeleteBlock\(seatRole, sheet, authUser\?\.id, roleStatus\)/.test(plans)
    && /seatRole === null && roleState\.isError \?/.test(plans) && /plans-role-banner-retry/.test(plans));
  // Round 2: the Ask sheet must not sit under the iOS keyboard.
  const askModal = plans.slice(plans.indexOf('<Modal visible={askOpen}'), plans.indexOf('</Modal>', plans.indexOf('<Modal visible={askOpen}')));
  ok('the Ask sheet avoids the keyboard (iOS padding) and shrinks to fit',
    /<KeyboardAvoidingView\s+behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}/.test(askModal)
    && askModal.indexOf('<KeyboardAvoidingView') < askModal.indexOf('plans-ask-modal')
    && /flexShrink: 1/.test(askModal) && /maxHeight: '92%'/.test(askModal));

  const pv = code('app/plan-viewer.tsx');
  const wrapper = fnBody(pv, 'export default function PlanViewerScreen()');
  ok('the viewer resolves the sheet\'s project BEFORE the access hook',
    wrapper.indexOf('getPlanSheet(sheetId)') > 0 && wrapper.indexOf('getPlanSheet(sheetId)') < wrapper.indexOf('useProjectAccess(projectId)'));
  ok('the viewer gates on the project, not on useTierAccess',
    /const planAccess = canAccess\('plan_markup'\);/.test(wrapper) && /planScreenGate\(\{ canAccess: planAccess,/.test(wrapper) && !/useTierAccess\(\)/.test(wrapper));
  ok('the viewer shows a spinner / retry / no-access, never a paywall, for a collaborator still resolving',
    /if \(gate === 'locked'\) \{/.test(pv) && /plan-viewer-role-retry/.test(pv) && /gate === 'loading'/.test(pv));
  const firstReturn = wrapper.indexOf('return');
  ok('no hook runs after the wrapper\'s first return (no conditional hooks)',
    firstReturn > 0 && !/\buse[A-Z]\w*\(/.test(wrapper.slice(firstReturn)));
  ok('the viewer\'s compare buttons say why for a field / viewer seat',
    /planControlBlock\(seatRole, 'compare', roleStatus\)/.test(pv) && /if \(compareBlock\) \{ showAlert/.test(pv));
  const inner = fnBody(pv, 'function PlanViewerScreenInner(');
  ok('a viewer seat\'s pin / draw / calibrate / number / undo / clear controls refuse with the reason',
    /planControlBlock\(seatRole, 'markup', roleStatus\)/.test(inner)
    && /if \(mode === 'pin'\) \{\n\s+if \(refuseMarkup\(\)\) return;/.test(inner)
    && /mode !== 'draw' \|\| markupBlock/.test(inner)
    && /onPress=\{\(\) => \{ if \(refuseMarkup\(\)\) return; switchMode\('draw'\); \}\}/.test(inner)
    && /onPress=\{\(\) => \{ if \(refuseMarkup\(\)\) return; setNumberDraft/.test(inner)
    && /testID="plan-viewer-tool-calibrate"\n\s+onPress=\{\(\) => \{\n\s+if \(refuseMarkup\(\)\) return;/.test(inner)
    && /if \(refuseMarkup\(\)\) return; undoLastMarkup\(\);/.test(inner)
    && /if \(markups\.length === 0\) return;\n\s+if \(refuseMarkup\(\)\) return;/.test(inner));
  ok('the pin sheet is read-only for a viewer, with the reason shown',
    /readOnlyReason=\{markupBlock\}/.test(inner) && /editable=\{!readOnlyReason\}/.test(pv) && /pin-read-only-reason/.test(pv)
    && /onUpdate=\{\(updates\) => \{\n\s+if \(refuseMarkup\(\)\) return;/.test(inner)
    && /onDelete=\{\(\) => \{\n\s+if \(refuseMarkup\(\)\) return;/.test(inner)
    && /onRaiseRfi=\{\(\) => \{ if \(refuseMarkup\(\)\) return;/.test(inner)
    && /onCreatePunch=\{\(d\) => \{ if \(refuseMarkup\(\)\) return;/.test(inner)
    && /if \(!selectedPin \|\| refuseMarkup\(\)\) return;/.test(inner));

  const cd = code('app/compare-drawings.tsx');
  ok('Compare itself refuses a field / viewer seat with the reason',
    /planControlBlock\(seatRole, 'compare'\)/.test(cd) && /compare-role-retry/.test(cd));
  ok('Compare never holds the job\'s owner on the role read, and offline is a retry, not "no access"',
    /const seatRole = effectivePlanRole\(roleState\.role, project, authUser\?\.id\);/.test(cd)
    && /const roleFailed = seatRole === null && !roleState\.isLoading && \(roleState\.isError \|\| offline\);/.test(cd)
    && /if \(roleWaiting \|\| roleFailed \|\| compareBlock\) \{/.test(cd));
  const panelSrc = code('components/plans/AskPlansPanel.tsx');
  ok('Ask\'s Index acts on the owner-aware role and offers Try again on a failed read',
    /effectivePlanRole\(role, getProject\(projectId\), user\?\.id\)/.test(panelSrc)
    && /planControlBlock\(role, 'index', roleStatus\)/.test(panelSrc) && /ask-plans-role-retry/.test(panelSrc)
    && /roleState\.isError \|\| \(offline && role === null\)/.test(panelSrc));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#77 / #164 a pin RFI says where, attaches the sheet, and is due in 14 calendar days');
{
  const sheet = { projectId: 'p1', sheetNumber: 'A-201', name: 'Second floor' };
  const evening = new Date(2026, 8, 18, 18, 0, 0); // 6 pm local
  const r = rfiFromPin(sheet, { x: 0.12, y: 0.2, label: 'beam pocket' }, evening, {
    sheetImageUri: 'https://x.supabase.co/storage/v1/object/sign/plan-sheets/p1/a.png?token=t',
    photo: { id: 'ph1', uri: 'file:///photo.jpg' },
  });
  ok('the question never points at a mark the recipient cannot see', !/marked/i.test(r.question), r.question);
  ok('the question names the sheet and the position in words',
    /A-201/.test(r.question) && /upper-left/.test(r.question) && /12% from the left, 20% from the top/.test(r.question), r.question);
  ok('the linked photo stays attachment 0 (rfi.tsx reads its markup there)', r.attachments[0] === 'file:///photo.jpg');
  ok('the drawing itself is attached after it', /plan-sheets\/p1\/a\.png/.test(r.attachments[1] ?? ''));
  ok('#146: the photo\'s id rides as sourcePhotoId', (r as { sourcePhotoId?: string }).sourcePhotoId === 'ph1');
  ok('#164: due exactly 14 calendar days out, as a calendar day', r.dateRequired === '2026-10-02', r.dateRequired);
  ok('dateSubmitted stays an instant', /T/.test(r.dateSubmitted));
  const bare = rfiFromPin(sheet, { x: 0.5, y: 0.5 }, evening, { sheetImageUri: attachableSheetUri('p1/a.png') });
  ok('a bare storage path is not attached (nobody can open it)', bare.attachments.length === 0);
  ok('with no sheet attached the question does not claim one', !/attached/.test(bare.question) && /centre of the sheet/.test(bare.question), bare.question);
  ok('position zones read naturally', pinPositionPhrase(0.9, 0.9).startsWith('lower-right') && pinPositionPhrase(0.5, 0.1).startsWith('upper centre'));

  const oldS = { projectId: 'p1', sheetNumber: 'A-201', name: 'x', revision: 1 };
  const c = rfiFromCandidate({ subject: 's', question: 'q' }, oldS, 'ASI', new Date(), {
    sheetImages: ['https://h/old.png', 'https://h/new.png', 'file:///local.png', null],
  });
  ok('a Compare RFI attaches BOTH revisions (old, then new)', c.attachments.join(',') === 'https://h/old.png,https://h/new.png', c.attachments.join(','));
  ok('a Change RFI does too', rfiFromChange({ description: 'd' }, oldS, null, new Date(), { sheetImages: ['https://h/o.png'] }).attachments.length === 1);
  ok('the 4-arg call is unchanged (no attachments)', rfiFromCandidate({ subject: 's', question: 'q' }, oldS, null, new Date()).attachments.length === 0);

  const pv = code('app/plan-viewer.tsx');
  const raise = pv.slice(pv.indexOf('const handleRaiseRfi'), pv.indexOf('const openLinkedRfi'));
  ok('the viewer raises pin RFIs through rfiFromPin with the sheet and photo',
    /addRFI\(rfiFromPin\(/.test(raise) && /sheetImageUri: sheetAttachmentFor\(sheet\)/.test(raise) && /photo: linkedPhoto\?\.uri/.test(raise));
  ok('#164: no 14 × 86_400_000 instant is written as a due date', !/86_400_000\)\.toISOString\(\)/.test(pv));
  const cd = code('app/compare-drawings.tsx');
  ok('Compare passes both drawings to the RFI',
    /rfiFromCandidate\(candidate, oldSheet, newPageLabel, new Date\(\), \{ newSheet: pairNew, sheetImages: comparedSheetImages \}\)/.test(cd)
    && /rfiFromChange\(change, oldSheet, newPageLabel, new Date\(\), \{ newSheet: pairNew, sheetImages: comparedSheetImages \}\)/.test(cd)
    // wave 4 #113: the DURABLE keys, never the signed urls the screen draws.
    && /oldSheet \? sheetAttachmentFor\(oldSheet\) : ''/.test(cd)
    && /pairNew \? sheetAttachmentFor\(pairNew\) : \(attachableSheetUri\(newPagePath\) \|\| newPageUrl\)/.test(cd));

  // The architect page: run its attachment filter, don't grep it.
  const html = read('marketing/architect/index.html');
  const src = html.slice(html.indexOf('function viewableAttachments'), html.indexOf('function renderRFI'));
  const ctx: Record<string, unknown> = { SUPABASE_URL: 'https://nteoqhcswappxxjlpvap.supabase.co', escHtml: (s: string) => String(s) };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const view = (ctx.viewableAttachments as (l: unknown) => string[]);
  const block = (ctx.attachmentBlock as (l: unknown) => string);
  const signed = 'https://nteoqhcswappxxjlpvap.supabase.co/storage/v1/object/sign/plan-sheets/p/a.png?token=1';
  ok('the portal shows our own storage links', view([signed]).length === 1);
  ok('…and never a foreign or device-only one', view(['https://evil.example/x.png', 'file:///a.jpg', 'https://nteoqhcswappxxjlpvap.supabase.co.evil.io/storage/v1/object/x']).length === 0);
  ok('a shown attachment is an image tile that opens full size', /<img src="https:\/\/nteoqhcswappxxjlpvap/.test(block([signed])) && /target="_blank"/.test(block([signed])));
  ok('an unviewable attachment is still counted, pointing to the email', /1 more attachment was sent with the original email/.test(block([signed, 'file:///a.jpg'])));
  ok('with no tile, the count alone (no "more")', /^<div class="att-note">2 attachments were sent with the original email\.<\/div>$/.test(block(['file:///a.jpg', 'x'])));
  const rfiCard = html.slice(html.indexOf('function renderRFI'), html.indexOf('function', html.indexOf('function renderRFI') + 20));
  ok('the RFI card renders the block and no second attachment count', /attachmentBlock\(rfi\.attachments(, rfi\.pin_marks)?(, signedSheets)?\)/.test(rfiCard)
    && !/included with the original/.test(rfiCard) && !/attCount/.test(rfiCard));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#78 answers come only from the current revision');
{
  const sheets = [{ id: 'A1', superseded: true }, { id: 'A2' }, { id: 'B1' }];
  const m = (id: string, n = 0) => ({ doc_id: `plan-sheet:${id}${n ? `#${n}` : ''}` });
  const split = splitMatchesByCurrentSheet([m('A1'), m('A2'), m('A2', 1), m('GONE')], sheets);
  ok('a superseded sheet\'s match is dropped', !split.current.some(x => x.doc_id.includes('A1')));
  ok('a deleted sheet\'s match is dropped', !split.current.some(x => x.doc_id.includes('GONE')));
  ok('chunks of a current sheet are kept', split.current.length === 2 && split.staleDropped === 2);
  ok('only-old-revisions never says "not in your plans"', /isn't indexed yet/.test(staleMatchesNote(2, false) ?? '') && !/couldn't find/i.test(staleMatchesNote(2, false) ?? ''));
  ok('a mixed answer still says what was left out', /2 matches came from a superseded or deleted sheet/.test(staleMatchesNote(2, true) ?? ''));
  ok('nothing dropped, nothing said', staleMatchesNote(0, true) === null);
  ok('the index button names changed sheets', changedSinceIndexLabel(3) === 'Index 3 changed sheets — answers may be from older revisions');
  ok('an unreadable manifest claims nothing', changedSinceIndexLabel(null) === null);

  const ayp = code('utils/plans/askYourPlans.ts');
  const ask = ayp.slice(ayp.indexOf('export async function askPlans'));
  ok('askPlans takes the current sheet list', /export async function askPlans\(projectId: string, question: string, sheets: PlanSheet\[\]\)/.test(ayp));
  ok('stale matches are split off BEFORE the floor and the prompt',
    ask.indexOf('splitMatchesByCurrentSheet(sourced, sheets)') > 0
    && ask.indexOf('splitMatchesByCurrentSheet(sourced, sheets)') < ask.indexOf('confidentMatches(planMatches)')
    && ask.indexOf('confidentMatches(planMatches)') < ask.indexOf('await mageAI('));
  ok('only-stale matches return before the model is paid',
    /if \(matches\.length === 0 && staleDropped > 0\) \{/.test(ask) && ask.indexOf('staleDropped > 0) {') < ask.indexOf('await mageAI('));
  ok('one manifest helper serves the run and the panel', /readPlanIndexManifest\(projectId, sheets, true\)/.test(ayp));

  const panel = code('components/plans/AskPlansPanel.tsx');
  ok('the panel asks with its sheets', /askPlans\(projectId, q, sheets\)/.test(panel));
  ok('the panel checks the manifest on open without pruning', /readPlanIndexManifest\(projectId, sheetsRef\.current, false\)/.test(panel));
  ok('a citation chip can only open a CURRENT sheet', /s\.id === c\.sheetId && !s\.superseded/.test(panel));
  ok('the panel shows the stale-match line', /staleMatchesNote\(staleDropped/.test(panel) && /ask-plans-stale-note/.test(panel));
  ok('the "couldn\'t find" line is not shown when only old revisions matched', /noneFound && staleDropped === 0 &&/.test(panel));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#80 the offline claim covers files the viewer renders');
{
  const map = parsePlanSheetFileMap(JSON.stringify({
    userId: 'u1',
    files: { 'p/a.png': { uri: 'file:///docs/mageid-plan-sheets/u1/1.png', savedAt: 5 }, 'p/b.png': { uri: 'https://x/b.png' } },
  }));
  ok('a map parses, and a non-file entry is not trusted', !!map && Object.keys(map.files).join() === 'p/a.png');
  ok('the viewer finds the file by storage path', localSheetFileFor(map, 'u1', 'p/a.png') === 'file:///docs/mageid-plan-sheets/u1/1.png');
  ok('another account never reads this map', localSheetFileFor(map, 'u2', 'p/a.png') === null);
  ok('signed out reads nothing', localSheetFileFor(map, null, 'p/a.png') === null);
  ok('garbage is no files, not coverage', parsePlanSheetFileMap('{{') === null && parsePlanSheetFileMap(JSON.stringify({ files: {} })) === null);
  ok('a warm keeps only this pack\'s sheets', Object.keys(filesToKeep(map, 'u1', ['p/a.png', 'p/new.png']).files).join() === 'p/a.png');
  ok('a warm never keeps another user\'s entries', Object.keys(filesToKeep(map, 'u2', ['p/a.png']).files).length === 0);
  ok('file names keep the image extension', /\.jpg$/.test(planSheetFileName('p/x.JPG', () => 'h')) && planSheetFileName('p/x', () => 'h') === 'h.png');

  const pf = code('utils/planPrefetch.ts');
  const warm = fnBody(pf, 'export async function warmFieldDayPack');
  ok('the day pack counts FILES that landed, not cache hits',
    /const warmOne = \(uri: string\): Promise<boolean> => downloadSheetToDevice\(userId, uri\)/.test(warm) && !/Image\.prefetch/.test(warm));
  ok('…and commits the path → file map after the warm', /await commitPlanSheetFiles\(userId, plan\.allocations\.flatMap\(a => a\.uris\)\)/.test(warm));
  ok('a pre-#80 record is not believed (new key)', /DAY_PACK_KEY = 'mageid_field_daypack_v2'/.test(pf));
  const lf = code('utils/planSheetLocalFiles.ts');
  ok('the file map key carries a sweepable mageid_ prefix', /PLAN_SHEET_FILES_KEY = 'mageid_/.test(lf));
  ok('files live in a per-user folder', /\$\{root\}\$\{userId\}\//.test(lf));
  ok('a download counts only with bytes on disk', /if \(!info\.exists \|\| !\('size' in info\) \|\| !info\.size\) return false;/.test(lf));
  ok('the viewer renders the local file first', /source=\{\{ uri: sheetUri\(sheet\) \}\}/.test(code('app/plan-viewer.tsx')));
  ok('the Plans list renders the local file first', /source=\{\{ uri: sheetUri\(s\) \}\}/.test(code('app/plans.tsx')));
  ok('the planPrefetch header no longer claims the viewer reads expo-image\'s cache',
    !/drops bytes into the same disk cache the\s*\n?\/\/ <Image> component reads from/.test(read('utils/planPrefetch.ts')));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#161 the plan index belongs to the project');
{
  ok('the owner is scoped to himself', JSON.stringify(planScopeFor('o', { ownerId: 'o' }, null)) === JSON.stringify({ indexUserId: 'o', meterUserId: 'o', role: 'owner' }));
  const f = planScopeFor('f', { ownerId: 'o' }, 'field');
  ok('a collaborator reads the OWNER\'s index and is metered on the owner', f?.indexUserId === 'o' && f?.meterUserId === 'o' && f?.role === 'field');
  ok('no accepted row → no scope (generic 403)', planScopeFor('x', { ownerId: 'o' }, null) === null && planScopeFor('x', { ownerId: 'o' }, 'owner') === null);
  ok('no project → no scope', planScopeFor('x', null, 'editor') === null);
  ok('only owner / editor write the index', mayWritePlanIndex('owner') && mayWritePlanIndex('editor') && !mayWritePlanIndex('field') && !mayWritePlanIndex('viewer'));
  ok('owner scoping is for plan-sheet docs ONLY',
    allPlanDocIds(['plan-sheet:a', 'plan-sheet:b#1']) && !allPlanDocIds(['plan-sheet:a', 'rfi-1']) && !allPlanDocIds([]));
  ok('a Project Memory search is never owner-scoped', !planOnlySources(['Plan Sheet', 'RFI']) && planOnlySources(['Plan Sheet']) && !planOnlySources([]));
  ok('tier rank: business meets pro, pro does not meet business', tierMeets('business', 'pro') && !tierMeets('pro', 'business'));
  ok('a collaborator\'s refusal is about the OWNER\'s plan', /project owner's plan/.test(ownerPlanRefusal('Ask Your Plans', 'pro')));

  const search = code('supabase/functions/project-memory-search/index.ts');
  ok('search resolves the owner for a plan-only search and reads HIS rows',
    /if \(planOnlySources\(sources\)\) \{/.test(search) && /resolvePlanScope\(auth\.userId, projectId\)/.test(search) && /p_user_id: indexUserId/.test(search));
  ok('search meters the owner and keeps the hourly bucket on the caller',
    /MONTHLY_CAPS\[meter\.tier\]/.test(search) && /aiUsageGet\(meter\.userId, "project_memory"\)/.test(search)
    && /aiUsageIncrement\(meter\.userId, "project_memory", 1\)/.test(search) && /rateLimitCount\(`pm:\$\{auth\.userId\}`\)/.test(search));
  ok('a non-plan search still needs the caller\'s own pro tier', /\} else if \(!tierMeets\(auth\.tier, "pro"\)\) \{/.test(search));

  const embed = code('supabase/functions/project-memory-embed/index.ts');
  ok('embed scopes plan-sheet docs to the owner', /if \(projectId && allPlanDocIds\(scopeIds\)\) \{/.test(embed) && /user_id: indexUserId,/.test(embed));
  ok('embed meters the owner per doc', /aiUsageIncrement\(meter\.userId, "project_memory", docs\.length\)/.test(embed) && /MONTHLY_CAPS\[meter\.tier\]/.test(embed));
  ok('a viewer / field seat cannot embed into the owner\'s index', /if \(planScope && !mayWritePlanIndex\(planScope\.role\)\) \{/.test(embed));
  ok('…nor prune it (and is told)', /const pruneNotAllowed = body\.prune === true && !!planScope && !mayWritePlanIndex\(planScope\.role\);/.test(embed)
    && /const prune = body\.prune === true && scope\.length > 0 && !pruneNotAllowed;/.test(embed));
  ok('manifest reads and prunes the owner\'s rows', /readIndexState\(indexUserId, projectId, readPrefixes\)/.test(embed) && /deleteDocs\(indexUserId, projectId, diff\.prune\)/.test(embed));

  const pe = code('supabase/functions/plan-extract/index.ts');
  ok('plan-extract meters a project sheet on the owner\'s Business plan',
    /resolvePlanScope\(auth\.userId, planSheetProjectId\(body\.storagePath\)\)/.test(pe) && /if \(!tierMeets\(meter\.tier, "business"\)\) \{/.test(pe)
    && /aiUsageGet\(meter\.userId, "plan_extract"\)/.test(pe) && /aiUsageIncrement\(meter\.userId, "plan_extract"\)/.test(pe));
  ok('plan-extract keeps its hourly bucket on the caller', /rateLimitCount\(`plan-extract:user:\$\{auth\.userId\}`\)/.test(pe));
  ok('only owner / editor spend the owner\'s extracts', /if \(!mayWritePlanIndex\(scope\.role\)\) \{/.test(pe));
  ok('the tier gate runs BEFORE any spend', pe.indexOf('tierMeets(meter.tier, "business")') < pe.indexOf('await callGemini('));

  const panel = code('components/plans/AskPlansPanel.tsx');
  ok('the panel honours the collaborator grant (server now scopes to the owner)',
    /useProjectAccess\(projectId\)/.test(panel) && /canAccess\('ask_your_plans'\)/.test(panel) && !/useTierAccess/.test(panel));
  ok('Index is the owner\'s; a collaborator is told why', /planControlBlock\(role, 'index', roleStatus\)/.test(panel) && /ask-plans-index-blocked/.test(panel));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#163 Ask has its own door');
{
  const plans = code('app/plans.tsx');
  const cta = plans.slice(plans.indexOf('testID="plans-ask-cta"') - 400, plans.indexOf('testID="plans-ask-cta"'));
  ok('the Plans Ask CTA opens the Ask sheet, not Plan Intelligence', /onPress=\{\(\) => setAskOpen\(true\)\}/.test(cta) && !/plan-intelligence/.test(cta));
  ok('the Ask sheet hosts AskPlansPanel', /<AskPlansPanel projectId=\{project\.id\} sheets=\{allSheets\}/.test(plans));
  ok('the viewer\'s Ask button opens it too', /pathname: '\/plans' as never, params: \{ projectId: sheet\.projectId, ask: '1' \}/.test(code('app/plan-viewer.tsx')));
  ok('`ask=1` opens the sheet on arrival', /useState<boolean>\(params\.ask === '1'\)/.test(plans));
  const panel = code('components/plans/AskPlansPanel.tsx');
  ok('the Business lock has a way through it', /label="See Business plan"/.test(panel));
  const pi = code('app/plan-intelligence.tsx');
  ok('the estimate picker lists current sheets only', /getPlanSheetsForProject\(projectId\)\.filter\(s => !s\.superseded\)/.test(pi));
  ok('the picker says a tap starts an estimate', /Estimate rooms from a sheet/.test(pi) && /uses your AI allowance/.test(pi));
  ok('the estimating screen no longer hosts the Ask box', !/<AskPlansPanel/.test(pi));
  const byId = new Map(FEATURE_REGISTRY.map(e => [e.id, e]));
  ok('search "ask your plans" lands on Plans', byId.get('plans')?.synonyms.includes('ask your plans') === true);
  ok('…not on the estimating screen', byId.get('plan-intelligence')?.synonyms.includes('ask your plans') === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
