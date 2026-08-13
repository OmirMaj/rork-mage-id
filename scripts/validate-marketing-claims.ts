// validate-marketing-claims.ts — stops the marketing site from claiming things
// the product doesn't do.
//
// WHY: the site published "2,957 vetted subs" — the exact hardcoded count
// engineering had already DELETED from the app, with the comment that a figure
// which doesn't match reality makes users stop trusting every other number.
// It also published "20,000+ regional price points" against a 154-line
// material database, and badged Business features as Pro/Free.
//
// One provably false number poisons every true one, so these are pinned.
// Run: bun run scripts/validate-marketing-claims.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REQUIRED_TIER } from '../utils/featureTiers';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

// Public pages only. /screenshots and /dist are internal (robots.txt disallows
// the former; the latter is a build mirror).
function publicPages(dir = 'marketing', out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'dist' || e === 'screenshots' || e === 'app-store-screenshots' || e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) publicPages(p, out);
    else if (p.endsWith('.html')) out.push(p);
  }
  return out;
}

const pages = publicPages();
console.log(`\nmarketing claims (${pages.length} public pages):`);

// ── Fabricated / unsupported figures ────────────────────────────────────────
const BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /2,?957/, why: 'the sub count engineering deleted from the app as untrustworthy' },
  { pattern: /20,?000\+?\s*(regional\s*)?price\s*points/i, why: 'unsupported by materialDatabase' },
  { pattern: /\b20K\+/, why: 'shorthand for the unsupported price-point count' },
  { pattern: /30%\s*faster/i, why: 'no source' },
  { pattern: /\$30K\s*[–-]\s*\$?80K/i, why: 'unsourced per-job savings promise' },
  { pattern: /roughly\s*[35]%\s*of the/i, why: 'two pages quoted different, non-reconciling percentages' },
];
for (const { pattern, why } of BANNED) {
  const hits = pages.filter(p => pattern.test(readFileSync(p, 'utf8')));
  ok(`no page claims ${pattern.source.slice(0, 34)}`, hits.length === 0,
    hits.length ? `${why} — found in: ${hits.join(', ')}` : undefined);
}

// ── Tier badges on the homepage must match the code ─────────────────────────
// index.html badges each brain capability with a tier. If the gate in
// featureTiers.ts says Business, the site must not sell it as Pro or Free.
const home = readFileSync('marketing/index.html', 'utf8');
const badges = [...home.matchAll(/alt:'([^']+)',tier:'([^']+)'/g)].map(m => ({ alt: m[1], tier: m[2] }));
ok('homepage brain cards carry tier badges', badges.length > 0);

// Capability → the feature key that actually gates it.
const EXPECTED: { match: RegExp; key: keyof typeof REQUIRED_TIER }[] = [
  { match: /Cost X-Ray/i, key: 'cost_xray' },
  { match: /learned cost catalog/i, key: 'job_costing' },
  { match: /Cash-flow forecast/i, key: 'brain_accuracy' },
  { match: /Bid advisor/i, key: 'bid_scoring' },
];
for (const { match, key } of EXPECTED) {
  const badge = badges.find(b => match.test(b.alt));
  if (!badge) { ok(`card for ${key} still present`, false, `no homepage card matched ${match}`); continue; }
  const required = REQUIRED_TIER[key];
  const claimed = badge.tier.toLowerCase();
  // Selling something as CHEAPER than its real gate is the failure mode.
  const claimsFree = claimed.includes('free');
  const claimsPro = claimed.includes('pro');
  const bad = (required === 'business' && (claimsFree || claimsPro)) || (required === 'pro' && claimsFree);
  ok(`"${badge.alt.slice(0, 34)}" badged ${badge.tier} matches gate (${required})`, !bad,
    `featureTiers says ${key}='${required}' but the site sells it as '${badge.tier}'`);
}

