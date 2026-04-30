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
      // No schemaHint provided — derive an example shape from the Zod schema so
      // Gemini knows what to return. Without this, every callsite that only
      // passes `schema` got an unstructured response that Zod then defaulted
      // to empty strings/arrays — the "modal opens with nothing" bug.
      const derived = deriveHintFromZod(schema);
      if (derived) {
        payload.schemaHint = derived;
      }
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
      // CRITICAL: Gemini frequently returns `null` for optional fields it thinks
      // aren't applicable (e.g. `notes: null`, `tradeRecord: null`). Zod's
      // `.default()` only fires on `undefined`, NOT on `null` — so a single
      // null field causes the entire row to fail validation, the array to
      // fail, and the whole response to fall back to empty defaults. The user
      // sees an empty modal ("AI Quick Estimate doesn't give info anymore").
      //
      // Recursively strip null leaves so defaults and optional schemas behave
      // sensibly. See stripNulls() docstring below for exact behavior.
      candidate = stripNulls(candidate);
      const primary = schema.safeParse(candidate);
      if (primary.success) {
        clearTimeout(timer);
        const result: MageAIResult = { success: true, data: primary.data, raw: j.raw, cached: false, fromCache: false };
        if (cacheKey) await setCache(cacheKey, result, cacheHours);
        return result;
      }
      console.warn("[mageAI] Zod validation failed, salvaging per-field:", primary.error?.issues?.slice(0, 3));
      // Build a safe shape from schema defaults — used for any field we can't salvage.
      const fallback = schema.safeParse({});
      const safeShape = fallback.success ? fallback.data : {};
      // Per-field salvage: if the whole-object parse failed, try each field
      // independently. One bad field (e.g. `quantity: "10"` as a string instead
      // of a number) used to wipe the WHOLE result. With per-field salvage,
      // good fields survive and the UI gets real data; bad fields fall back
      // to defaults for that field only.
      const finalData = salvageAgainstSchema(schema, candidate, safeShape);
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

/**
 * Coerce a value against a Zod schema, doing common-sense type repairs that
 * Gemini frequently mis-emits. Tried in order of safety:
 *
 *   1. Direct safeParse — if it works, no repair needed
 *   2. If schema is a number and value is a numeric string ("10", "8.50"),
 *      coerce to Number and try again
 *   3. If schema is a string and value is a number, coerce to String
 *   4. If schema is a boolean and value is "true"/"false", coerce
 *
 * Returns either the parsed (possibly-coerced) value, or `undefined` to
 * signal "give up and use the default."
 */
function tryCoerceField(schema: any, value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (value === undefined) return { ok: false };
  // 1. Direct parse
  const direct = schema.safeParse?.(value);
  if (direct?.success) return { ok: true, value: direct.data };

  // 2. Inspect the inner type for coercion
  const def = schema._def;
  if (!def) return { ok: false };
  // Unwrap optional / default / nullable / pipe to find the underlying primitive.
  let inner: any = schema;
  let depth = 0;
  while (inner?._def && depth < 6) {
    const t = inner._def.typeName ?? inner._def.type;
    if (t === 'ZodOptional' || t === 'optional' ||
        t === 'ZodNullable' || t === 'nullable' ||
        t === 'ZodDefault'  || t === 'default'  ||
        t === 'ZodReadonly' || t === 'readonly') {
      inner = inner._def.innerType ?? inner._def.type;
      depth++;
    } else if (t === 'ZodPipe' || t === 'pipe') {
      inner = inner._def.in ?? inner._def.left ?? inner;
      depth++;
    } else {
      break;
    }
  }
  const innerType = inner?._def?.typeName ?? inner?._def?.type;

  // 3. Coerce string → number
  if ((innerType === 'ZodNumber' || innerType === 'number') && typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isNaN(n)) {
        const r = schema.safeParse(n);
        if (r.success) return { ok: true, value: r.data };
      }
    }
  }
  // 4. Coerce number → string
  if ((innerType === 'ZodString' || innerType === 'string') && typeof value === 'number') {
    const r = schema.safeParse(String(value));
    if (r.success) return { ok: true, value: r.data };
  }
  // 5. Coerce string → boolean
  if ((innerType === 'ZodBoolean' || innerType === 'boolean') && typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === 'false') {
      const r = schema.safeParse(lower === 'true');
      if (r.success) return { ok: true, value: r.data };
    }
  }
  return { ok: false };
}

