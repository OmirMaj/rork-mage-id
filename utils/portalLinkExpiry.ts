// utils/portalLinkExpiry.ts — how long a homeowner portal link stays open.
//
// Pure and React-free on purpose: the states below are the difference between
// a GC confidently texting a link and a homeowner hitting a dead page mid-
// build, so they get pinned by scripts/validate-portal-link-expiry.ts rather
// than eyeballed in the simulator. Nothing here imports react-native, so it
// runs under bun.
//
// The storage model is in supabase/migrations/20260826170000_portal_link_expiry.sql
// (the columns) and 20260916140000_portal_link_until_handover.sql (the rule):
// `expires_at` is NULLABLE, and `link_duration_days` says HOW it gets set.
//
// ── UNTIL HANDOVER (2026-09-16) ──────────────────────────────────────────────
// `link_duration_days` NULL used to mean "No expiry". It now means UNTIL
// HANDOVER: the link stays open for the whole job however long it runs, and
// closes HANDOVER_GRACE_DAYS after the project is closed out (status
// 'closed'). A GC who picked "No expiry" before this change now gets
// until-handover — deliberately. The real need behind "No expiry" was a link
// that survives a months-long job, which until-handover covers, without a
// credential that keeps opening a finished job's page forever. The explicit
// "never" option is gone from the picker.
//
// Why this is the default: the old 30-day default killed portals mid-job
// (construction runs for months), and the founder's complaint was "the links
// always expire". Every production portal is NULL, so every one of them
// becomes until-handover without a data migration.
//
// ONE RULE, TWO PLACES. The database computes the handover date itself
// (triggers in the migration above), and the setup screen pushes expires_at on
// every snapshot refresh. If the two computed it differently they would
// overwrite each other on every refresh. expiresAtForPolicy below is the app's
// copy of the SQL rule — change one, change the other, and the guard
// (scripts/validate-portal-link-expiry.ts) pins both.

/** Milliseconds in a day. Portal durations are coarse; DST drift is noise. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Warn this many days out. Three days is enough for a GC to notice on a
 * Friday and act before Monday, which is the failure this is trying to
 * prevent: the link dying while nobody is looking at the app.
 */
export const EXPIRING_SOON_DAYS = 3;

/**
 * After a project is closed out, the homeowner still needs the portal for a
 * while — final invoice, closeout binder, warranty paperwork, punch sign-off.
 * Thirty days covers that stretch; the migration hard-codes the same number
 * (`interval '30 days'`) and the guard checks they agree.
 */
export const HANDOVER_GRACE_DAYS = 30;

/**
 * A link's lifetime policy: a fixed number of days, or `null` = until handover.
 * `null` is not "unset" — it is the default policy and the one every portal
 * that predates this change is on.
 */
export type PortalLinkDuration = number | null;

/** Named alias for the `null` policy so call sites read as intent. */
export const PORTAL_LINK_UNTIL_HANDOVER: PortalLinkDuration = null;

/**
 * Durations offered in the picker. Until-handover first because it is the
 * default and the right answer for almost every job; the fixed durations stay
 * for a GC who wants a short-lived link (a prospect, a one-off review).
 */
export const PORTAL_LINK_DURATION_OPTIONS: readonly PortalLinkDuration[] = [
  PORTAL_LINK_UNTIL_HANDOVER, 7, 30, 90,
];

/**
 * What a GC gets if they have never chosen: until handover. (Was 30 days,
 * which closed a portal made at kickoff halfway through the build.)
 */
export const DEFAULT_PORTAL_LINK_DURATION_DAYS: PortalLinkDuration = PORTAL_LINK_UNTIL_HANDOVER;

/**
 * Is the job handed over? ONLY status 'closed'. 'completed' is deliberately
 * NOT handover: work can be substantially complete while the final invoice,
 * punch sign-off and closeout binder are still going back and forth through
 * the portal — closing the link there would cut the client off at exactly the
 * moment they need it. Closeout (app/closeout-binder.tsx) is what sets
 * 'closed' + closedAt.
 */
export function isHandedOver(projectStatus: string | null | undefined): boolean {
  return projectStatus === 'closed';
}

