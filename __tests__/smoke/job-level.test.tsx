/**
 * Smoke — the Level as a project-health instrument (ideas-1, T5).
 *
 * THE PROMISES THIS PROVES:
 *  - the three kinds render: a full reading (solid bubble, drifted right by
 *    offset × travel, tinted by margin risk), a partial reading with no slip
 *    (a HOLLOW centred bubble — never a solid "on plan"), and no data (the
 *    grey hollow vial, "Not enough data yet");
 *  - one golden of the three (a new snapshot, recorded once);
 *  - tapping opens the reason sheet with the label and every reason, then
 *    the four legend lines; site counts are listed there and never drawn;
 *  - a changed reading eases ONCE to its new place (450 ms), a remount of the
 *    same project starts where it was (no replay), and under Reduce Motion
 *    the bubble jumps to the final position;
 *  - PortfolioTable: showLevel off (the default) renders no Health column and
 *    no Level; on, a "Health" header and one Level per row.
 */

import React from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';
import { act, cleanupAsync, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { JobLevel, __resetJobLevelMemory } from '@/components/level/JobLevel';
import { computeJobLevel, JOB_LEVEL_LEGEND, JOB_LEVEL_ROW_SIZE, type JobLevelMargin } from '@/utils/jobLevel';
import { levelParts } from '@/utils/levelTimeline';
import type { PortfolioSchedule } from '@/utils/portfolio/portfolioRow';

// react-test-renderer ships no .d.ts here (RNTL wraps it); only the calls this
// file makes are typed (the ui-desktop-primitives idiom).
type TestRendererInstance = { toJSON(): unknown; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: { create(el: React.ReactElement): TestRendererInstance } = require('react-test-renderer');

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

let mockReduce = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, useReducedMotion: () => mockReduce, reducedMotion: () => mockReduce };
});

let mockWidth = 390;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024;
    return {
      screenSize: isDesktop ? 'desktop' : 'phone',
      isPhone: !isDesktop,
      isTablet: false,
      isDesktop,
      width: mockWidth,
      height: 945,
      contentMaxWidth: isDesktop ? 1280 : mockWidth,
      sidebarWidth: isDesktop ? 240 : 0,
      showSidebar: isDesktop,
      ganttRowHeight: 32,
    };
  },
}));

// The portfolio table's Level readings, without the whole provider stack.
jest.mock('@/hooks/useJobLevel', () => {
  const { computeJobLevel: compute } = jest.requireActual('@/utils/jobLevel');
  return {
    useJobLevels: ({ projects, schedules }: { projects: { id: string }[]; schedules: Map<string, unknown> }) =>
      new Map(projects.map((p) => [p.id, compute({ schedule: schedules.get(p.id) ?? null, margin: null })])),
  };
});

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
);

const sched = (slipDays: number | null, overdueCount = 0): PortfolioSchedule => ({ status: slipDays && slipDays > 0 ? 'late' : 'on_track', slipDays, overdueCount });
const margin = (band: JobLevelMargin['band']): JobLevelMargin => ({
  hasBasis: true, band, score: 50, costBasis: 'all_sources',
  topFactors: [{ label: 'Thin bid margin', detail: 'Bid at 8.0% margin' }],
});

const READING = computeJobLevel({ schedule: sched(6), margin: margin('elevated') });
const PARTIAL = computeJobLevel({ schedule: sched(null, 2), margin: margin('low') });
const NO_DATA = computeJobLevel({ schedule: null, margin: null });
const AMP = levelParts(JOB_LEVEL_ROW_SIZE, 'accent').amp;

/** The vial is hidden from VoiceOver (the button reads the label), so queries include hidden nodes. */
const HIDDEN = { includeHiddenElements: true } as const;
const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;
type Node = { props: { style?: unknown } };
/** The bubble's current translateX (the Animated node's value). */
function bubbleX(node: Node): number {
  const t = flat(node.props.style).transform as { translateX?: unknown }[] | undefined;
  const v = t?.find((x) => 'translateX' in x)?.translateX;
  if (typeof v === 'number') return v;
  return (v as { __getValue: () => number }).__getValue();
}

