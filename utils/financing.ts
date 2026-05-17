// Single source of truth for the client-financing offer surface. The
// invoice email, estimate email, and client portal all render from here
// so copy / disclosure / URL can never drift between surfaces.
//
// MAGE ID is NOT a lender. This module only builds marketing copy and a
// redirect URL to the partner's hosted prequalification page. No SSN /
// income / bank data is ever collected in-app.

import type { AppSettings, FinancingConfig } from '@/types';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isFinancingAvailable(settings: AppSettings | undefined): boolean {
  const f = settings?.financing;
  return !!f && f.enabled && f.partnerName.trim().length > 0 && /^https:\/\//i.test(f.prequalBaseUrl.trim());
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
  return `Financing provided by ${cfg.partnerName}, a third party, subject to credit approval. MAGE ID is not a lender and may receive compensation.`;
}

export function buildFinancingRedirectUrl(refToken: string): string {
  return `${SUPABASE_FUNCTIONS_URL}/financing-redirect?ref=${encodeURIComponent(refToken)}`;
}

/** Pre-rendered HTML block injected into invoice/estimate emails. Empty
 *  string when financing is unavailable (caller appends unconditionally). */
export function financingEmailBlockHtml(args: {
  settings: AppSettings | undefined;
  amountCents: number;
  refToken: string;
}): string {
  const { settings, amountCents, refToken } = args;
  if (!isFinancingAvailable(settings)) return '';
  const cfg = settings!.financing!;
  const url = buildFinancingRedirectUrl(refToken);
  const monthly = illustrativeMonthly(amountCents, cfg);
  const headline = monthly
    ? `Prefer to pay monthly? Est. <strong>$${monthly.toLocaleString('en-US')}/mo</strong> — see if you prequalify in ~2 min.`
    : `Prefer to pay monthly? See if you prequalify in ~2 min.`;
  const safePartner = escapeHtml(cfg.partnerName);
  const disclosureHtml = `Financing provided by ${safePartner}, a third party, subject to credit approval. MAGE ID is not a lender and may receive compensation.`;
  return `
    <div style="margin:18px 0;padding:16px;border:1px solid #E2E5E9;border-radius:12px;background:#F7F8FA;">
      <p style="margin:0 0 10px;font-size:14px;color:#2B3038;">${headline}</p>
      <a href="${url}" style="display:inline-block;padding:10px 18px;background:#1F6FEB;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Check financing options</a>
      <p style="margin:10px 0 0;font-size:11px;color:#9AA3AD;">${monthly ? 'Estimated payment, not an offer. Actual terms from ' + safePartner + ' on approval. ' : ''}${disclosureHtml}</p>
    </div>`;
}
