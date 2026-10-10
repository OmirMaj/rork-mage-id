/**
 * Smoke — The Living Model, Phase 1 (lane LIVINGMODEL): the entry row
 * (components/livingModel/LivingModelEntryRow), the route (app/living-model)
 * and the screen (components/livingModel/LivingModelScreen) AS THE PHONE
 * RENDERS THEM. jest resolves the phone files, so the 3D view here is
 * components/livingModel/JobReplay3D.tsx. jest has no native modules, which is
 * exactly a build with no 3D engine (build 22 and earlier): the phone file
 * draws the flat replay with one quiet line, and the 3D library is never
 * loaded in this suite. Tests 11 and 12 check that. The phone's 3D view itself
 * was proven in the iOS Simulator (docs/phone-3d-build-notes.md).
 *
 * Fixtures only, no network: the project context is a fixture; the device
 * store is the real utils/livingModel/store over jest's AsyncStorage mock.
 * The pure rules (the job model, the stage table, planned and reported, the
 * links, the 3D shapes as numbers) run under bun with planted mutations in
 * scripts/validate-living-model.ts; this file proves what the SCREENS do.
 *
 * THE FLAG is NOT mocked: constants/featureFlags.ts LIVING_MODEL_ENABLED is
 * false, as shipped.
 *
 *   1  the flag is off
 *   2  not the owner: no row, the route redirects, no saved model is read
 *   3  signed out: no row, and the route redirects
 *   4  the owner: one row, named "Living Model (Owner Preview)"; a tap goes to the route
 *   5  the owner's account on a viewer seat: the route says why and draws no model
 *   6  a seat that could not be read says so and offers another try
 *   7  the editor: add a room from typed sizes, add a door on a wall, undo, undo, redo
 *   8  a size that cannot be read is refused with a sentence, and nothing is added
 *   9  the model is saved on the device, under this person and this project, and the screen says "this device only"
 *  10  a suggestion is shown and NOT applied: the room stays unticked and uncoloured until Confirm Suggested
 *  11  a build with no 3D engine says "3D needs the newest version of the app.", draws the flat replay, and carries both honesty lines
 *  12  the phone file for the 3D view draws the flat replay on such a build, and the 3D library was never loaded
 *  13  Reported never shows the plan: a task with nothing reported reads "No Progress Reported"
 *
 * Added after the review:
 *  14  a refresh: while the saved sign-in is still being read the route waits; it does not redirect and reads nothing
 *  15  a saved model that cannot be read (a null wall): the screen says so, draws no editor, and saves over nothing
 *  16  Start a New Model keeps the unread text under the backup key, and only then does an edit save
 *  17  the Suggested box lists every task it will tick, by name, and Confirm ticks exactly those
 *  18  a task's stage can be picked on the Tasks tab, is kept with the ticks, and can go back to the title
 *  19  the room card follows the scrubber: as of today, an earlier week, and the plan only past today
 *  20  the card says what its number is: a plain average, with unreported tasks counted as 0
 *  21  with no start date the notice says what Reported shows, and its button opens the schedule
 *  22  THE WEB VIEW (its file named on purpose, the scene builder and the library faked): a theme change makes a new
 *      scene on a new canvas, and the rooms are drawn into it again
 *  23  the web view: a lost context is said with a Reload View button, which makes a new scene
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanupAsync, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

let mockThemeName: 'light' | 'dark' = 'light';
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const make = (name: 'light' | 'dark') => ({ colors: { ...actual.Theme[name], ...actual.deriveAccentPalette(actual.getCustomPrimary(), name) }, resolved: name, pref: name, setPref: () => {} });
  const values = { light: make('light'), dark: make('dark') };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => values[mockThemeName] };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useRouter: () => ({ push: mockPush, back: () => {}, replace: () => {} }),
    useLocalSearchParams: () => ({ projectId: 'p1' }),
    Redirect: ({ href }: { href: string }) => R.createElement('Redirect', { href, testID: 'redirect' }),
    Stack: { Screen: () => null },
  };
});

// jest stands in for a build with NO 3D engine (build 22 and earlier): the one optional lookup of expo-gl's native
// module answers null, as it does on those phones. __tests__/smoke/phone-3d.test.tsx runs the builds that have it.
jest.mock('expo', () => {
  const actual = jest.requireActual('expo');
  return { ...actual, requireOptionalNativeModule: (name: string) => (name === 'ExponentGLObjectManager' ? null : actual.requireOptionalNativeModule(name)) };
});

// The 3D library must never be asked for on a build with no 3D engine. If anything here loads it, this flag flips.
let mockThreeLoaded = false;
jest.mock('three', () => { mockThreeLoaded = true; return {}; });

// The scene builder, faked for tests 22 and 23 (no WebGL here). Each scene made is kept, with what was drawn into it.
interface MockScene { ground: string; realistic: boolean; rooms: number; setRoomsCalls: number; applyCalls: number; disposed: boolean; canvas: unknown }
const mockScenes: MockScene[] = [];
jest.mock('@/components/livingModel/threeScene', () => ({
  DEFAULT_VIEW: { azimuth: 0.72, elevation: 0.9 },
  createJobScene: (_three: unknown, canvas: unknown, palette: { ground: string; finish?: unknown }) => {
    const rec: MockScene = { ground: palette.ground, realistic: palette.finish != null, rooms: 0, setRoomsCalls: 0, applyCalls: 0, disposed: false, canvas };
    mockScenes.push(rec);
    return {
      setRooms: (list: unknown[]) => { rec.rooms = list.length; rec.setRoomsCalls += 1; },
      apply: () => { rec.applyCalls += 1; },
      resize: () => {}, render: () => {}, orbit: () => {}, pan: () => {}, zoomBy: () => {}, turnBy: () => {}, resetView: () => {},
      pick: () => null, project: () => ({ x: 10, y: 10 }), roomWidthPx: () => 200, floorHex: () => null, roomCount: () => rec.rooms,
      dispose: () => { rec.disposed = true; rec.rooms = 0; },
    };
  },
}));

const OWNER = 'omirmajeed2000@gmail.com';
let mockUser: { id: string; email: string } | null = { id: 'user-1', email: 'someone@example.com' };
let mockAuthLoading = false;
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockAuthLoading ? null : mockUser, isLoading: mockAuthLoading }) }));

let mockRole: string | null = 'owner';
let mockRoleError = false;
const mockRefetch = jest.fn();
jest.mock('@/hooks/useProjectRole', () => ({
  useProjectRole: () => mockRole,
  useProjectRoleState: () => ({ role: mockRoleError ? null : mockRole, isLoading: false, isError: mockRoleError, refetch: mockRefetch }),
}));

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const task = (id: string, title: string, startDay: number, durationDays: number, progress: number, status: string) =>
  ({ id, title, phase: 'Build', startDay, durationDays, progress, status, crew: '', dependencies: [], notes: '' });
const mockSchedule = {
  id: 's1', name: 'Plan', projectId: 'p1', startDate: iso(daysAgo(21)), workingDaysPerWeek: 5, bufferDays: 0,
  totalDurationDays: 40, criticalPathDays: 40, laborAlignmentScore: 0, riskItems: [],
  tasks: [
    task('t-demo', 'Demo kitchen', 1, 5, 100, 'done'),
    task('t-plumb', 'Rough plumbing', 6, 5, 0, 'not_started'),
    task('t-cab', 'Kitchen cabinets', 30, 5, 0, 'not_started'),
    task('t-roof', 'Roof repair', 11, 5, 0, 'not_started'),
  ],
};
const START = mockSchedule.startDate;
const mockProject = { id: 'p1', name: 'Maple Street', schedule: mockSchedule };
const mockReports = [{ id: 'r1', projectId: 'p1', date: iso(daysAgo(14)), workProgress: [{ taskId: 't-demo', taskName: 'Demo kitchen', phase: 'Build', pct: 100 }] }];
// Lane LIVINGSYNC: the screen names who last saved the account's copy from the project's collaborator list. No network here.
jest.mock('@/hooks/useProjectCollaborators', () => ({ useProjectCollaborators: () => ({ collaborators: [] }) }));
jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({ getProject: () => mockProject, getDailyReportsForProject: () => mockReports }),
}));

import LivingModelRoute from '@/app/living-model';
import { JOB_REPLAY_3D_ON_THIS_PLATFORM, JobReplay3D } from '@/components/livingModel/JobReplay3D';
import { LivingModelEntryRow } from '@/components/livingModel/LivingModelEntryRow';
import { LIVING_MODEL_ENABLED } from '@/constants/featureFlags';
import { JobReplay3D as WebJobReplay3D } from '@/components/livingModel/JobReplay3D.web';
import { threeRoomJob } from '@/__tests__/fixtures/livingModelJobs';
import type { RoomMoment } from '@/utils/livingModel/replayCore';
import { LIVING_MODEL_KEY_PREFIX, livingModelBackupKey, livingModelKey } from '@/utils/livingModel/storeCore';
import { Platform } from 'react-native';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Wrap = ({ children }: { children: React.ReactNode }) => <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
const settle = async () => { await act(async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); }); };
const SCHEMATIC = 'Schematic made from typed and scanned sizes. Not to scale for building.';
const PROGRESS = 'Progress shown is what was reported in MAGE ID.';

async function openAsOwner() {
  mockUser = { id: 'user-1', email: OWNER };
  render(<Wrap><LivingModelRoute /></Wrap>);
  await settle();
  // The plan is drawn once its box has a width.
  fireEvent(screen.getByTestId('lm-plan-box'), 'layout', { nativeEvent: { layout: { width: 358, height: 300, x: 0, y: 0 } } });
}

async function addKitchen() {
  fireEvent.press(screen.getByTestId('lm-add-room'));
  fireEvent.changeText(screen.getByTestId('lm-room-name'), 'Kitchen');
  fireEvent.press(screen.getByTestId('lm-kind-kitchen'));
  fireEvent.changeText(screen.getByTestId('lm-room-width'), '12');
  fireEvent.changeText(screen.getByTestId('lm-room-length'), '10 ft 6 in');
  fireEvent.changeText(screen.getByTestId('lm-room-height'), '8');
  fireEvent.press(screen.getByTestId('lm-add-room-save'));
  await settle();
}

const TABS: Record<string, string> = { Rooms: 'living-model-tabs-rooms', Tasks: 'living-model-tabs-tasks', 'Job Replay': 'living-model-tabs-replay', Planned: 'lm-mode-planned' };
const tab = (label: string) => fireEvent.press(screen.getByTestId(TABS[label]));

beforeEach(async () => {
  mockPush.mockClear();
  mockRefetch.mockClear();
  mockUser = { id: 'user-1', email: 'someone@example.com' };
  mockRole = 'owner';
  mockRoleError = false;
  mockAuthLoading = false;
  mockThemeName = 'light';
  mockScenes.length = 0;
  (mockSchedule as { startDate?: string }).startDate = START;
  await AsyncStorage.clear();
  (AsyncStorage.getItem as jest.Mock).mockClear();
  (AsyncStorage.setItem as jest.Mock).mockClear();
});

afterEach(async () => { await cleanupAsync(); });

describe('the gate, as shipped', () => {
  it('1  the flag is off', () => {
    expect(LIVING_MODEL_ENABLED).toBe(false);
  });

  it('2  not the owner: no row, the route redirects, and no saved model is read', async () => {
    render(<Wrap><LivingModelEntryRow projectId="p1" /><LivingModelRoute /></Wrap>);
    await settle();
    expect(screen.queryByTestId('living-model-entry-row')).toBeNull();
    expect(screen.getByTestId('redirect').props.href).toBe('/(tabs)/(home)');
    expect(screen.queryByTestId('living-model-screen')).toBeNull();
    const read = (AsyncStorage.getItem as jest.Mock).mock.calls.filter((c) => String(c[0]).startsWith(LIVING_MODEL_KEY_PREFIX));
    expect(read).toHaveLength(0);
  });

  it('3  signed out: no row, and the route redirects', () => {
    mockUser = null;
    render(<Wrap><LivingModelEntryRow projectId="p1" /><LivingModelRoute /></Wrap>);
    expect(screen.queryByTestId('living-model-entry-row')).toBeNull();
    expect(screen.getByTestId('redirect')).toBeTruthy();
  });

  it('4  the owner: one row named Living Model (Owner Preview), and a tap goes to the route', () => {
    mockUser = { id: 'user-1', email: OWNER };
    render(<Wrap><LivingModelEntryRow projectId="p1" /></Wrap>);
    expect(screen.getByText('Living Model (Owner Preview)')).toBeTruthy();
    fireEvent.press(screen.getByTestId('living-model-entry-row'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/living-model', params: { projectId: 'p1' } });
  });

  it('5  the owner account on a viewer seat: the route says why and draws no model', async () => {
    mockUser = { id: 'user-1', email: OWNER };
    mockRole = 'viewer';
    render(<Wrap><LivingModelRoute /></Wrap>);
    await settle();
    expect(screen.getByTestId('living-model-seat-refused')).toBeTruthy();
    expect(screen.getByText(/Only the project owner or an editor can open it/)).toBeTruthy();
    expect(screen.queryByTestId('living-model-screen')).toBeNull();
  });

  it('6  a seat that could not be read says so and offers another try', async () => {
    mockUser = { id: 'user-1', email: OWNER };
    mockRoleError = true;
    render(<Wrap><LivingModelRoute /></Wrap>);
    await settle();
    expect(screen.getByTestId('living-model-seat-unknown')).toBeTruthy();
    fireEvent.press(screen.getByTestId('living-model-seat-retry'));
    expect(mockRefetch).toHaveBeenCalled();
  });
});

describe('the Room Editor', () => {
  it('7  add a room from typed sizes, add a door on a wall, undo, undo, redo', async () => {
    await openAsOwner();
    expect(screen.getByText('No Rooms Yet')).toBeTruthy();
    await addKitchen();
    expect(screen.getByTestId('lm-selected')).toBeTruthy();
    expect(screen.getAllByText(/12 ft 0 in by 10 ft 6 in, about 126.0 sq ft/).length).toBeGreaterThan(0);

    fireEvent.press(screen.getByTestId('lm-add-door-0'));
    fireEvent.changeText(screen.getByTestId('lm-opening-width'), '2 ft 8 in');
    fireEvent.press(screen.getByTestId('lm-opening-save'));
    await settle();
    expect(screen.getByText('Door, 2 ft 8 in')).toBeTruthy();

    fireEvent.press(screen.getByTestId('lm-undo'));
    await settle();
    expect(screen.queryByText('Door, 2 ft 8 in')).toBeNull();
    expect(screen.getByTestId('lm-room-row-0')).toBeTruthy();

    fireEvent.press(screen.getByTestId('lm-undo'));
    await settle();
    expect(screen.queryByTestId('lm-room-row-0')).toBeNull();
    expect(screen.getByText('No Rooms Yet')).toBeTruthy();

    fireEvent.press(screen.getByTestId('lm-redo'));
    await settle();
    expect(screen.getByTestId('lm-room-row-0')).toBeTruthy();
    expect(screen.queryByText('Door, 2 ft 8 in')).toBeNull();
  });

  it('8  a size that cannot be read is refused with a sentence, and nothing is added', async () => {
    await openAsOwner();
    fireEvent.press(screen.getByTestId('lm-add-room'));
    fireEvent.changeText(screen.getByTestId('lm-room-name'), 'Den');
    fireEvent.changeText(screen.getByTestId('lm-room-width'), 'wide');
    fireEvent.changeText(screen.getByTestId('lm-room-length'), '10');
    fireEvent.changeText(screen.getByTestId('lm-room-height'), '8');
    fireEvent.press(screen.getByTestId('lm-add-room-save'));
    await settle();
    expect(screen.getByTestId('lm-room-problem')).toBeTruthy();
    expect(screen.queryByTestId('lm-room-row-0')).toBeNull();
    // A ceiling of 2 ft reads, and is refused as a ceiling.
    fireEvent.changeText(screen.getByTestId('lm-room-width'), '12');
    fireEvent.changeText(screen.getByTestId('lm-room-height'), '2');
    fireEvent.press(screen.getByTestId('lm-add-room-save'));
    await settle();
    expect(screen.getByText(/ceiling height between 4 ft and 40 ft/)).toBeTruthy();
    expect(screen.queryByTestId('lm-room-row-0')).toBeNull();
  });

  it('9  the model is saved on this device, under this person and this project, and the screen says so', async () => {
    await openAsOwner();
    await addKitchen();
    expect(screen.getByText('Saved on this device only for now. It will not appear on your other devices.')).toBeTruthy();
    const key = livingModelKey('user-1', 'p1') as string;
    expect(key.startsWith('mageid_')).toBe(true);
    const saved = JSON.parse((await AsyncStorage.getItem(key)) as string);
    expect(saved.projectId).toBe('p1');
    expect(saved.rooms).toHaveLength(1);
    expect(saved.rooms[0].name).toBe('Kitchen');
    expect(saved.links).toEqual({});
  });
});

describe('rooms and the schedule', () => {
  it('10 a suggestion is shown and not applied until Confirm Suggested', async () => {
    await openAsOwner();
    await addKitchen();
    tab('Tasks');
    await settle();
    // Three of the four tasks look like kitchen work; none is ticked.
    expect(screen.getByTestId('lm-suggestions')).toBeTruthy();
    expect(screen.getByText(/3 tasks look like they belong in this room. Nothing is ticked until you confirm them./)).toBeTruthy();
    expect(screen.getByTestId('lm-links-count').props.children).toBe('0 of 4 tasks ticked');
    const key = livingModelKey('user-1', 'p1') as string;
    expect(JSON.parse((await AsyncStorage.getItem(key)) as string).links).toEqual({});

    // The replay does not colour the room from a suggestion.
    tab('Job Replay');
    await settle();
    expect(screen.getByTestId('lm-nothing-ticked')).toBeTruthy();
    expect(screen.getAllByText('No Tasks Ticked').length).toBeGreaterThan(0);

    tab('Tasks');
    await settle();
    fireEvent.press(screen.getByTestId('lm-confirm-suggested'));
    await settle();
    expect(screen.getByTestId('lm-links-count').props.children).toBe('3 of 4 tasks ticked');
    expect(screen.queryByTestId('lm-suggestions')).toBeNull();
    const links = JSON.parse((await AsyncStorage.getItem(key)) as string).links as Record<string, string[]>;
    expect(Object.values(links)[0].slice().sort()).toEqual(['t-cab', 't-demo', 't-plumb']);
  });
});

describe('Job Replay on the phone', () => {
  async function replayWithTicks() {
    await openAsOwner();
    await addKitchen();
    tab('Tasks');
    await settle();
    fireEvent.press(screen.getByTestId('lm-confirm-suggested'));
    await settle();
    tab('Job Replay');
    await settle();
    fireEvent(screen.getByTestId('lm-flat-replay'), 'layout', { nativeEvent: { layout: { width: 358, height: 300, x: 0, y: 0 } } });
  }

  it('11 a build with no 3D engine says so in one line, draws the flat replay, and carries both honesty lines', async () => {
    await replayWithTicks();
    expect(screen.getByTestId('lm-phone-no-engine')).toBeTruthy();
    expect(screen.getByText('3D needs the newest version of the app.')).toBeTruthy();
    expect(screen.queryByTestId('lm-phone-3d-failed')).toBeNull();
    // One message, once; nothing that belongs to a 3D picture; the honesty lines once, as the flat view's.
    expect(screen.getAllByText('3D needs the newest version of the app.')).toHaveLength(1);
    expect(screen.queryByTestId('lm-3d-hint')).toBeNull();
    expect(screen.queryByTestId('lm-3d-quality')).toBeNull();
    // The look switch belongs to a 3D picture: it is not drawn over the flat replay.
    expect(screen.queryByTestId('lm-look')).toBeNull();
    expect(screen.queryByTestId('lm-no-webgl')).toBeNull();
    expect(screen.queryByTestId('lm-phone-note')).toBeNull();
    expect(screen.getByTestId('lm-honesty-flat')).toBeTruthy();
    expect(screen.queryByTestId('lm-honesty-3d')).toBeNull();
    expect(screen.getAllByText(SCHEMATIC)).toHaveLength(1);
    expect(screen.getByTestId('lm-flat-plan')).toBeTruthy();
    expect(screen.queryByTestId('lm-replay-3d')).toBeNull();
    expect(screen.getByText(SCHEMATIC)).toBeTruthy();
    expect(screen.getByText(new RegExp(PROGRESS.replace(/\./g, '\\.')))).toBeTruthy();
    expect(screen.getByTestId('lm-play')).toBeTruthy();
    // The editor carries them too.
    tab('Rooms');
    await settle();
    expect(screen.getByText(SCHEMATIC)).toBeTruthy();
    expect(screen.getByText(PROGRESS)).toBeTruthy();
  });

  it('12 the phone file for the 3D view draws the flat replay on a build with no engine, and the 3D library was never loaded', async () => {
    expect(JOB_REPLAY_3D_ON_THIS_PLATFORM).toBe(true);
    const onUnavailable = jest.fn();
    render(<JobReplay3D model={{ version: 1, projectId: 'p1', rooms: [], links: {}, updatedAt: '' }} level={0} moments={new Map()} selectedId={null} onSelect={() => {}} onUnavailable={onUnavailable} weekLine="" atToday={false} height={10} compact />);
    await settle();
    expect(screen.getByTestId('lm-phone-no-engine')).toBeTruthy();
    expect(screen.getByTestId('lm-flat-replay')).toBeTruthy();
    expect(screen.queryByTestId('lm-replay-3d')).toBeNull();
    expect(screen.queryByTestId('lm-replay-3d-loading')).toBeNull();
    // The screen is never told "3D is unavailable": that would add the browser's sentence above the flat replay.
    expect(onUnavailable).not.toHaveBeenCalled();
    expect(mockThreeLoaded).toBe(false);
  });

  it('13 Reported never shows the plan: a task with nothing reported reads No Progress Reported', async () => {
    await replayWithTicks();
    // The room added in the editor is still the selected one, so its card is open; a tap on its row closes it and a second opens it again.
    expect(screen.getByTestId('lm-room-card')).toBeTruthy();
    fireEvent.press(screen.getByTestId('lm-replay-room-0'));
    await settle();
    expect(screen.queryByTestId('lm-room-card')).toBeNull();
    fireEvent.press(screen.getByTestId('lm-replay-room-0'));
    await settle();
    expect(screen.getByTestId('lm-room-card')).toBeTruthy();
    // Demo was reported finished. Rough plumbing was planned to be finished two weeks ago and nothing was reported.
    expect(screen.getByText('Reported 100 percent')).toBeTruthy();
    expect(screen.getAllByText('No Progress Reported')).toHaveLength(2);
    expect(screen.queryByText(/Reported [1-9][0-9]? percent/)).toBeNull();
    expect(screen.getByText('2 ticked tasks have no progress reported.')).toBeTruthy();
    // One of three ticked tasks is reported finished: 33, not the plan's 67.
    expect(screen.getByText('33%')).toBeTruthy();
    // Planned is the other reading, and says so.
    tab('Planned');
    await settle();
    expect(screen.getByText('Planned in This Room')).toBeTruthy();
    expect(screen.getByText('67%')).toBeTruthy();
  });
});

describe('after the review', () => {
  const key = () => livingModelKey('user-1', 'p1') as string;
  const backupKey = () => livingModelBackupKey('user-1', 'p1') as string;

  it('14 a refresh: while the saved sign-in is still being read the route waits, does not redirect, and reads nothing', async () => {
    mockUser = { id: 'user-1', email: OWNER };
    mockAuthLoading = true;
    const view = render(<Wrap><LivingModelRoute /></Wrap>);
    await settle();
    expect(screen.getByTestId('living-model-auth-settling')).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(screen.queryByTestId('living-model-screen')).toBeNull();
    expect((AsyncStorage.getItem as jest.Mock).mock.calls.filter((c) => String(c[0]).startsWith(LIVING_MODEL_KEY_PREFIX))).toHaveLength(0);
    // The sign-in is read back: the owner stays on the page.
    mockAuthLoading = false;
    view.rerender(<Wrap><LivingModelRoute /></Wrap>);
    await settle();
    expect(screen.queryByTestId('redirect')).toBeNull();
    expect(screen.getByTestId('living-model-screen')).toBeTruthy();
  });

  /** A saved model with a hole in it: the first room's walls are [null]. */
  async function saveBrokenModel(): Promise<string> {
    const good = { version: 1, projectId: 'p1', rooms: threeRoomJob().rooms, links: { kitchen: ['t-demo'] }, updatedAt: '2026-10-01T00:00:00.000Z' };
    const text = JSON.stringify({ ...good, rooms: good.rooms.map((r, i) => (i === 0 ? { ...r, room: { ...r.room, walls: [null] } } : r)) });
    await AsyncStorage.setItem(key(), text);
    (AsyncStorage.setItem as jest.Mock).mockClear();
    return text;
  }

  it('15 a saved model that cannot be read: the screen says so, draws no editor, and saves over nothing', async () => {
    const text = await saveBrokenModel();
    mockUser = { id: 'user-1', email: OWNER };
    render(<Wrap><LivingModelRoute /></Wrap>);
    await settle();
    expect(screen.getByTestId('lm-unreadable')).toBeTruthy();
    expect(screen.getByText('The model saved on this device could not be read.')).toBeTruthy();
    expect(screen.getByText(/Nothing is saved over the old one until you do\./)).toBeTruthy();
    expect(screen.getByText('Start a New Model')).toBeTruthy();
    expect(screen.queryByTestId('lm-plan-box')).toBeNull();
    expect(screen.queryByTestId('lm-add-room')).toBeNull();
    // Every tab is the same: nothing to edit until he chooses.
    tab('Tasks');
    await settle();
    expect(screen.queryByTestId('living-model-links')).toBeNull();
    tab('Job Replay');
    await settle();
    expect(screen.queryByTestId('living-model-replay')).toBeNull();
    // The stored text is as it was, and a copy sits under the backup key.
    expect(await AsyncStorage.getItem(key())).toBe(text);
    expect(await AsyncStorage.getItem(backupKey())).toBe(text);
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.filter((c) => c[0] === key())).toHaveLength(0);
  });

  it('16 Start a New Model keeps the unread text under the backup key, and only then does an edit save', async () => {
    const text = await saveBrokenModel();
    mockUser = { id: 'user-1', email: OWNER };
    render(<Wrap><LivingModelRoute /></Wrap>);
    await settle();
    fireEvent.press(screen.getByTestId('lm-start-new'));
    await settle();
    expect(screen.queryByTestId('lm-unreadable')).toBeNull();
    expect(screen.getByTestId('lm-started-new')).toBeTruthy();
    // Choosing is not saving: the old text is still under the model key until the first edit.
    expect(await AsyncStorage.getItem(key())).toBe(text);
    fireEvent(screen.getByTestId('lm-plan-box'), 'layout', { nativeEvent: { layout: { width: 358, height: 300, x: 0, y: 0 } } });
    await addKitchen();
    const saved = JSON.parse((await AsyncStorage.getItem(key())) as string);
    expect(saved.rooms).toHaveLength(1);
    expect(saved.rooms[0].name).toBe('Kitchen');
    expect(await AsyncStorage.getItem(backupKey())).toBe(text);
    expect(screen.queryByTestId('lm-save-failed')).toBeNull();
  });

  it('17 the Suggested box lists every task it will tick, by name, and Confirm ticks exactly those', async () => {
    await openAsOwner();
    await addKitchen();
    tab('Tasks');
    await settle();
    const listed = [0, 1, 2].map((i) => screen.getByTestId(`lm-suggestion-${i}`).props.children as string);
    expect(listed.slice().sort()).toEqual(['Demo kitchen', 'Kitchen cabinets', 'Rough plumbing']);
    expect(screen.queryByTestId('lm-suggestion-3')).toBeNull();
    fireEvent.press(screen.getByTestId('lm-confirm-suggested'));
    await settle();
    const links = JSON.parse((await AsyncStorage.getItem(key())) as string).links as Record<string, string[]>;
    const titles: Record<string, string> = { 't-demo': 'Demo kitchen', 't-plumb': 'Rough plumbing', 't-cab': 'Kitchen cabinets', 't-roof': 'Roof repair' };
    expect(Object.values(links)[0].map((id) => titles[id]).sort()).toEqual(listed.slice().sort());
  });

  it('18 a task\'s stage can be picked on the Tasks tab, is kept with the ticks, and can go back to the title', async () => {
    await openAsOwner();
    await addKitchen();
    tab('Tasks');
    await settle();
    // Rough plumbing reads as Rough-In from its name.
    expect(screen.getByTestId('lm-stage-1')).toBeTruthy();
    expect(screen.queryByTestId('lm-stage-picker-1')).toBeNull();
    fireEvent.press(screen.getByTestId('lm-stage-1'));
    await settle();
    expect(screen.getByTestId('lm-stage-picker-1')).toBeTruthy();
    fireEvent.press(screen.getByTestId('lm-stage-1-finishes'));
    await settle();
    expect(screen.getByText('Finishes, picked by you')).toBeTruthy();
    expect(JSON.parse((await AsyncStorage.getItem(key())) as string).stages).toEqual({ 't-plumb': 'finishes' });
    expect(JSON.parse((await AsyncStorage.getItem(key())) as string).links).toEqual({});
    // And back.
    fireEvent.press(screen.getByTestId('lm-stage-1'));
    await settle();
    fireEvent.press(screen.getByTestId('lm-stage-1-title'));
    await settle();
    expect(screen.queryByText('Finishes, picked by you')).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(key())) as string).stages).toBeUndefined();
  });

  async function replayWithCard() {
    await openAsOwner();
    await addKitchen();
    tab('Tasks');
    await settle();
    fireEvent.press(screen.getByTestId('lm-confirm-suggested'));
    await settle();
    tab('Job Replay');
    await settle();
  }
  const press = async (id: string, times = 1) => { for (let i = 0; i < times; i++) { fireEvent.press(screen.getByTestId(id)); await settle(); } };

  it('19 the room card follows the scrubber: as of today, an earlier week, and the plan only past today', async () => {
    await replayWithCard();
    // Today is the 16th working day. Demo was reported finished on day 6.
    expect(screen.getByTestId('lm-card-when').props.children).toBe('As of today');
    expect(screen.getByTestId('lm-card-pct').props.children).toBe('33%');
    expect(screen.queryByTestId('lm-card-plan-only')).toBeNull();
    // Back to the end of week 1 (day 5): nothing had been reported yet, so the card does not show today's 33.
    await press('lm-prev-week', 3);
    expect(screen.getByTestId('lm-card-when').props.children).toBe('For week 1 of 7');
    expect(screen.getByTestId('lm-card-pct').props.children).toBe('0%');
    expect(screen.getAllByText('No Progress Reported')).toHaveLength(3);
    expect(screen.getByText('3 ticked tasks have no progress reported.')).toBeTruthy();
    // The end of week 2 (day 10): the daily report of day 6 counts now.
    await press('lm-next-week');
    expect(screen.getByTestId('lm-card-when').props.children).toBe('For week 2 of 7');
    expect(screen.getByTestId('lm-card-pct').props.children).toBe('33%');
    // Week 4 ends on day 20, past today: the plan only, and the card says so.
    await press('lm-next-week', 2);
    expect(screen.getByTestId('lm-card-when').props.children).toBe('For week 4 of 7');
    expect(screen.getByTestId('lm-card-plan-only').props.children).toBe('This week is past today, so the card shows the plan only.');
    expect(screen.getByText('Planned by This Week')).toBeTruthy();
    expect(screen.getByTestId('lm-card-pct').props.children).toBe('67%');
    expect(screen.queryByText('Reported in This Room')).toBeNull();
    expect(screen.queryByText(/have no progress reported/)).toBeNull();
    expect(screen.getAllByText('Planned 100 percent')).toHaveLength(2);
    // Today again.
    await press('lm-today');
    expect(screen.getByTestId('lm-card-when').props.children).toBe('As of today');
    expect(screen.getByTestId('lm-card-pct').props.children).toBe('33%');
  });

  it('20 the card says what its number is: a plain average, with unreported tasks counted as 0', async () => {
    await replayWithCard();
    expect(screen.getByTestId('lm-card-average').props.children).toBe('Average of the 3 ticked tasks. A task with nothing reported counts as 0.');
    tab('Planned');
    await settle();
    expect(screen.getByTestId('lm-card-average').props.children).toBe('Average of the 3 ticked tasks, each by its planned dates.');
  });

  it('21 with no start date the notice says what Reported shows, and its button opens the schedule', async () => {
    (mockSchedule as { startDate?: string }).startDate = undefined;
    await replayWithCard();
    expect(screen.getByText('Daily reports cannot be placed without a start date. Reported shows only the schedule’s own progress.')).toBeTruthy();
    expect(screen.queryByText(/All of it shows as the plan/)).toBeNull();
    // Demo is 100 in the schedule's own field, and that is what Reported shows: one of three.
    expect(screen.getByTestId('lm-card-pct').props.children).toBe('33%');
    expect(screen.getByTestId('lm-card-when').props.children).toBe('From the schedule’s own progress, which carries no date');
    fireEvent.press(screen.getByTestId('lm-set-start'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/schedule-pro', params: { projectId: 'p1' } });
  });
});

