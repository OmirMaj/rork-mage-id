/**
 * Wave 6d, lane Z2 — the closeout. PHONE PROOF.
 *
 * Z2 edits seven phone screens for the desktop (contract's Save / Sign row,
 * dev-ar-measure's two primary CTAs, construction-ai's review sheets and
 * loaders, useProjects() identity) and changes four strings the founder
 * sanctioned (construction-ai's "Unlimited … today" lines, the onboarding
 * paywall's Business tagline, the daily report's weather chip place, the
 * weather-reschedule notice). On the iPhone NOTHING else may move.
 *
 *  1. GOLDEN — recorded FIRST, on a pristine archive of the base commit
 *     (c1086c0c), before a single line of this lane was written, and never
 *     regenerated. Each case mounts a real route inside the real app (the
 *     16-provider stack, the populated fixture world) at 390 × 844 iOS with
 *     useResponsiveLayout mocked to phone and records the whole tree — every
 *     <Modal> renders its content, open or not (w6c-field-phone's mock), so
 *     construction-ai's inspection / result / code-result sheets and its two
 *     loaders are in the tree.
 *
 *     THE SANCTIONED STRINGS ARE MASKED. Each is recorded as one token for its
 *     old AND its new wording (SANCTIONED below), so the golden stays byte-
 *     identical across the change and proves that nothing ELSE moved. What the
 *     new wording is, is asserted separately in section 2 — those assertions
 *     fail on the base, by design.
 *
 *     The daily report's 'United States' golden answers wttr.in only for the
 *     Park Slope query (every other URL gets the harness's default `{}` body,
 *     which carries no reading), so the base tree and the new tree are the
 *     same: no reading, no chip. What changed there is BEHAVIOUR — the base
 *     fetched 'United States' and, with a real answer, printed "…for United
 *     States." — and section 2 asserts the new behaviour (no request at all).
 *
 *  2. DELTAS — the sanctioned strings and behaviour, asserted outright.
 *
 * What a snapshot records: w6c-field-phone's one-line-per-host-node dump
 * (styles flattened, handlers and undefined props dropped), reduced to its
 * line count and sha256. Set W6D_DUMP_DIR to write each dump for a diff.
 */

import React from 'react';
import { Dimensions, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { allowConsoleErrors } from '@/__tests__/setup/strict-mode';
import { stripSanctioned } from '@/__tests__/helpers/sanctionedStrip';
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';

// App Store wave (APPPAY item 3): on a phone with no store packages — this
// harness has no RevenueCat key — the onboarding paywall shows one honest
// "Plans couldn't load" state instead of the plan cards. The tagline case
// below supplies two Business packages so the cards render; every other case
// sees the real (keyless) subscription state.
let mockStorePackages: Record<string, unknown> | null = null;
jest.mock('@/contexts/SubscriptionContext', () => {
  const actual = jest.requireActual('@/contexts/SubscriptionContext');
  return {
    ...actual,
    useSubscription: () => {
      const real = actual.useSubscription();
      return mockStorePackages ? { ...real, ...mockStorePackages } : real;
    },
  };
});

// ── The layout gate (phone) ────────────────────────────────────────────────
let mockWidth = 390;
let mockHeight = 844;
jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => {
    const isDesktop = mockWidth >= 1024;
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

// Every Modal renders its content, open or closed (w6c-field-phone's mock).
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
        testID: 'w6d-modal',
        accessibilityHint: JSON.stringify({ visible: visible ?? null, transparent: transparent ?? null, animationType: animationType ?? null, presentationStyle: presentationStyle ?? null }),
      },
      ReactActual.createElement(Boundary, null, children),
    );
  }
  return { __esModule: true, default: Modal };
});

