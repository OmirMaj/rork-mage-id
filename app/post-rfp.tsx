// post-rfp — homeowner-side "post a project" screen.
//
// Flow:
//   1. Pick a category, write a short title + scope.
//   2. Enter the property address. We forward-geocode (expo-location) so the
//      lat/lng is stored — that's what powers the contractor side's
//      "RFPs near you" feed. If geocoding fails (offline, garbage address)
//      we still let the user submit, but flag it as un-verified so contractors
//      can be skeptical.
//   3. At least one photo of the property is required — the cheapest
//      anti-troll signal we have without paid posting. Drawings are
//      optional (PDFs/images for plans, sketches, etc.).
//   4. Budget range, desired start date, optional certifications wanted.
//   5. Submit creates a row in public_bids with is_homeowner_rfp=true.
//
// After submit we navigate to the homeowner's "My RFPs" screen so they
// can see responses come in. The notify-nearby-contractors edge function
// fans out push + email to matching contractors automatically.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Image, ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Camera, FileText, MapPin, DollarSign, Calendar, X,
  Image as ImageIcon, Sparkles, ShieldCheck, AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { uploadRfpAttachment } from '@/utils/storage';
import { generateUUID } from '@/utils/generateId';
import type { BidCategory } from '@/types';

interface PickedAttachment {
  uri: string;
  name: string;
  contentType: string;
  kind: 'photo' | 'drawing';
}

const CATEGORIES: { id: BidCategory; label: string }[] = [
  { id: 'residential',     label: 'Residential' },
  { id: 'construction',    label: 'New Construction' },
  { id: 'infrastructure',  label: 'Site / Infra' },
  { id: 'energy',          label: 'Energy / Solar' },
  { id: 'environmental',   label: 'Environmental' },
];

