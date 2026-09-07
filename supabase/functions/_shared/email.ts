// _shared/email.ts — the ONE place every transactional email is built.
//
// Why this file exists: pre-2026-04 we had two systems — utils/emailLayout.ts
// in the app (polished but unused) and an inlined wrapHtml() in notify
// (used by all 14 events but watered-down). They drifted. The notify one
// had no preheader, no project context, no photos, no stat cards, generic
// CTAs. This file consolidates everything. Both notify and send-email
// import from here so there's exactly one design.
//
// Deno-friendly (no Node-specific APIs, no relative-path imports past
// .. once). The HTML/template helpers are pure and return strings; the
// two network helpers — resendSend (Resend) and isEmailUnsubscribed
// (the is_email_unsubscribed RPC) — are the file's only I/O.
//
// Design language matches the marketing site + portal:
//   ink         #0B0D10   — header, primary buttons, body text
//   amber       #FF6A1A   — eyebrow, accent, secondary buttons
//   cream       #F4EFE6   — page bg, blockquote bg, hero bg
//   sand        #E8DFCD   — card border, dividers
//   fog         #9AA3AD   — meta text, footer
//   stone       #4A5159   — body copy
//
// Tables + inline styles only — Outlook on Windows strips <style> blocks.
//
// Every email goes through wrapEmailHtml() which provides the shell:
//   - Preheader (hidden inbox preview)
//   - Header bar (company name + MAGE ID badge)
//   - Optional project context strip (name + location + thumb)
//   - Body card (eyebrow + title + bodyHtml + CTA)
//   - Footer (sent-by line + reply note + unsubscribe link)
//
// Helpers exported for body composition:
//   emailButton, emailSecondaryButton  — CTAs
//   emailStatRow, emailStatCard         — money/data summaries
//   emailHero                           — milestone moments (signed, awarded)
//   emailQuote                          — blockquoted message bodies
//   emailProductCard                    — selection card with image
//   emailDivider, emailMetaLine         — small atoms
//   htmlToPlaintext                     — plaintext fallback generation
//   escapeHtml                          — XSS guard

const INK = '#0B0D10';
const AMBER = '#FF6A1A';
const CREAM = '#F4EFE6';
const SAND = '#E8DFCD';
const FOG = '#9AA3AD';
const STONE = '#4A5159';
const PAPER = '#FFFFFF';

const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;
// Georgia-style serif for hero / display text. We're cautious — most
// premium SaaS emails (Linear, Stripe, Mercury) lean SANS for body and
// SERIF only for big numbers / hero titles.
const FONT_DISPLAY = `Georgia,'Times New Roman',serif`;

export interface ProjectContextOpts {
  /** Project name shown bold in the strip. */
  name?: string;
  /** Address / location line, lighter weight. */
  location?: string;
  /** Optional hero photo URL — square thumbnail on the right. */
  photoUrl?: string;
}

export interface UnsubscribeOpts {
  /** Recipient email — used to encode the unsub URL. */
  recipientEmail?: string;
  /** Event-prefs key (e.g. "portal_message"). Lets the recipient
   *  unsubscribe from this category specifically rather than all. */
  eventKey?: string;
  /** When false, don't show an unsubscribe footer at all (e.g. pure
   *  account / security mail). Defaults to true for everything else. */
  enabled?: boolean;
}

export interface EmailWrapOpts {
  /** Goes in the inbox preview — first 100ish chars matter most. */
  preheader: string;
  /** Small uppercase chip above the title. */
  eyebrow?: string;
  /** Big bold title. */
  title: string;
  /** Sub-line under the title — optional one-sentence framing. */
  subtitle?: string;
  /** The composed body — usually a stack of helpers. */
  bodyHtml: string;
  /** Primary CTA button. Most emails have one. */
  cta?: { label: string; href: string };
  /** Optional secondary action under the primary. */
  secondaryCta?: { label: string; href: string };
  /** Sender's company name shown in header (e.g. "Smith Builders"). */
  companyName?: string;
  /** Project context strip. Shown right under header when provided. */
  project?: ProjectContextOpts;
  /** Sender's name + email + phone for the "Sent by" footer line. */
  sender?: { name?: string; email?: string; phone?: string };
  /** Override accent color — used for milestone hero treatment. */
  accent?: string;
  /** Unsubscribe context — drives footer link + List-Unsubscribe header. */
  unsubscribe?: UnsubscribeOpts;
}

