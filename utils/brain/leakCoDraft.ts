// utils/brain/leakCoDraft.ts
//
// Pure Leak→Draft-CO builder. No React, no network, no storage.
// Sibling of the manual handleDraftLeakCO in app/daily-report.tsx. Both open
// with "Out-of-scope work from daily report <Mon D>" (the manual-draft guard
// below matches that phrase); since wave 4 (#76) neither puts prices, report
// quotes or "NEEDS PRICE" notes into the client-facing description — the items
// are tagged line items instead.
//
// DEDUPE MARKER: auditTrail entry { action:'auto_drafted_from_leak', ... }
// on every auto-drafted CO. Survives cache wipes (audit_trail is a synced
// column). Sweep checks for this marker before drafting a second CO for
// the same report. NO schema change needed (COAuditEntry.action is string).
//
// G8: draft-forever — nothing here or in the sweep transitions status or
//     touches portal send. app/daily-report.tsx is UNTOUCHED.
// G9: callers record a didForYou receipt after each addChangeOrder call.
// G14: no new PredictionKind values introduced.

import type {
  ChangeOrder, ChangeOrderLineItem, ChangeOrderStatus, DailyFieldReport, Project,
} from '@/types';
import { generateUUID } from '@/utils/generateId';
import { nextChangeOrderNumber } from '@/utils/coNumbering';

