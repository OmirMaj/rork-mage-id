// post-rfp — homeowner-side "post a project" wizard.
//
// 4-step flow with a sticky bottom action bar:
//   1. Project details — address, work type, description, photos
//   2. Scope          — drawings + any extra detail
//   3. Budget & timing — budget range, desired start, bid deadline
//   4. Review & post  — summary + final submit
//
// The submission contract is identical to the prior single-screen version:
// validate → paywall gate → upload attachments → insert public_bids row
// with is_homeowner_rfp=true → push the user to /my-rfps. None of that
// logic changed in this rewrite — only the UX in front of it.
//
// Internal category mapping: the visual chips are Renovation / Addition /
// New Build / Other, but the public_bids.category column is still the
// existing BidCategory enum. We map UI work-type → enum on submit so no
// schema migration is required.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Image, ActivityIndicator, Animated, Easing, KeyboardAvoidingView,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, Camera, FileText, MapPin, DollarSign, Calendar,
  X, Image as ImageIcon, ShieldCheck, AlertTriangle, Building2,
  Home, LayoutGrid, MoreHorizontal, ClipboardCheck, Clock, Briefcase,
  Check, ArrowRight, Plus, TreePine,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
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
import { showAlert } from '@/utils/alert';

interface PickedAttachment {
  uri: string;
  name: string;
  contentType: string;
  kind: 'photo' | 'drawing';
}

type WizardStep = 'details' | 'scope' | 'budget' | 'review';
type WorkType   = 'renovation' | 'addition' | 'new_build' | 'other';

const STEPS: { id: WizardStep; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'details', label: 'Project details', icon: MapPin },
  { id: 'scope',   label: 'Scope',           icon: ClipboardCheck },
  { id: 'budget',  label: 'Budget & timing', icon: Clock },
  { id: 'review',  label: 'Review & post',   icon: Check },
];

const WORK_TYPES: { id: WorkType; label: string; icon: React.ComponentType<any> }[] = [
  { id: 'renovation', label: 'Renovation', icon: Home },
  { id: 'addition',   label: 'Addition',   icon: LayoutGrid },
  { id: 'new_build',  label: 'New Build',  icon: Building2 },
  { id: 'other',      label: 'Other',      icon: MoreHorizontal },
];

// Map the new visual work-type chips to the existing BidCategory enum so
// we don't need a schema migration. Renovation + Addition both live under
// 'residential' (residential remodel); New Build is 'construction'; Other
// falls back to 'residential' so the public_bids row stays valid.
function workTypeToCategory(w: WorkType): BidCategory {
  switch (w) {
    case 'new_build': return 'construction';
    case 'renovation':
    case 'addition':
    case 'other':
    default:          return 'residential';
  }
}

