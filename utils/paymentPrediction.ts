import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type { Invoice, Project } from '@/types';

export interface InvoicePrediction {
  invoiceId: string;
  invoiceNumber: number;
  projectName: string;
  outstandingAmount: number;
  onTimeProbability: number; // 0-100
  predictedPayDate: string;  // ISO
  daysToPay: number;
  riskLevel: 'low' | 'medium' | 'high';
  reasons: string[];
  suggestedAction: string;
}

export interface PaymentPredictionResult {
  perInvoice: InvoicePrediction[];
  expected7dInflow: number;
  expected14dInflow: number;
  expected30dInflow: number;
  atRiskAmount: number;
  collectionRiskScore: number; // 0-100, higher = riskier
  headline: string;
  topAction: string;
}

// Every field has a default — if Gemini returns partial data, the
// mageAI salvage path can rescue per-field instead of throwing the
// whole forecast away. Previously a single missing `riskLevel` (or
// the model returning a free-text level like "moderate") killed the
// entire response and the user saw "Could not forecast payments."
const predictionSchema = z.object({
  perInvoice: z.array(z.object({
    invoiceId: z.string().default(''),
    onTimeProbability: z.number().default(50),
    daysToPay: z.number().default(21),
    riskLevel: z.enum(['low', 'medium', 'high']).catch('medium').default('medium'),
    reasons: z.array(z.string()).default([]),
    suggestedAction: z.string().default(''),
  })).default([]),
  collectionRiskScore: z.number().default(50),
  headline: z.string().default(''),
  topAction: z.string().default(''),
});

const predictionHint = {
  perInvoice: [
    {
      invoiceId: 'inv-123',
      onTimeProbability: 72,
      daysToPay: 18,
      riskLevel: 'medium',
      reasons: ['Client 6 days past due date', 'Progress invoice, large ticket'],
      suggestedAction: 'Send polite reminder email and confirm receipt of invoice.',
    },
  ],
  collectionRiskScore: 38,
  headline: '3 invoices worth $52,400 are at risk of sliding past 30 days.',
  topAction: 'Call Acme LLC about invoice #12 — it is 9 days past due and they typically pay on day 45.',
};

function outstandingOf(inv: Invoice): number {
  const retentionPending = Math.max(0, (inv.retentionAmount ?? 0) - (inv.retentionReleased ?? 0));
  const netPayable = Math.max(0, (inv.totalDue ?? 0) - retentionPending);
  return Math.max(0, netPayable - (inv.amountPaid ?? 0));
}

function daysBetween(a: string, b: string): number {
  const t1 = new Date(a).getTime();
  const t2 = new Date(b).getTime();
  if (isNaN(t1) || isNaN(t2)) return 0;
  return Math.round((t2 - t1) / 86_400_000);
}

function describePaymentHistory(inv: Invoice, allInvoices: Invoice[]): string {
  const sameProject = allInvoices.filter(i => i.projectId === inv.projectId && i.id !== inv.id);
  const paidOnes = sameProject.filter(i => i.status === 'paid' && i.payments.length > 0);
  if (paidOnes.length === 0) return 'No prior paid invoices on this project.';
  const gaps = paidOnes.map(p => {
    const firstPayment = p.payments[p.payments.length - 1];
    return daysBetween(p.issueDate, firstPayment.date);
  }).filter(n => n >= 0);
  if (gaps.length === 0) return 'No prior paid invoices on this project.';
  const avg = Math.round(gaps.reduce((s, n) => s + n, 0) / gaps.length);
  return `Avg pay time on prior ${paidOnes.length} invoice${paidOnes.length === 1 ? '' : 's'}: ${avg} days from issue.`;
}