// ─── HTML helpers ────────────────────────────────────────────────────

export function escapeHtml(text: string | number | null | undefined): string {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A primary CTA button. Big, ink-filled, white text, 44px tap target. */
export function emailButton(label: string, href: string, accent: string = INK): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 8px;">
      <tr><td align="center" bgcolor="${accent}" style="border-radius:12px;">
        <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT_STACK};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.1px;border-radius:12px;">${escapeHtml(label)}</a>
      </td></tr>
    </table>`;
}

/** Outline secondary button, smaller. */
export function emailSecondaryButton(label: string, href: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px auto 8px;">
      <tr><td align="center" style="border-radius:10px;border:1.5px solid ${INK};">
        <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:11px 24px;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${INK};text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
      </td></tr>
    </table>`;
}

/** A row inside a stat card. Use emphasize for the totals row. */
export function emailStatRow(label: string, value: string, opts?: { valueColor?: string; emphasize?: boolean }): string {
  const color = opts?.valueColor ?? INK;
  const size = opts?.emphasize ? '20px' : '14px';
  const weight = opts?.emphasize ? '800' : '700';
  return `
    <tr>
      <td style="padding:7px 0;font-family:${FONT_STACK};font-size:13px;color:${FOG};letter-spacing:0.2px;">${escapeHtml(label)}</td>
      <td align="right" style="padding:7px 0;font-family:${FONT_STACK};font-size:${size};font-weight:${weight};color:${color};letter-spacing:-0.3px;">${value}</td>
    </tr>`;
}

