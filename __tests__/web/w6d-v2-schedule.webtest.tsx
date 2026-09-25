/**
 * Wave 6d, lane V2 — Schedule Pro on a desktop browser, in a real DOM (jsdom +
 * react-dom + react-native-web at 1512 px).
 *
 *  1. C2. Esc on the Task tab's Trade picker closed the WHOLE AI pane: the
 *     picker was a bare Modal with no dialog scope, so the registry handed the
 *     Esc keydown to the pane's page-scope SidePanel binding (onClose) before
 *     RN-web's Modal closed the picker on keyup. The picker is now a
 *     useSheetFrame dialog: the Esc closes the picker and only the picker.
 *  2. C4. Toolbar row 2 collapses instead of overflowing: the branches of
 *     row2Plan, rendered at a mocked toolbar width.
 *  3. C7. Cmd+E (export CSV) and Cmd+Shift+S (copy share link) no longer fire
 *     while he types in a field. Schedule Pro is too large to mount here, so
 *     the test reads the two bindings' flags from app/schedule-pro.tsx and
 *     registers them, with a spy handler, through the real registry.
 *
 * Run: npx jest --config __tests__/web/jest.web.config.js __tests__/web/w6d-v2-schedule.webtest.tsx
 */

import React, { act } from 'react';
import { Dimensions, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Root = { render(node: React.ReactNode): void; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require('react-dom/client') as { createRoot(el: Element): Root };

// The toolbar's own measured width (useContainerWidth) — the one input row2Plan reads.
let mockBarW = 0;
jest.mock('@/hooks/useContainerWidth', () => ({
  useContainerWidth: () => ({ width: mockBarW, measured: mockBarW > 0, onLayout: () => {} }),
}));
// The health badge reads a scored schedule; row 2 is under test, not row 1's badge.
jest.mock('@/components/schedule/ScheduleHealthScore', () => ({ ScheduleHealthBadge: () => null }));

import { ThemeProvider } from '@/contexts/ThemeContext';
import { useHotkeys, type HotkeyBinding } from '@/hooks/useHotkeys';
import { SidePanel } from '@/components/desktop/SidePanel';
import TaskInspector from '@/components/schedule/TaskInspector';
import { ScheduleProToolbar, type ScheduleProToolbarProps } from '@/components/schedule/desktop/ScheduleProToolbar';
import { runCpm } from '@/utils/cpm';
import type { ScheduleTask } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.spyOn(Dimensions, 'get').mockImplementation(
  () => ({ width: 1512, height: 945, scale: 2, fontScale: 1 }) as ReturnType<typeof Dimensions.get>,
);

const METRICS = { frame: { x: 0, y: 0, width: 1512, height: 945 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const roots: { root: Root; el: HTMLElement }[] = [];

/** Let timers run, then fire animationend: jsdom runs no CSS animations, and
 *  RN-web's Modal only closes on Escape (and unmounts) once its animation ends. */
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
async function press(target: EventTarget, init: KeyboardEventInit): Promise<void> {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init })); });
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const byLabel = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLElement | null;
/** Elements that hold `text` as their OWN text node (a wrapper View around a
 *  lone Text has the same textContent, and is not counted twice). */
const textCount = (text: string) =>
  Array.from(document.body.querySelectorAll('*')).filter((n) =>
    Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent === text)).length;
async function click(el: HTMLElement | null): Promise<void> {
  if (!el) throw new Error('nothing to click');
  await act(async () => { el.click(); });
  await settle();
}

// ── 1. C2: Esc on the trade picker inside the pane ─────────────────────────
const mk = (id: string, startDay: number, durationDays: number, deps: string[] = []) =>
  ({ id, title: id === 'b' ? 'Rough plumbing' : 'Demo', phase: 'Plumbing', durationDays, startDay, progress: 0, crew: '', dependencies: deps, notes: '', status: 'not_started' } as ScheduleTask);
const TASKS = [mk('a', 1, 3), mk('b', 4, 4, ['a'])];

