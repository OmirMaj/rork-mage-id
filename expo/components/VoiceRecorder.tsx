import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform,
  Animated,
} from 'react-native';
import { Mic, MicOff, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface VoiceRecorderProps {
  onTranscriptReady: (transcript: string) => void;
  isLoading: boolean;
  isLocked?: boolean;
  onLockedPress?: () => void;
}

export default function VoiceRecorder({ onTranscriptReady, isLoading, isLocked, onLockedPress }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingRef, setRecordingRef] = useState<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  const startPulse = useCallback(() => {
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  }, [pulseAnim]);

  const handlePress = useCallback(async () => {
    if (isLocked) {
      onLockedPress?.();
      return;
    }

    if (Platform.OS === 'web') {
      return;
    }

    if (isRecording && recordingRef) {
      try {
        console.log('[VoiceDFR] Stopping recording');
        stopPulse();
        setIsRecording(false);
        await recordingRef.stopAndUnloadAsync();
        const { Audio } = require('expo-av');
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        const uri = recordingRef.getURI();
        setRecordingRef(null);

        if (uri) {
          console.log('[VoiceDFR] Sending audio for transcription');
          const uriParts = uri.split('.');
          const fileType = uriParts[uriParts.length - 1];
          const formData = new FormData();
          const audioFile = { uri, name: `recording.${fileType}`, type: `audio/${fileType}` };
          formData.append('audio', audioFile as any);

          const response = await fetch('https://toolkit.rork.com/stt/transcribe/', {
            method: 'POST',
            body: formData,
          });
          const data = await response.json();
          if (data.text) {
            console.log('[VoiceDFR] Transcription received:', data.text.substring(0, 50));
            onTranscriptReady(data.text);
          }
        }
      } catch (err) {
        console.log('[VoiceDFR] Recording stop error:', err);
      }
    } else {
      try {
        const { Audio } = require('expo-av');
        console.log('[VoiceDFR] Requesting permissions');
        const { granted } = await Audio.requestPermissionsAsync();
        if (!granted) return;

        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });

        const recording = new Audio.Recording();
        await recording.prepareToRecordAsync({
          android: {
            extension: '.m4a',
            outputFormat: 3,
            audioEncoder: 3,
          },
          ios: {
            extension: '.wav',
            outputFormat: 6,
            audioQuality: 127,
          },
          web: {},
        });
        await recording.startAsync();
        setRecordingRef(recording);
        setIsRecording(true);
        startPulse();
        console.log('[VoiceDFR] Recording started');
      } catch (err) {
        console.log('[VoiceDFR] Recording start error:', err);
      }
    }
  }, [isRecording, recordingRef, isLocked, onLockedPress, onTranscriptReady, startPulse, stopPulse]);

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
    <View style={styles.container}>
      <TouchableOpacity onPress={handlePress} activeOpacity={0.7} disabled={isLoading} testID="voice-record-btn">
        <Animated.View style={[
          styles.micBtn,
          isRecording && styles.micBtnRecording,
          { transform: [{ scale: isRecording ? pulseAnim : 1 }] },
        ]}>
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Mic size={20} color={isRecording ? '#fff' : Colors.primary} />
          )}
        </Animated.View>
      </TouchableOpacity>
      <Text style={styles.label}>
        {isLoading ? 'Processing...' : isRecording ? 'Tap to stop' : 'Tap to dictate'}
      </Text>
    </View>
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
  micBtnRecording: {
    backgroundColor: Colors.error,
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