/** Boxed pale-cream card wrapping a stack of stat rows. */
export function emailStatCard(rowsHtml: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};border:1px solid ${SAND};border-radius:14px;margin:18px 0;">
      <tr><td style="padding:18px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${rowsHtml}
        </table>
      </td></tr>
    </table>`;
}

/** Italic blockquote — used for portal messages, scope excerpts, Q&A. */
export function emailQuote(text: string): string {
  return `<blockquote style="margin:0 0 16px;padding:14px 18px;background:${CREAM};border-left:3px solid ${AMBER};border-radius:8px;font-family:${FONT_STACK};font-style:italic;color:${INK};font-size:15px;line-height:1.55;">${escapeHtml(text)}</blockquote>`;
}

/** Small uppercase line for meta info (timestamps, IDs). */
export function emailMetaLine(text: string): string {
  return `<p style="margin:6px 0 0;font-family:${FONT_STACK};font-size:11px;color:${FOG};letter-spacing:1.2px;text-transform:uppercase;font-weight:700;">${escapeHtml(text)}</p>`;
}

/** Hairline divider. */
export function emailDivider(): string {
  return `<div style="height:1px;background:${SAND};margin:22px 0;"></div>`;
}

/**
 * Hero block — for milestone emails. Big serif number/title, optional
 * photo, optional accent strip. Use sparingly: contract signed, RFP
 * awarded, project closeout.
 */
export function emailHero(opts: {
  /** Top tiny label, e.g. "CONTRACT SIGNED". */
  kicker?: string;
  /** Big serif headline. Usually a number or short phrase. */
  bigText: string;
  /** Lighter sub-headline. */
  subText?: string;
  /** Optional photo above the text — wide aspect, 600x240ish. */
  photoUrl?: string;
  /** Accent color for the kicker + photo border glow. */
  accent?: string;
}): string {
  const accent = opts.accent ?? AMBER;
  const photo = opts.photoUrl
    ? `<tr><td style="padding:0;"><img src="${escapeHtml(opts.photoUrl)}" alt="" width="600" style="display:block;width:100%;max-width:600px;height:auto;border-bottom:3px solid ${accent};" /></td></tr>`
    : '';
  const kicker = opts.kicker
    ? `<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:11px;font-weight:800;color:${accent};letter-spacing:2px;text-transform:uppercase;">${escapeHtml(opts.kicker)}</p>`
    : '';
  const sub = opts.subText
    ? `<p style="margin:8px 0 0;font-family:${FONT_STACK};font-size:15px;color:${STONE};line-height:1.5;">${escapeHtml(opts.subText)}</p>`
    : '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};border-radius:16px;overflow:hidden;margin:0 0 22px;">
      ${photo}
      <tr><td style="padding:28px 26px 26px;">
        ${kicker}
        <h2 style="margin:0;font-family:${FONT_DISPLAY};font-size:32px;font-weight:700;color:${INK};letter-spacing:-0.6px;line-height:1.1;">${escapeHtml(opts.bigText)}</h2>
        ${sub}
      </td></tr>
    </table>`;
}

/**
 * Selection product card — image + name + brand + category + price.
 * Used by selection_chosen email. Image is square, left-aligned.
 */
export function emailProductCard(opts: {
  imageUrl?: string;
  productName: string;
  brand?: string;
  category?: string;
  price?: string;
  overBudget?: boolean;
}): string {
  const imgCell = opts.imageUrl
    ? `<td width="120" valign="top" style="padding:0 16px 0 0;"><img src="${escapeHtml(opts.imageUrl)}" alt="${escapeHtml(opts.productName)}" width="120" height="120" style="display:block;width:120px;height:120px;border-radius:10px;border:1px solid ${SAND};object-fit:cover;" /></td>`
    : '';
  const priceLine = opts.price
    ? `<p style="margin:8px 0 0;font-family:${FONT_STACK};font-size:16px;font-weight:800;color:${INK};letter-spacing:-0.2px;">${escapeHtml(opts.price)}${opts.overBudget ? ` <span style="display:inline-block;margin-left:6px;padding:2px 8px;background:#FFE4D5;color:#C2410C;font-size:11px;font-weight:700;border-radius:999px;letter-spacing:0.4px;text-transform:uppercase;">over allowance</span>` : ''}</p>`
    : '';
  const categoryLine = opts.category
    ? `<p style="margin:0 0 4px;font-family:${FONT_STACK};font-size:11px;font-weight:800;color:${AMBER};letter-spacing:1.2px;text-transform:uppercase;">${escapeHtml(opts.category)}</p>`
    : '';
  const brandLine = opts.brand
    ? `<p style="margin:2px 0 0;font-family:${FONT_STACK};font-size:13px;color:${STONE};">${escapeHtml(opts.brand)}</p>`
    : '';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};border:1px solid ${SAND};border-radius:14px;margin:14px 0 18px;">
      <tr><td style="padding:16px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            ${imgCell}
            <td valign="top" style="padding:4px 0;">
              ${categoryLine}
              <p style="margin:0;font-family:${FONT_STACK};font-size:17px;font-weight:700;color:${INK};letter-spacing:-0.3px;line-height:1.3;">${escapeHtml(opts.productName)}</p>
              ${brandLine}
              ${priceLine}
            </td>
          </tr>
        </table>
      </td></tr>
    </table>`;
}

/**
 * Photo strip — up to 3 thumbnails in a row. Used in DFR / closeout
 * recap. Skips silently if zero URLs.
 */
export function emailPhotoStrip(urls: string[]): string {
  const cells = urls.slice(0, 3).map((u) =>
    `<td width="33%" style="padding:0 4px;"><img src="${escapeHtml(u)}" width="180" height="120" alt="" style="display:block;width:100%;height:auto;border-radius:8px;border:1px solid ${SAND};object-fit:cover;" /></td>`,
  ).join('');
  if (!cells) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;"><tr>${cells}</tr></table>`;
}

// ─── Internal: project context strip ─────────────────────────────────

