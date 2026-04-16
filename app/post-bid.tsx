import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { ChevronDown, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Colors } from '@/constants/colors';
import { useBids } from '@/contexts/BidsContext';
import { CERTIFICATIONS } from '@/constants/certifications';
import { US_STATES } from '@/constants/regions';
import type { PublicBid, BidType, BidCategory, CertificationType } from '@/types';
import { generateUUID } from '@/utils/generateId';

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

    const bid: PublicBid = {
      id: generateUUID(),
      title: title.trim(),
      issuingAgency: agency.trim(),
      city: city.trim(),
      state,
      category,
      bidType,
      estimatedValue: parseFloat(estimatedValue) || 0,
      bondRequired: parseFloat(bondRequired) || 0,
      deadline: new Date(deadline).toISOString(),
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
    Alert.alert('Bid Posted', 'Your bid has been published.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  }, [title, agency, city, state, category, bidType, estimatedValue, bondRequired, deadline, description, contactEmail, applyUrl, selectedCerts, addBid, router]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Post a Bid',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
      }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Bid title" placeholderTextColor={Colors.textMuted} testID="bid-title" />

          <Text style={styles.label}>Issuing Agency *</Text>
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
              <TextInput style={styles.input} value={estimatedValue} onChangeText={setEstimatedValue} placeholder="5000000" keyboardType="numeric" placeholderTextColor={Colors.textMuted} />
            </View>
            <View style={styles.halfField}>
              <Text style={styles.label}>Bond Required ($) *</Text>
              <TextInput style={styles.input} value={bondRequired} onChangeText={setBondRequired} placeholder="2500000" keyboardType="numeric" placeholderTextColor={Colors.textMuted} />
            </View>
          </View>

          <Text style={styles.label}>Deadline (YYYY-MM-DD) *</Text>
          <TextInput style={styles.input} value={deadline} onChangeText={setDeadline} placeholder="2026-06-01" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Description</Text>
          <TextInput style={[styles.input, styles.textArea]} value={description} onChangeText={setDescription} placeholder="Describe the project scope..." placeholderTextColor={Colors.textMuted} multiline numberOfLines={4} />

          <Text style={styles.label}>Contact Email *</Text>
          <TextInput style={styles.input} value={contactEmail} onChangeText={setContactEmail} placeholder="bids@example.com" keyboardType="email-address" autoCapitalize="none" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Apply URL (optional)</Text>
          <TextInput style={styles.input} value={applyUrl} onChangeText={setApplyUrl} placeholder="https://..." autoCapitalize="none" placeholderTextColor={Colors.textMuted} />

          <Text style={styles.label}>Required Certifications</Text>
          <TouchableOpacity style={styles.certToggle} onPress={() => setShowCertPicker(!showCertPicker)}>
            <Text style={styles.certToggleText}>
              {selectedCerts.length === 0 ? 'None selected' : `${selectedCerts.length} selected`}
            </Text>
            <ChevronDown size={16} color={Colors.textSecondary} />
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
                    <X size={12} color={Colors.primary} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 60 },
  label: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary, marginBottom: 6, marginTop: 14, textTransform: 'uppercase' as const, letterSpacing: 0.3 },
  input: { backgroundColor: Colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.text, borderWidth: 0.5, borderColor: Colors.borderLight },
  textArea: { minHeight: 100, textAlignVertical: 'top' as const },
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
});
