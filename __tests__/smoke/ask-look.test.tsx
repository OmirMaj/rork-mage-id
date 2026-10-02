/**
 * Ask MAGE's new look (lane AILOOK), mounted at '/ask' inside the REAL app (the
 * 16-provider stack, the populated fixture world, iOS 390 x 844, fake timers).
 *
 * THE PROMISES THIS PROVES
 *   1. Send: "Which RFIs are late?" appears at once as the user turn
 *      (ask-turn-user, gliding up from 56 pt), the thinking row (ask-thinking)
 *      appears only after 140 ms, and when the answer lands the assistant turn
 *      (ask-turn-assistant) shows it and the thinking row is gone.
 *   2. A fast answer (in before 140 ms) never renders the thinking row.
 *   3. The send button says why it is disabled: accessibilityState.disabled
 *      and the hint "Type a question to send" on an empty composer.
 *   4. Reduce Motion: the same flow renders the same nodes, and the user turn
 *      carries no transform (no travel, no scale).
 *   5. The do-it card (lane AIDO) still mounts: "create a project for the
 *      Henderson kitchen" shows ask-action-card with no One Mind call and no
 *      AI meter check.
 *
 * askOneMind is a deferred promise (the web dock test's mock style,
 * __tests__/web/w6d-k1-shell.webtest.tsx), the AI meter is a spy, and Reduce
 * Motion is switched through the motion module.
 */

import React from 'react';
import { Dimensions, StyleSheet, type ViewStyle } from 'react-native';
import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';

type Answer = { answer: string; citations: unknown[]; usedAI: boolean; errorKind?: string; errorCode?: string };

let mockResolveAnswer: ((a: Answer) => void) | null = null;
let mockInstant: Answer | null = null;
const mockAskOneMind = jest.fn(() => {
  if (mockInstant) return Promise.resolve(mockInstant);
  return new Promise<Answer>((resolve) => { mockResolveAnswer = resolve; });
});
jest.mock('@/utils/oneMind/answer', () => {
  const actual = jest.requireActual('@/utils/oneMind/answer');
  return { ...actual, askOneMind: (...a: unknown[]) => (mockAskOneMind as unknown as (...x: unknown[]) => unknown)(...a) };
});

const mockCheckAILimit = jest.fn(async () => ({ allowed: true }));
jest.mock('@/utils/aiRateLimiter', () => {
  const actual = jest.requireActual('@/utils/aiRateLimiter');
  return {
    ...actual,
    checkAILimit: (...a: unknown[]) => (mockCheckAILimit as unknown as (...x: unknown[]) => unknown)(...a),
    recordAIUsage: async () => {},
  };
});

let mockReduced = false;
jest.mock('@/components/ui/motion', () => {
  const actual = jest.requireActual('@/components/ui/motion');
  return { ...actual, useReducedMotion: () => mockReduced, reducedMotion: () => mockReduced };
});

const QUESTION = 'Which RFIs are late?';
const ANSWER = 'Two RFIs are late.';

beforeEach(() => {
  jest.useFakeTimers();
  mockAskOneMind.mockClear();
  mockCheckAILimit.mockClear();
  mockResolveAnswer = null;
  mockInstant = null;
  mockReduced = false;
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } });
});

/** Let promises settle without moving the clock. */
async function flush(): Promise<void> {
  await act(async () => { for (let k = 0; k < 30; k++) await Promise.resolve(); });
}
async function advance(ms: number): Promise<void> {
  await act(async () => { jest.advanceTimersByTime(ms); for (let k = 0; k < 10; k++) await Promise.resolve(); });
}

const flat = (node: { props: { style?: unknown } }): ViewStyle => StyleSheet.flatten(node.props.style as ViewStyle) ?? {};

async function openAsk(): Promise<void> {
  await primeWorld('populated');
  const tree = await mountRouteChecked('/ask');
  expect(tree.getPathname()).toBe('/ask');
}

async function send(text: string): Promise<void> {
  fireEvent.changeText(screen.getByTestId('ask-input'), text);
  await flush();
  fireEvent.press(screen.getByTestId('ask-send'));
  await flush();
}

