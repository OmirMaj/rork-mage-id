// validate-code-copyright-prompts.ts — content rights, 2026-10-03.
//
// A third-party-rights review found MAGE ID's AI could reproduce copyrighted
// model building-code text (ICC, NFPA) word for word. Facts, section numbers,
// links and government text are fine; long verbatim quotes are the exposure.
// The fix is prompt rules on the SERVER, so they hold for every installed
// build. This guard pins each one:
//
//   [1] construction-answer: HONESTY CONTRACT rule 7 (COPYRIGHT) sits right
//       after rule 6, inside SYSTEM; the sources stay title + link only (no
//       cited_text anywhere in the function)
//   [2] analyze-plan-code: buildPrompt — run, not grepped — carries the
//       paraphrase rule on every path (bare, jurisdiction, sweep), and both
//       schema hints ask for the requirement "paraphrased in your own words"
//   [3] analyze-photos: CODE_LOOK_PROMPT carries the rule as one of its Rules
//   [4] ai relay: the rule is appended to the system prompt for ai_code_check
//       (Code Check, its drill-in, Inspection Ready's recall group) and for
//       nothing else, before the reply-language rule
//
// THE OTHER HALF (2026-10-04). Those rules told the AI what NOT to write and
// nothing told it that a number is a fact, so answers went vague ("guards may
// be required at certain heights"). The legal line did not move: the code's
// SENTENCES are never reproduced; a required dimension, a count, a threshold
// and a section number are facts and are always stated, a recalled one
// LABELLED as recall. This guard pins that half too:
//
//   [5] the specifics rule is one sentence, the same on the phone
//       (SPECIFICS_RULE), in the ai relay (ai_code_check only) and in
//       analyze-plan-code (every path); construction-answer rule 1 tells the
//       model to state the figure and label an unretrieved one as recall (it
//       no longer tells it to leave the figure out), and its cards call keeps
//       the number in the summary; no prompt forbids a figure
//
// Run: bun run scripts/validate-code-copyright-prompts.ts

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// tsc type-checks scripts/ with the app's lib set, which has no Bun global.
declare const Bun: {
  Transpiler: new (o: { loader: 'ts' }) => { transformSync(src: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); }
}

/** The one-sentence rule every code-requirement prompt carries. */
const RULE = 'Write every requirement in your own words. Never quote or reproduce the text of any model code (ICC, NFPA) word for word.';
/** construction-answer's longer rule: it reads web pages, so it caps the quote. */
const RULE_7 = '7. COPYRIGHT: Never reproduce more than a short phrase (about 25 words) word for word from any retrieved web page. Never reproduce a whole code section, table, span chart or figure caption. State the figure or requirement in your own words, give the section number, and let the cited source link carry the full text.';

// ── [1] construction-answer ─────────────────────────────────────────────
console.log('\n[1] construction-answer: HONESTY CONTRACT rule 7');
{
  const src = read('supabase/functions/construction-answer/index.ts');
  const sysM = /const SYSTEM = `([\s\S]*?)`;/.exec(src);
  ok('the function has its SYSTEM prompt', !!sysM);
  const sys = sysM?.[1] ?? '';
  ok('SYSTEM carries rule 7 (COPYRIGHT), word for word', sys.includes(RULE_7));
  const r6 = sys.indexOf('\n6. Retrieved web pages');
  const r7 = sys.indexOf(`\n${RULE_7}\n`);
  const contract = sys.indexOf('HONESTY CONTRACT (non-negotiable):');
  const after = sys.indexOf('\nBe concise and practical.');
  ok('rule 7 is inside the HONESTY CONTRACT, straight after rule 6',
    contract >= 0 && r6 > contract && r7 > r6 && after > r7 && !sys.slice(r6 + 1, r7).includes('\n'),
    `contract=${contract} r6=${r6} r7=${r7} after=${after}`);
  ok('rules 1-6 are all still there', [1, 2, 3, 4, 5, 6].every(n => sys.includes(`\n${n}. `)));
  const dir = 'supabase/functions/construction-answer';
  const files = readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.ts'));
  ok('no file in the function carries cited_text (sources stay title + link)',
    files.length > 0 && files.every(f => !/cited_text/.test(read(`${dir}/${f}`))));
}