function projectContextHtml(opts: ProjectContextOpts): string {
  if (!opts.name && !opts.location) return '';
  const photo = opts.photoUrl
    ? `<td width="56" valign="middle" style="padding:0 14px 0 0;"><img src="${escapeHtml(opts.photoUrl)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid ${SAND};" /></td>`
    : '';
  const name = opts.name
    ? `<p style="margin:0;font-family:${FONT_STACK};font-size:15px;font-weight:700;color:${INK};letter-spacing:-0.2px;">${escapeHtml(opts.name)}</p>`
    : '';
  const loc = opts.location
    ? `<p style="margin:2px 0 0;font-family:${FONT_STACK};font-size:13px;color:${FOG};">${escapeHtml(opts.location)}</p>`
    : '';
  return `
    <tr><td style="background:${CREAM};padding:14px 32px;border-bottom:1px solid ${SAND};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${photo}
          <td valign="middle">
            ${name}
            ${loc}
          </td>
        </tr>
      </table>
    </td></tr>`;
}

// ─── Internal: footer ───────────────────────────────────────────────

const PORTAL_BASE_URL = 'https://mageid.app';

// ─── Unsubscribe / preferences tokens ────────────────────────────────
//
// Audit 2026-09-03 OPS-F11: the token used to be FNV-1a over a string
// literal that ships in the deployed bundle — anyone who read the bundle
// (get_edge_function returns this file verbatim) could globally suppress
// any address's invoices, dunning and COI warnings. It is now
// HMAC-SHA256 keyed by the UNSUB_SECRET edge secret, truncated to 128
// bits and base64url-encoded (22 chars, no padding). The token gates BOTH
// directions in unsubscribe/index.ts (suppress + re-subscribe).
//
// Why a hand-written digest: Web Crypto's HMAC is async-only and
// wrapEmailHtml is synchronous with fourteen callers across the edge
// functions, so the SHA-256 (FIPS 180-4) + HMAC (RFC 2104) live here in
// plain JS. scripts/validate-edge-security.ts proves byte-equality against
// crypto.subtle on every ship-check.
//
// FAIL CLOSED: with UNSUB_SECRET unset, minting THROWS — every function
// that renders an unsubscribable email 500s instead of shipping a
// forgeable link — and verification returns false. Set the secret before
// deploying anything that imports this file.

const UNSUB_SECRET = Deno.env.get('UNSUB_SECRET') || '';
// A3 (review 2026-09-04): the MAC is bound to a purpose + version prefix so a
// token for this feature can never be replayed against another HMAC use of
// the same secret, and can be rotated by bumping the version.
const UNSUB_TOKEN_PURPOSE = 'unsub:v1:';

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Synchronous SHA-256 (FIPS 180-4). Exported so the ship-check can test it. */
export function sha256(message: Uint8Array): Uint8Array {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const bitLen = message.length * 8;
  // Pad to a 64-byte multiple that still fits the 0x80 marker + 8-byte length.
  const padLen = ((message.length + 9 + 63) >> 6) << 6;
  const buf = new Uint8Array(padLen);
  buf.set(message);
  buf[message.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(padLen - 4, bitLen >>> 0, false);
  const W = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15], w2 = W[i - 2];
      const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
      const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i], false);
  return out;
}

/** Synchronous HMAC-SHA256 (RFC 2104). Exported so the ship-check can test it. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const BLOCK = 64;
  const k = key.length > BLOCK ? sha256(key) : key;
  const padded = new Uint8Array(BLOCK);
  padded.set(k);
  const inner = new Uint8Array(BLOCK + message.length);
  const outer = new Uint8Array(BLOCK + 32);
  for (let i = 0; i < BLOCK; i++) { inner[i] = padded[i] ^ 0x36; outer[i] = padded[i] ^ 0x5c; }
  inner.set(message, BLOCK);
  outer.set(sha256(inner), BLOCK);
  return sha256(outer);
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** True when UNSUB_SECRET is configured — endpoints check this to 500 loudly. */
export function unsubscribeSecretConfigured(): boolean {
  return UNSUB_SECRET.length > 0;
}

