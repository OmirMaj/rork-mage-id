import React, { useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  PanResponder,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { CheckCircle2, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ScheduleTask } from '@/types';
import { getPhaseColor, getStatusColor } from '@/utils/scheduleEngine';

interface SwipeableTaskCardProps {
  task: ScheduleTask;
  onProgressUpdate: (task: ScheduleTask, progress: number) => void;
  onPress: (task: ScheduleTask) => void;
  children: React.ReactNode;
}

function SwipeableTaskCard({
  task,
  onProgressUpdate,
  onPress,
  children,
}: SwipeableTaskCardProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(task.progress)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const cardWidth = useRef(0);
  const startProgress = useRef(task.progress);
  const currentSnap = useRef(task.progress);

  const triggerHaptic = useCallback(() => {
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const flashGreen = useCallback(() => {
    Animated.sequence([
      Animated.timing(flashOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(flashOpacity, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, [flashOpacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return Math.abs(gestureState.dx) > 15 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.5;
      },
      onPanResponderGrant: () => {
        startProgress.current = task.progress;
        currentSnap.current = task.progress;
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (gestureState.dx > 0 && cardWidth.current > 0) {
          const swipeRatio = gestureState.dx / cardWidth.current;
          const progressIncrease = swipeRatio * 100;
          const newProgress = Math.min(100, Math.max(0, startProgress.current + progressIncrease));
          const snapped = Math.round(newProgress / 25) * 25;

          if (snapped !== currentSnap.current) {
            currentSnap.current = snapped;
            triggerHaptic();
          }

          progressAnim.setValue(newProgress);
          translateX.setValue(Math.min(gestureState.dx, 80));
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dx > 30 && cardWidth.current > 0) {
          const swipeRatio = gestureState.dx / cardWidth.current;
          const progressIncrease = swipeRatio * 100;
          const newProgress = Math.min(100, Math.max(0, startProgress.current + progressIncrease));
          const snapped = Math.round(newProgress / 25) * 25;
          const finalProgress = Math.max(snapped, startProgress.current);

          if (finalProgress !== startProgress.current) {
            onProgressUpdate(task, finalProgress);
            flashGreen();

            if (finalProgress >= 100) {
              if (Platform.OS !== 'web') {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            }
          }
        }

        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }).start();

        progressAnim.setValue(task.progress);
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          tension: 80,
          friction: 10,
        }).start();
        progressAnim.setValue(task.progress);
      },
    })
  ).current;

  const phaseColor = getPhaseColor(task.phase);
  const swipeProgressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={s.wrapper}
      onLayout={(e) => { cardWidth.current = e.nativeEvent.layout.width; }}
    >
      <View style={s.swipeBackground}>
        <View style={s.swipeBgContent}>
          <ChevronRight size={16} color="#FFF" />
          <Text style={s.swipeBgText}>+25%</Text>
        </View>
        <Animated.View
          style={[
            s.swipeProgressOverlay,
            { width: swipeProgressWidth as any, backgroundColor: phaseColor + '40' },
          ]}
        />
      </View>

      <Animated.View
        style={[
          s.cardContainer,
          { transform: [{ translateX }] },
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={s.cardTouchable}
          onPress={() => onPress(task)}
          activeOpacity={0.85}
        >
          {children}
        </TouchableOpacity>

        <Animated.View
          style={[
            s.flashOverlay,
            { opacity: flashOpacity, backgroundColor: '#34C75920' },
          ]}
          pointerEvents="none"
        />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    position: 'relative' as const,
    overflow: 'hidden' as const,
    borderRadius: 16,
  },
  swipeBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#34C759',
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    overflow: 'hidden' as const,
  },
  swipeBgContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 2,
  },
  swipeBgText: {
    fontSize: 13,
    fontWeight: '800' as const,
    color: '#FFF',
  },
  swipeProgressOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 1,
  },
  cardContainer: {
    borderRadius: 16,
    overflow: 'hidden' as const,
  },
  cardTouchable: {
    borderRadius: 16,
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
  },
});

export default React.memo(SwipeableTaskCard);
