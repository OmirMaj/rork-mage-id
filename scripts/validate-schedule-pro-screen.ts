// scripts/validate-schedule-pro-screen.ts — Schedule Pro's desktop screen
// (wave 6c, lane DB).
//
// The founder on his 1512 × 945 MacBook: "the scheduler does not work well".
// Six bands above the grid (~425 px, ~9 rows), three overlays over the Gantt,
// a finish date that counted every weekend twice (Thu Mar 26 for a plan that
// ends Fri Mar 20). What this pins, as SOURCE (the rendered geometry is in
// __tests__/smoke/w6c-schedule-pro.test.tsx) plus the finish-date arithmetic
// executed on a fixture:
//   - the width gate compares the CONTENT width and still precedes the picker;
//   - the desktop work row (styles.tabShellBody) has exactly 2 children: the
//     canvas and the pane — and it is the first tabShellBody in the file;
//   - no raw window keydown listener outside the legacy guard; no Cmd+K;
//   - the shell's finish (totalDurationDays) goes through
//     calendarIndexToWorkingOrdinal when a start date exists; fixture A 10d →
//     B 5d from Mon 2026-03-02 reads Fri Mar 20 in SchedulerHeader's formula
//     and in Row 1's (calendarDayToDate), and the old one read Thu Mar 26;
//   - the pane is a SidePanel with overlayBelow = PANE_DOCK_MIN, no onToggle;
//   - ScheduleEditPanel keeps its Modal path (presentation defaults 'modal');
//   - ScheduleDiffView's props are unchanged; CopilotContext.onPreview is
//     optional;
//   - every Change-tab open bumps the editor key; the desktop tree mounts no
//     SchedulerMenuBar bar, no 720 pill, no overlay drawer, no side inspector.
//
// Run: bun run scripts/validate-schedule-pro-screen.ts

import { readFileSync } from 'node:fs';
import { runCpm, calendarIndexToWorkingOrdinal, calendarDayToDate } from '../utils/cpm';
import { addWorkingDays } from '../utils/scheduleEngine';
import { PANE_DOCK_MIN, proPanes } from '../utils/scheduleProLayout';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, why = '') { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, why); } }
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Comments stripped, so a rule described in a comment never satisfies a check. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

/** The balanced `{…}` / `(…)` starting at src[i]. */
function balanced(src: string, i: number): string {
  const open = src[i]; const close = open === '{' ? '}' : open === '(' ? ')' : ']';
  let d = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { const e = src.indexOf(c, j + 1); if (e < 0) break; j = e; continue; }
    if (c === open) d++;
    else if (c === close) { d--; if (d === 0) return src.slice(i, j + 1); }
  }
  return src.slice(i);
}
/** The end of the JSX tag opening at src[i] ('<'): index of its '>' , and whether it self-closes. */
function tagEnd(src: string, i: number): { end: number; selfClosing: boolean } {
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { j += balanced(src, j).length - 1; continue; }
    if (c === '"' || c === "'") { j = src.indexOf(c, j + 1); continue; }
    if (c === '>') return { end: j, selfClosing: src[j - 1] === '/' };
  }
  return { end: src.length, selfClosing: false };
}
/** Top-level JSX children (elements and `{…}` expressions) of the element opening at `at`. */
export function jsxChildren(src: string, at: number): number {
  const open = tagEnd(src, at);
  if (open.selfClosing) return 0;
  let i = open.end + 1; let depth = 0; let count = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') { if (depth === 0) count++; i += balanced(src, i).length; continue; }
    if (src.startsWith('</', i)) { if (depth === 0) return count; depth--; i = src.indexOf('>', i) + 1; continue; }
    if (c === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) {
      const t = tagEnd(src, i);
      if (depth === 0) count++;
      if (!t.selfClosing) depth++;
      i = t.end + 1; continue;
    }
    i++;
  }
  return count;
}
// Self-test of the counter.
ok('self-test: the child counter reads arrows in props and expression children',
  jsxChildren('<View style={a}><A x={() => 1}>{b}</A><B y={(z) => z > 1} /></View>', 0) === 2
  && jsxChildren('<View>{a}<B /><C></C></View>', 0) === 3);

const pro = code('app/schedule-pro.tsx');
const raw = read('app/schedule-pro.tsx');
/** Where the legacy (native 900-1023) main render starts: the return that
 *  draws the old header's AI button. */
