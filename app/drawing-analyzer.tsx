import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, Platform, Image,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, FileUp, Sparkles, ShieldAlert, Eye, AlertTriangle, CheckCircle2,
  HelpCircle, FileText, RefreshCw, ChevronRight,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { uploadAndRenderPdf, type RenderedPlanPage } from '@/utils/pdfRenderClient';
import { analyzeDrawings, type DrawingAnalysisResult } from '@/utils/drawingAnalyzer';
import { formatMoney } from '@/utils/formatters';

type Step = 'idle' | 'uploading' | 'analyzing' | 'review';

export default function DrawingAnalyzerScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('ai_estimate_wizard')) {
    return (
      <Paywall
        visible={true}
        feature="AI Drawing Analyzer"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <DrawingAnalyzerInner />;
}

function DrawingAnalyzerInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, getProject, settings } = useProjects();

  const [step, setStep] = useState<Step>('idle');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [pages, setPages] = useState<RenderedPlanPage[]>([]);
  const [result, setResult] = useState<DrawingAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedProjectId, setPickedProjectId] = useState<string | undefined>(paramProjectId);

  const project = useMemo(() =>
    pickedProjectId ? getProject(pickedProjectId) : undefined,
    [pickedProjectId, getProject],
  );

  const handlePick = useCallback(async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;

      const asset = picked.assets[0];
      setUploadedFileName(asset.name);
      setStep('uploading');
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Render the PDF to PNG pages via the existing pipeline.
      const rendered = await uploadAndRenderPdf({
        fileUri: asset.uri,
        projectId: pickedProjectId ?? 'tmp',
        fileName: asset.name,
        dpi: 150,
        maxPages: 12,
      });
      setPages(rendered);

      // Hand off to the analyzer with project context if available.
      setStep('analyzing');
      const analysis = await analyzeDrawings({
        pageUrls: rendered.map(p => p.publicUrl),
        projectName: project?.name,
        projectType: project?.type,
        squareFootage: project?.squareFootage,
        location: project?.location,
        quality: (project?.quality as 'standard' | 'premium' | 'luxury' | undefined) ?? undefined,
      });
      setResult(analysis);
      setStep('review');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('[DrawingAnalyzer] failed', e);
      setError(String((e as Error).message ?? e));
      setStep('idle');
    }
  }, [pickedProjectId, project]);

  const handleReset = useCallback(() => {
    setStep('idle');
    setPages([]);
    setResult(null);
    setError(null);
    setUploadedFileName(null);
  }, []);

  const handleUseAsEstimate = useCallback(() => {
    if (!result) return;
    Alert.alert(
      'Use as starting point?',
      'This drops the AI estimate into a new project (or the selected one) so you can edit before sending. You\'ll review every line item before it\'s final.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            // For now we just navigate to the estimate screen with the
            // analyzed data passed as params. Extending this to fully
            // hydrate an estimate is a follow-up — the AI output isn't a
            // 1:1 match for the EstimateBreakdown shape.
            router.push({
              pathname: '/estimate' as never,
              params: { fromAnalyzer: '1', projectId: pickedProjectId } as never,
            });
          },
        },
      ],
    );
  }, [result, router, pickedProjectId]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>AI drawing analyzer</Text>
          <Text style={styles.title}>Drop in plans, get a starting estimate</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Project picker (optional context) */}
        {step === 'idle' && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Project (optional context)</Text>
            <Text style={styles.cardHelper}>
              Adding a project tells the AI your square footage, location, and quality tier so the unit pricing is regional + tier-appropriate.
            </Text>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, !pickedProjectId && styles.chipActive]}
                onPress={() => setPickedProjectId(undefined)}
              >
                <Text style={[styles.chipText, !pickedProjectId && styles.chipTextActive]}>Standalone</Text>
              </TouchableOpacity>
              {projects.slice(0, 6).map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.chip, pickedProjectId === p.id && styles.chipActive]}
                  onPress={() => setPickedProjectId(p.id)}
                >
                  <Text style={[styles.chipText, pickedProjectId === p.id && styles.chipTextActive]} numberOfLines={1}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Upload card */}
        {step === 'idle' && (
          <TouchableOpacity style={styles.uploadCard} onPress={handlePick} activeOpacity={0.85}>
            <View style={styles.uploadIcon}>
              <FileUp size={34} color={Colors.primary} />
            </View>
            <Text style={styles.uploadTitle}>Upload a drawings PDF</Text>
            <Text style={styles.uploadBody}>
              Architectural plans, MEP, schedules — up to 12 pages. The AI returns a CSI-organized estimate with full reasoning.
            </Text>
            <View style={styles.uploadCta}>
              <Sparkles size={14} color="#FFF" />
              <Text style={styles.uploadCtaText}>Pick a PDF</Text>
            </View>
            <Text style={styles.uploadHint}>
              Each page is converted to an image and sent to Gemini. Drawings are stored in your project's plans bucket.
            </Text>
          </TouchableOpacity>
        )}

        {error && step === 'idle' && (
          <View style={styles.errorCard}>
            <AlertTriangle size={16} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.errorRetry} onPress={() => setError(null)}>
              <Text style={styles.errorRetryText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Progress */}
        {(step === 'uploading' || step === 'analyzing') && (
          <View style={styles.progressCard}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.progressTitle}>
              {step === 'uploading' ? 'Rendering PDF pages…' : 'Reading drawings + estimating…'}
            </Text>
            <Text style={styles.progressBody}>
              {step === 'uploading'
                ? `Converting ${uploadedFileName ?? 'your PDF'} to high-res page images.`
                : `Gemini is looking at ${pages.length} page${pages.length === 1 ? '' : 's'}, identifying scope, and pricing it. This can take 30-60 seconds.`}
            </Text>
          </View>
        )}

        {/* Result */}
        {step === 'review' && result && (
          <ResultView
            result={result}
            pages={pages}
            onReset={handleReset}
            onUse={handleUseAsEstimate}
          />
        )}
      </ScrollView>
    </View>
  );
}

