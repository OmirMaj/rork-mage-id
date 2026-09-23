// utils/subCompliance.ts — what the app is allowed to say about a sub's paperwork.
//
// Pure: types-only imports plus utils/calendarDate (itself pure), no React, so
// bun can run it under a validator.
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
import { calendarDayOf, daysUntilCalendarDay } from '@/utils/calendarDate';
import type { SubScorecard } from '@/utils/subScorecard';

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
      ? `${who} has ${certs === 1 ? 'a certificate' : `${certs} certificates`} in the COI vault but none with a readable expiry date, so the app cannot tell you his insurance is in force. Open the COI vault, tap his certificate and type the expiry under Coverages — or enter his COI Expiry on his record in the Subs tab.`
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

// ─── COI vault expiry (audit #23 / #40) ─────────────────────────────────────
//
// The vault's compliance banner and each sub's row read the expiry ONLY from
// the latest certificate's coverages, and `continue`d past a certificate with
// none — which, with the AI read never live, was every certificate. A sub whose
// expiry the GC had typed on his Subs record was never counted as expired or
// expiring. Now the certificate's own dates win; with none, the date on the
// sub's record is used and the row says so; a record date that won't parse is
// reported as such (no reminders fire for it) rather than skipped silently.
// Days are CALENDAR days (utils/calendarDate), never Date.parse — a bare
// 'YYYY-MM-DD' parsed that way is UTC midnight, the previous evening on every
// US jobsite.

export type VaultCoiSource = 'certificate' | 'record' | 'none';

export interface VaultCoiExpiry {
  /** The calendar day that decides the status, or null. */
  day: string | null;
  source: VaultCoiSource;
  /** The record holds text that is not a date — say so, don't skip it. */
  recordUnreadable: boolean;
}

/** Earliest parseable coverage expiry on one certificate, as a calendar day. */
export function certificateExpiryDay(coi: { coverages?: { expiresAt?: string }[] } | null | undefined): string | null {
  let best: string | null = null;
  for (const c of coi?.coverages ?? []) {
    const day = calendarDayOf(typeof c?.expiresAt === 'string' ? c.expiresAt.trim() : null);
    if (day && (!best || day < best)) best = day;
  }
  return best;
}

/**
 * The expiry the vault shows for a sub: the latest certificate's earliest
 * coverage expiry, else the COI Expiry typed on the sub's record.
 */
export function vaultCoiExpiry(
  latest: { coverages?: { expiresAt?: string }[] } | null | undefined,
  sub: Pick<Subcontractor, 'coiExpiry'>,
): VaultCoiExpiry {
  const certDay = certificateExpiryDay(latest);
  if (certDay) return { day: certDay, source: 'certificate', recordUnreadable: false };
  const raw = (sub.coiExpiry ?? '').trim();
  const recordDay = raw ? calendarDayOf(raw) : null;
  if (recordDay) return { day: recordDay, source: 'record', recordUnreadable: false };
  return { day: null, source: 'none', recordUnreadable: raw.length > 0 };
}

export interface VaultCoiStatus {
  key: 'unknown' | 'expired' | 'expiring' | 'active';
  label: string;
  tone: 'neutral' | 'bad' | 'warn' | 'good';
}

/**
 * Status for a vault expiry. Expired once the expiry day is behind today;
 * "expiring" inside COMPLIANCE_WARN_DAYS. A date from the sub's record (not a
 * certificate) says so in the label, so a typed date is never passed off as a
 * checked one.
 */
export function vaultCoiStatus(e: VaultCoiExpiry, now: Date = new Date()): VaultCoiStatus {
  if (!e.day) {
    return {
      key: 'unknown',
      label: e.recordUnreadable ? 'COI expiry not a date — no reminders' : 'No expiry on file',
      tone: 'neutral',
    };
  }
  const days = daysUntilCalendarDay(e.day, now);
  const suffix = e.source === 'record' ? ' (typed on his record)' : '';
  if (days === null) return { key: 'unknown', label: 'No expiry on file', tone: 'neutral' };
  if (days < 0) return { key: 'expired', label: `Expired${suffix}`, tone: 'bad' };
  if (days <= COMPLIANCE_WARN_DAYS) {
    return { key: 'expiring', label: `${days === 0 ? 'Expires today' : `Expires in ${days}d`}${suffix}`, tone: 'warn' };
  }
  return { key: 'active', label: `Active${suffix}`, tone: 'good' };
}

