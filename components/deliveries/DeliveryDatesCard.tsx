// components/deliveries/DeliveryDatesCard.tsx — one delivery and its three
// dates (lane DELIVERIES-1): Needed on Site By, Supplier Date, Order By.
//
// ONE ROW PER DELIVERY. With the feature open, a delivery that is drawn here is
// NOT also drawn in the screen's old Late and Upcoming rows, so the card takes
// their two actions (Confirm, Received) when the screen hands them in. They
// are the screen's own handlers; the card adds none of its own.
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
  delivery, schedule, copy, styles, meId, onPress, showTask = true, actions,
}: {
  delivery: Delivery;
  schedule: ScheduleForDeliveries | null | undefined;
  copy: DeliveriesScheduleCopy;
  styles: DeliveriesFollowStyles;
  meId: string | null | undefined;
  onPress?: (d: Delivery) => void;
  /** False on the task's own sheet, where the task is already the heading. */
  showTask?: boolean;
  /** The Deliveries screen's own Confirm and Received handlers, for a delivery that has no other row on that screen. */
  actions?: { onConfirm: (d: Delivery) => void; onReceive: (d: Delivery) => void };
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
  // Confirm is offered for a dated delivery the supplier has not confirmed (there is no date to confirm on "No Date Yet").
  const actionRow = actions && !isSettled(delivery) ? (
    <View style={styles.cardActions} testID={`dfs-actions-${id}`}>
      {delivery.status !== 'confirmed' && supplierDate ? (
        <TouchableOpacity style={[styles.btn, styles.btnQuiet, styles.btnSmall]} onPress={() => actions.onConfirm(delivery)} accessibilityRole="button" testID={`dfs-confirm-${id}`}>
          <Text style={styles.btnQuietText}>{copy.confirmLabel}</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity style={[styles.btn, styles.btnOutline, styles.btnSmall]} onPress={() => actions.onReceive(delivery)} accessibilityRole="button" testID={`dfs-receive-${id}`}>
        <Text style={styles.btnOutlineText}>{copy.receivedLabel}</Text>
      </TouchableOpacity>
    </View>
  ) : null;
  if (!onPress) return <View style={styles.card} testID={`dfs-card-${id}`}>{body}{actionRow}</View>;
  if (!actionRow) {
    return (
      <TouchableOpacity style={styles.card} onPress={() => onPress(delivery)} accessibilityRole="button" accessibilityLabel={`${copy.deliveryDatesLabel}: ${delivery.description}`} testID={`dfs-card-${id}`}>
        {body}
      </TouchableOpacity>
    );
  }
  // A card with actions: the dates open the sheet, the buttons sit beside them (a button is never nested in a button).
  return (
    <View style={styles.card} testID={`dfs-card-${id}`}>
      <TouchableOpacity onPress={() => onPress(delivery)} accessibilityRole="button" accessibilityLabel={`${copy.deliveryDatesLabel}: ${delivery.description}`} testID={`dfs-card-open-${id}`}>
        {body}
      </TouchableOpacity>
      {actionRow}
    </View>
  );
}
