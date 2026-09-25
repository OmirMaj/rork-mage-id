/**
 * Wave 6c, lane F — Home (the portfolio) and the Needs-attention page.
 *
 * The founder, on a 1512 × 945 MacBook: "the website app... really isn't
 * utilizing the space a computer screen gives you". Lane F puts a sortable
 * portfolio table first on the desktop Home, makes the action rail the one
 * attention list (with 'See all' to a real /attention page), and fixes the
 * vanishing new job. Every one of those edits is `isDesktop && …`, a
 * `responsive.isDesktop ? <desktop/> : <today's JSX>` switch, a sheet frame
 * whose phone branch is null, or a 6b primitive whose phone branch returns
 * today's tree — so on the iPhone NOTHING may change except the reviewed C2
 * stage words. This file is the proof.
 *
 *  1. GOLDEN — recorded FIRST, on the untouched base (bdd5daee), before a
 *     single line of this lane was written. Each case mounts '/' inside the
 *     real app (the 16-provider stack, the populated fixture world) at
 *     390 × 844 iOS with useResponsiveLayout mocked to phone, and records the
 *     whole rendered tree — the create and next-step sheets included (every
 *     <Modal> renders its content here, open or not).
 *
 *     The C2 honesty copy (Home chips Active → Construction, Pre-construction
 *     → Pre-Con, Closeout → Post-Con, Closed → Closeout; ProjectCard and
 *     ProjectRow badges from utils/projectStage; ProjectRow 'Burn' → 'Billed')
 *     is the ONE reviewed phone delta: its goldens were regenerated once, after
 *     the layout pass had proved byte-equal, and the dump diff was a
 *     string-only diff (see the lane report).
 *
 *  2. TABLET (ios 820): Home still renders the ProjectRow table in the list
 *     footer — no DataTable, no rail.
 *
 *  3. DESKTOP (ios 1512 × 945 and 1100 × 800, isDesktop true): the portfolio
 *     table precedes Today on site; the rail is up at 1512 and Brain Watch is
 *     not inline; with the shell dock open the rail goes and Brain Watch comes
 *     back; at 1100 there is no rail and Brain Watch is inline.
 *
 * What a snapshot records: every style prop FLATTENED (a `false` left by
 * `isDesktop && …` renders nothing), handler props dropped, undefined props
 * dropped — the same fingerprint as w6c-field-phone.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { PROJECT_ID, ESTIMATE_ID, world } from '@/__tests__/fixtures/world';

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

// The shell dock, forced open for one desktop case. Both readers — the tabs
// layout's rail gate and Home's railShowing — go through useShellDock, so
// forcing its `content` is the dock being open as far as either can tell.
let mockDockOpen = false;
jest.mock('@/components/desktop/ShellDock', () => {
  const actual = jest.requireActual('@/components/desktop/ShellDock');
  return {
    ...actual,
    useShellDock: () => {
      const api = actual.useShellDock();
      return mockDockOpen ? { ...api, content: 'docked' } : api;
    },
  };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'android' | 'web', width: number, height: number) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockWidth = width;
  mockHeight = height;
  mockWeb = os === 'web';
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// Two clocks, both pinned (the GOLDEN_CLOCK pattern of w6c-field-phone): NOW is
// this realm's Date.now; GOLDEN_CLOCK is the outer realm's, which the fake
// timers renderRouter installs start from.
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T16:00:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;
let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  allowConsoleErrors();
});
afterEach(() => {
  mockDockOpen = false;
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
});

// ── What a snapshot records (identical to w6c-field-phone) ─────────────────
const flat = (style: unknown): ViewStyle => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as ViewStyle;
const KNOWN_IDS = new Set([PROJECT_ID, ESTIMATE_ID]);
const volatile = (s: string) => s
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, (m) => (KNOWN_IDS.has(m) ? m : '<uuid>'))
  .replace(/\b\d{13}[a-z0-9]{0,12}\b/g, '<ts-id>');
function small(v: unknown): string | null {
  try {
    const j = JSON.stringify(v);
    return j !== undefined && j.length <= 600 ? volatile(j) : null;
  } catch { return null; }
}
function dumpLines(node: unknown, depth: number, out: string[]): void {
  if (node == null) return;
  if (Array.isArray(node)) { for (const n of node) dumpLines(n, depth, out); return; }
  const pad = ' '.repeat(Math.min(depth, 200));
  if (typeof node !== 'object') { out.push(`${pad}"${volatile(String(node))}"`); return; }
  const el = node as { type: string; props: Record<string, unknown>; children: unknown };
  const parts: string[] = [];
  for (const k of Object.keys(el.props ?? {}).sort()) {
    const v = el.props[k];
    if (v === undefined || typeof v === 'function' || k === 'children' || k === 'screenId') continue;
    if (/style$/i.test(k) && v != null && typeof v === 'object') { parts.push(`${k}=${small(flat(v)) ?? '<big>'}`); continue; }
    if (typeof v === 'string') { parts.push(`${k}=${JSON.stringify(volatile(v))}`); continue; }
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

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

/** Five more jobs beside the fixture's one, one per status plus a second on
 *  site, so Home's stage chips render (they need >= 5 jobs or a non-active one). */
