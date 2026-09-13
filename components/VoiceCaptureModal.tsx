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
//   5. KEEPS the recording when transcription fails. Until 2026-09-08 the
//      recorded file's URI was read inside the try block and dropped on the
//      floor, and the next tap started a brand-new recording — so a super
//      dictating ninety seconds of a daily report in a basement lost all of
//      it, and re-dictating failed identically because he was still in the
//      basement. A failure now hands the audio to utils/audioTranscribeQueue,
//      which stages it in documentDirectory and transcribes it when signal
//      returns; the transcript comes back to THIS surface the next time it
//      opens. The modal says "saved", never "transcribed", until it is.

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, Modal,
  Animated, ActivityIndicator, Platform, ScrollView,
} from 'react-native';
import { Mic, X, Square, AlertCircle, CloudOff, CheckCircle2 } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import * as Haptics from 'expo-haptics';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { transcribeAudio } from '@/utils/transcribeAudio';
import {
  getContextDictation,
  processAudioTranscribeQueue,
  queueAudioTranscription,
  takeTranscript,
  type ContextDictationState,
} from '@/utils/audioTranscribeQueue';
import {
  formatClipLength,
  pendingNoticeMessage,
  savedOfflineMessage,
  voiceContextKey,
  type AudioTranscribeTask,
} from '@/utils/audioTranscribeCore';

type Step = 'idle' | 'recording' | 'transcribing' | 'error' | 'saved';

// Map our recorded extension to the mime type the STT endpoint expects. WAV is
// the format that actually transcribes (M4A returns empty silently — confirmed
// by direct testing). Keep .m4a/.caf in the lookup as a fallback so we're not
// stuck if the recording format changes. Module scope because the salvage path
// in stopAndTranscribe's catch has to reach it too, and a recording rescued
// from an interrupted session still needs the right content type on the upload.
const MIME_BY_EXT: Record<string, string> = {
  wav: 'audio/wav',
  m4a: 'audio/m4a',
  caf: 'audio/x-caf',
  aac: 'audio/aac',
  mp3: 'audio/mpeg',
  webm: 'audio/webm',
};

function mimeForUri(uri: string): string {
  const parts = uri.split('?')[0].split('#')[0].split('.');
  const ext = (parts.length > 1 ? parts[parts.length - 1] : 'wav').toLowerCase();
  return MIME_BY_EXT[ext] || `audio/${ext}`;
}

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
  /**
   * Topic checklist — when provided, renders a "Cover all of these in
   * your dictation" checklist BELOW the suggestion. Designed for forms
   * with many fields (Daily Report, Project, etc.) so the user can see
   * exactly what topics to talk about and won't leave fields blank.
   * Each entry: { label, hint? } — hint is a short example/sub-text.
   */
  topicChecklist?: { label: string; hint?: string }[];
  /**
   * Which surface this dictation belongs to, so a recording saved offline
   * comes back to the form that asked for it rather than to whichever screen
   * happens to be open when signal returns. Defaults to the title + context
   * line, which is already unique per form per project — so every existing
   * caller gets the offline path without being changed.
   */
  queueKey?: string;
}

