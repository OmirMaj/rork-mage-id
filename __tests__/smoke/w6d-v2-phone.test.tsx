/**
 * Wave 6d, lane V2 — Schedule Pro's sheets (sheet batch C). PHONE PROOF.
 *
 * Lane V2 frames five schedule sheets for desktop (TaskInspector's trade
 * picker, the Living Plan zone sheet, PlanZoneEditor's name prompt and zone
 * sheet, the row menu's bottom sheet, the Plan / Track / Share dropdowns).
 * Every one of those edits is a useSheetFrame() append whose phone branch is
 * null, a <SheetOverlay> that is a Fragment on a phone, or a dialog scope that
 * registers nothing off desktop web — so on the iPhone NOTHING may change.
 *
 * GOLDEN — recorded FIRST, on the untouched base (c1086c0c), before a single
 * line of this lane was written, and never regenerated. Each case mounts ONE
 * component alone at 390 × 844 iOS with useResponsiveLayout mocked to phone.
 * Harness copied from w6c-field-phone: every <Modal> renders its content open
 * or closed (and records visible / transparent / animationType), styles are
 * flattened, handlers dropped, and the snapshot is a line count + sha256.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';

// ── The layout gate: a width + a web flag, exactly like the app's hook ──────
let mockWidth = 390;
let mockHeight = 844;
let mockWeb = false;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024 || (mockWeb && mockWidth >= 900);
    const isTablet = !isDesktop && mockWidth >= 768;
    return {
      screenSize: isDesktop ? 'desktop' : isTablet ? 'tablet' : 'phone',
      isPhone: !isDesktop && !isTablet,
      isTablet,
      isDesktop,
      width: mockWidth,
      height: mockHeight,
      contentMaxWidth: isDesktop ? 1280 : isTablet ? 900 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: isDesktop ? 40 : isTablet ? 36 : 32,
    };
  },
}));

// Every Modal renders its content, open or closed (see the header).
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const ReactActual = jest.requireActual('react');
  const { View: RNView, Text: RNText } = jest.requireActual('react-native');
  class Boundary extends ReactActual.Component<{ children?: React.ReactNode }, { threw: boolean }> {
    state = { threw: false };
    static getDerivedStateFromError() { return { threw: true }; }
    componentDidCatch() { /* recorded as a placeholder; identical before and after */ }
    render() {
      return this.state.threw
        ? ReactActual.createElement(RNText, { testID: 'modal-body-threw' }, 'modal-body-threw')
        : this.props.children;
    }
  }
  function Modal(props: Record<string, unknown> & { children?: React.ReactNode }) {
    const { children, visible, transparent, animationType, presentationStyle } = props;
    return ReactActual.createElement(
      RNView,
      {
        testID: 'w6c-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// PlanZoneEditor reads its zones and writers from ProjectContext; a fixed
// double keeps the component alone (no provider stack).
const mockZones = [
  { id: 'z1', projectId: 'p1', planSheetId: 'sheet-1', x: 0.1, y: 0.1, w: 0.3, h: 0.25, label: 'Kitchen', linkedTaskIds: ['t1'], color: undefined },
  { id: 'z2', projectId: 'p1', planSheetId: 'sheet-1', x: 0.5, y: 0.4, w: 0.3, h: 0.3, label: 'Primary bath', linkedTaskIds: ['t2'], color: undefined },
];
jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({
    addPlanZone: () => {},
    updatePlanZone: () => {},
    deletePlanZone: () => {},
    getPlanZonesForProject: () => mockZones,
  }),
}));

// ── Environment ────────────────────────────────────────────────────────────
function env(width: number, height: number) {
  mockWidth = width;
  mockHeight = height;
  mockWeb = Platform.OS === 'web';
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// The clock is pinned (fake timers mock Date as well as the timers), so the
// Living Plan's "today" and TaskInspector's dates never follow the calendar.
const NOW = new Date('2026-08-15T15:00:00.000Z');
beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  allowConsoleErrors();
  env(390, 844);
});
afterEach(() => {
  jest.useRealTimers();
});

// ── What a snapshot records (verbatim from w6c-field-phone) ─────────────────
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
function small(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 600 ? j : null;
  } catch { return null; }
}
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${String(node)}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'children') continue;
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v)) ?? '<big>'}`); continue; }
    if (typeof v === 'string') { parts.push(`${k}=${JSON.stringify(v)}`); continue; }
    if (typeof v !== 'object' || v === null) { parts.push(`${k}=${String(v)}`); continue; }
    parts.push(`${k}=${small(v) ?? '<obj>'}`);
  }
  out.push(`${pad}<${el.type} ${parts.join(' ')}>`);
  dumpLines(el.children, depth + 1, out);
}
function fingerprint(name: string, json: unknown): { lines: number; sha256: string } {
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = out.join('\n');
  const dir = process.env.W6C_DUMP_DIR;
  if (dir) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${name.replace(/[^a-z0-9]+/gi, '_')}.txt`, text);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  return { lines: out.length, sha256 };
}

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}><ThemeProvider><View>{children}</View></ThemeProvider></SafeAreaProvider>
);

