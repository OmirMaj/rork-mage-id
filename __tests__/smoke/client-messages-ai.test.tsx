/**
 * Lane ATTPORTAL: "Read with MAGE" on a client's portal message (part B of
 * the AI-readable attachments wave; ships dark behind PORTAL_MESSAGE_AI_ENABLED).
 *
 * THE DARK GOLDEN. DARK_GOLDEN below is the sha256 of the client thread's own
 * subtree (every prop key, undefined and functions included; clock text
 * normalised) for a thread with a client message with two files, a contractor
 * PDF and a client message that is only a photo. It was recorded FIRST, on the
 * untouched app/client-messages.tsx at d2605448, before a single lane edit,
 * twice, with the same hash both times. With the real flag the screen must
 * still produce exactly that tree: no button, no sheet, no new prop.
 *
 * THE MOCKS. jest.mock is file-wide, so the flag, the cut-off date, the role
 * and the plan are each a pass-through to the real module until a test sets
 * its switch (mockFlagOn, mockNotBefore, mockRole, mockTier). In the "real
 * flag" block every switch is off, so the screen reads the real constants.
 * usePortalThread is replaced so the thread holds exactly the messages a test
 * names. utils/askFiles (the request) and settleAiConsentSync are replaced;
 * nothing in this file reaches a network mock.
 */
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, PORTAL_ID } from '@/__tests__/fixtures/world';
import type { AskFilesSuccess, PortalMessage } from '@/types';
import { AI_CONSENT_DECLINED_CODE, AI_CONSENT_OFF_MESSAGE } from '@/utils/aiConsentCore';
import { clearDraftHandoffs, readDraftHandoff, stashDraftHandoff } from '@/utils/draftHandoff';

// ── The switches ────────────────────────────────────────────────────────────

let mockFlagOn = false;
let mockNotBefore: string | null = null;
let mockRole: string | null | undefined; // undefined = the real hook's answer
let mockTier: string | null = null; // null = the fixture's plan (enterprise)

// defineProperty, not a getter in the literal: babel's object spread copies a
// literal's getters by VALUE, which would freeze the flag and the date at
// their first reading.
jest.mock('@/constants/featureFlags', () => {
  const actual = jest.requireActual('@/constants/featureFlags');
  const mod = { __esModule: true, ...actual };
  Object.defineProperty(mod, 'PORTAL_MESSAGE_AI_ENABLED', {
    enumerable: true, get: () => (mockFlagOn ? true : actual.PORTAL_MESSAGE_AI_ENABLED),
  });
  return mod;
});
jest.mock('@/utils/messageAiCore', () => {
  const actual = jest.requireActual('@/utils/messageAiCore');
  const mod = { __esModule: true, ...actual };
  Object.defineProperty(mod, 'MESSAGE_AI_NOT_BEFORE', {
    enumerable: true, get: () => (mockNotBefore ?? actual.MESSAGE_AI_NOT_BEFORE),
  });
  return mod;
});
jest.mock('@/hooks/useProjectRole', () => {
  const actual = jest.requireActual('@/hooks/useProjectRole');
  return {
    __esModule: true,
    ...actual,
    useProjectRole: (id: string | undefined) => {
      const real = actual.useProjectRole(id);
      return mockRole === undefined ? real : mockRole;
    },
  };
});
jest.mock('@/contexts/SubscriptionContext', () => {
  const actual = jest.requireActual('@/contexts/SubscriptionContext');
  return {
    __esModule: true,
    ...actual,
    useSubscription: () => {
      const real = actual.useSubscription();
      return mockTier ? { ...real, tier: mockTier } : real;
    },
  };
});

const mockAskFiles = jest.fn();
jest.mock('@/utils/askFiles', () => ({
  __esModule: true,
  ...jest.requireActual('@/utils/askFiles'),
  askFiles: (...args: unknown[]) => mockAskFiles(...args),
}));
const mockSettle = jest.fn(async () => {});
jest.mock('@/utils/aiConsentAccount', () => ({
  __esModule: true,
  ...jest.requireActual('@/utils/aiConsentAccount'),
  settleAiConsentSync: (...args: unknown[]) => mockSettle(...(args as [])),
}));

// ── The thread ──────────────────────────────────────────────────────────────

