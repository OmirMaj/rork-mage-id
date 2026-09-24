// validate-tutorial-defs.ts — every tutorial def is well-formed, honest, not
// a slideshow, and points at controls that really exist.
//
// Three layers, in the order they fail:
//
//   1. STRUCTURE — unique ids; every target / signal / assist / layer a def
//      names is in utils/tutorial/registry; do and wait steps wait on a REAL
//      success point (`until`) and look steps don't; a step's layer matches
//      its target's; checkpoints are route-entry steps; no step waits on an
//      outbound or failure signal; practiceFeatures stay inside the four the
//      founder's practice pass may open; every route exists under app/.
//
//   2. ANTI-SLIDESHOW + COPY — at least one do step, never more than two look
//      steps in a row, and the last step is a look at where the result landed
//      (the thing the old 1,012-line components/Tutorial.tsx never did). Copy
//      is ≤ 60 / ≤ 110 chars after filling, under every context (web, iPhone,
//      Free, paid, with and without payloads); never hard-codes Tap / Click /
//      Swipe (use {tap}/{Tap}); no emoji; no 'undefined' / 'NaN' leaking from a
//      missing payload; the stat's extras invent nothing from empty payloads;
//      paywall copy names the tier featureTiers actually requires.
//
//   3. SOURCE SCAN (default mode) — reads the declared files and requires
//      <TutorialTarget id="…"> for every target, tutorialSignal('…') for every
//      signal, useTutorialAssist('…') for every assist and
//      <TutorialLayer host="…"/> for every modal layer a def uses. A renamed
//      button fails the build instead of stranding a user on step 3.
//      Documents lie; code doesn't.
//
// `--structure-only` runs layers 1-2 (plus fixtures and purity) and skips the
// source scan. It exists because the engine core lands before the screen
// lanes wrap their controls; the DEFAULT is the full scan, and that is what
// ship-check must run once the screens are in.
//
// Pure node:fs + direct imports of the pure engine modules (no react-native —
// that crashes bun). fileURLToPath + join because the repo path has a space.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TUTORIAL_DEFS, TUTORIAL_DEF_LIST, TUTORIAL_ORDER, SANDBOX_PROJECT_NAME } from '../utils/tutorial/defs';
import { ASSISTS, BLOCKER_TARGETS, DYNAMIC_TARGET_FAMILIES, LAYERS, SIGNALS, TARGETS, isBlockerTarget, targetSpec } from '../utils/tutorial/registry';
import { fillCopy, targetChain } from '../utils/tutorial/machine';
import { PRACTICE_FEATURES_ALLOWED } from '../utils/tutorial/practicePass';
import { statLine } from '../utils/tutorial/stats';
import {
  DFR_SAMPLE_NOTE,
  PUNCH_SAMPLE,
  SAMPLE_ESTIMATE_LINES,
  SAMPLE_ESTIMATE_TOTAL,
  SAMPLE_PLAN,
  SAMPLE_PROGRESS_PCT,
  SCHEDULE_SAMPLE,
  sampleLinkedEstimate,
} from '../utils/tutorial/fixtures';
import { inferTradeFromText } from '../utils/tradeInference';
import { SAMPLE_PROJECT_PREFIX } from '../utils/projectCap';
import { REQUIRED_TIER } from '../utils/featureTiers';
import type { Copy, CopyCtx, PayloadRecord, TutorialDef, TutorialStep } from '../utils/tutorial/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRUCTURE_ONLY = process.argv.includes('--structure-only');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
/** Collect-then-report: one line per rule, listing every offender. */
function rule(name: string, problems: string[]) {
  ok(name, problems.length === 0, problems.slice(0, 40).join('\n      '));
}

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
// Block comments and whole-line // comments. A `//` inside a string on a code
// line is left alone, so a URL can't eat the rest of its line.
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Same range as scripts/validate-app-slop.ts check 1.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const HARD_VERB = /\b(tap|taps|tapped|click|clicks|clicked|swipe|swipes|swiped)\b/i;
const LEAK = /\b(undefined|NaN|null)\b|\[object /;

// ── routes under app/ ───────────────────────────────────────────────────────

function walk(dir: string): string[] {
  const out: string[] = [];
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules') continue;
    const full = join(dir, n);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx|ts)$/.test(n)) out.push(full);
  }
  return out;
}

