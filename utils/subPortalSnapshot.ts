// Sub-portal snapshot builder — the same base64url-in-URL-hash pattern as
// the client portal. The static page at mageid.app/sub-portal/<id> decodes
// it to render the sub's commitments + payment history, and to
// pre-configure the Supabase REST endpoint for invoice submissions.

import type {
  Project, AppSettings, Subcontractor, Commitment,
  Invoice, SubPortalLink, SubSubmittedInvoice,
  PunchItem, ProjectSchedule,
} from '@/types';

// v2 adds (Wave 5):
// - punchItems: open + in-progress punch items assigned to this sub
//   (filtered by assignedSubId or by trade-name match). The sub's
//   #1 question — "what's left for me to fix?" — answered without
//   them having to call the GC.
// - scheduleSlice: schedule tasks where assignedSubId matches OR
//   the task's `crew` field contains the sub's trade. Lets the sub
//   see when they're scheduled to be on site.
export const SUB_PORTAL_SNAPSHOT_VERSION = 2;

export interface SubPortalSnapshot {
  v: number;
  snapshotAt: string;
  requirePasscode?: boolean;
  passcode?: string;
  welcomeMessage?: string;

  company: {
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
  };
  project: {
    id: string;
    name: string;
    address?: string;
    type?: string;
  };
  sub: {
    id: string;
    companyName: string;
    contactName?: string;
    trade?: string;
  };

  commitments: Array<{
    id: string;
    number: string;
    description: string;
    amount: number;          // signed amount
    changeAmount?: number;   // net CO change
    contractToDate: number;  // amount + changeAmount
    paidToDate: number;      // sum of approved/paid sub invoices
    balance: number;         // contractToDate - paidToDate
    status: string;
    signedDate?: string;
    phase?: string;
  }>;

  // Sub-submitted billing history (most recent first), so the sub sees
  // what they've already filed and the GC's review state.
  submittedInvoices: Array<{
    id: string;
    invoiceNumber: string;
    amount: number;
    retentionAmount?: number;
    status: 'submitted' | 'approved' | 'rejected' | 'paid';
    createdAt: string;
    reviewedAt?: string;
    paidAt?: string;
    notesFromGc?: string;
  }>;

  // v2: open + in-progress punch items assigned to this sub. Helps
  // the sub answer "what's still on my list?" without calling the GC.
  punchItems?: Array<{
    id: string;
    description: string;
    location?: string;
    priority?: string;
    status: string;
    dueDate?: string;
    photoUri?: string;
  }>;

  // v2: schedule tasks where this sub is assigned (or their trade
  // matches the task's crew). Includes the parent project's schedule
  // start date so the portal can render real calendar dates.
  scheduleSlice?: {
    projectStartDate?: string;
    tasks: Array<{
      id: string;
      title: string;
      phase?: string;
      progress: number;
      status: string;
      durationDays: number;
      startDay: number;
      isMilestone?: boolean;
    }>;
  };

  submitInvoice: {
    subPortalId: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    contactEmail?: string;
    contactName?: string;
  };
}

interface BuildOpts {
  link: SubPortalLink;
  project: Project;
  sub: Subcontractor;
  settings?: AppSettings;
  commitments: Commitment[];
  // Owner-facing invoices that touched these commitments — used to compute
  // "paid to date" against each commitment if the GC hasn't approved
  // sub-submitted invoices yet. (Not always available; falls back to
  // sub-submitted invoices status='paid' when not provided.)
  invoices?: Invoice[];
  submittedInvoices?: SubSubmittedInvoice[];
  // v2: punch items + schedule for this sub.
  punchItems?: PunchItem[];
  schedule?: ProjectSchedule | null;

  supabaseUrl?: string;
  supabaseAnonKey?: string;
  contactEmail?: string;
  contactName?: string;
}

