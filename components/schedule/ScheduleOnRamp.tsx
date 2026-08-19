// components/schedule/ScheduleOnRamp.tsx — single-recommended-path on-ramp.
// Presents ONE hero action (estimate-based or AI interview, chosen by
// recommendedOnRampPath), an always-visible secondary (blank), and a
// progressive-disclosure "More ways" section for the remaining paths.
// Presentation only; all navigation is injected via onPick.
import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Sparkles, LayoutTemplate, Plus, Mic, BookOpen, ChevronDown, ChevronUp } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { recommendedOnRampPath, type OnRampPath } from '@/utils/scheduleOnRamp';

const ICON_WRAP_SIZE = 36; // icon-wrapper convention used across ≥6 components

export interface ScheduleOnRampProps {
  /** Whether the current project already has a linkedEstimate to build from. */
  hasEstimate: boolean;
  /** Gate the voice path — only render it when the copilot is available. */
  canBuildByVoice?: boolean;
  /** Single callback; host maps each path to its own destination/handler. */
  onPick: (path: OnRampPath) => void;
}

const HERO_COPY: Record<'estimate' | 'interview', { title: string; subtitle: string }> = {
  estimate: {
    title: 'Build from your estimate',
    subtitle: 'One tap — MAGE drafts the tasks from your estimate, you adjust.',
  },
  interview: {
    title: 'Answer a few quick questions',
    subtitle: 'MAGE asks the smart questions, then builds it.',
  },
};

