// utils/registers/crewRows.ts — one desktop Crew register row per crew member
// (wave 6d, lane R1).
//
// PURE: type-only '@/types' import plus utils/crew (calendar-day maths only),
// so scripts/validate-registers.ts executes it under bun. Every status here is
// the SAME call the phone's detail sheet makes: verifiedBadge for the ID and
// crewCertRowStatus(certExpiryStatus(...)) for each certificate.

import type { CrewMember } from '@/types';
import { certExpiryStatus } from '../crew/certExpiry';
import { crewCertRowStatus, verifiedBadge, type IdBadge } from '../crew/verifiedBadge';

/** The slice of a Certification the row reads. */
export interface CrewCertLike {
  workerId?: string;
  expiresDate?: string;
}

export interface CrewRegisterRow {
  id: string;
  name: string;
  /** Trades joined ' · ' (the phone card's separator); '' with none. */
  trades: string;
  idBadge: IdBadge;
  certCount: number;
  certExpiring: number;
  certExpired: number;
  projectCount: number;
  /** Claimed by the worker himself (claimedByUserId set). */
  claimed: boolean;
  /** status !== 'inactive' — the phone's Active switch. */
  active: boolean;
  phone: string | null;
  email: string | null;
}

/** `certs` may be every certification on the account: only this member's
 *  (workerId === member.id, SafetyContext.getCertificationsForWorker) count. */
export function crewRegisterRow(member: CrewMember, certs: readonly CrewCertLike[], today: string): CrewRegisterRow {
  const mine = certs.filter((c) => c.workerId === member.id);
  let certExpiring = 0;
  let certExpired = 0;
  for (const c of mine) {
    const s = crewCertRowStatus(c.expiresDate, certExpiryStatus(c.expiresDate, today));
    if (s === 'expiring') certExpiring++;
    else if (s === 'expired') certExpired++;
  }
  return {
    id: member.id,
    name: member.fullName,
    trades: (member.trades ?? []).join(' · '),
    idBadge: verifiedBadge(member, today),
    certCount: mine.length,
    certExpiring,
    certExpired,
    projectCount: (member.projectIds ?? []).length,
    claimed: !!member.claimedByUserId,
    active: member.status !== 'inactive',
    phone: member.phone?.trim() ? member.phone.trim() : null,
    email: member.email?.trim() ? member.email.trim() : null,
  };
}

export type CrewChip = 'all' | 'active' | 'inactive' | 'verified' | 'unverified';

export const CREW_CHIPS: readonly { key: CrewChip; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'verified', label: 'ID verified' },
  { key: 'unverified', label: 'Not verified' },
];

/** 'ID verified' is a CURRENT verified ID; an expired one is 'Not verified'. */
export function crewChipMatches(row: Pick<CrewRegisterRow, 'active' | 'idBadge'>, chip: CrewChip): boolean {
  switch (chip) {
    case 'all': return true;
    case 'active': return row.active;
    case 'inactive': return !row.active;
    case 'verified': return row.idBadge === 'id_verified';
    case 'unverified': return row.idBadge !== 'id_verified';
    default: return true;
  }
}

export function crewChipCounts(rows: readonly Pick<CrewRegisterRow, 'active' | 'idBadge'>[]): Record<CrewChip, number> {
  const out: Record<CrewChip, number> = { all: 0, active: 0, inactive: 0, verified: 0, unverified: 0 };
  for (const r of rows) {
    for (const c of CREW_CHIPS) if (crewChipMatches(r, c.key)) out[c.key]++;
  }
  return out;
}

/** The ID column's words, from verifiedBadge. */
export const CREW_ID_LABEL: Readonly<Record<IdBadge, string>> = {
  id_verified: 'ID verified',
  id_expired: 'ID expired',
  unverified: 'Not verified',
};
