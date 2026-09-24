// Single source of truth for the client-financing offer surface. The
// invoice email renders from here and the client portal renders from the
// snapshot block built by utils/financingCore (the same words), so copy /
// disclosure / URL can never drift between surfaces. (Estimate emails do not
// carry the offer; the Payments toggle says "invoices and your client portal".)
//
// MAGE ID is NOT a lender and has no lending partner ("bring your own
// lender"). This module only builds copy and a redirect URL to the GC's
// lender's hosted prequalification page. No SSN / income / bank data is ever
// collected in-app, and MAGE ID is not paid for a referral.

import type { AppSettings, FinancingConfig } from '@/types';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';
import { financingConfigLive, financingDisclosureText } from '@/utils/financingCore';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isFinancingAvailable(settings: AppSettings | undefined): boolean {
  return financingConfigLive(settings?.financing);
}

/** Standard amortized monthly payment. Returns null when an illustrative
 *  figure must NOT be shown (no example terms configured, or no amount). */
export function illustrativeMonthly(amountCents: number, cfg: FinancingConfig): number | null {
  if (!cfg.exampleApr || !cfg.exampleTermMonths || amountCents <= 0) return null;
  const principal = amountCents / 100;
  const r = cfg.exampleApr / 100 / 12;
  const n = cfg.exampleTermMonths;
  if (r === 0) return principal / n;
  const m = (principal * r) / (1 - Math.pow(1 + r, -n));
  return Math.round(m);
}

export function financingDisclosure(cfg: FinancingConfig): string {
  return financingDisclosureText(cfg.partnerName);
}

/**
 * The ref shape financing-redirect accepts (its REF_RE): `fin_` + 32 lower-
 * case hex, as useFinancingReferrals.ensureReferral mints it. The ref is the
 * whole capability — the link carries no signature — so anything else is not
 * a link we can send.
 */
export const FINANCING_REF_RE = /^fin_[0-9a-f]{32}$/;
export function isFinancingRefToken(refToken: string | null | undefined): boolean {
  return typeof refToken === 'string' && FINANCING_REF_RE.test(refToken);
}

export function buildFinancingRedirectUrl(refToken: string): string {
  return `${SUPABASE_FUNCTIONS_URL}/financing-redirect?ref=${encodeURIComponent(refToken)}`;
}

/** Pre-rendered HTML block injected into invoice emails. Empty
 *  string when financing is unavailable (caller appends unconditionally). */
export function financingEmailBlockHtml(args: {
  settings: AppSettings | undefined;
  amountCents: number;
  refToken: string;
}): string {
  const { settings, amountCents, refToken } = args;
  if (!isFinancingAvailable(settings)) return '';
  // No referral row → financing-redirect can only fall back to the MAGE ID
  // homepage (#180). Never email a button that can't reach the lender.
  if (!isFinancingRefToken(refToken)) return '';
  const cfg = settings!.financing!;
  const url = buildFinancingRedirectUrl(refToken);
  const monthly = illustrativeMonthly(amountCents, cfg);
  const headline = monthly
    ? `Prefer to pay monthly? Est. <strong>$${monthly.toLocaleString('en-US')}/mo</strong> — see if you prequalify with ${escapeHtml(cfg.partnerName)}.`
    : `Prefer to pay monthly? See if you prequalify with ${escapeHtml(cfg.partnerName)}.`;
  const safePartner = escapeHtml(cfg.partnerName);
  const disclosureHtml = escapeHtml(financingDisclosureText(cfg.partnerName));
  return `
    <div style="margin:18px 0;padding:16px;border:1px solid #E2E5E9;border-radius:12px;background:#F7F8FA;">
      <p style="margin:0 0 10px;font-size:14px;color:#2B3038;">${headline}</p>
      <a href="${url}" style="display:inline-block;padding:10px 18px;background:#1F6FEB;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Check financing options</a>
      <p style="margin:10px 0 0;font-size:11px;color:#9AA3AD;">${monthly ? 'Estimated payment, not an offer. Actual terms from ' + safePartner + ' on approval. ' : ''}${disclosureHtml}</p>
    </div>`;
}
