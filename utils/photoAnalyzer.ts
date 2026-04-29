// photoAnalyzer — wraps the analyze-photos Supabase edge function so
// screens don't have to know about the Gemini Vision plumbing. Two
// tasks:
//   - analyzePhotosForPunch: returns a PunchPartial[] ready to feed
//     into the existing punch flow (description / location / trade /
//     priority + photoIndex pointing back at the source photo so the
//     caller can attach the right URI when saving).
//   - analyzePhotosForDfr: returns a DFR summary (workPerformed,
//     trades, materials, notes) the caller merges into the daily
//     report draft.
//
// The edge function caps at 12 photos per call for cost / latency.
// The wire payload is also limited (Supabase Functions: ~10MB) — we
// down-sample inline base64 photos in payload size by sending only
// what's necessary and keeping count moderate.

import { supabase } from '@/lib/supabase';
import * as FileSystem from 'expo-file-system';

export interface AiPunchItem {
  description: string;
  /** Title-case location ("Master Bath"). May be empty if unclear. */
  location: string;
  /** Free-text trade — caller maps to its own enum. */
  trade: string;
  priority: 'low' | 'medium' | 'high';
  /** Index into the photoUrls array the caller passed in. Lets the
   *  caller attach the source photo URI to the saved punch item. */
  photoIndex: number;
  /** 0-100. Edge function already filters <60 client-side. */
  confidence: number;
}

export interface AiDfrSummary {
  workPerformed: string;
  tradesOnSite: string[];
  materialsObserved: string[];
  notesForGC: string;
}

interface BaseOpts {
  /** Each entry can be a remote URL (server fetches) or a local
   *  file:// URI (we base64-encode client-side and send inline).
   *  Mixing both is currently unsupported — caller should pick one. */
  photoUrls: string[];
  projectName?: string;
  projectType?: string;
  notes?: string;
}

interface InlinePhoto { base64: string; mimeType?: string }

const isLocal = (u: string) => u.startsWith('file:') || u.startsWith('/');

/**
 * Encode a list of file:// URIs to inline base64 — IN PARALLEL
 * (round-1 #1). Uses allSettled (round-2 #1) so one corrupt URI
 * (e.g. file deleted between picker and analyze) doesn't kill the
 * entire batch.
 *
 * Returns:
 *   - encoded: the photos that succeeded, in surviving-input order
 *   - originalIndexes: each surviving photo's index in the ORIGINAL
 *     input list (round-3 #1). The caller uses this to remap the
 *     photoIndex Gemini returns back to the original list, so a
 *     punch item points at the correct source URI even when some
 *     encodes were skipped.
 *   - failedIndexes: original indexes that failed, for telemetry
 */
async function encodeLocalPhotos(uris: string[]): Promise<{
  encoded: InlinePhoto[];
  originalIndexes: number[];
  failedIndexes: number[];
}> {
  const settled = await Promise.allSettled(uris.map(async (u) => {
    // Pass string-literal 'base64' rather than the enum — expo-file-system
    // moved EncodingType into a legacy namespace in newer SDKs and the
    // string form is accepted by the typed signature regardless.
    const base64 = await FileSystem.readAsStringAsync(u, { encoding: 'base64' });
    const ext = u.split('.').pop()?.toLowerCase() ?? '';
    const mimeType = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
    return { base64, mimeType };
  }));
  const encoded: InlinePhoto[] = [];
  const originalIndexes: number[] = [];
  const failedIndexes: number[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      encoded.push(r.value);
      originalIndexes.push(i);
    } else {
      failedIndexes.push(i);
    }
  });
  return { encoded, originalIndexes, failedIndexes };
}

/**
 * Estimate the wire size of the inline-photos payload. Base64 inflates
 * raw bytes by 4/3, plus JSON overhead. We use this to short-circuit
 * before hitting Supabase's 10MB function-request limit (code-review #6).
 * Threshold of 8MB leaves room for the rest of the JSON payload + headers.
 */
function totalBase64Bytes(photos: InlinePhoto[]): number {
  return photos.reduce((sum, p) => sum + p.base64.length, 0);
}
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

/**
 * One automatic retry on 5xx — vision calls fail more often than text
 * (image upload timeouts, Gemini transient 503s). Code-review #12.
 *
 * The `_meta` we tack onto the return value lets the caller remap
 * photoIndex from "index into the encoded array" to "index into the
 * caller's original list" — important when some encodes failed
 * (round-3 #1).
 */
interface AnalyzeMeta {
  /** For each encoded photo, the index into the caller's original
   *  photoUrls array. Gemini's photoIndex maps THROUGH this array
   *  back to the original. Length === number of photos analyzed. */
  originalIndexes: number[];
  /** Indexes from the original list that failed to encode and were
   *  therefore not analyzed. Surface to the user as "skipped N
   *  photo(s)" if non-empty. */
  skippedIndexes: number[];
}

