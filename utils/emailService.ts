import * as MailComposer from 'expo-mail-composer';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { calendarDayStart } from '@/utils/calendarDate';
import {
  wrapEmailHtml,
  emailStatRow,
  emailStatCard,
  emailQuote,
  emailDivider,
  escapeHtml,
  fmtMoney,
  type UnsubscribeOpts,
} from '@/utils/emailLayout';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export interface SendEmailWithAttachmentsParams extends SendEmailParams {
  attachments?: string[]; // local file URIs
  /** Legacy: full FROM string override. Prefer fromCompanyName. */
  from?: string;
  /** Just the company name — server wraps it as "X via MAGE ID <noreply@…>". */
  fromCompanyName?: string;
  /** Drives List-Unsubscribe headers on the send. */
  unsubscribe?: UnsubscribeOpts;
}

/**
 * What actually happened to the message. Modelled on ShareOutcome in
 * utils/shareText.ts for the same reason: a bare boolean cannot tell
 * "Resend accepted it" apart from "we opened a draft in your mail app and
 * nothing has left the building", and the old code collapsed the two into
 * `success: true`. Callers flip invoices/RFIs/submittals to 'sent' on the
 * success path, so that collapse started dunning clocks on sends that never
 * happened.
 */
export type SendEmailOutcome =
  /** Resend accepted the message. It is on its way to the recipient. */
  | 'sent'
  /** A composer (mailto: on web, MailComposer on native) was opened with a
   *  draft. NOTHING HAS BEEN SENT — the user still has to press Send. */
  | 'composer_opened'
  /** The user dismissed the composer without sending. Not an error. */
  | 'cancelled'
  /** No send path worked at all. */
  | 'failed';

export interface SendEmailResponse {
  /** TRUE ONLY for outcome 'sent'. Never true for a composer we merely opened. */
  success: boolean;
  outcome: SendEmailOutcome;
  id?: string;
  error?: string;
  /**
   * How many requested attachments did not make it onto the message. Non-zero
   * means the recipient got the body without the PDF, so callers must not tell
   * the user "invoice emailed" without qualification.
   */
  attachmentsDropped?: number;
}

// Read a local file URI and return { filename, content (base64), contentType }.
// The send-email edge function expects attachments in this shape.
async function fileUriToAttachment(uri: string): Promise<{ filename: string; content: string; contentType?: string } | null> {
  try {
    const filename = decodeURIComponent(uri.split('/').pop() || 'attachment');
    const lower = filename.toLowerCase();
    const contentType =
      lower.endsWith('.pdf') ? 'application/pdf' :
      lower.endsWith('.png') ? 'image/png' :
      lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' :
      lower.endsWith('.csv') ? 'text/csv' :
      lower.endsWith('.txt') ? 'text/plain' :
      undefined;

    // On web, expo-file-system isn't available, so read the URI with
    // fetch + FileReader instead. (This comment used to say web attachments
    // were "skipped for now" — the opposite of what the code below does. The
    // encoder has always worked on web; what was missing was any caller
    // feeding it a web-reachable URI. See app/invoice.tsx handleSendPDF.)
    if (Platform.OS === 'web') {
      const res = await fetch(uri);
      const blob = await res.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          // Strip the "data:...;base64," prefix
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return { filename, content: base64, contentType };
    }

    const content = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { filename, content, contentType };
  } catch (err) {
    console.error('[EmailService] Attachment read failed:', uri, err);
    return null;
  }
}

/**
 * The real server-side sender. Calls the `send-email` Supabase edge function,
 * which forwards to Resend using the verified mageid.app domain. Replaces the
 * old mailto: flow that bounced because it sent from the user's personal inbox.
 */
