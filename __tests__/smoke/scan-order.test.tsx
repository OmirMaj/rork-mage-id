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
 *   SO10 Sent to the estimate a second time (16 ft sticks only, Paint off,
 *       0 screws), the sheet names the lines that will be removed and the
 *       line he changed by hand that is left alone, and the yes does exactly
 *       that.
 *   SO11 The "material is in there twice" warning: the general one, the
 *       specific one when this room's installed lines are already in the
 *       estimate, and the mirror on Price It's confirm.
 *   SO12 Casing: the width, both sides and stool and apron each work the
 *       list out again, and the line says what it assumed.
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
// The one-time scan notice (hooks/useScanAck) is already acknowledged here; __tests__/smoke/scan-ack.test.tsx tests the notice itself.
jest.mock('@/hooks/useScanAck', () => ({ useScanAck: () => ({ ensure: async () => true, known: () => true }) }));
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
  forgetScansTapePairs: async () => null,
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

const GENERAL_TWICE = 'These lines are material only. If the estimate also prices this work installed, now or later, the material is in the estimate twice.';
type Est = { items: { materialId: string; name: string; unit: string; quantity: number; unitPrice: number; priceSource?: string; sourceTakeoffConditionId?: string }[] };

async function typePrice(tree: ReturnType<typeof render>, key: string, price: string) {
  fireEvent.press(tree.getByTestId(`scan-order-type-price-${key}`));
  await settle();
  fireEvent.changeText(tree.getByTestId(`scan-order-input-${key}`), price);
  fireEvent.press(tree.getByTestId(`scan-order-use-${key}`));
  await settle();
}

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
      // One line for each kind of trim, in feet of stick, whatever lengths it is bought in.
      baseboard: '28 ft of stick (1 stick of 16 ft, 1 stick of 12 ft)', crown: '32 ft of stick (2 sticks of 16 ft)', casing: '32 ft of stick (2 sticks of 16 ft)',
    };
    for (const [key, qty] of Object.entries(want)) expect(tree.getByTestId(`scan-order-qty-${key}`).props.children).toBe(qty);
    for (const key of ['screws', 'compound', 'tape', 'corner_bead']) {
      expect(textOf(tree.getByTestId(`scan-order-rot-${key}`) as unknown as Node)).toBe('Rule Of Thumb');
      expect(textOf(tree.getByTestId(`scan-order-basis-${key}`) as unknown as Node)).toMatch(/^Rule of thumb: /);
    }
    for (const key of ['drywall_walls', 'floor', 'paint_walls', 'baseboard']) expect(tree.queryByTestId(`scan-order-rot-${key}`)).toBeNull();
    // The drywall line states its two rules and that no spare is in it.
    expect(textOf(tree.getByTestId('scan-order-basis-drywall_walls') as unknown as Node)).toBe('Laid out wall by wall on 189.3 sq ft of wall, with doors and windows cut out once. No piece is under 16 in long unless the wall is that narrow, and butt joints are kept 16 in apart from one course to the next. Offcuts of 12 in and over are used again. No spare sheet included.');
    // Trim says how it was packed, and never "the fewest".
    expect(textOf(tree.getByTestId('scan-order-basis-baseboard') as unknown as Node)).toBe('24.0 ft to cover in 5 pieces. 28 ft of stick bought in all. Every way of grouping these pieces into the stick lengths you buy was tried, and none buys fewer feet.');
    // Casing says every assumption, and squares itself with the Quantities screen.
    expect(textOf(tree.getByTestId('scan-order-basis-casing') as unknown as Node)).toBe('28.1 ft to cover in 7 pieces. 32 ft of stick bought in all. Every way of grouping these pieces into the stick lengths you buy was tried, and none buys fewer feet. Casing 2 1/4 in wide, mitred: each mitre runs the piece past the opening by that much. 1 door, cased on the side in this room only. 1 window, picture-framed on four sides. The Quantities screen shows door casing at the bare opening, 15.8 ft. With the mitres it is 16.6 ft here.');
    expect(textOf(tree.getByTestId('scan-order-basis-floor') as unknown as Node)).toBe('41.5 sq ft of floor plus 10 percent comes to 46 sq ft. A straight layout takes 10 percent.');
    expect(textOf(tree.getByTestId('scan-order-basis-paint_walls') as unknown as Node)).toBe('189.3 sq ft, 2 coats, one gallon to 350 sq ft, comes to 1.1 gallons. Rounded up to whole gallons.');
    expect(tree.getByTestId('scan-order-layout-drawing')).toBeTruthy();
    // The layout in words under the drawing, which is also what a screen reader is given.
    expect(textOf(tree.getByTestId('scan-order-layout-drawing-piece-0') as unknown as Node)).toMatch(/^Sheet \d+: 61 by 48 in, from a new sheet$/);
    expect(String(tree.getByTestId('scan-order-layout-drawing-drawing').props.accessibilityLabel)).toMatch(/^Drywall cut layout for Wall \d+\. Sheet \d+: 61 by 48 in, from a new sheet\. Sheet \d+: 61 by 48 in, from a new sheet$/);
    expect(textOf(tree.getByTestId('scan-order-layout-rules') as unknown as Node)).toBe('No piece is under 16 in long unless the wall is that narrow. Butt joints are kept 16 in apart from one course to the next where the wall allows.');
    // The ceiling is 2 in longer than the sheet: a suggestion, and nothing changes.
    fireEvent.press(tree.getByTestId('scan-order-surface-ceiling'));
    await settle();
    expect(textOf(tree.getByTestId('scan-order-layout-longer-sheet') as unknown as Node)).toBe('The longest run here is 2 in longer than the sheet. A 4x10 sheet would hang it with no butt joint. Nothing here has been changed.');
    expect(tree.getByTestId('scan-order-qty-drywall_ceiling').props.children).toBe('2 sheets');
    // No spare unless he adds one.
    expect(textOf(tree.getByTestId('scan-order-spare-note') as unknown as Node)).toBe('No spare sheet included.');
    expect(tree.queryByTestId('scan-order-qty-drywall_spare')).toBeNull();
    fireEvent.press(tree.getByTestId('scan-order-spare-add'));
    await settle();
    expect(tree.getByTestId('scan-order-qty-drywall_spare').props.children).toBe('1 sheet');
    expect(tree.getByTestId('scan-order-qty-drywall_walls').props.children).toBe('7 sheets');
    expect(textOf(tree.getByTestId('scan-order-spare-note') as unknown as Node)).toBe('1 spare sheet is on its own line.');
    fireEvent.press(tree.getByTestId('scan-order-spare-remove'));
    await settle();
    expect(tree.queryByTestId('scan-order-qty-drywall_spare')).toBeNull();
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
    expect(tree.queryByTestId('scan-order-qty-baseboard')).toBeNull();
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
    expect(text).toContain('  Baseboard: 28 ft of stick (1 stick of 16 ft, 1 stick of 12 ft)');
    expect(text).toContain('No spare sheet included.');
    expect(text).not.toMatch(/fewest/i);
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
    expect(tree.getByText('This opens the share sheet with 12 lines as plain text. You choose who gets it. A phone scan can be off by an inch or more, so check the list first.')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-order-confirm-share-yes'));
    await settle();
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare.mock.calls[0][0].message).toContain('A phone scan can be off by an inch or more. Check before you order.');
    expect(tree.getByTestId('scan-order-sent-shared')).toBeTruthy();
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('SO6 Add Materials To Estimate writes nothing until the yes, then puts in the priced material lines', async () => {
    const tree = await openOrder(room('bathroom'));
    // Where each price came from: a catalog price for the material, or none. Never his installed cost book, and never
    // a label that says past jobs would change it.
    expect(textOf(tree.getByTestId('scan-order-source-drywall_walls') as unknown as Node)).toBe('Catalog Price For This Material');
    expect(textOf(tree.getByTestId('scan-order-source-baseboard') as unknown as Node)).toBe('No Price Yet');
    await typePrice(tree, 'baseboard', '1.5');
    expect(textOf(tree.getByTestId('scan-order-source-baseboard') as unknown as Node)).toBe('You Typed This Price');
    fireEvent.press(tree.getByTestId('scan-order-estimate'));
    await settle();
    expect(mockUpdateProject).not.toHaveBeenCalled();
    expect(textOf(tree.getByTestId('scan-order-confirm-estimate-body') as unknown as Node)).toMatch(/^This puts 9 material lines into the estimate for this project, .* before markup\. The estimate as it stands now is kept in its history\. Nothing is sent to your client\.$/);
    expect(textOf(tree.getByTestId('scan-order-confirm-double-count') as unknown as Node)).toBe(GENERAL_TWICE);
    // A first send removes nothing and says nothing about removing.
    expect(tree.queryByTestId('scan-order-confirm-remove')).toBeNull();
    expect(tree.queryByTestId('scan-order-confirm-untouched')).toBeNull();
    fireEvent.press(tree.getByTestId('scan-order-confirm-estimate-no'));
    await settle();
    expect(mockUpdateProject).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('scan-order-estimate'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-order-confirm-estimate-yes'));
    await settle();
    expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    const est = (mockUpdateProject.mock.calls[0][1] as { linkedEstimate: Est }).linkedEstimate;
    const added = est.items.filter((it) => (it.sourceTakeoffConditionId ?? '').startsWith('scanorder:scan-1:'));
    expect(added).toHaveLength(9);
    // A catalog price is marked 'regional' on the estimate line and a typed one 'seeded': never blank, never 'learned'.
    expect(added.find((it) => it.sourceTakeoffConditionId === 'scanorder:scan-1:drywall_walls')).toMatchObject({ name: 'Drywall Sheets 4x8, Walls, Hall Bathroom', quantity: 7, unitPrice: 13.98, priceSource: 'regional' });
    expect(added.find((it) => it.sourceTakeoffConditionId === 'scanorder:scan-1:baseboard')).toMatchObject({ name: 'Baseboard, Hall Bathroom', unit: 'LF', quantity: 28, unitPrice: 1.5, priceSource: 'seeded' });
    expect(added.every((it) => it.priceSource === 'regional' || it.priceSource === 'seeded')).toBe(true);
    expect(est.items[0].name).toBe('Demo');
    expect(est.items[0].priceSource).toBeUndefined();
    expect(mockSaveScan).toHaveBeenCalledTimes(1);
    const saved = mockSaveScan.mock.calls[0][0] as SavedScan;
    expect(saved.orderSent?.[0].via).toBe('estimate');
    expect(Object.keys(saved.orderPushed ?? {})).toHaveLength(9);
    expect(saved.orderWrote?.['scanorder:scan-1:baseboard']).toMatchObject({ quantity: 28, unitPrice: 1.5 });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('SO10 a second send removes the lines the list no longer has, names them first, and leaves a hand-edited line alone', async () => {
    const tree = await openOrder(room('bathroom'));
    await typePrice(tree, 'baseboard', '1.5');
    fireEvent.press(tree.getByTestId('scan-order-estimate'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-order-confirm-estimate-yes'));
    await settle();
    const first = (mockUpdateProject.mock.calls[0][1] as { linkedEstimate: Est }).linkedEstimate;
    const baseId = first.items.find((it) => it.sourceTakeoffConditionId === 'scanorder:scan-1:baseboard')?.materialId;
    // In the estimate, by hand: he makes the ceiling 5 sheets.
    const edited = { ...first, items: first.items.map((it) => (it.sourceTakeoffConditionId === 'scanorder:scan-1:drywall_ceiling' ? { ...it, quantity: 5 } : it)) };
    mockProject = { ...(mockProject as Record<string, unknown>), linkedEstimate: edited };
    // On the list: 16 ft sticks only, Paint off, 0 boxes of screws.
    fireEvent.press(tree.getByTestId('scan-order-stock-8'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-order-stock-12'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-order-group-paint'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-order-type-qty-screws'));
    await settle();
    fireEvent.changeText(tree.getByTestId('scan-order-input-screws'), '0');
    fireEvent.press(tree.getByTestId('scan-order-use-screws'));
    await settle();
    expect(tree.getByTestId('scan-order-qty-baseboard').props.children).toBe('32 ft of stick (2 sticks of 16 ft)');
    fireEvent.press(tree.getByTestId('scan-order-estimate'));
    await settle();
    // The sheet names what the yes will remove and what it will leave, before the yes.
    expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    expect(textOf(tree.getByTestId('scan-order-confirm-remove') as unknown as Node)).toBe('4 lines will be removed, because they are no longer on this list: Drywall Screws, Hall Bathroom; Paint, Walls, Hall Bathroom; Paint, Ceiling, Hall Bathroom; Primer, Hall Bathroom.');
    expect(textOf(tree.getByTestId('scan-order-confirm-left-alone') as unknown as Node)).toBe('1 line is left as it is, because you changed it in the estimate after it was added: Drywall Sheets 4x8, Ceiling, Hall Bathroom.');
    expect(textOf(tree.getByTestId('scan-order-confirm-untouched') as unknown as Node)).toBe('Only lines an earlier send of this order list put there are updated or removed. Every other line in the estimate is left as it is.');
    expect(textOf(tree.getByTestId('scan-order-confirm-estimate-body') as unknown as Node)).toMatch(/^This puts 4 material lines into the estimate/);
    fireEvent.press(tree.getByTestId('scan-order-confirm-estimate-yes'));
    await settle();
    expect(mockUpdateProject).toHaveBeenCalledTimes(2);
    const second = (mockUpdateProject.mock.calls[1][1] as { linkedEstimate: Est }).linkedEstimate;
    const key = (it: Est['items'][number]) => (it.sourceTakeoffConditionId ?? it.name).replace('scanorder:scan-1:', '');
    // The three paint lines and the screws are gone. The old baseboard line is the same line, now 32 ft. Nothing is doubled.
    expect(second.items.map(key).sort()).toEqual(['Demo', 'baseboard', 'compound', 'drywall_ceiling', 'drywall_walls', 'tape']);
    expect(second.items.find((it) => key(it) === 'baseboard')).toMatchObject({ materialId: baseId, quantity: 32, unitPrice: 1.5 });
    // The line he changed by hand is exactly as he left it, and so is the line that was never the list's.
    expect(second.items.find((it) => key(it) === 'drywall_ceiling')).toEqual(edited.items.find((it) => key(it) === 'drywall_ceiling'));
    expect(second.items.find((it) => key(it) === 'Demo')).toEqual(EST.items[0]);
    const saved = mockSaveScan.mock.calls[1][0] as SavedScan;
    expect(Object.keys(saved.orderPushed ?? {}).map((k) => k.replace('scanorder:scan-1:', '')).sort()).toEqual(['baseboard', 'compound', 'drywall_ceiling', 'drywall_walls', 'tape']);
    expect(saved.orderWrote?.['scanorder:scan-1:baseboard']).toMatchObject({ quantity: 32 });
    expect(saved.orderWrote?.['scanorder:scan-1:primer']).toBeUndefined();
  });

  it('SO11 the material-is-in-there-twice warning is specific when the other lines are already in the estimate, both ways round', async () => {
    // This room's installed drywall line (from Price It) is already in the estimate.
    const installed = { materialId: 'inst-1', name: 'Drywall, Walls, Hall Bathroom', category: 'Drywall', unit: 'SF', quantity: 208, unitPrice: 4.2, bulkPrice: 4.2, markup: 20, usesBulk: false, lineTotal: 1048.32, supplier: '', sourceTakeoffConditionId: 'scan:scan-1:drywall_walls' };
    mockProject = { id: 'proj-1', name: 'Maple St', linkedEstimate: { ...EST, items: [...EST.items, installed] }, estimateVersions: [] };
    const tree = await openOrder({ ...room('bathroom'), pushed: { 'scan:scan-1:drywall_walls': 'inst-1' }, pricedAt: '2026-10-06T14:00:00.000Z' });
    fireEvent.press(tree.getByTestId('scan-order-estimate'));
    await settle();
    expect(textOf(tree.getByTestId('scan-order-confirm-double-count') as unknown as Node)).toBe('The installed lines for this room from Price It are already in this estimate, and an installed price includes its material. With these lines the material is in the estimate twice until you take one of the two out.');
    await cleanupAsync();

    // A project with NO estimate: the confirm starts one, and still carries the warning.
    mockProject = { id: 'proj-1', name: 'Maple St', estimateVersions: [] };
    const starting = await openOrder(room('bathroom'));
    fireEvent.press(starting.getByTestId('scan-order-estimate'));
    await settle();
    expect(textOf(starting.getByTestId('scan-order-confirm-estimate-body') as unknown as Node)).toMatch(/^This project has no estimate yet\. This starts one with 8 material lines/);
    expect(textOf(starting.getByTestId('scan-order-confirm-double-count') as unknown as Node)).toBe(GENERAL_TWICE);
    await cleanupAsync();

    // The mirror. The order list's material lines are already in the estimate, and he opens Price It.
    const material = { materialId: 'mat-1', name: 'Drywall Sheets 4x8, Walls, Hall Bathroom', category: 'Drywall Sheets 4x8, Walls, Hall Bathroom', unit: 'EA', quantity: 7, unitPrice: 13.98, bulkPrice: 13.98, markup: 20, usesBulk: false, lineTotal: 117.43, supplier: '', sourceTakeoffConditionId: 'scanorder:scan-1:drywall_walls' };
    mockProject = { id: 'proj-1', name: 'Maple St', linkedEstimate: { ...EST, items: [...EST.items, material] }, estimateVersions: [] };
    const price = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={{ ...room('bathroom'), orderPushed: { 'scanorder:scan-1:drywall_walls': 'mat-1' } }} />, { wrapper: Wrap });
    await settle();
    fireEvent.press(price.getByTestId('scan-see-quantities'));
    await settle();
    fireEvent.press(price.getByTestId('scan-price-it'));
    await settle();
    fireEvent.press(price.getByTestId('scan-open-estimate'));
    await settle();
    expect(textOf(price.getByTestId('scan-confirm-materials-in') as unknown as Node)).toBe('Material lines from this room\'s order list are already in this estimate, and an installed price includes its material. With these lines the material is in the estimate twice until you take one of the two out.');
    await cleanupAsync();
    // And with no material lines there, Price It's confirm does not say it.
    mockProject = { id: 'proj-1', name: 'Maple St', linkedEstimate: EST, estimateVersions: [] };
    const plain = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={room('bathroom')} />, { wrapper: Wrap });
    await settle();
    fireEvent.press(plain.getByTestId('scan-see-quantities'));
    await settle();
    fireEvent.press(plain.getByTestId('scan-price-it'));
    await settle();
    fireEvent.press(plain.getByTestId('scan-open-estimate'));
    await settle();
    expect(plain.queryByTestId('scan-confirm-materials-in')).toBeNull();
  });

  it('SO12 casing: the width, both sides and stool and apron each work the list out again', async () => {
    const tree = await openOrder(room('bathroom'));
    const basis = () => textOf(tree.getByTestId('scan-order-basis-casing') as unknown as Node);
    // Both sides: the door twice (398 in) and the window once (138 in) is 536 in, on three 16 ft sticks.
    fireEvent.press(tree.getByTestId('scan-order-casing-both-sides'));
    await settle();
    expect(tree.getByTestId('scan-order-qty-casing').props.children).toBe('48 ft of stick (3 sticks of 16 ft)');
    expect(basis()).toMatch(/^44\.7 ft to cover in 10 pieces\./);
    expect(basis()).toContain('1 door, cased on both sides.');
    expect(basis()).toContain('The Quantities screen shows door casing at the bare opening, 31.7 ft. With the mitres it is 33.2 ft here.');
    fireEvent.press(tree.getByTestId('scan-order-casing-one-side'));
    await settle();
    // Stool and apron: the window's legs are cut square on the stool, and the stool is not on the list.
    fireEvent.press(tree.getByTestId('scan-order-window-trim-stool'));
    await settle();
    expect(basis()).toMatch(/^27\.7 ft to cover in 7 pieces\./);
    expect(basis()).toContain('1 window with two legs, a head and an apron. The stool is a different stock and is not on this list.');
    fireEvent.press(tree.getByTestId('scan-order-window-trim-picture'));
    await settle();
    // 3 1/2 in casing: 352 in.
    fireEvent.press(tree.getByTestId('scan-order-casing-width-3-5'));
    await settle();
    expect(basis()).toMatch(/^29\.3 ft to cover in 7 pieces\./);
    expect(basis()).toContain('Casing 3 1/2 in wide, mitred');
    // No window casing: the window trim choice goes away and the line says so.
    fireEvent.press(tree.getByTestId('scan-order-window-casing-no'));
    await settle();
    expect(tree.queryByTestId('scan-order-window-trim-stool')).toBeNull();
    expect(basis()).toContain('No window casing is on this list.');
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
    // The card says which walls it would add to, what that changes, and that these are walls from this phone model.
    expect(textOf(tree.getByTestId('scan-tape-suggestion') as unknown as Node)).toContain('On 5 of the 5 long walls you taped, the tape read longer than the scan. The typical shortfall was 1.5 inches. You can add 1.5 inches to each long wall that you have not taped and that was not adjusted to match a taped wall. On this order list it changes the wall board, the wall paint, the baseboard and the crown. It does not change the floor, the ceiling, any tile or the scan. Only walls scanned with the same phone model as this scan are counted.');
    expect(tree.queryByTestId('scan-order-added')).toBeNull();
    const crownBefore = textOf(tree.getByTestId('scan-order-basis-crown') as unknown as Node);
    expect(crownBefore).toMatch(/^47\.0 ft to cover in 6 pieces/);
    fireEvent.press(tree.getByTestId('scan-tape-accept'));
    await settle();
    // Two 22 ft walls, 1.5 in each: 47.25 ft.
    expect(textOf(tree.getByTestId('scan-order-added') as unknown as Node)).toBe('This list adds 1.5 inches to each of 2 long walls that you have not taped and that were not adjusted to match a taped wall, because your own taped walls ran longer than the scan. It changes the wall board, the wall paint, the baseboard and the crown. It does not change the floor, the ceiling or any tile. The scan keeps its numbers.');
    expect(textOf(tree.getByTestId('scan-order-basis-crown') as unknown as Node)).toMatch(/^47\.3 ft to cover/);
    fireEvent.press(tree.getByTestId('scan-tape-remove'));
    await settle();
    expect(tree.queryByTestId('scan-order-added')).toBeNull();
    expect(textOf(tree.getByTestId('scan-order-basis-crown') as unknown as Node)).toBe(crownBefore);
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
