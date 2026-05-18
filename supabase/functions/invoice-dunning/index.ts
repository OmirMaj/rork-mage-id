// invoice-dunning
//
// Scheduled service-role edge fn that emails the project's client an
// escalating payment reminder on each overdue, still-owed invoice.
//
// Three dunning stages (computed from days-past-due in JS, never trusting
// status alone):
//   Stage 1 — 1–6 days overdue  → friendly reminder
//   Stage 2 — 7–13 days overdue → second notice
//   Stage 3 — 14+ days overdue  → final notice
//
// Dedup: each invoice row carries `dunning_stage` + `dunning_last_sent_at`
// (added by Task-1 migration). We advance to a higher stage only once.
// Failed sends never write the dedup marker; we'll retry the next day.
//
// Trigger:
//   POST {}           cron — empty body treated as all eligible invoices
//   POST { all:true } cron — explicit all
//   POST { invoiceId} preview/test for a single invoice
//
// Secrets: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, RESEND_API_KEY

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
// Shared email helpers — same shell every transactional email uses, so
// dunning reminders match sub-portal invites, contract sends, payment
// receipts, the morning brief, the homeowner weekly digest, and COI
// warnings.
import { wrapEmailHtml, resendSend, emailButton, fmtMoney, isEmailUnsubscribed } from '../_shared/email.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

// ── Brand palette (match the rest of the transactional email suite) ──
const INK = '#0B0D10';
const AMBER = '#FF6A1A';
const CREAM = '#F4EFE6';
const SAND = '#E8DFCD';
const FOG = '#9AA3AD';
const STONE = '#4A5159';
const PAPER = '#FFFFFF';
const FONT_STACK = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;
const FONT_DISPLAY = `Georgia,'Times New Roman',serif`;

// Keep linter happy: these are only here for parity with the brand-const
// block the other functions carry; they're referenced indirectly via the
// shared helpers.
void INK, AMBER, CREAM, SAND, FOG, STONE, PAPER, FONT_STACK, FONT_DISPLAY;

// ── Types ────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string;
  number: number;
  project_id: string;
  due_date: string;
  total_due: number | string;
  amount_paid: number | string | null;
  status: string;
  user_id: string;
  dunning_stage: number | null;
  dunning_last_sent_at: string | null;
}

interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  client_portal?: {
    enabled?: boolean;
    invites?: Array<{ email?: string; name?: string }>;
  } | null;
}

// ── Eligibility helpers ──────────────────────────────────────────────

/** Map days-overdue → target dunning stage (0 = not yet eligible). */
function targetDunningStage(daysOverdue: number): number {
  if (daysOverdue >= 14) return 3;
  if (daysOverdue >= 7) return 2;
  if (daysOverdue >= 1) return 1;
  return 0;
}

/** Return whether the invoice should receive a dunning email right now. */
function shouldDun(invoice: InvoiceRow, targetStage: number): boolean {
  // targetStage 0 means not yet overdue or less than 1 day past due — skip.
  if (targetStage === 0) return false;
  // Only advance to a higher stage; never re-send at the same or lower stage.
  return (invoice.dunning_stage ?? 0) < targetStage;
}

// ── Email builder ────────────────────────────────────────────────────

