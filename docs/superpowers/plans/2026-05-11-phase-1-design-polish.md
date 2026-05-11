# Phase 1 — App Design Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the MAGE ID app from utilitarian green/Inter to editorial Fraunces + amber + JetBrains Mono on cream/paper (light default) with optional dark mode, rolling out across 6 sequential PRs.

**Architecture:** Extend (don't replace) existing token modules in `constants/`. Add a `ThemeContext` provider above `AuthProvider` in `app/_layout.tsx`. Build a primitives library at `components/ui/` that bakes tokens in. Migrate hero screens one at a time using new primitives — legacy `Colors.*` keys remain so unmigrated screens keep working.

**Tech Stack:** Expo SDK 54, React Native 0.81, Expo Router 6, TypeScript strict, bun, `@nkzw/create-context-hook`, lucide-react-native, AsyncStorage, `@expo-google-fonts/fraunces`, `@expo-google-fonts/jetbrains-mono` (new).

**Verification approach:** No automated tests in this plan. Repo has no Jest setup. Each PR is verified via: `npx tsc --noEmit` (strict), `bun run lint`, and a manual smoke test in light + dark + system modes (described per task).

**Spec:** `docs/superpowers/specs/2026-05-11-phase-1-design-polish-design.md`

---

## File Structure (this plan touches these)

```
constants/
  colors.ts              MODIFY  — add Theme + light/dark variants
  typography.ts          MODIFY  — add Fraunces + Mono types
  designTokens.ts        UNCHANGED

contexts/
  ThemeContext.tsx       CREATE  — pref + resolved + setPref

hooks/
  useThemedStyles.ts     CREATE  — themed StyleSheet helper

components/ui/
  Button.tsx             CREATE
  Card.tsx               CREATE
  Input.tsx              CREATE
  Badge.tsx              CREATE
  EyebrowLabel.tsx       CREATE

components/
  ProjectCard.tsx        MODIFY  — PR 2
  Skeleton.tsx           MODIFY  — add ProjectCardSkeleton, ListSkeleton

app/
  _layout.tsx            MODIFY  — load JetBrains Mono + Fraunces 500, mount ThemeProvider
  (tabs)/(home)/
    index.tsx            MODIFY  — PR 3
  (tabs)/settings/
    _layout.tsx          MODIFY  — register Appearance route
    appearance.tsx       CREATE  — Settings → Appearance screen
    index.tsx            MODIFY  — add Appearance nav row
  project-detail.tsx     MODIFY  — PR 4
  onboarding.tsx         MODIFY  — PR 5
  paywall.tsx            MODIFY  — PR 6

package.json             MODIFY  — add @expo-google-fonts/jetbrains-mono
```

---

# PR 1 — Foundation (no visible UI change)

**Branch suggestion:** `phase1-foundation`

The largest PR by code volume, but adds no user-visible UI until later PRs migrate screens. Goal: tokens, theme context, primitives library, Appearance screen.

## Task 1: Add JetBrains Mono font package

**Files:**
- Modify: `package.json`

- [ ] **Step 1:** Add the package via bun

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun add @expo-google-fonts/jetbrains-mono`
Expected: package.json gains `"@expo-google-fonts/jetbrains-mono": "^0.x.x"` in dependencies.

- [ ] **Step 2:** Verify install

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun pm ls | grep jetbrains-mono`
Expected: one line showing `@expo-google-fonts/jetbrains-mono@...` resolved.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add package.json bun.lock
git commit -m "chore: add @expo-google-fonts/jetbrains-mono"
```

## Task 2: Extend `constants/colors.ts` with `Theme` shape and light/dark variants

**Files:**
- Modify: `constants/colors.ts` (append at end, do not modify existing `Colors` export)

- [ ] **Step 1:** Append the `Theme` types and variants at the very end of `constants/colors.ts` (after the `export default { light: {...} }` block):

```ts
// ─────────────────────────────────────────────────────────────────────
// Theme — Phase 1. Two variants (light default, dark opt-in).
//
// Consumers do NOT read from here directly. They call useTheme() from
// contexts/ThemeContext.tsx which returns the resolved palette. Reading
// from Theme.light.* or Theme.dark.* directly bypasses the theme system
// and breaks the dark-mode toggle — don't do it.
// ─────────────────────────────────────────────────────────────────────

export type ThemeColors = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  line: string;
  accent: string;
  accentHot: string;
  accentSoft: string;
  accentLabel: string;
  success: string;
  successSoft: string;
  danger: string;
  info: string;
};

