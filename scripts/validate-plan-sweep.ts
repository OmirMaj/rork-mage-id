// validate-plan-sweep.ts — Plan Set Code Sweep (list-2 lane S, 2026-09-26).
//
// "Sweep my plans for questions in my scope": the job's scope picks the topics,
// the plan search picks the sheets, one AI pre-check per sheet raises QUESTIONS
// FOR THE ARCHITECT, and each can become an UNSENT RFI draft. This pins:
//   1. scopeTargetsFor — the Scope Code Gaps rules, res/com, excludeLinePhrases,
//      ≤ 8, and the 'general' list when there is no scope;
//   2. selectSheets — every current sheet in exactly one list, with its reason;
//   3. analyze-plan-code — WITHOUT `sweep` the prompt and the normalized result
//      are byte-identical to the pre-sweep base (hashes recorded on 4a5f6eb7
//      before any edit); WITH it the forbidden-words line, question + location;
//   4. the RFI draft — unsent, 14 calendar days, "model's recall";
//   5. the model's own words neutralised in the view AND the draft;
//   6. a search refusal shows the function's own sentence;
//   7. the panel's copy never says violation / passed / compliant / clean /
//      approved, and nothing here persists the sweep.
//
// Run via: bun run scripts/validate-plan-sweep.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc type-checks scripts/ with the app's lib set, which has no Bun global.
// The three APIs used here are declared (same as validate-code-check-honesty).
declare const Bun: {
  Transpiler: new (o: { loader: 'ts' }) => { transformSync(src: string): string };
  CryptoHasher: new (alg: 'sha256') => { update(s: string): { digest(enc: 'hex'): string } };
  plugin(def: { name: string; setup: (build: { module(s: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }) => void }): void;
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments stripped. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}
const sha = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');

// ── Module stubs: the I/O file under bun, with the network faked ───────────
type Invoke = (fn: string, body: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
let invokeHandler: Invoke = async () => ({ data: null, error: { message: 'unset' } });
let rpcHandler: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> = async () => ({ data: 0, error: null });
const invoked: string[] = [];
const supabaseStub = {
  functions: { invoke: async (fn: string, opts: { body: Record<string, unknown> }) => { invoked.push(fn); return invokeHandler(fn, opts.body); } },
  rpc: async (fn: string, args: Record<string, unknown>) => rpcHandler(fn, args),
};
class PlanCodeErrorStub extends Error {
  constructor(message: string, readonly code: string, readonly reason: string) { super(message); }
}
let reviewHandler: (opts: Record<string, unknown>) => Promise<{ findings: unknown[]; disclaimer: string }> = async () => ({ findings: [], disclaimer: '' });
if (typeof Bun === 'undefined') { console.error('must run under bun'); process.exit(1); }
Bun.plugin({
  name: 'plan-sweep-stubs',
  setup(build) {
    build.module('@/lib/supabase', () => ({ exports: { supabase: supabaseStub, isSupabaseConfigured: true }, loader: 'object' }));
    build.module('@/utils/mageAI', () => ({ exports: { mageAI: async () => ({ success: false }) }, loader: 'object' }));
    build.module('@/utils/planCodeReviewer', () => ({
      exports: {
        imageUriToBase64: async (uri: string) => { if (uri.includes('broken')) throw new Error('x'); return { base64: 'AAAA', mimeType: 'image/png' }; },
        reviewPlanCode: async (opts: Record<string, unknown>) => reviewHandler(opts),
        PlanCodeError: PlanCodeErrorStub,
        PLAN_REVIEW_DISCLAIMER: 'x',
      },
      loader: 'object',
    }));
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios' } }, loader: 'object' }));
  },
});

const PS = await import('../utils/plans/planSweep');
const RUN = await import('../utils/plans/planSweepRun');
const { resolveCodeJurisdiction } = await import('../utils/codeJurisdiction');
const { PLAN_SOURCE } = await import('../utils/plans/planChunk');
const I18N = await import('../i18n/core');
type Sheet = import('../types').PlanSheet;

const BAD = /\b(passed|compliant|clean|approved)\b/i;
const P = 'proj-1';
const sheet = (id: string, no: string, extra: Partial<Sheet> = {}): Sheet => ({
  id, projectId: P, name: no, sheetNumber: no, imageUri: `https://x.test/${id}.png`, createdAt: '2026-09-01T00:00:00Z', ...extra,
} as unknown as Sheet);
const match = (sheetId: string, similarity: number, content = `Sheet text for ${sheetId}`) =>
  ({ doc_id: `plan-sheet:${sheetId}`, source: PLAN_SOURCE, ref: sheetId, content, similarity });
const target = (id: string, topic = id) => ({ id, topic, phrase: topic, trigger: id });

// ── 1. scopeTargetsFor ────────────────────────────────────────────────────
console.log('\n1. what the sweep looks for');
{
  const kb = PS.scopeTargetsFor({ lines: [{ name: 'Kitchen cabinets' }, { name: 'Bathroom vanity' }], jobKind: 'residential' });
  const ids = kb.targets.map(t => t.id);
  ok('a kitchen + bath estimate is a scope sweep', kb.basis === 'scope');
  ok('…that looks for bathroom GFCI and kitchen GFCI/AFCI, as the rules say', ids.includes('bath-gfci') && ids.includes('kitchen-gfci-afci'), ids.join(','));
  const k = kb.targets.find(t => t.id === 'bath-gfci')!;
  ok('…with the scope words that fired it in the phrase', /Bathroom GFCI protection/.test(k.phrase) && /bathroom/.test(k.phrase) && /vanity/.test(k.phrase), k.phrase);
  const bb = PS.scopeTargetsFor({ lines: [], scopeNotes: ['Finish the basement with a basement bedroom and a bath'], jobKind: 'residential' });
  const bbIds = bb.targets.map(t => t.id);
  ok('a basement-bedroom note looks for the egress window', bbIds.includes('egress-basement-bedroom'), bbIds.join(','));
  ok('…and the smoke and CO alarms', bbIds.includes('smoke-co-sleeping'));
  const tl = PS.scopeTargetsFor({ lines: [{ name: 'Tankless water heater' }], jobKind: 'residential' });
  ok('excludeLinePhrases: a tankless water heater never asks for an expansion tank', !tl.targets.some(t => t.id === 'water-heater-expansion'));
  const wh = PS.scopeTargetsFor({ lines: [{ name: 'Water heater replacement' }], jobKind: 'residential' });
  ok('…while a plain water heater does', wh.targets.some(t => t.id === 'water-heater-expansion'));
  const com = PS.scopeTargetsFor({ lines: [{ name: 'Kitchen' }, { name: 'Restroom' }], jobKind: 'commercial' });
  ok('res-only rules stay off a commercial job; com rules fire',
    !com.targets.some(t => t.id === 'kitchen-gfci-afci') && com.targets.some(t => t.id === 'accessible-restroom'), com.targets.map(t => t.id).join(','));
  const many = PS.scopeTargetsFor({
    lines: ['Kitchen', 'Bathroom shower', 'Bedroom', 'Deck', 'Stairs', 'Water heater', 'Laundry dryer', 'Range hood', 'Heat pump', 'Panel upgrade', 'Gas line'].map(name => ({ name })),
    jobKind: 'residential',
  });
  ok('never more than 8 topics (8 plan searches)', many.targets.length === 8, String(many.targets.length));
  ok('every phrase fits the server clip (≤ 80)', many.targets.every(t => t.phrase.length <= 80));
  const none = PS.scopeTargetsFor({ lines: [], scopeNotes: ['', null, undefined], jobKind: 'residential' });
  ok('no scope on file → the general list, labelled general', none.basis === 'general' && none.targets.length === 5);
  eq('…in the spec\'s five topics', none.targets.map(t => t.topic), [
    'Egress windows and doors', 'Stairs, handrails and guards', 'Fire separation and rated assemblies', 'Accessible route and clearances', 'Smoke and CO alarms',
  ]);
}

// ── 2. selectSheets ───────────────────────────────────────────────────────
console.log('\n2. which sheets, and why the rest were not reviewed');
{
  const A1 = sheet('a1', 'A-101'), A2 = sheet('a2', 'A-201'), A3 = sheet('a3', 'A-301'), S1 = sheet('s1', 'S-101');
  const OLD = sheet('old', 'A-201', { superseded: true } as Partial<Sheet>);
  const U = sheet('u1', 'E-101');
  const sheets = [A1, A2, A3, S1, OLD, U];
  const indexed = new Set(['a1', 'a2', 'a3', 's1']);
  const searches = [
    { target: target('egress', 'Egress'), matches: [match('a2', 0.8, 'EGRESS WINDOW 5.7 SF NET CLEAR OPENING AT BEDROOM 2 SEE WINDOW SCHEDULE AND DETAIL 4/A-501 FOR SILL HEIGHT AND WELL'), match('a1', 0.6), match('old', 0.95), match('gone', 0.99), match('a3', 0.3)] },
    { target: target('stairs', 'Stairs'), matches: [match('a1', 0.7), match('a2', 0.55)] },
  ];
  const r = PS.selectSheets({ searches, sheets, indexedSheetIds: indexed, limit: 1 });
  const current = sheets.filter(s => !s.superseded);
  const all = [...r.selected.map(x => x.sheet.id), ...r.notReviewed.map(x => x.sheet.id)];
  ok('every current sheet lands in exactly one list', all.length === current.length && current.every(s => all.filter(i => i === s.id).length === 1), all.join(','));
  ok('a superseded sheet is in neither list, even with the best match', !all.includes('old'));
  ok('a match on a deleted sheet is ignored', !all.includes('gone'));
  ok('score = best confident similarity + 0.05 per topic: A-201 (0.80+0.10) beats A-101 (0.70+0.10)', r.selected[0]?.sheet.id === 'a2', JSON.stringify(r.selected.map(x => [x.sheet.id, x.score])));
  ok('the limit is honoured and the other match reads over_limit with the limit named',
    r.selected.length === 1 && r.notReviewed.find(x => x.sheet.id === 'a1')?.kind === 'over_limit'
      && r.notReviewed.find(x => x.sheet.id === 'a1')?.why === "Matched, but over this sweep's limit of 1 sheet");
  ok('a below-floor match is not a match (A-301 at 0.30 → no_match)', r.notReviewed.find(x => x.sheet.id === 'a3')?.kind === 'no_match');
  ok('an unindexed sheet reads not_indexed, with where to fix it',
    r.notReviewed.find(x => x.sheet.id === 'u1')?.kind === 'not_indexed' && /index it in Ask your plans/.test(r.notReviewed.find(x => x.sheet.id === 'u1')!.why));
  ok('a sheet nothing matched says so', r.notReviewed.find(x => x.sheet.id === 's1')?.why === 'Nothing on it matched your scope');
  ok('why chosen: each topic with a quoted snippet ≤ 90 chars',
    r.selected[0].reasons.length === 2 && r.selected[0].reasons.every(x => x.snippet.length <= 90) && r.selected[0].reasons[0].snippet.endsWith('…'),
    JSON.stringify(r.selected[0].reasons));
  const f = PS.selectSheets({ searches: [{ target: target('egress'), matches: [match('a2', 0.8)] }, { target: target('stairs'), matches: null }], sheets, indexedSheetIds: indexed, limit: 6 });
  ok('a failed topic: sheets no other topic chose read search_failed, never "nothing matched"',
    f.notReviewed.find(x => x.sheet.id === 's1')?.kind === 'search_failed' && f.selected.some(x => x.sheet.id === 'a2'));
  const u = PS.selectSheets({ searches: [{ target: target('egress'), matches: [match('a2', 0.8), match('u1', 0.9)] }], sheets, indexedSheetIds: null, limit: 6 });
  ok('manifest unreadable → the search decides; the rest say the index status is unknown',
    u.selected.some(x => x.sheet.id === 'u1') && u.notReviewed.find(x => x.sheet.id === 's1')?.why === "Nothing on it matched your scope (index status couldn't be read)");
  const z = PS.selectSheets({ searches: [{ target: target('egress'), matches: [match('a2', 0.8)] }], sheets, indexedSheetIds: indexed, limit: 0, overLimitWhy: PS.sweepCopy.monthlyLimit });
  ok('no allowance left → matched sheets say the monthly limit, not the sweep limit', z.selected.length === 0 && z.notReviewed.find(x => x.sheet.id === 'a2')?.why === PS.sweepCopy.monthlyLimit);
}

// ── 3. analyze-plan-code: Plan Review byte-identical, sweep additive ──────
console.log('\n3. analyze-plan-code: without `sweep` nothing changed; with it, questions');
const FN = 'supabase/functions/analyze-plan-code/index.ts';
const fnSrc = read(FN);
function loadPure(src: string, name: string, exportNames: string[]): Record<string, unknown> | null {
  const m = src.match(new RegExp(`// <pure:${name}>\\n([\\s\\S]*?)// </pure:${name}>`));
  if (!m) return null;
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${m[1]}\nmodule.exports = { ${exportNames.join(', ')} };`);
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
}
const promptBlock = loadPure(fnSrc, 'planPrompt', ['buildPrompt', 'sweepTargetsOf']);
const normBlock = loadPure(fnSrc, 'normalizePlanResult', ['normalizePlanResult']);
ok(`${FN} marks the prompt and normalizePlanResult as pure blocks`, !!promptBlock && !!normBlock);
// Recorded on base 4a5f6eb7 (the untouched file) with these exact inputs,
// BEFORE this lane edited anything: sha256 of the two prompts and of the
// normalized JSON. Plan Review's request carries no `sweep`, so these must
// never move because of the sweep.
// Moved ONCE on purpose (content rights, 2026-10-03): every prompt now asks for
// the requirement in the model's own words and forbids quoting model-code text
// (ICC, NFPA) — one added line and the "paraphrased in your own words" schema
// hint. Re-recorded after proving each new prompt equals the 4a5f6eb7 prompt
// (4b32b603… / 633bd733…) with exactly those two edits and nothing else.
// scripts/validate-code-copyright-prompts.ts pins the rule itself.
// Moved a SECOND time on purpose (code cards, 2026-10-04): one line after the
// paraphrase rule tells the model to write requirement and observed as short
// plain sentences with no quotation marks and inches as "in.", because the
// app's own-words gate withholds a quoted line. scripts/validate-code-card-server.ts
// proves each prompt is the ca7cdf2f… / a8f9948d… prompt plus exactly that line.
const BASE_PROMPT_SHA = [
  '742c854b31cc314bec0482bd56b38e49b0760772172935e095b12cb6b03e6efe',
  '0ac123f2d4a4ebfd85c9c1e3e109a8f9dc7f8e889b397be5217410ad158199e9',
];
const BASE_NORM_SHA = 'babbc66c341c2d9978e465a890d99573eeb2caea063dd391d922aaab0a3a338c';
const REQS = [
  { imageBase64: 'x', mimeType: 'image/png' },
  { imageBase64: 'x', mimeType: 'image/png', location: 'Hoboken, NJ', projectType: 'renovation', jurisdictionBlock: 'Adopted: IRC 2021 (NJ UCC)' },
];
const RAW = { findings: [
  { category: 'egress', codeRef: 'IRC R310.1', citedEdition: 'IRC 2021', section: 'R310.1', requirement: 'Window violates R310 egress', observed: 'small\nwindow', severity: 'high', confidence: 'med', evidence: 'verified', question: 'Is this ok', location: { x: 1.4, y: NaN } },
  { category: 'stairs', codeRef: 'x', requirement: 'r', observed: 'o', severity: 'low', confidence: 'low' },
], disclaimer: 'verify' };
if (promptBlock && normBlock) {
  const buildPrompt = promptBlock.buildPrompt as (r: Record<string, unknown>) => string;
  const sweepTargetsOf = promptBlock.sweepTargetsOf as (s: unknown) => string[] | null;
  const norm = normBlock.normalizePlanResult as (raw: unknown, sweep?: boolean) => { findings: Record<string, unknown>[]; disclaimer: string };
  REQS.forEach((r, i) => ok(`Plan Review prompt #${i + 1} is byte-identical to base`, sha(buildPrompt(r)) === BASE_PROMPT_SHA[i]));
  ok('Plan Review normalized output is byte-identical to base (no question/location keys)', sha(JSON.stringify(norm(RAW))) === BASE_NORM_SHA);
  ok('…and carries neither key', norm(RAW).findings.every(f => !('question' in f) && !('location' in f)));
  const sweepReq = { ...REQS[1], sweep: { scopeTargets: ['Basement egress window', ' Smoke\u0007 and CO alarms ', '', 'x'.repeat(200), 'a', 'b', 'c', 'd', 'e', 'f'] } };
  const sp = buildPrompt(sweepReq);
  ok('with sweep: the scope line names the targets joined by "; "', sp.includes("The general contractor's scope on this job includes: Basement egress window; Smoke and CO alarms; "));
  ok('with sweep: the forbidden-words instruction line is present',
    sp.includes("Write every field as a question or an observation for the architect. Never use the words 'violation', 'violates', 'non-compliant', 'fails code' or 'illegal'."));
  ok('without sweep: that line is absent', !buildPrompt(REQS[1]).includes('Never use the words'));
  ok('with sweep: the JSON shape asks for question and location', sp.includes('"question":"one plain question the contractor can send the architect about this item, phrased as a question"') && sp.includes('"location":{"x":0.0-1.0,"y":0.0-1.0}'));
  const t = sweepTargetsOf(sweepReq.sweep)!;
  ok('targets sanitised: ≤ 8, ≤ 80 chars, control chars gone, empties dropped', t.length === 8 && t.every(x => x.length <= 80 && x.length > 0 && !/[\u0000-\u001f]/.test(x)) && t[1] === 'Smoke and CO alarms', JSON.stringify(t));
  ok('no sweep object → null (the Plan Review path)', sweepTargetsOf(undefined) === null && sweepTargetsOf('x') === null);
  const sw = norm(RAW, true);
  ok('with sweep: x clamped to 1, NaN y → the whole location null', sw.findings[0].location === null);
  ok('…a good location is clamped into [0,1]', JSON.stringify(norm({ findings: [{ location: { x: -0.2, y: 0.4 } }] }, true).findings[0].location) === '{"x":0,"y":0.4}');
  ok('…a string location is null', norm({ findings: [{ location: { x: '0.5', y: 0.5 } }] }, true).findings[0].location === null);
  ok('with sweep: the question gets its "?"', sw.findings[0].question === 'Is this ok?');
  ok('…an empty question is null', sw.findings[1].question === null);
  ok('…a question never exceeds 300 chars', (norm({ findings: [{ question: 'q'.repeat(400) }] }, true).findings[0].question as string).length <= 300);
  ok('a model-written evidence:"verified" is still overwritten', sw.findings[0].evidence === 'model_recall');
  ok('the Plan Review line still returns the normalized result',
    /const data = normalizePlanResult\(await callGemini\(body\)\);/.test(fnSrc) && /normalizePlanResult\(await callGemini\(body\), true\)/.test(fnSrc));
  ok('tiering and the hourly bucket are unchanged', /requireTier\(req, \["pro", "business"\], "plan_code_review"\)/.test(fnSrc) && /const HOURLY_LIMIT = 30;/.test(fnSrc));
}

// ── 4 + 5. The finding view and the RFI draft ─────────────────────────────
console.log('\n4. the RFI draft is unsent, and 5. the model\'s words are neutralised');
{
  const nj = resolveCodeJurisdiction({ city: 'Hoboken', state: 'NJ' });
  const A2 = sheet('a2', 'A-201', { storagePath: '11111111-2222-3333-4444-555555555555/a2-page-1.png' } as Partial<Sheet>);
  const finding = {
    category: 'egress', codeRef: 'IRC R310.1 — window violates egress', citedEdition: 'IRC 2018', section: 'R310.1',
    requirement: 'Window violates R310 egress', observed: 'This is a code violation at bedroom 2; illegal sill height', severity: 'high', confidence: 'med',
    question: 'Is this non-compliant?', location: { x: 0.1, y: 0.1 },
  };
  const v = PS.sweepFindingView(finding, A2, nj);
  const fields = [v.title, v.observed, v.requirement, v.citation];
  ok('the view has no forbidden word in any model field', fields.every(f => !PS.FORBIDDEN_WORDS.test(f)), JSON.stringify(fields));
  ok('"violates" is gone and R310 is still there', !/violates/i.test(v.requirement) && /R310/.test(v.requirement), v.requirement);
  ok('the requirement is labelled model recall, not looked up', v.requirementLabel === 'Requirement (model recall — not looked up)');
  ok('the rung comes from the Plan Review ladder', typeof v.rung.badge === 'string' && v.rung.rungIndex >= 1);
  ok('where: the approximate position in words, on the sheet', /^approximate location: upper-left of the sheet .* on A-201$/.test(v.where), v.where);
  const now = new Date(2026, 8, 26, 18);
  const rfi = PS.rfiFromSweepFinding(A2, v, now, A2.storagePath);
  ok('the draft is unsent: ball in the GC\'s court, no addressee, open', rfi.ballInCourt === 'gc' && rfi.assignedTo === '' && rfi.status === 'open');
  eq('due 14 calendar days out (rfiFromPin\'s rule)', rfi.dateRequired, '2026-10-10');
  ok('the question says the code reference is the model\'s recall', /model's recall/.test(rfi.question) && /has not been looked up/.test(rfi.question), rfi.question);
  ok('the question carries the observed text and the position', /Observed on the drawing:/.test(rfi.question) && /Approximate location: upper-left/.test(rfi.question));
  ok('the draft (question and subject) has no forbidden word', !PS.FORBIDDEN_WORDS.test(rfi.question) && !PS.FORBIDDEN_WORDS.test(rfi.subject), rfi.question);
  ok('the sheet is attached by its durable key', rfi.attachments.length === 1 && rfi.attachments[0] === A2.storagePath);
  const noLoc = PS.sweepFindingView({ ...finding, location: null, question: '' }, A2, nj);
  ok('no question → "Confirm: <requirement>"; no location → said so', noLoc.title.startsWith('Confirm: ') && noLoc.where === 'location not identified on A-201' && noLoc.location === null);
  const r2 = PS.rfiFromSweepFinding(A2, noLoc, now, null);
  ok('…and its draft invents no position', /Location not identified on A-201/.test(r2.question) && !/% from the left/.test(r2.question), r2.question);
  const samples = ['It violated the rule', 'VIOLATION OF R302', 'noncompliant with R311', 'The stair fails code', 'in violation of section 5', 'Violating', 'violationish'];
  ok('neutralizeModelText clears every forbidden spelling', samples.every(s => !PS.FORBIDDEN_WORDS.test(PS.neutralizeModelText(s))), samples.map(x => PS.neutralizeModelText(x)).join(' | '));
}

// ── 6. Stage A and B against a faked network ──────────────────────────────
console.log('\n6. the two stages, and a refusal in the function\'s own words');
{
  const S = [sheet('a1', 'A-101'), sheet('a2', 'A-201'), sheet('a3', 'A-301')];
  const manifest = (stale: string[]) => ({ data: { success: true, stale: stale.map(id => `plan-sheet:${id}`) }, error: null });
  const refusal = (code: string, error: string) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: 429, json: async () => ({ success: false, error, code }) } } });
  const CAP = 'Monthly Project Memory limit reached — try again next month or upgrade.';
  let n = 0;
  invokeHandler = async (fn) => {
    if (fn === 'project-memory-embed') return manifest([]);
    if (fn === 'project-memory-search') { n++; return n === 1 ? { data: { success: true, matches: [match('a2', 0.8)] }, error: null } : refusal('cap_reached', CAP); }
    return { data: null, error: { message: 'x' } };
  };
  rpcHandler = async () => ({ data: 7, error: null });
  const r = await RUN.findSweepSheets({ projectId: P, sheets: S, targets: [target('egress'), target('stairs'), target('fire')], userId: 'u', monthlyCap: 10 });
  ok('stage A ran', r.state === 'ready');
  if (r.state === 'ready') {
    ok('the search that answered still chose its sheet', r.selected.map(x => x.sheet.id).join() === 'a2');
    ok('a cap_reached refusal stops the searches', n === 2 && r.stoppedWhy === CAP);
    ok('…and every sheet not chosen carries THAT sentence, not "search failed"', r.notReviewed.length === 2 && r.notReviewed.every(x => x.why === CAP));
    ok('allowance: 10 − 7 = 3 left, limit min(6, 3)', r.allowance.remaining === 3 && r.allowance.limit === 3 && !r.allowance.readFailed);
  }
  invokeHandler = async (fn) => fn === 'project-memory-embed' ? manifest(['a1', 'a2', 'a3']) : { data: null, error: null };
  const ni = await RUN.findSweepSheets({ projectId: P, sheets: S, targets: [target('egress')], userId: 'u', monthlyCap: 10 });
  ok('no sheet indexed → needs_index, and no search is spent', ni.state === 'needs_index');
  invokeHandler = async (fn) => fn === 'project-memory-embed' ? manifest([]) : refusal('tier_required', 'This feature requires pro or business or enterprise or higher.');
  const tr = await RUN.findSweepSheets({ projectId: P, sheets: S, targets: [target('egress')], userId: 'u', monthlyCap: 10 });
  ok('tier_required stops with the function\'s sentence and no lists', tr.state === 'refused' && /requires pro/.test(tr.message));
  invokeHandler = async (fn) => fn === 'project-memory-embed' ? manifest([]) : { data: { success: true, matches: [match('a1', 0.9), match('a2', 0.8)] }, error: null };
  rpcHandler = async () => ({ data: null, error: { message: 'offline' } });
  const rf = await RUN.findSweepSheets({ projectId: P, sheets: S, targets: [target('egress')], userId: 'u', monthlyCap: 10 });
  ok('an unreadable allowance is not "0 used": limit = min(6, cap), flagged', rf.state === 'ready' && rf.allowance.readFailed && rf.allowance.limit === 6 && rf.allowance.remaining === null);

  if (rf.state === 'ready') {
    let calls = 0;
    const scoped: unknown[] = [];
    reviewHandler = async (opts) => {
      calls++; scoped.push(opts.sweep);
      if (calls === 2) throw new PlanCodeErrorStub('Plan review call failed: cap', 'monthly_cap_reached', 'Monthly plan-review limit reached (10 on pro). Resets on the 1st.');
      return { findings: [{ requirement: 'r' }], disclaimer: '' };
    };
    const three = [...rf.selected, { sheet: sheet('a3', 'A-301'), score: 0.6, reasons: [{ topic: 'egress', snippet: 's' }] }];
    const b = await RUN.reviewSweepSheets({ selected: three, limit: 6 });
    ok('stage B sends each sheet its own matched topics as sweep.scopeTargets, and asks for the code-card rows', JSON.stringify(scoped[0]) === '{"scopeTargets":["egress"],"codeCards":true}');
    ok('monthly_cap_reached mid-run stops the loop', calls === 2 && b.reviewed.length === 1);
    ok('…and the rest are listed as not reviewed with the monthly-limit reason',
      b.notReviewed.length === 2 && b.notReviewed.every(x => x.why === 'Your monthly plan-review limit was reached — not reviewed'));
    reviewHandler = async () => ({ findings: [], disclaimer: '' });
    const img = await RUN.reviewSweepSheets({ selected: [{ sheet: sheet('bx', 'A-900', { imageUri: 'https://x.test/broken.png' } as Partial<Sheet>), score: 1, reasons: [] }], limit: 6 });
    ok('an unreadable image is not reviewed, and says so', img.notReviewed[0]?.why === "The sheet image couldn't be read — not reviewed");
  }
  invoked.length = 0;
}

