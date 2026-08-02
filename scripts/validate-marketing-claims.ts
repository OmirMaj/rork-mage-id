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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
