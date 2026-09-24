// prequalEngine.ts — auto-review a submitted PrequalPacket against its
// criteria and return structured findings. The result is both stored on
// the packet (`autoReviewFindings`) and surfaced in the reviewer UI so a
// human can override on edge cases (e.g. Utah/Pennsylvania WC quirks,
// state-specific endorsement forms).
//
// Philosophy: if every criterion passes AND no obvious red flag (expired
// COI, W-9 missing on a US sub, no written safety program), we flip the
// packet to 'approved' automatically. Anything ambiguous goes to
// 'needs_changes' with a pointer to the missing field — the sub doesn't
// get stuck, they get a clear checklist.

import type { PrequalPacket, PrequalCriteria, PrequalLicense } from '@/types';

export interface PrequalFinding {
  criterion: string;
  /** Human-readable explanation of what we checked. */
  label: string;
  passed: boolean;
  note?: string;
  /** 'blocker' means we cannot auto-approve without this. 'advisory' is informational. */
  severity: 'blocker' | 'advisory';
}

export interface PrequalReviewResult {
  overall: 'pass' | 'fail' | 'needs_info';
  findings: PrequalFinding[];
  /** Short one-liner for the reviewer UI. */
  summary: string;
  /** Fields the sub still needs to fill in. */
  missingFields: string[];
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A sub-typed date, read strictly: `YYYY-MM-DD` naming a real calendar day, or
 * null. Surrounding whitespace is ignored.
 *
 * The COI and licence expiry fields are free text the sub types on a phone.
 * `new Date('next March')` is NaN, and NaN fails every comparison — `days < 0`
 * and `days < 30` were both false, so "next March" fell through to "COI valid"
 * and "Auto-review passed. Ready for approval." (Q5, 2026-09-24). `new Date`
 * also ROLLS invalid days over ('2026-02-30' → March 2) and parses non-ISO
 * shapes differently per engine (Hermes vs V8), so the only rule that means
 * the same thing on the sub's phone, the GC's laptop and this validator is
 * the strict one: the shape, and a round trip that lands on the same day.
 */
export function parsePrequalDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE_RE.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * What the sub typed → the `YYYY-MM-DD` the engine reads, or null when it
 * cannot be read without guessing. Used by the form on blur, so "12/31/2026"
 * becomes "2026-12-31" instead of an error. US order only (M/D/YYYY) — this is
 * a US product, and a two-digit year or a word is refused rather than guessed.
 */
export function normalizePrequalDateInput(input: string): string | null {
  const t = input.trim();
  const strict = parsePrequalDate(t);
  if (strict) return strict;
  const ymd = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(t);
  if (ymd) return parsePrequalDate(`${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}`);
  const mdy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (mdy) return parsePrequalDate(`${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`);
  return null;
}

/**
 * Packets are user-authored JSON round-tripped through Supabase/AsyncStorage,
 * so a field the TYPE says is an array can arrive as an object, a bare number
 * or a JSON string. `?? []` only guards null/undefined — a non-array sails
 * through and blows up on `.find` / `.filter` / `.length`.
 *
 * app/prequal-manager.tsx has no route-level error boundary; the only one in
 * the tree wraps the whole app, so a single malformed packet used to blank the
 * entire screen. An empty array is the state this engine already handles
 * correctly for "nothing on file", so it is a safe — not silently wrong —
 * default here.
 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Same corruption class as the array fields, one level up: `packet.safety`,
 * `.insurance`, `.financials` and `.criteria` are typed non-optional objects but
 * arrive from user-authored JSON, so any of them can be missing, null, or a
 * primitive. `packet.safety.emr3yr` on a null `safety` threw
 * "undefined is not an object (evaluating 'packet.safety.emr3yr')" — the closest
 * corruption to the reported crash. `?? {}` gives an empty object whose fields
 * all read as undefined, which every downstream check already treats as "not on
 * file" (missingFields collects them, the packet degrades to needs_info — it is
 * never silently approved; test 6 in the validator pins that). A non-object
 * (number/string) is also coerced to {} so a `.<sub>` access can't throw. */
function asObject<T>(value: unknown): Partial<T> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<T>)
    : {};
}