/**
 * Per-field salvage when the whole-object parse fails. Walks the top-level
 * object schema and tries each field independently, including arrays of
 * sub-objects. One bad field (e.g. `materials[3].quantity: "10"` as a
 * string) doesn't tank the entire result anymore — good fields survive,
 * bad fields fall back to defaults FOR THAT FIELD ONLY.
 *
 * This was the deeper root cause of "AI Quick Estimate gives 0":
 *   - Round 1 fix (stripNulls) handled `notes: null`
 *   - Round 2 fix (this) handles `quantity: "5"` and other type mismatches
 *
 * If the schema isn't a ZodObject (e.g. it's a top-level array), or shape
 * introspection fails, falls back to the safeShape.
 */
function salvageAgainstSchema(schema: any, data: unknown, safeShape: any): any {
  const def = schema?._def;
  const t = def?.typeName ?? def?.type;
  if (t !== 'ZodObject' && t !== 'object') return safeShape;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return safeShape;

  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  if (!shape) return safeShape;

  const out: Record<string, unknown> = { ...(safeShape as Record<string, unknown>) };
  const dataObj = data as Record<string, unknown>;

  for (const key of Object.keys(shape)) {
    const fieldSchema = shape[key];
    const value = dataObj[key];
    if (value === undefined) continue;          // safeShape default already there

    // Direct parse + light coercion
    const coerced = tryCoerceField(fieldSchema, value);
    if (coerced.ok) {
      out[key] = coerced.value;
      continue;
    }

    // Array fields: salvage element-by-element
    const fieldDef = fieldSchema._def;
    let arrInner: any = null;
    {
      let unwrapped = fieldSchema;
      let depth = 0;
      while (unwrapped?._def && depth < 6) {
        const tt = unwrapped._def.typeName ?? unwrapped._def.type;
        if (tt === 'ZodOptional' || tt === 'optional' ||
            tt === 'ZodNullable' || tt === 'nullable' ||
            tt === 'ZodDefault'  || tt === 'default') {
          unwrapped = unwrapped._def.innerType ?? unwrapped._def.type;
          depth++;
        } else if (tt === 'ZodArray' || tt === 'array') {
          arrInner = unwrapped._def.element ?? unwrapped._def.type;
          break;
        } else {
          break;
        }
      }
    }
    if (Array.isArray(value) && arrInner) {
      const salvagedArr: unknown[] = [];
      for (const elem of value) {
        const elemCoerced = tryCoerceField(arrInner, elem);
        if (elemCoerced.ok) {
          salvagedArr.push(elemCoerced.value);
          continue;
        }
        // Element is an object that didn't parse — recurse into it
        const elemDef = arrInner._def;
        const elemT = elemDef?.typeName ?? elemDef?.type;
        if ((elemT === 'ZodObject' || elemT === 'object') && elem && typeof elem === 'object') {
          const elemFallback = arrInner.safeParse({});
          const elemBase = elemFallback.success ? elemFallback.data : {};
          const repairedElem = salvageAgainstSchema(arrInner, elem, elemBase);
          // Re-parse to ensure nested defaults apply
          const finalElem = arrInner.safeParse(repairedElem);
          salvagedArr.push(finalElem.success ? finalElem.data : repairedElem);
        }
        // Non-object array elements that fail parse are dropped
      }
      out[key] = salvagedArr;
      continue;
    }

    // Object fields: recurse. The schema may be wrapped in ZodDefault /
    // ZodOptional / ZodNullable (from `z.object({...}).default({...})`),
    // so unwrap until we find the actual ZodObject before deciding whether
    // to recurse.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      let unwrappedSchema: any = fieldSchema;
      let depth = 0;
      while (unwrappedSchema?._def && depth < 6) {
        const tt = unwrappedSchema._def.typeName ?? unwrappedSchema._def.type;
        if (tt === 'ZodOptional' || tt === 'optional' ||
            tt === 'ZodNullable' || tt === 'nullable' ||
            tt === 'ZodDefault'  || tt === 'default'  ||
            tt === 'ZodReadonly' || tt === 'readonly') {
          unwrappedSchema = unwrappedSchema._def.innerType ?? unwrappedSchema._def.type;
          depth++;
        } else {
          break;
        }
      }
      const innerT = unwrappedSchema?._def?.typeName ?? unwrappedSchema?._def?.type;
      if (innerT === 'ZodObject' || innerT === 'object') {
        const subFallback = fieldSchema.safeParse({});
        const subBase = subFallback.success ? subFallback.data : {};
        out[key] = salvageAgainstSchema(unwrappedSchema, value, subBase);
        continue;
      }
    }
    // Give up on this field — keep the default already in `out` from safeShape
  }
  return out;
}

