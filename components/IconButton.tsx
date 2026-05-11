// IconButton — opinionated icon-only button that mandates an
// `accessibilityLabel` via TypeScript.
//
// Why this exists: the audit found 9 of 205 component/route files
// (~4%) use `accessibilityLabel`. Premium SaaS apps in 2026 hit ~80%+.
// The single biggest gap is icon-only TouchableOpacity buttons that
// VoiceOver can't announce.
//
// Approach: instead of mass-migrating 200+ existing call sites (risky,
// labor-intensive), introduce a primitive that's type-safe — the
// `accessibilityLabel` prop is required, not optional. New icon-only
// surfaces use this primitive and stay compliant. Old surfaces migrate
// gradually as they're touched.
//
// Also encodes:
//   - Min 44pt touch target via `minWidth` / `minHeight` (Apple HIG floor)
//   - Built-in haptic on press (light impact, configurable)
//   - Optional pressed-state opacity tweak
//   - Apple iOS continuous-corners squircle when a `radius` is set
//
// Usage:
//   <IconButton
//     accessibilityLabel="Open settings"
//     icon={Settings}
//     onPress={() => router.push('/settings')}
//   />

import React, { memo } from 'react';
import {
  Pressable, Platform, StyleSheet, type ViewStyle, type StyleProp,
  type PressableStateCallbackType,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { continuousCorners, TouchTarget, Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'plain' | 'tinted' | 'filled' | 'destructive';

export interface IconButtonProps {
  /** REQUIRED — what VoiceOver / TalkBack announces. Use a verb +
   *  object phrase: "Open settings," "Delete project," "Toggle filter." */
  accessibilityLabel: string;
  /** Optional spoken hint after the label, like "double-tap to open." */
  accessibilityHint?: string;
  icon: LucideIcon;
  onPress: () => void;
  onLongPress?: () => void;
  /** Size = touch-target diameter. md (44) is the iOS HIG floor. */
  size?: IconButtonSize;
  /** Visual style. plain = transparent; tinted = soft colored bg; filled
   *  = solid colored bg + light icon; destructive = error tint. */
  variant?: IconButtonVariant;
  /** Color override for the icon. Defaults derive from variant. */
  iconColor?: string;
  /** Background color override. Defaults derive from variant. */
  backgroundColor?: string;
  /** Disabled state — drops opacity + blocks press. */
  disabled?: boolean;
  /** Whether the press should fire a haptic. Default true. */
  haptic?: boolean | 'light' | 'medium' | 'heavy';
  /** Optional border (used for "ghost" tinted style). */
  bordered?: boolean;
  /** Test ID surfaces in test runners + accessibility-tree dumps. */
  testID?: string;
  /** Style override for the touch container. Avoid using this to change
   *  size — pass `size` instead. */
  style?: StyleProp<ViewStyle>;
}

const SIZE_TO_DIAMETER: Record<IconButtonSize, number> = {
  sm: TouchTarget.min,           // 44 — iOS HIG floor
  md: TouchTarget.comfortable,   // 48 — premium 2026 bar
  lg: TouchTarget.large,         // 56 — primary actions
};

const SIZE_TO_ICON: Record<IconButtonSize, number> = {
  sm: 16,
  md: 18,
  lg: 22,
};

function fireHaptic(haptic: IconButtonProps['haptic']) {
  if (Platform.OS === 'web' || haptic === false) return;
  const kind = haptic === 'medium' ? Haptics.ImpactFeedbackStyle.Medium
    : haptic === 'heavy' ? Haptics.ImpactFeedbackStyle.Heavy
    : Haptics.ImpactFeedbackStyle.Light;
  void Haptics.impactAsync(kind);
}

function IconButtonImpl({
  accessibilityLabel,
  accessibilityHint,
  icon: Icon,
  onPress,
  onLongPress,
  size = 'md',
  variant = 'plain',
  iconColor,
  backgroundColor,
  disabled = false,
  haptic = true,
  bordered = false,
  testID,
  style,
}: IconButtonProps) {
  const { colors } = useTheme();
  const diameter = SIZE_TO_DIAMETER[size];
  const iconSize = SIZE_TO_ICON[size];

  const resolvedIconColor = iconColor ?? (
    variant === 'destructive' ? colors.danger
    : variant === 'filled' ? '#FFFFFF'
    : colors.text
  );
  const resolvedBg = backgroundColor ?? (
    variant === 'plain' ? 'transparent'
    : variant === 'tinted' ? colors.surfaceAlt
    : variant === 'destructive' ? colors.danger + '14'
    : colors.accent
  );

  const handlePress = () => {
    if (disabled) return;
    fireHaptic(haptic);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
      hitSlop={6}
      style={(state: PressableStateCallbackType) => [
        styles.base,
        {
          width: diameter,
          height: diameter,
          backgroundColor: resolvedBg,
        },
        bordered && {
          borderWidth: 1,
          borderColor: variant === 'destructive' ? colors.danger + '40' : colors.line,
        },
        state.pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Icon size={iconSize} color={resolvedIconColor} strokeWidth={2.2} />
    </Pressable>
  );
}

export const IconButton = memo(IconButtonImpl);
export default IconButton;

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Tokens.radius.full,
    ...continuousCorners,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  disabled: {
    opacity: 0.4,
  },
});
