/**
 * utils/askFiles.ts — the app's one door to the file-reading edge function
 * (lane ATTASK; shared by Ask MAGE and the portal sheet).
 *
 * THE PROMISES THIS PROVES
 *   1. DARK. With the real flags, askFiles answers 'feature_off' for both
 *      features, and neither the consent question nor a request happens.
 *   2. With the flags on (mocked): offline is refused before the consent gate;
 *      a consent no answers the gate's own code and sentence and nothing is
 *      sent; a device file that cannot be read names its index; the decoded
 *      total one byte over the limit is refused before the request; a success
 *      sends EXACTLY the contract body (no extra key) for each mode; a 200
 *      refusal keeps fileIndex / pages / limit; the monthly cap and the hourly
 *      limit carry the server's sentence and nothing else does; 401 / 403 /
 *      502 give their codes; the timeout and a network failure are told apart.
 *   3. WEB. The real consent gate with a stored no and a web host answers yes:
 *      today's rule for every AI button on the web (PLAN section 9, decision 4).
 *   4. countAskPdfPages counts a real PDF, and answers null for an encrypted
 *      one and for garbage (never a page count for a locked file).
 *   5. releaseAskFile deletes a cache copy, leaves any other file alone,
 *      revokes a blob URL on the web, and does nothing for a plan page.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { PDFDocument } from 'pdf-lib';
import type { AskAttachedFile } from '@/types';
import { askFiles, countAskPdfPages, releaseAskFile } from '@/utils/askFiles';
import { ASK_CLIENT_TIMEOUT_MS, ASK_DEVICE_TOTAL_MAX_BYTES } from '@/utils/askFilesCore';
import { ensureAiConsent, AI_CONSENT_DECLINED_CODE, AI_CONSENT_OFF_MESSAGE } from '@/utils/aiConsent';
import { createAiConsentGate, AI_CONSENT_STORAGE_KEY } from '@/utils/aiConsentCore';
import { isOfflineNow } from '@/hooks/useOnline';
import { readAsBase64 } from '@/utils/platformFile';
import { readFileBytes } from '@/utils/fileBytes';
import { invokeWithTimeout } from '@/utils/invokeWithTimeout';

// The flags read through a getter: off = the REAL value in the source (false),
// on = true. A factory that returned only the two new flags would blank the
// others.
let mockFlagsOn = false;
jest.mock('@/constants/featureFlags', () => {
  const actual = jest.requireActual('@/constants/featureFlags');
  // defineProperty, not a getter in the literal: babel's object spread copies
  // a literal's getters by VALUE, which would freeze both flags at false.
  const mod = { ...actual };
  Object.defineProperty(mod, 'ASK_FILES_ENABLED', {
    enumerable: true, get: () => (mockFlagsOn ? true : actual.ASK_FILES_ENABLED),
  });
  Object.defineProperty(mod, 'PORTAL_MESSAGE_AI_ENABLED', {
    enumerable: true, get: () => (mockFlagsOn ? true : actual.PORTAL_MESSAGE_AI_ENABLED),
  });
  return mod;
});
jest.mock('@/utils/aiConsent', () => ({
  ...jest.requireActual('@/utils/aiConsent'),
  ensureAiConsent: jest.fn(async () => true),
}));
jest.mock('@/hooks/useOnline', () => ({
  ...jest.requireActual('@/hooks/useOnline'),
  isOfflineNow: jest.fn(() => false),
}));
jest.mock('@/utils/platformFile', () => ({
  ...jest.requireActual('@/utils/platformFile'),
  readAsBase64: jest.fn(async () => 'QUJD'),
}));
jest.mock('@/utils/fileBytes', () => ({
  ...jest.requireActual('@/utils/fileBytes'),
  readFileBytes: jest.fn(async () => new Uint8Array()),
}));
jest.mock('@/utils/invokeWithTimeout', () => ({
  invokeWithTimeout: jest.fn(async () => ({ data: null, error: null })),
}));

const consent = ensureAiConsent as jest.Mock;
const offline = isOfflineNow as jest.Mock;
const readB64 = readAsBase64 as jest.Mock;
const readBytes = readFileBytes as jest.Mock;
const invoke = invokeWithTimeout as jest.Mock;

const PROJECT = '3f2b8c1e-9d4a-4b6f-8a21-5c7e9f0a1b2c';
const MESSAGE = '5b8d2f4a-6c1e-4d3b-9a7f-2e0c4b6d8f1a';
const ATTACHMENT = '7a1c5e9b-2d4f-4a6b-9c8d-0e1f2a3b4c5d';
const photo = { source: 'device' as const, name: 'crack.jpg', mime: 'image/jpeg' as const, localUri: 'file:///smoke-test/cache/ImagePicker/crack.jpg' };
const pdf = { source: 'device' as const, name: 'spec.pdf', mime: 'application/pdf' as const, localUri: 'file:///smoke-test/cache/DocumentPicker/spec.pdf' };
const plan = { source: 'plan' as const, name: 'A-101 Floor plan', storagePath: `${PROJECT}/sheet-page-1.png` };
const msgFile = { source: 'message' as const, messageId: MESSAGE, attachmentId: ATTACHMENT };

const askSuccess = {
  success: true, mode: 'ask', answer: 'The photo shows a crack at the corner.', truncated: false,
  read: [{ index: 0, name: 'crack.jpg', kind: 'image' }], usage: { used: 3, cap: 50 },
};
const messageSuccess = {
  success: true, mode: 'message', summary: 'The client sent one photo.', asks: ['Move the outlet'],
  draft: { title: 'Move outlet', description: 'Client asks to move the outlet.' }, truncated: false,
  read: [{ index: 0, name: 'photo.jpg', kind: 'image' }], usage: { used: 4, cap: 50 },
};

/** A supabase-js FunctionsHttpError as invokeWithTimeout hands it back. */
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => body } },
});

