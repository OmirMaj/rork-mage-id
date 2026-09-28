/**
 * UX wave, Lane D (D6) — the desktop rail's THIS JOB, ordered for a small GC,
 * with RFIs and Submittals moved behind "More for this job" AND their live
 * counts carried along.
 *
 *   - THIS JOB reads Estimate, Proposal & contract, Change Orders, Invoices,
 *     Daily Reports, Schedule, Punch List (document order);
 *   - with "More for this job" shut, an overdue RFI is still visible: the
 *     toggle carries the count, its red dot, and the spoken breakdown;
 *   - nothing open → no toggle count (never a 0); an unloaded source → none;
 *   - opened, the RFI / Submittal rows carry their own counts;
 *   - the collapsed rail keeps the RFI square only while it carries a count.
 *
 * Harness: w6d-k3-sidebar's (react-dom, the real sidebar, mocked contexts),
 * copied verbatim except the pathname, which is steerable here so the page is
 * NOT inside "More for this job" (on /rfi the group opens for context).
 */

import React, { act } from 'react';
import { Dimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

const mockPath = { current: '/invoice' };
const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => false };
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, useRouter: () => mockRouter, usePathname: () => mockPath.current, useLocalSearchParams: () => ({}) };
});
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));
jest.mock('@/contexts/SearchContext', () => ({ useSearch: () => ({ openSearch: jest.fn() }) }));
jest.mock('@/contexts/HireContext', () => ({ HIRE_ENABLED: false }));
// A tier requirement listed in mockLocked reads locked (the row shows its lock
// badge); everything else is open.
const mockLocked = new Set<string>();
jest.mock('@/hooks/useTierAccess', () => ({
  useTierAccess: () => ({ tier: 'pro', isProOrAbove: true, isBusinessOrAbove: false, canAccess: (f: string) => !mockLocked.has(f), requiredTierFor: () => 'pro' }),
}));
// The signed-in user (the collection-read latch restarts when it changes).
const mockUser: { id: string | null } = { id: 'u1' };
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser.id ? { id: mockUser.id } : null }) }));
jest.mock('@/hooks/useProjectAccess', () => ({ useProjectAccess: () => ({ canAccess: () => false }) }));
jest.mock('@/hooks/useClaimedCrewProfile', () => ({ useClaimedCrewProfile: () => null }));

// ── The world the sidebar reads (mutable per test) ─────────────────────────
type World = {
  userRole: string;
  activeProjectId: string | null;
  rfis: unknown[]; submittals: unknown[]; changeOrders: unknown[]; punchItems: unknown[];
  rfiSettle: { settled: boolean; failed: boolean };
  submittalSettle: { settled: boolean; failed: boolean };
  changeOrdersLoaded: boolean; punchItemsLoaded: boolean;
  collapsed: boolean;
  brainTotal: number; brainFailed: boolean;
};
const fresh = (): World => ({
  userRole: 'gc',
  activeProjectId: 'p1',
  rfis: [], submittals: [], changeOrders: [], punchItems: [],
  rfiSettle: { settled: true, failed: false },
  submittalSettle: { settled: true, failed: false },
  changeOrdersLoaded: true, punchItemsLoaded: true,
  collapsed: false,
  brainTotal: 3, brainFailed: false,
});
let mockWorld: World = fresh();

