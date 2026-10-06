/**
 * Code cards, lane CCWIRE — "Draft a Question" for New York, New Jersey and
 * Connecticut towns. BEHAVIOUR ONLY, no snapshot.
 *
 * Rendered on its own with the place lookup and the AI relay stubbed (no
 * network). The office rows are the REAL shipped rows in utils/permitOffices.ts
 * (Town of Oyster Bay is hand-verified, checked 2026-09-26).
 *
 *  (a) A Massapequa (Town of Oyster Bay) job: the button renders; the routing
 *      card names the office, no person; the prompt is addressed to the
 *      office, says the filing was not checked, never names DOB.
 *  (b) Opened from a code card (hideTrigger + open + initialQuestion): no
 *      button, the sheet is open with the card's question already in the box.
 *  (c) The lookup cannot name an office: opened from a card, it says why and
 *      closes; with its own button, it renders nothing.
 *  (d) A Portland, OR job: nothing (unchanged).
 *  (e) A Census answer in an NYC county: the NYC routing (applicant of record
 *      wording), not the town one.
 */

import React from 'react';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Project } from '@/types';
import { world } from '@/__tests__/fixtures/world';
import { TOWN_FILING_FACT } from '@/utils/departmentQuestion';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const colors = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ThemeProvider: ({ children }: { children: React.ReactNode }) => children, useTheme: () => value };
});
jest.mock('expo-mail-composer', () => ({ isAvailableAsync: async () => false, composeAsync: async () => ({}) }));

const mockPrompts: string[] = [];
jest.mock('@/utils/mageAI', () => ({
  mageAISmart: async (prompt: string) => {
    mockPrompts.push(prompt);
    return { success: true, data: { subject: 'Question on the job (Sample)', body: 'Sample body.' } };
  },
}));

type Lookup = { status: 'idle' | 'loading' | 'done' | 'error'; place: unknown };
let mockLookup: Lookup = { status: 'idle', place: null };
jest.mock('@/utils/placeLookup', () => ({
  usePlaceLookup: (q: unknown) => (q ? mockLookup : { status: 'idle', place: null }),
}));

const mockAlerts: Array<[string, string]> = [];
jest.mock('@/utils/alert', () => ({
  showAlert: (title: string, body: string) => { mockAlerts.push([title, body]); },
}));

jest.mock('@/hooks/useBuildingRecord', () => ({
  useBuildingRecord: () => ({ record: null, summary: { kind: 'none', headline: '', lines: [], promptBlock: '', chipLabel: '', cacheKey: 'br:none' } }),
}));

// eslint-disable-next-line import/first
import { DraftQuestionButton } from '@/components/buildingRecord/DraftQuestionButton';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const render = (ui: React.ReactElement) => rtlRender(<SafeAreaProvider initialMetrics={METRICS}>{ui}</SafeAreaProvider>);

function project(id: string, location: string): Project {
  return {
    ...(world.project as object),
    id,
    name: 'Reyes deck',
    location,
    locationLatitude: undefined,
    locationLongitude: undefined,
    locationGeocodedAt: undefined,
    structuredAddress: undefined,
  } as unknown as Project;
}

const CENSUS = { status: 'ok', incorporatedPlace: null, cdp: null, matchedAddress: null, match: 'address', source: 'US Census Geocoder', asOf: '2026-09-28T00:00:00.000Z' };
const OYSTER_BAY = {
  ...CENSUS, state: 'NY',
  county: { name: 'Nassau County', geoid: '36059' },
  town: { kind: 'town', name: 'Oyster Bay town', basename: 'Oyster Bay', geoid: '3605956000' },
};
const KINGS = { ...CENSUS, state: 'NY', county: { name: 'Kings County', geoid: '36047' }, town: null };

const MASSAPEQUA = '120 Main St, Massapequa, NY 11758';

// A sheet's open animation can finish after the last test; let it settle
// before the environment is torn down.
afterAll(async () => {
  await act(async () => { await new Promise((r) => setTimeout(r, 800)); });
});

beforeEach(() => {
  mockPrompts.length = 0;
  mockAlerts.length = 0;
  mockLookup = { status: 'idle', place: null };
});

describe('Draft a question: NY / NJ / CT towns (code cards)', () => {
  it('(a) a Town of Oyster Bay job: the office, no person, no filing claim, no DOB', async () => {
    mockLookup = { status: 'done', place: OYSTER_BAY };
    render(<DraftQuestionButton project={project('t-a', MASSAPEQUA)} testID="dq" />);
    fireEvent.press(screen.getByTestId('dq'));
    expect(String(screen.getByTestId('dq-to').props.children)).toBe('Address it to the Town of Oyster Bay Building Division.');
    expect(screen.getByTestId('dq-phone')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('dq-question'), 'Does the town amend the guard height?');
    await act(async () => { fireEvent.press(screen.getByTestId('dq-draft')); });
    const prompt = mockPrompts[mockPrompts.length - 1] ?? '';
    expect(prompt).toContain('The email is addressed to: Town of Oyster Bay Building Division');
    expect(prompt).toContain(TOWN_FILING_FACT);
    expect(prompt).not.toMatch(/\bDOB\b/);
  });

  it('(b) opened from a code card: no button, the sheet open with the question filled in', () => {
    mockLookup = { status: 'done', place: OYSTER_BAY };
    render(
      <DraftQuestionButton
        project={project('t-b', MASSAPEQUA)}
        hideTrigger
        open
        onOpenChange={() => {}}
        initialQuestion="Sample: does the town amend R312.1?"
        testID="dq"
      />,
    );
    expect(screen.queryByTestId('dq')).toBeNull();
    expect(screen.getByTestId('dq-question').props.value).toBe('Sample: does the town amend R312.1?');
  });

  it('(c) no office found, opened from a card: it says why and closes', () => {
    mockLookup = { status: 'error', place: null };
    const closes: boolean[] = [];
    render(
      <DraftQuestionButton project={project('t-c', MASSAPEQUA)} hideTrigger open onOpenChange={(o) => { closes.push(o); }} testID="dq" />,
    );
    expect(mockAlerts.map((a) => a[0])).toEqual(['Town Not Found']);
    expect(closes).toEqual([false]);
    expect(screen.queryByTestId('dq-question')).toBeNull();
  });

  it('(c2) no office found, with its own button: it renders nothing and says nothing', () => {
    mockLookup = { status: 'error', place: null };
    render(<DraftQuestionButton project={project('t-c2', MASSAPEQUA)} testID="dq2" />);
    expect(screen.queryByTestId('dq2')).toBeNull();
    expect(mockAlerts).toEqual([]);
  });

  it('(e) a Census answer in an NYC county: the NYC routing, not the town one', () => {
    mockLookup = { status: 'done', place: KINGS };
    render(<DraftQuestionButton project={project('t-e', '55 Water St, Massapequa, NY 11758')} testID="dq" />);
    fireEvent.press(screen.getByTestId('dq'));
    expect(String(screen.getByTestId('dq-to').props.children)).toMatch(/RA\/PE/);
  });
  it('(d) a Portland, OR job: nothing, as before', () => {
    mockLookup = { status: 'done', place: OYSTER_BAY };
    render(<DraftQuestionButton project={project('t-d', '4218 SE Rex St, Portland, OR 97206')} testID="dq" />);
    expect(screen.queryByTestId('dq')).toBeNull();
  });
});