const APP_ROUTES = new Set<string>();
/** pathname → repo-relative screen file, for the blocker-sentinel rule. */
const ROUTE_FILE = new Map<string, string>();
for (const f of walk(join(ROOT, 'app'))) {
  const rel = relative(join(ROOT, 'app'), f).split(sep).join('/');
  const base = rel.split('/').pop() ?? '';
  if (base.startsWith('_') || base.startsWith('+')) continue;
  const segs = rel.replace(/\.(tsx|ts)$/, '').split('/').filter(s => !/^\(.*\)$/.test(s));
  if (segs[segs.length - 1] === 'index') segs.pop();
  APP_ROUTES.add('/' + segs.join('/'));
  ROUTE_FILE.set('/' + segs.join('/'), relative(ROOT, f).split(sep).join('/'));
}
const routeExists = (p: string) => APP_ROUTES.has(p);

// ── copy contexts ───────────────────────────────────────────────────────────

const FULL_PAYLOADS: PayloadRecord = {
  'dfr.voice.applied': { projectId: 's', fields: ['manpower', 'workPerformed', 'issuesAndDelays'], source: 'sample' },
  'dfr.saved': { projectId: 's', reportId: 'r', status: 'draft', date: '2026-09-23', crew: 12, offline: false },
  'punch.photo.added': { projectId: 's', source: 'sample' },
  'punch.pin.decided': { projectId: 's', pinned: true },
  'punch.description.filled': { projectId: 's', chars: 32 },
  // Long-but-plausible user values: the copy must still fit.
  'punch.saved': { projectId: 's', itemId: 'p', location: 'Primary Bath', trade: 'Electrical', pinned: true, sheet: 'A-101' },
  'invoice.amount.set': { projectId: 's', total: 1_234_567.89 },
  'invoice.sent': { projectId: 's', invoiceId: 'i', number: 1234, total: 1_234_567.89, to: 'estimating@riverbendbuild.com' },
};
const CTXS: CopyCtx[] = [];
for (const web of [false, true]) {
  for (const freeTier of [false, true]) {
    for (const payloads of [{}, FULL_PAYLOADS] as PayloadRecord[]) {
      for (const offline of [false, true]) {
        CTXS.push({ pointerFine: web, web, freeTier, payloads, offline, userEmail: 'estimating@riverbendbuild.com', reportDayLabel: web ? 'Wed Sep 30' : null });
      }
    }
  }
}

/** Every string a copy slot can produce, raw (tokens unresolved) and filled. */
function renders(c: Copy | undefined): { raw: string; filled: string }[] {
  if (c === undefined) return [];
  return CTXS.map(ctx => {
    const raw = typeof c === 'function' ? c(ctx) : c;
    return { raw, filled: fillCopy(raw, ctx.pointerFine) };
  });
}

function copyProblems(where: string, c: Copy | undefined, max: number): string[] {
  const out: string[] = [];
  for (const { raw, filled } of renders(c)) {
    const noTokens = raw.replace(/\{tap\}|\{Tap\}/g, '');
    if (HARD_VERB.test(noTokens)) out.push(`${where}: hard-coded verb (use {tap}/{Tap}): "${raw}"`);
    if (/\{(?!tap\}|Tap\})[^}]*\}/.test(raw)) out.push(`${where}: unknown token: "${raw}"`);
    if (filled.length > max) out.push(`${where}: ${filled.length} > ${max} chars: "${filled}"`);
    if (filled.trim().length === 0) out.push(`${where}: renders empty`);
    if (EMOJI.test(filled)) out.push(`${where}: emoji: "${filled}"`);
    if (LEAK.test(filled)) out.push(`${where}: leaks a missing value: "${filled}"`);
  }
  return Array.from(new Set(out));
}

function plainProblems(where: string, s: string, max: number): string[] {
  return copyProblems(where, s, max);
}

// ── scanners (shared by the self-test and the source scan) ──────────────────

/** The id attribute of every <TutorialTarget …> opening tag in `text`:
 *  static ids, and the prefix of a template id={`hub.tile.${…}`}. */
function wrappedIds(text: string): { statics: string[]; templates: string[] } {
  const statics: string[] = [];
  const templates: string[] = [];
  const re = /<TutorialTarget\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // The opening tag only: stop at the first `>` that is not part of `=>`.
    const rest = text.slice(m.index, m.index + 800);
    const end = rest.search(/[^=]>/);
    const tag = end >= 0 ? rest.slice(0, end + 2) : rest;
    const st = /\bid=(?:\{\s*)?['"]([^'"]+)['"]/.exec(tag);
    if (st) statics.push(st[1]);
    const tp = /\bid=\{\s*`([^`$]*)\$\{/.exec(tag);
    if (tp) templates.push(tp[1]);
  }
  return { statics, templates };
}
const emitsSignal = (text: string, name: string) => new RegExp(`tutorialSignal\\(\\s*['"]${esc(name)}['"]`).test(text);
const registersAssist = (text: string, id: string) => new RegExp(`useTutorialAssist\\(\\s*['"]${esc(id)}['"]`).test(text);
const mountsLayer = (text: string, id: string) => new RegExp(`<TutorialLayer\\b[^>]*\\bhost=(?:\\{\\s*)?['"]${esc(id)}['"]`).test(text);