// ── pricing.html tier lists must match the gate table ───────────────────────
// The pricing page is the highest-stakes page on the site: a feature listed one
// tier too cheap is a promise the app will refuse to keep at the paywall. These
// checks pin the two directions that actually cost money — a Business marquee
// feature silently falling off the Business card, and a Business/Pro feature
// reappearing in a cheaper tier's list.
const pricing = readFileSync('marketing/pricing.html', 'utf8');

// Each tier is one `<div class="tier-card…">`. Splitting on the opening tag
// bounds every block by the start of the next card; the block is named by the
// first real `<h2>` inside it (the CSS in <style> never matches — it has no
// literal `<h2>` element).
function tierBlocks(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of html.split('<div class="tier-card')) {
    const name = /<h2>([^<]+)<\/h2>/.exec(chunk)?.[1]?.trim().toLowerCase();
    if (name) out[name] = chunk;
  }
  return out;
}
const tiers = tierBlocks(pricing);
const cheaperThanBusiness = ['free', 'pro'] as const;
ok('pricing.html exposes Free / Pro / Business tier cards',
  ['free', 'pro', 'business'].every(t => !!tiers[t]),
  `parsed tier cards: ${Object.keys(tiers).join(', ') || 'none'}`);

// The Business card IS the brain pitch. If these fall off, Business reads like
// "Pro plus admin settings" and the tier loses its reason to exist.
const MARQUEE: { label: string; pattern: RegExp; key: keyof typeof REQUIRED_TIER }[] = [
  { label: 'Cost X-Ray',     pattern: /Cost X-Ray/i,     key: 'cost_xray' },
  { label: 'Bid Advisor',    pattern: /Bid Advisor/i,    key: 'bid_scoring' },
  { label: 'Track Record',   pattern: /Track Record/i,   key: 'brain_accuracy' },
  { label: 'Ask Your Plans', pattern: /Ask Your Plans/i, key: 'ask_your_plans' },
];
for (const { label, pattern, key } of MARQUEE) {
  ok(`Business tier still sells "${label}"`, pattern.test(tiers.business ?? ''),
    `featureTiers gates ${key}='${REQUIRED_TIER[key]}' — the Business card must name it`);
  // Same one-way rule as the homepage badges: never sell it cheaper than its gate.
  if (REQUIRED_TIER[key] !== 'business') continue;
  for (const t of cheaperThanBusiness) {
    ok(`"${label}" absent from the ${t} tier list`, !pattern.test(tiers[t] ?? ''),
      `${key}='business' but the ${t} card lists it`);
  }
}

// Phrases that were provably mis-tiered on this page before. Each names the
// gate key that makes it wrong, so a re-tier in featureTiers.ts retires the ban
// instead of freezing a stale rule.
const MISTIER: { tier: string; pattern: RegExp; key: keyof typeof REQUIRED_TIER; why: string }[] = [
  { tier: 'pro',  pattern: /closeout binder/i, key: 'punch_list_closeout',
    why: 'the closeout half of "lien waivers + closeout binder" is Business, not Pro' },
  { tier: 'free', pattern: /Geo-tagged photo capture/i, key: 'photo_documentation',
    why: 'photo capture/documentation is a paid feature, not a Free one' },
];
for (const { tier, pattern, key, why } of MISTIER) {
  const gate = REQUIRED_TIER[key];
  // Only enforce while the gate is still above the tier that used to claim it.
  const stillMisTiered = gate === 'business' ? tier === 'free' || tier === 'pro' : gate === 'pro' && tier === 'free';
  if (!stillMisTiered) continue;
  ok(`${tier} tier no longer claims /${pattern.source}/`, !pattern.test(tiers[tier] ?? ''),
    `${why} — featureTiers says ${key}='${gate}'`);
}