const MORE_PROJECTS = [
  { id: 'aaaaaaa1-0000-4000-8000-000000000001', name: 'Birch Street ADU', status: 'draft' },
  { id: 'aaaaaaa1-0000-4000-8000-000000000002', name: 'Cedar Court roof', status: 'estimated' },
  { id: 'aaaaaaa1-0000-4000-8000-000000000003', name: 'Dunmore bath', status: 'completed' },
  { id: 'aaaaaaa1-0000-4000-8000-000000000004', name: 'Elm deck rebuild', status: 'closed' },
  { id: 'aaaaaaa1-0000-4000-8000-000000000005', name: 'Fairview basement', status: 'in_progress' },
].map((p) => ({
  ...world.project,
  ...p,
  clientPortal: undefined,
  linkedEstimate: undefined,
  schedule: null,
}));

async function seedSixJobs() {
  await AsyncStorage.setItem('mageid_projects', JSON.stringify([world.project, ...MORE_PROJECTS]));
}

/** Six jobs on site today (a 7-day schedule running through the golden
 *  clock's date), so Today on site draws four rows and "+2 more". */
const onSiteTask = (id: string, title: string) => ({
  id, title, phase: 'General', durationDays: 90, startDay: 1, progress: 20, crew: '',
  dependencies: [], notes: '', status: 'in_progress',
});
const ON_SITE_PROJECTS = [0, 1, 2, 3, 4, 5].map((i) => ({
  ...world.project,
  id: `bbbbbbb${i}-0000-4000-8000-00000000000${i}`,
  name: `On-site job ${i + 1}`,
  clientPortal: undefined,
  linkedEstimate: undefined,
  status: 'in_progress',
  schedule: {
    id: `sched-${i}`, name: 'Plan', projectId: `bbbbbbb${i}-0000-4000-8000-00000000000${i}`,
    startDate: '2026-09-01', workingDaysPerWeek: 7, bufferDays: 0, riskItems: [], healthScore: 90,
    totalDurationDays: 90, criticalPathDays: 90, laborAlignmentScore: 90, createdAt: '2026-09-01', updatedAt: '2026-09-01',
    tasks: [onSiteTask(`t${i}a`, 'Framing'), onSiteTask(`t${i}b`, 'Rough plumbing'), ...(i === 0 ? [onSiteTask('t0c', 'Electrical'), onSiteTask('t0d', 'HVAC')] : [])],
  },
}));
async function seedOnSiteJobs() {
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(ON_SITE_PROJECTS));
}

