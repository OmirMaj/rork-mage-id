/**
 * Wave 6b, lane L2 — the job context.
 *
 * Part 1 is the PHONE-IDENTICAL proof. ToolProjectPicker is the one shared
 * component this lane touches that renders on a phone. Its snapshot below was
 * written from the pre-wave-6b source (main 6065b326) BEFORE the picker learned
 * to call setActiveProject, and it must never be regenerated to make a change
 * pass: a diff here means a phone at 390 no longer renders what it rendered
 * yesterday. (`jest -u` on this file is a design decision, not a fix.)
 */

import React from 'react';
import { Text } from 'react-native';
import { Slot } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { renderRouter, fireEvent, act, waitFor } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import { world } from '@/__tests__/fixtures/world';
import type { Project } from '@/types';
import { ActiveProjectProvider, useActiveProject } from '@/contexts/ActiveProjectContext';
import { ACTIVE_PROJECT_KEY, RECENT_PROJECTS_KEY, stampActive, stampRecent } from '@/utils/activeProject';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';

// Part 2 mounts the REAL ActiveProjectProvider. Its only two inputs from the
// app are the signed-in user and the project list, so those two hooks are
// replaced with ones the tests steer (`mock`-prefixed so jest's hoisted
// factories may read them). Part 1 never mounts the provider, and the picker
// reads the inert default, so these mocks do not reach its snapshot.
let mockUser: { id: string } | null = null;
let mockProjects: Project[] = [];
// A sign-in change must re-render the provider the way AuthContext would, so
// the mock is a tiny external store rather than a plain variable read.
let mockVersion = 0;
const mockListeners = new Set<() => void>();
function mockSubscribe(l: () => void) { mockListeners.add(l); return () => { mockListeners.delete(l); }; }
function switchAccount(user: { id: string } | null, projects: Project[]) {
  mockUser = user;
  mockProjects = projects;
  mockVersion += 1;
  mockListeners.forEach(l => l());
}
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => {
    require('react').useSyncExternalStore(mockSubscribe, () => mockVersion);
    return { user: mockUser };
  },
}));
jest.mock('@/contexts/ProjectContext', () => ({ useCoreData: () => ({ projects: mockProjects }) }));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const SECOND: Project = { ...world.project, id: 'p-second', name: 'Okafor Duplex — framing' };

function renderPicker(props: Partial<React.ComponentProps<typeof ToolProjectPicker>>) {
  function Screen() {
    return (
      <ToolProjectPicker
        toolName="RFIs"
        message="RFIs belong to a project."
        projects={[world.project, SECOND]}
        onPick={() => {}}
        {...props}
      />
    );
  }
  return renderRouter(
    { index: Screen },
    {
      initialUrl: '/',
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <SafeAreaProvider initialMetrics={METRICS}>
          <ThemeProvider>{children}</ThemeProvider>
        </SafeAreaProvider>
      ),
    },
  );
}

describe('phone at 390: ToolProjectPicker renders exactly what it rendered before wave 6b', () => {
  it('the pick list', () => {
    expect(stripSanctioned(renderPicker({}).toJSON())).toMatchSnapshot();
  });
  it('the stale-link notice', () => {
    expect(stripSanctioned(renderPicker({ staleProjectId: 'gone' }).toJSON())).toMatchSnapshot();
  });
  it('zero projects', () => {
    expect(stripSanctioned(renderPicker({ projects: [] }).toJSON())).toMatchSnapshot();
  });
});

describe('phone at 390: a pick still reaches the host screen', () => {
  it('pressing a project row calls onPick with its id, exactly once', () => {
    const onPick = jest.fn();
    const r = renderPicker({ onPick });
    fireEvent.press(r.getByTestId(`tool-pick-project-${SECOND.id}`));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(SECOND.id);
  });
});

// ── Part 2: the provider, mounted for real ────────────────────────────────
// The tenant rule is the one that matters most: "it must never show another
// account's job". These drive the provider through storage, the URL and a user
// switch and read what it exposes.

const HENDERSON: Project = { ...world.project, id: 'p-hend', name: 'Henderson Residence', status: 'in_progress', updatedAt: '2026-09-01T00:00:00Z' };
const OKAFOR: Project = { ...world.project, id: 'p-okafor', name: 'Okafor Duplex', status: 'in_progress', updatedAt: '2026-09-20T00:00:00Z' };
const CLOSED_JOB: Project = { ...world.project, id: 'p-closed', name: 'Old Warehouse', status: 'closed', updatedAt: '2026-09-22T00:00:00Z' };
const SAMPLE_JOB: Project = { ...world.project, id: 'p-sample', name: 'Sample — Kitchen Remodel', status: 'in_progress', updatedAt: '2026-09-23T00:00:00Z' };

let probe: ReturnType<typeof useActiveProject> | null = null;
function Probe() {
  probe = useActiveProject();
  return <Text testID="active">{probe.activeProjectId ?? 'none'}</Text>;
}
function Layout() {
  return <ActiveProjectProvider><Slot /></ActiveProjectProvider>;
}
function mountProvider(initialUrl = '/') {
  return renderRouter(
    { _layout: Layout, index: Probe, rfi: Probe, 'project-detail': Probe, invoice: Probe },
    { initialUrl },
  );
}

