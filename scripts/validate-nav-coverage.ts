// Navigation coverage — every registered screen has a way in, on both form
// factors, and the orphans this repo keeps producing stay wired.
//
// WHY THIS EXISTS.
// The 2026-09-07 app-experience audit's largest single category was "built,
// documented, and not wired": thirteen finished features with no or near-no
// entry point. Its diagnosis was mechanical, not cultural — the app maintains
// FIVE parallel hand-written navigation catalogs (DesktopSidebar NAV_ITEMS,
// app/(tabs)/discover/tools.tsx, components/CreateMenu, components/summary/
// ToolsSheet, utils/featureRegistry) and the two routes that were added to
// only one of them (/smart-proposal, /post-bid) are exactly the two that ended
// up click-unreachable on the desktop rail. Nothing in ship-check could see
// that, because every catalog was internally consistent.
//
// scripts/validate-feature-search.ts already guards the registry's own
// integrity, sidebar↔registry parity, and iOS reachability for sidebar routes.
// This guard covers the gap on the other side: routes that are registered and
// shipped but reachable from NO rendered surface, or from phone surfaces only.
//
// WHAT COUNTS AS AN ENTRY POINT.
// A string reference to the route from any rendered source under app/,
// components/, utils/, hooks/ or contexts/ — a push, a Link, a tile, a brief
// row, a Brain drill-in. Three files are excluded on purpose:
//   * app/_layout.tsx        — a Stack.Screen registration is not a door.
//   * utils/featureRegistry  — universal search (⌘K) only. Search is a way to
//                              reach something you already know exists; it is
//                              not discovery, and the audit's whole point is
//                              that "search only" is how these features hid.
//   * utils/routeTitle.ts    — a path→document-title map, not navigation.
//
// DESKTOP is checked separately by subtracting app/(tabs)/discover/**. That is
// not a heuristic: app/(tabs)/_layout.tsx renders a bare <Slot> under the
// sidebar at >=1024pt (no tab bar, so no Discover tab button) and
// components/HiddenTabBackLink returns null when isDesktop, so nothing inside
// the Discover tab is clickable on a laptop unless the sidebar names it
// directly.
//
// SINCE 2026-09-07 this guard also owns the other half of that diagnosis: the
// five catalogs are down to one source. Every row in the four RENDERED
// catalogs now declares `feature: FeatureId`, reads its tier gate from
// utils/featureRegistry, and writes its route literal beside the id only
// because scripts/validate-feature-search.ts greps those literals. The checks
// below are what make "beside" safe — a literal that stops matching its
// registry row fails here — plus the surface-side rules that had no guard at
// all: project-scoped screens must render the picker, hidden tabs must offer a
// way out, and the delete-project confirmation must name the job.
//
// Pure node:fs plus ONE import: utils/featureRegistry is a pure module (its
// only imports are utils/featureTiers and a type-only @/types), which is why
// scripts/validate-project-scoped-screens.ts already imports it under bun. No
// react-native import — those crash bun.
// fileURLToPath + join because the repo path contains a space.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { FEATURE_REGISTRY } from '../utils/featureRegistry';
import { REQUIRED_TIER } from '../utils/featureTiers';
import { HUB_ENTRIES } from '../utils/estimateHubEntries';
import type { FeatureKey } from '../utils/featureTiers';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let failures = 0;
function ok(name: string, condition: boolean, detail?: string): boolean {
  if (condition) { console.log('  PASS  ' + name); return true; }
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
  failures += 1;
  return false;
}

console.log('\nnav-coverage validation:');

// ── Sources ─────────────────────────────────────────────────────────────────

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

const EXCLUDED_AS_ENTRY_POINT = new Set([
  join('app', '_layout.tsx'),        // registration, not a door
  join('utils', 'featureRegistry.ts'), // universal search only
  join('utils', 'routeTitle.ts'),      // path → document title map
]);

const allSources = [
  ...listFiles(join(ROOT, 'app')),
  ...listFiles(join(ROOT, 'components')),
  ...listFiles(join(ROOT, 'utils')),
  ...listFiles(join(ROOT, 'hooks')),
  ...listFiles(join(ROOT, 'contexts')),
].filter(f => !EXCLUDED_AS_ENTRY_POINT.has(relative(ROOT, f)));

// The Discover TAB has no desktop entry point (see the header note), so
// anything reachable only from inside it is phone-only.
const DISCOVER_TAB = join('app', '(tabs)', 'discover') + sep;
const desktopSources = allSources.filter(f => !relative(ROOT, f).startsWith(DISCOVER_TAB));

const anySrc = allSources.map(f => readFileSync(f, 'utf8')).join('\n');
const desktopSrc = desktopSources.map(f => readFileSync(f, 'utf8')).join('\n');

ok('found the navigation sources', allSources.length >= 300, `only ${allSources.length} files scanned`);
ok('desktop source set excludes the Discover tab',
  desktopSources.length > 0 && desktopSources.length < allSources.length,
  `all=${allSources.length} desktop=${desktopSources.length}`);

// ── Registered routes ───────────────────────────────────────────────────────

const layout = read(join('app', '_layout.tsx'));
const registered = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)]
  .map(m => m[1])
  .filter(name => name !== '(tabs)' && name !== '+not-found');

ok('parsed the registered routes out of app/_layout.tsx', registered.length >= 100,
  `found ${registered.length}`);

/** `'/foo'`, `"/foo?x=1"`, `` `/foo/${id}` `` — but never `/foobar`. */
function referenced(src: string, route: string): boolean {
  return new RegExp(`['"\`]/${route}(?:[?'"\`/]|\\$\\{)`).test(src);
}

// ── Deliberate exemptions ───────────────────────────────────────────────────
// Every entry needs a reason, and a stale one fails: a route that leaves
// _layout, or that GAINS a door, must be taken out of the list. That is what
// stops this from turning into a place to bury new orphans.

const NO_ENTRY_POINT_EXEMPT: Record<string, string> = {
  'reset-password': 'entered from the password-reset email link (utils/deepLinkScheme PUBLIC_PATHS); there is no in-app door by design',
  'prequal-form': 'entered by a subcontractor from a tokenized email link; app/_layout.tsx renders it pre-auth for exactly that reason',
  'claim-crew': 'entered by a crew member from a tokenized invite link, pre-auth',
  'accept-invite': 'entered by a collaborator from a tokenized invite email, possibly before they have an account',
  integrations: 'OAuth callback page — Intuit and friends redirect an in-app browser here; it authenticates on a signed state HMAC, not a session',
  'integrations/qbo/callback': 'the QuickBooks half of the same OAuth callback: Intuit redirects to this URL directly, so nothing in the app links it',
};

const DESKTOP_EXEMPT: Record<string, string> = {
  ...NO_ENTRY_POINT_EXEMPT,
  'post-job': 'Direct Hire is launch-disabled (HIRE_ENABLED === false, contexts/HireContext:32) and app/post-job.tsx:90 returns the disabled state. Same exemption validate-feature-search gives /(tabs)/discover/hire and /messages.',
};