export interface PortalLinkPolicyInput {
  /** The GC's choice. null/undefined = until handover. */
  linkDurationDays: PortalLinkDuration | undefined;
  /** The stored expiry of the link as it stands (portal.linkExpiresAt). */
  linkExpiresAt: ExpiresAtInput;
  /** Project.status. */
  projectStatus: string | null | undefined;
  /** Project.closedAt — when the job was closed out. */
  closedAt: ExpiresAtInput;
  /** Injected so tests are not clock-dependent. */
  nowMs?: number;
}

/**
 * The expiry a link SHOULD carry, as an ISO string, or null for "open".
 * Mirrors public.portal_link_expiry_for_policy in
 * 20260916140000_portal_link_until_handover.sql.
 *
 *   fixed duration → the link's own linkExpiresAt, whatever the job's status
 *                    (the GC chose a date; handover does not move it)
 *   until handover → job open (anything but 'closed'): null
 *                    job closed: closedAt + HANDOVER_GRACE_DAYS
 *
 * Closed with no closedAt (older data, or a status flipped by something other
 * than closeout): the stamp already on the link wins if there is one, and only
 * then now + grace. Without that, a screen that re-pushes this value on every
 * snapshot refresh would slide the deadline forward forever — the database
 * stamps now() once at the transition and then keeps it, and so does this.
 *
 * A reopened job (status leaves 'closed') returns null: the link reopens with
 * the job. Never throws; an unparseable closedAt is treated as missing.
 */
export function expiresAtForPolicy(input: PortalLinkPolicyInput): string | null {
  const { linkDurationDays, linkExpiresAt, projectStatus, closedAt } = input;
  const now = input.nowMs !== undefined && Number.isFinite(input.nowMs) ? input.nowMs : Date.now();

  if (linkDurationDays !== null && linkDurationDays !== undefined) {
    const own = toMillis(linkExpiresAt);
    return own === null ? null : new Date(own).toISOString();
  }

  if (!isHandedOver(projectStatus)) return null;

  const closedMs = toMillis(closedAt);
  if (closedMs !== null) return new Date(closedMs + HANDOVER_GRACE_DAYS * DAY_MS).toISOString();

  const stamped = toMillis(linkExpiresAt);
  if (stamped !== null) return new Date(stamped).toISOString();

  return new Date(now + HANDOVER_GRACE_DAYS * DAY_MS).toISOString();
}

/**
 * 'never' = no expiry date on the link. The name predates until-handover and
 * is kept so existing Record<PortalLinkStateKind, …> maps still type-check;
 * with the "No expiry" option gone, a dateless link is an until-handover link
 * on a job that is still open, and that is how it is labelled.
 */
export type PortalLinkStateKind = 'never' | 'active' | 'expiring_soon' | 'expired';

export interface PortalLinkState {
  kind: PortalLinkStateKind;
  /**
   * Whole days remaining, floored — 12.9 days left reads as 12, so the label
   * never promises a day the link does not have. Negative once past
   * ("expired 3 days ago" = -3), 0 for both "expires later today" and
   * "expired earlier today"; `kind` disambiguates those two. `null` only when
   * kind is 'never'.
   */
  daysLeft: number | null;
  /** Ready to render, e.g. "Link active — expires in 12 days". */
  label: string;
}

/** Options for linkState. */
export interface LinkStateOptions {
  /**
   * The link is on the until-handover policy (link_duration_days null). Its
   * date, when it has one, is "30 days after closeout" — so it is labelled as
   * a closing date ("Closes Oct 16"), not as a countdown the GC picked.
   */
  untilHandover?: boolean;
}

/** Anything a timestamp column can plausibly arrive as. */
export type ExpiresAtInput = string | number | Date | null | undefined;

function toMillis(value: ExpiresAtInput): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function plural(n: number): string {
  return n === 1 ? 'day' : 'days';
}

