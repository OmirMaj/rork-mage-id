// Quick Estimate Wizard — 8 preset questions that feed mageAISmart for a
// fast, itemized construction estimate. Designed for the "I need a number
// now" moment where the full estimator is overkill.
//
// Flow:
//   Step 1 of 8 → project type
//   Step 2 of 8 → size
//   Step 3 of 8 → location
//   Step 4 of 8 → quality tier
//   Step 5 of 8 → scope summary
//   Step 6 of 8 → timeline
//   Step 7 of 8 → special requirements
//   Step 8 of 8 → budget target
//   → MAGE AI generates an itemized breakdown (materials, labor, permits,
//     contingency, subtotal, total)
//
// Result can be copied to clipboard or optionally dropped into a new
// project's estimate via the Projects context (left as a follow-up so the
// existing estimator isn't touched by this first pass).

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, Share,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, Sparkles, Building2, Home, Wrench,
  DollarSign, CheckCircle2, Share2, RotateCcw,
} from 'lucide-react-native';
import { z } from 'zod';
import { Colors } from '@/constants/colors';
import { mageAISmart } from '@/utils/mageAI';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';

interface WizardAnswers {
  projectType: string;
  sizeSqft: string;
  location: string;
  quality: 'budget' | 'standard' | 'high_end';
  scope: string;
  timelineWeeks: string;
  specialRequirements: string;
  targetBudget: string;
}

const PROJECT_TYPES = [
  'New Build',
  'Full Remodel',
  'Kitchen Remodel',
  'Bathroom Remodel',
  'Addition',
  'Basement Finish',
  'ADU / Backyard Build',
  'Commercial TI',
  'Roof Replacement',
  'Deck / Outdoor',
];

const QUALITY_LABELS: Record<WizardAnswers['quality'], string> = {
  budget: 'Budget',
  standard: 'Standard',
  high_end: 'High-End',
};

const estimateSchema = z.object({
  summary: z.string().catch('').default(''),
  lineItems: z.array(z.object({
    category: z.string().catch('').default('Other'),
    description: z.string().catch('').default(''),
    quantity: z.number().catch(1).default(1),
    unit: z.string().catch('ea').default('ea'),
    unitCost: z.number().catch(0).default(0),
    total: z.number().catch(0).default(0),
  })).default([]),
  subtotal: z.number().catch(0).default(0),
  contingency: z.number().catch(0).default(0),
  permits: z.number().catch(0).default(0),
  total: z.number().catch(0).default(0),
  notes: z.array(z.string()).default([]),
});

type EstimateResult = z.infer<typeof estimateSchema>;

const INITIAL: WizardAnswers = {
  projectType: '',
  sizeSqft: '',
  location: '',
  quality: 'standard',
  scope: '',
  timelineWeeks: '',
  specialRequirements: '',
  targetBudget: '',
};

