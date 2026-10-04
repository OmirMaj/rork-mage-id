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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
