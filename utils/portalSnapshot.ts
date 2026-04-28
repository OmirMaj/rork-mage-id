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
  SavedAIAPayApp,
} from '@/types';

// v6 adds (Wave 4):
// - latestUpdate: the most-recently-published homeowner summary (AI-
//   generated from the daily report). Shows up in the portal as the
//   "Latest update" panel above everything else — the homeowner's
//   single-glance "what happened on my project today" surface.
//
// v5 added (Wave 3):
// - closeout binder block: notes, finishes (chosen selections), warranty
//   roster, maintenance schedule, trade contacts, emergency contact info.
//   Renders only when GC has finalized or sent the binder.
// - photos[].markup: SVG-friendly normalized-coordinate annotations
//   (arrow/circle/freehand/text) so the portal can overlay GC markup
//   directly on the original image.
//
// v4 added:
// - portalApi (supabaseUrl + supabaseAnonKey + portalId + inviteId) shared
//   across all client→GC writes (budget, messages, CO approvals).
// - messages: recent thread loaded into the portal hero.
// - coApprovalEnabled flag — toggle 1-tap approval on COs.
//
// v3 added: clientCanSetBudget toggle, submitBudget config, project.targetBudget.
// v2 added: invoice.lineItems summary, aiaPayApps section, hero photo +
// schedule anchors.
export const PORTAL_SNAPSHOT_VERSION = 6;

