// drawingAnalyzer — wraps the analyze-drawings edge function so the
// app-side flow is: pick PDF → renderToPngs → analyze → show results.
//
// The result is intentionally rich. The UI shows the user EVERYTHING
// the AI looked at, what it inferred, what it's not sure about, and
// what to double-check before committing to numbers.

import { supabase } from '@/lib/supabase';

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
  pageUrls: string[];
  projectName?: string;
  projectType?: string;
  squareFootage?: number;
  location?: string;
  quality?: 'standard' | 'premium' | 'luxury';
  notes?: string;
  model?: AnalyzerModel;
}

export interface AnalyzeResponse {
  result: DrawingAnalysisResult;
  modelUsed: AnalyzerModel;
}

export async function analyzeDrawings(opts: AnalyzeOpts): Promise<AnalyzeResponse> {
  if (!opts.pageUrls || opts.pageUrls.length === 0) {
    throw new Error('No drawing pages to analyze.');
  }
  const { data, error } = await supabase.functions.invoke<{
    success: boolean;
    data?: DrawingAnalysisResult;
    modelUsed?: AnalyzerModel;
    error?: string;
  }>('analyze-drawings', {
    body: opts,
  });
  if (error) throw new Error(`Analyzer call failed: ${error.message}`);
  if (!data?.success || !data.data) {
    throw new Error(data?.error ?? 'Analyzer returned an empty result.');
  }
  return {
    result: data.data,
    modelUsed: data.modelUsed ?? 'gemini-2.5-flash',
  };
}