const orphans: string[] = [];
const desktopOnlyOrphans: string[] = [];

for (const route of registered) {
  if (!NO_ENTRY_POINT_EXEMPT[route] && !referenced(anySrc, route)) orphans.push(route);
  if (!DESKTOP_EXEMPT[route] && !referenced(desktopSrc, route)) desktopOnlyOrphans.push(route);
}

ok('every registered route has an entry point outside universal search',
  orphans.length === 0,
  orphans.length === 0 ? undefined
    : `no rendered surface links: ${orphans.join(', ')}\n        `
      + 'Add a real door (a sidebar row, a Tools tile, a project-detail tile, a card) '
      + 'or add the route to NO_ENTRY_POINT_EXEMPT with the reason. A registry entry '
      + 'is NOT a door — ⌘K only finds what the user already knows exists.');

ok('every registered route has an entry point on DESKTOP',
  desktopOnlyOrphans.length === 0,
  desktopOnlyOrphans.length === 0 ? undefined
    : `phone-only (reachable only from inside the Discover tab, which has no desktop entry): ${desktopOnlyOrphans.join(', ')}\n        `
      + 'Add a components/DesktopSidebar.tsx NAV_ITEMS row (and its utils/featureRegistry entry, '
      + 'which scripts/validate-feature-search.ts will then require) or exempt with a reason.');

for (const [route, reason] of Object.entries(NO_ENTRY_POINT_EXEMPT)) {
  ok(`exemption '${route}' is still live`, registered.includes(route),
    'it is no longer registered in app/_layout.tsx — drop the entry');
  ok(`exemption '${route}' is still needed`, !referenced(anySrc, route),
    `it now has a real entry point, so the exemption is stale. Reason on file: ${reason}`);
}
for (const route of Object.keys(DESKTOP_EXEMPT)) {
  ok(`desktop exemption '${route}' is still live`, registered.includes(route),
    'it is no longer registered in app/_layout.tsx — drop the entry');
}

// ── Orphan wiring pinned by the 2026-09-07 audit ────────────────────────────
// Each of these is a finished feature that shipped with its last two lines
// missing. They are re-checkable at source level, so a refactor that quietly
// drops the wiring fails here rather than in a user's hands a year later.

const layoutSrc = layout;
ok('OfflineSyncPill is mounted globally (app/_layout.tsx)',
  /<OfflineSyncPill\b/.test(layoutSrc) && /GlobalOfflineSyncPill\s*\/>/.test(layoutSrc),
  'It is the only surface in the app that can say "you have unsynced changes", and every '
  + 'field write says "Saved." unconditionally while the mutation sits in the offline queue. '
  + 'It self-hides at queue depth 0, so a global mount costs nothing on the happy path.');