async function sendViaResend(params: SendEmailWithAttachmentsParams): Promise<SendEmailResponse> {
  if (!isSupabaseConfigured) {
    return { success: false, outcome: 'failed', error: 'Email service not configured (Supabase missing)' };
  }

  // Encode attachments in parallel — typical invoice is 1-2 files so this is fast.
  let attachments: { filename: string; content: string; contentType?: string }[] | undefined;
  // fileUriToAttachment returns null on any read/encode failure and the filter
  // below quietly discards it. That drop used to be invisible: the send still
  // reported success and the client received an "invoice attached" email with
  // nothing attached. Count what we lost and report it up.
  let attachmentsDropped = 0;
  if (params.attachments && params.attachments.length > 0) {
    const encoded = await Promise.all(params.attachments.map(fileUriToAttachment));
    attachments = encoded.filter((a): a is NonNullable<typeof a> => a !== null);
    attachmentsDropped = encoded.length - attachments.length;
    if (attachmentsDropped > 0) {
      console.warn('[EmailService] Dropped', attachmentsDropped, 'unreadable attachment(s)');
    }
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: {
        to: params.to,
        subject: params.subject,
        html: params.html,
        replyTo: params.replyTo,
        from: params.from,
        fromCompanyName: params.fromCompanyName,
        unsubscribe: params.unsubscribe,
        attachments,
      },
    });

    if (error) {
      console.error('[EmailService] Edge function error:', error);
      return { success: false, outcome: 'failed', error: error.message || 'Failed to send email' };
    }

    const result = data as { success?: boolean; id?: string; error?: string } | null;
    if (!result?.success) {
      return { success: false, outcome: 'failed', error: result?.error || 'Email send failed' };
    }
    console.log('[EmailService] Sent via Resend, id:', result.id);
    return { success: true, outcome: 'sent', id: result.id, attachmentsDropped };
  } catch (err) {
    console.error('[EmailService] Invoke threw:', err);
    return { success: false, outcome: 'failed', error: String(err) };
  }
}

// ─── mailto: fallback plumbing ──────────────────────────────────────
//
// Only used when Resend is unreachable. Everything here exists because the old
// web fallback threw the message away: it opened
//   mailto:…&body=Please view the attached document.
// and returned success:true. The real HTML — line items, amount due, the Stripe
// pay link, the financing block — never left the browser, and the caller then
// marked the invoice 'sent'.

// --- BEGIN mailto plain-text helpers ---
// (scripts/validate-email-honesty.ts extracts this whole region between the
//  sentinels and executes it — this file imports react-native so it cannot be
//  imported from a bun validator. Keep the region import-free.)
const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', zwnj: '',
  middot: '·', bull: '·', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  times: '×', copy: '©', reg: '®', deg: '°',
};

/**
 * Flatten one of our email templates into readable plain text for a mailto:
 * body. Exported so scripts/validate-email-honesty.ts can pin it.
 *
 * Two things it deliberately does that a naive `replace(/<[^>]+>/g, '')`
 * does not:
 *   • Keeps anchor HREFs. The pay link / portal link IS the payload of most of
 *     these emails; stripping tags alone leaves the words "Pay securely" and
 *     silently deletes the URL they pointed at.
 *   • Drops `display:none` blocks. wrapEmailHtml opens with a hidden preheader
 *     and a run of &nbsp;&zwnj; spacer characters (utils/emailLayout.ts:386-387)
 *     that would otherwise be the first thing the recipient reads.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  let s = html;
  // Non-prose containers first.
  s = s.replace(/<(style|script|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  // Hidden preheader / spacer blocks (no nesting inside them, so non-greedy is safe).
  s = s.replace(/<(div|span|td|p)\b[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(
    /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (!label) return ` ${href} `;
      if (label === href || href.startsWith('mailto:') || href.startsWith('tel:')) return ` ${label} `;
      return ` ${label}: ${href} `;
    },
  );
  // Block boundaries have to become newlines BEFORE the generic strip, or the
  // whole invoice collapses into one unreadable run-on line.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|table|h1|h2|h3|h4|li|blockquote)\s*>/gi, '\n');
  s = s.replace(/<\/t[dh]\s*>/gi, '  ');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&#(\d{1,7});/g, (m, d: string) => {
    const n = Number(d);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
  s = s.replace(/&#x([0-9a-f]{1,6});/gi, (m, h: string) => {
    const n = parseInt(h, 16);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
  s = s.replace(/&([a-z]+);/gi, (m, name: string) => HTML_ENTITIES[name.toLowerCase()] ?? m);
  s = s.split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()).join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Mail clients and the OS URL handler both cap how much of a mailto: they will
 * accept — Outlook truncates around 2 KB and Windows' ShellExecute hard-fails
 * past ~2048 characters, which would turn "we opened a draft" back into a lie.
 * Budget the body well under that; the tail is a link back to the app anyway.
 */
const MAILTO_BODY_LIMIT = 1200;

export function buildMailtoUrl(opts: {
  to: string;
  subject: string;
  body: string;
}): string {
  const body = opts.body.length > MAILTO_BODY_LIMIT
    ? `${opts.body.slice(0, MAILTO_BODY_LIMIT).trimEnd()}\n\n[…trimmed — open the full version in MAGE ID]`
    : opts.body;
  return `mailto:${encodeURIComponent(opts.to)}?subject=${encodeURIComponent(opts.subject)}&body=${encodeURIComponent(body)}`;
}
// --- END mailto plain-text helpers ---