// ── 0. scanner self-test (both modes) ───────────────────────────────────────
// The source scan is only as good as its regexes, so they are exercised on
// synthetic source first: multi-line tags, both quote styles, the dynamic
// family, and a commented-out wrapper that must NOT count.
console.log(`tutorial defs${STRUCTURE_ONLY ? ' (--structure-only: source scan skipped)' : ''}`);
console.log('scanner self-test');
{
  const sample = strip(`
    <TutorialTarget id="punch.save" style={styles.saveWrap}>
    <TutorialTarget
      style={[a, b]}
      id='dfr.voice'
    >
    <TutorialTarget onLayout={() => measure()} id={'invoice.send'}>
    <TutorialTarget id={\`hub.tile.\${tile.key}\`} style={tileStyle}>
    {/* <TutorialTarget id="punch.back"> */}
    // <TutorialTarget id="punch.camera">
    tutorialSignal('dfr.saved', { projectId });
    tutorialSignal(
      "punch.saved", { projectId });
    useTutorialAssist('invoice.fillPercent', fill);
    <TutorialLayer host="planPin" />
    {anyModalUp ? <TutorialTarget id="invoice.modalUp" /> : null}
  `);
  const w = wrappedIds(sample);
  ok('finds static ids across lines, quote styles and id={...}', ['punch.save', 'dfr.voice', 'invoice.send'].every(id => w.statics.includes(id)), JSON.stringify(w));
  ok('finds the dynamic family template', w.templates.includes('hub.tile.'), JSON.stringify(w));
  ok('finds a childless, self-closing blocker sentinel', w.statics.includes('invoice.modalUp'), JSON.stringify(w));
  ok('ignores commented-out wrappers', !w.statics.includes('punch.back') && !w.statics.includes('punch.camera'), JSON.stringify(w));
  ok('finds tutorialSignal calls (either quote, split lines)', emitsSignal(sample, 'dfr.saved') && emitsSignal(sample, 'punch.saved') && !emitsSignal(sample, 'dfr.voice.applied'));
  ok('finds useTutorialAssist', registersAssist(sample, 'invoice.fillPercent') && !registersAssist(sample, 'dfr.useSampleNote'));
  ok('finds <TutorialLayer host>', mountsLayer(sample, 'planPin') && !mountsLayer(sample, 'scheduleEdit'));
}

// ── 1. structure ────────────────────────────────────────────────────────────

console.log('structure');

const defs = TUTORIAL_DEF_LIST;
{
  const ids = defs.map(d => d.id);
  rule('def ids are unique', ids.filter((x, i) => ids.indexOf(x) !== i));
  rule('TUTORIAL_DEFS is keyed by def.id', defs.filter(d => TUTORIAL_DEFS[d.id] !== d).map(d => d.id));
  rule('every def is in TUTORIAL_ORDER (hub order)', defs.filter(d => !TUTORIAL_ORDER.includes(d.id)).map(d => d.id));
}

