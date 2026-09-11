// utils/weekClose/composeWeekClose.ts
//
// Pure five-leg Friday Close composer. No React, no network, no storage.
// Sibling of composeBrief.ts — same design rules, different cadence.
//
// CADENCE (G10): a project contributes DERIVED items only if status
// 'in_progress' AND any activity in the trailing 14 days (report, invoice, or
// task status change). Zero qualifying items → allQuiet=true + honest quiet
// line. The Friday nudge is not armed when nothing qualifies.
//
// WHAT THE CADENCE GATE MAY AND MAY NOT SUPPRESS (runtime audit 2026-09-06,
// NAV-11). The home card read "Friday close — Clean close, nothing left on the
// table" directly above an 11-day-overdue invoice (Houston Phone Booth Ad,
// #1, $77,201.39 outstanding — $81,264.63 gross less $4,063.23 of held
// retention, and outstanding is the figure this leg reports) and $287.15 of
// drafted, unsent change orders. Both were real
// and both were invisible to this composer: the invoice because its project
// had gone quiet, the COs because leg 1 only ever looked at leak-auto-drafted
// ones. A job going quiet while its invoice ages past due is not the case to
// suppress — it is the case the Friday close exists for.
//
// The line drawn here:
//   • DERIVED ESTIMATES (unbilled WIP — earned value off cost-to-date and
//     percent complete) stay behind the 14-day gate. On a dormant job the
//     inputs are stale, so the dollar figure would be a guess presented as a
//     number.
//   • RECORDS (an overdue invoice, a drafted change order) are never
//     suppressed by cadence. They are facts with dates on them; silence on the
//     job does not make the money less owed or the CO less unsent.
//
// LEG 1 bill  — unbilled WIP rows (> $500 floor, desc) + every drafted change
//               order with a positive amount (leak-auto-drafted ones labelled
//               as such) + QBO pending count line
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
import { invoiceOutstanding } from '@/utils/invoiceBilling';
// Reused, not re-derived: buildReadyToBill is the single definition of "a
// change order that is drafted and unsent", shared with the home ReadyToBill
// card so the two surfaces can never disagree.
import { buildReadyToBill } from '@/utils/draftedRevenue';
import type { PaymentPredictionResult } from '@/utils/paymentPrediction';
import type { WeeklyCommitment } from '@/utils/lastPlanner';
import { computePpc } from '@/utils/lastPlanner';
import type { WeekClose, WeekCloseLeg, WeekCloseLegId } from './types';
import type { BriefItem } from '@/utils/brief/composeBrief';

// ─── Quiet line ───────────────────────────────────────────────────────────────

/**
 * SUPERSEDED — do not render this. Use QUIET_CLOSE_HEADLINE.
 *
 * CLOSE-SCOPE (polish audit 2026-09-10, empty-states P2 / dead-ends P2). This
 * was the Friday Close headline, and it rendered byte-identically in an empty
 * account and in a seeded one carrying an RFI 23 days past due to the architect,
 * a lapsed electrical permit, and 19 of 21 working days with no daily log. None
 * of those three is in scope for ANY leg here, so "nothing left on the table"
 * was a claim about the whole week made from five legs' worth of evidence. Each
 * leg's own line was already honest; the verdict over the top of them was not.
 *
 * It is still exported, and only for one reason: scripts/validate-compose-week-
 * close.ts:740 asserts this exact literal, and that file is outside the set this
 * change may edit. Deleting it here turns the ship gate red; changing its value
 * does the same. The follow-up is two lines — point that assertion at
 * QUIET_CLOSE_HEADLINE and delete this constant — and it is filed rather than
 * left implicit, because a constant nothing renders is the kind of thing the
 * next reader re-adopts by accident.
 *
 * @deprecated superseded by QUIET_CLOSE_HEADLINE; pinned only by the validator.
 */
export const QUIET_CLOSE_LINE = 'Clean close — nothing left on the table this week.';

/**
 * The headline the Friday Close actually shows when all five legs come back
 * empty.
 *
 * It reports the RESULT OF THE CHECK, not a verdict on the business, and that
 * distinction is the whole point. The first narrowing of this line read "Clean
 * close on billing, collections, the plan and client updates." — scoped to the
 * five legs, and still false in two directions on the audited account:
 *
 *   • It said the plan closed clean directly above the plan leg's own line,
 *     "No weekly plan was tracked this week." There was no plan. An absent
 *     measurement had been promoted to a passing grade.
 *   • It said billing was clean directly above "Nothing unbilled from the costs
 *     recorded so far" — the disclaimer the bill leg had just been given
 *     precisely because a job with no cost recorded cannot show underbilling.
 *     The headline took it straight back.
 *
 * Every one of these legs goes quiet either because there is genuinely nothing
 * outstanding OR because nothing was recorded to measure, and this composer
 * cannot tell those two apart. So it says the true thing — nothing came back —
 * and the leg lines underneath say what each one looked at.
 *
 * Widening (an RFI/submittal leg) still wants doing; its inputs arrive through
 * hooks/useWeekClose.ts, a file this change does not own.
 * utils/brainWatch.ts now carries rfiAttention / submittalAttention for exactly
 * that wiring, and QUIET_CLOSE_SCOPE_NOTE says what is skipped until it lands.
 */
