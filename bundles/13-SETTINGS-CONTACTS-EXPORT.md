# Settings, Contacts, Data Export & Documents


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

Settings tab (branding, PDF naming, Supplier Profile modal, theme
presets, subscription status, FAQ). The **Supplier Profile** modal was
recently rewritten for iPhone + web: native `pageSheet` on iOS, centered
dim-backdrop card on web, 2-column rows, sticky save footer with
safe-area-insets bottom padding, pill-shaped category chips.


## Files in this bundle

- `app/(tabs)/settings/index.tsx`
- `app/contacts.tsx`
- `app/data-export.tsx`
- `app/documents.tsx`
- `utils/dataExport.ts`
- `components/SignaturePad.tsx`
- `components/Tutorial.tsx`
- `components/PDFPreSendSheet.tsx`


---

### `app/(tabs)/settings/index.tsx`

```tsx
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Platform, Switch, Modal, Image, Dimensions,
  KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  MapPin, Ruler, Percent, ShieldCheck, Info, Trash2, ChevronRight,
  Building2, User, Phone, Mail, FileText, Award, Type, Camera,
  PenTool, X, Image as ImageIcon, Store, Package, Truck, ScanFace,
  Crown, Star, Zap, Check,
} from 'lucide-react-native';
import { Colors, setCustomColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { getAIUsageStats } from '@/utils/aiRateLimiter';
import { Sparkles, Hash } from 'lucide-react-native';
import { THEME_PRESETS } from '@/types';
import type { PDFNamingSettings } from '@/types';
import SignaturePad from '@/components/SignaturePad';
import Tutorial from '@/components/Tutorial';
import Paywall from '@/components/Paywall';
import { HelpCircle, MessageCircle, BookOpen } from 'lucide-react-native';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LogOut, UserCircle, Eye, EyeOff, FolderDown } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { track, AnalyticsEvents } from '@/utils/analytics';

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
    a: 'Subscriptions are billed through Apple or Google. Manage them in your device\u2019s Subscriptions settings. If you run into issues, email support@mageid.com and we\u2019ll sort it out.',
  },
  {
    q: 'Does MAGE ID replace a lawyer or licensed inspector?',
    a: 'No. AI code checks, estimates and permit guidance are helpful starting points but the local Authority Having Jurisdiction (AHJ) and a licensed professional always govern your project.',
  },
  {
    q: 'Where do I send feedback or feature requests?',
    a: 'We read every note \u2014 email support@mageid.com or tap Contact Support above. Shipping fast is how we build, so your feedback directly shapes the roadmap.',
  },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { settings, updateSettings, projects, deleteProject } = useProjects();
  const { user, logout, isAuthenticated } = useAuth();
  const { tier } = useSubscription();
  const [aiUsed, setAiUsed] = useState(0);
  const [aiLimit, setAiLimit] = useState(10);
  const [aiSmartUsed, setAiSmartUsed] = useState(0);
  const [aiSmartLimit, setAiSmartLimit] = useState(3);

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
  const [paywallTier, setPaywallTier] = useState<'pro' | 'business' | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<string>(() => {
    const saved = settings.themeColors;
    if (!saved) return 'forest';
    const match = THEME_PRESETS.find(t => t.primary === saved.primary);
    return match?.id ?? 'forest';
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
    updateSettings({
      location: location.trim() || 'United States',
      taxRate: tax,
      contingencyRate: cont,
      branding: {
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email: brandingEmail.trim(),
        phone: brandingPhone.trim(),
        address: brandingAddress.trim(),
        licenseNumber: licenseNumber.trim(),
        tagline: tagline.trim(),
        logoUri,
        signatureData,
      },
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

  const handleToggleUnits = useCallback(() => {
    const newUnits = settings.units === 'imperial' ? 'metric' : 'imperial';
    updateSettings({ units: newUnits });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [settings.units, updateSettings]);

  const sigPadWidth = Math.min(SCREEN_WIDTH - 80, 340);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.largeTitle}>Settings</Text>

        {isAuthenticated && user && (
          <>
            <Text style={styles.sectionHeader}>ACCOUNT</Text>
            <View style={styles.group}>
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: Colors.primary }]}>
                  <UserCircle size={14} color="#fff" />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowLabel}>{user.name || 'User'}</Text>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary }}>{user.email || 'No email'}</Text>
                </View>
              </View>
              <View style={styles.rowSeparator} />
              <TouchableOpacity
                style={styles.row}
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
                activeOpacity={0.6}
                testID="logout-button"
              >
                <View style={[styles.iconWrap, { backgroundColor: '#FF3B30' }]}>
                  <LogOut size={14} color="#fff" />
                </View>
                <Text style={[styles.rowLabel, { color: Colors.error }]}>Sign Out</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        <Text style={styles.sectionHeader}>AI USAGE</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: Colors.primary }]}>
              <Sparkles size={14} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Today: {aiUsed} of {aiLimit} requests</Text>
              <View style={{ height: 6, backgroundColor: Colors.fillTertiary, borderRadius: 3, marginTop: 6 }}>
                <View style={{ height: 6, backgroundColor: Colors.primary, borderRadius: 3, width: `${Math.min((aiUsed / aiLimit) * 100, 100)}%` }} />
              </View>
            </View>
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: Colors.accent }]}>
              <Sparkles size={14} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>Advanced: {aiSmartUsed} of {aiSmartLimit}</Text>
              <View style={{ height: 6, backgroundColor: Colors.fillTertiary, borderRadius: 3, marginTop: 6 }}>
                <View style={{ height: 6, backgroundColor: Colors.accent, borderRadius: 3, width: `${Math.min((aiSmartUsed / aiSmartLimit) * 100, 100)}%` }} />
              </View>
            </View>
          </View>
          <View style={styles.rowSeparator} />
          <View style={[styles.row, { paddingVertical: 10 }]}>
            <Text style={{ fontSize: 12, color: Colors.textMuted, flex: 1 }}>
              Resets daily at midnight · Plan: {tier === 'free' ? 'Free' : tier === 'pro' ? 'Pro' : 'Business'}
            </Text>
            {tier === 'free' && (
              <TouchableOpacity onPress={() => router.push('/paywall' as any)} activeOpacity={0.7}>
                <Text style={{ fontSize: 12, fontWeight: '600' as const, color: Colors.primary }}>Upgrade</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.sectionHeader}>LOCATION & UNITS</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#FF3B30' }]}>
              <MapPin size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Location</Text>
            <TextInput
              style={styles.inlineInput}
              value={location}
              onChangeText={setLocation}
              placeholder="City, State"
              placeholderTextColor={Colors.textMuted}
              textAlign="right"
              testID="settings-location"
            />
          </View>
          <View style={styles.rowSeparator} />
          <TouchableOpacity style={styles.row} onPress={handleToggleUnits} activeOpacity={0.6}>
            <View style={[styles.iconWrap, { backgroundColor: '#007AFF' }]}>
              <Ruler size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Units</Text>
            <View style={styles.rowRight}>
              <Text style={styles.rowValue}>
                {settings.units === 'imperial' ? 'Imperial' : 'Metric'}
              </Text>
              <Switch
                value={settings.units === 'metric'}
                onValueChange={handleToggleUnits}
                trackColor={{ false: Colors.border, true: Colors.primary }}
                thumbColor={Colors.surface}
                ios_backgroundColor={Colors.fillTertiary}
              />
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>ESTIMATE DEFAULTS</Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: Colors.primary }]}>
              <Percent size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Sales Tax Rate</Text>
            <View style={styles.rowRight}>
              <TextInput
                style={styles.numericInput}
                value={taxRate}
                onChangeText={setTaxRate}
                keyboardType="decimal-pad"
                placeholder="7.5"
                placeholderTextColor={Colors.textMuted}
                textAlign="right"
                testID="settings-tax"
              />
              <Text style={styles.suffix}>%</Text>
            </View>
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#34C759' }]}>
              <ShieldCheck size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Contingency Rate</Text>
            <View style={styles.rowRight}>
              <TextInput
                style={styles.numericInput}
                value={contingency}
                onChangeText={setContingency}
                keyboardType="decimal-pad"
                placeholder="10"
                placeholderTextColor={Colors.textMuted}
                textAlign="right"
                testID="settings-contingency"
              />
              <Text style={styles.suffix}>%</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionHeader}>COMPANY BRANDING</Text>
        <Text style={styles.sectionSubtext}>
          This info appears on PDF estimates you share with clients.
        </Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#1A6B3C' }]}>
              <Building2 size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Company Name</Text>
            <TextInput
              style={styles.inlineInput}
              value={companyName}
              onChangeText={setCompanyName}
              placeholder="Your Company LLC"
              placeholderTextColor={Colors.textMuted}
              textAlign="right"
              testID="branding-company"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#5856D6' }]}>
              <Type size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Tagline</Text>
            <TextInput
              style={styles.inlineInput}
              value={tagline}
              onChangeText={setTagline}
              placeholder="Quality you can trust"
              placeholderTextColor={Colors.textMuted}
              textAlign="right"
              testID="branding-tagline"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#007AFF' }]}>
              <User size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Contact Name</Text>
            <TextInput
              style={styles.inlineInput}
              value={contactName}
              onChangeText={setContactName}
              placeholder="John Smith"
              placeholderTextColor={Colors.textMuted}
              textAlign="right"
              testID="branding-contact"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#34C759' }]}>
              <Phone size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Phone</Text>
            <TextInput
              style={styles.inlineInput}
              value={brandingPhone}
              onChangeText={setBrandingPhone}
              placeholder="(555) 123-4567"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              textAlign="right"
              testID="branding-phone"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#FF9500' }]}>
              <Mail size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Email</Text>
            <TextInput
              style={styles.inlineInput}
              value={brandingEmail}
              onChangeText={setBrandingEmail}
              placeholder="info@company.com"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              textAlign="right"
              testID="branding-email"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#FF3B30' }]}>
              <MapPin size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Address</Text>
            <TextInput
              style={styles.inlineInput}
              value={brandingAddress}
              onChangeText={setBrandingAddress}
              placeholder="123 Main St, City"
              placeholderTextColor={Colors.textMuted}
              textAlign="right"
              testID="branding-address"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#AF52DE' }]}>
              <Award size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>License #</Text>
            <TextInput
              style={styles.inlineInput}
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              placeholder="GC-12345"
              placeholderTextColor={Colors.textMuted}
              textAlign="right"
              testID="branding-license"
            />
          </View>
        </View>

        <Text style={styles.sectionHeader}>COMPANY LOGO</Text>
        <Text style={styles.sectionSubtext}>
          Upload your company logo to include on PDF documents.
        </Text>
        <View style={styles.group}>
          {logoUri ? (
            <View style={styles.logoPreviewContainer}>
              <Image
                source={{ uri: logoUri }}
                style={styles.logoPreview}
                resizeMode="contain"
              />
              <View style={styles.logoActions}>
                <TouchableOpacity style={styles.logoChangeBtn} onPress={handlePickLogo} activeOpacity={0.7}>
                  <Camera size={14} color={Colors.primary} />
                  <Text style={styles.logoChangeBtnText}>Change</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.logoRemoveBtn} onPress={handleRemoveLogo} activeOpacity={0.7}>
                  <Trash2 size={14} color={Colors.error} />
                  <Text style={styles.logoRemoveBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.logoUploadRow} onPress={handlePickLogo} activeOpacity={0.7} testID="upload-logo">
              <View style={[styles.iconWrap, { backgroundColor: '#5856D6' }]}>
                <ImageIcon size={14} color="#fff" />
              </View>
              <Text style={styles.rowLabel}>Upload Logo</Text>
              <ChevronRight size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.sectionHeader}>SIGNATURE</Text>
        <Text style={styles.sectionSubtext}>
          Draw your signature to auto-sign documents and estimates.
        </Text>
        <View style={styles.group}>
          {signatureData && signatureData.length > 0 ? (
            <View style={styles.signaturePreviewContainer}>
              <View style={styles.signaturePreviewBox}>
                <Text style={styles.signaturePreviewLabel}>Your saved signature</Text>
                <View style={styles.signatureMiniPreview}>
                  <PenTool size={16} color={Colors.primary} />
                  <Text style={styles.signatureSavedText}>Signature saved ({signatureData.length} strokes)</Text>
                </View>
              </View>
              <View style={styles.signatureActions}>
                <TouchableOpacity
                  style={styles.signatureRedrawBtn}
                  onPress={() => setShowSignatureModal(true)}
                  activeOpacity={0.7}
                >
                  <PenTool size={14} color={Colors.primary} />
                  <Text style={styles.signatureRedrawBtnText}>Redraw</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.signatureRemoveBtn}
                  onPress={() => {
                    setSignatureData(undefined);
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  activeOpacity={0.7}
                >
                  <Trash2 size={14} color={Colors.error} />
                  <Text style={styles.signatureRemoveBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.signatureDrawRow}
              onPress={() => setShowSignatureModal(true)}
              activeOpacity={0.7}
              testID="draw-signature"
            >
              <View style={[styles.iconWrap, { backgroundColor: '#007AFF' }]}>
                <PenTool size={14} color="#fff" />
              </View>
              <Text style={styles.rowLabel}>Draw Signature</Text>
              <ChevronRight size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.pdfPreviewNote}>
          <FileText size={14} color={Colors.info} />
          <Text style={styles.pdfPreviewNoteText}>
            Your company info, logo, and signature will appear on generated PDF estimates when sharing via email or text.
          </Text>
        </View>

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
              <Hash size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Auto-Name PDFs</Text>
            <Switch
              value={pdfNaming.enabled}
              onValueChange={(val) => {
                setPdfNaming(prev => ({ ...prev, enabled: val }));
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.surface}
              ios_backgroundColor={Colors.fillTertiary}
            />
          </TouchableOpacity>
          {pdfNaming.enabled && (
            <>
              <View style={styles.rowSeparator} />
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: '#FF9500' }]}>
                  <Type size={14} color="#fff" />
                </View>
                <Text style={styles.rowLabel}>Prefix</Text>
                <TextInput
                  style={styles.inlineInput}
                  value={pdfNaming.prefix}
                  onChangeText={(val) => setPdfNaming(prev => ({ ...prev, prefix: val }))}
                  placeholder="e.g. MAGE"
                  placeholderTextColor={Colors.textMuted}
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
                <View style={[styles.iconWrap, { backgroundColor: '#34C759' }]}>
                  <Building2 size={14} color="#fff" />
                </View>
                <Text style={styles.rowLabel}>Include Project Name</Text>
                <Switch
                  value={pdfNaming.includeProjectName}
                  onValueChange={(val) => {
                    setPdfNaming(prev => ({ ...prev, includeProjectName: val }));
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.surface}
                  ios_backgroundColor={Colors.fillTertiary}
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
                <View style={[styles.iconWrap, { backgroundColor: '#007AFF' }]}>
                  <FileText size={14} color="#fff" />
                </View>
                <Text style={styles.rowLabel}>Include Document Type</Text>
                <Switch
                  value={pdfNaming.includeDocType}
                  onValueChange={(val) => {
                    setPdfNaming(prev => ({ ...prev, includeDocType: val }));
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.surface}
                  ios_backgroundColor={Colors.fillTertiary}
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
                <View style={[styles.iconWrap, { backgroundColor: '#FF3B30' }]}>
                  <Info size={14} color="#fff" />
                </View>
                <Text style={styles.rowLabel}>Include Date</Text>
                <Switch
                  value={pdfNaming.includeDate}
                  onValueChange={(val) => {
                    setPdfNaming(prev => ({ ...prev, includeDate: val }));
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.surface}
                  ios_backgroundColor={Colors.fillTertiary}
                />
              </TouchableOpacity>
              <View style={styles.rowSeparator} />
              <View style={styles.row}>
                <View style={[styles.iconWrap, { backgroundColor: '#AF52DE' }]}>
                  <Ruler size={14} color="#fff" />
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
                <View style={[styles.iconWrap, { backgroundColor: '#FF9500' }]}>
                  <Hash size={14} color="#fff" />
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
                  placeholderTextColor={Colors.textMuted}
                  textAlign="right"
                  testID="pdf-naming-next-number"
                />
              </View>
            </>
          )}
        </View>
        {pdfNaming.enabled && pdfNamingPreview ? (
          <View style={styles.pdfPreviewNote}>
            <FileText size={14} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.pdfPreviewNoteText, { color: Colors.textSecondary, fontWeight: '600' as const, marginBottom: 2 }]}>Preview</Text>
              <Text style={[styles.pdfPreviewNoteText, { color: Colors.text }]} numberOfLines={1}>{pdfNamingPreview}</Text>
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
                <View style={[styles.iconWrap, { backgroundColor: '#007AFF' }]}>
                  <ScanFace size={14} color="#fff" />
                </View>
                <Text style={styles.rowLabel}>Face ID / Touch ID</Text>
                <Switch
                  value={biometricsEnabled}
                  onValueChange={(val) => {
                    setBiometricsEnabled(val);
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.surface}
                  ios_backgroundColor={Colors.fillTertiary}
                />
              </TouchableOpacity>
            </View>
          </>
        )}

        <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.8} testID="save-settings">
          <Text style={styles.saveButtonText}>Save Changes</Text>
        </TouchableOpacity>

        <Text style={styles.sectionHeader}>CONTACTS & EMAIL</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/contacts')}
            activeOpacity={0.7}
            testID="contacts-link"
          >
            <View style={[styles.iconWrap, { backgroundColor: Colors.info }]}>
              <User size={14} color="#fff" />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Contacts</Text>
            <ChevronRight size={16} color={Colors.textMuted} />
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
            <View style={[styles.iconWrap, { backgroundColor: Colors.primary }]}>
              <FolderDown size={14} color="#fff" />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Export my data</Text>
            <ChevronRight size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionHeader}>SUPPLIER MARKETPLACE</Text>
        <Text style={styles.sectionSubtext}>
          Register as a supplier to list your materials on the MAGE ID Marketplace and sell directly to contractors.
        </Text>
        <View style={styles.group}>
          {supplierProfile ? (
            <View style={styles.supplierRegistered}>
              <View style={styles.supplierRegisteredHeader}>
                <View style={[styles.iconWrap, { backgroundColor: Colors.success }]}>
                  <Store size={14} color="#fff" />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowLabel}>{supplierProfile.companyName}</Text>
                  <Text style={styles.supplierRegisteredSub}>Registered Supplier</Text>
                </View>
              </View>
              <View style={styles.supplierRegisteredMeta}>
                <View style={styles.supplierMetaChip}>
                  <Package size={10} color={Colors.info} />
                  <Text style={styles.supplierMetaText}>{supplierProfile.categories.length} categories</Text>
                </View>
                <View style={styles.supplierMetaChip}>
                  <Truck size={10} color={Colors.textMuted} />
                  <Text style={styles.supplierMetaText}>{supplierProfile.deliveryOptions.length} delivery options</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.supplierEditBtn}
                onPress={() => setShowSupplierForm(true)}
                activeOpacity={0.7}
              >
                <PenTool size={14} color={Colors.primary} />
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
              <View style={[styles.iconWrap, { backgroundColor: '#FF9500' }]}>
                <Store size={14} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>Register as Supplier</Text>
                <Text style={{ fontSize: 12, color: Colors.textSecondary }}>List your materials for sale</Text>
              </View>
              <ChevronRight size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.sectionHeader}>SUBSCRIPTION PLAN</Text>
        <Text style={styles.sectionSubtext}>
          Upgrade to unlock premium features for your business.
        </Text>
        <View style={styles.group}>
          <View style={{ padding: 16, gap: 12 }}>
            {[
              {
                id: 'free' as const,
                label: 'Free',
                price: '$0/mo',
                color: Colors.textMuted,
                icon: Star,
                features: ['1 active project', 'Basic estimate wizard', 'Materials browser (view only)'],
                disabled: ['No PDF export', 'No schedule maker', 'No cloud sync'],
              },
              {
                id: 'pro' as const,
                label: 'Pro',
                price: '$29/mo',
                color: Colors.primary,
                icon: Zap,
                features: ['Unlimited projects', 'Full estimate + markup', 'Schedule maker (all views)', 'Branded PDF export', 'Change orders & invoicing', 'Daily field reports', 'Material price alerts', 'Cloud sync'],
                disabled: [],
              },
              {
                id: 'business' as const,
                label: 'Business',
                price: '$79/mo',
                color: '#5856D6',
                icon: Crown,
                features: ['Everything in Pro', 'Subcontractor management', 'Punch list & closeout', 'Client portal (shareable link)', 'Unlimited collaborators', 'Custom branding + logos', 'Priority support'],
                disabled: [],
              },
            ].map(plan => {
              const currentTier = settings.subscription?.tier ?? 'free';
              const isActive = currentTier === plan.id;
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.planCard, isActive && { borderColor: plan.color, borderWidth: 2 }]}
                  onPress={() => {
                    if (isActive) return;
                    if (plan.id === 'free') {
                      Alert.alert(
                        'Contact Support',
                        'To downgrade to Free, manage your subscription in the App Store (Settings → Apple ID → Subscriptions) or contact support@mageid.com.',
                      );
                      return;
                    }
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                    setPaywallTier(plan.id as 'pro' | 'business');
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
                        <Check size={12} color={plan.color} />
                        <Text style={styles.planFeatureText}>{f}</Text>
                      </View>
                    ))}
                    {plan.disabled.map((f, i) => (
                      <View key={`d-${i}`} style={styles.planFeatureRow}>
                        <X size={12} color={Colors.textMuted} />
                        <Text style={[styles.planFeatureText, { color: Colors.textMuted }]}>{f}</Text>
                      </View>
                    ))}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <Text style={styles.sectionHeader}>HELP & SUPPORT</Text>
        <View style={styles.group}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => setShowTutorial(true)}
            activeOpacity={0.6}
            testID="show-tutorial"
          >
            <View style={[styles.iconWrap, { backgroundColor: Colors.primary }]}>
              <BookOpen size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Show Tutorial</Text>
            <ChevronRight size={16} color={Colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.rowSeparator} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              Linking.openURL('mailto:support@mageid.com?subject=MAGE%20ID%20Support').catch(() =>
                Alert.alert('Could not open mail', 'Email us at support@mageid.com')
              );
            }}
            activeOpacity={0.6}
            testID="contact-support"
          >
            <View style={[styles.iconWrap, { backgroundColor: Colors.primary }]}>
              <MessageCircle size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Contact Support</Text>
            <ChevronRight size={16} color={Colors.textMuted} />
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
                  <View style={[styles.iconWrap, { backgroundColor: Colors.primary }]}>
                    <HelpCircle size={14} color="#fff" />
                  </View>
                  <Text style={[styles.rowLabel, { flex: 1 }]} numberOfLines={isOpen ? undefined : 2}>
                    {item.q}
                  </Text>
                  <ChevronRight
                    size={16}
                    color={Colors.textMuted}
                    style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}
                  />
                </TouchableOpacity>
                {isOpen ? (
                  <View style={{ paddingHorizontal: 16, paddingBottom: 12, paddingTop: 0 }}>
                    <Text style={{ fontSize: 13, color: Colors.textMuted, lineHeight: 19 }}>
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
            <View style={[styles.iconWrap, { backgroundColor: Colors.primary }]}>
              <Info size={14} color="#fff" />
            </View>
            <View style={styles.aboutBlock}>
              <Text style={styles.rowLabel}>MAGE ID</Text>
              <Text style={styles.aboutDesc}>Construction estimator with real-time pricing & bulk discounts.</Text>
            </View>
          </View>
          <View style={styles.rowSeparator} />
          <View style={[styles.row, { opacity: 0.7 }]}>
            <View style={[styles.iconWrap, { backgroundColor: Colors.textMuted }]}>
              <ChevronRight size={14} color="#fff" />
            </View>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowValue}>1.0.0</Text>
          </View>
        </View>

        <Text style={[styles.sectionHeader, { color: Colors.error }]}>DANGER ZONE</Text>
        <View style={styles.group}>
          <TouchableOpacity style={styles.row} onPress={handleClearAll} activeOpacity={0.6} testID="clear-all">
            <View style={[styles.iconWrap, { backgroundColor: Colors.error }]}>
              <Trash2 size={14} color="#fff" />
            </View>
            <Text style={[styles.rowLabel, { color: Colors.error }]}>Clear All Projects & Data</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.dangerNote}>
          Permanently deletes all projects and cannot be undone.
        </Text>
      </ScrollView>

      <Tutorial visible={showTutorial} onClose={() => setShowTutorial(false)} />
      <Paywall
        visible={paywallTier !== null}
        feature={paywallTier === 'business' ? 'Business Plan' : 'Pro Plan'}
        requiredTier={paywallTier ?? 'pro'}
        onClose={() => setPaywallTier(null)}
      />

      <Modal
        visible={showSignatureModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSignatureModal(false)}
      >
        <View style={styles.sigModalOverlay}>
          <View style={styles.sigModalCard}>
            <View style={styles.sigModalHeader}>
              <Text style={styles.sigModalTitle}>Draw Your Signature</Text>
              <TouchableOpacity onPress={() => setShowSignatureModal(false)}>
                <X size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.sigModalDesc}>
              Use your finger to sign below. This will be used on all PDF documents.
            </Text>
            <SignaturePad
              initialPaths={signatureData}
              onSave={handleSaveSignature}
              onClear={handleClearSignature}
              width={sigPadWidth}
              height={160}
            />
          </View>
        </View>
      </Modal>
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
                  <X size={20} color={Colors.textMuted} />
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
                    placeholderTextColor={Colors.textMuted}
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
                    placeholderTextColor={Colors.textMuted}
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
                      placeholderTextColor={Colors.textMuted}
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
                      placeholderTextColor={Colors.textMuted}
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
                    placeholderTextColor={Colors.textMuted}
                  />
                </View>

                <View style={styles.supFieldGroup}>
                  <Text style={styles.supFieldLabel}>Website</Text>
                  <TextInput
                    style={styles.supFieldInput}
                    value={supWebsite}
                    onChangeText={setSupWebsite}
                    placeholder="yourcompany.com"
                    placeholderTextColor={Colors.textMuted}
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
                    placeholderTextColor={Colors.textMuted}
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
                      placeholderTextColor={Colors.textMuted}
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
                      placeholderTextColor={Colors.textMuted}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  largeTitle: {
    fontSize: 34,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
    paddingHorizontal: 20,
    paddingTop: 4,
    marginBottom: 28,
  },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 8,
    marginTop: 6,
  },
  sectionSubtext: {
    fontSize: 13,
    color: Colors.textMuted,
    paddingHorizontal: 20,
    marginBottom: 10,
    lineHeight: 18,
  },
  group: {
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    borderRadius: 12,
    overflow: 'hidden' as const,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
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
    fontSize: 16,
    fontWeight: '400' as const,
    color: Colors.text,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowValue: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginRight: 4,
  },
  inlineInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'right' as const,
    minWidth: 120,
  },
  numericInput: {
    fontSize: 15,
    color: Colors.text,
    textAlign: 'right' as const,
    minWidth: 50,
  },
  suffix: {
    fontSize: 15,
    color: Colors.textSecondary,
    fontWeight: '400' as const,
  },
  rowSeparator: {
    height: 0.5,
    backgroundColor: Colors.borderLight,
    marginLeft: 58,
  },
  aboutBlock: {
    flex: 1,
    gap: 2,
  },
  aboutDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 16,
  },
  logoPreviewContainer: {
    padding: 16,
    gap: 12,
  },
  logoPreview: {
    width: '100%',
    height: 80,
    borderRadius: 8,
    backgroundColor: Colors.surfaceAlt,
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
    borderRadius: 8,
    backgroundColor: Colors.primary + '12',
  },
  logoChangeBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  logoRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.errorLight,
  },
  logoRemoveBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.error,
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
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  signaturePreviewLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  signatureMiniPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signatureSavedText: {
    fontSize: 14,
    fontWeight: '500' as const,
    color: Colors.text,
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
    borderRadius: 8,
    backgroundColor: Colors.primary + '12',
  },
  signatureRedrawBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  signatureRemoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.errorLight,
  },
  signatureRemoveBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.error,
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
    backgroundColor: Colors.infoLight,
    borderRadius: 12,
    padding: 14,
  },
  pdfPreviewNoteText: {
    flex: 1,
    fontSize: 13,
    color: Colors.info,
    lineHeight: 18,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    marginHorizontal: 16,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 28,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
  },
  saveButtonText: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: '#fff',
    letterSpacing: -0.2,
  },
  dangerNote: {
    fontSize: 12,
    color: Colors.textMuted,
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
    fontSize: 12,
    color: Colors.success,
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
    backgroundColor: Colors.fillTertiary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  supplierMetaText: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
  supplierEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.primary + '12',
  },
  supplierEditBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
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
    borderRadius: 12,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 14,
    fontSize: 15,
    color: Colors.text,
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
    borderRadius: 10,
    backgroundColor: Colors.fillTertiary,
  },
  supplierCatChipActive: {
    backgroundColor: Colors.primary,
  },
  supplierCatText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  supplierCatTextActive: {
    color: Colors.textOnPrimary,
  },
  // --- Supplier Profile modal (responsive: iOS pageSheet + web centered card) ---
  supProfileBackdrop: {
    flex: 1,
    // On iOS the Modal uses pageSheet so the "backdrop" is the native sheet
    // chrome — we don't want a second dim layer. On web/Android we dim the
    // underlying view manually.
    backgroundColor: Platform.OS === 'ios' ? Colors.background : 'rgba(0,0,0,0.45)',
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
    backgroundColor: Colors.background,
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
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  supProfileTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  supProfileDesc: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginTop: 4,
  },
  supProfileClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.fillTertiary,
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
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: -0.1,
  },
  supFieldInput: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: Colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    fontSize: 15,
    color: Colors.text,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
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
    borderRadius: 999,
    backgroundColor: Colors.fillTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  supCatChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  supCatText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  supCatTextActive: {
    color: Colors.textOnPrimary,
  },
  supProfileFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  supProfileSaveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 3,
  },
  supProfileSaveBtnText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textOnPrimary,
    letterSpacing: -0.2,
  },
  sigModalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sigModalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 24,
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
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  sigModalDesc: {
    fontSize: 14,
    color: Colors.textSecondary,
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
    borderRadius: 12,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  themeSwatches: {
    flexDirection: 'row',
    gap: 4,
  },
  themeSwatch: {
    width: 20,
    height: 20,
    borderRadius: 6,
  },
  themeChipLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    flexShrink: 1,
  },
  planCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
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
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  planPrice: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  planActiveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  planActiveBadgeText: {
    fontSize: 11,
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
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  pdfSepPicker: {
    flexDirection: 'row',
    gap: 6,
  },
  pdfSepChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.fillTertiary,
  },
  pdfSepChipActive: {
    backgroundColor: Colors.primary,
  },
  pdfSepChipText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  pdfSepChipTextActive: {
    color: Colors.textOnPrimary,
  },
});

```


