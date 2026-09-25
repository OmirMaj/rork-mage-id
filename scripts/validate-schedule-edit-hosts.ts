// scripts/validate-schedule-edit-hosts.ts — the AI schedule editor's hosts
// tell the truth about what they saved, and the editor is a readable column on
// a wide web window (integration round 1 of audit wave 6a).
//
// What this pins, per host of ScheduleEditPanel:
//   - a write the host refuses (field / view-only seat, a saved plan on
//     screen) RETURNS the reason, so the "what landed" card says "Nothing was
//     saved" instead of ticking "Added …" lines over an alert;
//   - an AI batch that does land writes a schedule History row (the classic
//     tab used to write none);
//   - "use Undo in the toolbar" is only said where a toolbar Undo exists;
//   - the classic tab refuses BEFORE an AI turn is spent;
//   - the editor sheet, the /copilot column and the prompt pills are capped
//     (founder, 2026-09-23: "the boxes are so stretched out").
//
// SOURCE guard (styles and host wiring are not observable from bun without a
// renderer); the behaviour itself is rendered in
// __tests__/smoke/schedule-edit-undo-hosts.test.tsx.
//
// Run via: bun run scripts/validate-schedule-edit-hosts.ts

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
/** Comments stripped, so a rule described in a comment never satisfies a check. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const slice = (src: string, from: string, to: string) => {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b < 0 ? undefined : b);
};

console.log('\nthe editor sheet and the Copilot column (wide web window):');
{
  const panel = code('components/copilot/ScheduleEditPanel.tsx');
  ok('sheet: width 100% under a 720 cap, centred in its overlay',
    /SCHEDULE_EDIT_SHEET_MAX_WIDTH = 720;/.test(panel)
      && /overlay:\s*\{[^}]*alignItems:\s*'center'/.test(panel)
      && /sheet:\s*\{[^}]*width:\s*'100%',\s*maxWidth:\s*SCHEDULE_EDIT_SHEET_MAX_WIDTH/.test(panel));
  ok('the keyboard cannot cover the follow-up box (KeyboardAvoidingView on iOS)',
    /<KeyboardAvoidingView style=\{styles\.overlay\} behavior=\{Platform\.OS === 'ios' \? 'padding' : undefined\}>/.test(panel));
  ok('"use Undo in the toolbar" only where the host has one',
    /hasToolbarUndo\s*\?\s*'The schedule changed since — use Undo in the toolbar instead\.'/.test(panel));

  const shell = code('components/copilot/CopilotShell.tsx');
  ok('/copilot: topbar, body and actionbar share one 720 column',
    /COPILOT_COLUMN_MAX_WIDTH = 720;/.test(shell)
      && ['topbar', 'body', 'actionbar'].every(k => new RegExp(`${k}:\\s*\\{\\s*width:\\s*'100%',\\s*maxWidth:\\s*COPILOT_COLUMN_MAX_WIDTH,\\s*alignSelf:\\s*'center'`).test(shell)));
  ok('body scroll keeps taps with the keyboard up and insets for it',
    /<ScrollView contentContainerStyle=\{styles\.body\}[^>]*keyboardShouldPersistTaps="handled"[^>]*automaticallyAdjustKeyboardInsets/.test(shell));
}

console.log('\nSchedule Pro (app/schedule-pro.tsx):');
{
  const pro = code('app/schedule-pro.tsx');
  const batch = slice(pro, 'const commitEditorBatch = useCallback(', 'const startDayBasisPreview');
  ok('a view-only seat gets the reason back and nothing is committed',
    /else if \(writePath !== 'row'\) \{\s*return 'Not saved: you have view-only access/.test(batch));
  ok('a field seat is refused unless the batch only touches field keys',
    /if \(writePath === 'field_rpc'\)/.test(batch) && /FIELD_TASK_PATCH_KEYS/.test(batch)
      && /if \(!fieldOnly\) return 'Not saved: field access/.test(batch));
  ok('it still commits through the audited AI batch', /commitAiBatch\(producer, 'AI schedule edit'\);/.test(batch));
  const mount = slice(pro, '<ScheduleEditPanel', '/>');
  ok('the editor is told this screen has a toolbar Undo', /commit=\{commitEditorBatch\}[\s\S]*hasToolbarUndo/.test(mount));
  // Wave 6c: on a desktop browser the 720 pill is gone — the one front door is
  // Row 1's command field, capped at a field width (Layout.field.md = 360).
  const toolbar = code('components/schedule/desktop/ScheduleProToolbar.tsx');
  ok('the Row-1 command field is capped at a field width (Layout.field.md)',
    /testID="schedule-command-field"/.test(toolbar)
      && /command:\s*\{[^}]*maxWidth:\s*Layout\.field\.md,/.test(toolbar)
      && /style=\{styles\.command\}/.test(toolbar));
}

console.log('\nclassic Schedule tab (app/(tabs)/schedule/index.tsx):');
{
  const tab = code('app/(tabs)/schedule/index.tsx');
  const commit = slice(tab, 'const mobileCommit = useCallback(', 'const handleSaveTask');
  ok('a blocked seat returns the reason (no write)', /if \(scheduleWriteBlockedReason\) return `Not saved: \$\{scheduleWriteBlockedReason\}`;/.test(commit));
  ok('a saved plan on screen returns the reason (no write)', /const whatIf = activeScenarioTasks \? whatIfEditRefusal\(activeSchedule\) : null;\s*if \(whatIf\) return whatIf\.reason;/.test(commit));
  ok('a save that did not happen is reported', /const saved = persistEditedTasks\(producer\(prevTasks\)\);\s*if \(!saved\) return /.test(commit));
  ok('a landed AI batch writes one History row', /describeMobileScheduleEdit\(\{[\s\S]*reason: 'AI schedule change'/.test(commit)
    && /appendAuditToAsyncStorage\(selectedProject\.id, buildAuditEntry\(auditDraft\)\)/.test(commit));
  ok('persistEditedTasks reports what it saved; saveSchedule reports a refusal',
    /if \(saveSchedule\(merged, selectedProject\) === false\) return null;\s*return \{ tasks: stamped, finish: cpmResult\.projectFinish \};/.test(tab)
      && /if \(refuseScheduleWrite\('Schedule changes'\)\) return false;/.test(slice(tab, 'const saveSchedule = useCallback(', 'const openStartDatePicker') || tab));
  const bar = slice(tab, 'style={styles.copilotBar}', 'testID="schedule-copilot-bar"');
  ok('the bar refuses before an AI turn is spent', /if \(refuseScheduleWrite\('AI schedule change'\) \|\| refuseWhileWhatIf\(\)\) return;\s*openEditor\(undefined\);/.test(bar));
  // Review round 2: a hub/mic arrival skipped the saved-plan refusal, so the
  // preview was built on the frozen snapshot and Apply refused after the AI
  // turn was spent. The seed effect refuses exactly as the bar does.
  const seedFx = slice(tab, "if (!claimScheduleEditSeed(", 'MODAL_DISMISS_DELAY_MS(Platform.OS));');
  ok('a hub/mic arrival is refused like the bar (seat AND saved plan) before the editor opens',
    /if \(refuseScheduleWrite\('AI schedule change'\) \|\| refuseWhileWhatIf\(\)\) return;\s*const seed = String\(routeEditSeed\);\s*setTimeout\(\(\) => openEditor\(seed\), $/.test(seedFx));
  // Each open is a fresh sheet: iOS never retries a refused Modal present, so
  // a stuck editOpen made the bar dead on that screen instance.
  const mobSrc = read('components/schedule/mobile/MobileScheduleScreen.tsx');
  for (const [name, src] of [['classic tab', tab], ['phone', mobSrc]] as const) {
    ok(`${name}: every open bumps the sheet key (a refused present can be retried)`,
      /<ScheduleEditPanel\s+key=\{editNonce\}/.test(src) && /setEditNonce\(\(n\) => n \+ 1\);\s*setEditOpen\(true\);/.test(src)
      && !/setEditOpen\(true\)/.test(src.replace(/setEditNonce\(\(n\) => n \+ 1\);\s*setEditOpen\(true\);/, '')));
    ok(`${name}: a seeded arrival opens after the previous sheet has gone (iOS guard)`,
      /setTimeout\(\(\) => openEditor\(seed\), MODAL_DISMISS_DELAY_MS\(Platform\.OS\)\)/.test(src));
  }
  ok('the prompt pills are capped (720)', /copilotEntry:\s*\{\s*maxWidth:\s*720,/.test(tab) && /copilotBar:\s*\{\s*maxWidth:\s*720,/.test(tab));
}

console.log('\niPhone (components/schedule/mobile/MobileScheduleScreen.tsx):');
{
  const phone = code('components/schedule/mobile/MobileScheduleScreen.tsx');
  const commit = slice(phone, 'const commitAiEdit = useCallback(', 'useEffect(');
  ok('a field / view-only seat gets the notice back as the reason', /setFieldNotice\(notice\);\s*return writePath === 'field_rpc' \? notice : `Not saved: \$\{notice\}`;/.test(commit));
  ok('the History row helper is shared with the classic tab', /export function describeMobileScheduleEdit\(/.test(phone));
}

console.log('\nthe capability reports a refused write:');
{
  const cap = code('utils/copilot/scheduleEdit/scheduleEditCapability.ts');
  ok('commitRefused → nothing landed, every line "Not saved — …"',
    /if \(commitRefused\(wrote\)\) \{[\s\S]*landed: \[\], notLanded: \[\.\.\.why, \.\.\.lines\.map\(l => `Not saved — \$\{l\}`\)/.test(cap));
  const types = code('utils/copilot/types.ts');
  ok('false or a reason string = refused', /export const commitRefused = \(o: CommitOutcome\): boolean => o === false \|\| typeof o === 'string';/.test(types));
}

console.log('\nthe AI drawer (components/schedule/AIAssistantPanel.tsx):');
{
  const drawer = code('components/schedule/AIAssistantPanel.tsx');
  ok('Generate hands an add request to the editor when the plan has tasks',
    /if \(tasks\.length > 0 && handOffIfAdd\(genDraft\.trim\(\)\)\) \{ setGenDraft\(''\); return; \}/.test(slice(drawer, 'const handleGenerate = useCallback(', 'run(async')));
  ok('Generate\'s Apply says it REPLACES the plan', /`Replace \$\{tasks\.length\} task\$\{tasks\.length === 1 \? '' : 's'\} with \$\{genPreview\.length\}`/.test(drawer));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
