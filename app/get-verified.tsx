// get-verified — contractor submits credentials for manual verification.
//
// Why this exists: "Verified pros only" RFPs are the trust layer that
// counters shared-lead-blasting (the #1 churn driver for Angi/Thumbtack).
// But there is no automated license-verification source — so verification
// is human-in-the-loop: a contractor submits their license here, it emails
// MAGE ID staff (support@mageid.app), and once reviewed a license row is
// created in contractor_licenses. The notify-nearby-contractors fan-out
// then treats that contractor as verified for verified-only RFPs.
//
// This screen ONLY submits the request (via the send-email edge function).
// Approval + the contractor_licenses insert happen on the MAGE ID side.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, ActivityIndicator, Image,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  ChevronLeft, ShieldCheck, Camera, X, CheckCircle2, AlertTriangle, Send,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCompanies } from '@/contexts/CompaniesContext';
import { sendEmail } from '@/utils/emailService';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Where verification submissions land for manual review. Kept in sync with
// OWNER_EMAILS (utils/owner.ts) — support@ is the staffed inbox.
const VERIFY_INBOX = 'support@mageid.app';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default function GetVerifiedScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { companies } = useCompanies();
  const company = useMemo(() => companies[0], [companies]);

  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseType, setLicenseType]     = useState('');
  const [jurisdiction, setJurisdiction]   = useState('');
  const [expires, setExpires]             = useState('');
  const [docUri, setDocUri]               = useState<string | null>(null);
  const [submitting, setSubmitting]       = useState(false);
  const [submitted, setSubmitted]         = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  const pickDocument = useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!res.canceled && res.assets?.[0]?.uri) setDocUri(res.assets[0].uri);
    } catch (e) {
      console.warn('[get-verified] pick failed', e);
    }
  }, []);

  const validate = useCallback((): string | null => {
    if (!licenseNumber.trim()) return 'Enter your license number.';
    if (!jurisdiction.trim()) return 'Enter the issuing state / jurisdiction.';
    return null;
  }, [licenseNumber, jurisdiction]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const v = validate();
    if (v) { setError(v); return; }
    if (!user) { setError('Sign in first.'); return; }

    setSubmitting(true);
    try {
      const companyName = company?.companyName ?? user.name ?? user.email ?? 'Unknown';
      const rows: [string, string][] = [
        ['Company', companyName],
        ['Submitted by', user.email ?? user.name ?? user.id],
        ['User ID', user.id],
        ['License #', licenseNumber.trim()],
        ['License type', licenseType.trim() || '—'],
        ['Jurisdiction', jurisdiction.trim()],
        ['Expires', expires.trim() || '—'],
        ['Document attached', docUri ? 'Yes' : 'No'],
      ];
      const html = `
        <h2 style="font-family:sans-serif;color:#2B3038;">Contractor verification request</h2>
        <table style="font-family:sans-serif;border-collapse:collapse;font-size:14px;">
          ${rows.map(([k, val]) =>
            `<tr><td style="padding:6px 14px 6px 0;color:#9AA3AD;">${escapeHtml(k)}</td>` +
            `<td style="padding:6px 0;color:#2B3038;font-weight:600;">${escapeHtml(val)}</td></tr>`,
          ).join('')}
        </table>
        <p style="font-family:sans-serif;font-size:12px;color:#9AA3AD;margin-top:16px;">
          Review and, if valid, add a row to contractor_licenses for user_id
          <code>${escapeHtml(user.id)}</code> so this contractor counts as verified
          for "Verified pros only" RFPs.
        </p>`;

      const res = await sendEmail({
        to: VERIFY_INBOX,
        subject: `Verification request — ${companyName}`,
        html,
        replyTo: user.email ?? undefined,
        attachments: docUri ? [docUri] : undefined,
      });
      if (!res.success) throw new Error(res.error ?? 'Send failed');

      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch (e) {
      console.warn('[get-verified] submit failed', e);
      setError(e instanceof Error ? e.message : 'Could not submit. Try again.');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  }, [validate, user, company, licenseNumber, licenseType, jurisdiction, expires, docUri]);

  if (submitted) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.successWrap}>
          <View style={styles.successIcon}><CheckCircle2 size={40} color={themeColors.success} strokeWidth={1.75} /></View>
          <Text style={styles.successTitle}>Request submitted</Text>
          <Text style={styles.successBody}>
            Our team will review your license and verify your account, usually within 1–2 business days.
            Once verified, you&apos;ll be eligible for &quot;Verified pros only&quot; projects.
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()} activeOpacity={0.85}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Trust & credibility</Text>
          <Text style={styles.title}>Get verified</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.pitch}>
          <View style={styles.pitchIcon}><ShieldCheck size={20} color={themeColors.success} strokeWidth={1.75} /></View>
          <Text style={styles.pitchText}>
            Verified pros win more work. Homeowners can post projects open only to verified
            contractors — submit your license and we&apos;ll review it.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>License number *</Text>
          <TextInput
            style={styles.input}
            value={licenseNumber}
            onChangeText={setLicenseNumber}
            placeholder="e.g. 1024567"
            placeholderTextColor={themeColors.textMuted}
            autoCapitalize="characters"
          />

          <Text style={[styles.label, { marginTop: 14 }]}>License type</Text>
          <TextInput
            style={styles.input}
            value={licenseType}
            onChangeText={setLicenseType}
            placeholder="e.g. General Contractor (B)"
            placeholderTextColor={themeColors.textMuted}
          />

          <Text style={[styles.label, { marginTop: 14 }]}>Issuing state / jurisdiction *</Text>
          <TextInput
            style={styles.input}
            value={jurisdiction}
            onChangeText={setJurisdiction}
            placeholder="e.g. California"
            placeholderTextColor={themeColors.textMuted}
          />

          <Text style={[styles.label, { marginTop: 14 }]}>Expiration date</Text>
          <TextInput
            style={styles.input}
            value={expires}
            onChangeText={setExpires}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={themeColors.textMuted}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>License document or photo</Text>
          <Text style={styles.helper}>Optional but speeds up review. A clear photo of your license card or certificate.</Text>
          {docUri ? (
            <View style={styles.docPreview}>
              <Image source={{ uri: docUri }} style={styles.docImage} resizeMode="cover" />
              <TouchableOpacity style={styles.docRemove} onPress={() => setDocUri(null)} hitSlop={8}>
                <X size={14} color="#FFF" strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.docPick} onPress={pickDocument} activeOpacity={0.85}>
              <Camera size={16} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.docPickText}>Add document</Text>
            </TouchableOpacity>
          )}
        </View>

        {error && (
          <View style={styles.errorCard}>
            <AlertTriangle size={16} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
          testID="get-verified-submit"
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Send size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.submitBtnText}>Submit for verification</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          We verify your license against public records. Submitting false credentials gets your account banned.
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },

  pitch: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: t.success + '0C', borderRadius: Tokens.radius.lg,
    padding: 14, borderWidth: 1, borderColor: t.success + '30', marginBottom: 12,
  },
  pitchIcon: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: t.success + '1A',
    alignItems: 'center', justifyContent: 'center',
  },
  pitchText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },

  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 12,
  },
  label: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  helper: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginBottom: 10, lineHeight: 16 },
  input: {
    backgroundColor: t.bg, borderWidth: 1, borderColor: t.line, borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: Type.bodyCompact.fontSize, color: t.text,
  },

  docPick: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.md,
    borderWidth: 1.5, borderColor: t.accent + '40', borderStyle: 'dashed',
    backgroundColor: t.accent + '08',
  },
  docPickText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },
  docPreview: { position: 'relative' },
  docImage: { width: '100%', height: 160, borderRadius: Tokens.radius.md, backgroundColor: t.bg },
  docRemove: {
    position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: t.danger + '0D', borderWidth: 1, borderColor: t.danger + '30', marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: Type.footnote.fontSize, color: t.danger, lineHeight: 18 },

  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: t.accent,
    shadowColor: t.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF', letterSpacing: 0.2 },
  disclaimer: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center', marginTop: 14, fontStyle: 'italic', paddingHorizontal: 16, lineHeight: 16 },

  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  successIcon: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: t.success + '15',
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  successTitle: { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text },
  successBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 320 },
  doneBtn: {
    marginTop: 12, paddingHorizontal: 32, paddingVertical: 13, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent,
  },
  doneBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '800', color: '#FFF' },
});