---

### `app/contacts.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList,
  Alert, Platform, Modal, KeyboardAvoidingView, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Search, Plus, X, User, Mail, Phone, MapPin,
  ChevronRight, Trash2, Edit3, Briefcase,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { Contact, ContactRole } from '@/types';

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const CONTACT_ROLES: { value: ContactRole; label: string }[] = [
  { value: 'Client', label: 'Client' },
  { value: 'Architect', label: 'Architect' },
  { value: "Owner's Rep", label: "Owner's Rep" },
  { value: 'Engineer', label: 'Engineer' },
  { value: 'Sub', label: 'Subcontractor' },
  { value: 'Supplier', label: 'Supplier' },
  { value: 'Lender', label: 'Lender' },
  { value: 'Inspector', label: 'Inspector' },
  { value: 'Other', label: 'Other' },
];

function getRoleColor(role: ContactRole): string {
  switch (role) {
    case 'Client': return Colors.primary;
    case 'Architect': return Colors.info;
    case "Owner's Rep": return Colors.accent;
    case 'Engineer': return '#6B7280';
    case 'Sub': return Colors.success;
    case 'Supplier': return '#8B5CF6';
    case 'Lender': return '#EC4899';
    case 'Inspector': return '#F59E0B';
    default: return Colors.textSecondary;
  }
}

