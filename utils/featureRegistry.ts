// ============================================================================
// utils/featureRegistry.ts
//
// The app's feature index — every user-facing destination a person might
// hunt for, with the trade-talk synonyms they'd actually type ("gantt",
// "g702", "osha", "quickbooks", "leak"). Pure module: no React, no React
// Native, no context imports — scripts/validate-feature-search.ts runs it
// under bun.
//
// THIS FILE IS THE SOURCE. It used to say it "mirrors" the nav surfaces, and
// the 2026-09-07 audit found what that produced: FIVE parallel hand-written
// catalogs (DesktopSidebar 72 rows, discover/tools.tsx 54, CreateMenu 30,
// summary/ToolsSheet 11, and this registry), each internally consistent and
// none agreeing. The two routes that were added to only one of them
// (/smart-proposal, /post-bid) are exactly the two that ended up
// click-unreachable on desktop, and two `requires` keys had drifted into
// advertising a tier the destination does not enforce.
//
// So the direction is reversed. Every rendered nav surface now declares
// `feature: FeatureId` per row and reads its TIER GATE from here:
//   * components/DesktopSidebar.tsx   NAV_ITEMS / CLIENT_NAV_ITEMS
//   * app/(tabs)/discover/tools.tsx   TOOL_ROWS (the All Tools grid)
//   * components/summary/ToolsSheet   SHEET_ROWS
//   * components/CreateMenu.tsx       OPTIONS (the "+ New…" sheet)
// `FeatureId` is a union derived from the rows below, so a typo in a surface
// is a tsc error rather than a row that quietly vanishes.
//
// WHY EACH SURFACE STILL WRITES ITS ROUTE STRING. It looks like duplication
// and it is deliberate: scripts/validate-feature-search.ts:68 greps
// `route:\s*'...'` out of DesktopSidebar to prove sidebar↔registry parity, and
// its iOS-reachability pass (:97-127) greps route literals out of
// app/(tabs)/**, components/summary/** and CreateMenu to prove every desktop
// destination is also reachable on a phone. Delete the literals and both
// checks go blind and pass. So the literals stay and
// scripts/validate-nav-coverage.ts asserts every one of them EQUALS the route
// on its `feature` — the surfaces cannot disagree with this file, and the
// older guard keeps working. (Fold that grep into the registry and the
// literals can go.)
//
// THE GATE RUNS BOTH WAYS, AND THE SECOND WAY WAS OPEN UNTIL 2026-09-11.
// Three rows had drifted into advertising a tier their destination does not
// enforce (margin-board, coi-vault, plan-intelligence — each annotated below),
// and scripts/validate-feature-registry-gates.ts closed that direction. The
// other direction stayed open on SIXTEEN rows, and it is the one that costs a
// sale: the row carried NO `requires` at all while its screen opens with
// `if (!canAccess(<key>)) return <Paywall …>`. ⌘K and the Tools grid showed no
// padlock on /invoice, /plans, /contract, /permits, /brief, /week-close,
// /construction-ai, /payment-predictions and eight more, the user tapped a row
// that looked open, and the app answered with a paywall and an upsell they had
// not asked for. All sixteen now carry the key their own screen gates on.
//
// scripts/validate-nav-coverage.ts asserts that direction now, and it counts
// only an ENTRY gate — a guard clause at the top level of the default-exported
// component whose consequent returns. That distinction is the whole check:
// app/closeout-binder.tsx checks 'client_portal' inside runPassportGeneration,
// which gates one BUTTON, and a `requires` on that row would paint a padlock
// over a screen that is free to open. A grep for canAccess() cannot tell the
// two apart; that is why the guard parses instead of grepping.
//
// Display copy — a row's label, subtitle, icon component, tone, section — is
// the surface's own. A 240pt rail says "Plans", the Tools grid says
// "Plans & drawings" and this file says "Plans & Drawings"; that is voice, not
// drift. What must never fork is the DESTINATION and the GATE.
//
// Inclusion rule: a destination must stand on its own when pushed with no
// params. Screens that dead-end without a projectId (weekly-snapshot,
// safety-jha, margin-risk, schedule-builder, activity-feed…) are reachable
// from inside a project and are deliberately NOT listed here.
//
// UX-AUDIT-2026-08-03 #3 found this rule was being VIOLATED by the registry
// itself: invoice, job-costing, daily-report, punch-list, rfi,
// client-portal-setup, closeout-binder and schedule-pro were all listed while
// still dead-ending on "No invoice open yet" / "No project selected" — copy
// that is simply false for a user who has three live jobs. The rule was right
// and the screens were wrong, so the screens were fixed rather than delisted:
// every one now renders <ToolProjectPicker> (components/ToolScreenChrome.tsx)
// when no project resolves, which also covers a STALE id from an old link.
// scripts/validate-project-scoped-screens.ts pins that at source level, so the
// next screen added here cannot quietly reintroduce the dead end.
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
  | 'CreditCard' | 'BadgeCheck' | 'AlertTriangle' | 'Brain' | 'Truck';

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
  /** True when the destination needs a project and answers "opened with no
   *  projectId" with <ToolProjectPicker> (components/ToolScreenChrome.tsx).
   *  These entries satisfy this file's stand-alone rule the hard way — the
   *  screen resolves the missing param itself — so the flag is what lets a
   *  guard tell "legitimately project-scoped" apart from "should never have
   *  been listed". scripts/validate-nav-coverage.ts requires the picker in
   *  every screen flagged here. */
  projectScoped?: boolean;
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

