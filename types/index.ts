// Trade taxonomy — used by Gantt bar color + Board phase-dot.
// Canonical list lives here so the ScheduleTask interface can reference it
// without a circular import from utils/.
export type TradeKey =
  | 'general' | 'concrete' | 'framing' | 'electrical' | 'plumbing'
  | 'hvac'    | 'roofing'  | 'steel'   | 'demo'       | 'landscaping'
  | 'finish'  | 'closeout';

export type ProjectType =
  | 'new_build'
  | 'renovation'
  | 'addition'
  | 'remodel'
  | 'commercial'
  | 'landscape'
  | 'roofing'
  | 'flooring'
  | 'painting'
  | 'plumbing'
  | 'electrical'
  | 'concrete';

export interface ProjectTypeInfo {
  id: ProjectType;
  label: string;
  icon: string;
  description: string;
}

export const PROJECT_TYPES: ProjectTypeInfo[] = [
  { id: 'new_build', label: 'New Build', icon: 'Building2', description: 'Ground-up construction' },
  { id: 'renovation', label: 'Renovation', icon: 'Hammer', description: 'Update existing structure' },
  { id: 'addition', label: 'Addition', icon: 'Plus', description: 'Expand existing building' },
  { id: 'remodel', label: 'Remodel', icon: 'PenLine', description: 'Redesign interior spaces' },
  { id: 'commercial', label: 'Commercial', icon: 'Store', description: 'Business & retail spaces' },
  { id: 'landscape', label: 'Landscaping', icon: 'Trees', description: 'Outdoor & yard work' },
  { id: 'roofing', label: 'Roofing', icon: 'Home', description: 'Roof repair or replace' },
  { id: 'flooring', label: 'Flooring', icon: 'LayoutGrid', description: 'Floor installation' },
  { id: 'painting', label: 'Painting', icon: 'Paintbrush', description: 'Interior & exterior' },
  { id: 'plumbing', label: 'Plumbing', icon: 'Droplets', description: 'Pipes & fixtures' },
  { id: 'electrical', label: 'Electrical', icon: 'Zap', description: 'Wiring & panels' },
  { id: 'concrete', label: 'Concrete', icon: 'Boxes', description: 'Foundation & flatwork' },
];

export type QualityTier = 'economy' | 'standard' | 'premium' | 'luxury';

export interface MaterialLineItem {
  name: string;
  category: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  bulkPrice: number;
  bulkThreshold: number;
  totalPrice: number;
  savings: number;
}

export interface LaborLineItem {
  role: string;
  hourlyRate: number;
  hours: number;
  totalCost: number;
}

export interface EstimateBreakdown {
  materials: MaterialLineItem[];
  labor: LaborLineItem[];
  permits: number;
  overhead: number;
  contingency: number;
  materialTotal: number;
  laborTotal: number;
  bulkSavingsTotal: number;
  subtotal: number;
  tax: number;
  grandTotal: number;
  pricePerSqFt: number;
  estimatedDuration: string;
  notes: string[];
}

export interface ProjectCollaborator {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  status: 'pending' | 'accepted';
  invitedAt: string;
}

/**
 * Structured scope captured on the free Project Scope screen
 * (app/project-scope.tsx). Mirrors the Estimate Wizard's answer shape
 * exactly so it round-trips into the wizard with zero translation.
 * Independent of the legacy type/squareFootage/quality/targetBudget
 * fields (different shapes, set at creation) — do NOT sync the two.
 */
export interface ProjectScope {
  projectType: string;
  sizeSqft: string;
  location: string;
  quality: 'budget' | 'standard' | 'high_end';
  scope: string;
  timelineWeeks: string;
  specialRequirements: string;
  targetBudget: string;
  updatedAt: string;
}

export type EstimateChangeReason =
  | 'manual'
  | 'sent_to_client'
  | 'converted_to_contract'
  | 'pre_overwrite'
  | 'restore';

export interface EstimateRevision {
  id: string;
  revNumber: number;          // 1-based, monotonic per project
  snapshot: LinkedEstimate;   // full immutable estimate at that point
  grandTotal: number;         // denormalized from snapshot for list render
  reason: EstimateChangeReason;
  note?: string;
  createdAt: string;          // ISO
  createdBy?: string;
}

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  location: string;
  /**
   * Geocoded coordinates for the project's `location` string. Set by the
   * geocodeProjectLocation helper after project save / update. Required
   * for hyperlocal weather (morning digest, schedule weather alerts) —
   * the weather APIs work much better with lat/lng than with free-text
   * city strings, especially in rural / remote sites where the address
   * doesn't resolve cleanly.
   *
   * Stays optional: legacy projects without coords still work, they just
   * fall back to the simulated-forecast path that drove the schedule
   * weather indicators before this field existed.
   */
  locationLatitude?: number;
  locationLongitude?: number;
  /** Timestamp of the last successful geocode (avoids re-hitting the API
   *  every save when the address hasn't changed). */
  locationGeocodedAt?: string;
  squareFootage: number;
  quality: QualityTier;
  description: string;
  scope?: ProjectScope;
  /**
   * Primary client / homeowner contact info. Carried over from Lead on
   * convertLeadToProject so the GC doesn't re-enter phone + email after
   * conversion. Optional — old projects pre-dating this field stay valid.
   */
  primaryContact?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  /**
   * Where this project came from — Lead.source carried across so win-rate
   * and revenue-by-source analytics keep working post-conversion.
   * Examples: 'houzz', 'referral', 'angi', 'direct', 'website'.
   */
  leadSource?: string;
  /**
   * Free-text timeline expectation captured at the lead stage
   * ("wants to start in spring", "ASAP for closing"). Carries over from
   * Lead.timeline so the GC has continuity. The schedule's actual
   * startDate is independent.
   */
  targetTimelineNotes?: string;
  createdAt: string;
  updatedAt: string;
  estimate: EstimateBreakdown | null;
  schedule?: ProjectSchedule | null;
  linkedEstimate?: LinkedEstimate | null;
  /** Immutable estimate revision history (milestone-driven). Absent ⇒ none yet. */
  estimateVersions?: EstimateRevision[];
  status: 'draft' | 'estimated' | 'in_progress' | 'completed' | 'closed';
  collaborators?: ProjectCollaborator[];
  clientPortal?: ClientPortalSettings;
  closedAt?: string;
  /**
   * Date the work was certified Substantially Complete — typically stamped
   * when the GC issues the G704 from the Closeout Binder. Drives the
   * 11-month warranty walk reminder on the home screen.
   */
  substantialCompletionDate?: string;
  /**
   * Set when the GC has logged the 11-month warranty walk-through.
   * Suppresses the reminder banner. Stored as ISO date.
   */
  warrantyWalkCompletedAt?: string;
  photoCount?: number;
  // Set when a project has a target / agreed contract value but no full
  // estimate yet — typically the result of a client budget proposal
  // accepted by the GC. The portal's "Contract Value" stat falls back to
  // this when project.estimate?.grandTotal is null.
  targetBudget?: ProjectTargetBudget;
  // Public portfolio settings — when enabled, surfaced at
  // mageid.app/builders/<companySlug>/<projectSlug>.
  publicProfile?: PublicProfileSettings;
  // Contract delivery / billing model. Drives how the client portal
  // displays cost transparency (open-book + GMP show real cost vs
  // budget; fixed and cost-plus only show what's been billed).
  //   fixed     — lump-sum contract; client sees billed only.
  //   cost_plus — billed = cost + agreed fee.
  //   gmp       — Guaranteed Maximum Price; client sees real cost up
  //               to the GMP cap. Savings under GMP often shared.
  //   open_book — full transparency. Client sees every commitment +
  //               actual cost vs budget in the portal.
  contractMode?: 'fixed' | 'cost_plus' | 'gmp' | 'open_book';
  // For GMP — the agreed cap. The portal surfaces overruns past this.
  gmpCap?: number;
  // For cost-plus / GMP / open_book — the GC's fee on top of cost. Either a
  // percentage of cost (most common) or a flat dollar amount. Both are
  // shown to the client when the portal is in transparent mode.
  contractorFeePercent?: number;
  contractorFeeAmount?: number;
  /**
   * Manual closeout-day checks. Keys are stable string IDs ('walkthrough',
   * 'keys', etc.); values are the ISO timestamp at which the GC marked the
   * box as done. Computed checks (selections / punch / waivers / binder)
   * are NOT stored here — they read from their source tables live.
   */
  handoverChecklist?: Record<string, string>;
}

// ─── Project Contract ───────────────────────────────────────────────
// The formal scope-of-work + payment-schedule agreement between the GC
// and the homeowner, signed inside the app. Replaces the "passcode link
// + portal snapshot" handoff with an actual binding document.

export type ContractStatus = 'draft' | 'sent' | 'signed' | 'void';

export interface PaymentMilestone {
  id: string;
  label: string;                // e.g. "Deposit", "Foundation pour", "Substantial completion"
  trigger:
    | 'on_signing'
    | 'on_date'
    | 'on_milestone'
    | 'on_invoice'
    | 'on_final';
  triggerDate?: string;          // when trigger='on_date'
  triggerMilestone?: string;     // free-text reference for trigger='on_milestone'
  amount?: number;               // fixed dollar amount
  percent?: number;              // alternative — % of contract value
  status: 'pending' | 'invoiced' | 'paid' | 'skipped';
  invoiceId?: string;
  invoicedAt?: string;
  paidAt?: string;
}

export interface ContractAllowance {
  id: string;
  category: string;              // e.g. "Kitchen fixtures", "Flooring"
  amount: number;                // budget the homeowner can spend within scope
  description?: string;
}

export interface ContractSignature {
  name: string;                  // typed legal name
  role: 'gc' | 'homeowner';
  signedAt: string;              // ISO
  signaturePaths?: string[];     // SVG paths from SignaturePad
  ipAddress?: string;            // best-effort capture for legal record
}

export interface ProjectContract {
  id: string;
  projectId: string;
  userId: string;                // GC user_id
  sourceBidId?: string;          // public_bids.id when this came from the marketplace
  sourceResponseId?: string;     // bid_responses.id of the awarded bid
  version: number;
  supersededBy?: string;
  title: string;
  contractValue: number;
  startDate?: string;
  durationDays?: number;
  scopeText: string;
  termsText: string;
  warrantyText: string;
  paymentSchedule: PaymentMilestone[];
  allowances: ContractAllowance[];
  gcSignature?: ContractSignature;
  homeownerSignature?: ContractSignature;
  status: ContractStatus;
  sentAt?: string;
  signedAt?: string;
  voidedAt?: string;
  signedPdfUrl?: string;
  proposalRevisionId?: string;
  kind?: 'contract' | 'proposal';
  createdAt: string;
  updatedAt: string;
}

// ─── Lien Waivers ───────────────────────────────────────────────────
// The 4-type generic waiver. State-specific forms (CA/TX/FL/etc.) come
// in a future push; the generic form covers ~38 states.

export type LienWaiverType =
  | 'conditional_partial'
  | 'unconditional_partial'
  | 'conditional_final'
  | 'unconditional_final';
export type LienWaiverStatus = 'requested' | 'signed' | 'received' | 'voided';

