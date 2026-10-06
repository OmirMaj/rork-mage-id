// VoiceRecorder — thin entry button that opens the VoiceCaptureModal.
//
// Historically this was a single inline button that recorded in place.
// That had two problems:
//   1. State could get wedged between taps (recording started but the
//      button looked idle, or "Processing…" stuck on after a failed
//      transcription) — leaving the user with an unresponsive control.
//   2. No room to show what to actually say. Users opened the daily
//      report screen, tapped the mic, and stared at it not knowing
//      whether to speak in full sentences or keywords.
//
// The button now just opens VoiceCaptureModal, which handles the whole
// recording lifecycle in isolation, shows project-specific suggestions,
// and unmounts on close so the next session starts clean.

import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
} from 'react-native';
import { Mic, MicOff, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import VoiceCaptureModal from './VoiceCaptureModal';
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useT } from '@/contexts/LanguageContext';

interface VoiceRecorderProps {
  onTranscriptReady: (transcript: string) => void;
  /**
   * Visual loading state while the parent is doing something with the
   * transcript (e.g. parsing into structured DFR fields). Doesn't gate
   * the modal — the modal owns its own recording/transcribing state.
   */
  isLoading?: boolean;
  isLocked?: boolean;
  onLockedPress?: () => void;
  /** Title for the modal sheet. Defaults to "Voice dictation". */
  title?: string;
  /** Context line under the title, e.g. "for Harbor View Renovation — Daily Report". */
  contextLine?: string;
  /** Project-specific example phrases the user can read aloud. */
  suggestions?: string[];
  /**
   * Topic checklist — when provided, the modal renders a numbered list
   * of fields the user should cover during dictation. Pairs with the
   * voice parser so a single dictation can fill the whole form.
   */
  topicChecklist?: { label: string; hint?: string }[];
  /**
   * Optional (UX wave, lane A): the button's words when idle. Defaults to
   * "Tap to dictate", so every existing caller is unchanged.
   */
  label?: string;
  /**
   * Optional (UX wave, lane A): drop the button's own card (background,
   * border, radius, bottom margin) so it can sit as one choice inside a card
   * the caller draws — the daily report's "Fill it for me" door. Defaults to
   * false: every existing caller keeps its card.
   */
  bare?: boolean;
  /**
   * Optional (UX wave, A3): open the capture sheet as soon as this button
   * mounts, already recording once the sheet is up and the microphone is
   * allowed. Defaults to false: every existing caller is unchanged. A no-op on
   * the web (the mic there is disabled) and while locked.
   */
  autoStart?: boolean;
  /**
   * Optional (UX wave, A6): the offline queue key handed to the capture sheet,
   * so a recording parked with no signal knows where it belongs. Defaults to
   * the sheet's own title-based key.
   */
  queueKey?: string;
}

/** The capture sheet is a second modal; iOS refuses to present one while
 *  another is still animating in, so an auto-open waits for the first. */
const AUTO_OPEN_DELAY_MS = Platform.OS === 'ios' ? 450 : 0;

export default function VoiceRecorder({
  onTranscriptReady, isLoading, isLocked, onLockedPress,
  title, contextLine, suggestions, topicChecklist, label, bare = false,
  autoStart = false, queueKey,
}: VoiceRecorderProps) {
  const { t } = useT();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [modalOpen, setModalOpen] = useState(false);

  // autoStart is read on mount only: the caller disarms it once used, and a
  // later change must not pop the sheet open under the user's thumb.
  useEffect(() => {
    if (!autoStart || isLocked || Platform.OS === 'web') return;
    const t = setTimeout(() => setModalOpen(true), AUTO_OPEN_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePress = useCallback(() => {
    if (isLocked) {
      onLockedPress?.();
      return;
    }
    if (Platform.OS === 'web') return;
    setModalOpen(true);
  }, [isLocked, onLockedPress]);

  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, bare && styles.bare]}>
        <View style={[styles.micBtn, styles.micBtnDisabled]}>
          <MicOff size={20} color={themeColors.textMuted} strokeWidth={1.75} />
        </View>
        <Text style={styles.webLabel}>{t('field.chrome.voiceWebUnavailable', 'Voice Input Not Available on Web')}</Text>
      </View>
    );
  }

  if (isLocked) {
    return (
      <TouchableOpacity style={[styles.container, bare && styles.bare]} onPress={onLockedPress} activeOpacity={0.7}>
        <View style={[styles.micBtn, styles.micBtnLocked]}>
          <Lock size={18} color={themeColors.textMuted} strokeWidth={1.75} />
        </View>
        <Text style={styles.lockedLabel}>{t('field.chrome.voiceProLocked', 'Pro Feature. Tap to upgrade.')}</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={[styles.container, bare && styles.bare]}
        onPress={handlePress}
        activeOpacity={0.7}
        testID="voice-record-btn"
      >
        <View style={styles.micBtn}>
          <Mic size={20} color={themeColors.accent} strokeWidth={1.75} />
        </View>
        <Text style={styles.label}>
          {isLoading ? t('field.chrome.processing', 'Processing…') : (label ?? t('field.chrome.tapToDictate', 'Tap to Dictate'))}
        </Text>
      </TouchableOpacity>
      {/* Tutorial blocker sentinel: the capture sheet is an RN Modal that draws
          above the root tutorial layer, so while it is up the coach must hide
          instead of dimming behind it (validate-tutorial-defs pins this id). */}
      {modalOpen ? <TutorialTarget id="voice.modalUp" /> : null}
      <VoiceCaptureModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onTranscriptReady={onTranscriptReady}
        title={title}
        contextLine={contextLine}
        suggestions={suggestions}
        topicChecklist={topicChecklist}
        autoStart={autoStart}
        queueKey={queueKey}
      />
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: t.line,
    marginBottom: 12,
  },
  // `bare`: no card of its own (a choice inside the caller's card).
  bare: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    marginBottom: 0,
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.accent + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnDisabled: {
    backgroundColor: t.surfaceAlt,
  },
  micBtnLocked: {
    backgroundColor: t.surfaceAlt,
  },
  label: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '500' as const,
    color: t.text,
  },
  webLabel: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
  },
  lockedLabel: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    fontStyle: 'italic',
  },
});
