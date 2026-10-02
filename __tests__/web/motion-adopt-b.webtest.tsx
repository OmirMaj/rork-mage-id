/**
 * Wave 4 motion adoption, part B (lane MOTIONADOPT-B) — the desktop sidebar's
 * gliding highlight, on real DOM nodes (jsdom + react-dom + react-native-web
 * at 1512 px, the stack app.mageid.app runs).
 *
 *   W0 with the glide switched off (SIDEBAR_GLIDE.enabled false, the FB4
 *      default until the Chrome trace is clean) there is no marker, ever, and
 *      the rows are not measured;
 *   W1 at rest: no "sidebar-focus-marker" node; the active row paints its own
 *      accentFill;
 *   W2 a page change between two measured rows: ONE marker mounts; during the
 *      flight neither row paints the fill; when the springs land the marker
 *      unmounts and the new row paints it;
 *   W3 prefers-reduced-motion: reduce → no marker on a change (instant swap).
 *
 * jsdom has no ResizeObserver, so the rows' layout is handed to the same
 * handler react-native-web's onLayout installs on each node. Under jest,
 * react-native-web swaps in AnimatedMock (every animation ends at once), so
 * W2 holds the glide's completion (the kit webtest's recipe) to see the
 * frame with the marker, then ends it the way the springs would.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/motion-adopt-b.webtest.tsx
 */

import React, { act } from 'react';
import { Animated, Dimensions, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockReduce = false;
const reduceListeners: ((e: { matches: boolean }) => void)[] = [];
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (q: string) => ({
    get matches() { return q.includes('reduce') ? mockReduce : false; },
    media: q,
    addEventListener: (_t: string, fn: (e: { matches: boolean }) => void) => { if (q.includes('reduce')) reduceListeners.push(fn); },
    removeEventListener: () => {},
    addListener: (fn: (e: { matches: boolean }) => void) => { if (q.includes('reduce')) reduceListeners.push(fn); },
    removeListener: () => {},
  }),
});
const setReduce = (on: boolean) => { mockReduce = on; act(() => { reduceListeners.forEach((fn) => fn({ matches: on })); }); };

// The pathname is navigation state: a tiny store the test moves.
let mockPath = '/summary';
const mockPathListeners = new Set<() => void>();
const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => false };
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  const R = jest.requireActual('react');
  return {
    ...actual,
    useRouter: () => mockRouter,
    usePathname: () => R.useSyncExternalStore(
      (l: () => void) => { mockPathListeners.add(l); return () => { mockPathListeners.delete(l); }; },
      () => mockPath,
    ),
    useLocalSearchParams: () => ({}),
  };
});
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));
jest.mock('@/contexts/SearchContext', () => ({ useSearch: () => ({ openSearch: jest.fn() }) }));
jest.mock('@/contexts/HireContext', () => ({ HIRE_ENABLED: false }));
jest.mock('@/hooks/useTierAccess', () => ({
  useTierAccess: () => ({ tier: 'pro', isProOrAbove: true, isBusinessOrAbove: false, canAccess: () => true, requiredTierFor: () => 'pro' }),
}));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/hooks/useProjectAccess', () => ({ useProjectAccess: () => ({ canAccess: () => false }) }));
jest.mock('@/hooks/useClaimedCrewProfile', () => ({ useClaimedCrewProfile: () => null }));
jest.mock('@/contexts/ProjectContext', () => ({
  useCoreData: () => ({ userRole: 'gc', projects: [{ id: 'p1', name: 'Henderson' }], sourceFailed: false }),
  useDocsData: () => ({ rfis: [], submittals: [] }),
  useFinancialsData: () => ({ changeOrders: [], changeOrdersLoaded: true }),
  useFieldData: () => ({ punchItems: [], punchItemsLoaded: true }),
}));
jest.mock('@/contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({ activeProjectId: 'p1', activeProject: { id: 'p1', name: 'Henderson' }, setActiveProject: () => {}, recentProjectIds: [] }),
}));
jest.mock('@/hooks/useCollectionSettled', () => ({ useCollectionSettled: () => ({ settled: true, failed: false, hasRecord: false }) }));
jest.mock('@/hooks/useSidebarRail', () => ({ useSidebarRail: () => ({ collapsed: false, toggle: () => {} }) }));
jest.mock('@/components/desktop/JobSwitcher', () => {
  const R = jest.requireActual('react');
  const { View: V } = jest.requireActual('react-native');
  return { JobSwitcher: () => R.createElement(V, { testID: 'job-switcher-stub' }) };
});
jest.mock('@/components/CreateMenu', () => ({ CreateMenu: () => null }));
jest.mock('@/hooks/useAskDock', () => ({ useAskDock: () => ({ toggleAsk: jest.fn(), openAsk: jest.fn(), isAskOpen: false }) }));
jest.mock('@/components/desktop/ShellDock', () => ({
  ASK_DOCK_ID: 'ask',
  ATTENTION_DOCK_ID: 'attention',
  useShellDock: () => ({ id: null, showing: false, hidden: false, content: null, open: jest.fn(), close: jest.fn(), toggle: jest.fn(), show: jest.fn(), canShow: () => true }),
}));
jest.mock('@/hooks/useBrainWatch', () => ({ useBrainWatch: () => ({ items: [], total: 0, byKind: {}, sourceFailed: false }) }));
jest.mock('@/components/DesktopActionRail', () => ({ __esModule: true, default: () => null }));