function ResultView({ result, pages, onReset, onUse }: {
  result: DrawingAnalysisResult;
  pages: RenderedPlanPage[];
  onReset: () => void;
  onUse: () => void;
}) {
  const lineItemsByCategory = useMemo(() => {
    const map = new Map<string, typeof result.lineItems>();
    for (const li of result.lineItems) {
      const existing = map.get(li.category) ?? [];
      existing.push(li);
      map.set(li.category, existing);
    }
    return Array.from(map.entries());
  }, [result.lineItems]);

  const confidenceColor =
    result.confidenceOverall === 'high' ? Colors.success
    : result.confidenceOverall === 'medium' ? Colors.warning
    : Colors.error;

  return (
    <View>
      {/* Summary card with overall confidence */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryHead}>
          <View style={[styles.confidenceBadge, { backgroundColor: confidenceColor + '15' }]}>
            <View style={[styles.confidenceDot, { backgroundColor: confidenceColor }]} />
            <Text style={[styles.confidenceText, { color: confidenceColor }]}>
              {result.confidenceOverall.toUpperCase()} confidence
            </Text>
          </View>
          <TouchableOpacity onPress={onReset} hitSlop={6}>
            <RefreshCw size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.summaryTitle}>{result.summary}</Text>
        <Text style={styles.summarySub}>{result.confidenceExplanation}</Text>
        <View style={styles.summaryGrand}>
          <Text style={styles.summaryGrandLabel}>AI starting estimate</Text>
          <Text style={styles.summaryGrandValue}>{formatMoney(result.totals.grandTotal)}</Text>
        </View>
        <View style={styles.summarySplit}>
          <View style={styles.summarySplitItem}>
            <Text style={styles.summarySplitLabel}>Subtotal</Text>
            <Text style={styles.summarySplitValue}>{formatMoney(result.totals.subtotal)}</Text>
          </View>
          <View style={styles.summarySplitDivider} />
          <View style={styles.summarySplitItem}>
            <Text style={styles.summarySplitLabel}>Contingency ({result.totals.contingencyPercent}%)</Text>
            <Text style={styles.summarySplitValue}>{formatMoney(result.totals.contingencyAmount)}</Text>
          </View>
        </View>
      </View>

      {/* What the AI looked at */}
      <SectionHeader icon={<Eye size={16} color={Colors.primary} />} title="What the AI looked at" />
      <Text style={styles.sectionHelper}>
        Verify these match what you uploaded. If a page is read &quot;poor,&quot; rerun with a higher-resolution scan.
      </Text>
      <View style={styles.cardList}>
        {result.drawingsSeen.map((d, idx) => {
          const page = pages.find(p => p.pageNumber === d.page);
          const readabilityColor =
            d.readability === 'clear' ? Colors.success
            : d.readability === 'partial' ? Colors.warning
            : Colors.error;
          return (
            <View key={idx} style={styles.drawingCard}>
              {page?.publicUrl && (
                <Image
                  source={{ uri: page.publicUrl }}
                  style={styles.drawingThumb}
                  resizeMode="cover"
                />
              )}
              <View style={{ flex: 1 }}>
                <View style={styles.drawingHead}>
                  <Text style={styles.drawingPage}>Page {d.page}</Text>
                  <View style={[styles.readabilityPill, { backgroundColor: readabilityColor + '15' }]}>
                    <Text style={[styles.readabilityText, { color: readabilityColor }]}>{d.readability}</Text>
                  </View>
                </View>
                <Text style={styles.drawingType}>{d.type}</Text>
                <Text style={styles.drawingScope} numberOfLines={3}>{d.scope}</Text>
                {d.keyDimensions && d.keyDimensions.length > 0 && (
                  <Text style={styles.drawingDims} numberOfLines={2}>
                    Read: {d.keyDimensions.join(' · ')}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Concerns */}
      {result.concerns && result.concerns.length > 0 && (
        <>
          <SectionHeader
            icon={<ShieldAlert size={16} color={Colors.warning} />}
            title="Areas of concern"
          />
          <Text style={styles.sectionHelper}>
            What the AI flagged that needs your attention before relying on these numbers.
          </Text>
          <View style={styles.cardList}>
            {result.concerns.map((c, idx) => {
              const sevColor =
                c.severity === 'critical' ? Colors.error
                : c.severity === 'moderate' ? Colors.warning
                : Colors.textMuted;
              return (
                <View key={idx} style={[styles.concernCard, { borderLeftColor: sevColor }]}>
                  <View style={styles.concernHead}>
                    <View style={[styles.severityPill, { backgroundColor: sevColor + '15' }]}>
                      <Text style={[styles.severityText, { color: sevColor }]}>{c.severity}</Text>
                    </View>
                    <Text style={styles.concernTopic}>{c.topic}</Text>
                  </View>
                  <Text style={styles.concernDetail}>{c.detail}</Text>
                  <View style={styles.concernRec}>
                    <Text style={styles.concernRecLabel}>Recommendation</Text>
                    <Text style={styles.concernRecText}>{c.recommendation}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* Double-check list */}
      {result.doubleCheck && result.doubleCheck.length > 0 && (
        <>
          <SectionHeader
            icon={<HelpCircle size={16} color={Colors.primary} />}
            title="Double-check before sending"
          />
          <View style={styles.checklistCard}>
            {result.doubleCheck.map((item, idx) => (
              <View key={idx} style={styles.checklistRow}>
                <View style={styles.checklistDot} />
                <Text style={styles.checklistText}>{item}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Missing scopes */}
      {result.missingScopes && result.missingScopes.length > 0 && (
        <>
          <SectionHeader
            icon={<AlertTriangle size={16} color={Colors.warning} />}
            title="Scopes not included in these drawings"
          />
          <View style={styles.checklistCard}>
            {result.missingScopes.map((item, idx) => (
              <View key={idx} style={styles.checklistRow}>
                <View style={[styles.checklistDot, { backgroundColor: Colors.warning }]} />
                <Text style={styles.checklistText}>{item}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {/* Line items grouped by category */}
      <SectionHeader
        icon={<FileText size={16} color={Colors.primary} />}
        title={`Line items (${result.lineItems.length})`}
      />
      <Text style={styles.sectionHelper}>
        Each item shows the pages it came from + the AI&apos;s reasoning + a confidence rating. Low-confidence items deserve extra scrutiny.
      </Text>
      <View style={styles.cardList}>
        {lineItemsByCategory.map(([category, items]) => (
          <View key={category} style={styles.categoryGroup}>
            <Text style={styles.categoryLabel}>{category}</Text>
            {items.map((li, idx) => {
              const confColor =
                li.confidence === 'high' ? Colors.success
                : li.confidence === 'medium' ? Colors.warning
                : Colors.error;
              return (
                <View key={idx} style={styles.lineItem}>
                  <View style={styles.lineItemHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineItemName}>{li.name}</Text>
                      {li.description ? (
                        <Text style={styles.lineItemDesc} numberOfLines={2}>{li.description}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.lineItemTotal}>{formatMoney(li.total)}</Text>
                  </View>
                  <View style={styles.lineItemMeta}>
                    <Text style={styles.lineItemMetaText}>
                      {li.quantity} {li.unit} @ {formatMoney(li.unitPrice, 2)}
                    </Text>
                    <View style={[styles.miniPill, { backgroundColor: confColor + '15' }]}>
                      <Text style={[styles.miniPillText, { color: confColor }]}>{li.confidence}</Text>
                    </View>
                    <Text style={styles.lineItemPages}>
                      pp. {li.sourcePages.join(', ')}
                    </Text>
                  </View>
                  {li.reasoning ? (
                    <View style={styles.reasoningWrap}>
                      <Text style={styles.reasoningLabel}>AI reasoning</Text>
                      <Text style={styles.reasoningText}>{li.reasoning}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>

      {/* CTA bar */}
      <View style={styles.ctaBar}>
        <TouchableOpacity style={styles.ctaSecondary} onPress={onReset}>
          <Text style={styles.ctaSecondaryText}>Run on a different PDF</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctaPrimary} onPress={onUse}>
          <CheckCircle2 size={16} color="#FFF" />
          <Text style={styles.ctaPrimaryText}>Use as starting point</Text>
          <ChevronRight size={14} color="#FFF" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderIcon}>{icon}</View>
      <Text style={styles.sectionHeaderText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: 4 },

  card: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 14,
  },
  cardLabel: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  cardHelper: { fontSize: 12, color: Colors.textMuted, marginTop: 4, marginBottom: 10, lineHeight: 17 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
    maxWidth: 200,
  },
  chipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.text },
  chipTextActive: { color: '#FFF' },

  uploadCard: {
    backgroundColor: Colors.primary + '0D',
    borderRadius: 18, padding: 28,
    borderWidth: 1.5, borderColor: Colors.primary + '40',
    borderStyle: 'dashed',
    alignItems: 'center', gap: 8,
    marginBottom: 14,
  },
  uploadIcon: {
    width: 64, height: 64, borderRadius: 18,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 6,
  },
  uploadTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, marginTop: 4 },
  uploadBody: { fontSize: 13, color: Colors.text, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  uploadCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12,
    backgroundColor: Colors.primary, marginTop: 10,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  uploadCtaText: { color: '#FFF', fontSize: 14, fontWeight: '700' },
  uploadHint: { fontSize: 11, color: Colors.textMuted, textAlign: 'center', lineHeight: 15, marginTop: 8, fontStyle: 'italic' },

  errorCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    padding: 14, borderRadius: 12,
    backgroundColor: Colors.error + '0D',
    borderWidth: 1, borderColor: Colors.error + '30',
    marginBottom: 14,
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.error, lineHeight: 18 },
  errorRetry: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.error + '15' },
  errorRetryText: { fontSize: 12, fontWeight: '700', color: Colors.error },

  progressCard: {
    backgroundColor: Colors.card, borderRadius: 14, padding: 22,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', gap: 10,
  },
  progressTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  progressBody: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },

  summaryCard: {
    backgroundColor: Colors.card, borderRadius: 16, padding: 18,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 22,
  },
  summaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  confidenceBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  confidenceDot: { width: 7, height: 7, borderRadius: 4 },
  confidenceText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  summaryTitle: { fontSize: 15, fontWeight: '600', color: Colors.text, lineHeight: 22, marginBottom: 6 },
  summarySub: { fontSize: 12, color: Colors.textMuted, lineHeight: 18, marginBottom: 16 },
  summaryGrand: { alignItems: 'center', paddingTop: 8, paddingBottom: 16, borderTopWidth: 1, borderTopColor: Colors.border },
  summaryGrandLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  summaryGrandValue: { fontSize: 36, fontWeight: '800', color: Colors.text, letterSpacing: -1 },
  summarySplit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 14, borderTopWidth: 1, borderTopColor: Colors.border },
  summarySplitItem: { flex: 1, alignItems: 'center' },
  summarySplitDivider: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.border },
  summarySplitLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  summarySplitValue: { fontSize: 16, fontWeight: '800', color: Colors.text, marginTop: 4 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 4 },
  sectionHeaderIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  sectionHeaderText: { fontSize: 16, fontWeight: '800', color: Colors.text, letterSpacing: -0.2 },
  sectionHelper: { fontSize: 12, color: Colors.textMuted, marginBottom: 10, lineHeight: 17 },

  cardList: { gap: 8, marginBottom: 14 },

  drawingCard: {
    flexDirection: 'row', gap: 12,
    backgroundColor: Colors.card, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  drawingThumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: Colors.background },
  drawingHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  drawingPage: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  readabilityPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  readabilityText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  drawingType: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  drawingScope: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
  drawingDims: { fontSize: 11, color: Colors.text, marginTop: 6, fontStyle: 'italic' },

  concernCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, borderLeftWidth: 4,
    gap: 8,
  },
  concernHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  severityPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  severityText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  concernTopic: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.text },
  concernDetail: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  concernRec: { paddingTop: 6, borderTopWidth: 1, borderTopColor: Colors.border },
  concernRecLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  concernRecText: { fontSize: 13, color: Colors.text, lineHeight: 19 },

  checklistCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 14,
    gap: 10,
  },
  checklistRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checklistDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primary, marginTop: 7 },
  checklistText: { flex: 1, fontSize: 13, color: Colors.text, lineHeight: 18 },

  categoryGroup: { gap: 6 },
  categoryLabel: { fontSize: 11, fontWeight: '800', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1, marginTop: 6, marginBottom: 2 },
  lineItem: {
    backgroundColor: Colors.card, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.border,
    gap: 6,
  },
  lineItemHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lineItemName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  lineItemDesc: { fontSize: 12, color: Colors.textMuted, marginTop: 2, lineHeight: 17 },
  lineItemTotal: { fontSize: 15, fontWeight: '800', color: Colors.text },
  lineItemMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  lineItemMetaText: { fontSize: 12, color: Colors.textMuted, fontWeight: '600' },
  miniPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  miniPillText: { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  lineItemPages: { fontSize: 11, color: Colors.textMuted, marginLeft: 'auto' },
  reasoningWrap: { paddingTop: 6, borderTopWidth: 1, borderTopColor: Colors.border },
  reasoningLabel: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2 },
  reasoningText: { fontSize: 12, color: Colors.text, lineHeight: 17, fontStyle: 'italic' },

  ctaBar: {
    flexDirection: 'row', gap: 10, marginTop: 18, marginBottom: 8,
  },
  ctaSecondary: {
    flex: 1, paddingVertical: 13, borderRadius: 11,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaSecondaryText: { fontSize: 13, fontWeight: '700', color: Colors.text },
  ctaPrimary: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 13, borderRadius: 11, backgroundColor: Colors.primary,
  },
  ctaPrimaryText: { fontSize: 13, fontWeight: '700', color: '#FFF' },
});
