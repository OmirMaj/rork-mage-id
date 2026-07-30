import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert, Platform,
} from 'react-native';
import ConstructionLoader from '@/components/ConstructionLoader';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { buildMailtoUrl, mailSignOff } from '@/utils/mailtoComposer';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { MapPin, Clock, DollarSign, Shield, ExternalLink, Mail, Building2, ChevronRight, Globe, Heart, Bookmark, Phone, FileText, Tag, Calendar, Users, ChevronDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeJsonParse } from '@/utils/safeJson';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useBids } from '@/contexts/BidsContext';
import { useCompanies } from '@/contexts/CompaniesContext';
import { CERTIFICATIONS, CERT_COLORS } from '@/constants/certifications';
import { supabase } from '@/lib/supabase';
import AIBidScorecard from '@/components/AIBidScorecard';
import type { PublicBid } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const TRACKED_BIDS_KEY = 'mageid_tracked_bids';

interface TrackedBid {
  bidId: string;
  status: 'saved' | 'interested' | 'preparing' | 'submitted' | 'won' | 'lost';
  notes: string;
  proposalAmount: number | null;
  savedAt: string;
}

interface CachedBidDetail {
  id: string;
  title: string;
  department?: string;
  /** Legacy alias kept so the rest of this file's existing reads
   *  compile. Prefer response_deadline — that's the DB column. */
  deadline?: string;
  response_deadline?: string;
  estimated_value: number;
  city: string;
  state: string;
  source_url?: string;
  set_aside?: string;
  description?: string;
  bid_type?: string;
  category?: string;
  bond_required?: number;
  contact_email?: string;
  contact_phone?: string;
  apply_url?: string;
  source_name?: string;
  posted_by?: string;
  posted_date?: string;
  naics_code?: string;
  solicitation_number?: string;
  pre_bid_date?: string;
  pre_bid_location?: string;
  scope_of_work?: string;
  documents_url?: string;
  required_certifications?: string[];
}

const BID_TYPE_LABELS: Record<string, string> = {
  federal: 'Federal', state: 'State', municipal: 'Municipal', county: 'County', private: 'Private',
};
const BID_CATEGORY_LABELS: Record<string, string> = {
  construction: 'Construction', it_services: 'IT Services', environmental: 'Environmental',
  energy: 'Energy', infrastructure: 'Infrastructure', transportation: 'Transportation',
  utilities: 'Utilities', healthcare: 'Healthcare', education: 'Education', residential: 'Residential',
};

const TRACKING_STATUSES = ['saved', 'interested', 'preparing', 'submitted', 'won', 'lost'] as const;
const STATUS_LABELS: Record<string, string> = {
  saved: 'Saved', interested: 'Interested', preparing: 'Preparing Proposal', submitted: 'Submitted', won: 'Won', lost: 'Lost',
};
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  saved: { bg: '#E3F2FD', text: '#1565C0' },
  interested: { bg: '#FFF3E0', text: '#E65100' },
  preparing: { bg: '#F3E5F5', text: '#7B1FA2' },
  submitted: { bg: '#E8F5E9', text: '#2E7D32' },
  won: { bg: '#E8F5E9', text: '#1B5E20' },
  lost: { bg: '#FFEBEE', text: '#C62828' },
};

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null || amount === 0) return 'Not specified';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'N/A';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dateStr; }
}

function getCountdown(deadline: string | null | undefined): { text: string; urgent: boolean } {
  if (!deadline) return { text: 'No deadline', urgent: false };
  const diff = new Date(deadline).getTime() - Date.now();
  if (isNaN(diff)) return { text: 'No deadline', urgent: false };
  if (diff <= 0) return { text: 'Expired', urgent: true };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days > 30) return { text: `${Math.floor(days / 30)} months left`, urgent: false };
  if (days > 0) return { text: `${days} days left`, urgent: days <= 7 };
  const hours = Math.floor(diff / (1000 * 60 * 60));
  return { text: `${hours} hours left`, urgent: true };
}