describe('ActiveProjectProvider', () => {
  beforeEach(async () => {
    probe = null;
    mockUser = { id: 'user-a' };
    mockProjects = [HENDERSON, OKAFOR, CLOSED_JOB, SAMPLE_JOB];
    await AsyncStorage.clear();
  });

  it("ignores another account's stored job and recent list", async () => {
    await AsyncStorage.multiSet([
      [ACTIVE_PROJECT_KEY, stampActive('user-b', HENDERSON.id)],
      [RECENT_PROJECTS_KEY, stampRecent('user-b', [HENDERSON.id])],
    ]);
    const r = mountProvider('/');
    // Falls to rule 4 (newest in-progress, not sample): Okafor, never user-b's pick.
    await waitFor(() => expect(r.getByTestId('active').props.children).toBe(OKAFOR.id));
    expect(probe!.recentProjectIds).toEqual([]);
  });

  it('never resolves to a closed or sample job, whatever storage says', async () => {
    await AsyncStorage.multiSet([
      [ACTIVE_PROJECT_KEY, stampActive('user-a', CLOSED_JOB.id)],
      [RECENT_PROJECTS_KEY, stampRecent('user-a', [SAMPLE_JOB.id, CLOSED_JOB.id, HENDERSON.id])],
    ]);
    const r = mountProvider('/');
    await waitFor(() => expect(r.getByTestId('active').props.children).toBe(HENDERSON.id));
    expect(probe!.recentProjectIds).toEqual([HENDERSON.id]);
  });

  it('the URL leads: /rfi?projectId= makes that job active and remembers it', async () => {
    const r = mountProvider(`/rfi?projectId=${HENDERSON.id}`);
    await waitFor(() => expect(r.getByTestId('active').props.children).toBe(HENDERSON.id));
    await waitFor(async () => {
      const raw = await AsyncStorage.getItem(RECENT_PROJECTS_KEY);
      expect(JSON.parse(raw ?? '{}')).toEqual({ uid: 'user-a', ids: [HENDERSON.id] });
    });
  });

  it("project-detail's ?id= sets the active job (no edit to project-detail needed)", async () => {
    const r = mountProvider(`/project-detail?id=${HENDERSON.id}`);
    await waitFor(() => expect(r.getByTestId('active').props.children).toBe(HENDERSON.id));
  });

  it("an invoice's ?id= is NOT read as a job", async () => {
    const r = mountProvider(`/invoice?id=${HENDERSON.id}`);
    await waitFor(() => expect(r.getByTestId('active').props.children).toBe(OKAFOR.id));
  });

  it("a foreign or stale id in a shared link changes nothing", async () => {
    // Seed this user's Recent so HYDRATION IS OBSERVABLE. The URL rule only
    // runs once storage has been read; the old version of this test asserted
    // before that point, so it stayed green with the foreign-id guard deleted
    // (wave-6b integration review, mutant F1). Waiting for the seeded Recent
    // to surface proves the read landed and the URL effect has had its turn.
    const seededRecent = stampRecent('user-a', [HENDERSON.id]);
    await AsyncStorage.setItem(RECENT_PROJECTS_KEY, seededRecent);
    const r = mountProvider('/rfi?projectId=someone-elses-job');
    await waitFor(() => expect(probe!.recentProjectIds).toEqual([HENDERSON.id]));
    // One more turn for any write the URL effect queued. Microtasks only:
    // this suite runs on fake timers, where a setTimeout never fires.
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
    expect(r.getByTestId('active').props.children).not.toBe('someone-elses-job');
    expect(await AsyncStorage.getItem(ACTIVE_PROJECT_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(RECENT_PROJECTS_KEY)).toBe(seededRecent);
  });

  it('setActiveProject persists a stamped pick and moves the job to the front of Recent', async () => {
    const r = mountProvider('/');
    await waitFor(() => expect(r.getByTestId('active').props.children).toBe(OKAFOR.id));
    await act(async () => { probe!.setActiveProject(HENDERSON.id); });
    await waitFor(() => expect(r.getByTestId('active').props.children).toBe(HENDERSON.id));
    expect(probe!.recentProjectIds).toEqual([HENDERSON.id]);
    expect(JSON.parse((await AsyncStorage.getItem(ACTIVE_PROJECT_KEY)) ?? '{}'))
      .toEqual({ uid: 'user-a', id: HENDERSON.id });
  });

  it('a user switch drops the previous account\'s job from memory at once', async () => {
    const r = mountProvider('/');
    await waitFor(() => expect(r.getByTestId('active').props.children).toBe(OKAFOR.id));
    await act(async () => { probe!.setActiveProject(HENDERSON.id); });
    await waitFor(() => expect(probe!.recentProjectIds).toEqual([HENDERSON.id]));
    // Same device, different account whose list happens to hold Henderson's id
    // too (the worst case): nothing of user-a's may carry over.
    await act(async () => { switchAccount({ id: 'user-b' }, [HENDERSON, OKAFOR]); });
    await waitFor(() => expect(probe!.recentProjectIds).toEqual([]));
    expect(r.getByTestId('active').props.children).toBe(OKAFOR.id);
  });

  it('signed out: no job at all', async () => {
    mockUser = null;
    const r = mountProvider(`/rfi?projectId=${HENDERSON.id}`);
    await waitFor(() => expect(r.getByTestId('active').props.children).toBe('none'));
  });
});
