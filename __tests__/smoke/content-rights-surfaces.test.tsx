/**
 * Content rights, lane CRAPP — GOLDEN for the credited surfaces.
 *
 * Third-party data needs its credit where it is shown
 * (contentfix-specs/RIGHTS-VERDICT.md): OpenWeather under every live forecast,
 * OpenStreetMap next to a place name its geocoder produced, Baltimore County's
 * own disclaimer on County records and the CC BY 3.0 license on City records.
 *
 * GOLDEN — recorded FIRST, on the untouched base (195b7361), before a line of
 * the lane was written. Each case records the visible text lines, in order.
 * The ONLY permitted deltas after the lane:
 *   (a) weather reschedule modal, LIVE forecast — gains the OpenWeather credit;
 *   (b) weather reschedule modal, SIMULATED forecast — NO change (simulated
 *       weather is not OpenWeather's data and must not carry its credit);
 *   (c) Baltimore City record — gains the CC BY 3.0 license line;
 *   (d) Baltimore County record — gains the County's disclaimer, verbatim.
 * The Today / Lookahead strips are pinned by q2-weather-surfaces (live
 * scenarios gain the credit line; simulated scenarios do not change).
 */

import React from 'react';
import { render as rtlRender, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { WeatherRescheduleResult } from '@/utils/weatherReschedule';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});

let mockMd: Record<string, unknown> = {};
jest.mock('@/hooks/useMdBuildingRecord', () => ({
  useMdBuildingRecord: () => mockMd,
  MD_NO_MATCH_TEXT: 'No Baltimore parcel found at this address, so nothing was checked.',
}));

// eslint-disable-next-line import/first
import { MdBuildingRecordCard } from '@/components/buildingRecord/MdBuildingRecordCard';
// eslint-disable-next-line import/first
import WeatherRescheduleModal from '@/components/schedule/WeatherRescheduleModal';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function texts(node: unknown, out: string[] = []): string[] {
  if (node == null) return out;
  if (typeof node === 'string') { out.push(node); return out; }
  if (Array.isArray(node)) { for (const n of node) texts(n, out); return out; }
  const el = node as { type?: string; children?: unknown[] };
  if (el.type === 'Text') { out.push(flatText(el.children ?? [])); return out; }
  for (const c of el.children ?? []) texts(c, out);
  return out;
}
function flatText(children: unknown[]): string {
  return children.map((c) => (typeof c === 'string' ? c : c && typeof c === 'object' ? flatText((c as { children?: unknown[] }).children ?? []) : '')).join('');
}

async function lines(ui: React.ReactElement): Promise<string[]> {
  const r = rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  const out = texts(r.toJSON());
  r.unmount();
  return out;
}

function result(source: 'live' | 'simulated'): WeatherRescheduleResult {
  return {
    tasks: [],
    impacts: [{
      taskId: 't1', title: 'Pour footings', phase: 'Foundation', weatherDelayDays: 1, startSlipDays: 1,
      badDates: ['2026-09-25'], worstCondition: 'rain', originalStartDay: 3, newStartDay: 4, directlyHit: true,
    }],
    projectSlipDays: 1,
    directHitCount: 1,
    cascadedCount: 0,
    affectedDates: ['2026-09-25'],
    liveAffectedDates: source === 'live' ? ['2026-09-25'] : [],
    simulatedAffectedDates: source === 'simulated' ? ['2026-09-25'] : [],
    forecastSource: source,
  };
}

function mdReady(side: 'baltimore_city' | 'baltimore_county') {
  return {
    supported: true,
    phase: 'ready',
    candidates: [],
    confirmed: { side, key: 'k1', label: 'Parcel', lat: 39.3, lon: -76.6, lookupText: 'x' },
    record: null,
    summary: { headline: 'Building record headline', lines: ['Line one · Source, as of Sep 28, 2026'] },
    side,
    error: null,
    outside: null,
    lookup: jest.fn(),
    confirm: jest.fn(),
    changeBuilding: jest.fn(),
    refresh: jest.fn(),
  };
}

const START = new Date(2026, 8, 22, 12);

describe('content rights golden — credited surfaces', () => {
  it('(a) weather reschedule modal, live forecast', async () => {
    expect(await lines(<WeatherRescheduleModal visible result={result('live')} projectStartDate={START} onClose={() => {}} onApply={() => {}} />)).toMatchSnapshot();
  });

  it('(b) weather reschedule modal, simulated forecast', async () => {
    expect(await lines(<WeatherRescheduleModal visible result={result('simulated')} projectStartDate={START} onClose={() => {}} onApply={() => {}} />)).toMatchSnapshot();
  });

  it('(c) Baltimore City record', async () => {
    mockMd = mdReady('baltimore_city');
    expect(await lines(<MdBuildingRecordCard project={null} />)).toMatchSnapshot();
  });

  it('(d) Baltimore County record', async () => {
    mockMd = mdReady('baltimore_county');
    expect(await lines(<MdBuildingRecordCard project={null} />)).toMatchSnapshot();
  });
});
