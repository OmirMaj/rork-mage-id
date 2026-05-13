// components/schedule/ExportSheet.tsx — Phase 27.
//
// Five-option export bottom sheet. Used on desktop and phone. Three
// options (PDF/CSV/Share) reuse existing generators. Two are new this
// phase: iCal (Task 16) and AirPrint (Task 17).

import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors } from '@/constants/colors';

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
      iconColor: Colors.textSecondary,
      label: 'Print / AirPrint',
      sub: 'iOS share sheet · any AirPrint printer',
      onPress: props.onAirPrint,
    },
  ];

  const ICON_MAP: Record<string, string> = {
    pdf: '📄',
    csv: '📊',
    share: '🔗',
    ical: '📅',
    print: '🖨️',
  };

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
            <Text style={[styles.optIcon, { color: o.iconColor }]}>
              {ICON_MAP[o.key]}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.optLabel}>{o.label}</Text>
              <Text style={styles.optSub}>{o.sub}</Text>
            </View>
            <Text style={styles.chev}>{'›'}</Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 28,
  },
  grab: {
    width: 36,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  title: {
    color: Colors.text,
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
    borderBottomColor: 'rgba(31,37,45,0.6)',
  },
  optIcon: {
    fontSize: 18,
    width: 24,
    textAlign: 'center',
  },
  optLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  optSub: {
    color: Colors.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },
  chev: {
    color: Colors.textSecondary,
    fontSize: 16,
  },
});
