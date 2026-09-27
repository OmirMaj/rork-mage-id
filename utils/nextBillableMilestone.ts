// ============================================================================
// utils/nextBillableMilestone.ts — the money chain's "what gets billed or
// chased next" (UX wave, Lane C).
//
// Every document should hand him the next one: estimate → proposal →
// deposit → change order → draw → sub pay → waiver → final bill. The screens
// that offer those next steps (the job page's NextStepHero, the payments
// list, the waiver form) all need the same small decisions, so they live here
// once, pure, and scripts/validate-ux-money-chain.ts drives every branch
// under bun.
//
// THE RULE THIS FILE KEEPS: it never derives a dollar of its own. Every
// amount comes from the helper that already owns it —
//   milestone amounts   billingFlowCore.milestoneBillability / milestoneBillEffect
//                       (the same pair contract.tsx's "Create invoice" row runs);
//   change orders       changeOrderBilling.changeOrderBillingState;
//   invoice balances    invoiceBilling.invoiceOutstanding (via the callers);
//   a waiver amount     the commitment's own recorded paidToDate, or nothing.
// A figure that is not on file is not guessed: the function returns null and
// the caller shows the existing card, a blank field, or asks.
//
// Sections:
//   1. nextBillableMilestone — the deposit (or, once the job is done, the
//      final) a SIGNED contract says is due and nobody has billed (C3);
//   2. chain states for NextStepHero (C3): estimate not sent, CO approved
//      and unbilled, sub paid with no waiver;
//   3. overdue invoices and the "Remind all" confirm (C2);
//   4. the waiver form's "From this job's subs" picker (C7);
//   5. estimate → proposal: the revision "Send proposal" names, and the
//      wizard's one-tap landing (C4).
// ============================================================================

import type { ChangeOrder, Commitment, Invoice, PaymentMilestone, Project, ProjectContract, Subcontractor } from '@/types';
import {
  attributableContractBilling,
  daysOverdue,
  milestoneBillability,
  milestoneBillEffect,
  reminderRecipient,
  reminderSentLabel,
} from '@/utils/billingFlowCore';
import { changeOrderBillingState } from '@/utils/changeOrderBilling';
import { snapshotPatch } from '@/utils/estimateCommit';
import { resolveClientContact } from '@/utils/clientContact';
import { formatMoney } from '@/utils/formatters';
import { invoiceForMilestoneHref } from '@/utils/uxRoutes';
import { isSampleProject } from '@/utils/sampleGuard';

/** Dollars as the GC reads them: whole dollars when whole, cents when not.
 *  A label that rounds $4,500.50 to "$4,501" would disagree with the invoice
 *  it opens. */
export function moneyLabel(n: number): string {
  const cents = Math.round(n * 100);
  return formatMoney(cents / 100, cents % 100 === 0 ? 0 : 2);
}

// ── 1. The next billable milestone ─────────────────────────────────────────

type ContractLike = Pick<ProjectContract, 'id' | 'projectId' | 'status' | 'contractValue' | 'paymentSchedule'> & { title?: string };
type InvoiceLike = Pick<Invoice, 'id' | 'status' | 'lineItems'> & Partial<Pick<Invoice, 'sourceMilestoneId' | 'type' | 'progressPercent'>>;

export type BillableMilestoneKind = 'deposit' | 'final';

export interface NextBillableMilestone {
  kind: BillableMilestoneKind;
  milestone: PaymentMilestone;
  /** milestoneBillability's amount — the contract's number, to the cent. */
  amount: number;
  /** "Bill deposit · $4,500" / "Bill final · $12,300.50". */
  label: string;
  /** Exactly the params contract.tsx's "Create invoice" row sends. */
  href: ReturnType<typeof invoiceForMilestoneHref>;
}

export interface NextBillableMilestoneInput {
  /** The job's active contract (project-detail's portalBadgeContract), or null. */
  contract: ContractLike | null | undefined;
  /** This job's invoices (every status: a draft carrying the milestone blocks it). */
  invoices: readonly InvoiceLike[];
  /**
   * Offer the FINAL row too. The caller passes true only when the job reads
   * done (schedule at 100% or status completed): "due at substantial
   * completion" is not something to offer the day after signing.
   */
  includeFinal?: boolean;
}

