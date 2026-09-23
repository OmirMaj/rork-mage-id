// components/copilot/EstimateCopilotReview.tsx — the Copilot estimate's review
// card (#7/#38). Prices the scope once on arrival (one metered quickEstimate
// call), then shows what Build will write: the grand total, the cost/markup
// split and where the markup came from, the lines by category each badged
// "your cost" or "MAGE estimate", the model's assumptions, and — when the job
// already has one — that this replaces it. Build commits exactly this preview.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Hammer, X, RefreshCw } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { cardSurface } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { MARKUP_CHOICES } from '@/utils/estimateMarkup';
import type { CopilotContext } from '@/utils/copilot/types';
import type { LinkedEstimateItem } from '@/types';
import type { EstimateDraft } from '@/utils/copilot/estimate/estimateGaps';
import { priceCopilotEstimate } from '@/utils/copilot/estimate/estimatePrice';
import {
  buildCopilotLinkedEstimate, copilotEstimateMarkup, markupSourceLabel, pricedHeadline, replaceWarning,
  type EstimatePriceSource,
} from '@/utils/copilot/estimate/estimatePricing';

// Money to the cent — this is the number that becomes the contract value.
const money = (n: number) => `$${(Number.isFinite(n) ? n : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const BADGE: Record<EstimatePriceSource, string> = { learned: 'your cost', seeded: 'your rate', regional: 'MAGE estimate' };

type PriceState =
  | { kind: 'idle' | 'pricing' }
  | { kind: 'error'; message: string; limit: boolean };

export default function EstimateCopilotReview({ draft, ctx, onBuild, onDiscard, patchDraft, note }: {
  draft: EstimateDraft;
  ctx: CopilotContext;
  onBuild: () => void;
  onDiscard: () => void;
  patchDraft?: (p: Partial<EstimateDraft>) => void;
  note?: string;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const [price, setPrice] = useState<PriceState>({ kind: 'idle' });
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const runPrice = useCallback(async () => {
    if (inFlight.current || !patchDraft) return;
    inFlight.current = true;
    setPrice({ kind: 'pricing' });
    try {
      const res = await priceCopilotEstimate(draft, ctx);
      if (!mounted.current) return;
      if (res.ok) { patchDraft({ priced: res.priced }); setPrice({ kind: 'idle' }); }
      else setPrice({ kind: 'error', message: res.message, limit: res.kind === 'limit' });
    } catch (e) {
      if (mounted.current) setPrice({ kind: 'error', message: (e as Error)?.message || 'Could not price the estimate. Try again.', limit: false });
    } finally {
      inFlight.current = false;
    }
  }, [draft, ctx, patchDraft]);

  // Price once when the card first shows an unpriced draft. A failure waits
  // for his Retry — never an automatic re-charge.
  const priced = draft.priced ?? null;
  useEffect(() => {
    if (!priced && price.kind === 'idle') void runPrice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priced]);

  const markup = copilotEstimateMarkup(draft, ctx);
  const preview = useMemo(() => {
    if (!priced) return null;
    // At 0% until he picks one, so the cost figure is real either way; the
    // total is not shown as a price until a markup exists.
    const est = buildCopilotLinkedEstimate(priced.costItems, markup?.pct ?? 0, 'preview', '');
    const groups = new Map<string, LinkedEstimateItem[]>();
    for (const it of est.items) {
      const k = it.category || 'General';
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    const sources = priced.costItems.map((i) => i.priceSource ?? 'regional');
    return { est, groups: [...groups.entries()], headline: pricedHeadline(sources, priced.fedEntries) };
  }, [priced, markup?.pct]);

  const replacing = replaceWarning(ctx.project?.linkedEstimate ?? null);

  if (!patchDraft) {
    return <Text style={styles.muted}>This review needs the Copilot screen — open it from a job.</Text>;
  }

  if (!priced) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.eyebrow}>PRICING YOUR ESTIMATE</Text>
        {!!note && <Text style={styles.note}>{note}</Text>}
        {price.kind === 'error' ? (
          <>
            <Text style={styles.headline}>{price.message}</Text>
            {price.limit ? (
              <TouchableOpacity accessibilityRole="button" style={styles.primary} activeOpacity={0.9} onPress={() => { onDiscard(); router.push('/paywall' as never); }} testID="copilot-estimate-see-plans">
                <Text style={styles.primaryText}>See plans</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity accessibilityRole="button" style={styles.primary} activeOpacity={0.9} onPress={() => void runPrice()} testID="copilot-estimate-retry">
                <RefreshCw size={16} color={Colors.textOnAccent} strokeWidth={2} />
                <Text style={styles.primaryText}>Try pricing again</Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.muted}>Pricing each line — nothing is saved until you build.</Text>
          </View>
        )}
        <TouchableOpacity accessibilityRole="button" style={styles.discard} onPress={onDiscard} activeOpacity={0.7}>
          <X size={14} color={colors.textMuted} strokeWidth={2} />
          <Text style={styles.discardText}>Discard</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const est = preview!.est;
  return (
    <View style={styles.wrap} testID="copilot-estimate-review">
      <Text style={styles.eyebrow}>READY TO BUILD</Text>
      <Text style={styles.headline}>{preview!.headline}</Text>
      {!!note && <Text style={styles.note}>{note}</Text>}

      {markup ? (
        <View style={styles.totals}>
          <Text style={styles.total} testID="copilot-estimate-total">{money(est.grandTotal)}</Text>
          <Text style={styles.split}>
            Cost {money(est.baseTotal)} + {markup.pct}% markup {money(est.markupTotal)} — from {markupSourceLabel(markup.source)}
          </Text>
        </View>
      ) : (
        <View style={styles.totals}>
          <Text style={styles.split}>Cost {money(est.baseTotal)}. What markup goes on top?</Text>
          <View style={styles.chips}>
            {MARKUP_CHOICES.map((n) => (
              <TouchableOpacity accessibilityRole="button" key={n} style={styles.chip} onPress={() => patchDraft({ markupPct: n })} activeOpacity={0.8} testID={`copilot-estimate-markup-${n}`}>
                <Text style={styles.chipText}>{n}%</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {preview!.groups.map(([cat, items]) => (
        <View key={cat} style={styles.group}>
          <Text style={styles.groupHead}>{cat.toUpperCase()}</Text>
          {items.map((it) => (
            <View key={it.materialId} style={styles.lineRow}>
              <View style={styles.lineText}>
                <Text style={styles.lineName} numberOfLines={2}>{it.name}</Text>
                <Text style={styles.lineSub}>{it.quantity} {it.unit} × {money(it.unitPrice)}</Text>
              </View>
              <Text style={[styles.badge, (it.priceSource ?? 'regional') === 'regional' ? styles.badgeRegional : styles.badgeMine]}>
                {BADGE[it.priceSource ?? 'regional']}
              </Text>
              <Text style={styles.lineTotal}>{money(it.lineTotal)}</Text>
            </View>
          ))}
        </View>
      ))}

      {(priced.qualityAssumed || priced.sizeAssumed || priced.notes.length > 0) && (
        <View style={styles.group}>
          <Text style={styles.groupHead}>ASSUMPTIONS — CHANGE ON THE GRID</Text>
          {priced.qualityAssumed && <Text style={styles.assumption}>• Finish level: {priced.quality} (assumed)</Text>}
          {priced.sizeAssumed && <Text style={styles.assumption}>• Work area: about {priced.sizeSqft} SF (assumed)</Text>}
          {priced.notes.map((n, i) => <Text key={i} style={styles.assumption}>• {n}</Text>)}
        </View>
      )}

      {!!replacing && <Text style={styles.warn} testID="copilot-estimate-replaces">{replacing}</Text>}

      <TouchableOpacity accessibilityRole="button"
        style={[styles.primary, !markup && styles.primaryOff]}
        activeOpacity={0.9}
        onPress={onBuild}
        disabled={!markup}
        testID="copilot-estimate-build"
      >
        <Hammer size={18} color={Colors.textOnAccent} strokeWidth={2} />
        <Text style={styles.primaryText}>{replacing ? 'Replace estimate' : 'Build it'}</Text>
      </TouchableOpacity>
      {!markup && <Text style={styles.muted}>Pick a markup first — MAGE won’t guess what you charge.</Text>}
      <TouchableOpacity accessibilityRole="button" style={styles.discard} onPress={onDiscard} activeOpacity={0.7}>
        <X size={14} color={colors.textMuted} strokeWidth={2} />
        <Text style={styles.discardText}>Discard</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: Tokens.spacing.sm },
    eyebrow: { ...Type.monoEyebrow, color: colors.accentLabel },
    headline: { ...Type.serifHeadline, color: colors.text },
    note: { ...Type.monoLabel, color: colors.textMuted, borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: Tokens.spacing.sm },
    muted: { ...Type.footnote, color: colors.textMuted },
    center: { alignItems: 'center', gap: Tokens.spacing.sm, paddingVertical: Tokens.spacing.xl },
    totals: { gap: Tokens.spacing.xxs, paddingVertical: Tokens.spacing.xs },
    total: { ...Type.title2, color: colors.text },
    split: { ...Type.footnote, color: colors.textSecondary },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xs },
    chip: { ...cardSurface(colors, { radius: 'full', pad: 'none' }), paddingHorizontal: Tokens.spacing.md, paddingVertical: Tokens.spacing.xs, borderColor: colors.accent },
    chipText: { ...Type.subheadEmphasized, color: colors.text },
    group: { gap: Tokens.spacing.xxs, paddingTop: Tokens.spacing.xs },
    groupHead: { ...Type.monoLabel, color: colors.textMuted },
    lineRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm, paddingVertical: Tokens.spacing.xxs, borderBottomWidth: 1, borderBottomColor: colors.line },
    lineText: { flex: 1, gap: 2 },
    lineName: { ...Type.subhead, color: colors.text },
    lineSub: { ...Type.monoLabel, color: colors.textMuted },
    badge: { ...Type.monoLabel, paddingHorizontal: Tokens.spacing.xs, paddingVertical: 2, borderRadius: Tokens.radius.sm, overflow: 'hidden' },
    badgeMine: { color: colors.text, backgroundColor: colors.accentSoft },
    badgeRegional: { color: colors.textMuted, borderWidth: 1, borderColor: colors.line },
    lineTotal: { ...Type.subheadEmphasized, color: colors.text, minWidth: 90, textAlign: 'right' },
    assumption: { ...Type.footnote, color: colors.textSecondary },
    // A Text style: cardSurface returns ViewStyle, which widens this whole
    // StyleSheet's inference to a View|Text|Image union unless typed as text.
    warn: { ...Type.footnote, ...(cardSurface(colors, { radius: 'md', pad: Tokens.spacing.sm }) as TextStyle), color: colors.text, borderColor: colors.accent },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.xs, backgroundColor: colors.accentFill, borderRadius: Tokens.radius.lg, paddingVertical: Tokens.spacing.md, marginTop: Tokens.spacing.sm },
    primaryOff: { opacity: 0.4 },
    primaryText: { ...Type.bodyEmphasized, color: Colors.textOnAccent },
    discard: { flexDirection: 'row', gap: Tokens.spacing.xxs, alignItems: 'center', justifyContent: 'center', paddingVertical: Tokens.spacing.sm },
    discardText: { ...Type.footnote, color: colors.textMuted },
  });
}
