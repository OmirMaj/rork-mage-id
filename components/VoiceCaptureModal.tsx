// VoiceCaptureModal — full-screen modal for voice dictation.
//
// Replaces the inline VoiceRecorder button with a sheet that:
//   1. Shows project-specific example phrases (homeowner doesn't have to
//      guess what the system can parse).
//   2. Has a single, OBVIOUS record button — big circle, clear states
//      (idle / recording-pulsing / transcribing-spinner).
//   3. Surfaces every failure mode visibly inside the modal — no silent
//      catch blocks, no Alert() pop-ups stacked on top of the sheet.
//   4. Resets cleanly on dismiss so the next open always starts fresh
//      (the inline button's state machine could get wedged between
//      taps; a modal that unmounts every time can't).

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, Modal,
  Animated, ActivityIndicator, Platform, ScrollView,
} from 'react-native';
import { Mic, X, Square, Lightbulb, AlertCircle } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import * as Haptics from 'expo-haptics';

type Step = 'idle' | 'recording' | 'transcribing' | 'error';

interface Props {
  visible: boolean;
  onClose: () => void;
  onTranscriptReady: (transcript: string) => void;
  /** Title at top of sheet, e.g. "Voice dictation". */
  title?: string;
  /** Optional context line, e.g. "for Harbor View Renovation — Daily Report". */
  contextLine?: string;
  /** Bulleted example phrases the user can read aloud. */
  suggestions?: string[];
}