const KIND_BY_TRIGGER: Record<string, BillableMilestoneKind> = {
  on_signing: 'deposit',
  on_final: 'final',
};

/**
 * The first deposit (then, when asked, final) milestone a SIGNED contract
 * says is due and nobody has billed — or null. Composes the contract screen's
 * own decision: milestoneBillability (with the same linked-invoice and
 * attributable-billing inputs contract.tsx passes) then milestoneBillEffect;
 * only a `compose` effect is offered, so every refusal the contract screen
 * would give (already invoiced, contract full, zero amount, not signed) is a
 * null here.
 */
export function nextBillableMilestone(input: NextBillableMilestoneInput): NextBillableMilestone | null {
  const c = input.contract;
  if (!c || c.status !== 'signed' || !c.id) return null;
  const invoices = input.invoices ?? [];

  const linkedByMilestone = new Map<string, string[]>();
  for (const inv of invoices) {
    if (!inv.sourceMilestoneId) continue;
    const list = linkedByMilestone.get(inv.sourceMilestoneId) ?? [];
    list.push(inv.id);
    linkedByMilestone.set(inv.sourceMilestoneId, list);
  }
  const billed = attributableContractBilling(invoices as Parameters<typeof attributableContractBilling>[0]);

  const order: BillableMilestoneKind[] = input.includeFinal ? ['deposit', 'final'] : ['deposit'];
  for (const want of order) {
    for (const m of c.paymentSchedule ?? []) {
      if (KIND_BY_TRIGGER[m.trigger ?? ''] !== want) continue;
      const bill = milestoneBillability({
        milestone: m,
        contractValue: c.contractValue ?? 0,
        contractStatus: c.status,
        linkedInvoiceIds: linkedByMilestone.get(m.id),
        contractBilledToDate: billed,
      });
      const effect = milestoneBillEffect(bill, m, { contractValue: c.contractValue ?? 0, title: c.title });
      if (effect.kind !== 'compose') continue;
      return {
        kind: want,
        milestone: m,
        amount: bill.amount,
        label: `Bill ${want} · ${moneyLabel(bill.amount)}`,
        href: invoiceForMilestoneHref({
          projectId: c.projectId,
          contractId: c.id,
          milestoneId: effect.milestoneId,
          line: effect.line,
          note: effect.note,
          terms: effect.terms,
          trigger: m.trigger,
          depositNoRetainage: effect.depositNoRetainage,
        }),
      };
    }
  }
  return null;
}

// ── 2. Chain states for NextStepHero ───────────────────────────────────────

/**
 * "Estimate not sent": the job has an estimate with lines and the caller
 * FETCHED the contract and found none, or only a draft. `contract` undefined
 * means "not fetched" (Home) — never a reason to say anything.
 */
export function estimateNotSent(
  project: Pick<Project, 'linkedEstimate'>,
  contract: Pick<ProjectContract, 'status'> | null | undefined,
): boolean {
  if (contract === undefined) return false;
  const items = project.linkedEstimate?.items ?? [];
  if (items.length === 0) return false;
  return contract === null || contract.status === 'draft';
}

export interface UnbilledChangeOrder {
  co: Pick<ChangeOrder, 'id' | 'number' | 'projectId'>;
  remaining: number;
}

/**
 * Approved change orders with dollars nobody has put on an invoice. A CO an
 * unsent draft already carries is NOT offered (changeOrderBillingState's
 * pendingDraftNumber): the next step there is sending that draft, and a
 * second "Bill it" would make a second invoice. Oldest CO first.
 */
export function approvedUnbilledChangeOrders(
  changeOrders: readonly Pick<ChangeOrder, 'id' | 'number' | 'projectId' | 'status' | 'changeAmount'>[],
  invoices: Invoice[],
): UnbilledChangeOrder[] {
  const out: UnbilledChangeOrder[] = [];
  for (const co of changeOrders) {
    if (co.status !== 'approved') continue;
    const state = changeOrderBillingState(co.id, co.changeAmount ?? 0, invoices);
    if (state.kind !== 'billable' || state.pendingDraftNumber != null) continue;
    out.push({ co, remaining: state.remaining });
  }
  return out.sort((a, b) => (a.co.number ?? 0) - (b.co.number ?? 0));
}

