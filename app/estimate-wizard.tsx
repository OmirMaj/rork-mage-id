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
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ChevronRight, Sparkles, Building2, Home, Wrench,
  DollarSign, CheckCircle2, FileDown, RotateCcw,
} from 'lucide-react-native';
import { z } from 'zod';
import { Colors } from '@/constants/colors';
import { mageAISmart } from '@/utils/mageAI';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import TapeRollNumber from '@/components/animations/TapeRollNumber';
import EstimateLoadingOverlay from '@/components/EstimateLoadingOverlay';
import { useProjects } from '@/contexts/ProjectContext';
import { shareQuickEstimatePDF } from '@/utils/pdfGenerator';
import type { CompanyBranding } from '@/types';

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
  const { settings } = useProjects();

  const [step, setStep] = useState<number>(0);
  const [answers, setAnswers] = useState<WizardAnswers>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [sharingPdf, setSharingPdf] = useState(false);
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
    setSharingPdf(true);
    try {
      // Build a CompanyBranding payload from the user's settings; fall back
      // to "MAGE ID" defaults so the PDF still renders if they haven't
      // filled in their branding yet.
      const branding: CompanyBranding = {
        companyName:   settings?.branding?.companyName ?? 'MAGE ID',
        contactName:   settings?.branding?.contactName ?? '',
        phone:         settings?.branding?.phone ?? '',
        email:         settings?.branding?.email ?? '',
        address:       settings?.branding?.address ?? '',
        licenseNumber: settings?.branding?.licenseNumber ?? '',
        tagline:       settings?.branding?.tagline ?? '',
        logoUri:       settings?.branding?.logoUri,
      };
      await shareQuickEstimatePDF(result, answers, branding);
    } catch (err) {
      Alert.alert('Share failed', err instanceof Error ? err.message : 'Could not generate PDF.');
    } finally {
      setSharingPdf(false);
    }
  }, [result, answers, settings]);

  const reset = useCallback(() => {
    setAnswers(INITIAL);
    setResult(null);
    setStep(0);
  }, []);

  const progressWidth = `${((step + 1) / TOTAL_STEPS) * 100}%` as const;

  if (result) {
    // Group line items by category and compute subtotals + percentages.
    // Used for both the breakdown summary card AND the per-category
    // sections below — flat list was the user's complaint ("doesn't give
    // a good breakdown").
    const sizeNum = Number(answers.sizeSqft) || 0;
    const costPerSqft = sizeNum > 0 ? result.total / sizeNum : 0;
    const groups = new Map<string, typeof result.lineItems>();
    for (const li of result.lineItems) {
      const cat = li.category || 'Other';
      const arr = groups.get(cat) ?? [];
      arr.push(li);
      groups.set(cat, arr);
    }
    const sortedCategories = Array.from(groups.entries())
      .map(([cat, items]) => ({
        cat,
        items,
        subtotal: items.reduce((s, li) => s + li.total, 0),
      }))
      .sort((a, b) => b.subtotal - a.subtotal);

    // Estimate metadata for the in-app preview, mirroring what the PDF
    // generator stamps on the client-facing doc. The estimate # changes
    // every regenerate — that's intentional, the GC will see the same
    // number on the PDF they share.
    const validUntilDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    })();
    const todayLabel = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    // Payment terms preview — same defaults as the PDF (25/65/10).
    const depositAmt = result.total * 0.25;
    const progressAmt = result.total * 0.65;
    const completionAmt = result.total * 0.10;

    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Estimate' }} />
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 100 }}>
          {/* "Client preview" banner — reminds the GC that what they see
              IS what the homeowner sees. Soft contextual cue at the top. */}
          <View style={styles.previewBanner}>
            <Text style={styles.previewBannerText}>This is the estimate your client will see</Text>
          </View>

          <View style={styles.resultHero}>
            <CheckCircle2 size={28} color={Colors.success} />
            <Text style={styles.resultHeroTitle}>Construction Estimate</Text>
            <TapeRollNumber
              value={result.total}
              prefix="$"
              decimals={0}
              duration={1100}
              style={styles.resultTotal}
            />
            <Text style={styles.resultSubtitle}>{answers.projectType}{answers.sizeSqft ? ` · ${answers.sizeSqft} sqft` : ''}{answers.location ? ` · ${answers.location}` : ''}</Text>
            {costPerSqft > 0 ? (
              <Text style={styles.resultCostPerSqft}>${costPerSqft.toFixed(0)} per sqft</Text>
            ) : null}
          </View>

          {/* Estimate metadata — prepared / valid / location. Same row
              that prints at the top of the PDF. */}
          <View style={styles.metaCard}>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Prepared on</Text>
              <Text style={styles.metaValue}>{todayLabel}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Valid until</Text>
              <Text style={[styles.metaValue, { color: Colors.primary }]}>{validUntilDate}</Text>
            </View>
            <View style={styles.metaCol}>
              <Text style={styles.metaLabel}>Quality</Text>
              <Text style={styles.metaValue}>{QUALITY_LABELS[answers.quality]}</Text>
            </View>
          </View>

          {/* At-a-glance stat tiles — labels updated to client-friendly
              language. "Categories" / "Line items" was internal jargon. */}
          <View style={styles.statGrid}>
            {sizeNum > 0 ? (
              <View style={styles.statTile}>
                <Text style={styles.statLabel}>Project size</Text>
                <Text style={styles.statValue}>{sizeNum.toLocaleString()}</Text>
                <Text style={styles.statUnit}>sqft</Text>
              </View>
            ) : null}
            {answers.timelineWeeks ? (
              <View style={styles.statTile}>
                <Text style={styles.statLabel}>Timeline</Text>
                <Text style={styles.statValue}>{answers.timelineWeeks}</Text>
                <Text style={styles.statUnit}>weeks</Text>
              </View>
            ) : null}
            <View style={styles.statTile}>
              <Text style={styles.statLabel}>Contingency</Text>
              <Text style={styles.statValue}>{result.subtotal > 0 ? `${Math.round(result.contingency / result.subtotal * 100)}%` : '—'}</Text>
              <Text style={styles.statUnit}>buffer</Text>
            </View>
          </View>

          {result.summary ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Scope of Work</Text>
              <Text style={styles.summaryText}>{result.summary}</Text>
              {answers.scope && answers.scope !== result.summary ? (
                <Text style={styles.summaryNote}>{answers.scope}</Text>
              ) : null}
              {answers.specialRequirements ? (
                <View style={styles.specialReq}>
                  <Text style={styles.specialReqLabel}>Special requirements</Text>
                  <Text style={styles.specialReqText}>{answers.specialRequirements}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Cost Distribution — same layout as the PDF, percentage bars. */}
          {result.total > 0 && sortedCategories.length > 0 ? (
            <View style={styles.breakdownCard}>
              <Text style={styles.breakdownTitle}>Cost Distribution</Text>
              {sortedCategories.map(({ cat, subtotal }, i) => {
                const pct = result.total > 0 ? (subtotal / result.total) * 100 : 0;
                return (
                  <View key={i} style={styles.breakdownRow}>
                    <View style={styles.breakdownHead}>
                      <Text style={styles.breakdownCat}>{cat}</Text>
                      <Text style={styles.breakdownAmt}>
                        ${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })} <Text style={styles.breakdownPct}>· {pct.toFixed(1)}%</Text>
                      </Text>
                    </View>
                    <View style={styles.breakdownBar}>
                      <View style={[styles.breakdownBarFill, { width: `${Math.max(pct, 1)}%` }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Detailed line items, grouped by category, biggest first.
              Each category card has its own subtotal + % so the GC can
              still drill into specifics. */}
          <Text style={styles.sectionTitle}>Detailed Line Items</Text>
          {sortedCategories.map(({ cat, items, subtotal }, ci) => {
            const pct = result.total > 0 ? (subtotal / result.total) * 100 : 0;
            return (
              <View key={ci} style={styles.categoryCard}>
                <View style={styles.categoryHeader}>
                  <Text style={styles.categoryName}>{cat}</Text>
                  <View style={styles.categoryHeadRight}>
                    <Text style={styles.categoryMeta}>{pct.toFixed(0)}% · {items.length} item{items.length === 1 ? '' : 's'}</Text>
                    <Text style={styles.categoryTotal}>${subtotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  </View>
                </View>
                {items.map((li, i) => (
                  <View key={i} style={styles.lineItemNew}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.lineDesc}>{li.description}</Text>
                      <Text style={styles.lineMeta}>{li.quantity} {li.unit} × ${li.unitCost.toFixed(2)}</Text>
                    </View>
                    <Text style={styles.lineTotal}>${li.total.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  </View>
                ))}
              </View>
            );
          })}

          <View style={styles.totalsBlockNew}>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Line items subtotal</Text><Text style={styles.totalValue}>${result.subtotal.toLocaleString()}</Text></View>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Contingency</Text><Text style={styles.totalValue}>${result.contingency.toLocaleString()}</Text></View>
            <View style={styles.totalRow}><Text style={styles.totalLabel}>Permits & fees</Text><Text style={styles.totalValue}>${result.permits.toLocaleString()}</Text></View>
            <View style={[styles.totalRow, styles.totalRowGrand]}>
              <View>
                <Text style={styles.grandLabel}>Estimated total</Text>
                {costPerSqft > 0 ? (
                  <Text style={styles.grandSubLabel}>${costPerSqft.toFixed(0)}/sqft · {sizeNum.toLocaleString()} sqft</Text>
                ) : null}
              </View>
              <Text style={styles.grandValue}>${result.total.toLocaleString()}</Text>
            </View>
          </View>

          {/* What's Included — derived from category list (so it's
              honest — these are the categories actually estimated). */}
          {sortedCategories.length > 0 ? (
            <View style={styles.includedCard}>
              <Text style={styles.sectionTitle}>What's Included</Text>
              <View style={styles.includedChips}>
                {sortedCategories.map(({ cat }, i) => (
                  <View key={i} style={styles.includedChip}>
                    <Text style={styles.includedChipText}>{cat}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.includedFootnote}>
                All labor, materials, equipment, supervision, and required permits for the categories above as detailed in the line items.
              </Text>
            </View>
          ) : null}

          {/* What's Not Included — boilerplate residential exclusions.
              These prevent 90% of "I thought that was included" disputes.
              Same list as the PDF. */}
          <View style={styles.excludedCard}>
            <Text style={styles.sectionTitle}>What's Not Included</Text>
            <Text style={styles.excludedItem}>• Architectural / engineering / design fees</Text>
            <Text style={styles.excludedItem}>• HOA, city, or third-party plan-review fees beyond standard permits</Text>
            <Text style={styles.excludedItem}>• Asbestos, lead, mold, or other hazardous-material abatement</Text>
            <Text style={styles.excludedItem}>• Unforeseen conditions discovered after demolition begins</Text>
            <Text style={styles.excludedItem}>• Landscaping, fencing, or exterior work outside the stated scope</Text>
            <Text style={styles.excludedItem}>• Owner-supplied materials or fixtures (handled separately)</Text>
            <Text style={styles.excludedItem}>• Sales tax (where required) · Financing costs · Insurance riders</Text>
          </View>

          {/* Payment Terms — 25/65/10 deposit / progress / final. Same
              defaults as the PDF. Future: let GC override per-project. */}
          <View style={styles.paymentCard}>
            <Text style={styles.sectionTitle}>Payment Terms</Text>
            <View style={styles.paymentRow}>
              <View style={styles.paymentRowLeft}>
                <Text style={styles.paymentRowTitle}>Deposit (25%)</Text>
                <Text style={styles.paymentRowDesc}>Due upon signed agreement, before work begins</Text>
              </View>
              <Text style={styles.paymentRowAmt}>${depositAmt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={styles.paymentRow}>
              <View style={styles.paymentRowLeft}>
                <Text style={styles.paymentRowTitle}>Progress (65%)</Text>
                <Text style={styles.paymentRowDesc}>Billed against documented progress per contract schedule</Text>
              </View>
              <Text style={styles.paymentRowAmt}>${progressAmt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            </View>
            <View style={[styles.paymentRow, { borderBottomWidth: 0 }]}>
              <View style={styles.paymentRowLeft}>
                <Text style={styles.paymentRowTitle}>Final (10%)</Text>
                <Text style={styles.paymentRowDesc}>Due at substantial completion, after walk-through and punch list</Text>
              </View>
              <Text style={styles.paymentRowAmt}>${completionAmt.toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
            </View>
          </View>

          {/* Acceptance / Next Steps — soft CTA to the client. */}
          <View style={styles.acceptanceCard}>
            <Text style={styles.acceptanceTitle}>Ready to move forward?</Text>
            <Text style={styles.acceptanceBody}>
              To proceed, the client replies with approval and we'll prepare a formal contract reflecting the scope and terms above. Final pricing is locked once the contract is signed and the deposit received.
            </Text>
          </View>

          {result.notes.length > 0 && (
            <View style={styles.notesBlock}>
              <Text style={styles.sectionTitle}>Project Notes</Text>
              {result.notes.map((n, i) => (
                <Text key={i} style={styles.noteRow}>• {n}</Text>
              ))}
            </View>
          )}

          <Text style={styles.disclaimer}>
            This is a project estimate, not a fixed-price quote, unless explicitly stated in a signed agreement. Quantities, unit prices, and materials are subject to change based on field conditions, market pricing, and design revisions.
          </Text>

          <View style={styles.resultActions}>
            <TouchableOpacity
              style={styles.resultPrimaryBtn}
              onPress={share}
              activeOpacity={0.85}
              disabled={sharingPdf}
              testID="wizard-share"
            >
              {sharingPdf ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <FileDown size={18} color="#FFF" />
                  <Text style={styles.resultPrimaryText}>
                    {Platform.OS === 'web' ? 'Open PDF preview' : 'Download & share PDF'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.resultSecondaryBtn}
              onPress={reset}
              activeOpacity={0.8}
              disabled={sharingPdf}
              testID="wizard-reset"
            >
              <RotateCcw size={16} color={Colors.text} />
              <Text style={styles.resultSecondaryText}>Start a new estimate</Text>
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

      <EstimateLoadingOverlay
        visible={loading}
        title="Generating estimate…"
        subtitle="Pulling materials, labor, and 2025 pricing for your project."
      />
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
  resultCostPerSqft: {
    fontSize: 13, fontWeight: '700' as const, color: Colors.primary,
    marginTop: 4, letterSpacing: 0.3,
  },
  resultBody: { fontSize: 14, color: Colors.text, lineHeight: 21, marginBottom: 20 },
  // At-a-glance stat tiles below hero
  statGrid: {
    flexDirection: 'row' as const, gap: 8,
    marginBottom: 16,
  },
  statTile: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: 12,
    paddingVertical: 12, paddingHorizontal: 10,
    borderWidth: 1, borderColor: Colors.cardBorder,
    alignItems: 'center' as const, gap: 4,
  },
  statLabel: {
    fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
  },
  statValue: { fontSize: 18, fontWeight: '800' as const, color: Colors.text },
  // Scope summary card
  summaryCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 16, gap: 6,
  },
  summaryLabel: {
    fontSize: 10, fontWeight: '800' as const, color: Colors.textMuted,
    letterSpacing: 1, textTransform: 'uppercase' as const,
  },
  summaryText: { fontSize: 14, color: Colors.text, lineHeight: 21 },
  // Where-the-budget-goes breakdown card
  breakdownCard: {
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 20,
  },
  breakdownTitle: {
    fontSize: 11, fontWeight: '800' as const, color: Colors.textMuted,
    letterSpacing: 1.4, textTransform: 'uppercase' as const, marginBottom: 12,
  },
  breakdownRow: { marginBottom: 10 },
  breakdownHead: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    marginBottom: 4,
  },
  breakdownCat: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  breakdownAmt: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  breakdownPct: { fontWeight: '500' as const, color: Colors.textMuted },
  breakdownBar: {
    height: 6, borderRadius: 3, overflow: 'hidden' as const,
    backgroundColor: Colors.cardBorder,
  },
  breakdownBarFill: { height: '100%' as const, backgroundColor: Colors.primary, borderRadius: 3 },
  // Per-category detailed cards
  categoryCard: {
    backgroundColor: Colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
    marginBottom: 12, overflow: 'hidden' as const,
  },
  categoryHeader: {
    flexDirection: 'row' as const, justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: Colors.background,
    borderBottomWidth: 1, borderBottomColor: Colors.cardBorder,
  },
  categoryName: {
    fontSize: 14, fontWeight: '800' as const, color: Colors.text,
    letterSpacing: 0.2,
  },
  categoryHeadRight: { alignItems: 'flex-end' as const, gap: 2 },
  categoryMeta: {
    fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted,
    letterSpacing: 0.6, textTransform: 'uppercase' as const,
  },
  categoryTotal: { fontSize: 14, fontWeight: '800' as const, color: Colors.primary },
  lineItemNew: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingVertical: 10, paddingHorizontal: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.cardBorder, gap: 12,
  },
  totalsBlockNew: {
    marginTop: 8, padding: 16, borderRadius: 14,
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  grandSubLabel: {
    fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted,
    marginTop: 2, letterSpacing: 0.2,
  },
  // "Client preview" banner at top of result screen
  previewBanner: {
    backgroundColor: Colors.primary + '12',
    borderColor: Colors.primary + '30',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 16,
    alignItems: 'center' as const,
  },
  previewBannerText: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.primary,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  // Estimate metadata row (Prepared / Valid until / Quality)
  metaCard: {
    flexDirection: 'row' as const,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 16,
    gap: 16,
  },
  metaCol: { flex: 1 },
  metaLabel: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginBottom: 4,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  // Stat tile unit (e.g. "sqft", "weeks") below the value
  statUnit: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    marginTop: 1,
  },
  // Scope summary extras
  summaryNote: {
    fontSize: 13,
    color: Colors.textMuted,
    fontStyle: 'italic' as const,
    lineHeight: 20,
    marginTop: 8,
  },
  specialReq: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
  },
  specialReqLabel: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: Colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    marginBottom: 4,
  },
  specialReqText: { fontSize: 13, color: Colors.text, lineHeight: 19 },
  // Inclusions card
  includedCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginTop: 8,
    marginBottom: 12,
  },
  includedChips: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
    marginTop: 4,
    marginBottom: 10,
  },
  includedChip: {
    backgroundColor: '#E8F5E9',
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  includedChipText: { fontSize: 11, fontWeight: '700' as const, color: '#1B5E20' },
  includedFootnote: { fontSize: 12, color: Colors.textMuted, lineHeight: 18 },
  // Exclusions card
  excludedCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 12,
  },
  excludedItem: {
    fontSize: 12, color: Colors.textMuted, lineHeight: 22, paddingLeft: 4,
  },
  // Payment terms card
  paymentCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    marginBottom: 12,
  },
  paymentRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.cardBorder,
    gap: 12,
  },
  paymentRowLeft: { flex: 1 },
  paymentRowTitle: { fontSize: 13, fontWeight: '700' as const, color: Colors.text },
  paymentRowDesc: { fontSize: 11, color: Colors.textMuted, marginTop: 2, lineHeight: 16 },
  paymentRowAmt: { fontSize: 14, fontWeight: '800' as const, color: Colors.primary },
  // Acceptance / next-steps card
  acceptanceCard: {
    backgroundColor: '#0F1216',
    borderRadius: 14,
    padding: 18,
    marginTop: 8,
    marginBottom: 16,
  },
  acceptanceTitle: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.primary,
    marginBottom: 8,
  },
  acceptanceBody: {
    fontSize: 13,
    color: '#E8E5DD',
    lineHeight: 20,
  },
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
  // Result-screen action stack — buttons stack vertically and span full
  // width so the two-button layout doesn't look cramped when only Share
  // and New Estimate are present.
  resultActions: {
    marginTop: 24,
    gap: 12,
    alignItems: 'stretch' as const,
  },
  resultPrimaryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 18,
    paddingHorizontal: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 4,
  },
  resultPrimaryText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#FFF',
    letterSpacing: 0.2,
  },
  resultSecondaryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  resultSecondaryText: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
  },
});
