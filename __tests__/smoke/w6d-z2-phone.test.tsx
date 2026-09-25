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
import { PROJECT_ID, ESTIMATE_ID } from '@/__tests__/fixtures/world';

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

// wttr.in's j1 body for the jobsite. `nearest_area` is where wttr actually
// read the weather — what the chip should name.
const WTTR_BODY = {
  current_condition: [{
    temp_F: '61', temp_C: '16', weatherDesc: [{ value: 'Partly cloudy' }], windspeedMiles: '8', winddir16Point: 'NW',
  }],
  nearest_area: [{ areaName: [{ value: 'Park Slope' }], region: [{ value: 'New York' }], country: [{ value: 'United States of America' }] }],
};
const PARK_SLOPE = '124 Park Slope, Brooklyn NY';

const realFetch = global.fetch;
const fetchCalls: string[] = [];
function mockWttr() {
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    fetchCalls.push(url);
    const body = /wttr\.in\/124%20Park%20Slope/.test(url) ? WTTR_BODY : {};
    return {
      ok: true, status: 200, statusText: 'OK',
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
      clone() { return this; },
    };
  }) as unknown as typeof fetch;
}

let nowSpy: jest.SpyInstance | null = null;
let outerNowSpy: jest.SpyInstance | null = null;
beforeEach(() => {
  jest.useRealTimers();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
  outerNowSpy = OuterDate === Date ? null : jest.spyOn(OuterDate, 'now').mockReturnValue(GOLDEN_CLOCK);
  fetchCalls.length = 0;
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
});

// ── What a snapshot records ────────────────────────────────────────────────
/** Old wording and new wording of each sanctioned string → one token. */
const SANCTIONED: Array<[RegExp, string]> = [
  [/Unlimited code checks today|No daily cap on code checks · each run counts toward your AI requests/g, '<W6:code-check-cap>'],
  [/Unlimited roadmaps today|No daily cap on roadmaps · each run counts toward your AI requests/g, '<W6:roadmap-cap>'],
  [/Teams & unlimited|Teams · 5 office seats/g, '<W6:business-tagline>'],
  [/ for (?:124 Park Slope, Brooklyn NY|Park Slope, New York)\./g, ' for <W7:weather-place>.'],
  [/Set EXPO_PUBLIC_OPENWEATHER_API_KEY for live weather\.|Live weather isn't available for this job right now\./g, '<W7:reschedule-notice>'],
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
    fireEvent.press(screen.getByText('Project Roadmap'));
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
    expect(screen.getByText('Save draft')).toBeTruthy();
    expect(fingerprint('a-contract-draft', tree.toJSON())).toMatchSnapshot();
  });

  it('(b1) daily-report, new report, jobsite 124 Park Slope (wttr answers)', async () => {
    const tree = await mountDailyReport(PARK_SLOPE);
    expect(fetchCalls.some((u) => u.includes('wttr.in/124%20Park%20Slope'))).toBe(true);
    expect(screen.getByTestId('dfr-weather-provenance')).toBeTruthy();
    expect(fingerprint('b1-daily-report-park-slope', tree.toJSON())).toMatchSnapshot();
  });

  it("(b2) daily-report, new report, location 'United States'", async () => {
    const tree = await mountDailyReport('United States');
    expect(screen.queryByTestId('dfr-weather-provenance')).toBeNull();
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
    const tree = await phoneRoute('/onboarding-paywall');
    const text = allText(tree.toJSON()).join('\n');
    expect(text).toContain('Teams · 5 office seats');
    expect(text).not.toContain('Teams & unlimited');
  });

  it("daily-report: the chip names the place wttr.in read (nearest_area)", async () => {
    await mountDailyReport(PARK_SLOPE);
    const chip = allText(screen.getByTestId('dfr-weather-provenance')).join('');
    expect(chip).toMatch(/for Park Slope, New York\.$/);
    expect(chip).not.toContain(PARK_SLOPE);
  });

  it("daily-report: a country-only location is never sent to wttr.in", async () => {
    await mountDailyReport('United States');
    expect(fetchCalls.filter((u) => u.includes('wttr.in'))).toEqual([]);
    expect(screen.queryByTestId('dfr-weather-provenance')).toBeNull();
  });

  it('WeatherRescheduleModal: no env-var instruction on the phone', () => {
    const r = mountReschedule();
    const text = allText(r.toJSON()).join('\n');
    expect(text).toContain("Live weather isn't available for this job right now.");
    expect(text).not.toContain('EXPO_PUBLIC_OPENWEATHER_API_KEY');
  });
});