// ── [2] analyze-plan-code ───────────────────────────────────────────────
console.log('\n[2] analyze-plan-code: the paraphrase rule on every prompt path');
{
  const src = read('supabase/functions/analyze-plan-code/index.ts');
  const m = src.match(/\/\/ <pure:planPrompt>\n([\s\S]*?)\/\/ <\/pure:planPrompt>/);
  ok('the prompt is still a pure block', !!m);
  let buildPrompt: ((r: Record<string, unknown>) => string) | null = null;
  if (m) {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${m[1]}\nmodule.exports = { buildPrompt };`);
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', js)(mod, mod.exports);
    buildPrompt = mod.exports.buildPrompt as (r: Record<string, unknown>) => string;
  }
  const base = { imageBase64: 'x', mimeType: 'image/png' };
  const juris = { ...base, location: 'Hoboken, NJ', projectType: 'renovation', jurisdictionBlock: 'Adopted: IRC 2021 (NJ UCC)' };
  const reqs: Array<[string, Record<string, unknown>]> = [
    ['Plan Review, no jurisdiction', base],
    ['Plan Review, adopted edition', juris],
    ['Plan Set Code Sweep', { ...juris, sweep: { scopeTargets: ['Basement egress window'] } }],
  ];
  const HINT = '"requirement":"what code requires, paraphrased in your own words"';
  for (const [name, r] of reqs) {
    const p = buildPrompt ? buildPrompt(r) : '';
    ok(`${name}: the prompt carries the rule`, p.includes(RULE));
    ok(`${name}: the schema asks for the requirement paraphrased`, p.includes(HINT) && !p.includes('"requirement":"what code requires"'));
  }
  ok('both schema hints in the source carry the paraphrase', (src.split(HINT).length - 1) === 2);
}

// ── [3] analyze-photos (Photo code check) ───────────────────────────────
console.log('\n[3] analyze-photos: CODE_LOOK_PROMPT');
{
  const src = read('supabase/functions/analyze-photos/index.ts');
  const m = /const CODE_LOOK_PROMPT = `([\s\S]*?)`;/.exec(src);
  ok('the function has CODE_LOOK_PROMPT', !!m);
  const p = m?.[1] ?? '';
  ok('it carries the rule as one of its Rules', p.includes(`\n- ${RULE}\n`) && p.indexOf(RULE) > p.indexOf('Rules:'));
}

// ── [4] ai relay (Code Check) ───────────────────────────────────────────
console.log('\n[4] ai relay: the rule rides on ai_code_check only');
{
  const src = read('supabase/functions/ai/index.ts');
  const m = /const sys = ("[^"\n]*")([\s\S]*?)\+ replyLanguageRule\(body\.locale\);/.exec(src);
  ok('the relay builds sys and ends it with the reply-language rule', !!m);
  const tail = m?.[2] ?? '';
  const COND = `+ (feature === "ai_code_check" ? " ${RULE}" : "")`;
  ok('sys appends the rule when feature === "ai_code_check", and "" otherwise', tail.includes(COND));
  ok('the rule appears once in the relay, only in that conditional', src.split(RULE).length - 1 === 1);
  ok('the base system sentence never carries the rule (every other feature unchanged)', !(m?.[1] ?? RULE).includes(RULE));
  ok('the relay still reads feature before building sys', src.indexOf('const feature = rawFeature || "general";') >= 0
    && src.indexOf('const feature = rawFeature || "general";') < src.indexOf('const sys = '));
}

// ── [5] the number is a fact: stated, and labelled when it is recall ────
console.log('\n[5] the specifics rule: the number is stated; recall is labelled, never left out');
{
  const SPECIFICS = 'Be specific: state the required number with its unit and the condition that triggers it, for example a guard at least 36 in. high where the drop is more than 30 in. Numbers, dimensions, counts, thresholds and section numbers are facts, not code text, so always state them. A figure from your own recall is still stated: the app marks it as AI recall to confirm with the building department. Never leave a number out or answer vaguely to avoid quoting.';
  const RULE_1 = '1. LEAD WITH THE SPECIFIC FIGURE. State the number with its unit, the condition that triggers it and the section number, in one or two plain sentences (for example: Guards have to be at least 36 in. high where the walking surface is more than 30 in. above grade, IRC R312.1). Retrieve every authoritative code/spec figure (a section number, an allowable span, a minimum dimension, a load figure, a fastener schedule, a fire rating) with the web_search tool in THIS conversation whenever you can. When you could not retrieve a figure this turn, STILL state the figure you recall, and label it in the same sentence as AI recall that the building department has to confirm. Never leave a number out, and never answer vaguely, because it was not retrieved; never present a recalled figure as retrieved. Do not invent a section number or a span table value you do not actually know: say that you do not know it.';
  const phone = read('utils/codeCard/echoCheck.ts');
  ok('the phone exports the specifics rule, word for word, once', phone.includes(`export const SPECIFICS_RULE = \`${SPECIFICS}\`;`) && phone.split(SPECIFICS).length === 2);
  ok('the rule asks for the number, its unit and its trigger; says numbers and section numbers are facts; has recall stated and labelled; forbids going vague; and carries no quotation mark',
    /state the required number with its unit and the condition that triggers it/.test(SPECIFICS) && /Numbers, dimensions, counts, thresholds and section numbers are facts, not code text, so always state them\./.test(SPECIFICS)
      && /A figure from your own recall is still stated: the app marks it as AI recall to confirm with the building department\./.test(SPECIFICS)
      && /Never leave a number out or answer vaguely to avoid quoting\./.test(SPECIFICS) && !/["'`]/.test(SPECIFICS));
  const relay = read('supabase/functions/ai/index.ts');
  const tail = /const sys = ("[^"\n]*")([\s\S]*?)\+ replyLanguageRule\(body\.locale\);/.exec(relay)?.[2] ?? '';
  const code = tail.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok('ai relay: the specifics rule rides on ai_code_check only, straight after the no-verbatim rule and before the reply-language rule',
    code.replace(/\s+/g, ' ').includes(`+ (feature === "ai_code_check" ? " ${RULE}" : "") + (feature === "ai_code_check" ? " ${SPECIFICS}" : "")`)
      && relay.split(SPECIFICS).length === 2);
  const plan = read('supabase/functions/analyze-plan-code/index.ts');
  ok('analyze-plan-code: the specifics rule is one line of the prompt, in the pure block', plan.split(`    "${SPECIFICS}",\n`).length === 2
    && (plan.match(/\/\/ <pure:planPrompt>\n([\s\S]*?)\/\/ <\/pure:planPrompt>/)?.[1] ?? '').includes(SPECIFICS));
  const ask = read('supabase/functions/construction-answer/index.ts');
  const sys = /const SYSTEM = `([\s\S]*?)`;/.exec(ask)?.[1] ?? '';
  ok('construction-answer rule 1: state the figure (number, unit, trigger, section); retrieve it when possible; a figure not retrieved is STILL stated and labelled AI recall; never invented', sys.includes(`\n${RULE_1}\n2. CITE every authoritative claim.`));
  ok('…and rule 1 no longer tells the model to leave an unretrieved figure out', !/NEVER state a specific building-code section number|treat this as general guidance/.test(sys));
  ok('…while the label stays: VERIFIED is "yes" only if every figure was retrieved this turn (anything else shows the confirm banner)',
    sys.includes('VERIFIED: yes    (use "yes" only if every authoritative code/spec figure in your answer was retrieved via web_search this turn; otherwise "no")')
      && /never present a recalled figure as retrieved/.test(RULE_1) && /Do not invent a section number or a span table value you do not actually know/.test(RULE_1));
  const cards = read('supabase/functions/construction-answer/codeCardRequirements.ts');
  ok('the cards call keeps the number: a summary states the number the answer states, with its unit; and it still restates ONLY the answer',
    cards.includes('"When the answer states a number for the requirement, the summary states that number with its unit, and the condition that triggers it when it fits. A number, a dimension, a count and a section number are facts, not code text: never leave them out of a card.",')
      && cards.includes('"Use ONLY what the answer below states. Never add a requirement, a section number, an edition, a dimension or any other figure that the answer does not state.'));
  const prompts = [
    ['app/(tabs)/construction-ai/index.tsx', read('app/(tabs)/construction-ai/index.tsx')], ['utils/inspectionPrep.ts', read('utils/inspectionPrep.ts')],
    ['supabase/functions/ai/index.ts', relay], ['supabase/functions/analyze-plan-code/index.ts', plan], ['construction-answer SYSTEM', sys], ['construction-answer cards call', cards],
  ];
  const FORBIDS = /Never state a dimension|when you are confident of them|read the figure in the adopted code|NEVER state a specific building-code section number/;
  const bad = prompts.filter(([, t]) => FORBIDS.test(t.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'))).map(([n]) => n);
  ok('no code prompt tells the AI to hold a figure back', bad.length === 0, bad.join(', '));
  ok('…and the no-verbatim rule is still in every one of them (the legal line did not move)',
    relay.includes(RULE) && plan.includes(RULE) && cards.includes(RULE) && sys.includes(RULE_7)
      && read('app/(tabs)/construction-ai/index.tsx').split(RULE).length === 3 && read('utils/inspectionPrep.ts').includes(RULE));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
