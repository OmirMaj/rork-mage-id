// validate-plan-import-batch.ts — audit round 2, #18: importing a plan PDF
// showed ONE sheet and said it added all of them.
//
// app/plans.tsx looped addPlanSheet over the rendered pages, and addPlanSheet
// built each list from the render's `planSheets`, so every page overwrote the
// one before and only the last survived on screen and in the cache. The retry
// spent the month's takeoff pages again and, with no sheet numbers on PDF
// pages, doubled the set on the server.
//
// Executes utils/planSheetBatchCore.foldPlanSheets (what ProjectContext's
// addPlanSheet / addPlanSheets run) and pins the wiring in the context and the
// screen with source checks.
//
// Run: bun run scripts/validate-plan-import-batch.ts
import { readFileSync } from 'node:fs';
import { foldPlanSheets, pdfPageSheetName, priorImportOf, type NewPlanSheet } from '../utils/planSheetBatchCore';
import type { PlanSheet } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string) => readFileSync(p, 'utf8');

const P = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-09-17T12:00:00.000Z';
let seq = 0;
const newId = () => `id-${++seq}`;
const page = (n: number, base = 'Set', count = 3): NewPlanSheet => ({
  projectId: P, name: pdfPageSheetName(base, count, n), sheetNumber: undefined,
  storagePath: `${P}/x-page-${n}.png`, imageUri: `https://signed/${n}`, pageNumber: n,
});
const current = (list: PlanSheet[]) => list.filter(s => !s.superseded);

console.log('\nplan PDF import batches (audit round 2, #18):');

// 1. A 3-page PDF into an empty project leaves THREE sheets, not one.
{
  const fold = foldPlanSheets([], [page(1), page(2), page(3)], { now: NOW, newId, matchUnnumberedByPage: true });
  ok('a 3-page import leaves three sheets in the list', fold.list.length === 3, `got ${fold.list.length}`);
  ok('created counts exactly what was added (the alert reads this)', fold.created.length === 3);
  ok('every page is kept, 1 through 3',
    JSON.stringify(fold.list.map(s => s.pageNumber).sort()) === JSON.stringify([1, 2, 3]));
  ok('nothing superseded on a first import', fold.superseded.length === 0);

  // 2. Re-importing the same set replaces, it does not double.
  const again = foldPlanSheets(fold.list, [page(1), page(2), page(3)], { now: NOW, newId, matchUnnumberedByPage: true });
  ok('a re-import of the same file shows three current sheets, not six', current(again.list).length === 3,
    `got ${current(again.list).length}`);
  ok('…the earlier three are marked superseded', again.superseded.length === 3 && again.list.length === 6);
  ok('…and the new ones are Rev 2 chained to the old ones',
    again.created.every(c => c.revision === 2 && !!c.previousSheetId && fold.list.some(o => o.id === c.previousSheetId)));
  ok('a different file of the same page count is NOT treated as the same set',
    foldPlanSheets(fold.list, [page(1, 'Electrical'), page(2, 'Electrical')], { now: NOW, newId, matchUnnumberedByPage: true }).superseded.length === 0);
}

// 3. Single image imports never match by name — two "Floor plan" photos are two plans.
{
  const one = foldPlanSheets([], [{ projectId: P, name: 'Floor plan', imageUri: 'file:///a.jpg', pageNumber: 1 }], { now: NOW, newId });
  const two = foldPlanSheets(one.list, [{ projectId: P, name: 'Floor plan', imageUri: 'file:///b.jpg', pageNumber: 1 }], { now: NOW, newId });
  ok('two same-named image imports both stay current', current(two.list).length === 2 && two.superseded.length === 0);
}