jest.mock('@/contexts/ProjectContext', () => ({
  useCoreData: () => ({ userRole: mockWorld.userRole, projects: [{ id: 'p1', name: 'Henderson' }], sourceFailed: false }),
  useDocsData: () => ({ rfis: mockWorld.rfis, submittals: mockWorld.submittals }),
  useFinancialsData: () => ({ changeOrders: mockWorld.changeOrders, changeOrdersLoaded: mockWorld.changeOrdersLoaded }),
  useFieldData: () => ({ punchItems: mockWorld.punchItems, punchItemsLoaded: mockWorld.punchItemsLoaded }),
}));
jest.mock('@/contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({
    activeProjectId: mockWorld.activeProjectId,
    activeProject: mockWorld.activeProjectId ? { id: mockWorld.activeProjectId, name: 'Henderson' } : null,
    setActiveProject: () => {},
    recentProjectIds: [],
  }),
}));
// The collection reads subscribe like the real hook does, so a test can move a
// read (settled → refetching → failed) under a MOUNTED sidebar.
const mockSettleListeners = new Set<() => void>();
function setSettle(key: 'rfis' | 'submittals', next: { settled: boolean; failed: boolean }): void {
  if (key === 'rfis') mockWorld.rfiSettle = next; else mockWorld.submittalSettle = next;
  mockSettleListeners.forEach((l) => l());
}
jest.mock('@/hooks/useCollectionSettled', () => {
  const R = jest.requireActual('react');
  return {
    useCollectionSettled: (key: string) => {
      const st = R.useSyncExternalStore(
        (l: () => void) => { mockSettleListeners.add(l); return () => { mockSettleListeners.delete(l); }; },
        () => (key === 'rfis' ? mockWorld.rfiSettle : mockWorld.submittalSettle),
      );
      return { ...st, hasRecord: false };
    },
  };
});
jest.mock('@/hooks/useSidebarRail', () => ({ useSidebarRail: () => ({ collapsed: mockWorld.collapsed, toggle: () => {} }) }));
jest.mock('@/components/desktop/JobSwitcher', () => {
  const R = jest.requireActual('react');
  const { View: V } = jest.requireActual('react-native');
  return { JobSwitcher: () => R.createElement(V, { testID: 'job-switcher-stub' }) };
});
// CreateMenu is lane K2's; only the props the sidebar hands it are under test.
const mockCreateMenuProps: { current: Record<string, unknown> | null } = { current: null };
jest.mock('@/components/CreateMenu', () => ({
  CreateMenu: (p: Record<string, unknown>) => { mockCreateMenuProps.current = p; return null; },
}));

// K1's dock API (contract D1/D4). The Ask dock is a stand-in; the shell dock is
// a tiny external store so open / close re-render the row like the real one.
const mockAsk = { toggleAsk: jest.fn(), openAsk: jest.fn(), isAskOpen: false };
jest.mock('@/hooks/useAskDock', () => ({ useAskDock: () => mockAsk }));
const mockDockStore = {
  state: { id: null as string | null, showing: false },
  canShow: true,
  listeners: new Set<() => void>(),
  set(patch: Partial<{ id: string | null; showing: boolean }>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  },
};
const mockDockOpen = jest.fn((_node: unknown, opts?: { id?: string }) => mockDockStore.set({ id: opts?.id ?? null, showing: true }));
const mockDockClose = jest.fn(() => mockDockStore.set({ id: null, showing: false }));
jest.mock('@/components/desktop/ShellDock', () => {
  const R = jest.requireActual('react');
  return {
    ASK_DOCK_ID: 'ask',
    ATTENTION_DOCK_ID: 'attention',
    useShellDock: () => {
      const st = R.useSyncExternalStore(
        (l: () => void) => { mockDockStore.listeners.add(l); return () => { mockDockStore.listeners.delete(l); }; },
        () => mockDockStore.state,
      );
      return {
        ...st, hidden: false, content: st.id ? 'docked' : null,
        open: mockDockOpen, close: mockDockClose, toggle: jest.fn(), show: jest.fn(),
        canShow: () => mockDockStore.canShow,
      };
    },
  };
});
jest.mock('@/hooks/useBrainWatch', () => ({
  useBrainWatch: () => ({ items: [], total: mockWorld.brainTotal, byKind: {}, sourceFailed: mockWorld.brainFailed }),
}));
const mockRailVariants: string[] = [];
jest.mock('@/components/DesktopActionRail', () => ({
  __esModule: true,
  default: ({ variant }: { variant?: string }) => { mockRailVariants.push(variant ?? 'rail'); return null; },
}));

import { ThemeProvider } from '@/contexts/ThemeContext';
import DesktopSidebar from '@/components/DesktopSidebar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const METRICS = { frame: { x: 0, y: 0, width: 1512, height: 945 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const roots: { root: Root; el: HTMLElement }[] = [];

async function mount(): Promise<void> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => {
    root.render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider>
          <View style={{ flexDirection: 'row', height: 858 }}>
            <DesktopSidebar width={mockWorld.collapsed ? 64 : 240} />
          </View>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
  mockWorld = fresh();
  mockCreateMenuProps.current = null;
  mockAsk.isAskOpen = false;
  mockDockStore.state = { id: null, showing: false };
  mockDockStore.canShow = true;
  mockRailVariants.length = 0;
  mockLocked.clear();
  mockUser.id = 'u1';
  mockPath.current = '/invoice';
  jest.clearAllMocks();
});

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
function byTestId(id: string): HTMLElement {
  const n = q(id);
  if (!n) throw new Error(`no element with testID ${id}`);
  return n;
}

