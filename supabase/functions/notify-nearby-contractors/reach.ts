// reach.ts — who a homeowner RFP may alert, and what the homeowner is told.
//
// PURE: no Deno, no Supabase, no React. The edge function (index.ts) imports
// the matcher; the app (app/post-rfp.tsx, app/my-rfps.tsx) imports the copy;
// scripts/validate-rfp-marketplace-honesty.ts executes both. Keeping them in
// one file is the point — the sentence a homeowner reads about the fan-out is
// derived from the same rule that runs the fan-out.
//
// ── THE RULE (audit round 2, finding #8) ────────────────────────────────────
// A companies row alerts for an RFP only when it has a SERVICE AREA that
// covers it. The old matcher treated "no states" as "anywhere" and skipped
// the distance check when the origin was null, so a row nobody had ever set
// up matched every RFP in the country — and no screen in the app writes those
// columns, so every row that exists is exactly that row. "No service area"
// now means "not alerted": a contractor gets jobs where he said he works, or
// none, and the homeowner is told the real count.

export interface ServiceAreaLike {
  service_states?: unknown;
  service_radius_miles?: number | null;
  service_origin_lat?: number | string | null;
  service_origin_lng?: number | string | null;
}

export interface RfpPlaceLike {
  state?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

/** Default radius when a row has an origin but no radius (the column default). */
export const DEFAULT_RADIUS_MILES = 25;

// Haversine — miles between two lat/lng pairs.
export function distanceMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat); const lat2 = toRad(bLat);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when the company's declared service area covers the RFP.
 *
 * - No states AND no origin → no service area → false (was: true, everywhere).
 * - States set → the RFP's state must be one of them. An RFP whose state did
 *   not parse can still match on distance, never on states alone.
 * - Origin set → the RFP must have coordinates within the radius. An RFP with
 *   no coordinates can still match on states, never on an origin alone.
 */
export function companyServesRfp(c: ServiceAreaLike, rfp: RfpPlaceLike): boolean {
  const states = Array.isArray(c.service_states)
    ? (c.service_states as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim() !== '')
        .map(s => s.trim().toUpperCase())
    : [];
  const oLat = num(c.service_origin_lat), oLng = num(c.service_origin_lng);
  const rLat = num(rfp.latitude), rLng = num(rfp.longitude);
  const hasStates = states.length > 0;
  const hasOrigin = oLat !== null && oLng !== null;
  if (!hasStates && !hasOrigin) return false;

  const rfpState = (rfp.state ?? '').trim().toUpperCase();
  let stateOk: boolean | null = null; // null = could not tell
  if (hasStates && rfpState) stateOk = states.includes(rfpState);

  let distanceOk: boolean | null = null;
  if (hasOrigin && rLat !== null && rLng !== null) {
    const radius = num(c.service_radius_miles) ?? DEFAULT_RADIUS_MILES;
    distanceOk = distanceMiles(oLat as number, oLng as number, rLat, rLng) <= radius;
  }

  // Anything we could check must pass, and at least one thing must be checked.
  if (stateOk === false || distanceOk === false) return false;
  return stateOk === true || distanceOk === true;
}

// ── What the homeowner is told ──────────────────────────────────────────────

export interface RfpReachRow {
  notified_count?: number | null;
  notified_at?: string | null;
  verified_only?: boolean | null;
  posted_date?: string | null;
  created_at?: string | null;
}

export type ReachTone = 'pending' | 'none' | 'some' | 'unknown';

/** How long the fan-out may take before "checking" becomes "no report". It
 *  paces sends at 4/sec and is capped at 500, so ~2 minutes is the worst case;
 *  15 leaves room for pg_net retries without leaving a homeowner on
 *  "checking…" for a day. */
export const REACH_REPORT_GRACE_MS = 15 * 60 * 1000;

/** Only true while contractor browsing is switched on (RFP_BROWSE_ENABLED in
 *  constants/featureFlags.ts). This file stays pure — Deno imports it — so the
 *  flag is passed in by the app, never imported here. With browsing off
 *  (production today, runtime audit NAV-04) nearby-rfps never runs its query,
 *  so "your post stays listed" would be a promise no contractor can keep. */
export const STILL_LISTED = 'Your post stays listed for contractors who browse nearby jobs in MAGE ID.';
/** What is true instead while browsing is off: the alert is the only door. */
export const NOT_BROWSABLE = "Contractors can't browse posted projects in MAGE ID yet, so only alerted contractors see it.";

// ── Contractor matching (audit wave 5, #96) ─────────────────────────────────
// companyServesRfp alerts only a company with a service area, and no screen
// writes one yet — so while SERVICE_AREA_SETUP_ENABLED (constants/
// featureFlags.ts) is false NO post can reach anyone, and "until a contractor
// who covers your area joins" was a wait that joining could never end. The
// flag is passed in as `matchingLive` (this file stays pure — Deno imports
// it). There is no in-app way for a homeowner to invite a contractor to bid,
// so the sentence offers none.

