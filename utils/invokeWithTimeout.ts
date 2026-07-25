/**
 * invokeWithTimeout.ts — wraps supabase.functions.invoke with an AbortSignal
 * timeout so a hung edge function never produces an infinite spinner.
 *
 * Why this exists: utils/mageAI.ts protects its own fetch calls with an
 * AbortController (mageAI.ts:78-81), but every direct supabase.functions.invoke()
 * call bypasses that protection. Vision invokes (analyze-photos, analyze-drawings)
 * are the highest-risk: large base64 payloads on jobsite LTE + Gemini stall =
 * spinner forever, with no user recovery path except force-quitting the app.
 *
 * The supabase-js FunctionInvokeOptions interface declares `signal?: AbortSignal`
 * (verified in node_modules/@supabase/functions-js/dist/module/types.d.ts:115).
 * We create our own AbortController, set a timeout, pass the signal, and map
 * the aborted result to a user-friendly "Took too long" message. Note the
 * mapping happens on the RESOLVE path: functions-js catches the aborted
 * fetch internally (FunctionsFetchError) and resolves { data, error } —
 * it does not throw — so we check `controller.signal.aborted` on the result.
 *
 * Default timeout: 90s for vision calls. Non-vision callers may pass a lower
 * value. Set to 0 or Infinity to disable (not recommended in production).
 *
 * Usage:
 *   const { data, error } = await invokeWithTimeout('analyze-photos', { body: payload });
 *   // on timeout, error.message === 'Took too long — try again.'
 */

import { supabase } from '@/lib/supabase';

const DEFAULT_VISION_TIMEOUT_MS = 90_000; // 90 s — generous for large photo batches

export type InvokeResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

/**
 * Drop-in replacement for supabase.functions.invoke with a configurable
 * AbortSignal timeout. Maps AbortError to a retryable user-facing message.
 *
 * @param fnName   Edge function name (e.g. 'analyze-photos').
 * @param options  Same options as FunctionInvokeOptions, minus `signal` (we
 *                 manage it internally). Pass `timeoutMs` to override the default.
 */
export async function invokeWithTimeout<T = unknown>(
  fnName: string,
  options: {
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<InvokeResult<T>> {
  const { timeoutMs = DEFAULT_VISION_TIMEOUT_MS, body, headers } = options;

  const controller = new AbortController();
  const timer =
    timeoutMs > 0 && Number.isFinite(timeoutMs)
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;

  try {
    const result = await supabase.functions.invoke<T>(fnName, {
      body,
      headers,
      signal: controller.signal,
    });
    // supabase.functions.invoke NEVER throws on an aborted fetch: the
    // installed @supabase/functions-js wraps the fetch rejection in
    // FunctionsFetchError ('Failed to send a request to the Edge Function')
    // and its outer catch RESOLVES with { data: null, error } (verified in
    // node_modules/@supabase/functions-js/dist/main/FunctionsClient.js). So
    // the timeout must be detected HERE: an error while our signal is
    // aborted means our timer fired — map it to the retry-friendly message
    // instead of a wording that reads like a connectivity bug.
    if (result.error && controller.signal.aborted) {
      return { data: null, error: { message: 'Took too long — try again.' } };
    }
    return result;
  } catch (e: unknown) {
    // Belt-and-suspenders: not reachable through the current functions-js
    // resolve-with-error contract, but kept in case a future client version
    // starts throwing (e.g. a raw AbortError from a changed wrapper).
    const isAbort =
      controller.signal.aborted ||
      (e instanceof Error && e.name === 'AbortError') ||
      (typeof e === 'object' && e !== null && (e as Record<string, unknown>)['name'] === 'AbortError');
    if (isAbort) {
      return {
        data: null,
        error: { message: 'Took too long — try again.' },
      };
    }
    // Re-surface unexpected errors in the same shape as the supabase client.
    const msg = e instanceof Error ? e.message : String(e);
    return { data: null, error: { message: msg } };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
