// components/estimate/RateProvenanceChip.tsx
//
// WHY THIS EXISTS
// ---------------
// MAGE ID's cost book learns from closed jobs. It ALSO accepts "cost seeds" —
// rates the contractor merely STATED before they had any history here
// (utils/costSeedCore). The product rule is absolute:
//
//     A rate you STATED is never presented as a rate we MEASURED.
//
// That firewall is enforced end-to-end in the engine (utils/costDatabase keeps
// seeds out of jobCount / jobsAnalyzed / bidBias) and in every AI prompt that
// can see a rate. But it was INVISIBLE on the estimate itself. A competitor's
// AI estimator and ours both emit plausible line items with plausible numbers;
// the only real difference is where the rate came from — and a contractor (or
// a prospect reading a screenshot) could not see it. This chip is that
// difference, rendered on the row.
//
// WHAT IT RENDERS (four states, keyed on TONE — see below)
//   'earned' + paid,   jobCount >= 1 → MEASURED · N jobs  success tone
//   'earned' + signed, jobCount >= 1 → SIGNED · N jobs    neutral tone
//   'seeded'                         → YOU SET THIS       neutral, never success
//   'mixed'                          → MIXED · N jobs     neutral tone
//   no book hit / no provenance / earned with 0 jobs → NOTHING AT ALL.
//
// THE SHEET BRANCHES ON TONE, NOT ON PROVENANCE. When 'contracted' was added,
// only the chip LABEL learned about it: the drill-down still branched on
// `model.provenance`, and 'contracted' IS provenance 'earned', so a book of
// four signed subs with nothing paid showed a chip reading "SIGNED · 4 jobs"
// over a sheet reading "Measured on 4 closed jobs of your own. This is what
// this scope actually cost you" — with a Fact labelled "Measured average". The
// chip told the truth and the thing you tapped it to read did not. Tone is the
// classification that distinguishes them; provenance never could.
//
// The decision of what it may SAY is pure and lives in utils/rateProvenance.ts
// so the bun validators can assert the firewall without mounting React. This
// file is the pixels: colour, chip, and the drill-down sheet.

