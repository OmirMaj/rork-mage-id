// utils/weekClose/composeWeekClose.ts
//
// Pure five-leg Friday Close composer. No React, no network, no storage.
// Sibling of composeBrief.ts — same design rules, different cadence.
//
// CADENCE (G10): a project contributes items only if status 'in_progress' AND
// any activity in the trailing 14 days (report, invoice, or task status change).
// Zero qualifying items → allQuiet=true + honest quiet line. The Friday nudge
// is not armed when nothing qualifies.
//
// LEG 1 bill  — unbilled WIP rows (> $500 floor, desc) + auto-drafted leak COs
//               + QBO pending count line
// LEG 2 chase — overdue invoices with payment predictions
// LEG 3 close — WWP PPC for the ending week (recap → informational)
// LEG 4 commit — lookahead constraint-clear task count (forecast → informational)
// LEG 5 clients — unsent client-outbox items + (informational, active-project
//               gated) weekly-update link and portal-digest notice
//
// INFORMATIONAL RULE (sim-audit fix #13): recap/forecast/notice lines carry
// informational:true and never count toward allQuiet or any surface's
// open-leg count. Only ACTIONABLE items (unbilled WIP, leak COs, QBO review,
// overdue invoices, unsent client items) flip a leg open. This is what keeps
// the home card ("N legs to close out") and the modal headline ("Clean
// close…") in agreement — they both filter on the same flag.
//
// HONESTY: dunning already auto-chases (invoice-dunning fn). Leg 2 SHOWS the
// state, never re-sends. Per-send receipts are deferred (documented cut).

import type {
  Project, Invoice, ChangeOrder, DailyFieldReport,
} from '@/types';
import { localDateISO } from '@/utils/brief/composeBrief';
import type { PaymentPredictionResult } from '@/utils/paymentPrediction';
import type { WeeklyCommitment } from '@/utils/lastPlanner';
import { computePpc } from '@/utils/lastPlanner';
import type { WeekClose, WeekCloseLeg, WeekCloseLegId } from './types';
import type { BriefItem } from '@/utils/brief/composeBrief';

// ─── Quiet line ───────────────────────────────────────────────────────────────

export const QUIET_CLOSE_LINE = 'Clean close — nothing left on the table this week.';

// ─── Bill-leg WIP row shape ───────────────────────────────────────────────────

/**
 * The per-project WIP figures the bill leg consumes. useWeekClose derives
 * these from the REAL WIP engine (utils/wip computeWipRow — cost-basis earned
 * value; `unbilled` = underbilling), the same math the WIP Report screen
 * shows. financialReports.computeWIPReport is deliberately NOT the source:
 * its percent basis is billed/revised, which makes earned ≡ billed and
 * unbilled structurally 0.
 */
export interface WeekCloseWipRow {
  projectId: string;
  projectName: string;
  /** Earned-not-billed dollars (utils/wip `underbilling`). */
  unbilled: number;
  /** Percent complete, 0–100. */
  percentComplete: number;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function shiftDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function toLocalDay(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.length === 10) return raw;
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return null;
  return localDateISO(t);
}

// ─── Activity check (cadence predicate, G10) ─────────────────────────────────

const ACTIVITY_WINDOW_DAYS = 14;

/** True if a project had any trackable activity in the trailing 14 days.
 *  Criteria: at least one daily report in window, or invoice issued in window,
 *  or a task with progress change (approximated by tasks with progress > 0).
 *  Pure over the supplied inputs. */
export function projectIsActive(
  project: Project,
  invoices: Invoice[],
  dailyReports: DailyFieldReport[],
  now: Date,
): boolean {
  if (project.status !== 'in_progress') return false;

  const windowStart = localDateISO(shiftDays(now, -ACTIVITY_WINDOW_DAYS));

  // Any daily report in window?
  const projectReports = dailyReports.filter(r => r.projectId === project.id);
  if (projectReports.some(r => {
    const d = toLocalDay(r.date);
    return d != null && d >= windowStart;
  })) return true;

  // Any invoice issued in window?
  const projectInvoices = invoices.filter(inv => inv.projectId === project.id);
  if (projectInvoices.some(inv => {
    const d = toLocalDay(inv.issueDate);
    return d != null && d >= windowStart;
  })) return true;

  // Any tasks with progress (basic activity signal)?
  const tasks = project.schedule?.tasks ?? [];
  if (tasks.some(t => (t.progress ?? 0) > 0)) return true;

  return false;
}

