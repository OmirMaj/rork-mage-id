// utils/proofPack/core.ts — the Pay Period Record, as data (Big Bets, Bet 3, Phase 1).
//
// (The folder, the flag and the table keep the lane's first name, "proof pack".
// The NAME a reader sees is "Pay Period Record": the first name read as proof
// that the work was done, which this document never is.)
//
// Given a project, ONE pay document (a saved AIA-style pay application or an
// invoice), the job's records on the device AND THE FACTS READ FROM THE SERVER
// WHEN THE DOCUMENT IS MADE, this computes everything the document prints: the
// pay document's own figures, the pay period, every record the app holds for
// that period, HOW each record is kept, how records attach to schedule of
// values lines, what the contractor left out, and the list of things a reader
// would ask about that the app does not hold.
//
// PURE. No storage, no network, no React, no clock, no model: the caller
// injects `generatedAt` and the server facts (utils/proofPack/store reads them),
// and the same input always gives a deep-equal record. The input is never
// mutated (scripts/validate-proof-pack.ts deep-freezes it).
//
// ── THE ONE RULE FOR EVERY CLASS ────────────────────────────────────────────
// A record gets a label above Recorded only when a fact READ FROM THE SERVER
// AT BUILD TIME justifies it, and the figures printed for it are the server's
// own, or were compared with the server's and are equal. Anything else is
// Recorded, with a sentence that says why. A fact that was not read (offline,
// a failed read, a column that is not there yet) is never assumed.
//
// ── THE FIVE CLASSES, and what earns each TODAY ─────────────────────────────
// Each is about HOW THE RECORD IS KEPT, never about whether the work was done.
//
//   sealed    The server set the time, stored a fingerprint of the record, and
//             the database refuses every later change.
//             Earned by: the punch seal row (punch_seals, 20261002150000,
//             written only by the seal-punch function, immutable), and a punch
//             item the seal's manifest lists WHEN this device's copy carries
//             the seal's id and equals the manifest. The manifest's own fields
//             are what print.
//   signed    A named person signed on a page the contractor's account cannot
//             write through, the server set the signing time, and the database
//             keeps the signature as it was signed.
//             Earned by: NOTHING until 20261010090000_signature_provenance.sql
//             is applied. Today the project owner's account can insert a
//             change_order_approvals row (policy "gc records client CO approval
//             in own portal", 20260713150001; the in-app client view does
//             exactly that, app/client-view.tsx insertCODecision) and can write
//             sub_signature / signed_at on its own lien waiver (the guard of
//             20260923130000 pins them only once signed_at is set). So no row
//             says where it came from. After that migration a row written by
//             the token-gated portal function carries recorded_via =
//             'portal_function', and a waiver signed on the signing page
//             carries signed_via = 'signing_page'; ONLY those earn Signed. A
//             missing column or a NULL (every row that exists today) is "not
//             known" and stays Recorded.
//   locked    The database refuses edits to the record's content after a set
//             point. No server-timed signature and no fingerprint is kept, and
//             the account that owns the record is able to delete it and save
//             another.
//             Earned by: a pay application whose server row carries the lock
//             stamp (aia_pay_apps.certified_at, 20260728120000) AND whose
//             printed figures equal the server's; a field ticket the server
//             holds as signed (aa_field_tickets_seal, 20260923170000) whose
//             printed fields equal the server's.
//   recorded  Saved in the app. The account that made it can change it later
//             and no history of changes is kept.
//   stated    Typed in by the contractor, with nothing else behind it.
//
// A CHANGE ORDER'S AMOUNT is the amount IN THE SIGNATURE RECORD (the row's own
// consent_record, whose SHA-256 the row stores), never the change order's
// current amount. When the two differ the item says both. The NEWEST row for a
// change order decides: a later decline is a decline.
//
// THE PHOTO RULE: a photo's time is the phone's clock at the moment it was
// added (app/daily-report.tsx; a library pick gets the time it was PICKED, not
// taken; EXIF is never read) and its place, when it has one, is the phone's
// GPS at capture (utils/photoGeoStamp.ts). The server keeps no time of its own
// for a photo and no fingerprint of the file. So a photo is NEVER above
// `recorded`, whatever else is true of it (photoStrength has no other answer).
// Coordinates print only when the contractor switches them on.
//
// PEOPLE: no worker's name, phone, ID or pay rate enters the record through a
// structured field. A daily report gives trades and head counts (ManpowerEntry
// has no names; the company column is dropped because a one-person company is
// a person's name). A field ticket gives a count of workers and their total
// hours, never the rows. A signature record keeps its signer's NAME and never
// an email, a phone, an IP address or a browser string. Incident records and
// incident photos never enter. The AI-written homeowner summary of a daily
// report never enters. FREE TEXT is another matter: work performed, issues and
// delays, punch and ticket descriptions print AS TYPED and may name people;
// the review screen and the document both say so.
//
// MONEY crosses into the record as integer cents only; a figure the saved
// document does not hold is null and prints "Not on file", never $0.00.
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
  SavedAIAPayApp,
} from '@/types';
import { coApprovalLine } from '@/utils/coApproval';
import { addCalendarDays, calendarDayOf, parseCalendarDay, toCalendarDayString } from '@/utils/calendarDate';

export const PROOF_PACK_VERSION = 2;

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
  | 'pay_app_locked' | 'field_ticket_signed'
  | 'pay_app_saved' | 'pay_app_link_no_lock' | 'pay_app_lock_differs' | 'pay_app_not_checked'
  | 'invoice_pay_link' | 'invoice_saved'
  | 'daily_report' | 'photo_phone'
  | 'punch_item_open' | 'punch_item_differs_from_seal'
  | 'co_signature_recorded' | 'co_signature_by_account' | 'co_signature_no_amount' | 'co_portal_no_signature'
  | 'co_signed_not_confirmed' | 'co_server_declined'
  | 'waiver_link_signature'
  | 'field_ticket_differs' | 'field_ticket_not_checked'
  | 'co_marked_approved' | 'waiver_paper' | 'waiver_received' | 'inspection_typed';

