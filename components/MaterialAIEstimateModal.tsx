// MaterialAIEstimateModal — "Ask AI" UI for the materials cart.
//
// Triggered from the Estimate tab cart view (the cart modal). User types a
// short project description and gets back per-item suggestions (quantity +
// markup), a labor estimate range, and a few overall recommendations.
//
// Each suggestion card has two apply buttons — "Apply qty" and "Apply markup"
// — that call updateQuantity / updateMarkup on the MaterialCartContext.
// We never auto-apply: the user must explicitly tap to commit.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, TextInput,
  ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView, Pressable,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  X, Sparkles, CheckCircle, Lightbulb, HardHat, Percent, Hash, RefreshCw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useMaterialCart } from '@/contexts/MaterialCartContext';
import {
  aiSuggestMaterialEstimate,
  type AIMaterialEstimateResult,
  type AIMaterialSuggestion,
} from '@/utils/materialEstimateAI';
import { formatMoney } from '@/utils/formatters';

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Small "Applied" badge that fades the apply button after the user taps it.
// Mirrors the inline confirmation pattern used elsewhere in the app.
type AppliedField = 'qty' | 'markup';
type AppliedMap = Record<string, Set<AppliedField>>;

const QUICK_PROMPTS = [
  'Kitchen remodel, 200sf, mid-grade finishes',
  'Bathroom remodel, 60sf, premium tile',
  'Deck build, 300sf composite, with railing',
  '2-car garage addition, 600sf',
  'Roof replacement, 2200sf, architectural shingles',
];