describe('the web view, with the scene builder and the library faked', () => {
  const realOS = Platform.OS;
  beforeAll(() => { (Platform as { OS: string }).OS = 'web'; });
  afterAll(() => { (Platform as { OS: string }).OS = realOS; });

  const mockUnavailable = jest.fn();
  // jest cannot run the view's dynamic import, so the view is handed a stand-in for the library (the scene builder is faked too).
  const mockLibrary = () => Promise.resolve({} as typeof import('three'));
  const model = threeRoomJob();
  const moment = (stage: RoomMoment['stage']): RoomMoment => {
    const none = { demolition: null, framing: null, rough_in: null, insulation: null, drywall: null, finishes: null, other: null };
    return { stage, solid: none, ghost: none, overall: 0, ghostStage: null, unreported: 0, taskCount: 0 };
  };
  const moments = new Map(model.rooms.map((r) => [r.id, moment('not_started')]));
  const listeners = new Map<object, Map<string, (e: unknown) => void>>();
  // The test renderer has no DOM: a canvas and a label are stand-ins that take what the view asks of them.
  const createNodeMock = (el: React.ReactElement) => {
    const node = {
      type: el.type, style: {} as Record<string, string>, children: [] as unknown[],
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 500 }),
      addEventListener: (name: string, fn: (e: unknown) => void) => { const m = listeners.get(node) ?? new Map(); m.set(name, fn); listeners.set(node, m); },
      removeEventListener: (name: string) => { listeners.get(node)?.delete(name); },
      setPointerCapture: () => {},
    };
    return node;
  };
  const view = () => <Wrap><WebJobReplay3D model={model} level={0} moments={moments} selectedId={null} onSelect={() => {}} onUnavailable={mockUnavailable} weekLine="Week 1 of 3" atToday={false} height={400} compact={false} loadLibrary={mockLibrary} /></Wrap>;

  it('22 a theme change makes a new scene on a new canvas, and the rooms are drawn into it again', async () => {
    const r = render(view(), { createNodeMock });
    await settle();
    expect(mockScenes).toHaveLength(1);
    expect(mockScenes[0].rooms).toBe(3);
    expect(mockScenes[0].applyCalls).toBeGreaterThan(0);
    expect(screen.getByTestId('lm-pin-kitchen')).toBeTruthy();

    mockThemeName = 'dark';
    r.rerender(view());
    await settle();
    expect(mockScenes).toHaveLength(2);
    expect(mockScenes[0].disposed).toBe(true);
    expect(mockScenes[1].ground).not.toBe(mockScenes[0].ground);
    expect(mockScenes[1].canvas).not.toBe(mockScenes[0].canvas);
    // The point of the test: the new scene is not left empty.
    expect(mockScenes[1].rooms).toBe(3);
    expect(mockScenes[1].setRoomsCalls).toBeGreaterThan(0);
    expect(mockScenes[1].applyCalls).toBeGreaterThan(0);
    expect(screen.getByTestId('lm-pin-kitchen')).toBeTruthy();
  });

  it('23 a lost context is said with a Reload View button, which makes a new scene', async () => {
    render(view(), { createNodeMock });
    await settle();
    expect(mockScenes).toHaveLength(1);
    const lost = listeners.get(mockScenes[0].canvas as object)?.get('webglcontextlost');
    expect(lost).toBeTruthy();
    await act(async () => { lost?.({ preventDefault: () => {} }); });
    expect(screen.getByTestId('lm-3d-lost')).toBeTruthy();
    expect(screen.getByText('The 3D view stopped because the browser took back its graphics memory. Reload the view to draw it again.')).toBeTruthy();
    expect(screen.queryByTestId('lm-pin-kitchen')).toBeNull();
    fireEvent.press(screen.getByTestId('lm-reload-view'));
    await settle();
    expect(screen.queryByTestId('lm-3d-lost')).toBeNull();
    expect(mockScenes).toHaveLength(2);
    expect(mockScenes[0].disposed).toBe(true);
    expect(mockScenes[1].rooms).toBe(3);
    expect(mockUnavailable).not.toHaveBeenCalled();
  });

  it('24 a new look makes a new scene on a new canvas: Game Style when none is given, Realistic when it is chosen, and the old scene is let go', async () => {
    const withLook = (look?: 'realistic' | 'game') => <Wrap><WebJobReplay3D model={model} level={0} moments={moments} selectedId={null} onSelect={() => {}} onUnavailable={mockUnavailable} weekLine="Week 1 of 3" atToday={false} height={400} compact={false} look={look} loadLibrary={mockLibrary} /></Wrap>;
    const r = render(withLook(), { createNodeMock });
    await settle();
    expect(mockScenes).toHaveLength(1);
    // No look given: the palette carries no finish, so the scene builder draws what it always drew.
    expect(mockScenes[0].realistic).toBe(false);

    r.rerender(withLook('realistic'));
    await settle();
    expect(mockScenes).toHaveLength(2);
    expect(mockScenes[0].disposed).toBe(true);
    expect(mockScenes[1].realistic).toBe(true);
    expect(mockScenes[1].canvas).not.toBe(mockScenes[0].canvas);
    // The page's colour is the theme's in both looks, and the rooms and their stages are drawn into the new scene.
    expect(mockScenes[1].ground).toBe(mockScenes[0].ground);
    expect(mockScenes[1].rooms).toBe(3);
    expect(mockScenes[1].applyCalls).toBeGreaterThan(0);
    expect(screen.getByTestId('lm-pin-kitchen')).toBeTruthy();

    r.rerender(withLook('game'));
    await settle();
    expect(mockScenes).toHaveLength(3);
    expect(mockScenes[1].disposed).toBe(true);
    expect(mockScenes[2].realistic).toBe(false);
    expect(mockScenes[2].rooms).toBe(3);
    // The same look again makes nothing new.
    r.rerender(withLook('game'));
    await settle();
    expect(mockScenes).toHaveLength(3);
  });
});
