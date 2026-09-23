// photoShareToken.ts
//
// Encode/decode a minimal photo-timeline payload into a URL-safe base64
// token. Mirrors utils/scheduleOps.ts (encodeShareToken / decodeShareToken)
// so the share UX is identical: one tap → /shared-photos?t=<token>.
//
// Trade-off: the photo metadata travels in the URL itself, so the link needs
// no server-side share record. We cap at 30 photos — enough for a project
// monthly recap, short enough to fit in iMessage previews and most email
// clients.
//
// v2 (wave 5, #62 / #164). v1 embedded each photo's render-time `uri`. On the
// iPhone that took them that uri is the local file:// path FOREVER (the
// gallery prefers the device copy), so every iPhone photo was dropped as "not
// yet synced" — permanently. Everywhere else it was a signed URL that expired
// 24 h after the link was built, so the homeowner's page went blank the next
// day. And recalled / draft photos went out regardless of portal state.
//
// So a v2 link carries no URLs at all: the project id plus photo ids, the
// capture time, and the LOCAL calendar day the photo was taken (computed on
// the GC's phone, which is on the job site's clock). /shared-photos asks the
// public shared-photos-sign edge function for fresh 1 h signed URLs on every
// load; the function re-checks that each id belongs to that project, has a
// storage path, and is not drafted / recalled. The link therefore never dies,
// and recalling a photo from the portal pulls it from every link already sent.
// v1 tokens still decode and render (their dead tiles are hidden).
//
// The trade: the photo ids ARE the capability — anyone holding the link can
// keep fetching those photos until the GC recalls or deletes them. That is
// what a shared link is; it is no wider than v1, whose signed URLs were the
// same bearer token with a 24 h fuse.

import type { ProjectPhoto } from '@/types';
import { calendarDayOf } from '@/utils/calendarDate';

/** One photo in a v1 link (URL embedded; legacy, still rendered). */
export interface PhotoShareV1Photo {
  /** Photo id — used only as React key, never displayed. */
  id: string;
  /** Image URL (a signed URL that expired 24 h after the link was built). */
  u: string;
  /** ISO timestamp the photo was taken. */
  ts: string;
  /** Local calendar day it was taken (absent on links built before wave 5). */
  d?: string;
  /** Free-text caption / location label. */
  c?: string;
  /** Optional tag (e.g. "Framing", "Pre-pour"). */
  t?: string;
  /** Optional linked task name. */
  tn?: string;
  /** Optional GPS-derived address. */
  loc?: string;
}

/** v1 payload. Field names are intentionally short to keep tokens small. */
export interface PhotoSharePayloadV1 {
  v: 1;
  /** Project label shown in the share header. */
  n: string;
  /** Optional GC / company name for the footer. */
  gc?: string;
  photos: PhotoShareV1Photo[];
}

/** One photo in a v2 link: ids and metadata only — the image is signed by the
 *  server on each view (CONTRACT 11). */
export type PhotoShareV2Photo = Omit<PhotoShareV1Photo, 'u'>;

export interface PhotoSharePayloadV2 {
  v: 2;
  n: string;
  gc?: string;
  /** Project id — the scope shared-photos-sign checks every photo id against. */
  pid: string;
  photos: PhotoShareV2Photo[];
}

export type PhotoSharePayload = PhotoSharePayloadV1 | PhotoSharePayloadV2;

/** Hard cap on photos in a single share link. Above this, callers should
 *  point recipients to the full client portal instead. */
export const PHOTO_SHARE_MAX = 30;

/** True when the photo may go to a client: no portal lifecycle yet (a plain
 *  job photo), or one that is currently SENT. Draft and recalled photos are
 *  the GC's own decision not to show the client — a share link respects it. */
export function isPhotoShareable(p: Pick<ProjectPhoto, 'portalState'>): boolean {
  return !p.portalState || p.portalState.status === 'sent';
}

