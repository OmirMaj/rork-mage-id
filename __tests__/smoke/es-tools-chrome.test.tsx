/**
 * Wave-next W2, lane ESTOOLS — the shared field pieces in English and in the
 * pseudo-locale.
 *
 * ENGLISH GOLDEN: recorded FIRST, on the chrome files before they were moved
 * onto t()/tn() (and on DailyLogCard after its copy fix, before its
 * migration). The golden is the list of strings a person can read or hear
 * (Text content, accessibility labels / hints, placeholders), not the element
 * tree — so it proves the English is byte-identical, which is the promise of
 * the i18n layer (docs/I18N.md §3.4).
 *
 * PSEUDO-LOCALE: with the display language set to 'xx' every string these
 * surfaces own must come back bracketed (i18n/pseudo.ts); a plain-ASCII string
 * left on screen was never extracted.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { AudioTranscribeTask } from '@/utils/audioTranscribeCore';
import { pinDateOnly } from '@/__tests__/helpers/testClock';

jest.mock('@/contexts/ThemeContext', () => {
  const actual = jest.requireActual('@/contexts/ThemeContext');
  const palette = jest.requireActual('@/constants/colors');
  const colors = { ...palette.Theme.light, ...palette.deriveAccentPalette(palette.getCustomPrimary(), 'light') };
  const value = { colors, resolved: 'light', pref: 'light', setPref: () => {} };
  return { ...actual, useTheme: () => value };
});

jest.mock('@/hooks/useSyncStatus', () => ({
  useSyncStatus: () => ({
    tone: 'clear', pending: 0, failed: 0, depths: { writes: 0, photos: 0, dictations: 0 },
    visible: false, badge: '', title: '', detail: '', unsaved: [],
    retryUnsaved: async () => 'failed', discardUnsaved: async () => {}, acknowledgeFailures: async () => {}, refresh: async () => {},
  }),
}));

let mockQueue: AudioTranscribeTask[] = [];
jest.mock('@/utils/audioTranscribeQueue', () => ({
  getAudioTranscribeQueue: async () => mockQueue,
  onAudioQueueChange: () => () => {},
  processAudioTranscribeQueue: async () => ({ transcribed: 0, gaveUp: 0, remaining: 0, foreign: 0 }),
}));

jest.mock('@/utils/offlineQueue', () => ({
  ...jest.requireActual('@/utils/offlineQueue'),
  currentSessionUserId: async () => 'u1',
}));

jest.mock('@/utils/voiceNoteFiling', () => ({
  ...jest.requireActual('@/utils/voiceNoteFiling'),
  requestVoiceNoteFiling: () => {},
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

const TODAY = '2026-09-28';
// The fixtures are dated TODAY; pin the clock to it so "Recorded 9:14 AM" does not
// become "Recorded Sep 28 9:14 AM" on any other day. Only Date is faked (3 pm local).
pinDateOnly(TODAY);
const completion = (o: Record<string, unknown>) => ({
  windowStart: '2026-08-30', today: TODAY, hasRecord: true, expectedDays: 21, closedExpectedDays: 20,
  filedDays: 17, emptyDayFilings: 0, missedDays: 3, missedDates: ['2026-09-24', '2026-09-17', '2026-09-10'],
  currentStreak: 2, longestStreak: 9, todayExpected: true, todayFiled: true, ...o,
});
let mockRows: unknown[] = [];
jest.mock('@/utils/portfolio/attentionRows', () => ({
  ...jest.requireActual('@/utils/portfolio/attentionRows'),
  buildDailyLogGaps: () => mockRows,
}));

jest.mock('@/contexts/ProjectContext', () => ({
  ...jest.requireActual('@/contexts/ProjectContext'),
  useProjects: () => ({ projects: [], dailyReports: [] }),
  useCoreData: () => ({
    projects: [
      { id: 'henderson', name: 'Henderson kitchen', status: 'in_progress', updatedAt: '2026-09-01T00:00:00Z' },
      { id: 'shut', name: 'Shut job', status: 'closed', updatedAt: '2026-09-01T00:00:00Z' },
    ],
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OfflineSyncPill = require('@/components/OfflineSyncPill').default as typeof import('@/components/OfflineSyncPill').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const DailyLogCard = require('@/components/home/DailyLogCard').default as typeof import('@/components/home/DailyLogCard').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const VoiceCaptureModal = require('@/components/VoiceCaptureModal').default as typeof import('@/components/VoiceCaptureModal').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const i18nCore = require('@/i18n/core') as typeof import('@/i18n/core');

const task = (o: Partial<AudioTranscribeTask> & { id: string }): AudioTranscribeTask => ({
  userId: 'u1', fileRef: 'a.wav', staged: true, uploadName: 'recording.wav', contentType: 'audio/wav',
  contextKey: 'voice-note:henderson', contextLabel: 'Voice dictation — Henderson kitchen', durationMs: 42_000,
  queuedAt: new Date('2026-09-28T09:15:00').getTime(), retryCount: 0, status: 'pending', ...o,
});

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/** A rendered host / composite node, as the test renderer exposes it. */
interface ReactTestInstance { type: unknown; props: Record<string, unknown>; children: (ReactTestInstance | string)[] }

