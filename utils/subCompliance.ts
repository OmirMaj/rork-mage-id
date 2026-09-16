// utils/subCompliance.ts — what the app is allowed to say about a sub's paperwork.
//
// Pure: types-only imports, no React, so bun can run it under a validator.
//
// NAV-05 (runtime audit 2026-09-06). This logic used to live module-private in
// app/(tabs)/subs/index.tsx, where nothing in the ship-check chain could reach
// it, and it shipped this:
//
//     const licExpiry = sub.licenseExpiry ? new Date(sub.licenseExpiry) : null;
//     const coiExpiry = sub.coiExpiry ? new Date(sub.coiExpiry) : null;
//     if ((licExpiry && licExpiry < now) || ...) return 'expired';
//     if (...within 30 days...) return 'expiring_soon';
//     return 'compliant';          // ← everything else, including "no dates"
//
// A sub with NO licence date and NO COI date fell straight through to the last
// line: a green "Compliant" chip and a +1 on the green Compliant tile, on the
// screen that advertises a COI vault. Production has a sub in exactly that
// state today — 'Trail', whose license_expiry and coi_expiry are EMPTY STRINGS
// (not NULL), which the old `sub.x ? ... : null` read as falsy and skipped.
//
// The app cannot certify insurance it has never seen. Absence of evidence is
// reported as absence of evidence, and it is a FOURTH state, not a shade of the
// green one.
//
// It lives here so scripts/validate-sub-network.ts can pin it. A future edit
// that restores "no dates → compliant" now fails the build instead of quietly
// telling a GC that an uninsured sub is cleared to work.

import type { ComplianceStatus, Subcontractor } from '@/types';

/**
 * The four things the app can say about a sub's paperwork.
 *
 * 'unknown' is deliberately NOT added to the shared `ComplianceStatus` union in
 * types/index.ts: that union describes the three states a DATED document can be
 * in, and other code (prequal, COI vault) reads it expecting exactly those.
 * This is the wider domain-level state.
 */
export type ComplianceState = ComplianceStatus | 'unknown';

/** Days before expiry at which a document starts reading "expiring soon". */
export const COMPLIANCE_WARN_DAYS = 30;

/**
 * Parse a stored expiry into epoch ms, or null when there is nothing usable.
 *
 * Both expiry fields are optional free-text inputs with no validation, so ''
 * (what the phone form writes when the GC skips the field), undefined, and
 * 'next year' all have to land in the same bucket as absent. Without this,
 * `new Date('')` yields an Invalid Date whose every comparison is false — which
 * is precisely how a sub with no paperwork passed both severity checks and came
 * out the far end labelled Compliant.
 */
export function parseExpiry(raw: string | undefined | null): number | null {
  if (!raw || !raw.trim()) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

/** Which of the two tracked documents this sub has no usable date for. */
export function missingComplianceDocs(sub: Subcontractor): { license: boolean; coi: boolean } {
  return {
    license: parseExpiry(sub.licenseExpiry) === null,
    coi: parseExpiry(sub.coiExpiry) === null,
  };
}

/**
 * The rule, in order:
 *   - any date in the past                          → 'expired'
 *   - any date inside COMPLIANCE_WARN_DAYS          → 'expiring_soon'
 *   - a missing/unparseable date on EITHER document → 'unknown'
 *   - both dates present and clear                  → 'compliant'
 *
 * Evidence of a problem outranks missing evidence: an expired COI plus no
 * licence date is 'expired', not 'unknown'. 'compliant' is reachable ONLY when
 * both documents have a real, future, parseable date.
 *
 * @param nowMs injectable so tests are not wall-clock dependent.
 */
export function getComplianceStatus(sub: Subcontractor, nowMs: number = Date.now()): ComplianceState {
  const warnWindow = COMPLIANCE_WARN_DAYS * 24 * 60 * 60 * 1000;
  const licExpiry = parseExpiry(sub.licenseExpiry);
  const coiExpiry = parseExpiry(sub.coiExpiry);

  if ((licExpiry !== null && licExpiry < nowMs) || (coiExpiry !== null && coiExpiry < nowMs)) return 'expired';
  if ((licExpiry !== null && licExpiry - nowMs < warnWindow) ||
      (coiExpiry !== null && coiExpiry - nowMs < warnWindow)) return 'expiring_soon';
  if (licExpiry === null || coiExpiry === null) return 'unknown';
  return 'compliant';
}

/**
 * Chip text. With a `sub` in hand it names the document that is missing, which
 * is the part a GC can act on; "Unknown" on its own is not an instruction.
 */
export function complianceLabel(status: ComplianceState, sub?: Subcontractor): string {
  if (status === 'compliant') return 'Compliant';
  if (status === 'expiring_soon') return 'Expiring Soon';
  if (status === 'unknown') {
    if (!sub) return 'No docs';
    const missing = missingComplianceDocs(sub);
    if (missing.coi && missing.license) return 'No docs';
    return missing.coi ? 'No COI' : 'No license';
  }
  return 'Expired';
}

// ─── The AWARD gate ──────────────────────────────────────────────────────────
//
// Screen audit 2026-09-16 (subs-network): "the award compliance check ignores
// the COI the app itself keeps up to date". The award dialog in
// app/buyout-package.tsx ran `getComplianceStatus` above as its gate — and
// that rule is right for the Subs-tab CHIP but wrong for an award. It returns
// 'unknown' whenever EITHER date is missing, and licence dates are the field a
// GC skips: the phone form writes '' for them (production's 'Trail' row). So a
// sub with a current, vault-verified COI and no typed licence date got a red
// "No license … cannot tell you he is covered" blocker, a destructive
// double-confirm, and an "Awarded despite" line on the commitment — the gate
// crying wolf on a GC who did everything right, until he stops reading it.
//
// The COI is the insurance exposure the gate exists for, and it is the one
// document the app keeps current by itself (the COI vault's syncSubCoiExpiry
// recomputes `coiExpiry` from every certificate and stamps `coiVerifiedAt`).
// So the award evaluates the two documents SEPARATELY:
//   COI      none / expired      → blocker, naming which
//            inside the warn window → a note naming the date
//            current             → a note saying so, and on what evidence
//   licence  never a blocker — a named note (missing, expired, or expiring),
//            because the app has no source that keeps it current and a
//            blocker built on a field nobody types fires on every award.

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the award gate concluded about the COI leg alone. */
export type AwardCoiState = 'none' | 'expired' | 'expiring_soon' | 'current';

export interface AwardComplianceReview {
  coi: AwardCoiState;
  /** Epoch ms of the COI expiry the review used, or null when there was none. */
  coiExpiryMs: number | null;
  /** Things that make the award a risk override. COI only. */
  blockers: string[];
  /** Things the GC should read but that do not gate the award. */
  notes: string[];
}

/**
 * Human date for an expiry. A bare `YYYY-MM-DD` parses as UTC midnight, so it
 * is formatted in UTC — formatted local it prints the PREVIOUS day on every US
 * jobsite, and a COI "expired Aug 13" that actually runs through Aug 14 is a
 * wrong fact on the one dialog that has to be right.
 */
export function formatExpiryDay(raw: string | undefined | null): string | null {
  const ms = parseExpiry(raw);
  if (ms === null) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test((raw ?? '').trim());
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  });
}

