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
  SavedAIAPayApp, PortalState, ProjectSchedule, Permit, Warranty,
  SendableItemKind, InvoicePayment, ScheduleTask, ProjectContract,
} from '@/types';
import { portalLiveOverrides, PORTAL_MAX_INVOICE_LINES } from '@/utils/portalFreeze';
import { punchListTypeOf } from '@/types';
import { dayOrInstantDate, calendarDayOf, parseCalendarDay, formatCalendarDay } from '@/utils/calendarDate';
import { contractTimeline } from '@/utils/contractTimelineCore';
import { runCpm, calendarIndexToWorkingOrdinal } from '@/utils/cpm';
import { getUIStrings } from './portalLanguages';
import { invoiceOutstanding, effectiveRetentionHeld, pendingRetentionHeld } from '@/utils/invoiceBilling';
import { roundCents } from '@/utils/aiaBilling';
import { paymentReceivedDay, type RecordedPaymentFields } from '@/utils/billingFlowCore';
import {
  getEffectiveInvoiceStatus, getOutstandingBalance, getInvoicedToDate,
  getRetentionHeld, getPaidToDate,
} from '@/utils/projectFinancials';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import { toClientEstimateView } from '@/utils/clientEstimateView';
import { isValidStamp, proposalPaymentLines, milestoneDueText, hasWarrantyPlaceholder, printedScheduleAmounts } from '@/utils/paymentTerms';
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
 * Exported for scripts/validate-homeowner-digest-gates.ts, which holds the
 * Friday homeowner email's copy of this rule (homeowner-weekly-digest/
 * clientVisible.ts isPortalShared) to this one.
 */
export function isShared(s?: PortalState): boolean {
  return s == null || s.status === 'sent';
}

/**
 * Returns the per-item serializable payload. If `lastSentSnapshot` is set
 * (post-Send), the item's FROZEN copy is rendered — edits-after-send never
 * leak — but through the SAME serializer as a live item, with the live state
 * fields laid over it (portalLiveOverrides). Returning the parsed snapshot
 * as-is sent the client raw domain JSON: an invoice with no balance and no
 * Pay button, a change order with no dateSubmitted, and fields the serializer
 * exists to strip or gate. Falls back to the live item for grandfathered
 * items and for a snapshot that does not parse.
 */
function renderSerialized<T>(
  kind: SendableItemKind,
  item: T & { portalState?: PortalState },
  serialize: (i: T) => unknown,
): unknown {
  const snap = item.portalState?.lastSentSnapshot;
  if (snap) {
    try {
      const frozen = JSON.parse(snap) as Record<string, unknown>;
      if (frozen && typeof frozen === 'object' && !Array.isArray(frozen)) {
        return serialize({ ...frozen, ...portalLiveOverrides(kind, item), portalState: item.portalState } as unknown as T);
      }
    } catch { /* malformed snapshot → fall through */ }
  }
  return serialize(item);
}

/**
 * What a published photo may carry (#14): an http(s) `url` (a legacy public
 * link) and/or the private-bucket `path`. Never a file:/blob:/data: value —
 * those open only on the phone that took the picture. Pure; validator runs it.
 */
