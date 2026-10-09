/**
 * Smoke — The Living Model, Phase 1 (lane LIVINGMODEL): the entry row
 * (components/livingModel/LivingModelEntryRow), the route (app/living-model)
 * and the screen (components/livingModel/LivingModelScreen) AS THE PHONE
 * RENDERS THEM. jest resolves the phone files, so the 3D view here is
 * components/livingModel/JobReplay3D.tsx, which draws nothing; the 3D library
 * is never loaded in this suite, and test 12 checks that.
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
 *  11  the phone's replay says the 3D view is on the web, draws the flat replay, and carries both honesty lines
 *  12  the phone file for the 3D view draws nothing and the 3D library was never loaded
 *  13  Reported never shows the plan: a task with nothing reported reads "No Progress Reported"
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanupAsync, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
    useLocalSearchParams: () => ({ projectId: 'p1' }),
    Redirect: ({ href }: { href: string }) => R.createElement('Redirect', { href, testID: 'redirect' }),
    Stack: { Screen: () => null },
  };
});

// The 3D library must never be asked for on the phone. If anything here loads it, this flag flips.
let mockThreeLoaded = false;
jest.mock('three', () => { mockThreeLoaded = true; return {}; });

const OWNER = 'omirmajeed2000@gmail.com';
let mockUser: { id: string; email: string } | null = { id: 'user-1', email: 'someone@example.com' };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

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
const mockProject = { id: 'p1', name: 'Maple Street', schedule: mockSchedule };
const mockReports = [{ id: 'r1', projectId: 'p1', date: iso(daysAgo(14)), workProgress: [{ taskId: 't-demo', taskName: 'Demo kitchen', phase: 'Build', pct: 100 }] }];
jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({ getProject: () => mockProject, getDailyReportsForProject: () => mockReports }),
}));

import LivingModelRoute from '@/app/living-model';
import { JOB_REPLAY_3D_ON_THIS_PLATFORM, JobReplay3D } from '@/components/livingModel/JobReplay3D';
import { LivingModelEntryRow } from '@/components/livingModel/LivingModelEntryRow';
import { LIVING_MODEL_ENABLED } from '@/constants/featureFlags';
import { LIVING_MODEL_KEY_PREFIX, livingModelKey } from '@/utils/livingModel/storeCore';

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
    expect(screen.getByText('Saved on this device only for now.')).toBeTruthy();
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

  it('11 says the 3D view is on the web, draws the flat replay, and carries both honesty lines', async () => {
    await replayWithTicks();
    expect(screen.getByTestId('lm-phone-note')).toBeTruthy();
    expect(screen.getByText('The 3D view is on the web for now.')).toBeTruthy();
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

  it('12 the phone file for the 3D view draws nothing, and the 3D library was never loaded', () => {
    expect(JOB_REPLAY_3D_ON_THIS_PLATFORM).toBe(false);
    const { toJSON } = render(<JobReplay3D model={{ version: 1, projectId: 'p1', rooms: [], links: {}, updatedAt: '' }} level={0} moments={new Map()} selectedId={null} onSelect={() => {}} onUnavailable={() => {}} weekLine="" atToday={false} height={10} />);
    expect(toJSON()).toBeNull();
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