describe('C2 — the Trade picker inside the docked pane', () => {
  it('an Esc while the picker is open closes the picker only; the pane stays open', async () => {
    const onClose = jest.fn();
    await mount(
      <View style={{ width: 1512, height: 945, flexDirection: 'row' }}>
        <View style={{ flex: 1 }} />
        <SidePanel open onClose={onClose} title="Task" panelId="w6d-v2-pane">
          <TaskInspector task={TASKS[1]} allTasks={TASKS} cpm={runCpm(TASKS)} projectStartDate={new Date(2026, 2, 2)} onClose={() => {}} onEdit={() => {}} embedded />
        </SidePanel>
      </View>,
    );
    expect(textCount('Trade')).toBe(1); // the section heading; the picker is closed
    await click(byLabel('Select trade'));
    expect(textCount('Trade')).toBe(2); // + the picker's own title

    await press(document.activeElement ?? document.body, { key: 'Escape' });
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(textCount('Trade')).toBe(1);
    expect(q('task-inspector-embedded')).not.toBeNull();

    // With the picker closed, the pane's own Esc still closes the pane.
    await press(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── 2. C4: row 2's plan at a mocked toolbar width ──────────────────────────
function toolbarProps(onDensity: jest.Mock): ScheduleProToolbarProps {
  const noop = () => {};
  return {
    projectName: 'Henderson', meta: '2 tasks', verdictTone: 'onPace',
    health: null as unknown as ScheduleProToolbarProps['health'], onHealthPress: noop, onBack: noop, onCommand: noop,
    canUndo: false, canRedo: false, onUndo: noop, onRedo: noop, onExport: noop,
    view: 'split', onView: noop, zoom: { zoomIn: noop, zoomOut: noop, fit: noop, today: noop },
    density: 'compact', onDensity,
    actions: {
      onAddTask: noop, onImport: noop, onReflow: noop, onClosures: noop, onCriticalPath: noop, onBaseline: noop,
      onWeather: noop, onExport: noop, onShare: noop, onAI: noop,
    },
  };
}
const inRow2 = (id: string) => !!q('schedule-toolbar-row2')?.querySelector(`[data-testid="${id}"]`);

describe('C4 — toolbar row 2 at a measured width', () => {
  afterEach(() => { mockBarW = 0; });

  it.each([
    // [width, Rows label, segmented density, Board on the control, Fit as a word]
    [1448, true, true, true, true],
    [0, true, true, true, true],
    [1216, false, false, true, true],
    [1040, false, false, false, true],
    [900, false, false, false, false],
  ])('at %i px: Rows %s, segmented density %s, Board on the control %s, Fit as a word %s', async (w, rows, segmented, board, words) => {
    mockBarW = w;
    const onDensity = jest.fn();
    await mount(<ScheduleProToolbar {...toolbarProps(onDensity)} />);
    expect(textCount('Rows') === 1).toBe(rows);
    expect(inRow2('schedule-density-compact')).toBe(segmented);
    expect(inRow2('schedule-density')).toBe(true);
    expect(inRow2('schedule-view-board')).toBe(board);
    expect(inRow2('schedule-view-overview')).toBe(board);
    expect(inRow2('schedule-view-split') && inRow2('schedule-view-gantt') && inRow2('schedule-view-list')).toBe(true);
    const fit = q('schedule-zoom-fit');
    expect(fit?.getAttribute('aria-label')).toBe('Fit the whole project');
    expect(q('schedule-zoom-today')?.getAttribute('aria-label')).toBe('Scroll to today');
    expect(fit?.textContent === 'Fit').toBe(words);

    // Board / Overview are still one click away: in More ▾ when off the control.
    await click(q('schedule-view-more'));
    const menu = q('schedule-view-more-menu');
    expect(!!menu?.querySelector('[data-testid="schedule-view-board"]')).toBe(!board);
    expect(!!menu?.querySelector('[data-testid="schedule-view-workload"]')).toBe(true);
  });

  it('the one-button density toggle flips to the other value', async () => {
    mockBarW = 1216;
    const onDensity = jest.fn();
    await mount(<ScheduleProToolbar {...toolbarProps(onDensity)} />);
    const toggle = q('schedule-density');
    expect(toggle?.textContent).toBe('Compact');
    await click(toggle);
    expect(onDensity).toHaveBeenCalledWith('comfortable');
  });
});

// ── 3. C7: Cmd+E / Cmd+Shift+S typed in a field ────────────────────────────
/** The binding object literal for `combo` in schedule-pro's useHotkeys([...]). */
function proBinding(combo: string): string {
  const src = readFileSync(join(__dirname, '../../app/schedule-pro.tsx'), 'utf8');
  const at = src.indexOf(`{ combo: '${combo}',`);
  if (at < 0) throw new Error(`no ${combo} binding in app/schedule-pro.tsx`);
  let depth = 0;
  for (let j = at; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1); }
  }
  return src.slice(at);
}

function Harness({ bindings }: { bindings: HotkeyBinding[] }) {
  useHotkeys(bindings, { enabled: true });
  return <TextInput testID="w6d-v2-field" accessibilityLabel="A grid cell" />;
}

describe('C7 — schedule-pro export / share keys while typing', () => {
  it.each([
    ['mod+e', { key: 'e', metaKey: true }],
    ['mod+shift+s', { key: 'S', metaKey: true, shiftKey: true }],
  ] as const)('%s typed in a TextInput does not run its handler; on the page it does', async (combo, key) => {
    const literal = proBinding(combo);
    expect(literal).toMatch(/blockInInput: true/);
    const handler = jest.fn();
    await mount(<Harness bindings={[{ combo, handler, blockInInput: /blockInInput: true/.test(literal) }]} />);
    const field = q('w6d-v2-field') as HTMLInputElement;
    await act(async () => { field.focus(); });
    await press(field, key);
    expect(handler).not.toHaveBeenCalled();
    await act(async () => { field.blur(); });
    await press(document.body, key);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
