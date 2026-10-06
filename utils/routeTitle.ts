// utils/routeTitle.ts
//
// Audit-2026-05-21 W1 (extracted from app/_layout.tsx 2026-08): map a router
// pathname → human-readable page title for the browser tab on web.
//
// Lives in its own dependency-free module (no React, no expo-router, no RN) so
// scripts/validate-route-titles.ts can execute it under bun and pin the map
// against the real app/ route tree. Importing app/_layout.tsx from a script is
// not an option — it drags in the whole provider tree.
//
// Returns null for routes not in the table; the caller falls back to plain
// "MAGE ID" rather than inventing a label. Add entries when new routes ship —
// the validator fails the build if a primary destination is missing.

/** Remove Expo Router group segments — '/(tabs)/(home)/x' → '/x'. */
function stripGroups(path: string): string {
  return path
    .split('/')
    .filter(seg => !(seg.startsWith('(') && seg.endsWith(')')))
    .join('/');
}

/**
 * Audit-2026-05-21 W1: map pathname → human-readable page title for the
 * browser tab on web. Returns null for routes not in the table (the effect
 * falls back to plain "MAGE ID" — no false labels). Add entries when new
 * top-level routes ship.
 */
export function pathToDocumentTitle(pathname: string): string | null {
  if (!pathname || pathname === '/') return 'Projects';
  // Strip query / hash if router ever passes them, then drop every Expo Router
  // group segment — `(tabs)`, `(home)`, … are organisational, never part of the
  // URL the user sees, but usePathname has historically leaked them. Doing it
  // once here (rather than the old single `/(tabs)` special case) means
  // `/(tabs)/(home)` and `/(tabs)/estimate/full` both resolve like the plain
  // paths they are.
  const path =
    stripGroups(pathname.split('?')[0].split('#')[0]);
  if (path === '' || path === '/') return 'Projects';
  // Exact matches first.
  const exact: Record<string, string> = {
    '/': 'Projects',
    // Titles below mirror components/DesktopSidebar.tsx NAV_ITEMS labels
    // VERBATIM. Deliberately no invented copy: the sidebar label is a naming
    // decision the founder already made, so reusing it keeps the browser tab,
    // the sidebar and the search result saying the same word for the same
    // screen. Routes with no sidebar label are left out rather than guessed —
    // validate-route-titles still lists them as "needs a copy decision".
    '/ask': 'Ask MAGE',
    '/attention': 'Needs Attention',
    '/auto-bids': 'Pre-Priced Bids',
    '/building-access': 'Building Access',
    '/business': 'Your Business',
    '/copilot-hub': 'MAGE Copilot',
    '/construction-news': 'Construction News',
    '/cost-seed': 'Seed Your Rates',
    '/cost-xray': 'Cost X-Ray',
    '/deliveries': 'Deliveries',
    '/estimate-scorecard': 'Estimate Scorecard',
    '/field-ticket': 'T&M Tickets',
    '/home-passport': 'Home Passport',
    '/judges': 'Bid Advisor',
    '/my-rfps': 'My Projects',
    '/post-rfp': 'Post a Project',
    '/safety': 'Safety',
    '/scan': 'Scan Anything',
    '/track-record': 'Track Record',
    '/waiting-on': 'Waiting on Others',
    '/widget-setup': 'Website Widget',
    '/wip-report': 'WIP Report',
    '/summary': 'Summary',
    '/shared-plan': 'Floor Plan',
    '/login': 'Sign In',
    '/signup': 'Create Account',
    '/onboarding': 'Welcome',
    '/persona-select': 'Welcome',
    '/onboarding-paywall': 'Subscribe',
    '/paywall': 'Subscribe',
    '/reset-password': 'Reset Password',
    '/settings': 'Settings',
    '/settings/appearance': 'Appearance',
    '/settings/language': 'Language',
    '/notifications-inbox': 'Notifications',
    '/messages': 'Messages',
    '/report-inbox': 'Report Inbox',
    '/profit-leak-history': 'Profit Leak History',
    '/activity-feed': 'Activity',
    '/payments': 'Payments',
    '/payments-setup': 'Stripe Connect',
    '/plans': 'Plans',
    '/reports': 'Reports',
    '/invoice': 'Invoice',
    '/aia-pay-app': 'Pay App',
    '/change-order': 'Change Order',
    '/budget-dashboard': 'Budget Dashboard',
    '/cash-flow': 'Cash Flow',
    '/job-costing': 'Job Costing',
    '/living-estimate': 'Living Estimate',
    '/generative-setup': 'Set Up Project',
    '/margin-risk': 'Margin Risk',
    '/sub-scorecard': 'Sub Scorecard',
    '/buyout-scope-gap': 'Scope Gap Check',
    '/estimate-accuracy': 'Estimate Accuracy',
    '/estimate-confidence': 'Estimate Confidence',
    '/estimate-calibration': 'Estimate Calibration',
    '/cost-database': 'Cost History',
    '/area-takeoff': 'Visual Takeoff',
    '/project-memory': 'Project Memory',
    '/portfolio-margin': 'Margin Board',
    '/margin-alerts': 'Margin Alerts',
    '/contract': 'Contract',
    '/selections': 'Selections',
    '/closeout-binder': 'Closeout Binder',
    '/punch-list': 'Punch List',
    '/punch-walk': 'Punch Walk',
    '/punch-pin': 'Pin Items',
    '/ai-punch': 'AI Punch',
    '/rfi': 'RFI',
    '/submittal': 'Submittal',
    '/oac-meeting': 'OAC Meeting',
    '/daily-report': 'Daily Report',
    '/tutorials': 'Tutorials',
    '/delay-events': 'Delay Register',
    '/time-tracking': 'Time Tracking',
    '/photo-triage': 'Photo Triage',
    '/leads': 'Pipeline',
    '/contacts': 'Contacts',
    '/crew': 'Crew',
    '/buyout': 'Buyout',
    '/buyout-package': 'Bid Package',
    '/bid-leveling': 'Bid Leveling',
    '/win-optimizer': 'Win Optimizer',
    '/smart-proposal': 'Smart Proposal',
    '/material-receipt': 'Material Receipt',
    '/last-planner': 'Last Planner',
    '/plan-intelligence': 'Plan Intelligence',
    '/bill-from-estimate': 'Bill from Estimate',
    '/client-messages': 'Client Messages',
    '/client-portal-setup': 'Client Portal',
    '/client-view': 'Client View',
    '/client-update': 'Client Update',
    '/permits': 'Permits',
    '/warranties': 'Warranties',
    '/lien-waivers': 'Lien Waivers',
    '/coi-vault': 'COI Vault',
    '/prequal-manager': 'Prequal Manager',
    '/prequal-form': 'Prequal Form',
    '/claim-crew': 'Claim Profile',
    '/sub-portals': 'Sub Portals',
    '/sub-portal-setup': 'Sub Portal',
    '/public-profile-setup': 'Project Page',
    '/integrations': 'Integrations',
    '/handover': 'Handover',
    '/weekly-snapshot': 'Weekly Snapshot',
    '/schedule-pro': 'Schedule',
    '/schedule-review': 'Review Schedule',
    '/schedule-wizard': 'Schedule Wizard',
    '/schedule-builder': 'Schedule Builder',
    '/shared-schedule': 'Schedule',
    '/estimate-wizard': 'Estimate',
    '/bid-detail': 'Bid',
    '/submit-bid-response': 'Submit Bid',
    '/post-bid': 'Post Bid',
    '/post-homeowner-request': 'Post Project',
    '/post-community-bid': 'Post Bid',

    // ── Primary tab destinations ────────────────────────────────────────
    // These are the roots of the app/(tabs)/* groups. The nested patterns
    // below already labelled their CHILDREN (/materials/tile, /discover/hire,
    // …) but the roots themselves were never in this table, so every top-level
    // tab landed on a bare "MAGE ID". Labels are the ones the app already uses
    // for these destinations (app/(tabs)/_layout.tsx Tabs.Screen titles and the
    // screens' own headers) — not new copy.
    '/discover': 'Discover',
    '/materials': 'Materials',
    '/equipment': 'Equipment',
    '/marketplace': 'Marketplace',
    '/mage-id-bids': 'MAGE ID Bids',
    '/construction-ai': 'Construction AI',
    '/subs': 'Subs',
    '/schedule': 'Schedule',

    // ── Estimate group (app/(tabs)/estimate/*) ─────────────────────────
    // The three highest-traffic screens in the product. /estimate-accuracy,
    // -confidence and -calibration were mapped; the estimate hub itself and
    // its two children were not, and '/estimate' missing from this table also
    // defeated the detail-route fallback below (it looks up '/estimate').
    '/estimate': 'Estimate',
    '/estimate/full': 'Estimator',
    '/estimate/review': 'Estimate Review',
  };
  if (exact[path]) return exact[path];
  // Common nested patterns.
  if (path.startsWith('/discover/')) {
    const seg = path.replace('/discover/', '');
    const DISCOVER_TITLES: Record<string, string> = { tools: 'Tools', bids: 'Public Bids', companies: 'Companies', hire: 'Direct Hire', estimate: 'Estimator', schedule: 'Schedule' };
    return DISCOVER_TITLES[seg] ?? seg.replace(/^[a-z]/, (c) => c.toUpperCase());
  }
  if (path.startsWith('/materials/')) return 'Materials';
  if (path.startsWith('/equipment/')) return 'Equipment';
  if (path.startsWith('/marketplace/')) return 'Marketplace';
  if (path.startsWith('/mage-id-bids/')) return 'MAGE ID Bids';
  if (path.startsWith('/construction-ai/')) return 'Construction AI';
  // Detail routes like /invoice/123 — return the parent label.
  const top = path.split('/')[1];
  const topRoute = '/' + top;
  if (exact[topRoute]) return exact[topRoute];
  return null;
}
