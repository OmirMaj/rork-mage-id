// utils/clientEstimateShareToken.ts
//
// Encode/decode a client-safe estimate proposal into a URL-safe base64 token,
// mirroring utils/photoShareToken.ts so the share UX is identical: one tap →
// /shared-estimate?t=<token>, no backend / auth / Supabase round-trip.
//
// The payload is built ONLY from the client view (ClientEstimateView) plus
// display labels, so the internal cost buildup — base cost, markup, margin,
// unit prices, suppliers, Brain flags — is never encoded into the link.

import type { ClientEstimateView } from './clientEstimateView';

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
  /** Valid-through date (ISO yyyy-mm-dd). */
  valid?: string;
}

export function buildClientEstimateSharePayload(
  view: ClientEstimateView,
  opts: {
    projectName: string;
    gcName?: string;
    clientName?: string;
    inclusions?: string[];
    exclusions?: string[];
    validThrough?: string;
  },
): ClientEstimateSharePayload {
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
    valid: opts.validThrough,
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