/**
 * Hand a mailto: to the browser. Returns false when we could not even try.
 *
 * An anchor click, NOT window.open(): by the time we get here we have already
 * awaited the Resend round-trip, so the user gesture that started the send is
 * long gone and every popup blocker kills window.open() outright. That is how
 * the old code managed to open nothing at all and still return success:true.
 * The anchor technique is the same one utils/platformFile.ts uses for
 * downloads, and it activates the mail handler without opening a window.
 */
function openMailtoWeb(mailtoUrl: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (typeof document !== 'undefined' && document.body) {
      const a = document.createElement('a');
      a.href = mailtoUrl;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    }
    window.location.href = mailtoUrl;
    return true;
  } catch (err) {
    console.error('[EmailService] Could not open mailto:', err);
    return false;
  }
}

export async function sendEmailNative(params: {
  to: string;
  subject: string;
  body: string;
  isHtml?: boolean;
  attachments?: string[];
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (Platform.OS === 'web') {
      console.log('[EmailService] Native mail not available on web');
      return { success: false, error: 'not_available' };
    }

    const isAvailable = await MailComposer.isAvailableAsync();
    if (!isAvailable) {
      console.log('[EmailService] Native mail not available on this device');
      return { success: false, error: 'No email app configured on this device. Please set up an email account in your device settings.' };
    }

    const result = await MailComposer.composeAsync({
      recipients: params.to ? [params.to] : [],
      subject: params.subject,
      body: params.body,
      isHtml: params.isHtml ?? true,
      attachments: params.attachments ?? [],
    });

    if (result.status === MailComposer.MailComposerStatus.SENT) {
      console.log('[EmailService] Email sent via native mail');
      return { success: true };
    } else if (result.status === MailComposer.MailComposerStatus.CANCELLED) {
      console.log('[EmailService] User cancelled email');
      return { success: false, error: 'cancelled' };
    } else if (result.status === MailComposer.MailComposerStatus.SAVED) {
      // SAVED means the user tapped "Save Draft" in the iOS composer. It sits in
      // their Drafts folder; the client has not received anything. This used to
      // fall into the `else` below and report success, so a saved draft marked
      // the invoice 'sent' and started the dunning clock.
      console.log('[EmailService] Email saved to drafts, not sent');
      return { success: false, error: 'Saved to your Drafts — it has not been sent yet.' };
    } else {
      // UNDETERMINED. Android's mail intent never reports back, so this is the
      // normal Android result and must stay a success or every Android send
      // reads as a failure. iOS returns a real status above.
      console.log('[EmailService] Email status:', result.status);
      return { success: true };
    }
  } catch (err) {
    console.error('[EmailService] Native mail error:', err);
    return { success: false, error: 'Failed to open email composer' };
  }
}

/**
 * Primary email send path. Routes through the Supabase `send-email` edge
 * function, which calls Resend using the verified mageid.app domain.
 *
 * Behavior:
 *   1. Try the server-side Resend pipeline first. This is the path that
 *      actually works — emails come from noreply@mageid.app with proper
 *      DKIM signatures and land in inboxes instead of spam/bounce.
 *   2. If Resend fails (network, outage, not configured), open a composer so
 *      the GC isn't stranded: MailComposer on native, a mailto: draft on web.
 *      This returns outcome 'composer_opened' with success:FALSE, because a
 *      draft in someone's hand is not a delivered email.
 *
 * WHAT CHANGED AND WHY. Step 2 on web used to open
 * `mailto:…&body=Please view the attached document.` and return
 * `{ success: true }`. Every caller treats success as "the client has it":
 * app/invoice.tsx flips the invoice to 'sent' (so A/R aging and dunning start
 * counting), rfi.tsx and submittal.tsx do the same for theirs. So a GC on the
 * web app saw "Email Sent" while the client received one sentence with no
 * invoice, no line items, no pay link and no PDF — or, if the browser blocked
 * the popup, nothing at all. Callers keying off `success` now cannot mistake a
 * draft for a send, and `outcome` lets a caller that cares tell 'composer_opened'
 * apart from 'failed'.
 */