const CLIENT_MSG_ID = 'c1000000-0000-4000-8000-000000000001';
const GC_MSG_ID = 'c1000000-0000-4000-8000-000000000002';
const FILES_ONLY_ID = 'c1000000-0000-4000-8000-000000000003';
const SIX_ID = 'c1000000-0000-4000-8000-000000000006';
const THREE_ID = 'c1000000-0000-4000-8000-000000000007';
const fileId = (n: number) => `f1000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const att = (msgId: string, n: number, name: string, mime: 'image/jpeg' | 'application/pdf', size: number) => ({
  id: fileId(n), name, mime, size, kind: mime === 'application/pdf' ? 'pdf' as const : 'image' as const,
  ...(mime === 'application/pdf' ? {} : { width: 1200, height: 900 }),
  path: `${PROJECT_ID}/${msgId}/${fileId(n)}.${mime === 'application/pdf' ? 'pdf' : 'jpg'}`,
});

const clientMessage: PortalMessage = {
  id: CLIENT_MSG_ID, projectId: PROJECT_ID, portalId: PORTAL_ID, authorType: 'client', authorName: 'Meredith',
  body: 'Can we move the vanity light up? Photo and the marked-up page attached.',
  createdAt: '2026-10-02T14:05:00.000Z', readByGc: true, readByClient: true,
  attachments: [att(CLIENT_MSG_ID, 1, 'Vanity wall.jpg', 'image/jpeg', 812345), att(CLIENT_MSG_ID, 2, 'Marked page.pdf', 'application/pdf', 1258291)],
};
const gcMessage: PortalMessage = {
  id: GC_MSG_ID, projectId: PROJECT_ID, portalId: PORTAL_ID, authorType: 'gc', authorName: 'Ace GC',
  body: 'Here is the cut sheet.', createdAt: '2026-10-02T14:30:00.000Z', readByGc: true, readByClient: false,
  attachments: [att(GC_MSG_ID, 3, 'Cut sheet.pdf', 'application/pdf', 204800)],
};
const filesOnly: PortalMessage = {
  id: FILES_ONLY_ID, projectId: PROJECT_ID, portalId: PORTAL_ID, authorType: 'client', authorName: 'Meredith',
  body: '', createdAt: '2026-10-02T15:10:00.000Z', readByGc: true, readByClient: true,
  attachments: [att(FILES_ONLY_ID, 4, 'Tile sample.jpg', 'image/jpeg', 512000)],
};
const sixFiles: PortalMessage = {
  id: SIX_ID, projectId: PROJECT_ID, portalId: PORTAL_ID, authorType: 'client', authorName: 'Meredith',
  body: 'Six photos of the hallway.', createdAt: '2026-10-02T16:00:00.000Z', readByGc: true, readByClient: true,
  attachments: ['a', 'b', 'c', 'd', 'e', 'f'].map((n, k) => att(SIX_ID, 10 + k, `${n}.jpg`, 'image/jpeg', 300000)),
};
const threeFiles: PortalMessage = {
  id: THREE_ID, projectId: PROJECT_ID, portalId: PORTAL_ID, authorType: 'client', authorName: 'Meredith',
  body: 'The spec and two photos.', createdAt: '2026-10-02T16:30:00.000Z', readByGc: true, readByClient: true,
  attachments: [
    att(THREE_ID, 20, 'Front.jpg', 'image/jpeg', 400000),
    att(THREE_ID, 21, 'Whole spec.pdf', 'application/pdf', 900000),
    att(THREE_ID, 22, 'Back.jpg', 'image/jpeg', 400000),
  ],
};

const baseThread = () => ({
  messages: [clientMessage, gcMessage, filesOnly] as PortalMessage[],
  unreadFromClient: [] as PortalMessage[],
  coApprovals: [],
  sendMessage: jest.fn(async () => 'synced'),
  sendClientMessage: jest.fn(),
  markRead: jest.fn(),
  isSending: false,
  isSendingClient: false,
  refetchMessages: jest.fn(async () => ({})),
  refetchApprovals: jest.fn(async () => ({})),
  outbox: [],
  queuedIds: new Set<string>() as ReadonlySet<string>,
  sendWithAttachments: jest.fn(async () => {}),
  retryOutbox: jest.fn(async () => {}),
  removeOutbox: jest.fn(async () => {}),
  loaded: true,
});
const mockThread: { value: ReturnType<typeof baseThread>; listeners: Set<() => void> } = { value: baseThread(), listeners: new Set() };
jest.mock('@/hooks/usePortalThread', () => {
  const R = jest.requireActual('react');
  return {
    usePortalThread: () => {
      const [, force] = R.useReducer((n: number) => n + 1, 0);
      R.useEffect(() => {
        mockThread.listeners.add(force);
        return () => { mockThread.listeners.delete(force); };
      }, []);
      return mockThread.value;
    },
  };
});
function setThread(patch: Partial<ReturnType<typeof baseThread>>) {
  mockThread.value = { ...mockThread.value, ...patch };
  act(() => { mockThread.listeners.forEach((l) => l()); });
}

// ── A reading the server would send back ────────────────────────────────────

const usage = { used: 3, cap: 150 };
const reading = (over: Partial<Extract<AskFilesSuccess, { mode: 'message' }>> = {}): { ok: true; data: AskFilesSuccess } => ({
  ok: true,
  data: {
    success: true, mode: 'message',
    summary: 'The photo shows the vanity wall with the light box set low. The marked page circles the fixture.',
    asks: ['Move the vanity light up', 'Confirm the new height before drywall'],
    draft: { title: 'Raise the vanity light', description: 'Client asks to raise the vanity light, per Marked page.pdf page 1.' },
    truncated: false,
    read: [
      { index: 0, name: 'Vanity wall.jpg', kind: 'image' },
      { index: 1, name: 'Marked page.pdf', kind: 'pdf', pages: 2 },
    ],
    usage,
    ...over,
  },
});

// ── The dark golden: the thread's own subtree, clock-free ───────────────────

const DARK_GOLDEN = { lines: 102, sha256: 'b064632e6df78e4b008fdd0c3dcde3eae5597bdf66f11f63fd6d196d30bbdc01' };

type JsonNode = { type: string; props: Record<string, unknown>; children: unknown };
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const DAY_TIME = /^(?:Today|Yesterday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|[A-Z][a-z]{2} \d{1,2}) \d{1,2}:\d{2}[\s ]?(?:AM|PM)$/;
const TIME = /^\d{1,2}:\d{2}[\s ]?(?:AM|PM)$/;
const clockFree = (s: string) => (DAY_TIME.test(s) ? '<day-time>' : TIME.test(s) ? '<time>' : s);
function small(v: unknown): string {
  try { return JSON.stringify(v) ?? '<undef>'; } catch { return '<obj>'; }
}
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${clockFree(String(node))}"`); return; }
  const el = node as JsonNode;
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (k === 'children' || k === 'screenId') continue;
    // Every prop key is recorded, undefined and functions included: a new
    // prop on an existing element moves the golden.
    if (v === undefined) { parts.push(`${k}=<undefined>`); continue; }
    if (typeof v === 'function') { parts.push(`${k}=<fn>`); continue; }
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v))}`); continue; }
    parts.push(`${k}=${small(v)}`);
  }
  out.push(`${pad}<${el.type} ${parts.join(' ')}>`);
  dumpLines(el.children, depth + 1, out);
}
function holds(node: unknown, pred: (el: JsonNode) => boolean): boolean {
  if (node == null || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => holds(n, pred));
  const el = node as JsonNode;
  return pred(el) || holds(el.children, pred);
}
function smallestHolding(node: unknown, preds: ((el: JsonNode) => boolean)[]): unknown {
  const all = (n: unknown) => preds.every((p) => holds(n, p));
  if (!all(node)) return null;
  let cur: unknown = node;
  for (;;) {
    const kids = Array.isArray(cur) ? cur : (cur as JsonNode).children;
    const list = Array.isArray(kids) ? kids : [];
    const next = list.find((k) => all(k));
    if (next == null) return cur;
    cur = next;
  }
}
const isSubheader = (el: JsonNode) => el.type === 'Text' && Array.isArray(el.children) && el.children[0] === 'Thread with ';
const isAttach = (el: JsonNode) => el.props?.testID === 'client-messages-attach';
function threadFingerprint(json: unknown): { lines: number; sha256: string } {
  const own = smallestHolding(json, [isSubheader, isAttach]);
  const out: string[] = [];
  dumpLines(own, 0, out);
  const text = out.join('\n');
  const dir = process.env.ATTPORTAL_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/dark.txt`, text);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: out.length, sha256 };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const THREAD_URL = `/client-messages?id=${PROJECT_ID}`;
