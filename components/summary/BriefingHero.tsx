import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MoreHorizontal } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';

/**
 * Hour-of-day greeting.
 *
 * Runtime audit 2026-09-06, VIS-07: this component said "Good morning" at
 * every hour — the capture that caught it was taken at 9:20 PM, with the
 * Materials screen in the same run correctly printing "Prices updated
 * 9:20 PM". The two sibling home surfaces (components/ClientHome.tsx,
 * components/PropertyManagerHome.tsx) already branch on the hour; this is the
 * SAME ladder and the same words, so the app greets with one voice.
 *
 * Exported for the guard in scripts/validate-contrast.ts and so a caller can
 * pass a fixed clock in a test.
 */
export function greetingFor(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 6) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Working late';
}

interface BriefingHeroProps {
  /** Already-resolved first name, or '' for a plain greeting. */
  greetingName: string;
  /** Count behind the danger pill; pill hidden when 0. */
  attentionCount: number;
  /** Count behind the muted "N active" pill. */
  activeCount: number;
  /** The ••• overflow button. */
  onOpenTools: () => void;
}

export function BriefingHero({ greetingName, attentionCount, activeCount, onOpenTools }: BriefingHeroProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const dateLine = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    .toUpperCase();
  const salutation = greetingFor();
  const greeting = greetingName ? `${salutation}, ${greetingName}` : salutation;

  return (
    <View style={styles.wrap}>
      {/* The ••• button shares the DATE line, not the greeting line. See the
          `greet` style for why the greeting needs the full row width. */}
      <View style={styles.topRow}>
        <Text style={styles.date} numberOfLines={1}>{dateLine}</Text>
        <TouchableOpacity
          style={styles.toolsBtn}
          onPress={onOpenTools}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="More tools"
          testID="summary-tools-button"
        >
          <MoreHorizontal size={20} color={colors.textSecondary} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>
      {/* `adjustsFontSizeToFit` is iOS/Android only — it does not exist
          anywhere in react-native-web, so on app.mageid.app it is a silent
          no-op and the greeting would still ellipsise. There, the name wraps
          to a second line instead: still whole, which is the point. On native
          the type shrinks to a 21pt floor (34 x 0.62) and stays on one line. */}
      <Text
        style={styles.greet}
        numberOfLines={Platform.OS === 'web' ? 2 : 1}
        adjustsFontSizeToFit={Platform.OS !== 'web'}
        minimumFontScale={0.62}
        accessibilityRole="header"
      >
        {greeting}
      </Text>
      <View style={styles.pills}>
        {attentionCount > 0 && (
          <View style={[styles.pill, { backgroundColor: colors.danger + '18' }]}>
            <Text style={[styles.pillText, { color: colors.danger }]}>
              {attentionCount} need{attentionCount === 1 ? 's' : ''} attention
            </Text>
          </View>
        )}
        <View style={[styles.pill, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[styles.pillText, { color: colors.textMuted }]}>{activeCount} active</Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 14 },
  topRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 10 },
  date: { flex: 1, minWidth: 0, fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: t.accentLabel, letterSpacing: 1 },
  // Runtime audit 2026-09-06, MONEY-04 / VIS-15: this rendered "Good morning,
  // O…" on a stock iPhone 17 Pro at default text size. At 34/800 the greeting
  // needs ~326pt and the old layout left it ~305 (20+20 padding, a 38pt tools
  // button, a 10pt gap) — so iOS ellipsised the only personal token in the
  // line. Two changes, both needed: the ••• button moved up onto the date
  // line, which hands the greeting the full ~353pt row; and the type shrinks
  // to fit rather than clipping, so a long salutation ("Good afternoon,") or
  // a long first name degrades in size instead of losing letters.
  greet: { fontSize: Type.largeTitle.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.6, marginTop: 2 },
  pills: { flexDirection: 'row' as const, gap: 8, marginTop: 10, flexWrap: 'wrap' as const },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  pillText: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.1 },
  toolsBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, alignItems: 'center' as const, justifyContent: 'center' as const },
});
