import AsyncStorage from '@react-native-async-storage/async-storage';

const AI_URL = "https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/ai";
const AI_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado";
const CACHE_PREFIX = "mage_ai_cache_";

interface MageAIParams {
  prompt: string;
  schema?: any;
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
  const { prompt, schema, tier = "fast", maxTokens = 1000, cacheKey, cacheHours = 2 } = params;
  if (cacheKey) { const c = await getCache(cacheKey); if (c) return c; }
  try {
    const r = await fetch(AI_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + AI_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, schema, tier, maxTokens }),
    });
    if (!r.ok) return { success: false, data: null, error: "AI unavailable (" + r.status + ")" };
    const j = await r.json();
    if (!j.success) return { success: false, data: null, error: j.error || "AI failed" };
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