// ─── LEG 1: bill what you earned ─────────────────────────────────────────────

const UNBILLED_FLOOR = 500;

function buildBillLeg(
  wipRows: WeekCloseWipRow[],
  projects: Project[],
  invoices: Invoice[],
  dailyReports: DailyFieldReport[],
  changeOrders: ChangeOrder[],
  autoDraftedCOs: ChangeOrder[],
  qboPendingCount: number,
  now: Date,
): WeekCloseLeg {
  const items: BriefItem[] = [];

  // Unbilled WIP rows above floor, for active projects, descending by unbilled
  const activeProjectIds = new Set(
    projects
      .filter(p => projectIsActive(p, invoices, dailyReports, now))
      .map(p => p.id),
  );

  const unbilledRows = wipRows
    .filter(row => row.unbilled > UNBILLED_FLOOR && activeProjectIds.has(row.projectId))
    .sort((a, b) => b.unbilled - a.unbilled);

  for (const row of unbilledRows) {
    items.push({
      id: `unbilled-${row.projectId}`,
      text: `${row.projectName}: ${fmtMoney(row.unbilled)} unbilled (${Math.round(row.percentComplete)}% complete)`,
      severity: row.unbilled >= 10_000 ? 'high' : 'medium',
      route: { pathname: '/bill-from-estimate', params: { projectId: row.projectId } },
    });
  }

  // Auto-drafted leak COs (still in 'draft', have auto_drafted_from_leak marker)
  for (const co of autoDraftedCOs) {
    const proj = projects.find(p => p.id === co.projectId);
    const projName = proj?.name ?? 'Project';
    items.push({
      id: `leak-co-${co.id}`,
      text: `CO #${co.number} drafted from scan — ${fmtMoney(co.changeAmount)} — review & send`,
      severity: 'medium',
      route: { pathname: '/change-order', params: { coId: co.id, projectId: co.projectId } },
    });
    // Dedupe: skip the WIP unbilled line for this project if the CO draft
    // would appear twice (the CO amount is included in the project's unbilled).
    // We allow both since they are distinct actions (invoice vs CO), but the
    // UI dedupe guard below handles CO appearing as both an unbilled WIP row
    // item AND an autoDraftedCO item. Keep both — different actions.
    void projName; // used above for future copy
  }

  // QBO pending count
  if (qboPendingCount > 0) {
    items.push({
      id: 'qbo-pending',
      text: `${qboPendingCount} QBO cost${qboPendingCount === 1 ? '' : 's'} need review`,
      severity: 'medium',
      route: { pathname: '/qbo-review' },
    });
  }

  return { id: 'bill', title: 'Bill what you earned', items };
}

// ─── LEG 2: chase what you're owed ───────────────────────────────────────────

