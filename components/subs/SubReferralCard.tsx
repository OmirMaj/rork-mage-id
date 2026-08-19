// components/subs/SubReferralCard.tsx
//
// The supply-side loop, made tappable. A sub with a real record has a reason to
// tell their OTHER GCs "send it to me through MAGE" — this is the message,
// already written, plus the list of their off-platform GCs to send it to.
//
// SUB-FACING and presentational: the copy comes from utils/subNetwork's
// referral builder (which carries no pricing of any kind) and every action is a
// callback the caller owns.

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Send, UserPlus, Sparkles, Building2 } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { OffPlatformGc, SubReferral } from '@/utils/subNetwork';

export function SubReferralCard({
  referral,
  onSend,
  onInvite,
  onAddGc,
}: {
  referral: SubReferral;
  /** Share/send the referral message however the caller likes. */
  onSend?: (message: string, subject: string) => void;
  /** Send it to one named GC from the sub's own list. */
  onInvite?: (gc: OffPlatformGc, message: string) => void;
  /** Open the sub's "add a GC I work for" flow. */
  onAddGc?: () => void;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.headIcon}>
          <Sparkles size={16} color={t.accent} strokeWidth={1.9} />
        </View>
        <View style={styles.headText}>
          <Text style={styles.title}>Bring your other GCs on</Text>
          <Text style={styles.subtitle}>
            Free for you, free for them to try. Everything between you lands in one thread
            instead of six text messages.
          </Text>
        </View>
      </View>

      <View style={styles.quote}>
        <Text style={styles.quoteText}>{referral.message}</Text>
      </View>

      {onSend ? (
        <TouchableOpacity
          style={styles.sendBtn}
          onPress={() => onSend(referral.message, referral.emailSubject)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Send this message to a general contractor"
        >
          <Send size={15} color={t.surface} strokeWidth={1.9} />
          <Text style={styles.sendBtnText}>Send this</Text>
        </TouchableOpacity>
      ) : null}

      {referral.inviteTargets.length > 0 ? (
        <>
          <View style={styles.divider} />
          <Text style={styles.sectionLabel}>Your GCs not on MAGE yet</Text>
          {referral.inviteTargets.map((gc) => (
            <View key={gc.name} style={styles.targetRow}>
              <View style={styles.targetIcon}>
                <Building2 size={15} color={t.textSecondary} strokeWidth={1.9} />
              </View>
              <View style={styles.targetText}>
                <Text style={styles.targetName} numberOfLines={1}>{gc.name}</Text>
                {gc.contactName || gc.email ? (
                  <Text style={styles.targetMeta} numberOfLines={1}>
                    {[gc.contactName, gc.email].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
              {onInvite ? (
                <TouchableOpacity
                  style={styles.inviteBtn}
                  onPress={() => onInvite(gc, referral.message)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`Invite ${gc.name} to MAGE`}
                >
                  <UserPlus size={13} color={t.accent} strokeWidth={2} />
                  <Text style={styles.inviteBtnText}>Invite</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </>
      ) : null}

      {onAddGc ? (
        <TouchableOpacity
          style={styles.addBtn}
          onPress={onAddGc}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Add a general contractor you work for"
        >
          <UserPlus size={14} color={t.textSecondary} strokeWidth={1.9} />
          <Text style={styles.addBtnText}>Add a GC you work for</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      gap: Tokens.spacing.sm,
      ...Tokens.continuousCorners,
    },
    head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    headIcon: {
      width: 32,
      height: 32,
      borderRadius: Tokens.radius.sm,
      backgroundColor: t.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headText: { flex: 1, minWidth: 0, gap: 3 },
    title: { ...Type.headline, color: t.text },
    subtitle: { ...Type.footnote, color: t.textSecondary },

    quote: {
      backgroundColor: t.surfaceAlt,
      borderRadius: Tokens.radius.md,
      borderLeftWidth: 3,
      borderLeftColor: t.accent,
      padding: Tokens.spacing.sm,
    },
    quoteText: { ...Type.footnote, color: t.text },

    sendBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: Tokens.touchTarget.min,
      borderRadius: Tokens.radius.md,
      backgroundColor: t.accentFill,
      ...Tokens.continuousCorners,
    },
    sendBtnText: { ...Type.footnoteEmphasized, color: t.surface },

    divider: { height: 1, backgroundColor: t.line },
    sectionLabel: { ...Type.eyebrow, color: t.textMuted },

    targetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    targetIcon: {
      width: 30,
      height: 30,
      borderRadius: Tokens.radius.sm,
      backgroundColor: t.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    targetText: { flex: 1, minWidth: 0 },
    targetName: { ...Type.bodyCompactEmphasized, color: t.text },
    targetMeta: { ...Type.caption2, color: t.textMuted },
    inviteBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: Tokens.radius.full,
      backgroundColor: t.accentSoft,
    },
    inviteBtnText: { ...Type.caption1, color: t.accent, fontWeight: '600' },

    addBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: Tokens.touchTarget.min,
      borderRadius: Tokens.radius.md,
      borderWidth: 1,
      borderColor: t.line,
      borderStyle: 'dashed',
      ...Tokens.continuousCorners,
    },
    addBtnText: { ...Type.footnote, color: t.textSecondary, fontWeight: '600' },
  });

export default SubReferralCard;
