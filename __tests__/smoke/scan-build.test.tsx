/**
 * Smoke — Scan The Room, the owner preview build (lane SCANBUILD).
 *
 * SCAN_ROOM_ENABLED is false. These tests run the REAL gate
 * (utils/roomScan/allowed), the REAL native lookup (utils/roomScan/native, with
 * only `expo`'s requireOptionalNativeModule stood in for), the real parser, the
 * real facts (scanDebugCore) and the real raw keep (rawKeep, on the test
 * AsyncStorage). Only the contexts, the router, the cost book, the share sheet
 * and the file system are stood in for.
 *
 *   B1  a contractor who is not the owner: no row, the route redirects, and the
 *       native module is never looked up.
 *   B2  the owner: the row "Scan A Room (Owner Preview)" shows and opens
 *       /scan-room for this project.
 *   B3  a build without the module: the lookup answers "not in this build" and
 *       never throws, for the owner too.
 *   B4  a scan that reads: the plan, Scan Facts with equal counts, the raw JSON
 *       on the phone character for character, and Share Raw Scan Data hands the
 *       share sheet a .json file that holds it.
 *   B5  a scan the app cannot read: its own screen, the raw size, the top-level
 *       keys, the real error, the share button. The raw is kept all the same.
 *   B6  the iPhone counted a wall the app did not: the mismatch is said.
 *   B7  a cancel says so. B8 an interruption says so, and the owner sees the
 *       phone's own words. B9 a scan with no walls says a scan can be too short.
 *   B10 someone who is not the owner (the flag on, one day) gets the plain
 *       sentence and none of the owner's tools.
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
jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, back: () => {}, replace: () => {} }),
    useLocalSearchParams: () => ({ projectId: 'proj-1' }),
    Redirect: ({ href }: { href: string }) => R.createElement('Redirect', { href }),
    Stack: { Screen: () => null },
  };
});

jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({ getProject: () => ({ id: 'proj-1', name: 'Maple St', linkedEstimate: null, estimateVersions: [] }), updateProject: () => {}, settings: { location: '' } }),
}));
jest.mock('@/contexts/MaterialCartContext', () => ({ useMaterialCart: () => ({ globalMarkup: 20, markupDecided: true }) }));
jest.mock('@/hooks/useScopeCostBook', () => {
  const { buildCostDatabase } = jest.requireActual('@/utils/costDatabase');
  const db = buildCostDatabase([], [], [], [], []);
  return { useScopeCostBook: () => db };
});
jest.mock('@/utils/roomScan/learnStore', () => ({
  loadTapePairs: async () => [],
  recordTapePairs: async (_userId: unknown, pairs: unknown[]) => pairs,
  forgetScanTapePairs: async () => {},
  forgetScansTapePairs: async () => null,
}));
jest.mock('@/utils/clipboard', () => ({ copyToClipboard: jest.fn(async () => true) }));
jest.mock('@/utils/shareText', () => ({ shareText: jest.fn(async () => 'shared'), canShare: () => true }));
jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => ({ tier: 'pro' }) }));
jest.mock('@/components/Paywall', () => ({ __esModule: true, default: () => null }));

const OWNER = 'omirmajeed2000@gmail.com';
let mockUser: { id: string; email?: string } | null = { id: 'user-1', email: 'someone@example.com' };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
// The one-time scan notice (hooks/useScanAck) is already acknowledged here; __tests__/smoke/scan-ack.test.tsx tests the notice itself.
jest.mock('@/hooks/useScanAck', () => ({ useScanAck: () => ({ ensure: async () => true, known: () => true }) }));

// The native half. `mockLinked = false` is a build made before the module existed.
let mockLinked = true;
const mockLookup = jest.fn();
const mockNativeStart = jest.fn();
const mockNativeCaps = jest.fn(() => ({ linked: true, supported: true, reason: 'ok', multiRoom: true, osVersion: '26.0', deviceModel: 'iPhone16,2' }));
jest.mock('expo', () => ({
  ...jest.requireActual('expo'),
  requireOptionalNativeModule: (name: string) => {
    mockLookup(name);
    return mockLinked ? { getCapabilities: () => mockNativeCaps(), startScan: (o: unknown) => mockNativeStart(o) } : null;
  },
}));

const mockShareAsync = jest.fn(async (_uri: string, _opts: unknown) => {});
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: (uri: string, opts: unknown) => mockShareAsync(uri, opts) }));
const mockWrites: Record<string, string> = {};
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  EncodingType: { UTF8: 'utf8' },
  writeAsStringAsync: async (uri: string, body: string) => { mockWrites[uri] = body; },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RoomScanFlow } from '@/components/roomScan/RoomScanFlow';
import { ScanRoomOwnerRow } from '@/components/roomScan/ScanRoomOwnerRow';
import { scanRoomAllowed, scanRoomOwnerTools } from '@/utils/roomScan/allowed';
import { SCAN_ROOM_ENABLED } from '@/constants/featureFlags';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Wrap = ({ children }: { children: React.ReactNode }) => <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
const settle = async () => { await act(async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); }); };

const RAW = fs.readFileSync(path.resolve(__dirname, '../../scripts/fixtures/scan-room/bathroom.json'), 'utf8');
const COUNTS = (() => {
  const r = JSON.parse(RAW) as Record<string, unknown[]>;
  const n = (k: string) => (Array.isArray(r[k]) ? r[k].length : 0);
  return { walls: n('walls'), doors: n('doors'), windows: n('windows'), openings: n('openings'), objects: n('objects') };
})();
const done = (json: string, over: Record<string, unknown> = {}) => ({
  status: 'done', capturedRoomJson: json, usdzUri: null, startedAt: '2026-10-08T14:00:00Z', endedAt: '2026-10-08T14:01:10Z',
  roomPlanSdk: '26.0', deviceModel: 'iPhone16,2', warnings: [], summary: { ...COUNTS }, encodeError: null, durationSeconds: 70, ...over,
});

async function scanAsOwner(result: unknown | Error) {
  mockUser = { id: 'user-1', email: OWNER };
  if (result instanceof Error) mockNativeStart.mockRejectedValueOnce(result); else mockNativeStart.mockResolvedValueOnce(result);
  const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate userEmail={OWNER} ownerTools={scanRoomOwnerTools(OWNER)} />, { wrapper: Wrap });
  await settle();
  await act(async () => { fireEvent.press(tree.getByTestId('scan-start-button')); });
  await settle();
  return tree;
}
const shareSettles = settle;
const keys = async (prefix: string) => (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));

beforeEach(async () => {
  mockPush.mockClear(); mockLookup.mockClear(); mockNativeStart.mockReset(); mockShareAsync.mockClear();
  for (const k of Object.keys(mockWrites)) delete mockWrites[k];
  mockUser = { id: 'user-1', email: 'someone@example.com' };
  await AsyncStorage.clear();
});
afterEach(async () => { await cleanupAsync(); });

describe('Scan The Room, owner preview — who gets in', () => {
  it('B1 a contractor who is not the owner has no row, no route and no native lookup', async () => {
    expect(SCAN_ROOM_ENABLED).toBe(false);
    expect(scanRoomAllowed('someone@example.com')).toBe(false);
    const row = render(<ScanRoomOwnerRow projectId="proj-1" />);
    await settle();
    expect(row.toJSON()).toBeNull();
    await cleanupAsync();
    const Route = require('@/app/scan-room').default as React.ComponentType;
    const route = render(<Route />);
    await settle();
    expect(JSON.stringify(route.toJSON())).toContain('"href":"/(tabs)/(home)"');
    expect(route.queryByTestId('scan-room-flow')).toBeNull();
    await cleanupAsync();
    // Even a flow mounted by mistake reaches nothing: the lookup itself is refused.
    const flow = render(<RoomScanFlow projectId="proj-1" mayEditEstimate userEmail="someone@example.com" />, { wrapper: Wrap });
    await settle();
    expect(flow.getByText('This version of the app does not include room scanning. It comes with a newer version from the App Store.')).toBeTruthy();
    expect(mockLookup).not.toHaveBeenCalled();
    await cleanupAsync();
    // Signed out is nobody.
    mockUser = null;
    const out = render(<ScanRoomOwnerRow projectId="proj-1" />);
    await settle();
    expect(out.toJSON()).toBeNull();
  });

  it('B2 the owner sees the row, and it opens the scanner for this project', async () => {
    mockUser = { id: 'user-1', email: ` ${OWNER.toUpperCase()} ` };
    const row = render(<ScanRoomOwnerRow projectId="proj-9" />);
    await settle();
    expect(row.getByText('Scan A Room (Owner Preview)')).toBeTruthy();
    expect(row.getByText('Only your account sees this')).toBeTruthy();
    fireEvent.press(row.getByTestId('scan-room-owner-row'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/scan-room', params: { projectId: 'proj-9' } });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('B3 a build without the module answers "not in this build" and never throws', async () => {
    mockLinked = false;
    try {
      await jest.isolateModulesAsync(async () => {
        const native = require('@/utils/roomScan/native') as typeof import('@/utils/roomScan/native');
        expect(native.getCapabilities(OWNER)).toBeNull();
        expect(native.isModuleLinked(OWNER)).toBe(false);
        let code: string | null = null;
        try { await native.startScan(OWNER, { scanId: 'x', exportUsdz: false }); } catch (e) { code = native.roomScanErrorCode(e); }
        expect(code).toBe('E_ROOM_SCAN_NOT_IN_THIS_BUILD');
      });
    } finally {
      mockLinked = true;
    }
  });
});

describe('Scan The Room, owner preview — the first scan says what happened', () => {
  it('B4 a scan that reads: the plan, equal counts, the raw kept as it came, and a file to share', async () => {
    const tree = await scanAsOwner(done(RAW));
    expect(mockNativeStart).toHaveBeenCalledWith(expect.objectContaining({ exportUsdz: false }));
    expect(tree.getByTestId('scan-plan-facts')).toBeTruthy();
    expect(tree.getByText('Scan Facts')).toBeTruthy();
    expect(tree.getByTestId('scan-facts-match')).toBeTruthy();
    expect(tree.getByTestId('scan-facts-ios').props.children).toBe('26.0');
    expect(tree.getByTestId('scan-facts-device').props.children).toBe('iPhone16,2');
    expect(tree.getByText('70 seconds')).toBeTruthy();
    // On the phone before anything else, character for character.
    const rawKeys = await keys('mageid_room_scan_raw::');
    expect(rawKeys).toHaveLength(1);
    expect(await AsyncStorage.getItem(rawKeys[0])).toBe(RAW);
    expect(await AsyncStorage.getItem('mageid_room_scan_last')).toContain('"outcome":"read"');
    // The file.
    await act(async () => { fireEvent.press(tree.getByTestId('scan-share-raw')); });
    await shareSettles();
    expect(tree.queryByTestId('scan-share-raw-error')?.props.children ?? 'no error shown').toBe('no error shown');
    expect(mockShareAsync).toHaveBeenCalledTimes(1);
    const uri = mockShareAsync.mock.calls[0][0];
    expect(uri).toBe('file:///cache/mage-room-scan-2026-10-08-unnamed-room.json');
    expect(mockShareAsync.mock.calls[0][1]).toEqual(expect.objectContaining({ mimeType: 'application/json' }));
    expect(mockWrites[uri]).toContain(RAW);
    expect(JSON.parse(mockWrites[uri]).mageScanFacts.counts[0]).toEqual({ key: 'walls', phone: COUNTS.walls, file: COUNTS.walls, app: COUNTS.walls, match: true });
    expect(tree.getByTestId('scan-share-raw-shared')).toBeTruthy();
    expect(tree.getByText('The file holds the shapes and sizes of the room and the facts on this screen. It holds no photos and no video.')).toBeTruthy();
  });

  it('B5 a scan the app cannot read has its own screen, and the raw is still kept and shared', async () => {
    const odd = '{"rooms":[{"surfaces":[]}],"version":2}';
    const tree = await scanAsOwner(done(odd));
    expect(tree.getByTestId('scan-unread-unreadable')).toBeTruthy();
    expect(tree.getByText('The scan finished, but MAGE could not read it yet.')).toBeTruthy();
    expect(tree.getByText(`${odd.length} characters`)).toBeTruthy();
    expect(tree.getByTestId('scan-facts-keys').props.children).toBe('rooms, version');
    expect(tree.getByTestId('scan-facts-error').props.children).toBe('The scan file has no list of walls');
    expect(tree.getByTestId('scan-facts-mismatch')).toBeTruthy();
    const rawKeys = await keys('mageid_room_scan_raw::');
    expect(await AsyncStorage.getItem(rawKeys[0])).toBe(odd);
    await act(async () => { fireEvent.press(tree.getByTestId('scan-share-raw')); });
    await shareSettles();
    expect(Object.values(mockWrites)[0]).toContain(odd);
    // And it is still there after the app is opened again.
    await cleanupAsync();
    const again = render(<RoomScanFlow projectId="proj-1" mayEditEstimate userEmail={OWNER} ownerTools />, { wrapper: Wrap });
    await settle();
    expect(again.getByText('Last Scan On This Phone')).toBeTruthy();
    expect(again.getByTestId('scan-facts-keys').props.children).toBe('rooms, version');
  });

  it('B5b text that is not JSON at all is still a screen, never a crash', async () => {
    const tree = await scanAsOwner(done('<<not json>>'));
    expect(tree.getByTestId('scan-unread-unreadable')).toBeTruthy();
    expect(tree.getByTestId('scan-facts-keys').props.children).toBe('None found');
    expect(tree.getByTestId('scan-facts-error').props.children).toBe('The scan file is not JSON');
  });

  it('B6 a wall the iPhone counted and the app did not is said', async () => {
    const tree = await scanAsOwner(done(RAW, { summary: { ...COUNTS, walls: COUNTS.walls + 1 } }));
    expect(tree.getByTestId('scan-facts-mismatch')).toBeTruthy();
    expect(tree.getByText('The counts do not match. Share the raw scan data.')).toBeTruthy();
  });

  it('B7 a cancel says so and keeps nothing', async () => {
    const tree = await scanAsOwner({ status: 'cancelled', capturedRoomJson: '', usdzUri: null, startedAt: '', endedAt: '', roomPlanSdk: '26.0', deviceModel: 'iPhone16,2', warnings: [], summary: null });
    expect(tree.getByText('The scan was cancelled. Nothing was saved.')).toBeTruthy();
    expect(tree.getByTestId('scan-start-button')).toBeTruthy();
    expect(await keys('mageid_room_scan')).toHaveLength(0);
  });

  it('B8 an interruption says so, with the phone\'s own words for the owner', async () => {
    const err = Object.assign(new Error('The room scan was interrupted because the app left the screen.'), { code: 'E_ROOM_SCAN_INTERRUPTED' });
    const tree = await scanAsOwner(err);
    expect(tree.getByTestId('scan-ended-E_ROOM_SCAN_INTERRUPTED')).toBeTruthy();
    expect(tree.getByText('The scan stopped because the app left the screen. Nothing was saved. Keep MAGE ID open and the phone unlocked until you tap Done.')).toBeTruthy();
    expect(tree.getByText('What the iPhone said: The room scan was interrupted because the app left the screen.')).toBeTruthy();
    expect(tree.getByTestId('scan-start-button')).toBeTruthy();
  });

  it('B8b a session error has its sentence, and an error with no code has one too', async () => {
    const a = await scanAsOwner(Object.assign(new Error('The room scan stopped: worldTrackingFailure: tracking was lost'), { code: 'E_ROOM_SCAN_SESSION_FAILED' }));
    expect(a.getByText('The iPhone stopped the scan before it finished. Nothing was saved. Turn on more light, move more slowly and try again.')).toBeTruthy();
    await cleanupAsync();
    const b = await scanAsOwner(new Error('boom'));
    expect(b.getByTestId('scan-ended-unknown')).toBeTruthy();
    expect(b.getByText('The scan stopped before it finished. Nothing was saved. Try again.')).toBeTruthy();
  });

  it('B9 a scan with no walls says a scan can be too short', async () => {
    const empty = JSON.stringify({ ...JSON.parse(RAW), walls: [] });
    const tree = await scanAsOwner(done(empty, { summary: { walls: 0, doors: 0, windows: 0, openings: 0, objects: 0 } }));
    expect(tree.getByTestId('scan-unread-noWalls')).toBeTruthy();
    expect(tree.getByText(/The scan finished, but it holds no walls\. A scan that is too short/)).toBeTruthy();
    expect(tree.getByTestId('scan-unread-again')).toBeTruthy();
  });

  it('B9b a room the iPhone could not encode comes back with its own counts', async () => {
    const tree = await scanAsOwner(done('', { encodeError: 'invalidValue: not a number' }));
    expect(tree.getByTestId('scan-unread-notEncoded')).toBeTruthy();
    expect(tree.getByTestId('scan-facts-error').props.children).toBe('invalidValue: not a number');
    expect(tree.getByText('0 characters')).toBeTruthy();
    expect(await keys('mageid_room_scan_raw::')).toHaveLength(0);
    expect(await AsyncStorage.getItem('mageid_room_scan_last')).toContain('"outcome":"notEncoded"');
  });

  it('B10 without the owner\'s tools an unread scan is a plain sentence and nothing else', async () => {
    mockUser = { id: 'user-1', email: OWNER };
    mockNativeStart.mockResolvedValueOnce(done('{"rooms":[]}'));
    const tree = render(<RoomScanFlow projectId="proj-1" mayEditEstimate userEmail={OWNER} />, { wrapper: Wrap });
    await settle();
    await act(async () => { fireEvent.press(tree.getByTestId('scan-start-button')); });
    await settle();
    expect(tree.getByText('The scan finished, but MAGE could not read it yet.')).toBeTruthy();
    expect(tree.getByText('Nothing was added to the project. Scan the room again.')).toBeTruthy();
    expect(tree.queryByTestId('scan-facts')).toBeNull();
    expect(tree.queryByTestId('scan-share-raw')).toBeNull();
  });
});
