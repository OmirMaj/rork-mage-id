// utils/delayScan/delayPrompt.ts — the ONE AI seam of the Delay Cascade.
// The model's only job: read the daily report's issuesAndDelays free text
// into {taskTitleGuess, deltaDays, quote} proposals. The user confirms the
// task + days; every schedule number afterwards comes from the pure CPM
// pipeline. coerceDelayResult never trusts the model's JSON. React/RN-free.

export interface DelayHit {
  /** Best-match against the provided task titles — verbatim from the list, or ''. */
  taskTitleGuess: string;
  /** Proposed delay in days (integer >= 1; vague language → 1). */
  deltaDays: number;
  /** The exact report phrase that describes the delay — anchors the confirm row. */
  quote: string;
}

export interface DelayScanResult {
  /** Empty = no delay language found. */
  hits: DelayHit[];
}

export const MAX_DELAY_HITS = 5;
export const MAX_DELTA_DAYS = 60;

/** Plain-JSON example sent as mageAI schemaHint (sets jsonMode on the relay). */
export const DELAY_SCHEMA_HINT = {
  hits: [{
    taskTitleGuess: 'Electrical rough-in',
    deltaDays: 2,
    quote: 'inspector no-show, rough-in pushed 2 days',
  }],
};

export function buildDelayPrompt(issuesText: string, taskTitles: string[]): string {
  const titles = (taskTitles ?? []).map(t => (t ?? '').trim()).filter(Boolean);
  return [
    'You are a construction scheduler reading a daily report for the general contractor.',
    "Find every SCHEDULE DELAY the report's issues text explicitly describes, and map each to one of the schedule's task titles.",
    '',
    'Rules:',
    '- Only report delays the text explicitly describes. Prefer an empty hits list over speculation.',
    '- taskTitleGuess must be copied VERBATIM from the task list below, or "" when no listed task clearly matches.',
    '- deltaDays is a whole number of days, minimum 1. Vague language ("delayed", "pushed back") with no number means 1.',
    '- quote is the exact phrase from the issues text that describes the delay.',
    '- Weather, inspection, material and labor delays all count; complaints with no schedule effect do not.',
    '- Respond with JSON only, matching the provided shape.',
    '',
    '=== SCHEDULE TASKS ===',
    titles.length ? titles.map(t => `- ${t}`).join('\n') : '(no tasks)',
    '',
    "=== ISSUES AND DELAYS (today's report) ===",
    issuesText?.trim() || '(none)',
  ].join('\n');
}

export function coerceDelayResult(data: unknown): DelayScanResult {
  const rawHits: unknown[] = Array.isArray(data)
    ? data
    : (data && typeof data === 'object' && Array.isArray((data as { hits?: unknown[] }).hits))
      ? (data as { hits: unknown[] }).hits
      : [];
  const hits: DelayHit[] = [];
  for (const raw of rawHits) {
    if (hits.length >= MAX_DELAY_HITS) break;
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const quote = typeof r.quote === 'string' ? r.quote.trim() : '';
    if (!quote) continue; // the quote anchors the confirm row — no quote, no hit
    const n = typeof r.deltaDays === 'number' && Number.isFinite(r.deltaDays) ? Math.round(r.deltaDays) : 1;
    hits.push({
      taskTitleGuess: typeof r.taskTitleGuess === 'string' ? r.taskTitleGuess.trim() : '',
      deltaDays: Math.min(MAX_DELTA_DAYS, Math.max(1, n)),
      quote,
    });
  }
  return { hits };
}

/** djb2 over normalized text — stable across sessions, cheap, collision-fine
 *  for a per-report cache key. */
export function hashDelayText(issuesText: string): string {
  const text = (issuesText ?? '').trim().toLowerCase();
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
