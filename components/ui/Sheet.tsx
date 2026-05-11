// Sheet — the chrome for modal-route screens.
//
// CLAUDE.md notes: "Modal-in-screen pattern: long screens (e.g.
// app/project-detail.tsx) use a tile grid that opens section modals
// with a ChevronLeft back button." That pattern is implemented ad-hoc
// in 15+ places (every Modal component in components/, every modal
// route in app/). Each one builds its own header — back chevron + title
// + sometimes a right action — and its own scroll container. They drift
// in padding, type weight, hit-target size, safe-area handling.
//
// Sheet is the canonical implementation. Use it for the *interior* of
// any modal route (presented via Expo Router `presentation: "modal"`)
// or any in-screen modal that follows the back-chevron pattern.
//
// What Sheet provides:
//   - Safe-area top inset.
//   - 56pt header row with ChevronLeft button on the left (44pt hit
//     target), title centered, optional right action.
//   - Title typography locked to `Type.title3` (Apple "Navigation Title"
//     size — distinct from the largeTitle on dashboard roots).
//   - Subtle bottom border under the header so content scrolls cleanly
//     under it.
//   - Scrollable body by default (kKeyboardShouldPersistTaps: 'handled'
//     for forms).
//
// What Sheet doesn't provide:
//   - The modal presentation itself — that's expo-router's job. Mount
//     Sheet *inside* a route that's declared with presentation: 'modal'.
//   - Bottom-sheet detents — for partial-height sheets, use a different
//     primitive (TBD).

import React, { memo, type ReactNode } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export interface SheetRightAction {
  /** Label shown in place of an icon. Use a short verb ("Save", "Send"). */
  label: string;
  /** Tap handler. */
  onPress: () => void;
  /** Visual emphasis. "primary" = accent color, "destructive" = error,
   *  "neutral" = secondary text. Defaults to "primary". */
  variant?: 'primary' | 'destructive' | 'neutral';
  /** Disable the action — greys it out, prevents taps. */
  disabled?: boolean;
  /** testID for E2E. */
  testID?: string;
}

export interface SheetProps {
  /** Title shown centered in the header. */
  title: string;
  /** Back-chevron handler. Usually `() => router.back()`. */
  onClose: () => void;
  /** Optional right-side action. */
  rightAction?: SheetRightAction;
  /**
   * Wrap children in a ScrollView. Defaults to true. Set false when the
   * child manages its own scrolling (e.g. a FlatList).
   */
  scrollable?: boolean;
  /** Padding inside the body. Defaults to "lg" (20pt). */
  bodyPadding?: keyof typeof Tokens.spacing | number | 'none';
  /** Style override for the outer container. */
  style?: StyleProp<ViewStyle>;
  /** Style override for the scrollable body content. */
  contentStyle?: StyleProp<ViewStyle>;
  /** testID for E2E. */
  testID?: string;
  children: ReactNode;
}

function resolveBodyPadding(p: SheetProps['bodyPadding']): number {
  if (p === undefined) return Tokens.spacing.lg;
  if (p === 'none') return 0;
  if (typeof p === 'number') return p;
  return Tokens.spacing[p];
}

function SheetImpl({
  title,
  onClose,
  rightAction,
  scrollable = true,
  bodyPadding,
  style,
  contentStyle,
  testID,
  children,
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const pad = resolveBodyPadding(bodyPadding);

  const rightVariant = rightAction?.variant ?? 'primary';
  const rightColor =
    rightVariant === 'destructive'
      ? Colors.error
      : rightVariant === 'neutral'
        ? Colors.textSecondary
        : Colors.accent;

  return (
    <View style={[styles.container, style]} testID={testID}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [
              styles.backBtn,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="sheet-back-btn"
          >
            <ChevronLeft size={26} color={Colors.text} strokeWidth={2.2} />
          </Pressable>

          <Text
            style={[Type.title3, styles.title, { color: Colors.text }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {title}
          </Text>

          <View style={styles.rightSlot}>
            {rightAction ? (
              <Pressable
                onPress={rightAction.onPress}
                disabled={rightAction.disabled}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.rightBtn,
                  pressed && !rightAction.disabled && styles.pressed,
                  rightAction.disabled && styles.disabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={rightAction.label}
                accessibilityState={{ disabled: rightAction.disabled }}
                testID={rightAction.testID ?? 'sheet-right-action'}
              >
                <Text
                  style={[
                    Type.bodyEmphasized,
                    { color: rightColor },
                  ]}
                  numberOfLines={1}
                >
                  {rightAction.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      {/* Body */}
      {scrollable ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            { padding: pad, paddingBottom: pad + insets.bottom },
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View
          style={[
            styles.body,
            { padding: pad, paddingBottom: pad + insets.bottom },
            contentStyle,
          ]}
        >
          {children}
        </View>
      )}
    </View>
  );
}

export const Sheet = memo(SheetImpl);

const HEADER_HEIGHT = 56;
const SIDE_SLOT_WIDTH = 72; // keeps back chevron + right action balanced
                            // around a centered title

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  headerRow: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Tokens.spacing.xs,
  },
  backBtn: {
    width: SIDE_SLOT_WIDTH,
    height: Tokens.touchTarget.min,
    paddingLeft: Tokens.spacing.xs,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
  rightSlot: {
    width: SIDE_SLOT_WIDTH,
    height: Tokens.touchTarget.min,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  rightBtn: {
    paddingHorizontal: Tokens.spacing.sm,
    height: Tokens.touchTarget.min,
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  pressed: {
    opacity: 0.55,
  },
  disabled: {
    opacity: 0.4,
  },
});