// ── Environment ────────────────────────────────────────────────────────────
let restoreOS: (() => void) | null = null;
function env(os: 'ios' | 'android', width: number, height: number) {
  restoreOS?.();
  restoreOS = os === Platform.OS ? null : jest.replaceProperty(Platform, 'OS', os).restore;
  mockWidth = width;
  mockHeight = height;
  Dimensions.set({
    window: { width, height, scale: 2, fontScale: 1 },
    screen: { width, height, scale: 2, fontScale: 1 },
  });
}

// Two clocks, both pinned (see w6c-field-phone for why the OUTER realm's Date
// has to be pinned too: renderRouter's fake clock starts from it). The fake
// clock is 10:31 AM in New York on a Friday, so the new daily report is
// today's report and the weather chip's read time is fixed.
const NOW = new Date('2026-08-15T15:00:00.000Z').getTime();
const GOLDEN_CLOCK = new Date('2026-09-25T14:31:00.000Z').getTime();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const outerFs = require('node:fs') as { readFileSync: { constructor: FunctionConstructor } };
const OuterDate = outerFs.readFileSync.constructor('return Date')() as DateConstructor;

// What OpenWeather's current-conditions endpoint answers for the jobsite. The
// service's transport is replaced below, so no request leaves the test.
const OPENWEATHER_NOW = {
  name: 'Park Slope', main: { temp: 61.3 }, weather: [{ main: 'Clouds', description: 'scattered clouds' }], wind: { speed: 8.2, deg: 315 },
};
/** Every location the daily report asked the weather service about. */
const currentAsks: unknown[] = [];
/** False: the service answers nothing (no key, no signal). */
let currentAnswers = true;
const PARK_SLOPE = '124 Park Slope, Brooklyn NY';

const realFetch = global.fetch;
const fetchCalls: string[] = [];
function mockWttr() {
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    fetchCalls.push(url);
    const body = {};
    return {
      ok: true, status: 200, statusText: 'OK',
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
      clone() { return this; },
    };
  }) as unknown as typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ws = require('@/utils/weatherService') as typeof import('@/utils/weatherService');
  ws.__setCurrentWeatherTransportForTests(async (location) => {
    currentAsks.push(location);
    // Calculated a minute ago on the screen's own clock.
    return currentAnswers ? { cod: 200, dt: Math.floor(new Date().getTime() / 1000) - 60, ...OPENWEATHER_NOW } : null;
  });
}

let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  fetchCalls.length = 0;
  currentAsks.length = 0;
  currentAnswers = true;
  allowConsoleErrors();
});
afterEach(() => {
  nowSpy?.mockRestore();
  nowSpy = null;
  outerNowSpy?.mockRestore();
  outerNowSpy = null;
  restoreOS?.();
  restoreOS = null;
  global.fetch = realFetch;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('@/utils/weatherService') as typeof import('@/utils/weatherService')).__setCurrentWeatherTransportForTests(null);
});

// ── What a snapshot records ────────────────────────────────────────────────
/** Old wording and new wording of each sanctioned string → one token. */
const SANCTIONED: Array<[RegExp, string]> = [
  [/Unlimited code checks today|No daily cap on code checks · each run counts toward your AI requests/g, '<W6:code-check-cap>'],
  [/Unlimited roadmaps today|No daily cap on roadmaps · each run counts toward your AI requests/g, '<W6:roadmap-cap>'],
  [/Teams & unlimited|Teams · 5 office seats|Teams · 5 office team members/g, '<W6:business-tagline>'],
  [/ for (?:124 Park Slope, Brooklyn NY|Park Slope, New York)\./g, ' for <W7:weather-place>.'],
  [/Set EXPO_PUBLIC_OPENWEATHER_API_KEY for live weather\.|Live weather isn't available for this (?:job|project) right now\./g, '<W7:reschedule-notice>'],
  // IR-L4 (2026-09-25): founder-approved copy change; mapped back to the recorded wording so the golden still proves nothing ELSE moved.
  [/Code guidance for your jurisdiction's adopted edition, permit roadmaps and inspection prep\./g, 'Look up building codes, permits, and inspection requirements.'],
];
const mask = (s: string) => SANCTIONED.reduce((acc, [re, token]) => acc.replace(re, token), s);

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
  json = stripSanctioned(json);
  const out: string[] = [];
  dumpLines(json, 0, out);
  const text = mask(out.join('\n'));
  const dir = process.env.W6D_DUMP_DIR;
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

/** Every string in the rendered tree, joined — for the delta assertions. */
function allText(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const n of node) allText(n, out); return out; }
  const el = node as { children?: unknown };
  if (el.children) allText(el.children, out);
  return out;
}

