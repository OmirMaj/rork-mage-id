import React, { useRef, useEffect, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Platform, Animated,
} from 'react-native';
import { Mic } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import type { VoiceUpdateFunctions } from '@/utils/voiceCommandExecutor';
import VoiceCommandModal from './VoiceCommandModal';

interface VoiceFieldButtonProps {
  tasks: ScheduleTask[];
  projectName: string;
  projectId: string;
  updateFunctions: VoiceUpdateFunctions;
  activeTodayTask?: ScheduleTask | null;
  bottomOffset?: number;
}

export default function VoiceFieldButton({
  tasks, projectName, projectId, updateFunctions, activeTodayTask, bottomOffset = 16,
}: VoiceFieldButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 6,
      tension: 80,
      useNativeDriver: true,
    }).start();

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 0.7, duration: 1500, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0.3, duration: 1500, useNativeDriver: true }),
      ])
    );
    glow.start();
    return () => glow.stop();
  }, [scaleAnim, glowAnim]);

  const handlePress = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsModalOpen(true);
  }, []);

  if (Platform.OS === 'web') return null;

  return (
    <>
      <Animated.View
        style={[
          styles.container,
          { bottom: bottomOffset, transform: [{ scale: scaleAnim }] },
        ]}
      >
        <Animated.View style={[styles.glow, { opacity: glowAnim }]} />
        <TouchableOpacity
          style={styles.button}
          onPress={handlePress}
          activeOpacity={0.8}
          testID="voice-field-btn"
        >
          <Mic size={24} color="#fff" />
        </TouchableOpacity>
      </Animated.View>

      <VoiceCommandModal
        visible={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        tasks={tasks}
        projectName={projectName}
        projectId={projectId}
        updateFunctions={updateFunctions}
        activeTodayTask={activeTodayTask}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 20,
    zIndex: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Colors.primary,
  },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  },
});
