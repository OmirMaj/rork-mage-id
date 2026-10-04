/**
 * Ask MAGE reads files (lane ATTASK), in the REAL app with ASK_FILES_ENABLED
 * mocked true (every other flag keeps its real value). 390 x 844 iOS, the
 * populated fixture world, /ask anchored to the fixture job.
 *
 * utils/askFiles.ts is the real code; only its edges are scripted: the picker,
 * the file read, the consent gate (for the refusal) and the edge call.
 *
 * THE PROMISES THIS PROVES
 *   1. The paperclip renders. A Free account gets the locked alert, no sheet
 *      opens and no picker is launched.
 *   2. A picked photo and a plan page show in the tray with the note line; a
 *      plan page with no stored path is counted, not listed.
 *   3. Send calls askFiles with feature 'ask', the files and the question, and
 *      the request is exactly { mode, files, question }. The answer shows
 *      "What I read". The files are STILL in the tray, and a second question
 *      sends them again.
 *   4. A cut-short answer shows the cut-short line and "may not have got
 *      through all of it".
 *   5. A consent no shows "AI features are off…", sends nothing, keeps the files.
 *   6. What is saved to Ask history holds a file's name and nothing else about
 *      it: no file:// or blob: location, no stored path, no id, no bytes.
 *   7. Removing a file lets its local copy go (releaseAskFile).
 *   8. With the tray empty a question goes to One Mind, and what One Mind is
 *      sent holds neither the file questions nor the file answers.
 *   9. A PDF over the page limit is refused when picked: one sentence, nothing
 *      in the tray, its cache copy let go. One within the limit is attached.
 *      A photo over the device allowance is refused and its copy let go.
 *  10. The plan list has a way back to the menu.
 *  11. An answer the own-words gate takes whole shows the reason as its text,
 *      once; a partly withheld answer shows the rest and the reason under it.
 *  12. Daily advanced calls used up: the limiter's turn, nothing sent, nothing
 *      metered, files kept. A failed read is not metered either.
 *  13. Unmounting the conversation lets the tray's local copies go.
 *  14. On the Pro plan a monthly-cap refusal shows the server's sentence and
 *      "See plans"; the hourly limit shows its sentence and no button; a plan
 *      refusal shows "See plans"; a signed-out refusal shows "Sign in".
 *  15. Offline: both sentences ("...needs a connection..." and "Your files are
 *      still attached."), nothing sent, the files kept.
 *  16. A code page whose text sits a blank line under the sentence that names
 *      the code, or above it, is left out of the answer on screen.
 *  17. The Plan page row is for the job's owner. The fixture account owns the
 *      fixture job through the REAL role hook (cases 2 and 10 run on it). A
 *      collaborator, a role still loading and a role that could not be read
 *      each see the row off with their own reason; a tap opens no list.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Dimensions } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';
import { ASK_FILES_ENABLED, PORTAL_MESSAGE_AI_ENABLED, RFP_BROWSE_ENABLED } from '@/constants/featureFlags';
import * as oneMindAnswer from '@/utils/oneMind/answer';
import * as aiUsage from '@/utils/aiRateLimiter';
import * as askFilesModule from '@/utils/askFiles';
import * as askHistory from '@/utils/askHistory';
import * as aiConsent from '@/utils/aiConsent';
import * as platformFile from '@/utils/platformFile';
import * as invokeModule from '@/utils/invokeWithTimeout';
import * as toast from '@/components/animations/NailItToast';
import * as online from '@/hooks/useOnline';
import { withLocalMonthlyReset } from '@/utils/aiRateLimiterCore';

jest.mock('@/constants/featureFlags', () => ({
  ...jest.requireActual('@/constants/featureFlags'), ASK_FILES_ENABLED: true }));

jest.mock('expo-document-picker', () => ({
  __esModule: true,
  getDocumentAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

let mockPro = true;
jest.mock('@/hooks/useTierAccess', () => {
  const actual = jest.requireActual('@/hooks/useTierAccess');
  return { ...actual, useTierAccess: () => ({ ...actual.useTierAccess(), isProOrAbove: mockPro }) };
});

// null = the real role hook (the fixture account owns the fixture job).
let mockRoleState: { role: string | null; isLoading: boolean; isError: boolean; isPaused?: boolean } | null = null;
jest.mock('@/hooks/useProjectRole', () => {
  const actual = jest.requireActual('@/hooks/useProjectRole');
  return {
    __esModule: true,
    ...actual,
    useProjectRoleState: (id: string | undefined) => {
      const real = actual.useProjectRoleState(id);
      return mockRoleState ? { ...real, ...mockRoleState } : real;
    },
  };
});

const PHOTO_URI = 'file:///smoke-test/cache/ImagePicker/crack.jpg';
const PHOTO_B64 = 'QUJDREVGR0hJSktMTU5PUA==';
const PDF_URI = 'file:///smoke-test/cache/DocumentPicker/spec.pdf';
const LONG_PDF_URI = 'file:///smoke-test/cache/DocumentPicker/long.pdf';
const BIG_URI = 'file:///smoke-test/cache/ImagePicker/big.jpg';
const CODE_WITHHELD = 'MAGE left out a part that read like building-code text. Read the section in the code itself.';
const SHEET_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SHEET_PATH = `${PROJECT_ID}/${SHEET_ID}-page-1.png`;
const NOW = '2026-10-01T12:00:00.000Z';
const PLAN_SHEETS = [
  { id: SHEET_ID, projectId: PROJECT_ID, name: 'A-101 Floor plan', imageUri: '', storagePath: SHEET_PATH, createdAt: NOW, updatedAt: NOW },
  // An older page: no stored path, so MAGE cannot be sent it.
  { id: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', projectId: PROJECT_ID, name: 'Legacy sheet', imageUri: 'https://example.invalid/legacy.png', createdAt: NOW, updatedAt: NOW },
];

beforeEach(() => {
  jest.useRealTimers();
  mockPro = true;
  mockRoleState = null;
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockClear();
  (ImagePicker.launchCameraAsync as jest.Mock).mockClear();
  (DocumentPicker.getDocumentAsync as jest.Mock).mockClear();
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } });
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function pump(n = 8) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

function allText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((n) => allText(n, out)); return out; }
  const kids = (node as { children?: unknown }).children;
  if (kids) allText(kids, out);
  return out;
}

/** What supabase-js hands back for a non-2xx answer: the Response hangs off `.context`. */
const httpError = (status: number, body?: { error?: string; code?: string }) => ({
  message: 'Edge Function returned a non-2xx status code',
  context: { status, json: async () => { if (!body) throw new Error('not json'); return body; } },
});