// The two things a global floating mount gets wrong if nobody is watching.
ok('the global sync pill clears the desktop sidebar rail',
  /left: 20 \+ \(railShowing \? layout\.sidebarWidth/.test(layoutSrc),
  'The pill is absolutely positioned against the whole window, and the left 240pt of a desktop '
  + 'window is the DesktopSidebar rail (utils/useResponsiveLayout sidebarWidth). At a bare '
  + 'left:20 it paints over the nav rows AND, being touchable, swallows their taps.');
// Read the SET's own body, not the whole file: 'client-view' also appears in
// DESKTOP_SHELL_EXEMPT thirty lines up, so a file-wide match passes on a
// deleted entry. (Caught by mutation-testing this assert.)
const syncPillRoots = /SYNC_PILL_HIDDEN_ROOTS[^=]*=\s*new Set\(\[([^\]]*)\]/.exec(layoutSrc)?.[1] ?? '';
ok('the global sync pill stays off client-facing and pre-auth screens',
  ['client-view', 'shared-estimate', 'shared-photos', 'shared-schedule', 'shared-plan',
    'prequal-form', 'claim-crew'].every(r => syncPillRoots.includes(`'${r}'`))
  && /SYNC_PILL_HIDDEN_ROOTS\.has\(/.test(layoutSrc),
  'shared-* and client-view are tokenized viewers a CLIENT is holding the phone for, and '
  + "prequal-form / claim-crew belong to a SUB. The GC's unsynced-queue depth is internal state; "
  + 'it does not belong on any of them. Same roots components/brain/BrainFab.tsx hides on.');

const subsSrc = read(join('app', '(tabs)', 'subs', 'index.tsx'));
// Both indexes are checked > 0 before comparing: a missing marker returns -1,
// which would otherwise "sort" ahead of the AI panel and pass.
const scorecardMount = subsSrc.indexOf('testID="sub-detail-scorecard"');
const aiPanelMount = subsSrc.indexOf('<AISubEvaluator');
ok('the Subs tab shows the deterministic scorecard above the AI panel',
  subsSrc.includes('computeSubScorecards')
  && subsSrc.includes("'/sub-scorecard'")
  && scorecardMount > 0 && aiPanelMount > 0 && scorecardMount < aiPanelMount,
  'app/(tabs)/subs/index.tsx is the screen where the award decision is made. The evidence-backed '
  + '0-100 from utils/subScorecard must be rendered ABOVE the ungrounded AISubEvaluator mount, '
  + 'not two navigation levels away under Discover > Tools.');

// The row lives inside a transparent <Modal>. iOS presents that over the whole
// app, so a push from under it renders the scorecard BEHIND the sheet and the
// tap reads as dead — the sheet has to close first.
const scorecardPress = subsSrc.slice(
  subsSrc.indexOf('styles.scorecardRow'),
  subsSrc.indexOf("pathname: '/sub-scorecard'"),
);
ok('opening the full scorecard closes the sub sheet first',
  scorecardPress.length > 0 && scorecardPress.includes('setShowDetail(null)'),
  'app/(tabs)/subs/index.tsx must call setShowDetail(null) before router.push — see the same '
  + 'pageSheet-dismiss ordering in components/UniversalSearch.tsx:258-271.');

const sidebarSrc = read(join('components', 'DesktopSidebar.tsx'));
for (const route of ['/post-bid', '/smart-proposal']) {
  ok(`DesktopSidebar has a row for ${route}`,
    sidebarSrc.includes(`route: '${route}'`),
    'Its only other inbound link lives inside the Discover tab, which does not exist on desktop.');
}

const registrySrc = read(join('utils', 'featureRegistry.ts'));
ok('featureRegistry indexes /post-bid as what it actually is',
  /id: 'post-bid', title: 'Post a Bid'/.test(registrySrc) && !/'why lost'/.test(registrySrc),
  "app/post-bid.tsx:186 self-titles 'Post a Bid' and is a publish-a-solicitation form with a "
  + "monthly quota. Indexing it as 'Post-Bid Analysis' with win/loss synonyms sent a GC "
  + 'searching "why lost" into a form that publishes a public bid opportunity.');

const timeSrc = read(join('app', 'time-tracking.tsx'));
ok('a mis-punched time entry can be corrected and deleted',
  timeSrc.includes('updateEntry(') && timeSrc.includes('deleteEntry('),
  'hooks/useTimeEntries exports updateEntry (:405) and deleteEntry (:419). With no consumer, one '
  + 'gloved mis-tap ended a shift permanently — and those hours feed the payroll CSV and the '
  + 'cost-book labor samples, so the error propagates into pay and into future bids.');
// The alert used to fire AFTER doClockOut, which is not a confirmation — it is
// a notification that the shift is already over. Pin the ORDER, not the
// presence: everything between the branch and the write must include the
// prompt and a destructive button to hang the write on.
const clockOutBranch = timeSrc.indexOf("action === 'clock_out'");
const clockOutWrite = timeSrc.indexOf('doClockOut(entry.id)', clockOutBranch);
const beforeTheWrite = clockOutBranch >= 0 && clockOutWrite > clockOutBranch
  ? timeSrc.slice(clockOutBranch, clockOutWrite)
  : '';
ok('ending a shift is confirmed before the write',
  beforeTheWrite.includes('showAlert(') && beforeTheWrite.includes("style: 'destructive'"),
  'app/time-tracking.tsx handleAction must confirm BEFORE calling doClockOut, not alert after it. '
  + 'The Clock Out button sits in a two-up row beside Break in the same styles.actionBtn.');

const warrantySrc = read(join('app', 'warranties.tsx'));
ok('a warranty claim can be created from the warranty screen',
  warrantySrc.includes('addWarrantyClaim('),
  "app/warranties.tsx ships a 'claimed' DisplayStatus, a Claimed chip and the summary fragment "
  + "'with an open claim'. Until 2026-09-07 contexts/ProjectContext addWarrantyClaim had two "
  + 'callers, both dev seeders, so that bucket was unreachable for every real user.');


// ── ONE SOURCE FOR NAVIGATION ───────────────────────────────────────────────
// The four rendered catalogs and the fields each writes its destination into.
// A row is any line carrying `feature: '<id>'`; the route literal is the
// `route:` / `href:` on the SAME line, which is how these tables are written.

interface CatalogRow { file: string; line: number; feature: string; route: string | null }

// `min` is a RATCHET set to today's exact row count, not a comfortable floor.
// A floor of 45 on a 53-row grid means eight rows can lose their `feature:` id
// — or vanish — without a word, which is the failure mode this whole file
// exists for. Adding rows is free; removing one means editing the number in
// the same commit, on purpose.
const CATALOGS: { file: string; label: string; min: number }[] = [
  { file: join('components', 'DesktopSidebar.tsx'), label: 'DesktopSidebar NAV_ITEMS', min: 69 },
  { file: join('app', '(tabs)', 'discover', 'tools.tsx'), label: 'Discover ▸ Tools grid', min: 53 },
  { file: join('components', 'summary', 'ToolsSheet.tsx'), label: 'Summary ▸ Tools sheet', min: 11 },
  { file: join('components', 'CreateMenu.tsx'), label: 'the + New… sheet', min: 22 },
];

const catalogRows: CatalogRow[] = [];
for (const { file, label, min } of CATALOGS) {
  const src = read(file);
  const rows: CatalogRow[] = [];
  src.split('\n').forEach((line, i) => {
    // A commented-out row renders nothing, so it must not count as coverage
    // either — otherwise `// { feature: 'x', … }` reads as a live door.
    // (Caught by mutation-testing the uncatalogued ratchet.)
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
    const f = /\bfeature:\s*'([^']+)'/.exec(line);
    if (!f) return;
    const r = /\b(?:route|href):\s*'([^']+)'/.exec(line);
    rows.push({ file, line: i + 1, feature: f[1], route: r ? r[1] : null });
  });
  ok(`${label} renders from the registry (${rows.length} rows)`, rows.length >= min,
    `${rows.length} rows carry a \`feature:\` id, was ${min}. A row without one is a `
    + 'destination this file cannot see — which is how /post-bid and /smart-proposal ended '
    + 'up in one catalog each. If the row was deleted on purpose, lower `min` here in the '
    + 'same commit.');
  catalogRows.push(...rows);
}

const registryById = new Map(FEATURE_REGISTRY.map(e => [e.id, e]));

{
  const unknown = catalogRows.filter(r => !registryById.has(r.feature));
  ok('every catalog row names a real registry entry', unknown.length === 0,
    unknown.map(r => `${r.file}:${r.line} → '${r.feature}'`).join('; ')
    + '\n        FeatureId is derived from the registry, so tsc normally catches this first — '
    + 'if it reached here, someone widened the type.');

  // The reason the literal is allowed to sit beside the id.
  const forked = catalogRows.filter(r =>
    r.route !== null && registryById.get(r.feature) && registryById.get(r.feature)!.route !== r.route);
  ok('no catalog row disagrees with the registry about where it goes', forked.length === 0,
    forked.map(r => `${r.file}:${r.line} '${r.feature}' → row says ${r.route}, registry says ${registryById.get(r.feature)!.route}`).join('; ')
    + '\n        The route literal exists only for scripts/validate-feature-search.ts:68 and its '
    + 'iOS-reachability grep. Fix the literal, not the registry — the screens navigate by '
    + 'featureFor(feature).route, so a forked literal misroutes nobody but blinds that guard.');
}

// The gate must live in exactly one place. A `requires` back on a sidebar row
// is how /plan-intelligence came to advertise Business on a Pro feature and
// /client-portal-setup came to advertise nothing on a Pro one.
{
  const sidebar = read(join('components', 'DesktopSidebar.tsx'));
  const navBlock = sidebar.slice(sidebar.indexOf('const NAV_ITEMS'), sidebar.indexOf('const GLOBAL_SECTIONS'));
  ok('the sidebar keeps no second copy of the tier gate',
    navBlock.length > 0 && !/\brequires:\s*'/.test(navBlock) && /featureFor\(item\.feature\)\.requires/.test(sidebar),
    'NAV_ITEMS must carry no `requires:` — read it from featureFor(item.feature).requires.');

  const createMenu = read(join('components', 'CreateMenu.tsx'));
  const doubleGated = createMenu.split('\n')
    .map((l, i) => ({ l, i: i + 1 }))
    .filter(({ l }) => /\bfeature:\s*'/.test(l) && /\btier:\s*'/.test(l));
  ok('no Create-menu row carries both a registry entry and its own tier chip',
    doubleGated.length === 0,
    doubleGated.map(d => `CreateMenu.tsx:${d.i}`).join(', ')
    + ' — `tier` is only for rows with no registry entry (the param-carrying create routes).');
  ok('the Create menu reads its chip from the registry',
    /featureFor\(opt\.feature\)\.requires/.test(createMenu) && /REQUIRED_TIER\[requires\]/.test(createMenu),
    'lockedTier must resolve the gate through the registry, or the chip goes back to being '
    + 'a second opinion — Submittal and Sub COI showed NO chip on Business features.');

  // The one invariant CreateMenu documents at length: AI Takeoff is metered,
  // not tier-locked, and must not paint a Pro chip. That now depends on the
  // registry row, so pin it here.
  ok("the registry keeps /takeoff ungated so the Create menu paints no Pro chip",
    registryById.get('takeoff') !== undefined && registryById.get('takeoff')!.requires === undefined,
    'app/takeoff.tsx has no canAccess gate — it meters via checkAILimit with a 1-job free '
    + 'lifetime cap. A `requires` here would paint a lock on a door that is open.');
}

