// Sub-portal snapshot builder — the same base64url-in-URL-hash pattern as
// the client portal. The static page at mageid.app/sub-portal/<id> decodes
// it to render the sub's commitments + payment history, and to
// pre-configure the Supabase REST endpoint for invoice submissions.

import type {
  Project, AppSettings, Subcontractor, Commitment,
  Invoice, SubPortalLink, SubSubmittedInvoice,
  PunchItem, ProjectSchedule,
} from '@/types';
import { runCpm, calendarIndexToWorkingOrdinal } from '@/utils/cpm';
import { calendarDayOf, parseCalendarDay } from '@/utils/calendarDate';

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

  commitments: {
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
  }[];

  // Sub-submitted billing history (most recent first), so the sub sees
  // what they've already filed and the GC's review state.
  submittedInvoices: {
    id: string;
    invoiceNumber: string;
    amount: number;
    retentionAmount?: number;
    status: 'submitted' | 'approved' | 'rejected' | 'paid';
    createdAt: string;
    reviewedAt?: string;
    paidAt?: string;
    notesFromGc?: string;
  }[];

  // v2: every NOT-CLOSED punch item in this sub's scope (scopePunchForSub),
  // sorted and capped at SUB_PORTAL_PUNCH_CAP. open / in_progress are "still
  // on you"; ready_for_review is "waiting on the GC to verify" — the page
  // groups them apart. When the page reads through sub_portal_get_snapshot
  // this list is REPLACED server-side by the live punch_items rows (migration
  // 20260919200000), so only a hash-only fallback shows this frozen copy.
  punchItems?: SubPortalPunchEntry[];
  /** Scoped not-closed items BEFORE the cap — "Showing 60 of 75". */
  punchTotal?: number;
  /** Set by the server read when punchItems are live (ISO instant). */
  punchLiveAt?: string;

  // v2: schedule tasks where this sub is assigned (or their trade
  // matches the task's crew). Includes the parent project's schedule
  // start date so the portal can render real calendar dates.
  scheduleSlice?: {
    projectStartDate?: string;
    // The calendar the page walks `startDay`/`durationDays` on (both are
    // WORKING-day units). Absent on links shared before 2026-09-18 — the page
    // then assumes the engine's default 5-day week.
    workingDaysPerWeek?: number;
    nonWorkingDates?: string[];
    tasks: {
      id: string;
      title: string;
      phase?: string;
      progress: number;
      status: string;
      durationDays: number;
      startDay: number;
      isMilestone?: boolean;
    }[];
  };

  submitInvoice: {
    subPortalId: string;
    supabaseUrl?: string;
    supabaseAnonKey?: string;
    contactEmail?: string;
    contactName?: string;
  };
}

/**
 * One punch row as the sub's portal receives it. The photo travels as its
 * durable STORAGE PATH in the private project-photos bucket, never as photoUri:
 * on the phone that took it that is a file:// the sub's browser cannot open.
 * The portal does not draw the photo yet (a private bucket needs a signed URL,
 * which Postgres cannot mint) — it shows the description, location, due date
 * and the plan sheet the item is pinned on.
 */
export interface SubPortalPunchEntry {
  id: string;
  description: string;
  location?: string;
  priority?: string;
  status: string;
  dueDate?: string;
  photoStoragePath?: string;
  planSheetId?: string;
  /** "A-101 · Level 2" — utils/punchPlanPin.pinSheetLabel's rule. */
  sheetLabel?: string;
  pinX?: number;
  pinY?: number;
  /** The sub's own note from "Mark fixed" (punch_items.sub_note). */
  subNote?: string;
}

/** Keep equal to the cap in sub_portal_live_punch (migration 20260919200000). */
export const SUB_PORTAL_PUNCH_CAP = 60;