async function send(text: string) {
  fireEvent.changeText(screen.getByTestId('ask-input'), text);
  await pump(2);
  fireEvent.press(screen.getByTestId('ask-send'));
  await pump(8);
}

describe('Ask MAGE with ASK_FILES_ENABLED on (mocked)', () => {
  it('only the Ask flag is mocked on; every other flag keeps its real value', () => {
    expect(ASK_FILES_ENABLED).toBe(true);
    expect(PORTAL_MESSAGE_AI_ENABLED).toBe(false);
    expect(RFP_BROWSE_ENABLED).toBe(false);
  });

  it('a Free account: the paperclip shows, a tap gives the locked alert, no sheet opens and no picker is launched', async () => {
    mockPro = false;
    await primeWorld('populated');
    await mountRouteChecked('/ask');
    await pump(2);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    expect(screen.getByTestId('ask-attach')).toBeTruthy();
    expect(screen.getByTestId('ask-attach').props.accessibilityLabel).toBe('Attach a photo, PDF or plan page');
    fireEvent.press(screen.getByTestId('ask-attach'));
    await pump(2);

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons] = alert.mock.calls[0] as [string, string, { text: string }[]];
    expect(title).toBe('Reading files is on the Pro plan');
    expect(body).toBe('On Pro, MAGE reads the photos, PDFs and plan pages you attach. Each read counts as one of your monthly photo analyses.');
    expect(buttons.map((b) => b.text)).toEqual(['Not now', 'See plans']);
    expect(screen.queryByTestId('ask-attach-photos')).toBeNull();
    expect(screen.queryByTestId('ask-attach-camera')).toBeNull();
    expect(screen.queryByTestId('ask-tray')).toBeNull();
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['an editor on the job', { role: 'editor', isLoading: false, isError: false }, 'Only the account that owns this job can attach its plan pages.'],
    ['a field seat on the job', { role: 'field', isLoading: false, isError: false }, 'Only the account that owns this job can attach its plan pages.'],
    ['a role still loading', { role: null, isLoading: true, isError: false }, 'Checking your access to this job.'],
    ['a role that could not be read', { role: null, isLoading: false, isError: true }, 'MAGE couldn\'t check your access to this job. Try again in a minute.'],
    // The read is waiting for a network: it has not answered, so it is not a "no".
    ['a role read that is waiting for a network', { role: null, isLoading: false, isError: false, isPaused: true }, 'MAGE couldn\'t check your access to this job. Try again in a minute.'],
    // The read answered and he has no seat: a settled no, with nothing to try again.
    ['someone who is not on the job (the role read answered)', { role: null, isLoading: false, isError: false, isPaused: false }, 'You are not on this job, so its plan pages can\'t be read here.'],
  ] as [string, { role: string | null; isLoading: boolean; isError: boolean; isPaused?: boolean }, string][])(
    'the Plan page row is for the job\'s owner: %s sees it off, with the reason, and a tap opens no list',
    async (_who, state, why) => {
      mockRoleState = state;
      await primeWorld('populated');
      await AsyncStorage.setItem('mageid_plan_sheets', JSON.stringify(PLAN_SHEETS));
      await mountRouteChecked(`/ask?projectId=${PROJECT_ID}`);
      await pump(4);
      fireEvent.press(screen.getByTestId('ask-attach'));
      await pump(3);
      const row = screen.getByTestId('ask-attach-plan');
      expect(row.props.accessibilityState).toEqual({ disabled: true });
      expect(row.props.accessibilityHint).toBe(why);
      expect(screen.getByText(why)).toBeTruthy();
      // One reason, and only the unfinished check asks him to try again.
      const TRY_AGAIN = 'MAGE couldn\'t check your access to this job. Try again in a minute.';
      const NOT_ON_JOB = 'You are not on this job, so its plan pages can\'t be read here.';
      if (why !== TRY_AGAIN) expect(screen.queryByText(TRY_AGAIN)).toBeNull();
      if (why !== NOT_ON_JOB) expect(screen.queryByText(NOT_ON_JOB)).toBeNull();
      // The other rows are untouched: his own photos and PDFs can still be attached.
      expect(screen.getByTestId('ask-attach-photos').props.accessibilityState).toEqual({ disabled: false });
      fireEvent.press(row);
      await pump(3);
      expect(screen.queryByTestId('ask-plan-list')).toBeNull();
      expect(screen.queryByText('Pick a plan page')).toBeNull();
      expect(screen.queryByTestId(`ask-plan-${SHEET_ID}`)).toBeNull();
      expect(screen.queryByTestId('ask-tray')).toBeNull();
    },
  );

  it('attach, ask, ask again, cut short, consent no, saved thread, remove, then the text path without the file turns', async () => {
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_plan_sheets', JSON.stringify(PLAN_SHEETS));
    const tree = await mountRouteChecked(`/ask?projectId=${PROJECT_ID}`);
    expect(tree.getPathname()).toBe('/ask');
    await pump(4);

    const askOneMind = jest.spyOn(oneMindAnswer, 'askOneMind')
      .mockResolvedValue({ answer: 'The job is on budget.', citations: [], scope: { kind: 'business' }, usedAI: false } as never);
    jest.spyOn(aiUsage, 'checkAILimit').mockResolvedValue({ allowed: true } as never);
    const meter = jest.spyOn(aiUsage, 'recordAIUsage').mockResolvedValue(undefined as never);
    const askFiles = jest.spyOn(askFilesModule, 'askFiles');
    const release = jest.spyOn(askFilesModule, 'releaseAskFile');
    const save = jest.spyOn(askHistory, 'saveAskThread');
    const readB64 = jest.spyOn(platformFile, 'readAsBase64').mockResolvedValue(PHOTO_B64);
    const invoke = jest.spyOn(invokeModule, 'invokeWithTimeout').mockResolvedValue({
      data: {
        success: true, mode: 'ask', answer: 'The photo shows a crack at the corner of the footing.', truncated: false,
        read: [{ index: 0, name: 'crack.jpg', kind: 'image' }, { index: 1, name: 'A-101 Floor plan', kind: 'plan' }],
        usage: { used: 3, cap: 200 },
      },
      error: null,
    });

    // A text question first, so there is ordinary history for the last step.
    await send('how is this job doing');
    expect(askOneMind).toHaveBeenCalledTimes(1);
    expect(screen.getByText('The job is on budget.')).toBeTruthy();
    expect(askFiles).not.toHaveBeenCalled();

    // ── 2. Attach a photo ──
    expect(screen.queryByTestId('ask-tray')).toBeNull();
    fireEvent.press(screen.getByTestId('ask-attach'));
    await pump(3);
    expect(screen.getByText('Add to your question')).toBeTruthy();
    expect(screen.getByTestId('ask-attach-camera')).toBeTruthy();
    expect(screen.getByTestId('ask-attach-pdf')).toBeTruthy();
    expect(screen.getByTestId('ask-attach-plan')).toBeTruthy();
    expect(screen.queryByTestId('ask-attach-files')).toBeNull(); // the web row
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: PHOTO_URI, fileName: 'crack.jpg', mimeType: 'image/jpeg', fileSize: 120000, width: 800, height: 600 }],
    });
    fireEvent.press(screen.getByTestId('ask-attach-photos'));
    await pump(6);
    const opts = (ImagePicker.launchImageLibraryAsync as jest.Mock).mock.calls[0][0];
    expect(opts).toMatchObject({ mediaTypes: ['images'], quality: 0.4, exif: false, allowsMultipleSelection: true, selectionLimit: 4 });
    expect(screen.getByTestId('ask-tray')).toBeTruthy();
    expect(screen.getByText('MAGE reads these files again with each question, and each read counts.')).toBeTruthy();
    expect(screen.getByTestId('ask-input').props.placeholder).toBe('Ask about these files');
    expect(screen.getByTestId('ask-input').props.maxLength).toBe(2000);

    // ── 2b. Attach a plan page of the anchored job ──
    fireEvent.press(screen.getByTestId('ask-attach'));
    await pump(3);
    fireEvent.press(screen.getByTestId('ask-attach-plan'));
    await pump(3);
    expect(screen.getByText('Pick a plan page')).toBeTruthy();
    expect(screen.getByText('1 older page is not listed. Import it again in Plans to ask about it.')).toBeTruthy();
    expect(screen.queryByText('Legacy sheet')).toBeNull();
    fireEvent.press(screen.getByTestId(`ask-plan-${SHEET_ID}`));
    await pump(3);
    const trayText = allText(screen.toJSON()).join('\n');
    expect(trayText).toContain('A-101 Floor plan');
    expect(trayText).toContain('Plan page');
    const removeIds = screen.getAllByLabelText(/^Remove /).map((n) => String(n.props.testID));
    expect(removeIds).toHaveLength(2);
    const photoId = removeIds[0].replace('ask-tray-remove-', '');
    const planId = removeIds[1].replace('ask-tray-remove-', '');

    // ── 3. Ask about them ──
    await send('What does this show?');
    expect(askOneMind).toHaveBeenCalledTimes(1); // not asked again
    expect(askFiles).toHaveBeenCalledTimes(1);
    expect(askFiles.mock.calls[0][0]).toEqual({
      feature: 'ask',
      files: [
        { source: 'device', name: 'crack.jpg', mime: 'image/jpeg', localUri: PHOTO_URI },
        { source: 'plan', name: 'A-101 Floor plan', storagePath: SHEET_PATH },
      ],
      question: 'What does this show?',
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toBe('ask-files');
    expect(invoke.mock.calls[0][1]?.body).toEqual({
      mode: 'ask',
      files: [
        { source: 'inline', name: 'crack.jpg', mime: 'image/jpeg', base64: PHOTO_B64 },
        { source: 'plan', storagePath: SHEET_PATH, name: 'A-101 Floor plan' },
      ],
      question: 'What does this show?',
    });
    expect(readB64).toHaveBeenCalledWith(PHOTO_URI);
    expect(meter).toHaveBeenCalledWith('smart', 'askMage');
    expect(screen.getByText('The photo shows a crack at the corner of the footing.')).toBeTruthy();
    expect(screen.getByTestId('ask-what-i-read')).toBeTruthy();
    expect(screen.getByTestId('ask-what-i-read').props.accessibilityLabel).toBe('MAGE read 2 files');
    expect(screen.getByText('What I read')).toBeTruthy();
    expect(screen.getByText('AI reading — check the original')).toBeTruthy();
    expect(screen.queryByText('MAGE may not have got through all of it.')).toBeNull();
    // The files are STILL in the tray.
    expect(screen.getByTestId('ask-tray')).toBeTruthy();
    expect(screen.getByTestId(`ask-tray-remove-${photoId}`)).toBeTruthy();
    expect(screen.getByTestId(`ask-tray-remove-${planId}`)).toBeTruthy();

    // ── 4. A second question sends them again; this answer is cut short ──
    invoke.mockResolvedValueOnce({
      data: {
        success: true, mode: 'ask', answer: 'The plan shows the kitchen and', truncated: true,
        read: [{ index: 0, name: 'crack.jpg', kind: 'image' }, { index: 1, name: 'A-101 Floor plan', kind: 'plan' }],
        usage: { used: 4, cap: 200 },
      },
      error: null,
    });
    await send('And the plan?');
    expect(askFiles).toHaveBeenCalledTimes(2);
    expect(askFiles.mock.calls[1][0].files).toHaveLength(2);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect((invoke.mock.calls[1][1]?.body as { files: unknown[] }).files).toHaveLength(2);
    expect(Object.keys(invoke.mock.calls[1][1]?.body as object).sort()).toEqual(['files', 'mode', 'question']);
    expect(screen.getByText('The plan shows the kitchen and')).toBeTruthy();
    expect(screen.getByText('MAGE\'s answer stops partway. Try a narrower question.')).toBeTruthy();
    // Ask's own line: the portal sheet's line (open the files) is never drawn here.
    expect(screen.queryByText('MAGE\'s reading stops partway. Open the files to check the rest.')).toBeNull();
    expect(screen.getByText('MAGE may not have got through all of it.')).toBeTruthy();
    expect(screen.getAllByTestId('ask-what-i-read')).toHaveLength(2);

    // ── 5. A consent no: the sentence, nothing sent, files kept ──
    const consent = jest.spyOn(aiConsent, 'ensureAiConsent').mockResolvedValue(false);
    await send('One more look');
    expect(askFiles).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(screen.getByText(aiConsent.AI_CONSENT_OFF_MESSAGE)).toBeTruthy();
    expect(screen.getByTestId(`ask-tray-remove-${photoId}`)).toBeTruthy();
    expect(screen.getByTestId(`ask-tray-remove-${planId}`)).toBeTruthy();
    consent.mockRestore();

    // ── 6. What was saved to Ask history ──
    expect(save).toHaveBeenCalled();
    const savedTurns = save.mock.calls[save.mock.calls.length - 1][1];
    const saved = JSON.stringify(savedTurns);
    expect(saved).toContain('crack.jpg');
    expect(saved).toContain('The photo shows a crack at the corner of the footing.');
    expect(saved).not.toContain('file://');
    expect(saved).not.toContain('blob:');
    expect(saved).not.toContain('storagePath');
    expect(saved).not.toContain('localUri');
    expect(saved).not.toContain(SHEET_PATH);
    expect(saved).not.toContain(PROJECT_ID);
    expect(saved).not.toContain(photoId);
    expect(saved).not.toContain(planId);
    expect(saved).not.toContain(PHOTO_B64);
    expect(saved).not.toContain('base64');
    const fileTurn = (savedTurns as { files?: object[] }[]).find((t) => t.files);
    expect(fileTurn?.files).toEqual([{ name: 'crack.jpg', kind: 'image' }, { name: 'A-101 Floor plan', kind: 'plan' }]);

    // ── 7. Remove the files ──
    expect(release).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId(`ask-tray-remove-${photoId}`));
    await pump(2);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toMatchObject({ id: photoId, source: 'device', localUri: PHOTO_URI });
    expect(screen.getByTestId('ask-tray')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`ask-tray-remove-${planId}`));
    await pump(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('ask-tray')).toBeNull();
    expect(screen.getByTestId('ask-input').props.placeholder).toBe('Ask a question or say what to do');

    // ── 8. The text path, without the file turns ──
    await send('what is next on this job');
    expect(askFiles).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(askOneMind).toHaveBeenCalledTimes(2);
    const prior = askOneMind.mock.calls[1][1] as { role: string; text: string }[];
    expect(prior).toEqual([
      { role: 'user', text: 'how is this job doing' },
      { role: 'assistant', text: 'The job is on budget.' },
    ]);
    const priorText = JSON.stringify(prior);
    expect(priorText).not.toContain('What does this show?');
    expect(priorText).not.toContain('crack');
    expect(priorText).not.toContain('And the plan?');
    expect(priorText).not.toContain('One more look');
    expect(priorText).not.toContain('AI features are off');
  });

  it('a PDF over the page limit, the way back from the plan list, a withheld answer, the daily limit, a failed read, unmount', async () => {
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_plan_sheets', JSON.stringify(PLAN_SHEETS));
    const tree = await mountRouteChecked(`/ask?projectId=${PROJECT_ID}`);
    await pump(4);

    const limiter = jest.spyOn(aiUsage, 'checkAILimit').mockResolvedValue({ allowed: true } as never);
    const meter = jest.spyOn(aiUsage, 'recordAIUsage').mockResolvedValue(undefined as never);
    const askFiles = jest.spyOn(askFilesModule, 'askFiles');
    const release = jest.spyOn(askFilesModule, 'releaseAskFile');
    const pages = jest.spyOn(askFilesModule, 'countAskPdfPages');
    const oops = jest.spyOn(toast, 'oops').mockImplementation(() => undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    jest.spyOn(platformFile, 'readAsBase64').mockResolvedValue(PHOTO_B64);
    const READ = [{ index: 0, name: 'Spec.pdf', kind: 'pdf', pages: 3 }];
    const invoke = jest.spyOn(invokeModule, 'invokeWithTimeout').mockResolvedValue({
      data: { success: true, mode: 'ask', answer: 'The inspector wrote "fails NEC 210.8" on the tag.', truncated: false, read: READ, usage: { used: 1, cap: 200 } },
      error: null,
    });

    // ── 9. A 21-page PDF is refused when picked ──
    fireEvent.press(screen.getByTestId('ask-attach'));
    await pump(3);
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: LONG_PDF_URI, name: 'Long.pdf', mimeType: 'application/pdf', size: 90000 }],
    });
    pages.mockResolvedValueOnce(21);
    fireEvent.press(screen.getByTestId('ask-attach-pdf'));
    await pump(8);
    expect((DocumentPicker.getDocumentAsync as jest.Mock).mock.calls[0][0]).toMatchObject({ type: 'application/pdf', multiple: true });
    expect(pages).toHaveBeenCalledWith(LONG_PDF_URI);
    expect(screen.queryByTestId('ask-tray')).toBeNull();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0]).toMatchObject({ source: 'device', localUri: LONG_PDF_URI });
    expect(alert).not.toHaveBeenCalled();
    expect(oops).toHaveBeenCalledTimes(1);
    expect(oops.mock.calls[0][0]).toBe('Long.pdf has 21 pages. MAGE reads PDFs up to 20 pages. Send the pages you need as a shorter PDF or as photos.');

    // A 3-page PDF is attached.
    fireEvent.press(screen.getByTestId('ask-attach'));
    await pump(3);
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: PDF_URI, name: 'Spec.pdf', mimeType: 'application/pdf', size: 50000 }],
    });
    pages.mockResolvedValueOnce(3);
    fireEvent.press(screen.getByTestId('ask-attach-pdf'));
    await pump(8);
    expect(screen.getByTestId('ask-tray')).toBeTruthy();
    expect(release).toHaveBeenCalledTimes(1);
    expect(oops).toHaveBeenCalledTimes(1);
    const pdfId = String(screen.getAllByLabelText(/^Remove /)[0].props.testID).replace('ask-tray-remove-', '');

    // A 7 MB photo is over this device's allowance: refused, its copy let go.
    fireEvent.press(screen.getByTestId('ask-attach'));
    await pump(3);
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: BIG_URI, fileName: 'big.jpg', mimeType: 'image/jpeg', fileSize: 7 * 1048576, width: 4000, height: 3000 }],
    });
    fireEvent.press(screen.getByTestId('ask-attach-photos'));
    await pump(8);
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(1);
    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.calls[1][0]).toMatchObject({ source: 'device', localUri: BIG_URI });
    expect(oops).toHaveBeenCalledTimes(2);
    expect(oops.mock.calls[1][0]).toBe('big.jpg is 7.0 MB. Files from this device can be up to 6 MB in one question.');

    // ── 10. The plan list, and back to the menu ──
    fireEvent.press(screen.getByTestId('ask-attach'));
    await pump(3);
    fireEvent.press(screen.getByTestId('ask-attach-plan'));
    await pump(3);
    expect(screen.getByText('Pick a plan page')).toBeTruthy();
    expect(screen.queryByTestId('ask-attach-photos')).toBeNull();
    expect(screen.getByTestId('ask-plan-back').props.accessibilityLabel).toBe('Back');
    fireEvent.press(screen.getByTestId('ask-plan-back'));
    await pump(3);
    expect(screen.getByText('Add to your question')).toBeTruthy();
    expect(screen.getByTestId('ask-attach-photos')).toBeTruthy();
    expect(screen.queryByTestId('ask-plan-back')).toBeNull();
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: true, assets: null });
    fireEvent.press(screen.getByTestId('ask-attach-photos'));
    await pump(6);

    // ── 11. The gate takes the whole answer: the reason is the turn's text, once ──
    await send('What does the tag say?');
    expect(askFiles).toHaveBeenCalledTimes(1);
    expect(meter).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/fails NEC/)).toBeNull();
    expect(screen.getAllByText(CODE_WITHHELD)).toHaveLength(1);
    expect(screen.getAllByTestId('ask-what-i-read')).toHaveLength(1);

    // Part of an answer withheld: the rest shows, and the reason under it.
    invoke.mockResolvedValueOnce({
      data: {
        success: true, mode: 'ask', truncated: false, read: READ, usage: { used: 2, cap: 200 },
        answer: 'Page 2 is a code page. IRC R312.1.1 Where required. Guards shall be provided for those portions of open-sided walking surfaces. The rail in the photo looks low.',
      },
      error: null,
    });
    await send('And page 2?');
    expect(askFiles).toHaveBeenCalledTimes(2);
    expect(meter).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Page 2 is a code page. IRC R312.1.1 Where required. The rail in the photo looks low.')).toBeTruthy();
    expect(screen.queryByText(/Guards shall be provided/)).toBeNull();
    expect(screen.getAllByText(CODE_WITHHELD)).toHaveLength(2);

    // ── 12. A failed read is not metered ──
    invoke.mockResolvedValueOnce({ data: { success: false, code: 'unreadable_file', fileIndex: 0 }, error: null });
    await send('Try once more');
    expect(askFiles).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(meter).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(`ask-tray-remove-${pdfId}`)).toBeTruthy();

    // Daily advanced calls used up: the limiter's turn, nothing sent.
    limiter.mockResolvedValueOnce({ allowed: false } as never);
    await send('One more question');
    expect(askFiles).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(meter).toHaveBeenCalledTimes(2);
    expect(tree.getPathname()).toBe('/ask'); // the test account is not sent to plans
    expect(screen.getByText(/^You've used today's advanced AI calls\. .+\.$/)).toBeTruthy();
    expect(screen.getByTestId(`ask-tray-remove-${pdfId}`)).toBeTruthy();
    limiter.mockResolvedValueOnce({ allowed: false, message: 'The limiter said no.' } as never);
    await send('And again');
    expect(askFiles).toHaveBeenCalledTimes(3);
    expect(screen.getByText('The limiter said no.')).toBeTruthy();
    expect(screen.getByTestId(`ask-tray-remove-${pdfId}`)).toBeTruthy();

    // ── 13. Unmount lets the tray's local copy go ──
    expect(release).toHaveBeenCalledTimes(2);
    tree.unmount();
    expect(release).toHaveBeenCalledTimes(3);
    expect(release.mock.calls[2][0]).toMatchObject({ id: pdfId, source: 'device', localUri: PDF_URI });
  });

  it('on the Pro plan: the monthly cap, the hourly limit, a plan refusal, signed out, offline, and a code page a blank line away', async () => {
    await primeWorld('populated');
    await AsyncStorage.setItem('mageid_subscription_tier', 'pro');
    await mountRouteChecked(`/ask?projectId=${PROJECT_ID}`);
    await pump(4);

    jest.spyOn(aiUsage, 'checkAILimit').mockResolvedValue({ allowed: true } as never);
    const meter = jest.spyOn(aiUsage, 'recordAIUsage').mockResolvedValue(undefined as never);
    jest.spyOn(platformFile, 'readAsBase64').mockResolvedValue(PHOTO_B64);
    const invoke = jest.spyOn(invokeModule, 'invokeWithTimeout');

    fireEvent.press(screen.getByTestId('ask-attach'));
    await pump(3);
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: PHOTO_URI, fileName: 'crack.jpg', mimeType: 'image/jpeg', fileSize: 120000, width: 800, height: 600 }],
    });
    fireEvent.press(screen.getByTestId('ask-attach-photos'));
    await pump(6);
    const photoId = String(screen.getAllByLabelText(/^Remove /)[0].props.testID).replace('ask-tray-remove-', '');

    // ── 14. The monthly cap: the server's sentence (with the local reset time) and "See plans" ──
    const CAP = 'You have used all 200 photo analyses for this month. Resets on the 1st.';
    invoke.mockResolvedValueOnce({ data: null, error: httpError(429, { error: CAP, code: 'monthly_cap_reached' }) } as never);
    await send('What is this?');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(screen.getByText(withLocalMonthlyReset(CAP))).toBeTruthy();
    expect(screen.getAllByTestId('ask-see-plans')).toHaveLength(1);
    expect(screen.queryByTestId('ask-sign-in')).toBeNull();

    // The hourly limit: its sentence, and no plans button (a bigger plan does not lift it).
    const HOURLY = 'Too many requests this hour. Try again in 12 minutes.';
    invoke.mockResolvedValueOnce({ data: null, error: httpError(429, { error: HOURLY, code: 'hourly_limit' }) } as never);
    await send('Again?');
    expect(screen.getByText(HOURLY)).toBeTruthy();
    expect(screen.getAllByTestId('ask-see-plans')).toHaveLength(1);

    // The plan does not include reading files: our sentence (never the server's) and "See plans".
    invoke.mockResolvedValueOnce({ data: null, error: httpError(403, { error: 'server wording', code: 'tier_required' }) } as never);
    await send('And now?');
    expect(screen.getByText('Reading files is on the Pro plan.')).toBeTruthy();
    expect(screen.queryByText('server wording')).toBeNull();
    expect(screen.getAllByTestId('ask-see-plans')).toHaveLength(2);

    // Signed out (the gateway's own 401, no body of ours): "Sign in".
    invoke.mockResolvedValueOnce({ data: null, error: httpError(401) } as never);
    await send('Still there?');
    expect(screen.getByText('Sign in to have MAGE read files.')).toBeTruthy();
    expect(screen.getAllByTestId('ask-sign-in')).toHaveLength(1);
    expect(screen.getAllByTestId('ask-see-plans')).toHaveLength(2);
    expect(invoke).toHaveBeenCalledTimes(4);

    // ── 15. Offline: both sentences, nothing sent, the file kept ──
    const offline = jest.spyOn(online, 'isOfflineNow').mockReturnValue(true);
    await send('Offline now');
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(screen.getByText('You\'re offline. MAGE needs a connection to read files. Your files are still attached.')).toBeTruthy();
    expect(screen.getByTestId(`ask-tray-remove-${photoId}`)).toBeTruthy();
    expect(screen.getAllByTestId('ask-see-plans')).toHaveLength(2);
    expect(screen.getAllByTestId('ask-sign-in')).toHaveLength(1);
    offline.mockRestore();
    expect(meter).not.toHaveBeenCalled();

    // ── 16. A code page: the text a blank line under the sentence that names the code ──
    const READ = [{ index: 0, name: 'crack.jpg', kind: 'image' }];
    invoke.mockResolvedValueOnce({
      data: {
        success: true, mode: 'ask', truncated: false, read: READ, usage: { used: 1, cap: 200 },
        answer: 'This is a page from the IRC, Section R312. It reads:\n\nGuards shall be provided for those portions of open-sided walking surfaces.\n\nRequired guards shall be not less than 36 inches in height.',
      },
      error: null,
    } as never);
    await send('What does the page say?');
    expect(meter).toHaveBeenCalledTimes(1);
    expect(screen.getByText('This is a page from the IRC, Section R312. It reads:')).toBeTruthy();
    expect(screen.queryByText(/Guards shall be provided/)).toBeNull();
    expect(screen.queryByText(/not less than 36 inches/)).toBeNull();
    expect(screen.getAllByText(CODE_WITHHELD)).toHaveLength(1);

    // The text first, the section named after it.
    invoke.mockResolvedValueOnce({
      data: {
        success: true, mode: 'ask', truncated: false, read: READ, usage: { used: 2, cap: 200 },
        answer: 'Guards shall be provided for those portions of open-sided walking surfaces. That is IRC R312.1.1.',
      },
      error: null,
    } as never);
    await send('And the other page?');
    expect(meter).toHaveBeenCalledTimes(2);
    expect(screen.getByText('That is IRC R312.1.1.')).toBeTruthy();
    expect(screen.queryByText(/Guards shall be provided/)).toBeNull();
    expect(screen.getAllByText(CODE_WITHHELD)).toHaveLength(2);
  });
});