// ─── AI sub evaluation grounding (audit #115) ───────────────────────────────
//
// 'AI Evaluate Sub' was told every sub had "0 bids (0 won)" and "Assigned
// projects: 0" — fields nothing in the app ever fills — and never the signed
// commitments, CO growth, punch rework or schedule record the scorecard grades
// him on. A sub the GC had used for years read as unknown, the result could
// sit beside a green check as a "track record", and it was cached for 24 hours
// under the sub's id alone. The panel is now grounded in the SAME card the
// Subs sheet shows above it, says what it read, and re-asks when that changes.

export interface SubEvaluationGrounding {
  /** The context block sent with the evaluation. */
  context: string;
  /** The chip under the panel title: what the model was given to read. */
  readChip: string;
  /** True only with a signed commitment on record — gates the track-record line. */
  hasHistory: boolean;
  /** Hash of the scorecard inputs, part of the cache key. */
  inputsHash: string;
}

function moneyExact(n: number): string {
  return `$${(Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** djb2 over the string — a cache key, not security. */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Short name for a factor in the read chip. */
function chipName(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('change-order')) return 'CO growth';
  if (l.includes('punch')) return 'punch';
  if (l.includes('schedule')) return 'schedule';
  if (l.includes('rfi')) return 'RFIs';
  if (l.includes('cost')) return 'cost';
  return l;
}

/**
 * The grounding for one sub, from the scorecard card computed on the Subs
 * sheet plus the jobs his signed commitments are on. Every number is what the
 * card says; nothing is inferred.
 */
export function buildSubEvaluationGrounding(opts: {
  card: SubScorecard | null;
  /** Names of the jobs his non-draft commitments are on (deduped by caller or here). */
  awardedJobNames: string[];
  /** Every project on the GC's books, ANY status (closed and completed jobs
   *  included) — labelled that way to the model, never as "active". */
  projectsOnFileCount: number;
}): SubEvaluationGrounding {
  const { card } = opts;
  const jobs = [...new Set(opts.awardedJobNames.map(n => n.trim()).filter(Boolean))];
  const lines: string[] = [];
  const notTracked = 'Not tracked in MAGE ID: bid history and assigned-project lists. Their empty values are NOT evidence of a missing track record — do not read them as one.';
  if (!card) {
    lines.push('No scorecard could be computed for this sub.', notTracked);
    const context = lines.join('\n');
    return { context, readChip: 'Read: paperwork only', hasHistory: false, inputsHash: hashText(context) };
  }
  const hasHistory = !card.noHistory && card.commitmentCount > 0;
  lines.push(`Scorecard computed by MAGE ID from the contractor's own records: grade ${card.grade}, ${card.score}/100, ${card.confidence} confidence.`);
  if (hasHistory) {
    lines.push(`Signed commitments on record in MAGE ID: ${card.commitmentCount} (${card.closedCommitmentCount} closed), totalling ${moneyExact(card.totalVolume)}.`);
    if (jobs.length > 0) lines.push(`Jobs awarded to this sub: ${jobs.join(', ')}.`);
  } else {
    lines.push('No signed commitments on record in MAGE ID — there is no track record here yet. The score grades compliance paperwork only; say so rather than calling it good or bad.');
  }
  const applicable = card.factors.filter(f => f.applicable);
  for (const f of card.factors) {
    lines.push(`- ${f.label}: ${f.applicable ? `${Math.round(f.score * 100)}/100 — ${f.detail}` : `not measured (${f.detail})`}`);
  }
  lines.push(notTracked);
  // Review round 1: this said "Active projects" but was fed projects.length,
  // which counts closed and completed jobs too — a wrong number stated as fact.
  lines.push(`Projects on file for this contractor (every status, closed jobs included): ${opts.projectsOnFileCount}.`);
  const context = lines.join('\n');
  const measured = [...new Set(applicable.map(f => chipName(f.label)))];
  const readChip = hasHistory
    ? `Read: ${card.commitmentCount} commitment${card.commitmentCount === 1 ? '' : 's'}${measured.length ? `, ${measured.join(', ')}` : ''}`
    : 'Read: no commitments on record, paperwork only';
  return { context, readChip, hasHistory, inputsHash: hashText(context) };
}