export const PROOF_REASON_STRENGTH: Record<ProofReason, ProofStrength> = {
  punch_seal_record: 'sealed',
  punch_item_in_seal: 'sealed',
  co_client_signed: 'signed',
  waiver_sub_signed: 'signed',
  pay_app_locked: 'locked',
  field_ticket_signed: 'locked',
  pay_app_saved: 'recorded',
  pay_app_link_no_lock: 'recorded',
  pay_app_lock_differs: 'recorded',
  pay_app_not_checked: 'recorded',
  invoice_pay_link: 'recorded',
  invoice_saved: 'recorded',
  daily_report: 'recorded',
  photo_phone: 'recorded',
  punch_item_open: 'recorded',
  punch_item_differs_from_seal: 'recorded',
  co_signature_recorded: 'recorded',
  co_signature_by_account: 'recorded',
  co_signature_no_amount: 'recorded',
  co_portal_no_signature: 'recorded',
  co_signed_not_confirmed: 'recorded',
  co_server_declined: 'recorded',
  waiver_link_signature: 'recorded',
  field_ticket_differs: 'recorded',
  field_ticket_not_checked: 'recorded',
  co_marked_approved: 'stated',
  waiver_paper: 'stated',
  waiver_received: 'stated',
  inspection_typed: 'stated',
};

type Classed = { strength: ProofStrength; reason: ProofReason };
const classed = (reason: ProofReason): Classed => ({ strength: PROOF_REASON_STRENGTH[reason], reason });

// ── Money and days ──────────────────────────────────────────────────────────

/** Dollars to whole cents, half away from zero. Non-finite reads as 0. */
export function proofCents(n: number | null | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  const c = Math.round(Math.abs(n) * 100 + 1e-7);
  return n < 0 ? -c : c;
}

