// ToolsSheet — the ••• overflow on the Summary tab.
//
// One of four rendered navigation surfaces. utils/featureRegistry.ts is the
// source all four name: a row declares `feature`, and the registry owns the
// destination. Title, subtitle and icon stay here because they are this
// sheet's voice (sentence case, phone-length subtitles), not shared data.
//
// The `route` literal beside `feature` is redundant on purpose:
// scripts/validate-feature-search.ts greps route strings out of
// components/summary/** to prove every desktop destination is also reachable
// on a phone, and six of these rows (Margin board, Margin alerts, Cost
// database, Visual takeoff, Reports inbox, Reports) are the ONLY phone
// reference to their sidebar row — delete the literal and that guard goes
// blind and still passes. scripts/validate-nav-coverage.ts asserts every one
// of them equals featureFor(feature).route.

import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Inbox, FileDown, Wallet, UserPlus, Gavel, Gauge, Library, PenTool, BellRing,
  Hourglass, type LucideIcon,
} from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { NavRow } from '@/components/NavRow';
import { featureFor, type FeatureId } from '@/utils/featureRegistry';

interface SheetRow {
  /** Registry row this goes to — owns the destination. */
  feature: FeatureId;
  /** Must equal featureFor(feature).route; pinned by validate-nav-coverage. */
  route: string;
  Icon: LucideIcon;
  title: string;
  subtitle: string;
  testID: string;
}

const SHEET_ROWS: SheetRow[] = [
  { feature: 'margin-board', route: '/portfolio-margin', Icon: Gauge, title: 'Margin board', subtitle: "Every active job's projected margin + risk, ranked", testID: 'tools-margin-board' },
  { feature: 'margin-alerts', route: '/margin-alerts', Icon: BellRing, title: 'Margin alerts', subtitle: 'What crossed since you last looked — risk, health, erosion', testID: 'tools-margin-alerts' },
  // PRODUCT-F4: the chase list was sidebar-only — invisible on iPhone.
  { feature: 'waiting-on', route: '/waiting-on', Icon: Hourglass, title: 'Waiting on others', subtitle: 'Who owes you an answer — overdue RFIs, submittals, sub confirmations', testID: 'tools-waiting-on' },
  { feature: 'cost-database', route: '/cost-database', Icon: Library, title: 'Cost database', subtitle: 'Your unit prices, learned from closed jobs', testID: 'tools-cost-database' },
  { feature: 'area-takeoff', route: '/area-takeoff', Icon: PenTool, title: 'Visual takeoff', subtitle: 'Circle an area on a plan → instant priced quantity', testID: 'tools-area-takeoff' },
  { feature: 'report-inbox', route: '/report-inbox', Icon: Inbox, title: 'Reports inbox', subtitle: 'Daily field reports waiting for review', testID: 'tools-report-inbox' },
  { feature: 'reports', route: '/reports', Icon: FileDown, title: 'Reports', subtitle: 'WIP · Profit by project · A/R aging', testID: 'tools-reports' },
  { feature: 'cash-flow', route: '/cash-flow', Icon: Wallet, title: 'Cash flow', subtitle: 'Multi-week forecast across all projects', testID: 'tools-cash-flow' },
  { feature: 'leads', route: '/leads', Icon: UserPlus, title: 'Pipeline', subtitle: 'Inquiries → qualified → proposal → won', testID: 'tools-pipeline' },
  { feature: 'buyout', route: '/buyout', Icon: Gavel, title: 'Buyout', subtitle: 'Sub package builder + bid award flow', testID: 'tools-buyout' },
  { feature: 'tax-1099', route: '/tax-1099-export', Icon: FileDown, title: '1099-NEC export', subtitle: 'Year-end CSV for your CPA — flags subs paid ≥ $600', testID: 'tools-tax-1099' },
];

interface ToolsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Screen handles the push then closes the sheet. */
  onNavigate: (route: string) => void;
}

export function ToolsSheet({ visible, onClose, onNavigate }: ToolsSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  // Navigate by registry route, not by the row's literal, so a stale literal
  // sends nobody anywhere wrong in the window before the guard is next run.
  const go = useCallback(
    (row: SheetRow) => onNavigate(featureFor(row.feature).route),
    [onNavigate],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
        testID="summary-tools-backdrop"
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]} testID="summary-tools-sheet">
        <View style={styles.handle} />
        <Text style={styles.title}>Tools</Text>
        <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
          {SHEET_ROWS.map(row => (
            <NavRow
              key={row.feature}
              Icon={row.Icon}
              title={row.title}
              subtitle={row.subtitle}
              onPress={() => go(row)}
              testID={row.testID}
            />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: t.surface, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, paddingHorizontal: 8, paddingTop: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginVertical: 8 },
  title: { fontSize: 18, fontWeight: '800' as const, color: t.text, paddingHorizontal: 12, marginBottom: 6, letterSpacing: -0.3 },
});