// `as const satisfies` rather than a plain annotation: the annotation widened
// every id to `string`, so a nav surface could name a row that does not exist
// and nothing complained until the row failed to render. Const-asserting keeps
// the literal ids for FeatureId below while `satisfies` still type-checks every
// field against FeatureEntry.
const REGISTRY = [
  // ── Workspace ─────────────────────────────────────────────────────────
  { id: 'projects', title: 'Projects', synonyms: ['jobs', 'home', 'job list', 'my projects'], route: '/(tabs)/(home)', icon: 'MageProject', group: 'workspace', persona: 'all' },
  { id: 'summary', title: 'Summary', synonyms: ['dashboard', 'overview', 'today'], route: '/(tabs)/summary', icon: 'MageSummary', group: 'workspace' },
  { id: 'ask-mage', title: 'Ask MAGE', synonyms: ['chat', 'assistant', 'ai', 'question', 'help'], route: '/ask', icon: 'MageAIMark', group: 'workspace' },
  { id: 'copilot-hub', title: 'MAGE Copilot', synonyms: ['voice', 'dictate', 'hands free', 'talk'], route: '/copilot-hub', icon: 'Mic', group: 'workspace' },
  { id: 'brief', title: 'Morning Brief', synonyms: ['briefing', 'digest', 'daily brief'], route: '/brief', requires: 'brain_accuracy', icon: 'Newspaper', group: 'workspace' },
  { id: 'week-close', title: 'Week Close', synonyms: ['friday', 'friday close', 'weekly review', 'wrap up'], route: '/week-close', requires: 'brain_accuracy', icon: 'CalendarCheck', group: 'workspace' },
  { id: 'business', title: 'Your Business', synonyms: ['brain', 'company health', 'accuracy', 'predictions'], route: '/business', requires: 'brain_accuracy', icon: 'Briefcase', group: 'workspace' },
  { id: 'widget-setup', title: 'Estimate Widget', synonyms: ['embed', 'website widget', 'instant estimate', 'snippet', 'embed code', 'my website'], route: '/widget-setup', icon: 'Zap', group: 'client' },
  { id: 'sub-profile', title: 'Your Work Profile', synonyms: ['sub profile', 'my history', 'credential', 'my jobs', 'reliability', 'referral'], route: '/sub-profile', icon: 'HardHat', group: 'network' },
  { id: 'home-passport', title: 'Home Passport', synonyms: ['warranty', 'permit', 'maintenance', 'model number', 'home record', 'handover'], route: '/home-passport', icon: 'BadgeCheck', group: 'client' },
  { id: 'waiting-on', title: 'Waiting on Others', synonyms: ['chase', 'follow up', 'overdue rfis', 'nudge', 'who owes me'], route: '/waiting-on', icon: 'Inbox', group: 'workspace' },
  { id: 'delay-events', title: 'Delay Register', synonyms: ['delay', 'delay log', 'notice', 'notice deadline', 'claim', 'time extension', 'delay claim', 'schedule impact log'], route: '/delay-events', icon: 'CalendarClock', group: 'project' },
  { id: 'track-record', title: 'Track Record', synonyms: ['brain accuracy', 'scoreboard', 'receipts', 'hit rate', 'how accurate', 'predicted vs actual'], route: '/track-record', requires: 'brain_accuracy', icon: 'Target', group: 'workspace' },
  // Portfolio-wide: no useLocalSearchParams, no projectId — stands alone.
  // `requires` mirrors the real gate at app/estimate-scorecard.tsx:51
  // (canAccess('job_costing')), NOT brain_accuracy like its neighbour.
  { id: 'estimate-scorecard', title: 'Estimate Scorecard', synonyms: ['bid accuracy', 'where i lose money', 'underbid', 'overbid', 'estimate misses', 'what did i get wrong', 'accuracy by trade'], route: '/estimate-scorecard', requires: 'job_costing', icon: 'BarChart3', group: 'workspace' },
  // `requires` mirrors the real gate at app/portfolio-margin.tsx:59
  // (canAccess('portfolio_margin') = Business), NOT job_costing (Pro) like its
  // neighbours. It said 'job_costing' until 2026-08-31: a Pro subscriber
  // searching "margin" saw NO lock chip, tapped through, and hit the Business
  // wall the chip exists to warn about — then got shown the wrong upsell.
  // DesktopSidebar.tsx:65 already had the correct key; this row had drifted.
  { id: 'margin-board', title: 'Margin Board', synonyms: ['margins', 'portfolio', 'profit board'], route: '/portfolio-margin', requires: 'portfolio_margin', icon: 'MageMargin', group: 'workspace' },
  { id: 'margin-alerts', title: 'Margin Alerts', synonyms: ['leak', 'profit alerts', 'slipping'], route: '/margin-alerts', requires: 'job_costing', icon: 'BellRing', group: 'workspace' },
  { id: 'cost-database', title: 'Cost Database', synonyms: ['unit costs', 'price book', 'learned costs', 'rates'], route: '/cost-database', requires: 'job_costing', icon: 'MageCostDb', group: 'workspace' },
  { id: 'cost-seed', title: 'Seed Your Rates', synonyms: ['import rates', 'my prices', 'set my rates', 'paste rates', 'starting rates', 'import price book', 'cold start'], route: '/cost-seed', requires: 'job_costing', icon: 'Upload', group: 'workspace' },
  { id: 'cost-xray', title: 'Cost X-Ray', synonyms: ['xray', 'x-ray', 'hidden conditions', 'camera pricing'], route: '/cost-xray', requires: 'cost_xray', icon: 'ScanEye', group: 'workspace' },
  { id: 'project-memory', title: 'Project Memory', synonyms: ['memory', 'decisions', 'what happened'], route: '/project-memory', requires: 'job_costing', icon: 'Brain', group: 'workspace' },

  // ── Find work ─────────────────────────────────────────────────────────
  { id: 'mage-id-bids', title: 'MAGE ID Bids', synonyms: ['rfp', 'invitations', 'bid invites', 'awarded'], route: '/(tabs)/mage-id-bids', icon: 'Gavel', group: 'find-work' },
  { id: 'public-bids', title: 'Public Bids', synonyms: ['bid board', 'open bids', 'plan room'], route: '/(tabs)/discover/bids', icon: 'ScrollText', group: 'find-work' },
  { id: 'nearby-rfps', title: 'Nearby RFPs', synonyms: ['find work', 'near me', 'local jobs'], route: '/nearby-rfps', icon: 'MapPin', group: 'find-work' },
  { id: 'judges', title: 'Bid Advisor', synonyms: ['bid', 'judges', 'bid scoring', 'should i bid', 'go no go'], route: '/judges', requires: 'bid_scoring', icon: 'Scale', group: 'find-work' },
  { id: 'bid-leveling', title: 'Bid Leveling', synonyms: ['bid', 'level bids', 'compare bids', 'scope gaps', 'apples to apples'], route: '/bid-leveling', requires: 'job_costing', icon: 'Layers', group: 'find-work' },
  // Titled "Post-Bid Analysis" with win/loss synonyms until 2026-09-07, which
  // was a different feature entirely: app/post-bid.tsx:186 self-titles "Post a
  // Bid" and is a publish-a-solicitation form with a monthly post quota. It
  // broke ⌘K in both directions — "post a bid" matched no title, and "why
  // lost" routed a GC into a form that publishes a public bid opportunity. No
  // screen does a win/loss debrief today; the closest real answer is
  // /estimate-accuracy ("Bid vs Actual"), so the old synonyms are dropped
  // rather than re-pointed.
  // Icon: 'ScrollText' rather than a megaphone, because FeatureIcon is a
  // CLOSED union whose exhaustive Record lives in components/UniversalSearch —
  // adding a key here without adding it there is a compile error. ScrollText
  // is Public Bids' icon and this is the same object seen from the other side
  // (post the solicitation vs. read the board), so it is a pairing rather than
  // a collision. The sidebar row uses a Megaphone; it owns its own icons.
  { id: 'post-bid', title: 'Post a Bid', synonyms: ['publish bid', 'solicitation', 'bid board', 'post opportunity', 'invite subs to bid'], route: '/post-bid', icon: 'ScrollText', group: 'find-work' },
  { id: 'win-optimizer', title: 'Win Optimizer', synonyms: ['bid price', 'win rate', 'markup', 'pricing strategy'], route: '/win-optimizer', requires: 'portfolio_margin', icon: 'Target', group: 'find-work' },
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
  { id: 'sub-scorecard', title: 'Sub Scorecard', synonyms: ['sub grades', 'ratings', 'who is good'], route: '/sub-scorecard', requires: 'job_costing', icon: 'Award', group: 'network' },
  { id: 'prequal-manager', title: 'Prequalification', synonyms: ['prequal', 'qualify subs', 'packets'], route: '/prequal-manager', requires: 'prequal_coi', icon: 'ClipboardList', group: 'network' },
  // COI Vault gates on 'rfis_submittals' (Business) at app/coi-vault.tsx:50 —
  // NOT on 'prequal_coi' (Pro) like the Prequalification row above it, despite
  // the shared feature-key name. It advertised prequal_coi until 2026-08-31, so
  // a Pro subscriber searching "coi" got no lock chip and walked into a
  // Business wall. The key here must be the one the destination checks.
  { id: 'coi-vault', title: 'COI Vault', synonyms: ['insurance', 'certificates', 'coi', 'expirations'], route: '/coi-vault', requires: 'rfis_submittals', icon: 'ShieldCheck', group: 'network' },
  { id: 'sub-portals', title: 'Sub Portals', synonyms: ['subcontractor portal', 'sub links'], route: '/sub-portals', icon: 'Handshake', group: 'network' },

  // ── AI tools ──────────────────────────────────────────────────────────
  { id: 'construction-ai', title: 'Construction AI', synonyms: ['code check', 'building code', 'permit roadmap', 'plan review', 'ada', 'zoning', 'egress'], route: '/(tabs)/construction-ai', requires: 'ai_code_check', icon: 'MageAIMark', group: 'ai' },
  { id: 'takeoff', title: 'AI Takeoff', synonyms: ['quantity takeoff', 'pdf takeoff', 'count', 'linear'], route: '/takeoff', icon: 'MageTakeoff', group: 'ai' },
  { id: 'area-takeoff', title: 'Visual Takeoff', synonyms: ['floor plan takeoff', 'measure', 'square feet', 'sqft'], route: '/area-takeoff', requires: 'job_costing', icon: 'MageTakeoff', group: 'ai' },
  // Reads 'ai_estimate_wizard' (Pro) because that is what the screen actually
  // enforces (app/plan-intelligence.tsx:61), even though the feature is named
  // after 'ask_your_plans' (Business). It advertised ask_your_plans until
  // 2026-08-31, which put a BUSINESS lock chip on a screen a Pro subscriber
  // already owns — so they never opened a feature they were paying for.
  // NOTE: components/DesktopSidebar.tsx:104 still says 'ask_your_plans' and
  // needs the same correction (that file is not owned by this change).
  { id: 'plan-intelligence', title: 'Plan Intelligence', synonyms: ['ask your plans', 'plan search', 'find on plans'], route: '/plan-intelligence', requires: 'ai_estimate_wizard', icon: 'FileSearch', group: 'ai' },
  // ai-punch, punch-list and rfi are the three chipped rows whose ENTRY GATE
  // runs through hooks/useProjectAccess — tier access OR the collaborator grant
  // for that project. All four surfaces that paint the chip (UniversalSearch,
  // DesktopSidebar, CreateMenu, discover/tools) read own-tier canAccess with no
  // project in hand, so a free-tier person invited to a Business job sees a
  // BUSINESS padlock on a screen that will in fact open for them. Dropping
  // `requires` is NOT the fix: it would restore the worse failure — an unwarned
  // wall — for everyone who is not a collaborator on that project, which is
  // almost everyone. The fix belongs in the four consumers. The set is pinned
  // by scripts/validate-feature-registry-gates.ts so a fourth row cannot join
  // it silently.
  { id: 'ai-punch', title: 'AI Punch from Photos', synonyms: ['photo punch', 'walk the site', 'auto punch'], route: '/ai-punch', requires: 'punch_list_closeout', icon: 'Camera', group: 'ai', projectScoped: true },
  { id: 'compare-drawings', title: 'Compare Drawings', synonyms: ['diff', 'revisions', 'what changed', 'delta'], route: '/compare-drawings', icon: 'FileDiff', group: 'ai', projectScoped: true },
  { id: 'extract-submittals', title: 'Spec Book Extract', synonyms: ['spec book', 'submittal log', 'divisions'], route: '/extract-submittals', icon: 'BookOpen', group: 'ai', projectScoped: true },
  { id: 'scan', title: 'Scan Anything', synonyms: ['ocr', 'receipt', 'business card', 'document scan', 'snap'], route: '/scan', requires: 'scan_anything', icon: 'ScanLine', group: 'ai' },
  // NO `requires`. app/estimate-wizard.tsx has no canAccess gate — it is a
  // metered free demo (aiRateLimiterCore.ts: aiEstimateWizard freeLifetimeCap
  // 2), exactly like /takeoff, and app/onboarding.tsx:233 REPLACES a brand-new
  // free user onto it as their first action. It carried
  // `requires: 'ai_estimate_wizard'` until 2026-09-07, which was harmless while
  // only ⌘K read it and became a live defect the moment the Create menu started
  // reading its chip from here: the "+ New… ▸ Estimate" row painted a Pro lock
  // on the one door onboarding pushes a free user through, while six other
  // entry points (home, project-detail, the Estimator CTAs, NextStepHero,
  // OnboardingChecklist) show it open. That is the "two contradictory doors"
  // failure components/CreateMenu.tsx:133 documents for Takeoff, on the app's
  // activation moment. The wall is real but it is one step LATER, on the Pro
  // features inside; the meter's own copy handles the trial limit.
  { id: 'estimate-wizard', title: 'AI Estimate Wizard', synonyms: ['generate estimate', 'estimate builder'], route: '/estimate-wizard', icon: 'MageEstimate', group: 'ai' },
  { id: 'schedule-import', title: 'Schedule Import', synonyms: ['import schedule', 'ms project import', 'xlsx', 'excel'], route: '/schedule-import', requires: 'schedule_import', icon: 'Upload', group: 'ai' },

  // ── Project ───────────────────────────────────────────────────────────
  { id: 'estimate', title: 'Estimates', synonyms: ['pricing', 'line items', 'quote'], route: '/(tabs)/discover/estimate', icon: 'MageEstimate', group: 'project' },
  // No `requires`. This route is the FREE on-ramp — a project list plus
  // ScheduleOnRamp, gating nothing. The Pro wall is one screen later, on
  // `schedule-pro` and `last-planner`, which carry the chip. Advertising a
  // lock here told a free user their schedule was paid before they ever saw
  // the free scheduler (audit 2026-09-07, NAV wave).
  { id: 'schedule', title: 'Schedule', synonyms: ['timeline', 'calendar', 'phases', 'sequence'], route: '/(tabs)/discover/schedule', icon: 'MageSchedule', group: 'project' },
  { id: 'schedule-pro', title: 'Pro Scheduler', synonyms: ['gantt', 'cpm', 'critical path', 'ms project', 'dependencies', 'float'], route: '/schedule-pro', requires: 'schedule_gantt_pdf', icon: 'MageSchedule', group: 'project', projectScoped: true },
  { id: 'last-planner', title: 'Last Planner', synonyms: ['lookahead', 'ppc', 'pull planning', 'weekly commitments'], route: '/last-planner', requires: 'schedule_gantt_pdf', icon: 'ListChecks', group: 'project' },
  { id: 'plans', title: 'Plans & Drawings', synonyms: ['blueprints', 'sheets', 'drawings', 'markup'], route: '/plans', requires: 'plan_markup', icon: 'MagePlans', group: 'project' },
  { id: 'documents', title: 'Documents', synonyms: ['files', 'docs', 'folders', 'attachments'], route: '/documents', icon: 'FileText', group: 'project' },
  { id: 'estimate-calibration', title: 'Estimate Calibration', synonyms: ['bid accuracy', 'high or low', 'calibrate'], route: '/estimate-calibration', requires: 'portfolio_margin', icon: 'SlidersHorizontal', group: 'project' },

  // ── Field ─────────────────────────────────────────────────────────────
  { id: 'daily-report', title: 'Daily Reports', synonyms: ['dfr', 'field report', 'site diary', 'daily log'], route: '/daily-report', icon: 'MageDailyReport', group: 'field', projectScoped: true },
  // T&M ticket. Synonyms are what a super actually types when the owner's rep
  // is standing next to them: "t&m", "extra work", "ticket", "force account".
  { id: 'field-ticket', title: 'T&M Field Tickets', synonyms: ['t&m', 'tm ticket', 'ticket', 'extra work', 'force account', 'time and materials', 'signed ticket', 'out of scope'], route: '/field-ticket', requires: 'change_orders_invoicing', icon: 'FileSignature', group: 'field', projectScoped: true },
  { id: 'photo-triage', title: 'Photo Triage', synonyms: ['photos', 'pictures', 'jobsite photos', 'camera roll'], route: '/photo-triage', requires: 'photo_documentation', icon: 'Camera', group: 'field' },
  { id: 'punch-list', title: 'Punch List', synonyms: ['punchlist', 'snags', 'closeout items', 'walkthrough'], route: '/punch-list', requires: 'punch_list_closeout', icon: 'MagePunch', group: 'field', projectScoped: true },
  { id: 'rfi', title: 'RFIs', synonyms: ['request for information', 'questions to architect'], route: '/rfi', requires: 'rfis_submittals', icon: 'MageRFI', group: 'field', projectScoped: true },
  { id: 'submittal', title: 'Submittals', synonyms: ['shop drawings', 'product data', 'approvals'], route: '/submittal', requires: 'rfis_submittals', icon: 'MageSubmittal', group: 'field', projectScoped: true },
  { id: 'safety', title: 'Safety', synonyms: ['jha', 'toolbox talk', 'incidents', 'inspections', 'hazards'], route: '/safety', requires: 'safety_management', icon: 'HardHat', group: 'field' },
  { id: 'safety-osha', title: 'OSHA Logs', synonyms: ['osha', 'osha 300', 'recordable', 'injury log'], route: '/safety-osha', requires: 'safety_management', icon: 'AlertTriangle', group: 'field' },
  { id: 'safety-certifications', title: 'Safety Certifications', synonyms: ['certs', 'osha 30', 'training', 'cards'], route: '/safety-certifications', requires: 'safety_management', icon: 'BadgeCheck', group: 'field' },
  { id: 'time-tracking', title: 'Time Tracking', synonyms: ['timesheet', 'hours', 'clock in', 'payroll'], route: '/time-tracking', requires: 'subcontractor_management', icon: 'Clock', group: 'field' },
  { id: 'oac-meeting', title: 'OAC Meetings', synonyms: ['meeting minutes', 'owner architect', 'action items'], route: '/oac-meeting', requires: 'rfis_submittals', icon: 'Presentation', group: 'field', projectScoped: true },
  { id: 'equipment', title: 'Equipment', synonyms: ['machines', 'rentals', 'iron'], route: '/(tabs)/equipment', requires: 'equipment_rental', icon: 'MageEquipment', group: 'field' },
  { id: 'materials', title: 'Materials', synonyms: ['material prices', 'lumber', 'supplies'], route: '/(tabs)/materials', icon: 'Package', group: 'field' },
  { id: 'selections', title: 'Selections', synonyms: ['finishes', 'fixtures', 'allowances', 'picks'], route: '/selections', icon: 'PenTool', group: 'field', projectScoped: true },
  { id: 'permits', title: 'Permits', synonyms: ['permit tracker', 'inspections', 'filings'], route: '/permits', requires: 'job_costing', icon: 'Stamp', group: 'field' },
  // Both render <ToolProjectPicker> with no projectId, so they satisfy the
  // stand-alone rule in this file's header. Neither is tier-gated in code
  // (no useTierAccess in either screen), so neither carries `requires` — a
  // badge here that the screen does not enforce is the drift this registry exists to stop.
  { id: 'deliveries', title: 'Deliveries', synonyms: ['delivery', 'material delivery', 'late delivery', 'what is arriving', 'lead time', 'supplier', 'truck', 'expected on site'], route: '/deliveries', icon: 'Truck', group: 'field', projectScoped: true },
  { id: 'building-access', title: 'Building Access', synonyms: ['freight elevator', 'loading dock', 'badging', 'badges', 'after hours', 'property manager', 'building coi', 'dock reservation', 'elevator booking'], route: '/building-access', icon: 'Building2', group: 'field', projectScoped: true },

  // ── Money ─────────────────────────────────────────────────────────────
  { id: 'invoice', title: 'Invoices', synonyms: ['billing', 'bill', 'money', 'get paid'], route: '/invoice', requires: 'change_orders_invoicing', icon: 'MageInvoice', group: 'money', projectScoped: true },
  { id: 'change-order', title: 'Change Orders', synonyms: ['co', 'extras', 'scope change', 'upcharge'], route: '/change-order', requires: 'change_orders_invoicing', icon: 'MageChangeOrder', group: 'money', projectScoped: true },
  { id: 'aia-pay-app', title: 'AIA Pay Apps', synonyms: ['g702', 'g703', 'requisition', 'pay application', 'draw'], route: '/aia-pay-app', requires: 'aia_pay_app', icon: 'MagePayApp', group: 'money', projectScoped: true },
  { id: 'job-costing', title: 'Job Costing', synonyms: ['money', 'costs', 'cost codes', 'actuals', 'spend'], route: '/job-costing', requires: 'job_costing', icon: 'Coins', group: 'money', projectScoped: true },
  { id: 'budget-dashboard', title: 'Budget Dashboard', synonyms: ['money', 'evm', 'cpi', 'earned value', 'burn'], route: '/budget-dashboard', requires: 'full_budget_dashboard', icon: 'PieChart', group: 'money', projectScoped: true },
  { id: 'cash-flow', title: 'Cash Flow', synonyms: ['money', 'forecast', 'cashflow', 'runway'], route: '/cash-flow', requires: 'cash_flow_forecaster', icon: 'LineChart', group: 'money' },
  { id: 'wip-report', title: 'WIP Report', synonyms: ['work in progress', 'over under billing', 'overbilled'], route: '/wip-report', requires: 'wip_reporting', icon: 'TrendingUp', group: 'money' },
  { id: 'payments', title: 'Payments', synonyms: ['money', 'stripe', 'client payments', 'paid'], route: '/payments', icon: 'Wallet', group: 'money' },
  { id: 'payment-predictions', title: 'Payment Predictions', synonyms: ['late payers', 'when will i get paid'], route: '/payment-predictions', requires: 'cash_flow_forecaster', icon: 'CalendarClock', group: 'money' },
  { id: 'retention', title: 'Retention', synonyms: ['retainage', 'holdback', 'held back'], route: '/retention', icon: 'Banknote', group: 'money' },
  { id: 'lien-waivers', title: 'Lien Waivers', synonyms: ['lien', 'waiver', 'conditional', 'unconditional'], route: '/lien-waivers', requires: 'lien_waiver_manager', icon: 'ScrollText', group: 'money' },
  { id: 'profit-leaks', title: 'Profit Leaks', synonyms: ['leak', 'lost money', 'unbilled', 'slippage'], route: '/profit-leak-history', requires: 'brain_accuracy', icon: 'Droplets', group: 'money' },
  { id: 'tax-1099', title: '1099 Export', synonyms: ['1099', 'taxes', 'cpa', 'year end'], route: '/tax-1099-export', icon: 'Receipt', group: 'money' },
  { id: 'buyout', title: 'Buyout', synonyms: ['sub packages', 'award', 'procurement', 'purchase'], route: '/buyout', icon: 'Handshake', group: 'money' },
  { id: 'reports', title: 'Reports', synonyms: ['all records', 'exports', 'filterable list'], route: '/reports', icon: 'BarChart3', group: 'money' },
  // PRODUCT-F2: "quickbooks" used to land on app/integrations.tsx — a preview
  // catalog whose Connect button flips local state and never OAuths. The real
  // QuickBooks Online connect is /qbo-setup and the bill-review queue is
  // /qbo-review; /integrations is owner-only and deliberately unindexed.
  { id: 'quickbooks', title: 'QuickBooks Online', synonyms: ['quickbooks', 'qbo', 'accounting', 'bookkeeping', 'sync', 'integrations', 'intuit'], route: '/qbo-setup', icon: 'Plug', group: 'money' },
  { id: 'qbo-review', title: 'QuickBooks bills to review', synonyms: ['qbo review', 'bills to review', 'quickbooks bills', 'unmatched bills', 'accounting review'], route: '/qbo-review', icon: 'Receipt', group: 'money' },

  // ── Client ────────────────────────────────────────────────────────────
  { id: 'client-portal', title: 'Client Portal', synonyms: ['owner portal', 'share with client', 'homeowner view'], route: '/client-portal-setup', requires: 'client_portal', icon: 'Briefcase', group: 'client', projectScoped: true },
  { id: 'contract', title: 'Contracts', synonyms: ['agreements', 'sign', 'terms'], route: '/contract', requires: 'client_portal', icon: 'MageContract', group: 'client', projectScoped: true },
  { id: 'closeout-binder', title: 'Closeout Binder', synonyms: ['o&m', 'as builts', 'turnover package', 'manuals'], route: '/closeout-binder', icon: 'ShieldCheck', group: 'client', projectScoped: true },
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
] as const satisfies readonly FeatureEntry[];

export const FEATURE_REGISTRY: readonly FeatureEntry[] = REGISTRY;

/** Every id in the registry, as a union. Nav surfaces type their `feature`
 *  field with this, so naming a destination that does not exist is a compile
 *  error instead of a row that silently disappears at runtime. */
export type FeatureId = (typeof REGISTRY)[number]['id'];

const BY_ID = new Map<string, FeatureEntry>(REGISTRY.map(e => [e.id, e as FeatureEntry]));

/** Registry lookup for a known id. Total by construction — `FeatureId` is
 *  derived from the rows — so nav surfaces can read `.route` / `.requires`
 *  without a null branch that would silently swallow a bad id. */
export function featureFor(id: FeatureId): FeatureEntry {
  const hit = BY_ID.get(id);
  // Unreachable while FeatureId is derived from REGISTRY; the throw exists so
  // a future refactor that widens the type fails loudly at the call site
  // instead of rendering a row that navigates nowhere.
  if (!hit) throw new Error(`featureFor: '${id}' is not in FEATURE_REGISTRY`);
  return hit;
}

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
