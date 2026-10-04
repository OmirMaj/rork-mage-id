// utils/askFiles.ts — the app's one door to the file-reading edge function.
//
// Ask MAGE sends the files in its composer plus a question (mode 'ask'); the
// portal sheet sends a client message's files by id (mode 'message'). The
// rules, limits and sentences are utils/askFilesCore.ts; this file only does
// the I/O. It is the ONLY app file that names the function.
//
// Order, pinned by scripts/validate-ask-files.ts: the feature flag, then the
// connection, then the AI consent gate, then the device files are read, then
// the request. With a flag off it answers 'feature_off' before the consent
// question, before any file is read and before any request.
//
// It never throws, and it writes nothing to a log: a file name, a question,
// an answer or an error from this path would ride to crash reports as a
// breadcrumb. An AI call is online only; it is never put on the offline queue.
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { PDFDocument } from 'pdf-lib';
import type {
  AskAttachedFile, AskFileRef, AskFilesRequest, AskFilesSuccess, MessageAttachmentMime,
} from '@/types';
import { ASK_FILES_ENABLED, PORTAL_MESSAGE_AI_ENABLED } from '@/constants/featureFlags';
import { isOfflineNow } from '@/hooks/useOnline';
import { ensureAiConsent, AI_CONSENT_DECLINED_CODE, AI_CONSENT_OFF_MESSAGE } from '@/utils/aiConsent';
import { readAsBase64 } from '@/utils/platformFile';
import { readFileBytes } from '@/utils/fileBytes';
import { invokeWithTimeout } from '@/utils/invokeWithTimeout';
import { edgeErrorStatus, edgeFunctionError } from '@/utils/edgeError';
import {
  ASK_CLIENT_TIMEOUT_MS, ASK_DEVICE_TOTAL_MAX_BYTES, ASK_MAX_FILES, ASK_QUESTION_MAX, decodedBase64Bytes,
} from '@/utils/askFilesCore';

export type AskSendFile =
  | { source: 'device'; name: string; mime: MessageAttachmentMime; localUri: string }
  | { source: 'plan'; name: string; storagePath: string }
  | { source: 'message'; messageId: string; attachmentId: string };

export interface AskFilesInput { feature: 'ask' | 'portal'; files: AskSendFile[]; question?: string }
export type AskFilesOutcome =
  | { ok: true; data: AskFilesSuccess }
  | { ok: false; code: string; message: string; fileIndex?: number; pages?: number; limit?: number };

/** invokeWithTimeout's own sentence when its timer fired (utils/invokeWithTimeout.ts). */
const TIMEOUT_START = 'Took too long';

/** A refusal the gateway wrote itself (no `code` of ours in the body), by status. */
const STATUS_CODE: Readonly<Record<string, string>> = {
  http_401: 'unauthenticated',
  http_413: 'body_too_large',
  http_504: 'upstream_timeout',
};

const fail = (code: string, extra?: { message?: string; fileIndex?: number; pages?: number; limit?: number }): AskFilesOutcome => ({
  ok: false, code, message: extra?.message ?? '',
  ...(typeof extra?.fileIndex === 'number' ? { fileIndex: extra.fileIndex } : {}),
  ...(typeof extra?.pages === 'number' ? { pages: extra.pages } : {}),
  ...(typeof extra?.limit === 'number' ? { limit: extra.limit } : {}),
});

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Is this the success body the mode we sent is answered with? */
function isSuccess(data: unknown, mode: 'ask' | 'message'): data is AskFilesSuccess {
  const d = data as Record<string, unknown> | null;
  if (!d || d.success !== true || d.mode !== mode || !Array.isArray(d.read)) return false;
  return mode === 'ask' ? typeof d.answer === 'string' : typeof d.summary === 'string' && Array.isArray(d.asks);
}