// 4. Sheet-number revisions run against the WORKING list, inside one batch too.
{
  const base = foldPlanSheets([], [{ projectId: P, name: 'A-101', sheetNumber: 'A-101', imageUri: 'u', pageNumber: 1 }], { now: NOW, newId }).list;
  const batch = foldPlanSheets(base, [
    { projectId: P, name: 'A-101 r2', sheetNumber: 'A-101', imageUri: 'u', pageNumber: 1 },
    { projectId: P, name: 'A-101 r3', sheetNumber: 'A-101', imageUri: 'u', pageNumber: 2 },
  ], { now: NOW, newId });
  ok('two revisions of one number in one batch end at Rev 3 with one current sheet',
    current(batch.list).length === 1 && current(batch.list)[0].revision === 3);
  ok('the in-batch Rev 2 is inserted already superseded (no update queued before its insert)',
    batch.created[0].superseded === true && batch.superseded.every(s => !batch.created.some(c => c.id === s.id)));
}

// 5. The pre-upload duplicate check finds a prior import of the same file.
{
  const list = foldPlanSheets([], [page(1), page(2), page(3)], { now: NOW, newId, matchUnnumberedByPage: true }).list;
  ok('priorImportOf finds all three pages of "Set"', priorImportOf(list, P, 'Set').length === 3);
  ok('…case-insensitively', priorImportOf(list, P, 'SET').length === 3);
  ok('…and not a different file', priorImportOf(list, P, 'Set 2').length === 0);
  ok('a one-page PDF keeps the bare file name', pdfPageSheetName('Cover', 1, 1) === 'Cover');
}

// 6. Wiring.
{
  const ctx = read('contexts/ProjectContext.tsx');
  const plans = read('app/plans.tsx');
  ok('ProjectContext keeps a planSheetsRef that persistPlanSheets writes',
    /const planSheetsRef = useRef<PlanSheet\[\]>/.test(ctx)
      && /const persistPlanSheets = useCallback\(\(list: PlanSheet\[\]\) => \{\s*planSheetsRef\.current = list;/.test(ctx));
  ok('the add path folds into the ref, not the render closure',
    /foldPlanSheets\(planSheetsRef\.current, sheets,/.test(ctx) && !/let updatedList = planSheets/.test(ctx));
  // Update and delete must build from the ref too: a render-closure
  // `planSheets.map/filter` in the same tick as an add drops the new sheet.
  const updBody = ctx.slice(ctx.indexOf('const updatePlanSheet = useCallback'), ctx.indexOf('const deletePlanSheet = useCallback'));
  const delStart = ctx.indexOf('const deletePlanSheet = useCallback');
  const delBody = ctx.slice(delStart, ctx.indexOf('}, [', delStart) + 200);
  ok('updatePlanSheet and deletePlanSheet read planSheetsRef.current, not the render closure',
    updBody.length > 0 && delBody.length > 0
      && /planSheetsRef\.current/.test(updBody) && !/\bplanSheets\.(map|find|filter)\(/.test(updBody)
      && /persistPlanSheets\(planSheetsRef\.current\.filter\(/.test(delBody) && !/\bplanSheets\.(map|find|filter)\(/.test(delBody));
  ok('addPlanSheets is exposed on the context',
    /addPlanSheets: \(\s*sheets: Omit<PlanSheet/.test(ctx) && /planSheets, addPlanSheet, addPlanSheets,/.test(ctx));
  ok('plans.tsx imports the PDF with ONE addPlanSheets call, never a loop of addPlanSheet',
    /addPlanSheets\(pages\.map\(/.test(plans) && !/pages\.forEach\([\s\S]{0,80}addPlanSheet\(/.test(plans));
  ok('…re-imports supersede by page', /\{ matchUnnumberedByPage: true \}\)/.test(plans));
  ok('the "sheets added" alert counts what was created, not what was rendered',
    /\$\{created\.length\} sheet\$\{created\.length === 1/.test(plans) && !/\$\{pages\.length\} sheet\$\{pages\.length === 1 \? '' : 's'\} added/.test(plans));
  ok('the GC is asked BEFORE a repeat import spends takeoff pages',
    /priorImportOf\(allSheets, projectId, baseName\)/.test(plans)
      && plans.indexOf('priorImportOf(allSheets') < plans.indexOf('uploadAndRenderPdf({'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