/** HMAC-SHA256(UNSUB_SECRET, 'unsub:v1:' + lowercased email), first 128 bits, base64url (22 chars). */
export function buildUnsubscribeToken(email: string): string {
  if (!UNSUB_SECRET) {
    throw new Error('UNSUB_SECRET is not set — refusing to mint an unsubscribe token (set the edge secret before sending mail)');
  }
  const enc = new TextEncoder();
  const mac = hmacSha256(enc.encode(UNSUB_SECRET), enc.encode(UNSUB_TOKEN_PURPOSE + email.toLowerCase().trim()));
  return base64Url(mac.subarray(0, 16));
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  if (!email || !token || !UNSUB_SECRET) return false;
  const expected = buildUnsubscribeToken(email);
  if (expected.length !== token.length) return false;
  // Constant-time compare to avoid timing oracles.
  let r = 0;
  for (let i = 0; i < expected.length; i++) r |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return r === 0;
}

// ─── LEGACY pre-rotation token — DELETE after 2026-10-04 ─────────────
//
// Review 2026-09-05: every unsubscribe link in mail sent BEFORE the HMAC
// rotation carries the OLD 12-char FNV-1a token, which verifyUnsubscribeToken
// now rejects — a homeowner clicking "Unsubscribe" in last month's digest
// would get token_invalid. unsubscribe/index.ts accepts this token for the
// UNSUBSCRIBE direction only (never re-subscribe) until its
// LEGACY_UNSUB_GRACE_UNTIL, then both sides must be deleted together.
//
// The seed below shipped verbatim in the deployed bundle for months and is
// public — which is exactly why it can only ever authorize the
// user-protective direction. This is the ONLY permitted caller of it
// (validate-edge-security pins the single importer and the resubscribe
// path's silence about it). Never mint with it; never import it elsewhere.
export function legacyFnvUnsubscribeToken(email: string): string {
  const data = email.toLowerCase().trim() + ':mage-id-unsub-2026-rotate-on-leak';
  let h = 14695981039346656037n;
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data.charCodeAt(i));
    h = (h * 1099511628211n) & 0xFFFFFFFFFFFFFFFFn;
  }
  return h.toString(36).padStart(12, '0').slice(0, 12);
}

export function buildUnsubscribeUrl(opts: UnsubscribeOpts): string | null {
  if (opts.enabled === false) return null;
  if (!opts.recipientEmail) return null;
  const params = new URLSearchParams();
  params.set('e', opts.recipientEmail);
  if (opts.eventKey) params.set('k', opts.eventKey);
  // The signed token gates BOTH directions in unsubscribe/index.ts (suppress
  // AND re-subscribe): the Gmail one-click POST reads it from this URL's query
  // and the static marketing/unsubscribe page forwards it as `token` (review
  // B2, 2026-09-04). Without it anyone could globally suppress any address.
  params.set('t', buildUnsubscribeToken(opts.recipientEmail));
  return `${PORTAL_BASE_URL}/unsubscribe?${params.toString()}`;
}

export function buildPreferencesUrl(email: string): string {
  const params = new URLSearchParams();
  params.set('e', email);
  params.set('t', buildUnsubscribeToken(email));
  return `${PORTAL_BASE_URL}/preferences?${params.toString()}`;
}

