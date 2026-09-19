// validate-rfi-core-screens.ts — wave 3, lane rfi-core: the RFI and submittal
// screens (audit 2026-09-18 #55 #56 #58 #142 #146 #147 #148, plus #77/#164
// handed over by plans-access-ask).
//
//   #55  A save sends only the fields he changed, diffed against the record the
//        form OPENED with — never the whole form from a copy the architect has
//        since answered. A change the server refuses (reopen an answered RFI,
//        clear a response) is refused on screen first, with the reason.
//   #56  Saving an RFI the portal answered hands the ball back to the GC; the
//        send dialog and the sent alert say the answer comes back through the
//        reply link (pasting is only for an RFI with no link).
//   #58  'Send to Architect' and the client-portal send SAVE FIRST and build
//        from the saved record; leaving with edits asks.
//   #142 A record opened by link waits for its collection to settle, then the
//        form mounts keyed on the record id; gone / not shared says so.
//   #146 'Sent without N attachment(s)' when the device dropped any.
//   #147 The manual cycle form carries Sent / Returned days; a returned stamp
//        needs its Returned day; a cycle with no Sent day says "not recorded".
//        The architect page names the cycle the response closes.
//   #148 The number is the server's: '(pending #)' until read back; the email,
//        the portal send and the transmittal PDF wait for it.
//
// Pure blocks are EXECUTED (hooks/useCollectionSettled.ts rfi-core-pure, the
// architect page's architect-cycle-rule); wiring is pinned.
//
// Run: bun run scripts/validate-rfi-core-screens.ts
// Mutation hooks: HOOK_PATH / RFI_PATH / SUB_PATH / BTN_PATH / ARCH_PATH.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const ROOT = join(__dirname, '..');
const read = (p: string, env?: string) => (env && process.env[env] ? readFileSync(process.env[env] as string, 'utf8') : readFileSync(join(ROOT, p), 'utf8'));
const HOOK = read('hooks/useCollectionSettled.ts', 'HOOK_PATH');
const RFI = read('app/rfi.tsx', 'RFI_PATH');
const SUB = read('app/submittal.tsx', 'SUB_PATH');
const BTN = read('components/SendToClientButton.tsx', 'BTN_PATH');
const ARCH = read('marketing/architect/index.html', 'ARCH_PATH');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
function block(src: string, file: string, marker: string): string {
  const start = src.indexOf(`// >>> ${marker}`);
  const end = src.indexOf(`// <<< ${marker}`);
  ok(`${file} carries the ${marker} marker block`, start > -1 && end > start);
  return start > -1 && end > start ? src.slice(start, end) : '';
}

type Gate = 'form' | 'loading' | 'missing' | 'error';
type H = { at: string; fromParty: string; toParty: string; note?: string };
interface Pure {
  recordGate: (i: { wantsRecord: boolean; foundInContext: boolean; foundInQuery: boolean; settled: boolean; failed: boolean }) => Gate;
  changedFields: (a: Record<string, unknown>, b: Record<string, unknown>) => Record<string, unknown>;
  rfiBallAfterSave: (p: { prevBall?: string; handoffs?: H[]; status: string; responseTyped: boolean; dateResponded?: string; now: string }) => { ball: string; added: H[] };
  rfiRegressionReason: (o: { status: string; response?: string }, f: { status: string; response: string }) => string | null;
  openCycleOf: (c: unknown[] | undefined) => unknown;
  nextCycleNumber: (c: unknown[] | undefined) => number;
  manualCycleProblem: (c: { reviewer: string; status: string; sentDay: string; returnDay: string }) => string | null;
  recordNumberLabel: (k: string, s: string, c?: number, l?: number) => string;
  numberHoldReason: (k: string, s: string) => string | null;
  sendBlockReason: (i: { isDirty: boolean; numberHold: string | null }) => string | null;
  manualCycleBlockedReason: (c: unknown[] | undefined) => string | null;
  rebaseFormOnLive: (o: Record<string, unknown>, f: Record<string, unknown>, l: Record<string, unknown>) => Record<string, unknown>;
  reviewerSendCycle: (c: unknown[] | undefined) => { append: boolean; cycleNumber?: number };
}
const pureSrc = block(HOOK, 'useCollectionSettled', 'rfi-core-pure');
const P = pureSrc
  ? new Function(`${new Transpiler({ loader: 'ts' }).transformSync(pureSrc.replace(/^export /gm, ''))}
    return { recordGate, changedFields, rfiBallAfterSave, rfiRegressionReason, openCycleOf, nextCycleNumber, manualCycleProblem, recordNumberLabel, numberHoldReason, sendBlockReason, manualCycleBlockedReason, rebaseFormOnLive, reviewerSendCycle };`)() as Pure
  : null;

