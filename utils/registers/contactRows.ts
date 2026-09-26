// utils/registers/contactRows.ts — what the desktop Contacts register reads
// off a Contact (wave 6d, lane R1).
//
// PURE: type-only '@/types' import, no react-native, no contexts — so
// scripts/validate-registers.ts executes it under bun. The phone list in
// app/contacts.tsx keeps its own inline rules; the one it shares with the
// register (the display name) is the same expression, pinned by the validator.

import type { Contact, ContactRole } from '@/types';

/** The name a row shows: the renderContact rule, `${first} ${last}`.trim(),
 *  falling back to the company for a company-only contact. */
export function contactDisplayName(c: Pick<Contact, 'firstName' | 'lastName' | 'companyName'>): string {
  return `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || (c.companyName ?? '');
}

/** The text the register's search box matches: first, last, company, email,
 *  phone and role (the phone search matched all but the phone number). */
export function contactSearchText(c: Pick<Contact, 'firstName' | 'lastName' | 'companyName' | 'email' | 'phone' | 'role'>): string {
  return [c.firstName, c.lastName, c.companyName, c.email, c.phone, c.role]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ');
}

export interface ContactRoleCount {
  role: ContactRole;
  count: number;
}

/**
 * How many contacts hold each role — ONLY roles with at least one contact (a
 * chip that can only ever show an empty table is noise). Ordered by `order`
 * (the screen's CONTACT_ROLES order); a role outside it follows, in the order
 * it was first seen.
 */
export function contactRoleCounts(
  contacts: readonly Pick<Contact, 'role'>[],
  order: readonly ContactRole[] = [],
): ContactRoleCount[] {
  const counts = new Map<ContactRole, number>();
  for (const c of contacts) {
    if (!c.role) continue;
    counts.set(c.role, (counts.get(c.role) ?? 0) + 1);
  }
  const out: ContactRoleCount[] = [];
  for (const role of order) {
    const n = counts.get(role) ?? 0;
    if (n > 0) out.push({ role, count: n });
  }
  for (const [role, n] of counts) {
    if (n > 0 && !order.includes(role)) out.push({ role, count: n });
  }
  return out;
}

/** The register's chip filter: 'all' or one role. */
export function contactMatchesRole(c: Pick<Contact, 'role'>, role: ContactRole | 'all'): boolean {
  return role === 'all' || c.role === role;
}
