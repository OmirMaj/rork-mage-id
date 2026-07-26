// utils/brain/leakCoDraft.ts
//
// Pure Leak→Draft-CO builder. No React, no network, no storage.
// Sibling of the manual handleDraftLeakCO in app/daily-report.tsx — uses
// the EXACT same description format (daily-report.tsx:667-708) so auto-
// drafted COs are indistinguishable in content from manual ones.
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
  ChangeOrder, ChangeOrderStatus, DailyFieldReport, Project,
} from '@/types';
import { generateUUID } from '@/utils/generateId';

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
 *  5. No existing CO for the project references this report's date in its
 *     description via the handleDraftLeakCO date format — guards against
 *     double-drafting when the user manually drafted first.
 *  6. No existing CO for the project already carries the AUTO_DRAFT_ACTION
 *     marker with detail === report.id (already auto-drafted in a prior session).
 */
export function collectDraftableLeaks(opts: {
  dailyReports: DailyFieldReport[];
  projects: Project[];
  changeOrders: ChangeOrder[];
  processedReportIds: Set<string>;
  now?: Date;
}): DraftCandidate[] {
  const { dailyReports, projects, changeOrders, processedReportIds } = opts;
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

    const projectCOs = cosByProject.get(project.id) ?? [];

    // 6. Already auto-drafted in a prior session (auditTrail marker with detail = reportId).
    const alreadyAutoMarked = projectCOs.some(
      co => (co.auditTrail ?? []).some(
        e => e.action === AUTO_DRAFT_ACTION && e.detail === report.id,
      ),
    );
    if (alreadyAutoMarked) continue;

    // 5. Manual draft guard: skip if any CO on the project references this
    //    report date in its description using the handleDraftLeakCO date string.
    const when = formatDateForDescription(reportDate);
    const descSnippet = `from daily report ${when}`;
    const manualDraftExists = projectCOs.some(
      co => co.description?.includes(descSnippet),
    );
    if (manualDraftExists) continue;

    candidates.push({ report, project });
  }

  return candidates;
}

// ─── CO builder ───────────────────────────────────────────────────────────────

/** Format a YYYY-MM-DD date as "Jul 26" — matches handleDraftLeakCO's format. */
function formatDateForDescription(dateISO: string): string {
  const [, month, day] = dateISO.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[(month ?? 1) - 1]} ${day}`;
}

/**
 * Build a draft ChangeOrder from a DraftCandidate.
 *
 * Description format is identical to handleDraftLeakCO (daily-report.tsx:667-708):
 * "Out-of-scope work from daily report <date>: <priced lines>; <NEEDS PRICE: lines>"
 *
 * CO number = max(existing) + 1 (same rule as change-order.tsx:113-118).
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
  const totalPriced = pricedItems.reduce((s, it) => s + (it.estimatedPrice ?? 0), 0);

  const when = formatDateForDescription(report.date?.slice(0, 10) ?? '');

  const pricedLines = pricedItems.map(it =>
    `${it.description} (~$${(it.estimatedPrice ?? 0).toLocaleString('en-US')}${it.reportQuote ? ` — "${it.reportQuote}"` : ''})`,
  );
  const unpricedLines = unpricedItems.map(it =>
    `NEEDS PRICE: ${it.description}${it.reportQuote ? ` ("${it.reportQuote}")` : ''}`,
  );

  const description = `Out-of-scope work from daily report ${when}: ` +
    [...pricedLines, ...unpricedLines].join('; ');

  // CO number: max(existing) + 1 (same logic as change-order.tsx:113-118).
  const nextNumber = existingCOs.reduce((max, c) => Math.max(max, c.number || 0), 0) + 1;

  // Contract value: estimate grandTotal + sum of existing approved COs.
  const baseContractValue = (project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0);
  const approvedCOsTotal = existingCOs
    .filter(c => c.status === 'approved')
    .reduce((s, c) => s + (c.changeAmount ?? 0), 0);
  const originalContractValue = baseContractValue + approvedCOsTotal;
  const newContractTotal = originalContractValue + totalPriced;

  // Single consolidated line item matching the priced total.
  const lineItem = {
    id: generateUUID(),
    name: 'Out-of-scope work',
    description,
    quantity: 1,
    unit: 'ls',
    unitPrice: totalPriced,
    total: totalPriced,
    isNew: true,
  };

  const co: ChangeOrder = {
    id: generateUUID(),
    number: nextNumber,
    projectId: project.id,
    date: nowISO,
    description,
    reason: 'out_of_scope',
    lineItems: [lineItem],
    originalContractValue,
    changeAmount: totalPriced,
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