export function portalPhotoSource(photo: { uri?: string | null; storagePath?: string | null }): { url?: string; path?: string } {
  const uri = typeof photo.uri === 'string' ? photo.uri.trim() : '';
  const out: { url?: string; path?: string } = {};
  if (/^https?:\/\//i.test(uri)) out.url = uri;
  const stored = typeof photo.storagePath === 'string' ? photo.storagePath.trim() : '';
  // A bare key (no scheme) in `uri` is the server's copy of the path.
  const path = stored || (uri && !/^[a-z][a-z0-9+.-]*:/i.test(uri) ? uri : '');
  if (path) out.path = path;
  return out;
}

/** The device's IANA time zone, or undefined when the runtime cannot say. */
function deviceTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz ? tz : undefined;
  } catch {
    return undefined;
  }
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
// v11 (PORTAL-01, runtime audit 2026-09-06) changes what two numbers in
// `sections.budget` MEAN — which is why it is a version bump and not a patch
// — and adds two more so the portal's money bar can be drawn without mixing
// a pre-tax contract into tax-inclusive cash:
// - budget.workComplete REPLACES budget.pctComplete. pctComplete was
//   `round(paidToDate / contractValue * 100)` — percent PAID, unclamped, and
//   across two different bases (tax-inclusive cash over a pre-tax contract) —
//   rendered to the homeowner under the label "Project complete". The
//   founder's live Henderson portal read "Project complete: 102%".
//   workComplete is duration-weighted schedule progress, clamped 0-100, and
//   `null` when no task has any progress recorded, so the portal can say "—"
//   instead of inventing a 0%.
// - budget.outstanding is now billed-and-unpaid (net of unreleased retention)
//   rather than `contractValue - paidToDate`, so it is on ONE basis — and it
//   is summed over exactly the invoices the client can SEE (the same
//   isShared() + not-draft population as sections.invoices), so a document
//   the GC has not issued, or has recalled, is neither charged for nor
//   disclosed by the headline.
// - budget.invoicedToDate + budget.retentionHeld are NEW, and they exist so
//   the money bar on that card can be drawn on ONE basis. Every one of them
//   is tax-inclusive invoice dollars over that same population;
//   contractValue is a PRE-TAX contract and is deliberately not mixed into
//   any of them.
// Portals rendering an older snapshot (a `#d=` hash link, or a snapshot row
// not yet re-pushed) re-derive work-complete from sections.schedule.tasks and
// ignore pctComplete entirely — they never show the old figure again.
// v12 adds `proposal` — the client-safe projection of the project estimate,
// plus the canonical text a homeowner's acceptance signature binds to. It is
// the portal's first write path that creates an obligation out of something
// that was not already a row in the database, which is why the document the
// signature covers is built here and re-hashed server-side rather than taken
// from the browser. See the PROPOSAL block below.
// v13 (wave 4) adds the contract's TERMS (`contract.content`, #64 — see the
// CONTRACT block below), photo `path` with `url` narrowed to http(s) and
// `project.heroPhotoId` (#14 — the page signs private photos by id through
// signed-media-urls), and top-level `timeZone` (#20).
export const PORTAL_SNAPSHOT_VERSION = 13;

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
  /** v13: the GC device's IANA zone (Intl), for day labels the server builds. */
  timeZone?: string;
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
  // v12 — the moment to ask. Emitted once the GC's own substantial-completion
  // date has arrived, so the portal can prompt the homeowner for feedback and
  // a referral while the job is fresh. A remodeler's referral rate is most of
  // his marketing budget, and nobody asks.
  //
  // It carries ONLY the date the GC recorded. There is no rating, no score and
  // no survey response to store, because there is no write path for one — the
  // ask opens the existing message thread. Calling it a satisfaction survey
  // when it is a prompt to write a message would be the kind of claim this
  // product deletes features for.
  feedbackAsk?: {
    /** The GC's recorded substantial-completion date (YYYY-MM-DD). */
    completedOn: string;
  };
  // v12 — the proposal the homeowner can accept or decline, with the same
  // signature capture the change-order flow uses. Present only when the GC
  // turned `proposalApprovalEnabled` on AND there is a priced estimate AND no
  // construction agreement has been sent yet (see buildPortalProposal). Its
  // `documentText` is what an acceptance signature actually binds to. Its
  // payment lines come ONLY from the portal's own stamp
  // (portal.proposalPaymentTerms) — never from settings — and without a stamp
  // it ships read-only with `paymentTermsPending`, which nobody can accept.
  proposal?: PortalProposal;
  // Whether the client can 1-tap approve/decline change orders from the
  // portal. When false the CO list is read-only.
  coApprovalEnabled?: boolean;
  // Active project contract (when status >= 'sent'). Lets the homeowner
  // review + counter-sign their construction agreement directly in the
  // static portal. Nothing else fetches the row for the page: the page has
  // no read path to project_contracts, so what the homeowner reads before
  // signing is exactly what `content` carries (#64). (This comment used to
  // say the full row was fetched through portalApi — it never was, and the
  // signer saw a title and a number.)
  contract?: PortalContractBlock;
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
    /** v13 (#14): the hero photo's row id — the page asks signed-media-urls
     *  for it. heroPhotoUrl is then only a legacy http(s) link. */
    heroPhotoId?: string;
    // v2: optional schedule anchors. If we have a schedule we surface the
    // project start date and the SCHEDULED FINISH so the portal can show
    // "Mar 14 → Aug 22".
    //
    // `targetDate` is produced by `scheduleFinishDate` and by nothing else —
    // it is the plan's last working day on the working-day calendar, the same
    // day the GC sees in-app and the same day the portal's Gantt draws. It is
    // never a guess: absent schedule data leaves it undefined and the hero
    // degrades to "Started <date>".
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
      // ISO YYYY-MM-DD days the crew does not work (holidays, rain days, site
      // closures). Shipped so the portal's own Gantt can skip them the way
      // addWorkingDays does in-app — without it the page's bars and its
      // "PROJECT TIMELINE" header drift a day per suppressed day away from
      // the hero's finish date, which is computed with them.
      nonWorkingDates?: string[];
      tasks: {
        id: string; title: string; phase?: string; progress: number;
        status: string; durationDays: number;
        // Working-day offset from startDate. Used to position Gantt bars.
        startDay?: number;
        isMilestone?: boolean; isCriticalPath?: boolean;
      }[];
    };
    budget?: {
      // The revised contract: base estimate + approved COs. PRE-TAX, because
      // an estimate total is. Never add a tax-inclusive invoice figure to it
      // and never subtract one from it.
      contractValue: number;
      // Cash received, tax included — the sum of invoice `amountPaid`.
      paidToDate: number;
      // PORTAL-01: what the client still OWES — billed and not yet paid, net
      // of unreleased retention (utils/invoiceBilling.invoiceOutstanding),
      // summed over the invoices the client can see. This used to be
      // `contractValue - paidToDate`, which subtracted tax-inclusive cash
      // from a pre-tax contract AND forced the portal's "Remaining" (un-billed)
      // bar segment to zero for every project.
      outstanding: number;
      // PORTAL-01: total billed to the client, tax included, over the same
      // population as `outstanding` and as `sections.invoices`. The money bar
      // on the portal's budget card is drawn from this + paidToDate +
      // retentionHeld, so that every segment of it is the same kind of dollar.
      // Absent on snapshots authored before 2026-09-06.
      invoicedToDate?: number;
      // PORTAL-01: retention the contract lets the client hold back on those
      // same invoices, less anything already released. Billed, but NOT due
      // today — which is why it is excluded from `outstanding` and reported
      // on its own rather than folded into either figure.
      // Absent on snapshots authored before 2026-09-06.
      retentionHeld?: number;
      // PORTAL-01: percent of the WORK that is complete, duration-weighted
      // from the project schedule. `null` when the GC has recorded no progress
      // on any task — the app does not know, and the portal renders "—".
      // Absent on snapshots authored before 2026-09-06.
      workComplete?: number | null;
      /** @deprecated PORTAL-01 (runtime audit 2026-09-06). This was percent
       *  PAID rendered under a "Project complete" label: unclamped, and
       *  dividing tax-inclusive cash by a pre-tax contract, so the founder's
       *  own Henderson portal read "Project complete: 102%". No longer emitted
       *  and no longer read by marketing/portal/index.html. Kept on the type
       *  only so snapshots written before the fix still parse. Use
       *  `workComplete`. */
      pctComplete?: number;
      nextMilestone?: string;
    };
    invoices?: {
      id: string; number: number | string; total: number; status: string;
      dueDate?: string; dateSubmitted?: string;
      // Remaining balance for the invoice, NET of the retention the contract
      // lets the client hold (MONEY-F5: utils/invoiceBilling.invoiceOutstanding).
      // Portal uses this to decide whether to show "Pay Now" and for how much.
      balance?: number;
      // Retention still held on this invoice — shown, never charged.
      retentionHeld?: number;
      // If the GC has generated a Stripe payment link for this invoice, the
      // portal surfaces a one-tap "Pay Now" button that opens it. MONEY-F2:
      // only carried while the link's minted amount equals `balance`.
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
      // Retention already released back into the balance, so the portal can
      // show what is still HELD (retentionAmount − retentionReleased) rather
      // than the original withholding.
      retentionReleased?: number;
      // Status as the app computes it (utils/projectFinancials
      // .getEffectiveInvoiceStatus): overdue past the due date, paid when the
      // retention-net balance is covered, reopened when a release creates a
      // balance on a stored 'paid'. The portal pill reads THIS; `status` is
      // the stored value, kept for older portal builds.
      effectiveStatus?: string;
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
      // MONEY-F2: omitted once the pay app is paid (`paidAt` set by the
      // Stripe webhook), so a paid application never shows Pay again.
      payLinkUrl?: string;
      /** Dollars the link above was minted for. The portal page re-checks it
       *  against what is owed, so a CACHED snapshot published before the
       *  server-side guard existed still cannot offer a stale amount. */
      payLinkAmount?: number;
      /** The invoice this certificate certifies. One billing period is one
       *  obligation: the portal uses this to refuse a Pay button on a pay
       *  application whose invoice is already settled, even when a stale
       *  aia_pay_apps row still carries a live link (the Stripe webhook's
       *  creditInvoice does not clear the AIA side). */
      invoiceId?: string;
      paidAt?: string;
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
      /** Wave 3 (#131) — the sales tax frozen on the CO and the tax-inclusive
       *  figure the CO screen tells him the client approves. Dollar amounts,
       *  never a rate: the portal must not work tax out on its own. Absent
       *  on a CO with no tax (or one saved before the freeze existed). */
      taxAmount?: number;
      totalWithTax?: number;
    }[];
    photos?: {
      /** The photo row's id — the server overlay (portal_overlay_live) drops
       *  a photo recalled from ANY device on read, and needs the id to find
       *  its row. Absent on snapshots built before 2026-09-19 (matched by url). */
      id?: string;
      /** v13 (#14): http(s) only — never file:/blob:/data:. Absent for a
       *  photo that lives in the private bucket: the page signs it by id. */
      url?: string;
      /** The private-bucket key (photos.uri on the server). */
      path?: string;
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
    /**
     * Records the GC has shared, NOT a file cabinet.
     *
     * This section shipped a literal `[]` for its whole life (the portal skips
     * a zero-length section, so the "Documents" switch made nothing appear and
     * warned nobody). What it carries now is permits and portal-sent
     * warranties — the two homeowner-facing paper trails that have no other
     * home on this page.
     *
     * There is deliberately no `url`. Nothing in this repo writes a permit
     * attachment, and `Warranty.documentUri` has no writer either (stated in
     * utils/passport/consumerPassport.ts:529), so a link here would be a
     * download button that 404s. These rows state what exists, its number, its
     * state and when it lapses — which is what an owner chasing a warranty
     * claim two years later actually needs to name the thing they're asking
     * for.
     */
    documents?: {
      name: string;
      /** Where it comes from — a jurisdiction for a permit, the provider for a
       *  warranty. Rendered as the row's second line. */
      type?: string;
      /** The date this record starts counting: permit approval (or
       *  application, if not approved yet), warranty start. */
      dateSent?: string;
      /** Plain-language state: "Approved", "Under review", "In force". */
      status?: string;
      /** Calendar day this lapses, when the record has one. */
      expiresOn?: string;
    }[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// v13 — THE CONTRACT THE HOMEOWNER SIGNS (#64)
//
// The portal asked a homeowner to sign a binding construction agreement with
// nothing on screen but its title and its value, and told them to review the
// scope, payment schedule and warranty "in the app" — homeowners have no app.
// The deposit invoice that followed then billed an amount they had never been
// shown on the page they signed.
//
// `content` is the agreement itself, built HERE on the GC's device from the
// saved contract row, the same row the sealed PDF (utils/pdfGenerator
// buildContractHtml) prints:
//   - paymentSchedule: each milestone's label, when it is due, and its amount
//     TO THE CENT, taken from the saved milestone. The portal never works a
//     percentage out on its own; a row with neither an amount nor a percent is
//     published with `amount: null`, and the page refuses to draw a sign box
//     under an unpriced milestone.
//   - scopeText (falling back to the project description, as the PDF does),
//     termsText, warrantyText, the allowances, and the timeline — only when
//     both halves resolve (utils/contractTimelineCore.contractTimeline), never a
//     completion date derived from a blank.
// The server overlay (portal_overlay_live) keeps this object for the SAME
// contract id and lays the live status over it; for a contract the device has
// not published yet it sends a minimal block with contentPending:true. Either
// way, whether the terms are complete enough to sign is the page's check
// (contractTermsMissing in marketing/portal/index.html mirrors
// portalContractTermsMissing below).
// ─────────────────────────────────────────────────────────────────────────────

export interface PortalContractPaymentLine {
  label: string;
  /** "Due at signing", "Billed as work is completed", "Due Oct 1, 2026"… */
  dueText: string;
  /** Dollars to the cent; null when the saved milestone has no price. */
  amount: number | null;
}

export interface PortalContractContent {
  paymentSchedule: PortalContractPaymentLine[];
  scopeText: string;
  termsText: string;
  warrantyText: string;
  /** Calendar days (YYYY-MM-DD); all three present or none. */
  startDate?: string;
  durationDays?: number;
  completionDate?: string;
  allowances: { category: string; amount: number; description?: string }[];
}

export interface PortalContractBlock {
  id: string;
  status: 'sent' | 'signed';
  contractValue: number;
  title: string;
  needsSignature: boolean;   // true when GC has signed but homeowner hasn't
  /** v13 (#64) — what the homeowner reads before (and after) signing. */
  content?: PortalContractContent;
  // Written ONLY by the server overlay, never by this builder: who signed and
  // how ('in_person' / 'paper' are recorded by the GC — app/contract.tsx), and
  // whether the device has published this contract's terms yet.
  homeownerSignerName?: string;
  homeownerSignedAt?: string;
  homeownerSignatureMethod?: 'portal' | 'in_person' | 'paper';
  contentPending?: boolean;
}

// One milestone's dollars: paymentTerms printedScheduleAmounts (percent wins,
// the rounding cent on the row retieContractSchedule gives it) — the same
// column the sealed contract PDF prints (pdfGenerator buildContractHtml).

/** The client-safe terms of a sent/signed contract. Pure; the validator runs it. */
export function buildPortalContractContent(
  contract: Pick<ProjectContract, 'contractValue' | 'scopeText' | 'termsText' | 'warrantyText' | 'paymentSchedule' | 'allowances' | 'startDate' | 'durationDays'>,
  projectDescription?: string,
): PortalContractContent {
  const value = Number(contract.contractValue) || 0;
  const schedule = (Array.isArray(contract.paymentSchedule) ? contract.paymentSchedule : []).filter(m => !!m);
  const printedAmounts = printedScheduleAmounts(schedule, value);
  const allowances = Array.isArray(contract.allowances) ? contract.allowances : [];
  const scope = typeof contract.scopeText === 'string' && contract.scopeText.trim()
    ? contract.scopeText
    : (projectDescription ?? '');
  const timeline = contractTimeline(contract.startDate, contract.durationDays);
  return {
    // Every row the sealed PDF prints, in its order — the portal and the
    // signed copy must not disagree about what was agreed (a row's billing
    // status is not part of the agreement).
    paymentSchedule: schedule
      .map((m, i) => ({
        label: typeof m.label === 'string' && m.label.trim() ? m.label.trim() : 'Payment',
        // The sealed PDF prints a row's date when it has one, else
        // milestoneDueText — the same words here.
        dueText: m.triggerDate ? `Due ${formatCalendarDay(m.triggerDate)}` : milestoneDueText(m),
        amount: printedAmounts[i] ?? null,
      })),
    scopeText: scope,
    termsText: typeof contract.termsText === 'string' ? contract.termsText : '',
    warrantyText: typeof contract.warrantyText === 'string' ? contract.warrantyText : '',
    ...(timeline
      ? { startDate: timeline.startDate, durationDays: timeline.durationDays, completionDate: timeline.completionDate }
      : {}),
    allowances: allowances
      .filter(a => a && typeof a.category === 'string')
      .map(a => ({
        category: a.category,
        amount: Math.round((Number(a.amount) || 0) * 100) / 100,
        ...(a.description ? { description: a.description } : {}),
      })),
  };
}

/**
 * Why these terms cannot be signed yet, or null when they can. The page's
 * contractTermsMissing is the same rule; a sign box under a contract with no
 * payment schedule, an unpriced milestone, no scope, or the warranty
 * placeholder would bind the homeowner to terms nobody showed them.
 */
export function portalContractTermsMissing(content: PortalContractContent | undefined | null):
  'no_content' | 'no_schedule' | 'unpriced_milestone' | 'no_scope' | 'warranty_placeholder' | null {
  if (!content || typeof content !== 'object') return 'no_content';
  const schedule = Array.isArray(content.paymentSchedule) ? content.paymentSchedule : [];
  if (schedule.length === 0) return 'no_schedule';
  if (schedule.some(l => typeof l.amount !== 'number' || !Number.isFinite(l.amount))) return 'unpriced_milestone';
  if (typeof content.scopeText !== 'string' || !content.scopeText.trim()) return 'no_scope';
  if (hasWarrantyPlaceholder(content.warrantyText) || hasWarrantyPlaceholder(content.termsText)) return 'warranty_placeholder';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// v12 — THE PROPOSAL THE HOMEOWNER CAN ACCEPT
//
// Until now the client portal was a read-only snapshot with exactly two write
// paths: approve a change order, and pay an invoice. A homeowner could not
// accept the proposal that starts the job — the thing every cheaper competitor
// (Jobber's Client Hub, Housecall Pro, Zuper) lets a customer do in one tap.
//
// What is shared is the CLIENT view of the estimate (utils/clientEstimateView),
// which is a safety boundary: scope rolled up by CSI division with markup
// already baked into each group total, allowances, payment milestones, and a
// line COUNT. Never a unit price, a base cost, a markup rate, or a supplier.
//
// THE PART THAT MATTERS FOR SECURITY. The portal is authenticated by a 192-bit
// token in a link and nothing else, so every byte the browser sends is
// attacker-controlled. `documentText` below is the canonical, order-fixed text
// of exactly what is being accepted, and it is built HERE, on the contractor's
// device, and pushed into `portal_snapshots` with the rest of the snapshot.
// The acceptance RPC re-reads THAT ROW, hashes THAT COPY of the text, and
// refuses any signature whose consent record does not carry that digest — so a
// signature can only ever bind the document the contractor actually published,
// and the dollar figure recorded against the acceptance is the server's, never
// the client's. See supabase/migrations/held/…_portal_proposal_acceptance.sql.
//
// `documentText` therefore MUST be stable across snapshot pushes. It carries no
// wall-clock stamp, and no invite-injected `clientName` (client-portal-setup
// rewrites that field per invite when it builds a link, which would fork the
// hash between the link and the stored row). Everything in it comes from the
// estimate and the project.
// ─────────────────────────────────────────────────────────────────────────────

/** Bumped whenever the canonical record format changes. Stored on the
 *  acceptance row so an old seal stays interpretable.
 *
 *  esign-2 (2026-09-17): the payment lines stopped being MAGE's invented 10%
 *  deposit (clientEstimateView.defaultPaymentSchedule) and became the GC's own
 *  terms, frozen per portal as `proposalPaymentTerms`. The bump is what makes
 *  the old text unsignable: an old build keeps pushing esign-1 with the 10%
 *  deposit, and the portal page and the held acceptance RPC both refuse
 *  anything that is not esign-2 with confirmed terms — so whichever of the web
 *  deploy or the OTA lands first, and however long old devices stay in use,
 *  no homeowner can sign a deposit his contractor never chose. */
export const PROPOSAL_ESIGN_VERSION = 'proposal-esign-2';

/** What the signer affirms. Deliberately describes the ACT and the rights the
 *  homeowner keeps, and cites no statute and claims no legal effect — MAGE
 *  ships without legal review, so it does not state the law. Same rule as
 *  ESIGN_DISCLOSURE_TEXT in utils/portalOwnerCore.ts. */
export const PROPOSAL_DISCLOSURE_TEXT =
  'By typing your legal name, drawing your signature, and selecting "I agree", you consent to accept this proposal electronically. ' +
  'You are accepting the scope and the fixed price shown above as the basis of the work your contractor will do. ' +
  'You may decline instead, or ask for a paper copy at no charge, by messaging your contractor. ' +
  'A copy of this record is retained by your contractor and is available to you on request.';

/** Said next to the button, both on the web portal and in the app. Accepting a
 *  proposal is NOT signing the construction agreement — that is a separate
 *  document with its own signature flow — and this product does not get to
 *  blur the two. */
export const PROPOSAL_NOT_A_CONTRACT_NOTE =
  'Accepting tells your contractor to go ahead and prepare your construction agreement. ' +
  'That agreement is a separate document you will review and sign.';

/** One client-facing scope roll-up line. Markup is already inside `total`. */
export interface PortalProposalScopeLine { key: string; label: string; total: number }
/** One allowance line the homeowner will later spend against. */
export interface PortalProposalAllowance { name: string; amount: number }
/** One payment milestone. `amount` is absent for schedule-only milestones. */
export interface PortalProposalMilestone { label: string; detail: string; amount?: number }

export interface PortalProposal {
  /** The estimate's own id. Echoed by the portal and matched server-side
   *  against the published snapshot before anything is written. */
  id: string;
  /** Record-format version (PROPOSAL_ESIGN_VERSION). */
  version: string;
  /** Header line, e.g. "Proposal for Maple St Reno". */
  title: string;
  /** The fixed price being accepted. Scope groups sum to exactly this. */
  total: number;
  scope: PortalProposalScopeLine[];
  allowances: PortalProposalAllowance[];
  payment: PortalProposalMilestone[];
  /** How many estimate lines rolled up. A count, never the lines. */
  lineCount: number;
  /** The estimate's own createdAt, when it has one. Stable across pushes —
   *  unlike `snapshotAt`, which is why the document uses this one. */
  preparedAt?: string;
  /** The canonical text the signature binds to. See the block comment above. */
  documentText: string;
  /** Present (true) when the portal has no confirmed payment terms yet — a
   *  proposal published before Direction B, or switched on before he answered.
   *  `payment` is then empty, the document says `payment_terms: not_confirmed`,
   *  and the page and the acceptance RPC refuse to let it be accepted. */
  paymentTermsPending?: true;
  /** Whether the portal may draw Accept / Decline at all. The acceptance RPC
   *  (portal_submit_proposal_approval_signed) lives in the HELD migration
   *  supabase/migrations/held/20260913120000_portal_proposal_acceptance.sql,
   *  so today a homeowner who typed a name, drew a signature and tapped
   *  "Sign & accept" got a 404 and "not switched on" AFTER signing (audit #29).
   *  The page requires `true` (proposalCanDecide), so a proposal published
   *  while the RPC is absent is read-only, never a dead end. */
  acceptanceLive: boolean;
}

/**
 * Whether production has the proposal-acceptance RPC. FALSE until the founder
 * applies the held migration (checked read-only 2026-09-18: pg_proc has no
 * portal_submit_proposal_approval_signed). Flip to true in the SAME change
 * that applies it — the portal page and the setup screen both read this, so
 * one line turns acceptance on everywhere, and nothing else has to guess.
 */
export const PORTAL_PROPOSAL_ACCEPTANCE_LIVE = false;

/** The one line the GC sees on the Accept-the-proposal switch while
 *  acceptance is not live. A blocked control says why and names the path
 *  that works today. */
export const PROPOSAL_ACCEPTANCE_OFF_REASON =
  "Online acceptance isn't switched on for your account yet. Send the proposal and collect the signature on the contract.";

/** Collapse whitespace and hard-cap free text, so the same estimate always
 *  produces the same bytes no matter how the contractor typed it. */
function proposalTidy(text: unknown, maxChars: number): string {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, maxChars - 1).trimEnd()}…`;
}

function usd(n: number): string {
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

export interface ProposalDocumentInput {
  proposalId: string;
  projectName: string;
  contractorName: string;
  total: number;
  scope: PortalProposalScopeLine[];
  allowances: PortalProposalAllowance[];
  payment: PortalProposalMilestone[];
  lineCount: number;
  preparedAt?: string;
  /** No confirmed terms: print `payment_terms: not_confirmed`, never lines. */
  paymentTermsPending?: boolean;
}

/**
 * The canonical proposal document. Order-fixed and line-oriented, NOT
 * JSON.stringify over an object literal — the contractor's device, the
 * homeowner's browser and Postgres all have to agree on the exact bytes, and
 * JS key order is not a contract worth betting a signature on. Same shape and
 * same reasoning as buildCOConsentRecord in utils/portalOwnerCore.ts.
 */
export function buildProposalDocumentText(input: ProposalDocumentInput): string {
  const lines = [
    'MAGE ID PROPOSAL — THE DOCUMENT YOU ARE ACCEPTING',
    `version: ${PROPOSAL_ESIGN_VERSION}`,
    `proposal_id: ${proposalTidy(input.proposalId, 200)}`,
    `project: ${proposalTidy(input.projectName, 200)}`,
    `contractor: ${proposalTidy(input.contractorName, 200)}`,
  ];
  if (input.preparedAt) lines.push(`estimate_prepared_at: ${proposalTidy(input.preparedAt, 40)}`);
  lines.push(`project_total_usd: ${usd(input.total)}`);
  for (const g of input.scope) lines.push(`scope: ${proposalTidy(g.label, 200)} — ${usd(g.total)}`);
  for (const a of input.allowances) lines.push(`allowance: ${proposalTidy(a.name, 200)} — ${usd(a.amount)}`);
  // A pending proposal prints the fact that its terms are not confirmed in
  // place of any payment line — so its text can never be mistaken for (or
  // hash the same as) one that states a schedule.
  if (input.paymentTermsPending) lines.push('payment_terms: not_confirmed');
  else for (const m of input.payment) {
    lines.push(typeof m.amount === 'number'
      ? `payment: ${proposalTidy(m.label, 120)} — ${proposalTidy(m.detail, 200)} — ${usd(m.amount)}`
      : `payment: ${proposalTidy(m.label, 120)} — ${proposalTidy(m.detail, 200)}`);
  }
  lines.push(`line_items: ${Math.max(0, Math.round(input.lineCount))}`);
  return lines.join('\n');
}

export interface ProposalConsentRecordInput {
  decision: 'accepted' | 'declined';
  portalId: string;
  proposalId: string;
  proposalTotal: number;
  /** SHA-256 of `documentText`. The server recomputes this from its own copy
   *  of the snapshot and refuses a record that does not carry it. */
  proposalDocumentHash: string;
  signerName: string;
  signedAt: string;
  timezoneOffsetMinutes?: number;
  signatureHash?: string;
  signatureStrokeCount?: number;
  /** Required on a decline; absent on an acceptance. */
  reason?: string;
  userAgent?: string;
}

/** The retainable record. Byte-identical copy lives in marketing/portal/
 *  index.html (the static page has no build step and cannot import this
 *  module); scripts/validate-portal-owner.ts lifts that copy out and runs the
 *  two head-to-head, because a seal that hashes differently in the browser
 *  than in the app is not re-verifiable, which is the whole point. */
export function buildProposalConsentRecord(input: ProposalConsentRecordInput): string {
  const lines = [
    'MAGE ID PROPOSAL ELECTRONIC SIGNATURE RECORD',
    `version: ${PROPOSAL_ESIGN_VERSION}`,
    `decision: ${input.decision}`,
    `portal_id: ${input.portalId}`,
    `proposal_id: ${input.proposalId}`,
    `proposal_total_usd: ${usd(input.proposalTotal)}`,
    `proposal_document_sha256: ${input.proposalDocumentHash}`,
    `signer_name: ${String(input.signerName ?? '').trim()}`,
    `signed_at: ${input.signedAt}`,
  ];
  if (typeof input.timezoneOffsetMinutes === 'number') {
    lines.push(`signer_utc_offset_minutes: ${input.timezoneOffsetMinutes}`);
  }
  if (input.signatureHash) lines.push(`signature_sha256: ${input.signatureHash}`);
  if (typeof input.signatureStrokeCount === 'number') {
    lines.push(`signature_strokes: ${input.signatureStrokeCount}`);
  }
  if (input.reason) lines.push(`decline_reason: ${proposalTidy(input.reason, 600)}`);
  if (input.userAgent) lines.push(`user_agent: ${proposalTidy(input.userAgent, 200)}`);
  lines.push(`consent_disclosure: ${PROPOSAL_DISCLOSURE_TEXT}`);
  return lines.join('\n');
}

/**
 * Why this project cannot put a signable proposal in front of its homeowner,
 * or `undefined` when it can. Independent of `proposalApprovalEnabled` on
 * purpose: this answers "would the switch do anything", so the setup screen
 * can disable it and SAY WHY, and buildPortalProposal can refuse on exactly
 * the same conditions. One function, so the switch and the snapshot can never
 * disagree — before 2026-09-13 they did, and the switch turned on for a
 * project whose proposal the builder then silently refused to emit.
 *
 * `code` is for guards and branching; `gc` is the sentence a contractor reads.
 */
export type ProposalBlockCode =
  | 'no-estimate'
  | 'contract-superseded'
  | 'job-complete'
  | 'scope-unclassified';

export interface ProposalBlock { code: ProposalBlockCode; gc: string }

export function proposalBlockReason(
  project: Project,
  contract?: import('@/types').ProjectContract,
): ProposalBlock | undefined {
  // A construction agreement supersedes the proposal, and the portal already
  // has a signature flow for it; showing both asks the homeowner to sign the
  // same money twice.
  if (contract && (contract.status === 'sent' || contract.status === 'signed')) {
    return {
      code: 'contract-superseded',
      gc: `A construction agreement has already been ${contract.status} on this project — it supersedes the proposal.`,
    };
  }

  // A finished job has nothing to accept. Measured 2026-09-13: without this
  // gate a completed project shipped BOTH the proposal ("accept to get
  // started") and the substantial-completion feedback ask ("your build is
  // finished") into the same page.
  if (project.status === 'completed' || project.status === 'closed'
      || !!toCalendarDate(project.substantialCompletionDate)) {
    return {
      code: 'job-complete',
      gc: 'This job is already recorded as complete, so there is nothing left to accept.',
    };
  }

  // The estimate. No id means nothing stable to bind a signature to; a
  // surrogate would move every time the snapshot is rebuilt.
  const est = project.linkedEstimate;
  if (!est || !est.id || !(est.grandTotal > 0)) {
    return {
      code: 'no-estimate',
      gc: 'Needs a priced estimate on this project — build one and this turns on.',
    };
  }

  // THE SCOPE HAS TO DESCRIBE THE WORK. Measured 2026-09-13 against the app's
  // own primary builders: app/(tabs)/estimate/full.tsx buildLinkedEstimate
  // sets `csiDivision` on no item, and app/(tabs)/estimate/review.tsx sets it
  // to `undefined` on every labor and every assembly row. groupByCSIDivision
  // therefore buckets the whole job into `__unassigned__`, and a $400,000
  // estimate came out as ONE line — `scope: Other scope — 400000.00` — which
  // is the text a homeowner's signature would have bound to. An estimate that
  // prices to a positive total but whose items all price to zero produced NO
  // scope lines at all, under a consent box reading "you are accepting the
  // scope and the fixed price shown above".
  //
  // Neither is a scope description, so neither gets to be signed. This refuses
  // rather than papering over it, and the setup row says which one it is.
  const view = toClientEstimateView(est);
  if (!(view.projectTotal > 0)) {
    return {
      code: 'no-estimate',
      gc: 'Needs a priced estimate on this project — build one and this turns on.',
    };
  }
  const priced = view.scopeGroups.filter(g => g.total !== 0);
  const onlyUnassigned = priced.length === 0
    || (priced.length === 1 && priced[0].key === 'other');
  if (onlyUnassigned) {
    return {
      code: 'scope-unclassified',
      gc: 'Your estimate lines are not assigned to trades, so the proposal would read "Other scope" for the whole price. Assign CSI divisions on the estimate and this turns on.',
    };
  }

  return undefined;
}

/**
 * Build the acceptable proposal, or `undefined` when there is nothing to
 * accept. Two gates: the GC's explicit opt-in (putting a signable price in
 * front of a homeowner is not something a section-visibility toggle gets to do
 * by accident), and proposalBlockReason above.
 */
/**
 * The completion ask, or `undefined`. Two conditions, both about not asking
 * into thin air:
 *
 *  1. the GC recorded a substantial-completion date. This is his own entry
 *     (project.substantialCompletionDate — the same field retainage release
 *     and the closeout binder key on), not something inferred from a schedule
 *     that may never have been updated;
 *  2. that date has arrived. Asking "how did it go" before the job is done is
 *     worse than not asking.
 *
 * `today` comes from the clock, like buildOwnerDecisions' does. That makes the
 * field time-varying, which is fine — unlike the proposal, nothing hashes it.
 */
export function buildFeedbackAsk(
  project: Project,
  portal: ClientPortalSettings,
  today: string = new Date().toISOString().slice(0, 10),
): { completedOn: string } | undefined {
  if (!portal.enabled) return undefined;
  const completedOn = toCalendarDate(project.substantialCompletionDate);
  if (!completedOn) return undefined;
  if (completedOn > today) return undefined;
  return { completedOn };
}

export function buildPortalProposal(opts: {
  project: Project;
  portal: ClientPortalSettings;
  contractorName: string;
  contract?: import('@/types').ProjectContract;
}): PortalProposal | undefined {
  const { project, portal, contractorName, contract } = opts;
  if (!portal.proposalApprovalEnabled) return undefined;
  if (proposalBlockReason(project, contract)) return undefined;

  // Non-null by the gate above: proposalBlockReason returns 'no-estimate' for
  // every shape this could be missing on.
  const est = project.linkedEstimate!;
  const view = toClientEstimateView(est);

  const scope: PortalProposalScopeLine[] = view.scopeGroups.map(g => ({
    key: g.key, label: g.label, total: g.total,
  }));
  const allowances: PortalProposalAllowance[] = view.allowances.map(a => ({
    name: a.name, amount: a.amount,
  }));
  // THE PAYMENT SCHEDULE IS THE PORTAL'S STAMP, AND NOTHING ELSE. Not the
  // GC's current settings: both snapshot writers (the rich push from portal
  // setup and the lite push on every project open) must publish the same
  // bytes, and a change under Company Profile must never rewrite text a
  // homeowner may be about to sign. The stamp only ever copies his saved terms
  // at the moment he switches the proposal on or confirms it
  // (app/client-portal-setup.tsx). No stamp → no lines, and pending.
  const stamp = portal.proposalPaymentTerms;
  const paymentTermsPending = !isValidStamp(stamp);
  const payment: PortalProposalMilestone[] = paymentTermsPending
    ? []
    : proposalPaymentLines(view.projectTotal, stamp).map(m => ({
      label: m.label,
      detail: m.detail,
      ...(m.amount !== undefined ? { amount: m.amount } : {}),
    }));

  const documentText = buildProposalDocumentText({
    proposalId: est.id,
    projectName: project.name,
    contractorName,
    total: view.projectTotal,
    scope,
    allowances,
    payment,
    lineCount: view.itemCount,
    preparedAt: est.createdAt,
    paymentTermsPending,
  });

  return {
    id: est.id,
    version: PROPOSAL_ESIGN_VERSION,
    title: `Proposal for ${project.name}`,
    total: view.projectTotal,
    scope,
    allowances,
    payment,
    lineCount: view.itemCount,
    preparedAt: est.createdAt,
    documentText,
    ...(paymentTermsPending ? { paymentTermsPending: true as const } : {}),
    acceptanceLive: PORTAL_PROPOSAL_ACCEPTANCE_LIVE,
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
  // Project warranties — used by the closeout block AND, before a binder
  // exists, by the Documents section (see buildPortalDocuments).
  warranties?: import('@/types').Warranty[];
  // Project permits. The only homeowner-facing paper trail the portal had no
  // section for at all — the "Documents" switch promised them and shipped an
  // empty array instead.
  permits?: import('@/types').Permit[];
  // Baked Home Passport (pre-answered FAQ + summary counts), loaded from
  // utils/passport/passportStore. Omitted when the GC never generated one.
  homePassport?: import('./passport/types').BakedHomePassport | null;
  // The seven actual-cost streams Job Costing prices (receipts, priced crew
  // hours + rates + OT multiplier, equipment, permits, the sub roster). The
  // open-book / GMP block used to call computeJobCost without them, so an
  // open-book client was shown a cost-to-date built from SUBCONTRACTS ALONE:
  // a self-perform GC's own crew hours and material receipts were missing from
  // the very number the mode exists to disclose (audit round 2, #16).
  // Absent, the block is still built — the engine's own subcontract-only
  // behaviour — because an open-book client seeing nothing is worse than one
  // seeing the committed picture. client-portal-setup (the rich writer) passes
  // it; project-detail's lite writer passes no commitments, so it never builds
  // this block and carries the last rich one forward instead.
  costSources?: import('./jobCostEngine').JobCostActualSources;
}

/**
 * PORTAL-01 — duration-weighted percent of the schedule's work that is
 * complete, or `null` when the GC has recorded no progress at all.
 *
 * `computeProjectProgress` returns 0 for two different situations the portal
 * must not conflate: "the job genuinely has not started" and "nobody has ever
 * touched this schedule". The client portal is read by a homeowner who cannot
 * tell them apart, so the snapshot reports `null` unless at least one
 * non-milestone task carries a real signal — progress above zero, or a status
 * of in_progress / done. Verified against production on 2026-09-06: the
 * founder's Henderson portal has 20 tasks, every one `not_started` with
 * progress 0, on a job that is fully billed and fully paid. "0% complete" on
 * that page would be an invented fact; "—" is the absent one.
 *
 * Exported so scripts/validate-portal-owner.ts can hold the static portal's
 * hand-written copy of this rollup head-to-head against it (the portal HTML
 * has no build step and cannot import TypeScript).
 */
export function scheduleWorkComplete(project: Project): number | null {
  const tasks = (project.schedule?.tasks ?? []).filter(t => !t.isMilestone);
  const started = tasks.some(
    t => (t.progress ?? 0) > 0 || t.status === 'in_progress' || t.status === 'done',
  );
  if (!started) return null;
  const p = computeProjectProgress(project);
  if (!p.hasSchedule) return null;
  return Math.max(0, Math.min(100, p.pct));
}

/**
 * PORTAL-FINISH — THE scheduled finish date of a schedule. One convention,
 * one call site, so the hero and the Gantt lower down the SAME portal page
 * cannot print two different days.
 *
 * Three separate things were wrong with what the hero used to do
 * (`new Date(startDate).getTime() + totalDurationDays * 86400000`):
 *
 *  1. IT COUNTED CALENDAR DAYS OFF A WORKING-DAY NUMBER. `totalDurationDays`
 *     is a WORKING-day ordinal — `buildSchedule` sets it to `projectFinishDay`
 *     (utils/scheduleEngine.ts) and every other consumer advances it with
 *     `addWorkingDays`, which skips weekends and `nonWorkingDates`. Adding it
 *     as calendar days makes a 5-day-week job finish ~40% early: a
 *     100-working-day project read roughly six weeks sooner than the schedule
 *     actually said. This is the first date a homeowner reads on a page their
 *     GC sent them, and it is the one they book a lease end, a move-out or a
 *     closing around.
 *  2. OFF BY ONE. It is an ordinal, not a count of days to add: day 1 IS the
 *     start date, so the finish is `addWorkingDays(start, ordinal - 1, …)`.
 *     Dropping the `- 1` pushes the date one working day past the plan — the
 *     error the portal's own Gantt had, in the opposite direction.
 *  3. IT IGNORED THE TASKS. `totalDurationDays` is a cached scalar that legacy
 *     and hand-edited schedules can carry stale; the authored
 *     `startDay`/`durationDays` ARE the plan (CPM is analysis). We derive the
 *     finish ordinal from the tasks and fall back to the scalar only when the
 *     schedule has no tasks to derive it from.
 *
 * The maths is DELIBERATELY identical to `buildOwnerConfidence`'s
 * `projectedFinishISO` (utils/ownerConfidence.ts:87-104) — same
 * `max(startDay + durationDays - 1)`, same `addWorkingDays(start, ordinal - 1,
 * wpw, nonWorkingDates)`, same LOCAL-midnight anchor and local ISO formatting
 * — so the date the homeowner reads is the date the GC reads in-app.
 * scripts/validate-portal-owner.ts holds the two head-to-head, and holds the
 * static portal page's hand-written copy of the same maths against both.
 *
 * Returns null when there is no usable start anchor or nothing to count.
 * Callers MUST NOT substitute today: a guessed completion date presented as a
 * known one is exactly the failure this function exists to end.
 */
export function scheduleFinishDate(
  schedule: Pick<
    ProjectSchedule,
    'startDate' | 'tasks' | 'totalDurationDays' | 'workingDaysPerWeek' | 'nonWorkingDates'
  > | null | undefined,
): string | null {
  if (!schedule) return null;
  // Normalize first — `startDate` is documented as YYYY-MM-DD but older rows
  // carry full ISO timestamps, and `new Date('2026-03-14')` is UTC midnight
  // while addWorkingDays reads getDay()/setDate() in LOCAL time. West of UTC
  // that pair lands on the previous calendar day and can skip a weekend it
  // should not have. toCalendarDate gives us the plain day; we anchor it at
  // local midnight so every step after this is in one timezone.
  const anchor = toCalendarDate(schedule.startDate);
  if (!anchor) return null;
  const start = new Date(`${anchor}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;

  const tasks = schedule.tasks ?? [];
  let finishOrdinal = 0;
  for (const t of tasks) {
    const endDay = (t.startDay ?? 1) + Math.max(0, (t.durationDays ?? 1) - 1);
    if (endDay > finishOrdinal) finishOrdinal = endDay;
  }
  // No tasks to read (a schedule shell, or a snapshot that shipped only the
  // scalar): fall back to the cached finish ordinal rather than returning
  // nothing. Same ordinal scale, same -1 below.
  if (finishOrdinal <= 0) finishOrdinal = schedule.totalDurationDays ?? 0;
  if (finishOrdinal <= 0) return null;

  try {
    const finish = addWorkingDays(
      start,
      Math.max(0, finishOrdinal - 1),
      schedule.workingDaysPerWeek ?? 5,
      schedule.nonWorkingDates,
    );
    // Local formatting, to match the local anchor above. `.toISOString()`
    // here would shift the day back across the date line for any user west
    // of UTC — the same class of bug the anchor comment describes.
    return `${finish.getFullYear()}-${String(finish.getMonth() + 1).padStart(2, '0')}-${String(finish.getDate()).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/**
 * Is the closeout binder one the homeowner can see?
 *
 * Extracted because TWO sections now depend on the answer: the `closeout`
 * block itself, and the Documents section, which drops warranties once the
 * binder is live so the same warranty roster does not print twice on one page.
 * Two copies of `status !== 'finalized' && status !== 'sent'` would drift.
 */
export function closeoutIsShared<T extends { status?: string }>(
  binder: T | null | undefined,
): binder is T & { status: 'finalized' | 'sent' } {
  return !!binder && (binder.status === 'finalized' || binder.status === 'sent');
}

/** Homeowner words for a PermitType. The raw union values ('special_inspection',
 *  'hot_work') are trade shorthand; this page is read by someone who has never
 *  pulled a permit. Anything unmapped degrades to the raw token with its
 *  underscores removed rather than to a guess. */
const PERMIT_TYPE_LABEL: Record<string, string> = {
  building: 'Building', electrical: 'Electrical', plumbing: 'Plumbing',
  mechanical: 'Mechanical', demolition: 'Demolition', grading: 'Grading',
  fire: 'Fire', occupancy: 'Certificate of occupancy',
  special_inspection: 'Special inspection', hot_work: 'Hot work',
  shutdown: 'Utility shutdown', after_hours: 'After-hours work',
  landlord_approval: 'Landlord approval', elevator_dock: 'Elevator / loading dock',
  other: 'Permit',
};

/** Homeowner words for a PermitStatus. Stated, never inferred: 'applied' is
 *  "Applied for", not "Pending approval" — the portal does not know whether
 *  the jurisdiction has looked at it. */
const PERMIT_STATUS_LABEL: Record<string, string> = {
  applied: 'Applied for', under_review: 'Under review', approved: 'Approved',
  denied: 'Denied', expired: 'Expired',
  inspection_scheduled: 'Inspection scheduled',
  inspection_passed: 'Inspection passed',
  inspection_failed: 'Inspection failed',
};

/**
 * The Documents section — the records the homeowner can see, and nothing else.
 *
 * WHAT WENT WRONG. `if (portal.showDocuments) { sections.documents = []; }`,
 * with a "stub for now" comment, shipped for the whole life of the portal. The
 * static page skips a zero-length section, so the switch labelled "Documents —
 * Contracts, lien waivers, permits" produced no visible change and no warning.
 * The GC believed they had shared the permit and the warranty; the owner asked
 * for them by email anyway. Worse at the moment it matters most: a warranty
 * claim two years on, when the closeout binder was the only place a warranty
 * ever lived and the binder only exists after the job is finalized.
 *
 * WHAT IT IS NOT.
 *  - Not the contract. `sections`' sibling `contract` block already renders a
 *    contract card at the top of the page (addSection('contract', …) in
 *    marketing/portal/index.html). Listing it here prints it twice.
 *  - Not the closeout binder, for the same reason — it has its own `closeout`
 *    block and its own section.
 *  - Not COIs or submittals. Trade paperwork; the homeowner is not a party to
 *    it and it carries sub names and coverage limits.
 *  - Not a download list. Nothing in this repo writes a permit attachment, and
 *    `Warranty.documentUri` has no writer either (see
 *    utils/passport/consumerPassport.ts:529). These rows are RECORDS — a live
 *    link that 404s is worse than a row that never promised one.
 *
 * Exported so scripts/validate-portal-owner.ts can pin the projection without
 * assembling a whole snapshot.
 */
export function buildPortalDocuments(input: {
  projectId: string;
  permits?: Pick<Permit, 'projectId' | 'type' | 'status' | 'permitNumber' | 'jurisdiction' | 'appliedDate' | 'approvedDate' | 'expiresDate'>[];
  warranties?: Pick<Warranty, 'projectId' | 'title' | 'category' | 'provider' | 'startDate' | 'endDate' | 'portalState'>[];
  /** True once the closeout block ships — warranties move there. */
  closeoutShared: boolean;
}): NonNullable<PortalSnapshot['sections']['documents']> {
  const out: NonNullable<PortalSnapshot['sections']['documents']> = [];

  // Permits. Every permit on the project: an owner is entitled to know a
  // permit was applied for and denied, not only the ones that went through.
  for (const p of input.permits ?? []) {
    if (p.projectId !== input.projectId) continue;
    const kind = PERMIT_TYPE_LABEL[p.type] ?? String(p.type ?? '').replace(/_/g, ' ');
    out.push({
      name: p.permitNumber ? `${kind} permit #${p.permitNumber}` : `${kind} permit`,
      type: p.jurisdiction?.trim() || undefined,
      // The approval is the date the owner cares about; before approval the
      // only fact is the application date, and we say which one it is via
      // `status` rather than labelling an application as an approval.
      dateSent: p.approvedDate || p.appliedDate || undefined,
      status: PERMIT_STATUS_LABEL[p.status] ?? undefined,
      expiresOn: p.expiresDate || undefined,
    });
  }

  // Warranties the GC actually SENT to the portal. `isShared` is deliberately
  // NOT used here: it treats a MISSING portalState as shared (grandfathered
  // rows in sections whose whole collection was already client-facing), and a
  // warranty the GC never pushed is not one of those. Only an explicit 'sent'.
  //
  // Suppressed once the closeout binder ships, because the binder block
  // carries the full warranty roster with durations and the portal renders it
  // as its own section — two copies of the same roster on one page.
  if (!input.closeoutShared) {
    for (const w of input.warranties ?? []) {
      if (w.projectId !== input.projectId) continue;
      if (w.portalState?.status !== 'sent') continue;
      out.push({
        name: w.title?.trim() || w.category || 'Warranty',
        type: w.provider?.trim() || undefined,
        dateSent: w.startDate || undefined,
        // "In force" / "Expired" is derived from the end date alone, which is
        // a fact on the row. `Warranty.status` is a GC-side workflow value
        // ('claimed', 'void') and is not the owner's business.
        status: w.endDate
          ? (w.endDate < new Date().toISOString().slice(0, 10) ? 'Expired' : 'In force')
          : undefined,
        expiresOn: w.endDate || undefined,
      });
    }
  }

  return out;
}

