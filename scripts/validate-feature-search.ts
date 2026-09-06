// Feature-search validation — utils/featureRegistry.ts (pure, no RN imports).
//
// Guards three things:
//   1. Registry integrity — unique ids, lowercase synonyms, valid `requires`
//      keys, and every route resolves to a REAL file under app/ (a renamed
//      or deleted screen fails ship-check instead of shipping a dead row).
//   2. Sidebar parity — every DesktopSidebar NAV_ITEMS route exists in the
//      registry, so a new sidebar destination can't silently skip search.
//   3. searchFeatures behavior — ranking (title-prefix > synonym > contains),
//      multi-token AND, tier lock flags, persona filtering, result cap.
//
// fileURLToPath + join because the repo path contains a space.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FEATURE_REGISTRY, POPULAR_FEATURE_IDS, POPULAR_CLIENT_FEATURE_IDS,
  GROUP_LABELS, getFeature, searchFeatures,
} from '@/utils/featureRegistry';
import { REQUIRED_TIER } from '@/utils/featureTiers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let failed = 0;
const assert = (c: boolean, m: string) => { if (!c) { console.error('  FAIL  ' + m); failed++; } };

console.log('\nfeature-search validation:');

// ── 1. Registry integrity ───────────────────────────────────────────────────

const ids = FEATURE_REGISTRY.map(e => e.id);
assert(new Set(ids).size === ids.length, 'feature ids are unique');
assert(FEATURE_REGISTRY.length >= 60, `registry covers the app (60+ destinations, found ${FEATURE_REGISTRY.length})`);