export interface LienWaiver {
  id: string;
  projectId: string;
  userId: string;
  commitmentId?: string;
  invoiceId?: string;
  waiverType: LienWaiverType;
  subCompanyId?: string;
  subName: string;
  subEmail?: string;
  throughDate: string;            // ISO date — what date the waiver covers up to
  paidAmount: number;
  status: LienWaiverStatus;
  subSignature?: ContractSignature;  // reuses the signature shape
  signedAt?: string;
  signedPdfUrl?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Selections / Allowances ────────────────────────────────────────
// Finishes, fixtures, and materials the homeowner picks within an
// allowance budget. AI curates options; homeowner picks; allowance
// auto-deducts. Goes into the contract as binding numbers.

export type SelectionCategoryStatus = 'pending' | 'browsing' | 'chosen' | 'exceeded';
export type SelectionOptionSource = 'ai_generated' | 'gc_added' | 'homeowner_added';

export interface SelectionOption {
  id: string;
  categoryId: string;
  source: SelectionOptionSource;
  productName: string;
  brand: string;
  sku: string;
  description: string;
  imageUrl?: string;
  productUrl?: string;
  unitPrice: number;
  unit: string;                  // 'ea', 'sqft', 'box', etc.
  quantity: number;
  total: number;
  leadTimeDays?: number;
  supplier?: string;
  highlights: string[];          // e.g. ["Quartz, won't stain", "10-yr warranty"]
  isChosen: boolean;
  chosenAt?: string;
  chosenByRole?: 'homeowner' | 'gc';
  createdAt: string;
}

export interface SelectionCategory {
  id: string;
  projectId: string;
  userId: string;
  category: string;              // "Kitchen Cabinets", "Bathroom Tile", etc.
  styleBrief: string;            // "modern farmhouse", or homeowner's free text
  budget: number;
  dueDate?: string;
  status: SelectionCategoryStatus;
  notes: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  options?: SelectionOption[];   // populated when fetched with options
}

export interface ProjectTargetBudget {
  amount: number;
  setAt: string;        // ISO timestamp
  setBy: 'client' | 'gc';
  clientName?: string;  // when setBy === 'client', who proposed it
  note?: string;
  // The id of the portal_budget_proposal row this came from, when
  // imported from a client proposal. Lets us reconcile if the client
  // resubmits a different number.
  proposalId?: string;
}

export interface MaterialCategory {
  id: string;
  name: string;
  icon: string;
  items: MaterialPriceInfo[];
}

export interface MaterialPriceInfo {
  name: string;
  unit: string;
  retailPrice: number;
  bulkPrice: number;
  bulkMinQty: number;
  supplier: string;
  lastUpdated: string;
}

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface DependencyLink {
  taskId: string;
  type?: DependencyType;
  lagDays: number;
}

export type TaskStatus = 'not_started' | 'in_progress' | 'on_hold' | 'done';

/**
 * MAGE "Anchors" — our term for what MS Project calls constraints. Renamed so
 * the UI reads as our own vocabulary rather than MSP's. Semantics map 1:1:
 *  - start-no-earlier  ≈ SNET  (task can't start before anchorDate)
 *  - start-no-later    ≈ SNLT  (task must start by anchorDate)
 *  - finish-no-earlier ≈ FNET
 *  - finish-no-later   ≈ FNLT
 *  - must-start-on     ≈ MSO   (hard-pin start to anchorDate)
 *  - must-finish-on    ≈ MFO   (hard-pin finish to anchorDate)
 *  - as-late-as-possible ≈ ALAP (push task to its LS without slipping project)
 *  - none              ≈ ASAP default — CPM decides.
 */
export type AnchorType =
  | 'none'
  | 'start-no-earlier'
  | 'start-no-later'
  | 'finish-no-earlier'
  | 'finish-no-later'
  | 'must-start-on'
  | 'must-finish-on'
  | 'as-late-as-possible';

export interface ScheduleTask {
  id: string;
  title: string;
  phase: string;
  durationDays: number;
  startDay: number;
  progress: number;
  crew: string;
  crewSize?: number;
  dependencies: string[];
  dependencyLinks?: DependencyLink[];
  notes: string;
  status: TaskStatus;
  isMilestone?: boolean;
  /** Level of Effort — task spans from earliest predecessor start to
   *  latest successor finish. Used for "site supervision" / "PM
   *  overhead" activities that should auto-stretch to cover linked
   *  work. P6 / Asta call this Level of Effort or Hammock. CPM engine
   *  treats LOE tasks specially: their duration is computed, not
   *  authored. */
  isLevelOfEffort?: boolean;
  wbsCode?: string;
  isCriticalPath?: boolean;
  isWeatherSensitive?: boolean;
  baselineStartDay?: number;
  baselineEndDay?: number;
  linkedEstimateItems?: string[];
  assignedSubId?: string;
  assignedSubName?: string;
  /**
   * WBS outline (MAGE calls this the "stack"). A task with a `parentId` rolls
   * up into its parent summary task. `outlineLevel` is 0 for top-level,
   * incrementing per nesting depth. `collapsed` hides children in the grid.
   * `isSummary` means this row's dates/progress are derived from its children
   * — the CPM engine ignores its own duration/startDay in favour of rollup.
   */
  parentId?: string;
  outlineLevel?: number;
  collapsed?: boolean;
  isSummary?: boolean;
  /**
   * Anchors (our constraints). `anchorType` tells the CPM engine how to treat
   * `anchorDate` (ISO YYYY-MM-DD). Absent = ASAP behavior. See AnchorType.
   */
  anchorType?: AnchorType;
  anchorDate?: string;
  /**
   * Soft deadline (no CPM effect — shown as red chevron marker on the Gantt
   * and a "Late vs deadline" column in the grid). Distinct from anchors:
   * anchors move the schedule; deadlines only flag it.
   */
  deadline?: string;
  /**
   * Resource IDs assigned (optional, for resource overallocation view).
   * Distinct from `crew` which is a free-text lane. Resources are structured
   * pool members with capacity limits; see `ProjectSchedule.resources`.
   */
  resourceIds?: string[];
  // As-built tracking (Phase 5). These are OPTIONAL and read-only to the CPM
  // engine — they don't cascade to successors unless the user explicitly hits
  // "Reflow from actuals." The rule: the plan stays the plan until you say so.
  //   actualStartDay: day the task actually started (1-indexed, same basis as startDay)
  //   actualEndDay:   day the task actually finished (inclusive)
  //   actualStartDate / actualEndDate: absolute dates captured alongside the
  //     day numbers — useful for reporting and less fragile than recomputing
  //     from projectStartDate (which can shift if the user edits it).
  actualStartDay?: number;
  actualEndDay?: number;
  actualStartDate?: string;
  actualEndDate?: string;
  photos?: {
    uri: string;
    timestamp: string;
    note?: string;
  }[];
  /**
   * Per-task notification subscribers — opt-in, opposite of Buildertrend's
   * email-everyone default. When the task shifts (start changes, progress
   * crosses a threshold, marked complete), only these subscribers get a
   * push/email. Empty array = no notifications. Plain text identifiers
   * (sub name, email, "+1-555-...") so the user can subscribe a sub
   * without forcing them to register.
   */
  subscribers?: string[];
  /** Trade taxonomy override. When unset, scheduleColors.inferTradeFromName(task.title)
   *  resolves the trade. Set via TaskInspector trade picker (Task 19). */
  tradeKey?: TradeKey;
}

export interface ScheduleRiskItem {
  id: string;
  title: string;
  detail: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ScheduleBaseline {
  savedAt: string;
  tasks: { id: string; startDay: number; endDay: number }[];
}

/**
 * Sub Schedule Collab — a single daily update a sub posts against a
 * specific task on the GC's master schedule. Login-less: the sub opens
 * the shared schedule URL with `?asSub=<name>`, taps a task, fills the
 * update form, and we persist locally + push to the GC.
 *
 * Distinct from `TaskAuditEntry` (GC-side mutation log) and
 * `TakeoffFieldVerification` (estimating-side photo proof).
 */
export interface SubScheduleUpdate {
  id: string;
  /** Project this update belongs to. */
  projectId: string;
  /** Master-schedule task id. Unique across schedule lives. */
  taskId: string;
  /** Sub identifier — name as drawn on the schedule. Plain text so a
   *  sub can post without registering for an account. */
  subName: string;
  /** ISO YYYY-MM-DD — the day the update is *for* (not when it was posted). */
  forDate: string;
  /** % complete the sub is reporting today. 0-100. */
  progressPercent: number;
  /** Hours the crew worked today. Optional. */
  hoursWorked?: number;
  /** Crew size on site today. Optional. */
  crewCount?: number;
  /** Free-text note — what got done, what's coming up, etc. */
  notes?: string;
  /** Blocker the sub is flagging — drives a high-priority indicator on
   *  the GC dashboard. */
  blocker?: string;
  /** Photos attached. URIs are local (from camera/library) — they upload
   *  asynchronously via the offline queue. */
  photos?: { uri: string; timestamp: string }[];
  /** ISO timestamp the sub posted. Server-side once we add a backend. */
  postedAt: string;
  /** Optional: GPS at post time. Privacy-aware — sub opts in. */
  latitude?: number;
  longitude?: number;
}

/**
 * Structured resource for overallocation checks and the swim-lane view. We
 * keep `crew` (free text) for legacy projects; `ProjectResource` is the new
 * pool-member model: each resource has a capacity (how many concurrent tasks
 * it can absorb) and an optional rate for cost rollups.
 */
export interface ProjectResource {
  id: string;
  name: string;
  color?: string;
  maxConcurrent?: number;
  /** Default hourly rate (back-compat). New code should prefer `rateTable`. */
  ratePerHour?: number;
  /** Multi-rate table — standard / OT / weekend / prevailing-wage / custom.
   *  P6 supports up to 5; we expose the same. When set, this overrides
   *  ratePerHour. Each entry is keyed by a stable `kind` so the EVM /
   *  payroll engines can pick the right column. */
  rateTable?: ResourceRate[];
  /** Working calendar this resource follows. References a key in
   *  `ProjectSchedule.resourceCalendars`. When unset the resource follows
   *  the project calendar. P6 calls this Resource Calendars. */
  calendarKey?: string;
}

/** A single rate column on a resource's rate table. */
export interface ResourceRate {
  /** Stable key — 'standard' is required; the rest are optional. */
  kind: 'standard' | 'overtime' | 'weekend' | 'prevailing' | 'custom';
  /** Display label override (e.g. "Davis-Bacon Tier 2"). */
  label?: string;
  /** Hourly rate in project currency. */
  ratePerHour: number;
  /** Effective-from ISO date. When omitted, rate is always effective. */
  effectiveFrom?: string;
}

/**
 * Per-resource calendar override. Different from project calendar:
 * lets Drywall Sub work Mon-Thu while Framers work Mon-Fri half-Sat.
 * Stored on `ProjectSchedule.resourceCalendars` keyed by the calendarKey
 * referenced by `ProjectResource.calendarKey`.
 */
export interface ResourceCalendar {
  key: string;
  name: string;
  /** Working days per week (e.g. 4 for Mon-Thu). */
  workingDaysPerWeek: number;
  /** Day-of-week indices treated as working (0=Sun). When omitted we
   *  derive from workingDaysPerWeek (5 = Mon-Fri). */
  workingDaysOfWeek?: number[];
  /** Per-date closures specific to this resource (e.g. union holidays). */
  closures?: string[];
}

/**
 * Audit-log entry capturing who edited what + when. Catches the gap P6
 * famously misses: dependency / logic edits aren't tracked in P6's
 * built-in audit. We track them here from day one.
 */
export interface ScheduleAuditEntry {
  id: string;
  /** When the change happened. */
  at: string;
  /** Stable user identifier — email, name, or 'anonymous' for a
   *  share-link sub. */
  user: string;
  /** What was touched. */
  taskId?: string;
  taskTitle?: string;
  /** Type of change — drives icon + filter. */
  kind:
    | 'task_create'
    | 'task_delete'
    | 'task_edit'
    | 'dependency_add'
    | 'dependency_remove'
    | 'dependency_edit'
    | 'progress_update'
    | 'baseline_capture'
    | 'baseline_apply'
    | 'voice_command'
    | 'sub_update'
    | 'reflow';
  /** 1-line summary the audit viewer shows. */
  summary: string;
  /** Optional structured before/after for diff display. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * A fragnet — a reusable task template (e.g. "Bathroom rough-in" with 8
 * pre-linked tasks). Drag onto a schedule and the tasks materialize with
 * their dependency network intact. Asta calls these "task pools."
 */
export interface ScheduleFragnet {
  id: string;
  name: string;
  category?: string;
  description?: string;
  /** Tasks in the fragnet. Day 1 is the fragnet's own day-1; ids are
   *  fragnet-local and we remap them on apply. */
  tasks: {
    id: string;
    title: string;
    phase: string;
    durationDays: number;
    /** Day relative to fragnet start (1-indexed). */
    startDay: number;
    /** Local dependency ids referencing other fragnet tasks. */
    dependencies: string[];
    isMilestone?: boolean;
  }[];
  /** ISO timestamp for sort order in the library. */
  createdAt: string;
  updatedAt: string;
}

export interface WeatherAlert {
  id: string;
  taskId: string;
  taskName: string;
  date: string;
  condition: string;
  dismissed: boolean;
}

export interface ProjectSchedule {
  id: string;
  name: string;
  projectId: string | null;
  /**
   * ISO date (YYYY-MM-DD) of Day 1 of the schedule. All task `startDay`
   * values are offsets from this date. Optional for back-compat — when
   * absent, consumers should fall back to today.
   */
  startDate?: string;
  workingDaysPerWeek: number;
  bufferDays: number;
  tasks: ScheduleTask[];
  totalDurationDays: number;
  criticalPathDays: number;
  laborAlignmentScore: number;
  healthScore?: number;
  riskItems: ScheduleRiskItem[];
  baseline?: ScheduleBaseline | null;
  /**
   * Named baselines captured by the user over the life of the schedule
   * (e.g. "v1", "Signed", "Approved rev 2"). Sidecar to the legacy `baseline`
   * field — we keep both so old projects without this field stay valid.
   * Persisted through updateProject so variance comparisons survive reload.
   *
   * We use `unknown[]` here instead of `NamedBaseline[]` to avoid a circular
   * type import (types/index.ts ← utils/scheduleOps.ts ← types/index.ts).
   * The callers in schedule-pro.tsx do a safe cast at the boundary.
   */
  baselines?: {
    id: string;
    name: string;
    note?: string;
    savedAt: string;
    tasks: { id: string; startDay: number; endDay: number }[];
  }[];
  weatherAlerts?: WeatherAlert[];
  /**
   * What-If scenarios — user-created alternate timelines branched off the
   * baseline `tasks` array. A scenario stores a full task snapshot plus a
   * name/note so PMs can compare e.g. "overtime push" vs. "weather delay"
   * without losing the working plan. When `activeScenarioId` matches one
   * of the scenario IDs, consumers should render that scenario's `tasks`
   * instead of `ProjectSchedule.tasks`. When null/undefined the baseline
   * plan is shown.
   *
   * Gated behind the `schedule_scenarios` feature key (Pro+). The data
   * structure is stored even for free users who had scenarios created
   * during a trial — we just hide the UI.
   */
  scenarios?: ScheduleScenario[];
  activeScenarioId?: string | null;
  /**
   * ISO dates (YYYY-MM-DD) marked as non-working — holidays, rain days, site
   * closures. Duration calculations skip these in addition to the weekend rule
   * implied by workingDaysPerWeek. Rendered as grey shading in the Gantt
   * header so users can see suppressed days.
   */
  nonWorkingDates?: string[];
  /**
   * Tasks whose total float is <= this number of days are treated as critical
   * and highlighted in MAGE orange. Default 0 (strict CPM). Raising this to
   * e.g. 2 catches "near-critical" tasks that a single slip would turn red.
   */
  criticalFloatThresholdDays?: number;
  /** Resource pool for overallocation / swim-lane view. */
  resources?: ProjectResource[];
  /** Per-resource calendar definitions, keyed by ResourceCalendar.key.
   *  Resources opt in via `ProjectResource.calendarKey`. */
  resourceCalendars?: ResourceCalendar[];
  /** Append-only audit log of every change. P6 famously misses logic
   *  changes; we don't. Bounded at 500 entries on read for performance. */
  auditLog?: ScheduleAuditEntry[];
  /** Saved fragnets (template task groups) the user can drag onto a
   *  schedule. Project-scoped so a "bathroom rough-in" template can be
   *  refined per-project, but they can also live in a global library
   *  (separate storage). */
  fragnets?: ScheduleFragnet[];
  updatedAt: string;
}

export interface ScheduleScenario {
  id: string;
  name: string;
  note?: string;
  createdAt: string;
  tasks: ScheduleTask[];
}

export interface CompanyBranding {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  licenseNumber: string;
  tagline: string;
  logoUri?: string;
  signatureData?: string[];
}

export interface Supplier {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  website: string;
  description: string;
  logoUri?: string;
  categories: string[];
  rating: number;
  deliveryOptions: string[];
  minOrderAmount: number;
  registeredAt: string;
  featured?: boolean;
}

export interface SupplierListing {
  id: string;
  supplierId: string;
  materialId?: string;
  name: string;
  description: string;
  category: string;
  unit: string;
  price: number;
  bulkPrice: number;
  bulkMinQty: number;
  inStock: boolean;
  leadTimeDays: number;
  imageUrl?: string;
}

export interface ThemeColors {
  primary: string;
  accent: string;
}

export const THEME_PRESETS: { id: string; label: string; primary: string; accent: string }[] = [
  // MAGE Orange — the brand default. Listed first so the Settings theme
  // picker shows it as option #1; matches the icon-circle / accent
  // treatment on Construction AI, AI Punch, and every CTA. Forest is
  // still available for anyone who specifically wants green.
  { id: 'mage', label: 'MAGE Orange', primary: '#FF6A1A', accent: '#FF8533' },
  { id: 'forest', label: 'Forest Green', primary: '#1A6B3C', accent: '#FF9500' },
  { id: 'ocean', label: 'Ocean Blue', primary: '#0A5EB0', accent: '#FF6B35' },
  { id: 'slate', label: 'Slate', primary: '#3D4F5F', accent: '#E8A838' },
  { id: 'charcoal', label: 'Charcoal', primary: '#2C2C2E', accent: '#FF453A' },
  { id: 'terracotta', label: 'Terracotta', primary: '#B5562A', accent: '#2D8A4E' },
  { id: 'navy', label: 'Navy', primary: '#1B3A5C', accent: '#F5A623' },
  { id: 'burgundy', label: 'Burgundy', primary: '#722F37', accent: '#D4A574' },
  { id: 'teal', label: 'Teal', primary: '#1A7A6D', accent: '#FF8C42' },
];

export interface PDFNamingSettings {
  enabled: boolean;
  prefix: string;
  includeProjectName: boolean;
  includeDocType: boolean;
  includeDate: boolean;
  separator: '-' | '_' | ' ';
  nextNumber: number;
}

export interface FinancingConfig {
  enabled: boolean;
  partnerName: string;          // e.g. "Wisetack"
  prequalBaseUrl: string;       // partner's hosted prequalification page
  gcRefCode?: string;           // GC's partner/affiliate code, if any
  exampleApr?: number;          // optional — illustrative estimate only (e.g. 9.99)
  exampleTermMonths?: number;   // optional — illustrative estimate only (e.g. 60)
  updatedAt: string;            // ISO
}

export type FinancingReferralStatus =
  | 'created' | 'clicked' | 'prequalified' | 'funded' | 'declined';

export type FinancingReferralSource = 'estimate' | 'invoice' | 'portal';

export interface FinancingReferral {
  id: string;                   // = refToken; opaque, the only id in the URL
  projectId: string;
  gcUserId: string;
  partnerName: string;
  amountCents: number;          // amount the offer was for; 0 if unknown
  status: FinancingReferralStatus;
  source: FinancingReferralSource;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  location: string;
  units: 'imperial' | 'metric';
  taxRate: number;
  contingencyRate: number;
  branding: CompanyBranding;
  supplierProfile?: Supplier;
  themeColors?: ThemeColors;
  biometricsEnabled?: boolean;
  subscription?: SubscriptionInfo;
  dfrRecipients?: string[];
  pdfNaming?: PDFNamingSettings;
  /** Morning-digest preferences. Drives the per-user pg_cron job that
   *  fires the morning-digest edge function. Defaults: disabled, 6 AM
   *  America/New_York, both channels. */
  digest?: {
    enabled: boolean;
    /** 0-23 in user's timezone. */
    hour: number;
    timezone: string;
    channels: { email: boolean; in_app: boolean };
  };
  /** Client-financing referral config. Absent ⇒ feature off. */
  financing?: FinancingConfig;
}

export interface LinkedEstimate {
  id: string;
  items: LinkedEstimateItem[];
  globalMarkup: number;
  baseTotal: number;
  markupTotal: number;
  grandTotal: number;
  createdAt: string;
}

export interface LinkedEstimateItem {
  materialId: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  bulkPrice: number;
  markup: number;
  usesBulk: boolean;
  lineTotal: number;
  supplier: string;
  /**
   * CSI MasterFormat 2020 division number ("03" for Concrete, "26" for
   * Electrical, etc.). Used to group estimate items into a real Schedule
   * of Values, organize bid packages, and label submittals. Auto-classified
   * from item description on save when not explicitly set. Optional —
   * legacy items may have it null until they're touched.
   */
  csiDivision?: string;
  /**
   * Allowance items are placeholder line items the GC carried in the
   * estimate before the homeowner finalized a selection (tile, fixtures,
   * appliances). At buyout, the GC awards a sub against the actual
   * selection and the line should be marked firm-priced. The buyout
   * award flow stamps `firmPricedAt` and clears `isAllowance` so the
   * estimate, portal, and budget all see the locked number.
   */
  isAllowance?: boolean;
  /** ISO timestamp set by the buyout flow when an allowance item is
   *  locked to a firm price. Audit trail for the homeowner portal. */
  firmPricedAt?: string;
}

export interface ChangeOrderLineItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  isNew: boolean;
  /** Optional CSI MasterFormat division code (2-digit, e.g. "03" for Concrete).
   *  When set, downstream tooling (job-cost, export, audit) can attribute this
   *  line item to a CSI division instead of falling back to free-text matching
   *  on the CO description. */
  csiDivision?: string;
}

export type ChangeOrderStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'revised' | 'void';

export type ApproverRole = 'Client' | 'Architect' | 'Owner\'s Rep' | 'Lender' | 'Other';

export interface COApprover {
  id: string;
  name: string;
  email: string;
  role: ApproverRole;
  required: boolean;
  order: number;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  responseDate?: string;
  rejectionReason?: string;
  counterAmount?: number;
}

export interface COAuditEntry {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
  detail?: string;
}

export interface ChangeOrder {
  id: string;
  number: number;
  projectId: string;
  date: string;
  description: string;
  reason: string;
  lineItems: ChangeOrderLineItem[];
  originalContractValue: number;
  changeAmount: number;
  newContractTotal: number;
  scheduleImpactDays?: number;
  scheduleImpactApplied?: boolean;
  status: ChangeOrderStatus;
  approvers?: COApprover[];
  approvalMode?: 'sequential' | 'parallel';
  approvalDeadlineDays?: number;
  auditTrail?: COAuditEntry[];
  revision?: number;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceLineItem {
  id: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  // Optional: link back to an estimate line item so we can compute "already
  // billed" per estimate row across multiple progress invoices. Populated by
  // the Bill-from-Estimate flow; absent for line items added manually.
  sourceEstimateItemId?: string;
  // The portion (0-100) of the estimate item's quantity being billed on this
  // invoice line. Only meaningful when sourceEstimateItemId is set.
  billedPercent?: number;
}

export type InvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue';
export type PaymentTerms = 'net_15' | 'net_30' | 'net_45' | 'due_on_receipt';
export type PaymentMethod = 'check' | 'ach' | 'credit_card' | 'cash';

export interface InvoicePayment {
  id: string;
  date: string;
  amount: number;
  method: PaymentMethod;
}

export interface RetentionRelease {
  id: string;
  date: string;
  amount: number;
  method: PaymentMethod;
  note?: string;
}

export interface Invoice {
  id: string;
  number: number;
  projectId: string;
  type: 'full' | 'progress';
  progressPercent?: number;
  issueDate: string;
  dueDate: string;
  paymentTerms: PaymentTerms;
  notes: string;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalDue: number;
  amountPaid: number;
  status: InvoiceStatus;
  payments: InvoicePayment[];
  retentionPercent?: number;
  retentionAmount?: number;
  retentionReleased?: number;
  retentionReleases?: RetentionRelease[];
  // Stripe payment link for this invoice. Populated once the GC taps
  // "Create Pay Link" — the portal then shows a one-tap Pay Now button to the
  // client. Null / absent means no Stripe link has been generated.
  payLinkUrl?: string;
  payLinkId?: string;
  createdAt: string;
  updatedAt: string;
}

// AIA G702/G703 progress pay application saved against a project. The portal
// surfaces these as a dedicated "Pay Applications" section so the client (and
// architect/lender) can review the cover summary and download a printable PDF
// without ever needing to come back to email. Stored locally under the key
// `tertiary_aia_pay_apps`; mirrored into the portal snapshot as a compact
// summary that the static portal page can render and print.
export interface SavedAIAPayAppLine {
  id: string;
  itemNo: string;
  description: string;
  scheduledValue: number;
  fromPreviousApp: number;
  thisPeriod: number;
  materialsPresentlyStored: number;
  retainagePercent: number;
}

export interface SavedAIAPayApp {
  id: string;
  projectId: string;
  invoiceId?: string;

