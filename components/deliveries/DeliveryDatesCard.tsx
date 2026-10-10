// components/deliveries/DeliveryDatesCard.tsx — one delivery and its three
// dates (lane DELIVERIES-1): Needed on Site By, Supplier Date, Order By.
//
// EVERY DATE IS DRAWN BY <DateRow>, and DateRow will not draw a date without
// the line that says where it came from (`basis` is required). That is the
// whole of "a label on every date": there is no other place in the lane where
// a date row is drawn.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Truck } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useT } from '@/contexts/LanguageContext';
import type { Delivery } from '@/utils/deliverySchedule';
import type { DeliveriesScheduleCopy } from '@/hooks/useDeliveriesScheduleCopy';
import { neededOnSiteBy, type ScheduleForDeliveries } from '@/utils/deliveries/neededBy';
import { supplierGap, isSettled } from '@/utils/deliveries/flags';
import { previousSupplierDate, supplierDateSource } from '@/utils/deliveries/provenance';
import { leadTimeDaysOf, orderByDate } from '@/utils/deliveries/orderBy';
import { dayOrEmpty } from '@/utils/deliveries/calendar';
import { dayLong, dayShort, gapChip, neededBasisLine, orderBasisLine, supplierSourceLine } from './words';
import type { DeliveriesFollowStyles } from './styles';

/** One date. `basis` (where the date came from) is required and always drawn. */
export function DateRow({
  label, value, was, basis, extra, styles, testID,
}: {
  label: string;
  /** The date as shown, or the words for "no date". */
  value: string;
  /** The date it was before, struck through. */
  was?: string;
  basis: string;
  /** A second line under the basis (for example "Was Nov 12."). */
  extra?: string;
  styles: DeliveriesFollowStyles;
  testID: string;
}) {
  return (
    <View style={styles.dateRow} testID={testID}>
      <Text style={styles.dateLabel}>{label}</Text>
      <View style={styles.dateValues}>
        <View style={styles.dateValueLine}>
          {was ? <Text style={styles.dateWas} testID={`${testID}-was`}>{was}</Text> : null}
          <Text style={styles.dateValue} testID={`${testID}-value`}>{value}</Text>
        </View>
        <Text style={styles.dateBasis} testID={`${testID}-basis`}>{basis}</Text>
        {extra ? <Text style={styles.dateBasis} testID={`${testID}-extra`}>{extra}</Text> : null}
      </View>
    </View>
  );
}

export function DeliveryDatesCard({
  delivery, schedule, copy, styles, meId, onPress, showTask = true,
}: {
  delivery: Delivery;
  schedule: ScheduleForDeliveries | null | undefined;
  copy: DeliveriesScheduleCopy;
  styles: DeliveriesFollowStyles;
  meId: string | null | undefined;
  onPress?: (d: Delivery) => void;
  /** False on the task's own sheet, where the task is already the heading. */
  showTask?: boolean;
}) {
  const { colors: t } = useTheme();
  const { lang } = useT();
  const needed = neededOnSiteBy(delivery, schedule);
  const gap = supplierGap(delivery, needed, schedule ?? {});
  const chip = isSettled(delivery) ? null : gapChip(copy, gap);
  const supplierDate = dayOrEmpty(delivery.expectedDate);
  const source = supplierDateSource(delivery);
  const was = previousSupplierDate(delivery);
  const lead = leadTimeDaysOf(delivery);
  const orderBy = orderByDate(needed.date, lead);
  const ordered = dayOrEmpty(delivery.orderedOn);
  const id = delivery.id;
  const meta = [delivery.supplier, delivery.poNumber ? `PO ${delivery.poNumber}` : '', showTask && needed.basis.kind === 'task' ? `${copy.forTaskLabel}: ${needed.basis.taskTitle}` : '']
    .filter(Boolean).join('. ');
  const body = (
    <>
      <View style={styles.cardHead}>
        <View style={styles.iconTile}><Truck size={17} color={t.accentLabel} strokeWidth={1.8} /></View>
        <View style={styles.cardTitles}>
          <Text style={styles.cardTitle} numberOfLines={2}>{delivery.description}</Text>
          <Text style={styles.cardMeta} numberOfLines={2}>{meta}.</Text>
        </View>
        {chip ? (
          <View style={[styles.chip, chip.tone === 'warn' && styles.chipWarn, chip.tone === 'danger' && styles.chipDanger]} testID={`dfs-chip-${id}`}>
            <Text style={[styles.chipText, chip.tone === 'warn' && styles.chipWarnText, chip.tone === 'danger' && styles.chipDangerText]}>{chip.text}</Text>
          </View>
        ) : null}
      </View>
      <DateRow
        label={copy.neededByLabel}
        value={needed.date ? dayLong(needed.date, lang) : copy.noDateLabel}
        basis={neededBasisLine(copy, needed)}
        styles={styles}
        testID={`dfs-needed-${id}`}
      />
      <DateRow
        label={copy.supplierDateLabel}
        value={supplierDate ? [dayLong(supplierDate, lang), delivery.window ?? ''].filter(Boolean).join(', ') : copy.notGivenLabel}
        basis={supplierSourceLine(copy, source, meId, lang)}
        extra={was ? copy.wasBody(dayShort(was, lang)) : undefined}
        styles={styles}
        testID={`dfs-supplier-${id}`}
      />
      {lead !== null || ordered ? (
        <DateRow
          label={copy.orderByLabel}
          value={orderBy ? dayLong(orderBy, lang) : copy.noDateLabel}
          basis={orderBasisLine(copy, lead, orderBy)}
          extra={ordered ? copy.orderedBody(dayShort(ordered, lang)) : undefined}
          styles={styles}
          testID={`dfs-order-${id}`}
        />
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.card} testID={`dfs-card-${id}`}>{body}</View>;
  return (
    <TouchableOpacity style={styles.card} onPress={() => onPress(delivery)} accessibilityRole="button" accessibilityLabel={`${copy.deliveryDatesLabel}: ${delivery.description}`} testID={`dfs-card-${id}`}>
      {body}
    </TouchableOpacity>
  );
}