/* eslint-disable import/first */
import { ThemeProvider } from '@/contexts/ThemeContext';
import DesktopSidebar, { SIDEBAR_GLIDE } from '@/components/DesktopSidebar';
import { resetBudget } from '@/components/motion/kit';
/* eslint-enable import/first */

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
            <DesktopSidebar width={240} />
          </View>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  resetBudget();
  mockPath = '/summary';
});
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
  SIDEBAR_GLIDE.enabled = false;
  if (mockReduce) setReduce(false);
  jest.useRealTimers();
});

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const row = (key: string) => {
  const n = q(`sidebar-${key}`);
  if (!n) throw new Error(`no sidebar row ${key}`);
  return n;
};
/** The row paints the active fill (the one inline background the sidebar sets). */
const painted = (el: HTMLElement) => el.style.backgroundColor !== '';
type LayoutNode = HTMLElement & { __reactLayoutHandler?: (e: unknown) => void };
function layout(el: HTMLElement, x: number, y: number, width: number, height: number) {
  const h = (el as LayoutNode).__reactLayoutHandler;
  if (typeof h !== 'function') throw new Error('no onLayout handler on ' + (el.getAttribute('data-testid') ?? el.tagName));
  act(() => { h({ nativeEvent: { layout: { x, y, width, height } }, timeStamp: Date.now() }); });
}
function go(path: string) {
  mockPath = path;
  act(() => { mockPathListeners.forEach((l) => l()); });
}
const advance = (ms: number) => { for (let left = ms; left > 0; left -= 16) act(() => { jest.advanceTimersByTime(Math.min(16, left)); }); };

/** Measure the WORKSPACE section and its Summary / Waiting-on rows (same column). */
function measureWorkspace() {
  const summary = row('summary');
  const waiting = row('waiting-on');
  const section = summary.parentElement as HTMLElement;
  expect(waiting.parentElement).toBe(section);
  layout(section, 0, 400, 224, 180);
  layout(summary, 0, 30, 224, 32);
  layout(waiting, 0, 63, 224, 32);
  return { summary, waiting };
}

describe('the sidebar highlight glides to the page he picked', () => {
  it('W0 switched off (the FB4 default): no marker on a change, rows unmeasured, instant swap', async () => {
    expect(SIDEBAR_GLIDE.enabled).toBe(false);
    await mount();
    expect((row('summary') as LayoutNode).__reactLayoutHandler).toBeUndefined();
    go('/waiting-on');
    expect(q('sidebar-focus-marker')).toBeNull();
    expect(painted(row('waiting-on'))).toBe(true);
    expect(painted(row('summary'))).toBe(false);
  });

  it('W1 at rest: no marker; the active row paints its own fill', async () => {
    SIDEBAR_GLIDE.enabled = true;
    await mount();
    measureWorkspace();
    expect(q('sidebar-focus-marker')).toBeNull();
    expect(painted(row('summary'))).toBe(true);
    expect(painted(row('waiting-on'))).toBe(false);
  });

  it('W2 a change between two measured rows: one marker flies, the rows hold their fill, then the new row paints it', async () => {
    SIDEBAR_GLIDE.enabled = true;
    await mount();
    const { summary } = measureWorkspace();
    expect(painted(summary)).toBe(true);
    let finish: ((r: { finished: boolean }) => void) | null = null;
    const parallel = jest.spyOn(Animated, 'parallel').mockImplementation(() => ({
      start: (cb?: (r: { finished: boolean }) => void) => { finish = cb ?? null; },
      stop: () => {},
      reset: () => {},
    }) as unknown as Animated.CompositeAnimation);
    go('/waiting-on');
    expect(document.querySelectorAll('[data-testid="sidebar-focus-marker"]')).toHaveLength(1);
    expect(painted(row('summary'))).toBe(false);
    expect(painted(row('waiting-on'))).toBe(false);
    advance(120);
    expect(q('sidebar-focus-marker')).not.toBeNull();
    expect(painted(row('waiting-on'))).toBe(false);
    act(() => { finish?.({ finished: true }); });
    parallel.mockRestore();
    expect(q('sidebar-focus-marker')).toBeNull();
    expect(painted(row('waiting-on'))).toBe(true);
    expect(painted(row('summary'))).toBe(false);
  });

  it('W2b a change to a row that was never measured: the instant swap, no marker', async () => {
    SIDEBAR_GLIDE.enabled = true;
    await mount();
    measureWorkspace();
    go('/portfolio-margin');
    expect(q('sidebar-focus-marker')).toBeNull();
    expect(painted(row('margin-board'))).toBe(true);
  });

  it('W3 prefers-reduced-motion: reduce → no marker on a change (instant swap)', async () => {
    SIDEBAR_GLIDE.enabled = true;
    setReduce(true);
    await mount();
    measureWorkspace();
    go('/waiting-on');
    expect(q('sidebar-focus-marker')).toBeNull();
    expect(painted(row('waiting-on'))).toBe(true);
  });
});