for (const def of defs) {
  const P = (m: string) => `${def.id}: ${m}`;
  const probs: Record<string, string[]> = {
    meta: [], ids: [], routes: [], targets: [], until: [], kinds: [], assists: [], gesture: [], checkpoint: [], practice: [], start: [], layers: [],
  };

  if (!Number.isInteger(def.version) || def.version < 1) probs.meta.push(P('version must be a positive integer'));
  if (!(def.seconds > 0 && def.seconds <= 60)) probs.meta.push(P(`seconds ${def.seconds} — each tutorial is under a minute`));
  if (def.steps.length === 0) probs.meta.push(P('no steps'));

  const stepIds = def.steps.map(s => s.id);
  probs.ids.push(...stepIds.filter((x, i) => stepIds.indexOf(x) !== i).map(x => P(`duplicate step id ${x}`)));

  def.steps.forEach((s: TutorialStep, i: number) => {
    const S = (m: string) => P(`step ${i} (${s.id}): ${m}`);
    if (!['do', 'look', 'wait'].includes(s.kind)) probs.kinds.push(S(`bad kind ${s.kind}`));
    if (!routeExists(s.route.pathname)) probs.routes.push(S(`route ${s.route.pathname} is not a screen under app/`));
    if (!['projectId', 'id'].includes(s.route.projectParam)) probs.routes.push(S('bad projectParam'));

    const chain = targetChain(s);
    const layer = s.layer ?? 'root';
    if (!LAYERS[layer]) probs.layers.push(S(`unknown layer ${layer}`));
    for (const t of chain) {
      const spec = targetSpec(t);
      if (isBlockerTarget(t)) probs.targets.push(S(`target ${t} is a blocker sentinel — it is never lit`));
      if (!spec) probs.targets.push(S(`target ${t} is not in the registry`));
      else if (spec.layer !== layer) probs.targets.push(S(`target ${t} lives on layer ${spec.layer}, step draws on ${layer}`));
    }
    if ((s.kind === 'do' || s.kind === 'look') && chain.length === 0) probs.targets.push(S(`${s.kind} step needs a target to light`));
    if (s.textByTarget) {
      for (const k of Object.keys(s.textByTarget)) {
        if (!chain.includes(k as never) || chain[0] === k) probs.targets.push(S(`textByTarget key ${k} is not a FALLBACK target of this step`));
      }
    }

    // A do / wait step waits on the app's REAL success point; a look step is
    // read-and-Next, so an `until` there would be a second way to advance.
    if (s.kind === 'look') {
      if (s.until) probs.until.push(S('look steps advance on Next only — no `until`'));
      if (s.success) probs.until.push(S('look steps have no success stamp'));
      if (s.failOn) probs.until.push(S('look steps have no failOn'));
    } else if (!s.until) {
      probs.until.push(S(`${s.kind} step has no \`until\` — it could only advance on a tap on the coach`));
    }
    if (s.until) {
      const u = s.until;
      if ('signal' in u) {
        const spec = SIGNALS[u.signal];
        if (!spec) probs.until.push(S(`until signal ${u.signal} not in SIGNALS`));
        else if (spec.outbound) probs.until.push(S(`until ${u.signal} is OUTBOUND — a tutorial may never wait on a send to someone else`));
        else if (spec.failure) probs.until.push(S(`until ${u.signal} is a failure signal`));
      } else if ('mounted' in u) {
        if (!targetSpec(u.mounted)) probs.until.push(S(`until mounted ${u.mounted} is not a registered target`));
        else if (isBlockerTarget(u.mounted)) probs.until.push(S(`until mounted ${u.mounted} is a blocker sentinel — opening a modal is never a goal`));
      } else if (!routeExists(u.route.pathname)) {
        probs.until.push(S(`until route ${u.route.pathname} is not a screen`));
      }
    }
    if (s.failOn && !SIGNALS[s.failOn]?.failure) probs.until.push(S(`failOn ${s.failOn} is not a failure signal`));
    // A wait step draws NOTHING, so the machine must never rest on one by
    // itself: it may only be the tail of a do step waiting on the same
    // completion. Then a signal completes both together and SKIP_STEP skips
    // both together — no path leaves a coach-less run. (While the modal the
    // wait names is up, the do step is current and the screen's blocker
    // sentinel is what hides the coach — see the blocker rule below.)
    if (s.kind === 'wait') {
      const prev = def.steps[i - 1];
      const same = !!prev && !!prev.until && !!s.until && JSON.stringify(prev.until) === JSON.stringify(s.until);
      if (!prev || prev.kind !== 'do' || !same) probs.until.push(S('a wait step must follow a do step with the SAME `until` (it can never be a resting point)'));
      else if (prev.skipIf || s.skipIf) probs.until.push(S('a wait step and its do step take no skipIf (a flag-skip would rest on the wait)'));
      if (s.checkpoint) probs.until.push(S('a wait step is never a checkpoint'));
    }

    if (s.assist) {
      if (!ASSISTS[s.assist]) probs.assists.push(S(`assist ${s.assist} not in ASSISTS`));
      if (s.kind !== 'do') probs.assists.push(S('only a do step may offer Do it for me'));
    }
    if (s.gesture === 'tap-point') {
      if (!s.point || s.point.x < 0 || s.point.x > 1 || s.point.y < 0 || s.point.y > 1) probs.gesture.push(S('tap-point needs a normalized point'));
    } else if (s.point) probs.gesture.push(S('point is only for tap-point'));
    if (s.skipIf && !['noSamplePlan', 'noMicOnPlatform'].includes(s.skipIf)) probs.gesture.push(S(`bad skipIf ${s.skipIf}`));
    if (layer === 'planPin' && s.skipIf !== 'noSamplePlan') probs.layers.push(S('a plan-pin step must skipIf noSamplePlan (the sample plan may not load)'));
    if (layer === 'planPin' && !def.needs.includes('plan')) probs.layers.push(S("a plan-pin step needs def.needs 'plan'"));

    // Every screen a step lives on declares a blocker sentinel: its RN
    // Modals draw above the root layer on iOS, and a screen with no sentinel
    // would put the dim, ring and card behind any sheet he opens mid-step.
    const screenFile = ROUTE_FILE.get(s.route.pathname);
    if (screenFile && !BLOCKER_TARGETS.some(b => TARGETS[b].file === screenFile)) {
      probs.layers.push(S(`screen ${screenFile} has no blocker sentinel in the registry (TARGETS … blocker: true)`));
    }

    // Resume restarts at the last checkpoint, so a checkpoint must be a step
    // the host can reach by pushing its route.
    if (s.checkpoint) {
      const entry = i === 0 || def.steps[i - 1].route.pathname !== s.route.pathname;
      if (!entry) probs.checkpoint.push(S('checkpoint is not a route-entry step'));
    }
  });
  if (!def.steps[0]?.checkpoint) probs.checkpoint.push(P('the first step must be a checkpoint'));

  const bad = def.practiceFeatures.filter(f => !PRACTICE_FEATURES_ALLOWED.includes(f));
  if (bad.length) probs.practice.push(P(`practiceFeatures outside the allowed four: ${bad.join(', ')}`));
  if (def.sandbox === 'current-real' && def.practiceFeatures.length) probs.practice.push(P('current-real mode never gets a practice pass'));

  // Start: the pushed screen is the first step's screen, on the sandbox.
  if (!routeExists(def.start.pathname)) probs.start.push(P(`start ${def.start.pathname} is not a screen`));
  if (def.start.stackUnder && !routeExists(def.start.stackUnder.pathname)) probs.start.push(P('stackUnder is not a screen'));
  const first = def.steps[0];
  if (first && first.route.pathname !== def.start.pathname) probs.start.push(P('the first step is not on the start screen'));
  const params = def.start.params('SANDBOX', { today: '2026-09-23', reportDay: '2026-09-22' });
  if (first && params[first.route.projectParam] !== 'SANDBOX') probs.start.push(P(`start params don't put the sandbox in ${first.route.projectParam}`));
  if (def.start.stackUnder && def.start.stackUnder.params('SANDBOX').id !== 'SANDBOX') probs.start.push(P('stackUnder is not the sandbox hub'));
  if (def.sandbox !== 'current-real' && !SANDBOX_PROJECT_NAME[def.sandbox].startsWith(SAMPLE_PROJECT_PREFIX)) probs.start.push(P('sandbox name lacks the byte-exact sample prefix'));

  if (!routeExists(def.handoff.pathname)) probs.start.push(P(`handoff ${def.handoff.pathname} is not a screen`));

  rule(`${def.id}: meta`, probs.meta);
  rule(`${def.id}: unique step ids`, probs.ids);
  rule(`${def.id}: every route is a real screen`, probs.routes);
  rule(`${def.id}: every target is registered, on the step's layer`, probs.targets);
  rule(`${def.id}: do/wait wait on a real success point; look steps don't`, probs.until);
  rule(`${def.id}: step kinds`, probs.kinds);
  rule(`${def.id}: assists are registered, do steps only`, probs.assists);
  rule(`${def.id}: gesture / skipIf`, probs.gesture);
  rule(`${def.id}: layers`, probs.layers);
  rule(`${def.id}: checkpoints are route-entry steps`, probs.checkpoint);
  rule(`${def.id}: practice pass limited to the allowed features`, probs.practice);
  rule(`${def.id}: start / handoff land on the sandbox and real screens`, probs.start);
}

