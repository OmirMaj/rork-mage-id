// validate-takeoff-pdf-drop.ts — list-3 lane TK-c: a PDF dropped on the
// desktop takeoff (the sheet rail or the first-run screen).
//  1. utils/takeoff/pdfDrop — every pdfDropVerdict branch, dragHasFiles, the
//     status lines ("number the sheets in Plans").
//  2. Static: the drop hook runs Plans' checks (seat block, re-import
//     confirm, quota confirm, ONE addPlanSheets with matchUnnumberedByPage)
//     and frees its blob URL in a finally; RailDropZone's DOM listeners are
//     web-only and removed in the effect cleanup; the workspace's two diff
//     sites carry their seam comments; the pure file imports nothing.
// Run: bun run scripts/validate-takeoff-pdf-drop.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pdfDropVerdict, dragHasFiles, isPdfFile, pdfDropDoneLine, pdfDropSavingLine, PDF_DROP_MAX_BYTES, PDF_DROP_COPY,
} from '../utils/takeoff/pdfDrop';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const eq = <T,>(name: string, got: T, want: T) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const MB = 1024 * 1024;
const pdf = (over: Partial<{ name: string; type: string; size: number }> = {}) =>
  ({ name: 'A-Set.pdf', type: 'application/pdf', size: 3 * MB, ...over });

console.log('pdfDropVerdict');
eq('no files → drop a PDF', pdfDropVerdict([]), { ok: false, reason: 'Drop a PDF plan set here.' });
eq('two files → one at a time', pdfDropVerdict([pdf(), pdf({ name: 'B.pdf' })]), { ok: false, reason: 'One PDF at a time.' });
eq('two files, even one bad → one at a time', pdfDropVerdict([pdf(), pdf({ name: 'x.png', type: 'image/png' })]), { ok: false, reason: 'One PDF at a time.' });
eq('a PDF → ok index 0', pdfDropVerdict([pdf()]), { ok: true, index: 0 });
eq('uppercase .PDF with an empty type → ok', pdfDropVerdict([pdf({ name: 'PERMIT SET.PDF', type: '' })]), { ok: true, index: 0 });
eq('application/pdf with no extension → ok', pdfDropVerdict([pdf({ name: 'download', type: 'application/pdf' })]), { ok: true, index: 0 });
eq('mixed-case MIME → ok', pdfDropVerdict([pdf({ name: 'x', type: 'Application/PDF' })]), { ok: true, index: 0 });
eq('a PNG → PDF-only reason', pdfDropVerdict([pdf({ name: 'photo.png', type: 'image/png' })]),
  { ok: false, reason: 'Only PDFs can be dropped here — add images from Plans.' });
eq('a .pdf.png → PDF-only reason', pdfDropVerdict([pdf({ name: 'set.pdf.png', type: '' })]), { ok: false, reason: PDF_DROP_COPY.notPdf });
eq('a folder-like empty entry → PDF-only reason', pdfDropVerdict([{ name: 'Plans', type: '', size: 0 }]), { ok: false, reason: PDF_DROP_COPY.notPdf });
eq('exactly 500 MB → ok', pdfDropVerdict([pdf({ size: 500 * MB })]), { ok: true, index: 0 });
eq('500 MB + 1 byte → split it', pdfDropVerdict([pdf({ size: 500 * MB + 1 })]),
  { ok: false, reason: 'Plan PDFs must be under 500 MB. Try splitting it by discipline.' });
eq('size check runs after the type check', pdfDropVerdict([pdf({ name: 'big.zip', type: 'application/zip', size: 900 * MB })]), { ok: false, reason: PDF_DROP_COPY.notPdf });
ok('cap is Plans’ 500 MB', PDF_DROP_MAX_BYTES === 500 * MB);
ok('isPdfFile .pdf lowercase, empty type', isPdfFile({ name: 'a.pdf', type: '' }));
ok('isPdfFile rejects image/jpeg', !isPdfFile({ name: 'a.jpg', type: 'image/jpeg' }));

console.log('dragHasFiles');
ok('Files present', dragHasFiles(['text/plain', 'Files']));
ok('only Files', dragHasFiles(['Files']));
ok('text drag → false', !dragHasFiles(['text/plain', 'text/uri-list']));
ok('lowercase files ≠ Files', !dragHasFiles(['files']));
ok('empty → false', !dragHasFiles([]));
ok('null → false', !dragHasFiles(null));
ok('undefined → false', !dragHasFiles(undefined));

