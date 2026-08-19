import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project, ProjectType, AppSettings, CompanyBranding, ProjectCollaborator, ChangeOrder, Invoice, DailyFieldReport, DFRPhoto, Subcontractor, PunchItem, ProjectPhoto, PriceAlert, Contact, CommunicationEvent, RFI, Submittal, SubmittalReviewCycle, Equipment, EquipmentUtilizationEntry, PDFNamingSettings, Warranty, WarrantyClaim, PortalMessage, Commitment, PrequalPacket, PlanSheet, DrawingPin, PlanCalibration, PlanMarkup, PlanZone, PlanReview, Permit, SavedAIAPayApp, SubPortalLink, Lead, LeadStage, LeadTouch, BidPackage, BidPackageBid, BidPackageStatus, BuyoutBidStatus, OACMeeting, CertificateOfInsurance, PermitRoadmap, SendableItemKind, PortalState, FieldTicket, FieldTicketPhoto, DelayEvent, DelayEvidenceRef, DelayNotice } from '@/types';
import { sealedFieldTicketViolations } from '@/utils/fieldTicketCore';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import { track, AnalyticsEvents } from '@/utils/analytics';
import { buildCostDatabase } from '@/utils/costDatabase';
import { estimateGroundingProps } from '@/utils/activationSignals';
import { geocodeProjectLocation, shouldGeocode } from '@/utils/geocodeProject';
import { snapshotPatch } from '@/utils/estimateCommit';
import type { UserRole } from '@/utils/onboardingProfile';
import { fireGradingEvent } from '@/utils/brain/gradingBus';
import {
  applyCoScheduleReflow,
  buildUnanchoredCoAuditEntry,
  hasUnanchoredMarker,
  isCoScheduleReflowApplied,
} from '@/utils/coScheduleReflowCore';
import { appendAuditToAsyncStorage } from '@/utils/scheduleAudit';
import {
  buildPhotoStoragePath, contentTypeForExt, isDeviceLocalUri, looksLikeStoragePath, photoExtFromUri,
} from '@/utils/photoUploadCore';
import { queuePhotoUpload } from '@/utils/photoUploadQueue';
import { resolvePhotoUrls, deleteProjectPhotoObject } from '@/utils/storage';
import { warrantyStatus } from '@/utils/workflowPipelines';

// ─── Photo durability ────────────────────────────────────────────────────────
// Every image the app captures used to have its raw `file://` URI written
// straight into Postgres — `photos.uri`, `punch_items.photo_uri`,
// `daily_reports.photos[].uri`. A `file://` path is meaningless on any other
// device, after a reinstall, on web, and in the client portal, and the
// `project-photos` bucket had never received a single object as a result. For
// an app where photos are legal documentation, that is silent data loss.
//
// The two helpers below are the ONLY place a local image becomes durable, so
// every capture surface (daily report, project gallery, punch walk, cost x-ray,
// plan viewer, AI punch, photo triage) gets the same behavior:
//
//   1. the UI keeps rendering the LOCAL uri — instant, and works with no signal;
//   2. the DATABASE gets the deterministic storage path;
//   3. the bytes go on utils/photoUploadQueue.ts, which uploads them whenever
//      the network next allows and never drops them if it can't.
//
// Nothing here is awaited on the render path.

/**
 * Stage a device-local image for durable upload and return the path the
 * database should store. Returns null when there's nothing to do (no session,
 * no image, or the URI is already remote).
 */
function stagePhotoUpload(opts: {
  userId: string | null | undefined;
  projectId: string;
  /** Object key within the project folder — the record's id, so the path is deterministic. */
  recordId: string;
  localUri: string | undefined;
}): string | null {
  const { userId, projectId, recordId, localUri } = opts;
  if (!userId || !projectId || !recordId || !localUri) return null;
  if (!isDeviceLocalUri(localUri)) return null;
  const ext = photoExtFromUri(localUri);
  const storagePath = buildPhotoStoragePath(userId, projectId, recordId, ext);
  void queuePhotoUpload({
    photoId: recordId, userId, projectId, localUri, storagePath,
    contentType: contentTypeForExt(ext),
  });
  return storagePath;
}

/**
 * The value a photo column must be given. Never a `file://` — if we have no
 * durable path yet, an empty string is strictly better than a URI that is
 * guaranteed to be unopenable everywhere except the device that wrote it
 * (consumers such as portalSnapshot already filter empty photo URLs out).
 */
function durablePhotoValue(storagePath: string | undefined, currentUri: string | undefined): string {
  if (storagePath) return storagePath;
  if (currentUri && !isDeviceLocalUri(currentUri)) return currentUri;
  return '';
}

/**
 * The `daily_reports.photos` JSON column, sanitized for the server: durable
 * path in `uri`, and `localUri` stripped entirely — it describes one device's
 * filesystem and has no business being replicated to everyone else's.
 */
function dfrPhotoRows(photos: DFRPhoto[] | undefined): DFRPhoto[] {
  return (photos ?? []).map((p) => {
    const { localUri: _localUri, ...rest } = p;
    return { ...rest, uri: durablePhotoValue(p.storagePath, p.uri) };
  });
}

/**
 * Turn stored photo columns back into something renderable.
 *
 * `photos.uri` holds a bucket path, and `project-photos` is private, so it has
 * to be signed. We sign in ONE batched request per query and prefer this
 * device's own local copy whenever it still has one — that keeps the gallery
 * instant and keeps it working offline, and it means an expired signature can
 * never blank out a photo the user took themselves.
 */
async function buildPhotoUrlResolver(storedValues: (string | undefined)[]): Promise<(stored: string | undefined, localUri?: string) => { uri: string; storagePath?: string }> {
  const paths = storedValues.filter((v): v is string => looksLikeStoragePath(v));
  const signed = paths.length > 0 ? await resolvePhotoUrls(paths) : new Map<string, string>();
  return (stored, localUri) => {
    const storagePath = looksLikeStoragePath(stored) ? stored : undefined;
    if (localUri) return { uri: localUri, storagePath };
    if (storagePath) return { uri: signed.get(storagePath) ?? '', storagePath };
    // Legacy rows (and the handful of dev rows that still hold a `file://`)
    // pass through untouched — no migration, no behavior change for them.
    return { uri: stored ?? '', storagePath: undefined };
  };
}

const PROJECTS_KEY = 'mageid_projects';
const SETTINGS_KEY = 'mageid_settings';
const ONBOARDING_KEY = 'mageid_onboarding_complete';
const USER_ROLE_KEY = 'mageid_user_role';
const LEADS_KEY = 'mageid_leads';
const BID_PACKAGES_KEY = 'mageid_bid_packages';
const BID_PACKAGE_BIDS_KEY = 'mageid_bid_package_bids';
const CHANGE_ORDERS_KEY = 'mageid_change_orders';
const INVOICES_KEY = 'mageid_invoices';
const DAILY_REPORTS_KEY = 'mageid_daily_reports';
const FIELD_TICKETS_KEY = 'mageid_field_tickets';
const DELAY_EVENTS_KEY = 'mageid_delay_events';
const SUBS_KEY = 'mageid_subcontractors';
const PUNCH_ITEMS_KEY = 'mageid_punch_items';
const PHOTOS_KEY = 'mageid_photos';
const PRICE_ALERTS_KEY = 'mageid_price_alerts';
const CONTACTS_KEY = 'mageid_contacts';
const COMM_EVENTS_KEY = 'mageid_comm_events';
const RFIS_KEY = 'mageid_rfis';
const SUBMITTALS_KEY = 'mageid_submittals';
const OAC_MEETINGS_KEY = 'mageid_oac_meetings';
const COIS_KEY = 'mageid_cois';
const EQUIPMENT_KEY = 'mageid_equipment';
const WARRANTIES_KEY = 'mageid_warranties';
const PORTAL_MESSAGES_KEY = 'mageid_portal_messages';
const COMMITMENTS_KEY = 'mageid_commitments';
const PREQUAL_KEY = 'mageid_prequal_packets';
const DRAWING_PINS_KEY = 'mageid_drawing_pins';
const PLAN_CALIBRATIONS_KEY = 'mageid_plan_calibrations';
const PLAN_SHEETS_KEY = 'mageid_plan_sheets';
const PLAN_MARKUPS_KEY = 'mageid_plan_markups';
const PLAN_ZONES_KEY = 'mageid_plan_zones';
const PLAN_REVIEWS_KEY = 'mageid_plan_reviews';
const PLAN_ROADMAPS_KEY = 'mageid_plan_roadmaps';
const PERMITS_KEY = 'mageid_permits';
const AIA_PAY_APPS_KEY = 'mageid_aia_pay_apps';
const SUB_PORTAL_LINKS_KEY = 'mageid_sub_portal_links';

const DEFAULT_BRANDING: CompanyBranding = {
  companyName: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  licenseNumber: '',
  tagline: '',
  logoUri: undefined,
  signatureData: undefined,
};

const DEFAULT_SETTINGS: AppSettings = {
  location: 'United States',
  units: 'imperial',
  taxRate: 7.5,
  contingencyRate: 10,
  branding: DEFAULT_BRANDING,
};

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function saveLocal(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.log('[ProjectContext] Local save failed for', key, err);
  }
}

// ─── Per-bucket context objects ───────────────────────────────────────────────
// Each holds exactly the slice of useProjects() keys assigned to its bucket by
// docs/superpowers/audits/2026-05-18-h5-context-key-map.md.
// All default to null; the provider below fills every one before children render.

type CoreDataValue = {
  projects: Project[];
  settings: AppSettings;
  hasSeenOnboarding: boolean | null;
  /** Marketplace persona. `null` while the profile query is still hydrating
   *  on cold boot; `undefined`-as-stored-value means the user has not yet
   *  picked one (route them to /persona-select). */
  userRole: UserRole | null;
  isLoading: boolean;
  /** True once projects have hydrated from storage/network. Distinguishes
   *  "still loading" from "not found" for deep-linked detail screens. */
  projectsLoaded: boolean;
  addProject: (project: Project) => void;
  updateProject: (id: string, updates: Partial<Project>) => void;
  deleteProject: (id: string) => void;
  getProject: (id: string) => Project | null;
  updateSettings: (updates: Partial<AppSettings>) => void;
  addCollaborator: (projectId: string, collab: ProjectCollaborator) => void;
  removeCollaborator: (projectId: string, collabId: string) => void;
  priceAlerts: PriceAlert[];
  addPriceAlert: (alert: PriceAlert) => void;
  updatePriceAlert: (id: string, updates: Partial<PriceAlert>) => void;
  deletePriceAlert: (id: string) => void;
  contacts: Contact[];
  addContact: (contact: Contact) => void;
  updateContact: (id: string, updates: Partial<Contact>) => void;
  deleteContact: (id: string) => void;
  getContact: (id: string) => Contact | null;
  commEvents: CommunicationEvent[];
  addCommEvent: (event: CommunicationEvent) => void;
  getCommEventsForProject: (projectId: string) => CommunicationEvent[];
};

type FinancialsDataValue = {
  changeOrders: ChangeOrder[];
  addChangeOrder: (co: ChangeOrder) => void;
  addChangeOrders: (cos: ChangeOrder[]) => void;
  getChangeOrdersForProject: (projectId: string) => ChangeOrder[];
  addInvoice: (invoice: Invoice) => void;
  updateInvoice: (id: string, updates: Partial<Invoice>) => void;
  getInvoicesForProject: (projectId: string) => Invoice[];
  getTotalOutstandingBalance: () => number;
  invoices: Invoice[];
  commitments: Commitment[];
  addCommitment: (c: Commitment) => void;
  updateCommitment: (id: string, updates: Partial<Commitment>) => void;
  deleteCommitment: (id: string) => void;
  getCommitmentsForProject: (projectId: string) => Commitment[];
  prequalPackets: PrequalPacket[];
  upsertPrequalPacket: (packet: PrequalPacket) => void;
  deletePrequalPacket: (id: string) => void;
  getPrequalPacketForSub: (subId: string) => PrequalPacket | null;
  getPrequalPacketByToken: (token: string) => PrequalPacket | null;
  aiaPayApps: SavedAIAPayApp[];
  addAIAPayApp: (app: SavedAIAPayApp) => SavedAIAPayApp;
  deleteAIAPayApp: (id: string) => void;
  getAIAPayAppsForProject: (projectId: string) => SavedAIAPayApp[];
  // Delay register — the claim-defense spine. Sits with change orders rather
  // than the field tables because it is claim material (causation, dollar
  // reservations, the GC's own contractor_caused admissions) and its RLS
  // mirrors change_orders for exactly that reason.
  delayEvents: DelayEvent[];
  addDelayEvent: (event: DelayEvent) => DelayEvent;
  updateDelayEvent: (id: string, updates: Partial<DelayEvent>) => void;
  deleteDelayEvent: (id: string) => void;
  getDelayEventsForProject: (projectId: string) => DelayEvent[];
};

type FieldDataValue = {
  dailyReports: DailyFieldReport[];
  getDailyReportsForProject: (projectId: string) => DailyFieldReport[];
  // T&M / extra-work field tickets. `updateFieldTicket` REFUSES content edits
  // once a ticket is signed — see utils/fieldTicketCore.sealedFieldTicketViolations.
  fieldTickets: FieldTicket[];
  addFieldTicket: (ticket: FieldTicket) => void;
  updateFieldTicket: (id: string, updates: Partial<FieldTicket>) => boolean;
  getFieldTicketsForProject: (projectId: string) => FieldTicket[];
  punchItems: PunchItem[];
  addPunchItem: (item: PunchItem) => void;
  addPunchItems: (items: PunchItem[]) => void;
  updatePunchItem: (id: string, updates: Partial<PunchItem>) => void;
  deletePunchItem: (id: string) => void;
  getPunchItemsForProject: (projectId: string) => PunchItem[];
  projectPhotos: ProjectPhoto[];
  addProjectPhoto: (photo: ProjectPhoto) => void;
  updateProjectPhoto: (id: string, updates: Partial<ProjectPhoto>) => void;
  deleteProjectPhoto: (id: string) => void;
  getPhotosForProject: (projectId: string) => ProjectPhoto[];
  equipment: Equipment[];
  addEquipment: (equip: Omit<Equipment, 'id' | 'createdAt'>) => void;
  updateEquipment: (id: string, updates: Partial<Equipment>) => void;
  deleteEquipment: (id: string) => void;
  logUtilization: (entry: Omit<EquipmentUtilizationEntry, 'id'>) => void;
  getEquipmentForProject: (projectId: string) => Equipment[];
  getEquipmentCostForProject: (projectId: string) => number;
  planSheets: PlanSheet[];
  addPlanSheet: (sheet: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>) => PlanSheet;
  updatePlanSheet: (id: string, updates: Partial<PlanSheet>) => void;
  deletePlanSheet: (id: string) => void;
  getPlanSheetsForProject: (projectId: string) => PlanSheet[];
  getPlanSheet: (id: string) => PlanSheet | undefined;
  drawingPins: DrawingPin[];
  addDrawingPin: (pin: Omit<DrawingPin, 'id' | 'createdAt' | 'updatedAt'>) => DrawingPin;
  updateDrawingPin: (id: string, updates: Partial<DrawingPin>) => void;
  deleteDrawingPin: (id: string) => void;
  getPinsForPlan: (planSheetId: string) => DrawingPin[];
  getPinsForPhoto: (photoId: string) => DrawingPin[];
  planZones: PlanZone[];
  addPlanZone: (zone: Omit<PlanZone, 'id' | 'createdAt' | 'updatedAt'>) => PlanZone;
  updatePlanZone: (id: string, patch: Partial<PlanZone>) => void;
  deletePlanZone: (id: string) => void;
  getPlanZonesForPlan: (planSheetId: string) => PlanZone[];
  getPlanZonesForProject: (projectId: string) => PlanZone[];
  planReviews: PlanReview[];
  getPlanReviewForSheet: (planSheetId: string) => PlanReview | null;
  savePlanReview: (review: PlanReview) => void;
  updatePlanReview: (id: string, patch: Partial<PlanReview>) => void;
  deletePlanReview: (id: string) => void;
  planMarkups: PlanMarkup[];
  addPlanMarkup: (markup: Omit<PlanMarkup, 'id' | 'createdAt'>) => PlanMarkup;
  deletePlanMarkup: (id: string) => void;
  getMarkupsForPlan: (planSheetId: string) => PlanMarkup[];
  planCalibrations: PlanCalibration[];
  upsertPlanCalibration: (cal: Omit<PlanCalibration, 'id' | 'createdAt'>) => PlanCalibration;
  getCalibrationForPlan: (planSheetId: string) => PlanCalibration | undefined;
  permitRoadmaps: PermitRoadmap[];
  getPermitRoadmapForProject: (projectId: string) => PermitRoadmap | undefined;
  savePermitRoadmap: (roadmap: PermitRoadmap) => void;
  updatePermitRoadmap: (id: string, patch: Partial<PermitRoadmap>) => void;
  deletePermitRoadmap: (id: string) => void;
};

