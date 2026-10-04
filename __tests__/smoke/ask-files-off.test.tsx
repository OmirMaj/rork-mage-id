/**
 * Ask MAGE with the file reader DARK (lane ATTASK), in the REAL app with the
 * REAL flag (constants/featureFlags ASK_FILES_ENABLED = false).
 *
 * THE PROMISES THIS PROVES
 *   1. /ask has no paperclip and no tray.
 *   2. A saved thread whose answer carries `read`, `truncated` and
 *      `codeWithheld` (one written while the flag was on) recalls as a plain
 *      answer: no "What I read" block, no cut-short line, no code line.
 *   3. A question goes down the ordinary text path: One Mind is asked and the
 *      file reader is never called.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { mountRouteChecked, primeWorld } from '@/__tests__/helpers/mountRoute';
import { ASK_FILES_ENABLED, PORTAL_MESSAGE_AI_ENABLED } from '@/constants/featureFlags';
import { ASK_HISTORY_KEY } from '@/utils/askHistory';
import * as oneMindAnswer from '@/utils/oneMind/answer';
import * as aiUsage from '@/utils/aiRateLimiter';
import * as askFilesModule from '@/utils/askFiles';

beforeEach(() => {
  jest.useRealTimers();
  Dimensions.set({ window: { width: 390, height: 844, scale: 3, fontScale: 1 }, screen: { width: 390, height: 844, scale: 3, fontScale: 1 } });
});
afterEach(() => {
  jest.restoreAllMocks();
});

async function pump(n = 8) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      try { jest.advanceTimersByTime(300); } catch { /* real timers */ }
      for (let k = 0; k < 20; k++) await Promise.resolve();
    });
  }
}

const FILE_THREAD = {
  id: 'saved-file-thread',
  ts: 1759500000000,
  turns: [
    { role: 'user', text: 'What does this photo show?', key: 'k1', files: [{ name: 'crack.jpg', kind: 'image' }] },
    {
      role: 'assistant', text: 'A crack at the corner of the footing.', key: 'k2',
      read: [{ name: 'crack.jpg', kind: 'image' }, { name: 'spec.pdf', kind: 'pdf', pages: 7 }],
      truncated: true, codeWithheld: true,
    },
  ],
};

describe('Ask MAGE with ASK_FILES_ENABLED false (the real flag)', () => {
  it('both flags are false in the source', () => {
    expect(ASK_FILES_ENABLED).toBe(false);
    expect(PORTAL_MESSAGE_AI_ENABLED).toBe(false);
  });

  it('/ask has no paperclip and no tray; a saved file thread recalls with no "What I read"; a question takes the text path', async () => {
    await primeWorld('populated');
    await AsyncStorage.setItem(ASK_HISTORY_KEY, JSON.stringify([FILE_THREAD]));
    const tree = await mountRouteChecked('/ask');
    expect(tree.getPathname()).toBe('/ask');
    await pump(2);

    // 1. Nothing of the feature is drawn.
    expect(screen.getByTestId('ask-input')).toBeTruthy();
    expect(screen.getByTestId('ask-mic')).toBeTruthy();
    expect(screen.queryByTestId('ask-attach')).toBeNull();
    expect(screen.queryByTestId('ask-tray')).toBeNull();
    expect(screen.queryByTestId('ask-attach-menu')).toBeNull();
    expect(screen.getByTestId('ask-input').props.placeholder).toBe('Ask a question or say what to do');
    expect('maxLength' in screen.getByTestId('ask-input').props).toBe(false);

    // 2. The saved thread, recalled.
    fireEvent.press(screen.getByTestId('ask-recent'));
    await pump(2);
    expect(screen.getByText('A crack at the corner of the footing.')).toBeTruthy();
    expect(screen.queryByTestId('ask-what-i-read')).toBeNull();
    expect(screen.queryByText('What I read')).toBeNull();
    expect(screen.queryByText(/as far as MAGE got/)).toBeNull();
    expect(screen.queryByText(/building-code text/)).toBeNull();

    // 3. A question is a text question.
    const askOneMind = jest.spyOn(oneMindAnswer, 'askOneMind')
      .mockResolvedValue({ answer: 'All three jobs are on budget.', citations: [], scope: { kind: 'business' }, usedAI: false } as never);
    jest.spyOn(aiUsage, 'checkAILimit').mockResolvedValue({ allowed: true } as never);
    const askFiles = jest.spyOn(askFilesModule, 'askFiles');
    fireEvent.changeText(screen.getByTestId('ask-input'), 'how are my jobs doing');
    await pump(2);
    fireEvent.press(screen.getByTestId('ask-send'));
    await pump(6);
    expect(askOneMind).toHaveBeenCalledTimes(1);
    expect(askFiles).not.toHaveBeenCalled();
    expect(screen.getByText('All three jobs are on budget.')).toBeTruthy();
    // The recalled file turns are not handed to the text model.
    const prior = askOneMind.mock.calls[0][1] as { role: string; text: string }[];
    expect(prior).toEqual([]);
  });
});