export default function VoiceCaptureModal({
  visible, onClose, onTranscriptReady,
  title = 'Voice dictation',
  contextLine,
  suggestions = [],
  topicChecklist,
  queueKey,
}: Props) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const recordingRef = useRef<any>(null);
  // When the tap that started the recording happened, so the modal can tell
  // the user how much dictation it is holding. expo-av's status object is gone
  // once the recording is unloaded, and "saved" with no length reads like a
  // guess.
  const startedAtRef = useRef<number>(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const contextKey = queueKey ?? voiceContextKey(title, contextLine);
  const contextLabel = contextLine ? `${title} — ${contextLine}` : title;
  const [pendingClips, setPendingClips] = useState<AudioTranscribeTask[]>([]);
  const [readyClip, setReadyClip] = useState<AudioTranscribeTask | null>(null);
  const [draining, setDraining] = useState(false);
  // The modal is kept mounted by its parent between opens, but the parent
  // screen can unmount while a drain is still in the air; nothing below may
  // setState after that.
  const aliveRef = useRef(true);
  useEffect(() => {
    // Raised on mount as well as lowered on unmount: React's dev-mode double
    // invoke runs the cleanup once before the real mount, and a ref that only
    // ever goes false would leave this instance permanently unable to show what
    // it is holding.
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const refreshQueued = useCallback(async (): Promise<ContextDictationState> => {
    const empty: ContextDictationState = { pending: [], ready: [] };
    try {
      const state = await getContextDictation(contextKey);
      if (!aliveRef.current) return state;
      setPendingClips(state.pending);
      setReadyClip(state.ready[0] ?? null);
      return state;
    } catch {
      // Reading the queue is a convenience on this screen — never let it
      // stop someone from recording.
      return empty;
    }
  }, [contextKey]);

  const transcribeNow = useCallback(async () => {
    if (aliveRef.current) setDraining(true);
    try {
      await processAudioTranscribeQueue();
    } catch {/* the queue keeps the work */}
    if (aliveRef.current) setDraining(false);
    await refreshQueued();
  }, [refreshQueued]);

  // Fully reset when the modal opens — a previous session could have
  // left state hanging if dismissal happened mid-recording.
  useEffect(() => {
    if (visible) {
      setStep('idle');
      setErrorMsg(null);
      setSavedMsg(null);
      recordingRef.current = null;
      setRotatingIdx(0);
      // Anything this surface dictated offline is shown the moment it opens,
      // and a drain is attempted for it: the user came back to the same form,
      // which is exactly when their words should be waiting.
      void (async () => {
        const state = await refreshQueued();
        if (state.pending.length > 0) await transcribeNow();
      })();
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
    // The previous take's "saved" card would otherwise sit under the pulsing
    // record button and read as if THIS recording were already safe.
    setSavedMsg(null);
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
      // IMPORTANT: the upstream STT provider (behind our transcribe-audio
      // proxy) silently returns {"text":"","language":""} for M4A/AAC
      // uploads (verified — it doesn't error, it just emits no transcript).
      // It transcribes WAV perfectly. So we record as 16-kHz mono LPCM and
      // send a real .wav. 16kHz/16-bit mono is the standard speech
      // bandwidth — half the file size of 44.1kHz stereo, identical
      // accuracy for STT.
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
      startedAtRef.current = Date.now();
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
    const durationMs = startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0;
    if (!recording) {
      setErrorMsg('Recording was lost. Tap to start again.');
      setStep('error');
      return;
    }
    // Held OUTSIDE the try, which is the whole fix: the URI used to be a local
    // inside it, so the throw that a no-signal jobsite guarantees took the only
    // reference to the recording with it.
    let recordedUri: string | null = null;
    let recordedMime = 'audio/wav';
    try {
      await recording.stopAndUnloadAsync();
      const { Audio } = require('expo-av');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      if (!uri) throw new Error('Recording produced no file.');
      recordedUri = uri;

      const uriParts = uri.split('.');
      const fileType = (uriParts[uriParts.length - 1] || 'wav').toLowerCase();
      const mime = mimeForUri(uri);
      recordedMime = mime;
      // Transcribe through the MAGE STT proxy (utils/transcribeAudio) rather
      // than posting to the third-party endpoint directly — that keeps the
      // vendor host out of the shipped bundle.
      const transcript = await transcribeAudio({ uri, name: `recording.${fileType}`, type: mime });
      if (!transcript) {
        // The server heard the upload and found no words. Queueing it would
        // just get the same empty answer on every retry, so this one really is
        // a re-record — unlike the failure below.
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
      // stopAndUnloadAsync and setAudioModeAsync run BEFORE the assignment
      // above, and both can throw — a phone call that interrupted the session
      // leaves expo-av already unloaded, and unloading twice throws. The file
      // is still on disk in that case, so ask the recorder for it one more time
      // rather than walking into the exact discard this whole change removes.
      if (!recordedUri) {
        try {
          const salvaged = recording.getURI?.();
          if (salvaged) {
            recordedUri = salvaged;
            recordedMime = mimeForUri(salvaged);
          }
        } catch {/* the recorder is gone too — nothing to keep */}
      }
      // The upload failed — which on a jobsite usually means there is no
      // signal, not that anything is wrong with the recording. Keep the audio
      // and transcribe it later rather than making the user say it all again
      // into the same dead bars.
      if (recordedUri) {
        const saved = await queueAudioTranscription({
          localUri: recordedUri,
          contentType: recordedMime,
          contextKey,
          contextLabel,
          durationMs,
        });
        if (saved.saved && saved.task) {
          setSavedMsg(savedOfflineMessage(saved.task));
          setErrorMsg(null);
          setStep('saved');
          void refreshQueued();
          return;
        }
        setErrorMsg(`Couldn't transcribe the recording, and this phone couldn't save it either. ${saved.reason ?? msg}`);
        setStep('error');
        return;
      }
      setErrorMsg(`Couldn't transcribe the recording. ${msg}`);
      setStep('error');
    }
  }, [stopPulse, onTranscriptReady, onClose, contextKey, contextLabel, refreshQueued]);

  // Hand a transcript that finished in the background to the form that asked
  // for it, and remove it from the queue in the same step so it can't be
  // pasted in twice.
  const applyReadyClip = useCallback(async () => {
    if (!readyClip) return;
    let text: string | null = null;
    try {
      text = await takeTranscript(readyClip.id);
    } catch {
      // Storage refused. The transcript is still in the queue, so the card
      // stays and the user can tap again — nothing is lost by doing nothing.
    }
    if (!text) { await refreshQueued(); return; }
    onTranscriptReady(text);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onClose();
  }, [readyClip, onTranscriptReady, onClose, refreshQueued]);

  const handleMainPress = useCallback(() => {
    // 'saved' behaves like idle on purpose: the dictation that just failed is
    // already on disk in the queue, so starting another recording no longer
    // destroys it. That was the old bug — this tap used to be the thing that
    // threw the ninety seconds away.
    if (step === 'idle' || step === 'error' || step === 'saved') void startRecording();
    else if (step === 'recording') void stopAndTranscribe();
    // 'transcribing' — button disabled, ignore
  }, [step, startRecording, stopAndTranscribe]);

  const isRecording = step === 'recording';
  const isTranscribing = step === 'transcribing';
  const isSaved = step === 'saved';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{title}</Text>
            {!!contextLine && <Text style={styles.contextLine}>{contextLine}</Text>}
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {/* Dictation this surface saved offline and has since transcribed.
              It leads the sheet because the user came back here to finish the
              form it belongs to. */}
          {!!readyClip && (
            <View style={styles.readyCard}>
              <CheckCircle2 size={18} color={themeColors.success} strokeWidth={1.75} />
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={styles.readyTitle}>
                  {formatClipLength(readyClip.durationMs)} you dictated offline is transcribed
                </Text>
                <Text style={styles.readyBody} numberOfLines={3}>“{readyClip.transcript}”</Text>
                <TouchableOpacity
                  onPress={() => { void applyReadyClip(); }}
                  style={styles.readyBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Use the dictation you saved offline"
                >
                  <Text style={styles.readyBtnText}>Use it</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Still waiting for signal. Says saved, never says transcribed —
              a super who reads "got it" and walks away has lost the report
              just as surely as before, only later. */}
          {pendingClips.length > 0 && (
            <View style={styles.pendingCard}>
              <CloudOff size={18} color={themeColors.textSecondary} strokeWidth={1.75} />
              <View style={{ flex: 1, gap: 8 }}>
                <Text style={styles.pendingText}>{pendingNoticeMessage(pendingClips.length)}</Text>
                <TouchableOpacity
                  onPress={() => { void transcribeNow(); }}
                  disabled={draining}
                  style={[styles.pendingBtn, draining && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Transcribe the dictation saved on this phone"
                >
                  <Text style={styles.pendingBtnText}>{draining ? 'Trying…' : 'Transcribe now'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Suggestions — highlighted one rotates every 3.5s while idle.
              Showing a single rotating line keeps the modal visually
              calm (lots of suggestions = wall of italics) but still
              cycles examples for the GC to read aloud. */}
          {suggestions.length > 0 && (
            <View style={styles.suggestionsCard}>
              <View style={styles.suggestionsHeaderRow}>
                <MageAIMark size={16} color={themeColors.accent} />
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

          {/* Topic checklist — visible only when caller passes one. Acts
              as a teleprompter so the GC covers every field in a single
              dictation pass. The AI parser maps the spoken content back
              to these fields automatically; this just makes sure nothing
              gets skipped. */}
          {topicChecklist && topicChecklist.length > 0 && (
            <View style={styles.checklistCard}>
              <Text style={styles.checklistHeader}>Cover all of these</Text>
              {topicChecklist.map((topic, i) => (
                <View key={i} style={styles.checklistRow}>
                  <View style={styles.checklistBullet}>
                    <Text style={styles.checklistBulletText}>{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checklistLabel}>{topic.label}</Text>
                    {topic.hint ? (
                      <Text style={styles.checklistHint}>{topic.hint}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
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
                  <Square size={36} color="#fff" fill="#fff" strokeWidth={1.75} />
                ) : (
                  <Mic size={40} color="#fff" strokeWidth={1.75} />
                )}
              </Animated.View>
            </Pressable>

            <Text style={styles.bigBtnLabel}>
              {isTranscribing
                ? 'Transcribing your audio…'
                : isRecording
                  ? 'Recording — tap to finish'
                  : isSaved
                    ? 'Saved — tap to record another'
                    : step === 'error'
                      ? 'Tap to try again'
                      : 'Tap to start recording'}
            </Text>

            {!!savedMsg && (
              <View style={styles.savedCard}>
                <CloudOff size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
                <Text style={styles.savedText}>{savedMsg}</Text>
              </View>
            )}

            {!!errorMsg && (
              <View style={styles.errorCard}>
                <AlertCircle size={16} color={themeColors.danger} strokeWidth={1.75} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
  },
  title: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  contextLine: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.surface,
  },
  body: {
    padding: 20,
    gap: 24,
  },
  suggestionsCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: t.line,
    gap: 8,
  },
  suggestionsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  suggestionsHeader: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.accent,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  suggestionItem: {
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  suggestionItemHero: {
    fontSize: Type.callout.fontSize,
    color: t.text,
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
    backgroundColor: t.accent + '30',
  },
  suggestionDotActive: {
    backgroundColor: t.accent,
    width: 16,
  },
  checklistCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: t.line,
    marginTop: 10,
    gap: 10,
  },
  checklistHeader: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '800' as const,
    color: t.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  checklistBullet: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistBulletText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    color: t.accent,
  },
  checklistLabel: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  checklistHint: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    marginTop: 2,
    lineHeight: 16,
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
    backgroundColor: t.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: t.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  bigBtnRecording: {
    backgroundColor: t.danger,
    shadowColor: t.danger,
  },
  bigBtnProcessing: {
    backgroundColor: t.textMuted,
    shadowOpacity: 0,
  },
  bigBtnLabel: {
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: t.text,
    textAlign: 'center',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: t.danger + '15',
    borderRadius: Tokens.radius.card,
    padding: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: t.danger + '40',
    width: '100%',
  },
  errorText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: t.text,
    lineHeight: 18,
  },
  // The offline cards below stay on soft tints with ink-coloured labels: a
  // signal fill used as a background is the anti-slop rule this repo already
  // enforces elsewhere, and these two cards carry real sentences, not badges.
  readyCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: t.successSoft,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.success + '40',
    padding: 14,
  },
  readyTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  readyBody: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  readyBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.success + '55',
  },
  readyBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.successLabel,
  },
  pendingCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    padding: 14,
  },
  pendingText: {
    fontSize: Type.footnote.fontSize,
    color: t.text,
    lineHeight: 18,
  },
  pendingBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  pendingBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  savedCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.card,
    padding: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: t.line,
    width: '100%',
  },
  savedText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: t.text,
    lineHeight: 18,
  },
});
