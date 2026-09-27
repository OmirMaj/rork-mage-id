/**
 * UX wave, Lane D (D1, D3) — the + New… menu on a phone, driven.
 *
 *   D1  "+ > Estimate" never lands on the live job by itself: the picker
 *       always shows, "+ New job" first, the current job titled
 *       "Estimate for <Job>", closed jobs last; "+ New job" asks the host
 *       for its create modal WITH the chain ('estimate').
 *   D3  with a safe default job (a real pick, on the recent list) a
 *       job-scoped row opens at once for it, under "For <Job> · Change";
 *       the resolver's in-progress GUESS is never used; Punch opens the Add
 *       form (new=1), Clock in the crew sheet (clockIn=1), Code check sends
 *       source=project; the sub portal invite asks which sub and passes it;
 *       the field role floats Field and never sees the Money rows.
 *
 * Harness: react-test-renderer inside act (the w6c-shell-phone CreateMenu
 * cases), ios 390, contexts mocked to the rows under test.
 */

import React from 'react';
import { Dimensions } from 'react-native';
import { act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CreateMenu } from '@/components/CreateMenu';

type TestNode = { props: Record<string, unknown>; findAll(p: (n: TestNode) => boolean): TestNode[] };
type TestRendererInstance = { toJSON(): unknown; unmount(): void; root: TestNode };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: { create(el: React.ReactElement): TestRendererInstance } = require('react-test-renderer');

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/contexts/ThemeContext');
  const palette = jest.requireActual('@/constants/colors');
  const colors = { ...palette.Theme.light, ...palette.deriveAccentPalette(palette.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ...actual, useTheme: () => value };
});

type Job = { id: string; name: string; status: string; updatedAt?: string; myRole?: string };
const mockWorld: {
  projects: Job[];
  activeProjectId: string | null;
  recent: string[];
  subs: { id: string; companyName: string; contactName?: string; trade?: string }[];
  commitments: { subcontractorId?: string }[];
} = { projects: [], activeProjectId: null, recent: [], subs: [], commitments: [] };

jest.mock('@/contexts/ProjectContext', () => {
  const actual = jest.requireActual('@/contexts/ProjectContext');
  return {
    ...actual,
    useProjects: () => ({
      projects: mockWorld.projects,
      subcontractors: mockWorld.subs,
      getCommitmentsForProject: () => mockWorld.commitments,
    }),
  };
});
jest.mock('@/contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({
    activeProjectId: mockWorld.activeProjectId,
    activeProject: mockWorld.projects.find(p => p.id === mockWorld.activeProjectId) ?? null,
    setActiveProject: () => {},
    recentProjectIds: mockWorld.recent,
  }),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), canGoBack: () => false }) };
});
jest.mock('@/hooks/useTierAccess', () => ({
  useTierAccess: () => ({ tier: 'business', isProOrAbove: true, isBusinessOrAbove: true, canAccess: () => true, requiredTierFor: () => 'pro' }),
}));
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

beforeEach(() => {
  jest.useFakeTimers();
  // A Saturday noon: the Field float is off by the clock, so only the role floats it.
  jest.setSystemTime(new Date(2026, 8, 26, 12, 0));
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } });
  mockWorld.projects = [];
  mockWorld.activeProjectId = null;
  mockWorld.recent = [];
  mockWorld.subs = [];
  mockWorld.commitments = [];
  mockPush.mockClear();
});
afterEach(() => { jest.useRealTimers(); });

function mount(props: Partial<React.ComponentProps<typeof CreateMenu>> = {}) {
  let r: TestRendererInstance | null = null;
  act(() => {
    r = TestRenderer.create(<SafeAreaProvider initialMetrics={METRICS}><CreateMenu visible onClose={() => {}} {...props} /></SafeAreaProvider>);
  });
  const inst = r as unknown as TestRendererInstance;
  const byId = (id: string) => inst.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0];
  const has = (id: string) => inst.root.findAll(n => n.props.testID === id).length > 0;
  const press = (id: string) => {
    const n = byId(id);
    if (!n) throw new Error(`no pressable ${id}`);
    act(() => { (n.props.onPress as () => void)(); });
    act(() => { jest.advanceTimersByTime(1000); });
  };
  const texts = () => {
    const out: string[] = [];
    const walk = (node: unknown) => {
      if (node == null) return;
      if (typeof node === 'string') { out.push(node); return; }
      if (Array.isArray(node)) { node.forEach(walk); return; }
      walk((node as { children?: unknown }).children);
    };
    walk(inst.toJSON());
    return out;
  };
  // One entry per testID in render order (a composite and its host node
  // both carry the testID; findAll lists each).
  const ids = () => [...new Set(inst.root.findAll(n => typeof n.props.testID === 'string').map(n => n.props.testID as string))];
  return { inst, press, has, texts, ids, unmount: () => act(() => { inst.unmount(); }) };
}