export function buildSubPortalSnapshot(opts: BuildOpts): SubPortalSnapshot {
  const {
    link, project, sub, settings, commitments,
    submittedInvoices = [],
    punchItems = [], schedule,
    supabaseUrl, supabaseAnonKey, contactEmail, contactName,
  } = opts;

  // Filter commitments to this sub on this project, optionally further
  // filtered by link.commitmentIds if the GC scoped the portal.
  const scopedIds = link.commitmentIds && link.commitmentIds.length
    ? new Set(link.commitmentIds)
    : null;
  const subCommitments = commitments.filter(c =>
    c.subcontractorId === sub.id
    && c.projectId === project.id
    && (!scopedIds || scopedIds.has(c.id)),
  );

  // Per-commitment paid-to-date: prefer explicit paid sub invoices.
  // (`Invoice` here is owner billing, not directly comparable.)
  const paidByCommitment = new Map<string, number>();
  for (const inv of submittedInvoices) {
    if (!inv.commitmentId) continue;
    if (inv.status !== 'paid') continue;
    paidByCommitment.set(
      inv.commitmentId,
      (paidByCommitment.get(inv.commitmentId) ?? 0) + (inv.amount ?? 0),
    );
  }

  return {
    v: SUB_PORTAL_SNAPSHOT_VERSION,
    snapshotAt: new Date().toISOString(),
    requirePasscode: link.requirePasscode,
    passcode: link.requirePasscode ? link.passcode : undefined,
    welcomeMessage: link.welcomeMessage,

    company: {
      name: settings?.branding?.companyName ?? 'MAGE ID',
      contactName: settings?.branding?.contactName,
      email: settings?.branding?.email,
      phone: settings?.branding?.phone,
    },
    project: {
      id: project.id,
      name: project.name,
      address: project.location,
      type: project.type,
    },
    sub: {
      id: sub.id,
      companyName: sub.companyName,
      contactName: sub.contactName,
      trade: sub.trade,
    },

    commitments: subCommitments.map(c => {
      const contractToDate = c.amount + (c.changeAmount ?? 0);
      const paidToDate = paidByCommitment.get(c.id) ?? 0;
      const balance = Math.max(0, contractToDate - paidToDate);
      return {
        id: c.id,
        number: c.number,
        description: c.description,
        amount: c.amount,
        changeAmount: c.changeAmount,
        contractToDate,
        paidToDate,
        balance,
        status: c.status,
        signedDate: c.signedDate,
        phase: c.phase,
      };
    }),

    submittedInvoices: submittedInvoices.slice(0, 20).map(i => ({
      id: i.id,
      invoiceNumber: i.invoiceNumber,
      amount: i.amount,
      retentionAmount: i.retentionAmount,
      status: i.status,
      createdAt: i.createdAt,
      reviewedAt: i.reviewedAt,
      paidAt: i.paidAt,
      notesFromGc: i.notesFromGc,
    })),

    // v2: scoped punch list — anything assigned to this sub, OR
    // matching their company name (legacy free-text). Filter to open /
    // in-progress only; the sub doesn't need to scroll past completed.
    punchItems: (() => {
      const tradeNorm = (sub.companyName ?? '').trim().toLowerCase();
      const scoped = punchItems
        .filter(p => p.projectId === project.id)
        .filter(p => {
          if (p.assignedSubId && p.assignedSubId === sub.id) return true;
          if (tradeNorm && (p.assignedSub ?? '').trim().toLowerCase() === tradeNorm) return true;
          return false;
        })
        .filter(p => p.status !== 'closed')
        .slice(0, 30);
      if (!scoped.length) return undefined;
      return scoped.map(p => ({
        id: p.id,
        description: p.description,
        location: p.location || undefined,
        priority: p.priority,
        status: p.status,
        dueDate: p.dueDate || undefined,
        photoUri: p.photoUri,
      }));
    })(),

    // v2: schedule slice — tasks where assignedSubId matches OR the
    // task's `crew` text contains the sub's trade. Cap at 40 tasks
    // chronologically so the snapshot stays compact.
    scheduleSlice: (() => {
      if (!schedule || !schedule.tasks?.length) return undefined;
      const tradeNorm = (sub.trade ?? '').trim().toLowerCase();
      const scoped = schedule.tasks.filter(t => {
        if (t.assignedSubId && t.assignedSubId === sub.id) return true;
        if (tradeNorm && (t.crew ?? '').trim().toLowerCase().includes(tradeNorm)) return true;
        return false;
      });
      if (!scoped.length) return undefined;
      const ordered = [...scoped].sort((a, b) => a.startDay - b.startDay).slice(0, 40);
      return {
        projectStartDate: schedule.startDate,
        tasks: ordered.map(t => ({
          id: t.id,
          title: t.title,
          phase: t.phase,
          progress: t.progress ?? 0,
          status: t.status,
          durationDays: t.durationDays ?? 0,
          startDay: t.startDay ?? 0,
          isMilestone: t.isMilestone,
        })),
      };
    })(),

    submitInvoice: {
      subPortalId: link.id,
      supabaseUrl,
      supabaseAnonKey,
      contactEmail: contactEmail ?? settings?.branding?.email,
      contactName: contactName
        ?? settings?.branding?.contactName
        ?? settings?.branding?.companyName,
    },
  };
}

function encodeBase64Url(input: string): string {
  const b64 = typeof btoa !== 'undefined'
    ? btoa(unescape(encodeURIComponent(input)))
    : globalThis.Buffer
      ? (globalThis as any).Buffer.from(input, 'utf-8').toString('base64')
      : '';
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildSubPortalUrl(
  baseUrl: string,
  portalId: string,
  snapshot: SubPortalSnapshot,
): string {
  const json = JSON.stringify(snapshot);
  const encoded = encodeBase64Url(json);
  return `${baseUrl}/${portalId}#d=${encoded}`;
}
