/**
 * Real-DOM proof that a dialog owns the keyboard while it is open — jsdom +
 * react-dom + react-native-web at 1512 px, the stack app.mageid.app runs.
 *
 * WHY (wave-6b integration review, 2026-09-23). Three keyboard systems were
 * built in parallel and never met:
 *   • <Sheet> ran Cmd/Ctrl+Enter from a `document` keydown listener in the
 *     bubble phase. react-native-web's TextInput stops keydown propagation,
 *     and <Sheet> focuses its first field on open — so the shortcut never
 *     fired in the normal case.
 *   • Nothing registered the shortcut registry's exclusive `dialog` scope, so
 *     with a Sheet open, Cmd+Enter typed in it ran the PAGE's Save, and the
 *     Esc that closed it also closed the SplitView record behind it. The ⋯
 *     menu (ToolbarActions) and the job switcher had the same gap.
 *   • The shell dock closed on a raw window listener: one Esc closed a sheet
 *     AND the dock, and an Esc typed in the dock's own field did nothing.
 * Every assertion below types or clicks on a real DOM node.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js
 */

import React, { act } from 'react';
import { Dimensions, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

jest.mock('@/utils/alert', () => ({ showAlert: jest.fn(), showPrompt: jest.fn() }));
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), setParams: jest.fn(), back: jest.fn() }) };
});
// The job switcher reads the project list and the job context; neither
// matters to the key it must not leak.
jest.mock('@/contexts/ProjectContext', () => ({ useCoreData: () => ({ projects: [] }) }));
jest.mock('@/contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({ activeProjectId: null, activeProject: null, setActiveProject: () => {}, recentProjectIds: [] }),
}));

