// utils/automation/jurisdiction.ts
//
// TRUST-BUT-VERIFY zoning grounding for the automation engine (spec
// Component 4). The principle is non-negotiable: automation must NEVER
// present a guessed zoning district as truth. Everything here is built so a
// derived district carries provenance (`source: 'guess'`) and stays BLOCKED
// from driving code requirements / auto-scheduling until a human confirms it,
// at which point `zoningConfirmedAt` is stamped and `source` becomes
// 'confirmed'.
//
// What this module owns:
//   • resolveZoning(project) → { district, source, confidence } — reads the
//     project's structuredAddress. If already confirmed, returns the confirmed
//     district as truth. Otherwise returns the stored guess (or null) — it does
//     NOT itself fabricate a district (guessing is an async, pluggable step;
//     see resolveZoningAsync + the ZoningGuessSource interface).
//   • resolveZoningAsync(project, source?) — geocode (existing Nominatim) +
//     PLUGGABLE best-guess source. NEVER auto-confirms; the result is always
//     source: 'guess' with a confidence the guess source reports.
//   • confirmZoning(project, district) — the SETTER path a contractor confirm
//     calls. Stamps zoningConfirmedAt + zoningSource='confirmed'. Pure: returns
//     a new structuredAddress patch; the caller commits it via ProjectContext.
//   • isZoningConfirmed(project) — the gate. Its ONE consumer today is the
//     auto-schedule review sheet on app/(tabs)/construction-ai; no
//     code-requirement feature calls it yet, and saying otherwise in a comment
//     is how this file already misdescribed itself once. Anything that grows
//     into a downstream consumer MUST call this and stay blocked while it
//     returns false. It is a thin read of zoningGateState.
//   • zoningGateState(project) — the state machine behind the gate:
//     confirmed / unconfirmed / stale / laundered / unaddressable.
//   • describeZoningUnknown(project) — what we can honestly say when we do NOT
//     know the district, which is the MAJORITY case. See its comment.
//   • zoningPropForProject(project) — the exact prop the review sheet's zoning
//     gate is rendered from. It lives here, not in the .tsx, so the "an address
//     never reaches the district field" rule is provable by executing a
//     function instead of grepping a screen for a shape.
//
// THREE HOLES CLOSED 2026-09-12 (audit). Read these before "simplifying" any
// of the checks above, because each one is load-bearing:
//   1. A STREET ADDRESS COULD BE LAUNDERED INTO A CONFIRMED DISTRICT. The
//      screen fell back to `?? project.location` when no district was known,
//      and since nothing in this app ever writes a guessed district, that was
//      the LIVE path for every real project: the contractor confirmed their own
//      street address, and it read back as truth. WHAT IT ACTUALLY REACHED,
//      measured by grep and not assumed: the "Zoning confirmed: <value>" chip
//      the contractor is shown as fact, and the unblocking of the auto-schedule
//      commit. NOT an AI prompt and NOT the permit roadmap — an earlier version
//      of this comment claimed both, and one grep refutes it: no reader of
//      zoningDistrict exists outside this file, types/index.ts, the screen and
//      the validator, and utils/permitRoadmap.ts contains no "zoning" token.
//      The fallback is gone; the screen's prop now comes from
//      zoningPropForProject (below) so a guard can execute it instead of
//      grepping the .tsx; looksLikeAddressNotDistrict refuses that shape on the
//      write AND on the read (bad rows already sit on devices); and the unknown
//      case is a real, honest surface instead.
//   2. A CONFIRM OUTLIVED THE ADDRESS IT WAS MADE FOR. Confirms are now stamped
//      with zoningConfirmedFor — see zoningAddressKey for exactly which address
//      changes invalidate a confirm and which are deliberately harmless.
//      A STALE confirm is also no longer SURFACED: resolveZoning hides it the
//      way it hides a laundered one, because the sheet renders a one-tap
//      Confirm whenever it is handed a district, and one tap re-stamped the
//      previous town's answer onto the new parcel (found by the adversarial
//      review of the first fix, reproduced, and now pinned by execution).
//   3. resolveZoningAsync RE-GEOCODED ON EVERY CALL and could not tell a silent
//      geocode failure from "no district found". Stored coordinates come first
//      now, and GeocodeOrigin distinguishes the four cases. LATENT, NOT LIVE:
//      resolveZoningAsync has no production caller today (the screen uses the
//      pure resolveZoning), so no user ever paid for those requests. The fix
//      and its tests pin a seam that a real parcel API will use, and the
//      validator labels them as such rather than implying live traffic.
//
// WHERE A CONFIRM LIVES. There is no projects column for structuredAddress, so
// a confirm is DEVICE-LOCAL: ProjectContext's row→Project mapper carries the
// device's cached structuredAddress forward (it is not in the upsert payload,
// and without that carry the next successful projects fetch silently destroyed
// every confirm). A second device re-confirms. Persisting it properly needs a
// column + mapper + payload + migration, which this pass deliberately did not
// take on; what it would NOT do is leave the loss silent and undocumented.
//
// The guess source is behind an interface (ZoningGuessSource) so v1 can ship a
// harmless stub and a future AI / parcel API plugs in WITHOUT touching call
// sites or the confirm gate. We deliberately do NOT wire any paid API here.

