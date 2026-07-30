// consumerPassport — the HOMEOWNER-OWNED Home Passport, assembled ACROSS jobs.
//
// buildHomePassport.ts (sibling) is the CONTRACTOR-side closeout artifact: it
// turns ONE project into retrieval docs + FAQ inputs for the portal's "Ask Your
// Home" box. This module is the other half of the story — the permanent record
// the homeowner keeps FOREVER:
//
//   one home  →  many projects  →  many contractors  →  one passport
//
// It survives the contractor. A homeowner who has this record shows up to their
// next job already holding permits, warranties, model numbers, and a maintenance
// schedule — and asks the next contractor to keep it in MAGE. That's the point.
//
// ── HARD RULE: HOMEOWNER-FACING ────────────────────────────────────────────
// This output is rendered to the OWNER. It must NEVER carry the contractor's
// cost, markup, margin, or any internal job-costing figure. Concretely:
//   • Commitment.amount / changeAmount / paidToDate      → NEVER emitted
//   • SelectionOption.unitPrice / total                  → NEVER emitted
//   • Permit.fee                                         → NEVER emitted
//   • WarrantyClaim.cost                                 → NEVER emitted
//   • Estimate cost buildups, budgets, rates             → not an input at all
// The ONLY money in this file is the owner's OWN payment record (what they were
// billed and what they paid, off their own invoices). Freetext lifted out of an
// internal subcontract is money-scrubbed on the way out (see stripMoney).
// scripts/validate-home-passport-consumer.ts pins all of the above.
//
// PURE: no React, no network, no Date.now(), no randomness. Every time-derived
// value reads the caller-supplied `nowMs`, so the whole thing is testable.

import type {
  Commitment,
  Invoice,
  Permit,
  ProjectDocument,
  ProjectPhoto,
  PortalState,
  SelectionCategory,
  Subcontractor,
  Warranty,
} from '@/types';
import type { MaintenanceItem } from '@/utils/closeoutBinderEngine';

// ─────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────

/** Days-out from `nowMs` that counts a warranty/permit as "expiring soon". */
export const DEFAULT_EXPIRING_WITHIN_DAYS = 90;
/** Days-out from `nowMs` that counts a maintenance task as "due soon". */
export const DEFAULT_DUE_SOON_WITHIN_DAYS = 30;
/** Alerts above this window are informational, not urgent. */
export const URGENT_WITHIN_DAYS = 30;

/** Warranty categories that describe a physical machine the owner will one day
 *  need to service or replace — these become equipment records even when no
 *  selection row exists for them. */
const EQUIPMENT_WARRANTY_CATEGORIES = new Set<string>([
  'hvac', 'appliances', 'plumbing', 'electrical', 'roofing', 'windows', 'structural',
]);

// ─────────────────────────────────────────────────────────────────────
// Input
// ─────────────────────────────────────────────────────────────────────

export interface PassportHomeInput {
  /** Street address of the home. Derived from the projects when omitted. */
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  squareFootage?: number;
}

/** The company that ran a job. Contact info only — never their numbers. */
export interface PassportContractorInput {
  id?: string;
  companyName: string;
  contactName?: string;
  phone?: string;
  email?: string;
  licenseNumber?: string;
  website?: string;
}

/** A job done on this home. Structural (not the full `Project`) so callers can
 *  feed passports from a portal snapshot, an export, or live state alike. */
export interface PassportJobInput {
  id: string;
  name: string;
  /** Where the work happened. Used to group jobs onto one home. */
  location?: string;
  /** Free display string ('renovation', 'roofing', …). */
  type?: string;
  /** Project.status — 'completed' / 'closed' mark the job done. */
  status?: string;
  createdAt?: string;
  substantialCompletionDate?: string;
  closedAt?: string;
  squareFootage?: number;
  contractor?: PassportContractorInput;
}

/** MaintenanceItem has no projectId of its own, so it arrives wrapped. */
export interface PassportMaintenanceInput {
  projectId: string;
  items: MaintenanceItem[];
}

