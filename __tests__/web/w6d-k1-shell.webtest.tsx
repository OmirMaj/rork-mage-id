/**
 * Wave 6d restore, d6r lane K1 — the Ask dock, the dock API it stands on and
 * the keyboard shell, on real DOM nodes (jsdom + react-dom +
 * react-native-web at 1512 px, the stack app.mageid.app runs).
 *
 *   • keepMounted: Cmd+J hides the dock WITHOUT unmounting it — a half-typed
 *     value in a docked field survives the round trip;
 *   • suppressId hides a matching dock (the /ask page suppresses the Ask dock)
 *     and keeps it mounted;
 *   • S4: on a canvas route the dock floats over the canvas's right edge; on
 *     /rfi (a 1272 column) it docks beside the page;
 *   • Cmd+J on an EMPTY dock opens Ask; with content it hides / shows it;
 *   • the g-chords route through the sidebar's rules ('g' 'r' → /rfi?projectId)
 *     and a 'g' that meets no chord falls through to the page's own 'j';
 *   • '?' opens the Keyboard shortcuts sheet (with its 'Go To' group), and a
 *     '?' typed in a field is the field's;
 *   • Enter in the dock's composer sends, Shift+Enter does not (the REAL
 *     AskConversation, its data hooks stood in);
 *   • r3 — the dock is honest about where it can show: on a shell-exempt
 *     route (host visible=false) or under suppression `showing` is false,
 *     Cmd+J cannot flip an invisible dock, and openAsk() falls back to the
 *     /ask page; the attention dock under the Ask suppression still shows and
 *     Cmd+J still hides it.
 *
 * The root mount (SearchHotkeyListener → <ShellHotkeys />, ShellDockHost's
 * suppressId) is the orchestrator's handoff; this file mounts the pieces
 * directly.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-k1-shell.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

// ── Router: a push spy and a settable top segment ──────────────────────────
const mockRouter = { navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), setParams: jest.fn(), back: jest.fn(), canGoBack: () => false };
let mockSegments: string[] = ['rfi'];
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, useRouter: () => mockRouter, useSegments: () => mockSegments };
});

// ── The shell's data (ShellHotkeys) ────────────────────────────────────────
let mockActiveProjectId: string | null = 'p1';
jest.mock('@/contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({ activeProjectId: mockActiveProjectId, activeProject: null, setActiveProject: () => {}, recentProjectIds: [] }),
}));
jest.mock('@/hooks/useProjectAccess', () => ({ useProjectAccess: () => ({ canAccess: () => false }) }));
jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));

// ── AskConversation: a stub with a field, or the REAL one for the Enter case ─
let mockRealAsk = false;
jest.mock('@/components/brain/AskConversation', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  function StubAsk() {
    return R.createElement(RN.View, { testID: 'ask-stub' },
      R.createElement(RN.Text, null, 'Ask MAGE body'),
      R.createElement(RN.TextInput, { testID: 'ask-stub-input' }));
  }
  return {
    AskConversation: (p: Record<string, unknown>) => (mockRealAsk
      ? R.createElement(jest.requireActual('@/components/brain/AskConversation').AskConversation, p)
      : R.createElement(StubAsk)),
  };
});
// The real AskConversation's data — empty, loaded, a Pro seat. askOneMind is
// the spy the Enter case reads.
const mockAskOneMind = jest.fn(async () => ({ answer: 'Two RFIs are late.', citations: [], usedAI: false }));
jest.mock('@/utils/oneMind/answer', () => ({ askOneMind: (...a: unknown[]) => (mockAskOneMind as unknown as (...x: unknown[]) => unknown)(...a) }));
jest.mock('@/utils/aiRateLimiter', () => ({
  checkAILimit: async () => ({ allowed: true }),
  recordAIUsage: async () => {},
  nextAiResetLabel: () => ({ daily: 'Resets at midnight UTC' }),
}));
jest.mock('@/utils/askHistory', () => ({ loadAskThreads: async () => [], saveAskThread: async () => [] }));
jest.mock('@/hooks/useLastPlanner', () => ({ loadAllConstraints: async () => ({}) }));
jest.mock('@/contexts/SearchContext', () => ({ useSearch: () => ({ openSearch: jest.fn() }) }));
jest.mock('@/contexts/ProjectContext', () => ({
  useCoreData: () => ({ userRole: 'contractor', projects: [] }),
  useProjects: () => ({
    projects: [], invoices: [], leads: [], changeOrders: [], rfis: [], commitments: [], dailyReports: [], permits: [],
    submittals: [], punchItems: [], aiaPayApps: [], equipment: [], subcontractors: [], projectsLoaded: true,
  }),
}));
jest.mock('@/contexts/SafetyContext', () => ({ useSafety: () => ({ expiringCertifications: () => [] }) }));
jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => ({ tier: 'pro' }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/hooks/useBidResponsesPortfolio', () => ({ useBidResponsesPortfolio: () => ({ bidResponses: [] }) }));
jest.mock('@/hooks/useMaterialReceipts', () => ({ useMaterialReceipts: () => ({ receipts: [] }) }));
jest.mock('@/hooks/useLaborRates', () => ({
  useLaborCostSamples: () => [],
  useTimeEntriesMirror: () => [],
  useLaborRates: () => ({ rates: [], overtimeMultiplier: 1.5, overtimeRule: 'daily8' }),
}));
jest.mock('@/components/VoiceCaptureModal', () => () => null);
jest.mock('@/components/RFITriageModal', () => () => null);

import { ThemeProvider } from '@/contexts/ThemeContext';
import { ShellDockProvider, ShellDockHost, useShellDock, ASK_DOCK_ID, ATTENTION_DOCK_ID } from '@/components/desktop/ShellDock';
import { ShellHotkeys } from '@/components/desktop/ShellHotkeys';
import { closeShortcutSheet } from '@/components/desktop/ShortcutSheet';
import { useAskDock } from '@/hooks/useAskDock';
import { useHotkeys } from '@/hooks/useHotkeys';
import { AskConversation } from '@/components/brain/AskConversation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const METRICS = { frame: { x: 0, y: 0, width: 1512, height: 945 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const roots: { root: Root; el: HTMLElement }[] = [];

async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  await act(async () => {
    for (const n of Array.from(document.body.querySelectorAll('div'))) {
      n.dispatchEvent(new Event('animationend', { bubbles: true }));
    }
  });
}
async function mount(node: React.ReactElement): Promise<void> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  const qc = new QueryClient();
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{node}</ThemeProvider></SafeAreaProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
}
beforeEach(() => {
  mockRouter.push.mockClear();
  mockAskOneMind.mockClear();
  mockSegments = ['rfi'];
  mockActiveProjectId = 'p1';
  mockRealAsk = false;
});
afterEach(async () => {
  await act(async () => { closeShortcutSheet(); });
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
});

async function press(target: EventTarget, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(down); });
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init })); });
  return down;
}
function byTestId(id: string): HTMLElement {
  const n = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  if (!n) throw new Error(`no element with testID ${id}`);
  return n;
}
function blurAll(): void { (document.activeElement as HTMLElement | null)?.blur?.(); }
/** The dock is on screen: its DOM id is present (a hidden keepMounted panel drops it). */
const dockShown = () => !!document.querySelector('#mage-shell-dock');
/** Type into a react-native-web TextInput (a controlled React input). */
async function typeInto(el: HTMLElement, value: string): Promise<void> {
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function hiddenByDisplay(el: HTMLElement | null): boolean {
  for (let p = el; p; p = p.parentElement) if (getComputedStyle(p).display === 'none') return true;
  return false;
}

// ── Harness pieces ─────────────────────────────────────────────────────────

/** Docks `node` under `id` on mount (a DockOpener, like a screen would). */
function DockOpener({ node, id }: { node: React.ReactNode; id?: string }) {
  const dock = useShellDock();
  React.useEffect(() => { dock.open(node, { title: id === ATTENTION_DOCK_ID ? 'Action Required' : 'Ask MAGE', id }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
/** Reads the dock API into the DOM, and offers openAsk() on a button. */
function Probe() {
  const dock = useShellDock();
  const { openAsk } = useAskDock();
  return (
    <View>
      <Text testID="probe">{JSON.stringify({ showing: dock.showing, hidden: dock.hidden, canShowAsk: dock.canShow(ASK_DOCK_ID), id: dock.id })}</Text>
      <Pressable testID="probe-open-ask" accessibilityRole="button" onPress={() => openAsk({ screen: 'rfi', projectId: 'p1' })}><Text>ask</Text></Pressable>
    </View>
  );
}
const probe = (): { showing: boolean; hidden: boolean; canShowAsk: boolean; id: string | null } => JSON.parse(byTestId('probe').textContent ?? '{}');

function Field() {
  const [v, setV] = React.useState('');
  return <TextInput testID="dock-field" value={v} onChangeText={setV} />;
}

function shell(opts: { visible?: boolean; suppressId?: string | null; children?: React.ReactNode } = {}) {
  return (
    <ShellDockProvider>
      <View style={{ flexDirection: 'row' }}>
        <View style={{ flex: 1 }}>{opts.children}<Probe /></View>
        <ShellDockHost visible={opts.visible ?? true} suppressId={opts.suppressId ?? null} />
      </View>
      <ShellHotkeys />
    </ShellDockProvider>
  );
}

// ── 1. keepMounted / suppressId / S4 ────────────────────────────────────────

describe('the dock keeps its content mounted', () => {
  it('Cmd+J hides it without unmounting: a half-typed value survives the show', async () => {
    await mount(shell({ children: <DockOpener node={<Field />} id={ASK_DOCK_ID} /> }));
    expect(dockShown()).toBe(true);
    await typeInto(byTestId('dock-field'), 'which RFIs are late');
    blurAll();
    await press(document.body, { key: 'j', metaKey: true });
    expect(dockShown()).toBe(false);
    // Still mounted — display none, same node.
    const kept = byTestId('dock-field') as HTMLInputElement;
    expect(hiddenByDisplay(kept)).toBe(true);
    expect(probe().hidden).toBe(true);
    await press(document.body, { key: 'j', ctrlKey: true });
    expect(dockShown()).toBe(true);
    expect((byTestId('dock-field') as HTMLInputElement).value).toBe('which RFIs are late');
    expect(hiddenByDisplay(byTestId('dock-field'))).toBe(false);
  });

  it('suppressId hides a matching dock and keeps it mounted', async () => {
    await mount(shell({ suppressId: ASK_DOCK_ID, children: <DockOpener node={<Field />} id={ASK_DOCK_ID} /> }));
    expect(dockShown()).toBe(false);
    expect(hiddenByDisplay(byTestId('dock-field'))).toBe(true);
    expect(probe().showing).toBe(false);
  });

  it('S4: on a canvas route the dock overlays; on /rfi (a 1272 column) it docks', async () => {
    mockSegments = ['schedule-pro'];
    await mount(shell({ children: <DockOpener node={<Text>docked</Text>} id={ASK_DOCK_ID} /> }));
    expect(getComputedStyle(document.querySelector('#mage-shell-dock') as HTMLElement).position).toBe('absolute');
    for (const { root, el } of roots.splice(0)) { await act(async () => { root.unmount(); }); el.remove(); }

    mockSegments = ['rfi'];
    await mount(shell({ children: <DockOpener node={<Text>docked</Text>} id={ASK_DOCK_ID} /> }));
    expect(getComputedStyle(document.querySelector('#mage-shell-dock') as HTMLElement).position).not.toBe('absolute');
  });
});

// ── 2. Cmd+J ────────────────────────────────────────────────────────────────

describe('Cmd/Ctrl+J', () => {
  it('on an EMPTY dock opens Ask', async () => {
    await mount(shell());
    expect(dockShown()).toBe(false);
    blurAll();
    await press(document.body, { key: 'j', metaKey: true });
    expect(dockShown()).toBe(true);
    expect(byTestId('ask-stub')).toBeTruthy();
    expect(probe().id).toBe(ASK_DOCK_ID);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it('with content hides it and brings the same content back', async () => {
    await mount(shell({ children: <DockOpener node={<Text>Ask MAGE body</Text>} id={ASK_DOCK_ID} /> }));
    blurAll();
    await press(document.body, { key: 'j', metaKey: true });
    expect(dockShown()).toBe(false);
    await press(document.body, { key: 'j', metaKey: true });
    expect(dockShown()).toBe(true);
    expect(document.body.textContent).toContain('Ask MAGE body');
  });
});

// ── 3. g-chords and '?' ─────────────────────────────────────────────────────

describe('the keyboard shell', () => {
  it("'g' then 'r' opens the active job's RFIs", async () => {
    await mount(shell());
    blurAll();
    await press(document.body, { key: 'g' });
    await press(document.body, { key: 'r' });
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/rfi', params: { projectId: 'p1' } });
  });

  it("'g' then 'j' falls through to the page's own 'j' (no 'g j' chord)", async () => {
    const nextRow = jest.fn();
    function Table() {
      useHotkeys([{ combo: 'j', handler: nextRow, label: 'Next Row', group: 'Table' }], { scope: 'page' });
      return null;
    }
    await mount(shell({ children: <Table /> }));
    blurAll();
    await press(document.body, { key: 'g' });
    await press(document.body, { key: 'j' });
    expect(nextRow).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("'?' opens 'Keyboard shortcuts' with its App and 'Go to' groups", async () => {
    await mount(shell());
    blurAll();
    await press(document.body, { key: '?', shiftKey: true });
    await settle();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Keyboard Shortcuts');
    expect(document.querySelector('[data-testid="shortcut-group-Go to"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="shortcut-group-App"]')).not.toBeNull();
    expect(text).toContain('G then R');
    expect(text).toContain('Ask MAGE');
  });

  it("'?' typed in a field is the field's", async () => {
    await mount(shell({ children: <TextInput testID="page-field" /> }));
    const field = byTestId('page-field');
    await act(async () => { field.focus(); });
    await press(field, { key: '?', shiftKey: true });
    await settle();
    expect(document.body.textContent ?? '').not.toContain('Keyboard Shortcuts');
  });
});

// ── 4. The dock's composer (the REAL AskConversation) ──────────────────────

describe('Ask in the dock', () => {
  it('Enter sends; Shift+Enter keeps the newline', async () => {
    mockRealAsk = true;
    await mount(<ShellDockProvider><AskConversation variant="panel" /></ShellDockProvider>);
    const input = byTestId('ask-input');
    await typeInto(input, 'Which RFIs are late?');
    await press(input, { key: 'Enter', shiftKey: true });
    expect(mockAskOneMind).not.toHaveBeenCalled();
    const down = await press(input, { key: 'Enter' });
    await settle();
    expect(down.defaultPrevented).toBe(true);
    expect(mockAskOneMind).toHaveBeenCalledTimes(1);
    expect((mockAskOneMind.mock.calls[0] as unknown[])[0]).toBe('Which RFIs are late?');
    expect(document.body.textContent).toContain('Two RFIs are late.');
  });
});

// ── 5. r3 — the dock is honest about where it can show ─────────────────────

describe('r3: showing / canShow', () => {
  it('a shell-exempt route (host visible=false): not showing, Cmd+J inert, openAsk falls back to /ask', async () => {
    await mount(shell({ visible: false, children: <DockOpener node={<Field />} id={ASK_DOCK_ID} /> }));
    expect(probe()).toMatchObject({ showing: false, hidden: false, canShowAsk: false });
    expect(dockShown()).toBe(false);
    blurAll();
    await press(document.body, { key: 'j', metaKey: true });
    expect(probe().hidden).toBe(false);
    await act(async () => { byTestId('probe-open-ask').click(); });
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/ask', params: { projectId: 'p1', screen: 'rfi' } });
  });

  it('the Ask dock under suppressId ask: not showing, Cmd+J leaves hidden alone', async () => {
    await mount(shell({ suppressId: ASK_DOCK_ID, children: <DockOpener node={<Field />} id={ASK_DOCK_ID} /> }));
    expect(probe()).toMatchObject({ showing: false, hidden: false, canShowAsk: false });
    blurAll();
    await press(document.body, { key: 'j', metaKey: true });
    expect(probe().hidden).toBe(false);
  });

  it('the attention dock under suppressId ask: showing, and Cmd+J hides it', async () => {
    await mount(shell({ suppressId: ASK_DOCK_ID, children: <DockOpener node={<Text>list</Text>} id={ATTENTION_DOCK_ID} /> }));
    expect(probe()).toMatchObject({ showing: true, hidden: false });
    expect(dockShown()).toBe(true);
    blurAll();
    await press(document.body, { key: 'j', metaKey: true });
    expect(probe()).toMatchObject({ showing: false, hidden: true });
    expect(dockShown()).toBe(false);
  });

  it('a plain visible host: Cmd+J toggles as before, and openAsk docks instead of pushing', async () => {
    await mount(shell({ children: <DockOpener node={<Text>Ask MAGE body</Text>} id={ASK_DOCK_ID} /> }));
    expect(probe()).toMatchObject({ showing: true, canShowAsk: true });
    blurAll();
    await press(document.body, { key: 'j', metaKey: true });
    expect(probe()).toMatchObject({ showing: false, hidden: true });
    // openAsk on a hidden Ask dock shows it again (no push).
    await act(async () => { byTestId('probe-open-ask').click(); });
    expect(probe()).toMatchObject({ showing: true, hidden: false });
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});
