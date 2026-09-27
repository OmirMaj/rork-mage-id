// supabase/functions/fetch-external-data/sourceStatus.ts
//
// SUPA-H1 (health lane NOTIFYOPS). The per-source verdict for one
// fetch-external-data run, and what the run as a whole answers.
//
// THE BUG. SAM.gov started answering every page with 401 API_KEY_INVALID.
// fetchSamPage logged it and returned [], the run carried on with zero rows,
// the heartbeat fired and the function answered 200 {success:true}, four times
// a day for months. cached_bids stopped moving on 2026-06-22 and nothing, not
// the BetterStack monitor, not the function's own response, said so.
//
// THE RULE. A provider whose key is present and that answered 401/403, threw,
// failed its write, or pulled zero rows FAILED. A provider with no key, or one
// that is not due this run (Google Places refreshes weekly), is SKIPPED, which
// is neither failed nor ok-with-rows. Any failure: the function answers 502
// {success:false, failedSources, sources} and does NOT ping the heartbeat, so
// the monitor alerts. The other providers still run and save; a failure in one
// never throws away another's rows.
//
// Pure: no imports, no Deno globals, so `bun scripts/validate-health-notifyops.ts`
// imports it directly.

export interface SourceInput {
  name: string;
  /** The provider's API key (or key pair) is configured. */
  keyPresent: boolean;
  /** Not due this run (e.g. the weekly Places refresh ran 3 days ago). */
  notDue?: boolean;
  /** HTTP statuses of the provider's non-OK answers this run (empty when every call was OK). */
  failedStatuses?: number[];
  /** Rows the provider handed back this run. */
  rows: number;
  /** A thrown error while fetching, or null. */
  error?: string | null;
  /** The upsert into the cache failed, or null. */
  writeError?: string | null;
}

export interface SourceResult {
  name: string;
  ok: boolean;
  skipped: boolean;
  rows: number;
  error: string | null;
}

export function isAuthFailure(status: number): boolean {
  return status === 401 || status === 403;
}

export function sourceVerdict(input: SourceInput): SourceResult {
  const base = { name: input.name, rows: Math.max(0, input.rows | 0) };
  if (!input.keyPresent) return { ...base, ok: true, skipped: true, error: 'no API key configured' };
  if (input.notDue) return { ...base, ok: true, skipped: true, error: null };
  const statuses = input.failedStatuses ?? [];
  const auth = statuses.find(isAuthFailure);
  if (auth !== undefined) return { ...base, ok: false, skipped: false, error: `provider refused the key (HTTP ${auth})` };
  if (input.error) return { ...base, ok: false, skipped: false, error: input.error };
  if (input.writeError) return { ...base, ok: false, skipped: false, error: `cache write failed: ${input.writeError}` };
  if (base.rows === 0) {
    const last = statuses.length > 0 ? ` (last HTTP ${statuses[statuses.length - 1]})` : '';
    return { ...base, ok: false, skipped: false, error: `pulled 0 rows with a key present${last}` };
  }
  return { ...base, ok: true, skipped: false, error: null };
}

export interface CycleOutcome {
  /** Every source ok or skipped: ping the heartbeat and answer 200. */
  allOk: boolean;
  status: 200 | 502;
  failedSources: string[];
  body: Record<string, unknown>;
}

export function cycleOutcome(sources: SourceResult[], timestamp: string): CycleOutcome {
  const failedSources = sources.filter((s) => !s.ok).map((s) => s.name);
  if (failedSources.length > 0) {
    return {
      allOk: false,
      status: 502,
      failedSources,
      body: { success: false, failedSources, sources, timestamp },
    };
  }
  return {
    allOk: true,
    status: 200,
    failedSources,
    body: { success: true, message: 'Data fetch cycle complete', sources, timestamp },
  };
}
