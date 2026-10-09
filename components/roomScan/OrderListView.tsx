// components/roomScan/OrderListView.tsx — The Order List: what to buy for the
// room, as a list a contractor would hand a supplier.
//
// Everything on this screen is worked out by utils/roomScan/orderListCore from
// the room's true shape and drawn as it is handed in. Each line shows how it
// was worked out. A rule of thumb is labelled as one. A quantity he typed is
// kept and marked. The first thing on the screen is the plain statement that a
// phone scan can be off by an inch or more.
//
// NOTHING LEAVES THIS SCREEN WITHOUT A YES. Copy As Text, Share The List and
// Add Materials To Estimate each open a sheet that says what will happen. The
// ONLY calls to `onSend` in this file are the three sheets' confirm buttons,
// and each passes the literal `true` the pure core asks for
// (orderListCore.confirmOrderSend). scripts/validate-scan-order.ts reads this
// file to check it.
//
// THE ESTIMATE SHEET SAYS EVERYTHING THE YES WILL DO. How many lines go in,
// the double-count warning (the general one, or the specific one when this
// room's installed lines are already in the estimate), and on a second send
// the NAMES of the lines that will be removed and of the lines left alone
// because he changed them by hand (orderPricingCore.planOrderResend).
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Button, Sheet } from '@/components/ui';
import { formatMoney } from '@/utils/formatters';
import type { RoomScanCopy } from '@/hooks/useRoomScanCopy';
import type { ScanOrderCopy } from '@/hooks/useScanOrderCopy';
import { SHEET_KEYS, type SurfacePlan } from '@/utils/roomScan/cutPlanCore';
import type { LongWallSuggestion, TapeFacts } from '@/utils/roomScan/learnCore';
import {
  CASING_WIDTHS_IN, FLOOR_LAYOUTS, ORDER_GROUPS, TRIM_KINDS, WINDOW_TRIMS, orderLinesToBuy,
  type OrderGroup, type OrderLine, type OrderList, type OrderOptions, type OrderSendVia,
} from '@/utils/roomScan/orderListCore';
import type { OrderDraft } from '@/utils/roomScan/orderPricingCore';
import type { DraftBlock } from '@/utils/roomScan/pricingCore';
import { STOCK_LENGTHS_FT } from '@/utils/roomScan/trimPackCore';
import { formatFeetInches, inchesToMetres } from '@/utils/roomScan/units';
import { CutLayoutView } from './CutLayoutView';
import { TapeFactsPanel } from './TapeFactsPanel';
import { makeRoomScanStyles } from './styles';

export type OrderSendState = 'idle' | 'copied' | 'copyFailed' | 'shared' | 'sharedAsCopy' | 'shareFailed' | 'added' | 'failed' | 'unconfirmed';

export interface OrderListViewProps {
  roomName: string;
  list: OrderList;
  draft: OrderDraft;
  copy: RoomScanCopy;
  ocopy: ScanOrderCopy;
  tape: TapeFacts;
  suggestion: LongWallSuggestion | null;
  /** Why the materials cannot go to the estimate, or null. Copy and Share do not depend on it. */
  block: DraftBlock | null;
  /** Lines the estimate confirm would write. */
  pushCount: number;
  starting: boolean;
  markupPct: number | null;
  /** True when this room's installed lines (Price It) are already in the estimate: the double-count sentence is then the specific one. */
  installedAlreadyIn: boolean;
  /** What a second send would do beyond adding and updating, as estimate line names. `again` is true once this list has been sent to the estimate before. */
  resend: { again: boolean; remove: string[]; leftAlone: string[] };
  sendState: OrderSendState;
  busy: boolean;
  onOptions: (patch: Partial<OrderOptions>) => void;
  onTypedQuantity: (key: string, quantity: number | null) => void;
  onManualRate: (key: string, rate: number | null) => void;
  /** Called ONLY from a confirm sheet's yes, with the literal true. */
  onSend: (via: OrderSendVia, confirmed: true) => void;
}