function buildDunningHtml(opts: {
  companyName: string;
  projectName: string;
  invoiceNumber: number;
  outstanding: number;
  dueDate: string;
  daysOverdue: number;
  stage: number;
  portalUrl: string;
  recipientEmail: string;
}): string {
  const dueDateLabel = (() => {
    const d = new Date(opts.dueDate);
    if (!isFinite(d.getTime())) return opts.dueDate;
    return d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  })();

  const stageLabel =
    opts.stage === 3 ? 'FINAL NOTICE' :
    opts.stage === 2 ? 'SECOND NOTICE' :
    'PAYMENT REMINDER';

  const subject = opts.stage === 3
    ? `Final notice — Invoice #${opts.invoiceNumber} is ${opts.daysOverdue} day${opts.daysOverdue === 1 ? '' : 's'} overdue`
    : opts.stage === 2
    ? `Second notice — Invoice #${opts.invoiceNumber} is ${opts.daysOverdue} day${opts.daysOverdue === 1 ? '' : 's'} overdue`
    : `Friendly reminder — Invoice #${opts.invoiceNumber} is past due`;

  // Stage-appropriate intro tone:
  // 1 = friendly, 2 = firmer, 3 = urgent
  const introLine =
    opts.stage === 3
      ? `This is a final notice regarding an outstanding balance on your project. Please arrange payment immediately to avoid further action.`
      : opts.stage === 2
      ? `We haven't received payment yet for the invoice below. Please take a moment to review and arrange payment at your earliest convenience.`
      : `Just a friendly reminder that the invoice below is now past due. If you've already sent payment, please disregard this notice.`;

  const amountFormatted = fmtMoney(opts.outstanding);

  const bodyHtml = `
    <p style="margin:0 0 16px 0;font-family:${FONT_STACK};font-size:14px;line-height:22px;color:${STONE};">
      ${introLine}
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0"
           style="width:100%;background:${CREAM};border:1px solid ${SAND};border-radius:14px;margin:16px 0;">
      <tr><td style="padding:18px 22px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:6px 0;font-family:${FONT_STACK};font-size:13px;color:${FOG};">Project</td>
            <td align="right" style="padding:6px 0;font-family:${FONT_STACK};font-size:13px;font-weight:700;color:${INK};">Invoice #${opts.invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-family:${FONT_STACK};font-size:13px;color:${FOG};">Due date</td>
            <td align="right" style="padding:6px 0;font-family:${FONT_STACK};font-size:13px;color:${STONE};">${dueDateLabel}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-family:${FONT_STACK};font-size:13px;color:${FOG};">Days overdue</td>
            <td align="right" style="padding:6px 0;font-family:${FONT_STACK};font-size:13px;color:${AMBER};font-weight:700;">${opts.daysOverdue} day${opts.daysOverdue === 1 ? '' : 's'}</td>
          </tr>
          <tr>
            <td style="padding:10px 0 0;font-family:${FONT_STACK};font-size:15px;font-weight:700;color:${INK};border-top:1px solid ${SAND};">Amount due</td>
            <td align="right" style="padding:10px 0 0;font-family:${FONT_STACK};font-size:20px;font-weight:800;color:${INK};letter-spacing:-0.3px;border-top:1px solid ${SAND};">${amountFormatted}</td>
          </tr>
        </table>
      </td></tr>
    </table>
    ${emailButton('View invoice', opts.portalUrl)}
    <p style="margin:18px 0 0;font-family:${FONT_STACK};font-size:13px;color:${FOG};line-height:19px;">
      Questions about this invoice? Reply to this email or visit your project portal.
    </p>
  `;

  return wrapEmailHtml({
    preheader: `Invoice #${opts.invoiceNumber} — ${amountFormatted} overdue by ${opts.daysOverdue} day${opts.daysOverdue === 1 ? '' : 's'} on ${opts.projectName}.`,
    eyebrow: stageLabel,
    title: subject,
    subtitle: `${opts.projectName}`,
    bodyHtml,
    companyName: opts.companyName,
    unsubscribe: {
      recipientEmail: opts.recipientEmail,
      eventKey: 'payment_reminders',
      enabled: true,
    },
  });
}

// ── Process a single invoice ─────────────────────────────────────────

async function processInvoice(
  client: SupabaseClient,
  invoice: InvoiceRow,
): Promise<'sent' | 'skipped' | 'error'> {
  // ── Eligibility check (in JS — do not trust status alone) ──
  const outstanding = Number(invoice.total_due) - Number(invoice.amount_paid ?? 0);
  const dueMs = new Date(invoice.due_date).getTime();

  if (!isFinite(dueMs)) {
    console.warn('[invoice-dunning] bad due_date, skipping', invoice.id, invoice.due_date);
    return 'skipped';
  }
  if (outstanding <= 0) {
    // Fully paid even if status hasn't caught up.
    return 'skipped';
  }
  const lowerStatus = (invoice.status ?? '').toLowerCase();
  if (lowerStatus === 'paid' || lowerStatus === 'draft') {
    return 'skipped';
  }
  if (dueMs >= Date.now()) {
    // Not yet overdue.
    return 'skipped';
  }

  const daysOverdue = Math.floor((Date.now() - dueMs) / 86400000);
  const target = targetDunningStage(daysOverdue);

  if (!shouldDun(invoice, target)) {
    return 'skipped';
  }

  // ── Resolve recipient from project.client_portal.invites ──
  // Mirrors homeowner-weekly-digest exactly: filter to entries that have
  // an '@' in the email field, take the first valid one.
  const projRes = await client
    .from('projects')
    .select('id,user_id,name,client_portal')
    .eq('id', invoice.project_id)
    .maybeSingle();

  if (projRes.error || !projRes.data) {
    console.warn('[invoice-dunning] project not found', invoice.id, invoice.project_id);
    return 'skipped';
  }

  const project = projRes.data as ProjectRow;
  const portal = project.client_portal;
  const invites = (portal?.invites ?? []).filter(i => (i.email ?? '').includes('@'));

  if (invites.length === 0) {
    // No client email on file — log and skip (no send, no marker).
    console.warn('[invoice-dunning] no client email, skipping invoice', invoice.id);
    return 'skipped';
  }

  // Take the first invite (consistent with how the digest handles the
  // single-homeowner case; if there are multiple, we email the first).
  const invite = invites[0];
  const recipientEmail = invite.email!;

  // Pre-send suppression: if this address unsubscribed from payment
  // reminders (or globally), skip WITHOUT advancing dunning_stage /
  // dunning_last_sent_at — those are only written after a confirmed
  // send below, so 'skipped' loses nothing if they later re-subscribe.
  if (await isEmailUnsubscribed(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, recipientEmail, 'payment_reminders')) {
    console.log('[invoice-dunning] recipient unsubscribed — skipping, dunning_stage not advanced', invoice.id);
    return 'skipped';
  }

  // ── Resolve the sender's company name from the GC's profile ──
  let companyName = 'MAGE ID';
  if (project.user_id) {
    const profRes = await client
      .from('profiles')
      .select('company_name,contact_name,name')
      .eq('id', project.user_id)
      .maybeSingle();
    if (profRes.data) {
      companyName =
        (profRes.data as { company_name?: string; contact_name?: string; name?: string }).company_name ||
        (profRes.data as { company_name?: string; contact_name?: string; name?: string }).contact_name ||
        (profRes.data as { company_name?: string; contact_name?: string; name?: string }).name ||
        'MAGE ID';
    }
  }

  // ── Build portal URL exactly as homeowner-weekly-digest does ──
  const portalUrl = `https://mageid.app/portal/${project.id}`;

  // ── Compose email ──
  const subject =
    target === 3
      ? `Final notice — Invoice #${invoice.number} is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`
      : target === 2
      ? `Second notice — Invoice #${invoice.number} is ${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`
      : `Friendly reminder — Invoice #${invoice.number} is past due`;

  const html = buildDunningHtml({
    companyName,
    projectName: project.name,
    invoiceNumber: invoice.number,
    outstanding,
    dueDate: invoice.due_date,
    daysOverdue,
    stage: target,
    portalUrl,
    recipientEmail,
  });

  // ── Send ──
  if (!RESEND_API_KEY) {
    console.warn('[invoice-dunning] RESEND_API_KEY not set');
    return 'error';
  }

  const sendResult = await resendSend(RESEND_API_KEY, {
    to: recipientEmail,
    subject,
    html,
    fromCompanyName: companyName,
    unsubscribe: {
      recipientEmail,
      eventKey: 'payment_reminders',
      enabled: true,
    },
  });

  if (!sendResult.ok) {
    console.warn('[invoice-dunning] send failed', invoice.id, JSON.stringify(sendResult.resp).slice(0, 200));
    // Do NOT write dedup marker on failed send — retry next day.
    return 'error';
  }

  // ── Write dedup marker ONLY after confirmed send (mirrors coi pattern) ──
  const updateRes = await client
    .from('invoices')
    .update({
      dunning_stage: target,
      dunning_last_sent_at: new Date().toISOString(),
    })
    .eq('id', invoice.id);

  if (updateRes.error) {
    // Log but don't fail — the email was sent; the worst outcome is a
    // duplicate at the next cron tick, which is acceptable.
    console.warn('[invoice-dunning] marker write failed', invoice.id, updateRes.error);
  }

  return 'sent';
}

