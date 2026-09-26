// utils/plans/planSweepRun.ts — the I/O half of Plan Set Code Sweep. The pure
// decisions live in utils/plans/planSweep.ts; this file only makes the calls.
//
// TWO STAGES, each started by its own tap. Nothing here runs when the panel
// mounts, and nothing metered runs before a tap:
//   A. findSweepSheets — a free index-manifest read, a free allowance read, then
//      ONE plan search per scope topic (project-memory-search, metered on the
//      owner's Project Memory allowance). He sees WHICH sheets before any plan
//      review is spent.
//   B. reviewSweepSheets — one analyze-plan-code review per chosen sheet, in
//      order, each counted against his monthly plan-review allowance. It stops
//      on the first cap or limit and lists the rest as not reviewed.
//
// Every refusal is read through utils/edgeError (the function's own sentence
// and `code`), never matched on English and never reduced to "search failed".
// Nothing is persisted: a sweep lives in the panel's state until it closes.

import { supabase } from '@/lib/supabase';
import { readEdgeError } from '@/utils/edgeError';
import { imageUriToBase64, reviewPlanCode, PlanCodeError, type PlanCodeFindingRaw } from '@/utils/planCodeReviewer';
import { readPlanIndexManifest } from './askYourPlans';
import { PLAN_SOURCE } from './planChunk';
import type { PlanMatch } from './planAnswer';
import {
  selectSheets, sweepCopy, SWEEP_MAX_SHEETS,
  type NotReviewedSheet, type SelectedSheet, type SweepSearch, type SweepReason, type SweepTarget,
} from './planSweep';
import type { PlanSheet } from '@/types';

/** A search refusal that ends stage A with nothing to show. */
const SEARCH_REFUSED_CODES = new Set(['tier_required', 'project_unavailable']);
/** A search refusal that stops stage A; sheets not yet chosen carry its sentence. */
const SEARCH_STOP_CODES = new Set(['cap_reached', 'rate_limited', 'rate_limiter_unavailable']);

export interface SweepAllowance {
  cap: number;
  /** Plan reviews used this month, or null when the read failed. */
  used: number | null;
  /** cap − used, or null when the read failed (never assumed to be 0). */
  remaining: number | null;
  /** The most sheets this sweep will review. */
  limit: number;
  readFailed: boolean;
}

/**
 * How many plan reviews are left this month: the same `ai_usage_get` read Plan
 * Review makes. A failed read is NOT zero used — the limit falls back to the
 * cap and the server's own refusal stops the run.
 */
export async function readSweepAllowance(userId: string | null | undefined, cap: number): Promise<SweepAllowance> {
  const safeCap = Math.max(0, Math.floor(Number.isFinite(cap) ? cap : 0));
  const failed: SweepAllowance = { cap: safeCap, used: null, remaining: null, limit: Math.min(SWEEP_MAX_SHEETS, safeCap), readFailed: true };
  if (!userId) return failed;
  try {
    const { data, error } = await supabase.rpc('ai_usage_get', { p_user_id: userId, p_feature: 'plan_code_review' });
    if (error || typeof data !== 'number' || !Number.isFinite(data)) return failed;
    const remaining = Math.max(0, safeCap - data);
    return { cap: safeCap, used: data, remaining, limit: Math.min(SWEEP_MAX_SHEETS, remaining), readFailed: false };
  } catch {
    return failed;
  }
}

export type FindSweepResult =
  | { state: 'needs_index' }
  | { state: 'refused'; message: string; code: string }
  | {
    state: 'ready';
    selected: SelectedSheet[];
    notReviewed: NotReviewedSheet[];
    allowance: SweepAllowance;
    /** The index manifest could not be read; sheets were left to the search. */
    indexUnknown: boolean;
    /** The function's own sentence when a refusal stopped the searches. */
    stoppedWhy: string | null;
    searchesRun: number;
  };

