/**
 * Smoke — Scan The Room, Clearance Check (lane CLEARANCE), mounted from the
 * hand-built tight bathroom with the real cores. Only the contexts, the
 * router, the cost book and the device storage are stood in for.
 *
 *   SC1 For the owner the plan has a door to Clearance Check. The screen
 *       opens with the sentence that a phone scan can be off by an inch or
 *       more, and shows the hand-worked numbers of the tight bathroom, each
 *       with its label and its commonly used figure.
 *   SC2 A row with no label says it was not checked against anything, and the
 *       standing sentences are on the screen.
 *   SC3 Tapping a row draws that measurement on the plan; tapping it again
 *       takes it off.
 *   SC4 The one action opens the existing Code Check, and nothing is written.
 *   SC5 Someone the gate refuses gets no door at all.
 *   SC6 No word that reads as a verdict is on the screen.
 *   SC7 The review round on the screen: a toilet in a corner is not labelled
 *       and the screen says why; a sink in a vanity is measured from the
 *       cabinet's front; both rows for the space in front say a door's swing
 *       is not counted; a door is a plain number.
 *   SC8 A New York City bathroom at 82.5 in is set beside that city's 7 ft
 *       line and does not read Roomy; a bedroom anywhere else has no 8 ft
 *       line, and in New York City it has.
 *
 * The pure rules have their own direct tests with planted mutations in
 * scripts/validate-scan-clearance.ts.
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

const mockUpdateProject = jest.fn();
// Where the project is. '' is no address at all; SC8 sets a New York City one and a Baltimore one.
let mockLocation = '';
jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({ getProject: () => ({ id: 'proj-1', name: 'Maple St', location: mockLocation, linkedEstimate: null, estimateVersions: [] }), updateProject: mockUpdateProject, settings: { location: '' } }),
}));
jest.mock('@/contexts/MaterialCartContext', () => ({ useMaterialCart: () => ({ globalMarkup: 20, markupDecided: true }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
// The one-time scan notice (hooks/useScanAck) is already acknowledged here; __tests__/smoke/scan-ack.test.tsx tests the notice itself.
jest.mock('@/hooks/useScanAck', () => ({ useScanAck: () => ({ ensure: async () => true, known: () => true }) }));
jest.mock('@/hooks/useScopeCostBook', () => {
  const { buildCostDatabase } = jest.requireActual('@/utils/costDatabase');
  const db = buildCostDatabase([], [], [], [], []);
  return { useScopeCostBook: () => db };
});

const mockSaveScan = jest.fn(async (_saved?: unknown, _raw?: unknown) => true);
jest.mock('@/utils/roomScan/store', () => ({
  loadSavedScans: async () => ({ version: 1, scans: [] }),
  saveScan: (saved: unknown, raw: unknown) => mockSaveScan(saved, raw),
  hashRawScan: async () => 'hash',
  deleteScan: async () => true,
}));
jest.mock('@/utils/roomScan/learnStore', () => ({
  loadTapePairs: async () => [],
  recordTapePairs: async () => [],
  forgetScanTapePairs: async () => {},
  forgetScansTapePairs: async () => null,
}));
jest.mock('@/utils/clipboard', () => ({ copyToClipboard: async () => true }));
jest.mock('@/utils/shareText', () => ({ shareText: async () => 'shared', canShare: () => true }));
jest.mock('@/utils/roomScan/native', () => ({
  getCapabilities: () => null, startScan: jest.fn(), isModuleLinked: () => false, roomScanErrorCode: () => null,
}));

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RoomScanFlow } from '@/components/roomScan/RoomScanFlow';
import { parseCapturedRoom } from '@/utils/roomScan/capturedRoomParser';
import { buildRoomScan } from '@/utils/roomScan/geometryCore';
import type { SavedScan } from '@/utils/roomScan/storeCore';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
);
// The owner's address, as __tests__/smoke/scan-build.test.tsx writes it (utils/owner OWNER_EMAILS).
const OWNER = 'omirmajeed2000@gmail.com';

function room(file: string): SavedScan {
  const raw = fs.readFileSync(path.resolve(__dirname, `../../scripts/fixtures/scan-room/${file}.json`), 'utf8');
  const scan = buildRoomScan(parseCapturedRoom(raw), {
    id: 'scan-1', projectId: 'proj-1', name: 'Hall Bathroom', capturedAt: '2026-10-06T13:41:00.000Z', device: { model: 'iPhone16,1', os: '17.5' },
  });
  return { scan, pushed: {}, manualRates: {}, excluded: [], savedAt: '', pricedAt: null };
}
const settle = async () => { await act(async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); }); };
type Node = { children: (Node | string)[] };
const textOf = (n: Node): string => n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

async function openClearance(file = 'tight-bath') {
  const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={room(file)} userEmail={OWNER} />, { wrapper: Wrap });
  await settle();
  fireEvent.press(tree.getByTestId('scan-open-clearance'));
  await settle();
  return tree;
}
/** The row whose label starts with these words: its test id ends in the measure's own id. */
function rowId(tree: ReturnType<typeof render>, starts: string): string {
  const rows = tree.getAllByTestId(/^scan-clearance-row-/);
  const hit = rows.find((r) => String(r.props.accessibilityLabel).startsWith(starts));
  if (!hit) throw new Error(`no row starts with "${starts}": ${rows.map((r) => r.props.accessibilityLabel).join(' | ')}`);
  return String(hit.props.testID).replace('scan-clearance-row-', '');
}

