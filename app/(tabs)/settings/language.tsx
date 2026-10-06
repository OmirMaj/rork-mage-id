// Settings → Language. Modelled on settings/appearance.tsx.
//
// Reachable only from the Settings row (handoff patch), which stays hidden
// while i18n/flags.ts LANGUAGE_PICKER_ENABLED is false. The choice is per
// USER: a Spanish-speaking foreman and an English-speaking owner on the same
// job each see their own language; what they send outside goes in the
// recipient's language (i18n/recipient.ts).

import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Redirect, Stack } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { EyebrowLabel } from '@/components/ui/EyebrowLabel';
import type { ThemeColors } from '@/constants/colors';
import { useLanguage, useT } from '@/contexts/LanguageContext';
import { LanguagePicker } from '@/components/LanguagePicker';
import { LANGUAGE_PICKER_ENABLED, PSEUDO_LOCALE_IN_DEV } from '@/i18n/flags';

const SHOW_PSEUDO = typeof __DEV__ !== 'undefined' && __DEV__ && PSEUDO_LOCALE_IN_DEV;

export default function LanguageSettings() {
  // Hidden until the field surfaces are fully in Spanish: a direct /settings/language
  // link must not let someone save 'es' early (resolveLanguage honours a saved
  // choice regardless of the flag). Dev builds keep it reachable for testing.
  if (!LANGUAGE_PICKER_ENABLED && !__DEV__) return <Redirect href="/(tabs)/settings" />;
  return <LanguageSettingsScreen />;
}

function LanguageSettingsScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useT();
  const { lang, setLanguage, pseudo, setPseudo } = useLanguage();
  const insets = useSafeAreaInsets();
  const fabScroll = useBrainFabScroll();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <Stack.Screen options={{ title: t('settings.language.title', 'Language'), headerShown: true }} />
      <ScrollView
        {...fabScroll}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
      >
        <View>
          <EyebrowLabel>{t('settings.language.eyebrow', 'Display')}</EyebrowLabel>
          <Text style={[Type.serifTitle, { color: colors.text, marginTop: 4 }]}>
            {t('settings.language.heading', 'App Language')}
          </Text>
          <Text style={[Type.subhead, { color: colors.textSecondary, marginTop: 6 }]}>
            {t(
              'settings.language.subtitle',
              'Pick the language MAGE ID uses for you on this device. It changes right away. The people you work with keep their own language.',
            )}
          </Text>
        </View>

        <LanguagePicker
          value={lang}
          onChange={setLanguage}
          showPseudo={SHOW_PSEUDO}
          pseudo={pseudo}
          onPseudoChange={setPseudo}
        />

        <View style={styles.notes}>
          <Text style={[Type.footnote, { color: colors.textSecondary }]}>
            {t(
              'settings.language.outboundNote',
              "Texts, emails and portals you send go out in each person's language, not yours.",
            )}
          </Text>
          <Text style={[Type.footnote, { color: colors.textSecondary }]}>
            {t(
              'settings.language.partialNote',
              'Spanish is being added screen by screen. Anything not translated yet shows in English.',
            )}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (_t: ThemeColors) =>
  StyleSheet.create({
    scroll: { padding: Tokens.spacing.md, gap: Tokens.spacing.lg },
    notes: { gap: Tokens.spacing.sm },
  });