const readBtn = (messageId: string) => `message-read-ai-${messageId}`;
const disabledOf = (testID: string) => !!screen.getByTestId(testID).props.accessibilityState?.disabled;

async function press(testID: string) {
  await act(async () => { fireEvent.press(screen.getByTestId(testID)); });
  await act(async () => { for (let k = 0; k < 20; k++) await Promise.resolve(); });
}
async function openSheet(messageId: string) {
  await press(readBtn(messageId));
  expect(screen.getByTestId('message-ai-sheet')).toBeTruthy();
}

let restoreOS: (() => void) | null = null;
let pushSpy: jest.SpyInstance;

beforeEach(async () => {
  allowConsoleErrors();
  mockFlagOn = false;
  mockNotBefore = null;
  mockRole = undefined;
  mockTier = null;
  mockAskFiles.mockReset();
  mockSettle.mockClear();
  mockThread.value = baseThread();
  clearDraftHandoffs();
  pushSpy = jest.spyOn(router, 'push');
  await primeWorld('populated');
});
afterEach(() => {
  restoreOS?.();
  restoreOS = null;
  pushSpy.mockRestore();
});

jest.setTimeout(120000);

// ═══ The real flag (dark) ═══════════════════════════════════════════════════

describe('real flag: nothing about "Read with MAGE" exists', () => {
  it('the thread is byte-identical to the tree recorded before the lane, and has no button and no sheet', async () => {
    const tree = await mountRouteChecked(THREAD_URL);
    await settle();
    await act(async () => {});
    expect(screen.getByText('Marked page.pdf')).toBeTruthy();
    expect(screen.queryByTestId(readBtn(CLIENT_MSG_ID))).toBeNull();
    expect(screen.queryByTestId(readBtn(FILES_ONLY_ID))).toBeNull();
    expect(screen.queryByText('Read with MAGE')).toBeNull();
    expect(screen.queryByTestId('message-ai-sheet')).toBeNull();
    expect(threadFingerprint(tree.toJSON())).toEqual(DARK_GOLDEN);
  });

  it('the cut-off date alone does not open it: with a date set and the flag off there is still no button', async () => {
    mockNotBefore = '2020-01-01T00:00:00.000Z';
    const tree = await mountRouteChecked(THREAD_URL);
    await settle();
    expect(screen.queryByTestId(readBtn(CLIENT_MSG_ID))).toBeNull();
    expect(threadFingerprint(tree.toJSON())).toEqual(DARK_GOLDEN);
  });

  it('the real askFiles answers feature_off for a portal read, before any request', async () => {
    const real = jest.requireActual('@/utils/askFiles') as typeof import('@/utils/askFiles');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const invoke = jest.spyOn(require('@/utils/invokeWithTimeout'), 'invokeWithTimeout');
    const out = await real.askFiles({ feature: 'portal', files: [{ source: 'message', messageId: CLIENT_MSG_ID, attachmentId: fileId(1) }] });
    expect(out).toEqual({ ok: false, code: 'feature_off', message: '' });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockRestore();
  });

  it('a crafted /rfi link cannot prefill the form while the feature is dark', async () => {
    const id = stashDraftHandoff({ title: 'Injected subject', description: 'Injected question' });
    await mountRouteChecked(`/rfi?projectId=${PROJECT_ID}&prefillDraft=${id}`);
    await settle();
    expect(screen.getByTestId('rfi-subject').props.value).toBe('');
    expect(screen.queryByDisplayValue('Injected subject')).toBeNull();
    expect(screen.queryByDisplayValue('Injected question')).toBeNull();
  });

  it('a crafted /punch-list link cannot prefill the form while the feature is dark', async () => {
    const id = stashDraftHandoff({ title: 'x', description: 'Injected punch text' });
    await mountRouteChecked(`/punch-list?projectId=${PROJECT_ID}&new=1&prefillDraft=${id}`);
    await settle();
    expect(screen.getByTestId('punch-desc-input').props.value).toBe('');
    expect(screen.queryByDisplayValue('Injected punch text')).toBeNull();
  });
});