/**
 * WHEN was this invoice actually paid — as recorded, never as guessed.
 *
 * An `Invoice` has no paid-date column; the only evidence is `payments[]`. Two
 * things were wrong with reading it inline:
 *
 *  1. `payments[payments.length - 1]` is the LAST ELEMENT, not the latest
 *     date. Payments are appended in entry order, so a bookkeeper who back-
 *     enters a cheque received on the 3rd after recording a card payment on
 *     the 14th made the certificate say "Paid the 3rd".
 *  2. Falling back to `issueDate` when there are no payments at all invents a
 *     payment date out of a billing date, on a client-facing document.
 *
 * Returns undefined when nothing was recorded. The portal has honest copy for
 * that ("Settled with invoice"), which is only reachable while this stays
 * undefined — see the paidAt comment in the AIA section below.
 */
/**
 * The CO's frozen sales tax and tax-inclusive total, for the portal card and
 * the e-sign consent record (#131) — both present and finite, tax non-zero, or
 * neither. Exported for scripts/validate-client-portal-lane.ts.
 */
export function coTaxForPortal(co: unknown): { taxAmount?: number; totalWithTax?: number } {
  const c = (co ?? {}) as { taxAmount?: unknown; totalWithTax?: unknown };
  const tax = typeof c.taxAmount === 'number' && Number.isFinite(c.taxAmount) ? c.taxAmount : null;
  const total = typeof c.totalWithTax === 'number' && Number.isFinite(c.totalWithTax) ? c.totalWithTax : null;
  if (tax == null || total == null || Math.abs(tax) < 0.005) return {};
  return { taxAmount: roundCents(tax), totalWithTax: roundCents(total) };
}

