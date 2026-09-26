// utils/registers/subRows.ts — one desktop Subs register row per
// subcontractor (wave 6d, lane R2).
//
// The compliance state is the phone's own call, getComplianceStatus from
// utils/subCompliance, worded by complianceLabel (the phone imports it as
// getStatusLabel). subStatusCounts is the phone's stats memo, count for count,
// so the register's chips equal the phone's stat cards.
//
// An UNKNOWN is null, never 0: no COI date is a null coiDay and coiDaysLeft,
// no scorecard is a null grade and score. The CSV writes null as an EMPTY cell.
//
// PURE: type-only '@/types' imports (plus the SUB_TRADES order, a plain
// array) and pure utils — scripts/validate-registers-sub-coi.ts executes it
// under bun.

import type { Commitment, Subcontractor, SubTrade } from '@/types';
import { calendarDayOf, daysUntilCalendarDay } from '../calendarDate';
import { complianceLabel, getComplianceStatus, type ComplianceState } from '../subCompliance';
import type { SubGrade } from '../subScorecard';
import type { RegisterCsvColumn } from './registerCsv';

export interface SubStatusCounts {
  total: number;
  compliant: number;
  expiring: number;
  expired: number;
  unknown: number;
}

/** The phone's stats memo (app/(tabs)/subs/index.tsx), as one pass. */
export function subStatusCounts(subs: readonly Subcontractor[], nowMs: number): SubStatusCounts {
  const out: SubStatusCounts = { total: subs.length, compliant: 0, expiring: 0, expired: 0, unknown: 0 };
  for (const s of subs) {
    const st = getComplianceStatus(s, nowMs);
    if (st === 'compliant') out.compliant += 1;
    else if (st === 'expiring_soon') out.expiring += 1;
    else if (st === 'expired') out.expired += 1;
    else out.unknown += 1;
  }
  return out;
}

export type ComplianceTone = 'success' | 'warning' | 'error' | 'neutral';

/** The StatusPill tone of a compliance state. 'unknown' is a gap, not a severity. */
export function complianceTone(state: ComplianceState): ComplianceTone {
  if (state === 'compliant') return 'success';
  if (state === 'expiring_soon') return 'warning';
  if (state === 'expired') return 'error';
  return 'neutral';
}

/** The slice of a SubScorecard the row reads. */
export interface SubCardLike {
  grade: SubGrade;
  score: number;
}

export interface SubRegisterRow {
  id: string;
  company: string;
  contact: string;
  trade: string;
  compliance: ComplianceState;
  complianceLabel: string;
  /** The COI expiry as a calendar day; null when none or unreadable. */
  coiDay: string | null;
  coiDaysLeft: number | null;
  grade: SubGrade | null;
  score: number | null;
  /** Active commitments (status 'active') with this sub. */
  openCommitments: number;
  /** Σ(amount + changeAmount) over those. */
  openCommitted: number;
  phone: string | null;
  email: string | null;
  licenseNumber: string | null;
  /** For the phone's list order (updatedAt, newest first). */
  updatedAt: string;
}

const text = (s: string | null | undefined): string | null => (typeof s === 'string' && s.trim() ? s.trim() : null);

export function subRegisterRow(
  sub: Subcontractor,
  commitments: readonly Pick<Commitment, 'subcontractorId' | 'status' | 'amount' | 'changeAmount'>[],
  card: SubCardLike | null,
  nowMs: number,
): SubRegisterRow {
  const compliance = getComplianceStatus(sub, nowMs);
  const coiDay = calendarDayOf(typeof sub.coiExpiry === 'string' ? sub.coiExpiry.trim() : null);
  const open = commitments.filter((c) => c.subcontractorId === sub.id && c.status === 'active');
  return {
    id: sub.id,
    company: sub.companyName ?? '',
    contact: sub.contactName ?? '',
    trade: sub.trade ?? '',
    compliance,
    complianceLabel: complianceLabel(compliance, sub),
    coiDay,
    coiDaysLeft: coiDay ? daysUntilCalendarDay(coiDay, new Date(nowMs)) : null,
    grade: card ? card.grade : null,
    score: card ? card.score : null,
    openCommitments: open.length,
    openCommitted: open.reduce((a, c) => a + (Number(c.amount) || 0) + (Number(c.changeAmount) || 0), 0),
    phone: text(sub.phone),
    email: text(sub.email),
    licenseNumber: text(sub.licenseNumber),
    updatedAt: sub.updatedAt ?? '',
  };
}

