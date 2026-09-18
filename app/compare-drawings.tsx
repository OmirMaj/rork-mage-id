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
//
// Audit round 2 (#20): the review step used to end at "Done", which threw the
// whole comparison away — the revision was never added to the plan set (so the
// superseded sheet stayed "current" in the field), the drafted RFIs vanished,
// and every flagged change had to be retyped into the CO screen from memory.
// The review now files the revision (addPlanSheet chains it and marks the old
// copy superseded), creates each RFI against the sheet, and starts a change
// order prefilled with the change and the drawing it came from.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import CraneLoader from '@/components/CraneLoader';
import { CONSTRUCTION_FACTS } from '@/utils/constructionFacts';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import {
  FileText, AlertCircle, Plus, Minus, Pencil, Info,
  ArrowUpRight, ArrowDown, Layers, Check, FilePlus2, MessageSquarePlus,
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
import { uploadAndRenderPdf, countPdfPages } from '@/utils/pdfRenderClient';
import {
  currentSheetsForCompare, revisionFiling, changeOrderPrefill, rfiFromCandidate, sheetCitation,
} from '@/utils/plans/revisionActions';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import { showAILimitAlert } from '@/utils/aiLimitAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import type { PlanSheet } from '@/types';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import { showAlert } from '@/utils/alert';

type Step = 'pickOld' | 'pickNew' | 'analyzing' | 'review';

export default function CompareDrawingsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId: string }>();
  const { projects, getProject, getPlanSheetsForProject, addPlanSheet, addRFI, getChangeOrdersForProject } = useProjects();
  const { tier } = useSubscription();

  // Opened without params (Tools hub, search): land on a project picker
  // instead of the old flat "Project not found." dead end (sim-audit #5).
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? null;
  const project = useMemo(() => projectId ? getProject(projectId) : null, [projectId, getProject]);
  const allSheets = useMemo(() => projectId ? getPlanSheetsForProject(projectId) : [], [projectId, getPlanSheetsForProject]);
  // A superseded revision is not "the sheet currently in the field" — offering
  // it as the comparison base is how a diff gets run against a dead drawing.
  const planSheets = useMemo(() => currentSheetsForCompare(allSheets), [allSheets]);

  const [step, setStep] = useState<Step>('pickOld');
  const [error, setError] = useState<string | null>(null);
  const [oldSheet, setOldSheet] = useState<PlanSheet | null>(null);
  const [newPageUrl, setNewPageUrl] = useState<string | null>(null);
  const [newPageLabel, setNewPageLabel] = useState<string | null>(null);
  const [result, setResult] = useState<CompareDrawingsResult | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [newPagePath, setNewPagePath] = useState('');
  const [newPageSize, setNewPageSize] = useState<{ width: number; height: number } | null>(null);
  // What this comparison has already committed — so a second tap can't file the
  // same revision twice or raise the same RFI twice, and the button can say so.
  const [filed, setFiled] = useState<{ sheetId: string; revision: number } | null>(null);
  const [rfiByIndex, setRfiByIndex] = useState<Record<number, number>>({});

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
    setNewPagePath('');
    setNewPageSize(null);
    setFiled(null);
    setRfiByIndex({});
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/png', 'image/jpeg'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      setNewPageLabel(asset.name);

      // PDF → render first page; image → use directly.
      //
      // DB-F11: the NEW page is freshly rendered, so we know its storage path
      // and the function downloads it with the service role. `url` is still
      // carried for the image-pick branch (an already-hosted asset that has no
      // path) and as the one-release fallback for a function that has not been
      // redeployed yet.
      let url: string;
      let newPath = '';
      if ((asset.mimeType ?? '').includes('pdf')) {
        // Only page 1 is rendered and compared. A re-issued SET would silently
        // have its cover sheet diffed against A-101, and the result would read
        // like a total redesign. Say so before spending the render + the AI call.
        const pages = await countPdfPages(asset.uri);
        if (pages !== null && pages > 1) {
          const proceed = await new Promise<boolean>((resolve) => {
            showAlert(
              `${asset.name} has ${pages} pages`,
              `Only page 1 is compared against ${oldSheet.sheetNumber || oldSheet.name}. If this is a whole re-issued set, split out the single sheet first — otherwise the cover page gets compared to your drawing.`,
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Compare page 1', onPress: () => resolve(true) },
              ],
              { cancelable: true, onDismiss: () => resolve(false) },
            );
          });
          if (!proceed) return;
        }
        setStep('analyzing');
        const rendered = await uploadAndRenderPdf({
          fileUri: asset.uri,
          projectId: project.id,
          fileName: asset.name,
          dpi: 150,
          maxPages: 1,
        });
        if (!rendered[0]) throw new Error('Could not render the PDF page.');
        url = rendered[0].viewUrl;
        newPath = rendered[0].storagePath;
        setNewPagePath(newPath);
        setNewPageSize({ width: rendered[0].width, height: rendered[0].height });
      } else {
        // For now, image picks need to already be on a public URL. The
        // current Plans pipeline already pushes to storage on upload, so
        // this branch is unusual; keep it simple: tell the user.
        if (!asset.uri.startsWith('http')) {
          showAlert(
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
        // The OLD sheet comes out of a plan_sheets row. `storagePath` is set by
        // planSheetRowUris ONLY when the key is project-scoped, so a legacy row
        // under the shared `tmp/` prefix deliberately arrives with none and
        // takes the URL fallback — the path would recover fine but no policy can
        // admit it and planSheetBytes refuses it, which would turn a comparison
        // that works today into a 403. The image-pick branch above is url-only
        // for the same reason: it has no storage object at all.
        oldPagePath: oldSheet.storagePath,
        newPagePath: newPath || undefined,
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

  // ── Turn the comparison into records ────────────────────────────────
  // Filing is the one that cannot be recovered later: until the revision is in
  // the plan set, the old sheet is still what the crew opens in the field.
  const filing = oldSheet
    ? revisionFiling({ oldSheet, allSheets, newPath: newPagePath, filedRevision: filed?.revision ?? null })
    : null;

  const handleFileRevision = useCallback(() => {
    if (!project || !oldSheet || !newPagePath || filed) return;
    const fresh = addPlanSheet({
      projectId: project.id,
      // Same name and number as the sheet it replaces: the number is what
      // addPlanSheet chains on (it marks the old copy superseded and sets
      // revision N+1 + previousSheetId).
      name: oldSheet.name,
      sheetNumber: oldSheet.sheetNumber,
      imageUri: newPageUrl ?? '',
      storagePath: newPagePath,
      pageNumber: 1,
      width: newPageSize?.width,
      height: newPageSize?.height,
    });
    setFiled({ sheetId: fresh.id, revision: fresh.revision ?? 1 });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [project, oldSheet, newPagePath, newPageUrl, newPageSize, filed, addPlanSheet]);

  const handleCreateRfi = useCallback((index: number) => {
    if (!oldSheet || !result || rfiByIndex[index]) return;
    const candidate = result.rfiCandidates[index];
    if (!candidate) return;
    const rfi = addRFI(rfiFromCandidate(candidate, oldSheet, newPageLabel, new Date()));
    setRfiByIndex(prev => ({ ...prev, [index]: rfi.number }));
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [oldSheet, result, rfiByIndex, newPageLabel, addRFI]);

  // Which changes have a change order in the project that CARRIES this change's
  // text. This used to be a flag set the moment the user tapped through to the
  // CO screen — so backing out of that screen without saving still counted as
  // "saved", and Done then waved through the exact loss the guard exists to
  // prevent. Matching on the real record is the only claim we can make
  // honestly; a `.includes` (not equality) survives the user editing the
  // description in the CO form, which he usually does.
  const projectChangeOrders = useMemo(
    () => (project ? getChangeOrdersForProject(project.id) : []),
    [project, getChangeOrdersForProject],
  );
  const coSaved = useMemo(() => {
    const out: Record<number, { id: string; number: number }> = {};
    if (!result) return out;
    result.changes.forEach((c, i) => {
      const needle = c.description.trim();
      if (!needle) return;
      const hit = projectChangeOrders.find(co => co.description.includes(needle));
      if (hit) out[i] = { id: hit.id, number: hit.number };
    });
    return out;
  }, [result, projectChangeOrders]);

  const handleStartChangeOrder = useCallback((index: number) => {
    if (!project || !oldSheet || !result) return;
    const change = result.changes[index];
    if (!change) return;
    const existing = coSaved[index];
    router.push({
      pathname: '/change-order' as never,
      // An already-saved change reopens ITS change order rather than prefilling
      // a second one with the same scope.
      params: (existing
        ? { projectId: project.id, coId: existing.id }
        : { projectId: project.id, ...changeOrderPrefill(change, oldSheet, newPageLabel) }) as never,
    });
  }, [project, oldSheet, result, newPageLabel, router, coSaved]);

  // Nothing here is saved until one of the buttons above is used, so Done asks
  // once rather than discarding a revision drop silently.
  const handleDone = useCallback(() => {
    const savedSomething = !!filed || Object.keys(rfiByIndex).length > 0 || Object.keys(coSaved).length > 0;
    const foundSomething = (result?.changes.length ?? 0) > 0 || (result?.rfiCandidates.length ?? 0) > 0;
    if (savedSomething || !foundSomething) { router.back(); return; }
    showAlert(
      'Nothing from this comparison is saved',
      'File the revision, create an RFI, or start a change order first — leaving now discards what the comparison found.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave anyway', style: 'destructive', onPress: () => router.back() },
      ],
      { cancelable: true },
    );
  }, [filed, rfiByIndex, coSaved, result, router]);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="COMPARE DRAWINGS · MAGE ID" title="Find what changed" />
        <ToolProjectPicker
          toolName="Compare Drawings"
          message="Compare Drawings diffs a new revision against the sheet in the field and flags every scope, dimension, and note change with its likely cost or schedule impact."
          projects={projects}
          onPick={setPickedProjectId}
        />
      </View>
    );
  }

  // Full-screen crane + rotating facts during the 30-60s AI compare (was a tiny
  // centered spinner on an otherwise empty screen).
  if (step === 'analyzing') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="COMPARE DRAWINGS · MAGE ID" title={project.name} />
        <CraneLoader label="Comparing sheets" facts={CONSTRUCTION_FACTS} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ToolHeader eyebrow="COMPARE DRAWINGS · MAGE ID" title={project.name} />
      <ScrollView {...fabScroll} style={styles.container} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>

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
                  <ArrowUpRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
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
              <FileText size={16} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.primaryBtnText}>Pick new revision (PDF)</Text>
            </TouchableOpacity>

            {error && (
              <View style={styles.errorBanner}>
                <AlertCircle size={14} color={themeColors.danger} strokeWidth={1.75} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </>
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

            {/* File the revision. Until this happens the plan set still shows
                the OLD sheet as current, and the super opens it in the field. */}
            {filing ? (
              <View style={styles.fileCard}>
                <View style={styles.fileCardHead}>
                  <Layers size={15} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.fileCardTitle}>Put this revision in the plan set</Text>
                </View>
                {filing.kind === 'ready' ? (
                  <>
                    <Text style={styles.fileCardBody}>
                      {sheetCitation(oldSheet)} stays in the field until the new copy is filed. Filing marks it superseded and the viewer warns anyone who opens it.
                    </Text>
                    <TouchableOpacity onPress={handleFileRevision} style={styles.fileBtn} activeOpacity={0.85} testID="compare-file-revision">
                      <FilePlus2 size={15} color={Colors.textOnAccent} strokeWidth={1.75} />
                      <Text style={styles.fileBtnText}>{filing.label}</Text>
                    </TouchableOpacity>
                  </>
                ) : filing.kind === 'filed' ? (
                  <>
                    <View style={styles.doneRow}>
                      <Check size={14} color={themeColors.successLabel} strokeWidth={2} />
                      <Text style={styles.doneText}>{filing.label}</Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => router.push({ pathname: '/plan-viewer' as never, params: { sheetId: filed?.sheetId ?? '' } as never })}
                      style={styles.linkBtn}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.linkBtnText}>Open the filed sheet</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  /* Disabled controls say why (house rule) — and what to do. */
                  <Text style={styles.fileCardBlocked}>{filing.reason}</Text>
                )}
              </View>
            ) : null}

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
                      {/* The change, the place, and the drawing it came from,
                          carried into the CO — no retyping from memory. */}
                      <TouchableOpacity
                        onPress={() => handleStartChangeOrder(i)}
                        style={styles.rowBtn}
                        activeOpacity={0.8}
                        testID={`compare-start-co-${i}`}
                      >
                        <FilePlus2 size={13} color={themeColors.accent} strokeWidth={1.75} />
                        <Text style={styles.rowBtnText}>{coSaved[i] ? `Open CO #${coSaved[i].number}` : 'Start change order'}</Text>
                      </TouchableOpacity>
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
                    <Info size={14} color={themeColors.info} strokeWidth={1.75} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rfiSubject}>{r.subject}</Text>
                      <Text style={styles.rfiQuestion}>{r.question}</Text>
                      {rfiByIndex[i] ? (
                        <View style={styles.doneRow}>
                          <Check size={13} color={themeColors.successLabel} strokeWidth={2} />
                          <Text style={styles.doneText}>Created as RFI #{rfiByIndex[i]}, linked to {oldSheet.sheetNumber || oldSheet.name}</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          onPress={() => handleCreateRfi(i)}
                          style={styles.rowBtn}
                          activeOpacity={0.8}
                          testID={`compare-create-rfi-${i}`}
                        >
                          <MessageSquarePlus size={13} color={themeColors.accent} strokeWidth={1.75} />
                          <Text style={styles.rowBtnText}>Create RFI</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </>
            )}

            <TouchableOpacity onPress={handleDone} style={styles.primaryBtn} activeOpacity={0.85} testID="compare-done">
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function iconForType(t: ChangeType) {
  if (t === 'added') return <Plus size={14} color="#FFF" strokeWidth={1.75} />;
  if (t === 'removed') return <Minus size={14} color="#FFF" strokeWidth={1.75} />;
  if (t === 'modified') return <Pencil size={14} color="#FFF" strokeWidth={1.75} />;
  return <Info size={14} color="#FFF" strokeWidth={1.75} />;
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
    backgroundColor: t.accentFill,
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

  fileCard: {
    // The four properties that must agree app-wide come from cardSurface; only
    // the accent hairline (this card is the one that WRITES to the plan set)
    // and the layout are overlaid.
    ...cardSurface(t, { radius: 'card', pad: 14, bordered: true }),
    borderColor: t.accent + '33',
    marginHorizontal: 16, marginBottom: 12, gap: 8,
  },
  fileCardHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  fileCardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  fileCardBody: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  fileCardBlocked: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17 },
  fileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: Tokens.radius.md, backgroundColor: t.accentFill,
  },
  fileBtnText: { color: Colors.textOnAccent, fontSize: Type.subhead.fontSize, fontWeight: '700' },
  linkBtn: { alignSelf: 'flex-start' },
  linkBtnText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  doneText: { fontSize: Type.caption1.fontSize, color: t.successLabel, flex: 1, lineHeight: 17 },
  rowBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    marginTop: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.accent + '44',
  },
  rowBtnText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' },

  rfiCard: {
    marginHorizontal: 16, marginBottom: 8, padding: 12,
    borderRadius: Tokens.radius.md, backgroundColor: t.info + '10',
    borderWidth: 1, borderColor: t.info + '30',
    flexDirection: 'row', gap: 8,
  },
  rfiSubject: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, marginBottom: 4 },
  rfiQuestion: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
});
