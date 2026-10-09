/**
 * Smoke — Scan The Room, the Order List and What Your Tape Says (lane
 * SCANORDER), mounted from the hand-built fixtures with the real cores. Only
 * the contexts, the router, the cost book, the clipboard, the share sheet and
 * the device storage are stood in for.
 *
 *   SO1 The Order List opens from The Quantities. The first thing on it is
 *       that a phone scan can be off by an inch or more. The bathroom's
 *       numbers are the hand-worked ones, each rule of thumb is labelled, and
 *       a wall's cut layout is drawn.
 *   SO2 A changed choice works the list out again.
 *   SO3 A typed quantity is kept, marked, and survives another choice.
 *   SO4 Copy As Text copies NOTHING until the yes on its sheet.
 *   SO5 Share The List opens NOTHING until the yes on its sheet.
 *   SO6 Add Materials To Estimate writes NOTHING until the yes, then puts the
 *       priced material lines in, each from a catalog price or a typed one.
 *   SO7 What Your Tape Says: not enough with four walls; the facts with
 *       fourteen; a suggestion that changes nothing until it is accepted.
 *   SO8 A typed wall makes a pair, and his tape list is written only on Save.
 *   SO9 A room that cannot be priced cannot open the order list.
 *
 * The pure rules have their own direct tests with planted mutations in
 * scripts/validate-scan-order.ts.
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanupAsync, fireEvent, render } from '@testing-library/react-native';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: () => {}, replace: () => {} }),
  useLocalSearchParams: () => ({ projectId: 'proj-1' }),
  Stack: { Screen: () => null },
}));

const EST = {
  id: 'est-1', globalMarkup: 20, baseTotal: 1000, markupTotal: 200, grandTotal: 1200, createdAt: '2026-09-01T00:00:00.000Z',
  items: [{ materialId: 'm1', name: 'Demo', category: 'Demolition', unit: 'LS', quantity: 1, unitPrice: 1000, bulkPrice: 1000, markup: 20, usesBulk: false, lineTotal: 1200, supplier: '' }],
};
let mockProject: Record<string, unknown> | null = { id: 'proj-1', name: 'Maple St', linkedEstimate: EST, estimateVersions: [] };
const mockUpdateProject = jest.fn((_id: string, patch: Record<string, unknown>) => {
  if (mockProject) mockProject = { ...mockProject, ...patch };
});
jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({ getProject: () => mockProject, updateProject: mockUpdateProject, settings: { location: '' } }),
}));
jest.mock('@/contexts/MaterialCartContext', () => ({ useMaterialCart: () => ({ globalMarkup: 20, markupDecided: true }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
jest.mock('@/hooks/useScopeCostBook', () => {
  const { buildCostDatabase } = jest.requireActual('@/utils/costDatabase');
  // His book has an INSTALLED drywall rate by the piece. It must not price a sheet.
  const db = buildCostDatabase([], [], [], [], [{ id: 's1', trade: 'Drywall', unit: 'EA', rate: 55 }]);
  return { useScopeCostBook: () => db };
});

const mockSaveScan = jest.fn(async (_saved?: unknown, _raw?: unknown) => true);
jest.mock('@/utils/roomScan/store', () => ({
  loadSavedScans: async () => ({ version: 1, scans: [] }),
  saveScan: (saved: unknown, raw: unknown) => mockSaveScan(saved, raw),
  hashRawScan: async () => 'hash',
  deleteScan: async () => true,
}));

let mockTapeLog: unknown[] = [];
const mockRecordTapePairs = jest.fn(async (_userId: unknown, pairs: unknown[]) => { mockTapeLog = [...pairs, ...mockTapeLog]; return mockTapeLog; });
jest.mock('@/utils/roomScan/learnStore', () => ({
  loadTapePairs: async () => mockTapeLog,
  recordTapePairs: (userId: unknown, pairs: unknown[]) => mockRecordTapePairs(userId, pairs),
  forgetScanTapePairs: async () => {},
}));

const mockCopy = jest.fn(async (_text: string) => true);
jest.mock('@/utils/clipboard', () => ({ copyToClipboard: (text: string) => mockCopy(text) }));
const mockShare = jest.fn(async (_opts: { message: string }) => 'shared');
jest.mock('@/utils/shareText', () => ({ shareText: (opts: { message: string }) => mockShare(opts), canShare: () => true }));

jest.mock('@/utils/roomScan/native', () => ({
  getCapabilities: () => null, startScan: jest.fn(), isModuleLinked: () => false, roomScanErrorCode: () => null,
}));

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RoomScanFlow } from '@/components/roomScan/RoomScanFlow';
import { parseCapturedRoom } from '@/utils/roomScan/capturedRoomParser';
import { buildRoomScan } from '@/utils/roomScan/geometryCore';
import { lengthClass, type TapePair } from '@/utils/roomScan/learnCore';
import { defaultOrderOptions } from '@/utils/roomScan/orderListCore';
import type { SavedScan } from '@/utils/roomScan/storeCore';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
);

function room(file: string, name = 'Hall Bathroom'): SavedScan {
  const raw = fs.readFileSync(path.resolve(__dirname, `../../scripts/fixtures/scan-room/${file}.json`), 'utf8');
  const scan = buildRoomScan(parseCapturedRoom(raw), {
    id: 'scan-1', projectId: 'proj-1', name, capturedAt: '2026-10-06T13:41:00.000Z', device: { model: 'iPhone16,1', os: '17.5' },
  });
  // Every kind of material on, the way the validator's hand-worked bathroom has it.
  const order = defaultOrderOptions(scan.roomType);
  return { scan, pushed: {}, manualRates: {}, excluded: [], savedAt: '', pricedAt: null, order: { ...order, groups: { ...order.groups, drywall: true } } };
}
const settle = async () => { await act(async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); }); };
type Node = { children: (Node | string)[] };
const textOf = (n: Node): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

/** A taped wall for the history: the scan said `scanFt`, the tape read `diffIn` more. */
function pair(i: number, scanFt: number, diffIn: number): TapePair {
  const scannedM = scanFt / 3.28084;
  return { scanId: `hist-${i}`, wallId: `w-${i}`, scannedM, tapedM: scannedM + diffIn * 0.0254, lengthClass: lengthClass(scannedM), deviceModel: 'iPhone16,1', roomType: 'room', at: `2026-09-${String(10 + i).padStart(2, '0')}T12:00:00.000Z` };
}
const HISTORY: TapePair[] = [
  ...[0, 0.25, 0.25, -0.25, 0.5, 0.5, -0.5, 0.5, 1].map((d, i) => pair(i, 5 + i * 0.7, d)),
  ...[0.75, 1, 1.5, 2, 2.5].map((d, i) => pair(9 + i, 12 + i * 2, d)),
];

