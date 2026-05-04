import * as MailComposer from 'expo-mail-composer';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  wrapEmailHtml,
  emailStatRow,
  emailStatCard,
  emailQuote,
  emailDivider,
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
  let attachments: { filename: string; content: string; contentType?: string }[] | undefined;
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
        fromCompanyName: params.fromCompanyName,
        unsubscribe: params.unsubscribe,
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
}): string {
  const {
    companyName, recipientName, projectName, invoiceNumber,
    totalDue, dueDate, paymentTerms, message,
    contactName, contactEmail, contactPhone, payLinkUrl,
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
}): string {
  const {
    companyName, recipientName, projectName, grandTotal,
    itemCount, message, contactName, contactEmail, contactPhone,
  } = opts;

  const bodyHtml = `
    ${recipientName ? `<p style="margin:0 0 14px;">Hi ${recipientName},</p>` : ''}
    ${message ? emailQuote(message) : '<p style="margin:0 0 6px;">Estimate attached. Summary below.</p>'}
    ${emailStatCard(`
      ${emailStatRow('Project', projectName)}
      ${emailStatRow('Line items', `${itemCount} items`)}
      ${emailStatRow('Estimated total', fmtMoney(grandTotal), { emphasize: true })}
    `)}
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
  const formattedDue = dateRequired ? new Date(dateRequired).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }) : '';

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
