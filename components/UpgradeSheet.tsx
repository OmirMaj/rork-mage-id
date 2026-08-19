import React, { useCallback } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { X, Sparkles } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import type { LimitCheck } from '@/utils/aiRateLimiter';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface UpgradeSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The blocked LimitCheck from checkAILimit — drives the headline + body. */
  limit: LimitCheck | null;
  /** Human label of the feature, e.g. "Voice Capture" — used in the eyebrow. */
  featureLabel?: string;
}

// Post-value upgrade sheet. Distinct from the full-screen <Paywall> (still
// reachable from Settings / explicit CTAs): this is the "you've now seen what
// this does" moment, framed as earned. Frosted glass sits over the result the
// user just produced so they see exactly what upgrading keeps.
export default function UpgradeSheet({ visible, onClose, limit, featureLabel }: UpgradeSheetProps) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();

  const headline = limit?.reason === 'lifetime_cap'
    ? 'You’ve seen what it can do'
    : 'Keep the momentum going';
  const body = limit?.message
    ?? 'You’ve used your free trials of this feature. Upgrade to keep going.';

  const handleUpgrade = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    router.push('/paywall' as never);
  }, [onClose, router]);

  if (!visible || !limit) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <BlurView
        intensity={Platform.OS === 'android' ? 40 : 28}
        tint="dark"
        style={styles.backdrop}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.card}>
          <View style={styles.head}>
            <View style={styles.iconWrap}>
              <Sparkles size={18} color={themeColors.accent} strokeWidth={1.9} />
            </View>
            <View style={{ flex: 1 }}>
              {featureLabel ? <Text style={styles.eyebrow}>{featureLabel}</Text> : null}
              <Text style={styles.title}>{headline}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
              <X size={18} color={themeColors.textMuted} strokeWidth={1.9} />
            </TouchableOpacity>
          </View>

          <Text style={styles.body}>{body}</Text>

          <TouchableOpacity style={styles.upgradeBtn} onPress={handleUpgrade} activeOpacity={0.9} testID="upgrade-sheet-cta">
            <MageAIMark size={16} color="#FFF" />
            <Text style={styles.upgradeBtnText}>See plans</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.notNowBtn} testID="upgrade-sheet-dismiss">
            <Text style={styles.notNowText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </BlurView>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  card: {
    backgroundColor: t.bg,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 22, paddingBottom: 36, gap: 14,
    borderWidth: 1, borderColor: t.line,
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 36, height: 36, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.3, marginTop: 2 },
  closeBtn: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceAlt },
  body: { fontSize: Type.bodyCompact.fontSize, color: t.text, lineHeight: 21 },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accentFill, borderRadius: Tokens.radius.lg, paddingVertical: 16, marginTop: 4,
  },
  upgradeBtnText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '800', letterSpacing: 0.2 },
  notNowBtn: { alignItems: 'center', paddingVertical: 6 },
  notNowText: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, fontWeight: '600' },
});