// ── 2. anti-slideshow + copy ────────────────────────────────────────────────

console.log('anti-slideshow and copy');
for (const def of defs) {
  const P = (m: string) => `${def.id}: ${m}`;
  const shape: string[] = [];
  if (!def.steps.some(s => s.kind === 'do')) shape.push(P('no do step — that is a slideshow'));
  let run = 0;
  def.steps.forEach((s, i) => {
    run = s.kind === 'look' ? run + 1 : 0;
    if (run > 2) shape.push(P(`more than 2 look steps in a row ending at step ${i}`));
  });
  const last = def.steps[def.steps.length - 1];
  if (last?.kind !== 'look') shape.push(P('the last step must be a look at where the result landed'));
  const lastSuccess = def.steps.map(s => !!s.success).lastIndexOf(true);
  if (lastSuccess < 0 || lastSuccess >= def.steps.length - 1) shape.push(P('a success stamp must come BEFORE the final result look'));
  rule(`${def.id}: learn by doing, not a slideshow`, shape);

  const copy: string[] = [];
  copy.push(...plainProblems(P('title'), def.title, 60));
  copy.push(...plainProblems(P('endsWith'), def.endsWith, 60));
  def.steps.forEach((s, i) => {
    const S = (m: string) => P(`step ${i} (${s.id}) ${m}`);
    copy.push(...copyProblems(S('text'), s.text, 60));
    copy.push(...copyProblems(S('textWeb'), s.textWeb, 60));
    copy.push(...copyProblems(S('detail'), s.detail, 110));
    for (const [k, v] of Object.entries(s.textByTarget ?? {})) copy.push(...copyProblems(S(`textByTarget[${k}]`), v as Copy, 60));
    if (s.success) {
      copy.push(...copyProblems(S('success.title'), s.success.title, 60));
      copy.push(...copyProblems(S('success.sub'), s.success.sub, 110));
    }
  });
  if (def.chainNext) copy.push(...plainProblems(P('chainNext.label'), def.chainNext.label, 60));
  copy.push(...plainProblems(P('handoff.realJobLabel'), def.handoff.realJobLabel('Henderson Residence Kitch…'), 60));
  if (def.handoff.paywallLabel) copy.push(...plainProblems(P('handoff.paywallLabel'), def.handoff.paywallLabel, 60));
  rule(`${def.id}: copy fits, uses {tap}, no emoji, no leaked missing values`, copy);

  // The stat is MEASURED. With no payloads, extras must invent nothing.
  const honesty: string[] = [];
  const emptyExtras = (def.stat.extras?.({}) ?? []).filter(x => typeof x === 'string' && x.length > 0);
  if (emptyExtras.length) honesty.push(P(`stat extras invent values with no payloads: ${JSON.stringify(emptyExtras)}`));
  if (!def.steps.some(s => s.until && 'signal' in s.until && s.until.signal === def.stat.signal)) honesty.push(P(`stat clock stops on ${def.stat.signal}, which no step waits on`));
  const line = statLine(def, { firstActionAt: 0, signalAt: { [def.stat.signal]: 34_000 }, payloads: FULL_PAYLOADS });
  if (!line || line.length > 70) honesty.push(P(`stat line missing or too long: ${line}`));
  if (line && (HARD_VERB.test(line) || EMOJI.test(line) || LEAK.test(line))) honesty.push(P(`stat line: ${line}`));
  // Paywall copy must name the tier the feature really needs.
  if (def.handoff.feature) {
    const tier = REQUIRED_TIER[def.handoff.feature];
    const word = tier === 'business' ? 'Business' : tier === 'pro' ? 'Pro' : null;
    if (!def.handoff.paywallLabel) honesty.push(P('a gated handoff needs a paywallLabel'));
    else if (word && !def.handoff.paywallLabel.includes(word)) honesty.push(P(`paywallLabel says "${def.handoff.paywallLabel}" but ${def.handoff.feature} requires ${tier}`));
  }
  // The chain label's duration is the next tutorial's real length.
  if (def.chainNext) {
    const next = TUTORIAL_DEFS[def.chainNext.tutorialId];
    if (!next) honesty.push(P(`chainNext ${def.chainNext.tutorialId} is not in this build`));
    else if (!def.chainNext.label.includes(`${next.seconds} s`)) honesty.push(P(`chain label "${def.chainNext.label}" doesn't say ${next.seconds} s`));
    if (next && !def.fieldSeatOk && next.fieldSeatOk) { /* fine: offering a field-ok tutorial from a money one */ }
  }
  rule(`${def.id}: stat, paywall and chain copy are honest`, honesty);
}

