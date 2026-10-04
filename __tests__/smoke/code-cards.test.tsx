/**
 * Smoke — the code-card kit (lane CCKIT): components/codeCard + utils/codeCard.
 *
 * Every requirement in this file is a SAMPLE in our own words, rendered with
 * `sample`, so every card and every golden carries the "Sample" mark. The
 * code-in-force and permit-office facts are the REAL verified rows
 * (utils/codeJurisdiction.ts New York; utils/permitOffices.ts Town of Oyster
 * Bay), built through codeJurisdictionInfoFor.
 *
 * GOLDENS (new files, recorded once, then run with --ci):
 *   a  Ask answer: JurisdictionBlock + 3 cards, light
 *   b  the same, dark
 *   c  the same, Sunlight
 *   d  plan code check, 10 items, By status
 *   e  plan code check, By inspection, with a booked footing date
 *   f  one card opened (CodeCardSheet), light
 *
 * BEHAVIOUR:
 *   1  Official text copies the section FIRST, then opens a volume-level URL
 *   2  a blocked action says why when tapped
 *   3  − / + re-runs the verdict, the equation, the near note and the sub text
 *   4  no tape without both structured numbers
 *   5  the stage is the AI's guess, and editing it reports and relabels
 *   6  "Text it to Dave R." hands the text to the caller (MAGE sends nothing)
 *   7  recall reads "Model recall · confirm" on every recalled card
 *   8  By inspection shows the booked date, and "Not booked"
 *   9  Sunlight steps the verdict line up a size
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CodeCard, CodeCardList, CodeCardSheet, JurisdictionBlock, blockedAction, doneAction, readyAction } from '@/components/codeCard';
import type { CodeCardItem, CodeJurisdictionInfo } from '@/utils/codeCard/types';
import { codeJurisdictionInfoFor } from '@/utils/codeCard/jurisdiction';
import { subRecipientsFor } from '@/utils/codeCard/shareText';
import { __resetSunlightForTest } from '@/utils/codeCard/sunlight';
import { citationEvidenceFor } from '@/utils/codeAmendments';
import { resolveCodeJurisdiction } from '@/utils/codeJurisdiction';
import { permitOfficeFor, type PlaceLookupResult } from '@/utils/permitOffices';

type TestRendererInstance = { toJSON(): unknown; unmount(): void };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer: { create(el: React.ReactElement): TestRendererInstance } = require('react-test-renderer');

let mockDark = false;
jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/constants/colors');
  const light = { ...actual.Theme.light, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'light') };
  const dark = { ...actual.Theme.dark, ...actual.deriveAccentPalette(actual.getCustomPrimary(), 'dark') };
  const lightValue = { colors: light, resolved: 'light', pref: 'light', setPref: () => {} };
  const darkValue = { colors: dark, resolved: 'dark', pref: 'dark', setPref: () => {} };
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
    useTheme: () => (mockDark ? darkValue : lightValue),
  };
});

jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, useReducedMotion: () => true, reducedMotion: () => true };
});

jest.mock('@/utils/useResponsiveLayout', () => ({
  useResponsiveLayout: () => ({
    screenSize: 'phone', isPhone: true, isTablet: false, isDesktop: false, width: 390, height: 844,
    contentMaxWidth: 390, sidebarWidth: 0, showSidebar: false, ganttRowHeight: 32,
  }),
}));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Wrap = ({ children }: { children: React.ReactNode }) => <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider>;
const render = (ui: React.ReactElement) => rtlRender(<Wrap>{ui}</Wrap>);
function golden(ui: React.ReactElement): unknown {
  let r!: TestRendererInstance;
  act(() => { r = TestRenderer.create(<Wrap>{ui}</Wrap>); });
  const json = r.toJSON();
  act(() => r.unmount());
  return json;
}

// ── Fixtures: REAL jurisdiction rows, SAMPLE requirements ────────────────
const NY = resolveCodeJurisdiction({ state: 'NY', city: 'Massapequa' });
const PLACE: PlaceLookupResult = {
  state: 'NY',
  county: { name: 'Nassau County', geoid: '36059' },
  town: { name: 'Oyster Bay town', basename: 'Oyster Bay', geoid: '3605956000', kind: 'town' },
  incorporatedPlace: null,
  cdp: { name: 'Massapequa CDP', basename: 'Massapequa', geoid: '3646085', kind: 'cdp' },
  match: 'address',
  matchedAddress: null,
  source: 'US Census Geocoder',
  asOf: '2026-09-28T00:00:00.000Z',
};
const INFO: CodeJurisdictionInfo = codeJurisdictionInfoFor(NY, permitOfficeFor(PLACE), '2025 RCNYS');
const ev = (section: string) => citationEvidenceFor(NY, '2025 RCNYS', section);

const GUARDS: CodeCardItem = {
  id: 'guards', verdict: 'required', summary: 'Guards on every open side, at least 36 in. high.',
  section: 'R312.1', citedEdition: '2025 RCNYS', evidence: ev('R312.1'), stage: 'final', stageIsGuess: true,
  jobValue: { value: 34, unit: 'in', source: 'sheet', sourceLabel: 'sheet A-2' },
  trigger: { value: 30, unit: 'in', comparison: '>' }, trade: 'Framing',
  whatToBuild: [
    'A guard on every open side, the stair included.',
    'Top of the guard at least 36 in. above the deck boards.',
    'Posts fastened into framing, so the rail does not flex when pushed.',
  ],
};
const BALUSTERS: CodeCardItem = {
  id: 'balusters', verdict: 'limit', summary: 'Balusters close enough that a 4 in. ball can’t pass between them.',
  why: 'Every guard on this deck. The stair’s open sides use a slightly larger number, so check it in the official text.',
  section: 'R312.1.3', citedEdition: '2025 RCNYS', evidence: ev('R312.1.3'), stage: 'final', stageIsGuess: true,
};
const HANDRAIL: CodeCardItem = {
  id: 'handrail', verdict: 'required', summary: 'Handrail on the stair, top of rail 34–38 in. high.',
  section: 'R311.7.8', citedEdition: '2025 RCNYS', evidence: ev('R311.7.8'), stage: 'final', stageIsGuess: true,
  calc: { expression: '34 in. ÷ 7¾ in. max riser', value: '5 risers', note: 'A handrail is needed at 4 or more' },
};
const ANSWER = [GUARDS, BALUSTERS, HANDRAIL];

const row = (id: string, status: 'fix' | 'ask' | 'ok', summary: string, section: string, stage: CodeCardItem['stage'], extra: Partial<CodeCardItem> = {}): CodeCardItem => ({
  id, verdict: 'required', summary, section, citedEdition: '2025 RCNYS', evidence: ev(section), stage, stageIsGuess: true, status, ...extra,
});
const PLAN: CodeCardItem[] = [
  row('p1', 'fix', 'Balusters drawn too far apart for the 4 in. ball rule.', 'R312.1.3', 'final', { observed: 'Drawn 4½ in.', location: 'Detail 3/A-2' }),
  row('p2', 'fix', 'No handrail drawn on the 5-riser stair.', 'R311.7.8', 'final', { location: 'Stair, east side' }),
  row('p3', 'fix', 'Ledger bolts not shown on A-2.', 'R507.9', 'framing', { location: 'House wall' }),
  row('p4', 'ask', 'Footings drawn 36 in. deep. Confirm the town frost depth.', 'R403.1.4', 'footing'),
  row('p5', 'ask', 'Hold-down at the ledger is not detailed.', 'R507.9.2', 'framing', { question: 'Can you add a hold-down detail at the ledger?' }),
  row('p6', 'ok', 'Guards drawn 36 in. high.', 'R312.1', 'final'),
  row('p7', 'ok', 'Risers 6¾ in., treads 10½ in.', 'R311.7.5', 'final'),
  row('p8', 'ok', 'Light at the top of the stair.', 'R303.8', 'final'),
  row('p9', 'ok', '2x10 joists, 16 in. o.c., 12 ft span.', 'R507.6', 'framing'),
  row('p10', 'ok', '6x6 posts, under the height limit.', 'R507.4', 'framing'),
];
const SUBS = subRecipientsFor([
  { id: 's1', contactName: 'Luis Martinez', trade: 'General', phone: '5165550101' },
  { id: 's2', contactName: 'Dave Reyes', trade: 'Framing', phone: '5165550102' },
], 'Framing');

const noop = () => {};
const answerTree = (sunlight?: boolean) => (
  <>
    <JurisdictionBlock info={INFO} sunlight={sunlight} />
    <CodeCardList
      items={ANSWER}
      info={INFO}
      sample
      sunlight={sunlight}
      onOpen={noop}
      checklistFor={(i) => (i.id === 'guards' ? doneAction('On Final') : readyAction(noop))}
      askTownFor={() => readyAction(noop)}
      primary={{ key: 'add', label: 'Add all 3 to Final inspection', icon: 'clip', action: readyAction(noop) }}
      secondary={[
        { key: 'sub', label: 'Send to sub', icon: 'send', action: readyAction(noop) },
        { key: 'pdf', label: 'PDF', icon: 'file', action: readyAction(noop) },
        { key: 'save', label: 'Save', icon: 'save', action: readyAction(noop) },
      ]}
    />
  </>
);
const planTree = (initial?: 'stage') => (
  <CodeCardList
    items={PLAN}
    info={INFO}
    sample
    planSourceLabel="A-2"
    bookedDates={{ footing: 'Thu, Oct 9', framing: null, final: null }}
    onOpen={noop}
    primary={{ key: 'arch', label: 'Send 3 fixes + 1 question to architect', icon: 'send', action: readyAction(noop) }}
    secondary={[
      { key: 'ask', label: 'Ask town', icon: 'ask', action: readyAction(noop) },
      { key: 'clip', label: 'Checklists', icon: 'clip', action: readyAction(noop) },
      { key: 'pdf', label: 'PDF', icon: 'file', action: blockedAction('Make a PDF from the Plans screen for now.') },
    ]}
    testID={initial ? 'plan-by-stage' : 'plan'}
  />
);

beforeEach(() => {
  mockDark = false;
  __resetSunlightForTest(null);
});

describe('code cards — goldens', () => {
  it('a: Ask answer, light', () => {
    expect(golden(answerTree())).toMatchSnapshot();
  });
  it('b: Ask answer, dark', () => {
    mockDark = true;
    expect(golden(answerTree())).toMatchSnapshot();
  });
  it('c: Ask answer, Sunlight', () => {
    expect(golden(answerTree(true))).toMatchSnapshot();
  });
  it('d: plan code check, 10 items, By status', () => {
    expect(golden(planTree())).toMatchSnapshot();
  });
  it('e: plan code check, By inspection', () => {
    const { toJSON } = render(planTree('stage'));
    fireEvent.press(screen.getByTestId('plan-by-stage-by-stage'));
    expect(toJSON()).toMatchSnapshot();
  });
  it('f: one card opened', () => {
    expect(golden(
      <CodeCardSheet
        visible
        onClose={noop}
        item={GUARDS}
        info={INFO}
        sample
        jobLabel="Reyes deck, Massapequa"
        permitPhone="(516) 624-6200 ext. 1"
        checklist={readyAction(noop)}
        askTown={readyAction(noop)}
        save={readyAction(noop)}
        recipients={SUBS}
        onPickRecipient={noop}
        onSendToSub={noop}
      />,
    )).toMatchSnapshot();
  });
});

describe('code cards — behaviour', () => {
  it('1: Official text copies the section first, then opens the volume', async () => {
    const calls: string[] = [];
    const deps = {
      copy: async (t: string) => { calls.push(`copy:${t}`); return true; },
      open: async (u: string) => { calls.push(`open:${u}`); },
    };
    render(<CodeCard item={GUARDS} info={INFO} sample officialTextDeps={deps} />);
    await act(async () => { fireEvent.press(screen.getByTestId('code-card-guards-official')); });
    expect(calls[0]).toBe('copy:R312.1');
    expect(calls[1]).toMatch(/^open:https:\/\/codes\.iccsafe\.org\/content\/[A-Z][A-Z0-9]{3,23}$/);
    expect(screen.getByText('Copied R312.1. Paste it into the viewer’s search.')).toBeTruthy();
  });

  it('2: a blocked action says why', () => {
    render(<CodeCard item={GUARDS} info={INFO} sample askTown={blockedAction('MAGE has no permit office on file for this address.')} />);
    fireEvent.press(screen.getByTestId('code-card-guards-ask'));
    expect(screen.getByText('Ask town: MAGE has no permit office on file for this address.')).toBeTruthy();
  });

  it('3: − / + re-runs the verdict, the equation, the near note and the sub text', () => {
    render(
      <CodeCardSheet visible onClose={noop} item={GUARDS} info={INFO} sample jobLabel="Reyes deck, Massapequa" recipients={SUBS} onSendToSub={noop} />,
    );
    const tid = 'code-card-sheet-guards';
    expect(screen.getByTestId(`${tid}-verdict`).props.accessibilityLabel).toBe('Verdict: Required');
    expect(screen.queryByTestId(`${tid}-near`)).toBeNull();
    for (let i = 0; i < 3; i++) fireEvent.press(screen.getByTestId(`${tid}-dec`));
    expect(screen.getByTestId(`${tid}-value`).props.children).toBe('31');
    expect(screen.getByTestId(`${tid}-near`)).toBeTruthy();
    for (let i = 0; i < 2; i++) fireEvent.press(screen.getByTestId(`${tid}-dec`));
    expect(screen.getByTestId(`${tid}-verdict`).props.accessibilityLabel).toBe('Verdict: Not required');
    const share = screen.getByTestId(`${tid}-share-text`).props.children as string;
    expect(share).toContain('Job: 29 in. (measured on site).');
    expect(share).toContain('Result: not required.');
    expect(share.endsWith('(Sample)')).toBe(true);
  });

  it('4: no tape without both structured numbers', () => {
    render(<CodeCard item={{ ...GUARDS, trigger: undefined }} info={INFO} sample />);
    expect(screen.queryByTestId('code-card-guards-tape')).toBeNull();
    expect(screen.getByText('Guards on every open side, at least 36 in. high.')).toBeTruthy();
  });

  it('5: the stage is the AI guess and editing it reports', () => {
    const moved: string[] = [];
    render(<CodeCardSheet visible onClose={noop} item={GUARDS} info={INFO} sample onStageChange={(_i, s) => moved.push(s)} />);
    const tid = 'code-card-sheet-guards';
    expect(screen.getByText('Final inspection · AI guess')).toBeTruthy();
    fireEvent.press(screen.getByTestId(`${tid}-stage`));
    fireEvent.press(screen.getByTestId(`${tid}-stage-framing`));
    expect(moved).toEqual(['framing']);
    expect(screen.getByText('Framing inspection · you set it')).toBeTruthy();
  });

  it('6: Text it to Dave R. hands the text to the caller', () => {
    const sent: { name: string; text: string }[] = [];
    render(
      <CodeCardSheet
        visible onClose={noop} item={GUARDS} info={INFO} sample jobLabel="Reyes deck, Massapequa"
        recipients={SUBS} onSendToSub={(r, text) => sent.push({ name: r.name, text })}
      />,
    );
    fireEvent.press(screen.getByTestId('code-card-sheet-guards-send'));
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('Dave R.');
    expect(sent[0].text).toContain('Confirm with Town of Oyster Bay Building Division.');
    expect(sent[0].text.endsWith('(Sample)')).toBe(true);
  });

  it('6b: no subs: the send button is blocked and says why', () => {
    render(<CodeCardSheet visible onClose={noop} item={GUARDS} info={INFO} sample />);
    expect(screen.getByText('Add a sub with a phone number in Subs, then you can text this from here.')).toBeTruthy();
  });

  it('7: recall reads the same on every recalled card, and every card is a Sample', () => {
    render(<CodeCardList items={ANSWER} info={INFO} sample />);
    expect(screen.getAllByText('Model recall · confirm')).toHaveLength(3);
    expect(screen.getAllByText('Sample')).toHaveLength(3);
    expect(screen.getByText('Confirm with your building department.')).toBeTruthy();
    expect(screen.getByText(/MAGE ID is not affiliated with ICC\./)).toBeTruthy();
  });

  it('8: By inspection shows the booked date and Not booked', () => {
    render(planTree('stage'));
    fireEvent.press(screen.getByTestId('plan-by-stage-by-stage'));
    expect(screen.getByText('Thu, Oct 9')).toBeTruthy();
    expect(screen.getAllByText('Not booked').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('3 things to fix before you submit.')).toBeTruthy();
  });

  it('9: Sunlight steps the verdict line up a size', () => {
    const { unmount } = render(<CodeCard item={GUARDS} info={INFO} sample />);
    const base = StyleSheet.flatten(screen.getByText(GUARDS.summary).props.style).fontSize as number;
    unmount();
    render(<CodeCard item={GUARDS} info={INFO} sample sunlight />);
    const sun = StyleSheet.flatten(screen.getByText(GUARDS.summary).props.style).fontSize as number;
    expect(sun).toBeGreaterThan(base);
  });
});
