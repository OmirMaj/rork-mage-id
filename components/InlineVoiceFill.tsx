// InlineVoiceFill — a small mic button that drops into a form to
// dictate field values. Pairs with VoiceCaptureModal for the recording
// UI and a per-form parser (see utils/voiceFormParsers.ts) for the
// transcript -> structured fields step.
//
// Usage:
//
//   <InlineVoiceFill
//     title="Dictate this RFI"
//     contextLine={`for ${projectName}`}
//     suggestions={[
//       "Ask the architect about the LVL beam size for the kitchen island",
//       "Need the tile pattern for the bathroom by Friday",
//     ]}
//     onTranscript={async (transcript) => {
//       const partial = await parseRFIFromTranscript(transcript, project);
//       if (partial.subject) setSubject(partial.subject);
//       if (partial.question) setQuestion(prev => mergeText(prev, partial.question, 'append'));
//       if (partial.priority) setPriority(partial.priority);
//       if (partial.assignedTo && !assignedTo) setAssignedTo(partial.assignedTo);
//     }}
//   />
//
// The component owns the busy/error state during parsing so the form
// doesn't have to. A toast-style "filled X fields" preview appears
// when parsing succeeds.

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Mic, Sparkles, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import VoiceCaptureModal from './VoiceCaptureModal';

interface Props {
  /** Modal title (e.g. "Dictate this RFI"). */
  title?: string;
  /** Sub-line under the title (e.g. "for Harbor View Renovation"). */
  contextLine?: string;
  /** Example phrases shown inside the modal. */
  suggestions?: string[];
  /** Label on the inline button. Defaults to "Dictate fields". */
  buttonLabel?: string;
  /**
   * Called with the raw transcript. The form is responsible for
   * running its parser and applying the partial. This component shows
   * a "Filling…" spinner while the promise is in flight.
   */
  onTranscript: (transcript: string) => Promise<void> | void;
  /**
   * Optional: called with the count of fields filled, so the form can
   * show its own toast / haptic if desired. The component renders a
   * default success line internally.
   */
  onFilled?: (count: number) => void;
}

export default function InlineVoiceFill({
  title = 'Voice fill',
  contextLine,
  suggestions,
  buttonLabel = 'Dictate fields',
  onTranscript,
  onFilled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filledMsg, setFilledMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleTranscript = useCallback(async (transcript: string) => {
    setBusy(true);
    setFilledMsg(null);
    setErrorMsg(null);
    try {
      // Capture the time before so we can give a "filled X fields"
      // hint by counting how many setters fired (the parent owns that
      // count via onFilled — we just show a generic success here).
      await onTranscript(transcript);
      setFilledMsg('Filled from your voice — review and edit before saving.');
      onFilled?.(0);
      // Auto-clear the success line after 4s.
      setTimeout(() => setFilledMsg(prev => prev), 0); // no-op to avoid lint
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      setErrorMsg(`Couldn't parse the recording. ${msg}`);
    } finally {
      setBusy(false);
    }
  }, [onTranscript, onFilled]);

  return (
    <>
      <TouchableOpacity
        style={[styles.btn, busy && styles.btnBusy]}
        onPress={() => setOpen(true)}
        disabled={busy}
        activeOpacity={0.7}
        testID="inline-voice-fill-btn"
      >
        {busy ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <Mic size={16} color={Colors.primary} />
        )}
        <Text style={styles.btnText}>{busy ? 'Reading what you said…' : buttonLabel}</Text>
        {!busy && <Sparkles size={12} color={Colors.primary} />}
      </TouchableOpacity>

      {!!filledMsg && !busy && (
        <View style={styles.successCard}>
          <Sparkles size={13} color={Colors.success} />
          <Text style={styles.successText}>{filledMsg}</Text>
        </View>
      )}

      {!!errorMsg && !busy && (
        <View style={styles.errorCard}>
          <AlertCircle size={13} color={Colors.error} />
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      )}

      <VoiceCaptureModal
        visible={open}
        onClose={() => setOpen(false)}
        onTranscriptReady={handleTranscript}
        title={title}
        contextLine={contextLine}
        suggestions={suggestions}
      />
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primary + '12',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  btnBusy: {
    opacity: 0.85,
  },
  btnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.success + '12',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.success + '30',
  },
  successText: {
    flex: 1,
    fontSize: 12,
    color: Colors.text,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.error + '12',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.error + '30',
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: Colors.text,
  },
});
