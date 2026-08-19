// cost-seed.tsx — bring your prices with you.
//
// THE COLD-START FIX. utils/costDatabase learns only from jobs closed inside
// MAGE, so a twenty-year contractor's first estimate was priced identically to
// a beginner's and stayed that way until they'd closed real work here. That is
// the single biggest reason a new subscriber churns before the product's whole
// promise ("it learns your real costs") ever gets a chance to be true.
//
// Two ways in, one destination:
//   • Paste — a trade/unit/rate column straight out of a spreadsheet, parsed by
//     utils/costSeedCore (forgiving about headers, $, commas, tabs, SF/SQFT).
//   • Type — one rate at a time on the form.
// Both land as SeededRate rows (hooks/useCostSeeds) that feed
// buildCostDatabase's 5th argument, which is what makes the estimate wizard's
// groundingFacts non-empty on day one.
//
// A SEEDED RATE IS LABELLED AS SUCH, EVERYWHERE. It never counts as a closed
// job, never moves bid accuracy, and the first real job outweighs it. The copy
// on this screen says so out loud — see utils/costSeedCore for the data-model
// half of that promise.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, ClipboardPaste, Plus, Check, Trash2, AlertTriangle, Pencil,
} from 'lucide-react-native';
import { MageCostDb } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import {
  parseSeedBlob, draftsToSeeds, canonicalSeedUnit, SEED_UNITS,
  MAX_SEED_RATE, MAX_REPORTED_JOBS,
  type SeededRate, type SeededRateDraft, type SeedParseResult,
} from '@/utils/costSeedCore';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { track, AnalyticsEvents } from '@/utils/analytics';

const PLACEHOLDER =
  'Trade, Unit, Rate, Jobs\n' +
  'Framing, SF, $12.50, 14\n' +
  'Drywall hang & finish, SF, 3.20\n' +
  'Electrical rough-in, EA, $145\n' +
  'Concrete flatwork, CY, $185, 22';

type Mode = 'paste' | 'manual';

export default function CostSeedScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  // Gated on job_costing (Pro) — the same key that gates its sibling screen,
  // app/cost-database. Seeding IS cost-book work; it belongs at the same price.
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible={true}
        feature="Seed Your Rates"
        requiredTier="pro"
        onClose={() => router.back()}
      />
    );
  }
  return <CostSeedInner />;
}

