/**
 * Smoke — Scan The Room (lane SCANROOM), the three screens mounted from the
 * hand-built bathroom fixture (scripts/fixtures/scan-room/bathroom.json), with
 * the real parser, geometry, quantities, edits and pricing. Only the contexts,
 * the router, the cost book and the device storage are stood in for.
 *
 *   S1 The Floor Plan draws the room: the name, a tappable number on every
 *      wall, "4 of 4" walls found, the floor area, and the sentence that a
 *      phone scan can be off by an inch or more.
 *   S2 Tapping a wall's number and typing a tape measurement recomputes the
 *      floor area and says a number was typed by hand.
 *   S3 The Quantities lists what the scan worked out.
 *   S4 The Priced Estimate labels every line with where its price came from,
 *      and Open In Estimate writes NOTHING until the confirm sheet's yes.
 *   S5 With the flag off the route mounts nothing and the native module is
 *      never looked up.
 *   S6 A phone that cannot scan is told why, in its own sentence.
 *
 * The review round (2026-10-06):
 *   S4b-S4f  a project with no estimate gets one started by the same yes at his
 *            stated markup, and is blocked when he has stated none; "Added to
 *            the estimate." only after the project is seen to hold the lines; a
 *            seat that may not change the estimate cannot push; a price from
 *            one of his other trades names the trade, and a trade that only
 *            shares a word is not used.
 *   S7  a scan has no name until he types one; the name is taken on every
 *       keystroke; Save and Price ask for one.
 *   S8  a bare "98" on a 98 inch wall is shown back as 98 ft and asked about.
 *   S9  Back asks before it drops a scan the phone does not hold.
 *   S10 a saved scan is deleted only from the delete sheet's yes.
 *   S11 the real store: the scan the cap drops takes its raw JSON with it,
 *       and a delete removes both keys.
 *
 * The pure rules have their own direct tests with planted mutations in
 * scripts/validate-scan-room.ts.
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
const mockBack = jest.fn();
jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, back: mockBack, replace: () => {} }),
    useLocalSearchParams: () => ({ projectId: 'proj-1' }),
    Redirect: ({ href }: { href: string }) => R.createElement('Redirect', { href }),
    Stack: { Screen: () => null },
  };
});

const EST = {
  id: 'est-1', globalMarkup: 20, baseTotal: 1000, markupTotal: 200, grandTotal: 1200, createdAt: '2026-09-01T00:00:00.000Z',
  items: [{ materialId: 'm1', name: 'Demo', category: 'Demolition', unit: 'LS', quantity: 1, unitPrice: 1000, bulkPrice: 1000, markup: 20, usesBulk: false, lineTotal: 1200, supplier: '' }],
};
let mockProject: Record<string, unknown> | null = { id: 'proj-1', name: 'Maple St', linkedEstimate: EST, estimateVersions: [] };
/** false = the write is sent and the project never shows it (a save that did not take). */
let mockKeepWrites = true;
const mockUpdateProject = jest.fn((_id: string, patch: Record<string, unknown>) => {
  if (mockKeepWrites && mockProject) mockProject = { ...mockProject, ...patch };
});
jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({ getProject: () => mockProject, updateProject: mockUpdateProject, settings: { location: '' } }),
}));

// His stated markup (the estimator, the wizard and Quick Quote share it). null = never asked.
let mockMarkupDecided: boolean | null = true;
jest.mock('@/contexts/MaterialCartContext', () => ({
  useMaterialCart: () => ({ globalMarkup: 20, markupDecided: mockMarkupDecided }),
}));