export async function sendEmail(params: SendEmailWithAttachmentsParams): Promise<SendEmailResponse> {
  // Path 1: Resend via Supabase edge function (the path that actually works).
  const resendResult = await sendViaResend(params);
  if (resendResult.success) return resendResult;

  console.log('[EmailService] Resend failed, falling back to a composer draft:', resendResult.error);

  const attachmentCount = params.attachments?.length ?? 0;

  // Path 2: composer fallback. Only reached if Resend errors out.
  try {
    if (Platform.OS === 'web') {
      // No mail client on the web can be handed a file by a mailto:, so say so
      // rather than letting the recipient discover the missing PDF.
      const attachmentNote = attachmentCount > 0
        ? `\n\n---\n[${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'} could NOT be included in this draft — attach the file${attachmentCount === 1 ? '' : 's'} yourself before sending.]`
        : '';
      const body = `${htmlToPlainText(params.html)}${attachmentNote}`;
      const opened = openMailtoWeb(buildMailtoUrl({ to: params.to, subject: params.subject, body }));

      if (!opened) {
        return {
          success: false,
          outcome: 'failed',
          error: resendResult.error || 'Could not send the email, and this browser would not open your mail app.',
          attachmentsDropped: attachmentCount,
        };
      }
      return {
        success: false,
        outcome: 'composer_opened',
        error: `Not sent. We opened a draft in your email app${attachmentCount > 0 ? ' without the attachment' : ''} — review it and press Send there.`,
        attachmentsDropped: attachmentCount,
      };
    }

    const isAvailable = await MailComposer.isAvailableAsync();
    if (!isAvailable) {
      return {
        success: false,
        outcome: 'failed',
        error: resendResult.error || 'No email app configured on this device. Please set up an email account in Settings, or use the Share option instead.',
      };
    }

    const result = await MailComposer.composeAsync({
      recipients: params.to ? [params.to] : [],
      subject: params.subject,
      body: params.html,
      isHtml: true,
      attachments: params.attachments ?? [],
    });

    if (result.status === MailComposer.MailComposerStatus.CANCELLED) {
      return { success: false, outcome: 'cancelled', error: 'cancelled' };
    }
    if (result.status === MailComposer.MailComposerStatus.SAVED) {
      // Draft saved, not sent — see the matching branch in sendEmailNative.
      return {
        success: false,
        outcome: 'composer_opened',
        error: 'Saved to your Drafts — it has not been sent yet.',
      };
    }
    // SENT, or UNDETERMINED (the normal Android result — the mail intent never
    // reports back, so treating it as anything but sent would fail every
    // Android send). Either way the user's own mail app owns it from here.
    return { success: true, outcome: 'sent' };
  } catch (err) {
    console.error('[EmailService] Composer fallback failed too:', err);
    return { success: false, outcome: 'failed', error: resendResult.error || 'Failed to send email' };
  }
}



/**
 * Welcome email — sent the moment a user signs up. Lands within seconds
 * of signup so the first-touch impression is "this thing is alive and
 * looks legit." Five features in a tight list, App Store CTA, support
 * line. Uses the unified wrapEmailHtml so it matches every other email.
 */
