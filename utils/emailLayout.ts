// emailLayout.ts — shared HTML scaffolding for every transactional email.
//
// Every email we send (welcome, invoice, change order, daily report,
// submittal, etc.) wraps its content in wrapEmailHtml() so the brand
// presentation is consistent: ink-and-amber palette mirroring the
// marketing site, the same header (company name + MAGE ID badge), the
// same footer (contact info + "powered by MAGE ID" + unsubscribe), and
// a unified button helper.
//
// Why HTML strings instead of MJML / React Email: Resend serves us a
// raw `html` field, recipients open in everything from Apple Mail to
// Gmail to Outlook 2016. The safest path is hand-built table layouts
// (yes, tables — every email client supports them) with inline styles
// (no <style> blocks because Outlook strips <style> on Windows). Every
// premium SaaS email you've seen in 2024+ is still tables under the
// hood; they just look modern because the typography + spacing are
// generous.

export interface EmailWrapOpts {
  /** The contractor's company name. Renders in the header. Falls back to "MAGE ID". */
  companyName?: string;
  /** Company logo URL — if present, renders to the left of the company name in the header. */
  logoUri?: string;
  /** Recipient's first/full name; if provided, the body opens with "Hi <name>,". */
  recipientName?: string;
  /** Optional eyebrow text that appears small + uppercase above the title (e.g. "INVOICE #14"). */
  eyebrow?: string;
  /** Big bold title at the top of the body card. */
  title: string;
  /** The HTML body content rendered inside the card (already-built rows, tables, etc.). */
  bodyHtml: string;
  /** Footer contact lines — name, email, phone. Rendered subtly at bottom. */
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Optional accent color override for the eyebrow + primary CTA button. Defaults to amber. */
  accent?: string;
}

const DEFAULT_ACCENT = '#FF6A1A';
const INK = '#0B0D10';
const CREAM = '#F4EFE6';
const FOG = '#9AA3AD';

/**
 * Render an HTML primary-action button. Keep height generous (44px) so
 * it's a clean tap target on mobile clients.
 */
export function emailButton(label: string, href: string, accent: string = DEFAULT_ACCENT): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;">
      <tr><td align="center" bgcolor="${INK}" style="border-radius:12px;padding:0;">
        <a href="${href}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;letter-spacing:0.2px;border-radius:12px;">
          ${escapeHtml(label)}
        </a>
      </td></tr>
    </table>`;
}

/**
 * Render an outline-style secondary button.
 */
export function emailSecondaryButton(label: string, href: string): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px auto;">
      <tr><td align="center" style="border-radius:10px;padding:0;border:1.5px solid ${INK};">
        <a href="${href}" target="_blank" style="display:inline-block;padding:11px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:600;color:${INK};text-decoration:none;border-radius:10px;">
          ${escapeHtml(label)}
        </a>
      </td></tr>
    </table>`;
}

/**
 * Render a "stat row" — small uppercase label on the left, bold value
 * on the right. Use for invoice totals, change order amounts, etc.
 */
export function emailStatRow(label: string, value: string, opts?: { valueColor?: string; emphasize?: boolean }): string {
  const color = opts?.valueColor ?? '#111827';
  const size = opts?.emphasize ? '18px' : '14px';
  const weight = opts?.emphasize ? '800' : '700';
  return `
    <tr>
      <td style="padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:13px;color:#6b7280;">${escapeHtml(label)}</td>
      <td align="right" style="padding:6px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:${size};font-weight:${weight};color:${color};letter-spacing:-0.2px;">${value}</td>
    </tr>`;
}

/**
 * Wrap a stat block in the boxed gray card we use for totals/summaries.
 */
export function emailStatCard(rowsHtml: string): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;border-radius:12px;margin:20px 0;">
      <tr><td style="padding:20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          ${rowsHtml}
        </table>
      </td></tr>
    </table>`;
}

/**
 * The main wrapper. Returns a complete HTML document ready to ship to
 * Resend's `html` field.
 */
export function wrapEmailHtml(opts: EmailWrapOpts): string {
  const {
    companyName, logoUri, recipientName,
    eyebrow, title, bodyHtml,
    contactName, contactEmail, contactPhone,
    accent = DEFAULT_ACCENT,
  } = opts;

  const headerCompanyHtml = logoUri
    ? `<img src="${logoUri}" alt="${escapeHtml(companyName ?? '')}" height="28" style="height:28px;display:inline-block;vertical-align:middle;border-radius:6px;" />
       <span style="display:inline-block;vertical-align:middle;margin-left:10px;color:#FFFFFF;font-size:18px;font-weight:700;letter-spacing:-0.3px;">${escapeHtml(companyName ?? 'MAGE ID')}</span>`
    : `<span style="color:#FFFFFF;font-size:20px;font-weight:800;letter-spacing:-0.4px;">${escapeHtml(companyName ?? 'MAGE ID')}</span>`;

  const greetingHtml = recipientName
    ? `<p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.5;">Hi ${escapeHtml(recipientName)},</p>`
    : '';

  const eyebrowHtml = eyebrow
    ? `<p style="margin:0 0 8px;color:${accent};font-size:11px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(eyebrow)}</p>`
    : '';

  const contactLineHtml = (contactName || contactEmail || contactPhone)
    ? `<br/>${escapeHtml(contactName ?? '')}${contactEmail ? ` · ${escapeHtml(contactEmail)}` : ''}${contactPhone ? ` · ${escapeHtml(contactPhone)}` : ''}`
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <!-- Email-client preheader (hidden, but shown in inbox previews) -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${CREAM};">${escapeHtml(eyebrow ?? title)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.08);">

        <!-- Header — ink/amber, mirrors the marketing site -->
        <tr><td style="background:${INK};padding:24px 32px;">
          ${headerCompanyHtml}
        </td></tr>

        <!-- Body card -->
        <tr><td style="padding:32px;">
          ${eyebrowHtml}
          <h1 style="margin:0 0 20px;color:#111827;font-size:24px;font-weight:800;letter-spacing:-0.5px;line-height:1.25;">${escapeHtml(title)}</h1>
          ${greetingHtml}
          ${bodyHtml}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#F8F8F6;padding:20px 32px;border-top:1px solid #EEE;">
          <p style="margin:0;color:${FOG};font-size:11px;line-height:1.6;">
            Sent via <span style="color:${INK};font-weight:700;">MAGE ID</span> — the operating system for general contractors.
            ${contactLineHtml}
          </p>
          <p style="margin:8px 0 0;color:${FOG};font-size:10px;font-style:italic;line-height:1.55;">
            This email was generated by MAGE ID on behalf of the contractor named above. Verify any amounts, dates, or commitments with the contractor directly before acting on them.
          </p>
          <p style="margin:8px 0 0;color:${FOG};font-size:10px;">
            Got this by mistake? Just reply and let us know.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
