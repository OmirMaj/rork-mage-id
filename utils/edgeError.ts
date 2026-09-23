// utils/edgeError.ts — the ONE reader for a supabase-js edge-function error.
//
// supabase-js collapses every non-2xx into "Edge Function returned a non-2xx
// status code". The real reason — a monthly cap ("…Resets on the 1st."), an
// hourly limit, a tier gate ("Takeoffs aren't included on the free plan…"), a
// page-range refusal ("That PDF has 12 pages — there is no page 14.") — is the
// JSON `{ error, code }` the function wrote, hanging off `error.context` (a
// Response). Audit #79: Compare Drawings and every PDF import showed the
// collapsed sentence instead, because only Ask Your Plans and the code reviewer
// read the body, each with its own copy of this function.
//
// The body can be read ONCE. Read it here, and nowhere else.

export interface EdgeErrorInfo {
  /** The function's own sentence (already written for the user), else a
   *  fallback with the HTTP status, else the transport error's message. */
  message: string;
  /** The function's `code` (`monthly_cap_reached`, `hourly_limit`,
   *  `start_page_past_end`, …), `http_<status>` for a non-JSON body, '' when
   *  nothing reached the server. */
  code: string;
}

export async function readEdgeError(error: unknown, fallback: string): Promise<EdgeErrorInfo> {
  const err = error as { message?: unknown; context?: { status?: unknown; json?: () => Promise<unknown> } } | null;
  const ctx = err?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json() as { error?: unknown; code?: unknown } | null;
      const code = typeof body?.code === 'string' ? body.code.trim() : '';
      const message = typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : '';
      if (message || code) return { message: message || code, code };
    } catch {
      // Not JSON (or already consumed) — fall through to the status.
    }
    if (typeof ctx.status === 'number' && ctx.status > 0) {
      return { message: `${fallback} (HTTP ${ctx.status})`, code: `http_${ctx.status}` };
    }
  }
  return { message: typeof err?.message === 'string' && err.message.trim() ? err.message : fallback, code: '' };
}

/** An Error carrying the function's code, so a screen can tell a cap (stop,
 *  offer the upgrade) from a transient failure (try again). */
export type EdgeFunctionError = Error & { code: string };

export async function edgeFunctionError(error: unknown, fallback: string): Promise<EdgeFunctionError> {
  const info = await readEdgeError(error, fallback);
  return Object.assign(new Error(info.message), { code: info.code });
}

/** The `code` of an error thrown by edgeFunctionError, '' for anything else. */
export function edgeErrorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
}

/**
 * The HTTP status a supabase-js edge error carries (FunctionsHttpError hangs
 * the Response off `.context`), read WITHOUT touching the body — so a caller
 * can decide "transient, retry" first and still hand the untouched error to
 * edgeFunctionError, which reads the body its one time. null when nothing
 * reached the server: a timeout (invokeWithTimeout's 'Took too long') or a
 * network failure has no context, so it is never mistaken for a 5xx.
 */
export function edgeErrorStatus(error: unknown): number | null {
  const status = (error as { context?: { status?: unknown } } | null)?.context?.status;
  return typeof status === 'number' && Number.isFinite(status) && status > 0 ? status : null;
}

/**
 * Audit #124 / CONTRACT 26: a refusal that running the tool again will not fix.
 *   'plan'   — the month's allowance is spent, or the plan doesn't include the
 *              tool: show the server's sentence and the way to a bigger plan,
 *              never "try again".
 *   'hourly' — the per-hour limit: the server's sentence says when, and that
 *              IS the message.
 *   null     — anything else (a blip, a bad file): the screen's own handling.
 */
export type AiRefusalKind = 'plan' | 'hourly';

export function aiRefusalKind(err: unknown): AiRefusalKind | null {
  const code = edgeErrorCode(err);
  if (code === 'monthly_cap_reached' || code === 'tier_required') return 'plan';
  if (code === 'hourly_limit') return 'hourly';
  return null;
}