import type { Project } from '@/types';
import { geocodeProjectLocation, type GeocodeResult } from '@/utils/geocodeProject';
import {
  codesSummary,
  issuingAuthorityForAddress,
  jobsiteAddressForProject,
  resolveCodeJurisdiction,
} from '@/utils/codeJurisdiction';

/** Provenance of a resolved district. 'guess' is NEVER truth downstream. */
export type ZoningSource = 'guess' | 'confirmed';

/** Confidence a guess source reports. Mirrors leadTimeLibrary vocabulary. */
export type ZoningConfidence = 'low' | 'med' | 'high';

export interface ResolvedZoning {
  /** The zoning district (e.g. 'R-5'), or null when nothing is known yet. */
  district: string | null;
  /**
   * Provenance. 'confirmed' ONLY when a human stamped zoningConfirmedAt;
   * everything derived is 'guess'. A guess is never presented as truth and
   * never unblocks downstream automation.
   */
  source: ZoningSource;
  /**
   * Confidence in `district`. A confirmed district is always 'high' (a human
   * verified it). A guess carries whatever the guess source reported; a null
   * district is 'low'.
   */
  confidence: ZoningConfidence;
}

// ─────────────────────────────────────────────────────────────────────
// Pluggable guess source (the seam a real AI / parcel API plugs into).
// ─────────────────────────────────────────────────────────────────────

/** Context a guess source gets: the parsed address + a geocode (if any). */
export interface ZoningGuessContext {
  structuredAddress: NonNullable<Project['structuredAddress']>;
  /** Free-text location fallback (project.location) when structured is thin. */
  locationText?: string;
  /** Coordinates for the jobsite, or null when we have none. */
  geocode: GeocodeResult | null;
  /** WHERE those coordinates came from — or why there are none. Without this a
   *  silent Nominatim failure is indistinguishable from "no district found",
   *  which is the third hole this module was audited for. */
  geocodeOrigin: GeocodeOrigin;
}

/**
 * Provenance of the coordinates a guess source was handed.
 *   'stored'      — the project's persisted locationLatitude/Longitude. FREE,
 *                   and the reason this is tried first: Nominatim allows about
 *                   one request a second and ProjectContext has already paid
 *                   for this address.
 *   'geocoded'    — we called the geocoder and it answered.
 *   'failed'      — we called the geocoder and it returned null. It fails
 *                   SILENTLY (utils/geocodeProject.ts swallows every error), so
 *                   this value is the only way anyone downstream can tell.
 *   'unattempted' — there was no address to geocode in the first place.
 */
export type GeocodeOrigin = 'stored' | 'geocoded' | 'failed' | 'unattempted';

export interface ZoningGuess {
  district: string | null;
  confidence: ZoningConfidence;
  /**
   * Human-readable provenance line for the confirm chip
   * (e.g. "guessed from the address"). Surfaced next to the guess so the
   * reviewer always sees WHERE it came from before confirming.
   */
  rationale: string;
}

/**
 * The seam. A guess source turns an address + geocode into a best-guess
 * district (or null). It is ALWAYS a guess — it can never set source
 * 'confirmed'; only the human confirm path does that.
 */
export interface ZoningGuessSource {
  readonly name: string;
  guess(ctx: ZoningGuessContext): Promise<ZoningGuess>;
}

/**
 * v1 default guess source. Deliberately HONEST: it does NOT invent a district
 * (we ship no grounded parcel data and wire no paid API). It returns null with
 * low confidence and a rationale that tells the contractor to enter/confirm the
 * district manually. A real AI/parcel source implements this same interface and
 * is passed to resolveZoningAsync — the confirm gate is unchanged either way.
 *
 * This keeps the non-negotiable principle intact at the seam: an empty guess is
 * honest; a fabricated district is not. When a real source lands it will return
 * a real district as a 'guess' — still blocked until confirmed.
 */