type PreconDataValue = {
  subcontractors: Subcontractor[];
  addSubcontractor: (sub: Subcontractor) => void;
  updateSubcontractor: (id: string, updates: Partial<Subcontractor>) => void;
  deleteSubcontractor: (id: string) => void;
  getSubcontractor: (id: string) => Subcontractor | null;
  leads: Lead[];
  addLead: (lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'receivedAt'> & { id?: string; receivedAt?: string }) => Lead;
  updateLead: (id: string, updates: Partial<Lead>) => void;
  deleteLead: (id: string) => void;
  getLead: (id: string) => Lead | null;
  getLeadsByStage: (stage: LeadStage) => Lead[];
  addLeadTouch: (leadId: string, kind: LeadTouch['kind'], body: string, byName?: string) => void;
  bidPackages: BidPackage[];
  bidPackageBids: BidPackageBid[];
  addBidPackage: (pkg: Omit<BidPackage, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => BidPackage;
  updateBidPackage: (id: string, updates: Partial<BidPackage>) => void;
  deleteBidPackage: (id: string) => void;
  getBidPackagesForProject: (projectId: string) => BidPackage[];
  getBidPackage: (id: string) => BidPackage | null;
  addBidPackageBid: (bid: Omit<BidPackageBid, 'id' | 'createdAt' | 'updatedAt' | 'submittedAt'> & { id?: string; submittedAt?: string }) => BidPackageBid;
  updateBidPackageBid: (id: string, updates: Partial<BidPackageBid>) => void;
  deleteBidPackageBid: (id: string) => void;
  getBidsForPackage: (packageId: string) => BidPackageBid[];
  cois: CertificateOfInsurance[];
  addCOI: (coi: CertificateOfInsurance) => void;
  updateCOI: (id: string, patch: Partial<CertificateOfInsurance>) => void;
  deleteCOI: (id: string) => void;
  getCOIsForSub: (subId: string) => CertificateOfInsurance[];
};

type DocsDataValue = {
  rfis: RFI[];
  addRFI: (rfi: Omit<RFI, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => RFI;
  addRFIs: (rfis: RFI[]) => void;
  updateRFI: (id: string, updates: Partial<RFI>) => void;
  deleteRFI: (id: string) => void;
  getRFIsForProject: (projectId: string) => RFI[];
  permits: Permit[];
  addPermit: (permit: Omit<Permit, 'id' | 'createdAt' | 'updatedAt'>) => Permit;
  updatePermit: (id: string, updates: Partial<Permit>) => void;
  deletePermit: (id: string) => void;
  getPermitsForProject: (projectId: string) => Permit[];
  subPortalLinks: SubPortalLink[];
  upsertSubPortalLink: (link: SubPortalLink) => SubPortalLink;
  deleteSubPortalLink: (id: string) => void;
  getSubPortalLinkFor: (projectId: string, subcontractorId: string) => SubPortalLink | undefined;
  getSubPortalLinksForProject: (projectId: string) => SubPortalLink[];
  submittals: Submittal[];
  addSubmittal: (sub: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => void;
  addSubmittals: (subs: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>[]) => void;
  updateSubmittal: (id: string, updates: Partial<Submittal>) => void;
  deleteSubmittal: (id: string) => void;
  getSubmittalsForProject: (projectId: string) => Submittal[];
  addReviewCycle: (submittalId: string, cycle: Omit<SubmittalReviewCycle, 'cycleNumber'>) => void;
  oacMeetings: OACMeeting[];
  addOACMeeting: (meeting: OACMeeting) => void;
  updateOACMeeting: (id: string, patch: Partial<OACMeeting>) => void;
  deleteOACMeeting: (id: string) => void;
  getOACMeetingsForProject: (projectId: string) => OACMeeting[];
  warranties: Warranty[];
  addWarranty: (w: Omit<Warranty, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'claims'> & { id?: string; status?: Warranty['status']; claims?: WarrantyClaim[] }) => Warranty;
  updateWarranty: (id: string, updates: Partial<Warranty>) => void;
  deleteWarranty: (id: string) => void;
  getWarrantiesForProject: (projectId: string) => Warranty[];
  addWarrantyClaim: (warrantyId: string, claim: Omit<WarrantyClaim, 'id'>) => void;
  portalMessages: PortalMessage[];
  addPortalMessage: (msg: Omit<PortalMessage, 'id' | 'createdAt'>) => PortalMessage;
  markPortalMessagesRead: (projectId: string, side: 'gc' | 'client') => void;
  getPortalMessagesForProject: (projectId: string) => PortalMessage[];
  getUnreadPortalMessageCount: (projectId: string, side: 'gc' | 'client') => number;
  getTotalUnreadPortalCountForGc: () => number;
};

type StableActionsValue = {
  completeOnboarding: () => Promise<void>;
  /** Set or change the user's marketplace persona. Writes to AsyncStorage
   *  immediately (so the root layout's gate stops bouncing them to
   *  /persona-select) and mirrors to `public.profiles.user_role` server-side
   *  when online. */
  setUserRole: (role: UserRole) => Promise<void>;
};

/** Extra intent a caller can attach to a change-order update that approves it.
 *  `anchorTaskId` is the task the user chose (in the reflow preview) to absorb
 *  the CO's schedule impact days; it also lets a GC place the days on a CO that
 *  was approved remotely — through the client portal, say — and had no
 *  identifiable anchor at the time. See utils/coScheduleReflowCore.ts. */
export type ChangeOrderReflowIntent = { anchorTaskId?: string };

type CrossDomainValue = {
  updateChangeOrder: (id: string, updates: Partial<ChangeOrder>, reflow?: ChangeOrderReflowIntent) => void;
  addDailyReport: (report: DailyFieldReport) => void;
  updateDailyReport: (id: string, updates: Partial<DailyFieldReport>) => void;
  convertLeadToProject: (leadId: string) => string | null;
  awardBidPackage: (packageId: string, bidId: string) => string | null;
  sendToClientPortal: (args: { kind: SendableItemKind; itemId: string; projectId: string }) => Promise<void>;
  recallFromClientPortal: (args: { kind: SendableItemKind; itemId: string; projectId: string }) => Promise<void>;
  batchSendToClientPortal: (args: { items: { kind: SendableItemKind; itemId: string }[]; projectId: string }) => Promise<{ sent: number }>;
  importData: (payload: { projects?: Project[]; contacts?: Contact[]; subcontractors?: Subcontractor[] }) => { projects: number; contacts: number; subcontractors: number };
};

const CoreDataContext = createContext<CoreDataValue | null>(null);
const FinancialsDataContext = createContext<FinancialsDataValue | null>(null);
const FieldDataContext = createContext<FieldDataValue | null>(null);
const PreconDataContext = createContext<PreconDataValue | null>(null);
const DocsDataContext = createContext<DocsDataValue | null>(null);
const StableActionsContext = createContext<StableActionsValue | null>(null);
const CrossDomainContext = createContext<CrossDomainValue | null>(null);

// ─── Inner provider (holds the full hook body verbatim) ───────────────────────
function ProjectProviderInner({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [projects, setProjects] = useState<Project[]>([]);
  // True once the projects query has settled AND local state has been hydrated
  // from it. Screens use this to tell "still loading" apart from "genuinely not
  // found" — getProject(id) returns null in BOTH cases, so a cold deep-link
  // would otherwise flash a false "Project not found" for a frame.
  const [projectsLoaded, setProjectsLoaded] = useState<boolean>(false);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);
  const [userRole, setUserRoleState] = useState<UserRole | null>(null);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [bidPackages, setBidPackages] = useState<BidPackage[]>([]);
  const [bidPackageBids, setBidPackageBids] = useState<BidPackageBid[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [prequalPackets, setPrequalPackets] = useState<PrequalPacket[]>([]);
  const [dailyReports, setDailyReports] = useState<DailyFieldReport[]>([]);
  const [fieldTickets, setFieldTickets] = useState<FieldTicket[]>([]);
  const [delayEvents, setDelayEvents] = useState<DelayEvent[]>([]);
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [punchItems, setPunchItems] = useState<PunchItem[]>([]);
  // Mirror of `punchItems` (see submittalsRef note below) so batch adds looped
  // synchronously read the just-inserted rows instead of a stale render closure
  // — otherwise each setState clobbers the previous and only the last survives.
  const punchItemsRef = useRef<PunchItem[]>([]);
  useEffect(() => { punchItemsRef.current = punchItems; }, [punchItems]);
  const [projectPhotos, setProjectPhotos] = useState<ProjectPhoto[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [commEvents, setCommEvents] = useState<CommunicationEvent[]>([]);
  const [rfis, setRfis] = useState<RFI[]>([]);
  // Mirror of `rfis` (see submittalsRef note below) so batch adds looped
  // synchronously assign advancing per-project numbers off the just-inserted
  // rows instead of recomputing from a stale closure (which collides all rows
  // on the same number and drops all but the last on setState).
  const rfisRef = useRef<RFI[]>([]);
  useEffect(() => { rfisRef.current = rfis; }, [rfis]);
  const [submittals, setSubmittals] = useState<Submittal[]>([]);
  // Mirror of `submittals` kept in sync so add handlers called repeatedly in a
  // single synchronous loop (e.g. extract-submittals bulk save, dev-seeder)
  // read the just-inserted rows instead of a stale render closure — otherwise
  // every iteration computes the same nextNumber and each setState clobbers the
  // previous, so only the last row survives.
  const submittalsRef = useRef<Submittal[]>([]);
  useEffect(() => { submittalsRef.current = submittals; }, [submittals]);
  const [oacMeetings, setOacMeetings] = useState<OACMeeting[]>([]);
  const [cois, setCois] = useState<CertificateOfInsurance[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [warranties, setWarranties] = useState<Warranty[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [aiaPayApps, setAiaPayApps] = useState<SavedAIAPayApp[]>([]);
  const [subPortalLinks, setSubPortalLinks] = useState<SubPortalLink[]>([]);
  const syncDebounceMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const canSync = !!userId && isSupabaseConfigured;

  const projectsQuery = useQuery({
    queryKey: ['projects', userId],
    queryFn: async () => {
      console.log('[ProjectContext] Loading projects');
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('projects')
            .select('*')
            .order('updated_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, name: r.name as string, type: r.type as string,
              location: (r.location as string) ?? '', squareFootage: Number(r.square_footage) || 0,
              quality: (r.quality as string) ?? 'standard', description: (r.description as string) ?? '',
              locationLatitude: r.location_latitude != null ? Number(r.location_latitude) : undefined,
              locationLongitude: r.location_longitude != null ? Number(r.location_longitude) : undefined,
              locationGeocodedAt: (r.location_geocoded_at as string | null) ?? undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              estimate: r.estimate as Project['estimate'], schedule: r.schedule as Project['schedule'],
              linkedEstimate: r.linked_estimate as Project['linkedEstimate'],
              estimateVersions: r.estimate_versions as Project['estimateVersions'],
              status: (r.status as Project['status']) ?? 'draft',
              collaborators: r.collaborators as ProjectCollaborator[] ?? [],
              scope: (r.scope ?? undefined) as Project['scope'],
              clientPortal: r.client_portal as Project['clientPortal'],
              targetBudget: r.target_budget as Project['targetBudget'],
              primaryContact: (r.primary_contact as Project['primaryContact']) ?? undefined,
              leadSource: (r.lead_source as string | null) ?? undefined,
              targetTimelineNotes: (r.target_timeline_notes as string | null) ?? undefined,
              handoverChecklist: (r.handover_checklist as Record<string, string> | null) ?? {},
              closedAt: r.closed_at as string | undefined,
              substantialCompletionDate: r.substantial_completion_date as string | undefined,
              warrantyWalkCompletedAt: r.warranty_walk_completed_at as string | undefined,
              photoCount: Number(r.photo_count) || 0,
            })) as Project[];
            // Merge in any local-only projects the server doesn't have yet — a
            // just-created project whose async Supabase upsert hasn't committed,
            // or an offline-created one. A server-first load must NEVER silently
            // drop them (that's what made the demo seeder's project — and any
            // offline-created project — vanish on the next reload).
            const localForMerge = await loadLocal<Project[]>(PROJECTS_KEY, []);
            const remoteIds = new Set(mapped.map((p) => p.id));
            const merged = [...mapped, ...localForMerge.filter((p) => !remoteIds.has(p.id))];
            await saveLocal(PROJECTS_KEY, merged);
            return merged;
          }
        } catch (err) {
          console.log('[ProjectContext] Supabase fetch failed, falling back to local:', err);
        }
      }
      return loadLocal<Project[]>(PROJECTS_KEY, []);
    },
  });

  const settingsQuery = useQuery({
    queryKey: ['settings', userId],
    queryFn: async () => {
      console.log('[ProjectContext] Loading settings');
      if (canSync) {
        try {
          const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
          if (!error && data) {
            const s: AppSettings = {
              location: (data.location as string) ?? 'United States',
              units: ((data.units as string) ?? 'imperial') as 'imperial' | 'metric',
              taxRate: Number(data.tax_rate) || 7.5,
              contingencyRate: Number(data.contingency_rate) || 10,
              branding: {
                companyName: (data.company_name as string) ?? '', contactName: (data.contact_name as string) ?? '',
                email: (data.email as string) ?? '', phone: (data.phone as string) ?? '',
                address: (data.address as string) ?? '', licenseNumber: (data.license_number as string) ?? '',
                tagline: (data.tagline as string) ?? '', logoUri: data.logo_uri as string | undefined,
                signatureData: data.signature_data as string[] | undefined,
              },
              themeColors: data.theme_colors as AppSettings['themeColors'],
              biometricsEnabled: data.biometrics_enabled as boolean,
              dfrRecipients: data.dfr_recipients as string[],
              digest: {
                enabled: !!data.digest_enabled,
                hour: (data.digest_hour as number | null) ?? 6,
                timezone: (data.digest_timezone as string | null) ?? 'America/New_York',
                channels: ((data.digest_channels as { email?: boolean; in_app?: boolean } | null) ?? { email: true, in_app: true }) as { email: boolean; in_app: boolean },
              },
              financing: data.financing as AppSettings['financing'],
            };
            await saveLocal(SETTINGS_KEY, s);
            return s;
          }
        } catch (err) {
          console.log('[ProjectContext] Supabase settings fetch failed:', err);
        }
      }
      return loadLocal<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
    },
  });

  const changeOrdersQuery = useQuery({
    queryKey: ['changeOrders', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('change_orders').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, number: Number(r.number), projectId: r.project_id as string,
              date: r.date as string, description: (r.description as string) ?? '',
              reason: (r.reason as string) ?? '', lineItems: r.line_items as ChangeOrder['lineItems'],
              originalContractValue: Number(r.original_contract_value), changeAmount: Number(r.change_amount),
              newContractTotal: Number(r.new_contract_total), status: r.status as ChangeOrder['status'],
              approvers: r.approvers as ChangeOrder['approvers'], approvalMode: r.approval_mode as ChangeOrder['approvalMode'],
              approvalDeadlineDays: r.approval_deadline_days as number | undefined,
              auditTrail: r.audit_trail as ChangeOrder['auditTrail'], revision: Number(r.revision) || 1,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as ChangeOrder[];
            await saveLocal(CHANGE_ORDERS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<ChangeOrder[]>(CHANGE_ORDERS_KEY, []);
    },
  });

  const invoicesQuery = useQuery({
    queryKey: ['invoices', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, number: Number(r.number), projectId: r.project_id as string,
              type: r.type as Invoice['type'], progressPercent: r.progress_percent as number | undefined,
              issueDate: r.issue_date as string, dueDate: r.due_date as string,
              paymentTerms: r.payment_terms as Invoice['paymentTerms'], notes: (r.notes as string) ?? '',
              lineItems: r.line_items as Invoice['lineItems'], subtotal: Number(r.subtotal),
              taxRate: Number(r.tax_rate), taxAmount: Number(r.tax_amount), totalDue: Number(r.total_due),
              amountPaid: Number(r.amount_paid), status: r.status as Invoice['status'],
              payments: r.payments as Invoice['payments'], createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              // Hydrate every persisted field the mapper used to drop — otherwise a
              // refetch wiped retention (A/R money) + pay links (no DB copy) and
              // blanked portal/qbo state in memory. numeric columns come back as
              // strings from PostgREST, so wrap in Number().
              retentionPercent: r.retention_percent == null ? undefined : Number(r.retention_percent),
              retentionAmount: r.retention_amount == null ? undefined : Number(r.retention_amount),
              retentionReleased: r.retention_released == null ? undefined : Number(r.retention_released),
              retentionReleases: (r.retention_releases as Invoice['retentionReleases']) ?? undefined,
              payLinkUrl: (r.pay_link_url as string | null) ?? undefined,
              payLinkId: (r.pay_link_id as string | null) ?? undefined,
              portalState: (r.portal_state as Invoice['portalState']) ?? undefined,
              qboId: (r.qbo_id as string | null) ?? undefined,
              qboHash: (r.qbo_hash as string | null) ?? undefined,
              qboSyncedAt: (r.qbo_synced_at as string | null) ?? undefined,
              qboSyncStatus: (r.qbo_sync_status as Invoice['qboSyncStatus']) ?? undefined,
              qboError: (r.qbo_error as string | null) ?? undefined,
              qboRetryCount: r.qbo_retry_count == null ? undefined : Number(r.qbo_retry_count),
              // Contract-milestone link (the invoice-side half of the
              // double-bill guard) + dunning markers. The dunning columns are
              // written ONLY by the invoice-dunning edge fn; the app reads them
              // so the invoice screen can state "Reminder sent · Stage 2 ·
              // Nov 14" instead of the GC guessing whether the client was
              // already chased.
              sourceMilestoneId: (r.source_milestone_id as string | null) ?? undefined,
              sourceContractId: (r.source_contract_id as string | null) ?? undefined,
              dunningStage: r.dunning_stage == null ? undefined : Number(r.dunning_stage),
              dunningLastSentAt: (r.dunning_last_sent_at as string | null) ?? undefined,
            })) as Invoice[];
            await saveLocal(INVOICES_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Invoice[]>(INVOICES_KEY, []);
    },
  });

  // Commitments — signed subs/POs for job costing. Now cloud-backed
  // via the public.commitments table (added in the t1.1 audit-fix
  // migration). Read pattern: try Supabase, fall back to AsyncStorage if
  // cloud read fails or returns empty (offline / fresh-install paths).
  const commitmentsQuery = useQuery({
    queryKey: ['commitments', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('commitments').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string,
              number: (r.number as string) ?? '', type: r.type as Commitment['type'],
              subcontractorId: (r.subcontractor_id as string | null) ?? undefined,
              vendorName: (r.vendor_name as string | null) ?? undefined,
              description: (r.description as string) ?? '',
              amount: Number(r.amount) || 0,
              changeAmount: r.change_amount == null ? undefined : Number(r.change_amount),
              signedDate: (r.signed_date as string | null) ?? '',
              phase: (r.phase as string | null) ?? undefined,
              csiDivision: (r.csi_division as string | null) ?? undefined,
              linkedEstimateItems: (r.linked_estimate_items as string[] | null) ?? undefined,
              status: r.status as Commitment['status'],
              notes: (r.notes as string | null) ?? undefined,
              paidToDate: r.paid_to_date == null ? 0 : Number(r.paid_to_date),
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Commitment[];
            await saveLocal(COMMITMENTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Commitment[]>(COMMITMENTS_KEY, []);
    },
  });

  // Prequal packets — one per subcontractor. Magic-link token lives on
  // the packet; the sub's /prequal-form route looks the packet up by
  // token. Cloud-backed as of the t1.1 migration.
  const prequalQuery = useQuery({
    queryKey: ['prequalPackets', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('prequal_packets').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              subcontractorId: r.subcontractor_id as string,
              projectId: (r.project_id as string | null) ?? undefined,
              status: r.status as PrequalPacket['status'],
              criteria: (r.criteria as PrequalPacket['criteria']) ?? {} as PrequalPacket['criteria'],
              financials: (r.financials as PrequalPacket['financials']) ?? {} as PrequalPacket['financials'],
              safety: (r.safety as PrequalPacket['safety']) ?? {} as PrequalPacket['safety'],
              insurance: (r.insurance as PrequalPacket['insurance']) ?? {} as PrequalPacket['insurance'],
              licenses: (r.licenses as PrequalPacket['licenses']) ?? [],
              w9OnFile: !!r.w9_on_file,
              w9DocPath: (r.w9_doc_path as string | null) ?? undefined,
              inviteToken: (r.invite_token as string | null) ?? undefined,
              inviteSentAt: (r.invite_sent_at as string | null) ?? undefined,
              inviteEmail: (r.invite_email as string | null) ?? undefined,
              submittedAt: (r.submitted_at as string | null) ?? undefined,
              reviewedAt: (r.reviewed_at as string | null) ?? undefined,
              reviewedBy: (r.reviewed_by as string | null) ?? undefined,
              autoReviewFindings: (r.auto_review_findings as PrequalPacket['autoReviewFindings']) ?? undefined,
              reviewerNotes: (r.reviewer_notes as string | null) ?? undefined,
              expiresAt: (r.expires_at as string | null) ?? undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as PrequalPacket[];
            await saveLocal(PREQUAL_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<PrequalPacket[]>(PREQUAL_KEY, []);
    },
  });

  const dailyReportsQuery = useQuery({
    queryKey: ['dailyReports', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('daily_reports').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            // A DFR's photos are a nested JSON array whose `uri` values are now
            // bucket paths. Flatten every path across every report so the whole
            // page costs ONE signing round trip, and keep this device's local
            // originals (see photosQuery for the rationale).
            const dfrLocalUri = new Map<string, string>();
            for (const dr of await loadLocal<DailyFieldReport[]>(DAILY_REPORTS_KEY, [])) {
              for (const p of dr.photos ?? []) {
                const local = p.localUri ?? (isDeviceLocalUri(p.uri) ? p.uri : undefined);
                if (local) dfrLocalUri.set(p.id, local);
              }
            }
            const resolveDfrPhoto = await buildPhotoUrlResolver(
              data.flatMap(r => ((r.photos as DFRPhoto[] | null) ?? [])
                .filter(p => p && !dfrLocalUri.has(p.id))
                .map(p => p.uri)),
            );
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, date: r.date as string,
              weather: r.weather as DailyFieldReport['weather'], manpower: r.manpower as DailyFieldReport['manpower'],
              workPerformed: (r.work_performed as string) ?? '', materialsDelivered: (r.materials_delivered as string[]) ?? [],
              issuesAndDelays: (r.issues_and_delays as string) ?? '',
              photos: (((r.photos as DFRPhoto[] | null) ?? []).map((p) => {
                const localUri = dfrLocalUri.get(p.id);
                const { uri, storagePath } = resolveDfrPhoto(p.uri, localUri);
                return { ...p, uri, storagePath, localUri };
              })) as DailyFieldReport['photos'],
              status: (r.status as DailyFieldReport['status']) ?? 'draft',
              incident: (r.incident as DailyFieldReport['incident']) ?? undefined,
              workProgress: (r.work_progress as DailyFieldReport['workProgress']) ?? undefined,
              homeownerSummary: (r.homeowner_summary as string | null) ?? undefined,
              homeownerSummaryGeneratedAt: (r.homeowner_summary_generated_at as string | null) ?? undefined,
              homeownerSummaryPublished: !!r.homeowner_summary_published,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as DailyFieldReport[];
            // leakScan is a local-only field (no supabase column). Merge it
            // forward from AsyncStorage so rehydration never wipes a scan the
            // user performed while online. Without this merge, every sync call
            // overwrites the local copy — the one that held leakScan — with
            // the Supabase rows (which lack the field), silently clearing it.
            const prior = await loadLocal<DailyFieldReport[]>(DAILY_REPORTS_KEY, []);
            const priorById = new Map(prior.map(dr => [dr.id, dr]));
            const withLeakScan = mapped.map(dr => {
              const localLeakScan = priorById.get(dr.id)?.leakScan;
              return localLeakScan !== undefined ? { ...dr, leakScan: localLeakScan } : dr;
            });
            await saveLocal(DAILY_REPORTS_KEY, withLeakScan);
            return withLeakScan;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<DailyFieldReport[]>(DAILY_REPORTS_KEY, []);
    },
  });

  // T&M / extra-work field tickets. Same server-first-then-local shape as the
  // DFR query, including the photo-URL resolution: the persisted `uri` is a
  // bucket PATH, so it has to be signed before anything can render it, and this
  // device's local originals win so an offline capture never gets replaced by a
  // path it has no session to open.
  const fieldTicketsQuery = useQuery({
    queryKey: ['fieldTickets', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('field_tickets').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const localUriById = new Map<string, string>();
            for (const t of await loadLocal<FieldTicket[]>(FIELD_TICKETS_KEY, [])) {
              for (const p of t.photos ?? []) {
                const local = p.localUri ?? (isDeviceLocalUri(p.uri) ? p.uri : undefined);
                if (local) localUriById.set(p.id, local);
              }
            }
            const resolveTicketPhoto = await buildPhotoUrlResolver(
              data.flatMap(r => ((r.photos as FieldTicketPhoto[] | null) ?? [])
                .filter(p => p && !localUriById.has(p.id))
                .map(p => p.uri)),
            );
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, number: Number(r.number), projectId: r.project_id as string,
              date: r.date as string,
              workDescription: (r.work_description as string) ?? '',
              reasonExtra: (r.reason_extra as string) ?? '',
              sourceDailyReportId: (r.source_daily_report_id as string | null) ?? undefined,
              labor: (r.labor as FieldTicket['labor']) ?? [],
              materials: (r.materials as FieldTicket['materials']) ?? [],
              equipment: (r.equipment as FieldTicket['equipment']) ?? [],
              photos: (((r.photos as FieldTicketPhoto[] | null) ?? []).map((p) => {
                const localUri = localUriById.get(p.id);
                const { uri, storagePath } = resolveTicketPhoto(p.uri, localUri);
                return { ...p, uri, storagePath, localUri };
              })) as FieldTicket['photos'],
              markupPercent: r.markup_percent == null ? undefined : Number(r.markup_percent),
              status: (r.status as FieldTicket['status']) ?? 'draft',
              authorization: (r.authorization as FieldTicket['authorization']) ?? undefined,
              convertedChangeOrderId: (r.converted_change_order_id as string | null) ?? undefined,
              convertedAt: (r.converted_at as string | null) ?? undefined,
              auditTrail: (r.audit_trail as FieldTicket['auditTrail']) ?? undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as FieldTicket[];
            await saveLocal(FIELD_TICKETS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<FieldTicket[]>(FIELD_TICKETS_KEY, []);
    },
  });

  // Delay register. Same server-first-then-local shape as the field tickets.
  //
  // PRE-MIGRATION BEHAVIOUR — READ THIS BEFORE DEBUGGING AN EMPTY REGISTER.
  // public.delay_events does not exist in production until
  // supabase/migrations/20260804120000_delay_events.sql is applied. Until then
  // this select errors, the catch falls through to AsyncStorage, and every
  // write hits a PostgREST schema-cache miss that utils/offlineQueue.ts
  // classifies as TRANSIENT and re-queues. Net effect: the feature works fully
  // on-device and syncs nothing, losing nothing. That is deliberate — the
  // notice clock is worth having before the table lands.
  const delayEventsQuery = useQuery({
    queryKey: ['delayEvents', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('delay_events').select('*').order('first_observed_date', { ascending: true });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              projectId: r.project_id as string,
              number: Number(r.number),
              cause: (r.cause as DelayEvent['cause']) ?? 'other',
              firstObservedDate: r.first_observed_date as string,
              endedDate: (r.ended_date as string | null) ?? undefined,
              description: (r.description as string) ?? '',
              evidence: (r.evidence as DelayEvidenceRef[] | null) ?? [],
              impactedTaskIds: (r.impacted_task_ids as string[] | null) ?? [],
              claimedDays: Number(r.claimed_days ?? 0),
              concurrentDays: r.concurrent_days == null ? undefined : Number(r.concurrent_days),
              notices: (r.notices as DelayNotice[] | null) ?? [],
              // Never coerce a missing classification into a guess.
              classification: (r.classification as DelayEvent['classification']) ?? 'unclassified',
              changeOrderId: (r.change_order_id as string | null) ?? undefined,
              auditTrail: (r.audit_trail as DelayEvent['auditTrail']) ?? undefined,
              sealedAt: (r.sealed_at as string | null) ?? undefined,
              contentHash: (r.content_hash as string | null) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as DelayEvent[];
            await saveLocal(DELAY_EVENTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback — table may not exist yet */ }
      }
      return loadLocal<DelayEvent[]>(DELAY_EVENTS_KEY, []);
    },
  });

  const leadsQuery = useQuery({
    queryKey: ['leads', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('leads').select('*').order('received_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              name: (r.name as string) ?? '',
              phone: (r.phone as string) ?? undefined,
              email: (r.email as string) ?? undefined,
              address: (r.address as string) ?? undefined,
              projectType: (r.project_type as string) ?? undefined,
              projectTypeMapped: (r.project_type_mapped as Lead['projectTypeMapped']) ?? undefined,
              scope: (r.scope as string) ?? undefined,
              budgetMin: (r.budget_min as number) ?? undefined,
              budgetMax: (r.budget_max as number) ?? undefined,
              timeline: (r.timeline as string) ?? undefined,
              source: (r.source as Lead['source']) ?? 'other',
              sourceOther: (r.source_other as string) ?? undefined,
              stage: (r.stage as LeadStage) ?? 'new',
              score: (r.score as number) ?? undefined,
              scoreReason: (r.score_reason as string) ?? undefined,
              receivedAt: r.received_at as string,
              firstRespondedAt: (r.first_responded_at as string) ?? undefined,
              touches: (r.touches as LeadTouch[]) ?? [],
              convertedProjectId: (r.converted_project_id as string) ?? undefined,
              lostReason: (r.lost_reason as string) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as Lead[];
            await saveLocal(LEADS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Lead[]>(LEADS_KEY, []);
    },
  });

  const bidPackagesQuery = useQuery({
    queryKey: ['bid_packages', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('bid_packages').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              projectId: r.project_id as string,
              name: (r.name as string) ?? '',
              csiDivision: (r.csi_division as string) ?? undefined,
              phase: (r.phase as string) ?? undefined,
              scopeDescription: (r.scope_description as string) ?? undefined,
              linkedEstimateItemIds: (r.linked_estimate_item_ids as string[]) ?? [],
              estimateBudget: Number(r.estimate_budget) || 0,
              status: (r.status as BidPackageStatus) ?? 'open',
              dueDate: (r.due_date as string) ?? undefined,
              requiredByDate: (r.required_by_date as string) ?? undefined,
              awardedBidId: (r.awarded_bid_id as string) ?? undefined,
              awardedCommitmentId: (r.awarded_commitment_id as string) ?? undefined,
              buyoutSavings: r.buyout_savings != null ? Number(r.buyout_savings) : undefined,
              notes: (r.notes as string) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as BidPackage[];
            await saveLocal(BID_PACKAGES_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<BidPackage[]>(BID_PACKAGES_KEY, []);
    },
  });

  const bidPackageBidsQuery = useQuery({
    queryKey: ['bid_package_bids', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('bid_package_bids').select('*').order('submitted_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              packageId: r.package_id as string,
              subcontractorId: (r.subcontractor_id as string) ?? undefined,
              vendorName: (r.vendor_name as string) ?? undefined,
              amount: Number(r.amount) || 0,
              includes: (r.includes as string) ?? undefined,
              excludes: (r.excludes as string) ?? undefined,
              terms: (r.terms as string) ?? undefined,
              source: (r.source as BidPackageBid['source']) ?? undefined,
              status: (r.status as BuyoutBidStatus) ?? 'received',
              submittedAt: r.submitted_at as string,
              normalizedAdjustment: r.normalized_adjustment != null ? Number(r.normalized_adjustment) : undefined,
              normalizedAdjustmentReason: (r.normalized_adjustment_reason as string) ?? undefined,
              notes: (r.notes as string) ?? undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as BidPackageBid[];
            await saveLocal(BID_PACKAGE_BIDS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<BidPackageBid[]>(BID_PACKAGE_BIDS_KEY, []);
    },
  });

  const subsQuery = useQuery({
    queryKey: ['subcontractors', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('subcontractors').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, companyName: (r.company_name as string) ?? '', contactName: (r.contact_name as string) ?? '',
              phone: (r.phone as string) ?? '', email: (r.email as string) ?? '', address: (r.address as string) ?? '',
              trade: (r.trade as Subcontractor['trade']) ?? 'General', licenseNumber: (r.license_number as string) ?? '',
              licenseExpiry: (r.license_expiry as string) ?? '', coiExpiry: (r.coi_expiry as string) ?? '',
              w9OnFile: (r.w9_on_file as boolean) ?? false, bidHistory: (r.bid_history as Subcontractor['bidHistory']) ?? [],
              assignedProjects: (r.assigned_projects as string[]) ?? [], notes: (r.notes as string) ?? '',
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Subcontractor[];
            await saveLocal(SUBS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Subcontractor[]>(SUBS_KEY, []);
    },
  });

  const punchItemsQuery = useQuery({
    queryKey: ['punchItems', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('punch_items').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            // photo_uri holds a bucket path — sign the batch, and keep this
            // device's local original when it still has one. Same treatment as
            // the photo gallery (see photosQuery).
            const cachedLocal = new Map<string, string>();
            for (const p of await loadLocal<PunchItem[]>(PUNCH_ITEMS_KEY, [])) {
              const local = p.photoLocalUri ?? (isDeviceLocalUri(p.photoUri) ? p.photoUri : undefined);
              if (local) cachedLocal.set(p.id, local);
            }
            // Only sign what we'll actually render — on the device that shot
            // them, every photo already has a local file and signing would be
            // pure waste.
            const resolve = await buildPhotoUrlResolver(
              data.filter(r => !cachedLocal.has(r.id as string)).map(r => r.photo_uri as string | undefined),
            );
            const mapped = data.map((r: Record<string, unknown>) => {
              const photoLocalUri = cachedLocal.get(r.id as string);
              const photo = resolve(r.photo_uri as string | undefined, photoLocalUri);
              return {
              id: r.id as string, projectId: r.project_id as string, description: r.description as string,
              location: (r.location as string) ?? '', assignedSub: (r.assigned_sub as string) ?? '',
              assignedSubId: r.assigned_sub_id as string | undefined, dueDate: r.due_date as string,
              priority: (r.priority as PunchItem['priority']) ?? 'medium', status: (r.status as PunchItem['status']) ?? 'open',
              photoUri: photo.uri || undefined, photoStoragePath: photo.storagePath, photoLocalUri,
              rejectionNote: r.rejection_note as string | undefined,
              closedAt: r.closed_at as string | undefined, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
              };
            }) as PunchItem[];
            await saveLocal(PUNCH_ITEMS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<PunchItem[]>(PUNCH_ITEMS_KEY, []);
    },
  });

  const photosQuery = useQuery({
    queryKey: ['projectPhotos', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('photos').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            // `photos.uri` now holds a bucket path. Sign the batch once, and
            // keep this device's own local files where it still has them so
            // the gallery stays instant and survives losing signal.
            const cachedLocal = new Map<string, string>();
            for (const p of await loadLocal<ProjectPhoto[]>(PHOTOS_KEY, [])) {
              const local = p.localUri ?? (isDeviceLocalUri(p.uri) ? p.uri : undefined);
              if (local) cachedLocal.set(p.id, local);
            }
            // Only sign what we'll actually render — on the device that shot
            // them, every photo already has a local file and signing would be
            // pure waste.
            const resolve = await buildPhotoUrlResolver(
              data.filter(r => !cachedLocal.has(r.id as string)).map(r => r.uri as string | undefined),
            );
            const mapped = data.map((r: Record<string, unknown>) => {
              const localUri = cachedLocal.get(r.id as string);
              const { uri, storagePath } = resolve(r.uri as string | undefined, localUri);
              return {
              id: r.id as string, projectId: r.project_id as string, uri, storagePath, localUri,
              timestamp: r.timestamp as string, location: r.location as string | undefined,
              tag: r.tag as string | undefined, linkedTaskId: r.linked_task_id as string | undefined,
              linkedTaskName: r.linked_task_name as string | undefined,
              markup: (r.markup as ProjectPhoto['markup']) ?? [], createdAt: r.created_at as string,
              };
            }) as ProjectPhoto[];
            await saveLocal(PHOTOS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<ProjectPhoto[]>(PHOTOS_KEY, []);
    },
  });

  const priceAlertsQuery = useQuery({
    queryKey: ['priceAlerts', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('price_alerts').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, materialId: r.material_id as string, materialName: r.material_name as string,
              targetPrice: Number(r.target_price), direction: (r.direction as PriceAlert['direction']) ?? 'below',
              currentPrice: Number(r.current_price), isTriggered: (r.is_triggered as boolean) ?? false,
              isPaused: (r.is_paused as boolean) ?? false, createdAt: r.created_at as string,
            })) as PriceAlert[];
            await saveLocal(PRICE_ALERTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<PriceAlert[]>(PRICE_ALERTS_KEY, []);
    },
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('contacts').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, firstName: r.first_name as string, lastName: (r.last_name as string) ?? '',
              companyName: (r.company_name as string) ?? '', role: (r.role as Contact['role']) ?? 'Other',
              email: (r.email as string) ?? '', secondaryEmail: r.secondary_email as string | undefined,
              phone: (r.phone as string) ?? '', address: (r.address as string) ?? '', notes: (r.notes as string) ?? '',
              linkedProjectIds: (r.linked_project_ids as string[]) ?? [],
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Contact[];
            await saveLocal(CONTACTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Contact[]>(CONTACTS_KEY, []);
    },
  });

  const commEventsQuery = useQuery({
    queryKey: ['commEvents', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('comm_events').select('*').order('timestamp', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, type: r.type as CommunicationEvent['type'],
              summary: (r.summary as string) ?? '', actor: (r.actor as string) ?? '',
              recipient: r.recipient as string | undefined, detail: r.detail as string | undefined,
              isPrivate: (r.is_private as boolean) ?? false, timestamp: r.timestamp as string,
            })) as CommunicationEvent[];
            await saveLocal(COMM_EVENTS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<CommunicationEvent[]>(COMM_EVENTS_KEY, []);
    },
  });

  const rfisQuery = useQuery({
    queryKey: ['rfis', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('rfis').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, number: Number(r.number),
              subject: r.subject as string, question: (r.question as string) ?? '',
              submittedBy: (r.submitted_by as string) ?? '', assignedTo: (r.assigned_to as string) ?? '',
              dateSubmitted: r.date_submitted as string, dateRequired: r.date_required as string,
              dateResponded: r.date_responded as string | undefined, response: r.response as string | undefined,
              status: (r.status as RFI['status']) ?? 'open', priority: (r.priority as RFI['priority']) ?? 'normal',
              linkedDrawing: r.linked_drawing as string | undefined, linkedTaskId: r.linked_task_id as string | undefined,
              attachments: (r.attachments as string[]) ?? [], shareToken: r.share_token as string | undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as RFI[];
            await saveLocal(RFIS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<RFI[]>(RFIS_KEY, []);
    },
  });

  const submittalsQuery = useQuery({
    queryKey: ['submittals', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('submittals').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string, number: Number(r.number),
              title: r.title as string, specSection: (r.spec_section as string) ?? '',
              submittedBy: (r.submitted_by as string) ?? '', submittedDate: r.submitted_date as string,
              requiredDate: r.required_date as string, reviewCycles: (r.review_cycles as Submittal['reviewCycles']) ?? [],
              currentStatus: (r.current_status as Submittal['currentStatus']) ?? 'pending',
              attachments: (r.attachments as string[]) ?? [], shareToken: r.share_token as string | undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Submittal[];
            await saveLocal(SUBMITTALS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Submittal[]>(SUBMITTALS_KEY, []);
    },
  });

  // OAC Meetings — local-only for now (no Supabase mirror). Lives in
  // mageid_oac_meetings AsyncStorage key. Add server sync later if
  // cross-device meetings become a need.
  // OAC Meetings — server-synced. Reads from Supabase first, falls back
  // to local AsyncStorage when offline. Writes go through supabaseWrite
  // for offline-queue support.
  const oacMeetingsQuery = useQuery({
    queryKey: ['oac_meetings', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('oac_meetings').select('*').order('scheduled_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              projectId: r.project_id as string,
              number: Number(r.number),
              scheduledAt: r.scheduled_at as string,
              durationMinutes: r.duration_minutes as number | undefined,
              location: r.location as string | undefined,
              attendees: (r.attendees as OACMeeting['attendees']) ?? [],
              agenda: (r.agenda as OACMeeting['agenda']) ?? [],
              actionItems: (r.action_items as OACMeeting['actionItems']) ?? [],
              transcript: r.transcript as string | undefined,
              minutes: r.minutes as string | undefined,
              status: (r.status as OACMeeting['status']) ?? 'draft',
              distributedAt: r.distributed_at as string | undefined,
              distributionLog: r.distribution_log as OACMeeting['distributionLog'],
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
            })) as OACMeeting[];
            await saveLocal(OAC_MEETINGS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<OACMeeting[]>(OAC_MEETINGS_KEY, []);
    },
  });
  const coisQuery = useQuery({
    queryKey: ['cois', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('cois').select('*').order('uploaded_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string,
              subcontractorId: r.subcontractor_id as string,
              projectId: r.project_id as string | undefined,
              fileUri: r.file_uri as string,
              uploadedAt: r.uploaded_at as string,
              validation: r.validation as CertificateOfInsurance['validation'],
              coverages: (r.coverages as CertificateOfInsurance['coverages']) ?? [],
              notes: r.notes as string | undefined,
            })) as CertificateOfInsurance[];
            await saveLocal(COIS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<CertificateOfInsurance[]>(COIS_KEY, []);
    },
  });

  const equipmentQuery = useQuery({
    queryKey: ['equipment', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('equipment').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, name: r.name as string, type: (r.type as Equipment['type']) ?? 'owned',
              category: (r.category as Equipment['category']) ?? 'other', make: (r.make as string) ?? '',
              model: (r.model as string) ?? '', year: r.year as number | undefined,
              serialNumber: r.serial_number as string | undefined, dailyRate: Number(r.daily_rate) || 0,
              currentProjectId: r.current_project_id as string | undefined,
              maintenanceSchedule: (r.maintenance_schedule as Equipment['maintenanceSchedule']) ?? [],
              utilizationLog: (r.utilization_log as Equipment['utilizationLog']) ?? [],
              status: (r.status as Equipment['status']) ?? 'available', notes: r.notes as string | undefined,
              createdAt: r.created_at as string,
            })) as Equipment[];
            await saveLocal(EQUIPMENT_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Equipment[]>(EQUIPMENT_KEY, []);
    },
  });

  const onboardingQuery = useQuery({
    queryKey: ['onboarding', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data } = await supabase.from('profiles').select('onboarding_complete').eq('id', userId).single();
          if (data?.onboarding_complete) {
            await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
            return true;
          }
        } catch { /* fallback */ }
      }
      const stored = await AsyncStorage.getItem(ONBOARDING_KEY);
      return stored === 'true';
    },
  });

  useEffect(() => { if (onboardingQuery.data !== undefined) setHasSeenOnboarding(onboardingQuery.data); }, [onboardingQuery.data]);

  const completeOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setHasSeenOnboarding(true);
    queryClient.setQueryData(['onboarding', userId], true);
    if (canSync && userId) {
      // Through the offline queue — a direct .update() here swallowed offline
      // failures, so completing onboarding on a plane never reached the server.
      void supabaseWrite('profiles', 'update', { id: userId, onboarding_complete: true });
    }
  }, [queryClient, userId, canSync]);

  // ── Marketplace persona (user_role) ─────────────────────────────────────
  // Same pattern as the onboarding query: read from Supabase first when
  // online, fall back to the AsyncStorage mirror. The mirror is what lets
  // the root layout's routing gate make a decision before the network
  // resolves on cold boot — without it, every cold boot would briefly flash
  // /persona-select while we wait for the profile fetch.
  const userRoleQuery = useQuery({
    queryKey: ['user_role', userId],
    queryFn: async (): Promise<UserRole | null> => {
      if (canSync) {
        try {
          const { data } = await supabase.from('profiles').select('user_role').eq('id', userId).single();
          const remote = (data?.user_role ?? null) as UserRole | null;
          if (remote) {
            await AsyncStorage.setItem(USER_ROLE_KEY, remote);
            return remote;
          }
        } catch { /* fallback */ }
      }
      const stored = await AsyncStorage.getItem(USER_ROLE_KEY);
      if (stored === 'contractor' || stored === 'client' || stored === 'both' || stored === 'property_manager') return stored;
      return null;
    },
  });

  useEffect(() => { if (userRoleQuery.data !== undefined) setUserRoleState(userRoleQuery.data); }, [userRoleQuery.data]);

  const setUserRole = useCallback(async (role: UserRole) => {
    await AsyncStorage.setItem(USER_ROLE_KEY, role);
    setUserRoleState(role);
    queryClient.setQueryData(['user_role', userId], role);
    if (canSync && userId) {
      // Through the offline queue — same reasoning as completeOnboarding above.
      void supabaseWrite('profiles', 'update', { id: userId, user_role: role });
    }
  }, [queryClient, userId, canSync]);

  useEffect(() => { if (projectsQuery.data) setProjects(projectsQuery.data); }, [projectsQuery.data]);
  // Mark hydration complete once the query settles (success OR error). We flip
  // it here — not off `projectsQuery.data` — so an empty/failed load still
  // clears the loading state instead of hanging on a spinner forever.
  useEffect(() => {
    if (!projectsQuery.isLoading) setProjectsLoaded(true);
  }, [projectsQuery.isLoading]);
  useEffect(() => { if (settingsQuery.data) setSettings(settingsQuery.data); }, [settingsQuery.data]);
  useEffect(() => { if (changeOrdersQuery.data) setChangeOrders(changeOrdersQuery.data); }, [changeOrdersQuery.data]);
  useEffect(() => { if (invoicesQuery.data) setInvoices(invoicesQuery.data); }, [invoicesQuery.data]);
  useEffect(() => { if (commitmentsQuery.data) setCommitments(commitmentsQuery.data); }, [commitmentsQuery.data]);
  useEffect(() => { if (prequalQuery.data) setPrequalPackets(prequalQuery.data); }, [prequalQuery.data]);
  useEffect(() => { if (dailyReportsQuery.data) setDailyReports(dailyReportsQuery.data); }, [dailyReportsQuery.data]);
  useEffect(() => { if (fieldTicketsQuery.data) setFieldTickets(fieldTicketsQuery.data); }, [fieldTicketsQuery.data]);
  useEffect(() => { if (delayEventsQuery.data) setDelayEvents(delayEventsQuery.data); }, [delayEventsQuery.data]);
  useEffect(() => { if (subsQuery.data) setSubcontractors(subsQuery.data); }, [subsQuery.data]);
  useEffect(() => { if (leadsQuery.data) setLeads(leadsQuery.data); }, [leadsQuery.data]);
  useEffect(() => { if (bidPackagesQuery.data) setBidPackages(bidPackagesQuery.data); }, [bidPackagesQuery.data]);
  useEffect(() => { if (bidPackageBidsQuery.data) setBidPackageBids(bidPackageBidsQuery.data); }, [bidPackageBidsQuery.data]);
  useEffect(() => { if (punchItemsQuery.data) setPunchItems(punchItemsQuery.data); }, [punchItemsQuery.data]);
  useEffect(() => { if (photosQuery.data) setProjectPhotos(photosQuery.data); }, [photosQuery.data]);
  useEffect(() => { if (priceAlertsQuery.data) setPriceAlerts(priceAlertsQuery.data); }, [priceAlertsQuery.data]);
  useEffect(() => { if (contactsQuery.data) setContacts(contactsQuery.data); }, [contactsQuery.data]);
  useEffect(() => { if (commEventsQuery.data) setCommEvents(commEventsQuery.data); }, [commEventsQuery.data]);
  useEffect(() => { if (rfisQuery.data) setRfis(rfisQuery.data); }, [rfisQuery.data]);
  useEffect(() => { if (submittalsQuery.data) setSubmittals(submittalsQuery.data); }, [submittalsQuery.data]);
  useEffect(() => { if (oacMeetingsQuery.data) setOacMeetings(oacMeetingsQuery.data); }, [oacMeetingsQuery.data]);
  useEffect(() => { if (coisQuery.data) setCois(coisQuery.data); }, [coisQuery.data]);
  useEffect(() => { if (equipmentQuery.data) setEquipment(equipmentQuery.data); }, [equipmentQuery.data]);

  // Permits — cloud-backed as of t1.1 audit-fix migration. Same fall-back
  // pattern as commitments / rfis: try Supabase, fall back to AsyncStorage
  // when offline / cloud is empty.
  const permitsQuery = useQuery({
    queryKey: ['permits', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('permits').select('*').order('applied_date', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string,
              projectName: (r.project_name as string | null) ?? '',
              type: r.type as Permit['type'],
              permitNumber: (r.permit_number as string | null) ?? undefined,
              jurisdiction: (r.jurisdiction as string) ?? '',
              status: r.status as Permit['status'],
              appliedDate: (r.applied_date as string | null) ?? '',
              approvedDate: (r.approved_date as string | null) ?? undefined,
              expiresDate: (r.expires_date as string | null) ?? undefined,
              inspectionDate: (r.inspection_date as string | null) ?? undefined,
              inspectionNotes: (r.inspection_notes as string | null) ?? undefined,
              fee: Number(r.fee) || 0,
              notes: (r.notes as string | null) ?? undefined,
              phase: (r.phase as string | null) ?? undefined,
              attachmentUri: (r.attachment_uri as string | null) ?? undefined,
              specialInspectionCategory: (r.special_inspection_category as Permit['specialInspectionCategory']) ?? undefined,
              inspectorName: (r.inspector_name as string | null) ?? undefined,
              lastReportSummary: (r.last_report_summary as string | null) ?? undefined,
              lastReportDate: (r.last_report_date as string | null) ?? undefined,
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Permit[];
            await saveLocal(PERMITS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<Permit[]>(PERMITS_KEY, []);
    },
  });
  useEffect(() => { if (permitsQuery.data) setPermits(permitsQuery.data); }, [permitsQuery.data]);
  const savePermitsMutation = useMutation({
    mutationFn: async (updated: Permit[]) => { await saveLocal(PERMITS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['permits', userId], data); },
  });

  // AIA G702/G703 pay applications — cloud-backed as of t1.1 audit-fix
  // migration. Surfaced in the client portal as a dedicated "Pay
  // Applications" section so the client/architect/lender can review and
  // download a PDF of every certified billing.
  const aiaPayAppsQuery = useQuery({
    queryKey: ['aiaPayApps', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('aia_pay_apps').select('*').order('application_number', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string,
              invoiceId: (r.invoice_id as string | null) ?? undefined,
              applicationNumber: Number(r.application_number) || 1,
              applicationDate: (r.application_date as string | null) ?? '',
              periodTo: (r.period_to as string | null) ?? '',
              contractDate: (r.contract_date as string | null) ?? undefined,
              ownerName: (r.owner_name as string | null) ?? '',
              contractorName: (r.contractor_name as string | null) ?? '',
              architectName: (r.architect_name as string | null) ?? undefined,
              projectName: (r.project_name as string | null) ?? '',
              projectLocation: (r.project_location as string | null) ?? undefined,
              contractForDescription: (r.contract_for_description as string | null) ?? undefined,
              originalContractSum: Number(r.original_contract_sum) || 0,
              netChangeByCO: Number(r.net_change_by_co) || 0,
              contractSumToDate: Number(r.contract_sum_to_date) || 0,
              retainagePercent: Number(r.retainage_percent) || 10,
              lessPreviousCertificates: Number(r.less_previous_certificates) || 0,
              lines: (r.lines as SavedAIAPayApp['lines']) ?? [],
              notes: (r.notes as string | null) ?? undefined,
              ...(r.snapshot_totals ? { snapshotTotals: r.snapshot_totals } : {}),
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as unknown as SavedAIAPayApp[];
            await saveLocal(AIA_PAY_APPS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<SavedAIAPayApp[]>(AIA_PAY_APPS_KEY, []);
    },
  });
  useEffect(() => { if (aiaPayAppsQuery.data) setAiaPayApps(aiaPayAppsQuery.data); }, [aiaPayAppsQuery.data]);
  const saveAiaPayAppsMutation = useMutation({
    mutationFn: async (updated: SavedAIAPayApp[]) => { await saveLocal(AIA_PAY_APPS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['aiaPayApps', userId], data); },
  });

  // Sub portal links — pull from Supabase if logged in, otherwise local.
  // Mirrors the (project, sub) pair so the share URL can be derived without
  // exposing GC data via the URL hash.
  const subPortalLinksQuery = useQuery({
    queryKey: ['subPortalLinks', userId],
    queryFn: async (): Promise<SubPortalLink[]> => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('sub_portal_links').select('*');
          if (!error && data && data.length > 0) {
            const mapped = (data as Record<string, unknown>[]).map(r => ({
              id: r.id as string,
              projectId: r.project_id as string,
              subcontractorId: r.subcontractor_id as string,
              passcode: r.passcode as string | undefined,
              requirePasscode: !!r.require_passcode,
              enabled: !!r.enabled,
              welcomeMessage: r.welcome_message as string | undefined,
              commitmentIds: r.commitment_ids as string[] | undefined,
              createdAt: r.created_at as string,
              updatedAt: r.updated_at as string,
              lastSharedAt: r.last_shared_at as string | undefined,
            }));
            await saveLocal(SUB_PORTAL_LINKS_KEY, mapped);
            return mapped;
          }
        } catch { /* fallback */ }
      }
      return loadLocal<SubPortalLink[]>(SUB_PORTAL_LINKS_KEY, []);
    },
  });
  useEffect(() => { if (subPortalLinksQuery.data) setSubPortalLinks(subPortalLinksQuery.data); }, [subPortalLinksQuery.data]);
  const saveSubPortalLinksMutation = useMutation({
    mutationFn: async (updated: SubPortalLink[]) => { await saveLocal(SUB_PORTAL_LINKS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['subPortalLinks', userId], data); },
  });

  const syncProjectToSupabase = useCallback((project: Project, action: 'upsert' | 'delete', opts?: { immediate?: boolean }) => {
    if (!canSync) return;
    const existing = syncDebounceMap.current.get(project.id);
    if (existing) clearTimeout(existing);
    const run = async () => {
      syncDebounceMap.current.delete(project.id);
      if (action === 'delete') {
        await supabaseWrite('projects', 'delete', { id: project.id });
      } else {
        // MUST be 'upsert', not 'insert': this path also fires on every EDIT,
        // and a plain insert on the existing PK fails with a duplicate-key
        // violation (classified terminal) — so edits would silently never
        // reach the server, and the server-first load on next launch would
        // revert them locally.
        await supabaseWrite('projects', 'upsert', {
          id: project.id, user_id: userId, name: project.name, type: project.type,
          location: project.location, square_footage: project.squareFootage, quality: project.quality,
          location_latitude: project.locationLatitude ?? null,
          location_longitude: project.locationLongitude ?? null,
          location_geocoded_at: project.locationGeocodedAt ?? null,
          description: project.description,
          scope: (project.scope ?? null) as unknown,
          estimate: project.estimate as unknown, schedule: project.schedule as unknown,
          linked_estimate: project.linkedEstimate as unknown,
          estimate_versions: project.estimateVersions as unknown, status: project.status,
          collaborators: project.collaborators as unknown, client_portal: project.clientPortal as unknown,
          target_budget: project.targetBudget as unknown,
          primary_contact: project.primaryContact ?? null,
          lead_source: project.leadSource ?? null,
          target_timeline_notes: project.targetTimelineNotes ?? null,
          handover_checklist: (project.handoverChecklist ?? {}) as unknown,
          closed_at: project.closedAt,
          substantial_completion_date: project.substantialCompletionDate,
          warranty_walk_completed_at: project.warrantyWalkCompletedAt,
          photo_count: project.photoCount,
          created_at: project.createdAt, updated_at: project.updatedAt,
        });
      }
      console.log('[ProjectContext] Synced project to Supabase:', project.name);
    };
    if (opts?.immediate) {
      // New project: enqueue the upsert NOW (synchronously) so the project row
      // reaches Supabase BEFORE its sub-collections (permits/submittals/etc.)
      // insert — otherwise their project_id FKs violate, those writes fail
      // terminally, and the un-synced project vanishes on the next server-first
      // load (which overwrites local with Supabase). The offline queue is FIFO,
      // so enqueuing first = inserted first.
      void run();
    } else {
      syncDebounceMap.current.set(project.id, setTimeout(run, 800));
    }
  }, [canSync, userId]);

  const saveProjectsMutation = useMutation({
    mutationFn: async (updatedProjects: Project[]) => { await saveLocal(PROJECTS_KEY, updatedProjects); return updatedProjects; },
    onSuccess: (data) => { queryClient.setQueryData(['projects', userId], data); },
  });
  const saveChangeOrdersMutation = useMutation({
    mutationFn: async (updated: ChangeOrder[]) => { await saveLocal(CHANGE_ORDERS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['changeOrders', userId], data); },
  });
  const saveInvoicesMutation = useMutation({
    mutationFn: async (updated: Invoice[]) => { await saveLocal(INVOICES_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['invoices', userId], data); },
  });
  const saveCommitmentsMutation = useMutation({
    mutationFn: async (updated: Commitment[]) => { await saveLocal(COMMITMENTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['commitments', userId], data); },
  });
  const savePrequalMutation = useMutation({
    mutationFn: async (updated: PrequalPacket[]) => { await saveLocal(PREQUAL_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['prequalPackets', userId], data); },
  });
  const saveDailyReportsMutation = useMutation({
    mutationFn: async (updated: DailyFieldReport[]) => { await saveLocal(DAILY_REPORTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['dailyReports', userId], data); },
  });
  const saveFieldTicketsMutation = useMutation({
    mutationFn: async (updated: FieldTicket[]) => { await saveLocal(FIELD_TICKETS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['fieldTickets', userId], data); },
  });
  const saveDelayEventsMutation = useMutation({
    mutationFn: async (updated: DelayEvent[]) => { await saveLocal(DELAY_EVENTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['delayEvents', userId], data); },
  });
  const saveSubsMutation = useMutation({
    mutationFn: async (updated: Subcontractor[]) => { await saveLocal(SUBS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['subcontractors', userId], data); },
  });
  const saveLeadsMutation = useMutation({
    mutationFn: async (updated: Lead[]) => { await saveLocal(LEADS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['leads', userId], data); },
  });
  const saveBidPackagesMutation = useMutation({
    mutationFn: async (updated: BidPackage[]) => { await saveLocal(BID_PACKAGES_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['bid_packages', userId], data); },
  });
  const saveBidPackageBidsMutation = useMutation({
    mutationFn: async (updated: BidPackageBid[]) => { await saveLocal(BID_PACKAGE_BIDS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['bid_package_bids', userId], data); },
  });
  const savePunchItemsMutation = useMutation({
    mutationFn: async (updated: PunchItem[]) => { await saveLocal(PUNCH_ITEMS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['punchItems', userId], data); },
  });
  const savePhotosMutation = useMutation({
    mutationFn: async (updated: ProjectPhoto[]) => { await saveLocal(PHOTOS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['projectPhotos', userId], data); },
  });
  const savePriceAlertsMutation = useMutation({
    mutationFn: async (updated: PriceAlert[]) => { await saveLocal(PRICE_ALERTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['priceAlerts', userId], data); },
  });
  const saveContactsMutation = useMutation({
    mutationFn: async (updated: Contact[]) => { await saveLocal(CONTACTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['contacts', userId], data); },
  });
  const saveCommEventsMutation = useMutation({
    mutationFn: async (updated: CommunicationEvent[]) => { await saveLocal(COMM_EVENTS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['commEvents', userId], data); },
  });
  const saveRfisMutation = useMutation({
    mutationFn: async (updated: RFI[]) => { await saveLocal(RFIS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['rfis', userId], data); },
  });
  const saveSubmittalsMutation = useMutation({
    mutationFn: async (updated: Submittal[]) => { await saveLocal(SUBMITTALS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['submittals', userId], data); },
  });
  const saveOACMeetingsMutation = useMutation({
    mutationFn: async (updated: OACMeeting[]) => { await saveLocal(OAC_MEETINGS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['oac_meetings', userId], data); },
  });
  const saveCOIsMutation = useMutation({
    mutationFn: async (updated: CertificateOfInsurance[]) => { await saveLocal(COIS_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['cois', userId], data); },
  });
  const saveEquipmentMutation = useMutation({
    mutationFn: async (updated: Equipment[]) => { await saveLocal(EQUIPMENT_KEY, updated); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['equipment', userId], data); },
  });
  const saveSettingsMutation = useMutation({
    mutationFn: async (updatedSettings: AppSettings) => {
      await saveLocal(SETTINGS_KEY, updatedSettings);
      if (canSync && userId) {
        // Through the offline queue — the previous direct .update() swallowed
        // offline failures, so branding/digest/settings edits made offline
        // silently never reached the server (and reverted on next launch).
        void supabaseWrite('profiles', 'update', {
          id: userId,
          location: updatedSettings.location, units: updatedSettings.units,
          tax_rate: updatedSettings.taxRate, contingency_rate: updatedSettings.contingencyRate,
          company_name: updatedSettings.branding.companyName, contact_name: updatedSettings.branding.contactName,
          email: updatedSettings.branding.email, phone: updatedSettings.branding.phone,
          address: updatedSettings.branding.address, license_number: updatedSettings.branding.licenseNumber,
          tagline: updatedSettings.branding.tagline, logo_uri: updatedSettings.branding.logoUri,
          signature_data: updatedSettings.branding.signatureData, theme_colors: updatedSettings.themeColors,
          biometrics_enabled: updatedSettings.biometricsEnabled, dfr_recipients: updatedSettings.dfrRecipients,
          digest_enabled: updatedSettings.digest?.enabled ?? false,
          digest_hour: updatedSettings.digest?.hour ?? 6,
          digest_channels: updatedSettings.digest?.channels ?? { email: true, in_app: true },
          digest_timezone: updatedSettings.digest?.timezone ?? 'America/New_York',
          financing: updatedSettings.financing ?? null,
        });
      }
      return updatedSettings;
    },
    onSuccess: (data) => { queryClient.setQueryData(['settings', userId], data); },
  });

  // Geocode a project's location string into lat/lng for hyperlocal weather
  // (morning digest, schedule weather alerts). Best-effort and async — never
  // blocks save. Updates the project in-place once Nominatim resolves.
  const geocodeIfNeeded = useCallback((project: Project) => {
    const hasCoords = project.locationLatitude != null && project.locationLongitude != null;
    if (!shouldGeocode(undefined, project.location, hasCoords, project.locationGeocodedAt)) return;
    void geocodeProjectLocation(project.location).then(result => {
      if (!result) return;
      // Re-read from current state at resolve-time so we don't overwrite a
      // concurrent edit. setProjects gets the latest snapshot via the
      // function setter.
      setProjects(prev => {
        const next = prev.map(p => p.id === project.id ? {
          ...p,
          locationLatitude: result.latitude,
          locationLongitude: result.longitude,
          locationGeocodedAt: new Date().toISOString(),
        } : p);
        // Persist + sync
        saveProjectsMutation.mutate(next);
        const updated = next.find(p => p.id === project.id);
        if (updated) syncProjectToSupabase(updated, 'upsert');
        return next;
      });
    }).catch(() => { /* silent — falls back to no-coords path */ });
  }, [saveProjectsMutation, syncProjectToSupabase]);

  const addProject = useCallback((project: Project) => {
    const updated = [project, ...projects];
    // Activation funnel: fire once at the imperative create (never on hydration,
    // which replaces `projects` via the query, not through addProject).
    track(AnalyticsEvents.PROJECT_CREATED, {
      total_projects: updated.length,
      type: project.type,
      has_estimate: !!project.linkedEstimate,
      is_first_project: updated.length === 1,
    });
    if (project.linkedEstimate || project.status === 'estimated') {
      // receipts / laborSamples / seeds are not available in ProjectContext's
      // scope — buildCostDatabase is called with the data that IS here
      // (projects + commitments). Grounding reflects closed-job history only —
      // a seed-only user (rates seeded, no closed jobs) reads used_learned_costs
      // false on THIS path. Accepted v1 undercount; the wizard emit carries full
      // grounding (incl. seeds) and is the primary aha signal.
      const _db = buildCostDatabase(updated, commitments);
      track(AnalyticsEvents.ESTIMATE_GENERATED, {
        project_type: project.type,
        grand_total: project.linkedEstimate?.grandTotal,
        path: 'created_with_estimate',
        ...estimateGroundingProps(_db),
      });
    }
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    // Immediate (non-debounced) so the project row exists in Supabase before any
    // sub-collections a caller adds next (fixes the demo-seeder FK failures +
    // the "new project vanishes on reload" bug).
    syncProjectToSupabase(project, 'upsert', { immediate: true });
    geocodeIfNeeded(project);
    if (canSync && userId) {
      void import('@/utils/qboSync').then(m => m.triggerQboSync('project', 'upsert', project.id));
    }
  }, [projects, saveProjectsMutation, syncProjectToSupabase, geocodeIfNeeded, canSync, userId]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    const prior = projects.find(p => p.id === id);
    const updated = projects.map(p => p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p);
    setProjects(updated);
    saveProjectsMutation.mutate(updated);
    const proj = updated.find(p => p.id === id);
    // Activation funnel: a project crossing INTO 'estimated' is the moat's
    // first "aha" — fire once on the transition, not on every estimate re-save.
    if (proj && prior?.status !== 'estimated' && proj.status === 'estimated') {
      // receipts / laborSamples / seeds are not available in ProjectContext's
      // scope — buildCostDatabase is called with the data that IS here
      // (projects + commitments). Grounding reflects closed-job history only —
      // a seed-only user (rates seeded, no closed jobs) reads used_learned_costs
      // false on THIS path. Accepted v1 undercount; the wizard emit carries full
      // grounding (incl. seeds) and is the primary aha signal.
      const _db = buildCostDatabase(updated, commitments);
      track(AnalyticsEvents.ESTIMATE_GENERATED, {
        project_type: proj.type,
        grand_total: proj.linkedEstimate?.grandTotal,
        path: 'linked_to_project',
        ...estimateGroundingProps(_db),
      });
    }
    if (proj) {
      syncProjectToSupabase(proj, 'upsert');
      // Re-geocode only if the location string actually changed — avoids
      // hitting Nominatim's rate limit on every routine save (e.g.
      // schedule debounce flush).
      if (prior?.location !== proj.location) {
        geocodeIfNeeded(proj);
      }
    }
  }, [projects, saveProjectsMutation, syncProjectToSupabase, geocodeIfNeeded]);

  // deleteProject is defined further down (just before the bucket memos) so it
  // can reference every project-scoped collection's persist fn / mutation for a
  // full local cascade. Those persist helpers (persistWarranties, persistPlan*,
  // persistPermitRoadmaps, persistPortalMessages) are declared later in this
  // component body, so defining the cascade here would hit their temporal dead
  // zone in the dependency array. See the `deleteProject` below.

  const getProject = useCallback((id: string) => projects.find(p => p.id === id) ?? null, [projects]);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    const updated = { ...settings, ...updates };
    setSettings(updated);
    saveSettingsMutation.mutate(updated);
  }, [settings, saveSettingsMutation]);

  const addCollaborator = useCallback((projectId: string, collab: ProjectCollaborator) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const existing = project.collaborators ?? [];
    if (existing.some(c => c.email === collab.email)) return;
    updateProject(projectId, { collaborators: [...existing, collab] });
  }, [projects, updateProject]);

  const removeCollaborator = useCallback((projectId: string, collabId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    updateProject(projectId, { collaborators: (project.collaborators ?? []).filter(c => c.id !== collabId) });
  }, [projects, updateProject]);

  // ─── Portal-state default helper ───────────────────────────────────────────
  // Tier 1 (CO / Invoice / AIA Pay App / RFI / Submittal): always Draft —
  //   explicit Send required before the client can see it.
  // Tier 2 (Daily Report / Photo / Warranty): Sent unless the project's
  //   per-type autoShare toggle is explicitly false. Undefined = true
  //   (preserves existing behaviour — items created before the portal toggle
  //   was introduced continue to appear in the portal automatically).
  // Selection is deferred — its state lives outside ProjectContext (T5 notes).
  const initialPortalState = useCallback(
    (kind: SendableItemKind, projectId: string): PortalState => {
      // Tier 1 — always Draft
      if (
        kind === 'change_order' || kind === 'invoice' || kind === 'aia_pay_app' ||
        kind === 'rfi' || kind === 'submittal'
      ) {
        return { status: 'draft' };
      }
      // Tier 2 — Sent unless the per-project autoShare toggle for this type
      // is explicitly set to false. Undefined/missing = true.
      const proj = projects.find(p => p.id === projectId);
      const auto = proj?.clientPortal?.autoShare ?? {};
      const enabledFor: Record<Exclude<SendableItemKind, 'change_order' | 'invoice' | 'aia_pay_app' | 'rfi' | 'submittal'>, boolean> = {
        daily_report: auto.dailyReports !== false,
        photo:        auto.photos       !== false,
        selection:    auto.selections   !== false,
        warranty:     auto.warranties   !== false,
      };
      const enabled = (enabledFor as Record<string, boolean | undefined>)[kind] ?? true;
      if (enabled) {
        return { status: 'sent', sentAt: new Date().toISOString(), sentVersion: 1 };
      }
      return { status: 'draft' };
    },
    [projects],
  );

  // Atomic multi-add. IMPORTANT: `addChangeOrder` closes over the render-time
  // `changeOrders` snapshot and commits the FULL array (state + AsyncStorage
  // persist), so calling it more than once in the same tick makes every call
  // build from the same stale snapshot — each one clobbers the previous CO.
  // Any code that creates several COs in one pass (e.g. the leak-CO sweep in
  // hooks/useLeakCoDrafts.ts) MUST go through this batch call instead.
  const addChangeOrders = useCallback((cos: ChangeOrder[]) => {
    if (cos.length === 0) return;
    const finalCos: ChangeOrder[] = cos.map(co => ({
      ...co,
      portalState: co.portalState ?? initialPortalState('change_order', co.projectId),
    }));
    const updated = [...finalCos, ...changeOrders];
    setChangeOrders(updated);
    saveChangeOrdersMutation.mutate(updated);
    if (canSync) {
      for (const finalCo of finalCos) {
        void supabaseWrite('change_orders', 'insert', {
          id: finalCo.id, user_id: userId, project_id: finalCo.projectId, number: finalCo.number, date: finalCo.date,
          description: finalCo.description, reason: finalCo.reason, line_items: finalCo.lineItems, original_contract_value: finalCo.originalContractValue,
          change_amount: finalCo.changeAmount, new_contract_total: finalCo.newContractTotal, status: finalCo.status,
          approvers: finalCo.approvers, approval_mode: finalCo.approvalMode, approval_deadline_days: finalCo.approvalDeadlineDays,
          audit_trail: finalCo.auditTrail, revision: finalCo.revision, created_at: finalCo.createdAt, updated_at: finalCo.updatedAt,
          portal_state: finalCo.portalState,
        });
      }
    }
  }, [changeOrders, saveChangeOrdersMutation, canSync, userId, initialPortalState]);

  const addChangeOrder = useCallback((co: ChangeOrder) => {
    addChangeOrders([co]);
  }, [addChangeOrders]);

  const updateChangeOrder = useCallback((id: string, updates: Partial<ChangeOrder>, reflow?: ChangeOrderReflowIntent) => {
    const now = new Date().toISOString();
    const prior = changeOrders.find(c => c.id === id);
    const updated = changeOrders.map(co => co.id === id ? { ...co, ...updates, updatedAt: now } : co);
    setChangeOrders(updated);
    saveChangeOrdersMutation.mutate(updated);

    // Cascade: when a CO transitions to 'approved', REFLOW the linked project's
    // schedule exactly once.
    //
    // This used to be three scalar increments (totalDurationDays +=,
    // criticalPathDays +=, and bufferDays += over in project-detail.tsx). No
    // task's startDay moved, nothing was reflowed, CPM never re-ran — so the
    // owner approved "+8 days," the contract said +8 days, and every sub still
    // saw the original dates. utils/coScheduleReflowCore.ts now picks the task
    // that absorbs the days, extends it, re-runs the real CPM engine so
    // successors shift and float/critical path are recomputed, and captures a
    // baseline + audit entry first.
    //
    // Idempotency is enforced INSIDE the core (scheduleImpactApplied plus a
    // durable auditTrail marker), which is what makes this safe on every path
    // that lands here: the GC's approve button, the CO screen's status
    // pipeline, the client portal reconciler polling in the background, and an
    // offline-queue replay. A double-applied CO silently adds phantom weeks.
    const nextCO = updated.find(c => c.id === id);
    const becameApproved =
      !!nextCO && nextCO.status === 'approved' && prior?.status !== 'approved';
    // A caller passing an explicit anchor is placing days on an ALREADY
    // approved CO (the "approved via portal with nothing to pin it to" case),
    // so we honour that without needing a fresh status transition.
    const shouldReflow =
      !!nextCO &&
      nextCO.status === 'approved' &&
      !isCoScheduleReflowApplied(nextCO) &&
      (becameApproved || !!reflow?.anchorTaskId);

    let committedCOs = updated;

    if (shouldReflow && nextCO) {
      const project = projects.find(p => p.id === nextCO.projectId);
      const actor = user?.email ?? user?.name ?? 'anonymous';
      const result = applyCoScheduleReflow(project?.schedule ?? null, nextCO, {
        anchorTaskId: reflow?.anchorTaskId,
        // Estimate items bridge CO line items → schedule tasks via
        // ScheduleTask.linkedEstimateItems (which stores materialIds).
        estimateItems: (project?.linkedEstimate?.items ?? []).map(i => ({ id: i.materialId, name: i.name })),
        actor,
      });

      if (result.plan.status === 'ready' && result.nextSchedule && result.coPatch && project) {
        const nextProjects = projects.map(p => p.id === project.id
          ? { ...p, schedule: result.nextSchedule!, updatedAt: now }
          : p);
        setProjects(nextProjects);
        saveProjectsMutation.mutate(nextProjects);
        const proj = nextProjects.find(p => p.id === project.id);
        if (proj) syncProjectToSupabase(proj, 'upsert');
        if (result.auditEntry) void appendAuditToAsyncStorage(project.id, result.auditEntry);

        committedCOs = updated.map(co => co.id === id ? { ...co, ...result.coPatch } : co);
        setChangeOrders(committedCOs);
        saveChangeOrdersMutation.mutate(committedCOs);
        console.log('[CO reflow]', result.plan.message);
      } else if (
        (result.plan.status === 'no_anchor' || result.plan.status === 'blocked') &&
        !hasUnanchoredMarker(nextCO)
      ) {
        // Honest instead of silent: the CO is approved and the days are real,
        // but nothing on the schedule can absorb them yet (nothing links to the
        // CO, or the dependency network has a loop the engine won't guess
        // through). Record that in the CO's own history (once) so the UI can
        // surface a "place these days" prompt rather than pretending the Gantt
        // already moved.
        const marker = buildUnanchoredCoAuditEntry(result.plan, { actor });
        committedCOs = updated.map(co => co.id === id
          ? { ...co, auditTrail: [...(co.auditTrail ?? []), marker] }
          : co);
        setChangeOrders(committedCOs);
        saveChangeOrdersMutation.mutate(committedCOs);
        console.log('[CO reflow] not applied —', result.plan.message);
      } else if (result.plan.status !== 'ready') {
        console.log('[CO reflow] skipped —', result.plan.status, result.plan.message);
      }
    }

    // Opportunistic leak grading: resolve leak_flag predictions for this
    // project on ANY transition to approved — money-only COs (no schedule
    // impact) are exactly the leak-recovery case, so gating this on
    // scheduleImpactDays > 0 meant leak flags never graded off their own
    // recovery. G4 fire-and-forget via gradingBus — never blocks the CO flow.
    if (becameApproved && nextCO?.projectId) fireGradingEvent(nextCO.projectId);

    if (canSync) {
      const co = committedCOs.find(c => c.id === id);
      if (co) {
        void supabaseWrite('change_orders', 'update', {
          id, description: co.description, reason: co.reason, line_items: co.lineItems,
          original_contract_value: co.originalContractValue, change_amount: co.changeAmount,
          new_contract_total: co.newContractTotal, status: co.status, approvers: co.approvers,
          audit_trail: co.auditTrail, revision: co.revision, updated_at: now,
          schedule_impact_days: co.scheduleImpactDays, schedule_impact_applied: co.scheduleImpactApplied,
        });
      }
    }
  }, [changeOrders, projects, saveChangeOrdersMutation, saveProjectsMutation, syncProjectToSupabase, canSync, user]);

  const getChangeOrdersForProject = useCallback((projectId: string) => {
    return changeOrders.filter(co => co.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [changeOrders]);

  const addInvoice = useCallback((invoice: Invoice) => {
    const finalInvoice: Invoice = {
      ...invoice,
      portalState: invoice.portalState ?? initialPortalState('invoice', invoice.projectId),
    };
    const updated = [finalInvoice, ...invoices];
    // Activation funnel: first invoice = first money action (drives take-rate).
    track(AnalyticsEvents.INVOICE_CREATED, {
      total_invoices: updated.length,
      type: finalInvoice.type,
      total_due: finalInvoice.totalDue,
    });
    setInvoices(updated);
    saveInvoicesMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('invoices', 'insert', {
        id: finalInvoice.id, user_id: userId, project_id: finalInvoice.projectId, number: finalInvoice.number,
        type: finalInvoice.type, progress_percent: finalInvoice.progressPercent, issue_date: finalInvoice.issueDate,
        due_date: finalInvoice.dueDate, payment_terms: finalInvoice.paymentTerms, notes: finalInvoice.notes,
        line_items: finalInvoice.lineItems, subtotal: finalInvoice.subtotal, tax_rate: finalInvoice.taxRate,
        tax_amount: finalInvoice.taxAmount, total_due: finalInvoice.totalDue, amount_paid: finalInvoice.amountPaid,
        status: finalInvoice.status, payments: finalInvoice.payments, created_at: finalInvoice.createdAt, updated_at: finalInvoice.updatedAt,
        qbo_sync_status: 'pending', portal_state: finalInvoice.portalState,
        // Retention + pay-link are cloud-backed as of the 20260713 migration —
        // without these they were local-only and lost on the next refetch.
        retention_percent: finalInvoice.retentionPercent ?? null,
        retention_amount: finalInvoice.retentionAmount ?? null,
        retention_released: finalInvoice.retentionReleased ?? null,
        retention_releases: finalInvoice.retentionReleases ?? null,
        pay_link_url: finalInvoice.payLinkUrl ?? null,
        pay_link_id: finalInvoice.payLinkId ?? null,
        // Contract-milestone provenance. Must be written on INSERT — it is
        // what stops the same milestone being billed a second time if the
        // milestone's own status flip never reaches project_contracts.
        source_milestone_id: finalInvoice.sourceMilestoneId ?? null,
        source_contract_id: finalInvoice.sourceContractId ?? null,
      });
      void import('@/utils/qboSync').then(m => m.triggerQboSync('invoice', 'upsert', finalInvoice.id));
    }
  }, [invoices, saveInvoicesMutation, canSync, userId, initialPortalState]);

  const updateInvoice = useCallback((id: string, updates: Partial<Invoice>) => {
    const now = new Date().toISOString();
    // Capture previous invoice state BEFORE mapping, so we can detect new payments.
    const prev = invoices.find(i => i.id === id);
    const updated = invoices.map(inv => {
      if (inv.id !== id) return inv;
      const next = { ...inv, ...updates, updatedAt: now } as Invoice;
      // Auto-flip to 'paid' when amount_paid catches up to total_due. Without
      // this, manual payment entries (check / cash / Zelle / ACH outside Stripe)
      // never flip the status field — read-time helpers compute it but anything
      // querying the raw status (AI digests, A/R, Supabase filters) sees stale
      // 'sent' or 'partially_paid'. The Stripe webhook does this server-side
      // already; this mirrors it for non-Stripe payment recording paths.
      if (
        next.status !== 'draft'
        && next.status !== 'paid'
        && (next.totalDue ?? 0) > 0
        && (next.amountPaid ?? 0) >= (next.totalDue ?? 0) - 0.01
      ) {
        next.status = 'paid';
      }
      return next;
    });
    setInvoices(updated);
    saveInvoicesMutation.mutate(updated);
    if (canSync) {
      const inv = updated.find(i => i.id === id);
      if (inv) {
        // Scope the write to the columns this edit actually touched. amount_paid,
        // payments, and status are ALSO written by the Stripe webhook when a
        // payment succeeds; a passive edit (notes, line items, retention release,
        // pay-link attach) that blindly rewrote them would clobber a
        // webhook-recorded payment with stale local state, silently un-collecting
        // real money. The offline-queue 'update' op only SETs the keys present,
        // so omitting a column leaves the webhook's value intact.
        const payload: Record<string, unknown> = { id, updated_at: now, qbo_sync_status: 'pending' };
        if ('notes' in updates) payload.notes = inv.notes;
        if ('lineItems' in updates) payload.line_items = inv.lineItems;
        if ('subtotal' in updates) payload.subtotal = inv.subtotal;
        if ('taxRate' in updates) payload.tax_rate = inv.taxRate;
        if ('taxAmount' in updates) payload.tax_amount = inv.taxAmount;
        if ('totalDue' in updates) payload.total_due = inv.totalDue;
        // Only write the webhook-owned reconciliation columns when this edit
        // changed a payment field (or explicitly set status).
        if ('amountPaid' in updates || 'payments' in updates) {
          payload.amount_paid = inv.amountPaid;
          payload.payments = inv.payments;
          payload.status = inv.status;
        } else if ('status' in updates) {
          payload.status = inv.status;
        }
        // Retention + pay-link (cloud-backed as of the 20260713 migration). Use
        // ?? null, NOT bare undefined: clearing a stale pay-link (set to
        // undefined when the total changes) must reach the DB as null, or the
        // omitted key leaves the old link and the client is shown a Pay button
        // for the wrong amount on the next refetch.
        if ('retentionPercent' in updates) payload.retention_percent = inv.retentionPercent ?? null;
        if ('retentionAmount' in updates) payload.retention_amount = inv.retentionAmount ?? null;
        if ('retentionReleased' in updates || 'retentionReleases' in updates) {
          payload.retention_released = inv.retentionReleased ?? null;
          payload.retention_releases = inv.retentionReleases ?? null;
        }
        if ('payLinkUrl' in updates || 'payLinkId' in updates) {
          payload.pay_link_url = inv.payLinkUrl ?? null;
          payload.pay_link_id = inv.payLinkId ?? null;
        }
        // Dunning markers are OWNED by the invoice-dunning edge function; the
        // app only ever echoes back the values that function just returned
        // from a confirmed send, so this write is idempotent and can't invent
        // a reminder that never went out. Scoped like every other column
        // above so an unrelated edit never touches the cadence.
        if ('dunningStage' in updates || 'dunningLastSentAt' in updates) {
          payload.dunning_stage = inv.dunningStage ?? null;
          payload.dunning_last_sent_at = inv.dunningLastSentAt ?? null;
        }
        void supabaseWrite('invoices', 'update', payload);
      }
      void import('@/utils/qboSync').then(m => m.triggerQboSync('invoice', 'upsert', id));
      // Detect newly-added MAGE-sourced payments and fire a payment sync for each.
      if (prev && updates.payments) {
        const prevIds = new Set(prev.payments.map(p => p.id));
        const newMagePayments = updates.payments.filter((p: { id: string; source?: string; qboId?: string }) =>
          !prevIds.has(p.id) && p.source !== 'qbo' && !p.qboId
        );
        for (const np of newMagePayments) {
          const paymentId = np.id;
          void import('@/utils/qboSync').then(m => m.triggerQboSync('payment', 'upsert', `${id}::${paymentId}`));
        }
      }
    }
  }, [invoices, saveInvoicesMutation, canSync]);

  const getInvoicesForProject = useCallback((projectId: string) => invoices.filter(inv => inv.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [invoices]);
  const getTotalOutstandingBalance = useCallback(() => invoices.filter(inv => inv.status !== 'paid' && inv.status !== 'draft').reduce((sum, inv) => sum + (inv.totalDue - inv.amountPaid), 0), [invoices]);

  // Commitments — signed sub contracts and POs. Core data for the job
  // costing dashboard (see utils/jobCostEngine.ts). Stored locally only;
  // no Supabase sync yet because the `commitments` table hasn't been
  // migrated. Offline-first writes still work through the same pattern.
  // Map a Commitment object to the snake_case shape the commitments table
  // wants. Pulled out so add/update can both call it.
  const commitmentToRow = useCallback((c: Commitment) => ({
    id: c.id,
    user_id: userId,
    project_id: c.projectId,
    number: c.number,
    type: c.type,
    subcontractor_id: c.subcontractorId ?? null,
    vendor_name: c.vendorName ?? null,
    description: c.description ?? '',
    amount: c.amount ?? 0,
    change_amount: c.changeAmount ?? null,
    signed_date: c.signedDate || null,
    phase: c.phase ?? null,
    csi_division: c.csiDivision ?? null,
    linked_estimate_items: c.linkedEstimateItems ?? null,
    status: c.status,
    notes: c.notes ?? null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  }), [userId]);

  const addCommitment = useCallback((c: Commitment) => {
    const updated = [c, ...commitments];
    setCommitments(updated);
    saveCommitmentsMutation.mutate(updated);
    if (canSync && userId) void supabaseWrite('commitments', 'insert', commitmentToRow(c));
  }, [commitments, saveCommitmentsMutation, canSync, userId, commitmentToRow]);

  const updateCommitment = useCallback((id: string, updates: Partial<Commitment>) => {
    const now = new Date().toISOString();
    const updated = commitments.map(c => c.id === id ? { ...c, ...updates, updatedAt: now } : c);
    setCommitments(updated);
    saveCommitmentsMutation.mutate(updated);
    const next = updated.find(c => c.id === id);
    if (canSync && userId && next) void supabaseWrite('commitments', 'update', commitmentToRow(next));
  }, [commitments, saveCommitmentsMutation, canSync, userId, commitmentToRow]);

  const deleteCommitment = useCallback((id: string) => {
    const updated = commitments.filter(c => c.id !== id);
    setCommitments(updated);
    saveCommitmentsMutation.mutate(updated);
    if (canSync) void supabaseWrite('commitments', 'delete', { id });
  }, [commitments, saveCommitmentsMutation, canSync]);

  const getCommitmentsForProject = useCallback(
    (projectId: string) => commitments.filter(c => c.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [commitments],
  );

  // Prequal packets — one per sub. We key packet lookup by sub id AND by
  // magic-link token (sub side) so the public route can resolve without
  // auth. Upsert semantics: re-submitting a packet overwrites the prior.
  const prequalToRow = useCallback((p: PrequalPacket) => ({
    id: p.id,
    user_id: userId,
    subcontractor_id: p.subcontractorId,
    project_id: p.projectId ?? null,
    status: p.status,
    criteria: p.criteria ?? {},
    financials: p.financials ?? {},
    safety: p.safety ?? {},
    insurance: p.insurance ?? {},
    licenses: p.licenses ?? [],
    w9_on_file: !!p.w9OnFile,
    w9_doc_path: p.w9DocPath ?? null,
    invite_token: p.inviteToken ?? null,
    invite_sent_at: p.inviteSentAt ?? null,
    invite_email: p.inviteEmail ?? null,
    submitted_at: p.submittedAt ?? null,
    reviewed_at: p.reviewedAt ?? null,
    reviewed_by: p.reviewedBy ?? null,
    auto_review_findings: p.autoReviewFindings ?? null,
    reviewer_notes: p.reviewerNotes ?? null,
    expires_at: p.expiresAt ?? null,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  }), [userId]);

  const upsertPrequalPacket = useCallback((packet: PrequalPacket) => {
    const isExisting = prequalPackets.some(p => p.id === packet.id);
    const updated = isExisting
      ? prequalPackets.map(p => p.id === packet.id ? packet : p)
      : [packet, ...prequalPackets];
    setPrequalPackets(updated);
    savePrequalMutation.mutate(updated);
    if (canSync && userId) {
      void supabaseWrite('prequal_packets', isExisting ? 'update' : 'insert', prequalToRow(packet));
    }
  }, [prequalPackets, savePrequalMutation, canSync, userId, prequalToRow]);

  const deletePrequalPacket = useCallback((id: string) => {
    const updated = prequalPackets.filter(p => p.id !== id);
    setPrequalPackets(updated);
    savePrequalMutation.mutate(updated);
    if (canSync) void supabaseWrite('prequal_packets', 'delete', { id });
  }, [prequalPackets, savePrequalMutation, canSync]);

  const getPrequalPacketForSub = useCallback(
    (subId: string) => prequalPackets.find(p => p.subcontractorId === subId) ?? null,
    [prequalPackets],
  );

  const getPrequalPacketByToken = useCallback(
    (token: string) => prequalPackets.find(p => p.inviteToken === token) ?? null,
    [prequalPackets],
  );

  // DFR Work Progress chips → schedule task progress propagation.
  // When the GC marks "Concrete Pour 100%" on a DFR, the linked schedule
  // task's `progress` field updates to match. This is the single biggest
  // "the app understands my work" moment: enter progress once on the DFR,
  // see it ripple to the Gantt + earned value + lookahead automatically.
  // Only ratchets UP — a later DFR that drops a task's percent doesn't
  // regress the schedule (avoids accidental rollback on a partial-day
  // report).
  const propagateProgressFromDFR = useCallback((report: DailyFieldReport) => {
    if (!report.workProgress || report.workProgress.length === 0) return;
    const proj = projects.find(p => p.id === report.projectId);
    if (!proj?.schedule?.tasks) return;
    let touched = false;
    const nextTasks = proj.schedule.tasks.map(t => {
      const chip = report.workProgress!.find(p => p.taskId === t.id);
      if (!chip) return t;
      const incoming = Math.max(0, Math.min(100, chip.pct));
      const current = t.progress ?? 0;
      if (incoming <= current) return t;
      touched = true;
      return { ...t, progress: incoming };
    });
    if (!touched) return;
    updateProject(proj.id, {
      schedule: { ...proj.schedule, tasks: nextTasks, updatedAt: new Date().toISOString() },
    });
  }, [projects, updateProject]);

  // A DFR carries its own copy of the photos it was filed with, and those are
  // mirrored into the gallery under the SAME ids — so both paths resolve to the
  // same deterministic storage path and the queue's dedupe means the bytes are
  // uploaded exactly once no matter which one runs first.
  const stageDfrPhotos = useCallback((report: DailyFieldReport): DailyFieldReport => {
    if (!report.photos || report.photos.length === 0) return report;
    let changed = false;
    const photos = report.photos.map((p) => {
      if (p.storagePath || !isDeviceLocalUri(p.uri)) return p;
      const storagePath = stagePhotoUpload({
        userId, projectId: report.projectId, recordId: p.id, localUri: p.uri,
      });
      if (!storagePath) return p;
      changed = true;
      return { ...p, storagePath, localUri: p.uri };
    });
    return changed ? { ...report, photos } : report;
  }, [userId]);

  const addDailyReport = useCallback((report: DailyFieldReport) => {
    const finalReport: DailyFieldReport = {
      ...stageDfrPhotos(report),
      portalState: report.portalState ?? initialPortalState('daily_report', report.projectId),
    };
    const updated = [finalReport, ...dailyReports];
    setDailyReports(updated);
    saveDailyReportsMutation.mutate(updated);
    propagateProgressFromDFR(finalReport);
    if (canSync) {
      void supabaseWrite('daily_reports', 'insert', {
        id: finalReport.id, user_id: userId, project_id: finalReport.projectId, date: finalReport.date,
        weather: finalReport.weather, manpower: finalReport.manpower, work_performed: finalReport.workPerformed,
        materials_delivered: finalReport.materialsDelivered, issues_and_delays: finalReport.issuesAndDelays,
        photos: dfrPhotoRows(finalReport.photos), status: finalReport.status,
        incident: finalReport.incident ?? null, work_progress: finalReport.workProgress ?? null,
        homeowner_summary: finalReport.homeownerSummary ?? null,
        homeowner_summary_generated_at: finalReport.homeownerSummaryGeneratedAt ?? null,
        homeowner_summary_published: finalReport.homeownerSummaryPublished ?? false,
        created_at: finalReport.createdAt, updated_at: finalReport.updatedAt,
        portal_state: finalReport.portalState,
      });
    }
  }, [dailyReports, saveDailyReportsMutation, canSync, userId, propagateProgressFromDFR, initialPortalState, stageDfrPhotos]);

  const updateDailyReport = useCallback((id: string, updates: Partial<DailyFieldReport>) => {
    const now = new Date().toISOString();
    const updated = dailyReports.map(dr => dr.id === id ? stageDfrPhotos({ ...dr, ...updates, updatedAt: now }) : dr);
    setDailyReports(updated);
    saveDailyReportsMutation.mutate(updated);
    const dr = updated.find(d => d.id === id);
    if (dr) propagateProgressFromDFR(dr);
    if (canSync) {
      if (dr) {
        void supabaseWrite('daily_reports', 'update', {
          id, weather: dr.weather, manpower: dr.manpower, work_performed: dr.workPerformed,
          materials_delivered: dr.materialsDelivered, issues_and_delays: dr.issuesAndDelays,
          photos: dfrPhotoRows(dr.photos), status: dr.status, updated_at: now,
          incident: dr.incident ?? null, work_progress: dr.workProgress ?? null,
          homeowner_summary: dr.homeownerSummary ?? null,
          homeowner_summary_generated_at: dr.homeownerSummaryGeneratedAt ?? null,
          homeowner_summary_published: dr.homeownerSummaryPublished ?? false,
        });
      }
    }
  }, [dailyReports, saveDailyReportsMutation, canSync, propagateProgressFromDFR, stageDfrPhotos]);

  const getDailyReportsForProject = useCallback((projectId: string) => dailyReports.filter(dr => dr.projectId === projectId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()), [dailyReports]);

  // ─────────────────────────────────────────────
  // T&M / extra-work field tickets
  // ─────────────────────────────────────────────
  // Same photo-durability contract as a DFR: the row that reaches Postgres
  // carries a STORAGE PATH, never a file:// URI, and the bytes ride the
  // photo-upload queue. A ticket photo is staged under its own id so the path
  // is deterministic and the upload is idempotent.
  const stageTicketPhotos = useCallback((ticket: FieldTicket): FieldTicket => {
    if (!ticket.photos || ticket.photos.length === 0) return ticket;
    let changed = false;
    const photos = ticket.photos.map((p) => {
      if (p.storagePath || !isDeviceLocalUri(p.uri)) return p;
      const storagePath = stagePhotoUpload({
        userId, projectId: ticket.projectId, recordId: p.id, localUri: p.uri,
      });
      if (!storagePath) return p;
      changed = true;
      return { ...p, storagePath, localUri: p.uri };
    });
    return changed ? { ...ticket, photos } : ticket;
  }, [userId]);

  const ticketPhotoRows = useCallback((photos: FieldTicketPhoto[] | undefined) =>
    (photos ?? []).map(p => ({ ...p, uri: p.storagePath ?? p.uri, localUri: undefined })), []);

  const fieldTicketRow = useCallback((t: FieldTicket) => ({
    id: t.id, user_id: userId, project_id: t.projectId, number: t.number, date: t.date,
    work_description: t.workDescription, reason_extra: t.reasonExtra,
    source_daily_report_id: t.sourceDailyReportId ?? null,
    labor: t.labor, materials: t.materials, equipment: t.equipment,
    photos: ticketPhotoRows(t.photos),
    markup_percent: t.markupPercent ?? 0, status: t.status,
    authorization: t.authorization ?? null,
    converted_change_order_id: t.convertedChangeOrderId ?? null,
    converted_at: t.convertedAt ?? null,
    audit_trail: t.auditTrail ?? null,
    created_at: t.createdAt, updated_at: t.updatedAt,
  }), [userId, ticketPhotoRows]);

  const addFieldTicket = useCallback((ticket: FieldTicket) => {
    const finalTicket = stageTicketPhotos(ticket);
    const updated = [finalTicket, ...fieldTickets];
    setFieldTickets(updated);
    saveFieldTicketsMutation.mutate(updated);
    if (canSync) void supabaseWrite('field_tickets', 'insert', fieldTicketRow(finalTicket));
  }, [fieldTickets, saveFieldTicketsMutation, canSync, stageTicketPhotos, fieldTicketRow]);

  /**
   * A signature is evidence. Once a ticket leaves 'draft' its captured content
   * is frozen — the owner's rep signed a specific set of hours and quantities
   * and those must not move underneath the signature. The guard lives HERE, at
   * the data layer, not only in the screen: a future caller that forgets to set
   * `editable={false}` still cannot rewrite signed work.
   *
   * Returns false (and writes nothing) when the update is refused.
   */
  const updateFieldTicket = useCallback((id: string, updates: Partial<FieldTicket>): boolean => {
    const prior = fieldTickets.find(t => t.id === id);
    if (!prior) return false;
    const violations = sealedFieldTicketViolations(prior, updates);
    if (violations.length > 0) {
      // Refuse the WHOLE update — a partial apply would be worse than a no-op.
      console.warn('[FieldTicket] refused edit to a signed ticket:', id, violations.join(', '));
      return false;
    }
    const now = new Date().toISOString();
    const updated = fieldTickets.map(t => t.id === id ? stageTicketPhotos({ ...t, ...updates, updatedAt: now }) : t);
    setFieldTickets(updated);
    saveFieldTicketsMutation.mutate(updated);
    const next = updated.find(t => t.id === id);
    if (canSync && next) void supabaseWrite('field_tickets', 'update', fieldTicketRow(next));
    return true;
  }, [fieldTickets, saveFieldTicketsMutation, canSync, stageTicketPhotos, fieldTicketRow]);

  const getFieldTicketsForProject = useCallback((projectId: string) =>
    fieldTickets.filter(t => t.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  [fieldTickets]);

  // ─────────────────────────────────────────────
  // Delay register (the claim-defense spine)
  // ─────────────────────────────────────────────

  const delayEventRow = useCallback((e: DelayEvent) => ({
    id: e.id, user_id: userId, project_id: e.projectId, number: e.number,
    cause: e.cause,
    first_observed_date: e.firstObservedDate,
    ended_date: e.endedDate ?? null,
    description: e.description,
    evidence: e.evidence ?? [],
    impacted_task_ids: e.impactedTaskIds ?? [],
    claimed_days: e.claimedDays ?? 0,
    concurrent_days: e.concurrentDays ?? null,
    notices: e.notices ?? [],
    classification: e.classification ?? 'unclassified',
    change_order_id: e.changeOrderId ?? null,
    audit_trail: e.auditTrail ?? null,
    created_at: e.createdAt, updated_at: e.updatedAt,
  }), [userId]);

  /**
   * Returns the created event so callers (the daily report, the weather
   * reschedule) can route straight to it without racing on closure refresh —
   * same pattern as addRFI / addLead.
   */
  const addDelayEvent = useCallback((event: DelayEvent): DelayEvent => {
    const updated = [event, ...delayEvents];
    setDelayEvents(updated);
    saveDelayEventsMutation.mutate(updated);
    if (canSync) void supabaseWrite('delay_events', 'insert', delayEventRow(event));
    return event;
  }, [delayEvents, saveDelayEventsMutation, canSync, delayEventRow]);

  const updateDelayEvent = useCallback((id: string, updates: Partial<DelayEvent>) => {
    const now = new Date().toISOString();
    const updated = delayEvents.map(e => e.id === id ? { ...e, ...updates, updatedAt: now } : e);
    setDelayEvents(updated);
    saveDelayEventsMutation.mutate(updated);
    const next = updated.find(e => e.id === id);
    if (canSync && next) void supabaseWrite('delay_events', 'update', delayEventRow(next));
  }, [delayEvents, saveDelayEventsMutation, canSync, delayEventRow]);

  const deleteDelayEvent = useCallback((id: string) => {
    const updated = delayEvents.filter(e => e.id !== id);
    setDelayEvents(updated);
    saveDelayEventsMutation.mutate(updated);
    if (canSync) void supabaseWrite('delay_events', 'delete', { id });
  }, [delayEvents, saveDelayEventsMutation, canSync]);

  /** Chronological — the order a claim narrative is told in. */
  const getDelayEventsForProject = useCallback((projectId: string) =>
    delayEvents.filter(e => e.projectId === projectId)
      .sort((a, b) => a.firstObservedDate.localeCompare(b.firstObservedDate)),
  [delayEvents]);

  // ─────────────────────────────────────────────
  // CRM / Leads
  // ─────────────────────────────────────────────
  // Returns the new Lead so callers (e.g. UniversalMicButton) can route
  // straight to /lead-detail without racing on closure refresh — same
  // pattern used by addRFI.
  const addLead = useCallback((lead: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'receivedAt'> & { id?: string; receivedAt?: string }): Lead => {
    const now = new Date().toISOString();
    const newLead: Lead = {
      ...lead,
      id: lead.id ?? generateUUID(),
      receivedAt: lead.receivedAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    const updated = [newLead, ...leads];
    setLeads(updated);
    saveLeadsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('leads', 'insert', {
        id: newLead.id, user_id: userId,
        name: newLead.name, phone: newLead.phone, email: newLead.email, address: newLead.address,
        project_type: newLead.projectType, project_type_mapped: newLead.projectTypeMapped,
        scope: newLead.scope, budget_min: newLead.budgetMin, budget_max: newLead.budgetMax,
        timeline: newLead.timeline, source: newLead.source, source_other: newLead.sourceOther,
        stage: newLead.stage, score: newLead.score, score_reason: newLead.scoreReason,
        received_at: newLead.receivedAt, first_responded_at: newLead.firstRespondedAt,
        touches: newLead.touches ?? [], converted_project_id: newLead.convertedProjectId,
        lost_reason: newLead.lostReason, created_at: now, updated_at: now,
      });
    }
    return newLead;
  }, [leads, saveLeadsMutation, canSync, userId]);

  const updateLead = useCallback((id: string, updates: Partial<Lead>) => {
    const now = new Date().toISOString();
    const updated = leads.map(l => l.id === id ? { ...l, ...updates, updatedAt: now } : l);
    setLeads(updated);
    saveLeadsMutation.mutate(updated);
    if (canSync) {
      const l = updated.find(x => x.id === id);
      if (l) {
        void supabaseWrite('leads', 'update', {
          id, name: l.name, phone: l.phone, email: l.email, address: l.address,
          project_type: l.projectType, project_type_mapped: l.projectTypeMapped,
          scope: l.scope, budget_min: l.budgetMin, budget_max: l.budgetMax,
          timeline: l.timeline, source: l.source, source_other: l.sourceOther,
          stage: l.stage, score: l.score, score_reason: l.scoreReason,
          received_at: l.receivedAt, first_responded_at: l.firstRespondedAt,
          touches: l.touches ?? [], converted_project_id: l.convertedProjectId,
          lost_reason: l.lostReason, updated_at: now,
        });
      }
    }
  }, [leads, saveLeadsMutation, canSync]);

  const deleteLead = useCallback((id: string) => {
    const updated = leads.filter(l => l.id !== id);
    setLeads(updated);
    saveLeadsMutation.mutate(updated);
    if (canSync) void supabaseWrite('leads', 'delete', { id });
  }, [leads, saveLeadsMutation, canSync]);

  const getLead = useCallback((id: string) => leads.find(l => l.id === id) ?? null, [leads]);

  const getLeadsByStage = useCallback((stage: LeadStage) => leads.filter(l => l.stage === stage), [leads]);

  /** Append a touch (call/text/email/etc) to a lead's activity log. If
   *  this is the first touch and firstRespondedAt isn't set, stamp it
   *  now — drives the "responded in Xh" KPI on the pipeline screen. */
  const addLeadTouch = useCallback((leadId: string, kind: LeadTouch['kind'], body: string, byName?: string) => {
    const now = new Date().toISOString();
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    const touch: LeadTouch = {
      id: generateUUID(),
      kind, body, occurredAt: now, byName,
    };
    const nextTouches = [touch, ...(lead.touches ?? [])];
    const firstRespondedAt = lead.firstRespondedAt
      ?? (kind !== 'note' ? now : undefined);
    updateLead(leadId, { touches: nextTouches, firstRespondedAt });
  }, [leads, updateLead]);

  /** Convert a 'won' lead into a real Project. Idempotent — if already
   *  converted, returns the existing project id. */
  const convertLeadToProject = useCallback((leadId: string): string | null => {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return null;
    if (lead.convertedProjectId) return lead.convertedProjectId;
    const now = new Date().toISOString();
    const projectId = generateUUID();
    // Use the inline addProject path so we don't introduce a new
    // dependency between callbacks here.
    // Carry the homeowner contact + lead-source + timeline-notes across
    // so the GC doesn't re-key phone/email after winning the lead, and so
    // win-rate-by-source analytics keep working post-conversion.
    const primaryContact = (lead.phone || lead.email || lead.name)
      ? {
          name: lead.name || undefined,
          phone: lead.phone || undefined,
          email: lead.email || undefined,
        }
      : undefined;
    const newProject: Project = {
      id: projectId,
      name: lead.name + (lead.projectType ? ` — ${lead.projectType}` : ''),
      type: (lead.projectTypeMapped ?? 'renovation') as ProjectType,
      location: lead.address ?? 'United States',
      squareFootage: 0,
      quality: 'standard',
      description: lead.scope ?? '',
      status: 'estimated',
      estimate: null,
      schedule: null,
      targetBudget: lead.budgetMax && lead.budgetMax > 0
        ? { amount: lead.budgetMax, setAt: now, setBy: 'gc' }
        : (lead.budgetMin && lead.budgetMin > 0
            ? { amount: lead.budgetMin, setAt: now, setBy: 'gc' }
            : undefined),
      primaryContact,
      leadSource: lead.source || undefined,
      targetTimelineNotes: lead.timeline || undefined,
      createdAt: now,
      updatedAt: now,
    };
    setProjects(prev => [newProject, ...prev]);
    saveProjectsMutation.mutate([newProject, ...projects]);
    if (canSync) {
      void supabaseWrite('projects', 'insert', {
        id: projectId, user_id: userId, name: newProject.name, type: newProject.type,
        location: newProject.location, square_footage: 0, quality: 'standard',
        description: newProject.description, status: newProject.status,
        target_budget: newProject.targetBudget,
        primary_contact: newProject.primaryContact ?? null,
        lead_source: newProject.leadSource ?? null,
        target_timeline_notes: newProject.targetTimelineNotes ?? null,
        created_at: now, updated_at: now,
      });
    }
    updateLead(leadId, { stage: 'won', convertedProjectId: projectId });
    return projectId;
  }, [leads, projects, saveProjectsMutation, canSync, userId, updateLead]);

  // ─────────────────────────────────────────────
  // Buyout — Bid Packages + Bids
  // ─────────────────────────────────────────────
  const addBidPackage = useCallback((pkg: Omit<BidPackage, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): BidPackage => {
    const now = new Date().toISOString();
    const newPkg: BidPackage = {
      ...pkg,
      id: pkg.id ?? generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const updated = [newPkg, ...bidPackages];
    setBidPackages(updated);
    saveBidPackagesMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('bid_packages', 'insert', {
        id: newPkg.id, user_id: userId, project_id: newPkg.projectId,
        name: newPkg.name, csi_division: newPkg.csiDivision, phase: newPkg.phase,
        scope_description: newPkg.scopeDescription,
        linked_estimate_item_ids: newPkg.linkedEstimateItemIds,
        estimate_budget: newPkg.estimateBudget, status: newPkg.status,
        due_date: newPkg.dueDate, required_by_date: newPkg.requiredByDate,
        awarded_bid_id: newPkg.awardedBidId, awarded_commitment_id: newPkg.awardedCommitmentId,
        buyout_savings: newPkg.buyoutSavings, notes: newPkg.notes,
        created_at: now, updated_at: now,
      });
    }
    return newPkg;
  }, [bidPackages, saveBidPackagesMutation, canSync, userId]);

  const updateBidPackage = useCallback((id: string, updates: Partial<BidPackage>) => {
    const now = new Date().toISOString();
    const updated = bidPackages.map(p => p.id === id ? { ...p, ...updates, updatedAt: now } : p);
    setBidPackages(updated);
    saveBidPackagesMutation.mutate(updated);
    if (canSync) {
      const p = updated.find(x => x.id === id);
      if (p) {
        void supabaseWrite('bid_packages', 'update', {
          id, name: p.name, csi_division: p.csiDivision, phase: p.phase,
          scope_description: p.scopeDescription,
          linked_estimate_item_ids: p.linkedEstimateItemIds,
          estimate_budget: p.estimateBudget, status: p.status,
          due_date: p.dueDate, required_by_date: p.requiredByDate,
          awarded_bid_id: p.awardedBidId, awarded_commitment_id: p.awardedCommitmentId,
          buyout_savings: p.buyoutSavings, notes: p.notes, updated_at: now,
        });
      }
    }
  }, [bidPackages, saveBidPackagesMutation, canSync]);

  const deleteBidPackage = useCallback((id: string) => {
    const updated = bidPackages.filter(p => p.id !== id);
    setBidPackages(updated);
    saveBidPackagesMutation.mutate(updated);
    // Cascade: also drop the bids for this package locally.
    const remainingBids = bidPackageBids.filter(b => b.packageId !== id);
    setBidPackageBids(remainingBids);
    saveBidPackageBidsMutation.mutate(remainingBids);
    if (canSync) void supabaseWrite('bid_packages', 'delete', { id });
  }, [bidPackages, bidPackageBids, saveBidPackagesMutation, saveBidPackageBidsMutation, canSync]);

  const getBidPackagesForProject = useCallback((projectId: string) =>
    bidPackages.filter(p => p.projectId === projectId), [bidPackages]);

  const getBidPackage = useCallback((id: string) =>
    bidPackages.find(p => p.id === id) ?? null, [bidPackages]);

  // Bids
  const addBidPackageBid = useCallback((bid: Omit<BidPackageBid, 'id' | 'createdAt' | 'updatedAt' | 'submittedAt'> & { id?: string; submittedAt?: string }): BidPackageBid => {
    const now = new Date().toISOString();
    const newBid: BidPackageBid = {
      ...bid,
      id: bid.id ?? generateUUID(),
      submittedAt: bid.submittedAt ?? now,
      createdAt: now,
      updatedAt: now,
    };
    const updated = [newBid, ...bidPackageBids];
    setBidPackageBids(updated);
    saveBidPackageBidsMutation.mutate(updated);
    // If the package was 'open', auto-promote it to 'leveling' on first bid.
    const pkg = bidPackages.find(p => p.id === bid.packageId);
    if (pkg && pkg.status === 'open') {
      updateBidPackage(pkg.id, { status: 'leveling' });
    }
    if (canSync) {
      void supabaseWrite('bid_package_bids', 'insert', {
        id: newBid.id, user_id: userId, package_id: newBid.packageId,
        subcontractor_id: newBid.subcontractorId, vendor_name: newBid.vendorName,
        amount: newBid.amount, includes: newBid.includes, excludes: newBid.excludes,
        terms: newBid.terms, source: newBid.source, status: newBid.status,
        submitted_at: newBid.submittedAt,
        normalized_adjustment: newBid.normalizedAdjustment,
        normalized_adjustment_reason: newBid.normalizedAdjustmentReason,
        notes: newBid.notes, created_at: now, updated_at: now,
      });
    }
    return newBid;
  }, [bidPackages, bidPackageBids, saveBidPackageBidsMutation, updateBidPackage, canSync, userId]);

  const updateBidPackageBid = useCallback((id: string, updates: Partial<BidPackageBid>) => {
    const now = new Date().toISOString();
    const updated = bidPackageBids.map(b => b.id === id ? { ...b, ...updates, updatedAt: now } : b);
    setBidPackageBids(updated);
    saveBidPackageBidsMutation.mutate(updated);
    if (canSync) {
      const b = updated.find(x => x.id === id);
      if (b) {
        void supabaseWrite('bid_package_bids', 'update', {
          id, subcontractor_id: b.subcontractorId, vendor_name: b.vendorName,
          amount: b.amount, includes: b.includes, excludes: b.excludes,
          terms: b.terms, source: b.source, status: b.status,
          normalized_adjustment: b.normalizedAdjustment,
          normalized_adjustment_reason: b.normalizedAdjustmentReason,
          notes: b.notes, updated_at: now,
        });
      }
    }
  }, [bidPackageBids, saveBidPackageBidsMutation, canSync]);

  const deleteBidPackageBid = useCallback((id: string) => {
    const updated = bidPackageBids.filter(b => b.id !== id);
    setBidPackageBids(updated);
    saveBidPackageBidsMutation.mutate(updated);
    if (canSync) void supabaseWrite('bid_package_bids', 'delete', { id });
  }, [bidPackageBids, saveBidPackageBidsMutation, canSync]);

  const getBidsForPackage = useCallback((packageId: string) =>
    bidPackageBids.filter(b => b.packageId === packageId), [bidPackageBids]);

  /** Award a bid: creates a Commitment, marks the package awarded,
   *  computes buyout savings, and locks any allowance items linked to
   *  this package to firm price. Idempotent — if already awarded,
   *  returns the existing commitment id.
   *
   *  Implementation note: this orchestrates 4 state updates (commitments,
   *  bidPackages, bidPackageBids, projects) and we want them to land
   *  atomically without stale-closure reads. We compute every "next"
   *  array up front from the closure-captured arrays once, then batch
   *  the setState + persist + Supabase-sync calls. No use of the
   *  per-row update* helpers here, because each one would re-read
   *  this callback's closure version of state and re-execute the
   *  Supabase write paths separately. */
  const awardBidPackage = useCallback((packageId: string, bidId: string): string | null => {
    const pkg = bidPackages.find(p => p.id === packageId);
    const bid = bidPackageBids.find(b => b.id === bidId);
    if (!pkg || !bid) return null;
    if (pkg.awardedCommitmentId) return pkg.awardedCommitmentId;
    // Defensive: refuse a bid that doesn't belong to this package.
    // Code-review #3.
    if (bid.packageId !== packageId) {
      console.warn('[awardBidPackage] bid.packageId mismatch — refusing', { packageId, bidPackageId: bid.packageId });
      return null;
    }
    // Defensive: refuse a $0 bid (voice transcripts where the parser
    // failed to extract a number return amount: 0 — awarding would
    // create a phantom commitment with the full estimate as "savings").
    // Code-review #4.
    if (!bid.amount || bid.amount <= 0) {
      console.warn('[awardBidPackage] zero / negative bid amount — refusing');
      return null;
    }
    const now = new Date().toISOString();
    // Committed cost = the ACTUAL awarded bid price. This is what the sub is
    // owed and what the signed subcontract locks in (the A401 contractSum in
    // buyout-package.tsx uses bid.amount), so the commitment must match it.
    // Buyout savings = budget - committed price.
    //
    // normalizedAdjustment (the AI "leveled total" that estimates the cost of
    // scope this bid EXCLUDES) is kept as a comparison-only field on the bid.
    // It is deliberately NOT folded into the sub's committed cost — doing so
    // overstated what we owe this sub and understated the buyout savings, and
    // contradicted the subcontract. Any excluded scope is surfaced separately
    // below as "uncovered scope" for reference, not baked into the commitment.
    const committedAmount = bid.amount;
    const savings = pkg.estimateBudget - committedAmount;
    // Estimated cost of scope the awarded bid excludes (AI-leveled). Reference
    // only — this is uncovered scope the GC still has to place elsewhere, not
    // part of this sub's commitment amount.
    const uncoveredScope = bid.normalizedAdjustment ?? 0;
    // Sequential commitment number per project (mirrors addChangeOrder's
    // pattern — code-review #11). Avoids the slim collision risk of the
    // 6-char UUID prefix and reads better on documents the GC sends out.
    const projectCommitments = commitments.filter(c => c.projectId === pkg.projectId);
    // max(existing BO-N) + 1, not length + 1 — deleting a commitment must not
    // reissue an already-used BO number on documents the GC sends out.
    const maxBo = projectCommitments.reduce((max, c) => {
      const n = parseInt(String(c.number ?? '').replace(/^BO-/, ''), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    const nextNumber = `BO-${maxBo + 1}`;
    const commitmentId = generateUUID();
    const commitment: Commitment = {
      id: commitmentId,
      projectId: pkg.projectId,
      number: nextNumber,
      type: 'subcontract',
      subcontractorId: bid.subcontractorId,
      vendorName: bid.vendorName,
      description: pkg.name + (bid.includes ? ` — ${bid.includes}` : ''),
      amount: committedAmount,
      signedDate: now,
      phase: pkg.phase,
      csiDivision: pkg.csiDivision,
      linkedEstimateItems: pkg.linkedEstimateItemIds,
      status: 'active',
      // Force en-US locale so the saved notes are consistent regardless
      // of device locale (code-review #7).
      notes: `Awarded from buyout package "${pkg.name}". Buyout ${savings >= 0 ? 'savings' : 'overrun'}: $${Math.abs(savings).toLocaleString('en-US')}.${uncoveredScope > 0 ? ` Uncovered scope excluded by this bid (est., not in commitment): $${uncoveredScope.toLocaleString('en-US')}.` : ''}`,
      createdAt: now,
      updatedAt: now,
    };

    // ── Pre-compute every next array atomically (code-review #2 + #6) ──
    // Each state slice is updated using its closure-captured value
    // exactly once, so two awards in quick succession can't lose data
    // through stale-closure reads.
    const nextCommitments = [commitment, ...commitments];
    const nextPackages = bidPackages.map(p =>
      p.id === packageId
        ? { ...p, status: 'awarded' as BidPackageStatus, awardedBidId: bidId, awardedCommitmentId: commitmentId, buyoutSavings: savings, updatedAt: now }
        : p,
    );
    const nextBids = bidPackageBids.map(b =>
      b.id === bidId
        ? { ...b, status: 'awarded' as BuyoutBidStatus, updatedAt: now }
        : b,
    );

    // Allowance → firm-price conversion. Any estimate items linked to
    // this package that were flagged isAllowance get locked: cleared
    // isAllowance, stamped firmPricedAt. The portal + budget pick up
    // the new firm number on the next render.
    let nextProjects = projects;
    let updatedProject: Project | null = null;
    if (pkg.linkedEstimateItemIds.length > 0) {
      const proj = projects.find(p => p.id === pkg.projectId);
      const linkedEstimate = proj?.linkedEstimate;
      if (proj && linkedEstimate && linkedEstimate.items.some(i => pkg.linkedEstimateItemIds.includes(i.materialId) && i.isAllowance)) {
        // H7: snapshot the CURRENT estimate (pre-buyout) before we mutate
        // it to firm prices. snapshotPatch appends to proj.estimateVersions
        // (the fresh array just read from closure state) so the result
        // is always monotonically growing — stale-closure clobber
        // is impossible because we read from `proj` here, not from a
        // separately-captured array that could be behind.
        const preBuyoutPatch = snapshotPatch(proj, 'pre_overwrite', 'pre-buyout snapshot');
        const updatedItems = linkedEstimate.items.map(item => {
          if (pkg.linkedEstimateItemIds.includes(item.materialId) && item.isAllowance) {
            return { ...item, isAllowance: false, firmPricedAt: now };
          }
          return item;
        });
        // Spread preBuyoutPatch (which may contain estimateVersions with the
        // appended revision) into updatedProject so the single Supabase upsert
        // carries BOTH the firm-priced estimate AND the updated version history.
        updatedProject = { ...proj, ...preBuyoutPatch, linkedEstimate: { ...linkedEstimate, items: updatedItems }, updatedAt: now };
        nextProjects = projects.map(p => p.id === pkg.projectId ? updatedProject! : p);
      }
    }

    // ── Apply all state updates ──
    setCommitments(nextCommitments);
    saveCommitmentsMutation.mutate(nextCommitments);

    setBidPackages(nextPackages);
    saveBidPackagesMutation.mutate(nextPackages);

    setBidPackageBids(nextBids);
    saveBidPackageBidsMutation.mutate(nextBids);

    if (updatedProject) {
      setProjects(nextProjects);
      saveProjectsMutation.mutate(nextProjects);
      // Critical fix (code-review #1): sync the firm-priced project
      // back to Supabase so the homeowner portal sees the locked
      // numbers, not the old allowance carry. Without this the
      // allowance lockdown was local-only.
      syncProjectToSupabase(updatedProject, 'upsert');
    }

    // Sync the package + bid updates to Supabase too. We don't use the
    // per-row updaters here (those would have refired stale closures);
    // we issue the writes directly instead.
    if (canSync) {
      void supabaseWrite('bid_packages', 'update', {
        id: packageId, name: pkg.name, csi_division: pkg.csiDivision, phase: pkg.phase,
        scope_description: pkg.scopeDescription,
        linked_estimate_item_ids: pkg.linkedEstimateItemIds,
        estimate_budget: pkg.estimateBudget, status: 'awarded',
        due_date: pkg.dueDate, required_by_date: pkg.requiredByDate,
        awarded_bid_id: bidId, awarded_commitment_id: commitmentId,
        buyout_savings: savings, notes: pkg.notes, updated_at: now,
      });
      void supabaseWrite('bid_package_bids', 'update', {
        id: bidId, subcontractor_id: bid.subcontractorId, vendor_name: bid.vendorName,
        amount: bid.amount, includes: bid.includes, excludes: bid.excludes,
        terms: bid.terms, source: bid.source, status: 'awarded',
        normalized_adjustment: bid.normalizedAdjustment,
        normalized_adjustment_reason: bid.normalizedAdjustmentReason,
        notes: bid.notes, updated_at: now,
      });
    }

    return commitmentId;
  }, [bidPackages, bidPackageBids, commitments, projects, saveCommitmentsMutation, saveBidPackagesMutation, saveBidPackageBidsMutation, saveProjectsMutation, syncProjectToSupabase, canSync]);

  // ── Client Portal Send / Recall / Batch ───────────────────────────────────
  //
  // These actions mutate per-item portalState + write a notification row to
  // portal_messages. The supabaseWrite offline queue handles network failures
  // — the optimistic local mutation always lands; the server sync flushes
  // when connectivity returns.
  //
  // Snapshot capture: we serialize the item to a JSON string capped at 32KB
  // and stash it on portalState.lastSentSnapshot. portalSnapshot.ts reads
  // this when present, so edits after Send never reach the client.

  const MAX_SNAPSHOT_BYTES = 32_000;

  const captureSnapshot = (item: unknown): string => {
    try {
      const raw = JSON.stringify(item);
      return raw.length > MAX_SNAPSHOT_BYTES ? raw.slice(0, MAX_SNAPSHOT_BYTES) : raw;
    } catch { return ''; }
  };

  const itemTypeLabel: Record<SendableItemKind, string> = {
    change_order: 'Change Order', invoice: 'Invoice', aia_pay_app: 'AIA Pay Application',
    rfi: 'RFI', submittal: 'Submittal',
    daily_report: 'Daily Report', photo: 'Photo', selection: 'Selection', warranty: 'Warranty',
  };

  const tableForKind: Record<SendableItemKind, string> = {
    change_order: 'change_orders', invoice: 'invoices', aia_pay_app: 'aia_pay_apps',
    rfi: 'rfis', submittal: 'submittals',
    daily_report: 'daily_reports', photo: 'photos',
    selection: 'selection_categories', warranty: 'warranties',
  };

  const findItemByKindAndId = useCallback(
    (kind: SendableItemKind, itemId: string): unknown => {
      switch (kind) {
        case 'change_order': return changeOrders.find(i => i.id === itemId);
        case 'invoice':      return invoices.find(i => i.id === itemId);
        case 'aia_pay_app':  return aiaPayApps.find(i => i.id === itemId);
        case 'rfi':          return rfis.find(i => i.id === itemId);
        case 'submittal':    return submittals.find(i => i.id === itemId);
        case 'daily_report': return dailyReports.find(i => i.id === itemId);
        case 'photo':        return projectPhotos.find(i => i.id === itemId);
        case 'selection':    return undefined; // managed outside ProjectContext via selectionsEngine
        case 'warranty':     return warranties.find(i => i.id === itemId);
      }
    },
    [changeOrders, invoices, aiaPayApps, rfis, submittals, dailyReports, projectPhotos, warranties],
  );

  const updateItemPortalState = useCallback(
    (kind: SendableItemKind, itemId: string, next: PortalState) => {
      const setNext = <T extends { id: string; portalState?: PortalState }>(list: T[]): T[] =>
        list.map(i => i.id === itemId ? { ...i, portalState: next } : i);
      switch (kind) {
        case 'change_order': setChangeOrders(setNext); break;
        case 'invoice':      setInvoices(setNext); break;
        case 'aia_pay_app':  setAiaPayApps(setNext); break;
        case 'rfi':          setRfis(setNext); break;
        case 'submittal':    setSubmittals(setNext); break;
        case 'daily_report': setDailyReports(setNext); break;
        case 'photo':        setProjectPhotos(setNext); break;
        case 'selection':    break; // no-op — managed outside ProjectContext
        case 'warranty':     setWarranties(setNext); break;
      }
    },
    [setChangeOrders, setInvoices, setAiaPayApps, setRfis, setSubmittals, setDailyReports, setProjectPhotos, setWarranties],
  );

  const sendToClientPortal = useCallback(async ({ kind, itemId, projectId }: { kind: SendableItemKind; itemId: string; projectId: string }): Promise<void> => {
    const item = findItemByKindAndId(kind, itemId);
    if (!item) throw new Error(`Item not found: ${kind}/${itemId}`);

    const prevVersion = (item as { portalState?: PortalState }).portalState?.sentVersion ?? 0;
    const nextPortalState: PortalState = {
      status: 'sent',
      sentAt: new Date().toISOString(),
      sentVersion: prevVersion + 1,
      lastSentSnapshot: captureSnapshot(item),
      // viewedAt cleared on re-send. New sends have no viewedAt.
    };

    updateItemPortalState(kind, itemId, nextPortalState);

    const proj = projects.find(p => p.id === projectId);
    const portalId = proj?.clientPortal?.portalId;

    if (canSync && userId) {
      void supabaseWrite(tableForKind[kind], 'update', {
        id: itemId,
        portal_state: nextPortalState,
        updated_at: new Date().toISOString(),
      });
      if (portalId) {
        void supabaseWrite('portal_messages', 'insert', {
          portal_id: portalId,
          project_id: projectId,
          author_type: 'gc',
          body: `📋 New ${itemTypeLabel[kind]} from your builder. Tap to review.`,
          created_at: new Date().toISOString(),
        });
      }
    }
  }, [canSync, userId, projects, findItemByKindAndId, updateItemPortalState]);

  const recallFromClientPortal = useCallback(async ({ kind, itemId, projectId }: { kind: SendableItemKind; itemId: string; projectId: string }): Promise<void> => {
    const item = findItemByKindAndId(kind, itemId);
    if (!item) throw new Error(`Item not found: ${kind}/${itemId}`);

    const prev = (item as { portalState?: PortalState }).portalState;
    const nextPortalState: PortalState = {
      ...prev,
      status: 'recalled',
    };
    updateItemPortalState(kind, itemId, nextPortalState);

    const proj = projects.find(p => p.id === projectId);
    const portalId = proj?.clientPortal?.portalId;

    if (canSync && userId) {
      void supabaseWrite(tableForKind[kind], 'update', {
        id: itemId,
        portal_state: nextPortalState,
        updated_at: new Date().toISOString(),
      });
      if (portalId) {
        void supabaseWrite('portal_messages', 'insert', {
          portal_id: portalId,
          project_id: projectId,
          author_type: 'gc',
          body: `Your builder removed a previously shared ${itemTypeLabel[kind]} — please disregard.`,
          created_at: new Date().toISOString(),
        });
      }
    }
  }, [canSync, userId, projects, findItemByKindAndId, updateItemPortalState]);

  const batchSendToClientPortal = useCallback(async (
    { items, projectId }: { items: { kind: SendableItemKind; itemId: string }[]; projectId: string },
  ): Promise<{ sent: number }> => {
    if (!items.length) return { sent: 0 };

    // Mutate each item's local state + queue the per-row table updates.
    // CRITICAL: do NOT call sendToClientPortal in a loop — that would
    // create N portal_messages rows. Inline the mutations here, then write
    // exactly ONE consolidated portal_messages summary row at the end.
    const nowIso = new Date().toISOString();
    let sent = 0;
    const counts: Partial<Record<SendableItemKind, number>> = {};
    for (const { kind, itemId } of items) {
      const item = findItemByKindAndId(kind, itemId);
      if (!item) continue;
      const prevVersion = (item as { portalState?: PortalState }).portalState?.sentVersion ?? 0;
      const next: PortalState = {
        status: 'sent',
        sentAt: nowIso,
        sentVersion: prevVersion + 1,
        lastSentSnapshot: captureSnapshot(item),
      };
      updateItemPortalState(kind, itemId, next);
      if (canSync && userId) {
        void supabaseWrite(tableForKind[kind], 'update', {
          id: itemId,
          portal_state: next,
          updated_at: nowIso,
        });
      }
      counts[kind] = (counts[kind] ?? 0) + 1;
      sent++;
    }

    // Build a consolidated summary message: "3 new updates from your builder:
    // 1 Change Order, 1 RFI, 1 Daily Report"
    const proj = projects.find(p => p.id === projectId);
    const portalId = proj?.clientPortal?.portalId;

    if (canSync && userId && portalId) {
      const parts: string[] = [];
      for (const k of Object.keys(counts) as SendableItemKind[]) {
        const n = counts[k]!;
        parts.push(`${n} ${itemTypeLabel[k]}${n === 1 ? '' : 's'}`);
      }
      const body = `${sent} new update${sent === 1 ? '' : 's'} from your builder: ${parts.join(', ')}`;
      void supabaseWrite('portal_messages', 'insert', {
        portal_id: portalId,
        project_id: projectId,
        author_type: 'gc',
        body,
        created_at: nowIso,
      });
    }

    return { sent };
  }, [canSync, userId, projects, findItemByKindAndId, updateItemPortalState]);

  const addSubcontractor = useCallback((sub: Subcontractor) => {
    const updated = [sub, ...subcontractors];
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('subcontractors', 'insert', {
        id: sub.id, user_id: userId, company_name: sub.companyName, contact_name: sub.contactName,
        phone: sub.phone, email: sub.email, address: sub.address, trade: sub.trade,
        license_number: sub.licenseNumber, license_expiry: sub.licenseExpiry, coi_expiry: sub.coiExpiry,
        w9_on_file: sub.w9OnFile, bid_history: sub.bidHistory, assigned_projects: sub.assignedProjects,
        notes: sub.notes, created_at: sub.createdAt, updated_at: sub.updatedAt,
      });
    }
  }, [subcontractors, saveSubsMutation, canSync, userId]);

  const updateSubcontractor = useCallback((id: string, updates: Partial<Subcontractor>) => {
    const now = new Date().toISOString();
    const updated = subcontractors.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s);
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) {
      const s = updated.find(x => x.id === id);
      if (s) {
        void supabaseWrite('subcontractors', 'update', {
          id, company_name: s.companyName, contact_name: s.contactName, phone: s.phone, email: s.email,
          address: s.address, trade: s.trade, license_number: s.licenseNumber, license_expiry: s.licenseExpiry,
          coi_expiry: s.coiExpiry, w9_on_file: s.w9OnFile, bid_history: s.bidHistory,
          assigned_projects: s.assignedProjects, notes: s.notes, updated_at: now,
        });
      }
    }
  }, [subcontractors, saveSubsMutation, canSync]);

  const deleteSubcontractor = useCallback((id: string) => {
    const updated = subcontractors.filter(s => s.id !== id);
    setSubcontractors(updated);
    saveSubsMutation.mutate(updated);
    if (canSync) void supabaseWrite('subcontractors', 'delete', { id });
  }, [subcontractors, saveSubsMutation, canSync]);

  const getSubcontractor = useCallback((id: string) => subcontractors.find(s => s.id === id) ?? null, [subcontractors]);

  // A punch photo is the deficiency's evidence — it has to outlive the device
  // that shot it. Same treatment as the gallery: bytes onto the upload queue,
  // durable path onto the row, local URI kept for rendering. Keyed
  // `punch-<id>` so it can't collide with the gallery photo of the same id.
  const stagePunchPhoto = useCallback((item: PunchItem): PunchItem => {
    if (!item.photoUri || !isDeviceLocalUri(item.photoUri)) return item;
    // Already staged THIS exact file — every unrelated edit (status change,
    // reassignment, closing the item) runs through here, and re-staging would
    // re-copy the image to disk each time. A genuinely replaced photo has a
    // different URI and does fall through.
    if (item.photoStoragePath && item.photoLocalUri === item.photoUri) return item;
    const storagePath = stagePhotoUpload({
      userId, projectId: item.projectId, recordId: `punch-${item.id}`, localUri: item.photoUri,
    });
    if (!storagePath) return item;
    return { ...item, photoStoragePath: storagePath, photoLocalUri: item.photoUri };
  }, [userId]);

  // Snake/camel mapping for the punch_items insert payload — shared by the
  // single-add and batch-add paths so they stay byte-identical.
  const punchItemToRow = useCallback((item: PunchItem) => ({
    id: item.id, user_id: userId, project_id: item.projectId, description: item.description,
    location: item.location, assigned_sub: item.assignedSub, assigned_sub_id: item.assignedSubId,
    due_date: item.dueDate, priority: item.priority, status: item.status,
    // Durable path, never the local `file://`.
    // `|| null` because punch_items.photo_uri is nullable and "no photo" must
    // stay NULL — photos.uri is NOT NULL, so that one keeps the empty string.
    photo_uri: durablePhotoValue(item.photoStoragePath, item.photoUri) || null,
    // Plan-pin anchor + captured GPS. Client camelCase → snake_case column
    // (see migration 20260707120000_punch_location.sql). Previously omitted,
    // so this data was captured locally then silently dropped on sync.
    plan_sheet_id: item.planSheetId, pin_x: item.pinX, pin_y: item.pinY,
    photo_latitude: item.photoLatitude, photo_longitude: item.photoLongitude,
    photo_accuracy_meters: item.photoLocationAccuracyMeters,
    photo_location_label: item.photoLocationLabel,
    rejection_note: item.rejectionNote, closed_at: item.closedAt,
    created_at: item.createdAt, updated_at: item.updatedAt,
  }), [userId]);

  const addPunchItem = useCallback((rawItem: PunchItem) => {
    const item = stagePunchPhoto(rawItem);
    // Read the ref (not `punchItems`) so a later synchronous call in the same
    // tick sees this row — keeps single-add composable with the batch path.
    const updated = [item, ...punchItemsRef.current];
    punchItemsRef.current = updated;
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) void supabaseWrite('punch_items', 'insert', punchItemToRow(item));
  }, [savePunchItemsMutation, canSync, punchItemToRow, stagePunchPhoto]);

  // Batch insert — prepends the WHOLE array in ONE setState via the ref, so all
  // N rows survive (the single-add read `punchItems` from a stale closure, so a
  // caller looping it kept only the last). One supabaseWrite per row, same shape.
  const addPunchItems = useCallback((rawItems: PunchItem[]) => {
    if (rawItems.length === 0) return;
    const items = rawItems.map(stagePunchPhoto);
    // Newest-first: reverse so the first input ends up last after prepending,
    // matching the single-add ordering when called in sequence.
    const updated = [...[...items].reverse(), ...punchItemsRef.current];
    punchItemsRef.current = updated;
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) items.forEach(item => { void supabaseWrite('punch_items', 'insert', punchItemToRow(item)); });
  }, [savePunchItemsMutation, canSync, punchItemToRow, stagePunchPhoto]);

  const updatePunchItem = useCallback((id: string, updates: Partial<PunchItem>) => {
    const now = new Date().toISOString();
    const updated = punchItems.map(pi => {
      if (pi.id !== id) return pi;
      // A photo attached AFTER creation (the common punch-walk flow: log the
      // deficiency, shoot it later) has to be staged here too.
      return stagePunchPhoto({ ...pi, ...updates, updatedAt: now });
    });
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) {
      const pi = updated.find(x => x.id === id);
      if (pi) {
        void supabaseWrite('punch_items', 'update', {
          id, description: pi.description, location: pi.location, assigned_sub: pi.assignedSub,
          assigned_sub_id: pi.assignedSubId,
          due_date: pi.dueDate, priority: pi.priority, status: pi.status,
          photo_uri: durablePhotoValue(pi.photoStoragePath, pi.photoUri) || null,
          // Persist plan-pin anchor + captured GPS on update too (were omitted,
          // and assigned_sub_id was dropped on update — fixed here).
          plan_sheet_id: pi.planSheetId, pin_x: pi.pinX, pin_y: pi.pinY,
          photo_latitude: pi.photoLatitude, photo_longitude: pi.photoLongitude,
          photo_accuracy_meters: pi.photoLocationAccuracyMeters,
          photo_location_label: pi.photoLocationLabel,
          rejection_note: pi.rejectionNote, closed_at: pi.closedAt, updated_at: now,
        });
      }
    }
  }, [punchItems, savePunchItemsMutation, canSync, stagePunchPhoto]);

  const deletePunchItem = useCallback((id: string) => {
    const updated = punchItems.filter(pi => pi.id !== id);
    setPunchItems(updated);
    savePunchItemsMutation.mutate(updated);
    if (canSync) void supabaseWrite('punch_items', 'delete', { id });
  }, [punchItems, savePunchItemsMutation, canSync]);

  const getPunchItemsForProject = useCallback((projectId: string) => punchItems.filter(pi => pi.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [punchItems]);

  const addProjectPhoto = useCallback((photo: ProjectPhoto) => {
    // Queue the bytes and reserve the durable path BEFORE anything is written.
    // `photo.uri` stays local in state so the gallery paints this frame.
    const storagePath = photo.storagePath ?? stagePhotoUpload({
      userId, projectId: photo.projectId, recordId: photo.id, localUri: photo.uri,
    }) ?? undefined;
    const finalPhoto: ProjectPhoto = {
      ...photo,
      storagePath,
      localUri: photo.localUri ?? (isDeviceLocalUri(photo.uri) ? photo.uri : undefined),
      portalState: photo.portalState ?? initialPortalState('photo', photo.projectId),
    };
    // Functional updater: a daily-report save calls this N times synchronously
    // before React re-renders, so reading the closure-captured `projectPhotos`
    // made each call clobber the previous — the gallery kept only the last of
    // several photos. `prev` composes the batched adds correctly.
    setProjectPhotos(prev => {
      const updated = [finalPhoto, ...prev];
      savePhotosMutation.mutate(updated);
      return updated;
    });
    if (canSync) {
      void supabaseWrite('photos', 'insert', {
        id: finalPhoto.id, user_id: userId, project_id: finalPhoto.projectId,
        // The DURABLE path, never the device-local URI — that was the bug.
        uri: durablePhotoValue(storagePath, finalPhoto.uri),
        timestamp: finalPhoto.timestamp, location: finalPhoto.location, tag: finalPhoto.tag,
        linked_task_id: finalPhoto.linkedTaskId, linked_task_name: finalPhoto.linkedTaskName,
        markup: finalPhoto.markup, created_at: finalPhoto.createdAt,
        portal_state: finalPhoto.portalState,
      });
    }
  }, [savePhotosMutation, canSync, userId, initialPortalState]);

  const deleteProjectPhoto = useCallback((id: string) => {
    const doomed = projectPhotos.find(p => p.id === id);
    const updated = projectPhotos.filter(p => p.id !== id);
    setProjectPhotos(updated);
    savePhotosMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('photos', 'delete', { id });
      // Reap the object too, or deleting photos would grow the bucket forever
      // with objects nothing references — UNLESS a daily report still shows the
      // same image. DFR photos are mirrored into the gallery under the same id,
      // so they share one object; removing it here would blank a photo out of a
      // filed report, which is a document we must not alter after the fact.
      const stillReferenced = doomed?.storagePath
        ? dailyReports.some(dr => (dr.photos ?? []).some(p => p.storagePath === doomed.storagePath))
        : true;
      if (doomed?.storagePath && !stillReferenced) void deleteProjectPhotoObject(doomed.storagePath);
    }
  }, [projectPhotos, savePhotosMutation, canSync, dailyReports]);

  // Patch a photo in place — used by the annotator to save markup, by the
  // gallery to retag, and by clients downstream that want to update a
  // caption / location without re-uploading the image.
  const updateProjectPhoto = useCallback((id: string, updates: Partial<ProjectPhoto>) => {
    const existing = projectPhotos.find(p => p.id === id);
    // A caller replacing the image (e.g. a re-shot photo) hands us a fresh
    // local URI. Stage its bytes and reserve a path here too, or this write
    // would re-introduce a `file://` through the side door.
    const nextStoragePath = updates.storagePath
      ?? (updates.uri !== undefined && existing
        ? stagePhotoUpload({ userId, projectId: existing.projectId, recordId: id, localUri: updates.uri }) ?? undefined
        : undefined)
      ?? existing?.storagePath;
    const patched: Partial<ProjectPhoto> = {
      ...updates,
      ...(nextStoragePath ? { storagePath: nextStoragePath } : {}),
      ...(updates.uri !== undefined && isDeviceLocalUri(updates.uri) ? { localUri: updates.uri } : {}),
    };
    const updated = projectPhotos.map(p => p.id === id ? { ...p, ...patched } : p);
    setProjectPhotos(updated);
    savePhotosMutation.mutate(updated);
    if (canSync) {
      const patch: Record<string, unknown> = { id };
      if (updates.uri !== undefined) patch.uri = durablePhotoValue(nextStoragePath, updates.uri);
      if (updates.location !== undefined) patch.location = updates.location;
      if (updates.tag !== undefined) patch.tag = updates.tag;
      if (updates.linkedTaskId !== undefined) patch.linked_task_id = updates.linkedTaskId;
      if (updates.linkedTaskName !== undefined) patch.linked_task_name = updates.linkedTaskName;
      if (updates.markup !== undefined) patch.markup = updates.markup;
      void supabaseWrite('photos', 'update', patch);
    }
  }, [projectPhotos, savePhotosMutation, canSync, userId]);

  const getPhotosForProject = useCallback((projectId: string) => projectPhotos.filter(p => p.projectId === projectId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [projectPhotos]);

  const addPriceAlert = useCallback((alert: PriceAlert) => {
    const updated = [alert, ...priceAlerts];
    setPriceAlerts(updated);
    savePriceAlertsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('price_alerts', 'insert', {
        id: alert.id, user_id: userId, material_id: alert.materialId, material_name: alert.materialName,
        target_price: alert.targetPrice, direction: alert.direction, current_price: alert.currentPrice,
        is_triggered: alert.isTriggered, is_paused: alert.isPaused, created_at: alert.createdAt,
      });
    }
  }, [priceAlerts, savePriceAlertsMutation, canSync, userId]);

  const updatePriceAlert = useCallback((id: string, updates: Partial<PriceAlert>) => {
    const updated = priceAlerts.map(a => a.id === id ? { ...a, ...updates } : a);
    setPriceAlerts(updated);
    savePriceAlertsMutation.mutate(updated);
    if (canSync) {
      const a = updated.find(x => x.id === id);
      if (a) {
        void supabaseWrite('price_alerts', 'update', {
          id, target_price: a.targetPrice, direction: a.direction, current_price: a.currentPrice,
          is_triggered: a.isTriggered, is_paused: a.isPaused,
        });
      }
    }
  }, [priceAlerts, savePriceAlertsMutation, canSync]);

  const deletePriceAlert = useCallback((id: string) => {
    const updated = priceAlerts.filter(a => a.id !== id);
    setPriceAlerts(updated);
    savePriceAlertsMutation.mutate(updated);
    if (canSync) void supabaseWrite('price_alerts', 'delete', { id });
  }, [priceAlerts, savePriceAlertsMutation, canSync]);

  const addContact = useCallback((contact: Contact) => {
    const updated = [contact, ...contacts];
    setContacts(updated);
    saveContactsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('contacts', 'insert', {
        id: contact.id, user_id: userId, first_name: contact.firstName, last_name: contact.lastName,
        company_name: contact.companyName, role: contact.role, email: contact.email,
        secondary_email: contact.secondaryEmail, phone: contact.phone, address: contact.address,
        notes: contact.notes, linked_project_ids: contact.linkedProjectIds,
        created_at: contact.createdAt, updated_at: contact.updatedAt,
      });
    }
  }, [contacts, saveContactsMutation, canSync, userId]);

  const updateContact = useCallback((id: string, updates: Partial<Contact>) => {
    const now = new Date().toISOString();
    const updated = contacts.map(c => c.id === id ? { ...c, ...updates, updatedAt: now } : c);
    setContacts(updated);
    saveContactsMutation.mutate(updated);
    if (canSync) {
      const c = updated.find(x => x.id === id);
      if (c) {
        void supabaseWrite('contacts', 'update', {
          id, first_name: c.firstName, last_name: c.lastName, company_name: c.companyName,
          role: c.role, email: c.email, secondary_email: c.secondaryEmail, phone: c.phone,
          address: c.address, notes: c.notes, linked_project_ids: c.linkedProjectIds, updated_at: now,
        });
      }
    }
  }, [contacts, saveContactsMutation, canSync]);

  const deleteContact = useCallback((id: string) => {
    const updated = contacts.filter(c => c.id !== id);
    setContacts(updated);
    saveContactsMutation.mutate(updated);
    if (canSync) void supabaseWrite('contacts', 'delete', { id });
  }, [contacts, saveContactsMutation, canSync]);

  const getContact = useCallback((id: string) => contacts.find(c => c.id === id) ?? null, [contacts]);

  const addCommEvent = useCallback((event: CommunicationEvent) => {
    const updated = [event, ...commEvents];
    setCommEvents(updated);
    saveCommEventsMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('comm_events', 'insert', {
        id: event.id, user_id: userId, project_id: event.projectId, type: event.type,
        summary: event.summary, actor: event.actor, recipient: event.recipient,
        detail: event.detail, is_private: event.isPrivate, timestamp: event.timestamp,
      });
    }
  }, [commEvents, saveCommEventsMutation, canSync, userId]);

  const getCommEventsForProject = useCallback((projectId: string) => commEvents.filter(e => e.projectId === projectId).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [commEvents]);

  // Returns the created RFI so callers (e.g. UniversalMicButton) can
  // navigate to /rfi?rfiId=<new id> immediately, without racing on a stale
  // closure of getRFIsForProject. Without this, the post-create navigation
  // resolves to undefined and the RFI screen opens in "new" mode with
  // empty fields — visible to the user as a "blank RFI" even though the
  // actual saved row was filled correctly.
  // Snake/camel mapping for the rfis insert payload — shared by single-add and
  // batch-add so the two write the same shape.
  const rfiToRow = useCallback((newRfi: RFI) => ({
    id: newRfi.id, user_id: userId, project_id: newRfi.projectId, number: newRfi.number,
    subject: newRfi.subject, question: newRfi.question, submitted_by: newRfi.submittedBy,
    assigned_to: newRfi.assignedTo, date_submitted: newRfi.dateSubmitted, date_required: newRfi.dateRequired,
    status: newRfi.status, priority: newRfi.priority, linked_drawing: newRfi.linkedDrawing,
    linked_task_id: newRfi.linkedTaskId, attachments: newRfi.attachments,
    created_at: newRfi.createdAt, updated_at: newRfi.updatedAt, portal_state: newRfi.portalState,
  }), [userId]);

  // Next per-project RFI number given an authoritative current array (`base`).
  // RFI numbers are per project — one advancing counter per projectId.
  const nextRfiNumber = useCallback((projectId: string, base: RFI[]) => {
    const projectRfis = base.filter(r => r.projectId === projectId);
    return projectRfis.length > 0 ? Math.max(...projectRfis.map(r => r.number)) + 1 : 1;
  }, []);

  const addRFI = useCallback((rfi: Omit<RFI, 'id' | 'createdAt' | 'updatedAt' | 'number'>): RFI => {
    // Read the ref (not `rfis`) so numbering stays correct when this is called
    // N times in one synchronous loop before React re-renders.
    const base = rfisRef.current;
    const now = new Date().toISOString();
    const newRfi: RFI = {
      ...rfi,
      id: generateUUID(),
      number: nextRfiNumber(rfi.projectId, base),
      createdAt: now,
      updatedAt: now,
      portalState: rfi.portalState ?? initialPortalState('rfi', rfi.projectId),
    };
    const updated = [newRfi, ...base];
    rfisRef.current = updated;
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) void supabaseWrite('rfis', 'insert', rfiToRow(newRfi));
    return newRfi;
  }, [saveRfisMutation, canSync, initialPortalState, nextRfiNumber, rfiToRow]);

  // Batch insert — prepends the WHOLE array in ONE setState via the ref, and
  // assigns SEQUENTIAL per-project numbers off an advancing counter seeded from
  // the current max (the single-add recomputed from a stale closure every
  // iteration, so batch RFIs all collided on the same number and only the last
  // survived). Only `number` is assigned/overridden — all caller fields (id,
  // title, description, etc.) are preserved.
  const addRFIs = useCallback((incoming: RFI[]) => {
    if (incoming.length === 0) return;
    let working = rfisRef.current;
    const rows: Record<string, unknown>[] = [];
    for (const rfi of incoming) {
      const now = new Date().toISOString();
      const newRfi: RFI = {
        ...rfi,
        number: nextRfiNumber(rfi.projectId, working),
        createdAt: rfi.createdAt ?? now,
        updatedAt: rfi.updatedAt ?? now,
        portalState: rfi.portalState ?? initialPortalState('rfi', rfi.projectId),
      };
      // Prepend so `working` carries this row's number into the next
      // iteration's max — advancing the per-project counter by one.
      working = [newRfi, ...working];
      rows.push(rfiToRow(newRfi));
    }
    rfisRef.current = working;
    setRfis(working);
    saveRfisMutation.mutate(working);
    if (canSync) rows.forEach(row => { void supabaseWrite('rfis', 'insert', row); });
  }, [saveRfisMutation, canSync, initialPortalState, nextRfiNumber, rfiToRow]);

  const updateRFI = useCallback((id: string, updates: Partial<RFI>) => {
    const now = new Date().toISOString();
    const updated = rfis.map(r => r.id === id ? { ...r, ...updates, updatedAt: now } : r);
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) {
      const r = updated.find(x => x.id === id);
      if (r) {
        void supabaseWrite('rfis', 'update', {
          id, subject: r.subject, question: r.question, assigned_to: r.assignedTo,
          date_responded: r.dateResponded, response: r.response, status: r.status,
          priority: r.priority, attachments: r.attachments, updated_at: now,
        });
      }
    }
  }, [rfis, saveRfisMutation, canSync]);

  const deleteRFI = useCallback((id: string) => {
    const updated = rfis.filter(r => r.id !== id);
    setRfis(updated);
    saveRfisMutation.mutate(updated);
    if (canSync) void supabaseWrite('rfis', 'delete', { id });
  }, [rfis, saveRfisMutation, canSync]);

  const getRFIsForProject = useCallback((projectId: string) => rfis.filter(r => r.projectId === projectId).sort((a, b) => b.number - a.number), [rfis]);

  const permitToRow = useCallback((p: Permit) => ({
    id: p.id,
    user_id: userId,
    project_id: p.projectId,
    project_name: p.projectName ?? null,
    type: p.type,
    permit_number: p.permitNumber ?? null,
    jurisdiction: p.jurisdiction ?? '',
    status: p.status,
    applied_date: p.appliedDate || null,
    approved_date: p.approvedDate || null,
    expires_date: p.expiresDate || null,
    inspection_date: p.inspectionDate || null,
    inspection_notes: p.inspectionNotes ?? null,
    fee: p.fee ?? 0,
    notes: p.notes ?? null,
    phase: p.phase ?? null,
    attachment_uri: p.attachmentUri ?? null,
    special_inspection_category: p.specialInspectionCategory ?? null,
    inspector_name: p.inspectorName ?? null,
    last_report_summary: p.lastReportSummary ?? null,
    last_report_date: p.lastReportDate || null,
    created_at: p.createdAt ?? new Date().toISOString(),
    updated_at: p.updatedAt ?? new Date().toISOString(),
  }), [userId]);

  const addPermit = useCallback((permit: Omit<Permit, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newPermit: Permit = { ...permit, id: generateUUID(), createdAt: now, updatedAt: now };
    const updated = [newPermit, ...permits];
    setPermits(updated);
    savePermitsMutation.mutate(updated);
    if (canSync && userId) void supabaseWrite('permits', 'insert', permitToRow(newPermit));
    return newPermit;
  }, [permits, savePermitsMutation, canSync, userId, permitToRow]);

  const updatePermit = useCallback((id: string, updates: Partial<Permit>) => {
    const now = new Date().toISOString();
    const updated = permits.map(p => p.id === id ? { ...p, ...updates, updatedAt: now } : p);
    setPermits(updated);
    savePermitsMutation.mutate(updated);
    const next = updated.find(p => p.id === id);
    if (canSync && userId && next) void supabaseWrite('permits', 'update', permitToRow(next));
  }, [permits, savePermitsMutation, canSync, userId, permitToRow]);

  const deletePermit = useCallback((id: string) => {
    const updated = permits.filter(p => p.id !== id);
    setPermits(updated);
    savePermitsMutation.mutate(updated);
    if (canSync) void supabaseWrite('permits', 'delete', { id });
  }, [permits, savePermitsMutation, canSync]);

  const getPermitsForProject = useCallback((projectId: string) =>
    permits.filter(p => p.projectId === projectId).sort((a, b) => new Date(b.appliedDate).getTime() - new Date(a.appliedDate).getTime()),
    [permits]);

  // AIA pay applications. addAIAPayApp accepts a preassembled SavedAIAPayApp
  // (built from the editing screen with computed totals) so the helper stays
  // simple — no SOV math here, just persistence + de-dupe by (projectId,
  // applicationNumber).
  const aiaPayAppToRow = useCallback((a: SavedAIAPayApp) => ({
    id: a.id,
    user_id: userId,
    project_id: a.projectId,
    invoice_id: a.invoiceId ?? null,
    application_number: a.applicationNumber,
    application_date: a.applicationDate || null,
    period_to: a.periodTo || null,
    contract_date: a.contractDate || null,
    owner_name: a.ownerName ?? null,
    contractor_name: a.contractorName ?? null,
    architect_name: a.architectName ?? null,
    project_name: a.projectName ?? null,
    project_location: a.projectLocation ?? null,
    contract_for_description: a.contractForDescription ?? null,
    original_contract_sum: a.originalContractSum ?? 0,
    net_change_by_co: a.netChangeByCO ?? 0,
    contract_sum_to_date: a.contractSumToDate ?? 0,
    retainage_percent: a.retainagePercent ?? 10,
    less_previous_certificates: a.lessPreviousCertificates ?? 0,
    lines: a.lines ?? [],
    notes: a.notes ?? null,
    snapshot_totals: (a as unknown as { snapshotTotals?: unknown }).snapshotTotals ?? null,
    created_at: (a as unknown as { createdAt?: string }).createdAt ?? new Date().toISOString(),
    updated_at: (a as unknown as { updatedAt?: string }).updatedAt ?? new Date().toISOString(),
    portal_state: a.portalState ?? null,
  }), [userId]);

  const addAIAPayApp = useCallback((app: SavedAIAPayApp) => {
    const finalApp: SavedAIAPayApp = {
      ...app,
      portalState: app.portalState ?? initialPortalState('aia_pay_app', app.projectId),
    };
    const dedup = aiaPayApps.filter(a => !(a.projectId === finalApp.projectId && a.applicationNumber === finalApp.applicationNumber));
    const updated = [finalApp, ...dedup];
    setAiaPayApps(updated);
    saveAiaPayAppsMutation.mutate(updated);
    // Upsert: app screen always saves as new ID per draft so insert is correct;
    // if the user re-saves the same id (rare), the table PK guards from dupes
    // and Supabase will return a 409 we ignore.
    if (canSync && userId) void supabaseWrite('aia_pay_apps', 'insert', aiaPayAppToRow(finalApp));
    return finalApp;
  }, [aiaPayApps, saveAiaPayAppsMutation, canSync, userId, aiaPayAppToRow, initialPortalState]);

  const deleteAIAPayApp = useCallback((id: string) => {
    const updated = aiaPayApps.filter(a => a.id !== id);
    setAiaPayApps(updated);
    saveAiaPayAppsMutation.mutate(updated);
    if (canSync) void supabaseWrite('aia_pay_apps', 'delete', { id });
  }, [aiaPayApps, saveAiaPayAppsMutation, canSync]);

  const getAIAPayAppsForProject = useCallback((projectId: string) =>
    aiaPayApps.filter(a => a.projectId === projectId).sort((a, b) => b.applicationNumber - a.applicationNumber),
    [aiaPayApps]);

  // Sub portal links. Each (project, sub) pair gets one link. upsert keeps
  // a stable id so the share URL doesn't change when the GC tweaks settings.
  const upsertSubPortalLink = useCallback((link: SubPortalLink) => {
    // The sub-portal RPCs (sub_portal_get_snapshot / sub_portal_submit_invoice)
    // require `access_token = p_access_token`. The column has a DB default, but
    // the local-first optimistic write never reads it back — so the app never
    // knew the token and every invoice submit fell back to mailto. Fix: mirror
    // the client-portal token heal — when the link is enabled and has no token,
    // generate one app-side and write the column explicitly so the value the
    // app holds is exactly what the RPC compares against. An existing token is
    // preserved (never regenerated), so previously-issued share links stay valid.
    let resolved = link;
    if (link.enabled && !link.accessToken) {
      const token = (generateUUID() + generateUUID()).replace(/-/g, '');
      resolved = { ...link, accessToken: token };
    }
    const filtered = subPortalLinks.filter(l => l.id !== resolved.id);
    const updated = [resolved, ...filtered];
    setSubPortalLinks(updated);
    saveSubPortalLinksMutation.mutate(updated);
    if (canSync && userId) {
      void supabaseWrite('sub_portal_links', 'insert', {
        id: resolved.id,
        user_id: userId,
        project_id: resolved.projectId,
        subcontractor_id: resolved.subcontractorId,
        passcode: resolved.passcode ?? null,
        require_passcode: !!resolved.requirePasscode,
        enabled: resolved.enabled,
        welcome_message: resolved.welcomeMessage ?? null,
        // Write the token explicitly (only when we hold one) so it matches what
        // the RPC checks — the DB default only fills when the column is empty,
        // so writing our value keeps app and server in agreement.
        ...(resolved.accessToken ? { access_token: resolved.accessToken } : {}),
        commitment_ids: resolved.commitmentIds ?? null,
        created_at: resolved.createdAt,
        updated_at: resolved.updatedAt,
        last_shared_at: resolved.lastSharedAt ?? null,
      });
    }
    return resolved;
  }, [subPortalLinks, saveSubPortalLinksMutation, canSync, userId]);

  const deleteSubPortalLink = useCallback((id: string) => {
    const updated = subPortalLinks.filter(l => l.id !== id);
    setSubPortalLinks(updated);
    saveSubPortalLinksMutation.mutate(updated);
    if (canSync) void supabaseWrite('sub_portal_links', 'delete', { id });
  }, [subPortalLinks, saveSubPortalLinksMutation, canSync]);

  const getSubPortalLinkFor = useCallback((projectId: string, subcontractorId: string) =>
    subPortalLinks.find(l => l.projectId === projectId && l.subcontractorId === subcontractorId),
    [subPortalLinks]);

  const getSubPortalLinksForProject = useCallback((projectId: string) =>
    subPortalLinks.filter(l => l.projectId === projectId).sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [subPortalLinks]);

  // Build one Submittal off the current list, assigning the next per-project
  // number. Reads `base` (the authoritative current array) so callers looping
  // synchronously can thread the just-updated array through each iteration.
  const buildSubmittal = useCallback((
    sub: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>,
    base: Submittal[],
  ): { newSub: Submittal; row: Record<string, unknown> } => {
    const projectSubs = base.filter(s => s.projectId === sub.projectId);
    const nextNumber = projectSubs.length > 0 ? Math.max(...projectSubs.map(s => s.number)) + 1 : 1;
    const now = new Date().toISOString();
    const newSub: Submittal = {
      ...sub,
      id: generateUUID(),
      number: nextNumber,
      createdAt: now,
      updatedAt: now,
      portalState: sub.portalState ?? initialPortalState('submittal', sub.projectId),
    };
    const row = {
      id: newSub.id, user_id: userId, project_id: newSub.projectId, number: newSub.number,
      title: newSub.title, spec_section: newSub.specSection, submitted_by: newSub.submittedBy,
      submitted_date: newSub.submittedDate, required_date: newSub.requiredDate,
      review_cycles: newSub.reviewCycles, current_status: newSub.currentStatus,
      attachments: newSub.attachments, created_at: now, updated_at: now,
      portal_state: newSub.portalState,
    };
    return { newSub, row };
  }, [userId, initialPortalState]);

  const addSubmittal = useCallback((sub: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>) => {
    // Read the ref (not `submittals`) so numbering stays correct when this is
    // called N times in one synchronous loop before React re-renders.
    const base = submittalsRef.current;
    const { newSub, row } = buildSubmittal(sub, base);
    const updated = [newSub, ...base];
    submittalsRef.current = updated;
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) void supabaseWrite('submittals', 'insert', row);
  }, [buildSubmittal, saveSubmittalsMutation, canSync]);

  // Batch insert — assigns sequential per-project numbers to every row and
  // commits in ONE setState. Use this from bulk flows (e.g. extract-submittals)
  // instead of looping addSubmittal, so the review count matches what persists.
  const addSubmittals = useCallback((subs: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>[]) => {
    if (subs.length === 0) return;
    let working = submittalsRef.current;
    const rows: Record<string, unknown>[] = [];
    for (const sub of subs) {
      const { newSub, row } = buildSubmittal(sub, working);
      working = [newSub, ...working];
      rows.push(row);
    }
    submittalsRef.current = working;
    setSubmittals(working);
    saveSubmittalsMutation.mutate(working);
    if (canSync) rows.forEach(row => { void supabaseWrite('submittals', 'insert', row); });
  }, [buildSubmittal, saveSubmittalsMutation, canSync]);

  const updateSubmittal = useCallback((id: string, updates: Partial<Submittal>) => {
    const now = new Date().toISOString();
    const updated = submittals.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s);
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) {
      const s = updated.find(x => x.id === id);
      if (s) {
        void supabaseWrite('submittals', 'update', {
          id, title: s.title, spec_section: s.specSection, review_cycles: s.reviewCycles,
          current_status: s.currentStatus, attachments: s.attachments, updated_at: now,
        });
      }
    }
  }, [submittals, saveSubmittalsMutation, canSync]);

  const deleteSubmittal = useCallback((id: string) => {
    const updated = submittals.filter(s => s.id !== id);
    setSubmittals(updated);
    saveSubmittalsMutation.mutate(updated);
    if (canSync) void supabaseWrite('submittals', 'delete', { id });
  }, [submittals, saveSubmittalsMutation, canSync]);

  const getSubmittalsForProject = useCallback((projectId: string) => submittals.filter(s => s.projectId === projectId).sort((a, b) => b.number - a.number), [submittals]);

  const addReviewCycle = useCallback((submittalId: string, cycle: Omit<SubmittalReviewCycle, 'cycleNumber'>) => {
    const sub = submittals.find(s => s.id === submittalId);
    if (!sub) return;
    const nextCycle = sub.reviewCycles.length + 1;
    const newCycle: SubmittalReviewCycle = { ...cycle, cycleNumber: nextCycle };
    updateSubmittal(submittalId, { reviewCycles: [...sub.reviewCycles, newCycle], currentStatus: cycle.status });
  }, [submittals, updateSubmittal]);

  // ─── OAC Meetings (server-synced) ──────────────────────────────
  // Snake/camel mapping helper for the supabase write payload — keeps
  // the inline write calls compact and easy to read.
  const oacMeetingToRow = useCallback((m: OACMeeting) => ({
    id: m.id, user_id: userId, project_id: m.projectId, number: m.number,
    scheduled_at: m.scheduledAt, duration_minutes: m.durationMinutes,
    location: m.location,
    attendees: m.attendees as unknown,
    agenda: m.agenda as unknown,
    action_items: m.actionItems as unknown,
    transcript: m.transcript, minutes: m.minutes, status: m.status,
    distributed_at: m.distributedAt,
    distribution_log: m.distributionLog as unknown,
    created_at: m.createdAt, updated_at: m.updatedAt,
  }), [userId]);

  const addOACMeeting = useCallback((meeting: OACMeeting) => {
    const updated = [...oacMeetings, meeting];
    setOacMeetings(updated);
    saveOACMeetingsMutation.mutate(updated);
    if (canSync) void supabaseWrite('oac_meetings', 'insert', oacMeetingToRow(meeting));
  }, [oacMeetings, saveOACMeetingsMutation, canSync, oacMeetingToRow]);

  const updateOACMeeting = useCallback((id: string, patch: Partial<OACMeeting>) => {
    const updated = oacMeetings.map(m => m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m);
    setOacMeetings(updated);
    saveOACMeetingsMutation.mutate(updated);
    const merged = updated.find(m => m.id === id);
    if (merged && canSync) {
      void supabaseWrite('oac_meetings', 'update', oacMeetingToRow(merged));
    }
  }, [oacMeetings, saveOACMeetingsMutation, canSync, oacMeetingToRow]);

  const deleteOACMeeting = useCallback((id: string) => {
    const updated = oacMeetings.filter(m => m.id !== id);
    setOacMeetings(updated);
    saveOACMeetingsMutation.mutate(updated);
    if (canSync) void supabaseWrite('oac_meetings', 'delete', { id });
  }, [oacMeetings, saveOACMeetingsMutation, canSync]);

  const getOACMeetingsForProject = useCallback(
    (projectId: string) => oacMeetings.filter(m => m.projectId === projectId).sort((a, b) => b.number - a.number),
    [oacMeetings],
  );

  // ─── COI vault (server-synced) ─────────────────────────────────
  const coiToRow = useCallback((c: CertificateOfInsurance) => ({
    id: c.id, user_id: userId,
    subcontractor_id: c.subcontractorId,
    project_id: c.projectId,
    file_uri: c.fileUri,
    uploaded_at: c.uploadedAt,
    validation: c.validation as unknown,
    coverages: (c.coverages ?? []) as unknown,
    notes: c.notes,
  }), [userId]);

  const addCOI = useCallback((coi: CertificateOfInsurance) => {
    const updated = [...cois, coi];
    setCois(updated);
    saveCOIsMutation.mutate(updated);
    if (canSync) void supabaseWrite('cois', 'insert', coiToRow(coi));
  }, [cois, saveCOIsMutation, canSync, coiToRow]);

  const updateCOI = useCallback((id: string, patch: Partial<CertificateOfInsurance>) => {
    const updated = cois.map(c => c.id === id ? { ...c, ...patch } : c);
    setCois(updated);
    saveCOIsMutation.mutate(updated);
    const merged = updated.find(c => c.id === id);
    if (merged && canSync) {
      void supabaseWrite('cois', 'update', coiToRow(merged));
    }
  }, [cois, saveCOIsMutation, canSync, coiToRow]);

  const deleteCOI = useCallback((id: string) => {
    const updated = cois.filter(c => c.id !== id);
    setCois(updated);
    saveCOIsMutation.mutate(updated);
    if (canSync) void supabaseWrite('cois', 'delete', { id });
  }, [cois, saveCOIsMutation, canSync]);

  const getCOIsForSub = useCallback(
    (subId: string) => cois.filter(c => c.subcontractorId === subId),
    [cois],
  );

  const addEquipment = useCallback((equip: Omit<Equipment, 'id' | 'createdAt'>) => {
    const now = new Date().toISOString();
    const newEquip: Equipment = { ...equip, id: generateUUID(), createdAt: now };
    const updated = [newEquip, ...equipment];
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('equipment', 'insert', {
        id: newEquip.id, user_id: userId, name: newEquip.name, type: newEquip.type,
        category: newEquip.category, make: newEquip.make, model: newEquip.model, year: newEquip.year,
        serial_number: newEquip.serialNumber, daily_rate: newEquip.dailyRate,
        current_project_id: newEquip.currentProjectId, maintenance_schedule: newEquip.maintenanceSchedule,
        utilization_log: newEquip.utilizationLog, status: newEquip.status, notes: newEquip.notes, created_at: now,
      });
    }
  }, [equipment, saveEquipmentMutation, canSync, userId]);

  const updateEquipment = useCallback((id: string, updates: Partial<Equipment>) => {
    const updated = equipment.map(e => e.id === id ? { ...e, ...updates } : e);
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) {
      const e = updated.find(x => x.id === id);
      if (e) {
        void supabaseWrite('equipment', 'update', {
          id, name: e.name, type: e.type, category: e.category, make: e.make, model: e.model,
          daily_rate: e.dailyRate, current_project_id: e.currentProjectId,
          maintenance_schedule: e.maintenanceSchedule, utilization_log: e.utilizationLog,
          status: e.status, notes: e.notes,
        });
      }
    }
  }, [equipment, saveEquipmentMutation, canSync]);

  const deleteEquipment = useCallback((id: string) => {
    const updated = equipment.filter(e => e.id !== id);
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) void supabaseWrite('equipment', 'delete', { id });
  }, [equipment, saveEquipmentMutation, canSync]);

  const logUtilization = useCallback((entry: Omit<EquipmentUtilizationEntry, 'id'>) => {
    const newEntry: EquipmentUtilizationEntry = { ...entry, id: generateUUID() };
    const updated = equipment.map(e => e.id === entry.equipmentId ? { ...e, utilizationLog: [...e.utilizationLog, newEntry] } : e);
    setEquipment(updated);
    saveEquipmentMutation.mutate(updated);
    if (canSync) {
      const e = updated.find(x => x.id === entry.equipmentId);
      if (e) {
        void supabaseWrite('equipment', 'update', { id: e.id, utilization_log: e.utilizationLog });
      }
    }
  }, [equipment, saveEquipmentMutation, canSync]);

  const getEquipmentForProject = useCallback((projectId: string) => equipment.filter(e => e.currentProjectId === projectId), [equipment]);

  const getEquipmentCostForProject = useCallback((projectId: string) => {
    return equipment
      .filter(e => e.currentProjectId === projectId)
      .reduce((sum, e) => {
        const daysUsed = e.utilizationLog.filter(u => u.projectId === projectId).length;
        return sum + (e.dailyRate * Math.max(daysUsed, 1));
      }, 0);
  }, [equipment]);

  // Warranties — cloud-backed as of t1.1 audit-fix migration. Same
  // try-cloud-then-local fallback as commitments / permits.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase.from('warranties').select('*').order('end_date', { ascending: true });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, projectId: r.project_id as string,
              projectName: (r.project_name as string | null) ?? '',
              title: (r.title as string) ?? '',
              category: r.category as Warranty['category'],
              description: (r.description as string | null) ?? undefined,
              provider: (r.provider as string) ?? '',
              providerContactId: (r.provider_contact_id as string | null) ?? undefined,
              startDate: (r.start_date as string | null) ?? '',
              durationMonths: Number(r.duration_months) || 12,
              endDate: (r.end_date as string | null) ?? '',
              coverageDetails: (r.coverage_details as string | null) ?? undefined,
              exclusions: (r.exclusions as string | null) ?? undefined,
              documentUri: (r.document_uri as string | null) ?? undefined,
              status: r.status as Warranty['status'],
              claims: (r.claims as Warranty['claims']) ?? [],
              reminderDays: r.reminder_days == null ? undefined : Number(r.reminder_days),
              createdAt: r.created_at as string, updatedAt: r.updated_at as string,
            })) as Warranty[];
            if (!cancelled) {
              setWarranties(mapped);
              await saveLocal(WARRANTIES_KEY, mapped);
              return;
            }
          }
        } catch { /* fallback */ }
      }
      const local = await loadLocal<Warranty[]>(WARRANTIES_KEY, []);
      if (!cancelled) setWarranties(local);
    })();
    return () => { cancelled = true; };
  }, [canSync]);

  const persistWarranties = useCallback((list: Warranty[]) => {
    setWarranties(list);
    void saveLocal(WARRANTIES_KEY, list);
  }, []);

  const computeWarrantyStatus = useCallback((w: Warranty): Warranty['status'] => {
    // Delegate to the single shared implementation in utils/workflowPipelines.
    // 'unknown' is not in WarrantyStatus because endDate is a required field;
    // the cast is safe — NaN endDate cannot occur on a fully-constructed Warranty.
    return warrantyStatus(w, Date.now()).key as Warranty['status'];
  }, []);

  const warrantyToRow = useCallback((w: Warranty) => ({
    id: w.id,
    user_id: userId,
    project_id: w.projectId,
    project_name: w.projectName ?? null,
    title: w.title,
    category: w.category,
    description: w.description ?? null,
    provider: w.provider ?? '',
    provider_contact_id: w.providerContactId ?? null,
    start_date: w.startDate || null,
    duration_months: w.durationMonths ?? 12,
    end_date: w.endDate || null,
    coverage_details: w.coverageDetails ?? null,
    exclusions: w.exclusions ?? null,
    document_uri: w.documentUri ?? null,
    status: w.status,
    claims: w.claims ?? [],
    reminder_days: w.reminderDays ?? null,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
    portal_state: w.portalState ?? null,
  }), [userId]);

  const addWarranty = useCallback((w: Omit<Warranty, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'claims'> & { id?: string; status?: Warranty['status']; claims?: WarrantyClaim[] }) => {
    const now = new Date().toISOString();
    const fresh: Warranty = {
      id: w.id ?? generateUUID(),
      createdAt: now, updatedAt: now,
      status: w.status ?? 'active',
      claims: w.claims ?? [],
      ...w,
      portalState: w.portalState ?? initialPortalState('warranty', w.projectId),
    } as Warranty;
    fresh.status = computeWarrantyStatus(fresh);
    persistWarranties([fresh, ...warranties]);
    if (canSync && userId) void supabaseWrite('warranties', 'insert', warrantyToRow(fresh));
    return fresh;
  }, [warranties, persistWarranties, computeWarrantyStatus, canSync, userId, warrantyToRow, initialPortalState]);

  const updateWarranty = useCallback((id: string, updates: Partial<Warranty>) => {
    const now = new Date().toISOString();
    const next = warranties.map(w => {
      if (w.id !== id) return w;
      const merged = { ...w, ...updates, updatedAt: now };
      merged.status = computeWarrantyStatus(merged);
      return merged;
    });
    persistWarranties(next);
    const after = next.find(w => w.id === id);
    if (canSync && userId && after) void supabaseWrite('warranties', 'update', warrantyToRow(after));
  }, [warranties, persistWarranties, computeWarrantyStatus, canSync, userId, warrantyToRow]);

  const deleteWarranty = useCallback((id: string) => {
    persistWarranties(warranties.filter(w => w.id !== id));
    if (canSync) void supabaseWrite('warranties', 'delete', { id });
  }, [warranties, persistWarranties, canSync]);

  const getWarrantiesForProject = useCallback((projectId: string) =>
    warranties.filter(w => w.projectId === projectId).sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()),
    [warranties]);

  const addWarrantyClaim = useCallback((warrantyId: string, claim: Omit<WarrantyClaim, 'id'>) => {
    const id = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newClaim: WarrantyClaim = { id, ...claim };
    const next = warranties.map(w => w.id === warrantyId ? { ...w, claims: [newClaim, ...(w.claims ?? [])], updatedAt: new Date().toISOString() } : w);
    persistWarranties(next);
    // Mirror the claim to Supabase so the warranty's claims jsonb stays in sync.
    const after = next.find(w => w.id === warrantyId);
    if (canSync && userId && after) void supabaseWrite('warranties', 'update', warrantyToRow(after));
  }, [warranties, persistWarranties, canSync, userId, warrantyToRow]);

  // Portal messages — client ↔ GC Q&A thread, local-only storage.
  const [portalMessages, setPortalMessages] = useState<PortalMessage[]>([]);

  useEffect(() => {
    void loadLocal<PortalMessage[]>(PORTAL_MESSAGES_KEY, []).then(setPortalMessages);
  }, []);

  const persistPortalMessages = useCallback((list: PortalMessage[]) => {
    setPortalMessages(list);
    void saveLocal(PORTAL_MESSAGES_KEY, list);
  }, []);

  const addPortalMessage = useCallback((msg: Omit<PortalMessage, 'id' | 'createdAt'>) => {
    const fresh: PortalMessage = {
      ...msg,
      id: `pm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    persistPortalMessages([...portalMessages, fresh]);
    return fresh;
  }, [portalMessages, persistPortalMessages]);

  const markPortalMessagesRead = useCallback((projectId: string, side: 'gc' | 'client') => {
    // Only persist if at least one message actually flipped — otherwise we'd
    // produce a new array reference on every call, change this callback's
    // identity, and refire any useEffect that depends on it. That was a
    // genuine infinite-loop crash on the Messages screen.
    let changed = false;
    const next = portalMessages.map(m => {
      if (m.projectId !== projectId) return m;
      if (side === 'gc' && m.authorType === 'client' && !m.readByGc) {
        changed = true;
        return { ...m, readByGc: true };
      }
      if (side === 'client' && m.authorType === 'gc' && !m.readByClient) {
        changed = true;
        return { ...m, readByClient: true };
      }
      return m;
    });
    if (changed) persistPortalMessages(next);
  }, [portalMessages, persistPortalMessages]);

  const getPortalMessagesForProject = useCallback((projectId: string) =>
    portalMessages
      .filter(m => m.projectId === projectId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [portalMessages]);

  const getUnreadPortalMessageCount = useCallback((projectId: string, side: 'gc' | 'client') =>
    portalMessages.filter(m =>
      m.projectId === projectId &&
      (side === 'gc' ? m.authorType === 'client' && !m.readByGc : m.authorType === 'gc' && !m.readByClient)
    ).length,
    [portalMessages]);

  const getTotalUnreadPortalCountForGc = useCallback(() =>
    portalMessages.filter(m => m.authorType === 'client' && !m.readByGc).length,
    [portalMessages]);

  // Plan sheets, drawing pins, markups, and calibrations — local-only
  // storage for now. Matches the portal-messages pattern above.
  const [planSheets, setPlanSheets] = useState<PlanSheet[]>([]);
  const [drawingPins, setDrawingPins] = useState<DrawingPin[]>([]);
  const [planZones, setPlanZones] = useState<PlanZone[]>([]);
  const [planReviews, setPlanReviews] = useState<PlanReview[]>([]);
  const [planMarkups, setPlanMarkups] = useState<PlanMarkup[]>([]);
  const [planCalibrations, setPlanCalibrations] = useState<PlanCalibration[]>([]);
  const [permitRoadmaps, setPermitRoadmaps] = useState<PermitRoadmap[]>([]);

  useEffect(() => {
    void loadLocal<PlanSheet[]>(PLAN_SHEETS_KEY, []).then(setPlanSheets);
    void loadLocal<DrawingPin[]>(DRAWING_PINS_KEY, []).then(setDrawingPins);
    void loadLocal<PlanZone[]>(PLAN_ZONES_KEY, []).then(setPlanZones);
    void loadLocal<PlanReview[]>(PLAN_REVIEWS_KEY, []).then(setPlanReviews);
    void loadLocal<PlanMarkup[]>(PLAN_MARKUPS_KEY, []).then(setPlanMarkups);
    void loadLocal<PlanCalibration[]>(PLAN_CALIBRATIONS_KEY, []).then(setPlanCalibrations);
    void loadLocal<PermitRoadmap[]>(PLAN_ROADMAPS_KEY, []).then(setPermitRoadmaps);
  }, []);

  const persistPlanSheets = useCallback((list: PlanSheet[]) => {
    setPlanSheets(list);
    void saveLocal(PLAN_SHEETS_KEY, list);
  }, []);
  const persistDrawingPins = useCallback((list: DrawingPin[]) => {
    setDrawingPins(list);
    void saveLocal(DRAWING_PINS_KEY, list);
  }, []);
  const persistPlanZones = useCallback((list: PlanZone[]) => {
    setPlanZones(list);
    void saveLocal(PLAN_ZONES_KEY, list);
  }, []);
  const persistPlanReviews = useCallback((list: PlanReview[]) => {
    setPlanReviews(list);
    void saveLocal(PLAN_REVIEWS_KEY, list);
  }, []);
  const persistPlanMarkups = useCallback((list: PlanMarkup[]) => {
    setPlanMarkups(list);
    void saveLocal(PLAN_MARKUPS_KEY, list);
  }, []);
  const persistPlanCalibrations = useCallback((list: PlanCalibration[]) => {
    setPlanCalibrations(list);
    void saveLocal(PLAN_CALIBRATIONS_KEY, list);
  }, []);
  const persistPermitRoadmaps = useCallback((list: PermitRoadmap[]) => {
    setPermitRoadmaps(list);
    void saveLocal(PLAN_ROADMAPS_KEY, list);
  }, []);

  const addPlanSheet = useCallback((sheet: Omit<PlanSheet, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    // Auto-detect a revision: if the project already has a non-superseded
    // sheet with the same sheetNumber, the new upload becomes Rev N+1
    // and the prior sheet gets marked superseded. Pre-fix every upload
    // landed as a brand-new row, so two copies of "A-101" lived side by
    // side with no relationship — the GC had to remember which was
    // current. Now: revisions stack and the list view defaults to
    // showing only the latest of each sheetNumber.
    const incomingNumber = (sheet.sheetNumber ?? '').trim();
    let revision = 1;
    let previousSheetId: string | undefined;
    let updatedList = planSheets;
    if (incomingNumber) {
      const sameNumber = planSheets.filter(
        s => s.projectId === sheet.projectId
          && (s.sheetNumber ?? '').trim() === incomingNumber
          && !s.superseded,
      );
      if (sameNumber.length > 0) {
        // Pick the highest existing revision so we don't collide if the
        // user re-uploads multiple times (revision bumps monotonically).
        const latest = sameNumber.reduce((a, b) =>
          (a.revision ?? 1) > (b.revision ?? 1) ? a : b,
        );
        revision = (latest.revision ?? 1) + 1;
        previousSheetId = latest.id;
        // Mark the prior latest as superseded — both locally and via
        // Supabase write so other devices see the same chain.
        updatedList = planSheets.map(s =>
          s.id === latest.id ? { ...s, superseded: true, updatedAt: now } : s,
        );
        if (canSync) {
          void supabaseWrite('plan_sheets', 'update', {
            id: latest.id, superseded: true, updated_at: now,
          });
        }
      }
    }

    const fresh: PlanSheet = {
      ...sheet,
      // UUID (not a prefixed timestamp) so the Supabase write path can
      // round-trip the id into a Postgres UUID column without rejection.
      id: generateUUID(),
      revision,
      previousSheetId,
      createdAt: now,
      updatedAt: now,
    };
    persistPlanSheets([fresh, ...updatedList]);
    if (canSync) {
      void supabaseWrite('plan_sheets', 'insert', {
        id: fresh.id, user_id: userId, project_id: fresh.projectId,
        name: fresh.name, sheet_number: fresh.sheetNumber ?? null,
        image_uri: fresh.imageUri, page_number: fresh.pageNumber ?? null,
        width: fresh.width ?? null, height: fresh.height ?? null,
        revision: fresh.revision ?? null,
        previous_sheet_id: fresh.previousSheetId ?? null,
        superseded: fresh.superseded ?? null,
        created_at: fresh.createdAt, updated_at: fresh.updatedAt,
      });
    }
    return fresh;
  }, [planSheets, persistPlanSheets, canSync, userId]);

  const updatePlanSheet = useCallback((id: string, updates: Partial<PlanSheet>) => {
    const now = new Date().toISOString();
    persistPlanSheets(planSheets.map(s => s.id === id ? { ...s, ...updates, updatedAt: now } : s));
    if (canSync) {
      // Only forward persisted columns — `projectId` is immutable after
      // creation, so we never write it on update.
      const patch: Record<string, unknown> = { updated_at: now };
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.sheetNumber !== undefined) patch.sheet_number = updates.sheetNumber;
      if (updates.imageUri !== undefined) patch.image_uri = updates.imageUri;
      if (updates.pageNumber !== undefined) patch.page_number = updates.pageNumber;
      if (updates.width !== undefined) patch.width = updates.width;
      if (updates.height !== undefined) patch.height = updates.height;
      void supabaseWrite('plan_sheets', 'update', { id, ...patch });
    }
  }, [planSheets, persistPlanSheets, canSync]);

  const deletePlanSheet = useCallback((id: string) => {
    persistPlanSheets(planSheets.filter(s => s.id !== id));
    // cascade: pins, markups, calibrations on that sheet.
    // Server side relies on ON DELETE CASCADE from plan_sheets — we only
    // need to issue the parent delete. Local state still needs the manual
    // fan-out because AsyncStorage doesn't have FK cascades.
    persistDrawingPins(drawingPins.filter(p => p.planSheetId !== id));
    persistPlanMarkups(planMarkups.filter(m => m.planSheetId !== id));
    persistPlanCalibrations(planCalibrations.filter(c => c.planSheetId !== id));
    if (canSync) void supabaseWrite('plan_sheets', 'delete', { id });
  }, [planSheets, drawingPins, planMarkups, planCalibrations, persistPlanSheets, persistDrawingPins, persistPlanMarkups, persistPlanCalibrations, canSync]);

  const getPlanSheetsForProject = useCallback((projectId: string) =>
    planSheets.filter(s => s.projectId === projectId).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [planSheets]);

  const getPlanSheet = useCallback((id: string) => planSheets.find(s => s.id === id), [planSheets]);

  const addDrawingPin = useCallback((pin: Omit<DrawingPin, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const fresh: DrawingPin = {
      ...pin,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    persistDrawingPins([fresh, ...drawingPins]);
    if (canSync) {
      void supabaseWrite('drawing_pins', 'insert', {
        id: fresh.id, user_id: userId, project_id: fresh.projectId,
        plan_sheet_id: fresh.planSheetId, x: fresh.x, y: fresh.y,
        kind: fresh.kind, label: fresh.label ?? null, color: fresh.color ?? null,
        linked_photo_id: fresh.linkedPhotoId ?? null,
        linked_punch_item_id: fresh.linkedPunchItemId ?? null,
        linked_rfi_id: fresh.linkedRfiId ?? null,
        created_at: fresh.createdAt, updated_at: fresh.updatedAt,
      });
    }
    return fresh;
  }, [drawingPins, persistDrawingPins, canSync, userId]);

  const updateDrawingPin = useCallback((id: string, updates: Partial<DrawingPin>) => {
    const now = new Date().toISOString();
    persistDrawingPins(drawingPins.map(p => p.id === id ? { ...p, ...updates, updatedAt: now } : p));
    if (canSync) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (updates.x !== undefined) patch.x = updates.x;
      if (updates.y !== undefined) patch.y = updates.y;
      if (updates.label !== undefined) patch.label = updates.label;
      if (updates.color !== undefined) patch.color = updates.color;
      if (updates.kind !== undefined) patch.kind = updates.kind;
      if (updates.linkedPhotoId !== undefined) patch.linked_photo_id = updates.linkedPhotoId;
      if (updates.linkedPunchItemId !== undefined) patch.linked_punch_item_id = updates.linkedPunchItemId;
      if (updates.linkedRfiId !== undefined) patch.linked_rfi_id = updates.linkedRfiId;
      void supabaseWrite('drawing_pins', 'update', { id, ...patch });
    }
  }, [drawingPins, persistDrawingPins, canSync]);

  const deleteDrawingPin = useCallback((id: string) => {
    persistDrawingPins(drawingPins.filter(p => p.id !== id));
    if (canSync) void supabaseWrite('drawing_pins', 'delete', { id });
  }, [drawingPins, persistDrawingPins, canSync]);

  const getPinsForPlan = useCallback((planSheetId: string) =>
    drawingPins.filter(p => p.planSheetId === planSheetId),
    [drawingPins]);

  const getPinsForPhoto = useCallback((photoId: string) =>
    drawingPins.filter(p => p.linkedPhotoId === photoId),
    [drawingPins]);

  const addPlanZone = useCallback((zone: Omit<PlanZone, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const fresh: PlanZone = { ...zone, id: generateUUID(), createdAt: now, updatedAt: now };
    persistPlanZones([fresh, ...planZones]);
    return fresh;
  }, [planZones, persistPlanZones]);

  const updatePlanZone = useCallback((id: string, patch: Partial<PlanZone>) => {
    persistPlanZones(planZones.map((z) => (z.id === id ? { ...z, ...patch, updatedAt: new Date().toISOString() } : z)));
  }, [planZones, persistPlanZones]);

  const deletePlanZone = useCallback((id: string) => {
    persistPlanZones(planZones.filter((z) => z.id !== id));
  }, [planZones, persistPlanZones]);

  const getPlanZonesForPlan = useCallback((planSheetId: string) => planZones.filter((z) => z.planSheetId === planSheetId), [planZones]);
  const getPlanZonesForProject = useCallback((projectId: string) => planZones.filter((z) => z.projectId === projectId), [planZones]);

  const getPlanReviewForSheet = useCallback((planSheetId: string): PlanReview | null =>
    planReviews.find((r) => r.planSheetId === planSheetId) ?? null, [planReviews]);

  const savePlanReview = useCallback((review: PlanReview) => {
    // upsert one review per plan sheet
    persistPlanReviews([review, ...planReviews.filter((r) => r.planSheetId !== review.planSheetId)]);
  }, [planReviews, persistPlanReviews]);

  const updatePlanReview = useCallback((id: string, patch: Partial<PlanReview>) => {
    persistPlanReviews(planReviews.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, [planReviews, persistPlanReviews]);

  const deletePlanReview = useCallback((id: string) => {
    persistPlanReviews(planReviews.filter((r) => r.id !== id));
  }, [planReviews, persistPlanReviews]);

  const addPlanMarkup = useCallback((markup: Omit<PlanMarkup, 'id' | 'createdAt'>) => {
    const fresh: PlanMarkup = {
      ...markup,
      id: generateUUID(),
      createdAt: new Date().toISOString(),
    };
    persistPlanMarkups([fresh, ...planMarkups]);
    if (canSync) {
      void supabaseWrite('plan_markups', 'insert', {
        id: fresh.id, user_id: userId, project_id: fresh.projectId,
        plan_sheet_id: fresh.planSheetId, type: fresh.type, color: fresh.color,
        stroke_width: fresh.strokeWidth ?? null,
        points: fresh.points, text: fresh.text ?? null,
        created_at: fresh.createdAt,
      });
    }
    return fresh;
  }, [planMarkups, persistPlanMarkups, canSync, userId]);

  const deletePlanMarkup = useCallback((id: string) => {
    persistPlanMarkups(planMarkups.filter(m => m.id !== id));
    if (canSync) void supabaseWrite('plan_markups', 'delete', { id });
  }, [planMarkups, persistPlanMarkups, canSync]);

  const getMarkupsForPlan = useCallback((planSheetId: string) =>
    planMarkups.filter(m => m.planSheetId === planSheetId),
    [planMarkups]);

  const upsertPlanCalibration = useCallback((cal: Omit<PlanCalibration, 'id' | 'createdAt'>) => {
    const existing = planCalibrations.find(c => c.planSheetId === cal.planSheetId);
    if (existing) {
      const next: PlanCalibration = { ...existing, ...cal };
      persistPlanCalibrations(planCalibrations.map(c => c.id === existing.id ? next : c));
      if (canSync) {
        // Server schema has a UNIQUE on plan_sheet_id, so the insert path
        // via `supabaseWrite` (which uses upsert) handles both create and
        // replace. Cheaper than branching to an update here.
        void supabaseWrite('plan_calibrations', 'insert', {
          id: next.id, user_id: userId, project_id: next.projectId,
          plan_sheet_id: next.planSheetId,
          p1: next.p1, p2: next.p2, real_distance_ft: next.realDistanceFt,
          created_at: next.createdAt,
        });
      }
      return next;
    }
    const fresh: PlanCalibration = {
      ...cal,
      id: generateUUID(),
      createdAt: new Date().toISOString(),
    };
    persistPlanCalibrations([fresh, ...planCalibrations]);
    if (canSync) {
      void supabaseWrite('plan_calibrations', 'insert', {
        id: fresh.id, user_id: userId, project_id: fresh.projectId,
        plan_sheet_id: fresh.planSheetId,
        p1: fresh.p1, p2: fresh.p2, real_distance_ft: fresh.realDistanceFt,
        created_at: fresh.createdAt,
      });
    }
    return fresh;
  }, [planCalibrations, persistPlanCalibrations, canSync, userId]);

  const getCalibrationForPlan = useCallback((planSheetId: string) =>
    planCalibrations.find(c => c.planSheetId === planSheetId),
    [planCalibrations]);

  const getPermitRoadmapForProject = useCallback((projectId: string) =>
    permitRoadmaps.find((r) => r.projectId === projectId),
    [permitRoadmaps]);
  const savePermitRoadmap = useCallback((roadmap: PermitRoadmap) => {
    persistPermitRoadmaps([roadmap, ...permitRoadmaps.filter((r) => r.projectId !== roadmap.projectId)]);
  }, [permitRoadmaps, persistPermitRoadmaps]);
  const updatePermitRoadmap = useCallback((id: string, patch: Partial<PermitRoadmap>) => {
    persistPermitRoadmaps(permitRoadmaps.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, [permitRoadmaps, persistPermitRoadmaps]);
  const deletePermitRoadmap = useCallback((id: string) => {
    persistPermitRoadmaps(permitRoadmaps.filter((r) => r.id !== id));
  }, [permitRoadmaps, persistPermitRoadmaps]);

  // Deleting a project CASCADES: the project row AND every project-scoped child
  // record across every collection are removed. Without this, deleting a project
  // orphaned every child on disk — a privacy/storage leak, and on web
  // AsyncStorage is shared per-origin localStorage. Kept next to the persist
  // helpers so each collection is torn down through its OWN persistence path
  // (mutation or persistX), never a raw setState that skips the write.
  //
  // Scope rules:
  //  - COIs: CertificateOfInsurance.projectId is OPTIONAL. A null/undefined
  //    projectId is the sub's blanket cert on file — keep it. Only project-
  //    specific COIs (projectId === id) are removed.
  //  - Equipment / Subcontractors / contacts / leads / priceAlerts / commEvents
  //    are company-global, NOT project-scoped, so they are intentionally NOT
  //    cascaded. (Equipment.currentProjectId is a soft assignment, not
  //    ownership — the asset survives the project.)
  //  - plan sub-collections (drawingPins/planZones/planReviews/planMarkups/
  //    planCalibrations) each carry a `projectId` of their own, so they can be
  //    filtered directly; we also clear the parent planSheets in the same pass.
  //
  // Server side: syncProjectToSupabase(toDelete, 'delete') issues the parent
  // row delete only; child tables are expected to clean up via ON DELETE
  // CASCADE foreign keys (same contract deletePlanSheet already relies on).
  const deleteProject = useCallback((id: string) => {
    const toDelete = projects.find(p => p.id === id);

    // 1) Remove the project row.
    const updatedProjects = projects.filter(p => p.id !== id);
    setProjects(updatedProjects);
    saveProjectsMutation.mutate(updatedProjects);

    // 2) Cascade every project-scoped child collection through its own
    //    persistence mechanism. Each block: filter out this project's records,
    //    set state, persist. Only touch a collection if it actually shrank, so
    //    we don't churn AsyncStorage / query cache for projects with no data of
    //    that kind.
    const cascadeMutation = <T extends { projectId?: string }>(
      list: T[],
      setState: (next: T[]) => void,
      mutation: { mutate: (next: T[]) => void },
    ) => {
      const next = list.filter(r => r.projectId !== id);
      if (next.length === list.length) return;
      setState(next);
      mutation.mutate(next);
    };
    const cascadePersist = <T extends { projectId?: string }>(
      list: T[],
      persist: (next: T[]) => void,
    ) => {
      const next = list.filter(r => r.projectId !== id);
      if (next.length === list.length) return;
      persist(next);
    };

    // --- collections persisted via saveXMutation (state setter + mutation) ---
    cascadeMutation(changeOrders, setChangeOrders, saveChangeOrdersMutation);
    cascadeMutation(invoices, setInvoices, saveInvoicesMutation);
    cascadeMutation(commitments, setCommitments, saveCommitmentsMutation);
    cascadeMutation(dailyReports, setDailyReports, saveDailyReportsMutation);
    cascadeMutation(fieldTickets, setFieldTickets, saveFieldTicketsMutation);
    cascadeMutation(delayEvents, setDelayEvents, saveDelayEventsMutation);
    cascadeMutation(punchItems, setPunchItems, savePunchItemsMutation);
    cascadeMutation(projectPhotos, setProjectPhotos, savePhotosMutation);
    cascadeMutation(rfis, setRfis, saveRfisMutation);
    cascadeMutation(submittals, setSubmittals, saveSubmittalsMutation);
    cascadeMutation(oacMeetings, setOacMeetings, saveOACMeetingsMutation);
    cascadeMutation(permits, setPermits, savePermitsMutation);
    cascadeMutation(aiaPayApps, setAiaPayApps, saveAiaPayAppsMutation);
    cascadeMutation(subPortalLinks, setSubPortalLinks, saveSubPortalLinksMutation);
    // commEvents are project-scoped (CommunicationEvent.projectId is required and
    // getCommEventsForProject filters on it), so they cascade like the rest.
    cascadeMutation(commEvents, setCommEvents, saveCommEventsMutation);

    // COIs: keep blanket certs (projectId undefined/null) and other projects'
    // certs — only drop this project's project-specific COIs.
    {
      const nextCois = cois.filter(c => c.projectId !== id);
      if (nextCois.length !== cois.length) {
        setCois(nextCois);
        saveCOIsMutation.mutate(nextCois);
      }
    }

    // Bid packages + their dependent bids. Bids key off packageId, so first
    // collect the doomed package ids for this project, then drop both.
    {
      const nextPackages = bidPackages.filter(p => p.projectId !== id);
      if (nextPackages.length !== bidPackages.length) {
        const doomedPackageIds = new Set(
          bidPackages.filter(p => p.projectId === id).map(p => p.id),
        );
        setBidPackages(nextPackages);
        saveBidPackagesMutation.mutate(nextPackages);
        const nextBids = bidPackageBids.filter(b => !doomedPackageIds.has(b.packageId));
        if (nextBids.length !== bidPackageBids.length) {
          setBidPackageBids(nextBids);
          saveBidPackageBidsMutation.mutate(nextBids);
        }
      }
    }

    // --- collections persisted via a persistX helper (does its own setState) ---
    cascadePersist(warranties, persistWarranties);
    cascadePersist(portalMessages, persistPortalMessages);
    cascadePersist(permitRoadmaps, persistPermitRoadmaps);

    // Plan collections: parent sheets + every sheet-linked sub-collection. Each
    // sub-collection carries its own projectId, so filter directly.
    cascadePersist(planSheets, persistPlanSheets);
    cascadePersist(drawingPins, persistDrawingPins);
    cascadePersist(planZones, persistPlanZones);
    cascadePersist(planReviews, persistPlanReviews);
    cascadePersist(planMarkups, persistPlanMarkups);
    cascadePersist(planCalibrations, persistPlanCalibrations);

    // 3) Server: parent delete (children fall to FK cascade — see note above).
    if (toDelete) syncProjectToSupabase(toDelete, 'delete');
  }, [
    projects, saveProjectsMutation, syncProjectToSupabase,
    changeOrders, saveChangeOrdersMutation,
    invoices, saveInvoicesMutation,
    commitments, saveCommitmentsMutation,
    dailyReports, saveDailyReportsMutation,
    fieldTickets, saveFieldTicketsMutation,
    delayEvents, saveDelayEventsMutation,
    punchItems, savePunchItemsMutation,
    projectPhotos, savePhotosMutation,
    rfis, saveRfisMutation,
    submittals, saveSubmittalsMutation,
    oacMeetings, saveOACMeetingsMutation,
    permits, savePermitsMutation,
    aiaPayApps, saveAiaPayAppsMutation,
    subPortalLinks, saveSubPortalLinksMutation,
    commEvents, saveCommEventsMutation,
    cois, saveCOIsMutation,
    bidPackages, saveBidPackagesMutation,
    bidPackageBids, saveBidPackageBidsMutation,
    warranties, persistWarranties,
    portalMessages, persistPortalMessages,
    permitRoadmaps, persistPermitRoadmaps,
    planSheets, persistPlanSheets,
    drawingPins, persistDrawingPins,
    planZones, persistPlanZones,
    planReviews, persistPlanReviews,
    planMarkups, persistPlanMarkups,
    planCalibrations, persistPlanCalibrations,
  ]);

  const sortedProjects = useMemo(() => [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [projects]);

  // ── Bucket memos ─────────────────────────────────────────────────────────────
  const coreData = useMemo<CoreDataValue>(() => ({
    projects: sortedProjects, settings, hasSeenOnboarding, userRole,
    isLoading: projectsQuery.isLoading || settingsQuery.isLoading || onboardingQuery.isLoading || userRoleQuery.isLoading,
    projectsLoaded,
    addProject, updateProject, deleteProject, getProject, updateSettings,
    addCollaborator, removeCollaborator,
    priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert,
    contacts, addContact, updateContact, deleteContact, getContact,
    commEvents, addCommEvent, getCommEventsForProject,
  }), [sortedProjects, settings, hasSeenOnboarding, userRole, projectsQuery.isLoading, settingsQuery.isLoading, onboardingQuery.isLoading, userRoleQuery.isLoading, projectsLoaded, addProject, updateProject, deleteProject, getProject, updateSettings, addCollaborator, removeCollaborator, priceAlerts, addPriceAlert, updatePriceAlert, deletePriceAlert, contacts, addContact, updateContact, deleteContact, getContact, commEvents, addCommEvent, getCommEventsForProject]);

  const financialsData = useMemo<FinancialsDataValue>(() => ({
    changeOrders, addChangeOrder, addChangeOrders, getChangeOrdersForProject,
    addInvoice, updateInvoice, getInvoicesForProject, getTotalOutstandingBalance, invoices,
    commitments, addCommitment, updateCommitment, deleteCommitment, getCommitmentsForProject,
    prequalPackets, upsertPrequalPacket, deletePrequalPacket, getPrequalPacketForSub, getPrequalPacketByToken,
    aiaPayApps, addAIAPayApp, deleteAIAPayApp, getAIAPayAppsForProject,
    delayEvents, addDelayEvent, updateDelayEvent, deleteDelayEvent, getDelayEventsForProject,
  }), [changeOrders, addChangeOrder, addChangeOrders, getChangeOrdersForProject, addInvoice, updateInvoice, getInvoicesForProject, getTotalOutstandingBalance, invoices, commitments, addCommitment, updateCommitment, deleteCommitment, getCommitmentsForProject, prequalPackets, upsertPrequalPacket, deletePrequalPacket, getPrequalPacketForSub, getPrequalPacketByToken, aiaPayApps, addAIAPayApp, deleteAIAPayApp, getAIAPayAppsForProject, delayEvents, addDelayEvent, updateDelayEvent, deleteDelayEvent, getDelayEventsForProject]);

  const fieldData = useMemo<FieldDataValue>(() => ({
    dailyReports, getDailyReportsForProject,
    fieldTickets, addFieldTicket, updateFieldTicket, getFieldTicketsForProject,
    punchItems, addPunchItem, addPunchItems, updatePunchItem, deletePunchItem, getPunchItemsForProject,
    projectPhotos, addProjectPhoto, updateProjectPhoto, deleteProjectPhoto, getPhotosForProject,
    equipment, addEquipment, updateEquipment, deleteEquipment, logUtilization, getEquipmentForProject, getEquipmentCostForProject,
    planSheets, addPlanSheet, updatePlanSheet, deletePlanSheet, getPlanSheetsForProject, getPlanSheet,
    drawingPins, addDrawingPin, updateDrawingPin, deleteDrawingPin, getPinsForPlan, getPinsForPhoto,
    planZones, addPlanZone, updatePlanZone, deletePlanZone, getPlanZonesForPlan, getPlanZonesForProject,
    planReviews, getPlanReviewForSheet, savePlanReview, updatePlanReview, deletePlanReview,
    planMarkups, addPlanMarkup, deletePlanMarkup, getMarkupsForPlan,
    planCalibrations, upsertPlanCalibration, getCalibrationForPlan,
    permitRoadmaps, getPermitRoadmapForProject, savePermitRoadmap, updatePermitRoadmap, deletePermitRoadmap,
  }), [dailyReports, getDailyReportsForProject, fieldTickets, addFieldTicket, updateFieldTicket, getFieldTicketsForProject, punchItems, addPunchItem, addPunchItems, updatePunchItem, deletePunchItem, getPunchItemsForProject, projectPhotos, addProjectPhoto, updateProjectPhoto, deleteProjectPhoto, getPhotosForProject, equipment, addEquipment, updateEquipment, deleteEquipment, logUtilization, getEquipmentForProject, getEquipmentCostForProject, planSheets, addPlanSheet, updatePlanSheet, deletePlanSheet, getPlanSheetsForProject, getPlanSheet, drawingPins, addDrawingPin, updateDrawingPin, deleteDrawingPin, getPinsForPlan, getPinsForPhoto, planZones, addPlanZone, updatePlanZone, deletePlanZone, getPlanZonesForPlan, getPlanZonesForProject, persistPlanZones, planReviews, getPlanReviewForSheet, savePlanReview, updatePlanReview, deletePlanReview, persistPlanReviews, planMarkups, addPlanMarkup, deletePlanMarkup, getMarkupsForPlan, planCalibrations, upsertPlanCalibration, getCalibrationForPlan, permitRoadmaps, getPermitRoadmapForProject, savePermitRoadmap, updatePermitRoadmap, deletePermitRoadmap, persistPermitRoadmaps]);

  const preconData = useMemo<PreconDataValue>(() => ({
    subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, getSubcontractor,
    leads, addLead, updateLead, deleteLead, getLead, getLeadsByStage, addLeadTouch,
    bidPackages, bidPackageBids,
    addBidPackage, updateBidPackage, deleteBidPackage, getBidPackagesForProject, getBidPackage,
    addBidPackageBid, updateBidPackageBid, deleteBidPackageBid, getBidsForPackage,
    cois, addCOI, updateCOI, deleteCOI, getCOIsForSub,
  }), [subcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor, getSubcontractor, leads, addLead, updateLead, deleteLead, getLead, getLeadsByStage, addLeadTouch, bidPackages, bidPackageBids, addBidPackage, updateBidPackage, deleteBidPackage, getBidPackagesForProject, getBidPackage, addBidPackageBid, updateBidPackageBid, deleteBidPackageBid, getBidsForPackage, cois, addCOI, updateCOI, deleteCOI, getCOIsForSub]);

  const docsData = useMemo<DocsDataValue>(() => ({
    rfis, addRFI, addRFIs, updateRFI, deleteRFI, getRFIsForProject,
    permits, addPermit, updatePermit, deletePermit, getPermitsForProject,
    subPortalLinks, upsertSubPortalLink, deleteSubPortalLink, getSubPortalLinkFor, getSubPortalLinksForProject,
    submittals, addSubmittal, addSubmittals, updateSubmittal, deleteSubmittal, getSubmittalsForProject, addReviewCycle,
    oacMeetings, addOACMeeting, updateOACMeeting, deleteOACMeeting, getOACMeetingsForProject,
    warranties, addWarranty, updateWarranty, deleteWarranty, getWarrantiesForProject, addWarrantyClaim,
    portalMessages, addPortalMessage, markPortalMessagesRead, getPortalMessagesForProject, getUnreadPortalMessageCount, getTotalUnreadPortalCountForGc,
  }), [rfis, addRFI, addRFIs, updateRFI, deleteRFI, getRFIsForProject, permits, addPermit, updatePermit, deletePermit, getPermitsForProject, subPortalLinks, upsertSubPortalLink, deleteSubPortalLink, getSubPortalLinkFor, getSubPortalLinksForProject, submittals, addSubmittal, addSubmittals, updateSubmittal, deleteSubmittal, getSubmittalsForProject, addReviewCycle, oacMeetings, addOACMeeting, updateOACMeeting, deleteOACMeeting, getOACMeetingsForProject, warranties, addWarranty, updateWarranty, deleteWarranty, getWarrantiesForProject, addWarrantyClaim, portalMessages, addPortalMessage, markPortalMessagesRead, getPortalMessagesForProject, getUnreadPortalMessageCount, getTotalUnreadPortalCountForGc]);

  const stableActions = useMemo<StableActionsValue>(() => ({
    completeOnboarding,
    setUserRole,
  }), [completeOnboarding, setUserRole]);

  // Non-destructive import (app/data-import.tsx). Merges records from a MAGE
  // export BY ID — never overwrites or deletes existing rows, so re-importing
  // the same file is a no-op and importing onto a populated account is safe.
  // One functional-safe state update + one persist per collection (the per-item
  // add* helpers capture a stale array in a batch loop, which would drop all
  // but the last), plus per-new-item Supabase sync so imported rows survive the
  // next remote refetch. Reuses the exact mappings from addContact /
  // addSubcontractor / syncProjectToSupabase. v1 covers projects + the two
  // "book of business" lists; child financial/field records follow once their
  // add* paths expose a batch-safe, id-preserving sync.
  const importData = useCallback((payload: { projects?: Project[]; contacts?: Contact[]; subcontractors?: Subcontractor[] }) => {
    const result = { projects: 0, contacts: 0, subcontractors: 0 };

    if (payload.projects?.length) {
      const have = new Set(projects.map(p => p.id));
      const add = payload.projects.filter(p => p.id && !have.has(p.id));
      if (add.length) {
        const merged = [...add, ...projects];
        setProjects(merged);
        saveProjectsMutation.mutate(merged);
        add.forEach(p => syncProjectToSupabase(p, 'upsert'));
        result.projects = add.length;
      }
    }

    if (payload.contacts?.length) {
      const have = new Set(contacts.map(c => c.id));
      const add = payload.contacts.filter(c => c.id && !have.has(c.id));
      if (add.length) {
        const merged = [...add, ...contacts];
        setContacts(merged);
        saveContactsMutation.mutate(merged);
        if (canSync) add.forEach(c => void supabaseWrite('contacts', 'insert', {
          id: c.id, user_id: userId, first_name: c.firstName, last_name: c.lastName,
          company_name: c.companyName, role: c.role, email: c.email,
          secondary_email: c.secondaryEmail, phone: c.phone, address: c.address,
          notes: c.notes, linked_project_ids: c.linkedProjectIds,
          created_at: c.createdAt, updated_at: c.updatedAt,
        }));
        result.contacts = add.length;
      }
    }

    if (payload.subcontractors?.length) {
      const have = new Set(subcontractors.map(s => s.id));
      const add = payload.subcontractors.filter(s => s.id && !have.has(s.id));
      if (add.length) {
        const merged = [...add, ...subcontractors];
        setSubcontractors(merged);
        saveSubsMutation.mutate(merged);
        if (canSync) add.forEach(s => void supabaseWrite('subcontractors', 'insert', {
          id: s.id, user_id: userId, company_name: s.companyName, contact_name: s.contactName,
          phone: s.phone, email: s.email, address: s.address, trade: s.trade,
          license_number: s.licenseNumber, license_expiry: s.licenseExpiry, coi_expiry: s.coiExpiry,
          w9_on_file: s.w9OnFile, bid_history: s.bidHistory, assigned_projects: s.assignedProjects,
          notes: s.notes, created_at: s.createdAt, updated_at: s.updatedAt,
        }));
        result.subcontractors = add.length;
      }
    }

    return result;
  }, [projects, contacts, subcontractors, saveProjectsMutation, saveContactsMutation, saveSubsMutation, syncProjectToSupabase, canSync, userId]);

  const crossDomain = useMemo<CrossDomainValue>(() => ({
    updateChangeOrder, addDailyReport, updateDailyReport, convertLeadToProject, awardBidPackage,
    sendToClientPortal, recallFromClientPortal, batchSendToClientPortal, importData,
  }), [updateChangeOrder, addDailyReport, updateDailyReport, convertLeadToProject, awardBidPackage, sendToClientPortal, recallFromClientPortal, batchSendToClientPortal, importData]);

  return (
    <StableActionsContext.Provider value={stableActions}>
      <CrossDomainContext.Provider value={crossDomain}>
        <CoreDataContext.Provider value={coreData}>
          <FinancialsDataContext.Provider value={financialsData}>
            <FieldDataContext.Provider value={fieldData}>
              <PreconDataContext.Provider value={preconData}>
                <DocsDataContext.Provider value={docsData}>
                  {children}
                </DocsDataContext.Provider>
              </PreconDataContext.Provider>
            </FieldDataContext.Provider>
          </FinancialsDataContext.Provider>
        </CoreDataContext.Provider>
      </CrossDomainContext.Provider>
    </StableActionsContext.Provider>
  );
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  return <ProjectProviderInner>{children}</ProjectProviderInner>;
}

function useCtx<T>(c: React.Context<T | null>, name: string): T {
  const v = useContext(c);
  if (v === null) throw new Error(`${name} must be used within ProjectProvider`);
  return v;
}

export function useProjects() {
  return {
    ...useCtx(CoreDataContext, 'CoreDataContext'),
    ...useCtx(FinancialsDataContext, 'FinancialsDataContext'),
    ...useCtx(FieldDataContext, 'FieldDataContext'),
    ...useCtx(PreconDataContext, 'PreconDataContext'),
    ...useCtx(DocsDataContext, 'DocsDataContext'),
    ...useCtx(StableActionsContext, 'StableActionsContext'),
    ...useCtx(CrossDomainContext, 'CrossDomainContext'),
  };
}

export const useCoreData = () => useCtx(CoreDataContext, 'CoreDataContext');
export const useFinancialsData = () => useCtx(FinancialsDataContext, 'FinancialsDataContext');
export const useFieldData = () => useCtx(FieldDataContext, 'FieldDataContext');
export const usePreconData = () => useCtx(PreconDataContext, 'PreconDataContext');
export const useDocsData = () => useCtx(DocsDataContext, 'DocsDataContext');
export const useProjectActions = () => useCtx(StableActionsContext, 'StableActionsContext');
export const useProjectCrossActions = () => useCtx(CrossDomainContext, 'CrossDomainContext');
