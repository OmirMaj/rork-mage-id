// Project financial derivations.
//
// The "contract value" of a project is not a stored field. It's derived every time
// from (a) the base estimate total, plus (b) the sum of all approved change order
// change amounts. Storing it would invite drift between the CO screen, the cash flow
// forecast, the portal snapshot, and anything else that reads it. So this file is the
// single source of truth for anything money-shaped that spans Project + ChangeOrders
// + Invoices.

import type { Project, ChangeOrder, Invoice, InvoiceStatus, BidPackage, BidPackageBid, Commitment } from '@/types';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { invoiceOutstanding, invoiceIsSettled, pendingRetentionHeld } from '@/utils/invoiceBilling';

/**
 * Total contract value = base estimate + approved change orders.
 * Unapproved / void / rejected COs do not count.
 *
 * THIS IS THE ESTIMATE BASIS, AND IT STILL IS (MONEY-CONTRACT-1, audit
 * 2026-09-11 — stated here rather than left for the next reader to discover).
 * `resolveContractSum` below prefers the SIGNED contract when one exists; this
 * function cannot, because it takes no contract and its two callers —
 * utils/marginRiskScore.ts and utils/livingEstimate.ts — are pure engines that
 * receive no contract from any of their own eleven call sites. Threading one
 * through is the work, and it is not free: `ProjectContract` lives behind
 * `fetchActiveContract`, an async Supabase read, while both engines are
 * synchronous and are called from render.
 *
 * The consequence is bounded and worth stating: both engines measure MARGIN,
 * and a GC who signed BELOW his estimate reads a margin computed against the
 * estimate — optimistic by the difference. Neither figure is printed on a
 * client document, which is where the same defect actually mattered (the
 * portal, fixed; app/change-order.tsx and utils/aiaBilling.ts G702 line 1,
 * fixed in lane PAYFIX — see `resolveContractSum` below). See
 * docs/audits/2026-09-11-handoff-money-to-wip.md.
 */
