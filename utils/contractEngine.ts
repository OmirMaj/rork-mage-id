// contractEngine — pure data + Supabase helpers for the project contract
// flow. The contract is the formal scope-of-work + payment-schedule
// agreement between the GC and the homeowner. We persist it in the
// project_contracts table (RLS-scoped to the GC user; visible to anon
// portal viewers when status >= sent).

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
// DIRECTION B ("ask when it matters"): the payment schedule and the warranty
// period a new contract prints are the GC's own answers, resolved by
// utils/paymentTerms.ts — the one place a split becomes milestones and a month
// count becomes a warranty sentence. This file keeps no literal of either.
import { contractScheduleFromSplit, contractWarrantyText } from '@/utils/paymentTerms';
// CONTRACT-TIME-1: the timeline arithmetic lives in a react-native-free module
// so a guard can EXECUTE it (this file imports @/lib/supabase). See the
// re-export block below.
import { suggestContractTimeline } from '@/utils/contractTimelineCore';
import { recordHomeownerSignatureWith, type RecordSignatureOutcome } from '@/utils/contractSignatureCore';
import type {
  ProjectContract, PaymentMilestone, ContractAllowance,
  ContractSignature, ContractStatus,
  Project, EstimateRevision, PaymentSplit,
} from '@/types';

// Row shape from the DB — snake_case mirrors columns.
interface ProjectContractRow {
  id: string;
  project_id: string;
  user_id: string;
  source_bid_id: string | null;
  source_response_id: string | null;
  version: number;
  superseded_by: string | null;
  title: string;
  contract_value: number;
  start_date: string | null;
  duration_days: number | null;
  scope_text: string;
  terms_text: string;
  warranty_text: string;
  payment_schedule: PaymentMilestone[];
  allowances: ContractAllowance[];
  gc_signature: ContractSignature | null;
  homeowner_signature: ContractSignature | null;
  status: ContractStatus;
  sent_at: string | null;
  signed_at: string | null;
  voided_at: string | null;
  signed_pdf_url: string | null;
  document_hash?: string | null;
  proposal_revision_id?: string | null;
  kind?: string | null;
  created_at: string;
  updated_at: string;
}