describe('Ask MAGE look on a phone (real app)', () => {
  it('send: the user turn at once, thinking after 140 ms, then the answer and no thinking row', async () => {
    await openAsk();
    await send(QUESTION);

    const user = screen.getByTestId('ask-turn-user');
    expect(within(user).getByText(QUESTION)).toBeTruthy();
    // The glide is wired: a live turn starts 56 pt low (the page variant).
    expect(JSON.stringify(flat(user).transform ?? [])).toContain('"translateY":56');
    expect(screen.queryByTestId('ask-thinking')).toBeNull();
    expect(mockAskOneMind).toHaveBeenCalledTimes(1);

    await advance(100);
    expect(screen.queryByTestId('ask-thinking')).toBeNull();
    await advance(60);
    const thinking = screen.getByTestId('ask-thinking');
    expect(within(thinking).getByText('Reading your records')).toBeTruthy();
    expect(thinking.props.accessibilityLabel).toBe('MAGE is reading your records');

    await act(async () => { mockResolveAnswer?.({ answer: ANSWER, citations: [], usedAI: false }); });
    await flush();
    const answer = screen.getByTestId('ask-turn-assistant');
    expect(within(answer).getByText(ANSWER)).toBeTruthy();
    // No citations, no "Sources" label.
    expect(screen.queryByText('Sources')).toBeNull();
    await advance(200);
    expect(screen.queryByTestId('ask-thinking')).toBeNull();
  });

  it('a fast answer (before 140 ms) never renders the thinking row', async () => {
    await openAsk();
    mockInstant = { answer: ANSWER, citations: [], usedAI: false };
    await send(QUESTION);
    expect(screen.getByTestId('ask-turn-assistant')).toBeTruthy();
    for (let t = 0; t < 400; t += 20) {
      expect(screen.queryByTestId('ask-thinking')).toBeNull();
      await advance(20);
    }
    expect(screen.queryByTestId('ask-thinking')).toBeNull();
  });

  it('the send button says why it is disabled', async () => {
    await openAsk();
    const sendBtn = screen.getByTestId('ask-send');
    expect(sendBtn.props.accessibilityState).toMatchObject({ disabled: true });
    expect(sendBtn.props.accessibilityHint).toBe('Type a question to send');
    fireEvent.changeText(screen.getByTestId('ask-input'), QUESTION);
    await flush();
    const ready = screen.getByTestId('ask-send');
    expect(ready.props.accessibilityState).toMatchObject({ disabled: false });
    expect(ready.props.accessibilityHint).toBeUndefined();
    expect(screen.getByTestId('ask-input').props.placeholder).toBe('Ask a question or say what to do');
  });

  it('Reduce Motion: the same nodes, and the user turn never travels or scales', async () => {
    mockReduced = true;
    await openAsk();
    await send(QUESTION);
    const user = screen.getByTestId('ask-turn-user');
    expect(within(user).getByText(QUESTION)).toBeTruthy();
    expect(flat(user).transform).toBeUndefined();
    await advance(160);
    expect(screen.getByTestId('ask-thinking')).toBeTruthy();
    await act(async () => { mockResolveAnswer?.({ answer: ANSWER, citations: [], usedAI: false }); });
    await flush();
    expect(within(screen.getByTestId('ask-turn-assistant')).getByText(ANSWER)).toBeTruthy();
    expect(flat(screen.getByTestId('ask-turn-assistant')).transform).toBeUndefined();
    await advance(200);
    expect(screen.queryByTestId('ask-thinking')).toBeNull();
  });

  it('"create a project for the Henderson kitchen" shows the do-it card: no One Mind call, no meter', async () => {
    await openAsk();
    await send('create a project for the Henderson kitchen');
    expect(screen.getByTestId('ask-action-card')).toBeTruthy();
    expect(screen.getByTestId('ask-turn-assistant')).toBeTruthy();
    expect(mockAskOneMind).not.toHaveBeenCalled();
    expect(mockCheckAILimit).not.toHaveBeenCalled();
  });
});
