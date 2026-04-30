// emailLayout.ts — shared HTML scaffolding for every transactional email
// composed inside the app (the GC manually sends an invoice, CO, daily
// report, etc.). Mirrors supabase/functions/_shared/email.ts EXACTLY so
// system-generated and user-composed emails look identical in the inbox.
//
// Why HTML strings instead of MJML / React Email: Resend serves us a raw
// `html` field, recipients open in everything from Apple Mail to Gmail
// to Outlook 2016. The safest path is hand-built table layouts (yes,
// tables — every email client supports them) with inline styles. Every
// premium SaaS email you've seen in 2024+ is still tables under the
// hood; they just look modern because typography + spacing are generous.
//
// Design language matches the marketing site + portal:
//   ink         #0B0D10   — header, primary buttons, body text
//   amber       #FF6A1A   — eyebrow, accent, secondary buttons
//   cream       #F4EFE6   — page bg, blockquote bg, hero bg
//   sand        #E8DFCD   — card border, dividers
//   fog         #9AA3AD   — meta text, footer
//   stone       #4A5159   — body copy

const INK = '#0B0D10';
const AMBER = '#FF6A1A';
const CREAM = '#F4EFE6';
const SAND = '#E8DFCD';
const FOG = '#9AA3AD';
const STONE = '#4A5159';
const PAPER = '#FFFFFF';

const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;
const FONT_DISPLAY = `Georgia,'Times New Roman',serif`;

export interface ProjectContextOpts {
  name?: string;
  location?: string;
  photoUrl?: string;
}

export interface UnsubscribeOpts {
  recipientEmail?: string;
  eventKey?: string;
  enabled?: boolean;
}

export interface EmailWrapOpts {
  /** Inbox preview text. Falls back to subtitle/title if omitted. */
  preheader?: string;
  /** Small uppercase chip above the title. */
  eyebrow?: string;
  /** Big serif title. */
  title: string;
  /** Sub-line under the title — optional one-sentence framing. */
  subtitle?: string;
  /** Composed body HTML. */
  bodyHtml: string;
  /** Primary CTA button. */
  cta?: { label: string; href: string };
  /** Optional secondary action under the primary. */
  secondaryCta?: { label: string; href: string };
  /** Sender's company name shown in header (e.g. "Smith Builders"). */
  companyName?: string;
  /** Optional logo URL — small square thumbnail in the header. */
  logoUri?: string;
  /** Recipient name; if provided, body opens with "Hi <name>,". Legacy
   *  field — prefer composing into bodyHtml directly. */
  recipientName?: string;
  /** Project context strip — shown right under header when provided. */
  project?: ProjectContextOpts;
  /** Sender's name/email/phone for the "Sent by" footer line. */
  sender?: { name?: string; email?: string; phone?: string };
  /** Legacy fields — folded into sender if `sender` not provided. */
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Override accent color — used for milestone hero treatment. */
  accent?: string;
  /** Unsubscribe context — drives footer link. */
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

export function emailButton(label: string, href: string, accent: string = INK): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 8px;">
      <tr><td align="center" bgcolor="${accent}" style="border-radius:12px;">
        <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:15px 30px;font-family:${FONT_STACK};font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.1px;border-radius:12px;">${escapeHtml(label)}</a>
      </td></tr>
    </table>`;
}

export function emailSecondaryButton(label: string, href: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px auto 8px;">
      <tr><td align="center" style="border-radius:10px;border:1.5px solid ${INK};">
        <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:11px 24px;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:${INK};text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
      </td></tr>
    </table>`;
}

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

export function emailQuote(text: string): string {
  return `<blockquote style="margin:0 0 16px;padding:14px 18px;background:${CREAM};border-left:3px solid ${AMBER};border-radius:8px;font-family:${FONT_STACK};font-style:italic;color:${INK};font-size:15px;line-height:1.55;">${escapeHtml(text)}</blockquote>`;
}

export function emailMetaLine(text: string): string {
  return `<p style="margin:6px 0 0;font-family:${FONT_STACK};font-size:11px;color:${FOG};letter-spacing:1.2px;text-transform:uppercase;font-weight:700;">${escapeHtml(text)}</p>`;
}

export function emailDivider(): string {
  return `<div style="height:1px;background:${SAND};margin:22px 0;"></div>`;
}

export function emailHero(opts: {
  kicker?: string;
  bigText: string;
  subText?: string;
  photoUrl?: string;
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

// Mirrors supabase/functions/_shared/email.ts. Keep these in sync —
// recipients should be able to use either link interchangeably.
const UNSUB_SECRET = 'mage-id-unsub-2026-rotate-on-leak';

export function buildUnsubscribeToken(email: string): string {
  const data = email.toLowerCase().trim() + ':' + UNSUB_SECRET;
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

  // Legacy "Hi {name}," intro — for callers that haven't migrated to the
  // new subtitle/bodyHtml composition. Folds into the body cell.
  const greetingHtml = opts.recipientName
    ? `<p style="margin:0 0 14px;font-family:${FONT_STACK};font-size:15px;color:${STONE};">Hi ${escapeHtml(opts.recipientName)},</p>`
    : '';

  // Fold legacy contact* fields into sender if the new field isn't given.
  const sender = opts.sender ?? (
    (opts.contactName || opts.contactEmail || opts.contactPhone)
      ? { name: opts.contactName, email: opts.contactEmail, phone: opts.contactPhone }
      : undefined
  );

  const ctaHtml = opts.cta ? emailButton(opts.cta.label, opts.cta.href, INK) : '';
  const secondaryHtml = opts.secondaryCta ? emailSecondaryButton(opts.secondaryCta.label, opts.secondaryCta.href) : '';

  const companyName = opts.companyName ?? 'MAGE ID';
  const isCobranded = !!opts.companyName && opts.companyName !== 'MAGE ID';
  const logoCell = opts.logoUri
    ? `<td width="34" valign="middle" style="padding-right:10px;"><img src="${escapeHtml(opts.logoUri)}" alt="" width="34" height="34" style="display:block;width:34px;height:34px;border-radius:8px;" /></td>`
    : '';
  const headerHtml = `
    <tr><td style="background:${INK};padding:22px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          ${logoCell}
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
  const preheader = opts.preheader ?? opts.subtitle ?? opts.title;

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
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${CREAM};opacity:0;">${escapeHtml(preheader)}</div>
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
          ${greetingHtml}
          ${opts.bodyHtml}
          ${ctaHtml}
          ${secondaryHtml}
        </td></tr>
        ${footerHtml({ sender, unsubscribe: opts.unsubscribe })}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Plaintext fallback ──────────────────────────────────────────────

export function htmlToPlaintext(html: string): string {
  let s = html;
  const bodyOpen = s.search(/<body\b[^>]*>/i);
  if (bodyOpen >= 0) {
    s = s.replace(/^[\s\S]*?<body\b[^>]*>/i, '');
    s = s.replace(/<\/body>[\s\S]*$/i, '');
  }
  s = s.replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/gi, '');
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const cleaned = String(label).replace(/<[^>]+>/g, '').trim();
    return cleaned ? `${cleaned} (${href})` : String(href);
  });
  s = s.replace(/<\/(p|div|tr|h\d|li|blockquote|table)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&zwnj;/g, '');
  s = s.replace(/[ \t]+/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.split('\n').map((l) => l.trim()).join('\n').trim();
  return s;
}

// ─── Money formatter (re-exported for builders) ──────────────────────

export function fmtMoney(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0);
  if (isNaN(v)) return '—';
  return '$' + Math.round(v).toLocaleString('en-US');
}
