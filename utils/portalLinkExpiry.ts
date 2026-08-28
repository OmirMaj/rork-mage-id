// utils/portalLinkExpiry.ts — how long a homeowner portal link stays open.
//
// Pure and React-free on purpose: the states below are the difference between
// a GC confidently texting a link and a homeowner hitting a dead page mid-
// build, so they get pinned by scripts/validate-portal-link-expiry.ts rather
// than eyeballed in the simulator. Nothing here imports react-native, so it
// runs under bun.
//
// The storage model is in supabase/migrations/20260826170000_portal_link_expiry.sql:
// `expires_at` is NULLABLE and NULL means "never expires", which is what every
// portal created before that migration keeps. So the null branch here is not a
// defensive edge case — it is the majority state.

/** Milliseconds in a day. Portal durations are coarse; DST drift is noise. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Warn this many days out. Three days is enough for a GC to notice on a
 * Friday and act before Monday, which is the failure this is trying to
 * prevent: the link dying while nobody is looking at the app.
 */
export const EXPIRING_SOON_DAYS = 3;

/** Durations offered in the picker. `null` is rendered as "No expiry". */
export const PORTAL_LINK_DURATION_OPTIONS: readonly (number | null)[] = [7, 30, 90, null];

/**
 * What a GC gets if they have never chosen. 30 days matches the house
 * precedent (shared_schedule_snapshots defaults to 30) and is long enough to
 * cover a punch-list-and-closeout stretch without a regeneration.
 */
export const DEFAULT_PORTAL_LINK_DURATION_DAYS = 30;

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
 * @param expiresAt ISO string / epoch ms / Date. Null or blank = never expires.
 * @param nowMs Injected so tests are not clock-dependent.
 */
export function linkState(expiresAt: ExpiresAtInput, nowMs: number = Date.now()): PortalLinkState {
  const expiryMs = toMillis(expiresAt);
  if (expiryMs === null) {
    return { kind: 'never', daysLeft: null, label: 'Never expires' };
  }

  // A non-finite `now` (NaN from a bad caller) would make every comparison
  // false and silently return 'active'. Fall back to the real clock.
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const remainingMs = expiryMs - now;

  if (remainingMs <= 0) {
    const elapsedDays = Math.floor(-remainingMs / DAY_MS);
    return {
      kind: 'expired',
      // `-0` is === 0 but fails Object.is, which trips strict assertions.
      daysLeft: elapsedDays === 0 ? 0 : -elapsedDays,
      label: elapsedDays === 0
        ? 'Link expired today'
        : `Link expired ${elapsedDays} ${plural(elapsedDays)} ago`,
    };
  }

  const daysLeft = Math.floor(remainingMs / DAY_MS);
  if (daysLeft <= EXPIRING_SOON_DAYS) {
    return {
      kind: 'expiring_soon',
      daysLeft,
      label: daysLeft === 0
        ? 'Link expires today'
        : daysLeft === 1
          ? 'Link expires tomorrow'
          : `Link expires in ${daysLeft} days`,
    };
  }

  return {
    kind: 'active',
    daysLeft,
    label: `Link active — expires in ${daysLeft} ${plural(daysLeft)}`,
  };
}

/**
 * Turn a chosen duration into the timestamp to store. `null` days = the GC
 * picked "No expiry", which stores NULL — the column's forever value.
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

/** "7 days" / "No expiry" — the picker chip label. */
export function durationLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'No expiry';
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
