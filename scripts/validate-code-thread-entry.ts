// scripts/validate-code-thread-entry.ts — step 3, lane L4.
//
// The Code Thread's ENTRY POINTS and ACTION BUTTONS:
//  - the job page shows "Code checks" (desktop AND phone branches) and the
//    Scope Gaps card on the job's estimate; a punch item and a plan sheet each
//    get ONE "Code check this" entry;
//  - every new root host carries a 'codethread-' testID (the phone goldens
//    strip exactly those);
//  - CodeThreadActions never makes a second copy: local done state set BEFORE
//    the saved check is written, a busy guard, an action recorded only after
//    the add succeeded, drafts that never send;
//  - every navigation that can start inside an RN Modal closes it first and
//    pushes 350 ms later on iOS;
//  - the saved-check surfaces say they are on this device until sign-out, an
//    unreadable store never reads as "none", and the frozen disclaimer and
//    recall note are shown verbatim.
//
// Run: bun run scripts/validate-code-thread-entry.ts

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeCheckRoute } from '../utils/codeThread/actions';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

/** Blank // and /* *\/ comments (keeps strings), so a comment can never satisfy a check. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; i += 2; continue; }
      if (two === '/*') { mode = 'block'; i += 2; continue; }
      if (c === "'") mode = 'sq'; else if (c === '"') mode = 'dq'; else if (c === '`') mode = 'tpl';
      out += c; i++; continue;
    }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
    if (mode === 'block') { if (two === '*/') { mode = 'code'; i += 2; continue; } if (c === '\n') out += c; i++; continue; }
    if (c === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = 'code';
    out += c; i++;
  }
  return out;
}

const count = (s: string, needle: string | RegExp) =>
  typeof needle === 'string' ? s.split(needle).length - 1 : (s.match(new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : needle.flags + 'g')) ?? []).length;

/** The body of `name = …` / `function name(…)` up to its brace-balanced end. */
function bodyOf(src: string, startNeedle: string): string {
  const at = src.indexOf(startNeedle);
  if (at < 0) return '';
  const open = src.indexOf('{', at + startNeedle.length);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}

// ── 1. Mounts ────────────────────────────────────────────────────────────
console.log('\nMounts:');
const pd = stripComments(read('app', 'project-detail.tsx'));
const pl = stripComments(read('app', 'punch-list.tsx'));
const pv = stripComments(read('app', 'plan-viewer.tsx'));

check('project-detail mounts <ProjectCodeChecksCard project={project} /> twice (desktop and phone)',
  count(pd, '<ProjectCodeChecksCard project={project} />') === 2,
  `found ${count(pd, '<ProjectCodeChecksCard project={project} />')}`);
check('each ProjectCodeChecksCard sits right after a BuildingRecordCard',
  count(pd, /<BuildingRecordCard project=\{project\} testID="project-building-record" \/>\s*<ProjectCodeChecksCard project=\{project\} \/>/g) === 2);
check("project-detail imports ProjectCodeChecksCard from '@/components/codeThread/ProjectCodeChecksCard'",
  /import\s+(?:\{\s*)?ProjectCodeChecksCard(?:\s*\})?\s+from\s+'@\/components\/codeThread\/ProjectCodeChecksCard'/.test(pd));
check('project-detail mounts ScopeGapsCard mode="project" exactly once, keyed on project.id',
  count(pd, /<ScopeGapsCard\s+mode="project"\s+projectId=\{project\.id\}\s*\/>/g) === 1 && count(pd, '<ScopeGapsCard') === 1);
check('the ScopeGapsCard sits right after the "Create Proposal from Revision" block',
  /Create Proposal from Revision<\/Text>\s*<\/TouchableOpacity>\s*\);\s*\}\)\(\)\}\s*<ScopeGapsCard mode="project"/.test(pd));
check("project-detail imports the default ScopeGapsCard from '@/components/scopeGaps/ScopeGapsCard'",
  /import\s+ScopeGapsCard\s+from\s+'@\/components\/scopeGaps\/ScopeGapsCard'/.test(pd));

check('punch-list mounts its "Code check this item" entry exactly once, testID codethread-entry-punch',
  count(pl, '<CodeCheckThisButton') === 1 && count(pl, 'testID="codethread-entry-punch"') === 1);
const punchTag = pl.slice(pl.indexOf('<CodeCheckThisButton'), pl.indexOf('testID="codethread-entry-punch"'));
check('the punch entry is a row for the item being edited, source punch, and closes the sheet first',
  /variant="row"/.test(punchTag) && /source="punch"/.test(punchTag)
  && /sourceId=\{editingItem\.id\}/.test(punchTag) && /projectId=\{editingItem\.projectId\}/.test(punchTag)
  && /onBeforeNavigate=\{\(\) => \{ setShowForm\(false\); resetForm\(\); \}\}/.test(punchTag), punchTag.slice(0, 200));
