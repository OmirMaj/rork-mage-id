// scripts/validate-w5-rfp-marketplace-honesty.ts — what the marketplace tells
// people after audit wave 5 (2026-09-23):
//   #96  a homeowner whose post reached nobody was told "Nobody will see this
//        post until a contractor who covers your area joins" — but no screen
//        lets a contractor set a service area, so joining changes nothing.
//        SERVICE_AREA_SETUP_ENABLED (constants/featureFlags.ts) now drives the
//        copy before Post, in the posted alert and in My RFPs. Both flag states
//        are executed here (validate-rfp-marketplace-honesty pins only the
//        matching-live wording and is run-only for this wave).
//   #16  Pre-priced Bids said "Priced in your numbers" but history (keyed on
//        Project.type) could never meet an opportunity (keyed on
//        public_bids.category), the "cost" was the job's sell price, and the
//        markup was a fixed 18% described as "your usual".
//
// Run: bun run scripts/validate-w5-rfp-marketplace-honesty.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rfpReachLine, postedAlertBody, prePostReachNotice, NOBODY_WILL_SEE, NOBODY_COVERS_YET, REACH_REPORT_GRACE_MS,
} from '../supabase/functions/notify-nearby-contractors/reach';
import {
  buildPricedBids, deriveCostBasis, historyFromProjects, historyCostFor, bidCategoryForProjectType,
  driversForMarkup, ASSUMED_MARKUP, ACTUALS_MIN_COVERAGE,
} from '../utils/autoBid';
import { SERVICE_AREA_SETUP_ENABLED } from '../constants/featureFlags';
import type { Project } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function code(src: string): string {
  return src
    .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
    .split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
}

