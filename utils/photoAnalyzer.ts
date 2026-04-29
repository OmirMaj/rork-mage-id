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
 * entire batch — we proceed with the photos that succeeded and
 * surface the failed count to the caller for context.
 *
 * Returns the encoded list AND the indexes of any inputs that
 * failed, so the caller can warn the user.
 */
async function encodeLocalPhotos(uris: string[]): Promise<{ encoded: InlinePhoto[]; failedIndexes: number[] }> {
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
  const failedIndexes: number[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') encoded.push(r.value);
    else failedIndexes.push(i);
  });
  return { encoded, failedIndexes };
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
 */
async function callAnalyzePhotos<T>(opts: BaseOpts & { task: 'punch' | 'dfr' }, attempt = 0): Promise<T> {
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

  if (localUris.length > 0) {
    const { encoded, failedIndexes } = await encodeLocalPhotos(localUris);
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
  } else {
    payload.photoUrls = remoteUris;
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
  return data.data;
}

export async function analyzePhotosForPunch(opts: BaseOpts): Promise<{ items: AiPunchItem[] }> {
  return callAnalyzePhotos<{ items: AiPunchItem[] }>({ ...opts, task: 'punch' });
}

export async function analyzePhotosForDfr(opts: BaseOpts): Promise<AiDfrSummary> {
  return callAnalyzePhotos<AiDfrSummary>({ ...opts, task: 'dfr' });
}
