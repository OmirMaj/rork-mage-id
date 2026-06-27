// AI Drawing Comparison — pick a current sheet + a new revision PDF/image
// and AI returns a structured diff: scope added, scope removed, dimensions
// changed, notes revised, plus suggested actions (CO / RFI / nothing).
//
// The headline win: a typical revision drop from the architect is 200+
// pages with no changelog. Walking each sheet manually takes hours and
// misses things, which becomes scope creep that goes unbilled. AI does
// it in under a minute per sheet pair.
//
// Pairs with supabase/functions/compare-drawings.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  Alert, Platform, ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileText, AlertCircle, Plus, Minus, Pencil, Info,
  ArrowUpRight, ArrowDown,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import {
  compareDrawings, type CompareDrawingsResult, type ChangeType, type ChangeImpact,
} from '@/utils/compareDrawings';
import { uploadAndRenderPdf } from '@/utils/pdfRenderClient';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { PlanSheet } from '@/types';

type Step = 'pickOld' | 'pickNew' | 'analyzing' | 'review';

export default function CompareDrawingsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject, getPlanSheetsForProject } = useProjects();
  const { tier } = useSubscription();

  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);
  const planSheets = useMemo(() => projectId ? getPlanSheetsForProject(projectId) : [], [projectId, getPlanSheetsForProject]);

  const [step, setStep] = useState<Step>('pickOld');
  const [error, setError] = useState<string | null>(null);
  const [oldSheet, setOldSheet] = useState<PlanSheet | null>(null);
  const [newPageUrl, setNewPageUrl] = useState<string | null>(null);
  const [newPageLabel, setNewPageLabel] = useState<string | null>(null);
  const [result, setResult] = useState<CompareDrawingsResult | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);

  // ── Pick the OLD sheet — from the project's existing plan sheets ──
  const handlePickOld = useCallback((sheet: PlanSheet) => {
    setOldSheet(sheet);
    setStep('pickNew');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  // ── Pick the NEW revision — upload a single-page PDF or PNG ───────
  const handlePickNew = useCallback(async () => {
    if (!project || !oldSheet) return;
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/png', 'image/jpeg'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      setNewPageLabel(asset.name);

      // PDF → render first page; image → use directly. Either way we need
      // a public URL the edge function can fetch.
      let url: string;
      if ((asset.mimeType ?? '').includes('pdf')) {
        setStep('analyzing');
        const rendered = await uploadAndRenderPdf({
          fileUri: asset.uri,
          projectId: project.id,
          fileName: asset.name,
          dpi: 150,
          maxPages: 1,
        });
        if (!rendered[0]) throw new Error('Could not render the PDF page.');
        url = rendered[0].publicUrl;
      } else {
        // For now, image picks need to already be on a public URL. The
        // current Plans pipeline already pushes to storage on upload, so
        // this branch is unusual; keep it simple: tell the user.
        if (!asset.uri.startsWith('http')) {
          Alert.alert(
            'Need a public URL',
            'Upload your new revision as a PDF — the AI compare runs server-side and needs a public image URL. PDF uploads are auto-rendered.',
          );
          return;
        }
        url = asset.uri;
      }

      // Run the compare.
      const limit = await checkAILimit(tier, 'smart', 'drawingAnalysis');
      if (!limit.allowed) {
        showAILimitAlert({ limit, router, monthly: true });
        setStep('pickNew');
        return;
      }
      setNewPageUrl(url);
      setStep('analyzing');
      const { result: r, modelUsed: m } = await compareDrawings({
        oldPageUrl: oldSheet.imageUri,
        newPageUrl: url,
        sheetNumber: oldSheet.sheetNumber || oldSheet.name,
        projectName: project.name,
      });
      await recordAIUsage('smart', 'drawingAnalysis');
      setResult(r);
      setModelUsed(m);
      setStep('review');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[compare-drawings] failed', e);
      setError(String((e as Error).message ?? e));
      setStep('pickNew');
    }
  }, [project, oldSheet, tier]);

  if (!project) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ title: 'Compare Drawings' }} />
        <Text style={styles.loadingText}>Project not found.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Compare Drawings',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }}>
              <ChevronLeft size={24} color={themeColors.accent} />
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

        {/* ── Step 1: pick the OLD sheet ─────────────────────────── */}
        {step === 'pickOld' && (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIconWrap}>
                <MageAIMark size={20} color={themeColors.accent} />
              </View>
              <Text style={styles.heroTitle}>Find what changed</Text>
              <Text style={styles.heroBody}>
                Pick the sheet that&apos;s currently in the field. Then upload the new revision and AI will tell you exactly what changed — scope, dimensions, notes — and what each change probably means for cost or schedule.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Pick the current sheet</Text>
            {planSheets.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No plan sheets in this project yet.</Text>
                <Text style={styles.emptyBody}>Add a sheet from the Plans screen first — that's the &quot;current&quot; reference for the comparison.</Text>
              </View>
            ) : (
              planSheets.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.sheetCard}
                  onPress={() => handlePickOld(s)}
                  activeOpacity={0.85}
                >
                  <Image source={{ uri: s.imageUri }} style={styles.sheetThumb} resizeMode="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetTitle}>{s.name}</Text>
                    {s.sheetNumber ? <Text style={styles.sheetMeta}>{s.sheetNumber}</Text> : null}
                  </View>
                  <ArrowUpRight size={16} color={themeColors.textMuted} />
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {/* ── Step 2: pick the NEW revision ───────────────────────── */}
        {step === 'pickNew' && oldSheet && (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>Now upload the revision</Text>
              <Text style={styles.heroBody}>
                Pick the new PDF (single sheet) or PNG showing the same drawing as <Text style={{ fontWeight: '700' }}>{oldSheet.name}</Text>. We&apos;ll render it and run the comparison.
              </Text>
            </View>

            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Comparing against</Text>
              <View style={styles.summaryRow}>
                <Image source={{ uri: oldSheet.imageUri }} style={styles.summaryThumb} resizeMode="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.summaryTitle}>{oldSheet.name}</Text>
                  {oldSheet.sheetNumber ? <Text style={styles.sheetMeta}>{oldSheet.sheetNumber}</Text> : null}
                </View>
              </View>
              <TouchableOpacity onPress={() => setStep('pickOld')} style={styles.changeBtn}>
                <Text style={styles.changeBtnText}>Pick a different sheet</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={handlePickNew} style={styles.primaryBtn} activeOpacity={0.85}>
              <FileText size={16} color="#FFF" />
              <Text style={styles.primaryBtnText}>Pick new revision (PDF)</Text>
            </TouchableOpacity>

            {error && (
              <View style={styles.errorBanner}>
                <AlertCircle size={14} color={themeColors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </>
        )}

        {/* ── Step 3: analyzing ──────────────────────────────────── */}
        {step === 'analyzing' && (
          <View style={styles.busyWrap}>
            <ActivityIndicator size="large" color={themeColors.accent} />
            <Text style={styles.busyText}>AI comparing the two sheets…</Text>
            <Text style={styles.busySub}>
              Looking for added scope, removed scope, dimension changes, and revised notes. Usually 30-60 seconds.
            </Text>
          </View>
        )}

        {/* ── Step 4: review the diff ────────────────────────────── */}
        {step === 'review' && result && oldSheet && (
          <>
            <View style={[styles.hero, severityHero(result.severity)]}>
              <Text style={styles.severityLabel}>{severityLabel(result.severity)}</Text>
              <Text style={styles.heroTitle}>{result.changes.length} change{result.changes.length === 1 ? '' : 's'} found</Text>
              <Text style={styles.heroBody}>{result.summary}</Text>
              {modelUsed && (
                <Text style={styles.modelTag}>via {modelUsed}</Text>
              )}
            </View>

            {/* Side-by-side preview */}
            <View style={styles.previewRow}>
              <View style={styles.previewItem}>
                <Text style={styles.previewLabel}>Old</Text>
                <Image source={{ uri: oldSheet.imageUri }} style={styles.previewImg} resizeMode="contain" />
                <Text style={styles.previewName} numberOfLines={1}>{oldSheet.name}</Text>
              </View>
              {newPageUrl && (
                <View style={styles.previewItem}>
                  <Text style={styles.previewLabel}>New</Text>
                  <Image source={{ uri: newPageUrl }} style={styles.previewImg} resizeMode="contain" />
                  <Text style={styles.previewName} numberOfLines={1}>{newPageLabel ?? 'Revision'}</Text>
                </View>
              )}
            </View>

            {result.changes.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>No changes detected.</Text>
                <Text style={styles.emptyBody}>The two sheets look the same to AI. Worth a quick eyeball confirmation before you trust this.</Text>
              </View>
            ) : (
              result.changes.map((c, i) => (
                <View key={i} style={styles.changeCard}>
                  <View style={styles.changeHeader}>
                    <View style={[styles.changeIcon, changeBg(c.type)]}>
                      {iconForType(c.type)}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.changeType}>{labelForType(c.type)}{c.location ? ` · ${c.location}` : ''}</Text>
                      <Text style={styles.changeDescription}>{c.description}</Text>
                      {c.impact !== 'none' && (
                        <View style={[styles.impactChip, impactBg(c.impact)]}>
                          <Text style={styles.impactText}>{c.impact} impact</Text>
                        </View>
                      )}
                      {c.suggestedAction ? (
                        <Text style={styles.suggestedAction}>→ {c.suggestedAction}</Text>
                      ) : null}
                    </View>
                  </View>
                </View>
              ))
            )}

            {result.rfiCandidates.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>Possible RFIs to architect</Text>
                {result.rfiCandidates.map((r, i) => (
                  <View key={i} style={styles.rfiCard}>
                    <Info size={14} color={themeColors.info} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rfiSubject}>{r.subject}</Text>
                      <Text style={styles.rfiQuestion}>{r.question}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}

            <TouchableOpacity onPress={() => router.back()} style={styles.primaryBtn} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </>
  );
}

function iconForType(t: ChangeType) {
  if (t === 'added') return <Plus size={14} color="#FFF" />;
  if (t === 'removed') return <Minus size={14} color="#FFF" />;
  if (t === 'modified') return <Pencil size={14} color="#FFF" />;
  return <Info size={14} color="#FFF" />;
}
function labelForType(t: ChangeType): string {
  if (t === 'added') return 'Added';
  if (t === 'removed') return 'Removed';
  if (t === 'modified') return 'Modified';
  return 'Note revised';
}
// Module-level — hardcoded hex to stay theme-agnostic.
function changeBg(t: ChangeType) {
  if (t === 'added') return { backgroundColor: '#2E7D44' };
  if (t === 'removed') return { backgroundColor: '#C84038' };
  if (t === 'modified') return { backgroundColor: Colors.warning };
  return { backgroundColor: '#1565C0' };
}
function impactBg(i: ChangeImpact) {
  if (i === 'major') return { backgroundColor: '#C84038' + '25' };
  if (i === 'moderate') return { backgroundColor: Colors.warning + '25' };
  return { backgroundColor: '#F4EFE6' };
}
function severityHero(s: 'low' | 'medium' | 'high') {
  if (s === 'high') return { backgroundColor: '#C84038' + '12', borderColor: '#C84038' + '30' };
  if (s === 'medium') return { backgroundColor: Colors.warning + '14', borderColor: Colors.warning + '40' };
  return { backgroundColor: '#2E7D44' + '12', borderColor: '#2E7D44' + '30' };
}
function severityLabel(s: 'low' | 'medium' | 'high'): string {
  if (s === 'high') return 'HIGH IMPACT';
  if (s === 'medium') return 'MEDIUM IMPACT';
  return 'LOW IMPACT';
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: Type.body.fontSize, color: t.textMuted },

  hero: {
    margin: 16, padding: 18, borderRadius: Tokens.radius.panel,
    backgroundColor: t.accent + '0D',
    borderWidth: 1, borderColor: t.accent + '20',
  },
  heroIconWrap: {
    width: 38, height: 38, borderRadius: 11,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  heroTitle: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, marginBottom: 8 },
  heroBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 19 },
  severityLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.text, marginBottom: 6, letterSpacing: 0.6 },
  modelTag: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 8 },

  sectionLabel: {
    marginHorizontal: 16, marginTop: 8, marginBottom: 8,
    fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },

  sheetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: Tokens.radius.card, backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
  },
  sheetThumb: { width: 50, height: 50, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt },
  sheetTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  sheetMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  emptyCard: {
    margin: 16, padding: 16, borderRadius: Tokens.radius.card,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
  },
  emptyText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text, marginBottom: 4 },
  emptyBody: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },

  summaryCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 14,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    borderWidth: 1, borderColor: t.line,
  },
  summaryLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryThumb: { width: 50, height: 50, borderRadius: Tokens.radius.md },
  summaryTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  changeBtn: { marginTop: 10 },
  changeBtnText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' },

  primaryBtn: {
    marginHorizontal: 16, paddingVertical: 14, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  primaryBtnText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '700' },

  busyWrap: { padding: 40, alignItems: 'center', gap: 12 },
  busyText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  busySub: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 17 },

  errorBanner: {
    marginHorizontal: 16, marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.danger + '15', borderWidth: 1, borderColor: t.danger + '30',
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  errorText: { fontSize: Type.caption1.fontSize, color: t.danger, flex: 1, lineHeight: 17 },

  previewRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginBottom: 12 },
  previewItem: { flex: 1, padding: 8, borderRadius: Tokens.radius.md, backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line },
  previewLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  previewImg: { width: '100%', height: 140, borderRadius: 6, backgroundColor: t.surfaceAlt },
  previewName: { fontSize: Type.caption1.fontSize, color: t.text, marginTop: 6 },

  changeCard: {
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: Tokens.radius.card, backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
  },
  changeHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  changeIcon: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  changeType: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.text, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  changeDescription: { fontSize: Type.bodyCompact.fontSize, color: t.text, lineHeight: 19 },
  impactChip: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginTop: 6 },
  impactText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, color: t.text },
  suggestedAction: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 6, fontStyle: 'italic' },

  rfiCard: {
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: Tokens.radius.md, backgroundColor: t.info + '10',
    borderWidth: 1, borderColor: t.info + '30',
    flexDirection: 'row', gap: 8,
  },
  rfiSubject: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, marginBottom: 4 },
  rfiQuestion: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
});