  applicationNumber: number;
  applicationDate: string;
  periodTo: string;
  contractDate?: string;

  ownerName: string;
  contractorName: string;
  architectName?: string;
  projectName: string;
  projectLocation?: string;
  contractForDescription?: string;

  originalContractSum: number;
  netChangeByCO: number;
  contractSumToDate: number;

  retainagePercent: number;
  lessPreviousCertificates: number;

  lines: SavedAIAPayAppLine[];
  notes?: string;

  // Snapshot of computed totals at save time so the portal can render without
  // re-running the math (and so historical apps stay correct even if SOV
  // logic later changes).
  totals: {
    totalScheduledValue: number;
    totalCompletedAndStored: number;
    totalRetainage: number;
    totalEarnedLessRetainage: number;
    currentPaymentDue: number;
    balanceToFinish: number;
    percentComplete: number;
  };

  // Stripe payment link auto-generated for the `currentPaymentDue` total
  // when the GC has Connect onboarded. Lets the homeowner pay an AIA pay
  // app directly from the client portal, same UX as a regular invoice.
  // Pre-audit (May 2026), AIA pay apps generated a PDF and saved a
  // record but had NO payment-link wiring — homeowners got a print-only
  // pay app while regular invoices got Pay buttons. Asymmetric.
  payLinkUrl?: string;
  payLinkId?: string;

