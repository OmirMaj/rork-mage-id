// app/company-profile.tsx
//
// Dedicated edit screen for the GC's company branding + logo + signature.
// Previously these three sections lived inline on the main Settings page,
// which made Settings a long single-page form (the user's screenshot
// circled the whole branding block as something they wanted moved off
// the Settings root). This screen owns them now; Settings's profile
// hero is the entry point.
//
// All writes flow through ProjectContext.updateSettings → settings.branding,
// so anywhere else in the app that reads settings.branding (PDF estimates,
// portal-invite emails, etc.) keeps working with no other change.

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, Modal, Dimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  ChevronLeft, Building2, Type as TypeIcon, User, Phone, Mail,
  MapPin, Award, Image as ImageIcon, Camera, Trash2, PenTool, X,
  FileText, Save,
} from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useProjects } from '@/contexts/ProjectContext';
import SignaturePad from '@/components/SignaturePad';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function CompanyProfileScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { settings, updateSettings } = useProjects();

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

  // Logo + signature auto-save: when the user picks a logo or saves a
  // signature, we don't want them to also tap Save afterward. Branding
  // text fields still use the explicit Save button so a half-typed
  // company name doesn't get persisted partway through.
  const autoSave = useCallback((overrides: Partial<{ logo: string | undefined; sig: string[] | undefined }>) => {
    const newLogo = overrides.logo !== undefined ? overrides.logo : logoUri;
    const newSig  = overrides.sig  !== undefined ? overrides.sig  : signatureData;
    updateSettings({
      branding: {
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email:       brandingEmail.trim(),
        phone:       brandingPhone.trim(),
        address:     brandingAddress.trim(),
        licenseNumber: licenseNumber.trim(),
        tagline:     tagline.trim(),
        logoUri:     newLogo,
        signatureData: newSig,
      },
    });
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
        } else if (asset.uri) {
          newUri = asset.uri;
        }
        if (newUri) {
          setLogoUri(newUri);
          autoSave({ logo: newUri });
        }
      }
    } catch (e) {
      console.error('[CompanyProfile] Logo pick error:', e);
      showAlert('Error', 'Failed to pick image. Please try again.');
    }
  }, [autoSave]);

  const handleRemoveLogo = useCallback(() => {
    setLogoUri(undefined);
    autoSave({ logo: undefined });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [autoSave]);

  const handleSaveSignature = useCallback((paths: string[]) => {
    setSignatureData(paths);
    setShowSignatureModal(false);
    autoSave({ sig: paths });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Saved', 'Your signature has been saved.');
  }, [autoSave]);

  const handleClearSignature = useCallback(() => {
    setSignatureData(undefined);
    autoSave({ sig: undefined });
  }, [autoSave]);

  const handleSave = useCallback(() => {
    updateSettings({
      branding: {
        companyName: companyName.trim(),
        contactName: contactName.trim(),
        email:       brandingEmail.trim(),
        phone:       brandingPhone.trim(),
        address:     brandingAddress.trim(),
        licenseNumber: licenseNumber.trim(),
        tagline:     tagline.trim(),
        logoUri,
        signatureData,
      },
    });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert('Saved', 'Your company info has been updated.');
  }, [updateSettings, companyName, contactName, brandingEmail, brandingPhone, brandingAddress, licenseNumber, tagline, logoUri, signatureData]);

  const sigPadWidth = Math.min(SCREEN_WIDTH - 80, 340);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: themeColors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Stack.Screen
        options={{
          title: 'Company Profile',
          headerStyle: { backgroundColor: themeColors.bg },
          headerTintColor: themeColors.accent,
          headerTitleStyle: { fontWeight: '700', color: themeColors.text },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity onPress={handleSave} style={{ paddingHorizontal: 6 }} accessibilityRole="button" accessibilityLabel="Save">
              <Text style={{ color: themeColors.accent, fontWeight: '700', fontSize: Type.callout.fontSize }}>Save</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionHeader}>COMPANY BRANDING</Text>
        <Text style={styles.sectionSubtext}>
          This info appears on PDF estimates, invoices, and the client portal invite email.
        </Text>
        <View style={styles.group}>
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#1A6B3C' }]}>
              <Building2 size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Company Name</Text>
            <TextInput
              style={styles.inlineInput}
              value={companyName}
              onChangeText={setCompanyName}
              placeholder="Your Company LLC"
              placeholderTextColor={themeColors.textMuted}
              textAlign="right"
              testID="branding-company"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#5856D6' }]}>
              <TypeIcon size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Tagline</Text>
            <TextInput
              style={styles.inlineInput}
              value={tagline}
              onChangeText={setTagline}
              placeholder="Quality you can trust"
              placeholderTextColor={themeColors.textMuted}
              textAlign="right"
              testID="branding-tagline"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.info }]}>
              <User size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Contact Name</Text>
            <TextInput
              style={styles.inlineInput}
              value={contactName}
              onChangeText={setContactName}
              placeholder="John Smith"
              placeholderTextColor={themeColors.textMuted}
              textAlign="right"
              testID="branding-contact"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.success }]}>
              <Phone size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Phone</Text>
            <TextInput
              style={styles.inlineInput}
              value={brandingPhone}
              onChangeText={setBrandingPhone}
              placeholder="(555) 123-4567"
              placeholderTextColor={themeColors.textMuted}
              keyboardType="phone-pad"
              textAlign="right"
              testID="branding-phone"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
              <Mail size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Email</Text>
            <TextInput
              style={styles.inlineInput}
              value={brandingEmail}
              onChangeText={setBrandingEmail}
              placeholder="info@company.com"
              placeholderTextColor={themeColors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              textAlign="right"
              testID="branding-email"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: themeColors.danger }]}>
              <MapPin size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>Address</Text>
            <TextInput
              style={styles.inlineInput}
              value={brandingAddress}
              onChangeText={setBrandingAddress}
              placeholder="123 Main St, City"
              placeholderTextColor={themeColors.textMuted}
              textAlign="right"
              testID="branding-address"
            />
          </View>
          <View style={styles.rowSeparator} />
          <View style={styles.row}>
            <View style={[styles.iconWrap, { backgroundColor: '#AF52DE' }]}>
              <Award size={14} color="#fff" strokeWidth={1.75} />
            </View>
            <Text style={styles.rowLabel}>License #</Text>
            <TextInput
              style={styles.inlineInput}
              value={licenseNumber}
              onChangeText={setLicenseNumber}
              placeholder="GC-12345"
              placeholderTextColor={themeColors.textMuted}
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
              <Image source={{ uri: logoUri }} style={styles.logoPreview} contentFit="contain" />
              <View style={styles.logoActions}>
                <TouchableOpacity style={styles.logoChangeBtn} onPress={handlePickLogo} activeOpacity={0.7}>
                  <Camera size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.logoChangeBtnText}>Change</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.logoRemoveBtn} onPress={handleRemoveLogo} activeOpacity={0.7}>
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                  <Text style={styles.logoRemoveBtnText}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity style={styles.logoUploadRow} onPress={handlePickLogo} activeOpacity={0.7} testID="upload-logo">
              <View style={[styles.iconWrap, { backgroundColor: '#5856D6' }]}>
                <ImageIcon size={14} color="#fff" strokeWidth={1.75} />
              </View>
              <Text style={styles.rowLabel}>Upload Logo</Text>
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
                  <PenTool size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.signatureSavedText}>Signature saved ({signatureData.length} strokes)</Text>
                </View>
              </View>
              <View style={styles.signatureActions}>
                <TouchableOpacity
                  style={styles.signatureRedrawBtn}
                  onPress={() => setShowSignatureModal(true)}
                  activeOpacity={0.7}
                >
                  <PenTool size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.signatureRedrawBtnText}>Redraw</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.signatureRemoveBtn}
                  onPress={() => {
                    setSignatureData(undefined);
                    autoSave({ sig: undefined });
                    if (Platform.OS !== 'web') void Haptics.selectionAsync();
                  }}
                  activeOpacity={0.7}
                >
                  <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
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
              <View style={[styles.iconWrap, { backgroundColor: themeColors.info }]}>
                <PenTool size={14} color="#fff" strokeWidth={1.75} />
              </View>
              <Text style={styles.rowLabel}>Draw Signature</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.pdfPreviewNote}>
          <FileText size={14} color={themeColors.info} strokeWidth={1.75} />
          <Text style={styles.pdfPreviewNoteText}>
            Your company info, logo, and signature appear on every PDF estimate, invoice, and the client-portal invite email.
          </Text>
        </View>

        {/* Inline Save button at the bottom too — duplicate of the header
            action so a long page doesn't force the user to scroll back up
            to the headerRight to save. */}
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.85} testID="company-profile-save">
          <Save size={16} color="#fff" strokeWidth={1.75} />
          <Text style={styles.saveButtonText}>Save Company Info</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={showSignatureModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSignatureModal(false)}
      >
        <View style={styles.sigModalOverlay}>
          <View style={styles.sigModalCard}>
            <View style={styles.sigModalHeader}>
              <Text style={styles.sigModalTitle}>Draw Your Signature</Text>
              <TouchableOpacity onPress={() => setShowSignatureModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
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
    </KeyboardAvoidingView>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  sectionHeader: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.textMuted,
    letterSpacing: 0.8,
    marginTop: 22,
    marginBottom: 6,
    marginHorizontal: 20,
  },
  sectionSubtext: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    marginHorizontal: 20,
    marginBottom: 10,
    lineHeight: 17,
  },
  group: {
    marginHorizontal: 16,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.line,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
  },
  rowSeparator: { height: 1, backgroundColor: t.line, marginLeft: 50 },
  rowLabel: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '500' as const, minWidth: 110 },
  iconWrap: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  inlineInput: {
    flex: 1, fontSize: Type.bodyCompact.fontSize, color: t.text, paddingVertical: 0,
  },
  logoPreviewContainer: { padding: 16, gap: 14, alignItems: 'center' as const },
  logoPreview: { width: 220, height: 100, borderRadius: 10, backgroundColor: t.surfaceAlt },
  logoActions: { flexDirection: 'row' as const, gap: 10 },
  logoChangeBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '14',
  },
  logoChangeBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accent },
  logoRemoveBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.danger + '14',
  },
  logoRemoveBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.danger },
  logoUploadRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  signaturePreviewContainer: { padding: 16, gap: 14 },
  signaturePreviewBox: { borderRadius: 10, backgroundColor: t.surfaceAlt, padding: 14 },
  signaturePreviewLabel: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginBottom: 6, fontWeight: '600' as const },
  signatureMiniPreview: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  signatureSavedText: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const },
  signatureActions: { flexDirection: 'row' as const, gap: 10 },
  signatureRedrawBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '14',
  },
  signatureRedrawBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accent },
  signatureRemoveBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.danger + '14',
  },
  signatureRemoveBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.danger },
  signatureDrawRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 14, paddingVertical: 14, gap: 12 },
  pdfPreviewNote: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
    backgroundColor: t.info + '10',
    borderRadius: Tokens.radius.md,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 18,
    borderWidth: 1, borderColor: t.info + '24',
  },
  pdfPreviewNoteText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 18 },
  saveButton: {
    marginHorizontal: 16, marginTop: 24,
    paddingVertical: 14,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
  },
  saveButtonText: { color: '#fff', fontSize: Type.callout.fontSize, fontWeight: '700' as const },
  sigModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' as const },
  sigModalCard: {
    backgroundColor: t.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 40,
  },
  sigModalHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 6 },
  sigModalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  sigModalDesc: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, marginBottom: 16, lineHeight: 19 },
});