export function latestPaymentDate(
  invoice: Pick<Invoice, 'payments'> | undefined,
): string | undefined {
  // #133: the day the money was RECEIVED — his picked day when he recorded
  // one, else the local day the payment was recorded — as a bare YYYY-MM-DD.
  // The raw `date` is the moment he tapped Save: a check received Friday and
  // entered Monday evening printed "Paid Tuesday" (UTC) on a client-facing
  // certificate. Bare days sort correctly as strings; the portal's fmtDate
  // reads a bare day as that local day.
  const days = (invoice?.payments ?? [])
    .map(p => (p ? paymentReceivedDay(p as InvoicePayment & RecordedPaymentFields) : null))
    .filter((d): d is string => typeof d === 'string' && d !== '')
    .sort();
  return days.length ? days[days.length - 1] : undefined;
}

/**
 * #51 (export audit) · Where the SCHEDULE ENGINE puts each task, in the
 * portal's own units, instead of the stored `startDay` pin. A pin that
 * dependencies (or a slipped predecessor) have pushed later read a week early
 * on the homeowner's Gantt, hero finish and milestone dates while the app
 * showed the real ones. Same rule as utils/subPortalSnapshot: the page walks
 * startDay/durationDays in WORKING days, so a dated run's calendar es/ef is
 * converted to working ordinals; an undated run is already in working days.
 * A task the engine could not place (a cycle, a throw) keeps its stored pin,
 * so this never invents a date the data does not support.
 */