const legacyAt = pro.lastIndexOf('return (', pro.indexOf('<HeaderBtn icon={MageAIMark} label="AI"'));

console.log('\nthe width gate (content width) precedes the picker:');
{
  const gateAt = pro.indexOf('if (contentWidth < GRID_BREAKPOINT)');
  ok('the gate compares contentWidth', gateAt > 0);
  ok('…computed from the window minus the shell (rail / sidebar) on web',
    /const contentWidth = scheduleProContentWidth\(width, showShell \? layout\.sidebarWidth : 0\);/.test(pro)
      && /const showShell = Platform\.OS === 'web' && layout\.showSidebar;/.test(pro));
  ok('…before the project picker', gateAt > 0 && gateAt < pro.indexOf('<ToolProjectPicker'));
  ok('GRID_BREAKPOINT comes from utils/scheduleProLayout (no local copy, no SPLIT_BREAKPOINT)',
    !/const GRID_BREAKPOINT\s*=/.test(pro) && !/SPLIT_BREAKPOINT/.test(pro)
      && /GRID_BREAKPOINT, scheduleProContentWidth[\s\S]{0,200}from '@\/utils\/scheduleProLayout'/.test(pro));
  ok('the Brain FAB is hidden on desktop web only, before the gate',
    /useHideBrainFab\(isDesktopWeb\);/.test(pro) && pro.indexOf('useHideBrainFab(isDesktopWeb)') < pro.indexOf('if (contentWidth < GRID_BREAKPOINT)'));
  ok('a new ?projectId wins over a stale local pick',
    /useEffect\(\(\) => \{ if \(paramProjectId\) setPickedProjectId\(null\); \}, \[paramProjectId\]\);/.test(pro));
}

console.log('\nthe desktop tree:');
const desk = (() => {
  const a = pro.indexOf('  if (isDesktop) {\n    const panes = proPanes(');
  if (a < 0) return '';
  const b = pro.indexOf('\n  return (\n', a);
  return pro.slice(a, b);
})();
{
  ok('there is an isDesktop branch before the legacy tree', desk.length > 0 && legacyAt > 0 && pro.indexOf(desk) < legacyAt);
  const rowAt = pro.search(/<View\b[^>]*style=\{styles\.tabShellBody\}/);
  ok('the first styles.tabShellBody is the desktop work row', rowAt > 0 && rowAt > pro.indexOf(desk) && rowAt < pro.indexOf(desk) + desk.length);
  ok('the work row has exactly 2 children (canvas + pane)', rowAt > 0 && jsxChildren(pro, rowAt) === 2, String(rowAt > 0 ? jsxChildren(pro, rowAt) : -1));
  ok('…and they are the stamped shell and the pane',
    /<GanttStampBasis\.Provider value=\{scheduleStartIso\}>\{desktopShell\}<\/GanttStampBasis\.Provider>\s*<ScheduleAiPane \{\.\.\.aiPaneProps\} \/>/.test(desk));
  ok('the shell takes the toolbar chrome, view, density, pane, preview, ganttRef, budget',
    ['desktopChrome="toolbar"', 'view={view}', 'density={density}', 'paneOpen={docked}', 'preview={pendingPreview}', 'ganttRef={ganttTabRef}', 'hasBudget={evSnapshot.totalBudget > 0}']
      .every((k) => desk.includes(k)));
  ok('docked = pane open AND proPanes says dock', /const docked = paneOpen && panes\.paneMode === 'dock';/.test(desk));
  ok('Row 1 + Row 2 are ScheduleProToolbar; the signals row is ScheduleSignals', /<ScheduleProToolbar\b/.test(desk) && /<ScheduleSignals\b/.test(desk));
  ok('no menu bar, 720 pill, header, overlay drawer, side inspector or modal editor in the desktop tree',
    !/<SchedulerMenuBar\b|copilotDesktopBar|styles\.header\b|<AIAssistantPanel\b|<TaskInspector\b|<ScheduleEditPanel\b|<EarnedValuePanel\b|<SubUpdatesPanel\b|<WeatherReschedulePrompt\b/.test(desk));
  ok('Share → "Today & lookahead (classic)" pushes the classic tab with the same focus / classic nonce',
    /router\.push\(\{ pathname: '\/\(tabs\)\/schedule', params: \{ projectId: project\.id, focus: n, classic: n \} \}\)/.test(desk)
      && /openClassic: openClassicSchedule/.test(desk));
  ok('the notices sit in a form-width column', /<View style=\{styles\.noticeColumn\}>/.test(desk)
    && /noticeColumn:\s*\{\s*maxWidth:\s*Layout\.page\.form,\s*marginHorizontal:\s*Layout\.cardPad\s*\}/.test(pro));
}

