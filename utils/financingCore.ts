// utils/financingCore.ts — the pure half of client financing.
//
// No imports beyond types, so the portal snapshot builder, bun validators and
// the email/portal surfaces can all read the SAME words and the SAME "is it
// on?" rule. (utils/financing.ts wraps this with the Supabase functions URL.)
//
// THE MODEL (founder decision, 2026-09-24): "bring your own lender". MAGE ID
// has no lending partner, no deal with Wisetack or anyone else, and earns
// nothing from a referral. The GC signs up with a lender that gives
// contractors a prequalification link, pastes it into Payments, and the
// homeowner gets a button that forwards them there. Open to every plan.
// Every sentence below must stay true under that model — in particular, no
// "MAGE ID may receive compensation": it receives none.

import type { AppSettings, FinancingConfig } from '@/types';

/** On, named, and pointing at an https prequalification page. */
export function financingConfigLive(cfg: FinancingConfig | null | undefined): cfg is FinancingConfig {
  return !!cfg
    && cfg.enabled === true
    && typeof cfg.partnerName === 'string' && cfg.partnerName.trim().length > 0
    && typeof cfg.prequalBaseUrl === 'string' && /^https:\/\//i.test(cfg.prequalBaseUrl.trim());
}

/** The client-facing disclosure printed under every financing offer. */
export function financingDisclosureText(partnerName: string): string {
  const partner = partnerName.trim() || 'your contractor\'s lender';
  return `Financing is offered by ${partner}, a third-party lender, subject to credit approval. `
    + 'MAGE ID is not a lender and is not paid for this referral.';
}

/**
 * The financing block baked into the client-portal snapshot. Built ONLY from
 * the GC's own settings at publish time — the homeowner's device has no
 * business deciding whether the GC offers financing (the old portal button
 * read the VIEWER's settings, so a homeowner never saw it). Absent = off.
 * Deliberately carries no link, no referral code and no example rate: the
 * link is built on the page from the portal id + access token, and
 * financing-redirect reads the lender URL and code server-side.
 */
export interface PortalFinancingBlock {
  partnerName: string;
  disclosure: string;
}
export function portalFinancingBlock(settings: AppSettings | null | undefined): PortalFinancingBlock | undefined {
  const cfg = settings?.financing;
  if (!financingConfigLive(cfg)) return undefined;
  const partnerName = cfg.partnerName.trim();
  return { partnerName, disclosure: financingDisclosureText(partnerName) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The portal button's link: financing-redirect's portal entry
 * (?project&src=portal&portal&t). financing-redirect only forwards to the
 * lender when the portal id + access token resolve (portal_project_for_token)
 * to exactly this project, and it refuses a project id that is not a UUID —
 * so without all three there is no link, and the caller must not draw a
 * button that can only land on the MAGE ID homepage. The static portal
 * (marketing/portal/index.html financingPortalUrl) builds the identical URL.
 */
export function portalFinancingRedirectUrl(
  functionsUrl: string,
  args: { projectId?: string | null; portalId?: string | null; accessToken?: string | null },
): string | null {
  const projectId = (args.projectId ?? '').trim();
  const portalId = (args.portalId ?? '').trim();
  const accessToken = (args.accessToken ?? '').trim();
  if (!functionsUrl || !UUID_RE.test(projectId) || !portalId || !accessToken) return null;
  return `${functionsUrl.replace(/\/+$/, '')}/financing-redirect?project=${encodeURIComponent(projectId)}`
    + `&src=portal&portal=${encodeURIComponent(portalId)}&t=${encodeURIComponent(accessToken)}`;
}

/** What the GC reads in his own portal preview, where there is no access key. */
export function portalFinancingPreviewNote(partnerName: string): string {
  return `Your client sees a "Check financing options" button here that sends them to ${partnerName.trim() || 'your lender'}. `
    + 'It works from the portal link you send them, not from this preview.';
}

/** A re-used referral (one per project per surface) carries the amount of the
 *  invoice it was FIRST minted for, and financing-redirect pre-fills the
 *  lender's page from the row. So before its link goes into a new email the
 *  row is ALWAYS rewritten to this invoice's amount and lender — always, not
 *  "when it differs": the comparison would run against a cached list that
 *  another device may have made stale. These are the columns to write. */
export function referralRefreshPatch(
  next: { amountCents: number; partnerName: string },
): { amount_cents: number; partner_name: string } {
  const amount = Math.max(0, Math.round(Number.isFinite(next.amountCents) ? next.amountCents : 0));
  return { amount_cents: amount, partner_name: (next.partnerName ?? '').trim() };
}

// ── Payments screen copy (GC-facing) ─────────────────────────────────────────

export const FINANCING_EXPLAINER =
  'Bring your own lender. MAGE ID is not a lender and has no lending partner. Sign up with a lender '
  + 'that gives contractors a prequalification link, paste it below, and your invoice emails and '
  + 'client portal get a "Check financing options" button that sends your client to that lender. '
  + 'Approval, rates, fees and when you get paid are between you, your client and the lender. '
  + 'MAGE ID charges nothing for this and earns nothing from it. Available on every plan.';

export const FINANCING_TOGGLE_LABEL = 'Offer financing on invoices and your client portal';

/** Why the Payments screen counts sends and clicks but not approvals. */
export const FINANCING_TRACKING_LIMIT =
  'MAGE ID only sees the click. Whether your lender approved or funded a loan is in your lender\'s own dashboard.';

/**
 * "Financing links: 3 created · 1 clicked" — the only two numbers MAGE ID can
 * observe. (One link per project per surface, so "created" is links, not
 * sends.) No "funded": no lender reports back to MAGE ID, so that number could
 * only ever read 0.
 */
export function financingReferralSummary(counts: { created: number; clicked: number }): string {
  const created = Math.max(0, Math.floor(counts.created));
  const clicked = Math.max(0, Math.floor(counts.clicked));
  return `Financing links: ${created} created · ${clicked} clicked`;
}

// ── Invoice screen copy (GC-facing, wave 6d M2) ──────────────────────────────
// What the sent-invoice screen says where the old "Wisetack-style partnership"
// card used to be: MAGE ID has no lending partner, so the screen says whose
// lender the client is sent to, or how to set one up — nothing else.

/** Financing is on: the one line under the Pay link. */
export function invoiceFinancingOnLine(partnerName: string): string {
  return `Financing is on: invoice emails you send and your client portal offer "Check financing options" from ${partnerName.trim()}. `
    + 'MAGE ID is not a lender and is not paid for referrals.';
}

/** Financing is off: a link to Payments, where he brings his own lender. */
export const INVOICE_FINANCING_SETUP_LINE =
  'Want to offer your client monthly payments? Bring your own lender — set it up in Payments →';
