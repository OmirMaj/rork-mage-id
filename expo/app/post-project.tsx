import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Camera, MapPin, ChevronDown, Check, AlertTriangle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { PROJECT_CATEGORIES, TIMELINE_OPTIONS, PROPERTY_TYPES, CONTACT_PREFERENCES, POSTING_LIMITS } from '@/constants/projectCategories';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useUserLocation } from '@/utils/location';
import { supabase } from '@/lib/supabase';
import { generateUUID } from '@/utils/generateId';
import AsyncStorage from '@react-native-async-storage/async-storage';

const RATE_LIMIT_KEY = 'mageid_project_post_timestamps';

async function checkRateLimit(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(RATE_LIMIT_KEY);
    if (!raw) return true;
    const timestamps: number[] = JSON.parse(raw);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayPosts = timestamps.filter(t => t > today.getTime());
    return todayPosts.length < 2;
  } catch { return true; }
}

async function recordPost(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RATE_LIMIT_KEY);
    const timestamps: number[] = raw ? JSON.parse(raw) : [];
    timestamps.push(Date.now());
    await AsyncStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(timestamps));
  } catch { /* */ }
}

export default function PostProjectScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { tier } = useSubscription();
  const { location } = useUserLocation();
  const userId = user?.id ?? null;

  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [zipCode, setZipCode] = useState('');
  const [budgetMin, setBudgetMin] = useState('');
  const [budgetMax, setBudgetMax] = useState('');
  const [budgetUnsure, setBudgetUnsure] = useState(false);
  const [timeline, setTimeline] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [contactPref, setContactPref] = useState('in_app');
  const [preferences, setPreferences] = useState<string[]>([]);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  const togglePref = useCallback((p: string) => {
    setPreferences(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  }, []);

  const pickPhotos = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.7,
        selectionLimit: 6,
      });
      if (!result.canceled && result.assets) {
        setPhotos(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 6));
      }
    } catch (err) {
      console.log('[PostProject] Image picker error:', err);
    }
  }, []);

  const removePhoto = useCallback((idx: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Please sign in to post a project');
      if (!category) throw new Error('Please select a project category');
      if (description.length < 100) throw new Error('Description must be at least 100 characters');
      if (photos.length < 2) throw new Error('Please add at least 2 project photos');
      if (!zipCode) throw new Error('Please enter your zip code');
      if (!budgetUnsure && !budgetMax) throw new Error('Please enter your budget range');
      if (!timeline) throw new Error('Please select a timeline');
      if (!propertyType) throw new Error('Please select your property type');

      const canPost = await checkRateLimit();
      if (!canPost) throw new Error('You can only post 2 projects per day. Try again tomorrow.');

      const limits = POSTING_LIMITS[tier as keyof typeof POSTING_LIMITS] ?? POSTING_LIMITS.free;
      const { count } = await supabase
        .from('public_bids')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('bid_type', 'homeowner_request')
        .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

      if ((count ?? 0) >= limits.requests) {
        throw new Error(`You've used ${count} of ${limits.requests} free project posts this month. Upgrade for more.`);
      }

      const catLabel = PROJECT_CATEGORIES.find(c => c.id === category)?.label ?? category;
      const bidId = generateUUID();

      const { error } = await supabase.from('public_bids').insert({
        id: bidId,
        user_id: userId,
        title: catLabel,
        description,
        category,
        bid_type: 'homeowner_request',
        estimated_value: budgetUnsure ? 0 : (parseFloat(budgetMax.replace(/[^0-9.]/g, '')) || 0),
        city: location?.cityName ?? '',
        state: location?.stateName ?? '',
        latitude: location?.latitude ?? 0,
        longitude: location?.longitude ?? 0,
        status: 'open',
        source_name: 'MAGE ID Homeowner',
        posted_by: user?.name ?? 'Homeowner',
        posted_date: new Date().toISOString(),
        photos,
        metadata: {
          budget_min: budgetUnsure ? 0 : (parseFloat(budgetMin.replace(/[^0-9.]/g, '')) || 0),
          budget_max: budgetUnsure ? 0 : (parseFloat(budgetMax.replace(/[^0-9.]/g, '')) || 0),
          budget_unsure: budgetUnsure,
          timeline,
          property_type: propertyType,
          contact_preference: contactPref,
          preferences,
          zip_code: zipCode,
        },
      });

      if (error) throw new Error(error.message);
      await recordPost();
      return bidId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplace_bids'] });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Posted!', 'Your project is now visible to contractors in your area. You\'ll receive notifications when bids come in.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  const descCharCount = description.length;
  const isValid = category && description.length >= 100 && photos.length >= 2 && zipCode && (budgetUnsure || budgetMax) && timeline && propertyType;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Post a Project for Bids</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <Text style={styles.heroText}>Find contractors near you — no spam calls, no shared leads, zero cost.</Text>

          <Text style={styles.sectionLabel}>What do you need done? *</Text>
          <TouchableOpacity style={styles.dropdown} onPress={() => setShowCategoryPicker(true)} activeOpacity={0.7}>
            <Text style={[styles.dropdownText, !category && styles.dropdownPlaceholder]}>
              {category ? PROJECT_CATEGORIES.find(c => c.id === category)?.label : 'Select a category'}
            </Text>
            <ChevronDown size={18} color={Colors.textMuted} />
          </TouchableOpacity>

          {showCategoryPicker && (
            <View style={styles.pickerList}>
              {PROJECT_CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.pickerItem, category === cat.id && styles.pickerItemActive]}
                  onPress={() => { setCategory(cat.id); setShowCategoryPicker(false); }}
                >
                  <Text style={styles.pickerIcon}>{cat.icon}</Text>
                  <Text style={[styles.pickerText, category === cat.id && styles.pickerTextActive]}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.sectionLabel}>Describe your project *</Text>
          <TextInput
            style={styles.textArea}
            value={description}
            onChangeText={setDescription}
            placeholder="Describe what you need done in detail. Include dimensions, materials preferences, current condition, etc. The more detail, the better quotes you'll get."
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            maxLength={2000}
          />
          <Text style={[styles.charCount, descCharCount < 100 && styles.charCountWarn]}>
            {descCharCount}/100 min {descCharCount >= 100 ? '✓' : `(${100 - descCharCount} more)`}
          </Text>

          <Text style={styles.sectionLabel}>Project Photos * (min 2 required)</Text>
          <View style={styles.photoGrid}>
            {photos.map((uri, idx) => (
              <View key={idx} style={styles.photoItem}>
                <View style={styles.photoPlaceholder}>
                  <Camera size={16} color={Colors.textMuted} />
                  <Text style={styles.photoLabel}>Photo {idx + 1}</Text>
                </View>
                <TouchableOpacity style={styles.photoRemove} onPress={() => removePhoto(idx)}>
                  <X size={12} color="#FFF" />
                </TouchableOpacity>
              </View>
            ))}
            {photos.length < 6 && (
              <TouchableOpacity style={styles.addPhotoBtn} onPress={pickPhotos} activeOpacity={0.7}>
                <Camera size={22} color={Colors.primary} />
                <Text style={styles.addPhotoText}>Add Photos</Text>
              </TouchableOpacity>
            )}
          </View>
          {photos.length < 2 && (
            <View style={styles.warningRow}>
              <AlertTriangle size={14} color={Colors.warning} />
              <Text style={styles.warningText}>At least 2 photos are required to prevent spam</Text>
            </View>
          )}

          <Text style={styles.sectionLabel}>Your Location *</Text>
          <View style={styles.locationRow}>
            <MapPin size={16} color={Colors.primary} />
            <Text style={styles.locationDetected}>
              {location?.cityName ? `${location.cityName}, ${location.stateName ?? ''}` : 'Detecting location...'}
            </Text>
          </View>
          <TextInput
            style={styles.input}
            value={zipCode}
            onChangeText={setZipCode}
            placeholder="Zip code *"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
            maxLength={5}
          />
          <Text style={styles.privacyNote}>Your exact address is NEVER shown. Only your neighborhood and zip are visible.</Text>

          <Text style={styles.sectionLabel}>Budget Range *</Text>
          <View style={styles.budgetRow}>
            <TextInput
              style={[styles.budgetInput, budgetUnsure && styles.inputDisabled]}
              value={budgetMin}
              onChangeText={setBudgetMin}
              placeholder="$   Min"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              editable={!budgetUnsure}
            />
            <Text style={styles.budgetTo}>to</Text>
            <TextInput
              style={[styles.budgetInput, budgetUnsure && styles.inputDisabled]}
              value={budgetMax}
              onChangeText={setBudgetMax}
              placeholder="$   Max"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              editable={!budgetUnsure}
            />
          </View>
          <TouchableOpacity style={styles.checkboxRow} onPress={() => setBudgetUnsure(!budgetUnsure)} activeOpacity={0.7}>
            <View style={[styles.checkbox, budgetUnsure && styles.checkboxChecked]}>
              {budgetUnsure && <Check size={14} color="#FFF" />}
            </View>
            <Text style={styles.checkboxLabel}>Not sure — help me estimate</Text>
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>Timeline *</Text>
          <View style={styles.optionGrid}>
            {TIMELINE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.id}
                style={[styles.optionChip, timeline === opt.id && styles.optionChipActive]}
                onPress={() => setTimeline(opt.id)}
              >
                <Text style={[styles.optionChipText, timeline === opt.id && styles.optionChipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Property Type *</Text>
          <View style={styles.optionGrid}>
            {PROPERTY_TYPES.map(pt => (
              <TouchableOpacity
                key={pt.id}
                style={[styles.optionChip, propertyType === pt.id && styles.optionChipActive]}
                onPress={() => setPropertyType(pt.id)}
              >
                <Text style={[styles.optionChipText, propertyType === pt.id && styles.optionChipTextActive]}>{pt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Additional Preferences</Text>
          {[
            { id: 'licensed_required', label: 'Licensed & insured required' },
            { id: 'permits_needed', label: 'Need permits pulled' },
            { id: 'bilingual', label: 'Prefer bilingual (English/Spanish)' },
            { id: 'weekend_ok', label: 'Weekend work OK' },
            { id: 'evening_consult', label: 'Evening consultations OK' },
          ].map(pref => (
            <TouchableOpacity key={pref.id} style={styles.checkboxRow} onPress={() => togglePref(pref.id)} activeOpacity={0.7}>
              <View style={[styles.checkbox, preferences.includes(pref.id) && styles.checkboxChecked]}>
                {preferences.includes(pref.id) && <Check size={14} color="#FFF" />}
              </View>
              <Text style={styles.checkboxLabel}>{pref.label}</Text>
            </TouchableOpacity>
          ))}

          <Text style={styles.sectionLabel}>How do you want to be contacted? *</Text>
          {CONTACT_PREFERENCES.map(cp => (
            <TouchableOpacity key={cp.id} style={styles.radioRow} onPress={() => setContactPref(cp.id)} activeOpacity={0.7}>
              <View style={[styles.radio, contactPref === cp.id && styles.radioSelected]}>
                {contactPref === cp.id && <View style={styles.radioInner} />}
              </View>
              <Text style={styles.radioLabel}>{cp.label}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[styles.submitButton, (!isValid || submitMutation.isPending) && styles.submitButtonDisabled]}
            onPress={() => submitMutation.mutate()}
            disabled={!isValid || submitMutation.isPending}
            activeOpacity={0.8}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.submitButtonText}>Post Project — Free</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: insets.bottom + 20 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  headerTitle: { fontSize: 17, fontWeight: '700' as const, color: Colors.text },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  heroText: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 20, textAlign: 'center' as const },
  sectionLabel: { fontSize: 14, fontWeight: '700' as const, color: Colors.text, marginBottom: 8, marginTop: 16 },
  dropdown: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: Colors.borderLight },
  dropdownText: { fontSize: 15, color: Colors.text, fontWeight: '500' as const },
  dropdownPlaceholder: { color: Colors.textMuted },
  pickerList: { backgroundColor: Colors.surface, borderRadius: 12, marginTop: 4, maxHeight: 300, borderWidth: 1, borderColor: Colors.borderLight },
  pickerItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  pickerItemActive: { backgroundColor: Colors.primaryLight },
  pickerIcon: { fontSize: 18 },
  pickerText: { fontSize: 14, color: Colors.text },
  pickerTextActive: { color: Colors.primary, fontWeight: '600' as const },
  textArea: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, fontSize: 14, color: Colors.text, borderWidth: 1, borderColor: Colors.borderLight, minHeight: 120, textAlignVertical: 'top' as const },
  charCount: { fontSize: 12, color: Colors.textMuted, marginTop: 4, textAlign: 'right' as const },
  charCountWarn: { color: Colors.warning },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoItem: { width: 80, height: 80, borderRadius: 10, overflow: 'hidden' as const },
  photoPlaceholder: { flex: 1, backgroundColor: Colors.fillTertiary, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4 },
  photoLabel: { fontSize: 9, color: Colors.textMuted },
  photoRemove: { position: 'absolute' as const, top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center' as const, justifyContent: 'center' as const },
  addPhotoBtn: { width: 80, height: 80, borderRadius: 10, borderWidth: 2, borderColor: Colors.primary + '30', borderStyle: 'dashed' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4 },
  addPhotoText: { fontSize: 10, color: Colors.primary, fontWeight: '600' as const },
  warningRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  warningText: { fontSize: 12, color: Colors.warning },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  locationDetected: { fontSize: 14, color: Colors.text, fontWeight: '500' as const },
  input: { backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, color: Colors.text, borderWidth: 1, borderColor: Colors.borderLight },
  inputDisabled: { opacity: 0.4 },
  privacyNote: { fontSize: 11, color: Colors.textMuted, marginTop: 6, fontStyle: 'italic' as const },
  budgetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  budgetInput: { flex: 1, backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 14, color: Colors.text, borderWidth: 1, borderColor: Colors.borderLight },
  budgetTo: { fontSize: 14, color: Colors.textMuted },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: Colors.borderLight, alignItems: 'center' as const, justifyContent: 'center' as const },
  checkboxChecked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkboxLabel: { fontSize: 14, color: Colors.text },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.borderLight },
  optionChipActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  optionChipText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  optionChipTextActive: { color: Colors.primary, fontWeight: '700' as const },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: Colors.borderLight, alignItems: 'center' as const, justifyContent: 'center' as const },
  radioSelected: { borderColor: Colors.primary },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.primary },
  radioLabel: { fontSize: 14, color: Colors.text, flex: 1 },
  submitButton: { backgroundColor: Colors.homeowner, borderRadius: 14, paddingVertical: 16, alignItems: 'center' as const, marginTop: 24 },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { fontSize: 16, fontWeight: '700' as const, color: '#FFF' },
});

