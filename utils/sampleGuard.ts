// utils/sampleGuard.ts — the OUTBOUND INVARIANT for sample projects.
//
// A sample job ("Sample — Sarah's Place", seeded by utils/demoSeed) is a real,
// synced project: the real save paths run on it, which is what makes a
// tutorial honest. But nothing on it may ever reach anyone but the user:
//   • no email to a client (an invoice send goes to HIM, "Send to me");
//   • no Stripe pay link (mintPayLinkFor refuses; create-payment-link refuses
//     server-side with 409 sample_project);
//   • no payment reminder (invoice-dunning skips it server-side);
//   • no sub notified, no client-portal post;
//   • no QuickBooks push (ProjectContext + utils/qboSync consult this file).
// This holds whether or not a tutorial is running — a stale build, a replayed
// deep link or a user poking at the sample on his own gets the same answer.
//
// ONE DEFINITION OF "SAMPLE". The byte-exact 'Sample — ' prefix (U+2014) from
// utils/projectCap — the same prefix the server's free-cap trigger exempts and
// the two edge-function fences test. A project renamed out of the prefix is a
// REAL job (renaming it spent his cap slot) and sends like one.
//
// Pure: no React, no RN, no storage. scripts/validate-sample-guard.ts runs it
// under bun, and utils/analytics.ts imports it without an import cycle.

import { isSampleProjectName, SAMPLE_PROJECT_PREFIX } from '@/utils/projectCap';

export { SAMPLE_PROJECT_PREFIX };

type NamedProject = { name?: string | null } | null | undefined;

/** True when `projectOrName` is a sample project (or a sample project's name). */
export function isSampleProject(projectOrName: NamedProject | string): boolean {
  if (typeof projectOrName === 'string') return isSampleProjectName(projectOrName);
  return !!projectOrName && isSampleProjectName(projectOrName.name ?? null);
}

// ── Copy (one place, so every surface says the same honest thing) ───────────

/** Under the locked recipient in the invoice (and report) send sheet. */
export const SAMPLE_SEND_NOTE = 'Sample job — this goes to you, not a client. No pay link is made.';

/** On a control that would reach someone else (the invoice's reminder and
 *  pay link) — shown disabled, with this as the reason. Scoped to what it
 *  refuses: the same screen's "Send to me" DOES email him from the sample, so
 *  a blanket "nothing is sent" would be false (honest-copy rule). */
export const SAMPLE_NOTHING_SENT = 'Sample job — reminders and pay links never go out from a sample.';

/** The send button's label on a sample. */
export const SAMPLE_SEND_TO_ME_LABEL = 'Send to me';

/** The refusal reason the invoice screen's mintPayLinkFor returns on a sample
 *  ({ ok: false, reason: 'sample' }) — it never calls the server. */
export const SAMPLE_PAY_LINK_REFUSAL = 'sample' as const;

/** The error code create-payment-link answers a sample with (409) — the
 *  server-side fence for a stale build or a crafted call. */
export const SAMPLE_SERVER_REFUSAL = 'sample_project' as const;

/** The Pay button's stand-in in a sample invoice email. */
export const SAMPLE_PAY_SPECIMEN_NOTE = 'Pay button — live once you connect Stripe';

/** Subject prefix of every email sent from a sample (idempotent). */
export function sampleEmailSubject(subject: string): string {
  const s = (subject ?? '').trim();
  return s.startsWith('[Sample]') ? s : `[Sample] ${s}`.trim();
}

// ── Recipient ───────────────────────────────────────────────────────────────

/** A plausible address, or null. Deliberately loose (one @, a dot after it,
 *  no spaces): the point is to refuse '' and 'undefined', not to validate. */
