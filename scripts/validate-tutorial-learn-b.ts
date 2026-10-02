// validate-tutorial-learn-b.ts — lane B's three AI tutorials are honest, and
// the practice pass that opens their AI screens can never buy a free AI call.
//
// THE RISK THIS FILE EXISTS FOR (plan critic C2). The practice pass opens AI
// gates on the SAMPLE job while a tutorial runs: the takeoff's estimate step
// (ai_estimate_wizard), the plan room and Ask your plans (plan_markup,
// ask_your_plans), and Construction AI's tab and Ask mode (ai_code_check,
// construction_answer). A gate opened with no guard behind it is free AI for a
// Free user. So:
//
//   1. GUARDS (source scan). Every AI call site on those screens — the takeoff
//      upload + analysis, its retry, its spec-book read, the AI-priced estimate
//      hand-off, Ask your plans' search and its Index run, Construction AI's
//      Ask, Code check, Roadmap, Plan review, the per-code drill-in and the
//      photo look — sits behind the tutorial lock (`if (<lock>) { … return; }`
//      BEFORE the call, inside the same handler), and each call happens
//      exactly where this file says, so a new call site cannot slip in
//      unguarded. Each lock is computed with tutorialAiLock() on the SAME job
//      the practice pass is keyed to.
//      PLANTED MUTATIONS (in memory, every run): each site with its guard
//      removed must be reported. On disk (proof in the lane report): delete
//      the `if (tutorialLock) {` guard line in AskConstructionMode runAsk, or
//      the `if (sampleRun) {` line in takeoff handlePick → red.
//   2. PASS SCOPE. For each lane-B def, practiceFeatures() opens exactly the
//      def's features on the sandbox and NOTHING on any other job; the
//      Construction AI def lists both gates (C1).
//   3. FIXTURES. Executed, not grepped: the takeoff counts are A-101's rooms,
//      prices come only from the cost book handed in ("No price yet"
//      otherwise, never invented), the estimate merge foots to the cent and
//      is idempotent on a replay, the plan answer is derived from the plan,
//      and the job answer is computed from the sample's records (tied to the
//      seed's own numbers) — with no code, safety or trade words anywhere.
//   4. COPY. Titles / endsWith / seconds, and the blocked reasons, exactly as
//      the spec says, as LITERAL t() English on the screens.
//
// Pure node:fs + direct imports of the pure modules (no react-native).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  NO_PRICE_YET,
  SAMPLE_JOB_QUESTION,
  SAMPLE_PLAN_QUESTION,
  SAMPLE_QUESTION_BLOCKED,
  SAMPLE_TAKEOFF_KINDS,
  SAMPLE_TAKEOFF_LINE_ID_HEAD,
  SAMPLE_TAKEOFF_RESULT,
  SAMPLE_UPLOAD_BLOCKED,
  formatCents,
  isSampleQuestion,
  mergeSampleTakeoffIntoEstimate,
  normalizeSampleQuestion,
  priceSampleTakeoff,
  sampleJobAnswer,
  samplePlanAnswer,
  sampleTakeoffAsResult,
  sampleTakeoffCostItems,
  sampleTakeoffItemsAfterEdits,
  sampleTakeoffRowKey,
  toCents,
  tutorialAiLock,
} from '../utils/tutorial/learn/fixturesB';
import { SAMPLE_ESTIMATE_TOTAL, SAMPLE_NO_CREDITS_LABEL, SAMPLE_PLAN, sampleLinkedEstimate } from '../utils/tutorial/fixtures';
import { LANE_B_DEFS, LANE_B_SIGNALS, LANE_B_TARGETS } from '../utils/tutorial/learn/laneB';
import { PRACTICE_FEATURES_ALLOWED, practiceFeatures } from '../utils/tutorial/practicePass';
import { TUTORIAL_DEFS } from '../utils/tutorial/defs';
import { takeoffRowKey } from '../utils/takeoffPricing';
import { round2 } from '../utils/estimateMarkup';
import type { CostBookEntry } from '../utils/costDatabase';
import type { RunState, TutorialDefs } from '../utils/tutorial/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
// Block comments and whole-line // comments (a guard in a comment never counts).
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// ── 1. guards ───────────────────────────────────────────────────────────────

const TAKEOFF = 'app/takeoff.tsx';
const PANEL = 'components/plans/AskPlansPanel.tsx';
const PLANS = 'app/plans.tsx';
const ASK = 'components/construction/AskConstructionMode.tsx';
const CAI = 'app/(tabs)/construction-ai/index.tsx';

