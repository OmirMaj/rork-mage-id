// utils/plans/askYourPlans.ts — orchestrates "ask your plans": index a project's
// plan sheets into project-memory (via plan-extract vision -> project-memory-embed),
// and answer a question (project-memory-search -> mageAI grounded answer). Cloud is
// the source of truth (per project); this only wires cloud calls.
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';
import { mageAI } from '@/utils/mageAI';
import { edgeFunctionErrorMessage } from '@/utils/planCodeReviewer';
import { sheetToDocs, PLAN_SOURCE, type ExtractedSheet } from './planChunk';
import { buildAskPrompt, citedSheetRefs, type PlanMatch } from './planAnswer';
import type { PlanSheet } from '@/types';

// Reuse the app's existing image→base64 pattern from utils/planCodeReviewer.ts
// (imageUriToBase64, lines 36-56). Handles data:, file://, /, and https:// URIs.
// Returns base64 without a data: prefix + the resolved mime type.
function mimeFromExt(uri: string): string {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  return 'image/jpeg';
}

async function imageToBase64(uri: string): Promise<{ b64: string; mime: string }> {
  if (!uri) return { b64: '', mime: 'image/jpeg' };

  // data: URI — strip the header, return the payload
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    if (comma < 0) return { b64: '', mime: 'image/jpeg' };
    const meta = uri.slice(5, comma); // e.g. "image/png;base64"
    const mime = meta.split(';')[0] || 'image/png';
    return { b64: uri.slice(comma + 1), mime };
  }

  // file:// or absolute path — read directly via FileSystem
  if (uri.startsWith('file:') || uri.startsWith('/')) {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    return { b64, mime: mimeFromExt(uri) };
  }

  // Remote https:// — download to cache, read, clean up
  const target = `${FileSystem.cacheDirectory}plan-extract-${Date.now()}`;
  const dl = await FileSystem.downloadAsync(uri, target);
  try {
    const b64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: 'base64' });
    return { b64, mime: mimeFromExt(uri) };
  } finally {
    void FileSystem.deleteAsync(dl.uri, { idempotent: true });
  }
}

/** Index (or re-index) a project's plan sheets. Extract text per sheet (vision),
 *  then embed as project-memory docs (source 'Plan Sheet'). Returns count embedded. */
export async function indexPlanSheets(projectId: string, sheets: PlanSheet[]): Promise<number> {
  const extracted: ExtractedSheet[] = [];
  for (const s of sheets) {
    const { b64, mime } = await imageToBase64(s.imageUri);
    if (!b64) continue;
    const { data, error } = await supabase.functions.invoke('plan-extract', {
      body: { imageBase64: b64, mimeType: mime, sheetNumber: s.sheetNumber },
    });
    if (error) {
      // Still skip the sheet (indexing is best-effort per sheet), but say WHY
      // with the function's own error code — tier gate, monthly cap, hourly
      // limit — instead of supabase-js's generic "non-2xx status code".
      console.warn(`[askYourPlans] plan-extract skipped sheet ${s.sheetNumber || s.name || s.id}: ${await edgeFunctionErrorMessage(error, 'request failed')}`);
      continue;
    }
    if (!data?.success || !data.text) continue;
    extracted.push({ sheetId: s.id, sheetNumber: s.sheetNumber || s.name || 'Sheet', text: data.text });
  }
  const docs = extracted.flatMap(sheetToDocs);
  if (!docs.length) return 0;
  const { data } = await supabase.functions.invoke('project-memory-embed', {
    body: { projectId, docs },
  });
  return data?.embedded ?? 0;
}

export interface PlanAnswer {
  answer: string;
  citations: { ref: string; sheetId: string }[];
  noneFound: boolean;
}

/** Answer a question about the project's plans. */
export async function askPlans(projectId: string, question: string): Promise<PlanAnswer> {
  const { data: sr } = await supabase.functions.invoke('project-memory-search', {
    body: { projectId, query: question, matchCount: 8 },
  });
  const matches: PlanMatch[] = (sr?.matches ?? []).filter((m: PlanMatch) => m.source === PLAN_SOURCE);
  const res = await mageAI({ prompt: buildAskPrompt(question, matches), tier: 'smart', maxTokens: 400, feature: 'planAsk' });
  // For non-schema mageAI calls the ai relay returns { data: rawText, raw: rawText }.
  // res.data holds the text string directly (not res.data?.text).
  const answer = (res.success ? (typeof res.data === 'string' ? res.data : res.raw ?? '') : '').trim()
    || "I couldn't reach the plan brain just now — try again.";
  const citations = citedSheetRefs(answer, matches);
  return { answer, citations, noneFound: matches.length === 0 };
}
