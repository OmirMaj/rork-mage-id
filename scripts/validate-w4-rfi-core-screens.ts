// validate-w4-rfi-core-screens.ts — wave 4, lane rfi-core: the client half of
// #25 #28 #29 #31 #92 #96 #97 #98 (audit 2026-09-19).
//
//   #25  A live refresh that brings the architect's answer into a Response he
//        is typing is REPORTED as a conflict; the RFI screen blocks Save until
//        he keeps theirs or replaces it with his.
//   #28  The portal takes an RFI / submittal number from live, never the frozen
//        guess; the Outbox prints recordNumberLabel and holds unconfirmed ones
//        out of Send all; the email-triage toast prints no guessed number.
//   #29  Only a queued INSERT makes a number '(pending #)'.
//   #31  Reopen is locked only with an answer on record; a reopen hands the
//        ball closed → gc; Mark complete on an unanswered RFI asks first.
//   #92  The architect page shows a closed banner (no form) and says a second
//        answer is added below the first.
//   #96  Relink / unlink of a schedule-sourced submittal → 'manual'; the label
//        is recomputed from today's schedule, naming the task and its start,
//        with 'Schedule moved: was X, now Y' and a one-tap update.
//   #97  Each RFI photo has a confirmed remove X; removing the source photo
//        unlinks it (sourcePhotoId → undefined).
//   #98  Creating an RFI opens it (router.replace to /rfi with its id).
//
// Pure code is EXECUTED (the rfi-core-pure block, insertStillQueued,
// portalLiveOverrides, deriveSubmittalRequiredDateForTask); wiring is pinned.
// Run: bun run scripts/validate-w4-rfi-core-screens.ts
// Mutation hooks: HOOK_PATH / RFI_PATH / SUB_PATH / OUTBOX_PATH / SHEET_PATH /
// TRIAGE_PATH / ARCH_PATH.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { insertStillQueued } from '../utils/invoiceWrites';
import { portalLiveOverrides } from '../utils/portalFreeze';
import { deriveSubmittalRequiredDateForTask } from '../utils/submittalAttachments';

const ROOT = join(__dirname, '..');
const read = (p: string, env?: string) => (env && process.env[env] ? readFileSync(process.env[env] as string, 'utf8') : readFileSync(join(ROOT, p), 'utf8'));
const HOOK = read('hooks/useCollectionSettled.ts', 'HOOK_PATH');
const RFI = read('app/rfi.tsx', 'RFI_PATH');
const SUB = read('app/submittal.tsx', 'SUB_PATH');
const OUTBOX = read('app/client-outbox.tsx', 'OUTBOX_PATH');
const SHEET = read('components/EntityActionSheet.tsx', 'SHEET_PATH');
const TRIAGE = read('components/RFITriageModal.tsx', 'TRIAGE_PATH');
const ARCH = read('marketing/architect/index.html', 'ARCH_PATH');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
const start = HOOK.indexOf('// >>> rfi-core-pure');
const end = HOOK.indexOf('// <<< rfi-core-pure');
ok('useCollectionSettled carries the rfi-core-pure block', start > -1 && end > start);
type H = { at: string; fromParty: string; toParty: string; note?: string };
interface Pure {
  rfiRegressionReason: (o: { status: string; response?: string; dateResponded?: string }, f: { status: string; response: string }) => string | null;
  rfiBallAfterSave: (p: { prevBall?: string; handoffs?: H[]; status: string; responseTyped: boolean; dateResponded?: string; now: string }) => { ball: string; added: H[] };
  rebaseFormOnLive: (o: Record<string, unknown>, f: Record<string, unknown>, l: Record<string, unknown>) => Record<string, unknown>;
  rebaseFormOnLiveWithConflicts: (o: Record<string, unknown>, f: Record<string, unknown>, l: Record<string, unknown>) => { next: Record<string, unknown>; conflicts: string[] };
  RFI_RESPONSE_CONFLICT_REASON: string;
}
const P = start > -1 && end > start
  ? new Function(`${new Transpiler({ loader: 'ts' }).transformSync(HOOK.slice(start, end).replace(/^export /gm, ''))}
    return { rfiRegressionReason, rfiBallAfterSave, rebaseFormOnLive, rebaseFormOnLiveWithConflicts, RFI_RESPONSE_CONFLICT_REASON };`)() as Pure
  : null;

