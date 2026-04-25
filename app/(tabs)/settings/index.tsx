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
import { LogOut, UserCircle, Eye, EyeOff, FolderDown, Wallet } from 'lucide-react-native';
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
            <View style={[styles.iconWrap, { backgroundColor: Colors.success }]}>
              <Wallet size={14} color="#fff" />
            </View>
            <Text style={[styles.rowLabel, { flex: 1 }]}>Set up payments</Text>
            <ChevronRight size={16} color={Colors.textMuted} />
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