// Tiny fade-and-rise wrapper, native driver. Same recipe used elsewhere.
function FadeRise({ delay = 0, children, style }: {
  delay?: number; children: React.ReactNode; style?: any;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 360, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 360, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [opacity, translateY, delay]);
  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

const DRAFT_PREFIX = 'post-rfp:draft:';

export default function PostRfpScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  // Optional prefill — when another screen routes here with context already
  // in hand (today: the Property Manager work-order "Post for bids" bridge),
  // it passes the scope/budget/address as params so the homeowner-RFP form
  // opens pre-filled instead of blank. Every key is optional; a plain
  // /post-rfp with no params behaves exactly as before. Read once into the
  // initial state below — we don't keep re-reading params on every render.
  const prefill = useLocalSearchParams<{
    prefillDescription?: string;
    prefillScope?: string;
    prefillAddress?: string;
    prefillBudgetMin?: string;
    prefillBudgetMax?: string;
    prefillWorkType?: string;
  }>();
  const p1 = (v?: string | string[]) => (Array.isArray(v) ? v[0] : v) ?? '';
  const initialWorkType = ((): WorkType => {
    const w = p1(prefill.prefillWorkType);
    return WORK_TYPES.some(t => t.id === w) ? (w as WorkType) : 'renovation';
  })();

  // Client paywall gate — sits in front of the final submit. Subscribers
  // breeze through; everyone else gets the modal asking them to pay per-
  // post or start a trial. `ClientPaywallElement` must be rendered in JSX
  // for gate() to be able to flip it open. See hooks/useClientPaywall.ts.
  const { gate: gateClientPaywall, ClientPaywallElement } = useClientPaywall();

  const [step, setStep]                   = useState<WizardStep>('details');
  const [workType, setWorkType]           = useState<WorkType>(initialWorkType);
  const [description, setDescription]     = useState(() => p1(prefill.prefillDescription));
  const [address, setAddress]             = useState(() => p1(prefill.prefillAddress));
  const [latLng, setLatLng]               = useState<{ lat: number; lng: number } | null>(null);
  const [addressVerified, setAddressVerified] = useState(false);
  const [extraScope, setExtraScope]       = useState(() => p1(prefill.prefillScope));
  const [budgetMin, setBudgetMin]         = useState(() => p1(prefill.prefillBudgetMin));
  const [budgetMax, setBudgetMax]         = useState(() => p1(prefill.prefillBudgetMax));
  const [desiredStart, setDesiredStart]   = useState('');
  const [deadline, setDeadline]           = useState('');
  // Verified-only RFP: when on, only license-verified contractors are
  // notified and may bid. The antidote to shared-lead blasting — fewer,
  // higher-quality bids from vetted pros.
  const [verifiedOnly, setVerifiedOnly]   = useState(false);
  const [attachments, setAttachments]     = useState<PickedAttachment[]>([]);
  const [submitting, setSubmitting]       = useState(false);
  const [geocoding, setGeocoding]         = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [savingDraft, setSavingDraft]     = useState(false);

  const photos    = useMemo(() => attachments.filter(a => a.kind === 'photo'),    [attachments]);
  const drawings  = useMemo(() => attachments.filter(a => a.kind === 'drawing'),  [attachments]);

  const stepIdx = useMemo(() => STEPS.findIndex(s => s.id === step), [step]);

  // Per-step validity used to gate the Continue button + show inline
  // hints. Step 4 (review) is always "ready" — the submit button itself
  // does final validation.
  const stepValid = useMemo<Record<WizardStep, { ok: boolean; reason?: string }>>(() => ({
    details: {
      ok:
        address.trim().length > 0 &&
        description.trim().length >= 20 &&
        photos.length > 0,
      reason:
        !address.trim() ? 'Add the property address to continue.' :
        description.trim().length < 20 ? 'Describe the project in a sentence or two.' :
        photos.length === 0 ? 'Add at least one photo of the property.' : undefined,
    },
    scope:  { ok: true },
    budget: { ok: true },
    review: { ok: true },
  }), [address, description, photos.length]);

  const goNext = useCallback(() => {
    setError(null);
    const v = stepValid[step];
    if (!v.ok) { setError(v.reason ?? null); return; }
    const next = STEPS[stepIdx + 1]?.id;
    if (next) setStep(next);
  }, [step, stepIdx, stepValid]);

  const goBack = useCallback(() => {
    setError(null);
    const prev = STEPS[stepIdx - 1]?.id;
    if (prev) setStep(prev);
    else router.back();
  }, [stepIdx, router]);

  const verifyAddress = useCallback(async () => {
    setError(null);
    if (!address.trim()) {
      showAlert('Address Required', 'Enter the property address before verifying.');
      return;
    }
    if (Platform.OS === 'web') {
      // expo-location's geocodeAsync isn't supported on web. Fall back to
      // submission without coordinates — contractors can still see the
      // address text, they just won't get distance-based matching.
      setAddressVerified(false);
      showAlert('Heads up', 'Address auto-verification only runs on the iOS/Android app. You can still post; nearby-contractor matching may be less precise.');
      return;
    }
    try {
      setGeocoding(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        showAlert('Permission needed', 'Location permission is needed to verify the address. You can still post without verification.');
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
        showAlert('Address not found', 'We couldn\'t locate that address. Double-check it — contractors won\'t see your post in nearby-RFP feeds without coordinates.');
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
      showAlert('Permission needed', 'Photo library access is required to attach project photos.');
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

  const finalValidate = useCallback((): string | null => {
    if (!description.trim())           return 'Add a short description of the project.';
    if (description.trim().length < 20) return 'Description is too short. A sentence or two helps contractors size it up.';
    if (!address.trim())               return 'Property address is required.';
    if (photos.length === 0)           return 'At least one photo of the property is required. (This helps cut down on troll posts.)';
    return null;
  }, [description, address, photos.length]);

  // Save a snapshot to AsyncStorage so the user can leave and come back
  // without re-typing everything. Attachment URIs are local cache paths;
  // they may not survive a process kill, so on restore we drop any URIs
  // that don't resolve. For this commit we only write; auto-restore on
  // mount is a follow-up.
  const saveDraft = useCallback(async () => {
    if (!user?.id) {
      showAlert('Sign in needed', 'Sign in to save drafts so you can come back to them later.');
      return;
    }
    try {
      setSavingDraft(true);
      const payload = {
        workType, description, address, latLng, addressVerified,
        extraScope, budgetMin, budgetMax, desiredStart, deadline,
        attachments: attachments.map(a => ({ ...a })),
        savedAt: new Date().toISOString(),
      };
      await AsyncStorage.setItem(DRAFT_PREFIX + user.id, JSON.stringify(payload));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert('Draft saved', 'You can pick this back up next time you open Post a project.');
    } catch (e) {
      console.warn('[post-rfp] saveDraft failed', e);
      showAlert('Couldn\'t save draft', 'Try again in a moment.');
    } finally {
      setSavingDraft(false);
    }
  }, [user?.id, workType, description, address, latLng, addressVerified, extraScope, budgetMin, budgetMax, desiredStart, deadline, attachments]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const v = finalValidate();
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
      const derivedTitle = deriveTitle(description);
      const fullScope = [description.trim(), extraScope.trim()].filter(Boolean).join('\n\n');

      const { error: insertErr } = await supabase.from('public_bids').insert({
        id: rfpId,
        user_id: user.id,
        title: derivedTitle,
        issuing_agency: '',
        city: cityState.city,
        state: cityState.state,
        category: workTypeToCategory(workType),
        bid_type: 'private',
        estimated_value: Number(budgetMax) || Number(budgetMin) || 0,
        bond_required: 0,
        deadline: deadline || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        description: fullScope.slice(0, 280),  // legacy short description for list views
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
        scope_description: fullScope,
        budget_min: budgetMin ? Number(budgetMin) : null,
        budget_max: budgetMax ? Number(budgetMax) : null,
        desired_start: desiredStart || null,
        address_verified: addressVerified,
        verified_only: verifiedOnly,
      });
      if (insertErr) throw insertErr;

      // Clear the draft now that the row is committed.
      try { await AsyncStorage.removeItem(DRAFT_PREFIX + user.id); } catch {}

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(
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
  }, [finalValidate, user, attachments, description, extraScope, address, workType, budgetMin, budgetMax, deadline, latLng, desiredStart, addressVerified, verifiedOnly, router, gateClientPaywall]);

  const isLastStep = step === 'review';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* KeyboardAvoidingView wraps both the ScrollView AND the bottom
          action bar. On iOS, behavior="padding" pads the bottom by the
          keyboard's height so the sticky bar lifts above it; on Android
          we use "height" which resizes the layout. Without this the
          keyboard covered the Continue button on the inner steps. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={insets.top}
      >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Hero — soft cream, no gradient. Decorative Building2 + TreePine
            in the top-right corner to suggest the isometric house in the
            design without a custom illustration asset. */}
        <View style={styles.hero}>
          <TouchableOpacity
            onPress={goBack}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.heroBack}
          >
            <ChevronLeft size={20} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>

          <View style={styles.heroIllustration} pointerEvents="none">
            <TreePine size={48} color={themeColors.accent + '60'} strokeWidth={1.4} style={{ marginRight: -4, marginTop: 8 }} />
            <Building2 size={96} color={themeColors.accent + 'AA'} strokeWidth={1.3} />
          </View>

          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Get quality bids.</Text>
            <Text style={[styles.heroTitle, { color: themeColors.accent }]}>Done right.</Text>
            <Text style={styles.heroSubtitle}>
              Tell us about your project and local contractors will send you competitive bids.
            </Text>
          </View>

          {/* Step indicator — 4 icon nodes connected by dotted lines. The
              active node fills with the accent; completed ones get a
              lighter tint with a checkmark. */}
          <View style={styles.stepperCard}>
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const active = i === stepIdx;
              const done = i < stepIdx;
              return (
                <React.Fragment key={s.id}>
                  <View style={styles.stepNode}>
                    <View style={[
                      styles.stepDot,
                      active ? { backgroundColor: themeColors.accent } : null,
                      done ? { backgroundColor: themeColors.accent + '22' } : null,
                    ]}>
                      {done ? (
                        <Check size={14} color={themeColors.accent} strokeWidth={2.6} />
                      ) : (
                        <Icon size={14} color={active ? '#FFF' : themeColors.textMuted} strokeWidth={2.2} />
                      )}
                    </View>
                    <Text style={[
                      styles.stepLabel,
                      active ? { color: themeColors.text, fontWeight: '800' } : null,
                    ]} numberOfLines={2}>
                      {s.label}
                    </Text>
                  </View>
                  {i < STEPS.length - 1 && <View style={styles.stepLine} />}
                </React.Fragment>
              );
            })}
          </View>
        </View>

        <View style={styles.body}>
          {step === 'details' && (
            <DetailsStep
              styles={styles}
              themeColors={themeColors}
              address={address}
              setAddress={(v) => { setAddress(v); setAddressVerified(false); setLatLng(null); }}
              verifyAddress={verifyAddress}
              geocoding={geocoding}
              addressVerified={addressVerified}
              latLng={latLng}
              workType={workType}
              setWorkType={setWorkType}
              description={description}
              setDescription={setDescription}
              photos={photos}
              pickPhotos={pickPhotos}
              removeAttachment={removeAttachment}
            />
          )}
          {step === 'scope' && (
            <ScopeStep
              styles={styles}
              themeColors={themeColors}
              extraScope={extraScope}
              setExtraScope={setExtraScope}
              drawings={drawings}
              pickDrawings={pickDrawings}
              removeAttachment={removeAttachment}
            />
          )}
          {step === 'budget' && (
            <BudgetStep
              styles={styles}
              themeColors={themeColors}
              budgetMin={budgetMin} setBudgetMin={setBudgetMin}
              budgetMax={budgetMax} setBudgetMax={setBudgetMax}
              desiredStart={desiredStart} setDesiredStart={setDesiredStart}
              deadline={deadline} setDeadline={setDeadline}
              verifiedOnly={verifiedOnly} setVerifiedOnly={setVerifiedOnly}
            />
          )}
          {step === 'review' && (
            <ReviewStep
              styles={styles}
              themeColors={themeColors}
              description={description}
              workType={workType}
              address={address}
              addressVerified={addressVerified}
              photoCount={photos.length}
              drawingCount={drawings.length}
              extraScope={extraScope}
              budgetMin={budgetMin}
              budgetMax={budgetMax}
              desiredStart={desiredStart}
              deadline={deadline}
              jumpTo={setStep}
            />
          )}

          {error && (
            <FadeRise delay={0}>
              <View style={styles.errorCard}>
                <AlertTriangle size={16} color={themeColors.danger} strokeWidth={1.75} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            </FadeRise>
          )}
        </View>
      </ScrollView>

      {/* Sticky bottom action bar — Save draft (left) + Continue/Post
          (right). Matches the design mock. */}
      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TouchableOpacity
          onPress={saveDraft}
          disabled={savingDraft}
          activeOpacity={0.7}
          style={styles.draftBtn}
        >
          <Text style={styles.draftTitle}>Save draft</Text>
          <Text style={styles.draftHint}>We&apos;ll save your progress</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.continueBtn,
            (submitting || (!isLastStep && !stepValid[step].ok)) && styles.continueBtnDim,
          ]}
          onPress={isLastStep ? handleSubmit : goNext}
          disabled={submitting}
          activeOpacity={0.88}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Text style={styles.continueBtnText}>
                {isLastStep ? 'Post project' : 'Continue'}
              </Text>
              <ArrowRight size={17} color="#FFF" strokeWidth={2.6} />
            </>
          )}
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>

      {/* Client paywall modal — controlled by the gate hook above. Placed
          at the root level so it overlays the rest of the screen when
          gate('rfp-post') is awaiting a user decision. */}
      {ClientPaywallElement}
    </View>
  );
}

