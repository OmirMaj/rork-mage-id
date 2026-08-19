import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter, Stack } from 'expo-router';
import { ChevronDown, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useBids } from '@/contexts/BidsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTierAccess, FEATURE_LIMITS } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { CERTIFICATIONS } from '@/constants/certifications';
import { US_STATES } from '@/constants/regions';
import type { PublicBid, BidType, BidCategory, CertificationType } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { parseLenientNumber } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

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

/** Count bids the CURRENT user posted this calendar month, attributed by the
 *  real poster id (`userId`, mapped from public_bids.user_id in BidsContext).
 *  The old check (`postedBy === 'You'`) matched a literal that EVERY
 *  app-posted row in the shared community feed carried — so other members'
 *  posts counted against this user's quota. No signed-in user → nothing is
 *  attributable → count 0 (never falsely blocks). */
function countMyPostsThisMonth(bids: PublicBid[], myUserId: string | null): number {
  if (!myUserId) return 0;
  const now = new Date();
  const yyyyMM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return bids.filter(b => b.userId === myUserId && b.postedDate.startsWith(yyyyMM)).length;
}

export default function PostBidScreen() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { bids, addBid } = useBids();
  const { user } = useAuth();
  const { tier } = useTierAccess();
  const [overLimit, setOverLimit] = useState(false);

  // Compute usage BEFORE render so we can show a limit badge on the form
  // even before submit, matching the construction-ai pattern.
  const monthlyLimit = FEATURE_LIMITS.post_community_bid[tier];
  const userId = user?.id ?? null;
  const usedThisMonth = useMemo(() => countMyPostsThisMonth(bids, userId), [bids, userId]);
  const atLimit = isFinite(monthlyLimit) && usedThisMonth >= monthlyLimit;

  // Show paywall (free→pro, pro→business) or a plain Alert (business→enterprise, enterprise at cap).
  const canPaywallUpsell = tier === 'free' || tier === 'pro';
  const upsellTier: 'pro' | 'business' | 'enterprise' =
    tier === 'free' ? 'pro' : tier === 'pro' ? 'business' : 'enterprise';

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

  const toggleCert = useCallback((cert: CertificationType) => {
    void Haptics.selectionAsync();
    setSelectedCerts(prev =>
      prev.includes(cert) ? prev.filter(c => c !== cert) : [...prev, cert]
    );
  }, []);

  const handleSubmit = useCallback(() => {
    // ── Community post monthly limit ─────────────────────────────────────────
    // FEATURE_LIMITS.post_community_bid: free=2, pro=8, business=25, enterprise=50
    if (isFinite(monthlyLimit) && usedThisMonth >= monthlyLimit) {
      if (canPaywallUpsell) {
        setOverLimit(true); // renders the Paywall (free→pro, pro→business)
      } else {
        // Business/enterprise at cap — no higher tier to sell. Alert fired
        // HERE, in the event handler (never as a side effect during render).
        showAlert(
          'Monthly limit reached',
          `Your ${tier} plan includes ${monthlyLimit} community posts per month. Contact support to discuss higher limits.`,
        );
      }
      return;
    }

    if (!title.trim() || !agency.trim() || !city.trim() || !estimatedValue || !bondRequired || !deadline || !contactEmail.trim()) {
      showAlert('Missing Fields', 'Please fill in all required fields.');
      return;
    }

    // Deadline is free-text — validate it parses to a real calendar date
    // (and is in ISO YYYY-MM-DD shape) before we call toISOString(), which
    // throws a RangeError on an Invalid Date. Blocking here keeps an
    // uncomputable deadline out of the feed's daysLeft math downstream.
    const deadlineDate = new Date(deadline.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline.trim()) || isNaN(deadlineDate.getTime())) {
      showAlert('Invalid Deadline', 'Enter the deadline as YYYY-MM-DD (e.g. 2026-06-01).');
      return;
    }

    const bid: PublicBid = {
      id: generateUUID(),
      title: title.trim(),
      issuingAgency: agency.trim(),
      city: city.trim(),
      state,
      category,
      bidType,
      estimatedValue: parseLenientNumber(estimatedValue) ?? 0,
      bondRequired: parseLenientNumber(bondRequired) ?? 0,
      deadline: deadlineDate.toISOString(),
      description: description.trim(),
      // Real attribution: name for display (the old 'You' literal rendered as
      // "You" in every OTHER member's feed), id for quota counting.
      postedBy: user?.name?.trim() || 'Community member',
      userId: userId ?? undefined,
      postedDate: new Date().toISOString(),
      status: 'open',
      requiredCertifications: selectedCerts,
      contactEmail: contactEmail.trim(),
      applyUrl: applyUrl.trim() || undefined,
    };

    addBid(bid);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Honest confirmation: a community/agency bid posted here is matched to
    // contractors by bond capacity + required certifications and surfaces on
    // the relevant company's opportunities — it is NOT broadcast into the
    // homeowner-RFP "near you" feed (that feed filters is_homeowner_rfp), so
    // we don't imply it will show up there.
    showAlert(
      'Bid Posted',
      'Your solicitation is saved. Contractors whose bond capacity and certifications match will see it in their matching opportunities.',
      [{ text: 'OK', onPress: () => router.back() }],
    );
  }, [title, agency, city, state, category, bidType, estimatedValue, bondRequired, deadline, description, contactEmail, applyUrl, selectedCerts, addBid, router, monthlyLimit, usedThisMonth, tier, canPaywallUpsell, user, userId]);

  // overLimit is only ever set for the paywall tiers (handleSubmit shows the
  // business/enterprise cap as an in-handler Alert instead) — render is pure.
  if (overLimit && canPaywallUpsell) {
    return (
      <Paywall
        visible={true}
        feature={`Community Posts (${usedThisMonth}/${monthlyLimit} this month)`}
        requiredTier={upsellTier}
        onClose={() => setOverLimit(false)}
      />
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Post a Bid',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView {...fabScroll} style={styles.scroll} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]} showsVerticalScrollIndicator={false}>
          {/* Usage badge — honest gate: shows how many posts remain this month */}
          {isFinite(monthlyLimit) && (
            <View style={[styles.usageBadge, atLimit && styles.usageBadgeAtLimit]}>
              <Text style={[styles.usageBadgeText, atLimit && styles.usageBadgeTextAtLimit]}>
                {atLimit
                  ? canPaywallUpsell
                    ? `${tier === 'free' ? 'Free' : 'Pro'} plan includes ${monthlyLimit} community posts a month — upgrade for more`
                    : `${monthlyLimit} community posts per month on your plan`
                  : `${usedThisMonth} of ${monthlyLimit} community posts used this month`}
              </Text>
            </View>
          )}

          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Bid title" placeholderTextColor={themeColors.textMuted} testID="bid-title" />

          <Text style={styles.label}>Issuing Agency *</Text>
          <TextInput style={styles.input} value={agency} onChangeText={setAgency} placeholder="Agency or company name" placeholderTextColor={themeColors.textMuted} />

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>City *</Text>
              <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={themeColors.textMuted} />
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

          <Text style={styles.label}>Bid Type *</Text>
          <View style={styles.chipRow}>
            {BID_TYPES.map(t => (
              <TouchableOpacity key={t.id} style={[styles.chip, bidType === t.id && styles.chipActive]} onPress={() => setBidType(t.id)}>
                <Text style={[styles.chipText, bidType === t.id && styles.chipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Category *</Text>
          <View style={styles.chipRow}>
            {BID_CATEGORIES.map(c => (
              <TouchableOpacity key={c.id} style={[styles.chip, category === c.id && styles.chipActive]} onPress={() => setCategory(c.id)}>
                <Text style={[styles.chipText, category === c.id && styles.chipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.row}>
            <View style={styles.halfField}>
              <Text style={styles.label}>Estimated Value ($) *</Text>
              <TextInput style={styles.input} value={estimatedValue} onChangeText={setEstimatedValue} placeholder="5000000" keyboardType="numeric" placeholderTextColor={themeColors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>Bond Required ($) *</Text>
              <TextInput style={styles.input} value={bondRequired} onChangeText={setBondRequired} placeholder="2500000" keyboardType="numeric" placeholderTextColor={themeColors.textMuted} />
            </View>
          </View>

          <Text style={styles.label}>Deadline (YYYY-MM-DD) *</Text>
          <TextInput style={styles.input} value={deadline} onChangeText={setDeadline} placeholder="2026-06-01" placeholderTextColor={themeColors.textMuted} />

          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} placeholder="Describe the project scope..." placeholderTextColor={themeColors.textMuted} multiline numberOfLines={4} />

          <Text style={styles.label}>Contact Email *</Text>
          <TextInput style={styles.input} value={contactEmail} onChangeText={setContactEmail} placeholder="bids@example.com" keyboardType="email-address" autoCapitalize="none" placeholderTextColor={themeColors.textMuted} />

          <Text style={styles.label}>Apply URL (optional)</Text>
          <TextInput style={styles.input} value={applyUrl} onChangeText={setApplyUrl} placeholder="https://..." autoCapitalize="none" placeholderTextColor={themeColors.textMuted} />

          <Text style={styles.label}>Required Certifications</Text>
          <TouchableOpacity style={styles.certToggle} onPress={() => setShowCertPicker(!showCertPicker)}>
            <Text style={styles.certToggleText}>
              {selectedCerts.length === 0 ? 'None selected' : `${selectedCerts.length} selected`}
            </Text>
            <ChevronDown size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
          </TouchableOpacity>

          {showCertPicker && (
            <View style={styles.certPickerContainer}>
              {CERTIFICATIONS.map(cert => (
                <TouchableOpacity
                  key={cert.id}
                  style={[styles.certOption, selectedCerts.includes(cert.id) && styles.certOptionActive]}
                  onPress={() => toggleCert(cert.id)}
                >
                  <Text style={[styles.certOptionText, selectedCerts.includes(cert.id) && styles.certOptionTextActive]}>
                    {cert.shortLabel}
                  </Text>
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
                    <X size={12} color={themeColors.accent} strokeWidth={1.75} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, atLimit && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            testID="submit-bid"
            activeOpacity={0.85}
          >
            <Text style={styles.submitBtnText}>
              {atLimit
                ? canPaywallUpsell ? 'Monthly limit reached — upgrade to post' : 'Monthly limit reached'
                : 'Publish Bid'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },

  usageBadge: {
    backgroundColor: t.surface, borderRadius: Tokens.radius.card,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: t.line, marginBottom: 4,
  },
  usageBadgeAtLimit: { backgroundColor: t.danger + '12', borderColor: t.danger + '44' },
  usageBadgeText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  usageBadgeTextAtLimit: { color: t.danger, fontWeight: '600' as const },

  label: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginBottom: 6, marginTop: 14, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  input: { backgroundColor: t.surface, borderRadius: Tokens.radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: Type.subhead.fontSize, color: t.text, borderWidth: 0.5, borderColor: t.line },
  textArea: { minHeight: 100, textAlignVertical: 'top' as const },
  row: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  stateScroll: { maxHeight: 36 },
  stateChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: t.surface, marginRight: 4, borderWidth: 0.5, borderColor: t.line },
  stateChipActive: { backgroundColor: t.accentFill, borderColor: t.accent },
  stateChipText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  stateChipTextActive: { color: '#FFF' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.sm, backgroundColor: t.surface, borderWidth: 0.5, borderColor: t.line },
  chipActive: { backgroundColor: t.accentFill, borderColor: t.accent },
  chipText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  chipTextActive: { color: '#FFF' },
  certToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: t.surface, borderRadius: Tokens.radius.md, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 0.5, borderColor: t.line },
  certToggleText: { fontSize: Type.subhead.fontSize, color: t.textSecondary },
  certPickerContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, backgroundColor: t.surface, padding: 12, borderRadius: Tokens.radius.md },
  certOption: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.xs, backgroundColor: t.bg },
  certOptionActive: { backgroundColor: t.accent + '20' },
  certOptionText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  certOptionTextActive: { color: t.accent, fontWeight: '700' as const },
  selectedCerts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  selectedCertBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.accent + '15', paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.xs },
  selectedCertText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '600' as const },
  submitBtn: { backgroundColor: t.accentFill, borderRadius: Tokens.radius.card, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnDisabled: { backgroundColor: t.textMuted },
  submitBtnText: { color: '#FFF', fontSize: Type.callout.fontSize, fontWeight: '700' as const },
});
