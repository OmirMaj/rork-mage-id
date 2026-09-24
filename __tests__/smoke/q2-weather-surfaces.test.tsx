/**
 * Q2 — "How is weather location determined?" The Today and Lookahead strips
 * name the place, Lookahead asks for the SAME coordinates as Today and the
 * Gantt, and Today shows today's reading — not tomorrow's.
 *
 * GOLDENS. __tests__/fixtures/q2-weather-goldens.json was recorded from the
 * two components BEFORE this lane touched them (RECORD_Q2_GOLDENS=1 on the
 * untouched TodayView.tsx / LookaheadView.tsx). Every scenario must render the
 * golden's text in the same order; the only permitted difference is the new
 * "Weather for …" line (and, where the job has no address, the cause sentence
 * appended to the simulated banner).
 */

import React from 'react';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { render, act } from '@testing-library/react-native';
import type { ProjectSchedule, ScheduleTask } from '@/types';
import type { DayForecast } from '@/utils/weatherService';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => value,
  };
});

const mockForecast = jest.fn();
jest.mock('@/utils/weatherService', () => ({
  ...jest.requireActual('@/utils/weatherService'),
  getForecastWithFallback: (...args: unknown[]) => mockForecast(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TodayView = require('@/components/schedule/TodayView').default as React.ComponentType<Record<string, unknown>>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const LookaheadView = require('@/components/schedule/LookaheadView').default as React.ComponentType<Record<string, unknown>>;

const GOLDEN = join(__dirname, '..', 'fixtures', 'q2-weather-goldens.json');
const RECORD = process.env.RECORD_Q2_GOLDENS === '1';

// Thursday 2026-09-24, 10:00 local.
const NOW = new Date(2026, 8, 24, 10, 0, 0);

function dayKey(offset: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${dd}`;
}

function day(offset: number, source: 'live' | 'simulated', extra: Partial<DayForecast> = {}): DayForecast {
  return {
    date: dayKey(offset),
    condition: offset % 2 === 0 ? 'clear' : 'rain',
    tempHigh: 70 + offset,
    tempLow: 55 + offset,
    precipChance: offset % 2 === 0 ? 10 : 80,
    windSpeed: 8,
    isWorkable: offset % 2 === 0,
    icon: '',
    source,
    ...extra,
  };
}

const LIVE_4 = [0, 1, 2, 3].map((o) => day(o, 'live'));
const SIM_4 = [0, 1, 2, 3].map((o) => day(o, 'simulated'));
const LIVE_5_SIM_16 = Array.from({ length: 21 }, (_, i) => day(i, i < 5 ? 'live' : 'simulated'));

const SCHEDULE = { id: 's1', name: 'S', tasks: [], workingDaysPerWeek: 5, nonWorkingDates: [] } as unknown as ProjectSchedule;
const TASKS: ScheduleTask[] = [];
const noop = () => {};

function texts(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const n of node) texts(n, out); return out; }
  const el = node as { type?: string; children?: unknown[] };
  if (el.type === 'Text') {
    out.push(flatText(el.children ?? []));
    return out;
  }
  for (const c of el.children ?? []) texts(c, out);
  return out;
}
function flatText(children: unknown[]): string {
  return children.map((c) => (typeof c === 'string' ? c : c && typeof c === 'object' ? flatText((c as { children?: unknown[] }).children ?? []) : '')).join('');
}

async function mount(el: React.ReactElement): Promise<{ lines: string[]; unmount: () => void }> {
  const r = render(el);
  for (let i = 0; i < 6; i++) {
    await act(async () => { await Promise.resolve(); });
  }
  return { lines: texts(r.toJSON()), unmount: r.unmount };
}

interface Scenario {
  name: string;
  kind: 'today' | 'lookahead';
  props: Record<string, unknown>;
  days: DayForecast[];
}

const SCENARIOS: Scenario[] = [
  { name: 'today-live', kind: 'today', props: { location: '124 Park Slope, Brooklyn NY 11215', locationLatitude: 40.67, locationLongitude: -73.986 }, days: LIVE_4 },
  { name: 'today-simulated-no-address', kind: 'today', props: { location: '' }, days: SIM_4 },
  { name: 'lookahead-live-padded', kind: 'lookahead', props: { location: '124 Park Slope, Brooklyn NY 11215', locationLatitude: 40.67, locationLongitude: -73.986 }, days: LIVE_5_SIM_16 },
  { name: 'lookahead-simulated-no-address', kind: 'lookahead', props: { location: '' }, days: Array.from({ length: 21 }, (_, i) => day(i, 'simulated')) },
];

function element(s: Scenario): React.ReactElement {
  const common = { tasks: TASKS, schedule: SCHEDULE, projectStartDate: new Date(2026, 8, 1, 12), onProgressUpdate: noop, onTaskPress: noop };
  return s.kind === 'today'
    ? <TodayView {...common} onPhotoAdded={noop} healthScore={90} daysRemaining={12} {...s.props} />
    : <LookaheadView {...common} {...s.props} />;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  mockForecast.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});

const recorded: Record<string, string[]> = {};

describe('Q2 weather surfaces', () => {
  for (const s of SCENARIOS) {
    it(`${s.name} matches the pre-change golden, plus only the place/cause copy`, async () => {
      mockForecast.mockImplementation(() => Promise.resolve(s.days));
      const { lines, unmount } = await mount(element(s));
      unmount();
      if (RECORD) {
        recorded[s.name] = lines;
        return;
      }
      const golden = (JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, string[]>)[s.name];
      expect(golden).toBeDefined();
      // New lines this lane adds; everything else must be the golden, in order.
      const added = lines.filter((l) => /^Weather for /.test(l));
      const rest = lines.filter((l) => !/^Weather for /.test(l));
      // The banner body may carry the cause sentence after the golden copy.
      const norm = (l: string) => l
        .replace(/ This job has no jobsite address, so there is nowhere to forecast\. Add the address in Edit Project to see live weather\.$/, '')
        .replace(/ Live forecasts reach about 5 days out; the later days are simulated\.$/, '');
      const goldenNorm = golden.map((l) => l.replace(/ Set EXPO_PUBLIC_OPENWEATHER_API_KEY to show the live forecast\.$/, ''));
      expect(rest.map(norm)).toEqual(goldenNorm);
      if (s.name.includes('live')) expect(added).toEqual(['Weather for 124 Park Slope, Brooklyn NY 11215']);
      else expect(added).toEqual([]);
      if (s.name.includes('no-address')) {
        expect(lines.some((l) => l.includes('This job has no jobsite address'))).toBe(true);
      }
      // No developer jargon on a contractor's screen.
      expect(lines.some((l) => l.includes('EXPO_PUBLIC_'))).toBe(false);
    });
  }

  if (RECORD) {
    afterAll(() => {
      writeFileSync(GOLDEN, JSON.stringify(recorded, null, 2) + '\n');
    });
    return;
  }

  it('the golden file exists', () => {
    expect(existsSync(GOLDEN)).toBe(true);
  });

  it('Lookahead asks for the SAME coordinates as Today and the Gantt', async () => {
    mockForecast.mockImplementation(() => Promise.resolve(LIVE_5_SIM_16));
    const s = SCENARIOS[2];
    const { unmount } = await mount(element(s));
    unmount();
    const loc = mockForecast.mock.calls[0][0] as { city?: string; latitude?: number; longitude?: number };
    expect(loc).toEqual({ city: '124 Park Slope, Brooklyn NY 11215', latitude: 40.67, longitude: -73.986 });
  });

  it("Today shows TODAY's reading, never tomorrow's (UTC-bucket evening bug)", async () => {
    // After ~8 PM Eastern the first bucket is tomorrow's: forecast[0] used to
    // be printed as today's temperature.
    const tomorrowFirst = [1, 2, 3, 4].map((o) => day(o, 'live', { tempHigh: 99 }));
    mockForecast.mockImplementation(() => Promise.resolve(tomorrowFirst));
    const { lines, unmount } = await mount(element(SCENARIOS[0]));
    unmount();
    expect(lines).not.toContain('99°F');
    // The outlook strip still shows the coming days.
    expect(lines.filter((l) => l === '99°').length).toBe(4);
  });
});
