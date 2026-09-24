/**
 * Render coverage — the /tutorials hub (app/tutorials.tsx).
 *
 * The hub is the menu of learn-by-doing tutorials, and who sees which card is
 * a contract:
 *   (a) a contractor sees every wave-A tutorial, grouped On site / Money;
 *   (b) an invited field seat sees daily report and punch only — NO money
 *       cards (invoicing is the GC's business, not the foreman's);
 *   (c) a client or property manager sees an explanation and no cards;
 *   (d) a saved run shows 'Continue · step N of M', a finished one
 *       'Practised · Replay', and a plan that lacks the feature gets the
 *       practice-pass tier tag;
 *   (e) tapping a card hands that tutorial to onStart — the hub itself never
 *       starts or resumes anything on its own.
 *
 * It renders the real TutorialsHubView inside the real ThemeProvider, fed by
 * the real pure model (utils/tutorial/entryPoints hubSections) — the same
 * call the screen's default export makes. The full every-route smoke mounts
 * the default export itself.
 */

import React from 'react';
import { fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { TutorialsHubView } from '@/app/tutorials';
import { hubEmptyReason, hubSections, type HubCtx } from '@/utils/tutorial/entryPoints';
import { EMPTY_PROGRESS } from '@/utils/tutorial/offers';
import type { TutorialProgress } from '@/utils/tutorial/types';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider>{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}

const freePlan = () => false;
const businessPlan = () => true;

function renderHub(over: Partial<HubCtx> = {}, onStart = jest.fn()) {
  const ctx: HubCtx = {
    persona: 'contractor',
    fieldOnly: false,
    progress: EMPTY_PROGRESS,
    canAccess: freePlan,
    practicePass: true,
    ...over,
  };
  const sections = hubSections(ctx);
  const utils = render(
    <TutorialsHubView sections={sections} emptyReason={hubEmptyReason(ctx.persona, sections)} busyId={null} onStart={onStart} />,
    { wrapper: Wrapper },
  );
  return { ...utils, onStart };
}

describe('tutorials hub', () => {
  it('shows every wave-A tutorial to a contractor, grouped', () => {
    const { getByTestId, queryByTestId, getByText } = renderHub();
    expect(getByTestId('tutorials-hub-intro')).toBeTruthy();
    expect(getByTestId('tutorials-group-site')).toBeTruthy();
    expect(getByTestId('tutorials-group-money')).toBeTruthy();
    expect(getByTestId('tutorial-card-daily-report-voice')).toBeTruthy();
    expect(getByTestId('tutorial-card-punch-walk')).toBeTruthy();
    expect(getByTestId('tutorial-card-invoice-to-self')).toBeTruthy();
    expect(queryByTestId('tutorials-hub-empty')).toBeNull();
    expect(getByText('ON SITE')).toBeTruthy();
    expect(getByText('MONEY')).toBeTruthy();
  });

  it('gives a field seat daily report and punch only — no money cards', () => {
    const { getByTestId, queryByTestId } = renderHub({ fieldOnly: true });
    expect(getByTestId('tutorial-card-daily-report-voice')).toBeTruthy();
    expect(getByTestId('tutorial-card-punch-walk')).toBeTruthy();
    expect(queryByTestId('tutorial-card-invoice-to-self')).toBeNull();
    expect(queryByTestId('tutorials-group-money')).toBeNull();
  });

  it.each(['client', 'property_manager'] as const)('shows a %s an explanation and no cards', persona => {
    const { getByTestId, queryByTestId } = renderHub({ persona });
    expect(getByTestId('tutorials-hub-empty')).toBeTruthy();
    expect(queryByTestId('tutorial-card-daily-report-voice')).toBeNull();
    expect(queryByTestId('tutorials-group-site')).toBeNull();
  });

  it('pills: New, Continue · step N of M, Practised · Replay', () => {
    const progress: TutorialProgress = {
      v: 1,
      byId: { 'daily-report-voice': { status: 'practised', version: 1 } },
      active: { tutorialId: 'punch-walk', version: 1, stepIndex: 2, sandboxProjectId: 'sample-1', entry: 'hub', savedAt: Date.now() },
      chips: {},
    };
    const { getByTestId } = renderHub({ progress });
    const pill = (id: string) => within(getByTestId(`tutorial-card-${id}-status`));
    expect(pill('daily-report-voice').getByText('Practised · Replay')).toBeTruthy();
    expect(pill('punch-walk').getByText(/^Continue · step 3 of \d+$/)).toBeTruthy();
    expect(pill('invoice-to-self').getByText('New')).toBeTruthy();
  });

  // One tree per test: a second render inside the same test left React's
  // async act queue flushing a ThemeProvider mount after jest had torn the
  // environment down, which crashed the whole run with no results.
  it('tags the practice pass on a plan that lacks the feature', () => {
    const free = renderHub({ canAccess: freePlan });
    expect(free.getByTestId('tutorial-card-punch-walk-tier')).toBeTruthy();
    expect(free.getByText('Business — practise free on the sample')).toBeTruthy();
    expect(free.getByText('Pro — practise free on the sample')).toBeTruthy();
    expect(free.queryByTestId('tutorial-card-daily-report-voice-tier')).toBeNull();
  });

  it('shows no tier tag on a plan that already has the feature', () => {
    const biz = renderHub({ canAccess: businessPlan });
    expect(biz.queryByTestId('tutorial-card-punch-walk-tier')).toBeNull();
    expect(biz.queryByTestId('tutorial-card-invoice-to-self-tier')).toBeNull();
  });

  it('with the practice pass off, hides what the plan does not include', () => {
    const { getByTestId, queryByTestId } = renderHub({ practicePass: false, canAccess: freePlan });
    expect(getByTestId('tutorial-card-daily-report-voice')).toBeTruthy();
    expect(queryByTestId('tutorial-card-punch-walk')).toBeNull();
    expect(queryByTestId('tutorial-card-invoice-to-self')).toBeNull();
  });

  it('a tap hands the card to onStart and nothing starts on its own', () => {
    const { getByTestId, onStart } = renderHub();
    expect(onStart).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('tutorial-card-punch-walk'));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0].id).toBe('punch-walk');
  });
});
