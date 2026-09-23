// utils/commitmentLinking.ts — which commitments a bill can be booked against,
// and who each one is WITH. Shared by the two AP doors (wave 5, #63).
//
// app/material-receipt.tsx built this inline: the non-draft purchase orders and
// subcontracts on the job, named by `vendorName` or — for a subcontract saved
// before job-costing stamped the sub's name into vendorName — the roster's
// companyName. app/scan.tsx had no such list, so a sub's bill scanned through
// Scan Anything was booked as UNLINKED direct cost and counted twice (once as
// cost, once more as the subcontract's remaining exposure). Scan now uses this
// module; material-receipt.tsx still carries its own copy of the same two
// rules (it belongs to another lane this wave) — keep them identical, and
// switch it over when that file is next open.
//
// Pure (types only) so scripts/validate-w5-scan-files-*.ts runs it under bun.

import type { Commitment, Subcontractor } from '@/types';
import { matchCommitmentByVendor } from '@/utils/scanRouting';

/**
 * Commitments a bill can pay down. Drafts are excluded: computeJobCost filters
 * them out of the project's commitments, so a receipt linked to one resolves
 * to no commitment there and silently falls back to direct cost.
 */
export function linkableCommitments(commitments: readonly Commitment[], projectId: string): Commitment[] {
  if (!projectId) return [];
  return commitments.filter(c => c.projectId === projectId
    && c.status !== 'draft'
    && (c.type === 'purchase_order' || c.type === 'subcontract'));
}

/** Who a commitment is WITH: the PO's vendorName, else the sub's companyName. */
export function commitmentCounterparty(c: Commitment, subcontractors: readonly Subcontractor[]): string {
  if (c.vendorName?.trim()) return c.vendorName.trim();
  const sub = c.subcontractorId ? subcontractors.find(x => x.id === c.subcontractorId) : undefined;
  return sub?.companyName?.trim() || '';
}

/** A short chip label: number (or description), then the counterparty. */
export function commitmentChipLabel(c: Commitment, subcontractors: readonly Subcontractor[]): string {
  const head = c.number || c.description || (c.type === 'subcontract' ? 'Subcontract' : 'PO');
  const who = commitmentCounterparty(c, subcontractors);
  return who ? `${head} · ${who}` : head;
}

/**
 * The one commitment a bill from `vendor` unambiguously belongs to, or
 * undefined (blank vendor, no match, or two commitments with the same name —
 * utils/scanRouting.matchCommitmentByVendor refuses to guess between them).
 */
export function autoLinkCommitment(
  vendor: string | null | undefined,
  linkable: readonly Commitment[],
  subcontractors: readonly Subcontractor[],
): string | undefined {
  return matchCommitmentByVendor(
    vendor,
    linkable.map(c => ({ id: c.id, counterparty: commitmentCounterparty(c, subcontractors) })),
  );
}
