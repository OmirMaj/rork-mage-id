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
}

interface MageAIResult {
  success: boolean;
  data: any;
  raw?: string;
  error?: string;
  cached?: boolean;
}

async function getCache(key: string): Promise<MageAIResult | null> {
  try {
    const c = await AsyncStorage.getItem(CACHE_PREFIX + key);
    if (!c) return null;
    const { result, expiresAt } = JSON.parse(c);
    if (Date.now() > expiresAt) { await AsyncStorage.removeItem(CACHE_PREFIX + key); return null; }
    return { ...result, cached: true };
  } catch { return null; }
}

async function setCache(key: string, result: MageAIResult, hours: number) {
  try {
    await AsyncStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ result, expiresAt: Date.now() + hours * 3600000 }));
  } catch {}
}

export async function mageAI(params: MageAIParams): Promise<MageAIResult> {
  const { prompt, schema, schemaHint, tier = "fast", maxTokens = 1000, cacheKey, cacheHours = 2 } = params;
  if (cacheKey) { const c = await getCache(cacheKey); if (c) return c; }
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
    });
    if (!r.ok) return { success: false, data: null, error: "AI unavailable (" + r.status + ")" };
    const j = await r.json();
    if (!j.success) return { success: false, data: null, error: j.error || "AI failed" };

    // Validate and coerce with Zod client-side — schema .default() values fill any missing fields
    if (schema && j.data) {
      try {
        const parsed = schema.parse(j.data);
        const result: MageAIResult = { success: true, data: parsed, raw: j.raw, cached: false };
        if (cacheKey) await setCache(cacheKey, result, cacheHours);
        return result;
      } catch (zodErr) {
        console.warn("[mageAI] Zod validation warning, using raw data:", zodErr);
      }
    }

    const result: MageAIResult = { success: true, data: j.data, raw: j.raw, cached: false };
    if (cacheKey) await setCache(cacheKey, result, cacheHours);
    return result;
  } catch (err) {
    return { success: false, data: null, error: "Could not reach AI. Check connection." };
  }
}

export async function mageAIFast(prompt: string, schema?: any, cacheKey?: string) {
  return mageAI({ prompt, schema, tier: "fast", cacheKey });
}

export async function mageAISmart(prompt: string, schema?: any, cacheKey?: string) {
  return mageAI({ prompt, schema, tier: "smart", maxTokens: 2000, cacheKey });
}