export async function predictInvoicePayments(
  invoices: Invoice[],
  projectsById: Record<string, Project>,
): Promise<PaymentPredictionResult> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  // Only predict unpaid / partially paid
  const unpaid = invoices.filter(i => {
    const out = outstandingOf(i);
    return out > 0 && i.status !== 'draft';
  });

  if (unpaid.length === 0) {
    return {
      perInvoice: [],
      expected7dInflow: 0,
      expected14dInflow: 0,
      expected30dInflow: 0,
      atRiskAmount: 0,
      collectionRiskScore: 0,
      headline: 'No unpaid invoices to forecast.',
      topAction: 'Keep the cadence going — issue your next progress invoice when milestones complete.',
    };
  }

  const compact = unpaid.map(inv => {
    const project = projectsById[inv.projectId];
    const outstanding = outstandingOf(inv);
    const daysSinceIssue = daysBetween(inv.issueDate, todayIso);
    const daysToDue = daysBetween(todayIso, inv.dueDate);
    const pastDue = daysToDue < 0 ? Math.abs(daysToDue) : 0;
    return {
      id: inv.id,
      number: inv.number,
      project: project?.name || 'Unknown project',
      projectStatus: project?.status || 'unknown',
      type: inv.type,
      progressPercent: inv.progressPercent,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
      paymentTerms: inv.paymentTerms,
      totalDue: inv.totalDue,
      amountPaid: inv.amountPaid,
      outstanding,
      daysSinceIssue,
      daysToDue,
      pastDueDays: pastDue,
      paymentsCount: inv.payments.length,
      retentionPending: Math.max(0, (inv.retentionAmount ?? 0) - (inv.retentionReleased ?? 0)),
      history: describePaymentHistory(inv, invoices),
    };
  });

  const prompt = `You are a construction A/R analyst. For each unpaid invoice, predict payment timing based on client behavior signals and invoice characteristics.

TODAY: ${todayIso}

UNPAID INVOICES (${compact.length}):
${JSON.stringify(compact, null, 2)}

For EACH invoice, return in "perInvoice":
- invoiceId: exactly as provided
- onTimeProbability: 0-100 (probability paid by due date, or within 7 days of today if already past due)
- daysToPay: your realistic estimate of days from TODAY until full payment clears
- riskLevel: "low" (likely paid soon), "medium" (likely 2-4 weeks), "high" (likely 30+ days or write-off risk)
- reasons: 1-3 short bullets citing specific signals (past-due days, payment history, project status, terms)
- suggestedAction: one actionable step the contractor should take right now (call, reminder email, lien notice, offer discount, etc.)

Also return:
- collectionRiskScore: 0-100 portfolio risk (weighted by dollar exposure)
- headline: one sentence summarizing A/R health ("3 invoices worth $X are sliding…")
- topAction: the single highest-leverage action across all invoices

Be concrete. Use specific invoice numbers and project names in headline/topAction. Return JSON only.`;

  const aiResult = await mageAI({
    prompt,
    schema: predictionSchema,
    schemaHint: predictionHint,
    tier: 'smart',
    maxTokens: 2000,
  });

  if (!aiResult.success || !aiResult.data) {
    throw new Error(aiResult.error || 'AI could not forecast payments.');
  }

  let parsed: any = aiResult.data;
  if (typeof parsed === 'string') {
    let cleaned = parsed.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    try { parsed = JSON.parse(cleaned.trim()); } catch { throw new Error('AI returned invalid JSON'); }
  }

  const perInvoiceRaw: any[] = parsed?.perInvoice ?? [];
  const byId = new Map<string, any>();
  perInvoiceRaw.forEach(r => { if (r?.invoiceId) byId.set(r.invoiceId, r); });

  const perInvoice: InvoicePrediction[] = unpaid.map(inv => {
    const aiRow = byId.get(inv.id);
    const project = projectsById[inv.projectId];
    const outstanding = outstandingOf(inv);
    const daysToPay = typeof aiRow?.daysToPay === 'number' ? Math.max(0, Math.round(aiRow.daysToPay)) : 21;
    const predicted = new Date(today.getTime() + daysToPay * 86_400_000).toISOString();
    const riskLevel: 'low' | 'medium' | 'high' = aiRow?.riskLevel === 'low' || aiRow?.riskLevel === 'high' ? aiRow.riskLevel : 'medium';
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      projectName: project?.name || 'Project',
      outstandingAmount: outstanding,
      onTimeProbability: typeof aiRow?.onTimeProbability === 'number'
        ? Math.max(0, Math.min(100, Math.round(aiRow.onTimeProbability)))
        : 50,
      predictedPayDate: predicted,
      daysToPay,
      riskLevel,
      reasons: Array.isArray(aiRow?.reasons) ? aiRow.reasons.slice(0, 3).map((r: any) => String(r)) : [],
      suggestedAction: typeof aiRow?.suggestedAction === 'string'
        ? aiRow.suggestedAction
        : 'Follow up with the client to confirm payment timing.',
    };
  });

  const expected7dInflow = perInvoice
    .filter(p => p.daysToPay <= 7)
    .reduce((s, p) => s + p.outstandingAmount * (p.onTimeProbability / 100), 0);
  const expected14dInflow = perInvoice
    .filter(p => p.daysToPay <= 14)
    .reduce((s, p) => s + p.outstandingAmount * (p.onTimeProbability / 100), 0);
  const expected30dInflow = perInvoice
    .filter(p => p.daysToPay <= 30)
    .reduce((s, p) => s + p.outstandingAmount * (p.onTimeProbability / 100), 0);
  const atRiskAmount = perInvoice
    .filter(p => p.riskLevel === 'high')
    .reduce((s, p) => s + p.outstandingAmount, 0);

  return {
    perInvoice,
    expected7dInflow,
    expected14dInflow,
    expected30dInflow,
    atRiskAmount,
    collectionRiskScore: typeof parsed?.collectionRiskScore === 'number'
      ? Math.max(0, Math.min(100, Math.round(parsed.collectionRiskScore)))
      : 50,
    headline: typeof parsed?.headline === 'string' ? parsed.headline : `Forecasting ${perInvoice.length} unpaid invoices.`,
    topAction: typeof parsed?.topAction === 'string' ? parsed.topAction : 'Review the highest-risk invoice first.',
  };
}
