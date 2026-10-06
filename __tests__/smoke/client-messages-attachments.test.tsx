/**
 * Track MSG, lane MSGAPP — the contractor's client thread with photos and
 * PDFs. BEHAVIOUR ONLY, no snapshot.
 *
 * usePortalThread is replaced in this file so the thread holds exactly:
 *   - one client message with a photo and a 1.2 MB PDF,
 *   - one text message that is only in the offline queue,
 *   - one file message whose upload failed (an outbox entry),
 *   - one contractor message that is ONLY a PDF (no text, so no bubble).
 * Asserted: the PDF chip's name and "PDF · 1.2 MB"; the photo tile's label;
 * "Waiting to Send" on the queued one with NO time; "Not sent" with Retry and
 * Remove on the failed one; Retry calls retryOutbox with the entry's id; the
 * contractor's PDF-only chip carries its own fill, so its white ink never
 * sits on the page background.
 */
import { StyleSheet } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { Colors } from '@/constants/colors';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, PORTAL_ID } from '@/__tests__/fixtures/world';
import type { PortalMessage } from '@/types';
import type { OutboxEntry } from '@/utils/messageAttachments';

const CLIENT_MSG_ID = 'c0000000-0000-4000-8000-000000000001';
const QUEUED_ID = 'c0000000-0000-4000-8000-000000000002';
const FAILED_ID = 'c0000000-0000-4000-8000-000000000003';
const PHOTO_ID = 'f0000000-0000-4000-8000-000000000001';
const PDF_ID = 'f0000000-0000-4000-8000-000000000002';
const FAILED_FILE_ID = 'f0000000-0000-4000-8000-000000000003';
const GC_PDF_MSG_ID = 'c0000000-0000-4000-8000-000000000004';
const GC_PDF_ID = 'f0000000-0000-4000-8000-000000000004';

const clientMessage: PortalMessage = {
  id: CLIENT_MSG_ID,
  projectId: PROJECT_ID,
  portalId: PORTAL_ID,
  authorType: 'client',
  authorName: 'Meredith',
  body: 'Here is the tile we picked and the signed change order.',
  createdAt: '2026-10-02T14:05:00.000Z',
  readByGc: true,
  readByClient: true,
  attachments: [
    { id: PHOTO_ID, name: 'IMG_2231.jpg', mime: 'image/jpeg', size: 812345, kind: 'image', width: 1200, height: 900, path: `${PROJECT_ID}/${CLIENT_MSG_ID}/${PHOTO_ID}.jpg` },
    { id: PDF_ID, name: 'Change order 4.pdf', mime: 'application/pdf', size: 1258291, kind: 'pdf', path: `${PROJECT_ID}/${CLIENT_MSG_ID}/${PDF_ID}.pdf` },
  ],
};

// A contractor message that is only a PDF: the grid has no bubble behind it.
const gcPdfOnly: PortalMessage = {
  id: GC_PDF_MSG_ID,
  projectId: PROJECT_ID,
  portalId: PORTAL_ID,
  authorType: 'gc',
  authorName: 'Ace GC',
  body: '',
  createdAt: '2026-10-02T14:30:00.000Z',
  readByGc: true,
  readByClient: false,
  attachments: [
    { id: GC_PDF_ID, name: 'CO 4 signed.pdf', mime: 'application/pdf', size: 204800, kind: 'pdf', path: `${PROJECT_ID}/${GC_PDF_MSG_ID}/${GC_PDF_ID}.pdf` },
  ],
};

const queuedMessage: PortalMessage = {
  id: QUEUED_ID,
  projectId: PROJECT_ID,
  portalId: PORTAL_ID,
  authorType: 'gc',
  authorName: 'Ace GC',
  body: 'Got it, ordering Monday.',
  createdAt: '2026-10-02T14:47:00.000Z',
  readByGc: true,
  readByClient: false,
  attachments: [],
};

const failedEntry: OutboxEntry = {
  id: FAILED_ID,
  userId: 'smoke-user',
  projectId: PROJECT_ID,
  portalId: PORTAL_ID,
  body: 'Photos of the rough-in',
  authorName: 'Ace GC',
  createdAt: '2026-10-02T14:52:00.000Z',
  phase: 'failed',
  failReason: 'server',
  attachments: [{
    id: FAILED_FILE_ID, name: 'Rough-in.jpg', mime: 'image/jpeg', size: 400000, kind: 'image',
    path: `${PROJECT_ID}/${FAILED_ID}/${FAILED_FILE_ID}.jpg`,
    localUri: 'file:///doc/mageid-msg-outbox/rough-in.jpg', state: 'failed', failReason: 'server', tries: 5, rlsTries: 0,
  }],
};