function rowToContract(r: ProjectContractRow): ProjectContract {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    sourceBidId: r.source_bid_id ?? undefined,
    sourceResponseId: r.source_response_id ?? undefined,
    version: r.version,
    supersededBy: r.superseded_by ?? undefined,
    title: r.title,
    contractValue: Number(r.contract_value) || 0,
    startDate: r.start_date ?? undefined,
    durationDays: r.duration_days ?? undefined,
    scopeText: r.scope_text,
    termsText: r.terms_text,
    warrantyText: r.warranty_text,
    paymentSchedule: Array.isArray(r.payment_schedule) ? r.payment_schedule : [],
    allowances:      Array.isArray(r.allowances)       ? r.allowances       : [],
    gcSignature:        r.gc_signature        ?? undefined,
    homeownerSignature: r.homeowner_signature ?? undefined,
    status: r.status,
    sentAt:   r.sent_at   ?? undefined,
    signedAt: r.signed_at ?? undefined,
    voidedAt: r.voided_at ?? undefined,
    signedPdfUrl: r.signed_pdf_url ?? undefined,
    documentHash: r.document_hash ?? undefined,
    proposalRevisionId: r.proposal_revision_id ?? undefined,
    kind: r.kind === 'proposal' ? 'proposal' : r.kind === 'contract' ? 'contract' : undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── Default content seed ───────────────────────────────────────────

const DEFAULT_TERMS = `
1. SCOPE. The Contractor shall furnish all labor, materials, equipment, and services required to complete the work described in the Scope of Work above.

2. CONTRACT PRICE. The total contract price is the amount stated above. Changes in scope require a written, signed Change Order before work begins.

3. PAYMENT SCHEDULE. Payment is due per the schedule above. Late payments may accrue interest at the lesser of 1% per month or the maximum allowed by law.

4. PERMITS. The Contractor will pull required permits and arrange inspections. Permit fees are reimbursable unless included above.

5. INSURANCE. The Contractor maintains general liability and workers' compensation insurance and will provide proof on request.

6. SUBCONTRACTORS. The Contractor may engage qualified subcontractors and remains responsible for their work.

7. CHANGE ORDERS. Any change to scope, price, or timeline requires a written Change Order signed by both parties. Verbal changes are not binding.

8. WARRANTY. The Contractor warrants the work as described in the warranty section. Manufacturer warranties pass through to the Owner.

9. DISPUTE RESOLUTION. Disputes arising from this Agreement shall first be addressed by good-faith negotiation, then non-binding mediation, before any litigation.

10. ENTIRE AGREEMENT. This Agreement constitutes the entire agreement between the parties and supersedes all prior discussions.
`.trim();

// THE PAYMENT SCHEDULE AND THE WARRANTY ARE NOT SEEDED FROM A DEFAULT.
//
// Until 2026-09-17 this file seeded every new contract with 25 / 25 / 25 / 25
// (deposit, rough-in, finishes, completion) and a one-year workmanship
// warranty. Nobody chose either: the quick-estimate PDF printed 25 / 65 / 10
// and the portal proposal a 10% deposit for the same job, so a homeowner could
// hold three different deposits — and sign the one this file made up.
//
// A draft now carries the GC's own terms (`ContractTerms`, resolved by the
// caller from the job's portal stamp, then his profile). When he has never
// answered, the schedule is EMPTY and the warranty paragraph carries a visible
// placeholder; app/contract.tsx asks before Sign & send instead of printing a
// guess. scripts/validate-money-definitions.ts (CONTRACT-TERMS) pins that no
// seed percent or one-year warranty literal comes back here.
export interface ContractTerms {
  /** Deposit / progress / final, or null when he has not answered. */
  split: PaymentSplit | null;
  /** Workmanship warranty in months, or null when he has not answered. */
  warrantyMonths: number | null;
}

// ─── Contract timeline (start date + duration) ──────────────────────
//
// CONTRACT-TIME-1 — the arithmetic lives in utils/contractTimelineCore.ts so a
// guard can EXECUTE it: this file imports @/lib/supabase, and bun cannot parse
// a module that transitively pulls react-native. Re-exported here so the
// screen keeps one import for the whole contract domain.

export {
  contractTimeline, contractTimelineSentence, suggestContractTimeline,
  type ContractTimeline, type ContractTimelineSuggestion,
} from '@/utils/contractTimelineCore';

/** `{ startDate, durationDays }` from the project's schedule, or `{}`. */
function timelineSeed(project: Project): Pick<ProjectContract, 'startDate' | 'durationDays'> {
  const s = suggestContractTimeline(project);
  return s ? { startDate: s.startDate, durationDays: s.durationDays } : {};
}

// Build a starter contract pre-filled from a project + (optionally) the
// awarded bid response. Caller can edit any field before saving.
export interface DraftContractInput {
  project: Project;
  contractValue?: number;
  scopeText?: string;
  sourceBidId?: string;
  sourceResponseId?: string;
  /** Required, so no caller can fall back to a schedule nobody chose. */
  terms: ContractTerms;
}
export function buildDraftContract(input: DraftContractInput): Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt' | 'userId'> {
  const value = input.contractValue ?? effectiveEstimateTotal(input.project);
  const { split, warrantyMonths } = input.terms;
  return {
    projectId: input.project.id,
    sourceBidId: input.sourceBidId,
    sourceResponseId: input.sourceResponseId,
    version: 1,
    title: `${input.project.name} — Construction Agreement`,
    contractValue: value,
    // CONTRACT-TIME-1: seeded from the project's own schedule when it has one,
    // so the two halves of the app agree on when the job runs. Still undefined
    // when there is no schedule — the editor asks, and a blank beats a guess on
    // a document that binds the completion date.
    ...timelineSeed(input.project),
    scopeText: input.scopeText ?? input.project.description ?? '',
    termsText: DEFAULT_TERMS,
    warrantyText: contractWarrantyText(warrantyMonths),
    paymentSchedule: split ? contractScheduleFromSplit(value, split) : [],
    allowances: [],
    status: 'draft',
  };
}