export function getContractValue(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
): number {
  const base = effectiveEstimateTotal(project);
  const coSum = (changeOrders ?? [])
    .filter(co => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
  return base + coSum;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SIGNED CONTRACT IS THE CONTRACT SUM (MONEY-CONTRACT-1, audit 2026-09-11).
//
// `project_contracts.contract_value` was read by four SCREENS and by no money
// engine. Everything that printed a contract figure printed
// `effectiveEstimateTotal(project)` instead — the estimate.
//
// The two agree until they don't. `buildDraftContract` seeds `contractValue`
// from the estimate, so a contract nobody edited matches; but the contract
// screen exposes that field for editing, and an estimate is the OPENING of a
// negotiation. The moment a GC signs at a number he negotiated, the portal his
// homeowner reads prints the ESTIMATE as "Original Contract" on the same page
// that links them to the executed PDF carrying a different one.
//
// So: prefer the signed contract, fall back to the estimate, and SAY WHICH —
// a contract figure that cannot name its source is the thing that started
// this. Callers render the source; they never re-derive it.
//
// ONLY 'signed' COUNTS. A 'sent' contract is an offer the owner has not
// accepted and a 'draft' is not an offer at all; treating either as the
// contract sum would let an unaccepted asking price become the number on a
// change order. A signed contract with no usable value (zero, negative, or
// non-finite — a legacy row, or a hand-cleared field) also falls back rather
// than reporting a $0 contract.
// ─────────────────────────────────────────────────────────────────────────────

export type ContractSumSource = 'signed_contract' | 'estimate';

export interface ContractSumResolution {
  /** The original (pre-change-order) contract sum. */
  value: number;
  source: ContractSumSource;
  /** What the estimate says, always — so a screen can show the divergence. */
  estimateTotal: number;
}

/** What the caller needs off a ProjectContract. Structural, so this file stays
 *  importable by a bun guard (utils/contractEngine.ts pulls @/lib/supabase). */
export interface SignedContractLike {
  status?: string;
  contractValue?: number;
}

/**
 * WHO CALLS THIS TODAY, precisely — so nobody reads it as the app-wide
 * definition it is not yet (audit 2026-09-11, review round 3).
 *
 *   • app/client-view.tsx — the homeowner portal. Live for a signed-in GC
 *     previewing it; in SNAPSHOT mode (the mode a real homeowner is in) the
 *     screen never fetches a contract, so this answers 'estimate' and the
 *     caption says so rather than asserting an absence. Carrying the resolved
 *     sum into utils/portalSnapshot.ts is what makes the anon view print the
 *     signed figure, and that file belongs to the WIP/AIA wave.
 *
 *   • app/change-order.tsx — "Original contract sum" on the document a
 *     homeowner signs, and the `originalContractValue` stamped on the saved
 *     CO (lane PAYFIX). The estimate stands in ONLY when no contract is
 *     signed, captioned "Estimate (no signed contract yet)", or "…not
 *     checked" when the contract read did not answer (`contractSumView`). A
 *     read that has not answered never moves the figure a saved CO was built
 *     on (`contractSumBasis`, the unanswered-read rule).
 *   • utils/aiaBilling.ts `seedAIAPayApplicationFromInvoice` — G702 line 1
 *     (lane PAYFIX), with the same fallback rule; the source rides on the
 *     application (`payAppContractSumSource`) and shows under line 1 on the
 *     screen. The PDF prints the bare line label: MAGE only knows what is on
 *     file in MAGE, so it does not tell an owner or lender "no signed contract".
 *   • components/moments-sites/COApproveSheet.tsx, hooks/useProjectPulse.ts.
 *
 * STILL ON THE ESTIMATE, not touched by lane PAYFIX:
 *   • `getContractValue` above (see its own note) → marginRiskScore, livingEstimate;
 *   • utils/wip.ts `deriveOriginalContractWithSource` — seven branches, no
 *     `signed_contract` among them. (Its `pay_app_contract_sum` branch reads
 *     the latest saved G702's line 1, so pay apps saved after lane PAYFIX
 *     carry the signed figure into it indirectly.)
 */
export function resolveContractSum(
  project: Project | null | undefined,
  contract: SignedContractLike | null | undefined,
): ContractSumResolution {
  const estimateTotal = effectiveEstimateTotal(project);
  const v = contract?.contractValue;
  if (contract?.status === 'signed' && typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return { value: v, source: 'signed_contract', estimateTotal };
  }
  return { value: estimateTotal, source: 'estimate', estimateTotal };
}

/**
 * A contract-sum source as a SCREEN states it (lane PAYFIX): resolveContractSum's
 * two answers, plus the cases where "no signed contract yet" would be false:
 *   `estimate_unread` — the contract read did not answer, so the estimate stands
 *     in and nobody knows whether a signed figure exists;
 *   `saved_unread` — the read did not answer and the document already carries a
 *     figure that is not the estimate, so that figure stays exactly as it is;
 *   `estimate_signed_no_amount` — a signed contract IS on file but carries no
 *     usable value (zero, negative, non-finite), so the estimate stands in.
 * A screen must not print "no signed contract yet" over any of them.
 */
export type ContractSumBasis = ContractSumSource | 'estimate_unread' | 'saved_unread' | 'estimate_signed_no_amount';

/** The caption beside an original contract sum, by basis. Screen only: nothing
 *  that goes to an owner, architect or lender prints these. */
export const CONTRACT_SUM_BASIS_LABEL: Record<ContractSumBasis, string> = {
  signed_contract: 'Signed contract',
  estimate: 'Estimate (no signed contract yet)',
  estimate_unread: 'Estimate (signed contract not checked)',
  saved_unread: 'As saved (signed contract not checked)',
  estimate_signed_no_amount: 'Estimate (signed contract has no amount)',
};

const sameContractCents = (a: number, b: number) => Math.abs(Math.round(a * 100) - Math.round(b * 100)) < 1;

/**
 * THE UNANSWERED-READ RULE — one function, for every screen that prints an
 * original contract sum (the pay app's line 1 and the change order's
 * "Original contract sum" both go through it; scripts/validate-payfix.ts runs
 * it and mutates it).
 *
 * `contract` is the active row, `null` when the project has none on file, and
 * `undefined` when the read HAS NOT ANSWERED (offline, failed, timed out,
 * still loading). `onDocument` is the original contract sum the document
 * already carries, when it has one: a saved pay app's line 1, the previous
 * period's line 1, the figure a saved change order was built on.
 *
 * A read that has not answered:
 *   1. NEVER CHANGES A FIGURE ALREADY ON THE DOCUMENT. `onDocument` comes back
 *      as the value, to the cent.
 *   2. IS NEVER DESCRIBED AS "NO SIGNED CONTRACT". The basis is
 *      `estimate_unread` or `saved_unread`, never `estimate`.
 * Only an ANSWER decides: the signed contract, else the estimate — and then
 * `onDocument` is not consulted, because an answer outranks a stale figure.
 */
export function contractSumBasis(
  project: Project | null | undefined,
  contract: SignedContractLike | null | undefined,
  onDocument?: number | null,
): { value: number; basis: ContractSumBasis; estimateTotal: number } {
  const r = resolveContractSum(project, contract ?? null);
  if (contract === undefined) {
    const kept = typeof onDocument === 'number' && Number.isFinite(onDocument) && onDocument > 0 ? onDocument : null;
    if (kept != null && !sameContractCents(kept, r.estimateTotal)) {
      return { value: kept, basis: 'saved_unread', estimateTotal: r.estimateTotal };
    }
    return { value: kept ?? r.estimateTotal, basis: 'estimate_unread', estimateTotal: r.estimateTotal };
  }
  const basis: ContractSumBasis = r.source === 'estimate' && contract?.status === 'signed'
    ? 'estimate_signed_no_amount'
    : r.source;
  return { value: r.value, basis, estimateTotal: r.estimateTotal };
}

// ─────────────────────────────────────────────────────────────────────────────
// READING THE CONTRACT, ONCE, FOR EVERY SCREEN THAT PRINTS A CONTRACT SUM
// (lane PAYFIX, fix round 1).
//
// The honesty rule is one sentence: a read that did not answer is NOT "no
// contract". It used to live as hand-copied wiring in two screens (`r.ok ?
// r.contract : undefined`, the offline branch, a timeout), where flipping any
// one of them to `null` printed "Estimate (no signed contract yet)" over a
// dead network with every guard green. It is here now, pure, and
// scripts/validate-payfix.ts runs it: the screens only hand it a loader.
//
//   row        the active contract
//   null       the project has none on file (or it is a sample job, which has
//              no server contract)
//   undefined  not read: offline, a failed read, a thrown read, or no answer
//              within the timeout
// ─────────────────────────────────────────────────────────────────────────────

/** How long a screen waits for the contract read before it says "not checked". */
export const CONTRACT_READ_TIMEOUT_MS = 6000;

export type ContractReadEvent<T> =
  | { kind: 'sample' }
  | { kind: 'offline' }
  | { kind: 'timeout' }
  | { kind: 'threw' }
  | { kind: 'loaded'; result: { ok: boolean; contract?: T | null } };

/** What one read event says about the contract — see the table above. */
export function contractReadOutcome<T>(event: ContractReadEvent<T>): T | null | undefined {
  if (event.kind === 'sample') return null;
  if (event.kind === 'loaded') return event.result.ok ? (event.result.contract ?? null) : undefined;
  return undefined;
}

/** A screen's contract read: which project it is for, and what it answered. */
export interface ContractReadState<T> {
  projectId: string;
  contract: T | null | undefined;
}

/**
 * Fold one outcome into a screen's read state. An ANSWER (a row or `null`) is
 * never replaced by "not read": a device that drops offline after a good read
 * keeps the contract it has.
 */
export function nextContractRead<T>(
  prev: ContractReadState<T> | null,
  projectId: string,
  contract: T | null | undefined,
): ContractReadState<T> {
  if (prev && prev.projectId === projectId && prev.contract !== undefined && contract === undefined) return prev;
  return { projectId, contract };
}

/**
 * Run one bounded contract read and report every outcome through `onSettle`.
 * It always settles: at once for a sample job or an offline device (the loader
 * is never called), otherwise on the answer or on the timeout, whichever comes
 * first. A LATE answer after a timeout is still delivered, so a screen that
 * settled as "not checked" corrects itself. Returns the cancel.
 */
export function watchContractRead<T>(opts: {
  sample: boolean;
  offline: boolean;
  load: () => Promise<{ ok: boolean; contract?: T | null }>;
  onSettle: (contract: T | null | undefined) => void;
  timeoutMs?: number;
}): () => void {
  if (opts.sample) { opts.onSettle(contractReadOutcome<T>({ kind: 'sample' })); return () => {}; }
  if (opts.offline) { opts.onSettle(contractReadOutcome<T>({ kind: 'offline' })); return () => {}; }
  let live = true;
  const timer = setTimeout(() => {
    if (live) opts.onSettle(contractReadOutcome<T>({ kind: 'timeout' }));
  }, opts.timeoutMs ?? CONTRACT_READ_TIMEOUT_MS);
  let read: Promise<{ ok: boolean; contract?: T | null }>;
  try { read = opts.load(); } catch (err) { read = Promise.reject(err); }
  read.then(
    (result) => { clearTimeout(timer); if (live) opts.onSettle(contractReadOutcome<T>({ kind: 'loaded', result })); },
    () => { clearTimeout(timer); if (live) opts.onSettle(contractReadOutcome<T>({ kind: 'threw' })); },
  );
  return () => { live = false; clearTimeout(timer); };
}

/**
 * WHAT A SCREEN'S READ STATE SAYS ABOUT THIS PROJECT'S CONTRACT — the one place
 * a read state is turned into the value the rule above takes (lane PAYFIX, fix
 * round 2). contractSumView, the pay app's payAppLineOneView and the pay-app
 * screen's seeder all go through it; no screen opens a read state itself.
 *
 *   settled   the read for THIS project has reported (an answer, or "not read")
 *   contract  the row; `null` = none on file; `undefined` = NOT READ
 *
 * `undefined` comes back whenever there is no answer for this project: nothing
 * has reported yet, the state belongs to another project, or the read settled
 * as "not read". It is NEVER turned into `null` here — `null` means "this job
 * has no contract on file", and only an answer may say that. The pay-app
 * screen used to derive these two values by hand, where one `?? null` handed
 * the seeder "no contract" for a dead network with every guard green.
 */
export function contractOfRead<T>(
  read: ContractReadState<T> | null | undefined,
  projectId: string | null | undefined,
): { settled: boolean; contract: T | null | undefined } {
  const settled = !!projectId && !!read && read.projectId === projectId;
  return { settled, contract: settled ? read!.contract : undefined };
}

/**
 * Everything a screen shows about an original contract sum, from its read
 * state: the figure, its basis, and the caption. THE CAPTION IS NULL UNTIL THE
 * READ FOR THIS PROJECT HAS SETTLED — a screen renders `caption` and nothing
 * else, so it cannot state a source it has not checked — and `settled` is what
 * a screen gates Save / Send on, so an uncaptioned figure is never stamped
 * onto a document. `onDocument` is the figure the document already carries
 * (see contractSumBasis): until the read ANSWERS, it stays.
 */
export function contractSumView<T extends SignedContractLike>(
  project: Project | null | undefined,
  read: ContractReadState<T> | null | undefined,
  projectId: string | null | undefined,
  onDocument?: number | null,
): { value: number; basis: ContractSumBasis; estimateTotal: number; settled: boolean; contract: T | null | undefined; caption: string | null } {
  const { settled, contract } = contractOfRead(read, projectId);
  const r = contractSumBasis(project, contract, onDocument);
  return { ...r, settled, contract, caption: settled ? CONTRACT_SUM_BASIS_LABEL[r.basis] : null };
}

/**
 * The original contract sum a SAVED change order was built on: its stored
 * "contract sum prior to this CO" less the approved changes frozen with it
 * (the live figure for a record saved before that was frozen). This is the
 * `onDocument` a change order hands to contractSumView. Null for a new change
 * order, or a record with no usable base.
 */
export function savedChangeOrderOriginalSum(
  co: { originalContractValue?: number; priorApprovedChangesTotal?: number } | null | undefined,
  livePriorApprovedChanges: number,
): number | null {
  const base = co?.originalContractValue;
  if (typeof base !== 'number' || !Number.isFinite(base) || base <= 0) return null;
  const frozen = co?.priorApprovedChangesTotal;
  const prior = typeof frozen === 'number' && Number.isFinite(frozen) ? frozen : livePriorApprovedChanges;
  const sum = cents(base - (Number.isFinite(prior) ? prior : 0));
  return sum > 0 ? sum : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SAVED BASE AND THE SCREEN (lane PAYFIX, fix rounds 3 and 4).
//
// A saved change order carries a stamp: `originalContractValue`, the contract
// sum just before this change order. Every document that leaves the
// change-order screen prints THAT stamp — Share PDF, the proof packet and the
// client portal build from the saved record. The screen's rows are live: once
// the contract read answers, they show the signed contract. So a saved stamp
// built on the estimate printed $100,000 on the PDF while the screen said
// "$92,500 · Signed contract", with nothing on screen saying so.
//
// ONE RULE: the figure on screen and the figure a document prints agree, or
// the document does not leave.
//   * An EDITABLE change order whose saved stamp differs from the screen's
//     figure (coSavedBaseDiffers) is held at every exit — Share PDF, the proof
//     packet, the portal share, the email send AND EVERY APPROVE on the screen
//     — with a reason that names both figures and says to save first
//     (coSavedBaseHold). Saving restamps the base. Nothing prints a stale base
//     silently, and nothing restamps it without a save the contractor made.
//     Approving is an exit too: it does not restamp the base, and it turns the
//     change order into a record nobody can save again, so a stale stamp
//     approved is a stale stamp for good.
//   * A LOCKED change order (approved, declined, void) cannot be saved, so its
//     rows are the rows its PDF prints, from the record alone
//     (changeOrderRecordRows). Nothing live is read for it.
//
// The comparison has no other condition. It needs none for a contract read
// that has not answered: until it answers, the screen's original contract sum
// IS the figure the saved change order was built on (contractSumBasis keeps
// it), so the two can only differ when the approved changes before this one
// moved — and those are on the device, known with or without the read.
//
// The other change-order draft writers — components/UniversalMicButton.tsx,
// utils/fieldTicketCore.ts, utils/brain/leakCoDraft.ts and
// utils/brain/scopeCoDraft.ts — still stamp the ESTIMATE on the drafts they
// write, and need no edit: they cannot read the signed contract where they
// run, and every draft they write is reconciled on the change-order screen
// before a document can leave it or an approve can be made on it. So is any
// draft saved before this build, and any draft saved while the contract read
// had not answered. (An approval made somewhere else — the project screen, or
// the client in the portal — does not pass through this rule.)
// ─────────────────────────────────────────────────────────────────────────────

const wholeCents = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) : 0);

/**
 * Does the SAVED change order's stamped base differ from the base the screen
 * shows now? Compared in whole cents, and nothing else is asked. False for a
 * change order that has never been saved.
 */
export function coSavedBaseDiffers(
  saved: { originalContractValue?: number } | null | undefined,
  liveOriginalContractValue: number,
): boolean {
  if (!saved) return false;
  return wholeCents(saved.originalContractValue) !== wholeCents(liveOriginalContractValue);
}

/**
 * Why a change-order document may not leave yet — and why the change order may
 * not be approved yet — in the contractor's words: both figures, and what to
 * do. Null when the saved stamp and the screen agree. States no cause — the
 * difference can be a contract signed since the save, or another change order
 * approved since — only the two figures, which are known.
 */
export function coSavedBaseHold(
  saved: { originalContractValue?: number } | null | undefined,
  liveOriginalContractValue: number,
  money: (n: number) => string,
): string | null {
  if (!coSavedBaseDiffers(saved, liveOriginalContractValue)) return null;
  const savedBase = wholeCents(saved!.originalContractValue) / 100;
  const liveBase = wholeCents(liveOriginalContractValue) / 100;
  return `The saved copy of this change order was built on a contract sum of ${money(savedBase)}. This screen now shows ${money(liveBase)}. Tap Save to Project to update the saved copy, then share, send or approve it.`;
}

/** A change order nobody can edit any more — approved, declined or void — is a
 *  record of what the client was shown. */
export function changeOrderIsRecord(status: string | null | undefined): boolean {
  return status === 'approved' || status === 'rejected' || status === 'void';
}

/** The caption under the first base row of a locked change order. */
export const CO_RECORD_SUM_CAPTION = 'As recorded on this change order';

/** The base rows of a locked change order. `originalContractSum` and
 *  `priorApprovedChanges` are null together: the record does not carry them. */
export interface ChangeOrderRecordRows {
  /** The stamp: "Contract sum prior to this CO". */
  originalContractValue: number;
  /** The approved changes FROZEN on the record, or null when it carries none. */
  priorApprovedChanges: number | null;
  /** The stamp less the frozen changes, or null with them. */
  originalContractSum: number | null;
}

/**
 * THE ROWS A LOCKED CHANGE ORDER SHOWS ARE THE ROWS ITS PDF PRINTS, from the
 * record alone — the same branch as utils/pdfGenerator's `buildUp`
 * (scripts/validate-payfix.ts pins the two together):
 *   * the record carries its frozen prior approved changes → the original
 *     contract sum (stamp less frozen), the frozen changes, and the stamp;
 *   * it does not (a draft written by the mic, a field ticket or the brain and
 *     approved without a save here; a sample change order; anything locked
 *     before the changes were frozen) → the stamp ALONE, as "Contract sum
 *     prior to this CO". There is no original contract sum on such a record,
 *     and none is worked out from today's approved changes: that figure would
 *     be on no document, and it is wrong whenever those changes moved.
 * Takes no live figure, so it cannot read one. Null for a change order that
 * can still be edited: its rows are live.
 */
export function changeOrderRecordRows(
  co: { status?: string; originalContractValue?: number; priorApprovedChangesTotal?: number } | null | undefined,
): ChangeOrderRecordRows | null {
  if (!co || !changeOrderIsRecord(co.status)) return null;
  const base = wholeCents(co.originalContractValue) / 100;
  const frozen = co.priorApprovedChangesTotal;
  if (typeof frozen !== 'number' || !Number.isFinite(frozen)) {
    return { originalContractValue: base, priorApprovedChanges: null, originalContractSum: null };
  }
  return { originalContractValue: base, priorApprovedChanges: frozen, originalContractSum: cents(base - frozen) };
}

/** Why Save / Send wait, in the user's words, while the contract read for this
 *  document has not settled. It always settles within CONTRACT_READ_TIMEOUT_MS. */
export const CONTRACT_READ_PENDING_REASON =
  'MAGE ID is still checking whether this job has a signed contract, so the original contract sum is not confirmed yet. Try again in a few seconds.';

/**
 * SENDING A FIGURE MAGE COULD NOT CHECK (lane PAYFIX, fix round 2). Once the
 * read has settled as "not read", the contractor sees the caption "…(signed
 * contract not checked)" under the row. His client does not: the change-order
 * email prints the figure as "Original contract sum", plain. So the send asks
 * him first, naming the figure. Null for an ANSWERED basis — the signed
 * contract, or the estimate when the answer was "none on file" — where there
 * is nothing to ask.
 */
export function uncheckedContractSumSendNotice(
  basis: ContractSumBasis,
  value: number,
  money: (n: number) => string,
): { title: string; message: string } | null {
  if (basis !== 'estimate_unread' && basis !== 'saved_unread') return null;
  return {
    title: 'Signed contract not checked',
    message: `MAGE ID could not check the signed contract. This change order will show ${money(value)} as the original contract sum. Send anyway?`,
  };
}

/**
 * Base estimate before any change orders (useful for showing the "original"
 * contract total next to the "current" one for transparency).
 */
export function getBaseContractValue(project: Project | null | undefined): number {
  return effectiveEstimateTotal(project);
}

/**
 * Pending CO value — COs that are submitted but not yet approved or rejected.
 * Useful for "potential upside" callouts in the UI.
 */
export function getPendingChangeOrderValue(
  changeOrders: ChangeOrder[] | null | undefined,
): number {
  return (changeOrders ?? [])
    .filter(co => co.status === 'submitted' || co.status === 'under_review')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
}

/**
 * Total already collected from the client (invoices.amountPaid summed).
 * Includes retention releases if they've been recorded as payments.
 *
 * DRAFTS ARE EXCLUDED (MONEY-PAID-DRAFT-1, audit 2026-09-11), and that is not
 * a formality. This was the ONE billing aggregation in the file with no status
 * filter, sitting between two that have one (`getInvoicedToDate` below,
 * `getOutstandingBalance` after it) — and it is what the client portal prints
 * as "Paid to date". A payment recorded against a draft therefore read as
 * money collected on the document the HOMEOWNER reads, while the same payment
 * was excluded from invoiced-to-date and from outstanding: the portal's own
 * money bar could not foot against itself.
 *
 * A draft is a document issued to nobody (utils/wip.ts DEFINITION 1). Nobody
 * pays one. A non-zero `amountPaid` on a draft is either a payment logged
 * before the invoice was sent — in which case sending it is the fix and the
 * dollars reappear the moment it is — or a stale row; neither is cash the GC
 * should be told he has collected on a job.
 */
export function getPaidToDate(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? [])
    .filter(inv => inv.status !== 'draft')
    .reduce((sum, inv) => sum + (inv.amountPaid ?? 0), 0);
}