export async function askFiles(input: AskFilesInput): Promise<AskFilesOutcome> {
  try {
    // 1. The flag. Nothing below runs while it is off.
    const on = input.feature === 'ask' ? ASK_FILES_ENABLED : PORTAL_MESSAGE_AI_ENABLED;
    if (!on) return { ok: false, code: 'feature_off', message: '' };
    const mode: 'ask' | 'message' = input.feature === 'ask' ? 'ask' : 'message';

    // 2. Online only.
    if (isOfflineNow()) return { ok: false, code: 'offline', message: '' };

    // 3. The AI consent gate (asks once on a phone).
    if (!(await ensureAiConsent())) return { ok: false, code: AI_CONSENT_DECLINED_CODE, message: AI_CONSENT_OFF_MESSAGE };

    // 4. The request, as the server takes it. Device files are read here.
    const sent = Array.isArray(input.files) ? input.files : [];
    if (sent.length === 0) return fail('bad_request');
    if (sent.length > ASK_MAX_FILES) return fail('too_many_files');
    const question = typeof input.question === 'string' ? input.question.trim() : '';
    if (mode === 'ask' && (question.length < 1 || question.length > ASK_QUESTION_MAX)) return fail('bad_request');
    const files: AskFileRef[] = [];
    let deviceBytes = 0;
    for (let i = 0; i < sent.length; i++) {
      const f = sent[i];
      if (f.source === 'message') {
        if (mode !== 'message') return fail('bad_request');
        files.push({ source: 'message', messageId: f.messageId, attachmentId: f.attachmentId });
        continue;
      }
      if (mode !== 'ask') return fail('bad_request');
      if (f.source === 'plan') {
        files.push({ source: 'plan', storagePath: f.storagePath, name: f.name });
        continue;
      }
      let base64 = '';
      try {
        base64 = await readAsBase64(f.localUri);
      } catch {
        return fail('unreadable_file', { fileIndex: i });
      }
      const bytes = typeof base64 === 'string' ? decodedBase64Bytes(base64) : 0;
      if (bytes <= 0) return fail('unreadable_file', { fileIndex: i });
      deviceBytes += bytes;
      // Measured on the bytes: a picker that gave no size was let through.
      if (deviceBytes > ASK_DEVICE_TOTAL_MAX_BYTES) return fail('files_too_large', { limit: ASK_DEVICE_TOTAL_MAX_BYTES });
      files.push({ source: 'inline', name: f.name, mime: f.mime, base64 });
    }
    const body: AskFilesRequest = mode === 'ask' ? { mode: 'ask', files, question } : { mode: 'message', files };

    // 5. The call.
    const { data, error } = await invokeWithTimeout<unknown>('ask-files', { body, timeoutMs: ASK_CLIENT_TIMEOUT_MS });

    // 6. What came back.
    if (error) {
      if (edgeErrorStatus(error) === null) {
        return fail(typeof error.message === 'string' && error.message.startsWith(TIMEOUT_START) ? 'client_timeout' : 'network');
      }
      const e = await edgeFunctionError(error, '');
      const code = STATUS_CODE[e.code] ?? e.code;
      // Only these two carry the server's own sentence (with the local reset time).
      const message = code === 'monthly_cap_reached' || code === 'hourly_limit' ? e.message : '';
      return fail(code || 'internal', { message });
    }
    if (isSuccess(data, mode)) return { ok: true, data };
    const refusal = data as { success?: unknown; code?: unknown; fileIndex?: unknown; pages?: unknown; limit?: unknown } | null;
    if (refusal && refusal.success === false && typeof refusal.code === 'string' && refusal.code) {
      return fail(refusal.code, { fileIndex: num(refusal.fileIndex), pages: num(refusal.pages), limit: num(refusal.limit) });
    }
    return fail('internal');
  } catch {
    return fail('internal');
  }
}

/**
 * How many pages a PDF on this device has, or null when it will not open (a
 * password counts as will not open: the server cannot read it either).
 */
export async function countAskPdfPages(localUri: string): Promise<number | null> {
  try {
    const bytes = await readFileBytes(localUri);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return null;
  }
}

/**
 * Let go of a picked file's local copy: the cache copy the picker made on a
 * phone, the object URL on the web. A plan page has no local copy. Never throws.
 */
export function releaseAskFile(file: AskAttachedFile): void {
  try {
    if (!file || file.source !== 'device' || typeof file.localUri !== 'string' || !file.localUri) return;
    const uri = file.localUri;
    if (Platform.OS === 'web') {
      if (uri.startsWith('blob:') && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(uri);
      }
      return;
    }
    const cache = FileSystem.cacheDirectory;
    if (typeof cache === 'string' && cache && uri.startsWith(cache)) {
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
    }
  } catch {
    // Nothing to do: the system clears its cache folder on its own.
  }
}