export function buildPhotoSharePayload(
  projectName: string,
  photos: ProjectPhoto[],
  opts: { gcName?: string; projectId?: string } = {},
): {
  payload: PhotoSharePayloadV2;
  /** Photos with no storage copy yet — really not synced. */
  droppedLocal: number;
  droppedExcess: number;
  /** Photos left out because they are drafted / recalled in the client portal. */
  droppedWithdrawn: number;
} {
  const pid = opts.projectId ?? photos[0]?.projectId ?? '';
  const inProject = photos.filter(p => !pid || p.projectId === pid);
  // Chosen by STORAGE PATH, not by the uri's scheme: the device that took a
  // photo keeps a file:// uri for good, yet its bytes are in the bucket.
  const shareable = inProject.filter(isPhotoShareable);
  const droppedWithdrawn = inProject.length - shareable.length;
  const stored = shareable.filter(p => !!p.storagePath);
  const droppedLocal = shareable.length - stored.length;
  // Newest first so the cap keeps the most recent slice.
  const sorted = [...stored].sort((a, b) =>
    (b.timestamp ?? '').localeCompare(a.timestamp ?? ''),
  );
  const capped = sorted.slice(0, PHOTO_SHARE_MAX);
  const droppedExcess = sorted.length - capped.length;

  const payload: PhotoSharePayloadV2 = {
    v: 2,
    n: projectName,
    gc: opts.gcName,
    pid,
    photos: capped.map(p => ({
      id: p.id,
      ts: p.timestamp,
      // The local day on the GC's phone (#164): the viewer may be in another
      // time zone, and the UTC date put evening photos under tomorrow.
      d: calendarDayOf(p.timestamp) ?? undefined,
      c: p.location,
      t: p.tag,
      tn: p.linkedTaskName,
      loc: p.locationLabel,
    })),
  };
  return { payload, droppedLocal, droppedExcess, droppedWithdrawn };
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
    if (!Array.isArray(parsed?.photos)) return null;
    if (parsed.v === 1) return parsed;
    if (parsed.v === 2 && typeof parsed.pid === 'string' && parsed.pid) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Group photos by LOCAL calendar day for the timeline view. Newest day first.
 *
 * Keys on the day the link carries (`d`, computed on the GC's phone) and falls
 * back to the viewer's local day of the timestamp. It used to slice the ISO
 * instant — the UTC date — so a 7:30 pm Denver photo (01:30Z) landed under
 * the NEXT day (#164). The in-app "By date" grid shares this helper.
 */
export function groupPhotosByDay<T extends { ts: string; d?: string }>(
  photos: T[],
): { dayISO: string; items: T[] }[] {
  const byDay = new Map<string, T[]>();
  for (const p of photos) {
    const day = p.d ?? calendarDayOf(p.ts) ?? 'unknown';
    const arr = byDay.get(day) ?? [];
    arr.push(p);
    byDay.set(day, arr);
  }
  return Array.from(byDay.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([dayISO, items]) => ({ dayISO, items }));
}

/** The shared-photos-sign response for one photo (CONTRACT 11). */
export interface SignedSharePhoto { id: string; url: string; ts: string | null; d: string | null; tag: string | null }

/**
 * Parse the shared-photos-sign body, keeping only well-formed https entries
 * for ids the link actually asked for — a response can never add a photo the
 * GC didn't share.
 */
export function readSignedSharePhotos(body: unknown, askedIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const asked = new Set(askedIds);
  const list = (body as { photos?: unknown } | null)?.photos;
  if (!Array.isArray(list)) return out;
  for (const raw of list) {
    const p = raw as Partial<SignedSharePhoto> | null;
    if (!p || typeof p.id !== 'string' || typeof p.url !== 'string') continue;
    if (!asked.has(p.id) || !/^https:\/\//i.test(p.url)) continue;
    out.set(p.id, p.url);
  }
  return out;
}
