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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
