/**
 * Wave 6d, lane V1 — real-DOM proof for the 6c runtime key defects
 * (jsdom + react-dom + react-native-web at 1512 px, the stack app.mageid.app
 * runs). Every key below is dispatched on a real DOM node, so a key typed in a
 * field reaches the registry through the CAPTURE phase exactly as it does in
 * the browser (react-native-web's TextInput stops its bubbling).
 *
 *  F1 (C1) An Esc typed in ANY page field closed a page-scope SidePanel — on
 *          Schedule Pro that threw away the AI review. Now an Esc typed in a
 *          field OUTSIDE a panel belongs to that field, in every scope; an Esc
 *          typed in the panel's own field still closes it.
 *  F2 (C2) Esc on a date or voice picker opened inside the pane closed the
 *          whole pane. Both pickers are dialogs to the registry now.
 *  F3 (C3) GridPane's raw window listeners (Cmd+D duplicates, paste
 *          overwrites) ran behind an open dialog and on a hidden schedule.
 *          They read hotkeys.hasDialog() and the screen's focus now.
 *  F5 (C5) The pane's drag edge did nothing in Split view: resizable={false}
 *          renders no edge.
 *  r2      useResponsiveLayout re-rendered every consumer on every top-level
 *          navigation; it now re-renders only when the sidebar width or the
 *          saved rail pref changes.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-v1-keys.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

jest.mock('@/utils/alert', () => ({ ...jest.requireActual('@/utils/alert'), showAlert: jest.fn(), showPrompt: jest.fn() }));

import { ThemeProvider } from '@/contexts/ThemeContext';
import { SidePanel } from '@/components/desktop/SidePanel';
import DatePickerModal from '@/components/DatePickerModal';
import VoiceCaptureModal from '@/components/VoiceCaptureModal';
import GridPane from '@/components/schedule/GridPane';
import { useSheetDialogScope } from '@/components/ui/Sheet';
import { hotkeys } from '@/hooks/useHotkeys';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { SIDEBAR_RAIL_KEY } from '@/utils/sidebarRail';
import { __resetSidebarRailForTests, setSidebarRoute, toggleSidebarRail } from '@/utils/sidebarRailStore';
import type { ScheduleTask } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const METRICS = { frame: { x: 0, y: 0, width: 1512, height: 945 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const roots: { root: Root; el: HTMLElement }[] = [];

/** Let timers run, then fire animationend: jsdom never runs CSS animations,
 *  and RN-web's Modal only closes on Escape once its open animation ended. */
async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  await act(async () => {
    for (const n of Array.from(document.body.querySelectorAll('div'))) {
      n.dispatchEvent(new Event('animationend', { bubbles: true }));
    }
  });
}
async function mount(node: React.ReactElement): Promise<Root> {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => {
    root.render(<SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{node}</ThemeProvider></SafeAreaProvider>);
  });
  await settle();
  return root;
}
afterEach(async () => {
  for (const { root, el } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    el.remove();
  }
});

/** A full key press: keydown then keyup (RN-web's Modal closes on keyup). */
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

// ── F1: an Esc typed in a field OUTSIDE a panel belongs to that field ──────

function PanelBesidePage({ onClose, scope, nativeID, panelId }: {
  onClose: () => void; scope: 'page' | 'global'; nativeID?: string; panelId?: string;
}) {
  return (
    <View style={{ flexDirection: 'row' }}>
      <TextInput testID="page-field" />
      <SidePanel open onClose={onClose} title="Assistant" hotkeyScope={scope} nativeID={nativeID} panelId={panelId} testID="panel">
        <TextInput testID="panel-field" />
      </SidePanel>
    </View>
  );
}