export default function ContactsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { contacts, addContact, updateContact, deleteContact, projects, getInvoicesForProject } = useProjects();

  const [query, setQuery] = useState('');
  const [filterRole, setFilterRole] = useState<ContactRole | 'all'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState<ContactRole>('Client');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const filteredContacts = useMemo(() => {
    let results = contacts;
    if (filterRole !== 'all') {
      results = results.filter(c => c.role === filterRole);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(c =>
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q) ||
        c.companyName.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q)
      );
    }
    return results.sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [contacts, query, filterRole]);

  const resetForm = useCallback(() => {
    setFirstName('');
    setLastName('');
    setCompanyName('');
    setRole('Client');
    setEmail('');
    setPhone('');
    setAddress('');
    setNotes('');
    setEditingContact(null);
  }, []);

  const openAddModal = useCallback(() => {
    resetForm();
    setShowAddModal(true);
  }, [resetForm]);

  const openEditModal = useCallback((contact: Contact) => {
    setFirstName(contact.firstName);
    setLastName(contact.lastName);
    setCompanyName(contact.companyName);
    setRole(contact.role);
    setEmail(contact.email);
    setPhone(contact.phone);
    setAddress(contact.address);
    setNotes(contact.notes);
    setEditingContact(contact);
    setShowAddModal(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!firstName.trim() && !lastName.trim() && !companyName.trim()) {
      Alert.alert('Missing Info', 'Please enter at least a name or company.');
      return;
    }

    const now = new Date().toISOString();

    if (editingContact) {
      updateContact(editingContact.id, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        companyName: companyName.trim(),
        role,
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
      });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowAddModal(false);
      resetForm();
    } else {
      const contact: Contact = {
        id: createId('con'),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        companyName: companyName.trim(),
        role,
        email: email.trim(),
        phone: phone.trim(),
        address: address.trim(),
        notes: notes.trim(),
        linkedProjectIds: [],
        createdAt: now,
        updatedAt: now,
      };
      addContact(contact);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowAddModal(false);
      resetForm();
    }
  }, [firstName, lastName, companyName, role, email, phone, address, notes, editingContact, addContact, updateContact, resetForm]);

  const handleDelete = useCallback((contact: Contact) => {
    Alert.alert('Delete Contact', `Remove ${contact.firstName} ${contact.lastName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          deleteContact(contact.id);
          setShowDetailModal(false);
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        },
      },
    ]);
  }, [deleteContact]);

  const openDetail = useCallback((contact: Contact) => {
    setSelectedContact(contact);
    setShowDetailModal(true);
  }, []);

  const getContactFinancials = useCallback((contact: Contact) => {
    if (contact.role !== 'Client') return null;
    let totalInvoiced = 0;
    let totalPaid = 0;
    contact.linkedProjectIds.forEach(pid => {
      const invoices = getInvoicesForProject(pid);
      invoices.forEach(inv => {
        totalInvoiced += inv.totalDue;
        totalPaid += inv.amountPaid;
      });
    });
    return { totalInvoiced, totalPaid, outstanding: totalInvoiced - totalPaid };
  }, [getInvoicesForProject]);

  const renderContact = useCallback(({ item }: { item: Contact }) => {
    const roleColor = getRoleColor(item.role);
    const displayName = `${item.firstName} ${item.lastName}`.trim() || item.companyName;
    return (
      <TouchableOpacity
        style={styles.contactCard}
        onPress={() => openDetail(item)}
        activeOpacity={0.7}
        testID={`contact-${item.id}`}
      >
        <View style={[styles.avatar, { backgroundColor: roleColor + '18' }]}>
          <Text style={[styles.avatarText, { color: roleColor }]}>
            {(item.firstName[0] || item.companyName[0] || '?').toUpperCase()}
          </Text>
        </View>
        <View style={styles.contactInfo}>
          <Text style={styles.contactName} numberOfLines={1}>{displayName}</Text>
          {item.companyName && item.firstName ? (
            <Text style={styles.contactCompany} numberOfLines={1}>{item.companyName}</Text>
          ) : null}
          <View style={styles.contactMetaRow}>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '15' }]}>
              <Text style={[styles.roleBadgeText, { color: roleColor }]}>{item.role}</Text>
            </View>
            {item.email ? (
              <Text style={styles.contactEmail} numberOfLines={1}>{item.email}</Text>
            ) : null}
          </View>
        </View>
        <ChevronRight size={16} color={Colors.textMuted} />
      </TouchableOpacity>
    );
  }, [openDetail]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Contacts',
        headerStyle: { backgroundColor: Colors.background },
        headerTintColor: Colors.primary,
        headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        headerRight: () => (
          <TouchableOpacity onPress={openAddModal} style={styles.headerAddBtn}>
            <Plus size={20} color={Colors.primary} />
          </TouchableOpacity>
        ),
      }} />

      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Search size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search contacts..."
            placeholderTextColor={Colors.textMuted}
            testID="contacts-search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <X size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, filterRole === 'all' && styles.filterChipActive]}
            onPress={() => setFilterRole('all')}
          >
            <Text style={[styles.filterChipText, filterRole === 'all' && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {CONTACT_ROLES.map(r => (
            <TouchableOpacity
              key={r.value}
              style={[styles.filterChip, filterRole === r.value && styles.filterChipActive]}
              onPress={() => setFilterRole(r.value)}
            >
              <Text style={[styles.filterChipText, filterRole === r.value && styles.filterChipTextActive]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filteredContacts}
        keyExtractor={item => item.id}
        renderItem={renderContact}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <User size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>
              {query || filterRole !== 'all' ? 'No contacts found' : 'No contacts yet'}
            </Text>
            <Text style={styles.emptyDesc}>
              {query || filterRole !== 'all' ? 'Try a different search or filter' : 'Tap + to add your first contact'}
            </Text>
          </View>
        }
      />

      {/* Add/Edit Modal */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingContact ? 'Edit Contact' : 'New Contact'}</Text>
                <TouchableOpacity onPress={() => { setShowAddModal(false); resetForm(); }}>
                  <X size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>First Name</Text>
                    <TextInput style={styles.formInput} value={firstName} onChangeText={setFirstName} placeholder="John" placeholderTextColor={Colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Last Name</Text>
                    <TextInput style={styles.formInput} value={lastName} onChangeText={setLastName} placeholder="Smith" placeholderTextColor={Colors.textMuted} />
                  </View>
                </View>

                <Text style={styles.formLabel}>Company</Text>
                <TextInput style={styles.formInput} value={companyName} onChangeText={setCompanyName} placeholder="Company name" placeholderTextColor={Colors.textMuted} />

                <Text style={styles.formLabel}>Role</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roleChipsRow}>
                  {CONTACT_ROLES.map(r => (
                    <TouchableOpacity
                      key={r.value}
                      style={[styles.roleChip, role === r.value && styles.roleChipActive]}
                      onPress={() => setRole(r.value)}
                    >
                      <Text style={[styles.roleChipText, role === r.value && styles.roleChipTextActive]}>{r.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.formLabel}>Email</Text>
                <TextInput style={styles.formInput} value={email} onChangeText={setEmail} placeholder="email@example.com" placeholderTextColor={Colors.textMuted} keyboardType="email-address" autoCapitalize="none" />

                <Text style={styles.formLabel}>Phone</Text>
                <TextInput style={styles.formInput} value={phone} onChangeText={setPhone} placeholder="(555) 123-4567" placeholderTextColor={Colors.textMuted} keyboardType="phone-pad" />

                <Text style={styles.formLabel}>Address</Text>
                <TextInput style={styles.formInput} value={address} onChangeText={setAddress} placeholder="123 Main St, City, State" placeholderTextColor={Colors.textMuted} />

                <Text style={styles.formLabel}>Notes</Text>
                <TextInput style={[styles.formInput, { minHeight: 70 }]} value={notes} onChangeText={setNotes} placeholder="Additional notes..." placeholderTextColor={Colors.textMuted} multiline textAlignVertical="top" />

                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
                  <Text style={styles.saveBtnText}>{editingContact ? 'Save Changes' : 'Add Contact'}</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Detail Modal */}
      <Modal visible={showDetailModal} transparent animationType="slide" onRequestClose={() => setShowDetailModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16, maxHeight: '85%' }]}>
            {selectedContact && (() => {
              const displayName = `${selectedContact.firstName} ${selectedContact.lastName}`.trim() || selectedContact.companyName;
              const roleColor = getRoleColor(selectedContact.role);
              const financials = getContactFinancials(selectedContact);
              const linkedProjects = projects.filter(p => selectedContact.linkedProjectIds.includes(p.id));

              return (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{displayName}</Text>
                    <TouchableOpacity onPress={() => setShowDetailModal(false)}>
                      <X size={20} color={Colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView showsVerticalScrollIndicator={false}>
                    <View style={[styles.detailRoleBadge, { backgroundColor: roleColor + '15' }]}>
                      <Briefcase size={14} color={roleColor} />
                      <Text style={[styles.detailRoleText, { color: roleColor }]}>{selectedContact.role}</Text>
                      {selectedContact.companyName && selectedContact.firstName ? (
                        <Text style={styles.detailCompany}> · {selectedContact.companyName}</Text>
                      ) : null}
                    </View>

                    <View style={styles.detailSection}>
                      {selectedContact.email ? (
                        <View style={styles.detailRow}>
                          <Mail size={14} color={Colors.textMuted} />
                          <Text style={styles.detailText}>{selectedContact.email}</Text>
                        </View>
                      ) : null}
                      {selectedContact.phone ? (
                        <View style={styles.detailRow}>
                          <Phone size={14} color={Colors.textMuted} />
                          <Text style={styles.detailText}>{selectedContact.phone}</Text>
                        </View>
                      ) : null}
                      {selectedContact.address ? (
                        <View style={styles.detailRow}>
                          <MapPin size={14} color={Colors.textMuted} />
                          <Text style={styles.detailText}>{selectedContact.address}</Text>
                        </View>
                      ) : null}
                    </View>

                    {financials && (
                      <View style={styles.financialCard}>
                        <Text style={styles.financialTitle}>Financial Summary</Text>
                        <View style={styles.financialRow}>
                          <Text style={styles.financialLabel}>Total Invoiced</Text>
                          <Text style={styles.financialValue}>${financials.totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                        </View>
                        <View style={styles.financialRow}>
                          <Text style={styles.financialLabel}>Total Paid</Text>
                          <Text style={[styles.financialValue, { color: Colors.success }]}>${financials.totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                        </View>
                        <View style={styles.financialDivider} />
                        <View style={styles.financialRow}>
                          <Text style={styles.financialLabelBold}>Outstanding</Text>
                          <Text style={[styles.financialValueBold, { color: financials.outstanding > 0 ? Colors.error : Colors.success }]}>
                            ${financials.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Text>
                        </View>
                      </View>
                    )}

                    {linkedProjects.length > 0 && (
                      <View style={styles.linkedSection}>
                        <Text style={styles.linkedTitle}>Linked Projects</Text>
                        {linkedProjects.map(p => (
                          <TouchableOpacity
                            key={p.id}
                            style={styles.linkedProjectRow}
                            onPress={() => {
                              setShowDetailModal(false);
                              router.push({ pathname: '/project-detail', params: { id: p.id } });
                            }}
                          >
                            <Text style={styles.linkedProjectName}>{p.name}</Text>
                            <ChevronRight size={14} color={Colors.textMuted} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}

                    {selectedContact.notes ? (
                      <View style={styles.notesSection}>
                        <Text style={styles.notesTitle}>Notes</Text>
                        <Text style={styles.notesText}>{selectedContact.notes}</Text>
                      </View>
                    ) : null}

                    <View style={styles.detailActions}>
                      <TouchableOpacity
                        style={styles.editBtn}
                        onPress={() => {
                          setShowDetailModal(false);
                          setTimeout(() => openEditModal(selectedContact), 350);
                        }}
                      >
                        <Edit3 size={14} color={Colors.primary} />
                        <Text style={styles.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.deleteBtn}
                        onPress={() => handleDelete(selectedContact)}
                      >
                        <Trash2 size={14} color={Colors.error} />
                        <Text style={styles.deleteBtnText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </ScrollView>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerAddBtn: { marginRight: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary + '12', alignItems: 'center', justifyContent: 'center' },
  searchSection: { backgroundColor: Colors.surface, paddingBottom: 10, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.fillTertiary, borderRadius: 12, marginHorizontal: 16, paddingHorizontal: 12, gap: 8, height: 42 },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text },
  filterRow: { paddingHorizontal: 16, gap: 6, marginTop: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.fillTertiary },
  filterChipActive: { backgroundColor: Colors.primary },
  filterChipText: { fontSize: 12, fontWeight: '500' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: Colors.textOnPrimary, fontWeight: '600' as const },
  listContent: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  contactCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: 14, padding: 14, gap: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' as const },
  contactInfo: { flex: 1, gap: 2 },
  contactName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  contactCompany: { fontSize: 12, color: Colors.textSecondary },
  contactMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  roleBadgeText: { fontSize: 10, fontWeight: '700' as const },
  contactEmail: { fontSize: 11, color: Colors.textMuted, flex: 1 },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' as const },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  formRow: { flexDirection: 'row', gap: 10 },
  formLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textSecondary, marginTop: 10, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  formInput: { minHeight: 44, borderRadius: 12, backgroundColor: Colors.surfaceAlt, paddingHorizontal: 12, fontSize: 15, color: Colors.text, borderWidth: 1, borderColor: Colors.cardBorder },
  roleChipsRow: { gap: 6, paddingVertical: 2 },
  roleChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: Colors.fillTertiary },
  roleChipActive: { backgroundColor: Colors.primary },
  roleChipText: { fontSize: 13, fontWeight: '500' as const, color: Colors.textSecondary },
  roleChipTextActive: { color: Colors.textOnPrimary, fontWeight: '600' as const },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnText: { fontSize: 16, fontWeight: '700' as const, color: Colors.textOnPrimary },
  detailRoleBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, marginBottom: 12 },
  detailRoleText: { fontSize: 13, fontWeight: '700' as const },
  detailCompany: { fontSize: 12, color: Colors.textSecondary },
  detailSection: { gap: 10, marginBottom: 16 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailText: { fontSize: 14, color: Colors.text },
  financialCard: { backgroundColor: Colors.surfaceAlt, borderRadius: 14, padding: 14, gap: 8, marginBottom: 16 },
  financialTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
  financialRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  financialLabel: { fontSize: 14, color: Colors.textSecondary },
  financialValue: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  financialDivider: { height: 1, backgroundColor: Colors.borderLight },
  financialLabelBold: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  financialValueBold: { fontSize: 17, fontWeight: '800' as const },
  linkedSection: { marginBottom: 16 },
  linkedTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 8 },
  linkedProjectRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.surfaceAlt, borderRadius: 10, padding: 12, marginBottom: 4 },
  linkedProjectName: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  notesSection: { marginBottom: 16 },
  notesTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.textSecondary, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  notesText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  editBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary + '12', borderRadius: 12, paddingVertical: 12 },
  editBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.primary },
  deleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.errorLight, borderRadius: 12, paddingVertical: 12 },
  deleteBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.error },
});

```


---

### `app/data-export.tsx`

```tsx
import React, { useMemo, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Alert, Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Download, FileJson, FileSpreadsheet, FolderDown, Image as ImageIcon,
  Package, CheckCircle2, Share2, Info,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  buildExportPayload, exportUserData, shareExportedFile, summarizeExport,
  type DataExportOptions, type DataExportSummary,
} from '@/utils/dataExport';

type Scope = 'all' | 'project';

export default function DataExportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, invoices, changeOrders, punchItems,
    projectPhotos, contacts, rfis, submittals, equipment, warranties,
    subcontractors, commEvents, getDailyReportsForProject,
  } = useProjects();

  const dailyReports = useMemo(
    () => projects.flatMap(p => getDailyReportsForProject(p.id)),
    [projects, getDailyReportsForProject],
  );

  const [scope, setScope] = useState<Scope>(params.projectId ? 'project' : 'all');
  const [projectId, setProjectId] = useState<string | undefined>(params.projectId);
  const [format, setFormat] = useState<'json' | 'csv' | 'both'>('both');
  const [includePhotoUrls, setIncludePhotoUrls] = useState<boolean>(true);
  const [generating, setGenerating] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<DataExportSummary | null>(null);

  const allData = useMemo(() => ({
    projects,
    invoices,
    changeOrders,
    dailyReports,
    punchItems,
    photos: projectPhotos,
    contacts,
    rfis,
    submittals,
    equipment,
    warranties,
    subcontractors,
    communications: commEvents,
  }), [projects, invoices, changeOrders, dailyReports, punchItems, projectPhotos,
      contacts, rfis, submittals, equipment, warranties, subcontractors, commEvents]);

  const options: DataExportOptions = useMemo(() => ({
    projectId: scope === 'project' ? projectId : undefined,
    format,
    includePhotoUrls,
  }), [scope, projectId, format, includePhotoUrls]);

  const previewPayload = useMemo(() => buildExportPayload(allData, options), [allData, options]);

  const totals = useMemo(() => ({
    projects: previewPayload.projects.length,
    invoices: previewPayload.invoices.length,
    changeOrders: previewPayload.changeOrders.length,
    dailyReports: previewPayload.dailyReports.length,
    punchItems: previewPayload.punchItems.length,
    photos: previewPayload.photos.length,
    contacts: previewPayload.contacts.length,
    rfis: previewPayload.rfis.length,
    submittals: previewPayload.submittals.length,
  }), [previewPayload]);

  const handleGenerate = useCallback(async () => {
    if (scope === 'project' && !projectId) {
      Alert.alert('Pick a project', 'Select which project to export first.');
      return;
    }
    try {
      setGenerating(true);
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const result = await exportUserData(allData, options);
      setLastResult(result);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.fileUris.length === 1) {
        await shareExportedFile(result.fileUris[0], 'MAGE ID Data Export');
      } else {
        Alert.alert(
          'Export ready',
          `${summarizeExport(result)}\n\nTap a file below to share it.`,
        );
      }
    } catch (err) {
      console.error('[DataExport] failed', err);
      Alert.alert('Export failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setGenerating(false);
    }
  }, [allData, options, scope, projectId]);

  const handleShareOne = useCallback(async (uri: string) => {
    try {
      await shareExportedFile(uri, 'MAGE ID Data Export');
    } catch (err) {
      console.error('[DataExport] share failed', err);
    }
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}><FolderDown size={24} color={Colors.primary} /></View>
          <Text style={styles.heroTitle}>Export my data</Text>
          <Text style={styles.heroSub}>
            Bundle every project, invoice, RFI, photo, and daily report into a portable file you own.
            Hand it to your accountant, your lawyer, or a competing tool — no lock-in.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>SCOPE</Text>
        <View style={styles.segment}>
          <TouchableOpacity
            style={[styles.segmentBtn, scope === 'all' && styles.segmentBtnActive]}
            onPress={() => { setScope('all'); setProjectId(undefined); }}
            activeOpacity={0.8}
          >
            <Package size={14} color={scope === 'all' ? Colors.textOnPrimary : Colors.text} />
            <Text style={[styles.segmentTxt, scope === 'all' && styles.segmentTxtActive]}>All projects</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, scope === 'project' && styles.segmentBtnActive]}
            onPress={() => setScope('project')}
            activeOpacity={0.8}
          >
            <CheckCircle2 size={14} color={scope === 'project' ? Colors.textOnPrimary : Colors.text} />
            <Text style={[styles.segmentTxt, scope === 'project' && styles.segmentTxtActive]}>Single project</Text>
          </TouchableOpacity>
        </View>

        {scope === 'project' && (
          <View style={styles.projectList}>
            {projects.length === 0 ? (
              <Text style={styles.emptyTxt}>No projects yet — switch to &quot;All projects&quot; to export reference data only.</Text>
            ) : (
              projects.map(p => {
                const active = p.id === projectId;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.projectRow, active && styles.projectRowActive]}
                    onPress={() => setProjectId(p.id)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.projectRowName, active && styles.projectRowNameActive]}>{p.name}</Text>
                      <Text style={styles.projectRowMeta}>{p.type} · {p.location}</Text>
                    </View>
                    {active && <CheckCircle2 size={18} color={Colors.primary} />}
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}

        <Text style={styles.sectionLabel}>FORMAT</Text>
        <View style={styles.segment}>
          <TouchableOpacity
            style={[styles.segmentBtn, format === 'json' && styles.segmentBtnActive]}
            onPress={() => setFormat('json')}
            activeOpacity={0.8}
          >
            <FileJson size={14} color={format === 'json' ? Colors.textOnPrimary : Colors.text} />
            <Text style={[styles.segmentTxt, format === 'json' && styles.segmentTxtActive]}>JSON</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, format === 'csv' && styles.segmentBtnActive]}
            onPress={() => setFormat('csv')}
            activeOpacity={0.8}
          >
            <FileSpreadsheet size={14} color={format === 'csv' ? Colors.textOnPrimary : Colors.text} />
            <Text style={[styles.segmentTxt, format === 'csv' && styles.segmentTxtActive]}>CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, format === 'both' && styles.segmentBtnActive]}
            onPress={() => setFormat('both')}
            activeOpacity={0.8}
          >
            <Download size={14} color={format === 'both' ? Colors.textOnPrimary : Colors.text} />
            <Text style={[styles.segmentTxt, format === 'both' && styles.segmentTxtActive]}>Both</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hintCard}>
          <Info size={14} color={Colors.textSecondary} />
          <Text style={styles.hintTxt}>
            JSON is a single complete bundle (lossless). CSV is one file per entity, great for Excel and Google Sheets.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>OPTIONS</Text>
        <View style={styles.row}>
          <View style={styles.rowIcon}><ImageIcon size={16} color={Colors.primary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Include photo URLs</Text>
            <Text style={styles.rowSub}>Turn off if local file:// paths bloat the export.</Text>
          </View>
          <Switch
            value={includePhotoUrls}
            onValueChange={setIncludePhotoUrls}
            trackColor={{ false: Colors.border, true: Colors.primary }}
            thumbColor={Colors.surface}
          />
        </View>

        <Text style={styles.sectionLabel}>WHAT'S INCLUDED</Text>
        <View style={styles.summaryCard}>
          <SummaryLine label="Projects" value={totals.projects} />
          <SummaryLine label="Invoices" value={totals.invoices} />
          <SummaryLine label="Change Orders" value={totals.changeOrders} />
          <SummaryLine label="Daily Reports" value={totals.dailyReports} />
          <SummaryLine label="Punch Items" value={totals.punchItems} />
          <SummaryLine label="RFIs" value={totals.rfis} />
          <SummaryLine label="Submittals" value={totals.submittals} />
          <SummaryLine label="Photos" value={totals.photos} />
          <SummaryLine label="Contacts" value={totals.contacts} last />
        </View>

        {lastResult && (
          <>
            <Text style={styles.sectionLabel}>LAST EXPORT</Text>
            <View style={styles.resultCard}>
              <Text style={styles.resultHeader}>{summarizeExport(lastResult)}</Text>
              {lastResult.fileUris.map((uri) => {
                const name = uri.split('/').pop() ?? uri;
                return (
                  <TouchableOpacity
                    key={uri}
                    style={styles.fileRow}
                    onPress={() => handleShareOne(uri)}
                    activeOpacity={0.7}
                  >
                    {uri.endsWith('.csv')
                      ? <FileSpreadsheet size={16} color={Colors.primary} />
                      : <FileJson size={16} color={Colors.primary} />}
                    <Text style={styles.fileName} numberOfLines={1}>{name}</Text>
                    <Share2 size={14} color={Colors.textSecondary} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.primaryBtn, generating && styles.primaryBtnDisabled]}
          onPress={handleGenerate}
          disabled={generating}
          activeOpacity={0.85}
        >
          {generating ? (
            <ActivityIndicator color={Colors.textOnPrimary} />
          ) : (
            <>
              <Download size={18} color={Colors.textOnPrimary} />
              <Text style={styles.primaryBtnTxt}>Generate & share</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SummaryLine({ label, value, last }: { label: string; value: number; last?: boolean }) {
  return (
    <View style={[styles.summaryRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 0 },
  hero: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 20,
    gap: 10,
  },
  heroIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: `${Colors.primary}15`,
    alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  heroSub: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },

  sectionLabel: {
    fontSize: 11, fontWeight: '600', color: Colors.textSecondary,
    letterSpacing: 0.8, marginBottom: 8, marginTop: 20,
  },

  segment: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderRadius: 12, padding: 4, borderWidth: 1, borderColor: Colors.cardBorder,
    gap: 4,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 8, gap: 6,
  },
  segmentBtnActive: { backgroundColor: Colors.primary },
  segmentTxt: { fontSize: 13, fontWeight: '600', color: Colors.text },
  segmentTxtActive: { color: Colors.textOnPrimary },

  projectList: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
    marginTop: 8, overflow: 'hidden',
  },
  projectRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight,
  },
  projectRowActive: { backgroundColor: `${Colors.primary}08` },
  projectRowName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  projectRowNameActive: { color: Colors.primary },
  projectRowMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  emptyTxt: { fontSize: 13, color: Colors.textSecondary, padding: 14, textAlign: 'center' },

  hintCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: `${Colors.primary}08`, padding: 12,
    borderRadius: 10, marginTop: 8,
  },
  hintTxt: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface, borderRadius: 12,
    padding: 14, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  rowIcon: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: `${Colors.primary}12`,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  rowSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  summaryCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
  },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight,
  },
  summaryLabel: { fontSize: 14, color: Colors.text },
  summaryValue: { fontSize: 14, fontWeight: '700', color: Colors.text },

  resultCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder,
    padding: 14, gap: 10,
  },
  resultHeader: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 4 },
  fileRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 12,
    backgroundColor: Colors.background, borderRadius: 8,
  },
  fileName: { flex: 1, fontSize: 12, color: Colors.text, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },

  bottomBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 12,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnTxt: { color: Colors.textOnPrimary, fontWeight: '700', fontSize: 15 },
});

```


---

### `app/documents.tsx`

```tsx
import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  FileText, PenTool, ShieldCheck, FileSignature, Plus,
  AlertCircle, Check, Clock, X as XIcon, Eye,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_DOCUMENTS, DOCUMENT_TYPE_INFO } from '@/mocks/documents';
import type { ProjectDocument, DocumentStatus } from '@/types';

const STATUS_CONFIG: Record<DocumentStatus, { label: string; color: string; bgColor: string; icon: React.ElementType }> = {
  draft: { label: 'Draft', color: '#546E7A', bgColor: '#ECEFF1', icon: FileText },
  pending_signature: { label: 'Awaiting Signature', color: '#E65100', bgColor: '#FFF3E0', icon: PenTool },
  signed: { label: 'Signed', color: '#2E7D32', bgColor: '#E8F5E9', icon: Check },
  expired: { label: 'Expired', color: '#C62828', bgColor: '#FFEBEE', icon: AlertCircle },
  void: { label: 'Void', color: '#9E9E9E', bgColor: '#F5F5F5', icon: XIcon },
};

function DocumentCard({ doc, onPress }: { doc: ProjectDocument; onPress: () => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const typeInfo = DOCUMENT_TYPE_INFO[doc.type] ?? DOCUMENT_TYPE_INFO.other;
  const statusInfo = STATUS_CONFIG[doc.status];
  const StatusIcon = statusInfo.icon;

  const isExpiringSoon = doc.expiresAt && doc.status === 'signed' &&
    new Date(doc.expiresAt).getTime() - Date.now() < 30 * 86400000 &&
    new Date(doc.expiresAt).getTime() > Date.now();

  return (
    <Animated.View style={[styles.docCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.docCardInner}
      >
        <View style={[styles.docTypeTag, { backgroundColor: typeInfo.bgColor }]}>
          <Text style={[styles.docTypeTagText, { color: typeInfo.color }]}>{typeInfo.label}</Text>
        </View>

        <Text style={styles.docTitle} numberOfLines={2}>{doc.title}</Text>
        <Text style={styles.docProject}>{doc.projectName}</Text>

        {isExpiringSoon && (
          <View style={styles.expiryWarning}>
            <AlertCircle size={12} color="#E65100" />
            <Text style={styles.expiryWarningText}>
              Expires {new Date(doc.expiresAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </Text>
          </View>
        )}

        <View style={styles.docFooter}>
          <View style={[styles.docStatusBadge, { backgroundColor: statusInfo.bgColor }]}>
            <StatusIcon size={10} color={statusInfo.color} />
            <Text style={[styles.docStatusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
          <Text style={styles.docDate}>
            {new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const [documents] = useState<ProjectDocument[]>(MOCK_DOCUMENTS);
  const [selectedFilter, setSelectedFilter] = useState<string>('all');

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'pending_signature', label: 'Awaiting' },
    { id: 'draft', label: 'Drafts' },
    { id: 'signed', label: 'Signed' },
    { id: 'expired', label: 'Expired' },
  ];

  const filtered = useMemo(() => {
    if (selectedFilter === 'all') return documents;
    return documents.filter(d => d.status === selectedFilter);
  }, [documents, selectedFilter]);

  const stats = useMemo(() => ({
    total: documents.length,
    pending: documents.filter(d => d.status === 'pending_signature').length,
    signed: documents.filter(d => d.status === 'signed').length,
    expired: documents.filter(d => d.status === 'expired').length,
    expiringSoon: documents.filter(d => {
      if (!d.expiresAt || d.status !== 'signed') return false;
      const diff = new Date(d.expiresAt).getTime() - Date.now();
      return diff > 0 && diff < 30 * 86400000;
    }).length,
  }), [documents]);

  const handleDocPress = useCallback((doc: ProjectDocument) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (doc.status === 'draft') {
      Alert.alert(doc.title, 'Open document editor to complete and send for signature?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Edit Draft', onPress: () => console.log('[Documents] Edit draft:', doc.id) },
      ]);
    } else if (doc.status === 'pending_signature') {
      Alert.alert(doc.title, 'This document is waiting for signature. You can resend the signing request.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Resend', onPress: () => {
          Alert.alert('Sent', 'Signing request has been resent.');
        }},
      ]);
    } else {
      Alert.alert(doc.title, `Status: ${STATUS_CONFIG[doc.status].label}\n${doc.signedBy ? `Signed by: ${doc.signedBy}` : ''}`);
    }
  }, []);

  const handleCreateDocument = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      'Create Document',
      'What type of document would you like to create?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Lien Waiver', onPress: () => console.log('[Documents] Create lien waiver') },
        { text: 'Proposal', onPress: () => console.log('[Documents] Create proposal') },
        { text: 'Contract', onPress: () => console.log('[Documents] Create contract') },
      ]
    );
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Documents', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.alertsRow}>
          {stats.pending > 0 && (
            <View style={[styles.alertCard, { backgroundColor: '#FFF3E0', borderColor: '#FFE0B2' }]}>
              <PenTool size={16} color="#E65100" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertTitle, { color: '#E65100' }]}>{stats.pending} Awaiting Signature</Text>
                <Text style={styles.alertDesc}>Documents need attention</Text>
              </View>
            </View>
          )}
          {stats.expiringSoon > 0 && (
            <View style={[styles.alertCard, { backgroundColor: '#FFEBEE', borderColor: '#FFCDD2' }]}>
              <AlertCircle size={16} color="#C62828" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.alertTitle, { color: '#C62828' }]}>{stats.expiringSoon} Expiring Soon</Text>
                <Text style={styles.alertDesc}>COIs expiring within 30 days</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#E65100' }]}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#2E7D32' }]}>{stats.signed}</Text>
            <Text style={styles.statLabel}>Signed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#C62828' }]}>{stats.expired}</Text>
            <Text style={styles.statLabel}>Expired</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.createButton} onPress={handleCreateDocument} activeOpacity={0.85}>
          <Plus size={18} color="#fff" />
          <Text style={styles.createButtonText}>Create Document</Text>
        </TouchableOpacity>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {filters.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, selectedFilter === f.id && styles.filterChipActive]}
              onPress={() => {
                setSelectedFilter(f.id);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, selectedFilter === f.id && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.listSection}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <FileText size={32} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No documents found</Text>
            </View>
          ) : (
            filtered.map(doc => (
              <DocumentCard key={doc.id} doc={doc} onPress={() => handleDocPress(doc)} />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  alertsRow: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  alertTitle: { fontSize: 14, fontWeight: '600' as const },
  alertDesc: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingTop: 16,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  statValue: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textSecondary, marginTop: 2 },
  createButton: {
    marginHorizontal: 16,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 3,
  },
  createButtonText: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  filterRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  filterChipTextActive: { color: '#fff' },
  listSection: { paddingHorizontal: 16 },
  docCard: {
    marginBottom: 10,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  docCardInner: { padding: 14, gap: 6 },
  docTypeTag: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  docTypeTagText: { fontSize: 11, fontWeight: '600' as const },
  docTitle: { fontSize: 16, fontWeight: '600' as const, color: Colors.text },
  docProject: { fontSize: 13, color: Colors.textSecondary },
  expiryWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  expiryWarningText: { fontSize: 12, fontWeight: '500' as const, color: '#E65100' },
  docFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  docStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  docStatusText: { fontSize: 11, fontWeight: '600' as const },
  docDate: { fontSize: 12, color: Colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
});

```


---

### `utils/dataExport.ts`

```ts
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import type {
  Project, Invoice, ChangeOrder, DailyFieldReport, PunchItem, ProjectPhoto,
  Contact, RFI, Submittal, Equipment, Warranty, Subcontractor, CommunicationEvent,
} from '@/types';

// ──────────────────────────────────────────────────────────────────────────────
// One-click data export — the "kill lock-in" feature
// Competitors like Buildertrend make exporting your own data near-impossible.
// We bundle every entity the user owns into a portable, human-readable format
// they can hand off to any accountant, lawyer, or migration target.
// ──────────────────────────────────────────────────────────────────────────────

export interface DataExportPayload {
  projects: Project[];
  invoices: Invoice[];
  changeOrders: ChangeOrder[];
  dailyReports: DailyFieldReport[];
  punchItems: PunchItem[];
  photos: ProjectPhoto[];
  contacts: Contact[];
  rfis: RFI[];
  submittals: Submittal[];
  equipment: Equipment[];
  warranties: Warranty[];
  subcontractors: Subcontractor[];
  communications: CommunicationEvent[];
}

export interface DataExportOptions {
  projectId?: string;           // export a single project only
  format: 'json' | 'csv' | 'both';
  includePhotoUrls?: boolean;   // include photo URIs (large if local file:// paths)
}

export interface DataExportSummary {
  format: 'json' | 'csv' | 'both';
  projectCount: number;
  invoiceCount: number;
  coCount: number;
  dfrCount: number;
  punchCount: number;
  photoCount: number;
  contactCount: number;
  rfiCount: number;
  fileUris: string[];
  totalBytes: number;
}

// CSV escaping: wrap in quotes if contains comma, quote, or newline; double internal quotes.
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const headerLine = headers.map(csvCell).join(',');
  const bodyLines = rows.map(r => r.map(csvCell).join(',')).join('\n');
  return headerLine + '\n' + bodyLines + '\n';
}

function filterByProject<T extends { projectId?: string }>(items: T[], projectId?: string): T[] {
  if (!projectId) return items;
  return items.filter(i => i.projectId === projectId);
}

/**
 * Build the in-memory export payload.
 */
export function buildExportPayload(
  all: Partial<DataExportPayload>,
  opts: DataExportOptions,
): DataExportPayload {
  const projects = opts.projectId
    ? (all.projects ?? []).filter(p => p.id === opts.projectId)
    : (all.projects ?? []);

  const photosRaw = filterByProject(all.photos ?? [], opts.projectId);
  const photos = opts.includePhotoUrls === false
    ? photosRaw.map(p => ({ ...p, uri: '[omitted]' }))
    : photosRaw;

  return {
    projects,
    invoices: filterByProject(all.invoices ?? [], opts.projectId),
    changeOrders: filterByProject(all.changeOrders ?? [], opts.projectId),
    dailyReports: filterByProject(all.dailyReports ?? [], opts.projectId),
    punchItems: filterByProject(all.punchItems ?? [], opts.projectId),
    photos,
    contacts: all.contacts ?? [],
    rfis: filterByProject(all.rfis ?? [], opts.projectId),
    submittals: filterByProject(all.submittals ?? [], opts.projectId),
    equipment: all.equipment ?? [],
    warranties: filterByProject(all.warranties ?? [], opts.projectId),
    subcontractors: all.subcontractors ?? [],
    communications: filterByProject(all.communications ?? [], opts.projectId),
  };
}

/**
 * Convert the payload into a set of CSV strings (one per entity).
 */
export function payloadToCsvs(p: DataExportPayload): Record<string, string> {
  const csvs: Record<string, string> = {};

  csvs.projects = toCsv(
    ['id', 'name', 'type', 'location', 'squareFootage', 'quality', 'status', 'grandTotal', 'createdAt', 'updatedAt'],
    p.projects.map(pr => [
      pr.id, pr.name, pr.type, pr.location, pr.squareFootage, pr.quality,
      pr.status, pr.estimate?.grandTotal ?? '', pr.createdAt, pr.updatedAt,
    ]),
  );

  csvs.invoices = toCsv(
    ['id', 'number', 'projectId', 'type', 'issueDate', 'dueDate', 'paymentTerms', 'subtotal', 'taxAmount', 'totalDue', 'amountPaid', 'status', 'retentionPercent', 'retentionAmount'],
    p.invoices.map(i => [
      i.id, i.number, i.projectId, i.type, i.issueDate, i.dueDate, i.paymentTerms,
      i.subtotal, i.taxAmount, i.totalDue, i.amountPaid, i.status,
      i.retentionPercent ?? '', i.retentionAmount ?? '',
    ]),
  );

  csvs.changeOrders = toCsv(
    ['id', 'number', 'projectId', 'date', 'description', 'changeAmount', 'newContractTotal', 'status', 'scheduleImpactDays', 'createdAt'],
    p.changeOrders.map(c => [
      c.id, c.number, c.projectId, c.date, c.description, c.changeAmount,
      c.newContractTotal, c.status, c.scheduleImpactDays ?? '', c.createdAt,
    ]),
  );

  csvs.dailyReports = toCsv(
    ['id', 'projectId', 'date', 'status', 'weatherConditions', 'workPerformed', 'issuesAndDelays'],
    p.dailyReports.map(d => [
      d.id, d.projectId, d.date, d.status, d.weather?.conditions ?? '',
      d.workPerformed ?? '', d.issuesAndDelays ?? '',
    ]),
  );

  csvs.punchItems = toCsv(
    ['id', 'projectId', 'description', 'location', 'assignedSub', 'status', 'priority', 'createdAt'],
    p.punchItems.map(pi => [
      pi.id, pi.projectId, pi.description, pi.location ?? '', pi.assignedSub ?? '',
      pi.status, pi.priority ?? '', pi.createdAt ?? '',
    ]),
  );

  csvs.contacts = toCsv(
    ['id', 'firstName', 'lastName', 'email', 'phone', 'companyName', 'role'],
    p.contacts.map(c => [
      c.id, c.firstName, c.lastName, c.email ?? '', c.phone ?? '',
      c.companyName ?? '', c.role,
    ]),
  );

  csvs.rfis = toCsv(
    ['id', 'number', 'projectId', 'subject', 'status', 'priority', 'dateRequired', 'dateSubmitted'],
    p.rfis.map(r => [
      r.id, r.number, r.projectId, r.subject, r.status, r.priority ?? '',
      r.dateRequired ?? '', r.dateSubmitted ?? '',
    ]),
  );

  csvs.photos = toCsv(
    ['id', 'projectId', 'tag', 'timestamp', 'uri'],
    p.photos.map(ph => [
      ph.id, ph.projectId, ph.tag ?? '', ph.timestamp, ph.uri,
    ]),
  );

  return csvs;
}

/**
 * Perform the actual export: write files to cache, then share.
 */
export async function exportUserData(
  all: Partial<DataExportPayload>,
  opts: DataExportOptions,
): Promise<DataExportSummary> {
  const payload = buildExportPayload(all, opts);
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const projectSuffix = opts.projectId ? `-project-${opts.projectId.slice(0, 8)}` : '-all';
  const baseName = `mage-id-export${projectSuffix}-${timestamp}`;

  const fileUris: string[] = [];
  let totalBytes = 0;

  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new Error('No cache directory available on this platform.');

  if (opts.format === 'json' || opts.format === 'both') {
    const jsonUri = `${dir}${baseName}.json`;
    const jsonBody = JSON.stringify({
      exportedAt: new Date().toISOString(),
      exportedBy: 'MAGE ID',
      schemaVersion: 1,
      options: opts,
      ...payload,
    }, null, 2);
    if (Platform.OS !== 'web') {
      await FileSystem.writeAsStringAsync(jsonUri, jsonBody, { encoding: 'utf8' });
    }
    totalBytes += jsonBody.length;
    fileUris.push(jsonUri);
  }

  if (opts.format === 'csv' || opts.format === 'both') {
    const csvs = payloadToCsvs(payload);
    for (const [entity, body] of Object.entries(csvs)) {
      const csvUri = `${dir}${baseName}-${entity}.csv`;
      if (Platform.OS !== 'web') {
        await FileSystem.writeAsStringAsync(csvUri, body, { encoding: 'utf8' });
      }
      totalBytes += body.length;
      fileUris.push(csvUri);
    }
  }

  return {
    format: opts.format,
    projectCount: payload.projects.length,
    invoiceCount: payload.invoices.length,
    coCount: payload.changeOrders.length,
    dfrCount: payload.dailyReports.length,
    punchCount: payload.punchItems.length,
    photoCount: payload.photos.length,
    contactCount: payload.contacts.length,
    rfiCount: payload.rfis.length,
    fileUris,
    totalBytes,
  };
}

/**
 * Share one of the generated export files.
 */
export async function shareExportedFile(uri: string, title: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) return;
  const mimeType = uri.endsWith('.csv') ? 'text/csv' : 'application/json';
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
}

/**
 * Compact human-readable summary of the export payload size.
 */
export function summarizeExport(s: DataExportSummary): string {
  const sizeKb = (s.totalBytes / 1024).toFixed(1);
  const parts = [
    `${s.projectCount} projects`,
    `${s.invoiceCount} invoices`,
    `${s.coCount} change orders`,
    `${s.dfrCount} daily reports`,
    `${s.punchCount} punch items`,
    `${s.photoCount} photos`,
    `${s.contactCount} contacts`,
    `${s.rfiCount} RFIs`,
  ];
  return `${parts.join(' · ')} (${sizeKb} KB)`;
}

```


---

### `components/SignaturePad.tsx`

```tsx
import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  PanResponder,
  Text,
  TouchableOpacity,
  Platform,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Trash2, Check } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface SignaturePadProps {
  initialPaths?: string[];
  onSave: (paths: string[]) => void;
  onClear: () => void;
  width?: number;
  height?: number;
}

export default function SignaturePad({
  initialPaths,
  onSave,
  onClear,
  width = 300,
  height = 150,
}: SignaturePadProps) {
  const [paths, setPaths] = useState<string[]>(initialPaths ?? []);
  const [currentPath, setCurrentPath] = useState<string>('');
  const containerRef = useRef<View>(null);
  const offsetRef = useRef({ x: 0, y: 0 });

  const measureContainer = useCallback(() => {
    if (containerRef.current) {
      containerRef.current.measure((_x, _y, _w, _h, pageX, pageY) => {
        offsetRef.current = { x: pageX, y: pageY };
      });
    }
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        const touch = evt.nativeEvent;
        let x: number;
        let y: number;
        if (Platform.OS === 'web') {
          x = touch.locationX;
          y = touch.locationY;
        } else {
          x = touch.pageX - offsetRef.current.x;
          y = touch.pageY - offsetRef.current.y;
        }
        setCurrentPath(`M${x.toFixed(1)},${y.toFixed(1)}`);
      },
      onPanResponderMove: (evt) => {
        const touch = evt.nativeEvent;
        let x: number;
        let y: number;
        if (Platform.OS === 'web') {
          x = touch.locationX;
          y = touch.locationY;
        } else {
          x = touch.pageX - offsetRef.current.x;
          y = touch.pageY - offsetRef.current.y;
        }
        setCurrentPath(prev => `${prev} L${x.toFixed(1)},${y.toFixed(1)}`);
      },
      onPanResponderRelease: () => {
        setCurrentPath(prev => {
          if (prev.length > 0) {
            setPaths(old => [...old, prev]);
          }
          return '';
        });
      },
    })
  ).current;

  const handleClear = useCallback(() => {
    setPaths([]);
    setCurrentPath('');
    onClear();
  }, [onClear]);

  const handleSave = useCallback(() => {
    onSave(paths);
  }, [paths, onSave]);

  const hasPaths = paths.length > 0 || currentPath.length > 0;

  return (
    <View style={styles.container}>
      <View
        ref={containerRef}
        style={[styles.canvas, { width, height }]}
        onLayout={measureContainer}
        {...panResponder.panHandlers}
      >
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke="#1a1a1a"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {currentPath.length > 0 && (
            <Path
              d={currentPath}
              stroke="#1a1a1a"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </Svg>
        {!hasPaths && (
          <View style={styles.placeholder} pointerEvents="none">
            <Text style={styles.placeholderText}>Sign here</Text>
          </View>
        )}
        <View style={styles.signLine} pointerEvents="none" />
      </View>
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={handleClear}
          activeOpacity={0.7}
        >
          <Trash2 size={14} color={Colors.error} />
          <Text style={styles.clearBtnText}>Clear</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, !hasPaths && styles.saveBtnDisabled]}
          onPress={handleSave}
          activeOpacity={hasPaths ? 0.7 : 1}
          disabled={!hasPaths}
        >
          <Check size={14} color={hasPaths ? Colors.textOnPrimary : Colors.textMuted} />
          <Text style={[styles.saveBtnText, !hasPaths && styles.saveBtnTextDisabled]}>
            Save Signature
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  canvas: {
    backgroundColor: '#FAFAFA',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderStyle: 'dashed' as const,
    overflow: 'hidden' as const,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
  signLine: {
    position: 'absolute' as const,
    bottom: 30,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  clearBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.errorLight,
  },
  clearBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.error,
  },
  saveBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  saveBtnDisabled: {
    backgroundColor: Colors.fillTertiary,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textOnPrimary,
  },
  saveBtnTextDisabled: {
    color: Colors.textMuted,
  },
});

```


---

### `components/Tutorial.tsx`

```tsx
// In-app interactive tutorial — a guided walkthrough that actually gets
// users to tap, swipe and try things instead of just reading text.
//
// Triggered from Settings → "Show Tutorial". Also auto-opens once after
// first login via AsyncStorage key `mageid_tutorial_seen_v1`. Each step
// renders an interactive demo (tappable mock UI, drag target, quiz card,
// or a "Try it now" deep-link into the real app). The user has to perform
// the interaction to advance — that's the "interactive" part. Skip/close
// still works via the top-right X.
//
// Completing or skipping both persist the seen flag so we don't nag the
// user on every launch.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Animated, Easing, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  X, ChevronLeft, ChevronRight, Home, FileText, Calendar, DollarSign,
  Users, Sparkles, Gavel, Wrench, Camera, ClipboardCheck, Plus, CheckCircle2,
  LayoutDashboard, Target, ArrowRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';

export const TUTORIAL_SEEN_KEY = 'mageid_tutorial_seen_v1';

// ── Step definitions ───────────────────────────────────────────────────
// Each step has copy + an interactive demo. The demo component receives
// an onComplete callback that unlocks the "Next" button.

type DemoProps = { onComplete: () => void; completed: boolean };

interface TutorialStep {
  title: string;
  body: string;
  Icon: typeof Home;
  // Optional deep link — shown as a secondary "Try it live" button.
  deepLink?: string;
  // Interactive demo rendered above the body text.
  Demo: React.ComponentType<DemoProps>;
  // Instruction shown when the demo is not yet complete.
  instruction: string;
}

// --- Demos ------------------------------------------------------------

// Tap the "+" to create a project.
const TapPlusDemo: React.FC<DemoProps> = ({ onComplete, completed }) => {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (completed) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, completed]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  return (
    <View style={demoStyles.mockScreen}>
      <View style={demoStyles.mockHeader}>
        <Text style={demoStyles.mockHeaderText}>Projects</Text>
      </View>
      <View style={demoStyles.mockBody}>
        <View style={demoStyles.mockProjectRow}><Text style={demoStyles.mockProjectText}>Kitchen Remodel</Text></View>
        <View style={demoStyles.mockProjectRow}><Text style={demoStyles.mockProjectText}>Basement Finish</Text></View>
        <View style={demoStyles.mockEmpty}>
          <Text style={demoStyles.mockEmptyText}>Tap + to add a new project</Text>
        </View>
      </View>
      <View style={demoStyles.fabContainer}>
        {!completed && (
          <Animated.View
            style={[demoStyles.fabPulse, { transform: [{ scale }], opacity }]}
            pointerEvents="none"
          />
        )}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => {
            if (!completed) {
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onComplete();
            }
          }}
          style={[demoStyles.fab, completed && demoStyles.fabComplete]}
          testID="tutorial-demo-plus"
        >
          {completed ? <CheckCircle2 size={22} color="#FFF" /> : <Plus size={22} color="#FFF" />}
        </TouchableOpacity>
      </View>
    </View>
  );
};

// Generic "tap the highlighted thing" demo — used for tab selection.
function buildTapTarget(targetIdx: number, items: { label: string; Icon: typeof Home }[]): React.FC<DemoProps> {
  const Comp: React.FC<DemoProps> = ({ onComplete, completed }) => {
    const pulse = useRef(new Animated.Value(0)).current;
    useEffect(() => {
      if (completed) return;
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]));
      loop.start();
      return () => loop.stop();
    }, [pulse, completed]);
    const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.7] });

    return (
      <View style={demoStyles.mockScreen}>
        <View style={demoStyles.tabBar}>
          {items.map((item, i) => {
            const isTarget = i === targetIdx;
            const done = completed && isTarget;
            const Icon = item.Icon;
            return (
              <TouchableOpacity
                key={item.label}
                disabled={!isTarget || completed}
                onPress={() => {
                  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  onComplete();
                }}
                activeOpacity={0.8}
                style={demoStyles.tabItem}
                testID={`tutorial-tap-${item.label.toLowerCase()}`}
              >
                {isTarget && !completed && (
                  <Animated.View style={[demoStyles.tabHighlight, { opacity: pulseOpacity }]} />
                )}
                <Icon size={18} color={done ? Colors.success : isTarget ? Colors.primary : Colors.textMuted} />
                <Text style={[
                  demoStyles.tabLabel,
                  done && { color: Colors.success },
                  isTarget && !done && { color: Colors.primary, fontWeight: '700' },
                ]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={demoStyles.mockBody}>
          <View style={demoStyles.hintRow}>
            <Target size={14} color={Colors.primary} />
            <Text style={demoStyles.hintText}>
              {completed ? 'Nice — that\'s how you switch tabs.' : `Tap the "${items[targetIdx].label}" tab`}
            </Text>
          </View>
        </View>
      </View>
    );
  };
  return Comp;
}

// Swipe / drag-style demo — a mock Gantt bar. User drags it to fill the timeline.
const GanttDragDemo: React.FC<DemoProps> = ({ onComplete, completed }) => {
  const [progress, setProgress] = useState(0);
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fill, { toValue: progress, duration: 180, useNativeDriver: false }).start();
    if (progress >= 1 && !completed) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onComplete();
    }
  }, [progress, fill, completed, onComplete]);

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={demoStyles.mockScreen}>
      <Text style={demoStyles.mockLabel}>Mock Schedule — tap the segments to extend the bar</Text>
      <View style={demoStyles.ganttTrack}>
        <Animated.View style={[demoStyles.ganttFill, { width }]} />
        <View style={demoStyles.ganttSegments}>
          {[0, 1, 2, 3].map((i) => (
            <TouchableOpacity
              key={i}
              disabled={completed}
              style={demoStyles.ganttSegment}
              onPress={() => {
                const nextProgress = Math.min(1, (i + 1) / 4);
                if (nextProgress > progress) {
                  setProgress(nextProgress);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }
              }}
              activeOpacity={0.6}
              testID={`tutorial-gantt-${i}`}
            />
          ))}
        </View>
      </View>
      <View style={demoStyles.ganttLabels}>
        <Text style={demoStyles.ganttLabel}>Demo</Text>
        <Text style={demoStyles.ganttLabel}>Frame</Text>
        <Text style={demoStyles.ganttLabel}>Finish</Text>
        <Text style={demoStyles.ganttLabel}>Punch</Text>
      </View>
    </View>
  );
};

// Quiz-style: pick the correct option.
function buildQuizDemo(question: string, options: string[], correctIdx: number): React.FC<DemoProps> {
  const Comp: React.FC<DemoProps> = ({ onComplete, completed }) => {
    const [picked, setPicked] = useState<number | null>(null);

    return (
      <View style={demoStyles.mockScreen}>
        <Text style={demoStyles.quizQuestion}>{question}</Text>
        <View style={{ gap: 8 }}>
          {options.map((o, i) => {
            const isPicked = picked === i;
            const isCorrect = completed && i === correctIdx;
            const isWrong = isPicked && i !== correctIdx && picked !== null && !completed;
            return (
              <TouchableOpacity
                key={o}
                disabled={completed}
                onPress={() => {
                  setPicked(i);
                  if (i === correctIdx) {
                    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    onComplete();
                  } else {
                    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                  }
                }}
                style={[
                  demoStyles.quizOption,
                  isCorrect && demoStyles.quizOptionCorrect,
                  isWrong && demoStyles.quizOptionWrong,
                ]}
                activeOpacity={0.8}
                testID={`tutorial-quiz-${i}`}
              >
                <Text style={[
                  demoStyles.quizOptionText,
                  isCorrect && { color: Colors.success, fontWeight: '700' },
                  isWrong && { color: Colors.error },
                ]}>
                  {o}
                </Text>
                {isCorrect ? <CheckCircle2 size={16} color={Colors.success} /> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };
  return Comp;
}

// Success checkbox — auto-completes on tap. Used for the final "ready" step.
const TapToFinishDemo: React.FC<DemoProps> = ({ onComplete, completed }) => (
  <View style={demoStyles.mockScreen}>
    <TouchableOpacity
      onPress={() => {
        if (!completed) {
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onComplete();
        }
      }}
      activeOpacity={0.85}
      style={[demoStyles.finishBtn, completed && demoStyles.finishBtnDone]}
      testID="tutorial-finish-demo"
    >
      {completed ? (
        <>
          <CheckCircle2 size={28} color="#FFF" />
          <Text style={demoStyles.finishBtnText}>All set!</Text>
        </>
      ) : (
        <>
          <Wrench size={24} color="#FFF" />
          <Text style={demoStyles.finishBtnText}>I\u2019m ready</Text>
        </>
      )}
    </TouchableOpacity>
  </View>
);

// --- Steps ------------------------------------------------------------

const TAB_ITEMS = [
  { label: 'Summary', Icon: LayoutDashboard },
  { label: 'Projects', Icon: Home },
  { label: 'Discover', Icon: Sparkles },
  { label: 'Settings', Icon: Wrench },
];

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to MAGE ID',
    body: 'This interactive tour takes about a minute. Tap things as you go — we\u2019ll teach you by doing, not by reading.',
    Icon: Home,
    instruction: 'Tap the pulsing button below to begin',
    Demo: ({ onComplete, completed }) => (
      <View style={demoStyles.mockScreen}>
        <TouchableOpacity
          onPress={() => {
            if (!completed) {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              onComplete();
            }
          }}
          style={[demoStyles.startBtn, completed && demoStyles.startBtnDone]}
          activeOpacity={0.85}
          testID="tutorial-start"
        >
          {completed ? <CheckCircle2 size={22} color="#FFF" /> : <Sparkles size={22} color="#FFF" />}
          <Text style={demoStyles.startBtnText}>{completed ? 'Let\u2019s go' : 'Start the tour'}</Text>
        </TouchableOpacity>
      </View>
    ),
  },
  {
    title: 'Tabs are your home base',
    body: 'The bottom tab bar holds every top-level destination: Summary, your Projects, Discover (for finding work) and Settings.',
    Icon: LayoutDashboard,
    instruction: 'Tap the Summary tab in the mock below',
    Demo: buildTapTarget(0, TAB_ITEMS),
  },
  {
    title: 'Create a Project',
    body: 'Every build starts with a project. Tap the + to open the new-project sheet and add scope, location and budget.',
    Icon: FileText,
    instruction: 'Tap the + button to spin up a project',
    Demo: TapPlusDemo,
    deepLink: '/(tabs)/(home)',
  },
  {
    title: 'Build the Estimate',
    body: 'The Estimate tab tallies materials and labor. Pro tip: tap the Sparkles icon and describe your job — MAGE AI drafts the line items for you.',
    Icon: Sparkles,
    instruction: 'Pick the fastest way to build an estimate',
    Demo: buildQuizDemo(
      'You just scoped a kitchen remodel. What\u2019s the quickest way to estimate materials?',
      ['Type every SKU by hand', 'Tap the Sparkles icon and describe the job', 'Phone every supplier for quotes'],
      1,
    ),
    deepLink: '/(tabs)/discover/estimate',
  },
  {
    title: 'Schedule the Work',
    body: 'Drag tasks onto a Gantt timeline and the CPM engine finds the critical path — the chain of tasks that, if delayed, pushes your end date.',
    Icon: Calendar,
    instruction: 'Drag across the bar to schedule all four phases',
    Demo: GanttDragDemo,
    deepLink: '/(tabs)/discover/schedule',
  },
  {
    title: 'Track Cash Flow',
    body: 'Cash Flow Forecaster projects weekly balances so you can see crunches before they happen. Mix-in pending invoices and change orders for a real picture.',
    Icon: DollarSign,
    instruction: 'Which month will your cash position be tightest?',
    Demo: buildQuizDemo(
      'Your forecast shows: Jun +$12k, Jul -$3k, Aug +$8k. When should you chase invoices hardest?',
      ['June', 'July', 'August', 'It doesn\u2019t matter'],
      1,
    ),
    deepLink: '/cash-flow',
  },
  {
    title: 'Log a Daily Report',
    body: 'From the job site, log crew, weather, photos and progress in seconds. Share a snapshot link with the client or GC in one tap.',
    Icon: Camera,
    instruction: 'What belongs in a Daily Report?',
    Demo: buildQuizDemo(
      'What should you capture in a daily field report?',
      ['Only what went wrong', 'Crew, weather, progress + photos', 'Nothing — it\u2019s paperwork'],
      1,
    ),
  },
  {
    title: 'AI Code Check',
    body: 'Describe your project and Construction AI flags the likely codes, permits and common violations. A starting point, not legal advice — always confirm with your AHJ.',
    Icon: Gavel,
    instruction: 'Tap Construction AI in the mock nav',
    Demo: buildTapTarget(3, [
      { label: 'Projects', Icon: Home },
      { label: 'Estimate', Icon: Sparkles },
      { label: 'Hire', Icon: Users },
      { label: 'AI', Icon: Gavel },
    ]),
    deepLink: '/(tabs)/construction-ai',
  },
  {
    title: 'Closeout & Punch List',
    body: 'When a project wraps, generate a closeout packet, knock out punch items and send warranties + lien waivers straight from the project screen.',
    Icon: ClipboardCheck,
    instruction: 'Which item belongs on a punch list?',
    Demo: buildQuizDemo(
      'Which of these is a typical punch-list item?',
      ['Scratched countertop edge', 'Whole-house rewire', 'New foundation pour'],
      0,
    ),
  },
  {
    title: 'You\u2019re Ready',
    body: 'That\u2019s the core loop. Replay this tour anytime from Settings → Show Tutorial, and check the FAQ for deeper guides.',
    Icon: Wrench,
    instruction: 'Tap below to finish the tour',
    Demo: TapToFinishDemo,
  },
];

// ── Main component ────────────────────────────────────────────────────

interface TutorialProps {
  visible: boolean;
  onClose: () => void;
}

export default function Tutorial({ visible, onClose }: TutorialProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [index, setIndex] = useState(0);
  // Track which steps have had their demo completed so we can show a
  // green check on the progress indicator and enable Next.
  const [done, setDone] = useState<boolean[]>(() => STEPS.map(() => false));

  // Reset when the tutorial re-opens.
  useEffect(() => {
    if (visible) {
      setIndex(0);
      setDone(STEPS.map(() => false));
    }
  }, [visible]);

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;
  const isFirst = index === 0;
  const currentDone = done[index];

  const markDone = useCallback(() => {
    setDone((prev) => {
      if (prev[index]) return prev;
      const next = [...prev];
      next[index] = true;
      return next;
    });
  }, [index]);

  const finish = useCallback(async () => {
    try { await AsyncStorage.setItem(TUTORIAL_SEEN_KEY, '1'); } catch {}
    setIndex(0);
    setDone(STEPS.map(() => false));
    onClose();
  }, [onClose]);

  const next = useCallback(() => {
    if (!currentDone) return;
    if (isLast) { void finish(); return; }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }, [isLast, finish, currentDone]);

  const back = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const tryLive = useCallback(() => {
    if (!step.deepLink) return;
    void finish();
    setTimeout(() => router.push(step.deepLink as never), 150);
  }, [step.deepLink, finish, router]);

  const Demo = step.Demo;
  const StepIcon = step.Icon;

  const progress = useMemo(() => (index + 1) / STEPS.length, [index]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={finish}>
      <View style={[styles.container, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={finish} style={styles.closeBtn} testID="tutorial-close">
            <X size={22} color={Colors.textMuted} />
          </TouchableOpacity>
          <View style={styles.progressDots}>
            {STEPS.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  i === index && styles.progressDotActive,
                  done[i] && styles.progressDotDone,
                ]}
              />
            ))}
          </View>
          <Text style={styles.progressLabel}>{index + 1}/{STEPS.length}</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.iconWrap}>
            <StepIcon size={28} color={Colors.primary} />
          </View>
          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.body}>{step.body}</Text>

          <View style={styles.instructionRow}>
            {currentDone ? (
              <>
                <CheckCircle2 size={16} color={Colors.success} />
                <Text style={[styles.instructionText, { color: Colors.success }]}>Nice work — tap Next to continue</Text>
              </>
            ) : (
              <>
                <Target size={16} color={Colors.primary} />
                <Text style={styles.instructionText}>{step.instruction}</Text>
              </>
            )}
          </View>

          <Demo onComplete={markDone} completed={currentDone} />

          {step.deepLink ? (
            <TouchableOpacity
              onPress={tryLive}
              style={styles.deepLinkBtn}
              activeOpacity={0.8}
              testID="tutorial-deep-link"
            >
              <Text style={styles.deepLinkText}>Try it live in the app</Text>
              <ArrowRight size={14} color={Colors.primary} />
            </TouchableOpacity>
          ) : null}
        </ScrollView>

        <View style={styles.actions}>
          <TouchableOpacity
            onPress={back}
            disabled={isFirst}
            style={[styles.secondaryBtn, isFirst && styles.secondaryBtnDisabled]}
            activeOpacity={0.8}
            testID="tutorial-back"
          >
            <ChevronLeft size={18} color={isFirst ? Colors.textMuted : Colors.text} />
            <Text style={[styles.secondaryText, isFirst && { color: Colors.textMuted }]}>Back</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={next}
            disabled={!currentDone}
            style={[styles.primaryBtn, !currentDone && styles.primaryBtnDisabled]}
            activeOpacity={0.85}
            testID="tutorial-next"
          >
            <Text style={styles.primaryText}>{isLast ? 'Finish' : 'Next'}</Text>
            {!isLast ? <ChevronRight size={18} color="#FFF" /> : null}
          </TouchableOpacity>
        </View>

        {!isLast ? (
          <TouchableOpacity onPress={finish} activeOpacity={0.7} style={styles.skipRow}>
            <Text style={styles.skipText}>Skip tutorial</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Modal>
  );
}

export async function hasSeenTutorial(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(TUTORIAL_SEEN_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

// ── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 12,
    gap: 12,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: Colors.surface,
  },
  progressDots: {
    flex: 1,
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: 4,
  },
  progressDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.cardBorder,
  },
  progressDotActive: {
    backgroundColor: Colors.primary,
    width: 14,
  },
  progressDotDone: {
    backgroundColor: Colors.success,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    minWidth: 36,
    textAlign: 'right' as const,
  },
  progressTrack: {
    height: 3,
    backgroundColor: Colors.cardBorder,
    borderRadius: 2,
    overflow: 'hidden' as const,
    marginBottom: 16,
  },
  progressFill: {
    height: '100%' as const,
    backgroundColor: Colors.primary,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center' as const,
    paddingVertical: 8,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text,
    textAlign: 'center' as const,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center' as const,
    lineHeight: 20,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  instructionRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.primary + '10',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
    alignSelf: 'center' as const,
  },
  instructionText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  deepLinkBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    backgroundColor: Colors.surface,
  },
  deepLinkText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600' as const,
  },
  actions: {
    flexDirection: 'row' as const,
    gap: 12,
    marginBottom: 8,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  secondaryBtnDisabled: { opacity: 0.5 },
  secondaryText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  primaryBtn: {
    flex: 2,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  skipRow: {
    alignItems: 'center' as const,
    paddingVertical: 12,
  },
  skipText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
});

// ── Demo-specific styles ──────────────────────────────────────────────

const demoStyles = StyleSheet.create({
  mockScreen: {
    width: '100%' as const,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    padding: 14,
    minHeight: 180,
  },
  mockHeader: {
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
    marginBottom: 10,
  },
  mockHeaderText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  mockBody: {
    gap: 8,
  },
  mockProjectRow: {
    backgroundColor: Colors.fillTertiary,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  mockProjectText: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  mockEmpty: {
    paddingVertical: 16,
    alignItems: 'center' as const,
  },
  mockEmptyText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
  },
  mockLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 10,
    fontWeight: '500' as const,
  },
  fabContainer: {
    position: 'absolute' as const,
    right: 14,
    bottom: 14,
    width: 56,
    height: 56,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  fabPulse: {
    position: 'absolute' as const,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary + '55',
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  fabComplete: {
    backgroundColor: Colors.success,
  },
  tabBar: {
    flexDirection: 'row' as const,
    justifyContent: 'space-around' as const,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 12,
    padding: 8,
    marginBottom: 10,
  },
  tabItem: {
    alignItems: 'center' as const,
    gap: 2,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    position: 'relative' as const,
    minWidth: 56,
  },
  tabHighlight: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.primary + '30',
    borderRadius: 8,
  },
  tabLabel: {
    fontSize: 10,
    color: Colors.textMuted,
    fontWeight: '500' as const,
  },
  hintRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 8,
    justifyContent: 'center' as const,
  },
  hintText: {
    fontSize: 12,
    color: Colors.text,
  },
  ganttTrack: {
    height: 36,
    backgroundColor: Colors.fillSecondary,
    borderRadius: 8,
    overflow: 'hidden' as const,
    position: 'relative' as const,
    marginBottom: 6,
  },
  ganttFill: {
    position: 'absolute' as const,
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: Colors.primary,
    borderRadius: 8,
  },
  ganttSegments: {
    flexDirection: 'row' as const,
    height: '100%' as const,
  },
  ganttSegment: {
    flex: 1,
    height: '100%' as const,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.2)',
  },
  ganttLabels: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 2,
  },
  ganttLabel: {
    flex: 1,
    fontSize: 10,
    color: Colors.textMuted,
    textAlign: 'center' as const,
    fontWeight: '500' as const,
  },
  quizQuestion: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 10,
    lineHeight: 19,
  },
  quizOption: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  quizOptionCorrect: {
    borderColor: Colors.success,
    backgroundColor: Colors.success + '15',
  },
  quizOptionWrong: {
    borderColor: Colors.error,
    backgroundColor: Colors.error + '10',
  },
  quizOptionText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
  },
  startBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignSelf: 'center' as const,
  },
  startBtnDone: {
    backgroundColor: Colors.success,
  },
  startBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700' as const,
  },
  finishBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 28,
    alignSelf: 'center' as const,
  },
  finishBtnDone: {
    backgroundColor: Colors.success,
  },
  finishBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700' as const,
  },
});

```


---

### `components/PDFPreSendSheet.tsx`

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
  ScrollView, Platform, KeyboardAvoidingView, Pressable, Switch, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  X, FileText, Send, Mail, ChevronDown, ChevronUp, User, BookUser,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import ContactPickerModal from '@/components/ContactPickerModal';
import type { Contact, PDFNamingSettings } from '@/types';

export type PDFDocumentType = 'estimate' | 'invoice' | 'change_order' | 'schedule' | 'daily_report' | 'status_report' | 'closeout';

interface PDFSection {
  id: string;
  label: string;
  enabled: boolean;
}

interface PDFPreSendSheetProps {
  visible: boolean;
  onClose: () => void;
  onSend: (options: PDFSendOptions) => void;
  documentType: PDFDocumentType;
  projectName: string;
  documentNumber?: number;
  defaultRecipient?: string;
  sections?: PDFSection[];
  contacts?: Contact[];
  pdfNaming?: PDFNamingSettings;
  onPdfNumberUsed?: () => void;
}

export interface PDFSendOptions {
  fileName: string;
  recipient: string;
  message: string;
  sections: PDFSection[];
  method: 'share' | 'email';
}

function getDocTypeString(type: PDFDocumentType): string {
  switch (type) {
    case 'estimate': return 'Estimate';
    case 'invoice': return 'Invoice';
    case 'change_order': return 'Change Order';
    case 'schedule': return 'Schedule';
    case 'daily_report': return 'Daily Report';
    case 'status_report': return 'Status Report';
    case 'closeout': return 'Closeout';
    default: return 'Document';
  }
}

function getDefaultFileName(type: PDFDocumentType, projectName: string, docNumber?: number, pdfNaming?: PDFNamingSettings): string {
  if (pdfNaming?.enabled) {
    const sep = pdfNaming.separator;
    const parts: string[] = [];
    if (pdfNaming.prefix.trim()) parts.push(pdfNaming.prefix.trim());
    if (pdfNaming.includeProjectName) parts.push(projectName);
    if (pdfNaming.includeDocType) parts.push(getDocTypeString(type));
    if (pdfNaming.includeDate) {
      const now = new Date();
      parts.push(now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }
    const numStr = String(pdfNaming.nextNumber).padStart(3, '0');
    return parts.join(sep) + sep + numStr;
  }

  const now = new Date();
  const monthYear = now.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  switch (type) {
    case 'estimate':
      return `${projectName} - Estimate - ${monthYear}`;
    case 'invoice':
      return `${projectName} - Invoice #${docNumber ?? 1} - ${monthYear}`;
    case 'change_order':
      return `${projectName} - CO #${docNumber ?? 1} - ${monthYear}`;
    case 'schedule':
      return `${projectName} - Schedule - ${monthYear}`;
    case 'daily_report':
      return `${projectName} - Daily Report - ${dateStr}`;
    case 'status_report':
      return `${projectName} - Status Report - ${dateStr}`;
    case 'closeout':
      return `${projectName} - Closeout - ${monthYear}`;
    default:
      return `${projectName} - Document - ${monthYear}`;
  }
}

function getDefaultSections(type: PDFDocumentType): PDFSection[] {
  switch (type) {
    case 'estimate':
      return [
        { id: 'line_items', label: 'Line Items', enabled: true },
        { id: 'cost_summary', label: 'Cost Summary', enabled: true },
        { id: 'bulk_savings', label: 'Bulk Savings Breakdown', enabled: true },
        { id: 'schedule_summary', label: 'Schedule Summary', enabled: false },
        { id: 'branding', label: 'Company Branding', enabled: true },
      ];
    case 'invoice':
      return [
        { id: 'line_items', label: 'Line Items', enabled: true },
        { id: 'payment_terms', label: 'Payment Terms', enabled: true },
        { id: 'tax_breakdown', label: 'Tax Breakdown', enabled: true },
        { id: 'branding', label: 'Company Branding', enabled: true },
      ];
    case 'change_order':
      return [
        { id: 'original_scope', label: 'Original Scope', enabled: true },
        { id: 'changes', label: 'Changes & Line Items', enabled: true },
        { id: 'new_total', label: 'New Contract Total', enabled: true },
        { id: 'approval_status', label: 'Approval Status', enabled: true },
      ];
    case 'daily_report':
      return [
        { id: 'weather', label: 'Weather Conditions', enabled: true },
        { id: 'manpower', label: 'Manpower Log', enabled: true },
        { id: 'work_performed', label: 'Work Performed', enabled: true },
        { id: 'issues', label: 'Issues & Delays', enabled: true },
        { id: 'photos', label: 'Photos', enabled: true },
      ];
    default:
      return [
        { id: 'full_content', label: 'Full Content', enabled: true },
        { id: 'branding', label: 'Company Branding', enabled: true },
      ];
  }
}

function getDocTypeLabel(type: PDFDocumentType): string {
  switch (type) {
    case 'estimate': return 'Estimate';
    case 'invoice': return 'Invoice';
    case 'change_order': return 'Change Order';
    case 'schedule': return 'Schedule';
    case 'daily_report': return 'Daily Report';
    case 'status_report': return 'Status Report';
    case 'closeout': return 'Closeout Package';
    default: return 'Document';
  }
}

export default function PDFPreSendSheet({
  visible,
  onClose,
  onSend,
  documentType,
  projectName,
  documentNumber,
  defaultRecipient = '',
  sections: propSections,
  contacts,
  pdfNaming,
  onPdfNumberUsed,
}: PDFPreSendSheetProps) {
  const insets = useSafeAreaInsets();

  const [fileName, setFileName] = useState('');
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [recipientName, setRecipientName] = useState('');
  const [message, setMessage] = useState('');
  const [sections, setSections] = useState<PDFSection[]>([]);
  const [showSections, setShowSections] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setFileName(getDefaultFileName(documentType, projectName, documentNumber, pdfNaming));
      setRecipient(defaultRecipient);
      setRecipientName('');
      setMessage('');
      setSections(propSections ?? getDefaultSections(documentType));
      setShowSections(false);
      setShowContactPicker(false);
    }
  }, [visible, documentType, projectName, documentNumber, defaultRecipient, propSections, pdfNaming]);

  const toggleSection = useCallback((id: string) => {
    setSections(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handleSend = useCallback((method: 'share' | 'email') => {
    if (!fileName.trim()) {
      Alert.alert('Missing Name', 'Please enter a file name.');
      return;
    }
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSend({
      fileName: fileName.trim(),
      recipient: recipient.trim(),
      message: message.trim(),
      sections,
      method,
    });
    if (pdfNaming?.enabled && onPdfNumberUsed) {
      onPdfNumberUsed();
    }
  }, [fileName, recipient, message, sections, onSend, pdfNaming, onPdfNumberUsed]);

  const docLabel = useMemo(() => getDocTypeLabel(documentType), [documentType]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.overlay}>
          <Pressable style={styles.overlayTouch} onPress={onClose} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.handle} />

            <View style={styles.header}>
              <View>
                <Text style={styles.headerTitle}>Send {docLabel}</Text>
                <Text style={styles.headerSubtitle}>{projectName}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <X size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.body}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.fieldLabel}>FILE NAME</Text>
              <View style={styles.fileNameRow}>
                <FileText size={16} color={Colors.primary} />
                <TextInput
                  style={styles.fileNameInput}
                  value={fileName}
                  onChangeText={setFileName}
                  placeholder="Document name"
                  placeholderTextColor={Colors.textMuted}
                  testID="pdf-filename-input"
                />
                <Text style={styles.pdfExt}>.pdf</Text>
              </View>

              <Text style={styles.fieldLabel}>INCLUDE IN PDF</Text>
              <TouchableOpacity
                style={styles.sectionsToggle}
                onPress={() => setShowSections(!showSections)}
                activeOpacity={0.7}
              >
                <Text style={styles.sectionsToggleText}>
                  {sections.filter(s => s.enabled).length} of {sections.length} sections selected
                </Text>
                {showSections
                  ? <ChevronUp size={16} color={Colors.textSecondary} />
                  : <ChevronDown size={16} color={Colors.textSecondary} />
                }
              </TouchableOpacity>
              {showSections && (
                <View style={styles.sectionsList}>
                  {sections.map(section => (
                    <View key={section.id} style={styles.sectionRow}>
                      <Text style={styles.sectionLabel}>{section.label}</Text>
                      <Switch
                        value={section.enabled}
                        onValueChange={() => toggleSection(section.id)}
                        trackColor={{ false: Colors.fillTertiary, true: Colors.primary + '50' }}
                        thumbColor={section.enabled ? Colors.primary : Colors.textMuted}
                      />
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.fieldLabel}>RECIPIENT</Text>
              {recipientName ? (
                <View style={styles.selectedRecipient}>
                  <User size={14} color={Colors.primary} />
                  <View style={styles.selectedRecipientInfo}>
                    <Text style={styles.selectedRecipientName}>{recipientName}</Text>
                    <Text style={styles.selectedRecipientEmail}>{recipient}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => { setRecipient(''); setRecipientName(''); }}
                    style={styles.clearRecipientBtn}
                  >
                    <X size={12} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.recipientRow}>
                  <User size={16} color={Colors.textMuted} />
                  <TextInput
                    style={styles.recipientInput}
                    value={recipient}
                    onChangeText={setRecipient}
                    placeholder="client@email.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    testID="pdf-recipient-input"
                  />
                </View>
              )}
              {(contacts && contacts.length > 0) ? (
                <TouchableOpacity
                  style={styles.pickContactBtn}
                  onPress={() => setShowContactPicker(true)}
                  activeOpacity={0.7}
                  testID="pdf-pick-contact-btn"
                >
                  <BookUser size={14} color={Colors.primary} />
                  <Text style={styles.pickContactText}>Pick from Contacts</Text>
                </TouchableOpacity>
              ) : null}

              <Text style={styles.fieldLabel}>MESSAGE (OPTIONAL)</Text>
              <TextInput
                style={styles.messageInput}
                value={message}
                onChangeText={setMessage}
                placeholder="Add a note to the recipient..."
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
                testID="pdf-message-input"
              />

              <View style={{ height: 20 }} />
            </ScrollView>

            <View style={styles.footer}>
              {recipient.trim() ? (
                <TouchableOpacity
                  style={styles.emailBtn}
                  onPress={() => handleSend('email')}
                  activeOpacity={0.85}
                  testID="pdf-send-email-btn"
                >
                  <Mail size={16} color={Colors.textOnPrimary} />
                  <Text style={styles.emailBtnText}>Send via Email</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[styles.shareBtn, !recipient.trim() && styles.shareBtnFull]}
                onPress={() => handleSend('share')}
                activeOpacity={0.85}
                testID="pdf-share-btn"
              >
                <Send size={16} color={recipient.trim() ? Colors.primary : Colors.textOnPrimary} />
                <Text style={[styles.shareBtnText, !recipient.trim() && styles.shareBtnTextFull]}>
                  {recipient.trim() ? 'Share Sheet' : 'Generate & Share'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {contacts && contacts.length > 0 && (
        <ContactPickerModal
          visible={showContactPicker}
          onClose={() => setShowContactPicker(false)}
          contacts={contacts}
          title="Select Recipient"
          onSelect={(contact) => {
            const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
            setRecipient(contact.email);
            setRecipientName(name);
            setShowContactPicker(false);
          }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  overlayTouch: {
    flex: 1,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.fillTertiary,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: 22,
    paddingTop: 16,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 0.8,
    marginBottom: 6,
    marginTop: 14,
  },
  fileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  fileNameInput: {
    flex: 1,
    height: 48,
    fontSize: 15,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  pdfExt: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '600' as const,
  },
  sectionsToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  sectionsToggleText: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  sectionsList: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    marginTop: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  sectionLabel: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '500' as const,
  },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  recipientInput: {
    flex: 1,
    height: 48,
    fontSize: 15,
    color: Colors.text,
  },
  selectedRecipient: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary + '10',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.primary + '25',
  },
  selectedRecipientInfo: {
    flex: 1,
    gap: 1,
  },
  selectedRecipientName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  selectedRecipientEmail: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  clearRecipientBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.fillTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: Colors.primary + '10',
  },
  pickContactText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  messageInput: {
    minHeight: 80,
    backgroundColor: Colors.surfaceAlt,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  footer: {
    flexDirection: 'row',
    paddingHorizontal: 22,
    paddingTop: 12,
    gap: 10,
    borderTopWidth: 0.5,
    borderTopColor: Colors.borderLight,
  },
  emailBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
  },
  emailBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.textOnPrimary,
  },
  shareBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary + '12',
    borderRadius: 14,
    paddingVertical: 14,
  },
  shareBtnFull: {
    flex: 1,
    backgroundColor: Colors.primary,
  },
  shareBtnText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  shareBtnTextFull: {
    color: Colors.textOnPrimary,
  },
});

```
