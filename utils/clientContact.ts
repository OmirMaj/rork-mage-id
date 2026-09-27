// ============================================================================
// utils/clientContact.ts — "the client is a field on the job" (UX wave, Lane 0).
//
// Every sender (contract email, change-order approver, portal invite, invoice
// bill-to) asks the same question: who is this job's client? Before this file
// each screen answered it differently, or not at all, and he retyped the
// homeowner's email on every document. One resolver, one order:
//
//   default:   project.primaryContact → the first portal invite with an '@'
//              → opts.lastRecipient (the last address HE used on this job);
//   invoices:  opts.billToEmail wins over all of those — the same order as
//              billingFlowCore.reminderRecipient() and the invoice-dunning
//              function (bill_to_email, then portal invites).
//
// IT NEVER FABRICATES. Nothing on file → null, and the caller asks with one
// field. A name with no email and no phone is not a contact anyone can reach,
// so it is not returned either (a lone name is still carried when an email or
// phone comes from the same source).
//
// WHY seedClientEverywhere EXISTS. Server-side reminders read bill_to_email,
// then portal invites; they never read primary_contact. So "the client is on
// the job" only reaches a reminder if new invoices seed billToEmail from this
// resolver (Lane C, C2/C3) and the contract seeds the portal invite (C1).
// seedClientEverywhere builds that patch. It adds the portal invite ONLY when
// the caller says the portal is being turned on — it never enables a portal,
// and it never adds an invite to a portal that is off.
//
// Pure: no React, no RN, no storage. scripts/validate-ux-client-contact.ts
// runs it under bun.
// ============================================================================

import type { ClientPortalInvite, ClientPortalSettings, Project } from '@/types';

export type ClientContactSource = 'bill_to' | 'primary_contact' | 'portal_invite' | 'last_recipient';

export interface ClientContact {
  name: string;
  email?: string;
  phone?: string;
  source: ClientContactSource;
}

export interface ResolveClientContactOpts {
  /** The invoice's own billed-to address. Set it ONLY for invoice work: it
   *  then wins, matching reminderRecipient() and invoice-dunning. */
  billToEmail?: string | null;
  /** The billed-to name, shown beside billToEmail when it wins. */
  billToName?: string | null;
  /** The last address he sent to on this job (a local memory), used last. */
  lastRecipient?: { email?: string | null; name?: string | null; phone?: string | null } | null;
  /** What the caller is about to do. 'email' skips a source that has no
   *  usable email (a phone-only primaryContact must not hide an invitee's
   *  address from the contract email); 'phone' likewise for a text. Default
   *  'any': the first source with either. */
  need?: 'email' | 'phone' | 'any';
}

type ProjectLike = Pick<Project, 'primaryContact' | 'clientPortal'> | null | undefined;

const clean = (s: string | null | undefined): string => (typeof s === 'string' ? s.trim() : '');
/** An address the app may send to: has an '@' with something on both sides. */
export function isUsableEmail(s: string | null | undefined): boolean {
  const e = clean(s);
  const at = e.indexOf('@');
  return at > 0 && at < e.length - 1 && !/\s/.test(e);
}
/** A phone number with at least 7 digits (a real number, not "n/a"). */
export function isUsablePhone(s: string | null | undefined): boolean {
  return clean(s).replace(/\D/g, '').length >= 7;
}

function build(
  source: ClientContactSource,
  name: string | null | undefined,
  email: string | null | undefined,
  phone: string | null | undefined,
  need: 'email' | 'phone' | 'any' = 'any',
): ClientContact | null {
  const e = isUsableEmail(email) ? clean(email) : '';
  const p = isUsablePhone(phone) ? clean(phone) : '';
  if (!e && !p) return null;
  if (need === 'email' && !e) return null;
  if (need === 'phone' && !p) return null;
  const out: ClientContact = { name: clean(name), source };
  if (e) out.email = e;
  if (p) out.phone = p;
  return out;
}

