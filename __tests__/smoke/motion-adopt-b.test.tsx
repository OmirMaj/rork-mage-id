/**
 * Smoke — wave 4 motion adoption, part B (lane MOTIONADOPT-B).
 *
 * THE PROMISES THIS PROVES (spec §4):
 *   T1 the onboarding checklist: steps done at mount never tick; a step he
 *      completes while Home is focused ticks exactly once; a completion while
 *      Home is in the background ticks only when Home is focused again; data
 *      that LANDS done (the project list hydrating, Stripe answering) never
 *      ticks;
 *   T2 the estimate summary's "Line items" counter (the wizard's exact
 *      AccumulateCards wiring over breakdownSteps of a 7-category result):
 *      the shown text steps through shownSteps (≤ 6) and ends on the exact
 *      sum of the rows, its accessibilityLabel is the final figure at every
 *      step, and the row figures never change;
 *   T3 schedule health: a failing worst check gets one rule; all-good gets
 *      none; 12 checks → exactly cells 0-7 animate; reduced → no transform;
 *   T4 every Animated.timing / spring from these sites passes
 *      useNativeDriver === nativeDriver (mocked false here, so a literal
 *      `true` anywhere shows up).
 *
 * The wizard's own wiring of T2 (items from breakdownSteps, the 2-decimal
 * format, no label on the total row) is pinned as source text by
 * scripts/validate-motion-adopt-b.ts VB3.
 */

import React from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { act, cleanupAsync, render } from '@testing-library/react-native';

let mockReduced = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, nativeDriver: false, reducedMotion: () => mockReduced, useReducedMotion: () => mockReduced };
});

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

// expo-router's useFocusEffect semantics: the callback runs on focus, and
// again when it changes while focused; never while the screen is blurred.
// Focus is a navigation event, not a prop, so it is a tiny external store.
let mockFocused = true;
const mockFocusListeners = new Set<() => void>();
function setFocused(next: boolean) {
  mockFocused = next;
  act(() => { mockFocusListeners.forEach((l) => l()); });
}
jest.mock('expo-router', () => {
  const R = jest.requireActual('react');
  return {
    useRouter: () => ({ push: () => {}, back: () => {}, replace: () => {} }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      const focused = R.useSyncExternalStore(
        (l: () => void) => { mockFocusListeners.add(l); return () => { mockFocusListeners.delete(l); }; },
        () => mockFocused,
      );
      R.useEffect(() => (focused ? cb() : undefined), [cb, focused]);
    },
  };
});

