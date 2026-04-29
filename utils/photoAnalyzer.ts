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
// Callers should down-sample the photo list to the most informative
// 6-8 frames before invoking — vision tokens are not cheap.

import { supabase } from '@/lib/supabase';
import * as FileSystem from 'expo-file-system';

export interface AiPunchItem {
  description: string;
  /** Title-case location ("Master Bath"). May be empty if unclear. */
  location: string;
  /** Free-text trade — caller maps to its own enum (see
   *  app/punch-walk.tsx aiTradeToSubTrade). */
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
  /** Mixed: each entry can be a remote URL (server fetches) or a
   *  local file:// URI (we base64-encode client-side and send inline).
   *  The edge function accepts either path. */
  photoUrls: string[];
  projectName?: string;
  projectType?: string;
  notes?: string;
}

interface InlinePhoto { base64: string; mimeType?: string }

/**
 * Split a list of mixed URIs into:
 *   - inline photos (file:// URIs we base64 client-side)
 *   - URL photos (https URLs the server fetches itself)
 * Server can't reach file:// URIs because they live on the device.
 * Mixing the two paths in one call wouldn't preserve photoIndex
 * cleanly, so callers should use one or the other — we pick the
 * dominant kind here.
 */
async function partitionAndEncode(uris: string[]): Promise<{ inline?: InlinePhoto[]; urls?: string[] }> {
  const isLocal = (u: string) => u.startsWith('file:') || u.startsWith('/');
  const localCount = uris.filter(isLocal).length;
  // If any URI is local, base64-encode them all so the photoIndex
  // returned by Gemini lines up with the input array. Otherwise send
  // URLs and let the server fetch them.
  if (localCount === 0) return { urls: uris };

  const inline: InlinePhoto[] = [];
  for (const u of uris) {
    if (isLocal(u)) {
      // Pass string-literal 'base64' rather than the enum — expo-file-system
      // moved EncodingType into a legacy namespace in newer versions, and the
      // string form is accepted by the typed signature regardless.
      const base64 = await FileSystem.readAsStringAsync(u, { encoding: 'base64' });
      // Cheap MIME inference from extension. Gemini accepts most.
      const ext = u.split('.').pop()?.toLowerCase() ?? '';
      const mimeType = ext === 'png' ? 'image/png' : ext === 'heic' ? 'image/heic' : 'image/jpeg';
      inline.push({ base64, mimeType });
    } else {
      // Fetch + base64 the remote one too so all entries are inline
      // and indices are stable.
      const resp = await fetch(u);
      const blob = await resp.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          // strip "data:image/jpeg;base64," prefix
          const idx = dataUrl.indexOf(',');
          resolve(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
        };
        reader.onerror = () => reject(new Error('Failed to read blob'));
        reader.readAsDataURL(blob);
      });
      inline.push({ base64, mimeType: blob.type || 'image/jpeg' });
    }
  }
  return { inline };
}

async function callAnalyzePhotos<T>(opts: BaseOpts & { task: 'punch' | 'dfr' }): Promise<T> {
  if (!opts.photoUrls || opts.photoUrls.length === 0) {
    throw new Error('No photos to analyze.');
  }
  if (opts.photoUrls.length > 12) {
    throw new Error('Max 12 photos per call.');
  }
  const partitioned = await partitionAndEncode(opts.photoUrls);
  const payload: Record<string, unknown> = {
    task: opts.task,
    projectName: opts.projectName,
    projectType: opts.projectType,
    notes: opts.notes,
  };
  if (partitioned.inline) payload.photos = partitioned.inline;
  if (partitioned.urls) payload.photoUrls = partitioned.urls;

  const { data, error } = await supabase.functions.invoke<{ success: boolean; data?: T; error?: string }>(
    'analyze-photos',
    { body: payload },
  );
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