/** "verified today" / "verified 12d ago", or null when never verified. */
function verifiedAgo(raw: string | undefined, nowMs: number): string | null {
  const ms = parseExpiry(raw);
  if (ms === null) return null;
  const days = Math.max(0, Math.floor((nowMs - ms) / DAY_MS));
  return days === 0 ? 'verified today' : `verified ${days}d ago`;
}

/**
 * The award gate. Pure; pinned by scripts/validate-sub-network.ts.
 *
 * @param opts.vaultCoiExpiry the sub's expiry as derived from the certificates
 *   actually in the COI vault (`subCoiExpiryAcross`). The later of this and
 *   `sub.coiExpiry` is used: the vault is what the app has seen, but a GC who
 *   typed a renewal date onto the record before scanning it is not wrong.
 * @param opts.vaultCertCount how many certificates are in the vault for him,
 *   so the dialog can say where the date came from.
 */
export function reviewAwardCompliance(
  sub: Subcontractor,
  nowMs: number = Date.now(),
  opts: { vaultCoiExpiry?: string; vaultCertCount?: number } = {},
): AwardComplianceReview {
  const blockers: string[] = [];
  const notes: string[] = [];
  const who = sub.companyName || 'This sub';
  const warnWindow = COMPLIANCE_WARN_DAYS * DAY_MS;

  // ── COI leg ──
  const recordMs = parseExpiry(sub.coiExpiry);
  const vaultMs = parseExpiry(opts.vaultCoiExpiry);
  const useVault = vaultMs !== null && (recordMs === null || vaultMs >= recordMs);
  const coiRaw = useVault ? opts.vaultCoiExpiry : sub.coiExpiry;
  const coiMs = useVault ? vaultMs : recordMs;
  const certs = opts.vaultCertCount ?? 0;
  const evidence = useVault
    ? [`from ${certs === 1 ? 'the certificate' : `${certs} certificates`} in your COI vault`, verifiedAgo(sub.coiVerifiedAt, nowMs)]
        .filter(Boolean).join(', ')
    : certs > 0
      ? 'typed on his record — the certificates in your vault carry no readable expiry'
      : 'typed on his record, not checked against a certificate';

  let coi: AwardCoiState;
  if (coiMs === null) {
    coi = 'none';
    blockers.push(certs > 0
      ? `${who} has ${certs === 1 ? 'a certificate' : `${certs} certificates`} in the COI vault but none with a readable expiry date, so the app cannot tell you his insurance is in force. Open the COI vault and add the coverage dates.`
      : `No COI on file for ${who} — nothing in the COI vault and no expiry on his record, so the app cannot tell you he is insured.`);
  } else if (coiMs < nowMs) {
    coi = 'expired';
    blockers.push(`${who}'s COI expired ${formatExpiryDay(coiRaw)} (${evidence}).`);
  } else if (coiMs - nowMs < warnWindow) {
    coi = 'expiring_soon';
    const days = Math.ceil((coiMs - nowMs) / DAY_MS);
    notes.push(`${who}'s COI is current but expires ${formatExpiryDay(coiRaw)}, in ${days} day${days === 1 ? '' : 's'} (${evidence}). Ask for the renewal before he starts.`);
  } else {
    coi = 'current';
    notes.push(`COI current through ${formatExpiryDay(coiRaw)} (${evidence}).`);
  }

  // ── Licence leg — named, never blocking ──
  const licMs = parseExpiry(sub.licenseExpiry);
  if (licMs === null) {
    notes.push(`No licence expiry on file for ${who}${sub.licenseNumber?.trim() ? ` (licence #${sub.licenseNumber.trim()})` : ''} — check the state board if this trade needs one.`);
  } else if (licMs < nowMs) {
    notes.push(`${who}'s licence expiry on file is ${formatExpiryDay(sub.licenseExpiry)}, which has passed. Check the state board before he starts.`);
  } else if (licMs - nowMs < warnWindow) {
    notes.push(`${who}'s licence expires ${formatExpiryDay(sub.licenseExpiry)}.`);
  }

  return { coi, coiExpiryMs: coiMs, blockers, notes };
}
