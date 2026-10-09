/**
 * Smoke — the Living Model saved to the account (lane LIVINGSYNC): the screen
 * (components/livingModel/LivingModelScreen) with the real sync hook
 * (hooks/useLivingModelSync), the real rules (utils/livingModel/syncCore) and
 * the real device stores over jest's AsyncStorage mock. ONLY the server file
 * (utils/livingModel/syncIo) is faked: a small account that keeps one row, has
 * revisions, and refuses a stale save the way the migration does.
 *
 *   1  a database without the table: the device-only line, no error, nothing sent
 *   2  no row in the account and a room on the device: sent once, based on 0, read back, "Saved to your account."
 *   3  THE SCAN ASK: a scanned room is not sent until Save to My Account; Keep on This Phone keeps the whole
 *      model on the phone and can be changed; what is sent holds nothing of the scan but the room
 *   4  the account is ahead and this device has no changes: the account's model is taken, with no question
 *   5  BOTH CHANGED: nothing is sent or replaced; Use the One in Your Account keeps this device's model first,
 *      and Remove the Kept Model is the only thing that removes it
 *   6  BOTH CHANGED: Keep This Device's Model keeps the account's model first, then sends on the account's revision
 *   7  a queued save says "Waiting to send."; a refused one says "Could not save to your account."
 *   8  the account's copy saved by someone else says who and when
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanupAsync, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const value = { colors: { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') }, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {} }), Stack: { Screen: () => null } }));
jest.mock('three', () => ({}));

const PROJECT = '10000000-0000-4000-8000-000000000001';
const ME = 'user-1';
const TEAMMATE = 'user-2';
const mockProject = { id: PROJECT, name: 'Maple Street', schedule: null };
jest.mock('@/contexts/ProjectContext', () => ({ useProjects: () => ({ getProject: () => mockProject, getDailyReportsForProject: () => [] }) }));
jest.mock('@/hooks/useProjectCollaborators', () => ({
  useProjectCollaborators: () => ({ collaborators: [{ id: 'c1', userId: 'user-2', email: 'maria@example.com', name: '', role: 'editor', status: 'accepted' }] }),
}));

// ── the fake account ──
interface Row { model: unknown; revision: number; last_write_id: string; schema_version: number; updated_at: string; updated_by: string | null }
const mockAccount: { table: boolean; row: Row | null; outcome: 'synced' | 'queued' | 'failed'; pushes: { base: number; writeId: string; model: unknown }[]; headReads: number } =
  { table: true, row: null, outcome: 'synced', pushes: [], headReads: 0 };
jest.mock('@/utils/livingModel/syncIo', () => {
  const core = jest.requireActual('@/utils/livingModel/syncCore');
  const read = (withModel: boolean) => {
    if (!mockAccount.table) return { kind: 'missing' };
    if (!mockAccount.row) return { kind: 'none' };
    return { kind: 'row', head: core.parseServerHead(mockAccount.row), value: withModel ? mockAccount.row.model : null };
  };
  return {
    accountReachable: () => true,
    accountSessionUserId: async () => 'user-1',
    fetchAccountHead: async () => { mockAccount.headReads += 1; return read(false); },
    fetchAccountModel: async () => read(true),
    accountQueueHolds: async () => ({ modelSave: false, projectInsert: false }),
    kickAccountQueueDrain: () => {},
    onAccountQueueSignal: () => () => {},
    pushAccountModel: async (_projectId: string, model: unknown, base: number, writeId: string) => {
      const args = core.saveArgs(_projectId, model, base, writeId);
      mockAccount.pushes.push({ base, writeId, model: JSON.parse(JSON.stringify(args.p_model)) });
      if (mockAccount.outcome !== 'synced') return mockAccount.outcome;
      // The migration's rule: saved only when based on the row's revision (0 = no row).
      const at = mockAccount.row ? mockAccount.row.revision : 0;
      if (at !== base) return 'synced';
      mockAccount.row = { model: JSON.parse(JSON.stringify(args.p_model)), revision: at + 1, last_write_id: writeId, schema_version: 1, updated_at: new Date().toISOString(), updated_by: 'user-1' };
      return 'synced';
    },
  };
});

import { LivingModelScreen } from '@/components/livingModel/LivingModelScreen';
import { addRoom, emptyJobModel, makeRectRoom, roomFromScan } from '@/utils/livingModel/modelCore';
import { livingModelKeptKey, livingModelKey, livingModelSyncKey } from '@/utils/livingModel/storeCore';
import { EMPTY_SYNC_META, modelFingerprint, modelForAccount, type ModelSyncMeta } from '@/utils/livingModel/syncCore';
import type { JobModel } from '@/utils/livingModel/types';
import type { RoomScan } from '@/utils/roomScan/types';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5)); }); };
const KEY = livingModelKey(ME, PROJECT) as string;
const META = livingModelSyncKey(ME, PROJECT) as string;
const KEPT = livingModelKeptKey(ME, PROJECT) as string;

const rect = (id: string, name: string, xM = 0): ReturnType<typeof makeRectRoom> =>
  makeRectRoom({ id, name, kind: 'other', level: 0, widthM: 4, lengthM: 3, heightM: 2.5, xM, yM: 0 } as never);
const modelOf = (...rooms: ReturnType<typeof makeRectRoom>[]): JobModel => rooms.reduce((m, r) => addRoom(m, r), emptyJobModel(PROJECT));
const RAW = 'RAW-SCAN-POISON';
const scan = {
  id: 'scan-1', projectId: PROJECT, name: 'Hall Bathroom', version: 1, capturedAt: '2026-01-02T03:04:05.000Z', device: { model: 'PHONE-MODEL-POISON', os: '18.0' },
  roomType: 'bathroom', suggestedRoomType: null,
  walls: [
    { id: 'w1', label: 'Wall 1', a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, lengthM: 3, scanLengthM: 3, lengthSource: 'scan', heightM: 2.4, confidence: 'high', curved: false, onOutline: true },
    { id: 'w2', label: 'Wall 2', a: { x: 3, y: 0 }, b: { x: 3, y: 2 }, lengthM: 2, scanLengthM: 2, lengthSource: 'scan', heightM: 2.4, confidence: 'high', curved: false, onOutline: true },
    { id: 'w3', label: 'Wall 3', a: { x: 3, y: 2 }, b: { x: 0, y: 2 }, lengthM: 3, scanLengthM: 3, lengthSource: 'scan', heightM: 2.4, confidence: 'high', curved: false, onOutline: true },
    { id: 'w4', label: 'Wall 4', a: { x: 0, y: 2 }, b: { x: 0, y: 0 }, lengthM: 2, scanLengthM: 2, lengthSource: 'scan', heightM: 2.4, confidence: 'high', curved: false, onOutline: true },
  ],
  openings: [], objects: [], floor: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 2 }, { x: 0, y: 2 }],
  closure: { closed: true, gapM: 0, gaps: 0, gapWallIds: [], cause: 'scan' },
  ceilingHeightM: { known: true, min: 2.4, max: 2.4, typical: 2.4, source: 'scan' },
  warnings: [], tapeChecks: [], edits: [], rawSha256: 'HASH-POISON',
} as unknown as RoomScan;

async function seedDevice(model: JobModel, meta?: Partial<ModelSyncMeta>) {
  await AsyncStorage.setItem(KEY, JSON.stringify({ ...model, updatedAt: '2026-10-01T00:00:00.000Z' }));
  if (meta) await AsyncStorage.setItem(META, JSON.stringify({ ...EMPTY_SYNC_META, ...meta }));
}
function seedAccount(model: JobModel, revision: number, by: string | null = ME, writeId = 'w-elsewhere') {
  mockAccount.row = { model: JSON.parse(JSON.stringify(modelForAccount(model))), revision, last_write_id: writeId, schema_version: 1, updated_at: '2026-10-08T15:42:00.000Z', updated_by: by };
}
async function open() {
  render(<SafeAreaProvider initialMetrics={METRICS}><LivingModelScreen projectId={PROJECT} userId={ME} /></SafeAreaProvider>);
  await settle();
  await settle();
}
const deviceRooms = async (): Promise<string[]> => (JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{"rooms":[]}') as JobModel).rooms.map((r) => r.name);
const accountRooms = (): string[] => ((mockAccount.row?.model ?? { rooms: [] }) as JobModel).rooms.map((r) => r.name);

beforeEach(async () => {
  mockAccount.table = true;
  mockAccount.row = null;
  mockAccount.outcome = 'synced';
  mockAccount.pushes = [];
  mockAccount.headReads = 0;
  await AsyncStorage.clear();
});
afterEach(async () => { await cleanupAsync(); });

describe('saving the model to the account', () => {
  it('1  a database without the table: the device-only line, no error, nothing sent', async () => {
    mockAccount.table = false;
    await seedDevice(modelOf(rect('r1', 'Kitchen')));
    await open();
    expect(screen.getByTestId('lm-saved-local').props.children).toBe('Saved on this device only for now. It will not appear on your other devices.');
    expect(screen.queryByTestId('lm-sync-failed')).toBeNull();
    expect(screen.queryByTestId('lm-sync-waiting')).toBeNull();
    expect(mockAccount.pushes).toHaveLength(0);
    expect(await AsyncStorage.getItem(META)).toBeNull();
    expect(await deviceRooms()).toEqual(['Kitchen']);
  });

  it('2  no row in the account and a room on the device: sent once, based on 0, read back, and the line says saved', async () => {
    await seedDevice(modelOf(rect('r1', 'Kitchen')));
    await open();
    expect(mockAccount.pushes).toHaveLength(1);
    expect(mockAccount.pushes[0].base).toBe(0);
    expect(accountRooms()).toEqual(['Kitchen']);
    expect(String(screen.getByTestId('lm-sync-saved').props.children)).toMatch(/^Saved to your account\. Last saved at /);
    expect(screen.queryByTestId('lm-saved-local')).toBeNull();
    const meta = JSON.parse((await AsyncStorage.getItem(META)) as string) as ModelSyncMeta;
    expect(meta.baseRevision).toBe(1);
    expect(meta.pending).toBeNull();
  });

  it('3  the scan ask: nothing is sent until Save to My Account, and Keep on This Phone keeps the whole model on the phone', async () => {
    const withScan = addRoom(modelOf(rect('r1', 'Kitchen')), roomFromScan(scan, { id: 'r-scan', placement: { xM: 6, yM: 0 } }));
    const stuffed = JSON.parse(JSON.stringify(withScan)) as JobModel & { rooms: Record<string, unknown>[] };
    Object.assign(stuffed.rooms[1], { raw: RAW, rawSha256: 'HASH-POISON', device: { model: 'PHONE-MODEL-POISON' } });
    await seedDevice(stuffed as JobModel);
    await open();
    expect(screen.getByTestId('lm-scan-ask')).toBeTruthy();
    expect(screen.getByText('This model includes a room you scanned.')).toBeTruthy();
    expect(screen.getByText('Saving it to your account sends that room’s sizes (walls, doors, windows and fixtures) to MAGE ID’s servers so your other devices and your team on this project can see it. No photo or video is sent.')).toBeTruthy();
    expect(mockAccount.pushes).toHaveLength(0);
    expect(mockAccount.row).toBeNull();

    fireEvent.press(screen.getByTestId('lm-scan-ask-device'));
    await settle();
    expect(screen.getByTestId('lm-kept-on-phone')).toBeTruthy();
    expect(screen.getByText('Kept on this phone only, as you chose. It will not appear on your other devices.')).toBeTruthy();
    expect(mockAccount.pushes).toHaveLength(0);
    expect((JSON.parse((await AsyncStorage.getItem(META)) as string) as ModelSyncMeta).scanChoice).toBe('device');
    const readsBefore = mockAccount.headReads;
    await settle();
    expect(mockAccount.headReads).toBe(readsBefore);

    fireEvent.press(screen.getByTestId('lm-kept-on-phone-change'));
    await settle();
    await settle();
    expect(mockAccount.pushes).toHaveLength(1);
    expect(accountRooms()).toEqual(['Kitchen', 'Hall Bathroom']);
    const sent = JSON.stringify(mockAccount.pushes[0].model);
    for (const poison of [RAW, 'HASH-POISON', 'PHONE-MODEL-POISON', '2026-01-02T03:04:05.000Z']) expect(sent).not.toContain(poison);
    expect(screen.getByTestId('lm-sync-saved')).toBeTruthy();
    expect(screen.getByTestId('lm-scan-change-device')).toBeTruthy();
  });

  it('4  the account is ahead and this device has no changes: the account model is taken, with no question', async () => {
    const mine = modelOf(rect('r1', 'Kitchen'));
    await seedDevice(mine, { accountSeen: true, baseRevision: 2, baseFingerprint: modelFingerprint(mine) });
    seedAccount(modelOf(rect('r1', 'Kitchen'), rect('r2', 'Pantry', 6)), 3, TEAMMATE);
    await open();
    expect(screen.queryByTestId('lm-conflict')).toBeNull();
    expect(await deviceRooms()).toEqual(['Kitchen', 'Pantry']);
    expect(screen.getAllByText('Pantry').length).toBeGreaterThan(0);
    expect(mockAccount.pushes).toHaveLength(0);
    expect(await AsyncStorage.getItem(KEPT)).toBeNull();
  });

  it('5  both changed: nothing is sent or replaced until he chooses; Use the One in Your Account keeps this device’s model first', async () => {
    const base = modelOf(rect('r1', 'Kitchen'));
    await seedDevice(modelOf(rect('r1', 'Kitchen'), rect('r3', 'Den', 6)), { accountSeen: true, baseRevision: 2, baseFingerprint: modelFingerprint(base) });
    seedAccount(modelOf(rect('r1', 'Kitchen'), rect('r2', 'Pantry', 6)), 5, TEAMMATE);
    await open();
    expect(screen.getByTestId('lm-conflict')).toBeTruthy();
    expect(screen.getByText('This device has changes that are not in your account.')).toBeTruthy();
    expect(screen.getByText('Keep This Device’s Model')).toBeTruthy();
    expect(screen.getByText('Use the One in Your Account')).toBeTruthy();
    expect(mockAccount.pushes).toHaveLength(0);
    expect(await deviceRooms()).toEqual(['Kitchen', 'Den']);
    expect(accountRooms()).toEqual(['Kitchen', 'Pantry']);
    expect(await AsyncStorage.getItem(KEPT)).toBeNull();
    await settle();
    expect(mockAccount.pushes).toHaveLength(0);

    fireEvent.press(screen.getByTestId('lm-conflict-use-account'));
    await settle();
    await settle();
    const kept = JSON.parse((await AsyncStorage.getItem(KEPT)) as string) as { from: string; model: JobModel };
    expect(kept.from).toBe('device');
    expect(kept.model.rooms.map((r) => r.name)).toEqual(['Kitchen', 'Den']);
    expect(await deviceRooms()).toEqual(['Kitchen', 'Pantry']);
    expect(mockAccount.pushes).toHaveLength(0);
    expect(screen.queryByTestId('lm-conflict')).toBeNull();
    expect(screen.getByTestId('lm-kept')).toBeTruthy();
    expect(screen.getByText('The model you did not keep is still on this device.')).toBeTruthy();

    fireEvent.press(screen.getByTestId('lm-kept-remove'));
    await settle();
    expect(await AsyncStorage.getItem(KEPT)).toBeNull();
    expect(screen.queryByTestId('lm-kept')).toBeNull();
  });

  it('6  both changed: Keep This Device’s Model keeps the account model first, then sends on the account’s revision', async () => {
    const base = modelOf(rect('r1', 'Kitchen'));
    await seedDevice(modelOf(rect('r1', 'Kitchen'), rect('r3', 'Den', 6)), { accountSeen: true, baseRevision: 2, baseFingerprint: modelFingerprint(base) });
    seedAccount(modelOf(rect('r1', 'Kitchen'), rect('r2', 'Pantry', 6)), 5, TEAMMATE);
    await open();
    expect(screen.getByTestId('lm-conflict')).toBeTruthy();
    fireEvent.press(screen.getByTestId('lm-conflict-keep-device'));
    await settle();
    await settle();
    const kept = JSON.parse((await AsyncStorage.getItem(KEPT)) as string) as { from: string; model: JobModel };
    expect(kept.from).toBe('account');
    expect(kept.model.rooms.map((r) => r.name)).toEqual(['Kitchen', 'Pantry']);
    expect(mockAccount.pushes).toHaveLength(1);
    expect(mockAccount.pushes[0].base).toBe(5);
    expect(accountRooms()).toEqual(['Kitchen', 'Den']);
    expect(await deviceRooms()).toEqual(['Kitchen', 'Den']);
    expect(screen.getByText('The model from your account that you did not keep is still on this device.')).toBeTruthy();
    expect(screen.getByTestId('lm-sync-saved')).toBeTruthy();
  });

  it('7  a queued save says Waiting to send; a refused one says Could not save to your account', async () => {
    mockAccount.outcome = 'queued';
    await seedDevice(modelOf(rect('r1', 'Kitchen')));
    await open();
    expect(screen.getByTestId('lm-sync-waiting').props.children).toBe('Waiting to send. It is saved on this device.');
    expect(screen.queryByTestId('lm-sync-saved')).toBeNull();
    await cleanupAsync();

    await AsyncStorage.clear();
    mockAccount.outcome = 'failed';
    mockAccount.pushes = [];
    await seedDevice(modelOf(rect('r1', 'Kitchen')));
    await open();
    expect(screen.getByTestId('lm-sync-failed').props.children).toBe('Could not save to your account. It is saved on this device.');
    expect(screen.queryByTestId('lm-sync-saved')).toBeNull();
    expect(await deviceRooms()).toEqual(['Kitchen']);
    await settle();
    expect(mockAccount.pushes).toHaveLength(1);
  });

  it('8  the account copy saved by someone else says who and when', async () => {
    const mine = modelOf(rect('r1', 'Kitchen'));
    await seedDevice(mine, { accountSeen: true, baseRevision: 3, baseFingerprint: modelFingerprint(mine) });
    seedAccount(mine, 3, TEAMMATE);
    await open();
    expect(String(screen.getByTestId('lm-sync-saved').props.children)).toMatch(/^Saved to your account\. Last changed by maria@example\.com at /);
    await cleanupAsync();
    seedAccount(mine, 3, ME, 'w-my-other-device');
    await open();
    expect(String(screen.getByTestId('lm-sync-saved').props.children)).toMatch(/^Saved to your account\. Last changed by you at /);
  });
});
