import React from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Inbox, FileDown, Wallet, UserPlus, Gavel, Gauge } from 'lucide-react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { NavRow } from '@/components/NavRow';

interface ToolsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Screen handles the push then closes the sheet. */
  onNavigate: (route: string) => void;
}

export function ToolsSheet({ visible, onClose, onNavigate }: ToolsSheetProps) {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

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
          <NavRow Icon={Gauge} title="Margin board" subtitle="Every active job's projected margin + risk, ranked" onPress={() => onNavigate('/portfolio-margin')} testID="tools-margin-board" />
          <NavRow Icon={Inbox} title="Reports inbox" subtitle="Daily field reports waiting for review" onPress={() => onNavigate('/report-inbox')} testID="tools-report-inbox" />
          <NavRow Icon={FileDown} title="Reports" subtitle="WIP · Profit by project · A/R aging" onPress={() => onNavigate('/reports')} testID="tools-reports" />
          <NavRow Icon={Wallet} title="Cash flow" subtitle="Multi-week forecast across all projects" onPress={() => onNavigate('/cash-flow')} testID="tools-cash-flow" />
          <NavRow Icon={UserPlus} title="Pipeline" subtitle="Inquiries → qualified → proposal → won" onPress={() => onNavigate('/leads')} testID="tools-pipeline" />
          <NavRow Icon={Gavel} title="Buyout" subtitle="Sub package builder + bid award flow" onPress={() => onNavigate('/buyout')} testID="tools-buyout" />
          <NavRow Icon={FileDown} title="1099-NEC export" subtitle="Year-end CSV for your CPA — flags subs paid ≥ $600" onPress={() => onNavigate('/tax-1099-export')} testID="tools-tax-1099" />
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