/**
 * Total invoiced — what has been billed regardless of payment status.
 * Excludes drafts (which represent work not yet submitted for payment).
 */
export function getInvoicedToDate(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? [])
    .filter(inv => inv.status !== 'draft')
    .reduce((sum, inv) => sum + (inv.totalDue ?? 0), 0);
}

/**
 * Outstanding = what clients can be asked for today, summed over sent
 * invoices: each invoice's total NET of the retention the contract lets the
 * client hold, less what they have paid (utils/invoiceBilling.invoiceOutstanding).
 *
 * MONEY-F5 (audit 2026-09-03): this used to be invoiced − paid, which reported
 * held retention as money the GC was "waiting on" and painted it overdue.
 * Held retention is reported separately by getRetentionHeld().
 */
export function getOutstandingBalance(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? [])
    .filter(inv => inv.status !== 'draft')
    .reduce((sum, inv) => sum + invoiceOutstanding(inv), 0);
}

/** Retention still held on sent invoices (released amounts excluded). Not due today. */
export function getRetentionHeld(invoices: Invoice[] | null | undefined): number {
  return (invoices ?? [])
    .filter(inv => inv.status !== 'draft')
    .reduce((sum, inv) => sum + pendingRetentionOf(inv), 0);
}

/**
 * Retention currently held on one invoice, less what has been released.
 *
 * MONEY-05: the withholding comes from `pendingRetentionHeld` — percentage of
 * work value, stored column only as a fallback — so this figure and the one
 * `invoiceOutstanding` nets out are always two halves of the same total. When
 * they were computed differently, held + outstanding did not foot to total_due.
 */
