// stableHash — tiny djb2 hash → base36 string, for salting cache keys with
// CONTENT (not just counts/lengths). Mirrors the idiom already proven in
// utils/profitLeak/leakPrompt.ts (hashLeakText) and utils/delayScan/
// delayPrompt.ts (hashDelayText): grounded AI prompts must not replay a
// cached result generated from DIFFERENT grounding facts, so the facts'
// content is hashed into the key. Pure, deterministic, dependency-free.
export function stableHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
