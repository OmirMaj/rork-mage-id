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
    '/summary': 'Summary',
    '/shared-plan': 'Floor plan',
    '/login': 'Sign in',
    '/signup': 'Create account',
    '/onboarding': 'Welcome',
    '/persona-select': 'Welcome',
    '/onboarding-paywall': 'Subscribe',
    '/paywall': 'Subscribe',
    '/reset-password': 'Reset password',
    '/settings': 'Settings',
    '/settings/appearance': 'Appearance',
    '/notifications-inbox': 'Notifications',
    '/messages': 'Messages',
    '/report-inbox': 'Report inbox',
    '/profit-leak-history': 'Profit Leak History',
    '/activity-feed': 'Activity',
    '/payments': 'Payments',
    '/payments-setup': 'Stripe Connect',
    '/plans': 'Plans',
    '/reports': 'Reports',
    '/invoice': 'Invoice',
    '/aia-pay-app': 'AIA pay application',
    '/change-order': 'Change order',
    '/budget-dashboard': 'Budget dashboard',
    '/cash-flow': 'Cash flow',
    '/job-costing': 'Job costing',
    '/living-estimate': 'Living estimate',
    '/generative-setup': 'Set up project',
    '/margin-risk': 'Margin risk',
    '/sub-scorecard': 'Sub scorecard',
    '/buyout-scope-gap': 'Scope-gap audit',
    '/estimate-accuracy': 'Estimate accuracy',
    '/estimate-confidence': 'Estimate confidence',
    '/estimate-calibration': 'Estimate calibration',
    '/cost-database': 'Cost database',
    '/area-takeoff': 'Visual takeoff',
    '/project-memory': 'Project memory',
    '/portfolio-margin': 'Margin board',
    '/margin-alerts': 'Margin alerts',
    '/contract': 'Contract',
    '/selections': 'Selections',
    '/closeout-binder': 'Closeout binder',
    '/punch-list': 'Punch list',
    '/punch-walk': 'Punch walk',
    '/ai-punch': 'AI punch',
    '/rfi': 'RFI',
    '/submittal': 'Submittal',
    '/oac-meeting': 'OAC meeting',
    '/daily-report': 'Daily report',
    '/delay-events': 'Delay register',
    '/time-tracking': 'Time tracking',
    '/photo-triage': 'Photo triage',
    '/leads': 'Pipeline',
    '/contacts': 'Contacts',
    '/crew': 'Crew',
    '/buyout': 'Buyout',
    '/buyout-package': 'Bid package',
    '/bid-leveling': 'Bid leveling',
    '/win-optimizer': 'Win optimizer',
    '/smart-proposal': 'Smart proposal',
    '/material-receipt': 'Material receipt',
    '/last-planner': 'Last Planner',
    '/plan-intelligence': 'Plan intelligence',
    '/bill-from-estimate': 'Bill from estimate',
    '/client-messages': 'Client messages',
    '/client-portal-setup': 'Client portal',
    '/client-view': 'Client view',
    '/client-update': 'Client update',
    '/permits': 'Permits',
    '/warranties': 'Warranties',
    '/lien-waivers': 'Lien waivers',
    '/coi-vault': 'COI vault',
    '/prequal-manager': 'Prequal manager',
    '/prequal-form': 'Prequal form',
    '/claim-crew': 'Claim profile',
    '/sub-portals': 'Sub portals',
    '/sub-portal-setup': 'Sub portal',
    '/public-profile-setup': 'Public profile',
    '/integrations': 'Integrations',
    '/handover': 'Handover',
    '/weekly-snapshot': 'Weekly snapshot',
    '/schedule-pro': 'Schedule',
    '/schedule-review': 'Review schedule',
    '/schedule-wizard': 'Schedule wizard',
    '/schedule-builder': 'AI Schedule Builder',
    '/shared-schedule': 'Schedule',
    '/estimate-wizard': 'Estimate',
    '/bid-detail': 'Bid',
    '/submit-bid-response': 'Submit bid',
    '/post-bid': 'Post bid',
    '/post-homeowner-request': 'Post project',
    '/post-community-bid': 'Post bid',

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
    '/estimate/review': 'Estimate review',
  };
  if (exact[path]) return exact[path];
  // Common nested patterns.
  if (path.startsWith('/discover/')) {
    const seg = path.replace('/discover/', '');
    return seg.charAt(0).toUpperCase() + seg.slice(1);
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
