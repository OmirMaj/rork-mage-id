// components/roomScan/QuantitiesView.tsx — The Quantities: what the scan
// worked out, each row saying how.
//
// Every figure comes from utils/roomScan/quantitiesCore and is formatted in one
// place (utils/roomScan/units). A quantity the scan cannot give (the floor of
// an open outline, wall area with no ceiling height) is shown as not known,
// never as zero. A blocked Price It button says why.
import React from 'react';
import { Text, View } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Button } from '@/components/ui';
import type { RoomScanCopy, RoomScanPricingBlock } from '@/hooks/useRoomScanCopy';
import type { ScanQuantities } from '@/utils/roomScan/types';
import { formatSizeIn, round1 } from '@/utils/roomScan/units';
import { makeRoomScanStyles } from './styles';

export interface QuantitiesViewProps {
  quantities: ScanQuantities;
  copy: RoomScanCopy;
  block: RoomScanPricingBlock | null;
  onPrice: () => void;
  /** Opens the order list (what to buy). Present with its label, or absent. Blocked by the same reasons as pricing. */
  order?: { label: string; onPress: () => void };
}

export function QuantitiesView({ quantities: q, copy, block, onPrice, order }: QuantitiesViewProps) {
  const styles = useThemedStyles(makeRoomScanStyles);
  const sf = copy.unitWord('SF');
  const lf = copy.unitWord('LF');
  const area = (n: number | null) => (n == null ? null : round1(n).toFixed(1));
  const Row = ({ id, label, sub, value, unit, first }: { id: string; label: string; sub: string; value: string | null; unit?: string; first?: boolean }) => (
    <View style={[styles.row, first && styles.rowFirst]} testID={`scan-q-${id}`}>
      <View style={styles.rowMain}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Text style={styles.rowValue}>
        {value ?? copy.notKnownLabel}
        {value != null && unit ? <Text style={styles.rowUnit}>{` ${unit}`}</Text> : null}
      </Text>
    </View>
  );
  const doorsSub = q.doors.length
    ? q.doors.map((d) => (d.nominalWidthIn != null && d.nominalWidthIn !== d.widthIn
      ? copy.qNominalSub(formatSizeIn(d.widthIn, d.heightIn), d.nominalWidthIn)
      : formatSizeIn(d.widthIn, d.heightIn))).join('; ')
    : copy.qNoneSub;
  const windowsSub = q.windows.length ? q.windows.map((w) => formatSizeIn(w.widthIn, w.heightIn)).join('; ') : copy.qNoneSub;
  const fixturesSub = q.fixtures.length ? q.fixtures.map((f) => copy.objectLabel(f.category)).filter(Boolean).join(', ') : copy.qNoneSub;
  return (
    <View style={styles.body} testID="scan-quantities">
      <Text style={styles.para}>{copy.quantitiesIntroBody}</Text>
      <View style={styles.card}>
        <Row first id="floor" label={copy.qFloorLabel} sub={q.floorAreaSF == null ? copy.qFloorOpenSub : copy.qFloorSub} value={area(q.floorAreaSF)} unit={sf} />
        <Row id="wall" label={copy.qWallLabel}
          sub={q.grossWallSF == null || q.openingSF == null ? copy.qWallUnknownSub : copy.qWallSub(`${round1(q.grossWallSF).toFixed(1)} ${sf}`, `${round1(q.openingSF).toFixed(1)} ${sf}`)}
          value={area(q.netWallSF)} unit={sf} />
        <Row id="ceiling" label={copy.qCeilingLabel}
          sub={q.ceilingAreaSF == null ? copy.qFloorOpenSub : q.flags.includes('ceiling_varies') ? copy.qCeilingVariesSub : copy.qCeilingFlatSub}
          value={area(q.ceilingAreaSF)} unit={sf} />
        <Row id="baseboard" label={copy.qBaseboardLabel} sub={copy.qBaseboardSub} value={round1(q.baseboardLF).toFixed(1)} unit={lf} />
        <Row id="crown" label={copy.qCrownLabel} sub={copy.qCrownSub} value={round1(q.crownLF).toFixed(1)} unit={lf} />
        {q.doorCount > 0 && <Row id="casing" label={copy.qCasingLabel} sub={copy.qCasingSub} value={round1(q.casingLF).toFixed(1)} unit={lf} />}
        <Row id="doors" label={copy.qDoorsLabel} sub={doorsSub} value={String(q.doorCount)} />
        <Row id="windows" label={copy.qWindowsLabel} sub={windowsSub} value={String(q.windowCount)} />
        <Row id="fixtures" label={copy.qFixturesLabel} sub={fixturesSub} value={String(q.fixtureCount)} />
      </View>
      <Text style={styles.note}>{copy.qWasteNote}</Text>
      {block && (
        <View style={styles.blocked} testID="scan-price-blocked">
          <Text style={styles.blockedText}>{copy.pricingBlockBody(block)}</Text>
        </View>
      )}
      <Button label={copy.priceItLabel} variant="primary" onPress={onPrice} disabled={block != null} testID="scan-price-it" />
      {order && <Button label={order.label} variant="secondary" onPress={order.onPress} disabled={block != null} testID="scan-order-open" />}
    </View>
  );
}
