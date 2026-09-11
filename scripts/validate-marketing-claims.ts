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


// ════════════════════════════════════════════════════════════════════════════
// THE 2026-09-11 MARKETING-CLAIM SWEEP
//
// A twelve-agent audit, adversarially re-verified, found five claims on this
// site that were false against the code and one that was false against the
// App Store. Every one of them was the kind a buyer discovers in week one, and
// every one was fixable with copy that is STRONGER than what it replaced. The
// assertions below pin the fixes to the facts that justify them, so a fix
// retires itself when the fact changes instead of freezing a stale rule.
//
// The house rule these all serve: a claim about the product must be true of
// the code, and a claim about a competitor must carry the date it was read.
// ════════════════════════════════════════════════════════════════════════════
{
  console.log('\n2026-09-11 claim sweep:');

  /** Strip HTML comments before scanning prose. Several of the fixes below
   *  explain the retired claim in a comment directly above the replacement —
   *  a bare text search would read that explanation as a re-introduction. This
   *  bit the bulkSavings block above for exactly the same reason. */
  const prose = (p: string) => readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

  // ── 1. The till. No purchase path may be claimed while there isn't one ────
  // There is no App Store listing (itunes lookup on id 6762229238 and on
  // bundleId com.mageid.app both return resultCount 0) AND eas.json carries a
  // sandbox RevenueCat Web Billing key in both release profiles, which
  // contexts/SubscriptionContext.tsx:78-94 documents as configuring cleanly
  // while "the one thing that does not happen is a charge".
  //
  // So this check is CONDITIONAL on the till: it reads eas.json and only
  // enforces the ban while a release profile still carries an rcb_sb_ key.
  // Fix the key and these assertions retire themselves rather than having to
  // be remembered. scripts/validate-release-keys.ts owns the key itself.
  {
    const eas = JSON.parse(readFileSync('eas.json', 'utf8')) as {
      build?: Record<string, { env?: Record<string, string> }>;
    };
    const sandboxWebKey = ['production', 'preview'].some(p =>
      Object.values(eas.build?.[p]?.env ?? {}).some(v => /^rcb_sb_/.test(String(v))));

    if (!sandboxWebKey) {
      ok('web till is live — purchase-path copy is unblocked (this check stands down)', true);
    } else {
      const PURCHASE_CLAIMS: { pattern: RegExp; why: string }[] = [
        { pattern: /Paying in 90 seconds/i, why: 'no channel can take a payment — sandbox web key, no App Store listing' },
        { pattern: /Self-serve App Store install/i, why: 'the app is not listed; itunes lookup returns resultCount 0' },
        { pattern: /published, in the App Store/i, why: 'the app is not listed' },
        { pattern: /cancel any ?time,? from the App Store/i, why: 'there is no App Store subscription to cancel' },
      ];
      for (const { pattern, why } of PURCHASE_CLAIMS) {
        const hits = pages.filter(p => pattern.test(prose(p)));
        ok(`no page claims /${pattern.source.slice(0, 30)}/`, hits.length === 0,
          hits.length ? `${why} — found in: ${hits.join(', ')}` : undefined);
      }
      // Removing the false claim is only half the fix. The page that quotes the
      // prices has to say the register cannot ring, or a visitor still arrives
      // at a plan they cannot buy — just one screen later.
      const pricing2 = prose('marketing/pricing.html');
      ok('pricing.html discloses that paid plans are not self-serve yet',
        /cannot take your card yet/i.test(pricing2),
        'a sandbox key in a release profile means no visitor can be billed — say so above the prices');
      ok('pricing.html routes its paid CTAs somewhere that works',
        !/href="https:\/\/app\.mageid\.app\/\?plan=(pro|business|enterprise)/.test(pricing2),
        'a paid ?plan= deep link lands on a paywall that cannot charge; route to /access.html until the key is live');
      // The restore path must stay in the file, or the honest interim copy
      // quietly becomes permanent.
      ok('pricing.html keeps the marked block to restore when the till works',
        /RESTORE WHEN THE TILL WORKS/.test(readFileSync('marketing/pricing.html', 'utf8')),
        'the real CTAs must stay commented in place so putting them back is a deletion, not a rewrite');
    }
  }

  // ── 2. The DCMA claim is pinned to DCMA_COVERAGE, in both directions ─────
  // TWO fixes have now been wrong here, the same way both times.
  // First the copy claimed all fourteen. Then a fix parsed the `dcmaLabel`
  // DISPLAY STRINGS out of utils/scheduleHealthScore.ts and believed them —
  // but those strings were decorative mislabels ("Critical-path density" was
  // tagged "#6 High Float / #12 Critical Path Test" when it measures neither),
  // so the page shipped GREEN while naming three checks that have never run.
  // A guard that reads a label certifies a string, not an implementation.
  // The audited map is the exported DCMA_COVERAGE constant, whose own header
  // says "Keep this list true". Read that — and then also assert the labels
  // agree with it, because a label drifting away from DCMA_COVERAGE is the
  // exact mechanism that produced the false copy twice.
  {
    const health = readFileSync('utils/scheduleHealthScore.ts', 'utf8');
    const covSrc = /export const DCMA_COVERAGE\s*=\s*\{([\s\S]*?)\n\};/.exec(health)?.[1];
    ok('utils/scheduleHealthScore.ts still exports the audited DCMA_COVERAGE map',
      !!covSrc,
      'the marketing claim is bound to that constant; if it is renamed or deleted, rebind it — do NOT fall back to the dcmaLabel strings, which is what shipped the false #6/#12/#14 copy');
    const nums = (field: string): number[] => {
      const m = new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)\\]`).exec(covSrc ?? '');
      return m ? [...m[1].matchAll(/\d+/g)].map(x => Number(x[0])) : [];
    };
    const implemented = nums('implemented');
    const partial = nums('partial');
    const notImplemented = nums('notImplemented');
    const impl = new Set(implemented);

    ok('DCMA_COVERAGE accounts for all fourteen checks exactly once',
      implemented.length + partial.length + notImplemented.length === 14 &&
      new Set([...implemented, ...partial, ...notImplemented]).size === 14,
      `implemented ${implemented.join(',')} | partial ${partial.join(',')} | not ${notImplemented.join(',')}`);

    // Every dcmaLabel must name a check DCMA_COVERAGE calls implemented or
    // partial. A label naming a check the map says is NOT implemented is the
    // decorative mislabel that caused this defect; a label is not evidence.
    const labelled = new Set<number>();
    for (const line of health.split('\n')) {
      if (!/dcmaLabel\s*:/.test(line)) continue;
      for (const m of line.matchAll(/DCMA #(\d+)/g)) labelled.add(Number(m[1]));
    }
    const okSet = new Set([...implemented, ...partial]);
    const decorative = [...labelled].filter(c => !okSet.has(c));
    ok('no dcmaLabel names a check DCMA_COVERAGE says is not implemented',
      decorative.length === 0,
      decorative.length ? `#${decorative.join(', #')} is displayed on a check that does not compute it — that mislabel is what the marketing copy read and repeated` : undefined);
    const unlabelled = [...okSet].filter(c => !labelled.has(c));
    ok('every check DCMA_COVERAGE claims is labelled in the UI', unlabelled.length === 0,
      unlabelled.length ? `DCMA_COVERAGE claims #${unlabelled.join(', #')} but no dcmaLabel names it` : undefined);

    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
      'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen'];
    const sched = prose('marketing/features/scheduling.html');

    ok(`features/scheduling.html says "${WORDS[implemented.length]} of the fourteen"`,
      new RegExp(`${WORDS[implemented.length]} of the fourteen`, 'i').test(sched),
      `DCMA_COVERAGE.implemented has ${implemented.length} entries (#${implemented.join(', #')}) — update the copy to match`);

    // Both directions, and the proxy and the misses each get their own list so
    // a check cannot quietly move between buckets in the copy.
    const listed = (label: string) => {
      const block = new RegExp(`<strong>${label}[^<]*</strong>([\\s\\S]*?)</li>`).exec(sched)?.[1] ?? '';
      return new Set([...block.matchAll(/#(\d+)/g)].map(m => Number(m[1])));
    };
    const claimedRunning = listed('Running today');
    ok('every DCMA check the page says runs, runs',
      [...claimedRunning].every(c => impl.has(c)),
      `page claims #${[...claimedRunning].filter(c => !impl.has(c)).join(', #')} which DCMA_COVERAGE does not list as implemented`);
    ok('every DCMA check the code runs is named on the page',
      implemented.every(c => claimedRunning.has(c)),
      `DCMA_COVERAGE implements #${implemented.filter(c => !claimedRunning.has(c)).join(', #')} which the page does not name`);
    const claimedProxy = listed('Running as a proxy');
    ok('the page names exactly the checks DCMA_COVERAGE calls partial',
      claimedProxy.size === partial.length && partial.every(c => claimedProxy.has(c)),
      `DCMA_COVERAGE.partial is #${partial.join(', #')}; the page says #${[...claimedProxy].join(', #')}`);
    const claimedMissing = listed('Not running');
    ok('the page names exactly the checks DCMA_COVERAGE says do not run',
      claimedMissing.size === notImplemented.length && notImplemented.every(c => claimedMissing.has(c)),
      `DCMA_COVERAGE.notImplemented is #${notImplemented.join(', #')}; the page says #${[...claimedMissing].join(', #')}`);

    // The comparison-table row states the same numbers in words. If the count
    // changes it must go red too, or the page nobody re-reads keeps the old one.
    const vsc = prose('marketing/features/vs-competitors.html');
    ok('the vs-competitors DCMA row states the same count as the code',
      new RegExp(`${WORDS[implemented.length]} of the fourteen`, 'i').test(vsc),
      `that row is the version most buyers actually read; DCMA_COVERAGE implements ${implemented.length}`);

    // The excuse the audit's own report proposed, and which is false: #6 is
    // float > 44 working days and is a few lines away. (#12 needs a
    // perturbation run and #14 needs a data date — real reasons, not this one.)
    const noExcuse = pages.filter(p => /need data a residential schedule/i.test(prose(p)));
    ok('no page excuses the missing checks as un-computable', noExcuse.length === 0,
      noExcuse.length ? `#6 is float > 44 working days — found in: ${noExcuse.join(', ')}` : undefined);
  }

  // ── 3. One annual price, one stack total, stated in one place ─────────────
  // Four annual representations across five pages ($288, "~$24/mo effective",
  // $299, and an UNLABELLED $348 that was really the month-to-month
  // annualisation) and three stack totals ($360–920, $360–910, $396–703).
  // A buyer who finds two prices assumes the lower is stale and stops trusting
  // the arithmetic everywhere else.
  {
    const RETIRED: { pattern: RegExp; why: string }[] = [
      { pattern: /\$299\b/, why: 'a fourth annual price that matches no tier' },
      { pattern: /\$360\s*[–-]\s*\$?9(1|2)0/, why: 'a second stack total; the itemised eight-category one on vs-competitors is canonical' },
    ];
    for (const { pattern, why } of RETIRED) {
      const hits = pages.filter(p => pattern.test(prose(p)));
      ok(`no page prints /${pattern.source.slice(0, 26)}/`, hits.length === 0,
        hits.length ? `${why} — found in: ${hits.join(', ')}` : undefined);
    }
    // $348 and $948 are the month-to-month annualisations. They are fine to
    // print — but never bare, because bare they read as the annual price.
    for (const fig of ['348', '948']) {
      const unlabelled = pages.filter(p => {
        const t = prose(p);
        if (!new RegExp(`\\$${fig}\\b`).test(t)) return false;
        return !new RegExp(`\\$${fig}\\b[\\s\\S]{0,200}?month-to-month|month-to-month[\\s\\S]{0,200}?\\$${fig}\\b`).test(t);
      });
      ok(`every page printing $${fig} labels it month-to-month`, unlabelled.length === 0,
        unlabelled.length ? `an annualised monthly total printed as if it were the annual price — ${unlabelled.join(', ')}` : undefined);
    }
    // THE PRICE LIST IS BOUND TO THE CODE, NOT TO LITERALS.
    // The previous version of this block asserted the literals $288, $792 and
    // $999.99 - so it certified two numbers that exist nowhere in the product.
    // $288/$792 were somebody's arithmetic; the only annual prices the app
    // knows are components/Paywall.tsx FALLBACK_PRICES ($289.99 / $769.99 /
    // $999.99, "these mirror the App Store Connect product prices"), and
    // Business was understated by $22 in the customer's disfavour.
    // The monthly figures disagree in the code too: app/paywall.tsx falls back
    // to $29/$79/$150 and calls that the published list rate, while
    // components/Paywall.tsx says the store products are $29.99/$79.99/$149.99.
    // While those two tables disagree, no annual figure on this site can be
    // trusted, so the site must print none - and this check flips the moment
    // somebody reconciles them, at which point it demands the figure back.
    const pricing3 = prose('marketing/pricing.html');
    const paywallScreen = readFileSync('app/paywall.tsx', 'utf8');
    const paywallModal = readFileSync('components/Paywall.tsx', 'utf8');
    const listRate: Record<string, string> = {};
    for (const m of paywallScreen.matchAll(
      /(pro|business|enterprise)Package\?\.product\?\.priceString \?\? \(packagesStillLoading \? null : '(\$[\d.]+)\/mo'\)/g)) {
      listRate[m[1]] = m[2];
    }
    const storePrice: Record<string, { monthly: string; annual: string }> = {};
    for (const m of paywallModal.matchAll(
      /(pro|business|enterprise):\s*\{\s*monthly:\s*'(\$[\d.]+)',\s*annual:\s*'(\$[\d.]+)'/g)) {
      storePrice[m[1]] = { monthly: m[2], annual: m[3] };
    }
    ok('both in-code price tables are still parseable',
      Object.keys(listRate).length === 3 && Object.keys(storePrice).length === 3,
      `app/paywall.tsx fallbacks: ${JSON.stringify(listRate)} | components/Paywall.tsx FALLBACK_PRICES: ${JSON.stringify(storePrice)}`);

    // Exactly one monthly figure per tier on the pricing page. The Enterprise
    // tier card said $150 and the FAQ 121 lines below said $149.99, and the
    // old guard passed with both of them on the page.
    for (const tier of ['pro', 'business', 'enterprise']) {
      const shown = listRate[tier];
      const other = storePrice[tier]?.monthly;
      ok(`pricing.html prints ${tier}'s monthly rate exactly as the app does (${shown})`,
        !!shown && pricing3.includes(shown) && (shown === other || !pricing3.includes(other ?? ' ')),
        `the app's upgrade screen shows ${shown}; the store product is ${other}. The page must print one of those and only one - it printed both.`);
    }

    const tablesAgree = ['pro', 'business', 'enterprise'].every(
      t => listRate[t] === storePrice[t]?.monthly);

    // WHAT COUNTS AS "OUR ANNUAL PRICE", COMPUTED RATHER THAN LISTED.
    // Banning the literals $288/$792 would only stop those two strings; the
    // next person writes $290. So: find every dollar amount presented as a
    // YEARLY TOTAL (the amount adjacent to the year unit, which is why
    // "$105 a month, billed annually" -- a real competitor rate on
    // /proof.html -- does not match), then keep the ones that fall in a
    // DISCOUNTED-ANNUAL band around one of our own monthly rates read out of
    // app/paywall.tsx. Twelve times the monthly rate is excluded on purpose:
    // $348 and $948 are the month-to-month annualisations, they are honest
    // arithmetic, and the check below already forces them to be labelled.
    // Verified against the whole site: this catches exactly our own annual
    // figures and none of the competitor ones ($6,000-$12,000/yr Procore,
    // +$6,240/yr savings, $329/mo Knowify Advanced all fall outside).
    const YEARLY = /\$([\d,]+(?:\.\d{2})?)\s*(?:\/\s*(?:yr|year)\b|\s+(?:a|per)\s+year\b|\s+billed annually\b)/gi;
    const ourAnnual: { page: string; text: string }[] = [];
    // Tags stripped as well as comments: compare/procore.html wrote
    // '<strong>$288</strong> billed annually', which a tag-blind scan reads as
    // two unrelated fragments and lets straight through.
    const flat = (pg: string) => prose(pg).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ');
    for (const pg of pages) {
      for (const m of flat(pg).matchAll(YEARLY)) {
        const v = Number(m[1].replace(/,/g, ''));
        const monthly = Object.values(listRate).map(x => Number(x.replace('$', '')));
        if (!monthly.some(mo => v >= mo * 5 && v <= mo * 11.9)) continue;
        // A figure the page itself calls the month-to-month annualisation is
        // honest arithmetic on the published rate, not a second annual price.
        // (Excluding it by multiplier alone breaks the moment the monthly rate
        // gains cents: $348 sits inside 11.9 x $29.99.) The sibling check
        // below is what forces that label to be there.
        const near = flat(pg).slice(Math.max(0, m.index - 220), m.index + 220);
        if (/month-to-month/i.test(near)) continue;
        ourAnnual.push({ page: pg, text: m[0] });
      }
    }
    if (!tablesAgree) {
      ok('no page quotes our yearly price while the code disagrees with itself about the monthly one',
        ourAnnual.length === 0,
        `app/paywall.tsx says ${JSON.stringify(listRate)} and components/Paywall.tsx says ${JSON.stringify(
          Object.fromEntries(Object.entries(storePrice).map(([k, v]) => [k, v.monthly])))}. Until one of those is wrong and fixed, any discounted annual figure on this site is a guess - found: ${ourAnnual.map(x => `${x.page} "${x.text}"`).join(' | ')}`);
      ok('pricing.html says out loud why the yearly figure is missing',
        /not.{0,40}printing a yearly dollar figure/i.test(pricing3),
        'a blank where a price should be reads as an oversight unless the page names it as a decision');
      // AND NO PAGE MAY SEND THE READER THERE FOR A NUMBER THAT ISN'T THERE.
      // features/vs-competitors.html footnote 3 said "the discounted annual
      // price is on the pricing page, which is the only page that states it" -
      // written before the self-correction two paragraphs above deleted that
      // figure. Removing the price and leaving the cross-reference is worse
      // than either alone: the reader clicks, finds nothing, and concludes the
      // site is hiding it. Absence has to be stated in both places or neither.
      const PROMISES_THE_FIGURE = /(only page that states it|(discounted )?annual price is on the[\s\S]{0,60}pricing page)/i;
      const promisers = pages.filter(pg => PROMISES_THE_FIGURE.test(prose(pg)));
      ok('no page points the reader at a yearly figure the pricing page deliberately withholds',
        promisers.length === 0,
        promisers.length ? `pricing.html states no yearly dollar figure while the two in-code price tables disagree; a cross-reference to it is a dead end - found in: ${promisers.join(', ')}` : undefined);
    } else {
      // The tables were reconciled. The blank is no longer honest - it is just
      // a missing price now, so this side of the check demands it back, on the
      // one page that is allowed to carry it.
      ok('the two in-code price tables now agree - pricing.html must state the annual figures',
        ['pro', 'business', 'enterprise'].every(t => pricing3.includes(storePrice[t].annual)),
        `state ${['pro', 'business', 'enterprise'].map(t => `${t} ${storePrice[t].annual}`).join(', ')} and delete the "we are not printing a yearly figure" paragraph`);
      ok('the annual figure is still stated on exactly one page',
        ourAnnual.every(x => x.page === 'marketing/pricing.html'),
        `restating it elsewhere is how four different annual numbers got into circulation - found: ${ourAnnual.filter(x => x.page !== 'marketing/pricing.html').map(x => x.page).join(', ')}`);
    }

    // And the canonical stack total is anchored so the other pages can link it.
    ok('the canonical stack total has an anchor to link to',
      /id="stack"/.test(readFileSync('marketing/features/vs-competitors.html', 'utf8')));
    for (const p of ['marketing/pricing.html', 'marketing/features/vs-other-tools.html']) {
      ok(`${p.replace('marketing/', '')} links the canonical stack total rather than computing one`,
        /vs-competitors\.html#stack/.test(prose(p)));
    }
  }

  // ── 4. Claims that were false against the code ───────────────────────────
  {
    const FALSE_CLAIMS: { pattern: RegExp; why: string }[] = [
      { pattern: /named CSM/i, why: 'there is no customer-success manager; support.html says one person answers' },
      { pattern: /live supplier data/i, why: 'nothing fetches supplier prices — constants/regions.ts is a static index' },
      { pattern: /nine major metros/i, why: 'CITY_ADJUSTMENTS holds exactly 20 cities; nine matches nothing' },
      { pattern: /Live material pricing from local suppliers/i, why: 'same — there is no supplier feed' },
      { pattern: /authentic AIA form layout/i, why: 'the product says AIA-STYLE and carries a trademark disclaimer; the site must too' },
      { pattern: /\+\s*Math\.round\(k\s*\*\s*38\)/, why: 'the invented "+38% accuracy" counter — no customers, no measurement' },
      { pattern: /prices like your best estimator/i, why: 'an outcome claim with nothing behind it' },
      { pattern: /\$30\s*[–-]\s*80K/i, why: 'unsourced per-job buyout-savings promise; there is no customer to have measured it' },
      { pattern: /Everyone else charges \$99 to \$199/i, why: 'refutable — Contractor Foreman Basic is $49/mo for one user on annual billing' },
      { pattern: /ASC\s*606[^)]{0,40}loss/i, why: 'ASC 606 has no onerous-contract provision; the construction full-loss rule is ASC 605-35 (utils/wip.ts:139-141 gets this right)' },
      { pattern: /the only construction app that/i, why: 'an exhaustive negative claim across a category with hundreds of products — use the checkable "cheapest we could find" form' },
    ];
    for (const { pattern, why } of FALSE_CLAIMS) {
      const hits = pages.filter(p => pattern.test(prose(p)));
      ok(`no page claims /${pattern.source.slice(0, 32)}/`, hits.length === 0,
        hits.length ? `${why} — found in: ${hits.join(', ')}` : undefined);
    }
    // AIA appears on 11 pages. Wherever it appears it must be hedged, because
    // the generated document itself is (utils/aiaBilling.ts:937) and the
    // largest published-price competitor uses the same hedge on its own
    // pricing page. The hedge costs nothing and reads as more expert.
    //
    // ONE EXCLUSION, NAMED. marketing/portal/index.html is the client-facing
    // portal shell and is owned by the AIA work, not by the marketing copy —
    // it is excluded here rather than silently passing, and the list is
    // asserted not to grow, so the next page that needs an exemption has to be
    // argued for rather than added.
    const AIA_HEDGE_EXEMPT = ['marketing/portal/index.html'];
    const unqualified = pages.filter(p => {
      const t = prose(p).replace(/AIA-style/gi, '');
      return /AIA\s+(G70[23]|pay\s*app|Pay\s*App|billing|progress)/i.test(t);
    });
    ok('every marketing mention of AIA is hedged as AIA-style',
      unqualified.every(p => AIA_HEDGE_EXEMPT.includes(p)),
      `unqualified AIA claim in: ${unqualified.filter(p => !AIA_HEDGE_EXEMPT.includes(p)).join(', ')}`);
    ok('the AIA hedge exemption list has not grown', AIA_HEDGE_EXEMPT.length === 1,
      'every page added here is a page that tells a GC they are getting an official AIA form');

    // Hedging the noun is half of it. The generated PDF carries a
    // non-affiliation notice (utils/aiaBilling.ts:937) and app/aia-pay-app.tsx
    // shows one on first use; a page that sells the feature has to carry it
    // too, or the GC finds out on their first submitted draw.
    const mentionsAIA = pages.filter(p => /\bAIA\b/.test(prose(p)) && !AIA_HEDGE_EXEMPT.includes(p));
    const noNotice = mentionsAIA.filter(p => !/American Institute of Architects/.test(prose(p)));
    ok(`every page that mentions AIA carries the non-affiliation notice (${mentionsAIA.length} pages)`,
      noNotice.length === 0,
      noNotice.length ? `missing on: ${noNotice.join(', ')}` : undefined);
  }

  // ── 5. Weather says one thing on every page ──────────────────────────────
  // Four pages hedged weather reflow as roadmap while a comparison table
  // answered "Yes". The feature exists (utils/weatherReschedule.ts,
  // components/schedule/WeatherRescheduleModal.tsx), so the roadmap hedges were
  // the wrong half — but the "Yes" is only honest alongside the simulated-day
  // caveat, because a production build without an OpenWeather key falls back to
  // getSimulatedForecast().
  {
    const hedged = pages.filter(p => {
      const t = prose(p);
      return /weather[^.<]{0,80}(on the roadmap|coming soon)/i.test(t)
        || /weather-aware[^.<]{0,40}roadmap/i.test(t);
    });
    ok('no page still hedges weather reflow as roadmap', hedged.length === 0,
      hedged.length ? `utils/weatherReschedule.ts shipped — found in: ${hedged.join(', ')}` : undefined);
    ok('the weather claim carries its simulated-day caveat somewhere',
      /SIMULATED WEATHER/i.test(prose('marketing/features/scheduling.html'))
      && /refuses to record/i.test(prose('marketing/features/scheduling.html')),
      'a build with no OpenWeather key falls back to getSimulatedForecast(); the app labels it and refuses the delay log, and so must the page');
  }

  // ── 6. Lien waivers and 1099 shipped; the page must not call them roadmap ─
  {
    const t = prose('marketing/features/vs-competitors.html');
    ok('lien waivers are not listed as roadmap on a page whose table sells them',
      !/Lien waiver auto-generation[\s\S]{0,200}?roadmap/i.test(t),
      'utils/lienWaiverEngine.ts + app/lien-waivers.tsx shipped, gated at pro (featureTiers lien_waiver_manager)');
    ok('1099 generation is not listed as queued',
      !/1099[\s\S]{0,80}?is queued/i.test(t),
      'app/tax-1099-export.tsx + utils/tax1099Export.ts exist, and pricing.html lists 1099-NEC on Free');
    ok('QuickBooks is not described as in active development',
      !pages.some(p => /QuickBooks[\s\S]{0,120}?In active development/i.test(prose(p))),
      'five qbo-* edge functions are deployed and qbo-sync gates on requireTier([business,enterprise])');
  }

  // ── 7. WIP is sold at the tier it is gated to ────────────────────────────
  {
    const wipTier = REQUIRED_TIER['wip_reporting'];
    const fin = prose('marketing/features/financials.html');
    ok(`features/financials.html names WIP's real tier (${wipTier})`,
      new RegExp(wipTier, 'i').test(fin) && /WIP report/i.test(fin),
      'the page led with WIP and named no tier at all, so the mismatch was discovered at the paywall');
    ok('vs-competitors CTA no longer promises a WIP report at the Pro price',
      !/first WIP report[\s\S]{0,80}?\$29/i.test(prose('marketing/features/vs-competitors.html')),
      `featureTiers gates wip_reporting to '${wipTier}'`);
  }

  // ── 8. No empty "Preview coming" frames ─────────────────────────────────
  {
    const frames = pages.filter(p => /phone-ph-tag/.test(prose(p)));
    ok('no page ships an empty placeholder frame', frames.length === 0,
      frames.length ? `an empty box labelled "coming" signals an unfinished product more loudly than no box — found in: ${frames.join(', ')}` : undefined);
  }

  // ── 9. One nav, and the trust pages are reachable from everywhere ────────
  {
    const NAV = ['/playbook.html', '/features/', '/compare/', '/pricing.html', '/demo.html', '/support.html'];
    // TWO PAGES NOT YET UNIFIED, NAMED RATHER THAN SKIPPED SILENTLY.
    // marketing/brain/ and marketing/widget/ each carry a fourth and fifth nav
    // variant and belong to other work in flight; they are listed here so the
    // exception is visible and finite, and the count is asserted so the list
    // cannot quietly grow into "the nav is whatever each page felt like".
    const NAV_NOT_YET_UNIFIED = ['marketing/brain/index.html', 'marketing/widget/index.html'];
    ok('the un-unified nav list is still just the two known pages', NAV_NOT_YET_UNIFIED.length === 2);
    // THE CHECK MUST LOOK INSIDE THE NAV, NOT AT THE WHOLE FILE.
    // The first version of this was `t.includes('href="/features/"')` over the
    // entire page, so a footer that happened to repeat the links satisfied it
    // and a page could ship with no primary nav at all. Deleting five of the
    // six links out of calculator.html's <div class="nav-r"> - which IS the
    // defect this check was written to prevent - left it green.
    const navOf = (p: string) => {
      const t = prose(p);
      // index.html's is a <span class="navlinks">, calculator's a
      // <div class="nav-r">, everyone else's a <div class="nav-inner"> - so
      // match whatever tag it is, and prefer the whole enclosing <nav>, since
      // the six links can sit across sibling elements inside it.
      for (const n of t.match(/<nav\b[\s\S]*?<\/nav>/g) ?? []) {
        if (/class="[^"]*\b(nav-inner|navlinks|nav-r)\b/.test(n)) return n;
      }
      const m = /<([a-z]+)[^>]*class="[^"]*\b(nav-inner|navlinks|nav-r)\b[^"]*"[\s\S]*?<\/\1>/.exec(t);
      return m?.[0] ?? '';
    };
    const navPages = pages.filter(p => /class="[^"]*\b(nav-inner|navlinks|nav-r)\b/.test(prose(p)))
      .filter(p => !NAV_NOT_YET_UNIFIED.includes(p));
    ok('the nav element itself is findable on every page that claims one',
      navPages.every(p => navOf(p).length > 0),
      `if this cannot find the element it cannot check it, and a whole-file scan is what let the third nav ship: ${navPages.filter(p => !navOf(p)).join(', ')}`);
    const oddNav = navPages.filter(p => { const n = navOf(p); return !NAV.every(h => n.includes(`href="${h}"`)); });
    ok('every page with a primary nav carries the same six destinations',
      oddNav.length === 0,
      oddNav.length ? `three different navs shipped; odd ones out: ${oddNav.map(p => `${p} (missing ${NAV.filter(h => !navOf(p).includes(`href="${h}"`)).join(' ')})`).join(', ')}` : undefined);

    const TRUST = ['proof.html', 'who-built-this.html', 'changelog.html', 'switch.html'];
    for (const t of TRUST) ok(`marketing/${t} exists`, pages.includes(`marketing/${t}`));
    // Same lesson as the nav: this used to be a whole-file includes(), so a
    // page that mentioned /proof.html once in its body passed with the strip
    // deleted. It now reads the strip element itself.
    const stripOf = (p: string) => /<nav class="trust-strip"[\s\S]*?<\/nav>/.exec(prose(p))?.[0] ?? '';
    const missing = navPages.filter(p => {
      const strip = stripOf(p);
      return !strip || !TRUST.every(h => strip.includes(`href="/${h}"`));
    });
    ok('every public page links the trust pages', missing.length === 0,
      missing.length ? `a buyer checks for reviews in the second tab; staying silent reads as hiding — missing on: ${missing.join(', ')}` : undefined);

    // The strip sits in footers on BOTH grounds — ink on most pages, cream on
    // builders/. Its first draft framed the links with a muted <span>, which
    // inherited each footer's secondary grey and measured 2.80:1 against cream,
    // under the 4.5:1 AA floor at 12.5px. Putting the words inside the link
    // makes every glyph take the page's own link colour (measured 16.99:1 on
    // cream, 6.79:1 amber-on-ink). Two rules keep it that way: no separately
    // coloured element inside the strip, and a border that reads on both.
    // `>= 25` against 28 pages let the strip be deleted from three of them
    // before the count noticed. The set is now derived: every page that has a
    // <footer> must have the strip in it, no floor to hide behind.
    // robots.txt disallows /portal/ and /sub-portal/: they are the signed-in
    // client and subcontractor surfaces, not pages a buyer lands on, and the
    // trust strip would be addressed to nobody there. Named rather than
    // skipped by a fuzzy rule, with the length pinned so it cannot grow.
    const NOT_PUBLIC = ['marketing/portal/index.html', 'marketing/sub-portal/index.html'];
    ok('the not-a-public-page list is still just the two gated surfaces', NOT_PUBLIC.length === 2);
    const footerPages = pages.filter(p => /<footer/.test(prose(p)) && !NOT_PUBLIC.includes(p));
    const stripPages = pages.filter(p => prose(p).includes('trust-strip'));
    const stripless = footerPages.filter(p => !stripPages.includes(p));
    ok(`the trust strip is on every page that has a footer (${footerPages.length})`,
      stripless.length === 0,
      stripless.length ? `a footer without it is a page where the buyer never learns we have no reviews - missing on: ${stripless.join(', ')}` : undefined);
    const recoloured = stripPages.filter(p => {
      // Comments stripped first: the strip carries an explanatory comment that
      // names the retired <span>, and a bare search would read the explanation
      // as the thing it explains — the same trap the bulkSavings block hit.
      const strip = /<nav class="trust-strip"[\s\S]*?<\/nav>/.exec(prose(p))?.[0] ?? '';
      return /<span/.test(strip) || /opacity:/.test(strip) || /color:\s*#/.test(strip);
    });
    ok('nothing in the trust strip overrides the footer\'s own text colour', recoloured.length === 0,
      recoloured.length ? `a muted span here measured 2.80:1 on the cream-ground pages — found in: ${recoloured.join(', ')}` : undefined);
    const badBorder = stripPages.filter(p => !readFileSync(p, 'utf8').includes('border-top:1px solid rgba(128,128,128,0.3)'));
    ok('the trust strip\'s rule reads on a light footer as well as a dark one', badBorder.length === 0,
      badBorder.length ? `a white-alpha border is invisible on the cream pages — found in: ${badBorder.join(', ')}` : undefined);
    ok('/proof.html says out loud that there are no reviews',
      /no reviews/i.test(prose('marketing/proof.html')));
    ok('data export is surfaced on a conversion page, not only in a support FAQ',
      /Data Export/i.test(prose('marketing/pricing.html')),
      'support.html:130 always mentioned it; no page that asks for money did');
    // The export comment in utils/dataExport.ts calls a named competitor's
    // export "near-impossible". That is unsubstantiated disparagement and must
    // not be lifted onto a page that otherwise footnotes every rival claim.
    ok('no page repeats the source comment\'s disparagement of a named competitor',
      !pages.some(p => /near-impossible/i.test(prose(p))),
      'surface the capability, not utils/dataExport.ts:15-18');
  }

  // ── 10. Three fixes that nothing pinned, and one that nothing linked ──────
  // Every claim below could be silently reverted while this file stayed green:
  // the seat counts, the data-retention paragraph, the metro list, and the
  // weather caveat. Each is now bound to the thing it describes.
  {
    // (a) SEATS. utils/seatModel.ts is the source. The site is allowed to say
    // "no per-seat fees" (SEAT_OVERAGE_BILLING_ENABLED is false and the server
    // only seat-checks billable roles) but NOT "a flat price for your whole
    // company", which was on four pages twelve times including inside JSON-LD
    // that Google renders as a rich result. A Pro account with three office
    // admins is not the whole company.
    const seatSrc = readFileSync('utils/seatModel.ts', 'utf8');
    const seatBlock = /INCLUDED_ADMIN_SEATS[^=]*=\s*\{([\s\S]*?)\}/.exec(seatSrc)?.[1] ?? '';
    const seats: Record<string, number> = {};
    for (const m of seatBlock.matchAll(/(free|pro|business|enterprise)\s*:\s*(\d+)/g)) seats[m[1]] = Number(m[2]);
    ok('utils/seatModel.ts INCLUDED_ADMIN_SEATS is still parseable', Object.keys(seats).length === 4,
      JSON.stringify(seats));
    const WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
      'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
    const seatsBlockHtml = /<div class="seats-notice"[\s\S]*?<\/div>/.exec(prose('marketing/pricing.html'))?.[0] ?? '';
    ok('pricing.html carries the seat block', seatsBlockHtml.length > 0);
    for (const tier of ['pro', 'business', 'enterprise']) {
      const w = WORD[seats[tier]];
      ok(`pricing.html states ${tier}'s included office seats as ${w} (${seats[tier]})`,
        new RegExp(`\\b${w}\\b`, 'i').test(seatsBlockHtml),
        `INCLUDED_ADMIN_SEATS.${tier} is ${seats[tier]}; the block must say so, because the moment of discovery is otherwise an invite dialog`);
    }
    const overstates = pages.filter(p => /whole company|per-seat math/i.test(prose(p)));
    ok('no page sells the price as covering "your whole company"',
      overstates.length === 0,
      overstates.length ? `INCLUDED_ADMIN_SEATS caps office seats at ${seats.pro}/${seats.business}/${seats.enterprise}; "no per-seat fees" is true and may stay, "whole company" is not - found in: ${overstates.join(', ')}` : undefined);

    // (b) DATA RETENTION. Three pages gave three different answers, one of
    // them ("90 days after cancel") a policy no code enforces. They now carry
    // one identical paragraph; nothing made them stay identical.
    const RETENTION = ['marketing/demo.html', 'marketing/pricing.html', 'marketing/support.html'];
    const para = (p: string) => {
      // Just the FIRST block after the marker. pricing.html follows the shared
      // paragraph with its own "try the export on day one" pitch; swallowing
      // that made the three look different when the policy itself matched.
      const m = /ONE POLICY, WORD FOR WORD[\s\S]*?-->\s*(?:<p>)?([\s\S]*?)(?:<\/p>|\n\s*<\/)/.exec(readFileSync(p, 'utf8'));
      return (m?.[1] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    };
    const texts = RETENTION.map(para);
    ok('the data-retention answer is present on all three pages that give one',
      texts.every(t => t.length > 120),
      `demo/pricing/support each answer "what happens to my data if I cancel"; lengths ${texts.map(t => t.length).join('/')}`);
    ok('the three data-retention answers are word for word identical',
      new Set(texts).size === 1,
      `they were three different policies once, one of them a 90-day window nothing in the code enforces: ${texts.map((t, i) => `${RETENTION[i]}=${t.slice(0, 60)}`).join(' || ')}`);
    ok('no page still promises the retention window nothing enforces',
      !pages.some(p => /90 days after (you )?cancel/i.test(prose(p))));

    // (c) THE METRO LIST. features/marketplace.html names the nine metros the
    // supplier directory queries. They are a literal array in the edge
    // function; two of the nine on the page used to be cities the code has
    // never queried, and nothing would have caught putting them back.
    const fx = readFileSync('supabase/functions/fetch-external-data/index.ts', 'utf8');
    const metroBlock = /const metros = \[([\s\S]*?)\]/.exec(fx)?.[1] ?? '';
    const metros = [...metroBlock.matchAll(/name:\s*'([^']+)'/g)].map(m => m[1]);
    ok('the metro array in fetch-external-data is still parseable', metros.length > 0, metros.join(', '));
    const mkt = prose('marketing/features/marketplace.html');
    ok(`features/marketplace.html names the ${WORD[metros.length]} metros the code queries`,
      new RegExp(`${WORD[metros.length]} metros`, 'i').test(mkt),
      `the code queries ${metros.length}: ${metros.join(', ')}`);
    const wrongMetro = metros.filter(m => !mkt.includes(m));
    ok('every metro the code queries is named on the page', wrongMetro.length === 0,
      wrongMetro.length ? `missing: ${wrongMetro.join(', ')}` : undefined);
    // And the reverse: San Antonio and San Diego were on the page and have
    // never been queried. Any US city named in the indexed-metros line must be
    // in the array.
    const listed = /Indexed metros:([^<]*)/.exec(mkt)?.[1] ?? '';
    const invented = listed.split(',').map(x => x.trim()).filter(Boolean).filter(x => !metros.includes(x));
    ok('the page names no metro the code has never queried', invented.length === 0,
      invented.length ? `not in the fetch-external-data array: ${invented.join(', ')}` : undefined);

    // (d) THE WEATHER CAVEAT, WHEREVER THE CLAIM IS MADE.
    // eas.json carries no EXPO_PUBLIC_OPENWEATHER_API_KEY in either release
    // profile, so a production build's forecast is ALWAYS simulated - the app
    // labels it "SIMULATED WEATHER - NOT A FORECAST" and refuses to write a
    // delay-day record from it. The caveat was written once, on
    // features/scheduling.html, and three pages that sell weather reflow four
    // times over never linked it.
    const CAVEAT = /#weather|SIMULATED WEATHER|simulated day|no live forecast/i;
    const CLAIMS = /weather[- ]aware (reflow|resched|schedul)|weather auto-reschedule|around the weather, automatically/i;
    const uncaveated = pages.filter(p => CLAIMS.test(prose(p)) && !CAVEAT.test(prose(p)));
    ok('every page that sells weather reflow carries or links the simulated-day caveat',
      uncaveated.length === 0,
      uncaveated.length ? `no OPENWEATHER key in either eas.json release profile means every production forecast is simulated - found in: ${uncaveated.join(', ')}` : undefined);
  }

  // ── 11. The three things the buyer checks in the first thirty seconds ─────
  {
    // (a) THE HERO. It sold "a brain for your business" and nothing above the
    // fold was checkable by a stranger: AIA, G702, WIP and float appeared
    // nowhere on the homepage. The brain line stays; the subhead now names the
    // three engines and one sourced price comparison. NOT the absolute the
    // audit proposed - "the only construction app that..." is an exhaustive
    // negative over a category with 866 Capterra entries, and is separately
    // banned above.
    const heroSrc = readFileSync('marketing/index.html', 'utf8');
    const hero = /<section class="hero">[\s\S]*?<\/section>/.exec(prose('marketing/index.html'))?.[0] ?? '';
    ok('the homepage hero is findable', hero.length > 0);
    for (const word of ['G702', 'WIP', 'float']) {
      ok(`the hero names "${word}" - something the buyer can check`,
        new RegExp(`\\b${word}\\b`, 'i').test(hero),
        'a vendor with no reviews, no logos and no App Store listing cannot lead with an unverifiable abstraction');
    }
    ok('the hero states a sourced competitor price rather than an absolute',
      /cheapest published plan we could find/i.test(hero),
      'the checkable form. "The only construction app that..." cannot be substantiated and is banned elsewhere in this file');

    // (b) THE CHART CARD'S ARIA STATE. The card was aria-hidden back when it
    // held only a decorative curve and an invented "+38%". It now carries two
    // real links, and a focusable link inside an aria-hidden subtree hides the
    // honest half of the claim from the readers most likely to need it.
    const card = /<div class="chartcard[\s\S]*?<\/div>\s*<\/div>/.exec(heroSrc)?.[0] ?? '';
    ok('the chart card itself is not hidden from assistive tech',
      card.length > 0 && !/<div class="chartcard[^>]*aria-hidden/.test(card),
      'it contains two links; only the decorative <canvas> may be aria-hidden');
    ok('the decorative canvas still is hidden from assistive tech',
      /<canvas id="accChart"[^>]*aria-hidden="true"/.test(heroSrc));

    // (c) ACCOUNTS PAYABLE. The bookkeeper looks for a payables aging report in
    // week one. "We don't do AP" is as misleading as claiming it, because the
    // job-cost half genuinely is here - so the boundary is stated exactly, on
    // the page that asks for money and on the page someone reads while leaving
    // a tool that did have AP.
    for (const pg of ['marketing/pricing.html', 'marketing/switch.html']) {
      const t = prose(pg);
      ok(`${pg.replace('marketing/', '')} answers the accounts-payable objection`,
        /payables ledger/i.test(t) && /vendor aging/i.test(t) && /never moves money|does not move money/i.test(t),
        'utils/apReconciliation.ts:1-8 is explicit that MAGE does not move money and that a paid flag with no reference is a bare status flip; say both');
    }

    // (d) THE AIA PRICE TABLE. The one comparison where the gap is widest, and
    // the two vendors a GC actually shortlists for progress billing on a
    // budget. Both must be named, and no row may compare across billing terms
    // - the audit's own draft set JobTread's month-to-month rate beside two
    // annual rates and understated a four-person office by $46 in our favour.
    const cmp = prose('marketing/compare/index.html');
    for (const vendor of ['Knowify', 'Contractor Foreman']) {
      ok(`compare/index.html names ${vendor} on the AIA axis`, cmp.includes(vendor),
        'neither word appeared anywhere on this site while both are the real shortlist for cheap AIA-style billing');
    }
    const aiaTable = /<h2[^>]*id="aia"[\s\S]*?<\/table>/.exec(cmp)?.[0] ?? '';
    ok('the AIA price table is findable', aiaTable.length > 0);
    const rows = [...aiaTable.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1]).slice(1);
    const termless = rows.filter(r => !/Billed annually|Month-to-month|Quote only|Annual contract/i.test(r));
    ok('every vendor row in the AIA price table states its billing term',
      termless.length === 0,
      'a table that sets one vendor\'s month-to-month rate beside another\'s annual rate is exactly what the footnote discipline on this site exists to prevent');
    ok('the AIA price table is dated and carries the trademark footnote',
      /September 2026/.test(aiaTable) || /September 2026/.test(cmp),
      'an undated competitor price is a claim with a shelf life and no label on it');
  }

  // ── 12. Every #fragment this site links actually exists ──────────────────
  // The whole arrangement that stops the price and the seat rule drifting is
  // "state it once, link it from everywhere else". That arrangement is only as
  // good as the anchors: a link to /pricing.html#seats that lands at the top
  // of the page silently turns a qualified claim back into a bare one. Nine
  // such links were added in this pass alone.
  {
    // Scripts stripped: portal/index.html builds hrefs by concatenation
    // ('#sec-' + it.id), which is a runtime id and not a static link to check.
    const markup = (p: string) => prose(p).replace(/<script[\s\S]*?<\/script>/g, ' ');
    const idsOf = (p: string) => new Set([...prose(p).matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    const idCache = new Map<string, Set<string>>();
    const ids = (p: string) => {
      if (!idCache.has(p)) idCache.set(p, idsOf(p));
      return idCache.get(p)!;
    };
    const broken: string[] = [];
    for (const from of pages) {
      for (const m of markup(from).matchAll(/href="(\/[^"#]*)#([^"]+)"/g)) {
        let target = m[1];
        if (target.endsWith('/')) target += 'index.html';
        const file = 'marketing' + target;
        if (!pages.includes(file)) continue;      // off-site or non-page: not this check's job
        if (!ids(file).has(m[2])) broken.push(`${from} -> ${target}#${m[2]}`);
      }
      // Same-page fragments.
      for (const m of markup(from).matchAll(/href="#([^"]+)"/g)) {
        if (!ids(from).has(m[1])) broken.push(`${from} -> #${m[1]}`);
      }
    }
    ok('every in-site #fragment link lands on an element that exists',
      broken.length === 0,
      broken.length ? `a fragment that misses drops the reader at the top of the page, which is how a qualified claim quietly becomes a bare one - ${broken.join(' | ')}` : undefined);
  }

  // ── 13. THE THINGS THE FIRST PASS OF THIS SWEEP COULD NOT SEE ────────────
  // Every assertion in this section exists because the copy it checks was
  // WRONG while all 174 checks above were green. They are grouped here rather
  // than scattered so the pattern is legible: a page can be false about the
  // product in ways no ban-list and no vendor-name check will ever catch, and
  // the only fix is to bind the sentence to the constant it is a claim about.
  {
    // (a) "DO IT ON A FREE ACCOUNT" MUST BE TRUE OF THE GATE.
    // /proof.html — the trust page, written specifically so a buyer with no
    // reviews to read could check the product for themselves — told that buyer
    // to open a FREE account and export a G702. utils/featureTiers gates
    // aia_pay_app to 'pro' and app/aia-pay-app.tsx returns a full-screen
    // Paywall, so the recipe ended at the exact wall the page existed to avoid.
    // Nothing above caught it: the only tier binding in this whole file was the
    // WIP block, which checks one page for one word.
    //
    // The rule: inside a numbered recipe that says "free account", every
    // feature named must either BE free, or the recipe must name the plan.
    const RECIPE_FEATURES: { phrase: RegExp; key: keyof typeof REQUIRED_TIER; what: string }[] = [
      { phrase: /G70[23]|pay application/i, key: 'aia_pay_app', what: 'AIA-style pay applications' },
      { phrase: /WIP (report|schedule)/i, key: 'wip_reporting', what: 'the WIP schedule' },
      { phrase: /client portal/i, key: 'client_portal', what: 'the client portal' },
      { phrase: /cost x-ray/i, key: 'cost_xray', what: 'Cost X-Ray' },
      { phrase: /change order/i, key: 'change_orders_invoicing', what: 'change orders' },
    ];
    const TIER_WORD: Record<string, RegExp> = {
      pro: /\bPro\b/,
      business: /\bBusiness\b/,
      free: /\bfree\b/i,
    };
    const badRecipes: string[] = [];
    for (const pg of pages) {
      for (const m of prose(pg).matchAll(/<ol[\s\S]*?<\/ol>/g)) {
        const recipe = m[0];
        if (!/free account/i.test(recipe)) continue;
        for (const { phrase, key, what } of RECIPE_FEATURES) {
          if (!phrase.test(recipe)) continue;
          const gate = REQUIRED_TIER[key];
          if (gate === 'free') continue;
          if (TIER_WORD[gate].test(recipe)) continue;
          badRecipes.push(`${pg}: a "free account" recipe walks the reader into ${what}, which featureTiers gates to '${gate}'`);
        }
      }
    }
    ok('no page tells a free account to do something the app gates to a paid tier',
      badRecipes.length === 0,
      badRecipes.length ? `the recipe must name the plan, or pick a step a free account can finish - ${badRecipes.join(' | ')}` : undefined);
    // And that recipe must not claim it needs no human while the till is off
    // and the plan is switched on by hand.
    {
      const eas2 = JSON.parse(readFileSync('eas.json', 'utf8')) as { build?: Record<string, { env?: Record<string, string> }> };
      const sandbox = ['production', 'preview'].some(p =>
        Object.values(eas2.build?.[p]?.env ?? {}).some(v => /^rcb_sb_/.test(String(v))));
      if (sandbox) {
        ok('/proof.html does not promise a paid feature "without talking to a human being"',
          !/without talking to a human being/i.test(prose('marketing/proof.html')),
          'paid plans are switched on by hand while eas.json carries a sandbox web key - the recipe requires an email');
      } else {
        ok('till is live - the self-serve wording on /proof.html is unblocked', true);
      }
    }

    // (b) OUR OWN ROW IN THE AIA PRICE TABLE, CHECKED AGAINST THE SEAT MODEL.
    // The block above asserts the competitor rows carry a billing term and the
    // vendors are named. It never looked at OUR row - which priced a
    // four-person office at $29/mo on Pro. INCLUDED_ADMIN_SEATS.pro is 2 and
    // the account owner is not a seat (utils/seatModel.ts header), so four
    // office people is owner + 3 admins, one past Pro. That is the "flat price
    // for your whole company" overstatement this pass deleted from thirty-odd
    // places, re-committed as a number in the flagship table. Mutating
    // INCLUDED_ADMIN_SEATS.pro 2 -> 3 used to leave this table green.
    {
      const seatSrc2 = readFileSync('utils/seatModel.ts', 'utf8');
      const seatBlock2 = /INCLUDED_ADMIN_SEATS[^=]*=\s*\{([\s\S]*?)\}/.exec(seatSrc2)?.[1] ?? '';
      const seats2: Record<string, number> = {};
      for (const m of seatBlock2.matchAll(/(free|pro|business|enterprise)\s*:\s*(\d+)/g)) seats2[m[1]] = Number(m[2]);
      ok('the AIA row check can still read INCLUDED_ADMIN_SEATS', Object.keys(seats2).length === 4, JSON.stringify(seats2));
      // The owner holds no seat, so N office people need N-1 admin seats.
      const OFFICE_PEOPLE = 4;
      const needed = OFFICE_PEOPLE - 1;
      const ORDER = ['free', 'pro', 'business', 'enterprise'] as const;
      const fits = ORDER.find(t => (seats2[t] ?? 0) >= needed);
      // Monthly rate straight out of the app's own upgrade screen, the same
      // source the price block above uses - never a literal typed in here.
      const paywallSrc = readFileSync('app/paywall.tsx', 'utf8');
      const rate: Record<string, string> = {};
      for (const m of paywallSrc.matchAll(
        /(pro|business|enterprise)Package\?\.product\?\.priceString \?\? \(packagesStillLoading \? null : '(\$[\d.]+)\/mo'\)/g)) {
        rate[m[1]] = m[2];
      }
      ok('the AIA row check can still read the monthly rates', Object.keys(rate).length === 3, JSON.stringify(rate));
      const aiaTable2 = /<h2[^>]*id="aia"[\s\S]*?<\/table>/.exec(prose('marketing/compare/index.html'))?.[0] ?? '';
      const mageRow = [...aiaTable2.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1])
        .find(r => /MAGE ID/.test(r)) ?? '';
      ok('the MAGE row of the AIA price table is findable', mageRow.length > 0);
      const cells = [...mageRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
      const officeCell = cells[cells.length - 1] ?? '';
      ok(`the ${OFFICE_PEOPLE}-person-office cell quotes the cheapest tier that actually fits ${needed} office seats (${fits}, ${fits ? rate[fits] : '?'})`,
        !!fits && officeCell.includes(rate[fits] ?? ' ') && new RegExp(fits, 'i').test(officeCell),
        `INCLUDED_ADMIN_SEATS is ${JSON.stringify(seats2)} and the owner is not a seat, so ${OFFICE_PEOPLE} office people need ${needed} seats - the cheapest tier that holds them is ${fits} at ${fits ? rate[fits] : '?'}. The cell says: ${officeCell.replace(/<[^>]+>/g, '').trim()}`);
      // The seats cell has to say the owner is extra, or "2 office" reads as
      // "two people" and the four-person answer looks wrong even when it is right.
      const seatsCell = cells[3] ?? '';
      ok('the MAGE row says the account owner is on top of the included seats',
        /you \+/i.test(seatsCell),
        `the owner occupies no seat (utils/seatModel.ts), so Pro is you plus ${seats2.pro}; the cell says: ${seatsCell.replace(/<[^>]+>/g, '').trim()}`);
    }

    // (c) EVERY PRICE ON compare/index.html CARRIES ITS TERM, NOT JUST THE ROWS
    // IN THE AIA TABLE. The page printed JobTread at "$199/mo + $20/user" in
    // the top table (term buried in footnote 1) and "$159 / $18, billed
    // annually" in the new one 215 lines below - the same vendor at two prices
    // on one page, which is the defect the AIA table's own editing rule exists
    // to prevent. The termless check only ever scanned inside id="aia".
    {
      const cmp2 = prose('marketing/compare/index.html');
      const TERM = /month-to-month|billed annually|quote[- ]only|annual contract/i;
      const topTable = /<table class="compare-table">[\s\S]*?<\/table>/.exec(cmp2)?.[0] ?? '';
      ok('the top comparison table is findable', topTable.length > 0);
      const priceRow = [...topTable.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => m[1])
        .find(r => />Price<\/td>/.test(r)) ?? '';
      ok('the top table has a Price row', priceRow.length > 0);
      const priceCells = [...priceRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]).slice(1);
      const termless2 = priceCells.filter(c => !TERM.test(c));
      ok('every price cell in the top comparison table states its billing term',
        priceCells.length > 0 && termless2.length === 0,
        `a vendor quoted at two prices on one page with only one of them labelled is indistinguishable from a mistake - ${termless2.map(c => c.replace(/<[^>]+>/g, '').trim()).join(' | ')}`);
      // And where the same vendor is priced twice on this page, the footnote
      // has to reconcile the two rather than leave the reader to.
      ok('the JobTread footnote reconciles the two JobTread prices on the page',
        /159[\s\S]{0,120}18/.test(cmp2) && /same plan on two billing terms/i.test(cmp2),
        'footnote 1 quotes the month-to-month pair and the AIA table quotes the annual pair; one of them has to say so');
    }

    // (d) THE 14-POINT DCMA CLAIM, EVERYWHERE UNDER marketing/ - INCLUDING THE
    // DIRECTORIES publicPages() SKIPS. The correction reached every public page
    // and missed marketing/app-store-screenshots/builder.html, which is the copy
    // destined for the store listing: "The 14-point assessment Primavera P6
    // charges for". DCMA_COVERAGE implements ten.
    {
      const everyHtml = (dir: string, out: string[] = []): string[] => {
        for (const e of readdirSync(dir)) {
          if (e === 'dist' || e === 'node_modules' || e.startsWith('.')) continue;
          const q = join(dir, e);
          if (statSync(q).isDirectory()) everyHtml(q, out);
          else if (q.endsWith('.html')) out.push(q);
        }
        return out;
      };
      const all = everyHtml('marketing');
      const claims14 = all.filter(p => /\b14[- ]point\b/i.test(readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '')));
      ok(`nothing under marketing/ claims a "14-point" assessment (${all.length} files, incl. the store-listing builder)`,
        claims14.length === 0,
        claims14.length ? `DCMA_COVERAGE implements ten of the fourteen - found in: ${claims14.join(', ')}` : undefined);
      ok('the sweep really does reach outside publicPages()',
        all.length > pages.length,
        'if this ever equals the public count the blind spot is back');
    }

    // (e) THE TIER CHIPS ON features/financials.html, EACH AGAINST ITS GATE.
    // The chips were added to fix a real mismatch and two of the three were
    // themselves wrong: Profit by project was chipped Business and A/R aging
    // Pro, while app/reports.tsx gates only the WIP tab and deliberately lands
    // sub-Business users on Profit. A chip is a price on a page; it gets
    // checked like one.
    {
      const finSrc = prose('marketing/features/financials.html');
      const CHIP = /<span class="tier-chip tier-chip-(pro|biz|free)">([^<]*)<\/span>/;
      const chipAfter = (label: string): string | null => {
        const i = finSrc.indexOf(label);
        if (i < 0) return null;
        const m = CHIP.exec(finSrc.slice(i, i + 260));
        return m ? ({ pro: 'pro', biz: 'business', free: 'free' } as Record<string, string>)[m[1]] : null;
      };
      const EXPECT: { label: string; key?: keyof typeof REQUIRED_TIER; tier?: string }[] = [
        { label: '<strong>WIP report</strong>', key: 'wip_reporting' },
        { label: '<strong>Profit by project</strong>', tier: 'free' },
        { label: '<strong>A/R aging</strong>', tier: 'free' },
        { label: '>Open Book / GMP', key: 'client_portal' },
        { label: '>Estimates', key: 'ai_estimate_wizard' },
        { label: '>AIA-style Pay Applications', key: 'aia_pay_app' },
        { label: '>Invoices', key: 'change_orders_invoicing' },
        { label: '>Change Orders', key: 'change_orders_invoicing' },
        { label: '>Cash Flow Forecast', key: 'cash_flow_forecaster' },
        { label: '>Earned Value Management', key: 'full_budget_dashboard' },
        { label: '>Payment Predictions', key: 'cash_flow_forecaster' },
      ];
      for (const { label, key, tier } of EXPECT) {
        const want = key ? REQUIRED_TIER[key] : tier as string;
        const got = chipAfter(label);
        ok(`financials.html chips "${label.replace(/[<>/]|strong/g, '')}" as ${want}`,
          got === want,
          key
            ? `featureTiers gates ${key}='${want}'; the page chips '${got ?? 'nothing'}'`
            : `app/reports.tsx gates only the WIP tab, so this one is free; the page chips '${got ?? 'nothing'}'`);
      }
      // Binding so the "free" pair cannot silently become wrong: the reports
      // screen must still have exactly one gate in it.
      const reportsSrc = readFileSync('app/reports.tsx', 'utf8')
        .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
      const gatesInReports = [...reportsSrc.matchAll(/canAccess\('([a-z_]+)'\)/g)].map(m => m[1]);
      ok('app/reports.tsx still gates exactly one report, and it is WIP',
        gatesInReports.length === 1 && gatesInReports[0] === 'wip_reporting',
        `Profit and A/R aging are chipped Free on the strength of this; the screen now gates: ${gatesInReports.join(', ') || 'nothing'}`);
      // And every section on the page carries a chip, so "we chipped the
      // features" cannot mean "we chipped three of them".
      const titles = [...finSrc.matchAll(/<div class="section-title"[^>]*>([\s\S]*?)<\/div>/g)].map(m => m[1]);
      const unchipped = titles.filter(t => !/tier-chip/.test(t) && !/^Reports\s*$/.test(t.trim()));
      ok(`every feature section on financials.html names a tier (${titles.length} sections)`,
        unchipped.length === 0,
        `Reports is the one exception, because its three rows have three different answers and each is chipped individually - unchipped: ${unchipped.map(t => t.replace(/<[^>]+>/g, '').trim()).join(', ')}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