console.log('status lines');
eq('done, many', pdfDropDoneLine(12), '12 sheets added — number the sheets in Plans');
eq('done, one', pdfDropDoneLine(1), '1 sheet added — number the sheets in Plans');
eq('saving, many', pdfDropSavingLine(3), 'Saving 3 sheets…');
eq('saving, one', pdfDropSavingLine(1), 'Saving 1 sheet…');

// ── static ───────────────────────────────────────────────────────────────
console.log('static: hooks/useTakeoffPdfDrop.ts mirrors Plans');
const hook = read('hooks/useTakeoffPdfDrop.ts');
const hookCode = hook.replace(/^\s*\/\/.*$/gm, '');
ok('planControlBlock(…, \'import\', …)', /planControlBlock\(\s*seatRole\s*,\s*'import'\s*,/.test(hookCode));
ok('#90: a settled null seat (not loading / errored / paused / offline) says "not on this job", never "Checking…" for good',
  /settledNoSeat = seatRole === null && !roleState\.isLoading && !roleState\.isError\s*&& !roleState\.isPaused && !offline;/.test(hookCode)
  && /settledNoSeat\s*\?\s*NO_SEAT_IMPORT/.test(hookCode) && /export const NO_SEAT_IMPORT = 'You\\u2019re not on this job/.test(hookCode));
ok('seat role through effectivePlanRole', /effectivePlanRole\(\s*role\s*,/.test(hookCode));
ok('role status from useProjectRoleState + offline', /useProjectRoleState\(/.test(hookCode) && /isError:\s*roleState\.isError,\s*offline/.test(hookCode));
ok('a blocked seat stops before anything else', /if \(blockReason\) \{ showAlert\('Can(?:\\u2019|’)t add sheets', blockReason\); return \[\]; \}/.test(hookCode));
ok('priorImportOf confirm, Plans’ sentence', /priorImportOf\(/.test(hookCode)
  && hookCode.includes('Importing it again uses takeoff pages again and replaces those sheets with the new copy. Pins stay on the old sheets.'));
ok('blob URL from the File', /URL\.createObjectURL\(file\)/.test(hookCode));
ok('countPdfPages → confirmQuotaFits', /countPdfPages\(fileUri\)[\s\S]*confirmQuotaFits\(/.test(hookCode));
ok('uploadAndRenderPdf before addPlanSheets', /uploadAndRenderPdf\([\s\S]*addPlanSheets\(/.test(hookCode));
ok('exactly one addPlanSheets call', (hookCode.match(/addPlanSheets\(/g) ?? []).length === 1);
ok('addPlanSheets with matchUnnumberedByPage: true', /addPlanSheets\([\s\S]*\{\s*matchUnnumberedByPage:\s*true\s*\}\s*\)/.test(hookCode));
ok('Plans’ field mapping', ['userId: authUser?.id', 'storagePath: p.storagePath', 'imageUri: p.viewUrl', 'width: p.width', 'height: p.height', 'pageNumber: p.pageNumber', 'sheetNumber: undefined', 'pdfPageSheetName(baseName, pages.length, p.pageNumber)']
  .every((s) => hookCode.includes(s)));
const fin = /\}\s*finally\s*\{([\s\S]*?)\n {4}\}/.exec(hookCode);
ok('URL.revokeObjectURL inside a finally', !!fin && /URL\.revokeObjectURL\(fileUri\)/.test(fin[1]));
ok('errors → Import failed', /showAlert\('Import failed', msg\)/.test(hookCode));
ok('status: Uploading → Saving <n> → the done line', /setStatus\('Uploading PDF(?:\\u2026|…)'\)[\s\S]*setStatus\(pdfDropSavingLine\(pages\.length\)\)[\s\S]*settle\(created\.length > 0 \? pdfDropDoneLine\(created\.length\)/.test(hookCode));
ok('inert off the web', /if \(Platform\.OS !== 'web'\) return INERT;/.test(hookCode));

console.log('static: components/takeoff/RailDropZone.tsx');
const zone = read('components/takeoff/RailDropZone.tsx');
const effect = /useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[\]\);/.exec(zone);
const body = effect?.[1] ?? '';
const gate = body.indexOf("if (Platform.OS !== 'web') return undefined;");
const firstAdd = body.indexOf('addEventListener(');
ok('listeners gated on Platform.OS === \'web\' before any attach', gate >= 0 && firstAdd > gate);
const cleanup = /return \(\) => \{([\s\S]*?)\n {4}\};/.exec(body)?.[1] ?? '';
const added = [...body.replace(cleanup, '').matchAll(/node\.addEventListener\('(\w+)', (\w+)\)/g)].map((m) => `${m[1]}:${m[2]}`);
const removed = [...cleanup.matchAll(/node\.removeEventListener\('(\w+)', (\w+)\)/g)].map((m) => `${m[1]}:${m[2]}`);
ok('attaches dragenter/dragover/dragleave/drop', ['dragenter', 'dragover', 'dragleave', 'drop'].every((e) => added.some((a) => a.startsWith(`${e}:`))));
ok('every listener removed in the cleanup', added.length > 0 && added.every((a) => removed.includes(a)), `added ${added} removed ${removed}`);
ok('no window-level listeners', !/window\.addEventListener/.test(zone));
ok('preventDefault only behind dragHasFiles', (body.match(/if \(!dragHasFiles\(typesOf\(e\)\)\) return;/g) ?? []).length === 4);
ok('drop runs pdfDropVerdict then importFile', /pdfDropVerdict\([\s\S]*importFile\(/.test(body));
ok('a blocked seat does nothing but say why', /if \(d\.blockReason\) \{ flash\(\{ text: d\.blockReason, tone: 'refused' \}\); return; \}/.test(body));
ok('overlay testID + prompt', zone.includes('testID="takeoffws-drop-overlay"') && zone.includes("'Drop a PDF to add its sheets'"));
ok('the overlay falls back to the hook status (the done line)', /notice\?\.text \?\? \(drop\.status \|\| null\)/.test(zone));
ok('refusal shows for 4 s', /NOTICE_MS = 4000/.test(zone));
ok('overlay never takes pointer events', /pointerEvents="none" testID="takeoffws-drop-overlay"/.test(zone));

console.log('static: components/takeoff/TakeoffWorkspace.tsx seams');
const ws = read('components/takeoff/TakeoffWorkspace.tsx');
ok('seam:rail directly above the rail', /\{\/\* seam:rail \*\/\}\n\s*\{railOpen \? \(\n\s*<RailDropZone drop=\{drop\}[^\n]*testID="takeoffws-rail-drop">\n\s*<PlanSheetRail/.test(ws));
ok('rail drop opens the first created sheet', /onImported=\{\(ids\) => \{ if \(ids\[0\]\) openSheet\(ids\[0\]\); \}\}/.test(ws));
ok('seam:first-run directly above the first-run', /\{\/\* seam:first-run \*\/\}\n\s*\{!projectId \|\| !active \? \(\n\s*<TakeoffFirstRun [^\n]*dropState=\{drop\} onDropFile=/.test(ws));
ok('RailDropZone used only at the rail seam', (ws.match(/<RailDropZone/g) ?? []).length === 1);
ok('the drop hook sits right after useTakeoffConditions', /= useTakeoffConditions\(projectId\);\n {2}const drop = useTakeoffPdfDrop\(projectId\);\n/.test(ws));
ok('one import line for the drop', (ws.match(/from '\.\/RailDropZone'/g) ?? []).length === 1 && !/useTakeoffPdfDrop'/.test(ws));

console.log('static: components/takeoff/TakeoffFirstRun.tsx');
const fr = read('components/takeoff/TakeoffFirstRun.tsx');
ok('drop hint only on the web with both props', /const droppable = !!onDropFile && !!dropState && Platform\.OS === 'web';/.test(fr));
ok('hint reads "or drop a PDF here"', fr.includes('>or drop a PDF here</Text>'));
ok('steps line unchanged', fr.includes('<Text style={styles.steps}>1 Set scale (K) · 2 Pick a condition · 3 Click to measure</Text>'));
ok('no props → the untouched column', /if \(!droppable \|\| !onDropFile \|\| !dropState\) return column;/.test(fr));

console.log('static: utils/takeoff/pdfDrop.ts is pure');
const pure = read('utils/takeoff/pdfDrop.ts');
const pureCode = pure.replace(/^\s*\/\/.*$/gm, '');
ok('no imports', !/^\s*import\s/m.test(pureCode) && !/\brequire\(/.test(pureCode));
ok('no I/O', !/\b(fetch|URL\.createObjectURL|AsyncStorage|supabase|window|document|setTimeout)\b/.test(pureCode));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