export interface PortalSnapshot {
  v: number;
  snapshotAt: string;
  requirePasscode?: boolean;
  // NOTE: passcode is intentionally NOT serialized into the snapshot.
  // It used to live here, but base64 in the URL fragment is trivially
  // decodable by anyone with the link, defeating the gate. Validation now
  // runs server-side via the validate-portal-passcode edge function — the
  // static portal POSTs { portalId, passcode } and unlocks on 200.
  welcomeMessage?: string;
  clientName?: string;
  // Whether the portal should show the "Set your target budget" card.
  // Independent of `sections.budget` — that's the read-only snapshot of
  // committed numbers; this is a one-way write affordance for the client.
  clientCanSetBudget?: boolean;
  // Endpoint metadata so the static portal can POST a budget proposal
  // back to the GC. Both the Supabase route and the mailto fallback are
  // wired in; if Supabase POST fails for any reason the portal falls
  // back to opening the user's email client.
  submitBudget?: {
    portalId: string;
    inviteId?: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    contactEmail?: string;     // GC email — used as `mailto:` recipient
    contactName?: string;      // displayed in the portal CTA
  };
  // Generic config for any client→GC POST surface (messages, CO approvals).
  // Same API surface as submitBudget; bundled together so the portal can
  // call any endpoint with one config.
  portalApi?: {
    portalId: string;
    inviteId?: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    contactEmail?: string;
    contactName?: string;
  };
  // Whether the client can 1-tap approve/decline change orders from the
  // portal. When false the CO list is read-only.
  coApprovalEnabled?: boolean;
  // Active project contract (when status >= 'sent'). Lets the homeowner
  // review + counter-sign their construction agreement directly in the
  // static portal. Only the contract id + minimal metadata is bundled
  // here; the full contract row is fetched from Supabase via the
  // portalApi config (anon key + RLS gates the read).
  contract?: {
    id: string;
    status: 'sent' | 'signed';
    contractValue: number;
    title: string;
    needsSignature: boolean;   // true when GC has signed but homeowner hasn't
  };
  // The most-recently-published homeowner summary. Pulled from the
  // newest daily report whose `homeownerSummaryPublished === true` —
  // the GC has reviewed the AI draft and explicitly pushed it out.
  // Renders at the top of the portal as the "Latest update" hero.
  latestUpdate?: {
    dateLabel: string;        // "Friday, April 26"
    summary: string;          // 2-4 sentence narrative
    publishedAt: string;      // ISO timestamp of the parent DFR's updatedAt
  };
  // Closeout binder — only emitted when the GC has finalized or sent the
  // binder. The portal renders a printable view with all the long-tail
  // info homeowners come back to years later: chosen finishes (brand +
  // SKU + supplier), warranty roster, maintenance schedule, trade
  // contacts. A "Print / Save as PDF" button uses window.print() so they
  // can keep a local copy.
  closeout?: {
    id: string;
    status: 'finalized' | 'sent';
    completionDate?: string;
    noteFromContractor?: string;
    finishes: Array<{ category: string; productName: string; brand?: string; sku?: string; supplier?: string }>;
    warranties: Array<{ title: string; provider?: string; durationMonths?: number; endDate?: string }>;
    maintenance: Array<{ task: string; frequency: string; nextDate?: string; notes?: string }>;
    tradeContacts: Array<{ company: string; scope?: string; phase?: string; phone?: string; email?: string }>;
    emergencyEmail?: string;
    emergencyPhone?: string;
  };
  // AI-curated selections / allowances the homeowner picks. Flat list
  // because the portal renders a category card for each. Only categories
  // with options are bundled.
  selections?: Array<{
    id: string;
    category: string;
    styleBrief: string;
    budget: number;
    status: 'pending' | 'browsing' | 'chosen' | 'exceeded';
    options: Array<{
      id: string;
      productName: string;
      brand: string;
      description: string;
      unitPrice: number;
      unit: string;
      quantity: number;
      total: number;
      leadTimeDays?: number;
      supplier?: string;
      productUrl?: string;
      highlights: string[];
      isChosen: boolean;
    }>;
  }>;
  // Open-book / GMP cost transparency. When set, the portal renders a
  // dedicated "Open Book" section showing real budget vs committed vs
  // actual cost — a thing enterprise PM software can't really do for
  // residential GCs. Only emitted when the GC has set
  // project.contractMode to 'open_book' or 'gmp'.
  openBook?: {
    mode: 'gmp' | 'open_book';
    budget: number;          // total budget across all phases
    committed: number;       // signed commitments + POs
    actual: number;          // dollars actually paid out
    estimatedFinalCost: number;
    contractValue: number;   // revised contract (with approved COs)
    gmpCap?: number;         // when mode='gmp'
    feePercent?: number;
    feeAmount?: number;
    // Per-phase breakdown so the client can see WHERE the money goes.
    phases: Array<{
      name: string;
      budget: number;
      committed: number;
      actual: number;
      projectedFinal: number;
      variance: number;       // negative = over budget
    }>;
    asOf: string;             // ISO timestamp
  };
  // Recent message thread between GC and client (most recent last). Static
  // portal reloads to fetch new messages; for now we don't poll.
  messages?: Array<{
    id: string;
    authorType: 'client' | 'gc';
    authorName?: string;
    body: string;
    createdAt: string;
  }>;
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
    // v2: a hero image URL chosen automatically from the most recent project
    // photo. Lets the portal show the project visually instead of a flat
    // gradient.
    heroPhotoUrl?: string;
    // v2: optional schedule anchors. If we have a schedule we surface the
    // first task's start date and the last task's end date so the portal can
    // show "Started Mar 14 · Targeting Aug 22".
    startDate?: string;
    targetDate?: string;
    // v3: an agreed-on contract value when no estimate exists yet. Falls
    // through to the budget stat so clients see a number they can react to.
    targetBudget?: { amount: number; setBy: 'client' | 'gc'; note?: string };
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
      // v2 — populated when the snapshot is built to drive the invoice detail
      // drawer in the portal. Capped to a reasonable size (10 line items per
      // invoice; longer invoices are summarized).
      amountPaid?: number;
      issueDate?: string;
      lineItems?: Array<{
        name: string; description?: string;
        quantity: number; unit: string; unitPrice: number; total: number;
      }>;
      retentionPercent?: number;
      retentionAmount?: number;
      taxAmount?: number;
      subtotal?: number;
      paymentTerms?: string;
      notes?: string;
    }>;
    aiaPayApps?: Array<{
      id: string;
      applicationNumber: number;
      applicationDate?: string;
      periodTo?: string;
      ownerName?: string;
      architectName?: string;
      contractorName?: string;
      contractSumToDate: number;
      retainagePercent: number;
      lessPreviousCertificates: number;
      currentPaymentDue: number;
      totalCompletedAndStored: number;
      totalRetainage: number;
      totalEarnedLessRetainage: number;
      balanceToFinish: number;
      percentComplete: number;
      lines: Array<{
        itemNo: string; description: string;
        scheduledValue: number; fromPreviousApp: number;
        thisPeriod: number; materialsPresentlyStored: number;
        retainagePercent: number;
      }>;
    }>;
    changeOrders?: Array<{
      id: string; number: number | string; description: string;
      changeAmount: number; status: string; dateSubmitted?: string;
    }>;
    photos?: Array<{
      url: string;
      caption?: string;
      timestamp?: string;
      // Markup primitives drawn over the photo by the GC. Coords are
      // normalized 0..1 so the static portal can re-render them at any
      // display size. Only emitted when there's at least one annotation.
      markup?: Array<{
        type: 'arrow' | 'rectangle' | 'circle' | 'freehand' | 'text';
        color: 'red' | 'yellow' | 'green';
        points: Array<{ x: number; y: number }>;
        text?: string;
      }>;
    }>;
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
  aiaPayApps?: SavedAIAPayApp[];
  invite?: ClientPortalInvite;
  // Optional message thread (most recent first; we'll trim to ~20).
  messages?: Array<{
    id: string;
    authorType: 'client' | 'gc';
    authorName?: string;
    body: string;
    createdAt: string;
  }>;
  // Optional Supabase + GC contact info baked into the snapshot so the
  // static portal can post a budget proposal back to the GC. These are
  // safe to include (anon key is public, RLS gates access).
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  contactEmail?: string;
  contactName?: string;
  maxPhotos?: number;       // cap to keep URL manageable (default 24)
  maxDailyReports?: number; // default 10
  maxAIAPayApps?: number;   // default 6 (most recent first)
  maxInvoiceLines?: number; // default 10 lines per invoice
  maxMessages?: number;     // default 20
  // Optional commitments — required to compute the open-book / GMP
  // breakdown. When absent, the open-book section is omitted from the
  // snapshot even if project.contractMode is set.
  commitments?: import('@/types').Commitment[];
  // Active contract for this project. Pre-fetched by the GC's app and
  // bundled into the snapshot so the portal can show a "Sign contract"
  // card without requiring the homeowner to be authenticated.
  contract?: import('@/types').ProjectContract;
  // Selection categories + options to render in the portal.
  selections?: import('@/types').SelectionCategory[];
  // Active closeout binder for this project (finalized or sent only).
  // Bundled into the snapshot so the homeowner can pull the binder from
  // the portal years after handover.
  closeoutBinder?: import('./closeoutBinderEngine').CloseoutBinder;
  // Project warranties — used by the closeout block.
  warranties?: import('@/types').Warranty[];
}

