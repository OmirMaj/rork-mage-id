// utils/clientEstimateShareToken.ts
//
// Encode/decode a client-safe estimate proposal into a URL-safe base64 token,
// mirroring utils/photoShareToken.ts so the share UX is identical: one tap →
// /shared-estimate?t=<token>, no backend / auth / Supabase round-trip.
//
// The payload is built ONLY from the client view (ClientEstimateView) plus
// display labels, so the internal cost buildup — base cost, markup, margin,
// unit prices, suppliers, Brain flags — is never encoded into the link.

import type { ClientEstimateView, PaymentMilestone } from './clientEstimateView';

/** v1 payload. Short field names keep tokens small. */
export interface ClientEstimateSharePayload {
  v: 1;
  /** Project name (header). */
  n: string;
  /** Contractor / company name (footer). */
  gc?: string;
  /** Prepared-for client name. */
  cl?: string;
  /** Fixed project total the client pays. */
  total: number;
  /** Scope groups: key, label, amount. */
  scope: { k: string; l: string; a: number }[];
  /** Allowances: name, amount. */
  allow?: { n: string; a: number }[];
  /** Inclusions. */
  inc?: string[];
  /** Exclusions. */
  exc?: string[];
  /** Payment schedule: label, detail, optional amount. */
  pay?: { l: string; d: string; a?: number }[];
  /** Valid-through date (ISO yyyy-mm-dd). */
  valid?: string;
  // How the homeowner answers (audit 2026-09-18, #123). The link used to end
  // at "Powered by MAGE ID": no phone, no email, no way to say yes. All three
  // are optional and additive, so the token stays v:1 and every link already
  // sent still decodes — it simply has no contact block. Each is filled ONLY
  // from what the GC saved; nothing is invented.
  /** Contractor phone, from his saved branding. */
  ph?: string;
  /** Contractor email, from his saved branding. */
  em?: string;
  /** The closing "to proceed" sentence — utils/paymentTerms.acceptanceSentence
   *  for his split, the same words the PDF prints. */
  acc?: string;
}

export function buildClientEstimateSharePayload(
  view: ClientEstimateView,
  opts: {
    projectName: string;
    gcName?: string;
    clientName?: string;
    inclusions?: string[];
    exclusions?: string[];
    paymentSchedule?: PaymentMilestone[];
    validThrough?: string;
    gcPhone?: string;
    gcEmail?: string;
    acceptance?: string;
  },
): ClientEstimateSharePayload {
  const clean = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);
  return {
    v: 1,
    n: opts.projectName,
    gc: opts.gcName,
    cl: opts.clientName,
    total: view.projectTotal,
    scope: view.scopeGroups.map(g => ({ k: g.key, l: g.label, a: g.total })),
    allow: view.allowances.length ? view.allowances.map(a => ({ n: a.name, a: a.amount })) : undefined,
    inc: opts.inclusions?.length ? opts.inclusions : undefined,
    exc: opts.exclusions?.length ? opts.exclusions : undefined,
    pay: opts.paymentSchedule?.length
      ? opts.paymentSchedule.map(m => ({ l: m.label, d: m.detail, ...(m.amount !== undefined ? { a: m.amount } : {}) }))
      : undefined,
    valid: opts.validThrough,
    ph: clean(opts.gcPhone),
    em: clean(opts.gcEmail),
    acc: clean(opts.acceptance),
  };
}

export function encodeClientEstimateToken(payload: ClientEstimateSharePayload): string {
  const json = JSON.stringify(payload);
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : null;
  const ascii = bytes
    ? Array.from(bytes).map(b => String.fromCharCode(b)).join('')
    : json;
  const b64 = typeof btoa === 'function'
    ? btoa(ascii)
    : Buffer.from(json, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeClientEstimateToken(token: string): ClientEstimateSharePayload | null {
  try {
    if (!token) return null;
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const ascii = typeof atob === 'function'
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, 'base64').toString('binary');
    const bytes = Uint8Array.from(ascii, c => c.charCodeAt(0));
    const json = typeof TextDecoder !== 'undefined'
      ? new TextDecoder().decode(bytes)
      : ascii;
    const parsed = JSON.parse(json) as ClientEstimateSharePayload;
    if (parsed.v !== 1 || typeof parsed.total !== 'number' || !Array.isArray(parsed.scope)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** What the "To proceed" block on /shared-estimate shows. */
export interface ShareProceedBlock {
  sentence: string;
  phone?: { label: string; href: string };
  email?: { label: string; href: string };
}

/** Fallback when the link carries no contact and no sentence (every link sent
 *  before 2026-09-18, and a GC with no phone/email saved): the one reply path
 *  that always exists is the message the link arrived in. */
export const SHARE_REPLY_FALLBACK = 'Reply to the message this link came in to accept.';

// acceptanceSentence (utils/paymentTerms) is written for the PDF, which the
// homeowner CAN reply to by email. A web page cannot be replied to, so the one
// phrase that assumes it is re-aimed at a path that exists on this page.
const PDF_REPLY_PHRASE = 'reply to this estimate with your approval';

/**
 * The contact / accept block for a shared proposal (#123). Pure, so the
 * validator runs the exact function the screen renders. A phone or email
 * appears only when the link carries one — never a placeholder — and the
 * tel:/mailto: targets are built from a fixed scheme, so a crafted token cannot
 * turn a contact link into anything else.
 */
export function shareProceedBlock(p: Pick<ClientEstimateSharePayload, 'ph' | 'em' | 'acc'>): ShareProceedBlock {
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const phone = str(p.ph);
  const dial = phone.replace(/[^\d+]/g, '');
  const email = str(p.em);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const out: ShareProceedBlock = { sentence: SHARE_REPLY_FALLBACK };
  if (phone && dial.replace(/\D/g, '').length >= 7) out.phone = { label: phone, href: `tel:${dial}` };
  if (emailOk) out.email = { label: email, href: `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}` };
  const acc = str(p.acc);
  if (acc) {
    const hasContact = !!(out.phone || out.email);
    out.sentence = acc.includes(PDF_REPLY_PHRASE)
      ? acc.replace(PDF_REPLY_PHRASE, hasContact
        ? 'send us your approval using the contact details below'
        : 'reply to the message this link came in with your approval')
      : acc;
  }
  return out;
}