jest.mock('@/hooks/useScopeCostBook', () => {
  const { buildCostDatabase } = jest.requireActual('@/utils/costDatabase');
  const db = buildCostDatabase([], [], [], [], [{ id: 's1', trade: 'Tile', unit: 'SF', rate: 18.5 }]);
  // One rate measured on six of his jobs; everything else has no price of his.
  const entries = db.entries.map((e: Record<string, unknown>) => ({ ...e, provenance: 'earned', jobCount: 6, seededSampleCount: 0, earnedBasis: 'paid' }));
  const book = { ...db, entries };
  // A second book: his "Doors" trade (three jobs) and a "Garage Door" trade
  // that only shares a word with an interior door.
  const db2 = buildCostDatabase([], [], [], [], [{ id: 'd1', trade: 'Doors', unit: 'EA', rate: 380 }, { id: 'd2', trade: 'Garage Door', unit: 'EA', rate: 2400 }]);
  const book2 = { ...db2, entries: db2.entries.map((e: Record<string, unknown>) => ({ ...e, provenance: 'earned', jobCount: 3, seededSampleCount: 0, earnedBasis: 'paid' })) };
  return { useScopeCostBook: () => (mockDoorsBook ? book2 : book) };
});
let mockDoorsBook = false;

const mockSaveScan = jest.fn(async (_saved?: unknown, _raw?: unknown) => true);
let mockSavedList: unknown[] = [];
const mockDeleteScan = jest.fn(async (_projectId: string, scanId: string) => {
  mockSavedList = (mockSavedList as { scan: { id: string } }[]).filter((s) => s.scan.id !== scanId);
  return true;
});
jest.mock('@/utils/roomScan/store', () => ({
  loadSavedScans: async () => ({ version: 1, scans: mockSavedList }),
  saveScan: (saved: unknown, raw: unknown) => mockSaveScan(saved, raw),
  hashRawScan: async () => 'hash',
  deleteScan: (projectId: string, scanId: string) => mockDeleteScan(projectId, scanId),
}));

// The order list (lane SCANORDER) reads who is signed in for his tape list, and
// can copy or share. None of that is this file's subject (its own suite is
// __tests__/smoke/scan-order.test.tsx): stand them in so nothing here touches
// the device.
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
jest.mock('@/utils/roomScan/learnStore', () => ({
  loadTapePairs: async () => [],
  recordTapePairs: async (_userId: unknown, pairs: unknown[]) => pairs,
  forgetScanTapePairs: async () => {},
}));
jest.mock('@/utils/clipboard', () => ({ copyToClipboard: jest.fn(async () => true) }));
jest.mock('@/utils/shareText', () => ({ shareText: jest.fn(async () => 'shared'), canShare: () => true }));

let mockCaps: Record<string, unknown> | null = null;
const mockGetCapabilities = jest.fn(() => mockCaps);
jest.mock('@/utils/roomScan/native', () => ({
  getCapabilities: () => mockGetCapabilities(),
  startScan: jest.fn(),
  isModuleLinked: () => mockCaps !== null,
  roomScanErrorCode: () => null,
}));

let mockTier: 'free' | 'pro' = 'pro';
jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => ({ tier: mockTier }) }));
jest.mock('@/components/Paywall', () => {
  const R = jest.requireActual('react');
  return { __esModule: true, default: (p: { feature: string; requiredTier: string }) => R.createElement('Paywall', { testID: 'paywall', feature: p.feature, requiredTier: p.requiredTier }) };
});

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RoomScanFlow } from '@/components/roomScan/RoomScanFlow';
import { parseCapturedRoom } from '@/utils/roomScan/capturedRoomParser';
import { buildRoomScan } from '@/utils/roomScan/geometryCore';
import type { SavedScan } from '@/utils/roomScan/storeCore';

// The flow reads the safe area for its header and its bottom padding.
const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
);

