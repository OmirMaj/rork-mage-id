import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform, Modal, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { ChevronDown, X, AlertTriangle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useBids } from '@/contexts/BidsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { CERTIFICATIONS } from '@/constants/certifications';
import { US_STATES } from '@/constants/regions';
import { supabase } from '@/lib/supabase';
import type { PublicBid, BidType, BidCategory, CertificationType, SubscriptionTier } from '@/types';
import { generateUUID } from '@/utils/generateId';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BID_TYPES: { id: BidType; label: string }[] = [
  { id: 'federal', label: 'Federal' }, { id: 'state', label: 'State' },
  { id: 'municipal', label: 'Municipal' }, { id: 'county', label: 'County' }, { id: 'private', label: 'Private' },
];

const BID_CATEGORIES: { id: BidCategory; label: string }[] = [
  { id: 'construction', label: 'Construction' }, { id: 'it_services', label: 'IT Services' },
  { id: 'environmental', label: 'Environmental' }, { id: 'energy', label: 'Energy' },
  { id: 'infrastructure', label: 'Infrastructure' }, { id: 'transportation', label: 'Transportation' },
  { id: 'utilities', label: 'Utilities' }, { id: 'healthcare', label: 'Healthcare' },
  { id: 'education', label: 'Education' }, { id: 'residential', label: 'Residential' },
];

const POSTING_LIMITS: Record<SubscriptionTier, number> = {
  free: 2,
  pro: 8,
  business: 25,
};

const RATE_LIMIT_KEY = 'mageid_bid_post_timestamps';

async function getHourlyPostCount(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(RATE_LIMIT_KEY);
    if (!raw) return 0;
    const timestamps: number[] = JSON.parse(raw);
    const oneHourAgo = Date.now() - 3600000;
    const recent = timestamps.filter(t => t > oneHourAgo);
    await AsyncStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(recent));
    return recent.length;
  } catch { return 0; }
}

async function recordPost(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RATE_LIMIT_KEY);
    const timestamps: number[] = raw ? JSON.parse(raw) : [];
    timestamps.push(Date.now());
    await AsyncStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(timestamps));
  } catch { /* */ }
}

