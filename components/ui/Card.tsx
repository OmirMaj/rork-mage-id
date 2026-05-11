// Card — compositional surface for any content block.
//
// Usage:
//   <Card>
//     <Card.Label>Project · In Progress</Card.Label>
//     <Card.Title>The Henderson Residence</Card.Title>
//     <Card.Meta>3,200 sf · Brownstone</Card.Meta>
//     ...
//   </Card>
//
// Optionally pressable (wires Pressable + haptic + scale).

import React, { useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  Animated,
  StyleSheet,
  Platform,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { EyebrowLabel } from './EyebrowLabel';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface CardProps {
  children: React.ReactNode;
  pressable?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface SlotProps {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
}

function CardRoot({ children, pressable, onPress, style, testID }: CardProps) {
  const styles = useThemedStyles(makeStyles);
  const scale = useRef(new Animated.Value(1)).current;

  if (!pressable || !onPress) {
    return (
      <View style={[styles.card, style]} testID={testID}>
        {children}
      </View>
    );
  }

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.985, useNativeDriver: true, ...Tokens.motion.spring.snap }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, ...Tokens.motion.spring.snap }).start();
  };
  const handlePress = () => {
    if (Platform.OS === 'ios') Haptics.selectionAsync().catch(() => {});
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[styles.card, style]}
        testID={testID}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

function CardLabel({ children }: { children: string }) {
  return <EyebrowLabel tone="neutral" showDot={false}>{children}</EyebrowLabel>;
}

function CardTitle({ children, style }: SlotProps) {
  const { colors } = useTheme();
  return <Text style={[Type.serifHeadline, { color: colors.text, marginTop: 4 }, style]}>{children}</Text>;
}

function CardMeta({ children, style }: SlotProps) {
  const { colors } = useTheme();
  return <Text style={[Type.monoCaption, { color: colors.textMuted, marginTop: 6 }, style]}>{children}</Text>;
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.lg,
      borderWidth: 1,
      borderColor: t.line,
      padding: Tokens.spacing.md,
      ...Tokens.continuousCorners,
    },
  });

export const Card = Object.assign(CardRoot, {
  Label: CardLabel,
  Title: CardTitle,
  Meta: CardMeta,
});

export default Card;
