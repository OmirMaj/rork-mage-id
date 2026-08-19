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
  SavedAIAPayApp, PortalState,
} from '@/types';
import { getUIStrings } from './portalLanguages';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { computeProjectProgress } from '@/utils/projectProgress';
import { addWorkingDays } from '@/utils/scheduleEngine';
import {
  derivePayAppPeriods, buildPeriodNarrative, buildOwnerDecisions,
  toCalendarDate,
  type PeriodNarrative, type OwnerDecision, type PeriodMilestone,
} from '@/utils/portalOwnerCore';

/**
 * Per-item visibility gate. Undefined `portalState` is grandfathered as Sent
 * so existing client portals don't lose items overnight when this feature
 * ships. Explicit 'sent' status is also visible. 'draft' and 'recalled' hide.
 */
function isShared(s?: PortalState): boolean {
  return s == null || s.status === 'sent';
}

/**
 * Returns the per-item serializable payload. If `lastSentSnapshot` is set
 * (post-Send), we render that exact snapshot — edits-after-send never leak.
 * Falls back to the live serializer for grandfathered items.
 */
function renderSerialized<T>(item: T & { portalState?: PortalState }, serialize: (i: T) => unknown): unknown {
  const snap = item.portalState?.lastSentSnapshot;
  if (snap) {
    try { return JSON.parse(snap); } catch { /* malformed snapshot → fall through */ }
  }
  return serialize(item);
}

// v7 adds (Wave 5):
// - language: the homeowner's chosen language code ('en' / 'es' / 'pt' /
//   'zh' / 'vi' / 'fr'). Drives both the AI summary content language
//   (handled at generation time) AND the static portal UI strings
//   below (`uiStrings`).
// - uiStrings: pre-translated bundle of the static portal labels
//   (section titles, CTAs, helper text). Shipping the bundle inline
//   means the portal doesn't need a network call to render in the
//   right language; it just looks up `data.uiStrings.<key>`.
//
// v6 added (Wave 4):
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
// v9 adds (Home Passport):
// - closeout.faq: pre-answered homeowner FAQ ({q, a, refs}) baked at
//   passport generation time on the contractor's device.
// - closeout.passport: summary counts + generatedAt driving the passport
//   header card in the portal closeout section.
// v10 adds (owner clarity — "what am I paying for" + "what's waiting on me"):
// - aiaPayApps[].periodFrom + aiaPayApps[].narrative: a deterministic,
//   plain-English summary of what the billing period actually bought,
//   cross-referenced from the daily reports, photos, and completed
//   schedule milestones whose dates land INSIDE the pay app's window.
//   It renders ABOVE the G702/G703 schedule of values, which is the
//   document an architect reads, not a homeowner. Built by
//   utils/portalOwnerCore.ts — never AI, never fabricated: an empty
//   period carries an explicit `gap` reason and zero bullets.
// - selections[].dueDate: SelectionCategory.dueDate has always existed and
//   been persisted, but was never mapped here — so the portal could not
//   show a deadline and an overdue tile pick looked identical to a fresh
//   one. Now mapped, and it drives the overdue ranking below.
// - ownerDecisions: the ranked list of everything sitting in the owner's
//   court (unsigned contract, pending COs, overdue selections, unpaid
//   invoices), so the portal shows what they're holding up instead of a
//   single hard-coded banner priority.
export const PORTAL_SNAPSHOT_VERSION = 10;

