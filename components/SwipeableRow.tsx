// SwipeableRow — general-purpose swipe-to-action wrapper for list rows.
//
// Use case: drop any row content inside and get swipe-left to reveal
// up to 2 destructive/positive actions (archive, delete, mark-done).
// Standard iOS Mail / Things 3 / Linear pattern.
//
// Built on react-native-gesture-handler's Swipeable (already a dep).
// Works on iOS + Android. On web, gestures fall back gracefully — the
// row stays static and the row's onPress handler still fires.
//
// Two-sided design: used by GC-side lists (RFI, punch, submittal) AND
// homeowner-side lists (bid offers received on a posted job). The same
// component handles both — actions are passed in as props.
//
// Example usage:
//   <SwipeableRow
//     onSwipeLeftPrimary={{ label: 'Archive', onPress: archive, tone: 'neutral' }}
//     onSwipeLeftSecondary={{ label: 'Delete', onPress: del, tone: 'danger' }}
//   >
//     <RfiCard rfi={r} />
//   </SwipeableRow>

import React, { useCallback, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';

export interface SwipeAction {
  label: string;
  /** Icon component from lucide-react-native. Optional. */
  Icon?: React.ComponentType<{ size: number; color: string }>;
  onPress: () => void;
  /** Visual tone: neutral (gray), primary (brand), success (green),
   *  warning (amber), danger (red). Default neutral. */
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
}

interface Props {
  /** Primary right-side action (revealed by swipe-left). Innermost. */
  rightPrimary?: SwipeAction;
  /** Optional secondary action shown to the right of the primary. */
  rightSecondary?: SwipeAction;
  /** Left-side action (swipe-right). Usually positive (mark done). */
  leftPrimary?: SwipeAction;
  children: React.ReactNode;
  /** Disable swipe entirely (e.g. for non-interactive rows). */
  disabled?: boolean;
  /** Optional testID for the outer Swipeable wrapper. */
  testID?: string;
}

const TONE_BG: Record<NonNullable<SwipeAction['tone']>, string> = {
  neutral: '#6B7280',
  primary: '#1A6B3C',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
};

function ActionView({ action, width }: { action: SwipeAction; width: number }) {
  const Icon = action.Icon;
  const bg = TONE_BG[action.tone ?? 'neutral'];
  return (
    <TouchableOpacity
      style={[styles.action, { backgroundColor: bg, width }]}
      onPress={() => {
        if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        action.onPress();
      }}
      activeOpacity={0.85}
      testID={`swipe-action-${action.label.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {Icon ? <Icon size={20} color="#fff" /> : null}
      <Text style={styles.actionLabel}>{action.label}</Text>
    </TouchableOpacity>
  );
}

export default function SwipeableRow({
  rightPrimary,
  rightSecondary,
  leftPrimary,
  children,
  disabled,
  testID,
}: Props) {
  const swipeableRef = useRef<Swipeable | null>(null);

  const renderRightActions = useCallback(
    (
      _progress: Animated.AnimatedInterpolation<number>,
      _dragX: Animated.AnimatedInterpolation<number>,
    ) => {
      if (!rightPrimary && !rightSecondary) return null;
      const w = 84;
      return (
        <View style={styles.rightContainer}>
          {rightSecondary ? <ActionView action={rightSecondary} width={w} /> : null}
          {rightPrimary ? <ActionView action={rightPrimary} width={w} /> : null}
        </View>
      );
    },
    [rightPrimary, rightSecondary],
  );

  const renderLeftActions = useCallback(
    () => {
      if (!leftPrimary) return null;
      return (
        <View style={styles.leftContainer}>
          <ActionView action={leftPrimary} width={96} />
        </View>
      );
    },
    [leftPrimary],
  );

  // On web, Swipeable from gesture-handler often degrades poorly.
  // Render children directly so the row stays functional via onPress.
  if (Platform.OS === 'web' || disabled) {
    return <View testID={testID}>{children}</View>;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={rightPrimary || rightSecondary ? renderRightActions : undefined}
      renderLeftActions={leftPrimary ? renderLeftActions : undefined}
      friction={2}
      rightThreshold={40}
      leftThreshold={40}
      overshootRight={false}
      overshootLeft={false}
      testID={testID}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  rightContainer: {
    flexDirection: 'row' as const,
    alignItems: 'stretch' as const,
  },
  leftContainer: {
    flexDirection: 'row' as const,
    alignItems: 'stretch' as const,
  },
  action: {
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xxs,
  },
  actionLabel: {
    color: '#fff',
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
});