/** Stage A. One plan search per topic, then the pure selection. */
export async function findSweepSheets(opts: {
  projectId: string;
  sheets: readonly PlanSheet[];
  targets: readonly SweepTarget[];
  userId: string | null | undefined;
  monthlyCap: number;
  signal?: { aborted: boolean };
}): Promise<FindSweepResult> {
  const current = opts.sheets.filter(s => s.superseded !== true);
  // A free manifest read — the same source Ask your plans uses for "changed
  // since the last index". Never prunes (prune=false).
  const manifest = await readPlanIndexManifest(opts.projectId, [...opts.sheets], false);
  const indexed = manifest ? new Set(current.filter(s => !manifest.staleIds.has(s.id)).map(s => s.id)) : null;
  if (indexed && indexed.size === 0) return { state: 'needs_index' };

  const allowance = await readSweepAllowance(opts.userId, opts.monthlyCap);

  const searches: SweepSearch[] = [];
  let stoppedWhy: string | null = null;
  for (const target of opts.targets) {
    if (opts.signal?.aborted) { stoppedWhy = sweepCopy.cancelled; break; }
    const { data, error } = await supabase.functions.invoke('project-memory-search', {
      body: { projectId: opts.projectId, query: target.phrase, matchCount: 8, sources: [PLAN_SOURCE] },
    });
    if (error || data?.success !== true) {
      const info = error
        ? await readEdgeError(error, 'The plan search could not be reached')
        : {
          message: typeof data?.error === 'string' && data.error.trim() ? data.error.trim() : 'The plan search could not be reached',
          code: typeof data?.code === 'string' ? data.code : '',
        };
      if (SEARCH_REFUSED_CODES.has(info.code)) return { state: 'refused', message: info.message, code: info.code };
      if (SEARCH_STOP_CODES.has(info.code)) { stoppedWhy = info.message; break; }
      searches.push({ target, matches: null });
      continue;
    }
    // Keep the source filter: a function not yet redeployed ignores `sources`.
    const matches = ((data?.matches ?? []) as PlanMatch[]).filter(m => m?.source === PLAN_SOURCE);
    searches.push({ target, matches });
  }

  const { selected, notReviewed } = selectSheets({
    searches,
    sheets: current,
    indexedSheetIds: indexed,
    limit: allowance.limit,
    stoppedWhy,
    overLimitWhy: allowance.remaining === 0 ? sweepCopy.monthlyLimit : null,
  });
  return {
    state: 'ready', selected, notReviewed, allowance,
    indexUnknown: indexed === null, stoppedWhy, searchesRun: searches.length,
  };
}

export interface ReviewedSheet {
  sheet: PlanSheet;
  reasons: SweepReason[];
  findings: PlanCodeFindingRaw[];
}

export interface ReviewSweepResult {
  reviewed: ReviewedSheet[];
  /** Sheets chosen in stage A that stage B did not review, each with why. */
  notReviewed: NotReviewedSheet[];
  stoppedWhy: string | null;
}

const sheetLabel = (s: PlanSheet) => (s.sheetNumber ?? '').trim() || s.name || 'Sheet';

/** Stage B. The chosen sheets, one plan review each, in order. */
export async function reviewSweepSheets(opts: {
  selected: readonly SelectedSheet[];
  limit: number;
  location?: string;
  projectType?: string;
  jurisdictionBlock?: string;
  onProgress?: (sheetLabel: string, index: number, total: number) => void;
  signal?: { aborted: boolean };
}): Promise<ReviewSweepResult> {
  const limit = Math.max(0, Math.floor(Number.isFinite(opts.limit) ? opts.limit : 0));
  const queue = opts.selected.slice(0, limit);
  const reviewed: ReviewedSheet[] = [];
  const notReviewed: NotReviewedSheet[] = opts.selected.slice(limit)
    .map(x => ({ sheet: x.sheet, kind: 'over_limit' as const, why: sweepCopy.whyOverLimit(limit) }));
  let stoppedWhy: string | null = null;

  for (let i = 0; i < queue.length; i++) {
    const { sheet, reasons } = queue[i];
    const stopRest = (kind: NotReviewedSheet['kind'], why: string) => {
      for (const rest of queue.slice(i)) notReviewed.push({ sheet: rest.sheet, kind, why });
    };
    if (opts.signal?.aborted) { stoppedWhy = sweepCopy.cancelled; stopRest('cancelled', sweepCopy.cancelled); break; }
    opts.onProgress?.(sheetLabel(sheet), i + 1, queue.length);

    let image: { base64: string; mimeType: string };
    try {
      image = await imageUriToBase64(sheet.imageUri);
    } catch {
      notReviewed.push({ sheet, kind: 'review_failed', why: sweepCopy.imageUnreadable });
      continue;
    }
    if (!image.base64) { notReviewed.push({ sheet, kind: 'review_failed', why: sweepCopy.imageUnreadable }); continue; }

    try {
      const res = await reviewPlanCode({
        imageBase64: image.base64,
        mimeType: image.mimeType,
        location: opts.location,
        projectType: opts.projectType,
        jurisdictionBlock: opts.jurisdictionBlock,
        sweep: { scopeTargets: reasons.map(r => r.topic) },
      });
      reviewed.push({ sheet, reasons, findings: res.findings });
    } catch (e) {
      const code = e instanceof PlanCodeError ? e.code : '';
      const reason = e instanceof PlanCodeError ? e.reason : (e instanceof Error ? e.message : '');
      if (code === 'monthly_cap_reached') { stoppedWhy = sweepCopy.monthlyLimit; stopRest('review_stopped', sweepCopy.monthlyLimit); break; }
      if (code === 'hourly_limit') { stoppedWhy = sweepCopy.hourlyLimit; stopRest('review_stopped', sweepCopy.hourlyLimit); break; }
      if (code === 'tier_required' || code === 'rate_limiter_unavailable') {
        stoppedWhy = reason || sweepCopy.reviewFailed('');
        stopRest('review_stopped', sweepCopy.reviewFailed(reason));
        break;
      }
      notReviewed.push({ sheet, kind: 'review_failed', why: sweepCopy.reviewFailed(reason) });
    }
  }
  return { reviewed, notReviewed, stoppedWhy };
}
