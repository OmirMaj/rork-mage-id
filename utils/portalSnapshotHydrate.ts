// Rehydrates a PortalSnapshot back into the domain shapes app/client-view.tsx
// renders.
//
// WHY this exists: client-view resolves its project out of the local
// ProjectContext, which is only ever populated for the signed-in GC. A
// homeowner opening a share link has no session and therefore no projects, so
// the screen fell through to its "not found" branch every single time. The
// snapshot (URL hash, or the portal_snapshots row the GC's app publishes) is
// the ONLY data an anonymous visitor can have, so it has to be able to drive
// the same render tree.
//
// The snapshot is deliberately lossy — it is a client-safe projection built by
// utils/portalSnapshot.ts, stripped of cost, markup, margin, and supplier
// detail. Rehydrating therefore fills the un-carried domain fields with
// NEUTRAL values (empty string / empty array / zero), never invented ones. A
// field that the snapshot does not carry must read as "unknown" downstream,
// not as a plausible-looking number the homeowner could act on.

import type {
  Project, ClientPortalSettings, ChangeOrder, ChangeOrderStatus, Invoice,
  InvoiceStatus, DailyFieldReport, PunchItem, PunchItemPriority, PunchItemStatus,
  ProjectDocument, ProjectPhoto, ProjectType, PortalMessage, RFI, RFIStatus,
  ScheduleTask, TaskStatus,
} from '@/types';
import type { PortalSnapshot } from './portalSnapshot';

/** Everything client-view needs, in the shapes it already renders. */
export interface HydratedPortal {
  project: Project;
  portal: ClientPortalSettings;
  changeOrders: ChangeOrder[];
  invoices: Invoice[];
  dailyReports: DailyFieldReport[];
  punchItems: PunchItem[];
  photos: ProjectPhoto[];
  rfis: RFI[];
  documents: ProjectDocument[];
  messages: PortalMessage[];
}

/** Narrow an untrusted string onto a domain union, or fall back. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

const TASK_STATUSES: readonly TaskStatus[] = ['not_started', 'in_progress', 'on_hold', 'done'];
const CO_STATUSES: readonly ChangeOrderStatus[] = ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'revised', 'void'];
const INVOICE_STATUSES: readonly InvoiceStatus[] = ['draft', 'sent', 'partially_paid', 'paid', 'overdue'];
const PUNCH_STATUSES: readonly PunchItemStatus[] = ['open', 'in_progress', 'ready_for_review', 'closed'];
const PUNCH_PRIORITIES: readonly PunchItemPriority[] = ['low', 'medium', 'high'];
const RFI_STATUSES: readonly RFIStatus[] = ['open', 'answered', 'closed', 'void'];
const PROJECT_TYPES: readonly ProjectType[] = [
  'new_build', 'renovation', 'addition', 'remodel', 'commercial', 'landscape',
  'roofing', 'flooring', 'painting', 'plumbing', 'electrical', 'concrete',
];
const PROJECT_STATUSES = ['draft', 'estimated', 'in_progress', 'completed', 'closed'] as const;

/** Snapshot numbers are `number | string` on a few fields (legacy payloads). */
function toNumber(value: unknown, fallback = 0): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