export function buildPortalSnapshot(opts: BuildOpts): PortalSnapshot {
  const {
    project, portal, settings, invoices = [], changeOrders = [],
    dailyReports = [], punchItems = [], photos = [], rfis = [],
    aiaPayApps = [], invite, messages = [],
    supabaseUrl, supabaseAnonKey, contactEmail, contactName,
    maxPhotos = 24, maxDailyReports = 10, maxAIAPayApps = 6,
    maxInvoiceLines = 10, maxMessages = 20,
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

  // Budget summary — derived from project estimate + approved COs + invoices.
  // When no estimate exists yet but a targetBudget is set (typically from an
  // accepted client proposal), use that as the contract value baseline so
  // the portal still has a number to display.
  if (portal.showBudgetSummary) {
    const baseContract =
      project.estimate?.grandTotal
      ?? project.targetBudget?.amount
      ?? 0;
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

  // Invoices — v2 includes line items + payment terms so the portal can show
  // a real invoice detail drawer (clickable rows, "Pay Now" CTA, breakdown).
  if (portal.showInvoices && invoices.length) {
    sections.invoices = invoices.map(i => {
      const total = i.totalDue ?? 0;
      const amountPaid = i.amountPaid ?? 0;
      const balance = Math.max(0, total - amountPaid);
      const lineItems = (i.lineItems ?? []).slice(0, maxInvoiceLines).map(li => ({
        name: li.name ?? '',
        description: li.description || undefined,
        quantity: li.quantity ?? 0,
        unit: li.unit ?? '',
        unitPrice: li.unitPrice ?? 0,
        total: li.total ?? 0,
      }));
      return {
        id: i.id,
        number: i.number,
        total,
        status: i.status,
        dueDate: i.dueDate,
        dateSubmitted: i.issueDate,
        balance,
        payLinkUrl: i.payLinkUrl,
        amountPaid,
        issueDate: i.issueDate,
        lineItems,
        retentionPercent: i.retentionPercent,
        retentionAmount: i.retentionAmount,
        taxAmount: i.taxAmount,
        subtotal: i.subtotal,
        paymentTerms: i.paymentTerms,
        notes: i.notes || undefined,
      };
    });
  }

  // AIA G702/G703 pay applications — surfaced as a dedicated portal section
  // so the client/architect/lender can pull a printable PDF from the portal
  // without bouncing back through email.
  if (portal.showInvoices && aiaPayApps.length) {
    const sorted = [...aiaPayApps].sort((a, b) => b.applicationNumber - a.applicationNumber);
    sections.aiaPayApps = sorted.slice(0, maxAIAPayApps).map(a => ({
      id: a.id,
      applicationNumber: a.applicationNumber,
      applicationDate: a.applicationDate,
      periodTo: a.periodTo,
      ownerName: a.ownerName || undefined,
      architectName: a.architectName || undefined,
      contractorName: a.contractorName || undefined,
      contractSumToDate: a.contractSumToDate,
      retainagePercent: a.retainagePercent,
      lessPreviousCertificates: a.lessPreviousCertificates,
      currentPaymentDue: a.totals.currentPaymentDue,
      totalCompletedAndStored: a.totals.totalCompletedAndStored,
      totalRetainage: a.totals.totalRetainage,
      totalEarnedLessRetainage: a.totals.totalEarnedLessRetainage,
      balanceToFinish: a.totals.balanceToFinish,
      percentComplete: a.totals.percentComplete,
      lines: a.lines.map(l => ({
        itemNo: l.itemNo,
        description: l.description,
        scheduledValue: l.scheduledValue,
        fromPreviousApp: l.fromPreviousApp,
        thisPeriod: l.thisPeriod,
        materialsPresentlyStored: l.materialsPresentlyStored,
        retainagePercent: l.retainagePercent,
      })),
    }));
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
      markup: (p.markup ?? []).length > 0
        ? p.markup!.map(m => ({
            type: m.type,
            color: m.color,
            points: m.points,
            text: m.text,
          }))
        : undefined,
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

  // v2 hero meta — pick a hero photo (newest project photo we'll already
  // surface in the portal's photos section) and derive start / target dates
  // from the schedule if present.
  let heroPhotoUrl: string | undefined;
  if (portal.showPhotos && photos.length) {
    const sorted = [...photos].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
    heroPhotoUrl = sorted.find(p => !!p.uri)?.uri;
  }

  let startDate: string | undefined;
  let targetDate: string | undefined;
  const sched = project.schedule;
  if (sched?.startDate) {
    startDate = sched.startDate;
    if (sched.totalDurationDays != null && sched.totalDurationDays > 0) {
      const start = new Date(sched.startDate);
      if (!isNaN(start.getTime())) {
        const end = new Date(start.getTime() + sched.totalDurationDays * 86400000);
        targetDate = end.toISOString().slice(0, 10);
      }
    }
  }

  // Show the "set your budget" card only when (a) the GC has opted in
  // AND (b) there's no contract value to react to yet (no estimate, no
  // accepted target budget). If a targetBudget is already set the client
  // sees that number in the stats — they don't need to propose another.
  const noContractYet =
    !project.estimate?.grandTotal && !project.targetBudget?.amount;
  const clientCanSetBudget = !!portal.clientCanSetBudget && noContractYet;

  // Snapshot the targetBudget so the portal can show the number even when
  // no full estimate exists. Setting it via a client proposal always
  // populates this field (after the GC accepts).
  const projectTargetBudget = project.targetBudget
    ? {
        amount: project.targetBudget.amount,
        setBy: project.targetBudget.setBy,
        note: project.targetBudget.note,
      }
    : undefined;

  // Trim to most recent N — chronological order (oldest first) so the
  // portal renders the thread bottom-anchored.
  const trimmedMessages = [...messages]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-maxMessages);

  // Generic API config (Supabase URL + anon key + portal/invite ids).
  // Reused across messages, CO approvals, and budget proposals.
  const apiConfig = (supabaseUrl && supabaseAnonKey) ? {
    portalId: portal.portalId,
    inviteId: invite?.id,
    supabaseUrl,
    supabaseAnonKey,
    contactEmail: contactEmail ?? settings?.branding?.email,
    contactName: contactName
      ?? settings?.branding?.contactName
      ?? settings?.branding?.companyName,
  } : undefined;

  // Open-book / GMP breakdown. Only when the GC has explicitly opted the
  // project into transparent contract mode AND we have commitments to
  // compute against — otherwise we omit the section to avoid leaking a
  // half-built financial picture.
  const openBook: PortalSnapshot['openBook'] = (() => {
    const mode = project.contractMode;
    if (mode !== 'gmp' && mode !== 'open_book') return undefined;
    const commitments = opts.commitments;
    if (!commitments) return undefined;
    try {
      // Lazy import — pure function, no side effects.
      const { computeJobCost } = require('./jobCostEngine') as typeof import('./jobCostEngine');
      const job = computeJobCost({ project, commitments, invoices, changeOrders });
      const approvedCOs = changeOrders
        .filter(co => co.projectId === project.id && co.status === 'approved')
        .reduce((s, co) => s + co.changeAmount, 0);
      const contractValue = (project.linkedEstimate?.grandTotal ?? project.estimate?.grandTotal ?? 0) + approvedCOs;
      return {
        mode,
        budget: job.budget,
        committed: job.committed,
        actual: job.actual,
        estimatedFinalCost: job.projectedFinal,
        contractValue,
        gmpCap: project.gmpCap,
        feePercent: project.contractorFeePercent,
        feeAmount: project.contractorFeeAmount,
        phases: job.byPhase.map(p => ({
          name: p.phase,
          budget: p.budget,
          committed: p.committed,
          actual: p.actual,
          projectedFinal: p.projectedFinal,
          variance: p.variance,
        })),
        asOf: job.asOf,
      };
    } catch (err) {
      console.warn('[portalSnapshot] open-book compute failed', err);
      return undefined;
    }
  })();

  return {
    v: PORTAL_SNAPSHOT_VERSION,
    snapshotAt: new Date().toISOString(),
    requirePasscode: portal.requirePasscode,
    // passcode intentionally omitted — validated server-side, never bundled.
    welcomeMessage: portal.welcomeMessage,
    clientName: invite?.name,
    clientCanSetBudget,
    submitBudget: clientCanSetBudget ? apiConfig : undefined,
    portalApi: apiConfig,
    coApprovalEnabled: !!portal.coApprovalEnabled,
    openBook,
    // Latest published homeowner update — newest published summary
    // wins. Independent of `showDailyReports`: even GCs who don't show
    // the technical report still want to ship a friendly daily update.
    latestUpdate: (() => {
      const published = (dailyReports ?? [])
        .filter(d => d.homeownerSummaryPublished && d.homeownerSummary && d.homeownerSummary.trim())
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const top = published[0];
      if (!top) return undefined;
      const dateLabel = (() => {
        try { return new Date(top.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
        catch { return top.date; }
      })();
      return {
        dateLabel,
        summary: top.homeownerSummary!,
        publishedAt: top.updatedAt,
      };
    })(),
    // Closeout binder — only emit when GC has finalized or sent it.
    // Inlined into the snapshot so the homeowner can pull the binder
    // from the portal years after handover (e.g., for a warranty claim
    // or before selling the home).
    closeout: (() => {
      const cb = opts.closeoutBinder;
      if (!cb || (cb.status !== 'finalized' && cb.status !== 'sent')) return undefined;
      const chosenSelections = (opts.selections ?? [])
        .map(c => ({ category: c.category, chosen: (c.options ?? []).find(o => o.isChosen) }))
        .filter((x): x is { category: string; chosen: NonNullable<typeof x.chosen> } => !!x.chosen)
        .map(x => ({
          category: x.category,
          productName: x.chosen.productName,
          brand: x.chosen.brand || undefined,
          sku: x.chosen.sku || undefined,
          supplier: x.chosen.supplier || undefined,
        }));
      const warrantyList = (opts.warranties ?? [])
        .filter(w => w.projectId === project.id)
        .map(w => ({
          title: w.title ?? w.category ?? 'Item',
          provider: w.provider || undefined,
          durationMonths: w.durationMonths,
          endDate: w.endDate,
        }));
      const tradeContacts = (opts.commitments ?? [])
        .filter(c => c.status !== 'draft')
        .map(c => ({
          company: c.vendorName ?? 'Subcontractor',
          scope: c.description ?? c.type,
          phase: c.phase,
          phone: undefined,  // not on commitment yet
          email: undefined,
        }));
      return {
        id: cb.id,
        status: cb.status,
        completionDate: project.closedAt ?? project.updatedAt,
        noteFromContractor: cb.notes || undefined,
        finishes: chosenSelections,
        warranties: warrantyList,
        maintenance: cb.maintenanceSchedule ?? [],
        tradeContacts,
        emergencyEmail: settings?.branding?.email,
        emergencyPhone: settings?.branding?.phone,
      };
    })(),
    // Contract — only emit when GC has actually sent it to the homeowner.
    contract: opts.contract && (opts.contract.status === 'sent' || opts.contract.status === 'signed') ? {
      id: opts.contract.id,
      status: opts.contract.status,
      contractValue: opts.contract.contractValue,
      title: opts.contract.title,
      needsSignature: !opts.contract.homeownerSignature && opts.contract.status === 'sent',
    } : undefined,
    // Selections — every category with at least 1 option, plus the chosen
    // one (if any). Skip pending categories.
    selections: opts.selections && opts.selections.length > 0
      ? opts.selections
          .filter(c => (c.options ?? []).length > 0)
          .map(c => ({
            id: c.id,
            category: c.category,
            styleBrief: c.styleBrief,
            budget: c.budget,
            status: c.status,
            options: (c.options ?? []).map(o => ({
              id: o.id,
              productName: o.productName,
              brand: o.brand,
              description: o.description,
              unitPrice: o.unitPrice,
              unit: o.unit,
              quantity: o.quantity,
              total: o.total,
              leadTimeDays: o.leadTimeDays,
              supplier: o.supplier,
              productUrl: o.productUrl,
              highlights: o.highlights,
              isChosen: o.isChosen,
            })),
          }))
      : undefined,
    messages: trimmedMessages,
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
      heroPhotoUrl,
      startDate,
      targetDate,
      targetBudget: projectTargetBudget,
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