export function pendingRetentionOf(
  invoice: Pick<Invoice, 'subtotal' | 'retentionPercent' | 'retentionAmount' | 'retentionReleased'>,
): number {
  return pendingRetentionHeld(invoice);
}

/**
 * True while retention is still held on this invoice. Independent of
 * paid/settled: a settled invoice can have retention open until closeout,
 * which is exactly the state getEffectiveInvoiceStatus() no longer hides
 * behind 'partially_paid'.
 */
export function retentionOpen(
  invoice: Pick<Invoice, 'subtotal' | 'retentionPercent' | 'retentionAmount' | 'retentionReleased'>,
): boolean {
  return pendingRetentionOf(invoice) > 0;
}

/**
 * Unbilled = contract value – invoiced. Work not yet turned into invoices.
 */
export function getUnbilledValue(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): number {
  const contractValue = getContractValue(project, changeOrders);
  const billed = getInvoicedToDate(invoices);
  return Math.max(0, contractValue - billed);
}

/**
 * Effective invoice status — computed rather than stored, because a stored
 * `status = 'sent'` invoice is actually overdue once its due date passes but
 * nobody's running a cron to mutate the record. Use this anywhere you render
 * a status badge so the UI always reflects reality.
 */
export function getEffectiveInvoiceStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === 'draft') return 'draft';
  // A stored 'paid' is trusted only while nothing is collectible. Releasing
  // retention on a settled invoice (or a legacy row whose status was flipped
  // without the money) reopens a balance, and a short-circuit here hid that
  // balance from cash-flow, the portal and the invoice screen — the released
  // $10,000 could never be billed or recorded (review of B3a, 2026-09-05).
  // The money rules below decide instead, so such rows heal on read.
  const settled = invoiceIsSettled(invoice);
  if (invoice.status === 'paid' && invoiceOutstanding(invoice) <= 0.01) return 'paid';
  // MONEY-F5: "paid" means everything collectible TODAY has been paid — net of
  // the retention the contract lets the client hold. Before this, a $100k
  // invoice holding $10k retention and paid down to the $90k asked for stayed
  // 'partially_paid' forever. Held retention is a separate fact: retentionOpen().
  if (invoice.totalDue > 0 && settled) return 'paid';
  if (invoice.amountPaid > 0 && !settled) return 'partially_paid';

  // A distrusted 'paid' (balance open, nothing paid) reads as 'sent' from here
  // on, so the overdue rule and the fallthrough never hand back 'paid'.
  const base: InvoiceStatus = invoice.status === 'paid' ? 'sent' : invoice.status;

  // Overdue check — 'sent' with a due date in the past.
  if (base === 'sent' && invoice.dueDate) {
    const dueTs = new Date(invoice.dueDate).getTime();
    if (!Number.isNaN(dueTs) && dueTs < Date.now()) return 'overdue';
  }
  return base;
}

