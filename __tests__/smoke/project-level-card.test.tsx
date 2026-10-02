/**
 * Smoke — The Level on the project hub (components/level/ProjectLevelCard).
 *
 * THE PROMISES THIS PROVES:
 *  - one golden of the three states (a new snapshot, recorded once): a full
 *    reading (a schedule with a baseline that slipped 5 working days + a
 *    moderate margin), a partial with no baseline (margin only — a HOLLOW
 *    bubble, never a solid "on plan"), and no data (a field role on a project
 *    with no schedule: the grey hollow vial, "Not enough data yet");
 *  - the schedule half is portfolioRow's own (the same slip Home reads), the
 *    margin half is the pulse's risk (the band the hero prints), and open
 *    punch / late RFIs are listed in the sheet, never drawn;
 *  - the title is a header; the compact legend shows the bubble + colour
 *    lines; the sheet shows all four legend lines under the reasons;
 *  - S2: on the desktop, while the role resolves, the card says
 *    "Loading margin…" (the engine's own label);
 *  - a null project renders nothing; no data still renders the card.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, cleanupAsync, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProjectLevelCard } from '@/components/level/ProjectLevelCard';
import { __resetJobLevelMemory } from '@/components/level/JobLevel';
import { JOB_LEVEL_LEGEND } from '@/utils/jobLevel';
import { INERT_PULSE, type ProjectPulse } from '@/utils/projectWorkspaceLayout';
import type { Project } from '@/types';

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

jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, useReducedMotion: () => false, reducedMotion: () => false };
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

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
);

// A dated schedule whose CPM finish is 5 working days past its baseline's
// (independent of today: the slip is CPM finish vs baseline finish).
const task = (id: string, startDay: number, durationDays: number, deps: string[] = []) => ({
  id, title: id, phase: 'Build', durationDays, startDay, progress: 0, crew: '', dependencies: deps, notes: '', status: 'not_started',
});
const SCHEDULE = {
  id: 's1', name: 'Schedule', projectId: 'p-full', startDate: '2026-09-01', workingDaysPerWeek: 5,
  tasks: [task('a', 0, 10), task('b', 10, 6, ['a'])],
  baselines: [{ id: 'b1', name: 'Bid', savedAt: '2026-08-20T00:00:00Z', tasks: [{ id: 'a', startDay: 0, endDay: 7 }, { id: 'b', startDay: 8, endDay: 11 }] }],
};
const project = (id: string, schedule: unknown): Project => ({ id, name: `Project ${id}`, status: 'in_progress', schedule } as unknown as Project);
const FULL = project('p-full', SCHEDULE);
const NO_BASELINE = project('p-partial', { ...SCHEDULE, projectId: 'p-partial', baselines: [] });
const NO_SCHEDULE = project('p-none', undefined);

const risk = (band: 'low' | 'moderate' | 'elevated' | 'high') => ({
  score: 45, hasBasis: true, band, costBasis: 'all_sources',
  topFactors: [{ label: 'Thin bid margin', detail: 'Bid at 8.0% margin' }],
}) as unknown as ProjectPulse['risk'];
const pulse = (over: Partial<ProjectPulse> = {}): ProjectPulse => ({
  ...INERT_PULSE, hasProject: true, role: 'owner', canSeeMoney: true, costSourcesReady: true, risk: risk('moderate'), ...over,
});
const MONEY_PULSE = pulse({ overdueRfis: 2, punch: { open: 2, inProgress: 1, readyForReview: 1 } });
const PARTIAL_PULSE = pulse({ risk: risk('low') });
const FIELD_PULSE = pulse({ role: 'field', canSeeMoney: false, risk: null });

const HIDDEN = { includeHiddenElements: true } as const;
const flat = (s: unknown) => (StyleSheet.flatten(s as never) ?? {}) as Record<string, unknown>;

describe('ProjectLevelCard — The Level on the project hub', () => {
  beforeEach(() => {
    __resetJobLevelMemory();
    mockWidth = 390;
  });
  afterEach(async () => {
    await cleanupAsync();
  });

  it('golden: full reading, partial with no baseline, no data', () => {
    let r: TestRendererInstance | null = null;
    act(() => {
      r = TestRenderer.create(
        <Wrap><View>
          <ProjectLevelCard project={FULL} pulse={MONEY_PULSE} testID="card-full" />
          <ProjectLevelCard project={NO_BASELINE} pulse={PARTIAL_PULSE} testID="card-partial" />
          <ProjectLevelCard project={NO_SCHEDULE} pulse={FIELD_PULSE} testID="card-none" />
        </View></Wrap>,
      );
    });
    const inst = r as unknown as TestRendererInstance;
    expect(inst.toJSON()).toMatchSnapshot();
    act(() => inst.unmount());
  });

  it('full: portfolioRow\'s slip + the pulse\'s band; a solid bubble; the title is a header; the compact legend', () => {
    const r = render(<Wrap><ProjectLevelCard project={FULL} pulse={MONEY_PULSE} /></Wrap>);
    expect(r.getByTestId('project-level-card')).toBeTruthy();
    expect(r.getByTestId('project-level-label').props.children).toBe('5 working days behind · Margin risk: moderate');
    expect(r.getByTestId('project-level').props.accessibilityLabel).toBe('Schedule: 5 working days behind. Margin risk: moderate.');
    const bubble = r.getByTestId('project-level-vial-bubble', HIDDEN);
    expect(flat(bubble.props.style).backgroundColor).not.toBe('transparent');
    const header = r.getByText('Project health');
    expect(header.props.accessibilityRole).toBe('header');
    const legend = r.getByTestId('project-level-legend');
    expect(legend).toBeTruthy();
    expect(r.getByText(JOB_LEVEL_LEGEND[0].text)).toBeTruthy();
    expect(r.getByText(JOB_LEVEL_LEGEND[1].text)).toBeTruthy();
    // The card's compact legend is two lines; the other two live in the sheet.
    expect(r.queryByText(JOB_LEVEL_LEGEND[2].text)).toBeNull();
  });

  it('tap: the sheet lists the counts (never drawn) and all four legend lines under the reasons', () => {
    const r = render(<Wrap><ProjectLevelCard project={FULL} pulse={MONEY_PULSE} /></Wrap>);
    fireEvent.press(r.getByTestId('project-level'));
    expect(r.getByTestId('joblevel-reason')).toBeTruthy();
    // open 2 + in progress 1 + ready for review 1 (ProjectHero's own sum).
    expect(r.getByText('4 punch items are open.')).toBeTruthy();
    expect(r.getByText('2 RFIs are past their due date.')).toBeTruthy();
    const legend = r.getByTestId('joblevel-legend');
    for (const line of JOB_LEVEL_LEGEND) expect(r.getAllByText(line.text).length).toBeGreaterThan(0);
    expect(legend).toBeTruthy();
  });

  it('the counts change nothing drawn: the same bubble with and without punch / RFIs', () => {
    const a = render(<Wrap><ProjectLevelCard project={FULL} pulse={pulse()} /></Wrap>);
    const xa = flat(a.getByTestId('project-level-vial-bubble', HIDDEN).props.style);
    const la = a.getByTestId('project-level-label').props.children;
    a.unmount();
    __resetJobLevelMemory();
    const b = render(<Wrap><ProjectLevelCard project={FULL} pulse={MONEY_PULSE} /></Wrap>);
    const xb = flat(b.getByTestId('project-level-vial-bubble', HIDDEN).props.style);
    expect(JSON.stringify(xb)).toBe(JSON.stringify(xa));
    expect(b.getByTestId('project-level-label').props.children).toBe(la);
  });

  it('partial with no baseline: a hollow centred bubble, the missing slip named', () => {
    const r = render(<Wrap><ProjectLevelCard project={NO_BASELINE} pulse={PARTIAL_PULSE} /></Wrap>);
    expect(r.getByTestId('project-level-label').props.children).toBe('No slip reading · Margin risk: low');
    const bubble = flat(r.getByTestId('project-level-vial-bubble', HIDDEN).props.style);
    expect(bubble.backgroundColor).toBe('transparent');
    expect(bubble.borderWidth).toBeGreaterThan(0);
  });

  it('no data still renders the card: the grey hollow vial and "Not enough data yet"', () => {
    const r = render(<Wrap><ProjectLevelCard project={NO_SCHEDULE} pulse={FIELD_PULSE} /></Wrap>);
    expect(r.getByTestId('project-level-card')).toBeTruthy();
    expect(r.getByTestId('project-level-label').props.children).toBe('Not enough data yet');
    expect(flat(r.getByTestId('project-level-vial-bubble', HIDDEN).props.style).backgroundColor).toBe('transparent');
    expect(r.queryByText(/Margin risk:/)).toBeNull();
  });

  it('S2 desktop: while the role resolves the card says "Loading margin…", laid out as a row', () => {
    mockWidth = 1512;
    const r = render(<Wrap><ProjectLevelCard project={NO_SCHEDULE} pulse={pulse({ role: null, canSeeMoney: false, roleLoading: true, risk: risk('high') })} /></Wrap>);
    expect(r.getByTestId('project-level-label').props.children).toBe('Loading margin…');
    expect(r.queryByText(/Margin risk:/)).toBeNull();
    // The legend's nearest laid-out ancestor is the desktop row (Level left, legend right).
    type Inst = { parent: Inst | null; props: { style?: unknown } };
    let up = (r.getByTestId('project-level-legend') as unknown as Inst).parent;
    let dir: unknown;
    for (let i = 0; up && i < 4 && dir === undefined; i++, up = up.parent) dir = flat(up.props.style).flexDirection;
    expect(dir).toBe('row');
  });

  it('a null project (an inert pulse) renders nothing', () => {
    const r = render(<Wrap><ProjectLevelCard project={FULL} pulse={INERT_PULSE} /></Wrap>);
    expect(r.queryByTestId('project-level-card')).toBeNull();
  });
});
