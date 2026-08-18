// AI Extract Submittals — pick a spec book PDF, AI walks every page
// and identifies items requiring submittals (cut sheets, mix designs,
// shop drawings, samples, etc.). Output: a reviewable list the GC can
// trim before bulk-saving to the project's submittal log.
//
// Pairs with supabase/functions/analyze-spec-book (task='submittals').
// Picks a PDF via DocumentPicker, renders it to PNGs (already wired
// for the takeoff pipeline), then calls extractSubmittalsFromSpecBook.
//
// The headline win: reading a 200-page spec book to find every "Submit
// for review" line takes hours. AI runs in 60-90 seconds. Reviewing a
// curated list and unchecking the "noise" entries is the GC's part.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, Platform, ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import {
  FileText, AlertCircle, Save, Trash2,
  Layers, Calendar, Hammer,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import {
  extractSubmittalsFromSpecBook,
  type AiSubmittalCandidate,
  type AiSubmittalsResult,
} from '@/utils/specMatcher';
import { uploadAndRenderPdf } from '@/utils/pdfRenderClient';
import { generateUUID } from '@/utils/generateId';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { Submittal } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import { showAlert } from '@/utils/alert';

interface PickItem extends AiSubmittalCandidate {
  // Local key for the review list.
  rowId: string;
  // Whether the GC keeps this row when bulk-saving.
  selected: boolean;
}

type Step = 'idle' | 'uploading' | 'analyzing' | 'review';