// ═══ Flag on ════════════════════════════════════════════════════════════════

describe('flag on: who gets the button', () => {
  beforeEach(() => {
    mockFlagOn = true;
    mockNotBefore = '2020-01-01T00:00:00.000Z';
    mockRole = 'owner';
  });

  it('the owner on a phone gets it on a client message with files, files-only included; never on his own message', async () => {
    await mountRouteChecked(THREAD_URL);
    await settle();
    const btn = screen.getByTestId(readBtn(CLIENT_MSG_ID));
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toBe('Have MAGE read the files on this message');
    expect(within(btn).getByText('Read with MAGE')).toBeTruthy();
    expect(screen.getByTestId(readBtn(FILES_ONLY_ID))).toBeTruthy();
    expect(screen.queryByTestId(readBtn(GC_MSG_ID))).toBeNull();
    // Nothing is sent, and no sheet is open, until he taps.
    expect(screen.queryByTestId('message-ai-sheet')).toBeNull();
    expect(mockAskFiles).not.toHaveBeenCalled();
  });

  it('the real role hook answers owner for the fixture job (no override)', async () => {
    mockRole = undefined;
    await mountRouteChecked(THREAD_URL);
    await settle();
    expect(screen.getByTestId(readBtn(CLIENT_MSG_ID))).toBeTruthy();
  });

  it.each(['editor', 'viewer', 'field', null] as const)('a %s seat never gets it', async (role) => {
    mockRole = role;
    await mountRouteChecked(THREAD_URL);
    await settle();
    expect(screen.getByText('Marked page.pdf')).toBeTruthy();
    expect(screen.queryByTestId(readBtn(CLIENT_MSG_ID))).toBeNull();
    expect(screen.queryByTestId(readBtn(FILES_ONLY_ID))).toBeNull();
  });

  it('not on the web app: the same thread redrawn with Platform.OS web loses the button', async () => {
    await mountRouteChecked(THREAD_URL);
    await settle();
    expect(screen.getByTestId(readBtn(CLIENT_MSG_ID))).toBeTruthy();
    restoreOS = jest.replaceProperty(Platform, 'OS', 'web').restore;
    setThread({});
    expect(screen.getByText('Marked page.pdf')).toBeTruthy();
    expect(screen.queryByTestId(readBtn(CLIENT_MSG_ID))).toBeNull();
    expect(screen.queryByTestId(readBtn(FILES_ONLY_ID))).toBeNull();
  });

  it('not on a message older than the cut-off; a newer one keeps it', async () => {
    mockNotBefore = '2026-10-02T15:00:00.000Z';
    await mountRouteChecked(THREAD_URL);
    await settle();
    expect(screen.queryByTestId(readBtn(CLIENT_MSG_ID))).toBeNull(); // 14:05
    expect(screen.getByTestId(readBtn(FILES_ONLY_ID))).toBeTruthy(); // 15:10
  });

  it("not while the cut-off date is unset: the flag alone opens nothing ('' is the real value)", async () => {
    mockNotBefore = null;
    await mountRouteChecked(THREAD_URL);
    await settle();
    expect(screen.queryByTestId(readBtn(CLIENT_MSG_ID))).toBeNull();
    expect(screen.queryByTestId(readBtn(FILES_ONLY_ID))).toBeNull();
  });

  it('not on a pending message, and not on one whose files have no stored path', async () => {
    const noPath: PortalMessage = {
      ...filesOnly, id: 'c1000000-0000-4000-8000-000000000009',
      attachments: (filesOnly.attachments ?? []).map(({ path: _path, ...rest }) => ({ ...rest, id: fileId(30) })),
    };
    mockThread.value = { ...baseThread(), messages: [clientMessage, filesOnly, noPath], queuedIds: new Set([FILES_ONLY_ID]) };
    await mountRouteChecked(THREAD_URL);
    await settle();
    expect(screen.getByTestId(readBtn(CLIENT_MSG_ID))).toBeTruthy();
    expect(screen.getByTestId(`message-status-${FILES_ONLY_ID}`)).toBeTruthy();
    expect(screen.queryByTestId(readBtn(FILES_ONLY_ID))).toBeNull();
    expect(screen.queryByTestId(readBtn(noPath.id))).toBeNull();
  });
});

