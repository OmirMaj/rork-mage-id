// components/schedule/ScheduleOnRamp.tsx — first-run front door for an empty
// schedule. Presentation only; all navigation is injected. Renders in place of
// the full scheduler cockpit when a project has zero tasks.
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Sparkles, LayoutTemplate, Plus } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';

export interface ScheduleOnRampProps {
  /** The flagship AI path: answer a few grounded questions → generate. Works
   *  with or without an estimate, so it's the primary (no template lock-in). */
  onAnswerQuestions: () => void;
  onBuildWithAI: () => void;
  onStartFromTemplate: () => void;
  onAddManually: () => void;
  onLoadExample: () => void;
}

export function ScheduleOnRamp({
  onAnswerQuestions, onBuildWithAI, onStartFromTemplate, onAddManually, onLoadExample,
}: ScheduleOnRampProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.title}>Let’s build your schedule</Text>
        <Text style={styles.sub}>Start any way you like — you can change everything later.</Text>

        <TouchableOpacity style={styles.primary} onPress={onAnswerQuestions} activeOpacity={0.85} testID="onramp-interview" accessibilityRole="button" accessibilityLabel="Build schedule by answering a few questions with AI">
          <Sparkles size={18} color={Colors.textOnAccent} />
          <Text style={styles.primaryText}>Answer a few questions</Text>
          <Text style={styles.primaryBadge}>AI</Text>
        </TouchableOpacity>

        <View style={styles.secondaryRow}>
          <TouchableOpacity style={styles.secondary} onPress={onBuildWithAI} activeOpacity={0.85} testID="onramp-ai" accessibilityRole="button" accessibilityLabel="Build schedule from my estimate with AI">
            <Sparkles size={16} color={t.accent} />
            <Text style={styles.secondaryText}>From my estimate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={onStartFromTemplate} activeOpacity={0.85} testID="onramp-template" accessibilityRole="button">
            <LayoutTemplate size={16} color={t.accent} />
            <Text style={styles.secondaryText}>From a template</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={[styles.secondary, styles.manualFull]} onPress={onAddManually} activeOpacity={0.85} testID="onramp-manual" accessibilityRole="button">
          <Plus size={16} color={t.accent} />
          <Text style={styles.secondaryText}>Add tasks manually</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={onLoadExample} hitSlop={8} testID="onramp-example" accessibilityRole="button" accessibilityLabel="Load an example schedule">
          <Text style={styles.exampleLink}>Load an example schedule</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 520, alignItems: 'center',
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.line,
    padding: 28, gap: 14,
  },
  title: { fontSize: Type.title3.fontSize, fontWeight: '700', color: t.text },
  sub: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, textAlign: 'center' },
  primary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accent, borderRadius: Tokens.radius.md,
    paddingVertical: 14, paddingHorizontal: 18, width: '100%',
  },
  primaryText: { fontSize: Type.body.fontSize, fontWeight: '700', color: Colors.textOnAccent },
  primaryBadge: {
    fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.accent,
    backgroundColor: Colors.textOnAccent, borderRadius: Tokens.radius.xs, paddingHorizontal: 6, paddingVertical: 2,
  },
  secondaryRow: { flexDirection: 'row', gap: 10, width: '100%' },
  secondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.accent,
    paddingVertical: 12, paddingHorizontal: 12,
  },
  manualFull: { width: '100%' },
  secondaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },
  exampleLink: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginTop: 4, textDecorationLine: 'underline' },
});