export function portalPlacedTasks<T extends Pick<ScheduleTask, 'id' | 'startDay' | 'durationDays' | 'isMilestone'>>(
  schedule: { tasks?: T[]; startDate?: string; workingDaysPerWeek?: number; nonWorkingDates?: string[] } | null | undefined,
): (T & { startDay: number; durationDays: number })[] {
  const tasks = schedule?.tasks ?? [];
  if (!schedule || tasks.length === 0) return [];
  const startIso = calendarDayOf(schedule.startDate);
  const dayOpts = {
    scheduleStartDate: startIso && parseCalendarDay(startIso) ? startIso : undefined,
    workingDaysPerWeek: schedule.workingDaysPerWeek || 5,
    nonWorkingDates: schedule.nonWorkingDates ?? [],
  };
  let perTask: Map<string, { es: number; ef: number }> = new Map();
  try {
    perTask = runCpm(tasks as unknown as ScheduleTask[], dayOpts).perTask as Map<string, { es: number; ef: number }>;
  } catch { /* keep the pins */ }
  return tasks.map(t => {
    const r = perTask.get(t.id);
    if (!r || !Number.isFinite(r.es) || !Number.isFinite(r.ef)) {
      return { ...t, startDay: t.startDay ?? 0, durationDays: t.durationDays ?? 0 };
    }
    if (!dayOpts.scheduleStartDate) {
      return { ...t, startDay: r.es, durationDays: t.isMilestone ? (t.durationDays ?? 0) : Math.max(1, r.ef - r.es + 1) };
    }
    const s0 = calendarIndexToWorkingOrdinal(r.es, dayOpts);
    const e0 = calendarIndexToWorkingOrdinal(Math.max(r.es, r.ef), dayOpts);
    return { ...t, startDay: s0, durationDays: t.isMilestone ? (t.durationDays ?? 0) : Math.max(1, e0 - s0 + 1) };
  });
}

