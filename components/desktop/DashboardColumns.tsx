// components/desktop/DashboardColumns.tsx — the money dashboards' desktop
// layout: an optional KPI row, then a main column beside a 360 px rail, then
// an optional full-width band below (wave 6d, lane B1).
//
// WHY. At 1512 the dashboards stacked every card down one 1240 px column: job
// costing measured 2.1 screens tall and cash flow put 15% of its text in the
// right half of the window. The rail takes the secondary cards (forecasts,
// cross-links, the expense and income lists) beside the main story.
//
// PHONE. Below the desktop-web gate it renders `<>{kpis}{main}{rail}{below}</>`
// — no host node at all — so a screen may use it DIRECTLY only where that
// concatenation is exactly today's phone order. Anywhere else the screen
// builds section consts and renders `isDesktopWeb ? <DashboardColumns/> :
// today's order`.
//
// DESKTOP. main | rail side by side when the container is at least 984 wide
// (utils/dashboardColumns dashboardColumnsFit); narrower, the plain stack. It
// draws no card styling: the sections keep their own.

import React, { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Layout } from '@/constants/designTokens';
import { useIsDesktopWeb } from '@/components/ui';
import { useContainerWidth } from '@/hooks/useContainerWidth';
import { dashboardColumnsFit } from '@/utils/dashboardColumns';

export interface DashboardColumnsProps {
  kpis?: ReactNode;
  main: ReactNode;
  rail?: ReactNode;
  below?: ReactNode;
  testID?: string;
}

export function DashboardColumns({ kpis, main, rail, below, testID = 'dashboard-columns' }: DashboardColumnsProps) {
  const isDesktopWeb = useIsDesktopWeb();
  const { width, onLayout } = useContainerWidth();
  if (!isDesktopWeb) return <>{kpis}{main}{rail}{below}</>;

  const columns = !!rail && dashboardColumnsFit(width);
  return (
    <View onLayout={onLayout} testID={testID}>
      {kpis ? <View style={styles.kpis} testID={`${testID}-kpis`}>{kpis}</View> : null}
      {columns ? (
        <View style={styles.row} testID={`${testID}-row`}>
          <View style={styles.main} testID={`${testID}-main`}>{main}</View>
          <View style={styles.rail} testID={`${testID}-rail`}>{rail}</View>
        </View>
      ) : (
        // No gap: each card's own margins keep today's spacing.
        <View testID={`${testID}-stack`}>
          {main}
          {rail}
        </View>
      )}
      {below ? <View testID={`${testID}-below`}>{below}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  kpis: { marginBottom: Layout.groupGap },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Layout.gutter },
  main: { flex: 1, minWidth: 0 },
  rail: { width: Layout.column.rail, flexShrink: 0 },
});

export default DashboardColumns;
