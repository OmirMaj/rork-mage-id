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
 *  10  a PARENT match (real NY row) is recall: the card, the tape, the opened
 *      card and the sub text all keep the recall labels
 *  11  the trigger number is model recall even under a section the law names,
 *      and is never credited to that source
 *  12  the opened card's Sunlight switch shows what drives it, and writes the
 *      stored preference
 *  13  the opened card starts from a saved re-measure, and steps once per tap
 *  14  a card with no section says so, and Official text never says "copied"
 *  15  tenant wipe: after resetCodeCardStores the next pin carries nothing over
 *  16  an edition the AI cited that MAGE holds no record of here is marked on
 *      the card and set apart on the opened card, never over the state's
 *      source; another adopted volume gets its own line with no recall mark
 *  17  the compact row says "Recall" for a recalled section
 *  18  a button with no action, or a blocked one, says why (card and opened card)
 *  19  a pin of a card with no section and a 400-character line survives a
 *      restart; a card the store cannot keep has a blocked Checklist, with why
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CodeCard, CodeCardList, CodeCardSheet, JurisdictionBlock, blockedAction, doneAction, readyAction } from '@/components/codeCard';
import type { CodeCardItem, CodeJobValue, CodeJurisdictionInfo } from '@/utils/codeCard/types';
import { codeJurisdictionInfoFor } from '@/utils/codeCard/jurisdiction';
import { subRecipientsFor } from '@/utils/codeCard/shareText';
import { __resetSunlightForTest, getSunlight, setSunlight } from '@/utils/codeCard/sunlight';
import { CODE_PINS_KEY, codePinStore, createPinStore, isPinned, makePin, pinsFor, __setCodePinStoreForTest } from '@/utils/codeCard/pins';
import { STORE_BLOCKED_REASON, parseCodeCardItems } from '@/utils/codeCard/parse';
import { resetCodeCardStores } from '@/utils/codeCard/reset';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

  // ONE render() PER TEST, from here down. RNTL's afterEach cleanup starts one
  // un-awaited async act per rendered root; with two roots those overlap and
  // React's act depth is left at 1, so every later render in the file is
  // queued and never flushed (this used to be the last test, so it never showed).
  it('9: Sunlight steps the verdict line up a size', () => {
    render(
      <>
        <CodeCard item={GUARDS} info={INFO} sample sunlight={false} />
        <CodeCard item={GUARDS} info={INFO} sample sunlight testID="sunlit" />
      </>,
    );
    const [base, sun] = screen.getAllByText(GUARDS.summary).map((n) => StyleSheet.flatten(n.props.style).fontSize as number);
    expect(sun).toBeGreaterThan(base);
  });

  // REAL New York rows: 19 NYCRR § 1220.2(a)(6) names RCNYS § P2904. A cited
  // P2904.2.4 matches only through its PARENT, which codeAmendments says is
  // not backing ("did NOT verify § P2904.2.4 itself"). The requirement line and
  // the numbers are SAMPLES.
  const SPRINKLER: CodeCardItem = {
    id: 'sprinkler', verdict: 'required', summary: 'Sample: a sprinkler head within reach of every room.',
    section: 'P2904.2.4', citedEdition: '2025 RCNYS', evidence: ev('P2904.2.4'), stage: 'rough', stageIsGuess: true,
    jobValue: { value: 14, unit: 'ft', source: 'sheet', sourceLabel: 'sheet A-1' },
    trigger: { value: 12, unit: 'ft', comparison: '>' },
  };
  const SPRINKLER_EXACT: CodeCardItem = { ...SPRINKLER, id: 'sprinkler-exact', section: 'P2904', evidence: ev('P2904') };
  const LAW = '19 NYCRR';

  it('10: a parent match is recall on the card and its tape', () => {
    expect(SPRINKLER.evidence?.rung).toBe('named');
    expect(SPRINKLER.evidence?.parentMatch).toBe(true);
    render(<CodeCard item={SPRINKLER} info={INFO} sample />);
    expect(screen.getByText('Model recall · confirm')).toBeTruthy();
    expect(screen.queryByText('Named in law')).toBeNull();
    expect(screen.getByText('14 ft from sheet A-1 · 12 ft trigger is model recall')).toBeTruthy();
    expect(screen.getByTestId('code-card-sprinkler-tape').props.accessibilityLabel).toContain('The trigger is model recall.');
    expect(screen.getByTestId('code-card-sprinkler-evidence').props.accessibilityLabel).toMatch(/^Evidence 2 of 4: Model recall · confirm\. Parent section named in law\./);
  });

  it('10b: a parent match is recall on the opened card and in the sub text', () => {
    render(<CodeCardSheet visible onClose={noop} item={SPRINKLER} info={INFO} sample recipients={SUBS} onSendToSub={noop} />);
    const tid = 'code-card-sheet-sprinkler';
    expect(screen.getByText('The trigger number is model recall. Confirm it in the official text.')).toBeTruthy();
    // The recall label leads; the parent badge and its "did NOT verify" sentence sit under it.
    expect(screen.getByText('Model recall · confirm')).toBeTruthy();
    expect(screen.getByText('Parent section named in law')).toBeTruthy();
    expect(screen.getByText(/did NOT verify § P2904\.2\.4 itself/)).toBeTruthy();
    const share = screen.getByTestId(`${tid}-share-text`).props.children as string;
    expect(share).toContain('Applies above 12 ft (AI recall, confirm).');
    expect(share).toContain('Ref: 2025 RCNYS P2904.2.4 (section from AI recall, confirm).');
    expect(share).not.toContain(LAW);
  });

  it('11: under a section the law names, the card’s trigger number is still model recall and never credited to that source', () => {
    expect(SPRINKLER_EXACT.evidence?.rung).toBe('named');
    expect(SPRINKLER_EXACT.evidence?.parentMatch).toBe(false);
    render(<CodeCard item={SPRINKLER_EXACT} info={INFO} sample />);
    expect(screen.getByText('Named in law')).toBeTruthy();
    expect(screen.getByText('14 ft from sheet A-1 · 12 ft trigger is model recall')).toBeTruthy();
    const tape = screen.getByTestId('code-card-sprinkler-exact-tape');
    expect(tape.props.accessibilityLabel).toContain('The trigger is model recall.');
    expect(tape.props.accessibilityLabel).not.toContain(LAW);
    // No text on the card credits anything to the regulation (it sits only in
    // the evidence meter's screen-reader sentence, about the SECTION).
    expect(screen.queryByText(new RegExp(LAW))).toBeNull();
  });

  it('11b: …and so does the opened card: the section note goes, the number’s note stays', () => {
    render(<CodeCardSheet visible onClose={noop} item={SPRINKLER_EXACT} info={INFO} sample recipients={SUBS} onSendToSub={noop} />);
    expect(screen.getByText('The trigger number is model recall. Confirm it in the official text.')).toBeTruthy();
    const share = screen.getByTestId('code-card-sheet-sprinkler-exact-share-text').props.children as string;
    expect(share).toContain('Applies above 12 ft (AI recall, confirm).');
    expect(share).toContain('Ref: 2025 RCNYS P2904. Confirm with');
    expect(share).not.toContain('section from AI recall');
    expect(share).not.toContain('..');
  });

  it('12: the opened card’s Sunlight switch shows what drives it and writes the stored preference', () => {
    setSunlight(true);
    render(<CodeCardSheet visible onClose={noop} item={GUARDS} info={INFO} sample />);
    const tid = 'code-card-sheet-guards';
    const size = () => StyleSheet.flatten(screen.getByText(GUARDS.summary).props.style).fontSize as number;
    expect(screen.getByTestId(`${tid}-sun`).props.accessibilityState).toEqual({ checked: true });
    const sunlit = size();
    fireEvent.press(screen.getByTestId(`${tid}-sun`));
    expect(getSunlight()).toBe(false);
    expect(screen.getByTestId(`${tid}-sun`).props.accessibilityState).toEqual({ checked: false });
    expect(size()).toBeLessThan(sunlit);
    fireEvent.press(screen.getByTestId(`${tid}-sun`));
    expect(getSunlight()).toBe(true);
    expect(size()).toBe(sunlit);
  });

  it('12b: a pinned Sunlight prop flips for this sheet only', () => {
    render(<CodeCardSheet visible onClose={noop} item={GUARDS} info={INFO} sample sunlight />);
    const tid = 'code-card-sheet-guards';
    expect(screen.getByTestId(`${tid}-sun`).props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(screen.getByTestId(`${tid}-sun`));
    expect(screen.getByTestId(`${tid}-sun`).props.accessibilityState).toEqual({ checked: false });
    expect(getSunlight()).toBe(false);
  });

  it('13: the opened card starts from a saved re-measure and steps once per tap', () => {
    const saved: CodeJobValue = { value: 31, unit: 'in', source: 'measured', sourceLabel: 'measured on site' };
    const reported: number[] = [];
    function Host() {
      // A caller that echoes every change straight back into the prop.
      const [jv, setJv] = React.useState<CodeJobValue>(saved);
      return (
        <CodeCardSheet
          visible onClose={noop} item={GUARDS} info={INFO} sample jobValue={jv}
          onJobValueChange={(_i, next) => { reported.push(next.value); setJv(next); }} recipients={SUBS} onSendToSub={noop}
        />
      );
    }
    render(<Host />);
    const tid = 'code-card-sheet-guards';
    expect(screen.getByTestId(`${tid}-value`).props.children).toBe('31');
    expect(screen.getByTestId(`${tid}-near`)).toBeTruthy();
    expect(screen.getByText('Measured on site. The first number came from sheet A-2. Tap − or + to re-check another number.')).toBeTruthy();
    expect(screen.getByTestId(`${tid}-share-text`).props.children as string).toContain('Job: 31 in. (measured on site).');
    fireEvent.press(screen.getByTestId(`${tid}-dec`));
    expect(screen.getByTestId(`${tid}-value`).props.children).toBe('30');
    fireEvent.press(screen.getByTestId(`${tid}-dec`));
    expect(screen.getByTestId(`${tid}-value`).props.children).toBe('29');
    expect(screen.getByTestId(`${tid}-verdict`).props.accessibilityLabel).toBe('Verdict: Not required');
    // Nothing is reported at open; every tap after that is, the step back to
    // the starting number included, so the caller never holds a stale number.
    expect(reported).toEqual([30, 29]);
    fireEvent.press(screen.getByTestId(`${tid}-inc`));
    fireEvent.press(screen.getByTestId(`${tid}-inc`));
    expect(screen.getByTestId(`${tid}-value`).props.children).toBe('31');
    expect(reported).toEqual([30, 29, 30, 31]);
    expect(reported[reported.length - 1]).toBe(saved.value);
  });

  it('13b: + then − reports the starting number again, so Save cannot keep a number that is no longer on screen', () => {
    const got: CodeJobValue[] = [];
    render(<CodeCardSheet visible onClose={noop} item={GUARDS} info={INFO} sample onJobValueChange={(_i, next) => got.push(next)} />);
    const tid = 'code-card-sheet-guards';
    expect(got).toHaveLength(0);
    fireEvent.press(screen.getByTestId(`${tid}-inc`));
    fireEvent.press(screen.getByTestId(`${tid}-dec`));
    expect(screen.getByTestId(`${tid}-value`).props.children).toBe('34');
    expect(got.map((j) => j.value)).toEqual([35, 34]);
    expect(got[1]).toEqual(GUARDS.jobValue);
  });

  const NOSEC: CodeCardItem = { ...BALUSTERS, id: 'nosec', section: '', evidence: null };

  it('14: a card with no section says so, and Official text never says it copied one', async () => {
    const calls: string[] = [];
    const deps = {
      copy: async (t: string) => { calls.push(`copy:${t}`); return true; },
      open: async (u: string) => { calls.push(`open:${u}`); },
    };
    render(<CodeCard item={NOSEC} info={INFO} sample officialTextDeps={deps} />);
    expect(screen.getByText('No section given')).toBeTruthy();
    expect(screen.getByTestId('code-card-nosec-official').props.accessibilityLabel).toContain('no section to copy');
    await act(async () => { fireEvent.press(screen.getByTestId('code-card-nosec-official')); });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^open:https:\/\/codes\.iccsafe\.org\/content\/[A-Z][A-Z0-9]{3,23}$/);
    expect(screen.getByText('Opened the code. This card has no section number, so search the viewer by topic.')).toBeTruthy();
  });

  it('14b: the compact row says "No section given" too', () => {
    render(<CodeCardList items={[NOSEC, GUARDS]} info={INFO} sample initialView="list" />);
    expect(screen.getByText('No section given')).toBeTruthy();
  });

  it('14c: the opened card offers no Copy for a section it does not have', () => {
    render(<CodeCardSheet visible onClose={noop} item={NOSEC} info={INFO} sample />);
    expect(screen.queryByTestId('code-card-sheet-nosec-copy')).toBeNull();
    expect(screen.getByText('No section given')).toBeTruthy();
    expect(screen.getByText('No section to copy')).toBeTruthy();
  });

  it('15: tenant wipe: after resetCodeCardStores the next pin carries nothing of the last user’s', async () => {
    __setCodePinStoreForTest(null);
    await AsyncStorage.removeItem(CODE_PINS_KEY);
    const now = '2026-10-03T12:00:00.000Z';
    const store = codePinStore();
    await act(async () => { await store.load(); });
    store.dispatch({ type: 'pin', pin: makePin('user-a-job', GUARDS, now) });
    await act(async () => {});
    expect(Object.keys(JSON.parse((await AsyncStorage.getItem(CODE_PINS_KEY)) ?? '{}'))).toEqual(['user-a-job']);

    // What wipeLocalUserCache does: memory first (this call), then the key sweep.
    resetCodeCardStores();
    await AsyncStorage.removeItem(CODE_PINS_KEY);
    expect(codePinStore().getState()).toEqual({});

    codePinStore().dispatch({ type: 'pin', pin: makePin('user-b-job', GUARDS, now) });
    await act(async () => {});
    expect(Object.keys(JSON.parse((await AsyncStorage.getItem(CODE_PINS_KEY)) ?? '{}'))).toEqual(['user-b-job']);
    __setCodePinStoreForTest(null);
    await AsyncStorage.removeItem(CODE_PINS_KEY);
  });

  // The address follows the 2025 RCNYS (real row). An answer that cites the
  // 2020 book is recall, and must never sit over the state's adoption record.
  const OLD_BOOK: CodeCardItem = { ...BALUSTERS, id: 'oldbook', citedEdition: '2020 RCNYS', evidence: citationEvidenceFor(NY, '2020 RCNYS', 'R312.1.3') };
  const STATE_SOURCE = 'dos.ny.gov · checked Sep 12, 2026';

  it('16: the opened card prints the VERIFIED edition over the state’s source, and what the AI cited apart, as model recall', () => {
    render(<CodeCardSheet visible onClose={noop} item={OLD_BOOK} info={INFO} sample />);
    expect(screen.getByText('2025 Residential Code of New York State')).toBeTruthy();
    expect(screen.getByText(STATE_SOURCE)).toBeTruthy();
    expect(screen.getByTestId('code-card-sheet-oldbook-cited').props.children).toBe('The AI cited: 2020 RCNYS (model recall)');
    // The recalled edition is never printed bare, so nothing pairs it with the source line.
    expect(screen.queryByText('2020 RCNYS')).toBeNull();
  });

  it('16b: the same edition as the verified one gets no "cited" line', () => {
    render(<CodeCardSheet visible onClose={noop} item={GUARDS} info={INFO} sample />);
    expect(screen.getByText('2025 Residential Code of New York State')).toBeTruthy();
    expect(screen.getByText(STATE_SOURCE)).toBeTruthy();
    expect(screen.queryByTestId('code-card-sheet-guards-cited')).toBeNull();
    expect(screen.queryByText(/The AI cited/)).toBeNull();
  });

  it('16c: with no verified edition the opened card shows no source line at all', () => {
    render(<CodeCardSheet visible onClose={noop} item={{ ...OLD_BOOK, evidence: null }} info={null} sample />);
    expect(screen.getByText('The AI cited: 2020 RCNYS (model recall)')).toBeTruthy();
    expect(screen.getByText('No verified adoption record for this address.')).toBeTruthy();
    expect(screen.queryByText(/dos\.ny\.gov|· checked/)).toBeNull();
  });

  it('16d: the card and the list row mark an edition that is not the verified one', () => {
    render(
      <>
        <CodeCard item={OLD_BOOK} info={INFO} sample />
        <CodeCard item={BALUSTERS} info={INFO} sample testID="same-book" />
        <CodeCardList items={[OLD_BOOK, GUARDS]} info={INFO} sample initialView="list" testID="rows" />
      </>,
    );
    // Card + row for the old book: marked both times. Card + row for the verified one: bare.
    expect(screen.getAllByText('2020 RCNYS (as cited)')).toHaveLength(2);
    expect(screen.getAllByText('2025 RCNYS')).toHaveLength(2);
    expect(screen.queryByText('2020 RCNYS')).toBeNull();
  });

  it('16e: Code Check style (the answer’s edition is every adopted code): a card citing one of them by name is not recall', () => {
    const INFO_ALL = codeJurisdictionInfoFor(NY, permitOfficeFor(PLACE), null);
    render(
      <>
        <CodeCard item={GUARDS} info={INFO_ALL} sample />
        <CodeCardSheet visible onClose={noop} item={GUARDS} info={INFO_ALL} sample />
      </>,
    );
    expect(INFO_ALL.editionLabel).toMatch(/Energy Conservation Construction Code/);
    expect(screen.getByText('2025 RCNYS')).toBeTruthy();                       // the card's meta line, bare
    expect(screen.queryByText('2025 RCNYS (as cited)')).toBeNull();
    expect(screen.getByText(INFO_ALL.editionLabel as string)).toBeTruthy();     // the opened card: the verified record…
    expect(screen.getByText(STATE_SOURCE)).toBeTruthy();                        // …with the state's source under IT
    expect(screen.getByTestId('code-card-sheet-guards-cited').props.children).toBe('Cited on this card: 2025 RCNYS');
    expect(screen.queryByText(/The AI cited/)).toBeNull();
  });

  it('17: the compact row says Recall for a recalled section and names the law only for a backed one', () => {
    render(<CodeCardList items={[GUARDS, SPRINKLER, SPRINKLER_EXACT]} info={INFO} sample initialView="list" />);
    expect(screen.getAllByText('Recall')).toHaveLength(2);       // recalled + the parent match
    expect(screen.getAllByText('Named in law')).toHaveLength(1); // the exactly named section
  });

  it('18: a card button with no action says why when tapped', () => {
    render(<CodeCard item={GUARDS} info={INFO} sample />);
    fireEvent.press(screen.getByTestId('code-card-guards-checklist'));
    expect(screen.getByText('Checklist: Not available here.')).toBeTruthy();
  });

  it('18b: a blocked action on the opened card says why when tapped', () => {
    render(<CodeCardSheet visible onClose={noop} item={GUARDS} info={INFO} sample save={blockedAction('Link a job first.')} />);
    expect(screen.getByText('Link a job first.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('code-card-sheet-guards-save'));
    expect(screen.getByTestId('code-card-sheet-guards-note').props.children).toBe('Save to the job: Link a job first.');
  });

  // What Code Check and the plan check hand the stores: a card with no section
  // and a line up to 400 characters.
  const LONG_LINE = `${'Sample: a guard on every open side here. '.repeat(9)}Sample${'x'.repeat(60)}`.slice(0, 399) + '.';
  const WIDE: CodeCardItem = { ...BALUSTERS, id: 'wide', section: '', evidence: null, summary: LONG_LINE };

  it('19: a pin of a card with no section and a 400-character line is still there after a restart', async () => {
    expect(LONG_LINE).toHaveLength(400);
    await AsyncStorage.removeItem(CODE_PINS_KEY);
    const first = createPinStore();
    await act(async () => { await first.load(); });
    first.dispatch({ type: 'pin', pin: makePin('job-1', WIDE, '2026-10-03T12:00:00.000Z') });
    first.dispatch({ type: 'pin', pin: makePin('job-1', GUARDS, '2026-10-03T12:00:00.000Z') });
    await act(async () => {});
    expect(isPinned(first.getState(), 'job-1', 'wide')).toBe(true);

    const restarted = createPinStore();
    await act(async () => { await restarted.load(); });
    expect(pinsFor(restarted.getState(), 'job-1').map((p) => p.item.id)).toEqual(['wide', 'guards']);
    expect(restarted.getState()).toEqual(first.getState());
    expect(pinsFor(restarted.getState(), 'job-1')[0].item.summary).toBe(LONG_LINE);
    await AsyncStorage.removeItem(CODE_PINS_KEY);
  });

  it('19b: a card the store cannot keep has a blocked Checklist that says why, and its tap pins nothing', () => {
    const run = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    let pressed = 0;
    render(<CodeCard item={{ ...BALUSTERS, id: 'run', summary: run }} info={INFO} sample checklist={readyAction(() => { pressed++; })} />);
    fireEvent.press(screen.getByTestId('code-card-run-checklist'));
    expect(pressed).toBe(0);
    expect(screen.getByText(`Checklist: ${STORE_BLOCKED_REASON}`)).toBeTruthy();
  });

  it('20: a card off the wire whose numbers disagree with the AI’s verdict opens on the AI’s verdict, with no tape and no result line', () => {
    // The AI said "required" and "at least 36 in.", but sent 34 in. against >= 36 in.
    // (a minimum mislabelled as a trigger). Re-checked on first render, the card
    // used to open as NOT REQUIRED under a summary that says raise it.
    const [raised] = parseCodeCardItems([{
      id: 'raise', verdict: 'required', summary: 'Sample: raise the guard, it has to be at least 36 in. high.', section: 'R312.1.2', citedEdition: '2025 RCNYS',
      trigger: { value: 36, unit: 'in', comparison: '>=' }, jobValue: { value: 34, unit: 'in', source: 'job', sourceLabel: 'guard height from your question' },
    }]);
    expect(raised.jobValue).toBeUndefined();
    const card = render(<CodeCard item={raised} info={INFO} sample />);
    expect(screen.getByTestId('code-card-raise-verdict').props.accessibilityLabel).toBe('Verdict: Required');
    expect(screen.queryByTestId('code-card-raise-tape')).toBeNull();
    card.unmount();
    render(<CodeCardSheet visible onClose={noop} item={raised} info={INFO} sample jobLabel="Reyes deck, Massapequa" recipients={SUBS} onSendToSub={noop} />);
    const tid = 'code-card-sheet-raise';
    expect(screen.getByTestId(`${tid}-verdict`).props.accessibilityLabel).toBe('Verdict: Required');
    expect(screen.queryByTestId(`${tid}-tape`)).toBeNull();
    expect(screen.queryByTestId(`${tid}-dec`)).toBeNull();
    const share = screen.getByTestId(`${tid}-share-text`).props.children as string;
    expect(share).toContain('Sample: raise the guard, it has to be at least 36 in. high.');
    expect(share).not.toMatch(/Job: |Result:|not required/i);
    expect(share.endsWith('(Sample)')).toBe(true);
    // The other way round: "not required" with 24 in. against < 30 in.
    const [low] = parseCodeCardItems([{
      id: 'low', verdict: 'not_required', summary: 'Sample: no guard needed, the deck is under 30 in. above grade.', section: 'R312.1.1', citedEdition: '2025 RCNYS',
      trigger: { value: 30, unit: 'in', comparison: '<' }, jobValue: { value: 24, unit: 'in', source: 'job', sourceLabel: 'deck height from your question' },
    }]);
    render(<CodeCard item={low} info={INFO} sample />);
    expect(screen.getByTestId('code-card-low-verdict').props.accessibilityLabel).toBe('Verdict: Not required');
    expect(screen.queryByTestId('code-card-low-tape')).toBeNull();
  });
});
