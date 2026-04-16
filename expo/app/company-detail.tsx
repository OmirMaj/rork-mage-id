import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MapPin, Star, Shield, Building2, Mail, Phone, Globe, Calendar, Users, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useCompanies } from '@/contexts/CompaniesContext';
import { useBids } from '@/contexts/BidsContext';
import { CERTIFICATIONS, CERT_COLORS } from '@/constants/certifications';
import type { BidCategory } from '@/types';

const BID_CATEGORY_LABELS: Record<BidCategory, string> = {
  construction: 'Construction', it_services: 'IT Services', environmental: 'Environmental',
  energy: 'Energy', infrastructure: 'Infrastructure', transportation: 'Transportation',
  utilities: 'Utilities', healthcare: 'Healthcare', education: 'Education', residential: 'Residential',
};

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

export default function CompanyDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { companies } = useCompanies();
  const { bids } = useBids();

  const company = useMemo(() => companies.find(c => c.id === id), [companies, id]);

  const eligibleBids = useMemo(() => {
    if (!company) return [];
    return bids.filter(b => {
      if (b.status !== 'open') return false;
      const meetsCapacity = company.bondCapacity >= b.bondRequired;
      const meetsCerts = (b.requiredCertifications ?? []).length === 0 ||
        (b.requiredCertifications ?? []).some(cert => (company.certifications ?? []).includes(cert));
      return meetsCapacity && meetsCerts;
    });
  }, [company, bids]);

  if (!company) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Company' }} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Company not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: company.companyName,
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileHeader}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarLargeText}>{company.companyName.charAt(0)}</Text>
          </View>
          <Text style={styles.companyName}>{company.companyName}</Text>
          <View style={styles.locationRow}>
            <MapPin size={14} color={Colors.textSecondary} />
            <Text style={styles.locationText}>{company.city}, {company.state}</Text>
          </View>
          <View style={styles.ratingRow}>
            <Star size={16} color="#F5A623" fill="#F5A623" />
            <Text style={styles.ratingText}>{company.rating.toFixed(1)}</Text>
            <Text style={styles.ratingDivider}>·</Text>
            <Text style={styles.categoryText}>{BID_CATEGORY_LABELS[company.primaryCategory]}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Shield size={20} color={Colors.accent} />
            <Text style={styles.statLabel}>Bond Capacity</Text>
            <Text style={styles.statValue}>{formatCurrency(company.bondCapacity)}</Text>
          </View>
          <View style={styles.statCard}>
            <Building2 size={20} color={Colors.primary} />
            <Text style={styles.statLabel}>Projects Done</Text>
            <Text style={styles.statValue}>{company.completedProjects}</Text>
          </View>
          {company.yearEstablished && (
            <View style={styles.statCard}>
              <Calendar size={20} color={Colors.textSecondary} />
              <Text style={styles.statLabel}>Established</Text>
              <Text style={styles.statValue}>{company.yearEstablished}</Text>
            </View>
          )}
          {company.employeeCount && (
            <View style={styles.statCard}>
              <Users size={20} color={Colors.info} />
              <Text style={styles.statLabel}>Employees</Text>
              <Text style={styles.statValue}>{company.employeeCount}</Text>
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.description}>{company.description}</Text>
        </View>

        {company.certifications.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Certifications & Designations</Text>
            <View style={styles.certGrid}>
              {company.certifications.map(certId => {
                const info = CERTIFICATIONS.find(c => c.id === certId);
                const color = CERT_COLORS[certId] || Colors.primary;
                return (
                  <View key={certId} style={[styles.certCard, { borderLeftColor: color }]}>
                    <Text style={[styles.certShort, { color }]}>{info?.shortLabel ?? certId}</Text>
                    <Text style={styles.certFull} numberOfLines={2}>{info?.label ?? certId}</Text>
                    <Text style={styles.certSource}>{info?.source ?? ''}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Eligible Bids</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{eligibleBids.length}</Text>
            </View>
          </View>
          <Text style={styles.sectionSubtitle}>Open bids within bond capacity and matching certifications</Text>
          {eligibleBids.length === 0 ? (
            <Text style={styles.noResults}>No matching open bids at this time</Text>
          ) : (
            eligibleBids.slice(0, 5).map(bid => (
              <TouchableOpacity
                key={bid.id}
                style={styles.bidRow}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/bid-detail' as any, params: { id: bid.id } });
                }}
              >
                <View style={styles.bidInfo}>
                  <Text style={styles.bidTitle} numberOfLines={1}>{bid.title}</Text>
                  <Text style={styles.bidMeta}>{bid.city}, {bid.state} · {formatCurrency(bid.estimatedValue)}</Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Contact</Text>
          <View style={styles.contactActions}>
            <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(`mailto:${company.contactEmail}`)}>
              <Mail size={16} color="#FFF" />
              <Text style={styles.contactBtnText}>Email</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.contactBtn, { backgroundColor: '#2E7D32' }]} onPress={() => void Linking.openURL(`tel:${company.phone}`)}>
              <Phone size={16} color="#FFF" />
              <Text style={styles.contactBtnText}>Call</Text>
            </TouchableOpacity>
            {company.website && (
              <TouchableOpacity style={[styles.contactBtn, { backgroundColor: Colors.info }]} onPress={() => void Linking.openURL(company.website!)}>
                <Globe size={16} color="#FFF" />
                <Text style={styles.contactBtnText}>Website</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: Colors.textSecondary },
  profileHeader: { backgroundColor: Colors.surface, alignItems: 'center', paddingVertical: 24, paddingHorizontal: 20, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  avatarLarge: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarLargeText: { fontSize: 30, fontWeight: '800' as const, color: Colors.primary },
  companyName: { fontSize: 22, fontWeight: '800' as const, color: Colors.text, marginBottom: 4, textAlign: 'center' as const },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  locationText: { fontSize: 14, color: Colors.textSecondary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 15, fontWeight: '700' as const, color: '#F5A623' },
  ratingDivider: { color: Colors.textMuted },
  categoryText: { fontSize: 14, color: Colors.textSecondary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  statCard: { width: '47%' as any, backgroundColor: Colors.surface, padding: 14, borderRadius: 12, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 11, color: Colors.textMuted, textTransform: 'uppercase' as const, fontWeight: '600' as const },
  statValue: { fontSize: 17, fontWeight: '800' as const, color: Colors.text },
  section: { backgroundColor: Colors.surface, padding: 20, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text, marginBottom: 8 },
  sectionSubtitle: { fontSize: 13, color: Colors.textSecondary, marginBottom: 12 },
  description: { fontSize: 15, color: Colors.text, lineHeight: 22 },
  certGrid: { gap: 8 },
  certCard: { backgroundColor: Colors.background, padding: 12, borderRadius: 8, borderLeftWidth: 3 },
  certShort: { fontSize: 13, fontWeight: '800' as const, marginBottom: 2 },
  certFull: { fontSize: 13, color: Colors.text },
  certSource: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  countBadge: { backgroundColor: Colors.primary, borderRadius: 10, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#FFF', fontSize: 12, fontWeight: '700' as const },
  noResults: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const, paddingVertical: 20 },
  bidRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  bidInfo: { flex: 1 },
  bidTitle: { fontSize: 15, fontWeight: '600' as const, color: Colors.text, marginBottom: 2 },
  bidMeta: { fontSize: 13, color: Colors.textSecondary },
  contactActions: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  contactBtnText: { color: '#FFF', fontSize: 14, fontWeight: '600' as const },
});