async function pump(n = 6) {
  for (let i = 0; i < n; i++) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

async function setProjectLocation(location: string) {
  const raw = await AsyncStorage.getItem('mageid_projects');
  const projects = JSON.parse(raw ?? '[]') as Array<Record<string, unknown>>;
  const next = projects.map((p) => (p.id === PROJECT_ID
    ? { ...p, location, locationLatitude: undefined, locationLongitude: undefined, locationGeocodedAt: undefined }
    : p));
  await AsyncStorage.setItem('mageid_projects', JSON.stringify(next));
}

async function phoneRoute(url: string, before?: () => Promise<void>) {
  env('ios', 390, 844);
  await primeWorld('populated');
  if (before) await before();
  const tree = await mountRouteChecked(url);
  await pump();
  return tree;
}

const P = `projectId=${PROJECT_ID}`;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const Wrap = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>
);

/** A fully simulated weather reschedule with one rained-out pour. */
function simulatedReschedule() {
  return {
    tasks: [],
    impacts: [{
      taskId: 't1', title: 'Pour footings', phase: 'Foundation', weatherDelayDays: 2, startSlipDays: 2,
      badDates: ['2026-09-28', '2026-09-29'], worstCondition: 'rain' as const, originalStartDay: 10, newStartDay: 12, directlyHit: true,
    }],
    projectSlipDays: 2,
    directHitCount: 1,
    cascadedCount: 0,
    affectedDates: ['2026-09-28', '2026-09-29'],
    liveAffectedDates: [],
    simulatedAffectedDates: ['2026-09-28', '2026-09-29'],
    forecastSource: 'simulated' as const,
  };
}

async function mountDailyReport(location: string) {
  return phoneRoute(`/daily-report?${P}`, async () => {
    await setProjectLocation(location);
    mockWttr();
  });
}

async function mountConstructionAi(tier: 'enterprise' | 'pro', roadmap = false) {
  const tree = await phoneRoute('/construction-ai', async () => {
    await AsyncStorage.setItem('mageid_subscription_tier', tier);
  });
  if (roadmap) {
    fireEvent.press(screen.getByTestId('mode-toggle-roadmap'));
    await pump();
  }
  return tree;
}

function mountReschedule() {
  env('ios', 390, 844);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const WeatherRescheduleModal = require('@/components/schedule/WeatherRescheduleModal').default;
  return render(
    <Wrap><ThemeProvider><View>
      <WeatherRescheduleModal
        visible
        result={simulatedReschedule()}
        projectStartDate={new Date(2026, 8, 1, 12)}
        onClose={() => {}}
        onApply={() => {}}
      />
    </View></ThemeProvider></Wrap>,
  );
}

