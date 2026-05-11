// Input — single-line or multiline text field with floating label.
//
// Focus state in amber, error state in danger. Uses themed colors.

import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  helper?: string;
  multiline?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

export function Input({
  label,
  error,
  helper,
  multiline = false,
  containerStyle,
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [focused, setFocused] = useState(false);

  const borderColor = error ? colors.danger : focused ? colors.accent : colors.line;

  return (
    <View style={[styles.wrap, containerStyle]}>
      <Text style={[Type.monoEyebrow, { color: error ? colors.danger : colors.textSecondary, marginBottom: 6 }]}>
        {label}
      </Text>
      <TextInput
        {...rest}
        multiline={multiline}
        placeholderTextColor={colors.textMuted}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        style={[
          styles.input,
          { borderColor, color: colors.text, minHeight: multiline ? 96 : Tokens.touchTarget.comfortable },
        ]}
      />
      {error ? (
        <Text style={[Type.footnote, { color: colors.danger, marginTop: 6 }]}>{error}</Text>
      ) : helper ? (
        <Text style={[Type.footnote, { color: colors.textMuted, marginTop: 6 }]}>{helper}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrap: { width: '100%' },
    input: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderRadius: Tokens.radius.md,
      paddingHorizontal: Tokens.spacing.md,
      paddingVertical: 12,
      fontSize: Type.body.fontSize,
      ...Tokens.continuousCorners,
    },
  });

export default Input;