const HENDERSON: Job = { id: 'p1', name: 'Henderson', status: 'in_progress', updatedAt: '2026-09-20T00:00:00Z' };
const OAK: Job = { id: 'p2', name: 'Oak St', status: 'estimated', updatedAt: '2026-09-25T00:00:00Z' };
const OLD: Job = { id: 'p3', name: 'Old Closed', status: 'closed', updatedAt: '2026-09-26T00:00:00Z' };

describe('D1: "+ > Estimate" always asks, "+ New job" first', () => {
  it('with ONE project it still shows the picker (no silent auto-route)', () => {
    mockWorld.projects = [HENDERSON];
    const m = mount();
    m.press('create-estimate');
    expect(mockPush).not.toHaveBeenCalled();
    expect(m.has('createmenu-new-job')).toBe(true);
    expect(m.has('createmenu-pick-project-p1')).toBe(true);
    m.unmount();
  });

  it('"+ New job" is the first row; the current job reads "Estimate for Henderson"; a closed job is last', () => {
    mockWorld.projects = [OLD, OAK, HENDERSON];
    mockWorld.activeProjectId = 'p1';
    mockWorld.recent = ['p1'];
    const m = mount();
    m.press('create-estimate');
    const order = m.ids().filter(id => id === 'createmenu-new-job' || id.startsWith('createmenu-pick-project-'));
    expect(order).toEqual(['createmenu-new-job', 'createmenu-pick-project-p1', 'createmenu-pick-project-p2', 'createmenu-pick-project-p3']);
    expect(m.texts()).toContain('Estimate for Henderson');
    expect(m.texts()).toContain('New project instead');
    m.unmount();
  });

  it('"+ New job" asks the host for its create modal with the estimate chain', () => {
    mockWorld.projects = [HENDERSON];
    const onCreateProject = jest.fn();
    const m = mount({ onCreateProject });
    m.press('create-estimate');
    m.press('createmenu-new-job');
    expect(onCreateProject).toHaveBeenCalledWith('estimate');
    m.unmount();
  });

  it('with no host, "+ New job" under Schedule routes to Home with then=schedule', () => {
    mockWorld.projects = [HENDERSON, OAK];
    const m = mount();
    m.press('create-schedule');
    m.press('createmenu-new-job');
    expect(mockPush).toHaveBeenCalledWith('/?openCreate=1&then=schedule');
    m.unmount();
  });

  it('picking the job for an estimate routes the wizard for that job', () => {
    mockWorld.projects = [HENDERSON, OAK];
    const m = mount();
    m.press('create-estimate');
    m.press('createmenu-pick-project-p2');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/estimate-wizard', params: { projectId: 'p2' } });
    m.unmount();
  });
});

