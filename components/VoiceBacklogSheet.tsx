// components/VoiceBacklogSheet.tsx — the voice notes still on this phone
// (UX wave, A6).
//
// A super dictates in a basement with no signal. The recording is kept by
// utils/audioTranscribeQueue and transcribed when signal returns, and the
// always-mounted mic (components/UniversalMicButton, filesParkedNotes) adds it
// to that project's daily report for the day it was spoken. Until then the
// sync pill says "1 voice note waiting", and this sheet — opened from the pill
// — lists each clip: which project, when it was recorded, and where it stands
// (waiting for signal / transcribed, being added / couldn't be transcribed,
// with Retry). A clip whose project is gone from this phone or closed stays
// listed with the reason; nothing here is ever dropped silently, and there is
// no discard (the queue's own give-up rules are unchanged).
//
// useVoiceBacklog is the pill's count: the caller's OWN clips only (the queue
// can briefly hold a previous tenant's recordings on a shared phone).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Modal, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useSheetFrame } from '@/components/ui/Sheet';
import { Button } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useCoreData } from '@/contexts/ProjectContext';
import { currentSessionUserId } from '@/utils/offlineQueue';
import {
  getAudioTranscribeQueue, onAudioQueueChange, processAudioTranscribeQueue,
} from '@/utils/audioTranscribeQueue';
import {
  formatClipLength, recordedAtMs, voiceBacklog,
  type AudioTranscribeTask, type VoiceBacklog,
} from '@/utils/audioTranscribeCore';
import {
  planVoiceNoteFilings, requestVoiceNoteFiling, voiceClipHoldLine, voiceNoteWhen,
  type VoiceClipRow,
} from '@/utils/voiceNoteFiling';
import { useT } from '@/contexts/LanguageContext';
import { t } from '@/i18n/core';
import { AI_CONSENT_OFF_MESSAGE, getAiConsentState, loadAiConsent, subscribeAiConsent } from '@/utils/aiConsent';

interface BacklogState {
  tasks: AudioTranscribeTask[];
  userId: string | null;
}

const EMPTY_STATE: BacklogState = { tasks: [], userId: null };

function sameTasks(a: readonly AudioTranscribeTask[], b: readonly AudioTranscribeTask[]): boolean {
  return a.length === b.length && a.every((t, i) =>
    t.id === b[i].id && t.status === b[i].status && t.retryCount === b[i].retryCount);
}

/**
 * The caller's own parked clips and their counts, kept current by the queue's
 * change feed and on every return to the foreground. Off on the web (the web
 * mic records nothing) and when `enabled` is false.
 */
export function useVoiceBacklog(enabled: boolean): BacklogState & { backlog: VoiceBacklog } {
  const [state, setState] = useState<BacklogState>(EMPTY_STATE);
  useEffect(() => {
    if (!enabled || Platform.OS === 'web') return;
    let alive = true;
    const read = async () => {
      try {
        const [userId, tasks] = await Promise.all([currentSessionUserId(), getAudioTranscribeQueue()]);
        if (!alive) return;
        const own = userId ? tasks.filter(t => t.userId === userId) : [];
        setState(prev => (prev.userId === userId && sameTasks(prev.tasks, own) ? prev : { tasks: own, userId }));
      } catch {/* the count is a convenience; the queue keeps the work */}
    };
    void read();
    const offQueue = onAudioQueueChange(() => { void read(); });
    const appState = AppState.addEventListener('change', (next) => { if (next === 'active') void read(); });
    return () => { alive = false; offQueue(); appState.remove(); };
  }, [enabled]);
  const backlog = useMemo(() => voiceBacklog(state.tasks, state.userId), [state]);
  return { ...state, backlog };
}

/** Where one clip stands, as a whole sentence (t from i18n/core: read at call time). */
function stateLine(row: VoiceClipRow, projectsLoaded: boolean, aiOff: boolean): string {
  // AI features turned off (utils/aiConsent): the queue keeps the clip on
  // purpose (audioTranscribeQueue), so say that — not "waiting for signal".
  if (aiOff && (row.state === 'waiting' || row.state === 'failed')) return AI_CONSENT_OFF_MESSAGE;
  if (row.state === 'waiting') return t('field.chrome.clipWaiting', 'Waiting for signal. It will be transcribed when you have a connection.');
  if (row.state === 'failed') return t('field.chrome.clipFailed', "Couldn't be transcribed yet. MAGE will try again, or tap Retry.");
  if (!row.projectId) {
    return row.task.contextLabel
      ? t('field.chrome.clipOpenForm', 'Transcribed. Open {form} to use it.', { form: row.task.contextLabel })
      : t('field.chrome.clipOpenRecordedForm', 'Transcribed. Open the form it was recorded on to use it.');
  }
  // voiceClipHoldLine is the filing rule's own sentence (utils/voiceNoteFiling): English until that module takes a language.
  if (row.hold) return voiceClipHoldLine(row.hold);
  return projectsLoaded ? t('field.chrome.clipAdding', 'Transcribed. Adding it to the daily report.') : t('field.chrome.clipTranscribed', 'Transcribed.');
}

