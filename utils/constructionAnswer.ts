/**
 * Client caller for the `construction-answer` Supabase edge function.
 *
 * ERROR STRATEGY — throw typed Error (not a result union):
 *
 *   This module's public surface is `Promise<ConstructionAnswerResponse>`, the
 *   clean success type. Errors are thrown as ConstructionAnswerError with a
 *   `.code` discriminant, matching the pattern used throughout the codebase for
 *   simple async utilities (e.g. `projectMemory`, `offlineQueue`):
 *
 *     • 'needs_business'  → 403 + {code:'tier_required'}; show the paywall nudge.
 *     • 'limit_reached'   → 429 + {code:'monthly_cap'}; show the server's cap
 *                           sentence, reset moment in the reader's own clock.
 *     • 'unauthenticated' → 401 / no session; prompt sign-in.
 *     • 'offline'         → the request never reached us (no signal, DNS);
 *                           the question was NOT sent, nothing was charged.
 *     • 'timeout'         → no reply inside ANSWER_TIMEOUT_MS. The run may
 *                           still finish on the server and count toward the
 *                           month (the charge lands after the model answers).
 *     • 'server_error'    → any other non-2xx or a non-JSON body.
 *     • 'not_configured'  → the ONLY "isn't available yet": a 503 whose body
 *                           says not_configured (no ANTHROPIC_API_KEY set).
 *
 *   Every one of these used to be 'unavailable' → "Construction Answers isn't
 *   available yet." — so a GC on one bar of jobsite signal was told the feature
 *   wasn't built, and with no timeout the "Researching…" spinner could run
 *   forever (audit #121). mapConstructionAnswerFailure is the pure mapping,
 *   Bun-tested by scripts/validate-w5-ai-limits-construction.ts; that is also
 *   why lib/supabase is imported lazily inside askConstruction — this module's
 *   top level must load without the React Native runtime.
 *
 * URL + AUTH — matches mageAI.ts exactly:
 *
 *   URL     : `${SUPABASE_URL}/functions/v1/<fn-name>`  (same base as AI_URL in mageAI)
 *   Headers : Authorization: Bearer <user JWT>
 *             apikey: <SUPABASE_ANON_KEY>   (Supabase gateway requires this even with user JWT)
 *             Content-Type: application/json
 */

import type { AnswerCitation, ConstructionAnswerRequest, ConstructionAnswerResult } from '@/types/constructionAnswer';
import { withLocalMonthlyReset } from '@/utils/aiRateLimiterCore';

/**
 * The edge function's success body. `citations` are only the records and URLs
 * the answer actually used; `consulted` is everything else it looked at, shown
 * muted as "Also checked" and never under Sources (audit #120). Declared here
 * rather than in types/constructionAnswer.ts (not this lane's file) — fold it
 * into ConstructionAnswerResult when that file is next edited.
 */
export type ConstructionAnswerResponse = ConstructionAnswerResult & {
  consulted?: AnswerCitation[];
};

export type ConstructionAnswerErrorCode =
  | 'needs_business'
  | 'limit_reached'
  | 'unauthenticated'
  | 'offline'
  | 'timeout'
  | 'server_error'
  | 'not_configured'
  | 'bad_request';

/**
 * The server refuses a question over this many characters (400 "Question too
 * long"). The input caps at it so the refusal can't happen from the screen.
 */
export const MAX_QUESTION_CHARS = 4000;

/**
 * Just under the edge runtime's wall clock (150 s on the paid plan): long
 * enough for an 8-iteration agentic run with web search, short enough that the
 * spinner can never outlive the server. Web fetch has no timeout of its own.
 */
export const ANSWER_TIMEOUT_MS = 120_000;

export const CONSTRUCTION_ANSWER_COPY: Record<ConstructionAnswerErrorCode, string> = {
  needs_business: 'Construction Answers is on the Business plan.',
  limit_reached: "You've reached this month's Construction Answers limit.",
  unauthenticated: 'Session expired. Sign in again.',
  offline: "No connection — your question wasn't sent. Try again when you have signal.",
  timeout: "That took too long, so MAGE stopped waiting. The answer may still count toward this month's limit. Try again, or narrow the question.",
  server_error: "Construction Answers couldn't finish that one. Try again.",
  not_configured: "Construction Answers isn't available yet.",
  bad_request: "Construction Answers couldn't read that question. Reword it and ask again.",
};

/** The server's own 400 for an over-long question, in plain words. */
export const QUESTION_TOO_LONG_COPY =
  'That question is too long — shorten it to under 4,000 characters and ask again.';

/** How many "Also checked" labels to spell out before "+N more". */
export const CONSULTED_SHOWN = 8;

/**
 * The muted "Also checked" line. A run can consult ~60 rate categories, every
 * open RFI and every web result; spelled out in full that is a wall of text
 * nobody reads, so name the first few and count the rest. Pure.
 */
export function consultedSummary(labels: string[], shown: number = CONSULTED_SHOWN): string {
  const unique = Array.from(new Set(labels.map(l => l.trim()).filter(Boolean)));
  if (unique.length <= shown) return unique.join(' · ');
  return `${unique.slice(0, shown).join(' · ')} · +${unique.length - shown} more`;
}