// ── A rendered chip must name a wall that exists ────────────────────────────
// The assertion above pins ONE instance of the rule. That is not the rule, and
// pinning the instance is how the rule got broken next door: /estimate-wizard
// carried `requires: 'ai_estimate_wizard'` while app/estimate-wizard.tsx has no
// canAccess gate at all — it is a metered free demo (freeLifetimeCap 2) and
// app/onboarding.tsx:233 router.replace()s every brand-new FREE user onto it.
// Harmless while only ⌘K read `requires`; a live defect the moment the four
// catalogs started reading their chip from here, because "+ New… ▸ Estimate"
// began painting a Pro lock on the app's activation moment while six other
// entry points show the same door open.
//
// scripts/validate-feature-registry-gates.ts computes exactly this and files it
// under "entries this guard cannot verify" — printed, never failed on. That was
// the right call when the registry only fed a search chip; it is the wrong one
// now that a chip is RENDERED from it, which is why this wave shipped a false
// Pro badge past a green ship-check. So: a registry row that a rendered catalog
// names, and that declares `requires`, must be backed by a canAccess() in its
// own destination screen.
{
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /** Expo Router: '/foo' → app/foo.tsx; '/(tabs)/(home)' → …/index.tsx. */
  const screenFileFor = (route: string): string | undefined => {
    const rel = route.replace(/^\//, '').split('?')[0];
    return [join('app', `${rel}.tsx`), join('app', rel, 'index.tsx')]
      .find(p => existsSync(join(ROOT, p)));
  };

  // Rows whose chip is a known lie, with the evidence and the owner. NOT an
  // exemption list: the assert below FAILS if one is fixed and the line is left
  // behind, exactly like PENDING_BACK_LINK. Neither entry is in the 2026-09-07
  // nav wave's file set.
  // Empty, and that is the point: the one entry it held ('schedule', whose
  // prescribed fix was to drop `requires` from the row because
  // app/(tabs)/discover/schedule.tsx is the free on-ramp and gates nothing) was
  // carried out, so the line was deleted as that entry itself instructed. The
  // mechanism stays — with the pre-skip check above it now actually fires.
  const PENDING_CHIP_BACKING: Record<string, string> = {};

  const namedByCatalog = new Set(catalogRows.map(r => r.feature));
  const unbacked: string[] = [];
  const pendingFixed: string[] = [];

  for (const entry of FEATURE_REGISTRY) {
    // A PENDING row whose prescribed fix was to DROP `requires` ends up with no
    // `requires` at all, and the `!entry.requires` skip below used to swallow
    // exactly that state — so the 'schedule' entry sat here as a no-op long
    // after the row was fixed, and the rot check that is supposed to delete it
    // could never fire. Ask about the pending rows BEFORE the skip.
    if (entry.id in PENDING_CHIP_BACKING && !entry.requires) { pendingFixed.push(entry.id); continue; }
    if (!entry.requires || !namedByCatalog.has(entry.id)) continue;
    const file = screenFileFor(entry.route);
    if (!file) continue;                       // validate-feature-search.ts owns this
    const code = stripComments(read(file));
    const backed = new RegExp(`canAccess\\(\\s*['"]${entry.requires}['"]`).test(code);
    if (entry.id in PENDING_CHIP_BACKING) {
      if (backed) pendingFixed.push(entry.id);
      continue;
    }
    if (!backed) {
      unbacked.push(
        `${entry.id} → ${entry.route}: the registry advertises '${entry.requires}', but ${file} `
        + 'never calls canAccess() with it',
      );
    }
  }

  ok('every rendered tier chip names a wall its destination actually enforces',
    unbacked.length === 0,
    `${unbacked.length} chip(s) promise a gate that is not there:\n        `
    + unbacked.map(u => `• ${u}`).join('\n        ')
    + '\n        A chip that overstates keeps a subscriber out of a screen they already own; on a '
    + 'metered free demo it keeps a NEW user out of the activation moment. Drop the `requires` '
    + '(the wall is somewhere later), or move the gate onto the screen.');

  ok('the pending chip-backing list has not rotted', pendingFixed.length === 0,
    `${pendingFixed.map(p => `'${p}'`).join(', ')} now enforce(s) the gate the registry claims — `
    + 'delete the PENDING_CHIP_BACKING entry in the same commit so the list stays a to-do, not a '
    + 'mute button.');
}

// ── …AND A WALL THAT EXISTS MUST HAVE A CHIP ────────────────────────────────
// The block above guards one direction: a chip must not promise a gate the
// destination does not hold. The 2026-09-11 tier audit found the other
// direction open on SIXTEEN rows, and it is the one that costs a conversion:
// the row carried no `requires` at all while its screen opens with
// `if (!canAccess(<key>)) return <Paywall …>`. ⌘K and the Tools grid therefore
// advertised /invoice, /plans, /contract, /permits, /brief, /week-close,
// /construction-ai, /payment-predictions and eight more as UNLOCKED, the user
// tapped a row with no padlock on it, and the app answered with a paywall.
// scripts/validate-feature-registry-gates.ts computed this list and printed it
// as "tracked, not failed" (its header explains why: a guard that demands 16
// unrelated edits gets disabled instead of satisfied). The 16 edits are done,
// so the tracking becomes an assertion here.
//
// WHAT COUNTS AS A WALL, AND WHY THE PARSER IS FUSSY. Only an ENTRY gate: a
// guard clause at the top level of the default-exported component whose
// consequent returns, so it runs on mount and the screen refuses to render.
// An `if (!canAccess(…))` inside a useCallback is a gate on one BUTTON, and a
// chip in front of the whole screen would then be the false lock the block
// above exists to stop — app/closeout-binder.tsx is exactly that shape
// (runPassportGeneration checks 'client_portal'; the binder itself is free),
// and CLOSEOUT_BINDER_IS_ACTION_GATED below pins that the parser still tells
// the two apart. A grep for `canAccess('key')` cannot: it sees both.
{
  // LINE COMMENTS FIRST. Stripping `/* … */` first meant a `/*` that occurs
  // INSIDE a `//` comment opened a block comment that ran to the next `*/`
  // anywhere in the file. app/ask.tsx:3 says "the engine (utils/oneMind/*)
  // routes…" and the next `*/` is a JSX `{/* Header */}` 255 lines later, so
  // the whole component — `export default function` included — was erased and
  // entryGateOf returned undefined for a file it had never read. A screen the
  // parser cannot read is a screen every assertion below passes vacuously on.
  const stripComments = (src: string) =>
    src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // Expo Router re-export stubs (`export { default } from '…'`) are a screen's
  // route file without being its source: app/(tabs)/discover/estimate.tsx is
  // one line pointing at app/(tabs)/estimate/index.tsx. Resolved here, or the
  // parser reads a one-line file, finds no component, and reports "open".
  const RE_EXPORT = /^\s*export\s*\{\s*default[^}]*\}\s*from\s*['"]([^'"]+)['"]/m;
  const resolveStub = (file: string, depth = 0): string => {
    if (depth > 3) return file;
    const m = RE_EXPORT.exec(readFileSync(join(ROOT, file), 'utf8'));
    if (!m) return file;
    const base = join(file, '..', m[1]);
    const target = [`${base}.tsx`, join(base, 'index.tsx')].find(p => existsSync(join(ROOT, p)));
    return target ? resolveStub(target, depth + 1) : file;
  };

  const screenFileFor = (route: string): string | undefined => {
    const rel = route.replace(/^\//, '').split('?')[0];
    const f = [join('app', `${rel}.tsx`), join('app', rel, 'index.tsx')]
      .find(p => existsSync(join(ROOT, p)));
    return f ? resolveStub(f) : undefined;
  };

  /** The screen's entry gate, or undefined. Reachability, not presence:
   *  the `if` must sit at the component's own indent level (two spaces) inside
   *  the `export default function` body, and its consequent must return — the
   *  screen has to refuse to render, not merely mention the key. */
  function entryGateOf(rawSource: string): string | undefined {
    const lines = stripComments(rawSource).split('\n');
    const start = lines.findIndex(l => /^export default function\b/.test(l));
    if (start < 0) return undefined;
    // `}` in column 0 closes the component. Anything after it is another
    // function (a sub-component, a styles factory) and is not the entry path.
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^\}/.test(lines[i])) { end = i; break; }
    }
    for (let i = start + 1; i < end; i++) {
      const m = lines[i].match(/^  if \(\s*!\s*canAccess\w*\(\s*['"]([a-z0-9_]+)['"]\s*\)\s*\)\s*(\{)?\s*$/);
      if (!m) continue;
      // Same line (`) return <X/>;`) or the next non-blank line must return.
      if (!m[2] && /\)\s*return\b/.test(lines[i])) return m[1];
      let j = i + 1;
      while (j < end && lines[j].trim() === '') j++;
      if (j < end && /^\s+return\b/.test(lines[j])) return m[1];
    }
    // The no-brace one-liner form: `  if (!canAccess('k')) return <Paywall …>;`
    for (let i = start + 1; i < end; i++) {
      const m = lines[i].match(/^  if \(\s*!\s*canAccess\w*\(\s*['"]([a-z0-9_]+)['"]\s*\)\s*\)\s*return\b/);
      if (m) return m[1];
    }
    // THE ALIAS SHAPE — the same wall, through a named boolean:
    //     const locked  = !canAccess('cost_xray');       …  if (locked)   { … return
    //     const allowed =  canAccess('schedule_import'); …  if (!allowed) { … return
    // Both refuse to render exactly as literally as `if (!canAccess(…))`, and
    // the regexes above read neither. app/cost-xray.tsx therefore parsed as an
    // OPEN screen, which is how the Estimate hub's walled-tile count shipped as
    // five when the marquee AI tile makes it six. The FLOOR ratchet could not
    // catch that: a floor counts what the parser sees, so it cannot detect
    // blindness to a shape it has never counted. Teach it the shape instead.
    const alias = new Map<string, { key: string; deniedWhenTrue: boolean }>();
    for (let i = start + 1; i < end; i++) {
      const m = lines[i].match(/^  const (\w+) = (!)?\s*canAccess\w*\(\s*['"]([a-z0-9_]+)['"]\s*\)\s*;/);
      if (m) alias.set(m[1], { key: m[3], deniedWhenTrue: m[2] === '!' });
    }
    for (let i = start + 1; i < end; i++) {
      const m = lines[i].match(/^  if \(\s*(!)?\s*(\w+)\s*\)\s*(\{)?\s*$/);
      if (!m) continue;
      const a = alias.get(m[2]);
      // `if (!locked)` / `if (allowed)` is the OPEN branch, not the wall.
      if (!a || (m[1] === '!') === a.deniedWhenTrue) continue;
      if (!m[3] && /\)\s*return\b/.test(lines[i])) return a.key;
      let j = i + 1;
      while (j < end && lines[j].trim() === '') j++;
      if (j < end && /^\s+return\b/.test(lines[j])) return a.key;
    }
    return undefined;
  }

  // Fixture: the discrimination this whole check rests on. If the parser ever
  // starts counting an action-level gate, this is what says so — and if
  // closeout-binder itself grows a real entry gate, the chipless list below
  // will name it, which is the correct outcome either way.
  //
  // WHAT ACTUALLY EXCLUDES IT, stated precisely, because an earlier write-up of
  // this fixture said "its consequent is router.push(), not a return" and that
  // is not true: app/closeout-binder.tsx:195-198 is `{ router.push('/paywall');
  // return; }` — line 197 IS the return. Two things exclude it. (a) The `if`
  // sits at four spaces, inside a useCallback, and the regexes above require
  // the component's own two. (b) Even with the indent relaxed, the parser reads
  // only the FIRST non-blank line after the `if`, and that line is the push.
  // So the surviving discriminator is statement ORDER inside the block, which
  // is thinner than it looks: `{ return router.push('/paywall'); }` is
  // semantically identical and would parse as an entry gate, putting a padlock
  // over a door that opens. Keep this fixture honest — if it ever goes red
  // because the binder was reworded rather than rewalled, fix the parser, not
  // the registry row.
  const binder = read(join('app', 'closeout-binder.tsx'));
  ok('an action-level canAccess() is not mistaken for an entry gate',
    /canAccess\(\s*'client_portal'\s*\)/.test(binder) && entryGateOf(binder) === undefined,
    'app/closeout-binder.tsx gates only runPassportGeneration (a useCallback). If the parser '
    + 'reads that as an entry gate, every screen with one guarded BUTTON is told to paint a '
    + 'padlock over its whole door — the false lock the block above exists to prevent.');

  const chipless: string[] = [];
  const wrongTier: string[] = [];
  const differentKeySameTier: string[] = [];

  for (const entry of FEATURE_REGISTRY) {
    const file = screenFileFor(entry.route);
    if (!file) continue;                       // validate-feature-search.ts owns this
    const gate = entryGateOf(read(file));
    if (!gate) continue;                       // the other direction, above
    if (!(gate in REQUIRED_TIER)) continue;    // not a tier key at all
    const enforced = REQUIRED_TIER[gate as FeatureKey];
    if (!entry.requires) {
      chipless.push(`${entry.id} (${entry.route}) → ${file} refuses to render without '${gate}' (${enforced}), and the row carries no \`requires\``);
      continue;
    }
    const claimed = REQUIRED_TIER[entry.requires];
    if (claimed !== enforced) {
      wrongTier.push(`${entry.id} (${entry.route}): row says ${claimed} ('${entry.requires}'), the screen's entry gate is ${enforced} ('${gate}')`);
    } else if (entry.requires !== gate) {
      differentKeySameTier.push(`${entry.id}: '${entry.requires}' vs entry gate '${gate}' — same tier (${claimed})`);
    }
  }

  ok('every screen that refuses to render shows a chip saying so', chipless.length === 0,
    `${chipless.length} destination(s) advertise as unlocked and then paywall:\n        `
    + chipless.map(c => `• ${c}`).join('\n        ')
    + '\n        Put the key the screen actually gates on into the registry row\'s `requires`. '
    + 'An unbadged row that walls the user is the worst of the two failures: they had no warning, '
    + 'and the upsell they land on is the one they did not ask for.');

  ok('no chip names a softer tier than the entry gate it mirrors', wrongTier.length === 0,
    wrongTier.map(w => `• ${w}`).join('\n        ')
    + '\n        This is the margin-board / coi-vault drift (audit 2026-08-31 #27) seen from the '
    + 'entry gate rather than from any canAccess in the file.');

  // Not a failure: some screens gate on a differently-named key of the same
  // tier (punch_list_closeout vs rfis_submittals, both Business). Printed so a
  // rename shows up here before it becomes a tier difference.
  if (differentKeySameTier.length > 0) {
    console.log(`  ·     ${differentKeySameTier.length} row(s) name a different key than the entry gate, same tier:`);
    for (const s of differentKeySameTier) console.log(`          ${s}`);
  }

  // The ratchet. 16 rows were fixed on 2026-09-11; the count of screens whose
  // entry gate this parser can see must not fall, or the parser has gone blind
  // (a refactor to `<TierGate>`, a rename of canAccess) and every assertion
  // above passes vacuously — which is how 61 guards in the run that produced
  // this file stayed green while their subject was deleted.
  //
  // A FLOOR CANNOT SEE A SHAPE IT NEVER COUNTED. This stood at 48 while the
  // parser was blind to the alias wall (`const locked = !canAccess(…)`) and to
  // any file whose `//` comment contained a `/*`, and the floor was perfectly
  // green throughout: blindness to a shape looks exactly like the absence of
  // that shape. Teaching entryGateOf both took it to 52. The number goes up
  // when the parser learns something and down never — if a real screen loses
  // its wall this goes red, and if a refactor hides four more, so does this.
  const gatedSeen = FEATURE_REGISTRY.filter(e => {
    const f = screenFileFor(e.route);
    return f ? entryGateOf(read(f)) !== undefined : false;
  }).length;
  const FLOOR = 52;
  ok(`the entry-gate parser still sees the walls: ${gatedSeen} (floor ${FLOOR})`, gatedSeen >= FLOOR,
    `only ${gatedSeen} registry destinations parse as entry-gated, down from the floor of ${FLOOR}. The checks `
    + 'above cannot fail on a screen the parser cannot read, so a change to how screens gate must '
    + 'teach entryGateOf the new shape in the same commit.');

  // ── THE SAME DRIFT, ON THE ONE CATALOG THAT IS NOT THIS REGISTRY ──────────
  // Everything above only sees destinations FEATURE_REGISTRY knows about. The
  // Estimate hub does not go through it: app/(tabs)/estimate/index.tsx renders
  // utils/estimateHubEntries.HUB_ENTRIES, a second hand-written catalog with no
  // tier field at all and a screen with no tier hook — so every one of its ten
  // tiles paints as open. Measured 2026-09-12 with the parser above: SIX of
  // the ten refuse to render behind an entry gate (area-takeoff, estimate-
  // confidence, estimate-accuracy and living-estimate on 'job_costing' = pro;
  // estimate-calibration on 'portfolio_margin' = business; cost-xray on
  // 'cost_xray' = business). Two of those six ARE correctly chipped in this
  // registry — the hub simply does not read it.
  //
  // It was published as FIVE, and the missing one was the product's marquee AI
  // feature. Not a miscount: app/cost-xray.tsx walls through an alias
  // (`const locked = !canAccess('cost_xray')` … `if (locked) { … return`) and
  // the parser could not read that shape, so the number reported what the
  // PARSER could see and was written down as what the SCREENS do. A ratchet
  // whose whole job is to name the set for the next owner named five of six.
  //
  // A CEILING, NOT A FAILURE, and deliberately so. The fix is to give HUB_ENTRIES
  // a tier and the hub screen a lock, and both files belong to the estimate
  // work, not here; a red assertion on a file this wave may not edit blocks
  // ship-check for everyone, which is how guards get commented out. What this
  // does instead is stop the number GROWING silently: an eleventh gated tile
  // added with no lock turns it red, and the slack check turns it red if the
  // hub is fixed and the ceiling is left behind.
  {
    const HUB_SCREEN = join('app', '(tabs)', 'estimate', 'index.tsx');
    const hubSrc = read(HUB_SCREEN);

    // REACHABILITY, NOT PRESENCE: prove HUB_ENTRIES is what this screen
    // actually renders before counting anything against it. Without this the
    // count below is a statement about a list nothing draws.
    ok('the Estimate hub renders utils/estimateHubEntries',
      /from '@\/utils\/estimateHubEntries'/.test(hubSrc) && /entriesForGroup\(/.test(hubSrc),
      `${HUB_SCREEN} no longer imports and calls entriesForGroup — if the hub was rebuilt on the `
      + 'registry, delete this whole block (that IS the fix). If it moved to another list, point '
      + 'the count at the new one.');

    // Does the hub know about tiers at all? If it ever does, every number here
    // is stale and the slack check says so.
    const hubTierAware = /useTierAccess|useProjectAccess|canAccess|requiredTierFor/
      .test(stripComments(hubSrc));

    const hubWalled = HUB_ENTRIES.filter(e => {
      const f = screenFileFor(e.route);
      if (!f) return false;
      const gate = entryGateOf(read(f));
      return !!gate && gate in REQUIRED_TIER;
    });
    const HUB_CEILING = 6;
    ok(`Estimate hub tiles that wall the user with no lock: ${hubWalled.length} (ceiling ${HUB_CEILING})`,
      hubWalled.length <= HUB_CEILING,
      `${hubWalled.length} of ${HUB_ENTRIES.length} hub tiles open a screen that refuses to render:\n        `
      + hubWalled.map(e => {
        const f = screenFileFor(e.route)!;
        const g = entryGateOf(read(f))!;
        return `• ${e.id} (${e.route}) → '${g}' (${REQUIRED_TIER[g as FeatureKey]})`;
      }).join('\n        ')
      + '\n        The ceiling only goes down. Give HUB_ENTRIES a tier and the hub screen a lock '
      + 'chip — or route the hub through FEATURE_REGISTRY, which already carries the gate for '
      + 'area-takeoff and estimate-calibration.');
    // Fails in BOTH directions, including on the fix. A ratchet that stays
    // green after its subject is repaired is a dead guard, and this file's own
    // header is a list of those. If the hub grows a tier hook the premise
    // ("no tile can show a lock") is gone and every number here is a fossil —
    // so say so, and make deleting the block part of the same commit.
    ok('the Estimate hub ceiling is not slack',
      hubWalled.length === HUB_CEILING && !hubTierAware,
      hubTierAware
        ? `${HUB_SCREEN} now reads a tier (useTierAccess / canAccess). That is the fix this block `
          + 'was tracking, so delete the block — leaving it green would be a guard asserting a '
          + 'defect that no longer exists.'
        : `only ${hubWalled.length} of a ceiling of ${HUB_CEILING} — drop HUB_CEILING to `
          + `${hubWalled.length} so the ratchet keeps ratcheting.`);
  }
}

// Registry entries no rendered catalog names. These are reachable (the orphan
// checks above prove it) but only from a card, a tile or ⌘K — never from a
// browsable list. A RATCHET, not an exemption table: the number may fall and
// never rise, so a new destination cannot be added to the registry alone.
{
  const named = new Set(catalogRows.map(r => r.feature));
  const uncatalogued = FEATURE_REGISTRY.filter(e => !named.has(e.id)).map(e => e.id);
  const CEILING = 24;
  ok(`registry entries absent from every browsable catalog: ${uncatalogued.length} (ceiling ${CEILING})`,
    uncatalogued.length <= CEILING,
    `now ${uncatalogued.length}: ${uncatalogued.join(', ')}\n        `
    + 'Add the destination to a catalog (a sidebar row, a Tools row, the Summary sheet or '
    + 'the Create menu) — or, if it genuinely belongs to search and deep links only, LOWER '
    + 'the ceiling in the same commit as the removal. The ceiling only ever goes down.');
  ok('the uncatalogued ceiling is not slack', uncatalogued.length >= CEILING - 2,
    `only ${uncatalogued.length} of a ceiling of ${CEILING} — drop CEILING to ${uncatalogued.length} `
    + 'so the ratchet keeps ratcheting.');
}

// ── Project-scoped registry entries render the picker ───────────────────────
// featureRegistry's own inclusion rule is "a destination must stand on its own
// when pushed with no params". `projectScoped: true` is the flag for the rows
// that satisfy it the hard way. scripts/validate-project-scoped-screens.ts
// pins the eight screens the 2026-08-03 audit named; this pins the RULE, so
// the six added on 2026-09-07 (contract, change-order, selections, submittal,
// oac-meeting, aia-pay-app) and everything after are covered on day one.

console.log('\nproject-scoped registry entries resolve their own project:');

// Two screens satisfy "a pick beats a dead param" by different means and both
// are correct: most hold the pick in local state (`pickedProjectId ?? param…`),
// while app/budget-dashboard.tsx pushes it into the URL with router.setParams,
// which overwrites the stale id outright. Accept either; reject neither by
// accident.
const OUTRANKS_STALE = [
  /pickedProjectId \?\? param(ProjectId|Id|InvoiceId)/,
  /onPick=\{\(id\) => router\.setParams\(\{ projectId: id \}\)\}/,
];

// Screens that are in the registry as projectScoped and do NOT yet keep the
// whole contract. Every line is a live defect with a named owner, not an
// excuse, and it FAILS the moment the screen is fixed and the line is left
// behind. None is in the 2026-09-07 nav wave's file set.
const PENDING_PICKER_CONTRACT: Record<string, { outranks?: string; stale?: string }> = {
  '/ai-punch': { stale: 'app/ai-punch.tsx:489 renders the picker without staleProjectId — precedence is correct, only the notice is missing.' },
  '/compare-drawings': { stale: 'app/compare-drawings.tsx renders the picker without staleProjectId — precedence is correct, only the notice is missing.' },
  '/extract-submittals': { stale: 'app/extract-submittals.tsx renders the picker without staleProjectId — precedence is correct, only the notice is missing.' },
};

for (const entry of FEATURE_REGISTRY) {
  if (!entry.projectScoped) continue;
  const rel = entry.route.replace(/^\//, '');
  const file = [join('app', rel + '.tsx'), join('app', rel, 'index.tsx')]
    .find(f => existsSync(join(ROOT, f)));
  if (!ok(`${entry.route}: screen file exists`, !!file)) continue;
  const src = read(file!);
  const pending = PENDING_PICKER_CONTRACT[entry.route];

  ok(`${entry.route}: renders <ToolProjectPicker>`,
    /<ToolProjectPicker\b/.test(src) && /from '@\/components\/ToolScreenChrome'/.test(src),
    `utils/featureRegistry marks '${entry.id}' projectScoped, which is a promise that opening it `
    + 'from the sidebar or ⌘K with no params lands somewhere usable. Use the shared picker.');

  const outranks = OUTRANKS_STALE.some(re => re.test(src));
  if (pending?.outranks) {
    ok(`${entry.route}: pending pick-precedence fix is still owed`, !outranks,
      `it is fixed now — delete the PENDING_PICKER_CONTRACT.outranks entry. On file: ${pending.outranks}`);
  } else {
    ok(`${entry.route}: a fresh pick outranks a stale param`, outranks,
      'must be `pickedProjectId ?? param… ?? \'\'` (or router.setParams, which overwrites the '
      + 'param) — the other order leaves the picker inert on a dead link, because the bad id '
      + 'keeps winning');
  }

  const tellsStale = /staleProjectId/.test(src);
  if (pending?.stale) {
    ok(`${entry.route}: pending stale-id notice is still owed`, !tellsStale,
      `it is handled now — delete the PENDING_PICKER_CONTRACT.stale entry. On file: ${pending.stale}`);
  } else {
    ok(`${entry.route}: tells a stale id apart from no id`, tellsStale,
      'a deleted project or an old shared link arrives WITH an id that resolves to nothing; that '
      + 'is not the same failure as arriving with none, and it used to render blank');
  }

  // The picker must be an early RETURN, not a card buried in the loaded tree —
  // a screen that renders it mid-tree still mounts the rest against an
  // undefined project. Match the whole `if (!project…) { return (` shape, the
  // same one scripts/validate-project-scoped-screens.ts:106 pins: a bare
  // indexOf('if (!project') matched any earlier guard in the file and any
  // rename that kept the prefix, so it passed on code it should have failed.
  // (Caught by mutation-testing this assert.)
  const pickerAt = src.indexOf('<ToolProjectPicker');
  // `[^)]*!` before the identifier so a compound guard counts too — invoice
  // and field-ticket open with `if (!invoice || !project)` and
  // `if (!activeProjectId || !project)`, both correct.
  const guardRe = /if\s*\([^)]*!\s*[A-Za-z]*[Pp]roject[A-Za-z]*\b[^)]*\)\s*\{\s*\n\s*return\s*\(/g;
  let m: RegExpExecArray | null, guardAt = -1;
  while ((m = guardRe.exec(src))) if (m.index < pickerAt && m.index > guardAt) guardAt = m.index;
  ok(`${entry.route}: the picker is an early return`,
    guardAt !== -1 && pickerAt - guardAt < 2000,
    'the no-project branch must return before the screen renders anything against an '
    + 'undefined project');
}
for (const route of Object.keys(PENDING_PICKER_CONTRACT)) {
  ok(`pending picker-contract entry '${route}' is still project-scoped`,
    FEATURE_REGISTRY.some(e => e.route === route && e.projectScoped),
    'it is no longer marked projectScoped in utils/featureRegistry — drop the entry');
}

// aia-pay-app is invoice-keyed, so "pick a project" is only half the answer.
{
  const aia = read(join('app', 'aia-pay-app.tsx'));
  ok('AIA Pay Apps asks which BILLING PERIOD after which job',
    /progressInvoices/.test(aia) && /setPickedInvoiceId/.test(aia)
    && /progressInvoices\.length === 1 \? progressInvoices\[0\]/.test(aia),
    'a G702 certifies one period against one job. Picking the project is not enough — the '
    + 'screen must resolve the progress invoice, open straight through when there is exactly '
    + 'one, and let the GC pick when there are several.');
  ok('a job with no progress invoice is told WHY, with the next step',
    /has no progress invoice yet/.test(aia) && /'\/bill-from-estimate'/.test(aia),
    'a pay application cannot be the first document on a job — say that and offer the invoice, '
    + 'rather than showing an empty list');
}

// ── Hidden tabs offer a way out ─────────────────────────────────────────────
// A tab registered `href: null` is entered by a TAB SWITCH: React Navigation
// draws no back button and none of the visible tabs lights up. NAV-07 gave
// five of them components/HiddenTabBackLink; three never got it.

console.log('\nhidden tabs (href: null) have a back affordance:');
{
  const tabsLayout = read(join('app', '(tabs)', '_layout.tsx'));
  const hidden = new Set(
    [...tabsLayout.matchAll(/<Tabs\.Screen\s+name="([^"]+)"\s+options=\{\{\s*href:\s*null\s*\}\}/g)]
      .map(m => m[1]),
  );
  ok('parsed the unconditionally-hidden tabs out of app/(tabs)/_layout.tsx',
    hidden.size >= 6, `found ${hidden.size}: ${[...hidden].join(', ')}`);

  // Owed, not excused. Each line dies the moment the link lands — that is what
  // stops this from becoming the place the fix goes to be forgotten.
  const PENDING_BACK_LINK: Record<string, string> = {
    // Empty. All three — schedule, marketplace and construction-ai — gained a
    // HiddenTabBackLink on 2026-09-08. The assertions below still walk every
    // href:null tab, so a NEW hidden tab with no way out fails immediately
    // rather than being quietly added to this list.
  };

  for (const name of hidden) {
    const file = [join('app', '(tabs)', name, 'index.tsx'), join('app', '(tabs)', name + '.tsx')]
      .find(f => existsSync(join(ROOT, f)));
    if (!file) continue;
    const has = /<HiddenTabBackLink\b/.test(read(file));
    if (PENDING_BACK_LINK[name]) {
      // Stale-pending check: gaining the link must FAIL until the line is gone.
      ok(`pending back-link for '${name}' is still owed`, !has,
        `${file} now mounts <HiddenTabBackLink> — delete the PENDING_BACK_LINK entry. `
        + `Reason on file: ${PENDING_BACK_LINK[name]}`);
      continue;
    }
    ok(`hidden tab '${name}' offers a way out`, has,
      `${file} is entered as a tab switch, so nothing draws a back control and no tab lights `
      + 'up. Mount components/HiddenTabBackLink with a label that names where it goes, or add '
      + 'a PENDING_BACK_LINK entry saying who owes it.');
  }
  for (const name of Object.keys(PENDING_BACK_LINK)) {
    ok(`pending back-link '${name}' is still a hidden tab`, hidden.has(name),
      'it is no longer registered `href: null` in app/(tabs)/_layout.tsx — drop the entry');
  }
}

// ── Materials retired cleanly ───────────────────────────────────────────────
// The pill came off the Discover strip months ago; the route key and the
// re-export file it pointed at stayed, so the strip named a destination
// nothing could reach and a duplicate route stayed registered.
{
  const discover = read(join('app', '(tabs)', 'discover', 'index.tsx'));
  // Match the ROUTE SHAPE, not the word: the comment that records the removal
  // names the deleted file, and a file-wide search would fail on its own
  // tombstone. (Caught by mutation-testing this assert.)
  ok('Discover carries no route to the retired Materials alias',
    !/['"`]\/?\(tabs\)\/discover\/materials['"`?]/.test(discover),
    'the `materials` key in handleTabPress pointed at a pill that no longer exists');
  ok('the app/(tabs)/discover/materials.tsx alias is gone',
    !existsSync(join(ROOT, 'app', '(tabs)', 'discover', 'materials.tsx')),
    'it was a one-line re-export of the Materials tab, giving one screen two routes');
  ok('the Materials tab itself is still reachable',
    /\/\(tabs\)\/materials/.test(read(join('utils', 'entityResolver.ts')))
    && FEATURE_REGISTRY.some(e => e.route === '/(tabs)/materials'),
    'retiring the alias must not orphan the screen — a price-alert notification and ⌘K are '
    + 'its remaining doors');
}

// ── The most destructive action names what it destroys ──────────────────────
{
  const detail = read(join('app', 'project-detail.tsx'));
  const at = detail.indexOf('const handleDelete');
  const block = at === -1 ? '' : detail.slice(at, at + 1400);
  // TWICE: once in the alert title, once in the body. A single occurrence
  // passed a version that named the job in the title and still said "this
  // project and everything in it" underneath — which is the sentence the GC
  // actually reads before tapping Delete. (Caught by mutation-testing this.)
  const named = (block.match(/\$\{name\}/g) ?? []).length;
  ok('Delete Project names the project it is about to delete',
    /project\?\.name/.test(block) && named >= 2 && !/'Delete Project',/.test(block),
    `app/project-detail.tsx handleDelete interpolates the name ${named} time(s); it must appear `
    + 'in the title AND the body. There is no undo and no trash, the modal covers the screen '
    + 'behind it, and a GC running eight jobs cannot check "this project" against anything.');
}

// ── Result ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\nnav-coverage validation FAILED (${failures})\n`);
  process.exit(1);
}
console.log('\n  PASS  nav-coverage: every registered route has a door, on phone and on desktop\n');
