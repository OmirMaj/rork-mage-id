// homeowner-weekly-digest/clientVisible.ts — what the Friday email may talk
// about, and whether it should go out at all. Pure; no Deno, no network, so
// scripts/validate-homeowner-digest-gates.ts executes it directly.
//
// ── 1. Only what the GC sent (audit 2026-09-18 #18) ─────────────────────────
// Every change order starts as portalState {status:'draft'} and stays off the
// client portal until the GC presses Send (utils/portalSnapshot.ts filters on
// isShared). The digest read change_orders straight from the table — drafts,
// voids and rejections included — and told the homeowner "1 change order this
// week (net +$12,000)" about a number the GC was still negotiating with his
// sub. The AI prompt got the same count and total, so even with every money
// sentence stripped it could still write "a change order came in this week".
// Photos and daily reports had the same hole against showPhotos /
// showDailyReports. The fix is at the DATA, so neither the AI path nor the
// template path ever sees a record the portal hides: the same per-section
// toggle and the same isShared rule portalSnapshot applies.
//
// ── 2. Stop at handover (audit 2026-09-18 #23) ──────────────────────────────
// Closing a job did not stop the digest. With no reports the template said
// "A quiet week on this project" every Friday, forever; with Gemini on, the
// model was handed "(no detailed reports this week)" plus every task ever
// completed and told to describe this week and next — a made-up week of work,
// under the GC's name, with no human review. From day 31 its only button
// opened the expired-link page. Now a closed job gets ONE last email that says
// the job is complete and the date the portal link closes, then nothing; and
// no digest goes out on a link that has already ended.

/** utils/portalSnapshot.ts isShared — undefined is grandfathered as sent. */
export interface PortalStateLike {
  status?: string | null;
  sentAt?: string | null;
}
export function isPortalShared(s: PortalStateLike | null | undefined): boolean {
  return s == null || s.status === 'sent';
}

/** The ClientPortalSettings toggles the snapshot reads. Absent = off, as there. */
export interface PortalSectionToggles {
  showChangeOrders?: boolean | null;
  showPhotos?: boolean | null;
  showDailyReports?: boolean | null;
  showSchedule?: boolean | null;
}

/** A change-order status that never belongs in "this week's change orders". */
const UNREPORTABLE_CO_STATUSES = new Set(['draft', 'void', 'rejected']);

export interface GateableRow {
  portal_state?: PortalStateLike | null;
}
export interface GateableChangeOrder extends GateableRow {
  status?: string | null;
  created_at?: string | null;
}

export interface WeekRows<D extends GateableRow, P extends GateableRow, C extends GateableChangeOrder, T> {
  dfrs: D[];
  photos: P[];
  cos: C[];
  /** Schedule tasks — reach the homeowner only when the portal shows the schedule. */
  tasks: T[];
}

/**
 * The subset of this week's rows the homeowner can already see in the portal.
 * `sinceMs` bounds change orders by when they were SENT (portal_state.sentAt),
 * falling back to created_at for grandfathered rows — a CO drafted three weeks
 * ago and sent on Tuesday is this week's news; one created Tuesday and still a
 * draft is not news at all.
 */
export function clientVisibleWeek<D extends GateableRow, P extends GateableRow, C extends GateableChangeOrder, T>(
  portal: PortalSectionToggles | null | undefined,
  rows: WeekRows<D, P, C, T>,
  sinceMs: number,
): WeekRows<D, P, C, T> {
  const p = portal ?? {};
  const cos = p.showChangeOrders
    ? rows.cos.filter(c => {
        if (!isPortalShared(c.portal_state)) return false;
        if (UNREPORTABLE_CO_STATUSES.has(String(c.status ?? ''))) return false;
        const when = Date.parse(String(c.portal_state?.sentAt ?? c.created_at ?? ''));
        return Number.isFinite(when) && when >= sinceMs;
      })
    : [];
  return {
    cos,
    photos: p.showPhotos ? rows.photos.filter(r => isPortalShared(r.portal_state)) : [],
    dfrs: p.showDailyReports ? rows.dfrs.filter(r => isPortalShared(r.portal_state)) : [],
    tasks: p.showSchedule ? rows.tasks : [],
  };
}

/**
 * Days the until-handover portal link stays open after closeout. Mirrors
 * utils/portalLinkExpiry.ts HANDOVER_GRACE_DAYS and the 30-day interval in
 * migration 20260916140000; the validator pins all three together.
 */
export const HANDOVER_GRACE_DAYS = 30;
const DAY_MS = 86_400_000;

export type HomeownerDigestPlan =
  | { kind: 'weekly' }
  | { kind: 'final'; linkClosesAt: string }
  | { kind: 'skip'; reason: 'project_closed' | 'portal_link_ended' };

export function planHomeownerDigest(input: {
  status: string | null | undefined;
  closedAt: string | null | undefined;
  /** portal_snapshots.expires_at for this portal (null = open-ended / no row). */
  linkExpiresAt: string | null | undefined;
  /** client_portal.weeklyDigest.finalSentAt — the handover email already went. */
  finalSentAt: string | null | undefined;
  isPreview: boolean;
  now: Date;
}): HomeownerDigestPlan {
  const nowMs = input.now.getTime();
  const expiresMs = input.linkExpiresAt ? Date.parse(input.linkExpiresAt) : NaN;
  // A link that has ended sends nothing: every button in the email would open
  // "This link has expired".
  if (Number.isFinite(expiresMs) && expiresMs <= nowMs) return { kind: 'skip', reason: 'portal_link_ended' };
  if (input.status !== 'closed') return { kind: 'weekly' };
  // The GC's preview e-mails the homeowner for real, so it must not send the
  // one-time handover note early (or a week-in-review for a finished job).
  if (input.isPreview || input.finalSentAt) return { kind: 'skip', reason: 'project_closed' };
  const closedMs = input.closedAt ? Date.parse(input.closedAt) : NaN;
  const closesMs = Number.isFinite(expiresMs)
    ? expiresMs
    : Number.isFinite(closedMs) ? closedMs + HANDOVER_GRACE_DAYS * DAY_MS : NaN;
  // Without a date the note cannot say when the link closes — which is the
  // whole point of it — so a closed job with no date just stops.
  if (!Number.isFinite(closesMs) || closesMs <= nowMs) return { kind: 'skip', reason: 'project_closed' };
  return { kind: 'final', linkClosesAt: new Date(closesMs).toISOString() };
}

// ── #134 (wave 4): a disabled portal sends nothing ─────────────────────────
// "Disable Portal" is the GC revoking ALL client access (a dispute, a fired
// client). The digest used to check only invites, expiry and handover, so the
// homeowner kept getting the Friday recap — and the "project complete" note
// telling them the binder "is in your portal". Checked FIRST in sendForProject
// (so the cron AND the GC's preview, which emails for real, both honour it)
// and in the cron loop before any read. Only an explicit `enabled === false`
// is off: a portal row with no flag predates the switch and stays as it was.
export const DIGEST_PORTAL_DISABLED = 'portal_disabled';

export function digestPortalGate(portal: { enabled?: boolean } | null | undefined): typeof DIGEST_PORTAL_DISABLED | null {
  return portal?.enabled === false ? DIGEST_PORTAL_DISABLED : null;
}