async function openOrder(saved: SavedScan) {
  const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={saved} />, { wrapper: Wrap });
  await settle();
  fireEvent.press(tree.getByTestId('scan-see-quantities'));
  await settle();
  fireEvent.press(tree.getByTestId('scan-order-open'));
  await settle();
  return tree;
}

beforeEach(() => {
  mockPush.mockClear(); mockUpdateProject.mockClear(); mockSaveScan.mockClear(); mockCopy.mockClear(); mockShare.mockClear(); mockRecordTapePairs.mockClear();
  mockProject = { id: 'proj-1', name: 'Maple St', linkedEstimate: EST, estimateVersions: [] };
  mockTapeLog = [];
});
afterEach(async () => { await cleanupAsync(); });

describe('Scan The Room — the Order List from the fixtures', () => {
  it('SO1 the bathroom list: the notice first, the hand-worked numbers, the rules of thumb labelled, a layout drawn', async () => {
    const tree = await openOrder(room('bathroom'));
    expect(tree.getByTestId('scan-order')).toBeTruthy();
    expect(textOf(tree.getByTestId('scan-order-notice') as unknown as Node)).toBe('A phone scan can be off by an inch or more. Check before you order.');
    const want: Record<string, string> = {
      drywall_walls: '7 sheets', drywall_ceiling: '2 sheets', screws: '1 box, 5 lb', compound: '1 bucket, 5 gal', tape: '1 roll, 500 ft',
      corner_bead: '0 sticks, 10 ft each', floor: '46 sq ft', paint_walls: '2 gallons', paint_ceiling: '1 gallon', primer: '1 gallon',
      'baseboard:12': '1 stick', 'baseboard:16': '1 stick', 'crown:16': '2 sticks', 'casing:12': '1 stick', 'casing:16': '1 stick',
    };
    for (const [key, qty] of Object.entries(want)) expect(tree.getByTestId(`scan-order-qty-${key}`).props.children).toBe(qty);
    for (const key of ['screws', 'compound', 'tape', 'corner_bead']) {
      expect(textOf(tree.getByTestId(`scan-order-rot-${key}`) as unknown as Node)).toBe('Rule Of Thumb');
      expect(textOf(tree.getByTestId(`scan-order-basis-${key}`) as unknown as Node)).toMatch(/^Rule of thumb: /);
    }
    for (const key of ['drywall_walls', 'floor', 'paint_walls', 'baseboard:16']) expect(tree.queryByTestId(`scan-order-rot-${key}`)).toBeNull();
    expect(textOf(tree.getByTestId('scan-order-basis-floor') as unknown as Node)).toBe('41.5 sq ft of floor plus 10 percent comes to 46 sq ft. A straight layout takes 10 percent.');
    expect(textOf(tree.getByTestId('scan-order-basis-paint_walls') as unknown as Node)).toBe('189.3 sq ft, 2 coats, one gallon to 350 sq ft, comes to 1.1 gallons. Rounded up to whole gallons.');
    expect(tree.getByTestId('scan-order-layout-drawing')).toBeTruthy();
    expect(tree.getByText('16 ft stick: 8 ft 2 in, 5 ft 1 in, 2 ft 2 in, 0 ft 5 in. Left over: 0 ft 2 in')).toBeTruthy();
    // Nothing has left the screen.
    expect(mockCopy).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
    expect(mockUpdateProject).not.toHaveBeenCalled();
    expect(mockSaveScan).not.toHaveBeenCalled();
  });

  it('SO2 a changed choice works the list out again', async () => {
    const tree = await openOrder(room('bathroom'));
    fireEvent.press(tree.getByTestId('scan-order-sheet-4x12'));
    await settle();
    expect(tree.getByTestId('scan-order-qty-drywall_walls').props.children).toBe('6 sheets');
    fireEvent.press(tree.getByTestId('scan-order-layout-herringbone'));
    await settle();
    expect(tree.getByTestId('scan-order-qty-floor').props.children).toBe('50 sq ft');
    fireEvent.press(tree.getByTestId('scan-order-coats-1'));
    await settle();
    expect(tree.getByTestId('scan-order-qty-paint_walls').props.children).toBe('1 gallon');
    fireEvent.press(tree.getByTestId('scan-order-group-trim'));
    await settle();
    expect(tree.queryByTestId('scan-order-qty-baseboard:16')).toBeNull();
    expect(tree.queryByTestId('scan-order-cut-list')).toBeNull();
  });

  it('SO3 a typed quantity is kept, marked, and survives another choice', async () => {
    const tree = await openOrder(room('bathroom'));
    fireEvent.press(tree.getByTestId('scan-order-type-qty-drywall_walls'));
    await settle();
    fireEvent.changeText(tree.getByTestId('scan-order-input-drywall_walls'), 'nine');
    fireEvent.press(tree.getByTestId('scan-order-use-drywall_walls'));
    await settle();
    expect(tree.getByText('Type a whole number, zero or more.')).toBeTruthy();
    fireEvent.changeText(tree.getByTestId('scan-order-input-drywall_walls'), '9');
    fireEvent.press(tree.getByTestId('scan-order-use-drywall_walls'));
    await settle();
    expect(tree.getByTestId('scan-order-qty-drywall_walls').props.children).toBe('9 sheets');
    expect(textOf(tree.getByTestId('scan-order-typed-drywall_walls') as unknown as Node)).toBe('You Typed This');
    expect(tree.getByText('Worked out as 7 sheets')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-order-sheet-4x12'));
    await settle();
    expect(tree.getByTestId('scan-order-qty-drywall_walls').props.children).toBe('9 sheets');
    expect(tree.getByText('Worked out as 6 sheets')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-order-clear-qty-drywall_walls'));
    await settle();
    expect(tree.getByTestId('scan-order-qty-drywall_walls').props.children).toBe('6 sheets');
    expect(tree.queryByTestId('scan-order-typed-drywall_walls')).toBeNull();
  });

  it('SO4 Copy As Text copies nothing until the yes on its sheet', async () => {
    const tree = await openOrder(room('bathroom'));
    fireEvent.press(tree.getByTestId('scan-order-copy'));
    await settle();
    expect(mockCopy).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('scan-order-confirm-copy-no'));
    await settle();
    expect(mockCopy).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('scan-order-copy'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-order-confirm-copy-yes'));
    await settle();
    expect(mockCopy).toHaveBeenCalledTimes(1);
    const text = mockCopy.mock.calls[0][0];
    const rows = text.split('\n');
    expect(rows[0]).toBe('Order list, Hall Bathroom');
    expect(rows[1]).toBe('A phone scan can be off by an inch or more. Check before you order.');
    expect(text).toContain('  Drywall Sheets 4x8, Walls: 7 sheets');
    expect(text).toContain('  Drywall Screws: 1 box, 5 lb (Rule Of Thumb)');
    expect(text).toContain('  Floor Tile: 46 sq ft');
    expect(text).toContain('  Baseboard, 16 Ft Sticks: 1 stick');
    expect(text).toContain('Cut list, Baseboard');
    expect(text).not.toContain('Corner Bead');
    expect(tree.getByTestId('scan-order-sent-copied')).toBeTruthy();
    expect(mockShare).not.toHaveBeenCalled();
    expect(mockUpdateProject).not.toHaveBeenCalled();
  });

  it('SO5 Share The List opens nothing until the yes on its sheet', async () => {
    const tree = await openOrder(room('bathroom'));
    fireEvent.press(tree.getByTestId('scan-order-share'));
    await settle();
    expect(mockShare).not.toHaveBeenCalled();
    expect(tree.getByText('This opens the share sheet with 14 lines as plain text. You choose who gets it. A phone scan can be off by an inch or more, so check the list first.')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-order-confirm-share-yes'));
    await settle();
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare.mock.calls[0][0].message).toContain('A phone scan can be off by an inch or more. Check before you order.');
    expect(tree.getByTestId('scan-order-sent-shared')).toBeTruthy();
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('SO6 Add Materials To Estimate writes nothing until the yes, then puts in the priced material lines', async () => {
    const tree = await openOrder(room('bathroom'));
    // Where each price came from: a catalog price, or none. Never his installed cost book.
    expect(textOf(tree.getByTestId('scan-order-source-drywall_walls') as unknown as Node)).toBe('No Past Jobs Yet, Catalog Price');
    expect(textOf(tree.getByTestId('scan-order-source-baseboard:16') as unknown as Node)).toBe('No Price Yet');
    fireEvent.press(tree.getByTestId('scan-order-type-price-baseboard:16'));
    await settle();
    fireEvent.changeText(tree.getByTestId('scan-order-input-baseboard:16'), '24');
    fireEvent.press(tree.getByTestId('scan-order-use-baseboard:16'));
    await settle();
    expect(textOf(tree.getByTestId('scan-order-source-baseboard:16') as unknown as Node)).toBe('You Typed This Price');
    fireEvent.press(tree.getByTestId('scan-order-estimate'));
    await settle();
    expect(mockUpdateProject).not.toHaveBeenCalled();
    expect(textOf(tree.getByTestId('scan-order-confirm-estimate-body') as unknown as Node)).toMatch(/^This puts 9 material lines into the estimate for this project, .* They are material only\. If the estimate already prices this work installed, the material would be in there twice\./);
    fireEvent.press(tree.getByTestId('scan-order-confirm-estimate-no'));
    await settle();
    expect(mockUpdateProject).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('scan-order-estimate'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-order-confirm-estimate-yes'));
    await settle();
    expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    const est = (mockUpdateProject.mock.calls[0][1] as { linkedEstimate: { items: { name: string; quantity: number; unitPrice: number; sourceTakeoffConditionId?: string }[] } }).linkedEstimate;
    const added = est.items.filter((it) => (it.sourceTakeoffConditionId ?? '').startsWith('scanorder:scan-1:'));
    expect(added).toHaveLength(9);
    expect(added.find((it) => it.sourceTakeoffConditionId === 'scanorder:scan-1:drywall_walls')).toMatchObject({ name: 'Drywall Sheets 4x8, Walls, Hall Bathroom', quantity: 7, unitPrice: 13.98 });
    expect(added.find((it) => it.sourceTakeoffConditionId === 'scanorder:scan-1:baseboard:16')).toMatchObject({ quantity: 1, unitPrice: 24 });
    expect(est.items[0].name).toBe('Demo');
    expect(mockSaveScan).toHaveBeenCalledTimes(1);
    const saved = mockSaveScan.mock.calls[0][0] as SavedScan;
    expect(saved.orderSent?.[0].via).toBe('estimate');
    expect(Object.keys(saved.orderPushed ?? {})).toHaveLength(9);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe('Scan The Room — What Your Tape Says', () => {
  it('SO7 not enough with four walls; the facts with fourteen; a suggestion that waits for a yes', async () => {
    mockTapeLog = HISTORY.slice(0, 4);
    const few = await openOrder(room('hallway', 'Back Hall'));
    expect(textOf(few.getByTestId('scan-tape-facts-not-enough') as unknown as Node)).toBe('You have taped 4 walls on this phone. That is not enough to tell. It takes 5.');
    expect(few.queryByTestId('scan-tape-suggestion')).toBeNull();
    await cleanupAsync();

    mockTapeLog = HISTORY;
    const tree = await openOrder(room('hallway', 'Back Hall'));
    expect(textOf(tree.getByTestId('scan-tape-facts-body') as unknown as Node)).toBe('Across 14 walls you taped, the scan was within 1 inch on 11. The largest difference was 2.5 inches. The typical difference was 0.5 inches.');
    expect(tree.getByText('These numbers are about the walls you taped on this phone. They say nothing about a wall you did not check.')).toBeTruthy();
    // The suggestion is on screen and has changed nothing: 47.0 ft of crown, as with no history.
    expect(tree.getByTestId('scan-tape-suggestion')).toBeTruthy();
    expect(tree.queryByTestId('scan-order-added')).toBeNull();
    const crownBefore = textOf(tree.getByTestId('scan-order-basis-crown:16') as unknown as Node);
    expect(crownBefore).toMatch(/^47\.0 ft to cover in 6 pieces/);
    fireEvent.press(tree.getByTestId('scan-tape-accept'));
    await settle();
    // Two 22 ft walls, 1.5 in each: 47.25 ft.
    expect(textOf(tree.getByTestId('scan-order-added') as unknown as Node)).toMatch(/^This list adds 1\.5 inches to each of 2 long walls you have not taped/);
    expect(textOf(tree.getByTestId('scan-order-basis-crown:16') as unknown as Node)).toMatch(/^47\.3 ft to cover/);
    fireEvent.press(tree.getByTestId('scan-tape-remove'));
    await settle();
    expect(tree.queryByTestId('scan-order-added')).toBeNull();
    expect(textOf(tree.getByTestId('scan-order-basis-crown:16') as unknown as Node)).toBe(crownBefore);
    // Not Now leaves the list alone and puts the card away.
    fireEvent.press(tree.getByTestId('scan-tape-ignore'));
    await settle();
    expect(tree.queryByTestId('scan-tape-suggestion')).toBeNull();
    expect(tree.queryByTestId('scan-order-added')).toBeNull();
  });

  it('SO8 a typed wall makes a pair, and his tape list is written only on Save', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={room('bathroom')} />, { wrapper: Wrap });
    await settle();
    const short = [1, 2, 3, 4].map((n) => tree.getByTestId(`scan-dim-wall-${n}`)).find((el) => /5 ft 1 in/.test(JSON.stringify(el.props.accessibilityLabel)));
    fireEvent.press(short!);
    await settle();
    fireEvent.changeText(tree.getByTestId('scan-edit-input'), '5 2');
    fireEvent.press(tree.getByTestId('scan-edit-save'));
    await settle();
    expect(mockRecordTapePairs).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('scan-save'));
    await settle();
    expect(mockRecordTapePairs).toHaveBeenCalledTimes(1);
    expect(mockRecordTapePairs.mock.calls[0][0]).toBe('user-1');
    const pairs = mockRecordTapePairs.mock.calls[0][1] as TapePair[];
    expect(pairs).toHaveLength(1);
    expect(Math.round(pairs[0].scannedM / 0.0254)).toBe(61);
    expect(Math.round(pairs[0].tapedM / 0.0254)).toBe(62);
    expect(pairs[0]).toMatchObject({ scanId: 'scan-1', lengthClass: 'short', deviceModel: 'iPhone16,1', roomType: 'bathroom' });
  });

  it('SO9 a room with no name cannot open the order list', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={room('bathroom', '')} />, { wrapper: Wrap });
    await settle();
    fireEvent.press(tree.getByTestId('scan-see-quantities'));
    await settle();
    expect(tree.getByTestId('scan-price-blocked')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-order-open'));
    await settle();
    expect(tree.queryByTestId('scan-order')).toBeNull();
  });
});