import React, { useCallback, useState } from 'react';
import {
  View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ruler, PencilLine, Layers, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { CostBookEntry } from '@/utils/costDatabase';
import { SEED_SAMPLE_LABEL } from '@/utils/costSeedCore';
import { rateProvenanceChipModel, measuredWindow } from '@/utils/rateProvenance';

export type { RateProvenanceTone, RateProvenanceChipModel } from '@/utils/rateProvenance';

function money(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * `CostBookEntry.confidence` is a raw union ('low' | 'medium' | 'high'). It was
 * being dropped straight into the drill-down sheet, so the row read
 * "Confidence — low" in lowercase next to fully-written copy like
 * "Measured on 3 closed jobs" and "Sep 2025 – Feb 2026".
 *
 * Typed as Record<union, string> DELIBERATELY: a fourth confidence level added
 * to utils/costDatabase.ts becomes a type error here instead of silently
 * leaking its raw enum member back onto the sheet.
 */
const CONFIDENCE_LABEL: Record<CostBookEntry['confidence'], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

function Fact({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.factRow}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

export interface RateProvenanceChipProps {
  /** The cost-book entry behind this line's rate, or null when nothing matched. */
  entry: CostBookEntry | null | undefined;
  testID?: string;
}

export function RateProvenanceChip({ entry, testID }: RateProvenanceChipProps) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const show = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);

  const model = rateProvenanceChipModel(entry);
  // No resolvable provenance → no chip. Never a placeholder, never a guess.
  if (!model || !entry) return null;

  const measured = model.tone === 'measured';
  const fg = measured ? t.success : t.textMuted;
  const bg = measured ? t.successSoft : t.surfaceAlt;
  const Icon = model.provenance === 'earned' ? Ruler : model.provenance === 'mixed' ? Layers : PencilLine;

  const sampleWindow = measuredWindow(entry);
  // A ± band is a claim about repeatability, so it is printed only when the
  // spread is an OBSERVATION. `variability > 0` caught n=1 by luck (a single
  // sample computes 0) and missed the other case entirely: samples that all
  // carry a price the GC STATED — two seeds at $4 and $6, or clocked hours at
  // one typed rate — manufacture a spread out of typed numbers. Same test the
  // cost-database card and takeoffPricing now use; the `?? > 0` keeps a book
  // built before the flag existed behaving as it did.
  const hasSpread = (entry.spreadMeaningful ?? (entry.variability > 0)) && entry.variability > 0;
  const spread = hasSpread ? `±${Math.round(entry.variability * 100)}%` : null;
  const unit = entry.unit || 'unit';

  return (
    <>
      <TouchableOpacity
        style={[styles.chip, { backgroundColor: bg, borderColor: fg + '33' }]}
        onPress={show}
        activeOpacity={0.75}
        testID={testID ?? 'rate-provenance-chip'}
        accessibilityRole="button"
        accessibilityLabel={`Rate provenance: ${model.label}. Tap for what's behind this rate.`}
      >
        <Icon size={10} color={fg} strokeWidth={2} />
        <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>{model.label}</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={hide} statusBarTranslucent>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={hide} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={[styles.eyebrow, { color: fg }]}>{model.label}</Text>
            <TouchableOpacity
              onPress={hide}
              style={styles.closeBtn}
              activeOpacity={0.7}
              testID="rate-provenance-close"
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={18} color={t.text} strokeWidth={1.75} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody} showsVerticalScrollIndicator={false}>
            <Text style={styles.sheetTitle}>{entry.trade} · {unit}</Text>

            {model.tone === 'stated' && model.provenance === 'seeded' ? (
              <>
                {/* A stated rate. The sheet says so in the same words the cost
                    book uses for a seeded sample, and never cites a job count. */}
                <Text style={styles.lede}>
                  {SEED_SAMPLE_LABEL}. It is a rate you entered yourself — MAGE ID has not
                  measured this scope on any job here yet, so this is your own number carried
                  forward, not evidence from a closed job.
                </Text>
                <View style={styles.facts}>
                  <Fact label="The rate you set" value={`${money(entry.suggestedRate)} / ${unit}`} />
                  <Fact label="Closed jobs behind it" value="None yet" />
                </View>
                <Text style={styles.note}>
                  It still beats a national average — it is what you actually charge. The first
                  job you close on this scope replaces it with what the work really cost.
                </Text>
              </>
            ) : model.tone === 'contracted' ? (
              <>
                {/* Signed subs on closed jobs, nothing paid out yet. Real
                    evidence — just not a payment. So nothing here may make the
                    measured branch's CLAIM: no "Measured on N closed jobs", no
                    "Measured average", no "this is what it actually cost you".
                    Naming what would upgrade it ("…becomes a measured rate")
                    is the opposite of that claim and is allowed; the guard in
                    scripts/validate-cost-seed §15.3 pins exactly that line. */}
                <Text style={styles.lede}>
                  Signed on {model.jobCount} closed job{model.jobCount === 1 ? '' : 's'} of your
                  own — this is the sub/PO amount you contracted for that scope. Nothing has been
                  paid out against it yet here, so it is what you agreed to pay, not yet what you
                  paid.
                </Text>
                <View style={styles.facts}>
                  <Fact label="Rate in your book" value={`${money(entry.suggestedRate)} / ${unit}`} />
                  <Fact label="Contracted average" value={`${money(entry.personalRate)} / ${unit}`} />
                  <Fact label="Signed on" value={`${model.jobCount} closed job${model.jobCount === 1 ? '' : 's'}`} />
                  <Fact label="Paid to date" value="Nothing settled yet" />
                  {sampleWindow ? <Fact label="Sample window" value={sampleWindow} /> : null}
                  {spread ? <Fact label="Spread across jobs" value={spread} /> : null}
                  <Fact label="Confidence" value={CONFIDENCE_LABEL[entry.confidence]} />
                </View>
                <Text style={styles.note}>
                  A signed sub on a closed job is a firm number, so your book prices the next bid
                  from it. The first payment that settles one of these contracts turns it into a
                  measured rate.
                </Text>
              </>
            ) : model.provenance === 'mixed' ? (
              <>
                <Text style={styles.lede}>
                  This started as a rate you set yourself, and {model.jobCount} closed
                  job{model.jobCount === 1 ? '' : 's'} {model.jobCount === 1 ? 'has' : 'have'} been
                  measured against it since. It is part measurement, part your own stated number.
                </Text>
                <View style={styles.facts}>
                  <Fact label="Rate in your book" value={`${money(entry.suggestedRate)} / ${unit}`} />
                  <Fact label="Measured on" value={`${model.jobCount} closed job${model.jobCount === 1 ? '' : 's'}`} />
                  {sampleWindow ? <Fact label="Sample window" value={sampleWindow} /> : null}
                  {spread ? <Fact label="Spread across jobs" value={spread} /> : null}
                  <Fact label="Confidence" value={CONFIDENCE_LABEL[entry.confidence]} />
                </View>
                <Text style={styles.note}>
                  Each new closed job pushes the measured cost further ahead of the rate you
                  stated, until the stated number no longer moves it.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.lede}>
                  Measured on {model.jobCount} closed job{model.jobCount === 1 ? '' : 's'} of your
                  own. This is what this scope actually cost you — not a catalog price and not a
                  number anyone typed in.
                </Text>
                <View style={styles.facts}>
                  <Fact label="Rate in your book" value={`${money(entry.suggestedRate)} / ${unit}`} />
                  <Fact label="Measured average" value={`${money(entry.personalRate)} / ${unit}`} />
                  <Fact label="Measured on" value={`${model.jobCount} closed job${model.jobCount === 1 ? '' : 's'}`} />
                  {sampleWindow ? <Fact label="Sample window" value={sampleWindow} /> : null}
                  {spread ? <Fact label="Spread across jobs" value={spread} /> : null}
                  <Fact label="Confidence" value={CONFIDENCE_LABEL[entry.confidence]} />
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

export default RateProvenanceChip;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
  },
  chipText: { ...Type.caption2, fontWeight: '700', letterSpacing: 0.4 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: t.surface,
    borderTopLeftRadius: Tokens.radius.xl,
    borderTopRightRadius: Tokens.radius.xl,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  handle: {
    alignSelf: 'center',
    width: 36, height: 5,
    borderRadius: Tokens.radius.xs,
    backgroundColor: t.line,
    marginBottom: 14,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { ...Type.eyebrow },
  closeBtn: {
    width: 32, height: 32, borderRadius: Tokens.radius.panel,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  sheetBody: { paddingTop: 12, paddingBottom: 8 },
  sheetTitle: { ...Type.title3, color: t.text, marginBottom: 8 },
  lede: { ...Type.subhead, color: t.textSecondary, marginBottom: 14 },
  facts: {
    backgroundColor: t.surfaceAlt,
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 9,
  },
  factLabel: { ...Type.footnote, color: t.textMuted, flexShrink: 1 },
  factValue: { ...Type.footnoteEmphasized, color: t.text },
  note: { ...Type.footnote, color: t.textMuted, marginTop: 12 },
});