// ── 1. GOLDEN, phone ───────────────────────────────────────────────────────
describe('Z2 golden — the phone is unchanged (390 × 844 iOS)', () => {
  jest.setTimeout(120000);

  it('(a) contract with a draft (the Save draft / Sign & send row)', async () => {
    const tree = await phoneRoute(`/contract?${P}`);
    expect(screen.getByText('Save Draft')).toBeTruthy();
    expect(fingerprint('a-contract-draft', tree.toJSON())).toMatchSnapshot();
  });

  // Lane DFRWEATHER (2026-10-06): the daily report fills today's weather by
  // itself again, from OpenWeather's current conditions through
  // utils/weatherService.ts (content rights, 2026-10-03, had removed the old
  // read from an unlicensed service). NAMED DELTA in both goldens below, one
  // re-record each: the Refresh control is back in the Weather header; b1 gains
  // the reading, its "From OpenWeather at <time> <UTC offset>." line and OpenWeather's
  // credit ("1 of 5 filled"); b2 (a country on its own is no location) gains
  // the one quiet line and nothing else. The W6D_DUMP_DIR diff against the
  // base daily-report.tsx shows those lines are the only change.
  // (The test names keep their old wording: they are the snapshot keys.)
  it('(b1) daily-report, new report, jobsite 124 Park Slope (wttr answers)', async () => {
    const tree = await mountDailyReport(PARK_SLOPE);
    expect(fetchCalls.filter((u) => u.includes('wttr.in'))).toEqual([]);
    expect(currentAsks).toHaveLength(1);
    expect(screen.getByTestId('dfr-weather-provenance').props.children).toMatch(/^From OpenWeather at \d{1,2}:\d{2} [AP]M UTC(?:[+-]\d{1,2}(?::\d{2})?)?\.$/);
    expect(screen.getByTestId('weather-credit')).toBeTruthy();
    expect(screen.getByText('Weather data provided by OpenWeather')).toBeTruthy();
    expect(screen.getByDisplayValue('61°F')).toBeTruthy();
    expect(screen.getByDisplayValue('Scattered clouds')).toBeTruthy();
    expect(screen.getByDisplayValue('8 mph NW')).toBeTruthy();
    expect(screen.getByTestId('dfr-weather-refresh')).toBeTruthy();
    expect(screen.queryByTestId('dfr-weather-quiet-line')).toBeNull();
    expect(fingerprint('b1-daily-report-park-slope', tree.toJSON())).toMatchSnapshot();
  });

  it("(b2) daily-report, new report, location 'United States'", async () => {
    const tree = await mountDailyReport('United States');
    expect(currentAsks).toEqual([]);
    expect(screen.queryByTestId('dfr-weather-provenance')).toBeNull();
    expect(screen.queryByTestId('weather-credit')).toBeNull();
    expect(screen.getByTestId('dfr-weather-quiet-line').props.children).toBe('Live weather is not available right now. Type what you saw.');
    expect(fingerprint('b2-daily-report-united-states', tree.toJSON())).toMatchSnapshot();
  });

  it('(c1) construction-ai, tier enterprise (Code Check)', async () => {
    const tree = await mountConstructionAi('enterprise');
    expect(fingerprint('c1-construction-ai-enterprise', tree.toJSON())).toMatchSnapshot();
  });

  it('(c2) construction-ai, tier enterprise (Project Roadmap)', async () => {
    const tree = await mountConstructionAi('enterprise', true);
    expect(fingerprint('c2-construction-ai-enterprise-roadmap', tree.toJSON())).toMatchSnapshot();
  });

  it('(c3) construction-ai, tier pro (Code Check)', async () => {
    const tree = await mountConstructionAi('pro');
    expect(fingerprint('c3-construction-ai-pro', tree.toJSON())).toMatchSnapshot();
  });

  it('(d) onboarding-paywall', async () => {
    const tree = await phoneRoute('/onboarding-paywall');
    expect(fingerprint('d-onboarding-paywall', tree.toJSON())).toMatchSnapshot();
  });

  it('(e) dev-ar-measure', async () => {
    const tree = await phoneRoute('/dev-ar-measure');
    expect(fingerprint('e-dev-ar-measure', tree.toJSON())).toMatchSnapshot();
  });

  it('(f) WeatherRescheduleModal, fully simulated, mounted alone', () => {
    const r = mountReschedule();
    expect(fingerprint('f-weather-reschedule', r.toJSON())).toMatchSnapshot();
  });
});

