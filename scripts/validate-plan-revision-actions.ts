// scripts/validate-plan-revision-actions.ts — audit round 2, findings #20/#21.
//
// #20 Compare Drawings found the changes and drafted the RFIs, then offered
//     only "Done", which threw all of it away: the revision was never filed, so
//     the superseded sheet stayed "current" in the field, and the flagged
//     changes had to be retyped into the CO screen from memory.
// #21 Revision control chains on the SHEET NUMBER, and a PDF import gives every
//     page none — with no screen able to add one. Typing it in the viewer has
//     to run the same check addPlanSheet runs, in the right direction: numbering
//     the old IFC page after the ASI page arrived must supersede the IFC page.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  currentSheetsForCompare, revisionFiling, changeOrderPrefill, rfiFromCandidate,
  planRenumber, sheetCitation, type SheetLike,
} from '../utils/plans/revisionActions';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); }
}

const sheet = (over: Partial<SheetLike> & { id: string }): SheetLike => ({
  projectId: 'p1', name: 'Floor plan', createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

console.log('\n1. the comparison base is a sheet that is actually in the field');
const ifc = sheet({ id: 'ifc', sheetNumber: 'A-201', revision: 1, superseded: true });
const asi = sheet({ id: 'asi', sheetNumber: 'A-201', revision: 2, createdAt: '2026-03-01T00:00:00.000Z' });
ok('superseded revisions are not offered as "the current sheet"',
  currentSheetsForCompare([ifc, asi]).map(s => s.id).join() === 'asi');

console.log('\n2. the revision can be filed, and says so when it cannot');
const ready = revisionFiling({ oldSheet: asi, allSheets: [ifc, asi], newPath: 'p1/x-page-1.png' });
ok('a rendered PDF revision can be filed as the next revision', ready.kind === 'ready' && ready.nextRevision === 3, JSON.stringify(ready));
ok('the button names the revision it will create', ready.kind === 'ready' && ready.label === 'File as Rev 3 of A-201', JSON.stringify(ready));
const noPath = revisionFiling({ oldSheet: asi, allSheets: [ifc, asi], newPath: '' });
ok('a picked image is blocked WITH a reason', noPath.kind === 'blocked' && /Only a PDF revision/.test(noPath.reason), JSON.stringify(noPath));
const unnumbered = revisionFiling({ oldSheet: sheet({ id: 'u', name: 'IFC Set — Page 12' }), allSheets: [], newPath: 'p1/x.png' });
ok('an unnumbered sheet is blocked, and the reason says how to fix it',
  unnumbered.kind === 'blocked' && /no sheet number/.test(unnumbered.reason) && /plan viewer/.test(unnumbered.reason), JSON.stringify(unnumbered));
const filed = revisionFiling({ oldSheet: asi, allSheets: [ifc, asi], newPath: 'p1/x.png', filedRevision: 3 });
ok('once filed the card says the old copy is superseded', filed.kind === 'filed' && /superseded/.test(filed.label), JSON.stringify(filed));

console.log('\n3. a flagged change carries its drawing into the change order');
const co = changeOrderPrefill({ location: 'grid C/4', description: 'Added 14 LF of 1-hr rated partition' }, asi, 'ASI-3.pdf');
ok('the CO description keeps where, what, and which drawing',
  co.prefillDescription === 'grid C/4: Added 14 LF of 1-hr rated partition — Drawing revision of A-201 Rev 2 (ASI-3.pdf)', co.prefillDescription);
ok('a change with no location still reads as a sentence',
  changeOrderPrefill({ description: 'Ceiling height changed to 9\'-6"' }, asi, null).prefillDescription === 'Ceiling height changed to 9\'-6" — Drawing revision of A-201 Rev 2');
ok('an unnumbered sheet is cited by name + revision', sheetCitation({ name: 'IFC Set — Page 12' }) === 'IFC Set — Page 12 (Rev 1)');

console.log('\n4. a drafted question becomes a real RFI against the sheet');
// LOCAL noon on 2026-03-02, not an ISO instant: dateRequired is a calendar day
// derived from local components, so a UTC `now` would make this assertion pass
// or fail depending on which side of the date line the runner sits on.
const rfi = rfiFromCandidate(
  { subject: 'Rated partition extent at grid C/4', question: 'Does the new 1-hr partition run to deck?' },
  asi, 'ASI-3.pdf', new Date(2026, 2, 2, 12, 0, 0),
);
ok('the RFI is linked to the drawing', rfi.linkedDrawing === 'A-201');
ok('the RFI records which comparison raised it', /Raised comparing A-201 Rev 2 against the revision "ASI-3\.pdf"/.test(rfi.question), rfi.question);
ok('it opens on the GC with a 7-day due date',
  rfi.status === 'open' && rfi.ballInCourt === 'gc' && rfi.dateRequired === '2026-03-09', rfi.dateRequired);
// The ISO shape cannot come back: an instant's UTC date prefix is tomorrow's
// for an evening comparison west of Greenwich, and every reader of
// RFI.dateRequired slices the first ten characters verbatim.
ok('the due date is a bare calendar day, never an instant',
  !rfi.dateRequired.includes('T') && /^\d{4}-\d{2}-\d{2}$/.test(rfi.dateRequired), rfi.dateRequired);
// An 18:00 local comparison is the repro: `now + 7d` .toISOString() reads
// 2026-03-10 in Denver, a day later than the day the PM is looking at.
ok('an evening comparison still books the same calendar day',
  rfiFromCandidate({ subject: 's', question: 'q' }, asi, null, new Date(2026, 2, 2, 18, 30, 0)).dateRequired === '2026-03-09');
// A 7-day hop across the US spring-forward boundary (2026-03-08) is 167 hours,
// not 168 — millisecond arithmetic lands on the 8th.
ok('a due date spanning a DST change lands on the calendar day',
  rfiFromCandidate({ subject: 's', question: 'q' }, asi, null, new Date(2026, 2, 5, 9, 0, 0)).dateRequired === '2026-03-12');
ok('dateSubmitted stays an instant — that one IS a moment', rfi.dateSubmitted.includes('T'));
ok('an empty subject still gets one', rfiFromCandidate({ subject: '  ', question: 'q' }, asi, null, new Date()).subject === 'A-201 Rev 2 revision question');

console.log('\n5. the compare screen actually wires those actions');
const cd = read('app/compare-drawings.tsx');
ok('the picker filters superseded sheets', /currentSheetsForCompare\(allSheets\)/.test(cd));
ok('filing calls addPlanSheet with the old number and the new storage path',
  /addPlanSheet\(\{[\s\S]{0,400}sheetNumber: oldSheet\.sheetNumber[\s\S]{0,200}storagePath: newPagePath/.test(cd));
ok('each change can start a change order', /handleStartChangeOrder/.test(cd) && /changeOrderPrefill\(change, oldSheet, newPageLabel\)/.test(cd));
ok('each drafted question can become an RFI', /addRFI\(rfiFromCandidate\(/.test(cd));
ok('a multi-page revision PDF is flagged before the render is paid for',
  /countPdfPages\(asset\.uri\)/.test(cd) && cd.indexOf('countPdfPages(asset.uri)') < cd.indexOf('await uploadAndRenderPdf('));
ok('Done no longer discards an unsaved comparison silently', /handleDone/.test(cd) && /Nothing from this comparison is saved/.test(cd));
// B4 review: the guard has to key on a SAVED change order, not on the user
// having navigated to the CO screen. Tapping "Start change order" and backing
// out without saving used to count as saved, so Done left silently and the
// comparison was discarded — the exact loss the guard exists to prevent.
ok('a change order counts only when one exists in the project',
  !/setCoStarted/.test(cd) && /projectChangeOrders\.find\(co => co\.description\.includes\(needle\)\)/.test(cd),
  'compare-drawings still marks a CO "started" on navigation');
ok('the Done guard reads that derived set', /Object\.keys\(coSaved\)\.length > 0/.test(cd));
ok('an already-saved change reopens its own CO instead of prefilling a second',
  /coId: existing\.id/.test(cd) && /Open CO #\$\{coSaved\[i\]\.number\}/.test(cd));

console.log('\n6. renumbering runs the revision check, in the right direction');
const pageA = sheet({ id: 'pageA', name: 'IFC Set — Page 12', createdAt: '2026-01-10T00:00:00.000Z' });
const pageB = sheet({ id: 'pageB', name: 'ASI-3 — Page 12', createdAt: '2026-03-10T00:00:00.000Z' });

const first = planRenumber(pageA, 'A-201', [pageA, pageB]);
ok('numbering the first page of a set touches nothing else',
  first.kind === 'apply' && first.patches.length === 1 && first.patches[0].updates.sheetNumber === 'A-201', JSON.stringify(first));

const numbered = { ...pageA, sheetNumber: 'A-201' };
const second = planRenumber(pageB, 'A-201', [numbered, pageB]);
ok('numbering the NEWER copy supersedes the older one',
  second.kind === 'apply' && second.patches[0].id === 'pageA' && second.patches[0].updates.superseded === true, JSON.stringify(second));
ok('and the newer copy becomes Rev 2 with the chain pointer',
  second.kind === 'apply' && second.patches[1].id === 'pageB' && second.patches[1].updates.revision === 2 && second.patches[1].updates.previousSheetId === 'pageA');
ok('the old sheet is superseded FIRST, so a lost second write leaves no wrong head',
  second.kind === 'apply' && second.patches[0].updates.superseded === true && second.patches[1].updates.sheetNumber === 'A-201');
ok('the user is told what happened to the chain', second.kind === 'apply' && /Rev 2 of A-201/.test(second.message ?? ''), JSON.stringify(second));

// The sharpened case: the ASI page was numbered first; numbering the OLD IFC
// page afterwards must not mark the ASI page superseded.
const asiNumbered = { ...pageB, sheetNumber: 'A-201' };
const backwards = planRenumber(pageA, 'A-201', [pageA, asiNumbered]);
ok('numbering the OLDER copy supersedes ITSELF, never the live newer sheet',
  backwards.kind === 'apply'
  && backwards.patches[0].id === 'pageA' && backwards.patches[0].updates.superseded === true
  && !backwards.patches.some(p => p.id === 'pageB' && p.updates.superseded === true), JSON.stringify(backwards));
ok('the newer copy is renumbered up to Rev 2 with the older one as its history',
  backwards.kind === 'apply' && backwards.patches[1]?.id === 'pageB' && backwards.patches[1].updates.revision === 2 && backwards.patches[1].updates.previousSheetId === 'pageA');
ok('and the message says this sheet is now the superseded one',
  backwards.kind === 'apply' && /now marked superseded/.test(backwards.message ?? ''));

const rev3 = sheet({ id: 'r3', sheetNumber: 'A-201', revision: 3, previousSheetId: 'r2', createdAt: '2026-04-01T00:00:00.000Z' });
const intoChain = planRenumber(pageA, 'A-201', [pageA, rev3]);
ok('an existing chain is never rewritten by a late renumber',
  intoChain.kind === 'apply' && intoChain.patches.length === 1 && intoChain.patches[0].updates.superseded === true, JSON.stringify(intoChain));

const twoLive = planRenumber(pageA, 'A-201', [pageA, { ...pageB, sheetNumber: 'A-201' }, sheet({ id: 'x', sheetNumber: 'A-201', createdAt: '2026-02-01T00:00:00.000Z' })]);
ok('two live copies of the number are left alone, with a warning',
  twoLive.kind === 'apply' && twoLive.patches.length === 1 && /confirm which one is current/.test(twoLive.message ?? ''), JSON.stringify(twoLive));

ok('an unchanged number does nothing', planRenumber(numbered, 'A-201', [numbered]).kind === 'noop');
ok('whitespace is trimmed, not treated as a new number', planRenumber(numbered, '  A-201  ', [numbered]).kind === 'noop');
ok('clearing the number is allowed and chains nothing',
  (() => { const p = planRenumber(numbered, '', [numbered, pageB]); return p.kind === 'apply' && p.patches.length === 1 && p.patches[0].updates.sheetNumber === ''; })());
ok('a 60-character "number" is refused with a reason',
  (() => { const p = planRenumber(pageA, 'x'.repeat(60), [pageA]); return p.kind === 'invalid' && /40 characters/.test(p.reason); })());
ok('renumbering a superseded copy only relabels it',
  (() => { const p = planRenumber({ ...pageA, superseded: true }, 'A-202', [pageA, pageB]); return p.kind === 'apply' && p.patches.length === 1 && p.patches[0].updates.superseded === undefined; })());

console.log('\n7. plan-extract reports the title block as data');
// B5 review: #21's other half. The vision prompt already asked for "the sheet
// title, number, revision … exactly as printed", but returned them only inside
// one free-text blob ({"text": …}), so the PDF importer could not read the
// number back and every page arrived as "<file> — Page N" with sheetNumber
// undefined — which is why addPlanSheet's revision chain never fires for a
// re-issued set. The fields are now their own, so the importer can name sheets.
{
  const pe = read('supabase/functions/plan-extract/index.ts');
  ok('the response shape asks for the three title-block fields',
    /"sheetNumber":"","sheetTitle":"","revisionMark":""/.test(pe));
  ok('an unreadable field must come back empty, never guessed',
    /never guess one from the file name/.test(pe));
  ok('the fields are returned to the client beside the transcription',
    /success: true, text, titleBlock, usage/.test(pe));
  ok('an empty field becomes undefined, so "" is never used as a sheet number',
    /return clean \? clean : undefined;/.test(pe));
  ok('a model that answers the old one-field shape still yields a transcription',
    /if \(typeof parsed\.text !== "string"\) throw new UpstreamError/.test(pe) && /titleField\(parsed\.sheetNumber, 40\)/.test(pe));
}

console.log('\n8. the viewer can give a PDF page its number');
const pv = read('app/plan-viewer.tsx');
ok('the sheet number is editable from the viewer', /plan-viewer-sheet-number-input/.test(pv) && /setNumberDraft/.test(pv));
ok('an unnumbered sheet invites the number', /\+ Add sheet number/.test(pv));
ok('saving runs planRenumber, not a bare updatePlanSheet', /planRenumber\(sheet, numberDraft, projectSheets\)/.test(pv));

// B4 review: the renumber alert says "the older copy is marked superseded".
// That sentence has to be TRUE after the next plan_sheets refetch, and
// ProjectContext's updatePlanSheet forwards only name / sheet_number /
// image_uri / page_number / width / height — it drops revision,
// previous_sheet_id and superseded, so a local-only chain edit is reverted by
// the server copy and leaves two live sheets carrying the number. Either end
// may own the write; what must never happen is neither.
{
  const ctx = read('contexts/ProjectContext.tsx');
  const updateFn = ctx.slice(ctx.indexOf('const updatePlanSheet = useCallback'), ctx.indexOf('const deletePlanSheet = useCallback'));
  const contextForwards = ['revision', 'previous_sheet_id', 'superseded']
    .every(col => new RegExp(`patch\\.${col} =`).test(updateFn));
  const viewerWrites = /supabaseWrite\('plan_sheets', 'update'/.test(pv)
    && ['revision', 'previous_sheet_id', 'superseded'].every(col => new RegExp(`chain\\.${col} =`).test(pv));
  ok('the revision chain reaches Supabase, not just local state',
    contextForwards || viewerWrites,
    'neither ProjectContext.updatePlanSheet nor plan-viewer writes revision/previous_sheet_id/superseded — the "marked superseded" alert is a false statement, reverted by the next refetch');
  ok('the durable write is gated on a signed-in user, like every other plan_sheets write',
    contextForwards || /canSyncSheets && Object\.keys\(chain\)\.length > 0/.test(pv));
}
ok('patches are applied one per render (updatePlanSheet reads a closure list)',
  /patchQueue/.test(pv) && /drainPatches/.test(pv));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
