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
      <Stack.Screen options={{ title: 'Appearance', headerShown: true }} />
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
