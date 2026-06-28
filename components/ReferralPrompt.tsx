// ReferralPrompt — fires at the won-job moment, the emotional peak.
//
// Research: 70%+ of contractor work comes from word-of-mouth, and referred
// leads convert far higher. The highest-leverage growth loop is asking for a
// referral right after the app helped the contractor win a job — not via a
// generic "invite a friend" banner. This modal pops once per won lead.
//
// Pure UI + native Share; no backend. The shared message carries the app
// link so the recipient can install. Tracking attribution would need a
// referrals table (future) — this is the honest, shippable v1.

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Share, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { PartyPopper, Share2, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Public app link used in the referral share. Matches the marketing site.
const APP_LINK = 'https://mageid.app';

export default function ReferralPrompt({
  visible,
  onClose,
  jobName,
  companyName,
}: {
  visible: boolean;
  onClose: () => void;
  jobName?: string;
  companyName?: string;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);

  const handleShare = useCallback(async () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const who = companyName ? companyName : 'I';
    const message =
      `${who === 'I' ? "I've" : who + ' has'} been winning more jobs with MAGE ID — ` +
      `it drafts professional bids in seconds and keeps every project organized. ` +
      `Worth a look if you run a construction business: ${APP_LINK}`;
    try {
      await Share.share({ message, url: APP_LINK });
    } catch {
      /* user cancelled — no-op */
    } finally {
      onClose();
    }
  }, [companyName, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
            <X size={18} color={colors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>

          <View style={styles.iconWrap}><PartyPopper size={32} color={colors.accent} strokeWidth={1.75} /></View>
          <Text style={styles.title}>Nice win!{jobName ? ` ${jobName}` : ''}</Text>
          <Text style={styles.body}>
            Know another contractor who could use an edge like this? Most of our
            best users come from a referral — takes 10 seconds.
          </Text>

          <TouchableOpacity style={styles.shareBtn} onPress={handleShare} activeOpacity={0.85} testID="referral-share">
            <Share2 size={16} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.shareBtnText}>Refer a contractor</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.laterBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.laterBtnText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: {
    width: '100%', maxWidth: 360, backgroundColor: t.surface, borderRadius: Tokens.radius.xl,
    padding: 24, alignItems: 'center', gap: 10,
  },
  closeBtn: { position: 'absolute', top: 12, right: 12, padding: 4 },
  iconWrap: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  title: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, textAlign: 'center' },
  body: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, marginBottom: 6 },
  shareBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '100%', paddingVertical: 13, borderRadius: Tokens.radius.card, backgroundColor: t.accent,
  },
  shareBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF' },
  laterBtn: { paddingVertical: 8 },
  laterBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.textMuted },
});
