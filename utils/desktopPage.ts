// utils/desktopPage.ts — which page column every route gets on desktop web.
//
// WHY THIS EXISTS (wave 6b, founder 2026-09-22: "the website app… really isn't
// utilizing the space a computer screen gives you"). Stack routes rendered in
// a bare flex:1 View beside the sidebar, so ~125 of the 167 route files drew
// 1816 px wide on a 2056 px window — a phone column stretched across a
// monitor. Only the tab routes had a cap, and theirs was a literal 1400 in
// app/(tabs)/_layout.tsx that nothing else agreed with.
//
// One map, one width source. Every route file under app/ is named here with a
// LayoutPageType; components/desktop/DesktopPageFrame reads it (through the
// root Stack's `screenLayout`) and caps the page at Layout.page[kind]. Nothing
// here is read on a phone: the frame returns its children untouched unless
// useResponsiveLayout().isDesktop.
//
// PURE — type-only imports, no react-native. scripts/validate-desktop-page-map
// imports this file under bun (react-native crashes bun), and it fails the
// build when a route file is missing from ROUTE_PAGE_TYPE or when a name here
// no longer matches a file.

import type { LayoutPageType } from '@/constants/designTokens';

// ─── Desktop web shell — route denylist ────────────────────────────────────
// Moved here from app/_layout.tsx (wave 6b) so the shell, the sync pill and
// the page frame read ONE list. History (audit web#31): DesktopSidebar was
// mounted only inside app/(tabs)/_layout.tsx, so navigating to any root-stack
// route on desktop web dropped the persistent sidebar. The fix lifted the
// shell to RootLayoutNav so it wraps the whole Stack — but that would also
// wrap login/onboarding/external viewers/modals, so the shell is gated on
// auth + onboarding state AND the current top-level segment not being here.
//
// Exemption classes:
//  1. Auth + first-run flows — the user isn't (fully) in the app yet; these
//     screens are full-bleed brand moments.
//  2. External / tokenized viewers — opened by homeowners & subs with no MAGE
//     account (the URL token is the credential) or rendered mid-OAuth; they
//     must never show the owner's workspace chrome.
//  3. `presentation: 'modal'` flows that are a full-page takeover with their
//     own close affordance. Wave 6b gave four of them the sidebar back
//     (cost-xray, scan, judges, quick-quote): they are tools a GC opens from
//     the sidebar and then wants to leave through it, and the page frame now
//     keeps their column readable. Ask and Copilot stay exempt until the
//     ShellDock hosts them (wave 6c).
//  4. Full-takeover editors that size off useWindowDimensions breakpoints tuned
//     for a full-bleed viewport. schedule-pro's GRID_BREAKPOINT=900 /
//     SPLIT_BREAKPOINT=1600 assume window width === content width; inside the
//     240 px shell the grid would pass the ≥900 gate while actually getting
//     window−240 px. (schedule-review's wideEnoughForPro gate relies on this.)
export const DESKTOP_SHELL_EXEMPT: ReadonlySet<string> = new Set([
  // 1 — auth + first-run
  'login', 'signup', 'reset-password',
  'onboarding', 'persona-select', 'onboarding-paywall',
  // 2 — external / tokenized viewers
  'client-view', 'prequal-form', 'claim-crew', 'shared-schedule', 'shared-photos', 'shared-estimate',
  'shared-plan',
  // 3 — presentation:'modal' full-page takeovers
  'ask', 'schedule-wizard', 'schedule-builder', 'copilot', 'copilot-hub',
  'schedule-import', 'paywall', 'import-pipeline',
  'post-rfp', 'submit-bid-response', 'photo-annotator', 'estimate-wizard',
  'brief',
  // 4 — full-takeover editors with window-width breakpoints
  'schedule-pro',
]);

/**
 * The page type of every route file in app/ (keyed by the name the root Stack
 * gives the route: the file path under app/ without the extension).
 *
 *   auth 480 · form 760 · reading 760 · dashboard 1280 · table 1600
 *   bleed    — no cap: canvases, kanban, camera/AR, brand + external pages.
 *
 * Grouped by kind so a reviewer can see the whole decision at once. A route
 * missing from here would silently take the fallback in pageTypeForRoute —
 * validate-desktop-page-map forbids that, so a new screen has to be placed.
 */