export function hydratePortalSnapshot(
  snapshot: PortalSnapshot,
  portalId: string,
): HydratedPortal {
  const s = snapshot.sections ?? { };
  const projectId = snapshot.project?.id ?? `portal:${portalId}`;
  const snapshotAt = snapshot.snapshotAt ?? new Date().toISOString();

  const changeOrders: ChangeOrder[] = (s.changeOrders ?? []).map(co => ({
    id: co.id,
    number: toNumber(co.number),
    projectId,
    date: co.dateSubmitted ?? '',
    description: co.description ?? '',
    reason: co.reason ?? '',
    lineItems: [],
    // The snapshot carries the delta and the resulting total but never the
    // pre-change baseline, so derive it rather than leave a zero that would
    // render as "$0 original contract" in any future breakdown.
    originalContractValue: co.newContractTotal != null
      ? co.newContractTotal - toNumber(co.changeAmount)
      : 0,
    changeAmount: toNumber(co.changeAmount),
    newContractTotal: toNumber(co.newContractTotal),
    scheduleImpactDays: co.scheduleImpactDays,
    status: oneOf(co.status, CO_STATUSES, 'submitted'),
    createdAt: co.dateSubmitted ?? snapshotAt,
    updatedAt: co.dateSubmitted ?? snapshotAt,
  }));

  const invoices: Invoice[] = (s.invoices ?? []).map(inv => {
    const total = toNumber(inv.total);
    // `balance` is authoritative when present (the builder computes it as
    // totalDue - amountPaid); amountPaid is only carried on v2+ payloads.
    const amountPaid = inv.amountPaid != null
      ? toNumber(inv.amountPaid)
      : Math.max(0, total - toNumber(inv.balance, total));
    return {
      id: inv.id,
      number: toNumber(inv.number),
      projectId,
      type: 'progress' as const,
      issueDate: inv.issueDate ?? inv.dateSubmitted ?? '',
      dueDate: inv.dueDate ?? '',
      paymentTerms: 'net_30' as const,
      notes: inv.notes ?? '',
      lineItems: (inv.lineItems ?? []).map((li, i) => ({
        id: `${inv.id}-li-${i}`,
        name: li.name,
        description: li.description ?? '',
        quantity: toNumber(li.quantity),
        unit: li.unit ?? '',
        unitPrice: toNumber(li.unitPrice),
        total: toNumber(li.total),
      })),
      subtotal: toNumber(inv.subtotal, total),
      taxRate: 0,
      taxAmount: toNumber(inv.taxAmount),
      totalDue: total,
      amountPaid,
      status: oneOf(inv.status, INVOICE_STATUSES, 'sent'),
      payments: [],
      retentionPercent: inv.retentionPercent,
      retentionAmount: inv.retentionAmount,
      payLinkUrl: inv.payLinkUrl,
      createdAt: inv.issueDate ?? snapshotAt,
      updatedAt: snapshotAt,
    };
  });

  const dailyReports: DailyFieldReport[] = (s.dailyReports ?? []).map(d => ({
    id: d.id,
    projectId,
    date: d.date,
    // The snapshot flattens conditions + temperature into one display string
    // (there is no structured weather in the payload). Keep it in `conditions`
    // and leave `temperature` empty rather than splitting on a guess.
    weather: { temperature: '', conditions: d.weather ?? '', wind: '', isManual: false },
    manpower: [],
    workPerformed: d.workPerformed ?? '',
    materialsDelivered: [],
    issuesAndDelays: '',
    photos: [],
    status: 'sent' as const,
    createdAt: d.date,
    updatedAt: d.date,
  }));

  const punchItems: PunchItem[] = (s.punchList ?? []).map(p => ({
    id: p.id,
    projectId,
    description: p.title ?? '',
    location: p.location ?? '',
    // Never carried into the snapshot — who is on the hook internally is not
    // the homeowner's business. Blank, and the row hides the field.
    assignedSub: '',
    dueDate: '',
    priority: oneOf(p.priority, PUNCH_PRIORITIES, 'medium'),
    status: oneOf(p.status, PUNCH_STATUSES, 'open'),
    createdAt: snapshotAt,
    updatedAt: snapshotAt,
  }));

  const photos: ProjectPhoto[] = (s.photos ?? []).map((p, i) => ({
    // Snapshot photos are anonymous (url + caption only), so mint a stable
    // index-based key. Stable within one snapshot, which is all React needs.
    id: `${portalId}-photo-${i}`,
    projectId,
    uri: p.url,
    timestamp: p.timestamp ?? snapshotAt,
    tag: p.caption,
    markup: (p.markup ?? []).map((m, mi) => ({ id: `${portalId}-photo-${i}-m-${mi}`, ...m })),
    createdAt: p.timestamp ?? snapshotAt,
  }));

  const rfis: RFI[] = (s.rfis ?? []).map(r => ({
    id: r.id,
    projectId,
    number: toNumber(r.number),
    subject: r.subject ?? '',
    question: '',
    submittedBy: '',
    assignedTo: '',
    dateSubmitted: r.dateSubmitted ?? '',
    // No response deadline in the payload; empty so the row omits the due line
    // instead of formatting an Invalid Date.
    dateRequired: '',
    status: oneOf(r.status, RFI_STATUSES, 'open'),
    priority: 'normal' as const,
    attachments: [],
    createdAt: r.dateSubmitted ?? snapshotAt,
    updatedAt: snapshotAt,
  }));

  const projectName = snapshot.project?.name ?? 'Your project';

  const documents: ProjectDocument[] = (s.documents ?? []).map((d, i) => ({
    id: `${portalId}-doc-${i}`,
    projectId,
    projectName,
    // The snapshot's `type` is a free-text label, not the DocumentType union,
    // and it carries no file URL — so these render as "not available yet"
    // placeholders that tell the homeowner the document exists.
    type: 'other' as const,
    title: d.name,
    status: 'signed' as const,
    createdAt: d.dateSent ?? snapshotAt,
  }));

  const messages: PortalMessage[] = (snapshot.messages ?? []).map(m => ({
    id: m.id,
    projectId,
    portalId,
    authorType: m.authorType,
    authorName: m.authorName ?? '',
    body: m.body,
    createdAt: m.createdAt,
    readByGc: true,
    readByClient: true,
  }));

  const tasks: ScheduleTask[] = (s.schedule?.tasks ?? []).map(t => ({
    id: t.id,
    title: t.title,
    phase: t.phase ?? '',
    durationDays: toNumber(t.durationDays),
    startDay: toNumber(t.startDay, 1),
    progress: toNumber(t.progress),
    crew: '',
    dependencies: [],
    notes: '',
    status: oneOf(t.status, TASK_STATUSES, 'not_started'),
    isMilestone: t.isMilestone,
    isCriticalPath: t.isCriticalPath,
  }));

  // `sections.budget.contractValue` is ALREADY the revised contract (base +
  // approved COs) — see buildPortalSnapshot. client-view re-adds the approved
  // CO total itself, so back the base out here or every portal would show the
  // change orders twice.
  const approvedCoTotal = changeOrders
    .filter(c => c.status === 'approved')
    .reduce((sum, c) => sum + c.changeAmount, 0);
  const baseContract = s.budget ? toNumber(s.budget.contractValue) - approvedCoTotal : 0;

  const project: Project = {
    id: projectId,
    name: projectName,
    type: oneOf(snapshot.project?.type, PROJECT_TYPES, 'renovation'),
    location: snapshot.project?.address ?? '',
    squareFootage: 0,
    quality: 'standard',
    description: '',
    createdAt: snapshotAt,
    updatedAt: snapshotAt,
    estimate: null,
    // client-view reads the contract value through effectiveEstimateTotal,
    // which prefers linkedEstimate.grandTotal. This is the only field of the
    // estimate the homeowner is ever allowed to see — no items, no markup.
    linkedEstimate: baseContract > 0
      ? {
          id: `${portalId}-estimate`,
          items: [],
          globalMarkup: 0,
          baseTotal: baseContract,
          markupTotal: 0,
          grandTotal: baseContract,
          createdAt: snapshotAt,
        }
      : null,
    schedule: s.schedule
      ? {
          id: `${portalId}-schedule`,
          name: projectName,
          projectId,
          startDate: s.schedule.startDate,
          workingDaysPerWeek: toNumber(s.schedule.workingDaysPerWeek, 5),
          bufferDays: 0,
          tasks,
          totalDurationDays: toNumber(s.schedule.totalDurationDays),
          criticalPathDays: 0,
          laborAlignmentScore: 0,
          // healthScore is deliberately absent — the snapshot never carried it,
          // and defaulting to 0 would paint a red "0% schedule health" bar on a
          // perfectly healthy job. Absent means the row is hidden.
          riskItems: [],
          updatedAt: snapshotAt,
        }
      : null,
    status: oneOf(snapshot.project?.status, PROJECT_STATUSES, 'in_progress'),
    // The snapshot drops `setAt` (the portal never renders it). Stamp it with
    // the publish time rather than a fabricated one — it is the latest moment
    // the budget is known to have held.
    targetBudget: snapshot.project?.targetBudget
      ? { ...snapshot.project.targetBudget, setAt: snapshotAt }
      : undefined,
  };

  // The GC's visibility toggles are not serialized directly; the builder simply
  // omits any section the GC switched off. So section presence IS the toggle.
  const portal: ClientPortalSettings = {
    enabled: true,
    portalId,
    // NOTE: `passcode` is intentionally never in the snapshot (it would be
    // readable by anyone holding the link). `requirePasscode` still is, and
    // client-view treats snapshot-sourced portals as gated on that flag alone —
    // validation happens server-side in the validate-portal-passcode function.
    requirePasscode: snapshot.requirePasscode,
    showSchedule: !!s.schedule,
    showChangeOrders: !!s.changeOrders,
    showInvoices: !!s.invoices,
    showPhotos: !!s.photos,
    showBudgetSummary: !!s.budget,
    showDailyReports: !!s.dailyReports,
    showPunchList: !!s.punchList,
    showRFIs: !!s.rfis,
    showDocuments: !!s.documents,
    welcomeMessage: snapshot.welcomeMessage,
    coApprovalEnabled: snapshot.coApprovalEnabled,
  };

  return { project, portal, changeOrders, invoices, dailyReports, punchItems, photos, rfis, documents, messages };
}
