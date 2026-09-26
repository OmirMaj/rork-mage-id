// utils/registers/coiRows.ts — one desktop COI Vault register row per sub
// (wave 6d, lane R2).
//
// Every fact is the one the phone vault already computes, by the same call:
//   - the "current" certificate is the sub's LATEST by uploadedAt (the phone's
//     subStatus memo);
//   - the expiry is vaultCoiExpiry(latest, sub) — the latest certificate's
//     earliest coverage expiry, else the COI Expiry typed on the sub's record —
//     and its status is vaultCoiStatus(...) (the phone's complianceSummary);
//   - the check is validation.overallStatus, 'warn' for a certificate nobody
//     checked, 'none' for a sub with no certificate (statusToVisuals' four).
//
// An UNKNOWN is null, never 0: a sub with no certificate has no policy count
// (null), not "0 policies"; a certificate with no validation has no issue
// count. The CSV writes null as an EMPTY cell.
//
// PURE: type-only '@/types' imports plus pure utils — scripts/validate-
// registers-sub-coi.ts executes it under bun.

import type { CertificateOfInsurance, COICoverage, Subcontractor } from '@/types';
import { vaultCoiExpiry, vaultCoiStatus, type VaultCoiSource, type VaultCoiStatus } from '../subCompliance';
import { daysUntilCalendarDay } from '../calendarDate';
import type { RegisterCsvColumn } from './registerCsv';

export type CoiCheck = 'pass' | 'warn' | 'fail' | 'none';

/** The check's words: app/coi-vault.tsx statusToVisuals' four labels, by text
 *  (scripts/validate-registers-sub-coi.ts pins them against that function). */
export const COI_CHECK_LABEL: Readonly<Record<CoiCheck, string>> = {
  pass: 'Valid',
  warn: 'Review needed',
  fail: 'Action required',
  none: 'No COI',
};

/** The check's StatusPill tone. */
export const COI_CHECK_TONE: Readonly<Record<CoiCheck, 'success' | 'warning' | 'error' | 'neutral'>> = {
  pass: 'success',
  warn: 'warning',
  fail: 'error',
  none: 'neutral',
};

export interface CoiRegisterRow {
  /** The sub's id — the row key and the ?subId= of its record. */
  id: string;
  sub: string;
  trade: string;
  /** Certificates on file for this sub (any age). */
  certCount: number;
  /** Coverage rows with content on the LATEST certificate; null with no certificate. */
  policyCount: number | null;
  /** The calendar day the status is read from, or null. */
  expiryDay: string | null;
  /** Where that day came from: a certificate, the sub's typed record, or nowhere. */
  expirySource: VaultCoiSource;
  /** Days from today to expiryDay (negative = lapsed); null when unknown. */
  daysLeft: number | null;
  statusKey: VaultCoiStatus['key'];
  /** vaultCoiStatus's own words ("Expires in 10d", "Expired (typed on his record)"). */
  statusLabel: string;
  tone: VaultCoiStatus['tone'];
  check: CoiCheck;
  /** Critical + warning findings on the latest certificate; null without a validation. */
  issueCount: number | null;
  firstIssue: string | null;
  lastUploadAt: string | null;
}

/** A coverage row with nothing typed is not a policy (coi-vault's rowHasContent, same expression). */
export function coverageHasContent(c: COICoverage): boolean {
  return !!(c.policyNumber?.trim() || c.carrierName?.trim() || c.expiresAt || c.effectiveDate || c.aiExpiresAt || c.aiEffectiveDate);
}

/** The sub's latest certificate by uploadedAt (the phone's subStatus rule), or null. */
export function latestCoi(subId: string, cois: readonly CertificateOfInsurance[]): { latest: CertificateOfInsurance | null; count: number } {
  const subC = cois.filter((c) => c.subcontractorId === subId);
  if (subC.length === 0) return { latest: null, count: 0 };
  const latest = subC.slice().sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
  return { latest, count: subC.length };
}

