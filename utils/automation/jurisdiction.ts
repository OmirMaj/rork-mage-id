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
//   • isZoningConfirmed(project) — the gate the roadmap→schedule adapter checks.
//     Downstream (code requirements, auto-schedule) MUST call this and stay
//     blocked while it returns false.
//
// The guess source is behind an interface (ZoningGuessSource) so v1 can ship a
// harmless stub and a future AI / parcel API plugs in WITHOUT touching call
// sites or the confirm gate. We deliberately do NOT wire any paid API here.

import type { Project } from '@/types';
import { geocodeProjectLocation, type GeocodeResult } from '@/utils/geocodeProject';

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
  /** Geocode result from Nominatim, or null if geocoding failed. */
  geocode: GeocodeResult | null;
}

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
    const geocoded = ctx.geocode !== null;
    return {
      district: null,
      confidence: 'low',
      rationale: geocoded
        ? 'Address located, but no zoning source is connected — enter the district and confirm.'
        : 'Could not locate the address — enter the zoning district and confirm.',
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Pure resolution (no I/O) — reads what the project already has.
// ─────────────────────────────────────────────────────────────────────

/**
 * Is the project's zoning district CONFIRMED by a human? This is THE gate the
 * roadmap→schedule adapter and any code-requirement feature call. While it
 * returns false, downstream automation MUST stay blocked — a guessed district
 * never counts as confirmed no matter how confident.
 *
 * Confirmed requires BOTH a zoningConfirmedAt timestamp AND a non-empty
 * district AND zoningSource === 'confirmed'. All three so a stale/partial
 * write can never read as confirmed.
 */
export function isZoningConfirmed(project: Project): boolean {
  const sa = project.structuredAddress;
  if (!sa) return false;
  if (sa.zoningSource !== 'confirmed') return false;
  if (!sa.zoningConfirmedAt) return false;
  if (!sa.zoningDistrict || !sa.zoningDistrict.trim()) return false;
  // Guard a malformed timestamp — a confirm we can't date isn't a confirm.
  return Number.isFinite(Date.parse(sa.zoningConfirmedAt));
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
  if (isZoningConfirmed(project)) {
    return {
      district: project.structuredAddress!.zoningDistrict!.trim(),
      source: 'confirmed',
      confidence: 'high',
    };
  }
  const stored = project.structuredAddress?.zoningDistrict?.trim();
  if (stored) {
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
): Promise<ResolvedZoning & { rationale: string }> {
  if (isZoningConfirmed(project)) {
    return {
      district: project.structuredAddress!.zoningDistrict!.trim(),
      source: 'confirmed',
      confidence: 'high',
      rationale: 'Confirmed by a contractor.',
    };
  }

  const query = addressToQuery(project);
  const geocode = query ? await geocodeProjectLocation(query) : null;

  const sa: NonNullable<Project['structuredAddress']> =
    project.structuredAddress ?? { street: '', city: '', state: '', zip: '' };

  const guess = await source.guess({
    structuredAddress: sa,
    locationText: project.location,
    geocode,
  });

  // A guess is NEVER truth. Force source 'guess' regardless of what a source
  // returns — the only path to 'confirmed' is the human confirm setter.
  return {
    district: guess.district ? guess.district.trim() || null : null,
    source: 'guess',
    confidence: guess.confidence,
    rationale: guess.rationale,
  };
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
 * @param district the district the contractor confirmed (required, non-empty).
 * @param at ISO timestamp to stamp (defaults to now). Injectable so tests /
 *           the offline queue can pass a deterministic clock — but this is the
 *           ONE place time enters, and it is human-triggered, not automatic.
 * @throws if district is empty — you cannot "confirm" nothing.
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
  const base: NonNullable<Project['structuredAddress']> =
    project.structuredAddress ?? { street: '', city: '', state: '', zip: '' };
  return {
    ...base,
    zoningDistrict: trimmed,
    zoningConfirmedAt: at,
    zoningSource: 'confirmed',
  };
}

/**
 * Reason string for the confirm-gate / blocked-downstream UI. Kept here (not in
 * the component) so both the render and any headless caller show the SAME
 * honest message. Returns null when confirmed (nothing to block).
 */
export function zoningBlockedReason(project: Project): string | null {
  if (isZoningConfirmed(project)) return null;
  const stored = project.structuredAddress?.zoningDistrict?.trim();
  return stored
    ? `Confirm zoning: ${stored}? (we guessed from the address)`
    : 'Confirm zoning to enable code requirements and auto-scheduling.';
}
