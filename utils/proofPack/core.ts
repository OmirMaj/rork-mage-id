// utils/proofPack/core.ts — the Proof Of Work Package, as data (Big Bets, Bet 3, Phase 1).
//
// Given a project, ONE pay document (a saved AIA-style pay application or an
// invoice) and the job's records already on the device, this computes
// everything the package prints: the pay document's own figures, the pay
// period, every record the app holds for that period, HOW STRONG each record
// is, how records attach to schedule of values lines, what the contractor left
// out, and the list of things a reader would ask about that the app does not
// hold.
//
// PURE. No storage, no network, no React, no clock, no model: the caller
// injects `generatedAt`, and the same input always gives a deep-equal package.
// The input is never mutated (scripts/validate-proof-pack.ts deep-freezes it).
// utils/proofPack/html.ts prints the package; utils/proofPack/share.ts and
// utils/proofPack/store.ts do the I/O.
//
// ── THE FIVE STRENGTH CLASSES, one sentence each ────────────────────────────
// Each rule is about HOW THE RECORD IS KEPT, never about whether the work was
// done. The proof for each is a file in this repo, named beside the rule.
//
//   sealed    The server set the time, stored a fingerprint of the record, and
//             the database refuses every later change.
//             (punch_seals: supabase/migrations/20261002150000_punch_seals.sql,
//             supabase/functions/seal-punch/index.ts)
//   signed    A named person signed, the server set the signing time, and the
//             database keeps the signature as it was signed.
//             (a change order with a signature ROW on the server,
//             change_order_approvals: created_at is the server's now() and
//             the row is frozen by 20260902140000; lien waiver signed on the
//             sub's signing page: 20260908120200 + 20260923130000)
//
//             WHY THE ROW AND NOT THE CHANGE ORDER'S OWN HISTORY. The audit
//             entry 'client_signed_via_portal' is written by TWO paths: the
//             portal's server function (server clock, server hash) and the
//             in-app client view on the contractor's own device
//             (app/client-view.tsx: the DEVICE clock, a device-computed hash),
//             and the contractor's account can write that history. So the
//             history alone never makes a change order `signed`: the caller
//             reads the server rows (utils/proofPack/store
//             readCoSignatureRecords) and the time printed is the row's. A
//             change order whose history says "signed" with no row read is
//             `recorded`, and says why. Nothing here checks WHO held the
//             device: the package says so as an open item.
//   locked    The database refuses changes to the record's content after a set
//             point, but no server-timed signature and no fingerprint is kept.
//             (pay application once a pay link exists: 20260728120000; signed
//             field ticket: 20260923170000_rls_hardening.sql aa_field_tickets_seal)
//   recorded  Saved in the app with a time from the phone's clock; the account
//             that made it can change it later and no history of changes is kept.
//             (daily reports, photos, unsealed punch items, a pay application
//             or invoice with no pay link, a portal approval with no signature)
//   stated    Typed in by the contractor, with nothing else behind it.
//             (a change order the contractor marked approved, a paper lien
//             waiver the contractor recorded, an inspection result typed on a
//             permit, weather typed into a daily report)
//
// THE PHOTO RULE: a photo's time is the phone's clock at the moment it was
// added (app/daily-report.tsx; a library pick gets the time it was PICKED, not
// taken; EXIF is never read) and its place, when it has one, is the phone's
// GPS at capture (utils/photoGeoStamp.ts). The server keeps no time of its own
// for a photo and no fingerprint of the file. So a photo is NEVER above
// `recorded`, whatever else is true of it (photoStrength has no other answer).
//
// PEOPLE: no worker's name, phone, ID or pay rate enters the package. A daily
// report gives trades and head counts (ManpowerEntry has no names; the company
// column is dropped because a one-person company is a person's name). A field
// ticket gives a count of workers and their total hours, never the rows. A
// signature record keeps its signer's NAME (a signature with no name is not a
// record) and never an email, a phone, an IP address or a browser string.
// Incident records and incident photos never enter. The AI-written homeowner
// summary of a daily report never enters; only the words the contractor filed.
//
// MONEY crosses into the package as integer cents only.
import type {
  ChangeOrder,
  DailyFieldReport,
  FieldTicket,
  Invoice,
  LienWaiver,
  Permit,
  Project,
  ProjectPhoto,
  PunchItem,
  PunchSeal,
  SavedAIAPayApp,
} from '@/types';
import { applicationFromSavedRecord, g703Footer } from '@/utils/aiaBilling';
import { coApprovalLine } from '@/utils/coApproval';
import { addCalendarDays, calendarDayOf, parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';

export const PROOF_PACK_VERSION = 1;

// ── Strength ────────────────────────────────────────────────────────────────

export type ProofStrength = 'sealed' | 'signed' | 'locked' | 'recorded' | 'stated';

/** Strongest first. The order the summary counts print in. */
export const PROOF_STRENGTHS: readonly ProofStrength[] = ['sealed', 'signed', 'locked', 'recorded', 'stated'];

/** 4 = sealed … 0 = stated. Only for "never above" comparisons. */
export function strengthRank(s: ProofStrength): number {
  return PROOF_STRENGTHS.length - 1 - PROOF_STRENGTHS.indexOf(s);
}

/** Why an item got its class: the code the document turns into one sentence. */
export type ProofReason =
  | 'punch_seal_record' | 'punch_item_in_seal'
  | 'co_client_signed' | 'waiver_sub_signed'
  | 'pay_app_pay_link' | 'invoice_pay_link' | 'field_ticket_signed'
  | 'pay_app_saved' | 'invoice_saved' | 'daily_report' | 'photo_phone' | 'punch_item_open'
  | 'co_portal_no_signature' | 'co_signed_not_confirmed'
  | 'co_marked_approved' | 'waiver_paper' | 'waiver_received' | 'inspection_typed';

export const PROOF_REASON_STRENGTH: Record<ProofReason, ProofStrength> = {
  punch_seal_record: 'sealed',
  punch_item_in_seal: 'sealed',
  co_client_signed: 'signed',
  waiver_sub_signed: 'signed',
  pay_app_pay_link: 'locked',
  invoice_pay_link: 'recorded',
  field_ticket_signed: 'locked',
  pay_app_saved: 'recorded',
  invoice_saved: 'recorded',
  daily_report: 'recorded',
  photo_phone: 'recorded',
  punch_item_open: 'recorded',
  co_portal_no_signature: 'recorded',
  co_signed_not_confirmed: 'recorded',
  co_marked_approved: 'stated',
  waiver_paper: 'stated',
  waiver_received: 'stated',
  inspection_typed: 'stated',
};

// ── Classifiers (one per record type; each is the whole rule) ────────────────

/** A photo is never above `recorded`: its time and place come from the phone. */
export function photoStrength(): { strength: ProofStrength; reason: ProofReason } {
  return { strength: 'recorded', reason: 'photo_phone' };
}

export type PhotoPlaceSource = 'phone_gps' | 'typed' | 'none';

/** Where a photo's place came from: the phone's GPS, a typed label, or nowhere. */
export function photoPlaceSource(p: { latitude?: number; longitude?: number; location?: string; locationLabel?: string }): PhotoPlaceSource {
  if (typeof p.latitude === 'number' && Number.isFinite(p.latitude)
    && typeof p.longitude === 'number' && Number.isFinite(p.longitude)) return 'phone_gps';
  if ((p.location ?? '').trim() || (p.locationLabel ?? '').trim()) return 'typed';
  return 'none';
}

/** A daily report is `recorded`, sent or not: the lock on a sent report is in the app only. */
export function dailyReportStrength(): { strength: ProofStrength; reason: ProofReason } {
  return { strength: 'recorded', reason: 'daily_report' };
}

/** One signature row from the server (change_order_approvals), reduced to what the package may carry. */
export interface ProofCoSignatureRecord {
  changeOrderId: string;
  decision: 'approved' | 'declined';
  signerName: string;
  /** created_at: the server's now() when the row was written. */
  serverCreatedAt: string;
  /** SHA-256 of the signed consent record, as stored. '' when none. */
  documentHash: string;
  /** True when the row carries a drawn signature. */
  hasSignature: boolean;
}

/** The newest approved row that carries a signature and a record fingerprint, or null. */
export function signatureRecordFor(
  coId: string,
  records: readonly ProofCoSignatureRecord[] | null | undefined,
): ProofCoSignatureRecord | null {
  let best: ProofCoSignatureRecord | null = null;
  for (const r of records ?? []) {
    if (!r || r.changeOrderId !== coId || r.decision !== 'approved' || !r.hasSignature) continue;
    if (!/^[0-9a-f]{64}$/i.test(r.documentHash ?? '') || !r.serverCreatedAt) continue;
    if (!best || r.serverCreatedAt > best.serverCreatedAt) best = r;
  }
  return best;
}

/**
 * A change order is `signed` only when a signature ROW for it was read from
 * the server. Its own history saying "signed" is not enough (see the header).
 */
export function changeOrderStrength(
  co: Pick<ChangeOrder, 'id' | 'status' | 'auditTrail' | 'approvers'>,
  records: readonly ProofCoSignatureRecord[] | null | undefined,
): { strength: ProofStrength; reason: ProofReason } | null {
  const line = coApprovalLine(co);
  if (!line) return null;
  if (signatureRecordFor(co.id, records)) return { strength: 'signed', reason: 'co_client_signed' };
  if (line.kind === 'client_signed') return { strength: 'recorded', reason: 'co_signed_not_confirmed' };
  if (line.kind === 'client_portal') return { strength: 'recorded', reason: 'co_portal_no_signature' };
  return { strength: 'stated', reason: 'co_marked_approved' };
}

/**
 * A lien waiver is `signed` only when the SUB signed it on the signing page
 * (role 'sub' is written by nothing else: types ContractSignature). A waiver
 * the contractor recorded from paper, or marked received, is `stated`.
 * Requested and voided waivers are not evidence and return null.
 */
export function lienWaiverStrength(
  w: Pick<LienWaiver, 'status' | 'subSignature' | 'signedAt'>,
): { strength: ProofStrength; reason: ProofReason } | null {
  if (w.status === 'signed') {
    if (w.subSignature?.role === 'sub' && !!w.signedAt) return { strength: 'signed', reason: 'waiver_sub_signed' };
    return { strength: 'stated', reason: 'waiver_paper' };
  }
  if (w.status === 'received') return { strength: 'stated', reason: 'waiver_received' };
  return null;
}

/** A punch item is `sealed` only when a seal on file lists it; otherwise `recorded`. */
export function punchItemStrength(
  item: Pick<PunchItem, 'id' | 'sealId'>,
  seal: Pick<PunchSeal, 'id' | 'manifest'> | null | undefined,
): { strength: ProofStrength; reason: ProofReason } {
  const listed = !!seal && Array.isArray(seal.manifest?.items) && seal.manifest.items.some((i) => i?.id === item.id);
  if (listed && (!item.sealId || item.sealId === seal!.id)) return { strength: 'sealed', reason: 'punch_item_in_seal' };
  return { strength: 'recorded', reason: 'punch_item_open' };
}

/** The pay application is `locked` once a pay link exists or it is paid; otherwise `recorded`. */
export function payAppStrength(
  rec: Pick<SavedAIAPayApp, 'payLinkUrl' | 'payLinkId' | 'paidAt'>,
): { strength: ProofStrength; reason: ProofReason } {
  if (rec.payLinkUrl || rec.payLinkId || rec.paidAt) return { strength: 'locked', reason: 'pay_app_pay_link' };
  return { strength: 'recorded', reason: 'pay_app_saved' };
}

/** An invoice is always `recorded`: no migration locks an invoice's content. */
export function invoiceStrength(
  inv: Pick<Invoice, 'payLinkUrl' | 'payLinkId'>,
): { strength: ProofStrength; reason: ProofReason } {
  if (inv.payLinkUrl || inv.payLinkId) return { strength: 'recorded', reason: 'invoice_pay_link' };
  return { strength: 'recorded', reason: 'invoice_saved' };
}

/** A signed (or converted) field ticket is `locked`. Drafts and voids are not evidence. */
export function fieldTicketStrength(
  t: Pick<FieldTicket, 'status' | 'authorization'>,
): { strength: ProofStrength; reason: ProofReason } | null {
  if ((t.status === 'signed' || t.status === 'converted') && t.authorization) {
    return { strength: 'locked', reason: 'field_ticket_signed' };
  }
  return null;
}

// ── Money and days ──────────────────────────────────────────────────────────

/** Dollars to whole cents, half away from zero. Non-finite reads as 0. */
export function proofCents(n: number | null | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  const c = Math.round(Math.abs(n) * 100 + 1e-7);
  return n < 0 ? -c : c;
}

function dayOf(v: string | null | undefined): string | null {
  return calendarDayOf(v ?? null);
}

function nextDay(day: string): string | null {
  const d = parseCalendarDay(day);
  return d ? toCalendarDayString(addCalendarDays(d, 1)) : null;
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = parseCalendarDay(from);
  const b = parseCalendarDay(to);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
}

// ── The pay period ──────────────────────────────────────────────────────────

export type ProofPayRef = { kind: 'pay_app'; id: string } | { kind: 'invoice'; id: string };

/** How the period's first day was found. */
export type ProofPeriodStartSource =
  | 'pay_app_period_from'      // the pay application's own "period from"
  | 'day_after_prior_pay_app'  // the day after the prior application's "period to"
  | 'day_after_prior_invoice'  // the day after the prior invoice's date
  | 'open';                    // nothing earlier on file: the period has no first day

export interface ProofPeriod {
  /** Calendar day, or null when the period has no first day on file. */
  from: string | null;
  to: string;
  startSource: ProofPeriodStartSource;
  /** 'pay_app_period_to' or 'invoice_issue_date'. */
  endSource: 'pay_app_period_to' | 'invoice_issue_date';
}

export function payAppPeriod(rec: SavedAIAPayApp, allForProject: readonly SavedAIAPayApp[]): ProofPeriod | null {
  const to = dayOf(rec.periodTo);
  if (!to) return null;
  const own = dayOf(rec.periodFrom);
  if (own && own <= to) return { from: own, to, startSource: 'pay_app_period_from', endSource: 'pay_app_period_to' };
  let prior: string | null = null;
  for (const a of allForProject) {
    if (!a || a.id === rec.id || a.projectId !== rec.projectId) continue;
    if (!(a.applicationNumber < rec.applicationNumber)) continue;
    const d = dayOf(a.periodTo);
    if (d && d < to && (!prior || d > prior)) prior = d;
  }
  const from = prior ? nextDay(prior) : null;
  if (from) return { from, to, startSource: 'day_after_prior_pay_app', endSource: 'pay_app_period_to' };
  return { from: null, to, startSource: 'open', endSource: 'pay_app_period_to' };
}

export function invoicePeriod(inv: Invoice, allForProject: readonly Invoice[]): ProofPeriod | null {
  const to = dayOf(inv.issueDate);
  if (!to) return null;
  let prior: string | null = null;
  for (const a of allForProject) {
    if (!a || a.id === inv.id || a.projectId !== inv.projectId) continue;
    const d = dayOf(a.issueDate);
    if (d && d < to && (!prior || d > prior)) prior = d;
  }
  const from = prior ? nextDay(prior) : null;
  if (from) return { from, to, startSource: 'day_after_prior_invoice', endSource: 'invoice_issue_date' };
  return { from: null, to, startSource: 'open', endSource: 'invoice_issue_date' };
}

export function inPeriod(day: string | null | undefined, period: ProofPeriod): boolean {
  if (!day) return false;
  if (day > period.to) return false;
  if (period.from && day < period.from) return false;
  return true;
}

// ── The package shape ───────────────────────────────────────────────────────

export type ProofItemKind =
  | 'daily_report' | 'photo' | 'change_order' | 'punch_seal' | 'punch_item'
  | 'inspection' | 'lien_waiver' | 'field_ticket';

export const PROOF_ITEM_KINDS: readonly ProofItemKind[] = [
  'daily_report', 'photo', 'change_order', 'punch_seal', 'punch_item', 'inspection', 'lien_waiver', 'field_ticket',
];

interface ProofItemBase {
  /** `${kind}:${id}`. What the review screen's switch names. */
  key: string;
  kind: ProofItemKind;
  id: string;
  strength: ProofStrength;
  reason: ProofReason;
  /** The calendar day the record belongs to, as the record states it. */
  day: string | null;
  /** Schedule task ids this record names. The only way a record reaches a schedule of values line. */
  taskIds: string[];
}

export interface ProofCrewRow { trade: string; headcount: number; hours: number }

export type ProofWeatherSource = 'openweather' | 'typed' | 'not_stated';

export interface ProofDailyReportItem extends ProofItemBase {
  kind: 'daily_report';
  status: 'draft' | 'sent';
  crew: ProofCrewRow[];
  totalHeadcount: number;
  totalHours: number;
  weather: { temperature: string; conditions: string; wind: string; source: ProofWeatherSource; readAt: string | null };
  workPerformed: string;
  issuesAndDelays: string;
  materialsDelivered: string[];
  /** Photos on the report that may print (incident photos are never counted in). */
  photoCount: number;
  /** created_at as the phone sent it. */
  firstSavedAt: string | null;
  /** updated_at. */
  lastChangedAt: string | null;
  /** True when the last change is on a later calendar day than the report's own day. */
  changedAfterItsDay: boolean;
}

export interface ProofPhotoItem extends ProofItemBase {
  kind: 'photo';
  from: 'gallery' | 'daily_report';
  /** The phone's clock when the photo was added. */
  takenAt: string | null;
  timeSource: 'phone_clock';
  placeSource: PhotoPlaceSource;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  placeLabel: string;
  taskName: string;
  /** True when a copy is in the project's storage; false means it is only on a phone. */
  uploaded: boolean;
  storagePath: string | null;
  dailyReportId: string | null;
}

export interface ProofChangeOrderItem extends ProofItemBase {
  kind: 'change_order';
  number: number;
  description: string;
  changeAmountCents: number;
  approval: 'client_signed' | 'client_portal' | 'approver' | 'manual';
  approvedBy: string;
  approvedDay: string | null;
  /** The server's time on the signature row, when one was read. */
  signedAtServer: string | null;
  /** The first characters of the signed record's SHA-256, from the server row. */
  recordHashPrefix: string;
}

export interface ProofPunchSealItem extends ProofItemBase {
  kind: 'punch_seal';
  sealedAt: string;
  itemCount: number;
  manifestHash: string;
  signerName: string;
  signerRole: string;
}

export interface ProofPunchItem extends ProofItemBase {
  kind: 'punch_item';
  description: string;
  location: string;
  status: string;
  createdDay: string | null;
  closedDay: string | null;
  hasAfterPhoto: boolean;
}

export interface ProofInspectionItem extends ProofItemBase {
  kind: 'inspection';
  name: string;
  result: string;
  permitType: string;
  recordedAt: string | null;
}

export interface ProofLienWaiverItem extends ProofItemBase {
  kind: 'lien_waiver';
  subName: string;
  waiverType: string;
  throughDay: string | null;
  paidAmountCents: number;
  status: string;
  signerName: string;
  signedAt: string | null;
}

export interface ProofFieldTicketItem extends ProofItemBase {
  kind: 'field_ticket';
  number: number;
  workDescription: string;
  status: string;
  signerName: string;
  signerRole: string;
  /** The phone's clock when the ticket was signed (app/field-ticket.tsx). */
  signedAt: string | null;
  workerCount: number;
  totalHours: number;
}

export type ProofItem =
  | ProofDailyReportItem | ProofPhotoItem | ProofChangeOrderItem | ProofPunchSealItem
  | ProofPunchItem | ProofInspectionItem | ProofLienWaiverItem | ProofFieldTicketItem;

/** How a schedule of values line reached its records, or why it could not. */
export type ProofLineLink =
  | 'by_task'          // the line names a schedule task; records naming the same task attach
  | 'by_change_order'  // the line's description starts "CO #n"; that change order attaches
  | 'no_task'          // the line names no schedule task, so nothing can attach
  | 'task_no_records'  // the line names a task, and no record in the period names it
  | 'not_linkable';    // an invoice line: invoices carry no task link at all

export interface ProofPayLine {
  id: string;
  itemNo: string;
  description: string;
  scheduledValueCents: number;
  thisPeriodCents: number;
  storedCents: number;
  link: ProofLineLink;
  /** Keys of the included items attached to this line. */
  itemKeys: string[];
}

export interface ProofPayAppBlock {
  kind: 'pay_app';
  id: string;
  applicationNumber: number;
  applicationDay: string | null;
  strength: ProofStrength;
  reason: ProofReason;
  /** aia_pay_apps.updated_at as the loader hydrated it (server clock), when present. */
  serverUpdatedAt: string | null;
  paidAt: string | null;
  // The saved record's own figures, in cents (SavedAIAPayApp.totals is the
  // snapshot taken at save time; nothing here is re-derived except the column E
  // total, which the record does not store and g703Footer adds up).
  originalContractSumCents: number;
  netChangeByCOCents: number;
  contractSumToDateCents: number;
  totalCompletedAndStoredCents: number;
  totalRetainageCents: number;
  totalEarnedLessRetainageCents: number;
  lessPreviousCertificatesCents: number;
  currentPaymentDueCents: number;
  balanceToFinishCents: number;
  workThisPeriodCents: number;
  storedMaterialCents: number;
  lines: ProofPayLine[];
}

export interface ProofInvoiceBlock {
  kind: 'invoice';
  id: string;
  number: number;
  issueDay: string | null;
  invoiceType: 'full' | 'progress';
  progressPercent: number | null;
  strength: ProofStrength;
  reason: ProofReason;
  subtotalCents: number;
  taxCents: number;
  totalDueCents: number;
  amountPaidCents: number;
  retentionCents: number;
  lines: ProofPayLine[];
}

export type ProofPayBlock = ProofPayAppBlock | ProofInvoiceBlock;

export type ProofOpenItemCode =
  | 'period_start_open' | 'invoice_has_no_period' | 'pay_not_locked'
  | 'lines_without_records' | 'days_without_report' | 'photos_without_place' | 'photos_not_uploaded'
  | 'reports_changed_later' | 'change_orders_not_signed' | 'no_change_orders'
  | 'no_lien_waivers' | 'waivers_requested_unsigned' | 'waiver_coverage_not_checked'
  | 'no_inspection_signoff' | 'photo_files_not_fingerprinted' | 'no_punch_seal' | 'signer_identity_not_checked'
  | 'source_not_loaded' | 'items_left_out';

export interface ProofOpenItem {
  code: ProofOpenItemCode;
  /** A count, when the sentence carries one. */
  n?: number;
  /** A second count ("N of M"). */
  of?: number;
  /** Which source, for source_not_loaded. */
  source?: ProofSourceName;
}

export type ProofSourceName = 'photos' | 'daily_reports' | 'lien_waivers' | 'punch_seal' | 'change_order_signatures';

export interface ProofWaiverGap {
  id: string;
  subName: string;
  waiverType: string;
  throughDay: string | null;
  requestedDay: string | null;
}

export interface ProofPack {
  version: number;
  /** The caller's clock (the phone). The server's time for the package is on the fingerprint record, not here. */
  generatedAt: string;
  project: { id: string; name: string; location: string };
  pay: ProofPayBlock;
  period: ProofPeriod;
  items: ProofItem[];
  /** Counts of INCLUDED items by strength. Every class is present, zero or not. */
  counts: Record<ProofStrength, number>;
  countsByKind: Record<ProofItemKind, number>;
  /** What the contractor switched off on the review screen. Counted, never listed. */
  leftOut: { total: number; byKind: Record<ProofItemKind, number> };
  /** Lien waivers asked for and not signed (through the period's last day). */
  waiverGaps: ProofWaiverGap[];
  openItems: ProofOpenItem[];
}

export interface ProofPackInput {
  project: Pick<Project, 'id' | 'name' | 'location'>;
  payRef: ProofPayRef;
  payApps: readonly SavedAIAPayApp[];
  invoices: readonly Invoice[];
  dailyReports: readonly DailyFieldReport[];
  dailyReportsLoaded: boolean;
  photos: readonly ProjectPhoto[];
  photosLoaded: boolean;
  changeOrders: readonly ChangeOrder[];
  /** Signature rows read from the server. undefined = not read (prints "not checked"). */
  coSignatures: readonly ProofCoSignatureRecord[] | undefined;
  punchItems: readonly PunchItem[];
  /** null = looked and none on file; undefined = not read (prints "not checked"). */
  punchSeal: PunchSeal | null | undefined;
  permits: readonly Permit[];
  /** undefined = not read (prints "not checked"). */
  lienWaivers: readonly LienWaiver[] | undefined;
  fieldTickets: readonly FieldTicket[];
  /** Item keys the contractor switched off. */
  leaveOut?: readonly string[];
  generatedAt: string;
}

export type ProofPackResult =
  | { ok: true; pack: ProofPack }
  | { ok: false; reason: 'pay_document_missing' | 'period_end_missing' };

const zeroByKind = (): Record<ProofItemKind, number> => ({
  daily_report: 0, photo: 0, change_order: 0, punch_seal: 0, punch_item: 0, inspection: 0, lien_waiver: 0, field_ticket: 0,
});
const zeroByStrength = (): Record<ProofStrength, number> => ({ sealed: 0, signed: 0, locked: 0, recorded: 0, stated: 0 });

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "CO #12 …" at the start of a schedule of values line (utils/aiaBilling.ts writes it that way). */
export function changeOrderNumberOfLine(description: string): number | null {
  const m = /^\s*CO\s*#\s*(\d+)\b/i.exec(description ?? '');
  return m ? Number(m[1]) : null;
}

// ── Collecting ──────────────────────────────────────────────────────────────

function collectItems(input: ProofPackInput, period: ProofPeriod): { items: ProofItem[]; waiverGaps: ProofWaiverGap[] } {
  const pid = input.project.id;
  const items: ProofItem[] = [];

  // Daily reports in the period.
  const reportDayOfPhoto = new Map<string, { day: string; reportId: string }>();
  for (const r of input.dailyReports) {
    if (!r || r.projectId !== pid) continue;
    const day = dayOf(r.date);
    if (!inPeriod(day, period)) continue;
    const s = dailyReportStrength();
    const crew: ProofCrewRow[] = (r.manpower ?? [])
      .map((m) => ({ trade: text(m?.trade), headcount: num(m?.headcount), hours: num(m?.hoursWorked) }))
      .filter((m) => m.trade || m.headcount > 0 || m.hours > 0);
    const printable = (r.photos ?? []).filter((p) => p && !p.incidentPhoto);
    for (const p of printable) reportDayOfPhoto.set(p.id, { day: day as string, reportId: r.id });
    const w = r.weather ?? ({} as DailyFieldReport['weather']);
    const weatherSource: ProofWeatherSource = w.source === 'openweather' && !w.isManual
      ? 'openweather'
      : (text(w.temperature) || text(w.conditions) || text(w.wind)) ? 'typed' : 'not_stated';
    const lastDay = dayOf(r.updatedAt);
    items.push({
      key: `daily_report:${r.id}`, kind: 'daily_report', id: r.id,
      strength: s.strength, reason: s.reason, day,
      taskIds: Array.from(new Set((r.workProgress ?? []).map((p) => text(p?.taskId)).filter(Boolean))).sort(),
      status: r.status === 'sent' ? 'sent' : 'draft',
      crew,
      totalHeadcount: crew.reduce((n, m) => n + m.headcount, 0),
      totalHours: crew.reduce((n, m) => n + m.hours * m.headcount, 0),
      weather: {
        temperature: text(w.temperature), conditions: text(w.conditions), wind: text(w.wind),
        source: weatherSource, readAt: weatherSource === 'openweather' ? (text(w.readAt) || null) : null,
      },
      workPerformed: text(r.workPerformed),
      issuesAndDelays: text(r.issuesAndDelays),
      materialsDelivered: (r.materialsDelivered ?? []).map(text).filter(Boolean),
      photoCount: printable.length,
      firstSavedAt: text(r.createdAt) || null,
      lastChangedAt: text(r.updatedAt) || null,
      changedAfterItsDay: !!day && !!lastDay && lastDay > day,
    });
  }

  // Photos: the gallery copy wins over the daily report's mirror of the same id.
  const seenPhoto = new Set<string>();
  for (const p of input.photos) {
    if (!p || p.projectId !== pid) continue;
    const day = dayOf(p.timestamp) ?? dayOf(p.createdAt);
    if (!inPeriod(day, period)) continue;
    seenPhoto.add(p.id);
    const s = photoStrength();
    const place = photoPlaceSource(p);
    items.push({
      key: `photo:${p.id}`, kind: 'photo', id: p.id, strength: s.strength, reason: s.reason, day,
      taskIds: text(p.linkedTaskId) ? [text(p.linkedTaskId)] : [],
      from: 'gallery',
      takenAt: text(p.timestamp) || text(p.createdAt) || null,
      timeSource: 'phone_clock',
      placeSource: place,
      latitude: place === 'phone_gps' ? finiteOrNull(p.latitude) : null,
      longitude: place === 'phone_gps' ? finiteOrNull(p.longitude) : null,
      accuracyMeters: place === 'phone_gps' ? finiteOrNull(p.locationAccuracyMeters) : null,
      placeLabel: text(p.locationLabel) || text(p.location),
      taskName: text(p.linkedTaskName),
      uploaded: !!text(p.storagePath),
      storagePath: text(p.storagePath) || null,
      dailyReportId: reportDayOfPhoto.get(p.id)?.reportId ?? null,
    });
  }
  for (const r of input.dailyReports) {
    if (!r || r.projectId !== pid) continue;
    for (const p of r.photos ?? []) {
      if (!p || p.incidentPhoto || seenPhoto.has(p.id)) continue;
      const at = reportDayOfPhoto.get(p.id);
      if (!at) continue; // its report is outside the period
      seenPhoto.add(p.id);
      const s = photoStrength();
      const place = photoPlaceSource(p);
      items.push({
        key: `photo:${p.id}`, kind: 'photo', id: p.id, strength: s.strength, reason: s.reason,
        day: dayOf(p.timestamp) ?? at.day, taskIds: [],
        from: 'daily_report',
        takenAt: text(p.timestamp) || null,
        timeSource: 'phone_clock',
        placeSource: place,
        latitude: place === 'phone_gps' ? finiteOrNull(p.latitude) : null,
        longitude: place === 'phone_gps' ? finiteOrNull(p.longitude) : null,
        accuracyMeters: place === 'phone_gps' ? finiteOrNull(p.locationAccuracyMeters) : null,
        placeLabel: text(p.locationLabel),
        taskName: '',
        uploaded: !!text(p.storagePath),
        storagePath: text(p.storagePath) || null,
        dailyReportId: at.reportId,
      });
    }
  }

  // Change orders approved on or before the period's last day.
  for (const co of input.changeOrders) {
    if (!co || co.projectId !== pid) continue;
    const s = changeOrderStrength(co, input.coSignatures);
    if (!s) continue;
    const line = coApprovalLine(co)!;
    const row = signatureRecordFor(co.id, input.coSignatures);
    const approvedDay = row ? dayOf(row.serverCreatedAt) : (line.day ?? null);
    const day = approvedDay ?? dayOf(co.date);
    if (!day || day > period.to) continue;
    items.push({
      key: `change_order:${co.id}`, kind: 'change_order', id: co.id, strength: s.strength, reason: s.reason, day,
      taskIds: Array.from(new Set([...(co.scheduleImpactTaskIds ?? []), co.scheduleAnchorTaskId ?? ''].map(text).filter(Boolean))).sort(),
      number: num(co.number),
      description: text(co.description),
      changeAmountCents: proofCents(co.changeAmount),
      approval: line.kind,
      approvedBy: row ? text(row.signerName) : (line.kind === 'client_signed' || line.kind === 'client_portal' ? text(line.who) : ''),
      approvedDay,
      signedAtServer: row ? row.serverCreatedAt : null,
      recordHashPrefix: row ? row.documentHash.toLowerCase().slice(0, 16) : '',
    });
  }

  // The sealed final punch, when it was sealed on or before the period's last day.
  const seal = input.punchSeal && input.punchSeal.projectId === pid ? input.punchSeal : null;
  const sealDay = seal ? dayOf(seal.sealedAt) : null;
  const sealCounts = !!seal && !!sealDay && sealDay <= period.to;
  if (seal && sealCounts) {
    items.push({
      key: `punch_seal:${seal.id}`, kind: 'punch_seal', id: seal.id,
      strength: 'sealed', reason: 'punch_seal_record', day: sealDay, taskIds: [],
      sealedAt: seal.sealedAt, itemCount: num(seal.itemCount), manifestHash: text(seal.manifestHash),
      signerName: text(seal.signerName), signerRole: text(seal.signerRole),
    });
  }

  // Punch items opened or closed in the period. The crew's own list and items
  // hidden from the client stay out (the sealed punch draws the same line).
  for (const it of input.punchItems) {
    if (!it || it.projectId !== pid) continue;
    if (it.listType === 'crew') continue;
    if (it.xray && it.xray.clientVisible === false) continue;
    const createdDay = dayOf(it.createdAt);
    const closedDay = dayOf(it.closedAt);
    if (!inPeriod(createdDay, period) && !inPeriod(closedDay, period)) continue;
    const s = punchItemStrength(it, sealCounts ? seal : null);
    items.push({
      key: `punch_item:${it.id}`, kind: 'punch_item', id: it.id, strength: s.strength, reason: s.reason,
      day: inPeriod(closedDay, period) ? closedDay : createdDay,
      taskIds: text(it.linkedTaskId) ? [text(it.linkedTaskId)] : [],
      description: text(it.description), location: text(it.location), status: text(it.status),
      createdDay, closedDay,
      hasAfterPhoto: !!(text(it.afterPhotoStoragePath) || text(it.afterPhotoUri)),
    });
  }

  // Inspection results typed on a permit, dated in the period.
  for (const permit of input.permits) {
    if (!permit || (permit as { projectId?: string }).projectId !== pid) continue;
    for (const insp of permit.inspections ?? []) {
      if (!insp || (insp.result !== 'passed' && insp.result !== 'failed')) continue;
      const day = dayOf(insp.scheduledFor) ?? dayOf(insp.recordedAt);
      if (!inPeriod(day, period)) continue;
      items.push({
        key: `inspection:${permit.id}:${insp.id}`, kind: 'inspection', id: `${permit.id}:${insp.id}`,
        strength: 'stated', reason: 'inspection_typed', day, taskIds: [],
        name: text(insp.name), result: insp.result, permitType: text(permit.type),
        recordedAt: text(insp.recordedAt) || null,
      });
    }
  }

  // Lien waivers whose through date is in the period; requested ones are gaps.
  const waiverGaps: ProofWaiverGap[] = [];
  for (const w of input.lienWaivers ?? []) {
    if (!w || w.projectId !== pid || w.status === 'voided') continue;
    const throughDay = dayOf(w.throughDate);
    if (w.status === 'requested') {
      if (throughDay && throughDay > period.to) continue;
      waiverGaps.push({
        id: w.id, subName: text(w.subName), waiverType: text(w.waiverType), throughDay,
        requestedDay: dayOf(w.signRequestedAt) ?? dayOf(w.createdAt),
      });
      continue;
    }
    const s = lienWaiverStrength(w);
    if (!s) continue;
    const linkedToThisInvoice = input.payRef.kind === 'invoice' && w.invoiceId === input.payRef.id;
    if (!inPeriod(throughDay, period) && !linkedToThisInvoice) continue;
    items.push({
      key: `lien_waiver:${w.id}`, kind: 'lien_waiver', id: w.id, strength: s.strength, reason: s.reason,
      day: throughDay, taskIds: [],
      subName: text(w.subName), waiverType: text(w.waiverType), throughDay,
      paidAmountCents: proofCents(w.paidAmount), status: text(w.status),
      signerName: text(w.subSignature?.name),
      signedAt: text(w.signedAt) || text(w.subSignature?.signedAt) || null,
    });
  }
  waiverGaps.sort((a, b) => a.id.localeCompare(b.id));

  // Signed field tickets dated in the period: counts and hours, never the rows.
  for (const t of input.fieldTickets) {
    if (!t || t.projectId !== pid) continue;
    const s = fieldTicketStrength(t);
    if (!s) continue;
    const day = dayOf(t.date);
    if (!inPeriod(day, period)) continue;
    const labor = t.labor ?? [];
    items.push({
      key: `field_ticket:${t.id}`, kind: 'field_ticket', id: t.id, strength: s.strength, reason: s.reason, day,
      taskIds: [],
      number: num(t.number), workDescription: text(t.workDescription), status: text(t.status),
      signerName: text(t.authorization?.name), signerRole: text(t.authorization?.role),
      signedAt: text(t.authorization?.signedAt) || null,
      workerCount: labor.length,
      totalHours: labor.reduce((n, row) => n + num(row?.hours), 0),
    });
  }

  // One stable order: by kind (PROOF_ITEM_KINDS), then day, then key.
  const kindAt = (k: ProofItemKind) => PROOF_ITEM_KINDS.indexOf(k);
  items.sort((a, b) => kindAt(a.kind) - kindAt(b.kind)
    || String(a.day ?? '').localeCompare(String(b.day ?? ''))
    || a.key.localeCompare(b.key));
  return { items, waiverGaps };
}

function linkLines(lines: ProofPayLine[], items: readonly ProofItem[], taskOf: Map<string, string>): void {
  for (const line of lines) {
    if (line.link === 'not_linkable') continue;
    const coNumber = changeOrderNumberOfLine(line.description);
    if (coNumber !== null) {
      const co = items.find((i) => i.kind === 'change_order' && i.number === coNumber);
      if (co) { line.link = 'by_change_order'; line.itemKeys = [co.key]; continue; }
    }
    const taskId = taskOf.get(line.id);
    if (!taskId) { line.link = 'no_task'; continue; }
    const keys = items
      .filter((i) => i.kind !== 'change_order' && i.kind !== 'punch_seal' && i.taskIds.includes(taskId))
      .map((i) => i.key);
    line.itemKeys = keys;
    line.link = keys.length > 0 ? 'by_task' : 'task_no_records';
  }
}

/**
 * Builds the package. Returns `ok: false` when the pay document is not on file
 * or carries no end date; nothing is guessed in either case.
 */
export function buildProofPack(input: ProofPackInput): ProofPackResult {
  const pid = input.project.id;
  let pay: ProofPayBlock;
  let period: ProofPeriod | null;
  const taskOf = new Map<string, string>();

  if (input.payRef.kind === 'pay_app') {
    const rec = input.payApps.find((a) => a && a.id === input.payRef.id && a.projectId === pid);
    if (!rec) return { ok: false, reason: 'pay_document_missing' };
    period = payAppPeriod(rec, input.payApps);
    if (!period) return { ok: false, reason: 'period_end_missing' };
    const s = payAppStrength(rec);
    const footer = g703Footer(applicationFromSavedRecord(rec));
    const t = rec.totals ?? ({} as SavedAIAPayApp['totals']);
    for (const l of rec.lines ?? []) if (text(l.linkedTaskId)) taskOf.set(l.id, text(l.linkedTaskId));
    pay = {
      kind: 'pay_app', id: rec.id,
      applicationNumber: num(rec.applicationNumber),
      applicationDay: dayOf(rec.applicationDate),
      strength: s.strength, reason: s.reason,
      serverUpdatedAt: text(rec.updatedAt) || null,
      paidAt: text(rec.paidAt) || null,
      originalContractSumCents: proofCents(rec.originalContractSum),
      netChangeByCOCents: proofCents(rec.netChangeByCO),
      contractSumToDateCents: proofCents(rec.contractSumToDate),
      totalCompletedAndStoredCents: proofCents(t.totalCompletedAndStored),
      totalRetainageCents: proofCents(t.totalRetainage),
      totalEarnedLessRetainageCents: proofCents(t.totalEarnedLessRetainage),
      lessPreviousCertificatesCents: proofCents(rec.lessPreviousCertificates),
      currentPaymentDueCents: proofCents(t.currentPaymentDue),
      balanceToFinishCents: proofCents(t.balanceToFinish),
      workThisPeriodCents: proofCents(footer.thisPeriod),
      storedMaterialCents: proofCents(footer.stored),
      lines: (rec.lines ?? [])
        .filter((l) => proofCents(l.thisPeriod) !== 0 || proofCents(l.materialsPresentlyStored) !== 0)
        .map((l) => ({
          id: l.id, itemNo: text(l.itemNo), description: text(l.description),
          scheduledValueCents: proofCents(l.scheduledValue),
          thisPeriodCents: proofCents(l.thisPeriod),
          storedCents: proofCents(l.materialsPresentlyStored),
          link: 'no_task' as ProofLineLink, itemKeys: [],
        })),
    };
  } else {
    const inv = input.invoices.find((a) => a && a.id === input.payRef.id && a.projectId === pid);
    if (!inv) return { ok: false, reason: 'pay_document_missing' };
    period = invoicePeriod(inv, input.invoices);
    if (!period) return { ok: false, reason: 'period_end_missing' };
    const s = invoiceStrength(inv);
    pay = {
      kind: 'invoice', id: inv.id,
      number: num(inv.number),
      issueDay: dayOf(inv.issueDate),
      invoiceType: inv.type === 'progress' ? 'progress' : 'full',
      progressPercent: inv.type === 'progress' ? finiteOrNull(inv.progressPercent) : null,
      strength: s.strength, reason: s.reason,
      subtotalCents: proofCents(inv.subtotal),
      taxCents: proofCents(inv.taxAmount),
      totalDueCents: proofCents(inv.totalDue),
      amountPaidCents: proofCents(inv.amountPaid),
      retentionCents: proofCents(inv.retentionAmount),
      lines: (inv.lineItems ?? []).map((l) => ({
        id: l.id, itemNo: '', description: text(l.name) || text(l.description),
        scheduledValueCents: proofCents(l.total),
        thisPeriodCents: proofCents(l.total),
        storedCents: 0,
        link: 'not_linkable' as ProofLineLink, itemKeys: [],
      })),
    };
  }

  const collected = collectItems(input, period);
  const off = new Set(input.leaveOut ?? []);
  const leftOut = { total: 0, byKind: zeroByKind() };
  const items: ProofItem[] = [];
  for (const it of collected.items) {
    if (off.has(it.key)) { leftOut.total += 1; leftOut.byKind[it.kind] += 1; continue; }
    items.push(it);
  }

  linkLines(pay.lines, items, taskOf);

  const counts = zeroByStrength();
  const countsByKind = zeroByKind();
  for (const it of items) { counts[it.strength] += 1; countsByKind[it.kind] += 1; }

  // ── Open items: what a reader would ask about that the app does not hold ──
  const open: ProofOpenItem[] = [];
  if (pay.kind === 'invoice') open.push({ code: 'invoice_has_no_period' });
  if (period.startSource === 'open') open.push({ code: 'period_start_open' });
  if (pay.strength === 'recorded') open.push({ code: 'pay_not_locked' });
  if (!input.dailyReportsLoaded) open.push({ code: 'source_not_loaded', source: 'daily_reports' });
  if (!input.photosLoaded) open.push({ code: 'source_not_loaded', source: 'photos' });
  if (input.lienWaivers === undefined) open.push({ code: 'source_not_loaded', source: 'lien_waivers' });
  if (input.punchSeal === undefined) open.push({ code: 'source_not_loaded', source: 'punch_seal' });
  if (input.coSignatures === undefined) open.push({ code: 'source_not_loaded', source: 'change_order_signatures' });

  if (pay.kind === 'pay_app') {
    const bare = pay.lines.filter((l) => l.itemKeys.length === 0).length;
    if (bare > 0) open.push({ code: 'lines_without_records', n: bare, of: pay.lines.length });
  }
  if (input.dailyReportsLoaded && period.from) {
    const total = daysBetweenInclusive(period.from, period.to);
    const covered = new Set(items.filter((i) => i.kind === 'daily_report').map((i) => i.day)).size;
    if (total > covered) open.push({ code: 'days_without_report', n: total - covered, of: total });
  }
  const photos = items.filter((i): i is ProofPhotoItem => i.kind === 'photo');
  const noPlace = photos.filter((p) => p.placeSource !== 'phone_gps').length;
  if (noPlace > 0) open.push({ code: 'photos_without_place', n: noPlace, of: photos.length });
  const notUp = photos.filter((p) => !p.uploaded).length;
  if (notUp > 0) open.push({ code: 'photos_not_uploaded', n: notUp, of: photos.length });
  if (photos.length > 0) open.push({ code: 'photo_files_not_fingerprinted' });
  const changedLater = items.filter((i) => i.kind === 'daily_report' && i.changedAfterItsDay).length;
  if (changedLater > 0) open.push({ code: 'reports_changed_later', n: changedLater });
  const cos = items.filter((i): i is ProofChangeOrderItem => i.kind === 'change_order');
  const unsigned = cos.filter((c) => c.strength !== 'signed').length;
  if (unsigned > 0) open.push({ code: 'change_orders_not_signed', n: unsigned, of: cos.length });
  if (cos.length === 0 && pay.kind === 'pay_app' && pay.netChangeByCOCents !== 0) open.push({ code: 'no_change_orders' });
  if (input.lienWaivers !== undefined) {
    if (countsByKind.lien_waiver === 0) open.push({ code: 'no_lien_waivers' });
    if (collected.waiverGaps.length > 0) open.push({ code: 'waivers_requested_unsigned', n: collected.waiverGaps.length });
  }
  open.push({ code: 'waiver_coverage_not_checked' });
  if (input.punchSeal === null) open.push({ code: 'no_punch_seal' });
  open.push({ code: 'no_inspection_signoff' });
  if (counts.signed > 0) open.push({ code: 'signer_identity_not_checked' });
  if (leftOut.total > 0) open.push({ code: 'items_left_out', n: leftOut.total });

  return {
    ok: true,
    pack: {
      version: PROOF_PACK_VERSION,
      generatedAt: input.generatedAt,
      project: { id: pid, name: text(input.project.name), location: text(input.project.location) },
      pay,
      period,
      items,
      counts,
      countsByKind,
      leftOut,
      waiverGaps: collected.waiverGaps,
      openItems: open,
    },
  };
}

/** Every item the package WOULD hold with nothing left out: what the review screen lists. */
export function listProofCandidates(input: ProofPackInput): ProofItem[] {
  const res = buildProofPack({ ...input, leaveOut: [] });
  return res.ok ? res.pack.items : [];
}

/** "N items left out by the contractor" is owed whenever this is above zero. */
export function leftOutCount(pack: Pick<ProofPack, 'leftOut'>): number {
  return pack.leftOut.total;
}