interface Props {
  visible: boolean;
  onClose: () => void;
  tasks: readonly AudioTranscribeTask[];
  userId: string | null;
}

export default function VoiceBacklogSheet({ visible, onClose, tasks, userId }: Props) {
  const { t } = useT();
  const styles = useThemedStyles(makeStyles);
  const { projects } = useCoreData();
  const frame = useSheetFrame('form', { visible, animationType: 'slide' });
  const [busy, setBusy] = useState(false);

  // Run the queue, then ask the mic to file what came back. On open and on
  // Retry — the same pass OfflineSyncManager runs on a reconnect.
  const runNow = useCallback(async () => {
    setBusy(true);
    try {
      await processAudioTranscribeQueue();
    } finally {
      requestVoiceNoteFiling();
      setBusy(false);
    }
  }, []);
  useEffect(() => { if (visible) void runNow(); }, [visible, runNow]);

  const projectsLoaded = projects.length > 0;
  const [aiOff, setAiOff] = useState(() => getAiConsentState() === 'declined');
  useEffect(() => {
    void loadAiConsent().then((s) => setAiOff(s === 'declined')).catch(() => {});
    return subscribeAiConsent((s) => setAiOff(s === 'declined'));
  }, []);
  const rows = useMemo(
    () => planVoiceNoteFilings({ tasks, ownUserId: userId, projects, projectsLoaded }).rows,
    [tasks, userId, projects, projectsLoaded],
  );
  const now = Date.now();
  const nameOf = (row: VoiceClipRow): string => {
    if (!row.projectId) return row.task.contextLabel || t('field.chrome.dictation', 'Dictation');
    return projects.find(p => p.id === row.projectId)?.name ?? t('field.chrome.projectNotOnPhone', 'Project not on this phone');
  };

  return (
    <Modal visible={visible} transparent animationType={frame.animationType} onRequestClose={onClose}>
      <View style={[styles.backdrop, frame.overlay]}>
        <View style={[styles.sheet, frame.card]} testID="voice-backlog-sheet">
          <Text style={styles.title}>{t('field.chrome.voiceNotesTitle', 'Voice notes on this phone')}</Text>
          <Text style={styles.detail}>
            {t('field.chrome.voiceNotesWhy', "Recorded with no signal. Each one is added to its project's daily report for the day you recorded it, once it is transcribed.")}
          </Text>
          <ScrollView style={styles.rows}>
            {rows.length === 0 ? (
              <Text style={styles.detail}>{t('field.chrome.voiceNotesNone', 'Nothing is waiting. Every voice note is filed.')}</Text>
            ) : rows.map(row => (
              <View key={row.task.id} style={styles.row} testID={`voice-backlog-row-${row.task.id}`}>
                <Text style={styles.rowLabel} numberOfLines={1}>{nameOf(row)}</Text>
                <Text style={styles.rowMeta}>
                  {t('field.chrome.recordedWhen', 'Recorded {when} · {length}', { when: voiceNoteWhen(recordedAtMs(row.task), now), length: formatClipLength(row.task.durationMs) })}
                </Text>
                <Text style={[styles.rowState, (row.state === 'failed' || row.hold) ? styles.rowStateFailed : null]}>
                  {stateLine(row, projectsLoaded, aiOff)}
                </Text>
                {row.state === 'failed' ? (
                  <View style={styles.rowActions}>
                    <Button
                      label={busy ? t('field.chrome.trying', 'Trying…') : t('field.chrome.retry', 'Retry')}
                      variant="secondary"
                      loading={busy}
                      disabled={busy}
                      onPress={() => { void runNow(); }}
                      testID={`voice-backlog-retry-${row.task.id}`}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </ScrollView>
          <Button label={t('field.chrome.close', 'Close')} variant="ghost" onPress={onClose} fullWidth />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
  },
  sheet: {
    backgroundColor: t.bg,
    borderTopLeftRadius: Tokens.radius.panel, borderTopRightRadius: Tokens.radius.panel,
    padding: Tokens.spacing.md, paddingBottom: Tokens.spacing.xl,
    maxHeight: '80%', gap: Tokens.spacing.sm,
  },
  title: { ...Type.headline, color: t.text },
  detail: { ...Type.footnote, color: t.textSecondary },
  rows: { flexGrow: 0 },
  row: {
    paddingVertical: Tokens.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
    gap: Tokens.spacing.xxs,
  },
  rowLabel: { ...Type.subheadEmphasized, color: t.text },
  rowMeta: { ...Type.footnote, color: t.textMuted },
  rowState: { ...Type.footnote, color: t.textSecondary },
  rowStateFailed: { color: t.dangerLabel },
  rowActions: { flexDirection: 'row', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xxs },
});
