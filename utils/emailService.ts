import * as MailComposer from 'expo-mail-composer';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { wrapEmailHtml, emailButton } from '@/utils/emailLayout';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export interface SendEmailWithAttachmentsParams extends SendEmailParams {
  attachments?: string[]; // local file URIs
  from?: string;          // override default FROM if needed
}

interface SendEmailResponse {
  success: boolean;
  id?: string;
  error?: string;
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

    // On web, expo-file-system isn't available. We'd need to fetch the URI and
    // convert to base64 via FileReader — for now just skip web attachments.
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
    return { success: false, error: 'Email service not configured (Supabase missing)' };
  }

  // Encode attachments in parallel — typical invoice is 1-2 files so this is fast.
  let attachments: Array<{ filename: string; content: string; contentType?: string }> | undefined;
  if (params.attachments && params.attachments.length > 0) {
    const encoded = await Promise.all(params.attachments.map(fileUriToAttachment));
    attachments = encoded.filter((a): a is NonNullable<typeof a> => a !== null);
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-email', {
      body: {
        to: params.to,
        subject: params.subject,
        html: params.html,
        replyTo: params.replyTo,
        from: params.from,
        attachments,
      },
    });

    if (error) {
      console.error('[EmailService] Edge function error:', error);
      return { success: false, error: error.message || 'Failed to send email' };
    }

    const result = data as { success?: boolean; id?: string; error?: string } | null;
    if (!result?.success) {
      return { success: false, error: result?.error || 'Email send failed' };
    }
    console.log('[EmailService] Sent via Resend, id:', result.id);
    return { success: true, id: result.id };
  } catch (err) {
    console.error('[EmailService] Invoke threw:', err);
    return { success: false, error: String(err) };
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
    } else {
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
 *   2. If Resend fails (network, outage, not configured), fall back to the
 *      native mail composer so the GC isn't stranded. The composer still
 *      bounces for the "spam filter" reason but at least it puts the draft
 *      in their hand where they can verify it and send manually.
 */
export async function sendEmail(params: SendEmailWithAttachmentsParams): Promise<SendEmailResponse> {
  // Path 1: Resend via Supabase edge function (the path that actually works).
  const resendResult = await sendViaResend(params);
  if (resendResult.success) return resendResult;

  console.log('[EmailService] Resend failed, falling back to native composer:', resendResult.error);

  // Path 2: Native mail composer fallback. Only reached if Resend errors out.
  try {
    if (Platform.OS === 'web') {
      const mailtoUrl = `mailto:${encodeURIComponent(params.to)}?subject=${encodeURIComponent(params.subject)}&body=${encodeURIComponent('Please view the attached document.')}`;
      window.open(mailtoUrl, '_blank');
      return { success: true };
    }

    const isAvailable = await MailComposer.isAvailableAsync();
    if (!isAvailable) {
      return {
        success: false,
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
      return { success: false, error: 'cancelled' };
    }
    return { success: true };
  } catch (err) {
    console.error('[EmailService] Composer fallback failed too:', err);
    return { success: false, error: resendResult.error || 'Failed to send email' };
  }
}



/**
 * Welcome email — sent the moment a user signs up. Job:
 *   1. Confirm their account is created.
 *   2. Quickly explain what MAGE ID does (5 features, scannable list).
 *   3. Push them to install the mobile app for the full experience.
 *   4. Offer a clear "where to get help" line so they don't bounce on
 *      the first hurdle.
 *
 * Designed to land in their inbox within seconds of signup so the
 * first-touch impression is "this thing is alive and looks legit."
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
    { icon: '🏗', title: 'Estimates that calculate themselves', body: 'Live material pricing, regional cost adjustments, bulk-discount math, AI-generated quick estimates from a photo or a few prompts.' },
    { icon: '📋', title: 'Daily field reports in 60 seconds', body: 'Voice-record what happened on site, AI parses it into weather + manpower + work performed + materials + issues. Photos auto-geotag.' },
    { icon: '💰', title: 'Get paid in-app', body: 'One-tap "Pay" button on every invoice. Money lands in your bank in 1–2 business days. No more chasing checks.' },
    { icon: '📐', title: 'Plans, RFIs, change orders, submittals', body: 'Full document workflow on your phone. Pin notes/photos to plan markups. Auto-export RFI logs and closeout packets to PDF.' },
    { icon: '📊', title: 'Cash flow forecaster', body: 'See exactly when you\'ll be in the red weeks before it happens. Never get blindsided by a slow A/R again.' },
  ];

  const featuresHtml = features.map(f => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
      <tr>
        <td valign="top" style="padding-right:14px;font-size:22px;line-height:1;">${f.icon}</td>
        <td valign="top">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827;letter-spacing:-0.2px;">${f.title}</p>
          <p style="margin:0;font-size:13px;color:#4B5563;line-height:1.5;">${f.body}</p>
        </td>
      </tr>
    </table>
  `).join('');

  const bodyHtml = `
    <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.6;">
      Welcome to MAGE ID — the operating system for general contractors. Your account is live.
      Here's what you can do right now:
    </p>

    <div style="margin:24px 0 8px;">
      ${featuresHtml}
    </div>

    <p style="margin:24px 0 0;color:#374151;font-size:14px;line-height:1.55;">
      <strong>Get the full experience on mobile.</strong> The app is where you'll spend most of your
      day — voice reports on the jobsite, photos with GPS, in-app payments — all of it works
      offline and syncs the moment you're back on signal.
    </p>

    ${emailButton('Open in App Store', iosAppUrl)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0;">
      <tr>
        <td align="center" style="font-size:12px;color:#6b7280;">
          On Android? <a href="${androidAppUrl}" style="color:#FF6A1A;text-decoration:none;font-weight:600;">Get it on Google Play</a>
          &nbsp;·&nbsp;
          <a href="${webAppUrl}" style="color:#FF6A1A;text-decoration:none;font-weight:600;">Use the web version</a>
        </td>
      </tr>
    </table>

    <hr style="border:none;border-top:1px solid #EEE;margin:32px 0 20px;" />

    <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.55;">
      Stuck on anything? Just reply to this email or write
      <a href="mailto:${supportEmail}" style="color:#FF6A1A;text-decoration:none;font-weight:600;">${supportEmail}</a>
      — a real person reads every message.
    </p>
  `;

  return wrapEmailHtml({
    companyName: 'MAGE ID',
    recipientName,
    eyebrow: 'WELCOME',
    title: recipientName ? `Welcome to MAGE ID, ${recipientName}` : 'Welcome to MAGE ID',
    bodyHtml,
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
}): string {
  const {
    companyName, recipientName, projectName, invoiceNumber,
    totalDue, dueDate, paymentTerms, message,
    contactName, contactEmail, contactPhone, payLinkUrl,
  } = opts;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Invoice #${invoiceNumber}</p>
          <h2 style="margin:0 0 24px;color:#111827;font-size:20px;">${projectName}</h2>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:20px;">
              <table width="100%">
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Amount Due</td>
                  <td align="right" style="color:#111827;font-size:18px;font-weight:700;padding:4px 0;">$${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Due Date</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${new Date(dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Payment Terms</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${paymentTerms}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          ${payLinkUrl ? `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
            <tr><td align="center">
              <a href="${payLinkUrl}" target="_blank" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:16px 36px;border-radius:10px;box-shadow:0 4px 12px rgba(16,185,129,0.25);">
                Pay Securely — $${totalDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </a>
            </td></tr>
            <tr><td align="center" style="padding-top:10px;">
              <p style="margin:0;color:#9ca3af;font-size:11px;">
                Powered by Stripe · Secure card &amp; bank payment
              </p>
            </td></tr>
          </table>
          ` : ''}
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This invoice was generated using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
            ${contactPhone ? ` | ${contactPhone}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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

  const amountColor = changeAmount >= 0 ? '#dc2626' : '#16a34a';
  const amountPrefix = changeAmount >= 0 ? '+' : '';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Change Order #${coNumber}</p>
          <h2 style="margin:0 0 24px;color:#111827;font-size:20px;">${projectName}</h2>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          <p style="margin:0 0 16px;color:#374151;line-height:1.5;">A change order has been submitted for your review and approval.</p>
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:20px;">
              <p style="margin:0 0 12px;color:#374151;font-size:14px;font-weight:600;">Description</p>
              <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.5;">${description}</p>
              <table width="100%">
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Change Amount</td>
                  <td align="right" style="color:${amountColor};font-size:16px;font-weight:700;padding:4px 0;">${amountPrefix}$${Math.abs(changeAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">New Contract Total</td>
                  <td align="right" style="color:#111827;font-size:16px;font-weight:700;padding:4px 0;">$${newContractTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This change order was generated using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
}): string {
  const {
    companyName, recipientName, projectName, date,
    weather, totalManpower, totalManHours, workPerformed,
    issuesAndDelays, message, contactName, contactEmail,
  } = opts;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Daily Field Report</p>
          <h2 style="margin:0 0 4px;color:#111827;font-size:20px;">${projectName}</h2>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">${new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:20px;">
              <table width="100%">
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Weather</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${weather.condition} (${weather.tempHigh}°/${weather.tempLow}°F)</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Manpower</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${totalManpower} workers</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Man-Hours</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${totalManHours} hrs</td>
                </tr>
              </table>
            </td></tr>
          </table>
          ${workPerformed ? `
          <p style="margin:16px 0 8px;color:#374151;font-size:14px;font-weight:600;">Work Performed</p>
          <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.5;white-space:pre-wrap;">${workPerformed}</p>
          ` : ''}
          ${issuesAndDelays ? `
          <p style="margin:16px 0 8px;color:#dc2626;font-size:14px;font-weight:600;">Issues & Delays</p>
          <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.5;white-space:pre-wrap;">${issuesAndDelays}</p>
          ` : ''}
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This report was generated using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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
}): string {
  const {
    companyName, recipientName, projectName, grandTotal,
    itemCount, message, contactName, contactEmail, contactPhone,
  } = opts;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Estimate</p>
          <h2 style="margin:0 0 24px;color:#111827;font-size:20px;">${projectName}</h2>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          <p style="margin:0 0 16px;color:#374151;line-height:1.5;">Please find the estimate details below.</p>
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;margin:20px 0;">
            <tr><td style="padding:20px;">
              <table width="100%">
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Line Items</td>
                  <td align="right" style="color:#111827;font-size:14px;padding:4px 0;">${itemCount} items</td>
                </tr>
                <tr>
                  <td style="color:#6b7280;font-size:13px;padding:4px 0;">Estimated Total</td>
                  <td align="right" style="color:#111827;font-size:18px;font-weight:700;padding:4px 0;">$${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This estimate was generated using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
            ${contactPhone ? ` | ${contactPhone}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
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

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">${documentType}</p>
          <h2 style="margin:0 0 24px;color:#111827;font-size:20px;">${projectName}</h2>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;">Hi ${recipientName},</p>` : ''}
          <p style="margin:0 0 16px;color:#374151;line-height:1.5;">Please find the attached document: <strong>${fileName}</strong></p>
          ${message ? `<p style="margin:0 0 20px;color:#374151;line-height:1.5;">${message}</p>` : ''}
          <p style="margin:20px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            This document was sent using MAGE ID.
            ${contactName ? `<br/>Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── RFI email (sent to architect / engineer for response) ──────────
//
// Frames the RFI as a request for information, with priority + due
// date prominent so a busy architect can triage at a glance. Reply-to
// is the GC's email so the architect's response lands in the GC's
// inbox; the GC then files the response into the RFI in-app.
//
// Future iteration: include a per-RFI response link to a hosted form
// at app.mageid.app/rfi-respond/[token] so responses sync back
// automatically. For now, email reply is the v1 flow.
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
}): string {
  const {
    companyName, recipientName, projectName, rfiNumber,
    subject, question, priority, dateRequired, submittedBy,
    linkedDrawing, message, contactName, contactEmail, contactPhone,
  } = opts;
  const priorityColor = priority === 'urgent' ? '#dc2626' : priority === 'normal' ? '#2563eb' : '#6b7280';
  const priorityBg    = priority === 'urgent' ? '#fef2f2' : priority === 'normal' ? '#eff6ff' : '#f3f4f6';
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="background:#1a1a2e;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${companyName || 'MAGE ID'}</h1>
          <p style="margin:6px 0 0;color:#a5a5b8;font-size:12px;letter-spacing:0.4px;">REQUEST FOR INFORMATION</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;">
            <tr>
              <td style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;font-weight:700;">RFI #${rfiNumber}</td>
              <td align="right">
                <span style="display:inline-block;background:${priorityBg};color:${priorityColor};padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">${priority || 'normal'}</span>
              </td>
            </tr>
          </table>
          <h2 style="margin:0 0 8px;color:#111827;font-size:20px;line-height:1.3;">${subject}</h2>
          <p style="margin:0 0 18px;color:#374151;font-size:14px;">Project: <strong>${projectName}</strong></p>
          ${recipientName ? `<p style="margin:0 0 16px;color:#374151;font-size:14px;">Hi ${recipientName},</p>` : ''}
          ${message ? `<p style="margin:0 0 18px;color:#374151;line-height:1.55;font-size:14px;">${message}</p>` : `<p style="margin:0 0 18px;color:#374151;line-height:1.55;font-size:14px;">We need your input on the question below — please reply to this email at your convenience.</p>`}
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-left:3px solid ${priorityColor};border-radius:6px;margin:20px 0;">
            <tr><td style="padding:18px 20px;">
              <p style="margin:0 0 6px;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;font-weight:700;">Question</p>
              <p style="margin:0;color:#111827;font-size:14px;line-height:1.6;white-space:pre-wrap;">${question}</p>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
            ${dateRequired ? `<tr>
              <td style="color:#6b7280;font-size:13px;padding:6px 0;">Response needed by</td>
              <td align="right" style="color:#111827;font-size:13px;font-weight:600;padding:6px 0;">${new Date(dateRequired).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}</td>
            </tr>` : ''}
            ${submittedBy ? `<tr>
              <td style="color:#6b7280;font-size:13px;padding:6px 0;">Submitted by</td>
              <td align="right" style="color:#111827;font-size:13px;padding:6px 0;">${submittedBy}</td>
            </tr>` : ''}
            ${linkedDrawing ? `<tr>
              <td style="color:#6b7280;font-size:13px;padding:6px 0;">Linked drawing</td>
              <td align="right" style="color:#111827;font-size:13px;padding:6px 0;">${linkedDrawing}</td>
            </tr>` : ''}
          </table>
          <p style="margin:24px 0 0;color:#374151;font-size:13px;line-height:1.55;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px 14px;">
            <strong>How to respond:</strong> simply reply to this email. Your response will be filed against RFI #${rfiNumber} for this project.
          </p>
          <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
            ${contactName ? `Contact: ${contactName}` : ''}
            ${contactEmail ? ` | ${contactEmail}` : ''}
            ${contactPhone ? ` | ${contactPhone}` : ''}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Submittal email already lives in pdfGenerator.ts under the same name —
// see buildSubmittalEmailHtml there. Upgraded the body in pdfGenerator
// to include action codes + how-to-respond callout instead of duplicating
// the function here.