export default function PostRfpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const [title, setTitle]                 = useState('');
  const [category, setCategory]           = useState<BidCategory>('residential');
  const [scope, setScope]                 = useState('');
  const [address, setAddress]             = useState('');
  const [latLng, setLatLng]               = useState<{ lat: number; lng: number } | null>(null);
  const [addressVerified, setAddressVerified] = useState(false);
  const [budgetMin, setBudgetMin]         = useState('');
  const [budgetMax, setBudgetMax]         = useState('');
  const [desiredStart, setDesiredStart]   = useState('');
  const [deadline, setDeadline]           = useState('');
  const [attachments, setAttachments]     = useState<PickedAttachment[]>([]);
  const [submitting, setSubmitting]       = useState(false);
  const [geocoding, setGeocoding]         = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  const photos    = useMemo(() => attachments.filter(a => a.kind === 'photo'),    [attachments]);
  const drawings  = useMemo(() => attachments.filter(a => a.kind === 'drawing'),  [attachments]);

  const verifyAddress = useCallback(async () => {
    setError(null);
    if (!address.trim()) {
      Alert.alert('Address Required', 'Enter the property address before verifying.');
      return;
    }
    if (Platform.OS === 'web') {
      // expo-location's geocodeAsync isn't supported on web. Fall back to
      // submission without coordinates — contractors can still see the
      // address text, they just won't get distance-based matching.
      setAddressVerified(false);
      Alert.alert('Heads up', 'Address auto-verification only runs on the iOS/Android app. You can still post; nearby-contractor matching may be less precise.');
      return;
    }
    try {
      setGeocoding(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Location permission is needed to verify the address. You can still post without verification.');
        return;
      }
      const results = await Location.geocodeAsync(address.trim());
      if (results && results.length > 0) {
        const r = results[0];
        setLatLng({ lat: r.latitude, lng: r.longitude });
        setAddressVerified(true);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setAddressVerified(false);
        setLatLng(null);
        Alert.alert('Address not found', 'We couldn\'t locate that address. Double-check it — contractors won\'t see your post in nearby-RFP feeds without coordinates.');
      }
    } catch (e) {
      console.warn('[post-rfp] geocode failed', e);
      setAddressVerified(false);
    } finally {
      setGeocoding(false);
    }
  }, [address]);

  const pickPhotos = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Photo library access is required to attach project photos.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
      selectionLimit: 8,
    });
    if (res.canceled) return;
    const next: PickedAttachment[] = res.assets.map(a => ({
      uri: a.uri,
      name: a.fileName ?? `photo-${Date.now()}.jpg`,
      contentType: a.mimeType ?? 'image/jpeg',
      kind: 'photo',
    }));
    setAttachments(prev => [...prev, ...next]);
  }, []);

  const takePhoto = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Camera access is required to take a photo.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled) return;
    const a = res.assets[0];
    setAttachments(prev => [...prev, {
      uri: a.uri,
      name: a.fileName ?? `cam-${Date.now()}.jpg`,
      contentType: a.mimeType ?? 'image/jpeg',
      kind: 'photo',
    }]);
  }, []);

  const pickDrawings = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const next: PickedAttachment[] = (res.assets ?? []).map(a => ({
      uri: a.uri,
      name: a.name,
      contentType: a.mimeType ?? 'application/pdf',
      kind: 'drawing',
    }));
    setAttachments(prev => [...prev, ...next]);
  }, []);

  const removeAttachment = useCallback((uri: string) => {
    setAttachments(prev => prev.filter(a => a.uri !== uri));
  }, []);

  const validate = useCallback((): string | null => {
    if (!title.trim())             return 'Add a short title — e.g. "Kitchen remodel" or "Roof replacement".';
    if (title.trim().length < 6)   return 'Title is too short. Be specific so contractors can size it up.';
    if (!scope.trim())             return 'Describe the work you want done.';
    if (scope.trim().length < 30)  return 'The scope is too short. Add a few sentences so contractors can give a real estimate.';
    if (!address.trim())           return 'Property address is required.';
    if (photos.length === 0)       return 'At least one photo of the property is required. (This helps cut down on troll posts.)';
    return null;
  }, [title, scope, address, photos.length]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const v = validate();
    if (v) { setError(v); return; }
    if (!user || !isSupabaseConfigured) {
      setError('You need to be signed in to post a project.');
      return;
    }

    setSubmitting(true);
    try {
      const rfpId = generateUUID();

      // Upload attachments first so the row references valid URLs.
      const photoUrls: string[]   = [];
      const drawingUrls: string[] = [];
      for (const a of attachments) {
        const url = await uploadRfpAttachment(user.id, rfpId, a.uri, a.name, a.contentType);
        if (!url) {
          throw new Error(`Could not upload ${a.name}. Check your connection and try again.`);
        }
        if (a.kind === 'photo') photoUrls.push(url);
        else drawingUrls.push(url);
      }

      const cityState = parseCityState(address);

      const { error: insertErr } = await supabase.from('public_bids').insert({
        id: rfpId,
        user_id: user.id,
        title: title.trim(),
        issuing_agency: '',
        city: cityState.city,
        state: cityState.state,
        category,
        bid_type: 'private',
        estimated_value: Number(budgetMax) || Number(budgetMin) || 0,
        bond_required: 0,
        deadline: deadline || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        description: scope.trim().slice(0, 280),  // legacy short description for list views
        posted_by: user.email ?? '',
        posted_date: new Date().toISOString(),
        status: 'open',
        required_certifications: [],
        contact_email: user.email ?? '',
        // Homeowner-RFP extensions:
        is_homeowner_rfp: true,
        address_line: address.trim(),
        latitude: latLng?.lat ?? null,
        longitude: latLng?.lng ?? null,
        photo_urls: photoUrls,
        drawing_urls: drawingUrls,
        scope_description: scope.trim(),
        budget_min: budgetMin ? Number(budgetMin) : null,
        budget_max: budgetMax ? Number(budgetMax) : null,
        desired_start: desiredStart || null,
        address_verified: addressVerified,
      });
      if (insertErr) throw insertErr;

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Posted!',
        `Your project is live. Contractors near ${cityState.city || 'your location'} who match the requirements will be notified.`,
        [{ text: 'See my RFPs', onPress: () => router.replace('/my-rfps' as never) }],
      );
    } catch (e) {
      console.warn('[post-rfp] submit failed', e);
      setError(String((e as Error).message ?? e));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }, [validate, user, attachments, title, address, category, budgetMin, budgetMax, deadline, scope, latLng, desiredStart, addressVerified, router]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Post a Project</Text>
          <Text style={styles.title}>Find a Contractor. Get Bids in Days.</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title + category */}
        <View style={styles.card}>
          <Text style={styles.label}>Project title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Kitchen remodel + island"
            placeholderTextColor={Colors.textMuted}
            maxLength={80}
          />

          <Text style={[styles.label, { marginTop: 14 }]}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, category === c.id && styles.chipActive]}
                onPress={() => setCategory(c.id)}
              >
                <Text style={[styles.chipText, category === c.id && styles.chipTextActive]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Scope */}
        <View style={styles.card}>
          <Text style={styles.label}>What do you want done?</Text>
          <Text style={styles.helper}>
            Be specific — the more detail, the better the bids. Example: &quot;Tear out existing kitchen,
            new shaker cabinets, quartz counters, refinish hardwood, relocate the sink to the island.&quot;
          </Text>
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={scope}
            onChangeText={setScope}
            placeholder="Describe the work you want a contractor to do…"
            placeholderTextColor={Colors.textMuted}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{scope.length} chars</Text>
        </View>

        {/* Address */}
        <View style={styles.card}>
          <Text style={styles.label}>Property address</Text>
          <Text style={styles.helper}>
            Used to match nearby contractors. We never share your full address publicly — only the city
            shows on the listing until you accept a contractor&apos;s site visit.
          </Text>
          <View style={styles.addressRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={address}
              onChangeText={(v) => { setAddress(v); setAddressVerified(false); setLatLng(null); }}
              placeholder="123 Main St, Springfield, IL"
              placeholderTextColor={Colors.textMuted}
            />
            <TouchableOpacity
              style={styles.verifyBtn}
              onPress={verifyAddress}
              disabled={geocoding || !address.trim()}
            >
              {geocoding ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <MapPin size={14} color="#FFF" />
                  <Text style={styles.verifyBtnText}>Verify</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
          {addressVerified && (
            <View style={styles.verifiedRow}>
              <ShieldCheck size={14} color={Colors.success} />
              <Text style={styles.verifiedText}>
                Address verified · {latLng?.lat.toFixed(4)}, {latLng?.lng.toFixed(4)}
              </Text>
            </View>
          )}
        </View>

        {/* Photos */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Photos of the property *</Text>
              <Text style={styles.helper}>
                At least one photo is required. Helps cut spam and gives contractors something real to look at.
              </Text>
            </View>
          </View>
          <View style={styles.attachmentGrid}>
            {photos.map(p => (
              <View key={p.uri} style={styles.attachmentTile}>
                <Image source={{ uri: p.uri }} style={styles.attachmentImage} />
                <TouchableOpacity style={styles.attachmentRemove} onPress={() => removeAttachment(p.uri)}>
                  <X size={12} color="#FFF" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addTile} onPress={pickPhotos}>
              <ImageIcon size={20} color={Colors.primary} />
              <Text style={styles.addTileText}>Library</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addTile} onPress={takePhoto}>
              <Camera size={20} color={Colors.primary} />
              <Text style={styles.addTileText}>Camera</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Drawings */}
        <View style={styles.card}>
          <Text style={styles.label}>Drawings or sketches (optional)</Text>
          <Text style={styles.helper}>
            Architect plans, hand sketches, inspiration shots — anything that clarifies the scope. PDF or images.
          </Text>
          <View style={styles.attachmentGrid}>
            {drawings.map(d => (
              <View key={d.uri} style={styles.attachmentTile}>
                <View style={styles.drawingTilePlaceholder}>
                  <FileText size={20} color={Colors.primary} />
                  <Text style={styles.drawingTileName} numberOfLines={2}>{d.name}</Text>
                </View>
                <TouchableOpacity style={styles.attachmentRemove} onPress={() => removeAttachment(d.uri)}>
                  <X size={12} color="#FFF" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={styles.addTile} onPress={pickDrawings}>
              <FileText size={20} color={Colors.primary} />
              <Text style={styles.addTileText}>Add file</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Budget + start */}
        <View style={styles.card}>
          <Text style={styles.label}>Budget range (optional)</Text>
          <Text style={styles.helper}>
            Showing a range filters out wildly off-target bids. Leave blank if you&apos;re not sure.
          </Text>
          <View style={styles.budgetRow}>
            <View style={styles.budgetField}>
              <DollarSign size={14} color={Colors.textMuted} />
              <TextInput
                style={styles.budgetInput}
                value={budgetMin}
                onChangeText={setBudgetMin}
                placeholder="Min"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />
            </View>
            <Text style={styles.budgetDash}>–</Text>
            <View style={styles.budgetField}>
              <DollarSign size={14} color={Colors.textMuted} />
              <TextInput
                style={styles.budgetInput}
                value={budgetMax}
                onChangeText={setBudgetMax}
                placeholder="Max"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
              />
            </View>
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>Desired start (optional)</Text>
          <View style={styles.dateRow}>
            <Calendar size={14} color={Colors.textMuted} />
            <TextInput
              style={[styles.input, { flex: 1, marginLeft: 8 }]}
              value={desiredStart}
              onChangeText={setDesiredStart}
              placeholder="e.g. Mid-July or 2026-08-15"
              placeholderTextColor={Colors.textMuted}
            />
          </View>

          <Text style={[styles.label, { marginTop: 14 }]}>Bid deadline (optional)</Text>
          <View style={styles.dateRow}>
            <Calendar size={14} color={Colors.textMuted} />
            <TextInput
              style={[styles.input, { flex: 1, marginLeft: 8 }]}
              value={deadline}
              onChangeText={setDeadline}
              placeholder="Defaults to 14 days from today"
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>

        {error && (
          <View style={styles.errorCard}>
            <AlertTriangle size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Sparkles size={16} color="#FFF" />
              <Text style={styles.submitBtnText}>Post project</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By posting you agree this is a real project at a real address. Trolls and fake posts get accounts banned.
        </Text>
      </ScrollView>
    </View>
  );
}

// "123 Main St, Springfield, IL 62701" → { city: 'Springfield', state: 'IL' }
function parseCityState(addr: string): { city: string; state: string } {
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  // City is typically the second-to-last comma-separated chunk; state+zip is last.
  const city = parts.length >= 2 ? parts[parts.length - 2] : '';
  const tail = parts[parts.length - 1] ?? '';
  const stateMatch = tail.match(/\b([A-Z]{2})\b/);
  const state = stateMatch?.[1] ?? '';
  return { city, state };
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: 4 },

  card: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 14,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  label:  { fontSize: 12, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  helper: { fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 },
  charCount: { fontSize: 11, color: Colors.textMuted, alignSelf: 'flex-end', marginTop: 4 },

  input: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: Colors.text,
  },
  inputMultiline: { minHeight: 100, paddingTop: 11 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  chipText:  { fontSize: 13, fontWeight: '600', color: Colors.text },
  chipTextActive: { color: '#FFF' },

  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  verifyBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  verifiedText: { fontSize: 12, color: Colors.success, fontWeight: '600' },

  attachmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  attachmentTile: {
    width: 88, height: 88, borderRadius: 10, overflow: 'hidden',
    backgroundColor: Colors.background, position: 'relative',
  },
  attachmentImage: { width: '100%', height: '100%' },
  attachmentRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  drawingTilePlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6,
  },
  drawingTileName: { fontSize: 9, color: Colors.text, textAlign: 'center', lineHeight: 11 },
  addTile: {
    width: 88, height: 88, borderRadius: 10,
    backgroundColor: Colors.primary + '0D',
    borderWidth: 1.5, borderColor: Colors.primary + '40', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  addTileText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  budgetRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  budgetField:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10 },
  budgetInput:  { flex: 1, paddingVertical: 11, fontSize: 14, color: Colors.text },
  budgetDash:   { fontSize: 16, color: Colors.textMuted },
  dateRow:      { flexDirection: 'row', alignItems: 'center' },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: 12,
    backgroundColor: Colors.error + '0D',
    borderWidth: 1, borderColor: Colors.error + '30',
    marginBottom: 14,
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.error, lineHeight: 18 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 12,
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontSize: 15, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },

  disclaimer: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 14, fontStyle: 'italic', paddingHorizontal: 16, lineHeight: 16 },
});
