// mageAgent — the brain behind "Ask MAGE anything".
//
// BuildPass/JobTread/Procore all ship a conversational agent now; ours is
// worth more because it reasons across the WHOLE business — money + schedule +
// pipeline — not just one silo. This module serializes a compact snapshot of
// projects, invoices, schedule, leads, change orders and RFIs, then asks the
// existing mageAI relay to answer a plain-language question against it.
//
// Everything routes through mageAI (Supabase edge fn → Gemini), so we inherit
// auth, monthly rate-limit caps, and graceful failure. The agent never throws
// — it returns a readable answer or a plain error string.

import { mageAI } from '@/utils/mageAI';
import { invoiceOutstanding } from '@/utils/invoiceBilling'; // MONEY-F5
import { calendarDayStart, todayCalendarDay } from '@/utils/calendarDate';
import type {
  Project, Invoice, Lead, ChangeOrder, RFI, ProjectSchedule,
} from '@/types';

export interface MageAgentData {
  projects: Project[];
  invoices: Invoice[];
  leads: Lead[];
  changeOrders: ChangeOrder[];
  rfis: RFI[];
}

// Suggested prompts shown on the empty state — the kinds of cross-domain
// questions only a whole-business agent can answer.
export const ASK_MAGE_SUGGESTIONS: string[] = [
  "What's overdue right now?",
  "How much money is unpaid across all jobs?",
  "Which project is over budget?",
  "What's slipping on my schedules?",
  "Which leads should I follow up on?",
  "What change orders are waiting for approval?",
];

function money(n: number): string {
  return '$' + Math.round(n || 0).toLocaleString('en-US');
}

function projectValue(p: Project): number {
  return p.linkedEstimate?.grandTotal ?? p.targetBudget?.amount ?? 0;
}

function invoiceBalance(inv: Invoice): number {
  return invoiceOutstanding(inv); // MONEY-F5: net of held retention
}

function isInvoiceOverdue(inv: Invoice, today: Date): boolean {
  if (inv.status === 'paid') return false;
  if (inv.status === 'overdue') return true;
  const due = inv.dueDate ? new Date(inv.dueDate) : null;
  return !!due && !isNaN(due.getTime()) && due < today && invoiceBalance(inv) > 0;
}

// Count not-yet-done tasks whose planned finish is already in the past — the
// real "overdue / slipping" signal. Needs the schedule's start date to map
// 1-indexed day numbers onto the calendar.
function scheduleOverdueCount(schedule: ProjectSchedule | null | undefined, today: Date): number {
  if (!schedule?.startDate || !Array.isArray(schedule.tasks)) return 0;
  const start = new Date(schedule.startDate);
  if (isNaN(start.getTime())) return 0;
  const todayDay = Math.floor((today.getTime() - start.getTime()) / 86_400_000) + 1;
  return schedule.tasks.filter(t =>
    t.status !== 'done' && (t.startDay + Math.max(0, t.durationDays - 1)) < todayDay,
  ).length;
}

/**
 * Serialize the business into a compact, model-readable brief. Capped so the
 * prompt stays inside the token budget on large accounts.
 */
