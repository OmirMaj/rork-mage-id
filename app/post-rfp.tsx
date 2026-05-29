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
// Visual direction: gradient hero header (matches ClientHome's CTA so the
// two screens read as one product), a 4-dot progress strip that lights up
// as the user fills required fields, numbered + iconed section headers,
// a soft success ring on verified addresses, and a gradient submit button.
// All logic / handlers preserved from the prior version — this is a polish
// pass, not a behavior change.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, Image, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Camera, FileText, MapPin, DollarSign, Calendar, X,
  Image as ImageIcon, Sparkles, ShieldCheck, AlertTriangle, Building2,
  Hammer, Check, ArrowRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { uploadRfpAttachment } from '@/utils/storage';
import { generateUUID } from '@/utils/generateId';
import type { BidCategory } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useClientPaywall } from '@/hooks/useClientPaywall';

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

// Tiny fade-and-rise wrapper, same recipe used in ClientHome. Native driver
// so it stays cheap on the JS thread.
function FadeRise({ delay = 0, children, style }: {
  delay?: number; children: React.ReactNode; style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 380, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY, delay]);
  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

export default function PostRfpScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  // Client paywall gate — sits in front of the final submit. Subscribers
  // breeze through; everyone else gets the modal asking them to pay per-
  // post or start a trial. `ClientPaywallElement` must be rendered in JSX
  // for gate() to be able to flip it open. See hooks/useClientPaywall.ts.
  const { gate: gateClientPaywall, ClientPaywallElement } = useClientPaywall();

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

  // Progress dots — required steps only. Budget is optional so it doesn't
  // count toward "ready to post" status.
  const progress = useMemo(() => ({
    scope:    title.trim().length >= 6 && scope.trim().length >= 30,
    address:  address.trim().length > 0,
    photos:   photos.length > 0,
    budget:   !!budgetMin || !!budgetMax || !!desiredStart,
  }), [title, scope, address, photos.length, budgetMin, budgetMax, desiredStart]);
  const requiredDone = (progress.scope ? 1 : 0) + (progress.address ? 1 : 0) + (progress.photos ? 1 : 0);

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

    // Paywall gate — opens the per-post fee modal (or subscription
    // upsell). Returns true once the user has paid / subscribed, false
    // if they dismissed. We do this BEFORE setSubmitting(true) so the
    // submit button doesn't flash a spinner while the modal sits open.
    const ok = await gateClientPaywall('rfp-post');
    if (!ok) return;

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
  }, [validate, user, attachments, title, address, category, budgetMin, budgetMax, deadline, scope, latLng, desiredStart, addressVerified, router, gateClientPaywall]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Hero header — gradient band with embedded Building2 silhouette and
          a back button overlaid at the top-left. Replaces the old plain
          cream header so the screen opens with energy, not a form. */}
      <View style={styles.heroWrap}>
        <LinearGradient
          colors={[themeColors.accent, '#E04E0E', '#C73E00']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroBgIcon} pointerEvents="none">
            <Building2 size={180} color="rgba(255,255,255,0.10)" strokeWidth={1.1} />
          </View>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.heroBack}
          >
            <ChevronLeft size={22} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.heroEyebrow}>POST A PROJECT</Text>
          <Text style={styles.heroTitle}>Find a contractor.{'\n'}Get bids in days.</Text>
          <Text style={styles.heroSubtitle}>
            Describe your scope, drop a few photos, and verified contractors near your property bid for the work.
          </Text>
        </LinearGradient>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Progress strip — 4 segments, one per required+optional section.
            Lights up as the user fills the corresponding field. Reads at-a-
            glance how close they are to a postable RFP. */}
        <FadeRise delay={0}>
          <View style={styles.progressCard}>
            <View style={styles.progressHead}>
              <Text style={styles.progressTitle}>
                {requiredDone === 3
                  ? 'Ready to post — review and submit.'
                  : `${requiredDone}/3 required steps done`}
              </Text>
              <View style={styles.progressEta}>
                <Sparkles size={11} color={themeColors.accent} />
                <Text style={styles.progressEtaText}>3–7 bids in ~48h</Text>
              </View>
            </View>
            <View style={styles.progressRow}>
              <ProgressSeg label="Scope"    done={progress.scope}    accent={themeColors.accent} styles={styles} />
              <ProgressSeg label="Property" done={progress.address}  accent={themeColors.accent} styles={styles} />
              <ProgressSeg label="Photos"   done={progress.photos}   accent={themeColors.accent} styles={styles} />
              <ProgressSeg label="Budget"   done={progress.budget}   accent={themeColors.accent} styles={styles} optional />
            </View>
          </View>
        </FadeRise>

        {/* 01 — Scope */}
        <FadeRise delay={80}>
          <View style={styles.card}>
            <SectionHead num="01" icon={Hammer} title="Scope" accent={themeColors.accent} styles={styles} done={progress.scope} />

            <Text style={styles.label}>Project title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Kitchen remodel + island"
              placeholderTextColor={themeColors.textMuted}
              maxLength={80}
            />

            <Text style={[styles.label, { marginTop: 14 }]}>Category</Text>
            <View style={styles.chipRow}>
              {CATEGORIES.map(c => {
                const active = category === c.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setCategory(c.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {c.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>What do you want done?</Text>
            <Text style={styles.helper}>
              Be specific — the more detail, the better the bids. Example: &quot;Tear out existing kitchen,
              new shaker cabinets, quartz counters, refinish hardwood, relocate the sink to the island.&quot;
            </Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={scope}
              onChangeText={setScope}
              placeholder="Describe the work you want a contractor to do…"
              placeholderTextColor={themeColors.textMuted}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
            <Text style={styles.charCount}>{scope.length} chars</Text>
          </View>
        </FadeRise>

        {/* 02 — Property */}
        <FadeRise delay={140}>
          <View style={[styles.card, addressVerified && styles.cardVerified]}>
            <SectionHead num="02" icon={MapPin} title="Property" accent={themeColors.accent} styles={styles} done={progress.address} />

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
                placeholderTextColor={themeColors.textMuted}
              />
              <TouchableOpacity
                onPress={verifyAddress}
                disabled={geocoding || !address.trim()}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={[themeColors.accent, '#E04E0E']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={[styles.verifyBtn, (!address.trim() || geocoding) && { opacity: 0.55 }]}
                >
                  {geocoding ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <MapPin size={14} color="#FFF" />
                      <Text style={styles.verifyBtnText}>Verify</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
            {addressVerified && (
              <View style={styles.verifiedRow}>
                <View style={styles.verifiedBadge}>
                  <ShieldCheck size={12} color="#FFF" />
                </View>
                <Text style={styles.verifiedText} numberOfLines={1}>
                  Address verified · {latLng?.lat.toFixed(4)}, {latLng?.lng.toFixed(4)}
                </Text>
              </View>
            )}
          </View>
        </FadeRise>

        {/* 03 — Photos */}
        <FadeRise delay={200}>
          <View style={styles.card}>
            <SectionHead num="03" icon={Camera} title="Photos" accent={themeColors.accent} styles={styles} done={progress.photos} required />
            <Text style={styles.helper}>
              At least one photo is required. Helps cut spam and gives contractors something real to look at.
            </Text>
            <View style={styles.attachmentGrid}>
              {photos.map(p => (
                <View key={p.uri} style={styles.attachmentTile}>
                  <Image source={{ uri: p.uri }} style={styles.attachmentImage} />
                  <TouchableOpacity style={styles.attachmentRemove} onPress={() => removeAttachment(p.uri)} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={12} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.addTile} onPress={pickPhotos} activeOpacity={0.8}>
                <View style={styles.addTileIconWrap}>
                  <ImageIcon size={18} color={themeColors.accent} />
                </View>
                <Text style={styles.addTileText}>Library</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addTile} onPress={takePhoto} activeOpacity={0.8}>
                <View style={styles.addTileIconWrap}>
                  <Camera size={18} color={themeColors.accent} />
                </View>
                <Text style={styles.addTileText}>Camera</Text>
              </TouchableOpacity>
            </View>
          </View>
        </FadeRise>

        {/* 04 — Drawings (optional) */}
        <FadeRise delay={240}>
          <View style={styles.card}>
            <SectionHead num="04" icon={FileText} title="Drawings" accent={themeColors.accent} styles={styles} done={drawings.length > 0} optional />
            <Text style={styles.helper}>
              Architect plans, hand sketches, inspiration shots — anything that clarifies the scope. PDF or images.
            </Text>
            <View style={styles.attachmentGrid}>
              {drawings.map(d => (
                <View key={d.uri} style={styles.attachmentTile}>
                  <View style={styles.drawingTilePlaceholder}>
                    <FileText size={20} color={themeColors.accent} />
                    <Text style={styles.drawingTileName} numberOfLines={2}>{d.name}</Text>
                  </View>
                  <TouchableOpacity style={styles.attachmentRemove} onPress={() => removeAttachment(d.uri)} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={12} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity style={styles.addTile} onPress={pickDrawings} activeOpacity={0.8}>
                <View style={styles.addTileIconWrap}>
                  <FileText size={18} color={themeColors.accent} />
                </View>
                <Text style={styles.addTileText}>Add file</Text>
              </TouchableOpacity>
            </View>
          </View>
        </FadeRise>

        {/* 05 — Budget & timing */}
        <FadeRise delay={280}>
          <View style={styles.card}>
            <SectionHead num="05" icon={DollarSign} title="Budget & timing" accent={themeColors.accent} styles={styles} done={progress.budget} optional />
            <Text style={styles.helper}>
              Showing a range filters out wildly off-target bids. Leave blank if you&apos;re not sure.
            </Text>
            <View style={styles.budgetRow}>
              <View style={styles.budgetField}>
                <DollarSign size={14} color={themeColors.textMuted} />
                <TextInput
                  style={styles.budgetInput}
                  value={budgetMin}
                  onChangeText={setBudgetMin}
                  placeholder="Min"
                  placeholderTextColor={themeColors.textMuted}
                  keyboardType="numeric"
                />
              </View>
              <Text style={styles.budgetDash}>–</Text>
              <View style={styles.budgetField}>
                <DollarSign size={14} color={themeColors.textMuted} />
                <TextInput
                  style={styles.budgetInput}
                  value={budgetMax}
                  onChangeText={setBudgetMax}
                  placeholder="Max"
                  placeholderTextColor={themeColors.textMuted}
                  keyboardType="numeric"
                />
              </View>
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>Desired start</Text>
            <View style={styles.dateRow}>
              <Calendar size={14} color={themeColors.textMuted} />
              <TextInput
                style={[styles.input, { flex: 1, marginLeft: 8 }]}
                value={desiredStart}
                onChangeText={setDesiredStart}
                placeholder="e.g. Mid-July or 2026-08-15"
                placeholderTextColor={themeColors.textMuted}
              />
            </View>

            <Text style={[styles.label, { marginTop: 14 }]}>Bid deadline</Text>
            <View style={styles.dateRow}>
              <Calendar size={14} color={themeColors.textMuted} />
              <TextInput
                style={[styles.input, { flex: 1, marginLeft: 8 }]}
                value={deadline}
                onChangeText={setDeadline}
                placeholder="Defaults to 14 days from today"
                placeholderTextColor={themeColors.textMuted}
              />
            </View>
          </View>
        </FadeRise>

        {error && (
          <FadeRise delay={0}>
            <View style={styles.errorCard}>
              <AlertTriangle size={16} color={themeColors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          </FadeRise>
        )}

        {/* Submit + reassurance */}
        <FadeRise delay={340}>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.88}
          >
            <LinearGradient
              colors={[themeColors.accent, '#E04E0E', '#C73E00']}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Sparkles size={16} color="#FFF" />
                  <Text style={styles.submitBtnText}>Post project</Text>
                  <ArrowRight size={16} color="#FFF" />
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.nextStepsCard}>
            <Text style={styles.nextStepsTitle}>What happens next</Text>
            <NextStep i={1} text="We notify verified contractors near your property." styles={styles} accent={themeColors.accent} />
            <NextStep i={2} text="They send sealed bids you can compare side-by-side." styles={styles} accent={themeColors.accent} />
            <NextStep i={3} text="Pick the one you like — track the work in the app." styles={styles} accent={themeColors.accent} />
          </View>

          <Text style={styles.disclaimer}>
            By posting you agree this is a real project at a real address. Trolls and fake posts get accounts banned.
          </Text>
        </FadeRise>
      </ScrollView>
      {/* Client paywall modal — controlled by the gate hook above. Placed
          at the root level so it overlays the rest of the screen when
          gate('rfp-post') is awaiting a user decision. */}
      {ClientPaywallElement}
    </View>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function SectionHead({
  num, icon: Icon, title, accent, styles, done, required, optional,
}: {
  num: string;
  icon: React.ComponentType<any>;
  title: string;
  accent: string;
  styles: ReturnType<typeof makeStyles>;
  done?: boolean;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionHeadLeft}>
        <View style={[styles.sectionIconWrap, done ? { backgroundColor: accent + '18' } : null]}>
          {done ? (
            <Check size={14} color={accent} strokeWidth={2.6} />
          ) : (
            <Icon size={14} color={accent} strokeWidth={2.2} />
          )}
        </View>
        <Text style={styles.sectionNum}>{num}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {required && !done && (
        <Text style={styles.sectionRequired}>REQUIRED</Text>
      )}
      {optional && (
        <Text style={styles.sectionOptional}>OPTIONAL</Text>
      )}
    </View>
  );
}

function ProgressSeg({
  label, done, accent, styles, optional,
}: {
  label: string;
  done: boolean;
  accent: string;
  styles: ReturnType<typeof makeStyles>;
  optional?: boolean;
}) {
  return (
    <View style={styles.progressSeg}>
      <View style={[
        styles.progressBar,
        done ? { backgroundColor: accent } : null,
        !done && optional ? { backgroundColor: accent + '30' } : null,
      ]} />
      <Text style={[
        styles.progressLabel,
        done ? { color: accent } : null,
      ]}>
        {label}
      </Text>
    </View>
  );
}

function NextStep({ i, text, styles, accent }: {
  i: number; text: string; styles: ReturnType<typeof makeStyles>; accent: string;
}) {
  return (
    <View style={styles.nextStepRow}>
      <View style={[styles.nextStepNum, { backgroundColor: accent + '18' }]}>
        <Text style={[styles.nextStepNumText, { color: accent }]}>{i}</Text>
      </View>
      <Text style={styles.nextStepText}>{text}</Text>
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  // ── Hero header ─────────────────────────────────────────────────────
  heroWrap: { borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden' },
  hero: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 24,
    overflow: 'hidden',
  },
  heroBgIcon: {
    position: 'absolute',
    right: -40,
    bottom: -50,
    transform: [{ rotate: '-10deg' }],
  },
  heroBack: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  heroEyebrow: {
    fontSize: 11, fontWeight: '800', color: 'rgba(255,255,255,0.85)',
    letterSpacing: 1.5,
  },
  heroTitle: {
    fontSize: 26, fontWeight: '800', color: '#FFF',
    letterSpacing: -0.6, lineHeight: 30, marginTop: 6,
  },
  heroSubtitle: {
    fontSize: 13, fontWeight: '500', color: 'rgba(255,255,255,0.88)',
    marginTop: 10, lineHeight: 18, maxWidth: 320,
  },

  // ── Progress strip card
  progressCard: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 14,
    marginTop: 4,
  },
  progressHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  progressTitle: { fontSize: 13, fontWeight: '800', color: t.text, letterSpacing: -0.2, flex: 1 },
  progressEta: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full,
    backgroundColor: t.accent + '15',
  },
  progressEtaText: { fontSize: 10.5, fontWeight: '800', color: t.accent, letterSpacing: 0.3 },
  progressRow: { flexDirection: 'row', gap: 6 },
  progressSeg: { flex: 1, gap: 5 },
  progressBar: { height: 4, borderRadius: 2, backgroundColor: t.line },
  progressLabel: {
    fontSize: 9.5, fontWeight: '800', color: t.textMuted,
    letterSpacing: 0.5, textTransform: 'uppercase',
  },

  // ── Card shell + section head
  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 16,
    borderWidth: 1, borderColor: t.line, marginBottom: 14,
  },
  cardVerified: {
    borderColor: t.success + '55',
    shadowColor: t.success, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12, shadowRadius: 8, elevation: 1,
  },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  sectionIconWrap: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: t.line + '60',
    alignItems: 'center', justifyContent: 'center',
  },
  sectionNum: {
    fontSize: 11, fontWeight: '800', color: t.textMuted,
    letterSpacing: 0.6,
  },
  sectionTitle: {
    fontSize: 16, fontWeight: '800', color: t.text,
    letterSpacing: -0.3, flex: 1,
  },
  sectionRequired: {
    fontSize: 9, fontWeight: '800', color: t.accent,
    letterSpacing: 0.8, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: Tokens.radius.full, backgroundColor: t.accent + '15',
  },
  sectionOptional: {
    fontSize: 9, fontWeight: '800', color: t.textMuted,
    letterSpacing: 0.8, paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: Tokens.radius.full, backgroundColor: t.line,
  },

  label:  { fontSize: 11, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 },
  helper: { fontSize: 12.5, color: t.textSecondary, marginBottom: 10, lineHeight: 17, fontWeight: '500' },
  charCount: { fontSize: Type.caption2.fontSize, color: t.textMuted, alignSelf: 'flex-end', marginTop: 4 },

  input: {
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  inputMultiline: { minHeight: 110, paddingTop: 12 },

  // Category chips: accent-tinted active state (orange ring + light fill)
  // rather than the old solid black fill — feels on-brand.
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9,
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line,
  },
  chipActive: { backgroundColor: t.accent + '15', borderColor: t.accent },
  chipText:  { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  chipTextActive: { color: t.accent },

  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 11, borderRadius: Tokens.radius.md,
  },
  verifyBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '800', color: '#FFF' },
  verifiedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 10, padding: 10,
    backgroundColor: t.success + '12',
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.success + '30',
  },
  verifiedBadge: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: t.success,
    alignItems: 'center', justifyContent: 'center',
  },
  verifiedText: { flex: 1, fontSize: 12, color: t.success, fontWeight: '700' },

  // Attachment tiles. Adds an icon-in-circle on the "add" tiles for craft.
  attachmentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  attachmentTile: {
    width: 92, height: 92, borderRadius: Tokens.radius.md, overflow: 'hidden',
    backgroundColor: t.bg, position: 'relative',
  },
  attachmentImage: { width: '100%', height: '100%' },
  attachmentRemove: {
    position: 'absolute', top: 4, right: 4,
    width: 20, height: 20, borderRadius: Tokens.radius.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  drawingTilePlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6,
  },
  drawingTileName: { fontSize: 9, color: t.text, textAlign: 'center', lineHeight: 11 },
  addTile: {
    width: 92, height: 92, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '08',
    borderWidth: 1.5, borderColor: t.accent + '40', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 5,
  },
  addTileIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: t.accent + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  addTileText: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.accent, letterSpacing: 0.3 },

  budgetRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  budgetField:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.bg, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, paddingHorizontal: 10 },
  budgetInput:  { flex: 1, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: t.text },
  budgetDash:   { fontSize: Type.callout.fontSize, color: t.textMuted },
  dateRow:      { flexDirection: 'row', alignItems: 'center' },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: t.danger + '0D',
    borderWidth: 1, borderColor: t.danger + '30',
    marginBottom: 14,
  },
  errorText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.danger, lineHeight: 18 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 16, borderRadius: Tokens.radius.card,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32, shadowRadius: 18, elevation: 6,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontSize: 16, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },

  nextStepsCard: {
    marginTop: 16,
    padding: 14,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.accent + '08',
    borderWidth: 1, borderColor: t.accent + '20',
    gap: 10,
  },
  nextStepsTitle: {
    fontSize: 11, fontWeight: '800', color: t.accent,
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4,
  },
  nextStepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextStepNum: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  nextStepNumText: { fontSize: 11, fontWeight: '800' },
  nextStepText: { flex: 1, fontSize: 13, color: t.text, fontWeight: '600', lineHeight: 18 },

  disclaimer: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center', marginTop: 14, fontStyle: 'italic', paddingHorizontal: 16, lineHeight: 16 },
});
