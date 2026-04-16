import * as MailComposer from 'expo-mail-composer';
import { Platform } from 'react-native';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export interface SendEmailWithAttachmentsParams extends SendEmailParams {
  attachments?: string[];
}

interface SendEmailResponse {
  success: boolean;
  id?: string;
  error?: string;
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

export async function sendEmail(params: SendEmailWithAttachmentsParams): Promise<SendEmailResponse> {
  try {
    if (Platform.OS === 'web') {
      console.log('[EmailService] Native mail not available on web, using mailto fallback');
      const mailtoUrl = `mailto:${encodeURIComponent(params.to)}?subject=${encodeURIComponent(params.subject)}&body=${encodeURIComponent('Please view the attached document.')}`;
      window.open(mailtoUrl, '_blank');
      return { success: true };
    }

    const isAvailable = await MailComposer.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, error: 'No email app configured on this device. Please set up an email account in Settings, or use the Share option instead.' };
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
    console.error('[EmailService] Native mail error:', err);
    return { success: false, error: 'Failed to open email composer' };
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
