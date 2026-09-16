// tradeContacts — the one place a commitment is turned into a contact the
// client can actually dial.
//
// WHY THIS MODULE EXISTS (and why it is not a private helper in one renderer).
//
// The closeout binder's "Trade contacts" table declared its columns as
// Company / Scope / Phone / Email, and its row builder emitted vendorName,
// scope, PHASE and `fmtMoney(amount + changeAmount)`. So the column headed
// "Phone" printed a construction phase and the column headed "Email" printed
// each subcontractor's full contract value including approved change orders —
// in the PDF the GC hands the owner or the tenant at closeout. Subtract that
// column from the contract sum and you have read his margin, line by line, and
// once that PDF is in somebody's inbox there is no recall: re-delivering the
// binder locks its content, it does not un-send the copy already downloaded.
// Typecheck could never see it, because every cell in that table is a string.
//
// The second half of the same bug: the section exists so the owner can call the
// tile guy in two years instead of calling the GC, and it contained no way to
// call anybody — the builder only ever touched `Commitment` and never resolved
// the subcontractor behind it.
//
// The resolve itself already existed twice (utils/passport/buildHomePassport.ts
// builds a subsById map for exactly this), and the client portal's
// `tradeContacts` block declared phone/email slots it hardcoded to `undefined`.
// So the fix is one shared resolver rather than one corrected renderer:
// otherwise the PDF gets fixed and the portal — the surface the owner actually
// opens two years later — keeps rendering blank contact cells, and the bug
// moves instead of closing.
//
// This module is deliberately dependency-free (types only). The binder engine
// imports expo-print; portalSnapshot must never pull that in, so the shared
// code lives here and not in either renderer.

import type { Commitment, Subcontractor } from '@/types';

/** One row of a client-facing "Trade contacts" table. Money is not a field
 *  here and must not become one — see the header. */
export interface TradeContact {
  /** The sub's registered company name when we have the sub record, else the
   *  free-text vendor name off the commitment. */
  company: string;
  /** What they did — the commitment's description, falling back to its type. */
  scope?: string;
  /** Construction phase. Kept because it is genuinely useful to an owner
   *  ("who did the rough-in?"), but it has its OWN column; it must never be
   *  printed under a header that promises something else. */
  phase?: string;
  phone?: string;
  email?: string;
  /**
   * False when the commitment carries no `subcontractorId`, or carries one we
   * could not resolve to a Subcontractor record. Callers render the phone and
   * email cells BLANK in that case rather than substituting another field, so
   * an empty cell reads honestly as "we never captured it" instead of silently
   * shifting a column — which is how the margin leak happened in the first
   * place. It is also the flag a UI uses to explain a missing contact.
   */
  hasSubRecord: boolean;
}

/**
 * Resolve the trade contacts for a client-facing closeout surface.
 *
 * Scoping rules, each of which is load-bearing:
 *
 *  • `type === 'subcontract'` only. A purchase-order commitment carries no
 *    `subcontractorId` by construction (job-costing.tsx creates POs with a
 *    vendor name and nothing else), so including them would print a supplier
 *    name beside three blank cells in a table headed "Trade contacts".
 *  • `status !== 'draft'`. A draft commitment is a sub the GC is still thinking
 *    about; it does not belong in the client's record of who worked on the job.
 *  • `subcontractorId` is the ONLY key. `Commitment` declares no `companyId`
 *    (types/index.ts) — app/lien-waivers.tsx only reaches for one through an
 *    `as any`, which is a read of a field the type does not have.
 *
 * Sorted by company name so the same binder regenerated tomorrow lists the
 * subs in the same order.
 */
export function resolveTradeContacts(
  commitments: Commitment[] | undefined,
  subcontractors: Subcontractor[] | undefined,
  projectId?: string,
): TradeContact[] {
  const subsById = new Map((subcontractors ?? []).map(s => [s.id, s]));
  return (commitments ?? [])
    .filter(c => c.status !== 'draft' && c.type === 'subcontract')
    .filter(c => (projectId ? c.projectId === projectId : true))
    .map<TradeContact>(c => {
      const sub = c.subcontractorId ? subsById.get(c.subcontractorId) : undefined;
      return {
        company: (sub?.companyName || c.vendorName || 'Subcontractor').trim(),
        scope: (c.description || c.type || '').trim() || undefined,
        phase: c.phase?.trim() || undefined,
        // Empty strings are normalised away so a sub record with a blank phone
        // reads the same as a sub we never linked: nothing printed.
        phone: sub?.phone?.trim() || undefined,
        email: sub?.email?.trim() || undefined,
        hasSubRecord: !!sub,
      };
    })
    .sort((a, b) => a.company.localeCompare(b.company));
}
