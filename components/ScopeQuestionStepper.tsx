// components/ScopeQuestionStepper.tsx
//
// Presentational, controlled single-step renderer shared by
// app/project-scope.tsx (free capture) and app/estimate-wizard.tsx
// (AI generation). Renders ONE step (card + input) for the given
// answers. Parent owns step index, Back/Next/Skip, and persistence.
// UI is the wizard's original step UI, moved here verbatim so the two
// screens are pixel-identical by construction.

import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Building2, DollarSign, Home, Sparkles, Wrench } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import {
  SCOPE_STEPS, PROJECT_TYPES, QUALITY_LABELS,
  type WizardAnswers, type ScopeStep,
} from '@/utils/scopeQuestions';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const ICONS = {
  building: Building2,
  dollar: DollarSign,
  home: Home,
  sparkles: Sparkles,
  wrench: Wrench,
} as const;

// WizardAnswers keys whose value type is `string` (everything except
// `quality`, which is a union). The numeric / text / textarea inputs
// only ever bind to these, so onChange(key, string) is type-safe
// without a cast once the key is narrowed to this set.
type StringKey = Exclude<keyof WizardAnswers, 'quality'>;

type StylesFor = ReturnType<typeof makeStyles>;

// Extracted to module scope so it isn't re-created on every render
// (react/no-unstable-nested-components). Reproduces the wizard's
// original StepCard body verbatim:
//   <View>
//     <View style={styles.stepIconWrap}>{icon}</View>
//     <Text style={styles.stepTitle}>{title}</Text>
//     <Text style={styles.stepSubtitle}>{subtitle}</Text>
//     <View style={{ marginTop: 16 }}>{children}</View>
//   </View>
function StepCard({
  step,
  styles,
  accent,
  Icon,
  children,
}: {
  step: ScopeStep;
  styles: StylesFor;
  accent: string;
  Icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <View>
      <View style={styles.stepIconWrap}>
        <Icon size={28} color={accent} />
      </View>
      <Text style={styles.stepTitle}>{step.title}</Text>
      <Text style={styles.stepSubtitle}>{step.subtitle}</Text>
      <View style={{ marginTop: 16 }}>{children}</View>
    </View>
  );
}

// Hint labels for numeric steps — mirrors what the wizard renders
// below each numeric input (verbatim from estimate-wizard.tsx).
const NUMERIC_HINTS: Partial<Record<keyof WizardAnswers, string>> = {
  sizeSqft: 'Square feet',
  timelineWeeks: 'Weeks',
  targetBudget: 'Dollars (optional)',
};

export interface ScopeQuestionStepperProps {
  stepIndex: number;
  answers: WizardAnswers;
  onChange: <K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => void;
  testIDPrefix?: string;
}

