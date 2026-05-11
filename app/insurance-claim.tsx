// insurance-claim.tsx — vision-doc feature #21.
//
// One-click claim package for water / fire / theft / weather / vandalism
// damage. Pre-fix the GC manually emailed photos + receipts + scope to
// the adjuster across multiple threads, taking 2-3 hours per claim and
// burning goodwill with the carrier. This screen takes the incident
// metadata, lets the GC tap "Generate package," and drops a zip with
// every photo, DFR, and punch item from the incident window.
//
// Built on `utils/insuranceClaimPackage.ts` — same JSZip pattern as
// closeoutBinderZip. The screen is just a form + a generate button.

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Platform, ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ShieldCheck, FileDown, Droplet, Flame, ShieldAlert, Cloud, Wrench,
  ChevronDown, Check, X, Camera, FileText, Clipboard,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  buildAndShareInsuranceClaimPackage, type ClaimType,
} from '@/utils/insuranceClaimPackage';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

const CLAIM_TYPES: { key: ClaimType; label: string; icon: typeof Droplet }[] = [
  { key: 'water', label: 'Water', icon: Droplet },
  { key: 'fire', label: 'Fire', icon: Flame },
  { key: 'theft', label: 'Theft', icon: ShieldAlert },
  { key: 'weather', label: 'Weather', icon: Cloud },
  { key: 'vandalism', label: 'Vandalism', icon: Wrench },
  { key: 'other', label: 'Other', icon: ShieldCheck },
];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function InsuranceClaimScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const {
    projects, projectPhotos, dailyReports, punchItems, settings,
  } = useProjects();

  const [projectId, setProjectId] = useState<string | null>(
    typeof params.projectId === 'string' ? params.projectId : null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [claimType, setClaimType] = useState<ClaimType>('water');
  const [incidentDate, setIncidentDate] = useState(todayISO());
  const [incidentEndDate, setIncidentEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [estimatedAmount, setEstimatedAmount] = useState('');
  const [policyNumber, setPolicyNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [adjusterName, setAdjusterName] = useState('');
  const [adjusterEmail, setAdjusterEmail] = useState('');
  const [generating, setGenerating] = useState(false);

  const project = projects.find(p => p.id === projectId);

  const handleGenerate = useCallback(async () => {
    if (!project) {
      Alert.alert('Pick a project', 'Choose which project this claim is for.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Description required', 'Briefly describe what happened.');
      return;
    }

    setGenerating(true);
    try {
      const branding = settings?.branding ?? {};
      const result = await buildAndShareInsuranceClaimPackage({
        project,
        incidentDate,
        incidentEndDate: incidentEndDate.trim() || undefined,
        claimType,
        claimDescription: description.trim(),
        estimatedDamageAmount: Number(estimatedAmount) || undefined,
        policyNumber: policyNumber.trim() || undefined,
        carrier: carrier.trim() || undefined,
        adjusterName: adjusterName.trim() || undefined,
        adjusterEmail: adjusterEmail.trim() || undefined,
        photos: projectPhotos,
        dailyReports,
        punchItems,
        gcInfo: {
          companyName: (branding.companyName as string) ?? 'Contractor',
          contact: (branding.contactName as string) ?? '',
          phone: (branding.phone as string) ?? '',
          email: (branding.email as string) ?? '',
        },
      });
      if (result.ok) {
        if (Platform.OS !== 'web') {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        }
        Alert.alert(
          'Claim package ready',
          `Bundled ${result.itemCounts.photos} photo${result.itemCounts.photos === 1 ? '' : 's'} · ${result.itemCounts.dfrs} daily report${result.itemCounts.dfrs === 1 ? '' : 's'} · ${result.itemCounts.punch} punch item${result.itemCounts.punch === 1 ? '' : 's'} into ${result.fileName}. Share with your adjuster.`,
        );
      } else {
        Alert.alert('Generation failed', result.error ?? 'Unknown error');
      }
    } finally {
      setGenerating(false);
    }
  }, [
    project, description, incidentDate, incidentEndDate, claimType,
    estimatedAmount, policyNumber, carrier, adjusterName, adjusterEmail,
    projectPhotos, dailyReports, punchItems, settings,
  ]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Insurance claim',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView contentContainerStyle={{ padding: Tokens.spacing.md, paddingBottom: insets.bottom + 100 }}>
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <ShieldCheck size={20} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>One-click claim package</Text>
          <Text style={styles.heroBody}>
            Photos, daily reports, and punch items from the incident window —
            bundled into a zip your adjuster opens with one click.
          </Text>
        </View>

        {/* Claim type */}
        <Text style={styles.label}>Claim type</Text>
        <View style={styles.typeRow}>
          {CLAIM_TYPES.map(t => {
            const active = claimType === t.key;
            const Icon = t.icon;
            return (
              <TouchableOpacity
                key={t.key}
                onPress={() => setClaimType(t.key)}
                style={[styles.typeBtn, active && styles.typeBtnActive]}
                activeOpacity={0.85}
                testID={`claim-type-${t.key}`}
              >
                <Icon size={16} color={active ? Colors.background : Colors.textSecondary} />
                <Text style={[styles.typeBtnText, active && styles.typeBtnTextActive]}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Project */}
        <Text style={styles.label}>Project</Text>
        <TouchableOpacity
          style={styles.field}
          onPress={() => setPickerOpen(o => !o)}
          activeOpacity={0.85}
        >
          <Text style={[styles.fieldText, !project && styles.fieldPlaceholder]}>
            {project?.name ?? 'Pick a project'}
          </Text>
          <ChevronDown size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        {pickerOpen && (
          <View style={styles.pickerList}>
            {projects.map(p => (
              <TouchableOpacity
                key={p.id}
                style={styles.pickerItem}
                onPress={() => {
                  setProjectId(p.id);
                  setPickerOpen(false);
                }}
              >
                <Text style={styles.pickerItemText}>{p.name}</Text>
                {p.id === projectId ? <Check size={14} color={Colors.primary} /> : null}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Incident dates */}
        <View style={{ flexDirection: 'row' as const, gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Incident date</Text>
            <TextInput
              value={incidentDate}
              onChangeText={setIncidentDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>End (optional)</Text>
            <TextInput
              value={incidentEndDate}
              onChangeText={setIncidentEndDate}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
          </View>
        </View>

        {/* Description */}
        <Text style={styles.label}>What happened</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="3rd-floor unit had a pipe burst overnight, water reached the lower units. Damage to drywall, floor, and finished cabinets."
          placeholderTextColor={Colors.textMuted}
          multiline
          style={[styles.input, styles.multilineInput]}
        />

        {/* Insurance info */}
        <Text style={styles.sectionHeader}>Insurance details (optional)</Text>
        <Text style={styles.helper}>
          Pre-fills the README so the adjuster has policy + carrier + their own contact info on the cover page.
        </Text>

        <View style={{ flexDirection: 'row' as const, gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Policy #</Text>
            <TextInput
              value={policyNumber}
              onChangeText={setPolicyNumber}
              placeholder="GL-12345"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Estimated $</Text>
            <TextInput
              value={estimatedAmount}
              onChangeText={setEstimatedAmount}
              placeholder="25000"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
              style={styles.input}
            />
          </View>
        </View>

        <Text style={styles.label}>Carrier</Text>
        <TextInput
          value={carrier}
          onChangeText={setCarrier}
          placeholder="Travelers, The Hartford, Liberty Mutual..."
          placeholderTextColor={Colors.textMuted}
          style={styles.input}
        />

        <View style={{ flexDirection: 'row' as const, gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Adjuster name</Text>
            <TextInput
              value={adjusterName}
              onChangeText={setAdjusterName}
              placeholder="Jane Doe"
              placeholderTextColor={Colors.textMuted}
              style={styles.input}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>Adjuster email</Text>
            <TextInput
              value={adjusterEmail}
              onChangeText={setAdjusterEmail}
              placeholder="jdoe@carrier.com"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              style={styles.input}
            />
          </View>
        </View>

        {/* Preview of what's bundled */}
        {project && (
          <View style={styles.previewCard}>
            <Text style={styles.previewTitle}>What gets bundled</Text>
            <View style={styles.previewRow}>
              <Camera size={12} color={Colors.primary} />
              <Text style={styles.previewText}>
                Project photos within the incident window (incident date − 1 day to end + 7 days)
              </Text>
            </View>
            <View style={styles.previewRow}>
              <FileText size={12} color={Colors.primary} />
              <Text style={styles.previewText}>
                Daily field reports (weather, crew, work performed) for the same window
              </Text>
            </View>
            <View style={styles.previewRow}>
              <Clipboard size={12} color={Colors.primary} />
              <Text style={styles.previewText}>
                Punch items created or closed in the window — adjusters use them to corroborate scope
              </Text>
            </View>
          </View>
        )}

        {/* Generate */}
        <TouchableOpacity
          style={[styles.generateBtn, generating && styles.generateBtnDisabled]}
          onPress={handleGenerate}
          disabled={generating}
          activeOpacity={0.85}
          testID="generate-claim-package"
        >
          {generating ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <FileDown size={16} color={Colors.background} />
          )}
          <Text style={styles.generateBtnText}>
            {generating ? 'Bundling claim package…' : 'Generate claim package'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.footnote}>
          The package is generated on-device, then opens in your share sheet so you can email or
          AirDrop it to the adjuster directly. No data leaves your phone unless you share it.
        </Text>
      </ScrollView>

      {void X}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  hero: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: Tokens.spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: Tokens.spacing.md,
  },
  heroIconWrap: {
    width: 36,
    height: 36,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: Tokens.spacing.xs,
  },
  heroTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  heroBody: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: 6,
    lineHeight: 18,
  },

  label: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
    marginTop: 14,
    marginBottom: 6,
  },
  sectionHeader: {
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    marginTop: 22,
    letterSpacing: -0.2,
  },
  helper: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
    marginTop: Tokens.spacing.xxs,
    lineHeight: 16,
  },

  typeRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: Tokens.spacing.xs,
  },
  typeBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: 9,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  typeBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeBtnText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
  },
  typeBtnTextActive: { color: Colors.background },

  field: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.sm,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  fieldText: { fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '600' as const, flex: 1 },
  fieldPlaceholder: { color: Colors.textMuted, fontWeight: '500' as const },
  pickerList: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginTop: 6,
    overflow: 'hidden' as const,
  },
  pickerItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 14,
    paddingVertical: Tokens.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  pickerItemText: { fontSize: Type.body.fontSize, color: Colors.text, fontWeight: '500' as const },

  input: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: Tokens.spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: Type.body.fontSize,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  multilineInput: { minHeight: 80, textAlignVertical: 'top' as const, paddingTop: 10 },

  previewCard: {
    backgroundColor: Colors.primary + '08',
    borderRadius: Tokens.radius.md,
    padding: Tokens.spacing.sm,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
    marginTop: 22,
    gap: Tokens.spacing.xs,
  },
  previewTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  previewRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: Tokens.spacing.xs,
  },
  previewText: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    lineHeight: 17,
  },

  generateBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: Tokens.spacing.xs,
    paddingVertical: 14,
    marginTop: 22,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.primary,
  },
  generateBtnDisabled: { opacity: 0.6 },
  generateBtnText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: Colors.background,
  },

  footnote: {
    marginTop: 14,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
    lineHeight: 15,
    textAlign: 'center' as const,
  },
});
