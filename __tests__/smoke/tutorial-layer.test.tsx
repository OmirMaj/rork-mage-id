/**
 * Render coverage — the tutorial coach layer (components/tutorial/TutorialLayer).
 *
 * The layer is the only thing standing between the user and the real control
 * while a tutorial runs, so what it draws is a contract:
 *   (a) a spotlight is FOUR dim rects around an empty hole, plus the card —
 *       the real control under the hole gets the real touch;
 *   (b) the card's X ends the tutorial (and nothing else does: a tap on the
 *       dim never advances or exits);
 *   (c) Next exists on LOOK steps only — a do step moves only on the real
 *       action;
 *   (d) with a screen reader on there are NO dims (VoiceOver / TalkBack must
 *       reach every control), only the card;
 *   (e) idle draws nothing.
 *
 * It mounts the real layer inside the real ThemeProvider, drives the real
 * store (utils/tutorial/store) and machine, and sets the presentation the host
 * would compute. No host is mounted, so the card's buttons fall through to the
 * store's direct dispatch — which is exactly what the assertions read.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { TutorialLayer } from '@/components/tutorial/TutorialLayer';
import {
  EMPTY_PRESENTATION,
  __resetTutorialStoreForTest,
  dispatchTutorial,
  getTutorialState,
  setTutorialPresentation,
  tutorialSignal,
  type TutorialPresentation,
} from '@/utils/tutorial/store';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const SB = 'sample-1';

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}

function bootDfr() {
  const now = Date.now();
  dispatchTutorial({ type: 'START', tutorialId: 'daily-report-voice', sandboxProjectId: SB, entry: 'hub', now });
  dispatchTutorial({ type: 'ROUTE', pathname: '/daily-report', params: { projectId: SB }, now });
  dispatchTutorial({ type: 'BOOTED', flags: { samplePlan: true, mic: true }, mounted: [], now });
}

const RECT = { x: 20, y: 300, w: 200, h: 48 };
// The dims are hidden from accessibility on purpose (VoiceOver must not land
// on them), and RNTL skips hidden elements by default — so every dim query,
// including the "there are none" ones, has to look at hidden elements too.
const HIDDEN = { includeHiddenElements: true } as const;

function spotlight(over: Partial<TutorialPresentation> = {}): TutorialPresentation {
  return {
    ...EMPTY_PRESENTATION,
    view: { kind: 'spotlight', layer: 'root', stepId: 'dfr-voice', targetId: 'dfr.voice', rect: RECT },
    stepId: 'dfr-voice',
    stepKind: 'do',
    text: 'Tap the sample note — or the mic and say your day',
    detail: 'Sample — no AI credits used.',
    stepNumber: 1,
    stepCount: 4,
    gesture: 'tap',
    targetRect: RECT,
    hole: { x: 12, y: 292, w: 216, h: 64 },
    ...over,
  };
}

function mountLayer() {
  const utils = render(<TutorialLayer host="root" />, { wrapper: Wrapper });
  // The layer draws only once it knows its own size.
  const layer = utils.getByTestId('tutorial-layer-root');
  act(() => {
    fireEvent(layer, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
  });
  return utils;
}

beforeEach(() => {
  __resetTutorialStoreForTest();
  setTutorialPresentation(EMPTY_PRESENTATION);
});

describe('TutorialLayer', () => {
  it('draws nothing while no tutorial runs', () => {
    const { queryByTestId } = render(<TutorialLayer host="root" />, { wrapper: Wrapper });
    expect(queryByTestId('tutorial-layer-root')).toBeNull();
    expect(queryByTestId('tutorial-coach-card')).toBeNull();
  });

  it('renders four dims around the hole, and the card', () => {
    act(() => { bootDfr(); setTutorialPresentation(spotlight()); });
    const { getByTestId } = mountLayer();
    for (const side of ['top', 'bottom', 'left', 'right']) expect(getByTestId(`tutorial-dim-${side}`, HIDDEN)).toBeTruthy();
    expect(getByTestId('tutorial-coach-card')).toBeTruthy();
    expect(getByTestId('tutorial-card-text').props.children).toBe('Tap the sample note — or the mic and say your day');
  });

  it('has no Next on a do step, and a tap on the dim does not advance', () => {
    act(() => { bootDfr(); setTutorialPresentation(spotlight({ next: false })); });
    const { queryByTestId, getByTestId } = mountLayer();
    expect(queryByTestId('tutorial-next')).toBeNull();
    const before = getTutorialState();
    act(() => {
      fireEvent(getByTestId('tutorial-dim-top', HIDDEN), 'responderRelease', { nativeEvent: {} });
    });
    const after = getTutorialState();
    expect(after.status).toBe('running');
    expect(after.status === 'running' && before.status === 'running' && after.stepIndex === before.stepIndex).toBe(true);
  });

  it('shows Next on a look step, and Next moves it', () => {
    act(() => {
      bootDfr();
      tutorialSignal('dfr.voice.applied', { projectId: SB, fields: ['manpower', 'workPerformed', 'issuesAndDelays'], source: 'sample' });
      setTutorialPresentation(spotlight({ stepId: 'dfr-preview', stepKind: 'look', next: true, text: 'One note filled crew, work done and the delay.' }));
    });
    const s0 = getTutorialState();
    expect(s0.status === 'running' && s0.stepIndex).toBe(1);
    const { getByTestId } = mountLayer();
    act(() => { fireEvent.press(getByTestId('tutorial-next')); });
    const s1 = getTutorialState();
    expect(s1.status === 'running' && s1.stepIndex).toBe(2);
  });

  it('the X ends the tutorial', () => {
    act(() => { bootDfr(); setTutorialPresentation(spotlight()); });
    const { getByTestId } = mountLayer();
    act(() => { fireEvent.press(getByTestId('tutorial-end')); });
    const s = getTutorialState();
    expect(s.status).toBe('finished');
    expect(s.status === 'finished' && s.outcome).toBe('exited');
  });

  it('draws no dims with a screen reader on — card only', () => {
    act(() => {
      bootDfr();
      setTutorialPresentation(
        spotlight({
          view: { kind: 'card', reason: 'screenreader', layer: 'root', stepId: 'dfr-voice' },
          screenReader: true,
          skip: true,
          hole: null,
          targetRect: null,
        }),
      );
    });
    const { queryByTestId, getByTestId } = mountLayer();
    expect(queryByTestId('tutorial-dims', HIDDEN)).toBeNull();
    expect(queryByTestId('tutorial-dim-top', HIDDEN)).toBeNull();
    expect(getByTestId('tutorial-coach-card')).toBeTruthy();
    expect(getByTestId('tutorial-skip-step')).toBeTruthy();
  });

  it('never dims with a screen reader on, even if handed a spotlight', () => {
    // Belt and braces: the host already turns screen-reader steps into card
    // mode, but the layer must not trap VoiceOver behind dims on its own say.
    act(() => { bootDfr(); setTutorialPresentation(spotlight({ screenReader: true })); });
    const { queryByTestId, getByTestId } = mountLayer();
    expect(queryByTestId('tutorial-dim-top', HIDDEN)).toBeNull();
    expect(getByTestId('tutorial-coach-card')).toBeTruthy();
  });

  it('a modal layer draws nothing for a root step', () => {
    act(() => { bootDfr(); setTutorialPresentation(spotlight()); });
    const { getByTestId, queryByTestId } = render(<TutorialLayer host="planPin" />, { wrapper: Wrapper });
    act(() => {
      fireEvent(getByTestId('tutorial-layer-planPin'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
    });
    expect(queryByTestId('tutorial-coach-card')).toBeNull();
    expect(queryByTestId('tutorial-dim-top', HIDDEN)).toBeNull();
  });
});
