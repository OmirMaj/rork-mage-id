// LockedAccessCard — the placeholder a financial surface shows to a field-role
// collaborator. Honest, calm, and non-accusatory: field access is a feature the
// GC turned on, not a permission the user got caught lacking. Used anywhere
// costs/margins are blinded (utils/roleBlinding).

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LockKeyhole, WifiOff } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface Props {
  /** What's hidden, e.g. "Job costing" or "Margin". Keeps the message specific. */
  what?: string;
  /** Optional override for the explanatory line. */
  detail?: string;
  style?: object;
}

export default function LockedAccessCard({ what = 'Financials', detail, style }: Props) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.card, style]} testID="locked-access-card">
      <View style={styles.iconWrap}>
        <LockKeyhole size={20} color={styles.icon.color} strokeWidth={1.75} />
      </View>
      <Text style={styles.title}>{what} is hidden on field access</Text>
      <Text style={styles.detail}>
        {detail ??
          'You have field access to this project — schedule, tasks, daily reports, photos and RFIs. Costs and margins stay with the project owner.'}
      </Text>
    </View>
  );
}

/**
 * A schedule update that did NOT reach the server (#138). Not the padlock card:
 * "Date and task editing is hidden on field access" read as a permission
 * problem when the foreman's progress tap had simply found no signal. This is
 * a plain alert — the failure's own wording, a Retry when a retry can work, and
 * a line saying the screen is already re-sending it by itself when it is.
 * LockedAccessCard stays for what really is an access limit.
 */
export function FieldSendFailureBanner({
  message, onRetry, onDismiss, autoRetrying, style, testID = 'schedule-field-send-failure',
}: {
  message: string;
  /** Omitted when a retry cannot work (a refusal, not a lost connection). */
  onRetry?: () => void;
  onDismiss: () => void;
  /** The screen re-sends it automatically while open. */
  autoRetrying?: boolean;
  style?: object;
  testID?: string;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.banner, style]} testID={testID} accessibilityRole="alert">
      <WifiOff size={16} color={styles.bannerText.color} strokeWidth={1.75} />
      <View style={styles.bannerBody}>
        <Text style={styles.bannerText}>{message}</Text>
        {autoRetrying ? (
          <Text style={styles.bannerSub}>Trying again by itself while this screen is open.</Text>
        ) : null}
      </View>
      <View style={styles.bannerActions}>
        {onRetry ? (
          <TouchableOpacity onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry saving" hitSlop={8} testID={`${testID}-retry`}>
            <Text style={styles.bannerAction}>Retry</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss notice" hitSlop={8}>
          <Text style={styles.bannerAction}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  banner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    padding: 10,
    borderRadius: Tokens.radius.sm,
    backgroundColor: t.warningSoft,
  },
  bannerBody: { flex: 1, gap: 2 },
  bannerText: { fontSize: Type.caption1.fontSize, color: t.warningLabel },
  bannerSub: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  bannerActions: { gap: 8, alignItems: 'flex-end' as const },
  bannerAction: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent },
  card: {
    backgroundColor: t.surfaceAlt,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: t.line,
    padding: 20,
    alignItems: 'center' as const,
    gap: 8,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: t.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 2,
  },
  icon: { color: t.textMuted },
  title: {
    fontSize: Type.subhead.fontSize,
    fontWeight: '700' as const,
    color: t.text,
    textAlign: 'center' as const,
  },
  detail: {
    fontSize: Type.footnote.fontSize,
    color: t.textMuted,
    lineHeight: 18,
    textAlign: 'center' as const,
  },
});
