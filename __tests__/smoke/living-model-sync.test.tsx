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
 *   9  a QUEUED save followed by Keep on This Phone: the waiting save is taken back and nothing is sent; the panel
 *      says a copy may be in the account; Remove It from My Account asks first, then removes the account copy and
 *      leaves the device's model alone
 *  10  START A NEW MODEL with an account copy: the account copy survives, he is asked, and nothing is sent
 *  11  the model key is lost while the sync notes survive: the account copy is taken, not flattened
 *  12  USE THE KEPT MODEL INSTEAD with the app killed between its writes: both models are there at the next open
 *  13  a teammate's save takes this device's place only after this device's model is set aside, and says so
 *  14  an account copy larger than the app allows is not opened and the device's model is not changed
 *  15  this device's save landed, then a teammate saved on top: the account is ahead, no question
 *  16  the account copy was removed elsewhere: this device says so and sends nothing until asked
 *  17  a seat that may not change the model is told so, and nothing is sent
 *  18  a read-back that fails after a save went out leaves a true line, not "Checking your account"
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
interface Row { model: unknown; revision: number; last_write_id: string; schema_version: number; updated_at: string; updated_by: string | null; recent_writes?: { w: string; r: number; u: string }[] }
interface Push { base: number; writeId: string; model: unknown }
const mockAccount: {
  table: boolean; row: Row | null; outcome: 'synced' | 'queued' | 'failed'; pushes: Push[]; headReads: number;
  /** Saves waiting in the offline queue (outcome 'queued'). */
  queue: Push[]; cancels: number; removes: number; removable: boolean; yes: string[];
  /** Which reads of the row (1 = the first after the reset) fail as "offline". */
  failHeadAt: number[];
} = { table: true, row: null, outcome: 'synced', pushes: [], headReads: 0, queue: [], cancels: 0, removes: 0, removable: true, yes: [], failHeadAt: [] };
/** The migration's rule: saved only when based on the row's revision (0 = no row). */
function mockLand(p: Push): void {
  const at = mockAccount.row ? mockAccount.row.revision : 0;
  if (at !== p.base) return;
  const recent = [...(mockAccount.row?.recent_writes ?? []), { w: p.writeId, r: at + 1, u: 'user-1' }].slice(-8);
  mockAccount.row = { model: p.model, revision: at + 1, last_write_id: p.writeId, schema_version: 1, updated_at: new Date().toISOString(), updated_by: 'user-1', recent_writes: recent };
}
/** The phone is back online: everything still waiting in the queue is sent. */
function flushQueue(): void { for (const p of mockAccount.queue.splice(0)) mockLand(p); }
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
    fetchAccountHead: async () => {
      mockAccount.headReads += 1;
      if (mockAccount.failHeadAt.includes(mockAccount.headReads)) return { kind: 'offline' };
      return read(false);
    },
    fetchAccountModel: async () => read(true),
    accountQueueHolds: async () => ({ modelSave: mockAccount.queue.length > 0, projectInsert: false }),
    cancelQueuedAccountSave: async () => { mockAccount.cancels += 1; const n = mockAccount.queue.length; mockAccount.queue = []; return n > 0 ? 'removed' : 'none'; },
    removeAccountModel: async () => { mockAccount.removes += 1; if (!mockAccount.removable) return 'not_removed'; mockAccount.row = null; return 'removed'; },
    recordScanUploadYes: (userId: string, lang: string) => { mockAccount.yes.push(`${userId}:${lang}`); },
    kickAccountQueueDrain: () => {},
    onAccountQueueSignal: () => () => {},
    pushAccountModel: async (_projectId: string, model: unknown, base: number, writeId: string) => {
      const args = core.saveArgs(_projectId, model, base, writeId);
      const push = { base, writeId, model: JSON.parse(JSON.stringify(args.p_model)) };
      mockAccount.pushes.push(push);
      if (mockAccount.outcome === 'queued') { mockAccount.queue.push(push); return 'queued'; }
      if (mockAccount.outcome !== 'synced') return mockAccount.outcome;
      mockLand(push);
      return 'synced';
    },
  };
});