/**
 * Classify a link's expiry for display.
 *
 * Never throws. An unparseable timestamp is treated as 'never', NOT as
 * expired: a corrupt value is a bug on our side, and the failure modes are not
 * symmetric. Reading it as expired tells a GC their live link is dead and
 * pushes them to regenerate a URL the homeowner already has bookmarked;
 * reading it as never-expires leaves today's behaviour intact until someone
 * fixes the data.
 *
 * A null date reads "Open until handover" whatever the options say: with the
 * "No expiry" option retired, that is the only policy that leaves a link
 * without a date. It does not claim the job is open or when it will close —
 * only that nothing has set a deadline yet.
 *
 * @param expiresAt ISO string / epoch ms / Date. Null or blank = no date yet.
 * @param nowMs Injected so tests are not clock-dependent.
 * @param opts untilHandover: label a date as the post-closeout closing date.
 */
export function linkState(
  expiresAt: ExpiresAtInput,
  nowMs: number = Date.now(),
  opts: LinkStateOptions = {},
): PortalLinkState {
  const expiryMs = toMillis(expiresAt);
  if (expiryMs === null) {
    return { kind: 'never', daysLeft: null, label: 'Open until handover' };
  }

  // A non-finite `now` (NaN from a bad caller) would make every comparison
  // false and silently return 'active'. Fall back to the real clock.
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const remainingMs = expiryMs - now;

  const handover = opts.untilHandover === true;
  const date = handover ? shortDate(expiryMs) : '';

  if (remainingMs <= 0) {
    const elapsedDays = Math.floor(-remainingMs / DAY_MS);
    const ago = elapsedDays === 0 ? 'today' : `${elapsedDays} ${plural(elapsedDays)} ago`;
    return {
      kind: 'expired',
      // `-0` is === 0 but fails Object.is, which trips strict assertions.
      daysLeft: elapsedDays === 0 ? 0 : -elapsedDays,
      label: handover
        ? `Link closed ${date} (${ago}), ${HANDOVER_GRACE_DAYS} days after handover`
        : elapsedDays === 0
          ? 'Link expired today'
          : `Link expired ${elapsedDays} ${plural(elapsedDays)} ago`,
    };
  }

  const daysLeft = Math.floor(remainingMs / DAY_MS);
  if (daysLeft <= EXPIRING_SOON_DAYS) {
    const when = daysLeft === 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
    return {
      kind: 'expiring_soon',
      daysLeft,
      label: handover
        ? `Closes ${date} (${when}) — job handed over`
        : `Link expires ${when}`,
    };
  }

  return {
    kind: 'active',
    daysLeft,
    label: handover
      ? `Closes ${date} — ${HANDOVER_GRACE_DAYS} days after handover`
      : `Link active — expires in ${daysLeft} ${plural(daysLeft)}`,
  };
}

/**
 * "Oct 16, 2026". Fixed en-US month names rather than toLocaleDateString:
 * Hermes ships without full Intl on some builds, and a label that renders
 * differently on the phone than in the guard is a label nobody pinned. The
 * calendar day is the viewer's local day, which is the one they will act on.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Turn a chosen FIXED duration into the timestamp to store. `null` days =
 * until handover, which has no date to mint here: it stores NULL and gets its
 * date from expiresAtForPolicy / the database once the job is closed out.
 *
 * A non-positive or non-finite duration returns null rather than minting a
 * link that is born expired; the DB carries the same rule as a check
 * constraint.
 */
export function expiresAtFromDuration(
  days: number | null | undefined,
  fromMs: number = Date.now(),
): string | null {
  if (days === null || days === undefined) return null;
  if (!Number.isFinite(days) || days <= 0) return null;
  const base = Number.isFinite(fromMs) ? fromMs : Date.now();
  return new Date(base + days * DAY_MS).toISOString();
}

/** "7 days" / "Until handover" — the picker chip label. */
export function durationLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'Until handover';
  return `${days} ${plural(days)}`;
}

/**
 * True when the GC should be stopped and told before they hand this link out.
 * Copy/Share call this — an expired link that copies silently is exactly the
 * bug the founder described.
 */
export function shouldWarnBeforeSharing(expiresAt: ExpiresAtInput, nowMs: number = Date.now()): boolean {
  return linkState(expiresAt, nowMs).kind === 'expired';
}
