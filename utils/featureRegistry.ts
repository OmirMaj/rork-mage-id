// ============================================================================
// utils/featureRegistry.ts
//
// The app's feature index — every user-facing destination a person might
// hunt for, with the trade-talk synonyms they'd actually type ("gantt",
// "g702", "osha", "quickbooks", "leak"). Pure module: no React, no React
// Native, no context imports — scripts/validate-feature-search.ts runs it
// under bun.
//
// Sources of truth this mirrors (keep in sync when nav changes):
//   * components/DesktopSidebar.tsx NAV_ITEMS (labels, routes, `requires`)
//   * app/(tabs)/discover/tools.tsx (the All Tools grid)
//   * app/(tabs)/_layout.tsx (tab destinations)
// The validator cross-checks every sidebar route against this registry and
// every registry route against a real file under app/, so drift fails
// ship-check instead of silently rotting.
//
// Inclusion rule: a destination must stand on its own when pushed with no
// params. Screens that dead-end without a projectId (weekly-snapshot,
// safety-jha, margin-risk, schedule-builder, activity-feed…) are reachable
// from inside a project and are deliberately NOT listed here.
// ============================================================================

import { REQUIRED_TIER, tierMeetsRequirement } from '@/utils/featureTiers';
import type { FeatureKey } from '@/utils/featureTiers';
import type { SubscriptionTier } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Icon key — resolved to a bespoke Mage icon or a lucide icon by the UI.
 *  components/UniversalSearch.tsx holds the exhaustive Record<FeatureIcon, …>
 *  map, so a typo here or a missing map entry there is a compile error. */
export type FeatureIcon =
  // Bespoke Mage icon system (components/icons)
  | 'MageSummary' | 'MageProject' | 'MageAIMark' | 'MageEstimate'
  | 'MageSchedule' | 'MageRFI' | 'MageSubmittal' | 'MagePayApp'
  | 'MageChangeOrder' | 'MageTakeoff' | 'MagePunch' | 'MageMargin'
  | 'MagePlans' | 'MageCostDb' | 'MageEquipment' | 'MageDailyReport'
  | 'MageInvoice' | 'MageContract'
  // Lucide
  | 'Briefcase' | 'Newspaper' | 'CalendarCheck' | 'BellRing' | 'ScanEye'
  | 'Mic' | 'Gavel' | 'ScrollText' | 'MapPin' | 'Store' | 'Scale' | 'Layers'
  | 'BarChart3' | 'Target' | 'Zap' | 'FileSignature' | 'UserPlus' | 'Users'
  | 'IdCard' | 'HardHat' | 'Building2' | 'Award' | 'ClipboardList'
  | 'ShieldCheck' | 'Handshake' | 'FileSearch' | 'Camera' | 'FileDiff'
  | 'BookOpen' | 'ScanLine' | 'Upload' | 'ListChecks' | 'FileText' | 'Clock'
  | 'PenTool' | 'Stamp' | 'Presentation' | 'Package' | 'PieChart'
  | 'TrendingUp' | 'Coins' | 'LineChart' | 'Wallet' | 'CalendarClock'
  | 'Banknote' | 'Receipt' | 'Droplets' | 'SlidersHorizontal' | 'Plug'
  | 'KeyRound' | 'Shield' | 'Bell' | 'Inbox' | 'Download' | 'Settings'
  | 'CreditCard' | 'BadgeCheck' | 'AlertTriangle' | 'Brain';

/** Display group — mirrors the sidebar's information architecture. */
export type FeatureGroup =
  | 'workspace' | 'find-work' | 'network' | 'ai'
  | 'project' | 'field' | 'money' | 'client' | 'account';

export const GROUP_LABELS: Record<FeatureGroup, string> = {
  workspace: 'Workspace',
  'find-work': 'Find Work',
  network: 'Network',
  ai: 'AI Tools',
  project: 'Project',
  field: 'Field',
  money: 'Money',
  client: 'Client',
  account: 'Account',
};

/** Which persona sees the entry. Property owners (client / property_manager
 *  personas) get the minimal app — contractor tools are noise AND mostly
 *  unauthorized for them server-side. Default: 'contractor'. */
export type FeaturePersona = 'contractor' | 'client' | 'all';

