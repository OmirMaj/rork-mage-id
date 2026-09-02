// validate-rfp-surfaces.ts — pins the two homeowner-RFP surfaces against the
// defects found in docs/audits/2026-09-02-launch-readiness.md.
//
// WHY THIS EXISTS
//
// #12 — app/post-rfp.tsx. The "Verified pros only" toggle told the homeowner
//      "Only license-verified contractors get notified and can bid." Only the
//      first clause was ever true. verified_only is read in exactly one place,
//      supabase/functions/notify-nearby-contractors/index.ts:144-172, and all it
//      does there is narrow the push/email fan-out. Reading and bidding are not
//      gated at all — verified against production on 2026-09-02:
//
//        public_bids  public_bids_select  SELECT  TO authenticated  USING (true)
//        bid_responses bid_responses_own  ALL     TO public         USING (auth.uid() = user_id)
//                                                                   WITH CHECK  null
//
//      so any account created 30 seconds ago reads every homeowner RFP — street
//      address, photos, budget — and can submit a bid response to a
//      verified-only RFP. A homeowner ticking that box was being sold a
//      restriction the backend does not implement. Until a WITH CHECK predicate
//      exists on bid_responses INSERT, the copy may only promise notification
//      targeting. This guard fails if the "can bid" promise grows back, on the
//      toggle or on the rfp-detail pill.
//
// #13 — app/rfp-detail.tsx. `if (isLoading || !rfp)` returned a View containing
//      one ActivityIndicator, under headerShown:false. The queryFn swallowed
//      every failure and returned null, so a network error, an offline tap, a
//      deleted or awarded row and a missing bidId all landed in that one branch
//      — and with enabled:false TanStack v5 leaves isLoading false and data
//      undefined, so it was permanent, not transient. Zero text nodes, no
//      retry, and no back chevron (that lived only in the success branch), so
//      on web there was no way out of the screen at all.
//
//      The invariant this guard pins: every headerShown:false branch in
//      rfp-detail also renders the back header, the three failure states are
//      distinct and each carries real copy, and the queryFn throws on error so
//      react-query can tell "errored" from "not found".
//
// Run via: bun run scripts/validate-rfp-surfaces.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const POST = 'app/post-rfp.tsx';
const DETAIL = 'app/rfp-detail.tsx';
const postSrc = read(POST);
const detailSrc = read(DETAIL);

const count = (src: string, needle: string) => src.split(needle).length - 1;

console.log('\nRFP surfaces (post-rfp + rfp-detail):');

// ── #12: the verified-only promise matches what the backend enforces ────────
console.log('\n  #12 — verified-only copy promises only what is enforced');

// The exact subtitle a homeowner reads next to the toggle. Pinned verbatim:
// this is the sentence the audit found to be false, and any reword has to be
// re-checked against the RLS before it ships.
const SUBTITLE = 'We only alert contractors with a current license on file. Fewer bids, higher quality.';
ok('post-rfp toggle subtitle is the notification-scoped copy',
  postSrc.includes(SUBTITLE),
  `Expected this exact string in ${POST}:\n      "${SUBTITLE}"`);

const TOGGLE_TITLE = 'Notify verified pros only';
ok('post-rfp toggle title is notification-scoped',
  postSrc.includes(`<Text style={styles.verifyToggleTitle}>${TOGGLE_TITLE}</Text>`),
  `Expected the toggle title to be "${TOGGLE_TITLE}" in ${POST}. Plain "Verified pros only"`
  + ' reads as a restriction on who may bid, which is not implemented.');

// The banned promise, in either file. Comments are stripped first so the
// explanatory comments (which necessarily quote the old copy) do not trip it.
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const postCode = stripComments(postSrc);
const detailCode = stripComments(detailSrc);

for (const [label, src] of [[POST, postCode], [DETAIL, detailCode]] as const) {
  ok(`${label} does not promise that only verified pros "can bid"`,
    !/can bid|only.{0,40}may bid|only verified.{0,40}bid/i.test(src),
    'bid_responses has no verification predicate — any authenticated account can'
    + ' insert a bid response on a verified_only RFP. Do not promise otherwise until'
    + ' a WITH CHECK lands on bid_responses INSERT.');
}

ok('rfp-detail pill does not claim "VERIFIED PROS ONLY"',
  !detailCode.includes('VERIFIED PROS ONLY') && detailCode.includes('VERIFIED PROS NOTIFIED'),
  `${DETAIL} must label verified_only as a notification setting, not an access restriction.`);