const WASTE_STEPS = [5, 10, 15, 20] as const;
const WET_HEIGHTS_FT = [4, 6] as const;
const SPREADS = [250, 300, 350, 400] as const;
const COATS = [1, 2, 3] as const;
const feetInches = (inches: number): string => formatFeetInches(inchesToMetres(inches));
type Styles = ReturnType<typeof makeRoomScanStyles>;

function Chip({ styles, label, on, onPress, testID }: { styles: Styles; label: string; on: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable style={[styles.chip, on && styles.chipOn]} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} testID={testID}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Choice({ styles, label, children }: { styles: Styles; label: string; children: React.ReactNode }) {
  return (
    <View style={styles.choice}>
      <Text style={styles.eyebrow}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

export function OrderListView(p: OrderListViewProps) {
  const { list, draft, copy, ocopy } = p;
  const o = list.options;
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  const [typing, setTyping] = useState<{ key: string; what: 'qty' | 'rate' } | null>(null);
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const [confirming, setConfirming] = useState<OrderSendVia | null>(null);
  const [ignored, setIgnored] = useState(false);
  const [surfaceId, setSurfaceId] = useState<string | null>(null);

  const toBuy = orderLinesToBuy(list);
  const priceOf = new Map(draft.lines.map((l) => [l.key, l]));
  const total = formatMoney(draft.totalCents / 100, 2);

  const applyTyped = (key: string, what: 'qty' | 'rate') => {
    const raw = text.replace(/[$,\s]/g, '');
    const n = Number(raw);
    if (what === 'qty') {
      if (!/^\d+$/.test(raw) || !Number.isFinite(n)) { setBad(true); return; }
      p.onTypedQuantity(key, n);
    } else {
      if (!raw || !Number.isFinite(n) || n <= 0) { setBad(true); return; }
      p.onManualRate(key, n);
    }
    setTyping(null); setText(''); setBad(false);
  };

  const surfaces: SurfacePlan[] = [...(list.wallPlan?.surfaces ?? []), ...(list.ceilingPlan?.surfaces ?? [])];
  const shown = surfaces.find((s) => s.surfaceId === surfaceId) ?? surfaces[0] ?? null;
  const pieceLines = React.useMemo(() => (shown ? shown.pieces.map((x) => ocopy.pieceSub(x)) : []), [shown, ocopy]);
  const surfaceName = (s: SurfacePlan): string => (s.kind === 'ceiling' ? ocopy.layoutCeilingLabel : copy.wallName(list.walls.find((w) => w.wallId === s.surfaceId)?.label ?? ''));
  const addedWalls = list.walls.filter((w) => w.addedIn > 0);

  // A plain function, not a component: a component declared here would be a new type on every render and drop the keyboard.
  const renderLine = (l: OrderLine, first: boolean) => {
    const price = priceOf.get(l.key);
    const priced = !!price && price.amountCents != null && price.rate != null;
    const zero = !(l.quantity > 0);
    return (
      <View key={l.key} style={[styles.row, first && styles.rowFirst, zero && styles.lineOut]} testID={`scan-order-line-${l.key}`}>
        <View style={styles.rowMain}>
          <Text style={styles.rowLabel}>{ocopy.lineName(l)}</Text>
          <View style={styles.chips}>
            {l.ruleOfThumb && (
              <View style={styles.pill} testID={`scan-order-rot-${l.key}`}><Text style={styles.pillText}>{ocopy.ruleOfThumbLabel}</Text></View>
            )}
            {l.typed && (
              <View style={[styles.pill, styles.pillOwn]} testID={`scan-order-typed-${l.key}`}><Text style={[styles.pillText, styles.pillTextOwn]}>{ocopy.typedLabel}</Text></View>
            )}
          </View>
          {l.typed && <Text style={styles.rowSub}>{ocopy.workedSub(ocopy.quantity({ ...l, quantity: l.computed, typed: false }))}</Text>}
          <Text style={styles.note} testID={`scan-order-basis-${l.key}`}>{ocopy.assumption(l)}</Text>
          {!zero && (
            <View style={styles.pill} testID={`scan-order-source-${l.key}`}>
              <Text style={styles.pillText}>{ocopy.materialSourceLabel(price?.source ?? null, copy.sourceLabel('manual', null), copy.sourceLabel(null, null))}</Text>
            </View>
          )}
          {!zero && priced && <Text style={styles.rowSub}>{l.unit === 'sqft' ? ocopy.priceSqFtSub(formatMoney(price.rate as number, 2)) : l.unit === 'foot' ? ocopy.priceFootSub(formatMoney(price.rate as number, 2)) : ocopy.priceEachSub(formatMoney(price.rate as number, 2))}</Text>}
          {typing?.key === l.key ? (
            <View style={styles.choice}>
              <Text style={styles.eyebrow}>{typing.what === 'qty' ? ocopy.qtyInputLabel : copy.priceInputLabel}</Text>
              <TextInput
                testID={`scan-order-input-${l.key}`}
                style={styles.input}
                value={text}
                onChangeText={(v) => { setText(v); setBad(false); }}
                keyboardType={typing.what === 'qty' ? 'number-pad' : 'decimal-pad'}
                placeholderTextColor={colors.textMuted}
                accessibilityLabel={typing.what === 'qty' ? ocopy.qtyInputLabel : copy.priceInputLabel}
                onSubmitEditing={() => applyTyped(l.key, typing.what)}
              />
              {bad && <Text style={styles.errorText}>{typing.what === 'qty' ? ocopy.qtyInvalidBody : copy.priceInvalidBody}</Text>}
              <View style={styles.sheetActions}>
                <Button label={copy.cancelLabel} variant="ghost" size="sm" onPress={() => { setTyping(null); setBad(false); }} />
                <Button label={typing.what === 'qty' ? ocopy.useQtyLabel : copy.usePriceLabel} variant="secondary" size="sm" onPress={() => applyTyped(l.key, typing.what)} testID={`scan-order-use-${l.key}`} />
              </View>
            </View>
          ) : (
            <View style={styles.chips}>
              <Pressable style={styles.linkBtn} onPress={() => { setTyping({ key: l.key, what: 'qty' }); setText(''); setBad(false); }} accessibilityRole="button" testID={`scan-order-type-qty-${l.key}`}>
                <Text style={styles.linkText}>{ocopy.typeQtyLabel}</Text>
              </Pressable>
              {l.typed && (
                <Pressable style={styles.linkBtn} onPress={() => p.onTypedQuantity(l.key, null)} accessibilityRole="button" testID={`scan-order-clear-qty-${l.key}`}>
                  <Text style={styles.linkText}>{ocopy.clearQtyLabel}</Text>
                </Pressable>
              )}
              {!zero && (
                <Pressable style={styles.linkBtn} onPress={() => { setTyping({ key: l.key, what: 'rate' }); setText(''); setBad(false); }} accessibilityRole="button" testID={`scan-order-type-price-${l.key}`}>
                  <Text style={styles.linkText}>{copy.typePriceLabel}</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
        <View style={styles.qtyCol}>
          <Text style={styles.rowValue} testID={`scan-order-qty-${l.key}`}>{ocopy.quantity(l)}</Text>
          {!zero && priced && <Text style={styles.rowSub}>{formatMoney((price.amountCents as number) / 100, 2)}</Text>}
        </View>
      </View>
    );
  };

  const sendNote = p.sendState === 'copied' ? ocopy.copiedNote
    : p.sendState === 'shared' ? ocopy.sharedNote
    : p.sendState === 'sharedAsCopy' ? ocopy.sharedAsCopyNote
    : p.sendState === 'added' ? copy.addedBody : null;
  const sendError = p.sendState === 'copyFailed' ? ocopy.copyFailedBody
    : p.sendState === 'shareFailed' ? ocopy.shareFailedBody
    : p.sendState === 'failed' ? copy.addFailedBody
    : p.sendState === 'unconfirmed' ? copy.unconfirmedBody : null;

  return (
    <View style={styles.body} testID="scan-order">
      <View style={styles.blocked} testID="scan-order-notice">
        <View style={styles.factRow}>
          <AlertTriangle size={14} color={colors.warningLabel} />
          <Text style={[styles.factText, styles.factCheck]}>{ocopy.noticeBody}</Text>
        </View>
      </View>
      <Text style={styles.para}>{ocopy.introBody(p.roomName)}</Text>

      <View style={styles.card} testID="scan-order-choices">
        <Text style={styles.cardHeading}>{ocopy.choicesHeadingLabel}</Text>
        <Choice styles={styles} label={ocopy.includeLabel}>
          {ORDER_GROUPS.map((g: OrderGroup) => (
            <Chip styles={styles} key={g} label={ocopy.groupLabel(g)} on={o.groups[g]} testID={`scan-order-group-${g}`} onPress={() => p.onOptions({ groups: { ...o.groups, [g]: !o.groups[g] } })} />
          ))}
        </Choice>
        {o.groups.drywall && (
          <>
            <Choice styles={styles} label={ocopy.sheetSizeLabel}>
              {SHEET_KEYS.map((k) => <Chip styles={styles} key={k} label={k} on={o.sheet === k} testID={`scan-order-sheet-${k}`} onPress={() => p.onOptions({ sheet: k })} />)}
            </Choice>
            <Choice styles={styles} label={ocopy.hangLabel}>
              {(['across', 'upright'] as const).map((h) => <Chip styles={styles} key={h} label={ocopy.hangName(h)} on={o.hang === h} testID={`scan-order-hang-${h}`} onPress={() => p.onOptions({ hang: h })} />)}
            </Choice>
          </>
        )}
        {o.groups.flooring && (
          <Choice styles={styles} label={ocopy.floorKindLabel}>
            {(['tile', 'flooring'] as const).map((k) => <Chip styles={styles} key={k} label={ocopy.floorKindName(k)} on={o.floorKind === k} testID={`scan-order-floor-${k}`} onPress={() => p.onOptions({ floorKind: k })} />)}
          </Choice>
        )}
        {o.groups.flooring && (
          <>
            <Choice styles={styles} label={ocopy.layoutLabel}>
              {FLOOR_LAYOUTS.map((l) => <Chip styles={styles} key={l} label={ocopy.layoutName(l)} on={o.floorLayout === l} testID={`scan-order-layout-${l}`} onPress={() => p.onOptions({ floorLayout: l })} />)}
            </Choice>
            <Choice styles={styles} label={ocopy.wasteLabel}>
              <Chip styles={styles} label={ocopy.wasteAutoLabel} on={o.floorWastePct == null} testID="scan-order-waste-auto" onPress={() => p.onOptions({ floorWastePct: null })} />
              {WASTE_STEPS.map((w) => <Chip styles={styles} key={w} label={ocopy.wastePctLabel(w)} on={o.floorWastePct === w} testID={`scan-order-waste-${w}`} onPress={() => p.onOptions({ floorWastePct: w })} />)}
            </Choice>
          </>
        )}
        {o.groups.wallTile && (
          <>
            <Choice styles={styles} label={ocopy.wetWallsLabel}>
              {list.walls.map((w) => {
                const on = o.wetWallIds.includes(w.wallId);
                return <Chip styles={styles} key={w.wallId} label={`${copy.wallName(w.label)}, ${feetInches(w.lengthIn)}`} on={on} testID={`scan-order-wet-${w.label.replace(/\D+/g, '')}`} onPress={() => p.onOptions({ wetWallIds: on ? o.wetWallIds.filter((id) => id !== w.wallId) : [...o.wetWallIds, w.wallId] })} />;
              })}
            </Choice>
            <Choice styles={styles} label={ocopy.wetHeightLabel}>
              {WET_HEIGHTS_FT.map((ft) => <Chip styles={styles} key={ft} label={ocopy.wetHeightFtLabel(ft)} on={o.wetHeightIn === ft * 12} testID={`scan-order-wet-height-${ft}`} onPress={() => p.onOptions({ wetHeightIn: ft * 12 })} />)}
              <Chip styles={styles} label={ocopy.wetHeightFullLabel} on={o.wetHeightIn == null} testID="scan-order-wet-height-full" onPress={() => p.onOptions({ wetHeightIn: null })} />
            </Choice>
            <Choice styles={styles} label={ocopy.wallTileWasteLabel}>
              <Chip styles={styles} label={ocopy.wasteAutoLabel} on={o.wallTileWastePct == null} testID="scan-order-wall-waste-auto" onPress={() => p.onOptions({ wallTileWastePct: null })} />
              {WASTE_STEPS.map((w) => <Chip styles={styles} key={w} label={ocopy.wastePctLabel(w)} on={o.wallTileWastePct === w} testID={`scan-order-wall-waste-${w}`} onPress={() => p.onOptions({ wallTileWastePct: w })} />)}
            </Choice>
          </>
        )}
        {o.groups.paint && (
          <>
            <Choice styles={styles} label={ocopy.coatsLabel}>
              {COATS.map((c) => <Chip styles={styles} key={c} label={ocopy.coatsName(c)} on={o.coats === c} testID={`scan-order-coats-${c}`} onPress={() => p.onOptions({ coats: c })} />)}
            </Choice>
            <Choice styles={styles} label={ocopy.spreadLabel}>
              {SPREADS.map((s) => <Chip styles={styles} key={s} label={ocopy.spreadName(s)} on={o.spreadSFPerGal === s} testID={`scan-order-spread-${s}`} onPress={() => p.onOptions({ spreadSFPerGal: s })} />)}
            </Choice>
            <Choice styles={styles} label={ocopy.primerLabel}>
              <Chip styles={styles} label={ocopy.yesLabel} on={o.primer} testID="scan-order-primer-yes" onPress={() => p.onOptions({ primer: true })} />
              <Chip styles={styles} label={ocopy.noLabel} on={!o.primer} testID="scan-order-primer-no" onPress={() => p.onOptions({ primer: false })} />
            </Choice>
          </>
        )}
        {o.groups.trim && (
          <>
            <Choice styles={styles} label={ocopy.stockLabel}>
              {STOCK_LENGTHS_FT.map((ft) => {
                const on = o.stockFt.includes(ft);
                // The last length cannot be switched off: there must be a stick to cut from.
                return <Chip styles={styles} key={ft} label={ocopy.stockName(ft)} on={on} testID={`scan-order-stock-${ft}`} onPress={() => { if (on && o.stockFt.length === 1) return; p.onOptions({ stockFt: on ? o.stockFt.filter((x) => x !== ft) : [...o.stockFt, ft].sort((a, b) => a - b) }); }} />;
              })}
            </Choice>
            <Choice styles={styles} label={ocopy.crownLabel}>
              <Chip styles={styles} label={ocopy.yesLabel} on={o.crown} testID="scan-order-crown-yes" onPress={() => p.onOptions({ crown: true })} />
              <Chip styles={styles} label={ocopy.noLabel} on={!o.crown} testID="scan-order-crown-no" onPress={() => p.onOptions({ crown: false })} />
            </Choice>
            <Choice styles={styles} label={ocopy.windowCasingLabel}>
              <Chip styles={styles} label={ocopy.yesLabel} on={o.casingWindows} testID="scan-order-window-casing-yes" onPress={() => p.onOptions({ casingWindows: true })} />
              <Chip styles={styles} label={ocopy.noLabel} on={!o.casingWindows} testID="scan-order-window-casing-no" onPress={() => p.onOptions({ casingWindows: false })} />
            </Choice>
            <Choice styles={styles} label={ocopy.casingWidthLabel}>
              {CASING_WIDTHS_IN.map((w) => <Chip styles={styles} key={w} label={ocopy.casingWidthName(w)} on={o.casingWidthIn === w} testID={`scan-order-casing-width-${String(w).replace('.', '-')}`} onPress={() => p.onOptions({ casingWidthIn: w })} />)}
            </Choice>
            <Choice styles={styles} label={ocopy.casingSidesLabel}>
              <Chip styles={styles} label={ocopy.casingOneSideLabel} on={!o.casingBothSides} testID="scan-order-casing-one-side" onPress={() => p.onOptions({ casingBothSides: false })} />
              <Chip styles={styles} label={ocopy.casingBothSidesLabel} on={o.casingBothSides} testID="scan-order-casing-both-sides" onPress={() => p.onOptions({ casingBothSides: true })} />
            </Choice>
            {o.casingWindows && (
              <Choice styles={styles} label={ocopy.windowTrimLabel}>
                {WINDOW_TRIMS.map((w) => <Chip styles={styles} key={w} label={ocopy.windowTrimName(w)} on={o.windowTrim === w} testID={`scan-order-window-trim-${w}`} onPress={() => p.onOptions({ windowTrim: w })} />)}
              </Choice>
            )}
          </>
        )}
      </View>

      {list.gaps.map((g) => (
        <View key={g} style={styles.blocked} testID={`scan-order-gap-${g}`}>
          <Text style={styles.blockedText}>{ocopy.gapBody(g)}</Text>
        </View>
      ))}
      {addedWalls.length > 0 && (
        <Text style={styles.note} testID="scan-order-added">{ocopy.addedNote(ocopy.inchesText(o.longWallAddIn), addedWalls.length)}</Text>
      )}

      {list.lines.length === 0 && <Text style={styles.note} testID="scan-order-empty">{ocopy.nothingBody}</Text>}
      {ORDER_GROUPS.map((g) => {
        const rows = list.lines.filter((l) => l.group === g);
        if (!rows.length) return null;
        return (
          <View key={g} style={styles.card} testID={`scan-order-card-${g}`}>
            <Text style={styles.cardHeading}>{ocopy.groupLabel(g)}</Text>
            {rows.map((l, i) => renderLine(l, i === 0))}
          </View>
        );
      })}

      {shown && (
        <View style={styles.card} testID="scan-order-layout">
          <Text style={styles.cardHeading}>{ocopy.layoutHeadingLabel}</Text>
          <Text style={styles.note}>{ocopy.layoutIntroBody}</Text>
          <View style={styles.chips}>
            {surfaces.map((s) => <Chip styles={styles} key={s.surfaceId} label={surfaceName(s)} on={s.surfaceId === shown.surfaceId} testID={`scan-order-surface-${s.kind === 'ceiling' ? 'ceiling' : surfaceName(s).replace(/\D+/g, '')}`} onPress={() => setSurfaceId(s.surfaceId)} />)}
          </View>
          <CutLayoutView surface={shown} a11yLabel={ocopy.layoutA11y(surfaceName(shown))} listLabel={ocopy.pieceListLabel} pieceLines={pieceLines} testID="scan-order-layout-drawing" />
          <Text style={styles.rowSub} testID="scan-order-layout-count">{ocopy.layoutCountSub(shown.pieces.length, shown.newSheets)}</Text>
          <Text style={styles.note} testID="scan-order-layout-rules">{ocopy.layoutRulesNote(list.wallPlan?.minPieceIn ?? list.ceilingPlan?.minPieceIn ?? 0, list.wallPlan?.staggerIn ?? list.ceilingPlan?.staggerIn ?? 0)}</Text>
          {shown.stackedJoints > 0 && <Text style={styles.note} testID="scan-order-layout-stacked">{ocopy.stackedNote(shown.stackedJoints, list.wallPlan?.staggerIn ?? list.ceilingPlan?.staggerIn ?? 0)}</Text>}
          {shown.floorGapIn > 0 && <Text style={styles.note} testID="scan-order-layout-floor-gap">{ocopy.floorGapNote(shown.floorGapIn)}</Text>}
          {shown.gapIn > 0 && <Text style={styles.note}>{ocopy.gapNote(ocopy.inchFraction(shown.gapIn))}</Text>}
          {shown.longerSheet && (
            <Text style={styles.note} testID="scan-order-layout-longer-sheet">{ocopy.longerSheetNote(shown.longerSheet.overIn, shown.longerSheet.sheet, shown.longerSheet.along)}</Text>
          )}
          <Text style={styles.note} testID="scan-order-spare-note">{o.spareSheets > 0 ? ocopy.spareAddedNote(o.spareSheets) : ocopy.noSpareNote}</Text>
          {o.spareSheets > 0
            ? <Button label={ocopy.removeSpareLabel} variant="ghost" size="sm" onPress={() => p.onOptions({ spareSheets: 0 })} testID="scan-order-spare-remove" />
            : <Button label={ocopy.addSpareLabel} variant="secondary" size="sm" onPress={() => p.onOptions({ spareSheets: 1 })} testID="scan-order-spare-add" />}
          <View style={styles.legendRow}><View style={styles.legendBox} /><Text style={styles.rowSub}>{ocopy.legendNewSub}</Text></View>
          <View style={styles.legendRow}><View style={[styles.legendBox, styles.legendBoxOffcut]}><View style={styles.legendStripe} /><View style={styles.legendStripe} /></View><Text style={styles.rowSub}>{ocopy.legendOffcutSub}</Text></View>
          <View style={styles.legendRow}><View style={[styles.legendBox, styles.legendBoxCut]} /><Text style={styles.rowSub}>{ocopy.legendCutoutSub}</Text></View>
          {shown.kind === 'ceiling' && shown.pieces.some((x) => x.cutToShape) && (
            <View style={styles.legendRow}><View style={[styles.legendBox, styles.legendBoxShape]} /><Text style={styles.rowSub}>{ocopy.legendShapeSub}</Text></View>
          )}
        </View>
      )}

      {o.groups.trim && TRIM_KINDS.some((k) => list.trimPlans[k]) && (
        <View style={styles.card} testID="scan-order-cut-list">
          <Text style={styles.cardHeading}>{ocopy.cutListHeadingLabel}</Text>
          {TRIM_KINDS.map((k) => {
            const plan = list.trimPlans[k];
            if (!plan) return null;
            return (
              <View key={k} style={styles.choice} testID={`scan-order-cuts-${k}`}>
                <Text style={styles.eyebrow}>{ocopy.trimKindLabel(k)}</Text>
                {plan.sticks.map((s, i) => (
                  <Text key={`${k}-${i}`} style={styles.rowSub}>{ocopy.stickSub(s.stockFt, s.cuts.map((c) => feetInches(c.lengthIn)).join(', '), feetInches(s.dropIn))}</Text>
                ))}
                <Text style={styles.note}>{ocopy.packNote(plan.onePerPiece.boughtFt, plan.boughtFt, plan.method)}</Text>
              </View>
            );
          })}
        </View>
      )}

      <TapeFactsPanel
        facts={p.tape}
        suggestion={p.suggestion}
        acceptedIn={o.longWallAddIn}
        ignored={ignored}
        copy={ocopy}
        onAccept={(addIn) => p.onOptions({ longWallAddIn: addIn })}
        onIgnore={() => setIgnored(true)}
        onRemove={() => p.onOptions({ longWallAddIn: 0 })}
      />

      <View style={styles.card}>
        <View style={styles.total}>
          <View style={styles.rowMain}>
            <Text style={styles.eyebrow}>{copy.totalLabel}</Text>
          </View>
          <Text style={styles.totalValue} testID="scan-order-total">{total}</Text>
        </View>
        {draft.unpricedCount > 0 && <Text style={styles.note}>{copy.unpricedNote(draft.unpricedCount)}</Text>}
        <Text style={styles.note}>{ocopy.materialPriceNote}</Text>
      </View>

      {sendNote && <Text style={styles.okText} testID={`scan-order-sent-${p.sendState}`}>{sendNote}</Text>}
      {sendError && <Text style={styles.errorText} testID={`scan-order-sent-${p.sendState}`}>{sendError}</Text>}
      <Button label={ocopy.copyLabel} variant="secondary" onPress={() => setConfirming('copy')} disabled={toBuy.length === 0 || p.busy} testID="scan-order-copy" />
      <Button label={ocopy.shareLabel} variant="secondary" onPress={() => setConfirming('share')} disabled={toBuy.length === 0 || p.busy} testID="scan-order-share" />
      <Text style={styles.note}>{ocopy.noPdfNote}</Text>
      {p.block && (
        <View style={styles.blocked} testID="scan-order-blocked">
          <Text style={styles.blockedText}>{copy.draftBlockBody(p.block)}</Text>
        </View>
      )}
      <Button label={ocopy.estimateLabel} variant="primary" onPress={() => setConfirming('estimate')} disabled={p.block != null || p.busy} loading={p.busy} testID="scan-order-estimate" />

      <Sheet
        visible={confirming === 'copy'}
        onClose={() => setConfirming(null)}
        size="form"
        title={ocopy.confirmCopyTitleLabel}
        testID="scan-order-confirm-copy"
        primaryAction={{ label: ocopy.confirmCopyYesLabel, onPress: () => { setConfirming(null); p.onSend('copy', true); }, testID: 'scan-order-confirm-copy-yes' }}
        secondaryAction={{ label: ocopy.notYetLabel, onPress: () => setConfirming(null), testID: 'scan-order-confirm-copy-no' }}
      >
        <Text style={styles.para}>{ocopy.confirmCopyBody(toBuy.length)}</Text>
        <Text style={styles.note}>{ocopy.noticeBody}</Text>
      </Sheet>
      <Sheet
        visible={confirming === 'share'}
        onClose={() => setConfirming(null)}
        size="form"
        title={ocopy.confirmShareTitleLabel}
        testID="scan-order-confirm-share"
        primaryAction={{ label: ocopy.confirmShareYesLabel, onPress: () => { setConfirming(null); p.onSend('share', true); }, testID: 'scan-order-confirm-share-yes' }}
        secondaryAction={{ label: ocopy.notYetLabel, onPress: () => setConfirming(null), testID: 'scan-order-confirm-share-no' }}
      >
        <Text style={styles.para}>{ocopy.confirmShareBody(toBuy.length)}</Text>
      </Sheet>
      <Sheet
        visible={confirming === 'estimate'}
        onClose={() => setConfirming(null)}
        size="form"
        title={ocopy.confirmEstimateTitleLabel}
        testID="scan-order-confirm-estimate"
        primaryAction={{ label: ocopy.confirmEstimateYesLabel, onPress: () => { setConfirming(null); p.onSend('estimate', true); }, testID: 'scan-order-confirm-estimate-yes' }}
        secondaryAction={{ label: ocopy.notYetLabel, onPress: () => setConfirming(null), testID: 'scan-order-confirm-estimate-no' }}
      >
        <Text style={styles.para} testID="scan-order-confirm-estimate-body">
          {p.starting && p.markupPct != null ? ocopy.confirmEstimateStartBody(p.pushCount, total, p.markupPct) : ocopy.confirmEstimateBody(p.pushCount, total)}
        </Text>
        <Text style={styles.para} testID="scan-order-confirm-double-count">{ocopy.doubleCountBody(p.installedAlreadyIn)}</Text>
        {p.resend.remove.length > 0 && <Text style={styles.para} testID="scan-order-confirm-remove">{ocopy.resendRemoveBody(p.resend.remove)}</Text>}
        {p.resend.leftAlone.length > 0 && <Text style={styles.para} testID="scan-order-confirm-left-alone">{ocopy.resendLeftAloneBody(p.resend.leftAlone)}</Text>}
        {p.resend.again && <Text style={styles.note} testID="scan-order-confirm-untouched">{ocopy.resendUntouchedNote}</Text>}
      </Sheet>
    </View>
  );
}