export interface FeatureEntry {
  id: string;
  title: string;
  /** Lowercase trade-talk aliases. Matched at lower rank than the title. */
  synonyms: readonly string[];
  route: string;
  /** Tier gate — mirrors the sidebar's `requires`. Locked entries still
   *  surface in results (with a lock hint); the destination renders its own
   *  paywall, keeping the upgrade one tap away. */
  requires?: FeatureKey;
  icon: FeatureIcon;
  group: FeatureGroup;
  persona?: FeaturePersona;
}

export interface FeatureHit {
  entry: FeatureEntry;
  /** True when the user's tier does not unlock `entry.requires`. */
  locked: boolean;
  /** Minimum tier that unlocks the entry ('free' when ungated). */
  requiredTier: 'free' | 'pro' | 'business';
  score: number;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
// Order matters: it is the tie-break when scores are equal, so put the
// highest-traffic destination of each group first.

export const FEATURE_REGISTRY: readonly FeatureEntry[] = [
  // ── Workspace ─────────────────────────────────────────────────────────
  { id: 'projects', title: 'Projects', synonyms: ['jobs', 'home', 'job list', 'my projects'], route: '/(tabs)/(home)', icon: 'MageProject', group: 'workspace', persona: 'all' },
  { id: 'summary', title: 'Summary', synonyms: ['dashboard', 'overview', 'today'], route: '/(tabs)/summary', icon: 'MageSummary', group: 'workspace' },
  { id: 'ask-mage', title: 'Ask MAGE', synonyms: ['chat', 'assistant', 'ai', 'question', 'help'], route: '/ask', icon: 'MageAIMark', group: 'workspace' },
  { id: 'copilot-hub', title: 'MAGE Copilot', synonyms: ['voice', 'dictate', 'hands free', 'talk'], route: '/copilot-hub', icon: 'Mic', group: 'workspace' },
  { id: 'brief', title: 'Morning Brief', synonyms: ['briefing', 'digest', 'daily brief'], route: '/brief', icon: 'Newspaper', group: 'workspace' },
  { id: 'week-close', title: 'Week Close', synonyms: ['friday', 'friday close', 'weekly review', 'wrap up'], route: '/week-close', icon: 'CalendarCheck', group: 'workspace' },
  { id: 'business', title: 'Your Business', synonyms: ['brain', 'company health', 'accuracy', 'predictions'], route: '/business', requires: 'brain_accuracy', icon: 'Briefcase', group: 'workspace' },
  { id: 'track-record', title: 'Track Record', synonyms: ['brain accuracy', 'scoreboard', 'receipts', 'hit rate', 'how accurate', 'predicted vs actual'], route: '/track-record', requires: 'brain_accuracy', icon: 'Target', group: 'workspace' },
  { id: 'margin-board', title: 'Margin Board', synonyms: ['margins', 'portfolio', 'profit board'], route: '/portfolio-margin', requires: 'job_costing', icon: 'MageMargin', group: 'workspace' },
  { id: 'margin-alerts', title: 'Margin Alerts', synonyms: ['leak', 'profit alerts', 'slipping'], route: '/margin-alerts', requires: 'job_costing', icon: 'BellRing', group: 'workspace' },
  { id: 'cost-database', title: 'Cost Database', synonyms: ['unit costs', 'price book', 'learned costs', 'rates'], route: '/cost-database', requires: 'job_costing', icon: 'MageCostDb', group: 'workspace' },
  { id: 'cost-xray', title: 'Cost X-Ray', synonyms: ['xray', 'x-ray', 'hidden conditions', 'camera pricing'], route: '/cost-xray', requires: 'cost_xray', icon: 'ScanEye', group: 'workspace' },
  { id: 'project-memory', title: 'Project Memory', synonyms: ['memory', 'decisions', 'what happened'], route: '/project-memory', icon: 'Brain', group: 'workspace' },

  // ── Find work ─────────────────────────────────────────────────────────
  { id: 'mage-id-bids', title: 'MAGE ID Bids', synonyms: ['rfp', 'invitations', 'bid invites', 'awarded'], route: '/(tabs)/mage-id-bids', icon: 'Gavel', group: 'find-work' },
  { id: 'public-bids', title: 'Public Bids', synonyms: ['bid board', 'open bids', 'plan room'], route: '/(tabs)/discover/bids', icon: 'ScrollText', group: 'find-work' },
  { id: 'nearby-rfps', title: 'Nearby RFPs', synonyms: ['find work', 'near me', 'local jobs'], route: '/nearby-rfps', icon: 'MapPin', group: 'find-work' },
  { id: 'judges', title: 'Bid Advisor', synonyms: ['bid', 'judges', 'bid scoring', 'should i bid', 'go no go'], route: '/judges', requires: 'bid_scoring', icon: 'Scale', group: 'find-work' },
  { id: 'bid-leveling', title: 'Bid Leveling', synonyms: ['bid', 'level bids', 'compare bids', 'scope gaps', 'apples to apples'], route: '/bid-leveling', icon: 'Layers', group: 'find-work' },
  { id: 'post-bid', title: 'Post-Bid Analysis', synonyms: ['bid', 'win loss', 'debrief', 'why lost'], route: '/post-bid', icon: 'BarChart3', group: 'find-work' },
  { id: 'win-optimizer', title: 'Win Optimizer', synonyms: ['bid price', 'win rate', 'markup', 'pricing strategy'], route: '/win-optimizer', icon: 'Target', group: 'find-work' },
  { id: 'auto-bids', title: 'Pre-priced Bids', synonyms: ['mage bids for you', 'auto bid', 'priced bids', 'bids ready', 'autonomous bidding'], route: '/auto-bids', requires: 'bid_scoring', icon: 'Zap', group: 'find-work' },
  { id: 'quick-quote', title: 'Quick Quote', synonyms: ['quote', 'fast estimate', 'ballpark'], route: '/quick-quote', icon: 'Zap', group: 'find-work' },
  { id: 'smart-proposal', title: 'Smart Proposal', synonyms: ['proposal', 'good better best', 'pitch'], route: '/smart-proposal', requires: 'job_costing', icon: 'FileSignature', group: 'find-work' },
  { id: 'leads', title: 'Leads', synonyms: ['crm', 'pipeline', 'prospects', 'inquiries'], route: '/leads', icon: 'UserPlus', group: 'find-work' },
  { id: 'marketplace', title: 'Suppliers', synonyms: ['vendors', 'marketplace', 'yards'], route: '/(tabs)/marketplace', icon: 'Store', group: 'find-work' },

  // ── Network ───────────────────────────────────────────────────────────
  { id: 'contacts', title: 'Contacts', synonyms: ['address book', 'directory', 'people', 'architects'], route: '/contacts', icon: 'Users', group: 'network' },
  { id: 'crew', title: 'Crew', synonyms: ['workers', 'team', 'employees', 'labor'], route: '/crew', requires: 'crew_management', icon: 'IdCard', group: 'network' },
  { id: 'subs', title: 'Subs', synonyms: ['subcontractors', 'trade partners', 'trades'], route: '/(tabs)/subs', icon: 'HardHat', group: 'network' },
  { id: 'companies', title: 'Companies', synonyms: ['firms', 'gc directory'], route: '/(tabs)/discover/companies', icon: 'Building2', group: 'network' },
  { id: 'sub-scorecard', title: 'Sub Scorecard', synonyms: ['sub grades', 'ratings', 'who is good'], route: '/sub-scorecard', icon: 'Award', group: 'network' },
  { id: 'prequal-manager', title: 'Prequalification', synonyms: ['prequal', 'qualify subs', 'packets'], route: '/prequal-manager', requires: 'prequal_coi', icon: 'ClipboardList', group: 'network' },
  { id: 'coi-vault', title: 'COI Vault', synonyms: ['insurance', 'certificates', 'coi', 'expirations'], route: '/coi-vault', requires: 'prequal_coi', icon: 'ShieldCheck', group: 'network' },
  { id: 'sub-portals', title: 'Sub Portals', synonyms: ['subcontractor portal', 'sub links'], route: '/sub-portals', icon: 'Handshake', group: 'network' },

  // ── AI tools ──────────────────────────────────────────────────────────
  { id: 'construction-ai', title: 'Construction AI', synonyms: ['code check', 'building code', 'permit roadmap', 'plan review', 'ada', 'zoning', 'egress'], route: '/(tabs)/construction-ai', icon: 'MageAIMark', group: 'ai' },
  { id: 'takeoff', title: 'AI Takeoff', synonyms: ['quantity takeoff', 'pdf takeoff', 'count', 'linear'], route: '/takeoff', icon: 'MageTakeoff', group: 'ai' },
  { id: 'area-takeoff', title: 'Visual Takeoff', synonyms: ['floor plan takeoff', 'measure', 'square feet', 'sqft'], route: '/area-takeoff', requires: 'job_costing', icon: 'MageTakeoff', group: 'ai' },
  { id: 'plan-intelligence', title: 'Plan Intelligence', synonyms: ['ask your plans', 'plan search', 'find on plans'], route: '/plan-intelligence', requires: 'ask_your_plans', icon: 'FileSearch', group: 'ai' },
  { id: 'ai-punch', title: 'AI Punch from Photos', synonyms: ['photo punch', 'walk the site', 'auto punch'], route: '/ai-punch', icon: 'Camera', group: 'ai' },
  { id: 'compare-drawings', title: 'Compare Drawings', synonyms: ['diff', 'revisions', 'what changed', 'delta'], route: '/compare-drawings', icon: 'FileDiff', group: 'ai' },
  { id: 'extract-submittals', title: 'Spec Book Extract', synonyms: ['spec book', 'submittal log', 'divisions'], route: '/extract-submittals', icon: 'BookOpen', group: 'ai' },
  { id: 'scan', title: 'Scan Anything', synonyms: ['ocr', 'receipt', 'business card', 'document scan', 'snap'], route: '/scan', requires: 'scan_anything', icon: 'ScanLine', group: 'ai' },
  { id: 'estimate-wizard', title: 'AI Estimate Wizard', synonyms: ['generate estimate', 'estimate builder'], route: '/estimate-wizard', requires: 'ai_estimate_wizard', icon: 'MageEstimate', group: 'ai' },
  { id: 'schedule-import', title: 'Schedule Import', synonyms: ['import schedule', 'ms project import', 'xlsx', 'excel'], route: '/schedule-import', requires: 'schedule_import', icon: 'Upload', group: 'ai' },

  // ── Project ───────────────────────────────────────────────────────────
  { id: 'estimate', title: 'Estimates', synonyms: ['pricing', 'line items', 'quote'], route: '/(tabs)/discover/estimate', icon: 'MageEstimate', group: 'project' },
  { id: 'schedule', title: 'Schedule', synonyms: ['timeline', 'calendar', 'phases', 'sequence'], route: '/(tabs)/discover/schedule', requires: 'schedule_gantt_pdf', icon: 'MageSchedule', group: 'project' },
  { id: 'schedule-pro', title: 'Pro Scheduler', synonyms: ['gantt', 'cpm', 'critical path', 'ms project', 'dependencies', 'float'], route: '/schedule-pro', requires: 'schedule_gantt_pdf', icon: 'MageSchedule', group: 'project' },
  { id: 'last-planner', title: 'Last Planner', synonyms: ['lookahead', 'ppc', 'pull planning', 'weekly commitments'], route: '/last-planner', requires: 'schedule_gantt_pdf', icon: 'ListChecks', group: 'project' },
  { id: 'plans', title: 'Plans & Drawings', synonyms: ['blueprints', 'sheets', 'drawings', 'markup'], route: '/plans', icon: 'MagePlans', group: 'project' },
  { id: 'documents', title: 'Documents', synonyms: ['files', 'docs', 'folders', 'attachments'], route: '/documents', icon: 'FileText', group: 'project' },
  { id: 'estimate-calibration', title: 'Estimate Calibration', synonyms: ['bid accuracy', 'high or low', 'calibrate'], route: '/estimate-calibration', icon: 'SlidersHorizontal', group: 'project' },

  // ── Field ─────────────────────────────────────────────────────────────
  { id: 'daily-report', title: 'Daily Reports', synonyms: ['dfr', 'field report', 'site diary', 'daily log'], route: '/daily-report', icon: 'MageDailyReport', group: 'field' },
  { id: 'photo-triage', title: 'Photo Triage', synonyms: ['photos', 'pictures', 'jobsite photos', 'camera roll'], route: '/photo-triage', requires: 'photo_documentation', icon: 'Camera', group: 'field' },
  { id: 'punch-list', title: 'Punch List', synonyms: ['punchlist', 'snags', 'closeout items', 'walkthrough'], route: '/punch-list', requires: 'punch_list_closeout', icon: 'MagePunch', group: 'field' },
  { id: 'rfi', title: 'RFIs', synonyms: ['request for information', 'questions to architect'], route: '/rfi', requires: 'rfis_submittals', icon: 'MageRFI', group: 'field' },
  { id: 'submittal', title: 'Submittals', synonyms: ['shop drawings', 'product data', 'approvals'], route: '/submittal', requires: 'rfis_submittals', icon: 'MageSubmittal', group: 'field' },
  { id: 'safety', title: 'Safety', synonyms: ['jha', 'toolbox talk', 'incidents', 'inspections', 'hazards'], route: '/safety', requires: 'safety_management', icon: 'HardHat', group: 'field' },
  { id: 'safety-osha', title: 'OSHA Logs', synonyms: ['osha', 'osha 300', 'recordable', 'injury log'], route: '/safety-osha', requires: 'safety_management', icon: 'AlertTriangle', group: 'field' },
  { id: 'safety-certifications', title: 'Safety Certifications', synonyms: ['certs', 'osha 30', 'training', 'cards'], route: '/safety-certifications', requires: 'safety_management', icon: 'BadgeCheck', group: 'field' },
  { id: 'time-tracking', title: 'Time Tracking', synonyms: ['timesheet', 'hours', 'clock in', 'payroll'], route: '/time-tracking', requires: 'subcontractor_management', icon: 'Clock', group: 'field' },
  { id: 'oac-meeting', title: 'OAC Meetings', synonyms: ['meeting minutes', 'owner architect', 'action items'], route: '/oac-meeting', icon: 'Presentation', group: 'field' },
  { id: 'equipment', title: 'Equipment', synonyms: ['machines', 'rentals', 'iron'], route: '/(tabs)/equipment', requires: 'equipment_rental', icon: 'MageEquipment', group: 'field' },
  { id: 'materials', title: 'Materials', synonyms: ['material prices', 'lumber', 'supplies'], route: '/(tabs)/materials', icon: 'Package', group: 'field' },
  { id: 'selections', title: 'Selections', synonyms: ['finishes', 'fixtures', 'allowances', 'picks'], route: '/selections', icon: 'PenTool', group: 'field' },
  { id: 'permits', title: 'Permits', synonyms: ['permit tracker', 'inspections', 'filings'], route: '/permits', icon: 'Stamp', group: 'field' },

  // ── Money ─────────────────────────────────────────────────────────────
  { id: 'invoice', title: 'Invoices', synonyms: ['billing', 'bill', 'money', 'get paid'], route: '/invoice', icon: 'MageInvoice', group: 'money' },
  { id: 'change-order', title: 'Change Orders', synonyms: ['co', 'extras', 'scope change', 'upcharge'], route: '/change-order', requires: 'change_orders_invoicing', icon: 'MageChangeOrder', group: 'money' },
  { id: 'aia-pay-app', title: 'AIA Pay Apps', synonyms: ['g702', 'g703', 'requisition', 'pay application', 'draw'], route: '/aia-pay-app', requires: 'aia_pay_app', icon: 'MagePayApp', group: 'money' },
  { id: 'job-costing', title: 'Job Costing', synonyms: ['money', 'costs', 'cost codes', 'actuals', 'spend'], route: '/job-costing', requires: 'job_costing', icon: 'Coins', group: 'money' },
  { id: 'budget-dashboard', title: 'Budget Dashboard', synonyms: ['money', 'evm', 'cpi', 'earned value', 'burn'], route: '/budget-dashboard', requires: 'full_budget_dashboard', icon: 'PieChart', group: 'money' },
  { id: 'cash-flow', title: 'Cash Flow', synonyms: ['money', 'forecast', 'cashflow', 'runway'], route: '/cash-flow', requires: 'cash_flow_forecaster', icon: 'LineChart', group: 'money' },
  { id: 'wip-report', title: 'WIP Report', synonyms: ['work in progress', 'over under billing', 'overbilled'], route: '/wip-report', requires: 'wip_reporting', icon: 'TrendingUp', group: 'money' },
  { id: 'payments', title: 'Payments', synonyms: ['money', 'stripe', 'client payments', 'paid'], route: '/payments', icon: 'Wallet', group: 'money' },
  { id: 'payment-predictions', title: 'Payment Predictions', synonyms: ['late payers', 'when will i get paid'], route: '/payment-predictions', icon: 'CalendarClock', group: 'money' },
  { id: 'retention', title: 'Retention', synonyms: ['retainage', 'holdback', 'held back'], route: '/retention', icon: 'Banknote', group: 'money' },
  { id: 'lien-waivers', title: 'Lien Waivers', synonyms: ['lien', 'waiver', 'conditional', 'unconditional'], route: '/lien-waivers', requires: 'lien_waiver_manager', icon: 'ScrollText', group: 'money' },
  { id: 'profit-leaks', title: 'Profit Leaks', synonyms: ['leak', 'lost money', 'unbilled', 'slippage'], route: '/profit-leak-history', icon: 'Droplets', group: 'money' },
  { id: 'tax-1099', title: '1099 Export', synonyms: ['1099', 'taxes', 'cpa', 'year end'], route: '/tax-1099-export', icon: 'Receipt', group: 'money' },
  { id: 'buyout', title: 'Buyout', synonyms: ['sub packages', 'award', 'procurement', 'purchase'], route: '/buyout', icon: 'Handshake', group: 'money' },
  { id: 'reports', title: 'Reports', synonyms: ['all records', 'exports', 'filterable list'], route: '/reports', icon: 'BarChart3', group: 'money' },
  { id: 'integrations', title: 'QuickBooks & Integrations', synonyms: ['quickbooks', 'qbo', 'accounting', 'bookkeeping', 'sync'], route: '/integrations', icon: 'Plug', group: 'money' },

  // ── Client ────────────────────────────────────────────────────────────
  { id: 'client-portal', title: 'Client Portal', synonyms: ['owner portal', 'share with client', 'homeowner view'], route: '/client-portal-setup', requires: 'client_portal', icon: 'Briefcase', group: 'client' },
  { id: 'contract', title: 'Contracts', synonyms: ['agreements', 'sign', 'terms'], route: '/contract', icon: 'MageContract', group: 'client' },
  { id: 'closeout-binder', title: 'Closeout Binder', synonyms: ['o&m', 'as builts', 'turnover package', 'manuals'], route: '/closeout-binder', icon: 'ShieldCheck', group: 'client' },
  { id: 'handover', title: 'Handover', synonyms: ['walkthrough', 'keys', 'turnover', 'signature'], route: '/handover', icon: 'KeyRound', group: 'client' },
  { id: 'warranties', title: 'Warranties', synonyms: ['warranty', 'callbacks', 'claims'], route: '/warranties', icon: 'Shield', group: 'client' },

  // ── Account ───────────────────────────────────────────────────────────
  { id: 'notifications', title: 'Notifications', synonyms: ['alerts', 'bell', 'unread'], route: '/notifications-inbox', icon: 'Bell', group: 'account', persona: 'all' },
  { id: 'notification-settings', title: 'Notification Settings', synonyms: ['push', 'mute', 'quiet hours'], route: '/notifications-settings', icon: 'BellRing', group: 'account', persona: 'all' },
  { id: 'report-inbox', title: 'Report Inbox', synonyms: ['incoming reports', 'shared with me'], route: '/report-inbox', icon: 'Inbox', group: 'account' },
  { id: 'company-profile', title: 'Company Profile', synonyms: ['my company', 'logo', 'branding', 'license'], route: '/company-profile', icon: 'Building2', group: 'account' },
  { id: 'get-verified', title: 'Get Verified', synonyms: ['verification', 'badge', 'trust'], route: '/get-verified', icon: 'BadgeCheck', group: 'account' },
  { id: 'data-export', title: 'Data Export', synonyms: ['backup', 'csv', 'export everything'], route: '/data-export', icon: 'Download', group: 'account' },
  { id: 'data-import', title: 'Data Import', synonyms: ['import', 'migrate', 'bring data'], route: '/data-import', icon: 'Upload', group: 'account' },
  { id: 'upgrade', title: 'Upgrade Plan', synonyms: ['subscription', 'pricing', 'pro', 'billing plan', 'paywall'], route: '/paywall', icon: 'CreditCard', group: 'account', persona: 'all' },
  { id: 'settings', title: 'Settings', synonyms: ['preferences', 'account', 'profile', 'theme', 'dark mode'], route: '/(tabs)/settings', icon: 'Settings', group: 'account', persona: 'all' },

  // ── Property-owner persona ────────────────────────────────────────────
  { id: 'my-rfps', title: 'My Projects', synonyms: ['my rfps', 'my renovations', 'posted projects'], route: '/my-rfps', icon: 'Briefcase', group: 'workspace', persona: 'client' },
  { id: 'post-rfp', title: 'Post a Project', synonyms: ['post rfp', 'new renovation', 'get bids'], route: '/post-rfp', icon: 'FileText', group: 'workspace', persona: 'client' },
] as const;

/** Curated shortlist for the modal's empty state — the highest-traffic
 *  destinations a new user is most likely hunting for. */
export const POPULAR_FEATURE_IDS: readonly string[] = [
  'ask-mage', 'schedule', 'estimate', 'daily-report', 'invoice', 'cost-xray',
];

/** Property-owner counterpart of POPULAR_FEATURE_IDS. */
export const POPULAR_CLIENT_FEATURE_IDS: readonly string[] = [
  'my-rfps', 'post-rfp', 'notifications', 'settings',
];

export function getFeature(id: string): FeatureEntry | undefined {
  return FEATURE_REGISTRY.find(e => e.id === id);
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------
// Plain token matching, same philosophy as useUniversalSearch: no fuse.js,
// no levenshtein — the registry is ~80 rows and synonyms carry the slack.
//
// Per query token, an entry's best match rank:
//   5  title starts with the token            ("sched" → Schedule)
//   4  a synonym IS the token                 ("photos" → Photo Triage)
//   3  a word of the title starts with it     ("advisor" → Bid Advisor)
//   2  a synonym (or synonym word) starts with it  ("gantt" → Pro Scheduler)
//   1  title or synonym contains it           ("book" → QuickBooks…)
//   0  no match → the entry is out (every token must land somewhere)
// Entry score = sum over tokens; ties break on shorter title (the more
// general destination — Schedule over Schedule Import), then registry order.

const RANK_TITLE_PREFIX = 5;
const RANK_SYNONYM_EXACT = 4;
const RANK_TITLE_WORD = 3;
const RANK_SYNONYM = 2;
const RANK_CONTAINS = 1;

const DEFAULT_MAX_RESULTS = 8;

function tokenRank(entry: FeatureEntry, token: string): number {
  const title = entry.title.toLowerCase();
  if (title.startsWith(token)) return RANK_TITLE_PREFIX;
  if (entry.synonyms.some(s => s === token)) return RANK_SYNONYM_EXACT;
  const words = title.split(/[\s/&-]+/);
  if (words.some(w => w.startsWith(token))) return RANK_TITLE_WORD;
  for (const syn of entry.synonyms) {
    if (syn.startsWith(token) || syn.split(/[\s-]+/).some(w => w.startsWith(token))) {
      return RANK_SYNONYM;
    }
  }
  if (title.includes(token)) return RANK_CONTAINS;
  if (entry.synonyms.some(s => s.includes(token))) return RANK_CONTAINS;
  return 0;
}

export interface SearchFeaturesOptions {
  persona?: 'contractor' | 'client';
  maxResults?: number;
}

export function searchFeatures(
  query: string,
  tier: SubscriptionTier,
  opts?: SearchFeaturesOptions,
): FeatureHit[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return [];

  const persona = opts?.persona ?? 'contractor';
  const maxResults = opts?.maxResults ?? DEFAULT_MAX_RESULTS;

  const hits: FeatureHit[] = [];
  for (const entry of FEATURE_REGISTRY) {
    const entryPersona = entry.persona ?? 'contractor';
    if (entryPersona !== 'all' && entryPersona !== persona) continue;

    let score = 0;
    let matched = true;
    for (const token of tokens) {
      const rank = tokenRank(entry, token);
      if (rank === 0) { matched = false; break; }
      score += rank;
    }
    if (!matched) continue;

    const requiredTier = entry.requires ? REQUIRED_TIER[entry.requires] : 'free';
    hits.push({
      entry,
      requiredTier,
      locked: !tierMeetsRequirement(tier, requiredTier),
      score,
    });
  }

  // Stable sort: score desc, then shorter title (the more general
  // destination), then registry order (preserved by sort stability).
  hits.sort((a, b) =>
    b.score - a.score || a.entry.title.length - b.entry.title.length,
  );
  return hits.slice(0, maxResults);
}
