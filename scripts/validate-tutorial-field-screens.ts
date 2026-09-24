// scripts/validate-tutorial-field-screens.ts — the tutorial wiring on the
// field screens (lane L3): the daily report, the punch walk, the plan-pin step,
// the project hub and the practice pass in useProjectAccess.
//
// WHY THIS EXISTS. validate-tutorial-defs proves every target, signal, assist
// and layer id EXISTS in its file. It cannot see what the wiring around them
// promises, and every one of these promises fails silently:
//   • the sample voice note must cost NOTHING (no AI call, no meter move) while
//     the mic, through the SAME fill, stays metered — a founder-visible rule
//     ("Sample — no AI credits used");
//   • a success signal fires only on the REAL success point (non-silent save,
//     before the screen navigates away) and never on a fill that wrote nothing;
//   • an assist ('Do it for me') fills or picks, and never saves;
//   • a sample photo never gets a GPS stamp (it was taken nowhere);
//   • the sample chips only render during their step, on the tutorial's sample;
//   • every layer-less modal on a screen mounts that screen's blocker sentinel,
//     or the coach draws a dim and a card BEHIND an iOS sheet — and a modal
//     added next month without joining the sentinel is exactly that bug;
//   • a sample job's Submit sends only to its owner (utils/sampleGuard);
//   • the practice pass is ORed into useProjectAccess and nowhere looser.
// Plus one executed table: the practice pass composed the way useProjectAccess
// composes it opens exactly one feature, on exactly one project, while a run
// is live — driven through the real practicePass + defs modules.
//
// Source pins run on comment-stripped text, so a comment that mentions a call
// can never satisfy (or break) a pin.
//
// Run: bun run scripts/validate-tutorial-field-screens.ts

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TUTORIAL_DEFS } from '../utils/tutorial/defs';
import { practiceAllows, PRACTICE_GRACE_MS } from '../utils/tutorial/practicePass';
import { targetChain } from '../utils/tutorial/machine';
import type { FeatureKey, RunState } from '../utils/tutorial/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

/** A top-level `const X = useCallback(` body, up to its 2-space `}, [deps]);`. */
function region(src: string, decl: string): string {
  const i = src.indexOf(decl);
  if (i < 0) return '';
  const rest = src.slice(i);
  const end = /\n {2}\}, \[[^\n]*\]\);/.exec(rest);
  return end ? rest.slice(0, end.index) : '';
}

/** The JSX between `<TutorialTarget id="id"…>` and its matching close. */
function targetBlock(src: string, id: string): string {
  const open = src.indexOf(`<TutorialTarget id="${id}"`);
  if (open < 0) return '';
  let depth = 0;
  const re = /<TutorialTarget\b|<\/TutorialTarget>|\/>/g;
  re.lastIndex = open;
  let m: RegExpExecArray | null;
  let first = true;
  while ((m = re.exec(src))) {
    if (m[0] === '<TutorialTarget') { depth++; first = false; continue; }
    if (m[0] === '/>') {
      // A self-closing TutorialTarget (a sentinel) closes itself; other `/>`
      // belong to children and are ignored.
      const tagStart = src.lastIndexOf('<', m.index);
      if (src.startsWith('<TutorialTarget', tagStart) && src.indexOf('>', tagStart) === m.index + 1) depth--;
      if (depth === 0 && !first) return src.slice(open, m.index + 2);
      continue;
    }
    depth--;
    if (depth === 0) return src.slice(open, m.index + m[0].length);
  }
  return '';
}

/** The condition of the `{(…) ? <TutorialTarget id="x.modalUp" /> : null}` sentinel. */
function sentinelCondition(src: string, id: string): string {
  const at = src.indexOf(`<TutorialTarget id="${id}" />`);
  if (at < 0) return '';
  const open = src.lastIndexOf('{(', at);
  return open < 0 ? '' : src.slice(open, at);
}

/** Every `visible={EXPR}` in a file (the modals and sheets it renders). */
function visibleExprs(src: string): string[] {
  const out: string[] = [];
  const re = /\bvisible=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
    }
    out.push(src.slice(start, i - 1).trim());
  }
  return out;
}

const DFR = strip(read('app/daily-report.tsx'));
const WALK = strip(read('app/punch-walk.tsx'));
const PIN = strip(read('components/punch/PlanPinStep.tsx'));
const HUB = strip(read('app/project-detail.tsx'));
const ACCESS = strip(read('hooks/useProjectAccess.ts'));
const LIST = strip(read('app/punch-list.tsx'));

