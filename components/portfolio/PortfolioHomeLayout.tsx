// components/portfolio/PortfolioHomeLayout.tsx — the desktop Home, as slots.
//
// WHY (wave 6c, lane F). The desktop Home measured 1.8 screens at 1512 × 945:
// the phone's column of banner cards stretched across the laptop, and the job
// table only after twelve of them. This is the order a GC reads his book in,
// and nothing else — it owns no data, only Views with Layout spacing:
//
//   1. header  — PageHeader (title, search, bell, New project, +)
//   2. notices — one NoticeStrip line (Stripe, samples, warranty)
//   3. table   — the PortfolioTable, first and full width
//   4. below   — two columns: Today on site | the self-gated cards
//   5. footer  — Ask MAGE + Copilot side by side, the AI summary toggle
//
// Rows are Layout.sectionGap apart, the page has Layout.gutter each side. The
// right-hand column adds 8 px so the cards' own 16 px margins land on the 24 px
// gutter.
//
// An empty slot takes no space. The notices element is rendered bare — no
// wrapper View — because NoticeStrip returns null when nothing is showing
// (dismissed, or every notice invisible), and a wrapper would still be a flex
// child and cost the page a 24 px blank band; the caller gives the strip its
// own gutter (style). With no belowLeft (nobody on site today) the cards take
// the whole row instead of the right half. Desktop only: Home mounts it only when useResponsiveLayout().isDesktop,
// so it returns null anywhere else rather than drawing a desktop layout on a
// phone.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

export interface PortfolioHomeLayoutProps {
  header: React.ReactNode;
  /** One NoticeStrip, carrying its own horizontal gutter (style) — it is not
   *  wrapped, so a strip that renders null leaves no gap. */
  notices?: React.ReactNode;
  table: React.ReactNode;
  /** Left of the 'below' row — Today on site. Null/undefined: the cards
   *  column takes the full width. */
  belowLeft?: React.ReactNode;
  /** Right of the 'below' row — the self-gated cards (each renders null when quiet). */
  belowRight?: React.ReactNode;
  footer?: React.ReactNode;
  testID?: string;
}

export function PortfolioHomeLayout({
  header, notices, table, belowLeft, belowRight, footer, testID = 'portfolio-home',
}: PortfolioHomeLayoutProps) {
  const { isDesktop } = useResponsiveLayout();
  if (!isDesktop) return null;
  return (
    <View style={styles.page} testID={testID}>
      {header}
      {notices ?? null}
      <View style={styles.gutter} testID={`${testID}-table-slot`}>{table}</View>
      <View style={[styles.below, belowLeft ? styles.belowTwoUp : null]}>
        {belowLeft ? <View style={styles.column} testID={`${testID}-below-left`}>{belowLeft}</View> : null}
        <View style={[styles.column, styles.cardsColumn]} testID={`${testID}-below-right`}>{belowRight}</View>
      </View>
      {footer ? <View style={styles.gutter}>{footer}</View> : null}
    </View>
  );
}

export default PortfolioHomeLayout;

const styles = StyleSheet.create({
  page: {
    gap: Layout.sectionGap,
    paddingBottom: Layout.sectionGap,
  },
  gutter: {
    paddingHorizontal: Layout.gutter,
  },
  // The left column sits on the page gutter; the right column does not —
  // its cards carry their own 16 px side margins (marginHorizontal:
  // Tokens.spacing.md), so 8 px of column padding puts their edges on the
  // 24 px gutter instead of 16 px inside it.
  below: {
    flexDirection: 'row',
    gap: Layout.groupGap,
    alignItems: 'flex-start',
  },
  belowTwoUp: {
    paddingLeft: Layout.gutter,
  },
  column: {
    flex: 1,
    minWidth: 0,
  },
  cardsColumn: {
    paddingHorizontal: Layout.rowGap,
  },
});
