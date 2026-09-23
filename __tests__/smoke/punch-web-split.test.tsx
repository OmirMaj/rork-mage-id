// Smoke: the punch add/edit sheet as the web 75/25 panel (punch-web-export lane).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld, settle } from '@/__tests__/helpers/mountRoute';
import { PROJECT_ID } from '@/__tests__/fixtures/world';

let mockLayout: 'split' | 'sheet' = 'split';
jest.mock('@/utils/punchEditLayout', () => {
  const actual = jest.requireActual('@/utils/punchEditLayout');
  return { ...actual, punchEditLayout: () => mockLayout };
});
// Pass-through spy: ProjectContext's own staging and the panel's replacement
// upload both land here, so the test can see WHERE the bytes are sent.
jest.mock('@/utils/photoUploadQueue', () => {
  const actual = jest.requireActual('@/utils/photoUploadQueue');
  return { ...actual, queuePhotoUpload: jest.fn((input: unknown) => actual.queuePhotoUpload(input)) };
});
const picker = jest.requireMock('expo-image-picker') as { launchImageLibraryAsync: jest.Mock };
const photoQueue = jest.requireMock('@/utils/photoUploadQueue') as { queuePhotoUpload: jest.Mock };
// What the web file chooser really returns: a blob: URL (no extension) + File.type.
const BLOB = 'blob:https://app.mageid.app/0b1c2d3e-smoke';

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}
async function stored() {
  const raw = await AsyncStorage.getItem('mageid_punch_items');
  const parsed = JSON.parse(raw!);
  return (Array.isArray(parsed) ? parsed : parsed.data) as Array<Record<string, unknown>>;
}

describe('punch web split panel', () => {
  jest.setTimeout(60000);
  beforeEach(async () => {
    await primeWorld('populated');
    photoQueue.queuePhotoUpload.mockClear();
    picker.launchImageLibraryAsync.mockImplementation(async () => ({ canceled: false, assets: [{ uri: BLOB, mimeType: 'image/png' }] }));
  });

  it('new item: split panel, Add photo from a file, saved with the photo', async () => {
    mockLayout = 'split';
    await mountRouteChecked(`/punch-list?projectId=${PROJECT_ID}`);
    await pump();
    fireEvent.press(screen.getByTestId('add-punch-item'));
    await pump();
    expect(screen.getByTestId('punch-edit-split')).toBeTruthy();
    expect(screen.getByTestId('punch-edit-photo-pane')).toBeTruthy();
    expect(screen.getByTestId('punch-desc-input')).toBeTruthy();
    expect(screen.getByTestId('punch-due-field')).toBeTruthy();
    expect(screen.getByTestId('punch-form-pin')).toBeTruthy();
    expect(screen.queryByTestId('punch-edit-photo')).toBeNull();
    // The pane reads its width from onLayout.
    fireEvent(screen.getByTestId('punch-edit-photo-pane').findAll((n: { props: { onLayout?: unknown } }) => typeof n.props.onLayout === 'function')[0], 'layout', { nativeEvent: { layout: { width: 280, height: 600, x: 0, y: 0 } } });
    fireEvent.press(screen.getByTestId('punch-edit-photo-add'));
    await pump();
    expect(screen.getByTestId('punch-edit-photo')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('punch-desc-input'), 'SMOKE split item');
    fireEvent.press(screen.getByTestId('save-punch-item'));
    await pump(10);
    await settle();
    const it = (await stored()).find(p => p.description === 'SMOKE split item');
    expect(it).toBeTruthy();
    expect(it!.photoUri).toBe(BLOB);
  });

  it('existing item: Replace is pending until Update, then uploaded under a NEW key and written', async () => {
    mockLayout = 'split';
    await mountRouteChecked(`/punch-list?projectId=${PROJECT_ID}`);
    await pump();
    const before = await stored();
    const target = before.find(p => p.id === 'punch-1')!;
    fireEvent.press(screen.getAllByText(String(target.description))[0]);
    await pump();
    expect(screen.getByTestId('punch-edit-split')).toBeTruthy();
    const photoAdd = screen.queryByTestId('punch-edit-photo-add');
    const replace = screen.queryByTestId('punch-edit-photo-replace');
    fireEvent.press((photoAdd ?? replace)!);
    await pump();
    expect(screen.getByTestId('punch-edit-photo-pending')).toBeTruthy();
    // Not written yet.
    expect((await stored()).find(p => p.id === 'punch-1')!.photoUri).toBe(target.photoUri);
    fireEvent.press(screen.getByTestId('save-punch-item'));
    await pump(10);
    await settle();
    const after = (await stored()).find(p => p.id === 'punch-1')!;
    expect(after.photoUri).toBe(BLOB);
    // The bytes go to the replacement's own object — never the item's
    // `punch-punch-1.<ext>` key, where Storage would answer 409 and the queue
    // would drop the upload as "already uploaded" (review, round 1).
    const sent = photoQueue.queuePhotoUpload.mock.calls.map(c => c[0] as { localUri: string; storagePath: string; contentType: string });
    const mine = sent.filter(c => c.localUri === BLOB);
    expect(mine).toHaveLength(1);
    expect(mine[0].storagePath).toMatch(/\/punch-punch-1-r[0-9a-z]+\.png$/);
    expect(mine[0].contentType).toBe('image/png');
    expect(after.photoStoragePath).toBe(mine[0].storagePath);
    expect(after.photoStoragePath).not.toBe(target.photoStoragePath);
  });

  it('phone: the bottom sheet, no split', async () => {
    mockLayout = 'sheet';
    await mountRouteChecked(`/punch-list?projectId=${PROJECT_ID}`);
    await pump();
    fireEvent.press(screen.getByTestId('add-punch-item'));
    await pump();
    expect(screen.queryByTestId('punch-edit-split')).toBeNull();
    expect(screen.queryByTestId('punch-edit-photo-pane')).toBeNull();
    expect(screen.getByTestId('punch-desc-input')).toBeTruthy();
  });
});