for (const e of FEATURE_REGISTRY) {
  assert(e.title.trim().length > 0, `${e.id}: non-empty title`);
  assert(e.route.startsWith('/'), `${e.id}: route starts with '/'`);
  assert(e.synonyms.length > 0, `${e.id}: has at least one synonym`);
  assert(
    e.synonyms.every(s => s === s.toLowerCase() && s.trim() === s && s.length > 0),
    `${e.id}: synonyms are lowercase and trimmed`,
  );
  assert(new Set(e.synonyms).size === e.synonyms.length, `${e.id}: no duplicate synonyms`);
  assert(e.group in GROUP_LABELS, `${e.id}: group '${e.group}' has a display label`);
  if (e.requires) {
    assert(e.requires in REQUIRED_TIER, `${e.id}: requires '${e.requires}' is a real FeatureKey`);
  }

  // Route must resolve to a real screen file. Expo Router: '/foo' →
  // app/foo.tsx; '/(tabs)/(home)' → app/(tabs)/(home)/index.tsx.
  const rel = e.route.replace(/^\//, '');
  const candidates = [
    join(ROOT, 'app', rel + '.tsx'),
    join(ROOT, 'app', rel, 'index.tsx'),
  ];
  assert(candidates.some(p => existsSync(p)), `${e.id}: route '${e.route}' resolves to a file under app/`);
}

// ── 2. Sidebar parity ───────────────────────────────────────────────────────
// Parse NAV_ITEMS + CLIENT_NAV_ITEMS routes out of DesktopSidebar.tsx and
// require each to be searchable. HIRE_ENABLED-gated destinations (hire,
// messages) are launch-disabled and intentionally absent.

const SIDEBAR_EXEMPT = new Set(['/(tabs)/discover/hire', '/messages']);
const sidebarSrc = readFileSync(join(ROOT, 'components', 'DesktopSidebar.tsx'), 'utf8');
const sidebarRoutes = [...sidebarSrc.matchAll(/route:\s*'([^']+)'/g)].map(m => m[1]);
assert(sidebarRoutes.length >= 40, `parsed sidebar NAV_ITEMS routes (found ${sidebarRoutes.length})`);

const registryRoutes = new Set(FEATURE_REGISTRY.map(e => e.route));
for (const r of sidebarRoutes) {
  if (SIDEBAR_EXEMPT.has(r)) continue;
  assert(registryRoutes.has(r), `sidebar route '${r}' is searchable in the registry`);
}

// ── 2b. iOS reachability ───────────────────────────────────────────────────
// PRODUCT-F4 / UX-F16: thirty sidebar destinations had NO inbound navigation
// on iPhone — the sidebar mounts at ≥1024pt only, so Deliveries, Waiting-on,
// Equipment, Suppliers, Pre-priced Bids and Home Passport shipped invisible on
// the primary platform. Every sidebar route must be referenced from a surface
// a phone user can reach — a tab screen (app/(tabs)/**), the project tile
// grid, a Summary sheet, a home card or the create menu — or be listed in
// IOS_EXEMPT with a reason. Exemptions must still exist in the sidebar.

function listFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const IOS_SOURCES = [
  ...listFiles(join(ROOT, 'app', '(tabs)')),
  join(ROOT, 'app', 'project-detail.tsx'),
  ...listFiles(join(ROOT, 'components', 'summary')),
  ...listFiles(join(ROOT, 'components', 'home')),
  join(ROOT, 'components', 'CreateMenu.tsx'),
].filter(existsSync);
assert(IOS_SOURCES.length >= 20, `found the iOS navigation sources (${IOS_SOURCES.length})`);
const iosSrc = IOS_SOURCES.map(f => readFileSync(f, 'utf8')).join('\n');

const IOS_EXEMPT: Record<string, string> = {
  '/(tabs)/discover/hire': 'HIRE_ENABLED is false for launch (same as SIDEBAR_EXEMPT)',
  '/messages': 'HIRE_ENABLED is false for launch (same as SIDEBAR_EXEMPT)',
  '/(tabs)/summary': 'tab-bar destination — app/(tabs)/_layout.tsx <Tabs.Screen name="summary">',
  '/(tabs)/settings': 'tab-bar destination — app/(tabs)/_layout.tsx <Tabs.Screen name="settings">',
  '/(tabs)/mage-id-bids': 'tab-bar destination — app/(tabs)/_layout.tsx <Tabs.Screen name="mage-id-bids">',
  '/my-rfps': 'client-persona destination (CLIENT_NAV_ITEMS). On iOS it is reached from the post-RFP success alert ("See my RFPs" → router.replace(\'/my-rfps\'), app/post-rfp.tsx handleSubmit), which is outside the phone sources this guard scans; components/ClientHome.tsx (the client (home) tab) does NOT link it — it renders the homeowner\'s RFPs inline and opens each via /rfp-responses-review (handleOpenRfp)',
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function referencedOnPhone(route: string): boolean {
  // '/(tabs)/subs' may be written as '/subs' (Expo Router groups are optional).
  const variants = [route, route.replace(/^\/\(tabs\)/, '')].filter(v => v.length > 1);
  return variants.some(v => new RegExp(`['"\`]${escapeRe(v)}(?:[?'"\`]|\\$\\{)`).test(iosSrc));
}

for (const r of new Set(sidebarRoutes)) {
  if (IOS_EXEMPT[r]) continue;
  assert(referencedOnPhone(r),
    `sidebar route '${r}' is reachable on iOS — reference it from app/(tabs)/** (e.g. discover/tools.tsx), app/project-detail.tsx, components/summary/**, components/home/** or components/CreateMenu.tsx, or add it to IOS_EXEMPT with a reason (PRODUCT-F4)`);
}
for (const r of Object.keys(IOS_EXEMPT)) {
  assert(sidebarRoutes.includes(r), `IOS_EXEMPT entry '${r}' is stale — it is no longer a sidebar route`);
}

// ── 3. Popular shortlist ────────────────────────────────────────────────────

assert(POPULAR_FEATURE_IDS.length >= 4, 'popular shortlist has at least 4 entries');
for (const id of POPULAR_FEATURE_IDS) {
  assert(getFeature(id) !== undefined, `popular id '${id}' exists in the registry`);
}
for (const id of POPULAR_CLIENT_FEATURE_IDS) {
  const e = getFeature(id);
  assert(e !== undefined, `client popular id '${id}' exists in the registry`);
  assert((e?.persona ?? 'contractor') !== 'contractor', `client popular id '${id}' is visible to the client persona`);
}

// ── 4. searchFeatures behavior ──────────────────────────────────────────────

const top = (q: string, tier: 'free' | 'pro' | 'business' | 'enterprise' = 'business') =>
  searchFeatures(q, tier).map(h => h.entry.id);

// Empty / garbage queries.
assert(searchFeatures('', 'free').length === 0, 'empty query returns nothing');
assert(searchFeatures('   ', 'free').length === 0, 'whitespace query returns nothing');
assert(searchFeatures('zzzqqq', 'free').length === 0, 'garbage query returns nothing');

// Synonym routing — the queries a contractor actually types.
assert(top('gantt')[0] === 'schedule-pro', `'gantt' lands on Pro Scheduler (got ${top('gantt')[0]})`);
assert(top('quickbooks')[0] === 'quickbooks', `'quickbooks' lands on QuickBooks Online (/qbo-setup), not the preview Integrations screen (PRODUCT-F2)`);
assert(!registryRoutes.has('/integrations'), 'the preview-only /integrations screen is not searchable (PRODUCT-F2)');
assert(top('g702')[0] === 'aia-pay-app', `'g702' lands on AIA Pay Apps`);
assert(top('osha')[0] === 'safety-osha', `'osha' lands on OSHA Logs`);
assert(top('retainage')[0] === 'retention', `'retainage' lands on Retention`);
assert(top('dfr')[0] === 'daily-report', `'dfr' lands on Daily Reports`);
assert(top('punchlist')[0] === 'punch-list', `'punchlist' lands on Punch List`);
assert(top('timesheet')[0] === 'time-tracking', `'timesheet' lands on Time Tracking`);
assert(top('blueprints')[0] === 'plans', `'blueprints' lands on Plans`);
assert(top('crm')[0] === 'leads', `'crm' lands on Leads`);

// "bid" fans out to the bid suite.
const bidHits = top('bid');
assert(bidHits.includes('judges'), `'bid' includes Bid Advisor (judges)`);
assert(bidHits.includes('bid-leveling'), `'bid' includes Bid Leveling`);
assert(bidHits.includes('post-bid'), `'bid' includes Post-Bid Analysis`);

// "money" fans out to the financial suite.
const moneyHits = top('money');
assert(moneyHits.includes('invoice'), `'money' includes Invoices`);
assert(moneyHits.includes('job-costing'), `'money' includes Job Costing`);
assert(moneyHits.includes('cash-flow'), `'money' includes Cash Flow`);

// "photos" and "leak".
assert(top('photos')[0] === 'photo-triage', `'photos' lands on Photo Triage`);
const leakHits = top('leak');
assert(leakHits.includes('profit-leaks'), `'leak' includes Profit Leaks`);
assert(leakHits.includes('margin-alerts'), `'leak' includes Margin Alerts`);

// Ranking: title-prefix beats synonym match.
const schedHits = searchFeatures('sched', 'business');
assert(schedHits[0].entry.id === 'schedule', `title-prefix 'sched' ranks Schedule first (got ${schedHits[0].entry.id})`);
const safetyHits = searchFeatures('safety', 'business');
assert(safetyHits[0].entry.id === 'safety', `'safety' ranks the Safety hub first`);

// Multi-token AND semantics.
assert(top('daily report')[0] === 'daily-report', `'daily report' lands on Daily Reports`);
assert(searchFeatures('daily zzz', 'free').length === 0, 'unmatched second token rejects the entry');

// Tier locking: locked entries stay listed, flagged, with the right tier.
const xrayFree = searchFeatures('cost x-ray', 'free');
assert(xrayFree.length > 0 && xrayFree[0].entry.id === 'cost-xray', `'cost x-ray' found on free tier`);
assert(xrayFree[0].locked === true, 'cost-xray is locked for free tier');
assert(xrayFree[0].requiredTier === 'business', 'cost-xray reports business as required tier');
const xrayBiz = searchFeatures('cost x-ray', 'business');
assert(xrayBiz[0].locked === false, 'cost-xray unlocks at business');
const xrayEnt = searchFeatures('cost x-ray', 'enterprise');
assert(xrayEnt[0].locked === false, 'enterprise satisfies a business requirement (min-rank)');
const ganttPro = searchFeatures('gantt', 'pro');
assert(ganttPro[0].locked === false, 'schedule-pro (pro-gated) unlocks at pro');
const ungated = searchFeatures('contacts', 'free');
assert(ungated[0].locked === false && ungated[0].requiredTier === 'free', 'ungated entry is never locked');

// Persona filtering: property owners see their surface, not contractor tools.
const clientHits = searchFeatures('project', 'free', { persona: 'client' });
assert(clientHits.some(h => h.entry.id === 'my-rfps'), 'client persona finds My Projects');
assert(!clientHits.some(h => (h.entry.persona ?? 'contractor') === 'contractor'), 'client persona sees no contractor-only tools');
assert(!top('my rfps').includes('my-rfps'), 'contractor persona does not see client-only rows');

// Result cap.
assert(searchFeatures('a', 'business').length <= 8, 'results capped at 8 by default');
assert(searchFeatures('s', 'business', { maxResults: 3 }).length <= 3, 'maxResults option respected');

// ── Report ──────────────────────────────────────────────────────────────────

if (failed === 0) {
  console.log(`  PASS  ${FEATURE_REGISTRY.length} destinations, sidebar parity, iOS reachability, ranking, tier locks, personas`);
  process.exit(0);
}
console.error(`\n${failed} feature-search check(s) failed`);
process.exit(1);
