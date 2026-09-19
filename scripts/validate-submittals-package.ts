// validate-submittals-package.ts — wave 3, lane `submittals` (#57 #59 #60 #144 #149 #150).
//
// Executes the pure rules in utils/submittalAttachments.ts, the chase engine's
// never-sent branch, the photo-markup access gate (evaluated out of
// app/photo-annotator.tsx), and pins the wiring on the three screens that use
// them. The migration (20260919090000) is executed twice in PGlite by the
// lane's harness; this file only pins its contract columns.
//
// Run: bun run scripts/validate-submittals-package.ts
import { readFileSync } from 'node:fs';
import {
  safeAttachmentFileName, submittalAttachmentObjectPath, toStoredAttachment, storedAttachmentObjectPath,
  attachmentDisplayName, attachmentUploadBlock, submittalSendGate, submittalEmailIntro, submittalSendOutcome,
  specDedupeKey, markSpecDuplicates, absoluteSourcePages, matchScheduleTaskForTrade,
  deriveSubmittalRequiredDate, requiredDateNote, extractedSubmittal, SUBMITTAL_ATTACHMENT_BUCKET,
  SUBMITTAL_EMAIL_ATTACHMENT_CAP_BYTES, SUBMITTAL_COVER_SHEET_RESERVE_BYTES,
  submittalFileSizeBlock, submittalPackageSizeBlock, attachmentsTooLargeMessage,
} from '../utils/submittalAttachments';
import { buildChaseList } from '../utils/systemOfAction';
import { submittalPlanToSubmittal } from '../utils/generativeSetup';
import type { Project, ScheduleTask, Submittal } from '../types';

