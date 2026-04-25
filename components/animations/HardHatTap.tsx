// HardHatTap — a Pressable wrapper that adds a quick "tool stamp" press
// feedback. On tap-in, the wrapped content scales down to 0.96 and a
// small hard-hat icon flashes briefly in the corner (tipped 12°, like a
// foreman acknowledging the action). On tap-out, everything springs back.
//
// Compared to a plain TouchableOpacity (which just dims), this gives the
// app a subtle construction-y signature without being intrusive — most
// users won't consciously notice the hard hat, but the press feels more
// physical and intentional.
//
// All animations use the native driver so this works fine inside lists.
import React, { useRef, ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  ViewStyle,
  GestureResponderEvent,
  PressableProps,
  Platform,
} from 'react-native';
import { HardHat } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import * as Haptics from 'expo-haptics';

interface HardHatTapProps extends Omit<PressableProps, 'style' | 'onPressIn' | 'onPressOut'> {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  /** Disable the hard-hat flash (still keeps scale animation). */
  hideHat?: boolean;
  /** Where the hat appears relative to the pressable. Default 'topRight'. */
  hatPosition?: 'topRight' | 'topLeft' | 'bottomRight' | 'bottomLeft';
  /** Hat icon size in px. Default 14. */
  hatSize?: number;
  /** Hat icon color. Defaults to Colors.warning (orange). */
  hatColor?: string;
  /** Disable haptic feedback on press. */
  noHaptics?: boolean;
  testID?: string;
}

const POSITION_STYLES: Record<NonNullable<HardHatTapProps['hatPosition']>, ViewStyle> = {
  topRight: { top: -6, right: -6 },
  topLeft: { top: -6, left: -6 },
  bottomRight: { bottom: -6, right: -6 },
  bottomLeft: { bottom: -6, left: -6 },
};

export default function HardHatTap({
  children,
  style,
  hideHat = false,
  hatPosition = 'topRight',
  hatSize = 14,
  hatColor = Colors.warning,
  noHaptics = false,
  testID,
  onPress,
  ...rest
}: HardHatTapProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const hatOpacity = useRef(new Animated.Value(0)).current;
  const hatTranslateY = useRef(new Animated.Value(0)).current;
  const hatRotate = useRef(new Animated.Value(0)).current;

  const handlePressIn = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, friction: 6 }),
      Animated.sequence([
        Animated.parallel([
          Animated.timing(hatOpacity, { toValue: 1, duration: 120, useNativeDriver: true }),
          Animated.timing(hatTranslateY, { toValue: -2, duration: 120, useNativeDriver: true }),
          Animated.timing(hatRotate, { toValue: 1, duration: 120, useNativeDriver: true }),
        ]),
        Animated.timing(hatOpacity, { toValue: 0, duration: 220, useNativeDriver: true, delay: 80 }),
      ]),
    ]).start();
  };

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }),
      Animated.timing(hatTranslateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(hatRotate, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start();
  };

  const rotateInterpolated = hatRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '12deg'],
  });

  return (
    <Pressable
      {...rest}
      testID={testID}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={(e: GestureResponderEvent) => {
        if (!noHaptics && Platform.OS !== 'web') void Haptics.selectionAsync();
        onPress?.(e);
      }}
    >
      <Animated.View style={[styles.wrap, style as ViewStyle, { transform: [{ scale }] }]}>
        {children}
        {!hideHat && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.hat,
              POSITION_STYLES[hatPosition],
              {
                opacity: hatOpacity,
                transform: [{ translateY: hatTranslateY }, { rotate: rotateInterpolated }],
              },
            ]}
          >
            <HardHat size={hatSize} color={hatColor} fill={hatColor + '40'} />
          </Animated.View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
  },
  hat: {
    position: 'absolute',
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