export function reviewPrequalPacket(packet: PrequalPacket): PrequalReviewResult {
  const rawCriteria = asObject<PrequalCriteria>(packet.criteria);
  // The numeric criteria are read straight into `.toLocaleString()` / `.toFixed()`
  // in the finding labels, so a missing `criteria` (or a criteria object with a
  // missing/non-numeric threshold) must default to a concrete number or those
  // format calls throw. `0` means "no minimum" — the same as an unset threshold —
  // which is the safe, non-inventive default when the GC hasn't set a bar.
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const c: PrequalCriteria = {
    ...rawCriteria,
    minCglPerOccurrence: num(rawCriteria.minCglPerOccurrence),
    minCglAggregate: num(rawCriteria.minCglAggregate),
    maxEmr: num(rawCriteria.maxEmr),
    minYearsInBusiness: num(rawCriteria.minYearsInBusiness),
  } as PrequalCriteria;
  const safety = asObject<PrequalPacket['safety']>(packet.safety);
  const financials = asObject<PrequalPacket['financials']>(packet.financials);
  const insurance = asObject<PrequalPacket['insurance']>(packet.insurance);
  const findings: PrequalFinding[] = [];
  const missingFields: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // ─── Insurance ────────────────────────────────────────────────
  const cglOcc = insurance.cglPerOccurrence ?? 0;
  findings.push({
    criterion: 'cgl_per_occurrence',
    label: `CGL per occurrence ≥ $${c.minCglPerOccurrence.toLocaleString()}`,
    passed: cglOcc >= c.minCglPerOccurrence,
    note: cglOcc > 0 ? `$${cglOcc.toLocaleString()}` : 'Not provided',
    severity: 'blocker',
  });
  if (cglOcc === 0) missingFields.push('CGL per-occurrence limit');

  const cglAgg = insurance.cglAggregate ?? 0;
  findings.push({
    criterion: 'cgl_aggregate',
    label: `CGL aggregate ≥ $${c.minCglAggregate.toLocaleString()}`,
    passed: cglAgg >= c.minCglAggregate,
    note: cglAgg > 0 ? `$${cglAgg.toLocaleString()}` : 'Not provided',
    severity: 'blocker',
  });
  if (cglAgg === 0) missingFields.push('CGL aggregate limit');

  if (c.requireWorkersComp) {
    findings.push({
      criterion: 'workers_comp',
      label: 'Workers Comp active',
      passed: !!insurance.workersCompActive,
      note: insurance.workersCompCarrier ?? undefined,
      severity: 'blocker',
    });
    if (!insurance.workersCompActive) missingFields.push('Workers Comp confirmation');
  }

  if (c.requireCG2010) {
    findings.push({
      criterion: 'cg_20_10',
      label: 'CG 20 10 (ongoing ops, additional insured)',
      passed: !!insurance.hasCG2010,
      note: insurance.hasCG2010 ? 'Attested' : 'Missing endorsement',
      severity: 'blocker',
    });
    if (!insurance.hasCG2010) missingFields.push('CG 20 10 endorsement');
  }

  if (c.requireCG2037) {
    findings.push({
      criterion: 'cg_20_37',
      label: 'CG 20 37 (completed ops, additional insured)',
      passed: !!insurance.hasCG2037,
      note: insurance.hasCG2037 ? 'Attested' : 'Missing endorsement',
      severity: 'blocker',
    });
    if (!insurance.hasCG2037) missingFields.push('CG 20 37 endorsement');
  }

  // COI expiry — fail if expired or unreadable, warn if within 30 days.
  // Blank (or whitespace) is "not provided"; anything else must read as a real
  // YYYY-MM-DD day, or it is a blocker the sub can fix — never "COI valid".
  const coiRaw = typeof insurance.coiExpiry === 'string' ? insurance.coiExpiry.trim() : '';
  const coiDate = parsePrequalDate(coiRaw);
  if (coiRaw && !coiDate) {
    findings.push({
      criterion: 'coi_expiry',
      label: 'COI expiry date readable',
      passed: false,
      note: `Unreadable date: "${coiRaw}" — enter it as YYYY-MM-DD`,
      severity: 'blocker',
    });
    missingFields.push('COI expiry date (YYYY-MM-DD)');
  } else if (coiDate) {
    const days = daysBetween(coiDate, today);
    if (days < 0) {
      findings.push({
        criterion: 'coi_expiry',
        label: 'COI not expired',
        passed: false,
        note: `Expired ${Math.abs(days)} days ago`,
        severity: 'blocker',
      });
    } else if (days < 30) {
      findings.push({
        criterion: 'coi_expiry',
        label: 'COI not expiring soon',
        passed: true,
        note: `Expires in ${days} days — renew before project start`,
        severity: 'advisory',
      });
    } else {
      findings.push({
        criterion: 'coi_expiry',
        label: 'COI valid',
        passed: true,
        note: `Expires ${coiDate}`,
        severity: 'advisory',
      });
    }
  } else {
    findings.push({
      criterion: 'coi_expiry',
      label: 'COI expiry date provided',
      passed: false,
      note: 'Missing',
      severity: 'blocker',
    });
    missingFields.push('COI expiry date');
  }

  // ─── Business ─────────────────────────────────────────────────
  if (c.requireW9) {
    findings.push({
      criterion: 'w9',
      label: 'W-9 on file',
      passed: !!packet.w9OnFile,
      severity: 'blocker',
    });
    if (!packet.w9OnFile) missingFields.push('W-9 form');
  }

  if (c.minYearsInBusiness > 0) {
    const years = financials.yearsInBusiness ?? 0;
    findings.push({
      criterion: 'years_in_business',
      label: `${c.minYearsInBusiness}+ years in business`,
      passed: years >= c.minYearsInBusiness,
      note: `${years || 'Not provided'}`,
      severity: years === 0 ? 'blocker' : 'advisory',
    });
    if (years === 0) missingFields.push('Years in business');
  }

  // ─── Safety ───────────────────────────────────────────────────
  if (c.maxEmr < 2.0) {
    const emrs = asArray<number | undefined>(safety.emr3yr);
    const latest = emrs.find(v => typeof v === 'number' && Number.isFinite(v));
    if (typeof latest === 'number') {
      findings.push({
        criterion: 'emr',
        label: `3-yr EMR ≤ ${c.maxEmr.toFixed(2)}`,
        passed: latest <= c.maxEmr,
        note: `Latest reported: ${latest.toFixed(2)}`,
        severity: 'advisory',
      });
    }
  }

  findings.push({
    criterion: 'written_safety_program',
    label: 'Written safety program',
    passed: !!safety.writtenSafetyProgram,
    severity: 'advisory',
  });

  // ─── License ──────────────────────────────────────────────────
  // We don't require a license for every trade (e.g. painting in many
  // states), but if one is present it must not be expired.
  // Same non-array hazard as emr3yr above: `packet.licenses` is typed
  // non-optional but arrives from JSON, and `.filter` on a bare object threw.
  const licenses = asArray<PrequalLicense>(packet.licenses);
  // Same NaN hole as the COI date: an unreadable licence expiry compared false
  // against 0, so it counted as current. A blank one is still "no date given"
  // (not every licence form carries one); a typed one must read.
  const licRaw = (l: PrequalLicense | null | undefined) => (typeof l?.expiresAt === 'string' ? l.expiresAt.trim() : '');
  const unreadableLicenses = licenses.filter(l => licRaw(l) !== '' && !parsePrequalDate(licRaw(l)));
  const expiredLicenses = licenses.filter(l => {
    const d = parsePrequalDate(licRaw(l));
    return !!d && daysBetween(d, today) < 0;
  });
  if (unreadableLicenses.length > 0) {
    findings.push({
      criterion: 'license_date_unreadable',
      label: 'Licence expiry dates readable',
      passed: false,
      note: `Unreadable: ${unreadableLicenses.map(l => `${l.state || 'licence'} "${licRaw(l)}"`).join(', ')} — enter as YYYY-MM-DD`,
      severity: 'blocker',
    });
    missingFields.push('Licence expiry date (YYYY-MM-DD)');
  }
  if (expiredLicenses.length > 0) {
    findings.push({
      criterion: 'license_expired',
      label: 'All licenses current',
      passed: false,
      note: `${expiredLicenses.length} expired (${expiredLicenses.map(l => l.state).join(', ')})`,
      severity: 'blocker',
    });
  } else if (licenses.length > 0 && unreadableLicenses.length === 0) {
    findings.push({
      criterion: 'license_current',
      label: 'Licenses current',
      passed: true,
      note: `${licenses.length} on file`,
      severity: 'advisory',
    });
  }

  // ─── Roll-up ──────────────────────────────────────────────────
  const blockers = findings.filter(f => f.severity === 'blocker' && !f.passed);
  const overall: PrequalReviewResult['overall'] =
    blockers.length === 0 ? 'pass' :
    missingFields.length > 0 ? 'needs_info' : 'fail';

  const summary = overall === 'pass'
    ? 'Auto-review passed. Ready for approval.'
    : overall === 'needs_info'
      ? `${missingFields.length} field${missingFields.length === 1 ? '' : 's'} missing — send back to sub.`
      : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} — not eligible.`;

  return { overall, findings, summary, missingFields };
}

/** Magic-link token length. 32 characters from a 54-character alphabet is
 *  ~184 bits; the lien-waiver RPCs set the same 32-character floor. */
export const PREQUAL_TOKEN_LENGTH = 32;
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
/** Largest multiple of the alphabet size that fits in a byte (54 × 4 = 216).
 *  Bytes at or above it are dropped, so every character is equally likely —
 *  a plain `byte % 54` would favour the first 40 characters. */
const TOKEN_BYTE_CEILING = Math.floor(256 / TOKEN_ALPHABET.length) * TOKEN_ALPHABET.length;

/**
 * The magic-link token from CSPRNG bytes (utils/prequalToken.ts supplies them
 * from expo-crypto — never Math.random). The token is the only thing standing
 * between a stranger and the sub's financials and insurance answers, so it is
 * the credential and is made like one. Pure so the validator can execute it:
 * returns null when the bytes run out before 32 unbiased characters (the
 * caller draws again) — never a short token.
 */
export function prequalTokenFromBytes(bytes: Uint8Array): string | null {
  let out = '';
  for (let i = 0; i < bytes.length && out.length < PREQUAL_TOKEN_LENGTH; i++) {
    const b = bytes[i];
    if (b >= TOKEN_BYTE_CEILING) continue;
    out += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  }
  return out.length === PREQUAL_TOKEN_LENGTH ? out : null;
}

/**
 * Compute the renewal cadence for an approved packet. Default is 1 year
 * from review date, but if COI expires sooner we clamp to that.
 *
 * A COI date that was TYPED but does not read (see parsePrequalDate) used to
 * compare as an Invalid Date and fall through to the full year — an approval
 * outliving an insurance date nobody could check. It now caps at the review
 * day itself: the approval stands for today and the packet shows as due for
 * renewal, so the GC asks for a real date. A blank COI date is the GC
 * approving with "COI expiry date — Missing" in front of him; that keeps the
 * one-year default it always had.
 */
export function computePrequalExpiry(reviewedAtIso: string, coiExpiryIso?: string): string {
  const reviewDate = new Date(reviewedAtIso);
  const oneYearOut = new Date(Date.UTC(reviewDate.getUTCFullYear() + 1, reviewDate.getUTCMonth(), reviewDate.getUTCDate()));
  const oneYearIso = oneYearOut.toISOString().slice(0, 10);
  const raw = typeof coiExpiryIso === 'string' ? coiExpiryIso.trim() : '';
  if (!raw) return oneYearIso;
  const coi = parsePrequalDate(raw);
  if (!coi) return reviewDate.toISOString().slice(0, 10);
  // Both are YYYY-MM-DD, so string order is date order.
  return coi < oneYearIso ? coi : oneYearIso;
}

/**
 * Why an approval made now would not last (for the Approve confirmation), or
 * null when it runs its normal course. Mirrors computePrequalExpiry, so what
 * the GC is warned about is exactly what will be written:
 *   'unreadable' — a COI date was typed but does not read; the approval would
 *                  be capped at the review day.
 *   'lapsed'     — the COI date is today or already past; the approval would
 *                  expire at once. `today` says which.
 * A blank COI date is not a risk here (it keeps the one-year default, with
 * "COI expiry date — Missing" already in the findings).
 */
export type PrequalApprovalRisk =
  | { kind: 'unreadable'; typed: string }
  | { kind: 'lapsed'; coi: string; today: boolean };

export function prequalApprovalRisk(reviewedAtIso: string, coiExpiry?: string): PrequalApprovalRisk | null {
  const raw = typeof coiExpiry === 'string' ? coiExpiry.trim() : '';
  if (!raw) return null;
  const coi = parsePrequalDate(raw);
  if (!coi) return { kind: 'unreadable', typed: raw };
  const today = new Date(reviewedAtIso).toISOString().slice(0, 10);
  if (coi <= today) return { kind: 'lapsed', coi, today: coi === today };
  return null;
}

/**
 * Days-until-expiry → renewal cadence bucket used by the reminder system.
 */
export function renewalBucket(expiresAt: string): '60d' | '30d' | '7d' | 'expired' | 'ok' {
  const days = daysBetween(expiresAt, new Date().toISOString().slice(0, 10));
  if (days < 0) return 'expired';
  if (days <= 7) return '7d';
  if (days <= 30) return '30d';
  if (days <= 60) return '60d';
  return 'ok';
}