/** The 0-reached case while matching is not live: say plainly nobody will see it. */
export const NOBODY_WILL_SEE = "Contractor matching by service area isn't live in MAGE ID yet, so no contractor will see this post.";
/** Same fact while browsing is ON: nobody is alerted, but the post is listed. */
export const NOBODY_ALERTED_MATCHING_OFF = "Contractor matching by service area isn't live in MAGE ID yet, so no contractor was alerted.";
/** The 0-reached case once matching IS live (a service-area editor exists):
 *  then a contractor who covers the area joining really does change it. */
export const NOBODY_COVERS_YET = 'Nobody will see this post until a contractor who covers your area joins.';

function afterAlert(browseOpen: boolean, noneAlerted: boolean): string {
  if (browseOpen) return STILL_LISTED;
  return noneAlerted ? `${NOT_BROWSABLE} ${NOBODY_COVERS_YET}` : NOT_BROWSABLE;
}

/** What a homeowner is told when matching is off and no delivered count says
 *  otherwise. `browseOpen` decides whether anyone can still find the post. */
function matchingOffLine(browseOpen: boolean): string {
  return browseOpen ? `${NOBODY_ALERTED_MATCHING_OFF} ${STILL_LISTED}` : NOBODY_WILL_SEE;
}

/**
 * The notice a homeowner reads BEFORE she posts (post-rfp, above Post), or
 * null when matching is live and the fan-out's own count will say who was
 * reached. Same flags, same sentences as the lines below.
 */
export function prePostReachNotice(browseOpen: boolean, matchingLive: boolean): string | null {
  if (matchingLive) return null;
  return browseOpen
    ? `${NOBODY_ALERTED_MATCHING_OFF} ${STILL_LISTED}`
    : `${NOBODY_WILL_SEE} You can still post it; My RFPs will show any bid that comes in.`;
}

/**
 * The one sentence a homeowner reads about who was alerted. Never a promise:
 * a number the fan-out reported, a plain zero, "still checking" for the first
 * minutes, or "no report" after that. `browseOpen` must be RFP_BROWSE_ENABLED:
 * whether anyone OTHER than an alerted contractor can find the post.
 * `matchingLive` must be SERVICE_AREA_SETUP_ENABLED: whether any contractor can
 * be matched at all. Anything but `true` counts as not live — the honest
 * default for a caller that forgot to pass it.
 */
export function rfpReachLine(
  row: RfpReachRow, nowMs: number, browseOpen: boolean, matchingLive?: boolean,
): { tone: ReachTone; text: string } {
  const live = matchingLive === true;
  if (row.notified_at && typeof row.notified_count === 'number') {
    // "alerted" is now what the number proves: the fan-out counts only the
    // contractors notify reports as `delivered` (a push or an email actually
    // sent), not every call that returned OK. Prefs off / no push token / no
    // email is not counted. A delivered count is a fact whatever the flag says.
    const n = row.notified_count;
    if (n > 0) {
      return {
        tone: 'some',
        text: `${n} contractor${n === 1 ? '' : 's'} who cover${n === 1 ? 's' : ''} your area ${n === 1 ? 'was' : 'were'} alerted${row.verified_only ? ' (license on file)' : ''}.${browseOpen ? '' : ` ${NOT_BROWSABLE}`}`,
      };
    }
    if (!live) return { tone: 'none', text: matchingOffLine(browseOpen) };
    return {
      tone: 'none',
      text: row.verified_only
        ? `No contractor with a license on file covers your area yet, so nobody was alerted. ${afterAlert(browseOpen, true)}`
        : `No MAGE ID contractor covers your area yet, so nobody was alerted. ${afterAlert(browseOpen, true)}`,
    };
  }
  // Matching off: there is nothing to wait for — no "checking…", no "no record".
  if (!live) return { tone: 'none', text: matchingOffLine(browseOpen) };
  const posted = Date.parse(row.posted_date ?? row.created_at ?? '');
  if (Number.isFinite(posted) && nowMs - posted < REACH_REPORT_GRACE_MS) {
    return { tone: 'pending', text: 'Checking which contractors cover your area…' };
  }
  return {
    tone: 'unknown',
    text: `We have no record of any contractor being alerted about this post. ${afterAlert(browseOpen, false)}`,
  };
}

/** The post-rfp success alert. The fan-out runs after the insert, so at this
 *  moment nobody has been alerted yet and the count is unknown — say that.
 *  While matching is not live (`matchingLive` !== true) nobody can be alerted
 *  at all, and the alert says so instead of describing a fan-out. */
export function postedAlertBody(
  city: string | null | undefined, verifiedOnly: boolean, browseOpen: boolean, matchingLive?: boolean,
): string {
  if (matchingLive !== true) {
    return `Your project is posted. ${matchingOffLine(browseOpen)} My RFPs will show any bid that comes in.`;
  }
  const where = (city ?? '').trim() || 'your area';
  return `Your project is live. We alert MAGE ID contractors who cover ${where}`
    + (verifiedOnly ? ' and have a license on file' : '')
    + ' — My RFPs shows how many were reached, including if that is none. '
    + (browseOpen ? STILL_LISTED : NOT_BROWSABLE);
}