console.log('\nkeys:');
{
  // Every raw keydown listener must sit in an effect that bails on desktop.
  const listeners = [...pro.matchAll(/window\.addEventListener\('keydown'/g)].map((m) => m.index!);
  const guarded = listeners.every((at) => {
    const fx = pro.lastIndexOf('useEffect(() => {', at);
    return fx >= 0 && /^useEffect\(\(\) => \{\s*if \(isDesktop\) return;/.test(pro.slice(fx, at));
  });
  ok(`no raw window keydown listener outside the legacy guard (${listeners.length} guarded)`, listeners.length > 0 && guarded);
  const hk = (() => { const a = pro.indexOf('useHotkeys(['); return a < 0 ? '' : balanced(pro, a + 'useHotkeys'.length); })();
  ok('the desktop keys are registry bindings (undo, redo ×2, CSV, share, ⌘J, Esc)',
    ["'mod+z'", "'mod+shift+z'", "'mod+y'", "'mod+e'", "'mod+shift+s'", "'mod+j'", "'escape'"].every((c) => hk.includes(`combo: ${c}`)));
  ok('no Cmd+K binding (the palette owns it)', !/'mod\+k'/.test(pro));
  ok('undo / redo are blocked while typing', /combo: 'mod\+z', handler: handleUndo, blockInInput: true/.test(hk) && /combo: 'mod\+shift\+z', handler: handleRedo, blockInInput: true/.test(hk));
  ok('Esc clears focus only while the pane is closed (its own Esc closes it)', /combo: 'escape'[^}]*enabled: !!focusedTaskId && !paneOpen/.test(hk));
  ok('the bindings are desktop-web only', /\], \{ enabled: isDesktopWeb \}\);/.test(pro));
}