// Bun global for tsc (the repo type-checks scripts/ without bun's types).
declare const Bun: { Transpiler: new (o: { loader: string }) => { transformSync(src: string): string } };

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// ── #57 where a file lives ───────────────────────────────────────────────────
console.log('\n#57 attachments: stored path, name, who may add');
{
  const obj = submittalAttachmentObjectPath({ projectId: 'p-1', submittalId: 's-1', uniq: 'ab12cd34', fileName: 'cut-sheet.pdf' });
  eq('object path puts the project id first (the bucket policy reads folder[1])', obj.split('/')[0], 'p-1');
  eq('…and keeps the file name as the last segment', obj, 'p-1/submittals/s-1/ab12cd34/cut-sheet.pdf');
  const stored = toStoredAttachment(obj);
  eq('stored value is bucket-qualified', stored, `${SUBMITTAL_ATTACHMENT_BUCKET}/${obj}`);
  eq('stored value round-trips to its object path', storedAttachmentObjectPath(stored), obj);
  eq('a legacy local URI is not one of ours', storedAttachmentObjectPath('file:///var/x/photo.jpg'), null);
  eq('a bare bucket name is not a path', storedAttachmentObjectPath(`${SUBMITTAL_ATTACHMENT_BUCKET}/`), null);
  eq('display name is the file, not the path', attachmentDisplayName(stored), 'cut-sheet.pdf');
  eq('display name drops a signed URL query', attachmentDisplayName('https://x/y/Door%20hw.pdf?token=abc'), 'Door hw.pdf');
  eq('unsafe characters are replaced and the extension kept', safeAttachmentFileName('Door hw (rev 2).pdf', 'pdf'), 'Door_hw_rev_2_.pdf');
  eq('a name without an extension gets the fallback one', safeAttachmentFileName('IMG_0042', 'jpg'), 'IMG_0042.jpg');
  eq('an empty name gets a usable one', safeAttachmentFileName('', 'pdf'), 'attachment.pdf');
  eq('owner may add', attachmentUploadBlock({ role: 'owner', roleLoading: false, roleError: false }), null);
  eq('editor may add', attachmentUploadBlock({ role: 'editor', roleLoading: false, roleError: false }), null);
  const field = attachmentUploadBlock({ role: 'field', roleLoading: false, roleError: false });
  ok('a field seat is refused with the reason (Storage INSERT needs editor)', !!field && /owner or an editor/.test(field));
  ok('a viewer seat is refused with the reason', !!attachmentUploadBlock({ role: 'viewer', roleLoading: false, roleError: false }));
  ok('a role still loading is a wait, not a refusal', /Checking/.test(attachmentUploadBlock({ role: null, roleLoading: true, roleError: false }) ?? ''));
  ok('a failed role read says so', /Couldn't check/.test(attachmentUploadBlock({ role: null, roleLoading: false, roleError: true }) ?? ''));
}

// ── #57 what Send may do and what the email may say ─────────────────────────
console.log('\n#57 send gate, email wording, send outcome');
{
  const empty = submittalSendGate({ productDataCount: 0, coverSheetAvailable: true, confirmedWithoutProductData: false });
  ok('no product data → Send is blocked with a reason', !!empty.blocked && /No product data/.test(empty.blocked));
  ok('…and offers the cover-sheet-only confirmation', /cover sheet only/.test(empty.confirmLabel ?? ''));
  eq('confirmed → not blocked', submittalSendGate({ productDataCount: 0, coverSheetAvailable: true, confirmedWithoutProductData: true }).blocked, null);
  const web = submittalSendGate({ productDataCount: 0, coverSheetAvailable: false, confirmedWithoutProductData: false });
  ok('on the web (no cover PDF) the reason says the web cannot make it', /web app cannot make/.test(web.blocked ?? ''));
  ok('…and the confirmation promises no files, not a cover sheet', /no files/.test(web.confirmLabel ?? '') && !/cover sheet only/.test(web.confirmLabel ?? ''));
  eq('product data attached → no gate, no confirmation', submittalSendGate({ productDataCount: 2, coverSheetAvailable: true, confirmedWithoutProductData: false }), { blocked: null, confirmLabel: null });

  const none = submittalEmailIntro({ coverSheet: false, productNames: [] });
  ok('nothing resolved → the intro never says "attached"', !/attach/i.test(none), none);
  const cover = submittalEmailIntro({ coverSheet: true, productNames: [] });
  ok('cover only → names the cover sheet, no product data claimed', /cover sheet/.test(cover) && !/product data/.test(cover), cover);
  const full = submittalEmailIntro({ coverSheet: true, productNames: ['cut-sheet.pdf', 'finish.jpg'] });
  ok('full package → names both files and the cover', /2 product data files \(cut-sheet\.pdf, finish\.jpg\)/.test(full) && /cover sheet/.test(full), full);

  eq('nothing dropped → the round is logged', submittalSendOutcome({ requested: 3, dropped: 0 }), { recordCycle: true, warning: null });
  const lost = submittalSendOutcome({ requested: 3, dropped: 1 });
  ok('a dropped file → NOT logged as a review round', lost.recordCycle === false);
  ok('…and he is told how many went', /1 of 3 files could not be attached \(2 did\)/.test(lost.warning ?? ''), lost.warning ?? '');
  eq('a dropped count above the request is clamped', submittalSendOutcome({ requested: 1, dropped: 5 }).recordCycle, false);
}

// ── #57 (review): the email's size cap ──────────────────────────────────────
console.log('\n#57 package size: the send-email cap, checked on the phone');
{
  const MB = 1024 * 1024;
  const edge = read('supabase/functions/send-email/index.ts');
  const m = edge.match(/const MAX_ATTACHMENT_BYTES = (\d+) \* (\d+) \* (\d+);/);
  const serverCap = m ? Number(m[1]) * Number(m[2]) * Number(m[3]) : NaN;
  eq('the phone cap mirrors send-email MAX_ATTACHMENT_BYTES', SUBMITTAL_EMAIL_ATTACHMENT_CAP_BYTES, serverCap);
  const big = submittalFileSizeBlock({ fileName: 'shop-dwg.pdf', fileBytes: 7.2 * MB, packageBytes: 0, coverSheet: true });
  ok('a 7.2 MB file is refused at attach, naming the limit and its size', !!big && /5\.0 MB in total/.test(big) && /7\.2 MB/.test(big) && /not attached/.test(big));
  eq('a 1 MB file on an empty package is fine', submittalFileSizeBlock({ fileName: 'a.pdf', fileBytes: MB, packageBytes: 0, coverSheet: true }), null);
  const edgeFit = SUBMITTAL_EMAIL_ATTACHMENT_CAP_BYTES - SUBMITTAL_COVER_SHEET_RESERVE_BYTES;
  eq('a file exactly filling the room left beside the cover sheet is fine', submittalFileSizeBlock({ fileName: 'a.pdf', fileBytes: edgeFit, packageBytes: 0, coverSheet: true }), null);
  ok('one byte more (with the cover sheet) is refused', !!submittalFileSizeBlock({ fileName: 'a.pdf', fileBytes: edgeFit + 1, packageBytes: 0, coverSheet: true }));
  eq('on web (no cover sheet) the full cap is available', submittalFileSizeBlock({ fileName: 'a.pdf', fileBytes: edgeFit + 1, packageBytes: 0, coverSheet: false }), null);
  const sum = submittalFileSizeBlock({ fileName: 'b.pdf', fileBytes: 2 * MB, packageBytes: 3 * MB, coverSheet: true });
  ok('a file that fits alone but not with the package is refused, with the totals', !!sum && /3\.0 MB is already attached/.test(sum) && /5\.0 MB/.test(sum));
  const over = submittalPackageSizeBlock({ sizes: [3 * MB, 2.5 * MB], coverSheet: true });
  ok('Send is blocked when the stored files are over the cap, with the total', !!over && /5\.5 MB/.test(over) && /Nothing was sent/.test(over));
  eq('Send goes when the package fits', submittalPackageSizeBlock({ sizes: [2 * MB, 1 * MB], coverSheet: true }), null);
  eq('unreadable sizes are left to the server (not counted, not blocking)', submittalPackageSizeBlock({ sizes: [null, 1 * MB], coverSheet: true }), null);
  ok("the server's refusal is translated", /too large to email/.test(attachmentsTooLargeMessage('Attachments too large (max 5242880 bytes total decoded)') ?? ''));
  eq('other errors are left as they are', attachmentsTooLargeMessage('Rate limited'), null);
}

// ── #59 spec-book passes: duplicates and page numbers ───────────────────────
console.log('\n#59 duplicates and real page numbers');
{
  eq('spec section spacing and case are ignored', specDedupeKey('08 71 00', 'Door Hardware'), specDedupeKey('087100', 'door  hardware.'));
  ok('different sections are different submittals', specDedupeKey('08 71 00', 'Door hardware') !== specDedupeKey('08 11 13', 'Door hardware'));
  const log = [{ specSection: '08 71 00', title: 'Door hardware' }] as Pick<Submittal, 'specSection' | 'title'>[];
  const cands = [
    { title: 'Door Hardware', specSection: '087100', confidence: 'high' as const },
    { title: 'Roof membrane', specSection: '07 54 23', confidence: 'high' as const },
    { title: 'Roof membrane', specSection: '07 54 23', confidence: 'medium' as const },
    { title: 'Mock-up', specSection: '', confidence: 'low' as const },
    { title: 'Tile', specSection: '09 30 00', confidence: 'high' as const },
  ];
  const marked = markSpecDuplicates(cands, log, [{ specSection: '09 30 00', title: 'Tile' }]);
  eq('in the log → flagged, unchecked', [marked[0].duplicate, marked[0].selected], ['log', false]);
  eq('new → kept and checked', [marked[1].duplicate, marked[1].selected], [null, true]);
  eq('a repeat inside the same pass → flagged, unchecked', [marked[2].duplicate, marked[2].selected], ['list', false]);
  eq('low confidence still defaults off', [marked[3].duplicate, marked[3].selected], [null, false]);
  eq('already on the list from an earlier pass → flagged, unchecked', [marked[4].duplicate, marked[4].selected], ['list', false]);
  eq('nothing is dropped', marked.length, cands.length);

  const pass2 = [25, 26, 27, 28];
  eq('a later pass maps shown-page 3 to the book\'s page 27', absoluteSourcePages([3], pass2), [27]);
  eq('the first pass is identity', absoluteSourcePages([1, 2], [1, 2, 3]), [1, 2]);
  eq('out-of-range pages are dropped, repeats merged', absoluteSourcePages([0, 2, 2, 9], pass2), [26]);
}

// ── #60 the Required Date: derived from the schedule or blank ───────────────
console.log('\n#60 required date, not a guess');
{
  const task = (id: string, title: string, startDay: number, extra: Partial<ScheduleTask> = {}) =>
    ({ id, title, phase: '', startDay, durationDays: 3, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started', ...extra }) as ScheduleTask;
  const tasks = [
    task('t1', 'Frame walls', 1),
    task('t2', 'Install roof membrane', 11),
    task('t3', 'Roof walk (milestone)', 5, { isMilestone: true }),
    task('t4', 'Re-roof garage', 20),
  ];
  eq('roofing matches the earliest roofing task (not the milestone)', matchScheduleTaskForTrade('Roofing', tasks)?.id, 't2');
  eq('General never matches', matchScheduleTaskForTrade('General', tasks), null);
  eq('an unknown trade never matches', matchScheduleTaskForTrade('Landscaping', tasks), null);
  // Review: a substring test put "Outdoor lighting" on the door schedule.
  const outdoor = [task('o1', 'Outdoor lighting', 2), task('o2', 'Outdoor kitchen', 3, { phase: 'Exterior' })];
  eq('"Outdoor lighting" is not doors/hardware work', matchScheduleTaskForTrade('Doors/Hardware', outdoor), null);
  eq('…but "Hang doors" is', matchScheduleTaskForTrade('Doors/Hardware', [...outdoor, task('d1', 'Hang doors', 9)])?.id, 'd1');
  eq('a word-start prefix still matches ("plumb" → "Plumbing rough-in")', matchScheduleTaskForTrade('Plumbing', [task('p1', 'Plumbing rough-in', 4)])?.id, 'p1');

  // 7-day week, Mon 2026-10-05 start → startDay 11 = 2026-10-15; less 14 → 2026-10-01.
  const sched = { startDate: '2026-10-05', workingDaysPerWeek: 7, nonWorkingDates: [], tasks };
  const d = deriveSubmittalRequiredDate({ schedule: sched, trade: 'Roofing', leadDays: 14 });
  eq('task start less the lead, as a calendar day', [d.requiredDate, d.taskStart, d.requiredDateSource, d.linkedTaskId], ['2026-10-01', '2026-10-15', 'schedule', 't2']);
  // 5-day week: startDay 11 = the 11th working day from Mon Oct 5 → Mon Oct 19.
  const d5 = deriveSubmittalRequiredDate({ schedule: { ...sched, workingDaysPerWeek: 5 }, trade: 'Roofing', leadDays: 14 });
  eq('working-day schedules count the task start in working days', d5.taskStart, '2026-10-19');
  eq('…and the lead in calendar days', d5.requiredDate, '2026-10-05');
  eq('an undated schedule gives no date (its tasks have no calendar days)', deriveSubmittalRequiredDate({ schedule: { ...sched, startDate: undefined }, trade: 'Roofing', leadDays: 14 }), { requiredDate: '' });
  eq('no schedule → blank', deriveSubmittalRequiredDate({ schedule: null, trade: 'Roofing', leadDays: 14 }), { requiredDate: '' });
  eq('no matching task → blank', deriveSubmittalRequiredDate({ schedule: sched, trade: 'Tile', leadDays: 14 }), { requiredDate: '' });
  ok('the blank row says what to do', /set it, or link a schedule task/.test(requiredDateNote({ requiredDate: '' }, 14)));
  ok('a derived row says where the date came from and labels the lead as AI',
    /Install roof membrane/.test(requiredDateNote(d, 14)) && /estimated lead \(AI\)/.test(requiredDateNote(d, 14)));

  const row = { title: 'Roof membrane', specSection: '07 54 23', submittalType: 'Product Data', trade: 'Roofing', dueRelativeDays: 14, sourcePages: [27] };
  const kept = extractedSubmittal({ projectId: 'p1', submittedBy: 'Acme GC', row, derived: d });
  eq('an extracted row is not "submitted"', kept.submittedDate, '');
  eq('…carries the derived date, its source and the task link', [kept.requiredDate, kept.requiredDateSource, kept.linkedTaskId], ['2026-10-01', 'schedule', 't2']);
  eq('…and keeps type, trade, pages and lead', [kept.submittalType, kept.trade, kept.sourcePages, kept.leadDays], ['Product Data', 'Roofing', [27], 14]);
  const undated = extractedSubmittal({ projectId: 'p1', submittedBy: 'Acme GC', row, derived: { requiredDate: '' } });
  eq('with no task: blank date, no source, no link', [undated.requiredDate, 'requiredDateSource' in undated, 'linkedTaskId' in undated], ['', false, false]);

  const plan = submittalPlanToSubmittal({ title: 'Windows', specSection: '08 50 00' } as Parameters<typeof submittalPlanToSubmittal>[0], 'p1');
  eq('generative setup no longer invents "+30 days"', plan.requiredDate, '');
}

// ── #60 the chase list: never-sent is his, not the reviewer's ───────────────
console.log('\n#60 chase list');
{
  const NOW = Date.parse('2026-02-15T00:00:00');
  const projects = [{ id: 'p1', name: 'Oak Kitchen' }] as unknown as Project[];
  const sub = (o: Partial<Submittal>): Submittal => ({
    id: 's1', projectId: 'p1', number: 3, title: 'Window schedule', specSection: '08 50 00',
    submittedBy: 'GC', submittedDate: '', requiredDate: '2026-02-10',
    reviewCycles: [], currentStatus: 'pending', attachments: [],
    createdAt: '2026-02-01', updatedAt: '2026-02-01', ...o,
  } as Submittal);
  const unsent = buildChaseList({ rfis: [], submittals: [sub({})], changeOrders: [], projects, nowMs: NOW });
  eq('a never-sent overdue submittal is his', [unsent.length, unsent[0]?.unsent, unsent[0]?.waitingOn], [1, true, 'you — not sent yet']);
  ok('…and its nudge does not blame the reviewer', !/reviewer|awaiting review/i.test(unsent[0]?.nudge ?? ''), unsent[0]?.nudge);
  // The legacy stamp: every create path used to fill submittedDate on the day the row was made.
  const legacy = buildChaseList({ rfis: [], submittals: [sub({ submittedDate: '2026-02-01' })], changeOrders: [], projects, nowMs: NOW });
  eq('a legacy submittedDate stamp does not make it "sent"', legacy[0]?.unsent, true);
  const out = buildChaseList({ rfis: [], submittals: [sub({ currentStatus: 'in_review', reviewCycles: [{ cycleNumber: 1, reviewer: 'Arch', sentDate: '2026-02-02', status: 'in_review' }] })], changeOrders: [], projects, nowMs: NOW });
  eq('a submittal out for review still chases the reviewer', [out[0]?.unsent, out[0]?.waitingOn], [undefined, 'the reviewer']);
  eq('a blank required date is never chased', buildChaseList({ rfis: [], submittals: [sub({ requiredDate: '' })], changeOrders: [], projects, nowMs: NOW }).length, 0);
}

// ── #149 photo markup gate (evaluated out of the screen) ────────────────────
console.log('\n#149 photo markup opens for the invited crew');
const annotator = read('app/photo-annotator.tsx');
{
  const gs = annotator.indexOf('// >>> annotator-access');
  const ge = annotator.indexOf('// <<< annotator-access');
  ok('app/photo-annotator.tsx carries the annotator-access block', gs > 0 && ge > gs);
  if (gs > 0 && ge > gs) {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(annotator.slice(gs, ge).replace(/^export /gm, ''));
    const { annotatorAccessState } = new Function(`${js}\nreturn { annotatorAccessState };`)() as {
      annotatorAccessState: (o: { canAccess: boolean; photosLoaded: boolean; photoFound: boolean; roleLoading: boolean; roleError: boolean; role: string | null }) => string;
    };
    const base = { canAccess: false, photosLoaded: true, photoFound: true, roleLoading: false, roleError: false, role: 'owner' };
    eq('access (own plan or project grant) → open', annotatorAccessState({ ...base, canAccess: true }), 'open');
    eq('photos still loading → loading, never the paywall', annotatorAccessState({ ...base, photosLoaded: false }), 'loading');
    eq('role still loading → loading, never the paywall', annotatorAccessState({ ...base, roleLoading: true, role: null }), 'loading');
    eq('role read failed → error (retry)', annotatorAccessState({ ...base, roleError: true, role: null }), 'error');
    eq('settled null role on a real photo → no_access, said plainly', annotatorAccessState({ ...base, role: null }), 'no_access');
    eq('photo not here → the editor gate says missing (no price for a missing photo)', annotatorAccessState({ ...base, photoFound: false }), 'open');
    eq('his own free plan on his own photo → paywall', annotatorAccessState(base), 'paywall');
    // Control: the old screen was `canAccess ? open : paywall` on his OWN tier.
    const old = (o: { canAccess: boolean }) => (o.canAccess ? 'open' : 'paywall');
    ok('control — the old rule paywalled a collaborator while his grant loaded', old({ canAccess: false }) === 'paywall');
  }
  const code = strip(annotator);
  ok('the gate reads the PHOTO\'s project', /useProjectAccess\(photoProjectId\)/.test(code) && /useProjectRoleState\(photoProjectId\)/.test(code));
  ok('the paywall tier is derived, not typed', /requiredTier=\{requiredTierFor\('photo_documentation'\)\}/.test(code) && !/requiredTier="pro"/.test(code));
  ok('the screen no longer gates on useTierAccess alone', !/useTierAccess\(\)/.test(code));
}

// ── Screen wiring ────────────────────────────────────────────────────────────
console.log('\nscreen wiring');
{
  const sub = strip(read('app/submittal.tsx'));
  ok('#149 submittal: gated on the route project', /useProjectAccess\(gateProjectId\)/.test(sub) && /requiredTierFor\('rfis_submittals'\)/.test(sub));
  ok('#60/#150 no invented 21-day default', !/21 \* 86400000/.test(sub) && !/Date\.now\(\) \+ 21/.test(sub));
  ok('#60 a new submittal is not "submitted"', /submittedDate: '',/.test(sub) && !/submittedDate: new Date\(\)\.toISOString\(\)/.test(sub));
  ok('#144 the link is a form field, seeded from the record', /linkedTaskId: s\.linkedTaskId \?\? ''/.test(sub) && /useState\(existingSubmittal\?\.linkedTaskId \?\? ''\)/.test(sub));
  ok('#144 the link is saved on update (cleared = undefined → null)', /if \('linkedTaskId' in changed\) updates\.linkedTaskId = linkedTaskId \|\| undefined;/.test(sub));
  ok('#144 the link is saved on create', /\.\.\.\(linkedTaskId \? \{ linkedTaskId \} : \{\}\)/.test(sub));
  ok('#57 attachments ride on the email', /\.\.\.\(files\.length > 0 \? \{ attachments: files \} : \{\}\)/.test(sub));
  ok('#57 the cover sheet is generated (native)', /generateSubmittalPDFUri\(\{ \.\.\.sent, number: subNumber \}, project, branding\)/.test(sub));
  ok('#57 the email is told how many files went', /attachmentCount: files\.length/.test(sub) && /message: intro/.test(sub));
  ok('#57 an empty package is gated before send', /if \(packageGate\.blocked\) \{/.test(sub));
  ok('#57 a picked file is size-checked on its bytes BEFORE upload',
    /const tooBig = o\.sizeBlock\(bytes\.byteLength\);/.test(sub)
    && sub.indexOf('const tooBig = o.sizeBlock(bytes.byteLength);') < sub.indexOf('.upload(objectPath, bytes')
    && /sizeBlock: \(fileBytes\) => submittalFileSizeBlock\(\{ fileName: file\.name, fileBytes, packageBytes, coverSheet: coverSheetAvailable \}\)/.test(sub));
  ok('#57 Send checks the stored sizes before anything is resolved or sent',
    /submittalPackageSizeBlock\(\{\s*sizes: await storedAttachmentSizes\(sent\.attachments \?\? \[\]\), coverSheet: coverSheetAvailable,?\s*\}\)/.test(sub)
    && /if \(sizeBlock\) \{\s*showAlert\('Too large to email', sizeBlock\);\s*return;/.test(sub)
    && sub.indexOf('if (sizeBlock) {') < sub.indexOf('const result = await sendEmail({'));
  ok("#57 the server's size refusal is shown in words", /attachmentsTooLargeMessage\(result\.error\)/.test(sub));
  ok('#57 dropped files are not logged as a clean round',
    /submittalSendOutcome\(\{ requested: files\.length, dropped: result\.attachmentsDropped \?\? 0 \}\)/.test(sub)
    && sub.indexOf('if (!outcome.recordCycle) {') >= 0
    && sub.indexOf('if (!outcome.recordCycle) {') < sub.indexOf('const cycle = reviewerSendCycle(existingSubmittal.reviewCycles)'));
  ok('#57 attach control exists (PDF + photo) and a blocked one says why',
    /testID="submittal-attach-pdf"/.test(sub) && /testID="submittal-attach-photo"/.test(sub) && /testID="submittal-attach-block"/.test(sub));
  ok('#57 uploads go to the project-documents bucket, paths saved through updateSubmittal',
    /\.from\(SUBMITTAL_ATTACHMENT_BUCKET\)\s*\.upload\(/.test(sub) && /updateSubmittal\(existingSubmittal\.id, \{ attachments: \[/.test(sub));
  ok('#150 the picked date is stored as a calendar day', /setRequiredDate\(calendarDayOf\(iso\) \?\? iso\)/.test(sub));

  const ex = strip(read('app/extract-submittals.tsx'));
  ok('#59 a later pass renders from startPage', /startPage,\n\s*\}\);/.test(ex) && /runPass\(book, nextPage\)/.test(ex));
  ok('#59 the "split the PDF" instruction is gone', !/split the PDF/.test(ex));
  ok('#59 new rows are appended and checked against the log and the list',
    /setItems\(prev => \[\s*\.\.\.prev,/.test(ex) && /markSpecDuplicates\(candidates, getSubmittalsForProject\(project\.id\), prev\)/.test(ex));
  ok('#59 source pages are the book\'s pages', /absoluteSourcePages\(item\.sourcePages, pageNumbers\)/.test(ex));
  ok('#59 the saved alert counts the rows left out as already in the log', /already in the log/.test(ex));
  ok('#60 save builds rows from extractedSubmittal (no upload-day + N)', /extractedSubmittal\(\{/.test(ex) && !/dueRelativeDays \* 24 \* 60 \* 60 \* 1000/.test(ex) && !/submittedDate: today\.toISOString\(\)/.test(ex));
  ok('#60 the date comes from the schedule', /deriveSubmittalRequiredDate\(\{ schedule: project\.schedule, trade: item\.trade, leadDays: item\.dueRelativeDays \}\)/.test(ex));
  ok('#60 the lead is labelled as an AI estimate', /estimated lead \(AI\)/.test(ex));
  ok('#57 the save alert no longer promises a missing attach control and says nothing was sent',
    /none sent yet/.test(ex) && /attach the product data and send it for review/.test(ex));

  const cap = strip(read('utils/copilot/submittal/submittalCapability.ts'));
  ok('#57/#60 copilot: logged, not submitted; no invented 7/14-day date',
    /submittedDate: '',/.test(cap) && !/draft\.urgent \? 7 : 14/.test(cap));

  const mig = read('supabase/migrations/20260919090000_submittal_intake_columns.sql');
  for (const col of ['linked_task_id text', 'submittal_type text', 'trade text', 'source_pages jsonb', 'lead_days int', 'required_date_source text']) {
    ok(`migration adds submittals.${col}`, new RegExp(`add column if not exists ${col.replace(' ', '\\s+')}`).test(mig));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