async function settle() {
  await act(async () => {
    try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
    for (let k = 0; k < 20; k++) await Promise.resolve();
  });
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const TASKS = [
  { id: 't1', title: 'Demo kitchen', phase: 'Demolition', durationDays: 3, startDay: 1, progress: 100, crew: 'Demo crew', dependencies: [], status: 'done' },
  { id: 't2', title: 'Rough plumbing', phase: 'Plumbing', durationDays: 4, startDay: 4, progress: 40, crew: '', dependencies: ['t1'], status: 'in_progress', notes: 'Stack at the north wall', subscribers: ['Volt Bros'] },
  { id: 't3', title: 'Drywall', phase: 'Drywall', durationDays: 5, startDay: 8, progress: 0, crew: '', dependencies: ['t2'], status: 'not_started' },
];

describe('lane V2 — the phone is unchanged (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(60000);

  it('TaskInspector (embedded false), the trade picker opened through its button', async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const TaskInspector = require('@/components/schedule/TaskInspector').default;
    const { runCpm } = require('@/utils/cpm');
    /* eslint-enable @typescript-eslint/no-require-imports */
    let cpm: unknown;
    try { cpm = runCpm(TASKS); } catch { cpm = null; }
    if (!cpm || !(cpm as { perTask?: unknown }).perTask) cpm = { perTask: new Map() };
    const r = render(
      <Wrap>
        <TaskInspector task={TASKS[1]} allTasks={TASKS} cpm={cpm} projectStartDate={new Date(2026, 7, 3)} onClose={() => {}} onEdit={() => {}} />
      </Wrap>,
    );
    fireEvent.press(screen.getByLabelText('Select trade'));
    await settle();
    expect(fingerprint('task-inspector-trade-open', r.toJSON())).toMatchSnapshot();
  });

  it('LivingFloorPlan (GC, editable)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LivingFloorPlan } = require('@/components/schedule/mobile/LivingFloorPlan');
    const r = render(
      <Wrap>
        <LivingFloorPlan
          tasks={TASKS}
          scheduleStartDate="2026-08-03"
          planSheetId="sheet-1"
          zones={mockZones}
          pins={[]}
          photoById={() => undefined}
          imageUri="https://example.test/plan.png"
          imageW={1200}
          imageH={900}
          onEdit={() => {}}
          onShare={() => {}}
        />
      </Wrap>,
    );
    fireEvent.press(screen.getByLabelText(/^Kitchen — /));
    await settle();
    expect(fingerprint('living-floor-plan', r.toJSON())).toMatchSnapshot();
  });

  it('PlanZoneEditor (both sheets rendered, the zone sheet opened on Kitchen)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PlanZoneEditor } = require('@/components/schedule/mobile/PlanZoneEditor');
    const project = { id: 'p1', name: 'Henderson', schedule: { tasks: TASKS } };
    const r = render(
      <Wrap>
        <PlanZoneEditor project={project} planSheetId="sheet-1" imageUri="https://example.test/plan.png" imageW={1200} imageH={900} onClose={() => {}} />
      </Wrap>,
    );
    fireEvent.press(screen.getAllByText('Kitchen')[0]);
    await settle();
    expect(fingerprint('plan-zone-editor', r.toJSON())).toMatchSnapshot();
  });

  it('ScheduleRowMenu (no anchor: the bottom sheet)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ScheduleRowMenu } = require('@/components/schedule/ScheduleRowMenu');
    const actions = [
      { key: 'edit', label: 'Edit task', onPress: () => {} },
      { key: 'dup', label: 'Duplicate', onPress: () => {} },
      { key: 'del', label: 'Delete', destructive: true, onPress: () => {} },
    ];
    const r = render(<Wrap><ScheduleRowMenu visible title="Rough plumbing" actions={actions} onClose={() => {}} /></Wrap>);
    await settle();
    expect(fingerprint('schedule-row-menu', r.toJSON())).toMatchSnapshot();
  });

  it('SchedulerMenuBar (the bar, then Track opened)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SchedulerMenuBar } = require('@/components/schedule/SchedulerMenuBar');
    const noop = () => {};
    const actions = {
      onAddTask: noop, onImport: noop, onReflow: noop, onClosures: noop, onCriticalPath: noop, onBaseline: noop,
      onWeather: noop, onLevelResources: noop, onHistory: noop, onExport: noop, onShare: noop, onAI: noop,
    };
    const r = render(<Wrap><SchedulerMenuBar active="timeline" onSelectView={noop} actions={actions} /></Wrap>);
    fireEvent.press(screen.getByText('Track ▾'));
    await settle();
    expect(fingerprint('scheduler-menu-bar', r.toJSON())).toMatchSnapshot();
  });
});