const RAW = fs.readFileSync(path.resolve(__dirname, '../../scripts/fixtures/scan-room/bathroom.json'), 'utf8');
function bathroom(name = 'Hall Bathroom', id = 'scan-1'): SavedScan {
  const scan = buildRoomScan(parseCapturedRoom(RAW), {
    id, projectId: 'proj-1', name, capturedAt: '2026-10-06T13:41:00.000Z', device: { model: 'iPhone16,1', os: '17.5' },
  });
  return { scan, pushed: {}, manualRates: {}, excluded: [], savedAt: '', pricedAt: null };
}
// Enough turns for a confirmed push: the write, the read-back, the save and the list refresh are each awaited.
const settle = async () => { await act(async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); }); };
type Node = { children: (Node | string)[] };
/** The words a person reads inside one element. (Its props.children are React elements, which do not go through JSON.) */
const textOf = (n: Node): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
/** How many of the four tappable wall numbers read this length. */
const wallsReading = (tree: ReturnType<typeof render>, length: string): number =>
  [1, 2, 3, 4].filter((n) => String(tree.getByTestId(`scan-dim-wall-${n}`).props.accessibilityLabel).includes(length)).length;

beforeEach(() => {
  mockPush.mockClear(); mockBack.mockClear(); mockUpdateProject.mockClear(); mockSaveScan.mockClear(); mockGetCapabilities.mockClear(); mockDeleteScan.mockClear();
  mockProject = { id: 'proj-1', name: 'Maple St', linkedEstimate: EST, estimateVersions: [] };
  mockKeepWrites = true;
  mockMarkupDecided = true;
  mockDoorsBook = false;
  mockSavedList = [];
  mockCaps = null;
  mockTier = 'pro';
});
afterEach(async () => { await cleanupAsync(); });

