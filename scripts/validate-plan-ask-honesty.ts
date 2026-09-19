// scripts/validate-plan-ask-honesty.ts — audit round 2, finding #19.
//
// "Ask Your Plans indexed nothing on web and said 'Indexing complete' in green."
// Three things have to stay true:
//   1. A run's wording never claims success it did not earn (0 indexed is never
//      the success colour), and every skipped sheet carries a reason.
//   2. Sheet bytes never go through a hand-rolled expo-file-system download —
//      the web shim has no downloadAsync, which is what broke every signed-URL
//      sheet on app.mageid.app. Either the function reads the storage path, or
//      the ONE helper with a web branch does it.
//   3. The plan question searches plan sheets INSIDE the top-K.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  summarizePlanIndex, planSheetFingerprint, memoryDocHash, confidentMatches, batchGroups,
  MIN_MEMORY_SIMILARITY, PLAN_EXTRACT_STOP_CODES, type PlanIndexResult,
} from '../utils/plans/memoryIndexCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments stripped — a rule about CODE must not be satisfied (or
 *  broken) by prose describing the bug it prevents. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra ? `— ${extra}` : ''); }
}

const base: PlanIndexResult = { total: 0, alreadyIndexed: 0, newlyIndexed: 0, skipped: [], supersededExcluded: 0 };
const skip = (n: number, reason: string) =>
  Array.from({ length: n }, (_, i) => ({ sheetId: `s${i}`, label: `A-10${i}`, code: 'monthly_cap_reached', reason }));