describe('Scan The Room, Clearance Check', () => {
  beforeEach(() => { mockPush.mockClear(); mockUpdateProject.mockClear(); mockSaveScan.mockClear(); mockLocation = ''; });
  afterEach(async () => { await cleanupAsync(); });

  it('SC1 the owner reaches it from the plan, and the tight bathroom reads as worked by hand', async () => {
    const tree = await openClearance();
    expect(textOf(tree.getByTestId('scan-clearance-notice') as unknown as Node)).toContain('A phone scan can be off by an inch or more');
    const expectRow = (starts: string, value: string, state: string) => {
      const id = rowId(tree, starts);
      expect(textOf(tree.getByTestId(`scan-clearance-value-${id}`) as unknown as Node)).toBe(value);
      expect(textOf(tree.getByTestId(`scan-clearance-state-${id}`) as unknown as Node)).toBe(state);
      return id;
    };
    // 52 less 39.5 is 12.5 in, shown to the nearest inch.
    expectRow('Toilet, Center Line To The Sink', '1 ft 1 in', 'Tight, Tape It And Check Your Local Code');
    expectRow('Toilet, Center Line To The Tub', '1 ft 2 in', 'Close, Tape It');
    // 50 less 28 is 22 in, read against 21 in alone: close. (It read Tight while it was also read against 24 in.)
    const front = expectRow('Toilet, Clear Space In Front, To A Cabinet', '1 ft 10 in', 'Close, Tape It');
    expectRow('Sink, Clear Space In Front, To Wall', '3 ft 4 in', 'Roomy');
    // A 28 in bathroom door is ordinary: a plain number, set beside nothing.
    const door = expectRow('Door, Width As Scanned', '2 ft 4 in', 'Not checked against anything');
    expect(tree.queryByTestId(`scan-clearance-figure-${door}-door_clear_32`)).toBeNull();
    expectRow('Lowest Ceiling The Scan Saw', '6 ft 9 in', 'Close, Tape It');
    // The toilet's front is set beside the one figure, with the local sentence. The other figure is only mentioned.
    const f21 = textOf(tree.getByTestId(`scan-clearance-figure-${front}-toilet_front_21`) as unknown as Node);
    expect(f21).toContain('21 in: clear space in front of a toilet. From the model residential code and the model plumbing code.');
    expect(f21).toContain('A commonly used figure. Your local code may differ.');
    expect(tree.queryByTestId(`scan-clearance-figure-${front}-toilet_front_24`)).toBeNull();
    const frontRow = textOf(tree.getByTestId(`scan-clearance-row-${front}`) as unknown as Node);
    expect(frontRow).toContain('Some places use 24 in for clear space in front of a toilet. That figure is from a different family of plumbing code than the one New York and Maryland use.');
    expect(frontRow).toContain('A door swinging into this space is not counted.');
    expect(textOf(tree.getByTestId('scan-clearance-margin-body') as unknown as Node)).toBe('The margin is 1.5 in. That is how far off this check takes a scanned distance to be.');
  });

  it('SC2 a row with no label says so, and the standing sentences are drawn', async () => {
    const tree = await openClearance();
    const id = rowId(tree, 'Narrowest Width Between Walls');
    expect(textOf(tree.getByTestId(`scan-clearance-value-${id}`) as unknown as Node)).toBe('5 ft 0 in');
    expect(textOf(tree.getByTestId(`scan-clearance-state-${id}`) as unknown as Node)).toBe('Not checked against anything');
    expect(textOf(tree.getByTestId('scan-clearance-not-checked') as unknown as Node)).toBe('A measurement with no label has not been checked against anything.');
    const never = textOf(tree.getByTestId('scan-clearance-never') as unknown as Node);
    expect(never).toContain('This check never clears a room.');
    expect(never).toContain('Nothing here stops you from saving, pricing or sending anything.');
    expect(textOf(tree.getByTestId('scan-clearance-left-stairs') as unknown as Node)).toBe('Stairs are not measured. A scan does not carry risers or treads.');
    expect(textOf(tree.getByTestId('scan-clearance-left-tub_opening') as unknown as Node)).toContain('not measured');
    expect(textOf(tree.getByTestId('scan-clearance-left-door_clear') as unknown as Node)).toContain('The scan cannot see it.');
  });

  it('SC3 tapping a row draws it on the plan, tapping again takes it off', async () => {
    const tree = await openClearance();
    expect(tree.queryByTestId('scan-clearance-dimension-value')).toBeNull();
    const id = rowId(tree, 'Toilet, Center Line To The Tub');
    fireEvent.press(tree.getByTestId(`scan-clearance-row-${id}`));
    await settle();
    expect(textOf(tree.getByTestId('scan-clearance-dimension-value') as unknown as Node)).toBe('1 ft 2 in');
    expect(tree.getByTestId(`scan-clearance-row-${id}`).props.accessibilityState).toEqual({ selected: true });
    fireEvent.press(tree.getByTestId(`scan-clearance-row-${id}`));
    await settle();
    expect(tree.queryByTestId('scan-clearance-dimension-value')).toBeNull();
    // A height has no line on a plan: choosing the ceiling draws nothing.
    fireEvent.press(tree.getByTestId(`scan-clearance-row-${rowId(tree, 'Lowest Ceiling')}`));
    await settle();
    expect(tree.queryByTestId('scan-clearance-dimension-value')).toBeNull();
  });

  it('SC4 the one action opens Code Check and nothing is written', async () => {
    const tree = await openClearance();
    fireEvent.press(tree.getByTestId('scan-clearance-code-check'));
    await settle();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: '/(tabs)/construction-ai', params: { projectId: 'proj-1' } });
    expect(mockUpdateProject).not.toHaveBeenCalled();
    expect(mockSaveScan).not.toHaveBeenCalled();
    // Back on the plan, the scan can still be priced: no state held anything up.
    fireEvent.press(tree.getByTestId('scan-back'));
    await settle();
    expect(tree.getByTestId('scan-see-quantities')).toBeTruthy();
  });

  it('SC5 someone the gate refuses gets no door', async () => {
    for (const email of [undefined, null, 'someone@example.com']) {
      const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate initial={room('tight-bath')} userEmail={email} />, { wrapper: Wrap });
      await settle();
      expect(tree.getByTestId('scan-see-quantities')).toBeTruthy();
      expect(tree.queryByTestId('scan-open-clearance')).toBeNull();
      expect(tree.queryByTestId('scan-clearance')).toBeNull();
      await cleanupAsync();
    }
  });

  it('SC7 the review round on the screen: a corner, a vanity, a door swing, a plain door', async () => {
    // A toilet near a corner is not labelled, and the screen says why.
    const corner = await openClearance('toilet-corner-swapped');
    expect(corner.queryAllByTestId(/^scan-clearance-row-toilet/)).toHaveLength(0);
    expect(textOf(corner.getByTestId('scan-clearance-left-fixture_facing') as unknown as Node)).toBe('MAGE cannot tell which way this fixture faces. Tape it.');
    await cleanupAsync();
    // A sink in a vanity: 60 less 22 is 38 in, from the cabinet's front. Not 3 in from the sink's own edge.
    const vanity = await openClearance('vanity-sink');
    const sink = rowId(vanity, 'Sink, Clear Space In Front, To Wall');
    expect(textOf(vanity.getByTestId(`scan-clearance-value-${sink}`) as unknown as Node)).toBe('3 ft 2 in');
    expect(textOf(vanity.getByTestId(`scan-clearance-state-${sink}`) as unknown as Node)).toBe('Roomy');
    const sinkRow = textOf(vanity.getByTestId(`scan-clearance-row-${sink}`) as unknown as Node);
    expect(sinkRow).toContain('The sink sits in a cabinet, so this is measured from the front of the cabinet.');
    expect(sinkRow).toContain('A door swinging into this space is not counted.');
    expect(textOf(vanity.getByTestId('scan-clearance-states') as unknown as Node)).toContain('Past the commonly used figure by more than the margin, as scanned. Not checked against your local code.');
    await cleanupAsync();
    // A cabinet beside the front half of the bowl: 8 in, not 48.
    const beside = await openClearance('toilet-side-cabinet');
    const side = rowId(beside, 'Toilet, Center Line To A Cabinet');
    expect(textOf(beside.getByTestId(`scan-clearance-value-${side}`) as unknown as Node)).toBe('0 ft 8 in');
    expect(textOf(beside.getByTestId(`scan-clearance-state-${side}`) as unknown as Node)).toBe('Tight, Tape It And Check Your Local Code');
    await cleanupAsync();
    // A door says what the main exit door figure is, in words, and is set beside nothing.
    const hall = await openClearance('narrow-hall');
    const door = rowId(hall, 'Door 1, Width As Scanned');
    expect(textOf(hall.getByTestId(`scan-clearance-state-${door}`) as unknown as Node)).toBe('Not checked against anything');
    expect(textOf(hall.getByTestId(`scan-clearance-row-${door}`) as unknown as Node)).toContain('A commonly used figure for the clear width of the main exit door of a home with the door open is 32 in, from the model building code. A scan cannot tell which door that is, so no door gets a label here.');
  });

  it('SC8 New York City gets its two ceiling lines, and nowhere else does', async () => {
    const ceiling = async (file: string, location: string) => {
      mockLocation = location;
      const tree = await openClearance(file);
      const id = rowId(tree, 'Lowest Ceiling The Scan Saw');
      const out = {
        state: textOf(tree.getByTestId(`scan-clearance-state-${id}`) as unknown as Node),
        row: textOf(tree.getByTestId(`scan-clearance-row-${id}`) as unknown as Node),
        nycBath: tree.queryByTestId(`scan-clearance-figure-${id}-ceiling_bath_84_nyc`) !== null,
        nycRoom: tree.queryByTestId(`scan-clearance-figure-${id}-ceiling_96`) !== null,
      };
      await cleanupAsync();
      return out;
    };
    // A bathroom at 82.5 in. Anywhere else it is past 6 ft 8 in by more than the margin. In New York City it is not Roomy.
    const bathMd = await ceiling('bath-ceiling-82', 'Baltimore, MD 21201');
    expect(bathMd.state).toBe('Roomy');
    expect(bathMd.nycBath).toBe(false);
    const bathNy = await ceiling('bath-ceiling-82', 'Brooklyn, NY 11201');
    expect(bathNy.state).toBe('Close, Tape It');
    expect(bathNy.nycBath).toBe(true);
    expect(bathNy.row).toContain('7 ft 0 in: ceiling height in a bathroom. From what is commonly cited for New York City, which this app has not confirmed.');
    expect(bathNy.row).toContain('A commonly used figure. Your local code may differ.');
    // A bedroom at 96 in. Baltimore: no 8 ft line. New York City: that city's line, and on it.
    const bedMd = await ceiling('bedroom-96', 'Baltimore, MD 21201');
    expect(bedMd.state).toBe('Roomy');
    expect(bedMd.nycRoom).toBe(false);
    expect(bedMd.row).not.toContain('8 ft 0 in: ceiling height');
    expect(bedMd.row).toContain('A commonly used figure for ceiling height in a room people live in is 7 ft 6 in, from codes for buildings with several homes. This check does not set the ceiling beside it.');
    const bedNy = await ceiling('bedroom-96', 'Brooklyn, NY 11201');
    expect(bedNy.state).toBe('Close, Tape It');
    expect(bedNy.nycRoom).toBe(true);
    // No address at all is not New York City.
    const bedNone = await ceiling('bedroom-96', '');
    expect(bedNone.nycRoom).toBe(false);
  });

  it('SC6 a bedroom window is only ever worth a closer look, and no verdict word is on any screen', async () => {
    const tree = await openClearance('bedroom-window');
    const area = rowId(tree, 'Window, Opening Area As Scanned');
    expect(textOf(tree.getByTestId(`scan-clearance-value-${area}`) as unknown as Node)).toBe('6.0 sq ft');
    expect(textOf(tree.getByTestId(`scan-clearance-state-${area}`) as unknown as Node)).toBe('Close, Tape It');
    const width = rowId(tree, 'Window, Opening Width As Scanned');
    expect(textOf(tree.getByTestId(`scan-clearance-state-${width}`) as unknown as Node)).toBe('Not checked against anything');
    const all = textOf(tree.getByTestId('scan-clearance') as unknown as Node);
    expect(all).toContain('with the sash open');
    expect(all).toContain('This row never clears a window. New York City commonly asks for more than these figures.');
    expect(all).not.toMatch(/\b(pass|passes|passed|fail|fails|failed|compliant|legal|illegal|approved|violation|required|meets code|looks clear)\b/i);
    expect(all).not.toMatch(/§/);
  });
});