check('the punch entry sits right before the edit sheet\'s StatusPipeline (only the gate comment, stripped to {}, between)',
  /testID="codethread-entry-punch"\s*\/>\)\s*:\s*null\}\s*(?:\{\s*\}\s*)?\{editingItem && \(\s*<View style=\{\{ marginBottom: 14 \}\}>\s*<StatusPipeline/.test(pl));

check('plan-viewer mounts its "Code check this sheet" entry exactly once, testID codethread-entry-plan',
  count(pv, '<CodeCheckThisButton') === 1 && count(pv, 'testID="codethread-entry-plan"') === 1);
const planTag = pv.slice(pv.indexOf('<CodeCheckThisButton'), pv.indexOf('/>', pv.indexOf('<CodeCheckThisButton')) + 2);
check('the plan entry is the header icon for this sheet, source plan_sheet',
  /variant="icon"/.test(planTag) && /source="plan_sheet"/.test(planTag)
  && /sourceId=\{sheet\.id\}/.test(planTag) && /projectId=\{sheet\.projectId\}/.test(planTag) && /style=\{styles\.headerBtn\}/.test(planTag),
  planTag.slice(0, 200));

const DIR = join(ROOT, 'components', 'codeThread');
const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx'));
check('components/codeThread holds the four L4 components',
  ['CodeThreadActions.tsx', 'CodeCheckThisButton.tsx', 'ProjectCodeChecksCard.tsx', 'SavedCodeCheckSheet.tsx'].every((f) => files.includes(f)));
const badIds: string[] = [];
for (const f of files) {
  const s = stripComments(read('components', 'codeThread', f));
  for (const m of s.matchAll(/testID=(?:"([^"]*)"|\{\s*`([^`]*)`\s*\}|\{\s*'([^']*)'\s*\})/g)) {
    const id = m[1] ?? m[2] ?? m[3] ?? '';
    if (!id.startsWith('codethread-')) badIds.push(`${f}: ${id}`);
  }
  for (const m of s.matchAll(/testID \?\? `([^`]*)`/g)) if (!m[1].startsWith('codethread-')) badIds.push(`${f}: ${m[1]}`);
}
check("every testID in components/codeThread/* starts with 'codethread-'", badIds.length === 0, badIds.join(', '));

// ── 2. CodeThreadActions ─────────────────────────────────────────────────
console.log('\nCodeThreadActions:');
const cta = stripComments(read('components', 'codeThread', 'CodeThreadActions.tsx'));
check('the root testID defaults to codethread-actions-${section}-${index}',
  cta.includes('testID ?? `codethread-actions-${section}-${index}`'));
check("permits are owner-only, disabled with 'Permits are managed by the project owner'",
  cta.includes("'Permits are managed by the project owner'")
  && /const blocked = !!project\.myRole && project\.myRole !== 'owner';/.test(cta)
  && /disabled=\{blocked \|\| busy !== null\}/.test(cta)
  && /\{blocked \? <Text style=\{styles\.caption\}>\{PERMIT_OWNER_ONLY_TEXT\}<\/Text> : null\}/.test(cta));
check('the permit add asks first, with the Applied text',
  cta.includes("'Add this permit to your tracker? It starts as Applied in the tracker. Update the status and date when you actually file.'")
  && /showAlert\('Add to Permits', PERMIT_CONFIRM_TEXT,/.test(cta));
check('a permit is built by permitDraftFromCodeItem and written through addPermit',
  /addPermit\(\s*permitDraftFromCodeItem\(\{/.test(cta));
check("'Schedule via Roadmap' opens the roadmap mode, with its caption, and records nothing",
  cta.includes('label="Schedule via Roadmap"')
  && cta.includes("'Inspections are scheduled from the Project Roadmap, which dates them against your permits and lead times.'")
  && /go\(codeCheckRoute\(\{ projectId: record\.projectId, mode: 'roadmap' \}\)\)/.test(cta)
  && !/runAdd\('roadmap'/.test(cta));
check('a punch item is built by punchDraftFromCodeItem with a generated id and written through addPunchItem',
  /const id = generateUUID\(\);\s*addPunchItem\(\s*punchDraftFromCodeItem\(\{/.test(cta));
check('an RFI is built by rfiDraftFromCodeItem (unsent) and written through addRFI, then opened',
  /addRFI\(\s*rfiDraftFromCodeItem\(\{/.test(cta)
  && /go\(\{ pathname: '\/rfi', params: \{ projectId: record\.projectId, rfiId: action\.createdId \} \}\)/.test(cta));
check('no draft is ever sent from here (no send/submit/email call)', !/\b(sendRFI|sendEmail|submitRFI|markSent|dateSubmitted)\b/.test(cta));

const runAdd = bodyOf(cta, 'const runAdd = useCallback(');
const iCreate = runAdd.indexOf('const createdId = create();');
const iLocal = runAdd.indexOf('setLocalDone(');
const iRecord = runAdd.indexOf('recordCodeThreadAction(');
const iCatch = runAdd.indexOf('} catch');
check('recordCodeThreadAction is called once, from runAdd only', count(cta, 'recordCodeThreadAction(') === 1 && iRecord > 0);
check('the action is recorded only after the add returned (create → setLocalDone → record, all inside try)',
  iCreate > 0 && iLocal > iCreate && iRecord > iLocal && iCatch > iRecord && runAdd.indexOf('try {') < iCreate,
  `create ${iCreate} local ${iLocal} record ${iRecord} catch ${iCatch}`);
const catchBody = runAdd.slice(iCatch, runAdd.indexOf('} finally'));
check('a thrown add shows the error, records nothing, and clears busy in finally',
  /showAlert\(/.test(catchBody) && !/recordCodeThreadAction|setLocalDone/.test(catchBody)
  && /finally \{\s*busyRef\.current = false;\s*setBusy\(null\);/.test(runAdd));
check('a busy or already-done add returns before writing anything',
  /if \(busyRef\.current \|\| doneRef\.current\.has\(kind\) \|\| doneFor\(kind\)\) return null;\s*busyRef\.current = true;\s*setBusy\(kind\);/.test(runAdd));
check('a stale queued confirm cannot add twice: doneRef is set synchronously right after create() returns',
  /const createdId = create\(\);\s*doneRef\.current\.add\(kind\);/.test(runAdd));
check('the RFI path (which navigates away) uses its own not-noted text, not the "stays marked Added" one',
  /\}, NOT_NOTED_RFI_TEXT\);/.test(cta) && !/stays marked Added/.test(cta.slice(cta.indexOf('NOT_NOTED_RFI_TEXT ='))));
check("done = local done ?? the record's action for this section, index and kind",
  /localDone\[kind\] \?\?\s*\(record\.actions \?\? \[\]\)\.find\(\(a\) => a\.section === section && a\.index === index && a\.kind === kind\) \?\?\s*null/.test(cta));
check("every add button disables while busy and says 'Adding…'",
  count(cta, /label=\{busy === '(permit|punch|rfi)' \? 'Adding…' : /g) === 3
  && count(cta, /disabled=\{(blocked \|\| )?busy !== null\}/g) === 3);
check("a done action is replaced by an 'Added …' line with an Open link",
  /doneLine\(done, 'Added to your permit tracker'\)/.test(cta)
  && /doneLine\(punchDone, 'Added to the punch list \(internal\)'\)/.test(cta)
  && /doneLine\(rfiDone, 'Added as an unsent RFI draft \(you send it\)'\)/.test(cta)
  && /<Button label="Open" size="sm" variant="ghost" onPress=\{\(\) => go\(hrefFor\(a\)\)\} \/>/.test(cta));
check('the punch and RFI buttons each hide on their OWN done state',
  /\{!punchDone \? \(/.test(cta) && /\{!rfiDone \? \(/.test(cta));

const goBody = bodyOf(cta, 'const go = useCallback(');
check('every router.push in CodeThreadActions sits inside go()',
  count(cta, 'router.push(') === 1 && goBody.includes('router.push(href)'));
check('go() calls onBeforeNavigate first, then pushes after 350 ms on iOS',
  /onBeforeNavigate\?\.\(\);\s*setTimeout\(\(\) => router\.push\(href\), Platform\.OS === 'ios' \? IOS_MODAL_NAV_DELAY_MS : 0\);/.test(goBody)
  && /export const IOS_MODAL_NAV_DELAY_MS = 350;/.test(cta));
check('every navigation target in CodeThreadActions goes through go()',
  !/router\.(replace|navigate|back)\(/.test(cta) && count(cta, /\bgo\(/g) >= 3);

// ── 3. The other components ─────────────────────────────────────────────
console.log('\nOther components:');
const btn = stripComments(read('components', 'codeThread', 'CodeCheckThisButton.tsx'));
check('CodeCheckThisButton closes first, then pushes codeCheckRoute after 350 ms on iOS',
  /onBeforeNavigate\?\.\(\);\s*const href = codeCheckRoute\(\{ projectId, source, sourceId \}\);\s*setTimeout\(\(\) => router\.push\(href\), Platform\.OS === 'ios' \? IOS_MODAL_NAV_DELAY_MS : 0\);/.test(btn)
  && count(btn, 'router.push(') === 1);
check("the icon variant is labelled 'Code check this sheet' with a 12 pt hitSlop; the row says 'Code check this item'",
  btn.includes('accessibilityLabel="Code check this sheet"') && btn.includes('hitSlop={12}')
  && btn.includes('>Code check this item</Text>') && count(btn, /testID=\{testID\}/g) === 2);

const sheet = stripComments(read('components', 'codeThread', 'SavedCodeCheckSheet.tsx'));
const runAgain = bodyOf(sheet, 'const runAgain = () =>');
check("the sheet's re-run closes the sheet before its delayed push, with the same source",
  /onClose\(\);\s*const href = codeCheckRoute\(\{ projectId: record\.projectId, source: record\.source\?\.kind, sourceId: record\.source\?\.id \}\);\s*setTimeout\(\(\) => router\.push\(href\), Platform\.OS === 'ios' \? IOS_MODAL_NAV_DELAY_MS : 0\);/.test(runAgain)
  && count(sheet, 'router.push(') === 1);
check('the sheet hands its onClose to every CodeThreadActions as onBeforeNavigate',
  count(sheet, '<CodeThreadActions') === 1 && /<CodeThreadActions[\s\S]{0,300}?onBeforeNavigate=\{onClose\}/.test(sheet));
check('the sheet shows record.disclaimer and record.recallNote verbatim, and the device note',
  sheet.includes('{record.disclaimer}') && sheet.includes('{record.recallNote}')
  && sheet.includes('>Saved on this device until you sign out.</Text>'));
check("the sheet shows 'Sent from this job: …' and the grounding chip",
  sheet.includes('`Sent from this job: ${') && sheet.includes('{g.chipLabel}'));
check('the sheet reads the live record by id, falling back to the prop',
  /const record = checks\.find\(\(c\) => c\.id === recordProp\.id\) \?\? recordProp;/.test(sheet));
check("the sheet's root testID is codethread-saved-sheet, with a ChevronLeft back",
  sheet.includes('testID="codethread-saved-sheet"') && sheet.includes('<ChevronLeft'));

const card = stripComments(read('components', 'codeThread', 'ProjectCodeChecksCard.tsx'));
check("the card's root is codethread-project-card", card.includes('<View testID="codethread-project-card"'));
check('an unreadable store says "Couldn’t read…" — and is decided BEFORE the empty case, so it never reads as none',
  card.includes("'Couldn’t read the saved checks on this device.'")
  && /status === 'failed' \? \(\s*<Text style=\{styles\.note\}>\{CODE_CHECKS_FAILED_TEXT\}<\/Text>\s*\) : checks\.length === 0 \?/.test(card));
check("the card says 'Saved on this device until you sign out.'",
  card.includes("'Saved on this device until you sign out.'") && card.includes('{CODE_CHECKS_LOCAL_CAPTION}'));
check("'Code check this job' opens the Code Check for the job (source project)",
  card.includes('label="Code check this job"')
  && /router\.push\(codeCheckRoute\(\{ projectId: project\.id, source: 'project' \}\)\)/.test(card));
check("up to 3 rows, then 'See all N'",
  /const COLLAPSED_ROWS = 3;/.test(card) && card.includes('`See all ${checks.length}`'));
check("a check with no authority says 'jurisdiction not on file'",
  card.includes("g?.authority ?? 'jurisdiction not on file'"));

// ── 4. Pure: the route every entry point builds ─────────────────────────
console.log('\nPure (codeCheckRoute):');
const r1 = codeCheckRoute({ projectId: 'p1', source: 'punch', sourceId: 'x9' });
check('a punch entry routes to the Code Check tab with projectId, source and sourceId only',
  r1.pathname === '/(tabs)/construction-ai' && JSON.stringify(r1.params) === JSON.stringify({ projectId: 'p1', source: 'punch', sourceId: 'x9' }));
const r2 = codeCheckRoute({ projectId: 'p1', mode: 'roadmap' });
check("'Schedule via Roadmap' routes with mode roadmap and no source",
  JSON.stringify(r2.params) === JSON.stringify({ projectId: 'p1', mode: 'roadmap' }));
const r3 = codeCheckRoute({ projectId: 'p1', source: 'project' });
check("'Code check this job' routes with source project and no sourceId",
  JSON.stringify(r3.params) === JSON.stringify({ projectId: 'p1', source: 'project' }));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