console.log('\n#25 the architect answered while he typed');
if (P) {
  const opened = { subject: 'Joist', response: '', status: 'open' };
  const form = { subject: 'Joist', response: 'use 2x10', status: 'answered' };
  const live = { subject: 'Joist', response: '2x10 @ 16" o.c., LUS210', status: 'answered' };
  const r = P.rebaseFormOnLiveWithConflicts(opened, form, live);
  ok('a different incoming answer in a field he typed is a conflict', JSON.stringify(r.conflicts) === '["response"]', JSON.stringify(r.conflicts));
  ok('…his text is still what the form holds (nothing thrown away)', r.next.response === 'use 2x10');
  ok('the same status on both sides is not a conflict', !r.conflicts.includes('status'));
  ok('an untouched field takes live, no conflict', P.rebaseFormOnLiveWithConflicts(opened, opened, live).conflicts.length === 0);
  ok('the same text on both sides is not a conflict', P.rebaseFormOnLiveWithConflicts(opened, { ...form, response: live.response }, live).conflicts.length === 0);
  ok('rebaseFormOnLive is the same rebase', JSON.stringify(P.rebaseFormOnLive(opened, form, live)) === JSON.stringify(r.next));
  ok('the reason names the choice', /keep theirs, or replace it with yours/.test(P.RFI_RESPONSE_CONFLICT_REASON));
}
{
  const eff = RFI.slice(RFI.indexOf('const lastLiveRef = useRef(existingRFI)'), RFI.indexOf('const lastLiveRef = useRef(existingRFI)') + 2400);
  ok('rfi: the rebase records a Response conflict', /setResponseConflict\(prev => \(conflicts\.includes\('response'\)\s*\? \{ theirs: liveResponse \}/.test(eff));
  // review round 1: a later refresh (base == live after setOpened) reports no
  // conflict — it must not clear a standing one and re-enable Save.
  ok('rfi: a standing conflict survives a later refresh unless live now equals his text',
    /: prev && mine\.trim\(\) !== liveResponse\.trim\(\) \? \{ theirs: liveResponse \} : null\)\);/.test(eff)
    && /const mine = String\(next\.response \?\? ''\);/.test(eff));
  const pf = RFI.slice(RFI.indexOf('const persistForm = useCallback'), RFI.indexOf('const navigation = useNavigation()'));
  ok('rfi: persistForm refuses while the conflict stands, with the reason', /if \(responseConflict\) \{\s*showAlert\('Pick an answer first', RFI_RESPONSE_CONFLICT_REASON\);\s*return null;/.test(pf));
  ok('rfi: both Save buttons are disabled while it stands, and say why',
    /testID="rfi-save-conflict"/.test(RFI) && /disabled=\{!!responseConflict\}[^>]*testID="rfi-save-in-place"/.test(RFI) && /disabled=\{!!responseConflict\}[^>]*testID="rfi-save"/.test(RFI));
  ok('rfi: the banner shows theirs with Keep theirs / Replace with mine',
    /testID="rfi-response-conflict"/.test(RFI) && /setResponse\(responseConflict\.theirs\); setResponseConflict\(null\);/.test(RFI) && /label="Replace with mine"/.test(RFI));
}

console.log('\n#29 only a queued INSERT means no number');
{
  const q = [{ table: 'rfis', operation: 'update', data: { id: 'r1' } }, { table: 'rfis', operation: 'insert', data: { id: 'r2' } }, { table: 'submittals', operation: 'insert', data: { id: 'r1' } }];
  ok('a queued UPDATE of a numbered RFI is not pending', insertStillQueued(q, 'rfis', 'r1') === false);
  ok('a queued INSERT is pending', insertStillQueued(q, 'rfis', 'r2') === true);
  ok('the table must match', insertStillQueued(q, 'submittals', 'r2') === false);
  const hook = HOOK.slice(HOOK.indexOf('export function useServerRecordNumber'));
  ok('useServerRecordNumber asks insertStillQueued, not pendingIdsForTable',
    /queued = insertStillQueued\(await getOfflineQueue\(\), table, id\)/.test(hook) && !/pendingIdsForTable/.test(HOOK));
}

console.log('\n#31 reopen');
if (P) {
  ok('a closed RFI with NOTHING on record reopens', P.rfiRegressionReason({ status: 'closed' }, { status: 'open', response: '' }) === null);
  ok('an answered one with a response stays locked, saying the response is on record', /response is on record/.test(P.rfiRegressionReason({ status: 'answered', response: 'x' }, { status: 'open', response: 'x' }) ?? ''));
  const dayOnly = P.rfiRegressionReason({ status: 'closed', dateResponded: '2026-09-10' }, { status: 'open', response: '' }) ?? '';
  ok('a date with no text locks and never claims a response', /day it was answered/.test(dayOnly) && !/response is on record/.test(dayOnly));
  const now = '2026-09-19T12:00:00.000Z';
  const re = P.rfiBallAfterSave({ prevBall: 'closed', handoffs: [], status: 'open', responseTyped: false, now });
  ok('a reopen hands the ball closed → gc with a handoff', re.ball === 'gc' && re.added.length === 1 && re.added[0].fromParty === 'closed' && re.added[0].toParty === 'gc' && /reopened/.test(re.added[0].note ?? ''), JSON.stringify(re));
  ok('voiding a closed RFI keeps the ball closed', P.rfiBallAfterSave({ prevBall: 'closed', handoffs: [], status: 'void', responseTyped: false, now }).ball === 'closed');
  ok('closing still sends it to closed', P.rfiBallAfterSave({ prevBall: 'gc', handoffs: [], status: 'closed', responseTyped: false, now }).ball === 'closed');
}
{
  const run = SHEET.slice(SHEET.indexOf('const runSelfWired'), SHEET.indexOf("if (ref.kind === 'punchItem' && id === 'markComplete')"));
  ok('Mark complete on an unanswered RFI asks first',
    /if \(!\(rfi\.response \?\? ''\)\.trim\(\)\) \{\s*showAlert\(\s*'Close this RFI without a response\?'/.test(run) && /text: 'Close RFI', style: 'destructive'/.test(run));
  ok('…the answered path still closes directly', /updateRFI\(ref\.id, rfiClosePatch\(rfi, now\)\);\s*return;/.test(run));
}

console.log('\n#28 the number is the server\'s');
{
  const o = portalLiveOverrides('rfi', { status: 'open', number: 8, question: 'q' });
  ok('portal: an RFI takes status AND number from live', o.number === 8 && o.status === 'open' && !('question' in o));
  ok('portal: a submittal too', portalLiveOverrides('submittal', { status: 'approved', number: 3 }).number === 3);
  ok('portal: a change order is unchanged (status only)', JSON.stringify(Object.keys(portalLiveOverrides('change_order', { status: 'approved', number: 2 }))) === '["status"]');
  ok('Outbox: titles use recordNumberLabel, never `#${number}`',
    /title: recordNumberLabel\('RFI', numberOf\(rfi\.id\)\.state, numberOf\(rfi\.id\)\.number, rfi\.number\)/.test(OUTBOX)
    && /title: recordNumberLabel\('Submittal', numberOf\(sb\.id\)\.state/.test(OUTBOX) && !/`RFI #\$\{/.test(OUTBOX));
  ok('Outbox: numbers come from the server, a queued INSERT is pending',
    /insertStillQueued\(queue, r\.table, r\.id\)\) out\[r\.id\] = \{ state: 'pending' \}/.test(OUTBOX) && /\.select\('id, number'\)\.in\('id', chunk\)/.test(OUTBOX));
  // review round 1: ask only about rows on screen, in chunks, and skip queue
  // changes that don't move our rows' queued INSERTs.
  ok('Outbox: numbers are read only for the rows it lists',
    /rfis\.filter\(r => r\.projectId === projectId && isOutboxCandidate\(/.test(OUTBOX)
    && /submittals\.filter\(x => x\.projectId === projectId && isOutboxCandidate\(/.test(OUTBOX)
    && /const which = isOutboxCandidate\(i\.portalState, getUpdatedAt\(i\)\);/.test(OUTBOX));
  ok('Outbox: the id list is chunked (URL length)',
    /const NUMBER_READ_CHUNK = 100;/.test(OUTBOX) && /ids\.slice\(at, at \+ NUMBER_READ_CHUNK\)/.test(OUTBOX));
  ok('Outbox: an unrelated queue change does not re-read the server',
    /onQueueChanged\(\(\) => check\(true\)\)/.test(OUTBOX) && /if \(onlyIfQueueMoved && sig === lastPendingSig\.current\) return;/.test(OUTBOX));
  ok('Outbox: an unconfirmed RFI / submittal is held out of Send all',
    /const isHeld = useCallback\(\(d: OutboxRow\) => \(d\.kind === 'rfi' \|\| d\.kind === 'submittal'\) && numberOf\(d\.itemId\)\.state !== 'confirmed'/.test(OUTBOX)
    && /items: sendable\.map\(/.test(OUTBOX) && !/items: drafts\.map\(/.test(OUTBOX));
  {
    // Round-2 race: a queue-change ping that returns early must not bump the
    // read generation, or it cancels a full read already in flight.
    const at = OUTBOX.indexOf('if (onlyIfQueueMoved && sig === lastPendingSig.current) return;');
    const bump = OUTBOX.indexOf('const mine = ++seq.current;');
    const body = OUTBOX.slice(OUTBOX.indexOf('const check = useCallback('), at);
    ok('Outbox: a skipped queue ping never cancels an in-flight read (++seq only after the early return)',
      at > 0 && bump > at && !/const mine = \+\+seq\.current/.test(body)
      && /if \(seq\.current !== startedAt\) return;/.test(OUTBOX));
  }
  ok('Outbox: the hold is said, not silent', /testID="outbox-held"/.test(OUTBOX) && /held until/.test(OUTBOX));
  ok('triage toast prints no guessed number', !/rfi\.number/.test(TRIAGE) && /nailIt\('RFI filed/.test(TRIAGE));
}

console.log('\n#92 the architect page');
{
  ok('a closed / void RFI shows the closed banner and no form',
    /rfi\.is_closed === true \|\| rfi\.status === 'closed' \|\| rfi\.status === 'void'/.test(ARCH) && /\(closed \? closedBlock\(\) : buildResponseForm\('rfi', rfi\)\)/.test(ARCH));
  ok('a refusal while the page was open shows it too', /result\.error === 'rfi_closed'/.test(ARCH));
  ok('the old promise is gone; the copy says a revision is added below the first',
    !/see all of them in chronological order/.test(ARCH) && /added below the answer on file/.test(ARCH));
}

console.log('\n#96 a schedule-sourced Required date follows the schedule honestly');
{
  const schedule = { startDate: '2026-10-01', workingDaysPerWeek: 7, nonWorkingDates: [], tasks: [
    { id: 'a', title: 'Hang drywall', startDay: 20, durationDays: 5 },
    { id: 'b', title: 'Level 2 drywall', startDay: 40, durationDays: 5 },
  ] } as unknown as Parameters<typeof deriveSubmittalRequiredDateForTask>[0]['schedule'];
  const a = deriveSubmittalRequiredDateForTask({ schedule, taskId: 'a', leadDays: 14 });
  const b = deriveSubmittalRequiredDateForTask({ schedule, taskId: 'b', leadDays: 14 });
  ok('by task id: names the task and its start', a.taskTitle === 'Hang drywall' && !!a.taskStart && a.requiredDate < (a.taskStart ?? ''), JSON.stringify(a));
  ok('a different task gives a different date', !!b.requiredDate && b.requiredDate > a.requiredDate);
  ok('a task that is gone gives no date', deriveSubmittalRequiredDateForTask({ schedule, taskId: 'zzz', leadDays: 14 }).requiredDate === '');
  const pf = SUB.slice(SUB.indexOf('const persistForm = useCallback'), SUB.indexOf('// Unsaved edits ask before leaving.'));
  ok('relink / unlink of a schedule-sourced date → manual',
    /if \('linkedTaskId' in changed && !\('requiredDate' in changed\) && base\.requiredDateSource === 'schedule'\) \{\s*updates\.requiredDateSource = 'manual';/.test(pf));
  ok('the label is recomputed from today\'s schedule for the linked task',
    /deriveSubmittalRequiredDateForTask\(\{ schedule: project\?\.schedule, taskId: linkedTaskId, leadDays: s\.leadDays \}\)/.test(SUB)
    && /if \(!s \|\| s\.requiredDateSource !== 'schedule' \|\| !linkedTask\) return null;/.test(SUB));
  ok('it names the task and its start', /From the schedule: "\$\{linkedTask\.title\}" starts \$\{formatCalendarDay\(scheduleSource\.live\.taskStart/.test(SUB));
  ok('a moved schedule says was / now with a one-tap update through updateSubmittal',
    /Schedule moved: was \$\{formatCalendarDay\(scheduleSource\.stored\)\}, now/.test(SUB)
    && /updateSubmittal\(existingSubmittal\.id, \{ requiredDate: scheduleSource\.live\.requiredDate, requiredDateSource: 'schedule' \}\)/.test(SUB));
  ok('the old claim about "the linked task\'s start" is gone', !/the linked task's start, less/.test(SUB));
}

console.log('\n#97 a wrong photo can come off');
{
  ok('each thumbnail has a remove X', /testID=\{`rfi-photo-remove-\$\{index\}`\}/.test(RFI) && /onPress=\{\(\) => handleRemovePhoto\(stored, index\)\}/.test(RFI));
  const rm = RFI.slice(RFI.indexOf('const handleRemovePhoto'), RFI.indexOf('const handleRemovePhoto') + 700);
  ok('…confirmed first', /showAlert\('Remove this photo\?'/.test(rm) && /style: 'destructive'/.test(rm));
  ok('…removing the source photo (slot 0) unlinks it', /if \(index === 0 && sourcePhotoId\) setSourceUnlinked\(true\);/.test(rm) && /setAttachments\(prev => prev\.filter\(x => x !== stored\)\)/.test(rm));
  ok('…and the unlink is saved (sourcePhotoId → undefined → NULL)', /if \(sourceUnlinked && sourcePhotoIdOf\(existingRFI\)\) updates\.sourcePhotoId = undefined;/.test(RFI));
  ok('…the unlinked source no longer maps slot 0', /const sourcePhotoId = sourceUnlinked\s*\?\s*undefined/.test(RFI));
}

console.log('\n#98 create opens the RFI');
{
  const hs = RFI.slice(RFI.indexOf('const handleSave = useCallback'), RFI.indexOf('const handleSaveInPlace'));
  ok('the create keeps the record', /const created = addRFI\(\{/.test(hs));
  ok('…and replaces to /rfi with its id (the leave gate opened first)',
    /allowLeave\.current = true;\s*router\.replace\(\{ pathname: '\/rfi', params: \{ projectId: created\.projectId, rfiId: created\.id \} \}\);/.test(hs));
  ok('…with a toast that prints no guessed number', /nailIt\('RFI created — send it when ready'\)/.test(hs));
  ok('an update still goes back', /router\.back\(\);/.test(hs));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