describe('D3: the menu knows the job', () => {
  it('a real pick: "+ > Daily report" opens at once for it, under "For Henderson · Change"', () => {
    mockWorld.projects = [HENDERSON, OAK];
    mockWorld.activeProjectId = 'p1';
    mockWorld.recent = ['p1'];
    const m = mount();
    expect(m.texts()).toContain('For Henderson');
    expect(m.texts()).toContain('Change');
    m.press('create-daily-report');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/daily-report', params: { projectId: 'p1' } });
    m.unmount();
  });

  it('the resolver GUESS (active but never picked, not on the recent list) is not used: the picker shows', () => {
    mockWorld.projects = [HENDERSON, OAK];
    mockWorld.activeProjectId = 'p1';
    mockWorld.recent = [];
    const m = mount();
    expect(m.has('createmenu-job-bar')).toBe(false);
    m.press('create-daily-report');
    expect(mockPush).not.toHaveBeenCalled();
    expect(m.has('createmenu-pick-project-p1')).toBe(true);
    m.unmount();
  });

  it('"Change" drops the default: the next row asks which job', () => {
    mockWorld.projects = [HENDERSON, OAK];
    mockWorld.activeProjectId = 'p1';
    mockWorld.recent = ['p1'];
    const m = mount();
    m.press('createmenu-change-job');
    m.press('create-rfi');
    expect(mockPush).not.toHaveBeenCalled();
    expect(m.has('createmenu-pick-project-p2')).toBe(true);
    m.unmount();
  });

  it('Punch opens the Add form (new=1), Clock in the crew sheet (clockIn=1), Code check sends source=project', () => {
    mockWorld.projects = [HENDERSON];
    mockWorld.activeProjectId = 'p1';
    mockWorld.recent = ['p1'];
    let m = mount();
    m.press('create-punch-item');
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/punch-list', params: { projectId: 'p1', new: '1' } });
    m.unmount();
    m = mount();
    m.press('create-clock-in');
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/time-tracking', params: { projectId: 'p1', clockIn: '1' } });
    m.unmount();
    m = mount();
    m.press('create-code-check');
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/(tabs)/construction-ai', params: { projectId: 'p1', source: 'project' } });
    m.unmount();
    m = mount();
    m.press('create-delivery-arrived');
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/deliveries', params: { projectId: 'p1', arrived: '1' } });
    m.unmount();
    m = mount();
    m.press('create-send-lineup');
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/tomorrow-lineup', params: { projectId: 'p1' } });
    m.unmount();
  });

  it('"Progress draw" replaces "Progress Billing"', () => {
    mockWorld.projects = [HENDERSON];
    const m = mount();
    expect(m.texts()).toContain('Progress draw');
    expect(m.texts()).not.toContain('Progress Billing');
    m.unmount();
  });

  it('the sub portal invite asks which sub (subs on this job first) and passes subId', () => {
    mockWorld.projects = [HENDERSON];
    mockWorld.activeProjectId = 'p1';
    mockWorld.recent = ['p1'];
    mockWorld.subs = [{ id: 's1', companyName: 'Acme Drywall' }, { id: 's2', companyName: 'Best Electric' }];
    mockWorld.commitments = [{ subcontractorId: 's2' }];
    const m = mount();
    m.press('create-sub-portal-invite');
    expect(mockPush).not.toHaveBeenCalled();
    const order = m.ids().filter(id => id.startsWith('createmenu-pick-sub-'));
    expect(order).toEqual(['createmenu-pick-sub-s2', 'createmenu-pick-sub-s1']);
    m.press('createmenu-pick-sub-s1');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sub-portal-setup', params: { projectId: 'p1', subId: 's1' } });
    m.unmount();
  });

  it('the sub portal invite with no subs says so and offers to add one — never a dead link', () => {
    mockWorld.projects = [HENDERSON];
    mockWorld.activeProjectId = 'p1';
    mockWorld.recent = ['p1'];
    const m = mount();
    m.press('create-sub-portal-invite');
    expect(m.has('createmenu-no-subs')).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
    m.unmount();
  });

  it('the field role floats Field to the top and never sees the Money rows', () => {
    mockWorld.projects = [{ ...HENDERSON, myRole: 'field' }];
    mockWorld.activeProjectId = 'p1';
    mockWorld.recent = ['p1'];
    const m = mount();
    const t = m.texts();
    expect(t.indexOf('Field')).toBeGreaterThan(-1);
    expect(t.indexOf('Field')).toBeLessThan(t.indexOf('Start'));
    expect(m.has('create-invoice')).toBe(false);
    expect(m.has('create-change-order')).toBe(false);
    m.unmount();
  });

  it('an owner on a Saturday noon keeps Start first and sees Money', () => {
    mockWorld.projects = [HENDERSON];
    mockWorld.activeProjectId = 'p1';
    mockWorld.recent = ['p1'];
    const m = mount();
    const t = m.texts();
    expect(t.indexOf('Start')).toBeLessThan(t.indexOf('Field'));
    expect(m.has('create-invoice')).toBe(true);
    m.unmount();
  });
});