/** A sub payment with no release on file, as the caller found it. */
export interface SubPaidNoWaiver {
  subName: string;
  amount: number;
  commitmentId?: string;
}

/** The ones worth a card: a real name and money that actually moved. */
export function subPaymentsMissingWaiver(rows: readonly SubPaidNoWaiver[] | null | undefined): SubPaidNoWaiver[] {
  return (rows ?? []).filter(r => (r.subName ?? '').trim().length > 0 && r.amount > 0);
}

// ── 3. Overdue invoices and "Remind all" ───────────────────────────────────

type OverdueInvoice = Pick<Invoice, 'id' | 'number' | 'projectId' | 'dueDate'> & {
  billToEmail?: string | null;
  billToName?: string | null;
  dunningStage?: number | null;
  dunningLastSentAt?: string | null;
};

export interface OverdueRemindRow {
  invoiceId: string;
  projectId: string;
  projectName: string;
  number: number;
  daysLate: number;
  /** Who invoice-dunning would email (reminderRecipient), or null. */
  recipient: string | null;
  /** The name the confirm prints: the resolved client, else the address,
   *  else "no email on file · <job>". */
  clientLabel: string;
  lastSentMs: number | null;
  /** "Reminder sent · Stage 2 · Nov 14", or null. */
  sentLabel: string | null;
  /** The job is shared WITH him (Project.myRole editor / viewer / field):
   *  billing that client is the owner's (invoiceRoleGate's collaborator rule),
   *  and invoice-dunning refuses him on ownership. No Remind on this row. */
  sharedJob: boolean;
}

/**
 * One row per invoice in `overdue` (the caller decides overdue with
 * getEffectiveInvoiceStatus — this file does not re-define it), most days
 * late first. The recipient is reminderRecipient's — the SAME order the
 * dunning function uses — and never invented: no address, `recipient: null`,
 * and the server answers `no_recipient` when he sends anyway. An invoice on a
 * sample job is left out: a reminder never goes out from a sample, so it must
 * not be counted in "Send N reminders".
 */
export function overdueRemindRows(
  overdue: readonly OverdueInvoice[],
  projects: readonly (Pick<Project, 'id' | 'name' | 'primaryContact' | 'clientPortal'> & { myRole?: Project['myRole'] })[],
  nowMs: number,
): OverdueRemindRow[] {
  const byId = new Map(projects.map(p => [p.id, p]));
  const rows: OverdueRemindRow[] = [];
  for (const inv of overdue) {
    const p = byId.get(inv.projectId);
    if (!p || isSampleProject(p)) continue;
    const dueMs = inv.dueDate ? new Date(inv.dueDate).getTime() : NaN;
    const recipient = reminderRecipient(inv.billToEmail, p.clientPortal?.invites ?? []);
    const contact = recipient
      ? resolveClientContact(p, { billToEmail: recipient, billToName: inv.billToName ?? null, need: 'email' })
      : null;
    const lastMs = inv.dunningLastSentAt ? new Date(inv.dunningLastSentAt).getTime() : NaN;
    const lastSentMs = Number.isFinite(lastMs) ? lastMs : null;
    rows.push({
      invoiceId: inv.id,
      projectId: p.id,
      projectName: p.name,
      number: inv.number,
      daysLate: daysOverdue(dueMs, nowMs),
      recipient,
      clientLabel: recipient ? (contact?.name || recipient) : `no email on file · ${p.name}`,
      lastSentMs,
      sentLabel: reminderSentLabel(inv.dunningStage ?? null, lastSentMs),
      sharedJob: p.myRole === 'editor' || p.myRole === 'viewer' || p.myRole === 'field',
    });
  }
  return rows.sort((a, b) => b.daysLate - a.daysLate || a.number - b.number);
}

/**
 * What a row's Remind button is, with the SAME gates the desktop dock's Remind
 * uses (DesktopActionRail actionFor): a job shared with him gets no button
 * ('hidden'); without the plan that sends invoices (change_orders_invoicing)
 * the button is shown locked and explains the plan ('locked'); otherwise it
 * sends. The server's invoice-dunning checks only ownership, so this is the
 * tier gate for this door.
 */