/** Codes where running the same question again can help. */
export function isRetryableConstructionError(code: string | null | undefined): boolean {
  return code === 'offline' || code === 'timeout' || code === 'server_error';
}

/**
 * A typed Error subclass so callers can `instanceof ConstructionAnswerError`
 * or just check `(err as ConstructionAnswerError).code`.
 */
export class ConstructionAnswerError extends Error {
  code: ConstructionAnswerErrorCode;

  constructor(code: ConstructionAnswerErrorCode, message: string) {
    super(message);
    this.name = 'ConstructionAnswerError';
    this.code = code;
  }
}

function stringField(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const v = (body as Record<string, unknown>)[key];
  return typeof v === 'string' && v ? v : undefined;
}

/**
 * Map a non-2xx reply to the error the screen shows. Pure.
 *
 * Reads body.code AND body.error: requireTier sends `code`, but the function's
 * own not_configured / Invalid JSON / Internal error replies send only `error`.
 */
export function mapConstructionAnswerFailure(
  status: number,
  body: unknown,
  now: Date = new Date(),
): ConstructionAnswerError {
  const code = stringField(body, 'code');
  const error = stringField(body, 'error');
  const message = stringField(body, 'message');

  if (code === 'tier_required' || status === 403 || status === 402) {
    return new ConstructionAnswerError('needs_business', CONSTRUCTION_ANSWER_COPY.needs_business);
  }
  if (code === 'monthly_cap' || status === 429) {
    // The counter rolls at 00:00 UTC; the server's "Resets the 1st…" becomes
    // the moment in the reader's clock.
    return new ConstructionAnswerError(
      'limit_reached',
      withLocalMonthlyReset(message || CONSTRUCTION_ANSWER_COPY.limit_reached, now),
    );
  }
  if (status === 401 || code === 'unauthenticated') {
    return new ConstructionAnswerError('unauthenticated', CONSTRUCTION_ANSWER_COPY.unauthenticated);
  }
  if (error === 'not_configured' || code === 'not_configured') {
    return new ConstructionAnswerError('not_configured', CONSTRUCTION_ANSWER_COPY.not_configured);
  }
  // A 400 is the function refusing THIS question ("Question too long",
  // "Invalid JSON body", "question required"): sending it again fails the same
  // way, so it is never a retryable server_error with a Try again button.
  if (status === 400) {
    return new ConstructionAnswerError(
      'bad_request',
      error === 'Question too long' ? QUESTION_TOO_LONG_COPY : CONSTRUCTION_ANSWER_COPY.bad_request,
    );
  }
  return new ConstructionAnswerError('server_error', CONSTRUCTION_ANSWER_COPY.server_error);
}

/** Map a fetch that threw (never got a response). Pure. */
export function mapConstructionAnswerThrow(err: unknown, timedOut: boolean): ConstructionAnswerError {
  const isAbort = timedOut || (err instanceof Error && err.name === 'AbortError');
  return isAbort
    ? new ConstructionAnswerError('timeout', CONSTRUCTION_ANSWER_COPY.timeout)
    : new ConstructionAnswerError('offline', CONSTRUCTION_ANSWER_COPY.offline);
}

/**
 * Ask the Construction Answers engine a question.
 *
 * @throws ConstructionAnswerError — see the header for every `.code`.
 */
export async function askConstruction(
  req: ConstructionAnswerRequest,
  opts: { timeoutMs?: number } = {},
): Promise<ConstructionAnswerResponse> {
  // Lazy: keeps this module's top level free of the React Native runtime.
  const { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } = await import('@/lib/supabase');

  // Require an authenticated session — same guard as mageAI.ts.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userJWT = session?.access_token;

  if (!userJWT) {
    throw new ConstructionAnswerError('unauthenticated', 'Sign in to use Construction Answers.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, opts.timeoutMs ?? ANSWER_TIMEOUT_MS);

  let response: Response;
  let body: unknown = null;
  let bodyParsed = false;
  try {
    try {
      response = await fetch(`${SUPABASE_URL}/functions/v1/construction-answer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${userJWT}`,
          // Supabase Edge gateway requires the apikey header alongside the user JWT.
          // The anon key is intentionally public — RLS protects all tables.
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: req.question, projectId: req.projectId ?? null, jurisdiction: req.jurisdiction ?? null }),
        signal: controller.signal,
      });
    } catch (e) {
      throw mapConstructionAnswerThrow(e, timedOut);
    }

    // Parse the JSON body up front (success AND error bodies are JSON). A
    // missing or non-JSON body leaves `body` null. The read shares the timeout:
    // a stalled body is a stalled answer.
    try {
      body = await response.json();
      bodyParsed = true;
    } catch (e) {
      if (timedOut) throw mapConstructionAnswerThrow(e, true);
      bodyParsed = false;
    }
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw mapConstructionAnswerFailure(response.status, body);

  if (!bodyParsed || !body || typeof body !== 'object') {
    // Non-JSON body on a 2xx (e.g. an HTML page from a misconfigured gateway).
    throw new ConstructionAnswerError('server_error', CONSTRUCTION_ANSWER_COPY.server_error);
  }

  // Trust the edge function's shape; the caller receives a typed result.
  return body as ConstructionAnswerResponse;
}
