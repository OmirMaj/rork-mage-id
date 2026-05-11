// Field — form-field primitive.
//
// Replaces 40+ ad-hoc form rows across the app that each re-implement
// label + TextInput + helper-or-error text inline. Audit (2026-05) found
// these in: project-detail.tsx, new-project.tsx, paywall.tsx,
// estimate-wizard, change-order modal, etc. — each with slightly
// different padding, font weight, error treatment.
//
// What Field handles:
//   - Label above the input (Type.footnoteEmphasized).
//   - Single-line or multiline input with proper paddings.
//   - Optional leading icon (Lucide) inside the input frame.
//   - Helper text (subtle) OR error text (red), mutually exclusive.
//   - Disabled state.
//   - Focused state — border switches to accent.
//   - Currency variant: prepends "$", numeric keyboard.
//   - Required indicator (red dot next to label).
//
// What Field doesn't handle:
//   - Select / dropdown / picker — different primitive.
//   - Multi-select chips — different primitive.
//   - Date / time pickers — those need native modals.
//   - Validation logic — pass `error` from your form-state library.

import React, { memo, useState, useCallback, type ComponentType } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens, continuousCorners } from '@/constants/designTokens';

export type FieldType =
  | 'text'
  | 'numeric'
  | 'decimal'
  | 'email'
  | 'password'
  | 'phone'
  | 'search'
  | 'currency'
  | 'url';

export interface FieldProps extends Omit<
  TextInputProps,
  'value' | 'onChange' | 'onChangeText' | 'keyboardType' | 'secureTextEntry' | 'style'
> {
  /** Label shown above the input. Omit for unlabeled inputs (rare). */
  label?: string;
  /** Mark the field as required — adds a red dot next to the label. */
  required?: boolean;
  /** Controlled value. */
  value: string;
  /** Value-change handler. */
  onChange: (value: string) => void;
  /** Placeholder shown when empty. */
  placeholder?: string;
  /** Helper text below the input. Hidden when `error` is set. */
  helper?: string;
  /** Error text below the input. Replaces helper. Color: error. */
  error?: string;
  /** Optional leading icon inside the input frame. */
  icon?: LucideIcon;
  /** Field type — drives keyboardType, secureTextEntry, and currency prefix. */
  type?: FieldType;
  /** Multiline textarea. Min height grows; max height capped at 4 lines. */
  multiline?: boolean;
  /** Disable the input. */
  disabled?: boolean;
  /** Optional style override for the outer wrapper. */
  style?: StyleProp<ViewStyle>;
  /** testID for E2E. Auto-derived from label if not provided. */
  testID?: string;
}

interface KeyboardConfig {
  keyboardType: TextInputProps['keyboardType'];
  autoCapitalize: TextInputProps['autoCapitalize'];
  secureTextEntry: boolean;
}

function configForType(type: FieldType): KeyboardConfig {
  switch (type) {
    case 'email':    return { keyboardType: 'email-address', autoCapitalize: 'none',      secureTextEntry: false };
    case 'password': return { keyboardType: 'default',       autoCapitalize: 'none',      secureTextEntry: true };
    case 'numeric':  return { keyboardType: 'number-pad',    autoCapitalize: 'none',      secureTextEntry: false };
    case 'decimal':  return { keyboardType: 'decimal-pad',   autoCapitalize: 'none',      secureTextEntry: false };
    case 'phone':    return { keyboardType: 'phone-pad',     autoCapitalize: 'none',      secureTextEntry: false };
    case 'url':      return { keyboardType: 'url',           autoCapitalize: 'none',      secureTextEntry: false };
    case 'search':   return { keyboardType: 'default',       autoCapitalize: 'none',      secureTextEntry: false };
    case 'currency': return { keyboardType: 'decimal-pad',   autoCapitalize: 'none',      secureTextEntry: false };
    case 'text':
    default:         return { keyboardType: 'default',       autoCapitalize: 'sentences', secureTextEntry: false };
  }
}

function FieldImpl({
  label,
  required = false,
  value,
  onChange,
  placeholder,
  helper,
  error,
  icon: Icon,
  type = 'text',
  multiline = false,
  disabled = false,
  style,
  testID,
  onFocus,
  onBlur,
  ...rest
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const { keyboardType, autoCapitalize, secureTextEntry } = configForType(type);

  const handleFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
    (e) => {
      setFocused(true);
      onFocus?.(e);
    },
    [onFocus],
  );
  const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    (e) => {
      setFocused(false);
      onBlur?.(e);
    },
    [onBlur],
  );

  const derivedTestID = testID ?? (label ? `field-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  const borderColor =
    error ? Colors.error
    : focused ? Colors.accent
    : Colors.border;

  return (
    <View style={[styles.container, style]}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={[Type.footnoteEmphasized, { color: Colors.textSecondary }]}>
            {label}
          </Text>
          {required ? (
            <View
              style={styles.requiredDot}
              accessibilityLabel="required"
            />
          ) : null}
        </View>
      ) : null}

      <View
        style={[
          styles.inputFrame,
          {
            borderColor,
            backgroundColor: disabled ? Colors.fillSecondary : Colors.surface,
          },
          multiline && styles.multilineFrame,
        ]}
      >
        {Icon ? (
          <Icon size={18} color={Colors.textSecondary} strokeWidth={2} />
        ) : null}

        {type === 'currency' && !Icon ? (
          <Text style={[Type.body, { color: Colors.textSecondary }]}>$</Text>
        ) : null}

        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          secureTextEntry={secureTextEntry}
          editable={!disabled}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={handleFocus}
          onBlur={handleBlur}
          style={[
            styles.input,
            Type.body,
            { color: Colors.text },
            multiline && styles.inputMultiline,
          ]}
          testID={derivedTestID}
          {...rest}
        />
      </View>

      {error ? (
        <Text style={[Type.footnote, styles.errorText]} testID={derivedTestID ? `${derivedTestID}-error` : undefined}>
          {error}
        </Text>
      ) : helper ? (
        <Text style={[Type.footnote, styles.helperText]}>{helper}</Text>
      ) : null}
    </View>
  );
}

export const Field = memo(FieldImpl) as ComponentType<FieldProps>;

const styles = StyleSheet.create({
  container: {
    gap: Tokens.spacing.xxs,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xxs,
  },
  requiredDot: {
    width: 6,
    height: 6,
    borderRadius: Tokens.radius.full,
    backgroundColor: Colors.error,
  },
  inputFrame: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Tokens.spacing.xs,
    minHeight: Tokens.touchTarget.min,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.xs,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    ...continuousCorners,
  },
  multilineFrame: {
    minHeight: 96,
    paddingTop: Tokens.spacing.sm,
    alignItems: 'flex-start',
  },
  input: {
    flex: 1,
    padding: 0, // TextInput has built-in padding; we own spacing via the frame.
  },
  inputMultiline: {
    minHeight: 72,
    maxHeight: 4 * 22, // 4 lines × line-height of Type.body
  },
  helperText: {
    color: Colors.textMuted,
    marginTop: Tokens.spacing.xxs,
  },
  errorText: {
    color: Colors.error,
    marginTop: Tokens.spacing.xxs,
  },
});