export function buildBusinessContext(data: MageAgentData, today: Date = new Date()): string {
  const projects = data.projects ?? [];
  const invoices = data.invoices ?? [];
  const leads = data.leads ?? [];
  const changeOrders = data.changeOrders ?? [];
  const rfis = data.rfis ?? [];

  const nameById = new Map(projects.map(p => [p.id, p.name]));
  const out: string[] = [];
  // Local calendar day, not toISOString().slice(0, 10) — that names TOMORROW
  // from ~6 pm anywhere west of Greenwich, and the model reasons from it.
  out.push(`TODAY: ${todayCalendarDay(today)}`);

  // ── Money roll-up ────────────────────────────────────────────────────
  let outstanding = 0, overdue = 0, overdueCount = 0;
  for (const inv of invoices) {
    const bal = invoiceBalance(inv);
    outstanding += bal;
    if (isInvoiceOverdue(inv, today)) { overdue += bal; overdueCount++; }
  }
  out.push(
    `\nMONEY: ${invoices.length} invoices · ${money(outstanding)} outstanding · ` +
    `${money(overdue)} overdue across ${overdueCount} invoice(s).`,
  );

  // ── Projects (active first, capped) ──────────────────────────────────
  const active = projects.filter(p => p.status === 'in_progress' || p.status === 'estimated');
  const ranked = [...projects].sort((a, b) => {
    const rank = (p: Project) => (p.status === 'in_progress' ? 0 : p.status === 'estimated' ? 1 : 2);
    return rank(a) - rank(b);
  });
  out.push(`\nPROJECTS (${projects.length} total, ${active.length} active):`);
  for (const p of ranked.slice(0, 40)) {
    const overdueTasks = scheduleOverdueCount(p.schedule, today);
    const dur = p.schedule?.totalDurationDays;
    out.push(
      `- ${p.name} | ${p.status} | value ${money(projectValue(p))}` +
      (dur ? ` | ${dur}d plan` : '') +
      (overdueTasks ? ` | ${overdueTasks} task(s) past plan` : ''),
    );
  }

  // ── Outstanding / overdue invoices (detail, capped) ──────────────────
  const openInvoices = invoices
    .filter(i => invoiceBalance(i) > 0)
    .sort((a, b) => Number(isInvoiceOverdue(b, today)) - Number(isInvoiceOverdue(a, today)));
  if (openInvoices.length > 0) {
    out.push(`\nUNPAID INVOICES:`);
    for (const inv of openInvoices.slice(0, 25)) {
      out.push(
        `- #${inv.number} | ${nameById.get(inv.projectId) ?? 'project'} | ` +
        `${money(invoiceBalance(inv))} due | ${isInvoiceOverdue(inv, today) ? 'OVERDUE' : inv.status} | due ${inv.dueDate?.slice(0, 10) ?? '—'}`,
      );
    }
  }

  // ── Pipeline ─────────────────────────────────────────────────────────
  const openLeads = leads.filter(l => l.stage !== 'won' && l.stage !== 'lost');
  const pipelineValue = openLeads.reduce((s, l) => s + (l.budgetMax ?? l.budgetMin ?? 0), 0);
  if (leads.length > 0) {
    const byStage = leads.reduce<Record<string, number>>((m, l) => {
      m[l.stage] = (m[l.stage] ?? 0) + 1; return m;
    }, {});
    out.push(
      `\nPIPELINE: ${openLeads.length} open leads · ${money(pipelineValue)} potential · ` +
      Object.entries(byStage).map(([s, n]) => `${n} ${s}`).join(', ') + '.',
    );
    for (const l of openLeads.slice(0, 15)) {
      out.push(`- ${l.name} | ${l.stage}${l.projectType ? ` | ${l.projectType}` : ''} | ${money(l.budgetMax ?? l.budgetMin ?? 0)}`);
    }
  }

  // ── Change orders awaiting approval ──────────────────────────────────
  const pendingCOs = changeOrders.filter(c =>
    c.status === 'draft' || c.status === 'submitted' || c.status === 'under_review',
  );
  if (pendingCOs.length > 0) {
    const sum = pendingCOs.reduce((s, c) => s + (c.changeAmount ?? 0), 0);
    out.push(`\nCHANGE ORDERS awaiting approval: ${pendingCOs.length} · ${money(sum)} total.`);
    for (const c of pendingCOs.slice(0, 12)) {
      out.push(`- CO#${c.number} | ${nameById.get(c.projectId) ?? 'project'} | ${money(c.changeAmount)} | ${c.status}`);
    }
  }

  // ── Open / overdue RFIs ──────────────────────────────────────────────
  const openRfis = rfis.filter(r => r.status === 'open');
  if (openRfis.length > 0) {
    const overdueRfis = openRfis.filter(r => {
      // calendarDayStart: a bare 'YYYY-MM-DD' dateRequired parsed with
      // `new Date()` is UTC midnight — overdue the evening BEFORE the due day
      // west of Greenwich (B4 review A2).
      const need = calendarDayStart(r.dateRequired);
      return !!need && need < today;
    });
    out.push(`\nRFIs: ${openRfis.length} open${overdueRfis.length ? `, ${overdueRfis.length} past their needed-by date` : ''}.`);
    for (const r of openRfis.slice(0, 12)) {
      out.push(`- RFI#${r.number} | ${nameById.get(r.projectId) ?? 'project'} | ${r.subject} | needed ${r.dateRequired?.slice(0, 10) ?? '—'}`);
    }
  }

  return out.join('\n');
}

export interface AskMageResult {
  answer: string;
  errorKind?: string;
  fromCache?: boolean;
}

/**
 * Answer a plain-language question against the business snapshot. Never
 * throws — returns a readable answer or a plain error message.
 */
export async function askMage(question: string, data: MageAgentData): Promise<AskMageResult> {
  const context = buildBusinessContext(data);
  const prompt =
    'You are MAGE, the assistant inside a construction contractor\'s app. Answer the ' +
    'user\'s question using ONLY the business data below. Be concise and concrete — cite ' +
    'project names, dollar amounts, invoice/CO/RFI numbers, and dates. Lead with the direct ' +
    'answer, then a short supporting detail. Use plain sentences (a short list is fine when ' +
    'enumerating items). If the answer isn\'t derivable from the data, say so plainly rather ' +
    'than guessing. Money is in USD.\n\n' +
    `BUSINESS DATA:\n${context}\n\nQUESTION: ${question}`;

  try {
    const res = await mageAI({ prompt, tier: 'smart', maxTokens: 700 });
    const text = typeof res.data === 'string' && res.data.trim()
      ? res.data.trim()
      : (res.raw?.trim() || '');
    if (!res.success || !text) {
      return {
        answer: res.error
          ? `MAGE couldn't answer that: ${res.error}`
          : 'MAGE couldn\'t answer that right now. Try again in a moment.',
        errorKind: res.errorKind,
        fromCache: res.fromCache,
      };
    }
    return { answer: text, errorKind: res.errorKind, fromCache: res.fromCache };
  } catch (e) {
    return { answer: `MAGE hit an error: ${String((e as Error).message ?? e)}` };
  }
}