/** The phone's list order: updatedAt, newest first — on a COPY. */
export function subsByUpdated<T extends { updatedAt: string }>(rows: readonly T[]): T[] {
  return rows.slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export interface SubTradeCount {
  trade: SubTrade;
  count: number;
}

/** Trades with at least one sub, in `order` (SUB_TRADES); an unlisted trade follows. */
export function subTradeCounts(subs: readonly Pick<Subcontractor, 'trade'>[], order: readonly SubTrade[] = []): SubTradeCount[] {
  const counts = new Map<SubTrade, number>();
  for (const s of subs) {
    if (!s.trade) continue;
    counts.set(s.trade, (counts.get(s.trade) ?? 0) + 1);
  }
  const out: SubTradeCount[] = [];
  for (const trade of order) {
    const n = counts.get(trade) ?? 0;
    if (n > 0) out.push({ trade, count: n });
  }
  for (const [trade, n] of counts) {
    if (n > 0 && !order.includes(trade)) out.push({ trade, count: n });
  }
  return out;
}

/** The search box: company, contact, trade, email, phone, licence number. */
export function subSearchText(r: Pick<SubRegisterRow, 'company' | 'contact' | 'trade' | 'email' | 'phone' | 'licenseNumber'>): string {
  return [r.company, r.contact, r.trade, r.email, r.phone, r.licenseNumber]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ');
}

/** 'all' | a compliance chip | 'trade:<SubTrade>'. */
export type SubChip = 'all' | 'compliant' | 'expiring' | 'expired' | 'unknown' | `trade:${string}`;

export function subChipMatches(r: Pick<SubRegisterRow, 'compliance' | 'trade'>, chip: SubChip): boolean {
  if (chip === 'all') return true;
  if (chip === 'compliant') return r.compliance === 'compliant';
  if (chip === 'expiring') return r.compliance === 'expiring_soon';
  if (chip === 'expired') return r.compliance === 'expired';
  if (chip === 'unknown') return r.compliance === 'unknown';
  return r.trade === chip.slice('trade:'.length);
}

const money = (n: number): number => Math.round(n * 100) / 100;

export const SUB_CSV_COLUMNS: readonly RegisterCsvColumn<SubRegisterRow>[] = [
  { key: 'company', label: 'Company', csvValue: (r) => text(r.company) },
  { key: 'trade', label: 'Trade', csvValue: (r) => text(r.trade) },
  { key: 'compliance', label: 'Compliance', csvValue: (r) => r.complianceLabel },
  { key: 'coiExpiry', label: 'COI expiry', csvValue: (r) => r.coiDay },
  { key: 'coiDaysLeft', label: 'COI days left', csvValue: (r) => r.coiDaysLeft },
  { key: 'grade', label: 'Grade', csvValue: (r) => r.grade },
  { key: 'score', label: 'Score', csvValue: (r) => r.score },
  { key: 'openCommitments', label: 'Open commitments', csvValue: (r) => r.openCommitments },
  { key: 'openCommitted', label: 'Open committed', csvValue: (r) => money(r.openCommitted) },
  { key: 'contact', label: 'Contact', csvValue: (r) => text(r.contact) },
  { key: 'phone', label: 'Phone', csvValue: (r) => r.phone },
  { key: 'email', label: 'Email', csvValue: (r) => r.email },
  { key: 'license', label: 'License #', csvValue: (r) => r.licenseNumber },
];
