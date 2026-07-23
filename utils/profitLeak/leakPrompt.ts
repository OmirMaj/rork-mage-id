// utils/profitLeak/leakPrompt.ts — the ONE AI seam of the Profit Leak faculty.
// buildLeakPrompt: grounded prompt (scope + report, strict rules).
// coerceLeakResult: pure, zod-free coercion of the model's JSON into LeakItem[]
//   — one malformed field never tanks the scan.
// hashLeakText: stable hash of the scanned text → cache key + staleness check.
import type { LeakItem } from '@/types';

export interface LeakReportInput {
  workPerformed: string;
  issuesAndDelays: string;
  materialsDelivered: string[];
}

/** AI response envelope — what the model is asked to return. */
export interface LeakScanResult {
  items: LeakItem[];
}

export const MAX_LEAK_ITEMS = 10;

/** Plain-JSON example sent as mageAI schemaHint (sets jsonMode on the relay). */
export const LEAK_SCHEMA_HINT = {
  items: [{
    description: 'Installed 3 extra recessed lights in the hallway',
    trade: 'Electrical',
    unit: 'ea',
    quantity: 3,
    confidence: 'medium',
    reportQuote: 'added three more cans in the hall per the owner',
  }],
};

export function buildLeakPrompt(scopeSummary: string, report: LeakReportInput): string {
  const materials = (report.materialsDelivered ?? []).filter(Boolean);
  return [
    'You are a construction change-order auditor working for the general contractor.',
    "Compare TODAY'S DAILY REPORT against the CONTRACTED SCOPE and identify work that is likely OUT OF SCOPE (extra work the GC should bill as a change order).",
    '',
    'Rules:',
    '- Compare ONLY against the scope provided below. Do not assume any scope that is not written here.',
    '- Work listed under "already approved additions" is in scope — never flag it.',
    '- For every flagged item, set reportQuote to the exact phrase from the report that triggered it.',
    '- Prefer an empty items list over speculation. Only flag work the report clearly describes.',
    '- quantity is your best guess from the report; use unit "ls" and quantity 1 for lump-sum work.',
    '- confidence is how sure you are the item is out of scope: low, medium, or high.',
    '- Respond with JSON only, matching the provided shape.',
    '',
    '=== CONTRACTED SCOPE ===',
    scopeSummary,
    '',
    "=== TODAY'S DAILY REPORT ===",
    `Work performed: ${report.workPerformed?.trim() || '(none)'}`,
    `Issues and delays: ${report.issuesAndDelays?.trim() || '(none)'}`,
    `Materials delivered: ${materials.length ? materials.join('; ') : '(none)'}`,
  ].join('\n');
}

const CONFIDENCES = new Set(['low', 'medium', 'high']);

export function coerceLeakResult(data: unknown): LeakItem[] {
  const rawItems: unknown[] = Array.isArray(data)
    ? data
    : (data && typeof data === 'object' && Array.isArray((data as { items?: unknown[] }).items))
      ? ((data as { items: unknown[] }).items)
      : [];
  const out: LeakItem[] = [];
  for (const raw of rawItems) {
    if (out.length >= MAX_LEAK_ITEMS) break;
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    if (!description) continue;
    const qty = typeof r.quantity === 'number' && Number.isFinite(r.quantity) && r.quantity > 0 ? r.quantity : 1;
    out.push({
      description,
      trade: typeof r.trade === 'string' && r.trade.trim() ? r.trade.trim() : 'General',
      unit: typeof r.unit === 'string' && r.unit.trim() ? r.unit.trim() : 'ls',
      quantity: qty,
      confidence: typeof r.confidence === 'string' && CONFIDENCES.has(r.confidence) ? (r.confidence as LeakItem['confidence']) : 'low',
      reportQuote: typeof r.reportQuote === 'string' ? r.reportQuote.trim() : '',
    });
  }
  return out;
}

/** djb2 over normalized text — stable across sessions, cheap, collision-fine
 *  for a per-report staleness check. Includes all three inputs the prompt
 *  scans (workPerformed, issuesAndDelays, materialsDelivered) so a
 *  materials-only edit correctly invalidates cached results. */
export function hashLeakText(workPerformed: string, issuesAndDelays: string, materialsDelivered?: string[]): string {
  const mats = (materialsDelivered ?? []).filter(Boolean).join(';');
  const text = `${(workPerformed ?? '').trim()}\n${(issuesAndDelays ?? '').trim()}\n${mats}`.toLowerCase();
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
