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

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  location: string;
  squareFootage: number;
  quality: QualityTier;
  description: string;
  createdAt: string;
  updatedAt: string;
  estimate: EstimateBreakdown | null;
  schedule?: ProjectSchedule | null;
  linkedEstimate?: LinkedEstimate | null;
  status: 'draft' | 'estimated' | 'in_progress' | 'completed' | 'closed';
  collaborators?: ProjectCollaborator[];
  clientPortal?: ClientPortalSettings;
  closedAt?: string;
  photoCount?: number;
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
  photos?: Array<{
    uri: string;
    timestamp: string;
    note?: string;
  }>;
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
  ratePerHour?: number;
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
  baselines?: Array<{
    id: string;
    name: string;
    note?: string;
    savedAt: string;
    tasks: { id: string; startDay: number; endDay: number }[];
  }>;
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

export interface DailyFieldReport {
  id: string;
  projectId: string;
  date: string;
  weather: DFRWeather;
  manpower: ManpowerEntry[];
  workPerformed: string;
  materialsDelivered: string[];
  issuesAndDelays: string;
  photos: DFRPhoto[];
  status: DFRStatus;
  incident?: IncidentReport;
  safetyToolboxTalk?: SafetyToolboxTalk;
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

export interface Subcontractor {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  trade: SubTrade;
  licenseNumber: string;
  licenseExpiry: string;
  coiExpiry: string;
  w9OnFile: boolean;
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
  autoReviewFindings?: Array<{ criterion: string; passed: boolean; note?: string }>;
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

export type SubscriptionTier = 'free' | 'pro' | 'business';

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

export interface RFI {
  id: string;
  projectId: string;
  number: number;
  subject: string;
  question: string;
  submittedBy: string;
  assignedTo: string;
  dateSubmitted: string;
  dateRequired: string;
  dateResponded?: string;
  response?: string;
  status: RFIStatus;
  priority: RFIPriority;
  linkedDrawing?: string;
  linkedTaskId?: string;
  attachments: string[];
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

export type PermitStatus = 'applied' | 'under_review' | 'approved' | 'denied' | 'expired' | 'inspection_scheduled' | 'inspection_passed' | 'inspection_failed';
export type PermitType = 'building' | 'electrical' | 'plumbing' | 'mechanical' | 'demolition' | 'grading' | 'fire' | 'occupancy' | 'other';

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
