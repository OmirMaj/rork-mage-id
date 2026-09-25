/**
 * Smoothness pass, lane 2 — the shell's behaviour (not its look; the look is
 * pinned by w6c-shell-phone / desktop-page-frame goldens).
 *
 *   CreateMenu "+": no dead beat. A pushed destination navigates at once (and
 *   before the sheet closes); a `presentation: 'modal'` destination waits for
 *   the sheet to finish dismissing — the Modal's onDismiss on iOS, the 280 ms
 *   gap on Android/web — and runs exactly once either way.
 *
 *   AlertHost on desktop web: the answered alert stays DISPLAYED while its
 *   Modal fades out (visible=false), and a press on that fading copy does
 *   nothing. A phone unmounts on the press exactly as before, and a queued
 *   second alert replaces the first cleanly.
 */

import React from 'react';
import { Modal, Platform } from 'react-native';
import { act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CreateMenu } from '@/components/CreateMenu';
import AlertHost from '@/components/AlertHost';
import { showAlert } from '@/utils/alert';

type TestNode = {
  type: unknown;
  props: Record<string, unknown>;
  findAll(p: (n: TestNode) => boolean): TestNode[];
  findAllByType(t: unknown): TestNode[];
};
type TestRendererInstance = { toJSON(): unknown; unmount(): void; root: TestNode };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: { create(el: React.ReactElement): TestRendererInstance } = require('react-test-renderer');

jest.mock('@/contexts/ThemeContext', () => {
  const R = jest.requireActual('react');
  const actual = jest.requireActual('@/contexts/ThemeContext');
  const palette = jest.requireActual('@/constants/colors');
  const colors = { ...palette.Theme.light, ...palette.deriveAccentPalette(palette.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ...actual,
    ThemeProvider: ({ children }: { children: React.ReactNode }) => R.createElement(R.Fragment, null, children),
    useTheme: () => value,
  };
});

let mockProjects: { id: string; name: string; status: string }[] = [];
jest.mock('@/contexts/ProjectContext', () => {
  const actual = jest.requireActual('@/contexts/ProjectContext');
  return { ...actual, useProjects: () => ({ projects: mockProjects }) };
});

const mockLog: string[] = [];
const mockPush = jest.fn((to: unknown) => {
  mockLog.push(`push:${typeof to === 'string' ? to : (to as { pathname: string }).pathname}`);
});
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useRouter: () => ({ push: mockPush, replace: () => {}, back: () => {}, navigate: () => {}, canGoBack: () => false }),
  };
});
jest.mock('@/hooks/useTierAccess', () => {
  const actual = jest.requireActual('@/hooks/useTierAccess');
  return {
    ...actual,
    useTierAccess: () => ({
      tier: 'business', isProOrAbove: true, isBusinessOrAbove: true,
      canAccess: () => true, requiredTierFor: () => 'pro',
    }),
  };
});
let mockDesktopWeb = false;
jest.mock('@/components/ui/desktop', () => {
  const actual = jest.requireActual('@/components/ui/desktop');
  return { ...actual, useIsDesktopWeb: () => mockDesktopWeb };
});

// RN's jest Modal renders nothing at visible={false}; a real one (RN-web
// included) keeps its children on screen through the fade-out. This one keeps
// rendering them so the fading copy of an alert can be read and pressed.
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const R = jest.requireActual('react');
  function Modal(props: { children?: React.ReactNode }) {
    return R.createElement('Modal', props, props.children);
  }
  return { __esModule: true, default: Modal };
});

const mounted: TestRendererInstance[] = [];

