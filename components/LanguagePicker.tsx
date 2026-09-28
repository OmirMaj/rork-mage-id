// components/LanguagePicker.tsx — English / Español, as a radio list.
//
// Each option is written in ITS OWN language, always ("English" and
// "Español", never "Inglés" / "Spanish"): a person who cannot read the
// current language must still recognise their own. No flags — flags are
// countries, not languages, and Spanish on this app is US / Latin American,
// not Spain (docs/I18N.md §9).
//
// Theme tokens only (useTheme colours, Tokens spacing/radius, Type scale).
// Controlled: the parent owns the value (the language screen passes
// useLanguage()), so the picker can also sit inside a send sheet later for a
// per-recipient choice.

import React from 'react';
import { View, Text, StyleSheet, Pressable, Switch } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import type { Lang } from '@/i18n/types';
import { useT } from '@/contexts/LanguageContext';

/** Endonyms and a helper line in the option's own language. Deliberately not
 *  catalog strings: they must NOT change with the current language. */
export const LANGUAGE_OPTIONS: readonly { value: Lang; label: string; helper: string }[] = [
  { value: 'en', label: 'English', helper: 'Use MAGE ID in English' },
  { value: 'es', label: 'Español', helper: 'Usar MAGE ID en español' },
];

/** The endonym for a language — for a Settings row's value. */
export function languageEndonym(lang: Lang): string {
  return LANGUAGE_OPTIONS.find((o) => o.value === lang)?.label ?? 'English';
}

interface Props {
  value: Lang;
  onChange: (lang: Lang) => void;
  /** Show the dev-only pseudo-locale switch (pass `__DEV__ && …`). */
  showPseudo?: boolean;
  pseudo?: boolean;
  onPseudoChange?: (on: boolean) => void;
  testIDPrefix?: string;
}

export function LanguagePicker({
  value,
  onChange,
  showPseudo = false,
  pseudo = false,
  onPseudoChange,
  testIDPrefix = 'language',
}: Props) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { t } = useT();

  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {LANGUAGE_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              styles.row,
              selected && { borderColor: colors.accent, backgroundColor: colors.accentSoft },
              pressed && !selected && { backgroundColor: colors.surfaceAlt },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
            accessibilityHint={opt.helper}
            accessibilityLanguage={opt.value === 'es' ? 'es-US' : 'en-US'}
            testID={`${testIDPrefix}-option-${opt.value}`}
          >
            <View style={styles.textCol}>
              <Text style={[Type.bodyEmphasized, { color: colors.text }]}>{opt.label}</Text>
              <Text style={[Type.footnote, { color: colors.textSecondary, marginTop: 2 }]}>{opt.helper}</Text>
            </View>
            <View style={[styles.radio, { borderColor: selected ? colors.accent : colors.line }]}>
              {selected ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}
            </View>
          </Pressable>
        );
      })}

      {showPseudo ? (
        <View style={styles.row} testID={`${testIDPrefix}-pseudo`}>
          <View style={styles.textCol}>
            <Text style={[Type.bodyEmphasized, { color: colors.text }]}>
              {t('settings.language.pseudoLabel', 'Pseudo-locale (developer)')}
            </Text>
            <Text style={[Type.footnote, { color: colors.textSecondary, marginTop: 2 }]}>
              {t(
                'settings.language.pseudoHelper',
                'Accents every translated string and pads it 35%. Plain text left on screen was never translated.',
              )}
            </Text>
          </View>
          <Switch
            value={pseudo}
            onValueChange={(on) => onPseudoChange?.(on)}
            trackColor={{ false: colors.line, true: colors.accent }}
            thumbColor={colors.surface}
            ios_backgroundColor={colors.line}
            accessibilityLabel={t('settings.language.pseudoLabel', 'Pseudo-locale (developer)')}
          />
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    list: { gap: Tokens.spacing.sm },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.md,
      padding: Tokens.spacing.md,
      backgroundColor: c.surface,
      borderRadius: Tokens.radius.lg,
      borderWidth: 1,
      borderColor: c.line,
      ...Tokens.continuousCorners,
    },
    textCol: { flex: 1, minWidth: 0 },
    radio: {
      width: 22,
      height: 22,
      borderRadius: Tokens.radius.full,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioDot: { width: 10, height: 10, borderRadius: Tokens.radius.full },
  });

export default LanguagePicker;