// ════════════════════════════════════════════════════════════════════════════
console.log('\n1. every layer-less modal mounts its screen\'s blocker sentinel');
{
  const cases: { file: string; src: string; id: string; exempt: string[]; extra: string[] }[] = [
    // PlanPinStep hosts its own planPin layer; `true` is the gate's Paywall
    // (the whole screen, before the walk mounts).
    { file: 'app/punch-walk.tsx', src: WALK, id: 'punch.modalUp', exempt: ['pinStepOpen', 'true'], extra: [] },
    { file: 'app/daily-report.tsx', src: DFR, id: 'dfr.modalUp', exempt: [], extra: [] },
    // EntityActionSheet has no `visible` prop (it opens on entityRef); the
    // reflow preview mounts with a bare `visible` under coReflowPreview.
    { file: 'app/project-detail.tsx', src: HUB, id: 'hub.modalUp', exempt: [], extra: ['actionSheetRef !== null', 'coReflowPreview !== null'] },
  ];
  for (const c of cases) {
    const cond = sentinelCondition(c.src, c.id);
    ok(`${c.file}: renders a childless <TutorialTarget id="${c.id}" /> under a condition`, cond.length > 0);
    const missing = visibleExprs(c.src).filter(e => !c.exempt.includes(e) && !cond.includes(e));
    ok(`${c.file}: every visible={…} modal is in the ${c.id} condition`, missing.length === 0, `missing: ${missing.join(' | ')}`);
    const missingExtra = c.extra.filter(e => !cond.includes(e));
    ok(`${c.file}: the prop-less sheets are in it too`, missingExtra.length === 0, `missing: ${missingExtra.join(' | ')}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. daily report: the sample note is free, the mic is metered, both fill the same way');
{
  const apply = region(DFR, 'const applyParsedDfr = useCallback(');
  ok('applyParsedDfr exists', apply.length > 0);
  const rec = apply.indexOf("recordAIUsage('fast', 'voiceCapture')");
  const gate = apply.indexOf('if (opts.metered) {');
  ok('applyParsedDfr records voiceCapture usage ONLY inside `if (opts.metered)`',
    rec > 0 && gate > 0 && gate < rec && (apply.match(/recordAIUsage\(/g) ?? []).length === 1);
  ok('applyParsedDfr makes no AI call itself (no mageAI / parser inside the fill)', !/mageAI\(|parseDFRFromTranscript\(/.test(apply));
  ok('dfr.voice.applied fires only when the note wrote something (fields.length > 0)',
    /if \(projectId && fields\.length > 0\) tutorialSignal\('dfr\.voice\.applied'/.test(apply));
  ok('…with the fields it wrote, and where the note came from', /tutorialSignal\('dfr\.voice\.applied', \{ projectId, fields, source: opts\.source \}\)/.test(apply));
  ok('the fill never overwrites what he typed (each field gated on empty)',
    /parsed\.manpower && manpower\.length === 0/.test(apply) && /parsed\.workPerformed && !workPerformed/.test(apply)
    && /parsed\.issuesAndDelays && !issuesAndDelays/.test(apply) && /parsed\.weather && !weather\.temperature/.test(apply));

  const sample = region(DFR, 'const applySampleNote = useCallback(');
  ok('the sample chip calls the shared fill UNMETERED', /applyParsedDfr\(parsed, \{ metered: false, source: 'sample' \}\)/.test(sample));
  ok('…with no AI call and no meter anywhere in it', sample.length > 0 && !/recordAIUsage|mageAI\(|parseDFRFromTranscript|checkAILimit/.test(sample));
  ok('…and only on the tutorial\'s sample project', /if \(!onTutorialSample\) return;/.test(sample));
  ok('onTutorialSample compares the live run\'s sandbox to THIS report\'s project',
    /const onTutorialSample = !!projectId && tutorialSandboxId === projectId;/.test(DFR));

  const mic = DFR.slice(DFR.indexOf('onTranscriptReady={async (transcript) => {'), DFR.indexOf('isLoading={voiceLoading}'));
  const parse = mic.indexOf('parseDFRFromTranscript(');
  const applyMic = mic.indexOf("applyParsedDfr(parsed, { metered: true, source: 'mic' })");
  ok('the mic path parses (the AI call) and then applies METERED', parse > 0 && applyMic > parse);

  const block = targetBlock(DFR, 'dfr.voice');
  ok('the sample chip sits INSIDE the dfr.voice target (one hole over mic and chip)',
    /<VoiceRecorder/.test(block) && /testID="dfr-sample-note"/.test(block));
  ok('…rendered only while its step is live on the sample', /\{showSampleNote && !isLocked \? \(/.test(block)
    && /const showSampleNote = onTutorialSample && sampleNoteStepLive;/.test(DFR)
    && /useTutorialStepActive\('dfr-voice'\)/.test(DFR));
  ok('…and labelled as a sample that uses no credits', /SAMPLE_NO_CREDITS_LABEL/.test(block));
  ok("'Do it for me' on the voice step is the same unmetered fill", /useTutorialAssist\('dfr\.useSampleNote', applySampleNote\)/.test(DFR));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. daily report: dfr.saved is the real, non-silent save, before the screen leaves');
{
  const save = region(DFR, 'const handleSave = useCallback(');
  ok('handleSave exists', save.length > 0);
  const sigs = [...save.matchAll(/tutorialSignal\('dfr\.saved'/g)].map(m => m.index ?? -1);
  ok('dfr.saved is emitted on both the insert and the update path', sigs.length === 2);
  // Each emission must sit inside an `if (!silent) {` block: walk back to the
  // nearest opener and check the braces never close in between.
  const inside = sigs.every(at => {
    const open = save.lastIndexOf('if (!silent) {', at);
    if (open < 0) return false;
    let depth = 0;
    for (let i = open + 'if (!silent) '.length; i < at; i++) {
      if (save[i] === '{') depth++;
      else if (save[i] === '}') { depth--; if (depth === 0) return false; }
    }
    return depth > 0;
  });
  ok('…only on the non-silent path (the pre-send write is not his Save)', inside);
  const back = save.lastIndexOf('if (!silent) goBack();');
  ok('…and before goBack(), so the coach never flashes "paused"', back > 0 && sigs.every(at => at < back));
  const add = save.indexOf('addDailyReport(report);');
  ok('the insert-path signal comes after addDailyReport (the record exists)', add > 0 && sigs.some(at => at > add));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. daily report: a sample job\'s Submit reaches only its owner');
{
  const confirm = region(DFR, 'const handleConfirmSend = useCallback(');
  const guard = confirm.indexOf('sampleSendAllowed(project, sendRecipientEmail, user?.email)');
  const persist = confirm.indexOf("handleSave('draft'");
  ok('handleConfirmSend refuses a non-owner address on a sample BEFORE it saves or sends', guard > 0 && persist > guard);
  ok('…and returns without sending', /if \(sendRecipientEmail\.trim\(\) && !sampleSendAllowed\([^)]*\)\) \{[\s\S]{0,160}return;/.test(confirm));
  const press = region(DFR, 'const handleSendPress = useCallback(');
  ok('the sheet opens seeded with his own address on a sample', /sampleSendPlan\(project, user\?\.email\)/.test(press) && /setSendRecipientEmail\(samplePlan\.to \?\? ''\)/.test(press));
  ok('…read-only, with no contact picker', /editable=\{!sendIsSample\}/.test(DFR) && /contacts\.length > 0 && !sendIsSample/.test(DFR));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. punch walk: the sample photo, the sample line and the signals');
{
  const sample = region(WALK, 'const acceptSamplePhoto = useCallback(');
  ok('acceptSamplePhoto exists', sample.length > 0);
  ok('the sample photo is NEVER GPS-stamped (it was taken nowhere)', !/stampPhotoLocation/.test(sample) && /pendingStampRef\.current = null;/.test(sample));
  ok('…lands on the draft, then runs the same pin-step gate as a camera shot',
    /photoUri: img\.uri/.test(sample) && /shouldAutoOpenPinStep\(\{ pinnableSheetCount: planSheetCount/.test(sample) && /openPinStep\(\)/.test(sample)
    && sample.indexOf('photoUri: img.uri') < sample.indexOf('openPinStep()'));
  ok("…and reports punch.photo.added as 'sample'", /tutorialSignal\('punch\.photo\.added', \{ projectId, source: 'sample' \}\)/.test(sample));
  ok('…and never saves', !/handleSave\(|onAdd\(/.test(sample));

  const camera = WALK.slice(WALK.indexOf('const handleCamera = useCallback'), WALK.indexOf('const handlePinNext = useCallback'));
  ok('a camera / library photo reports punch.photo.added after it lands on the draft',
    camera.indexOf("tutorialSignal('punch.photo.added'") > camera.indexOf('photoUri: result.assets[0].uri'));

  const next = WALK.slice(WALK.indexOf('const handlePinNext = useCallback'), WALK.indexOf('const handlePinSkip = useCallback'));
  const skip = WALK.slice(WALK.indexOf('const handlePinSkip = useCallback'), WALK.indexOf('const handleRemovePin = useCallback'));
  ok('Next reports pinned: true, Skip reports pinned: false',
    /tutorialSignal\('punch\.pin\.decided', \{ projectId, pinned: true \}\)/.test(next)
    && /tutorialSignal\('punch\.pin\.decided', \{ projectId, pinned: false \}\)/.test(skip));

  const line = region(WALK, 'const applySampleLine = useCallback(');
  ok('the sample line fills the description and, only when empty, the room', /description: PUNCH_SAMPLE\.line/.test(line)
    && /location: d\.location\.trim\(\) \? d\.location : PUNCH_SAMPLE\.room/.test(line));
  ok('…and leaves the trade to the real inference (no trade written)', !/trade\s*:/.test(line));
  ok('…and never saves', !/handleSave\(|onAdd\(/.test(line));

  ok('the assists run only on the tutorial\'s sample',
    /useTutorialAssist\('punch\.useSamplePhoto', \(\) => \{ if \(onTutorialSample\) void acceptSamplePhoto\(\); \}\)/.test(WALK)
    && /useTutorialAssist\('punch\.useSampleLine', \(\) => \{ if \(onTutorialSample\) applySampleLine\(\); \}\)/.test(WALK)
    && /const onTutorialSample = tutorialSandboxId === projectId;/.test(WALK));

  const desc = WALK.slice(WALK.indexOf("tutorialSignal('punch.description.filled'") - 400, WALK.indexOf("tutorialSignal('punch.description.filled'") + 120);
  ok('description.filled: 3+ chars, debounced 600 ms, no timer when no tutorial runs',
    /if \(chars < 3 \|\| !isTutorialActive\(\)\) return;/.test(desc) && /, 600\)/.test(desc) && /clearTimeout\(t\)/.test(WALK));

  const save = region(WALK, 'const handleSave = useCallback(');
  const add = save.indexOf('onAdd(item);');
  const sig = save.indexOf("tutorialSignal('punch.saved'");
  ok('punch.saved fires right after the real onAdd', add > 0 && sig > add);
  ok('…pinned is read from the SAVED item, not the draft', /pinned: !!item\.planSheetId/.test(save));

  const cam = targetBlock(WALK, 'punch.camera');
  ok('the sample photo chip sits inside the punch.camera target, only while its step is live',
    /testID="walk-sample-photo"/.test(cam) && /\{showSamplePhoto \? \(/.test(cam)
    && /const showSamplePhoto = onTutorialSample && samplePhotoStepLive;/.test(WALK) && /useTutorialStepActive\('punch-photo'\)/.test(WALK));
  const d = targetBlock(WALK, 'punch.description');
  ok('the sample line chip sits inside the punch.description target, only while its step is live',
    /testID="walk-description"/.test(d) && /testID="walk-sample-line"/.test(d) && /\{showSampleLine \? \(/.test(d)
    && /useTutorialStepActive\('punch-describe'\)/.test(WALK));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6. the chips name steps that exist, on the targets those steps light');
{
  const want: [string, string, string][] = [
    ['daily-report-voice', 'dfr-voice', 'dfr.voice'],
    ['punch-walk', 'punch-photo', 'punch.camera'],
    ['punch-walk', 'punch-describe', 'punch.description'],
  ];
  for (const [tid, sid, target] of want) {
    const def = TUTORIAL_DEFS[tid as keyof typeof TUTORIAL_DEFS];
    const step = def?.steps.find(s => s.id === sid);
    ok(`${tid} › ${sid} exists and lights ${target}`, !!step && targetChain(step).includes(target as never));
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n7. PlanPinStep: the layer lives inside the modal; the assist is sample-plan only');
{
  const modal = PIN.slice(PIN.indexOf('<Modal visible={visible}'), PIN.indexOf('</Modal>'));
  ok('<TutorialLayer host="planPin" /> is inside the full-screen Modal, after the body',
    modal.indexOf('<PlanPinStepBody key={openSeq}') > 0 && modal.indexOf('<TutorialLayer host="planPin" />') > modal.indexOf('<PlanPinStepBody key={openSeq}'));
  const assist = PIN.slice(PIN.indexOf("useTutorialAssist('punch.dropPinKitchen'"), PIN.indexOf("useTutorialAssist('punch.dropPinKitchen'") + 400);
  ok("'Do it for me' drops the pin only on the bundled sample sheet, only when a pin can be placed",
    /if \(!canPin \|\| !sheet \|\| findSamplePlanSheet\(\[sheet\], projectId\)\?\.id !== sheet\.id\) return;/.test(assist)
    && /setPin\(\{ x: SAMPLE_PLAN\.rooms\.Kitchen\.x, y: SAMPLE_PLAN\.rooms\.Kitchen\.y \}\)/.test(assist));
  ok('…and never presses Next', !/onNext\(|handleNext\(/.test(assist));
  ok('the pin-marker sentinel mounts only with the marker', /\{marker \? <TutorialTarget id="punch\.pinMarker" \/> : null\}/.test(PIN));
  ok('the Next target IS the old flex:2 cell', /<TutorialTarget id="punch\.pinNext" style=\{\{ flex: 2 \}\}>/.test(PIN) && !/<View style=\{\{ flex: 2 \}\}>\s*<Button[^]*?testID="walk-pin-next"/.test(PIN));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n8. the hub: tiles and groups are unstyled wrappers; the pinned access line is intact');
{
  // Phone: no style. Desktop: row-only, so the row-wrap grid still stretches
  // the tile to its line height (integration review; the jest layout test
  // tutorial-target-layout runs the desktop diff and neutrality rule).
  ok('every tile is wrapped (dynamic family) with its key; unstyled on phone, row-only on the desktop grid',
    /<TutorialTarget key=\{tile\.key\} id=\{`hub\.tile\.\$\{tile\.key\}`\} style=\{layout\.isDesktop \? styles\.tileTargetDesktop : undefined\}>/.test(HUB)
      && /tileTargetDesktop: \{ flexDirection: 'row' as const \},/.test(HUB));
  ok('every group header is wrapped, unstyled', /<TutorialTarget id=\{`hub\.group\.\$\{group\.key\}`\}>/.test(HUB));
  ok('validate-project-hub-rules\' pinned line is untouched', HUB.includes('const { canAccess: canAccessProject } = useProjectAccess(id);'));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n9. the practice pass: opt-in on the tutorial\'s own screens only; the gates pass the offer');
{
  // Integration review round 2: ORed into useProjectAccess, the pass opened
  // every screen gated on a practised feature, and /change-order and
  // /field-ticket load a record by id from ANY project — sample projectId +
  // real coId opened the real job. The simplest provable rule: the pass is
  // read ONLY by these files, each of which writes only to the project its
  // gate checked. A new reader must be argued for here, not slipped in.
  const PASS_READERS = new Set([
    'app/punch-walk.tsx',      // walk mode: no record-id param; writes to the URL project
    'app/invoice.tsx',         // route gate on the URL project + InvoiceInner re-check on the job it writes
    'app/project-detail.tsx',  // tile-lock DISPLAY only; every screen behind a tile gates itself
  ]);
  const readers: string[] = [];
  const walkDir = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name !== 'node_modules') walkDir(rel); continue; }
      // The engine itself (utils/tutorial/*) defines the rule; everything else is a reader.
      if (!/\.(ts|tsx)$/.test(e.name) || rel.startsWith('utils/tutorial/')) continue;
      // Calls, not the def field (the host reads def.practiceFeatures to pop gated screens on exit).
      if (/(?<![.\w])(useTutorialPractice|tutorialPracticeAllows|practiceAllows|practiceFeatures)\s*\(/.test(strip(read(rel)))) readers.push(rel);
    }
  };
  for (const d of ['app', 'components', 'hooks', 'contexts', 'utils']) walkDir(d);
  const stray = readers.filter(f => !PASS_READERS.has(f));
  ok('only punch-walk, invoice and the hub read the practice pass', stray.length === 0, stray.join(', '));
  ok('useProjectAccess does NOT carry the pass (it would open every gated screen)',
    !/useTutorialPractice|practiceAllows|tutorial\//.test(ACCESS)
      && /resolveProjectAccess\(canAccess\(feature\), role, feature as string\),/.test(ACCESS));
  ok('the punch-walk gate reads the pass for the URL project and ORs it',
    /const practice = useTutorialPractice\(gateProjectId\);/.test(WALK)
      && /if \(!canAccess\('punch_list_closeout'\) && !practice\.has\('punch_list_closeout'\)\) \{/.test(WALK));
  ok('…and walk mode takes no record id that could name another job',
    /useLocalSearchParams<\{ projectId\?: string; list\?: string; listType\?: string; start\?: string \}>\(\)/.test(WALK));
  ok('the hub ORs the pass into the tile locks only',
    /const hubPractice = useTutorialPractice\(id\);/.test(HUB)
      && /canAccessProject: f => canAccessProject\(f as Parameters<typeof canAccessProject>\[0\]\) \|\| hubPractice\.has\(f as FeatureKey\),/.test(HUB)
      && (HUB.match(/hubPractice/g) ?? []).length === 3);
  ok('the punch-walk wall offers the punch-walk practice run', /practiceTutorialId="punch-walk"/.test(WALK));
  ok('the punch-list wall offers it too', /practiceTutorialId="punch-walk"/.test(LIST));

  // Executed: the composition the opt-in gates perform, over the real rule.
  const compose = (own: boolean, s: RunState, pid: string, f: FeatureKey, now: number) => own || practiceAllows(s, pid, f, now);
  const T0 = 1_000_000;
  const running = { status: 'running', tutorialId: 'punch-walk', sandboxProjectId: 'sb' } as unknown as RunState;
  const invoiceRun = { status: 'running', tutorialId: 'invoice-to-self', sandboxProjectId: 'sb' } as unknown as RunState;
  const dfrRun = { status: 'running', tutorialId: 'daily-report-voice', sandboxProjectId: 'sb' } as unknown as RunState;
  const ended = (at: number) => ({ status: 'finished', tutorialId: 'punch-walk', sandboxProjectId: 'sb', endedAt: at, outcome: 'completed' }) as unknown as RunState;
  const idle = { status: 'idle' } as unknown as RunState;
  ok('a Free user on the sample during punch-walk: punch walk opens', compose(false, running, 'sb', 'punch_list_closeout', T0));
  ok('…on his REAL job at the same moment: it does not', !compose(false, running, 'real', 'punch_list_closeout', T0));
  ok('…a feature the run does not practise: it does not', !compose(false, running, 'sb', 'rfis_submittals', T0));
  ok('…invoicing during the punch run: it does not', !compose(false, running, 'sb', 'change_orders_invoicing', T0));
  ok('the invoice run opens invoicing on the sample, not punch walk',
    compose(false, invoiceRun, 'sb', 'change_orders_invoicing', T0) && !compose(false, invoiceRun, 'sb', 'punch_list_closeout', T0));
  ok('the daily-report run opens nothing (it practises a Free feature)', !compose(false, dfrRun, 'sb', 'punch_list_closeout', T0));
  ok('ended < grace ago: still open (the pop animation); at grace: closed',
    compose(false, ended(T0), 'sb', 'punch_list_closeout', T0 + PRACTICE_GRACE_MS - 1) && !compose(false, ended(T0), 'sb', 'punch_list_closeout', T0 + PRACTICE_GRACE_MS));
  ok('idle: closed', !compose(false, idle, 'sb', 'punch_list_closeout', T0));
  ok('a user who owns the feature is never narrowed by the pass', compose(true, idle, 'real', 'punch_list_closeout', T0));
}

// ── integration review round 1 ──────────────────────────────────────────────
{
  // No sample plan: the pin steps auto-skip, so the photo must not open the
  // "Add your floor plan" screen (its planPin layer hid the coach).
  ok('punch-walk: a live run on this sample with no sample plan marks the no-plan screen seen',
    /const selectNoSamplePlanSandbox = \(s: RunState\): string \| null =>\s*s\.status === 'running' && s\.flags\?\.samplePlan === false \? s\.sandboxProjectId : null;/.test(WALK)
      && /if \(noSamplePlanSandbox && noSamplePlanSandbox === projectId\) setDismissedNoPlan\(true\);/.test(WALK));
  // punch.back: an exact-size wrapper clipped the button's hitSlop on iOS
  // (Fabric returns nil outside a parent's bounds).
  ok('punch-walk: the back wrapper keeps the hit area (margin -8 / padding 8)',
    /<TutorialTarget id="punch\.back" style=\{styles\.backTarget\}>/.test(WALK) && /backTarget: \{ margin: -8, padding: 8 \}/.test(WALK));
  const VR = strip(read('components/VoiceRecorder.tsx'));
  ok('VoiceRecorder: the capture sheet has its blocker sentinel', /\{modalOpen \? <TutorialTarget id="voice\.modalUp" \/> : null\}\s*<VoiceCaptureModal/.test(VR));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
