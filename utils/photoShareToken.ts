// photoShareToken.ts
//
// Encode/decode a minimal photo-timeline payload into a URL-safe base64
// token. Mirrors utils/scheduleOps.ts (encodeShareToken / decodeShareToken)
// so the share UX is identical: one tap → /shared-photos?t=<token>.
//
// Trade-off: we encode photo metadata in the URL itself so the page works
// with no backend, no auth, no Supabase round-trip. That means URLs can
// get long (each photo adds ~150-200 base64 chars). We cap at 30 photos
// — enough for a project monthly recap, short enough to fit in iMessage
// previews and most email clients.
//
// We trust that photo.uri is already a CDN URL (Supabase storage public
// URL) by the time a user hits "Share timeline." Local file://uris would
// not render in a recipient's browser anyway, so we filter them out at
// payload-build time and surface a friendly count in the UI.

import type { ProjectPhoto } from '@/types';

/** v1 payload. Field names are intentionally short to keep tokens small. */
export interface PhotoSharePayload {
  v: 1;
  /** Project label shown in the share header. */
  n: string;
  /** Optional GC / company name for the footer. */
  gc?: string;
  photos: {
    /** Photo id — used only as React key, never displayed. */
    id: string;
    /** Image URL (must be public / CDN-served). */
    u: string;
    /** ISO timestamp the photo was taken. */
    ts: string;
    /** Free-text caption / location label. */
    c?: string;
    /** Optional tag (e.g. "Framing", "Pre-pour"). */
    t?: string;
    /** Optional linked task name. */
    tn?: string;
    /** Optional GPS-derived address. */
    loc?: string;
  }[];
}

/** Hard cap on photos in a single share link. Above this, callers should
 *  point recipients to the full client portal instead. */
export const PHOTO_SHARE_MAX = 30;

export function buildPhotoSharePayload(
  projectName: string,
  photos: ProjectPhoto[],
  opts: { gcName?: string } = {},
): { payload: PhotoSharePayload; droppedLocal: number; droppedExcess: number } {
  // Drop local-only URIs — they won't render in a browser. Sort newest
  // first so the cap keeps the most recent slice.
  const remoteOnly = photos.filter(p => /^https?:\/\//i.test(p.uri ?? ''));
  const droppedLocal = photos.length - remoteOnly.length;
  const sorted = [...remoteOnly].sort((a, b) =>
    (b.timestamp ?? '').localeCompare(a.timestamp ?? ''),
  );
  const capped = sorted.slice(0, PHOTO_SHARE_MAX);
  const droppedExcess = sorted.length - capped.length;

  const payload: PhotoSharePayload = {
    v: 1,
    n: projectName,
    gc: opts.gcName,
    photos: capped.map(p => ({
      id: p.id,
      u: p.uri,
      ts: p.timestamp,
      c: p.location,
      t: p.tag,
      tn: p.linkedTaskName,
      loc: p.locationLabel,
    })),
  };
  return { payload, droppedLocal, droppedExcess };
}

export function encodePhotoShareToken(payload: PhotoSharePayload): string {
  const json = JSON.stringify(payload);
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json) : null;
  const ascii = bytes
    ? Array.from(bytes).map(b => String.fromCharCode(b)).join('')
    : json;
  const b64 = typeof btoa === 'function'
    ? btoa(ascii)
    : Buffer.from(json, 'utf-8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodePhotoShareToken(token: string): PhotoSharePayload | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const ascii = typeof atob === 'function'
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, 'base64').toString('binary');
    const bytes = Uint8Array.from(ascii, c => c.charCodeAt(0));
    const json = typeof TextDecoder !== 'undefined'
      ? new TextDecoder().decode(bytes)
      : ascii;
    const parsed = JSON.parse(json) as PhotoSharePayload;
    if (parsed.v !== 1 || !Array.isArray(parsed.photos)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Group photos by yyyy-mm-dd for the timeline view. Newest day first. */
export function groupPhotosByDay<T extends { ts: string }>(
  photos: T[],
): { dayISO: string; items: T[] }[] {
  const byDay = new Map<string, T[]>();
  for (const p of photos) {
    const day = (p.ts ?? '').slice(0, 10) || 'unknown';
    const arr = byDay.get(day) ?? [];
    arr.push(p);
    byDay.set(day, arr);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dayISO, items]) => ({ dayISO, items }));
}