export type RemindGate = 'send' | 'locked' | 'hidden';
export function remindGate(row: Pick<OverdueRemindRow, 'sharedJob'>, canInvoice: boolean): RemindGate {
  if (row.sharedJob) return 'hidden';
  return canInvoice ? 'send' : 'locked';
}

/** The rows "Remind all" counts, confirms and sends: never a shared job's. */
export function remindAllRows(rows: readonly OverdueRemindRow[]): OverdueRemindRow[] {
  return rows.filter(r => !r.sharedJob);
}

/** The locked button's explanation (the dock's words for the same lock). */
export function remindLockedCopy(requiredTier: string): { title: string; message: string } {
  const plan = requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1);
  return {
    title: `Sending invoice reminders is on the ${plan} plan`,
    message: `Upgrade to send invoice reminders from here. The row still opens the invoice.`,
  };
}

/**
 * The ONE confirm "Remind all" asks: it names the count and the clients.
 * "Send 5 reminders to 4 clients?" + the list. Clients are counted by
 * recipient address (case-insensitive); rows with no address are named
 * separately so he knows before tapping that those will come back
 * "no client email on file".
 */
export function remindAllConfirm(rows: readonly OverdueRemindRow[]): { title: string; message: string; confirmLabel: string } {
  const n = rows.length;
  const clients = new Map<string, string>();
  const noEmail: string[] = [];
  for (const r of rows) {
    if (r.recipient) {
      const key = r.recipient.toLowerCase();
      if (!clients.has(key)) clients.set(key, r.clientLabel);
    } else {
      noEmail.push(`#${r.number}`);
    }
  }
  const c = clients.size;
  const title = c > 0
    ? `Send ${n} reminder${n === 1 ? '' : 's'} to ${c} client${c === 1 ? '' : 's'}?`
    : `Send ${n} reminder${n === 1 ? '' : 's'}?`;
  const lines: string[] = [];
  if (c > 0) lines.push([...clients.values()].join(', '));
  if (noEmail.length > 0) {
    lines.push(`No client email on file for invoice${noEmail.length === 1 ? '' : 's'} ${noEmail.join(', ')} — ${noEmail.length === 1 ? 'that one' : 'those'} will not go out.`);
  }
  lines.push('Each one follows the same rules as the invoice screen: nothing goes to a sample job, and anything sent in the last 24 hours waits.');
  return { title, message: lines.join('\n\n'), confirmLabel: `Send ${n}` };
}

