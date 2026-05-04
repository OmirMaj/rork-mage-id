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
// .. once). Pure functions, no I/O. Each helper returns an HTML string
// ready to drop into bodyHtml.
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

// Project-bound HMAC seed for unsubscribe / re-subscribe tokens. Not a
// crypto secret in the strong sense — it lives in the deployed edge fn
// code. Threat model: a script attacker could otherwise re-subscribe
// arbitrary emails by guessing the URL, which would put unwanted mail
// into their inboxes. The token gates re-subscribe specifically. Plain
// unsubscribe doesn't require a token (it's user-protective).
const UNSUB_SECRET = 'mage-id-unsub-2026-rotate-on-leak';

/**
 * FNV-1a 64-bit hash of `email:UNSUB_SECRET`, base36-encoded, 12 chars.
 * Synchronous (Web Crypto is async-only and would force every caller of
 * wrapEmailHtml to be async). Sufficient for our threat model — see
 * UNSUB_SECRET note above. If you ever need real crypto here, derive a
 * key from SUPABASE_JWT_SECRET via Web Crypto and make this async.
 */
export function buildUnsubscribeToken(email: string): string {
  const data = email.toLowerCase().trim() + ':' + UNSUB_SECRET;
  // FNV-1a 64-bit
  let h = 14695981039346656037n;
  for (let i = 0; i < data.length; i++) {
    h ^= BigInt(data.charCodeAt(i));
    h = (h * 1099511628211n) & 0xFFFFFFFFFFFFFFFFn;
  }
  return h.toString(36).padStart(12, '0').slice(0, 12);
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  if (!email || !token) return false;
  const expected = buildUnsubscribeToken(email);
  if (expected.length !== token.length) return false;
  // Constant-time compare to avoid timing oracles.
  let r = 0;
  for (let i = 0; i < expected.length; i++) r |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return r === 0;
}

export function buildUnsubscribeUrl(opts: UnsubscribeOpts): string | null {
  if (opts.enabled === false) return null;
  if (!opts.recipientEmail) return null;
  const params = new URLSearchParams();
  params.set('e', opts.recipientEmail);
  if (opts.eventKey) params.set('k', opts.eventKey);
  // Token lets the recipient re-subscribe via /preferences without us
  // exposing a privileged API. Plain unsubscribe ignores it (anyone may
  // suppress an address) — re-subscribe verifies it.
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
  const prefsUrl = opts.unsubscribe?.recipientEmail ? buildPreferencesUrl(opts.unsubscribe.recipientEmail) : null;
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