export default function VoiceCaptureModal({
  visible, onClose, onTranscriptReady,
  title = 'Voice dictation',
  contextLine,
  suggestions = [],
}: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const recordingRef = useRef<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  // Fully reset when the modal opens — a previous session could have
  // left state hanging if dismissal happened mid-recording.
  useEffect(() => {
    if (visible) {
      setStep('idle');
      setErrorMsg(null);
      recordingRef.current = null;
      setRotatingIdx(0);
    } else {
      // Modal closing — make sure we don't leave a recording armed.
      void cleanupRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Rotate the highlighted suggestion every 3.5s while idle, so the user
  // sees varied prompts without having to read the whole list. Stops
  // once they start recording — that's a cue to focus.
  const [rotatingIdx, setRotatingIdx] = useState(0);
  useEffect(() => {
    if (!visible || step !== 'idle' || !suggestions || suggestions.length <= 1) return;
    const t = setInterval(() => {
      setRotatingIdx(i => (i + 1) % suggestions.length);
    }, 3500);
    return () => clearInterval(t);
  }, [visible, step, suggestions]);

  const startPulse = useCallback(() => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  const cleanupRecording = useCallback(async () => {
    stopPulse();
    if (recordingRef.current) {
      try {
        await recordingRef.current.stopAndUnloadAsync();
      } catch {/* ignore — we're tearing down */}
      recordingRef.current = null;
    }
    if (Platform.OS !== 'web') {
      try {
        const { Audio } = require('expo-av');
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      } catch {/* ignore */}
    }
  }, [stopPulse]);

  const startRecording = useCallback(async () => {
    setErrorMsg(null);
    if (Platform.OS === 'web') {
      setErrorMsg('Voice dictation is not available on web. Use the iOS or Android app.');
      setStep('error');
      return;
    }
    try {
      const { Audio } = require('expo-av');
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setErrorMsg('Microphone permission denied. Open Settings → MAGE ID → Microphone to enable it.');
        setStep('error');
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const recording = new Audio.Recording();
      // IMPORTANT: the Rork toolkit STT endpoint at
      // https://toolkit.rork.com/stt/transcribe/ silently returns
      // {"text":"","language":""} for M4A/AAC uploads (verified — it
      // doesn't error, it just emits no transcript). It transcribes WAV
      // perfectly. So we record as 16-kHz mono LPCM and send a real
      // .wav. 16kHz/16-bit mono is the standard speech bandwidth — half
      // the file size of 44.1kHz stereo, identical accuracy for STT.
      await recording.prepareToRecordAsync({
        isMeteringEnabled: true,
        ios: {
          extension: '.wav',
          // 'lpcm' matches IOSOutputFormat.LINEARPCM in expo-av v16.
          // Hard-coded as a string so we don't drift if the SDK enum
          // moves.
          outputFormat: 'lpcm',
          audioQuality: 96, // HIGH (0=MIN, 32=LOW, 64=MEDIUM, 96=HIGH, 127=MAX)
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000, // 16kHz × 16-bit × mono ≈ 256 kbps
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        // Android can't natively record raw WAV via MediaRecorder, so
        // we keep AAC/.m4a here. The toolkit STT may not transcribe it
        // until we add an Android-side WAV path or swap STT providers.
        // Documented as a known gap; iOS is the primary target.
        android: {
          extension: '.m4a',
          outputFormat: 2, // MPEG_4
          audioEncoder: 3, // AAC
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 64000,
        },
      });
      await recording.startAsync();
      recordingRef.current = recording;
      setStep('recording');
      startPulse();
      // Web-only Haptics is a no-op anyway, and we already returned above
      // for Platform.OS === 'web'. Calling unconditionally here.
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      setErrorMsg(`Couldn't start the microphone. ${msg}`);
      setStep('error');
    }
  }, [startPulse]);

  const stopAndTranscribe = useCallback(async () => {
    stopPulse();
    setStep('transcribing');
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const recording = recordingRef.current;
    recordingRef.current = null;
    if (!recording) {
      setErrorMsg('Recording was lost. Tap to start again.');
      setStep('error');
      return;
    }
    try {
      await recording.stopAndUnloadAsync();
      const { Audio } = require('expo-av');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      if (!uri) throw new Error('Recording produced no file.');

      const uriParts = uri.split('.');
      const fileType = (uriParts[uriParts.length - 1] || 'wav').toLowerCase();
      // Map our recorded extension to the mime type the Rork toolkit
      // STT endpoint expects. WAV is the format that actually transcribes
      // (M4A returns empty silently — confirmed by direct testing). Keep
      // .m4a/.caf in the lookup as a fallback so we're not stuck if the
      // recording format changes.
      const mimeMap: Record<string, string> = {
        wav: 'audio/wav',
        m4a: 'audio/m4a',
        caf: 'audio/x-caf',
        aac: 'audio/aac',
        mp3: 'audio/mpeg',
        webm: 'audio/webm',
      };
      const mime = mimeMap[fileType] || `audio/${fileType}`;
      const formData = new FormData();
      formData.append('audio', { uri, name: `recording.${fileType}`, type: mime } as any);

      const resp = await fetch('https://toolkit.rork.com/stt/transcribe/', {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`Transcription server returned ${resp.status}. ${text.slice(0, 120)}`);
      }
      const data = await resp.json();
      const transcript: string = (data?.text || '').trim();
      if (!transcript) {
        setErrorMsg("Didn't catch any speech. Try again — speak a bit louder or closer to the mic.");
        setStep('error');
        return;
      }
      // Success — hand off + dismiss.
      onTranscriptReady(transcript);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      setErrorMsg(`Couldn't transcribe the recording. ${msg}`);
      setStep('error');
    }
  }, [stopPulse, onTranscriptReady, onClose]);

  const handleMainPress = useCallback(() => {
    if (step === 'idle' || step === 'error') void startRecording();
    else if (step === 'recording') void stopAndTranscribe();
    // 'transcribing' — button disabled, ignore
  }, [step, startRecording, stopAndTranscribe]);

  const isIdle = step === 'idle' || step === 'error';
  const isRecording = step === 'recording';
  const isTranscribing = step === 'transcribing';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {!!contextLine && <Text style={styles.contextLine}>{contextLine}</Text>}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <X size={22} color={Colors.text} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Suggestions — highlighted one rotates every 3.5s while idle.
              Showing a single rotating line keeps the modal visually
              calm (lots of suggestions = wall of italics) but still
              cycles examples for the GC to read aloud. */}
          {suggestions.length > 0 && (
            <View style={styles.suggestionsCard}>
              <View style={styles.suggestionsHeaderRow}>
                <Lightbulb size={16} color={Colors.primary} />
                <Text style={styles.suggestionsHeader}>Try saying</Text>
              </View>
              <Text style={styles.suggestionItemHero}>
                “{suggestions[rotatingIdx % suggestions.length]}”
              </Text>
              {suggestions.length > 1 && (
                <View style={styles.suggestionDots}>
                  {suggestions.map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.suggestionDot,
                        i === rotatingIdx % suggestions.length && styles.suggestionDotActive,
                      ]}
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Recorder */}
          <View style={styles.recorderArea}>
            <Pressable
              onPress={handleMainPress}
              disabled={isTranscribing}
              style={({ pressed }) => [
                styles.bigBtnWrap,
                pressed && !isTranscribing && { opacity: 0.85 },
              ]}
            >
              <Animated.View
                style={[
                  styles.bigBtn,
                  isRecording && styles.bigBtnRecording,
                  isTranscribing && styles.bigBtnProcessing,
                  isRecording && { transform: [{ scale: pulseAnim }] },
                ]}
              >
                {isTranscribing ? (
                  <ActivityIndicator color="#fff" size="large" />
                ) : isRecording ? (
                  <Square size={36} color="#fff" fill="#fff" />
                ) : (
                  <Mic size={40} color="#fff" />
                )}
              </Animated.View>
            </Pressable>

            <Text style={styles.bigBtnLabel}>
              {isTranscribing
                ? 'Transcribing your audio…'
                : isRecording
                  ? 'Recording — tap to finish'
                  : isIdle && step === 'error'
                    ? 'Tap to try again'
                    : 'Tap to start recording'}
            </Text>

            {!!errorMsg && (
              <View style={styles.errorCard}>
                <AlertCircle size={16} color={Colors.error} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.cardBorder,
  },
  title: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  contextLine: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  body: {
    padding: 20,
    gap: 24,
  },
  suggestionsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 8,
  },
  suggestionsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  suggestionsHeader: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  suggestionItem: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  suggestionItemHero: {
    fontSize: 16,
    color: Colors.text,
    lineHeight: 22,
    fontStyle: 'italic',
    fontWeight: '500' as const,
    minHeight: 44, // reserve space so swap doesn't jump layout
  },
  suggestionDots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  suggestionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.primary + '30',
  },
  suggestionDotActive: {
    backgroundColor: Colors.primary,
    width: 16,
  },
  recorderArea: {
    alignItems: 'center',
    paddingTop: 12,
    gap: 16,
  },
  bigBtnWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  bigBtnRecording: {
    backgroundColor: Colors.error,
    shadowColor: Colors.error,
  },
  bigBtnProcessing: {
    backgroundColor: Colors.textMuted,
    shadowOpacity: 0,
  },
  bigBtnLabel: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    textAlign: 'center',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: Colors.error + '15',
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: Colors.error + '40',
    width: '100%',
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
});