/**
 * Days past due for an overdue invoice. Returns 0 if not overdue.
 */
export function getDaysPastDue(invoice: Invoice): number {
  const eff = getEffectiveInvoiceStatus(invoice);
  if (eff !== 'overdue') return 0;
  if (!invoice.dueDate) return 0;
  const dueTs = new Date(invoice.dueDate).getTime();
  if (Number.isNaN(dueTs)) return 0;
  const diffMs = Date.now() - dueTs;
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Percent complete by billing — how far through the contract has the GC billed?
 * Used in budget summary widgets and the client portal.
 */
export function getPercentBilled(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): number {
  const contractValue = getContractValue(project, changeOrders);
  if (contractValue <= 0) return 0;
  const billed = getInvoicedToDate(invoices);
  return Math.min(100, Math.round((billed / contractValue) * 100));
}

/**
 * Percent complete by cash — how much of the contract has actually been paid?
 */
export function getPercentPaid(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): number {
  const contractValue = getContractValue(project, changeOrders);
  if (contractValue <= 0) return 0;
  const paid = getPaidToDate(invoices);
  return Math.min(100, Math.round((paid / contractValue) * 100));
}

/**
 * Compact financial summary the UI layer can destructure.
 */
export interface ProjectFinancialSummary {
  baseContract: number;
  approvedChangeOrderTotal: number;
  pendingChangeOrderTotal: number;
  contractValue: number;
  invoiced: number;
  paidToDate: number;
  /** Collectible today, net of held retention (MONEY-F5). */
  outstanding: number;
  /** Retention still held on sent invoices — not due, not overdue. */
  retentionHeld: number;
  unbilled: number;
  pctBilled: number;
  pctPaid: number;
  hasOverdueInvoices: boolean;
  overdueAmount: number;
}

export function summarizeProjectFinancials(
  project: Project | null | undefined,
  changeOrders: ChangeOrder[] | null | undefined,
  invoices: Invoice[] | null | undefined,
): ProjectFinancialSummary {
  const baseContract = getBaseContractValue(project);
  const approvedCO = (changeOrders ?? [])
    .filter(co => co.status === 'approved')
    .reduce((sum, co) => sum + (co.changeAmount ?? 0), 0);
  const pendingCO = getPendingChangeOrderValue(changeOrders);
  const contractValue = baseContract + approvedCO;
  const invoiced = getInvoicedToDate(invoices);
  const paidToDate = getPaidToDate(invoices);
  const outstanding = getOutstandingBalance(invoices);
  const retentionHeld = getRetentionHeld(invoices);
  const unbilled = Math.max(0, contractValue - invoiced);

  const overdueInvoices = (invoices ?? []).filter(
    inv => getEffectiveInvoiceStatus(inv) === 'overdue',
  );
  const overdueAmount = overdueInvoices.reduce(
    (sum, inv) => sum + invoiceOutstanding(inv),
    0,
  );

  return {
    baseContract,
    approvedChangeOrderTotal: approvedCO,
    pendingChangeOrderTotal: pendingCO,
    contractValue,
    invoiced,
    paidToDate,
    outstanding,
    retentionHeld,
    unbilled,
    pctBilled: contractValue > 0 ? Math.min(100, Math.round((invoiced / contractValue) * 100)) : 0,
    pctPaid: contractValue > 0 ? Math.min(100, Math.round((paidToDate / contractValue) * 100)) : 0,
    hasOverdueInvoices: overdueInvoices.length > 0,
    overdueAmount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUYOUT SAVINGS — ONE NUMBER ON EVERY SCREEN (audit round 2, #5).
//
// The Award dialog and the bid cards show savings against the LEVELED total:
// budget − (bid + normalizedAdjustment), where the adjustment is the AI-priced
// scope that bid excludes (positive) or adds (negative). awardBidPackage
// (contexts/ProjectContext.tsx) stored budget − bid, so a framing bid of $38k
// that left out $3.2k of blocking and dumpster read "+$3,800" in the dialog he
// signed off on and "+$7,000" on the package hero and buyout.tsx's savings to
// date — $3,200 of savings that do not exist, because the awarded sub does not
// cover that scope and he still has to buy it.
//
// The commitment amount stays the bid (the subcontract is the subcontract);
// only the SAVINGS figure is leveled. It uses the same SIGNED adjustment the
// dialog does — a max(0, …) would make the two disagree again for a bid the
// AI priced as covering extra scope.
//
// Derived from the awarded bid rather than trusting the stored field, so
// packages awarded before the fix read correctly too; the stored figure is
// the fallback when the bid row is gone.
// ─────────────────────────────────────────────────────────────────────────────

const cents = (n: number) => Math.round(n * 100) / 100;

/** The leveled total of a bid: what this scope costs him with this sub. */
export function leveledBidTotal(bid: Pick<BidPackageBid, 'amount' | 'normalizedAdjustment'>): number {
  return cents(bid.amount + (bid.normalizedAdjustment ?? 0));
}

/** Buyout savings (negative = overrun) against the leveled total. */
export function leveledBuyoutSavings(
  estimateBudget: number,
  bid: Pick<BidPackageBid, 'amount' | 'normalizedAdjustment'>,
): number {
  return cents(estimateBudget - leveledBidTotal(bid));
}

/** Scope the awarded bid excludes that he still has to buy (0 when none). */
export function uncoveredScopeOf(bid: Pick<BidPackageBid, 'normalizedAdjustment'> | null | undefined): number {
  const adj = bid?.normalizedAdjustment ?? 0;
  return adj > 0 ? cents(adj) : 0;
}

/**
 * Excluded scope still OPEN once the commitment exists (leftovers review).
 * When the sub agrees to take the excluded scope and he edits the commitment
 * up (Job Costing's CommitmentEditor: $38,000 → $41,200), that increase IS
 * the excluded scope, bought. Levelling the full award-time adjustment on top
 * of the raised commitment subtracted it twice — every savings figure,
 * including the client PDF's "Bulk Savings", fell from $3,800 to $600, while
 * buying the same scope on a separate PO kept $3,800.
 *
 * The simplest provable rule: any rise of the commitment's BASE amount above
 * the awarded bid absorbs the positive adjustment first:
 *   open = max(0, adj − max(0, commitment.amount − bid.amount)).
 * What it gives up: a base-amount rise for some OTHER reason (a price
 * correction) is also read as absorbing the excluded scope, and scope folded
 * in through a sub CHANGE ORDER (changeAmount) is not — a CO is kept as extra
 * cost, as the round-3 fix intended. A negative adjustment is untouched.
 */
export function openExcludedScope(
  bid: Pick<BidPackageBid, 'amount' | 'normalizedAdjustment'> | null | undefined,
  commitmentAmount: number | null | undefined,
): number {
  const adj = uncoveredScopeOf(bid);
  if (adj <= 0 || !bid) return 0;
  // No commitment yet, or a bid row without a usable amount: nothing can be
  // shown absorbed, so the whole adjustment is open (the award-time figure).
  if (commitmentAmount == null || !Number.isFinite(bid.amount) || !Number.isFinite(commitmentAmount)) return adj;
  const absorbed = Math.max(0, cents(commitmentAmount - bid.amount));
  return cents(Math.max(0, adj - absorbed));
}

/** The package's awarded commitment row, or null. */
export function awardedCommitmentOf<C extends Pick<Commitment, 'id'>>(
  pkg: Pick<BidPackage, 'awardedCommitmentId'>,
  commitments: ReadonlyArray<C> | undefined,
): C | null {
  if (!commitments || !pkg.awardedCommitmentId) return null;
  return commitments.find(x => x.id === pkg.awardedCommitmentId) ?? null;
}

/**
 * What the awarded sub actually costs him now: the signed commitment plus its
 * change orders. Null when the package's commitment cannot be found. Shared by
 * the buyout screens and utils/bulkSavings so an edited commitment or a sub CO
 * moves every savings figure together — they used to level off bid.amount on
 * one side and commitment + changeAmount on the other, so after a $1,500 sub
 * CO the buyout screen said $3,800 saved and the client's PDF said $2,300.
 */
export function awardedCommitmentCost(
  pkg: Pick<BidPackage, 'awardedCommitmentId'>,
  commitments: ReadonlyArray<Pick<Commitment, 'id' | 'amount' | 'changeAmount'>> | undefined,
): number | null {
  if (!commitments || !pkg.awardedCommitmentId) return null;
  const c = commitments.find(x => x.id === pkg.awardedCommitmentId);
  return c ? cents(c.amount + (c.changeAmount ?? 0)) : null;
}

/** Savings shown for an awarded package, or null when not awarded. Levels off
 *  the signed commitment (+ its COs) when `commitments` can resolve it, else
 *  off the awarded bid — the Award dialog's figure before a commitment exists. */
export function packageBuyoutSavings(
  pkg: Pick<BidPackage, 'status' | 'estimateBudget' | 'buyoutSavings' | 'awardedBidId' | 'awardedCommitmentId'>,
  bids: ReadonlyArray<Pick<BidPackageBid, 'id' | 'amount' | 'normalizedAdjustment'>>,
  commitments?: ReadonlyArray<Pick<Commitment, 'id' | 'amount' | 'changeAmount'>>,
): number | null {
  if (pkg.status !== 'awarded') return null;
  const awarded = pkg.awardedBidId ? bids.find(b => b.id === pkg.awardedBidId) : undefined;
  const signed = awardedCommitmentCost(pkg, commitments);
  if (signed != null) {
    // A positive adjustment levels only the part the commitment has not
    // already absorbed (openExcludedScope); a negative one keeps its sign.
    const adj = awarded?.normalizedAdjustment ?? 0;
    const levelBy = adj > 0 ? openExcludedScope(awarded, awardedCommitmentOf(pkg, commitments)?.amount) : adj;
    return cents(pkg.estimateBudget - cents(signed + levelBy));
  }
  if (awarded && awarded.amount > 0) return leveledBuyoutSavings(pkg.estimateBudget, awarded);
  return pkg.buyoutSavings ?? null;
}