export function buildWelcomeEmailHtml(opts: {
  recipientName?: string;
  iosAppUrl?: string;
  androidAppUrl?: string;
  webAppUrl?: string;
  supportEmail?: string;
}): string {
  const {
    recipientName,
    iosAppUrl = 'https://apps.apple.com/app/id6762229238',
    androidAppUrl = 'https://play.google.com/store/apps/details?id=app.mageid.android',
    webAppUrl = 'https://app.mageid.app',
    supportEmail = 'support@mageid.app',
  } = opts;

  const features = [
    { icon: '🏗', title: 'Estimates that calculate themselves', body: 'Live material pricing, regional cost adjustments, AI quick estimates from a photo.' },
    { icon: '📋', title: 'Daily field reports in 60 seconds', body: 'Voice-record what happened on site; AI parses weather, manpower, work performed, issues.' },
    { icon: '💰', title: 'Get paid in-app', body: 'One-tap Pay button on every invoice. Money lands in your bank in 1–2 business days.' },
    { icon: '📐', title: 'Plans, RFIs, COs, submittals', body: 'Full document workflow on your phone. Auto-export RFI logs and closeout packets to PDF.' },
    { icon: '📊', title: 'Cash flow forecaster', body: 'See when you\'ll be in the red weeks before it happens. No more A/R blindsides.' },
  ];
  const featuresHtml = features.map(f => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
      <tr>
        <td valign="top" style="padding-right:14px;font-size:20px;line-height:1;">${f.icon}</td>
        <td valign="top">
          <p style="margin:0 0 3px;font-size:14px;font-weight:700;color:#0B0D10;letter-spacing:-0.2px;">${f.title}</p>
          <p style="margin:0;font-size:13px;color:#4A5159;line-height:1.5;">${f.body}</p>
        </td>
      </tr>
    </table>`).join('');

  const bodyHtml = `
    ${featuresHtml}
    ${emailDivider()}
    <p style="margin:0 0 8px;color:#4A5159;font-size:14px;line-height:1.55;">
      <strong>Get the full experience on mobile.</strong> The app is where you'll spend most of your day — voice reports, photos with GPS, in-app payments — all offline-first.
    </p>
    <p style="margin:18px 0 0;color:#4A5159;font-size:13px;line-height:1.55;">
      On Android? <a href="${androidAppUrl}" style="color:#FF6A1A;text-decoration:none;font-weight:600;">Google Play</a> &middot; or <a href="${webAppUrl}" style="color:#FF6A1A;text-decoration:none;font-weight:600;">use the web app</a>.
    </p>
    <p style="margin:18px 0 0;color:#9AA3AD;font-size:12px;line-height:1.55;">
      Stuck on anything? Reply to this email or write <a href="mailto:${supportEmail}" style="color:#FF6A1A;text-decoration:none;font-weight:600;">${supportEmail}</a> — a real person reads every message.
    </p>`;

  return wrapEmailHtml({
    preheader: 'Your MAGE ID account is live. Here\'s what you can do today.',
    eyebrow: 'Welcome',
    title: recipientName ? `Welcome, ${recipientName}.` : 'Welcome.',
    subtitle: 'Your MAGE ID account is live — the operating system for general contractors. Here\'s what you can do right now.',
    bodyHtml,
    cta: { label: 'Open in App Store', href: iosAppUrl },
    companyName: 'MAGE ID',
  });
}

export function buildInvoiceEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  invoiceNumber: number;
  totalDue: number;
  dueDate: string;
  paymentTerms: string;
  message?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Stripe Payment Link URL — when present, a "Pay Securely" CTA button is
      rendered so the client can pay in one tap from the email itself. */
  payLinkUrl?: string;
  /** Pre-rendered financing offer block — injected after the stat card.
      Pass '' or omit to suppress the block entirely. */
  financingHtml?: string;
}): string {
  const {
    companyName, recipientName, projectName, invoiceNumber,
    totalDue, dueDate, paymentTerms, message,
    contactName, contactEmail, contactPhone, payLinkUrl, financingHtml,
  } = opts;

  const formattedDue = new Date(dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const stats = `
    ${emailStatRow('Project', projectName)}
    ${emailStatRow('Due date', formattedDue)}
    ${emailStatRow('Terms', paymentTerms)}
    ${emailStatRow('Amount due', fmtMoney(totalDue), { emphasize: true })}
  `;

  const bodyHtml = `
    ${recipientName ? `<p style="margin:0 0 14px;">Hi ${recipientName},</p>` : ''}
    ${message ? emailQuote(message) : '<p style="margin:0 0 6px;">A new invoice is ready for review and payment.</p>'}
    ${emailStatCard(stats)}
    ${financingHtml ?? ''}
    ${payLinkUrl ? `<p style="margin:6px 0 0;text-align:center;color:#9AA3AD;font-size:11px;">Powered by Stripe · secure card &amp; bank payment</p>` : '<p style="margin:0 0 6px;color:#4A5159;font-size:13px;">Pay by check, ACH, or whatever method we agreed to. Reply to this email if you have any questions about the invoice.</p>'}
  `;

  return wrapEmailHtml({
    preheader: `Invoice #${invoiceNumber} for ${projectName} — ${fmtMoney(totalDue)} due ${formattedDue}.`,
    eyebrow: `Invoice #${invoiceNumber}`,
    title: `${fmtMoney(totalDue)} due`,
    subtitle: `Invoice #${invoiceNumber} for ${projectName}.`,
    bodyHtml,
    cta: payLinkUrl ? { label: `Pay securely · ${fmtMoney(totalDue)}`, href: payLinkUrl } : undefined,
    companyName,
    project: { name: projectName },
    contactName, contactEmail, contactPhone,
  });
}

export function buildChangeOrderEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  coNumber: number;
  description: string;
  changeAmount: number;
  newContractTotal: number;
  message?: string;
  contactName?: string;
  contactEmail?: string;
}): string {
  const {
    companyName, recipientName, projectName, coNumber,
    description, changeAmount, newContractTotal, message,
    contactName, contactEmail,
  } = opts;

  const amountColor = changeAmount >= 0 ? '#C2410C' : '#1E8E4A';
  const amountPrefix = changeAmount >= 0 ? '+' : '';
  const formattedChange = `${amountPrefix}${fmtMoney(Math.abs(changeAmount))}`;

  const bodyHtml = `
    ${recipientName ? `<p style="margin:0 0 14px;">Hi ${recipientName},</p>` : ''}
    ${message ? emailQuote(message) : '<p style="margin:0 0 6px;">A change order is up for your review and approval.</p>'}
    <p style="margin:14px 0 6px;font-weight:700;color:#0B0D10;">What's changing</p>
    <p style="margin:0 0 4px;color:#4A5159;line-height:1.55;">${description}</p>
    ${emailStatCard(`
      ${emailStatRow('Change order', `#${coNumber}`)}
      ${emailStatRow('Project', projectName)}
      ${emailStatRow('Change amount', formattedChange, { emphasize: true, valueColor: amountColor })}
      ${emailStatRow('New contract total', fmtMoney(newContractTotal), { emphasize: true })}
    `)}
    <p style="margin:0;color:#4A5159;font-size:13px;">Reply to this email with your decision, or open the project portal to approve in one tap.</p>
  `;

  return wrapEmailHtml({
    preheader: `Change order #${coNumber} for ${projectName}: ${formattedChange}.`,
    eyebrow: `Change Order #${coNumber}`,
    title: `${formattedChange} change request`,
    subtitle: `Change order #${coNumber} for ${projectName}.`,
    bodyHtml,
    companyName,
    project: { name: projectName },
    contactName, contactEmail,
  });
}

