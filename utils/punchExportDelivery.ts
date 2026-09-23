// utils/punchExportDelivery.ts — the platform half of the punch list export:
// photo and plan resolution, the native PDF render, the web print tab,
// downloads, the share sheet and the remembered format. Imported ONLY by
// components/punch/PunchExportSheet.tsx; the decisions it acts on live in the
// pure utils/punchExportCore.ts and utils/punchExportHtml.ts.
//
// THE RULES THIS FILE KEEPS (each is pinned by scripts/validate-punch-export.ts):
//
//   • Native photos are FULL SIZE — expo-print embeds the JPEG byte for byte
//     and there is no way to downscale on a phone here (Supabase free plan: no
//     image transformations; no image-manipulator module; can't add one over
//     OTA). So the core caps them (iOS 24 / 64 MB, Android 12 / 32 MB, open
//     items first) and this file only HEAD-checks and budgets them.
//   • A local file:// photo cannot load inside expo-print's webview (its base
//     URL is the app bundle), so a local original is inlined as base64 —
//     sequentially, within its own budget.
//   • One native render at a time. expo-print has no cancel and no WebContent
//     crash handler; a render abandoned after a timeout or a cancel has its file
//     deleted when it finally lands. Each run writes into its own folder, and
//     only folders over an hour old are pruned, so a share still reading the
//     last file is never deleted from under it.
//   • Web: window.open runs synchronously inside the press (popup blockers),
//     photos become 640px centred-square JPEG data URLs (the markup frame), and
//     no script is ever written into the print tab.
//   • Signed-URL tokens never reach a log or the UI (scrubMessage).

import { Image as RNImage, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CompanyBranding } from '@/types';
import { SUPABASE_URL } from '@/lib/supabase';
import { resolvePhotoUrls } from '@/utils/storage';
import { resolvePlanSheetUrls } from '@/utils/planSheetUrls';
import { deliverTextFile, hasFileSystem, readAsBase64 } from '@/utils/platformFile';
import { csvHandoverOutcome } from '@/utils/wipExport';
import { isDeviceLocalUri, photoExtFromUri } from '@/utils/photoUploadCore';
import {
  parseExportPref,
  serializeExportPref,
  webPrintWaitMs,
  PUNCH_EXPORT_CHECK_TIMEOUT_MS,
  PUNCH_EXPORT_DIR_MAX_AGE_MS,
  PUNCH_EXPORT_FETCH_TIMEOUT_MS,
  PUNCH_EXPORT_LOGO_MAX_BYTES,
  PUNCH_EXPORT_NATIVE_BUSY_CEILING_MS,
  PUNCH_EXPORT_NATIVE_CHECK_CONCURRENCY,
  PUNCH_EXPORT_NATIVE_INLINE_BUDGET_BYTES,
  PUNCH_EXPORT_NATIVE_REMOTE_BUDGET_BYTES,
  PUNCH_EXPORT_PIN_CROP_CAP,
  PUNCH_EXPORT_PIN_CROP_PX,
  PUNCH_EXPORT_PIN_CROP_QUALITY,
  PUNCH_EXPORT_PREF_KEY,
  PUNCH_EXPORT_ROTATE_TARGETS,
  PUNCH_EXPORT_UNKNOWN_PHOTO_BYTES,
  PUNCH_EXPORT_WEB_CONCURRENCY,
  PUNCH_EXPORT_WEB_PLAN_MAX_PX,
  PUNCH_EXPORT_WEB_PLAN_QUALITY,
  PUNCH_EXPORT_WEB_THUMB_PX,
  PUNCH_EXPORT_WEB_THUMB_QUALITY,
  type PunchExportAssets,
  type PunchExportImageAsset,
  type PunchExportImageMime,
  type PunchExportModel,
  type PunchExportPhotoSlot,
  type PunchExportPinCropAsset,
  type PunchExportPref,
  type PunchExportProgress,
  type PunchExportStage,
  type PunchExportTarget,
} from '@/utils/punchExportCore';
import {
  PUNCH_EXPORT_HINT_ELEMENT_ID,
  PUNCH_EXPORT_PRINT_PLACEHOLDER_HTML,
  PUNCH_EXPORT_STATUS_ELEMENT_ID,
  safeLogoSrc,
} from '@/utils/punchExportHtml';
import { pinCropWindow } from '@/utils/punchPlanPin';

// ───────────────────────────────────────────────────────────────────────────
// Plumbing
// ───────────────────────────────────────────────────────────────────────────

