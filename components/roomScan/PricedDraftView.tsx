// components/roomScan/PricedDraftView.tsx — The Priced Estimate: a draft the
// person reviews line by line before anything goes into the estimate.
//
// EVERY LINE SAYS WHERE ITS PRICE CAME FROM. "Your Price, 6 Past Jobs" only
// for his own cost book, and "Your Price For Doors, 3 Past Jobs" when it came
// from one of his trades that is not the line's own. "Catalog Price" for a
// list price. "No Price Yet" for a blank, which adds nothing to the total and
// is never shown as $0.
//
// A PROJECT WITH NO ESTIMATE YET: the same button, and the confirm sheet says
// it will START the estimate, at which markup. Nothing is started without the
// yes either.
//
// NOTHING IS SAVED FROM THIS SCREEN WITHOUT A YES. Open In Estimate opens a
// sheet that says what will happen. Only its confirm button calls onConfirm.
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Button, Sheet } from '@/components/ui';
import { formatMoney } from '@/utils/formatters';
import type { RoomScanCopy } from '@/hooks/useRoomScanCopy';
import type { DraftBlock, ScanDraft, ScanDraftLine } from '@/utils/roomScan/pricingCore';
import type { RecipeKey } from '@/utils/roomScan/recipesCore';
import { makeRoomScanStyles } from './styles';

export interface PricedDraftViewProps {
  roomName: string;
  draft: ScanDraft;
  copy: RoomScanCopy;
  block: DraftBlock | null;
  /** How many lines the confirm would write. */
  pushCount: number;
  /** True when the project has no estimate and the confirm would start one. */
  starting: boolean;
  /** His stated markup, shown on the confirm sheet when the confirm starts the estimate. */
  markupPct: number | null;
  /** True when material lines from this room's order list are already in the estimate: the confirm says the material would be in there twice. */
  materialsAlreadyIn?: boolean;
  /** 'added' only after the estimate was seen to hold the lines. 'unconfirmed' when it was not. */
  result: 'idle' | 'added' | 'failed' | 'unconfirmed';
  /** True while a confirmed push is being written and checked. */
  busy: boolean;
  onManualRate: (key: RecipeKey, rate: number | null) => void;
  onToggle: (key: RecipeKey) => void;
  onConfirm: () => void;
}

const qtyText = (l: ScanDraftLine): string => String(l.quantity);

