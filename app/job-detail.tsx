import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MapPin, DollarSign, Clock, Briefcase, Award, ChevronRight, Send, Building2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useHire, HIRE_ENABLED } from '@/contexts/HireContext';
import { getTradeLabel } from '@/constants/trades';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const JOB_TYPE_LABELS: Record<string, string> = {
  full_time: 'Full-Time', part_time: 'Part-Time', contract: 'Contract', per_diem: 'Per Diem',
};
const EXP_LABELS: Record<string, string> = {
  entry: 'Entry Level', mid: 'Mid Level', senior: 'Senior', expert: 'Expert',
};

function formatPay(min: number, max: number, type: string): string {
  if (type === 'salary') return `$${(min / 1000).toFixed(0)}K – $${(max / 1000).toFixed(0)}K / year`;
  return `$${min} – $${max} / hour`;
}

export default function JobDetailScreen() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { jobs, applyToJob, workers, startConversation } = useHire();
  const [applied, setApplied] = useState(false);

  const job = useMemo(() => jobs.find(j => j.id === id), [jobs, id]);

  const matchingWorkers = useMemo(() => {
    if (!job) return [];
    return workers.filter(w =>
      w.tradeCategory === job.tradeCategory && w.availability !== 'employed'
    ).slice(0, 5);
  }, [job, workers]);

  if (!HIRE_ENABLED) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Job Details' }} />
        <View style={styles.center}><Text style={styles.errorText}>Direct Hire is coming soon — the hiring marketplace isn&apos;t available yet.</Text></View>
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Job Details' }} />
        <View style={styles.center}><Text style={styles.errorText}>Job not found</Text></View>
      </View>
    );
  }

  const handleApply = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    applyToJob(job.id);
    setApplied(true);
    showAlert('Applied!', 'Your application has been submitted.');
  };

  const handleMessage = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const convoId = startConversation(
      ['you', job.companyId],
      ['You', job.companyName],
      `Hi, I'm interested in the "${job.title}" position.`
    );
    router.push({ pathname: '/messages' as any, params: { id: convoId } });
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Job Details',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <ScrollView {...fabScroll} style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]} showsVerticalScrollIndicator={false}>
        <View style={styles.topCard}>
          <View style={styles.badgeRow}>
            <View style={styles.typeBadge}>
              <Text style={styles.typeBadgeText}>{JOB_TYPE_LABELS[job.jobType]}</Text>
            </View>
            <View style={[styles.statusBadge, job.status === 'open' ? styles.openBadge : styles.closedBadge]}>
              <Text style={[styles.statusText, job.status === 'open' ? styles.openText : styles.closedText]}>
                {job.status.toUpperCase()}
              </Text>
            </View>
          </View>
          <Text style={styles.title}>{job.title}</Text>
          <Text style={styles.company}>{job.companyName}</Text>
          <View style={styles.metaRow}>
            <MapPin size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.metaText}>{job.city}, {job.state}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <DollarSign size={18} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Pay</Text>
            <Text style={styles.statValue}>{formatPay(job.payMin, job.payMax, job.payType)}</Text>
          </View>
          <View style={styles.statCard}>
            <Briefcase size={18} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Trade</Text>
            <Text style={styles.statValue}>{getTradeLabel(job.tradeCategory)}</Text>
          </View>
          <View style={styles.statCard}>
            <Award size={18} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Experience</Text>
            <Text style={styles.statValue}>{EXP_LABELS[job.experienceLevel]}</Text>
          </View>
          <View style={styles.statCard}>
            <Clock size={18} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Start Date</Text>
            <Text style={styles.statValue}>{job.startDate}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{job.description}</Text>
        </View>

        {job.requiredLicenses.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Required Licenses & Certifications</Text>
            {job.requiredLicenses.map((lic, i) => (
              <View key={i} style={styles.licenseItem}>
                <Award size={14} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.licenseLabel}>{lic}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Matching Workers</Text>
          <Text style={styles.sectionSubtitle}>Available workers matching this trade</Text>
          {matchingWorkers.length === 0 ? (
            <Text style={styles.noResults}>No matching workers at this time</Text>
          ) : (
            matchingWorkers.map(w => (
              <TouchableOpacity
                key={w.id}
                style={styles.workerRow}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/worker-detail' as any, params: { id: w.id } });
                }}
              >
                <View style={styles.workerAvatar}>
                  <Text style={styles.workerAvatarText}>{w.name.charAt(0)}</Text>
                </View>
                <View style={styles.workerInfo}>
                  <Text style={styles.workerName}>{w.name}</Text>
                  <Text style={styles.workerMeta}>{w.yearsExperience}yr exp · ${w.hourlyRate}/hr</Text>
                </View>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.actionSection}>
          <Text style={styles.applicantInfo}>{job.applicantCount} applicants so far</Text>
          <TouchableOpacity
            style={[styles.applyBtn, applied && styles.appliedBtn]}
            onPress={handleApply}
            disabled={applied}
          >
            <Send size={16} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.applyBtnText}>{applied ? 'Applied' : 'Apply Now'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.messageBtn} onPress={handleMessage}>
            <Building2 size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.messageBtnText}>Message Company</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: Type.callout.fontSize, color: t.textSecondary },
  topCard: { backgroundColor: t.surface, padding: 20, borderBottomWidth: 0.5, borderBottomColor: t.line },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeBadge: { backgroundColor: t.accent + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.xs },
  typeBadgeText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.accent, textTransform: 'uppercase' as const },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.xs },
  openBadge: { backgroundColor: Colors.successLight },
  closedBadge: { backgroundColor: Colors.errorLight },
  statusText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const },
  openText: { color: Colors.successDark },
  closedText: { color: Colors.errorDark },
  title: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, marginBottom: 4 },
  company: { fontSize: Type.subhead.fontSize, color: t.textSecondary, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  statCard: { width: '48%' as any, backgroundColor: t.surface, padding: 14, borderRadius: Tokens.radius.card, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, textTransform: 'uppercase' as const, fontWeight: '600' as const },
  statValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'center' as const },
  section: { backgroundColor: t.surface, padding: 20, marginTop: 8 },
  sectionTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 8 },
  sectionSubtitle: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginBottom: 12 },
  description: { fontSize: Type.subhead.fontSize, color: t.text, lineHeight: 22 },
  licenseItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: t.line },
  licenseLabel: { fontSize: Type.bodyCompact.fontSize, color: t.text },
  noResults: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, textAlign: 'center' as const, paddingVertical: 20 },
  workerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: t.line },
  workerAvatar: { width: 36, height: 36, borderRadius: Tokens.radius.xl, backgroundColor: t.accent + '20', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  workerAvatarText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.accent },
  workerInfo: { flex: 1 },
  workerName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  workerMeta: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  actionSection: { padding: 20, gap: 10 },
  applicantInfo: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center' as const, marginBottom: 4 },
  applyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, paddingVertical: 16, borderRadius: Tokens.radius.card, gap: 8 },
  appliedBtn: { backgroundColor: t.textMuted },
  applyBtnText: { color: '#FFF', fontSize: Type.callout.fontSize, fontWeight: '700' as const },
  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent + '12', paddingVertical: 14, borderRadius: Tokens.radius.card, gap: 8 },
  messageBtnText: { color: t.accent, fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
});