// Build a proposal document pre-filled from a saved EstimateRevision.
// Returns a structurally-valid contract-draft shape so saveContract can
// persist it immediately. kind='proposal' distinguishes it from a signed
// construction agreement in the UI and portal.
export function buildProposalFromRevision(
  project: Project,
  revision: EstimateRevision,
  terms: ContractTerms,
): Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt' | 'userId'> {
  const value = revision.grandTotal ?? 0;
  const { split, warrantyMonths } = terms;

  // Build readable scope body from the revision's frozen line items.
  const items = revision.snapshot.items ?? [];
  let scopeText: string;
  if (items.length > 0) {
    const header = `${project.name} — Project Proposal (Estimate Rev ${revision.revNumber})`;
    const itemLines = items
      .map(item => {
        if (item.quantity != null && item.unit) {
          return `• ${item.name} — ${item.quantity} ${item.unit}`;
        }
        return `• ${item.name}`;
      })
      .join('\n');
    scopeText = [
      header,
      '',
      'SCOPE OF WORK',
      itemLines,
      '',
      `TOTAL PROPOSED PRICE: $${value.toLocaleString()}`,
      '',
      DEFAULT_TERMS,
      '',
      'ACCEPTANCE:',
      'By signing below, both parties accept this proposal as the binding agreement for the stated scope and price.',
    ].join('\n');
  } else {
    const header = `${project.name} — Project Proposal (Estimate Rev ${revision.revNumber})`;
    const fallbackScope = project.description ?? 'See attached estimate.';
    scopeText = [
      header,
      '',
      'SCOPE OF WORK',
      fallbackScope,
      '',
      `TOTAL PROPOSED PRICE: $${value.toLocaleString()}`,
      '',
      DEFAULT_TERMS,
      '',
      'ACCEPTANCE:',
      'By signing below, both parties accept this proposal as the binding agreement for the stated scope and price.',
    ].join('\n');
  }

  return {
    projectId: project.id,
    sourceBidId: undefined,
    sourceResponseId: undefined,
    version: 1,
    title: `${project.name} — Project Proposal`,
    contractValue: value,
    // CONTRACT-TIME-1 — same seed as buildDraftContract. A proposal that states
    // when the work runs is the one that gets signed.
    ...timelineSeed(project),
    scopeText,
    termsText: DEFAULT_TERMS,
    warrantyText: contractWarrantyText(warrantyMonths),
    paymentSchedule: split ? contractScheduleFromSplit(value, split) : [],
    allowances: [],
    status: 'draft',
    proposalRevisionId: revision.id,
    kind: 'proposal',
  };
}

// ─── Supabase helpers ───────────────────────────────────────────────

export async function fetchContractsForProject(projectId: string): Promise<ProjectContract[]> {
  if (!isSupabaseConfigured) return [];
  const { data, error } = await supabase
    .from('project_contracts')
    .select('*')
    .eq('project_id', projectId)
    .order('version', { ascending: false });
  if (error) {
    console.warn('[contractEngine] fetch error:', error.message);
    return [];
  }
  return (data ?? []).map(r => rowToContract(r as ProjectContractRow));
}

/**
 * The active contract read, with a failed read kept APART from "this job has
 * no contract". fetchActiveContract collapses both to null, and the contract
 * screen used to read that null as "seed a fresh draft": on a job site with no
 * signal a job with a signed contract showed a blank new Construction
 * Agreement, and signing it once back online inserted a SECOND version-1
 * contract — the homeowner got a second contract to sign and the billing
 * ledger could bill deposit milestones twice. Only `ok: true` with
 * `contract: null` means "no contract yet".
 */
export type ActiveContractLoad =
  | { ok: true; contract: ProjectContract | null }
  | { ok: false; error: string };

