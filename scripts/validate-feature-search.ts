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

// ── d6r K2 — palette ───────────────────────────────────────────────────────
// The desktop Cmd+K command palette (components/search/CommandPalette) draws
// what utils/paletteRows decides. Proven here: the lane order with and
// without a query and a job, the minimal persona (client / PM) gets no job
// lanes, the Ask row waits for 3 characters, Records come last (their late
// arrival never moves the highlight), the arrow keys wrap, the create filter
// IS CreateMenu's (its filter body is evaluated from source), the honest
// 'New …' labels (K2.12), a property manager never sees the homeowner's RFP
// flow (K2.1b), and the source pins that keep the phone untouched.

{
  const K2 = 'd6r K2 palette: ';
  const pal = await import('@/utils/paletteRows');
  const {
    buildPaletteRows, filterCreateOptions, movePaletteSelection, featureHitsForRole, popularIdsForRole,
    JOB_QUICK_ACTION_LABELS, FORM_ON_ARRIVAL_HREFS, LOG_CREATE_HREFS, PM_FEATURE_IDS, paletteActionLabel,
  } = pal;
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const readSrc = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');
  const menuRaw = readSrc('components', 'CreateMenu.tsx');
  const menu = strip(menuRaw);

  // ── CreateMenu's OPTIONS, parsed from source (it imports React Native, so
  // bun cannot load it). One row per line, as the file writes them.
  const optStart = menuRaw.indexOf('const OPTIONS');
  const optBody = menuRaw.slice(optStart, menuRaw.indexOf('\n];', optStart));
  const unq = (x: string) => x.replace(/\\'/g, "'");
  type Opt = { label: string; subtitle: string; href: string; keywords?: string[]; scoped?: boolean };
  const OPTS: Opt[] = [];
  for (const line of optBody.split('\n')) {
    if (/^\s*\/\//.test(line)) continue;
    const label = /\blabel: '((?:[^'\\]|\\.)*)'/.exec(line);
    const subtitle = /\bsubtitle: '((?:[^'\\]|\\.)*)'/.exec(line);
    const href = /\bhref: '([^']+)'/.exec(line);
    if (!label || !subtitle || !href) continue;
    const kw = /\bkeywords: \[([^\]]*)\]/.exec(line);
    OPTS.push({
      label: unq(label[1]), subtitle: unq(subtitle[1]), href: href[1],
      keywords: kw ? [...kw[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => unq(m[1])) : undefined,
      scoped: /\bscoped: true\b/.test(line),
    });
  }
  assert(OPTS.length >= 25, `${K2}parsed CreateMenu's OPTIONS (${OPTS.length} rows)`);

  // ── filterCreateOptions IS CreateMenu's filter: evaluate the menu's own
  // filter body on the parsed rows and compare, query by query.
  const filterBody = /return OPTIONS\.filter\(o => \{([\s\S]*?)\n    \}\);/.exec(menu)?.[1] ?? '';
  const qLine = /const q = (query\.trim\(\)\.toLowerCase\(\));/.test(menu);
  assert(filterBody.length > 0 && qLine, `${K2}CreateMenu's filter (q = query.trim().toLowerCase(); OPTIONS.filter(o => …)) was found`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const menuFilter = new Function('o', 'q', filterBody) as (o: Opt, q: string) => boolean;
  const menuFiltered = (query: string) => {
    const q = query.trim().toLowerCase();
    return (q ? OPTS.filter(o => menuFilter(o, q)) : OPTS).map(o => o.label);
  };
  for (const query of ['rfi', 'Invoice', '  voice ', 'co', 'pay app', 'PDF', 'zzz', '']) {
    const mine = filterCreateOptions(OPTS, query).map(o => o.label);
    assert(JSON.stringify(mine) === JSON.stringify(menuFiltered(query)),
      `${K2}filterCreateOptions('${query}') equals CreateMenu's filter (${mine.join(', ')} vs ${menuFiltered(query).join(', ')})`);
  }

  // ── Fixtures.
  const job = { id: 'p1', name: 'Henderson' };
  const mru = [job, { id: 'p2', name: 'Oak St' }, { id: 'p3', name: 'Pine Ave' }, { id: 'p4', name: 'Elm Rd' }];
  const hits = (q: string) => featureHitsForRole(q, 'business', 'contractor');
  const rec = (kind: string, id: string) => ({ ref: { kind, id }, label: `${kind} ${id}` });
  const lanesOf = (rows: { lane: string }[]) => rows.map(r => r.lane).filter((l, i, a) => i === 0 || a[i - 1] !== l);
  const build = (over: Partial<Parameters<typeof buildPaletteRows>[0]>) => buildPaletteRows({
    query: 'rfi', minimal: false, activeJob: job, recentJobs: mru, projectHits: [{ id: 'p9', name: 'RFI Tower' }],
    createOptions: OPTS, featureHits: hits('rfi'), records: [rec('rfi', 'r1'), rec('project', 'p9'), rec('project', 'p8')],
    recentSearches: ['gantt'], ...over,
  });

  // Lane order with a query (and a job): Projects · Actions · Ask · Go to · Records.
  const withQ = build({});
  assert(JSON.stringify(lanesOf(withQ)) === JSON.stringify(['projects', 'actions', 'ask', 'features', 'records']),
    `${K2}query lanes are Projects, Actions, Ask, Go to, Records (got ${lanesOf(withQ).join(', ')})`);
  const firstAction = withQ.find(r => r.lane === 'actions');
  assert(firstAction?.label === 'New RFI' && firstAction.sublabel === 'Henderson'
    && firstAction.ref.kind === 'create' && firstAction.ref.projectId === 'p1',
    `${K2}'rfi' with an active job puts 'New RFI · Henderson' first in Actions, for p1`);
  assert(!withQ.some(r => r.lane === 'records' && r.key === 'record:project:p9') && withQ.some(r => r.key === 'record:project:p8'),
    `${K2}a job already in Projects is not listed again as a record; another is`);
  assert(withQ.filter(r => r.lane === 'actions').length <= 5 && build({ query: 'a' }).filter(r => r.lane === 'actions').length === 5,
    `${K2}Actions holds at most 5 rows`);
  assert(build({ query: 'a' }).filter(r => r.lane === 'projects').length <= 5
    && build({ query: 'x', projectHits: Array.from({ length: 9 }, (_, i) => ({ id: `j${i}`, name: `Job ${i}` })) }).filter(r => r.lane === 'projects').length === 5,
    `${K2}Projects holds at most 5 rows`);

  // No active job: a job-scoped action fans out to the top 3 MRU jobs.
  const noJob = build({ activeJob: null }).filter(r => r.lane === 'actions' && r.ref.kind === 'create' && r.ref.option.label === 'RFI');
  assert(noJob.length === 3 && noJob.map(r => r.sublabel).join('|') === 'Henderson|Oak St|Pine Ave' && noJob.every(r => r.label === 'New RFI'),
    `${K2}no active job: 'New RFI' once per top-3 MRU job (got ${noJob.map(r => r.sublabel).join(', ')})`);
  // No jobs at all: one honest row that starts a project instead.
  const none = build({ activeJob: null, recentJobs: [] }).filter(r => r.lane === 'actions');
  assert(none.length === 1 && none[0].sublabel === 'Create a project first' && none[0].ref.kind === 'needs-project' && none[0].label === 'RFI',
    `${K2}no jobs: one 'RFI · Create a project first' row that opens a new project (and does not claim 'New RFI')`);

  // Empty query, with a job: Actions for {job} · Recent jobs · MAGE Brain · Go to · Recent searches.
  const emptyJob = build({ query: '', featureHits: hits('schedule') });
  assert(JSON.stringify(lanesOf(emptyJob)) === JSON.stringify(['job-actions', 'recent-jobs', 'brain', 'features', 'recent-searches']),
    `${K2}empty-query lanes with a job (got ${lanesOf(emptyJob).join(', ')})`);
  const jobActions = emptyJob.filter(r => r.lane === 'job-actions');
  assert(jobActions.map(r => r.label).join('|') === 'New Daily Report|New RFI|New Change Order|New Invoice|Punch Item'
    && jobActions.every(r => r.ref.kind === 'create' && r.ref.projectId === 'p1'),
    `${K2}'Actions for Henderson' is the five quick actions, for p1 (got ${jobActions.map(r => r.label).join(', ')})`);
  assert(emptyJob.filter(r => r.lane === 'recent-jobs').length === 4
    && build({ query: '', recentJobs: Array.from({ length: 8 }, (_, i) => ({ id: `j${i}`, name: `J${i}` })) }).filter(r => r.lane === 'recent-jobs').length === 5,
    `${K2}Recent jobs holds at most 5`);
  assert(emptyJob.filter(r => r.lane === 'brain').map(r => r.ref.kind === 'brain' ? r.ref.action : '').join('|') === 'ask|voice|help|shortcuts',
    `${K2}MAGE Brain is Ask, Voice, Help, Keyboard shortcuts`);
  const emptyNoJob = build({ query: '', activeJob: null });
  assert(lanesOf(emptyNoJob)[0] === 'recent-jobs' && !emptyNoJob.some(r => r.lane === 'job-actions'),
    `${K2}empty query without a job: no 'Actions for' lane, Recent jobs first`);

  // Minimal persona (client / PM): no Projects, Actions or job lanes.
  const minQ = build({ minimal: true });
  const minE = build({ minimal: true, query: '' });
  const jobLanes = ['projects', 'actions', 'job-actions', 'recent-jobs'];
  assert(!minQ.some(r => jobLanes.includes(r.lane)) && !minE.some(r => jobLanes.includes(r.lane)),
    `${K2}the minimal persona gets no Projects / Actions / job lanes`);
  assert(minQ.some(r => r.key === 'record:project:p9'), `${K2}the minimal persona still finds a job as a record`);

  // The Ask row: only for a trimmed query of 3+ characters, seeded with it.
  const askOf = (q: string) => build({ query: q }).filter(r => r.lane === 'ask');
  assert(askOf('rf').length === 0 && askOf('  rf  ').length === 0 && askOf('rfi').length === 1
    && askOf('  rfi ')[0]?.ref.kind === 'ask' && (askOf('  rfi ')[0].ref as { seed: string }).seed === 'rfi'
    && askOf('rfi')[0].label === 'Ask MAGE: “rfi”',
    `${K2}the Ask row appears only for 3+ characters, labelled and seeded with the trimmed query`);

  // Records come last, and appending them never moves an earlier row.
  const lanes = withQ.map(r => r.lane);
  assert(lanes.lastIndexOf('records') === lanes.length - 1 && lanes.indexOf('records') > lanes.lastIndexOf('features'),
    `${K2}Records come last`);
  const before = build({ records: [] }).map(r => r.key);
  const after = build({}).map(r => r.key);
  assert(JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before),
    `${K2}late records only append (the highlighted row never moves)`);

  // Selection wraps like JobSwitcher.
  assert(movePaletteSelection(0, -1, 5) === 4 && movePaletteSelection(4, 1, 5) === 0 && movePaletteSelection(2, 1, 5) === 3
    && movePaletteSelection(3, -1, 5) === 2 && movePaletteSelection(0, 1, 0) === 0,
    `${K2}arrow selection wraps both ways (and is 0 with no rows)`);

  // ── K2.12 honest labels.
  const listFirst = /const LIST_FIRST_HREFS: ReadonlySet<string> = new Set\(\[([^\]]*)\]\);/.exec(menu)?.[1] ?? '';
  const listFirstSet = new Set([...listFirst.matchAll(/'([^']+)'/g)].map(m => m[1]));
  assert(listFirstSet.size === 5 && [...listFirstSet].every(h => LOG_CREATE_HREFS.has(h)) && LOG_CREATE_HREFS.size === 5,
    `${K2}the five log routes in FORM_ON_ARRIVAL_HREFS equal CreateMenu's LIST_FIRST_HREFS`);
  assert([...LOG_CREATE_HREFS].every(h => FORM_ON_ARRIVAL_HREFS.has(h)), `${K2}FORM_ON_ARRIVAL_HREFS includes the five logs`);
  const optHrefs = new Set(OPTS.map(o => o.href));
  const staleForm = [...FORM_ON_ARRIVAL_HREFS].filter(h => !optHrefs.has(h));
  assert(staleForm.length === 0, `${K2}every FORM_ON_ARRIVAL href is a CreateMenu OPTIONS href (stale: ${staleForm.join(', ')})`);
  const leadRows = build({ query: 'lead' }).filter(r => r.lane === 'actions' && r.ref.kind === 'create' && r.ref.option.label === 'Lead');
  assert(leadRows.length === 1 && leadRows[0].label === 'Lead' && leadRows[0].sublabel === OPTS.find(o => o.label === 'Lead')?.subtitle,
    `${K2}'lead' reads 'Lead' with CreateMenu's subtitle (the leads board is not a form)`);
  const byLabel = (l: string) => OPTS.find(o => o.label === l)!;
  assert(paletteActionLabel(byLabel('RFI'), true) === 'New RFI' && paletteActionLabel(byLabel('RFI'), false) === 'RFI'
    && paletteActionLabel(byLabel('Quick Quote'), false) === 'New Quick Quote' && paletteActionLabel(byLabel('Selection'), true) === 'Selection',
    `${K2}'New' only where a form opens on arrival (RFI with a job, Quick Quote), never on Selection`);
  for (const l of JOB_QUICK_ACTION_LABELS) {
    const o = OPTS.find(x => x.label === l);
    assert(o !== undefined && o.scoped === true, `${K2}quick action '${l}' is a job-scoped CreateMenu option`);
  }

  // ── K2.1b a property manager is not a homeowner.
  const sidebar = readSrc('components', 'DesktopSidebar.tsx');
  const pmStart = sidebar.indexOf('const PM_NAV_ITEMS');
  const pmBlock = sidebar.slice(pmStart, sidebar.indexOf('];', pmStart));
  const pmKeys = new Set([...pmBlock.matchAll(/\bfeature:\s*'([^']+)'/g)].map(m => m[1]));
  assert(pmStart > 0 && pmKeys.size > 0 && pmKeys.size === PM_FEATURE_IDS.size && [...pmKeys].every(k => PM_FEATURE_IDS.has(k as never)),
    `${K2}PM_FEATURE_IDS equals the feature keys of DesktopSidebar's PM_NAV_ITEMS (${[...pmKeys].join(', ')})`);
  const pmPost = featureHitsForRole('post', 'business', 'property_manager').map(h => h.entry.id);
  assert(!pmPost.includes('post-rfp') && !pmPost.includes('my-rfps'), `${K2}a PM's 'post' finds no homeowner RFP flow (got ${pmPost.join(', ')})`);
  assert(featureHitsForRole('post', 'business', 'client').some(h => h.entry.id === 'post-rfp'), `${K2}a client's 'post' still finds Post a Project`);
  for (const q of ['project', 'settings', 'contacts', 'notif', 'a']) {
    const pm = featureHitsForRole(q, 'business', 'property_manager');
    assert(pm.length <= 8 && pm.every(h => h.entry.persona === 'all' || PM_FEATURE_IDS.has(h.entry.id as never)),
      `${K2}a PM's '${q}' lists only shared entries and his own (${pm.map(h => h.entry.id).join(', ')})`);
  }
  assert(featureHitsForRole('contacts', 'business', 'property_manager').some(h => h.entry.id === 'contacts'), `${K2}a PM finds Contacts`);
  for (const q of ['gantt', 'rfi', 'money', 'bid', 'a']) {
    for (const role of ['contractor', 'admin', null] as const) {
      assert(JSON.stringify(featureHitsForRole(q, 'pro', role)) === JSON.stringify(searchFeatures(q, 'pro', { persona: 'contractor' })),
        `${K2}a ${role ?? 'null'} role's '${q}' is byte-for-byte today's contractor search`);
    }
    assert(JSON.stringify(featureHitsForRole(q, 'pro', 'client')) === JSON.stringify(searchFeatures(q, 'pro', { persona: 'client' })),
      `${K2}a client's '${q}' is today's client search`);
  }
  assert(JSON.stringify(popularIdsForRole('property_manager', POPULAR_FEATURE_IDS, POPULAR_CLIENT_FEATURE_IDS)) === JSON.stringify([...PM_FEATURE_IDS])
    && popularIdsForRole('client', POPULAR_FEATURE_IDS, POPULAR_CLIENT_FEATURE_IDS) === POPULAR_CLIENT_FEATURE_IDS
    && popularIdsForRole('contractor', POPULAR_FEATURE_IDS, POPULAR_CLIENT_FEATURE_IDS) === POPULAR_FEATURE_IDS,
    `${K2}the empty Go to lane: a PM's own set, a client's and a contractor's POPULAR lists`);

  // ── Source pins.
  const us = strip(readSrc('components', 'UniversalSearch.tsx'));
  const bodyStart = us.indexOf('export default function UniversalSearch');
  const paletteAt = us.indexOf('if (desktopWeb) return <CommandPalette', bodyStart);
  const modalAt = us.indexOf('return (\n    <Modal', bodyStart);
  const hookCalls = [...us.slice(bodyStart, modalAt).matchAll(/\buse[A-Z]\w*\(/g)].map(m => (m.index ?? 0) + bodyStart);
  assert(paletteAt > 0 && modalAt > paletteAt && hookCalls.length > 5 && hookCalls.every(i => i < paletteAt),
    `${K2}UniversalSearch returns <CommandPalette> on desktop web AFTER its last hook call, right before the phone Modal`);
  assert(/const persona = userRole === 'client' \|\| userRole === 'property_manager'\s*\? \('client' as const\)/.test(us),
    `${K2}the phone search keeps today's persona line (iPhone unchanged)`);
  assert(/const handleAskMage = useCallback\(\(\) => \{\s*closeSearch\(\);\s*if \(desktopWeb\) \{ openAsk\(\); return; \}\s*setTimeout\(\(\) => router\.push\('\/ask'\), Platform\.OS === 'ios' \? 350 : 0\);/.test(us),
    `${K2}Ask MAGE opens the dock on desktop web; the phone push is unchanged`);
  const cp = strip(readSrc('components', 'search', 'CommandPalette.tsx'));
  assert(/case 'feature':[\s\S]{0,300}if \(ref\.hit\.entry\.id === 'ask-mage'\) \{ onRan\(query\); onClose\(\); openAsk\(\); return; \}/.test(cp),
    `${K2}'Go to → Ask MAGE' opens the Ask dock like every other Ask row (never a bare /ask push)`);
  assert(/\.\.\.cardSurface\(t, \{ radius: 'xl', pad: 'none' \}\)/.test(cp) && /maxWidth: Layout\.sheet\.wide/.test(cp)
    && /useSheetDialogScope\(isOpen\);/.test(cp) && /onRequestClose=\{onClose\}/.test(cp),
    `${K2}CommandPalette spreads cardSurface, caps at Layout.sheet.wide, is a dialog scope and closes on Esc`);
  assert(!/\bas (never|any)\b/.test(cp), `${K2}CommandPalette adds no route cast`);
  // The card centres in the content column (x 516-1236 at 1512 with the 240
  // sidebar, centre ~876, like the CreateMenu popover and the shortcut sheet):
  // the left pad is the shell inset PLUS the gutter, matching the gutter on the right.
  assert(/const scrimPadLeft = shellInset \+ Layout\.gutter;/.test(cp) && /paddingLeft: scrimPadLeft,/.test(cp) && /scrim: \{[^}]*paddingHorizontal: Layout\.gutter,[^}]*\}/.test(cp),
    `${K2}CommandPalette's scrim pads symmetrically around the content column (shellInset + gutter left, gutter right)`);
  const ranCases = ['project', 'create', 'needs-project', 'ask'].filter(k => new RegExp(`case '${k}':\\s*onRan\\(query\\);\\s*onClose\\(\\);`).test(cp));
  assert(ranCases.length === 4 && /onRan=\{\(q\) => \{ void persistRecent\(q\); \}\}/.test(us),
    `${K2}every palette row that closes it saves the query to Recent searches (got ${ranCases.join(', ')})`);
  assert(!/\bas unknown as\b/.test(cp), `${K2}CommandPalette has no double cast`);
  assert(/onSubmitEditing=\{runSelected\}/.test(cp) && /onKeyPress=\{onKeyPress\}/.test(cp) && /movePaletteSelection\(/.test(cp),
    `${K2}CommandPalette: Enter runs the selection (onSubmitEditing), arrows move it (onKeyPress)`);
  assert(/useSheetDialogScope\(visible\);/.test(menu) && /anchor\?: \{ x: number; y: number \} \| null;/.test(menu)
    && /activeJob\?: boolean;/.test(menu) && (menu.match(/new: '1'/g) ?? []).length === 1
    && /export function pushCreateOption\(\s*router: [^\n]*,\s*opt: CreateOption,\s*projectId: string,\s*desktopWeb: boolean,?\s*\)/.test(menu)
    && /export const CREATE_OPTIONS: readonly CreateOption\[\] = OPTIONS;/.test(menu),
    `${K2}CreateMenu: a dialog scope, the anchor / activeJob props, pushCreateOption + CREATE_OPTIONS exported, exactly one new: '1'`);
  assert(/\{\.\.\.\(isDesktopWeb \? \{ autoFocus: true, onKeyPress: onKeyNav, onSubmitEditing: runHighlighted \} : null\)\}/.test(menu),
    `${K2}CreateMenu's desktop keys are SPREAD onto the search box (the phone's props are untouched)`);
  const home = strip(readSrc('app', '(tabs)', '(home)', 'index.tsx'));
  assert(/dockOpen: dock\.content != null,\s*\}\) \|\| \(dock\.id === ATTENTION_DOCK_ID && !dock\.hidden\);/.test(home),
    `${K2}Home: the attention dock counts as the rail being up`);
  assert(/onPress=\{\(\) => \{ if \(isDesktopWeb\) \{ openAsk\(\); return; \} router\.push\('\/ask' as never\); \}\}/.test(home),
    `${K2}Home's Ask MAGE opens the dock on desktop web; the phone push is unchanged`);
  assert(/anchor=\{actionAnchor && actionAnchor\.ref === actionSheetRef \? actionAnchor\.at : null\}/.test(home) && /callerVerbs=\{actionSheetRef\?\.kind === 'project' \? \['duplicate'\] : \[\]\}/.test(home),
    `${K2}Home passes the ⋯ anchor to the action menu and keeps its callerVerbs`);
  const pt = strip(readSrc('components', 'portfolio', 'PortfolioTable.tsx'));
  assert(/onOpenActions\(p, \{ x: e\.nativeEvent\.pageX, y: e\.nativeEvent\.pageY \}\)/.test(pt) && /onLongPress=\{\(\) => onOpenActions\(p\)\}/.test(pt),
    `${K2}PortfolioTable: the ⋯ press passes its point, the long press none`);
}

// ── Report ──────────────────────────────────────────────────────────────────

if (failed === 0) {
  console.log(`  PASS  ${FEATURE_REGISTRY.length} destinations, sidebar parity, iOS reachability, ranking, tier locks, personas`);
  process.exit(0);
}
console.error(`\n${failed} feature-search check(s) failed`);
process.exit(1);