export default React.memo(function MaterialAIEstimateModal({ visible, onClose }: Props) {
  const { cart, updateQuantity, updateMarkup } = useMaterialCart();
  const [description, setDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<AIMaterialEstimateResult | null>(null);
  const [appliedMap, setAppliedMap] = useState<AppliedMap>({});

  // Reset transient state when the modal closes so the user gets a fresh
  // session next time. The description survives if they want to re-run.
  const handleClose = useCallback(() => {
    setResult(null);
    setAppliedMap({});
    setIsLoading(false);
    onClose();
  }, [onClose]);

  const handleGenerate = useCallback(async () => {
    const desc = description.trim();
    if (!desc) return;
    if (cart.length === 0) return;
    setIsLoading(true);
    setResult(null);
    setAppliedMap({});
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const res = await aiSuggestMaterialEstimate(cart, desc);
      setResult(res);
      if (Platform.OS !== 'web') {
        if (res.perItem.length > 0) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        }
      }
    } catch (err) {
      console.error('[MaterialAIEstimateModal] generate failed:', err);
      setResult({
        perItem: [],
        laborEstimateRange: { low: 0, high: 0, rationale: 'AI request failed.' },
        overallRecommendations: [],
        summary: 'AI request failed. Try again in a moment.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [description, cart]);

  const handleApplyQuantity = useCallback((s: AIMaterialSuggestion) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Round non-integer quantities for countable units. We don't know the
    // unit here (the suggestion stores material id only), so we let the
    // upstream value through verbatim — the cart treats quantity as a
    // number, and the AI is instructed to use integers for countable units.
    updateQuantity(s.materialId, s.suggestedQuantity);
    setAppliedMap(prev => {
      const next: AppliedMap = { ...prev };
      const set = new Set(next[s.materialId] ?? []);
      set.add('qty');
      next[s.materialId] = set;
      return next;
    });
  }, [updateQuantity]);

  const handleApplyMarkup = useCallback((s: AIMaterialSuggestion) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updateMarkup(s.materialId, s.suggestedMarkup);
    setAppliedMap(prev => {
      const next: AppliedMap = { ...prev };
      const set = new Set(next[s.materialId] ?? []);
      set.add('markup');
      next[s.materialId] = set;
      return next;
    });
  }, [updateMarkup]);

  // Find current quantity / markup for a suggestion so we can show the delta.
  const lookupCurrent = useCallback(
    (materialId: string): { quantity: number; markup: number } | null => {
      const found = cart.find(i => i.material.id === materialId);
      if (!found) return null;
      return { quantity: found.quantity, markup: found.markup };
    },
    [cart],
  );

  const headerSubtitle = useMemo(() => {
    if (isLoading) return 'Tuning cart for your project…';
    if (result) {
      if (result.errorKind) return result.summary;
      return `${result.perItem.length} suggestion${result.perItem.length === 1 ? '' : 's'} · ${cart.length} cart item${cart.length === 1 ? '' : 's'}`;
    }
    return `${cart.length} cart item${cart.length === 1 ? '' : 's'} ready for AI review`;
  }, [isLoading, result, cart.length]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIcon}>
                <Sparkles size={18} color={Colors.surface} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Ask AI</Text>
                <Text style={styles.headerSub}>{headerSubtitle}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="ai-modal-close"
            >
              <X size={20} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.fieldLabel}>Project description</Text>
            <TextInput
              style={styles.textArea}
              value={description}
              onChangeText={setDescription}
              placeholder="Kitchen remodel, 200sf, mid-grade finishes…"
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              testID="ai-desc-input"
            />

            <View style={styles.promptsRow}>
              {QUICK_PROMPTS.map(p => (
                <TouchableOpacity
                  key={p}
                  style={styles.promptChip}
                  onPress={() => setDescription(p)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.promptChipText} numberOfLines={1}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.generateBtn, (isLoading || !description.trim() || cart.length === 0) && styles.generateBtnDisabled]}
              onPress={handleGenerate}
              disabled={isLoading || !description.trim() || cart.length === 0}
              activeOpacity={0.85}
              testID="ai-generate-btn"
            >
              {isLoading ? (
                <>
                  <ActivityIndicator size="small" color={Colors.surface} />
                  <Text style={styles.generateBtnText}>Generating… (20–40s)</Text>
                </>
              ) : (
                <>
                  {result ? <RefreshCw size={16} color={Colors.surface} /> : <Sparkles size={16} color={Colors.surface} />}
                  <Text style={styles.generateBtnText}>{result ? 'Regenerate' : 'Generate suggestions'}</Text>
                </>
              )}
            </TouchableOpacity>

            {isLoading ? (
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  // Drop the in-flight wait — we don't truly abort the
                  // fetch (mageAI owns the AbortController) but flipping
                  // isLoading off restores the form so the user can retry
                  // or change their description.
                  setIsLoading(false);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
                accessibilityRole="button"
                accessibilityLabel="Cancel AI generation"
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}

            {cart.length === 0 && (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  Add materials to your cart first — the AI tunes existing items, it doesn't pick new ones.
                </Text>
              </View>
            )}

            {result && result.errorKind && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>
                  {result.errorDetail || result.summary || 'AI returned an error.'}
                </Text>
              </View>
            )}

            {result && result.overallRecommendations.length > 0 && (
              <View style={styles.recBlock}>
                <View style={styles.recHeader}>
                  <Lightbulb size={14} color={Colors.warning} />
                  <Text style={styles.recHeaderText}>Overall recommendations</Text>
                </View>
                {result.overallRecommendations.map((r, idx) => (
                  <View key={idx} style={styles.recRow}>
                    <View style={styles.recBullet} />
                    <Text style={styles.recText}>{r}</Text>
                  </View>
                ))}
              </View>
            )}

            {result && (result.laborEstimateRange.low > 0 || result.laborEstimateRange.high > 0) && (
              <View style={styles.laborBlock}>
                <View style={styles.recHeader}>
                  <HardHat size={14} color={Colors.accent} />
                  <Text style={styles.recHeaderText}>Labor estimate range</Text>
                </View>
                <Text style={styles.laborRange}>
                  {formatMoney(result.laborEstimateRange.low, 0)} – {formatMoney(result.laborEstimateRange.high, 0)}
                </Text>
                {result.laborEstimateRange.rationale ? (
                  <Text style={styles.laborRationale}>{result.laborEstimateRange.rationale}</Text>
                ) : null}
              </View>
            )}

            {result && result.perItem.length > 0 && (
              <View style={{ marginTop: 8 }}>
                <Text style={styles.sectionTitle}>
                  Per-item suggestions ({result.perItem.length})
                </Text>
                {result.perItem.map(s => {
                  const current = lookupCurrent(s.materialId);
                  const qtyApplied = appliedMap[s.materialId]?.has('qty') ?? false;
                  const markupApplied = appliedMap[s.materialId]?.has('markup') ?? false;
                  const qtyDelta = current ? s.suggestedQuantity - current.quantity : 0;
                  const markupDelta = current ? s.suggestedMarkup - current.markup : 0;
                  return (
                    <View key={s.materialId} style={styles.suggestionCard}>
                      <Text style={styles.suggestionName} numberOfLines={2}>{s.materialName}</Text>
                      {s.rationale ? (
                        <Text style={styles.suggestionRationale}>{s.rationale}</Text>
                      ) : null}

                      <View style={styles.suggestionRow}>
                        <View style={styles.suggestionLeft}>
                          <View style={styles.suggestionMetric}>
                            <Hash size={11} color={Colors.textSecondary} />
                            <Text style={styles.suggestionMetricLabel}>Quantity</Text>
                          </View>
                          <Text style={styles.suggestionValue}>
                            {current ? `${current.quantity} → ` : ''}
                            <Text style={styles.suggestionValueAccent}>{s.suggestedQuantity}</Text>
                            {qtyDelta !== 0 && current ? (
                              <Text style={styles.suggestionDelta}>
                                {' '}({qtyDelta > 0 ? '+' : ''}{qtyDelta})
                              </Text>
                            ) : null}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.applyBtn, qtyApplied && styles.applyBtnApplied]}
                          onPress={() => handleApplyQuantity(s)}
                          activeOpacity={0.8}
                          disabled={qtyApplied}
                          testID={`apply-qty-${s.materialId}`}
                        >
                          {qtyApplied ? (
                            <>
                              <CheckCircle size={13} color={Colors.success} />
                              <Text style={[styles.applyBtnText, { color: Colors.success }]}>Applied</Text>
                            </>
                          ) : (
                            <Text style={styles.applyBtnText}>Apply qty</Text>
                          )}
                        </TouchableOpacity>
                      </View>

                      <View style={styles.suggestionRow}>
                        <View style={styles.suggestionLeft}>
                          <View style={styles.suggestionMetric}>
                            <Percent size={11} color={Colors.textSecondary} />
                            <Text style={styles.suggestionMetricLabel}>Markup</Text>
                          </View>
                          <Text style={styles.suggestionValue}>
                            {current ? `${current.markup}% → ` : ''}
                            <Text style={styles.suggestionValueAccent}>{s.suggestedMarkup}%</Text>
                            {markupDelta !== 0 && current ? (
                              <Text style={styles.suggestionDelta}>
                                {' '}({markupDelta > 0 ? '+' : ''}{markupDelta}%)
                              </Text>
                            ) : null}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.applyBtn, markupApplied && styles.applyBtnApplied]}
                          onPress={() => handleApplyMarkup(s)}
                          activeOpacity={0.8}
                          disabled={markupApplied}
                          testID={`apply-markup-${s.materialId}`}
                        >
                          {markupApplied ? (
                            <>
                              <CheckCircle size={13} color={Colors.success} />
                              <Text style={[styles.applyBtnText, { color: Colors.success }]}>Applied</Text>
                            </>
                          ) : (
                            <Text style={styles.applyBtnText}>Apply markup</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {result && result.perItem.length === 0 && !result.errorKind && (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  AI didn&apos;t return per-item suggestions. Try a more specific description (size, finishes, scope).
                </Text>
              </View>
            )}

            <Pressable style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  headerIcon: {
    width: 32, height: 32, borderRadius: Tokens.radius.md,
    backgroundColor: '#5E5CE6',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: Colors.text },
  headerSub: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, marginTop: 1 },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.full,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  fieldLabel: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  textArea: {
    minHeight: 72,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.text,
  },
  promptsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  promptChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: '100%',
  },
  promptChipText: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary },
  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
    paddingVertical: 14,
    borderRadius: Tokens.radius.lg,
    backgroundColor: '#5E5CE6',
  },
  generateBtnDisabled: { opacity: 0.45 },
  cancelBtn: {
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text,
  },
  generateBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: Colors.surface,
  },
  notice: {
    marginTop: 14,
    padding: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.surfaceAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noticeText: { fontSize: Type.footnote.fontSize, color: Colors.textSecondary, lineHeight: 18 },
  errorBanner: {
    marginTop: 12,
    padding: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.errorLight,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  errorBannerText: { fontSize: Type.footnote.fontSize, color: Colors.errorDark },
  recBlock: {
    marginTop: 16,
    padding: 14,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  recHeaderText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: 0.2,
  },
  recRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  recBullet: {
    width: 5, height: 5, borderRadius: Tokens.radius.full, marginTop: 7,
    backgroundColor: Colors.accent,
  },
  recText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: Colors.text, lineHeight: 19 },
  laborBlock: {
    marginTop: 12,
    padding: 14,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  laborRange: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
    color: Colors.accent,
    marginTop: 4,
  },
  laborRationale: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: 4,
    lineHeight: 17,
  },
  sectionTitle: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.4,
    marginTop: 18,
    marginBottom: 8,
    textTransform: 'uppercase' as const,
  },
  suggestionCard: {
    padding: 14,
    borderRadius: Tokens.radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    gap: 8,
  },
  suggestionName: { fontSize: Type.callout.fontSize, fontWeight: '600' as const, color: Colors.text },
  suggestionRationale: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textSecondary,
    lineHeight: 17,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  suggestionLeft: { flex: 1, gap: 2 },
  suggestionMetric: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  suggestionMetricLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  suggestionValue: { fontSize: Type.bodyCompact.fontSize, color: Colors.textSecondary },
  suggestionValueAccent: { color: Colors.text, fontWeight: '600' as const },
  suggestionDelta: { color: Colors.accent, fontWeight: '600' as const },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Tokens.radius.sm,
    backgroundColor: Colors.primary,
  },
  applyBtnApplied: { backgroundColor: Colors.successLight },
  applyBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: Colors.surface,
  },
});