export default function BidDetailScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const layout = useResponsiveLayout();
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const router = useRouter();
  const { bids: localBids } = useBids();
  const { companies } = useCompanies();
  const [trackedBid, setTrackedBid] = useState<TrackedBid | null>(null);
  const [showStatusPicker, setShowStatusPicker] = useState(false);

  const { data: cachedBid, isLoading: cachedLoading } = useQuery({
    queryKey: ['cached_bid_detail', id],
    queryFn: async () => {
      if (source !== 'cached') return null;
      console.log('[BidDetail] Fetching cached bid:', id);
      const { data, error } = await supabase
        .from('cached_bids')
        .select('*')
        .eq('id', id)
        .single();
      if (error) {
        console.log('[BidDetail] Supabase error:', error.message);
        return null;
      }
      return data as CachedBidDetail;
    },
    enabled: source === 'cached' && !!id,
  });

  const localBid = useMemo(() => {
    if (source === 'cached') return null;
    return localBids.find(b => b.id === id) ?? null;
  }, [localBids, id, source]);

  useEffect(() => {
    AsyncStorage.getItem(TRACKED_BIDS_KEY).then(data => {
      const tracked = safeJsonParse<TrackedBid[]>(data, []);
      const found = tracked.find(t => t.bidId === id);
      if (found) setTrackedBid(found);
    }).catch(() => {});
  }, [id]);

  const saveTracking = useCallback(async (status: TrackedBid['status'] | null) => {
    try {
      const raw = await AsyncStorage.getItem(TRACKED_BIDS_KEY);
      let tracked: TrackedBid[] = raw ? JSON.parse(raw) : [];

      if (status === null) {
        tracked = tracked.filter(t => t.bidId !== id);
        setTrackedBid(null);
      } else {
        const existing = tracked.find(t => t.bidId === id);
        if (existing) {
          existing.status = status;
          setTrackedBid({ ...existing });
        } else {
          const newTracked: TrackedBid = {
            bidId: id ?? '',
            status,
            notes: '',
            proposalAmount: null,
            savedAt: new Date().toISOString(),
          };
          tracked.push(newTracked);
          setTrackedBid(newTracked);
        }
      }

      await AsyncStorage.setItem(TRACKED_BIDS_KEY, JSON.stringify(tracked));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.log('[BidDetail] Save tracking error:', err);
    }
  }, [id]);

  const handleToggleSave = useCallback(() => {
    if (trackedBid) {
      Alert.alert('Remove Bid', 'Remove this bid from your tracked bids?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void saveTracking(null) },
      ]);
    } else {
      void saveTracking('saved');
    }
  }, [trackedBid, saveTracking]);

  const handleStatusSelect = useCallback((status: TrackedBid['status']) => {
    void saveTracking(status);
    setShowStatusPicker(false);
  }, [saveTracking]);

  const title = cachedBid?.title ?? localBid?.title ?? 'Bid Details';
  const description = cachedBid?.description ?? localBid?.description ?? '';
  const city = cachedBid?.city ?? localBid?.city ?? '';
  const state = cachedBid?.state ?? localBid?.state ?? '';
  const estimatedValue = cachedBid?.estimated_value ?? localBid?.estimatedValue ?? 0;
  const bondRequired = cachedBid?.bond_required ?? localBid?.bondRequired ?? 0;
  // The cached_bids table column is `response_deadline`. Old code used
  // `cachedBid.deadline` which silently resolved to undefined and made
  // every detail page show "No deadline". Read both field names so any
  // older callers passing the alias still work.
  const deadline = (cachedBid as { response_deadline?: string; deadline?: string } | null)?.response_deadline
    ?? cachedBid?.deadline
    ?? localBid?.deadline
    ?? '';
  const bidType = cachedBid?.bid_type ?? localBid?.bidType ?? '';
  const category = cachedBid?.category ?? localBid?.category ?? '';
  const contactEmail = cachedBid?.contact_email ?? localBid?.contactEmail ?? '';
  const contactPhone = cachedBid?.contact_phone ?? '';
  const applyUrl = cachedBid?.apply_url ?? localBid?.applyUrl ?? '';
  const sourceUrl = cachedBid?.source_url ?? localBid?.sourceUrl ?? '';
  const sourceName = cachedBid?.source_name ?? localBid?.sourceName ?? '';
  const postedBy = cachedBid?.posted_by ?? localBid?.postedBy ?? '';
  const postedDate = cachedBid?.posted_date ?? localBid?.postedDate ?? '';
  const department = cachedBid?.department ?? (localBid as PublicBid | null)?.issuingAgency ?? '';
  const naicsCode = cachedBid?.naics_code ?? '';
  const solicitationNumber = cachedBid?.solicitation_number ?? '';
  const preBidDate = cachedBid?.pre_bid_date ?? '';
  const scopeOfWork = cachedBid?.scope_of_work ?? '';
  const documentsUrl = cachedBid?.documents_url ?? '';
  const requiredCerts = useMemo(() => cachedBid?.required_certifications ?? localBid?.requiredCertifications ?? [], [cachedBid?.required_certifications, localBid?.requiredCertifications]);
  const setAside = cachedBid?.set_aside ?? '';

  const countdown = getCountdown(deadline);

  const qualifiedCompanies = useMemo(() => {
    return companies.filter(c => {
      const meetsCapacity = bondRequired > 0 ? c.bondCapacity >= bondRequired : true;
      const meetsCerts = requiredCerts.length === 0 ||
        requiredCerts.some(cert => c.certifications.includes(cert as any));
      return meetsCapacity && meetsCerts;
    });
  }, [companies, bondRequired, requiredCerts]);

  const isLoading = source === 'cached' && cachedLoading;
  const bidNotFound = !isLoading && !cachedBid && !localBid;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Bid Details' }} />
        <View style={styles.centerContainer}>
          <ConstructionLoader size="lg" label="Loading bid details..." />
        </View>
      </View>
    );
  }

  if (bidNotFound) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Bid Details' }} />
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Bid not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Bid Details',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.scrollContent, layout.isDesktop && { maxWidth: 1400, alignSelf: 'center' as const, width: '100%' as any }]} showsVerticalScrollIndicator={false}>
        {layout.isDesktop ? (
          <View style={bidDesktopStyles.twoCol}>
            <View style={bidDesktopStyles.mainCol}>
              <View style={styles.topCard}>
                <View style={styles.topRow}>
                  <View style={styles.topBadges}>
                    {bidType ? <View style={[styles.typeBadge, { backgroundColor: themeColors.accent + '15' }]}><Text style={[styles.typeBadgeText, { color: themeColors.accent }]}>{BID_TYPE_LABELS[bidType] ?? bidType}</Text></View> : null}
                    {setAside ? <View style={[styles.typeBadge, { backgroundColor: Colors.successLight }]}><Text style={[styles.typeBadgeText, { color: Colors.successDark }]}>{setAside}</Text></View> : null}
                  </View>
                </View>
                <Text style={styles.bidTitle}>{title}</Text>
                {department ? <Text style={styles.agency}>{department}</Text> : null}
                {(city || state) ? <View style={styles.locationRow}><MapPin size={14} color={themeColors.textSecondary} strokeWidth={1.75} /><Text style={styles.locationText}>{[city, state].filter(Boolean).join(', ')}</Text></View> : null}
              </View>
              {description ? <View style={styles.section}><Text style={styles.sectionTitle}>Description</Text><Text style={styles.description}>{description}</Text></View> : null}
              {scopeOfWork ? <View style={styles.section}><Text style={styles.sectionTitle}>Scope of Work</Text><Text style={styles.description}>{scopeOfWork}</Text></View> : null}
              {requiredCerts.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Required Certifications</Text>
                  <View style={styles.certGrid}>
                    {requiredCerts.map((certId, idx) => {
                      const info = CERTIFICATIONS.find(c => c.id === certId);
                      const color = CERT_COLORS[certId] || themeColors.accent;
                      return <View key={`${certId}-${idx}`} style={[styles.certCard, { borderLeftColor: color }]}><Text style={[styles.certShort, { color }]}>{info?.shortLabel ?? certId}</Text><Text style={styles.certFull} numberOfLines={2}>{info?.label ?? certId}</Text></View>;
                    })}
                  </View>
                </View>
              )}
              <View style={styles.section}>
                <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Qualified Companies</Text><View style={styles.countBadge}><Text style={styles.countText}>{qualifiedCompanies.length}</Text></View></View>
                {qualifiedCompanies.length === 0 ? <Text style={styles.noResults}>No companies match</Text> : qualifiedCompanies.slice(0, 5).map(company => (
                  <TouchableOpacity key={company.id} style={styles.companyRow} onPress={() => { if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push({ pathname: '/company-detail' as any, params: { id: company.id } }); }}>
                    <View style={styles.companyInfo}><Text style={styles.companyName}>{company.companyName}</Text><Text style={styles.companyMeta}>{company.city}, {company.state}</Text></View>
                    <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={bidDesktopStyles.sideCol}>
              {trackedBid && <View style={[styles.statusBadgeLarge, { backgroundColor: STATUS_COLORS[trackedBid.status]?.bg ?? Colors.infoLight, marginBottom: 12 }]}><Text style={[styles.statusBadgeLargeText, { color: STATUS_COLORS[trackedBid.status]?.text ?? Colors.infoDark }]}>{STATUS_LABELS[trackedBid.status]}</Text></View>}
              <View style={[styles.statsGrid, { padding: 0, flexDirection: 'column' as const }]}>
                <View style={[styles.statCard, { width: '100%' as any }]}><DollarSign size={18} color={themeColors.accent} strokeWidth={1.75} /><Text style={styles.statLabel}>Estimated Value</Text><Text style={styles.statValue}>{formatCurrency(estimatedValue)}</Text></View>
                <View style={[styles.statCard, { width: '100%' as any }]}><Clock size={18} color={countdown.urgent ? themeColors.danger : themeColors.textSecondary} strokeWidth={1.75} /><Text style={styles.statLabel}>Deadline</Text><Text style={[styles.statValue, countdown.urgent && { color: themeColors.danger }]}>{countdown.text}</Text><Text style={styles.statSub}>{formatDate(deadline)}</Text></View>
                <View style={[styles.statCard, { width: '100%' as any }]}><Shield size={18} color={themeColors.accent} strokeWidth={1.75} /><Text style={styles.statLabel}>Bond Required</Text><Text style={styles.statValue}>{formatCurrency(bondRequired)}</Text></View>
              </View>
              {(contactEmail || contactPhone) ? (
                <View style={[styles.contactCard, { marginTop: 12 }]}>
                  {postedBy ? <Text style={styles.postedLabel}>Posted by: {postedBy}</Text> : null}
                  <View style={styles.contactActions}>
                    {contactEmail ? <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(buildMailtoUrl({
                    to: contactEmail!,
                    subject: `Question about RFP — ${title}`,
                    body: [
                      postedBy ? `Hi ${postedBy.split(' ')[0]},` : 'Hi,',
                      '',
                      `I'm reviewing the bid package for "${title}" and have a quick question before submitting.`,
                      '',
                      '',
                      ...mailSignOff(),
                    ],
                  }))}><Mail size={16} color="#FFF" strokeWidth={1.75} /><Text style={styles.contactBtnText}>Email</Text></TouchableOpacity> : null}
                    {contactPhone ? <TouchableOpacity style={[styles.contactBtn, { backgroundColor: themeColors.success }]} onPress={() => void Linking.openURL(`tel:${contactPhone}`)}><Phone size={16} color="#FFF" strokeWidth={1.75} /><Text style={styles.contactBtnText}>Call</Text></TouchableOpacity> : null}
                  </View>
                  {sourceUrl ? <TouchableOpacity style={styles.sourceLink} onPress={() => void Linking.openURL(sourceUrl)}><Globe size={14} color={themeColors.accent} strokeWidth={1.75} /><Text style={styles.sourceLinkText}>{sourceName || 'View on Portal'}</Text><ExternalLink size={12} color={themeColors.accent} strokeWidth={1.75} /></TouchableOpacity> : null}
                </View>
              ) : null}
              <View style={[styles.contactActions, { marginTop: 12, flexDirection: 'column' as const, gap: 8 }]}>
                <TouchableOpacity style={[styles.actionBtn, trackedBid ? styles.actionBtnSaved : styles.actionBtnOutline, { width: '100%' as any, justifyContent: 'center' as const }]} onPress={handleToggleSave} activeOpacity={0.8}>
                  <Heart size={18} color={trackedBid ? '#FFF' : themeColors.accent} fill={trackedBid ? '#FFF' : 'none'} strokeWidth={1.75} />
                  <Text style={[styles.actionBtnText, trackedBid ? styles.actionBtnTextSaved : styles.actionBtnTextOutline]}>{trackedBid ? 'Saved' : 'Save Bid'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnTrack, { width: '100%' as any }]} onPress={() => setShowStatusPicker(true)} activeOpacity={0.8}>
                  <Bookmark size={18} color="#FFF" strokeWidth={1.75} />
                  <Text style={styles.actionBtnTextWhite}>{trackedBid ? STATUS_LABELS[trackedBid.status] : 'Track Status'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : (
          <>
        <View style={styles.topCard}>
          <View style={styles.topRow}>
            <View style={styles.topBadges}>
              {bidType ? (
                <View style={[styles.typeBadge, { backgroundColor: themeColors.accent + '15' }]}>
                  <Text style={[styles.typeBadgeText, { color: themeColors.accent }]}>{BID_TYPE_LABELS[bidType] ?? bidType}</Text>
                </View>
              ) : null}
              {setAside ? (
                <View style={[styles.typeBadge, { backgroundColor: Colors.successLight }]}>
                  <Text style={[styles.typeBadgeText, { color: Colors.successDark }]}>{setAside}</Text>
                </View>
              ) : null}
            </View>
            {trackedBid && (
              <View style={[styles.statusBadgeLarge, { backgroundColor: STATUS_COLORS[trackedBid.status]?.bg ?? '#E3F2FD' }]}>
                <Text style={[styles.statusBadgeLargeText, { color: STATUS_COLORS[trackedBid.status]?.text ?? Colors.infoDark }]}>
                  {STATUS_LABELS[trackedBid.status]}
                </Text>
              </View>
            )}
          </View>

          <Text style={styles.bidTitle}>{title}</Text>
          {department ? <Text style={styles.agency}>{department}</Text> : null}

          {(city || state) ? (
            <View style={styles.locationRow}>
              <MapPin size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
              <Text style={styles.locationText}>{[city, state].filter(Boolean).join(', ')}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <DollarSign size={18} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Estimated Value</Text>
            <Text style={styles.statValue}>{formatCurrency(estimatedValue)}</Text>
          </View>
          <View style={styles.statCard}>
            <Shield size={18} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Bond Required</Text>
            <Text style={styles.statValue}>{formatCurrency(bondRequired)}</Text>
          </View>
          <View style={styles.statCard}>
            <Clock size={18} color={countdown.urgent ? themeColors.danger : themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Deadline</Text>
            <Text style={[styles.statValue, countdown.urgent && { color: themeColors.danger }]}>{countdown.text}</Text>
            <Text style={styles.statSub}>{formatDate(deadline)}</Text>
          </View>
          <View style={styles.statCard}>
            <Building2 size={18} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.statLabel}>Category</Text>
            <Text style={styles.statValue}>{BID_CATEGORY_LABELS[category] ? BID_CATEGORY_LABELS[category] : (category || 'General')}</Text>
          </View>
        </View>

        {description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{description}</Text>
          </View>
        ) : null}

        {scopeOfWork ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Scope of Work</Text>
            <Text style={styles.description}>{scopeOfWork}</Text>
          </View>
        ) : null}

        {(postedDate || deadline || preBidDate) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Important Dates</Text>
            <View style={styles.dateGrid}>
              {postedDate ? (
                <View style={styles.dateItem}>
                  <Calendar size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                  <View>
                    <Text style={styles.dateLabel}>Posted</Text>
                    <Text style={styles.dateValue}>{formatDate(postedDate)}</Text>
                  </View>
                </View>
              ) : null}
              {deadline ? (
                <View style={styles.dateItem}>
                  <Clock size={14} color={countdown.urgent ? themeColors.danger : themeColors.textSecondary} strokeWidth={1.75} />
                  <View>
                    <Text style={styles.dateLabel}>Deadline</Text>
                    <Text style={[styles.dateValue, countdown.urgent && { color: themeColors.danger }]}>{formatDate(deadline)}</Text>
                  </View>
                </View>
              ) : null}
              {preBidDate ? (
                <View style={styles.dateItem}>
                  <Users size={14} color={themeColors.info} strokeWidth={1.75} />
                  <View>
                    <Text style={styles.dateLabel}>Pre-Bid Conference</Text>
                    <Text style={styles.dateValue}>{formatDate(preBidDate)}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {(naicsCode || solicitationNumber) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Requirements</Text>
            <View style={styles.reqGrid}>
              {naicsCode ? (
                <View style={styles.reqItem}>
                  <Tag size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.reqLabel}>NAICS Code</Text>
                  <Text style={styles.reqValue}>{naicsCode}</Text>
                </View>
              ) : null}
              {solicitationNumber ? (
                <View style={styles.reqItem}>
                  <FileText size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
                  <Text style={styles.reqLabel}>Solicitation #</Text>
                  <Text style={styles.reqValue}>{solicitationNumber}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        {requiredCerts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Required Certifications</Text>
            <View style={styles.certGrid}>
              {requiredCerts.map((certId, idx) => {
                const info = CERTIFICATIONS.find(c => c.id === certId);
                const color = CERT_COLORS[certId] || themeColors.accent;
                return (
                  <View key={`${certId}-${idx}`} style={[styles.certCard, { borderLeftColor: color }]}>
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
            <Text style={styles.sectionTitle}>Qualified Companies</Text>
            <View style={styles.countBadge}>
              <Text style={styles.countText}>{qualifiedCompanies.length}</Text>
            </View>
          </View>
          <Text style={styles.sectionSubtitle}>Companies with matching bond capacity and certifications</Text>
          {qualifiedCompanies.length === 0 ? (
            <Text style={styles.noResults}>No companies currently match this bid's requirements</Text>
          ) : (
            qualifiedCompanies.slice(0, 5).map(company => (
              <TouchableOpacity
                key={company.id}
                style={styles.companyRow}
                onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push({ pathname: '/company-detail' as any, params: { id: company.id } });
                }}
              >
                <View style={styles.companyInfo}>
                  <Text style={styles.companyName}>{company.companyName}</Text>
                  <Text style={styles.companyMeta}>{company.city}, {company.state} · Bond: {formatCurrency(company.bondCapacity)}</Text>
                  <View style={styles.companyCerts}>
                    {company.certifications.slice(0, 3).map(c => {
                      const ci = CERTIFICATIONS.find(x => x.id === c);
                      return (
                        <View key={c} style={styles.miniCertBadge}>
                          <Text style={styles.miniCertText}>{ci?.shortLabel ?? c}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            ))
          )}
        </View>

        {(contactEmail || contactPhone || postedBy) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact & Links</Text>
            <View style={styles.contactCard}>
              {postedBy ? <Text style={styles.postedLabel}>Posted by: {postedBy}</Text> : null}
              {postedDate ? <Text style={styles.postedDate}>Posted: {formatDate(postedDate)}</Text> : null}
              <View style={styles.contactActions}>
                {contactEmail ? (
                  <TouchableOpacity style={styles.contactBtn} onPress={() => void Linking.openURL(buildMailtoUrl({
                    to: contactEmail!,
                    subject: `Question about RFP — ${title}`,
                    body: [
                      postedBy ? `Hi ${postedBy.split(' ')[0]},` : 'Hi,',
                      '',
                      `I'm reviewing the bid package for "${title}" and have a quick question before submitting.`,
                      '',
                      '',
                      ...mailSignOff(),
                    ],
                  }))}>
                    <Mail size={16} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.contactBtnText}>Email</Text>
                  </TouchableOpacity>
                ) : null}
                {contactPhone ? (
                  <TouchableOpacity style={[styles.contactBtn, { backgroundColor: themeColors.success }]} onPress={() => void Linking.openURL(`tel:${contactPhone}`)}>
                    <Phone size={16} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.contactBtnText}>Call</Text>
                  </TouchableOpacity>
                ) : null}
                {applyUrl ? (
                  <TouchableOpacity style={[styles.contactBtn, { backgroundColor: themeColors.accent }]} onPress={() => void Linking.openURL(applyUrl)}>
                    <ExternalLink size={16} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.contactBtnText}>Apply</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {documentsUrl ? (
                <TouchableOpacity style={styles.sourceLink} onPress={() => void Linking.openURL(documentsUrl)}>
                  <FileText size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.sourceLinkText}>View Documents</Text>
                  <ExternalLink size={12} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              ) : null}
              {sourceUrl ? (
                <TouchableOpacity style={styles.sourceLink} onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  void Linking.openURL(sourceUrl);
                }}>
                  <Globe size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.sourceLinkText}>{sourceName || 'View on Procurement Portal'}</Text>
                  <ExternalLink size={12} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : null}

        <AIBidScorecard
          bid={{
            id: (id as string) ?? title,
            title,
            department: department || postedBy || 'Agency',
            estimated_value: estimatedValue,
            naics_code: naicsCode,
            set_aside: setAside || null,
            state,
            description: description || scopeOfWork,
          }}
          testID="bid-ai-scorecard"
        />

        <View style={{ height: 120 }} />
          </>
        )}
      </ScrollView>

      {!layout.isDesktop && <View style={styles.actionBar}>
        <TouchableOpacity
          style={[styles.actionBtn, trackedBid ? styles.actionBtnSaved : styles.actionBtnOutline]}
          onPress={handleToggleSave}
          activeOpacity={0.8}
        >
          <Heart size={18} color={trackedBid ? '#FFF' : themeColors.accent} fill={trackedBid ? '#FFF' : 'none'} strokeWidth={1.75} />
          <Text style={[styles.actionBtnText, trackedBid ? styles.actionBtnTextSaved : styles.actionBtnTextOutline]}>
            {trackedBid ? 'Saved' : 'Save'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnTrack]}
          onPress={() => setShowStatusPicker(true)}
          activeOpacity={0.8}
        >
          <Bookmark size={18} color="#FFF" strokeWidth={1.75} />
          <Text style={styles.actionBtnTextWhite}>
            {trackedBid ? STATUS_LABELS[trackedBid.status] : 'Track Status'}
          </Text>
          <ChevronDown size={14} color="rgba(255,255,255,0.7)" strokeWidth={1.75} />
        </TouchableOpacity>

        {sourceUrl ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPortal]}
            onPress={() => void Linking.openURL(sourceUrl)}
            activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Open website">
            <Globe size={18} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>
        ) : null}
      </View>}

      {showStatusPicker && (
        <TouchableOpacity
          style={styles.pickerOverlay}
          activeOpacity={1}
          onPress={() => setShowStatusPicker(false)}
        >
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>Track Bid Status</Text>
            {TRACKING_STATUSES.map(status => (
              <TouchableOpacity
                key={status}
                style={[styles.pickerOption, trackedBid?.status === status && { backgroundColor: STATUS_COLORS[status]?.bg }]}
                onPress={() => handleStatusSelect(status)}
                activeOpacity={0.7}
              >
                <View style={[styles.pickerDot, { backgroundColor: STATUS_COLORS[status]?.text ?? themeColors.accent }]} />
                <Text style={[styles.pickerOptionText, trackedBid?.status === status && { color: STATUS_COLORS[status]?.text, fontWeight: '700' as const }]}>
                  {STATUS_LABELS[status]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  errorText: { fontSize: Type.callout.fontSize, color: t.textSecondary },
  topCard: { backgroundColor: t.surface, padding: 20, borderBottomWidth: 0.5, borderBottomColor: t.line },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  topBadges: { flexDirection: 'row', gap: 6, flex: 1 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.xs },
  typeBadgeText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, textTransform: 'uppercase' as const },
  statusBadgeLarge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  statusBadgeLargeText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  bidTitle: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: t.text, lineHeight: 28, marginBottom: 6 },
  agency: { fontSize: Type.subhead.fontSize, color: t.textSecondary, marginBottom: 8 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 8 },
  statCard: { width: '47%' as any, backgroundColor: t.surface, padding: 14, borderRadius: Tokens.radius.card, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, textTransform: 'uppercase' as const, fontWeight: '600' as const },
  statValue: { fontSize: Type.callout.fontSize, fontWeight: '800' as const, color: t.text, textAlign: 'center' as const },
  statSub: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  section: { backgroundColor: t.surface, padding: 20, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 8 },
  sectionSubtitle: { fontSize: Type.footnote.fontSize, color: t.textSecondary, marginBottom: 12 },
  description: { fontSize: Type.subhead.fontSize, color: t.text, lineHeight: 22 },
  dateGrid: { gap: 12 },
  dateItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dateLabel: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '500' as const },
  dateValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  reqGrid: { gap: 10 },
  reqItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reqLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, flex: 1 },
  reqValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  certGrid: { gap: 8 },
  certCard: { backgroundColor: t.bg, padding: 12, borderRadius: Tokens.radius.sm, borderLeftWidth: 3 },
  certShort: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, marginBottom: 2 },
  certFull: { fontSize: Type.footnote.fontSize, color: t.text },
  certSource: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  countBadge: { backgroundColor: t.accent, borderRadius: Tokens.radius.md, width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#FFF', fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  noResults: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, textAlign: 'center' as const, paddingVertical: 20 },
  companyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: t.line },
  companyInfo: { flex: 1 },
  companyName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text, marginBottom: 2 },
  companyMeta: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  companyCerts: { flexDirection: 'row', gap: 4, marginTop: 4 },
  miniCertBadge: { backgroundColor: Colors.successLight, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 3 },
  miniCertText: { fontSize: 9, fontWeight: '700' as const, color: Colors.successDark },
  contactCard: { backgroundColor: t.bg, padding: 16, borderRadius: Tokens.radius.card, gap: 8 },
  postedLabel: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text },
  postedDate: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  contactActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.accent, paddingHorizontal: 16, paddingVertical: 10, borderRadius: Tokens.radius.md },
  contactBtnText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const },
  sourceLink: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: t.line },
  sourceLinkText: { fontSize: Type.footnote.fontSize, color: t.accent, fontWeight: '600' as const, flex: 1 },
  actionBar: {
    position: 'absolute' as const, bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 34,
    backgroundColor: t.surface,
    borderTopWidth: 0.5, borderTopColor: t.line,
    shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 10,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 12, borderRadius: Tokens.radius.card },
  actionBtnOutline: { backgroundColor: t.accent + '10', borderWidth: 1, borderColor: t.accent + '30' },
  actionBtnSaved: { backgroundColor: t.accent },
  actionBtnTrack: { flex: 1, backgroundColor: t.accent, justifyContent: 'center' as const },
  actionBtnPortal: { backgroundColor: t.accent + '10', borderWidth: 1, borderColor: t.accent + '30' },
  actionBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const },
  actionBtnTextOutline: { color: t.accent },
  actionBtnTextSaved: { color: '#FFF' },
  actionBtnTextWhite: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: '#FFF' },
  pickerOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' as const },
  pickerCard: { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  pickerTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 16 },
  pickerOption: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: Tokens.radius.md, marginBottom: 4 },
  pickerDot: { width: 10, height: 10, borderRadius: 5 },
  pickerOptionText: { fontSize: Type.callout.fontSize, color: t.text, fontWeight: '500' as const },
});

const bidDesktopStyles = StyleSheet.create({
  twoCol: {
    flexDirection: 'row',
    gap: 20,
    padding: 20,
  },
  mainCol: {
    flex: 3,
    gap: 8,
  },
  sideCol: {
    flex: 2,
    gap: 8,
  },
});