  savedAt: string;
}

export interface ManpowerEntry {
  id: string;
  trade: string;
  company: string;
  headcount: number;
  hoursWorked: number;
}

export interface DFRWeather {
  temperature: string;
  conditions: string;
  wind: string;
  isManual: boolean;
}

export interface DFRPhoto {
  id: string;
  uri: string;
  timestamp: string;
  /** GPS latitude captured at the moment of taking the photo, if permission granted and a fix landed within ~3s. */
  latitude?: number;
  /** GPS longitude. */
  longitude?: number;
  /** OS-reported accuracy in meters; higher number = less precise. Useful for filtering "junk" fixes (>200 m). */
  locationAccuracyMeters?: number;
  /** Human-readable label \u2014 reverse-geocoded address when online, else "<lat>, <lng>". */
  locationLabel?: string;
}

export type DFRStatus = 'draft' | 'sent';

export type IncidentSeverity = 'near_miss' | 'minor' | 'moderate' | 'major' | 'critical';

export interface IncidentReport {
  hasIncident: boolean;
  severity?: IncidentSeverity;
  description?: string;
  peopleInvolved?: string;
  injuriesReported?: boolean;
  medicalTreatment?: boolean;
  oshaRecordable?: boolean;
  correctiveAction?: string;
  reportedBy?: string;
  reportedAt?: string;
}

export interface SafetyToolboxTalk {
  topic: string;
  durationMinutes?: number;
  attendees?: number;
  conductedBy?: string;
}

/**
 * Per-task progress entry on a Daily Field Report. Lets the GC mark
 * "Concrete Pour — Level 2 was 100% complete today" as a structured chip
 * instead of burying it in the workPerformed free-text. Read by the
 * client portal's "Latest update" panel + the schedule's progress
 * rollup so a saved DFR feeds task progress automatically.
 */
export interface DFRWorkProgress {
  /** ScheduleTask.id — links the chip to the schedule. */
  taskId: string;
  /** Snapshot of the task title at the time of save (so historical DFRs
   *  read correctly even if the task was renamed/deleted). */
  taskName: string;
  /** Snapshot of the task phase, drives chip color. */
  phase: string;
  /** Percent complete reported on this DFR's date (0-100). */
  pct: number;
}

export interface DailyFieldReport {
  id: string;
  projectId: string;
  date: string;
  weather: DFRWeather;
  manpower: ManpowerEntry[];
  workPerformed: string;
  /**
   * Structured per-task progress chips. Optional — older DFRs omit this.
   * The schedule-progress rollup and the homeowner portal both consume it
   * when present, falling back to workPerformed free-text otherwise.
   */
  workProgress?: DFRWorkProgress[];
  materialsDelivered: string[];
  issuesAndDelays: string;
  photos: DFRPhoto[];
  status: DFRStatus;
  incident?: IncidentReport;
  safetyToolboxTalk?: SafetyToolboxTalk;
  /**
   * Homeowner-friendly summary, AI-generated from the technical fields
   * above. The GC reviews + edits, then taps "Publish to portal" which
   * flips `homeownerSummaryPublished` to true. The portal snapshot picks
   * up the latest published summary and shows it as the "Latest update"
   * panel at the top of the homeowner's portal.
   */
  homeownerSummary?: string;
  homeownerSummaryGeneratedAt?: string;
  homeownerSummaryPublished?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SubTrade =
  | 'General'
  | 'Framing'
  | 'Electrical'
  | 'Plumbing'
  | 'HVAC'
  | 'Roofing'
  | 'Concrete'
  | 'Drywall'
  | 'Painting'
  | 'Flooring'
  | 'Landscaping'
  | 'Other';

export const SUB_TRADES: SubTrade[] = [
  'General', 'Framing', 'Electrical', 'Plumbing', 'HVAC', 'Roofing',
  'Concrete', 'Drywall', 'Painting', 'Flooring', 'Landscaping', 'Other',
];

export type ComplianceStatus = 'compliant' | 'expiring_soon' | 'expired';

export interface SubBidRecord {
  id: string;
  projectId: string;
  projectName: string;
  bidAmount: number;
  outcome: 'won' | 'lost' | 'pending';
  date: string;
}

// ─────────────────────────────────────────────
// CRM / Lead pipeline
// ─────────────────────────────────────────────

/**
 * Pipeline stage for a homeowner inquiry. We keep the set tight on
 * purpose — solo / small-team GCs lose deals in the gaps between
 * stages, so each stage represents a clear next-action handoff.
 *   new        — just came in, hasn't been contacted yet.
 *   qualified  — replied / spoken to, fits the GC's wheelhouse.
 *   proposal   — estimate / quote sent; awaiting decision.
 *   won        — accepted; converted to a Project.
 *   lost       — declined or went cold.
 */
export type LeadStage = 'new' | 'qualified' | 'proposal' | 'won' | 'lost';

export const LEAD_STAGES: LeadStage[] = ['new', 'qualified', 'proposal', 'won', 'lost'];
export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  qualified: 'Qualified',
  proposal: 'Proposal sent',
  won: 'Won',
  lost: 'Lost',
};

/** Where the lead originated. Open enum — anything not in the list goes
 *  in `sourceOther`. The fixed list covers the channels residential GCs
 *  most often track for ROI. */
export type LeadSource =
  | 'referral' | 'website' | 'houzz' | 'angi' | 'yelp' | 'thumbtack'
  | 'google' | 'facebook' | 'instagram' | 'walk_in' | 'repeat'
  | 'sign' | 'truck' | 'other';

export const LEAD_SOURCES: LeadSource[] = [
  'referral','website','houzz','angi','yelp','thumbtack','google','facebook','instagram','walk_in','repeat','sign','truck','other',
];
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  referral: 'Referral',
  website: 'Website',
  houzz: 'Houzz',
  angi: 'Angi',
  yelp: 'Yelp',
  thumbtack: 'Thumbtack',
  google: 'Google',
  facebook: 'Facebook',
  instagram: 'Instagram',
  walk_in: 'Walk-in',
  repeat: 'Repeat client',
  sign: 'Yard sign',
  truck: 'Truck signage',
  other: 'Other',
};

/** Single contact / activity touch on a lead. The list is the activity
 *  feed the GC sees on the lead-detail screen. */
export type LeadTouchKind = 'note' | 'call' | 'text' | 'email' | 'meeting' | 'site_visit' | 'voicemail';

export interface LeadTouch {
  id: string;
  kind: LeadTouchKind;
  body: string;
  /** ISO timestamp the touch happened. */
  occurredAt: string;
  /** Who did the touch (defaults to current user; lets us show "Mike called" later). */
  byName?: string;
}

export interface Lead {
  id: string;
  /** Display name of the homeowner ("John Smith"). */
  name: string;
  /** Best phone — drives the call/text quick actions on the detail screen. */
  phone?: string;
  email?: string;
  /** Where the work would happen — drives drive-time / region matching. */
  address?: string;

  /** What kind of project. Free-text so the AI can fill ANY description. */
  projectType?: string;
  /** Mapped to ProjectType when we convert to a Project. */
  projectTypeMapped?: ProjectType;
  /** Free-text scope notes the homeowner described. */
  scope?: string;

  /** GC's expected ballpark from the conversation. 0 if not stated. */
  budgetMin?: number;
  budgetMax?: number;
  /** When they want it done. Free-text ("spring", "before July"). */
  timeline?: string;

  source: LeadSource;
  /** When source is 'other' or specific, free-text fallback ("Bob Jones referred"). */
  sourceOther?: string;

  stage: LeadStage;

  /** AI-computed fit score 0-100. Higher = better fit for this GC's
   *  sweet spot. Recomputed when a lead is updated. */
  score?: number;
  /** Human-readable reason behind the score. */
  scoreReason?: string;

  /** First-response clock — when the lead arrived. The list view shows
   *  "waiting Xh for first response" until firstRespondedAt fills in. */
  receivedAt: string;
  firstRespondedAt?: string;

  /** Activity log — most-recent first. */
  touches?: LeadTouch[];

  /** When 'won' is hit, we convert this to a Project and store its ID. */
  convertedProjectId?: string;
  /** When 'lost' is hit, optional reason ("price", "timing", "ghosted"). */
  lostReason?: string;

  createdAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────
// Buyout / Bid Packages
// ─────────────────────────────────────────────
//
// Buyout is the period after a job is won, before/during the first
// weeks of construction, when the GC converts estimate "carry" prices
// into actual signed subcontracts. The delta between estimate carry
// and actual subcontract is the GC's buyout savings — typically the
// single biggest margin lever on a residential job.
//
// Data model:
//   BidPackage     — A scope of work the GC sends out for bid
//                    (e.g. "Plumbing rough-in", "Drywall hang &
//                    finish"). Owns its budget (sum of linked
//                    estimate items), due date, status, and a list
//                    of bids received.
//   BidPackageBid  — A single bid received against a package, with
//                    inclusions / exclusions parsed for leveling.
//
// Lifecycle: open → leveling → awarded (creates a Commitment) →
//            (optionally) cancelled / re-issued.

export type BidPackageStatus = 'open' | 'leveling' | 'awarded' | 'cancelled';

export const BID_PACKAGE_STATUSES: BidPackageStatus[] = ['open', 'leveling', 'awarded', 'cancelled'];
export const BID_PACKAGE_STATUS_LABELS: Record<BidPackageStatus, string> = {
  open: 'Open · Soliciting bids',
  leveling: 'Leveling · Comparing bids',
  awarded: 'Awarded',
  cancelled: 'Cancelled',
};

export type BuyoutBidStatus = 'received' | 'qualified' | 'disqualified' | 'awarded';

export interface BidPackageBid {
  id: string;
  packageId: string;
  /** Either subcontractorId (preferred — links to verified prequal) or
   *  free-text vendorName. Voice-intake fills the latter; user can
   *  upgrade to a real Subcontractor record later. */
  subcontractorId?: string;
  vendorName?: string;
  /** Total dollar bid. */
  amount: number;
  /** What the bid INCLUDES — drives the leveling delta. Free-text;
   *  AI-leveled later. ("All rough plumbing, fixtures, permits") */
  includes?: string;
  /** What the bid EXCLUDES — the gotcha. ("Excludes fixtures, dump
   *  fees, permit pull"). Required for honest leveling. */
  excludes?: string;
  /** Free-text terms / notes ("Net 30", "10% deposit", "Available 4/15"). */
  terms?: string;
  /** Voice / scan / pdf / email — where the bid came from. */
  source?: 'voice' | 'email' | 'pdf' | 'phone' | 'in_person' | 'manual';
  status: BuyoutBidStatus;
  submittedAt: string;
  /** AI-suggested adjustment in dollars to level this bid against the
   *  others — e.g. if Sub A excluded fixtures and the average fixtures
   *  cost is $1,200, AI would set normalizedAdjustment: 1200 so the
   *  leveled total is amount + 1200. */
  normalizedAdjustment?: number;
  normalizedAdjustmentReason?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BidPackage {
  id: string;
  projectId: string;
  name: string;
  /** CSI division when applicable — drives sort order + filtering. */
  csiDivision?: string;
  /** Project phase ("Rough-in", "Finishes") for grouping. */
  phase?: string;
  /** Free-text scope description sent to bidders. AI-generates from
   *  linked estimate items by default; GC can edit. */
  scopeDescription?: string;
  /** Estimate line item IDs whose carry totals to the package budget.
   *  Required for "buyout savings" math. */
  linkedEstimateItemIds: string[];
  /** Sum of linked estimate carry — the budget bidders are bidding against. */
  estimateBudget: number;
  /** Status flow: open → leveling → awarded. */
  status: BidPackageStatus;
  /** When bids are due. Drives the buyout schedule view. */
  dueDate?: string;
  /** Bids received, denormalized for fast list rendering. The
   *  authoritative store is the BidPackageBid table; this array is
   *  rebuilt on every load. */
  bids?: BidPackageBid[];
  /** When awarded, the bid id that won + the resulting commitment. */
  awardedBidId?: string;
  awardedCommitmentId?: string;
  /** Net buyout savings (or overrun) once awarded:
   *  estimateBudget - awardedBid.amount + normalizedAdjustment. */
  buyoutSavings?: number;
  /** Required-by date that drives this package — usually the start
   *  date of the linked estimate work. AI uses it to compute "you
   *  need to award by X" warnings. */
  requiredByDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subcontractor {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  trade: SubTrade;
  licenseNumber: string;
  /** ISO 3166-2 state code the license was issued in (e.g. 'CA', 'TX').
   *  When present, the app deep-links the verifier to the right state
   *  contractor board. Defaults to the GC's company state if unset. */
  licenseState?: string;
  licenseExpiry: string;
  coiExpiry: string;
  w9OnFile: boolean;
  /**
   * Last 4 of the EIN/SSN. Captured for 1099-NEC year-end export.
   * Full TIN never stored — the GC keeps the actual W-9 PDF on file
   * (s.w9DocPath). 1099 form requires only the masked last-4 in the
   * recipient TIN field; CPAs match against the W-9 they received.
   */
  taxIdLast4?: string;
  /**
   * Legal entity name (sometimes different from companyName, e.g. DBA
   * vs. legal LLC). Goes on the 1099 in the Recipient Name field.
   */
  legalName?: string;
  /** Last time the GC visually confirmed the license was active on the
   *  state board's lookup page. Stamped when the GC taps "Mark verified"
   *  after the in-app webview opens the official source. The badge on
   *  the sub card grows greener when this is recent (under 90 days). */
  licenseVerifiedAt?: string;
  /** Last time COI was visually confirmed valid against the carrier's
   *  certificate. Distinct from coiExpiry, which is what the COI says;
   *  this is when WE last confirmed it's still in force. Recommended
   *  cadence: every 90 days or before a new project starts. */
  coiVerifiedAt?: string;
  bidHistory: SubBidRecord[];
  assignedProjects: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Commitment — a signed subcontract or purchase order. Distinct from an
 * `Invoice` (which is a bill that has been received) and from an
 * `EstimateItem` (which is just a budget line). Job costing needs all three
 * to compute cost-to-complete: budget (estimate) → committed (subs/POs) →
 * actual (paid invoices). The variance between budget and committed catches
 * bad bids early; the variance between committed and actual catches
 * cost-overruns on already-signed work.
 *
 * EAC method (MAGE opinionated default):
 *   EAC = actualPaid + (committed - actualPaidAgainstCommitment)
 *                   + (budget - committed)   // uncommitted remainder
 *
 * This matches what Knowify/Planyard use. If budget < committed we flag
 * the variance as negative (over-bid). If a change order references a
 * commitment, its change_amount rolls into the commitment's `changeAmount`.
 */
export type CommitmentType = 'subcontract' | 'purchase_order';
export type CommitmentStatus = 'draft' | 'active' | 'closed';

export interface Commitment {
  id: string;
  projectId: string;
  number: string;
  type: CommitmentType;
  /** One of subcontractorId OR vendorName should be present. */
  subcontractorId?: string;
  vendorName?: string;
  description: string;
  /** Original signed amount — do NOT mutate this; CO revisions go into `changeAmount`. */
  amount: number;
  /** Net change from approved change orders touching this commitment. */
  changeAmount?: number;
  /**
   * Running total of approved + paid sub-submitted invoices against this
   * commitment. Maintained server-side by a trigger on sub_submitted_invoices
   * — never mutate from client. Drives "are we close to maxing out the
   * sub's contract?" math + the overpayment guard at sub-portal-setup.
   */
  paidToDate?: number;
  signedDate: string;
  phase?: string;
  csiDivision?: string;
  /** Estimate line items this commitment fulfils, for variance tracing. */
  linkedEstimateItems?: string[];
  status: CommitmentStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Prequalification + COI tracking.
 *
 * Why this exists (MAGE product angle): OSHA's Multi-Employer Citation
 * Policy treats the GC as a "controlling employer." Missed licenses or
 * insurance lapses can be $16,550 per instance. Small GCs track this in
 * spreadsheets; ISNetworld charges $15K/year. We do it in-app for free
 * on the sub side (pro for the GC) and auto-review obvious cases.
 *
 * Flow: GC invites sub → sub fills form via magic link (no login) →
 * auto-review against `PrequalCriteria` → GC either accepts or flags
 * manual review. Annual renewals on a 60/30/7 cadence.
 */
export type PrequalStatus =
  | 'draft'            // GC is building the packet, not yet sent
  | 'invited'          // magic link sent, awaiting sub
  | 'in_progress'      // sub started filling
  | 'submitted'        // sub completed, pending review
  | 'approved'         // auto or manual approved
  | 'needs_changes'    // kicked back for missing docs
  | 'rejected'         // failed criteria, sub not eligible
  | 'expired';         // past expiresAt, needs renewal

export interface PrequalFinancials {
  annualRevenue?: number;       // USD
  yearsInBusiness?: number;
  largestProjectCompleted?: number;
  bondingCapacitySingle?: number;
  bondingCapacityAggregate?: number;
  bankReference?: string;
  attestationSigned?: boolean;
}

export interface PrequalSafetyRecord {
  /** Experience Modification Rate (OSHA proxy). < 1.0 is better than average. */
  emr3yr?: [number | undefined, number | undefined, number | undefined];
  /** OSHA 300A logs uploaded (paths to stored files). */
  osha300ALogs?: string[];
  writtenSafetyProgram?: boolean;
  lastOshaInspection?: { date: string; outcome: string } | null;
  /** true if had a recordable incident in last 3 yrs. */
  hadRecordableIncident?: boolean;
}

export interface PrequalInsurance {
  cglPerOccurrence?: number;           // e.g. 1_000_000
  cglAggregate?: number;               // e.g. 2_000_000
  autoLiability?: number;
  workersCompActive?: boolean;
  /** Name of the workers-comp carrier (insurance-side field, surfaced in the
   * GC review modal alongside coverage limits). */
  workersCompCarrier?: string;
  umbrella?: number;
  /** Additional-insured endorsement: CG 20 10 (ongoing) vs CG 20 37 (completed). */
  hasCG2010?: boolean;
  hasCG2037?: boolean;
  waiverOfSubrogation?: boolean;
  coiExpiry?: string;                  // YYYY-MM-DD
  coiDocPath?: string;                 // uploaded scan
}

export interface PrequalLicense {
  id: string;
  state: string;
  number: string;
  classification: string;
  expiresAt: string;
  docPath?: string;
}

/**
 * GC-defined acceptance criteria for this packet. We seed reasonable
 * defaults but the GC can tighten them per project (e.g. $5M CGL minimum
 * on large commercial).
 */
export interface PrequalCriteria {
  minCglPerOccurrence: number;
  minCglAggregate: number;
  requireWorkersComp: boolean;
  requireCG2010: boolean;
  requireCG2037: boolean;
  requireW9: boolean;
  maxEmr: number;
  minYearsInBusiness: number;
}

export const DEFAULT_PREQUAL_CRITERIA: PrequalCriteria = {
  minCglPerOccurrence: 1_000_000,
  minCglAggregate: 2_000_000,
  requireWorkersComp: true,
  requireCG2010: true,
  requireCG2037: false,
  requireW9: true,
  maxEmr: 1.0,
  minYearsInBusiness: 2,
};

export interface PrequalPacket {
  id: string;
  /** Link the packet back to the sub. Packets are stored per-sub, not per-project. */
  subcontractorId: string;
  /** Optional — set when the packet is gated to a specific project's criteria. */
  projectId?: string;
  status: PrequalStatus;
  criteria: PrequalCriteria;
  financials: PrequalFinancials;
  safety: PrequalSafetyRecord;
  insurance: PrequalInsurance;
  licenses: PrequalLicense[];
  w9OnFile: boolean;
  w9DocPath?: string;
  /** Magic-link token — sub visits /prequal-form?token=… to fill it out. No auth. */
  inviteToken?: string;
  inviteSentAt?: string;
  inviteEmail?: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  /** Auto-review results: which criteria passed/failed. */
  autoReviewFindings?: { criterion: string; passed: boolean; note?: string }[];
  /** Human reviewer notes on top of auto-review. */
  reviewerNotes?: string;
  /** When this packet needs to be renewed. Usually 1 year from reviewedAt. */
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PunchItemStatus = 'open' | 'in_progress' | 'ready_for_review' | 'closed';
export type PunchItemPriority = 'low' | 'medium' | 'high';

export interface PunchItem {
  id: string;
  projectId: string;
  description: string;
  /** Free-text location (e.g. "Unit 4B \u2014 master bath"). */
  location: string;
  assignedSub: string;
  assignedSubId?: string;
  linkedTaskId?: string;
  linkedTaskName?: string;
  dueDate: string;
  priority: PunchItemPriority;
  status: PunchItemStatus;
  photoUri?: string;
  /** GPS lat captured when the punch photo was taken. Optional. */
  photoLatitude?: number;
  photoLongitude?: number;
  photoLocationAccuracyMeters?: number;
  photoLocationLabel?: string;
  rejectionNote?: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPhoto {
  id: string;
  projectId: string;
  uri: string;
  timestamp: string;
  /** Free-text label (e.g. "Lobby \u2014 east wall"). Distinct from the GPS-derived locationLabel below. */
  location?: string;
  tag?: string;
  linkedTaskId?: string;
  linkedTaskName?: string;
  markup?: PhotoMarkup[];
  /** GPS latitude captured at the moment of taking the photo. Optional \u2014 may be missing if permission denied or no fix in 3s. */
  latitude?: number;
  /** GPS longitude. */
  longitude?: number;
  /** OS-reported fix accuracy in meters. */
  locationAccuracyMeters?: number;
  /** Reverse-geocoded address when online, else "<lat>, <lng>". */
  locationLabel?: string;
  createdAt: string;
}

export interface PhotoMarkup {
  id: string;
  type: 'arrow' | 'rectangle' | 'circle' | 'freehand' | 'text';
  color: 'red' | 'yellow' | 'green';
  points: { x: number; y: number }[];
  text?: string;
}

/**
 * A single drawing sheet. MAGE treats plans as images (rendered from PDF
 * upstream); this sidesteps native PDF renderers and keeps pinch-zoom/markup
 * identical across iOS, Android, and web. For a multi-page PDF, create one
 * PlanSheet per page.
 */
export interface PlanSheet {
  id: string;
  projectId: string;
  name: string;               // "A-101 Floor Plan"
  sheetNumber?: string;       // "A-101"
  imageUri: string;           // file://, https://, or data URI
  pageNumber?: number;        // 1-indexed if imported from a multi-page PDF
  width?: number;             // pixel dimensions of the image
  height?: number;
  /** Revision number — 1 for the first upload, +1 each time a sheet
   *  with the same `sheetNumber` is re-uploaded for the same project.
   *  Defaults to 1 when omitted (legacy rows). Surfaced as "Rev 1",
   *  "Rev 2" in the sheet list so the GC can tell at a glance which
   *  copy is current and trace back through history. */
  revision?: number;
  /** Pointer to the previous revision in the chain. Lets the viewer
   *  show "↩ Rev 1" / "Rev 3 ↪" navigation without a separate index
   *  lookup. The OLDEST revision has no previousSheetId. */
  previousSheetId?: string;
  /** True when a newer revision of this sheet exists. Set on the
   *  older row at the moment a new revision is added. The list view
   *  hides superseded sheets by default and surfaces a "Show
   *  N superseded" toggle. */
  superseded?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Two reference points on a plan with a known real-world distance between
 * them. Enables all other measurements on the sheet (distance, area) via a
 * single uniform scale. Stored separately from PlanSheet so you can
 * recalibrate without re-importing the image.
 */
export interface PlanCalibration {
  id: string;
  planSheetId: string;
  projectId: string;
  p1: { x: number; y: number };      // 0..1 normalized to image
  p2: { x: number; y: number };
  realDistanceFt: number;
  createdAt: string;
}

export type DrawingPinKind = 'note' | 'photo' | 'punch' | 'rfi';

/**
 * A pin dropped on a plan sheet. Normalized (x, y) in [0, 1] means the pin
 * survives zoom and image resizes.
 */
export interface DrawingPin {
  id: string;
  planSheetId: string;
  projectId: string;
  x: number;
  y: number;
  kind: DrawingPinKind;
  label?: string;
  color?: string;              // hex
  linkedPhotoId?: string;
  linkedPunchItemId?: string;
  linkedRfiId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Freehand / shape annotation on a plan sheet. Coords normalized 0..1.
 */
export interface PlanMarkup {
  id: string;
  planSheetId: string;
  projectId: string;
  type: 'arrow' | 'rectangle' | 'circle' | 'freehand' | 'text';
  color: string;
  strokeWidth?: number;
  points: { x: number; y: number }[];
  text?: string;
  createdAt: string;
}

export type AlertDirection = 'below' | 'above';

export interface PriceAlert {
  id: string;
  materialId: string;
  materialName: string;
  targetPrice: number;
  direction: AlertDirection;
  currentPrice: number;
  isTriggered: boolean;
  isPaused: boolean;
  createdAt: string;
}

export type SubscriptionTier = 'free' | 'pro' | 'business' | 'enterprise';

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  startDate?: string;
  endDate?: string;
}

export interface ClientPortalInvite {
  id: string;
  email: string;
  name: string;
  invitedAt: string;
  accessedAt?: string;
  status: 'pending' | 'viewed';
}

// Per-project public portfolio config. When enabled, a static page at
// `mageid.app/builders/<companySlug>/<projectSlug>` becomes accessible
// for showcasing the finished work — free portfolio for the GC, lightweight
// marketing for MAGE ID.
export interface PublicProfileSettings {
  enabled: boolean;
  // Slug is auto-generated from the project name, but the GC can override.
  slug?: string;
  // Public-friendly project description (different from internal `description`).
  publicHeadline?: string;
  publicBody?: string;
  // The GC can hand-pick which photos appear (and their order). When empty,
  // newest project photos are auto-included up to a cap.
  selectedPhotoIds?: string[];
  // Optional client testimonial — only shown if both fields are present.
  testimonialQuote?: string;
  testimonialAuthor?: string;
  // Hides specific stats from the public page (default: nothing hidden).
  hideStats?: ('value' | 'duration' | 'sqft')[];
  publishedAt?: string;
}

// Company-level public profile settings — drives the
// `mageid.app/builders/<slug>` index page that lists all of a GC's
// published projects. Stored on AppSettings.branding.
export interface PublicCompanySettings {
  enabled: boolean;
  slug?: string;
  tagline?: string;
  about?: string;
  yearFounded?: number;
  servingArea?: string;
}

export interface ClientPortalSettings {
  enabled: boolean;
  portalId: string;
  passcode?: string;
  requirePasscode?: boolean;
  showSchedule: boolean;
  showChangeOrders: boolean;
  showInvoices: boolean;
  showPhotos: boolean;
  showBudgetSummary: boolean;
  showDailyReports: boolean;
  showPunchList: boolean;
  showRFIs: boolean;
  showDocuments: boolean;
  welcomeMessage?: string;
  invites?: ClientPortalInvite[];
  // When enabled and the project has no contract value yet, the portal
  // shows a "Set your target budget" card so the owner can propose a
  // starting number before the GC has finished an estimate. Proposals
  // are persisted via the portal_budget_proposals table; the GC sees
  // them in the portal-setup screen and can Accept → sets project.targetBudget.
  clientCanSetBudget?: boolean;
  // Allows the client to 1-tap approve / decline change orders from the
  // portal. Approval rows land in change_order_approvals; the GC sees
  // pending approvals in-app and can sync them to the CO record.
  coApprovalEnabled?: boolean;
  /**
   * Language code the homeowner reads in. Drives:
   *  - AI homeowner-summary generation (the prompt instructs the model
   *    to write in this language)
   *  - Static portal UI strings (section titles, CTAs, helper text)
   *  - Email subjects + bodies sent to the homeowner
   *
   * Defaults to 'en' when missing. We ship 6 languages chosen for the
   * actual demographics of US residential construction labor + clients:
   *   en — English
   *   es — Spanish (predominant)
   *   pt — Portuguese (BR Portuguese; growing demographic)
   *   zh — Mandarin Chinese (heavy in CA + secondary markets)
   *   vi — Vietnamese (heavy in TX + CA)
   *   fr — French (Canadian / Louisiana / Acadiana)
   */
  homeownerLanguage?: PortalLanguage;

  /**
   * Plain-English weekly recap emailed to the homeowner (Friday afternoons
   * by default). AI translates contractor speak — "Sub trim/paint phase 2
   * 60% complete, 8/12 doors hung" — into homeowner-friendly summary
   * language. Off by default; the GC opts in when they invite the client.
   * Cron picks each Friday at 16:00 UTC and fans out across enabled
   * projects.
   */
  weeklyDigest?: {
    enabled: boolean;
    /** Hour-of-day in the homeowner's local timezone (0-23). Default 16
     *  (Friday afternoon — homeowner is winding down for the weekend
     *  and has time to read). */
    hour?: number;
    /** Last time the digest fired, set server-side. Used to avoid
     *  double-sends if the cron is retried. */
    lastSentAt?: string;
  };
}

/** Supported languages for the homeowner portal. ISO 639-1. */
export type PortalLanguage = 'en' | 'es' | 'pt' | 'zh' | 'vi' | 'fr';

// Budget proposal a client submits from the portal. Persisted via the
// portal_budget_proposals table; the GC reviews + accepts/declines from
// the client-portal setup screen.
export interface PortalBudgetProposal {
  id: string;
  portalId: string;
  projectId?: string;          // resolved server-side from portal_id when possible
  inviteId?: string | null;
  amount: number;
  note?: string | null;
  proposerName?: string | null;
  proposerEmail?: string | null;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
  respondedAt?: string | null;
}

// CO approval submitted from the client portal. Persisted via
// change_order_approvals; the GC sees pending approvals in-app and can
// sync them onto the underlying ChangeOrder record.
export interface ClientCOApproval {
  id: string;
  portalId: string;
  projectId?: string;
  inviteId?: string | null;
  changeOrderId: string;
  decision: 'approved' | 'declined';
  signerName?: string | null;
  signerEmail?: string | null;
  note?: string | null;
  createdAt: string;
}

// ─── Sub portal ────────────────────────────────────────────────────────
// Mirror of the client portal but pointed at a single subcontractor on a
// single project. The sub clicks a link, sees their commitment + scope
// + payment status, and can submit an invoice without making an account.

export interface SubPortalLink {
  id: string;                      // portal_id used in the share URL
  projectId: string;
  subcontractorId: string;
  passcode?: string;
  requirePasscode?: boolean;
  enabled: boolean;
  welcomeMessage?: string;
  createdAt: string;
  updatedAt: string;
  // Last time the GC built / refreshed a share link for this sub.
  lastSharedAt?: string;
  // Optional commitment(s) to scope the portal to. If empty the portal
  // shows all commitments tied to this sub on this project.
  commitmentIds?: string[];
}

// Sub-submitted invoice — distinct from `Invoice` (which is GC-to-owner).
// The sub submits via the static portal page; the GC reviews and
// approves / rejects in-app, then can route the approved amount through
// the existing payments / commitments system.
export type SubSubmittedInvoiceStatus =
  | 'submitted'   // freshly submitted, awaiting GC review
  | 'approved'    // GC has accepted; ready to pay
  | 'rejected'    // GC has rejected (with notes)
  | 'paid';       // GC has marked as paid

export interface SubSubmittedInvoiceLine {
  description: string;
  amount: number;
}

export interface SubSubmittedInvoice {
  id: string;
  subPortalId: string;
  projectId?: string;
  subcontractorId?: string;
  commitmentId?: string;
  invoiceNumber: string;
  amount: number;
  retentionAmount?: number;
  description?: string;
  lineItems?: SubSubmittedInvoiceLine[];
  status: SubSubmittedInvoiceStatus;
  submittedByName?: string;
  submittedByEmail?: string;
  notesFromSub?: string;
  notesFromGc?: string;
  createdAt: string;
  reviewedAt?: string;
  paidAt?: string;
}

export interface PortalMessage {
  id: string;
  projectId: string;
  portalId: string;
  authorType: 'client' | 'gc';
  authorName: string;
  inviteId?: string;        // which client invite authored it (if authorType === 'client')
  body: string;
  createdAt: string;
  readByGc: boolean;
  readByClient: boolean;
}

export type ContactRole = 'Client' | 'Architect' | 'Owner\'s Rep' | 'Engineer' | 'Sub' | 'Supplier' | 'Lender' | 'Inspector' | 'Other';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string;
  role: ContactRole;
  email: string;
  secondaryEmail?: string;
  phone: string;
  address: string;
  notes: string;
  linkedProjectIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type CommEventType = 'document_sent' | 'co_submitted' | 'co_approved' | 'co_rejected' | 'invoice_sent' | 'invoice_paid' | 'invoice_overdue' | 'daily_report_sent' | 'collaborator_added' | 'internal_note' | 'client_message';

export type RFIStatus = 'open' | 'answered' | 'closed' | 'void';
export type RFIPriority = 'low' | 'normal' | 'urgent';

/** Who is responsible for the next action on the RFI right now. The
 *  GC starts with the ball, hands it to the architect/engineer when
 *  the RFI is sent, gets it back when a response comes in, and so on.
 *  Surfacing this in the list view is what makes "no RFI gets buried"
 *  the actual GC experience instead of a wishful-thinking promise. */
export type RFIBallInCourt = 'gc' | 'architect' | 'engineer' | 'owner' | 'sub' | 'closed';

/** One row of the ownership-handoff log. Append-only — every time the
 *  ball moves we push a new entry so the GC can audit "who held this
 *  for how long" after the fact. Used for delay claim documentation. */
export interface RFIHandoff {
  /** ISO timestamp of the handoff. */
  at: string;
  /** Who had the ball before this handoff. */
  fromParty: RFIBallInCourt;
  /** Who has the ball after this handoff. */
  toParty: RFIBallInCourt;
  /** Free-form note shown next to the handoff in the audit trail
   *  (e.g. "responded to RFI 12 on 2026-01-13", "reassigned per
   *  architect's request"). Optional. */
  note?: string;
  /** User id of the person who triggered the handoff. */
  byUserId?: string;
  /** Display name shown in the audit log. */
  byUserName?: string;
}

export interface RFI {
  id: string;
  projectId: string;
  number: number;
  subject: string;
  question: string;
  submittedBy: string;
  assignedTo: string;
  /** Current ball-in-court. Defaults to 'gc' on creation; flips to
   *  'architect' (or whoever was assigned) when the RFI is sent, back
   *  to 'gc' when a response lands, 'closed' when the GC marks it
   *  resolved. Optional for back-compat with legacy rows. */
  ballInCourt?: RFIBallInCourt;
  /** Append-only handoff log — see RFIHandoff. Optional for back-compat. */
  handoffs?: RFIHandoff[];
  dateSubmitted: string;
  dateRequired: string;
  dateResponded?: string;
  response?: string;
  status: RFIStatus;
  priority: RFIPriority;
  linkedDrawing?: string;
  linkedTaskId?: string;
  attachments: string[];
  /**
   * Per-RFI UUID used to authorize the architect/engineer reply portal.
   * Embedded in the email link as `?token=<uuid>&type=rfi`. The portal
   * uses SECURITY DEFINER RPCs that match on this token, so anon users
   * can only access the RFI tied to their token — not enumerate others.
   * Stamped server-side on insert via the table's column default.
   */
  shareToken?: string;
  createdAt: string;
  updatedAt: string;
}

export type SubmittalStatus = 'pending' | 'in_review' | 'approved' | 'approved_as_noted' | 'revise_resubmit' | 'rejected';

export interface SubmittalReviewCycle {
  cycleNumber: number;
  sentDate: string;
  returnDate?: string;
  reviewer: string;
  status: SubmittalStatus;
  comments?: string;
}

export interface Submittal {
  id: string;
  projectId: string;
  number: number;
  title: string;
  specSection: string;
  submittedBy: string;
  submittedDate: string;
  requiredDate: string;
  reviewCycles: SubmittalReviewCycle[];
  currentStatus: SubmittalStatus;
  attachments: string[];
  /** Per-submittal UUID for the architect reply portal. See RFI.shareToken. */
  shareToken?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EarnedValueMetrics {
  budgetAtCompletion: number;
  plannedValue: number;
  earnedValue: number;
  actualCost: number;
  scheduleVariance: number;
  costVariance: number;
  schedulePerformanceIndex: number;
  costPerformanceIndex: number;
  estimateAtCompletion: number;
  estimateToComplete: number;
  varianceAtCompletion: number;
  percentComplete: number;
  calculatedAt: string;
}

export interface CashFlowDataPoint {
  period: string;
  plannedCumulative: number;
  actualCumulative: number;
  forecastCumulative: number;
}

export type EquipmentCategory = 'excavation' | 'lifting' | 'compaction' | 'concrete' | 'aerial' | 'transport' | 'power' | 'other';

export interface MaintenanceItem {
  id: string;
  description: string;
  intervalDays: number;
  lastPerformed?: string;
  nextDue: string;
  isOverdue: boolean;
}

export interface EquipmentUtilizationEntry {
  id: string;
  equipmentId: string;
  projectId: string;
  date: string;
  hoursUsed: number;
  operatorName?: string;
  notes?: string;
}

export interface Equipment {
  id: string;
  name: string;
  type: 'owned' | 'rented';
  category: EquipmentCategory;
  make: string;
  model: string;
  year?: number;
  serialNumber?: string;
  dailyRate: number;
  currentProjectId?: string;
  maintenanceSchedule: MaintenanceItem[];
  utilizationLog: EquipmentUtilizationEntry[];
  status: 'available' | 'in_use' | 'maintenance' | 'retired';
  notes?: string;
  createdAt: string;
}

export interface CommunicationEvent {
  id: string;
  projectId: string;
  type: CommEventType;
  summary: string;
  actor: string;
  recipient?: string;
  detail?: string;
  isPrivate: boolean;
  timestamp: string;
}

export const EQUIPMENT_CATEGORIES: { id: EquipmentCategory; label: string }[] = [
  { id: 'excavation', label: 'Excavation' },
  { id: 'lifting', label: 'Lifting' },
  { id: 'compaction', label: 'Compaction' },
  { id: 'concrete', label: 'Concrete' },
  { id: 'aerial', label: 'Aerial' },
  { id: 'transport', label: 'Transport' },
  { id: 'power', label: 'Power' },
  { id: 'other', label: 'Other' },
];

export type CertificationType =
  | 'MWBE' | 'MBE' | 'WBE' | 'DBE' | 'SBE' | 'SDVOB' | 'SECTION_3'
  | 'SBA_8A' | 'HUBZONE' | 'SDVOSB' | 'WOSB' | 'EDWOSB' | 'LBE' | 'EBE'
  | 'NYS_CERTIFIED_MBE' | 'NYS_CERTIFIED_WBE' | 'NYS_CERTIFIED_SDVOB'
  | 'NYC_MBE' | 'NYC_WBE' | 'NYC_EBE' | 'NYC_LBE'
  | 'NYSSD' | 'PANYNJ_MBE' | 'PANYNJ_WBE' | 'SBA_WOSB' | 'SBA_EDWOSB';

export interface CertificationInfo {
  id: CertificationType;
  label: string;
  shortLabel: string;
  description: string;
  source: string;
}

export type BidType = 'federal' | 'state' | 'municipal' | 'county' | 'private';
export type BidCategory = 'construction' | 'it_services' | 'environmental' | 'energy' | 'infrastructure' | 'transportation' | 'utilities' | 'healthcare' | 'education' | 'residential';
export type BidStatus = 'open' | 'closed';

export interface PublicBid {
  id: string;
  title: string;
  issuingAgency: string;
  city: string;
  state: string;
  category: BidCategory;
  bidType: BidType;
  estimatedValue: number;
  bondRequired: number;
  deadline: string;
  description: string;
  postedBy: string;
  postedDate: string;
  status: BidStatus;
  requiredCertifications: CertificationType[];
  contactEmail: string;
  applyUrl?: string;
  sourceUrl?: string;
  sourceName?: string;
  // Homeowner-RFP extension. When true, this row was posted by a homeowner
  // looking for a contractor (vs scraped public/agency bids). The fields
  // below are populated only on those rows.
  isHomeownerRfp?: boolean;
  addressLine?: string;
  latitude?: number | null;
  longitude?: number | null;
  photoUrls?: string[];
  drawingUrls?: string[];
  scopeDescription?: string;
  budgetMin?: number;
  budgetMax?: number;
  desiredStart?: string;
  addressVerified?: boolean;
  awardedResponseId?: string;
  awardedAt?: string;
}

// A contractor's submission against a homeowner-posted RFP.
export interface HomeownerBidResponse {
  id: string;
  bidId: string;
  proposerUserId: string;
  proposerCompanyId?: string;
  proposerName: string;
  proposerEmail?: string;
  proposerPhone?: string;
  estimateAmount: number;
  estimateSummary?: string;
  estimateBreakdown?: { label: string; amount: number }[];
  attachedPdfUrl?: string;
  message?: string;
  viewSiteRequested: boolean;
  status: 'submitted' | 'shortlisted' | 'awarded' | 'declined' | 'withdrawn';
  submittedAt: string;
  respondedAt?: string;
  awardedProjectId?: string;
}

export interface CompanyProfile {
  id: string;
  companyName: string;
  city: string;
  state: string;
  primaryCategory: BidCategory;
  bondCapacity: number;
  completedProjects: number;
  rating: number;
  contactEmail: string;
  phone: string;
  description: string;
  certifications: CertificationType[];
  website?: string;
  yearEstablished?: number;
  employeeCount?: number;
  createdAt: string;
}

export type TradeCategory =
  | 'general_laborer' | 'carpenter' | 'electrician' | 'plumber' | 'hvac_tech'
  | 'welder' | 'iron_worker' | 'mason' | 'painter' | 'roofer'
  | 'heavy_equipment_op' | 'concrete_worker' | 'demolition' | 'drywall'
  | 'flooring' | 'glazier' | 'sheet_metal' | 'pipefitter' | 'sprinkler_fitter'
  | 'fire_protection' | 'civil_engineer' | 'structural_engineer'
  | 'mechanical_engineer' | 'electrical_engineer' | 'project_manager'
  | 'site_superintendent' | 'safety_manager' | 'estimator' | 'surveyor'
  | 'inspector' | 'architect';

export type JobType = 'full_time' | 'part_time' | 'contract' | 'per_diem';
export type ExperienceLevel = 'entry' | 'mid' | 'senior' | 'expert';
export type AvailabilityStatus = 'available' | 'employed' | 'open_to_offers';

export interface JobListing {
  id: string;
  companyId: string;
  companyName: string;
  title: string;
  tradeCategory: TradeCategory;
  city: string;
  state: string;
  payMin: number;
  payMax: number;
  payType: 'hourly' | 'salary';
  jobType: JobType;
  requiredLicenses: string[];
  experienceLevel: ExperienceLevel;
  description: string;
  startDate: string;
  postedDate: string;
  status: 'open' | 'closed' | 'filled';
  applicantCount: number;
}

export interface WorkerProfile {
  id: string;
  name: string;
  tradeCategory: TradeCategory;
  yearsExperience: number;
  licenses: string[];
  city: string;
  state: string;
  availability: AvailabilityStatus;
  hourlyRate: number;
  bio: string;
  pastProjects: string[];
  contactEmail: string;
  phone: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  participantNames: string[];
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
}

export type PricingRegion =
  | 'northeast' | 'southeast' | 'midwest' | 'southwest' | 'west_coast'
  | 'mountain' | 'pacific_nw' | 'great_plains' | 'mid_atlantic' | 'new_england';

export interface RegionInfo {
  id: PricingRegion;
  label: string;
  states: string[];
  costIndex: number;
}

export type IntegrationCategory = 'accounting' | 'payments' | 'documents' | 'field_ops' | 'materials' | 'compliance' | 'communication' | 'platforms';
export type IntegrationStatus = 'connected' | 'disconnected' | 'coming_soon' | 'error';
export type IntegrationTier = 'deep' | 'link' | 'coming_soon';

export interface Integration {
  id: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  tier: IntegrationTier;
  iconColor: string;
  iconBg: string;
  connectedAt?: string;
  externalUrl?: string;
}

// ─────────────────────────────────────────────
// Accounting integrations (QuickBooks Online + Xero)
// ─────────────────────────────────────────────

export type AccountingProvider = 'quickbooks' | 'xero';

/** What's syncing in or out of the accounting system. */
export type AccountingEntityType =
  | 'invoice' | 'bill' | 'payment' | 'customer' | 'vendor'
  | 'item' | 'expense' | 'account';

export type AccountingSyncDirection = 'push' | 'pull';
export type AccountingSyncStatus = 'pending' | 'running' | 'success' | 'failed' | 'partial';

/** A single user's authenticated connection to QB/Xero. */
export interface AccountingConnection {
  id: string;
  userId: string;
  provider: AccountingProvider;
  /** QB calls it realmId; Xero calls it tenantId. We just call it externalAccountId. */
  externalAccountId: string;
  /** Company display name pulled from the API after OAuth. */
  externalCompanyName?: string;
  /** OAuth scope string we were granted. */
  scope?: string;
  /** When the access token expires — UI shows a "reconnect" prompt before this. */
  accessTokenExpiresAt?: string;
  /** When we last successfully ran any sync against this connection. */
  lastSyncedAt?: string;
  /** If the most recent sync failed, the error message lives here. */
  lastError?: string;
  status: 'active' | 'expired' | 'revoked' | 'error';
  createdAt: string;
  updatedAt: string;
}

/** A single sync attempt — appended-only audit log. */
export interface AccountingSyncLog {
  id: string;
  connectionId: string;
  entity: AccountingEntityType;
  direction: AccountingSyncDirection;
  status: AccountingSyncStatus;
  /** Records processed in this run. */
  itemsProcessed: number;
  itemsFailed: number;
  errorMessage?: string;
  startedAt: string;
  completedAt?: string;
}

/** local entity ↔ remote entity link. Lets us avoid duplicate pushes + reconcile updates. */
export interface AccountingEntityMapping {
  id: string;
  connectionId: string;
  entity: AccountingEntityType;
  /** Local primary key (e.g. invoice.id, contact.id). */
  localId: string;
  /** Remote ID (QB Id / Xero ContactID). */
  remoteId: string;
  /** Last-known remote update timestamp from the provider — used to detect remote changes. */
  remoteUpdatedAt?: string;
  /** Last-known local update timestamp — used to decide push vs. pull. */
  localUpdatedAt?: string;
  createdAt: string;
}

// ─────────────────────────────────────────────
// VIP onboarding (paid-tier white-glove)
// ─────────────────────────────────────────────

export type OnboardingBookingStatus = 'pending' | 'booked' | 'completed' | 'no_show' | 'cancelled';

export interface OnboardingSpecialist {
  id: string;
  name: string;
  email: string;
  /** Calendly (or competitor) URL pre-filtered to this specialist's calendar. */
  calendarUrl: string;
  /** Public photo URL. */
  photoUrl?: string;
  /** Short pitch shown in the "your specialist" panel. */
  bio?: string;
}

export interface OnboardingBooking {
  id: string;
  userId: string;
  specialistId?: string;
  status: OnboardingBookingStatus;
  /** ISO datetime — when the call is scheduled (filled by Calendly webhook or user). */
  scheduledAt?: string;
  /** Calendly event URI for cancel/reschedule. */
  externalEventId?: string;
  /** "60-day support" window — counts down from first paid day. */
  supportWindowEndsAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** A single setup-checklist item the new user works through. */
export interface OnboardingChecklistItem {
  id: string;
  /** Stable key — used for completion tracking across users. */
  key: 'first_project' | 'invite_team' | 'connect_accounting' | 'create_template'
       | 'run_takeoff' | 'send_first_estimate' | 'set_up_buyout' | 'book_onboarding_call';
  title: string;
  description: string;
  /** Route to push when the user taps the item. */
  href: string;
  /** Optional tier requirement — items shown only when user can access the feature. */
  requiredTier?: 'pro' | 'business';
  /** Stable order across users. */
  order: number;
}

export type TimeEntryStatus = 'clocked_in' | 'clocked_out' | 'break';

export interface TimeEntry {
  id: string;
  projectId: string;
  projectName: string;
  workerId: string;
  workerName: string;
  trade: string;
  clockIn: string;
  clockOut?: string;
  breakMinutes: number;
  /** ISO timestamp when the current break started. Set when status flips
   *  to 'break', cleared when the worker resumes. Persisted on the row so
   *  the break duration survives app force-quit / cold restart — pre-fix
   *  the break-start was a useRef in the screen component and any
   *  remount lost it. Resume reads this to compute the elapsed minutes. */
  breakStartedAt?: string;
  totalHours: number;
  overtimeHours: number;
  status: TimeEntryStatus;
  notes?: string;
  gpsLat?: number;
  gpsLng?: number;
  date: string;
}

export type DocumentType = 'lien_waiver' | 'coi' | 'contract' | 'proposal' | 'aia_billing' | 'permit' | 'other';
export type DocumentStatus = 'draft' | 'pending_signature' | 'signed' | 'expired' | 'void';

export interface ProjectDocument {
  id: string;
  projectId: string;
  projectName: string;
  type: DocumentType;
  title: string;
  status: DocumentStatus;
  createdAt: string;
  expiresAt?: string;
  signedBy?: string;
  signedAt?: string;
  fileUrl?: string;
  notes?: string;
}

// ─── Certificate of Insurance (COI) vault ──────────────────────────
//
// Per-subcontractor insurance certificates the GC collects before the
// sub mobilizes. Tracked here so the GC can answer "are all my subs
// insured today?" without rifling through email attachments.
//
// AI validator (Gemini Vision via the analyze-photos edge function)
// extracts the structured fields from an uploaded image and flags
// missing endorsements that would block a pay app on a real project.

export type COICoverageType = 'general_liability' | 'auto' | 'workers_comp' | 'umbrella' | 'professional' | 'pollution' | 'other';

export interface COICoverage {
  type: COICoverageType;
  carrierName?: string;
  policyNumber?: string;
  effectiveDate?: string;     // ISO
  expiresAt?: string;          // ISO
  /** Each-occurrence limit, in dollars. */
  eachOccurrence?: number;
  /** General aggregate, in dollars. */
  generalAggregate?: number;
}

export interface COIValidationResult {
  /** Date the COI was last validated by the AI / GC. */
  validatedAt: string;
  /** Overall pass / fail / warn — drives the row badge. */
  overallStatus: 'pass' | 'warn' | 'fail';
  /**
   * Per-check findings. Examples:
   *   - "additional_insured_missing"   — critical
   *   - "waiver_subrogation_missing"   — critical on most prime contracts
   *   - "gl_limit_below_required"      — warn
   *   - "expires_within_30_days"       — warn
   *   - "expired"                      — critical
   */
  issues: {
    code: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
  }[];
  /** When AI extracted the data, confidence 0-100. */
  confidence?: number;
}

export interface CertificateOfInsurance {
  id: string;
  subcontractorId: string;
  /** Optional project association — when set, the COI is "for this project."
   *  When null, the COI is the sub's general blanket COI on file. */
  projectId?: string;
  /** Local file URI of the COI scan. Required. */
  fileUri: string;
  /** When the GC uploaded it. */
  uploadedAt: string;
  /** AI/manual validation snapshot. May be re-run after upload. */
  validation?: COIValidationResult;
  /** Coverages extracted from the document (manual or AI). */
  coverages?: COICoverage[];
  /** Free-text notes the GC added. */
  notes?: string;
}

// ─── OAC Meeting (Owner-Architect-Contractor weekly) ───────────────
//
// The CM-led weekly project meeting where owner, architect, and contractor
// review safety, schedule, RFIs, submittals, change orders, and action
// items. Industry standard cadence: weekly during construction. Minutes
// must be issued within 24 hours per most contracts.
//
// Lives as its own type (not bolted onto a Communication record) so we
// can render structured agenda items, capture voice → AI minutes, and
// track action items across meetings.

export type OACAttendeeRole = 'owner' | 'architect' | 'engineer' | 'gc' | 'sub' | 'inspector' | 'other';

export interface OACAttendee {
  id: string;
  name: string;
  email?: string;
  company?: string;
  role: OACAttendeeRole;
  /** True when checked in / present at the meeting. */
  attended?: boolean;
}

export type OACAgendaSection =
  | 'safety'
  | 'schedule'
  | 'rfis'
  | 'submittals'
  | 'change_orders'
  | 'budget'
  | 'decisions'
  | 'action_items'
  | 'open_discussion'
  | 'next_meeting';

export interface OACAgendaItem {
  id: string;
  section: OACAgendaSection;
  /** Short heading — e.g. "RFI #14 — kitchen island beam (overdue 5 days)" */
  title: string;
  /** Detail rendered as a sub-line; AI-generated when section is auto-built. */
  detail?: string;
  /** Status drives a colored chip in the UI. */
  status?: 'info' | 'warn' | 'urgent' | 'done';
  /** When this references a specific RFI / Submittal / CO / Task, the id is here. */
  referenceId?: string;
  referenceType?: 'rfi' | 'submittal' | 'change_order' | 'task' | 'punch';
  /** GC's own note added during the meeting — survives across regenerations of the agenda. */
  manualNote?: string;
  /** Marked true after discussion. Drives "X of Y items covered" in the meeting screen. */
  covered?: boolean;
}

export interface OACActionItem {
  id: string;
  description: string;
  ballInCourt: string;        // Person/company who owes the action
  dueBy?: string;              // ISO date
  status: 'open' | 'in_progress' | 'done';
  createdAt: string;
  closedAt?: string;
  /** Origin meeting — used to attribute who/when raised the action. */
  meetingId?: string;
}

export type OACMeetingStatus = 'draft' | 'scheduled' | 'in_progress' | 'concluded' | 'distributed';

export interface OACMeeting {
  id: string;
  projectId: string;
  /** Sequential meeting number for the project — week 1, week 2, etc. */
  number: number;
  scheduledAt: string;          // ISO when meeting starts
  durationMinutes?: number;
  location?: string;            // "Site trailer" / "Zoom" / "Owner's office"
  attendees: OACAttendee[];
  /**
   * Agenda items, ordered. Auto-built by the AI when meeting is created;
   * GC can edit, add manual items, or regenerate. Survives across
   * regenerations: items with a manualNote are preserved.
   */
  agenda: OACAgendaItem[];
  /**
   * Open action items for this meeting. NEW action items added during the
   * meeting land here; closed ones are kept for audit but stop nagging.
   */
  actionItems: OACActionItem[];
  /**
   * Raw transcript captured during the meeting via voice recorder.
   * Used as input to AI minutes generation; preserved as audit material.
   */
  transcript?: string;
  /**
   * AI-generated meeting minutes — a clean narrative organized by agenda
   * section. GC reviews + edits, then taps "Distribute" to email out.
   */
  minutes?: string;
  status: OACMeetingStatus;
  /** When the GC distributed minutes to attendees. */
  distributedAt?: string;
  /** Email subjects/recipients touched in the most recent distribution. */
  distributionLog?: { recipient: string; sentAt: string; ok: boolean; error?: string }[];
  createdAt: string;
  updatedAt: string;
}

export type PermitStatus = 'applied' | 'under_review' | 'approved' | 'denied' | 'expired' | 'inspection_scheduled' | 'inspection_passed' | 'inspection_failed';
export type PermitType = 'building' | 'electrical' | 'plumbing' | 'mechanical' | 'demolition' | 'grading' | 'fire' | 'occupancy' | 'special_inspection' | 'other';

/**
 * IBC Chapter 17 special inspection categories. When a Permit has
 * `type: 'special_inspection'`, the specific category is captured here.
 * Driven by the structural systems on the project (concrete, masonry,
 * steel, etc.). Required by the building official on most projects > $1M
 * unless explicitly waived.
 */
export type SpecialInspectionCategory =
  | 'soils'             // foundation soils investigation, fill compaction
  | 'concrete'          // sampling, slump, strength, placement
  | 'masonry'           // mortar/grout, reinforcement, prism testing
  | 'structural_steel'  // welding, high-strength bolts, fabrication
  | 'cold_formed_steel' // light-gauge framing
  | 'wood'              // glulam, prefab trusses, mass timber
  | 'fire_resistive'    // sprayed-on fireproofing, firestopping
  | 'sprayed_fireproof' // SFRM thickness verification
  | 'smoke_control'     // smoke control system
  | 'special_cases';    // anything covered by approved alternative

export interface Permit {
  id: string;
  projectId: string;
  projectName: string;
  type: PermitType;
  permitNumber?: string;
  jurisdiction: string;
  status: PermitStatus;
  appliedDate: string;
  approvedDate?: string;
  expiresDate?: string;
  inspectionDate?: string;
  inspectionNotes?: string;
  fee: number;
  notes?: string;
  /** Free-text phase tag — e.g. "Foundation", "Rough-in", "Final". Lets supers see what they're blocking and slice permits by job phase. */
  phase?: string;
  /** Local file URI of the attached permit scan (issued permit, plan check stamp, inspection card). Optional. */
  attachmentUri?: string;
  /**
   * IBC Chapter 17 category — only set when `type: 'special_inspection'`.
   * Drives the inspector qualifications + report cadence the contractor
   * is expected to coordinate. Picker in the permit form gates on type.
   */
  specialInspectionCategory?: SpecialInspectionCategory;
  /** Inspector or testing agency name + license # (e.g. "Geotek - Lic. STX-4112"). */
  inspectorName?: string;
  /** Most recent IBC special inspection report — pasted notes or short summary. */
  lastReportSummary?: string;
  /** Date of last filed report. Drives "report overdue" warnings on long jobs. */
  lastReportDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
export type PaymentProvider = 'stripe' | 'square' | 'paypal' | 'venmo' | 'zelle' | 'check' | 'ach' | 'cash';

export interface Payment {
  id: string;
  invoiceId?: string;
  projectId: string;
  projectName: string;
  clientName: string;
  amount: number;
  fee: number;
  netAmount: number;
  provider: PaymentProvider;
  status: PaymentStatus;
  description: string;
  createdAt: string;
  completedAt?: string;
}

export type WarrantyCategory =
  | 'general'
  | 'roofing'
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'foundation'
  | 'windows'
  | 'appliances'
  | 'finishes'
  | 'structural'
  | 'other';

export type WarrantyStatus = 'active' | 'expiring_soon' | 'expired' | 'claimed' | 'void';

export interface WarrantyClaim {
  id: string;
  date: string;
  description: string;
  resolution?: string;
  cost?: number;
  resolvedAt?: string;
  photos?: string[];
}

export interface Warranty {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  category: WarrantyCategory;
  description?: string;
  provider: string;
  providerContactId?: string;
  startDate: string;
  durationMonths: number;
  endDate: string;
  coverageDetails?: string;
  exclusions?: string;
  documentUri?: string;
  status: WarrantyStatus;
  claims: WarrantyClaim[];
  reminderDays?: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Universal Entity Reference (EntityRef)
// ----------------------------------------------------------------------------
// A lightweight pointer to any domain object in the app. Any feature that
// needs to deep-link, cite, or navigate to a thing (activity feeds, action
// sheets, notifications, mentions, @refs in comments) should accept / emit
// an EntityRef rather than a hand-rolled {type, id} pair. See
// utils/ENTITY_REF.md for patterns.
// ============================================================================

export type EntityKind =
  | 'project'
  | 'task'
  | 'photo'
  | 'rfi'
  | 'submittal'
  | 'changeOrder'
  | 'invoice'
  | 'payment'
  | 'dailyReport'
  | 'punchItem'
  | 'warranty'
  | 'contact'
  | 'document'
  | 'permit'
  | 'equipment'
  | 'subcontractor'
  | 'commitment'
  | 'planSheet'
  | 'commEvent'
  | 'portalMessage'
  | 'drawingPin'
  | 'planMarkup'
  | 'prequalPacket'
  | 'priceAlert';

export interface EntityRef {
  kind: EntityKind;
  id: string;
  /** Parent project for nested entities. Omitted for top-level kinds (project, contact, equipment). */
  projectId?: string;
  /** Optional precomputed display label — if absent, resolvers will look it up. */
  label?: string;
}


// ============================================================================
// Takeoff — automated quantity extraction from construction drawings.
// ----------------------------------------------------------------------------
// A "takeoff" is the construction-industry term for measuring drawings to
// produce quantities (linear feet of wall, square feet of flooring, count
// of doors, etc). Historically done by hand or with desktop tools like
// PlanSwift / Bluebeam Revu. Modern AI vision models (Gemini Vision, GPT-4V,
// Togal.AI) can do an 60-75%-accurate first pass — useful as a "draft your
// takeoff in 30 seconds, review and edit" tool.
//
// Schema is intentionally rich. The AI prompt asks for confidence per item
// and source-page references so users can trace any quantity back to where
// it came from.
// ============================================================================

/** Drawing scale. e.g. 1/4" = 1'-0" → { num: 0.25, unit: 'in', perValue: 1, perUnit: 'ft' }. */
export interface TakeoffScale {
  /** Numeric value of the scale ratio's drawing side. */
  num: number;
  /** Drawing-side unit. */
  unit: 'in' | 'mm' | 'cm';
  /** Real-world side numeric value (almost always 1). */
  perValue: number;
  /** Real-world unit. */
  perUnit: 'ft' | 'm';
  /** Free-form label as it appears on the drawing (e.g. '1/4" = 1'-0"'). */
  label: string;
  /** AI confidence the scale was correctly detected. */
  confidence: TakeoffConfidence;
  /** Page number(s) where the scale was found. */
  sourcePages: number[];
}

/** Per-quantity confidence — drives UI badges + prompts user to review LOW items. */
export type TakeoffConfidence = 'high' | 'medium' | 'low';

/** Wall category — drives downstream cost-allocation (exterior gets siding, partitions don't). */
export type TakeoffWallCategory =
  | 'interior_partition'
  | 'exterior_framed'
  | 'exterior_masonry'
  | 'demising'
  | 'shaft'
  | 'foundation'
  | 'other';

/** A measured wall — single segment, by type. */
export interface TakeoffWall {
  id: string;
  /** Wall-type tag from the wall schedule (e.g. "W1", "INT-1") if visible. */
  typeCode?: string;
  /** Wall classification — drives buyout grouping (siding vs. drywall, etc.). */
  category?: TakeoffWallCategory;
  /** Plain-English description (e.g. "Interior 2x4 stud, 5/8 GWB both sides"). */
  description: string;
  /** Linear feet (or meters if metric) of this wall type. */
  lengthFt: number;
  /** Wall height in feet. Defaults to 9 if not visible — flagged low confidence. */
  heightFt: number;
  /** Square feet of wall surface (lengthFt × heightFt × sides). Computed; not from AI. */
  areaSqFt?: number;
  /** CSI MasterFormat division for buyout grouping (e.g. "06 1000" rough carpentry). */
  csiDivision?: string;
  confidence: TakeoffConfidence;
  sourcePages: number[];
  /** Free-form notes from the AI about ambiguity ("partial dimension visible"). */
  notes?: string;
}

/** A floor area — usually one per room. */
export interface TakeoffFloorArea {
  id: string;
  /** Room name from the plan label (e.g. "Master Bedroom"). */
  roomName: string;
  /** Floor finish callout (e.g. "T-1", "WOOD-A") if visible. */
  finishCode?: string;
  /** NET interior area (excluding walls) in square feet. */
  areaSqFt: number;
  /** Floor level (1 = ground, 2 = upper, 0 = basement, -1 = sub-basement). Optional. */
  level?: number;
  /** Ceiling height — pulled from section/elevation if visible, otherwise typical. */
  ceilingHeightFt: number;
  /** CSI MasterFormat division (e.g. "09 6000" floor finishes). */
  csiDivision?: string;
  confidence: TakeoffConfidence;
  sourcePages: number[];
  notes?: string;
}

/** A door entry — usually counted per type from the door schedule. */
export interface TakeoffDoor {
  id: string;
  /** Door schedule mark (e.g. "D-1", "100A"). */
  mark?: string;
  /** Type description (e.g. "3'-0" x 6'-8" SC HC paint grade"). */
  description: string;
  /** Width in inches (e.g. 36 for 3'-0"). */
  widthIn: number;
  heightIn: number;
  /** Optional flag — interior vs exterior (drives weather/hardware bidding). */
  exterior?: boolean;
  count: number;
  /** CSI division (e.g. "08 1400" wood doors, "08 1100" metal doors). */
  csiDivision?: string;
  confidence: TakeoffConfidence;
  sourcePages: number[];
}

/** A window entry. */
export interface TakeoffWindow {
  id: string;
  mark?: string;
  description: string;
  widthIn: number;
  heightIn: number;
  count: number;
  /** CSI division (e.g. "08 5000" windows). */
  csiDivision?: string;
  confidence: TakeoffConfidence;
  sourcePages: number[];
}

/** A finish entry — by surface (floor/wall/ceiling/base/etc) and material. */
export interface TakeoffFinish {
  id: string;
  surface: 'floor' | 'wall' | 'ceiling' | 'base' | 'casing' | 'crown' | 'trim' | 'other';
  /** Finish callout if visible (e.g. "PT-1", "T-2"). */
  code?: string;
  description: string;
  /** Quantity unit + value. Most finishes are sqft; trim/base/crown are linear ft. */
  quantity: number;
  unit: 'sqft' | 'lf' | 'ea';
  /** CSI MasterFormat division for buyout grouping. */
  csiDivision?: string;
  confidence: TakeoffConfidence;
  sourcePages: number[];
}

/** A fixture entry — toilets, sinks, light fixtures, HVAC units, etc. */
export interface TakeoffFixture {
  id: string;
  category: 'plumbing' | 'electrical' | 'hvac' | 'appliance' | 'other';
  /** Mark/tag (e.g. "WC-1", "L-3"). */
  mark?: string;
  description: string;
  count: number;
  /** CSI division (22 plumbing, 26 electrical, 23 HVAC, 11 appliances). */
  csiDivision?: string;
  confidence: TakeoffConfidence;
  sourcePages: number[];
}

/** Concrete or other bulk material in volume terms. */
export interface TakeoffBulkMaterial {
  id: string;
  /** What the material is (concrete, asphalt, gravel base, etc). */
  description: string;
  /** Quantity. */
  quantity: number;
  unit: 'cy' | 'sqft' | 'tons' | 'lbs' | 'cf';
  confidence: TakeoffConfidence;
  sourcePages: number[];
  notes?: string;
}

/** Issues / unclear areas the AI flagged for human review. */
export interface TakeoffConcern {
  severity: 'critical' | 'moderate' | 'minor';
  /** Short headline (e.g. "Wall heights not dimensioned"). */
  topic: string;
  /** Why it matters in 1-2 sentences. */
  detail: string;
  /** What the user should do (request RFI, dimension, get sub bid, etc). */
  recommendation: string;
  sourcePages: number[];
}

/** A callout / spec code seen on the plans (e.g. "PT-1", "T-2", "WC-1"). */
export interface TakeoffCallout {
  /** The exact code as drawn (e.g. "PT-1"). */
  code: string;
  /** What surface or category it labels — wall finish, floor finish, fixture, etc. */
  context: 'wall_finish' | 'floor_finish' | 'ceiling_finish' | 'fixture' | 'door' | 'window' | 'other';
  /** Times the code appeared across pages. */
  occurrences: number;
  sourcePages: number[];
}

/** Field-side verification: photo + GPS + note tied to a takeoff row. */
export interface TakeoffFieldVerification {
  id: string;
  /** "section:id" of the row this verifies — same key the overrides map uses. */
  rowKey: string;
  /** Local file URI on mobile, blob URL on web. Not uploaded yet — mobile-only feature. */
  photoUri: string;
  /** "AI says X, I measured Y" note from the user. */
  note?: string;
  /** Decimal GPS coords if available. */
  latitude?: number;
  longitude?: number;
  /** What the user actually measured if they entered it. */
  measuredQuantity?: number;
  /** ISO timestamp. */
  capturedAt: string;
}

/** A single spec entry pulled from the architect's spec book. */
export interface SpecEntry {
  /** The callout code as written in the spec (e.g. "PT-1"). */
  code: string;
  /** CSI section if visible (e.g. "09 9123" interior painting). */
  csiSection?: string;
  manufacturer?: string;
  product?: string;
  /** SKU / model number if listed. */
  sku?: string;
  /** Color / finish description (e.g. "Eggshell SW7036 Accessible Beige"). */
  finish?: string;
  /** Free-form notes on installation, substrate prep, etc. */
  notes?: string;
  confidence: TakeoffConfidence;
  sourcePages: number[];
}

/** Result of running the spec book through the AI. */
export interface SpecMatchResult {
  /** All extracted spec entries, keyed by code. */
  entries: SpecEntry[];
  /** Callout codes that appeared on the plans but had no spec match. */
  unmatched: string[];
  /** Quality / completeness signals. */
  confidenceOverall: TakeoffConfidence;
  confidenceExplanation: string;
}

/** The full takeoff result. */
export interface TakeoffResult {
  /** Summary of what these drawings represent (1-2 sentences). */
  summary: string;
  /** Detected drawing scale per page set. */
  scale: TakeoffScale;
  /** Per-page meta — what each page is and how readable it is. */
  drawingsSeen: Array<{
    page: number;
    type: string;
    scope: string;
    readability: 'clear' | 'partial' | 'poor';
  }>;
  /** Estimated total square footage across the project (gross, ground floor + upper). */
  estimatedSquareFootage?: number;
  /** GROSS exterior envelope SF (separate from sum of room areas). */
  grossEnvelopeSqFt?: number;

  // Quantity rollups
  walls: TakeoffWall[];
  floorAreas: TakeoffFloorArea[];
  doors: TakeoffDoor[];
  windows: TakeoffWindow[];
  finishes: TakeoffFinish[];
  fixtures: TakeoffFixture[];
  bulkMaterials: TakeoffBulkMaterial[];

  /** Spec callouts seen on the drawings — feeds the Phase 2c spec matcher. */
  callouts?: TakeoffCallout[];

  // Quality signals
  concerns: TakeoffConcern[];
  /** Items the user should manually verify before relying on the takeoff. */
  doubleCheck: string[];
  /** Trades / scopes the AI couldn't extract (no MEP drawings, no site plan, etc). */
  missingScopes: string[];
  /** Rolled-up confidence on the entire takeoff. */
  confidenceOverall: TakeoffConfidence;
  confidenceExplanation: string;
}