// ── Step components ───────────────────────────────────────────────────────

interface StyleProp { styles: ReturnType<typeof makeStyles>; themeColors: ThemeColors }

function DetailsStep({
  styles, themeColors,
  address, setAddress, verifyAddress, geocoding, addressVerified, latLng,
  workType, setWorkType, description, setDescription,
  photos, pickPhotos, removeAttachment,
}: StyleProp & {
  address: string; setAddress: (v: string) => void;
  verifyAddress: () => void; geocoding: boolean; addressVerified: boolean;
  latLng: { lat: number; lng: number } | null;
  workType: WorkType; setWorkType: (w: WorkType) => void;
  description: string; setDescription: (v: string) => void;
  photos: PickedAttachment[];
  pickPhotos: () => void; removeAttachment: (uri: string) => void;
}) {
  return (
    <>
      <FadeRise delay={0}>
        <Text style={styles.stepHeading}>Let&apos;s start with the basics</Text>
      </FadeRise>

      {/* Address */}
      <FadeRise delay={60}>
        <View style={styles.card}>
          <CardHead icon={MapPin} title="Project address" subtitle="We'll use this to find verified contractors near you." styles={styles} themeColors={themeColors} />
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={address}
              onChangeText={setAddress}
              placeholder="123 Main St, Springfield, IL"
              placeholderTextColor={themeColors.textMuted}
            />
            <TouchableOpacity
              onPress={verifyAddress}
              disabled={geocoding || !address.trim()}
              activeOpacity={0.85}
              style={[
                styles.verifyBtn,
                (geocoding || !address.trim()) && { opacity: 0.55 },
              ]}
            >
              {geocoding ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={styles.verifyBtnText}>Verify</Text>
              )}
            </TouchableOpacity>
          </View>
          {addressVerified && (
            <View style={styles.verifiedRow}>
              <ShieldCheck size={13} color={themeColors.success} strokeWidth={1.75} />
              <Text style={styles.verifiedText} numberOfLines={1}>
                Verified · {latLng?.lat.toFixed(4)}, {latLng?.lng.toFixed(4)}
              </Text>
            </View>
          )}
        </View>
      </FadeRise>

      {/* Work type */}
      <FadeRise delay={120}>
        <View style={styles.card}>
          <CardHead icon={Briefcase} title="What type of work is this?" styles={styles} themeColors={themeColors} chevron />
          <View style={styles.workTypeRow}>
            {WORK_TYPES.map(w => {
              const Icon = w.icon;
              const active = workType === w.id;
              return (
                <TouchableOpacity
                  key={w.id}
                  onPress={() => setWorkType(w.id)}
                  activeOpacity={0.85}
                  style={[styles.workTypeChip, active && styles.workTypeChipActive]}
                >
                  <Icon size={16} color={active ? themeColors.accent : themeColors.text} strokeWidth={2.1} />
                  <Text style={[
                    styles.workTypeLabel,
                    active && { color: themeColors.accent, fontWeight: '800' },
                  ]} numberOfLines={1}>
                    {w.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </FadeRise>

      {/* Description */}
      <FadeRise delay={180}>
        <View style={styles.card}>
          <CardHead icon={FileText} title="Tell us about your project" subtitle="The more details you add, the more accurate your bids." styles={styles} themeColors={themeColors} />
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Kitchen remodel, 2 bathrooms, open layout…"
            placeholderTextColor={themeColors.textMuted}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            maxLength={500}
          />
          <Text style={styles.charCount}>{description.length}/500</Text>
        </View>
      </FadeRise>

      {/* Photos */}
      <FadeRise delay={240}>
        <View style={styles.card}>
          <CardHead icon={ImageIcon} title="Add photos (recommended)" subtitle="Photos help contractors understand your project." styles={styles} themeColors={themeColors} />
          <View style={styles.photoGrid}>
            <TouchableOpacity style={styles.uploadTile} onPress={pickPhotos} activeOpacity={0.8}>
              <View style={styles.uploadIconWrap}>
                <Plus size={16} color={themeColors.accent} strokeWidth={2.6} />
              </View>
              <Text style={styles.uploadText}>Upload photos</Text>
            </TouchableOpacity>
            {photos.map(p => (
              <View key={p.uri} style={styles.photoTile}>
                <Image source={{ uri: p.uri }} style={styles.photoImg} />
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => removeAttachment(p.uri)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove photo"
                >
                  <X size={11} color={themeColors.text} strokeWidth={2.6} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <View style={styles.proTipCard}>
            <MageAIMark size={13} color={themeColors.accent} />
            <Text style={styles.proTipText}>
              <Text style={styles.proTipBold}>Pro tip: </Text>
              Add at least 3 photos for better, more accurate bids.
            </Text>
          </View>
        </View>
      </FadeRise>
    </>
  );
}

function ScopeStep({
  styles, themeColors,
  extraScope, setExtraScope, drawings, pickDrawings, removeAttachment,
}: StyleProp & {
  extraScope: string; setExtraScope: (v: string) => void;
  drawings: PickedAttachment[]; pickDrawings: () => void;
  removeAttachment: (uri: string) => void;
}) {
  return (
    <>
      <FadeRise delay={0}>
        <Text style={styles.stepHeading}>Anything else we should know?</Text>
      </FadeRise>

      <FadeRise delay={60}>
        <View style={styles.card}>
          <CardHead icon={ClipboardCheck} title="Additional scope" subtitle="Materials, finishes, must-haves, or constraints contractors should know about." styles={styles} themeColors={themeColors} />
          <TextInput
            style={[styles.input, styles.inputMultiline]}
            value={extraScope}
            onChangeText={setExtraScope}
            placeholder="e.g. Quartz counters, hardwood refinish, weekend work OK…"
            placeholderTextColor={themeColors.textMuted}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>
      </FadeRise>

      <FadeRise delay={120}>
        <View style={styles.card}>
          <CardHead icon={FileText} title="Drawings or plans (optional)" subtitle="Architect plans, sketches, inspiration shots. PDF or images." styles={styles} themeColors={themeColors} />
          <View style={styles.photoGrid}>
            <TouchableOpacity style={styles.uploadTile} onPress={pickDrawings} activeOpacity={0.8}>
              <View style={styles.uploadIconWrap}>
                <Plus size={16} color={themeColors.accent} strokeWidth={2.6} />
              </View>
              <Text style={styles.uploadText}>Add file</Text>
            </TouchableOpacity>
            {drawings.map(d => (
              <View key={d.uri} style={styles.photoTile}>
                <View style={styles.drawingPlaceholder}>
                  <FileText size={18} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.drawingName} numberOfLines={2}>{d.name}</Text>
                </View>
                <TouchableOpacity
                  style={styles.photoRemove}
                  onPress={() => removeAttachment(d.uri)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove file"
                >
                  <X size={11} color={themeColors.text} strokeWidth={2.6} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      </FadeRise>
    </>
  );
}

function BudgetStep({
  styles, themeColors,
  budgetMin, setBudgetMin, budgetMax, setBudgetMax,
  desiredStart, setDesiredStart, deadline, setDeadline,
  verifiedOnly, setVerifiedOnly,
}: StyleProp & {
  budgetMin: string; setBudgetMin: (v: string) => void;
  budgetMax: string; setBudgetMax: (v: string) => void;
  desiredStart: string; setDesiredStart: (v: string) => void;
  deadline: string; setDeadline: (v: string) => void;
  verifiedOnly: boolean; setVerifiedOnly: (v: boolean) => void;
}) {
  return (
    <>
      <FadeRise delay={0}>
        <Text style={styles.stepHeading}>Budget and timing</Text>
      </FadeRise>

      <FadeRise delay={60}>
        <View style={styles.card}>
          <CardHead icon={DollarSign} title="Budget range" subtitle="A range filters out wildly off-target bids. Leave blank if you're not sure." styles={styles} themeColors={themeColors} />
          <View style={styles.budgetRow}>
            <View style={styles.budgetField}>
              <DollarSign size={14} color={themeColors.textMuted} strokeWidth={1.75} />
              <TextInput
                style={styles.budgetInput}
                value={budgetMin} onChangeText={setBudgetMin}
                placeholder="Min" placeholderTextColor={themeColors.textMuted}
                keyboardType="numeric"
              />
            </View>
            <Text style={styles.budgetDash}>–</Text>
            <View style={styles.budgetField}>
              <DollarSign size={14} color={themeColors.textMuted} strokeWidth={1.75} />
              <TextInput
                style={styles.budgetInput}
                value={budgetMax} onChangeText={setBudgetMax}
                placeholder="Max" placeholderTextColor={themeColors.textMuted}
                keyboardType="numeric"
              />
            </View>
          </View>
        </View>
      </FadeRise>

      <FadeRise delay={120}>
        <View style={styles.card}>
          <CardHead icon={Calendar} title="Timing" subtitle="When do you want work to start, and when should bids be in?" styles={styles} themeColors={themeColors} />
          <Text style={styles.label}>Desired start</Text>
          <TextInput
            style={styles.input}
            value={desiredStart} onChangeText={setDesiredStart}
            placeholder="e.g. Mid-July or 2026-08-15"
            placeholderTextColor={themeColors.textMuted}
          />
          <Text style={[styles.label, { marginTop: 14 }]}>Bid deadline</Text>
          <TextInput
            style={styles.input}
            value={deadline} onChangeText={setDeadline}
            placeholder="Defaults to 14 days from today"
            placeholderTextColor={themeColors.textMuted}
          />
        </View>
      </FadeRise>

      <FadeRise delay={180}>
        <TouchableOpacity
          style={[styles.verifyToggle, verifiedOnly && styles.verifyToggleActive]}
          onPress={() => setVerifiedOnly(!verifiedOnly)}
          activeOpacity={0.85}
          testID="post-rfp-verified-only"
        >
          <ShieldCheck size={20} color={verifiedOnly ? themeColors.success : themeColors.textMuted} strokeWidth={1.75} />
          <View style={{ flex: 1 }}>
            <Text style={styles.verifyToggleTitle}>Verified pros only</Text>
            <Text style={styles.verifyToggleSub}>
              Only license-verified contractors get notified and can bid. Fewer bids, higher quality.
            </Text>
          </View>
          <View style={[styles.verifyCheckbox, verifiedOnly && styles.verifyCheckboxOn]}>
            {verifiedOnly && <Check size={14} color="#FFF" strokeWidth={1.75} />}
          </View>
        </TouchableOpacity>
      </FadeRise>
    </>
  );
}

function ReviewStep({
  styles, themeColors,
  description, workType, address, addressVerified,
  photoCount, drawingCount, extraScope,
  budgetMin, budgetMax, desiredStart, deadline,
  jumpTo,
}: StyleProp & {
  description: string; workType: WorkType;
  address: string; addressVerified: boolean;
  photoCount: number; drawingCount: number; extraScope: string;
  budgetMin: string; budgetMax: string; desiredStart: string; deadline: string;
  jumpTo: (s: WizardStep) => void;
}) {
  const workTypeLabel = WORK_TYPES.find(w => w.id === workType)?.label ?? '—';
  return (
    <>
      <FadeRise delay={0}>
        <Text style={styles.stepHeading}>Review and post</Text>
      </FadeRise>

      <FadeRise delay={60}>
        <View style={styles.card}>
          <ReviewRow label="Project"  value={deriveTitle(description) || '—'} onEdit={() => jumpTo('details')} styles={styles} />
          <ReviewRow label="Type"     value={workTypeLabel} onEdit={() => jumpTo('details')} styles={styles} />
          <ReviewRow label="Address"  value={address || '—'} hint={addressVerified ? 'Verified' : undefined} onEdit={() => jumpTo('details')} styles={styles} />
          <ReviewRow label="Photos"   value={`${photoCount} photo${photoCount === 1 ? '' : 's'}`} onEdit={() => jumpTo('details')} styles={styles} />
        </View>
      </FadeRise>

      <FadeRise delay={120}>
        <View style={styles.card}>
          <ReviewRow label="Extra scope" value={extraScope || '—'} multiline onEdit={() => jumpTo('scope')} styles={styles} />
          <ReviewRow label="Drawings"    value={`${drawingCount} file${drawingCount === 1 ? '' : 's'}`} onEdit={() => jumpTo('scope')} styles={styles} />
        </View>
      </FadeRise>

      <FadeRise delay={180}>
        <View style={styles.card}>
          <ReviewRow label="Budget" value={budgetRangeText(budgetMin, budgetMax)} onEdit={() => jumpTo('budget')} styles={styles} />
          <ReviewRow label="Start"  value={desiredStart || '—'}                  onEdit={() => jumpTo('budget')} styles={styles} />
          <ReviewRow label="Deadline" value={deadline || '14 days from today'}   onEdit={() => jumpTo('budget')} styles={styles} />
        </View>
      </FadeRise>

      <FadeRise delay={240}>
        <View style={styles.disclaimerCard}>
          <MageAIMark size={13} color={themeColors.accent} />
          <Text style={styles.disclaimerText}>
            By posting you agree this is a real project at a real address. Trolls and fake posts get accounts banned.
          </Text>
        </View>
      </FadeRise>
    </>
  );
}

function ReviewRow({ label, value, hint, onEdit, multiline, styles }: {
  label: string; value: string; hint?: string; onEdit: () => void; multiline?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.reviewRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.reviewLabel}>{label}</Text>
        <Text style={styles.reviewValue} numberOfLines={multiline ? 3 : 1}>{value}</Text>
        {hint && <Text style={styles.reviewHint}>{hint}</Text>}
      </View>
      <TouchableOpacity onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit ${label}`}>
        <Text style={styles.reviewEdit}>Edit</Text>
      </TouchableOpacity>
    </View>
  );
}

function CardHead({
  icon: Icon, title, subtitle, chevron, styles, themeColors,
}: {
  icon: React.ComponentType<any>;
  title: string;
  subtitle?: string;
  chevron?: boolean;
  styles: ReturnType<typeof makeStyles>;
  themeColors: ThemeColors;
}) {
  return (
    <View style={styles.cardHead}>
      <View style={styles.cardHeadIcon}>
        <Icon size={15} color={themeColors.accent} strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardHeadTitle}>{title}</Text>
        {subtitle && <Text style={styles.cardHeadSubtitle}>{subtitle}</Text>}
      </View>
      {chevron && <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />}
    </View>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

// Derive a project title from the description's first line/sentence,
// clamped to 80 chars. Used because the new wizard drops the separate
// title field — one less thing for the user to type.
function deriveTitle(desc: string): string {
  const raw = desc.trim().split(/\n|\.|;/)[0]?.trim() ?? '';
  if (!raw) return '';
  return raw.length > 80 ? raw.slice(0, 77) + '…' : raw;
}

function budgetRangeText(min: string, max: string): string {
  if (!min && !max) return '—';
  const fmt = (n: string) => '$' + Number(n).toLocaleString();
  if (min && max) return `${fmt(min)} – ${fmt(max)}`;
  if (min) return `${fmt(min)}+`;
  return `Up to ${fmt(max)}`;
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },

  // ── Hero ─────────────────────────────────────────────────────────────
  hero: {
    backgroundColor: t.bg,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 16,
    overflow: 'hidden',
  },
  heroBack: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroIllustration: {
    position: 'absolute',
    right: -8, top: 50,
    flexDirection: 'row', alignItems: 'flex-end',
  },
  heroCopy: { paddingRight: 100, marginBottom: 18 },
  heroTitle: {
    fontSize: 30, fontWeight: '800', color: t.text,
    letterSpacing: -0.9, lineHeight: 34,
  },
  heroSubtitle: {
    fontSize: 13, fontWeight: '500', color: t.textSecondary,
    marginTop: 10, lineHeight: 18, maxWidth: 280,
  },

  // ── Step indicator ───────────────────────────────────────────────────
  stepperCard: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line,
    paddingVertical: 12, paddingHorizontal: 10,
  },
  // flex:1 lets each node share the row evenly so labels get the
  // breathing room they need. 2-line labels (numberOfLines={2}) catch
  // the longer ones ("Project details", "Budget & timing") without
  // truncating with an ellipsis.
  stepNode: { flex: 1, alignItems: 'center', gap: 6, minWidth: 0 },
  stepDot: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: t.line + '70',
    alignItems: 'center', justifyContent: 'center',
  },
  stepLabel: {
    fontSize: 10, fontWeight: '700', color: t.textMuted,
    textAlign: 'center', letterSpacing: 0.1, lineHeight: 13,
    paddingHorizontal: 2,
  },
  stepLine: {
    width: 14, height: 0, borderTopWidth: 1.5,
    borderTopColor: t.line, borderStyle: 'dashed',
    marginHorizontal: 0, marginTop: 14, // line sits at dot vertical center
  },

  // ── Body ─────────────────────────────────────────────────────────────
  body: { paddingHorizontal: 16, paddingTop: 20 },
  stepHeading: {
    fontSize: 18, fontWeight: '800', color: t.text,
    letterSpacing: -0.4, marginBottom: 14,
  },

  // ── Card shell ───────────────────────────────────────────────────────
  verifyToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg,
    padding: 16, borderWidth: 1.5, borderColor: t.line, marginBottom: 14,
  },
  verifyToggleActive: { borderColor: t.success, backgroundColor: t.success + '0C' },
  verifyToggleTitle: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: t.text },
  verifyToggleSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 16 },
  verifyCheckbox: {
    width: 26, height: 26, borderRadius: Tokens.radius.sm,
    borderWidth: 1.5, borderColor: t.line, alignItems: 'center', justifyContent: 'center',
  },
  verifyCheckboxOn: { backgroundColor: t.success, borderColor: t.success },
  card: {
    backgroundColor: Colors.card,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1, borderColor: t.line,
    marginBottom: 14,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  cardHeadIcon: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
    marginTop: 1,
  },
  cardHeadTitle: { fontSize: 14.5, fontWeight: '800', color: t.text, letterSpacing: -0.2 },
  cardHeadSubtitle: { fontSize: 12.5, fontWeight: '500', color: t.textSecondary, marginTop: 2, lineHeight: 17 },

  label: { fontSize: 11, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 },
  charCount: { fontSize: 11, color: t.textMuted, alignSelf: 'flex-end', marginTop: 6, fontWeight: '600' },

  input: {
    backgroundColor: t.bg,
    borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 12,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
  },
  inputMultiline: { minHeight: 100, paddingTop: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  verifyBtn: {
    paddingHorizontal: 18, paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + 'CC',
    alignItems: 'center', justifyContent: 'center',
    minWidth: 80,
  },
  verifyBtnText: { fontSize: 14, fontWeight: '800', color: '#FFF', letterSpacing: 0.1 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  verifiedText: { flex: 1, fontSize: 11.5, color: t.success, fontWeight: '700' },

  // Work-type chips. Vertical stack (icon-over-label) rather than the
  // horizontal layout in the mock — at a real phone width, horizontal
  // chips truncate "Renovation" and "New Build" with an ellipsis.
  // Stacking lets each label use the chip's full width.
  workTypeRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  workTypeChip: {
    flex: 1, paddingVertical: 12, paddingHorizontal: 4,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1.5, borderColor: t.line,
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 6,
    minHeight: 64,
  },
  workTypeChipActive: { borderColor: t.accent, backgroundColor: t.accent + '0D' },
  workTypeLabel: {
    fontSize: 12, fontWeight: '700', color: t.text,
    textAlign: 'center', letterSpacing: -0.1,
  },

  // Photo grid
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  uploadTile: {
    width: 92, height: 92, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '0A',
    borderWidth: 1.5, borderColor: t.accent + '55', borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 5,
  },
  uploadIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: t.accent + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  uploadText: { fontSize: 10.5, fontWeight: '800', color: t.accent, letterSpacing: 0.2 },
  photoTile: {
    width: 92, height: 92, borderRadius: Tokens.radius.md, overflow: 'hidden',
    backgroundColor: t.bg, position: 'relative',
  },
  photoImg: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute', top: 5, right: 5,
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  drawingPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6,
  },
  drawingName: { fontSize: 9, color: t.text, textAlign: 'center', lineHeight: 11 },

  proTipCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: t.accent + '12',
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    marginTop: 12,
  },
  proTipText: { flex: 1, fontSize: 12, color: t.text, fontWeight: '500', lineHeight: 16 },
  proTipBold: { fontWeight: '800', color: t.accent },

  // Budget step
  budgetRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  budgetField:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.bg, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line, paddingHorizontal: 10 },
  budgetInput:  { flex: 1, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: t.text },
  budgetDash:   { fontSize: Type.callout.fontSize, color: t.textMuted, fontWeight: '700' },

  // Review step
  reviewRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
  },
  reviewLabel: {
    fontSize: 10, fontWeight: '800', color: t.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.7,
  },
  reviewValue: { fontSize: 14, fontWeight: '700', color: t.text, marginTop: 2 },
  reviewHint:  { fontSize: 11, fontWeight: '700', color: t.success, marginTop: 2 },
  reviewEdit:  { fontSize: 13, fontWeight: '800', color: t.accent },

  disclaimerCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: t.accent + '0A',
    borderRadius: Tokens.radius.md,
    padding: 12, marginTop: 4,
  },
  disclaimerText: { flex: 1, fontSize: 11.5, color: t.textSecondary, lineHeight: 16, fontWeight: '500' },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: t.danger + '0D',
    borderWidth: 1, borderColor: t.danger + '30',
    marginBottom: 14,
  },
  errorText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.danger, lineHeight: 18 },

  // ── Bottom action bar (lives inside KeyboardAvoidingView). Not
  //     position: absolute anymore — KAV pads the bottom when the
  //     keyboard opens, which lifts this bar above the keyboard via
  //     normal flex layout. Absolute positioning would have escaped
  //     the KAV's pad and stayed hidden behind the keyboard.
  bottomBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 10,
    backgroundColor: t.bg,
    borderTopWidth: 1, borderTopColor: t.line,
  },
  draftBtn: { flex: 1 },
  draftTitle: { fontSize: 14, fontWeight: '800', color: t.text },
  draftHint:  { fontSize: 11, fontWeight: '500', color: t.textMuted, marginTop: 1 },

  continueBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    paddingVertical: 14, paddingHorizontal: 22,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.accentFill,
    minWidth: 160,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28, shadowRadius: 14, elevation: 4,
  },
  continueBtnDim: { opacity: 0.55 },
  continueBtnText: { fontSize: 15, fontWeight: '800', color: '#FFF', letterSpacing: 0.1 },
});