const RFI = (status: string, dateRequired: string, projectId = 'p1') => ({ projectId, status, dateRequired });
const PAST = '2026-01-05';
const FUTURE = '2099-01-05';


const TOGGLE = 'MORE FOR THIS JOB';
const order = (ids: string[]) => ids.map(id => q(id)).filter((n): n is HTMLElement => !!n);

describe('D6: THIS JOB order', () => {
  it('reads Estimate, Proposal & contract, Change Orders, Invoices, Daily Reports, Schedule, Punch List', async () => {
    await mount();
    const want = ['sidebar-estimate', 'sidebar-contract', 'sidebar-change-order', 'sidebar-invoice', 'sidebar-daily-report', 'sidebar-schedule', 'sidebar-punch-list'];
    const nodes = order(want);
    expect(nodes).toHaveLength(7);
    for (let i = 1; i < nodes.length; i++) {
      // DOCUMENT_POSITION_FOLLOWING = 4
      expect(nodes[i - 1].compareDocumentPosition(nodes[i]) & 4).toBe(4);
    }
    expect(byTestId('sidebar-contract').textContent).toContain('Proposal & contract');
    // RFIs and Submittals are behind the shut toggle.
    expect(q('sidebar-rfi')).toBeNull();
    expect(q('sidebar-submittal')).toBeNull();
  });
});

describe('D6: the counts that moved behind "More for this job"', () => {
  it('an overdue RFI is visible on the shut toggle: count, red dot, spoken breakdown', async () => {
    mockWorld.rfis = [RFI('open', PAST), RFI('open', FUTURE)];
    mockWorld.submittals = [{ projectId: 'p1', currentStatus: 'pending', reviewCycles: [], requiredDate: FUTURE }];
    await mount();
    expect(byTestId(`sidebar-section-count-${TOGGLE}`).textContent).toBe('3');
    expect(q(`sidebar-section-count-dot-${TOGGLE}`)).not.toBeNull();
    expect(byTestId(`sidebar-section-${TOGGLE}`).getAttribute('aria-label'))
      .toBe('More for this project, collapsed, RFIs 2 open, 1 overdue; Submittals 1 open');
  });

  it('nothing open: no toggle count at all (never a 0)', async () => {
    mockWorld.rfis = [RFI('answered', PAST)];
    await mount();
    expect(q(`sidebar-section-count-${TOGGLE}`)).toBeNull();
    expect(byTestId(`sidebar-section-${TOGGLE}`).getAttribute('aria-label')).toBe('More for this project, collapsed');
  });

  it('an unloaded RFI read gives no RFI part (the submittal part still counts)', async () => {
    mockWorld.rfis = [RFI('open', PAST)];
    mockWorld.submittals = [{ projectId: 'p1', currentStatus: 'pending', reviewCycles: [], requiredDate: FUTURE }];
    mockWorld.rfiSettle = { settled: false, failed: false };
    await mount();
    expect(byTestId(`sidebar-section-count-${TOGGLE}`).textContent).toBe('1');
    expect(q(`sidebar-section-count-dot-${TOGGLE}`)).toBeNull();
  });

  it('opened (the page is an RFI), the RFI row carries its own count and the toggle does not repeat it', async () => {
    mockPath.current = '/rfi';
    mockWorld.rfis = [RFI('open', PAST)];
    await mount();
    expect(byTestId('sidebar-count-rfi').textContent).toBe('1');
    expect(q('sidebar-count-dot-rfi')).not.toBeNull();
    expect(q(`sidebar-section-count-${TOGGLE}`)).toBeNull();
  });

  it('the collapsed rail keeps the RFI square only while it carries a count', async () => {
    mockWorld.collapsed = true;
    mockWorld.rfis = [RFI('open', PAST)];
    await mount();
    expect(q('sidebar-rfi')).not.toBeNull();
    expect(q('sidebar-rail-dot-rfi')).not.toBeNull();
    expect(q('sidebar-submittal')).toBeNull();
  });

  it('the collapsed rail with nothing open shows no RFI square', async () => {
    mockWorld.collapsed = true;
    await mount();
    expect(q('sidebar-rfi')).toBeNull();
    expect(q('sidebar-estimate')).not.toBeNull();
  });
});