// ── fixtures ────────────────────────────────────────────────────────────────

console.log('fixtures');
{
  const seed = read('utils/demoSeed.ts');
  const smallName = /small:\s*\{\s*name:\s*'((?:[^'\\]|\\.)*)'/.exec(seed)?.[1]?.replace(/\\'/g, "'");
  ok("sandbox name is byte-identical to DEMO_FLAVORS.small.name", smallName === SANDBOX_PROJECT_NAME['sarahs-place'], `demoSeed: ${JSON.stringify(smallName)}`);
  const smallTotal = /small:\s*\{[\s\S]*?total:\s*([\d_]+)/.exec(seed)?.[1]?.replace(/_/g, '');
  ok('SAMPLE_ESTIMATE_TOTAL matches DEMO_FLAVORS.small.total', Number(smallTotal) === SAMPLE_ESTIMATE_TOTAL, `demoSeed: ${smallTotal}`);
  const sum = SAMPLE_ESTIMATE_LINES.reduce((s, l) => s + l.lineTotal, 0);
  ok('8 estimate lines foot to $422,400', SAMPLE_ESTIMATE_LINES.length === 8 && sum === SAMPLE_ESTIMATE_TOTAL, `${SAMPLE_ESTIMATE_LINES.length} lines, ${sum}`);
  const drift = SAMPLE_ESTIMATE_LINES.filter(l => Math.abs(l.unitPrice * l.quantity * (1 + l.markup / 100) - l.lineTotal) > 0.005);
  ok('each line: pre-markup unitPrice × qty × (1 + markup) = lineTotal', drift.length === 0, drift.map(l => l.name).join(', '));
  ok('15 % progress bills $63,360 (the copy\'s example)', (SAMPLE_ESTIMATE_TOTAL * SAMPLE_PROGRESS_PCT) / 100 === 63_360);
  const le = sampleLinkedEstimate('e', '2026-09-23T00:00:00Z');
  ok('linkedEstimate: grand total $422,400, base + markup foot, no fabricated bulkSavingsTotal',
    le.grandTotal === SAMPLE_ESTIMATE_TOTAL && le.baseTotal + le.markupTotal === le.grandTotal && !('bulkSavingsTotal' in le));
  const inferred = inferTradeFromText(PUNCH_SAMPLE.line);
  ok('the sample punch line infers Electrical with no AI', inferred.trade === 'Electrical' && inferred.method === 'keyword' && PUNCH_SAMPLE.trade === 'Electrical', JSON.stringify(inferred));
  const rooms = Object.entries(SAMPLE_PLAN.rooms);
  ok('sample plan rooms are normalized points', rooms.every(([, p]) => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1));
  ok('sample plan has Kitchen, Hall Bath and Primary Bath', ['Kitchen', 'Hall Bath', 'Primary Bath'].every(r => r in SAMPLE_PLAN.rooms));
  ok('sample plan sheet is A-101', SAMPLE_PLAN.sheetNumber === 'A-101');
  const pin = TUTORIAL_DEFS['punch-walk']?.steps.find(s => s.gesture === 'tap-point');
  ok("the hand's tap-point is the Kitchen label on the sample plan", !!pin?.point && pin.point.x === SAMPLE_PLAN.rooms.Kitchen.x && pin.point.y === SAMPLE_PLAN.rooms.Kitchen.y);
  ok('the sample room is on the plan', PUNCH_SAMPLE.room in SAMPLE_PLAN.rooms);
  const parsed = DFR_SAMPLE_NOTE.parsed as Record<string, unknown>;
  ok('DFR sample note: the reported sections are exactly the parsed fields', JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify([...DFR_SAMPLE_NOTE.sections].sort()));
  const crew = (DFR_SAMPLE_NOTE.parsed.manpower ?? []).reduce((s, m) => s + m.headcount, 0);
  ok('DFR sample note: the transcript says three and the parse has 3 crew', crew === 3 && /\bThree\b/.test(DFR_SAMPLE_NOTE.transcript));
  ok('DFR sample note invents no weather', !('weather' in parsed));
  const ops = SCHEDULE_SAMPLE.ops([{ id: 't1', name: 'Frame walls' }, { id: 't2', name: 'Hang & finish drywall' }]);
  ok('schedule fixture: moves the drywall task 2 days', JSON.stringify(ops) === JSON.stringify([{ op: 'move', task: 't2', deltaDays: 2 }]));
  ok('schedule fixture: no drywall task → no preset', SCHEDULE_SAMPLE.ops([{ id: 't1', name: 'Frame walls' }]).length === 0);
  ok('schedule fixture: exact sentence normalizes equal, an edit does not',
    SCHEDULE_SAMPLE.normalize('Push drywall 2 days — board delivery slipped') === SCHEDULE_SAMPLE.normalize(SCHEDULE_SAMPLE.sentence) &&
      SCHEDULE_SAMPLE.normalize('Push drywall 3 days') !== SCHEDULE_SAMPLE.normalize(SCHEDULE_SAMPLE.sentence));
  const fixtureText = [DFR_SAMPLE_NOTE.transcript, PUNCH_SAMPLE.line, SCHEDULE_SAMPLE.sentence];
  ok('fixture text has no emoji', fixtureText.every(t => !EMOJI.test(t)));
}

