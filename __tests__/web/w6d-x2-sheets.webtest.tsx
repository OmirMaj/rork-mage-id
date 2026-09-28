/**
 * Wave 6d restore (d6r), lane X2 — real-DOM proof of the desktop sheets.
 *
 * jsdom + react-dom + react-native-web at 1512 px (the stack app.mageid.app
 * runs). What lane X2 changed on desktop web, each asserted on real nodes:
 *
 *  1. A shared sheet (the Summary Tools sheet) is a centred CARD, not a
 *     full-window-width bottom sheet: capped at Layout.sheet.form (560), all
 *     four corners rounded, no drag handle, and its backdrop is the scrim over
 *     the WHOLE window (left edge 0, the sidebar included).
 *  2. The CSI division picker closes on a scrim CLICK. Its phone backdrop is a
 *     View with onTouchEnd, which react-native-web never fires on a mouse
 *     click, so on desktop the backdrop is the Pressable SheetScrim.
 *  3. The open ⋯ menu (ToolbarActions) and the open job switcher mask Cmd/Ctrl+S:
 *     the page's own Save behind them does not run, and the key is consumed
 *     (defaultPrevented) so the browser's "Save page as…" never opens over them.
 *  4. An open framed sheet is a dialog: the page's Cmd+S behind it is silent.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-x2-sheets.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

jest.mock('@/utils/alert', () => ({ ...jest.requireActual('@/utils/alert'), showAlert: jest.fn(), showPrompt: jest.fn() }));
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), setParams: jest.fn(), back: jest.fn() }) };
});
// The job switcher reads the project list and the job context; neither
// matters to the key it must not leak.
jest.mock('@/contexts/ProjectContext', () => ({ useCoreData: () => ({ projects: [] }), useProjects: () => ({ projects: [] }) }));
jest.mock('@/hooks/useProjectAccess', () => ({ useProjectAccess: () => ({ canAccess: () => true, requiredTierFor: () => null }) }));
jest.mock('@/contexts/ActiveProjectContext', () => ({
  useActiveProject: () => ({ activeProjectId: null, activeProject: null, setActiveProject: () => {}, recentProjectIds: [] }),
}));

import { ThemeProvider } from '@/contexts/ThemeContext';
import { Layout } from '@/constants/designTokens';
import { useHotkeys } from '@/hooks/useHotkeys';
import { ToolbarActions } from '@/components/desktop/ToolbarActions';
import { JobSwitcher } from '@/components/desktop/JobSwitcher';
import { ToolsSheet } from '@/components/summary/ToolsSheet';
import { CSIDivisionPicker } from '@/components/CSIDivisionPicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const METRICS = { frame: { x: 0, y: 0, width: 1512, height: 945 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const roots: { root: Root; el: HTMLElement }[] = [];

/** Let timers run, then fire animationend (jsdom runs no CSS animations, and
 *  RN-web's Modal only settles once its open animation has ended). */
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

async function press(target: EventTarget, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const down = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(down); });
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init })); });
  return down;
}
async function click(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });
  await settle();
}
function byTestId(id: string): HTMLElement {
  const n = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  if (!n) throw new Error(`no element with testID ${id}`);
  return n;
}
function blurAll(): void {
  (document.activeElement as HTMLElement | null)?.blur?.();
}

/** A page with its own Cmd+S (a record's Save) — must stay silent while a
 *  dialog is open over it. */
function PageWithSave({ onSave, children }: { onSave: () => void; children?: React.ReactNode }) {
  useHotkeys([{ combo: 'mod+s', handler: onSave, label: 'Save' }], { scope: 'page' });
  return <View>{children}<Text>RFI-012</Text></View>;
}

describe('lane X2 — a shared sheet is a centred desktop card', () => {
  it('Tools: capped at the form width, four rounded corners, no handle, scrim over the whole window', async () => {
    await mount(<ToolsSheet visible onClose={() => {}} onNavigate={() => {}} />);
    const card = getComputedStyle(byTestId('summary-tools-sheet'));
    expect(card.maxWidth).toBe(`${Layout.sheet.form}px`);
    expect(card.borderBottomLeftRadius).toBe(card.borderTopLeftRadius);
    expect(card.borderBottomRightRadius).toBe(card.borderTopRightRadius);
    expect(parseFloat(card.borderBottomLeftRadius)).toBeGreaterThan(0);
    const scrim = getComputedStyle(byTestId('summary-tools-backdrop'));
    expect(scrim.position).toBe('absolute');
    expect(scrim.left).toBe('0px');
    // The drag handle (a 40 x 4 bar) is a phone affordance only.
    const sheet = byTestId('summary-tools-sheet');
    const handle = Array.from(sheet.querySelectorAll('div')).find((d) => {
      const s = getComputedStyle(d);
      return s.width === '40px' && s.height === '4px';
    });
    expect(handle).toBeUndefined();
  });

  it('an open sheet is a dialog: the page\'s Cmd+S behind it does not run', async () => {
    const save = jest.fn();
    await mount(<PageWithSave onSave={save}><ToolsSheet visible onClose={() => {}} onNavigate={() => {}} /></PageWithSave>);
    blurAll();
    const down = await press(document.body, { key: 's', metaKey: true });
    expect(save).toHaveBeenCalledTimes(0);
    expect(down.defaultPrevented).toBe(true);
  });
});

describe('lane X2 — the CSI picker closes on a scrim click', () => {
  it('open from the pill, click the scrim, the list is gone', async () => {
    const onChange = jest.fn();
    await mount(<CSIDivisionPicker value={undefined} onChange={onChange} testID="csi-pill" />);
    await click(byTestId('csi-pill'));
    expect(document.querySelector('[data-testid="csi-div-09"]')).not.toBeNull();
    // The scrim is the first "Close" button in DOM order: it is drawn before
    // the card (whose header X is also labelled Close).
    const scrim = document.querySelector('[role="button"][aria-label="Close"]') as HTMLElement;
    expect(getComputedStyle(scrim).position).toBe('absolute');
    await click(scrim);
    expect(document.querySelector('[data-testid="csi-div-09"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('lane X2 — popovers mask Cmd/Ctrl+S', () => {
  it('the open ⋯ menu: the page\'s Save does not run and "Save page as…" is consumed', async () => {
    const save = jest.fn();
    await mount(
      <PageWithSave onSave={save}>
        <ToolbarActions
          actions={[{ key: 'edit', label: 'Edit', onPress: () => {} }, { key: 'del', label: 'Delete', destructive: true, onPress: () => {} }]}
          testID="tb"
        />
      </PageWithSave>,
    );
    // Closed: the page's Save is live.
    blurAll();
    await press(document.body, { key: 's', metaKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    await click(byTestId('tb-more'));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    blurAll();
    const down = await press(document.body, { key: 's', metaKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(down.defaultPrevented).toBe(true);
    const ctrl = await press(document.body, { key: 's', ctrlKey: true });
    expect(save).toHaveBeenCalledTimes(1);
    expect(ctrl.defaultPrevented).toBe(true);
  });

  it('the open job switcher: Cmd+S typed in its search is consumed, the page\'s Save does not run', async () => {
    const save = jest.fn();
    await mount(<PageWithSave onSave={save}><JobSwitcher /></PageWithSave>);
    await click(byTestId('job-switcher'));
    const filter = byTestId('job-switcher-filter');
    const down = await press(filter, { key: 's', metaKey: true });
    expect(save).toHaveBeenCalledTimes(0);
    expect(down.defaultPrevented).toBe(true);
  });
});
