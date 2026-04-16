import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MapPin, DollarSign, Clock, Briefcase, Award, ChevronRight, Send, Building2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useHire } from '@/contexts/HireContext';
import { getTradeLabel } from '@/constants/trades';

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
    Alert.alert('Applied!', 'Your application has been submitted.');
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
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
            <MapPin size={14} color={Colors.textSecondary} />
            <Text style={styles.metaText}>{job.city}, {job.state}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <DollarSign size={18} color={Colors.primary} />
            <Text style={styles.statLabel}>Pay</Text>
            <Text style={styles.statValue}>{formatPay(job.payMin, job.payMax, job.payType)}</Text>
          </View>
          <View style={styles.statCard}>
            <Briefcase size={18} color={Colors.accent} />
            <Text style={styles.statLabel}>Trade</Text>
            <Text style={styles.statValue}>{getTradeLabel(job.tradeCategory)}</Text>
          </View>
          <View style={styles.statCard}>
            <Award size={18} color={Colors.info} />
            <Text style={styles.statLabel}>Experience</Text>
            <Text style={styles.statValue}>{EXP_LABELS[job.experienceLevel]}</Text>
          </View>
          <View style={styles.statCard}>
            <Clock size={18} color={Colors.textSecondary} />
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
                <Award size={14} color={Colors.primary} />
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
                <ChevronRight size={16} color={Colors.textMuted} />
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
            <Send size={16} color="#FFF" />
            <Text style={styles.applyBtnText}>{applied ? 'Applied' : 'Apply Now'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.messageBtn} onPress={handleMessage}>
            <Building2 size={16} color={Colors.primary} />
            <Text style={styles.messageBtnText}>Message Company</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: Colors.textSecondary },
  topCard: { backgroundColor: Colors.surface, padding: 20, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  typeBadge: { backgroundColor: Colors.primary + '15', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  typeBadgeText: { fontSize: 12, fontWeight: '700' as const, color: Colors.primary, textTransform: 'uppercase' as const },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  openBadge: { backgroundColor: '#E8F5E9' },
  closedBadge: { backgroundColor: '#FFEBEE' },
  statusText: { fontSize: 11, fontWeight: '800' as const },
  openText: { color: '#2E7D32' },
  closedText: { color: '#C62828' },
  title: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, marginBottom: 4 },
  company: { fontSize: 15, color: Colors.textSecondary, marginBottom: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 14, color: Colors.textSecondary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  statCard: { width: '48%' as any, backgroundColor: Colors.surface, padding: 14, borderRadius: 12, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase' as const, fontWeight: '600' as const },
  statValue: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, textAlign: 'center' as const },
  section: { backgroundColor: Colors.surface, padding: 20, marginTop: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 8 },
  sectionSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  description: { fontSize: 15, color: Colors.text, lineHeight: 22 },
  licenseItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  licenseLabel: { fontSize: 14, color: Colors.text },
  noResults: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const, paddingVertical: 20 },
  workerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  workerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.accent + '20', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  workerAvatarText: { fontSize: 14, fontWeight: '700' as const, color: Colors.accent },
  workerInfo: { flex: 1 },
  workerName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  workerMeta: { fontSize: 13, color: Colors.textSecondary },
  actionSection: { padding: 20, gap: 10 },
  applicantInfo: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' as const, marginBottom: 4 },
  applyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12, gap: 8 },
  appliedBtn: { backgroundColor: Colors.textMuted },
  applyBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '12', paddingVertical: 14, borderRadius: 12, gap: 8 },
  messageBtnText: { color: Colors.primary, fontSize: 15, fontWeight: '600' as const },
});