export const ROUTE_PAGE_TYPE: Readonly<Record<string, LayoutPageType>> = {
  // ── The tab navigator frames itself (see TAB_PAGE_TYPE below).
  '(tabs)': 'dashboard',

  // ── auth — one 480 column, the same as login.
  'login': 'auth', 'signup': 'auth', 'reset-password': 'auth', 'accept-invite': 'auth',

  // ── bleed — full-bleed tools and pages that draw their own canvas.
  // Brand / first-run pages.
  'onboarding': 'bleed', 'persona-select': 'bleed', 'onboarding-paywall': 'bleed',
  // External / tokenised viewers and the OAuth callback.
  'client-view': 'bleed', 'prequal-form': 'bleed', 'claim-crew': 'bleed',
  'shared-schedule': 'bleed', 'shared-photos': 'bleed', 'shared-estimate': 'bleed',
  'shared-plan': 'bleed', 'integrations/qbo/callback': 'bleed',
  // Canvases: Gantt grid, drawings, takeoff, markup, pin-on-plan, kanban,
  // camera walk, AR.
  'schedule-pro': 'bleed', 'plan-viewer': 'bleed', 'takeoff': 'bleed', 'area-takeoff': 'bleed',
  'drawing-analyzer': 'bleed', 'compare-drawings': 'bleed', 'punch-pin': 'bleed',
  'photo-annotator': 'bleed', 'leads': 'bleed', 'punch-walk': 'bleed', 'dev-ar-measure': 'bleed',

  // ── form 760 — create/edit forms, wizards, one-question interviews, chat.
  'rfi': 'form', 'contract': 'form', 'company-profile': 'form', 'field-ticket': 'form',
  'submittal': 'form', 'lead-detail': 'form', 'post-bid': 'form', 'post-job': 'form',
  'equipment-detail': 'form', 'managed-property': 'form', 'client-update': 'form',
  'material-receipt': 'form', 'oac-meeting': 'form', 'generative-setup': 'form',
  // Shell-exempt flows framed as a column (fixes the 2016 px Copilot text box
  // without touching the Copilot files).
  'schedule-builder': 'form', 'schedule-import': 'form', 'copilot': 'form', 'copilot-hub': 'form',
  'ask': 'form', 'quick-quote': 'form', 'post-rfp': 'form', 'submit-bid-response': 'form',
  'import-pipeline': 'form',
  // Settings-like single-column pages.
  'connect-claude': 'form', 'data-export': 'form', 'data-import': 'form',
  'notifications-settings': 'form', 'public-profile-setup': 'form', 'sub-portal-setup': 'form',
  'client-portal-setup': 'form', 'payments-setup': 'form', 'qbo-setup': 'form',
  'get-verified': 'form', 'work-order': 'form', 'warranty-walk': 'form',
  'dev-seeder': 'form', 'dev-flagship-seeder': 'form', 'tax-1099-export': 'form',
  'client-messages': 'form', 'messages': 'form', '+not-found': 'form',
  'tutorials': 'form',

  // ── reading 760 — long single-column text. No route takes it today:
  // construction-news was seeded here, but on desktop that screen lays its
  // cards out two-up and caps its own list at 1100 (app/construction-news.tsx),
  // so a 760 column squeezed each card from ~530 px to ~356 px. It is framed
  // as 'dashboard' below instead, which leaves the screen's own 1100 cap in
  // charge — exactly what it rendered before wave 6b. If wave 6c turns the
  // feed into a one-column read, move it back here.

  // ── table 1600 — registers with 7+ numeric columns.
  'wip-report': 'table', 'bid-leveling': 'table', 'buyout-package': 'table', 'aia-pay-app': 'table',
  'job-costing': 'table', 'cost-database': 'table',

  // ── Self-capped screens (SELF_CAPPED_ROUTES): the frame passes them
  // through; the kind is the Layout token wave 6c swaps their literal for.
  'project-detail': 'dashboard', 'invoice': 'dashboard', 'change-order': 'dashboard',
  'daily-report': 'dashboard', 'judges': 'form', 'brief': 'dashboard',
  'estimate-wizard': 'form', 'schedule-wizard': 'form', 'schedule-review': 'form',
  'cost-seed': 'form', 'widget-setup': 'form',
  'safety': 'dashboard', 'safety-certifications': 'dashboard', 'safety-forms': 'dashboard',
  'safety-hazards': 'dashboard', 'safety-incidents': 'dashboard', 'safety-inspections': 'dashboard',
  'safety-osha': 'dashboard', 'safety-toolbox': 'dashboard',
  'cash-flow': 'dashboard', 'budget-dashboard': 'dashboard',
  'delay-events': 'dashboard', 'home-passport': 'dashboard', 'auto-bids': 'dashboard',
  'bid-detail': 'dashboard', 'business': 'dashboard', 'closeout-binder': 'dashboard',
  'last-planner': 'dashboard', 'paywall': 'dashboard', 'profit-leak-history': 'dashboard',
  'sub-profile': 'dashboard', 'track-record': 'dashboard', 'waiting-on': 'dashboard',
  'week-close': 'dashboard',

  // ── dashboard 1280 — lists, reports, hubs.
  // cost-xray and scan got the sidebar back in wave 6b; the audit asked for a
  // 1200 cap and dashboard (1280) is the nearest token, so one width source
  // holds. Wave 6c: scan (like judges) is a one-column flow — 'form' (lane H
  // caps its content); cost-xray stays a dashboard.
  'scan': 'form',
  'cost-xray': 'dashboard', 'safety-jha': 'dashboard',
  'construction-news': 'dashboard',
  'activity-feed': 'dashboard', 'ai-punch': 'dashboard', 'bill-from-estimate': 'dashboard',
  'building-access': 'dashboard', 'buyout': 'dashboard', 'buyout-scope-gap': 'dashboard',
  'client-outbox': 'dashboard', 'coi-vault': 'dashboard', 'company-detail': 'dashboard',
  'contacts': 'dashboard', 'crew': 'dashboard', 'deliveries': 'dashboard', 'documents': 'dashboard',
  'estimate-accuracy': 'dashboard', 'estimate-calibration': 'dashboard',
  'estimate-confidence': 'dashboard', 'estimate-scorecard': 'dashboard',
  'extract-submittals': 'dashboard', 'handover': 'dashboard', 'integrations': 'dashboard',
  'job-detail': 'dashboard', 'lien-waivers': 'dashboard', 'living-estimate': 'dashboard',
  'margin-alerts': 'dashboard', 'margin-risk': 'dashboard', 'my-rfps': 'dashboard',
  'nearby-rfps': 'dashboard', 'notifications-inbox': 'dashboard',
  'payment-predictions': 'dashboard', 'payments': 'dashboard', 'permits': 'dashboard',
  'photo-triage': 'dashboard', 'plan-intelligence': 'dashboard', 'plans': 'dashboard',
  'portfolio-margin': 'dashboard', 'prequal-manager': 'dashboard', 'project-files': 'dashboard',
  'project-memory': 'dashboard', 'project-scope': 'dashboard', 'punch-list': 'dashboard',
  'qbo-review': 'dashboard', 'report-inbox': 'dashboard', 'reports': 'dashboard',
  'retention': 'dashboard', 'rfp-detail': 'dashboard', 'rfp-responses-review': 'dashboard',
  'scope-sheet': 'dashboard', 'selections': 'dashboard', 'smart-proposal': 'dashboard',
  'sub-portals': 'dashboard', 'sub-scorecard': 'dashboard', 'takeoff-estimate': 'dashboard',
  'time-tracking': 'dashboard', 'warranties': 'dashboard', 'weekly-snapshot': 'dashboard',
  'win-optimizer': 'dashboard', 'worker-detail': 'dashboard',
};