// ── Entry point ──────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!SUPABASE_SERVICE_ROLE_KEY) return jsonResponse({ success: false, error: 'service role key missing' }, 500);

  let body: { all?: boolean; invoiceId?: string };
  try { body = await req.json(); } catch { body = {}; }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Single-invoice mode ─────────────────────────────────────────
  if (body.invoiceId) {
    const invRes = await client
      .from('invoices')
      .select('id,number,project_id,due_date,total_due,amount_paid,status,user_id,dunning_stage,dunning_last_sent_at')
      .eq('id', body.invoiceId)
      .maybeSingle();

    if (invRes.error || !invRes.data) {
      return jsonResponse({ success: false, error: 'invoice not found' }, 404);
    }

    let outcome: 'sent' | 'skipped' | 'error';
    try {
      outcome = await processInvoice(client, invRes.data as InvoiceRow);
    } catch (err) {
      console.error('[invoice-dunning] unhandled error', body.invoiceId, err);
      return jsonResponse({ success: false, error: String(err) }, 500);
    }

    return jsonResponse({
      success: true,
      mode: 'single',
      processed: 1,
      sent: outcome === 'sent' ? 1 : 0,
      skipped: outcome === 'skipped' ? 1 : 0,
    });
  }

  // ── Cron / all mode: empty body OR {all:true} ───────────────────
  // Query all invoices that are not paid/draft and have a due_date set.
  // Eligibility (outstanding, days-overdue, stage) is re-evaluated in
  // processInvoice() in JS so we cast a wide net here and let the per-row
  // logic filter.
  const invRes = await client
    .from('invoices')
    .select('id,number,project_id,due_date,total_due,amount_paid,status,user_id,dunning_stage,dunning_last_sent_at')
    .not('status', 'in', '("paid","draft")')
    .not('due_date', 'is', null);

  if (invRes.error) {
    console.error('[invoice-dunning] invoices query failed', invRes.error);
    return jsonResponse({ success: false, error: invRes.error.message }, 500);
  }

  const invoices = (invRes.data ?? []) as InvoiceRow[];

  let processed = 0;
  let sent = 0;
  let skipped = 0;

  for (const invoice of invoices) {
    processed += 1;
    try {
      const outcome = await processInvoice(client, invoice);
      if (outcome === 'sent') sent += 1;
      else skipped += 1;
    } catch (err) {
      // Per-row try/catch — one bad row never aborts the batch.
      console.error('[invoice-dunning] unhandled error on invoice', invoice.id, err);
      skipped += 1;
    }
  }

  return jsonResponse({ success: true, mode: 'cron', processed, sent, skipped });
});