/**
 * The job's client, or null when nothing reachable is on file. See the file
 * header for the order. Every field comes from the ONE source that won: a
 * phone is never borrowed from primaryContact onto a portal invitee, and a
 * name is never borrowed onto a different address (the invitee may be the
 * spouse, the billing address may be an office). The only cross-read is a
 * name looked up by the SAME email address.
 */
export function resolveClientContact(project: ProjectLike, opts: ResolveClientContactOpts = {}): ClientContact | null {
  const pc = project?.primaryContact;
  const invites = project?.clientPortal?.invites ?? [];
  const need = opts.need ?? 'any';
  const sameEmail = (a: string | null | undefined, b: string | null | undefined) =>
    clean(a).toLowerCase() === clean(b).toLowerCase();

  if (isUsableEmail(opts.billToEmail)) {
    const invite = invites.find(i => sameEmail(i.email, opts.billToEmail));
    const name = clean(opts.billToName) || clean(invite?.name) || (sameEmail(pc?.email, opts.billToEmail) ? clean(pc?.name) : '');
    if (need !== 'phone') return build('bill_to', name, opts.billToEmail, null);
  }

  const fromPrimary = build('primary_contact', pc?.name, pc?.email, pc?.phone, need);
  if (fromPrimary) return fromPrimary;

  const invite = need === 'phone' ? undefined : invites.find(i => isUsableEmail(i.email));
  if (invite) return build('portal_invite', invite.name, invite.email, null);

  const last = opts.lastRecipient;
  if (last) return build('last_recipient', last.name, last.email, last.phone, need);

  return null;
}

/** What the caller asked for: the contact to write, and whether the portal is
 *  being switched on in the same step (C1's explicit confirm). */
export interface SeedClientOpts {
  /** True only when the GC has just confirmed turning the client portal on
   *  (or it is already on). The invite is added only then. */
  portalBeingEnabled?: boolean;
  /** For the new invite's id / invitedAt (injected so the builder is pure). */
  newId: () => string;
  nowIso: string;
}

export interface ClientSeedPatch {
  primaryContact?: NonNullable<Project['primaryContact']>;
  clientPortal?: ClientPortalSettings;
}

/**
 * The project patch that puts `contact` everywhere it belongs:
 *   - primaryContact — merged field by field, so a blank field never erases
 *     one already on file;
 *   - one portal invite — ONLY when `portalBeingEnabled` is true and the
 *     portal settings exist (enabling a portal is the caller's explicit,
 *     confirmed step; this builder never flips `enabled`). No duplicate when
 *     the address is already invited (case-insensitive).
 * Returns {} when nothing would change.
 */
export function seedClientEverywhere(
  project: ProjectLike,
  contact: { name?: string | null; email?: string | null; phone?: string | null },
  opts: SeedClientOpts,
): ClientSeedPatch {
  const patch: ClientSeedPatch = {};
  const prev = project?.primaryContact ?? {};
  const name = clean(contact.name);
  const email = isUsableEmail(contact.email) ? clean(contact.email) : '';
  const phone = isUsablePhone(contact.phone) ? clean(contact.phone) : '';

  const next = { ...prev };
  if (name && name !== clean(prev.name)) next.name = name;
  if (email && email !== clean(prev.email)) next.email = email;
  if (phone && phone !== clean(prev.phone)) next.phone = phone;
  if (next.name !== prev.name || next.email !== prev.email || next.phone !== prev.phone) {
    patch.primaryContact = next;
  }

  const portal = project?.clientPortal;
  if (opts.portalBeingEnabled && portal && email) {
    const invites = portal.invites ?? [];
    const already = invites.some(i => clean(i.email).toLowerCase() === email.toLowerCase());
    if (!already) {
      const invite: ClientPortalInvite = {
        id: opts.newId(),
        email,
        name: name || clean(prev.name),
        invitedAt: opts.nowIso,
        status: 'pending',
      };
      patch.clientPortal = { ...portal, invites: [...invites, invite] };
    }
  }
  return patch;
}

/** The empty-state line when no client is on file (C5: "No client on file"). */
export const NO_CLIENT_ON_FILE = 'No client on file';