/**
 * Premium portal-invite email. The previous portal-invite template was
 * the generic wrapPlainAsHtml in SendPortalLinkModal — a bare welcome
 * line + a single orange button + "Sent via MAGE ID" footer that did
 * not match any other transactional email the GC sends. This rebuilds
 * the invite on the unified wrapEmailHtml scaffolding so it sits next
 * to the invoice + estimate + daily-report templates.
 */
export function buildPortalInviteEmailHtml(opts: {
  companyName: string;
  recipientName?: string;
  projectName: string;
  /** Free-text greeting from the GC (the portal welcomeMessage). */
  welcomeMessage?: string;
  /** Full portal URL — used as the primary CTA. */
  portalUrl: string;
  /** Passcode shown in a separate callout when the portal requires one. */
  passcode?: string | null;
  /** Names of sections the client will see — derived from the GC's
   *  portal toggles. Empty array → render a generic "live progress"
   *  line instead of the explicit list. */
  visibleSections?: string[];
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}): string {
  const {
    companyName, recipientName, projectName,
    welcomeMessage, portalUrl, passcode,
    visibleSections = [],
    contactName, contactEmail, contactPhone,
  } = opts;

  // Render the section list as a 2-column grid of tags. If the GC has
  // nothing on, fall back to a single descriptive line in the stat card.
  const sectionsHtml = visibleSections.length > 0
    ? `
      ${emailStatRow('Project', projectName)}
      ${emailStatRow('You can see', visibleSections.join(' · '))}
    `
    : `
      ${emailStatRow('Project', projectName)}
      ${emailStatRow('Live updates for', 'Progress, photos, invoices & messages')}
    `;

  const bodyHtml = `
    ${recipientName ? `<p style="margin:0 0 14px;font-size:15px;color:#0B0D10;">Hi ${recipientName},</p>` : ''}
    ${welcomeMessage
      ? emailQuote(welcomeMessage)
      : `<p style="margin:0 0 14px;font-size:15px;color:#4A5159;line-height:1.6;">
           You've been invited to your private project portal for <strong style="color:#0B0D10;">${projectName}</strong>.
           One link, always up to date — open it from any phone, tablet, or browser.
         </p>`}
    ${emailStatCard(sectionsHtml)}
    ${passcode ? `
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0 0;">
        <tr>
          <td style="background:#FFF7EE;border:1.5px dashed #FF6A1A;border-radius:12px;padding:16px 18px;">
            <p style="margin:0 0 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:1.4px;color:#C2410C;text-transform:uppercase;">Passcode required</p>
            <p style="margin:0 0 4px;font-family:-apple-system,BlinkMacSystemFont,'SF Mono',Menlo,Consolas,monospace;font-size:22px;font-weight:800;color:#0B0D10;letter-spacing:4px;">${escapeHtml(passcode)}</p>
            <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:12px;color:#4A5159;line-height:1.5;">
              Enter this passcode when prompted. Keep it private — it unlocks every detail your contractor has shared.
            </p>
          </td>
        </tr>
      </table>
    ` : ''}
    ${emailDivider()}
    <p style="margin:0 0 6px;font-size:14px;color:#4A5159;line-height:1.55;">
      Everything updates in real time — when ${companyName} adds a photo, sends an invoice, or replies to a message, you'll see it here within seconds. Two-way messaging is built in.
    </p>
    <p style="margin:14px 0 0;font-size:12px;color:#9AA3AD;line-height:1.55;">
      Trouble opening the link? Copy this URL into any browser:<br/>
      <span style="word-break:break-all;color:#4A5159;">${escapeHtml(portalUrl)}</span>
    </p>
  `;

  return wrapEmailHtml({
    preheader: `Live progress, photos, invoices & messages for ${projectName} — open anytime from any device.`,
    eyebrow: 'Project Portal',
    title: projectName,
    subtitle: `Live updates from ${companyName} — anytime, from any device.`,
    bodyHtml,
    cta: { label: 'Open my portal', href: portalUrl },
    companyName,
    project: { name: projectName },
    contactName, contactEmail, contactPhone,
  });
}