import { ThemeProvider } from '@/contexts/ThemeContext';
import { Sheet, useSheetFrame } from '@/components/ui/Sheet';
import { useHotkeys, usePrimaryAction } from '@/hooks/useHotkeys';
import { ShellDockProvider, ShellDockHost, useShellDock } from '@/components/desktop/ShellDock';
import { ToolbarActions } from '@/components/desktop/ToolbarActions';
import { JobSwitcher } from '@/components/desktop/JobSwitcher';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const METRICS = { frame: { x: 0, y: 0, width: 1512, height: 945 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const roots: { root: Root; el: HTMLElement }[] = [];

/** Let timers run (Sheet's 30 ms first-field focus), then fire animationend:
 *  jsdom never runs CSS animations, and RN-web's Modal only closes on Escape
 *  once its open animation has ended — a real browser fires it after the fade. */
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
  await act(async () => {
    root.render(<SafeAreaProvider initialMetrics={METRICS}><ThemeProvider>{node}</ThemeProvider></SafeAreaProvider>);
  });
  await settle();
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
function blurAll(): void {
  (document.activeElement as HTMLElement | null)?.blur?.();
}
const dockShown = () => !!document.querySelector('#mage-shell-dock');

// ── 1. <Sheet> ─────────────────────────────────────────────────────────────

describe('<Sheet> Cmd/Ctrl+Enter', () => {
  it('fires from INSIDE the field the sheet focuses on open, and from the body', async () => {
    const save = jest.fn();
    await mount(
      <Sheet visible onClose={() => {}} title="Edit" primaryAction={{ label: 'Save', onPress: save }}>
        <TextInput testID="sheet-field" />
      </Sheet>,
    );
    const input = byTestId('sheet-field');
    expect(document.activeElement).toBe(input);
    const inField = await press(input, { key: 'Enter', metaKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(inField.defaultPrevented).toBe(true);
    await press(document.body, { key: 'Enter', ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('a disabled primary does not run, and plain Enter in the field is the field\'s', async () => {
    const save = jest.fn();
    await mount(
      <Sheet visible onClose={() => {}} title="Edit" primaryAction={{ label: 'Save', onPress: save, disabled: true, disabledReason: 'Add a title first.' }}>
        <TextInput testID="sheet-field" />
      </Sheet>,
    );
    await press(byTestId('sheet-field'), { key: 'Enter', metaKey: true });
    await press(byTestId('sheet-field'), { key: 'Enter' });
    expect(save).not.toHaveBeenCalled();
  });
});

function PageWithSheet({ pageSave, pageEsc, sheetSave, sheetClose }: {
  pageSave: () => void; pageEsc: () => void; sheetSave: () => void; sheetClose: () => void;
}) {
  // Exactly the bindings a register screen has behind a sheet: its primary
  // action and SplitView's record-close Esc (page scope).
  usePrimaryAction(pageSave, { label: 'Save invoice' });
  useHotkeys([{ combo: 'escape', handler: pageEsc, label: 'Close record' }], { scope: 'page' });
  return (
    <View>
      <Text>page</Text>
      <Sheet visible onClose={sheetClose} title="Add line" primaryAction={{ label: 'Add', onPress: sheetSave }}>
        <TextInput testID="sheet-field" />
      </Sheet>
    </View>
  );
}

describe('an open <Sheet> is a dialog: the page behind it hears nothing', () => {
  const fns = () => ({ pageSave: jest.fn(), pageEsc: jest.fn(), sheetSave: jest.fn(), sheetClose: jest.fn() });

  it('Cmd+Enter typed in the sheet runs the SHEET action only', async () => {
    const f = fns();
    await mount(<PageWithSheet {...f} />);
    await press(byTestId('sheet-field'), { key: 'Enter', metaKey: true });
    expect(f.sheetSave).toHaveBeenCalledTimes(1);
    expect(f.pageSave).toHaveBeenCalledTimes(0);
  });

  it('Esc typed in the sheet closes the sheet, never the record behind it', async () => {
    const f = fns();
    await mount(<PageWithSheet {...f} />);
    await press(byTestId('sheet-field'), { key: 'Escape' });
    expect(f.sheetClose).toHaveBeenCalledTimes(1);
    expect(f.pageEsc).toHaveBeenCalledTimes(0);
  });

  it('Esc with focus on the body closes the sheet only', async () => {
    const f = fns();
    await mount(<PageWithSheet {...f} />);
    blurAll();
    await press(document.body, { key: 'Escape' });
    expect(f.sheetClose).toHaveBeenCalledTimes(1);
    expect(f.pageEsc).toHaveBeenCalledTimes(0);
  });

  it('control: with the sheet closed, the page keys work again', async () => {
    const f = fns();
    function Closed() {
      usePrimaryAction(f.pageSave, { label: 'Save invoice' });
      useHotkeys([{ combo: 'escape', handler: f.pageEsc }], { scope: 'page' });
      return <Sheet visible={false} onClose={f.sheetClose} primaryAction={{ label: 'Add', onPress: f.sheetSave }}><Text>x</Text></Sheet>;
    }
    await mount(<Closed />);
    await press(document.body, { key: 'Enter', metaKey: true });
    await press(document.body, { key: 'Escape' });
    expect(f.pageSave).toHaveBeenCalledTimes(1);
    expect(f.pageEsc).toHaveBeenCalledTimes(1);
    expect(f.sheetSave).toHaveBeenCalledTimes(0);
  });
});

/** One of the ~130 hand-rolled sheets after wave 6c's one-line adoption:
 *  its own Modal, with useSheetFrame's styles appended — no <Sheet>, no
 *  primary action. `passVisible` false = a caller that forgot `visible`. */
function HandRolledOverPage({ pageEsc, sheetClose, visible, passVisible = true }: {
  pageEsc: () => void; sheetClose: () => void; visible: boolean; passVisible?: boolean;
}) {
  useHotkeys([{ combo: 'escape', handler: pageEsc, label: 'Close record' }], { scope: 'page' });
  const f = useSheetFrame('form', passVisible ? { visible, animationType: 'slide' } : { animationType: 'slide' });
  return (
    <View>
      <Text>page</Text>
      <Modal visible={visible} transparent animationType={f.animationType} onRequestClose={sheetClose}>
        <Pressable style={f.overlay} onPress={sheetClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={f.card}><TextInput testID="sheet-field" /></View>
      </Modal>
    </View>
  );
}

describe('a hand-rolled sheet on useSheetFrame inherits the dialog scope', () => {
  it('Esc typed in its field closes the sheet, never the record behind it', async () => {
    const pageEsc = jest.fn(); const sheetClose = jest.fn();
    await mount(<HandRolledOverPage pageEsc={pageEsc} sheetClose={sheetClose} visible />);
    await press(byTestId('sheet-field'), { key: 'Escape' });
    expect(sheetClose).toHaveBeenCalledTimes(1);
    expect(pageEsc).toHaveBeenCalledTimes(0);
  });

  it('a closed sheet silences nothing — and neither does one whose caller omitted `visible`', async () => {
    const pageEsc = jest.fn(); const sheetClose = jest.fn();
    await mount(
      <View>
        <HandRolledOverPage pageEsc={jest.fn()} sheetClose={jest.fn()} visible={false} />
        <HandRolledOverPage pageEsc={pageEsc} sheetClose={sheetClose} visible={false} passVisible={false} />
      </View>,
    );
    blurAll();
    await press(document.body, { key: 'Escape' });
    expect(pageEsc).toHaveBeenCalledTimes(1);
    expect(sheetClose).toHaveBeenCalledTimes(0);
  });
});

// ── 2. The ⋯ menu and the job switcher ─────────────────────────────────────

function RecordWithToolbar({ onCloseRecord }: { onCloseRecord: () => void }) {
  useHotkeys([{ combo: 'escape', handler: onCloseRecord, label: 'Close record' }], { scope: 'page' });
  return (
    <View>
      <ToolbarActions
        actions={[{ key: 'edit', label: 'Edit', onPress: () => {} }, { key: 'del', label: 'Delete', destructive: true, onPress: () => {} }]}
        testID="tb"
      />
      <Text>RFI-012</Text>
    </View>
  );
}

describe('popovers are dialogs too', () => {
  it('the Esc that closes the ⋯ menu leaves the record open; the next Esc closes the record', async () => {
    const closeRecord = jest.fn();
    await mount(<RecordWithToolbar onCloseRecord={closeRecord} />);
    await act(async () => {
      byTestId('tb-more').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    await settle();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    blurAll();
    await press(document.body, { key: 'Escape' });
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(closeRecord).toHaveBeenCalledTimes(0);
    await press(document.body, { key: 'Escape' });
    expect(closeRecord).toHaveBeenCalledTimes(1);
  });

  it('Esc typed in the job switcher\'s search closes the switcher, not the record', async () => {
    const closeRecord = jest.fn();
    function RecordWithSwitcher() {
      useHotkeys([{ combo: 'escape', handler: closeRecord, label: 'Close record' }], { scope: 'page' });
      return <View><JobSwitcher /><Text>RFI-012</Text></View>;
    }
    await mount(<RecordWithSwitcher />);
    await act(async () => {
      byTestId('job-switcher').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    });
    await settle();
    const filter = byTestId('job-switcher-filter');
    await press(filter, { key: 'Escape' });
    await settle();
    expect(document.querySelector('[data-testid="job-switcher-filter"]')).toBeNull();
    expect(closeRecord).toHaveBeenCalledTimes(0);
  });
});

// ── 3. The shell dock ──────────────────────────────────────────────────────

function Dock({ children }: { children?: React.ReactNode }) {
  const dock = useShellDock();
  React.useEffect(() => {
    dock.open(<View><Text>Ask MAGE body</Text><TextInput testID="dock-field" /></View>, { title: 'Ask MAGE' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <>{children}</>;
}
function shell(children?: React.ReactNode) {
  return (
    <ShellDockProvider>
      <View style={{ flexDirection: 'row' }}>
        <Dock>{children}</Dock>
        <ShellDockHost visible />
      </View>
    </ShellDockProvider>
  );
}

describe('the shell dock', () => {
  it('Esc closes it — also when typed in the dock\'s own field', async () => {
    await mount(shell());
    expect(dockShown()).toBe(true);
    await press(byTestId('dock-field'), { key: 'Escape' });
    expect(dockShown()).toBe(false);
  });

  it('an Esc that dismisses a Sheet leaves the dock open', async () => {
    const sheetClose = jest.fn();
    await mount(shell(
      <Sheet visible onClose={sheetClose} title="Confirm"><TextInput testID="sheet-field" /></Sheet>,
    ));
    blurAll();
    await press(document.body, { key: 'Escape' });
    expect(sheetClose).toHaveBeenCalledTimes(1);
    expect(dockShown()).toBe(true);
  });

  it('a page-scope Esc (an open record) wins over the dock\'s global one', async () => {
    const closeRecord = jest.fn();
    function Record() {
      useHotkeys([{ combo: 'escape', handler: closeRecord, label: 'Close record' }], { scope: 'page' });
      return <Text>RFI-012</Text>;
    }
    await mount(shell(<Record />));
    blurAll();
    await press(document.body, { key: 'Escape' });
    expect(closeRecord).toHaveBeenCalledTimes(1);
    expect(dockShown()).toBe(true);
  });

  it('Cmd/Ctrl+J hides it and brings the same content back', async () => {
    await mount(shell());
    blurAll();
    await press(document.body, { key: 'j', metaKey: true });
    expect(dockShown()).toBe(false);
    await press(document.body, { key: 'j', ctrlKey: true });
    expect(dockShown()).toBe(true);
    expect(document.body.textContent).toContain('Ask MAGE body');
  });
});
