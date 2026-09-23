// scripts/validate-w5-ai-limits-construction.ts — Construction Answers' errors
// say what happened, and its Sources are only what the answer used.
//
// #121: every failure (no signal, a stalled request, a 5xx) used to read
// "Construction Answers isn't available yet." — as if the feature weren't built
// — and with no timeout the "Researching…" spinner could run forever. Now four
// codes, four sentences; "not available yet" only for a 503 not_configured;
// a 120 s AbortController; Try again for the retryable ones.
//
// #120: "Sources" listed everything the engine looked at — every open RFI, up
// to 60 rate categories, every web result, and the six most recent plan sheets
// when the plan search matched nothing. Now splitCitations keeps only what the
// final answer used and moves the rest to `consulted` ("Also checked").
//
// Run: bun run scripts/validate-w5-ai-limits-construction.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapConstructionAnswerFailure, mapConstructionAnswerThrow, isRetryableConstructionError,
  CONSTRUCTION_ANSWER_COPY, ANSWER_TIMEOUT_MS, MAX_QUESTION_CHARS, consultedSummary,
} from '../utils/constructionAnswer';
import {
  splitCitations, webCitationsFromTextBlocks, planSearchTerms, type FilterCitation,
} from '../supabase/functions/construction-answer/citationFilter';

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `\n     ${extra}` : ''); }
}

const NOT_YET = "isn't available yet";