// ── 2. DELTAS — the sanctioned strings and behaviour ───────────────────────
describe('Z2 deltas — the sanctioned copy and the weather place', () => {
  jest.setTimeout(120000);

  it('construction-ai enterprise: no "Unlimited", the metered wording instead', async () => {
    const tree = await mountConstructionAi('enterprise');
    const text = allText(tree.toJSON()).join('\n');
    expect(text).toContain('No daily cap on code checks · each run counts toward your AI requests');
    expect(text).not.toMatch(/Unlimited (code checks|roadmaps|plan reviews)/);
  });

  it('construction-ai enterprise roadmap: the metered wording', async () => {
    const tree = await mountConstructionAi('enterprise', true);
    const text = allText(tree.toJSON()).join('\n');
    expect(text).toContain('No daily cap on roadmaps · each run counts toward your AI requests');
    expect(text).not.toMatch(/Unlimited (code checks|roadmaps|plan reviews)/);
  });

  it('construction-ai pro: the number, as before', async () => {
    const tree = await mountConstructionAi('pro');
    expect(allText(tree.toJSON()).join('\n')).toContain('Daily limit: 15 checks');
  });

  it('onboarding-paywall: the Business tagline names the seats', async () => {
    const pkg = (identifier: string, price: number, priceString: string) => ({
      identifier, packageType: 'CUSTOM', offeringIdentifier: 'default',
      product: { identifier: `com.mageid.${identifier.replace('_', '.')}`, price, priceString, title: identifier, description: '', currencyCode: 'USD' },
    });
    mockStorePackages = { isLoading: false, businessPackage: pkg('business_monthly', 79.99, '$79.99'), businessAnnualPackage: pkg('business_annual', 769.99, '$769.99') };
    try {
      const tree = await phoneRoute('/onboarding-paywall');
      const text = allText(tree.toJSON()).join('\n');
      expect(text).toContain('Teams · 5 office team members');
      expect(text).not.toContain('Teams & unlimited');
    } finally {
      mockStorePackages = null;
    }
  });

  it('onboarding-paywall: the new code copy, not the lookup claim', async () => {
    const tree = await phoneRoute('/onboarding-paywall');
    const text = allText(tree.toJSON()).join('\n');
    expect(text).toContain("Code guidance for your jurisdiction's adopted edition, permit roadmaps and inspection prep.");
    expect(text).not.toContain('Look up building codes, permits, and inspection requirements.');
  });

  it('daily-report: the jobsite goes to OpenWeather through the weather service only, never to another weather host', async () => {
    await mountDailyReport(PARK_SLOPE);
    // The screen itself fetches nothing: the one read is the service's
    // transport (replaced here), asked once, for the jobsite.
    expect(fetchCalls.filter((u) => /wttr\.in|weather/i.test(u))).toEqual([]);
    expect(currentAsks).toEqual([{ city: PARK_SLOPE }]);
    expect(screen.queryByText('Auto-fetch')).toBeNull();
    expect(screen.queryByLabelText('Auto-fetch the weather for today')).toBeNull();
    expect(screen.getByLabelText('Refresh the Weather from OpenWeather')).toBeTruthy();
  });

  it('daily-report: when OpenWeather does not answer, nothing is filled and nothing is invented', async () => {
    currentAnswers = false;
    await mountDailyReport(PARK_SLOPE);
    expect(currentAsks).toHaveLength(1);
    expect(screen.queryByTestId('dfr-weather-provenance')).toBeNull();
    expect(screen.queryByTestId('weather-credit')).toBeNull();
    expect(screen.queryByDisplayValue('61°F')).toBeNull();
    expect(screen.getByTestId('dfr-weather-quiet-line').props.children).toBe('Live weather is not available right now. Type what you saw.');
  });

  it('daily-report: typing a weather field makes it the super\'s, and the credit goes with the reading', async () => {
    await mountDailyReport(PARK_SLOPE);
    // DFR-DIRTY-AUTOFILL: the app's own reading is not unsaved work. The back
    // button says so (its label is where the unsaved state is announced), and
    // no draft of the app's reading was written.
    expect(screen.getByLabelText('Back')).toBeTruthy();
    expect(screen.queryByLabelText('Back. This report has unsaved changes.')).toBeNull();
    const draftKeys = (await AsyncStorage.getAllKeys()).filter((k) => /dfr.*draft|draft.*dfr/i.test(k));
    expect(draftKeys).toEqual([]);
    fireEvent.changeText(screen.getByDisplayValue('61°F'), '58');
    await pump(2);
    expect(screen.getByLabelText('Back. This report has unsaved changes.')).toBeTruthy();
    expect(screen.getByTestId('dfr-weather-provenance').props.children).toBe('Typed by hand.');
    expect(screen.queryByTestId('weather-credit')).toBeNull();
    expect(screen.getByDisplayValue('58')).toBeTruthy();
  });

  // Review finding 1 (2026-10-06): the "ask first" check runs at the tap, the
  // answer arrives later. Words typed while the read is in flight were never
  // asked about, so the answer is dropped.
  it('daily-report: Refresh never replaces a temperature typed while it was reading', async () => {
    await mountDailyReport(PARK_SLOPE);
    expect(screen.getByDisplayValue('61°F')).toBeTruthy();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ws = require('@/utils/weatherService') as typeof import('@/utils/weatherService');
    type Answer = Awaited<ReturnType<import('@/utils/weatherService').CurrentWeatherTransport>>;
    const reading = (temp: number): Answer => ({ cod: 200, dt: Math.floor(new Date().getTime() / 1000) - 60, ...OPENWEATHER_NOW, main: { temp } });
    /** A read that stays in flight until the test answers it. */
    const hang = () => {
      let answer: (v: Answer) => void = () => {};
      // Replacing the transport also clears the 10-minute cache, so the next
      // Refresh really asks.
      ws.__setCurrentWeatherTransportForTests(() => new Promise<Answer>((resolve) => { answer = resolve; }));
      return (v: Answer) => answer(v);
    };

    // Control: an untouched Refresh does land, so the drop below is the rule
    // and not a read that never arrived.
    let answer = hang();
    fireEvent.press(screen.getByTestId('dfr-weather-refresh'));
    await pump(2);
    expect(screen.getByText('Reading')).toBeTruthy();
    answer(reading(70.2));
    await pump(2);
    expect(screen.getByDisplayValue('70°F')).toBeTruthy();
    expect(screen.getByTestId('dfr-weather-provenance').props.children).toMatch(/^From OpenWeather at /);

    // The case: tap Refresh, type while it is reading, then the answer comes.
    answer = hang();
    fireEvent.press(screen.getByTestId('dfr-weather-refresh'));
    await pump(2);
    expect(screen.getByText('Reading')).toBeTruthy();
    fireEvent.changeText(screen.getByDisplayValue('70°F'), '58');
    await pump(2);
    answer(reading(80.4));
    await pump(3);
    expect(screen.getByDisplayValue('58')).toBeTruthy();
    expect(screen.queryByDisplayValue('80°F')).toBeNull();
    expect(screen.getByTestId('dfr-weather-provenance').props.children).toBe('Typed by hand.');
    expect(screen.queryByTestId('weather-credit')).toBeNull();
    // The read is over: the control is offered again.
    expect(screen.getByText('Refresh')).toBeTruthy();
  });

  it("daily-report: a country-only location is never sent to any weather service", async () => {
    await mountDailyReport('United States');
    expect(fetchCalls.filter((u) => /wttr\.in|weather/i.test(u))).toEqual([]);
    expect(currentAsks).toEqual([]);
    expect(screen.queryByTestId('dfr-weather-provenance')).toBeNull();
  });

  it('WeatherRescheduleModal: no env-var instruction on the phone', () => {
    const r = mountReschedule();
    const text = allText(r.toJSON()).join('\n');
    expect(text).toContain("Live weather isn't available for this project right now.");
    expect(text).not.toContain('EXPO_PUBLIC_OPENWEATHER_API_KEY');
  });
});