function footerHtml(opts: {
  sender?: { name?: string; email?: string; phone?: string };
  unsubscribe?: UnsubscribeOpts;
}): string {
  const senderLine = (opts.sender?.name || opts.sender?.email || opts.sender?.phone)
    ? `<p style="margin:0 0 6px;font-family:${FONT_STACK};font-size:12px;color:${STONE};line-height:1.5;">Sent by <strong style="color:${INK}">${escapeHtml(opts.sender?.name ?? '')}</strong>${opts.sender?.email ? ` · ${escapeHtml(opts.sender.email)}` : ''}${opts.sender?.phone ? ` · ${escapeHtml(opts.sender.phone)}` : ''}. Replies go to them, not us.</p>`
    : '';

  const unsubUrl = opts.unsubscribe ? buildUnsubscribeUrl(opts.unsubscribe) : null;
  // No preferences link (and so no token) when the email is not unsubscribable
  // (account / security mail) — those must render even before UNSUB_SECRET is set.
  const prefsUrl = (opts.unsubscribe?.enabled !== false && opts.unsubscribe?.recipientEmail)
    ? buildPreferencesUrl(opts.unsubscribe.recipientEmail)
    : null;
  const unsubLine = unsubUrl
    ? `<p style="margin:10px 0 0;font-family:${FONT_STACK};font-size:11px;color:${FOG};line-height:1.6;"><a href="${escapeHtml(unsubUrl)}" style="color:${FOG};text-decoration:underline;">Unsubscribe from these notifications</a>${prefsUrl ? ` · <a href="${escapeHtml(prefsUrl)}" style="color:${FOG};text-decoration:underline;">manage email preferences</a>` : ''}</p>`
    : '';

  return `
    <tr><td style="padding:22px 32px 28px;background:#FAFAF7;border-top:1px solid ${SAND};">
      ${senderLine}
      <p style="margin:0;font-family:${FONT_STACK};font-size:11px;color:${FOG};line-height:1.6;">
        Powered by <a href="${PORTAL_BASE_URL}" style="color:${INK};font-weight:700;text-decoration:none;">MAGE ID</a> — the operating system for general contractors.
      </p>
      ${unsubLine}
    </td></tr>`;
}

// ─── Main wrapper ────────────────────────────────────────────────────

export function wrapEmailHtml(opts: EmailWrapOpts): string {
  const accent = opts.accent ?? AMBER;
  const eyebrowHtml = opts.eyebrow
    ? `<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:11px;font-weight:800;color:${accent};letter-spacing:1.6px;text-transform:uppercase;">${escapeHtml(opts.eyebrow)}</p>`
    : '';
  const subtitleHtml = opts.subtitle
    ? `<p style="margin:10px 0 0;font-family:${FONT_STACK};font-size:16px;color:${STONE};line-height:1.55;">${escapeHtml(opts.subtitle)}</p>`
    : '';

  const ctaHtml = opts.cta ? emailButton(opts.cta.label, opts.cta.href, INK) : '';
  const secondaryHtml = opts.secondaryCta ? emailSecondaryButton(opts.secondaryCta.label, opts.secondaryCta.href) : '';

  // Header — ink bg, company name on the left, "via MAGE ID" subtitle.
  const companyName = opts.companyName ?? 'MAGE ID';
  const isCobranded = !!opts.companyName && opts.companyName !== 'MAGE ID';
  const headerHtml = `
    <tr><td style="background:${INK};padding:22px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td valign="middle">
            <p style="margin:0;font-family:${FONT_STACK};font-size:18px;font-weight:800;color:#FFFFFF;letter-spacing:-0.3px;line-height:1.1;">${escapeHtml(companyName)}</p>
            ${isCobranded ? `<p style="margin:3px 0 0;font-family:${FONT_STACK};font-size:11px;color:#9AA3AD;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;">via MAGE ID</p>` : ''}
          </td>
          <td align="right" valign="middle">
            <span style="display:inline-block;padding:5px 11px;border-radius:999px;background:${accent};color:#0B0D10;font-family:${FONT_STACK};font-size:10px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">MAGE&nbsp;ID</span>
          </td>
        </tr>
      </table>
    </td></tr>`;

  const projectStrip = opts.project ? projectContextHtml(opts.project) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};font-family:${FONT_STACK};color:${INK};">
  <!-- Preheader: hidden inbox preview text -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${CREAM};opacity:0;">${escapeHtml(opts.preheader)}</div>
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${CREAM};opacity:0;">&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:${PAPER};border-radius:18px;overflow:hidden;border:1px solid ${SAND};">
        ${headerHtml}
        ${projectStrip}
        <tr><td style="padding:34px 32px 8px;">
          ${eyebrowHtml}
          <h1 style="margin:0;font-family:${FONT_DISPLAY};font-size:30px;font-weight:700;color:${INK};letter-spacing:-0.6px;line-height:1.18;">${escapeHtml(opts.title)}</h1>
          ${subtitleHtml}
        </td></tr>
        <tr><td style="padding:18px 32px 28px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${STONE};">
          ${opts.bodyHtml}
          ${ctaHtml}
          ${secondaryHtml}
        </td></tr>
        ${footerHtml({ sender: opts.sender, unsubscribe: opts.unsubscribe })}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Plaintext fallback ──────────────────────────────────────────────