interface Site {
  file: string;
  /** The handler: `const <fn> = useCallback(`. */
  fn: string;
  /** The lock identifier the guard tests. */
  lock: string;
  /** The AI call (or the hand-off to an AI screen) it must stand in front of. */
  call: RegExp;
}

const SITES: Site[] = [
  { file: TAKEOFF, fn: 'handlePick', lock: 'sampleRun', call: /checkAILimit\(/ },
  { file: TAKEOFF, fn: 'handlePick', lock: 'sampleRun', call: /uploadAndRenderPdf\(/ },
  { file: TAKEOFF, fn: 'handlePick', lock: 'sampleRun', call: /analyzePages\(/ },
  { file: TAKEOFF, fn: 'handleRetryAnalysis', lock: 'sampleRun', call: /analyzePages\(/ },
  { file: TAKEOFF, fn: 'handleMatchSpecs', lock: 'sampleRun', call: /analyzeSpecBook\(/ },
  { file: TAKEOFF, fn: 'handleConvertToEstimate', lock: 'sampleRun', call: /pathname:\s*'\/takeoff-estimate'/ },
  { file: PANEL, fn: 'handleAsk', lock: 'tutorialLock', call: /askPlans\(/ },
  { file: PANEL, fn: 'handleIndex', lock: 'tutorialLock', call: /indexPlanSheets\(/ },
  { file: ASK, fn: 'runAsk', lock: 'tutorialLock', call: /askConstruction\(/ },
  { file: CAI, fn: 'runCheck', lock: 'tutorialLock', call: /mageAISmart\(/ },
  { file: CAI, fn: 'runGenerateRoadmap', lock: 'tutorialLock', call: /generateRoadmap\(/ },
  { file: CAI, fn: 'runPlanReview', lock: 'tutorialLock', call: /reviewPlanCode\(/ },
  { file: CAI, fn: 'loadDetail', lock: 'aiLocked', call: /mageAISmart\(/ },
  { file: CAI, fn: 'checkAPhoto', lock: 'tutorialLock', call: /setPhotoLookUri\(/ },
];

/** The handler's body: from `const fn = useCallback(` to its `}, [` deps. */
function handlerBody(src: string, fn: string): string | null {
  const m = new RegExp(`const ${fn} = useCallback\\(`).exec(src);
  if (!m) return null;
  const rest = src.slice(m.index);
  const end = rest.search(/\n\s*\},\s*\[/);
  return end < 0 ? null : rest.slice(0, end);
}

/** null when the site is guarded; otherwise why not. */
function siteProblem(src: string, site: Site): string | null {
  const body = handlerBody(src, site.fn);
  if (body === null) return `${site.file}: no \`const ${site.fn} = useCallback(\``;
  const call = site.call.exec(body);
  if (!call) return `${site.file} ${site.fn}: no ${site.call} in it (the call moved — guard it where it went)`;
  const guard = new RegExp(`if \\(${site.lock}\\) \\{[\\s\\S]*?\\breturn\\b`).exec(body);
  if (!guard) return `${site.file} ${site.fn}: no \`if (${site.lock}) { … return }\` guard`;
  if (guard.index > call.index) return `${site.file} ${site.fn}: the ${site.lock} guard comes AFTER ${site.call}`;
  return null;
}

console.log('learn lane B — AI guards (source scan)');
const SRC: Record<string, string> = {};
for (const f of [TAKEOFF, PANEL, PLANS, ASK, CAI]) SRC[f] = strip(read(f));

for (const site of SITES) {
  const p = siteProblem(SRC[site.file], site);
  ok(`${site.file.split('/').pop()} ${site.fn}: ${site.lock} guard before ${site.call.source}`, p === null, p ?? '');
}

// Planted mutations, every run: each site with its guard gone must be caught.
{
  const missed: string[] = [];
  for (const site of SITES) {
    const mutated = SRC[site.file].replace(new RegExp(`if \\(${site.lock}\\) \\{`, 'g'), 'if (false) {');
    if (siteProblem(mutated, site) === null) missed.push(`${site.file} ${site.fn}`);
  }
  ok('planted: every site with its guard removed is reported', missed.length === 0, missed.join(', '));
}

/** Every call of `re` in `src` lies inside one of the named handlers. */
function callsOnlyIn(src: string, re: RegExp, fns: string[], expected: number): string | null {
  const all = src.match(new RegExp(re.source, 'g')) ?? [];
  const inside = fns.reduce((n, fn) => n + ((handlerBody(src, fn) ?? '').match(new RegExp(re.source, 'g')) ?? []).length, 0);
  if (all.length !== expected) return `${all.length} calls of ${re.source}, expected ${expected}`;
  if (inside !== expected) return `${expected - inside} call(s) of ${re.source} outside ${fns.join(' / ')}`;
  return null;
}
{
  const t = SRC[TAKEOFF];
  const checks: [string, string | null][] = [
    ['takeoff: analyzeTakeoff only inside analyzePages', callsOnlyIn(t, /analyzeTakeoff\(\{/, ['analyzePages'], 1)],
    ['takeoff: analyzePages only from handlePick / handleRetryAnalysis', callsOnlyIn(t, /await analyzePages\(/, ['handlePick', 'handleRetryAnalysis'], 2)],
    ['takeoff: uploadAndRenderPdf only in handlePick / handleMatchSpecs', callsOnlyIn(t, /uploadAndRenderPdf\(\{/, ['handlePick', 'handleMatchSpecs'], 2)],
    ['takeoff: analyzeSpecBook only in handleMatchSpecs', callsOnlyIn(t, /analyzeSpecBook\(\{/, ['handleMatchSpecs'], 1)],
    ['takeoff: /takeoff-estimate only from handleConvertToEstimate', callsOnlyIn(t, /pathname:\s*'\/takeoff-estimate'/, ['handleConvertToEstimate'], 1)],
    ['Ask your plans: askPlans() only in handleAsk', callsOnlyIn(SRC[PANEL], /await askPlans\(/, ['handleAsk'], 1)],
    ['Ask your plans: indexPlanSheets() only in handleIndex', callsOnlyIn(SRC[PANEL], /await indexPlanSheets\(/, ['handleIndex'], 1)],
    ['Construction AI Ask: askConstruction() only in runAsk', callsOnlyIn(SRC[ASK], /await askConstruction\(/, ['runAsk'], 1)],
    ['Construction AI: mageAISmart only in runCheck / loadDetail', callsOnlyIn(SRC[CAI], /await mageAISmart\(/, ['runCheck', 'loadDetail'], 2)],
    ['Construction AI: generateRoadmap only in runGenerateRoadmap', callsOnlyIn(SRC[CAI], /await generateRoadmap\(/, ['runGenerateRoadmap'], 1)],
    ['Construction AI: reviewPlanCode only in runPlanReview', callsOnlyIn(SRC[CAI], /await reviewPlanCode\(/, ['runPlanReview'], 1)],
    ['Construction AI: the photo look opens only from checkAPhoto', callsOnlyIn(SRC[CAI], /setPhotoLookUri\(res/, ['checkAPhoto'], 1)],
  ];
  for (const [name, p] of checks) ok(name, p === null, p ?? '');
  // Index re-embed spends embeddings only after an Index run, which is guarded;
  // the drill-in modal gets the tab's lock.
  ok('Ask your plans: the free manifest read is skipped under the lock (nothing leaves the sample)',
    /if \(tutorialLock\) \{ setChangedCount\(null\); return; \}\s*void readPlanIndexManifest\(/.test(SRC[PANEL]));
  ok('Construction AI: ResultModal is handed the lock (aiLocked={tutorialLock})', /aiLocked=\{tutorialLock\}/.test(SRC[CAI]));
  // Under the lock the tab is Ask mode ONLY: the other three modes would let
  // the pass open a Pro editor on any job's saved roadmap / review.
  ok('Construction AI: under the lock the Code check / Roadmap / Plan review toggles refuse, and the tab is held on Ask',
    ['code', 'roadmap', 'plan'].every(m => new RegExp(`onPress=\\{\\(\\) => \\(tutorialLock \\? tutorialBlockedAlert\\(\\) : setMode\\('${m}'\\)\\)\\}`).test(SRC[CAI]))
      && /if \(tutorialLock && mode !== 'ask'\) setMode\('ask'\);/.test(SRC[CAI]));
  ok('Construction AI: Ask mode is handed the tab lock (tutorialSampleId={tutorialLock ? …})', /tutorialSampleId=\{tutorialLock \? entryProjectId \?\? null : null\}/.test(SRC[CAI]));
}

// Each lock is computed on the SAME job the practice pass is keyed to.
{
  const locks: [string, string, RegExp, RegExp][] = [
    [TAKEOFF, 'takeoff (the picked job)', /const practice = useTutorialPractice\(pickedProjectId\)/, /const sampleRun = tutorialAiLock\(pickedProjectId, tutorialSandboxId, practice\.size\)/],
    [PANEL, 'Ask your plans (the panel job)', /const practice = useTutorialPractice\(projectId\)/, /const tutorialLock = tutorialAiLock\(projectId, tutorialSandboxId, practice\.size\)/],
    [ASK, 'Construction AI Ask (the linked job, or the tab lock)', /const practice = useTutorialPractice\(projectId \?\? tutorialSampleId\)/, /const tutorialLock = !!tutorialSampleId \|\| tutorialAiLock\(projectId, tutorialSandboxId, practice\.size\)/],
    [CAI, 'Construction AI tab (the URL job)', /const entryPractice = useTutorialPractice\(entryProjectId\)/, /const tutorialLock = tutorialAiLock\(entryProjectId, tutorialSandboxId, entryPractice\.size\)/],
  ];
  for (const [f, name, pr, lk] of locks) ok(`${name}: pass and lock keyed to one job`, pr.test(SRC[f]) && lk.test(SRC[f]));
  // M7: the pass is OR'd into each gate the defs' practiceFeatures cover.
  const gates: [string, string, RegExp][] = [
    [TAKEOFF, 'ai_estimate_wizard', /ownCanConvertToEstimate \|\| practice\.has\('ai_estimate_wizard'\)/],
    // plans.tsx keeps validate-plans-access-ask-core's pinned contract
    // (`const planAccess = canAccess('plan_markup');`, `if (!planAccess) {
    // return gate === 'locked'`); the pass opens the room inside that branch.
    [PLANS, 'plan_markup', /const planPractice = practice\.has\('plan_markup'\);[\s\S]*?return gate === 'locked'\n\s+\? \(planPractice \? room : <PaywallView/],
    [PANEL, 'ask_your_plans', /!canAccess\('ask_your_plans'\) && !practice\.has\('ask_your_plans'\)/],
    [CAI, 'ai_code_check', /!canAccess\('ai_code_check'\) && !practice\.has\('ai_code_check'\)/],
    [ASK, 'construction_answer', /canAccess\('construction_answer'\) \|\| practice\.has\('construction_answer'\)/],
  ];
  for (const [f, feat, re] of gates) ok(`${f.split('/').pop()}: the practice pass is OR'd into the ${feat} gate`, re.test(SRC[f]));
  ok('plans: the pass is keyed to the screen job', /const practice = useTutorialPractice\(projectId\)/.test(SRC[PLANS]));
  ok("Construction AI tab gate: the pass is keyed to the URL's job", /useTutorialPractice\(typeof tabParams\.projectId === 'string' \? tabParams\.projectId : undefined\)/.test(SRC[CAI]));
}

// The lock rule itself.
ok('tutorialAiLock: live run on this job, or the pass open on it — nothing else',
  tutorialAiLock('S', 'S', 0) && tutorialAiLock('S', null, 1) && !tutorialAiLock('R', 'S', 0) && !tutorialAiLock(null, 'S', 3) && !tutorialAiLock('S', null, 0));

// ── 2. practice-pass scope ──────────────────────────────────────────────────

console.log('practice pass scope');
{
  const defs = TUTORIAL_DEFS as TutorialDefs;
  const ids = LANE_B_DEFS.map(d => d.id);
  ok('lane B ships the three tutorials', JSON.stringify(ids) === JSON.stringify(['takeoff-to-estimate', 'ask-your-plans', 'construction-ai-ask']), ids.join(', '));
  for (const def of LANE_B_DEFS) {
    const run = {
      status: 'running', tutorialId: def.id, version: def.version, sandboxProjectId: 'SANDBOX', entry: 'hub', phase: 'step',
      stepIndex: 0, stepEnteredAt: 0, startedAt: 0, paused: false, targetMissing: false, stuck: false, skipped: [], assists: [],
      payloads: {}, signalAt: {}, flags: { samplePlan: true, mic: false }, route: null, mounted: [], log: [],
    } as unknown as RunState;
    const onSample = practiceFeatures(run, 'SANDBOX', 1, defs);
    const onReal = practiceFeatures(run, 'REAL-JOB', 1, defs);
    ok(`${def.id}: the pass opens exactly ${def.practiceFeatures.join(' + ')} on the sample`, JSON.stringify(onSample) === JSON.stringify([...def.practiceFeatures]) && def.practiceFeatures.every(f => PRACTICE_FEATURES_ALLOWED.includes(f)), JSON.stringify(onSample));
    ok(`${def.id}: the pass opens NOTHING on a real job`, onReal.length === 0, JSON.stringify(onReal));
  }
  const cai = LANE_B_DEFS.find(d => d.id === 'construction-ai-ask');
  ok('construction-ai-ask lists BOTH gates: ai_code_check (tab) and construction_answer (Ask mode)', !!cai && cai.practiceFeatures.includes('ai_code_check') && cai.practiceFeatures.includes('construction_answer'));
  ok('ask-your-plans lists plan_markup (plan room) and ask_your_plans (Ask box)', JSON.stringify(LANE_B_DEFS.find(d => d.id === 'ask-your-plans')?.practiceFeatures) === JSON.stringify(['plan_markup', 'ask_your_plans']));
  ok('takeoff-to-estimate lists ai_estimate_wizard', JSON.stringify(LANE_B_DEFS.find(d => d.id === 'takeoff-to-estimate')?.practiceFeatures) === JSON.stringify(['ai_estimate_wizard']));
  ok('no lane-B signal is outbound', Object.values(LANE_B_SIGNALS).every(s => s.outbound === false));
  ok('every lane-B target lives in one of the five owned screens', Object.values(LANE_B_TARGETS).every(t => [TAKEOFF, PLANS, PANEL, ASK, CAI].includes(t.file)));
}

// ── 3. fixtures ─────────────────────────────────────────────────────────────

console.log('fixtures — takeoff');
const FORBIDDEN = /\b(code|codes|coded|osha|safety|safe|permit|permits|egress|span|spans|licen[cs]e|inspect\w*|violation\w*|hazard\w*|fire)\b/i;
{
  const items = SAMPLE_TAKEOFF_RESULT.items;
  const rooms = Object.keys(SAMPLE_PLAN.rooms);
  ok('takeoff: every count is in a room labelled on A-101', items.every(i => rooms.includes(i.room)) && SAMPLE_TAKEOFF_RESULT.sheetNumber === SAMPLE_PLAN.sheetNumber);
  ok('takeoff: whole, positive counts; unique keys', items.every(i => Number.isInteger(i.quantity) && i.quantity > 0) && new Set(items.map(i => i.key)).size === items.length);
  const seed = read('utils/demoSeed.ts');
  const smallSf = Number(/small:\s*\{[\s\S]*?squareFootage:\s*([\d_]+)/.exec(seed)?.[1]?.replace(/_/g, ''));
  const netSf = items.filter(i => i.kind === 'flooring').reduce((s, i) => s + i.quantity, 0);
  ok(`takeoff: net floor area (${netSf} SF) is under the sample's gross (${smallSf} SF)`, smallSf > 0 && netSf < smallSf);
  ok('takeoff: row keys spell utils/takeoffPricing takeoffRowKey', items.every(i => sampleTakeoffRowKey(i) === takeoffRowKey(SAMPLE_TAKEOFF_KINDS[i.kind].section, i.key)));
  const r = sampleTakeoffAsResult();
  ok('takeoff result: every count lands in the real review shape, nothing added',
    r.floorAreas.length === items.filter(i => i.kind === 'flooring').length && r.fixtures.length === items.filter(i => i.kind !== 'flooring').length
      && r.walls.length + r.doors.length + r.windows.length + r.finishes.length + r.bulkMaterials.length === 0
      && r.floorAreas.every(f => items.some(i => i.key === f.id && i.quantity === f.areaSqFt)) && r.fixtures.every(f => items.some(i => i.key === f.id && i.quantity === f.count)));
  ok('takeoff result: says no AI read it, claims no pages and no scale', /no AI read this sheet/.test(r.summary) && r.drawingsSeen.length === 0 && r.scale.num === 0 && r.confidenceExplanation.includes(SAMPLE_NO_CREDITS_LABEL));

  const none = priceSampleTakeoff([]);
  ok('pricing: an empty cost book prices NOTHING (No price yet, never invented)', none.pricedCount === 0 && none.totalCents === 0 && none.lines.every(l => l.unitCents === null && l.lineCents === null));
  const entry = (trade: string, unit: string, rate: number, jobCount = 2): CostBookEntry => ({ key: `${trade}|${unit}`, trade, unit, suggestedRate: rate, jobCount, sampleCount: jobCount, confidence: 'medium', variability: 0 } as unknown as CostBookEntry);
  const book = [entry('Flooring', 'SF', 4.255), entry('Electrical', 'EA', 85.5), entry('Kitchen cabinets', 'EA', 410)];
  const priced = priceSampleTakeoff(book);
  const kitchenFloor = priced.lines.find(l => l.key === 'flooring-kitchen');
  const kitchenOutlets = priced.lines.find(l => l.key === 'outlets-kitchen');
  const plumbing = priced.lines.filter(l => l.kind === 'plumbing');
  ok('pricing: his Flooring $/SF prices the floor lines to the cent (4.255 → 426¢ × 150 SF)', kitchenFloor?.unitCents === 426 && kitchenFloor.lineCents === 63_900 && kitchenFloor.trade === 'Flooring');
  ok('pricing: the room never borrows a rate (Kitchen outlets price as Electrical, not Kitchen cabinets)', kitchenOutlets?.unitCents === 8550 && kitchenOutlets.trade === 'Electrical');
  ok('pricing: no Plumbing rate in his book → every plumbing line says No price yet', plumbing.length === 3 && plumbing.every(l => l.unitCents === null));
  ok('pricing: totals are the priced lines, in integer cents', priced.totalCents === priced.lines.reduce((s, l) => s + (l.lineCents ?? 0), 0) && Number.isInteger(priced.totalCents) && priced.pricedCount === 12);
  const edited = sampleTakeoffItemsAfterEdits({ 'floor:flooring-kitchen': 160 }, { 'fixture:plumbing-kitchen': true });
  ok('pricing: his edits convert — a rejected row drops, an edited count replaces', edited.length === items.length - 1 && edited.find(i => i.key === 'flooring-kitchen')?.quantity === 160 && !edited.some(i => i.key === 'plumbing-kitchen'));

  const costItems = sampleTakeoffCostItems(priced);
  ok('estimate lines: one per counted line, ids sample-takeoff-*, unpriced at $0 named No price yet',
    costItems.length === items.length && costItems.every(c => c.materialId.startsWith(SAMPLE_TAKEOFF_LINE_ID_HEAD))
      && costItems.filter(c => c.supplier === NO_PRICE_YET).every(c => c.unitPrice === 0 && c.lineTotal === 0)
      && costItems.filter(c => c.supplier === NO_PRICE_YET).length === 3);
  ok('estimate lines: at cost, lineTotal = qty × unit on the cent grid', costItems.every(c => c.markup === 0 && c.lineTotal === round2(c.quantity * c.unitPrice)));

  const fresh = mergeSampleTakeoffIntoEstimate(null, costItems, 'E1', '2026-10-01T00:00:00Z');
  ok('merge: no estimate → a new one that foots (Σ lineTotal = grandTotal)', round2(fresh.next.items.reduce((s, i) => s + i.lineTotal, 0)) === fresh.next.grandTotal && fresh.addedSellCents === toCents(fresh.next.grandTotal));
  const seeded = sampleLinkedEstimate('E0', '2026-09-01T00:00:00Z');
  const once = mergeSampleTakeoffIntoEstimate(seeded, costItems, 'X', 'x');
  ok('merge: lines are ADDED — the 8 seeded lines stay (never a replace)', once.next.items.length === 8 + costItems.length && seeded.items.every(s => once.next.items.some(i => i.materialId === s.materialId && i.lineTotal === s.lineTotal)) && once.next.id === 'E0');
  ok('merge: totals move by the added sell, to the cent', toCents(once.next.grandTotal) === toCents(SAMPLE_ESTIMATE_TOTAL) + once.addedSellCents && round2(once.next.baseTotal + once.next.markupTotal) === once.next.grandTotal);
  ok('merge: added at the estimate\'s own 25 % ratio', once.next.items.filter(i => i.materialId.startsWith(SAMPLE_TAKEOFF_LINE_ID_HEAD) && i.unitPrice > 0).every(i => Math.abs(i.markup - 25) < 1e-9));
  const twice = mergeSampleTakeoffIntoEstimate(once.next, costItems, 'X', 'x');
  ok('merge: a replay replaces its own lines — no second copy, same totals', twice.next.items.length === once.next.items.length && twice.next.grandTotal === once.next.grandTotal && twice.next.baseTotal === once.next.baseTotal && twice.next.markupTotal === once.next.markupTotal);
}

console.log('fixtures — plan answer');
{
  const a = samplePlanAnswer(SAMPLE_PLAN);
  const rooms = Object.keys(SAMPLE_PLAN.rooms);
  ok('plan answer: names every room on A-101 and the count', rooms.every(r => a.answer.includes(r)) && a.answer.includes(`${rooms.length} rooms`) && a.answer.includes(SAMPLE_PLAN.sheetNumber));
  ok('plan answer: every citation is sheet A-101', a.citations.length === 1 && a.citations[0].ref === SAMPLE_PLAN.sheetNumber && a.question === SAMPLE_PLAN_QUESTION && SAMPLE_PLAN_QUESTION.includes(SAMPLE_PLAN.sheetNumber));
  const other = samplePlanAnswer({ sheetNumber: 'B-202', rooms: { Garage: 1, Mudroom: 1 } });
  ok('plan answer: derived from the plan, not written out (another plan, another answer)', other.answer === 'Sheet B-202 labels 2 rooms: Garage and Mudroom.' && other.citations[0].ref === 'B-202');
}

console.log('fixtures — job answer');
{
  const seed = read('utils/demoSeed.ts');
  const smallBlock = /async function seedSmall[\s\S]*?\n}\n/.exec(seed)?.[0] ?? '';
  const invs = [...smallBlock.matchAll(/\{ number: (\d+), pct: \d+, daysAgoIssue: -?\d+, daysAgoDue: -?\d+, amount: ([\d_]+), paid: ([\d_]+), status: '(\w+)'/g)]
    .map(m => ({ number: Number(m[1]), amount: Number(m[2].replace(/_/g, '')), status: m[4] }));
  const coDelta = Number(/newContractTotal: meta\.total \+ ([\d_]+)/.exec(smallBlock)?.[1]?.replace(/_/g, ''));
  ok('the seed still carries the records the answer reads (2 invoices, 1 approved CO)', invs.length === 2 && coDelta > 0 && /status: 'approved'/.test(smallBlock), JSON.stringify({ invs, coDelta }));
  const project = { id: 'S', name: "Sample — Sarah's Place", linkedEstimate: sampleLinkedEstimate('E', 'x') };
  const invoices = invs.map(i => ({ projectId: 'S', number: i.number, status: i.status as 'paid', subtotal: i.amount }));
  const cos = [{ projectId: 'S', number: 1, status: 'approved' as const, changeAmount: coDelta }];
  const a = sampleJobAnswer(project, invoices, cos);
  const expectLeft = (SAMPLE_ESTIMATE_TOTAL + coDelta - invs.reduce((s, i) => s + i.amount, 0)) * 100;
  ok(`job answer: left to bill = estimate + approved COs − billed, in cents (${formatCents(expectLeft)})`, a.leftCents === expectLeft && Number.isInteger(a.leftCents) && a.answer.startsWith(`${formatCents(expectLeft)} is left to bill.`));
  ok('job answer: cites the estimate, the CO and each invoice; consulted nothing it left out', a.citations.length === 4 && a.consulted.length === 0 && a.citations.every(c => /^(Estimate|Change order #\d+|Invoice #\d+) · \$/.test(c.label)));
  ok('job answer: honest — no AI, a sample label, verified from records', a.usedAI === false && a.disclaimer.startsWith(SAMPLE_NO_CREDITS_LABEL) && a.verified === true);
  const plus = sampleJobAnswer(project, [...invoices, { projectId: 'S', number: 3, status: 'draft' as const, subtotal: 1000 }, { projectId: 'OTHER', number: 9, status: 'sent' as const, subtotal: 99_999 }], [...cos, { projectId: 'S', number: 2, status: 'submitted' as const, changeAmount: 5000 }]);
  ok('job answer: a draft invoice and an unapproved CO are read but left out (listed as consulted); another job is ignored', plus.leftCents === a.leftCents && plus.consulted.length === 2 && plus.citations.length === 4);
  const changed = sampleJobAnswer(project, [{ ...invoices[0], subtotal: invoices[0].subtotal + 100 }, invoices[1]], cos);
  ok('job answer: computed, not written out (a different invoice moves the number)', changed.leftCents === a.leftCents - 10_000 && changed.answer !== a.answer);
  const empty = sampleJobAnswer({ id: 'S', name: 'x' }, [], []);
  ok('job answer: no estimate → says so, invents no contract', empty.contractCents === 0 && /no estimate/.test(empty.answer));
  const words = [SAMPLE_JOB_QUESTION, SAMPLE_PLAN_QUESTION, a.answer, samplePlanAnswer().answer, ...a.citations.map(c => c.label), ...SAMPLE_TAKEOFF_RESULT.items.map(i => `${SAMPLE_TAKEOFF_KINDS[i.kind].label} ${i.room}`)];
  const bad = words.filter(w => FORBIDDEN.test(w));
  ok('no code, safety or trade-rule words in any sample question or answer (app skills only)', bad.length === 0, bad.join(' | '));
}

console.log('fixtures — questions');
ok('a question matches only word for word (curly quotes and case aside)',
  isSampleQuestion('what’s left to bill on this job', SAMPLE_JOB_QUESTION) && isSampleQuestion('  WHICH rooms are on sheet A-101 ', SAMPLE_PLAN_QUESTION)
    && !isSampleQuestion("What's left to bill on the Henderson job?", SAMPLE_JOB_QUESTION) && !isSampleQuestion('', SAMPLE_JOB_QUESTION)
    && normalizeSampleQuestion('A—B') === 'a b');
ok('formatCents: whole dollars drop the cents, others keep two', formatCents(27_840_000) === '$278,400' && formatCents(123_456) === '$1,234.56' && formatCents(-500) === '-$5');

// ── 4. copy ─────────────────────────────────────────────────────────────────

console.log('copy');
{
  const want: Record<string, [string, string, number]> = {
    'takeoff-to-estimate': ['Count a plan and price it', 'Counts from sheet A-101 turned into estimate lines', 45],
    'ask-your-plans': ['Ask your plans a question', 'An answer that cites the sheet it came from', 35],
    'construction-ai-ask': ['Ask Construction AI about your job', "An answer built from the job's own records", 35],
  };
  for (const def of LANE_B_DEFS) {
    const w = want[def.id];
    ok(`${def.id}: title / endsWith / seconds exactly as specced`, !!w && def.title === w[0] && def.endsWith === w[1] && def.seconds === w[2], `${def.title} | ${def.endsWith} | ${def.seconds}`);
  }
  ok('blocked reasons are the spec\'s words', SAMPLE_QUESTION_BLOCKED === 'On the sample, use the sample question. Your own questions run on a real job.' && SAMPLE_UPLOAD_BLOCKED === 'On the sample, use the sample plan. Upload your own plans on a real job.' && NO_PRICE_YET === 'No price yet');
  const lit = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const qLit = new RegExp(`t\\('common\\.tutorial\\.sampleQuestionBlocked', '${lit(SAMPLE_QUESTION_BLOCKED)}'\\)`);
  const uLit = new RegExp(`t\\('common\\.tutorial\\.takeoffUploadBlocked', '${lit(SAMPLE_UPLOAD_BLOCKED)}'\\)`);
  ok('the question refusal is a literal t() on Ask your plans, Construction AI Ask and the tab', [PANEL, ASK, CAI].every(f => qLit.test(SRC[f])));
  ok('the upload refusal is a literal t() on the takeoff', uLit.test(SRC[TAKEOFF]));
  ok("'No price yet' is a literal t() on the takeoff's sample lines", /t\('common\.tutorial\.takeoffNoPriceYet', 'No price yet'\)/.test(SRC[TAKEOFF]));
  ok('every fixture chip shows SAMPLE_NO_CREDITS_LABEL', [TAKEOFF, PANEL, ASK].every(f => /\{SAMPLE_NO_CREDITS_LABEL\}/.test(SRC[f])));
  // Golden-neutral: every wrapper renders only during the run on that job.
  const unguarded: string[] = [];
  for (const f of [TAKEOFF, PLANS, PANEL, ASK, CAI]) {
    for (const m of SRC[f].matchAll(/<TutorialTarget\b[^>]*\bid="([^"]+)"/g)) {
      const before = SRC[f].slice(Math.max(0, m.index - 1200), m.index);
      if (!/tutorialOn/.test(before)) unguarded.push(`${f}: ${m[1]}`);
    }
  }
  ok('every lane-B wrapper renders only while tutorialOn (phone goldens unchanged)', unguarded.length === 0, unguarded.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