/**
 * Routes that already cap their OWN scroll content (a hand-typed maxWidth on
 * the ScrollView's contentContainerStyle). The frame passes them through
 * untouched: framing them would add dead margins where the mouse wheel does
 * nothing (the ScrollView would sit inside the frame), on the most-used
 * screens. Their ROUTE_PAGE_TYPE entry is the Layout token wave 6c swaps their
 * literal for. The four auth pages are here too: each is a full-bleed brand
 * background with a 480 column inside it.
 */
export const SELF_CAPPED_ROUTES: ReadonlySet<string> = new Set([
  'login', 'signup', 'reset-password', 'accept-invite',
  'project-detail', 'invoice', 'change-order', 'daily-report', 'estimate-wizard',
  'schedule-wizard', 'schedule-review', 'job-costing', 'cost-database', 'judges', 'brief',
  'safety', 'safety-certifications', 'safety-forms', 'safety-hazards', 'safety-incidents',
  'safety-inspections', 'safety-osha', 'safety-toolbox',
  'cash-flow', 'budget-dashboard', 'cost-seed', 'delay-events', 'home-passport',
  'auto-bids', 'bid-detail', 'business', 'closeout-binder', 'last-planner', 'paywall',
  'profit-leak-history', 'sub-profile', 'track-record', 'waiting-on', 'week-close',
  'widget-setup',
]);

/**
 * The tab navigator frames its own content (app/(tabs)/_layout.tsx) from this
 * map, keyed by the active tab's segment: the estimate hub is a table, every
 * other tab a dashboard. Replaces the tabs-only literal 1400.
 */
export const TAB_PAGE_TYPE: Readonly<Record<string, LayoutPageType>> = {
  'estimate': 'table',
};

/** The top-level segment of a route name ('integrations/qbo/callback' → 'integrations'). */
function topSegmentOf(routeName: string): string {
  return routeName.split('/')[0] ?? routeName;
}

/**
 * The page type for a root-Stack route. A route the map does not name falls
 * back to 'bleed' when it is shell-exempt (never frame a takeover we have not
 * looked at) and to 'dashboard' otherwise.
 */
export function pageTypeForRoute(routeName: string): LayoutPageType {
  const mapped = ROUTE_PAGE_TYPE[routeName];
  if (mapped) return mapped;
  return DESKTOP_SHELL_EXEMPT.has(topSegmentOf(routeName)) ? 'bleed' : 'dashboard';
}

/** The page type for the active tab of the (tabs) navigator. */
export function pageTypeForTab(tabSegment: string | undefined): LayoutPageType {
  return (tabSegment && TAB_PAGE_TYPE[tabSegment]) || 'dashboard';
}

/**
 * The cap kind the root Stack's DesktopPageFrame applies to a route, or null
 * when the route passes through unframed: '(tabs)' (frames itself), bleed
 * routes (no cap by design) and self-capped routes (see SELF_CAPPED_ROUTES).
 */
export function frameKindForRoute(routeName: string): Exclude<LayoutPageType, 'bleed'> | null {
  if (routeName === '(tabs)') return null;
  if (SELF_CAPPED_ROUTES.has(routeName)) return null;
  const kind = pageTypeForRoute(routeName);
  return kind === 'bleed' ? null : kind;
}