describe.each([
  ['page-scope panel with a panelId', { scope: 'page' as const, panelId: 'p' }],
  ['page-scope panel with neither nativeID nor panelId (the Schedule Pro pane)', { scope: 'page' as const }],
  ['global-scope panel (no nativeID)', { scope: 'global' as const }],
])('F1 — %s', (_name, props) => {
  it('an Esc typed in a page field OUTSIDE the panel does not close it', async () => {
    const onClose = jest.fn();
    await mount(<PanelBesidePage onClose={onClose} {...props} />);
    const down = await press(byTestId('page-field'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(down.defaultPrevented).toBe(false);
  });
  it("an Esc typed in the panel's OWN field closes it", async () => {
    const onClose = jest.fn();
    await mount(<PanelBesidePage onClose={onClose} {...props} />);
    await press(byTestId('panel-field'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('an Esc typed outside any field closes it', async () => {
    const onClose = jest.fn();
    await mount(<PanelBesidePage onClose={onClose} {...props} />);
    await press(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it('F1 — every desktop panel carries a DOM id: nativeID, else side-panel-<panelId>, else side-panel-<n>', async () => {
  await mount(
    <View>
      <SidePanel open onClose={() => {}} title="A" nativeID="mage-shell-dock" testID="pa"><Text>a</Text></SidePanel>
      <SidePanel open onClose={() => {}} title="B" panelId="b" testID="pb"><Text>b</Text></SidePanel>
      <SidePanel open onClose={() => {}} title="C" testID="pc"><Text>c</Text></SidePanel>
    </View>,
  );
  expect(byTestId('pa').id).toBe('mage-shell-dock');
  expect(byTestId('pb').id).toBe('side-panel-b');
  expect(byTestId('pc').id).toMatch(/^side-panel-\d+$/);
});

// ── F2: a picker opened inside the pane is a dialog ────────────────────────

describe('F2 — Esc on a picker inside an open SidePanel closes only the picker', () => {
  it('DatePickerModal: the panel stays open; with the picker shut, the same Esc closes the panel', async () => {
    const panelClose = jest.fn();
    const pickerClose = jest.fn();
    function Host({ picker }: { picker: boolean }) {
      return (
        <SidePanel open onClose={panelClose} title="Assistant" testID="panel">
          <DatePickerModal visible={picker} value="2026-09-15" onClose={pickerClose} onChange={() => {}} allowFuture />
        </SidePanel>
      );
    }
    const root = await mount(<Host picker />);
    await press(document.body, { key: 'Escape' });
    expect(panelClose).not.toHaveBeenCalled();
    // The control: the picker closed, the panel's Esc is live again.
    await act(async () => {
      root.render(<SafeAreaProvider initialMetrics={METRICS}><ThemeProvider><Host picker={false} /></ThemeProvider></SafeAreaProvider>);
    });
    await settle();
    await press(document.body, { key: 'Escape' });
    expect(panelClose).toHaveBeenCalledTimes(1);
  });

  it('VoiceCaptureModal: the panel stays open', async () => {
    const panelClose = jest.fn();
    await mount(
      <SidePanel open onClose={panelClose} title="Assistant" testID="panel">
        <VoiceCaptureModal visible onClose={() => {}} onTranscriptReady={() => {}} title="Describe the change" />
      </SidePanel>,
    );
    expect(hotkeys.hasDialog()).toBe(true);
    await press(document.body, { key: 'Escape' });
    expect(panelClose).not.toHaveBeenCalled();
  });
});

// ── F3: hasDialog(), and GridPane's raw listeners behind a dialog ──────────

function Dialog({ open }: { open: boolean }) {
  useSheetDialogScope(open);
  return null;
}

it('F3 — registry.hasDialog() is false, true, false as a dialog binding mounts and unmounts', async () => {
  expect(hotkeys.hasDialog()).toBe(false);
  const root = await mount(<Dialog open />);
  expect(hotkeys.hasDialog()).toBe(true);
  await act(async () => { root.unmount(); });
  roots.splice(roots.findIndex((r) => r.root === root), 1);
  expect(hotkeys.hasDialog()).toBe(false);
});

const task = (id: string, title: string, startDay: number): ScheduleTask => ({
  id, title, phase: 'Framing', durationDays: 3, startDay, progress: 0, crew: '', dependencies: [], notes: '', status: 'not_started',
});

function paste(text: string): Event {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
  return ev;
}

describe('F3 — GridPane keys and paste do nothing while a dialog is open', () => {
  function Grid({ dialog, onDup, onEdit }: { dialog: boolean; onDup: (ids: string[]) => void; onEdit: (id: string, p: Partial<ScheduleTask>) => void }) {
    return (
      <View style={{ width: 1200, height: 600 }}>
        <GridPane
          tasks={[task('t1', 'Frame walls', 1), task('t2', 'Drywall', 4)]}
          projectStartDate={new Date(2026, 8, 14)}
          workingDaysPerWeek={5}
          onEdit={onEdit}
          onAddTask={() => {}}
          onDeleteTask={() => {}}
          selectedIds={new Set(['t1', 't2'])}
          onSelectionChange={() => {}}
          onBulkDuplicate={onDup}
        />
        <Dialog open={dialog} />
      </View>
    );
  }
  const wrap = (n: React.ReactNode) => <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{n}</ThemeProvider></SafeAreaProvider>;

  it('Cmd+D and a TSV paste are ignored behind the dialog, and work again once it closes', async () => {
    const onDup = jest.fn();
    const onEdit = jest.fn();
    const root = await mount(<Grid dialog onDup={onDup} onEdit={onEdit} />);
    expect(hotkeys.hasDialog()).toBe(true);
    const dup = await press(document.body, { key: 'd', metaKey: true });
    const p1 = paste('Renamed\t5');
    await act(async () => { document.body.dispatchEvent(p1); });
    expect(onDup).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
    expect(dup.defaultPrevented).toBe(false); // the browser keeps its Cmd+D
    expect(p1.defaultPrevented).toBe(false);

    // The control: the dialog closes, the same keys reach the grid.
    await act(async () => { root.render(wrap(<Grid dialog={false} onDup={onDup} onEdit={onEdit} />)); });
    await settle();
    expect(hotkeys.hasDialog()).toBe(false);
    await press(document.body, { key: 'd', metaKey: true });
    expect(onDup).toHaveBeenCalledWith(['t1', 't2']);
    await act(async () => { document.body.dispatchEvent(paste('Renamed\t5')); });
    expect(onEdit).toHaveBeenCalled();
  });
});

// ── F5: a fixed-width pane has no drag edge ────────────────────────────────

it('F5 — resizable={false} renders no -edge; the default still does', async () => {
  await mount(
    <View>
      <SidePanel open onClose={() => {}} title="Fixed" resizable={false} defaultWidth={440} testID="fixed"><Text>f</Text></SidePanel>
      <SidePanel open onClose={() => {}} title="Drag" testID="drag"><Text>d</Text></SidePanel>
    </View>,
  );
  expect(document.querySelector('[data-testid="fixed-edge"]')).toBeNull();
  expect(document.querySelector('[data-testid="drag-edge"]')).not.toBeNull();
});

// ── r2: layout re-renders only when the sidebar width or the pref changes ──

describe('r2 — useResponsiveLayout re-renders on a width or pref change, never on a bare navigation', () => {
  let renders = 0;
  function Probe() {
    const l = useResponsiveLayout();
    renders++;
    return <Text testID="probe">{`${l.isDesktop ? 'desktop' : 'small'}:${l.sidebarWidth}`}</Text>;
  }
  const flush = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
  beforeEach(async () => {
    await AsyncStorage.removeItem(SIDEBAR_RAIL_KEY);
    __resetSidebarRailForTests();
    renders = 0;
  });
  afterAll(() => { __resetSidebarRailForTests(); });

  it("'rfi' then 'submittal' (both 240) adds no render; 'schedule-pro' (64) adds one", async () => {
    await mount(<Probe />);
    await flush();
    const base = renders;
    expect(byTestId('probe').textContent).toBe('desktop:240');
    await act(async () => { setSidebarRoute('rfi'); });
    await flush();
    await act(async () => { setSidebarRoute('submittal'); });
    await flush();
    expect(renders).toBe(base);
    await act(async () => { setSidebarRoute('schedule-pro'); });
    await flush();
    expect(renders).toBe(base + 1);
    expect(byTestId('probe').textContent).toBe('desktop:64');
  });

  it('toggleSidebarRail() adds one', async () => {
    await mount(<Probe />);
    await act(async () => { setSidebarRoute('rfi'); });
    await flush();
    const base = renders;
    await act(async () => { toggleSidebarRail(); });
    await flush();
    expect(renders).toBe(base + 1);
    expect(byTestId('probe').textContent).toBe('desktop:64');
  });

  it("a saved pref { canvas: false, workspace: false } loading while on 'rfi' adds one (same width, new canvas bit)", async () => {
    await AsyncStorage.setItem(SIDEBAR_RAIL_KEY, JSON.stringify({ canvas: false, workspace: false }));
    await mount(<Probe />);
    await flush();
    const base = renders;
    // The first setSidebarRoute starts the load; the route change itself
    // keeps the width (240 → 240) and renders nobody.
    await act(async () => { setSidebarRoute('rfi'); });
    await flush();
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    await flush();
    expect(renders).toBe(base + 1);
    expect(byTestId('probe').textContent).toBe('desktop:240');
  });
});
