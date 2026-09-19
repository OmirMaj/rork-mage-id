// scripts/validate-plans-revisions-compare.ts — wave 3, lane plans-revisions.
//
// #79  Compare and PDF import showed "Edge Function returned a non-2xx status
//      code" instead of the function's own reason (monthly cap, hourly limit,
//      the takeoff tier refusal, a page past the end).
// #76  A re-issued set could only be compared on page 1, and two revisions
//      already in the plan set could not be compared at all.
// #75  PDF pages import with no sheet number and the title block plan-extract
//      reads was thrown away; Compare's "no sheet number" block threw the paid
//      result away too.
// #160 A JPG/PNG revision hit "Need a public URL" and stopped.
// #162 Plans had no camera option.
// #165 The AI limit was checked AFTER the page was rendered and billed.
// #166 A created RFI was dead text; a flagged change could not raise one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEdgeError, edgeFunctionError, edgeErrorCode } from '../utils/edgeError';
import {
  revisionFiling, rfiFromCandidate, rfiFromChange, titleBlockSuggestions, planBatchRenumber,
  chainColumnsPatch, type SheetLike,
} from '../utils/plans/revisionActions';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments stripped — a rule about CODE is not satisfied by prose. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
/** The body of `const name = useCallback(...)` up to the next top-level const. */
const callbackBody = (src: string, name: string) => {
  const start = src.indexOf(`const ${name} = useCallback(`);
  if (start < 0) return '';
  const next = src.indexOf('\n  const ', start + 10);
  return src.slice(start, next < 0 ? undefined : next);
};

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); }
}