//
// Resend auto-fills `text` from `html` if you omit it, but their version
// is messy (preserves all whitespace, drops links). We pass our own so
// recipients on plaintext-only clients (and accessibility tools) get a
// readable version. Algorithm: drop the head, decode entities, replace
// block elements with newlines, replace links with "label (url)", strip
// remaining tags, collapse whitespace.

export function htmlToPlaintext(html: string): string {
  let s = html;
  // Drop everything before <body> (head, doctype, etc.)
  const bodyOpen = s.search(/<body\b[^>]*>/i);
  if (bodyOpen >= 0) {
    s = s.replace(/^[\s\S]*?<body\b[^>]*>/i, '');
    s = s.replace(/<\/body>[\s\S]*$/i, '');
  }
  // Drop hidden preheader divs (display:none).
  s = s.replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, '');
  // <a href="...">label</a> → "label (url)"
  // URL-encode raw `=` chars in the href before emitting it. SMTP wraps
  // long plaintext lines using quoted-printable, where `=` is the escape
  // character; long URLs with `?key=val` get split mid-`=` and downstream
  // decoders mangle "=5f24..." → "_24..." (because `=5f` is QP for `_`).
  // Encoding `=` to `%3D` sidesteps the collision; modern mail clients
  // and browsers handle %3D in URL params transparently.
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const safeHref = String(href).replace(/=/g, '%3D');
    const cleaned = String(label).replace(/<[^>]+>/g, '').trim();
    return cleaned ? `${cleaned} (${safeHref})` : safeHref;
  });
  // Block-level tags → newlines
  s = s.replace(/<\/(p|div|tr|h\d|li|blockquote|table)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, '');
  // Decode the entities we emit.
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&zwnj;/g, '');
  // Collapse whitespace
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.split('\n').map((l) => l.trim()).join('\n').trim();
  return s;
}

// ─── FROM helpers ────────────────────────────────────────────────────

/**
 * Build a personalized FROM header. Resend wants `Display Name <addr>`.
 * Display name with commas / quotes must be RFC-2822 quoted. We strip the
 * worst-offender characters rather than escape — sender display names
 * don't need apostrophes or weird punctuation, and a clean name reads
 * better in inboxes.
 */
