import AsyncStorage from '@react-native-async-storage/async-storage';

const AI_URL = "https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/ai";
const AI_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado";
const CACHE_PREFIX = "mage_ai_cache_";

interface MageAIParams {
  prompt: string;
  schema?: any;           // Zod schema — used client-side for validation only, NOT sent to edge function
  schemaHint?: object;    // Plain JSON example — sent to edge function so Gemini knows the shape
  tier?: "fast" | "smart";
  maxTokens?: number;
  cacheKey?: string;
  cacheHours?: number;
  /** Abort the fetch after this many ms. Default 30s. */
  timeoutMs?: number;
}

interface MageAIResult {
  success: boolean;
  data: any;
  raw?: string;
  error?: string;
  cached?: boolean;
  /** Why the call failed, in a way the UI can branch on. */
  errorKind?: 'timeout' | 'network' | 'http' | 'model' | 'validation' | 'unknown';
  /** Convenience for UIs that want to show a "cached" pill. */
  fromCache?: boolean;
}

async function getCache(key: string): Promise<MageAIResult | null> {
  try {
    const c = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!c) return null;
    const { result, expiresAt } = JSON.parse(c);
    if (Date.now() > expiresAt) { await AsyncStorage.removeItem(CACHE_PREFIX + key); return null; }
    // Surface both flags — `cached` is the legacy name some UIs read, `fromCache`
    // is the newer name. Both mean the same thing: this did not hit the network.
    return { ...result, cached: true, fromCache: true };
  } catch { return null; }
}

async function setCache(key: string, result: MageAIResult, hours: number) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ result, expiresAt: Date.now() + hours * 3600000 }));
  } catch {}
}

export async function mageAI(params: MageAIParams): Promise<MageAIResult> {
  const { prompt, schema, schemaHint, tier = "fast", maxTokens = 1000, cacheKey, cacheHours = 2, timeoutMs = 30000 } = params;
  if (cacheKey) { const c = await getCache(cacheKey); if (c) return c; }

  // AbortController-based timeout. Without this, a hung edge function (or a
  // laptop that went to sleep mid-request) leaves the UI spinner going forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Never send Zod schema objects to the edge function — JSON.stringify(zodSchema)
    // produces Zod internal structure, not a usable JSON example for the model.
    // Use schemaHint (a plain JS object) for the model, and schema (Zod) for client-side validation.
    const payload: Record<string, unknown> = { prompt, tier, maxTokens };
    if (schemaHint) {
      payload.schemaHint = schemaHint;
      payload.jsonMode = true;
    } else if (schema) {
      // No schemaHint provided — still enable JSON mode so Gemini returns parseable JSON
      payload.jsonMode = true;
    }

    const r = await fetch(AI_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + AI_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!r.ok) {
      clearTimeout(timer);
      return {
        success: false, data: null,
        error: `AI server returned ${r.status}. Try again in a moment.`,
        errorKind: 'http',
      };
    }
    const j = await r.json();
    if (!j.success) {
      clearTimeout(timer);
      // Special case: MAX_TOKENS means the model produced content but it was
      // truncated mid-JSON. If we have a schema, return a defaulted shape so
      // the UI can still render something instead of crashing. The caller can
      // check `truncated` to show a "try a smaller input" hint.
      const errMsg = j.error || "AI failed";
      if (schema && /MAX_TOKENS/i.test(errMsg)) {
        const fallback = schema.safeParse({});
        if (fallback.success) {
          console.warn("[mageAI] Response truncated (MAX_TOKENS), returning defaulted shape");
          return { success: true, data: fallback.data, error: errMsg, cached: false, fromCache: false };
        }
      }
      return { success: false, data: null, error: errMsg, errorKind: 'model' };
    }

    // Validate and coerce with Zod client-side — schema .default() values fill any missing fields.
    // If full parse fails, fall back to safeParse on an empty object to get a defaulted shape —
    // this guarantees UI consumers always receive the expected structure and never crash on
    // undefined array/object fields.
    if (schema && j.data !== undefined && j.data !== null) {
      // Sometimes Gemini wraps the response in an array instead of a root object.
      // If the schema expects an object and we got an array, try:
      //   1) the first element directly
      //   2) a shallow merge of all elements (later keys win)
      let candidate = j.data;
      if (Array.isArray(candidate) && candidate.length > 0 && candidate.every(x => x && typeof x === 'object')) {
        const first = schema.safeParse(candidate[0]);
        if (first.success) {
          candidate = candidate[0];
        } else if (candidate.length > 1) {
          const merged = Object.assign({}, ...candidate);
          const m = schema.safeParse(merged);
          if (m.success) candidate = merged;
        }
      }
      const primary = schema.safeParse(candidate);
      if (primary.success) {
        clearTimeout(timer);
        const result: MageAIResult = { success: true, data: primary.data, raw: j.raw, cached: false, fromCache: false };
        if (cacheKey) await setCache(cacheKey, result, cacheHours);
        return result;
      }
      console.warn("[mageAI] Zod validation failed, merging with defaults:", primary.error?.issues?.slice(0, 3));
      // Build a safe shape: start from schema defaults, overlay whatever keys parsed
      const fallback = schema.safeParse({});
      const safeShape = fallback.success ? fallback.data : {};
      const merged = typeof j.data === 'object' && j.data !== null
        ? { ...safeShape, ...j.data }
        : safeShape;
      // One more pass through safeParse so nested defaults apply to the merged shape too
      const finalParse = schema.safeParse(merged);
      const finalData = finalParse.success ? finalParse.data : safeShape;
      clearTimeout(timer);
      // Flag `errorKind: 'validation'` so the UI can show a "partial result" banner —
      // the data is still usable (defaults filled the gaps) but the caller should
      // know the model's response didn't cleanly match the schema.
      const result: MageAIResult = {
        success: true,
        data: finalData,
        raw: j.raw,
        cached: false,
        fromCache: false,
        errorKind: 'validation',
        error: 'AI response partially matched schema — showing defaulted fields.',
      };
      if (cacheKey) await setCache(cacheKey, result, cacheHours);
      return result;
    }

    // No schema or no data — return as-is
    clearTimeout(timer);
    const result: MageAIResult = { success: true, data: j.data, raw: j.raw, cached: false, fromCache: false };
    if (cacheKey) await setCache(cacheKey, result, cacheHours);
    return result;
  } catch (err) {
    clearTimeout(timer);
    // If AbortController fired, `err.name === 'AbortError'` and
    // `controller.signal.aborted === true`. Distinguish that from generic
    // network failure so the UI can show a retry-with-smaller-input hint
    // for timeouts vs. a check-connection hint for offline.
    if (controller.signal.aborted) {
      return {
        success: false,
        data: null,
        error: `AI request timed out after ${Math.round(timeoutMs / 1000)}s. Try a smaller selection or retry.`,
        errorKind: 'timeout',
      };
    }
    return {
      success: false,
      data: null,
      error: "Could not reach AI. Check connection.",
      errorKind: 'network',
    };
  }
}

export async function mageAIFast(prompt: string, schema?: any, cacheKey?: string) {
  return mageAI({ prompt, schema, tier: "fast", cacheKey });
}

export async function mageAISmart(prompt: string, schema?: any, cacheKey?: string) {
  return mageAI({ prompt, schema, tier: "smart", maxTokens: 2000, cacheKey });
}