export const Theme: { light: ThemeColors; dark: ThemeColors } = {
  light: {
    bg: '#FBF8F2',
    surface: '#FFFFFF',
    surfaceAlt: '#F4EFE6',
    text: '#2B3038',
    textSecondary: 'rgba(43,48,56,0.6)',
    textMuted: 'rgba(43,48,56,0.4)',
    line: 'rgba(43,48,56,0.12)',
    accent: '#FF6A1A',
    accentHot: '#FF8533',
    accentSoft: 'rgba(255,106,26,0.12)',
    accentLabel: '#C44A0F',
    success: '#2E7D44',
    successSoft: 'rgba(46,125,68,0.12)',
    danger: '#C84038',
    info: '#1565C0',
  },
  dark: {
    bg: '#0B0D10',
    surface: '#14181D',
    surfaceAlt: '#1A1F26',
    text: '#F4EFE6',
    textSecondary: '#9AA3AD',
    textMuted: 'rgba(154,163,173,0.6)',
    line: 'rgba(255,255,255,0.06)',
    accent: '#FF6A1A',
    accentHot: '#FF8533',
    accentSoft: 'rgba(255,106,26,0.16)',
    accentLabel: '#FF6A1A',
    success: '#4ED37A',
    successSoft: 'rgba(78,211,122,0.12)',
    danger: '#FF5A51',
    info: '#4EA7FF',
  },
};
```

- [ ] **Step 2:** Type-check

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit`
Expected: no errors. If errors appear, fix them before continuing.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add constants/colors.ts
git commit -m "feat(tokens): add Theme.{light,dark} palette variants"
```

## Task 3: Extend `constants/typography.ts` with Fraunces + Mono tokens

**Files:**
- Modify: `constants/typography.ts` (append at end of `Type` object before the closing `} as const;`)

- [ ] **Step 1:** Open `constants/typography.ts`, find the line `  } as TextStyle,` immediately before `} as const;`, and insert these new entries just before the closing brace of the `Type` object:

```ts
  // ─── Serif (Fraunces) — display use only. Loaded fonts: Fraunces_500Medium.
  //     fontFamily MUST be 'Fraunces_500Medium' to match the @expo-google-fonts package.
  serifLargeTitle: { fontFamily: 'Fraunces_500Medium', fontSize: 36, lineHeight: 40, letterSpacing: -0.9 } as TextStyle,
  serifTitle:      { fontFamily: 'Fraunces_500Medium', fontSize: 28, lineHeight: 32, letterSpacing: -0.56 } as TextStyle,
  serifHeadline:   { fontFamily: 'Fraunces_500Medium', fontSize: 22, lineHeight: 26, letterSpacing: -0.22 } as TextStyle,

  // ─── Mono (JetBrains Mono) — micro labels, eyebrows, status.
  monoEyebrow: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.54, // 0.14em at 11px
    textTransform: 'uppercase' as const,
  } as TextStyle,
  monoLabel: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.8, // 0.18em at 10px
    textTransform: 'uppercase' as const,
  } as TextStyle,
  monoCaption: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.72, // 0.06em at 12px
  } as TextStyle,
```

- [ ] **Step 2:** Type-check

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add constants/typography.ts
git commit -m "feat(tokens): add Fraunces serif + JetBrains Mono type tokens"
```

## Task 4: Load Fraunces 500 + JetBrains Mono in `app/_layout.tsx`

**Files:**
- Modify: `app/_layout.tsx` (line 4 — `useFonts` import + call)

- [ ] **Step 1:** Replace the existing import line:

```ts
// FROM:
import { useFonts, Fraunces_700Bold, Fraunces_700Bold_Italic } from "@expo-google-fonts/fraunces";
```

```ts
// TO:
import { useFonts, Fraunces_500Medium, Fraunces_700Bold, Fraunces_700Bold_Italic } from "@expo-google-fonts/fraunces";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
```

- [ ] **Step 2:** Find the `useFonts({...})` call (search for `useFonts(` in the file) and extend its argument map to include the new fonts:

```ts
// Before:
const [fontsLoaded] = useFonts({ Fraunces_700Bold, Fraunces_700Bold_Italic });

// After:
const [fontsLoaded] = useFonts({
  Fraunces_500Medium,
  Fraunces_700Bold,
  Fraunces_700Bold_Italic,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
});
```

If the existing call is structured differently, preserve the existing entries and add the four new ones.

- [ ] **Step 3:** Type-check

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4:** Smoke test font loading

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
Open the printed URL in the browser. Expected: the app boots without a `Font not found` warning. Splash screen → home screen, no font fallbacks visible.

Press `Ctrl+C` to stop.

- [ ] **Step 5:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add app/_layout.tsx
git commit -m "feat: load Fraunces 500 + JetBrains Mono fonts"
```

## Task 5: Create `contexts/ThemeContext.tsx`

**Files:**
- Create: `contexts/ThemeContext.tsx`

- [ ] **Step 1:** Create the file with the full provider:

```ts
// ThemeContext — Phase 1 theme system.
//
// Persists the user's theme preference (light / dark / system) to
// AsyncStorage and exposes the resolved palette via useTheme(). All
// new UI components consume this — they MUST NOT import `Theme.light`
// or `Theme.dark` directly from constants/colors, because that would
// bypass the toggle.
//
// Default for new installs: 'light'. Deliberate, opinionated default;
// matches the marketing site's primary appearance.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Appearance } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { Theme, type ThemeColors } from '@/constants/colors';

const STORAGE_KEY = 'mageid_theme';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref === 'system') {
    const sys = Appearance.getColorScheme();
    return sys === 'dark' ? 'dark' : 'light';
  }
  return pref;
}

export const [ThemeProvider, useTheme] = createContextHook(() => {
  const [pref, setPrefState] = useState<ThemePref>('light');
  const [resolved, setResolved] = useState<ResolvedTheme>('light');

  // Hydrate stored preference on mount.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'light' || v === 'dark' || v === 'system') {
        setPrefState(v);
        setResolved(resolve(v));
      }
    });
  }, []);

  // When pref is 'system', re-resolve on OS appearance change.
  useEffect(() => {
    if (pref !== 'system') {
      setResolved(resolve(pref));
      return;
    }
    setResolved(resolve('system'));
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setResolved(colorScheme === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, [pref]);

  const setPref = useCallback(async (p: ThemePref) => {
    setPrefState(p);
    await AsyncStorage.setItem(STORAGE_KEY, p);
  }, []);

  const colors: ThemeColors = useMemo(() => Theme[resolved], [resolved]);

  return useMemo(
    () => ({ pref, resolved, colors, setPref }),
    [pref, resolved, colors, setPref],
  );
});
```

- [ ] **Step 2:** Type-check

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add contexts/ThemeContext.tsx
git commit -m "feat: add ThemeContext (light default, dark opt-in, system follow)"
```

## Task 6: Create `hooks/useThemedStyles.ts`

**Files:**
- Create: `hooks/useThemedStyles.ts`