describe('The Level — project health', () => {
  beforeEach(() => {
    __resetJobLevelMemory();
    mockReduce = false;
    mockWidth = 390;
  });
  // Every render's unmount is awaited here, so no act() work is left queued
  // when the file's environment is torn down (level-content does the same).
  afterEach(async () => {
    await cleanupAsync();
  });

  it('the engine readings the cases use', () => {
    expect(READING.kind).toBe('reading');
    expect(PARTIAL.kind).toBe('partial');
    expect(NO_DATA.kind).toBe('no_data');
    expect(NO_DATA.label).toBe('Not enough data yet');
  });

  it('golden: reading, partial and no data', () => {
    let r: TestRendererInstance | null = null;
    act(() => {
      r = TestRenderer.create(
        <Wrap><View>
          <JobLevel projectId="p-reading" reading={READING} />
          <JobLevel projectId="p-partial" reading={PARTIAL} showLabel />
          <JobLevel projectId="p-none" reading={NO_DATA} showLabel />
          <JobLevel projectId="p-detail" reading={READING} size="detail" />
        </View></Wrap>,
      );
    });
    const inst = r as unknown as TestRendererInstance;
    expect(inst.toJSON()).toMatchSnapshot();
    act(() => inst.unmount());
  });

  it('reading: a solid bubble drifted right by offset × travel, a button that reads its label', () => {
    const r = render(<Wrap><JobLevel projectId="p1" reading={READING} /></Wrap>);
    const level = r.getByTestId('joblevel-p1');
    expect(level.props.accessibilityRole).toBe('button');
    expect(level.props.accessibilityLabel).toBe('Schedule: 6 working days behind. Margin risk: elevated.');
    const bubble = r.getByTestId('joblevel-p1-vial-bubble', HIDDEN);
    expect(bubbleX(bubble)).toBeCloseTo(0.6 * AMP, 5);
    expect(flat(bubble.props.style).backgroundColor).not.toBe('transparent');
    expect(flat(bubble.props.style).borderWidth).toBeUndefined();
  });

  it('partial with no slip reading: a hollow bubble at centre; no data: a grey hollow vial that says so', () => {
    const r = render(<Wrap><View>
      <JobLevel projectId="pp" reading={PARTIAL} showLabel />
      <JobLevel projectId="pn" reading={NO_DATA} showLabel />
    </View></Wrap>);
    const hollow = r.getByTestId('joblevel-pp-vial-bubble', HIDDEN);
    expect(bubbleX(hollow)).toBe(0);
    expect(flat(hollow.props.style).backgroundColor).toBe('transparent');
    expect(flat(hollow.props.style).borderWidth).toBeGreaterThan(0);
    expect(r.getByTestId('joblevel-pp-label').props.children).toMatch(/No slip reading/);
    expect(r.getByTestId('joblevel-pn-label').props.children).toBe('Not enough data yet');
    expect(flat(r.getByTestId('joblevel-pn-vial-bubble', HIDDEN).props.style).backgroundColor).toBe('transparent');
  });

  it('tap opens the reason: the label and every reason', () => {
    const r = render(<Wrap><JobLevel projectId="p1" reading={READING} projectName="Henderson" /></Wrap>);
    expect(r.queryByTestId('joblevel-reason')).toBeNull();
    fireEvent.press(r.getByTestId('joblevel-p1'));
    expect(r.getByTestId('joblevel-reason')).toBeTruthy();
    expect(r.getByTestId('joblevel-reason-label').props.children).toBe(READING.label);
    READING.reasons.forEach((reason, i) => expect(r.getByTestId(`joblevel-reason-${i}`).props.children).toBe(reason));
    expect(r.getByText('6 working days behind the baseline finish.')).toBeTruthy();
  });

  it('the reason sheet explains itself: the four legend lines, under the reasons (every Level — Home, portfolio, hub)', () => {
    const r = render(<Wrap><JobLevel projectId="p1" reading={READING} projectName="Henderson" /></Wrap>);
    fireEvent.press(r.getByTestId('joblevel-p1'));
    const legend = r.getByTestId('joblevel-legend');
    const lines = (legend.props.children as React.ReactElement<{ children: string }>[]).map((c) => c.props.children);
    expect(lines).toEqual(JOB_LEVEL_LEGEND.map((l) => l.text));
    expect(JOB_LEVEL_LEGEND.map((l) => l.id)).toEqual(['bubble', 'colour', 'listed', 'empty']);
  });

  it('site counts are listed in the sheet and never move the drawn reading', () => {
    const withSite = computeJobLevel({ schedule: sched(6), margin: margin('elevated'), site: { openPunch: 3, overdueRfis: 1 } });
    expect(withSite.key).toBe(READING.key);
    expect(withSite.offset).toBe(READING.offset);
    expect(withSite.label).toBe(READING.label);
    const r = render(<Wrap><JobLevel projectId="ps" reading={withSite} /></Wrap>);
    fireEvent.press(r.getByTestId('joblevel-ps'));
    expect(r.getByText('3 punch items are open.')).toBeTruthy();
    expect(r.getByText('1 RFI is past its due date.')).toBeTruthy();
  });

  it('a changed reading eases once (450 ms); a remount starts where it was', () => {
    jest.useFakeTimers();
    try {
      const behind2 = computeJobLevel({ schedule: sched(2), margin: margin('low') });
      const behind8 = computeJobLevel({ schedule: sched(8), margin: margin('low') });
      const r = render(<Wrap><JobLevel projectId="pe" reading={behind2} /></Wrap>);
      expect(bubbleX(r.getByTestId('joblevel-pe-vial-bubble', HIDDEN))).toBeCloseTo(0.2 * AMP, 5);
      const starts = jest.spyOn(Animated, 'timing');
      r.rerender(<Wrap><JobLevel projectId="pe" reading={behind8} /></Wrap>);
      expect(starts).toHaveBeenCalledTimes(1);
      expect(starts.mock.calls[0][1]).toMatchObject({ toValue: 0.8 * AMP, duration: 450 });
      expect(starts.mock.calls[0][1].useNativeDriver).toBe(true);
      // It eases from where it was: the frame after the change has not jumped.
      // (The native-driven value does not advance in jest; the remount below
      // proves where it ends.)
      expect(bubbleX(r.getByTestId('joblevel-pe-vial-bubble', HIDDEN))).toBeCloseTo(0.2 * AMP, 5);
      act(() => { jest.advanceTimersByTime(600); });
      // The same reading again: no second ease.
      r.rerender(<Wrap><JobLevel projectId="pe" reading={{ ...behind8 }} /></Wrap>);
      expect(starts).toHaveBeenCalledTimes(1);
      r.unmount();
      // A remount (a list that remounted) starts at the remembered place.
      const again = render(<Wrap><JobLevel projectId="pe" reading={behind8} /></Wrap>);
      expect(bubbleX(again.getByTestId('joblevel-pe-vial-bubble', HIDDEN))).toBeCloseTo(0.8 * AMP, 5);
      expect(starts).toHaveBeenCalledTimes(1);
      starts.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  it('Reduce Motion: the bubble jumps to the final position (no timing)', () => {
    mockReduce = true;
    const behind2 = computeJobLevel({ schedule: sched(2), margin: margin('low') });
    const behind25 = computeJobLevel({ schedule: sched(25), margin: margin('high') });
    const r = render(<Wrap><JobLevel projectId="prm" reading={behind2} /></Wrap>);
    const starts = jest.spyOn(Animated, 'timing');
    r.rerender(<Wrap><JobLevel projectId="prm" reading={behind25} /></Wrap>);
    expect(starts).not.toHaveBeenCalled();
    expect(bubbleX(r.getByTestId('joblevel-prm-vial-bubble', HIDDEN))).toBeCloseTo(1 * AMP, 5);
    starts.mockRestore();
  });

  it('PortfolioTable: no Health column by default; showLevel adds the header and one Level per row', () => {
    mockWidth = 1512;
    // jest-expo runs as iOS: the desktop table without web's <a> row links.
    expect(Platform.OS).toBe('ios');
    {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PortfolioTable } = require('@/components/portfolio/PortfolioTable');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { world } = require('@/__tests__/fixtures/world');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { buildPortfolioRows } = require('@/utils/portfolio/portfolioRow');
      const projects = [world.project];
      const burnByProject = new Map();
      const rows = buildPortfolioRows({ projects, invoices: [], changeOrders: [], rfis: [], punchItems: [], burnByProject, now: new Date('2026-09-28T12:00:00') });
      const table = (showLevel?: boolean) => (
        <Wrap><View style={{ width: 1400 }}>
          <PortfolioTable projects={projects} rows={rows} burnByProject={burnByProject} onOpenActions={() => {}} onOpenProject={() => {}} showLevel={showLevel} />
        </View></Wrap>
      );
      const off = render(table());
      expect(off.getByTestId('portfolio-table')).toBeTruthy();
      expect(off.queryByText('Health')).toBeNull();
      expect(off.queryByTestId(`joblevel-${world.project.id}`)).toBeNull();
      off.rerender(table(true));
      expect(off.getByText('Health')).toBeTruthy();
      expect(off.getByTestId('portfolio-table-sort-health')).toBeTruthy();
      expect(off.getByTestId(`joblevel-${world.project.id}`)).toBeTruthy();
    }
  });
});