export default function PostBidScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ editId?: string }>();
  const { addBid, bids: localBids, updateBid } = useBids();
  const { user } = useAuth();
  const { tier } = useSubscription();
  const userId = user?.id ?? null;
  const isEditing = !!params.editId;

  const [title, setTitle] = useState('');
  const [agency, setAgency] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('NY');
  const [bidType, setBidType] = useState<BidType>('municipal');
  const [category, setCategory] = useState<BidCategory>('construction');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [bondRequired, setBondRequired] = useState('');
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [applyUrl, setApplyUrl] = useState('');
  const [selectedCerts, setSelectedCerts] = useState<CertificationType[]>([]);
  const [showCertPicker, setShowCertPicker] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [monthlyPostCount, setMonthlyPostCount] = useState<number>(0);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [isLoadingCount, setIsLoadingCount] = useState(true);

  const postLimit = POSTING_LIMITS[tier] ?? 2;
  const remainingPosts = Math.max(0, postLimit - monthlyPostCount);

  useEffect(() => {
    async function loadPostCount() {
      try {
        if (userId) {
          const now = new Date();
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
          const { count, error } = await supabase
            .from('cached_bids')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('posted_date', startOfMonth);
          if (!error && count !== null) {
            setMonthlyPostCount(count);
          }
        }
      } catch (err) {
        console.log('[PostBid] Failed to load post count:', err);
      } finally {
        setIsLoadingCount(false);
      }
    }
    void loadPostCount();
  }, [userId]);

  useEffect(() => {
    if (isEditing && params.editId) {
      const existing = localBids.find(b => b.id === params.editId);
      if (existing) {
        setTitle(existing.title);
        setAgency(existing.issuingAgency);
        setCity(existing.city);
        setState(existing.state);
        setBidType(existing.bidType);
        setCategory(existing.category);
        setEstimatedValue(existing.estimatedValue > 0 ? String(existing.estimatedValue) : '');
        setBondRequired(existing.bondRequired > 0 ? String(existing.bondRequired) : '');
        setDeadline(existing.deadline ? existing.deadline.split('T')[0] : '');
        setDescription(existing.description);
        setContactEmail(existing.contactEmail);
        setApplyUrl(existing.applyUrl ?? '');
        setSelectedCerts(existing.requiredCertifications);
      }
    }
  }, [isEditing, params.editId, localBids]);

  const toggleCert = useCallback((cert: CertificationType) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedCerts(prev =>
      prev.includes(cert) ? prev.filter(c => c !== cert) : [...prev, cert]
    );
  }, []);

  const validate = useCallback((): string | null => {
    if (!title.trim() || title.trim().length < 10) return 'Title must be at least 10 characters.';
    if (!description.trim() || description.trim().length < 50) return 'Description must be at least 50 characters.';
    if (!city.trim()) return 'City is required.';
    if (!deadline) return 'Deadline is required.';
    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime()) || deadlineDate <= new Date()) return 'Deadline must be a future date.';
    if (estimatedValue && (parseFloat(estimatedValue) <= 0)) return 'Estimated value must be greater than $0.';
    if (!contactEmail.trim()) return 'Contact email is required.';
    return null;
  }, [title, description, city, deadline, estimatedValue, contactEmail]);

  const handleSubmit = useCallback(async () => {
    const validationError = validate();
    if (validationError) {
      Alert.alert('Validation Error', validationError);
      return;
    }

    if (!isEditing) {
      if (monthlyPostCount >= postLimit) {
        setShowUpgradeModal(true);
        return;
      }

      const hourly = await getHourlyPostCount();
      if (hourly >= 3) {
        Alert.alert('Rate Limit', 'You can only post 3 bids per hour. Please try again later.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const bidData: PublicBid = {
        id: isEditing && params.editId ? params.editId : generateUUID(),
        title: title.trim(),
        issuingAgency: agency.trim() || 'Private Posting',
        city: city.trim(),
        state,
        category,
        bidType,
        estimatedValue: parseFloat(estimatedValue) || 0,
        bondRequired: parseFloat(bondRequired) || 0,
        deadline: new Date(deadline).toISOString(),
        description: description.trim(),
        postedBy: user?.name ?? 'Anonymous Contractor',
        postedDate: new Date().toISOString(),
        status: 'open',
        requiredCertifications: selectedCerts,
        contactEmail: contactEmail.trim(),
        applyUrl: applyUrl.trim() || undefined,
        sourceName: 'MAGE ID Community',
      };

      if (isEditing && params.editId) {
        updateBid(params.editId, bidData);
        if (userId) {
          await supabase.from('cached_bids').update({
            title: bidData.title,
            department: bidData.issuingAgency,
            city: bidData.city,
            state: bidData.state,
            category: bidData.category,
            bid_type: 'community',
            estimated_value: bidData.estimatedValue,
            bond_required: bidData.bondRequired,
            deadline: bidData.deadline,
            description: bidData.description,
            posted_by: bidData.postedBy,
            contact_email: bidData.contactEmail,
            apply_url: bidData.applyUrl,
            source_name: 'MAGE ID Community',
            required_certifications: bidData.requiredCertifications,
          }).eq('id', params.editId);
        }
      } else {
        addBid(bidData);
        if (userId) {
          await supabase.from('cached_bids').insert({
            id: bidData.id,
            user_id: userId,
            title: bidData.title,
            department: bidData.issuingAgency,
            city: bidData.city,
            state: bidData.state,
            category: bidData.category,
            bid_type: 'community',
            estimated_value: bidData.estimatedValue,
            bond_required: bidData.bondRequired,
            deadline: bidData.deadline,
            description: bidData.description,
            posted_by: bidData.postedBy,
            posted_date: bidData.postedDate,
            status: 'open',
            contact_email: bidData.contactEmail,
            apply_url: bidData.applyUrl,
            source_name: 'MAGE ID Community',
            source_url: bidData.applyUrl,
            required_certifications: bidData.requiredCertifications,
            fetched_at: new Date().toISOString(),
          });
        }
        await recordPost();
        setMonthlyPostCount(prev => prev + 1);
      }

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(isEditing ? 'Bid Updated' : 'Bid Posted', isEditing ? 'Your bid has been updated.' : 'Your bid has been published.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (err) {
      console.log('[PostBid] Submit error:', err);
      Alert.alert('Error', 'Failed to post bid. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [title, agency, city, state, category, bidType, estimatedValue, bondRequired, deadline, description, contactEmail, applyUrl, selectedCerts, addBid, updateBid, router, validate, isEditing, params.editId, userId, user, monthlyPostCount, postLimit]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: isEditing ? 'Edit Bid' : 'Post a Bid',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {!isEditing && (
            <View style={[styles.limitBanner, remainingPosts <= 1 && { borderColor: Colors.warning }]}>
              <Text style={styles.limitText}>
                {isLoadingCount ? 'Checking...' : `Remaining posts: ${remainingPosts} of ${postLimit} (${tier === 'free' ? 'Free' : tier === 'pro' ? 'Pro' : 'Business'})`}
              </Text>
              {remainingPosts <= 1 && !isLoadingCount && (
                <TouchableOpacity onPress={() => router.push('/paywall')}>
                  <Text style={styles.upgradeLink}>Upgrade</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Bid title (min 10 chars)" placeholderTextColor={Colors.textMuted} testID="bid-title" />

          <Text style={styles.label}>Description *</Text>
          <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} placeholder="Describe the project scope (min 50 chars)..." placeholderTextColor={Colors.textMuted} multiline numberOfLines={4} />
          <Text style={styles.charCount}>{description.length}/50 min</Text>

          <Text style={styles.label}>Issuing Agency</Text>
          <TextInput style={styles.input} value={agency} onChangeText={setAgency} placeholder="Agency or company name" placeholderTextColor={Colors.textMuted} />

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>City *</Text>
              <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={Colors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>State *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stateScroll}>
                {US_STATES.slice(0, 10).map(s => (
                  <TouchableOpacity key={s.code} style={[styles.stateChip, state === s.code && styles.stateChipActive]} onPress={() => setState(s.code)}>
                    <Text style={[styles.stateChipText, state === s.code && styles.stateChipTextActive]}>{s.code}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          <Text style={styles.label}>Category *</Text>
          <View style={styles.chipRow}>
            {BID_CATEGORIES.map(c => (
              <TouchableOpacity key={c.id} style={[styles.chip, category === c.id && styles.chipActive]} onPress={() => setCategory(c.id)}>
                <Text style={[styles.chipText, category === c.id && styles.chipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Bid Type *</Text>
          <View style={styles.chipRow}>
            {BID_TYPES.map(t => (
              <TouchableOpacity key={t.id} style={[styles.chip, bidType === t.id && styles.chipActive]} onPress={() => setBidType(t.id)}>
                <Text style={[styles.chipText, bidType === t.id && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>Estimated Value ($)</Text>
              <TextInput style={styles.input} value={estimatedValue} onChangeText={setEstimatedValue} placeholder="0" keyboardType="numeric" placeholderTextColor={Colors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>Bond Required ($)</Text>
              <TextInput style={styles.input} value={bondRequired} onChangeText={setBondRequired} placeholder="0" keyboardType="numeric" placeholderTextColor={Colors.textMuted} />
            </View>
          </View>

          <Text style={styles.label}>Bid Deadline (YYYY-MM-DD) *</Text>
          <TextInput style={styles.input} value={deadline} onChangeText={setDeadline} placeholder="2026-06-01" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Contact Email *</Text>
          <TextInput style={styles.input} value={contactEmail} onChangeText={setContactEmail} placeholder="bids@example.com" keyboardType="email-address" autoCapitalize="none" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Source URL (optional)</Text>
          <TextInput style={styles.input} value={applyUrl} onChangeText={setApplyUrl} placeholder="https://..." autoCapitalize="none" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Required Certifications</Text>
          <TouchableOpacity style={styles.certToggle} onPress={() => setShowCertPicker(!showCertPicker)}>
            <Text style={styles.certToggleText}>{selectedCerts.length === 0 ? 'None selected' : `${selectedCerts.length} selected`}</Text>
            <ChevronDown size={16} color={Colors.textSecondary} />
          </TouchableOpacity>

          {showCertPicker && (
            <View style={styles.certPickerContainer}>
              {CERTIFICATIONS.map(cert => (
                <TouchableOpacity key={cert.id} style={[styles.certOption, selectedCerts.includes(cert.id) && styles.certOptionActive]} onPress={() => toggleCert(cert.id)}>
                  <Text style={[styles.certOptionText, selectedCerts.includes(cert.id) && styles.certOptionTextActive]}>{cert.shortLabel}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {selectedCerts.length > 0 && (
            <View style={styles.selectedCerts}>
              {selectedCerts.map(certId => {
                const info = CERTIFICATIONS.find(c => c.id === certId);
                return (
                  <TouchableOpacity key={certId} style={styles.selectedCertBadge} onPress={() => toggleCert(certId)}>
                    <Text style={styles.selectedCertText}>{info?.shortLabel ?? certId}</Text>
                    <X size={12} color={Colors.primary} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            testID="submit-bid"
          >
            {isSubmitting ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{isEditing ? 'Update Bid' : 'Post Bid'}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={showUpgradeModal} transparent animationType="fade" onRequestClose={() => setShowUpgradeModal(false)}>
        <View style={styles.upgradeOverlay}>
          <View style={styles.upgradeCard}>
            <AlertTriangle size={32} color={Colors.warning} />
            <Text style={styles.upgradeTitle}>Posting Limit Reached</Text>
            <Text style={styles.upgradeBody}>
              You've used {monthlyPostCount} of {postLimit} free posts this month.
            </Text>
            <Text style={styles.upgradeBody}>
              Upgrade to Pro for 8 posts/mo or Business for 25 posts/mo.
            </Text>
            <TouchableOpacity style={styles.upgradeBtn} onPress={() => { setShowUpgradeModal(false); router.push('/paywall'); }}>
              <Text style={styles.upgradeBtnText}>Upgrade to Pro — $29.99/mo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.upgradeLater} onPress={() => setShowUpgradeModal(false)}>
              <Text style={styles.upgradeLaterText}>Maybe Later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },
  limitBanner: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.borderLight },
  limitText: { fontSize: 13, fontWeight: '500' as const, color: Colors.textSecondary },
  upgradeLink: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  label: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6, marginTop: 14, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  input: { backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.text, borderWidth: 0.5, borderColor: Colors.borderLight },
  textArea: { minHeight: 100, textAlignVertical: 'top' as const },
  charCount: { fontSize: 11, color: Colors.textMuted, marginTop: 4, textAlign: 'right' as const },
  row: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  stateScroll: { maxHeight: 36 },
  stateChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.surface, marginRight: 4, borderWidth: 0.5, borderColor: Colors.borderLight },
  stateChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  stateChipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' as const },
  stateChipTextActive: { color: '#FFF' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: Colors.surface, borderWidth: 0.5, borderColor: Colors.borderLight },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  certToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 0.5, borderColor: Colors.borderLight },
  certToggleText: { fontSize: 15, color: Colors.textSecondary },
  certPickerContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, backgroundColor: Colors.surface, padding: 12, borderRadius: 10 },
  certOption: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: Colors.background },
  certOptionActive: { backgroundColor: Colors.primary + '20' },
  certOptionText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' as const },
  certOptionTextActive: { color: Colors.primary, fontWeight: '700' as const },
  selectedCerts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  selectedCertBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary + '15', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  selectedCertText: { fontSize: 12, color: Colors.primary, fontWeight: '600' as const },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' as const },
  upgradeOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  upgradeCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, alignItems: 'center', width: '100%', maxWidth: 340, gap: 12 },
  upgradeTitle: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  upgradeBody: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const },
  upgradeBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 24, width: '100%', alignItems: 'center', marginTop: 8 },
  upgradeBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' as const },
  upgradeLater: { paddingVertical: 8 },
  upgradeLaterText: { fontSize: 14, color: Colors.textMuted },
});