console.log('\n#121 — error mapping');
{
  const e = mapConstructionAnswerFailure(503, { error: 'not_configured' });
  ok('503 { error: not_configured } → not_configured', e.code === 'not_configured');
  ok('…and ONLY that says "isn\'t available yet"', e.message.includes(NOT_YET));
}
for (const [status, body] of [[500, { error: 'Internal error' }], [502, null], [503, { error: 'Service Unavailable' }], [504, {}], [404, null]] as const) {
  const e = mapConstructionAnswerFailure(status, body);
  ok(`${status} ${JSON.stringify(body)} → server_error, never "not available yet"`,
    e.code === 'server_error' && !e.message.includes(NOT_YET), `${e.code}: ${e.message}`);
}
// A 400 is the function refusing THIS question — retrying it fails the same
// way forever, so it is never server_error-with-Try-again (review round 1).
{
  const long = mapConstructionAnswerFailure(400, { error: 'Question too long' });
  ok('400 "Question too long" → bad_request, says shorten it', long.code === 'bad_request' && /too long/.test(long.message) && /4,000/.test(long.message), `${long.code}: ${long.message}`);
  const bad = mapConstructionAnswerFailure(400, { error: 'Invalid JSON body' });
  ok('400 "Invalid JSON body" → bad_request', bad.code === 'bad_request' && !bad.message.includes(NOT_YET));
  ok('bad_request gets no Try again', !isRetryableConstructionError('bad_request'));
  ok('the input caps at the server\'s 4,000-char limit', MAX_QUESTION_CHARS === 4000);
}
{
  const e = mapConstructionAnswerFailure(403, { code: 'tier_required' });
  ok('403 tier_required → needs_business', e.code === 'needs_business');
  const u = mapConstructionAnswerFailure(401, { code: 'unauthenticated' });
  ok('401 → unauthenticated', u.code === 'unauthenticated');
  // 3:00 PM in New York on Sep 23 2026 — the counter rolls at 00:00 UTC Oct 1.
  const at = new Date(Date.UTC(2026, 8, 23, 19, 0, 0));
  const c = mapConstructionAnswerFailure(429, {
    error: 'monthly_cap', code: 'monthly_cap',
    message: 'Monthly Construction Answers limit reached (10/mo on business). Resets the 1st (UTC).',
  }, at);
  ok('429 monthly_cap → limit_reached with the server sentence', c.code === 'limit_reached' && c.message.startsWith('Monthly Construction Answers limit reached (10/mo on business).'));
  ok('…with the reset moment in the reader\'s clock, not "the 1st"', !/the 1st/.test(c.message) && /Resets (Sep 30|Oct 1)/.test(c.message), c.message);
}
{
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  ok('fetch aborted by our timer → timeout', mapConstructionAnswerThrow(abort, true).code === 'timeout');
  ok('AbortError alone → timeout', mapConstructionAnswerThrow(abort, false).code === 'timeout');
  const net = mapConstructionAnswerThrow(new TypeError('Network request failed'), false);
  ok('fetch rejected (no signal) → offline', net.code === 'offline');
  ok('offline copy says the question was not sent', /wasn't sent/.test(net.message) && !net.message.includes(NOT_YET));
  ok('timeout copy says it may still count', /may still count/.test(CONSTRUCTION_ANSWER_COPY.timeout));
}
ok('Try again for offline / timeout / server_error',
  ['offline', 'timeout', 'server_error'].every(isRetryableConstructionError));
ok('no Try again for not_configured / limit / tier / auth',
  !['not_configured', 'limit_reached', 'needs_business', 'unauthenticated'].some(isRetryableConstructionError));
ok('timeout is ~120 s, under the edge wall clock', ANSWER_TIMEOUT_MS >= 90_000 && ANSWER_TIMEOUT_MS < 150_000);

const client = read('utils/constructionAnswer.ts');
ok('client: fetch carries an AbortController signal', /signal: controller\.signal/.test(client) && /controller\.abort\(\)/.test(client));
ok('client: no "unavailable" catch-all code left',
  !/\| 'unavailable'/.test(client) && !/new ConstructionAnswerError\(\s*'unavailable'/.test(client));
ok('client: a thrown fetch is mapped by mapConstructionAnswerThrow', /throw mapConstructionAnswerThrow\(e, timedOut\)/.test(client));
ok('client: lib/supabase is imported lazily (pure top level)', !/^import .*@\/lib\/supabase/m.test(client) && /await import\('@\/lib\/supabase'\)/.test(client));

const ui = read('components/construction/AskConstructionMode.tsx');
ok('UI: no hard-coded "not available yet" fallback branch', !/Construction Answers isn&apos;t available yet/.test(ui));
ok('UI: renders the error\'s own message', /\{errMsg \|\| CONSTRUCTION_ANSWER_COPY\[/.test(ui));
ok('UI: Try again re-runs runAsk with the kept question', /isRetryableConstructionError\(errCode\)/.test(ui) && /testID="construction-ask-retry"/.test(ui) && /onPress=\{runAsk\}/.test(ui));
ok('UI: an untyped throw is server_error, not "unavailable"', /e instanceof ConstructionAnswerError \? e\.code : 'server_error'/.test(ui));
ok('UI: consulted records render muted under "Also checked", not Sources',
  /Also checked/.test(ui) && /result\.consulted/.test(ui));
ok('UI: the question input is capped at MAX_QUESTION_CHARS', /maxLength=\{MAX_QUESTION_CHARS\}/.test(ui));
ok('UI: "Also checked" goes through consultedSummary (capped)', /consultedSummary\(result\.consulted/.test(ui) && !/result\.consulted\.map\(c => c\.label\)\.join\(/.test(ui));
{
  const many = Array.from({ length: 60 }, (_, i) => `Rate ${i + 1}`);
  const line = consultedSummary(many);
  ok('"Also checked" names 8 and counts the rest', line.split(' · ').length === 9 && line.endsWith('+52 more'), line);
  ok('"Also checked" under the cap lists everything', consultedSummary(['A', 'B', 'A']) === 'A · B');
}

console.log('\n#120 — citation filter');
const collected: FilterCitation[] = [
  { label: 'Sheet A3', kind: 'plan', ref: 'uuid-a3' },
  { label: 'Sheet S1', kind: 'plan', ref: 'uuid-s1' },
  { label: 'RFI #12', kind: 'rfi', ref: '12' },
  { label: 'RFI #7', kind: 'rfi', ref: '7' },
  { label: 'Concrete rate', kind: 'rate', ref: 'Concrete' },
  { label: 'Framing Labor rate', kind: 'rate', ref: 'Framing Labor' },
  { label: 'Electrical Labor rate', kind: 'rate', ref: 'Electrical Labor' },
  { label: 'IRC R403.1', kind: 'web', url: 'https://codes.example/irc-r403' },
  { label: 'Random blog', kind: 'web', url: 'https://blog.example/footings' },
];
const answer = 'Per Sheet A3 your footings are 12" deep; RFI 12 confirmed the frost depth. At your concrete rate that pour is about $4,100. Framing labor is not affected.';
const cited = webCitationsFromTextBlocks([
  { type: 'text', text: 'Frost depth…', citations: [{ type: 'web_search_result_location', url: 'https://codes.example/irc-r403', title: 'IRC R403.1' }] },
  { type: 'text', text: 'no cites' },
  { type: 'server_tool_use' },
]);
ok('web citations come from the text blocks\' own citations', cited.length === 1 && cited[0].url === 'https://codes.example/irc-r403');
const split = splitCitations(answer, collected, cited);
const labels = split.citations.map(c => c.label);
const consulted = split.consulted.map(c => c.label);
ok('named sheet is a Source', labels.includes('Sheet A3'));
ok('unnamed sheet is only consulted', !labels.includes('Sheet S1') && consulted.includes('Sheet S1'));
ok('"RFI 12" in the answer → RFI #12 is a Source', labels.includes('RFI #12'));
ok('RFI #7 never mentioned → consulted', !labels.includes('RFI #7') && consulted.includes('RFI #7'));
ok('"RFI 12" does not cite a hypothetical RFI #1', !splitCitations('RFI 12', [{ label: 'RFI #1', kind: 'rfi', ref: '1' }], []).citations.length);
ok('rate named in the answer is a Source', labels.includes('Concrete rate'));
ok('"framing labor" cites Framing Labor, NOT every labor rate',
  labels.includes('Framing Labor rate') && !labels.includes('Electrical Labor rate'));
ok('cited web URL is a Source', labels.includes('IRC R403.1'));
ok('searched-but-uncited web result is only consulted', !labels.includes('Random blog') && consulted.includes('Random blog'));
ok('nothing is both a Source and consulted', !labels.some(l => consulted.includes(l)));
{
  // A purely numeric sheet is only cited when named as a sheet/page: "1 inch
  // cover" or "12 in footing" are quantities, not Sheet 1 / Sheet 12.
  const numeric: FilterCitation[] = [
    { label: 'Sheet 1', kind: 'plan', ref: 'u1' },
    { label: 'Sheet 12', kind: 'plan', ref: 'u12' },
  ];
  const q = splitCitations('Use a 12 in footing with 1 inch cover.', numeric, []);
  ok('numeric sheet ids are NOT cited by a bare quantity', q.citations.length === 0 && q.consulted.length === 2,
    JSON.stringify(q.citations.map(c => c.label)));
  const named = splitCitations('Sheet 12 shows the footing; see page 1 for the notes.', numeric, []);
  ok('numeric sheet ids ARE cited when named as sheet/page',
    named.citations.map(c => c.label).sort().join(',') === 'Sheet 1,Sheet 12');
  ok('an alphanumeric id still matches bare ("per A3")',
    splitCitations('Per A3, 12" deep.', [{ label: 'Sheet A3', kind: 'plan', ref: 'a3' }], []).citations.length === 1);
}
{
  const none = splitCitations('Generally, footings go below the frost line; confirm with your AHJ.', collected, []);
  ok('a general answer cites nothing it did not use', none.citations.length === 0 && none.consulted.length === collected.length);
}

const fn = read('supabase/functions/construction-answer/index.ts');
ok('edge: the no-match fallback returns { matched: false, nearest } (never a bare array)',
  /matched: false,/.test(fn) && /nearest: nearest\.map\(/.test(fn));
ok('edge: only an Array (a real keyword hit) becomes plan citations', /if \(Array\.isArray\(r\)\) \{\s*\n\s*for \(const snip of r/.test(fn));
ok('edge: result.citations/consulted come from splitCitations',
  /citations: split\.citations,\s*\n\s*consulted: split\.consulted,/.test(fn)
    && /webCitationsFromTextBlocks\(msg\?\.content\)/.test(fn));
ok('edge: rule 3 no longer REQUIRES list_rfis + get_cost_rates on every project question',
  !/Call get_project_context, search_plans, list_rfis, and get_cost_rates before answering/.test(fn));
ok('edge: the model is told to name the records it relies on', /only records you name are shown to them as sources/.test(fn));
ok('edge: rate citations carry their category as ref', /kind: "rate", ref: rate\.category/.test(fn));
ok('edge: keyword search ORs the significant terms before falling back', /planSearchTerms\(q\)/.test(fn) && /&or=\(\$\{or\}\)/.test(fn));
ok('edge: cap message names the UTC boundary, not "the 1st of next month"', !/Resets the 1st of next month/.test(fn));
ok('plan search terms drop filler and singularise', JSON.stringify(planSearchTerms('how deep do my footings need to be?')) === '["footing"]',
  JSON.stringify(planSearchTerms('how deep do my footings need to be?')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