export async function loadActiveContract(projectId: string): Promise<ActiveContractLoad> {
  if (!isSupabaseConfigured) return { ok: false, error: 'MAGE is not configured on this build.' };
  try {
    const { data, error } = await supabase
      .from('project_contracts')
      .select('*')
      .eq('project_id', projectId)
      .is('superseded_by', null)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, contract: data ? rowToContract(data as ProjectContractRow) : null };
  } catch (err) {
    // supabase-js returns most failures as `error`, but a dead socket can throw.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Kept for the read-only callers (portal, project detail) that treat "could
 *  not read" and "none" alike. A screen that WRITES a contract must use
 *  loadActiveContract. */
export async function fetchActiveContract(projectId: string): Promise<ProjectContract | null> {
  const r = await loadActiveContract(projectId);
  return r.ok ? r.contract : null;
}

/** Why saveContractDetailed refused or failed. 'duplicate' = the job already
 *  has a live contract, so a row with no id would have been a second one. */
export type ContractSaveResult =
  | { ok: true; contract: ProjectContract }
  | { ok: false; reason: 'duplicate'; existing: ProjectContract }
  | { ok: false; reason: 'failed'; error: string };

/**
 * saveContract with the refusal spelled out. A save with no `id` is an INSERT
 * of a new contract, so it first re-reads the job's live contract (not
 * superseded, not void) and refuses if there is one — a draft seeded while the
 * first read failed must never become a second contract. The partial unique
 * index project_contracts_one_live_per_project (migration 20260918200000) is
 * the backstop for the race this read cannot close (two devices at once).
 */
export async function saveContractDetailed(c: Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt' | 'userId'> & { id?: string }): Promise<ContractSaveResult> {
  if (!c.id) {
    const live = await loadActiveContract(c.projectId);
    if (!live.ok) return { ok: false, reason: 'failed', error: live.error };
    if (live.contract && live.contract.status !== 'void') {
      return { ok: false, reason: 'duplicate', existing: live.contract };
    }
  }
  const saved = await writeContractRow(c);
  if ('error' in saved) {
    // The index refused it: another device inserted this job's contract
    // between our read and our write. Hand back the one that won.
    if (saved.code === '23505') {
      const live = await loadActiveContract(c.projectId);
      if (live.ok && live.contract) return { ok: false, reason: 'duplicate', existing: live.contract };
    }
    return { ok: false, reason: 'failed', error: saved.error };
  }
  return { ok: true, contract: saved.contract };
}

export async function saveContract(c: Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt' | 'userId'> & { id?: string }): Promise<ProjectContract | null> {
  const r = await writeContractRow(c);
  return 'error' in r ? null : r.contract;
}

async function writeContractRow(c: Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt' | 'userId'> & { id?: string }): Promise<{ contract: ProjectContract } | { error: string; code?: string }> {
  if (!isSupabaseConfigured) return { error: 'MAGE is not configured on this build.' };
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user?.id;
  if (!userId) {
    console.warn('[contractEngine] saveContract: no session');
    return { error: 'You are signed out.' };
  }

  const row = {
    id: c.id,
    project_id: c.projectId,
    user_id: userId,
    source_bid_id: c.sourceBidId ?? null,
    source_response_id: c.sourceResponseId ?? null,
    version: c.version,
    superseded_by: c.supersededBy ?? null,
    title: c.title,
    contract_value: c.contractValue,
    start_date: c.startDate ?? null,
    duration_days: c.durationDays ?? null,
    scope_text: c.scopeText,
    terms_text: c.termsText,
    warranty_text: c.warrantyText,
    payment_schedule: c.paymentSchedule,
    allowances: c.allowances,
    gc_signature:        c.gcSignature        ?? null,
    homeowner_signature: c.homeownerSignature ?? null,
    status: c.status,
    sent_at:   c.sentAt   ?? null,
    signed_at: c.signedAt ?? null,
    voided_at: c.voidedAt ?? null,
    signed_pdf_url: c.signedPdfUrl ?? null,
    proposal_revision_id: c.proposalRevisionId ?? null,
    kind: c.kind ?? null,
  };

  try {
    const { data, error } = await supabase
      .from('project_contracts')
      .upsert(row, { onConflict: 'id' })
      .select('*')
      .maybeSingle();
    if (error || !data) {
      console.warn('[contractEngine] save error:', error?.message);
      return { error: error?.message ?? 'The contract was not saved.', code: (error as { code?: string } | null)?.code };
    }
    return { contract: rowToContract(data as ProjectContractRow) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export async function setContractStatus(id: string, status: ContractStatus, extras?: { signedAt?: string; gcSignature?: ContractSignature; homeownerSignature?: ContractSignature; signedPdfUrl?: string }): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const patch: Record<string, unknown> = { status };
  if (status === 'sent')   patch.sent_at   = new Date().toISOString();
  if (status === 'signed') patch.signed_at = extras?.signedAt ?? new Date().toISOString();
  if (status === 'void')   patch.voided_at = new Date().toISOString();
  if (extras?.gcSignature)        patch.gc_signature        = extras.gcSignature;
  if (extras?.homeownerSignature) patch.homeowner_signature = extras.homeownerSignature;
  if (extras?.signedPdfUrl)       patch.signed_pdf_url      = extras.signedPdfUrl;
  const { error } = await supabase.from('project_contracts').update(patch).eq('id', id);
  if (error) {
    console.warn('[contractEngine] status error:', error.message);
    return false;
  }
  return true;
}

/**
 * #67 (wave 4): record a homeowner signature given OUTSIDE the portal — in
 * person on this device, or on paper. Rules and outcomes live in
 * utils/contractSignatureCore.ts (executed by a validator); this is the IO.
 * Deliberately NOT through the offline queue: the flip is conditional on the
 * live row still being 'sent' and unsigned, which only a live read can know,
 * so no signal is refused with a reason instead of queued.
 */
export async function recordHomeownerSignature(
  contractId: string,
  signature: ContractSignature,
): Promise<RecordSignatureOutcome> {
  if (!isSupabaseConfigured) return { kind: 'failed', error: 'Not connected to the server.' };
  return recordHomeownerSignatureWith({
    async readState(id) {
      const { data, error } = await supabase
        .from('project_contracts')
        .select('status,homeowner_signature')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as { status: ContractStatus; homeowner_signature: ContractSignature | null };
      return { status: row.status, homeownerSigned: !!row.homeowner_signature };
    },
    async flipIfStillSent(id, patch) {
      const { data, error } = await supabase
        .from('project_contracts')
        .update(patch)
        .eq('id', id)
        .eq('status', 'sent')
        .is('homeowner_signature', null)
        .select('id');
      if (error) throw error;
      return (data ?? []).length;
    },
  }, contractId, signature);
}

/**
 * #67: upload the photo of a paper-signed page to the private
 * `secure-contracts` bucket (owner-only RLS on the first path segment, the
 * same bucket the sealed PDF lives in). Returns the storage PATH — never a
 * URL, which would expire. Throws (a transport error included) so the caller
 * can refuse with the reason; upsert:false so evidence is never replaced.
 */
export async function uploadSignedPageEvidence(userId: string, contractId: string, fileUri: string): Promise<string> {
  const { readFileBytes } = await import('@/utils/fileBytes');
  const bytes = await readFileBytes(fileUri);
  const path = `${userId}/${contractId}-signed-page-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from('secure-contracts')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

/**
 * Flip ONE payment milestone to 'invoiced' after an invoice was actually
 * created from it.
 *
 * Called from the invoice editor the moment addInvoice() runs — never when the
 * GC merely taps "Create invoice", because backing out of the editor must
 * leave the milestone billable.
 *
 * Read-verify-write against the live row rather than patching whatever the
 * caller had in memory: the caller's copy of paymentSchedule is a snapshot
 * from before it navigated to the invoice screen, and blind-writing it would
 * clobber any other milestone that changed in between. If the milestone is no
 * longer 'pending' by the time we get here, another path already billed it —
 * report 'already' and let the caller warn instead of overwriting the link to
 * a different invoice.
 */
export async function markMilestoneInvoiced(
  contractId: string,
  milestoneId: string,
  invoiceId: string,
): Promise<'flipped' | 'already' | 'not_found' | 'failed'> {
  if (!isSupabaseConfigured) return 'failed';
  const { data, error } = await supabase
    .from('project_contracts')
    .select('id,payment_schedule')
    .eq('id', contractId)
    .maybeSingle();
  if (error || !data) {
    console.warn('[contractEngine] markMilestoneInvoiced: contract not found', contractId, error?.message);
    return 'not_found';
  }

  const schedule = ((data as { payment_schedule?: PaymentMilestone[] }).payment_schedule ?? []) as PaymentMilestone[];
  const target = schedule.find(m => m.id === milestoneId);
  if (!target) return 'not_found';
  // Idempotent: re-running for the SAME invoice is a success, not a conflict
  // (the app can retry after a dropped write). A DIFFERENT invoice id on an
  // already-billed milestone is the double-bill case and stays blocked.
  if (target.status !== 'pending' || target.invoiceId) {
    return target.invoiceId === invoiceId ? 'flipped' : 'already';
  }

  const next = schedule.map(m => m.id === milestoneId
    ? { ...m, status: 'invoiced' as const, invoiceId, invoicedAt: new Date().toISOString() }
    : m);

  const { error: updErr } = await supabase
    .from('project_contracts')
    .update({ payment_schedule: next })
    .eq('id', contractId);
  if (updErr) {
    console.warn('[contractEngine] markMilestoneInvoiced: write failed', updErr.message);
    return 'failed';
  }
  return 'flipped';
}

/**
 * The other half of markMilestoneInvoiced. Flip every milestone linked to an
 * invoice to 'paid' when that invoice is paid.
 *
 * Built-but-unreachable #7 / worth-doing #16 (audit 2026-09-07). The milestone
 * lifecycle stopped one step short: markMilestoneInvoiced wrote 'invoiced' and
 * nothing anywhere wrote 'paid' outside two dev seeders. So computeContractPaid
 * below always returned 0, and the two 'PAID' branches in app/contract.tsx
 * (:1087 and :1201) could never render. A GC whose homeowner has paid the
 * foundation draw still saw the milestone as merely billed, on the screen that
 * is supposed to tell him where the contract stands.
 *
 * Keyed on the milestone's stored invoiceId, which markMilestoneInvoiced put
 * there — not on amount or on order, either of which would match the wrong
 * draw once a change order splits a milestone.
 *
 * Same read-verify-write discipline as its sibling: read the live row rather
 * than patching a caller's snapshot, so a milestone that changed while the GC
 * was in the invoice editor is not clobbered. Idempotent — re-running on an
 * already-paid milestone reports success.
 *
 * WHO RETRIES (audit #136). A direct write, outside utils/offlineQueue on
 * purpose: queueing the whole payment_schedule array built from this read
 * would, on replay, overwrite any milestone edited in between — and offline
 * there is no live read to build it from. app/invoice.tsx's Record Payment
 * call is fire-and-forget and only TELLS him when it did not land. The retry
 * is app/contract.tsx: on open it derives PAID from the linked invoices
 * (billingFlowCore.milestonePaidFromInvoices, which also covers Pay-link
 * payments that never reach this function) and re-runs this for every row
 * the invoices say is paid and the stored status does not
 * (milestonePaidRepairs).
 */
export async function markMilestonePaidByInvoice(
  contractId: string,
  invoiceId: string,
): Promise<'flipped' | 'none' | 'not_found' | 'failed'> {
  if (!isSupabaseConfigured) return 'failed';
  const { data, error } = await supabase
    .from('project_contracts')
    .select('id,payment_schedule')
    .eq('id', contractId)
    .maybeSingle();
  if (error || !data) {
    console.warn('[contractEngine] markMilestonePaidByInvoice: contract not found', contractId, error?.message);
    return 'not_found';
  }

  const schedule = ((data as { payment_schedule?: PaymentMilestone[] }).payment_schedule ?? []) as PaymentMilestone[];
  const linked = schedule.filter(m => m.invoiceId === invoiceId);
  if (linked.length === 0) return 'none';
  // Already there — nothing to write, and reporting success keeps the caller's
  // retry path from treating a settled milestone as a failure.
  if (linked.every(m => m.status === 'paid')) return 'flipped';

  const next = schedule.map(m => m.invoiceId === invoiceId && m.status !== 'paid'
    ? { ...m, status: 'paid' as const, paidAt: new Date().toISOString() }
    : m);

  const { error: updErr } = await supabase
    .from('project_contracts')
    .update({ payment_schedule: next })
    .eq('id', contractId);
  if (updErr) {
    console.warn('[contractEngine] markMilestonePaidByInvoice: write failed', updErr.message);
    return 'failed';
  }
  return 'flipped';
}

// Compute the total of every paid milestone — useful for the contract
// header when the contract is partially executed.
export function computeContractPaid(contract: ProjectContract): number {
  return contract.paymentSchedule
    .filter(m => m.status === 'paid')
    .reduce((s, m) => s + (m.amount ?? 0), 0);
}

export function isFullySigned(contract: ProjectContract): boolean {
  return !!contract.gcSignature && !!contract.homeownerSignature && contract.status === 'signed';
}
