import React, { useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Linking, Alert, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import {
  MapPin, Clock, DollarSign, Briefcase, Award, Mail, Phone, MessageCircle,
  Globe, Shield, Building2, Star, Users, ChevronRight,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useProfile } from '@/contexts/ProfileContext';
import { useHire } from '@/contexts/HireContext';
import { useAuth } from '@/contexts/AuthContext';
import { getTradeLabel } from '@/constants/trades';
import type { ContractorProfile, ProfileAvailability } from '@/types';

const AVAIL_MAP: Record<ProfileAvailability, { label: string; color: string }> = {
  available: { label: 'Available for work', color: '#34C759' },
  busy: { label: 'Busy', color: '#FF9500' },
  not_taking_work: { label: 'Not taking work', color: '#FF3B30' },
};

export default function ProfileViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { directoryProfiles, myProfile } = useProfile();
  const { startConversation } = useHire();
  const { user } = useAuth();

  const profile = useMemo<ContractorProfile | null>(() => {
    if (myProfile?.id === id) return myProfile;
    return directoryProfiles.find(p => p.id === id) ?? null;
  }, [directoryProfiles, myProfile, id]);

  const isOwnProfile = myProfile?.id === id;

  const handleMessage = useCallback(() => {
    if (!profile || !user) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const convoId = startConversation(
      [user.id, profile.userId],
      [user.name || 'You', profile.name],
      `Hi ${profile.name}, I'd like to discuss a potential opportunity with you.`
    );
    router.push({ pathname: '/messages' as any, params: { id: convoId } });
  }, [profile, user, startConversation, router]);

  const handleRequestQuote = useCallback(() => {
    if (!profile || !user) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const convoId = startConversation(
      [user.id, profile.userId],
      [user.name || 'You', profile.name],
      `Hi ${profile.name}, I'd like to request a quote for a project. Could we discuss the details?`
    );
    router.push({ pathname: '/messages' as any, params: { id: convoId } });
  }, [profile, user, startConversation, router]);

  if (!profile) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Profile' }} />
        <View style={styles.center}><Text style={styles.errorText}>Profile not found</Text></View>
      </View>
    );
  }

  const avail = AVAIL_MAP[profile.availability] ?? AVAIL_MAP.available;
  const showContact = profile.contactVisibility === 'public' || isOwnProfile;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Profile',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.heroSection}>
          {profile.profilePhotoUri ? (
            <Image source={{ uri: profile.profilePhotoUri }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>
            </View>
          )}
          <Text style={styles.name}>{profile.name}</Text>
          {profile.headline ? <Text style={styles.headline}>{profile.headline}</Text> : null}
          <Text style={styles.trade}>{getTradeLabel(profile.tradeCategory)}</Text>
          {profile.companyName ? <Text style={styles.company}>{profile.companyName}</Text> : null}

          {profile.rating > 0 && (
            <View style={styles.ratingRow}>
              <Star size={14} color="#FFB800" fill="#FFB800" />
              <Text style={styles.ratingText}>{profile.rating.toFixed(1)}</Text>
              <Text style={styles.reviewCount}>({profile.reviewCount} reviews)</Text>
            </View>
          )}

          {(profile.city || profile.state) && (
            <View style={styles.locationRow}>
              <MapPin size={13} color={Colors.textSecondary} />
              <Text style={styles.locationText}>{[profile.city, profile.state].filter(Boolean).join(', ')}</Text>
            </View>
          )}

          <View style={[styles.availBadge, { backgroundColor: avail.color + '15' }]}>
            <View style={[styles.availDot, { backgroundColor: avail.color }]} />
            <Text style={[styles.availText, { color: avail.color }]}>{avail.label}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Clock size={16} color={Colors.primary} />
            <Text style={styles.statValue}>{profile.yearsExperience}y</Text>
            <Text style={styles.statLabel}>Experience</Text>
          </View>
          {profile.hourlyRate > 0 && (
            <View style={styles.statCard}>
              <DollarSign size={16} color={Colors.accent} />
              <Text style={styles.statValue}>${profile.hourlyRate}/hr</Text>
              <Text style={styles.statLabel}>Rate</Text>
            </View>
          )}
          {(profile.portfolio || []).length > 0 && (
            <View style={styles.statCard}>
              <Briefcase size={16} color={Colors.info} />
              <Text style={styles.statValue}>{(profile.portfolio || []).length}</Text>
              <Text style={styles.statLabel}>Projects</Text>
            </View>
          )}
        </View>

        {profile.bio ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </View>
        ) : null}

        {(profile.skills || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Skills & Trades</Text>
            <View style={styles.tagsRow}>
              {(profile.skills || []).map(s => (
                <View key={s} style={styles.tag}>
                  <Text style={styles.tagText}>{s}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {(profile.licenses || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Licenses & Certifications</Text>
            {(profile.licenses || []).map(lic => (
              <View key={lic.id} style={styles.licItem}>
                <Award size={14} color={Colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.licName}>{lic.name}</Text>
                  {lic.number ? <Text style={styles.licDetail}>#{lic.number}</Text> : null}
                  {lic.issuingAuthority ? <Text style={styles.licDetail}>{lic.issuingAuthority}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {(profile.experience || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Experience</Text>
            {(profile.experience || []).map(exp => (
              <View key={exp.id} style={styles.expItem}>
                <View style={styles.expDot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.expCompany}>{exp.companyName}</Text>
                  <Text style={styles.expTitle}>{exp.title}</Text>
                  <Text style={styles.expPeriod}>
                    {exp.startDate} — {exp.isCurrent ? 'Present' : (exp.endDate || 'N/A')}
                    {exp.city ? ` · ${exp.city}, ${exp.state}` : ''}
                  </Text>
                  {exp.description ? <Text style={styles.expDesc}>{exp.description}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {(profile.companyName || profile.yearFounded || profile.employeeRange) && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Company Details</Text>
            <View style={styles.detailsGrid}>
              {profile.companyName ? <DetailRow icon={Building2} label="Company" value={profile.companyName} /> : null}
              {profile.yearFounded ? <DetailRow icon={Clock} label="Founded" value={String(profile.yearFounded)} /> : null}
              {profile.employeeRange ? <DetailRow icon={Users} label="Employees" value={profile.employeeRange} /> : null}
              {profile.revenueRange ? <DetailRow icon={DollarSign} label="Revenue" value={profile.revenueRange} /> : null}
              {profile.bondCapacity ? <DetailRow icon={Shield} label="Bond Cap." value={`$${(profile.bondCapacity / 1000000).toFixed(1)}M`} /> : null}
              {profile.insuranceCoverage ? <DetailRow icon={Shield} label="Insurance" value={profile.insuranceCoverage} /> : null}
              {profile.serviceArea ? <DetailRow icon={MapPin} label="Service Area" value={profile.serviceArea} /> : null}
              {profile.website ? <DetailRow icon={Globe} label="Website" value={profile.website} onPress={() => Linking.openURL(`https://${profile.website!.replace(/^https?:\/\//, '')}`).catch(() => {})} /> : null}
            </View>
          </View>
        )}

        {(profile.businessCertifications || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Business Certifications</Text>
            <View style={styles.tagsRow}>
              {(profile.businessCertifications || []).map(c => (
                <View key={c} style={[styles.tag, { backgroundColor: Colors.accent + '12' }]}>
                  <Text style={[styles.tagText, { color: Colors.accent }]}>{c}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {showContact && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact</Text>
            {profile.contactEmail ? (
              <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`mailto:${profile.contactEmail}`).catch(() => {})}>
                <Mail size={16} color={Colors.primary} />
                <Text style={styles.contactText}>{profile.contactEmail}</Text>
              </TouchableOpacity>
            ) : null}
            {profile.phone ? (
              <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`tel:${profile.phone}`).catch(() => {})}>
                <Phone size={16} color={Colors.primary} />
                <Text style={styles.contactText}>{profile.phone}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        {!isOwnProfile && (
          <View style={styles.actionsSection}>
            <TouchableOpacity style={styles.messageBtn} onPress={handleMessage} activeOpacity={0.85}>
              <MessageCircle size={18} color="#FFF" />
              <Text style={styles.messageBtnText}>Message</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quoteBtn} onPress={handleRequestQuote} activeOpacity={0.85}>
              <Text style={styles.quoteBtnText}>Request Quote</Text>
            </TouchableOpacity>
          </View>
        )}

        {isOwnProfile && (
          <TouchableOpacity style={styles.editBtn} onPress={() => router.push('/contractor-profile' as any)} activeOpacity={0.85}>
            <Text style={styles.editBtnText}>Edit Profile</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function DetailRow({ icon: Icon, label, value, onPress }: {
  icon: React.ElementType; label: string; value: string; onPress?: () => void;
}) {
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.detailRow} onPress={onPress} activeOpacity={0.7}>
      <Icon size={14} color={Colors.textSecondary} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, onPress && { color: Colors.primary }]} numberOfLines={1}>{value}</Text>
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: Colors.textSecondary },
  heroSection: { backgroundColor: Colors.surface, alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: 14 },
  avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  avatarLetter: { fontSize: 36, fontWeight: '800' as const, color: Colors.primary },
  name: { fontSize: 24, fontWeight: '800' as const, color: Colors.text, marginBottom: 2 },
  headline: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, paddingHorizontal: 20, marginBottom: 4, lineHeight: 20 },
  trade: { fontSize: 15, fontWeight: '600' as const, color: Colors.primary, marginBottom: 2 },
  company: { fontSize: 14, color: Colors.textSecondary, marginBottom: 6 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  ratingText: { fontSize: 14, fontWeight: '700' as const, color: Colors.text },
  reviewCount: { fontSize: 13, color: Colors.textSecondary },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  locationText: { fontSize: 13, color: Colors.textSecondary },
  availBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  availDot: { width: 8, height: 8, borderRadius: 4 },
  availText: { fontSize: 13, fontWeight: '600' as const },
  statsRow: { flexDirection: 'row', padding: 12, gap: 8 },
  statCard: { flex: 1, backgroundColor: Colors.surface, padding: 14, borderRadius: 12, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const },
  section: { backgroundColor: Colors.surface, marginTop: 8, padding: 20 },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 12 },
  bioText: { fontSize: 15, color: Colors.text, lineHeight: 23 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: Colors.primary + '12', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  tagText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  licItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  licName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  licDetail: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  expItem: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  expDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 6 },
  expCompany: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  expTitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  expPeriod: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  expDesc: { fontSize: 14, color: Colors.text, lineHeight: 20, marginTop: 6 },
  detailsGrid: { gap: 2 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  detailLabel: { fontSize: 13, color: Colors.textSecondary, width: 80 },
  detailValue: { flex: 1, fontSize: 14, fontWeight: '500' as const, color: Colors.text, textAlign: 'right' as const },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  contactText: { fontSize: 15, color: Colors.primary },
  actionsSection: { padding: 20, gap: 10 },
  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12, gap: 8 },
  messageBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
  quoteBtn: { alignItems: 'center', backgroundColor: Colors.primary + '12', paddingVertical: 14, borderRadius: 12 },
  quoteBtnText: { color: Colors.primary, fontSize: 16, fontWeight: '700' as const },
  editBtn: { marginHorizontal: 20, marginTop: 16, alignItems: 'center', backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12 },
  editBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
});