export function ScopeQuestionStepper({
  stepIndex,
  answers,
  onChange,
  testIDPrefix = 'scope',
}: ScopeQuestionStepperProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const step = SCOPE_STEPS[stepIndex];
  if (!step) return null;

  const Icon = ICONS[step.iconKey];

  // The numeric / text / textarea branches all bind to string-typed
  // keys. `step.key` is `keyof WizardAnswers`; narrowing out the one
  // non-string key (`quality`) via a runtime guard gives us a
  // `StringKey` with no `as` cast — `WizardAnswers[StringKey]` is
  // `string`, so `onChange(stringKey, cleanedString)` type-checks.
  const stringKey: StringKey | null = step.key === 'quality' ? null : step.key;

  const renderInput = () => {
    switch (step.kind) {
      case 'chips':
        // Verbatim from wizard step === 0 JSX.
        return (
          <View style={styles.chipWrap}>
            {PROJECT_TYPES.map((t) => {
              const active = answers.projectType === t;
              return (
                <TouchableOpacity
                  key={t}
                  onPress={() => onChange('projectType', t)}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.8}
                  testID={`${testIDPrefix}-type-${t}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{t}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );

      case 'qualityChips':
        // Verbatim from wizard step === 3 JSX.
        return (
          <View style={styles.chipWrap}>
            {(['budget', 'standard', 'high_end'] as const).map((q) => {
              const active = answers.quality === q;
              return (
                <TouchableOpacity
                  key={q}
                  onPress={() => onChange('quality', q)}
                  style={[styles.chip, active && styles.chipActive]}
                  activeOpacity={0.8}
                  testID={`${testIDPrefix}-quality-${q}`}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {QUALITY_LABELS[q]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        );

      case 'numeric':
        // Verbatim from wizard steps 1 (sizeSqft), 5 (timelineWeeks),
        // and 7 (targetBudget). All strip non-numerics and use a numeric
        // keyboard; hint label comes from NUMERIC_HINTS keyed by step.key.
        if (!stringKey) return null;
        return (
          <>
            <TextInput
              value={answers[stringKey] ?? ''}
              onChangeText={(v) =>
                onChange(stringKey, v.replace(/[^0-9.]/g, ''))
              }
              placeholder={step.placeholder}
              placeholderTextColor={themeColors.textMuted}
              keyboardType="numeric"
              style={styles.input}
              testID={`${testIDPrefix}-${stringKey}`}
            />
            {NUMERIC_HINTS[stringKey] ? (
              <Text style={styles.hint}>{NUMERIC_HINTS[stringKey]}</Text>
            ) : null}
          </>
        );

      case 'text':
        // Verbatim from wizard step === 2 (location).
        if (!stringKey) return null;
        return (
          <TextInput
            value={answers[stringKey] ?? ''}
            onChangeText={(v) => onChange(stringKey, v)}
            placeholder={step.placeholder}
            placeholderTextColor={themeColors.textMuted}
            style={styles.input}
            testID={`${testIDPrefix}-${stringKey}`}
          />
        );

      case 'textarea':
        // Verbatim from wizard steps 4 (scope, numberOfLines=5) and
        // 6 (specialRequirements, numberOfLines=4). Per-step line count
        // comes from step.lines in scopeQuestions.ts; default 5 if unset.
        if (!stringKey) return null;
        return (
          <TextInput
            value={answers[stringKey] ?? ''}
            onChangeText={(v) => onChange(stringKey, v)}
            placeholder={step.placeholder}
            placeholderTextColor={themeColors.textMuted}
            multiline
            numberOfLines={step.lines ?? 5}
            textAlignVertical="top"
            style={styles.textArea}
            testID={`${testIDPrefix}-${stringKey}`}
          />
        );

      default:
        return null;
    }
  };

  return (
    <StepCard step={step} styles={styles} accent={themeColors.accent} Icon={Icon}>
      {renderInput()}
    </StepCard>
  );
}

// Style keys verbatim from estimate-wizard.tsx makeStyles —
// only the keys used by StepCard and the per-step inputs are included
// (the result-screen and footer styles live only in the wizard).
const makeStyles = (themeColors: ThemeColors) =>
  StyleSheet.create({
    // StepCard — verbatim from wizard's makeStyles
    stepIconWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: themeColors.accent + '14',
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      marginBottom: 12,
    },
    stepTitle: {
      fontSize: 24,
      fontWeight: '700' as const,
      color: themeColors.text,
      marginBottom: 6,
    },
    stepSubtitle: {
      fontSize: Type.subhead.fontSize,
      color: themeColors.textMuted,
      lineHeight: 21,
    },
    // Chip inputs — verbatim from wizard's makeStyles
    chipWrap: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      gap: 8,
    },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: Tokens.radius.xl,
      backgroundColor: themeColors.surface,
      borderWidth: 1,
      borderColor: themeColors.line,
    },
    chipActive: {
      backgroundColor: themeColors.accent,
      borderColor: themeColors.accent,
    },
    chipText: {
      fontSize: Type.bodyCompact.fontSize,
      fontWeight: '600' as const,
      color: themeColors.text,
    },
    chipTextActive: { color: '#FFF' },
    // Text inputs — verbatim from wizard's makeStyles
    input: {
      backgroundColor: themeColors.surface,
      borderWidth: 1,
      borderColor: themeColors.line,
      borderRadius: Tokens.radius.card,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: Type.callout.fontSize,
      color: themeColors.text,
    },
    textArea: {
      backgroundColor: themeColors.surface,
      borderWidth: 1,
      borderColor: themeColors.line,
      borderRadius: Tokens.radius.card,
      padding: 12,
      minHeight: 120,
      fontSize: Type.subhead.fontSize,
      color: themeColors.text,
    },
    hint: {
      fontSize: Type.caption1.fontSize,
      color: themeColors.textMuted,
      marginTop: 6,
    },
  });
