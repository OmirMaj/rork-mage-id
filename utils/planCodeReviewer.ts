// Use the legacy FileSystem surface — expo-file-system v19 moved
// cacheDirectory/downloadAsync/readAsStringAsync into the /legacy entry
// (matches utils/icsGenerator.ts, utils/dataExport.ts, utils/accountingExport.ts).
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { readAsBase64 } from '@/utils/platformFile';
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
  // blob: is what the web picker produces; readAsBase64 handles all three.
  if (uri.startsWith('file:') || uri.startsWith('/') || uri.startsWith('blob:')) {
    return { base64: await readAsBase64(uri), mimeType: mimeFromExt(uri) };
  }
  // remote http(s). On web there is no cache directory to download INTO, but
  // fetch can read the URL directly — so skip the download-then-read dance
  // entirely. Previously `${undefined}plan-review-...` produced a garbage path
  // and every plan sheet threw, killing AI code review and plan indexing.
  if (Platform.OS === 'web') {
    return { base64: await readAsBase64(uri), mimeType: mimeFromExt(uri) };
  }
  const target = `${FileSystem.cacheDirectory}plan-review-${Date.now()}`;
  const dl = await FileSystem.downloadAsync(uri, target);
  try {
    const base64 = await FileSystem.readAsStringAsync(dl.uri, { encoding: 'base64' });
    return { base64, mimeType: mimeFromExt(uri) };
  } finally {
    void FileSystem.deleteAsync(dl.uri, { idempotent: true });
  }
}

/**
 * supabase-js collapses every non-2xx into "Edge Function returned a non-2xx
 * status code"; the real reason — `unauthorized`, `cap_reached`, `rate_limited`,
 * a tier gate — is the JSON `error` (or `code`) the function wrote, hanging off
 * `error.context` (a Response). Read it best-effort: a non-JSON body degrades to
 * the HTTP status, and no context at all degrades to the error's own message.
 * Same idea as serverErrorMessage() in utils/invoiceReminders.ts.
 */
export async function edgeFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const err = error as { message?: unknown; context?: { status?: unknown; json?: () => Promise<unknown> } } | null;
  const ctx = err?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json() as { error?: unknown; code?: unknown } | null;
      const text = typeof body?.error === 'string' && body.error.trim()
        ? body.error.trim()
        : typeof body?.code === 'string' && body.code.trim() ? body.code.trim() : null;
      if (text) return text;
    } catch {
      // Body was not JSON (or already consumed) — fall through to the status.
    }
    if (typeof ctx.status === 'number' && ctx.status > 0) return `${fallback} (HTTP ${ctx.status})`;
  }
  return typeof err?.message === 'string' && err.message.trim() ? err.message : fallback;
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
  if (error) throw new Error(`Plan review call failed: ${await edgeFunctionErrorMessage(error, 'request failed')}`);
  if (!data?.success || !data.data) throw new Error(data?.error ?? 'Plan review returned an empty result.');
  return {
    findings: Array.isArray(data.data.findings) ? data.data.findings : [],
    disclaimer: data.data.disclaimer || PLAN_REVIEW_DISCLAIMER,
  };
}