export const QUIET_CLOSE_HEADLINE = "Nothing open in this week's five checks";

/**
 * What the five legs do NOT cover, shown under a quiet headline.
 *
 * Friday afternoon is precisely when an unanswered RFI should get chased, so a
 * close that cannot see one has to say so rather than let its silence read as
 * an answer. Margin is named here and deliberately NOT imported: the projected
 * margin the rest of the app shows double-counts awarded buyout against the
 * estimate line that already priced it (utils/jobCostEngine.ts matches an
 * estimate's `item.category` against a commitment's `c.phase`, exactly and
 * case-sensitively), so pulling it in would trade a false "clean" for a false
 * "losing money".
 */
export const QUIET_CLOSE_SCOPE_NOTE =
  'RFIs, permits and job margin are not part of this check — see Waiting On and Margin Alerts for those.';

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

  // Every DRAFTED change order with a positive amount — not just the ones MAGE
  // auto-drafted from a leak scan (NAV-11). Both of the founder's two drafts
  // ($36.89 + $250.26 = $287.15) were hand-written, so the old auto-only loop
  // saw neither and the close called itself clean with them sitting unsent.
  //
  // buildReadyToBill is the canonical "$X in change orders ready to send"
  // predicate (components/home/ReadyToBillCard.tsx reads the same function) —
  // reused, not re-derived, so the Friday close and the home card can never
  // disagree about what is unsent. No cadence gate and no age cap: a drafted CO
  // is a record, not an estimate.
  //
  // The cost of no age cap, stated plainly: one stale draft anywhere in the
  // account keeps allQuiet false, so the close cannot report "clean" while it
  // exists. That is the intended trade — the inverse (a close that calls itself
  // clean over unsent money) is the bug this whole change exists to kill, and
  // the draft is one tap from being sent or deleted. The home ReadyToBillCard
  // has counted it the same way all along; a cap here and not there would put
  // the two surfaces back into disagreement.
  const readyToBill = buildReadyToBill({ changeOrders, projects, nowMs: now.getTime() });
  const knownProjectIds = new Set(projects.map(p => p.id));
  for (const row of readyToBill.rows) {
    // buildReadyToBill fills an unknown project with the literal string
    // 'Project' for its own card's layout. Prefixing a close line with
    // "Project: " reads as a job actually named Project, so drop the prefix
    // when the name is not really known.
    const prefix = knownProjectIds.has(row.projectId) ? `${row.projectName}: ` : '';
    items.push({
      // Auto-drafted rows keep their historical `leak-co-` id so nothing
      // keyed on it (dedupe, dismissal anchors) shifts under this change.
      id: row.isAuto ? `leak-co-${row.id}` : `draft-co-${row.id}`,
      text: row.isAuto
        ? `CO #${row.coNumber} drafted from scan — ${fmtMoney(row.amount)} — review & send`
        : `${prefix}CO #${row.coNumber} drafted — ${fmtMoney(row.amount)} — not sent yet`,
      severity: 'medium',
      route: { pathname: '/change-order', params: { coId: row.id, projectId: row.projectId } },
    });
  }
  // `autoDraftedCOs` is still accepted on the input for callers that
  // pre-filter, but it is no longer the source of truth — a CO in it that is
  // not in `changeOrders` would be invisible, so fold any stragglers in.
  for (const co of autoDraftedCOs) {
    if (readyToBill.rows.some(r => r.id === co.id)) continue;
    if ((co.changeAmount ?? 0) <= 0 || co.status !== 'draft') continue;
    items.push({
      id: `leak-co-${co.id}`,
      text: `CO #${co.number} drafted from scan — ${fmtMoney(co.changeAmount)} — review & send`,
      severity: 'medium',
      route: { pathname: '/change-order', params: { coId: co.id, projectId: co.projectId } },
    });
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
  paymentPredictions: PaymentPredictionResult | null | undefined,
  now: Date,
): WeekCloseLeg {
  const items: BriefItem[] = [];
  const todayISO = localDateISO(now);

  // Overdue invoices: dueDate in the past, balance > 0. NO cadence gate.
  //
  // NAV-11 (runtime audit 2026-09-06): this used to require the invoice's
  // project to have had a report, an invoice or task movement in the trailing
  // 14 days. The founder's Houston Phone Booth Ad had none of those and an
  // 11-day-overdue invoice — $77,201.39 outstanding, which is the $81,264.63
  // gross less the $4,063.23 of retention the client is entitled to hold —
  // so the leg came back empty, allQuiet went true, and the home card said
  // "Clean close — nothing left on the table" while the attention card two
  // inches above it named that invoice. A quiet job with an ageing receivable
  // is the single most important thing a Friday close can tell you;
  // suppressing it inverted the feature.
  //
  // WHAT STAYS UNGATED, DELIBERATELY. There is no project-status filter here
  // either. `completed` and `closed` jobs keep their overdue invoices in the
  // leg on purpose: closeout is precisely when a final draw or a released
  // retention goes unpaid, and a job being finished does not make the money
  // less owed. The only thing that removes an invoice from this leg is being
  // settled (balance <= 0) or marked paid. Pinned by the project-status cases
  // in scripts/validate-compose-week-close.ts so nobody restores a filter here
  // by reflex.
  //
  // MONEY-F5: balance is net of held retention — an invoice paid down to its
  // retention is not "45d overdue" on the Friday close.
  const overdueInvoices = invoices.filter(inv => {
    const balance = invoiceOutstanding(inv);
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
    const balance = invoiceOutstanding(inv);

    const daysOverdue = Math.round(
      (now.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000,
    );

    // Now that the leg is ungated, an invoice can outlive the project row it
    // points at (deleted job, a record that has not synced yet). The old
    // fallback printed the literal word "Project" in the slot where a job name
    // goes — "Invoice #3 (Project)" reads like a job actually called Project.
    // If the name is not known, do not put anything in its place.
    const projSuffix = proj?.name ? ` (${proj.name})` : '';
    let text = `Invoice #${inv.number}${projSuffix}: ${fmtMoney(balance)} — ${daysOverdue}d overdue`;
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

// The pg_cron job that actually sends the homeowner digest.
//
// `homeowner-weekly-digest-friday`, schedule '0 21 * * 5' — 21:00 UTC on
// Fridays. Defined in supabase/migrations/20260523130000_cron_secret_guard.sql
// :89 and verified active on production (nteoqhcswappxxjlpvap) on 2026-09-07.
// If that schedule ever changes, these two constants change with it — the copy
// below is generated from them, never written by hand.
const DIGEST_CRON_UTC_DAY = 5;   // Friday, per cron field 5
const DIGEST_CRON_UTC_HOUR = 21; // 21:00 UTC

/**
 * The next moment the digest cron fires at or after `now`, as a real instant.
 *
 * Returned as an instant rather than a weekday name on purpose: 21:00 UTC is
 * not Friday everywhere, so the only honest way to name the day is to render
 * this Date in the reader's own timezone.
 */
export function nextHomeownerDigestSend(now: Date): Date {
  const d = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
    DIGEST_CRON_UTC_HOUR, 0, 0, 0,
  ));
  d.setUTCDate(d.getUTCDate() + ((DIGEST_CRON_UTC_DAY - d.getUTCDay() + 7) % 7));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "4:00pm" in the reader's local zone. Hand-rolled rather than
 *  toLocaleTimeString so the string is identical under Hermes and under Bun,
 *  where the validator runs. */
function fmtLocalTime(d: Date): string {
  const h24 = d.getHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}${h24 < 12 ? 'am' : 'pm'}`;
}

/**
 * The one line the Friday close says about the automatic homeowner digest.
 *
 * CLOSE-DIGEST-TODAY (runtime audit 2026-09-06): this used to be the constant
 * string "Portal homeowner digest goes out automatically today", pushed
 * whenever any active project had a portal, with no weekday test at all. The
 * card that opens this modal (components/home/WeekCloseCard.tsx, isFridayWindow)
 * is readable Friday through Sunday, so on two of its three days the app told
 * the GC his homeowner had already been updated today when nothing had been
 * sent — and it said it in a line explicitly framed as an honesty note, which
 * is exactly the kind of claim a user trusts and does not verify. The comment
 * guarding it also cited "Fri 16:00 UTC"; the live job runs at 21:00 UTC.
 *
 * Exported so scripts/validate-compose-week-close.ts can pin every day of the
 * week without reconstructing a whole ComposeWeekCloseInput.
 */
export function homeownerDigestLine(now: Date): string {
  const next = nextHomeownerDigestSend(now);
  const previous = new Date(next.getTime() - 7 * 24 * 60 * 60 * 1000);
  const today = localDateISO(now);

  if (localDateISO(previous) === today) {
    return `Portal homeowner digest is sent automatically — today's went out at ${fmtLocalTime(previous)}`;
  }
  if (localDateISO(next) === today) {
    return `Portal homeowner digest is sent automatically — today's goes out at ${fmtLocalTime(next)}`;
  }
  return `Portal homeowner digest is sent automatically — next one ${WEEKDAY_NAMES[next.getDay()]} at ${fmtLocalTime(next)}, nothing goes out today`;
}

function buildClientsLeg(
  unsentClientItemCount: number | undefined,
  activeProjects: Project[],
  now: Date,
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

  // HONESTY: the portal digest is sent by pg_cron, not by the GC — say so,
  // don't re-surface it as a to-do. Shown ONLY when an active project actually
  // has a portal (saying it to a non-portal user is false), informational for
  // the same reason as above, and worded against the real cron schedule so it
  // cannot claim a send on a day nothing sends (CLOSE-DIGEST-TODAY).
  if (activeProjects.some(p => p.clientPortal?.enabled)) {
    items.push({
      id: 'portal-digest-notice',
      text: homeownerDigestLine(now),
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
      input.paymentPredictions,
      now,
    ),
    buildCloseLeg(input.wwp, now),
    buildCommitLeg(input.lookaheadReadyCount),
    buildClientsLeg(input.unsentClientItemCount, activeProjects, now),
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