// ── #13: no bare-spinner dead end ───────────────────────────────────────────
console.log('\n  #13 — rfp-detail cannot dead-end on a textless spinner');

ok('the collapsed `isLoading || !rfp` branch is gone',
  !/if\s*\(\s*isLoading\s*\|\|\s*!rfp\s*\)/.test(detailCode),
  'That single branch merged fetching, errored, deleted and missing-bidId into one'
  + ' textless spinner with no back control.');

// Each of these must return a rendered state, not merely branch — `if (!bidId)
// return;` inside a handler is not a state the user can see.
for (const [label, needle] of [
  ['fetching', /if\s*\(\s*isLoading\s*\)\s*\{\s*return renderShell\(/],
  ['load failed (retryable)', /if\s*\(\s*loadFailed\s*\)\s*\{\s*return renderShell\(/],
  ['resolved with no row', /if\s*\(\s*!rfp\s*\)\s*\{\s*return renderShell\(/],
  ['missing bidId', /if\s*\(\s*!bidId\s*\)\s*\{\s*return renderShell\(/],
] as const) {
  ok(`rfp-detail has a distinct "${label}" state`, needle.test(detailCode));
}

// Every branch that hides the native header must draw the in-page one, or the
// user has no back affordance. On web there is no edge-swipe fallback.
const headerHidden = count(detailCode, 'headerShown: false');
const backHeaders = count(detailCode, 'style={styles.header}');
ok('every headerShown:false branch renders the back header',
  headerHidden > 0 && headerHidden === backHeaders,
  `${headerHidden} branch(es) hide the native header but only ${backHeaders} render`
  + ' the in-page header with its ChevronLeft. A branch without one is a screen the'
  + ' user cannot leave on web.');

ok('the shared shell carries a labelled back control',
  /const renderShell[\s\S]{0,900}accessibilityLabel="Back"[\s\S]{0,400}styles\.eyebrow/.test(detailCode),
  'renderShell must render the ChevronLeft back button and the heading.');

ok('back falls through to a real route when there is nothing to pop',
  /router\.canGoBack\(\)\s*\)\s*router\.back\(\)/.test(detailCode)
  && /router\.replace\(/.test(detailCode),
  'A notification deep link can cold-start this route with an empty stack, where'
  + ' router.back() does nothing.');

ok('the failure state offers a retry',
  detailCode.includes('testID="rfp-detail-retry"') && /void refetch\(\)/.test(detailCode),
  'An errored fetch must be recoverable in place.');

// The queryFn must let react-query see the failure, otherwise "errored" and
// "deleted" are the same resolved null and no retry can ever be offered.
// Slice the RFP queryFn out of the RAW source — the comment-stripped copy has
// no `// Has the contractor` anchor, and an indexOf(-1) here would silently
// widen the slice to the whole file and let the neighbouring query's
// .maybeSingle() satisfy the assertion below.
const qStart = detailSrc.indexOf('const { data: rfp');
const qEnd = detailSrc.indexOf('const { data: existingResponse');
ok('the RFP queryFn could be located for inspection', qStart >= 0 && qEnd > qStart,
  `Could not slice the rfp query out of ${DETAIL} — the anchors moved.`);
const qfn = stripComments(detailSrc.slice(qStart, qEnd > qStart ? qEnd : undefined));
ok('the RFP queryFn throws on error instead of returning null',
  /if\s*\(error\)\s*\{[\s\S]{0,200}throw new Error/.test(qfn) && !/if\s*\(error\)\s*\{[\s\S]{0,120}return null/.test(qfn),
  'A swallowed error resolves the query with null, which is indistinguishable from'
  + ' a deleted RFP and cannot surface a retry.');

ok('the RFP query uses maybeSingle for the not-found case',
  qfn.includes('.maybeSingle()'),
  '.single() raises PGRST116 for zero rows, which would be reported to the user as'
  + ' a network failure rather than "no longer available".');

// Each non-success branch has to put words on screen. The 2026-09-02 render
// sweep collected 0 text nodes from this route in three different world states.
const shellCalls = detailCode.split('return renderShell(').slice(1);
ok('every shell state renders copy, not just an indicator',
  shellCalls.length >= 4 && shellCalls.every(b => b.slice(0, 1200).includes('<Text')),
  `${shellCalls.length} renderShell state(s) found; each must contain a <Text>.`);

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-rfp-surfaces — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