async function main() {
  console.log('\n#79 the function\'s own reason reaches the screen');
  const fnErr = (body: unknown, status = 429) => ({
    message: 'Edge Function returned a non-2xx status code',
    context: { status, json: async () => body },
  });
  const cap = await readEdgeError(fnErr({ error: 'Monthly compare limit reached (20 on pro). Resets on the 1st.', code: 'monthly_cap_reached' }), 'Compare drawings failed');
  ok('the JSON error and code are read', cap.message.startsWith('Monthly compare limit') && cap.code === 'monthly_cap_reached', JSON.stringify(cap));
  const onlyCode = await readEdgeError(fnErr({ code: 'hourly_limit' }), 'x');
  ok('a body with only a code still says something', onlyCode.message === 'hourly_limit' && onlyCode.code === 'hourly_limit');
  const notJson = await readEdgeError({ message: 'non-2xx', context: { status: 502, json: async () => { throw new Error('not json'); } } }, 'The PDF could not be rendered');
  ok('a non-JSON body degrades to the status', notJson.message === 'The PDF could not be rendered (HTTP 502)' && notJson.code === 'http_502', JSON.stringify(notJson));
  const transport = await readEdgeError(new Error('Failed to fetch'), 'x');
  ok('no response at all keeps the transport message', transport.message === 'Failed to fetch' && transport.code === '');
  const thrown = await edgeFunctionError(fnErr({ error: 'That PDF has 12 pages — there is no page 14.', code: 'start_page_past_end' }, 400), 'x');
  ok('the thrown error carries message AND code', thrown.message.startsWith('That PDF has 12 pages') && edgeErrorCode(thrown) === 'start_page_past_end');
  ok('edgeErrorCode is empty for a plain error', edgeErrorCode(new Error('x')) === '');

  const cdw = code('utils/compareDrawings.ts');
  const pdf = code('utils/pdfRenderClient.ts');
  ok('compareDrawings never throws the raw invoke message', !/error\.message/.test(cdw) && /throw await edgeFunctionError\(error,/.test(cdw));
  ok('compareDrawings drops the "call failed:" prefix', !/Compare drawings call failed/.test(cdw));
  ok('uploadAndRenderPdf never throws the raw invoke message', !/fnErr\.message/.test(pdf) && /edgeFunctionError\(fnErr,/.test(pdf));
  ok('uploadAndRenderPdf drops the "Render failed:" prefix', !/Render failed:/.test(pdf));
  ok('the body is decoded BEFORE the orphan cleanup (it can be read once)',
    pdf.indexOf('edgeFunctionError(fnErr') > 0 && pdf.indexOf('edgeFunctionError(fnErr') < pdf.indexOf('.remove([storagePath])'));
  ok('there is one reader: askYourPlans has no private copy', !/async function readEdgeError/.test(code('utils/plans/askYourPlans.ts'))
    && /from '@\/utils\/edgeError'/.test(read('utils/plans/askYourPlans.ts')));
  ok('planCodeReviewer delegates instead of re-reading the body',
    !/ctx\.json/.test(code('utils/planCodeReviewer.ts')) && /readEdgeError\(error, fallback\)/.test(code('utils/planCodeReviewer.ts')));

  console.log('\n#76 a page of a set, or two sheets already in the set');
  ok('RenderPdfOptions takes startPage', /startPage\?: number;/.test(pdf));
  ok('startPage reaches the function body', /\{ startPage: Math\.floor\(startPage\) \}/.test(pdf));
  const cd = code('app/compare-drawings.tsx');
  ok('Compare renders the chosen page, one page only', /maxPages: 1,\s*startPage: src\.page,/.test(cd));
  ok('the page picker is sized by countPdfPages', /setPendingPdf\(\{ asset, pageCount \}\)/.test(cd) && /pendingPdf\.pageCount/.test(cd));
  ok('the "Compare page 1" dead end is gone', !/Compare page 1'/.test(cd) && !/split out the single sheet first/.test(cd));
  ok('a page past the end keeps the picker open with the reason', /edgeErrorCode\(e\) === 'start_page_past_end'/.test(cd));
  ok('oldSheetId/newSheetId are read and resolved from ALL sheets (superseded included)',
    /params\.oldSheetId/.test(cd) && /params\.newSheetId/.test(cd) && /allSheets\.find\(s => s\.id === oldId\)/.test(cd) && /allSheets\.find\(s => s\.id === pairNewId\)/.test(cd));
  ok('the pair compare sends each side\'s storagePath (URL fallback kept)',
    /newPagePath: pairNew\.storagePath/.test(cd) && /newPageUrl: pairNew\.imageUri/.test(cd));
  ok('filing is told the new side is already in the set', /newSheetInSet: pairNew/.test(cd));
  ok('filing refuses to run for a pair (no duplicate Rev N+1)', /if \(!project \|\| !oldSheet \|\| !newPagePath \|\| filed \|\| pairNew\) return;/.test(cd));
  ok('the RFI and CO cite the NEW sheet in pair mode',
    // #77 (plans-access-ask) extended the opts with the two drawings; the
    // pair-mode citation (`newSheet: pairNew`) is what this pins.
    /rfiFromCandidate\(candidate, oldSheet, newPageLabel, new Date\(\), \{ newSheet: pairNew(, sheetImages: comparedSheetImages)? \}\)/.test(cd)
    && /changeOrderPrefill\(change, pairNew, `compared with \$\{sheetCitation\(oldSheet\)\}`\)/.test(cd));
  const plans = code('app/plans.tsx');
  const viewer = code('app/plan-viewer.tsx');
  ok('Plans rows with a previous revision offer the compare',
    /s\.previousSheetId \? allSheets\.find\(x => x\.id === s\.previousSheetId\)/.test(plans) && /oldSheetId: prev\.id, newSheetId: s\.id/.test(plans));
  ok('the viewer offers it from the banner and from a live revision',
    /compareRevisions\(sheet\.id, currentSheetId\)/.test(viewer) && /compareRevisions\(previousSheet\.id, sheet\.id\)/.test(viewer)
    && /oldSheetId, newSheetId \}/.test(viewer));

  const s = (over: Partial<SheetLike> & { id: string }): SheetLike => ({ projectId: 'p1', name: 'Floor plan', createdAt: '2026-01-01T00:00:00.000Z', ...over });
  const rev2 = s({ id: 'r2', sheetNumber: 'A-201', revision: 2, superseded: true });
  const rev3 = s({ id: 'r3', sheetNumber: 'A-201', revision: 3, previousSheetId: 'r2', createdAt: '2026-03-01T00:00:00.000Z' });
  const inSet = revisionFiling({ oldSheet: rev2, allSheets: [rev2, rev3], newPath: 'p1/r3.png', newSheetInSet: rev3 });
  ok('a pair is "already in the set", never "File as Rev 4"', inSet.kind === 'in_set' && /A-201 Rev 3/.test(inSet.label) && !/File as/.test(inSet.label), JSON.stringify(inSet));
  const pairRfi = rfiFromCandidate({ subject: 'Wall type', question: 'Is W3 rated?' }, rev2, 'A-201 Rev 3', new Date(2026, 2, 2, 12), { newSheet: rev3 });
  ok('a pair RFI links the NEW sheet and names both', pairRfi.linkedDrawing === 'A-201' && /comparing A-201 Rev 2 with A-201 Rev 3, both in the plan set/.test(pairRfi.question), pairRfi.question);
  const plainRfi = rfiFromCandidate({ subject: 'x', question: 'q' }, rev3, 'ASI.pdf', new Date(2026, 2, 2, 12));
  ok('without a pair the RFI reads exactly as before', /\(Raised comparing A-201 Rev 3 against the revision "ASI\.pdf"\.\)$/.test(plainRfi.question));

  console.log('\n#75 the sheet number: typed inline, or read from the title block and confirmed');
  const unnumbered = revisionFiling({ oldSheet: s({ id: 'u', name: 'IFC — Page 12' }), allSheets: [], newPath: 'p1/x.png' });
  ok('the no-number block is flagged for the inline field', unnumbered.kind === 'blocked' && unnumbered.needsNumber === true && /this comparison is kept/.test(unnumbered.reason), JSON.stringify(unnumbered));
  ok('Compare re-reads the old sheet from allSheets, so the number unblocks the kept result',
    /allSheets\.find\(s => s\.id === oldPick\.id\) \?\? oldPick/.test(cd));
  const saveNumber = callbackBody(cd, 'handleSaveNumber');
  ok('the inline number runs planRenumber and writes the chain columns through the queue',
    /planRenumber\(oldSheet, numberDraft, allSheets\)/.test(saveNumber) && /updatePlanSheet\(p\.id, p\.updates\)/.test(saveNumber)
    && /chainColumnsPatch\(p\.updates\)/.test(saveNumber) && /supabaseWrite\('plan_sheets', 'update'/.test(saveNumber));
  ok('it never re-runs the compare', !/compareDrawings\(|uploadAndRenderPdf\(/.test(saveNumber));
  ok('chainColumnsPatch maps the three columns updatePlanSheet drops',
    JSON.stringify(chainColumnsPatch({ revision: 2, previousSheetId: 'a', superseded: false })) === '{"revision":2,"previous_sheet_id":"a","superseded":false}'
    && chainColumnsPatch({ sheetNumber: 'A-1' }) === null);

  const pages = [
    s({ id: 'p1', name: 'ASI — Page 1', createdAt: '2026-03-10T00:00:00.000Z' }),
    s({ id: 'p2', name: 'ASI — Page 2', createdAt: '2026-03-10T00:00:00.000Z' }),
    s({ id: 'p3', name: 'ASI — Page 3', createdAt: '2026-03-10T00:00:00.000Z' }),
    s({ id: 'typed', name: 'ASI — Page 4', sheetNumber: 'A-400', createdAt: '2026-03-10T00:00:00.000Z' }),
  ];
  const ifc = s({ id: 'ifc', name: 'IFC — Page 7', sheetNumber: 'A-201', createdAt: '2026-01-10T00:00:00.000Z' });
  const sugg = titleBlockSuggestions([...pages, ifc], [
    { sheetId: 'p1', sheetNumber: ' A-201 ' },
    { sheetId: 'p2', sheetNumber: 'A-301' },
    { sheetId: 'p3', sheetNumber: 'a-301' },
    { sheetId: 'typed', sheetNumber: 'A-999' },
    { sheetId: 'p1', sheetNumber: 'A-777' },
    { sheetId: 'ghost', sheetNumber: 'A-1' },
    { sheetId: 'p2', sheetNumber: '' },
  ]);
  ok('a read is offered only for an unnumbered live sheet, once', sugg.map(x => `${x.sheetId}:${x.sheetNumber}`).join() === 'p1:A-201,p2:A-301,p3:a-301', JSON.stringify(sugg));
  ok('two pages reading one number are flagged, the rest are not',
    sugg.find(x => x.sheetId === 'p2')?.duplicate === true && sugg.find(x => x.sheetId === 'p3')?.duplicate === true && sugg.find(x => x.sheetId === 'p1')?.duplicate === false);
  ok('a number he typed is never overwritten by a read', !sugg.some(x => x.sheetId === 'typed'));
  ok('a superseded sheet and an over-long read are not offered',
    titleBlockSuggestions([s({ id: 'old', name: 'o', superseded: true }), s({ id: 'n', name: 'n' })], [{ sheetId: 'old', sheetNumber: 'A-1' }, { sheetId: 'n', sheetNumber: 'X'.repeat(41) }]).length === 0);

  const batch = planBatchRenumber([{ sheetId: 'p1', sheetNumber: 'A-201' }, { sheetId: 'p2', sheetNumber: 'A-301' }], [...pages, ifc]);
  ok('a confirmed read chains the ASI page onto the IFC sheet (old one superseded first)',
    batch.applied === 2 && batch.patches[0].id === 'ifc' && batch.patches[0].updates.superseded === true
    && batch.patches[1].id === 'p1' && batch.patches[1].updates.revision === 2 && batch.patches[1].updates.previousSheetId === 'ifc', JSON.stringify(batch.patches));
  ok('each message names its sheet', batch.messages.length === 1 && batch.messages[0].startsWith('ASI — Page 1: '), JSON.stringify(batch.messages));
  const twice = planBatchRenumber([{ sheetId: 'p2', sheetNumber: 'A-301' }, { sheetId: 'p3', sheetNumber: 'A-301' }], pages);
  ok('the batch plans each renumber against the set the previous one left',
    twice.patches.some(p => p.id === 'p2' && p.updates.superseded === true) || twice.patches.some(p => p.id === 'p3' && p.updates.superseded === true), JSON.stringify(twice.patches));

  const ayp = code('utils/plans/askYourPlans.ts');
  ok('extractSheet returns the title block instead of dropping it',
    /titleBlock: readTitleBlock\(data\)/.test(ayp) && (ayp.match(/titleBlock: readTitleBlock\(data\)/g) ?? []).length === 2);
  ok('indexing offers the reads as suggestions, and writes no number',
    /result\.titleBlockSuggestions = titleBlockSuggestions\(current, titleReads\)/.test(ayp) && !/updatePlanSheet|planRenumber\(/.test(ayp));
  const importPdf = callbackBody(plans, 'handleImportPdf');
  ok('the import OFFERS the read pass with its cost, Business only',
    /created\.length > 0 && isBusinessOrAbove/.test(importPdf) && /AI plan read\$\{n === 1 \? '' : 's'\} from your monthly allowance/.test(importPdf)
    && /if \(read\) await readTitleBlocks\(created\)/.test(importPdf));
  const readPass = callbackBody(plans, 'readTitleBlocks');
  ok('the read pass writes nothing and stops on a repeating refusal',
    /extractSheet\(sheetsToRead\[i\]\)/.test(readPass) && /PLAN_EXTRACT_STOP_CODES\.has\(out\.code\)/.test(readPass) && !/updatePlanSheet|supabaseWrite/.test(readPass));
  const apply = callbackBody(plans, 'applyTitleNumbers');
  ok('only the numbers he ticked are applied, through planBatchRenumber + the queue',
    /filter\(i => i\.use\)/.test(apply) && /planBatchRenumber\(accepted, allSheetsRef\.current\)/.test(apply) && /chainColumnsPatch\(p\.updates\)/.test(apply));
  ok('the confirm sheet says the numbers are AI readings', /Title block reads \{item\.sheetNumber\} — use it\?/.test(plans) && /Read by AI/.test(plans));

  console.log('\n#160 a JPG/PNG revision is uploaded and compared by path');
  ok('the "Need a public URL" dead end is gone', !/Need a public URL/.test(cd) && !/public image URL/.test(cd));
  ok('an image goes through the Plans precheck and upload',
    /precheckFloorPlanImage\(project\.id, image\)/.test(cd) && /uploadPlanSheetImage\(project\.id, image, pre\)/.test(cd));
  ok('a not-configured build is said plainly', /PlanSheetUploadNotConfiguredError/.test(cd) && /floorPlanFailureReason\('not-configured'\)/.test(cd));
  ok('the local uri never goes on the wire', /newPageUrl: isHttpUrl\(rendered\.url\) \? rendered\.url : ''/.test(cd));
  ok('filing accepts an uploaded image (its path is the new path)', revisionFiling({ oldSheet: rev3, allSheets: [rev3], newPath: 'p1/img-x.jpg' }).kind === 'ready');

  console.log('\n#162 Plans can photograph a paper plan');
  ok('neither picker is hard-wired to the library', !/pickFloorPlanImage\('library'\)/.test(plans) && (plans.match(/pickFloorPlanImage\(source\)/g) ?? []).length === 2);
  ok('native asks Camera or Library; web goes straight in',
    /Platform\.OS === 'web'\) return Promise\.resolve\('library'\)/.test(plans) && /text: 'Take photo'/.test(plans) && /text: 'Choose from library'/.test(plans));
  ok('a refused camera is titled as the camera', /source === 'camera' \? 'Can\\u2019t open camera'/.test(plans) && !/showAlert\('Can\\u2019t open photos'/.test(plans));

  console.log('\n#165 nothing is rendered before the limit says yes');
  const pick = callbackBody(cd, 'handlePickNew');
  ok('the pick checks the limit before counting or rendering',
    pick.indexOf('await limitAllows()') > 0 && pick.indexOf('await limitAllows()') < pick.indexOf('countPdfPages(asset.uri)'));
  const run = callbackBody(cd, 'runCompare');
  ok('the render path checks it too, before uploadAndRenderPdf',
    run.indexOf('await limitAllows()') > 0 && run.indexOf('await limitAllows()') < run.indexOf('uploadAndRenderPdf('));
  ok('the limit helper routes a refusal to the upgrade alert', /showAILimitAlert\(\{ limit, router, monthly: true \}\)/.test(callbackBody(cd, 'limitAllows')));
  ok('a retry of the same file reuses its render', /renderCache\.current\?\.key === key \? renderCache\.current : null/.test(run) && /renderCache\.current = rendered/.test(run));
  const keyFn = cd.slice(cd.indexOf('const renderKey ='), cd.indexOf('const isHttpUrl'));
  ok('the cache key ignores the uri (the picker copies to a new path each time)', /asset\.name/.test(keyFn) && /asset\.size/.test(keyFn) && /src\.page/.test(keyFn) && !/asset\.uri/.test(keyFn), keyFn);
  ok('the render is dropped after a successful compare', run.indexOf('renderCache.current = null') > run.indexOf('recordAIUsage('));

  console.log('\n#166 a created RFI opens; every change can raise one');
  ok('rfiByIndex keeps the id', /Record<number, \{ id: string; number: number \}>/.test(cd) && /\[index\]: \{ id: rfi\.id, number: rfi\.number \}/.test(cd));
  ok('the done row opens /rfi with the id', /pathname: '\/rfi' as never, params: \{ projectId: project\.id, rfiId \}/.test(cd) && /openRfi\(rfiByIndex\[i\]\.id\)/.test(cd));
  ok('it says what is left to do', /Open RFI #\{rfiByIndex\[i\]\.number\} to assign and send/.test(cd));
  ok('each change has Raise RFI, via rfiFromChange', /handleRaiseChangeRfi\(i\)/.test(cd) && /rfiFromChange\(change, oldSheet, newPageLabel, new Date\(\), \{ newSheet: pairNew(, sheetImages: comparedSheetImages)? \}\)/.test(cd));
  ok('Done counts a change RFI as saved', /Object\.keys\(changeRfi\)\.length > 0/.test(callbackBody(cd, 'handleDone')));
  const cr = rfiFromChange({ type: 'modified', location: 'grid C/4', description: 'Door 104 widened to 3\'-6"' }, rev3, 'ASI.pdf', new Date(2026, 2, 2, 12));
  ok('a change RFI says what kind, where, and asks for the intent',
    cr.subject === 'Modified · grid C/4' && /Door 104 widened to 3'-6"\. Please confirm the intent/.test(cr.question) && cr.linkedDrawing === 'A-201' && cr.assignedTo === '', JSON.stringify(cr));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

void main();