/** Still on the sub: open or in progress. ready_for_review is on the GC. */
export function punchIsOnSub(p: Pick<PunchItem, 'status'>): boolean {
  return p.status === 'open' || p.status === 'in_progress';
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const dueKey = (d: string | undefined): string => {
  const v = (d ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '9999-12-31';
};

/**
 * THE punch list a sub's portal shows, in the order it shows it: every item on
 * this project in his scope (punchItemBelongsToSub) that is not closed —
 * on-him items first, then the ones waiting on the GC; within each, priority
 * high→low, earliest due (an unreadable due date last), oldest first. Sorted
 * BEFORE any cap, so the cap drops the least urgent rows, never the oldest
 * overdue ones. The punch-list banner counts from this same function, and the
 * server read (sub_portal_live_punch) applies the same rule in SQL.
 */
export function scopePunchForSub<T extends Pick<PunchItem, 'projectId' | 'assignedSub' | 'assignedSubId' | 'status' | 'priority' | 'dueDate' | 'createdAt' | 'id'>>(
  items: readonly T[],
  sub: Pick<Subcontractor, 'id' | 'companyName'>,
  projectId: string,
): T[] {
  return items
    .filter(p => p.projectId === projectId && p.status !== 'closed' && punchItemBelongsToSub(p, sub))
    .sort((a, b) =>
      (punchIsOnSub(a) ? 0 : 1) - (punchIsOnSub(b) ? 0 : 1)
      || (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1)
      || dueKey(a.dueDate).localeCompare(dueKey(b.dueDate))
      || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
      || a.id.localeCompare(b.id));
}

/** A durable storage path, or undefined for a device/remote URI. */
function durablePhotoPath(p: Pick<PunchItem, 'photoStoragePath' | 'photoUri'>): string | undefined {
  const path = (p.photoStoragePath ?? '').trim();
  if (path && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return path;
  // Synced rows keep the path in photoUri (punch_items.photo_uri).
  const uri = (p.photoUri ?? '').trim();
  if (uri && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)) return uri;
  return undefined;
}

function sheetLabelOf(sheet: { name?: string | null; sheetNumber?: string | null } | undefined): string | undefined {
  if (!sheet) return undefined;
  const num = String(sheet.sheetNumber ?? '').trim();
  const name = String(sheet.name ?? '').trim();
  if (num && name && num !== name) return `${num} · ${name}`;
  return num || name || 'Plan';
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
  /** This project's plan sheets, for the "Sheet A-101" label on pinned items. */
  planSheets?: readonly { id: string; name?: string | null; sheetNumber?: string | null }[];

  supabaseUrl?: string;
  supabaseAnonKey?: string;
  contactEmail?: string;
  contactName?: string;
}

export function buildSubPortalSnapshot(opts: BuildOpts): SubPortalSnapshot {
  const {
    link, project, sub, settings, commitments,
    submittedInvoices = [],
    punchItems = [], schedule, planSheets = [],
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

    // Scoped by the one exported rule (scopePunchForSub), sorted, then capped
    // — with the uncapped count, so the page never quietly hides rows.
    ...(() => {
      const scoped = scopePunchForSub(punchItems, sub, project.id);
      if (!scoped.length) return {};
      const sheets = new Map(planSheets.map(sh => [sh.id, sh]));
      const entries: SubPortalPunchEntry[] = scoped.slice(0, SUB_PORTAL_PUNCH_CAP).map(p => {
        const pinned = !!p.planSheetId;
        return {
          id: p.id,
          description: p.description,
          location: p.location || undefined,
          priority: p.priority,
          status: p.status,
          dueDate: p.dueDate || undefined,
          photoStoragePath: durablePhotoPath(p),
          ...(pinned ? {
            planSheetId: p.planSheetId,
            sheetLabel: sheetLabelOf(sheets.get(p.planSheetId as string)) ?? 'Plan',
            pinX: p.pinX,
            pinY: p.pinY,
          } : {}),
          subNote: p.subNote || undefined,
        };
      });
      return { punchItems: entries, punchTotal: scoped.length };
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
      // Where the ENGINE put each task, not the stored startDay pin: a pin
      // that dependencies have pushed later reads a week early in the sub's
      // portal while the app shows the real date (#51). The page walks
      // startDay/durationDays in WORKING days, so a dated run's calendar
      // es/ef is converted to working ordinals; an undated run is already in
      // working days. No placement (a cycle, or a task the engine skipped)
      // keeps the stored pin.
      const dpw = schedule.workingDaysPerWeek || 5;
      const startIso = calendarDayOf(schedule.startDate);
      const dayOpts = { scheduleStartDate: startIso && parseCalendarDay(startIso) ? startIso : undefined, workingDaysPerWeek: dpw, nonWorkingDates: schedule.nonWorkingDates ?? [] };
      let perTask: Map<string, { es: number; ef: number }> = new Map();
      try { perTask = runCpm(schedule.tasks, dayOpts).perTask as Map<string, { es: number; ef: number }>; } catch { /* keep pins */ }
      const placed = (t: typeof scoped[number]): { startDay: number; durationDays: number } => {
        const r = perTask.get(t.id);
        if (!r || !Number.isFinite(r.es) || !Number.isFinite(r.ef)) return { startDay: t.startDay ?? 0, durationDays: t.durationDays ?? 0 };
        if (!dayOpts.scheduleStartDate) return { startDay: r.es, durationDays: Math.max(1, r.ef - r.es + 1) };
        const s0 = calendarIndexToWorkingOrdinal(r.es, dayOpts);
        const e0 = calendarIndexToWorkingOrdinal(Math.max(r.es, r.ef), dayOpts);
        return { startDay: s0, durationDays: t.isMilestone ? (t.durationDays ?? 0) : Math.max(1, e0 - s0 + 1) };
      };
      const ordered = scoped
        .map(t => ({ t, at: placed(t) }))
        .sort((a, b) => a.at.startDay - b.at.startDay)
        .slice(0, 40);
      return {
        projectStartDate: schedule.startDate,
        workingDaysPerWeek: dpw,
        ...(schedule.nonWorkingDates?.length ? { nonWorkingDates: [...schedule.nonWorkingDates] } : {}),
        tasks: ordered.map(({ t, at }) => ({
          id: t.id,
          title: t.title,
          phase: t.phase,
          progress: t.progress ?? 0,
          status: t.status,
          durationDays: at.durationDays,
          startDay: at.startDay,
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

// ── Which sub a punch item belongs to ───────────────────────────────────────
// A punch item names its sub twice: `assignedSub` (the company name the GC
// sees on the row) and `assignedSubId`. Older edit paths changed the name and
// left the id behind, so a row reading "Sub: Rivera Drywall" could still carry
// ABC Electric's id — and landed on BOTH portals, while the "open their portal"
// shortcut opened ABC's. The name is what the GC sees and what he last chose,
// so an id is only trusted while its sub's name agrees with the row's name
// (or the row has no name at all).
const normName = (v: string | undefined | null): string => (v ?? '').trim().toLowerCase();

export function punchItemBelongsToSub(
  p: Pick<PunchItem, 'assignedSub' | 'assignedSubId'>,
  sub: Pick<Subcontractor, 'id' | 'companyName'>,
): boolean {
  const name = normName(p.assignedSub);
  const subName = normName(sub.companyName);
  if (p.assignedSubId && p.assignedSubId === sub.id) return !name || name === subName;
  return !!subName && name === subName;
}

/**
 * The subcontractor record a punch item (or a pool of items that all read one
 * name) points at: one whose name matches the row, preferring the id the items
 * carry when two records share that name. An id whose sub now has a DIFFERENT
 * name is stale and ignored. undefined = no sub record for that name.
 */
export function resolvePunchSub<S extends Pick<Subcontractor, 'id' | 'companyName'>>(
  name: string, ids: readonly (string | undefined)[], subs: readonly S[],
): S | undefined {
  const n = normName(name);
  if (!n) {
    // No name on the row: the id is all there is.
    const only = ids.find(Boolean);
    return only ? subs.find(s => s.id === only) : undefined;
  }
  const named = subs.filter(s => normName(s.companyName) === n);
  return named.find(s => ids.includes(s.id)) ?? named[0];
}

/**
 * The punch items that must follow a sub's RENAME. The rules above trust an id
 * only while the row's name still matches its sub's name, so renaming
 * "ABC Electric" to "ABC Electric LLC" on the Subs screen took every one of
 * his items off his portal, and the edit sheet's seed then resolved to no sub
 * and the next save wrote assigned_sub_id = null. updateSubcontractor carries
 * the new name onto these rows instead: his rows by id that still read the old
 * name, plus legacy name-only rows reading the old name when no other sub
 * record still carries it. A row already renamed to someone else keeps its
 * name — that is a reassignment, not this sub.
 *
 * Legacy name-only rows are taken ONLY on projects he owns (`ownsProject`).
 * His sub list is private (subcontractors RLS is owner-only) but the punch
 * items he can read include the owner's rows on jobs he was invited to; a
 * name-only row there is the OWNER's name for the OWNER's sub, and rewriting
 * it to his new name + his private sub id took it off the owner's portal. A
 * row carrying his own sub's id is his assignment wherever it sits.
 */
export function punchItemsFollowingSubRename(
  items: readonly (Pick<PunchItem, 'id' | 'assignedSub' | 'assignedSubId'> & { projectId?: string })[],
  sub: Pick<Subcontractor, 'id'>,
  oldName: string,
  newName: string,
  otherSubs: readonly Pick<Subcontractor, 'id' | 'companyName'>[],
  ownsProject: (projectId: string | undefined) => boolean,
): string[] {
  const from = normName(oldName);
  if (!from || from === normName(newName)) return [];
  const nameStillTaken = otherSubs.some(s => s.id !== sub.id && normName(s.companyName) === from);
  return items
    .filter(p => normName(p.assignedSub) === from
      && (p.assignedSubId ? p.assignedSubId === sub.id : (!nameStillTaken && ownsProject(p.projectId))))
    .map(p => p.id);
}

/**
 * Whether this user owns the naming on a project's punch items: ownerUserId is
 * him. Strict on purpose, like classifyProjectForSync (no ownerUserId = treat
 * as shared): every server load stamps ownerUserId from the row, and the cost
 * of a miss is only that a legacy row keeps its old name (the pre-cascade
 * behaviour), while a false "his" rewrites someone else's rows. An unknown
 * project id is not his to rewrite.
 */
export function ownsProjectFor(
  projects: readonly { id: string; ownerUserId?: string }[],
  userId: string | null | undefined,
): (projectId: string | undefined) => boolean {
  const owned = new Set(projects.filter(p => !!userId && p.ownerUserId === userId).map(p => p.id));
  return (projectId) => !!projectId && owned.has(projectId);
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
  accessToken?: string,
): string {
  const json = JSON.stringify(snapshot);
  const encoded = encodeBase64Url(json);
  // accessToken (`?t=`) is the server-managed gate the sub-portal RPCs
  // (sub_portal_get_snapshot / sub_portal_submit_invoice) require. It rides
  // the share link ONLY — never inside the snapshot hash — so it cannot leak
  // via a snapshot fetched by portalId. Mirror buildShortPortalUrl exactly:
  // query BEFORE the hash, omitted entirely when there's no token.
  const params = new URLSearchParams();
  if (accessToken) params.set('t', accessToken);
  const q = params.toString();
  const query = q ? `?${q}` : '';
  return `${baseUrl}/${portalId}${query}#d=${encoded}`;
}

/**
 * The short sub-portal link — no snapshot hash, `?t=` kept.
 *
 * The static sub-portal page fetches its snapshot from `sub_portal_snapshots`
 * by id when no `#d=` hash is present, so this URL works on its own. What it
 * must never do is drop the token: `sub_portal_get_snapshot` and
 * `sub_portal_submit_invoice` both refuse a request without it, so a bare
 * `<base>/<id>` is a page the sub can open and cannot submit from.
 */
export function buildShortSubPortalUrl(
  baseUrl: string,
  portalId: string,
  accessToken?: string,
): string {
  const q = accessToken ? `?t=${encodeURIComponent(accessToken)}` : '';
  return `${baseUrl}/${portalId}${q}`;
}