console.log('\n1. the run says what actually happened');
// The live bug: 60 sheets, every one skipped, old label "Indexing complete" in t.success.
const allFailed = summarizePlanIndex({ ...base, total: 60, skipped: skip(60, 'Monthly plan-extract limit reached (100 on business). Resets on the 1st.') });
ok('0 of 60 indexed is never the success colour', allFailed.tone !== 'success', allFailed.tone);
ok('0 of 60 says so, and says answers cannot use the plans', /0 of 60/.test(allFailed.label) && /can't use your plans/.test(allFailed.label), allFailed.label);
ok('the refusal reason is shown, with a count', allFailed.reasons[0] === '60 sheets — Monthly plan-extract limit reached (100 on business). Resets on the 1st.', JSON.stringify(allFailed.reasons));

const partial = summarizePlanIndex({ ...base, total: 60, alreadyIndexed: 20, newlyIndexed: 21, skipped: skip(19, 'Monthly plan-extract limit reached (100 on business).') });
ok('41 of 60 is a warning, not a success', partial.tone === 'warning', partial.tone);
ok('41 of 60 names both numbers and the gap', /Indexed 41 of 60 sheets/.test(partial.label) && /19 not searchable/.test(partial.label), partial.label);

const complete = summarizePlanIndex({ ...base, total: 12, alreadyIndexed: 4, newlyIndexed: 8 });
ok('every sheet indexed is the only success case', complete.tone === 'success' && /All 12 sheets indexed \(8 new\)/.test(complete.label), complete.label);
ok('an empty set is muted, not green', summarizePlanIndex({ ...base, total: 0 }).tone === 'muted');
ok('a set of only superseded revisions says that', /only superseded/.test(summarizePlanIndex({ ...base, total: 0, supersededExcluded: 5 }).label));
const mixed = summarizePlanIndex({ ...base, total: 4, newlyIndexed: 1, skipped: [...skip(2, 'Monthly cap'), { sheetId: 'x', label: 'A-9', code: 'unreadable', reason: 'The sheet image could not be read.' }] });
ok('reasons are grouped, most common first', mixed.reasons[0].startsWith('2 sheets —') && mixed.reasons[1].startsWith('1 sheet —'), JSON.stringify(mixed.reasons));

console.log('\n2. incremental indexing keys on the drawing, not on a signed url');
const sheet = { storagePath: 'p/1-page-1.png', imageUri: 'https://x/p/1-page-1.png?token=aaa', sheetNumber: 'A-101', name: 'Floor plan' };
ok('a re-minted signed url does not restale the sheet',
  planSheetFingerprint(sheet) === planSheetFingerprint({ ...sheet, imageUri: 'https://x/p/1-page-1.png?token=bbb' }));
ok('a new drawing file restales it', planSheetFingerprint(sheet) !== planSheetFingerprint({ ...sheet, storagePath: 'p/1-page-2.png' }));
ok('renumbering restales it (the citation changes)', planSheetFingerprint(sheet) !== planSheetFingerprint({ ...sheet, sheetNumber: 'A-102' }));
ok('a sheet with no storage path still hashes off its url',
  planSheetFingerprint({ imageUri: 'https://x/a.png?sig=1', sheetNumber: 'A-1', name: 'n' }) === planSheetFingerprint({ imageUri: 'https://x/a.png?sig=2', sheetNumber: 'A-1', name: 'n' }));
ok('memoryDocHash changes when review comments are appended',
  memoryDocHash({ source: 'Submittal', ref: 'Submittal #3', text: 'Revise and resubmit' }) !== memoryDocHash({ source: 'Submittal', ref: 'Submittal #3', text: 'Revise and resubmit. Approved as noted' }));
ok('a whole sheet stays in one embed batch', batchGroups([Array(200).fill('a'), Array(100).fill('b')], 250).map(b => b.length).join(',') === '200,100');

console.log('\n3. weak neighbours are not grounding');
const m = (similarity: number) => ({ similarity });
ok('below the floor is dropped', confidentMatches([m(0.81), m(0.2)]).length === 1);
ok('a missing similarity is dropped', confidentMatches([{ similarity: undefined }]).length === 0);
ok('the floor is a named constant in (0,1)', MIN_MEMORY_SIMILARITY > 0 && MIN_MEMORY_SIMILARITY < 1);

console.log('\n4. the client cannot reintroduce the web download');
const ayp = read('utils/plans/askYourPlans.ts');
ok('askYourPlans imports no expo-file-system', !/expo-file-system/.test(ayp), 'the web shim has no downloadAsync — every signed-url sheet threw');
ok('askYourPlans has no hand-rolled downloadAsync/readAsStringAsync', !/downloadAsync|readAsStringAsync/.test(code('utils/plans/askYourPlans.ts')));
ok('bytes go through the one helper with a web branch', /imageUriToBase64/.test(ayp) && /from '@\/utils\/planCodeReviewer'/.test(ayp));
ok('a storage-backed sheet is read by the function itself', /storagePath: s\.storagePath/.test(ayp));
ok('that helper still has its web branch',
  /Platform\.OS === 'web'/.test(read('utils/planCodeReviewer.ts')) && /readAsBase64/.test(read('utils/planCodeReviewer.ts')));
ok('plan-extract accepts a storagePath and checks access through planSheetBytes',
  /loadPlanSheetImageParts/.test(read('supabase/functions/plan-extract/index.ts')) && /planSheetProjectId/.test(read('supabase/functions/plan-extract/index.ts')));
ok('plan-extract answers an unreachable sheet with a generic 403',
  /PlanSheetAccessError[\s\S]{0,400}403/.test(read('supabase/functions/plan-extract/index.ts')));

console.log('\n5. the run is reported, not swallowed');
// Wave 3 (#75): the report also carries the title-block numbers it OFFERS
// (PlanIndexRun = PlanIndexResult + titleBlockSuggestions) — still a report.
ok('indexPlanSheets returns a report, not a count',
  /Promise<PlanIndexRun>/.test(ayp) && /export type PlanIndexRun = PlanIndexResult & \{ titleBlockSuggestions: TitleBlockSuggestion\[\] \}/.test(ayp));
ok('a refusal that would repeat stops the run', /PLAN_EXTRACT_STOP_CODES\.has/.test(ayp) && PLAN_EXTRACT_STOP_CODES.has('monthly_cap_reached'));
ok('superseded sheets are left out of a run', /sheets\.filter\(s => !s\.superseded\)/.test(ayp));
const panel = read('components/plans/AskPlansPanel.tsx');
ok('the panel words the result with summarizePlanIndex', /summarizePlanIndex/.test(panel));
ok('the panel no longer prints "Indexing complete"', !/Indexing complete/.test(code('components/plans/AskPlansPanel.tsx')));
ok('the panel takes its colour from the tone, never from "done"',
  !/indexState === 'done' && \{ color: t\.success \}/.test(panel) && /toneColor\(summary\?\.tone\)/.test(panel));
ok('the panel shows the skip reasons', /summary\.reasons/.test(panel));
ok('a citation can only open a sheet this device has', /liveCitations/.test(panel));

console.log('\n6. a plan question searches plan sheets inside the top-K');
ok('askPlans passes a source scope', /sources: \[PLAN_SOURCE\]/.test(ayp));
ok('askPlans still filters client-side for an un-redeployed function', /m\.source === PLAN_SOURCE/.test(ayp));
ok('askPlans prefers confident matches', /confidentMatches\(/.test(ayp));
// B4 review: the floor must DEGRADE, never empty the prompt. Project Memory
// survives a too-strict floor because it falls through to TF-IDF; askPlans has
// no fallback, so dropping every match rebuilds finding #19's symptom ("not in
// your plans" over a plan set that holds the answer) on a threshold the
// constant's own docstring calls a heuristic.
ok('a below-floor plan sheet still reaches the prompt rather than becoming noneFound',
  /weakGrounding \? planMatches\.slice\(0, WEAK_FALLBACK_MATCHES\) : confident/.test(code('utils/plans/askYourPlans.ts')), 'the floor must degrade, not empty the prompt');
ok('weak grounding is only claimed when nothing cleared the floor',
  /const weakGrounding = confident\.length === 0 && planMatches\.length > 0/.test(code('utils/plans/askYourPlans.ts')));
ok('noneFound is still true when the search returned no plan sheet at all',
  /noneFound: matches\.length === 0/.test(code('utils/plans/askYourPlans.ts')));
ok('PlanAnswer carries the weak flag to the panel', /weakGrounding: boolean/.test(ayp));
ok('the panel says the match was weak instead of presenting it flat',
  /result\.weakGrounding/.test(panel) && /Weak match/.test(panel) && /verify before you build to this/.test(panel));
// Runtime: a 0.31 neighbour is below MIN_MEMORY_SIMILARITY, so confidentMatches
// empties — the degrade has to put it back, capped, and flagged.
{
  const weak = [{ similarity: 0.31 }, { similarity: 0.29 }, { similarity: 0.2 }, { similarity: 0.1 }];
  const confident = confidentMatches(weak);
  const degraded = confident.length === 0 && weak.length > 0 ? weak.slice(0, 3) : confident;
  ok('the degrade keeps a capped set of neighbours, not all K', confident.length === 0 && degraded.length === 3);
}
const search = read('supabase/functions/project-memory-search/index.ts');
ok('the search function forwards sources to the RPC', /p_sources: sources/.test(search));
ok('the search function falls back to the 4-arg RPC when the overload is missing', /filterHere/.test(search));
const mig = read('supabase/migrations/20260917170000_project_memory_source_filter.sql');
ok('the migration filters BEFORE the limit', mig.indexOf('e.source = any (p_sources)') < mig.indexOf('limit greatest'));
ok('the 5-arg overload has no default (the 4-arg call stays unambiguous)', !/p_sources text\[\] default/.test(mig));
ok('the new functions are service_role only',
  ['match_project_memory(uuid, text, text, int, text[])', 'project_memory_index_state(uuid, text, text[])', 'delete_project_memory_docs(uuid, text, text[])']
    .every(sig => mig.includes(`grant execute on function public.${sig} to service_role;`) && mig.includes(`revoke all on function public.${sig} from authenticated;`)));

// B5 review: the search's own error was discarded (`const { data: sr } = ...`),
// so a 402 tier refusal, a 429 cap, a 503 limiter outage or a 502 from the
// embedding upstream all landed as zero matches and the panel printed #19's
// headline sentence — "I couldn't find that in the indexed plans" — over a plan
// set that holds the answer, after paying the model to write it.
console.log('\n7. a failed search is not "not in your plans"');
const ayc = code('utils/plans/askYourPlans.ts');
ok('askPlans reads the search error instead of discarding it',
  /const \{ data: sr, error: searchErr \} = await supabase\.functions\.invoke\('project-memory-search'/.test(ayc),
  'data is null on ANY non-2xx, so a discarded error reads as "no matches"');
ok('a refused or failed search returns before the model is paid',
  ayc.includes('if (searchErr || sr?.success !== true)')
  && ayc.indexOf('if (searchErr || sr?.success !== true)') < ayc.indexOf('await mageAI('), 'the prompt was still built with "(no matching plan sheets found)"');
ok('a failed search is never reported as noneFound',
  /searchFailed: e\.message[\s\S]{0,120}\n *\};/.test(ayc) && /noneFound: false,\n *weakGrounding: false,/.test(ayc));
ok('the reason is the function\'s own words, decoded by readEdgeError', /readEdgeError\(searchErr/.test(ayc));
ok('PlanAnswer carries the failure to the panel', /searchFailed: string \| null/.test(ayp));
ok('a successful answer clears it', /noneFound: matches\.length === 0, weakGrounding, searchFailed: null/.test(ayc));
ok('the panel says the SEARCH failed, not that the plans are silent',
  /Couldn&apos;t search your plans just now/.test(panel) && /Your plans may still hold the answer/.test(panel));
ok('the panel keeps the two states apart',
  /askState === 'error' && searchFailed/.test(panel) && /setAskState\(result\.searchFailed \? 'error' : 'answered'\)/.test(panel));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
