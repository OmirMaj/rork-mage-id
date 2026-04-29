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

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform,
} from 'react-native';
import { Mic, MicOff, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import VoiceCaptureModal from './VoiceCaptureModal';

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
}

export default function VoiceRecorder({
  onTranscriptReady, isLoading, isLocked, onLockedPress,
  title, contextLine, suggestions,
}: VoiceRecorderProps) {
  const [modalOpen, setModalOpen] = useState(false);

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
      <View style={styles.container}>
        <View style={[styles.micBtn, styles.micBtnDisabled]}>
          <MicOff size={20} color={Colors.textMuted} />
        </View>
        <Text style={styles.webLabel}>Voice input not available on web</Text>
      </View>
    );
  }

  if (isLocked) {
    return (
      <TouchableOpacity style={styles.container} onPress={onLockedPress} activeOpacity={0.7}>
        <View style={[styles.micBtn, styles.micBtnLocked]}>
          <Lock size={18} color={Colors.textMuted} />
        </View>
        <Text style={styles.lockedLabel}>Pro feature — tap to upgrade</Text>
      </TouchableOpacity>
    );
  }

  return (
    <>
      <TouchableOpacity
        style={styles.container}
        onPress={handlePress}
        activeOpacity={0.7}
        testID="voice-record-btn"
      >
        <View style={styles.micBtn}>
          <Mic size={20} color={Colors.primary} />
        </View>
        <Text style={styles.label}>
          {isLoading ? 'Processing…' : 'Tap to dictate'}
        </Text>
      </TouchableOpacity>
      <VoiceCaptureModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        onTranscriptReady={onTranscriptReady}
        title={title}
        contextLine={contextLine}
        suggestions={suggestions}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 12,
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnDisabled: {
    backgroundColor: Colors.fillTertiary,
  },
  micBtnLocked: {
    backgroundColor: Colors.fillTertiary,
  },
  label: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  webLabel: {
    fontSize: 13,
    color: Colors.textMuted,
  },
  lockedLabel: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
});
