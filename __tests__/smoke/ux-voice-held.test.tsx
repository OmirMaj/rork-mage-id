/**
 * UX wave, held voice items (A6): the app-wide sync pill says when voice notes
 * recorded with no signal are still on this phone, and its sheet lists each
 * one with its project, when it was recorded and where it stands.
 *
 * The pill is mounted alone with a mocked queue (the real queue is AsyncStorage
 * + expo-file-system; utils/audioTranscribeQueue's own rules are run for real
 * by scripts/validate-voice-offline.ts, and the filing by validate-ux-lane-a).
 * No golden here: the assertions are the words and the separation of waiting
 * from failed, which is the rule this file protects.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { AudioTranscribeTask } from '@/utils/audioTranscribeCore';

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
const mockProcess = jest.fn(async () => ({ transcribed: 0, gaveUp: 0, remaining: 0, foreign: 0 }));
jest.mock('@/utils/audioTranscribeQueue', () => ({
  getAudioTranscribeQueue: async () => mockQueue,
  onAudioQueueChange: () => () => {},
  processAudioTranscribeQueue: () => mockProcess(),
}));

jest.mock('@/utils/offlineQueue', () => ({
  ...jest.requireActual('@/utils/offlineQueue'),
  currentSessionUserId: async () => 'u1',
}));

const mockRequestFiling = jest.fn();
jest.mock('@/utils/voiceNoteFiling', () => ({
  ...jest.requireActual('@/utils/voiceNoteFiling'),
  requestVoiceNoteFiling: () => mockRequestFiling(),
}));

jest.mock('@/contexts/ProjectContext', () => ({
  ...jest.requireActual('@/contexts/ProjectContext'),
  useCoreData: () => ({
    projects: [
      { id: 'henderson', name: 'Henderson kitchen', status: 'in_progress', updatedAt: '2026-09-01T00:00:00Z' },
      { id: 'shut', name: 'Shut job', status: 'closed', updatedAt: '2026-09-01T00:00:00Z' },
    ],
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const OfflineSyncPill = require('@/components/OfflineSyncPill').default as typeof import('@/components/OfflineSyncPill').default;

const task = (o: Partial<AudioTranscribeTask> & { id: string }): AudioTranscribeTask => ({
  userId: 'u1', fileRef: 'a.wav', staged: true, uploadName: 'recording.wav', contentType: 'audio/wav',
  contextKey: 'voice-note:henderson', contextLabel: 'Voice dictation — Henderson kitchen', durationMs: 42_000,
  queuedAt: Date.now() - 60_000, retryCount: 0, status: 'pending', ...o,
});

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('UX A6 — voice notes waiting on the sync pill', () => {
  beforeEach(() => { mockQueue = []; mockProcess.mockClear(); mockRequestFiling.mockClear(); });

  it('shows nothing when no voice note is waiting', async () => {
    render(<OfflineSyncPill variant="full" floating />);
    await settle();
    expect(screen.queryByTestId('offline-sync-voice-waiting')).toBeNull();
    expect(screen.queryByTestId('offline-sync-voice-failed')).toBeNull();
  });

  it('one clip queued offline reads "1 voice note waiting"', async () => {
    mockQueue = [task({ id: 'a' })];
    render(<OfflineSyncPill variant="full" floating />);
    await settle();
    expect(screen.getByText('1 voice note waiting')).toBeTruthy();
    expect(screen.getByTestId('offline-sync-voice-waiting').props.accessibilityLabel).toBe('1 voice note waiting');
    expect(screen.queryByTestId('offline-sync-voice-failed')).toBeNull();
  });

  it('waiting and failed are two lines, never summed, and another user\'s clips are not counted', async () => {
    mockQueue = [
      task({ id: 'a' }),
      task({ id: 'b', status: 'ready', transcript: 'poured the slab', fileRef: '' }),
      task({ id: 'c', retryCount: 2 }),
      task({ id: 'x', userId: 'someone-else' }),
    ];
    render(<OfflineSyncPill variant="full" floating />);
    await settle();
    expect(screen.getByText('2 voice notes waiting')).toBeTruthy();
    expect(screen.getByText("1 voice note couldn't be transcribed")).toBeTruthy();
  });

  it('Home\'s header pill (not floating) does not repeat the voice lines', async () => {
    mockQueue = [task({ id: 'a' })];
    render(<OfflineSyncPill variant="compact" />);
    await settle();
    expect(screen.queryByText('1 voice note waiting')).toBeNull();
  });

  it('a tap opens the sheet: each clip, its project, its state; the queue runs and filing is asked for', async () => {
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
    expect(screen.getByTestId('voice-backlog-sheet')).toBeTruthy();
    expect(mockProcess).toHaveBeenCalled();
    expect(mockRequestFiling).toHaveBeenCalled();
    expect(screen.getAllByText('Henderson kitchen').length).toBe(2);
    expect(screen.getByText('Waiting for signal. It will be transcribed when you have a connection.')).toBeTruthy();
    expect(screen.getByText("Couldn't be transcribed yet. MAGE will try again, or tap Retry.")).toBeTruthy();
    expect(screen.getByTestId('voice-backlog-retry-bad')).toBeTruthy();
    expect(screen.getByText('Its project is closed, so it was not added to a report.')).toBeTruthy();
    expect(screen.getByText('Its project is no longer on this phone, so it was not added to a report.')).toBeTruthy();
    // Nothing on the sheet discards a recording.
    expect(screen.queryByText(/Discard/)).toBeNull();
  });
});
