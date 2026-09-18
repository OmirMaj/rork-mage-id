// handoverWaivers — which of a job's commitments have a signed lien waiver, for
// the "Lien waivers collected" row on app/handover.tsx. Pure, pinned by
// scripts/validate-handover-waivers.ts.
//
// WHY (audit round 2, #22). Handover put `w.subCompanyId ?? w.subName` into a
// set and then asked it for `c.companyId` (a field Commitment does not have)
// or `c.vendorName` (the company NAME). Every waiver the app itself creates
// stores the sub's ID in subCompanyId — the sub-portal "Collect lien waiver"
// CTA and the invoice prefill in lien-waivers.tsx both do — so no app-made
// waiver could ever mark a commitment covered; only a hand-typed name that
// matched vendorName character for character could. With every sub signed,
// the row still said "3 of 3 subs have a signed waiver" in amber and "Ready to
// hand over" was unreachable.
//
// Matching, most exact first:
//   1. w.commitmentId === c.id           (both prefill paths save it) — and a
//      waiver that names a commitment matches nothing else
//   2. w.subCompanyId === c.subcontractorId
//   3. trimmed, case-insensitive w.subName === c.vendorName (hand-typed waivers)

export interface WaiverLike {
  status?: string;
  commitmentId?: string | null;
  subCompanyId?: string | null;
  subName?: string | null;
}

export interface CommitmentLike {
  id: string;
  status?: string;
  subcontractorId?: string | null;
  vendorName?: string | null;
}

/** A waiver the GC has in hand. 'requested'/'draft' do not count. */
export function waiverCounts(w: WaiverLike): boolean {
  return w.status === 'signed' || w.status === 'received';
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

export function commitmentHasWaiver(c: CommitmentLike, waivers: readonly WaiverLike[]): boolean {
  const vendor = norm(c.vendorName);
  return waivers.some((w) => {
    if (!waiverCounts(w)) return false;
    // A waiver tied to a commitment covers THAT commitment only. A sub with
    // two POs signs one waiver per PO; matching the second on the sub id
    // alone let the first PO's waiver mark both collected.
    if (w.commitmentId) return w.commitmentId === c.id;
    if (w.subCompanyId && c.subcontractorId && w.subCompanyId === c.subcontractorId) return true;
    return !!vendor && norm(w.subName) === vendor;
  });
}

export interface WaiverCoverage {
  /** Non-draft commitments — the ones a waiver is owed for. */
  total: number;
  /** Of those, how many have a signed / received waiver. */
  covered: number;
  status: 'done' | 'partial' | 'open';
}

export function lienWaiverCoverage(
  commitments: readonly CommitmentLike[],
  waivers: readonly WaiverLike[],
): WaiverCoverage {
  const active = commitments.filter((c) => c.status !== 'draft');
  const covered = active.filter((c) => commitmentHasWaiver(c, waivers)).length;
  const total = active.length;
  const status: WaiverCoverage['status'] =
    total === 0 ? 'open'
    : covered === total ? 'done'
    : covered > 0 ? 'partial'
    : 'open';
  return { total, covered, status };
}