- [ ] **Step 1:** Create the file:

```ts
// useThemedStyles — pattern for components to consume themed styles.
//
// Usage:
//   const styles = useThemedStyles(makeStyles);
//   const makeStyles = (t: ThemeColors) => StyleSheet.create({ ... });
//
// Memoized per resolved theme. Re-runs only when the theme changes.

import { useMemo } from 'react';
import type { StyleSheet } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';

type StyleFactory<T> = (theme: ThemeColors) => T;

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: StyleFactory<T>,
): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
```

- [ ] **Step 2:** Type-check

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add hooks/useThemedStyles.ts
git commit -m "feat: add useThemedStyles hook"
```

## Task 7: Mount `ThemeProvider` in `app/_layout.tsx`

**Files:**
- Modify: `app/_layout.tsx`

- [ ] **Step 1:** Add the import near the other context provider imports (line ~15 area):

```ts
import { ThemeProvider } from "@/contexts/ThemeContext";
```

- [ ] **Step 2:** Find the provider stack (`<QueryClientProvider>...<GestureHandlerRootView>...<AuthProvider>` block) and wrap `AuthProvider` (and everything below it) with `<ThemeProvider>`. Per the spec, ThemeProvider sits **above** AuthProvider but **below** GestureHandlerRootView. The resulting structure should look like:

```tsx
<QueryClientProvider client={queryClient}>
  <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider>
      <AuthProvider>
        {/* ... existing nested providers ... */}
      </AuthProvider>
    </ThemeProvider>
  </GestureHandlerRootView>
</QueryClientProvider>
```

If a `ThemeLoader` already exists in the stack, place `ThemeProvider` immediately inside it (so legacy theme load runs first, then this provider).

- [ ] **Step 3:** Type-check

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4:** Smoke test app boots

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
Expected: app boots to the home screen, no console errors about a missing provider.

Press `Ctrl+C` to stop.

- [ ] **Step 5:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add app/_layout.tsx
git commit -m "feat: mount ThemeProvider in root layout"
```

## Task 8: Create `components/ui/Button.tsx`

**Files:**
- Create: `components/ui/Button.tsx`

- [ ] **Step 1:** Create the file:

```tsx
// Button — primary primitive for actions. Phase 1 design system.
//
// Variants:  primary | secondary | ghost | destructive
// Sizes:     sm | md | lg
//
// Bakes in: theme-aware colors, continuous corners, haptic on press
// (iOS only), spring scale on press, disabled state, loading state.
//
// Consumers must NOT pass `style` overrides for color/background; that's
// the point of the primitive. Use a different variant if the existing
// ones don't fit.

import React, { useRef } from 'react';
import {
  Pressable,
  Text,
  StyleSheet,
  Animated,
  ActivityIndicator,
  View,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  iconLeft?: React.ReactNode;
  iconRight?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZE_MAP: Record<ButtonSize, { height: number; px: number; fontSize: number }> = {
  sm: { height: 36, px: 16, fontSize: 13 },
  md: { height: Tokens.touchTarget.comfortable, px: 24, fontSize: 14 },
  lg: { height: 56, px: 28, fontSize: 15 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  iconLeft,
  iconRight,
  fullWidth = false,
  style,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scale = useRef(new Animated.Value(1)).current;

  const sz = SIZE_MAP[size];
  const isDisabled = disabled || loading;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.97,
      useNativeDriver: true,
      ...Tokens.motion.spring.snap,
    }).start();
  };
  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      ...Tokens.motion.spring.snap,
    }).start();
  };
  const handlePress = () => {
    if (Platform.OS === 'ios') {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress();
  };

  const containerStyle: StyleProp<ViewStyle> = [
    styles.base,
    styles[variant],
    { height: sz.height, paddingHorizontal: sz.px },
    fullWidth && styles.fullWidth,
    isDisabled && styles.disabled,
    style,
  ];

  const textColor =
    variant === 'primary' || variant === 'destructive'
      ? '#FFFFFF'
      : colors.text;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={isDisabled}
        style={containerStyle}
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
      >
        {loading ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <View style={styles.row}>
            {iconLeft ? <View style={styles.iconLeft}>{iconLeft}</View> : null}
            <Text style={[styles.label, { fontSize: sz.fontSize, color: textColor }]}>
              {label}
            </Text>
            {iconRight ? <View style={styles.iconRight}>{iconRight}</View> : null}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    base: {
      borderRadius: Tokens.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      ...Tokens.continuousCorners,
    },
    primary: {
      backgroundColor: t.accent,
      shadowColor: t.accent,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.25,
      shadowRadius: 16,
      elevation: 4,
    },
    secondary: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
    },
    ghost: {
      backgroundColor: 'transparent',
    },
    destructive: {
      backgroundColor: t.danger,
    },
    fullWidth: { width: '100%' },
    disabled: { opacity: 0.5 },
    label: {
      fontWeight: '600' as const,
      letterSpacing: -0.15,
    },
    row: { flexDirection: 'row', alignItems: 'center' },
    iconLeft: { marginRight: 8 },
    iconRight: { marginLeft: 8 },
  });

export default Button;
```

- [ ] **Step 2:** Type-check

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit`
Expected: no errors. If `expo-haptics` import fails, install it: `bun add expo-haptics` (it's already in package.json — should resolve).

- [ ] **Step 3:** Lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run lint`
Expected: clean.

- [ ] **Step 4:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add components/ui/Button.tsx
git commit -m "feat(ui): add Button primitive (variants, sizes, haptics)"
```

## Task 9: Create `components/ui/EyebrowLabel.tsx`

**Files:**
- Create: `components/ui/EyebrowLabel.tsx`

- [ ] **Step 1:** Create the file:

```tsx
// EyebrowLabel — the recurring "dot + mono-uppercase" pattern.
//
// Used above section titles, in card headers, in screen eyebrows.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

