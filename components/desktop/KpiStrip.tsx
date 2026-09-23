// components/desktop/KpiStrip.tsx — one row of the numbers that matter.
//
// WHY THIS EXISTS. On the web app a job's headline numbers (margin, owed,
// % complete, forecast finish, open RFIs…) sat in 4-6 separate full-width cards
// stacked down the page, and the job hub showed TWO different "% complete"
// numbers from two different formulas (web-PM audit, plan.bugs). The strip puts
// them in one 72–88 px row a GC reads at a glance, and it is honest about what
// it does not know:
//
//   • a value that is missing shows '—' with its reason, never 0 — "$0 owed"
//     and "we have no invoices yet" are different facts;
//   • a financial cell the viewer may not see (canViewFinancials false) is
//     LEFT OUT, not zeroed or blurred;
//   • every cell can open the section that explains its number.
//
// Layout: one row of 4–8 equal cells; under a 900 px container it wraps to two
// rows (utils/splitViewLayout kpiCellsPerRow). On a phone it is a two-column
// grid — nothing on the phone uses it today; the fallback exists so a screen
// that renders it everywhere still reads sensibly.
//
// The numbers themselves come from the screen (wave 6c's useProjectPulse is the
// single source); this component only lays them out.

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Link, useRouter, type Href } from 'expo-router';
import { Layout } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { cardSurface } from '@/components/ui/Card';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { KPI_MAX_CELLS, kpiCellsPerRow } from '@/utils/splitViewLayout';
import { UNKNOWN_CELL, isPlainClick } from '@/utils/dataTable';

export type KpiTone = 'neutral' | 'good' | 'warn' | 'bad';

export interface KpiCell {
  key: string;
  label: string;
  /** Formatted by the screen ("$42,180", "18 %"). null/undefined/'' → '—'. */
  value: string | number | null | undefined;
  /** Second line ("of $310k contract"). */
  sub?: string | null;
  tone?: KpiTone;
  /** Why the value is missing ("No invoices yet"). Shown under the dash. */
  blockedReason?: string | null;
  /** The section that explains the number. */
  href?: Href;
  onPress?: () => void;
  /** Money a field role may not see — dropped when canViewFinancials is false. */
  financial?: boolean;
  testID?: string;
}

export interface KpiStripProps {
  cells: readonly KpiCell[];
  /** Default true. False drops every `financial` cell. */
  canViewFinancials?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A Link press that also runs the cell's own onPress.
 *
 * Web: Link calls ONLY this handler (its router handler was overridden), so a
 * plain click must preventDefault (no page reload) and navigate in-app; a
 * Cmd/Ctrl/middle click is left to the browser (new tab).
 * Native: Link calls this handler and then its own router handler, which
 * navigates unless the event was defaultPrevented — so native only runs the
 * side effect.
 */
function linkPressWithSideEffect(sideEffect: () => void, navigate: () => void) {
  return (e: { preventDefault?: () => void }) => {
    sideEffect();
    if (Platform.OS !== 'web' || !isPlainClick(e)) return;
    e.preventDefault?.();
    navigate();
  };
}

function isMissing(v: KpiCell['value']): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return !Number.isFinite(v);
  return !String(v).trim();
}

export function KpiStrip({ cells, canViewFinancials = true, style, testID }: KpiStripProps) {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();
  const { width, onLayout } = useContainerWidth();

  // Left out, not zeroed: a field super must not see "$0 margin".
  const shown = cells.filter((c) => canViewFinancials || !c.financial).slice(0, KPI_MAX_CELLS);
  if (shown.length === 0) return null;
  const perRow = kpiCellsPerRow(shown.length, width, isDesktop);
  // Equal cells in PIXELS from the measured row width. A percentage basis plus
  // a gap overflows the row (4 × 25 % + 3 gaps > 100 %) and flex-wrap breaks
  // the line before it shrinks anything.
  const gap = isDesktop ? Layout.tile.kpi.gap : 8;
  const cellWidth = Math.max(0, Math.floor((width - gap * (perRow - 1)) / perRow));

  return (
    <View
      style={[styles.strip, { gap }, style]}
      onLayout={onLayout}
      testID={testID}
    >
      {shown.map((c) => {
        const missing = isMissing(c.value);
        const toneStyle = c.tone === 'good' ? styles.good : c.tone === 'warn' ? styles.warn : c.tone === 'bad' ? styles.bad : null;
        const body = (
          <View style={styles.cellInner}>
            <Text style={styles.label} numberOfLines={1}>{c.label}</Text>
            <Text style={[styles.value, missing ? styles.valueMissing : toneStyle]} numberOfLines={1}>
              {missing ? UNKNOWN_CELL : String(c.value)}
            </Text>
            {missing && c.blockedReason ? (
              <Text style={styles.sub} numberOfLines={2}>{c.blockedReason}</Text>
            ) : c.sub ? (
              <Text style={styles.sub} numberOfLines={1}>{c.sub}</Text>
            ) : null}
          </View>
        );
        const cellStyle: ViewStyle = { width: cellWidth };
        const a11y = `${c.label}: ${missing ? `unknown${c.blockedReason ? `, ${c.blockedReason}` : ''}` : String(c.value)}${c.sub && !missing ? `, ${c.sub}` : ''}`;
        const cellTestID = c.testID ?? (testID ? `${testID}-${c.key}` : undefined);
        if (c.href) {
          // expo-router's Link spreads OUR `onPress` over its own navigation
          // handler — even an explicit `onPress={undefined}` puts the key in
          // its props — and react-native-web drops the onClick copy, so the
          // browser would follow the <a href> with a full page reload. So:
          // no onPress key unless the cell has one, and then the plain click
          // is ours to finish (see linkPressWithSideEffect).
          const href = c.href;
          const extra = c.onPress ? { onPress: linkPressWithSideEffect(c.onPress, () => router.navigate(href)) } : {};
          return (
            <Link key={c.key} href={href} asChild {...extra}>
              <Pressable style={[styles.cell, cellStyle]} accessibilityRole="link" accessibilityLabel={a11y} testID={cellTestID}>
                {body}
              </Pressable>
            </Link>
          );
        }
        if (c.onPress) {
          return (
            <Pressable key={c.key} onPress={c.onPress} style={[styles.cell, cellStyle]} accessibilityRole="button" accessibilityLabel={a11y} testID={cellTestID}>
              {body}
            </Pressable>
          );
        }
        return (
          <View key={c.key} style={[styles.cell, cellStyle]} accessible accessibilityLabel={a11y} testID={cellTestID}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  strip: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  cell: {
    ...cardSurface(t, { radius: 'card', pad: 12 }),
    minHeight: 72,
    maxHeight: 88,
    justifyContent: 'center',
  },
  cellInner: { gap: 2 },
  label: { ...Type.caption1, fontWeight: '600', color: t.textSecondary },
  value: { ...Type.title3, color: t.text, fontVariant: ['tabular-nums'] },
  valueMissing: { color: t.textMuted },
  good: { color: t.successLabel },
  warn: { color: t.warningLabel },
  bad: { color: t.dangerLabel },
  sub: { ...Type.caption1, color: t.textMuted },
});
