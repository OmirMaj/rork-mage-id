// COI reader — sends a certificate (photo or PDF) to the analyze-photos edge
// function's 'coi' task (Gemini Vision), which returns the policy numbers,
// coverage dates and limits, and whether the additional-insured and
// waiver-of-subrogation endorsements show on it.
//
// HONESTY RULES (audit #23 / #40). Until 2026-09-23 the server had no 'coi'
// task: every call was a Pro-gated 400, every certificate read "AI validation
// unavailable", and no expiry was ever recorded — while the screen said "we
// read it". Now:
//   • a read that doesn't happen says WHY (not live yet on this server, the
//     monthly / hourly limit with the server's own sentence, offline) and
//     points at the manual coverage rows on the certificate card, which are
//     the path that always works;
//   • dates the model read are tagged source 'ai', kept in aiExpiresAt /
//     aiEffectiveDate (never expiresAt), and shown UNCONFIRMED until the GC
//     confirms them against the paper — so no guess reaches coi_expiry, the
//     reminders or the award gate;
//   • expiry is judged by CALENDAR day (utils/calendarDate), not Date.parse,
//     which reads a bare 'YYYY-MM-DD' as UTC midnight — the previous evening
//     on every US jobsite.

import { supabase } from '@/lib/supabase';
// expo-file-system/legacy, NOT the root entry. In SDK 54 the root's
// readAsStringAsync is a deprecation stub — src/index.ts re-exports
// ./legacyWarnings, where it is `throw errorOnLegacyMethodUse(...)`, and its own
// doc comment says "This method will throw in runtime". It throws on EVERY
// platform, iOS included, so this was not a web issue. 14 other files in this
// repo were already migrated; these five were missed.
import { readAsBase64 } from '@/utils/platformFile';
import type { COICoverage, COICoverageType, COIValidationResult } from '@/types';
import { readEdgeError } from '@/utils/edgeError';
import { daysUntilCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import { hasUnconfirmedAi } from '@/utils/coiFiles';

interface RawAIExtraction {
  insuredName?: string;
  certificateHolder?: string;
  coverages?: {
    type?: string;
    carrierName?: string;
    policyNumber?: string;
    effectiveDate?: string;
    expiresAt?: string;
    eachOccurrence?: number;
    generalAggregate?: number;
  }[];
  hasAdditionalInsured?: boolean;
  hasWaiverOfSubrogation?: boolean;
  notes?: string;
  confidence?: number;
}

const COVERAGE_TYPE_MAP: Record<string, COICoverageType> = {
  'general liability': 'general_liability',
  'gl': 'general_liability',
  'auto': 'auto',
  'auto liability': 'auto',
  'commercial auto': 'auto',
  'workers compensation': 'workers_comp',
  'workers comp': 'workers_comp',
  'wc': 'workers_comp',
  'umbrella': 'umbrella',
  'excess': 'umbrella',
  'professional liability': 'professional',
  'pollution': 'pollution',
  'pollution liability': 'pollution',
  // The 'coi' prompt answers with the app's own keys.
  'general_liability': 'general_liability',
  'workers_comp': 'workers_comp',
  'professional': 'professional',
  'other': 'other',
};

function normalizeCoverageType(s?: string): COICoverageType {
  if (!s) return 'other';
  const t = s.toLowerCase().trim();
  return COVERAGE_TYPE_MAP[t] ?? 'other';
}

/** Why a certificate was not read, in words the GC can act on. The card opens
 *  an empty coverage row for every one of these (code 'ai_validation_unavailable'). */
export function coiReadFailureMessage(code: string, serverMessage: string): string {
  const typeIt = 'Type the expiry from the certificate below so MAGE ID can remind you before it lapses.';
  // The deployed function predates the 'coi' task: it answers 400 "task must
  // be …". Once the new build is deployed it returns code 'unknown_task' only
  // for a task it truly doesn't know.
  if (code === 'unknown_task' || /^task must be/i.test(serverMessage)) {
    return `Automatic certificate reading isn't live yet. ${typeIt}`;
  }
  if (code === 'monthly_cap_reached' || code === 'hourly_limit' || code === 'tier_required') {
    const said = serverMessage.trim().replace(/\s*$/, '');
    return `${said ? `${said}${/[.!?]$/.test(said) ? '' : '.'} ` : ''}This certificate wasn't read. ${typeIt}`;
  }
  if (code === 'offline') return `You're offline, so this certificate wasn't read. ${typeIt}`;
  return `We couldn't read this certificate. ${typeIt}`;
}

function unreadResult(message: string): { coverages: COICoverage[]; validation: COIValidationResult } {
  return {
    coverages: [],
    validation: {
      validatedAt: new Date().toISOString(),
      overallStatus: 'warn',
      issues: [{ code: 'ai_validation_unavailable', severity: 'info', message }],
    },
  };
}

/** Content type for the edge function: the picker's own mime type wins; the
 *  extension is only a fallback (a web blob: URI has none). */
function mimeFor(uri: string, mimeType?: string | null): string {
  const m = (mimeType ?? '').toLowerCase();
  if (m === 'application/pdf' || m.startsWith('image/')) return m === 'image/jpg' ? 'image/jpeg' : m;
  const ext = (uri.split('?')[0].split('.').pop() ?? '').toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'pdf' ? 'application/pdf' : 'image/jpeg';
}

/**
 * Send a certificate (image or PDF, from the device) to analyze-photos with
 * task='coi' and parse the RawAIExtraction it returns. Never throws: a read
 * that doesn't happen comes back as an 'ai_validation_unavailable' finding
 * whose message says why, and the card offers the manual coverage rows.
 */
export async function validateCOIImage(localFileUri: string, mimeType?: string | null): Promise<{
  coverages: COICoverage[];
  validation: COIValidationResult;
}> {
  let base64: string;
  try {
    base64 = await readAsBase64(localFileUri);
  } catch {
    return unreadResult(coiReadFailureMessage('', ''));
  }

  let data: { success: boolean; data?: RawAIExtraction; error?: string } | null = null;
  try {
    const res = await supabase.functions.invoke<{ success: boolean; data?: RawAIExtraction; error?: string }>(
      'analyze-photos',
      { body: { task: 'coi', photos: [{ base64, mimeType: mimeFor(localFileUri, mimeType) }] } },
    );
    if (res.error) {
      const info = await readEdgeError(res.error, "We couldn't read this certificate.");
      // Nothing reached the server (no code, no HTTP status): offline.
      const code = info.code || (/fetch|network|send a request/i.test(info.message) ? 'offline' : '');
      return unreadResult(coiReadFailureMessage(code, info.message));
    }
    data = res.data;
  } catch (err) {
    return unreadResult(coiReadFailureMessage('offline', err instanceof Error ? err.message : ''));
  }
  if (!data?.success || !data?.data) {
    return unreadResult(coiReadFailureMessage('', data?.error ?? ''));
  }

  const raw = data.data;
  const coverages: COICoverage[] = (raw.coverages ?? []).map(c => ({
    type: normalizeCoverageType(c.type),
    carrierName: c.carrierName || undefined,
    policyNumber: c.policyNumber || undefined,
    // The model's days are SUGGESTIONS, never effectiveDate / expiresAt:
    // those feed subcontractors.coi_expiry, the reminders and the award gate
    // the moment the certificate is saved (see COICoverage). Only a real
    // calendar day is kept; anything else is left for the GC to type.
    aiEffectiveDate: calendarDayOf(c.effectiveDate ?? null) ?? undefined,
    aiExpiresAt: calendarDayOf(c.expiresAt ?? null) ?? undefined,
    eachOccurrence: typeof c.eachOccurrence === 'number' && c.eachOccurrence > 0 ? c.eachOccurrence : undefined,
    generalAggregate: typeof c.generalAggregate === 'number' && c.generalAggregate > 0 ? c.generalAggregate : undefined,
    source: 'ai' as const,
  }));

  const endorsements: COIValidationResult['issues'] = [];
  if (raw.hasAdditionalInsured === false) {
    endorsements.push({
      code: 'additional_insured_missing',
      severity: 'critical',
      message: 'No additional insured endorsement detected. Most prime contracts require CG 20 10 (ongoing ops) and CG 20 37 (completed ops).',
    });
  }
  if (raw.hasWaiverOfSubrogation === false) {
    endorsements.push({
      code: 'waiver_subrogation_missing',
      severity: 'critical',
      message: 'No waiver of subrogation endorsement detected. Required by most owners and lenders.',
    });
  }
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : undefined;
  if (coverages.length === 0) {
    return unreadResult(`The certificate was read but no coverage lines came back${confidence != null ? ` (confidence ${confidence}%)` : ''}. Type the expiry from the certificate below so MAGE ID can remind you before it lapses.`);
  }
  return {
    coverages,
    validation: recomputeValidation(coverages, { validatedAt: '', overallStatus: 'warn', issues: endorsements, confidence }),
  };
}

function humanCoverage(type: COICoverageType): string {
  switch (type) {
    case 'general_liability': return 'General liability';
    case 'auto':              return 'Auto liability';
    case 'workers_comp':      return "Workers' comp";
    case 'umbrella':           return 'Umbrella / excess';
    case 'professional':      return 'Professional liability';
    case 'pollution':         return 'Pollution liability';
    case 'other':             return 'Coverage';
  }
}

/**
 * Re-derive the findings from the coverages without re-running AI — after the
 * GC types or confirms a coverage row, or after a read. Endorsement findings
 * from the AI read are kept (the GC can't settle those by editing dates).
 * Expiry is by calendar day: expired once the day is behind today, a warning
 * inside 30 days. Rows the model read and the GC hasn't confirmed add an info
 * finding, so an unconfirmed date is never presented as checked.
 */
export function recomputeValidation(
  coverages: COICoverage[],
  prior: COIValidationResult | undefined,
  now: Date = new Date(),
): COIValidationResult {
  const issues: COIValidationResult['issues'] = [];

  const priorEndorsements = (prior?.issues ?? []).filter(i =>
    i.code === 'additional_insured_missing' || i.code === 'waiver_subrogation_missing'
  );
  issues.push(...priorEndorsements);

  for (const cov of coverages) {
    const day = calendarDayOf(cov.expiresAt ?? null);
    if (!day) continue;
    const days = daysUntilCalendarDay(day, now);
    if (days === null) continue;
    if (days < 0) {
      issues.push({
        code: 'expired',
        severity: 'critical',
        message: `${humanCoverage(cov.type)} expired on ${day}.`,
      });
    } else if (days <= 30) {
      issues.push({
        code: 'expires_within_30_days',
        severity: 'warning',
        message: `${humanCoverage(cov.type)} expires ${day} — request renewal now.`,
      });
    }
  }

  // Soft sanity check on the limit (most jobs expect $1M GL each occurrence).
  const gl = coverages.find(c => c.type === 'general_liability');
  if (gl && gl.eachOccurrence != null && gl.eachOccurrence > 0 && gl.eachOccurrence < 1_000_000) {
    issues.push({
      code: 'gl_limit_below_required',
      severity: 'warning',
      message: `GL each-occurrence limit ($${gl.eachOccurrence.toLocaleString()}) is below the $1M typical minimum. Confirm against your contract requirements.`,
    });
  }

  // Expiry above is judged on CONFIRMED days only (expiresAt); an AI-read day
  // (aiExpiresAt) is a suggestion and is named here, never judged as checked.
  if (coverages.some(hasUnconfirmedAi)) {
    const read = coverages
      .map(c => calendarDayOf(c.aiExpiresAt ?? null))
      .filter((d): d is string => !!d)
      .sort()[0];
    issues.push({
      code: 'ai_dates_unconfirmed',
      severity: 'info',
      message: `Coverage read by AI${read ? ` (earliest expiry it read: ${read})` : ''} — nothing is counted until you check each row against the certificate and tap Confirm.`,
    });
  }

  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasWarning = issues.some(i => i.severity === 'warning');
  const hasUnconfirmed = issues.some(i => i.code === 'ai_dates_unconfirmed');
  const hasDate = coverages.some(c => !!calendarDayOf(c.expiresAt ?? null));
  return {
    validatedAt: now.toISOString(),
    // 'pass' only when a real expiry is on file, nothing is wrong, and nothing
    // is still an unconfirmed AI read.
    overallStatus: hasCritical ? 'fail' : (hasWarning || hasUnconfirmed || !hasDate) ? 'warn' : 'pass',
    issues,
    confidence: prior?.confidence,
  };
}