let restoreOS: (() => void) | null = null;
function as(os: typeof Platform.OS) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockLog.length = 0;
  mockPush.mockClear();
  mockProjects = [];
  mockDesktopWeb = false;
});
afterEach(() => {
  // Unmount anything a failed test left behind: a mounted AlertHost keeps the
  // alert listener, and the next test's alerts would go to it.
  while (mounted.length) {
    const r = mounted.pop();
    try { act(() => { r?.unmount(); }); } catch { /* already unmounted */ }
  }
  restoreOS?.();
  restoreOS = null;
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function mount(el: React.ReactElement): TestRendererInstance {
  let r: TestRendererInstance | null = null;
  act(() => {
    r = TestRenderer.create(<SafeAreaProvider initialMetrics={METRICS}>{el}</SafeAreaProvider>);
  });
  mounted.push(r as unknown as TestRendererInstance);
  return r as unknown as TestRendererInstance;
}

function press(r: TestRendererInstance, testID: string) {
  const node = r.root.findAll((n) => n.props.testID === testID && typeof n.props.onPress === 'function')[0];
  if (!node) throw new Error(`no pressable ${testID}`);
  act(() => { (node.props.onPress as () => void)(); });
}

function modal(r: TestRendererInstance): TestNode {
  return r.root.findAllByType(Modal)[0];
}

function menu(onCreateProject?: () => void): TestRendererInstance {
  return mount(
    <CreateMenu
      visible
      onClose={() => { mockLog.push('close'); }}
      onCreateProject={onCreateProject}
    />,
  );
}

// ═══ CreateMenu ═════════════════════════════════════════════════════════════

describe('CreateMenu: no dead beat', () => {
  it('a pushed destination navigates at once, before the sheet closes (iOS)', () => {
    as('ios');
    const r = menu();
    press(r, 'create-lead');
    expect(mockLog).toEqual(['push:/leads', 'close']);
    act(() => { jest.advanceTimersByTime(1000); });
    expect(mockPush).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('a scoped pushed destination (one job) navigates at once with its project', () => {
    as('ios');
    mockProjects = [{ id: 'p1', name: 'Henderson', status: 'active' }];
    const r = menu();
    press(r, 'create-rfi');
    expect(mockLog).toEqual(['push:/rfi', 'close']);
    expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: '/rfi', params: { projectId: 'p1' } });
    r.unmount();
  });

  it('a modal destination waits for onDismiss on iOS, and runs exactly once', () => {
    as('ios');
    const r = menu();
    press(r, 'create-quick-quote');
    expect(mockLog).toEqual(['close']);
    act(() => { (modal(r).props.onDismiss as () => void)(); });
    expect(mockLog).toEqual(['close', 'push:/quick-quote']);
    // The iOS backstop timer finds nothing left to run.
    act(() => { jest.advanceTimersByTime(1000); });
    act(() => { (modal(r).props.onDismiss as () => void)(); });
    expect(mockPush).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it('a scoped modal destination (one job) waits for onDismiss with its project', () => {
    as('ios');
    mockProjects = [{ id: 'p1', name: 'Henderson', status: 'active' }];
    const r = menu();
    press(r, 'create-estimate');
    expect(mockPush).not.toHaveBeenCalled();
    act(() => { (modal(r).props.onDismiss as () => void)(); });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toMatchObject({ pathname: '/estimate-wizard', params: { projectId: 'p1' } });
    r.unmount();
  });

  it('a modal destination falls back to the 280 ms gap on Android (no onDismiss there)', () => {
    as('android');
    const r = menu();
    press(r, 'create-quick-quote');
    act(() => { jest.advanceTimersByTime(279); });
    expect(mockPush).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(1); });
    expect(mockLog).toEqual(['close', 'push:/quick-quote']);
    act(() => { (modal(r).props.onDismiss as () => void)(); });
    expect(mockPush).toHaveBeenCalledTimes(1);
    r.unmount();
  });

  it("the host's create-project Modal waits for the sheet to go too", () => {
    as('ios');
    const onCreate = jest.fn(() => { mockLog.push('create-project'); });
    const r = menu(onCreate);
    press(r, 'create-project');
    expect(onCreate).not.toHaveBeenCalled();
    act(() => { (modal(r).props.onDismiss as () => void)(); });
    expect(mockLog).toEqual(['close', 'create-project']);
    r.unmount();
  });

  it('the scrim fades on every platform — the sheet never slides', () => {
    as('ios');
    const r = menu();
    expect(modal(r).props.animationType).toBe('fade');
    r.unmount();
  });
});

// ═══ AlertHost ══════════════════════════════════════════════════════════════

function raise(title: string, onDelete: () => void) {
  const prev = Platform.OS;
  as('web');
  showAlert(title, 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onDelete },
  ]);
  as(prev);
}

const texts = (r: TestRendererInstance): string => JSON.stringify(r.toJSON());

describe('AlertHost: the confirm fades OUT on desktop web', () => {
  it('desktop web keeps the answered alert displayed (visible=false) and inert', () => {
    as('web');
    mockDesktopWeb = true;
    const onDelete = jest.fn();
    raise('Delete this RFI?', onDelete);
    const r = mount(<AlertHost />);
    expect(modal(r).props.visible).toBe(true);
    press(r, 'alert-btn-1');
    act(() => { jest.advanceTimersByTime(10); });
    expect(onDelete).toHaveBeenCalledTimes(1);
    // Still mounted, now fading out, content intact.
    expect(modal(r).props.visible).toBe(false);
    expect(texts(r)).toContain('Delete this RFI?');
    // A press on the fading copy does nothing; nor does the backdrop.
    press(r, 'alert-btn-1');
    act(() => { (modal(r).props.onRequestClose as () => void)(); });
    act(() => { jest.advanceTimersByTime(10); });
    expect(onDelete).toHaveBeenCalledTimes(1);
    act(() => { r.unmount(); });
  });

  it('a queued second alert replaces the first cleanly', () => {
    as('web');
    mockDesktopWeb = true;
    const first = jest.fn();
    const second = jest.fn();
    raise('First?', first);
    raise('Second?', second);
    const r = mount(<AlertHost />);
    press(r, 'alert-btn-1');
    act(() => { jest.advanceTimersByTime(10); });
    expect(first).toHaveBeenCalledTimes(1);
    expect(modal(r).props.visible).toBe(true);
    expect(texts(r)).toContain('Second?');
    expect(texts(r)).not.toContain('First?');
    press(r, 'alert-btn-1');
    act(() => { jest.advanceTimersByTime(10); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    act(() => { r.unmount(); });
  });

  it('a phone unmounts the alert on the press, exactly as before', () => {
    as('ios');
    mockDesktopWeb = false;
    const onDelete = jest.fn();
    raise('Delete this RFI?', onDelete);
    const r = mount(<AlertHost />);
    expect(modal(r).props.visible).toBe(true);
    press(r, 'alert-btn-1');
    act(() => { jest.advanceTimersByTime(10); });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(r.root.findAllByType(Modal)).toHaveLength(0);
    act(() => { r.unmount(); });
  });
});