export default function ExtractSubmittalsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId: string }>();
  const { projects, getProject, addSubmittals, settings } = useProjects();
  const { tier } = useSubscription();

  // Opened without params (Tools hub, search): land on a project picker
  // instead of the old flat "Project not found." dead end (sim-audit #5).
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? null;
  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);

  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pickedFileName, setPickedFileName] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiSubmittalsResult | null>(null);
  const [items, setItems] = useState<PickItem[]>([]);
  const [saving, setSaving] = useState(false);

  // ── Pick + analyze ─────────────────────────────────────────────
  const handlePickAndAnalyze = useCallback(async () => {
    setError(null);
    if (!project) { showAlert('No project'); return; }

    // Pro-tier gate (vision API spend).
    const limit = await checkAILimit(tier, 'smart', 'specBookExtract');
    if (!limit.allowed) {
      showAILimitAlert({ limit, router, monthly: true });
      return;
    }

    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      setPickedFileName(asset.name);
      setStep('uploading');
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Render the PDF to PNG pages we can ship to Gemini Vision. The
      // edge function caps at 24 pages — for a typical residential spec
      // book that's enough; commercial books may need batching.
      const rendered = await uploadAndRenderPdf({
        fileUri: asset.uri,
        projectId: project.id,
        fileName: asset.name,
        dpi: 130,
        maxPages: 24,
      });

      setStep('analyzing');
      const { result } = await extractSubmittalsFromSpecBook({
        pageUrls: rendered.map(p => p.publicUrl),
        projectName: project.name,
      });
      await recordAIUsage('smart', 'specBookExtract');

      setAiResult(result);
      // Default-select every "high" / "medium" item; "low" defaults off
      // so the GC opts in for fuzzy entries.
      setItems(result.items.map(item => ({
        ...item,
        rowId: generateUUID(),
        selected: item.confidence !== 'low',
      })));
      setStep('review');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[extract-submittals] failed', e);
      setError(String((e as Error).message ?? e));
      setStep('idle');
    }
  }, [project, tier]);

  // ── Review-list mutations ──────────────────────────────────────
  const toggleRow = useCallback((rowId: string) => {
    setItems(prev => prev.map(r => r.rowId === rowId ? { ...r, selected: !r.selected } : r));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);
  const dropRow = useCallback((rowId: string) => {
    setItems(prev => prev.filter(r => r.rowId !== rowId));
  }, []);
  const selectedCount = items.filter(i => i.selected).length;

  // ── Bulk save selected → submittal log ─────────────────────────
  const handleSave = useCallback(async () => {
    if (!project) return;
    if (selectedCount === 0) { showAlert('Nothing selected'); return; }
    setSaving(true);
    try {
      const today = new Date();
      // Build every keeper first, then insert as ONE batch. Looping
      // addSubmittal (which used a stale render closure) collapsed all rows
      // onto the same number so only the last survived, yet the count below
      // reported the full total. addSubmittals numbers + commits atomically.
      const toAdd: Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'>[] = items
        .filter(row => row.selected)
        .map(row => {
          const requiredDate = new Date(today.getTime() + row.dueRelativeDays * 24 * 60 * 60 * 1000);
          return {
            projectId: project.id,
            title: row.title,
            specSection: row.specSection || '',
            submittedBy: settings?.branding?.companyName || 'Project Team',
            submittedDate: today.toISOString(),
            requiredDate: requiredDate.toISOString(),
            reviewCycles: [],
            currentStatus: 'pending',
            attachments: [],
          };
        });
      addSubmittals(toAdd);
      const added = toAdd.length;
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(
        'Submittals added',
        `${added} submittal${added === 1 ? '' : 's'} logged. Open the project's submittal section to attach files and route them.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e) {
      console.warn('[extract-submittals] save failed', e);
      showAlert('Save failed', String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  }, [project, items, selectedCount, addSubmittals, settings, router]);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="SPEC BOOK · MAGE" title="Extract Submittals" />
        <ToolProjectPicker
          toolName="Extract Submittals"
          message="Spec Book reads a specification PDF and drafts the submittal log — every product data, shop drawing, and sample the spec calls for, filed into the project."
          projects={projects}
          onPick={setPickedProjectId}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ToolHeader eyebrow="SPEC BOOK · MAGE" title={project.name} />
      <ScrollView {...fabScroll} style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {step === 'idle' && (
          <>
            <View style={styles.hero}>
              <View style={styles.heroIconWrap}>
                <MageAIMark size={20} color={"#FF6A1A"} />
              </View>
              <Text style={styles.heroTitle}>Spec book → submittal log</Text>
              <Text style={styles.heroBody}>
                Upload the architect&apos;s spec book PDF. AI reads every page and pulls out each item that requires a submittal — cut sheets, mix designs, shop drawings, samples, certifications. You review the list, uncheck the ones you don&apos;t need, and we add the keepers to {project.name}&apos;s submittal log.
              </Text>
            </View>

            <TouchableOpacity onPress={handlePickAndAnalyze} style={styles.primaryBtn} activeOpacity={0.85}>
              <FileText size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.primaryBtnText}>Pick spec book PDF</Text>
            </TouchableOpacity>

            {error && (
              <View style={styles.errorBanner}>
                <AlertCircle size={14} color={"#C84038"} strokeWidth={1.75} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={styles.helperBox}>
              <Text style={styles.helperTitle}>What works</Text>
              <Text style={styles.helperBody}>
                • Up to ~24 pages per pass — for full books, split into divisions and run them separately.{'\n'}
                • Default lead time is 14 days; AI bumps to 30 for long-lead items (mock-ups, custom fabrication).{'\n'}
                • Architect-grade spec books work best (Division 02-33 with explicit &quot;Submittals&quot; sections). Quick scope letters give thinner results.
              </Text>
            </View>
          </>
        )}

        {(step === 'uploading' || step === 'analyzing') && (
          <View style={styles.busyWrap}>
            <ActivityIndicator size="large" color={"#FF6A1A"} />
            <Text style={styles.busyText}>
              {step === 'uploading' ? 'Rendering pages…' : 'AI reading the spec book…'}
            </Text>
            <Text style={styles.busySub}>
              {step === 'analyzing'
                ? 'Pulling out submittal requirements page by page. Usually 60-90 seconds.'
                : pickedFileName ?? 'Processing the PDF.'}
            </Text>
          </View>
        )}

        {step === 'review' && aiResult && (
          <>
            <View style={styles.hero}>
              <Text style={styles.heroTitle}>{items.length} submittal{items.length === 1 ? '' : 's'} found</Text>
              <Text style={styles.heroBody}>
                {aiResult.confidenceExplanation || 'Review each entry. Toggle off the ones you don\'t need, then save.'}
              </Text>
            </View>

            {items.map(row => (
              <View
                key={row.rowId}
                style={[styles.itemCard, !row.selected && { opacity: 0.55 }]}
              >
                <View style={styles.itemHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{row.title}</Text>
                    <View style={styles.metaLine}>
                      {row.specSection ? (
                        <View style={styles.metaChip}>
                          <Layers size={11} color={"#9AA3AD"} strokeWidth={1.75} />
                          <Text style={styles.metaChipText}>{row.specSection}</Text>
                        </View>
                      ) : null}
                      <View style={styles.metaChip}>
                        <Hammer size={11} color={"#9AA3AD"} strokeWidth={1.75} />
                        <Text style={styles.metaChipText}>{row.trade}</Text>
                      </View>
                      <View style={styles.metaChip}>
                        <Calendar size={11} color={"#9AA3AD"} strokeWidth={1.75} />
                        <Text style={styles.metaChipText}>{row.dueRelativeDays}d lead</Text>
                      </View>
                      <View style={[styles.confChip, confColor(row.confidence)]}>
                        <Text style={styles.confText}>{row.confidence}</Text>
                      </View>
                    </View>
                    <Text style={styles.itemType}>{row.submittalType}</Text>
                    {row.sourcePages.length > 0 ? (
                      <Text style={styles.itemPages}>p. {row.sourcePages.join(', ')}</Text>
                    ) : null}
                  </View>
                  <Switch
                    value={row.selected}
                    onValueChange={() => toggleRow(row.rowId)}
                    trackColor={{ false: themeColors.line, true: "#FF6A1A" }}
                    thumbColor="#FFF"
                  />
                </View>
                <TouchableOpacity onPress={() => dropRow(row.rowId)} style={styles.dropRow}>
                  <Trash2 size={12} color={"#9AA3AD"} strokeWidth={1.75} />
                  <Text style={styles.dropText}>Remove from list</Text>
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity
              onPress={handleSave}
              disabled={saving || selectedCount === 0}
              activeOpacity={0.85}
              style={[styles.primaryBtn, (saving || selectedCount === 0) && { opacity: 0.6 }]}
            >
              {saving
                ? <ActivityIndicator color="#FFF" />
                : (
                  <>
                    <Save size={16} color="#FFF" strokeWidth={1.75} />
                    <Text style={styles.primaryBtnText}>
                      Add {selectedCount} submittal{selectedCount === 1 ? '' : 's'} to log
                    </Text>
                  </>
                )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function confColor(c: 'high' | 'medium' | 'low') {
  if (c === 'high') return { backgroundColor: "#2E7D44" + '20' };
  if (c === 'medium') return { backgroundColor: Colors.warning + '20' };
  return { backgroundColor: "#9AA3AD" + '20' };
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

  primaryBtn: {
    marginHorizontal: 16, paddingVertical: 14, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  primaryBtnText: { color: '#FFF', fontSize: Type.body.fontSize, fontWeight: '700' },

  errorBanner: {
    marginHorizontal: 16, marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: Tokens.radius.md,
    backgroundColor: t.danger + '15',
    borderWidth: 1, borderColor: t.danger + '30',
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  errorText: { fontSize: Type.caption1.fontSize, color: t.danger, flex: 1, lineHeight: 17 },

  helperBox: {
    margin: 16, padding: 14, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
  },
  helperTitle: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  helperBody: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },

  busyWrap: { padding: 40, alignItems: 'center', gap: 12 },
  busyText: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  busySub: { fontSize: Type.caption1.fontSize, color: t.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 17 },

  itemCard: {
    marginHorizontal: 16, marginBottom: 10,
    padding: 14, borderRadius: Tokens.radius.card,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
  },
  itemHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  itemTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  metaLine: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999,
    backgroundColor: t.surfaceAlt,
  },
  metaChipText: { fontSize: 11, color: t.textMuted, fontWeight: '600' },
  itemType: { fontSize: Type.caption1.fontSize, color: t.textSecondary, marginTop: 6 },
  itemPages: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 4, fontStyle: 'italic' },

  confChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  confText: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, color: t.text },

  dropRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, alignSelf: 'flex-start' },
  dropText: { fontSize: Type.caption2.fontSize, color: t.textMuted },
});
