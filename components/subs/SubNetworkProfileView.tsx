// components/subs/SubNetworkProfileView.tsx
//
// The whole sub-facing screen body, composed: credential, work history,
// reliability detail, referral. Drop it inside a ScrollView on whatever route
// hosts the sub profile.
//
// Presentational and stateless — it takes a SubNetworkProfile from
// utils/subNetwork plus callbacks. It reads no context except the theme, which
// is what keeps it safe to render on a sub-facing surface: it cannot reach the
// GC's projects, commitments, or costs even by accident.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Clock, ShieldCheck, Wrench, Briefcase } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { OffPlatformGc, SubNetworkProfile } from '@/utils/subNetwork';
import { SubCredentialCard } from './SubCredentialCard';
import { SubWorkHistoryList } from './SubWorkHistoryList';
import { SubReferralCard } from './SubReferralCard';

function SignalRow({
  icon,
  label,
  value,
  detail,
  styles,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.signalRow}>
      <View style={styles.signalIcon}>{icon}</View>
      <View style={styles.signalText}>
        <Text style={styles.signalLabel}>{label}</Text>
        <Text style={styles.signalDetail}>{detail}</Text>
      </View>
      <Text style={styles.signalValue}>{value}</Text>
    </View>
  );
}

export function SubNetworkProfileView({
  profile,
  onShareCredential,
  onCopyCredential,
  onSendReferral,
  onInviteGc,
  onAddGc,
  onSelectGc,
}: {
  profile: SubNetworkProfile;
  onShareCredential?: (text: string) => void;
  onCopyCredential?: (text: string) => void;
  onSendReferral?: (message: string, subject: string) => void;
  onInviteGc?: (gc: OffPlatformGc, message: string) => void;
  onAddGc?: () => void;
  onSelectGc?: (gcId: string) => void;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const r = profile.reliability;

  const showSignals = !profile.isEmpty;

  return (
    <View style={styles.root}>
      <SubCredentialCard
        profile={profile}
        onShare={onShareCredential}
        onCopy={onCopyCredential}
      />

      {showSignals ? (
        <View style={styles.panel}>
          <Text style={styles.sectionLabel}>What the numbers are built on</Text>

          <SignalRow
            icon={<Clock size={16} color={t.accent} strokeWidth={1.9} />}
            label="Finished inside the days allotted"
            detail={
              r.onTimePct == null
                ? `${r.onTimeSampleSize} of 3 measured tasks needed before this counts`
                : `${r.onTimeSampleSize} finished tasks measured`
            }
            value={r.onTimePct == null ? '—' : `${r.onTimePct}%`}
            styles={styles}
          />

          <SignalRow
            icon={<Wrench size={16} color={t.accent} strokeWidth={1.9} />}
            label="Punch closed first time"
            detail={
              r.punchCleanPct == null
                ? `${r.punchSampleSize} of 3 reviewed items needed before this counts`
                : `${r.punchSampleSize} reviewed items`
            }
            value={r.punchCleanPct == null ? '—' : `${r.punchCleanPct}%`}
            styles={styles}
          />

          <SignalRow
            icon={<Briefcase size={16} color={t.accent} strokeWidth={1.9} />}
            label="Jobs closed out"
            detail={
              r.jobsInProgress > 0
                ? `${r.jobsInProgress} still running`
                : 'Nothing open right now'
            }
            value={String(r.jobsCompleted)}
            styles={styles}
          />

          <SignalRow
            icon={<ShieldCheck size={16} color={r.coiCurrent ? t.success : t.textMuted} strokeWidth={1.9} />}
            label="Insurance on file"
            detail={
              r.coiDaysRemaining == null
                ? 'No certificate on file with any GC yet'
                : r.coiDaysRemaining >= 0
                  ? `${r.coiDaysRemaining} days left before it needs renewing`
                  : `Expired ${Math.abs(r.coiDaysRemaining)} days ago`
            }
            value={r.coiCurrent ? 'Current' : 'Lapsed'}
            styles={styles}
          />

          <Text style={styles.note}>
            Every figure here is counted from work you actually did. Nothing a general
            contractor pays you, quotes you, or marks up is stored on your profile or shown
            to anyone else.
          </Text>
        </View>
      ) : null}

      <SubWorkHistoryList history={profile.history} onSelectGc={onSelectGc} />

      <SubReferralCard
        referral={profile.referral}
        onSend={onSendReferral}
        onInvite={onInviteGc}
        onAddGc={onAddGc}
      />
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { gap: Tokens.spacing.md },
    panel: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      padding: Tokens.spacing.md,
      gap: Tokens.spacing.sm,
      ...Tokens.continuousCorners,
    },
    sectionLabel: { ...Type.eyebrow, color: t.textMuted },

    signalRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    signalIcon: {
      width: 32,
      height: 32,
      borderRadius: Tokens.radius.sm,
      backgroundColor: t.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    signalText: { flex: 1, minWidth: 0, gap: 1 },
    signalLabel: { ...Type.bodyCompactEmphasized, color: t.text },
    signalDetail: { ...Type.caption2, color: t.textMuted },
    signalValue: { ...Type.title3, color: t.text, fontVariant: ['tabular-nums'] },

    note: { ...Type.caption1, color: t.textMuted },
  });

export default SubNetworkProfileView;
