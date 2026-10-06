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
  Hourglass, ShieldCheck, CalendarCheck, type LucideIcon,
} from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { NavRow } from '@/components/NavRow';
import { SheetOverlay, useSheetFrame } from '@/components/ui/Sheet';
import { featureFor, type FeatureId } from '@/utils/featureRegistry';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjects } from '@/contexts/ProjectContext';
import { useActiveProject } from '@/contexts/ActiveProjectContext';
import { pickDefaultProjectId } from '@/utils/defaultProjectId';
import { lineupToolsDoor } from '@/utils/uxDoors';
import { showAlert } from '@/utils/alert';

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
  { feature: 'margin-board', route: '/portfolio-margin', Icon: Gauge, title: 'Margin Board', subtitle: "Every active project's projected margin and risk, ranked", testID: 'tools-margin-board' },
  { feature: 'margin-alerts', route: '/margin-alerts', Icon: BellRing, title: 'Margin Alerts', subtitle: 'What crossed since you last looked: risk, health, erosion', testID: 'tools-margin-alerts' },
  // PRODUCT-F4: the chase list was sidebar-only — invisible on iPhone.
  { feature: 'waiting-on', route: '/waiting-on', Icon: Hourglass, title: 'Waiting on Others', subtitle: 'Who owes you an answer: overdue RFIs, submittals, sub confirmations', testID: 'tools-waiting-on' },
  { feature: 'cost-database', route: '/cost-database', Icon: Library, title: 'Cost History', subtitle: 'Your unit prices, learned from closed projects', testID: 'tools-cost-database' },
  { feature: 'area-takeoff', route: '/area-takeoff', Icon: PenTool, title: 'Visual Takeoff', subtitle: 'Circle an area on a plan for an instant priced quantity', testID: 'tools-area-takeoff' },
  { feature: 'report-inbox', route: '/report-inbox', Icon: Inbox, title: 'Reports Inbox', subtitle: 'Daily reports waiting for review', testID: 'tools-report-inbox' },
  { feature: 'reports', route: '/reports', Icon: FileDown, title: 'Reports', subtitle: 'WIP · Profit by project · A/R aging', testID: 'tools-reports' },
  { feature: 'cash-flow', route: '/cash-flow', Icon: Wallet, title: 'Cash Flow', subtitle: 'Multi-week forecast across all projects', testID: 'tools-cash-flow' },
  { feature: 'leads', route: '/leads', Icon: UserPlus, title: 'Pipeline', subtitle: 'Inquiries, qualified, proposal, won', testID: 'tools-pipeline' },
  { feature: 'buyout', route: '/buyout', Icon: Gavel, title: 'Buyout', subtitle: 'Build sub packages and award bids', testID: 'tools-buyout' },
  { feature: 'tax-1099', route: '/tax-1099-export', Icon: FileDown, title: '1099-NEC export', subtitle: 'Year-end CSV for your CPA. Flags subs paid $600 or more', testID: 'tools-tax-1099' },
  { feature: 'insurance-audit', route: '/insurance-audit', Icon: ShieldCheck, title: 'Insurance Audit Pack', subtitle: "Sub payments vs. workers' comp certificates", testID: 'insaudit-tools' },
  { feature: 'tomorrow-lineup', route: '/tomorrow-lineup', Icon: CalendarCheck, title: "Tomorrow's Lineup", subtitle: 'A ready-to-send text per sub for the next work day', testID: 'lineup-tools' },
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
  // Desktop web: a centred card in the content column, the scrim over the
  // sidebar. Phone: every part is null — today's sheet, byte for byte.
  const fX = useSheetFrame('form', { visible, animationType: 'slide' });

  // W1 UXDOORS: "Tomorrow's lineup" (still the LAST row) opens on his
  // default job when there is one (pickDefaultProjectId: his pick → recent,
  // never a guess); with none, the bare screen asks which project. Gated like
  // the screen: schedule_gantt_pdf through useProjectAccess on that job, so a
  // collaborator's grant on it counts (app/tomorrow-lineup.tsx does the same).
  const { projects } = useProjects();
  const { activeProjectId, recentProjectIds } = useActiveProject();
  const lineupProjectId = pickDefaultProjectId({ activeProjectId, recentProjectIds, projects });
  const { canAccess, requiredTierFor } = useProjectAccess(lineupProjectId ?? undefined);
  const lineupDoor = lineupToolsDoor({
    projectId: lineupProjectId,
    canAccess: canAccess('schedule_gantt_pdf'),
    requiredTier: requiredTierFor('schedule_gantt_pdf'),
  });

  // Navigate by registry route, not by the row's literal, so a stale literal
  // sends nobody anywhere wrong in the window before the guard is next run.
  const go = useCallback(
    (row: SheetRow) => {
      if (row.feature !== 'tomorrow-lineup') { onNavigate(featureFor(row.feature).route); return; }
      if (lineupDoor.kind === 'open') { onNavigate(lineupDoor.path); return; }
      showAlert(lineupDoor.title, lineupDoor.message, [
        { text: 'Not Now', style: 'cancel' },
        { text: 'See Plans', onPress: () => onNavigate('/paywall') },
      ]);
    },
    [onNavigate, lineupDoor],
  );

  return (
    <Modal visible={visible} transparent animationType={fX.animationType} onRequestClose={onClose}>
      <SheetOverlay frame={fX}>
      <TouchableOpacity
        style={[styles.backdrop, fX.backdrop]}
        activeOpacity={1}
        onPress={onClose}
        testID="summary-tools-backdrop"
      />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }, fX.card]} testID="summary-tools-sheet">
        {fX.showHandle && <View style={styles.handle} />}
        <Text style={styles.title}>Tools</Text>
        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
          {SHEET_ROWS.map(row => {
            const locked = row.feature === 'tomorrow-lineup' && lineupDoor.kind === 'locked' ? lineupDoor : null;
            return (
              <NavRow
                key={row.feature}
                Icon={row.Icon}
                locked={!!locked}
                title={row.title}
                subtitle={locked ? locked.subtitle : row.subtitle}
                onPress={() => go(row)}
                testID={row.testID}
              />
            );
          })}
        </ScrollView>
      </View>
      </SheetOverlay>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: t.surface, borderTopLeftRadius: Tokens.radius.xl, borderTopRightRadius: Tokens.radius.xl, paddingHorizontal: 8, paddingTop: 8 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: t.line, alignSelf: 'center' as const, marginVertical: 8 },
  title: { fontSize: 18, fontWeight: '800' as const, color: t.text, paddingHorizontal: 12, marginBottom: 6, letterSpacing: -0.3 },
  // NavRow no longer pads itself or paints a surface (Plain trade): the list
  // owns the column, aligned with the title.
  rows: { paddingHorizontal: 12 },
});
