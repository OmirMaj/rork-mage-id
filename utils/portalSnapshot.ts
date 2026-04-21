// Portal snapshot builder
//
// Takes a project + its portal settings and produces a compact JSON payload
// honoring the GC's visibility toggles. The payload is base64url-encoded and
// stuffed into the URL hash fragment of the shareable portal link, so the
// HTML page at mageid.app/portal/<id>#d=<base64> can decode and render it
// without any backend round-trip. The hash never leaves the client's browser,
// so the snapshot stays private between GC and whoever has the link.

import type {
  Project, AppSettings, ClientPortalSettings, Invoice, ChangeOrder,
  DailyFieldReport, PunchItem, ProjectPhoto, RFI, ClientPortalInvite,
} from '@/types';

export const PORTAL_SNAPSHOT_VERSION = 1;

export interface PortalSnapshot {
  v: number;
  snapshotAt: string;
  requirePasscode?: boolean;
  passcode?: string;
  welcomeMessage?: string;
  clientName?: string;
  company: {
    name: string;
    primaryColor?: string;
  };
  project: {
    id: string;
    name: string;
    type?: string;
    address?: string;
    status?: string;
  };
  sections: {
    schedule?: { tasks: Array<{
      id: string; title: string; phase?: string; progress: number;
      status: string; durationDays: number; isMilestone?: boolean; isCriticalPath?: boolean;
    }> };
    budget?: {
      contractValue: number; paidToDate: number; outstanding: number;
      pctComplete: number; nextMilestone?: string;
    };
    invoices?: Array<{
      id: string; number: number | string; total: number; status: string;
      dueDate?: string; dateSubmitted?: string;
      // Remaining balance for the invoice (totalDue - amountPaid). Portal uses
      // this to decide whether to show a "Pay Now" button and for how much.
      balance?: number;
      // If the GC has generated a Stripe payment link for this invoice, the
      // portal surfaces a one-tap "Pay Now" button that opens it.
      payLinkUrl?: string;
    }>;
    changeOrders?: Array<{
      id: string; number: number | string; description: string;
      changeAmount: number; status: string; dateSubmitted?: string;
    }>;
    photos?: Array<{ url: string; caption?: string; timestamp?: string }>;
    dailyReports?: Array<{
      id: string; date: string; weather?: string;
      totalManpower?: number; totalManHours?: number;
      workPerformed?: string;
    }>;
    punchList?: Array<{
      id: string; title: string; status: string;
      priority?: string; location?: string;
    }>;
    rfis?: Array<{
      id: string; number: number | string; subject: string;
      status: string; dateSubmitted?: string;
    }>;
    documents?: Array<{ name: string; type?: string; dateSent?: string }>;
  };
}

interface BuildOpts {
  project: Project;
  portal: ClientPortalSettings;
  settings?: AppSettings;
  invoices?: Invoice[];
  changeOrders?: ChangeOrder[];
  dailyReports?: DailyFieldReport[];
  punchItems?: PunchItem[];
  photos?: ProjectPhoto[];
  rfis?: RFI[];
  invite?: ClientPortalInvite;
  maxPhotos?: number;       // cap to keep URL manageable (default 24)
  maxDailyReports?: number; // default 10
}