function buildChaseLeg(
  invoices: Invoice[],
  projects: Project[],
  dailyReports: DailyFieldReport[],
  paymentPredictions: PaymentPredictionResult | null | undefined,
  now: Date,
): WeekCloseLeg {
  const items: BriefItem[] = [];
  const todayISO = localDateISO(now);

  const activeProjectIds = new Set(
    projects
      .filter(p => projectIsActive(p, invoices, dailyReports, now))
      .map(p => p.id),
  );

  // Overdue invoices: dueDate in the past, balance > 0, on active projects
  const overdueInvoices = invoices.filter(inv => {
    if (!activeProjectIds.has(inv.projectId)) return false;
    const balance = inv.totalDue - (inv.amountPaid ?? 0);
    if (balance <= 0) return false;
    const due = toLocalDay(inv.dueDate);
    if (!due) return false;
    return due < todayISO && inv.status !== 'paid';
  });

  // Build prediction lookup for landing dates
  const predMap = new Map<string, string>();
  if (paymentPredictions?.perInvoice) {
    for (const p of paymentPredictions.perInvoice) {
      if (p.predictedPayDate) predMap.set(p.invoiceId, p.predictedPayDate);
    }
  }

  for (const inv of overdueInvoices) {
    const proj = projects.find(p => p.id === inv.projectId);
    const projName = proj?.name ?? 'Project';
    const balance = inv.totalDue - (inv.amountPaid ?? 0);

    const daysOverdue = Math.round(
      (now.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000,
    );

    let text = `Invoice #${inv.number} (${projName}): ${fmtMoney(balance)} — ${daysOverdue}d overdue`;
    const predicted = predMap.get(inv.id);
    if (predicted) {
      text += ` — predicted landing ${predicted}`;
    }
    // HONESTY: dunning already auto-chases. We show state, not "send reminder".
    items.push({
      id: `overdue-${inv.id}`,
      text,
      severity: daysOverdue >= 30 ? 'high' : 'medium',
      route: { pathname: '/payment-predictions' },
    });
  }

  return { id: 'chase', title: "Chase what you're owed", items };
}

// ─── LEG 3: close this week's plan ───────────────────────────────────────────

function buildCloseLeg(
  wwp: { commitments: WeeklyCommitment[]; ppc: number | null } | null | undefined,
  now: Date,
): WeekCloseLeg {
  const items: BriefItem[] = [];

  if (wwp && wwp.commitments.length > 0) {
    // Compute PPC for the ENDING week (the Monday of the current week)
    const thisMonday = (() => {
      const d = new Date(now);
      const dow = d.getDay(); // 0 = Sunday
      const shift = dow === 0 ? -6 : 1 - dow;
      d.setDate(d.getDate() + shift);
      return localDateISO(d);
    })();

    const ppcRecord = computePpc(wwp.commitments, thisMonday);

    if (ppcRecord.committed > 0) {
      const pctDisplay = Math.round(ppcRecord.ppc * 100);
      const emoji = ppcRecord.ppc >= 0.85 ? '' : ppcRecord.ppc >= 0.6 ? '' : '';
      const verdict = ppcRecord.ppc >= 0.85
        ? 'Strong week'
        : ppcRecord.ppc >= 0.6
        ? 'Solid week'
        : 'Rough week';
      items.push({
        id: 'ppc-close',
        text: `${emoji}${verdict} — committed ${ppcRecord.committed}, finished ${ppcRecord.completed} (${pctDisplay}% PPC)`,
        severity: ppcRecord.ppc < 0.6 ? 'medium' : undefined,
        route: { pathname: '/last-planner' },
        // A RECAP of the finished week, not open work — informational so the
        // home card and the modal headline count the same legs (sim-audit
        // #13: home said "1 leg to close out" while the modal said "Clean
        // close" because recap/forecast lines flipped allQuiet on only one
        // surface's snapshot).
        informational: true,
      });
    } else if (wwp.ppc != null) {
      // Fallback: pre-computed ppc passed in
      const pctDisplay = Math.round(wwp.ppc * 100);
      items.push({
        id: 'ppc-close-fallback',
        text: `Last week's PPC: ${pctDisplay}%`,
        severity: wwp.ppc < 0.6 ? 'medium' : undefined,
        route: { pathname: '/last-planner' },
        // Same recap rule as ppc-close above.
        informational: true,
      });
    }
  }

  return { id: 'close', title: "Close this week's plan", items };
}

// ─── LEG 4: commit next week ──────────────────────────────────────────────────

function buildCommitLeg(
  lookaheadReadyCount: number | undefined,
): WeekCloseLeg {
  const items: BriefItem[] = [];

  if (lookaheadReadyCount != null && lookaheadReadyCount > 0) {
    items.push({
      id: 'lookahead-ready',
      text: `${lookaheadReadyCount} task${lookaheadReadyCount === 1 ? '' : 's'} constraint-clear for next week`,
      severity: undefined,
      route: { pathname: '/last-planner' },
      // A FORECAST fact ("these tasks are ready"), not something left on the
      // table — informational, same verdict rule as the ppc recap lines.
      informational: true,
    });
  }

  return { id: 'commit', title: 'Commit next week', items };
}

// ─── LEG 5: tell the clients ──────────────────────────────────────────────────

function buildClientsLeg(
  unsentClientItemCount: number | undefined,
  activeProjects: Project[],
): WeekCloseLeg {
  const items: BriefItem[] = [];

  if (unsentClientItemCount != null && unsentClientItemCount > 0) {
    items.push({
      id: 'unsent-client',
      text: `${unsentClientItemCount} unsent client item${unsentClientItemCount === 1 ? '' : 's'} — review outbox`,
      severity: 'medium',
      route: { pathname: '/client-outbox' },
    });
  }

  // Weekly update drafting link — a low-friction REMINDER, only when there is
  // an active project to update clients about, and informational so it never
  // counts as open work (allQuiet / open-leg counts ignore it).
  if (activeProjects.length > 0) {
    items.push({
      id: 'client-update',
      text: 'Draft this week\'s client update',
      severity: undefined,
      route: { pathname: '/client-update' },
      informational: true,
    });
  }

  // HONESTY: portal digest fires automatically Fri 16:00 UTC for portal
  // projects — say so, don't re-surface as a to-do. Shown ONLY when an active
  // project actually has a portal (saying it to a non-portal user is false),
  // and informational for the same reason as above.
  if (activeProjects.some(p => p.clientPortal?.enabled)) {
    items.push({
      id: 'portal-digest-notice',
      text: 'Portal homeowner digest goes out automatically today',
      severity: undefined,
      route: { pathname: '/client-outbox' },
      informational: true,
    });
  }

  return { id: 'clients', title: 'Tell the clients', items };
}

// ─── Deduplication guard ─────────────────────────────────────────────────────

/**
 * A CO can appear as both an autoDraftedCO in leg 1 AND as an unbilled WIP row
 * for the same project. Per plan: both are DISTINCT actions (CO review vs
 * invoice billing). Deduplicate only rows with the SAME id across legs.
 */
function dedupeItemsById(legs: WeekCloseLeg[]): WeekCloseLeg[] {
  const seen = new Set<string>();
  return legs.map(leg => ({
    ...leg,
    items: leg.items.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  }));
}

// ─── Input type ───────────────────────────────────────────────────────────────

export interface ComposeWeekCloseInput {
  projects: Project[];
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
  dailyReports: DailyFieldReport[];
  /** Caller derives these from the WIP engine (see WeekCloseWipRow doc). */
  wipRows: WeekCloseWipRow[];
  /** utils/paymentPrediction.ts predictInvoicePayments output. */
  paymentPredictions?: PaymentPredictionResult | null;
  /** WWP commitments + pre-computed PPC for this week. */
  wwp?: { commitments: WeeklyCommitment[]; ppc: number | null } | null;
  /** Count of constraint-clear tasks in next week's lookahead window. */
  lookaheadReadyCount?: number;
  /** Unsent client-outbox item count. */
  unsentClientItemCount?: number;
  /** Count of staged QBO cost lines awaiting confirmation (wired in F6). */
  qboPendingCount?: number;
  /**
   * Auto-drafted leak COs (F3): ChangeOrders with status 'draft' that carry
   * an auditTrail entry with action='auto_drafted_from_leak'. Caller filters
   * from the project's change orders.
   */
  autoDraftedCOs?: ChangeOrder[];
  now?: Date;
}

// ─── Main composer ────────────────────────────────────────────────────────────

export function composeWeekClose(input: ComposeWeekCloseInput): WeekClose {
  const now = input.now ?? new Date();
  const autoDraftedCOs = input.autoDraftedCOs ?? [];
  const qboPendingCount = input.qboPendingCount ?? 0;

  const activeProjects = input.projects.filter(
    p => projectIsActive(p, input.invoices, input.dailyReports, now),
  );

  const rawLegs: WeekCloseLeg[] = [
    buildBillLeg(
      input.wipRows,
      input.projects,
      input.invoices,
      input.dailyReports,
      input.changeOrders,
      autoDraftedCOs,
      qboPendingCount,
      now,
    ),
    buildChaseLeg(
      input.invoices,
      input.projects,
      input.dailyReports,
      input.paymentPredictions,
      now,
    ),
    buildCloseLeg(input.wwp, now),
    buildCommitLeg(input.lookaheadReadyCount),
    buildClientsLeg(input.unsentClientItemCount, activeProjects),
  ];

  const legs = dedupeItemsById(rawLegs);

  // Informational lines (evergreen reminders/notices) are not open work —
  // a close with only those is an honestly quiet close (G10).
  const allQuiet = legs.every(leg => leg.items.every(i => i.informational === true));

  return {
    dateISO: localDateISO(now),
    legs,
    allQuiet,
  };
}