function CostSeedInner() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { isDesktop } = useResponsiveLayout();
  const router = useRouter();
  const { seeds, addSeeds, deleteSeed } = useCostSeeds();

  const [mode, setMode] = useState<Mode>('paste');

  // ── Paste flow ────────────────────────────────────────────────────────
  const [blob, setBlob] = useState('');
  const [review, setReview] = useState<SeedParseResult | null>(null);

  const handleParse = useCallback(() => {
    const parsed = parseSeedBlob(blob);
    if (parsed.rows.length === 0) {
      showAlert(
        'Nothing to import',
        parsed.rejected.length > 0
          ? `We couldn't read a rate from any of those ${parsed.rejected.length} line${parsed.rejected.length === 1 ? '' : 's'}. Each line needs a trade, a unit (SF, LF, EA, HR…), and a price.`
          : 'Paste one rate per line — trade, unit, price. For example: Framing, SF, $12.50',
      );
      return;
    }
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setReview(parsed);
  }, [blob]);

  const handleCommitPaste = useCallback(() => {
    if (!review || review.rows.length === 0) return;
    const next = draftsToSeeds(review.rows, { now: new Date().toISOString(), method: 'paste' });
    const result = addSeeds(next);
    track(AnalyticsEvents.COST_RATES_SEEDED, {
      count: (result?.added ?? 0) + (result?.replaced ?? 0),
      method: 'paste',
      source: 'cost_seed',
    });
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    setReview(null);
    setBlob('');
    showAlert(
      'Rates added',
      `${result.added} new · ${result.replaced} updated. These are marked as rates you set — they'll price your estimates now, and every job you close will correct them.`,
    );
  }, [review, addSeeds]);

  // ── Manual flow ───────────────────────────────────────────────────────
  const [formTrade, setFormTrade] = useState('');
  const [formUnit, setFormUnit] = useState<string>('SF');
  const [formRate, setFormRate] = useState('');
  const [formJobs, setFormJobs] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormTrade('');
    setFormUnit('SF');
    setFormRate('');
    setFormJobs('');
    setFormError(null);
    setEditingId(null);
  }, []);

  const handleManualSave = useCallback(() => {
    const trade = formTrade.trim();
    if (!trade) { setFormError('Name the trade or scope (e.g. Framing).'); return; }
    const unit = canonicalSeedUnit(formUnit);
    if (!unit) { setFormError('Pick a unit.'); return; }
    const rate = Number(formRate.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(rate) || rate <= 0) {
      setFormError('Enter a price greater than zero.'); return;
    }
    // These ceilings are the TABLE's, not just the parser's: cost_seeds CHECKs
    // rate <= MAX_SEED_RATE and reported_jobs <= MAX_REPORTED_JOBS, and a row
    // breaking one fails its upsert with "violates check constraint" — which
    // utils/offlineQueue classifies TERMINAL and drops. Catching it here is the
    // difference between a correctable typo and a rate that reads as saved on
    // this device and exists nowhere else.
    if (rate > MAX_SEED_RATE) {
      setFormError(`That's higher than we can store — keep it under ${formatMoney(MAX_SEED_RATE)} per unit.`);
      return;
    }
    const jobsRaw = formJobs.trim();
    const jobs = jobsRaw ? Number(jobsRaw) : undefined;
    if (jobsRaw && (!Number.isFinite(jobs) || (jobs as number) <= 0)) {
      setFormError('Jobs must be a whole number, or leave it blank.'); return;
    }
    if (jobs != null && jobs > MAX_REPORTED_JOBS) {
      setFormError(`Enter up to ${MAX_REPORTED_JOBS} jobs — it's a rough count, not an exact ledger.`);
      return;
    }

    const draft: SeededRateDraft = {
      trade,
      unit,
      rate: Math.round(rate * 100) / 100,
      ...(jobs != null ? { reportedJobs: Math.round(jobs) } : {}),
      raw: `${trade}, ${unit}, ${rate}`,
    };
    const [seed] = draftsToSeeds([draft], { now: new Date().toISOString(), method: 'manual' });
    if (editingId && editingId !== seed.id) {
      // Trade/unit changed on an edit — the deterministic id moved, so drop
      // the old row rather than leaving an orphan behind.
      deleteSeed(editingId);
    }
    const manualResult = addSeeds([seed]);
    track(AnalyticsEvents.COST_RATES_SEEDED, {
      count: (manualResult?.added ?? 0) + (manualResult?.replaced ?? 0),
      method: 'manual',
      source: 'cost_seed',
    });
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    resetForm();
  }, [formTrade, formUnit, formRate, formJobs, editingId, addSeeds, deleteSeed, resetForm]);

  const handleEdit = useCallback((s: SeededRate) => {
    setMode('manual');
    setEditingId(s.id);
    setFormTrade(s.trade);
    setFormUnit(s.unit);
    setFormRate(String(s.rate));
    setFormJobs(s.reportedJobs != null ? String(s.reportedJobs) : '');
    setFormError(null);
  }, []);

  const handleDelete = useCallback((s: SeededRate) => {
    showAlert('Remove rate', `Remove your ${s.trade} rate ($${s.rate.toFixed(2)}/${s.unit})?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          deleteSeed(s.id);
          if (editingId === s.id) resetForm();
        },
      },
    ]);
  }, [deleteSeed, editingId, resetForm]);

  const sorted = useMemo(
    () => [...seeds].sort((a, b) => a.trade.localeCompare(b.trade)),
    [seeds],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.headerEyebrow}>Cost Database · MAGE ID</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Seed your rates</Text>
        </View>
        <View style={styles.headerBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}
      >
        <ScrollView
          {...fabScroll}
          contentContainerStyle={[
            { padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE },
            isDesktop && styles.contentDesktop,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* The honest frame. Says exactly what a seeded rate is and is not,
              before the contractor types a single number. */}
          <View style={styles.introCard}>
            <View style={styles.introHead}>
              <MageCostDb size={18} color={t.accent} />
              <Text style={styles.introTitle}>You already know your numbers</Text>
            </View>
            <Text style={styles.introBody}>
              MAGE normally learns your rates from jobs you close here — which means nothing
              to price from on day one. Put in what you already charge and your very next
              estimate is built on your numbers, not a national average.
            </Text>
            <Text style={styles.introFinePrint}>
              Rates you enter are marked &ldquo;you set this&rdquo; — never counted as a closed job,
              never folded into your bid accuracy. The first real job you close corrects them.
            </Text>
          </View>

          {/* Mode switch */}
          <View style={styles.segment}>
            <TouchableOpacity
              style={[styles.segmentBtn, mode === 'paste' && styles.segmentBtnActive]}
              onPress={() => { setMode('paste'); setFormError(null); }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Paste rates from a spreadsheet"
              testID="cost-seed-mode-paste"
            >
              <ClipboardPaste
                size={14}
                color={mode === 'paste' ? t.accent : t.textSecondary}
                strokeWidth={1.75}
              />
              <Text style={[styles.segmentText, mode === 'paste' && styles.segmentTextActive]}>
                Paste a list
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segmentBtn, mode === 'manual' && styles.segmentBtnActive]}
              onPress={() => { setMode('manual'); setReview(null); }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Type one rate"
              testID="cost-seed-mode-manual"
            >
              <Plus
                size={14}
                color={mode === 'manual' ? t.accent : t.textSecondary}
                strokeWidth={1.75}
              />
              <Text style={[styles.segmentText, mode === 'manual' && styles.segmentTextActive]}>
                Type a rate
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── Paste ─────────────────────────────────────────────────── */}
          {mode === 'paste' && !review && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Paste your rates</Text>
              <Text style={styles.cardHint}>
                One per line: trade, unit, price — plus a job count if you have one. Copy a
                column straight out of a spreadsheet; a header row, dollar signs, commas, and
                tabs are all fine. SF / SQFT, LF / LNFT and EA / each all read the same.
              </Text>
              <TextInput
                style={styles.pasteInput}
                value={blob}
                onChangeText={setBlob}
                placeholder={PLACEHOLDER}
                placeholderTextColor={t.textMuted}
                multiline
                textAlignVertical="top"
                autoCapitalize="none"
                autoCorrect={false}
                testID="cost-seed-blob"
              />
              <TouchableOpacity
                style={[styles.primaryBtn, !blob.trim() && styles.primaryBtnDisabled]}
                onPress={handleParse}
                disabled={!blob.trim()}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Review the rates before adding them"
                testID="cost-seed-review"
              >
                <Text style={styles.primaryBtnText}>Review rates</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Review step — nothing is committed until the contractor sees
              what we read and what we couldn't. */}
          {mode === 'paste' && review && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                {review.rows.length} rate{review.rows.length === 1 ? '' : 's'} ready
              </Text>
              {review.headerSkipped && (
                <Text style={styles.cardHint}>Header row detected and skipped.</Text>
              )}
              {review.duplicates > 0 && (
                <Text style={styles.cardHint}>
                  {review.duplicates} duplicate line{review.duplicates === 1 ? '' : 's'} collapsed —
                  the last one you pasted wins.
                </Text>
              )}

              {review.rows.map((r, i) => (
                <View key={`${r.trade}-${r.unit}-${i}`} style={styles.reviewRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewTrade} numberOfLines={1}>{r.trade}</Text>
                    <Text style={styles.reviewMeta} numberOfLines={1}>
                      per {r.unit}
                      {r.reportedJobs != null ? ` · you say ${r.reportedJobs} job${r.reportedJobs === 1 ? '' : 's'}` : ''}
                      {r.asOf ? ` · as of ${r.asOf}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.reviewRate}>${r.rate.toFixed(2)}</Text>
                </View>
              ))}

              {review.rejected.length > 0 && (
                <View style={styles.rejectBox}>
                  <View style={styles.rejectHead}>
                    <AlertTriangle size={13} color={t.warningLabel} strokeWidth={1.9} />
                    <Text style={styles.rejectTitle}>
                      {review.rejected.length} line{review.rejected.length === 1 ? '' : 's'} skipped
                    </Text>
                  </View>
                  {review.rejected.slice(0, 8).map((r, i) => (
                    <Text key={i} style={styles.rejectLine} numberOfLines={2}>
                      &ldquo;{r.raw}&rdquo; — {r.reason}
                    </Text>
                  ))}
                  {review.rejected.length > 8 && (
                    <Text style={styles.rejectLine}>+{review.rejected.length - 8} more</Text>
                  )}
                </View>
              )}

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleCommitPaste}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Add ${review.rows.length} rates`}
                testID="cost-seed-commit"
              >
                <Check size={15} color={Colors.textOnPrimary} strokeWidth={2.2} />
                <Text style={styles.primaryBtnText}>
                  Add {review.rows.length} rate{review.rows.length === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => setReview(null)}
                accessibilityRole="button"
                accessibilityLabel="Back to editing the pasted list"
              >
                <Text style={styles.linkBtnText}>Back to edit</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── Manual ────────────────────────────────────────────────── */}
          {mode === 'manual' && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{editingId ? 'Edit rate' : 'Add one rate'}</Text>

              <Text style={styles.fieldLabel}>Trade or scope</Text>
              <TextInput
                style={styles.input}
                value={formTrade}
                onChangeText={(v) => { setFormTrade(v); setFormError(null); }}
                placeholder="e.g. Framing"
                placeholderTextColor={t.textMuted}
                testID="cost-seed-trade"
              />

              <Text style={styles.fieldLabel}>Unit</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {SEED_UNITS.map((u) => (
                  <TouchableOpacity
                    key={u}
                    style={[styles.chip, formUnit === u && styles.chipActive]}
                    onPress={() => { setFormUnit(u); setFormError(null); }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel={`Unit ${u}`}
                  >
                    <Text style={[styles.chipText, formUnit === u && styles.chipTextActive]}>{u}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.fieldLabel}>Your rate ($ per {formUnit})</Text>
              <TextInput
                style={styles.input}
                value={formRate}
                onChangeText={(v) => { setFormRate(v); setFormError(null); }}
                placeholder="e.g. 12.50"
                placeholderTextColor={t.textMuted}
                keyboardType="decimal-pad"
                testID="cost-seed-rate"
              />

              <Text style={styles.fieldLabel}>Jobs behind it (optional)</Text>
              <TextInput
                style={styles.input}
                value={formJobs}
                onChangeText={(v) => { setFormJobs(v); setFormError(null); }}
                placeholder="e.g. 14"
                placeholderTextColor={t.textMuted}
                keyboardType="number-pad"
                testID="cost-seed-jobs"
              />
              <Text style={styles.fieldHint}>
                Recorded as your own note. It won&apos;t be counted as closed jobs or shown as
                learned confidence.
              </Text>

              {formError ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleManualSave}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={editingId ? 'Save this rate' : 'Add this rate'}
                testID="cost-seed-manual-save"
              >
                <Check size={15} color={Colors.textOnPrimary} strokeWidth={2.2} />
                <Text style={styles.primaryBtnText}>{editingId ? 'Save rate' : 'Add rate'}</Text>
              </TouchableOpacity>
              {editingId ? (
                <TouchableOpacity style={styles.linkBtn} onPress={resetForm} accessibilityRole="button" accessibilityLabel="Cancel editing">
                  <Text style={styles.linkBtnText}>Cancel</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}

          {/* ── What's already seeded ─────────────────────────────────── */}
          <Text style={styles.sectionTitle}>
            Rates you&apos;ve set {sorted.length > 0 ? `· ${sorted.length}` : ''}
          </Text>
          {sorted.length === 0 ? (
            <Text style={styles.emptyHint}>
              Nothing yet. Anything you add here shows up in your Cost Database tagged
              &ldquo;you set this&rdquo; until a closed job proves it out.
            </Text>
          ) : (
            sorted.map((s) => (
              <View key={s.id} style={styles.seedRow} testID={`cost-seed-row-${s.id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.seedTrade} numberOfLines={1}>{s.trade}</Text>
                  <Text style={styles.seedMeta} numberOfLines={1}>
                    ${s.rate.toFixed(2)} per {s.unit}
                    {s.reportedJobs != null ? ` · you say ${s.reportedJobs} job${s.reportedJobs === 1 ? '' : 's'}` : ''}
                  </Text>
                  <View style={styles.seedBadge}>
                    <Text style={styles.seedBadgeText}>YOU SET THIS</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => handleEdit(s)}
                  hitSlop={8}
                  style={styles.rowBtn}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${s.trade}`}
                >
                  <Pencil size={14} color={t.accent} strokeWidth={1.9} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(s)}
                  hitSlop={8}
                  style={[styles.rowBtn, styles.rowBtnDanger]}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${s.trade}`}
                >
                  <Trash2 size={14} color={t.danger} strokeWidth={1.9} />
                </TouchableOpacity>
              </View>
            ))
          )}

          {sorted.length > 0 && (
            <>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => router.push('/cost-database' as never)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Open your cost database"
                testID="cost-seed-open-book"
              >
                <MageCostDb size={15} color={t.text} />
                <Text style={styles.secondaryBtnText}>See them in your cost database</Text>
              </TouchableOpacity>
              {sorted.some(s => s.reportedJobs != null) && (
                <Text style={styles.footNote}>
                  A job count you type is your own note, not evidence — edit a rate to change or
                  clear it.
                </Text>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  contentDesktop: { width: '100%', maxWidth: 860, alignSelf: 'center' as const },

  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: { width: 38, height: 38, alignItems: 'center' as const, justifyContent: 'center' as const },
  headerText: { flex: 1 },
  headerEyebrow: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, letterSpacing: 0.4 },
  headerTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },

  introCard: {
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderLeftWidth: 3, borderLeftColor: t.accent,
    borderRadius: Tokens.radius.panel, padding: 14, marginBottom: 14,
  },
  introHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginBottom: 8 },
  introTitle: { ...Type.subheadEmphasized, color: t.text, flex: 1 },
  introBody: { ...Type.footnote, color: t.textSecondary, lineHeight: 19 },
  introFinePrint: { ...Type.caption1, color: t.textMuted, lineHeight: 17, marginTop: 8 },

  segment: {
    flexDirection: 'row' as const, gap: 8, marginBottom: 14,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const,
    justifyContent: 'center' as const, gap: 6,
    paddingVertical: 11, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line, backgroundColor: t.surface,
    minHeight: 44,
  },
  segmentBtnActive: { borderColor: t.accent, backgroundColor: t.accentSoft },
  segmentText: { ...Type.footnoteEmphasized, color: t.textSecondary },
  segmentTextActive: { color: t.accent },

  card: {
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.panel, padding: 14, marginBottom: 16,
  },
  cardTitle: { ...Type.subheadEmphasized, color: t.text, marginBottom: 6 },
  cardHint: { ...Type.caption1, color: t.textSecondary, lineHeight: 17, marginBottom: 10 },

  pasteInput: {
    minHeight: 150,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.md,
    padding: 12,
    fontSize: Type.bodyCompact.fontSize,
    color: t.text,
    lineHeight: 21,
    marginBottom: 12,
  },

  fieldLabel: {
    fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: t.textMuted,
    textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6, marginTop: 8,
  },
  fieldHint: { ...Type.caption1, color: t.textMuted, lineHeight: 16, marginTop: 6 },
  input: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 11,
    fontSize: Type.bodyCompact.fontSize, color: t.text,
    minHeight: 44,
  },

  chipRow: { flexDirection: 'row' as const, gap: 6, paddingBottom: 2 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: Tokens.radius.full, borderWidth: 1,
    borderColor: t.line, backgroundColor: t.surfaceAlt,
    minHeight: 36, justifyContent: 'center' as const,
  },
  chipActive: { backgroundColor: t.accentFill, borderColor: t.accent },
  chipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.text },
  chipTextActive: { color: Colors.textOnPrimary },

  primaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 7, marginTop: 12,
    paddingVertical: 14, borderRadius: Tokens.radius.card, backgroundColor: t.accentFill,
    minHeight: 48,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const, color: Colors.textOnPrimary, letterSpacing: 0.2 },

  secondaryBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const,
    gap: 8, marginTop: 14,
    paddingVertical: 13, borderRadius: Tokens.radius.card,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    minHeight: 46,
  },
  secondaryBtnText: { ...Type.footnoteEmphasized, color: t.text },

  linkBtn: { alignSelf: 'center' as const, paddingVertical: 12, paddingHorizontal: 8 },
  linkBtnText: { ...Type.footnoteEmphasized, color: t.accent },

  reviewRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: t.line,
  },
  reviewTrade: { ...Type.footnoteEmphasized, color: t.text },
  reviewMeta: { ...Type.caption1, color: t.textMuted, marginTop: 2 },
  reviewRate: { ...Type.subheadEmphasized, color: t.text, fontWeight: '800' as const },

  rejectBox: {
    marginTop: 12, padding: 11,
    backgroundColor: t.warningSoft, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
  },
  rejectHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 5 },
  rejectTitle: { ...Type.caption1, fontWeight: '800' as const, color: t.warningLabel },
  rejectLine: { ...Type.caption1, color: t.textSecondary, lineHeight: 17, marginTop: 2 },

  errorBanner: {
    backgroundColor: t.dangerSoft, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.md, padding: 11, marginTop: 10,
  },
  errorText: { ...Type.caption1, color: t.dangerLabel, fontWeight: '700' as const },

  sectionTitle: {
    fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text,
    marginTop: 4, marginBottom: 10,
  },
  emptyHint: { ...Type.caption1, color: t.textMuted, lineHeight: 18 },

  seedRow: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.card, padding: 12, marginBottom: 8,
  },
  seedTrade: { ...Type.footnoteEmphasized, color: t.text },
  seedMeta: { ...Type.caption1, color: t.textSecondary, marginTop: 2 },
  seedBadge: {
    alignSelf: 'flex-start' as const, marginTop: 6,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: Tokens.radius.full, backgroundColor: t.accentSoft,
  },
  seedBadgeText: {
    fontSize: Type.caption2.fontSize, fontWeight: '800' as const,
    color: t.accentLabel, letterSpacing: 0.5,
  },
  rowBtn: {
    width: 34, height: 34, borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: t.accentSoft,
  },
  rowBtnDanger: { backgroundColor: t.dangerSoft },

  footNote: { ...Type.caption1, color: t.textMuted, lineHeight: 17, marginTop: 10 },
});