export function buildPortalSnapshot(opts: BuildOpts): PortalSnapshot {
  const {
    project, portal, settings, invoices = [], changeOrders = [],
    dailyReports = [], punchItems = [], photos = [], rfis = [],
    aiaPayApps = [], invite, messages = [],
    supabaseUrl, supabaseAnonKey, contactEmail, contactName,
    maxPhotos = 24, maxDailyReports = 10, maxAIAPayApps = 6,
    maxInvoiceLines = PORTAL_MAX_INVOICE_LINES, maxMessages = 20,
  } = opts;

  const sections: PortalSnapshot['sections'] = {};

  // Schedule — includes anchors (project start date + working days) +
  // per-task startDay so the portal can render a real Gantt with dates
  // instead of a flat task list.
  // #51: every date this snapshot prints comes from the engine's placement,
  // not the stored pins (portalPlacedTasks) — Gantt bars, hero finish and the
  // period milestones agree with each other and with the app.
  const placedTasks = portalPlacedTasks(project.schedule);
  if (portal.showSchedule && project.schedule?.tasks?.length) {
    sections.schedule = {
      startDate: project.schedule.startDate,
      workingDaysPerWeek: project.schedule.workingDaysPerWeek,
      totalDurationDays: project.schedule.totalDurationDays,
      // Omitted when empty so we don't grow every portal URL's base64 payload
      // with `"nonWorkingDates":[]` — the page treats absent and empty alike.
      ...(project.schedule.nonWorkingDates?.length
        ? { nonWorkingDates: project.schedule.nonWorkingDates }
        : {}),
      tasks: placedTasks.map(t => ({
        id: t.id,
        title: t.title,
        phase: t.phase,
        progress: t.progress ?? 0,
        status: t.status,
        durationDays: t.durationDays,
        startDay: t.startDay,
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
    const contractValue = roundCents(baseContract + coTotal);
    // Cash actually received, tax included. Deliberately summed over EVERY
    // invoice rather than the visible subset below: money the client has sent
    // is money they have sent, and dropping a payment from this total because
    // the GC later recalled the document it paid would understate the
    // homeowner's own credit. Matches utils/projectFinancials.getPaidToDate.
    const paidToDate = roundCents(getPaidToDate(invoices));

    // ONE population for every "what is owed" figure. `sections.invoices`
    // below renders `invoices.filter(i => isShared(i.portalState))`, so the
    // headline must not reach past it:
    //  - a DRAFT invoice was never issued. This app's own definition of the
    //    word excludes them everywhere else (getOutstandingBalance,
    //    getInvoicedToDate, ProjectContext.getTotalOutstandingBalance), and
    //    billing a homeowner for a draft is a number the contractor's own
    //    project screen would contradict.
    //  - a RECALLED invoice is one the GC deliberately pulled back; the
    //    portal tells the client it was removed. Summing it here would both
    //    charge for a withdrawn document and disclose its dollar amount.
    const billedInvoices = invoices.filter(
      i => isShared(i.portalState) && i.status !== 'draft',
    );

    // PORTAL-01 (runtime audit 2026-09-06). `outstanding` was
    // `contractValue - paidToDate`: tax-INCLUSIVE cash subtracted from a
    // PRE-TAX contract. On the founder's live Henderson portal that showed
    // $0 outstanding on a contract with $2.4K of work still un-billed, and
    // because `paid + outstanding` then collapsed to exactly `contractValue`,
    // the portal's money bar could never draw anything but a full bar.
    // Outstanding is now the one figure a homeowner can act on, on one basis:
    // billed and not yet paid, net of the retention the contract lets them
    // hold (MONEY-F5) — via the house helper, so it cannot drift from the
    // figure the GC sees on the same job.
    const outstanding = roundCents(getOutstandingBalance(billedInvoices));
    // The other two legs of that same bar, on that same basis.
    const invoicedToDate = roundCents(getInvoicedToDate(billedInvoices));
    const retentionHeld = roundCents(getRetentionHeld(billedInvoices));
    sections.budget = {
      contractValue,
      paidToDate,
      outstanding,
      invoicedToDate,
      retentionHeld,
      // PORTAL-01: the headline stat means what its label says. See
      // scheduleWorkComplete — `null` when the app has no progress to report.
      workComplete: scheduleWorkComplete(project),
    };
  }

  // Invoices — v2 includes line items + payment terms so the portal can show
  // a real invoice detail drawer (clickable rows, "Pay Now" CTA, breakdown).
  if (portal.showInvoices) {
    const visibleInvoices = invoices.filter(i => isShared(i.portalState));
    if (visibleInvoices.length) {
      sections.invoices = visibleInvoices.map(i => renderSerialized('invoice', i, (inv) => {
        const total = inv.totalDue ?? 0;
        const amountPaid = inv.amountPaid ?? 0;
        // MONEY-F5: the balance the client sees is net of held retention.
        const balance = invoiceOutstanding(inv);
        // MONEY-05: the client's drawer shows the withholding the shared helper
        // computes (percentage of work value), never the stored column — the
        // portal was showing a homeowner $4,063.23 held on an invoice whose Pay
        // button charged a balance computed on $3,779.75.
        const retentionWithheld = effectiveRetentionHeld(inv);
        const retentionHeld = pendingRetentionHeld(inv);
        // MONEY-F2 (client half): a Stripe Payment Link charges the ONE amount
        // it was minted for, every time it is opened. After a net-of-retention
        // payment the old link would charge the pre-payment figure again, so
        // the portal gets a Pay button only while the minted amount is still
        // exactly what is owed. A link with no recorded amount (minted before
        // pay_link_amount existed) is hidden until the GC regenerates it.
        const payLinkUrl =
          inv.payLinkUrl && balance > 0
          && inv.payLinkAmount != null
          && Math.abs(inv.payLinkAmount - balance) <= 0.01
            ? inv.payLinkUrl
            : undefined;
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
          retentionHeld: retentionHeld > 0 ? retentionHeld : undefined,
          payLinkUrl,
          amountPaid,
          issueDate: inv.issueDate,
          lineItems,
          retentionPercent: inv.retentionPercent,
          // The EFFECTIVE withholding, not the stored column. Older portal
          // builds fall back to `retentionAmount − retentionReleased` when the
          // snapshot carries no `retentionHeld`, and shipping the stale stored
          // figure here would reintroduce the disagreement on exactly the
          // clients running an old cached page (MONEY-05).
          retentionAmount: retentionWithheld > 0 ? retentionWithheld : undefined,
          retentionReleased: inv.retentionReleased,
          // The status the app shows the GC — so the client's pill agrees
          // with it (overdue past due; paid once the net balance is covered;
          // reopened when a release puts a balance back on a stored 'paid').
          effectiveStatus: getEffectiveInvoiceStatus(inv),
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
      // The invoice a pay application certifies. One billing period is ONE
      // obligation, however many documents describe it.
      const invoiceById = new Map(invoices.map(i => [i.id, i]));
      sections.aiaPayApps = sorted.slice(0, maxAIAPayApps).map(a => renderSerialized('aia_pay_app', a, (app) => {
        // `paidAt` is hydrated from aia_pay_apps.paid_at by the context mapper
        // (MONEY-F1/F16); read defensively so an older local record is just "unpaid".
        const paidAt = (app as SavedAIAPayApp & { paidAt?: string }).paidAt || undefined;
        const due = app.totals.currentPaymentDue;
        // MONEY-F2 (AIA half) — the guard the invoice button has had since
        // MONEY-F2 was opened, and the AIA button never got. A Stripe Payment
        // Link charges the ONE amount it was minted for, every time it is
        // opened, so a link whose minted amount no longer equals what is owed
        // keeps collecting the old figure. A link with no recorded amount is
        // hidden, full stop — and that IS a dead end, not a temporary one: a
        // record carrying a payLinkUrl is locked in app/aia-pay-app.tsx, which
        // refuses to save, so there is no re-save that would regenerate it.
        // Only rows minted before create-payment-link wrote pay_link_amount
        // (or while migration 20260904100100 was unapplied, when that PATCH
        // failed non-fatally) can be in this state. The screen names the state
        // rather than leaving an unpayable card unexplained; hiding the button
        // stays correct either way, because a Payment Link charges the one
        // amount it was minted for and this row cannot say what that was.
        const amountStillMatches = app.payLinkAmount != null
          && Math.abs(app.payLinkAmount - due) <= 0.01;
        // THE SECOND PAY BUTTON. Paying the INVOICE credits it and nulls the
        // invoice's own pay link, but nothing on the server clears the AIA
        // side (stripe-webhook creditInvoice touches only `invoices`), so a
        // bookkeeper who paid the invoice was left looking at a live Pay
        // button for the same money — and the two links need not even be for
        // the same amount. A certificate and the invoice it certifies are one
        // obligation, so the portal refuses to offer payment for a period
        // whose invoice is settled, whatever the AIA row still says.
        //
        // The server half now exists too — stripe-webhook's creditInvoice
        // stamps paid_at, nulls the AIA pay_link_* columns and deactivates the
        // Stripe link for every unpaid pay app on the invoice. This check
        // stays, and matters: a snapshot published or emailed BEFORE the
        // payment carries the pre-payment AIA row, and the portal renders
        // whatever it was handed.
        const sourceInvoice = app.invoiceId ? invoiceById.get(app.invoiceId) : undefined;
        const sourceInvoiceSettled = !!sourceInvoice && invoiceOutstanding(sourceInvoice) <= 0.01;
        const payLinkUrl = paidAt || sourceInvoiceSettled || due <= 0 || !amountStillMatches
          ? undefined
          : app.payLinkUrl;
        return {
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
        payLinkUrl,
        payLinkAmount: app.payLinkAmount,
        invoiceId: app.invoiceId,
        // A period whose INVOICE was paid is settled even though the AIA row
        // carries no paid_at of its own. Say so, rather than leaving the card
        // looking merely unpayable.
        //
        // NEVER INVENT A PAYMENT DATE (review 2026-09-11). This used to fall
        // back to the invoice's ISSUE date when the invoice was settled with no
        // recorded payments — an invoice marked paid by hand, or one whose
        // payments predate the payments[] array — so a client-facing
        // certificate printed "Paid March 3" naming the day the GC BILLED him.
        // A fabricated date on a document a bank reads is worse than no date,
        // and the portal already has honest copy for the no-date case:
        // `aiaIsPaid` is true from the invoice's own balance, so the card reads
        // "Settled with invoice" and the drawer "Settled — this period was paid
        // on the invoice". Leaving this undefined is what makes that copy
        // reachable; before the fix it was dead code.
        paidAt: paidAt ?? (sourceInvoiceSettled ? latestPaymentDate(sourceInvoice) : undefined),
        lines: app.lines.map(l => ({
          itemNo: l.itemNo,
          description: l.description,
          scheduledValue: l.scheduledValue,
          fromPreviousApp: l.fromPreviousApp,
          thisPeriod: l.thisPeriod,
          materialsPresentlyStored: l.materialsPresentlyStored,
          retainagePercent: l.retainagePercent,
        })),
        };
      })) as PortalSnapshot['sections']['aiaPayApps'];
    }
  }

  // Change Orders
  if (portal.showChangeOrders) {
    const visibleCOs = changeOrders.filter(c => isShared(c.portalState));
    if (visibleCOs.length) {
      sections.changeOrders = visibleCOs.map(c => renderSerialized('change_order', c, (co) => ({
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
        // #131: the tax-inclusive total the CO screen promises is the one the
        // client approves. Only when the CO carries a frozen, non-zero tax —
        // a figure computed here from today's settings could disagree with
        // the invoice that later bills it. Read defensively: the fields are
        // optional and older rows have neither.
        ...coTaxForPortal(co),
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
      sections.photos = (sorted.slice(0, maxPhotos).map(p => renderSerialized('photo', p, (photo) => ({
        id: p.id, // the live row's id, never a frozen copy's
        // #14: `uri` on the GC's own phone is the local file:// original (and
        // a 24-hour signed link everywhere else), so publishing it gave the
        // homeowner a broken image. The page asks signed-media-urls for the
        // id; `url` survives only as a legacy http(s) link.
        ...portalPhotoSource(photo),
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
      }))) as PortalSnapshot['sections']['photos'])?.filter(p => p != null && (!!p.id || !!p.url));
    }
  }

  // Daily Reports (limit — most recent first)
  if (portal.showDailyReports) {
    const visibleDFRs = dailyReports.filter(d => isShared(d.portalState));
    if (visibleDFRs.length) {
      // dayOrInstantDate: older voice builds saved a bare YYYY-MM-DD, which
      // new Date() reads as UTC midnight — the day before, west of Greenwich.
      const dfrTime = (v: string | undefined) => {
        const t = v ? dayOrInstantDate(v).getTime() : 0;
        return Number.isFinite(t) ? t : 0;
      };
      const sorted = [...visibleDFRs].sort((a, b) => dfrTime(b.date) - dfrTime(a.date));
      sections.dailyReports = sorted.slice(0, maxDailyReports).map(d => renderSerialized('daily_report', d, (dfr) => {
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
        // The portal formats this with new Date(iso), so a bare day is sent as
        // that day's local noon instant; a stored instant passes through.
        const day = dfr.date ? dayOrInstantDate(dfr.date) : null;
        return {
          id: dfr.id,
          date: day && Number.isFinite(day.getTime()) ? day.toISOString() : dfr.date,
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
    //
    // And only the FORMAL punch list. A crew-list item ("sweep the corridor",
    // "patch the scuff behind the door") is the builder's internal working
    // checklist — publishing it would put housekeeping on the client's project
    // page and dilute the list they are actually holding the builder to.
    // punchListTypeOf resolves an absent value to 'punch', so every item that
    // predates the split stays on the portal exactly as before. The SUB portal
    // (utils/subPortalSnapshot.ts) deliberately does NOT filter this: a crew
    // item assigned to a sub is precisely that sub's work.
    //
    // #9 (wave 5): and never a Cost X-Ray verify task. Each accepted tell makes
    // one ('Verify before demo/order: Possible knob-and-tube behind panel'),
    // stamped xray.clientVisible === false because its text IS the GC-only
    // finding the estimate folds into 'Contingency'. It has no listType, so
    // the formal-punch filter alone let the finding onto the homeowner's page.
    const activePunch = punchItems.filter(
      p => punchListTypeOf(p) === 'punch'
        && p.xray?.clientVisible !== false
        && (p.status === 'open' || p.status === 'in_progress' || p.status === 'ready_for_review')
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
      sections.rfis = visibleRFIs.map(r => renderSerialized('rfi', r, (rfi) => ({
        id: rfi.id,
        number: rfi.number,
        subject: rfi.subject ?? rfi.question ?? '',
        status: rfi.status,
        dateSubmitted: rfi.dateSubmitted,
      }))) as PortalSnapshot['sections']['rfis'];
    }
  }

  // Documents — permits + portal-sent warranties. See buildPortalDocuments for
  // what is deliberately NOT in here (the contract and the closeout binder,
  // both of which already have their own portal section) and for why the rows
  // carry no link. Omitted entirely when there is nothing to show: the static
  // page skips a zero-length section anyway, and shipping `[]` is what made
  // this switch a no-op for its whole life.
  if (portal.showDocuments) {
    const docs = buildPortalDocuments({
      projectId: project.id,
      permits: opts.permits,
      warranties: opts.warranties,
      closeoutShared: closeoutIsShared(opts.closeoutBinder),
    });
    if (docs.length) sections.documents = docs;
  }

  // v2 hero meta — pick a hero photo (newest project photo we'll already
  // surface in the portal's photos section) and derive start / target dates
  // from the schedule if present.
  // #14: the hero is named by the photo's id (signed per read by
  // signed-media-urls); `heroPhotoUrl` only ever carries an http(s) link, never
  // the file:// original on the GC's phone.
  let heroPhotoUrl: string | undefined;
  let heroPhotoId: string | undefined;
  if (portal.showPhotos && photos.length) {
    const sorted = [...photos.filter(p => isShared(p.portalState))].sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tb - ta;
    });
    const hero = sorted.find(p => !!p.id || !!p.uri);
    heroPhotoId = hero?.id || undefined;
    heroPhotoUrl = hero ? portalPhotoSource(hero).url : undefined;
  }

  let startDate: string | undefined;
  let targetDate: string | undefined;
  const sched = project.schedule;
  if (sched?.startDate) {
    startDate = sched.startDate;
    // ONE finish convention — see scheduleFinishDate above. This used to add
    // `totalDurationDays` as calendar milliseconds, which printed a date up to
    // six weeks before the plan and disagreed with the Gantt further down this
    // very page. Stays undefined when the schedule gives us nothing to count:
    // the hero then falls back to "Started <date>" rather than inventing a
    // completion date for the homeowner to plan around.
    targetDate = scheduleFinishDate(placedTasks.length ? { ...sched, tasks: placedTasks } : sched) ?? undefined;
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
    const commitments = opts.commitments ?? [];
    // Nothing to build from: no commitments and no priced actual streams.
    if (commitments.length === 0 && !opts.costSources) return undefined;
    try {
      // Lazy import — pure function, no side effects.
      const { computeJobCost } = require('./jobCostEngine') as typeof import('./jobCostEngine');
      const job = computeJobCost({ project, commitments, invoices, changeOrders, ...opts.costSources });
      // An EMPTY picture is the same as none: a job with nothing logged must
      // not show the client $0 committed and $0 spent against the budget. It
      // used to require commitments, which hid cost-to-date from the owner of
      // a cost-plus job whose costs are all self-performed (crew hours,
      // receipts) — now any committed OR priced actual cost builds it.
      if (!(job.committed > 0) && !(job.actual > 0)) return undefined;
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
      return placedTasks
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
    // A GC-entered period start BEATS the derived one. derivePayAppPeriods
    // infers the window as "the day after the previous application's period
    // end" because SavedAIAPayApp used to have no periodFrom at all; it does
    // now, and a date the contractor actually set is evidence where the
    // inference is a guess.
    const storedFromById = new Map(
      aiaPayApps.map(a => [a.id, (a as SavedAIAPayApp & { periodFrom?: string }).periodFrom]),
    );
    for (const app of sections.aiaPayApps) {
      const window = periodById.get(app.id);
      const periodFrom = storedFromById.get(app.id) || window?.periodFrom;
      app.periodFrom = periodFrom;
      app.narrative = buildPeriodNarrative({
        periodFrom,
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
            // Not "waiting on you" while the terms cannot be signed (#64): the
            // page draws no sign box under them, so the row would point at a
            // card with nothing to do.
            needsSignature: !opts.contract.homeownerSignature
              && portalContractTermsMissing(buildPortalContractContent(opts.contract, project.description)) === null,
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
    // #20: the GC's zone — the overlay labels the latest update's day in it,
    // not in UTC (portal_safe_time_zone falls back to UTC when absent/invalid).
    timeZone: deviceTimeZone(),
    requirePasscode: portal.requirePasscode,
    // passcode intentionally omitted — validated server-side, never bundled.
    welcomeMessage: portal.welcomeMessage,
    clientName: invite?.name,
    clientCanSetBudget,
    submitBudget: clientCanSetBudget ? apiConfig : undefined,
    portalApi: apiConfig,
    coApprovalEnabled: !!portal.coApprovalEnabled,
    // Derived from `project` + `portal` only, for the same reason `proposal`
    // is: both snapshot writers must produce it identically.
    feedbackAsk: buildFeedbackAsk(project, portal),
    // Derived from `project` + `portal` + `contract` (+ the company name) only,
    // so EVERY caller that pushes a snapshot produces the same block. That
    // matters more than it looks: app/project-detail.tsx pushes a "lite"
    // snapshot on every project open and merges only `sections` forward from
    // the stored row, so a top-level key sourced from a caller-specific option
    // would appear and disappear from the row the acceptance RPC reads. The
    // payment schedule in particular is read from `portal.proposalPaymentTerms`
    // (the stamp), never from `settings` — which is why the stamp is saved to
    // the project in the same handler that sets it.
    proposal: buildPortalProposal({
      project,
      portal,
      contractorName: settings?.branding?.companyName ?? 'MAGE ID',
      contract: opts.contract,
    }),
    openBook,
    // Latest published homeowner update — newest published summary
    // wins. Independent of `showDailyReports`: even GCs who don't show
    // the technical report still want to ship a friendly daily update.
    latestUpdate: (() => {
      const published = (dailyReports ?? [])
        .filter(d => d.homeownerSummaryPublished && d.homeownerSummary && d.homeownerSummary.trim())
        .sort((a, b) => dayOrInstantDate(b.date).getTime() - dayOrInstantDate(a.date).getTime());
      const top = published[0];
      if (!top) return undefined;
      // dayOrInstantDate: an older voice report stored a bare day, which
      // `new Date` reads as UTC midnight — the homeowner saw the day before.
      const dateLabel = (() => {
        try { return dayOrInstantDate(top.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
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
      // Same predicate the Documents section asks, via one helper — the
      // Documents section drops warranties exactly when this block picks them
      // up, and two hand-written copies of the test would eventually disagree
      // and print the roster twice (or nowhere).
      if (!closeoutIsShared(cb)) return undefined;
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
    // Contract — only emit when GC has actually sent it to the homeowner, and
    // with its TERMS (#64): the homeowner signs what `content` shows, and
    // keeps reading it after signing. Built from `opts.contract` alone, so the
    // lite writer (utils/portalLiteSync, which passes the same row) publishes
    // the identical block.
    contract: opts.contract && (opts.contract.status === 'sent' || opts.contract.status === 'signed') ? {
      id: opts.contract.id,
      status: opts.contract.status,
      contractValue: opts.contract.contractValue,
      title: opts.contract.title,
      needsSignature: !opts.contract.homeownerSignature && opts.contract.status === 'sent',
      content: buildPortalContractContent(opts.contract, project.description),
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
      heroPhotoId,
      startDate,
      targetDate,
      targetBudget: projectTargetBudget,
      // PORTAL-01: `undefined` — not 0 — when no task carries any progress.
      // The hero's live-progress bar is gated on this field, so an untouched
      // schedule now shows no bar instead of asserting "Project progress 0%".
      progressPct: scheduleWorkComplete(project) ?? undefined,
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

/**
 * The customer-facing portal origin. ONE definition on the client, mirroring
 * `PORTAL_BASE` in supabase/functions/_shared/portalLinks.ts.
 */
export const PORTAL_BASE_URL = 'https://mageid.app/portal';

/** The `client_portal` fields a share link is built from. */
export interface ClientPortalLinkSource {
  enabled?: boolean | null;
  portalId?: string | null;
  accessToken?: string | null;
}

/**
 * THE client-side portal link — the exact mirror of
 * `portalUrlFor` in supabase/functions/_shared/portalLinks.ts.
 *
 * Returns null — never a bare `mageid.app/portal/<id>` — when the portal is
 * off or has no minted access token, because a token-less URL is not a
 * degraded link, it is a different page: every portal RPC (sign a change
 * order, accept a selection, counter-sign the contract) refuses a request
 * without `?t=`. Handing one to a homeowner in an email that asks them to
 * sign opens a portal that cannot sign, with nothing on screen saying why.
 * A caller that gets null must say so and offer the fix — it must NOT
 * fall back to concatenating the portalId.
 */
export function portalShareUrl(
  clientPortal: ClientPortalLinkSource | null | undefined,
  inviteId?: string,
): string | null {
  if (!clientPortal || clientPortal.enabled === false) return null;
  const portalId = typeof clientPortal.portalId === 'string' ? clientPortal.portalId.trim() : '';
  const token = typeof clientPortal.accessToken === 'string' ? clientPortal.accessToken.trim() : '';
  if (!portalId || !token) return null;
  return buildShortPortalUrl(PORTAL_BASE_URL, portalId, inviteId, token);
}

/**
 * PORTAL-07 — the share link, safe to PRINT on a screen.
 *
 * Two requirements pull against each other on the Portal Link card. The
 * displayed string must be unmistakably the link Copy and Share hand out:
 * printing the bare `mageid.app/portal/<id>` is what let a GC read a
 * token-less URL to a client on the phone, or retype it into a CRM, and hand
 * over a portal that opens but silently cannot approve a change order. But
 * `?t=` is a capability secret — it is the whole of the homeowner's authority
 * to e-sign a change order — and that card has no max width, so on a desktop
 * browser the full 64 characters render on one line, into every screenshot
 * and screen-share of the screen (the runtime audit's own capture included).
 *
 * Eliding the middle of the token satisfies both: the query parameter is
 * visible, so nobody mistakes the bare URL for the link, and the ellipsis
 * makes the string self-evidently un-transcribable, which is exactly the
 * behaviour we want — Copy carries it in full. Never send this string.
 */
export function maskPortalLinkToken(link: string): string {
  return link.replace(
    /([?&]t=)([^&#]+)/,
    (_m, prefix: string, token: string) =>
      token.length <= 12 ? `${prefix}${token}` : `${prefix}${token.slice(0, 4)}\u2026${token.slice(-4)}`,
  );
}

// Rough sanity check — URL fragments over ~8KB start to make SMS clients unhappy.
// Return size in KB of the encoded payload to let the UI show a warning.
export function estimateSnapshotSizeKb(snapshot: PortalSnapshot): number {
  const json = JSON.stringify(snapshot);
  return Math.ceil(new Blob([json]).size / 1024);
}
