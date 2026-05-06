// compareDrawings — client wrapper around the compare-drawings edge fn.
// Sends two image URLs (old + new revision of the same sheet) and gets
// back a structured diff: changes by type, severity, suggested actions,
// and RFI candidates for anything ambiguous.
//
// Pairs with utils/specMatcher.ts and utils/photoAnalyzer.ts — same
// pattern. Throws on any error so the caller can surface it to the
// user; never silently returns an empty list.

import { supabase } from '@/lib/supabase';

export type CompareModel = 'gemini-2.5-flash' | 'gemini-2.5-pro';
export type ChangeType = 'added' | 'removed' | 'modified' | 'renote';
export type ChangeImpact = 'none' | 'minor' | 'moderate' | 'major';
export type CompareSeverity = 'low' | 'medium' | 'high';

export interface DrawingChange {
  type: ChangeType;
  /** Where on the sheet — room name, grid line, callout code. */
  location: string;
  /** Plain-language description of what changed. */
  description: string;
  /** Cost / schedule impact estimate. */
  impact: ChangeImpact;
  /** One-line suggested next step (file CO, issue RFI, etc.). */
  suggestedAction: string;
}

export interface DrawingRfiCandidate {
  subject: string;
  question: string;
}

export interface CompareDrawingsResult {
  /** 1-2 sentence plain-English summary the GC reads first. */
  summary: string;
  severity: CompareSeverity;
  changes: DrawingChange[];
  rfiCandidates: DrawingRfiCandidate[];
}

export interface CompareDrawingsOpts {
  /** URL to the old revision image. Must be publicly fetchable from
   *  the edge function (storage public URL or already-hosted asset). */
  oldPageUrl: string;
  newPageUrl: string;
  sheetNumber?: string;
  projectName?: string;
  model?: CompareModel;
}

export async function compareDrawings(opts: CompareDrawingsOpts): Promise<{
  result: CompareDrawingsResult;
  modelUsed: CompareModel;
  usage?: { used: number; cap: number };
}> {
  if (!opts.oldPageUrl || !opts.newPageUrl) {
    throw new Error('Both old and new page URLs are required.');
  }
  const { data, error } = await supabase.functions.invoke<{
    success: boolean;
    data?: CompareDrawingsResult;
    modelUsed?: CompareModel;
    usage?: { used: number; cap: number };
    error?: string;
  }>('compare-drawings', { body: opts });
  if (error) throw new Error(`Compare drawings call failed: ${error.message}`);
  if (!data?.success || !data.data) {
    throw new Error(data?.error ?? 'Compare drawings returned empty.');
  }
  return {
    result: data.data,
    modelUsed: data.modelUsed ?? 'gemini-2.5-flash',
    usage: data.usage,
  };
}
