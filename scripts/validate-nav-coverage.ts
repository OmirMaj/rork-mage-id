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
// Pure node:fs — no bundler, no react-native import (those crash bun).
// fileURLToPath + join because the repo path contains a space.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let failures = 0;
function ok(name: string, condition: boolean, detail?: string): void {
  if (condition) { console.log('  PASS  ' + name); return; }
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
  failures += 1;
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
  'sub-profile': 'ORPHAN, knowingly. app/sub-profile.tsx is the supply-side credential for a SUBCONTRACTOR, and a GC who opens it sees an empty profile (it matches the signed-in email against the current workspace ledger, :50-62). The fix is a link from app/claim-crew.tsx and app/prequal-form.tsx where a sub actually lands, plus a settings row gated on the email appearing in a sub record — NOT a sidebar or Tools row. Audit 2026-09-07, navigation-ia. Delete this line when that link exists.',
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

// ── Result ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\nnav-coverage validation FAILED (${failures})\n`);
  process.exit(1);
}
console.log('\n  PASS  nav-coverage: every registered route has a door, on phone and on desktop\n');
