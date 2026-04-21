import * as MailComposer from 'expo-mail-composer';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

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
}): string {
  const {
    companyName, recipientName, projectName, invoiceNumber,
    totalDue, dueDate, paymentTerms, message,
    contactName, contactEmail, contactPhone,
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