describe('flag on: the sheet', () => {
  beforeEach(() => {
    mockFlagOn = true;
    mockNotBefore = '2020-01-01T00:00:00.000Z';
    mockRole = 'owner';
  });

  it('lists the files, sends only the message id and the attachment ids, and shows the reading', async () => {
    mockAskFiles.mockResolvedValue(reading());
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);

    const will = within(screen.getByTestId('message-ai-will-read'));
    expect(will.getByText('MAGE will read:')).toBeTruthy();
    expect(will.getByText('Vanity wall.jpg')).toBeTruthy();
    expect(will.getByText('Marked page.pdf')).toBeTruthy();
    expect(screen.queryByTestId('message-ai-not-read')).toBeNull();
    expect(screen.getByText('The files and the message text go to Google Gemini to be read. Nothing is sent to your client.')).toBeTruthy();
    expect(screen.getByText('Counts as one of your monthly photo analyses.')).toBeTruthy();
    expect(mockAskFiles).not.toHaveBeenCalled();

    await press('message-ai-start');
    expect(mockAskFiles).toHaveBeenCalledTimes(1);
    expect(mockAskFiles.mock.calls[0]).toEqual([{
      feature: 'portal',
      files: [
        { source: 'message', messageId: CLIENT_MSG_ID, attachmentId: fileId(1) },
        { source: 'message', messageId: CLIENT_MSG_ID, attachmentId: fileId(2) },
      ],
    }]);
    // Nothing else about the files: no name, no path, no size, no body.
    expect(JSON.stringify(mockAskFiles.mock.calls[0])).not.toMatch(/Vanity|Marked|\.jpg|\.pdf|vanity light|path|size/);
    expect(mockSettle).not.toHaveBeenCalled();

    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByTestId('message-ai-summary').props.children).toBe(
      'The photo shows the vanity wall with the light box set low. The marked page circles the fixture.');
    expect(screen.getByText('What the client is asking for')).toBeTruthy();
    expect(screen.getByText('Move the vanity light up')).toBeTruthy();
    expect(screen.getByText('Confirm the new height before drywall')).toBeTruthy();
    const block = within(screen.getByTestId('ask-what-i-read'));
    expect(block.getByText('What I read')).toBeTruthy();
    expect(block.getByText('Vanity wall.jpg')).toBeTruthy();
    expect(block.getByText('PDF, 2 pages')).toBeTruthy();
    const draft = within(screen.getByTestId('message-ai-draft'));
    expect(draft.getByText('Raise the vanity light')).toBeTruthy();
    expect(draft.getByText('Client asks to raise the vanity light, per Marked page.pdf page 1.')).toBeTruthy();
    expect(screen.getByText("Drafted by MAGE from the client's message. Check it against the files before you save.")).toBeTruthy();
    expect(screen.getByText('This reading is not saved. Close it and it is gone.')).toBeTruthy();
    expect(screen.getByText('Nothing here is posted to the thread or sent to your client.')).toBeTruthy();
    expect(disabledOf('message-ai-co')).toBe(false);
    expect(disabledOf('message-ai-rfi')).toBe(false);
    expect(disabledOf('message-ai-punch')).toBe(false);
    // Nothing was posted to the thread and nothing was pushed anywhere.
    expect(mockThread.value.sendMessage).not.toHaveBeenCalled();
    expect(mockThread.value.sendWithAttachments).not.toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();

    // Close: the reading is gone; opening again starts from the list.
    await press('message-ai-close');
    expect(screen.queryByTestId('message-ai-sheet')).toBeNull();
    await openSheet(CLIENT_MSG_ID);
    expect(screen.getByTestId('message-ai-will-read')).toBeTruthy();
    expect(screen.queryByTestId('message-ai-summary')).toBeNull();
    expect(mockAskFiles).toHaveBeenCalledTimes(1);
  });

  it('a double tap on "Read files" starts one read, not two, and the sheet stays until the answer is in', async () => {
    let release: (v: unknown) => void = () => {};
    mockAskFiles.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    const start = screen.getByTestId('message-ai-start');
    await act(async () => { fireEvent.press(start); fireEvent.press(start); });
    expect(mockAskFiles).toHaveBeenCalledTimes(1);
    expect(within(screen.getByTestId('message-ai-reading')).getByText('Reading the files')).toBeTruthy();
    // The read is counted: while it runs there is no way to close the sheet.
    expect(screen.getByTestId('message-ai-sheet-close').props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId('message-ai-start')).toBeNull();
    expect(screen.queryByTestId('message-ai-close')).toBeNull();
    await act(async () => { release(reading()); });
    await act(async () => { for (let k = 0; k < 20; k++) await Promise.resolve(); });
    expect(screen.getByTestId('message-ai-summary')).toBeTruthy();
    expect(mockAskFiles).toHaveBeenCalledTimes(1);
  });

  it('a six-file message: four are read, two stay under "Not read" before and after, and the change order names only what was read', async () => {
    mockThread.value = { ...baseThread(), messages: [sixFiles] };
    mockAskFiles.mockResolvedValue(reading({
      read: ['a', 'b', 'c', 'd'].map((n, index) => ({ index, name: `${n}.jpg`, kind: 'image' as const })),
      draft: { title: 'Hallway touch-ups', description: 'Client asks to repaint the hallway wall.' },
    }));
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(SIX_ID);

    const will = within(screen.getByTestId('message-ai-will-read'));
    for (const n of ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']) expect(will.getByText(n)).toBeTruthy();
    expect(will.queryByText('e.jpg')).toBeNull();
    const notBefore = within(screen.getByTestId('message-ai-not-read'));
    expect(notBefore.getByText('Not read:')).toBeTruthy();
    expect(within(screen.getByTestId(`message-ai-not-read-${fileId(14)}`)).getByText('more than 4 files')).toBeTruthy();
    expect(within(screen.getByTestId(`message-ai-not-read-${fileId(15)}`)).getByText('more than 4 files')).toBeTruthy();

    await press('message-ai-start');
    const sent = (mockAskFiles.mock.calls[0][0] as { files: { attachmentId: string }[] }).files;
    expect(sent.map((f) => f.attachmentId)).toEqual([10, 11, 12, 13].map(fileId));

    // The result still says two were not read.
    expect(screen.getByTestId('message-ai-summary')).toBeTruthy();
    expect(within(screen.getByTestId(`message-ai-not-read-${fileId(14)}`)).getByText('e.jpg')).toBeTruthy();
    expect(within(screen.getByTestId(`message-ai-not-read-${fileId(15)}`)).getByText('more than 4 files')).toBeTruthy();

    await press('message-ai-co');
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const route = pushSpy.mock.calls[0][0] as { pathname: string; params: Record<string, string> };
    expect(route.pathname).toBe('/change-order');
    expect(Object.keys(route.params).sort()).toEqual(['prefillDescription', 'prefillReason', 'projectId']);
    expect(route.params.projectId).toBe(PROJECT_ID);
    expect(route.params.prefillReason).toBe('client_request');
    expect(route.params.prefillDescription).toBe('Client asks to repaint the hallway wall.\nFiles: a.jpg, b.jpg, c.jpg, d.jpg (2 more not read)');
    expect(route.params.prefillDescription.endsWith('Files: a.jpg, b.jpg, c.jpg, d.jpg (2 more not read)')).toBe(true);
    expect(JSON.stringify(route)).not.toMatch(/prefillAmount|prefillLines|prefillScheduleDays/);
    expect(screen.queryByTestId('message-ai-sheet')).toBeNull();
  });

  it('the RFI button passes an id, never the words; the RFI form opens with the draft', async () => {
    mockAskFiles.mockResolvedValue(reading());
    const tree = await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    await press('message-ai-rfi');
    await settle();

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const route = pushSpy.mock.calls[0][0] as { pathname: string; params: Record<string, string> };
    expect(route.pathname).toBe('/rfi');
    expect(Object.keys(route.params).sort()).toEqual(['prefillDraft', 'projectId']);
    expect(route.params.prefillDraft.length).toBeGreaterThanOrEqual(16);
    expect(JSON.stringify(route)).not.toMatch(/vanity|Raise|Client asks|Files:|Marked/i);
    const text = 'Client asks to raise the vanity light, per Marked page.pdf page 1.\nFiles: Vanity wall.jpg, Marked page.pdf';
    expect(readDraftHandoff(route.params.prefillDraft)).toEqual({ title: 'Raise the vanity light', description: text });

    // The form took the draft through the in-memory hand-over.
    expect(tree.getPathname()).toBe('/rfi');
    expect(screen.getByTestId('rfi-subject').props.value).toBe('Raise the vanity light');
    expect(screen.getByDisplayValue(text)).toBeTruthy();
  });

  it('the punch button passes an id, never the words; the punch form opens with the description', async () => {
    mockAskFiles.mockResolvedValue(reading());
    const tree = await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    await press('message-ai-punch');
    await settle();

    expect(pushSpy).toHaveBeenCalledTimes(1);
    const route = pushSpy.mock.calls[0][0] as { pathname: string; params: Record<string, string> };
    expect(route.pathname).toBe('/punch-list');
    expect(Object.keys(route.params).sort()).toEqual(['new', 'prefillDraft', 'projectId']);
    expect(route.params.new).toBe('1');
    expect(JSON.stringify(route)).not.toMatch(/vanity|Raise|Client asks|Files:|Marked/i);
    const text = 'Client asks to raise the vanity light, per Marked page.pdf page 1.\nFiles: Vanity wall.jpg, Marked page.pdf';
    expect(readDraftHandoff(route.params.prefillDraft)?.description).toBe(text);

    expect(tree.getPathname()).toBe('/punch-list');
    expect(screen.getByTestId('punch-desc-input').props.value).toBe(text);
  });

  it('a Free account sees why it is locked and where the plans are; nothing is sent', async () => {
    mockTier = 'free';
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    expect(screen.getByText('Reading client files with MAGE is on the Pro plan.')).toBeTruthy();
    expect(disabledOf('message-ai-start')).toBe(true);
    await press('message-ai-start');
    expect(mockAskFiles).not.toHaveBeenCalled();
    expect(screen.getByTestId('message-ai-will-read')).toBeTruthy();
    await press('message-ai-see-plans');
    expect(pushSpy).toHaveBeenCalledWith('/paywall');
    expect(mockAskFiles).not.toHaveBeenCalled();
  });

  it('AI declined on this phone: the gate\'s sentence, no Retry', async () => {
    mockAskFiles.mockResolvedValue({ ok: false, code: AI_CONSENT_DECLINED_CODE, message: AI_CONSENT_OFF_MESSAGE });
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(screen.getByTestId('message-ai-failure').props.children).toBe(AI_CONSENT_OFF_MESSAGE);
    expect(screen.queryByTestId('message-ai-retry')).toBeNull();
    expect(screen.getByTestId('message-ai-close')).toBeTruthy();
    expect(mockAskFiles).toHaveBeenCalledTimes(1);
    expect(mockSettle).not.toHaveBeenCalled();
  });

  it('the account has not allowed AI: waits for the sync, asks exactly once more, then says nothing went to Google', async () => {
    mockAskFiles.mockResolvedValue({ ok: false, code: 'account_ai_off', message: '' });
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(mockSettle).toHaveBeenCalledTimes(1);
    expect(mockAskFiles).toHaveBeenCalledTimes(2);
    expect(mockAskFiles.mock.calls[1]).toEqual(mockAskFiles.mock.calls[0]);
    expect(mockSettle.mock.invocationCallOrder[0]).toBeGreaterThan(mockAskFiles.mock.invocationCallOrder[0]);
    expect(mockSettle.mock.invocationCallOrder[0]).toBeLessThan(mockAskFiles.mock.invocationCallOrder[1]);
    expect(screen.getByTestId('message-ai-failure').props.children).toBe(
      'Your account has not allowed AI features, so nothing was sent to Google. Check Settings → AI features, then try again.');
    expect(screen.getByTestId('message-ai-retry')).toBeTruthy();
  });

  it('a yes that was still on its way: the second try after the sync is the reading', async () => {
    mockAskFiles.mockResolvedValueOnce({ ok: false, code: 'account_ai_off', message: '' }).mockResolvedValueOnce(reading());
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(mockSettle).toHaveBeenCalledTimes(1);
    expect(mockAskFiles).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('message-ai-summary')).toBeTruthy();
  });

  it('the account setting could not be checked, and a message from before the notice: their own sentences', async () => {
    mockAskFiles.mockResolvedValueOnce({ ok: false, code: 'ai_check_unavailable', message: '' })
      .mockResolvedValueOnce({ ok: false, code: 'before_notice', message: '' });
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(screen.getByTestId('message-ai-failure').props.children).toBe("MAGE couldn't check your account's AI setting. Try again in a minute.");
    expect(mockSettle).not.toHaveBeenCalled();
    // Retry goes back and runs again.
    await press('message-ai-retry');
    expect(mockAskFiles).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('message-ai-failure').props.children).toBe(
      'This message was sent before your client was told about AI reading, so MAGE does not read it.');
    expect(screen.queryByTestId('message-ai-retry')).toBeNull();
  });

  it('a PDF over the page limit moves to "Not read" and "Read files" then sends the others only', async () => {
    mockThread.value = { ...baseThread(), messages: [threeFiles] };
    mockAskFiles
      .mockResolvedValueOnce({ ok: false, code: 'too_many_pages', message: '', fileIndex: 1, pages: 31, limit: 20 })
      .mockResolvedValueOnce(reading({
        read: [{ index: 0, name: 'Front.jpg', kind: 'image' }, { index: 1, name: 'Back.jpg', kind: 'image' }],
        draft: { title: 'Siding repair', description: 'Client asks to repair the siding.' },
      }));
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(THREE_ID);
    await press('message-ai-start');

    // Back on the list, with the reason, and the file under "Not read".
    expect(screen.queryByTestId('message-ai-failure')).toBeNull();
    expect(screen.getByTestId('message-ai-list-note').props.children).toBe(
      'Whole spec.pdf has 31 pages. MAGE reads PDFs up to 20 pages. Send the pages you need as a shorter PDF or as photos.');
    const row = within(screen.getByTestId(`message-ai-not-read-${fileId(21)}`));
    expect(row.getByText('Whole spec.pdf')).toBeTruthy();
    expect(row.getByText('more than 20 pages')).toBeTruthy();
    const will = within(screen.getByTestId('message-ai-will-read'));
    expect(will.getByText('Front.jpg')).toBeTruthy();
    expect(will.getByText('Back.jpg')).toBeTruthy();
    expect(will.queryByText('Whole spec.pdf')).toBeNull();

    await press('message-ai-start');
    expect(mockAskFiles).toHaveBeenCalledTimes(2);
    const second = (mockAskFiles.mock.calls[1][0] as { files: { attachmentId: string }[] }).files;
    expect(second.map((f) => f.attachmentId)).toEqual([fileId(20), fileId(22)]);
    // The result keeps the PDF under "Not read", and the draft says one was left out.
    expect(within(screen.getByTestId(`message-ai-not-read-${fileId(21)}`)).getByText('more than 20 pages')).toBeTruthy();
    await press('message-ai-co');
    const route = pushSpy.mock.calls[0][0] as { params: Record<string, string> };
    expect(route.params.prefillDescription).toBe('Client asks to repair the siding.\nFiles: Front.jpg, Back.jpg (1 more not read)');
  });

  it('no request found: says so, offers no draft, and all three buttons are off', async () => {
    mockAskFiles.mockResolvedValue(reading({ asks: [], draft: null }));
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(screen.getByText('MAGE found no request in the message or the files it read.')).toBeTruthy();
    expect(screen.getByText('No draft, because MAGE found no request.')).toBeTruthy();
    expect(screen.queryByTestId('message-ai-draft')).toBeNull();
    expect(disabledOf('message-ai-co')).toBe(true);
    expect(disabledOf('message-ai-rfi')).toBe(true);
    expect(disabledOf('message-ai-punch')).toBe(true);
    await press('message-ai-co');
    await press('message-ai-rfi');
    await press('message-ai-punch');
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('a Pro account: the punch button is off and says punch lists are on the Business plan', async () => {
    mockTier = 'pro';
    mockAskFiles.mockResolvedValue(reading());
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(disabledOf('message-ai-co')).toBe(false);
    expect(disabledOf('message-ai-rfi')).toBe(false);
    expect(disabledOf('message-ai-punch')).toBe(true);
    expect(screen.getByText('Punch lists are on the Business plan.')).toBeTruthy();
    await press('message-ai-punch');
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('the monthly allowance is used up on Pro: the server\'s sentence and a way to the plans', async () => {
    mockTier = 'pro';
    const sentence = "You've used all 50 photo analyses for this month. They reset on Nov 1.";
    mockAskFiles.mockResolvedValue({ ok: false, code: 'monthly_cap_reached', message: sentence });
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(screen.getByTestId('message-ai-failure').props.children).toBe(sentence);
    expect(screen.getByTestId('message-ai-see-plans')).toBeTruthy();
    expect(screen.getByTestId('message-ai-retry')).toBeTruthy();
  });

  it('a cut-short answer says so, and the read block says MAGE may not have got through all of it', async () => {
    mockAskFiles.mockResolvedValue(reading({ truncated: true, asks: [], draft: null }));
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(screen.getByText('MAGE\'s answer stops partway. Try a narrower question.')).toBeTruthy();
    expect(within(screen.getByTestId('ask-what-i-read')).getByText('MAGE may not have got through all of it.')).toBeTruthy();
  });

  it('text that reads like quoted building-code is left out before it is drawn, and the sheet says so once', async () => {
    mockAskFiles.mockResolvedValue(reading({
      summary: 'The photo shows a stair with open risers. IRC R311.7 reads "made-up quoted words standing in for code text".',
      asks: ['Close the risers'],
      draft: { title: 'Stair risers', description: 'NFPA 101 says "made-up quoted words standing in for code text".' },
    }));
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(screen.getByTestId('message-ai-summary').props.children).toBe('The photo shows a stair with open risers.');
    expect(screen.queryByText(/made-up quoted words/)).toBeNull();
    expect(screen.getAllByText('MAGE left out a part that read like building-code text. Read the section in the code itself.')).toHaveLength(1);
    // The draft's description was emptied by the gate, so there is no draft.
    expect(screen.queryByTestId('message-ai-draft')).toBeNull();
    expect(disabledOf('message-ai-co')).toBe(true);
  });

  it('a code named only in the summary still holds code text in the draft: the change order opens without it', async () => {
    // Made-up code-shaped text. The draft itself names no code; the summary does.
    const body = 'Guards shall be provided for those portions of open-sided walking surfaces, including stairs, ramps and landings, '
      + 'that are located more than 30 inches measured vertically to the floor or grade below at any point within 36 inches '
      + 'horizontally to the edge of the open side.';
    mockAskFiles.mockResolvedValue(reading({
      summary: 'The client sent a photo of the stair guard and a page from IRC R312.1 about guards.',
      asks: ['Confirm the guard height', body],
      draft: { title: 'Stair guard', description: `Client asks to confirm the guard. ${body}` },
    }));
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(screen.getByTestId('message-ai-summary').props.children).toBe('The client sent a photo of the stair guard and a page from IRC R312.1 about guards.');
    expect(screen.queryByText(/Guards shall be provided/)).toBeNull();
    expect(screen.getByTestId('message-ai-ask-0').props.children).toBe('Confirm the guard height');
    expect(screen.queryByTestId('message-ai-ask-1')).toBeNull();
    expect(within(screen.getByTestId('message-ai-draft')).getByText('Client asks to confirm the guard.')).toBeTruthy();
    expect(screen.getAllByText('MAGE left out a part that read like building-code text. Read the section in the code itself.')).toHaveLength(1);
    await press('message-ai-co');
    const route = pushSpy.mock.calls[0][0] as { pathname: string; params: Record<string, string> };
    expect(route.pathname).toBe('/change-order');
    expect(route.params.prefillDescription).toBe('Client asks to confirm the guard.\nFiles: Vanity wall.jpg, Marked page.pdf');
    expect(JSON.stringify(route)).not.toMatch(/shall be provided/);
  });

  it('the AI service failed: its sentence, Retry and Close; the thread is untouched', async () => {
    mockAskFiles.mockResolvedValue({ ok: false, code: 'upstream_error', message: '' });
    await mountRouteChecked(THREAD_URL);
    await settle();
    await openSheet(CLIENT_MSG_ID);
    await press('message-ai-start');
    expect(screen.getByTestId('message-ai-failure').props.children).toBe("The AI service didn't answer. Try again in a minute.");
    expect(screen.getByTestId('message-ai-retry')).toBeTruthy();
    expect(screen.queryByTestId('message-ai-see-plans')).toBeNull();
    expect(mockThread.value.sendMessage).not.toHaveBeenCalled();
    expect(mockThread.value.sendWithAttachments).not.toHaveBeenCalled();
  });
});