// Claims with no implementation behind them at all.
const PRICING_BANNED: { pattern: RegExp; why: string }[] = [
  { pattern: /unlimited users/i, why: 'no multi-login team/seat concept exists — every account is a single login' },
  { pattern: /\bSage\b|\bFoundation\b/, why: 'no Sage or Foundation export or sync exists in the codebase' },
  { pattern: /QuickBooks Desktop|\bIIF\b/i, why: 'only QuickBooks ONLINE is integrated; there is no Desktop/IIF path' },
  { pattern: /Xero (sync|integration|2-way)/i, why: 'Xero is CSV export only — there is no Xero API' },
];
for (const { pattern, why } of PRICING_BANNED) {
  ok(`pricing.html does not claim /${pattern.source.slice(0, 30)}/`, !pattern.test(pricing), why);
}

// ── Fabricated numbers must never reach a client-facing document ─────────────
// bulkSavingsTotal is declared required on the Estimate type but is NEVER
// COMPUTED anywhere in the app — its only writers are demoSeed.ts and the two
// dev seeders. It was rendering UNGUARDED into the client proposal PDF and the
// plain-text export, so a real contractor's first proposal showed their
// customer "Bulk Savings -$0.00". The row right below it (pricePerSqFt) was
// already guarded, which is what made this an oversight rather than a choice.
{
  const pdf = readFileSync('utils/pdfGenerator.ts', 'utf8');
  // Count RENDER sites only — strip comment lines first, or this validator's
  // own explanatory comment counts as a third occurrence.
  const pdfCode = pdf.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const clientFacingBulkSavings = [...pdfCode.matchAll(/Bulk Savings/g)];
  ok('legacy HTML PDF renders Bulk Savings only when > 0',
    /\(legacyEst\.bulkSavingsTotal \?\? 0\) > 0 \?/.test(pdf),
    'the legacy HTML proposal row must be guarded — it reaches the contractor\'s customer');
  ok('legacy text export renders Bulk Savings only when > 0',
    /if \(\(legacyEst\.bulkSavingsTotal \?\? 0\) > 0\) \{/.test(pdf),
    'the legacy plain-text export must be guarded too');
  ok('linked-estimate HTML PDF renders Bulk Savings only when > 0',
    /\(est\.bulkSavingsTotal \?\? 0\) > 0 \?/.test(pdf),
    'the linkedEstimate HTML row must be guarded — it reaches the contractor\'s customer');
  ok('linked-estimate text export renders Bulk Savings only when > 0',
    /if \(\(est\.bulkSavingsTotal \?\? 0\) > 0\) \{/.test(pdf),
    'the linkedEstimate plain-text export must be guarded too');
  ok('every Bulk Savings site in the PDF generator is guarded',
    clientFacingBulkSavings.length === 4,
    `found ${clientFacingBulkSavings.length} — expected 4 (2 legacyEst + 2 linkedEstimate), a new unguarded site may have been added`);
}

// ════════════════════════════════════════════════════════════════════════════
// IN-APP FIGURES THE PRODUCT CANNOT ACTUALLY KNOW
//
// Same disease as bulkSavingsTotal, different door. bulkSavingsTotal was an
// obvious fake — a field nothing computed. These were DEFAULTS, which is worse,
// because a Zod `.default(50)` turns "the model returned nothing" into a
// confident 50% rendered as measured fact, with a risk score and no caveat.
//
// The house rule, and what every assertion below pins:
//   removing a fabricated number is always fine; inventing one never is.
//   When a signal is absent, SAY SO — see components/AIBidScorecard.tsx's
//   "Not enough decided bids to estimate odds" for the reference treatment.
// ════════════════════════════════════════════════════════════════════════════
const read = (p: string) => readFileSync(p, 'utf8');
/** Strip `//` comment lines so a file's own explanation of a retired pattern
 *  doesn't read as a re-introduction of it (the bulkSavings block above hit
 *  exactly this). */
const code = (p: string) => read(p).split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');

// ── 1. Payment predictions: absence must survive all the way to the screen ──
// `onTimeProbability: z.number().default(50)` + `daysToPay: .default(21)` +
// `collectionRiskScore: .default(50)` meant a model that returned nothing
// rendered "50% likely to pay on time", a 50/100 risk score, and a pay date
// three weeks out. A contractor makes collections calls on those.
{
  const util = code('utils/paymentPrediction.ts');
  const screen = code('app/payment-predictions.tsx');

  for (const [field, banned] of [
    ['onTimeProbability', '50'],
    ['daysToPay', '21'],
    ['collectionRiskScore', '50'],
  ] as const) {
    ok(`paymentPrediction ${field} has no .default(${banned})`,
      !new RegExp(`${field}\\s*:\\s*z\\.number\\(\\)[^,\\n]*\\.default\\(`).test(util),
      'a Zod default here is a fabricated forecast — use .optional().catch(undefined)');
    ok(`paymentPrediction ${field} is optional in the schema`,
      new RegExp(`${field}\\s*:\\s*z\\.number\\(\\)\\.optional\\(\\)`).test(util),
      'absence must parse as absent, not as a plausible number');
  }
  // The hand-rolled normalizer below the schema had the same fallbacks
  // (`: 50`, `: 21`) — the schema fix alone would not have removed them.
  ok('paymentPrediction normalizer keeps missing values null',
    /onTimeProbability:\s*rawProb === null \? null :/.test(util) &&
    /predictedPayDate:\s*daysToPay === null \? null :/.test(util),
    'a missing probability/date must stay null, not fall back to 50 / today+21');
  ok('InvoicePrediction types the absence',
    /onTimeProbability:\s*number \| null/.test(util) &&
    /daysToPay:\s*number \| null/.test(util) &&
    /riskLevel:\s*'low' \| 'medium' \| 'high' \| null/.test(util),
    'nullability in the type is what forces every render site to handle it');
  // Inflow totals must only aggregate rows that actually carry a forecast,
  // and the screen must disclose the dollars left out — a partial forecast
  // presented as a complete one is its own fabrication.
  ok('inflow windows exclude unforecast invoices',
    /p\.daysToPay !== null && p\.onTimeProbability !== null/.test(util),
    'weighting a row at a default rate silently pads the 7/14/30-day totals');
  // Bind to the POPULATED fields, not just the interface declaration — an
  // interface field nothing writes is how bulkSavingsTotal happened.
  ok('result reports what it could not forecast',
    /unforecastCount:\s*unforecast\.length/.test(util) &&
    /unforecastAmount:\s*unforecast\.reduce\(/.test(util),
    'the screen needs a real count to disclose, not a declared-but-unwritten field');

  ok('payment screen renders on-time % only when present',
    /pred\.onTimeProbability !== null \? `\$\{pred\.onTimeProbability\}%` : EMPTY/.test(screen),
    'the "On-time" cell must show the absence, not a number');
  ok('payment screen renders a pay date only when present',
    /pred\.predictedPayDate \? formatShortDate/.test(screen),
    'no daysToPay means no predicted date to print');
  ok('payment screen has a no-score state for the risk bubble',
    /collection-risk-score-absent/.test(screen),
    'a null collectionRiskScore must not render as a number');
  ok('payment screen discloses unforecast invoices',
    /unforecast-disclosure/.test(screen),
    'dollars missing from the inflow windows have to be named');
  ok('payment results carry a provenance caveat',
    /not a commitment from the client/.test(screen),
    'the intro card unmounts on results — the caveat has to live on the results view');
}

// ── 2. Estimate wizard: `confidence ?? 70` and a percentage in a PDF label ──
{
  const schema = code('utils/scopeQuestions.ts');
  const wizard = code('app/estimate-wizard.tsx');
  ok('estimate confidence has no .default(70)',
    !/confidence:\s*z\.number\(\)[^\n]*\.default\(/.test(schema),
    'BrainCard renders confidence as a % pill AND a filled meter — a default is an earned-looking score');
  ok('estimate confidence is optional',
    /confidence:\s*z\.number\(\)[^\n]*\.optional\(\)/.test(schema),
    'BrainCard already omits the pill + meter when confidence is undefined');
  ok('wizard does not backfill confidence',
    !/result\.confidence \?\? \d/.test(wizard),
    'the `?? 70` fallback made "the model said nothing" identical to an earned score');
  ok('wizard names the absence of a confidence score',
    /No confidence score returned for this run/.test(wizard),
    'omitting the meter silently is not the same as saying the signal is missing');
  // The dollar amount is real; the "~10%" was an assertion nothing checked,
  // and this line item propagates into the client proposal PDF.
  ok('contingency line item asserts no percentage',
    !/Contingency \(~/.test(wizard),
    'the label claimed a ratio the amount never had to match — and it reaches the customer');
}

// ── 3. The same confidence default on the OTHER two AI score surfaces ──────
// Found by sweeping for the pattern rather than the site. Both render through
// the same components as the wizard, so both had the same lie available.
{
  const svc = code('utils/aiService.ts');
  ok('quick-estimate confidenceScore has no .default(70)',
    !/confidenceScore:\s*z\.number\(\)[^\n]*\.default\(/.test(svc),
    'AIQuickEstimate renders this through BrainCard as a % pill + filled meter');
  ok('quick-estimate placeholder asserts no confidence',
    !/confidenceScore:\s*30,/.test(svc),
    'the stub estimate is a placeholder — a confidence meter on it is fabricated precision');
  ok('estimate-review overallScore has no .default(5)',
    !/overallScore:\s*z\.number\(\)[^\n]*\.default\(/.test(svc),
    'a "5/10" badge nothing produced is still a verdict on the user\'s estimate');
  ok('estimate-review badge is omitted when there is no score',
    /score !== undefined \?/.test(code('components/AIEstimateValidator.tsx')),
    'no score returned must mean no badge');
}

// ── 4. Cash-flow health score — the same default, one screen over ───────────
{
  const cf = code('app/cash-flow.tsx');
  ok('cash-flow healthScore has no .default(50)',
    !/healthScore:\s*z\.number\(\)[^\n]*\.default\(/.test(cf),
    'the file\'s own comment records this showing an insolvent business a fake "50/100 healthy"');
  ok('cash-flow health badge is omitted when there is no score',
    /aiAnalysis\.healthScore !== undefined \?/.test(cf),
    'no score returned must mean no badge, not a placeholder one');
}

// ── 5. Cost X-Ray: likelihood 0 is a claim, not a blank ─────────────────────
// A missing `likelihood` normalizes to 0, which both prints "0% likely to need
// work" and zeroes the allowance band. That is a confident negative, not an
// absence — so it routes to the existing verify-only path instead.
{
  const xray = code('utils/costXray.ts');
  ok('cost X-Ray refuses to price a tell with no likelihood',
    /if \(!\(tell\.likelihood > 0\)\) return 'verify-only';/.test(xray),
    '0% likely + $0 band reads as "definitely fine" when the truth is "unknown"');
  ok('cost X-Ray states the real verify-only reason',
    /export function verifyOnlyReason/.test(xray),
    'blaming detection confidence for a missing likelihood is the wrong disclosure');
}

// ── 6. Plan Intelligence: absence of a badge is not a disclosure ────────────
// Cold-start rooms price off DEFAULT_ROOM_RATES (kitchen 250, bath 300, … —
// invented). The UI had only POSITIVE chips, so a placeholder row looked
// exactly like a learned one.
{
  const plan = code('app/plan-intelligence.tsx');
  // Bind the wording to the chip that renders it — the footer note also says
  // "placeholder rates", so a bare text search would pass with no chip at all.
  ok('plan intelligence chips rooms priced off a placeholder rate',
    /r\.rateSource === 'default' &&/.test(plan) &&
    /defaultRateChipText}>[^<]*not your rate</.test(plan),
    'a room on DEFAULT_ROOM_RATES must say so — "your rate" absent is not "not your rate"');
  ok('plan intelligence discloses placeholder rates in the total',
    /plan-intel-placeholder-note/.test(plan),
    'the footer total is only as real as the number of placeholder rows under it');
}

// ── 7. Bid-Hit Scoreboard: the win rate is real, the benchmark never was ────
{
  const board = code('components/BidHitScoreboard.tsx');
  ok('no invented industry win-rate benchmark',
    !/BENCHMARK_WIN_RATE/.test(board) && !/25%\s*industry average/i.test(board),
    'MAGE has never measured an industry win rate and cannot');
  // Ungated, one won bid rendered "100%". Reuses bidHistoryFacts' MIN_DECIDED.
  ok('win rate is gated on sample size',
    /decided >= MIN_DECIDED_FOR_RATE \? won \/ decided : null/.test(board),
    'a rate from one decided bid is an invented statistic');
  const facts = read('utils/bidHistoryFacts.ts');
  const houseMin = /const MIN_DECIDED = (\d+)/.exec(facts)?.[1];
  const boardMin = /const MIN_DECIDED_FOR_RATE = (\d+)/.exec(board)?.[1];
  ok(`scoreboard sample gate matches bidHistoryFacts (${houseMin})`,
    !!houseMin && houseMin === boardMin,
    `bidHistoryFacts says ${houseMin}, BidHitScoreboard says ${boardMin} — one threshold, one meaning`);
}

// ── 8. Unsourced statistics anywhere in the app shell ───────────────────────
// These were "Industry data: …" lines and hard percentages sitting in
// monetisable surfaces — including a paid-tier upsell, the highest-liability
// class here. Scanned across all of app/ + components/ so they can't come back
// on a different screen. Each entry names WHY it is unsupportable.
{
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('.')) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) sourceFiles(p, out);
      else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
    }
    return out;
  }
  const appFiles = [...sourceFiles('app'), ...sourceFiles('components')];

  const UNSOURCED: { pattern: RegExp; why: string }[] = [
    { pattern: /15-30%/, why: 'Pro-vs-Standard scope capture was never measured — and it sat in a Business-tier upsell' },
    { pattern: /Industry data:/i, why: 'no citation exists behind any of these; the phrase itself asserts measurement' },
    { pattern: /closes 35% faster/i, why: 'the sub-bid network does not exist yet, let alone a measured speed' },
    { pattern: /close 20% more deals/i, why: 'unsourced financing conversion claim on the invoice screen' },
    { pattern: /5-7x larger ticket/i, why: 'unsourced multiplier' },
    { pattern: /average 60-83 days/i, why: 'unsourced owner payment-release figure on the pay-app screen' },
    { pattern: /\$25K-\$80K loans/i, why: 'no lender partner exists to have limits' },
    { pattern: /~25% industry average/i, why: 'invented bid win-rate benchmark' },
  ];
  for (const { pattern, why } of UNSOURCED) {
    const hits = appFiles.filter(f => pattern.test(code(f)));
    ok(`no app surface claims /${pattern.source.slice(0, 26)}/`, hits.length === 0,
      hits.length ? `${why} — found in: ${hits.join(', ')}` : undefined);
  }

  // The drawing-analyzer upsell keeps "2x output budget" because it is TRUE
  // and checkable: analyze-drawings sets maxOutputTokens 32768 for Pro vs
  // 16384 for Standard. Pin the code so the claim can't outlive the fact —
  // a real number going stale is how the next fabrication gets born.
  const edge = read('supabase/functions/analyze-drawings/index.ts');
  const budgets = /maxOutputTokens = modelUsed === 'gemini-2\.5-pro' \? (\d+) : (\d+)/.exec(edge);
  ok('drawing-analyzer "2x output budget" is still literally 2x',
    !!budgets && Number(budgets[1]) === 2 * Number(budgets[2]),
    budgets ? `edge fn says ${budgets[1]} vs ${budgets[2]}` : 'could not read maxOutputTokens from the edge function');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