const mockRetryOutbox = jest.fn(async (_id: string) => {});
const mockRemoveOutbox = jest.fn(async (_id: string) => {});
const mockThread = {
  messages: [clientMessage, gcPdfOnly, queuedMessage],
  unreadFromClient: [] as PortalMessage[],
  coApprovals: [],
  sendMessage: jest.fn(async () => 'synced'),
  sendClientMessage: jest.fn(),
  markRead: jest.fn(),
  isSending: false,
  isSendingClient: false,
  refetchMessages: jest.fn(async () => ({})),
  refetchApprovals: jest.fn(async () => ({})),
  outbox: [failedEntry],
  queuedIds: new Set([QUEUED_ID]) as ReadonlySet<string>,
  sendWithAttachments: jest.fn(async () => {}),
  retryOutbox: mockRetryOutbox,
  removeOutbox: mockRemoveOutbox,
};
jest.mock('@/hooks/usePortalThread', () => ({ usePortalThread: () => mockThread }));

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

describe('client thread: photos, PDFs and messages that are not sent yet', () => {
  jest.setTimeout(120000);

  beforeEach(async () => {
    allowConsoleErrors();
    mockRetryOutbox.mockClear();
    mockRemoveOutbox.mockClear();
    await primeWorld('populated');
  });

  it('draws the files, the waiting line without a time, and Not sent with Retry and Remove', async () => {
    await mountRouteChecked(`/client-messages?id=${PROJECT_ID}`);
    await settle();

    // The client's PDF: its name and "PDF · 1.2 MB".
    expect(screen.getByText('Change order 4.pdf')).toBeTruthy();
    expect(screen.getByText('PDF · 1.2 MB')).toBeTruthy();
    expect(screen.getByLabelText('Change order 4.pdf, PDF, 1.2 MB. Opens the file.')).toBeTruthy();
    // The client's photo tile.
    expect(screen.getByLabelText('Photo IMG_2231.jpg. Opens full screen.')).toBeTruthy();

    // The sent client message keeps its time.
    expect(screen.getByText(timeOf(clientMessage.createdAt))).toBeTruthy();

    // The queued text message: "Waiting to Send", and no time label.
    expect(screen.getByTestId(`message-status-${QUEUED_ID}`)).toBeTruthy();
    expect(screen.getByText('Waiting to Send')).toBeTruthy();
    expect(screen.queryByText(timeOf(queuedMessage.createdAt))).toBeNull();

    // The failed file message: "Not sent", its reason, Retry and Remove, no time.
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(screen.getByText("The upload didn't finish. Retry when you have a good connection.")).toBeTruthy();
    expect(screen.getByTestId(`message-status-${FAILED_ID}-retry`)).toBeTruthy();
    expect(screen.getByTestId(`message-status-${FAILED_ID}-remove`)).toBeTruthy();
    expect(screen.queryByText(timeOf(failedEntry.createdAt))).toBeNull();
    // Its photo is drawn from the device copy, with the same label.
    expect(screen.getByLabelText('Photo Rough-in.jpg. Opens full screen.')).toBeTruthy();

    // The contractor's PDF-only message: the chip is filled (not transparent)
    // and its white name ink sits on that fill, never on the page.
    const gcChip = screen.getByTestId(`attachment-pdf-${GC_PDF_ID}`);
    const gcChipBg = StyleSheet.flatten(gcChip.props.style).backgroundColor;
    expect(gcChipBg).toBeTruthy();
    expect(gcChipBg).not.toBe('transparent');
    const gcName = screen.getByText('CO 4 signed.pdf');
    expect(StyleSheet.flatten(gcName.props.style).color).toBe(Colors.textOnAccent);
    expect(String(gcChipBg).toLowerCase()).not.toBe(String(Colors.textOnAccent).toLowerCase());
    // The client's PDF, on a light surface chip, keeps its own surface fill.
    const clientChipBg = StyleSheet.flatten(screen.getByTestId(`attachment-pdf-${PDF_ID}`).props.style).backgroundColor;
    expect(clientChipBg).toBeTruthy();
    expect(clientChipBg).not.toBe('transparent');

    await act(async () => { fireEvent.press(screen.getByTestId(`message-status-${FAILED_ID}-retry`)); });
    expect(mockRetryOutbox).toHaveBeenCalledTimes(1);
    expect(mockRetryOutbox).toHaveBeenCalledWith(FAILED_ID);
    expect(mockRemoveOutbox).not.toHaveBeenCalled();
  });
});