import { LivingModelScreen } from '@/components/livingModel/LivingModelScreen';
import { addRoom, emptyJobModel, makeRectRoom, roomFromScan } from '@/utils/livingModel/modelCore';
import { livingModelKeptKey, livingModelKey, livingModelSwapKey, livingModelSyncKey } from '@/utils/livingModel/storeCore';
import { EMPTY_SYNC_META, modelFingerprint, modelForAccount, type ModelSyncMeta } from '@/utils/livingModel/syncCore';
import type { JobModel } from '@/utils/livingModel/types';
import type { RoomScan } from '@/utils/roomScan/types';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5)); }); };
const KEY = livingModelKey(ME, PROJECT) as string;
const META = livingModelSyncKey(ME, PROJECT) as string;
const KEPT = livingModelKeptKey(ME, PROJECT) as string;
const SWAP = livingModelSwapKey(ME, PROJECT) as string;

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
async function open(viewOnly = false) {
  render(<SafeAreaProvider initialMetrics={METRICS}><LivingModelScreen projectId={PROJECT} userId={ME} viewOnly={viewOnly} /></SafeAreaProvider>);
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
  mockAccount.queue = [];
  mockAccount.cancels = 0;
  mockAccount.removes = 0;
  mockAccount.removable = true;
  mockAccount.yes = [];
  mockAccount.failHeadAt = [];
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
    expect(screen.getByText('Saving it to your account sends the room’s name and its sizes: floor outline, ceiling height, walls, doors, windows and fixtures, and that the room came from a scan. They go to MAGE ID’s servers so your other devices and your team on this project can see them. No photo or video is sent. You are asked again for each scanned room you add later.')).toBeTruthy();
    expect(screen.getByTestId('lm-scan-ask-rooms').props.children).toBe('Scanned rooms that would be sent: Hall Bathroom.');
    expect(mockAccount.pushes).toHaveLength(0);
    expect(mockAccount.row).toBeNull();
    expect(mockAccount.yes).toEqual([]);

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
    // Nothing of the scan but the room: not its id, not Apple's own wall width, not which numbers were typed, not the device's clock.
    for (const poison of [RAW, 'HASH-POISON', 'PHONE-MODEL-POISON', '2026-01-02T03:04:05.000Z', 'scan-1', 'scanId', 'scanLengthM', 'lengthSource', 'confidence', '2026-10-01T00:00:00.000Z']) expect(sent).not.toContain(poison);
    expect((mockAccount.pushes[0].model as JobModel).rooms[1].source).toBe('scan');
    expect((mockAccount.pushes[0].model as JobModel).updatedAt).toBe('');
    // His yes is recorded once, in the language he read it in, and it is a yes for THAT room.
    expect(mockAccount.yes).toEqual([`${ME}:en`]);
    expect((JSON.parse((await AsyncStorage.getItem(META)) as string) as ModelSyncMeta).scanConsentRoomIds).toEqual(['r-scan']);
    expect(screen.getByTestId('lm-sync-saved')).toBeTruthy();
    expect(screen.getByTestId('lm-scan-change-device')).toBeTruthy();
    expect(screen.getByTestId('lm-account-scan-rooms').props.children).toBe('Rooms in your account that came from a scan: Hall Bathroom.');
  });

  it('3b a room scanned and added later is asked about again: the first yes does not cover it', async () => {
    const first = addRoom(modelOf(rect('r1', 'Kitchen')), roomFromScan(scan, { id: 'r-scan', placement: { xM: 6, yM: 0 } }));
    const second = addRoom(first, roomFromScan({ ...scan, id: 'scan-2', name: 'Powder Room' } as RoomScan, { id: 'r-scan-2', placement: { xM: 12, yM: 0 } }));
    await seedDevice(second, { accountSeen: true, baseRevision: 1, baseFingerprint: modelFingerprint(first), scanChoice: 'account', accountScanRoomIds: ['r-scan'], scanConsentRoomIds: ['r-scan'] });
    seedAccount(first, 1, ME, 'w-mine');
    await open();
    expect(screen.getByTestId('lm-scan-ask')).toBeTruthy();
    expect(screen.getByTestId('lm-scan-ask-rooms').props.children).toBe('Scanned rooms that would be sent: Powder Room.');
    expect(mockAccount.pushes).toHaveLength(0);
    expect(accountRooms()).toEqual(['Kitchen', 'Hall Bathroom']);
    fireEvent.press(screen.getByTestId('lm-scan-ask-account'));
    await settle();
    await settle();
    expect(mockAccount.pushes).toHaveLength(1);
    expect(accountRooms()).toEqual(['Kitchen', 'Hall Bathroom', 'Powder Room']);
    expect(mockAccount.yes).toEqual([`${ME}:en`]);
  });

  it('4  the account is ahead and this device has no changes: the account model is taken, with no question', async () => {
    const mine = modelOf(rect('r1', 'Kitchen'));
    await seedDevice(mine, { accountSeen: true, baseRevision: 2, baseFingerprint: modelFingerprint(mine) });
    seedAccount(modelOf(rect('r1', 'Kitchen'), rect('r2', 'Pantry', 6)), 3, ME, 'w-my-other-device');
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
    mockAccount.queue = [];
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

describe('the promises around the sends', () => {
  it('9  a queued save followed by Keep on This Phone: nothing is sent, and the account copy can be removed after a confirm', async () => {
    const withScan = addRoom(modelOf(rect('r1', 'Kitchen')), roomFromScan(scan, { id: 'r-scan', placement: { xM: 6, yM: 0 } }));
    await seedDevice(withScan);
    mockAccount.outcome = 'queued';
    await open();
    fireEvent.press(screen.getByTestId('lm-scan-ask-account'));
    await settle();
    await settle();
    expect(mockAccount.queue).toHaveLength(1);
    expect(screen.getByTestId('lm-sync-waiting')).toBeTruthy();

    fireEvent.press(screen.getByTestId('lm-scan-change-device'));
    await settle();
    await settle();
    // The waiting save was taken back out of the queue. When the phone is online again nothing goes out.
    expect(mockAccount.cancels).toBe(1);
    expect(mockAccount.queue).toHaveLength(0);
    flushQueue();
    expect(mockAccount.row).toBeNull();
    expect(mockAccount.pushes).toHaveLength(1);
    await settle();
    expect(mockAccount.pushes).toHaveLength(1);
    // The true sentence: a save was handed over once, so a copy may be there. Not "kept on this phone only".
    expect(screen.getByText('Nothing more will be sent from this phone, as you chose. A copy may already be in your account.')).toBeTruthy();
    expect(screen.queryByText('Kept on this phone only, as you chose. It will not appear on your other devices.')).toBeNull();

    // A copy that did land (the request was already on the wire) can be taken away again, after a second tap.
    mockAccount.row = { model: mockAccount.pushes[0].model, revision: 1, last_write_id: mockAccount.pushes[0].writeId, schema_version: 1, updated_at: '2026-10-09T12:00:00.000Z', updated_by: ME };
    fireEvent.press(screen.getByTestId('lm-remove-from-account'));
    await settle();
    expect(mockAccount.removes).toBe(0);
    expect(mockAccount.row).not.toBeNull();
    expect(screen.getByText('This removes the model from your account for everyone on this project. The model on this phone stays. Your other devices and your team keep the copies they already have, and they will no longer find one in the account.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('lm-remove-from-account-yes'));
    await settle();
    await settle();
    expect(mockAccount.removes).toBe(1);
    expect(mockAccount.row).toBeNull();
    expect(screen.getByTestId('lm-account-copy-removed').props.children).toBe('Removed from your account. The model on this phone has not been changed.');
    expect(await deviceRooms()).toEqual(['Kitchen', 'Hall Bathroom']);
    expect(screen.getByText('Kept on this phone only, as you chose. It will not appear on your other devices.')).toBeTruthy();
    expect(screen.queryByTestId('lm-remove-from-account')).toBeNull();
    const meta = JSON.parse((await AsyncStorage.getItem(META)) as string) as ModelSyncMeta;
    expect(meta.scanChoice).toBe('device');
    expect(meta.baseRevision).toBe(0);
    expect(meta.pending).toBeNull();
    await settle();
    expect(mockAccount.pushes).toHaveLength(1);
  });

  it('9b when the account cannot be reached the copy is not called removed, and nothing is left waiting', async () => {
    const mine = modelOf(rect('r1', 'Kitchen'));
    await seedDevice(mine, { accountSeen: true, baseRevision: 2, baseFingerprint: modelFingerprint(mine), scanChoice: 'device', everSent: true });
    seedAccount(mine, 2, ME, 'w-mine');
    mockAccount.removable = false;
    await open();
    fireEvent.press(screen.getByTestId('lm-remove-from-account'));
    await settle();
    fireEvent.press(screen.getByTestId('lm-remove-from-account-yes'));
    await settle();
    await settle();
    expect(screen.getByTestId('lm-account-copy-not-removed').props.children).toBe('Could not remove it from your account. Nothing was changed. Try again when this phone is online.');
    expect(mockAccount.row).not.toBeNull();
    expect((JSON.parse((await AsyncStorage.getItem(META)) as string) as ModelSyncMeta).baseRevision).toBe(2);
    expect(await deviceRooms()).toEqual(['Kitchen']);
  });

  it('10 Start a New Model with an account copy: the account copy survives, he is asked, nothing is sent', async () => {
    const good = modelOf(rect('r1', 'Kitchen'), rect('r2', 'Pantry', 6));
    await AsyncStorage.setItem(KEY, '{"version":1,"rooms":[null');
    await AsyncStorage.setItem(META, JSON.stringify({ ...EMPTY_SYNC_META, accountSeen: true, baseRevision: 4, baseFingerprint: modelFingerprint(good) }));
    seedAccount(good, 4, ME, 'w-mine');
    await open();
    expect(screen.getByTestId('lm-unreadable')).toBeTruthy();
    expect(mockAccount.pushes).toHaveLength(0);
    fireEvent.press(screen.getByTestId('lm-start-new'));
    await settle();
    await settle();
    // The new model is empty and the notes said "matched revision 4": the old code sent the empty model on revision 4.
    expect(mockAccount.pushes).toHaveLength(0);
    expect(accountRooms()).toEqual(['Kitchen', 'Pantry']);
    expect(mockAccount.row?.revision).toBe(4);
    expect(screen.getByTestId('lm-conflict')).toBeTruthy();
    expect(screen.getByText('Your account has a model for this job.')).toBeTruthy();
    expect(screen.getByText('The model on this device is empty. Nothing has been replaced. Choose which model to keep.')).toBeTruthy();
    await settle();
    expect(mockAccount.pushes).toHaveLength(0);
    fireEvent.press(screen.getByTestId('lm-conflict-use-account'));
    await settle();
    await settle();
    expect(await deviceRooms()).toEqual(['Kitchen', 'Pantry']);
    expect(await AsyncStorage.getItem(KEPT)).toBeNull();
    expect(mockAccount.pushes).toHaveLength(0);
    expect(accountRooms()).toEqual(['Kitchen', 'Pantry']);
  });

  it('10b Start a New Model, then Keep This Device’s Model: only his own answer sends the empty model, and the account copy is kept first', async () => {
    const good = modelOf(rect('r1', 'Kitchen'));
    await AsyncStorage.setItem(KEY, 'not a model');
    await AsyncStorage.setItem(META, JSON.stringify({ ...EMPTY_SYNC_META, accountSeen: true, baseRevision: 4, baseFingerprint: modelFingerprint(good) }));
    seedAccount(good, 4, ME, 'w-mine');
    await open();
    fireEvent.press(screen.getByTestId('lm-start-new'));
    await settle();
    await settle();
    fireEvent.press(screen.getByTestId('lm-conflict-keep-device'));
    await settle();
    await settle();
    const kept = JSON.parse((await AsyncStorage.getItem(KEPT)) as string) as { from: string; model: JobModel };
    expect(kept.from).toBe('account');
    expect(kept.model.rooms.map((r) => r.name)).toEqual(['Kitchen']);
    expect(mockAccount.pushes).toHaveLength(1);
    expect(mockAccount.pushes[0].base).toBe(4);
    expect(accountRooms()).toEqual([]);
  });

  it('11 the model key is lost while the sync notes survive: the account copy is taken, not flattened', async () => {
    const good = modelOf(rect('r1', 'Kitchen'), rect('r2', 'Pantry', 6));
    await AsyncStorage.setItem(META, JSON.stringify({ ...EMPTY_SYNC_META, accountSeen: true, baseRevision: 4, baseFingerprint: modelFingerprint(good) }));
    seedAccount(good, 4, ME, 'w-mine');
    await open();
    expect(mockAccount.pushes).toHaveLength(0);
    expect(accountRooms()).toEqual(['Kitchen', 'Pantry']);
    expect(await deviceRooms()).toEqual(['Kitchen', 'Pantry']);
    expect(screen.queryByTestId('lm-conflict')).toBeNull();
    expect(screen.getByTestId('lm-sync-saved')).toBeTruthy();
  });

  it('12 Use the Kept Model Instead with the app killed between its writes: both models are there at the next open', async () => {
    const onScreen = modelOf(rect('r1', 'Kitchen'));
    const keptModel = modelOf(rect('r9', 'Den'));
    const real = (AsyncStorage.setItem as jest.Mock).getMockImplementation() as (k: string, v: string) => Promise<void>;
    const seed = async () => {
      await AsyncStorage.clear();
      await seedDevice(onScreen, { accountSeen: true, baseRevision: 2, baseFingerprint: modelFingerprint(onScreen) });
      await AsyncStorage.setItem(KEPT, JSON.stringify({ from: 'account', model: keptModel, keptAt: '2026-10-08T00:00:00.000Z' }));
      seedAccount(onScreen, 2, ME, 'w-mine');
    };
    const keptRooms = async (): Promise<string[] | null> => { const raw = await AsyncStorage.getItem(KEPT); return raw ? (JSON.parse(raw) as { model: JobModel }).model.rooms.map((r) => r.name) : null; };
    // A kill is a write that never comes back: the app stops there. `dieOn` names the key whose write is the last thing that happens.
    const killAt = (dieOn: string) => (AsyncStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => (k === dieOn ? new Promise<void>(() => {}) : real(k, v)));
    try {
      // (a) Killed AFTER the model on screen was set aside and BEFORE the kept model took its place.
      await seed();
      await open();
      killAt(KEY);
      fireEvent.press(screen.getByTestId('lm-kept-use'));
      await settle();
      // At this instant the kept key holds the model that was on screen. Without the copy under the third key the Den is nowhere.
      expect(await keptRooms()).toEqual(['Kitchen']);
      expect(await deviceRooms()).toEqual(['Kitchen']);
      expect(await AsyncStorage.getItem(SWAP)).not.toBeNull();
      await cleanupAsync();
      (AsyncStorage.setItem as jest.Mock).mockImplementation(real);
      await open();
      expect(await deviceRooms()).toEqual(['Den']);
      expect(await keptRooms()).toEqual(['Kitchen']);
      expect(await AsyncStorage.getItem(SWAP)).toBeNull();
      expect(screen.getAllByText('Den').length).toBeGreaterThan(0);
      await cleanupAsync();

      // (b) Killed BEFORE anything was replaced (the write that sets the model on screen aside never came back).
      await seed();
      await open();
      killAt(KEPT);
      fireEvent.press(screen.getByTestId('lm-kept-use'));
      await settle();
      await cleanupAsync();
      (AsyncStorage.setItem as jest.Mock).mockImplementation(real);
      await open();
      expect(await deviceRooms()).toEqual(['Kitchen']);
      expect(await keptRooms()).toEqual(['Den']);
      expect(await AsyncStorage.getItem(SWAP)).toBeNull();
      await cleanupAsync();

      // (c) No kill: the two trade places and nothing is left under the third key.
      await seed();
      await open();
      fireEvent.press(screen.getByTestId('lm-kept-use'));
      await settle();
      await settle();
      expect(await deviceRooms()).toEqual(['Den']);
      expect(await keptRooms()).toEqual(['Kitchen']);
      expect(await AsyncStorage.getItem(SWAP)).toBeNull();
    } finally {
      (AsyncStorage.setItem as jest.Mock).mockImplementation(real);
    }
  });

  it('13 a teammate’s save takes this device’s place only after this device’s model is set aside, and the screen says so', async () => {
    const mine = modelOf(rect('r1', 'Kitchen'), rect('r3', 'Den', 6));
    await seedDevice(mine, { accountSeen: true, baseRevision: 2, baseFingerprint: modelFingerprint(mine) });
    // The teammate deleted every room.
    seedAccount(emptyJobModel(PROJECT), 3, TEAMMATE);
    await open();
    expect(screen.queryByTestId('lm-conflict')).toBeNull();
    expect(await deviceRooms()).toEqual([]);
    const kept = JSON.parse((await AsyncStorage.getItem(KEPT)) as string) as { from: string; why?: string; model: JobModel };
    expect(kept.from).toBe('device');
    expect(kept.why).toBe('teammate');
    expect(kept.model.rooms.map((r) => r.name)).toEqual(['Kitchen', 'Den']);
    expect(screen.getByTestId('lm-kept-teammate').props.children).toBe('Your teammate changed this model. Your previous copy is kept.');
    expect(mockAccount.pushes).toHaveLength(0);
    // He can have it back.
    fireEvent.press(screen.getByTestId('lm-kept-use'));
    await settle();
    await settle();
    expect(await deviceRooms()).toEqual(['Kitchen', 'Den']);
  });

  it('14 an account copy larger than the app allows is not opened and the device’s model is not changed', async () => {
    const mine = modelOf(rect('r1', 'Kitchen'));
    await seedDevice(mine, { accountSeen: true, baseRevision: 2, baseFingerprint: modelFingerprint(mine) });
    const big = { version: 1, projectId: PROJECT, links: {}, updatedAt: '', rooms: Array.from({ length: 5000 }, (_, i) => JSON.parse(JSON.stringify(modelForAccount(modelOf(rect(`x${i}`, `Room ${i}`))).rooms[0]))) };
    mockAccount.row = { model: big, revision: 3, last_write_id: 'w-api', schema_version: 1, updated_at: '2026-10-08T15:42:00.000Z', updated_by: TEAMMATE };
    await open();
    expect(screen.getByTestId('lm-sync-account-too-large').props.children).toBe('The model in your account is larger than MAGE ID allows, so it was not opened here. The model on this device has not been changed.');
    expect(await deviceRooms()).toEqual(['Kitchen']);
    expect(await AsyncStorage.getItem(KEPT)).toBeNull();
    expect(mockAccount.pushes).toHaveLength(0);
    expect(screen.queryByTestId('lm-conflict')).toBeNull();
  });

  it('15 this device’s save landed, then a teammate saved on top: the account is ahead, with no question', async () => {
    const base = modelOf(rect('r1', 'Kitchen'));
    const sent = modelOf(rect('r1', 'Kitchen'), rect('r3', 'Den', 6));
    const theirs = modelOf(rect('r1', 'Kitchen'), rect('r3', 'Den', 6), rect('r4', 'Porch', 12));
    await seedDevice(sent, { accountSeen: true, baseRevision: 2, baseFingerprint: modelFingerprint(base), everSent: true, ownWriteIds: ['w-mine'], pending: { writeId: 'w-mine', base: 2, fingerprint: modelFingerprint(sent), scanRoomIds: [] } });
    seedAccount(theirs, 4, TEAMMATE, 'w-theirs');
    (mockAccount.row as Row).recent_writes = [{ w: 'w-mine', r: 3, u: ME }, { w: 'w-theirs', r: 4, u: TEAMMATE }];
    await open();
    expect(screen.queryByTestId('lm-conflict')).toBeNull();
    expect(await deviceRooms()).toEqual(['Kitchen', 'Den', 'Porch']);
    expect(mockAccount.pushes).toHaveLength(0);
    const meta = JSON.parse((await AsyncStorage.getItem(META)) as string) as ModelSyncMeta;
    expect(meta.baseRevision).toBe(4);
    expect(meta.pending).toBeNull();
  });

  it('16 the account copy was removed elsewhere: this device says so and sends nothing until asked', async () => {
    const mine = modelOf(rect('r1', 'Kitchen'));
    await seedDevice(mine, { accountSeen: true, baseRevision: 3, baseFingerprint: modelFingerprint(mine) });
    await open();
    expect(screen.getByText('The copy of this model in your account was removed. It is saved on this device only.')).toBeTruthy();
    expect(mockAccount.pushes).toHaveLength(0);
    await settle();
    expect(mockAccount.pushes).toHaveLength(0);
    expect(await deviceRooms()).toEqual(['Kitchen']);
    fireEvent.press(screen.getByTestId('lm-account-removed-save'));
    await settle();
    await settle();
    expect(mockAccount.pushes).toHaveLength(1);
    expect(mockAccount.pushes[0].base).toBe(0);
    expect(accountRooms()).toEqual(['Kitchen']);
  });

  it('17 a seat that may not change the model is told so, and nothing is sent', async () => {
    await seedDevice(modelOf(rect('r1', 'Kitchen')));
    await open(true);
    expect(screen.getByTestId('lm-sync-view-only').props.children).toBe('You can view this model. Only the owner and editors can change it.');
    expect(screen.queryByTestId('lm-sync-failed')).toBeNull();
    expect(mockAccount.pushes).toHaveLength(0);
  });

  it('18 a read-back that fails after a save went out leaves a true line, not Checking your account', async () => {
    await seedDevice(modelOf(rect('r1', 'Kitchen')));
    // The first read answers (no row); the read-back after the save does not get through.
    mockAccount.failHeadAt = [2];
    await open();
    expect(mockAccount.pushes).toHaveLength(1);
    expect(mockAccount.headReads).toBe(2);
    expect(screen.queryByTestId('lm-sync-checking')).toBeNull();
    expect(screen.queryByTestId('lm-sync-saved')).toBeNull();
    expect(screen.getByTestId('lm-sync-retrying').props.children).toBe('Saved on this device. Your account could not be checked yet. MAGE ID will try again shortly.');
    // The save is still in the notes, so the next look at the account recognises it as landed.
    expect((JSON.parse((await AsyncStorage.getItem(META)) as string) as ModelSyncMeta).pending).not.toBeNull();
    await cleanupAsync();
    await open();
    expect(screen.getByTestId('lm-sync-saved')).toBeTruthy();
    expect(mockAccount.pushes).toHaveLength(1);
  });
});