export interface PortalSnapshot {
  v: number;
  snapshotAt: string;
  /**
   * Homeowner's language code. Defaults to 'en' if missing. The static
   * portal uses `uiStrings` directly rather than re-resolving from the
   * code, but the code is exposed for analytics + potential client-side
   * locale-aware date formatting.
   */
  language?: 'en' | 'es' | 'pt' | 'zh' | 'vi' | 'fr';
  /**
   * Pre-resolved UI strings in the homeowner's language. The portal
   * reads `data.uiStrings.<key>` instead of hard-coded English. Shape
   * matches `PortalUIStrings` in utils/portalLanguages.ts.
   */
  uiStrings?: Record<string, string>;
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
    finishes: { category: string; productName: string; brand?: string; sku?: string; supplier?: string }[];
    warranties: { title: string; provider?: string; durationMonths?: number; endDate?: string }[];
    maintenance: { task: string; frequency: string; nextDate?: string; notes?: string }[];
    tradeContacts: { company: string; scope?: string; phase?: string; phone?: string; email?: string }[];
    emergencyEmail?: string;
    emergencyPhone?: string;
    /** v9: pre-answered Home Passport FAQ — instant, zero-cost answers in
     *  the portal. Absent when the GC never generated a passport. */
    faq?: { q: string; a: string; refs: string[] }[];
    /** v9: Home Passport summary counts + generation stamp. */
    passport?: {
      finishes: number; warranties: number; trades: number;
      maintenanceItems: number; photos: number; generatedAt: string;
    };
  };
  // AI-curated selections / allowances the homeowner picks. Flat list
  // because the portal renders a category card for each. Only categories
  // with options are bundled.
  selections?: {
    id: string;
    category: string;
    styleBrief: string;
    budget: number;
    /** v10 — the deadline the GC set on the category. Persisted on
     *  SelectionCategory since day one but never mapped into the
     *  snapshot, so the portal had no way to show a selection deadline
     *  and an overdue pick looked the same as a fresh one. */
    dueDate?: string;
    status: 'pending' | 'browsing' | 'chosen' | 'exceeded';
    options: {
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
      /** Product image URL — surfaced as a swatch in the portal selections grid. */
      imageUrl?: string;
      highlights: string[];
      isChosen: boolean;
    }[];
  }[];
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
    phases: {
      name: string;
      budget: number;
      committed: number;
      actual: number;
      projectedFinal: number;
      variance: number;       // projectedFinal - budget; POSITIVE = over budget
    }[];
    asOf: string;             // ISO timestamp
  };
  // v10 — everything currently waiting on the OWNER, ranked by urgency
  // (overdue first, then contract → change order → selection → invoice,
  // then oldest). Drives the portal's decision banner and the "Waiting on
  // you" list. CLIENT-SAFE: titles, dates, counts, and contract-level
  // dollars only (a change-order delta, an invoice balance) — never cost,
  // markup, margin, unit price, or supplier. Computed at snapshot-build
  // time so `today` is the GC's send date; the portal re-derives ages
  // client-side when it can.
  ownerDecisions?: OwnerDecision[];
  // Recent message thread between GC and client (most recent last). Static
  // portal reloads to fetch new messages; for now we don't poll.
  messages?: {
    id: string;
    authorType: 'client' | 'gc';
    authorName?: string;
    body: string;
    createdAt: string;
  }[];
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
    // v8: live overall percent-complete, rolled up from schedule tasks. Drives
    // the portal's "live progress" trust signal in the hero. Omitted when there
    // is no schedule to roll up.
    progressPct?: number;
  };
  sections: {
    schedule?: {
      // Project-start anchor — required for Gantt date math (startDay → ISO date)
      startDate?: string;
      workingDaysPerWeek?: number;
      totalDurationDays?: number;
      tasks: {
        id: string; title: string; phase?: string; progress: number;
        status: string; durationDays: number;
        // Working-day offset from startDate. Used to position Gantt bars.
        startDay?: number;
        isMilestone?: boolean; isCriticalPath?: boolean;
      }[];
    };
    budget?: {
      contractValue: number; paidToDate: number; outstanding: number;
      pctComplete: number; nextMilestone?: string;
    };
    invoices?: {
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
      lineItems?: {
        name: string; description?: string;
        quantity: number; unit: string; unitPrice: number; total: number;
      }[];
      retentionPercent?: number;
      retentionAmount?: number;
      taxAmount?: number;
      subtotal?: number;
      paymentTerms?: string;
      notes?: string;
    }[];
    aiaPayApps?: {
      id: string;
      applicationNumber: number;
      applicationDate?: string;
      periodTo?: string;
      /** v10 — start of the billing window. SavedAIAPayApp has no
       *  `periodFrom` column; this is DERIVED the way AIA billing works
       *  (the day after the previous application's period end, falling
       *  back to the project start for application #1). Undefined when
       *  neither is known — the narrative then reports a `no_period`
       *  gap instead of guessing a window. */
      periodFrom?: string;
      /** v10 — plain-English "what this period bought", built from the
       *  in-window daily reports / photos / completed milestones the GC
       *  actually shares. CLIENT-SAFE: derived from dates, counts, and
       *  the GC's own field notes — never from a schedule-of-values
       *  line, a unit cost, a markup, or a supplier. */
      narrative?: PeriodNarrative;
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
      // Stripe payment link auto-attached on save when GC has Connect set
      // up (see app/aia-pay-app.tsx). Renders the Pay button on the
      // portal AIA card + drawer footer at marketing/portal/index.html.
      payLinkUrl?: string;
      lines: {
        itemNo: string; description: string;
        scheduledValue: number; fromPreviousApp: number;
        thisPeriod: number; materialsPresentlyStored: number;
        retainagePercent: number;
      }[];
    }[];
    changeOrders?: {
      id: string; number: number | string; description: string;
      changeAmount: number; status: string; dateSubmitted?: string;
      /** v10 — the record the homeowner is actually signing. A change order
       *  is a contract amendment, so the terms have to be in front of the
       *  signer, not just a dollar figure. All three are contract-level and
       *  client-facing (the same numbers already on the CO the GC emailed) —
       *  no cost buildup, markup, or margin. */
      reason?: string;
      newContractTotal?: number;
      scheduleImpactDays?: number;
    }[];
    photos?: {
      url: string;
      caption?: string;
      timestamp?: string;
      // Markup primitives drawn over the photo by the GC. Coords are
      // normalized 0..1 so the static portal can re-render them at any
      // display size. Only emitted when there's at least one annotation.
      markup?: {
        type: 'arrow' | 'rectangle' | 'circle' | 'freehand' | 'text';
        color: 'red' | 'yellow' | 'green';
        points: { x: number; y: number }[];
        text?: string;
      }[];
    }[];
    dailyReports?: {
      id: string; date: string; weather?: string;
      totalManpower?: number; totalManHours?: number;
      workPerformed?: string;
    }[];
    punchList?: {
      id: string; title: string; status: string;
      priority?: string; location?: string;
    }[];
    rfis?: {
      id: string; number: number | string; subject: string;
      status: string; dateSubmitted?: string;
    }[];
    documents?: { name: string; type?: string; dateSent?: string }[];
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
  messages?: {
    id: string;
    authorType: 'client' | 'gc';
    authorName?: string;
    body: string;
    createdAt: string;
  }[];
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
  // Baked Home Passport (pre-answered FAQ + summary counts), loaded from
  // utils/passport/passportStore. Omitted when the GC never generated one.
  homePassport?: import('./passport/types').BakedHomePassport | null;
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

  // Schedule — includes anchors (project start date + working days) +
  // per-task startDay so the portal can render a real Gantt with dates
  // instead of a flat task list.
  if (portal.showSchedule && project.schedule?.tasks?.length) {
    sections.schedule = {
      startDate: project.schedule.startDate,
      workingDaysPerWeek: project.schedule.workingDaysPerWeek,
      totalDurationDays: project.schedule.totalDurationDays,
      tasks: project.schedule.tasks.map(t => ({
        id: t.id,
        title: t.title,
        phase: t.phase,
        progress: t.progress ?? 0,
        status: t.status,
        durationDays: t.durationDays ?? 0,
        startDay: t.startDay ?? 0,
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
      effectiveEstimateTotal(project)
      || project.targetBudget?.amount
      || 0;
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
  if (portal.showInvoices) {
    const visibleInvoices = invoices.filter(i => isShared(i.portalState));
    if (visibleInvoices.length) {
      sections.invoices = visibleInvoices.map(i => renderSerialized(i, (inv) => {
        const total = inv.totalDue ?? 0;
        const amountPaid = inv.amountPaid ?? 0;
        const balance = Math.max(0, total - amountPaid);
        const lineItems = (inv.lineItems ?? []).slice(0, maxInvoiceLines).map(li => ({
          name: li.name ?? '',
          description: li.description || undefined,
          quantity: li.quantity ?? 0,
          unit: li.unit ?? '',
          unitPrice: li.unitPrice ?? 0,
          total: li.total ?? 0,
        }));
        return {
          id: inv.id,
          number: inv.number,
          total,
          status: inv.status,
          dueDate: inv.dueDate,
          dateSubmitted: inv.issueDate,
          balance,
          payLinkUrl: inv.payLinkUrl,
          amountPaid,
          issueDate: inv.issueDate,
          lineItems,
          retentionPercent: inv.retentionPercent,
          retentionAmount: inv.retentionAmount,
          taxAmount: inv.taxAmount,
          subtotal: inv.subtotal,
          paymentTerms: inv.paymentTerms,
          notes: inv.notes || undefined,
        };
      })) as PortalSnapshot['sections']['invoices'];
    }
  }

  // AIA G702/G703 pay applications — surfaced as a dedicated portal section
  // so the client/architect/lender can pull a printable PDF from the portal
  // without bouncing back through email.
  if (portal.showInvoices) {
    const visibleAIA = aiaPayApps.filter(a => isShared(a.portalState));
    if (visibleAIA.length) {
      const sorted = [...visibleAIA].sort((a, b) => b.applicationNumber - a.applicationNumber);
      sections.aiaPayApps = sorted.slice(0, maxAIAPayApps).map(a => renderSerialized(a, (app) => ({
        id: app.id,
        applicationNumber: app.applicationNumber,
        applicationDate: app.applicationDate,
        periodTo: app.periodTo,
        ownerName: app.ownerName || undefined,
        architectName: app.architectName || undefined,
        contractorName: app.contractorName || undefined,
        contractSumToDate: app.contractSumToDate,
        retainagePercent: app.retainagePercent,
        lessPreviousCertificates: app.lessPreviousCertificates,
        currentPaymentDue: app.totals.currentPaymentDue,
        totalCompletedAndStored: app.totals.totalCompletedAndStored,
        totalRetainage: app.totals.totalRetainage,
        totalEarnedLessRetainage: app.totals.totalEarnedLessRetainage,
        balanceToFinish: app.totals.balanceToFinish,
        percentComplete: app.totals.percentComplete,
        payLinkUrl: app.payLinkUrl,
        lines: app.lines.map(l => ({
          itemNo: l.itemNo,
          description: l.description,
          scheduledValue: l.scheduledValue,
          fromPreviousApp: l.fromPreviousApp,
          thisPeriod: l.thisPeriod,
          materialsPresentlyStored: l.materialsPresentlyStored,
          retainagePercent: l.retainagePercent,
        })),
      }))) as PortalSnapshot['sections']['aiaPayApps'];
    }
  }

  // Change Orders
  if (portal.showChangeOrders) {
    const visibleCOs = changeOrders.filter(c => isShared(c.portalState));
    if (visibleCOs.length) {
      sections.changeOrders = visibleCOs.map(c => renderSerialized(c, (co) => ({
        id: co.id,
        number: co.number,
        description: co.description ?? co.reason ?? '',
        changeAmount: co.changeAmount ?? 0,
        status: co.status,
        dateSubmitted: co.date,
        // The signable record: why the change exists, what it does to the
        // contract total, and what it does to the finish date.
        reason: co.description && co.reason && co.reason !== co.description ? co.reason : undefined,
        newContractTotal: co.newContractTotal || undefined,
        scheduleImpactDays: co.scheduleImpactDays || undefined,
      }))) as PortalSnapshot['sections']['changeOrders'];
    }
  }

  // Photos (limit to prevent URL bloat — newest first)
  if (portal.showPhotos) {
    const visiblePhotos = photos.filter(p => isShared(p.portalState));
    if (visiblePhotos.length) {
      const sorted = [...visiblePhotos].sort((a, b) => {
        const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tb - ta;
      });
      sections.photos = (sorted.slice(0, maxPhotos).map(p => renderSerialized(p, (photo) => ({
        url: photo.uri ?? '',
        caption: photo.tag ?? photo.location,
        timestamp: photo.timestamp,
        markup: (photo.markup ?? []).length > 0
          ? photo.markup!.map(m => ({
              type: m.type,
              color: m.color,
              points: m.points,
              text: m.text,
            }))
          : undefined,
      }))) as PortalSnapshot['sections']['photos'])?.filter(p => p != null && (p as { url?: string }).url);
    }
  }

  // Daily Reports (limit — most recent first)
  if (portal.showDailyReports) {
    const visibleDFRs = dailyReports.filter(d => isShared(d.portalState));
    if (visibleDFRs.length) {
      const sorted = [...visibleDFRs].sort((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return tb - ta;
      });
      sections.dailyReports = sorted.slice(0, maxDailyReports).map(d => renderSerialized(d, (dfr) => {
        const totalManHours = (dfr.manpower ?? []).reduce(
          (s, m) => s + ((m.hoursWorked ?? 0) * (m.headcount ?? 1)),
          0,
        );
        const totalManpower = (dfr.manpower ?? []).reduce(
          (s, m) => s + (m.headcount ?? 0),
          0,
        );
        const weather = dfr.weather
          ? `${dfr.weather.conditions ?? ''} ${dfr.weather.temperature ?? ''}`.trim() || undefined
          : undefined;
        return {
          id: dfr.id,
          date: dfr.date,
          weather,
          totalManpower,
          totalManHours,
          workPerformed: dfr.workPerformed,
        };
      })) as PortalSnapshot['sections']['dailyReports'];
    }
  }

  // Punch List (only open / in-progress items are useful to clients)
  if (portal.showPunchList && punchItems.length) {
    // Exclude completed work ('closed'); only surface actionable items
    // (open, in-progress, ready-for-review) to the client portal.
    const activePunch = punchItems.filter(
      p => p.status === 'open' || p.status === 'in_progress' || p.status === 'ready_for_review'
    );
    if (activePunch.length) {
      sections.punchList = activePunch.map(p => ({
        id: p.id,
        title: p.description,
        status: p.status,
        priority: p.priority,
        location: p.location,
      }));
    }
  }

  // RFIs
  if (portal.showRFIs) {
    const visibleRFIs = rfis.filter(r => isShared(r.portalState));
    if (visibleRFIs.length) {
      sections.rfis = visibleRFIs.map(r => renderSerialized(r, (rfi) => ({
        id: rfi.id,
        number: rfi.number,
        subject: rfi.subject ?? rfi.question ?? '',
        status: rfi.status,
        dateSubmitted: rfi.dateSubmitted,
      }))) as PortalSnapshot['sections']['rfis'];
    }
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
    const sorted = [...photos.filter(p => isShared(p.portalState))].sort((a, b) => {
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
    effectiveEstimateTotal(project) <= 0 && !project.targetBudget?.amount;
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
    // Project id enables server-side routing for portal-originated
    // events (reactions, comments, etc.). The GC user_id is derived
    // server-side from portal_id by the notify edge function (gates
    // anon writes correctly).
    projectId: project.id,
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
      const contractValue = effectiveEstimateTotal(project) + approvedCOs;
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

  // Homeowner language — defaults to English. Drives both the AI
  // summary at generation time AND the static portal labels. We bundle
  // the resolved UI strings inline so the portal doesn't need a
  // separate fetch to render in the homeowner's language.
  const language = (portal.homeownerLanguage ?? 'en');
  const uiStrings = getUIStrings(language) as unknown as Record<string, string>;

  // Selections — every category with at least 1 option, plus the chosen one
  // (if any). Hoisted out of the return literal because ownerDecisions below
  // needs the same list to know which picks are still open.
  const selectionsPayload: PortalSnapshot['selections'] = (() => {
    const visible = (opts.selections ?? [])
      .filter(c => isShared(c.portalState) && (c.options ?? []).length > 0)
      .map(c => ({
        id: c.id,
        category: c.category,
        styleBrief: c.styleBrief,
        budget: c.budget,
        // dueDate has always been on SelectionCategory and persisted;
        // it just never made it into the snapshot, so the portal could
        // not show a deadline. Mapped through here it also feeds the
        // overdue ranking in ownerDecisions below.
        dueDate: c.dueDate,
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
          imageUrl: o.imageUrl,
          highlights: o.highlights,
          isChosen: o.isChosen,
        })),
      }));
    return visible.length > 0 ? visible : undefined;
  })();

  // ── v10: plain-English pay-application narratives ─────────────────────────
  // A homeowner reading "Division 09 Finishes — $14,200 this period, 62%
  // complete" has no way to judge whether that's fair, so they sit on it — and
  // days-to-payment is the number that decides whether a small GC makes
  // payroll. We cross-reference each pay app's billing window against the
  // daily reports, photos, and completed milestones the GC ALREADY shares and
  // state, in plain English, what the period bought.
  //
  // Grounding rules (see utils/portalOwnerCore.ts):
  //  - only rows whose date falls INSIDE the window are counted;
  //  - only sources this portal actually shows are cited — we never promise
  //    "6 photos" on a portal with photos turned off;
  //  - an empty period returns a `gap` reason and zero bullets. No filler.
  if (sections.aiaPayApps?.length) {
    // Milestone "completion" date: SavedAIAPayApp has no per-task actuals, so
    // a milestone counts for a window when the GC has marked it done AND its
    // scheduled finish lands inside that window. That is the strongest claim
    // the stored data supports.
    const milestones: PeriodMilestone[] = (() => {
      if (!portal.showSchedule) return [];
      const sch = project.schedule;
      const anchor = toCalendarDate(sch?.startDate);
      if (!sch?.tasks?.length || !anchor) return [];
      const wpw = sch.workingDaysPerWeek ?? 5;
      const start = new Date(`${anchor}T00:00:00Z`);
      return sch.tasks
        .filter(t => t.isMilestone)
        .map(t => {
          const endDay = (t.startDay ?? 1) + Math.max(0, (t.durationDays ?? 1) - 1);
          let dateISO: string | undefined;
          try {
            dateISO = addWorkingDays(start, Math.max(0, endDay - 1), wpw, sch.nonWorkingDates)
              .toISOString().slice(0, 10);
          } catch { dateISO = undefined; }
          return {
            id: t.id,
            title: t.title,
            dateISO,
            completed: t.status === 'done' || (t.progress ?? 0) >= 100,
          };
        })
        .filter(m => !!m.dateISO);
    })();

    const periods = derivePayAppPeriods(
      sections.aiaPayApps.map(a => ({ id: a.id, applicationNumber: a.applicationNumber, periodTo: a.periodTo })),
      // Application #1 has no predecessor — anchor it to the project start.
      startDate ?? project.schedule?.startDate,
    );
    const periodById = new Map(periods.map(p => [p.id, p]));

    const shared = {
      reports: !!portal.showDailyReports,
      photos: !!portal.showPhotos,
      schedule: !!portal.showSchedule,
    };
    for (const app of sections.aiaPayApps) {
      const window = periodById.get(app.id);
      app.periodFrom = window?.periodFrom;
      app.narrative = buildPeriodNarrative({
        periodFrom: window?.periodFrom,
        periodTo: window?.periodTo ?? app.periodTo,
        // Deliberately the SNAPSHOT rows, not the raw domain objects: the
        // narrative can only ever see what the homeowner can already see.
        reports: sections.dailyReports ?? [],
        photos: sections.photos ?? [],
        milestones,
        shared,
      });
    }
  }

  // ── v10: what's waiting on the owner ──────────────────────────────────────
  // Ranked so the portal can lead with the single most urgent item and list
  // the rest underneath. Every day an owner sits on a tile selection is a day
  // the GC's sub doesn't show up.
  const ownerDecisions: OwnerDecision[] = (() => {
    const today = new Date().toISOString().slice(0, 10);
    const list = buildOwnerDecisions({
      today,
      contract: opts.contract && opts.contract.status === 'sent'
        ? {
            status: 'sent',
            needsSignature: !opts.contract.homeownerSignature,
            sentAt: opts.contract.sentAt ?? opts.contract.updatedAt,
            title: opts.contract.title,
          }
        : null,
      changeOrders: sections.changeOrders ?? [],
      coApprovalEnabled: !!portal.coApprovalEnabled,
      selections: (selectionsPayload ?? []).map(c => ({
        id: c.id,
        category: c.category,
        dueDate: c.dueDate,
        status: c.status,
        chosen: (c.options ?? []).some(o => o.isChosen),
      })),
      invoices: (sections.invoices ?? []).map(i => ({
        id: i.id,
        number: i.number,
        status: i.status,
        balance: i.balance,
        dueDate: i.dueDate,
      })),
    });
    return list;
  })();

  return {
    v: PORTAL_SNAPSHOT_VERSION,
    snapshotAt: new Date().toISOString(),
    language,
    uiStrings,
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
        .filter(c => isShared(c.portalState))
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
        .filter(w => isShared(w.portalState) && w.projectId === project.id)
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
      // v9 — Home Passport bake. Only present when the GC has generated a
      // passport; the portal degrades to the plain binder when absent.
      const hp = opts.homePassport;
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
        faq: hp && hp.faq.length > 0 ? hp.faq.map(f => ({ q: f.q, a: f.a, refs: f.refs })) : undefined,
        passport: hp
          ? {
              finishes: hp.summary.finishes,
              warranties: hp.summary.warranties,
              trades: hp.summary.trades,
              maintenanceItems: hp.summary.maintenanceItems,
              photos: hp.summary.photos,
              generatedAt: hp.generatedAt,
            }
          : undefined,
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
    // one (if any). Skip pending categories and non-shared items.
    selections: selectionsPayload,
    ownerDecisions,
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
      progressPct: (() => { const p = computeProjectProgress(project); return p.hasSchedule ? p.pct : undefined; })(),
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

/**
 * Short shareable URL — just `<base>/<portalId>?inviteId=...`. The
 * static portal HTML falls back to fetching the snapshot from the
 * `portal_snapshots` table when no `#d=...` hash is present, so this
 * URL works as long as the GC's app has pushed a snapshot to the
 * server (it does, on every save). Use this for SMS, email subjects,
 * and anywhere else where the giant base64 hash would get mangled.
 */
export function buildShortPortalUrl(
  baseUrl: string,
  portalId: string,
  inviteId?: string,
  accessToken?: string,
): string {
  // accessToken (`?t=`) is the server-managed gate for client decisions
  // (sign/selection). It travels ONLY in the share link — never in the portal
  // snapshot — so fetching the snapshot by portalId cannot leak it.
  const base = `${baseUrl}/${portalId}`;
  const params = new URLSearchParams();
  if (inviteId) params.set('inviteId', inviteId);
  if (accessToken) params.set('t', accessToken);
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

// Rough sanity check — URL fragments over ~8KB start to make SMS clients unhappy.
// Return size in KB of the encoded payload to let the UI show a warning.
export function estimateSnapshotSizeKb(snapshot: PortalSnapshot): number {
  const json = JSON.stringify(snapshot);
  return Math.ceil(new Blob([json]).size / 1024);
}
