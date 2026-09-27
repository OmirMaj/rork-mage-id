// i18n/hash.ts — FNV-1a 32-bit over UTF-16 code units, as 8 lowercase hex.
//
// Used ONLY for stale-translation detection: each Spanish entry records the
// hash of the English it was translated from (`src`). When copy/voice edits
// the English, the hash no longer matches and validate-i18n lists the Spanish
// for re-review. Not a security hash. PURE; identical on Hermes, V8 and Deno
// (Math.imul and >>> 0 only).

export function fnv1a32(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The hash a catalog entry's `src` must carry. Plural forms hash a stable
 *  serialisation (fixed key order), so reordering object keys is not "stale". */
export function sourceHash(en: string | { zero?: string; one: string; many?: string; other: string }): string {
  if (typeof en === 'string') return fnv1a32(en);
  return fnv1a32(
    ['zero', 'one', 'many', 'other']
      .map((k) => `${k}=${(en as Record<string, string | undefined>)[k] ?? ''}`)
      .join('\u0001'),
  );
}
