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

function tryParseJSON(str: string): any {
  if (!str || typeof str !== 'string') return null;
  const trimmed = str.trim();
  try { return JSON.parse(trimmed); } catch {}
  let cleaned = trimmed;
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  try { return JSON.parse(cleaned); } catch {}
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

export async function mageAI(params: MageAIParams): Promise<MageAIResult> {
  const { prompt, schema, tier = "fast", maxTokens = 1000, cacheKey, cacheHours = 2 } = params;
  if (cacheKey) { const c = await getCache(cacheKey); if (c) return c; }
  try {
    const r = await fetch(AI_URL, {
      method: "POST",
      headers: { "Authorization": "Bearer " + AI_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, schema: schema || undefined, tier, maxTokens }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.log('[mageAI] HTTP error', r.status, errText.substring(0, 300));
      return { success: false, data: null, error: "AI unavailable (" + r.status + ")" };
    }
    const responseText = await r.text();
    console.log('[mageAI] Raw response (first 500):', responseText.substring(0, 500));
    let j: any;
    try { j = JSON.parse(responseText); } catch {
      console.log('[mageAI] Response is not JSON, treating as raw text');
      const parsed = tryParseJSON(responseText);
      if (parsed && typeof parsed === 'object') {
        return { success: true, data: parsed, raw: responseText, cached: false };
      }
      return { success: true, data: responseText, raw: responseText, cached: false };
    }
    console.log('[mageAI] Response keys:', Object.keys(j));
    console.log('[mageAI] j.success:', j.success, 'j.data type:', typeof j.data, 'j.raw type:', typeof j.raw);
    if (j.data != null) console.log('[mageAI] j.data preview:', JSON.stringify(j.data).substring(0, 300));
    if (j.raw != null) console.log('[mageAI] j.raw preview:', String(j.raw).substring(0, 300));
    if (!j.success) return { success: false, data: null, error: j.error || "AI failed" };

    let data = j.data;
    const raw = j.raw || j.text || j.content || j.message || j.response;

    if (data == null && typeof raw === 'string') {
      console.log('[mageAI] data is null, parsing raw...');
      const parsed = tryParseJSON(raw);
      if (parsed) data = parsed;
      else data = raw;
    }

    if (typeof data === 'string') {
      const parsed = tryParseJSON(data);
      if (parsed && typeof parsed === 'object') {
        console.log('[mageAI] Parsed string data into object');
        data = parsed;
      }
    }

    const result: MageAIResult = { success: true, data, raw: typeof raw === 'string' ? raw : JSON.stringify(j), cached: false };
    if (cacheKey) await setCache(cacheKey, result, cacheHours);
    return result;
  } catch (err) {
    console.log('[mageAI] Fetch error:', err);
    return { success: false, data: null, error: "Could not reach AI. Check connection." };
  }
}

export async function mageAIFast(prompt: string, schema?: any, cacheKey?: string) {
  return mageAI({ prompt, schema, tier: "fast", cacheKey });
}

export async function mageAISmart(prompt: string, schema?: any, cacheKey?: string) {
  return mageAI({ prompt, schema, tier: "smart", maxTokens: 2000, cacheKey });
}
