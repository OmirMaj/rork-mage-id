/**
 * Client caller for the `construction-answer` Supabase edge function.
 *
 * ERROR STRATEGY — throw typed Error (not a result union):
 *
 *   This module's public surface is `Promise<ConstructionAnswerResult>`, which
 *   is the clean success type. Errors are surfaced as thrown Error objects with
 *   a `.code` discriminant, matching the pattern used throughout the codebase
 *   for simple async utilities (e.g. `projectMemory`, `offlineQueue`). The
 *   heavier result-union pattern in `mageAI` is appropriate there because that
 *   function must convey 7+ error kinds + caching + partial-success all in one
 *   object; here we only need four cases:
 *
 *     • `.code === 'needs_business'` → 403 + {code:'tier_required'} from edge fn; show paywall nudge.
 *     • `.code === 'limit_reached'`  → 429 + {code:'monthly_cap'};    show "monthly limit reached".
 *     • `.code === 'unauthenticated'` → 401 / no session; prompt sign-in.
 *     • `.code === 'unavailable'`    → 404 / 503 / network / non-JSON; show retry.
 *
 *   The UI (Task 5) wraps the call in try/catch and branches on `err.code`.
 *
 * URL + AUTH — matches mageAI.ts exactly:
 *
 *   URL     : `${SUPABASE_URL}/functions/v1/<fn-name>`  (same base as AI_URL in mageAI)
 *   Headers : Authorization: Bearer <user JWT>
 *             apikey: <SUPABASE_ANON_KEY>   (Supabase gateway requires this even with user JWT)
 *             Content-Type: application/json
 *
 *   Both constants come from `lib/supabase.ts` which carries the hardcoded
 *   production fallback, so calls work even when EXPO_PUBLIC_* env vars are absent.
 */

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import type { ConstructionAnswerRequest, ConstructionAnswerResult } from '@/types/constructionAnswer';

const CONSTRUCTION_ANSWER_URL = `${SUPABASE_URL}/functions/v1/construction-answer`;

/**
 * A typed Error subclass so callers can `instanceof ConstructionAnswerError`
 * or just check `(err as ConstructionAnswerError).code`.
 */
export class ConstructionAnswerError extends Error {
  code: 'needs_business' | 'limit_reached' | 'unauthenticated' | 'unavailable';

  constructor(
    code: 'needs_business' | 'limit_reached' | 'unauthenticated' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'ConstructionAnswerError';
    this.code = code;
  }
}

/**
 * Ask the Construction Answers engine a question.
 *
 * @param req - The question and optional project context.
 * @returns A `ConstructionAnswerResult` on success.
 * @throws `ConstructionAnswerError` with `.code`:
 *   - `'needs_business'`   → user is not on Business tier (HTTP 403 + {code:'tier_required'})
 *   - `'limit_reached'`    → monthly cap hit (HTTP 429 + {code:'monthly_cap'})
 *   - `'unauthenticated'`  → no active Supabase session (HTTP 401)
 *   - `'unavailable'`      → edge function not deployed, server error, or network failure
 */
export async function askConstruction(
  req: ConstructionAnswerRequest,
): Promise<ConstructionAnswerResult> {
  // Require an authenticated session — same guard as mageAI.ts.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userJWT = session?.access_token;

  if (!userJWT) {
    throw new ConstructionAnswerError(
      'unauthenticated',
      'Sign in to use Construction Answers.',
    );
  }

  let response: Response;
  try {
    response = await fetch(CONSTRUCTION_ANSWER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userJWT}`,
        // Supabase Edge gateway requires the apikey header alongside the user JWT.
        // The anon key is intentionally public — RLS protects all tables.
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question: req.question, projectId: req.projectId ?? null }),
    });
  } catch {
    // Network failure (offline, DNS, etc.)
    throw new ConstructionAnswerError(
      'unavailable',
      "Construction Answers isn't available yet.",
    );
  }

  // Parse the JSON body up front (success AND error bodies are JSON). A missing
  // or non-JSON body leaves `body` null; error mapping falls back to HTTP status.
  let body: unknown = null;
  let bodyParsed = false;
  try {
    body = await response.json();
    bodyParsed = true;
  } catch {
    bodyParsed = false;
  }

  const errCode =
    body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
      ? (body as { code: string }).code
      : undefined;
  const errMessage =
    body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : undefined;

  if (!response.ok) {
    // Insufficient tier → 403 + {code:'tier_required'}. (Keep 402 harmlessly
    // mapped too, though requireTier never returns it.)
    if (errCode === 'tier_required' || response.status === 403 || response.status === 402) {
      throw new ConstructionAnswerError(
        'needs_business',
        'Construction Answers is on the Business plan.',
      );
    }
    // Over monthly cap → 429 + {code:'monthly_cap'}. Surface the server message.
    if (errCode === 'monthly_cap' || response.status === 429) {
      throw new ConstructionAnswerError(
        'limit_reached',
        errMessage || "You've reached your monthly Construction Answers limit.",
      );
    }
    // 401 / no session → unauthenticated (expired session)
    if (response.status === 401) {
      throw new ConstructionAnswerError(
        'unauthenticated',
        'Session expired. Sign in again.',
      );
    }
    // 404, 503, or any other non-200 → unavailable
    throw new ConstructionAnswerError(
      'unavailable',
      "Construction Answers isn't available yet.",
    );
  }

  if (!bodyParsed) {
    // Non-JSON body on a 2xx (e.g. HTML error page from a misconfigured gateway)
    throw new ConstructionAnswerError(
      'unavailable',
      "Construction Answers isn't available yet.",
    );
  }

  // Trust the edge function's shape; the caller (UI, Task 5) receives a typed result.
  return body as ConstructionAnswerResult;
}