export function buildDailyReportEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  date: string;
  weather: { condition: string; tempHigh: number; tempLow: number };
  totalManpower: number;
  totalManHours: number;
  workPerformed: string;
  issuesAndDelays: string;
  message?: string;
  contactName?: string;
  contactEmail?: string;
  /** Free-tier "Built with MAGE ID" growth footer — homeowner-facing report. */
  growthBadge?: boolean;
}): string {
  const {
    companyName, recipientName, projectName, date,
    weather, totalManpower, totalManHours, workPerformed,
    issuesAndDelays, message, contactName, contactEmail, growthBadge,
  } = opts;

  const formatted = new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const bodyHtml = `
    ${recipientName ? `<p style="margin:0 0 14px;">Hi ${recipientName},</p>` : ''}
    ${message ? emailQuote(message) : '<p style="margin:0 0 6px;">Today\'s field report is below.</p>'}
    ${emailStatCard(`
      ${emailStatRow('Weather', `${weather.condition} · ${weather.tempHigh}° / ${weather.tempLow}°F`)}
      ${emailStatRow('Manpower', `${totalManpower} workers`)}
      ${emailStatRow('Man-hours', `${totalManHours} hrs`, { emphasize: true })}
    `)}
    ${workPerformed ? `
      <p style="margin:18px 0 6px;font-weight:700;color:#0B0D10;">Work performed</p>
      <p style="margin:0 0 14px;color:#4A5159;line-height:1.55;white-space:pre-wrap;">${workPerformed}</p>
    ` : ''}
    ${issuesAndDelays ? `
      <p style="margin:18px 0 6px;font-weight:700;color:#C2410C;">Issues &amp; delays</p>
      <p style="margin:0 0 14px;color:#4A5159;line-height:1.55;white-space:pre-wrap;">${issuesAndDelays}</p>
    ` : ''}
  `;

  return wrapEmailHtml({
    preheader: `${formatted} · ${weather.condition} · ${totalManpower} workers · ${totalManHours} man-hours.`,
    eyebrow: 'Daily Field Report',
    title: formatted,
    subtitle: `Today's report for ${projectName}.`,
    bodyHtml,
    companyName,
    project: { name: projectName },
    contactName, contactEmail,
    growthBadge,
  });
}

export function buildEstimateEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  grandTotal: number;
  itemCount: number;
  message?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Pre-rendered financing offer block — injected after the stat card.
      Pass '' or omit to suppress the block entirely. */
  financingHtml?: string;
  /** Free-tier "Built with MAGE ID" growth footer (estimates are ungated +
      high-frequency, so this is a prime product-led acquisition surface). */
  growthBadge?: boolean;
}): string {
  const {
    companyName, recipientName, projectName, grandTotal,
    itemCount, message, contactName, contactEmail, contactPhone, financingHtml,
    growthBadge,
  } = opts;

  const bodyHtml = `
    ${recipientName ? `<p style="margin:0 0 14px;">Hi ${recipientName},</p>` : ''}
    ${message ? emailQuote(message) : '<p style="margin:0 0 6px;">Estimate attached. Summary below.</p>'}
    ${emailStatCard(`
      ${emailStatRow('Project', projectName)}
      ${emailStatRow('Line items', `${itemCount} items`)}
      ${emailStatRow('Estimated total', fmtMoney(grandTotal), { emphasize: true })}
    `)}
    ${financingHtml ?? ''}
    <p style="margin:0;color:#4A5159;font-size:13px;">Reply with questions, or let me know when you'd like to walk through the numbers together.</p>
  `;

  return wrapEmailHtml({
    preheader: `Estimate for ${projectName} — ${fmtMoney(grandTotal)} across ${itemCount} items.`,
    eyebrow: 'Estimate',
    title: fmtMoney(grandTotal),
    subtitle: `Estimate for ${projectName}.`,
    bodyHtml,
    companyName,
    project: { name: projectName },
    contactName, contactEmail, contactPhone,
    growthBadge,
  });
}

