// Use the legacy FileSystem surface — expo-file-system v19 moved
// cacheDirectory/downloadAsync/readAsStringAsync into the /legacy entry
// (matches utils/icsGenerator.ts, utils/dataExport.ts, utils/accountingExport.ts).
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/lib/supabase';

export interface PlanCodeFindingRaw {
  category?: string;
  codeRef?: string;
  requirement?: string;
  observed?: string;
  severity?: string;
  confidence?: string;
}

export interface PlanCodeResult {
  findings: PlanCodeFindingRaw[];
  disclaimer: string;
}

export const PLAN_REVIEW_DISCLAIMER =
  'AI pre-check — verify each finding against your local code official. Not a substitute for plan review.';

function mimeFromExt(uri: string): string {
  const ext = uri.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  return 'image/jpeg';
}

/**
 * Convert a PlanSheet image URI (data:, file://, /, or https://) to base64 + mime.
 * Local files are read directly; remote files are downloaded to cache then read.
 */
export async function imageUriToBase64(uri: string): Promise<{ base64: string; mimeType: string }> {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',');
    const meta = uri.slice(5, comma); // e.g. "image/png;base64"
    const mimeType = meta.split(';')[0] || 'image/png';
    return { base64: uri.slice(comma + 1), mimeType };
  }
  if (uri.startsWith('file:') || uri.startsWith('/')) {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    return { base64, mimeType: mimeFromExt(uri) };
  }
  // remote http(s): download to cache, read, clean up
  const target = `${FileSystem.cacheDirectory}plan-review-${Date.now()}`;
  const dl = await FileSystem.downloadAsync(uri, target);
  try {
    const base64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: 'base64' });
    return { base64, mimeType: mimeFromExt(uri) };
  } finally {
    void FileSystem.deleteAsync(dl.uri, { idempotent: true });
  }
}

export async function reviewPlanCode(opts: {
  imageBase64: string;
  mimeType: string;
  location?: string;
  projectType?: string;
}): Promise<PlanCodeResult> {
  const { data, error } = await supabase.functions.invoke<{
    success: boolean;
    data?: PlanCodeResult;
    error?: string;
  }>('analyze-plan-code', { body: opts });
  if (error) throw new Error(`Plan review call failed: ${error.message}`);
  if (!data?.success || !data.data) throw new Error(data?.error ?? 'Plan review returned an empty result.');
  return {
    findings: Array.isArray(data.data.findings) ? data.data.findings : [],
    disclaimer: data.data.disclaimer || PLAN_REVIEW_DISCLAIMER,
  };
}
