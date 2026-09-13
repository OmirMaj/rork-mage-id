// takeoffAnalyzer — client wrapper around the analyze-takeoff edge fn.
//
// Mirrors utils/drawingAnalyzer.ts but for raw quantity takeoffs
// (linear feet, square feet, counts) rather than a cost estimate.
// Output schema is types/index.ts:TakeoffResult.

import { supabase } from '@/lib/supabase';
import type { TakeoffResult } from '@/types';

export type TakeoffModel = 'gemini-2.5-flash' | 'gemini-2.5-pro' | 'claude-sonnet-4-5';

export interface AnalyzeTakeoffOpts {
  /**
   * Storage PATHS inside the `plan-sheets` bucket — the PREFERRED input.
   *
   * DB-F11: handing a server a fetchable URL is the weaker design. It needs the
   * object readable by URL, the signature can expire mid-analysis, and it keeps
   * an SSRF-shaped surface open. The function runs with the SERVICE ROLE, so it
   * can download the bytes itself and needs no URL at all.
   */
  pagePaths: string[];
  /**
   * DEPRECATED, one release only. An installed build keeps sending these until
   * the OTA lands, so the function still accepts them; sending both here means
   * the OTA is safe whichever order the function deploy and the OTA happen in.
   * Delete this field (and the server's `pageUrls` arm) next release.
   */
  pageUrls?: string[];
  projectName?: string;
  projectType?: string;
  squareFootage?: number;
  location?: string;
  notes?: string;
  /** Defaults to flash; pro requires Business tier (server enforces). */
  model?: TakeoffModel;
}

export interface AnalyzeTakeoffResponse {
  result: TakeoffResult;
  modelUsed: TakeoffModel;
  usage?: { used: number; cap: number };
}

/**
 * Run a takeoff against the supplied drawing pages. Throws on error.
 * Server enforces tier gate, monthly cap, and rejects free tier.
 */
export async function analyzeTakeoff(opts: AnalyzeTakeoffOpts): Promise<AnalyzeTakeoffResponse> {
  if (!opts.pagePaths || opts.pagePaths.length === 0) {
    throw new Error('No drawing pages to analyze.');
  }
  const { data, error } = await supabase.functions.invoke<{
    success: boolean;
    data?: TakeoffResult;
    modelUsed?: TakeoffModel;
    usage?: { used: number; cap: number };
    error?: string;
  }>('analyze-takeoff', {
    body: opts,
  });
  if (error) throw new Error(`Takeoff call failed: ${error.message}`);
  if (!data?.success || !data.data) {
    throw new Error(data?.error ?? 'Takeoff returned an empty result.');
  }
  return {
    result: data.data,
    modelUsed: data.modelUsed ?? 'gemini-2.5-flash',
    usage: data.usage,
  };
}

/** Compute total wall surface area (sqft, both sides) from a Wall list. */
export function totalWallAreaSqFt(walls: TakeoffResult['walls']): number {
  return walls.reduce((sum, w) => {
    const sides = 2; // assume both sides finished — caller can adjust
    return sum + (w.lengthFt * w.heightFt * sides);
  }, 0);
}

/** Total floor area across all rooms. */
export function totalFloorAreaSqFt(floorAreas: TakeoffResult['floorAreas']): number {
  return floorAreas.reduce((sum, f) => sum + f.areaSqFt, 0);
}

/** Total door count. */
export function totalDoorCount(doors: TakeoffResult['doors']): number {
  return doors.reduce((sum, d) => sum + d.count, 0);
}

/** Total window count. */
export function totalWindowCount(windows: TakeoffResult['windows']): number {
  return windows.reduce((sum, w) => sum + w.count, 0);
}

/** Group finishes by surface for trade-level summaries. */
export function finishesBySurface(finishes: TakeoffResult['finishes']): Record<string, TakeoffResult['finishes']> {
  const out: Record<string, TakeoffResult['finishes']> = {};
  for (const f of finishes) {
    if (!out[f.surface]) out[f.surface] = [];
    out[f.surface].push(f);
  }
  return out;
}

/** Confidence rollup — returns 'low' if any item is low, otherwise 'medium' if any medium, else 'high'. */
export function rollupConfidence(items: { confidence: 'high' | 'medium' | 'low' }[]): 'high' | 'medium' | 'low' {
  if (items.some(i => i.confidence === 'low')) return 'low';
  if (items.some(i => i.confidence === 'medium')) return 'medium';
  return 'high';
}
