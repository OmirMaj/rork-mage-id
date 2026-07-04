import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, Platform, Switch, Modal, Dimensions, KeyboardAvoidingView, ActivityIndicator, Linking } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  MapPin, Ruler, Percent, ShieldCheck, Info, Trash2, ChevronRight, Building2, User, Phone, Mail, FileText, Award, Type as TypeIcon, Camera, PenTool, X, Image as ImageIcon, Store, Package, Truck, ScanFace, Bell, Crown, Star, Check, Hash, Database, HelpCircle, MessageCircle, BookOpen, LogOut, UserCircle, Eye, EyeOff, FolderDown, FolderInput, Wallet, Palette, ExternalLink, Repeat } from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors, setCustomColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useCoreData } from '@/contexts/ProjectContext';
import { USER_ROLE_LABELS } from '@/utils/onboardingProfile';
import {
  loadClientSubState,
  isClientTrialActive,
  hasActiveClientSubscription as hasActiveClientSub,
  type ClientSubState,
} from '@/utils/clientPricing';
import { useAuth } from '@/contexts/AuthContext';
import { isOwner } from '@/utils/owner';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { getAIUsageStats } from '@/utils/aiRateLimiter';
import { useTakeoffPagesQuota } from '@/hooks/useUsageStatus';
import { THEME_PRESETS } from '@/types';
import type { PDFNamingSettings } from '@/types';
import SignaturePad from '@/components/SignaturePad';
import Tutorial from '@/components/Tutorial';
import Paywall from '@/components/Paywall';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useFocusEffect } from 'expo-router';
import { fetchQboStatus, type QboStatus } from '@/utils/qboSync';
import { track, AnalyticsEvents } from '@/utils/analytics';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const SCREEN_WIDTH = Dimensions.get('window').width;