/** The overdue card's first line: "21 days late · last reminded Nov 14". */
export function overdueCardLine(daysLate: number, lastSentMs: number | null | undefined): string {
  const days = `${daysLate} day${daysLate === 1 ? '' : 's'} late`;
  if (lastSentMs == null || !Number.isFinite(lastSentMs)) return `${days} · not reminded yet`;
  const when = new Date(lastSentMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${days} · last reminded ${when}`;
}

// ── 4. The waiver form's "From this job's subs" ────────────────────────────

export interface WaiverSubOption {
  /** The commitment the waiver is collected against. */
  commitmentId: string;
  /** The roster sub, when the commitment names one. */
  subCompanyId?: string;
  name: string;
  email?: string;
  /** The commitment's own recorded payments (paidToDate), or null when none. */
  recordedPaid: number | null;
  /** "SC-01 · Electrical rough + trim" — what the chip reads under the name. */
  detail: string;
}

/**
 * One option per SUBCONTRACT on this job (purchase orders are suppliers, not
 * lien-waiver subs). Name and email come from the roster sub when the
 * commitment names one, else the commitment's vendorName and no email —
 * never borrowed from another sub with a similar name.
 */
export function waiverSubOptions(
  commitments: readonly Pick<Commitment, 'id' | 'type' | 'number' | 'description' | 'vendorName' | 'subcontractorId' | 'paidToDate'>[],
  subs: readonly Pick<Subcontractor, 'id' | 'companyName' | 'email'>[],
): WaiverSubOption[] {
  const out: WaiverSubOption[] = [];
  for (const c of commitments) {
    if (c.type !== 'subcontract') continue;
    const sub = c.subcontractorId ? subs.find(s => s.id === c.subcontractorId) : undefined;
    const name = (sub?.companyName ?? c.vendorName ?? '').trim();
    if (!name) continue;
    const email = (sub?.email ?? '').trim();
    const paid = typeof c.paidToDate === 'number' && Number.isFinite(c.paidToDate) && c.paidToDate > 0 ? c.paidToDate : null;
    out.push({
      commitmentId: c.id,
      subCompanyId: sub?.id,
      name,
      email: email.includes('@') ? email : undefined,
      recordedPaid: paid,
      detail: [c.number, (c.description ?? '').trim()].filter(Boolean).join(' · '),
    });
  }
  return out;
}

/** The line under the amount box when he picks a sub. The amount box itself
 *  is NEVER filled from a pick, for any waiver type: every waiver form this
 *  app prints treats that figure as the check this release is for (CA "Amount
 *  of Check", FL "final payment in the amount of", TX/AZ "a check ... in the
 *  sum of"), and the job records only a running total paid, never a check. So
 *  `amount` is always null and he types the check; the recorded running total
 *  appears in the note only, labelled as a total across every payment. */
export function waiverAmountSeed(
  o: WaiverSubOption,
  waiverType: 'conditional_partial' | 'unconditional_partial' | 'conditional_final' | 'unconditional_final',
): { amount: null; note: string } {
  const isFinal = waiverType === 'conditional_final' || waiverType === 'unconditional_final';
  const ask = isFinal
    ? 'Enter the amount of the final check this lien waiver is for.'
    : 'Enter the amount of the check this lien waiver is for.';
  if (o.recordedPaid == null) {
    return { amount: null, note: `No payment is recorded against ${o.detail || o.name}. ${ask}` };
  }
  return {
    amount: null,
    note: `${moneyLabel(o.recordedPaid)} is recorded as paid to ${o.name} across every payment. ${ask}`,
  };
}

// ── 5. Estimate → proposal in a straight line (C4) ─────────────────────────

/**
 * What "Send proposal" does before it opens the contract: snapshot the
 * estimate ON SCREEN as a revision (snapshotPatch — a no-op when it already
 * duplicates the latest revision) and name that revision, so the contract
 * seeds from exactly this estimate. `fromRevision` is null only when the job
 * has no estimate at all (the contract then seeds its generic draft).
 */
export function proposalFromCurrentEstimate(
  project: Project | null | undefined,
): { patch: Partial<Project>; fromRevision: string | null } {
  if (!project?.linkedEstimate) return { patch: {}, fromRevision: null };
  const patch = snapshotPatch(project, 'manual');
  const versions = patch.estimateVersions ?? project.estimateVersions ?? [];
  const latest = versions[versions.length - 1];
  return { patch, fromRevision: latest?.id ?? null };
}

/** Why "Send proposal" is locked, when the plan has no client portal: the
 *  contract it opens is a client-portal feature (app/contract.tsx shows its
 *  Paywall). Said BEFORE anything is written, so a locked tap snapshots no
 *  revision. */
export function proposalLockedCopy(requiredTier: string): { title: string; message: string } {
  const plan = requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1);
  return {
    title: `Sending proposals is on the ${plan} plan`,
    message: 'Your estimate is saved. See plans to send it as a proposal your client can sign.',
  };
}

/** The contract route "Send proposal" opens. */
export function sendProposalHref(projectId: string, fromRevision: string | null) {
  return fromRevision
    ? { pathname: '/contract' as const, params: { projectId, fromRevision } }
    : { pathname: '/contract' as const, params: { projectId } };
}

/**
 * The wizard's one-tap landing (C4): with a job whose every REQUIRED step
 * already advances, it opens on "Here's what I know" (null); otherwise on the
 * first step that still needs an answer. `canAdvance` is scopeQuestions'
 * stepCanAdvance, passed in so this file does not own the step rules.
 */
export function wizardLandingStep<A>(
  answers: A,
  totalSteps: number,
  canAdvance: (step: number, a: A) => boolean,
): number | null {
  for (let i = 0; i < totalSteps; i++) if (!canAdvance(i, answers)) return i;
  return null;
}