interface Props {
  children: string;
  tone?: 'amber' | 'success' | 'neutral';
  showDot?: boolean;
}

export function EyebrowLabel({ children, tone = 'amber', showDot = true }: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const color =
    tone === 'amber' ? colors.accentLabel :
    tone === 'success' ? colors.success :
    colors.textSecondary;

  return (
    <View style={styles.row}>
      {showDot ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <Text style={[Type.monoEyebrow, { color }]}>{children}</Text>
    </View>
  );
}

const makeStyles = (_t: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    dot: { width: 5, height: 5, borderRadius: 999 },
  });

export default EyebrowLabel;
```

- [ ] **Step 2:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add components/ui/EyebrowLabel.tsx
git commit -m "feat(ui): add EyebrowLabel primitive"
```

## Task 10: Create `components/ui/Card.tsx`

**Files:**
- Create: `components/ui/Card.tsx`

- [ ] **Step 1:** Create the file:

```tsx
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
```

- [ ] **Step 2:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add components/ui/Card.tsx
git commit -m "feat(ui): add Card primitive with Label/Title/Meta slots"
```

## Task 11: Create `components/ui/Badge.tsx`

**Files:**
- Create: `components/ui/Badge.tsx`

- [ ] **Step 1:** Create the file:

```tsx
// Badge — small status pill (mono uppercase + soft tinted bg).

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';

export type BadgeTone = 'success' | 'warn' | 'info' | 'danger' | 'neutral';

interface Props {
  children: string;
  tone?: BadgeTone;
  dot?: boolean;
}

function tonePalette(t: ThemeColors, tone: BadgeTone) {
  switch (tone) {
    case 'success': return { fg: t.success, bg: t.successSoft, border: t.success + '33' };
    case 'warn':    return { fg: t.accentLabel, bg: t.accentSoft, border: t.accent + '40' };
    case 'info':    return { fg: t.info, bg: t.info + '1F', border: t.info + '33' };
    case 'danger':  return { fg: t.danger, bg: t.danger + '1F', border: t.danger + '33' };
    case 'neutral':
    default:        return { fg: t.textSecondary, bg: t.surfaceAlt, border: t.line };
  }
}

export function Badge({ children, tone = 'neutral', dot = false }: Props) {
  const { colors } = useTheme();
  const p = tonePalette(colors, tone);
  return (
    <View style={[styles.pill, { backgroundColor: p.bg, borderColor: p.border }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: p.fg }]} /> : null}
      <Text style={[Type.monoLabel, { color: p.fg }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
    ...Tokens.continuousCorners,
  },
  dot: { width: 5, height: 5, borderRadius: 999 },
});

export default Badge;
```

- [ ] **Step 2:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add components/ui/Badge.tsx
git commit -m "feat(ui): add Badge primitive"
```

## Task 12: Create `components/ui/Input.tsx`

**Files:**
- Create: `components/ui/Input.tsx`

- [ ] **Step 1:** Create the file:

```tsx
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
      fontSize: 17,
      ...Tokens.continuousCorners,
    },
  });

export default Input;
```

- [ ] **Step 2:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add components/ui/Input.tsx
git commit -m "feat(ui): add Input primitive"
```

## Task 13: Create Settings → Appearance screen

**Files:**
- Create: `app/(tabs)/settings/appearance.tsx`
- Modify: `app/(tabs)/settings/_layout.tsx`
- Modify: `app/(tabs)/settings/index.tsx` (add a nav row pointing to `/settings/appearance`)

- [ ] **Step 1:** Create `app/(tabs)/settings/appearance.tsx`:

```tsx
import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, type ThemePref } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { EyebrowLabel } from '@/components/ui/EyebrowLabel';
import type { ThemeColors } from '@/constants/colors';

const OPTIONS: { value: ThemePref; label: string; helper: string }[] = [
  { value: 'light', label: 'Light', helper: 'Cream/paper background. Default.' },
  { value: 'dark', label: 'Dark', helper: 'Ink/amber. Matches the marketing site.' },
  { value: 'system', label: 'System', helper: 'Follow iOS appearance setting.' },
];