export function coiRegisterRow(
  sub: Pick<Subcontractor, 'id' | 'companyName' | 'trade' | 'coiExpiry'>,
  cois: readonly CertificateOfInsurance[],
  now: Date,
): CoiRegisterRow {
  const { latest, count } = latestCoi(sub.id, cois);
  const expiry = vaultCoiExpiry(latest, sub);
  const status = vaultCoiStatus(expiry, now);
  const v = latest?.validation;
  const issues = v ? (v.issues ?? []).filter((i) => i.severity === 'critical' || i.severity === 'warning') : null;
  return {
    id: sub.id,
    sub: sub.companyName ?? '',
    trade: sub.trade ?? '',
    certCount: count,
    policyCount: latest ? (latest.coverages ?? []).filter(coverageHasContent).length : null,
    expiryDay: expiry.day,
    expirySource: expiry.source,
    daysLeft: expiry.day ? daysUntilCalendarDay(expiry.day, now) : null,
    statusKey: status.key,
    statusLabel: status.label,
    tone: status.tone,
    check: !latest ? 'none' : v ? v.overallStatus : 'warn',
    issueCount: issues ? issues.length : null,
    firstIssue: issues && issues.length > 0 ? issues[0].message : null,
    lastUploadAt: latest?.uploadedAt ?? null,
  };
}

export interface CoiSummary {
  expired: number;
  expiringSoon: number;
  missing: number;
}

/**
 * The phone banner's three numbers (coi-vault's complianceSummary): a sub with
 * no certificate is MISSING whatever his record says; otherwise his status
 * counts as expired or expiring.
 */
export function coiSummary(rows: readonly Pick<CoiRegisterRow, 'certCount' | 'statusKey'>[]): CoiSummary {
  let expired = 0;
  let expiringSoon = 0;
  let missing = 0;
  for (const r of rows) {
    if (r.certCount === 0) { missing += 1; continue; }
    if (r.statusKey === 'expired') expired += 1;
    else if (r.statusKey === 'expiring') expiringSoon += 1;
  }
  return { expired, expiringSoon, missing };
}

/** Subs that need a COI action: expired, expiring inside 30 days, or none on file. */
export function coiAttentionCount(rows: readonly Pick<CoiRegisterRow, 'certCount' | 'statusKey'>[]): number {
  const s = coiSummary(rows);
  return s.expired + s.expiringSoon + s.missing;
}

export type CoiChip = 'all' | 'expired' | 'expiring' | 'missing';

/** The register's chip filter — each chip holds exactly the subs coiSummary counts. */
export function coiChipMatches(r: Pick<CoiRegisterRow, 'certCount' | 'statusKey'>, chip: CoiChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'missing') return r.certCount === 0;
  if (r.certCount === 0) return false;
  return chip === 'expired' ? r.statusKey === 'expired' : r.statusKey === 'expiring';
}

const text = (s: string | null | undefined): string | null => (typeof s === 'string' && s.trim() ? s.trim() : null);

const SOURCE_LABEL: Readonly<Record<VaultCoiSource, string | null>> = {
  certificate: 'Certificate',
  record: 'Typed on the sub record',
  none: null,
};

export const COI_CSV_COLUMNS: readonly RegisterCsvColumn<CoiRegisterRow>[] = [
  { key: 'sub', label: 'Sub', csvValue: (r) => text(r.sub) },
  { key: 'trade', label: 'Trade', csvValue: (r) => text(r.trade) },
  { key: 'check', label: 'Check', csvValue: (r) => COI_CHECK_LABEL[r.check] },
  { key: 'expiry', label: 'Earliest expiry', csvValue: (r) => r.expiryDay },
  { key: 'source', label: 'Expiry from', csvValue: (r) => SOURCE_LABEL[r.expirySource] },
  { key: 'daysLeft', label: 'Days left', csvValue: (r) => r.daysLeft },
  { key: 'status', label: 'Status', csvValue: (r) => text(r.statusLabel) },
  { key: 'certs', label: 'Certificates', csvValue: (r) => r.certCount },
  { key: 'policies', label: 'Policies on file', csvValue: (r) => r.policyCount },
  { key: 'issues', label: 'Endorsement issues', csvValue: (r) => r.issueCount },
  { key: 'firstIssue', label: 'First issue', csvValue: (r) => text(r.firstIssue) },
  { key: 'lastUpload', label: 'Last upload', csvValue: (r) => r.lastUploadAt },
];