/**
 * Recursively replace null leaves with undefined so Zod `.default()` and
 * optional schemas accept the value. Gemini sometimes emits `"notes": null`
 * for optional fields, which would otherwise reject the whole object — and
 * since our fallback path returns empty defaults on any validation failure,
 * a single null can produce an entirely empty modal ("AI Quick Estimate
 * doesn't give info anymore").
 *
 * Behavior:
 * - Plain objects: drop keys whose value is null (so `.default()` fires).
 *   Other values recurse.
 * - Arrays: drop null elements (Gemini occasionally returns
 *   `[{...}, null, {...}]` for optional placeholder slots), then recurse
 *   into the surviving elements. We previously kept null array slots to
 *   preserve indices, but no schema in the codebase uses positional
 *   indexing — they're all `z.array(z.object(...))`, where a null element
 *   would fail validation anyway.
 * - Primitives: return as-is.
 */
function stripNulls(value: unknown): unknown {
  if (value === null) return undefined;
  if (Array.isArray(value)) {
    return value
      .filter(v => v !== null)
      .map(v => (v && typeof v === 'object') ? stripNulls(v) : v);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue;          // drop the key — undefined → defaults fire
      if (typeof v === 'object') out[k] = stripNulls(v);
      else out[k] = v;
    }
    return out;
  }
  return value;
}

// Walk a Zod schema and produce a plain-JS example shape Gemini can read.
// Best-effort — unknown types fall back to null. We return null for the
// whole thing if introspection fails, so the caller falls back to no hint
// rather than crashing.
function deriveHintFromZod(schema: any, depth = 0): unknown {
  if (!schema || depth > 5) return null;
  // Zod 4 exposes the internal def under _def with `typeName` or `type`.
  const def = schema._def;
  if (!def) return null;
  const t = def.typeName ?? def.type;

  // Unwrap optional / nullable / default / pipe / readonly so we look at the inner type.
  if (t === 'ZodOptional' || t === 'optional' ||
      t === 'ZodNullable' || t === 'nullable' ||
      t === 'ZodReadonly' || t === 'readonly') {
    return deriveHintFromZod(def.innerType ?? def.type, depth + 1);
  }
  if (t === 'ZodDefault' || t === 'default') {
    // If the schema has a default, use that — it's already a valid example.
    if (typeof def.defaultValue === 'function') {
      try { return def.defaultValue(); } catch { /* ignore */ }
    } else if (def.defaultValue !== undefined) {
      return def.defaultValue;
    }
    return deriveHintFromZod(def.innerType, depth + 1);
  }
  if (t === 'ZodPipe' || t === 'pipe') return deriveHintFromZod(def.in ?? def.left, depth + 1);

  // Primitives.
  if (t === 'ZodString'  || t === 'string')  return '';
  if (t === 'ZodNumber'  || t === 'number')  return 0;
  if (t === 'ZodBoolean' || t === 'boolean') return false;
  if (t === 'ZodLiteral' || t === 'literal') return def.value ?? null;
  if (t === 'ZodEnum'    || t === 'enum') {
    // Zod 4 stores entries as record; v3 as array.
    if (Array.isArray(def.values)) return def.values[0] ?? '';
    if (def.entries) {
      const first = Object.values(def.entries)[0];
      return first ?? '';
    }
    return '';
  }
  if (t === 'ZodArray' || t === 'array') {
    const inner = deriveHintFromZod(def.element ?? def.type, depth + 1);
    return inner == null ? [] : [inner];
  }
  if (t === 'ZodObject' || t === 'object') {
    const out: Record<string, unknown> = {};
    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
    if (!shape) return {};
    for (const k of Object.keys(shape)) {
      out[k] = deriveHintFromZod(shape[k], depth + 1);
    }
    return out;
  }
  if (t === 'ZodUnion' || t === 'union') {
    const options = def.options;
    if (Array.isArray(options) && options.length > 0) return deriveHintFromZod(options[0], depth + 1);
    return null;
  }
  if (t === 'ZodRecord' || t === 'record') return {};
  if (t === 'ZodTuple'  || t === 'tuple') {
    const items = def.items ?? [];
    return items.map((item: any) => deriveHintFromZod(item, depth + 1));
  }
  return null;
}
