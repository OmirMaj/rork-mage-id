// specMatcher — client wrapper around the analyze-spec-book edge fn.
//
// Pairs with utils/takeoffAnalyzer.ts. The takeoff returns callout codes
// it saw on the plans (PT-1, T-2, WC-1); this wrapper takes a separately-
// uploaded spec book PDF and returns code → manufacturer/product/finish
// mappings. The two are then merged on the client to enrich each takeoff
// row with the actual product the architect specified.

import { supabase } from '@/lib/supabase';
import type { SpecMatchResult, SpecEntry, TakeoffResult } from '@/types';

export type SpecModel = 'gemini-2.5-flash' | 'gemini-2.5-pro';

export interface AnalyzeSpecOpts {
  pageUrls: string[];
  /** Codes pulled from the takeoff. AI prioritizes matching these first. */
  targetCodes?: string[];
  projectName?: string;
  notes?: string;
  model?: SpecModel;
}

export interface AnalyzeSpecResponse {
  result: SpecMatchResult;
  modelUsed: SpecModel;
  usage?: { used: number; cap: number };
}

export async function analyzeSpecBook(opts: AnalyzeSpecOpts): Promise<AnalyzeSpecResponse> {
  if (!opts.pageUrls || opts.pageUrls.length === 0) {
    throw new Error('No spec book pages to analyze.');
  }
  const { data, error } = await supabase.functions.invoke<{
    success: boolean;
    data?: SpecMatchResult;
    modelUsed?: SpecModel;
    usage?: { used: number; cap: number };
    error?: string;
  }>('analyze-spec-book', { body: opts });
  if (error) throw new Error(`Spec book call failed: ${error.message}`);
  if (!data?.success || !data.data) {
    throw new Error(data?.error ?? 'Spec book returned an empty result.');
  }
  return {
    result: data.data,
    modelUsed: data.modelUsed ?? 'gemini-2.5-flash',
    usage: data.usage,
  };
}

/**
 * Pulls every callout code that appeared anywhere in a takeoff result.
 * Used to seed the spec matcher's `targetCodes`.
 */
export function extractCodesFromTakeoff(t: TakeoffResult): string[] {
  const codes = new Set<string>();
  for (const c of t.callouts ?? []) codes.add(c.code);
  for (const f of t.floorAreas) if (f.finishCode) codes.add(f.finishCode);
  for (const w of t.walls) if (w.typeCode) codes.add(w.typeCode);
  for (const f of t.finishes) if (f.code) codes.add(f.code);
  for (const fx of t.fixtures) if (fx.mark) codes.add(fx.mark);
  for (const d of t.doors) if (d.mark) codes.add(d.mark);
  for (const w of t.windows) if (w.mark) codes.add(w.mark);
  return Array.from(codes);
}

/**
 * Build a lookup from spec entries: code → SpecEntry. The takeoff UI then
 * does a single map.get() per row to surface the matched product inline.
 */
export function buildSpecLookup(entries: SpecEntry[]): Map<string, SpecEntry> {
  const out = new Map<string, SpecEntry>();
  for (const e of entries) {
    if (!out.has(e.code)) out.set(e.code, e);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────
// Submittal extraction — task='submittals' on the same edge function.
// Returns one entry per spec item that requires a submittal package.
// ─────────────────────────────────────────────────────────────────

export type AiSubmittalType =
  | 'Product Data' | 'Shop Drawings' | 'Sample' | 'Mix Design'
  | 'Warranty' | 'O&M Manual' | 'Test Report' | 'Certification' | 'Mock-up' | 'Other';

export interface AiSubmittalCandidate {
  title: string;
  specSection: string;
  submittalType: AiSubmittalType;
  trade: string;
  /** Days before installation the architect wants the submittal in hand.
   *  Default 14 for most items, 30 for long-lead (mock-ups, custom). */
  dueRelativeDays: number;
  sourcePages: number[];
  confidence: 'high' | 'medium' | 'low';
}

export interface AiSubmittalsResult {
  items: AiSubmittalCandidate[];
  confidenceOverall: 'high' | 'medium' | 'low';
  confidenceExplanation: string;
}

export interface ExtractSubmittalsOpts {
  pageUrls: string[];
  projectName?: string;
  notes?: string;
  model?: SpecModel;
}

/**
 * Extract submittal log entries from a spec book PDF. Pairs perfectly
 * with the existing submittals screen — the GC reviews the AI-suggested
 * list, picks which ones to log, and the rest get discarded. Replaces
 * hours of manual spec-book combing.
 */
export async function extractSubmittalsFromSpecBook(opts: ExtractSubmittalsOpts): Promise<{
  result: AiSubmittalsResult;
  modelUsed: SpecModel;
  usage?: { used: number; cap: number };
}> {
  if (!opts.pageUrls || opts.pageUrls.length === 0) {
    throw new Error('No spec book pages to analyze.');
  }
  const { data, error } = await supabase.functions.invoke<{
    success: boolean;
    data?: AiSubmittalsResult;
    modelUsed?: SpecModel;
    usage?: { used: number; cap: number };
    error?: string;
  }>('analyze-spec-book', {
    body: { ...opts, task: 'submittals' },
  });
  if (error) throw new Error(`Spec book submittals call failed: ${error.message}`);
  if (!data?.success || !data.data) {
    throw new Error(data?.error ?? 'Spec book submittals returned empty.');
  }
  return {
    result: data.data,
    modelUsed: data.modelUsed ?? 'gemini-2.5-flash',
    usage: data.usage,
  };
}