export function ScheduleOnRamp({ hasEstimate, canBuildByVoice, onPick }: ScheduleOnRampProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [moreOpen, setMoreOpen] = useState(false);

  const hero = recommendedOnRampPath({ hasEstimate }) as 'estimate' | 'interview';
  const { title: heroTitle, subtitle: heroSubtitle } = HERO_COPY[hero];

  return (
    <View style={styles.wrap}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>Let's build your schedule</Text>
        <Text style={styles.sub}>Start in seconds — you can change everything later.</Text>

        {/* ── Hero (recommended) ── */}
        <TouchableOpacity
          style={styles.hero}
          onPress={() => onPick(hero)}
          activeOpacity={0.85}
          testID="onramp-hero"
          accessibilityRole="button"
          accessibilityLabel={heroTitle}
        >
          <View style={styles.heroIcon}>
            <Sparkles size={20} color={Colors.textOnAccent} />
          </View>
          <View style={styles.heroText}>
            <View style={styles.heroTitleRow}>
              <Text style={styles.heroTitle}>{heroTitle}</Text>
              <Text style={styles.heroBadge}>Recommended</Text>
            </View>
            <Text style={styles.heroSubtitle}>{heroSubtitle}</Text>
          </View>
        </TouchableOpacity>

        {/* ── Always-visible secondary: Start blank ── */}
        <TouchableOpacity
          style={styles.secondary}
          onPress={() => onPick('blank')}
          activeOpacity={0.85}
          testID="onramp-blank"
          accessibilityRole="button"
          accessibilityLabel="Start blank"
        >
          <Plus size={16} color={t.accent} />
          <View style={styles.secondaryText}>
            <Text style={styles.secondaryTitle}>Start blank</Text>
            <Text style={styles.secondarySubtitle}>Creates an empty schedule on this project — add tasks inside it.</Text>
          </View>
        </TouchableOpacity>

        {/* ── More ways toggle ── */}
        <TouchableOpacity
          style={styles.moreToggle}
          onPress={() => setMoreOpen(v => !v)}
          activeOpacity={0.7}
          testID="onramp-more-toggle"
          accessibilityRole="button"
          accessibilityLabel={moreOpen ? 'Fewer ways' : 'More ways'}
        >
          <Text style={styles.moreToggleText}>More ways</Text>
          {moreOpen
            ? <ChevronUp size={14} color={t.textSecondary} />
            : <ChevronDown size={14} color={t.textSecondary} />}
        </TouchableOpacity>

        {/* ── Disclosure rows ── */}
        {moreOpen && (
          <View style={styles.moreSection}>
            <TouchableOpacity
              style={styles.moreRow}
              onPress={() => onPick('template')}
              activeOpacity={0.8}
              testID="onramp-template"
              accessibilityRole="button"
              accessibilityLabel="Start from a template"
            >
              <LayoutTemplate size={15} color={t.textSecondary} />
              <Text style={styles.moreRowText}>Start from a template</Text>
            </TouchableOpacity>

            {canBuildByVoice && (
              <TouchableOpacity
                style={styles.moreRow}
                onPress={() => onPick('voice')}
                activeOpacity={0.8}
                testID="onramp-voice"
                accessibilityRole="button"
                accessibilityLabel="Build by voice"
              >
                <Mic size={15} color={t.textSecondary} />
                <Text style={styles.moreRowText}>Build by voice</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.moreRow}
              onPress={() => onPick('example')}
              activeOpacity={0.8}
              testID="onramp-example"
              accessibilityRole="button"
              accessibilityLabel="Load an example schedule"
            >
              <BookOpen size={15} color={t.textSecondary} />
              <Text style={styles.moreRowText}>Load an example schedule</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.moreRow, styles.moreRowLast]}
              onPress={() => onPick('manual')}
              activeOpacity={0.8}
              testID="onramp-manual"
              accessibilityRole="button"
              accessibilityLabel="Add tasks manually"
            >
              <Plus size={15} color={t.textSecondary} />
              <Text style={styles.moreRowText}>Add tasks manually</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Tokens.spacing.lg },
  card: {
    width: '100%', maxWidth: 520, alignItems: 'stretch',
    backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: t.line,
    padding: Tokens.spacing.xl, gap: Tokens.spacing.sm,
  },

  // Header copy
  eyebrow: { ...Type.title3, color: t.text, textAlign: 'center' },
  sub: { ...Type.bodyCompact, color: t.textSecondary, textAlign: 'center', marginBottom: Tokens.spacing.xs },

  // Hero card
  hero: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.sm,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.md,
    padding: Tokens.spacing.md,
  },
  heroIcon: {
    width: ICON_WRAP_SIZE, height: ICON_WRAP_SIZE, borderRadius: Tokens.radius.sm,
    // translucent white overlay — intentional, no system token for accent-over-accent
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  heroText: { flex: 1, gap: Tokens.spacing.xxs },
  heroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs, flexWrap: 'wrap' },
  heroTitle: { ...Type.bodyEmphasized, color: Colors.textOnAccent, flexShrink: 1 },
  heroBadge: {
    ...Type.caption2, fontWeight: '700' as const, color: t.accent,
    backgroundColor: Colors.textOnAccent,
    borderRadius: Tokens.radius.xs, paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.hairline,
  },
  heroSubtitle: { ...Type.footnote, color: Colors.textOnAccent, opacity: 0.85 },

  // Secondary (blank)
  secondary: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.sm,
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.accent,
    padding: Tokens.spacing.md,
  },
  secondaryText: { flex: 1, gap: Tokens.spacing.xxs },
  secondaryTitle: { ...Type.footnoteEmphasized, color: t.accent },
  secondarySubtitle: { ...Type.caption1, color: t.textSecondary },

  // More-ways toggle
  moreToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: Tokens.spacing.xxs, paddingVertical: Tokens.spacing.xs,
  },
  moreToggleText: { ...Type.footnote, color: t.textSecondary },

  // Disclosure rows
  moreSection: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line,
    paddingTop: Tokens.spacing.xs, gap: 0,
  },
  moreRow: {
    flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.sm, paddingHorizontal: Tokens.spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  moreRowLast: { borderBottomWidth: 0 },
  moreRowText: { ...Type.footnote, color: t.textSecondary },
});