async function mountHome(os: 'ios' | 'android', width: number, height: number, before?: () => Promise<void>) {
  env(os, width, height);
  await primeWorld('populated');
  if (before) await before();
  const tree = await mountRouteChecked('/');
  await pump();
  return tree;
}

// ── 1. GOLDEN, phone ───────────────────────────────────────────────────────
describe('lane F — the phone Home is unchanged (golden, 390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  it('Home, the fixture world (one job on site)', async () => {
    const tree = await mountHome('ios', 390, 844);
    expect(fingerprint('home-phone-one-job', tree.toJSON())).toMatchSnapshot();
  });

  it('Home, six jobs (the stage chips render)', async () => {
    const tree = await mountHome('ios', 390, 844, seedSixJobs);
    expect(screen.getByTestId('filter-chip-all')).toBeTruthy();
    expect(fingerprint('home-phone-six-jobs', tree.toJSON())).toMatchSnapshot();
  });

  it('Home, six jobs on site today (Today on site: four rows and "+2 more")', async () => {
    const tree = await mountHome('ios', 390, 844, seedOnSiteJobs);
    expect(screen.getByTestId('today-on-site-more')).toBeTruthy();
    expect(fingerprint('home-phone-on-site', tree.toJSON())).toMatchSnapshot();
  });

  it('Home, six jobs, a chip tapped (Closed / Closeout bucket)', async () => {
    const tree = await mountHome('ios', 390, 844, seedSixJobs);
    fireEvent.press(screen.getByTestId('filter-chip-closed'));
    await pump(2);
    expect(fingerprint('home-phone-six-jobs-closed', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 2. GOLDEN, tablet (ProjectRow table in the list footer) ────────────────
describe('lane F — the tablet Home keeps the ProjectRow table (golden, 820 iOS)', () => {
  jest.setTimeout(120000);

  it('Home, six jobs, tablet', async () => {
    const tree = await mountHome('ios', 820, 1180, seedSixJobs);
    expect(screen.queryByTestId('portfolio-table')).toBeNull();
    expect(screen.getByTestId(`project-row-${PROJECT_ID}`)).toBeTruthy();
    expect(fingerprint('home-tablet-six-jobs', tree.toJSON())).toMatchSnapshot();
  });
});

// ── 3. /attention on the phone (golden, recorded when the route was added) ─
// The route is new, so there is no pre-6c tree to equal: this pins that it
// mounts in both worlds (deep-linked — no phone entry point is added) and
// stays as recorded.
describe('lane F — /attention on the phone (390 iOS)', () => {
  jest.setTimeout(120000);

  it('/attention, populated world', async () => {
    env('ios', 390, 844);
    await primeWorld('populated');
    const tree = await mountRouteChecked('/attention');
    await pump();
    expect(screen.getByTestId('attention-screen')).toBeTruthy();
    expect(screen.queryByTestId('attention-table-search')).toBeNull(); // cards, not the desktop table
    expect(fingerprint('attention-phone-populated', tree.toJSON())).toMatchSnapshot();
  });

  it('/attention, empty world — the rail\'s all-clear, scoped', async () => {
    env('ios', 390, 844);
    await primeWorld('empty');
    const tree = await mountRouteChecked('/attention');
    await pump();
    expect(screen.getByText('All caught up')).toBeTruthy();
    expect(screen.getByText('Nothing overdue on schedules, invoices, permits or certs.')).toBeTruthy();
    expect(fingerprint('attention-phone-empty', tree.toJSON())).toMatchSnapshot();
  });

  it('/attention?view=bill reads the view from the URL', async () => {
    env('ios', 390, 844);
    await primeWorld('populated');
    await mountRouteChecked('/attention?view=bill');
    await pump();
    expect(screen.getByTestId('attention-view-bill').props.accessibilityState).toMatchObject({ selected: true });
  });
});

// ── 4. Desktop: the portfolio layout (behaviour, not pixels) ────────────────
const dumpText = (json: unknown) => { const out: string[] = []; dumpLines(json, 0, out); return out.join('\n'); };
const BRAIN_WATCH_INLINE = /things? needs? your attention|All clear — nothing overdue|waiting on a reply|Couldn't reach MAGE — showing/;

describe('lane F — desktop Home (1512 × 945 and 1100 × 800)', () => {
  jest.setTimeout(120000);

  it('1512: the table precedes Today on site; the rail is up; Brain Watch is not inline', async () => {
    const tree = await mountHome('ios', 1512, 945, async () => {
      await AsyncStorage.setItem('mageid_projects', JSON.stringify([...ON_SITE_PROJECTS, ...MORE_PROJECTS]));
    });
    const text = dumpText(tree.toJSON());
    const iTable = text.indexOf('testID="portfolio-table"');
    const iToday = text.indexOf('testID="today-on-site-');
    expect(iTable).toBeGreaterThan(-1);
    expect(iToday).toBeGreaterThan(-1);
    expect(iTable).toBeLessThan(iToday);
    expect(screen.getByTestId('desktop-action-rail')).toBeTruthy();
    expect(screen.queryAllByText(BRAIN_WATCH_INLINE)).toHaveLength(0);
    // The phone's chip rail and dense table are not drawn on desktop.
    expect(screen.queryByTestId('filter-chip-all')).toBeNull();
    expect(screen.getByTestId('stage-chip-precon')).toBeTruthy();
    // The labelled primary and the '+' menu both exist.
    expect(screen.getByTestId('home-new-project')).toBeTruthy();
    expect(screen.getByTestId('new-project-btn')).toBeTruthy();
    // The AI toggle and the two entries render once (the footer), not twice.
    expect(screen.getAllByTestId('ai-briefing-toggle')).toHaveLength(1);
    expect(screen.getAllByTestId('home-ask-mage')).toHaveLength(1);
  });

  it('1512 with the shell dock open: no rail, Brain Watch back inline', async () => {
    mockDockOpen = true;
    await mountHome('ios', 1512, 945, seedSixJobs);
    expect(screen.queryByTestId('desktop-action-rail')).toBeNull();
    expect(screen.queryAllByText(BRAIN_WATCH_INLINE).length).toBeGreaterThan(0);
    expect(screen.getByTestId('portfolio-table')).toBeTruthy();
  });

  it('1100: no rail, Brain Watch inline, the table present', async () => {
    await mountHome('ios', 1100, 800, seedSixJobs);
    expect(screen.queryByTestId('desktop-action-rail')).toBeNull();
    expect(screen.queryAllByText(BRAIN_WATCH_INLINE).length).toBeGreaterThan(0);
    expect(screen.getByTestId('portfolio-table')).toBeTruthy();
  });

  it('a job created while Construction is picked moves the filter to Pre-Con and is listed', async () => {
    await mountHome('ios', 1512, 945, seedSixJobs);
    // Six jobs, two on site: the reducer auto-picks Construction ('active').
    expect(screen.getByTestId('stage-chip-active').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByTestId('home-new-project'));
    await pump(2);
    // A 'Sample — ' name: ProjectContext.addProject skips the QuickBooks
    // push for samples, whose dynamic import() jest cannot run.
    fireEvent.changeText(screen.getByTestId('project-name-input'), 'Sample — Garfield kitchen');
    fireEvent.press(screen.getByTestId('create-project-btn'));
    await pump(3);
    expect(screen.getByTestId('stage-chip-precon').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getAllByText('Sample — Garfield kitchen').length).toBeGreaterThan(0);
  });

  it('PortfolioHomeLayout: an empty notice strip and an empty left column take no space', () => {
    env('ios', 1512, 945);
    // Called as a function (its only hook, useResponsiveLayout, is this file's
    // plain mock) and its element tree inspected — no render, so no act work
    // is left behind next to the Home mounts around it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PortfolioHomeLayout } = require('@/components/portfolio/PortfolioHomeLayout');
    type El = React.ReactElement<{ children?: React.ReactNode; testID?: string }>;
    const kids = (el: El) => React.Children.toArray(el.props.children) as El[];
    const QuietStrip = () => null; // NoticeStrip with nothing to show
    const strip = <QuietStrip />;
    const quiet = PortfolioHomeLayout({ header: null, notices: strip, table: <Text>table</Text>, belowLeft: null, belowRight: <Text>cards</Text>, footer: null }) as El;
    const [first, tableSlot, below] = kids(quiet);
    // The strip is a direct child — no wrapper View that would stay a flex
    // child (and cost a 24 px gap) when the strip renders null.
    expect(first.type).toBe(QuietStrip);
    expect(tableSlot.props.testID).toBe('portfolio-home-table-slot');
    // Nobody on site: only the cards column, full width.
    expect(kids(below).map((k) => k.props.testID)).toEqual(['portfolio-home-below-right']);
    const busy = PortfolioHomeLayout({ header: null, notices: strip, table: <Text>table</Text>, belowLeft: <Text>today</Text>, belowRight: <Text>cards</Text> }) as El;
    expect(kids(kids(busy)[2]).map((k) => k.props.testID)).toEqual(['portfolio-home-below-left', 'portfolio-home-below-right']);
  });

  it('/attention at 1512: the needs table, and no rail beside its own page', async () => {
    env('ios', 1512, 945);
    await primeWorld('populated');
    await mountRouteChecked('/attention');
    await pump();
    expect(screen.getByTestId('attention-screen')).toBeTruthy();
    expect(screen.queryByTestId('desktop-action-rail')).toBeNull();
  });
});

// ── 5. Unit renders at a forced phone ───────────────────────────────────────
describe('lane F — primitives at a phone width', () => {
  const METRICS = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  };
  const Wrap = ({ children }: { children: React.ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
  );

  it('PortfolioTable returns only the ProjectRow cards', () => {
    env('ios', 390, 844);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PortfolioTable } = require('@/components/portfolio/PortfolioTable');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { buildPortfolioRows } = require('@/utils/portfolio/portfolioRow');
    const projects = [world.project, ...MORE_PROJECTS];
    // One job with a known contract, so the desktop-only basis note would
    // render here if it leaked past the gate.
    const burnByProject = new Map([[world.project.id, { invoicedToDate: 1, revisedContract: 2 }]]);
    const rows = buildPortfolioRows({ projects, invoices: [], changeOrders: [], rfis: [], punchItems: [], burnByProject, now: new Date(GOLDEN_CLOCK) });
    expect(rows.some((row: { contract: number | null }) => row.contract != null)).toBe(true);
    const r = render(
      <Wrap><ThemeProvider><View>
        <PortfolioTable projects={projects} rows={rows} burnByProject={burnByProject} onOpenActions={() => {}} onOpenProject={() => {}} />
      </View></ThemeProvider></Wrap>,
    );
    expect(r.queryByTestId('portfolio-table')).toBeNull();
    expect(r.queryByTestId('portfolio-table-contract-basis')).toBeNull();
    for (const p of projects) expect(r.getByTestId(`project-row-${p.id}`)).toBeTruthy();
    expect(r.queryByText('Search jobs')).toBeNull();
  });

  it("BrainWatchCard's overflow stays a plain line on the phone (no link)", () => {
    env('ios', 390, 844);
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'components', 'home', 'BrainWatchCard.tsx'), 'utf8') as string; // eslint-disable-line @typescript-eslint/no-require-imports
    // The phone branch is today's Text, byte for byte; the link is behind isDesktop.
    expect(src).toMatch(/isDesktop \? \([\s\S]*?<RowLink[\s\S]*?\) : \(\s*<Text style=\{styles\.overflowHint\}>\s*\+\{items\.length - MAX_VISIBLE\} more — open each screen to review\s*<\/Text>\s*\)\)\}/);
  });
});

void Text;