export default function EstimateWizardScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('ai_estimate_wizard')) {
    return (
      <Paywall
        visible={true}
        feature="AI Estimate Wizard"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <EstimateWizardScreenInner />;
}

function EstimateWizardScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<number>(0);
  const [answers, setAnswers] = useState<WizardAnswers>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EstimateResult | null>(null);

  const TOTAL_STEPS = 8;

  const set = useCallback(<K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const canAdvance = useMemo(() => {
    switch (step) {
      case 0: return answers.projectType.length > 0;
      case 1: return answers.sizeSqft.trim().length > 0 && !isNaN(Number(answers.sizeSqft));
      case 2: return answers.location.trim().length > 0;
      case 3: return true;
      case 4: return answers.scope.trim().length > 10;
      case 5: return answers.timelineWeeks.trim().length > 0 && !isNaN(Number(answers.timelineWeeks));
      case 6: return true; // special requirements optional
      case 7: return true; // target budget optional
      default: return false;
    }
  }, [step, answers]);

  const next = useCallback(() => {
    if (!canAdvance) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep((s) => Math.min(TOTAL_STEPS - 1, s + 1));
  }, [canAdvance]);

  const back = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const generate = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setResult(null);

    const prompt = `You are a construction cost estimator producing a quick first-pass budget for a US contractor. Use the following inputs and return a JSON object with an itemized line-by-line estimate.

Inputs:
- Project type: ${answers.projectType}
- Size: ${answers.sizeSqft} sqft
- Location: ${answers.location}
- Quality tier: ${QUALITY_LABELS[answers.quality]}
- Scope: ${answers.scope}
- Timeline: ${answers.timelineWeeks} weeks
- Special requirements: ${answers.specialRequirements || 'None'}
- Target budget: ${answers.targetBudget || 'Not specified'}

Return JSON with:
- summary: one paragraph plain-English overview of the estimate
- lineItems: array of { category, description, quantity, unit, unitCost, total } (total = quantity * unitCost)
- subtotal: sum of all lineItems totals
- contingency: ~10% of subtotal
- permits: rough permit/fees estimate for the location
- total: subtotal + contingency + permits
- notes: array of caveats (e.g. "assumes standard finishes", "excludes landscaping")

Use current regional pricing where possible. Round reasonably. Keep it under 15 line items.`;

    const cacheKey = `wizard::${answers.projectType}::${answers.sizeSqft}::${answers.location}::${answers.quality}::${answers.scope.slice(0, 80)}`;

    try {
      const res = await mageAISmart(prompt, estimateSchema, cacheKey);
      if (!res.success || !res.data) {
        Alert.alert('Estimate failed', res.error ?? 'The AI returned an unexpected response. Please try again.');
      } else {
        setResult(res.data as EstimateResult);
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      Alert.alert('Estimate failed', err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      setLoading(false);
    }
  }, [answers, loading]);

  const share = useCallback(async () => {
    if (!result) return;
    const lines = [
      `MAGE ID Quick Estimate — ${answers.projectType}`,
      `${answers.sizeSqft} sqft, ${answers.location}`,
      '',
      result.summary,
      '',
      ...result.lineItems.map(
        (li) => `${li.category} · ${li.description}: ${li.quantity} ${li.unit} × $${li.unitCost.toFixed(2)} = $${li.total.toFixed(2)}`,
      ),
      '',
      `Subtotal: $${result.subtotal.toFixed(2)}`,
      `Contingency: $${result.contingency.toFixed(2)}`,
      `Permits: $${result.permits.toFixed(2)}`,
      `Total: $${result.total.toFixed(2)}`,
      '',
      ...(result.notes.length ? ['Notes:', ...result.notes.map((n) => `- ${n}`)] : []),
    ].join('\n');
    try {
      await Share.share({ message: lines, title: 'MAGE ID Quick Estimate' });
    } catch (err) {
      Alert.alert('Share failed', err instanceof Error ? err.message : 'Could not open share sheet.');
    }
  }, [result, answers]);

  const reset = useCallback(() => {
    setAnswers(INITIAL);
    setResult(null);
    setStep(0);
  }, []);

  const progressWidth = `${((step + 1) / TOTAL_STEPS) * 100}%` as const;

  if (result) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Quick Estimate' }} />
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100 }}>
          <View style={styles.resultHero}>
            <CheckCircle2 size={28} color={Colors.success} />
            <Text style={styles.resultHeroTitle}>Estimate Ready</Text>
            <Text style={styles.resultTotal}>${result.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            <Text style={styles.resultSubtitle}>{answers.projectType} · {answers.sizeSqft} sqft · {answers.location}</Text>
          </View>

          {result.summary ? <Text style={styles.resultBody}>{result.summary}</Text> : null}

          <Text style={styles.sectionTitle}>Line Items</Text>
          {result.lineItems.map((li, i) => (
            <View key={i} style={styles.lineItem}>
              <View style={{ flex: 1 }}>
                <Text style={styles.lineCategory}>{li.category}</Text>
                <Text style={styles.lineDesc}>{li.description}</Text>
                <Text style={styles.lineMeta}>{li.quantity} {li.unit} × ${li.unitCost.toFixed(2)}</Text>
              </View>
              <Text style={styles.lineTotal}>${li.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            </View>
          ))}

          <View style={styles.totalsBlock}>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalValue}>${result.subtotal.toLocaleString()}</Text></View>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Contingency</Text><Text style={styles.totalValue}>${result.contingency.toLocaleString()}</Text></View>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Permits</Text><Text style={styles.totalValue}>${result.permits.toLocaleString()}</Text></View>
            <View style={[styles.totalRow, styles.totalRowGrand]}>
              <Text style={styles.grandLabel}>Total</Text>
              <Text style={styles.grandValue}>${result.total.toLocaleString()}</Text>
            </View>
          </View>

          {result.notes.length > 0 && (
            <View style={styles.notesBlock}>
              <Text style={styles.sectionTitle}>Notes</Text>
              {result.notes.map((n, i) => (
                <Text key={i} style={styles.noteRow}>• {n}</Text>
              ))}
            </View>
          )}

          <Text style={styles.disclaimer}>
            AI-generated starting point. Review with actual supplier and sub quotes before committing.
          </Text>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={reset} activeOpacity={0.8} testID="wizard-reset">
              <RotateCcw size={16} color={Colors.text} />
              <Text style={styles.secondaryText}>New Estimate</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={share} activeOpacity={0.85} testID="wizard-share">
              <Share2 size={16} color="#FFF" />
              <Text style={styles.primaryText}>Share</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ title: 'Quick Estimate' }} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressWidth }]} />
          </View>
          <Text style={styles.progressLabel}>Step {step + 1} of {TOTAL_STEPS}</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 0 && (
            <StepCard
              icon={<Building2 size={28} color={Colors.primary} />}
              title="What kind of project?"
              subtitle="Pick the closest match — we'll refine in the next steps."
            >
              <View style={styles.chipWrap}>
                {PROJECT_TYPES.map((t) => {
                  const active = answers.projectType === t;
                  return (
                    <TouchableOpacity
                      key={t}
                      onPress={() => set('projectType', t)}
                      style={[styles.chip, active && styles.chipActive]}
                      activeOpacity={0.8}
                      testID={`wizard-type-${t}`}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </StepCard>
          )}

          {step === 1 && (
            <StepCard
              icon={<Home size={28} color={Colors.primary} />}
              title="How big is the project?"
              subtitle="Approximate square footage of the work area."
            >
              <TextInput
                value={answers.sizeSqft}
                onChangeText={(v) => set('sizeSqft', v.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 1500"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                style={styles.input}
                testID="wizard-size"
              />
              <Text style={styles.hint}>Square feet</Text>
            </StepCard>
          )}

          {step === 2 && (
            <StepCard
              icon={<Building2 size={28} color={Colors.primary} />}
              title="Where's the job?"
              subtitle="City and state — we use this for regional pricing."
            >
              <TextInput
                value={answers.location}
                onChangeText={(v) => set('location', v)}
                placeholder="e.g. Austin, TX"
                placeholderTextColor={Colors.textMuted}
                style={styles.input}
                testID="wizard-location"
              />
            </StepCard>
          )}

          {step === 3 && (
            <StepCard
              icon={<Sparkles size={28} color={Colors.primary} />}
              title="What quality tier?"
              subtitle="Drives material selection and labor assumptions."
            >
              <View style={styles.chipWrap}>
                {(['budget', 'standard', 'high_end'] as const).map((q) => {
                  const active = answers.quality === q;
                  return (
                    <TouchableOpacity
                      key={q}
                      onPress={() => set('quality', q)}
                      style={[styles.chip, active && styles.chipActive]}
                      activeOpacity={0.8}
                      testID={`wizard-quality-${q}`}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{QUALITY_LABELS[q]}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </StepCard>
          )}

          {step === 4 && (
            <StepCard
              icon={<Wrench size={28} color={Colors.primary} />}
              title="What's the scope?"
              subtitle="A few sentences on what you're actually building."
            >
              <TextInput
                value={answers.scope}
                onChangeText={(v) => set('scope', v)}
                placeholder="e.g. Gut kitchen, new cabinets and quartz counters, move the sink wall, add island with seating, replace floors."
                placeholderTextColor={Colors.textMuted}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                style={styles.textArea}
                testID="wizard-scope"
              />
            </StepCard>
          )}

          {step === 5 && (
            <StepCard
              icon={<Building2 size={28} color={Colors.primary} />}
              title="What's the timeline?"
              subtitle="Expected duration in weeks."
            >
              <TextInput
                value={answers.timelineWeeks}
                onChangeText={(v) => set('timelineWeeks', v.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 8"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                style={styles.input}
                testID="wizard-timeline"
              />
              <Text style={styles.hint}>Weeks</Text>
            </StepCard>
          )}

          {step === 6 && (
            <StepCard
              icon={<Sparkles size={28} color={Colors.primary} />}
              title="Any special requirements?"
              subtitle="Permits, LEED, historical, ADA, unusual access — optional."
            >
              <TextInput
                value={answers.specialRequirements}
                onChangeText={(v) => set('specialRequirements', v)}
                placeholder="e.g. Historic district review, second-floor access, ADA compliant bathroom."
                placeholderTextColor={Colors.textMuted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                style={styles.textArea}
                testID="wizard-special"
              />
            </StepCard>
          )}

          {step === 7 && (
            <StepCard
              icon={<DollarSign size={28} color={Colors.primary} />}
              title="Target budget?"
              subtitle="Optional. We'll flag if the estimate runs over."
            >
              <TextInput
                value={answers.targetBudget}
                onChangeText={(v) => set('targetBudget', v.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 75000"
                placeholderTextColor={Colors.textMuted}
                keyboardType="numeric"
                style={styles.input}
                testID="wizard-budget"
              />
              <Text style={styles.hint}>Dollars (optional)</Text>
            </StepCard>
          )}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            onPress={step === 0 ? () => router.back() : back}
            style={[styles.secondaryBtn, styles.footerBtn]}
            activeOpacity={0.8}
            testID="wizard-back"
          >
            <ChevronLeft size={18} color={Colors.text} />
            <Text style={styles.secondaryText}>{step === 0 ? 'Cancel' : 'Back'}</Text>
          </TouchableOpacity>
          {step < TOTAL_STEPS - 1 ? (
            <TouchableOpacity
              onPress={next}
              disabled={!canAdvance}
              style={[styles.primaryBtn, styles.footerBtn, !canAdvance && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              testID="wizard-next"
            >
              <Text style={styles.primaryText}>Next</Text>
              <ChevronRight size={18} color="#FFF" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={generate}
              disabled={loading}
              style={[styles.primaryBtn, styles.footerBtn, loading && styles.primaryBtnDisabled]}
              activeOpacity={0.85}
              testID="wizard-generate"
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Sparkles size={18} color="#FFF" />
                  <Text style={styles.primaryText}>Generate Estimate</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function StepCard({ icon, title, subtitle, children }: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View>
      <View style={styles.stepIconWrap}>{icon}</View>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepSubtitle}>{subtitle}</Text>
      <View style={{ marginTop: 16 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  progressWrap: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4,
  },
  progressTrack: {
    height: 4, backgroundColor: Colors.cardBorder, borderRadius: 2, overflow: 'hidden' as const,
  },
  progressFill: { height: '100%' as const, backgroundColor: Colors.primary },
  progressLabel: {
    fontSize: 12, color: Colors.textMuted, marginTop: 6, textAlign: 'center' as const,
  },
  stepIconWrap: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primary + '14',
    alignItems: 'center' as const, justifyContent: 'center' as const,
    marginBottom: 12,
  },
  stepTitle: { fontSize: 24, fontWeight: '700' as const, color: Colors.text, marginBottom: 6 },
  stepSubtitle: { fontSize: 15, color: Colors.textMuted, lineHeight: 21 },
  chipWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  chipTextActive: { color: '#FFF' },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: Colors.text,
  },
  textArea: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
    borderRadius: 12, padding: 12, minHeight: 120,
    fontSize: 15, color: Colors.text,
  },
  hint: { fontSize: 12, color: Colors.textMuted, marginTop: 6 },
  footer: {
    flexDirection: 'row' as const, gap: 12,
    paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: Colors.cardBorder,
    backgroundColor: Colors.background,
  },
  footerBtn: { flex: 1 },
  primaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryText: { fontSize: 16, fontWeight: '700' as const, color: '#FFF' },
  secondaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 6, backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  secondaryText: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  // Result view
  resultHero: {
    alignItems: 'center' as const, marginBottom: 24, gap: 4,
  },
  resultHeroTitle: {
    fontSize: 14, fontWeight: '600' as const, color: Colors.textMuted, marginTop: 8,
  },
  resultTotal: {
    fontSize: 44, fontWeight: '800' as const, color: Colors.text, marginTop: 4,
  },
  resultSubtitle: { fontSize: 13, color: Colors.textMuted },
  resultBody: { fontSize: 14, color: Colors.text, lineHeight: 21, marginBottom: 20 },
  sectionTitle: {
    fontSize: 14, fontWeight: '700' as const, color: Colors.text,
    letterSpacing: 0.3, marginTop: 16, marginBottom: 10,
  },
  lineItem: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.cardBorder, gap: 12,
  },
  lineCategory: { fontSize: 11, color: Colors.primary, fontWeight: '700' as const, letterSpacing: 0.5 },
  lineDesc: { fontSize: 14, color: Colors.text, marginTop: 2 },
  lineMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  lineTotal: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  totalsBlock: { marginTop: 16 },
  totalRow: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    paddingVertical: 6,
  },
  totalLabel: { fontSize: 14, color: Colors.textMuted },
  totalValue: { fontSize: 14, color: Colors.text, fontWeight: '600' as const },
  totalRowGrand: {
    borderTopWidth: 1, borderTopColor: Colors.cardBorder,
    paddingTop: 10, marginTop: 6,
  },
  grandLabel: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  grandValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.primary },
  notesBlock: { marginTop: 8 },
  noteRow: { fontSize: 13, color: Colors.textMuted, lineHeight: 20, marginBottom: 4 },
  disclaimer: {
    fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' as const,
    textAlign: 'center' as const, marginTop: 16, paddingHorizontal: 12,
  },
  actionRow: {
    flexDirection: 'row' as const, gap: 12, marginTop: 20,
  },
});