export const stubGuessSource: ZoningGuessSource = {
  name: 'stub',
  async guess(ctx: ZoningGuessContext): Promise<ZoningGuess> {
    // Four distinct sentences for four distinct situations. The old version had
    // two, so "the geocoder silently returned null" and "there is no address"
    // read identically — and neither was distinguishable from a zoning source
    // that answered "no district here".
    const RATIONALE: Record<GeocodeOrigin, string> = {
      stored: 'Located from the saved jobsite coordinates, but no zoning source is connected — enter the district and confirm.',
      geocoded: 'Address located, but no zoning source is connected — enter the district and confirm.',
      failed: 'The address lookup did not resolve this address, so nothing was checked against a map — enter the zoning district and confirm.',
      unattempted: 'No jobsite address to look up — add the address, then enter the zoning district and confirm.',
    };
    return { district: null, confidence: 'low', rationale: RATIONALE[ctx.geocodeOrigin] };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Pure resolution (no I/O) — reads what the project already has.
// ─────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────
// WHICH ADDRESS A CONFIRM WAS MADE FOR (the invalidation semantics).
// ─────────────────────────────────────────────────────────────────────

/**
 * A confirm is a statement about ONE PARCEL IN ONE MUNICIPALITY, so it has to
 * be stamped with that parcel and re-checked against the project's current
 * address. Without that, editing the jobsite from Garden City to Huntington
 * left "R-5" reading as confirmed truth for a town that may not even have an
 * R-5 (audit hole 2).
 *
 * WHAT THIS KEY DELIBERATELY INCLUDES, and why each one is load-bearing:
 *   state   — a different state is a different everything.
 *   city    — the municipality IS the zoning authority. On Long Island alone
 *             111 separate local governments set zoning and none of them share
 *             a district scheme; "R-5" in one village is not "R-5" in the next.
 *   street  — the house number and street, because zoning boundaries are drawn
 *             BLOCK BY BLOCK. Two doors down the same street can be a
 *             different district, so a different parcel is a different answer,
 *             not a typo. In practice the street comes from PARSING the
 *             free-text `location` (streetFromLocationText): no code path in
 *             this app writes a structured street, so before that parse existed
 *             this whole bullet was aspirational and the key was
 *             municipality-only for every real project. It is empty only when
 *             the address genuinely names no street ("Garden City, NY"), in
 *             which case the confirm honestly covers the municipality.
 *
 * WHAT IT DELIBERATELY EXCLUDES, because invalidating on these would nag the
 * contractor into confirming blind — which is the same failure as never
 * invalidating, just noisier:
 *   ZIP     — a postal routing artifact. ZIPs get corrected, gain a +4, and
 *             get re-drawn by the USPS without one parcel moving an inch.
 *   county  — enrichment, and usually derived. Filling in "Nassau" on an
 *             address that already said Garden City, NY tells us nothing new
 *             about the district; it is the same jobsite better described.
 *   unit /  — "Apt 2", "Suite 300", "#4", "Fl 3". A unit is INSIDE the parcel.
 *   suite     One building, one district, however many doors.
 *   spelling — case, punctuation, extra whitespace, and the usual suffix and
 *             directional abbreviations (St/Street, N/North). A typo fix is
 *             not a move, and treating it as one is exactly the nag above.
 *
 * Returns null when the address is too thin to identify a municipality at all
 * (no state, or no city/town). That is NOT a pass — see canConfirmZoning: a
 * confirm we cannot tie to a place is a confirm we cannot honour later.
 */
const STREET_SUFFIXES: Readonly<Record<string, string>> = {
  st: 'street', str: 'street', ave: 'avenue', av: 'avenue', rd: 'road',
  blvd: 'boulevard', dr: 'drive', ln: 'lane', ct: 'court', pl: 'place',
  ter: 'terrace', trl: 'trail', pkwy: 'parkway', hwy: 'highway', cir: 'circle',
  sq: 'square', tpke: 'turnpike', expy: 'expressway', aly: 'alley', way: 'way',
};

const DIRECTIONALS: Readonly<Record<string, string>> = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
};

/** Every token that marks a word as part of a STREET rather than a district —
 *  both spellings of each suffix ("st" and "street") plus the directionals.
 *  Built from the maps above so adding a suffix cannot forget one half. */
const STREET_WORDS: ReadonlySet<string> = new Set<string>([
  ...Object.keys(STREET_SUFFIXES), ...Object.values(STREET_SUFFIXES),
  ...Object.keys(DIRECTIONALS), ...Object.values(DIRECTIONALS),
]);

/**
 * Unit designators — everything from one of these to the end of the street
 * line is inside the building, not a different parcel. '#' is matched
 * separately because it is not a word character, so `\b#\b` never fires (the
 * validator caught exactly that: "123 Main St #4" was invalidating a confirm).
 *
 * The unit itself must contain a digit, or be a single letter ("Unit B"). That
 * is what stops the marker from eating a street NAME: without it, "123 Floor
 * Ave" loses everything after "123".
 */
const UNIT_MARKER =
  /(?:\b(?:apt|apartment|unit|ste|suite|fl|floor|rm|room|no)\b|#)[\s.#-]*(?:[a-z0-9-]*\d[a-z0-9-]*|[a-z])\s*$/i;

function normalizeAddressPart(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a street line to the PARCEL it names: unit stripped, suffixes and
 *  directionals spelled out, spacing and punctuation flattened. */
export function normalizeStreetLine(street: string): string {
  let s = normalizeAddressPart(street).replace(/#/g, ' # ').replace(/\s+/g, ' ').trim();
  // Strip a trailing unit ("... st apt 2", "... ave #4"). Run twice so
  // "Main St Apt 2 #B" collapses fully.
  for (let i = 0; i < 2; i += 1) s = s.replace(UNIT_MARKER, '').trim();
  return s
    .split(' ')
    .filter((w) => w.length > 0)
    .map((w) => DIRECTIONALS[w] ?? STREET_SUFFIXES[w] ?? w)
    .join(' ');
}

/**
 * The street line a free-text `location` names, or '' when it names none.
 *
 * THIS IS NOT COSMETIC. jobsiteAddressForProject's free-text branch returns
 * street: '' unconditionally, and nothing in this app writes a structured
 * street (the only writer of structuredAddress is the zoning confirm itself,
 * which writes street/city/state/zip as ''). So without this the key was
 * `state|city|` — municipality-only — for 100% of real projects, and a confirm
 * made for 123 Main St silently applied to 9 Stewart Ave a mile away. The
 * fixture-only tests for "a different house number invalidates" were green in
 * CI and unreachable in production; the adversarial review proved it by
 * execution.
 *
 * Anchored on the CITY the same parser found, and on its LAST occurrence, so
 * "9 Garden City Rd, Garden City, NY" keeps its street. Returns '' — i.e.
 * degrades to the old municipality-only key, never to a wrong one — when the
 * city is not in the text, is at position 0 (the text starts with the city, so
 * there is no street), or when there is no city at all.
 */
function streetFromLocationText(text: string, city: string): string {
  const raw = (text ?? '').trim();
  const c = city.trim();
  if (!raw || !c) return '';
  const idx = raw.toLowerCase().lastIndexOf(c.toLowerCase());
  if (idx <= 0) return '';
  return raw.slice(0, idx).replace(/[,\s]+$/, '').trim();
}

/**
 * The identity a zoning confirm is stamped with: `state|city|street`.
 * Null when the address cannot place a municipality (no state, or no city).
 *
 * The street segment is empty only when the address genuinely names no street
 * (a project whose location is just "Garden City, NY"). That is a real floor,
 * not a hidden one: such a confirm covers the whole municipality because the
 * municipality is all the project told us.
 */
export function zoningAddressKey(project: Project): string | null {
  // The SAME address resolution the code-jurisdiction surfaces use
  // (structuredAddress first, free-text `location` parsed as the fallback), so
  // the confirm gate and the AHJ chip can never disagree about where the job is.
  const addr = jobsiteAddressForProject(project);
  const state = normalizeAddressPart(addr.state);
  const city = normalizeAddressPart(addr.city);
  if (!state || !city) return null;
  // addr.street is '' on the free-text path — recover the parcel from the raw
  // location so the block-by-block semantics above are real and not aspirational.
  const street = addr.street.trim() || streetFromLocationText(project.location ?? '', addr.city);
  return `${state}|${city}|${normalizeStreetLine(street)}`;
}

/**
 * Does this string look like the jobsite address rather than a zoning
 * district? The laundering hole (audit hole 1) wrote `project.location` into
 * `zoningDistrict` and confirmed it, so a street address became "truth": shown
 * back on the "Zoning confirmed:" chip as fact, and enough to unblock the
 * auto-schedule commit (see the header for what it did NOT reach). This is the
 * check that makes that shape impossible — enforced on the WRITE (confirmZoning
 * throws) and again on the READ (isZoningConfirmed refuses), because the bad
 * rows already written to a device are not fixed by a write-side guard alone.
 */
export function looksLikeAddressNotDistrict(project: Project, district: string): boolean {
  const d = normalizeAddressPart(district);
  if (!d) return false;
  const addr = jobsiteAddressForProject(project);
  const candidates = [
    project.location ?? '',
    addr.street,
    [addr.street, addr.city, addr.state, addr.zip].filter((p) => p.trim()).join(' '),
    [addr.city, addr.state].filter((p) => p.trim()).join(' '),
  ];
  for (const c of candidates) {
    const n = normalizeAddressPart(c);
    if (n && (n === d || normalizeStreetLine(c) === normalizeStreetLine(district))) return true;
  }
  // A bare street address that was never stored on the project either: a
  // district is a code like "R-5" / "C-2" / "MU-3", never "900 Stewart Ave".
  //
  // NARROWED, on purpose. This used to be "a number, a space, and anything
  // else", which is a shape — not an address — and it hard-blocked every
  // district whose name starts with a number and a space, with no override
  // anywhere in the app: the contractor got "That is not a zoning district"
  // and no way past it. Whether any municipality names a district that way is
  // an empirical question this repo's firewall forbids answering from memory,
  // so the heuristic is narrowed instead of trusted: a house number followed
  // by a STREET WORD (a suffix or a directional, abbreviated or spelled out).
  // Every address the project actually holds is still caught above, by
  // comparison rather than by guesswork.
  const words = d.split(' ');
  if (/^\d+$/.test(words[0]) && words.length >= 2
    && words.slice(1).some((w) => STREET_WORDS.has(w))) return true;
  return false;
}

/** Why the gate is (or is not) blocking. One value, so the reason string, the
 *  UI panel and the validator all read the same state machine. */
export type ZoningGateState =
  /** A human confirmed this district FOR THIS ADDRESS. Downstream may run. */
  | 'confirmed'
  /** Nothing confirmed yet. */
  | 'unconfirmed'
  /** A confirm exists but was made for a different parcel/municipality. */
  | 'stale'
  /** The stored "confirmed" district is the address itself — legacy laundering. */
  | 'laundered'
  /** No city/state, so a confirm could not be tied to anywhere. */
  | 'unaddressable';

export function zoningGateState(project: Project): ZoningGateState {
  const sa = project.structuredAddress;
  const key = zoningAddressKey(project);
  const district = sa?.zoningDistrict?.trim() ?? '';
  const stamped =
    !!sa &&
    sa.zoningSource === 'confirmed' &&
    !!sa.zoningConfirmedAt &&
    Number.isFinite(Date.parse(sa.zoningConfirmedAt)) &&
    !!district;

  if (stamped && looksLikeAddressNotDistrict(project, district)) return 'laundered';
  if (!key) return stamped ? 'stale' : 'unaddressable';
  if (!stamped) return 'unconfirmed';
  // The comparison covers BOTH failure modes on purpose, and an explicit
  // `if (!sa.zoningConfirmedFor) return 'stale'` above it was removed because
  // mutating it away changed nothing — dead code that would have read like a
  // guard. An absent stamp is a confirm written before this field existed: we
  // do not know which jobsite it was made for, and `undefined !== key`, so it
  // reads stale. One re-confirm is cheap; silently trusting it is the bug this
  // whole section exists to close.
  return sa?.zoningConfirmedFor === key ? 'confirmed' : 'stale';
}

/**
 * Is the project's zoning district CONFIRMED by a human? THE gate. Its only
 * consumer today is the auto-schedule review sheet (via zoningPropForProject);
 * anything else that grows downstream — code requirements, a permit roadmap —
 * must call it too, and while it returns false that caller MUST stay blocked.
 * A guessed district never counts as confirmed no matter how confident.
 *
 * Confirmed requires a zoningConfirmedAt timestamp that parses, a non-empty
 * district, zoningSource === 'confirmed', a district that is not the jobsite
 * address wearing a district's name, AND a zoningConfirmedFor stamp that still
 * matches the project's current address. All of them, so a stale, partial or
 * laundered write can never read as confirmed.
 */
export function isZoningConfirmed(project: Project): boolean {
  return zoningGateState(project) === 'confirmed';
}

/**
 * Resolve the project's CURRENT zoning knowledge PURELY from what's stored — no
 * geocoding, no guess-source call. Use this in render paths / the gate.
 *
 *   • Confirmed → { district, source: 'confirmed', confidence: 'high' }.
 *   • A stored (unconfirmed) district → returned as a 'guess' (never truth).
 *   • Nothing stored → { district: null, source: 'guess', confidence: 'low' }.
 *
 * Never returns source 'confirmed' unless isZoningConfirmed(project) is true.
 */
export function resolveZoning(project: Project): ResolvedZoning {
  const state = zoningGateState(project);
  if (state === 'confirmed') {
    return {
      district: project.structuredAddress!.zoningDistrict!.trim(),
      source: 'confirmed',
      confidence: 'high',
    };
  }
  const stored = project.structuredAddress?.zoningDistrict?.trim();
  // TWO stored values are NOT surfaced, not even as a guess, because the review
  // sheet renders a ONE-TAP Confirm for any district it is handed:
  //
  //   laundered — the stored value IS the jobsite address. Offering "Confirm
  //     zoning: 124 Park Slope, Brooklyn NY 11215?" would leave it one tap from
  //     being truth again, which is the hole that was closed.
  //   stale — the stored value was confirmed FOR A DIFFERENT PARCEL. This is
  //     the same bug wearing a different hat, and the first fix missed it: with
  //     Garden City's "R-5" still surfaced after the job moved to Huntington,
  //     one tap re-stamped Garden City's answer onto Huntington's parcel and
  //     unblocked the auto-schedule commit. Executed, before and after.
  //
  // In both cases zoningBlockedReason still QUOTES the stored value, so the
  // contractor reads what was confirmed and why it is being ignored — and with
  // no district in hand the sheet shows the district INPUT instead, which is
  // the only control that can produce a right answer for the new address.
  const hidden = state === 'laundered' || state === 'stale';
  if (stored && !hidden && !looksLikeAddressNotDistrict(project, stored)) {
    return { district: stored, source: 'guess', confidence: 'low' };
  }
  return { district: null, source: 'guess', confidence: 'low' };
}

// ─────────────────────────────────────────────────────────────────────
// Async resolution — geocode + pluggable guess. NEVER auto-confirms.
// ─────────────────────────────────────────────────────────────────────

/** Compose the free-text location a geocoder can use from structured parts. */
function addressToQuery(project: Project): string {
  const sa = project.structuredAddress;
  if (sa) {
    const parts = [sa.street, sa.city, sa.state, sa.zip].filter(
      (p): p is string => !!p && !!p.trim(),
    );
    if (parts.length > 0) return parts.join(', ');
  }
  return (project.location || '').trim();
}

/**
 * Resolve zoning by geocoding (existing Nominatim) then asking a PLUGGABLE
 * guess source. The result is ALWAYS a 'guess' — this function NEVER confirms.
 * The caller shows it behind a confirm gate; confirmZoning is the only path to
 * 'confirmed'.
 *
 * If the project is already confirmed, we short-circuit and return the confirmed
 * value (no need to re-guess a verified district).
 *
 * @param source injected guess source; defaults to the honest stub (no paid API).
 */
export async function resolveZoningAsync(
  project: Project,
  source: ZoningGuessSource = stubGuessSource,
): Promise<ResolvedZoning & { rationale: string; geocodeOrigin: GeocodeOrigin }> {
  if (isZoningConfirmed(project)) {
    return {
      district: project.structuredAddress!.zoningDistrict!.trim(),
      source: 'confirmed',
      confidence: 'high',
      rationale: 'Confirmed by a contractor.',
      // Nothing was looked up: a confirmed district short-circuits before any
      // network call, and saying 'failed' here would be a lie about a request
      // that never happened.
      geocodeOrigin: 'unattempted',
    };
  }

  // STORED COORDINATES FIRST. ProjectContext already geocodes on save/update
  // and persists locationLatitude/locationLongitude; re-asking Nominatim on
  // every call spent a rate-limited (≈1 req/s) request to re-learn a fact the
  // project is carrying. Only fall through to the network when we have none.
  const stored = storedCoords(project);
  let geocode: GeocodeResult | null = stored;
  let geocodeOrigin: GeocodeOrigin = stored ? 'stored' : 'unattempted';

  if (!geocode) {
    const query = addressToQuery(project);
    if (query) {
      geocode = await geocodeProjectLocation(query);
      // geocodeProjectLocation returns null for a network error, a non-200, an
      // empty result set and a malformed body alike, all without throwing. We
      // cannot tell those apart from here — but we CAN stop them from reading
      // as "we looked and there is no district".
      geocodeOrigin = geocode ? 'geocoded' : 'failed';
    }
  }

  const sa: NonNullable<Project['structuredAddress']> =
    project.structuredAddress ?? { street: '', city: '', state: '', zip: '' };

  const guess = await source.guess({
    structuredAddress: sa,
    locationText: project.location,
    geocode,
    geocodeOrigin,
  });

  // A guess is NEVER truth. Force source 'guess' regardless of what a source
  // returns — the only path to 'confirmed' is the human confirm setter.
  return {
    district: guess.district ? guess.district.trim() || null : null,
    source: 'guess',
    confidence: guess.confidence,
    rationale: guess.rationale,
    geocodeOrigin,
  };
}

/** The project's persisted jobsite coordinates, when they are real numbers in
 *  range. A 0/0 pair is a real point in the Gulf of Guinea, so it is NOT
 *  filtered — but NaN, Infinity and out-of-range values are, because those are
 *  corrupt writes rather than places. */
function storedCoords(project: Project): GeocodeResult | null {
  const lat = project.locationLatitude;
  const lng = project.locationLongitude;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { latitude: lat, longitude: lng };
}

// ─────────────────────────────────────────────────────────────────────
// The CONFIRM setter path — the ONLY way to reach 'confirmed'.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the structuredAddress patch for a contractor confirm. PURE: returns a
 * new structuredAddress object; the caller commits it (e.g.
 * ProjectContext.updateProject({ structuredAddress })). Stamps
 * zoningConfirmedAt + zoningSource='confirmed' and records the confirmed
 * district.
 *
 * Also stamps `zoningConfirmedFor` — the address the confirm was made for —
 * which is what lets isZoningConfirmed refuse it again after the jobsite moves.
 *
 * @param district the district the contractor confirmed (required, non-empty).
 * @param at ISO timestamp to stamp (defaults to now). Injectable so tests /
 *           the offline queue can pass a deterministic clock — but this is the
 *           ONE place time enters, and it is human-triggered, not automatic.
 * @throws if district is empty — you cannot "confirm" nothing.
 * @throws if district is the jobsite address — a street address is not a
 *         district, and confirming one is how a guess became "truth".
 * @throws if the project has no city/state — a confirm we cannot tie to a
 *         municipality is a confirm we cannot honour or invalidate later.
 */
export function confirmZoning(
  project: Project,
  district: string,
  at: string = new Date().toISOString(),
): NonNullable<Project['structuredAddress']> {
  const trimmed = (district || '').trim();
  if (!trimmed) {
    throw new Error('confirmZoning: district is required — cannot confirm an empty district.');
  }
  if (looksLikeAddressNotDistrict(project, trimmed)) {
    throw new Error(
      `confirmZoning: "${trimmed}" is the jobsite address, not a zoning district. A district is the municipality's code for the parcel (e.g. "R-5"); confirming an address would present a guess as truth.`,
    );
  }
  const key = zoningAddressKey(project);
  if (!key) {
    throw new Error(
      'confirmZoning: the project has no city/state, so a confirm cannot be tied to a jobsite. Set the address first.',
    );
  }
  const base: NonNullable<Project['structuredAddress']> =
    project.structuredAddress ?? { street: '', city: '', state: '', zip: '' };
  return {
    ...base,
    zoningDistrict: trimmed,
    zoningConfirmedAt: at,
    zoningSource: 'confirmed',
    zoningConfirmedFor: key,
  };
}

/** May the contractor confirm at all right now, and if not, why not? The UI
 *  asks this BEFORE offering a confirm control, so confirmZoning's throws stay
 *  programmer errors rather than something a user can trigger. */
export function canConfirmZoning(project: Project): { ok: true } | { ok: false; reason: string } {
  if (zoningAddressKey(project) === null) {
    return {
      ok: false,
      reason:
        'Add the jobsite city and state first — a zoning district only means something for a specific address.',
    };
  }
  return { ok: true };
}

/**
 * Reason string for the confirm-gate / blocked-downstream UI. Kept here (not in
 * the component) so both the render and any headless caller show the SAME
 * honest message. Returns null when confirmed (nothing to block).
 *
 * NOTE the stale wording: it names the district that WAS confirmed and says
 * the address changed, rather than silently dropping it. The contractor who
 * moved a job to a new town needs to see why they are being asked again — an
 * unexplained re-prompt is how people learn to confirm without reading.
 */
export function zoningBlockedReason(project: Project): string | null {
  const state = zoningGateState(project);
  const stored = project.structuredAddress?.zoningDistrict?.trim();
  switch (state) {
    case 'confirmed':
      return null;
    case 'unaddressable': {
      const can = canConfirmZoning(project);
      return can.ok ? 'Confirm zoning to enable code requirements and auto-scheduling.' : can.reason;
    }
    case 'laundered':
      return `"${stored}" was recorded as this project's zoning district, but it is the jobsite address — not a district. Enter the district the municipality assigned this parcel.`;
    case 'stale':
      return stored
        ? `The jobsite address changed since "${stored}" was confirmed, and zoning districts do not travel with a job. Confirm the district for the current address.`
        : 'Confirm zoning to enable code requirements and auto-scheduling.';
    default:
      return stored
        ? `Confirm zoning: ${stored}? (we guessed from the address)`
        : 'Confirm zoning to enable code requirements and auto-scheduling.';
  }
}

// ─────────────────────────────────────────────────────────────────────
// THE UNKNOWN CASE — which is the NORMAL case, so it gets the real copy.
// ─────────────────────────────────────────────────────────────────────

/**
 * What MAGE can honestly say when it does NOT know the district — which, on
 * the evidence, is nearly every address. Long Island outside New York City has
 * 113 local AHJs and 111 of them set zoning (13 towns, 2 cities, 96
 * incorporated villages); neither county publishes a zoning layer and neither
 * does the state, and of 112 zoning authorities probed exactly 2 answer a
 * machine query. So "we don't know your district" is not an error path to be
 * papered over with a blank — it is the product's normal answer, and the useful
 * thing it can do is tell the contractor WHO to ask.
 *
 * The precedent is the Town of Huntington's own zoning layer, which returns
 * Zone = "Call Village" for a parcel inside an incorporated village rather than
 * guessing on the village's behalf. This function is that behaviour: it names
 * the PLACE from the address WITHOUT claiming it is the governing body (see
 * zoningAuthorityNote — the parse cannot tell a village from a borough, a CDP
 * or a county), hands over the verified code-adoption record if the table has
 * one (clearly labelled as the BUILDING CODE, which is not zoning), and asks.
 *
 * EVERY FIELD IS DERIVED FROM DATA ALREADY IN THE PROJECT OR FROM THE CITED
 * TABLE IN utils/codeJurisdiction.ts. Nothing here is recalled, and no zoning
 * district, setback or dimensional rule is ever produced — this function
 * cannot return a district at all, by design.
 */
export interface ZoningUnknownFacts {
  /** "Garden City, NY" — the jobsite as MAGE has it, or null if unknown. */
  jobsiteLabel: string | null;
  /**
   * THE PLACE THE ADDRESS NAMES — NOT a verified governing body. Read
   * zoningAuthorityNote before rendering this anywhere: on its own it is just
   * the parsed place, and the parse cannot tell a village (which zones) from a
   * borough, a census-designated place or a county (which do not).
   */
  zoningAuthorityLabel: string | null;
  /**
   * The sentence to SHOW about who sets zoning here, hedged to exactly what we
   * verified. Null when the address names no place at all.
   */
  zoningAuthorityNote: string | null;
  /** The office that ISSUES permits, when the cited table names one. Null is a
   *  real answer — most addresses have no row. */
  permitAuthority: string | null;
  /** The adopted BUILDING code (not zoning) from the verified table. */
  codeSummary: string | null;
  /** The page that record was read off, and when. Both null together. */
  codeSourceUrl: string | null;
  codeCheckedOn: string | null;
  /** The one-line ask. Never contains an address in a district's place. */
  ask: string;
}

export function describeZoningUnknown(project: Project): ZoningUnknownFacts {
  const addr = jobsiteAddressForProject(project);
  const city = addr.city.trim();
  const state = addr.state.trim();
  const jobsiteLabel = city && state ? `${city}, ${state}` : city || state || null;

  const resolved = resolveCodeJurisdiction({ city, county: addr.county, state });
  const grounded = resolved.kind !== 'unknown' ? resolved.entry : null;

  const placeLabel = city ? (state ? `${city}, ${state}` : city) : null;

  return {
    jobsiteLabel,
    // THE PLACE, NOT A CLAIM ABOUT IT. This used to read "<place> writes the
    // district map for this parcel", asserted for whatever the address parse
    // produced — and the parse produces boroughs ("Brooklyn", where the panel's
    // own next line correctly names the NYC Department of Buildings), census
    // designated places with no government to ask ("Levittown", "Elmont"), and
    // counties ("Nassau County", which this module's own header says does not
    // zone). Every one of those was a governing body stated from inference,
    // which is the same species of error as a code edition written from recall.
    //
    // WHAT IS ACTUALLY VERIFIED, and all that is claimed below: zoning on Long
    // Island outside NYC is set LOCALLY — 111 of 113 AHJs, being 13 towns, 2
    // cities and 96 incorporated villages; neither county publishes a zoning
    // layer and neither does the state. WHICH of those covers a given parcel is
    // exactly what MAGE has not looked up, and the note says so. The Nassau
    // County Place Boundaries layer (PTYPE C/V/U + PLABEL + TOWN) would answer
    // it without claiming a district; until that is wired, we hedge.
    zoningAuthorityLabel: placeLabel,
    zoningAuthorityNote: placeLabel
      ? `Zoning is set locally — by the village, town or city that governs this parcel, not by the county or the state. MAGE has not verified which one covers ${placeLabel}.`
      : null,
    permitAuthority: issuingAuthorityForAddress({ city, county: addr.county, state }),
    codeSummary: grounded ? codesSummary(grounded.codes) : null,
    codeSourceUrl: grounded ? grounded.sourceUrl : null,
    codeCheckedOn: grounded ? grounded.checkedOn : null,
    // NO PLACE NAME IN THE ASK. The note above already names the jobsite and
    // says plainly that MAGE has not established which body covers it; naming
    // it again here reads as "ask THEM", which is the claim that was withdrawn.
    // What is left is verified and still actionable.
    ask: placeLabel
      ? 'MAGE has no zoning record for this address. Zoning here is set by the local village, town or city — look up the parcel on its zoning map, or ask its building department, then enter the district here.'
      : 'MAGE has no zoning record for this address. Add the jobsite city and state, then enter the district the municipality assigned this parcel.',
  };
}

// ─────────────────────────────────────────────────────────────────────
// THE SCREEN'S PROP — derived here so it can be EXECUTED by a guard.
// ─────────────────────────────────────────────────────────────────────

/**
 * Exactly what the auto-schedule review sheet's zoning gate renders from.
 * Structurally the component's `ZoningGate` (the component keeps owning its own
 * prop type; this is the producer, so no util→component import exists).
 */
export interface ZoningPanelProps {
  /** ONLY EVER A REAL DISTRICT, and undefined when there is none. The sheet
   *  renders a one-tap Confirm for whatever lands here, so an address or a
   *  district confirmed for another parcel arriving in this field is one tap
   *  from being truth. Both are refused upstream, by resolveZoning. */
  district?: string;
  status: 'guess' | 'confirmed';
  reason?: string;
  unknown?: ZoningUnknownFacts;
  canConfirm: boolean;
}

/**
 * Build the sheet's zoning prop from a project.
 *
 * WHY THIS IS NOT INLINE IN THE .tsx, WHICH IS WHERE IT LIVED. The rule it
 * enforces — the jobsite address never reaches the `district` field — was
 * guarded only by two source-text regexes over the screen. The adversarial
 * review reintroduced the laundering behaviourally, with an intermediate
 * binding, and left both regexes satisfied: 97 passed, 0 failed. A regex over a
 * shape is not a test of behaviour. As a pure function this is executed against
 * a real project fixture and the OUTPUT is asserted, which is the only form of
 * this guard that a rename or a rewrite cannot walk past.
 */
export function zoningPropForProject(project: Project): ZoningPanelProps {
  const resolved = resolveZoning(project);
  const confirmed = resolved.source === 'confirmed';
  return {
    district: resolved.district ?? undefined,
    status: confirmed ? 'confirmed' : 'guess',
    reason: zoningBlockedReason(project) ?? undefined,
    // The honest unknown panel is for the blocked states only — a confirmed
    // project has nothing to be told about who to ask.
    unknown: confirmed ? undefined : describeZoningUnknown(project),
    canConfirm: canConfirmZoning(project).ok,
  };
}
