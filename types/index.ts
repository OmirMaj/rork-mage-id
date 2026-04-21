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
  updatedAt: string;
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

export type PunchItemStatus = 'open' | 'in_progress' | 'ready_for_review' | 'closed';
export type PunchItemPriority = 'low' | 'medium' | 'high';

export interface PunchItem {
  id: string;
  projectId: string;
  description: string;
  location: string;
  assignedSub: string;
  assignedSubId?: string;
  linkedTaskId?: string;
  linkedTaskName?: string;
  dueDate: string;
  priority: PunchItemPriority;
  status: PunchItemStatus;
  photoUri?: string;
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
  location?: string;
  tag?: string;
  linkedTaskId?: string;
  linkedTaskName?: string;
  markup?: PhotoMarkup[];
  createdAt: string;
}

export interface PhotoMarkup {
  id: string;
  type: 'arrow' | 'rectangle' | 'circle' | 'freehand' | 'text';
  color: 'red' | 'yellow' | 'green';
  points: { x: number; y: number }[];
  text?: string;
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