async function callAnalyzePhotos<T>(opts: BaseOpts & { task: 'punch' | 'dfr' }, attempt = 0): Promise<{ data: T; meta: AnalyzeMeta }> {
  if (!opts.photoUrls || opts.photoUrls.length === 0) {
    throw new Error('No photos to analyze.');
  }
  if (opts.photoUrls.length > 12) {
    throw new Error('Max 12 photos per call.');
  }
  const localUris = opts.photoUrls.filter(isLocal);
  const remoteUris = opts.photoUrls.filter(u => !isLocal(u));
  if (localUris.length > 0 && remoteUris.length > 0) {
    throw new Error('Mixed local + remote URIs not supported in one call. Pick one source.');
  }

  const payload: Record<string, unknown> = {
    task: opts.task,
    projectName: opts.projectName,
    projectType: opts.projectType,
    notes: opts.notes,
  };

  // The originalIndexes array tracks, per encoded photo, which slot
  // in the caller's input it came from. For URL paths this is just
  // [0, 1, 2, ...]. For local-encode paths it's whatever survived
  // the allSettled. Either way, the caller can remap photoIndex.
  let meta: AnalyzeMeta;
  if (localUris.length > 0) {
    const { encoded, originalIndexes, failedIndexes } = await encodeLocalPhotos(localUris);
    if (encoded.length === 0) {
      throw new Error('Could not read any of the picked photos. They may have been moved or deleted.');
    }
    if (failedIndexes.length > 0) {
      console.warn(`[photoAnalyzer] ${failedIndexes.length} photo(s) failed to encode; proceeding with ${encoded.length}`);
    }
    const bytes = totalBase64Bytes(encoded);
    if (bytes > MAX_PAYLOAD_BYTES) {
      const mb = (bytes / 1024 / 1024).toFixed(1);
      throw new Error(
        `Photo payload too large (${mb} MB). Pick fewer photos, or take them at lower quality. ` +
        `The AI analyzer accepts up to ~8 MB total per call.`,
      );
    }
    payload.photos = encoded;
    meta = { originalIndexes, skippedIndexes: failedIndexes };
  } else {
    payload.photoUrls = remoteUris;
    meta = { originalIndexes: remoteUris.map((_, i) => i), skippedIndexes: [] };
  }

  const { data, error } = await supabase.functions.invoke<{ success: boolean; data?: T; error?: string }>(
    'analyze-photos',
    { body: payload },
  );

  // Detect transient 5xx via the wrapper's error.message convention
  // ("Edge function returned non-2xx response: 502" etc).
  const transient = error && /5\d\d/.test(error.message ?? '');
  if (transient && attempt === 0) {
    await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
    return callAnalyzePhotos<T>(opts, attempt + 1);
  }

  if (error) throw new Error(`Photo analyzer call failed: ${error.message}`);
  if (!data?.success || !data.data) {
    throw new Error(data?.error ?? 'Photo analyzer returned an empty result.');
  }
  return { data: data.data, meta };
}

export async function analyzePhotosForPunch(opts: BaseOpts): Promise<{ items: AiPunchItem[]; meta: AnalyzeMeta }> {
  const { data, meta } = await callAnalyzePhotos<{ items: AiPunchItem[] }>({ ...opts, task: 'punch' });
  // Remap each item's photoIndex back to the caller's original list.
  // If encoding skipped photo #3, Gemini's index `2` actually points
  // at the caller's original #4 — meta.originalIndexes[2] gives us 4.
  // This was a real bug pre-round-3: the wrong photo URI got attached.
  //
  // Round-4 #1: Drop items whose photoIndex is out-of-bounds for the
  // analyzed-photos array (Gemini occasionally hallucinates a photoIndex
  // larger than what we sent). Falling through to the un-remapped value
  // would silently attach the wrong source photo. console.warn keeps
  // visibility for debugging without crashing the flow.
  const remapped: AiPunchItem[] = [];
  for (const item of data.items) {
    if (item.photoIndex < 0 || item.photoIndex >= meta.originalIndexes.length) {
      console.warn('[photoAnalyzer] AI returned out-of-bounds photoIndex', {
        photoIndex: item.photoIndex,
        analyzed: meta.originalIndexes.length,
        description: item.description.slice(0, 60),
      });
      continue;
    }
    remapped.push({ ...item, photoIndex: meta.originalIndexes[item.photoIndex] });
  }
  return { items: remapped, meta };
}

export async function analyzePhotosForDfr(opts: BaseOpts): Promise<{ summary: AiDfrSummary; meta: AnalyzeMeta }> {
  const { data, meta } = await callAnalyzePhotos<AiDfrSummary>({ ...opts, task: 'dfr' });
  return { summary: data, meta };
}