console.log('\nthe finish date:');
{
  ok('totalDurationDays goes through calendarIndexToWorkingOrdinal when dated',
    /const totalDurationDays = scheduleStartIso\s*\?\s*calendarIndexToWorkingOrdinal\(cpm\.projectFinish, summaryScale\)\s*:\s*cpm\.projectFinish;/.test(pro));
  ok('both shells take it (no raw totalDurationDays: cpm.projectFinish left)',
    !/totalDurationDays:\s*cpm\.projectFinish/.test(pro) && (pro.match(/^\s*totalDurationDays,$/gm) ?? []).length === 2);
  ok('Row 1 renders the engine finish with calendarDayToDate', /calendarDayToDate\(projectStartDate, cpm\.projectFinish\)/.test(desk));
  const header = code('components/schedule/SchedulerHeader.tsx');
  ok('SchedulerHeader still counts WORKING days from the start (the scale this feeds)',
    /addWorkingDays\(\s*startAnchor,\s*Math\.max\(0, totalDuration - 1\)/.test(header));
  const mk = (id: string, startDay: number, durationDays: number, deps: string[] = []) =>
    ({ id, title: id, phase: 'P', durationDays, startDay, progress: 0, crew: '', dependencies: deps, notes: '', status: 'not_started' } as ScheduleTask);
  const T = [mk('a', 1, 10), mk('b', 11, 5, ['a'])];
  const scale = { scheduleStartDate: '2026-03-02', workingDaysPerWeek: 5, nonWorkingDates: [] as string[] };
  const cpm = runCpm(T, scale);
  const start = new Date(2026, 2, 2);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const header2 = addWorkingDays(start, calendarIndexToWorkingOrdinal(cpm.projectFinish, scale) - 1, 5, []);
  ok('fixture A 10d → B 5d from Mon Mar 2: the header reads Fri Mar 20', iso(header2) === '2026-03-20' && header2.getDay() === 5, iso(header2));
  ok('…Row 1 (a plain date add of the engine index) reads the same day', iso(calendarDayToDate(start, cpm.projectFinish)) === '2026-03-20');
  ok('…and the old raw hand-over read Thu Mar 26 (the bug)', iso(addWorkingDays(start, cpm.projectFinish - 1, 5, [])) === '2026-03-26');
  ok('raw-day mode (no start date) is unchanged', calendarIndexToWorkingOrdinal(runCpm(T, {}).projectFinish, {}) === runCpm(T, {}).projectFinish);
}

console.log('\nthe pane (components/schedule/desktop/ScheduleAiPane.tsx):');
{
  const pane = code('components/schedule/desktop/ScheduleAiPane.tsx');
  const tag = (() => { const a = pane.indexOf('<SidePanel'); return a < 0 ? '' : pane.slice(a, pane.indexOf('>', pane.indexOf('testID="schedule-pro-pane"'))); })();
  ok('it is a SidePanel', tag.length > 0);
  ok('overlayBelow = PANE_DOCK_MIN (1288)', /overlayBelow=\{PANE_DOCK_MIN\}/.test(tag) && PANE_DOCK_MIN === 1288);
  ok('no onToggle (⌘J focuses the command field instead)', !/onToggle/.test(tag));
  ok('it sizes from the work row (containerWidth) and does not scroll the editor', /containerWidth=\{p\.containerWidth\}/.test(tag) && /scroll=\{false\}/.test(tag));
  ok('the pane has no Modal of its own', !/<Modal\b/.test(pane));
  ok('Change = ScheduleEditPanel docked, keyed by the open nonce, the audited commit, the preview hook',
    /<ScheduleEditPanel\s+key=\{p\.editNonce\}\s+presentation="docked"/.test(pane) && /onPreview=\{p\.onPreview\}/.test(pane) && /hasToolbarUndo/.test(pane));
  ok('Ask = AIAssistantPanel embedded; Task = TaskInspector embedded', /<AIAssistantPanel \{\.\.\.p\.assistant\} visible embedded \/>/.test(pane) && /<TaskInspector[\s\S]{0,300}embedded/.test(pane));
  ok('over the slot it is exactly PANE wide, flush right', /overSlot:\s*\{\s*position:\s*'absolute',\s*top:\s*0,\s*right:\s*0,\s*bottom:\s*0,\s*width:\s*PANE\s*\}/.test(pane));
  ok('the screen draws it over the slot only in the docked split view', /overSlot: docked && view === 'split',/.test(desk));
  ok('the screen passes the audited editor commit and memoised CPM options', /commit: commitEditorBatch,/.test(desk) && /cpmOptions: editCpmOptions,/.test(desk));
  const a = proPanes(1448, { paneOpen: true });
  ok('1512 window − 64 rail = 1448: docks, grid 400 / Gantt 600 / pane 440', a.paneMode === 'dock' && a.grid === 400 && a.gantt === 600 && a.pane === 440, JSON.stringify(a));
  ok('1280 window − 64 = 1216 < 1288: the pane overlays', proPanes(1216, { paneOpen: true }).paneMode === 'overlay');
}

console.log('\nopens and closes:');
{
  const open = (() => { const a = pro.indexOf('const openChange = useCallback('); return a < 0 ? '' : pro.slice(a, pro.indexOf('}, []);', a)); })();
  ok('every Change open bumps the editor key', /setEditNonce\(\(n\) => n \+ 1\);\s*setEditOpen\(true\);/.test(open));
  const outside = pro.slice(0, legacyAt).replace(open, '');
  ok('…and the desktop code opens it nowhere else', !/setEditOpen\(true\)/.test(outside));
  ok('closing the pane clears the drawn proposal', /const closePane = useCallback\(\(\) => \{[\s\S]{0,300}setPendingPreview\(null\);/.test(pro));
  ok('the command field: a question → Ask, anything else → Change, sent at once',
    /if \(isScheduleQuestion\(text\)\) \{ openAsk\(text\); return; \}/.test(pro) && /openChange\(editorSeedFor\(text, titles\), \{ autoSubmit: true \}\);/.test(pro));
  ok('bulk "Ask AI" on desktop opens Change seeded with the selected rows',
    /if \(isDesktop\) \{[\s\S]{0,300}openChange\(editorSeedFor\('', /.test(pro.slice(pro.indexOf('const handleBulkAskAI'))));
  ok('a task click opens Task only when the pane is closed or already on Task', /if \(paneTabOnTaskSelect\(paneOpen, paneTab\)\)/.test(pro));
  const seedFx = pro.slice(pro.indexOf('claimScheduleEditSeed('), pro.indexOf('openChange(seed, { autoSubmit: true });'));
  ok('?editSeed is claimed once and refused up front for a seat that cannot write', /if \(writePath !== 'row'\)/.test(seedFx) && /setFieldNotice\(reason\)/.test(seedFx));
  ok('the arrival params (?taskId, ?editSeed) wait for Pro to render (no-ops behind the phone\'s narrow gate)',
    /if \(!canRenderPro \|\| !paramTaskId \|\| !project\?\.id\) return;/.test(pro) && /if \(!canRenderPro \|\| !paramEditSeed \|\| !project\?\.id\) return;/.test(pro)
      && /const canRenderPro = scheduleProContentWidth\(width, showShell \? layout\.sidebarWidth : 0\) >= GRID_BREAKPOINT;/.test(pro));
  ok('the legacy drawer is told the calendar too', /selectedIds=\{selectedIds\}\s*dayScale=\{summaryScale\}/.test(pro));
}

console.log('\nthe editor, the review and the context:');
{
  const panel = code('components/copilot/ScheduleEditPanel.tsx');
  ok("presentation defaults to 'modal'", /presentation = 'modal'/.test(panel));
  ok('the Modal path is intact (the scheduleEdit tutorial layer host)',
    /<Modal visible=\{visible\} transparent animationType="slide" onRequestClose=\{onClose\}>/.test(panel)
      && /testID="schedule-edit-sheet"/.test(panel));
  const docked = panel.slice(panel.indexOf("if (presentation === 'docked')"), panel.indexOf('  return (\n    <Modal'));
  ok("'docked' is a flex:1 View around CopilotShell, no Modal", docked.length > 0 && !/<Modal\b/.test(docked) && /<View style=\{styles\.docked\}/.test(docked) && /docked:\s*\{\s*flex:\s*1\s*\}/.test(panel));
  ok('onPreview rides the memoised ctx', /\.\.\.\(onPreview \? \{ onPreview \} : \{\}\)/.test(panel));
  const diff = raw.length ? code('components/copilot/ScheduleDiffView.tsx') : '';
  ok("ScheduleDiffView's props are unchanged",
    /export default function ScheduleDiffView\(\{ ops, dropped = \[\], ctx, onApply, onDiscard \}: \{\s*ops: EditOp\[\]; dropped\?: DroppedOp\[\]; ctx: CopilotContext; onApply: \(\) => void; onDiscard: \(\) => void;\s*\}\)/.test(diff));
  ok('…it builds the overlay from the same CPM runs and hands it to ctx.onPreview (null on unmount)',
    /buildSchedulePreviewOverlay\(before, after, cpmBefore, cpmAfter\)/.test(diff) && /onPreviewRef\.current\?\.\(overlayRef\.current\);\s*return \(\) => \{ onPreviewRef\.current\?\.\(null\); \};/.test(diff));
  // useProjects() is a fresh object every call, so the review's memo (and the
  // ids minted for added tasks) change on every host render: handing the host
  // the overlay by IDENTITY looped host → review → host (React's update-depth
  // limit). It is handed over when what it SAYS changes, minted ids left out.
  ok('…keyed on the overlay\'s signature, not its identity (no host ↔ review loop)',
    /\}, \[overlaySig\]\);/.test(diff) && !/\}, \[overlay\]\);/.test(diff)
      && /const overlaySig = previewSignature\(overlay\);/.test(diff));
  const sig = (() => { const a = diff.indexOf('export function previewSignature('); return a < 0 ? '' : balanced(diff, diff.indexOf('{', a)); })();
  ok('…and the signature leaves out the ids minted for added tasks', sig.length > 0 && /o\.added\.map\(\(a\) => \[a\.title, a\.es, a\.ef, a\.isMilestone, a\.afterIndex\]\)/.test(sig) && !/a\.id/.test(sig));
  const types = code('utils/copilot/types.ts');
  ok('CopilotContext.onPreview is optional', /\bonPreview\?: \(overlay:/.test(types) && !/\bonPreview: \(/.test(types));
  const shell = code('components/copilot/CopilotShell.tsx');
  ok('CopilotShell sends autoSubmitSeed once, on first listening, and clears compose',
    /if \(autoSent\.current \|\| !t \|\| state\.phase !== 'listening'\) return;\s*autoSent\.current = true;\s*setCompose\(''\);\s*utterance\(t\);/.test(shell));
  ok('"Open on web to fine-tune" stays hidden on Schedule Pro', /const onWebRoute = pathname === cap\.copy\.webRoute;/.test(shell)
    && /webRoute: '\/schedule-pro'/.test(code('utils/copilot/scheduleEdit/scheduleEditCapability.ts')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
