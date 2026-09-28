/**
 * Wave 6d, d6r lane K3 — the sidebar's power layer, on real DOM nodes
 * (jsdom + react-dom + react-native-web at 1512 px, the stack app.mageid.app
 * runs).
 *
 *   • THIS JOB counts: omitted while a source is unloaded or failed (never a
 *     guessed 0), shown once loaded, '99+' past 99, a red dot for overdue.
 *   • The collapsed rail's hover label: mouseenter on a square shows the
 *     RailHoverPill at left 68 with the row's count, and no element carries
 *     a native `title` attribute (the pill replaced the 1 s browser tooltip).
 *   • The Ask MAGE row toggles the Ask dock (⌘J) instead of leaving the page.
 *   • The Action Required footer row opens the 'attention' dock, and a second
 *     press closes it.
 *   • The '+' beside the job switcher opens CreateMenu with a numeric anchor
 *     and activeJob true when a job is active.
 *
 * The sidebar's data hooks are stand-ins; the arithmetic behind the counts is
 * utils/sidebarCounts, proven equal to the log chips by validate-nav-coverage.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-k3-sidebar.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => false };
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, useRouter: () => mockRouter, usePathname: () => '/rfi', useLocalSearchParams: () => ({}) };
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

// ── Counts ─────────────────────────────────────────────────────────────────

describe('THIS JOB counts (never a guessed 0)', () => {
  it('omits every count while its source is unloaded or failed', async () => {
    mockWorld.rfis = [RFI('open', PAST)];
    mockWorld.submittals = [{ projectId: 'p1', currentStatus: 'pending', reviewCycles: [], requiredDate: FUTURE }];
    mockWorld.changeOrders = [{ projectId: 'p1', status: 'draft' }];
    mockWorld.punchItems = [{ projectId: 'p1', status: 'open' }];
    mockWorld.rfiSettle = { settled: false, failed: false };
    mockWorld.submittalSettle = { settled: true, failed: true };
    mockWorld.changeOrdersLoaded = false;
    mockWorld.punchItemsLoaded = false;
    await mount();
    expect(q('sidebar-rfi')).not.toBeNull();
    for (const k of ['rfi', 'submittal', 'change-order', 'punch-list']) expect(q(`sidebar-count-${k}`)).toBeNull();
    expect(byTestId('sidebar-rfi').getAttribute('aria-label')).toBe('RFIs, current page');
  });

  it('shows each count once its own source has loaded, with the overdue dot and the spoken suffix', async () => {
    mockWorld.rfis = [RFI('open', PAST), RFI('open', FUTURE), RFI('answered', PAST), RFI('open', PAST, 'p2')];
    mockWorld.submittals = [{ projectId: 'p1', currentStatus: 'in_review', reviewCycles: [], requiredDate: FUTURE }];
    mockWorld.changeOrders = [{ projectId: 'p1', status: 'draft' }, { projectId: 'p1', status: 'approved' }];
    mockWorld.punchItems = [];
    await mount();
    expect(byTestId('sidebar-count-rfi').textContent).toBe('2');
    expect(q('sidebar-count-dot-rfi')).not.toBeNull();
    expect(byTestId('sidebar-rfi').getAttribute('aria-label')).toBe('RFIs, 2 open, 1 overdue, current page');
    expect(byTestId('sidebar-count-submittal').textContent).toBe('1');
    expect(q('sidebar-count-dot-submittal')).toBeNull();
    expect(byTestId('sidebar-count-change-order').textContent).toBe('1');
    // Zero open punch items: no pill at all, not a '0'.
    expect(q('sidebar-count-punch-list')).toBeNull();
    // Rows that carry no count never get one.
    expect(q('sidebar-count-schedule')).toBeNull();
  });

  // Each source gates ONLY its own row: unload or fail one, the other three
  // still count. (A swapped flag — punch reading the CO flag — fails here.)
  const LOADED_CASES: { name: string; row: string; set: () => void }[] = [
    { name: 'RFIs still loading', row: 'rfi', set: () => { mockWorld.rfiSettle = { settled: false, failed: false }; } },
    { name: 'RFIs read failed', row: 'rfi', set: () => { mockWorld.rfiSettle = { settled: true, failed: true }; } },
    { name: 'submittals still loading', row: 'submittal', set: () => { mockWorld.submittalSettle = { settled: false, failed: false }; } },
    { name: 'submittals read failed', row: 'submittal', set: () => { mockWorld.submittalSettle = { settled: true, failed: true }; } },
    { name: 'change orders not loaded', row: 'change-order', set: () => { mockWorld.changeOrdersLoaded = false; } },
    { name: 'punch items not loaded', row: 'punch-list', set: () => { mockWorld.punchItemsLoaded = false; } },
  ];
  it.each(LOADED_CASES)('$name: omits only the $row count', async ({ row, set }) => {
    mockWorld.rfis = [RFI('open', FUTURE)];
    mockWorld.submittals = [{ projectId: 'p1', currentStatus: 'pending', reviewCycles: [], requiredDate: FUTURE }];
    mockWorld.changeOrders = [{ projectId: 'p1', status: 'draft' }];
    mockWorld.punchItems = [{ projectId: 'p1', status: 'open' }];
    set();
    await mount();
    for (const k of ['rfi', 'submittal', 'change-order', 'punch-list']) {
      if (k === row) expect(q(`sidebar-count-${k}`)).toBeNull();
      else expect(byTestId(`sidebar-count-${k}`).textContent).toBe('1');
    }
  });

  it('keeps a loaded count through a background refetch; a failed read drops it; a new user starts over', async () => {
    mockWorld.rfis = [RFI('open', FUTURE), RFI('open', FUTURE)];
    await mount();
    expect(byTestId('sidebar-count-rfi').textContent).toBe('2');
    // Opening the RFI log refetches ['rfis']: settled goes false while it runs.
    await act(async () => { setSettle('rfis', { settled: false, failed: false }); });
    expect(byTestId('sidebar-count-rfi').textContent).toBe('2');
    await act(async () => { setSettle('rfis', { settled: true, failed: false }); });
    expect(byTestId('sidebar-count-rfi').textContent).toBe('2');
    // The refetch failed: unknown now, not the stale number.
    await act(async () => { setSettle('rfis', { settled: true, failed: true }); });
    expect(q('sidebar-count-rfi')).toBeNull();
    // Healthy again, then a different user signs in while his read is in flight.
    await act(async () => { setSettle('rfis', { settled: true, failed: false }); });
    expect(byTestId('sidebar-count-rfi').textContent).toBe('2');
    mockUser.id = 'u2';
    await act(async () => { setSettle('rfis', { settled: false, failed: false }); });
    expect(q('sidebar-count-rfi')).toBeNull();
  });

  it('never shows a count beside a lock badge', async () => {
    // RFIs need rfis_submittals (featureRegistry); lock it.
    mockLocked.add('rfis_submittals');
    mockWorld.rfis = [RFI('open', PAST)];
    mockWorld.changeOrders = [{ projectId: 'p1', status: 'draft' }];
    await mount();
    expect(q('sidebar-rfi')).not.toBeNull();
    expect(q('sidebar-count-rfi')).toBeNull();
    expect(q('sidebar-count-dot-rfi')).toBeNull();
    expect(byTestId('sidebar-rfi').getAttribute('aria-label')).not.toMatch(/open/);
    // An unlocked counted row beside it still counts.
    expect(byTestId('sidebar-count-change-order').textContent).toBe('1');
  });

  it('never shows a count beside a lock badge on the collapsed rail either', async () => {
    mockWorld.collapsed = true;
    mockLocked.add('rfis_submittals');
    mockWorld.rfis = [RFI('open', PAST)];
    await mount();
    expect(q('sidebar-rfi')).not.toBeNull();
    expect(q('sidebar-rail-dot-rfi')).toBeNull();
    expect((byTestId('sidebar-rfi').parentElement as HTMLElement).getAttribute('data-title')).not.toMatch(/open/);
  });

  it("reads '99+' past 99", async () => {
    mockWorld.punchItems = Array.from({ length: 150 }, (_, i) => ({ projectId: 'p1', status: i % 2 ? 'in_progress' : 'ready_for_review' }));
    await mount();
    expect(byTestId('sidebar-count-punch-list').textContent).toBe('99+');
  });

  it('shows no counts with no active job', async () => {
    mockWorld.activeProjectId = null;
    mockWorld.rfis = [RFI('open', PAST)];
    await mount();
    expect(q('sidebar-count-rfi')).toBeNull();
  });
});

// ── The collapsed rail's hover pill ───────────────────────────────────────

describe('collapsed rail hover label', () => {
  it('mouseenter on a square shows the pill at left 68 with its count; no native title anywhere', async () => {
    mockWorld.collapsed = true;
    mockWorld.rfis = [RFI('open', PAST), RFI('open', PAST), RFI('open', FUTURE), RFI('open', FUTURE)];
    await mount();
    expect(q('sidebar-rail-pill')).toBeNull();
    expect(q('sidebar-rail-dot-rfi')).not.toBeNull();
    const tip = byTestId('sidebar-rfi').parentElement as HTMLElement;
    expect(tip.getAttribute('data-title')).toBe('RFIs · 4 open, 2 overdue');
    await act(async () => { tip.dispatchEvent(new MouseEvent('mouseenter')); });
    const pill = byTestId('sidebar-rail-pill');
    expect(pill.textContent).toBe('RFIs · 4 open, 2 overdue');
    // jsdom lays nothing out: the rail's left edge is 0, so the pill's fixed
    // left is 0 + 64 + 4.
    expect(getComputedStyle(pill).left).toBe('68px');
    // Portalled to document.body, fixed to the viewport, above the app root's
    // z-index-0 stacking context — inside the sidebar the page View (a later
    // z-index-0 sibling) would paint over it.
    expect(getComputedStyle(pill).position).toBe('fixed');
    expect(pill.parentElement).toBe(document.body);
    expect(Number(getComputedStyle(pill).zIndex)).toBeGreaterThan(0);
    expect(byTestId('sidebar-rfi').closest('[aria-label="Primary navigation"]')?.contains(pill)).toBe(false);
    expect(getComputedStyle(pill).pointerEvents).toBe('none');
    expect(document.querySelectorAll('[title]')).toHaveLength(0);
    await act(async () => { tip.dispatchEvent(new MouseEvent('mouseleave')); });
    expect(q('sidebar-rail-pill')).toBeNull();
  });

  it('places the pill in viewport px: the square\'s top, the rail\'s left', async () => {
    mockWorld.collapsed = true;
    await mount();
    const nav = byTestId('sidebar-search').closest('[aria-label="Primary navigation"]') as HTMLElement;
    const tip = byTestId('sidebar-search').parentElement as HTMLElement;
    const rect = (top: number, left: number, height: number) => () =>
      ({ top, left, height, width: 64, right: left + 64, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    nav.getBoundingClientRect = rect(0, 120, 858);
    tip.getBoundingClientRect = rect(300, 120, 40);
    await act(async () => { tip.dispatchEvent(new MouseEvent('mouseenter')); });
    const pill = byTestId('sidebar-rail-pill');
    // left = rail left 120 + 64 + 4; top = 300 + 40/2 - 28/2.
    expect(getComputedStyle(pill).left).toBe('188px');
    expect(getComputedStyle(pill).top).toBe('306px');
  });

  it('keyboard focus shows the pill too, and blur hides it', async () => {
    mockWorld.collapsed = true;
    await mount();
    const tip = byTestId('sidebar-search').parentElement as HTMLElement;
    await act(async () => { tip.dispatchEvent(new FocusEvent('focusin')); });
    expect(byTestId('sidebar-rail-pill').textContent).toBe('Search (⌘K)');
    await act(async () => { tip.dispatchEvent(new FocusEvent('focusout')); });
    expect(q('sidebar-rail-pill')).toBeNull();
  });
});

// ── '+ New' beside the job switcher ───────────────────────────────────────

async function click(target: EventTarget): Promise<void> {
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); });
  // measureInWindow answers on a timer in react-native-web.
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

describe("'+ New' opens CreateMenu anchored beside the sidebar", () => {
  it('expanded: the 40×40 button sits beside the job switcher and opens the popover at x 244 for the active job', async () => {
    await mount();
    const plus = byTestId('sidebar-new');
    // Beside the switcher, in one row — no 'New' label row under it any more.
    expect(plus.previousElementSibling?.querySelector('[data-testid="job-switcher-stub"]')).not.toBeNull();
    expect(plus.textContent).toBe('');
    expect(mockCreateMenuProps.current?.visible).toBe(false);
    await click(plus);
    const p = mockCreateMenuProps.current!;
    expect(p.visible).toBe(true);
    const anchor = p.anchor as { x: number; y: number };
    expect(anchor).toEqual({ x: 244, y: expect.any(Number) });
    expect(Number.isFinite(anchor.y)).toBe(true);
    expect(p.activeJob).toBe(true);
  });

  it('collapsed: the rail square opens it at x 68', async () => {
    mockWorld.collapsed = true;
    await mount();
    await click(byTestId('sidebar-new'));
    const p = mockCreateMenuProps.current!;
    expect(p.visible).toBe(true);
    expect((p.anchor as { x: number }).x).toBe(68);
  });

  it('with no active job: activeJob is false (CreateMenu keeps its picker)', async () => {
    mockWorld.activeProjectId = null;
    await mount();
    await click(byTestId('sidebar-new'));
    expect(mockCreateMenuProps.current?.visible).toBe(true);
    expect(mockCreateMenuProps.current?.activeJob).toBe(false);
  });
});

// ── The Ask MAGE row: a ⌘J dock toggle ─────────────────────────────────────

describe('the Ask MAGE row toggles the Ask dock instead of leaving the page', () => {
  it('expanded: a button (not a link) with ⌘J, toggleAsk on press, expanded follows isAskOpen', async () => {
    await mount();
    const row = byTestId('sidebar-ask-mage');
    expect(row.tagName).not.toBe('A');
    expect(row.getAttribute('role')).toBe('button');
    expect(row.getAttribute('aria-label')).toBe('Ask MAGE, opens beside the page');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.textContent).toBe('Ask MAGE⌘J');
    await click(row);
    expect(mockAsk.toggleAsk).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('reads expanded while the dock is really drawn', async () => {
    mockAsk.isAskOpen = true;
    await mount();
    expect(byTestId('sidebar-ask-mage').getAttribute('aria-expanded')).toBe('true');
  });

  it('collapsed: the rail square toggles it too, and its hover label names the key', async () => {
    mockWorld.collapsed = true;
    await mount();
    const sq = byTestId('sidebar-ask-mage');
    expect(sq.getAttribute('role')).toBe('button');
    expect((sq.parentElement as HTMLElement).getAttribute('data-title')).toBe('Ask MAGE (⌘J)');
    await click(sq);
    expect(mockAsk.toggleAsk).toHaveBeenCalledTimes(1);
  });
});

// ── Action Required: the attention list in the dock ────────────────────────

describe('the Action Required footer row opens the attention dock', () => {
  it("opens the 'attention' dock with the docked rail, and a second press closes it", async () => {
    await mount();
    const row = byTestId('sidebar-action-required');
    expect(byTestId('sidebar-action-required-pill').textContent).toBe('3');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    await click(row);
    expect(mockDockOpen).toHaveBeenCalledTimes(1);
    expect(mockDockOpen.mock.calls[0][1]).toEqual({ id: 'attention', title: 'Action required', width: 440 });
    // The docked content is DesktopActionRail's 'dock' variant.
    const node = mockDockOpen.mock.calls[0][0] as React.ReactElement<{ variant?: string }>;
    expect(node.props.variant).toBe('dock');
    expect(byTestId('sidebar-action-required').getAttribute('aria-expanded')).toBe('true');
    await click(byTestId('sidebar-action-required'));
    expect(mockDockClose).toHaveBeenCalledTimes(1);
    expect(mockDockOpen).toHaveBeenCalledTimes(1);
    expect(byTestId('sidebar-action-required').getAttribute('aria-expanded')).toBe('false');
  });

  it('sits first in the footer, above the account rows', async () => {
    await mount();
    const row = byTestId('sidebar-action-required');
    const settings = byTestId('sidebar-settings');
    expect(row.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says '!' when the count could not load (unknown, not zero)", async () => {
    mockWorld.brainFailed = true;
    await mount();
    expect(byTestId('sidebar-action-required-pill').textContent).toBe('!');
  });

  it('shows no pill at 0', async () => {
    mockWorld.brainTotal = 0;
    await mount();
    expect(q('sidebar-action-required')).not.toBeNull();
    expect(q('sidebar-action-required-pill')).toBeNull();
  });

  it('does nothing where the dock cannot show', async () => {
    mockDockStore.canShow = false;
    await mount();
    await click(byTestId('sidebar-action-required'));
    expect(mockDockOpen).not.toHaveBeenCalled();
  });

  it('is absent for a minimal persona (no GC attention feed)', async () => {
    mockWorld.userRole = 'client';
    await mount();
    expect(q('sidebar-action-required')).toBeNull();
  });

  it('collapsed: an icon square with a red dot, before Settings', async () => {
    mockWorld.collapsed = true;
    await mount();
    const sq = byTestId('sidebar-action-required');
    expect(q('sidebar-action-required-dot')).not.toBeNull();
    expect(sq.compareDocumentPosition(byTestId('sidebar-settings')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await click(sq);
    expect(mockDockOpen).toHaveBeenCalledTimes(1);
  });
});