// ── purity ──────────────────────────────────────────────────────────────────

console.log('purity');
{
  const PURE = ['types', 'registry', 'machine', 'placement', 'practicePass', 'stats', 'handoff', 'offers', 'sandboxCore', 'fixtures', 'activeRun']
    .map(n => `utils/tutorial/${n}.ts`)
    .concat(readdirSync(join(ROOT, 'utils/tutorial/defs')).filter(n => n.endsWith('.ts')).map(n => `utils/tutorial/defs/${n}`));
  const probs: string[] = [];
  for (const f of PURE) {
    if (!existsSync(join(ROOT, f))) { probs.push(`${f} missing`); continue; }
    const src = strip(read(f));
    if (/from\s+['"](react|react-native|expo[-\w/]*|@react-native-async-storage\/[\w-]+|@\/contexts\/[\w/]+|@\/hooks\/[\w/]+|@\/components\/[\w/]+)['"]/.test(src)) probs.push(`${f} imports React / RN / a context`);
  }
  rule('the engine core is pure (bun-runnable, no React / RN in its graph)', probs);
  const machineSrc = strip(read('utils/tutorial/machine.ts')) + strip(read('utils/tutorial/placement.ts'));
  ok('machine + placement read no clock and no randomness (every event carries now)', !/Date\.now|new Date\(|Math\.random/.test(machineSrc));
  ok('activeRun imports nothing (analytics reads it without a cycle)', !/^\s*import\s/m.test(strip(read('utils/tutorial/activeRun.ts'))));
}

// ── 3. source scan ──────────────────────────────────────────────────────────

if (!STRUCTURE_ONLY) {
  console.log('source scan (every id lives where the registry says)');
  const cache = new Map<string, string | null>();
  const src = (f: string) => {
    if (!cache.has(f)) cache.set(f, existsSync(join(ROOT, f)) ? strip(read(f)) : null);
    return cache.get(f)!;
  };
  const usedTargets = new Set<string>();
  const usedLayers = new Set<string>();
  for (const def of defs) {
    for (const s of def.steps) {
      for (const t of targetChain(s)) usedTargets.add(t);
      if (s.until && 'mounted' in s.until) usedTargets.add(s.until.mounted);
      if (s.layer && s.layer !== 'root') usedLayers.add(s.layer);
    }
  }
  const tprobs: string[] = [];
  for (const id of new Set([...Object.keys(TARGETS), ...usedTargets])) {
    const spec = targetSpec(id);
    if (!spec) continue; // structure already failed it
    const text = src(spec.file);
    if (text === null) { tprobs.push(`${id}: ${spec.file} does not exist`); continue; }
    const w = wrappedIds(text);
    const family = (Object.keys(DYNAMIC_TARGET_FAMILIES) as string[]).find(p => id.startsWith(p));
    const found = w.statics.includes(id) || (!!family && w.templates.includes(family));
    if (!found) tprobs.push(`${id}: no <TutorialTarget id="${id}">${family ? ` or id={\`${family}\${…}\`}` : ''} in ${spec.file}`);
  }
  rule('every target is wrapped in its declared file', tprobs);

  const sprobs: string[] = [];
  for (const [name, spec] of Object.entries(SIGNALS)) {
    const text = src(spec.file);
    if (text === null) { sprobs.push(`${name}: ${spec.file} does not exist`); continue; }
    if (!emitsSignal(text, name)) sprobs.push(`${name}: no tutorialSignal('${name}', …) in ${spec.file}`);
  }
  rule('every signal is emitted in its declared file', sprobs);

  const aprobs: string[] = [];
  for (const [id, spec] of Object.entries(ASSISTS)) {
    const text = src(spec.file);
    if (text === null) { aprobs.push(`${id}: ${spec.file} does not exist`); continue; }
    if (!registersAssist(text, id)) aprobs.push(`${id}: no useTutorialAssist('${id}', …) in ${spec.file}`);
  }
  rule('every assist is registered in its declared file', aprobs);

  const lprobs: string[] = [];
  for (const l of usedLayers) {
    const spec = LAYERS[l as keyof typeof LAYERS];
    const text = src(spec.file);
    if (text === null) { lprobs.push(`${l}: ${spec.file} does not exist`); continue; }
    if (!mountsLayer(text, l)) lprobs.push(`${l}: no <TutorialLayer host="${l}"/> in ${spec.file}`);
  }
  rule('every modal layer a def uses is mounted inside its modal', lprobs);

  // Reverse check: a wrapper whose id matches nothing registered is a typo
  // that would leave the REAL id unwrapped (the forward check catches that
  // too, but this names the file with the typo).
  const unknown: string[] = [];
  for (const f of [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))]) {
    const text = strip(readFileSync(f, 'utf8'));
    if (!text.includes('<TutorialTarget')) continue;
    for (const id of wrappedIds(text).statics) if (!targetSpec(id)) unknown.push(`${relative(ROOT, f)}: id="${id}" is not in the registry`);
    for (const t of wrappedIds(text).templates) if (!(t in DYNAMIC_TARGET_FAMILIES)) unknown.push(`${relative(ROOT, f)}: id={\`${t}\${…}\`} is not a registered family`);
  }
  rule('every <TutorialTarget> id in the app is registered', unknown);
}

console.log(`\n${pass} passed, ${fail} failed${STRUCTURE_ONLY ? ' (structure only)' : ''}`);
process.exit(fail === 0 ? 0 : 1);