// ── #96 ─────────────────────────────────────────────────────────────────────
console.log('\n#96 — matching not live: say nobody will see it, promise no wait');
ok('SERVICE_AREA_SETUP_ENABLED is exported and false (no service-area editor exists)', SERVICE_AREA_SETUP_ENABLED === false);
const NOW = Date.parse('2026-09-23T12:00:00Z');
const fresh = new Date(NOW - 60_000).toISOString();
const stale = new Date(NOW - REACH_REPORT_GRACE_MS - 60_000).toISOString();
const ROWS = {
  zero: { notified_count: 0, notified_at: fresh, posted_date: fresh },
  zeroVerified: { notified_count: 0, notified_at: fresh, verified_only: true, posted_date: fresh },
  pending: { notified_count: null, notified_at: null, posted_date: fresh },
  unknown: { notified_count: null, notified_at: null, posted_date: stale },
};
const WAIT = /until a contractor who covers your area joins|covers your area yet|Checking which contractors|We alert MAGE ID contractors/;
for (const [name, row] of Object.entries(ROWS)) {
  for (const matching of [false, undefined] as const) {
    const off = rfpReachLine(row, NOW, false, matching);
    ok(`matching ${matching === undefined ? 'not passed' : 'off'}, browsing off, ${name} → "${NOBODY_WILL_SEE.slice(0, 40)}…"`,
      off.tone === 'none' && off.text === NOBODY_WILL_SEE && !WAIT.test(off.text), off.text);
  }
  const offBrowse = rfpReachLine(row, NOW, true, false);
  ok(`matching off, browsing on, ${name} → nobody alerted, still listed`,
    /isn't live in MAGE ID yet, so no contractor was alerted/.test(offBrowse.text) && /stays listed/.test(offBrowse.text) && !WAIT.test(offBrowse.text), offBrowse.text);
}
ok('the sentence names the real reason', /Contractor matching by service area isn't live in MAGE ID yet, so no contractor will see this post\./.test(NOBODY_WILL_SEE));
const some = rfpReachLine({ notified_count: 2, notified_at: fresh, posted_date: fresh }, NOW, false, false);
ok('a delivered count is still reported as the fact it is, whatever the flag', some.tone === 'some' && some.text.startsWith('2 contractors'), some.text);
const postedOff = postedAlertBody('Austin', true, false, false);
ok('the posted alert (matching off) says nobody will see it and claims no alert',
  postedOff.includes(NOBODY_WILL_SEE) && !/We alert/.test(postedOff) && !/license on file/.test(postedOff), postedOff);
ok('the posted alert with no flag passed is the honest (off) one', postedAlertBody('Austin', false, false) === postedAlertBody('Austin', false, false, false));
ok('the pre-post notice exists while matching is off, and says nobody will see the post',
  (prePostReachNotice(false, false) ?? '').startsWith(NOBODY_WILL_SEE) && prePostReachNotice(false, true) === null);

console.log('\n#96 — matching live (after a service-area editor ships): coverage copy returns');
const zeroLive = rfpReachLine(ROWS.zero, NOW, false, true);
ok('0 reached → "No MAGE ID contractor covers your area yet" + the join line', /No MAGE ID contractor covers your area yet/.test(zeroLive.text) && zeroLive.text.includes(NOBODY_COVERS_YET), zeroLive.text);
ok('just posted → "Checking…"', rfpReachLine(ROWS.pending, NOW, false, true).tone === 'pending');
ok('no report after the grace window → "no record"', rfpReachLine(ROWS.unknown, NOW, false, true).tone === 'unknown');
ok('the posted alert describes the fan-out again', /We alert MAGE ID contractors who cover Austin/.test(postedAlertBody('Austin', false, false, true)));

console.log('\n#96 — the screens pass the flag and say it BEFORE Post');
const post = code(read('app/post-rfp.tsx'));
ok('post-rfp computes the notice from reach.ts with both flags',
  /const PRE_POST_NOTICE = prePostReachNotice\(RFP_BROWSE_ENABLED, SERVICE_AREA_SETUP_ENABLED\);/.test(post));
const reviewStep = post.slice(post.indexOf('function ReviewStep('), post.indexOf('function ReviewRow('));
ok('the review step (the one with Post) renders the notice', /\{PRE_POST_NOTICE && \(/.test(reviewStep) && /\{PRE_POST_NOTICE\}/.test(reviewStep));
ok('the posted alert passes SERVICE_AREA_SETUP_ENABLED',
  /postedAlertBody\(cityState\.city, verifiedOnly, RFP_BROWSE_ENABLED, SERVICE_AREA_SETUP_ENABLED\)/.test(post));
ok('the hero no longer promises "local contractors will send you competitive bids"',
  !/local contractors will send you competitive bids/.test(post) && /SERVICE_AREA_SETUP_ENABLED\s*\?/.test(post));
ok('the address card no longer says it is used "to alert contractors" while matching is off',
  /subtitle=\{SERVICE_AREA_SETUP_ENABLED \? 'We use it to alert contractors who work in your area\.' : /.test(post));
const my = code(read('app/my-rfps.tsx'));
ok('My RFPs passes SERVICE_AREA_SETUP_ENABLED to rfpReachLine',
  /rfpReachLine\(r, Date\.now\(\), RFP_BROWSE_ENABLED, SERVICE_AREA_SETUP_ENABLED\)/.test(my));
ok('My RFPs\' empty state no longer promises an alert while matching is off',
  /SERVICE_AREA_SETUP_ENABLED\s*\?/.test(my) && /isn\\'t live in MAGE ID yet/.test(my));
const rv = code(read('app/rfp-responses-review.tsx'));
ok('Review bids\' "No bids yet" says matching isn\'t live while the flag is off',
  /!SERVICE_AREA_SETUP_ENABLED\s*\?\s*`\$\{prePostReachNotice\(RFP_BROWSE_ENABLED, SERVICE_AREA_SETUP_ENABLED\)/.test(rv));
const reach = read('supabase/functions/notify-nearby-contractors/reach.ts');
ok('reach.ts stays pure (Deno imports it): no app / React / Supabase import',
  !/^import /m.test(reach));

// ── #16 ─────────────────────────────────────────────────────────────────────
console.log('\n#16 — Pre-priced Bids prices from his costs, at his markup, and says which');
ok('ProjectType maps onto bid categories (renovation → residential, commercial → construction, awarded_rfp → residential)',
  bidCategoryForProjectType('renovation') === 'residential' && bidCategoryForProjectType('commercial') === 'construction'
  && bidCategoryForProjectType('awarded_rfp') === 'residential' && bidCategoryForProjectType('plumbing') === 'residential'
  && bidCategoryForProjectType('???') === null);

const X = 100_000; // baseTotal (cost before markup); grandTotal is the SELL price
const reno = {
  id: 'p1', type: 'renovation', status: 'completed',
  linkedEstimate: { id: 'e', items: [], globalMarkup: 20, baseTotal: X, markupTotal: 20_000, grandTotal: 120_000, createdAt: '2026-01-01' },
} as unknown as Project;
const hist = historyFromProjects([reno]);
ok('a completed renovation becomes a residential history point at baseTotal (not grandTotal)',
  hist.length === 1 && hist[0].category === 'residential' && hist[0].cost === X && hist[0].costSource === 'estimate_before_markup', JSON.stringify(hist));
const opp = { id: 'o1', title: 'Bathroom', category: 'residential', estimatedValue: 0 };
const basis = deriveCostBasis(opp, hist, 0.2);
ok('a residential opportunity is priced from his history, cost X — not X × (1 + markup)',
  basis.basis === 'your_history' && basis.cost === X && basis.cost !== X * 1.2, JSON.stringify(basis));
const blended = deriveCostBasis({ ...opp, budgetMin: 90_000, budgetMax: 150_000 }, hist, 0.2);
ok('with a posted budget, history is blended with the budget backed out at HIS markup',
  blended.basis === 'your_history' && Math.abs(blended.cost - (X + 120_000 / 1.2) / 2) < 1e-6, JSON.stringify(blended));
ok('an in-progress job is not history', historyFromProjects([{ ...reno, status: 'in_progress' } as Project]).length === 0);
ok('recorded actuals win when they cover the job',
  JSON.stringify(historyCostFor({ actualCost: 92_500.5, actualComplete: true, estimateBaseTotal: X })) === JSON.stringify({ cost: 92_500.5, costSource: 'recorded_actuals' }));
ok(`actuals under ${ACTUALS_MIN_COVERAGE * 100}% of the estimate are incomplete capture → baseTotal`,
  historyCostFor({ actualCost: 12_000, actualComplete: true, estimateBaseTotal: X })?.costSource === 'estimate_before_markup');
ok('a lower-bound actual (sources not handed over) is never used',
  historyCostFor({ actualCost: 92_000, actualComplete: false, estimateBaseTotal: X })?.cost === X);
const viaActual = historyFromProjects([reno], () => ({ value: 97_000, complete: true }));
ok('historyFromProjects takes the actual through the callback', viaActual[0]?.cost === 97_000 && viaActual[0]?.costSource === 'recorded_actuals');

const leads: never[] = [];
const assumed = buildPricedBids({ opportunities: [{ ...opp, estimatedValue: 50_000 }], history: [], leads, nowMs: NOW });
ok('no saved markup → priced at the assumed 18% and the row says so',
  assumed.length === 1 && assumed[0].markupAssumed === true && assumed[0].markup === ASSUMED_MARKUP && assumed[0].basis === 'their_budget');
ok('…and no driver calls the assumed 18% "your usual"', assumed[0].drivers.every(d => !/your usual/i.test(d) && !/nice instincts/i.test(d)), assumed[0].drivers.join(' | '));
const mine = buildPricedBids({ opportunities: [{ ...opp, estimatedValue: 50_000 }], history: [], leads, typicalMarkup: 0.25, nowMs: NOW });
ok('a saved markup is used as his', mine[0].markupAssumed === false && mine[0].markup === 0.25 && Math.abs(mine[0].cost - Math.round(50_000 / 1.25)) <= 1, JSON.stringify(mine[0]));
ok('driversForMarkup rewrites "your usual" only when assumed',
  driversForMarkup(['Recommended markup 20% is 2 pts higher than your usual 18%'], true)[0] === 'Recommended markup 20% is 2 pts higher than the assumed 18%'
  && driversForMarkup(['x your usual 25%'], false)[0] === 'x your usual 25%');

const screen = code(read('app/auto-bids.tsx'));
ok('the screen no longer uses the sell price as cost', !/effectiveEstimateTotal/.test(screen) && /historyFromProjects\(projects,/.test(screen));
ok('the markup is his saved one only when markupDecided, else assumed',
  /const markupAssumed = markupDecided !== true \|\| !Number\.isFinite\(globalMarkup\);/.test(screen)
  && /const typicalMarkup = markupAssumed \? ASSUMED_MARKUP : globalMarkup \/ 100;/.test(screen)
  && /typicalMarkup,\s+markupAssumed,/.test(screen));
ok('"Priced in your numbers" only when some row used his history',
  /const anyHistory = priced\.some\(\(b\) => b\.basis === 'your_history'\);/.test(screen)
  && /\{anyHistory \? 'Priced in your numbers' : 'Priced off posted budgets'\}/.test(screen)
  && (screen.match(/Priced in your numbers/g) ?? []).length === 1);
ok('the footnote and InfoBubble say budget-based pricing when there is no history, naming the markup',
  /Priced off each owner's posted budget at \$\{markupPhrase\} — close jobs to teach MAGE your costs\./.test(screen)
  && /an assumed \$\{pct\(typicalMarkup\)\} markup/.test(screen)
  && !/Prices come from your own cost history and win record — not a generic catalog\./.test(screen));
ok('each card names the markup (assumed or his)', /b\.markupAssumed \? `assumed \$\{pct\(b\.markup\)\} markup` : `your \$\{pct\(b\.markup\)\} markup`/.test(screen));
ok('actuals come from the same engine /wip-report uses, with every direct source',
  /suggestCostToDateWithSource\(/.test(screen) && /\{ projectId, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits \}/.test(screen));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