function plausibleEmail(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/**
 * The only address a send from a sample may go to: the signed-in user's own.
 * null when he has none on record — the caller then refuses to send at all
 * (never falls back to the client's address).
 */
export function sampleRecipient(userEmail: string | null | undefined): string | null {
  return plausibleEmail(userEmail);
}

export type SampleSendPlan =
  | { sample: false }
  | {
      sample: true;
      /** Locked, read-only recipient: his own email, or null → cannot send. */
      to: string | null;
      /** 'Also post to client portal' is off and hidden. */
      postToPortal: false;
      /** No Stripe pay link is minted. */
      mintPayLink: false;
      /** No reminder, no sub notification, no QuickBooks push. */
      notifyOthers: false;
      buttonLabel: typeof SAMPLE_SEND_TO_ME_LABEL;
      note: typeof SAMPLE_SEND_NOTE;
    };

/**
 * What a send screen does for `project`. Real jobs get `{ sample: false }` and
 * behave exactly as before; a sample gets the locked plan. One call, so the
 * invoice sheet and the report Submit cannot disagree about the rule.
 */
export function sampleSendPlan(project: NamedProject | string, userEmail: string | null | undefined): SampleSendPlan {
  if (!isSampleProject(project)) return { sample: false };
  return {
    sample: true,
    to: sampleRecipient(userEmail),
    postToPortal: false,
    mintPayLink: false,
    notifyOthers: false,
    buttonLabel: SAMPLE_SEND_TO_ME_LABEL,
    note: SAMPLE_SEND_NOTE,
  };
}

/**
 * Last-line check at the moment of sending: may `to` receive mail from
 * `project`? A real job: yes. A sample: only the user's own address
 * (case-insensitive). A screen that forgot to lock the field still cannot
 * email a client from a sample.
 */
export function sampleSendAllowed(project: NamedProject | string, to: string | null | undefined, userEmail: string | null | undefined): boolean {
  if (!isSampleProject(project)) return true;
  const self = sampleRecipient(userEmail);
  const target = plausibleEmail(to);
  return !!self && !!target && self.toLowerCase() === target.toLowerCase();
}

// ── Which ids are samples (analytics + QuickBooks, which see only an id) ────
//
// track() and triggerQboSync() are handed ids, not projects. ProjectContext
// keeps this registry current (an effect over projects + invoices, plus an
// immediate note in addProject so the seed's own child events — fired in the
// same tick — already read is_sample: true). Module state on purpose: both
// readers are plain functions outside React. It is replaced wholesale on every
// update, so a sign-out (empty lists) empties it and nothing leaks across
// tenants.

let sampleProjectIds: Set<string> = new Set();
let sampleInvoiceIds: Set<string> = new Set();

/** Replace the registry from the current lists. */
export function noteSampleScope(
  projects: readonly { id: string; name?: string | null }[],
  invoices: readonly { id: string; projectId?: string | null }[] = [],
): void {
  const pids = new Set<string>();
  for (const p of projects) if (p && isSampleProjectName(p.name ?? null)) pids.add(p.id);
  const iids = new Set<string>();
  for (const i of invoices) if (i && i.projectId && pids.has(i.projectId)) iids.add(i.id);
  sampleProjectIds = pids;
  sampleInvoiceIds = iids;
}

/** Add one project now (addProject, before the effect has run). */
export function noteSampleProject(p: { id: string; name?: string | null }): void {
  if (!p || !isSampleProjectName(p.name ?? null)) return;
  if (sampleProjectIds.has(p.id)) return;
  sampleProjectIds = new Set(sampleProjectIds).add(p.id);
}

/** True when `projectId` belongs to a known sample project. */
export function isKnownSampleProjectId(projectId: string | null | undefined): boolean {
  return !!projectId && sampleProjectIds.has(projectId);
}

/**
 * True when a QuickBooks push of this object would carry sample data:
 * 'project' → a sample project; 'invoice' → an invoice on one; 'payment' → its
 * id is `${invoiceId}::${paymentId}` (ProjectContext's shape), so the invoice
 * half decides. 'item' is catalog data, never per-project, so never a sample.
 */
export function isSampleQboObject(kind: 'project' | 'invoice' | 'payment' | 'item', objectId: string | null | undefined): boolean {
  if (!objectId) return false;
  switch (kind) {
    case 'project': return sampleProjectIds.has(objectId);
    case 'invoice': return sampleInvoiceIds.has(objectId);
    case 'payment': return sampleInvoiceIds.has(objectId.split('::')[0]);
    default: return false;
  }
}