export function buildFromAddress(companyName: string | null | undefined, fallback = 'MAGE ID <noreply@mageid.app>'): string {
  if (!companyName) return fallback;
  const cleaned = String(companyName)
    .replace(/[<>"\\]/g, '')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  if (!cleaned || cleaned.toLowerCase() === 'mage id') return fallback;
  return `${cleaned} via MAGE ID <noreply@mageid.app>`;
}

// ─── Resend send() with full headers ─────────────────────────────────

export interface SendOpts {
  to: string;
  subject: string;
  html: string;
  /** Auto-generated from html if omitted. */
  text?: string;
  replyTo?: string;
  /** Display name for the FROM. Helper appends "via MAGE ID <addr>". */
  fromCompanyName?: string;
  /** Pre-built FROM string — bypasses fromCompanyName. */
  fromOverride?: string;
  /** Unsubscribe context — drives List-Unsubscribe headers (Gmail
   *  Feb-2024 bulk-sender requirement). */
  unsubscribe?: UnsubscribeOpts;
}

/**
 * Hit Resend with the full set of headers we want on every send.
 * Returns { ok, resp } so the caller can log to outbox.
 */
export async function resendSend(apiKey: string, opts: SendOpts): Promise<{ ok: boolean; resp: unknown }> {
  if (!apiKey) return { ok: false, resp: { error: 'no_api_key' } };
  const text = opts.text ?? htmlToPlaintext(opts.html);
  const from = opts.fromOverride ?? buildFromAddress(opts.fromCompanyName);

  const headers: Record<string, string> = {};
  const unsubUrl = opts.unsubscribe ? buildUnsubscribeUrl(opts.unsubscribe) : null;
  if (unsubUrl) {
    // RFC 8058 + RFC 2369. Gmail also accepts a mailto: option as a
    // fallback for clients that don't do POST one-click.
    headers['List-Unsubscribe'] = `<${unsubUrl}>, <mailto:unsubscribe@mageid.app?subject=Unsubscribe%20${encodeURIComponent(opts.unsubscribe?.eventKey ?? '')}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  // Help downstream filters group + categorize.
  headers['X-Entity-Ref-ID'] = `mageid-${Date.now()}`;

  const payload: Record<string, unknown> = {
    from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text,
  };
  if (opts.replyTo) payload.reply_to = opts.replyTo;
  if (Object.keys(headers).length > 0) payload.headers = headers;

  // Resend's free tier rate-limits at 5 req/sec. Under bursty fan-outs
  // (e.g. 50-event marketplace broadcast, 20-bidder Q&A answer) we hit
  // 429 on ~88% of calls and silently lose them. Retry with jittered
  // exponential backoff — up to 4 attempts, ~3.5s total worst case.
  // Non-429 errors (auth, validation, network) fail through immediately.
  const MAX_ATTEMPTS = 4;
  const BASE_MS = 350;
  let lastResp: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const resp = await r.json().catch(() => ({}));
      if (r.ok) return { ok: true, resp };
      lastResp = resp;
      // Only retry on 429 (rate limit). Other failures are deterministic.
      if (r.status !== 429 || attempt === MAX_ATTEMPTS - 1) {
        return { ok: false, resp };
      }
      const wait = BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise((res) => setTimeout(res, wait));
    } catch (e) {
      return { ok: false, resp: { error: String(e) } };
    }
  }
  return { ok: false, resp: lastResp ?? { error: 'rate_limit_exhausted' } };
}

// ─── Pre-send unsubscribe check ──────────────────────────────────────
//
// Mirrors notify/index.ts's local isUnsubscribed EXACTLY at the RPC
// level: POST /rest/v1/rpc/is_email_unsubscribed with
// { p_email: <lowercased>, p_event_key }, returns true iff the address
// is suppressed for that event_key OR globally (the RPC folds global in).
// Fail-OPEN on any error (bad status, network throw): we'd rather send a
// duplicate than silently drop legitimate mail on a transient glitch —
// identical risk posture to notify, which already runs this in prod.
//
// Takes supabaseUrl + serviceRoleKey explicitly (dependency-injected,
// same style as resendSend(apiKey, opts)) because shared code can't
// close over a single function's module-scoped env constants.
export async function isEmailUnsubscribed(
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string | null | undefined,
  eventKey: string,
): Promise<boolean> {
  if (!email) return false;
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/rpc/is_email_unsubscribed`, {
      method: 'POST',
      headers: {
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_email: email.toLowerCase(), p_event_key: eventKey }),
    });
    if (!r.ok) return false;
    const v = await r.json();
    return v === true;
  } catch {
    return false;
  }
}

// ─── Money formatter ─────────────────────────────────────────────────

export function fmtMoney(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (isNaN(v)) return '—';
  return '$' + Math.round(v).toLocaleString('en-US');
}

// ─── Subject-line emoji helpers ──────────────────────────────────────
// Email clients render emoji inconsistently. Use sparingly: milestones
// only, and never as the FIRST char (some inbox previews crop it).
export const EMOJI = {
  approved: '✓',
  declined: '✗',
  paid: '✓',
  signed: '✓',
  awarded: '🏆',
  celebrate: '🎉',
  binder: '📦',
} as const;