console.log('\n#142 a record opened by link waits, then says why');
if (P) {
  const g = (o: Partial<Parameters<Pure['recordGate']>[0]>) => P.recordGate({ wantsRecord: true, foundInContext: false, foundInQuery: false, settled: false, failed: false, ...o });
  ok('a new record (no id in the URL) renders the form', g({ wantsRecord: false }) === 'form');
  ok('the record in hand renders the form', g({ foundInContext: true }) === 'form');
  ok('not in hand while the fetch is in flight → loader, never a blank form', g({}) === 'loading');
  ok('an EMPTY settled list is not "loading forever" — it is missing', g({ settled: true }) === 'missing');
  ok('the query holds it but the provider has not copied it yet → still loading', g({ settled: true, foundInQuery: true }) === 'loading');
  ok('a failed read says so (retry), not "gone"', g({ settled: true, failed: true }) === 'error');
}

console.log('\n#55 only the fields he changed');
if (P) {
  const opened = { subject: 'Beam', question: 'Q?', status: 'open', response: '', assignedSubId: '', attachments: ['a'] };
  ok('an untouched form diffs to nothing', Object.keys(P.changedFields(opened, { ...opened })).length === 0);
  ok('whitespace-only and ""/undefined differences are not changes',
    Object.keys(P.changedFields(opened, { ...opened, subject: 'Beam  ', assignedSubId: undefined })).length === 0);
  const d = P.changedFields(opened, { ...opened, subject: 'Beam at C/4', attachments: ['a', 'b'] });
  ok('a changed subject and a new attachment are the whole patch', JSON.stringify(Object.keys(d).sort()) === '["attachments","subject"]', JSON.stringify(d));
  ok('…so a stale status/response is never in it', !('status' in d) && !('response' in d));
  ok('reopening an answered RFI is refused with a reason', /stays answered/.test(P.rfiRegressionReason({ status: 'answered' }, { status: 'open', response: 'x' }) ?? ''));
  ok('…a closed one too', !!P.rfiRegressionReason({ status: 'closed' }, { status: 'open', response: 'x' }));
  ok('clearing a recorded response is refused with a reason', /can't be cleared/.test(P.rfiRegressionReason({ status: 'answered', response: 'Drop 6in' }, { status: 'answered', response: '  ' }) ?? ''));
  ok('closing an answered RFI is fine', P.rfiRegressionReason({ status: 'answered', response: 'x' }, { status: 'closed', response: 'x' }) === null);
}

console.log('\n#56 the ball comes back to the GC');
if (P) {
  const now = '2026-09-18T12:00:00.000Z';
  const sent: H[] = [{ at: '2026-09-18T07:05:00.000Z', fromParty: 'gc', toParty: 'architect', note: 'Sent to Sarah' }];
  const r1 = P.rfiBallAfterSave({ prevBall: 'architect', handoffs: sent, status: 'answered', responseTyped: false, dateResponded: '2026-09-18T10:00:00.000Z', now });
  ok('an answer the portal filed AFTER the send hands the ball to the GC on save', r1.ball === 'gc' && r1.added.length === 1 && r1.added[0].fromParty === 'architect' && r1.added[0].toParty === 'gc');
  const r2 = P.rfiBallAfterSave({ prevBall: 'architect', handoffs: [...sent, { at: '2026-09-18T11:00:00.000Z', fromParty: 'gc', toParty: 'architect', note: 'Follow-up' }], status: 'answered', responseTyped: false, dateResponded: '2026-09-18T10:00:00.000Z', now });
  ok('an RFI re-sent for a follow-up AFTER the answer keeps its ball', r2.ball === 'architect' && r2.added.length === 0);
  ok('a response typed here flips it too', P.rfiBallAfterSave({ prevBall: 'engineer', handoffs: [], status: 'open', responseTyped: true, now }).ball === 'gc');
  ok('closing sends it to closed', P.rfiBallAfterSave({ prevBall: 'gc', handoffs: [], status: 'closed', responseTyped: false, now }).ball === 'closed');
  ok('an open RFI with the architect and nothing typed stays with the architect', P.rfiBallAfterSave({ prevBall: 'architect', handoffs: sent, status: 'open', responseTyped: false, now }).added.length === 0);
}

console.log('\n#147 cycles');
if (P) {
  const open = [{ cycleNumber: 1, status: 'in_review' }];
  ok('the open cycle is the last in_review one with no Returned', P.openCycleOf(open) !== null && P.openCycleOf([{ cycleNumber: 1, status: 'in_review', returnDate: '2026-09-01' }]) === null);
  ok('a response closes the open cycle (same number, not +1)', P.nextCycleNumber(open) === 1);
  ok('with nothing open it is highest + 1', P.nextCycleNumber([{ cycleNumber: 1, status: 'approved', returnDate: 'x' }, { cycleNumber: 3, status: 'rejected', returnDate: 'y' }]) === 4);
  ok('no cycles → Cycle 1', P.nextCycleNumber([]) === 1 && P.nextCycleNumber(undefined) === 1);
  ok('a returned stamp needs its Returned day', /Returned date/.test(P.manualCycleProblem({ reviewer: 'Sarah', status: 'approved', sentDay: '', returnDay: '' }) ?? ''));
  ok('a still-in-review cycle has no Returned day', !!P.manualCycleProblem({ reviewer: 'Sarah', status: 'in_review', sentDay: '', returnDay: '2026-09-02' }));
  ok('Returned before Sent is refused', !!P.manualCycleProblem({ reviewer: 'Sarah', status: 'approved', sentDay: '2026-09-05', returnDay: '2026-09-02' }));
  ok('a reviewer is required', !!P.manualCycleProblem({ reviewer: ' ', status: 'in_review', sentDay: '', returnDay: '' }));
  ok('a good stamp passes (Sent optional)', P.manualCycleProblem({ reviewer: 'Sarah', status: 'approved_as_noted', sentDay: '', returnDay: '2026-09-02' }) === null);
}

console.log('\n#148 numbers are the server\'s');
if (P) {
  ok('confirmed prints the SERVER number, not the local guess', P.recordNumberLabel('RFI', 'confirmed', 9, 7) === 'RFI #9');
  ok('pending prints no number', P.recordNumberLabel('RFI', 'pending', undefined, 7) === 'RFI (pending #)');
  ok('checking prints no number either', P.recordNumberLabel('Submittal', 'checking', undefined, 3) === 'Submittal');
  // Review round 2: offline, the local copy may predate the server's number.
  ok('local (offline) prints no number — the local copy is a guess', P.recordNumberLabel('RFI', 'local', undefined, 7) === 'RFI (number not confirmed)' && !/#7/.test(P.recordNumberLabel('RFI', 'local', undefined, 7)));
  ok('confirmed holds nothing', P.numberHoldReason('RFI', 'confirmed') === null);
  ok('pending says why the send waits', /hasn't reached the server/.test(P.numberHoldReason('RFI', 'pending') ?? ''));
}

console.log('\n#58 send never saves (review round 2)');
if (P) {
  ok('unsaved edits block every send, with the reason', /Save your changes before sending/.test(P.sendBlockReason({ isDirty: true, numberHold: null }) ?? ''));
  ok('dirty wins over the number hold', /Save your changes/.test(P.sendBlockReason({ isDirty: true, numberHold: 'held' }) ?? ''));
  ok('clean: the number hold is the reason', P.sendBlockReason({ isDirty: false, numberHold: 'held' }) === 'held');
  ok('clean and numbered: nothing blocks', P.sendBlockReason({ isDirty: false, numberHold: null }) === null);
}

console.log('\n#147 interim: no hand-logged cycle over an open one');
if (P) {
  ok('an open cycle blocks the manual form and names it', /Cycle 2 is still out for review/.test(P.manualCycleBlockedReason([{ cycleNumber: 1, status: 'approved', returnDate: 'x' }, { cycleNumber: 2, status: 'in_review' }]) ?? ''));
  ok('nothing open: the form is available', P.manualCycleBlockedReason([{ cycleNumber: 1, status: 'approved', returnDate: 'x' }]) === null && P.manualCycleBlockedReason([]) === null);
}

console.log('\nthe architect page uses the same cycle rule (executed)');
{
  const src = block(ARCH, 'architect page', 'architect-cycle-rule');
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  try { vm.runInContext(src, ctx); } catch { /* reported below */ }
  const pageNext = ctx.nextCycleNumber as ((c: unknown) => number) | undefined;
  const sentence = ctx.cycleSentence as ((c: unknown) => string) | undefined;
  const cases: unknown[][] = [[], [{ cycleNumber: 1, status: 'in_review' }], [{ cycleNumber: 1, status: 'approved', returnDate: 'x' }], [{ cycleNumber: 2, status: 'rejected', returnDate: 'x' }, { cycleNumber: 3, status: 'in_review' }]];
  ok('page and app agree on every case', !!pageNext && !!P && cases.every(c => pageNext(c) === P.nextCycleNumber(c)));
  ok('an open cycle is CLOSED, not "Cycle N+1"', !!sentence && /close Cycle 1 /.test(sentence([{ cycleNumber: 1, status: 'in_review' }])));
  ok('nothing open: recorded as the next cycle', !!sentence && /recorded as Cycle 2 /.test(sentence([{ cycleNumber: 1, status: 'approved', returnDate: 'x' }])));
  ok('the form banner uses the rule, not length + 1', /cycleSentence\(doc\.review_cycles\)/.test(ARCH) && !/review_cycles\.length \|\| 0\) \+ 1/.test(ARCH));
  ok('the submittal header uses the rule', /var cycleNum = nextCycleNumber\(sub\.review_cycles\);/.test(ARCH));
  ok('#56 the old "has been notified" / "They\'ll get a notification" lines are gone', !/contractor has been notified/.test(ARCH) && !/They\\'ll get a notification/.test(ARCH));
  ok('#77 the RFI card circles the pin on its sheet', /attachmentBlock\(rfi\.attachments, rfi\.pin_marks\)/.test(ARCH) && /class="att-pin"/.test(ARCH));
  // Execute the tile builder with a pin.
  const a = ARCH.indexOf('function viewableAttachments');
  const b = ARCH.indexOf('function renderRFI');
  const ctx2: Record<string, unknown> = { SUPABASE_URL: 'https://x.supabase.co', escHtml: (s: string) => String(s) };
  vm.createContext(ctx2);
  try { vm.runInContext(ARCH.slice(a, b), ctx2); } catch { /* reported below */ }
  const tile = ctx2.attachmentBlock as ((l: unknown, p?: unknown) => string) | undefined;
  const url = 'https://x.supabase.co/storage/v1/object/sign/plan-sheets/p1/sheets/a101.png?token=abc';
  const html = tile ? tile([url], [{ x: 0.42, y: 0.63, sheet_path: 'p1/sheets/a101.png' }]) : '';
  ok('a pin on the attached sheet is drawn at its spot', /left:42\.00%;top:63\.00%/.test(html), html.slice(0, 200));
  ok('a pin on ANOTHER sheet is not drawn on this one', !!tile && !/att-pin/.test(tile([url], [{ x: 0.1, y: 0.1, sheet_path: 'p1/sheets/other.png' }])));
  ok('no pins: the tile is unchanged', !!tile && !/att-frame/.test(tile([url])));
}

console.log('\nRFI screen wiring');
{
  ok('#142 the form mounts keyed on the record id, behind the gate', /return <RFIForm key=\{found\?\.id \?\? 'new'\} \/>;/.test(RFI) && /recordGate\(\{/.test(RFI));
  ok('#142 loading / missing / error are real states', /state="loading"/.test(RFI) && /no longer exists, or it isn't shared with you/.test(RFI));
  ok('#55 refetch on open and foreground', /useRefetchCollectionOnOpen\('rfis'\)/.test(RFI));
  ok('#55 the save diffs against the record the form opened with', /changedFields\(rfiFormValuesOf\(base\), formValues\)/.test(RFI));
  ok('#55 no full-row update from form state is left', !/updateRFI\(existingRFI\.id, \{\s*subject: subject\.trim\(\),/.test(RFI));
  ok('#55 the refused change is refused on screen with its reason', /rfiRegressionReason\(base, \{ status, response \}\)/.test(RFI));
  const send = RFI.slice(RFI.indexOf('const handleSendToPro'), RFI.indexOf('// ─── MAGE suggests an answer'));
  // Review round 2: a save and a send in ONE tap share one render's stale
  // closures, so Send refuses while dirty and never saves; and the send queues
  // exactly ONE write (the hand-off, carrying any re-minted links).
  ok('#58 Send never saves, and refuses while there are unsaved edits', !/persistForm\(/.test(send) && /if \(isDirty\) \{/.test(send) && send.indexOf('if (isDirty)') < send.indexOf('buildRFIEmailHtml('));
  ok('#58 the send queues exactly one updateRFI, after the email succeeded', (send.match(/updateRFI\(/g) ?? []).length === 1 && send.indexOf('updateRFI(') > send.indexOf('if (!result.success)'));
  ok('#58 the email is built from the SAVED record, not the stale one', /question: sent\.question/.test(send) && /subject: sent\.subject/.test(send) && !/existingRFI\.question/.test(send));
  ok('#58 the portal send is off while dirty (and never saves)', !/onBeforeSend/.test(RFI) && /canSend=\{!sendBlock && /.test(RFI) && /canSendReason=\{sendBlock \?\? /.test(RFI));
  ok('#58 Send to Architect is disabled by the same reason, shown', /disabled=\{!!sendBlock\}/.test(RFI) && /testID="rfi-send-block">\{sendBlock\}/.test(RFI));
  ok('#58 "Save changes" saves and stays on the screen', /const handleSaveInPlace = useCallback\(\(\) => \{\n    if \(!persistForm\(\)\) return;/.test(RFI) && !/handleSaveInPlace[\s\S]{0,300}router\.back/.test(RFI.slice(RFI.indexOf('const handleSaveInPlace'), RFI.indexOf('const handleSaveInPlace') + 300)) && /onPress=\{handleSaveInPlace\}/.test(RFI));
  ok('#58 leaving with edits asks', /addListener\('beforeRemove'/.test(RFI) && /Discard your changes\?/.test(RFI));
  ok('#148 the email waits for the server number and prints it', /numberInfo\.state !== 'confirmed'/.test(send) && /rfiNumber,/.test(send) && /RFI #\$\{rfiNumber\}/.test(send));
  ok('#148 the header prints the server number or "(pending #)"', /title: numberLabel/.test(RFI) && /recordNumberLabel\('RFI'/.test(RFI));
  ok('#146 dropped attachments are reported, not "RFI Sent"', /result\.attachmentsDropped \?\? 0/.test(send) && /RFI sent without/.test(send));
  ok('#56 the dialog says answers come back through the link', /existingRFI\?\.shareToken\s*\?\s*"They'll get a formatted email with the question and a reply link/.test(RFI));
  ok('#56 the old paste-only dialog copy is not unconditional', !/<Text style=\{styles\.sendCardHelper\}>\s*They'll get a formatted email with the question\. Their reply/.test(RFI));
  ok('#77 plan-sheet links are re-minted, emailed, and stored with the hand-off', /planSheetStoragePath\(u\) \? resolvePlanSheetUrl\(u\)/.test(send) && /mintedChanged \? \{ \.\.\.existingRFI, attachments: minted \}/.test(send) && /\.\.\.\(mintedChanged \? \{ attachments: minted \} : \{\}\)/.test(send));
  ok('#77 the email names where the pin is', /Marked location:/.test(send));
  ok('#77 a manual attach control exists', /testID="rfi-attach-photo"/.test(RFI) && /launchImageLibraryAsync/.test(RFI));
  ok('#164 the due-day readers resolve instants to the local day', /formatCalendarDay\(calendarDayOf\(dateRequired\) \?\? dateRequired\)/.test(RFI) && /parseCalendarDay\(calendarDayOf\(dateRequired\)\)/.test(RFI));
  ok('gating contract: role loading waits, error retries, null says why', /roleState\.isLoading/.test(RFI) && /roleState\.isError/.test(RFI) && /roleState\.role === null/.test(RFI) && /useProjectRoleState\(gateProjectId\)/.test(RFI));
  ok('…and the wall stays readable to the entry-gate parser', /\n  if \(!canAccess\('rfis_submittals'\)\) \{\n    return collaboratorWait \?\? \(/.test(RFI));
}

console.log('\n#55/#58 review round 3: the form keeps in step with the live row');
if (P) {
  // The reviewer's replay: the form seeded from the cached copy, he edits the
  // subject, then the open refetch brings the architect's portal answer.
  const stale = { subject: 'Beam', question: 'Q', status: 'open', response: '', attachments: [] as string[] };
  const live = { subject: 'Beam', question: 'Q', status: 'answered', response: 'Drop it 6 in.', attachments: [] as string[] };
  const form0 = { ...stale, subject: 'Beam at C/4' };
  const form1 = P.rebaseFormOnLive(stale, form0, live);
  ok('untouched fields adopt the live answer', form1.status === 'answered' && form1.response === 'Drop it 6 in.');
  ok('his own edit survives the refetch', form1.subject === 'Beam at C/4');
  const pending = P.changedFields(live, form1);
  ok('against the live baseline only his edit is unsaved', JSON.stringify(Object.keys(pending)) === '["subject"]');
  ok('the save is not refused as a regression', P.rfiRegressionReason(live as { status: string; response?: string }, form1 as { status: string; response: string }) === null);
  // The save: saved = {...live, ...updates}; form and baseline both become it.
  const saved = { ...live, ...pending };
  ok('after the save nothing reads as unsaved (Send is not blocked)', Object.keys(P.changedFields(saved, saved)).length === 0 && P.sendBlockReason({ isDirty: false, numberHold: null }) === null);
  // Without the rebase (round 2): the stale form against the live baseline.
  ok('control: without the rebase the stale fields read as unsaved edits', 'status' in P.changedFields(live, form0) && 'response' in P.changedFields(live, form0));
  const both = P.rebaseFormOnLive(stale, { ...stale, response: 'Mine' }, live);
  ok('a field he touched keeps his value even when the live row changed it', both.response === 'Mine');
  ok('a clean form adopts the live row whole', JSON.stringify(P.rebaseFormOnLive(stale, stale, live)) === JSON.stringify(live));
}
{
  const eff = RFI.slice(RFI.indexOf('const lastLiveRef = useRef(existingRFI)'), RFI.indexOf('const lastLiveRef = useRef(existingRFI)') + 600);
  ok('rfi: a newer record identity re-bases the form and the baseline', /if \(!existingRFI \|\| existingRFI === lastLiveRef\.current\) return;/.test(eff) && /applyFormValues\(rebaseFormOnLive\(base, formRef\.current, rfiFormValuesOf\(existingRFI\)\)\);\s*setOpened\(existingRFI\);/.test(eff) && /\}, \[existingRFI, applyFormValues\]\);/.test(eff));
  const pf = RFI.slice(RFI.indexOf('const persistForm = useCallback'), RFI.indexOf('const navigation = useNavigation()'));
  ok('rfi: a save re-seeds the form from the saved record', /applyFormValues\(rfiFormValuesOf\(saved\)\);\s*setOpened\(saved\);/.test(pf));
  ok('rfi: the architect send re-seeds the form too', /applyFormValues\(rfiFormValuesOf\(afterSend\)\);\s*setOpened\(afterSend\);/.test(RFI));
  const seff = SUB.slice(SUB.indexOf('const lastLiveRef = useRef(existingSubmittal)'), SUB.indexOf('const lastLiveRef = useRef(existingSubmittal)') + 600);
  ok('submittal: a newer record identity re-bases the form and the baseline', /applyFormValues\(rebaseFormOnLive\(base, formRef\.current, submittalFormValuesOf\(existingSubmittal\)\)\);\s*setOpened\(existingSubmittal\);/.test(seff));
  ok('submittal: a save re-seeds the form from the saved record', /applyFormValues\(submittalFormValuesOf\(saved\)\);\s*setOpened\(saved\);/.test(SUB));
}

console.log('\n#147 review round 3: a send over an open cycle is a reminder');
if (P) {
  ok('an open cycle: no append, names the cycle', JSON.stringify(P.reviewerSendCycle([{ cycleNumber: 1, status: 'approved', returnDate: 'x' }, { cycleNumber: 2, status: 'in_review' }])) === '{"append":false,"cycleNumber":2}');
  ok('nothing open: the send starts a cycle', P.reviewerSendCycle([{ cycleNumber: 1, status: 'approved', returnDate: 'x' }]).append === true && P.reviewerSendCycle(undefined).append === true);
  const subSend = SUB.slice(SUB.indexOf('const handleSendEmail'), SUB.indexOf('const scheduleTasks'));
  ok('the reviewer send appends only when no cycle is open, and says so otherwise', /const cycle = reviewerSendCycle\(existingSubmittal\.reviewCycles\);\s*if \(cycle\.append\) \{\s*addReviewCycle\(/.test(subSend) && /Cycle \$\{cycle\.cycleNumber\} is still out for review/.test(subSend));
  ok('the send dialog says it is a reminder before he sends', /testID="submittal-resend-note"/.test(SUB));
}

console.log('\nsubmittal screen wiring');
{
  ok('#142 keyed form behind the gate', /return <SubmittalForm key=\{found\?\.id \?\? 'new'\} \/>;/.test(SUB) && /useCollectionSettled\('submittals', submittalId\)/.test(SUB));
  ok('#55 refetch on open and foreground', /useRefetchCollectionOnOpen\('submittals'\)/.test(SUB));
  ok('#55 a title edit sends only what changed', /changedFields\(submittalFormValuesOf\(base\), formValues\)/.test(SUB) && !/updateSubmittal\(existingSubmittal\.id, \{\s*title: title\.trim\(\),\s*specSection/.test(SUB));
  ok('#147 the manual cycle takes the days he entered, never now()', /sentDate: newCycleSent,/.test(SUB) && !/sentDate: new Date\(\)\.toISOString\(\),\s*reviewer: newReviewer/.test(SUB));
  ok('#147 the manual cycle is validated (Returned required for a stamp)', /manualCycleProblem\(\{/.test(SUB));
  ok('#147 an unknown Sent day says "not recorded"', /cycleDayLabel\(cycle\.sentDate\) \?\? 'not recorded'/.test(SUB));
  ok('#147 "pending" is not a review outcome in the cycle form', /CYCLE_STATUSES(\.filter\([^)]*\))?\.map/.test(SUB) && !/'pending', 'in_review', 'approved'/.test(SUB.slice(SUB.indexOf('const CYCLE_STATUSES'), SUB.indexOf('const CYCLE_STATUSES') + 120)));
  ok('#148 email / PDF / portal wait for the server number', /subject: `Submittal #\$\{subNumber\}/.test(SUB) && /number: numberInfo\.number/.test(SUB) && /sendBlockReason\(\{ isDirty, numberHold \}\)/.test(SUB));
  const subSend = SUB.slice(SUB.indexOf('const handleSendEmail'), SUB.indexOf('const scheduleTasks'));
  ok('#58 the reviewer send never saves and refuses while dirty (addReviewCycle is its one write)', !/persistForm\(/.test(subSend) && /if \(isDirty\) \{/.test(subSend) && (subSend.match(/addReviewCycle\(|updateSubmittal\(/g) ?? []).length === 1);
  ok('#58 the portal send and Send to Reviewer are off while dirty, with the reason', !/onBeforeSend/.test(SUB) && /canSend=\{!sendBlock && /.test(SUB) && /disabled=\{!!sendBlock\}/.test(SUB) && /testID="submittal-send-block">\{sendBlock\}/.test(SUB));
  ok('#58 "Save changes" saves and stays', /const handleSaveInPlace = useCallback\(\(\) => \{\n    if \(!persistForm\(\)\) return;/.test(SUB) && /onPress=\{handleSaveInPlace\}/.test(SUB));
  // #147 / #55 (post-chain): the interim block is replaced by close-in-place
  // now that addReviewCycle goes through submittal_append_review_cycle.
  const addCycle = SUB.slice(SUB.indexOf('const handleAddCycle'), SUB.indexOf("if (!project && !existingSubmittal)"));
  ok('#147 over an open cycle the manual form CLOSES it in place (closesOpenCycle), never appends a second round',
    /const openCycle = existingSubmittal \? openCycleOf\(existingSubmittal\.reviewCycles\) : null;/.test(SUB)
    && /if \(openCycle\) \{[\s\S]*?closesOpenCycle: true,[\s\S]*?return;\s*\}/.test(addCycle)
    && /sentDate: openCycle\.sentDate,/.test(addCycle));
  ok('…refuses "in review" as the answer, and the form says it closes Cycle N',
    /if \(newCycleStatus === 'in_review'\) \{/.test(addCycle)
    && /This closes Cycle \{openCycleNo\}/.test(SUB)
    && /CYCLE_STATUSES\.filter\(st => !openCycle \|\| st !== 'in_review'\)/.test(SUB));
  ok('…and the old interim block is gone', !/manualCycleBlockedReason/.test(SUB) && !/cycleBlock/.test(SUB));
  ok('gating contract via useProjectAccess', /useProjectAccess\(gateProjectId\)/.test(SUB) && /useProjectRoleState\(gateProjectId\)/.test(SUB) && /\n  if \(!canAccess\('rfis_submittals'\)\) \{\n    return collaboratorWait \?\? \(/.test(SUB));
}

console.log('\nSendToClientButton (#36 label, #58 no save-in-send)');
{
  ok('the label names the client portal for every caller', /'Send to client portal'/.test(BTN) && /'Re-send to client portal'/.test(BTN));
  ok('no bare "Send to Client" / "Re-send updated" left', !/'Send to Client'/.test(BTN) && !/'Re-send updated'/.test(BTN) && !/'Re-send to Client'/.test(BTN));
  const doSend = BTN.slice(BTN.indexOf('const doSend'), BTN.indexOf('const doRecall'));
  ok('no pre-send save hook (it would snapshot the pre-save record)', !/onBeforeSend/.test(BTN) && /await sendToClientPortal\(\{ kind, itemId, projectId \}\)/.test(doSend));
  const resend = BTN.slice(BTN.indexOf('if (unsentEdits)'), BTN.indexOf('return (', BTN.indexOf('if (unsentEdits)') + 40) + 1200);
  ok('the Re-send bar honours canSend and shows its reason', /disabled=\{busy \|\| !canSend\}/.test(resend) && /!canSend && canSendReason/.test(resend));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