export default function Appearance() {
  const { pref, setPref, colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Appearance' }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <EyebrowLabel>Theme</EyebrowLabel>
          <Text style={[Type.serifTitle, { color: colors.text, marginTop: 4 }]}>Appearance</Text>
          <Text style={[Type.subhead, { color: colors.textSecondary, marginTop: 6 }]}>
            Choose how MAGE ID looks. Changes apply instantly.
          </Text>
        </View>

        <View style={styles.list}>
          {OPTIONS.map((opt) => {
            const selected = pref === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setPref(opt.value)}
                style={[
                  styles.row,
                  selected && { borderColor: colors.accent, backgroundColor: colors.accentSoft },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[Type.bodyEmphasized, { color: colors.text }]}>{opt.label}</Text>
                  <Text style={[Type.footnote, { color: colors.textSecondary, marginTop: 2 }]}>
                    {opt.helper}
                  </Text>
                </View>
                <View
                  style={[
                    styles.radio,
                    { borderColor: selected ? colors.accent : colors.line },
                  ]}
                >
                  {selected ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    scroll: { padding: Tokens.spacing.md, gap: Tokens.spacing.lg },
    header: { gap: 0 },
    list: { gap: Tokens.spacing.sm, marginTop: Tokens.spacing.md },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.md,
      padding: Tokens.spacing.md,
      backgroundColor: t.surface,
      borderRadius: Tokens.radius.lg,
      borderWidth: 1,
      borderColor: t.line,
      ...Tokens.continuousCorners,
    },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 999,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioDot: { width: 10, height: 10, borderRadius: 999 },
  });
```

- [ ] **Step 2:** Open `app/(tabs)/settings/_layout.tsx` and register the new route. Add a `<Stack.Screen name="appearance" />` line if `_layout` uses a `Stack` (most Expo Router layouts do). If `_layout` doesn't use Stack screens (e.g., it uses tabs instead), this step is a no-op for typed routes since Expo Router auto-discovers `appearance.tsx` — but verify by opening the file:

```bash
cat "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/app/(tabs)/settings/_layout.tsx"
```

If it's a `<Stack>`, add inside:

```tsx
<Stack.Screen name="appearance" options={{ title: 'Appearance' }} />
```

If it's `<Slot />` or something else, no change needed — `appearance.tsx` is auto-routed.

- [ ] **Step 3:** Open `app/(tabs)/settings/index.tsx` and add a row that navigates to `/settings/appearance`. Read the file first to see the existing nav-row pattern. Add a new row that matches existing styling. The basic call is:

```tsx
import { useRouter } from 'expo-router';
const router = useRouter();
// ...
<Pressable onPress={() => router.push('/(tabs)/settings/appearance')}>
  <Text>Appearance</Text>
</Pressable>
```

Replace this with the existing nav-row component pattern in that file (e.g., a `NavRow` component). The label should read "Appearance" and the trailing meta should show the current theme name (`useTheme().pref`).

- [ ] **Step 4:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 5:** Smoke test the appearance screen end-to-end

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
- Navigate to Settings → Appearance.
- Tap Dark. Verify the Appearance screen itself turns dark (ink bg, cream text, amber selected pill).
- Tap System. Verify it follows OS preference if changed.
- Tap Light. Verify it returns to cream/paper.
- Close + reopen the app. Verify the theme persisted.

`Ctrl+C` to stop.

- [ ] **Step 6:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add app/\(tabs\)/settings/appearance.tsx app/\(tabs\)/settings/_layout.tsx app/\(tabs\)/settings/index.tsx
git commit -m "feat: add Settings → Appearance screen with theme toggle"
```

## Task 14: Token audit on legacy primitives (IconButton, StatusPill, NavRow)

The spec calls these out as "stay but get rewritten internally to use new tokens." Their public APIs don't change, only the internal color references.

**Files:**
- Modify: `components/IconButton.tsx`
- Modify: `components/StatusPill.tsx`
- Modify: `components/NavRow.tsx`

- [ ] **Step 1:** Open `components/IconButton.tsx`. Find every `Colors.surface`, `Colors.text`, `Colors.textSecondary`, `Colors.border`, `Colors.primary`, `Colors.fillSecondary`, etc. Add at the top of the component body:

```ts
const { colors } = useTheme();
const styles = useThemedStyles(makeStyles);
```

Add imports:
```ts
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
```

Convert `const styles = StyleSheet.create({...})` at the bottom to `const makeStyles = (t: ThemeColors) => StyleSheet.create({...})`. Use the canonical Colors → t mapping in Task 16 step 3.

Keep the component's exported props identical — don't change the API.

- [ ] **Step 2:** Same migration on `components/StatusPill.tsx`. (Note: in PR 2 the ProjectCard replaces its inline status pill with the new `Badge` primitive, but other screens may still import `StatusPill`. Keep its API stable.)

- [ ] **Step 3:** Same migration on `components/NavRow.tsx`.

- [ ] **Step 4:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 5:** Smoke

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
Open Settings (which uses NavRow) — switch between Light and Dark mode. Verify NavRows render correctly in both. Verify IconButton instances around the app (top-bars, action buttons) look correct in both themes.

`Ctrl+C` to stop.

- [ ] **Step 6:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add components/IconButton.tsx components/StatusPill.tsx components/NavRow.tsx
git commit -m "feat(ui): migrate IconButton, StatusPill, NavRow to themed styles"
```

## Task 15: Final PR 1 smoke + open the PR

- [ ] **Step 1:** Full type check + lint pass

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 2:** Manual smoke

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
- App boots
- Home tab looks identical to before (no migration yet)
- Settings → Appearance works in all three modes
- Switch to Dark, navigate back to Home — Home is unchanged (still uses legacy `Colors.*`) but Appearance screen is dark
- No console errors

- [ ] **Step 3:** Open PR (optional — if working in branch)

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
gh pr create --title "Phase 1 PR 1: theme system + primitives foundation" --body "$(cat <<'EOF'
## Summary
- New `Theme.{light,dark}` palette in constants/colors.ts
- New Fraunces + JetBrains Mono type tokens
- New `ThemeContext` with light default, dark/system options, persisted to AsyncStorage
- New primitives library at `components/ui/`: Button, Card, Input, Badge, EyebrowLabel
- New Settings → Appearance screen
- No legacy screens migrated yet — those follow in subsequent PRs

## Test plan
- [ ] App boots cleanly
- [ ] Settings → Appearance toggles between Light / Dark / System
- [ ] Theme persists across app restarts
- [ ] All existing screens render identically (no regressions)
- [ ] Type check + lint clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# PR 2 — ProjectCard migration

**Branch suggestion:** `phase1-projectcard`

Migrates `components/ProjectCard.tsx` to use the new tokens + theme + primitives. High impact because ProjectCard appears in ~12 places (home, search results, project picker, dashboard).

## Task 16: Refactor `components/ProjectCard.tsx` to themed styles

**Files:**
- Modify: `components/ProjectCard.tsx`

- [ ] **Step 1:** At the top of `components/ProjectCard.tsx`, add the imports:

```ts
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { EyebrowLabel } from '@/components/ui/EyebrowLabel';
import { Badge } from '@/components/ui/Badge';
import type { ThemeColors } from '@/constants/colors';
```

- [ ] **Step 2:** Inside the `ProjectCard` component function (after `const IconComponent = ...`), add:

```ts
const { colors } = useTheme();
const styles = useThemedStyles(makeStyles);
```

- [ ] **Step 3:** Replace the `const styles = StyleSheet.create({...})` at the bottom with `const makeStyles = (t: ThemeColors) => StyleSheet.create({...})`, and swap every `Colors.*` reference inside it to use `t.*`. **Canonical Colors → t mapping (use this for every migrated file in this plan):**
  - `Colors.background` → `t.bg`
  - `Colors.surface` → `t.surface`
  - `Colors.surfaceAlt` → `t.surfaceAlt`
  - `Colors.cardBorder` → `t.line`
  - `Colors.border` → `t.line`
  - `Colors.borderLight` → `t.line`
  - `Colors.fillTertiary` → `t.line`
  - `Colors.fillSecondary` → `t.surfaceAlt`
  - `Colors.primary` → `t.accent`
  - `Colors.primaryLight` → `t.accentHot`
  - `Colors.primaryDark` → `t.accentLabel`
  - `Colors.accent` → `t.accent`
  - `Colors.text` → `t.text`
  - `Colors.textSecondary` → `t.textSecondary`
  - `Colors.textMuted` → `t.textMuted`
  - `Colors.success` / `Colors.successDark` → `t.success`
  - `Colors.successLight` → `t.successSoft`
  - `Colors.warning` → `t.accent` (amber doubles as warning here)
  - `Colors.warningLight` / `Colors.warningDark` → `t.accentSoft` / `t.accentLabel`
  - `Colors.error` / `Colors.errorDark` → `t.danger`
  - `Colors.info` / `Colors.infoDark` → `t.info`

- [ ] **Step 4:** Replace the project name text style. Find:

```tsx
<Text style={styles.name} numberOfLines={1}>{project.name}</Text>
```

And replace with:

```tsx
<Text style={[Type.serifHeadline, { color: colors.text }]} numberOfLines={1}>{project.name}</Text>
```

Then remove the `name` entry from `makeStyles` (it's no longer used).

- [ ] **Step 5:** Replace the legacy status pill JSX (`<View style={[styles.statusDot, ...]}>...`) with the new `Badge` primitive. Tone map: `draft → warn`, `estimated → success`, `in_progress → info`, `completed → warn`, `closed → neutral`. Replace:

```tsx
<View style={[styles.statusDot, { backgroundColor: status.color + '20' }]}>
  <View style={[styles.statusDotInner, { backgroundColor: status.color }]} />
  <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
</View>
```

With:

```tsx
<Badge tone={STATUS_BADGE_TONE[project.status] ?? 'neutral'} dot>{status.label}</Badge>
```

And add at the top of the file (alongside `STATUS_CONFIG`):

```ts
const STATUS_BADGE_TONE: Record<string, 'success' | 'warn' | 'info' | 'danger' | 'neutral'> = {
  draft: 'warn',
  estimated: 'success',
  in_progress: 'info',
  completed: 'warn',
  closed: 'neutral',
};
```

- [ ] **Step 6:** Update the `iconWrap` background to use `t.accentSoft` instead of `Colors.primary + '12'`, and update the icon `color` prop to `colors.accent`:

```tsx
<View style={styles.iconWrap}>
  <IconComponent size={20} color={colors.accent} strokeWidth={1.8} />
</View>
```

In `makeStyles`:
```ts
iconWrap: {
  width: 42,
  height: 42,
  borderRadius: Tokens.radius.card,
  backgroundColor: t.accentSoft,
  alignItems: 'center',
  justifyContent: 'center',
},
```

- [ ] **Step 7:** Update the burn bar fill color. Find:

```tsx
backgroundColor: burnIsHigh ? Colors.warning : Colors.primary,
```

Replace with:

```tsx
backgroundColor: burnIsHigh ? colors.danger : colors.accent,
```

- [ ] **Step 8:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 9:** Visual smoke

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
- Navigate to Home — ProjectCards should now render with Fraunces title, mono badge, amber accent, white card on cream bg
- Toggle dark mode in Settings → Appearance — ProjectCards should render with cream title, steel card on ink bg
- Toggle back to light
- Long-press still works, navigation still works

`Ctrl+C` to stop.

- [ ] **Step 10:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add components/ProjectCard.tsx
git commit -m "feat(ui): migrate ProjectCard to themed primitives"
```

## Task 17: Add `ProjectCardSkeleton`

**Files:**
- Modify: `components/Skeleton.tsx`

- [ ] **Step 1:** Update the `SkeletonCard` exported function in `components/Skeleton.tsx` to use themed colors. Add the imports at the top:

```ts
import { useTheme } from '@/contexts/ThemeContext';
```

Then inside `SkeletonCard`, replace the hardcoded `Colors.surface` / `Colors.cardBorder` / `Colors.fillTertiary` with theme tokens:

```ts
export function SkeletonCard({ style }: { style?: ViewStyle }) {
  const opacity = useSharedShimmer();
  const { colors } = useTheme();
  return (
    <View style={[cardStyles.card, { backgroundColor: colors.surface, borderColor: colors.line }, style]}>
      <View style={cardStyles.row}>
        <Animated.View style={[cardStyles.icon, { opacity, backgroundColor: colors.line }]} />
        <View style={cardStyles.title}>
          <Animated.View style={[cardStyles.lineLong, { opacity, backgroundColor: colors.line }]} />
          <Animated.View style={[cardStyles.lineShort, { opacity, backgroundColor: colors.line }]} />
        </View>
        <Animated.View style={[cardStyles.pill, { opacity, backgroundColor: colors.line }]} />
      </View>
      <View style={[cardStyles.divider, { backgroundColor: colors.line }]} />
      <View style={cardStyles.metaRow}>
        <Animated.View style={[cardStyles.metaBlock, { opacity, backgroundColor: colors.line }]} />
        <Animated.View style={[cardStyles.metaBlock, { opacity, backgroundColor: colors.line }]} />
        <Animated.View style={[cardStyles.metaBlock, { opacity, backgroundColor: colors.line }]} />
      </View>
    </View>
  );
}
```

(Same for `SkeletonRow` and `Skeleton` — let the consumer pass `backgroundColor` via style, with `colors.line` as a sane default. Use `useTheme()` inside each component for the default.)

Add a new export `ListSkeleton`:

```ts
export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </>
  );
}
```

- [ ] **Step 2:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 3:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add components/Skeleton.tsx
git commit -m "feat: themed Skeleton + new ListSkeleton helper"
```

---

# PR 3 — Home tab migration

**Branch suggestion:** `phase1-home`

## Task 18: Migrate `app/(tabs)/(home)/index.tsx`

**Files:**
- Modify: `app/(tabs)/(home)/index.tsx`

- [ ] **Step 1:** Read the file to understand current structure:

```bash
cat "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/app/(tabs)/(home)/index.tsx"
```

- [ ] **Step 2:** Add imports at the top:

```ts
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { EyebrowLabel } from '@/components/ui/EyebrowLabel';
import { ListSkeleton } from '@/components/Skeleton';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
```

- [ ] **Step 3:** Inside the screen component, add:

```ts
const { colors } = useTheme();
const styles = useThemedStyles(makeStyles);
```

- [ ] **Step 4:** Replace any `style={{ backgroundColor: Colors.background }}` or hardcoded screen bg with `{ backgroundColor: colors.bg }`.

- [ ] **Step 5:** Find the screen header (typically a `<View><Text style={Type.largeTitle}>Your Projects</Text></View>` block). Replace with:

```tsx
<View style={styles.header}>
  <EyebrowLabel>Your Projects</EyebrowLabel>
  <Text style={[Type.serifLargeTitle, { color: colors.text, marginTop: 4 }]}>
    Active builds
  </Text>
</View>
```

(Replace the inner copy with whatever the existing header text was — the structure is what matters.)

- [ ] **Step 6:** If the screen has a list of projects backed by `useQuery` or similar, wrap the empty/loading state with `ListSkeleton`:

```tsx
{isLoading ? <ListSkeleton count={3} /> : (
  <FlatList /* or ScrollView */ data={projects} renderItem={...} />
)}
```

- [ ] **Step 7:** Convert `StyleSheet.create({...})` to `makeStyles = (t: ThemeColors) => StyleSheet.create({...})` and swap `Colors.*` for `t.*` everywhere (see Task 16 step 3 for the mapping).

- [ ] **Step 8:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 9:** Manual smoke

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
- Home tab renders correctly in light mode (cream bg, Fraunces title, ProjectCards beneath)
- Toggle dark mode — entire home tab inverts correctly
- Loading state shows skeleton

- [ ] **Step 10:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add app/\(tabs\)/\(home\)/index.tsx
git commit -m "feat(ui): migrate Home tab to themed design system"
```

---

# PR 4 — Project Detail migration

**Branch suggestion:** `phase1-project-detail`

## Task 19: Migrate `app/project-detail.tsx`

**Files:**
- Modify: `app/project-detail.tsx`

This is the largest single-file migration. The screen uses a tile-grid + modal-in-screen pattern.

- [ ] **Step 1:** Read the file — at least skim the top 200 lines and the StyleSheet block at the bottom — to understand the tile-group structure (Field / Money / Docs / People):

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && wc -l app/project-detail.tsx
```

If it's a very large file (>800 lines), break the migration into smaller commits per tile group rather than one big commit.

- [ ] **Step 2:** Add the same imports as in Task 18 step 2 (`useTheme`, `useThemedStyles`, `EyebrowLabel`, `Type`, `ThemeColors`).

- [ ] **Step 3:** Add the `Card` primitive import:

```ts
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
```

- [ ] **Step 4:** Replace the screen header (project name + status) with:

```tsx
<View style={styles.header}>
  <EyebrowLabel>Project · {project.status === 'in_progress' ? 'In Progress' : project.status}</EyebrowLabel>
  <Text style={[Type.serifLargeTitle, { color: colors.text, marginTop: 4 }]}>
    {project.name}
  </Text>
  <Text style={[Type.monoCaption, { color: colors.textMuted, marginTop: 6 }]}>
    {project.squareFootage > 0 ? `${project.squareFootage.toLocaleString()} sf` : ''}
    {project.type ? ` · ${project.type}` : ''}
  </Text>
</View>
```

- [ ] **Step 5:** For each tile inside the four tile groups, wrap the tile JSX in `<Card pressable onPress={...}>` and use `<Card.Label>` / `<Card.Title>` / `<Card.Meta>` for the structure. Example before:

```tsx
<TouchableOpacity onPress={openContract} style={styles.tile}>
  <View style={styles.tileHeader}>
    <Text style={styles.tileLabel}>Contract</Text>
  </View>
  <Text style={styles.tileTitle}>Signed</Text>
  <Text style={styles.tileMeta}>$511,863</Text>
</TouchableOpacity>
```

Becomes:

```tsx
<Card pressable onPress={openContract} testID="tile-contract">
  <Card.Label>Contract</Card.Label>
  <Card.Title>Signed</Card.Title>
  <Card.Meta>$511,863</Card.Meta>
  <Badge tone="success" dot>Active</Badge>
</Card>
```

Do this for every tile in every tile group. Group tiles together using `Tokens.spacing.sm` gap.

- [ ] **Step 6:** Replace any primary action buttons (e.g., "Mark Closed", "Send Invoice") with the new `Button` primitive:

```tsx
<Button variant="primary" label="Send invoice" onPress={handleSend} />
<Button variant="secondary" label="Save draft" onPress={handleSave} />
```

- [ ] **Step 7:** Convert `StyleSheet.create({...})` to `makeStyles = (t: ThemeColors) => StyleSheet.create({...})` and swap `Colors.*` for `t.*`.

- [ ] **Step 8:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 9:** Manual smoke — open the seeded "Henderson Residence" project

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
- Navigate Home → Henderson Residence
- All four tile groups render (Field, Money, Docs, People)
- Each tile opens its modal correctly
- Status badges look right
- Toggle to dark mode — entire screen inverts cleanly
- No layout collapses or missing colors

- [ ] **Step 10:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add app/project-detail.tsx
git commit -m "feat(ui): migrate Project Detail screen to themed primitives"
```

---

# PR 5 — Onboarding migration

**Branch suggestion:** `phase1-onboarding`

## Task 20: Migrate `app/onboarding.tsx`

**Files:**
- Modify: `app/onboarding.tsx`

- [ ] **Step 1:** Read the file to understand the slide structure:

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && wc -l app/onboarding.tsx
```

- [ ] **Step 2:** Add imports (same as Task 18 step 2-3).

- [ ] **Step 3:** For each onboarding slide title, replace the existing `Fraunces_700Bold` usage (the file already uses Fraunces — verify on line ~522 per the audit) with the new `Type.serifLargeTitle` token:

```tsx
<Text style={[Type.serifLargeTitle, { color: colors.text, textAlign: 'center' }]}>
  Slide title here
</Text>
```

- [ ] **Step 4:** Replace the "Get Started" / "Next" CTA buttons with the new `Button` primitive (`variant="primary"`, `size="lg"`).

- [ ] **Step 5:** Use `EyebrowLabel` for the step indicator ("Step 1 of 7" or whatever the current pattern is).

- [ ] **Step 6:** Convert `StyleSheet` to themed.

- [ ] **Step 7:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 8:** Manual smoke

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
- If signed in, sign out to trigger onboarding (or call the dev wipe per `LAUNCH.md` Block A)
- Sign up with a fresh email → onboarding carousel
- All 7 slides render with Fraunces titles, amber CTAs
- Toggle dark mode mid-onboarding → slides invert

- [ ] **Step 9:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add app/onboarding.tsx
git commit -m "feat(ui): migrate onboarding to themed design system"
```

---

# PR 6 — Paywall migration

**Branch suggestion:** `phase1-paywall`

## Task 21: Migrate `app/paywall.tsx`

**Files:**
- Modify: `app/paywall.tsx`

- [ ] **Step 1:** Read the file to understand tier card layout:

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && wc -l app/paywall.tsx
```

- [ ] **Step 2:** Same imports as Task 18.

- [ ] **Step 3:** Hero copy: replace the screen title with `Type.serifLargeTitle`. Use `EyebrowLabel` for "Pricing" or "Upgrade" eyebrow.

- [ ] **Step 4:** Wrap each tier card (Free / Pro / Business / Enterprise) in `<Card>`:

```tsx
<Card>
  <Card.Label>Pro</Card.Label>
  <Card.Title>$29 / month</Card.Title>
  <Card.Meta>For solo GCs and small crews</Card.Meta>
  {/* feature list */}
  <Button variant="primary" label="Start Pro" fullWidth onPress={() => handleSelect('pro')} />
</Card>
```

The "recommended" tier (typically Business) should have a `borderColor: colors.accent` highlight — pass via the `style` prop.

- [ ] **Step 5:** Replace any inline `Colors.primary` (green CTA) with `colors.accent` (amber).

- [ ] **Step 6:** Convert `StyleSheet` to themed.

- [ ] **Step 7:** Type-check + lint

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && npx tsc --noEmit && bun run lint`
Expected: clean.

- [ ] **Step 8:** Manual smoke

Run: `cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && bun run start-web`
- Trigger paywall (e.g., as free user, try to access a Pro-gated feature)
- Tier cards render with Fraunces price, amber CTAs
- "Start Pro" button has the amber pill shadow + haptic on iOS
- Toggle to dark mode → paywall stays sharp
- Cancel button works

- [ ] **Step 9:** Commit

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add app/paywall.tsx
git commit -m "feat(ui): migrate paywall to themed design system"
```

---

# After PR 6

## Task 22: Phase 1 wrap-up

- [ ] **Step 1:** Track unmigrated screens

Create `docs/superpowers/plans/migration-checklist.md` with a list of every file under `app/**/*.tsx` that still uses `Colors.primary` or hardcoded `#fff`/`#000` colors. Each migrated screen ticks an item off the list. Use this command to seed the list:

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE" && \
  grep -rl "Colors\.primary\|Colors\.surface\|Colors\.text " app/ components/ \
  | grep -v "node_modules" \
  | sort > /tmp/unmigrated.txt && cat /tmp/unmigrated.txt
```

Use the output to populate the checklist file.

- [ ] **Step 2:** Final full-app smoke + verify dark mode toggle works on every migrated surface

- [ ] **Step 3:** Commit the checklist

```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
git add docs/superpowers/plans/migration-checklist.md
git commit -m "docs: phase 1.5 migration checklist for remaining screens"
```

---

# Self-review checks

After every PR, run:
```bash
cd "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE"
npx tsc --noEmit && bun run lint
```

After PR 6:
- All 6 hero screens render correctly in both themes
- No regressions on unmigrated screens (they still use legacy `Colors.*`)
- Settings → Appearance preserves selection across app restarts
- iOS-only: haptics fire on Button + Card presses (silent on Android/web)
- No console errors, no font fallbacks, no missing icons
