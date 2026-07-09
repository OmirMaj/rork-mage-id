import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MapPin, DollarSign, Clock, Award, Mail, Phone, MessageCircle, Briefcase } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useHire, HIRE_ENABLED } from '@/contexts/HireContext';
import { getTradeLabel } from '@/constants/trades';
import { buildMailtoUrl, mailSignOff } from '@/utils/mailtoComposer';
import type { AvailabilityStatus } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  available: 'Available Now', employed: 'Currently Employed', open_to_offers: 'Open to Offers',
};
const AVAILABILITY_COLORS: Record<AvailabilityStatus, string> = {
  available: '#2E7D32', employed: '#E65100', open_to_offers: '#1565C0',
};

export default function WorkerDetailScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { workers, jobs, startConversation } = useHire();

  const worker = useMemo(() => workers.find(w => w.id === id), [workers, id]);

  const matchingJobs = useMemo(() => {
    if (!worker) return [];
    return jobs.filter(j => j.tradeCategory === worker.tradeCategory && j.status === 'open').slice(0, 5);
  }, [worker, jobs]);

  if (!HIRE_ENABLED) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Worker Profile' }} />
        <View style={styles.center}><Text style={styles.errorText}>Direct Hire is coming soon — the hiring marketplace isn&apos;t available yet.</Text></View>
      </View>
    );
  }

  if (!worker) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Worker Profile' }} />
        <View style={styles.center}><Text style={styles.errorText}>Worker not found</Text></View>
      </View>
    );
  }

  const availColor = AVAILABILITY_COLORS[worker.availability];

  const handleMessage = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const convoId = startConversation(
      ['you', worker.id],
      ['You', worker.name],
      `Hi ${worker.name}, I'd like to discuss a potential opportunity with you.`
    );
    router.push({ pathname: '/messages' as any, params: { id: convoId } });
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Worker Profile',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarText}>{worker.name.charAt(0)}</Text>
          </View>
          <Text style={styles.name}>{worker.name}</Text>
          <Text style={styles.trade}>{getTradeLabel(worker.tradeCategory)}</Text>
          <View style={[styles.availBadge, { backgroundColor: availColor + '15' }]}>
            <View style={[styles.availDot, { backgroundColor: availColor }]} />
            <Text style={[styles.availText, { color: availColor }]}>{AVAILABILITY_LABELS[worker.availability]}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Clock size={18} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Experience</Text>
            <Text style={styles.statValue}>{worker.yearsExperience} years</Text>
          </View>
          <View style={styles.statCard}>
            <DollarSign size={18} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Rate</Text>
            <Text style={styles.statValue}>${worker.hourlyRate}/hr</Text>
          </View>
          <View style={styles.statCard}>
            <MapPin size={18} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Location</Text>
            <Text style={styles.statValue}>{worker.city}, {worker.state}</Text>
          </View>
          <View style={styles.statCard}>
            <Briefcase size={18} color={themeColors.info} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Past Projects</Text>
            <Text style={styles.statValue}>{worker.pastProjects.length}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.bio}>{worker.bio}</Text>
        </View>

        {worker.licenses.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Licenses & Certifications</Text>
            {worker.licenses.map((lic, i) => (
              <View key={i} style={styles.licenseItem}>
                <Award size={14} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.licenseLabel}>{lic}</Text>
              </View>
            ))}
          </View>
        )}

        {worker.pastProjects.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Past Projects</Text>
            {worker.pastProjects.map((proj, i) => (
              <View key={i} style={styles.projectItem}>
                <View style={styles.projectDot} />
                <Text style={styles.projectText}>{proj}</Text>
              </View>
            ))}
          </View>
        )}

        {matchingJobs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Matching Open Jobs</Text>
            {matchingJobs.map(job => (
              <TouchableOpacity
                key={job.id}
                style={styles.jobRow}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/job-detail' as any, params: { id: job.id } });
                }}
              >
                <View style={styles.jobInfo}>
                  <Text style={styles.jobTitle} numberOfLines={1}>{job.title}</Text>
                  <Text style={styles.jobMeta}>{job.companyName} · {job.city}, {job.state}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.actionSection}>
          <TouchableOpacity style={styles.messageBtn} onPress={handleMessage}>
            <MessageCircle size={16} color="#FFF" strokeWidth={1.75} />
            <Text style={styles.messageBtnText}>Message {worker.name.split(' ')[0]}</Text>
          </TouchableOpacity>
          <View style={styles.contactRow}>
            <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(buildMailtoUrl({
              to: worker.contactEmail,
              subject: `Quick question — ${worker.name}`,
              body: [`Hi ${worker.name.split(' ')[0]},`, '', '', ...mailSignOff()],
            }))}>
              <Mail size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.contactBtnText}>Email</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(`tel:${worker.phone}`)}>
              <Phone size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.contactBtnText}>Call</Text>
            </TouchableOpacity>
          </View>
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
  profileHeader: { backgroundColor: t.surface, alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20, borderBottomWidth: 0.5, borderBottomColor: t.line },
  avatarLarge: { width: 72, height: 72, borderRadius: 36, backgroundColor: t.accent + '20', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 30, fontWeight: '800' as const, color: t.accent },
  name: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, marginBottom: 4 },
  trade: { fontSize: Type.subhead.fontSize, color: t.textSecondary, marginBottom: 8 },
  availBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  availDot: { width: 8, height: 8, borderRadius: 4 },
  availText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  statCard: { width: '48%' as any, backgroundColor: t.surface, padding: 14, borderRadius: Tokens.radius.card, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, textTransform: 'uppercase' as const, fontWeight: '600' as const },
  statValue: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text, textAlign: 'center' as const },
  section: { backgroundColor: t.surface, padding: 20, marginTop: 8 },
  sectionTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 10 },
  bio: { fontSize: Type.subhead.fontSize, color: t.text, lineHeight: 22 },
  licenseItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: t.line },
  licenseLabel: { fontSize: Type.bodyCompact.fontSize, color: t.text },
  projectItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  projectDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.accent },
  projectText: { fontSize: Type.bodyCompact.fontSize, color: t.text },
  jobRow: { paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: t.line },
  jobInfo: { flex: 1 },
  jobTitle: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text, marginBottom: 2 },
  jobMeta: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  actionSection: { padding: 20, gap: 12 },
  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent, paddingVertical: 16, borderRadius: Tokens.radius.card, gap: 8 },
  messageBtnText: { color: '#FFF', fontSize: Type.callout.fontSize, fontWeight: '700' as const },
  contactRow: { flexDirection: 'row', gap: 10 },
  contactBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent + '12', paddingVertical: 14, borderRadius: Tokens.radius.card, gap: 8 },
  contactBtnText: { color: t.accent, fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
});