const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'How do I create my first project?',
    a: 'Tap the Projects tab, then the + button in the top right. Enter a name, location and budget and MAGE ID sets up the estimate, schedule and budget dashboard for you automatically.',
  },
  {
    q: 'What\u2019s the difference between Free, Pro and Business?',
    a: 'Free includes 1 active project and basic estimating. Pro unlocks unlimited projects, cash flow forecasting, Gantt PDF exports, AI code checks and proposal templates. Business adds time tracking, QuickBooks sync, plan viewer, subcontractor management and RFIs/submittals.',
  },
  {
    q: 'How does the AI estimate work?',
    a: 'Type a short description of the project and MAGE AI returns itemized materials and labor using current bulk pricing. You can edit any line, and the totals and tax update live.',
  },
  {
    q: 'Is my data private?',
    a: 'Yes. Your projects live in your own Supabase row with Row-Level Security so only you can read them. We never share data with third parties.',
  },
  {
    q: 'Can I use MAGE ID offline?',
    a: 'Mostly. Estimates, schedules and field reports work offline and sync when you reconnect. AI calls and bulk pricing updates need a connection.',
  },
  {
    q: 'How do I share an estimate or schedule with a client?',
    a: 'From the Project screen, tap Share \u2192 Generate Link. This creates a read-only snapshot URL you can text or email. Pro tier lets you export to PDF with your logo.',
  },
  {
    q: 'Do you support iPad?',
    a: 'iPad support is on our roadmap. Today MAGE ID runs on iPhone, Android phones and the web app at app.mageid.app.',
  },
  {
    q: 'How do I cancel or change my subscription?',
    a: 'Subscriptions are billed through Apple or Google. Manage them in your device\u2019s Subscriptions settings. If you run into issues, email support@mageid.app and we\u2019ll sort it out.',
  },
  {
    q: 'Does MAGE ID replace a lawyer or licensed inspector?',
    a: 'No. AI code checks, estimates and permit guidance are helpful starting points but the local Authority Having Jurisdiction (AHJ) and a licensed professional always govern your project.',
  },
  {
    q: 'Where do I send feedback or feature requests?',
    a: 'We read every note \u2014 email support@mageid.app or tap Contact Support above. Shipping fast is how we build, so your feedback directly shapes the roadmap.',
  },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { settings, updateSettings, projects, deleteProject, userRole } = useCoreData();
  const { user, logout, deleteAccount, isAuthenticated } = useAuth();
  const { tier } = useSubscription();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [aiUsed, setAiUsed] = useState(0);
  const [aiLimit, setAiLimit] = useState(10);
  const [aiSmartUsed, setAiSmartUsed] = useState(0);
  const [aiSmartLimit, setAiSmartLimit] = useState(3);

  // QuickBooks connection state — surfaced as a live "Connected · Company"
  // pill on the Integrations row so the user doesn't have to drill in to
  // check. Refetched on every screen focus so it stays in sync after the
  // user returns from /qbo-setup.
  const [qboStatus, setQboStatus] = useState<QboStatus | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchQboStatus().then((s) => { if (!cancelled) setQboStatus(s); }).catch(() => { /* silent */ });
      return () => { cancelled = true; };
    }, []),
  );

  // Client subscription state — drives the subtitle on the ACCOUNT TYPE
  // row so a client user can see "Pro · 12 days left in trial" without
  // drilling in. Refetched on focus so a just-started trial reflects on
  // the next return to Settings without a manual refresh.
  const [clientSub, setClientSub] = useState<ClientSubState | null>(null);
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadClientSubState().then((s) => { if (!cancelled) setClientSub(s); }).catch(() => { /* silent */ });
      return () => { cancelled = true; };
    }, []),
  );
  const qboConnected = qboStatus?.status === 'connected';
  const qboReauth = qboStatus?.status === 'reauth_required' || qboStatus?.status === 'error';
  // Monthly takeoff page quota (separate from the daily AI request
  // counter above — takeoffs are page-metered server-side; the daily
  // counter only tracks text AI requests).
  const takeoffQuota = useTakeoffPagesQuota();

  React.useEffect(() => {
    getAIUsageStats(tier as any).then(stats => {
      setAiUsed(stats.used);
      setAiLimit(stats.limit);
      setAiSmartUsed(stats.smartUsed);
      setAiSmartLimit(stats.smartLimit);
    }).catch(() => {});
  }, [tier]);

  const [location, setLocation] = useState(settings.location);
  const [taxRate, setTaxRate] = useState(settings.taxRate.toString());
  const [contingency, setContingency] = useState(settings.contingencyRate.toString());

  const branding = settings.branding ?? {
    companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '',
  };
  const [companyName, setCompanyName] = useState(branding.companyName);
  const [contactName, setContactName] = useState(branding.contactName);
  const [brandingEmail, setBrandingEmail] = useState(branding.email);
  const [brandingPhone, setBrandingPhone] = useState(branding.phone);
  const [brandingAddress, setBrandingAddress] = useState(branding.address);
  const [licenseNumber, setLicenseNumber] = useState(branding.licenseNumber);
  const [tagline, setTagline] = useState(branding.tagline);
  const [logoUri, setLogoUri] = useState<string | undefined>(branding.logoUri);
  const [signatureData, setSignatureData] = useState<string[] | undefined>(branding.signatureData);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [paywallTier, setPaywallTier] = useState<'pro' | 'business' | 'enterprise' | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string>(() => {
    const saved = settings.themeColors;
    // Default to MAGE Orange (brand) instead of the legacy forest green.
    // Users who picked Forest still keep it via the match-by-primary
    // lookup below. Falls back to 'mage' for any unrecognized primary.
    if (!saved) return 'mage';
    const match = THEME_PRESETS.find(t => t.primary === saved.primary);
    return match?.id ?? 'mage';
  });
  const [biometricsEnabled, setBiometricsEnabled] = useState(settings.biometricsEnabled ?? false);

  const defaultPdfNaming: PDFNamingSettings = {
    enabled: false,
    prefix: '',
    includeProjectName: true,
    includeDocType: true,
    includeDate: true,
    separator: '-',
    nextNumber: 1,
  };
  const [pdfNaming, setPdfNaming] = useState<PDFNamingSettings>(settings.pdfNaming ?? defaultPdfNaming);

  const pdfNamingPreview = useMemo(() => {
    if (!pdfNaming.enabled) return '';
    const sep = pdfNaming.separator;
    const parts: string[] = [];
    if (pdfNaming.prefix.trim()) parts.push(pdfNaming.prefix.trim());
    if (pdfNaming.includeProjectName) parts.push('Project Name');
    if (pdfNaming.includeDocType) parts.push('Estimate');
    if (pdfNaming.includeDate) {
      const now = new Date();
      parts.push(now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }
    const numStr = String(pdfNaming.nextNumber).padStart(3, '0');
    return parts.join(sep) + sep + numStr + '.pdf';
  }, [pdfNaming]);

  const supplierProfile = settings.supplierProfile;
  const [supCompanyName, setSupCompanyName] = useState(supplierProfile?.companyName ?? '');
  const [supContactName, setSupContactName] = useState(supplierProfile?.contactName ?? '');
  const [supEmail, setSupEmail] = useState(supplierProfile?.email ?? '');
  const [supPhone, setSupPhone] = useState(supplierProfile?.phone ?? '');
  const [supAddress, setSupAddress] = useState(supplierProfile?.address ?? '');
  const [supWebsite, setSupWebsite] = useState(supplierProfile?.website ?? '');
  const [supDescription, setSupDescription] = useState(supplierProfile?.description ?? '');
  const [supMinOrder, setSupMinOrder] = useState(supplierProfile?.minOrderAmount?.toString() ?? '');
  const [supDelivery, setSupDelivery] = useState(supplierProfile?.deliveryOptions?.join(', ') ?? '');
  const [supCategories, setSupCategories] = useState<string[]>(supplierProfile?.categories ?? []);

  const autoSaveBranding = useCallback((overrides: Partial<{ logo: string | undefined; sig: string[] | undefined }>) => {
    const newLogo = overrides.logo !== undefined ? overrides.logo : logoUri;
    const newSig = overrides.sig !== undefined ? overrides.sig : signatureData;
    updateSettings({
      branding: {
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email: brandingEmail.trim(),
        phone: brandingPhone.trim(),
        address: brandingAddress.trim(),
        licenseNumber: licenseNumber.trim(),
        tagline: tagline.trim(),
        logoUri: newLogo,
        signatureData: newSig,
      },
    });
    console.log('[Settings] Auto-saved branding after asset change');
  }, [companyName, contactName, brandingEmail, brandingPhone, brandingAddress, licenseNumber, tagline, logoUri, signatureData, updateSettings]);

  const handlePickLogo = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        let newUri: string | undefined;
        if (asset.base64) {
          const mimeType = asset.mimeType ?? 'image/png';
          newUri = `data:${mimeType};base64,${asset.base64}`;
          console.log('[Settings] Logo picked as base64 data URI');
        } else if (asset.uri) {
          newUri = asset.uri;
          console.log('[Settings] Logo picked:', asset.uri);
        }
        if (newUri) {
          setLogoUri(newUri);
          autoSaveBranding({ logo: newUri });
        }
      }
    } catch (e) {
      console.error('[Settings] Logo pick error:', e);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  }, [autoSaveBranding]);

  const handleRemoveLogo = useCallback(() => {
    setLogoUri(undefined);
    autoSaveBranding({ logo: undefined });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [autoSaveBranding]);

  const handleSaveSignature = useCallback((paths: string[]) => {
    setSignatureData(paths);
    setShowSignatureModal(false);
    autoSaveBranding({ sig: paths });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Saved', 'Your signature has been saved.');
  }, [autoSaveBranding]);

  const handleClearSignature = useCallback(() => {
    setSignatureData(undefined);
    autoSaveBranding({ sig: undefined });
  }, [autoSaveBranding]);

  const handleSave = useCallback(() => {
    const tax = parseFloat(taxRate);
    const cont = parseFloat(contingency);
    if (isNaN(tax) || tax < 0 || tax > 30) {
      Alert.alert('Invalid Tax Rate', 'Please enter a rate between 0 and 30%.');
      return;
    }
    if (isNaN(cont) || cont < 0 || cont > 50) {
      Alert.alert('Invalid Contingency', 'Please enter a rate between 0 and 50%.');
      return;
    }
    const themePreset = THEME_PRESETS.find(t => t.id === selectedTheme);
    // Branding (company name, logo, signature, etc.) lives on
    // /company-profile now and is saved there. We deliberately do NOT
    // include `branding` in this call — the local state vars on this
    // screen would otherwise overwrite anything the user just edited
    // in the dedicated screen with stale values.
    updateSettings({
      location: location.trim() || 'United States',
      taxRate: tax,
      contingencyRate: cont,
      themeColors: themePreset ? { primary: themePreset.primary, accent: themePreset.accent } : undefined,
      biometricsEnabled,
      pdfNaming: pdfNaming.enabled ? pdfNaming : undefined,
    });
    if (themePreset) {
      setCustomColors(themePreset.primary, themePreset.accent);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Saved', 'Your settings have been updated. Theme changes will fully apply after restarting the app.');
  }, [location, taxRate, contingency, updateSettings, companyName, contactName, brandingEmail, brandingPhone, brandingAddress, licenseNumber, tagline, logoUri, signatureData, selectedTheme, biometricsEnabled, pdfNaming]);

  const handleClearAll = useCallback(() => {
    Alert.alert('Clear All Data', 'This will permanently delete all projects and estimates. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete Everything', style: 'destructive',
        onPress: async () => {
          for (const project of projects) deleteProject(project.id);
          await AsyncStorage.removeItem('buildwise_projects');
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          Alert.alert('Done', 'All data has been cleared.');
        },
      },
    ]);
  }, [projects, deleteProject]);

  // Apple Guideline 5.1.1(v) requires every app with sign-in to offer
  // an in-app account deletion path. Two-step confirmation:
  // (1) generic "are you sure" alert that warns about subscription
  //     responsibility (we can't cancel an Apple/Play subscription on
  //     the user's behalf — they have to do that through the platform);
  // (2) typed-confirm step ("DELETE") so a misclick doesn't nuke a
  //     real account.
  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete account',
      'This permanently removes your MAGE ID account, every project, and all uploaded files. This cannot be undone.\n\nIf you have an active subscription, cancel it first in Settings → Apple ID → Subscriptions on iOS or Google Play → Subscriptions on Android. Deleting your account does NOT cancel your subscription.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'I understand, continue',
          style: 'destructive',
          onPress: () => {
            // On web `prompt` works; native uses Alert.prompt (iOS only),
            // and Android falls back to a plain confirm Alert. We use
            // Alert.prompt where available and a plain "are you ABSOLUTELY
            // sure?" yes/no on Android since prompt isn't available there.
            if (Platform.OS === 'ios') {
              Alert.prompt(
                'Type DELETE to confirm',
                'Account deletion is permanent. Type the word DELETE in all caps below to confirm.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete forever',
                    style: 'destructive',
                    onPress: async (input?: string) => {
                      if (input !== 'DELETE') {
                        Alert.alert('Confirmation didn\'t match', 'Type DELETE in all caps to confirm.');
                        return;
                      }
                      await runDeleteAccount();
                    },
                  },
                ],
                'plain-text',
              );
            } else {
              Alert.alert(
                'Final confirmation',
                'Are you ABSOLUTELY sure? This deletes everything and cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete forever',
                    style: 'destructive',
                    onPress: () => { void runDeleteAccount(); },
                  },
                ],
              );
            }
          },
        },
      ],
    );
  }, []);

  const runDeleteAccount = useCallback(async () => {
    try {
      await deleteAccount();
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert('Account deleted', 'Your MAGE ID account and all data have been removed.', [
        { text: 'OK', onPress: () => router.replace('/login' as never) },
      ]);
    } catch (err) {
      Alert.alert('Could not delete account', err instanceof Error ? err.message : String(err));
    }
  }, [deleteAccount, router]);

  const handleToggleUnits = useCallback(() => {
    const newUnits = settings.units === 'imperial' ? 'metric' : 'imperial';
    updateSettings({ units: newUnits });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [settings.units, updateSettings]);

  const sigPadWidth = Math.min(SCREEN_WIDTH - 80, 340);

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: themeColors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Profile hero — replaces the old "Settings" title + small ACCOUNT
            row. A bigger, branded entry point that turns the Settings page
            from a system-list into a proper "you" surface. Avatar shows the
            user's initials in a primary-tinted circle (no photo upload yet,
            so initials are the canonical fallback in every premium app). */}
        {isAuthenticated && user ? (
          <TouchableOpacity
            style={styles.profileHero}
            onPress={() => router.push('/company-profile' as any)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Edit company profile"
            testID="profile-hero-tap"
          >
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>
                {(user.name || user.email || '?')
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map(s => s[0]?.toUpperCase() ?? '')
                  .join('') || '?'}
              </Text>
            </View>
            <View style={styles.profileMeta}>
              <Text style={styles.profileName} numberOfLines={1}>
                {user.name || 'Welcome'}
              </Text>
              {settings.branding?.companyName ? (
                <Text style={styles.profileCompany} numberOfLines={1}>
                  {settings.branding.companyName}
                </Text>
              ) : null}
              <Text style={styles.profileEmail} numberOfLines={1}>
                {user.email || ''}
              </Text>
              <View style={styles.profileBadgesRow}>
                <View style={[
                  styles.profileTierPill,
                  // Enterprise gets the same gold-ish accent as Business but
                  // a deeper border so it reads as the top tier. Pre-fix
                  // every non-pro / non-business tier (= enterprise) fell
                  // through to the Free styling, so paying $150/mo
                  // customers saw a "FREE" pill in their Settings.
                  tier === 'enterprise'
                    ? { backgroundColor: themeColors.info + '22', borderColor: themeColors.info }
                    : tier === 'business'
                      ? { backgroundColor: '#FFD700' + '22', borderColor: '#FFD700' }
                      : tier === 'pro'
                        ? { backgroundColor: themeColors.accent + '22', borderColor: themeColors.accent }
                        : { backgroundColor: themeColors.line, borderColor: themeColors.line },
                ]}>
                  <Text style={[
                    styles.profileTierText,
                    tier === 'enterprise' ? { color: themeColors.info } :
                    tier === 'business' ? { color: '#A87800' } :
                    tier === 'pro' ? { color: themeColors.accent } : { color: themeColors.textSecondary },
                  ]}>
                    {tier === 'enterprise' ? 'ENTERPRISE'
                      : tier === 'business' ? 'BUSINESS'
                      : tier === 'pro' ? 'PRO'
                      : 'FREE'}
                  </Text>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
              <TouchableOpacity
                style={styles.profileSignOutBtn}
                onPress={() => {
                  Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Sign Out',
                      style: 'destructive',
                      onPress: async () => {
                        await logout(true);
                        router.replace('/login');
                      },
                    },
                  ]);
                }}
                activeOpacity={0.7}
                testID="logout-button" accessibilityRole="button" accessibilityLabel="Sign out">
                <LogOut size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ) : (
          <Text style={styles.largeTitle}>Settings</Text>
        )}

        {/* Account type — marketplace persona. Lets a user flip between
            the contractor experience and the property-owner experience
            without resigning up. Routes to /persona-select which re-runs
            the same picker as first-time onboarding. */}
        <Text style={styles.sectionHeader}>ACCOUNT TYPE</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/persona-select' as never)}
            activeOpacity={0.7}
            testID="settings-persona-row"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <Repeat size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>
                {userRole ? USER_ROLE_LABELS[userRole] : 'Not set'}
              </Text>
              <Text style={{ fontSize: Type.caption2.fontSize, color: themeColors.textMuted, marginTop: 2 }}>
                {(() => {
                  // For clients on a subscription / trial, surface that
                  // status here — it's the most reachable spot in the app
                  // and reduces "what did I pay for?" support questions.
                  // Contractors keep the original copy.
                  if (userRole === 'client' && clientSub && hasActiveClientSub(clientSub)) {
                    const tierLabel = clientSub.tier === 'client_pro' ? 'Pro' : 'Property Manager';
                    if (isClientTrialActive(clientSub) && clientSub.trialEndsAt) {
                      const days = Math.max(0, Math.ceil((new Date(clientSub.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
                      return `${tierLabel} · ${days} day${days === 1 ? '' : 's'} left in trial`;
                    }
                    return `${tierLabel} subscription · Tap to switch persona`;
                  }
                  return 'Switch between contractor and property-owner views';
                })()}
              </Text>
            </View>
            <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>AI USAGE</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <MageAIMark size={14} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Today: {aiUsed} of {aiLimit} requests</Text>
              <View style={{ height: 6, backgroundColor: themeColors.line, borderRadius: 3, marginTop: 6 }}>
                <View style={{ height: 6, backgroundColor: themeColors.accent, borderRadius: 3, width: `${Math.min((aiUsed / aiLimit) * 100, 100)}%` }} />
              </View>
            </View>
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <MageAIMark size={14} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Advanced: {aiSmartUsed} of {aiSmartLimit}</Text>
              <View style={{ height: 6, backgroundColor: themeColors.line, borderRadius: 3, marginTop: 6 }}>
                <View style={{ height: 6, backgroundColor: themeColors.accent, borderRadius: 3, width: `${Math.min((aiSmartUsed / aiSmartLimit) * 100, 100)}%` }} />
              </View>
            </View>
          </View>
          <View style={styles.rowSeparator} />
          {/* Monthly takeoff page quota — distinct from the daily AI
              request counters above. Takeoffs are page-metered (a
              200-page hospital set burns 200 pages of quota); show the
              user where they stand each month so an upload-time
              surprise doesn't happen. */}
          <View style={styles.row}>
            {/* Takeoff quota uses Colors.purple so a custom-theme override
                can re-tint it via the existing color system. Pre-fix
                this and the bar fill were hardcoded #7C3AED, drifting
                silently when the user picked a theme. */}
            <View style={[styles.iconWrap, { backgroundColor: Colors.purple }]}>
              <FileText size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>
                Takeoff: {takeoffQuota.used} of {takeoffQuota.cap} pages this month
              </Text>
              <View style={{ height: 6, backgroundColor: themeColors.line, borderRadius: 3, marginTop: 6 }}>
                <View style={{
                  height: 6,
                  backgroundColor: takeoffQuota.cap > 0 && takeoffQuota.used / takeoffQuota.cap > 0.8 ? themeColors.accentLabel : Colors.purple,
                  borderRadius: 3,
                  width: `${takeoffQuota.cap > 0 ? Math.min((takeoffQuota.used / takeoffQuota.cap) * 100, 100) : 0}%`,
                }} />
              </View>
            </View>
          </View>
          <View style={styles.rowSeparator} />
          <View style={[styles.row, { paddingVertical: 10 }]}>
            <Text style={{ fontSize: Type.caption1.fontSize, color: themeColors.textMuted, flex: 1 }}>
              Daily AI resets at midnight · Takeoff resets the 1st · Plan: {tier === 'enterprise' ? 'Enterprise'
                : tier === 'business' ? 'Business'
                : tier === 'pro' ? 'Pro'
                : 'Free'}
            </Text>
            {tier === 'free' && (
              <TouchableOpacity onPress={() => router.push('/paywall' as any)} activeOpacity={0.7}>
                <Text style={{ fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.accent }}>Upgrade</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.sectionHeader}>LOCATION & UNITS</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.danger }]}>
              <MapPin size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Location</Text>
            <TextInput
              style={styles.inlineInput}
              value={location}
              onChangeText={setLocation}
              placeholder="City, State"
              placeholderTextColor={themeColors.textMuted}
              textAlign="right"
              testID="settings-location"
            />
          </View>
          <View style={styles.rowSeparator} />
          <TouchableOpacity style={styles.row} onPress={handleToggleUnits} activeOpacity={0.6}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.info }]}>
              <Ruler size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Units</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowValue}>
                {settings.units === 'imperial' ? 'Imperial' : 'Metric'}
              </Text>
              <Switch
                value={settings.units === 'metric'}
                onValueChange={handleToggleUnits}
                trackColor={{ false: themeColors.line, true: themeColors.accent }}
                thumbColor={themeColors.surface}
                ios_backgroundColor={themeColors.line}
              />
            </View>
          </TouchableOpacity>
          <View style={styles.rowSeparator} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/(tabs)/settings/appearance' as never)}
            activeOpacity={0.6}
            testID="settings-appearance"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <Palette size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Appearance</Text>
            <View style={styles.rowRight}>
              <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>ESTIMATE DEFAULTS</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <Percent size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Sales Tax Rate</Text>
            <View style={styles.rowRight}>
              <TextInput
                style={styles.numericInput}
                value={taxRate}
                onChangeText={setTaxRate}
                keyboardType="decimal-pad"
                placeholder="7.5"
                placeholderTextColor={themeColors.textMuted}
                textAlign="right"
                testID="settings-tax"
              />
              <Text style={styles.suffix}>%</Text>
            </View>
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.success }]}>
              <ShieldCheck size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Contingency Rate</Text>
            <View style={styles.rowRight}>
              <TextInput
                style={styles.numericInput}
                value={contingency}
                onChangeText={setContingency}
                keyboardType="decimal-pad"
                placeholder="10"
                placeholderTextColor={themeColors.textMuted}
                textAlign="right"
                testID="settings-contingency"
              />
              <Text style={styles.suffix}>%</Text>
            </View>
          </View>
        </View>

        {/* COMPANY BRANDING / LOGO / SIGNATURE moved to /company-profile.
            Settings now points at it via the tappable profile hero at
            the top of this screen. Shorter Settings + a focused place
            to manage everything that lands on the GC's PDFs. */}

        <Text style={styles.sectionHeader}>PDF NAMING</Text>
        <Text style={styles.sectionSubtext}>
          Automatically name all PDFs with a custom format and sequential numbering.
        </Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              setPdfNaming(prev => ({ ...prev, enabled: !prev.enabled }));
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
            }}
            activeOpacity={0.6}
            testID="pdf-naming-toggle"
          >
            <View style={[styles.iconWrap, { backgroundColor: '#5856D6' }]}>
              <Hash size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Auto-Name PDFs</Text>
            <Switch
              value={pdfNaming.enabled}
              onValueChange={(val) => {
                setPdfNaming(prev => ({ ...prev, enabled: val }));
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              trackColor={{ false: themeColors.line, true: themeColors.accent }}
              thumbColor={themeColors.surface}
              ios_backgroundColor={themeColors.line}
            />
          </TouchableOpacity>
          {pdfNaming.enabled && (
            <>
              <View style={styles.rowSeparator} />
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
                  <TypeIcon size={14} color="#fff" strokeWidth={1.75} />
                </View>
                <Text style={styles.rowLabel}>Prefix</Text>
                <TextInput
                  style={styles.inlineInput}
                  value={pdfNaming.prefix}
                  onChangeText={(val) => setPdfNaming(prev => ({ ...prev, prefix: val }))}
                  placeholder="e.g. MAGE"
                  placeholderTextColor={themeColors.textMuted}
                  textAlign="right"
                  testID="pdf-naming-prefix"
                />
              </View>
              <View style={styles.rowSeparator} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setPdfNaming(prev => ({ ...prev, includeProjectName: !prev.includeProjectName }));
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
                activeOpacity={0.6}
              >
                <View style={[styles.iconWrap, { backgroundColor: themeColors.success }]}>
                  <Building2 size={14} color="#fff" strokeWidth={1.75} />
                </View>
                <Text style={styles.rowLabel}>Include Project Name</Text>
                <Switch
                  value={pdfNaming.includeProjectName}
                  onValueChange={(val) => {
                    setPdfNaming(prev => ({ ...prev, includeProjectName: val }));
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  trackColor={{ false: themeColors.line, true: themeColors.accent }}
                  thumbColor={themeColors.surface}
                  ios_backgroundColor={themeColors.line}
                />
              </TouchableOpacity>
              <View style={styles.rowSeparator} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setPdfNaming(prev => ({ ...prev, includeDocType: !prev.includeDocType }));
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
                activeOpacity={0.6}
              >
                <View style={[styles.iconWrap, { backgroundColor: themeColors.info }]}>
                  <FileText size={14} color="#fff" strokeWidth={1.75} />
                </View>
                <Text style={styles.rowLabel}>Include Document Type</Text>
                <Switch
                  value={pdfNaming.includeDocType}
                  onValueChange={(val) => {
                    setPdfNaming(prev => ({ ...prev, includeDocType: val }));
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  trackColor={{ false: themeColors.line, true: themeColors.accent }}
                  thumbColor={themeColors.surface}
                  ios_backgroundColor={themeColors.line}
                />
              </TouchableOpacity>
              <View style={styles.rowSeparator} />
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setPdfNaming(prev => ({ ...prev, includeDate: !prev.includeDate }));
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
                activeOpacity={0.6}
              >
                <View style={[styles.iconWrap, { backgroundColor: themeColors.danger }]}>
                  <Info size={14} color="#fff" strokeWidth={1.75} />
                </View>
                <Text style={styles.rowLabel}>Include Date</Text>
                <Switch
                  value={pdfNaming.includeDate}
                  onValueChange={(val) => {
                    setPdfNaming(prev => ({ ...prev, includeDate: val }));
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  trackColor={{ false: themeColors.line, true: themeColors.accent }}
                  thumbColor={themeColors.surface}
                  ios_backgroundColor={themeColors.line}
                />
              </TouchableOpacity>
              <View style={styles.rowSeparator} />
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: '#AF52DE' }]}>
                  <Ruler size={14} color="#fff" strokeWidth={1.75} />
                </View>
                <Text style={styles.rowLabel}>Separator</Text>
                <View style={styles.pdfSepPicker}>
                  {(['-', '_', ' '] as const).map((sep) => (
                    <TouchableOpacity
                      key={sep}
                      style={[
                        styles.pdfSepChip,
                        pdfNaming.separator === sep && styles.pdfSepChipActive,
                      ]}
                      onPress={() => {
                        setPdfNaming(prev => ({ ...prev, separator: sep }));
                        if (Platform.OS !== 'web') void Haptics.selectionAsync();
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.pdfSepChipText,
                        pdfNaming.separator === sep && styles.pdfSepChipTextActive,
                      ]}>{sep === ' ' ? 'Space' : sep}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.rowSeparator} />
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
                  <Hash size={14} color="#fff" strokeWidth={1.75} />
                </View>
                <Text style={styles.rowLabel}>Next Number</Text>
                <TextInput
                  style={styles.numericInput}
                  value={pdfNaming.nextNumber.toString()}
                  onChangeText={(val) => {
                    const num = parseInt(val, 10);
                    if (!isNaN(num) && num >= 0) {
                      setPdfNaming(prev => ({ ...prev, nextNumber: num }));
                    } else if (val === '') {
                      setPdfNaming(prev => ({ ...prev, nextNumber: 0 }));
                    }
                  }}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor={themeColors.textMuted}
                  textAlign="right"
                  testID="pdf-naming-next-number"
                />
              </View>
            </>
          )}
        </View>
        {pdfNaming.enabled && pdfNamingPreview ? (
          <View style={styles.pdfPreviewNote}>
            <FileText size={14} color={themeColors.accent} strokeWidth={1.75} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.pdfPreviewNoteText, { color: themeColors.textSecondary, fontWeight: '600' as const, marginBottom: 2 }]}>Preview</Text>
              <Text style={[styles.pdfPreviewNoteText, { color: themeColors.text }]} numberOfLines={1}>{pdfNamingPreview}</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.sectionHeader}>APP THEME</Text>
        <Text style={styles.sectionSubtext}>
          Customize the app's accent colors to match your brand.
        </Text>
        <View style={styles.group}>
          <View style={{ padding: 16 }}>
            <View style={styles.themeGrid}>
              {THEME_PRESETS.map(theme => (
                <TouchableOpacity
                  key={theme.id}
                  style={[
                    styles.themeChip,
                    selectedTheme === theme.id && styles.themeChipActive,
                  ]}
                  onPress={() => {
                    setSelectedTheme(theme.id);
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.themeSwatches}>
                    <View style={[styles.themeSwatch, { backgroundColor: theme.primary }]} />
                    <View style={[styles.themeSwatch, { backgroundColor: theme.accent }]} />
                  </View>
                  <Text style={[
                    styles.themeChipLabel,
                    selectedTheme === theme.id && { color: theme.primary, fontWeight: '700' as const },
                  ]}>{theme.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {Platform.OS !== 'web' && (
          <>
            <Text style={styles.sectionHeader}>SECURITY</Text>
            <View style={styles.group}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setBiometricsEnabled(!biometricsEnabled);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
                activeOpacity={0.6}
              >
                <View style={[styles.iconWrap, { backgroundColor: themeColors.info }]}>
                  <ScanFace size={14} color="#fff" strokeWidth={1.75} />
                </View>
                <Text style={styles.rowLabel}>Face ID / Touch ID</Text>
                <Switch
                  value={biometricsEnabled}
                  onValueChange={(val) => {
                    setBiometricsEnabled(val);
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  trackColor={{ false: themeColors.line, true: themeColors.accent }}
                  thumbColor={themeColors.surface}
                  ios_backgroundColor={themeColors.line}
                />
              </TouchableOpacity>
            </View>
          </>
        )}

        <Text style={styles.sectionHeader}>NOTIFICATIONS</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/notifications-settings' as any)}
            activeOpacity={0.6}
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <Bell size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Push & email preferences</Text>
              <Text style={styles.rowSubtext}>
                Pick which portal events ping your phone vs. email
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.8} testID="save-settings">
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>

        <Text style={styles.sectionHeader}>PAYMENTS</Text>
        <Text style={styles.sectionSubtext}>
          Connect your bank to accept invoice payments in-app. Money goes to you, not us — we take a 1% platform fee per transaction.
        </Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/payments-setup' as any)}
            activeOpacity={0.7}
            testID="payments-setup-link"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.success }]}>
              <Wallet size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Set up payments</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
          {/* Payments dashboard — was an orphan route until May 2026 audit
              wiring. Shows received-vs-pending across all invoices, paid
              status, payout schedule. Independent of the per-invoice
              payment buttons. */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/payments' as any)}
            activeOpacity={0.7}
            testID="payments-dashboard-link"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.success }]}>
              <Wallet size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Payments dashboard</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>INTEGRATIONS</Text>
        <Text style={styles.sectionSubtext}>
          Connect third-party services. QuickBooks Online syncs your invoices, payments, and customers in real time.
        </Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/qbo-setup' as any)}
            activeOpacity={0.7}
            testID="qbo-setup-link"
          >
            <View style={[
              styles.iconWrap,
              { backgroundColor: qboConnected ? '#2CA01C' : qboReauth ? themeColors.danger : themeColors.accent },
            ]}>
              {qboConnected ? <Check size={14} color="#fff" strokeWidth={1.75} /> : <ExternalLink size={14} color="#fff" strokeWidth={1.75} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>
                {qboConnected ? 'QuickBooks Online' : qboReauth ? 'Reconnect QuickBooks' : 'Connect QuickBooks'}
              </Text>
              {qboConnected ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#2CA01C' }} />
                  <Text style={{ fontSize: Type.caption1.fontSize, color: themeColors.textMuted }}>
                    Connected{qboStatus?.companyName ? ` · ${qboStatus.companyName}` : ''}
                  </Text>
                </View>
              ) : qboReauth ? (
                <Text style={{ fontSize: Type.caption1.fontSize, color: themeColors.danger, marginTop: 2 }}>
                  Reconnect required
                </Text>
              ) : null}
            </View>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        {/* Public profile — was an orphan route until May 2026 audit
            wiring. Lets the GC publish a public-facing profile snapshot
            (used for leads / sub directory listings). */}
        <Text style={styles.sectionHeader}>PUBLIC PROFILE</Text>
        <Text style={styles.sectionSubtext}>
          Build your public-facing snapshot. Used in the sub directory + bid award notifications.
        </Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/public-profile-setup' as any)}
            activeOpacity={0.7}
            testID="public-profile-setup-link"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <UserCircle size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Edit public profile</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/get-verified' as any)}
            activeOpacity={0.7}
            testID="get-verified-link"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.success }]}>
              <ShieldCheck size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Get verified</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>CONTACTS & EMAIL</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/contacts')}
            activeOpacity={0.7}
            testID="contacts-link"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.info }]}>
              <User size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Contacts</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>YOUR DATA</Text>
        <Text style={styles.sectionSubtext}>
          Your data is yours. Export every project, invoice, RFI, and photo to JSON or CSV — no lock-in, ever.
        </Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/data-export' as any)}
            activeOpacity={0.7}
            testID="data-export-link"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <FolderDown size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Export my data</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/connect-claude' as any)}
            activeOpacity={0.7}
            testID="connect-claude-link"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.text }]}>
              <MageAIMark size={14} color="#fff" />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Connect Claude (AI assistant)</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/data-import' as any)}
            activeOpacity={0.7}
            testID="data-import-link"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.success }]}>
              <FolderInput size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Import data</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        {isOwner(user?.email) && (
          <>
            <Text style={styles.sectionHeader}>DEVELOPER (OWNER ONLY)</Text>
            <Text style={styles.sectionSubtext}>
              Visible to platform owner only. Demo data seeder for App Store screenshots.
            </Text>
            <View style={styles.group}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push('/dev-seeder' as any)}
                activeOpacity={0.7}
                testID="dev-seeder-link"
              >
                <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
                  <Database size={14} color="#fff" strokeWidth={1.75} />
                </View>
                <Text style={[styles.rowLabel, { flex: 1 }]}>Demo data seeder</Text>
                <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
          </>
        )}

        <Text style={styles.sectionHeader}>SUPPLIER MARKETPLACE</Text>
        <Text style={styles.sectionSubtext}>
          Register as a supplier to list your materials on the MAGE ID Marketplace and sell directly to contractors.
        </Text>
        <View style={styles.group}>
          {supplierProfile ? (
            <View style={styles.supplierRegistered}>
              <View style={styles.supplierRegisteredHeader}>
                <View style={[styles.iconWrap, { backgroundColor: themeColors.success }]}>
                  <Store size={14} color="#fff" strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowLabel}>{supplierProfile.companyName}</Text>
                  <Text style={styles.supplierRegisteredSub}>Registered Supplier</Text>
                </View>
              </View>
              <View style={styles.supplierRegisteredMeta}>
                <View style={styles.supplierMetaChip}>
                  <Package size={10} color={themeColors.info} strokeWidth={1.75} />
                  <Text style={styles.supplierMetaText}>{supplierProfile.categories.length} categories</Text>
                </View>
                <View style={styles.supplierMetaChip}>
                  <Truck size={10} color={themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.supplierMetaText}>{supplierProfile.deliveryOptions.length} delivery options</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.supplierEditBtn}
                onPress={() => setShowSupplierForm(true)}
                activeOpacity={0.7}
              >
                <PenTool size={14} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.supplierEditBtnText}>Edit Profile</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.supplierRegisterRow}
              onPress={() => setShowSupplierForm(true)}
              activeOpacity={0.7}
              testID="register-supplier"
            >
              <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
                <Store size={14} color="#fff" strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Register as Supplier</Text>
                <Text style={{ fontSize: Type.caption1.fontSize, color: themeColors.textSecondary }}>List your materials for sale</Text>
              </View>
              <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.sectionHeader}>SUBSCRIPTION PLAN</Text>
        <Text style={styles.sectionSubtext}>
          {tier === 'free'
            ? 'Go Pro for AI takeoffs, pay apps, and unlimited projects.'
            : tier === 'pro'
            ? 'Upgrade to Business for subcontractor management and higher AI caps.'
            : tier === 'business'
            ? 'Upgrade to Enterprise for the highest AI caps and priority support.'
            : "You're on Enterprise — our top plan. Thanks for building with MAGE."}
        </Text>
        <View style={styles.group}>
          <View style={{ padding: 16, gap: 12 }}>
            {[
              {
                id: 'free' as const,
                label: 'Free',
                price: '$0/mo',
                color: themeColors.textMuted,
                icon: Star,
                features: ['1 active project', 'Basic estimate wizard', 'Materials browser (view only)'],
                disabled: ['No PDF export', 'No schedule maker', 'No cloud sync'],
              },
              {
                id: 'pro' as const,
                label: 'Pro',
                price: '$29/mo',
                color: themeColors.accent,
                icon: MageAIMark,
                features: ['Unlimited projects', 'Full estimate + markup', 'Schedule maker (all views)', 'Branded PDF export', 'Change orders & invoicing', 'Daily field reports', 'Material price alerts', 'Cloud sync'],
                disabled: [],
              },
              {
                id: 'business' as const,
                label: 'Business',
                price: '$79/mo',
                color: themeColors.info,
                icon: Crown,
                features: ['Everything in Pro', 'Subcontractor management', 'Punch list & closeout', 'Client portal (shareable link)', 'Unlimited collaborators', 'Custom branding + logos', 'Priority support'],
                disabled: [],
              },
              {
                id: 'enterprise' as const,
                label: 'Enterprise',
                price: '$150/mo',
                color: themeColors.info,
                icon: Crown,
                features: ['Everything in Business', 'Highest AI usage caps', '100 drawing analyses/mo', '200 photo analyses/mo', '4500 text-AI calls/mo', 'Priority queue on heavy AI', 'Concierge onboarding'],
                disabled: [],
              },
            ].map(plan => {
              // Read the live tier from useSubscription (RevenueCat-backed),
              // NOT settings.subscription?.tier — that local profile field is
              // never updated after a purchase, so the "Current" badge used
              // to be stuck on Free even after the user paid.
              const isActive = tier === plan.id;
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.planCard, isActive && { borderColor: plan.color, borderWidth: 2 }]}
                  onPress={() => {
                    if (isActive) return;
                    if (plan.id === 'free') {
                      Alert.alert(
                        'Contact Support',
                        'To downgrade to Free, manage your subscription in the App Store (Settings → Apple ID → Subscriptions) or contact support@mageid.app.',
                      );
                      return;
                    }
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    setPaywallTier(plan.id as 'pro' | 'business' | 'enterprise');
                  }}
                  activeOpacity={isActive ? 1 : 0.7}
                >
                  <View style={styles.planHeader}>
                    <View style={[styles.planIconWrap, { backgroundColor: plan.color + '15' }]}>
                      <plan.icon size={16} color={plan.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.planName}>{plan.label}</Text>
                      <Text style={[styles.planPrice, { color: plan.color }]}>{plan.price}</Text>
                    </View>
                    {isActive && (
                      <View style={[styles.planActiveBadge, { backgroundColor: plan.color }]}>
                        <Text style={styles.planActiveBadgeText}>Current</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.planFeatures}>
                    {plan.features.map((f, i) => (
                      <View key={i} style={styles.planFeatureRow}>
                        <Check size={12} color={plan.color} strokeWidth={1.75} />
                        <Text style={styles.planFeatureText}>{f}</Text>
                      </View>
                    ))}
                    {plan.disabled.map((f, i) => (
                      <View key={`d-${i}`} style={styles.planFeatureRow}>
                        <X size={12} color={themeColors.textMuted} strokeWidth={1.75} />
                        <Text style={[styles.planFeatureText, { color: themeColors.textMuted }]}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Manage Subscription deep-link — opens the native iOS/Android
            subscription management UI directly. The voice-of-customer
            audit (2026-05-14) flagged the "couldn't cancel" trap as the
            single most exploitable competitor weakness (Houzz Pro,
            Contractor Foreman). One-tap cancellation is how we advertise
            the safety, not just describe it in an FAQ. */}
        {tier !== 'free' && (
          <View style={styles.group}>
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                // Apple's documented universal link to the user's subscription
                // management screen. itms-apps:// opens straight into Settings →
                // Apple ID → Subscriptions on iOS; Play handles the equivalent
                // via the play.google.com URL.
                const url = Platform.OS === 'ios'
                  ? 'itms-apps://apps.apple.com/account/subscriptions'
                  : Platform.OS === 'android'
                    ? 'https://play.google.com/store/account/subscriptions'
                    : 'https://apps.apple.com/account/subscriptions';
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
                Linking.openURL(url).catch(() => {
                  Alert.alert(
                    'Manage Subscription',
                    Platform.OS === 'ios'
                      ? 'Open Settings → Apple ID → Subscriptions to manage your MAGE ID plan.'
                      : 'Open Play Store → Subscriptions to manage your MAGE ID plan.',
                  );
                });
              }}
              activeOpacity={0.6}
              testID="manage-subscription-link"
              accessibilityRole="button"
              accessibilityLabel="Manage subscription in app store"
            >
              <View style={[styles.iconWrap, { backgroundColor: themeColors.info }]}>
                <Wallet size={14} color="#fff" strokeWidth={1.75} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Manage Subscription</Text>
                <Text style={[styles.rowLabel, { fontSize: 11, color: themeColors.textMuted, fontWeight: '400' as const, marginTop: 2 }]}>
                  Cancel anytime in the {Platform.OS === 'android' ? 'Play Store' : 'App Store'} — no support call needed
                </Text>
              </View>
              <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.sectionHeader}>HELP & SUPPORT</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => setShowTutorial(true)}
            activeOpacity={0.6}
            testID="show-tutorial"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <BookOpen size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Show Tutorial</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={styles.rowSeparator} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              // Pre-fill body with platform context so the support team
              // doesn't have to ping back asking which device / version.
              const bodyLines = [
                '',
                '',
                '---',
                `Sent from MAGE ID · ${Platform.OS}${Platform.OS === 'ios' || Platform.OS === 'android' ? ' ' + Platform.Version : ''}`,
              ];
              const body = encodeURIComponent(bodyLines.join('\n'));
              const url = `mailto:support@mageid.app?subject=MAGE%20ID%20Support&body=${body}`;
              Linking.openURL(url).catch(() =>
                Alert.alert('Could not open mail', 'Email us at support@mageid.app')
              );
            }}
            activeOpacity={0.6}
            testID="contact-support"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <MessageCircle size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Contact Support</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>FAQ</Text>
        <View style={styles.group}>
          {FAQ_ITEMS.map((item, i) => {
            const isLast = i === FAQ_ITEMS.length - 1;
            const isOpen = expandedFaq === i;
            return (
              <View key={i}>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => setExpandedFaq(isOpen ? null : i)}
                  activeOpacity={0.6}
                  testID={`faq-${i}`}
                >
                  <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
                    <HelpCircle size={14} color="#fff" strokeWidth={1.75} />
                  </View>
                  <Text style={[styles.rowLabel, { flex: 1 }]} numberOfLines={isOpen ? undefined : 2}>
                    {item.q}
                  </Text>
                  <ChevronRight
                    size={16}
                    color={themeColors.textMuted}
                    style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }} strokeWidth={1.75}
                  />
                </TouchableOpacity>
                {isOpen ? (
                  <View style={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 0 }}>
                    <Text style={{ fontSize: Type.footnote.fontSize, color: themeColors.textMuted, lineHeight: 19 }}>
                      {item.a}
                    </Text>
                  </View>
                ) : null}
                {!isLast ? <View style={styles.rowSeparator} /> : null}
              </View>
            );
          })}
        </View>

        <Text style={styles.sectionHeader}>ABOUT</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <Info size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <View style={styles.aboutBlock}>
              <Text style={styles.rowLabel}>MAGE ID</Text>
              <Text style={styles.aboutDesc}>Construction estimator with real-time pricing & bulk discounts.</Text>
            </View>
          </View>
          <View style={styles.rowSeparator} />
          <View style={[styles.row, { opacity: 0.7 }]}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.textMuted }]}>
              <ChevronRight size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowValue}>1.0.0</Text>
          </View>
        </View>

        {/* Legal — required for App Store 5.1.1 compliance (privacy
            disclosure accessible from "within the app"). Was previously
            only in the paywall, which doesn't reliably count. */}
        <Text style={styles.sectionHeader}>LEGAL</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              Linking.openURL('https://mageid.app/privacy').catch(() => {
                Alert.alert('Could not open', 'Visit mageid.app/privacy in your browser.');
              });
            }}
            activeOpacity={0.6}
            testID="settings-privacy"
            accessibilityRole="link"
            accessibilityLabel="Privacy Policy"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.textSecondary }]}>
              <ShieldCheck size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Privacy Policy</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={styles.rowSeparator} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              Linking.openURL('https://mageid.app/terms').catch(() => {
                Alert.alert('Could not open', 'Visit mageid.app/terms in your browser.');
              });
            }}
            activeOpacity={0.6}
            testID="settings-terms"
            accessibilityRole="link"
            accessibilityLabel="Terms of Service"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.textSecondary }]}>
              <FileText size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Terms of Service</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
          <View style={styles.rowSeparator} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              Linking.openURL('https://mageid.app/do-not-sell').catch(() => {
                Alert.alert('Could not open', 'Visit mageid.app/do-not-sell in your browser.');
              });
            }}
            activeOpacity={0.6}
            testID="settings-do-not-sell"
            accessibilityRole="link"
            accessibilityLabel="Do Not Sell or Share My Personal Information"
          >
            <View style={[styles.iconWrap, { backgroundColor: themeColors.textSecondary }]}>
              <ShieldCheck size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Do Not Sell My Info (CA)</Text>
            <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.sectionHeader, { color: themeColors.danger }]}>DANGER ZONE</Text>
        <View style={styles.group}>
          <TouchableOpacity style={styles.row} onPress={handleClearAll} activeOpacity={0.6} testID="clear-all">
            <View style={[styles.iconWrap, { backgroundColor: themeColors.danger }]}>
              <Trash2 size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={[styles.rowLabel, { color: themeColors.danger }]}>Clear All Projects & Data</Text>
          </TouchableOpacity>
          <View style={styles.rowSeparator} />
          <TouchableOpacity style={styles.row} onPress={handleDeleteAccount} activeOpacity={0.6} testID="delete-account">
            <View style={[styles.iconWrap, { backgroundColor: themeColors.danger }]}>
              <UserCircle size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowLabel, { color: themeColors.danger }]}>Delete Account</Text>
              <Text style={[styles.aboutDesc, { color: themeColors.textMuted }]}>
                Permanently remove your account, projects, and all data. This can&apos;t be undone.
              </Text>
            </View>
          </TouchableOpacity>
        </View>
        <Text style={styles.dangerNote}>
          Permanently deletes all projects and cannot be undone.
        </Text>
      </ScrollView>

      <Tutorial visible={showTutorial} onClose={() => setShowTutorial(false)} />
      <Paywall
        visible={paywallTier !== null}
        feature={paywallTier === 'enterprise' ? 'Enterprise Plan'
          : paywallTier === 'business' ? 'Business Plan'
          : 'Pro Plan'}
        requiredTier={paywallTier ?? 'pro'}
        onClose={() => setPaywallTier(null)}
      />

      {/* Signature draw modal moved to /company-profile along with the
          rest of the branding/logo/signature sections. */}
      {/*
        Supplier Profile modal — responsive across iPhone + Web.

        Previously this shared the global `sigModalCard` + reused `sectionSubtext`
        / `saveButton` styles which had hard-coded horizontal padding/margins from
        the outer list view. Inside a dialog card those offsets misaligned labels
        with inputs and pushed the Save button outside the card on iPhone. The
        modal also anchored to the bottom of the screen with `justifyContent:
        'flex-end'`, which felt glitchy on small phones (keyboard + short
        viewport) and out of place on web.

        Now:
        - iOS: native `pageSheet` presentation, no transparent overlay.
        - Web / Android: centered card with a dim backdrop, capped at 560px.
        - Dedicated `supProfile*` styles so labels/inputs/button all align to
          the same inner padding and the card grows predictably.
        - Sticky Save button pinned to the bottom so users never have to scroll
          to find the primary CTA.
      */}
      <Modal
        visible={showSupplierForm}
        transparent={Platform.OS !== 'ios'}
        animationType={Platform.OS === 'ios' ? 'slide' : 'fade'}
        presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
        onRequestClose={() => setShowSupplierForm(false)}
      >
        <View style={styles.supProfileBackdrop}>
          <KeyboardAvoidingView
            style={styles.supProfileCenter}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.supProfileCard}>
              <View style={styles.supProfileHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.supProfileTitle}>Supplier Profile</Text>
                  <Text style={styles.supProfileDesc}>
                    Fill in your business details to appear on the MAGE ID Marketplace.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setShowSupplierForm(false)}
                  style={styles.supProfileClose}
                  activeOpacity={0.7}
                  testID="sup-close"
                >
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.supProfileScroll}
                contentContainerStyle={styles.supProfileScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.supFieldGroup}>
                  <Text style={styles.supFieldLabel}>Company Name *</Text>
                  <TextInput
                    style={styles.supFieldInput}
                    value={supCompanyName}
                    onChangeText={setSupCompanyName}
                    placeholder="Your Supply Company"
                    placeholderTextColor={themeColors.textMuted}
                    testID="sup-company"
                  />
                </View>

                <View style={styles.supFieldGroup}>
                  <Text style={styles.supFieldLabel}>Contact Name</Text>
                  <TextInput
                    style={styles.supFieldInput}
                    value={supContactName}
                    onChangeText={setSupContactName}
                    placeholder="John Smith"
                    placeholderTextColor={themeColors.textMuted}
                  />
                </View>

                <View style={styles.supRow}>
                  <View style={[styles.supFieldGroup, styles.supRowItem]}>
                    <Text style={styles.supFieldLabel}>Email *</Text>
                    <TextInput
                      style={styles.supFieldInput}
                      value={supEmail}
                      onChangeText={setSupEmail}
                      placeholder="sales@company.com"
                      placeholderTextColor={themeColors.textMuted}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>
                  <View style={[styles.supFieldGroup, styles.supRowItem]}>
                    <Text style={styles.supFieldLabel}>Phone</Text>
                    <TextInput
                      style={styles.supFieldInput}
                      value={supPhone}
                      onChangeText={setSupPhone}
                      placeholder="(555) 123-4567"
                      placeholderTextColor={themeColors.textMuted}
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>

                <View style={styles.supFieldGroup}>
                  <Text style={styles.supFieldLabel}>Address</Text>
                  <TextInput
                    style={styles.supFieldInput}
                    value={supAddress}
                    onChangeText={setSupAddress}
                    placeholder="123 Industrial Blvd, City, State"
                    placeholderTextColor={themeColors.textMuted}
                  />
                </View>

                <View style={styles.supFieldGroup}>
                  <Text style={styles.supFieldLabel}>Website</Text>
                  <TextInput
                    style={styles.supFieldInput}
                    value={supWebsite}
                    onChangeText={setSupWebsite}
                    placeholder="yourcompany.com"
                    placeholderTextColor={themeColors.textMuted}
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.supFieldGroup}>
                  <Text style={styles.supFieldLabel}>Description</Text>
                  <TextInput
                    style={[styles.supFieldInput, styles.supFieldInputMulti]}
                    value={supDescription}
                    onChangeText={setSupDescription}
                    placeholder="Brief description of your business..."
                    placeholderTextColor={themeColors.textMuted}
                    multiline
                  />
                </View>

                <View style={styles.supRow}>
                  <View style={[styles.supFieldGroup, styles.supRowItem]}>
                    <Text style={styles.supFieldLabel}>Min Order ($)</Text>
                    <TextInput
                      style={styles.supFieldInput}
                      value={supMinOrder}
                      onChangeText={setSupMinOrder}
                      placeholder="250"
                      placeholderTextColor={themeColors.textMuted}
                      keyboardType="numeric"
                    />
                  </View>
                  <View style={[styles.supFieldGroup, styles.supRowItem]}>
                    <Text style={styles.supFieldLabel}>Delivery Options</Text>
                    <TextInput
                      style={styles.supFieldInput}
                      value={supDelivery}
                      onChangeText={setSupDelivery}
                      placeholder="Local, Freight"
                      placeholderTextColor={themeColors.textMuted}
                    />
                  </View>
                </View>

                <View style={styles.supFieldGroup}>
                  <Text style={styles.supFieldLabel}>Categories</Text>
                  <View style={styles.supCatGrid}>
                    {['lumber', 'concrete', 'roofing', 'electrical', 'plumbing', 'insulation', 'flooring', 'steel', 'paint', 'landscape', 'hvac', 'hardware'].map(cat => {
                      const active = supCategories.includes(cat);
                      return (
                        <TouchableOpacity
                          key={cat}
                          style={[styles.supCatChip, active && styles.supCatChipActive]}
                          onPress={() => {
                            setSupCategories(prev =>
                              prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
                            );
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.supCatText, active && styles.supCatTextActive]}>
                            {cat.charAt(0).toUpperCase() + cat.slice(1)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </ScrollView>

              <View style={[styles.supProfileFooter, { paddingBottom: Math.max(insets.bottom + 12, 16) }]}>
                <TouchableOpacity
                  style={styles.supProfileSaveBtn}
                  onPress={() => {
                    const name = supCompanyName.trim();
                    const email = supEmail.trim();
                    if (!name) {
                      Alert.alert('Missing Name', 'Please enter your company name.');
                      return;
                    }
                    if (!email || !email.includes('@')) {
                      Alert.alert('Missing Email', 'Please enter a valid email address.');
                      return;
                    }
                    const profile = {
                      id: supplierProfile?.id ?? `sup-user-${Date.now()}`,
                      companyName: name,
                      contactName: supContactName.trim(),
                      email,
                      phone: supPhone.trim(),
                      address: supAddress.trim(),
                      website: supWebsite.trim(),
                      description: supDescription.trim(),
                      categories: supCategories,
                      rating: supplierProfile?.rating ?? 5.0,
                      deliveryOptions: supDelivery.split(',').map(s => s.trim()).filter(Boolean),
                      minOrderAmount: parseFloat(supMinOrder) || 0,
                      registeredAt: supplierProfile?.registeredAt ?? new Date().toISOString(),
                    };
                    updateSettings({ supplierProfile: profile });
                    setShowSupplierForm(false);
                    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    Alert.alert('Saved', 'Your supplier profile has been saved. Your materials will appear on the Marketplace.');
                    console.log('[Settings] Supplier profile saved:', profile.companyName);
                  }}
                  activeOpacity={0.85}
                  testID="save-supplier"
                >
                  <Text style={styles.supProfileSaveBtnText}>{supplierProfile ? 'Update Profile' : 'Register as Supplier'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: themeColors.bg,
  },
  largeTitle: {
    fontSize: Type.largeTitle.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 4,
    marginBottom: 28,
  },
  // Profile hero card — sits at the top of Settings, replacing the small
  // ACCOUNT row + plain "Settings" title. Premium feel: big avatar, bold
  // name, company line, tier pill, subtle sign-out icon button.
  profileHero: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 14,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 24,
    padding: 18,
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.xl,
    borderWidth: 1,
    borderColor: themeColors.line,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: themeColors.accent,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  profileAvatarText: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: themeColors.surface,
    letterSpacing: -0.5,
  },
  profileMeta: { flex: 1, gap: 2 },
  profileName: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
    letterSpacing: -0.3,
  },
  profileCompany: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  profileEmail: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
  },
  profileBadgesRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 6,
  },
  profileTierPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
  },
  profileTierText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.6,
  },
  profileSignOutBtn: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.xl,
    backgroundColor: themeColors.line,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  // Tightened section header — smaller, more refined, less visual weight.
  // Premium apps use small section labels as silent dividers, not headlines.
  sectionHeader: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: themeColors.textMuted,
    letterSpacing: 0.8,
    paddingHorizontal: 22,
    marginBottom: 6,
    marginTop: 14,
    textTransform: 'uppercase' as const,
  },
  sectionSubtext: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textMuted,
    paddingHorizontal: 20,
    marginBottom: 10,
    lineHeight: 18,
  },
  group: {
    backgroundColor: themeColors.surface,
    marginHorizontal: 16,
    borderRadius: Tokens.radius.card,
    overflow: 'hidden' as const,
    marginBottom: 20,
    // Black outline matches every other card surface across the app.
    // Drops the soft shadow — the defined edge carries enough weight.
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    minHeight: 52,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: Type.callout.fontSize,
    fontWeight: '400' as const,
    color: themeColors.text,
  },
  rowSubtext: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
    marginTop: 2,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowValue: {
    fontSize: Type.subhead.fontSize,
    color: themeColors.textSecondary,
    marginRight: 4,
  },
  inlineInput: {
    flex: 1,
    fontSize: Type.subhead.fontSize,
    color: themeColors.textSecondary,
    textAlign: 'right' as const,
    minWidth: 120,
  },
  numericInput: {
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
    textAlign: 'right' as const,
    minWidth: 50,
  },
  suffix: {
    fontSize: Type.subhead.fontSize,
    color: themeColors.textSecondary,
    fontWeight: '400' as const,
  },
  rowSeparator: {
    height: 0.5,
    backgroundColor: themeColors.line,
    marginLeft: 58,
  },
  aboutBlock: {
    flex: 1,
    gap: 2,
  },
  aboutDesc: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 16,
  },
  logoPreviewContainer: {
    padding: 16,
    gap: 12,
  },
  logoPreview: {
    width: '100%',
    height: 80,
    borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.surfaceAlt,
  },
  logoActions: {
    flexDirection: 'row',
    gap: 10,
  },
  logoChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.accent + '12',
  },
  logoChangeBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.accent,
  },
  logoRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.sm,
    // Tinted bg + solid fg matches the "Change" button next to it. Was
    // backgroundColor: themeColors.danger which collided with the text
    // color and made the button look like a solid red block.
    backgroundColor: themeColors.danger + '15',
  },
  logoRemoveBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.danger,
  },
  logoUploadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  signaturePreviewContainer: {
    padding: 16,
    gap: 12,
  },
  signaturePreviewBox: {
    backgroundColor: themeColors.surfaceAlt,
    borderRadius: Tokens.radius.md,
    padding: 14,
    gap: 8,
  },
  signaturePreviewLabel: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  signatureMiniPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signatureSavedText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '500' as const,
    color: themeColors.text,
  },
  signatureActions: {
    flexDirection: 'row',
    gap: 10,
  },
  signatureRedrawBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.accent + '12',
  },
  signatureRedrawBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.accent,
  },
  signatureRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Tokens.radius.sm,
    // Same fix as logoRemoveBtn — was solid danger bg colliding with
    // danger text color. Tinted bg (15% alpha) keeps the destructive
    // signal without making the button invisible.
    backgroundColor: themeColors.danger + '15',
  },
  signatureRemoveBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.danger,
  },
  signatureDrawRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  pdfPreviewNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 20,
    // Tinted bg (15% alpha) instead of solid info bg. Was solid blue
    // and the text was also info-blue — same-color-on-same-color =
    // invisible. The tint reads as a soft info callout without
    // collapsing legibility.
    backgroundColor: themeColors.info + '15',
    borderRadius: Tokens.radius.card,
    padding: 14,
    borderWidth: 1,
    borderColor: themeColors.info + '30',
  },
  pdfPreviewNoteText: {
    flex: 1,
    fontSize: Type.footnote.fontSize,
    color: themeColors.text,
    lineHeight: 18,
  },
  saveButton: {
    backgroundColor: themeColors.accent,
    marginHorizontal: 16,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 28,
    shadowColor: themeColors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveButtonText: {
    fontSize: Type.body.fontSize,
    fontWeight: '600' as const,
    color: '#fff',
    letterSpacing: -0.2,
  },
  dangerNote: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
    paddingHorizontal: 20,
    marginTop: -12,
    marginBottom: 20,
    lineHeight: 16,
  },
  supplierRegistered: {
    padding: 16,
    gap: 12,
  },
  supplierRegisteredHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  supplierRegisteredSub: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.success,
    fontWeight: '500' as const,
  },
  supplierRegisteredMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  supplierMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: themeColors.line,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.xs,
  },
  supplierMetaText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
  },
  supplierEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accent + '12',
  },
  supplierEditBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.accent,
  },
  supplierRegisterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  supplierInput: {
    minHeight: 44,
    borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surfaceAlt,
    paddingHorizontal: 14,
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
    marginBottom: 4,
  },
  supplierCatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  supplierCatChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.line,
  },
  supplierCatChipActive: {
    backgroundColor: themeColors.accent,
  },
  supplierCatText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  supplierCatTextActive: {
    color: "#FFFFFF",
  },
  // --- Supplier Profile modal (responsive: iOS pageSheet + web centered card) ---
  supProfileBackdrop: {
    flex: 1,
    // On iOS the Modal uses pageSheet so the "backdrop" is the native sheet
    // chrome — we don't want a second dim layer. On web/Android we dim the
    // underlying view manually.
    backgroundColor: Platform.OS === 'ios' ? themeColors.bg : 'rgba(0,0,0,0.45)',
  },
  supProfileCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Platform.OS === 'ios' ? 0 : 20,
  },
  supProfileCard: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'ios' ? undefined : 560,
    // On iOS the pageSheet already rounds the top corners for us — round only
    // on web/Android.
    borderRadius: Platform.OS === 'ios' ? 0 : 20,
    backgroundColor: themeColors.bg,
    overflow: 'hidden',
    // On web we cap the height so the card doesn't fill the whole viewport.
    ...(Platform.OS === 'web' ? { maxHeight: '92%' as any, flex: 0 as any } : {}),
  },
  supProfileHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 18 : 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: themeColors.line,
    backgroundColor: themeColors.surface,
  },
  supProfileTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
    letterSpacing: -0.3,
  },
  supProfileDesc: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 18,
    marginTop: 4,
  },
  supProfileClose: {
    width: 32,
    height: 32,
    borderRadius: Tokens.radius.panel,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: themeColors.line,
  },
  supProfileScroll: {
    flex: 1,
  },
  supProfileScrollContent: {
    padding: 20,
    gap: 14,
  },
  supFieldGroup: {
    gap: 6,
  },
  supFieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    letterSpacing: -0.1,
  },
  supFieldInput: {
    minHeight: 44,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: Type.subhead.fontSize,
    color: themeColors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: themeColors.line,
  },
  supFieldInputMulti: {
    minHeight: 80,
    paddingTop: 12,
    textAlignVertical: 'top' as const,
  },
  supRow: {
    flexDirection: 'row',
    gap: 12,
  },
  supRowItem: {
    flex: 1,
    minWidth: 0,
  },
  supCatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  supCatChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: themeColors.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: themeColors.line,
  },
  supCatChipActive: {
    backgroundColor: themeColors.accent,
    borderColor: themeColors.accent,
  },
  supCatText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  supCatTextActive: {
    color: "#FFFFFF",
  },
  supProfileFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: themeColors.line,
    backgroundColor: themeColors.surface,
  },
  supProfileSaveBtn: {
    backgroundColor: themeColors.accent,
    borderRadius: Tokens.radius.card,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: themeColors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 3,
  },
  supProfileSaveBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '600' as const,
    color: "#FFFFFF",
    letterSpacing: -0.2,
  },
  sigModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sigModalCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius["2xl"],
    padding: 24,
    width: '100%',
    maxWidth: 400,
    gap: 12,
  },
  sigModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sigModalTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  sigModalDesc: {
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 20,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  themeChip: {
    width: '47%' as unknown as number,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeChipActive: {
    borderColor: themeColors.accent,
    backgroundColor: themeColors.surface,
  },
  themeSwatches: {
    flexDirection: 'row',
    gap: 4,
  },
  themeSwatch: {
    width: 20,
    height: 20,
    borderRadius: Tokens.radius.xs,
  },
  themeChipLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '500' as const,
    color: themeColors.textSecondary,
    flexShrink: 1,
  },
  planCard: {
    backgroundColor: themeColors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: themeColors.line,
    gap: 12,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  planIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planName: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },
  planPrice: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
  },
  planActiveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
  },
  planActiveBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: '#fff',
  },
  planFeatures: {
    gap: 6,
    paddingLeft: 48,
  },
  planFeatureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  planFeatureText: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textSecondary,
    lineHeight: 18,
  },
  pdfSepPicker: {
    flexDirection: 'row',
    gap: 6,
  },
  pdfSepChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.line,
  },
  pdfSepChipActive: {
    backgroundColor: themeColors.accent,
  },
  pdfSepChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
  },
  pdfSepChipTextActive: {
    color: "#FFFFFF",
  },
});
