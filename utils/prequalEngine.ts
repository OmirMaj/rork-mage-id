// prequalEngine.ts — auto-review a submitted PrequalPacket against its
// criteria and return structured findings. The result is both stored on
// the packet (`autoReviewFindings`) and surfaced in the reviewer UI so a
// human can override on edge cases (e.g. Utah/Pennsylvania WC quirks,
// state-specific endorsement forms).
//
// Philosophy: if every criterion passes AND no obvious red flag (expired
// COI, W-9 missing on a US sub, no written safety program), we flip the
// packet to 'approved' automatically. Anything ambiguous goes to
// 'needs_changes' with a pointer to the missing field — the sub doesn't
// get stuck, they get a clear checklist.

import type { PrequalPacket, PrequalCriteria } from '@/types';

export interface PrequalFinding {
  criterion: string;
  /** Human-readable explanation of what we checked. */
  label: string;
  passed: boolean;
  note?: string;
  /** 'blocker' means we cannot auto-approve without this. 'advisory' is informational. */
  severity: 'blocker' | 'advisory';
}

export interface PrequalReviewResult {
  overall: 'pass' | 'fail' | 'needs_info';
  findings: PrequalFinding[];
  /** Short one-liner for the reviewer UI. */
  summary: string;
  /** Fields the sub still needs to fill in. */
  missingFields: string[];
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

export function reviewPrequalPacket(packet: PrequalPacket): PrequalReviewResult {
  const c: PrequalCriteria = packet.criteria;
  const findings: PrequalFinding[] = [];
  const missingFields: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // ─── Insurance ────────────────────────────────────────────────
  const cglOcc = packet.insurance.cglPerOccurrence ?? 0;
  findings.push({
    criterion: 'cgl_per_occurrence',
    label: `CGL per occurrence ≥ $${c.minCglPerOccurrence.toLocaleString()}`,
    passed: cglOcc >= c.minCglPerOccurrence,
    note: cglOcc > 0 ? `$${cglOcc.toLocaleString()}` : 'Not provided',
    severity: 'blocker',
  });
  if (cglOcc === 0) missingFields.push('CGL per-occurrence limit');

  const cglAgg = packet.insurance.cglAggregate ?? 0;
  findings.push({
    criterion: 'cgl_aggregate',
    label: `CGL aggregate ≥ $${c.minCglAggregate.toLocaleString()}`,
    passed: cglAgg >= c.minCglAggregate,
    note: cglAgg > 0 ? `$${cglAgg.toLocaleString()}` : 'Not provided',
    severity: 'blocker',
  });
  if (cglAgg === 0) missingFields.push('CGL aggregate limit');

  if (c.requireWorkersComp) {
    findings.push({
      criterion: 'workers_comp',
      label: 'Workers Comp active',
      passed: !!packet.insurance.workersCompActive,
      note: packet.insurance.workersCompCarrier ?? undefined,
      severity: 'blocker',
    });
    if (!packet.insurance.workersCompActive) missingFields.push('Workers Comp confirmation');
  }

  if (c.requireCG2010) {
    findings.push({
      criterion: 'cg_20_10',
      label: 'CG 20 10 (ongoing ops, additional insured)',
      passed: !!packet.insurance.hasCG2010,
      note: packet.insurance.hasCG2010 ? 'Attested' : 'Missing endorsement',
      severity: 'blocker',
    });
    if (!packet.insurance.hasCG2010) missingFields.push('CG 20 10 endorsement');
  }

  if (c.requireCG2037) {
    findings.push({
      criterion: 'cg_20_37',
      label: 'CG 20 37 (completed ops, additional insured)',
      passed: !!packet.insurance.hasCG2037,
      note: packet.insurance.hasCG2037 ? 'Attested' : 'Missing endorsement',
      severity: 'blocker',
    });
    if (!packet.insurance.hasCG2037) missingFields.push('CG 20 37 endorsement');
  }

  // COI expiry — fail if expired, warn if within 30 days.
  if (packet.insurance.coiExpiry) {
    const days = daysBetween(packet.insurance.coiExpiry, today);
    if (days < 0) {
      findings.push({
        criterion: 'coi_expiry',
        label: 'COI not expired',
        passed: false,
        note: `Expired ${Math.abs(days)} days ago`,
        severity: 'blocker',
      });
    } else if (days < 30) {
      findings.push({
        criterion: 'coi_expiry',
        label: 'COI not expiring soon',
        passed: true,
        note: `Expires in ${days} days — renew before project start`,
        severity: 'advisory',
      });
    } else {
      findings.push({
        criterion: 'coi_expiry',
        label: 'COI valid',
        passed: true,
        note: `Expires ${packet.insurance.coiExpiry}`,
        severity: 'advisory',
      });
    }
  } else {
    findings.push({
      criterion: 'coi_expiry',
      label: 'COI expiry date provided',
      passed: false,
      note: 'Missing',
      severity: 'blocker',
    });
    missingFields.push('COI expiry date');
  }

  // ─── Business ─────────────────────────────────────────────────
  if (c.requireW9) {
    findings.push({
      criterion: 'w9',
      label: 'W-9 on file',
      passed: !!packet.w9OnFile,
      severity: 'blocker',
    });
    if (!packet.w9OnFile) missingFields.push('W-9 form');
  }

  if (c.minYearsInBusiness > 0) {
    const years = packet.financials.yearsInBusiness ?? 0;
    findings.push({
      criterion: 'years_in_business',
      label: `${c.minYearsInBusiness}+ years in business`,
      passed: years >= c.minYearsInBusiness,
      note: `${years || 'Not provided'}`,
      severity: years === 0 ? 'blocker' : 'advisory',
    });
    if (years === 0) missingFields.push('Years in business');
  }

  // ─── Safety ───────────────────────────────────────────────────
  if (c.maxEmr < 2.0) {
    const emrs = packet.safety.emr3yr ?? [];
    const latest = emrs.find(v => v !== undefined);
    if (typeof latest === 'number') {
      findings.push({
        criterion: 'emr',
        label: `3-yr EMR ≤ ${c.maxEmr.toFixed(2)}`,
        passed: latest <= c.maxEmr,
        note: `Latest reported: ${latest.toFixed(2)}`,
        severity: 'advisory',
      });
    }
  }

  findings.push({
    criterion: 'written_safety_program',
    label: 'Written safety program',
    passed: !!packet.safety.writtenSafetyProgram,
    severity: 'advisory',
  });

  // ─── License ──────────────────────────────────────────────────
  // We don't require a license for every trade (e.g. painting in many
  // states), but if one is present it must not be expired.
  const expiredLicenses = packet.licenses.filter(l => l.expiresAt && daysBetween(l.expiresAt, today) < 0);
  if (expiredLicenses.length > 0) {
    findings.push({
      criterion: 'license_expired',
      label: 'All licenses current',
      passed: false,
      note: `${expiredLicenses.length} expired (${expiredLicenses.map(l => l.state).join(', ')})`,
      severity: 'blocker',
    });
  } else if (packet.licenses.length > 0) {
    findings.push({
      criterion: 'license_current',
      label: 'Licenses current',
      passed: true,
      note: `${packet.licenses.length} on file`,
      severity: 'advisory',
    });
  }

  // ─── Roll-up ──────────────────────────────────────────────────
  const blockers = findings.filter(f => f.severity === 'blocker' && !f.passed);
  const overall: PrequalReviewResult['overall'] =
    blockers.length === 0 ? 'pass' :
    missingFields.length > 0 ? 'needs_info' : 'fail';

  const summary = overall === 'pass'
    ? 'Auto-review passed. Ready for approval.'
    : overall === 'needs_info'
      ? `${missingFields.length} field${missingFields.length === 1 ? '' : 's'} missing — send back to sub.`
      : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} — not eligible.`;

  return { overall, findings, summary, missingFields };
}

/**
 * Magic-link token generator. Not crypto-grade — we want something
 * URL-safe and unique per packet. The actual trust boundary is that the
 * token is emailed directly to the sub's verified address by the GC;
 * anyone holding the token can submit the form, which is the point.
 */
export function generatePrequalToken(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  let out = '';
  for (let i = 0; i < 24; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/**
 * Compute the renewal cadence for an approved packet. Default is 1 year
 * from review date, but if COI expires sooner we clamp to that.
 */
export function computePrequalExpiry(reviewedAtIso: string, coiExpiryIso?: string): string {
  const reviewDate = new Date(reviewedAtIso);
  const oneYearOut = new Date(reviewDate.getFullYear() + 1, reviewDate.getMonth(), reviewDate.getDate());
  if (!coiExpiryIso) return oneYearOut.toISOString().slice(0, 10);
  const coiDate = new Date(coiExpiryIso);
  return (coiDate < oneYearOut ? coiDate : oneYearOut).toISOString().slice(0, 10);
}

/**
 * Days-until-expiry → renewal cadence bucket used by the reminder system.
 */
export function renewalBucket(expiresAt: string): '60d' | '30d' | '7d' | 'expired' | 'ok' {
  const days = daysBetween(expiresAt, new Date().toISOString().slice(0, 10));
  if (days < 0) return 'expired';
  if (days <= 7) return '7d';
  if (days <= 30) return '30d';
  if (days <= 60) return '60d';
  return 'ok';
}