export function buildPortalSnapshot(opts: BuildOpts): PortalSnapshot {
  const {
    project, portal, settings, invoices = [], changeOrders = [],
    dailyReports = [], punchItems = [], photos = [], rfis = [], invite,
    maxPhotos = 24, maxDailyReports = 10,
  } = opts;

  const sections: PortalSnapshot['sections'] = {};

  // Schedule
  if (portal.showSchedule && project.schedule?.tasks?.length) {
    sections.schedule = {
      tasks: project.schedule.tasks.map(t => ({
        id: t.id,
        title: t.title,
        phase: t.phase,
        progress: t.progress ?? 0,
        status: t.status,
        durationDays: t.durationDays ?? 0,
        isMilestone: t.isMilestone,
        isCriticalPath: t.isCriticalPath,
      })),
    };
  }

  // Budget summary — derived from project estimate + approved COs + invoices
  if (portal.showBudgetSummary) {
    const baseContract = project.estimate?.grandTotal ?? 0;
    const coTotal = changeOrders
      .filter(c => c.status === 'approved')
      .reduce((sum, c) => sum + (c.changeAmount ?? 0), 0);
    const contractValue = baseContract + coTotal;
    const paidToDate = invoices.reduce(
      (sum, i) => sum + (i.amountPaid ?? 0),
      0,
    );
    const outstanding = Math.max(0, contractValue - paidToDate);
    const pctComplete = contractValue > 0
      ? Math.round((paidToDate / contractValue) * 100)
      : 0;
    sections.budget = {
      contractValue,
      paidToDate,
      outstanding,
      pctComplete,
    };
  }

  // Invoices
  if (portal.showInvoices && invoices.length) {
    sections.invoices = invoices.map(i => {
      const total = i.totalDue ?? 0;
      const balance = Math.max(0, total - (i.amountPaid ?? 0));
      return {
        id: i.id,
        number: i.number,
        total,
        status: i.status,
        dueDate: i.dueDate,
        dateSubmitted: i.issueDate,
        balance,
        payLinkUrl: i.payLinkUrl,
      };
    });
  }

  // Change Orders
  if (portal.showChangeOrders && changeOrders.length) {
    sections.changeOrders = changeOrders.map(c => ({
      id: c.id,
      number: c.number,
      description: c.description ?? c.reason ?? '',
      changeAmount: c.changeAmount ?? 0,
      status: c.status,
      dateSubmitted: c.date,
    }));
  }

  // Photos (limit to prevent URL bloat — newest first)
  if (portal.showPhotos && photos.length) {
    const sorted = [...photos].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
    sections.photos = sorted.slice(0, maxPhotos).map(p => ({
      url: p.uri ?? '',
      caption: p.tag ?? p.location,
      timestamp: p.timestamp,
    })).filter(p => p.url);
  }

  // Daily Reports (limit — most recent first)
  if (portal.showDailyReports && dailyReports.length) {
    const sorted = [...dailyReports].sort((a, b) => {
      const ta = a.date ? new Date(a.date).getTime() : 0;
      const tb = b.date ? new Date(b.date).getTime() : 0;
      return tb - ta;
    });
    sections.dailyReports = sorted.slice(0, maxDailyReports).map(d => {
      const totalManHours = (d.manpower ?? []).reduce(
        (s, m) => s + ((m.hoursWorked ?? 0) * (m.headcount ?? 1)),
        0,
      );
      const totalManpower = (d.manpower ?? []).reduce(
        (s, m) => s + (m.headcount ?? 0),
        0,
      );
      const weather = d.weather
        ? `${d.weather.conditions ?? ''} ${d.weather.temperature ?? ''}`.trim() || undefined
        : undefined;
      return {
        id: d.id,
        date: d.date,
        weather,
        totalManpower,
        totalManHours,
        workPerformed: d.workPerformed,
      };
    });
  }

  // Punch List (only open / in-progress items are useful to clients)
  if (portal.showPunchList && punchItems.length) {
    sections.punchList = punchItems.map(p => ({
      id: p.id,
      title: p.description,
      status: p.status,
      priority: p.priority,
      location: p.location,
    }));
  }

  // RFIs
  if (portal.showRFIs && rfis.length) {
    sections.rfis = rfis.map(r => ({
      id: r.id,
      number: r.number,
      subject: r.subject ?? r.question ?? '',
      status: r.status,
      dateSubmitted: r.dateSubmitted,
    }));
  }

  // Documents — stub for now; wire up when documents model is finalized
  if (portal.showDocuments) {
    sections.documents = [];
  }

  return {
    v: PORTAL_SNAPSHOT_VERSION,
    snapshotAt: new Date().toISOString(),
    requirePasscode: portal.requirePasscode,
    passcode: portal.requirePasscode ? portal.passcode : undefined,
    welcomeMessage: portal.welcomeMessage,
    clientName: invite?.name,
    company: {
      name: settings?.branding?.companyName ?? 'MAGE ID',
      primaryColor: settings?.themeColors?.primary,
    },
    project: {
      id: project.id,
      name: project.name,
      type: project.type,
      address: project.location,
      status: project.status,
    },
    sections,
  };
}

// Base64-url encode a UTF-8 JSON string safely across web + RN Hermes.
function encodeBase64Url(input: string): string {
  // btoa needs Latin-1; encode via URI escape trick so non-ASCII survives.
  const b64 = typeof btoa !== 'undefined'
    ? btoa(unescape(encodeURIComponent(input)))
    : // RN fallback — Hermes supports btoa since 0.72 but be defensive
      globalThis.Buffer
        ? (globalThis as any).Buffer.from(input, 'utf-8').toString('base64')
        : '';
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function buildPortalUrl(
  baseUrl: string,
  portalId: string,
  snapshot: PortalSnapshot,
  inviteId?: string,
): string {
  const json = JSON.stringify(snapshot);
  const encoded = encodeBase64Url(json);
  const base = `${baseUrl}/${portalId}`;
  const query = inviteId ? `?inviteId=${encodeURIComponent(inviteId)}` : '';
  return `${base}${query}#d=${encoded}`;
}

// Rough sanity check — URL fragments over ~8KB start to make SMS clients unhappy.
// Return size in KB of the encoded payload to let the UI show a warning.
export function estimateSnapshotSizeKb(snapshot: PortalSnapshot): number {
  const json = JSON.stringify(snapshot);
  return Math.ceil(new Blob([json]).size / 1024);
}