beforeEach(() => {
  mockFlagsOn = false;
  consent.mockReset().mockResolvedValue(true);
  offline.mockReset().mockReturnValue(false);
  readB64.mockReset().mockResolvedValue('QUJD');
  readBytes.mockReset().mockResolvedValue(new Uint8Array());
  invoke.mockReset().mockResolvedValue({ data: askSuccess, error: null });
});

describe('askFiles with the real flags (dark)', () => {
  it("answers feature_off for 'ask' and for 'portal'; no consent question, no file read, no request", async () => {
    expect(await askFiles({ feature: 'ask', files: [photo], question: 'What is this?' }))
      .toEqual({ ok: false, code: 'feature_off', message: '' });
    expect(await askFiles({ feature: 'portal', files: [msgFile] }))
      .toEqual({ ok: false, code: 'feature_off', message: '' });
    expect(offline).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
    expect(readB64).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('askFiles with the flags on (mocked)', () => {
  beforeEach(() => { mockFlagsOn = true; });

  it('offline: refused before the consent question, nothing read, nothing sent', async () => {
    offline.mockReturnValue(true);
    expect(await askFiles({ feature: 'ask', files: [photo], question: 'q' })).toEqual({ ok: false, code: 'offline', message: '' });
    expect(consent).not.toHaveBeenCalled();
    expect(readB64).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a consent no: the gate's code and sentence, and the request is never made (both features)", async () => {
    consent.mockResolvedValue(false);
    expect(await askFiles({ feature: 'ask', files: [photo], question: 'q' }))
      .toEqual({ ok: false, code: AI_CONSENT_DECLINED_CODE, message: AI_CONSENT_OFF_MESSAGE });
    expect(await askFiles({ feature: 'portal', files: [msgFile] }))
      .toEqual({ ok: false, code: AI_CONSENT_DECLINED_CODE, message: AI_CONSENT_OFF_MESSAGE });
    expect(AI_CONSENT_OFF_MESSAGE).toBe('AI features are off. Turn them on in Settings → AI features.');
    expect(readB64).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a device file that cannot be read: unreadable_file with its index, nothing sent', async () => {
    readB64.mockResolvedValueOnce('QUJD').mockRejectedValueOnce(new Error('gone'));
    expect(await askFiles({ feature: 'ask', files: [photo, pdf], question: 'q' }))
      .toEqual({ ok: false, code: 'unreadable_file', message: '', fileIndex: 1 });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('an empty device file is unreadable_file with its index', async () => {
    readB64.mockResolvedValueOnce('');
    expect(await askFiles({ feature: 'ask', files: [photo], question: 'q' }))
      .toEqual({ ok: false, code: 'unreadable_file', message: '', fileIndex: 0 });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('the decoded total exactly at the limit is sent; one byte over is files_too_large and nothing is sent', async () => {
    // 6,291,456 bytes = 8,388,608 base64 characters; one more byte = 4 more characters, two of them padding.
    const atLimit = 'A'.repeat((ASK_DEVICE_TOTAL_MAX_BYTES / 3) * 4);
    readB64.mockResolvedValueOnce(atLimit);
    expect((await askFiles({ feature: 'ask', files: [photo], question: 'q' })).ok).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);

    invoke.mockClear();
    readB64.mockResolvedValueOnce(atLimit).mockResolvedValueOnce('QQ==');
    expect(await askFiles({ feature: 'ask', files: [photo, pdf], question: 'q' }))
      .toEqual({ ok: false, code: 'files_too_large', message: '', limit: ASK_DEVICE_TOTAL_MAX_BYTES });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("mode 'ask': sends exactly { mode, files, question } with inline and plan files, through the 140 s timeout", async () => {
    readB64.mockResolvedValueOnce('QUJD');
    const out = await askFiles({ feature: 'ask', files: [photo, plan], question: '  What does this show?  ' });
    expect(out).toEqual({ ok: true, data: askSuccess });
    expect(invoke).toHaveBeenCalledTimes(1);
    const [fn, opts] = invoke.mock.calls[0];
    expect(fn).toBe('ask-files');
    expect(opts).toEqual({
      body: {
        mode: 'ask',
        files: [
          { source: 'inline', name: 'crack.jpg', mime: 'image/jpeg', base64: 'QUJD' },
          { source: 'plan', storagePath: `${PROJECT}/sheet-page-1.png`, name: 'A-101 Floor plan' },
        ],
        question: 'What does this show?',
      },
      timeoutMs: ASK_CLIENT_TIMEOUT_MS,
    });
    expect(Object.keys(opts.body).sort()).toEqual(['files', 'mode', 'question']);
    expect(ASK_CLIENT_TIMEOUT_MS).toBe(140000);
    // The device file was read from where the picker left it; the plan page was not read on the phone.
    expect(readB64.mock.calls).toEqual([[photo.localUri]]);
    // No local location rides along.
    expect(JSON.stringify(opts.body)).not.toContain('file://');
  });

  it("mode 'message': sends exactly { mode, files } with the two ids per file, and no question", async () => {
    invoke.mockResolvedValue({ data: messageSuccess, error: null });
    const out = await askFiles({ feature: 'portal', files: [msgFile], question: 'ignored' });
    expect(out).toEqual({ ok: true, data: messageSuccess });
    const [fn, opts] = invoke.mock.calls[0];
    expect(fn).toBe('ask-files');
    expect(opts.body).toEqual({ mode: 'message', files: [{ source: 'message', messageId: MESSAGE, attachmentId: ATTACHMENT }] });
    expect(Object.keys(opts.body).sort()).toEqual(['files', 'mode']);
    expect(Object.keys(opts.body.files[0]).sort()).toEqual(['attachmentId', 'messageId', 'source']);
    expect(readB64).not.toHaveBeenCalled();
  });

  it('a mixed-up request is refused on the phone: a message file in Ask, a device file in the portal, no files, five files, no question', async () => {
    expect(await askFiles({ feature: 'ask', files: [msgFile], question: 'q' })).toEqual({ ok: false, code: 'bad_request', message: '' });
    expect(await askFiles({ feature: 'portal', files: [photo] })).toEqual({ ok: false, code: 'bad_request', message: '' });
    expect(await askFiles({ feature: 'ask', files: [], question: 'q' })).toEqual({ ok: false, code: 'bad_request', message: '' });
    expect(await askFiles({ feature: 'ask', files: [plan, plan, plan, plan, plan], question: 'q' })).toEqual({ ok: false, code: 'too_many_files', message: '' });
    expect(await askFiles({ feature: 'ask', files: [plan], question: '   ' })).toEqual({ ok: false, code: 'bad_request', message: '' });
    expect(await askFiles({ feature: 'ask', files: [plan], question: 'x'.repeat(2001) })).toEqual({ ok: false, code: 'bad_request', message: '' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('a 200 refusal keeps its code, fileIndex, pages and limit, and carries no sentence', async () => {
    invoke.mockResolvedValue({
      data: { success: false, code: 'too_many_pages', error: 'That PDF has 31 pages.', fileIndex: 1, pages: 31, limit: 20 },
      error: null,
    });
    expect(await askFiles({ feature: 'ask', files: [photo, pdf], question: 'q' }))
      .toEqual({ ok: false, code: 'too_many_pages', message: '', fileIndex: 1, pages: 31, limit: 20 });

    invoke.mockResolvedValue({ data: { success: false, code: 'blocked', error: 'Declined.' }, error: null });
    expect(await askFiles({ feature: 'ask', files: [photo], question: 'q' })).toEqual({ ok: false, code: 'blocked', message: '' });
  });

  it("429 monthly cap: the server's sentence comes back in message", async () => {
    invoke.mockResolvedValue(httpError(429, { success: false, error: "You've used all 50 photo analyses this month.", code: 'monthly_cap_reached', used: 50, cap: 50 }));
    const out = await askFiles({ feature: 'ask', files: [plan], question: 'q' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('monthly_cap_reached');
    expect(out.message).toContain("You've used all 50 photo analyses this month.");
  });

  it("429 hourly limit: the server's sentence comes back in message", async () => {
    invoke.mockResolvedValue(httpError(429, { success: false, error: 'You have reached the hourly limit. Try again in an hour.', code: 'hourly_limit' }));
    expect(await askFiles({ feature: 'ask', files: [plan], question: 'q' }))
      .toEqual({ ok: false, code: 'hourly_limit', message: 'You have reached the hourly limit. Try again in an hour.' });
  });

  it('401, 403 tier, 403 file_unavailable, 502 no_answer: the code, and never the server text', async () => {
    const cases: [number, string][] = [
      [401, 'unauthenticated'], [403, 'tier_required'], [403, 'file_unavailable'], [502, 'no_answer'],
      [503, 'feature_off'], [413, 'body_too_large'], [504, 'upstream_timeout'], [403, 'account_ai_off'], [403, 'before_notice'],
    ];
    for (const [status, code] of cases) {
      invoke.mockResolvedValue(httpError(status, { success: false, error: `server text for ${code}`, code }));
      expect(await askFiles({ feature: 'ask', files: [plan], question: 'q' })).toEqual({ ok: false, code, message: '' });
    }
  });

  it("a 401 the gateway wrote itself (no code of ours in the body) is 'unauthenticated'", async () => {
    invoke.mockResolvedValue(httpError(401, { code: 401, message: 'Invalid JWT' }));
    expect(await askFiles({ feature: 'ask', files: [plan], question: 'q' })).toEqual({ ok: false, code: 'unauthenticated', message: '' });
  });

  it('the timeout is client_timeout; any other failure with no HTTP status is network', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'Took too long — try again.' } });
    expect(await askFiles({ feature: 'ask', files: [plan], question: 'q' })).toEqual({ ok: false, code: 'client_timeout', message: '' });
    invoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request to the Edge Function' } });
    expect(await askFiles({ feature: 'ask', files: [plan], question: 'q' })).toEqual({ ok: false, code: 'network', message: '' });
  });

  it('never throws: a call that rejects, or a body that is not the contract, answers internal', async () => {
    invoke.mockRejectedValue(new Error('boom'));
    expect(await askFiles({ feature: 'ask', files: [plan], question: 'q' })).toEqual({ ok: false, code: 'internal', message: '' });
    invoke.mockResolvedValue({ data: { success: true, mode: 'message', summary: 'wrong mode', asks: [], read: [] }, error: null });
    expect(await askFiles({ feature: 'ask', files: [plan], question: 'q' })).toEqual({ ok: false, code: 'internal', message: '' });
    invoke.mockResolvedValue({ data: 'not an object', error: null });
    expect(await askFiles({ feature: 'ask', files: [plan], question: 'q' })).toEqual({ ok: false, code: 'internal', message: '' });
    consent.mockRejectedValue(new Error('storage'));
    expect(await askFiles({ feature: 'ask', files: [plan], question: 'q' })).toEqual({ ok: false, code: 'internal', message: '' });
  });
});

describe('the consent gate on the web app', () => {
  const storageWith = (answer: string | null) => ({
    getItem: jest.fn(async (k: string) => (k === AI_CONSENT_STORAGE_KEY ? answer : null)),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  });

  it("on the web app a stored no is not honored (today's rule; PLAN section 9, decision 4)", async () => {
    const prompt = jest.fn(async () => false);
    const web = createAiConsentGate({ storage: storageWith('declined') });
    web.setHost({ isWeb: true, prompt });
    expect(await web.ensure()).toBe(true);
    expect(prompt).not.toHaveBeenCalled();

    // Control: the same stored no on a phone refuses, and nobody is asked again.
    const phone = createAiConsentGate({ storage: storageWith('declined') });
    phone.setHost({ isWeb: false, prompt });
    expect(await phone.ensure()).toBe(false);
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('countAskPdfPages', () => {
  async function pdfWithPages(n: number): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < n; i++) doc.addPage([200, 200]);
    return doc.save({ useObjectStreams: false });
  }

  it('a 3-page PDF returns 3', async () => {
    readBytes.mockResolvedValue(await pdfWithPages(3));
    expect(await countAskPdfPages('file:///smoke-test/cache/three.pdf')).toBe(3);
    expect(readBytes).toHaveBeenCalledWith('file:///smoke-test/cache/three.pdf');
  });

  it('a PDF whose trailer carries an /Encrypt entry returns null (a locked file never gets a page count)', async () => {
    const plain = Buffer.from(await pdfWithPages(2)).toString('latin1');
    // The classic trailer: add an /Encrypt reference to it.
    expect(plain).toContain('trailer');
    const locked = plain.replace(/trailer\s*<</, (m) => `${m} /Encrypt 1 0 R`);
    expect(locked).not.toBe(plain);
    readBytes.mockResolvedValue(new Uint8Array(Buffer.from(locked, 'latin1')));
    expect(await countAskPdfPages('file:///smoke-test/cache/locked.pdf')).toBeNull();
    // Control: the same bytes without the entry count.
    readBytes.mockResolvedValue(new Uint8Array(Buffer.from(plain, 'latin1')));
    expect(await countAskPdfPages('file:///smoke-test/cache/plain.pdf')).toBe(2);
  });

  it('garbage bytes return null, and so does a file that cannot be read', async () => {
    readBytes.mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(await countAskPdfPages('file:///smoke-test/cache/garbage.pdf')).toBeNull();
    readBytes.mockRejectedValue(new Error('gone'));
    expect(await countAskPdfPages('file:///smoke-test/cache/missing.pdf')).toBeNull();
  });
});

describe('releaseAskFile', () => {
  const del = FileSystem.deleteAsync as unknown as jest.Mock;
  const cache = FileSystem.cacheDirectory as string;
  const device = (localUri: string): AskAttachedFile =>
    ({ id: 'a', source: 'device', name: 'a.jpg', mime: 'image/jpeg', size: 10, localUri });
  let restoreOS: (() => void) | null = null;

  beforeEach(() => { del.mockClear(); del.mockResolvedValue(undefined); });
  afterEach(() => { restoreOS?.(); restoreOS = null; });

  it('a URI under the cache folder is deleted (idempotent)', () => {
    expect(cache).toBeTruthy();
    releaseAskFile(device(`${cache}ImagePicker/a.jpg`));
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(`${cache}ImagePicker/a.jpg`, { idempotent: true });
  });

  it('a URI outside the cache folder is left alone', () => {
    releaseAskFile(device('file:///smoke-test/documents/keep.jpg'));
    releaseAskFile(device('ph://ABC-123/L0/001'));
    expect(del).not.toHaveBeenCalled();
  });

  it('a delete that fails is swallowed', async () => {
    del.mockRejectedValue(new Error('busy'));
    expect(() => releaseAskFile(device(`${cache}a.jpg`))).not.toThrow();
    await Promise.resolve();
  });

  it('a blob: URL on the web is revoked, and nothing is deleted', () => {
    restoreOS = jest.replaceProperty(Platform, 'OS', 'web').restore;
    const g = globalThis as unknown as { URL: { revokeObjectURL?: (u: string) => void } };
    const before = g.URL.revokeObjectURL;
    const revoke = jest.fn();
    g.URL.revokeObjectURL = revoke;
    try {
      releaseAskFile(device('blob:https://app.mageid.app/1234'));
      expect(revoke).toHaveBeenCalledWith('blob:https://app.mageid.app/1234');
      releaseAskFile(device('data:image/jpeg;base64,QUJD'));
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(del).not.toHaveBeenCalled();
    } finally {
      g.URL.revokeObjectURL = before;
    }
  });

  it('a plan page does nothing', () => {
    releaseAskFile({ id: 'p', source: 'plan', name: 'A-101', storagePath: `${PROJECT}/sheet-page-1.png` });
    expect(del).not.toHaveBeenCalled();
  });
});
