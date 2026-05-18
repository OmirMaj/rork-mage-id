/**
 * Parse JSON without throwing. Returns `fallback` on null/undefined/empty
 * input or any parse error. Use for stored (AsyncStorage) or remote/URL
 * strings at screen boundaries — never let a malformed blob crash a screen.
 */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