let mockLoaded = { projectsLoaded: true, settingsLoaded: true, invoicesLoaded: true };
jest.mock('@/contexts/ProjectContext', () => ({
  useProjects: () => ({ projects: [], userRole: 'contractor', ...mockLoaded }),
}));
jest.mock('@/contexts/SubscriptionContext', () => ({ useSubscription: () => ({ tier: 'pro' }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/hooks/useTierAccess', () => ({ useTierAccess: () => ({ canAccess: () => true }) }));
jest.mock('@/utils/tutorial/progress', () => ({ useTutorialProgress: () => ({ progress: {} }) }));
jest.mock('@/utils/tutorial/store', () => ({ startTutorial: async () => {} }));
jest.mock('@/utils/tutorial/entryPoints', () => ({ checklistShowMe: () => null }));
jest.mock('@/utils/analytics', () => ({ track: () => {}, AnalyticsEvents: { TUTORIAL_OFFERED: 'tutorial_offered' } }));
jest.mock('@/utils/aiRateLimiter', () => ({ getFreeTrialsRemaining: async () => 2 }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return { ...actual, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

/* eslint-disable import/first */
import { OnboardingChecklist, type OnboardingChecklistProps } from '@/components/OnboardingChecklist';
import { ScheduleHealthDetail } from '@/components/schedule/ScheduleHealthScore';
import { AccumulateCards, resetBudget } from '@/components/motion/kit';
import { breakdownSteps } from '@/utils/estimateBreakdownSteps';
import { partialSums, shownSteps } from '@/utils/motion/kit/accumulate';
import { formatMoney } from '@/utils/formatters';
import type { HealthCheck, HealthScoreResult } from '@/utils/scheduleHealthScore';
/* eslint-enable import/first */

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
const flat = (s: unknown) => (StyleSheet.flatten(s as StyleProp<ViewStyle>) ?? {}) as Record<string, unknown>;
function nodes(json: unknown, out: Node[] = []): Node[] {
  if (!json || typeof json !== 'object') return out;
  if (Array.isArray(json)) { json.forEach((j) => nodes(j, out)); return out; }
  const n = json as Node;
  out.push(n);
  (n.children ?? []).forEach((c) => nodes(c, out));
  return out;
}
const transformKeys = (n: Node) => ((flat(n.props.style).transform ?? []) as Record<string, number>[]).flatMap((t) => Object.keys(t));
const moving = (n: Node) => {
  const s = flat(n.props.style);
  return (typeof s.opacity === 'number' && s.opacity < 1) || transformKeys(n).length > 0;
};
const textOf = (n: Node | string): string => (typeof n === 'string' ? n : (n.children ?? []).map(textOf).join(''));
const advance = (ms: number) => { for (let left = ms; left > 0; left -= 16) act(() => { jest.advanceTimersByTime(Math.min(16, left)); }); };
const flush = async () => { await act(async () => { for (let k = 0; k < 10; k++) await Promise.resolve(); }); };

// T4: every timing / spring the adopted sites (and the kit parts they mount) start.
const SITE = /OnboardingChecklist|ScheduleHealthScore|estimateBreakdownSteps|motion\/kit/;
const driverCalls: { d: unknown; at: string }[] = [];
function noteCall(d: unknown) {
  const stack = new Error().stack ?? '';
  const frames = stack.split('\n').slice(2).filter((f) => !/node_modules|motion-adopt-b\.test/.test(f));
  if (frames.some((f) => SITE.test(f))) driverCalls.push({ d, at: frames[0] ?? '' });
}
const realTiming = Animated.timing;
const realSpring = Animated.spring;

beforeAll(() => {
  jest.spyOn(Animated, 'timing').mockImplementation((v, c) => { noteCall(c.useNativeDriver); return realTiming(v, c); });
  jest.spyOn(Animated, 'spring').mockImplementation((v, c) => { noteCall(c.useNativeDriver); return realSpring(v, c); });
});
beforeEach(() => {
  jest.useFakeTimers();
  mockReduced = false;
  mockFocused = true;
  mockLoaded = { projectsLoaded: true, settingsLoaded: true, invoicesLoaded: true };
  resetBudget();
});
afterEach(async () => {
  await cleanupAsync();
  jest.useRealTimers();
});

// ── T1 the onboarding checklist ─────────────────────────────────────────────

const BASE: OnboardingChecklistProps = {
  companyInfoDone: false, projectCount: 0, estimateCount: 0, stripeConnected: false, invoiceCount: 0, triedWowFeature: true,
};
/** The DoneGlyph's check landing: the only scale in the checklist (the card's own enter is a translateY). */
const ticking = (json: unknown) => nodes(json).filter((n) => transformKeys(n).includes('scale'));

async function mountChecklist(p: Partial<OnboardingChecklistProps> = {}) {
  const r = render(<OnboardingChecklist {...BASE} {...p} />);
  await flush();
  advance(600); // the card's own enter finishes
  return r;
}

describe('T1 the onboarding checklist ticks a step he just did', () => {
  it('done at mount: no tick; a focused completion: exactly one; it settles to rest', async () => {
    const r = await mountChecklist({ companyInfoDone: true });
    expect(r.getByTestId('onboarding-checklist-project')).toBeTruthy();
    expect(ticking(r.toJSON())).toHaveLength(0);
    r.rerender(<OnboardingChecklist {...BASE} companyInfoDone projectCount={1} />);
    expect(ticking(r.toJSON())).toHaveLength(1);
    advance(1200);
    // At rest: the first render after the entrance ends drops the style (null).
    r.rerender(<OnboardingChecklist {...BASE} companyInfoDone projectCount={1} estimateCount={0} />);
    r.rerender(<OnboardingChecklist {...BASE} companyInfoDone projectCount={3} />);
    expect(ticking(r.toJSON())).toHaveLength(0);
    // A re-render never re-ticks a step already seen.
    r.rerender(<OnboardingChecklist {...BASE} companyInfoDone projectCount={2} />);
    expect(ticking(r.toJSON())).toHaveLength(0);
  });

  it('a completion while Home is in the background ticks only when Home is focused again', async () => {
    const r = await mountChecklist();
    setFocused(false);
    r.rerender(<OnboardingChecklist {...BASE} companyInfoDone />);
    expect(ticking(r.toJSON())).toHaveLength(0);
    setFocused(true);
    expect(ticking(r.toJSON())).toHaveLength(1);
  });

  it('data that lands done (projects hydrating, Stripe answering) never ticks', async () => {
    mockLoaded = { projectsLoaded: false, settingsLoaded: true, invoicesLoaded: true };
    const r = await mountChecklist({ stripeConnected: undefined });
    mockLoaded = { projectsLoaded: true, settingsLoaded: true, invoicesLoaded: true };
    r.rerender(<OnboardingChecklist {...BASE} stripeConnected={undefined} projectCount={1} />);
    expect(ticking(r.toJSON())).toHaveLength(0);
    r.rerender(<OnboardingChecklist {...BASE} stripeConnected projectCount={1} />);
    expect(ticking(r.toJSON())).toHaveLength(0);
  });

  it('two steps seen at once tick on two glyphs (the kit\'s beats)', async () => {
    const r = await mountChecklist();
    r.rerender(<OnboardingChecklist {...BASE} companyInfoDone projectCount={1} />);
    expect(ticking(r.toJSON())).toHaveLength(2);
  });

  it('Reduce Motion: the glyph fades, nothing scales', async () => {
    mockReduced = true;
    const r = await mountChecklist();
    r.rerender(<OnboardingChecklist {...BASE} companyInfoDone />);
    const all = nodes(r.toJSON());
    expect(all.some((n) => transformKeys(n).includes('scale'))).toBe(false);
    expect(all.filter((n) => moving(n)).length).toBeGreaterThanOrEqual(1);
  });
});

// ── T2 the estimate summary's "Line items" counter ──────────────────────────

const ROWS = [
  { cat: 'Cabinets', subtotal: 18_450.25 },
  { cat: 'Labor', subtotal: 12_300.1 + 0.2 },
  { cat: 'Countertops', subtotal: 7_820.99 },
  { cat: 'Plumbing', subtotal: 4_105.5 },
  { cat: 'Electrical', subtotal: 3_388.07 },
  { cat: 'Flooring', subtotal: 2_640.33 },
  { cat: 'Paint', subtotal: 0.1 + 0.2 },
];

function Summary({ armed }: { armed: boolean }) {
  // The wizard's wiring (app/estimate-wizard.tsx, pinned by VB3).
  const breakdown = breakdownSteps(ROWS);
  return (
    <AccumulateCards
      testID="estimate-breakdown"
      armed={armed}
      format={(c) => formatMoney(c / 100, 2)}
      items={breakdown.items.map(({ key, cents }) => ({
        key,
        cents,
        render: (enter) => (
          <Animated.View style={enter} testID={`row-${key}`}>
            <Text>{key}</Text>
            <Text testID={`fig-${key}`}>{formatMoney(cents / 100, 2)}</Text>
          </Animated.View>
        ),
      }))}
      renderTotal={(roll) => (
        <View testID="estimate-breakdown-total">
          <Text>Line items</Text>
          {roll}
        </View>
      )}
    />
  );
}

describe('T2 the "Line items" counter lands on the exact cent', () => {
  it('steps through the real running sums (≤ 6) and ends on Σ rows; the label is final throughout', () => {
    const steps = breakdownSteps(ROWS);
    const sums = partialSums(steps.items.map((i) => i.cents));
    const expected = shownSteps(sums).map((c) => formatMoney(c / 100, 2));
    const final = formatMoney(steps.totalCents / 100, 2);
    // Σ of the rows as he reads them, to the cent.
    const rowSum = ROWS.reduce((s, r) => s + Math.round(r.subtotal * 100), 0);
    expect(steps.totalCents).toBe(rowSum);
    expect(final).toBe(formatMoney(rowSum / 100, 2));
    expect(expected.length).toBeLessThanOrEqual(6);

    const r = render(<Summary armed />);
    const figs = () => ROWS.map((row) => textOf(r.getByTestId(`fig-${row.cat}`).props.children as never));
    const figs0 = figs();
    const seen: string[] = [];
    for (let t = 0; t < 1200; t += 8) {
      const total = nodes(r.toJSON()).find((n) => n.props.testID === 'estimate-breakdown-total') as Node;
      const roll = nodes(total).find((n) => n.props.accessibilityLabel !== undefined);
      const label = nodes(r.toJSON()).filter((n) => n.props.accessibilityLabel === final);
      expect(label.length).toBe(1);
      expect(roll?.props.accessibilityLabel).toBe(final);
      // The visible layer (the arriving figure), never the hidden sizer.
      const layers = nodes(total).filter((n) => n.type === 'Text' && n.props.accessibilityElementsHidden && flat(n.props.style).position === 'absolute');
      const shown = layers.length ? textOf(layers[layers.length - 1]) : null;
      if (shown && seen[seen.length - 1] !== shown) seen.push(shown);
      expect(figs()).toEqual(figs0);
      act(() => { jest.advanceTimersByTime(8); });
    }
    expect(seen).toEqual(expected);
    expect(seen[seen.length - 1]).toBe(final);
  });

  it('never armed (a revisit, an edit): a plain figure, no motion', () => {
    const r = render(<Summary armed={false} />);
    expect(nodes(r.toJSON()).some(moving)).toBe(false);
    expect(r.getByText(formatMoney(breakdownSteps(ROWS).totalCents / 100, 2))).toBeTruthy();
  });

  it('Reduce Motion: the total shows its final figure at once', () => {
    mockReduced = true;
    const r = render(<Summary armed />);
    const final = formatMoney(breakdownSteps(ROWS).totalCents / 100, 2);
    expect(r.getAllByText(final).length).toBeGreaterThanOrEqual(1);
    expect(nodes(r.toJSON()).some((n) => transformKeys(n).length > 0)).toBe(false);
  });
});

// ── T3 schedule health ──────────────────────────────────────────────────────

function check(key: string, value: number, severity: HealthCheck['severity']): HealthCheck {
  return { key: key as HealthCheck['key'], label: key, description: `${key} check`, value, weight: 1, flagged: [], severity, suggestion: 'Do the thing.' } as HealthCheck;
}
function health(checks: HealthCheck[]): HealthScoreResult {
  return { score: 72, grade: 'C', summary: 'Some things to fix.', checks, computedAt: '2026-10-02T00:00:00Z' } as HealthScoreResult;
}
const RULE = (n: Node) => {
  const s = flat(n.props.style);
  return s.position === 'absolute' && s.height === 2 && s.top === 0 && s.left === 0 && s.right === 0;
};
/** The per-cell entrance views: the direct child of each 100%-wide cell. */
function cellEntrances(json: unknown): Node[] {
  return nodes(json).filter((n) => flat(n.props.style).width === '100%' && flat(n.props.style).padding === 0)
    .map((cell) => (cell.children ?? [])[0] as Node);
}

describe('T3 schedule health: the worst failing check gets "start here"', () => {
  it('a failing worst check → one rule, on that cell', () => {
    const r = render(<ScheduleHealthDetail visible onClose={() => {}} result={health([check('logic', 0.9, 'good'), check('float', 0.2, 'bad'), check('leads', 0.6, 'warn')])} />);
    const grid = nodes(r.toJSON()).find((n) => n.props.testID === 'schedule-health-checks');
    const rules = nodes(r.toJSON()).filter(RULE);
    expect(rules).toHaveLength(1);
    const cells = cellEntrances(r.toJSON());
    expect(cells).toHaveLength(3);
    expect(nodes(cells[0]).some(RULE)).toBe(true);
    expect(grid).toBeTruthy();
  });

  it('every check good → no rule', () => {
    const r = render(<ScheduleHealthDetail visible onClose={() => {}} result={health([check('logic', 1, 'good'), check('float', 0.95, 'good')])} />);
    expect(nodes(r.toJSON()).filter(RULE)).toHaveLength(0);
  });

  it('12 checks → exactly cells 0-7 carry a motion style', () => {
    const checks = Array.from({ length: 12 }, (_, i) => check(`c${i}`, 0.3 + i * 0.05, i < 3 ? 'bad' : 'good'));
    const r = render(<ScheduleHealthDetail visible onClose={() => {}} result={health(checks)} />);
    const cells = cellEntrances(r.toJSON());
    expect(cells).toHaveLength(12);
    expect(cells.map((c) => moving(c))).toEqual(cells.map((_, i) => i < 8));
  });

  it('Reduce Motion → no transform anywhere in the list', () => {
    mockReduced = true;
    const r = render(<ScheduleHealthDetail visible onClose={() => {}} result={health([check('float', 0.2, 'bad'), check('logic', 0.9, 'good')])} />);
    const list = nodes(r.toJSON()).find((n) => n.props.testID === 'schedule-health-checks') as Node;
    expect(nodes(list).some((n) => transformKeys(n).length > 0)).toBe(false);
    advance(800);
    expect(nodes(r.toJSON()).filter(RULE)).toHaveLength(1);
  });
});

// ── T4 the native driver ────────────────────────────────────────────────────

describe('T4 every timing / spring from the adopted sites passes nativeDriver', () => {
  it('saw calls, all false (= nativeDriver, mocked)', () => {
    expect(driverCalls.length).toBeGreaterThan(10);
    expect(driverCalls.filter((c) => c.d !== false).map((c) => `${String(c.d)} ${c.at}`)).toEqual([]);
  });
});