export class PunchExportError extends Error {
  stage: PunchExportStage;
  cause?: unknown;
  constructor(stage: PunchExportStage, cause?: unknown) {
    super(`punch export failed at ${stage}`);
    this.name = 'PunchExportError';
    this.stage = stage;
    this.cause = cause;
  }
}

/** The storage origin — the ONLY https origin an <object> may load. */
export function exportAllowedOrigins(): string[] {
  try {
    return [new URL(SUPABASE_URL).origin];
  } catch {
    return [];
  }
}

/** Strips URLs (and their signed tokens) before anything is logged. */
export function scrubMessage(s: unknown): string {
  return String(s ?? '').replace(/https?:\/\/\S+/g, '[url]');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new PunchExportError('photos', new Error('cancelled'));
}

/** A promise pool with no timers. Workers run `limit` at a time, in order. */
async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      throwIfAborted(signal);
      const i = next++;
      await worker(items[i], i);
    }
  };
  const lanes: Promise<void>[] = [];
  for (let k = 0; k < Math.max(1, Math.min(limit, items.length)); k++) lanes.push(lane());
  await Promise.all(lanes);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new PunchExportError('timeout')), ms);
    p.then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

/** fetch with its own timeout, also aborted when the run's signal aborts. */
async function abortableFetch(url: string, init: RequestInit, ms: number, signal?: AbortSignal): Promise<Response> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener('abort', onAbort);
  }
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const MIMES: readonly PunchExportImageMime[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'];

function mimeFromExt(uri: string): PunchExportImageMime {
  const ext = photoExtFromUri(uri).toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'image/jpeg';
}

/** Only raster images: an image/svg+xml answer would load as a scriptable
 *  nested document inside <object>, whatever the type attribute says. */
function isRasterContentType(contentType: string | null | undefined): boolean {
  const ct = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  return ct === 'image/jpg' || (MIMES as readonly string[]).includes(ct);
}

const RASTER_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif']);
function hasRasterExt(uri: string): boolean {
  return RASTER_EXTS.has(photoExtFromUri(uri).toLowerCase());
}

function narrowMime(contentType: string | null | undefined, url: string): PunchExportImageMime {
  const ct = String(contentType ?? '').split(';')[0].trim().toLowerCase();
  const t = ct === 'image/jpg' ? 'image/jpeg' : ct;
  return (MIMES as readonly string[]).includes(t) ? (t as PunchExportImageMime) : mimeFromExt(url);
}

function isAllowedHttps(url: string | undefined, allowed: readonly string[]): url is string {
  if (!url || !/^https:/i.test(url)) return false;
  try {
    return allowed.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Native: is the remote photo there, and how big is it?
// ───────────────────────────────────────────────────────────────────────────

type RemoteCheck = { ok: true; bytes: number | null; mime: PunchExportImageMime } | { ok: false };

export async function verifyRemote(url: string, signal?: AbortSignal): Promise<RemoteCheck> {
  try {
    const res = await abortableFetch(url, { method: 'HEAD' }, PUNCH_EXPORT_CHECK_TIMEOUT_MS, signal);
    const ct = res.headers.get('content-type') ?? '';
    if (res.ok && isRasterContentType(ct)) {
      const len = Number(res.headers.get('content-length'));
      return { ok: true, bytes: Number.isFinite(len) && len > 0 ? len : null, mime: narrowMime(ct, url) };
    }
  } catch {/* fall through to the ranged GET */}
  if (signal?.aborted) return { ok: false };
  // Some signed-URL endpoints refuse HEAD. A one-byte ranged GET gives the same
  // answer. Supabase storage honours Range (206, one byte). Caveat: React
  // Native's fetch resolves only after the body has arrived, so a server that
  // ignored Range and answered 200 would still send the whole photo — the
  // abort below only helps on web. Bounded by the check timeout and the pool
  // of PUNCH_EXPORT_NATIVE_CHECK_CONCURRENCY.
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctl.abort(), PUNCH_EXPORT_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: ctl.signal });
    const ct = res.headers.get('content-type') ?? '';
    let bytes: number | null = null;
    const cr = /\/(\d+)\s*$/.exec(res.headers.get('content-range') ?? '');
    if (cr) bytes = Number(cr[1]);
    else if (res.status === 200) {
      const len = Number(res.headers.get('content-length'));
      bytes = Number.isFinite(len) && len > 0 ? len : null;
    }
    ctl.abort();
    if ((res.status === 200 || res.status === 206) && isRasterContentType(ct)) {
      return { ok: true, bytes: bytes && Number.isFinite(bytes) ? bytes : null, mime: narrowMime(ct, url) };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function localFileSize(uri: string): Promise<number | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return typeof (info as { size?: number }).size === 'number' ? (info as { size: number }).size : 0;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Web: a small, square JPEG of each photo
// ───────────────────────────────────────────────────────────────────────────

type WebImage = { dataUrl: string; width: number; height: number };

function loadImageElement(url: string): Promise<HTMLImageElement> {
  // Image onload, never img.decode(): decode() can stall in a background tab,
  // and the opener IS a background tab once the print tab is in front.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}

async function webImageToJpeg(
  src: string,
  mode: 'square' | 'contain',
  maxPx: number,
  quality: number,
  signal?: AbortSignal,
): Promise<WebImage> {
  const isData = /^data:/i.test(src);
  const res = await abortableFetch(src, {}, PUNCH_EXPORT_FETCH_TIMEOUT_MS, signal);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  if (!isData && !/^image\//i.test(ct)) throw new Error('not an image');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  let img: HTMLImageElement | null = null;
  const canvas = document.createElement('canvas');
  try {
    img = await loadImageElement(url);
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!(iw > 0 && ih > 0)) throw new Error('empty image');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    let out: WebImage;
    if (mode === 'square') {
      // The CENTRED SQUARE — exactly the annotator's frame, so markup lines up.
      const side = Math.min(iw, ih);
      const size = Math.min(maxPx, side);
      canvas.width = size;
      canvas.height = size;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, size, size);
      out = { dataUrl: canvas.toDataURL('image/jpeg', quality), width: size, height: size };
    } else {
      const scale = Math.min(1, maxPx / Math.max(iw, ih));
      const w = Math.max(1, Math.round(iw * scale));
      const h = Math.max(1, Math.round(ih * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      out = { dataUrl: canvas.toDataURL('image/jpeg', quality), width: w, height: h };
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
    if (img) img.src = '';
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * The web export's per-item plan close-ups, cut from the sheet JPEGs this
 * export already made (data: URLs — same origin, so the canvas is never
 * tainted). One image load per sheet, one small canvas per item, document
 * order, capped at PUNCH_EXPORT_PIN_CROP_CAP. Never throws: a sheet that will
 * not load or a crop that fails just leaves that item without a close-up (it
 * still names its sheet and pin, and the plan page still shows it).
 */
async function webPinCrops(
  model: PunchExportModel,
  sheets: ReadonlyMap<string, PunchExportImageAsset>,
  signal?: AbortSignal,
): Promise<Map<string, PunchExportPinCropAsset>> {
  const out = new Map<string, PunchExportPinCropAsset>();
  const docRows = model.sections.flatMap(s => s.groups.flatMap(g => g.rows)).filter(r => r.plan.state === 'pinned');
  const bySheet = new Map<string, typeof docRows>();
  for (const r of docRows.slice(0, PUNCH_EXPORT_PIN_CROP_CAP)) {
    if (r.plan.state !== 'pinned') continue;
    const arr = bySheet.get(r.plan.sheetId) ?? [];
    arr.push(r);
    bySheet.set(r.plan.sheetId, arr);
  }
  for (const [sheetId, rows] of bySheet) {
    throwIfAborted(signal);
    const asset = sheets.get(sheetId);
    if (!asset || asset.kind !== 'image' || asset.remote || !/^data:image\//i.test(asset.src.slice(0, 11))) continue;
    let img: HTMLImageElement | null = null;
    const canvas = document.createElement('canvas');
    try {
      img = await withTimeout(loadImageElement(asset.src), PUNCH_EXPORT_FETCH_TIMEOUT_MS);
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx || !(iw > 0 && ih > 0)) continue;
      canvas.width = PUNCH_EXPORT_PIN_CROP_PX;
      canvas.height = PUNCH_EXPORT_PIN_CROP_PX;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (const r of rows) {
        if (r.plan.state !== 'pinned') continue;
        const w = pinCropWindow(r.plan.x, r.plan.y, iw / ih);
        if (!w) continue;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, PUNCH_EXPORT_PIN_CROP_PX, PUNCH_EXPORT_PIN_CROP_PX);
        ctx.drawImage(img, w.left * iw, w.top * ih, w.width * iw, w.height * ih, 0, 0, PUNCH_EXPORT_PIN_CROP_PX, PUNCH_EXPORT_PIN_CROP_PX);
        out.set(r.id, { src: canvas.toDataURL('image/jpeg', PUNCH_EXPORT_PIN_CROP_QUALITY), mime: 'image/jpeg', pinX: w.pinX, pinY: w.pinY });
      }
    } catch (e) {
      if (e instanceof PunchExportError && e.stage !== 'timeout') throw e;
      /* this sheet's items print without a close-up */
    } finally {
      if (img) img.src = '';
      canvas.width = 0;
      canvas.height = 0;
    }
  }
  return out;
}

/**
 * The OS's size for an image, oriented (iOS applies EXIF before it reports).
 * Null on any failure or after `ms`. The export only USES it when it agrees
 * with the size stored on the sheet (punchExportCore.verifiedSheetAspect).
 */
function nativeImageSize(uri: string, ms: number): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(null); } }, ms);
    try {
      RNImage.getSize(
        uri,
        (width, height) => { if (!done) { done = true; clearTimeout(t); resolve(width > 0 && height > 0 ? { width, height } : null); } },
        () => { if (!done) { done = true; clearTimeout(t); resolve(null); } },
      );
    } catch {
      if (!done) { done = true; clearTimeout(t); resolve(null); }
    }
  });
}

function isCorsLike(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TypeError' || name === 'SecurityError';
}

function browserOnline(): boolean {
  try {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  } catch {
    return true;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Resolve every photo and plan the PDF will carry
// ───────────────────────────────────────────────────────────────────────────

export async function resolveExportAssets(
  model: PunchExportModel,
  opts: {
    includePhotos: boolean;
    target: PunchExportTarget;
    signal?: AbortSignal;
    onProgress?: (p: PunchExportProgress) => void;
  },
): Promise<PunchExportAssets> {
  const { target, signal, onProgress } = opts;
  const allowed = exportAllowedOrigins();
  const photos = new Map<string, PunchExportImageAsset>();
  const sheets = new Map<string, PunchExportImageAsset>();
  let pinCrops: Map<string, PunchExportPinCropAsset> | undefined;
  let approxBytes: number | null = target === 'web' ? null : 0;
  let inlineUsed = 0;

  try {
    if (opts.includePhotos && model.photoItemIds.length > 0) {
      for (const id of model.photoOverCapIds) photos.set(id, { kind: 'unavailable', reason: 'over_cap' });
      const slots = model.photoSlots;
      onProgress?.({ step: 'signing', done: 0, total: slots.length });
      // Bounded: on weak signal the signing call alone can sit on the OS
      // default (~60 s). On timeout / failure, fall back like offline does.
      let signed = new Map<string, string>();
      try {
        signed = await withTimeout(
          resolvePhotoUrls(slots.map(s => s.storagePath).filter((p): p is string => !!p)),
          PUNCH_EXPORT_FETCH_TIMEOUT_MS,
        );
      } catch {/* local copies / httpUri / the honest box */}
      throwIfAborted(signal);
      const remoteFor = (s: PunchExportPhotoSlot): string | undefined => {
        const sg = s.storagePath ? signed.get(s.storagePath) : undefined;
        if (sg) return sg;
        return isAllowedHttps(s.httpUri, allowed) ? s.httpUri : undefined;
      };

      if (target !== 'web') {
        // Phase a — verify, in parallel.
        const checks = new Map<string, RemoteCheck>();
        let done = 0;
        onProgress?.({ step: 'photos', done: 0, total: slots.length });
        await runPool(slots, PUNCH_EXPORT_NATIVE_CHECK_CONCURRENCY, async s => {
          const url = remoteFor(s);
          checks.set(s.itemId, url ? await verifyRemote(url, signal) : { ok: false });
          done += 1;
          onProgress?.({ step: 'photos', done, total: slots.length });
        }, signal);
        // Phase b — allocate the budget in PRIORITY order (open items first),
        // sequentially, so the result is deterministic.
        const budget = PUNCH_EXPORT_NATIVE_REMOTE_BUDGET_BYTES[target];
        const inlineBudget = PUNCH_EXPORT_NATIVE_INLINE_BUDGET_BYTES[target];
        let used = 0;
        for (const s of slots) {
          throwIfAborted(signal);
          const url = remoteFor(s);
          const check = checks.get(s.itemId);
          if (url && check && check.ok) {
            const bytes = check.bytes ?? PUNCH_EXPORT_UNKNOWN_PHOTO_BYTES;
            if (used + bytes <= budget) {
              used += bytes;
              photos.set(s.itemId, { kind: 'image', src: url, mime: check.mime, bytes });
            } else {
              photos.set(s.itemId, { kind: 'unavailable', reason: 'over_size' });
            }
            continue;
          }
          if (s.localUri && /^file:/i.test(s.localUri)) {
            const size = await localFileSize(s.localUri);
            if (size === null) { photos.set(s.itemId, { kind: 'unavailable', reason: 'unreachable' }); continue; }
            if (inlineUsed + size > inlineBudget || used + size > budget) {
              photos.set(s.itemId, { kind: 'unavailable', reason: 'over_offline_budget' });
              continue;
            }
            try {
              const b64 = await readAsBase64(s.localUri);
              const mime = mimeFromExt(s.localUri);
              inlineUsed += size;
              used += size;
              photos.set(s.itemId, { kind: 'image', src: `data:${mime};base64,${b64}`, mime, bytes: size });
            } catch {
              photos.set(s.itemId, { kind: 'unavailable', reason: 'unreachable' });
            }
            continue;
          }
          photos.set(s.itemId, { kind: 'unavailable', reason: 'unreachable' });
        }
        approxBytes = used;
      } else {
        let done = 0;
        onProgress?.({ step: 'photos', done: 0, total: slots.length });
        await runPool(slots, PUNCH_EXPORT_WEB_CONCURRENCY, async s => {
          const signedUrl = s.storagePath ? signed.get(s.storagePath) : undefined;
          const candidates: string[] = [];
          if (signedUrl) candidates.push(signedUrl);
          if (s.localUri && /^(blob:|data:)/i.test(s.localUri)) candidates.push(s.localUri);
          if (isAllowedHttps(s.httpUri, allowed)) candidates.push(s.httpUri as string);
          let asset: PunchExportImageAsset = { kind: 'unavailable', reason: 'unreachable' };
          let corsFallback: string | null = null;
          for (const c of candidates) {
            try {
              const img = await withTimeout(
                webImageToJpeg(c, 'square', PUNCH_EXPORT_WEB_THUMB_PX, PUNCH_EXPORT_WEB_THUMB_QUALITY, signal),
                PUNCH_EXPORT_FETCH_TIMEOUT_MS,
              );
              asset = { kind: 'image', src: img.dataUrl, mime: 'image/jpeg', width: img.width, height: img.height };
              break;
            } catch (e) {
              // Raster paths only: the print tab loads a fallback without us
              // ever seeing its Content-Type.
              if (!corsFallback && /^https:/i.test(c) && isAllowedHttps(c, allowed) && hasRasterExt(c) && isCorsLike(e) && browserOnline()) {
                corsFallback = c;
              }
            }
          }
          if (asset.kind !== 'image' && corsFallback) {
            // The print tab loads it directly (signed for 24h); square cover
            // still keeps the markup aligned.
            asset = { kind: 'image', src: corsFallback, mime: mimeFromExt(corsFallback), remote: true };
          }
          photos.set(s.itemId, asset);
          done += 1;
          onProgress?.({ step: 'photos', done, total: slots.length });
        }, signal);
      }
    }

    // ── Plans ───────────────────────────────────────────────────────────
    const pages = model.sheetPages;
    if (pages.length > 0) {
      onProgress?.({ step: 'plans', done: 0, total: pages.length });
      const inputs = pages
        .filter(p => p.imageState !== 'missing')
        .map(p => p.storagePath ?? p.imageUri)
        .filter((u): u is string => !!u && !isDeviceLocalUri(u));
      let urls = new Map<string, string>();
      try {
        urls = await withTimeout(resolvePlanSheetUrls(inputs), PUNCH_EXPORT_FETCH_TIMEOUT_MS);
      } catch {/* offline — pages fall back to local copies or the honest box */}
      let done = 0;
      for (const p of pages) {
        throwIfAborted(signal);
        let asset: PunchExportImageAsset = { kind: 'unavailable', reason: 'unreachable' };
        if (p.imageState !== 'missing') {
          const key = p.storagePath ?? p.imageUri ?? '';
          const remote = urls.get(key) ?? (p.imageUri && /^https:/i.test(p.imageUri) ? p.imageUri : undefined);
          const local = p.imageUri && isDeviceLocalUri(p.imageUri) ? p.imageUri : undefined;
          if (target !== 'web') {
            if (isAllowedHttps(remote, allowed)) {
              const check = await verifyRemote(remote as string, signal);
              if (check.ok) {
                asset = { kind: 'image', src: remote as string, mime: check.mime };
                // Where the page is portrait-only (iOS), a landscape sheet is
                // turned to fit and each item gets a close-up — both laid out
                // on the image's true shape, so ask the OS for it.
                if (PUNCH_EXPORT_ROTATE_TARGETS.includes(target)) {
                  const size = await nativeImageSize(remote as string, PUNCH_EXPORT_CHECK_TIMEOUT_MS);
                  if (size) asset = { ...asset, width: size.width, height: size.height };
                }
              }
            }
            if (asset.kind !== 'image' && local && /^file:/i.test(local)) {
              const size = await localFileSize(local);
              const inlineBudget = PUNCH_EXPORT_NATIVE_INLINE_BUDGET_BYTES[target];
              if (size !== null && inlineUsed + size <= inlineBudget) {
                try {
                  const b64 = await readAsBase64(local);
                  const mime = mimeFromExt(local);
                  inlineUsed += size;
                  asset = { kind: 'image', src: `data:${mime};base64,${b64}`, mime };
                  // The size lets an inlined landscape sheet turn to fit too
                  // (no close-ups: a data: sheet is never repeated per item).
                  if (PUNCH_EXPORT_ROTATE_TARGETS.includes(target)) {
                    const size = await nativeImageSize(local, PUNCH_EXPORT_CHECK_TIMEOUT_MS);
                    if (size) asset = { ...asset, width: size.width, height: size.height };
                  }
                } catch {/* stays unavailable */}
              }
            }
          } else {
            const candidates = [remote, local].filter((u): u is string => !!u);
            let corsFallback: string | null = null;
            for (const c of candidates) {
              try {
                const img = await withTimeout(
                  webImageToJpeg(c, 'contain', PUNCH_EXPORT_WEB_PLAN_MAX_PX, PUNCH_EXPORT_WEB_PLAN_QUALITY, signal),
                  PUNCH_EXPORT_FETCH_TIMEOUT_MS,
                );
                asset = { kind: 'image', src: img.dataUrl, mime: 'image/jpeg', width: img.width, height: img.height };
                break;
              } catch (e) {
                if (!corsFallback && isAllowedHttps(c, allowed) && isCorsLike(e) && browserOnline()) corsFallback = c;
              }
            }
            if (asset.kind !== 'image' && corsFallback) {
              asset = { kind: 'image', src: corsFallback, mime: mimeFromExt(corsFallback), remote: true };
            }
          }
        }
        sheets.set(p.sheetId, asset);
        done += 1;
        onProgress?.({ step: 'plans', done, total: pages.length });
      }
      // The close-ups print on the item cards, which only exist with photos on.
      if (target === 'web' && opts.includePhotos) pinCrops = await webPinCrops(model, sheets, signal);
    }
  } catch (e) {
    if (e instanceof PunchExportError) throw e;
    console.warn('[punchExport] resolveExportAssets:', scrubMessage((e as Error)?.message ?? e));
    throw new PunchExportError('photos', e);
  }

  let remoteCount = 0;
  let includedPhotoCount = 0;
  for (const a of photos.values()) {
    if (a.kind === 'image') { includedPhotoCount += 1; if (a.remote) remoteCount += 1; }
  }
  for (const a of sheets.values()) if (a.kind === 'image' && a.remote) remoteCount += 1;
  return { photos, sheets, approxBytes, remoteCount, includedPhotoCount, ...(pinCrops && pinCrops.size > 0 ? { pinCrops } : {}) };
}

/** A logo the PDF can actually draw. Never throws; a logo it cannot use is
 *  dropped and pdfHeader draws its monogram. */
export async function resolveBrandingForExport(branding: CompanyBranding, target: PunchExportTarget): Promise<CompanyBranding> {
  const logo = String(branding.logoUri ?? '').trim();
  if (!logo) return { ...branding, logoUri: undefined };
  if (safeLogoSrc(logo)) {
    // Offline on iOS a failed <img> prints WebKit's broken-image '?' in the
    // header — check an https logo first and fall back to the monogram.
    if (target !== 'web' && /^https:/i.test(logo)) {
      const check = await verifyRemote(logo);
      if (!check.ok || (check.bytes !== null && check.bytes > PUNCH_EXPORT_LOGO_MAX_BYTES)) {
        return { ...branding, logoUri: undefined };
      }
    }
    return { ...branding, logoUri: logo };
  }
  if (target !== 'web' && /^file:/i.test(logo)) {
    try {
      const size = await localFileSize(logo);
      if (size !== null && size <= PUNCH_EXPORT_LOGO_MAX_BYTES) {
        const b64 = await readAsBase64(logo);
        const mime = photoExtFromUri(logo).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
        return { ...branding, logoUri: `data:${mime};base64,${b64}` };
      }
    } catch {/* monogram */}
  }
  return { ...branding, logoUri: undefined };
}

// ───────────────────────────────────────────────────────────────────────────
// Native render
// ───────────────────────────────────────────────────────────────────────────

let inFlight: { startedAt: number; settled: boolean } | null = null;

export function nativeRenderBusy(now: number = Date.now()): boolean {
  return !!inFlight && !inFlight.settled && now - inFlight.startedAt < PUNCH_EXPORT_NATIVE_BUSY_CEILING_MS;
}

export async function discardFile(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {/* best effort */}
}

async function pruneExportDirs(): Promise<void> {
  const root = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}punch-export/` : null;
  if (!root) return;
  try {
    const names = await FileSystem.readDirectoryAsync(root);
    const now = Date.now();
    for (const name of names) {
      const ts = /^\d+$/.test(name) ? Number(name) : NaN;
      if (Number.isFinite(ts) && now - ts < PUNCH_EXPORT_DIR_MAX_AGE_MS) continue;
      await discardFile(`${root}${name}`);
    }
  } catch {/* no folder yet */}
}

export async function renderNativePdf(
  html: string,
  fileName: string,
  opts: { timeoutMs: number },
): Promise<{ uri: string; bytes: number | null }> {
  if (nativeRenderBusy()) throw new PunchExportError('busy');
  const Print = await import('expo-print');
  const entry = { startedAt: Date.now(), settled: false };
  inFlight = entry;
  const raw = Print.printToFileAsync({
    html,
    base64: false,
    margins: { top: 36, right: 36, bottom: 36, left: 36 },
  });
  const settle = () => {
    entry.settled = true;
    if (inFlight === entry) inFlight = null;
  };
  raw.then(settle, settle);
  let uri: string;
  try {
    const res = await withTimeout(raw, opts.timeoutMs);
    uri = res.uri;
  } catch (e) {
    // The render may still land after we gave up on it: delete that orphan.
    raw.then(r => discardFile(r?.uri), () => {});
    if (e instanceof PunchExportError) throw e;
    throw new PunchExportError('render', e);
  }
  let target = uri;
  try {
    await pruneExportDirs();
    const dir = `${FileSystem.cacheDirectory}punch-export/${Date.now()}/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    await FileSystem.moveAsync({ from: uri, to: `${dir}${fileName}` });
    target = `${dir}${fileName}`;
  } catch {
    target = uri;
  }
  let bytes: number | null = null;
  try {
    const info = await FileSystem.getInfoAsync(target);
    bytes = info.exists && typeof (info as { size?: number }).size === 'number' ? (info as { size: number }).size : null;
  } catch {/* size unknown */}
  return { uri: target, bytes };
}

// ───────────────────────────────────────────────────────────────────────────
// Web print window
// ───────────────────────────────────────────────────────────────────────────

export interface PrintWindowHandle {
  blocked: boolean;
  isClosed: () => boolean;
  setStatus: (text: string) => void;
  writeAndPrint: (html: string, opts: { remoteCount: number }) => Promise<'printed' | 'printed-early' | 'closed'>;
  close: () => void;
}

/** WEB ONLY. Must be called synchronously inside the press. */
export function openPrintWindow(): PrintWindowHandle {
  let w: Window | null = null;
  try {
    w = typeof window !== 'undefined' ? window.open('', '_blank') : null;
  } catch {
    w = null;
  }
  let reportWritten = false;
  if (w) {
    try {
      w.document.open();
      w.document.write(PUNCH_EXPORT_PRINT_PLACEHOLDER_HTML);
      w.document.close();
    } catch {/* the tab is still usable */}
  }
  const isClosed = () => !w || w.closed;
  const setStatus = (text: string) => {
    try {
      if (!w || w.closed) return;
      const el = w.document.getElementById(reportWritten ? PUNCH_EXPORT_HINT_ELEMENT_ID : PUNCH_EXPORT_STATUS_ELEMENT_ID);
      if (el) el.textContent = text;
    } catch {/* cross-document hiccup */}
  };
  const writeAndPrint = async (html: string, opts: { remoteCount: number }) => {
    if (isClosed()) return 'closed' as const;
    const win = w as Window;
    win.document.open();
    win.document.write(html);
    win.document.close();
    reportWritten = true;
    if (opts.remoteCount > 0) setStatus('Loading photos…');
    const cap = webPrintWaitMs(opts.remoteCount);
    const hitCap = await new Promise<boolean>(resolve => {
      let finished = false;
      const done = (capped: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        clearInterval(poll);
        try { win.removeEventListener('load', onLoad); } catch {/* closed */}
        resolve(capped);
      };
      const onLoad = () => done(false);
      const timer = setTimeout(() => done(true), cap);
      const poll = setInterval(() => {
        try {
          if (win.closed) done(false);
          else if (win.document.readyState === 'complete') done(false);
        } catch { done(false); }
      }, 250);
      try { win.addEventListener('load', onLoad); } catch {/* closed */}
      try { if (win.document.readyState === 'complete') done(false); } catch { done(false); }
    });
    if (isClosed()) return 'closed' as const;
    try {
      const fonts = (win.document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
      await Promise.race([fonts ?? Promise.resolve(), new Promise(r => setTimeout(r, 3000))]);
    } catch {/* system font */}
    if (hitCap) {
      setStatus('Some photos were still loading when the print dialog opened. If a photo reads "Photo not available", close the dialog, wait a moment and print again (Ctrl/Cmd+P).');
    }
    try {
      win.focus();
      win.print();
    } catch {/* the tab still holds the report */}
    return hitCap ? 'printed-early' as const : 'printed' as const;
  };
  return {
    blocked: !w,
    isClosed,
    setStatus,
    writeAndPrint,
    close: () => {
      try { w?.close(); } catch {/* already gone */}
    },
  };
}

/** WEB: starts the download inside the press (deliverTextFile reaches a.click()
 *  synchronously). Not awaited on purpose. */
export function startWebDownload(fileName: string, contents: string, mime: string): void {
  deliverTextFile(fileName, contents, mime).catch(() => {});
}

export async function writeNativeCsv(fileName: string, csv: string): Promise<string | null> {
  try {
    return await deliverTextFile(fileName, csv, 'text/csv;charset=utf-8');
  } catch (e) {
    throw new PunchExportError('write', e);
  }
}

export async function canShareFiles(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const Sharing = await import('expo-sharing');
    return await Sharing.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Hand the file to the share sheet. Never throws; says whether it worked so
 *  the caller can tell him (the export sheet is already closed by then). */
export async function shareExportFile(uri: string, kind: 'pdf' | 'csv', dialogTitle: string): Promise<{ ok: boolean }> {
  try {
    const Sharing = await import('expo-sharing');
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, kind === 'pdf'
        ? { mimeType: 'application/pdf', dialogTitle, UTI: 'com.adobe.pdf' }
        : { mimeType: 'text/csv', dialogTitle, UTI: 'public.comma-separated-values-text' });
      return { ok: true };
    }
    if (kind === 'pdf') {
      const Print = await import('expo-print');
      await Print.printAsync({ uri });
      return { ok: true };
    }
    return { ok: false };
  } catch (e) {
    console.warn('[punchExport] share:', scrubMessage((e as Error)?.message ?? e));
    return { ok: false };
  }
}

export function csvShareOutcome(uri: string | null, shareable: boolean): 'shared' | 'downloaded' | 'unavailable' {
  return csvHandoverOutcome(uri, hasFileSystem(), shareable);
}

// ───────────────────────────────────────────────────────────────────────────
// Remembered format / photos (per device; scope and crew are never remembered)
// ───────────────────────────────────────────────────────────────────────────

export async function loadExportPref(): Promise<PunchExportPref | null> {
  try {
    return parseExportPref(await AsyncStorage.getItem(PUNCH_EXPORT_PREF_KEY));
  } catch {
    return null;
  }
}

export async function saveExportPref(p: PunchExportPref): Promise<void> {
  try {
    await AsyncStorage.setItem(PUNCH_EXPORT_PREF_KEY, serializeExportPref(p));
  } catch {/* a convenience, not state */}
}
