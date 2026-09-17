// drawingAnalyzer — wraps the analyze-drawings edge function so the
// app-side flow is: pick PDF → renderToPngs → analyze → show results.
//
// The result is intentionally rich. The UI shows the user EVERYTHING
// the AI looked at, what it inferred, what it's not sure about, and
// what to double-check before committing to numbers.

import { invokeWithTimeout } from '@/utils/invokeWithTimeout';

export interface DrawingSeen {
  page: number;
  type: string;
  scope: string;
  readability: 'clear' | 'partial' | 'poor';
  keyDimensions: string[];
}

export interface DrawingLineItem {
  category: string;
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  total: number;
  sourcePages: number[];
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export interface DrawingConcern {
  severity: 'minor' | 'moderate' | 'critical';
  topic: string;
  detail: string;
  recommendation: string;
}

export interface DrawingAnalysisResult {
  summary: string;
  drawingsSeen: DrawingSeen[];
  estimatedSquareFootage: number | null;
  lineItems: DrawingLineItem[];
  totals: {
    subtotal: number;
    contingencyPercent: number;
    contingencyAmount: number;
    grandTotal: number;
  };
  concerns: DrawingConcern[];
  doubleCheck: string[];
  missingScopes: string[];
  confidenceOverall: 'high' | 'medium' | 'low';
  confidenceExplanation: string;
}

// Pro Estimator is gated to Business tier — head-to-head testing showed
// Pro catching $500K+ of scope Flash missed on a 15-sheet roof set. That
// accuracy delta is the upgrade hook for Business. Pro-tier subscribers
// get Standard (Flash); Business unlocks Pro Estimator.
export type AnalyzerModel = 'gemini-2.5-flash' | 'gemini-2.5-pro';

export const MODEL_DISPLAY: Record<AnalyzerModel, { label: string; tagline: string; tier: 'pro' | 'business' }> = {
  'gemini-2.5-flash': {
    label: 'Standard',
    tagline: 'Fast read · directional estimate even from rough drawings',
    tier: 'pro',
  },
  'gemini-2.5-pro': {
    label: 'Pro Estimator',
    tagline: 'Deeper reasoning · catches scope Standard misses',
    tier: 'business',
  },
};

interface AnalyzeOpts {
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
  quality?: 'standard' | 'premium' | 'luxury';
  notes?: string;
  /**
   * The GC's Settings contingency rate (percent). The function puts it in the
   * prompt; settleDrawingTotals then applies it here regardless, so the number
   * on screen is his even against a function deployed before this field.
   */
  contingencyRate?: number;
  model?: AnalyzerModel;
}

// >>> drawing-contingency (pure; scripts/validate-drawing-contingency.ts evaluates this block)
/**
 * The contractor's contingency rate if it is one Settings would accept (a
 * finite 0-50), else null. Mirrors the estimate wizard's `rateUsable` and the
 * edge function's check. A non-number is refused rather than coerced: Number()
 * turns null and '' into 0, a 0% contingency nobody chose.
 */
export function usableContingencyRate(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 50) return null;
  return v;
}

/**
 * Totals the screen shows, with contingency settled deterministically.
 *
 * With a usable rate NONE of the model's arithmetic is trusted, the way
 * app/estimate-wizard.tsx handles its AI estimate: every line total is
 * recomputed as qty × unit price, the subtotal is the sum of those lines, and
 * contingency is his rate of THAT subtotal, folded into the grand total. The
 * model's own `totals.subtotal` is only used when it returned no line items —
 * otherwise "your rate" would be applied to a number that disagrees with the
 * lines on screen and with the baseTotal "Use as estimate" saves (Σ lines).
 *
 * A line whose category names contingency is dropped. The function deployed
 * before this change still lists "Contingency" as a line-item category, so a
 * model can put contingency in a line AND in totals; adding his rate on top of
 * that line would charge contingency twice.
 *
 * Without a rate the model's result stands untouched and is labelled as the
 * model's (rateUsed null). Money is rounded to the cent.
 */
export function settleDrawingTotals(
  result: DrawingAnalysisResult,
  rate: number | null,
): { result: DrawingAnalysisResult; contingencyRateUsed: number | null } {
  if (rate == null) return { result, contingencyRateUsed: null };
  const cents = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  const finite = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  const rawLines = Array.isArray(result.lineItems) ? result.lineItems : [];
  const lineItems = rawLines
    .filter(li => !/contingency/i.test(String(li?.category ?? '')))
    .map(li => {
      const quantity = finite(li.quantity);
      const unitPrice = finite(li.unitPrice);
      return { ...li, quantity, unitPrice, total: cents(quantity * unitPrice) };
    });
  const subtotal = rawLines.length > 0
    ? cents(lineItems.reduce((s, li) => s + li.total, 0))
    : cents(Number(result.totals?.subtotal));
  const contingencyAmount = cents(subtotal * rate / 100);
  return {
    result: {
      ...result,
      lineItems,
      totals: {
        subtotal,
        contingencyPercent: rate,
        contingencyAmount,
        grandTotal: cents(subtotal + contingencyAmount),
      },
    },
    contingencyRateUsed: rate,
  };
}
// <<< drawing-contingency

export interface AnalyzeResponse {
  result: DrawingAnalysisResult;
  modelUsed: AnalyzerModel;
  /** The rate contingency was settled at (his Settings rate), or null when
   *  the figure is the model's own 8-12% pick. */
  contingencyRateUsed: number | null;
}

export async function analyzeDrawings(opts: AnalyzeOpts): Promise<AnalyzeResponse> {
  if (!opts.pagePaths || opts.pagePaths.length === 0) {
    throw new Error('No drawing pages to analyze.');
  }
  // An unusable rate is not sent at all, so the function's generic 8-12% line
  // and this side's "model's pick" label always describe the same run.
  const rate = usableContingencyRate(opts.contingencyRate);
  const { contingencyRate: _ignored, ...rest } = opts;
  const body = rate == null ? rest : { ...rest, contingencyRate: rate };
  const { data, error } = await invokeWithTimeout<{
    success: boolean;
    data?: DrawingAnalysisResult;
    modelUsed?: AnalyzerModel;
    error?: string;
  }>('analyze-drawings', {
    body: body as unknown as Record<string, unknown>,
  });
  if (error) throw new Error(`Analyzer call failed: ${error.message}`);
  if (!data?.success || !data.data) {
    throw new Error(data?.error ?? 'Analyzer returned an empty result.');
  }
  const settled = settleDrawingTotals(data.data, rate);
  return {
    result: settled.result,
    modelUsed: data.modelUsed ?? 'gemini-2.5-flash',
    contingencyRateUsed: settled.contingencyRateUsed,
  };
}