/** Every string a person reads or hears, in tree order. */
function readable(root: ReactTestInstance): string[] {
  const out: string[] = [];
  const flat = (n: unknown): string => {
    if (n == null || typeof n === 'boolean') return '';
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(flat).join('');
    const inst = n as ReactTestInstance;
    return (inst.children ?? []).map(flat).join('');
  };
  const walk = (n: ReactTestInstance) => {
    const p = n.props as Record<string, unknown>;
    if (typeof n.type === 'string') {
      for (const k of ['accessibilityLabel', 'accessibilityHint', 'placeholder']) {
        if (typeof p[k] === 'string' && p[k]) out.push(`${k}: ${p[k] as string}`);
      }
      if (n.type === 'Text') {
        const s = flat(n);
        if (s) out.push(s);
        return;
      }
    }
    for (const c of n.children) if (typeof c !== 'string') walk(c);
  };
  walk(root);
  return out;
}

const SCENES: [string, () => Promise<void>][] = [
  ['daily report card — owes today, a gap, a voice note, overflow', async () => {
    mockRows = [
      { projectId: 'p1', projectName: 'Henderson kitchen', c: completion({ todayFiled: false }) },
      { projectId: 'p2', projectName: 'Elm Street addition', c: completion({ missedDays: 1, missedDates: ['2026-09-24'], emptyDayFilings: 2 }) },
      { projectId: 'p3', projectName: 'Harbor view', c: completion({ missedDays: 4 }) },
      { projectId: 'p4', projectName: 'Fifth one', c: completion({ missedDays: 2 }) },
    ];
    render(<DailyLogCard />);
    await settle();
  }],
  ['daily report card — one project with gaps', async () => {
    mockRows = [{ projectId: 'p2', projectName: 'Elm Street addition', c: completion({ missedDays: 1, missedDates: ['2026-09-24'] }) }];
    render(<DailyLogCard />);
    await settle();
  }],
  ['sync pill — voice notes waiting and failed, sheet open', async () => {
    mockQueue = [
      task({ id: 'wait' }),
      task({ id: 'bad', retryCount: 1 }),
      task({ id: 'closed', status: 'ready', transcript: 'x', fileRef: '', contextKey: 'voice-note:shut' }),
      task({ id: 'gone', status: 'ready', transcript: 'y', fileRef: '', contextKey: 'voice-note:deleted' }),
    ];
    render(<OfflineSyncPill variant="full" floating />);
    await settle();
    fireEvent.press(screen.getByTestId('offline-sync-voice-waiting'));
    await settle();
  }],
  ['voice capture sheet — open, idle', async () => {
    render(
      <VoiceCaptureModal
        visible
        onClose={() => {}}
        onTranscriptReady={() => {}}
        title="Voice dictation"
        contextLine="for Henderson kitchen"
        suggestions={['Poured the east footing, six guys on site.']}
        topicChecklist={[{ label: 'Crew on site', hint: 'how many, which trades' }]}
      />,
    );
    await settle();
  }],
];

describe('ESTOOLS — English golden (strings a person reads or hears)', () => {
  beforeEach(() => { i18nCore.setLang('en'); mockQueue = []; mockRows = []; });
  it.each(SCENES)('%s', async (_name, scene) => {
    await scene();
    expect(readable(screen.UNSAFE_root as unknown as ReactTestInstance)).toMatchSnapshot();
  });
});

// Caller data and other modules' sentences these surfaces print verbatim:
// never theirs to translate (project names, the caller's own props, the
// filing rule's hold line and the shared voice-only row label).
const NOT_OURS = [
  /^(Henderson kitchen|Elm Street addition|Harbor view|Fifth one|Shut job)$/,
  /^Its project is (closed|no longer on this phone), so it was not added to a report\.$/,
  /^Voice note only · finish it$/,
  /^(Voice dictation|for Henderson kitchen|Crew on site|how many, which trades|1)$/,
  /^“Poured the east footing, six guys on site\.”$/,
];

describe('ESTOOLS — pseudo-locale: every string these surfaces own is bracketed', () => {
  beforeEach(() => { mockQueue = []; mockRows = []; });
  afterEach(() => { i18nCore.setLang('en'); });
  it.each(SCENES)('%s', async (_name, scene) => {
    i18nCore.setLang('xx');
    await scene();
    const plain = readable(screen.UNSAFE_root as unknown as ReactTestInstance)
      .map((x) => x.replace(/^(accessibilityLabel|accessibilityHint|placeholder): /, ''))
      .filter((x) => !(x.startsWith('[') && x.endsWith(']')))
      .filter((x) => !NOT_OURS.some((re) => re.test(x)));
    expect(plain).toEqual([]);
  });
});

