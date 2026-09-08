// components/schedule/ExportSheet.tsx — Phase 27.
//
// Five-option export bottom sheet. Used on desktop and phone. Three
// options (PDF/CSV/Share) reuse existing generators. Two are new this
// phase: iCal (Task 16) and AirPrint (Task 17).

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { FileText, FileSpreadsheet, Share2, Calendar, Printer, ChevronRight } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';

const OPT_ICON: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  pdf: FileText, csv: FileSpreadsheet, share: Share2, ical: Calendar, print: Printer,
};

export interface ExportSheetProps {
  visible: boolean;
  onClose: () => void;
  onExportPdf: () => void;
  onExportCsv: () => void;
  onShareLink: () => void;
  onExportIcal: () => void;
  onAirPrint: () => void;
}

interface Opt {
  key: string;
  iconColor: string;
  label: string;
  sub: string;
  onPress: () => void;
}

export function ExportSheet(props: ExportSheetProps) {
  // Built per theme: the sheet baked Colors.surface/text/border at import, so
  // in dark mode it slid up as a white card (audit 2026-09-07).
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const opts: Opt[] = [
    {
      key: 'pdf',
      iconColor: Colors.pillLate,
      label: 'PDF  ·  Full Gantt',
      sub: 'Multi-page · baseline overlay · for clients',
      onPress: props.onExportPdf,
    },
    {
      key: 'csv',
      iconColor: Colors.pillOnTrack,
      label: 'CSV  ·  Task list',
      sub: 'Open in Excel · 1 row per task',
      onPress: props.onExportCsv,
    },
    {
      key: 'share',
      iconColor: Colors.tradeColors.general,
      label: 'Share link  ·  Read-only',
      sub: 'Send to subs / owner · no login required',
      onPress: props.onShareLink,
    },
    {
      key: 'ical',
      iconColor: Colors.tradeColors.closeout,
      label: 'iCal  ·  Calendar feed',
      sub: 'Subscribe in Apple/Google Calendar',
      onPress: props.onExportIcal,
    },
    {
      key: 'print',
      iconColor: t.textSecondary,
      label: 'Print / AirPrint',
      sub: 'iOS share sheet · any AirPrint printer',
      onPress: props.onAirPrint,
    },
  ];

  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="slide"
      onRequestClose={props.onClose}
    >
      <Pressable style={styles.backdrop} onPress={props.onClose} />
      <View style={styles.sheet}>
        <View style={styles.grab} />
        <Text style={styles.title}>Export schedule</Text>
        {opts.map(o => (
          <Pressable
            key={o.key}
            onPress={() => {
              o.onPress();
              props.onClose();
            }}
            style={styles.opt}
          >
            <View style={{ width: 28, alignItems: 'center' }}>
              {(() => { const I = OPT_ICON[o.key]; return I ? <I size={20} color={o.iconColor} strokeWidth={1.75} /> : null; })()}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.optLabel}>{o.label}</Text>
              <Text style={styles.optSub}>{o.sub}</Text>
            </View>
            <ChevronRight size={18} color={t.textSecondary} strokeWidth={1.75} />
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: t.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
  },
  grab: {
    width: 36,
    height: 4,
    backgroundColor: t.line,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  title: {
    color: t.text,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 10,
  },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    // Was a fixed `rgba(31,37,45,0.6)`. At 60% alpha that is not a hairline,
    // it is a bar: over the sheet's `t.surface` it composites to rgb(121,124,
    // 129) on the light theme and to rgb(27,29,32) — invisible — on the dark
    // one. The same literal was fixed in tabs/DashboardTab.tsx by this pass
    // and missed here (review 2026-09-07).
    borderBottomColor: t.line,
  },
  optIcon: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  optLabel: {
    color: t.text,
    fontSize: 13,
    fontWeight: '600',
  },
  optSub: {
    color: t.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },
  chev: {
    color: t.textSecondary,
    fontSize: 16,
  },
});