// ── 7. Copy and persistence ───────────────────────────────────────────────
console.log('\n7. the words on the panel, and nothing saved');
{
  const strings: string[] = [];
  for (const v of Object.values(PS.sweepCopy)) {
    if (typeof v === 'string') strings.push(v);
    else if (typeof v === 'function') {
      for (const args of [['A-201', 2, 5], [1, 1], [3, 9], ['The model timed out.']]) {
        try { strings.push(String((v as (...a: unknown[]) => unknown)(...args))); } catch { /* wrong arg type for this one */ }
      }
    }
    else if (v && typeof v === 'object') strings.push(...Object.values(v as Record<string, string>));
  }
  const badCopy = strings.filter(s => PS.FORBIDDEN_WORDS.test(s) || BAD.test(s));
  ok(`every sweepCopy string (${strings.length}) is free of verdict words`, badCopy.length === 0, badCopy.join(' | '));
  const panel = code('components/plans/PlanSweepPanel.tsx');
  const literals = [...panel.matchAll(/'([^'\n]*)'|`([^`\n]*)`|>([^<>{}\n]+)</g)].map(m => (m[1] ?? m[2] ?? m[3] ?? '').trim()).filter(Boolean);
  const badLit = literals.filter(s => PS.FORBIDDEN_WORDS.test(s) || BAD.test(s));
  ok(`every text literal in PlanSweepPanel.tsx (${literals.length}) is free of verdict words`, badLit.length === 0, badLit.join(' | '));
  const cta = read('app/plans.tsx');
  ok('the Plans CTA and its sheet say neither', !BAD.test('Sweep plans for code questions Picks the sheets that matter for your scope') && /testID="plansweep-cta"/.test(cta));
  for (const f of ['components/plans/PlanSweepPanel.tsx', 'utils/plans/planSweepRun.ts', 'utils/plans/planSweep.ts']) {
    ok(`${f} persists nothing (no AsyncStorage / localStorage)`, !/AsyncStorage|localStorage/.test(code(f)));
  }
  ok('planSweep.ts is pure (no React, no supabase, no storage)', !/from 'react'|from 'react-native'|@\/lib\/supabase/.test(code('utils/plans/planSweep.ts')));
  ok('the panel makes no call on mount (no useEffect runs a find or a review)',
    !/useEffect\([^)]*(findSweepSheets|reviewSweepSheets|functions\.invoke|rpc\()/.test(panel.replace(/\n/g, ' ').replace(/useEffect\(\(\) => \(\) => \{[^}]*\}, \[\]\)/, '')));
  ok('the sweep modal is mounted only while open', /\{sweepOpen \? \(\s*<Modal visible=\{sweepOpen\}/.test(cta));
}

// ── 8. A finding → a punch item (list-3 lane FB) ──────────────────────────
console.log('\n8. "Add punch item": open, unassigned, pinned only where the AI placed it');
{
  const nj = resolveCodeJurisdiction({ city: 'Hoboken', state: 'NJ' });
  const A2 = sheet('a2', 'A-201');
  const base = PS.sweepFindingView({
    category: 'egress', codeRef: 'IRC R310.1', requirement: 'r', observed: 'o', severity: 'high', confidence: 'med',
    question: 'Does the bedroom 2 window meet the egress opening size?', location: { x: 0.25, y: 0.75 },
  }, A2, nj);
  // A view whose title still carries the model's verdict word — the punch
  // builder must neutralise on its own, not trust its caller.
  const raw = { ...base, title: 'Window violates R310 egress at bedroom 2' };
  const pinned = PS.punchFromSweepFinding(A2, raw, 'pid-1', '2026-09-26T12:00:00.000Z');
  ok('status open, unassigned, no due date, medium, on the punch list',
    pinned.status === 'open' && pinned.assignedSub === '' && pinned.dueDate === '' && pinned.priority === 'medium' && pinned.listType === 'punch');
  ok('id, project and both timestamps are the caller\'s', pinned.id === 'pid-1' && pinned.projectId === P
    && pinned.createdAt === '2026-09-26T12:00:00.000Z' && pinned.updatedAt === pinned.createdAt);
  ok('placed → the pin fields are the AI\'s spot on this sheet', pinned.planSheetId === 'a2' && pinned.pinX === 0.25 && pinned.pinY === 0.75);
  ok('placed → the location says the spot is approximate', /approximate/.test(pinned.location) && /^A-201/.test(pinned.location), pinned.location);
  ok('"violates" is gone from the description and R310 is kept',
    !/violates/i.test(pinned.description) && /R310/.test(pinned.description) && !PS.FORBIDDEN_WORDS.test(pinned.description), pinned.description);
  ok('the description names the sheet', pinned.description.startsWith('Check on A-201: '), pinned.description);
  const unplaced = PS.punchFromSweepFinding(A2, { ...base, location: null }, 'pid-2', '2026-09-26T12:00:00.000Z');
  ok('not placed → NO pin fields at all (never an invented spot)',
    !('planSheetId' in unplaced) && !('pinX' in unplaced) && !('pinY' in unplaced), JSON.stringify(unplaced));
  ok('not placed → the location is the sheet alone, never "approximate"', unplaced.location === 'A-201');
  const long = PS.punchFromSweepFinding(A2, { ...base, title: 'x'.repeat(400) }, 'pid-3', 'n');
  ok('the description is clipped to 240', long.description.length <= 240, String(long.description.length));
  const extra = [PS.sweepCopy.addPunch, PS.sweepCopy.punchAddedPinned, PS.sweepCopy.punchAddedNoPin, PS.sweepCopy.approxNote];
  ok('the four new strings exist and are free of verdict words',
    extra.every(x => typeof x === 'string' && x.length > 0 && !PS.FORBIDDEN_WORDS.test(x) && !BAD.test(x)), extra.join(' | '));
  ok('both "added" lines end in the Open punch list link words', extra.slice(1, 3).every(x => x.endsWith('Open punch list')));
  ok('the approximate note says the AI estimates the spot', /approximate/.test(PS.sweepCopy.approxNote) && /AI estimates/.test(PS.sweepCopy.approxNote));
  const panel = code('components/plans/PlanSweepPanel.tsx');
  ok('the panel adds the drawing pin only inside `if (view.location)` with kind punch and the link back',
    /if \(view\.location\) \{\s*addDrawingPin\(\{[^}]*kind: 'punch'[^}]*linkedPunchItemId: punch\.id/.test(panel));
  ok('the punch action is idempotent per finding key', /if \(punchedRef\.current\[key\]\) return;/.test(panel));
  ok('the punch button carries the finding key testID', /testID=\{`plansweep-punch-\$\{key\}`\}/.test(panel));
}

// ── 9. Spanish verdict words (docs/I18N.md §7.6, wave-next I18NWIRE) ─────
// mageAI sends locale 'es' when the app language is Spanish, so the model's
// words can arrive in Spanish. The filter must catch Spanish verdicts, with
// Unicode-aware boundaries (JS \b treats ó as a non-word character), and must
// not change a single English decision.
console.log('\n9. Spanish verdict words: caught, neutralised, English unchanged');
{
  const F = PS.FORBIDDEN_WORDS;
  const esPositives = [
    'viola el código', 'Esto viola la sección R310', 'VIOLA', 'violan', 'violación', 'Violación del código',
    'violaciones', 'violado', 'no cumple', 'La baranda no cumple con R312', 'no  cumplen', 'NO CUMPLE',
    'incumple', 'incumplen', 'incumplimiento', 'ilegal', 'ilegales', 'Es ILEGAL', 'ilegalmente',
    'infracción', 'infraccion', 'INFRACCIÓN', 'infracciones', '(infracción)', 'infracción.', '¿viola?', '«ilegal»',
  ];
  const esMissed = esPositives.filter(s => !F.test(s));
  ok(`every Spanish verdict spelling is caught (${esPositives.length})`, esMissed.length === 0, esMissed.join(' | '));
  // Accented-boundary cases: an accented letter is part of the word, never a boundary.
  const esNegatives = [
    'cumple con R311', 'cumple', 'no cumplir', 'cumplimiento del código', 'violeta', 'víolación',
    'aviolación', 'ñviola', 'áinfracción', 'legal', 'ilegible', 'desinfracción', 'reviola', 'sinviolación', 'éilegal',
  ];
  const esFalse = esNegatives.filter(s => F.test(s));
  ok(`words that only contain a stem, or an accented letter at the edge, are not caught (${esNegatives.length})`, esFalse.length === 0, esFalse.join(' | '));
  ok('the \\b trap is real: JS \\b sees a boundary between ñ and v, the lookbehind does not',
    /\bviola/i.test('ñviola') && !F.test('ñviola'));
  ok('an accented letter after a stem is part of the same word (infracciónes, ilegalé are caught)', F.test('infracciónes') && F.test('ilegalé'));
  // English regressions: the original list decides exactly as before.
  const EN_OLD = /\b(violat\w*|non-?compliant|fails? code|illegal|code violation)\b/i;
  const enCases = [
    'It violated the rule', 'VIOLATION OF R302', 'noncompliant with R311', 'non-compliant', 'The stair fails code',
    'fail code', 'in violation of section 5', 'Violating', 'violationish', 'illegal', 'Illegal stair', 'code violation',
    'comply with R311', 'compliance', 'legal', 'failed code', 'fails codes', 'unviolated', 'illegally', 'a question for the architect',
    'Confirm: guard height 42 in', 'May conflict with R310', 'possibly not permitted', 'possible conflict',
  ];
  const enDiff = enCases.filter(s => EN_OLD.test(s) !== F.test(s));
  ok(`every English case decides exactly as the original list (${enCases.length})`, enDiff.length === 0, enDiff.join(' | '));
  // The pre-Spanish neutraliser, verbatim (planSweep.ts before wave-next), as
  // the oracle: on English text the new one must give the same bytes.
  const NEUTRAL_OLD: [RegExp, string][] = [
    [/\b(?:is|are|was|were)\s+in\s+violation\s+of\b/gi, 'may conflict with'],
    [/\bin\s+violation\s+of\b/gi, 'possibly in conflict with'],
    [/\bcode\s+violations\b/gi, 'possible code conflicts'],
    [/\bcode\s+violation\b/gi, 'possible code conflict'],
    [/\bviolations?\s+of\b/gi, 'possible conflict with'],
    [/\bviolat(?:es|e|ed|ing)\b/gi, 'may conflict with'],
    [/\bviolations\b/gi, 'possible conflicts'],
    [/\bviolation\b/gi, 'possible conflict'],
    [/\bnon-?compliant\s+with\b/gi, 'possibly not meeting'],
    [/\bnon-?compliant\b/gi, 'possibly not meeting the requirement'],
    [/\bfails?\s+code\b/gi, 'may not meet code'],
    [/\billegal\b/gi, 'possibly not permitted'],
    [/\bviolat\w*/gi, 'possible conflict'],
  ];
  const neutralOld = (x: string) => {
    let out = x;
    for (const [re, r] of NEUTRAL_OLD) out = out.replace(re, (m: string) => (/^[A-Z]/.test(m) ? r[0].toUpperCase() + r.slice(1) : r));
    while (EN_OLD.test(out)) out = out.replace(EN_OLD, 'possible conflict');
    return out.replace(/\s+/g, ' ').trim();
  };
  // "viola" is a word English text can carry (a street, a person, the
  // instrument): in English it must come through untouched (integration fix).
  const violaEn = [
    'Guardrail at the Viola Ave entrance is 36 in; IBC 1015.3 requires 42 in.',
    'Title block lists Viola Chen, PE, as engineer of record.', 'The viola player', 'VIOLA', 'viola el código',
    'Viola Ave violates R312', 'no cumple', 'ilegal infracción',
  ];
  const enSamples = [
    ...enCases, 'The guard IS IN VIOLATION OF R312', 'code violations at 3 doors', 'violations of section 4',
    'Non-compliant with the stair rule; fails code', 'ILLEGAL and violatory', '  spaced   out  violation  ',
    'Window at bedroom 2 is 48 in above the floor. Confirm the sill height.', '', ...violaEn,
  ];
  // Both ways in: the explicit 'en' and the default (the app language, 'en'
  // while the picker is hidden).
  I18N.setLang('en');
  const enChanged = enSamples.filter(x => PS.neutralizeModelText(x, 'en') !== neutralOld(x) || PS.neutralizeModelText(x) !== neutralOld(x));
  ok(`English neutralised text is byte-identical to the original neutraliser, "viola" included (${enSamples.length})`, enChanged.length === 0,
    enChanged.map(x => `${x} → ${PS.neutralizeModelText(x, 'en')} vs ${neutralOld(x)}`).join(' | '));
  eq('"Viola Ave" and "Viola Chen" are unchanged in English',
    violaEn.slice(0, 2).map(x => PS.neutralizeModelText(x)), violaEn.slice(0, 2));
  ok('English output never carries an English verdict word',
    enSamples.every(x => !EN_OLD.test(PS.neutralizeModelText(x, 'en'))));
  const enView = PS.sweepFindingView({
    category: 'guards', codeRef: 'IBC 1015.3', citedEdition: 'IBC 2018', section: '1015.3',
    requirement: 'Guards 42 in minimum', observed: 'Guardrail at the Viola Ave entrance is 36 in',
    severity: 'high', confidence: 'med', question: 'Does the Viola Ave guard need to be 42 in?', location: null,
  }, sheet('en1', 'A-502'), resolveCodeJurisdiction({ city: 'Hoboken', state: 'NJ' }));
  ok('an English finding view keeps "Viola Ave" (the panel and the RFI draft read this)',
    /Viola Ave/.test(enView.observed) && /Viola Ave/.test(enView.title) && !/Podría/.test(enView.observed + enView.title), JSON.stringify([enView.title, enView.observed]));
  // In Spanish neutralizeModelText guarantees its output never matches — Spanish included.
  const esN = (x: string) => PS.neutralizeModelText(x, 'es');
  const esSamples = [
    'Esto viola el código IRC R310', 'La escalera viola la sección 5', 'Violación del código', 'infracciones de la norma',
    'La baranda no cumple con R312', 'no cumplen', 'Es ilegal', 'Son ilegales', 'incumplimiento del código',
    'El muro incumple R302', 'violaciones', 'ilegalmente instalado', 'viola viola viola', 'It violates and viola el código',
  ];
  const esLeft = esSamples.map(esN).filter(s => F.test(s));
  ok(`neutralizeModelText clears every Spanish verdict (${esSamples.length})`, esLeft.length === 0, esLeft.join(' | '));
  eq('a Spanish verdict the phrase table misses still gets SPANISH filler (the Spanish belt)',
    esN('Fue instalado ilegalmente'), 'Fue instalado posible conflicto');
  // Grammar (review, fix round 1): the feminine article goes with the noun,
  // plural subjects keep plural verbs, participles keep gender and number.
  const grammar: [string, string][] = [
    ['La violación del código IBC', 'El posible conflicto con el código IBC'],
    ['La infraccion de seguridad', 'El posible conflicto con seguridad'],
    ['Revise las infracciones del plano', 'Revise los posibles conflictos con el plano'],
    ['antes de la violación', 'antes del posible conflicto'],
    ['Una infracción', 'Un posible conflicto'],
    ['ESTA VIOLACIÓN', 'Este posible conflicto'],
    ['código violado', 'código posiblemente no respetado'],
    ['la norma violada', 'la norma posiblemente no respetada'],
    ['El muro fue violado', 'El muro fue posiblemente no respetado'],
    ['Las paredes violan el código', 'Las paredes podrían no ajustarse al código'],
    ['Las barandas no cumplen con R312', 'Las barandas podrían no cumplir con R312'],
    ['Los muros incumplen R302', 'Los muros podrían no cumplir R302'],
    ['El muro incumple R302', 'El muro podría no cumplir R302'],
    ['Esto viola.', 'Esto podría no ajustarse.'],
    ['puede violar el código', 'puede no ajustarse al código'],
  ];
  const badGrammar = grammar.filter(([x, want]) => esN(x) !== want);
  ok(`Spanish neutralised text keeps article, number and gender (${grammar.length})`, badGrammar.length === 0,
    badGrammar.map(([x, w]) => `${x} → ${esN(x)} (want ${w})`).join(' | '));
  ok('…and none of the grammar outputs carries a verdict word', grammar.every(([x]) => !F.test(esN(x))));
  // In Spanish "viola" is always the verb: the hard gate wins over the noun.
  eq('in Spanish, "viola el código" is neutralised', esN('viola el código'), 'podría no ajustarse al código');
  ok('in Spanish, no output of the English "viola" samples carries a verdict word', violaEn.every(x => !F.test(esN(x))));
  eq('Spanish verdicts become possibilities (samples)',
    ['Esto viola el código IRC R310', 'La baranda no cumple con R312', 'Violación del código', 'Es ilegal'].map(esN),
    ['Esto podría no ajustarse al código IRC R310', 'La baranda podría no cumplir con R312', 'Posible conflicto con el código', 'Es posiblemente no permitido']);
  ok('FORBIDDEN_WORDS has no g flag (test() stays stateless) and is Unicode-aware', !F.global && F.unicode && F.ignoreCase);
  // The view follows the app language (the default argument): Spanish on.
  I18N.setLang('es');
  const view = PS.sweepFindingView({
    category: 'egress', codeRef: 'IRC R310.1 — la ventana viola la salida', citedEdition: 'IRC 2018', section: 'R310.1',
    requirement: 'La ventana no cumple con R310', observed: 'Infracción del código en el dormitorio 2; antepecho ilegal', severity: 'high', confidence: 'med',
    question: '¿Esto incumple R310?', location: { x: 0.1, y: 0.1 },
  }, sheet('es1', 'A-501'), resolveCodeJurisdiction({ city: 'Hoboken', state: 'NJ' }));
  const vf = [view.title, view.observed, view.requirement, view.citation];
  ok('a Spanish finding\'s view carries no verdict word in any model field', vf.length > 0 && vf.every(f => !F.test(f)), JSON.stringify(vf));
  const esRfi = PS.rfiFromSweepFinding(sheet('es1', 'A-501'), view, new Date(2026, 8, 26, 18), null);
  ok('…and neither does its RFI draft', !F.test(esRfi.question) && !F.test(esRfi.subject), esRfi.question);
  I18N.setLang('en');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
