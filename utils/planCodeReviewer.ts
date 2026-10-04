// Use the legacy FileSystem surface — expo-file-system v19 moved
// cacheDirectory/downloadAsync/readAsStringAsync into the /legacy entry
// (matches utils/icsGenerator.ts, utils/dataExport.ts, utils/accountingExport.ts).
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { readAsBase64 } from '@/utils/platformFile';
import { supabase } from '@/lib/supabase';
import { readEdgeError } from '@/utils/edgeError';
import { requireAiConsent } from '@/utils/aiConsent';

export interface PlanCodeFindingRaw {
  category?: string;
  codeRef?: string;
  requirement?: string;
  observed?: string;
  severity?: string;
  confidence?: string;
  /** analyze-plan-code's split citation + the server-stamped evidence level
   *  (always 'model_recall'). An older deployment sends none of these. */
  citedEdition?: string | null;
  section?: string | null;
  evidence?: string;
  /** Plan Set Code Sweep only (a request with `sweep`): the question for the
   *  architect, and the approximate centre on the sheet (0–1). */
  question?: string | null;
  location?: { x: number; y: number } | null;
  /** Code cards (a sweep request with `codeCards: true`): 'fix' | 'ask' on a
   *  finding, 'ok' only on a `lookRight` row; the inspection stage is the AI's
   *  guess. An older function sends none of these. */
  status?: 'fix' | 'ask' | 'ok';
  stage?: string | null;
  stageIsGuess?: boolean;
}

/**
 * A refused or failed plan review, carrying the function's own `code`
 * (`monthly_cap_reached`, `hourly_limit`, `tier_required`, …) and its own
 * sentence (`reason`), so a caller can stop a loop on a cap without matching
 * English. `message` keeps the long-standing "Plan review call failed: …" text.
 */
export class PlanCodeError extends Error {
  constructor(message: string, readonly code: string, readonly reason: string) {
    super(message);
    this.name = 'PlanCodeError';
  }
}

export interface PlanCodeResult {
  findings: PlanCodeFindingRaw[];
  /** Code cards: rows the AI read as matching the drawing ("look right").
   *  Kept apart from `findings` on purpose: a look-right row is never an
   *  architect question, an RFI draft or a punch item. [] on an older function.
   *  Optional in the type so nothing that builds a result by hand has to change. */
  lookRight?: PlanCodeFindingRaw[];
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
  // Anything that is not a fetchable remote URL stops here. A bare storage PATH
  // is not one (DB-F11: an unsignable plan sheet reaches this function as
  // `<uuid>/sheet-page-1.png`), and downloadAsync on it throws.
  // The caller (app/(tabs)/construction-ai) surfaces this message in an alert,
  // so say what to do rather than letting downloadAsync throw "unable to
  // download <uuid>/sheet-page-1.png" at the user.
  if (!/^https?:\/\//i.test(uri)) {
    throw new Error('That plan sheet could not be opened — reconnect and reopen the plan, then try again.');
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
 * The function's own sentence for a failed invoke. Kept as a thin alias for the
 * existing import sites; the reader itself lives in utils/edgeError.ts (audit
 * #79 — one copy, because the Response body can be read only once).
 */
export async function edgeFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  return (await readEdgeError(error, fallback)).message;
}

export async function reviewPlanCode(opts: {
  imageBase64: string;
  mimeType: string;
  location?: string;
  projectType?: string;
  /** `JurisdictionGrounding.promptBlock` from utils/codeJurisdiction. Built on
   *  the client because that is where the adoption table lives; passed verbatim
   *  so the prompt and the grounding chip carry the same text. */
  jurisdictionBlock?: string;
  /** Plan Set Code Sweep only. Omitted by Plan Review, whose request body is
   *  then exactly what it always was. */
  sweep?: { scopeTargets: string[]; codeCards?: boolean };
}): Promise<PlanCodeResult> {
  // App Store 5.1.2(i): nothing leaves for the AI provider until the person
  // has allowed AI features (utils/aiConsent; always allowed on the web app).
  await requireAiConsent();
  const { data, error } = await supabase.functions.invoke<{
    success: boolean;
    data?: PlanCodeResult;
    error?: string;
    code?: string;
  }>('analyze-plan-code', { body: opts });
  if (error) {
    const info = await readEdgeError(error, 'request failed');
    throw new PlanCodeError(`Plan review call failed: ${info.message}`, info.code, info.message);
  }
  if (!data?.success || !data.data) {
    const reason = data?.error ?? 'Plan review returned an empty result.';
    throw new PlanCodeError(reason, typeof data?.code === 'string' ? data.code : '', reason);
  }
  return {
    findings: Array.isArray(data.data.findings) ? data.data.findings : [],
    lookRight: Array.isArray(data.data.lookRight) ? data.data.lookRight : [],
    disclaimer: data.data.disclaimer || PLAN_REVIEW_DISCLAIMER,
  };
}
