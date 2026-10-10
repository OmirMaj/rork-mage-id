// components/deliveryLink/TruckRouteStrip.tsx — the truck on a three-stop
// strip: Loaded, On the Way, At Your Job (lane DELIVERIES-2, part 2).
//
// THE TRUCK IS WHERE SOMEONE TAPPED, NOT WHERE IT IS. Whoever holds the
// supplier link taps a step; this draws the truck at the latest one, with the
// time of each tap and the name that was typed. There is no map, no location
// and no clock running here: the strip only changes when the links are read
// again. The line under it says MAGE ID does not know where the truck is.
//
// A tap of Arrived does not mark the delivery received. The strip says so.
//
// Draws from props only: no network, no storage, no effect.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Check, Truck } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import type { SupplierLinkCopy } from '@/hooks/useSupplierLinkCopy';
import { tripStop, type SupplierTrip } from '@/utils/deliveryLink/core';
import type { DeliveriesFollowStyles } from '@/components/deliveries/styles';

const local = StyleSheet.create({
  wrap: { gap: 10 },
  strip: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 },
  stop: { flex: 1, alignItems: 'center' },
  truckSlot: { height: 30, justifyContent: 'flex-end' },
  rail: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', height: 22 },
  bar: { flex: 1, height: 3 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: 6, textAlign: 'center' },
  when: { marginTop: 2, textAlign: 'center' },
});

export function TruckRouteStrip({
  trip, copy, styles, formatWhen,
}: {
  /** The taps, or null when nobody has tapped a step. */
  trip: SupplierTrip | null;
  copy: SupplierLinkCopy;
  styles: DeliveriesFollowStyles;
  /** An instant as the screen says it ("Oct 8, 8:15 AM"). */
  formatWhen: (at: string) => string;
}) {
  const { colors: t } = useTheme();
  const at = tripStop(trip);
  const stops = [
    { label: copy.stepLoadedLabel, when: trip?.loaded ?? '' },
    { label: copy.stepOnTheWayLabel, when: trip?.onTheWay ?? '' },
    { label: copy.stepArrivedLabel, when: trip?.arrived ?? '' },
  ];
  return (
    <View style={local.wrap} testID="dsl-trip">
      <Text style={styles.sectionLabel}>{copy.tripLabel}</Text>
      <View style={local.strip}>
        {stops.map((s, i) => {
          const done = i + 1 <= at;
          const here = i + 1 === at;
          return (
            <View key={i} style={local.stop} accessible accessibilityLabel={`${s.label}: ${s.when ? formatWhen(s.when) : copy.notYetSub}`} testID={`dsl-trip-stop-${i + 1}`}>
              <View style={local.truckSlot}>{here ? <Truck size={26} color={t.accent} strokeWidth={1.9} testID="dsl-trip-truck" /> : null}</View>
              <View style={local.rail}>
                <View style={[local.bar, { backgroundColor: i === 0 ? 'transparent' : done ? t.accent : t.textMuted }]} />
                <View style={[local.dot, { borderColor: done ? t.accent : t.textMuted, backgroundColor: done ? t.accent : t.surface }]}>
                  {done ? <Check size={12} color={t.surface} strokeWidth={3} /> : null}
                </View>
                <View style={[local.bar, { backgroundColor: i === 2 ? 'transparent' : i + 2 <= at ? t.accent : t.textMuted }]} />
              </View>
              <Text style={[styles.dateLabel, local.label]}>{s.label}</Text>
              <Text style={[styles.dateBasis, local.when]}>{s.when ? formatWhen(s.when) : copy.notYetSub}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.note} testID="dsl-trip-source">{at === 0 ? copy.tripNoneBody : trip?.name ? copy.tripSourceBody(trip.name) : copy.tripNoNameBody}</Text>
      {at === 3 ? <Text style={styles.note} testID="dsl-trip-arrived">{copy.tripArrivedBody}</Text> : null}
    </View>
  );
}

export default TruckRouteStrip;
