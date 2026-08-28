// COI validator — calls Gemini Vision via the analyze-photos edge
// function with a 'coi' task. Extracts policy numbers, expiration
// dates, coverage limits, and flags whether the standard endorsements
// (additional insured CG 20 10 / 20 37, waiver of subrogation) are
// present.
//
// Why server-side: the existing `analyze-photos` edge function handles
// the Gemini Vision auth + API quirks. We extend it with a new task
// rather than re-implementing the vision pipeline client-side.
//
// The validator runs with manual fallback: if the AI fails or the
// confidence is too low, the GC falls back to manual entry on the
// COI vault screen. The structure remains useful regardless.

import { supabase } from '@/lib/supabase';
// expo-file-system/legacy, NOT the root entry. In SDK 54 the root's
// readAsStringAsync is a deprecation stub — src/index.ts re-exports
// ./legacyWarnings, where it is `throw errorOnLegacyMethodUse(...)`, and its own
// doc comment says "This method will throw in runtime". It throws on EVERY
// platform, iOS included, so this was not a web issue. 14 other files in this
// repo were already migrated; these five were missed.
import * as FileSystem from 'expo-file-system/legacy';
import type { COICoverageType, COICoverage, COIValidationResult } from '@/types';

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
};

function normalizeCoverageType(s?: string): COICoverageType {
  if (!s) return 'other';
  const t = s.toLowerCase().trim();
  return COVERAGE_TYPE_MAP[t] ?? 'other';
}

/**
 * Send a COI image to the analyze-photos edge function with task='coi'
 * and parse the structured response. Returns extracted coverages +
 * validation findings.
 *
 * Required server-side: the analyze-photos function must accept
 * task='coi' and return shape { insuredName, coverages, hasAdditionalInsured,
 * hasWaiverOfSubrogation, confidence }. If the server returns an
 * unexpected shape we fall back to a "needs manual review" result so
 * the UI never crashes.
 */
export async function validateCOIImage(localFileUri: string): Promise<{
  coverages: COICoverage[];
  validation: COIValidationResult;
}> {
  // Encode the image to base64 for the edge function. Match the
  // pattern used by photoAnalyzer.encodeLocalPhotos().
  const base64 = await FileSystem.readAsStringAsync(localFileUri, { encoding: 'base64' });
  const ext = (localFileUri.split('.').pop() ?? '').toLowerCase();
  const mimeType = ext === 'png' ? 'image/png' : ext === 'pdf' ? 'application/pdf' : 'image/jpeg';

  const { data, error } = await supabase.functions.invoke<{ success: boolean; data?: RawAIExtraction; error?: string }>(
    'analyze-photos',
    {
      body: {
        task: 'coi',
        photos: [{ base64, mimeType }],
      },
    },
  );

  if (error || !data?.success || !data?.data) {
    // Server didn't recognize the COI task or AI failed — return a
    // "needs manual review" result so the UI surfaces it without crashing.
    return {
      coverages: [],
      validation: {
        validatedAt: new Date().toISOString(),
        overallStatus: 'warn',
        issues: [
          { code: 'ai_validation_unavailable', severity: 'info', message: 'AI validation unavailable. Please verify coverages manually.' },
        ],
      },
    };
  }

  const raw = data.data;

  const coverages: COICoverage[] = (raw.coverages ?? []).map(c => ({
    type: normalizeCoverageType(c.type),
    carrierName: c.carrierName,
    policyNumber: c.policyNumber,
    effectiveDate: c.effectiveDate,
    expiresAt: c.expiresAt,
    eachOccurrence: c.eachOccurrence,
    generalAggregate: c.generalAggregate,
  }));

  // Compute issues
  const issues: COIValidationResult['issues'] = [];
  const now = Date.now();
  const thirtyDays = 30 * 86400000;

  // Endorsements
  if (raw.hasAdditionalInsured === false) {
    issues.push({
      code: 'additional_insured_missing',
      severity: 'critical',
      message: 'No additional insured endorsement detected. Most prime contracts require CG 20 10 (ongoing ops) and CG 20 37 (completed ops).',
    });
  }
  if (raw.hasWaiverOfSubrogation === false) {
    issues.push({
      code: 'waiver_subrogation_missing',
      severity: 'critical',
      message: 'No waiver of subrogation endorsement detected. Required by most owners and lenders.',
    });
  }

  // Expiration
  for (const cov of coverages) {
    if (!cov.expiresAt) continue;
    const exp = new Date(cov.expiresAt).getTime();
    if (isNaN(exp)) continue;
    if (exp < now) {
      issues.push({
        code: 'expired',
        severity: 'critical',
        message: `${humanCoverage(cov.type)} expired on ${cov.expiresAt}.`,
      });
    } else if (exp < now + thirtyDays) {
      issues.push({
        code: 'expires_within_30_days',
        severity: 'warning',
        message: `${humanCoverage(cov.type)} expires ${cov.expiresAt} — request renewal now.`,
      });
    }
  }

  // Coverage limits — soft sanity check (most projects expect $1M GL minimum)
  const gl = coverages.find(c => c.type === 'general_liability');
  if (gl && gl.eachOccurrence != null && gl.eachOccurrence < 1_000_000) {
    issues.push({
      code: 'gl_limit_below_required',
      severity: 'warning',
      message: `GL each-occurrence limit ($${gl.eachOccurrence.toLocaleString()}) is below the $1M typical minimum. Confirm against your contract requirements.`,
    });
  }

  // Overall status
  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasWarning = issues.some(i => i.severity === 'warning');
  const overallStatus = hasCritical ? 'fail' : hasWarning ? 'warn' : 'pass';

  return {
    coverages,
    validation: {
      validatedAt: new Date().toISOString(),
      overallStatus,
      issues,
      confidence: raw.confidence,
    },
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
 * Re-compute issues without re-running AI — used when the GC manually
 * edits coverage dates and we want to recompute "expires within N days"
 * findings live.
 */
export function recomputeValidation(
  coverages: COICoverage[],
  prior: COIValidationResult | undefined,
): COIValidationResult {
  const issues: COIValidationResult['issues'] = [];
  const now = Date.now();
  const thirtyDays = 30 * 86400000;

  // Preserve endorsement findings from prior AI run (the GC can't
  // determine these by editing dates).
  const priorEndorsements = (prior?.issues ?? []).filter(i =>
    i.code === 'additional_insured_missing' || i.code === 'waiver_subrogation_missing'
  );
  issues.push(...priorEndorsements);

  for (const cov of coverages) {
    if (!cov.expiresAt) continue;
    const exp = new Date(cov.expiresAt).getTime();
    if (isNaN(exp)) continue;
    if (exp < now) {
      issues.push({
        code: 'expired',
        severity: 'critical',
        message: `${humanCoverage(cov.type)} expired on ${cov.expiresAt}.`,
      });
    } else if (exp < now + thirtyDays) {
      issues.push({
        code: 'expires_within_30_days',
        severity: 'warning',
        message: `${humanCoverage(cov.type)} expires ${cov.expiresAt} — request renewal now.`,
      });
    }
  }

  const hasCritical = issues.some(i => i.severity === 'critical');
  const hasWarning = issues.some(i => i.severity === 'warning');
  return {
    validatedAt: new Date().toISOString(),
    overallStatus: hasCritical ? 'fail' : hasWarning ? 'warn' : 'pass',
    issues,
    confidence: prior?.confidence,
  };
}
