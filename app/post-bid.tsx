import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { ChevronDown, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useBids } from '@/contexts/BidsContext';
import { CERTIFICATIONS } from '@/constants/certifications';
import { US_STATES } from '@/constants/regions';
import type { PublicBid, BidType, BidCategory, CertificationType } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { parseLenientNumber } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

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

export default function PostBidScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { addBid } = useBids();
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
    if (!title.trim() || !agency.trim() || !city.trim() || !estimatedValue || !bondRequired || !deadline || !contactEmail.trim()) {
      Alert.alert('Missing Fields', 'Please fill in all required fields.');
      return;
    }

    // Deadline is free-text — validate it parses to a real calendar date
    // (and is in ISO YYYY-MM-DD shape) before we call toISOString(), which
    // throws a RangeError on an Invalid Date. Blocking here keeps an
    // uncomputable deadline out of the feed's daysLeft math downstream.
    const deadlineDate = new Date(deadline.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline.trim()) || isNaN(deadlineDate.getTime())) {
      Alert.alert('Invalid Deadline', 'Enter the deadline as YYYY-MM-DD (e.g. 2026-06-01).');
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
      postedBy: 'You',
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
    Alert.alert(
      'Bid Posted',
      'Your solicitation is saved. Contractors whose bond capacity and certifications match will see it in their matching opportunities.',
      [{ text: 'OK', onPress: () => router.back() }],
    );
  }, [title, agency, city, state, category, bidType, estimatedValue, bondRequired, deadline, description, contactEmail, applyUrl, selectedCerts, addBid, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Post a Bid',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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

          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} testID="submit-bid">
            <Text style={styles.submitBtnText}>Publish Bid</Text>
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
  label: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary, marginBottom: 6, marginTop: 14, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  input: { backgroundColor: t.surface, borderRadius: Tokens.radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: Type.subhead.fontSize, color: t.text, borderWidth: 0.5, borderColor: t.line },
  textArea: { minHeight: 100, textAlignVertical: 'top' as const },
  row: { flexDirection: 'row', gap: 10 },
  halfField: { flex: 1 },
  stateScroll: { maxHeight: 36 },
  stateChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.sm, backgroundColor: t.surface, marginRight: 4, borderWidth: 0.5, borderColor: t.line },
  stateChipActive: { backgroundColor: t.accent, borderColor: t.accent },
  stateChipText: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  stateChipTextActive: { color: '#FFF' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.sm, backgroundColor: t.surface, borderWidth: 0.5, borderColor: t.line },
  chipActive: { backgroundColor: t.accent, borderColor: t.accent },
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
  submitBtn: { backgroundColor: t.accent, borderRadius: Tokens.radius.card, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#FFF', fontSize: Type.callout.fontSize, fontWeight: '700' as const },
});