/** Whole cents (same rule as the CO screen's coRoundCents). */
function centsOf(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** A line's name from the flagged item — its own words, never a price or quote. */
function lineName(desc: string | undefined): string {
  const t = (desc ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return 'Out-of-scope work';
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

// ─── Dedupe marker ────────────────────────────────────────────────────────────

/**
 * The action string stamped into the auditTrail of every auto-drafted leak CO.
 * Used by the sweep to skip reports whose CO was already drafted, and by
 * composeWeekClose to identify auto-drafted COs for leg 1.
 */
export const AUTO_DRAFT_ACTION = 'auto_drafted_from_leak';

/**
 * True if a ChangeOrder was auto-drafted from a leak scan (carries the marker).
 */
export function isAutoLeakDraft(co: ChangeOrder): boolean {
  return (co.auditTrail ?? []).some(e => e.action === AUTO_DRAFT_ACTION);
}

// ─── Candidate collection ────────────────────────────────────────────────────

/** Is `userId` the project's owner? A cache predating ownerUserId is owned
 *  exactly when it carries no collaborator role. */
export function isLeakDraftOwner(
  project: Pick<Project, 'ownerUserId' | 'myRole'>,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (project.ownerUserId) return project.ownerUserId === userId;
  return !project.myRole;
}

export interface DraftCandidate {
  report: DailyFieldReport;
  project: Project;
}

/**
 * Collect daily reports that have ≥1 PRICED leak item and are eligible for
 * auto-drafting.
 *
 * Eligibility rules (from plan §F3):
 *  1. Report is ≤14 days old.
 *  2. Project is active (status 'in_progress').
 *  3. Report's leakScan has ≥1 item with estimatedPrice != null.
 *  4. Report's id is NOT in processedReportIds (already drafted this session).
 *  5. No existing CO for the project references this report's LOCAL calendar
 *     day (±1 day tolerance) in its description via the handleDraftLeakCO
 *     date format — guards against double-drafting when the user manually
 *     drafted first. Local-day parity matters: daily-report.tsx renders
 *     toLocaleDateString on a full ISO timestamp, so the UTC date can be a
 *     day ahead for evening reports in the Americas.
 *  6. No existing CO for the project carries an auditTrail entry with
 *     detail === report.id (id-based dedupe: already auto-drafted in a prior
 *     session — AUTO_DRAFT_ACTION — or otherwise linked to this report).
 */
export function collectDraftableLeaks(opts: {
  dailyReports: DailyFieldReport[];
  projects: Project[];
  changeOrders: ChangeOrder[];
  processedReportIds: Set<string>;
  /** The signed-in user. Required (no default) so no caller can forget it:
   *  only the project OWNER drafts change orders (rule 7). */
  userId: string | null | undefined;
  now?: Date;
}): DraftCandidate[] {
  const { dailyReports, projects, changeOrders, processedReportIds, userId } = opts;
  if (!userId) return [];
  const now = opts.now ?? new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 14);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  // Build a map from projectId → COs for that project (fast lookup).
  const cosByProject = new Map<string, ChangeOrder[]>();
  for (const co of changeOrders) {
    const arr = cosByProject.get(co.projectId) ?? [];
    arr.push(co);
    cosByProject.set(co.projectId, arr);
  }

  const candidates: DraftCandidate[] = [];

  for (const report of dailyReports) {
    // 1. Age check (14-day window).
    const reportDate = report.date?.slice(0, 10) ?? '';
    if (!reportDate || reportDate < cutoffISO) continue;

    // 3. Priced items check.
    const leakItems = report.leakScan?.items ?? [];
    const pricedItems = leakItems.filter(it => it.estimatedPrice != null);
    if (pricedItems.length === 0) continue;

    // 4. Already in processedReportIds this session.
    if (processedReportIds.has(report.id)) continue;

    // 2. Active project check.
    const project = projects.find(p => p.id === report.projectId);
    if (!project || project.status !== 'in_progress') continue;

    // 7. Only the project OWNER drafts a change order (wave 3 #41 — FOUNDER
    //    interim; change_orders INSERT is owner-only since 20260919110000).
    //    The context's lists include jobs shared WITH him, so without this a
    //    collaborator's sweep drafted a CO on the GC's job that RLS then
    //    refused, leaving a phantom local CO he could not send. Same rule as
    //    utils/portalLiteSync.isPortalOwner (not imported: that module pulls
    //    in the whole snapshot builder).
    if (!isLeakDraftOwner(project, userId)) continue;

    const projectCOs = cosByProject.get(project.id) ?? [];

    // 6. Already covered by a CO that references this report's id in its
    //    auditTrail. The AUTO_DRAFT_ACTION marker is the primary signal, but
    //    we accept ANY audit entry whose detail is the report id — id-based
    //    dedupe survives description/date drift entirely.
    const alreadyMarked = projectCOs.some(
      co => (co.auditTrail ?? []).some(e => e.detail === report.id),
    );
    if (alreadyMarked) continue;

    // 5. Manual draft guard: skip if any CO on the project references this
    //    report's date in its description using the handleDraftLeakCO date
    //    string. The manual path (app/daily-report.tsx) renders the LOCAL
    //    calendar day via toLocaleDateString, so the guard must too — and it
    //    tolerates ±1 day so a UTC-vs-local off-by-one on either side (or an
    //    edited report date) can never produce a second CO for the same work.
    const manualDraftExists = projectCOs.some(co => {
      const desc = co.description ?? '';
      return guardSnippetsForReportDate(report.date ?? '').some(s => desc.includes(s));
    });
    if (manualDraftExists) continue;

    candidates.push({ report, project });
  }

  return candidates;
}

// ─── CO builder ───────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Format a YYYY-MM-DD date as "Jul 26" — matches handleDraftLeakCO's format. */
function formatDateForDescription(dateISO: string): string {
  const [, month, day] = dateISO.split('-').map(Number);
  return `${MONTHS_SHORT[(month ?? 1) - 1]} ${day}`;
}

/**
 * Format a report date as the LOCAL calendar day ("Jul 26") — byte-identical
 * to the manual handleDraftLeakCO path, which renders
 * `new Date(reportDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })`.
 * daily-report.tsx stores reportDate as a full ISO timestamp, so slicing the
 * UTC date shifts evening reports (after ~5pm PT / 8pm ET) to the NEXT day;
 * the sweep runs on the same device/timezone, so local rendering is exact
 * parity. Date-only strings are treated as plain calendar dates.
 */
export function formatReportDayLocal(raw: string): string {
  if (!raw) return '';
  if (raw.length === 10) return formatDateForDescription(raw);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return formatDateForDescription(raw.slice(0, 10));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Description snippets the manual-draft guard matches against — the report's
 * local day plus ±1 calendar day, each in the `from daily report <Mon D>`
 * format. The tolerance absorbs any residual UTC/local off-by-one (legacy COs
 * drafted from the UTC-sliced date, cross-midnight edits) so the sweep never
 * double-drafts work the user already turned into a CO by hand.
 */
export function guardSnippetsForReportDate(raw: string): string[] {
  if (!raw) return [];
  const base = raw.length === 10 ? new Date(raw + 'T12:00:00') : new Date(raw);
  if (Number.isNaN(base.getTime())) {
    const fallback = formatReportDayLocal(raw);
    return fallback ? [`from daily report ${fallback}`] : [];
  }
  const snippets: string[] = [];
  for (const offset of [0, -1, 1]) {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    const snippet = `from daily report ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
    if (!snippets.includes(snippet)) snippets.push(snippet);
  }
  return snippets;
}

/**
 * Build a draft ChangeOrder from a DraftCandidate.
 *
 * Description: "Out-of-scope work from daily report <date>." — a client-facing
 * scope sentence; the items are line items tagged with their price source
 * (wave 4 #76).
 *
 * CO number = utils/coNumbering.nextChangeOrderNumber — provisional; the
 * server keeps it when free (20260920050000).
 *
 * DEDUPE MARKER: auditTrail entry with action=AUTO_DRAFT_ACTION, detail=report.id.
 * This is how the sweep identifies its own work in subsequent sessions.
 */
export function buildDraftCO(
  candidate: DraftCandidate,
  existingCOs: ChangeOrder[],
  nowISO: string,
): ChangeOrder {
  const { report, project } = candidate;
  const leakItems = report.leakScan?.items ?? [];

  const pricedItems = leakItems.filter(it => it.estimatedPrice != null);
  const unpricedItems = leakItems.filter(it => it.estimatedPrice == null);

  // LOCAL calendar day — parity with the manual path so the description shows
  // the day the user actually filed the report, and the manual-draft guard's
  // snippet match holds in both directions.
  const when = formatReportDayLocal(report.date ?? '');

  // #76 (wave 4) — the description is CLIENT-FACING: it goes into the email,
  // the portal card and the e-sign record the homeowner signs. It used to carry
  // the AI's "~$450" guesses, verbatim crew quotes from the report and
  // "NEEDS PRICE:" notes. It is now one neutral scope sentence; the items are
  // line items instead, each tagged with where its price came from, and the CO
  // screen refuses to send while a line is unpriced or an unconfirmed AI
  // estimate (coUnconfirmedPriceBlocker). The "from daily report <Mon D>"
  // phrase stays: guardSnippetsForReportDate matches it.
  const description = `Out-of-scope work from daily report ${when}.`;

  // Provisional: the server keeps it when free and moves a collider (#77/#141).
  const nextNumber = nextChangeOrderNumber(existingCOs);

  // Contract value: estimate grandTotal + sum of existing approved COs.
  const baseContractValue = (project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0);
  const approvedCOsTotal = existingCOs
    .filter(c => c.status === 'approved')
    .reduce((s, c) => s + (c.changeAmount ?? 0), 0);
  const originalContractValue = baseContractValue + approvedCOsTotal;

  // One line per flagged item. A priced item goes on at its learned-cost
  // estimate, marked 'ai_estimated' until he confirms it; an unpriced one is a
  // $0 line marked 'needs_price'. Whole cents where it is computed.
  const lineItems: ChangeOrderLineItem[] = [
    ...pricedItems.map(it => {
      const price = centsOf(it.estimatedPrice ?? 0);
      return {
        id: generateUUID(), name: lineName(it.description), description: '',
        quantity: 1, unit: 'ls', unitPrice: price, total: price, isNew: true,
        priceSource: 'ai_estimated' as const,
      };
    }),
    ...unpricedItems.map(it => ({
      id: generateUUID(), name: lineName(it.description), description: '',
      quantity: 1, unit: 'ls', unitPrice: 0, total: 0, isNew: true,
      priceSource: 'needs_price' as const,
    })),
  ];
  const changeAmount = centsOf(lineItems.reduce((s, l) => s + l.total, 0));
  const newContractTotal = centsOf(originalContractValue + changeAmount);

  const co: ChangeOrder = {
    id: generateUUID(),
    number: nextNumber,
    projectId: project.id,
    date: nowISO,
    description,
    reason: 'out_of_scope',
    lineItems,
    originalContractValue,
    changeAmount,
    newContractTotal,
    status: 'draft' as ChangeOrderStatus,
    // DEDUPE MARKER: survives cache wipes (synced column).
    auditTrail: [
      {
        id: generateUUID(),
        action: AUTO_DRAFT_ACTION,
        actor: 'MAGE',
        timestamp: new Date().toISOString(),
        detail: report.id,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  return co;
}