export function buildGenericDocumentEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  documentType: string;
  fileName: string;
  message?: string;
  contactName?: string;
  contactEmail?: string;
}): string {
  const {
    companyName, recipientName, projectName, documentType,
    fileName, message, contactName, contactEmail,
  } = opts;

  const bodyHtml = `
    ${recipientName ? `<p style="margin:0 0 14px;">Hi ${recipientName},</p>` : ''}
    <p style="margin:0 0 12px;">Attached: <strong>${fileName}</strong>.</p>
    ${message ? emailQuote(message) : ''}
    <p style="margin:0;color:#4A5159;font-size:13px;">Let me know if you have any questions.</p>
  `;

  return wrapEmailHtml({
    preheader: `${documentType} for ${projectName} — ${fileName}`,
    eyebrow: documentType,
    title: documentType,
    subtitle: `For ${projectName}.`,
    bodyHtml,
    companyName,
    project: { name: projectName },
    contactName, contactEmail,
  });
}

// ─── RFI email (sent to architect / engineer for response) ──────────
//
// Frames the RFI as a request for information, with priority + due
// date prominent so a busy architect can triage at a glance.
//
// When `replyPortalUrl` is provided (built from the RFI's share_token),
// the email shows a primary CTA that opens the architect reply portal —
// the architect responds in-browser and the response syncs directly
// into the RFI in the GC's app (no manual paste). Email reply still
// works via replyTo as a fallback.
export function buildRFIEmailHtml(opts: {
  companyName: string;
  recipientName: string;
  projectName: string;
  rfiNumber: number;
  subject: string;
  question: string;
  priority: string;
  dateRequired: string;
  submittedBy?: string;
  linkedDrawing?: string;
  message?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Architect reply portal URL — rendered as the primary CTA when set. */
  replyPortalUrl?: string;
}): string {
  const {
    companyName, recipientName, projectName, rfiNumber,
    subject, question, priority, dateRequired, submittedBy,
    linkedDrawing, message, contactName, contactEmail, contactPhone,
    replyPortalUrl,
  } = opts;
  const priorityAccent = priority === 'urgent' ? '#C2410C' : priority === 'normal' ? '#1E5BC6' : '#6B7280';
  // calendarDayStart: dateRequired is a bare 'YYYY-MM-DD' in the common case,
  // and `new Date()` of that is UTC midnight — the email named the day BEFORE
  // the due day west of Greenwich (B4 review A2).
  const formattedDue = calendarDayStart(dateRequired)?.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }) ?? '';

  const stats: string[] = [];
  stats.push(emailStatRow('Priority', (priority || 'normal').toUpperCase(), { valueColor: priorityAccent }));
  if (formattedDue) stats.push(emailStatRow('Response needed by', formattedDue, { emphasize: priority === 'urgent' }));
  if (submittedBy) stats.push(emailStatRow('Submitted by', submittedBy));
  if (linkedDrawing) stats.push(emailStatRow('Linked drawing', linkedDrawing));

  const bodyHtml = `
    ${recipientName ? `<p style="margin:0 0 14px;">Hi ${recipientName},</p>` : ''}
    ${message ? `<p style="margin:0 0 14px;color:#4A5159;line-height:1.55;">${message}</p>` : '<p style="margin:0 0 14px;color:#4A5159;line-height:1.55;">We need your input on the question below — please reply at your convenience.</p>'}
    <p style="margin:14px 0 6px;font-weight:700;color:#0B0D10;">Question</p>
    ${emailQuote(question)}
    ${emailStatCard(stats.join(''))}
    <p style="margin:0;padding:12px 14px;background:#FFF7ED;border:1px solid #FED7AA;border-radius:10px;color:#0B0D10;font-size:13px;line-height:1.55;">
      <strong>${replyPortalUrl ? 'Two ways to respond:' : 'How to respond:'}</strong> ${replyPortalUrl ? 'tap the button above for a one-tap response form, or simply reply to this email.' : 'simply reply to this email.'} Either way, your response is filed against RFI #${rfiNumber}.
    </p>
  `;

  return wrapEmailHtml({
    preheader: `RFI #${rfiNumber}: ${subject}${formattedDue ? ` — needed by ${formattedDue}` : ''}.`,
    eyebrow: `RFI #${rfiNumber} · ${(priority || 'normal').toUpperCase()}`,
    title: subject,
    subtitle: `Request for information on ${projectName}.`,
    accent: priorityAccent,
    bodyHtml,
    cta: replyPortalUrl ? { label: 'Open reply portal', href: replyPortalUrl } : undefined,
    companyName,
    project: { name: projectName },
    contactName, contactEmail, contactPhone,
  });
}

// Submittal email already lives in pdfGenerator.ts under the same name —
// see buildSubmittalEmailHtml there. Upgraded the body in pdfGenerator
// to include action codes + how-to-respond callout instead of duplicating
// the function here.
