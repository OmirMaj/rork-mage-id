// scripts/validate-leveling-basis.ts
//
// T7: bid leveling labels numbers that are not from the GC's book.
//   • the label rides on the saved reason ("Not from your book: " /
//     "Needs price: "), round-trips through readReason, is added once, and a
//     240-char cap keeps it;
//   • classify does not take the model's word for its basis: 'your_history'
//     is the book only when the call carried book rows, 'estimate' only when
//     the prompt carried estimate lines (it carries none today);
//   • a needs-price exclusion is never applied (amount 0) and a winner whose
//     own exclusion needs a price is not called;
//   • the summary lead is not "priced from your cost book" when every row is
//     market_guess;
//   • both screens run the helper; the prompt text, the schema and the schema
//     hint are byte-identical to base 64d397af (pinned sha256 digests; a
//     `git show` cross-check runs only when the commit is present).
//   • (integration round 2) a needs-price bid has an UNKNOWN leveled cost: it
//     cannot be awarded until he sets his price, "Set your price" writes the
//     adjustment labelled "Your price: …", leveling never overwrites his price
//     or the awarded bid, and no savings figure is shown off a needs-price bid.
// Pure — no React, no network. Exits non-zero on failure.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLOSE_CALL_REASON, NEEDS_PRICE_TAG, NOT_FROM_BOOK_TAG, REASON_MAX, YOUR_PRICE_TAG, applyLevelingHonestyPure, classify,
  countBookRows, exclusionsNeedPriceLine, rankingNotFromBookLine, readReason, tagReason,
  AWARD_NEEDS_PRICE_TITLE, SAVINGS_NEEDS_PRICE, SET_YOUR_PRICE_CTA, awardNeedsPriceBody, levelingMayWrite, needsYourPrice, yourPriceReason,
  type AdjustmentLike, type LevelingBasisContext, type LevelingResultLike,
} from '../utils/levelingBasis';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  PASS ${label}`); passed++; } else { console.error(`  FAIL ${label}`); failed++; }
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

const BOOK: LevelingBasisContext = { costBookEntries: 3, promptHadEstimateLines: false };
const NO_BOOK: LevelingBasisContext = { costBookEntries: 0, promptHadEstimateLines: false };
const WITH_EST: LevelingBasisContext = { costBookEntries: 0, promptHadEstimateLines: true };
const adj = (over: Partial<AdjustmentLike>): AdjustmentLike => ({ bidId: 'b1', adjustment: 1200, reason: 'Excludes fixtures.', confidence: 45, adjustmentBasis: 'market_guess', ...over });
const BID = { id: 'b1', excludes: 'fixtures' };

// ─── tag / read ───────────────────────────────────────────────────────────
console.log('\n── tag and read');
{
  const t = tagReason('not_from_book', 'Excludes fixtures; typical $1,200.');
  assert(t === `${NOT_FROM_BOOK_TAG}Excludes fixtures; typical $1,200.`, 'not_from_book adds the prefix');
  const r = readReason(t);
  assert(r.label === 'not_from_book' && r.text === 'Excludes fixtures; typical $1,200.', 'readReason round-trips it');
  assert(tagReason('not_from_book', t) === t, 'idempotent: re-tagging does not double the prefix');
  const np = tagReason('needs_price', t);
  assert(np.startsWith(NEEDS_PRICE_TAG) && !np.includes(NOT_FROM_BOOK_TAG) && readReason(np).label === 'needs_price', 're-labelling replaces, never stacks');
  assert(tagReason('book', 'Priced at your framing rate.') === 'Priced at your framing rate.' && tagReason('book', t) === 'Excludes fixtures; typical $1,200.', "'book' rows carry no prefix (and shed a stale one)");
  const long = 'x'.repeat(400);
  const capped = tagReason('not_from_book', long);
  assert(capped.length === REASON_MAX && capped.startsWith(NOT_FROM_BOOK_TAG), `the ${REASON_MAX}-char cap keeps the prefix (${capped.length})`);
  const capped2 = tagReason('needs_price', long);
  assert(capped2.length === REASON_MAX && capped2.startsWith(NEEDS_PRICE_TAG), '…for needs price too');
  assert(readReason('Plain reason.').label === null && readReason(null).text === '' && readReason(undefined).label === null, 'an untagged / empty reason reads with no label');
  assert(readReason(`${NOT_FROM_BOOK_TAG}${NOT_FROM_BOOK_TAG}x`).text === 'x', 'a doubled prefix from an older write reads once');
}

// ─── classify ─────────────────────────────────────────────────────────────
console.log('\n── classify');
assert(classify(adj({ adjustmentBasis: 'your_history', confidence: 70 }), BID, BOOK) === 'book', "your_history with book rows → 'book'");
assert(classify(adj({ adjustmentBasis: 'your_history', confidence: 70 }), BID, NO_BOOK) === 'not_from_book', "your_history with costBookEntries 0 → 'not_from_book'");
assert(classify(adj({ adjustmentBasis: 'estimate', confidence: 70 }), BID, BOOK) === 'not_from_book', "estimate with promptHadEstimateLines false → 'not_from_book'");
assert(classify(adj({ adjustmentBasis: 'estimate', confidence: 70 }), BID, WITH_EST) === 'book', "estimate with estimate lines in the prompt → 'book'");
assert(classify(adj({ adjustmentBasis: 'market_guess', confidence: 45 }), BID, BOOK) === 'not_from_book', "market_guess > 0 → 'not_from_book'");
assert(classify(adj({ adjustmentBasis: 'market_guess', confidence: 29 }), BID, BOOK) === 'needs_price', "market_guess at confidence < 30 → 'needs_price'");
assert(classify(adj({ adjustmentBasis: 'market_guess', confidence: 30 }), BID, BOOK) === 'not_from_book', 'confidence 30 is not below 30');
assert(classify(adj({ adjustmentBasis: 'your_history', confidence: 80, needsAnswer: 'Does "some permits" cover the plumbing permit?' }), BID, BOOK) === 'needs_price', "needsAnswer set → 'needs_price', whatever the basis");
assert(classify(adj({ adjustment: 0, reason: 'Excludes permits, which Bid 2 includes.' }), BID, BOOK) === 'needs_price', "an excluding bid left at 0 while its reason says another bid includes it → 'needs_price'");
assert(classify(adj({ adjustment: 0, reason: 'All-in bid; includes everything.' }), BID, BOOK) === 'book', 'an all-in reason at 0 is not needs price');
assert(classify(adj({ adjustment: 0, reason: 'Excludes permits, which Bid 2 includes.' }), { id: 'b1', excludes: '' }, BOOK) === 'book', 'no excludes text → no needs-price guess');
assert(classify(adj({ adjustment: 0, reason: 'No exclusions identified.' }), BID, BOOK) === 'book', 'no model signal → not needs price');
assert(classify(adj({ adjustment: -300, adjustmentBasis: 'market_guess', confidence: 45 }), BID, BOOK) === 'not_from_book', 'a negative market amount is not from the book either');

// ─── the pass ─────────────────────────────────────────────────────────────
console.log('\n── applyLevelingHonesty');
{
  const result: LevelingResultLike = {
    adjustments: [
      adj({ bidId: 'b1', adjustment: 1200, adjustmentBasis: 'market_guess', confidence: 45, reason: 'Excludes fixtures; typical $1,200.' }),
      adj({ bidId: 'b2', adjustment: 400, adjustmentBasis: 'your_history', confidence: 75, reason: 'Permits at your rate.' }),
      adj({ bidId: 'b3', adjustment: 900, adjustmentBasis: 'market_guess', confidence: 20, reason: 'Dump fees, unclear.' }),
      adj({ bidId: 'b4', adjustment: 0, confidence: 0, reason: 'AI unavailable — review manually.' }),
    ],
    summary: 'Three bids.', recommendedWinnerBidId: 'b3', recommendedWinnerReason: 'Lowest after leveling.',
    basisContext: BOOK,
  };
  const bids = [{ id: 'b1', excludes: 'fixtures' }, { id: 'b2', excludes: 'permits' }, { id: 'b3', excludes: 'dump fees' }, { id: 'b4', excludes: '' }];
  const h = applyLevelingHonestyPure(result, bids);
  const by = (id: string) => h.result.adjustments.find(a => a.bidId === id)!;
  assert(by('b1').adjustment === 1200 && by('b1').reason.startsWith(NOT_FROM_BOOK_TAG), 'not_from_book: amount applied, reason tagged');
  assert(by('b2').adjustment === 400 && readReason(by('b2').reason).label === null, 'book: untouched');
  assert(by('b3').adjustment === 0 && by('b3').reason.startsWith(NEEDS_PRICE_TAG), 'needs_price: NEVER applied (amount 0), reason tagged');
  assert(by('b4').reason === 'AI unavailable — review manually.' && !('b4' in h.labels), 'the AI-unavailable row passes through untouched');
  assert(h.notFromBookCount === 1 && h.needsPriceCount === 1 && h.bookCount === 1, `counts (${h.notFromBookCount}/${h.needsPriceCount}/${h.bookCount})`);
  assert(h.result.recommendedWinnerBidId === '' && h.result.recommendedWinnerReason === CLOSE_CALL_REASON, 'a winner whose exclusion needs a price is not called');
  assert(result.adjustments[0].reason === 'Excludes fixtures; typical $1,200.', 'the input result is not mutated');
  const again = applyLevelingHonestyPure(h.result, bids);
  assert(JSON.stringify(again.result.adjustments.map(a => a.reason)) === JSON.stringify(h.result.adjustments.map(a => a.reason)), 'running the pass twice changes nothing');
  const noCtx = applyLevelingHonestyPure({ ...result, basisContext: undefined, recommendedWinnerBidId: 'b1' }, bids);
  assert(noCtx.labels.b2 === 'not_from_book' && noCtx.result.recommendedWinnerBidId === 'b1', 'no context → no model-claimed basis is trusted; a priced winner stays');
}

// ─── the summary lead ─────────────────────────────────────────────────────
console.log('\n── summary lead');
{
  const allMarket = [adj({ bidId: 'b1' }), adj({ bidId: 'b2', adjustment: 500 })];
  assert(countBookRows(allMarket, [BID, { id: 'b2', excludes: 'x' }], BOOK) === 0, 'all market_guess → 0 book rows, even with a book of 3 rates');
  assert(countBookRows([adj({ adjustmentBasis: 'your_history', confidence: 70 })], [BID], BOOK) === 1, 'a real book row counts');
  assert(countBookRows([adj({ adjustmentBasis: 'your_history', confidence: 70 })], [BID], NO_BOOK) === 0, '…but not when the call carried no book rows');
}

// ─── copy ─────────────────────────────────────────────────────────────────
console.log('\n── copy');
assert(rankingNotFromBookLine(2) === 'Ranking uses 2 amounts not from your book.' && rankingNotFromBookLine(1) === 'Ranking uses 1 amount not from your book.', 'ranking line');
assert(exclusionsNeedPriceLine(1) === '1 exclusion needs your price before this ranking is complete.' && exclusionsNeedPriceLine(2) === '2 exclusions need your price before this ranking is complete.', 'needs-price line');

// ─── needs your price (round 2) ───────────────────────────────────────────
console.log('\n── needs your price');
{
  // The critic's case: budget $50,000; a $40,000 bid excluding "Dumpster and
  // blocking"; the model's guess for it is $3,200 at confidence 20.
  const raw: LevelingResultLike = {
    adjustments: [adj({ bidId: 'b1', adjustment: 3200, confidence: 20, adjustmentBasis: 'market_guess', reason: 'Dumpster and blocking, typical $3,200.' })],
    summary: 'One bid.', recommendedWinnerBidId: 'b1', recommendedWinnerReason: 'Lowest.', basisContext: BOOK,
  };
  const h = applyLevelingHonestyPure(raw, [{ id: 'b1', excludes: 'Dumpster and blocking' }]);
  const saved = { id: 'b1', amount: 40000, excludes: 'Dumpster and blocking', normalizedAdjustment: h.result.adjustments[0].adjustment, normalizedAdjustmentReason: h.result.adjustments[0].reason };
  assert(saved.normalizedAdjustment === 0 && needsYourPrice(saved), 'the honesty pass saves it at 0 AND it reads needs your price (unknown cost, not $0)');
  assert(!needsYourPrice({ normalizedAdjustmentReason: 'Priced at your rate.' }) && !needsYourPrice({ normalizedAdjustmentReason: `${NOT_FROM_BOOK_TAG}x` })
    && !needsYourPrice(null) && !needsYourPrice({ normalizedAdjustmentReason: yourPriceReason('x') }), 'only a needs-price reason reads needs your price (not book, not-from-book, his price, nothing)');
  // "Set your price" $3,200 → the money chain reads his number.
  const priced = { ...saved, normalizedAdjustment: 3200, normalizedAdjustmentReason: yourPriceReason(saved.excludes) };
  assert(!needsYourPrice(priced) && readReason(priced.normalizedAdjustmentReason).label === 'your_price'
    && readReason(priced.normalizedAdjustmentReason).text === 'Dumpster and blocking', 'his price is saved as "Your price: <excludes>" and no longer needs a price');
  assert(yourPriceReason('') === `${YOUR_PRICE_TAG}the scope this bid excludes` && yourPriceReason('y'.repeat(400)).length === REASON_MAX, 'yourPriceReason: a fallback for empty excludes, capped at REASON_MAX');
  const pf = await import('../utils/projectFinancials');
  assert(pf.leveledBuyoutSavings(50000, priced) === 6800 && pf.uncoveredScopeOf(priced) === 3200,
    `priced: savings $6,800 and $3,200 still to buy (got ${pf.leveledBuyoutSavings(50000, priced)} / ${pf.uncoveredScopeOf(priced)})`);
  assert(pf.leveledBuyoutSavings(50000, saved) === 10000, 'the placeholder 0 alone WOULD read $10,000 of savings — which is why a needs-price bid is never awarded or shown with a savings number');
  // Leveling never overwrites his price or the awarded bid.
  assert(levelingMayWrite(saved, undefined) && levelingMayWrite({ id: 'b2', normalizedAdjustmentReason: 'x' }, 'b1') && levelingMayWrite(undefined, 'b1'),
    'leveling may write a needs-price, a plain or an unknown bid');
  assert(!levelingMayWrite(priced, undefined), 'never over his own price');
  assert(!levelingMayWrite({ id: 'b1', normalizedAdjustmentReason: 'Priced at your rate.' }, 'b1'), 'never over the awarded bid');
  // A re-run of the pass over his saved price does not re-label it.
  const rerun = applyLevelingHonestyPure({ ...raw, adjustments: [{ ...raw.adjustments[0], confidence: 70, adjustmentBasis: 'your_history', reason: priced.normalizedAdjustmentReason }] }, [{ id: 'b1', excludes: 'x' }]);
  assert(rerun.labels.b1 === 'book', "a 'Your price' reason is not a leveling label (the pass classifies the new row on its own)");
  // Copy.
  assert(SAVINGS_NEEDS_PRICE === 'Not shown — needs your price' && AWARD_NEEDS_PRICE_TITLE === 'Price the excluded scope first'
    && awardNeedsPriceBody('Dumpster and blocking') === `Dumpster and blocking needs your price before this bid can be awarded. Tap "${SET_YOUR_PRICE_CTA}" on the bid card.`
    && awardNeedsPriceBody(null).startsWith('The scope this bid excludes needs your price'), 'the refusal says what unlocks it');
  const words = [SAVINGS_NEEDS_PRICE, AWARD_NEEDS_PRICE_TITLE, SET_YOUR_PRICE_CTA, awardNeedsPriceBody('x')];
  assert(words.every(w => !/!/.test(w) && !/\b(he|his|him|she|her)\b/i.test(w)), 'VOICE: no exclamation marks, no he/his');
}

// ─── source ───────────────────────────────────────────────────────────────
console.log('\n── source');
const engine = src('utils/bidLevelingEngine.ts');
const screen = src('app/bid-leveling.tsx');
const buyout = src('app/buyout-package.tsx');
assert(/const basisContext: LevelingBasisContext = \{ costBookEntries, promptHadEstimateLines: PROMPT_HAS_ESTIMATE_LINES \}/.test(engine)
  && /entryCount: costBookEntries[\s\S]{0,80}= buildCostBookFacts\(/.test(engine), "the ctx is built inside levelBids from buildCostBookFacts' entryCount");
assert(!/basisContext\s*[:=]\s*\{/.test(screen) && !/basisContext\s*[:=]\s*\{/.test(buyout) && !/costBookEntries/.test(screen + buyout), 'the screens never build the ctx');
assert(/const bookRows = countBookRows\(result\.adjustments, bids, basisContext\);\s*if \(bookRows > 0 && costBookEntries > 0 && result\.summary\)/.test(engine), 'the summary lead is gated on real book rows');
assert(/applyLevelingHonesty\(raw, bids\)/.test(screen) && /applyLevelingHonesty\(raw, bids\)\.result/.test(buyout), 'both screens run applyLevelingHonesty on the levelBids result');
assert(/readReason\(/.test(screen) && /readReason\(bid\.normalizedAdjustmentReason\)/.test(buyout), 'both screens render the saved label through readReason');
assert(!/these use market estimates/.test(screen) && screen.includes('NO_BOOK_MATCH_NOTE') && !/'AI draft'/.test(screen), 'the old "market estimates" note and the session-only "AI draft" chip are gone');
assert(/testID=\{`leveling-basis-\$\{b\.bid\.id\}`\}/.test(screen) && /testID="leveling-note"/.test(screen), 'testIDs leveling-basis-<bidId> and leveling-note');
assert(/const PROMPT_HAS_ESTIMATE_LINES = false;/.test(engine), 'promptHadEstimateLines is false today (the prompt carries no estimate lines)');
// Round 2: the award, the card, the hero and both leveling writers.
{
  const awardAt = buyout.indexOf('const handleAward = useCallback(');
  const award = awardAt < 0 ? '' : buyout.slice(awardAt, buyout.indexOf('const handleGenerateSubcontract', awardAt));
  const gate = award.indexOf('if (needsYourPrice(bid)) {');
  assert(gate > 0 && gate < award.indexOf('leveledBuyoutSavings(') && gate < award.indexOf('reviewAwardCompliance(')
    && /if \(needsYourPrice\(bid\)\) \{\s*showAlert\(AWARD_NEEDS_PRICE_TITLE, awardNeedsPriceBody\(bid\.excludes\)\);\s*return;\s*\}/.test(award),
    'handleAward refuses a needs-price bid, with the unlock, before any savings figure or the compliance dialogs');
  assert(/const needsPrice = priced && needsYourPrice\(bid\);/.test(buyout)
    && /\{pkg\.status !== 'awarded' && \(needsPrice \? \([\s\S]{0,700}setAmountEditMode\('excludedPrice'\)[\s\S]{0,700}\{SET_YOUR_PRICE_CTA\}[\s\S]{0,200}\) : priced \? \(\s*<TouchableOpacity style=\{styles\.awardBtn\}/.test(buyout),
    'the card swaps Award for "Set your price" on a needs-price bid');
  assert(/\{needsPrice \? \(\s*<Text[^>]*>\{LABEL_NEEDS_PRICE\}<\/Text>/.test(buyout), 'the card\'s leveled total reads "Needs price", not the placeholder total');
  assert(/if \(amountEditMode === 'excludedPrice'\) \{[\s\S]{0,400}updateBidPackageBid\(amountEditBidId, \{\s*normalizedAdjustment: amount,\s*normalizedAdjustmentReason: yourPriceReason\(target\?\.excludes\),\s*\}\);/.test(buyout)
    && /const amount = parseBidAmountInput\(amountDraft\);/.test(buyout), '"Set your price" writes his cents-rounded number as the adjustment, labelled "Your price: …"');
  assert(/const heroNeedsPrice = pkg\?\.status === 'awarded' && needsYourPrice\(bids\.find\(b => b\.id === pkg\.awardedBidId\)\);/.test(buyout)
    && /\) : heroNeedsPrice \? \([\s\S]{0,300}\{SAVINGS_NEEDS_PRICE\}[\s\S]{0,120}\) : heroSavings != null \? \(/.test(buyout), 'the hero shows no savings number off a needs-price awarded bid');
  assert(/if \(!levelingMayWrite\(bids\.find\(b => b\.id === adj\.bidId\), pkg\.awardedBidId\)\) continue;/.test(buyout)
    && /if \(!levelingMayWrite\(bids\.find\(x => x\.id === adj\.bidId\), pkg\.awardedBidId\)\) continue;/.test(screen), 'both leveling writers skip his price and the awarded bid');
}

// Byte-identity with base 64d397af: the prompt, the schema, the schema hint.
function block(text: string, start: RegExp, end: string): string | null {
  const m = start.exec(text);
  if (!m) return null;
  const e = text.indexOf(end, m.index);
  return e < 0 ? null : text.slice(m.index, e + end.length);
}
// The five base pieces are pinned as sha256 digests taken from 64d397af, so
// the check holds in a shallow CI checkout (fetch-depth 1) where that commit
// is absent. `git show` is only an optional cross-check of the literals,
// skipped when the object is missing (the validate-w6d-forms pattern).
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');
const PIECES: [string, RegExp, string, string][] = [
  ['levelingResultSchema', /const levelingResultSchema = z\.object\(\{/, '\n});\n', 'b6aa1e2e51c4ce18b5e6283a1cd1e068fcbaac0f577a7552d5a59eaeb0c98e61'],
  ['the prompt', /prompt: `You are a residential GC's buyout/, '`,\n', '24913fa0c5a7ee0b612cb77b6a33fa6374590b481c0cbfc79ab4d9582b5183ae'],
  ['the cost-book section', /const costBookSection = costBookFacts/, ";\n\n", '927e23a9a971bb3b8eca047093e212de98e390fb6a74f7b7b1d79cebea6041d5'],
  ['the bid lines', /const bidLines = bids\.map/, ".join('\\n\\n');", '04a3901d12aaa543935a859088bf17c8e7a7eb53f14cf450e3158d61ebf712d7'],
  ['the schema hint', /schemaHint: \{/, '\n    },\n', 'f569ed46a011a445f891381c11de3291fbc51dfeee278e376a0b7e978323a123'],
];
for (const [name, start, end, digest] of PIECES) {
  const b = block(engine, start, end);
  assert(!!b && sha256(b) === digest, `${name} is byte-identical to 64d397af (sha256 ${digest.slice(0, 12)}${b ? `, ${b.length} chars` : ', not found'})`);
}
let base: string | null = null;
try {
  base = execFileSync('git', ['show', '64d397af:utils/bidLevelingEngine.ts'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch { /* shallow clone: the digests above hold */ }
if (base !== null) {
  for (const [name, start, end, digest] of PIECES) {
    const a = block(base, start, end);
    assert(!!a && sha256(a) === digest, `${name}: the pinned digest matches git show 64d397af`);
  }
} else {
  console.log('  SKIP git cross-check (64d397af not in this checkout; the pinned digests hold)');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.error('leveling-basis validator FAILED'); process.exit(1); }
console.log('leveling-basis validator PASSED');