/** Whole cents, or null when the saved document holds no such figure. Prints "Not on file", never $0.00. */
export function proofCentsOrNull(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? proofCents(n) : null;
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

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** One spelling of free text for "is it the same words": spaces collapsed, ends trimmed. */
const tidy = (v: unknown): string => text(v).replace(/\s+/g, ' ');

// ── Server facts (read by utils/proofPack/store at build time) ───────────────

/** change_order_approvals.recorded_via once 20261010090000 is applied. */
export const CO_RECORDED_VIA_PORTAL = 'portal_function';
/** lien_waivers.signed_via once 20261010090000 is applied. */
export const WAIVER_SIGNED_VIA_PAGE = 'signing_page';

/**
 * What a signature row's own record states (change_order_approvals.consent_record,
 * the text whose SHA-256 the row stores). Line-oriented, written by
 * utils/portalOwnerCore buildCOConsentRecord and its twin on the portal page.
 */
export interface ProofCoSignedTerms {
  changeOrderNumber: number | null;
  /** `scope:` as signed (the change order's description, tidied and capped at 600 by the writer). */
  scope: string;
  /** `change_amount_usd:` in whole cents. */
  amountCents: number;
}

/** Reads the three lines the document needs. null when the amount line is missing or not money. */
export function parseCoConsentRecord(record: string | null | undefined): ProofCoSignedTerms | null {
  if (typeof record !== 'string' || !record) return null;
  const lines = record.split('\n');
  const first = (key: string): string | null => {
    const hit = lines.find((l) => l.startsWith(`${key}: `));
    return hit === undefined ? null : hit.slice(key.length + 2);
  };
  const amount = first('change_amount_usd');
  if (amount === null || !/^-?\d+\.\d{2}$/.test(amount.trim())) return null;
  const n = first('change_order_number');
  const numberOk = n !== null && /^\d+$/.test(n.trim());
  return {
    changeOrderNumber: numberOk ? Number(n!.trim()) : null,
    scope: tidy(first('scope') ?? ''),
    amountCents: proofCents(Number(amount.trim())),
  };
}

/** A change order's description the way the signature record's writers put it on the `scope:` line. */
export function coScopeAsSigned(description: unknown): string {
  const flat = tidy(description);
  if (flat.length <= 600) return flat;
  return `${flat.slice(0, 599).replace(/\s+$/, '')}…`;
}

/** One change_order_approvals row as the SERVER holds it, reduced to what the record may carry. */
export interface ProofCoApprovalRecord {
  changeOrderId: string;
  decision: 'approved' | 'declined';
  signerName: string;
  /** created_at as the row holds it. */
  serverCreatedAt: string;
  /** SHA-256 of the consent record, as stored. '' when none. */
  documentHash: string;
  /** True when the row carries a drawn signature. */
  hasSignature: boolean;
  /**
   * recorded_via: 'portal_function' when the token-gated portal function wrote
   * the row, 'contractor_account' when a signed-in account did. null = the
   * column is not there yet, or the row is older than the column: NOT KNOWN.
   */
  recordedVia: string | null;
  /** What the row's own record states, when the record is there and its SHA-256 equals document_hash. */
  signedTerms: ProofCoSignedTerms | null;
}

/** The NEWEST row for a change order, whatever it decided. A later decline is a decline. */
export function newestApprovalFor(
  coId: string,
  records: readonly ProofCoApprovalRecord[] | null | undefined,
): ProofCoApprovalRecord | null {
  let best: ProofCoApprovalRecord | null = null;
  for (const r of records ?? []) {
    if (!r || r.changeOrderId !== coId || !r.serverCreatedAt) continue;
    if (r.decision !== 'approved' && r.decision !== 'declined') continue;
    if (!best || r.serverCreatedAt > best.serverCreatedAt) best = r;
  }
  return best;
}

const HEX64 = /^[0-9a-f]{64}$/i;

/**
 * The class of an approved change order.
 *   signed    ONLY when the newest row is an approval with a drawn signature,
 *             the row says the portal function wrote it (recorded_via), and the
 *             row's own record states the amount.
 *   recorded  every other row on the server, a later decline, and a history
 *             that says "signed" with no row read.
 *   stated    marked approved by the contractor, with no row.
 */
export function changeOrderStrength(
  co: Pick<ChangeOrder, 'id' | 'status' | 'auditTrail' | 'approvers'>,
  records: readonly ProofCoApprovalRecord[] | null | undefined,
): Classed | null {
  const line = coApprovalLine(co);
  if (!line) return null;
  const row = newestApprovalFor(co.id, records);
  if (row) {
    if (row.decision === 'declined') return classed('co_server_declined');
    if (!row.hasSignature || !HEX64.test(row.documentHash ?? '')) return classed('co_portal_no_signature');
    // No marker (the column is not there, or the row is older than it): where
    // the row came from, and who set its date, is NOT KNOWN.
    if (row.recordedVia === null || row.recordedVia === undefined || row.recordedVia === '') return classed('co_signature_recorded');
    // Marked, and not by the portal function: a signed-in account wrote it.
    if (row.recordedVia !== CO_RECORDED_VIA_PORTAL) return classed('co_signature_by_account');
    if (!row.signedTerms) return classed('co_signature_no_amount');
    return classed('co_client_signed');
  }
  if (line.kind === 'client_signed') return classed('co_signed_not_confirmed');
  if (line.kind === 'client_portal') return classed('co_portal_no_signature');
  return classed('co_marked_approved');
}

// ── Classifiers (one per record type; each is the whole rule) ────────────────

/** A photo is never above `recorded`: its time and place come from the phone. */
export function photoStrength(): Classed {
  return classed('photo_phone');
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
export function dailyReportStrength(): Classed {
  return classed('daily_report');
}

/**
 * A lien waiver is `signed` ONLY when the server marks the signature as made on
 * the signing page (lien_waivers.signed_via, written by the signing function
 * and by nothing a client role can reach). `signedVia` is the server's value
 * for this waiver: undefined = not read, null = no marker. Without the marker a
 * signature in the sub's name is `recorded`: the contractor's account is able
 * to write one. A waiver the contractor recorded from paper, or marked
 * received, is `stated`. Requested and voided waivers are not evidence.
 */
export function lienWaiverStrength(
  w: Pick<LienWaiver, 'status' | 'subSignature' | 'signedAt'>,
  signedVia?: string | null,
): Classed | null {
  if (w.status === 'signed') {
    if (w.subSignature?.role === 'sub' && !!w.signedAt) {
      return signedVia === WAIVER_SIGNED_VIA_PAGE ? classed('waiver_sub_signed') : classed('waiver_link_signature');
    }
    return classed('waiver_paper');
  }
  if (w.status === 'received') return classed('waiver_received');
  return null;
}

/** The sealed final punch as the SERVER holds it, reduced to what the record may carry. */
export interface ProofPunchSealRecord {
  id: string;
  projectId: string;
  /** punch_seals.sealed_at: the server's clock. */
  sealedAt: string;
  itemCount: number;
  manifestHash: string;
  signerName: string;
  signerRole: string;
  /** The manifest's own items: the fields the fingerprint was taken over. */
  items: { id: string; description: string; location: string; closedAt: string | null }[];
}

/**
 * A punch item is `sealed` only when the seal's manifest lists it, this
 * device's copy carries THAT seal's id, and the copy's description, location
 * and closed day equal the manifest's. A listed item whose copy differs is
 * `recorded` and says so. Anything else is an ordinary saved item.
 */
export function punchItemStrength(
  item: Pick<PunchItem, 'id' | 'sealId' | 'description' | 'location' | 'closedAt'>,
  seal: Pick<ProofPunchSealRecord, 'id' | 'items'> | null | undefined,
): Classed {
  const listed = seal && Array.isArray(seal.items) ? seal.items.find((i) => i?.id === item.id) : undefined;
  if (!seal || !listed) return classed('punch_item_open');
  if (text(item.sealId) !== seal.id) return classed('punch_item_differs_from_seal');
  if (tidy(item.description) !== tidy(listed.description)
    || tidy(item.location) !== tidy(listed.location)
    || dayOf(item.closedAt) !== dayOf(listed.closedAt)) return classed('punch_item_differs_from_seal');
  return classed('punch_item_in_seal');
}

/** One line of a pay application as the server holds it. */
export interface ProofPayAppServerLine {
  id: string; itemNo: string; description: string;
  scheduledValue: number; thisPeriod: number; materialsPresentlyStored: number;
}

/** The aia_pay_apps row as the SERVER holds it, reduced to the figures the record prints. */
export interface ProofPayAppServerRecord {
  id: string;
  /** The lock stamp (aia_pay_apps.certified_at). null = the server holds no lock. */
  lockedAt: string | null;
  applicationNumber: number;
  periodTo: string | null;
  /** The period's first day, from the saved totals sidecar. null when the row states none. */
  periodFrom: string | null;
  originalContractSum: number | null;
  netChangeByCO: number | null;
  contractSumToDate: number | null;
  lessPreviousCertificates: number | null;
  /** The saved totals. null when the row stores none. */
  totals: {
    totalCompletedAndStored: number | null; totalRetainage: number | null; totalEarnedLessRetainage: number | null;
    currentPaymentDue: number | null; balanceToFinish: number | null;
  } | null;
  lines: ProofPayAppServerLine[];
}

/**
 * The pay application's class. `locked` only when the server row carries the
 * lock stamp AND `figuresEqual` (the printed figures were compared with the
 * server's and are equal). A pay link on the phone proves nothing: the stamp is
 * written after the link, best effort, and can match no row.
 *   server undefined  the row could not be read: recorded, "could not be checked"
 *   server null       no such row on the server: recorded
 */
export function payAppStrength(
  rec: Pick<SavedAIAPayApp, 'payLinkUrl' | 'payLinkId' | 'paidAt'>,
  server: Pick<ProofPayAppServerRecord, 'lockedAt'> | null | undefined,
  figuresEqual: boolean,
): Classed {
  if (server === undefined) return classed('pay_app_not_checked');
  if (server && server.lockedAt) return figuresEqual ? classed('pay_app_locked') : classed('pay_app_lock_differs');
  if (rec.payLinkUrl || rec.payLinkId || rec.paidAt) return classed('pay_app_link_no_lock');
  return classed('pay_app_saved');
}

/** An invoice is always `recorded`: no migration locks an invoice's content. */
export function invoiceStrength(inv: Pick<Invoice, 'payLinkUrl' | 'payLinkId'>): Classed {
  if (inv.payLinkUrl || inv.payLinkId) return classed('invoice_pay_link');
  return classed('invoice_saved');
}

/** A field ticket as the SERVER holds it: counts and hours, never the labor rows. */
export interface ProofFieldTicketServerRecord {
  id: string;
  status: string;
  number: number;
  date: string;
  workDescription: string;
  hasAuthorization: boolean;
  signerName: string;
  signerRole: string;
  signedAt: string | null;
  workerCount: number;
  totalHours: number;
}

/** What a ticket prints, from one copy of it. */
function ticketFacts(t: Pick<FieldTicket, 'number' | 'date' | 'workDescription' | 'authorization' | 'labor'>) {
  const labor = t.labor ?? [];
  return {
    number: num(t.number), date: dayOf(t.date), workDescription: tidy(t.workDescription),
    signerName: tidy(t.authorization?.name), signerRole: tidy(t.authorization?.role),
    signedAt: text(t.authorization?.signedAt) || null,
    workerCount: labor.length, totalHours: labor.reduce((n, row) => n + num(row?.hours), 0),
  };
}

/**
 * A signed (or converted) field ticket is `locked` only when the server holds
 * it as signed and every field this document prints equals the server's. The
 * database keeps a signed ticket's content on UPDATE (aa_field_tickets_seal),
 * silently, so a copy on the phone can differ from the row with no error ever
 * shown. Drafts and voids are not evidence.
 *   server undefined  the rows could not be read: recorded, "could not be checked"
 */
export function fieldTicketStrength(
  t: Pick<FieldTicket, 'id' | 'status' | 'authorization' | 'number' | 'date' | 'workDescription' | 'labor'>,
  server: Readonly<Record<string, ProofFieldTicketServerRecord>> | undefined,
): Classed | null {
  if (!((t.status === 'signed' || t.status === 'converted') && t.authorization)) return null;
  if (server === undefined) return classed('field_ticket_not_checked');
  const s = server[t.id];
  if (!s || !s.hasAuthorization || (s.status !== 'signed' && s.status !== 'converted')) return classed('field_ticket_differs');
  const mine = ticketFacts(t);
  const same = mine.number === num(s.number) && mine.date === dayOf(s.date)
    && mine.workDescription === tidy(s.workDescription)
    && mine.signerName === tidy(s.signerName) && mine.signerRole === tidy(s.signerRole)
    && (mine.signedAt ?? '') === (text(s.signedAt) || '')
    && mine.workerCount === num(s.workerCount)
    && Math.round(mine.totalHours * 100) === Math.round(num(s.totalHours) * 100);
  return same ? classed('field_ticket_signed') : classed('field_ticket_differs');
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
  /** null when the photo has no GPS place, or when the contractor left coordinates out (the default). */
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
  /** The change order's description as this device holds it NOW. */
  description: string;
  /** The change order's amount as this device holds it NOW. */
  changeAmountCents: number;
  /** The amount in the signature row's own record, when the row carries one. This is what prints first. */
  signedAmountCents: number | null;
  /** True when a signed amount is on the row and the change order now reads a different one. */
  amountDiffers: boolean;
  /** True when the row's record carries a description and the change order's now differs. */
  descriptionDiffers: boolean;
  /** The newest row's decision on the server, or null when no row was read. */
  serverDecision: 'approved' | 'declined' | null;
  approval: 'client_signed' | 'client_portal' | 'approver' | 'manual';
  approvedBy: string;
  approvedDay: string | null;
  /** created_at on the newest row, when one was read. */
  signedAtServer: string | null;
  /** True when the row carries a marker, which means the server set created_at itself. False = the date is as the row holds it, and a client could have sent it. */
  serverSetTime: boolean;
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
  /** A pay application line's scheduled value; an invoice line's own total. */
  scheduledValueCents: number;
  /** null on an invoice line: an invoice bills one amount for the document, not an amount per line. */
  thisPeriodCents: number | null;
  /** null on an invoice line. */
  storedCents: number | null;
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
  /** The server's lock stamp. Set ONLY when the class is `locked`. */
  lockedAt: string | null;
  /** True when the period's first day is the pay application's own and equals the locked row's. */
  periodFromLocked: boolean;
  paidAt: string | null;
  // The saved record's own figures, in cents (SavedAIAPayApp.totals is the
  // snapshot taken at save time). A figure the record does not hold is null.
  originalContractSumCents: number | null;
  netChangeByCOCents: number | null;
  contractSumToDateCents: number | null;
  totalCompletedAndStoredCents: number | null;
  totalRetainageCents: number | null;
  totalEarnedLessRetainageCents: number | null;
  lessPreviousCertificatesCents: number | null;
  currentPaymentDueCents: number | null;
  balanceToFinishCents: number | null;
  // THE TWO SUMMED ROWS. The saved record stores neither, so these two are
  // added up from its lines (in whole cents) when the document is made. The
  // document names them as summed.
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
  subtotalCents: number | null;
  taxCents: number | null;
  totalDueCents: number | null;
  amountPaidCents: number | null;
  retentionCents: number | null;
  lines: ProofPayLine[];
}

export type ProofPayBlock = ProofPayAppBlock | ProofInvoiceBlock;

export type ProofOpenItemCode =
  | 'period_start_open' | 'invoice_has_no_period' | 'pay_not_locked'
  | 'lines_without_records' | 'days_without_report' | 'photos_without_place' | 'photos_not_uploaded'
  | 'reports_changed_later' | 'change_orders_not_signed' | 'no_change_orders'
  | 'no_lien_waivers' | 'waivers_requested_unsigned' | 'waiver_coverage_not_checked'
  | 'no_inspection_signoff' | 'photo_files_not_fingerprinted' | 'no_punch_seal' | 'signer_identity_not_checked'
  | 'source_not_loaded' | 'items_left_out'
  | 'change_order_amounts_differ' | 'change_orders_declined_on_server' | 'photo_coordinates_left_out'
  | 'free_text_as_typed' | 'pay_figures_not_on_file';

export interface ProofOpenItem {
  code: ProofOpenItemCode;
  /** A count, when the sentence carries one. */
  n?: number;
  /** A second count ("N of M"). */
  of?: number;
  /** Which source, for source_not_loaded. */
  source?: ProofSourceName;
}

export type ProofSourceName =
  | 'photos' | 'daily_reports' | 'lien_waivers' | 'punch_seal' | 'change_order_signatures'
  | 'pay_document' | 'field_tickets' | 'waiver_signature_marks';

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
  /** The contractor's company name as the document prints it: inside the fingerprint. */
  company: { name: string };
  /** Whether photo coordinates print. 'left_out' is the default. */
  photoCoordinates: 'printed' | 'left_out';
  pay: ProofPayBlock;
  period: ProofPeriod;
  items: ProofItem[];
  /** Counts of INCLUDED items by strength. Every class is present, zero or not. */
  counts: Record<ProofStrength, number>;
  countsByKind: Record<ProofItemKind, number>;
  /**
   * What the contractor switched off on the review screen. Counted, never
   * listed: by kind AND by class, so switching off every weak record cannot
   * make the document look stronger without the count beside each class saying so.
   */
  leftOut: { total: number; byKind: Record<ProofItemKind, number>; byStrength: Record<ProofStrength, number> };
  /** Lien waivers asked for and not signed (through the period's last day). */
  waiverGaps: ProofWaiverGap[];
  openItems: ProofOpenItem[];
}

export interface ProofPackInput {
  project: Pick<Project, 'id' | 'name' | 'location'>;
  /** The company name the document's header prints. */
  companyName?: string;
  /** Print photo coordinates. Default false: coordinates are left out. */
  includeCoordinates?: boolean;
  payRef: ProofPayRef;
  payApps: readonly SavedAIAPayApp[];
  invoices: readonly Invoice[];
  dailyReports: readonly DailyFieldReport[];
  dailyReportsLoaded: boolean;
  photos: readonly ProjectPhoto[];
  photosLoaded: boolean;
  changeOrders: readonly ChangeOrder[];
  /**
   * The pay application's row as the SERVER holds it (ignored for an invoice).
   * null = asked and no such row; undefined = not read (prints "not checked").
   */
  payAppServer: ProofPayAppServerRecord | null | undefined;
  /** Approval rows read from the server. undefined = not read (prints "not checked"). */
  coSignatures: readonly ProofCoApprovalRecord[] | undefined;
  punchItems: readonly PunchItem[];
  /** null = looked and none on file; undefined = not read (prints "not checked"). */
  punchSeal: ProofPunchSealRecord | null | undefined;
  permits: readonly Permit[];
  /** undefined = not read (prints "not checked"). */
  lienWaivers: readonly LienWaiver[] | undefined;
  /** lien_waivers.signed_via by waiver id. undefined = not read, or the column is not there yet. */
  waiverSignedVia: Readonly<Record<string, string | null>> | undefined;
  fieldTickets: readonly FieldTicket[];
  /** Field tickets as the server holds them, by id. undefined = not read. */
  fieldTicketServer: Readonly<Record<string, ProofFieldTicketServerRecord>> | undefined;
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


/** "CO #12 …" at the start of a schedule of values line (utils/aiaBilling.ts writes it that way). */
export function changeOrderNumberOfLine(description: string): number | null {
  const m = /^\s*CO\s*#\s*(\d+)\b/i.exec(description ?? '');
  return m ? Number(m[1]) : null;
}

// ── Collecting ──────────────────────────────────────────────────────────────

function collectItems(input: ProofPackInput, period: ProofPeriod): { items: ProofItem[]; waiverGaps: ProofWaiverGap[] } {
  const pid = input.project.id;
  const coords = input.includeCoordinates === true;
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
      latitude: coords && place === 'phone_gps' ? finiteOrNull(p.latitude) : null,
      longitude: coords && place === 'phone_gps' ? finiteOrNull(p.longitude) : null,
      accuracyMeters: coords && place === 'phone_gps' ? finiteOrNull(p.locationAccuracyMeters) : null,
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
        latitude: coords && place === 'phone_gps' ? finiteOrNull(p.latitude) : null,
        longitude: coords && place === 'phone_gps' ? finiteOrNull(p.longitude) : null,
        accuracyMeters: coords && place === 'phone_gps' ? finiteOrNull(p.locationAccuracyMeters) : null,
        placeLabel: text(p.locationLabel),
        taskName: '',
        uploaded: !!text(p.storagePath),
        storagePath: text(p.storagePath) || null,
        dailyReportId: at.reportId,
      });
    }
  }

  // Change orders approved on or before the period's last day. The NEWEST row
  // on the server decides, and the amount that prints first is the row's own.
  for (const co of input.changeOrders) {
    if (!co || co.projectId !== pid) continue;
    const s = changeOrderStrength(co, input.coSignatures);
    if (!s) continue;
    const line = coApprovalLine(co)!;
    const row = newestApprovalFor(co.id, input.coSignatures);
    const approvedDay = row ? dayOf(row.serverCreatedAt) : (line.day ?? null);
    const day = approvedDay ?? dayOf(co.date);
    if (!day || day > period.to) continue;
    const terms = row && row.decision === 'approved' ? row.signedTerms : null;
    const nowCents = proofCents(co.changeAmount);
    items.push({
      key: `change_order:${co.id}`, kind: 'change_order', id: co.id, strength: s.strength, reason: s.reason, day,
      taskIds: Array.from(new Set([...(co.scheduleImpactTaskIds ?? []), co.scheduleAnchorTaskId ?? ''].map(text).filter(Boolean))).sort(),
      number: num(co.number),
      description: text(co.description),
      changeAmountCents: nowCents,
      signedAmountCents: terms ? terms.amountCents : null,
      amountDiffers: !!terms && terms.amountCents !== nowCents,
      descriptionDiffers: !!terms && !!terms.scope && terms.scope !== coScopeAsSigned(co.description),
      serverDecision: row ? row.decision : null,
      approval: line.kind,
      approvedBy: row ? text(row.signerName) : (line.kind === 'client_signed' || line.kind === 'client_portal' ? text(line.who) : ''),
      approvedDay,
      signedAtServer: row ? row.serverCreatedAt : null,
      serverSetTime: !!row && !!row.recordedVia,
      recordHashPrefix: row && HEX64.test(row.documentHash ?? '') ? row.documentHash.toLowerCase().slice(0, 16) : '',
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
  // A SEALED item prints the seal manifest's own fields, and carries no task
  // link: the seal does not record which schedule task an item belongs to, so
  // a sealed item never reaches a billed line through one.
  for (const it of input.punchItems) {
    if (!it || it.projectId !== pid) continue;
    if (it.listType === 'crew') continue;
    if (it.xray && it.xray.clientVisible === false) continue;
    const createdDay = dayOf(it.createdAt);
    const closedDay = dayOf(it.closedAt);
    if (!inPeriod(createdDay, period) && !inPeriod(closedDay, period)) continue;
    const s = punchItemStrength(it, sealCounts ? seal : null);
    const sealedRow = s.strength === 'sealed' && seal ? seal.items.find((i) => i.id === it.id) : undefined;
    if (sealedRow) {
      const sealedClosedDay = dayOf(sealedRow.closedAt);
      items.push({
        key: `punch_item:${it.id}`, kind: 'punch_item', id: it.id, strength: s.strength, reason: s.reason,
        day: sealedClosedDay ?? sealDay, taskIds: [],
        description: text(sealedRow.description), location: text(sealedRow.location), status: 'closed',
        createdDay: null, closedDay: sealedClosedDay,
        // The reduced manifest carries no photo fact, so none is printed for a sealed item.
        hasAfterPhoto: false,
      });
      continue;
    }
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
    const s = lienWaiverStrength(w, input.waiverSignedVia === undefined ? undefined : (input.waiverSignedVia[w.id] ?? null));
    if (!s) continue;
    const linkedToThisInvoice = input.payRef.kind === 'invoice' && w.invoiceId === input.payRef.id;
    if (!inPeriod(throughDay, period) && !linkedToThisInvoice) continue;
    items.push({
      key: `lien_waiver:${w.id}`, kind: 'lien_waiver', id: w.id, strength: s.strength, reason: s.reason,
      day: throughDay, taskIds: [],
      subName: text(w.subName), waiverType: text(w.waiverType), throughDay,
      paidAmountCents: proofCents(w.paidAmount), status: text(w.status),
      // A signer and a signing time print only for a signature in the sub's name.
      signerName: w.subSignature?.role === 'sub' ? text(w.subSignature?.name) : '',
      signedAt: w.subSignature?.role === 'sub' ? (text(w.signedAt) || null) : null,
    });
  }
  waiverGaps.sort((a, b) => a.id.localeCompare(b.id));

  // Signed field tickets dated in the period: counts and hours, never the rows.
  for (const t of input.fieldTickets) {
    if (!t || t.projectId !== pid) continue;
    const s = fieldTicketStrength(t, input.fieldTicketServer);
    if (!s) continue;
    const day = dayOf(t.date);
    if (!inPeriod(day, period)) continue;
    const f = ticketFacts(t);
    items.push({
      key: `field_ticket:${t.id}`, kind: 'field_ticket', id: t.id, strength: s.strength, reason: s.reason, day,
      taskIds: [],
      number: f.number, workDescription: text(t.workDescription), status: text(t.status),
      signerName: f.signerName, signerRole: f.signerRole,
      signedAt: f.signedAt,
      workerCount: f.workerCount,
      totalHours: f.totalHours,
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

/** The billed lines of a pay application, from one copy of its lines. */
function billedLines(
  lines: readonly { id: string; itemNo?: string; description?: string; scheduledValue?: number; thisPeriod?: number; materialsPresentlyStored?: number }[],
): ProofPayLine[] {
  return (lines ?? [])
    .filter((l) => l && (proofCents(l.thisPeriod) !== 0 || proofCents(l.materialsPresentlyStored) !== 0))
    .map((l) => ({
      id: l.id, itemNo: text(l.itemNo), description: text(l.description),
      scheduledValueCents: proofCents(l.scheduledValue),
      thisPeriodCents: proofCents(l.thisPeriod),
      storedCents: proofCents(l.materialsPresentlyStored),
      link: 'no_task' as ProofLineLink, itemKeys: [],
    }));
}

type PayAppFigures = Pick<ProofPayAppBlock,
  | 'originalContractSumCents' | 'netChangeByCOCents' | 'contractSumToDateCents' | 'lessPreviousCertificatesCents'
  | 'totalCompletedAndStoredCents' | 'totalRetainageCents' | 'totalEarnedLessRetainageCents'
  | 'currentPaymentDueCents' | 'balanceToFinishCents'>;

const PAY_APP_FIGURE_KEYS: readonly (keyof PayAppFigures)[] = [
  'originalContractSumCents', 'netChangeByCOCents', 'contractSumToDateCents', 'lessPreviousCertificatesCents',
  'totalCompletedAndStoredCents', 'totalRetainageCents', 'totalEarnedLessRetainageCents',
  'currentPaymentDueCents', 'balanceToFinishCents',
];

function serverFigures(sv: ProofPayAppServerRecord): PayAppFigures {
  const t = sv.totals;
  return {
    originalContractSumCents: proofCentsOrNull(sv.originalContractSum),
    netChangeByCOCents: proofCentsOrNull(sv.netChangeByCO),
    contractSumToDateCents: proofCentsOrNull(sv.contractSumToDate),
    lessPreviousCertificatesCents: proofCentsOrNull(sv.lessPreviousCertificates),
    totalCompletedAndStoredCents: proofCentsOrNull(t?.totalCompletedAndStored),
    totalRetainageCents: proofCentsOrNull(t?.totalRetainage),
    totalEarnedLessRetainageCents: proofCentsOrNull(t?.totalEarnedLessRetainage),
    currentPaymentDueCents: proofCentsOrNull(t?.currentPaymentDue),
    balanceToFinishCents: proofCentsOrNull(t?.balanceToFinish),
  };
}

/**
 * Do the figures this document prints equal the server's saved ones? Every
 * header sum and saved total must be ON the server row and equal in whole
 * cents, the application number and the last day of the period must be equal,
 * and the billed lines must be the same lines with the same words and amounts.
 * A server row with no saved totals is NOT equal: there is nothing to compare.
 */
export function payAppFiguresEqualServer(
  printed: PayAppFigures & { applicationNumber: number; lines: readonly ProofPayLine[] },
  periodTo: string,
  sv: ProofPayAppServerRecord,
): boolean {
  if (!sv.totals) return false;
  const theirs = serverFigures(sv);
  for (const k of PAY_APP_FIGURE_KEYS) {
    if (printed[k] === null || theirs[k] === null || printed[k] !== theirs[k]) return false;
  }
  if (printed.applicationNumber !== num(sv.applicationNumber)) return false;
  if (dayOf(sv.periodTo) !== periodTo) return false;
  const a = printed.lines;
  const b = billedLines(sv.lines);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].id !== b[i].id || a[i].itemNo !== b[i].itemNo || tidy(a[i].description) !== tidy(b[i].description)
      || a[i].scheduledValueCents !== b[i].scheduledValueCents
      || a[i].thisPeriodCents !== b[i].thisPeriodCents || a[i].storedCents !== b[i].storedCents) return false;
  }
  return true;
}

/**
 * Builds the record. Returns `ok: false` when the pay document is not on file
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
    const sv = input.payAppServer && input.payAppServer.id === rec.id ? input.payAppServer : input.payAppServer === undefined ? undefined : null;
    const t = (rec.totals ?? {}) as Partial<SavedAIAPayApp['totals']>;
    for (const l of rec.lines ?? []) if (text(l.linkedTaskId)) taskOf.set(l.id, text(l.linkedTaskId));
    const lines = billedLines(rec.lines ?? []);
    // A server row that stores no totals means the totals on this device were
    // worked out by the app from the lines, not saved: they print "Not on file".
    const serverHoldsNoTotals = !!sv && !sv.totals;
    const figures: PayAppFigures = {
      originalContractSumCents: proofCentsOrNull(rec.originalContractSum),
      netChangeByCOCents: proofCentsOrNull(rec.netChangeByCO),
      contractSumToDateCents: proofCentsOrNull(rec.contractSumToDate),
      lessPreviousCertificatesCents: proofCentsOrNull(rec.lessPreviousCertificates),
      totalCompletedAndStoredCents: serverHoldsNoTotals ? null : proofCentsOrNull(t.totalCompletedAndStored),
      totalRetainageCents: serverHoldsNoTotals ? null : proofCentsOrNull(t.totalRetainage),
      totalEarnedLessRetainageCents: serverHoldsNoTotals ? null : proofCentsOrNull(t.totalEarnedLessRetainage),
      currentPaymentDueCents: serverHoldsNoTotals ? null : proofCentsOrNull(t.currentPaymentDue),
      balanceToFinishCents: serverHoldsNoTotals ? null : proofCentsOrNull(t.balanceToFinish),
    };
    const applicationNumber = num(rec.applicationNumber);
    const equal = !!sv && payAppFiguresEqualServer({ ...figures, applicationNumber, lines }, period.to, sv);
    const s = payAppStrength(rec, sv, equal);
    const locked = s.strength === 'locked';
    pay = {
      kind: 'pay_app', id: rec.id,
      applicationNumber,
      applicationDay: dayOf(rec.applicationDate),
      strength: s.strength, reason: s.reason,
      lockedAt: locked && sv ? sv.lockedAt : null,
      periodFromLocked: locked && !!sv && period.startSource === 'pay_app_period_from' && dayOf(sv.periodFrom) === period.from,
      paidAt: text(rec.paidAt) || null,
      ...figures,
      // The two summed rows: whole cents added up from the billed lines.
      workThisPeriodCents: lines.reduce((n, l) => n + (l.thisPeriodCents ?? 0), 0),
      storedMaterialCents: lines.reduce((n, l) => n + (l.storedCents ?? 0), 0),
      lines,
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
      subtotalCents: proofCentsOrNull(inv.subtotal),
      taxCents: proofCentsOrNull(inv.taxAmount),
      totalDueCents: proofCentsOrNull(inv.totalDue),
      amountPaidCents: proofCentsOrNull(inv.amountPaid),
      retentionCents: proofCentsOrNull(inv.retentionAmount),
      // An invoice bills one amount for the whole document (Total Due above).
      // A line's total is the line's own total: on a progress invoice it is NOT
      // what was billed this period, so no per-line "this period" is printed.
      lines: (inv.lineItems ?? []).map((l) => ({
        id: l.id, itemNo: '', description: text(l.name) || text(l.description),
        scheduledValueCents: proofCents(l.total),
        thisPeriodCents: null,
        storedCents: null,
        link: 'not_linkable' as ProofLineLink, itemKeys: [],
      })),
    };
  }

  const collected = collectItems(input, period);
  const off = new Set(input.leaveOut ?? []);
  const leftOut = { total: 0, byKind: zeroByKind(), byStrength: zeroByStrength() };
  const items: ProofItem[] = [];
  for (const it of collected.items) {
    if (off.has(it.key)) { leftOut.total += 1; leftOut.byKind[it.kind] += 1; leftOut.byStrength[it.strength] += 1; continue; }
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
  const payFigures: (number | null)[] = pay.kind === 'pay_app'
    ? PAY_APP_FIGURE_KEYS.map((k) => (pay as ProofPayAppBlock)[k])
    : [pay.subtotalCents, pay.taxCents, pay.totalDueCents, pay.amountPaidCents];
  const missingFigures = payFigures.filter((v) => v === null).length;
  if (missingFigures > 0) open.push({ code: 'pay_figures_not_on_file', n: missingFigures });
  if (pay.kind === 'pay_app' && input.payAppServer === undefined) open.push({ code: 'source_not_loaded', source: 'pay_document' });
  if (!input.dailyReportsLoaded) open.push({ code: 'source_not_loaded', source: 'daily_reports' });
  if (!input.photosLoaded) open.push({ code: 'source_not_loaded', source: 'photos' });
  if (input.lienWaivers === undefined) open.push({ code: 'source_not_loaded', source: 'lien_waivers' });
  else if (input.waiverSignedVia === undefined && items.some((i) => i.kind === 'lien_waiver' && i.reason === 'waiver_link_signature')) {
    open.push({ code: 'source_not_loaded', source: 'waiver_signature_marks' });
  }
  if (input.punchSeal === undefined) open.push({ code: 'source_not_loaded', source: 'punch_seal' });
  if (input.coSignatures === undefined) open.push({ code: 'source_not_loaded', source: 'change_order_signatures' });
  if (input.fieldTicketServer === undefined && items.some((i) => i.kind === 'field_ticket')) open.push({ code: 'source_not_loaded', source: 'field_tickets' });

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
  const coordsOut = input.includeCoordinates !== true && photos.some((p) => p.placeSource === 'phone_gps');
  if (coordsOut) open.push({ code: 'photo_coordinates_left_out' });
  const notUp = photos.filter((p) => !p.uploaded).length;
  if (notUp > 0) open.push({ code: 'photos_not_uploaded', n: notUp, of: photos.length });
  if (photos.length > 0) open.push({ code: 'photo_files_not_fingerprinted' });
  const changedLater = items.filter((i) => i.kind === 'daily_report' && i.changedAfterItsDay).length;
  if (changedLater > 0) open.push({ code: 'reports_changed_later', n: changedLater });
  const cos = items.filter((i): i is ProofChangeOrderItem => i.kind === 'change_order');
  const unsigned = cos.filter((c) => c.strength !== 'signed').length;
  if (unsigned > 0) open.push({ code: 'change_orders_not_signed', n: unsigned, of: cos.length });
  const differ = cos.filter((c) => c.amountDiffers).length;
  if (differ > 0) open.push({ code: 'change_order_amounts_differ', n: differ });
  const declined = cos.filter((c) => c.serverDecision === 'declined').length;
  if (declined > 0) open.push({ code: 'change_orders_declined_on_server', n: declined });
  if (cos.length === 0 && pay.kind === 'pay_app' && pay.netChangeByCOCents !== 0 && pay.netChangeByCOCents !== null) open.push({ code: 'no_change_orders' });
  if (input.lienWaivers !== undefined) {
    if (countsByKind.lien_waiver === 0) open.push({ code: 'no_lien_waivers' });
    if (collected.waiverGaps.length > 0) open.push({ code: 'waivers_requested_unsigned', n: collected.waiverGaps.length });
  }
  open.push({ code: 'waiver_coverage_not_checked' });
  if (input.punchSeal === null) open.push({ code: 'no_punch_seal' });
  open.push({ code: 'no_inspection_signoff' });
  // Owed whenever ANY included record prints a signer's name, whatever its class.
  if (items.some(itemNamesASigner)) open.push({ code: 'signer_identity_not_checked' });
  // Owed whenever any included record prints words as they were typed.
  if (items.some(itemPrintsFreeText)) open.push({ code: 'free_text_as_typed' });
  if (leftOut.total > 0) open.push({ code: 'items_left_out', n: leftOut.total });

  return {
    ok: true,
    pack: {
      version: PROOF_PACK_VERSION,
      generatedAt: input.generatedAt,
      project: { id: pid, name: text(input.project.name), location: text(input.project.location) },
      company: { name: text(input.companyName) },
      photoCoordinates: input.includeCoordinates === true ? 'printed' : 'left_out',
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

/** Does this record print a signer's name? (punch seal, field ticket, change order, lien waiver) */
export function itemNamesASigner(i: ProofItem): boolean {
  switch (i.kind) {
    case 'punch_seal': return !!i.signerName;
    case 'field_ticket': return !!i.signerName;
    case 'change_order': return !!i.approvedBy;
    case 'lien_waiver': return !!i.signerName;
    default: return false;
  }
}

/** Does this record print words exactly as someone typed them? */
export function itemPrintsFreeText(i: ProofItem): boolean {
  switch (i.kind) {
    case 'daily_report': return !!(i.workPerformed || i.issuesAndDelays || i.materialsDelivered.length);
    case 'punch_item': return !!(i.description || i.location);
    case 'field_ticket': return !!i.workDescription;
    case 'change_order': return !!i.description;
    case 'inspection': return !!i.name;
    case 'photo': return !!(i.placeSource === 'typed' && i.placeLabel);
    default: return false;
  }
}

/** Every item the record WOULD hold with nothing left out: what the review screen lists. */
export function listProofCandidates(input: ProofPackInput): ProofItem[] {
  const res = buildProofPack({ ...input, leaveOut: [] });
  return res.ok ? res.pack.items : [];
}

/** "N items left out by the contractor" is owed whenever this is above zero. */
export function leftOutCount(pack: Pick<ProofPack, 'leftOut'>): number {
  return pack.leftOut.total;
}
