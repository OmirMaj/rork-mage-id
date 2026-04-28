// contractEngine — pure data + Supabase helpers for the project contract
// flow. The contract is the formal scope-of-work + payment-schedule
// agreement between the GC and the homeowner. We persist it in the
// project_contracts table (RLS-scoped to the GC user; visible to anon
// portal viewers when status >= sent).

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { generateUUID } from './generateId';
import type {
  ProjectContract, PaymentMilestone, ContractAllowance,
  ContractSignature, ContractStatus,
  Project,
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

const DEFAULT_WARRANTY = `
The Contractor warrants the workmanship of the project for one (1) year from the date of substantial completion. Defects in workmanship reported in writing during the warranty period will be corrected at no additional cost.

Materials and appliances are covered by their respective manufacturer warranties, which pass through to the Owner. The Contractor will provide warranty documentation in the closeout binder.

This warranty does not cover damage from normal wear and tear, neglect, abuse, modifications by others, or acts of God.
`.trim();

// Default payment schedule the GC can edit. Sane construction defaults:
// 25% deposit, 25% at substantial framing/rough-in, 25% at finishes,
// 25% at substantial completion (with retainage held).
export function defaultPaymentSchedule(contractValue: number): PaymentMilestone[] {
  const v = (pct: number) => Math.round(contractValue * pct);
  return [
    { id: generateUUID(), label: 'Deposit (signing)',          trigger: 'on_signing',  amount: v(0.25), percent: 25, status: 'pending' },
    { id: generateUUID(), label: 'Rough-in / framing complete', trigger: 'on_milestone', triggerMilestone: 'Rough-in / framing complete', amount: v(0.25), percent: 25, status: 'pending' },
    { id: generateUUID(), label: 'Finishes complete',           trigger: 'on_milestone', triggerMilestone: 'Finishes complete',           amount: v(0.25), percent: 25, status: 'pending' },
    { id: generateUUID(), label: 'Substantial completion',      trigger: 'on_final',                                                         amount: v(0.25), percent: 25, status: 'pending' },
  ];
}

// Build a starter contract pre-filled from a project + (optionally) the
// awarded bid response. Caller can edit any field before saving.
export interface DraftContractInput {
  project: Project;
  contractValue?: number;
  scopeText?: string;
  sourceBidId?: string;
  sourceResponseId?: string;
}
export function buildDraftContract(input: DraftContractInput): Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt' | 'userId'> {
  const value = input.contractValue
    ?? input.project.linkedEstimate?.grandTotal
    ?? input.project.estimate?.grandTotal
    ?? 0;
  return {
    projectId: input.project.id,
    sourceBidId: input.sourceBidId,
    sourceResponseId: input.sourceResponseId,
    version: 1,
    title: `${input.project.name} — Construction Agreement`,
    contractValue: value,
    startDate: undefined,
    durationDays: undefined,
    scopeText: input.scopeText ?? input.project.description ?? '',
    termsText: DEFAULT_TERMS,
    warrantyText: DEFAULT_WARRANTY,
    paymentSchedule: defaultPaymentSchedule(value),
    allowances: [],
    status: 'draft',
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

export async function fetchActiveContract(projectId: string): Promise<ProjectContract | null> {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase
    .from('project_contracts')
    .select('*')
    .eq('project_id', projectId)
    .is('superseded_by', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToContract(data as ProjectContractRow);
}

export async function saveContract(c: Omit<ProjectContract, 'id' | 'createdAt' | 'updatedAt' | 'userId'> & { id?: string }): Promise<ProjectContract | null> {
  if (!isSupabaseConfigured) return null;
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user?.id;
  if (!userId) {
    console.warn('[contractEngine] saveContract: no session');
    return null;
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
  };

  const { data, error } = await supabase
    .from('project_contracts')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .maybeSingle();
  if (error || !data) {
    console.warn('[contractEngine] save error:', error?.message);
    return null;
  }
  return rowToContract(data as ProjectContractRow);
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
