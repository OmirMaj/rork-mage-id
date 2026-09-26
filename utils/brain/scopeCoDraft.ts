// utils/brain/scopeCoDraft.ts — the shared draft-CO builder for scope that is
// NOT in the contract yet (Scope Code Gaps, the RFI scope check). Modelled on
// utils/brain/leakCoDraft.ts buildDraftCO.
//
// G8: the builder NEVER sends and never changes status — every CO it builds is
// a 'draft' the contractor opens, prices and sends himself with a tap.
//
// MONEY IN INTEGER CENTS: each line's unit price is rounded to the cent once,
// the line total is quantity × unit cents rounded once, and changeAmount is
// the sum of those line cents, so Σ line cents === changeAmount cents exactly.
//
// A rate here is his COST rate (the learned price book), so unitCost is
// recorded equal to unitPrice: the CO screen then reports the true zero margin
// and asks for markup instead of pretending a margin exists.
//
// CLIENT-FACING: description and reason go into the email, the portal and the
// e-sign record (#76). Callers pass neutral wording; any internal rationale
// goes in `internalNote`, which lands only in an 'internal_note' audit entry.
//
// Pure — no React, no storage, no network.
import type { ChangeOrder, ChangeOrderLineItem, ChangeOrderStatus, Project } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { nextChangeOrderNumber } from '@/utils/coNumbering';

export const RFI_DRAFT_ACTION = 'drafted_from_rfi';
export const CODE_GAP_DRAFT_ACTION = 'drafted_from_code_gap';

/** Integer cents; a non-finite number is 0, never NaN. */
export function toCents(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export interface ScopeCoLine { name: string; quantity: number; unit: string; unitRate: number | null; csiDivision?: string }

export interface ScopeCoDraftInput {
  project: Pick<Project, 'id' | 'linkedEstimate' | 'estimate'>;
  existingCOs: readonly ChangeOrder[];
  lines: readonly ScopeCoLine[];
  description: string;
  reason: string;
  marker: { action: string; detail: string };
  internalNote?: string;
  nowISO: string;
}

export function buildScopeCoDraft(input: ScopeCoDraftInput): ChangeOrder {
  const { project, existingCOs, lines, description, reason, marker, internalNote, nowISO } = input;

  let sumCents = 0;
  const lineItems: ChangeOrderLineItem[] = lines.map(l => {
    if (typeof l.quantity !== 'number' || !Number.isFinite(l.quantity) || l.quantity <= 0) {
      throw new Error(`buildScopeCoDraft: line "${l.name}" needs a real quantity (got ${String(l.quantity)})`);
    }
    const name = (l.name ?? '').trim().slice(0, 120);
    const unit = (l.unit ?? '').trim() || 'ls';
    const base = { id: generateUUID(), name, description: '', quantity: l.quantity, unit, isNew: true,
      ...(l.csiDivision ? { csiDivision: l.csiDivision } : {}) };
    if (l.unitRate == null || !Number.isFinite(l.unitRate) || l.unitRate <= 0) {
      return { ...base, unitPrice: 0, total: 0, priceSource: 'needs_price' as const };
    }
    const unitPriceCents = toCents(l.unitRate);
    const totalCents = Math.round(l.quantity * unitPriceCents);
    sumCents += totalCents;
    const unitPrice = unitPriceCents / 100;
    return { ...base, unitPrice, unitCost: unitPrice, total: totalCents / 100, priceSource: 'ai_estimated' as const };
  });

  const changeAmount = sumCents / 100;
  const baseContract = project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0;
  const approvedCOs = existingCOs
    .filter(c => c.status === 'approved')
    .reduce((s, c) => s + (Number.isFinite(c.changeAmount) ? c.changeAmount : 0), 0);
  const originalContractValue = baseContract + approvedCOs;
  const newContractTotal = (toCents(originalContractValue) + sumCents) / 100;

  const auditTrail: NonNullable<ChangeOrder['auditTrail']> = [
    { id: generateUUID(), action: marker.action, actor: 'MAGE', timestamp: nowISO, detail: marker.detail },
  ];
  if (internalNote) {
    auditTrail.push({ id: generateUUID(), action: 'internal_note', actor: 'MAGE', timestamp: nowISO, detail: internalNote });
  }

  return {
    id: generateUUID(),
    number: nextChangeOrderNumber(existingCOs),
    projectId: project.id,
    date: nowISO,
    description,
    reason,
    lineItems,
    originalContractValue,
    changeAmount,
    newContractTotal,
    status: 'draft' as ChangeOrderStatus,
    auditTrail,
    createdAt: nowISO,
    updatedAt: nowISO,
  };
}

/** The first CO carrying this exact marker (action AND detail), or null. */
export function findScopeDraft(
  cos: readonly ChangeOrder[],
  marker: { action: string; detail: string },
): ChangeOrder | null {
  return cos.find(co => (co.auditTrail ?? []).some(e => e.action === marker.action && e.detail === marker.detail)) ?? null;
}