describe('Scan The Room — the three screens from the bathroom fixture', () => {
  it('S1 The Floor Plan draws the room and says what a scan is', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    expect(tree.getByTestId('scan-plan')).toBeTruthy();
    expect(tree.getByTestId('scan-name').props.value).toBe('Hall Bathroom');
    for (const n of [1, 2, 3, 4]) expect(tree.getByTestId(`scan-dim-wall-${n}`)).toBeTruthy();
    expect(wallsReading(tree, '5 ft 1 in')).toBe(2);
    expect(wallsReading(tree, '8 ft 2 in')).toBe(2);
    expect(tree.getByTestId('scan-walls-found').props.children).toBe('4 of 4');
    expect(tree.getByTestId('scan-floor-area').props.children).toBe('41.5 sq ft');
    expect(tree.getByText('A phone scan can be off by an inch or more. Check one wall with a tape. Tap any number to fix it.')).toBeTruthy();
    expect(tree.getByText('4 of 4 walls found.')).toBeTruthy();
    expect(mockSaveScan).not.toHaveBeenCalled();
    expect(mockUpdateProject).not.toHaveBeenCalled();
  });

  it('S2 a typed tape measurement recomputes and is marked typed by hand', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    const short = [1, 2, 3, 4].map((n) => tree.getByTestId(`scan-dim-wall-${n}`)).find((el) => /5 ft 1 in/.test(JSON.stringify(el.props.accessibilityLabel)));
    expect(short).toBeTruthy();
    fireEvent.press(short!);
    await settle();
    fireEvent.changeText(tree.getByTestId('scan-edit-input'), 'about five feet');
    fireEvent.press(tree.getByTestId('scan-edit-save'));
    await settle();
    expect(tree.getByText('That does not read as a length. Type feet and inches, like 8 ft 2 in.')).toBeTruthy();
    fireEvent.changeText(tree.getByTestId('scan-edit-input'), '5 2');
    fireEvent.press(tree.getByTestId('scan-edit-save'));
    await settle();
    // 62 in by 98 in is 42.2 sq ft.
    expect(tree.getByTestId('scan-floor-area').props.children).toBe('42.2 sq ft');
    expect(tree.getByText('1 number was typed by hand.')).toBeTruthy();
    expect(tree.getByText('Typed by hand')).toBeTruthy();
    expect(tree.getByText('Moved to keep the outline closed')).toBeTruthy();
    expect(wallsReading(tree, '5 ft 2 in')).toBe(2);
    expect(wallsReading(tree, '5 ft 1 in')).toBe(0);
    expect(mockSaveScan).not.toHaveBeenCalled();
    // Save is a tap, and only then is the phone written.
    fireEvent.press(tree.getByTestId('scan-save'));
    await settle();
    expect(mockSaveScan).toHaveBeenCalledTimes(1);
    const saved = mockSaveScan.mock.calls[0][0] as SavedScan;
    expect(saved.scan.edits).toHaveLength(1);
    expect(saved.scan.edits[0].by).toBe('typed');
  });

  it('S3 The Quantities lists what the scan worked out', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    fireEvent.press(tree.getByTestId('scan-see-quantities'));
    await settle();
    expect(tree.getByTestId('scan-quantities')).toBeTruthy();
    const row = (id: string) => textOf(tree.getByTestId(`scan-q-${id}`));
    expect(row('floor')).toContain('41.5');
    expect(row('wall')).toContain('189.3');
    expect(row('wall')).toContain('212.0 sq ft less 22.7 sq ft of doors, windows and openings');
    expect(row('ceiling')).toContain('41.5');
    expect(row('baseboard')).toContain('24.0');
    expect(row('crown')).toContain('26.5');
    expect(row('doors')).toContain('2 ft 6 in by 6 ft 8 in');
    expect(row('windows')).toContain('2 ft 0 in by 3 ft 0 in');
    expect(row('fixtures')).toContain('Toilet, Sink, Tub');
    expect(tree.queryByTestId('scan-price-blocked')).toBeNull();
  });

  it('S4 every line says where its price came from, and nothing is written before the yes', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    fireEvent.press(tree.getByTestId('scan-see-quantities'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-price-it'));
    await settle();
    expect(tree.getByTestId('scan-draft')).toBeTruthy();
    const source = (key: string) => textOf(tree.getByTestId(`scan-source-${key}`));
    expect(source('floor_tile')).toContain('Your Price, 6 Past Jobs');
    expect(source('toilet')).toContain('No Past Jobs Yet, Catalog Price');
    expect(source('baseboard')).toContain('No Price Yet');
    // 46 sq ft at $18.50, a prehung door, a toilet and a vanity sink from the catalog.
    expect(tree.getByTestId('scan-draft-total').props.children).toBe('$2,080.37');
    expect(tree.getByText('1 of 4 lines use your own prices')).toBeTruthy();

    fireEvent.press(tree.getByTestId('scan-open-estimate'));
    await settle();
    expect(tree.getByTestId('scan-confirm-sheet')).toBeTruthy();
    expect(mockUpdateProject).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('scan-confirm-no'));
    await settle();
    expect(mockUpdateProject).not.toHaveBeenCalled();
    expect(mockSaveScan).not.toHaveBeenCalled();

    fireEvent.press(tree.getByTestId('scan-open-estimate'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-confirm-yes'));
    await settle();
    expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    const [id, patch] = mockUpdateProject.mock.calls[0] as [string, { linkedEstimate: { items: { name: string; priceSource?: string }[] }; estimateVersions: unknown[] }];
    expect(id).toBe('proj-1');
    expect(patch.linkedEstimate.items).toHaveLength(5);
    expect(patch.estimateVersions).toHaveLength(1);
    expect(patch.linkedEstimate.items.find((i) => /Floor Tile, Hall Bathroom/.test(i.name))?.priceSource).toBe('learned');
    expect(patch.linkedEstimate.items.find((i) => /Set Toilet/.test(i.name))?.priceSource).toBeUndefined();
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/project-detail', params: { id: 'proj-1', tile: 'linkedEstimate' } });
    // Said only now: the project was read back and holds the lines.
    expect(tree.getByText('Added to the estimate. Check each line there before you send it.')).toBeTruthy();
    expect(mockSaveScan).toHaveBeenCalledTimes(1);
    expect((mockSaveScan.mock.calls[0][0] as SavedScan).pricedAt).toBeTruthy();
  });

  const toPrice = async (tree: ReturnType<typeof render>) => {
    fireEvent.press(tree.getByTestId('scan-see-quantities'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-price-it'));
    await settle();
  };

  it('S4b a job with no estimate gets one started by the same yes, at his stated markup', async () => {
    mockProject = { id: 'proj-1', name: 'Maple St', estimateVersions: [] };
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    await toPrice(tree);
    expect(tree.queryByTestId('scan-draft-blocked')).toBeNull();
    fireEvent.press(tree.getByTestId('scan-open-estimate'));
    await settle();
    expect(tree.getByText('Start The Estimate')).toBeTruthy();
    expect(textOf(tree.getByTestId('scan-confirm-body'))).toBe('This project has no estimate yet. This starts one with 4 lines, $2,080.37 before markup, at your markup of 20 percent. Nothing is sent to your client.');
    expect(mockUpdateProject).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('scan-confirm-yes'));
    await settle();
    expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    const patch = mockUpdateProject.mock.calls[0][1] as unknown as { linkedEstimate: { globalMarkup: number; baseTotal: number; grandTotal: number; items: { markup: number; name: string; sourceTakeoffConditionId?: string }[] }; estimateVersions: unknown[] };
    expect(patch.linkedEstimate.globalMarkup).toBe(20);
    expect(patch.linkedEstimate.items).toHaveLength(4);
    expect(patch.linkedEstimate.items.every((i) => i.markup === 20 && !!i.sourceTakeoffConditionId)).toBe(true);
    expect(patch.linkedEstimate.baseTotal).toBeCloseTo(2080.37, 2);
    expect(patch.linkedEstimate.grandTotal).toBeCloseTo(2496.44, 1);
    expect(patch.estimateVersions).toHaveLength(0);
    expect(tree.getByText('Added to the estimate. Check each line there before you send it.')).toBeTruthy();
  });

  it('S4c a job with no estimate and no stated markup is blocked, and the button says why', async () => {
    mockProject = { id: 'proj-1', name: 'Maple St', estimateVersions: [] };
    mockMarkupDecided = null;
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    await toPrice(tree);
    expect(tree.getByText('This project has no estimate yet, and you have not chosen a markup. Choose your markup in Estimate, then come back to this scan.')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-open-estimate'));
    await settle();
    expect(tree.queryByTestId('scan-confirm-yes')).toBeNull();
    expect(mockUpdateProject).not.toHaveBeenCalled();
  });

  it('S4d "Added to the estimate." is not said when the project never shows the lines', async () => {
    mockKeepWrites = false;
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    await toPrice(tree);
    fireEvent.press(tree.getByTestId('scan-open-estimate'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-confirm-yes'));
    await settle();
    expect(mockUpdateProject).toHaveBeenCalledTimes(1);
    // Still waiting to see the lines: nothing is claimed yet.
    expect(tree.queryByTestId('scan-draft-added')).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 1900)); });
    expect(tree.getByText('The estimate has not shown these lines yet. Open the estimate and check it before you price this scan again.')).toBeTruthy();
    expect(tree.queryByTestId('scan-draft-added')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockSaveScan).not.toHaveBeenCalled();
  });

  it('S4e a seat that may not change the estimate cannot push', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate={false} initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    await toPrice(tree);
    expect(tree.getByText('Only the project owner or an editor can add lines to this estimate. Ask the project owner.')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-open-estimate'));
    await settle();
    expect(tree.queryByTestId('scan-confirm-yes')).toBeNull();
    expect(mockUpdateProject).not.toHaveBeenCalled();
  });

  it('S4f a price from one of his other trades names the trade; a trade that only shares a word is not used', async () => {
    mockDoorsBook = true;
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    await toPrice(tree);
    const source = (key: string) => textOf(tree.getByTestId(`scan-source-${key}`));
    // His "Doors" price, said by name. Never the $2,400 garage door.
    expect(source('door')).toBe('Your Price For Doors, 3 Past Jobs');
    expect(textOf(tree.getByTestId('scan-line-door'))).toContain('$380.00');
    expect(textOf(tree.getByTestId('scan-line-door'))).not.toContain('2,400');
    expect(source('toilet')).toBe('No Past Jobs Yet, Catalog Price');
  });

  it('S7 a scan has no name until he types one, and the name is on the scan the moment it is typed', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom('')} />, { wrapper: Wrap });
    await settle();
    expect(tree.getByTestId('scan-name').props.value).toBe('');
    expect(tree.getByTestId('scan-name').props.placeholder).toBe('Hall Bathroom');
    expect(tree.queryByText('Hall Bathroom')).toBeNull();
    // Save asks for a name and writes nothing.
    fireEvent.press(tree.getByTestId('scan-save'));
    await settle();
    expect(tree.getByText('Name the room first. The name goes on every estimate line.')).toBeTruthy();
    expect(mockSaveScan).not.toHaveBeenCalled();
    // Price It is blocked and says why.
    fireEvent.press(tree.getByTestId('scan-see-quantities'));
    await settle();
    expect(tree.getByText('Name the room on the plan before you price. The name goes on every estimate line.')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-price-it'));
    await settle();
    expect(tree.queryByTestId('scan-draft')).toBeNull();
    fireEvent.press(tree.getByTestId('scan-back'));
    await settle();
    // Typed, and Save tapped with the keyboard still up (no blur, no end-editing event).
    fireEvent.changeText(tree.getByTestId('scan-name'), 'Upstairs Bath ');
    fireEvent.press(tree.getByTestId('scan-save'));
    await settle();
    expect(mockSaveScan).toHaveBeenCalledTimes(1);
    expect((mockSaveScan.mock.calls[0][0] as SavedScan).scan.name).toBe('Upstairs Bath');
    await toPrice(tree);
    fireEvent.press(tree.getByTestId('scan-open-estimate'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-confirm-yes'));
    await settle();
    const patch = mockUpdateProject.mock.calls[0][1] as unknown as { linkedEstimate: { items: { name: string }[] } };
    expect(patch.linkedEstimate.items.some((i) => /Floor Tile, Upstairs Bath/.test(i.name))).toBe(true);
    expect(patch.linkedEstimate.items.some((i) => /Hall Bathroom/.test(i.name))).toBe(false);
  });

  it('S8 a bare 98 on a 98 inch wall is shown back as feet and asked about before it is used', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    const long = [1, 2, 3, 4].map((n) => tree.getByTestId(`scan-dim-wall-${n}`)).find((el) => /8 ft 2 in/.test(JSON.stringify(el.props.accessibilityLabel)));
    fireEvent.press(long!);
    await settle();
    fireEvent.changeText(tree.getByTestId('scan-edit-input'), '98');
    await settle();
    expect(textOf(tree.getByTestId('scan-edit-reads-as'))).toBe('Reads as 98 ft 0 in');
    fireEvent.press(tree.getByTestId('scan-edit-save'));
    await settle();
    // Not used: the sheet is still up, asks, and the plan is unchanged.
    expect(textOf(tree.getByTestId('scan-edit-far'))).toBe('That reads as 98 ft 0 in, and the plan shows 8 ft 2 in. For inches, type the number and in, like 98 in. If the tape does say 98 ft 0 in, tap Use This Number again.');
    expect(tree.getByTestId('scan-floor-area').props.children).toBe('41.5 sq ft');
    expect(wallsReading(tree, '8 ft 2 in')).toBe(2);
    // What he meant.
    fireEvent.changeText(tree.getByTestId('scan-edit-input'), '98 in');
    await settle();
    expect(textOf(tree.getByTestId('scan-edit-reads-as'))).toBe('Reads as 8 ft 2 in');
    expect(tree.queryByTestId('scan-edit-far')).toBeNull();
    fireEvent.press(tree.getByTestId('scan-edit-save'));
    await settle();
    expect(tree.queryByTestId('scan-edit-input')).toBeNull();
    expect(tree.getByTestId('scan-floor-area').props.children).toBe('41.5 sq ft');
    expect(tree.getByText('1 number was typed by hand.')).toBeTruthy();
  });

  it('S9 Back asks before it drops a scan the phone does not hold', async () => {
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={bathroom()} />, { wrapper: Wrap });
    await settle();
    // Nothing changed: Back just goes back.
    fireEvent.press(tree.getByTestId('scan-back'));
    await settle();
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(tree.queryByTestId('scan-leave-discard')).toBeNull();
    mockBack.mockClear();
    // A change the phone does not hold.
    fireEvent.changeText(tree.getByTestId('scan-name'), 'Hall Bath');
    fireEvent.press(tree.getByTestId('scan-back'));
    await settle();
    expect(tree.getByText('This scan is not saved. If you go back now, it is gone.')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('scan-leave-stay'));
    await settle();
    expect(mockBack).not.toHaveBeenCalled();
    expect(tree.getByTestId('scan-plan')).toBeTruthy();
    // Saved: Back no longer asks.
    fireEvent.press(tree.getByTestId('scan-save'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-back'));
    await settle();
    expect(mockBack).toHaveBeenCalledTimes(1);
    mockBack.mockClear();
    // Changed again, and this time he discards.
    fireEvent.changeText(tree.getByTestId('scan-name'), 'Hall Bath Two');
    fireEvent.press(tree.getByTestId('scan-back'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-leave-discard'));
    await settle();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('S10 a saved scan is deleted only from the yes on the delete sheet', async () => {
    mockSavedList = [bathroom('Hall Bathroom', 'scan-1'), bathroom('Kitchen', 'scan-2')];
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate />, { wrapper: Wrap });
    await settle();
    expect(tree.getByTestId('scan-saved-scan-1')).toBeTruthy();
    expect(tree.getByTestId('scan-saved-scan-2')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-saved-delete-scan-1'));
    await settle();
    expect(tree.getByText('This deletes Hall Bathroom from this phone. Lines already in the estimate stay there. A deleted scan cannot be brought back.')).toBeTruthy();
    expect(mockDeleteScan).not.toHaveBeenCalled();
    fireEvent.press(tree.getByTestId('scan-delete-keep'));
    await settle();
    expect(mockDeleteScan).not.toHaveBeenCalled();
    expect(tree.getByTestId('scan-saved-scan-1')).toBeTruthy();
    fireEvent.press(tree.getByTestId('scan-saved-delete-scan-1'));
    await settle();
    fireEvent.press(tree.getByTestId('scan-delete-yes'));
    await settle();
    expect(mockDeleteScan).toHaveBeenCalledTimes(1);
    expect(mockDeleteScan).toHaveBeenCalledWith('proj-1', 'scan-1');
    expect(tree.queryByTestId('scan-saved-scan-1')).toBeNull();
    expect(tree.getByTestId('scan-saved-scan-2')).toBeTruthy();
  });

  it('S11 the real store: the scan the cap drops takes its raw JSON with it, and a delete removes both keys', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage');
    const real = jest.requireActual('@/utils/roomScan/store') as typeof import('@/utils/roomScan/store');
    const core = jest.requireActual('@/utils/roomScan/storeCore') as typeof import('@/utils/roomScan/storeCore');
    const projectId = 'proj-cap';
    const row = (n: number): SavedScan => { const b = bathroom(`Room ${n}`, `cap-${n}`); return { ...b, scan: { ...b.scan, projectId }, savedAt: '2026-10-06T14:00:00.000Z' }; };
    for (let n = 1; n <= core.MAX_SCANS_PER_PROJECT; n++) expect(await real.saveScan(row(n), `{"raw":${n}}`)).toBe(true);
    expect(await AsyncStorage.getItem(core.roomScanRawKey('cap-1'))).toBe('{"raw":1}');
    // One more than the cap: the oldest leaves the list AND its raw JSON goes with it.
    expect(await real.saveScan(row(core.MAX_SCANS_PER_PROJECT + 1), '{"raw":"new"}')).toBe(true);
    const list = await real.loadSavedScans(projectId);
    expect(list.scans).toHaveLength(core.MAX_SCANS_PER_PROJECT);
    expect(list.scans.some((x) => x.scan.id === 'cap-1')).toBe(false);
    expect(await AsyncStorage.getItem(core.roomScanRawKey('cap-1'))).toBeNull();
    expect(await AsyncStorage.getItem(core.roomScanRawKey('cap-2'))).toBe('{"raw":2}');
    // Delete: the row and the raw key.
    expect(await real.deleteScan(projectId, 'cap-2')).toBe(true);
    expect((await real.loadSavedScans(projectId)).scans.some((x) => x.scan.id === 'cap-2')).toBe(false);
    expect(await AsyncStorage.getItem(core.roomScanRawKey('cap-2'))).toBeNull();
    expect(await AsyncStorage.getItem(core.roomScanRawKey('cap-3'))).toBe('{"raw":3}');
  });
});

describe('Scan The Room — dark, and honest about a phone that cannot scan', () => {
  it('S5 with the flag off the route mounts nothing and never looks the module up', async () => {
    const Route = require('@/app/scan-room').default as React.ComponentType;
    const tree = render(<Route />);
    await settle();
    expect(JSON.stringify(tree.toJSON())).toContain('"href":"/(tabs)/(home)"');
    expect(tree.queryByTestId('scan-room-flow')).toBeNull();
    expect(mockGetCapabilities).not.toHaveBeenCalled();
  });

  it('S6 each reason has its own sentence', async () => {
    const cases: [Record<string, unknown> | null, string, string | null][] = [
      [null, 'This version of the app does not include room scanning. It comes with a newer version from the App Store.', null],
      [{ linked: true, supported: false, reason: 'noLidar', multiRoom: false, osVersion: '17.5', deviceModel: 'iPhone15,4' }, 'This iPhone has no LiDAR sensor. Room scanning needs an iPhone Pro, 12 Pro or newer.', null],
      [{ linked: true, supported: false, reason: 'osTooOld', multiRoom: false, osVersion: '15.8', deviceModel: 'iPhone13,3' }, 'Room scanning needs iOS 16 or later. Update this iPhone to use it.', null],
      [{ linked: true, supported: true, reason: 'cameraDenied', multiRoom: true, osVersion: '17.5', deviceModel: 'iPhone16,1' }, 'Camera access is off for MAGE ID, so a scan cannot start. Turn it on in Settings, under MAGE ID, Camera.', 'scan-open-settings'],
      [{ linked: true, supported: true, reason: 'cameraUndetermined', multiRoom: true, osVersion: '17.5', deviceModel: 'iPhone16,1' }, 'Room scanning uses the camera and the depth sensor to measure the room. The scan keeps the shape and sizes of the room. No video is saved.', 'scan-allow-camera'],
    ];
    for (const [caps, sentence, button] of cases) {
      mockCaps = caps;
      const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate />, { wrapper: Wrap });
      await settle();
      expect(tree.getByText(sentence)).toBeTruthy();
      expect(tree.queryByTestId('scan-start-button')).toBeNull();
      if (button) expect(tree.getByTestId(button)).toBeTruthy();
      await cleanupAsync();
    }
    mockCaps = { linked: true, supported: true, reason: 'ok', multiRoom: true, osVersion: '17.5', deviceModel: 'iPhone16,1' };
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate />, { wrapper: Wrap });
    await settle();
    expect(tree.getByTestId('scan-start-button')).toBeTruthy();
    expect(tree.getByText('Before You Scan')).toBeTruthy();
  });
});