export function PricedDraftView(p: PricedDraftViewProps) {
  const { draft, copy } = p;
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  const [typing, setTyping] = useState<RecipeKey | null>(null);
  const [rateText, setRateText] = useState('');
  const [rateBad, setRateBad] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const applyRate = (key: RecipeKey) => {
    const n = parseFloat(rateText.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n <= 0) { setRateBad(true); return; }
    p.onManualRate(key, n);
    setTyping(null); setRateText(''); setRateBad(false);
  };
  const live = draft.lines.filter((l) => l.included);
  const hasCatalog = live.some((l) => l.source === 'engine');
  const total = formatMoney(draft.totalCents / 100, 2);

  return (
    <View style={styles.body} testID="scan-draft">
      <Text style={styles.para}>{copy.draftIntroBody(p.roomName)}</Text>
      <View style={styles.card}>
        {draft.lines.map((l, i) => {
          const priced = l.amountCents != null && l.rate != null;
          const own = l.source === 'yours';
          return (
            <View key={l.key} style={[styles.row, i === 0 && styles.rowFirst, !l.included && styles.lineOut]} testID={`scan-line-${l.key}`}>
              <View style={styles.rowMain}>
                <Text style={styles.rowLabel}>{copy.lineName(l.key)}</Text>
                <Text style={styles.rowSub}>
                  {priced ? copy.lineQtySub(qtyText(l), l.unit, formatMoney(l.rate as number, 2)) : copy.lineNoPriceSub(qtyText(l), l.unit)}
                </Text>
                {l.wastePct > 0 && <Text style={styles.rowSub}>{copy.lineWasteSub(l.wastePct)}</Text>}
                <View style={[styles.pill, own && styles.pillOwn]} testID={`scan-source-${l.key}`}>
                  <Text style={[styles.pillText, own && styles.pillTextOwn]}>{copy.sourceLabel(l.source, l.claim)}</Text>
                </View>
                {!priced && l.included && <Text style={styles.note}>{copy.noPriceBody}</Text>}
                {!l.included && <Text style={styles.note}>{copy.leftOutSub}</Text>}
                {typing === l.key ? (
                  <View style={{ gap: 6 }}>
                    <Text style={styles.eyebrow}>{copy.priceInputLabel}</Text>
                    <TextInput
                      testID={`scan-rate-input-${l.key}`}
                      style={styles.input}
                      value={rateText}
                      onChangeText={(v) => { setRateText(v); setRateBad(false); }}
                      keyboardType="decimal-pad"
                      placeholderTextColor={colors.textMuted}
                      accessibilityLabel={copy.priceInputLabel}
                      onSubmitEditing={() => applyRate(l.key)}
                    />
                    {rateBad && <Text style={styles.errorText}>{copy.priceInvalidBody}</Text>}
                    <View style={styles.sheetActions}>
                      <Button label={copy.cancelLabel} variant="ghost" size="sm" onPress={() => { setTyping(null); setRateBad(false); }} />
                      <Button label={copy.usePriceLabel} variant="secondary" size="sm" onPress={() => applyRate(l.key)} testID={`scan-rate-use-${l.key}`} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.chips}>
                    {l.included && (
                      <Pressable style={styles.linkBtn} onPress={() => { setTyping(l.key); setRateText(''); }} accessibilityRole="button" testID={`scan-type-price-${l.key}`}>
                        <Text style={styles.linkText}>{copy.typePriceLabel}</Text>
                      </Pressable>
                    )}
                    <Pressable style={styles.linkBtn} onPress={() => p.onToggle(l.key)} accessibilityRole="button" testID={`scan-toggle-${l.key}`}>
                      <Text style={styles.linkText}>{l.included ? copy.leaveOutLabel : copy.putBackLabel}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
              <Text style={styles.rowValue}>{priced && l.included ? formatMoney((l.amountCents as number) / 100, 2) : ''}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.card}>
        <View style={styles.total}>
          <View style={styles.rowMain}>
            <Text style={styles.eyebrow}>{copy.totalLabel}</Text>
            <Text style={styles.rowSub}>{copy.totalSub(draft.ownCount, draft.pricedCount)}</Text>
          </View>
          <Text style={styles.totalValue} testID="scan-draft-total">{total}</Text>
        </View>
        <Text style={styles.note}>{copy.markupNote}</Text>
        {draft.unpricedCount > 0 && <Text style={styles.note}>{copy.unpricedNote(draft.unpricedCount)}</Text>}
        {hasCatalog && <Text style={styles.note}>{copy.catalogNote}</Text>}
      </View>

      {p.block && (
        <View style={styles.blocked} testID="scan-draft-blocked">
          <Text style={styles.blockedText}>{copy.draftBlockBody(p.block)}</Text>
        </View>
      )}
      {p.result === 'added' && <Text style={styles.okText} testID="scan-draft-added">{copy.addedBody}</Text>}
      {p.result === 'failed' && <Text style={styles.errorText} testID="scan-draft-failed">{copy.addFailedBody}</Text>}
      {p.result === 'unconfirmed' && <Text style={styles.errorText} testID="scan-draft-unconfirmed">{copy.unconfirmedBody}</Text>}
      <Button label={copy.openInEstimateLabel} variant="primary" onPress={() => setConfirming(true)} disabled={p.block != null || p.busy} loading={p.busy} testID="scan-open-estimate" />

      <Sheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        size="form"
        title={p.starting ? copy.startTitleLabel : copy.confirmTitleLabel}
        testID="scan-confirm-sheet"
        primaryAction={{ label: p.starting ? copy.startYesLabel : copy.confirmYesLabel, onPress: () => { setConfirming(false); p.onConfirm(); }, testID: 'scan-confirm-yes' }}
        secondaryAction={{ label: copy.confirmNoLabel, onPress: () => setConfirming(false), testID: 'scan-confirm-no' }}
      >
        <Text style={styles.para} testID="scan-confirm-body">{p.starting && p.markupPct != null ? copy.startConfirmBody(p.pushCount, total, p.markupPct) : copy.confirmBody(p.pushCount, total)}</Text>
        {p.materialsAlreadyIn === true && <Text style={styles.para} testID="scan-confirm-materials-in">{copy.confirmMaterialsInBody}</Text>}
      </Sheet>
    </View>
  );
}
