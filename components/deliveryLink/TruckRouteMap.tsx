// components/deliveryLink/TruckRouteMap.tsx — the delivery on a street map:
// the yard, the job, a straight line between them and the truck (lane
// DELIVERIES-2, part 3).
//
// WHAT IS REAL AND WHAT IS A DRAWING. The two ends are real places: the job's
// own address, and the "Coming From" someone typed on the supplier link. The
// map under them is OpenStreetMap's standard map. THE TRUCK IS NOT A POSITION:
// it is drawn at the yard, at the middle of the line or at the job, from which
// of the three steps was tapped on the link. The line is straight, not the
// road. Both facts are printed on the map, always.
//
// No map library and no native module: the tiles are ordinary pictures laid
// side by side (utils/deliveryLink/mapMath works out which and where), with
// the line drawn over them. Nothing moves by itself and there is no timer.
// Draws nothing when either end is not a known place, or before it has a width.
import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Circle } from 'react-native-svg';
import { MapPin, Truck } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import type { SupplierLinkCopy } from '@/hooks/useSupplierLinkCopy';
import { buildMapView, straightLineMiles, tileUrl, truckPoint, type LatLng } from '@/utils/deliveryLink/mapMath';
import type { DeliveriesFollowStyles } from '@/components/deliveries/styles';

const HEIGHT = 240;
const TAG_MAX = 190;
const local = StyleSheet.create({
  wrap: { gap: 6 },
  frame: { height: HEIGHT, borderRadius: 10, overflow: 'hidden', borderWidth: 1 },
  tile: { position: 'absolute' },
  over: { position: 'absolute', left: 0, top: 0 },
  mark: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  truck: { width: 38, height: 38, borderRadius: 19, borderWidth: 2 },
  tag: { position: 'absolute', maxWidth: TAG_MAX, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  credit: { position: 'absolute', right: 0, bottom: 0, paddingHorizontal: 5, paddingVertical: 1 },
});

export function TruckRouteMap({
  from, to, stop, fromLabel, toLabel, copy, styles,
}: {
  /** The yard: the place "Coming From" was looked up to, or null. */
  from: LatLng | null;
  /** The job. */
  to: LatLng | null;
  /** Which step was tapped last: 0 none, 1 Loaded, 2 On the Way, 3 Arrived. */
  stop: 0 | 1 | 2 | 3;
  fromLabel: string;
  toLabel: string;
  copy: SupplierLinkCopy;
  styles: DeliveriesFollowStyles;
}) {
  const { colors: t } = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => { const w = Math.round(e.nativeEvent.layout.width); if (w !== width) setWidth(w); };
  const view = buildMapView(from, to, { width, height: HEIGHT });
  if (!from || !to) return null;
  const truck = view ? truckPoint(view, stop) : null;
  const miles = straightLineMiles(from, to);
  // A tag sits beside its end, on the side away from the other end, and stays inside the picture.
  const tagAt = (p: { x: number; y: number }, other: { x: number; y: number }) => ({
    left: Math.max(4, Math.min(width - TAG_MAX - 4, p.x + 12)),
    top: Math.max(4, Math.min(HEIGHT - 48, p.y + (p.y <= other.y ? -34 : 12))),
  });
  return (
    <View style={local.wrap} testID="dsl-map">
      <View style={[local.frame, { borderColor: t.line, backgroundColor: t.surfaceAlt }]} onLayout={onLayout}>
        {view ? (
          <>
            {view.tiles.map((tile) => (
              <Image key={tile.key} source={{ uri: tileUrl(tile) }} style={[local.tile, { left: tile.left, top: tile.top, width: tile.size, height: tile.size }]} accessibilityIgnoresInvertColors />
            ))}
            <Svg width={width} height={HEIGHT} style={local.over}>
              <Line x1={view.from.x} y1={view.from.y} x2={view.to.x} y2={view.to.y} stroke={t.surface} strokeWidth={7} strokeLinecap="round" />
              <Line x1={view.from.x} y1={view.from.y} x2={view.to.x} y2={view.to.y} stroke={t.accent} strokeWidth={3} strokeDasharray="2 8" strokeLinecap="round" />
              <Circle cx={view.from.x} cy={view.from.y} r={7} fill={t.accent} stroke={t.surface} strokeWidth={2} />
              <Circle cx={view.to.x} cy={view.to.y} r={7} fill={t.text} stroke={t.surface} strokeWidth={2} />
            </Svg>
            <View style={[local.tag, tagAt(view.from, view.to), { backgroundColor: t.surface, borderColor: t.line }]}>
              <Text style={styles.dateBasis} numberOfLines={1}>{fromLabel}</Text>
            </View>
            <View style={[local.tag, tagAt(view.to, view.from), { backgroundColor: t.surface, borderColor: t.text }]}>
              <Text style={styles.dateLabel} numberOfLines={1}><MapPin size={11} color={t.text} strokeWidth={2} /> {toLabel}</Text>
            </View>
            {truck ? (
              <View style={[local.mark, local.truck, { left: truck.x - 19, top: truck.y - 19, backgroundColor: t.accent, borderColor: t.surface }]} testID="dsl-map-truck">
                <Truck size={20} color={t.surface} strokeWidth={2} />
              </View>
            ) : null}
            <View style={[local.credit, { backgroundColor: t.surface }]}>
              <Text style={styles.dateBasis}>{copy.mapCreditSub}</Text>
            </View>
          </>
        ) : null}
      </View>
      <Text style={styles.note} testID="dsl-map-note">{copy.mapNoteBody(miles < 10 ? miles.toFixed(1) : String(Math.round(miles)))}</Text>
    </View>
  );
}

export default TruckRouteMap;
