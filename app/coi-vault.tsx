// COI Vault — per-subcontractor Certificate of Insurance management.
//
// One screen, two modes:
//   - List mode: shows all subs with their COI status (valid / expiring /
//     expired / missing endorsement). Tap a sub to drill in.
//   - Detail mode: per-sub list of COIs uploaded, validation findings,
//     coverages extracted, and an upload button.
//
// AI validation uses the existing analyze-photos edge function with a
// 'coi' task. If the server doesn't yet support that task, the
// validator falls back to a "needs manual review" result so the
// upload still succeeds — the GC can fill the structured fields by hand.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, ActivityIndicator,
} from 'react-native';
// expo-image: COI viewer displays full-page certificate scans.
// Migrated from RN Image so the disk cache survives across screen
// pops — the GC reopens the same COI repeatedly.
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import {
  ChevronLeft, Shield, ShieldCheck, ShieldAlert, ShieldX, Plus,
  Sparkles, Upload, Trash2, AlertTriangle, CheckCircle2, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { FeatureHeader } from '@/components/FeatureHeader';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import { validateCOIImage, recomputeValidation } from '@/utils/coiValidator';
import type { CertificateOfInsurance, COIValidationResult, Subcontractor } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function COIVaultScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('rfis_submittals')) {
    return (
      <Paywall
        visible={true}
        feature="COI Vault & Insurance Validator"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <COIVaultInner />;
}

function COIVaultInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { subId: initialSubId } = useLocalSearchParams<{ subId?: string }>();
  const ctx = useProjects() as any;
  const subcontractors: Subcontractor[] = ctx.subcontractors ?? [];
  const cois: CertificateOfInsurance[] = ctx.cois ?? [];

  const [activeSubId, setActiveSubId] = useState<string | null>(initialSubId ?? null);
  const [validating, setValidating] = useState(false);

  const activeSub = useMemo(() => subcontractors.find(s => s.id === activeSubId), [activeSubId, subcontractors]);
  const subCOIs = useMemo(() => cois.filter(c => c.subcontractorId === activeSubId), [cois, activeSubId]);

  // Compliance summary across all subs — drives the top-of-list banner.
  // Three tiers of urgency: expired (action required NOW), expiring within
  // 30 days (action this month), missing entirely (sub on the project but
  // no COI uploaded). The banner is the single most important affordance
  // on this screen — bonded jobs require active COIs and a stale one is
  // a real liability.
  const complianceSummary = useMemo(() => {
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
    let expired = 0;
    let expiringSoon = 0;
    let missing = 0;
    for (const sub of subcontractors) {
      const subC = cois.filter(c => c.subcontractorId === sub.id);
      if (subC.length === 0) {
        missing += 1;
        continue;
      }
      // Pick most recent COI for this sub
      const latest = [...subC].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
      // Earliest expiry across the COI's coverages drives compliance — if any
      // single policy has lapsed, the sub isn't covered for that line.
      const expiryMs = (latest.coverages ?? [])
        .map(c => c.expiresAt ? Date.parse(c.expiresAt) : NaN)
        .filter(ms => Number.isFinite(ms))
        .reduce<number | null>((min, ms) => min == null || ms < min ? ms : min, null);
      if (expiryMs == null) continue;
      if (expiryMs < now) expired += 1;
      else if (expiryMs - now < THIRTY_DAYS) expiringSoon += 1;
    }
    return { expired, expiringSoon, missing };
  }, [subcontractors, cois]);

  // ── Status rollup per sub for the list view ─────────────────
  const subStatus = useMemo(() => {
    const m = new Map<string, { worst: 'pass' | 'warn' | 'fail' | 'none'; latest?: CertificateOfInsurance }>();
    for (const sub of subcontractors) {
      const subC = cois.filter(c => c.subcontractorId === sub.id);
      if (subC.length === 0) {
        m.set(sub.id, { worst: 'none' });
        continue;
      }
      // Pick the most recent COI as the "current" one for the row
      const latest = subC.slice().sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
      const v = latest.validation;
      if (!v) {
        m.set(sub.id, { worst: 'warn', latest });
      } else {
        m.set(sub.id, { worst: v.overallStatus, latest });
      }
    }
    return m;
  }, [subcontractors, cois]);

  // ── Upload + AI validate ────────────────────────────────────
  const handleUpload = useCallback(async () => {
    if (!activeSub) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) return;

      const uri = result.assets[0].uri;
      // Optimistically save the COI without validation. AI runs next.
      const newCoi: CertificateOfInsurance = {
        id: generateUUID(),
        subcontractorId: activeSub.id,
        fileUri: uri,
        uploadedAt: new Date().toISOString(),
      };
      ctx.addCOI?.(newCoi);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Now run AI validation (best-effort)
      setValidating(true);
      try {
        const { coverages, validation } = await validateCOIImage(uri);
        ctx.updateCOI?.(newCoi.id, { coverages, validation });
      } catch (err) {
        console.warn('[COI] AI validation failed (saved without):', err);
      } finally {
        setValidating(false);
      }
    } catch (err) {
      console.error('[COI] Upload failed:', err);
      Alert.alert('Upload failed', err instanceof Error ? err.message : 'Try again.');
    }
  }, [activeSub, ctx]);

  const handleDeleteCoi = useCallback((id: string) => {
    Alert.alert(
      'Delete this COI?',
      'This removes the file from the vault. The sub still exists.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => ctx.deleteCOI?.(id) },
      ],
    );
  }, [ctx]);

  // Detail mode
  if (activeSub) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.detailHeader}>
          <TouchableOpacity onPress={() => setActiveSubId(null)} hitSlop={10} style={styles.headerBack}>
            <ChevronLeft size={22} color={Colors.primary} />
            <Text style={styles.headerBackText}>All subs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.uploadBtn, validating && styles.btnDisabled]}
            onPress={handleUpload}
            disabled={validating}
            testID="coi-upload"
          >
            {validating
              ? <ActivityIndicator size="small" color="#fff" />
              : <><Upload size={14} color="#fff" /><Text style={styles.uploadBtnText}>Upload COI</Text></>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{ padding: Tokens.spacing.md, paddingBottom: insets.bottom + 30 }}>
          <View style={styles.titleBlock}>
            <Text style={styles.eyebrow}>Insurance vault</Text>
            <Text style={styles.title}>{activeSub.companyName}</Text>
            <Text style={styles.subtitle}>{subCOIs.length} certificate{subCOIs.length === 1 ? '' : 's'} on file</Text>
          </View>

          {subCOIs.length === 0 ? (
            <View style={styles.emptyState}>
              <Shield size={36} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No COIs yet</Text>
              <Text style={styles.emptyBody}>
                Upload the sub's Certificate of Insurance — MAGE ID will read the dates,
                check for the additional-insured endorsement, and flag anything missing.
              </Text>
            </View>
          ) : subCOIs.map(coi => <COICard key={coi.id} coi={coi} onDelete={() => handleDeleteCoi(coi.id)} onUpdate={(patch) => ctx.updateCOI?.(coi.id, patch)} />)}
        </ScrollView>
      </View>
    );
  }

  // List mode
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Sub Insurance' }} />
      <FeatureHeader
        eyebrow="COI Tracker"
        title="Make sure your subs are insured"
        subtitle="Every sub on your jobsite needs to prove they're covered. Upload their certificate; we read it, flag what's missing, and remind you 30 days before it expires."
        explainer={{
          term: 'Certificate of Insurance (COI)',
          definition: 'A COI is a one-page document a subcontractor\'s insurer issues showing what coverage the sub carries — General Liability, Workers\' Comp, Auto, sometimes specialty endorsements like "Additional Insured" naming you. If a sub causes damage or injury and isn\'t insured, it can come back on you.',
          whenToUse: [
            'Before letting a sub start work on your site',
            'Annually when each sub\'s policy renews',
            'When the project owner or your bond requires proof',
          ],
        }}
      />
      {/* Compliance banner — only renders when there's something to act on.
          Three urgency lanes (expired / expiring / missing) shown as colored
          pills so the GC can scan and decide where to spend the next 5min. */}
      {(complianceSummary.expired > 0 || complianceSummary.expiringSoon > 0 || complianceSummary.missing > 0) && (
        <View style={styles.complianceBanner}>
          <AlertTriangle size={16} color={complianceSummary.expired > 0 ? Colors.error : Colors.warning} strokeWidth={2.4} />
          <View style={{ flex: 1 }}>
            <Text style={styles.complianceBannerTitle}>
              {complianceSummary.expired > 0 ? 'Action required' : 'Heads up'}
            </Text>
            <View style={styles.complianceBannerPillRow}>
              {complianceSummary.expired > 0 && (
                <View style={[styles.compliancePill, { backgroundColor: Colors.errorLight }]}>
                  <Text style={[styles.compliancePillText, { color: Colors.error }]}>
                    {complianceSummary.expired} expired
                  </Text>
                </View>
              )}
              {complianceSummary.expiringSoon > 0 && (
                <View style={[styles.compliancePill, { backgroundColor: Colors.warningLight }]}>
                  <Text style={[styles.compliancePillText, { color: Colors.warning }]}>
                    {complianceSummary.expiringSoon} expiring &lt;30d
                  </Text>
                </View>
              )}
              {complianceSummary.missing > 0 && (
                <View style={[styles.compliancePill, { backgroundColor: Colors.fillTertiary }]}>
                  <Text style={[styles.compliancePillText, { color: Colors.textSecondary }]}>
                    {complianceSummary.missing} no COI on file
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      <View style={styles.listHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.subtitle}>{subcontractors.length} sub{subcontractors.length === 1 ? '' : 's'} tracked</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: Tokens.spacing.md, paddingBottom: insets.bottom + 30 }}>
        {subcontractors.length === 0 ? (
          <View style={styles.emptyState}>
            <Shield size={36} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No subs yet</Text>
            <Text style={styles.emptyBody}>
              Add subs from the Subcontractors screen first, then come back here to upload their COIs.
            </Text>
          </View>
        ) : (
          subcontractors.map(sub => {
            const stat = subStatus.get(sub.id) ?? { worst: 'none' as const };
            const { Icon, color, label } = statusToVisuals(stat.worst);
            return (
              <TouchableOpacity
                key={sub.id}
                style={styles.subRow}
                onPress={() => setActiveSubId(sub.id)}
                activeOpacity={0.7}
                testID={`coi-sub-${sub.id}`}
              >
                <View style={[styles.subStatusIcon, { backgroundColor: color + '15' }]}>
                  <Icon size={18} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subName}>{sub.companyName}</Text>
                  <Text style={styles.subMeta}>
                    {sub.trade}{stat.latest ? ` · last upload ${new Date(stat.latest.uploadedAt).toLocaleDateString()}` : ' · no COI on file'}
                  </Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: color + '20' }]}>
                  <Text style={[styles.statusPillText, { color }]}>{label}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

// ── Per-COI card (detail view) ──────────────────────────────────

function COICard({
  coi,
  onDelete,
  onUpdate,
}: {
  coi: CertificateOfInsurance;
  onDelete: () => void;
  onUpdate: (patch: Partial<CertificateOfInsurance>) => void;
}) {
  const v = coi.validation;
  const { Icon, color, label } = statusToVisuals(v?.overallStatus ?? 'warn');
  return (
    <View style={styles.coiCard}>
      <View style={styles.coiHeader}>
        <View style={[styles.coiStatusIcon, { backgroundColor: color + '15' }]}>
          <Icon size={16} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.coiTitle}>Certificate uploaded {new Date(coi.uploadedAt).toLocaleDateString()}</Text>
          <Text style={styles.coiMeta}>{label}{v?.confidence != null ? ` · AI confidence ${v.confidence}%` : ''}</Text>
        </View>
        <TouchableOpacity onPress={onDelete} hitSlop={6} style={styles.deleteBtn} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={14} color={Colors.error} /></TouchableOpacity>
      </View>

      {coi.fileUri ? (
        <Image source={{ uri: coi.fileUri }} style={styles.coiImage} contentFit="contain" />
      ) : null}

      {/* Validation findings */}
      {v?.issues && v.issues.length > 0 ? (
        <View style={styles.findingsCard}>
          <Text style={styles.findingsLabel}>Findings</Text>
          {v.issues.map((iss, i) => {
            const sevColor = iss.severity === 'critical' ? Colors.error
                            : iss.severity === 'warning' ? Colors.warning
                            : Colors.textSecondary;
            return (
              <View key={i} style={styles.findingRow}>
                <View style={[styles.findingDot, { backgroundColor: sevColor }]} />
                <Text style={styles.findingText}>{iss.message}</Text>
              </View>
            );
          })}
        </View>
      ) : v?.overallStatus === 'pass' ? (
        <View style={[styles.findingsCard, { borderColor: Colors.success + '30' }]}>
          <Text style={[styles.findingsLabel, { color: Colors.success }]}>All required checks passed</Text>
          <Text style={styles.findingText}>Additional insured + waiver of subrogation present, coverage in date.</Text>
        </View>
      ) : null}

      {/* Coverages — extracted by AI or entered manually */}
      {coi.coverages && coi.coverages.length > 0 ? (
        <View style={styles.coveragesCard}>
          <Text style={styles.findingsLabel}>Coverages</Text>
          {coi.coverages.map((c, i) => (
            <View key={i} style={styles.coverageRow}>
              <Text style={styles.coverageType}>{humanizeCoverage(c.type)}</Text>
              <Text style={styles.coverageMeta}>
                {c.policyNumber ? `#${c.policyNumber}` : '—'}
                {c.expiresAt ? ` · expires ${c.expiresAt}` : ''}
                {c.eachOccurrence ? ` · $${c.eachOccurrence.toLocaleString()}/occ` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Notes */}
      <Text style={styles.notesLabel}>Notes</Text>
      <TextInput
        style={styles.notesInput}
        value={coi.notes ?? ''}
        onChangeText={t => onUpdate({ notes: t })}
        placeholder="Anything specific about this COI..."
        placeholderTextColor={Colors.textMuted}
        multiline
      />
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function statusToVisuals(s: 'pass' | 'warn' | 'fail' | 'none'): {
  Icon: typeof Shield;
  color: string;
  label: string;
} {
  switch (s) {
    case 'pass': return { Icon: ShieldCheck, color: Colors.success,        label: 'Valid' };
    case 'warn': return { Icon: ShieldAlert, color: Colors.warning,        label: 'Review needed' };
    case 'fail': return { Icon: ShieldX,     color: Colors.error,          label: 'Action required' };
    case 'none':
    default:     return { Icon: Shield,      color: Colors.textMuted,      label: 'No COI' };
  }
}

function humanizeCoverage(t: string): string {
  switch (t) {
    case 'general_liability': return 'General Liability';
    case 'auto':              return 'Auto Liability';
    case 'workers_comp':      return "Workers' Comp";
    case 'umbrella':          return 'Umbrella / Excess';
    case 'professional':      return 'Professional Liability';
    case 'pollution':         return 'Pollution Liability';
    default:                  return 'Other';
  }
}

const styles = StyleSheet.create({
  complianceBanner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    marginHorizontal: Tokens.spacing.md,
    marginTop: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.sm,
    paddingHorizontal: 14,
    borderRadius: Tokens.radius.panel,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  complianceBannerTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6,
  },
  complianceBannerPillRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  compliancePill: {
    paddingHorizontal: 10,
    paddingVertical: Tokens.spacing.xxs,
    borderRadius: 999,
  },
  compliancePillText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    letterSpacing: 0.1,
  },
  container: { flex: 1, backgroundColor: Colors.background },
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: Colors.text },
  emptyBody: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19, paddingHorizontal: Tokens.spacing['2xl'] },

  listHeader: {
    paddingHorizontal: Tokens.spacing.md,
    paddingTop: Tokens.spacing.sm, paddingBottom: Tokens.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  eyebrow: {
    fontSize: 10, fontWeight: '800' as const, color: Colors.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
  },
  title: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: Colors.text, marginTop: Tokens.spacing.hairline, letterSpacing: -0.4 },
  subtitle: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },

  subRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.card, padding: Tokens.spacing.sm, marginBottom: Tokens.spacing.xs,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  subStatusIcon: {
    width: 40, height: 40, borderRadius: Tokens.radius.card,
    alignItems: 'center', justifyContent: 'center',
  },
  subName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.text },
  subMeta: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },
  statusPill: {
    paddingHorizontal: 10, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.full,
  },
  statusPillText: { fontSize: 10, fontWeight: '800' as const, letterSpacing: 0.4, textTransform: 'uppercase' as const },

  detailHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: Tokens.spacing.md, paddingVertical: Tokens.spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
    gap: Tokens.spacing.sm,
  },
  headerBack: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs, flex: 1 },
  headerBackText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: Colors.primary },
  uploadBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: Tokens.spacing.sm, paddingVertical: Tokens.spacing.xs,
    backgroundColor: Colors.primary, borderRadius: Tokens.radius.md,
  },
  uploadBtnText: { color: '#fff', fontWeight: '800' as const, fontSize: Type.caption1.fontSize },
  btnDisabled: { opacity: 0.5 },
  titleBlock: { marginBottom: Tokens.spacing.md },

  coiCard: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginBottom: Tokens.spacing.sm,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  coiHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  coiStatusIcon: { width: 32, height: 32, borderRadius: Tokens.radius.md, alignItems: 'center' as const, justifyContent: 'center' as const },
  coiTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.text },
  coiMeta: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },
  deleteBtn: { padding: 6 },
  coiImage: {
    width: '100%' as const,
    height: 200,
    backgroundColor: Colors.background,
    borderRadius: Tokens.radius.md, marginTop: 10,
  },

  findingsCard: {
    backgroundColor: Colors.background,
    borderRadius: Tokens.radius.md, padding: Tokens.spacing.sm,
    marginTop: 10,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  findingsLabel: {
    fontSize: 10, fontWeight: '800' as const, color: Colors.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
    marginBottom: 6,
  },
  findingRow: { flexDirection: 'row' as const, gap: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs, alignItems: 'flex-start' as const },
  findingDot: { width: 6, height: 6, borderRadius: 3, marginTop: 6 },
  findingText: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.text, lineHeight: 16 },

  coveragesCard: {
    backgroundColor: Colors.background,
    borderRadius: Tokens.radius.md, padding: Tokens.spacing.sm, marginTop: Tokens.spacing.xs,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  coverageRow: { paddingVertical: Tokens.spacing.xxs },
  coverageType: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: Colors.text },
  coverageMeta: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },

  notesLabel: {
    fontSize: 10, fontWeight: '800' as const, color: Colors.textMuted,
    letterSpacing: 0.7, textTransform: 'uppercase' as const,
    marginTop: Tokens.spacing.sm, marginBottom: 5,
  },
  notesInput: {
    backgroundColor: Colors.background,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: Tokens.radius.md, paddingHorizontal: Tokens.spacing.sm, paddingVertical: 10,
    fontSize: Type.caption1.fontSize, color: Colors.text,
    minHeight: 50,
  },
});