export interface BuildConsumerPassportInput {
  home?: PassportHomeInput;
  /** Every job ever done on this home, oldest or newest first — order is
   *  normalized internally. */
  projects: PassportJobInput[];
  /** Cross-job collections. Each is filtered to the known projects internally. */
  warranties?: Warranty[];
  permits?: Permit[];
  selections?: SelectionCategory[];
  maintenance?: PassportMaintenanceInput[];
  commitments?: Commitment[];
  subcontractors?: Subcontractor[];
  photos?: ProjectPhoto[];
  /** The owner's OWN invoices — the only money source in this module. */
  invoices?: Invoice[];
  documents?: ProjectDocument[];
  /** Wall clock, injected. Every time-derived field reads only this. */
  nowMs: number;
  expiringWithinDays?: number;
  dueSoonWithinDays?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────────────────────────────

export type WarrantyState = 'active' | 'expiring_soon' | 'expired' | 'unknown';
export type MaintenanceState = 'overdue' | 'due_soon' | 'scheduled' | 'unscheduled';
export type PassportProjectState = 'completed' | 'in_progress';
export type PassportContractorRole = 'general_contractor' | 'trade' | 'supplier';
export type PassportDocumentKind =
  | 'permit' | 'warranty' | 'photo' | 'as_built' | 'contract' | 'other';
export type PassportAlertKind =
  | 'warranty_expiring' | 'maintenance_overdue' | 'maintenance_due' | 'permit_expiring';
export type PassportAlertSeverity = 'high' | 'medium';

export interface PassportHome {
  /** Stable id derived from the normalized address — survives re-generation. */
  homeId: string;
  address: string;
  /** Normalized address used for id + grouping. */
  addressKey: string;
  city?: string;
  state?: string;
  postalCode?: string;
  squareFootage?: number;
  /** ISO date (YYYY-MM-DD) of the earliest job on record. */
  onRecordSince: string | null;
  projectCount: number;
}

export interface PassportProject {
  id: string;
  name: string;
  type: string;
  address: string;
  state: PassportProjectState;
  startedOn: string | null;
  completedOn: string | null;
  contractorId: string | null;
  contractorName: string | null;
  /** Owner's own payment record. NOT the contractor's cost. */
  amountBilled: number;
  amountPaid: number;
  warrantyCount: number;
  permitCount: number;
  photoCount: number;
  documentCount: number;
}

export interface PassportWarranty {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  category: string;
  provider: string;
  startDate: string | null;
  endDate: string | null;
  durationMonths: number;
  coverageDetails?: string;
  exclusions?: string;
  documentUri?: string;
  state: WarrantyState;
  /** Negative once expired. Null when the warranty has no usable end date. */
  daysRemaining: number | null;
  claimCount: number;
}

export interface PassportPermit {
  id: string;
  projectId: string;
  projectName: string;
  type: string;
  permitNumber: string | null;
  jurisdiction: string;
  status: string;
  appliedDate: string | null;
  approvedDate: string | null;
  expiresDate: string | null;
  inspectionDate: string | null;
  phase?: string;
  documentUri?: string;
  /** True once the permit passed inspection — the record the owner needs at
   *  resale ("was this work permitted and signed off?"). */
  isFinaled: boolean;
  daysUntilExpiry: number | null;
}

export interface PassportEquipment {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  category: string;
  brand?: string;
  /** The number the owner reads off the unit when ordering a part. */
  modelNumber?: string;
  supplier?: string;
  /** Room / selection area, e.g. "Kitchen Cabinets". */
  location?: string;
  installedOn: string | null;
  warrantyId?: string;
  warrantyEndDate?: string;
  source: 'selection' | 'warranty';
}

export interface PassportMaintenanceTask {
  id: string;
  projectId: string;
  projectName: string;
  task: string;
  frequency: string;
  notes?: string;
  nextDueDate: string | null;
  daysUntilDue: number | null;
  state: MaintenanceState;
}

export interface PassportContractor {
  id: string;
  companyName: string;
  role: PassportContractorRole;
  trade?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  licenseNumber?: string;
  website?: string;
  projectIds: string[];
  projectNames: string[];
  /** What they did, money-scrubbed. Never what they were paid. */
  scopes: string[];
  firstWorkedOn: string | null;
  lastWorkedOn: string | null;
}

export interface PassportDocument {
  id: string;
  projectId: string;
  projectName: string;
  kind: PassportDocumentKind;
  title: string;
  date: string | null;
  uri?: string;
}

/** The owner's own paid-invoice record. */
export interface PassportReceipt {
  id: string;
  projectId: string;
  projectName: string;
  label: string;
  issueDate: string | null;
  amountBilled: number;
  amountPaid: number;
  paidInFull: boolean;
  payments: { date: string; amountPaid: number; method: string }[];
}

export interface PassportAlert {
  id: string;
  kind: PassportAlertKind;
  severity: PassportAlertSeverity;
  title: string;
  detail: string;
  dueDate: string | null;
  daysOut: number | null;
  projectId: string;
}

export interface PassportStats {
  projectCount: number;
  completedProjectCount: number;
  contractorCount: number;
  activeWarranties: number;
  expiringWarranties: number;
  expiredWarranties: number;
  permitCount: number;
  finaledPermits: number;
  equipmentCount: number;
  documentCount: number;
  photoCount: number;
  maintenanceOverdue: number;
  maintenanceDueSoon: number;
  /** Owner's own lifetime spend on this home, across every contractor. */
  totalPaid: number;
}

export interface ConsumerPassport {
  home: PassportHome;
  projects: PassportProject[];
  warranties: PassportWarranty[];
  permits: PassportPermit[];
  equipment: PassportEquipment[];
  maintenance: PassportMaintenanceTask[];
  contractors: PassportContractor[];
  documents: PassportDocument[];
  receipts: PassportReceipt[];
  alerts: PassportAlert[];
  stats: PassportStats;
  /** Echo of the caller's clock. The passport is a snapshot AS OF this instant. */
  generatedAtMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function clean(s: string | number | undefined | null): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Strip `$1,200` / `$4.5k` style figures out of text lifted from an internal
 *  contract document, so a subcontract amount typed into a scope description
 *  can never reach the homeowner. */
export function stripMoney(s: string | undefined | null): string {
  return clean(s)
    .replace(/\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|mm)?\b/gi, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
    .trim();
}

/** 'YYYY-MM-DD' prefix of an ISO date/timestamp, or '' when unparseable. */
function isoDay(iso: string | undefined | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(iso));
  if (!m) return '';
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** UTC-midnight ms for an ISO date. Timezone-free so results never depend on
 *  where the validator runs. */
function dayMs(iso: string | undefined | null): number | null {
  const d = isoDay(iso);
  if (!d) return null;
  const ms = Date.UTC(parseInt(d.slice(0, 4), 10), parseInt(d.slice(5, 7), 10) - 1, parseInt(d.slice(8, 10), 10));
  return Number.isFinite(ms) ? ms : null;
}

function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

/** Whole days from `nowMs` to the ISO date. Negative = in the past. */
function daysFromNow(iso: string | undefined | null, nowMs: number): number | null {
  const t = dayMs(iso);
  if (t === null) return null;
  return Math.round((t - startOfDay(nowMs)) / DAY_MS);
}

/** Mirror of buildHomePassport.isShared — undefined portalState is
 *  grandfathered as sent; only explicit 'sent' otherwise. */
function isShared(s?: PortalState): boolean {
  return s == null || s.status === 'sent';
}

function slug(s: string): string {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function normalizeAddress(s: string): string {
  return clean(s).toLowerCase().replace(/[.,#]/g, '').replace(/\s+/g, ' ').trim();
}

function earliest(dates: (string | null)[]): string | null {
  const valid = dates.map(isoDay).filter(Boolean).sort();
  return valid.length > 0 ? valid[0] : null;
}

function latest(dates: (string | null)[]): string | null {
  const valid = dates.map(isoDay).filter(Boolean).sort();
  return valid.length > 0 ? valid[valid.length - 1] : null;
}

/** Descending by date, blanks last, id as the stable tiebreak. */
function byDateDesc<T extends { id: string }>(get: (x: T) => string | null) {
  return (a: T, b: T): number => {
    const da = get(a) ?? '';
    const db = get(b) ?? '';
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? 1 : -1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/** Ascending by date, blanks last, id as the stable tiebreak. */
function byDateAsc<T extends { id: string }>(get: (x: T) => string | null) {
  return (a: T, b: T): number => {
    const da = get(a) ?? '';
    const db = get(b) ?? '';
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs.filter(Boolean)));
}

const DONE_STATUSES = new Set(['completed', 'closed']);

// ─────────────────────────────────────────────────────────────────────
// Builder
// ─────────────────────────────────────────────────────────────────────

export function buildConsumerPassport(input: BuildConsumerPassportInput): ConsumerPassport {
  const nowMs = input.nowMs;
  const expiringWithin = input.expiringWithinDays ?? DEFAULT_EXPIRING_WITHIN_DAYS;
  const dueSoonWithin = input.dueSoonWithinDays ?? DEFAULT_DUE_SOON_WITHIN_DAYS;

  const jobs = (input.projects ?? []).filter((p) => clean(p.id).length > 0);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const known = (projectId: string | undefined): boolean => !!projectId && jobById.has(projectId);
  const nameOf = (projectId: string): string => clean(jobById.get(projectId)?.name) || 'Project';

  // ── Home identity ──────────────────────────────────────────────────
  const explicitAddress = clean(input.home?.address);
  let address = explicitAddress;
  if (!address) {
    // Most-frequent project location wins; ties fall to input order.
    const tally = new Map<string, { label: string; n: number; first: number }>();
    jobs.forEach((j, i) => {
      const label = clean(j.location);
      if (!label) return;
      const key = normalizeAddress(label);
      const prev = tally.get(key);
      if (prev) prev.n += 1;
      else tally.set(key, { label, n: 1, first: i });
    });
    const best = Array.from(tally.values()).sort((a, b) => (b.n - a.n) || (a.first - b.first))[0];
    address = best ? best.label : '';
  }
  const addressKey = normalizeAddress(address);

  // ── Cross-job collections, filtered to the known jobs ───────────────
  const warrantiesIn = (input.warranties ?? []).filter((w) => known(w.projectId));
  const permitsIn = (input.permits ?? []).filter((p) => known(p.projectId));
  const selectionsIn = (input.selections ?? []).filter((s) => known(s.projectId));
  const commitmentsIn = (input.commitments ?? []).filter(
    (c) => known(c.projectId) && c.status !== 'draft',
  );
  const photosIn = (input.photos ?? []).filter((p) => known(p.projectId) && isShared(p.portalState));
  const invoicesIn = (input.invoices ?? []).filter((i) => known(i.projectId));
  const docsIn = (input.documents ?? []).filter((d) => known(d.projectId));
  const maintenanceIn = (input.maintenance ?? []).filter((m) => known(m.projectId));

  // ── Warranties ─────────────────────────────────────────────────────
  const warranties: PassportWarranty[] = warrantiesIn.map((w) => {
    const endDate = isoDay(w.endDate) || null;
    const daysRemaining = daysFromNow(endDate, nowMs);
    let state: WarrantyState = 'unknown';
    if (daysRemaining !== null) {
      if (daysRemaining < 0) state = 'expired';
      else if (daysRemaining <= expiringWithin) state = 'expiring_soon';
      else state = 'active';
    }
    return {
      id: w.id,
      projectId: w.projectId,
      projectName: nameOf(w.projectId),
      title: clean(w.title) || 'Warranty',
      category: clean(w.category) || 'general',
      provider: clean(w.provider),
      startDate: isoDay(w.startDate) || null,
      endDate,
      durationMonths: Number.isFinite(w.durationMonths) ? w.durationMonths : 0,
      ...(clean(w.coverageDetails) ? { coverageDetails: clean(w.coverageDetails) } : {}),
      ...(clean(w.exclusions) ? { exclusions: clean(w.exclusions) } : {}),
      ...(clean(w.documentUri) ? { documentUri: clean(w.documentUri) } : {}),
      state,
      daysRemaining,
      // Claim COUNT only — WarrantyClaim.cost is internal and never emitted.
      claimCount: (w.claims ?? []).length,
    };
  }).sort(byDateAsc<PassportWarranty>((w) => w.endDate));

  // ── Permits ────────────────────────────────────────────────────────
  // Permit.fee is deliberately NOT carried: it is part of the contractor's
  // internal cost buildup. The owner's money lives in `receipts`.
  const permits: PassportPermit[] = permitsIn.map((p) => ({
    id: p.id,
    projectId: p.projectId,
    projectName: nameOf(p.projectId),
    type: clean(p.type) || 'other',
    permitNumber: clean(p.permitNumber) || null,
    jurisdiction: clean(p.jurisdiction),
    status: clean(p.status),
    appliedDate: isoDay(p.appliedDate) || null,
    approvedDate: isoDay(p.approvedDate) || null,
    expiresDate: isoDay(p.expiresDate) || null,
    inspectionDate: isoDay(p.inspectionDate) || null,
    ...(clean(p.phase) ? { phase: clean(p.phase) } : {}),
    ...(clean(p.attachmentUri) ? { documentUri: clean(p.attachmentUri) } : {}),
    isFinaled: p.status === 'inspection_passed',
    daysUntilExpiry: daysFromNow(p.expiresDate, nowMs),
  })).sort(byDateDesc<PassportPermit>((p) => p.approvedDate ?? p.appliedDate));

  // ── Equipment / appliances (model numbers the owner will need) ──────
  const warrantyMatch = (projectId: string, ...needles: string[]) => {
    const hay = needles.map((n) => clean(n).toLowerCase()).filter(Boolean);
    if (hay.length === 0) return undefined;
    return warranties.find((w) => {
      if (w.projectId !== projectId) return false;
      const title = w.title.toLowerCase();
      return hay.some((n) => n.length >= 3 && (title.includes(n) || n.includes(title)));
    });
  };

  const equipment: PassportEquipment[] = [];
  const claimedWarrantyIds = new Set<string>();

  for (const cat of selectionsIn) {
    const chosen = (cat.options ?? []).find((o) => o.isChosen);
    if (!chosen) continue;
    const name = clean(chosen.productName);
    const brand = clean(chosen.brand);
    const model = clean(chosen.sku);
    // A finish with no brand AND no model number is decor, not equipment —
    // the owner can't order a part for it, so it doesn't belong here.
    if (!brand && !model) continue;
    const w = warrantyMatch(cat.projectId, brand, name);
    if (w) claimedWarrantyIds.add(w.id);
    equipment.push({
      id: `equipment:selection:${cat.id}`,
      projectId: cat.projectId,
      projectName: nameOf(cat.projectId),
      name: name || clean(cat.category) || 'Installed product',
      category: clean(cat.category) || 'general',
      ...(brand ? { brand } : {}),
      ...(model ? { modelNumber: model } : {}),
      ...(clean(chosen.supplier) ? { supplier: clean(chosen.supplier) } : {}),
      ...(clean(cat.category) ? { location: clean(cat.category) } : {}),
      installedOn: isoDay(chosen.chosenAt) || isoDay(chosen.createdAt) || isoDay(cat.updatedAt) || null,
      ...(w ? { warrantyId: w.id } : {}),
      ...(w?.endDate ? { warrantyEndDate: w.endDate } : {}),
      source: 'selection',
    });
  }

  for (const w of warranties) {
    if (claimedWarrantyIds.has(w.id)) continue;
    if (!EQUIPMENT_WARRANTY_CATEGORIES.has(w.category)) continue;
    equipment.push({
      id: `equipment:warranty:${w.id}`,
      projectId: w.projectId,
      projectName: w.projectName,
      name: w.title,
      category: w.category,
      ...(w.provider ? { brand: w.provider } : {}),
      installedOn: w.startDate,
      warrantyId: w.id,
      ...(w.endDate ? { warrantyEndDate: w.endDate } : {}),
      source: 'warranty',
    });
  }
  equipment.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1
    : a.name.toLowerCase() > b.name.toLowerCase() ? 1
      : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ── Maintenance schedule ───────────────────────────────────────────
  const maintenance: PassportMaintenanceTask[] = [];
  for (const bundle of maintenanceIn) {
    for (const m of bundle.items ?? []) {
      const task = clean(m.task);
      if (!task) continue;
      const nextDueDate = isoDay(m.nextDate) || null;
      const daysUntilDue = daysFromNow(nextDueDate, nowMs);
      let state: MaintenanceState = 'unscheduled';
      if (daysUntilDue !== null) {
        if (daysUntilDue < 0) state = 'overdue';
        else if (daysUntilDue <= dueSoonWithin) state = 'due_soon';
        else state = 'scheduled';
      }
      maintenance.push({
        id: `maintenance:${bundle.projectId}:${m.id}`,
        projectId: bundle.projectId,
        projectName: nameOf(bundle.projectId),
        task,
        frequency: clean(m.frequency),
        ...(clean(m.notes) ? { notes: clean(m.notes) } : {}),
        nextDueDate,
        daysUntilDue,
        state,
      });
    }
  }
  maintenance.sort(byDateAsc<PassportMaintenanceTask>((m) => m.nextDueDate));

  // ── Contractors: the GC per job + every non-draft trade / supplier ───
  const contractorMap = new Map<string, PassportContractor>();
  const touch = (
    key: string,
    seed: Omit<PassportContractor, 'projectIds' | 'projectNames' | 'scopes' | 'firstWorkedOn' | 'lastWorkedOn'>,
  ): PassportContractor => {
    const existing = contractorMap.get(key);
    if (existing) return existing;
    const created: PassportContractor = {
      ...seed,
      projectIds: [],
      projectNames: [],
      scopes: [],
      firstWorkedOn: null,
      lastWorkedOn: null,
    };
    contractorMap.set(key, created);
    return created;
  };

  for (const j of jobs) {
    const gc = j.contractor;
    if (!gc || !clean(gc.companyName)) continue;
    const key = `gc:${clean(gc.id) || slug(gc.companyName)}`;
    const rec = touch(key, {
      id: `contractor:${key}`,
      companyName: clean(gc.companyName),
      role: 'general_contractor',
      ...(clean(gc.contactName) ? { contactName: clean(gc.contactName) } : {}),
      ...(clean(gc.phone) ? { phone: clean(gc.phone) } : {}),
      ...(clean(gc.email) ? { email: clean(gc.email) } : {}),
      ...(clean(gc.licenseNumber) ? { licenseNumber: clean(gc.licenseNumber) } : {}),
      ...(clean(gc.website) ? { website: clean(gc.website) } : {}),
    });
    rec.projectIds.push(j.id);
    rec.projectNames.push(clean(j.name) || 'Project');
    const started = isoDay(j.createdAt) || null;
    const done = isoDay(j.substantialCompletionDate) || isoDay(j.closedAt) || null;
    rec.firstWorkedOn = earliest([rec.firstWorkedOn, started, done]);
    rec.lastWorkedOn = latest([rec.lastWorkedOn, done, started]);
  }

  const subsById = new Map((input.subcontractors ?? []).map((s) => [s.id, s]));
  for (const c of commitmentsIn) {
    const sub = c.subcontractorId ? subsById.get(c.subcontractorId) : undefined;
    const company = clean(sub?.companyName) || clean(c.vendorName);
    if (!company) continue;
    const role: PassportContractorRole = c.type === 'purchase_order' ? 'supplier' : 'trade';
    const key = `${role}:${sub ? sub.id : slug(company)}`;
    const rec = touch(key, {
      id: `contractor:${key}`,
      companyName: company,
      role,
      ...(sub?.trade ? { trade: clean(String(sub.trade)) } : {}),
      ...(clean(sub?.contactName) ? { contactName: clean(sub?.contactName) } : {}),
      ...(clean(sub?.phone) ? { phone: clean(sub?.phone) } : {}),
      ...(clean(sub?.email) ? { email: clean(sub?.email) } : {}),
      ...(clean(sub?.licenseNumber) ? { licenseNumber: clean(sub?.licenseNumber) } : {}),
    });
    rec.projectIds.push(c.projectId);
    rec.projectNames.push(nameOf(c.projectId));
    // Scope text comes off an internal subcontract — scrub any dollar figure
    // the GC typed into it before it reaches the homeowner.
    const scope = stripMoney(c.description);
    if (scope) rec.scopes.push(scope);
    const when = isoDay(c.signedDate) || isoDay(c.createdAt) || null;
    rec.firstWorkedOn = earliest([rec.firstWorkedOn, when]);
    rec.lastWorkedOn = latest([rec.lastWorkedOn, when]);
  }

  const ROLE_RANK: Record<PassportContractorRole, number> = {
    general_contractor: 0, trade: 1, supplier: 2,
  };
  const contractors: PassportContractor[] = Array.from(contractorMap.values())
    .map((c) => ({
      ...c,
      projectIds: uniq(c.projectIds),
      projectNames: uniq(c.projectNames),
      scopes: uniq(c.scopes),
    }))
    .sort((a, b) => (ROLE_RANK[a.role] - ROLE_RANK[b.role])
      || (a.companyName.toLowerCase() < b.companyName.toLowerCase() ? -1
        : a.companyName.toLowerCase() > b.companyName.toLowerCase() ? 1 : 0)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // ── Documents: permits, warranty PDFs, photos, as-builts, contracts ──
  const documents: PassportDocument[] = [];
  for (const d of docsIn) {
    const title = clean(d.title) || 'Document';
    const looksAsBuilt = /as[-\s]?built|record drawing/i.test(title);
    const kind: PassportDocumentKind = looksAsBuilt ? 'as_built'
      : d.type === 'permit' ? 'permit'
        : d.type === 'contract' ? 'contract'
          : 'other';
    documents.push({
      id: `document:file:${d.id}`,
      projectId: d.projectId,
      projectName: nameOf(d.projectId),
      kind,
      title,
      date: isoDay(d.signedAt) || isoDay(d.createdAt) || null,
      ...(clean(d.fileUrl) ? { uri: clean(d.fileUrl) } : {}),
    });
  }
  for (const p of permits) {
    if (!p.documentUri) continue;
    documents.push({
      id: `document:permit:${p.id}`,
      projectId: p.projectId,
      projectName: p.projectName,
      kind: 'permit',
      title: `Permit ${p.permitNumber ?? p.type} — ${p.jurisdiction || 'jurisdiction'}`.trim(),
      date: p.approvedDate ?? p.appliedDate,
      uri: p.documentUri,
    });
  }
  for (const w of warranties) {
    if (!w.documentUri) continue;
    documents.push({
      id: `document:warranty:${w.id}`,
      projectId: w.projectId,
      projectName: w.projectName,
      kind: 'warranty',
      title: `Warranty — ${w.title}`,
      date: w.startDate,
      uri: w.documentUri,
    });
  }
  for (const ph of photosIn) {
    documents.push({
      id: `document:photo:${ph.id}`,
      projectId: ph.projectId,
      projectName: nameOf(ph.projectId),
      kind: 'photo',
      title: clean(ph.tag) || clean(ph.location) || 'Site photo',
      date: isoDay(ph.timestamp) || isoDay(ph.createdAt) || null,
      ...(clean(ph.uri) ? { uri: clean(ph.uri) } : {}),
    });
  }
  documents.sort(byDateDesc<PassportDocument>((d) => d.date));

  // ── Receipts: the owner's OWN invoices ──────────────────────────────
  const receipts: PassportReceipt[] = invoicesIn.map((inv) => {
    const billed = Number.isFinite(inv.totalDue) ? inv.totalDue : 0;
    const paid = Number.isFinite(inv.amountPaid) ? inv.amountPaid : 0;
    return {
      id: `receipt:${inv.id}`,
      projectId: inv.projectId,
      projectName: nameOf(inv.projectId),
      label: `Invoice #${inv.number ?? ''}`.trim(),
      issueDate: isoDay(inv.issueDate) || null,
      amountBilled: billed,
      amountPaid: paid,
      paidInFull: billed > 0 && paid >= billed,
      payments: (inv.payments ?? []).map((p) => ({
        date: isoDay(p.date),
        amountPaid: Number.isFinite(p.amount) ? p.amount : 0,
        method: clean(p.method),
      })),
    };
  }).sort(byDateDesc<PassportReceipt>((r) => r.issueDate));

  // ── Projects ───────────────────────────────────────────────────────
  const countBy = <T,>(xs: T[], projectId: string, get: (x: T) => string) =>
    xs.filter((x) => get(x) === projectId).length;

  const projects: PassportProject[] = jobs.map((j) => {
    const mine = receipts.filter((r) => r.projectId === j.id);
    const completedOn = isoDay(j.substantialCompletionDate) || isoDay(j.closedAt) || null;
    const done = DONE_STATUSES.has(clean(j.status)) || completedOn !== null;
    return {
      id: j.id,
      name: clean(j.name) || 'Project',
      type: clean(j.type) || 'project',
      address: clean(j.location) || address,
      state: done ? ('completed' as const) : ('in_progress' as const),
      startedOn: isoDay(j.createdAt) || null,
      completedOn,
      contractorId: j.contractor && clean(j.contractor.companyName)
        ? `contractor:gc:${clean(j.contractor.id) || slug(j.contractor.companyName)}`
        : null,
      contractorName: clean(j.contractor?.companyName) || null,
      amountBilled: mine.reduce((s, r) => s + r.amountBilled, 0),
      amountPaid: mine.reduce((s, r) => s + r.amountPaid, 0),
      warrantyCount: countBy(warranties, j.id, (w) => w.projectId),
      permitCount: countBy(permits, j.id, (p) => p.projectId),
      photoCount: documents.filter((d) => d.projectId === j.id && d.kind === 'photo').length,
      documentCount: documents.filter((d) => d.projectId === j.id && d.kind !== 'photo').length,
    };
  }).sort(byDateDesc<PassportProject>((p) => p.completedOn ?? p.startedOn));

  // ── Alerts: what the owner should act on, as of nowMs ───────────────
  const alerts: PassportAlert[] = [];
  for (const w of warranties) {
    if (w.state !== 'expiring_soon' || w.daysRemaining === null) continue;
    alerts.push({
      id: `alert:warranty:${w.id}`,
      kind: 'warranty_expiring',
      severity: w.daysRemaining <= URGENT_WITHIN_DAYS ? 'high' : 'medium',
      title: `${w.title} warranty ends soon`,
      detail: w.provider
        ? `Covered by ${w.provider}. Report any issue before coverage ends.`
        : 'Report any issue before coverage ends.',
      dueDate: w.endDate,
      daysOut: w.daysRemaining,
      projectId: w.projectId,
    });
  }
  for (const m of maintenance) {
    if (m.state !== 'overdue' && m.state !== 'due_soon') continue;
    alerts.push({
      id: `alert:maintenance:${m.id}`,
      kind: m.state === 'overdue' ? 'maintenance_overdue' : 'maintenance_due',
      severity: m.state === 'overdue' || (m.daysUntilDue ?? 0) <= URGENT_WITHIN_DAYS ? 'high' : 'medium',
      title: m.task,
      detail: m.frequency ? `${m.frequency} maintenance` : 'Routine maintenance',
      dueDate: m.nextDueDate,
      daysOut: m.daysUntilDue,
      projectId: m.projectId,
    });
  }
  for (const p of permits) {
    if (p.isFinaled || p.daysUntilExpiry === null) continue;
    if (p.daysUntilExpiry < 0 || p.daysUntilExpiry > expiringWithin) continue;
    alerts.push({
      id: `alert:permit:${p.id}`,
      kind: 'permit_expiring',
      severity: p.daysUntilExpiry <= URGENT_WITHIN_DAYS ? 'high' : 'medium',
      title: `${p.type} permit expires`,
      detail: p.jurisdiction ? `Issued by ${p.jurisdiction}. Not yet finaled.` : 'Not yet finaled.',
      dueDate: p.expiresDate,
      daysOut: p.daysUntilExpiry,
      projectId: p.projectId,
    });
  }
  alerts.sort((a, b) => {
    const da = a.daysOut ?? Number.MAX_SAFE_INTEGER;
    const db = b.daysOut ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // ── Stats ──────────────────────────────────────────────────────────
  const stats: PassportStats = {
    projectCount: projects.length,
    completedProjectCount: projects.filter((p) => p.state === 'completed').length,
    contractorCount: contractors.length,
    activeWarranties: warranties.filter((w) => w.state === 'active').length,
    expiringWarranties: warranties.filter((w) => w.state === 'expiring_soon').length,
    expiredWarranties: warranties.filter((w) => w.state === 'expired').length,
    permitCount: permits.length,
    finaledPermits: permits.filter((p) => p.isFinaled).length,
    equipmentCount: equipment.length,
    documentCount: documents.filter((d) => d.kind !== 'photo').length,
    photoCount: documents.filter((d) => d.kind === 'photo').length,
    maintenanceOverdue: maintenance.filter((m) => m.state === 'overdue').length,
    maintenanceDueSoon: maintenance.filter((m) => m.state === 'due_soon').length,
    totalPaid: receipts.reduce((s, r) => s + r.amountPaid, 0),
  };

  const home: PassportHome = {
    homeId: `home:${addressKey ? slug(addressKey) : 'unknown'}`,
    address,
    addressKey,
    ...(clean(input.home?.city) ? { city: clean(input.home?.city) } : {}),
    ...(clean(input.home?.state) ? { state: clean(input.home?.state) } : {}),
    ...(clean(input.home?.postalCode) ? { postalCode: clean(input.home?.postalCode) } : {}),
    ...(input.home?.squareFootage
      ? { squareFootage: input.home.squareFootage }
      : (() => {
        const sf = jobs.map((j) => j.squareFootage ?? 0).filter((n) => n > 0);
        return sf.length > 0 ? { squareFootage: Math.max(...sf) } : {};
      })()),
    onRecordSince: earliest(projects.map((p) => p.startedOn ?? p.completedOn)),
    projectCount: projects.length,
  };

  return {
    home,
    projects,
    warranties,
    permits,
    equipment,
    maintenance,
    contractors,
    documents,
    receipts,
    alerts,
    stats,
    generatedAtMs: nowMs,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Handoff — the strategic payload
// ─────────────────────────────────────────────────────────────────────

/**
 * A plain-text brief the homeowner hands to their NEXT contractor: what's in
 * the house, who touched it, what's still under warranty, what's due. This is
 * the wedge — the next GC reads it and asks where it came from.
 *
 * Pure and money-safe by construction: it only reads ConsumerPassport, which
 * already excludes every cost/markup/margin field.
 */
export function buildPassportHandoff(p: ConsumerPassport, maxItemsPerSection = 8): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push(`HOME PASSPORT — ${p.home.address || 'this home'}`);
  if (p.home.onRecordSince) push(`On record since ${p.home.onRecordSince}.`);
  push(`${p.stats.completedProjectCount} completed project(s), ${p.stats.contractorCount} contractor(s) on file.`);

  if (p.projects.length > 0) {
    push('');
    push('WORK HISTORY');
    for (const j of p.projects.slice(0, maxItemsPerSection)) {
      const when = j.completedOn ? `completed ${j.completedOn}` : 'in progress';
      push(`- ${j.name} (${j.type}), ${when}${j.contractorName ? ` — ${j.contractorName}` : ''}`);
    }
  }

  const live = p.warranties.filter((w) => w.state === 'active' || w.state === 'expiring_soon');
  if (live.length > 0) {
    push('');
    push('WARRANTIES STILL IN FORCE');
    for (const w of live.slice(0, maxItemsPerSection)) {
      push(`- ${w.title}${w.provider ? ` (${w.provider})` : ''} — ends ${w.endDate ?? 'unknown'}`);
    }
  }

  if (p.equipment.length > 0) {
    push('');
    push('INSTALLED EQUIPMENT');
    for (const e of p.equipment.slice(0, maxItemsPerSection)) {
      const bits = [e.brand, e.modelNumber ? `model ${e.modelNumber}` : ''].filter(Boolean).join(', ');
      push(`- ${e.name}${bits ? ` — ${bits}` : ''}`);
    }
  }

  const permitted = p.permits.filter((x) => x.isFinaled);
  if (permitted.length > 0) {
    push('');
    push('PERMITTED & FINALED');
    for (const x of permitted.slice(0, maxItemsPerSection)) {
      push(`- ${x.type}${x.permitNumber ? ` #${x.permitNumber}` : ''} — ${x.jurisdiction || 'jurisdiction on file'}`);
    }
  }

  if (p.alerts.length > 0) {
    push('');
    push('NEEDS ATTENTION');
    for (const a of p.alerts.slice(0, maxItemsPerSection)) {
      push(`- ${a.title}${a.dueDate ? ` — ${a.dueDate}` : ''}`);
    }
  }

  push('');
  push('This record belongs to the homeowner and travels with the home.');
  return lines.join('\n');
}

export default buildConsumerPassport;
