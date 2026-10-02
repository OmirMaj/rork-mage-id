// components/level/JobLevelReason.tsx — the Level's tap detail: the one-line
// reading and every reason behind it, in the app's one sheet primitive
// (components/ui/Sheet: a bottom sheet on the phone, a 440 px dialog on the
// desktop). The large vial is passed in as `children` so this file does not
// import JobLevel (no import cycle).
//
// Under the reasons, the legend (utils/jobLevel JOB_LEVEL_LEGEND): how to read
// any Level — Home rows, the portfolio, the hub — so every sheet explains
// itself. Each line goes through t() with its fixed key; the English is the
// engine's own text (scripts/validate-job-level pins them equal).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sheet } from '@/components/ui/Sheet';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useT } from '@/contexts/LanguageContext';
import type { JobLevelReading } from '@/utils/jobLevel';

export interface JobLevelReasonProps {
  visible: boolean;
  onClose: () => void;
  reading: JobLevelReading;
  /** The project's name, as the sheet's subtitle. */
  projectName?: string;
  /** The detail-size vial, drawn above the words. */
  children?: React.ReactNode;
}

export function JobLevelReason({ visible, onClose, reading, projectName, children }: JobLevelReasonProps) {
  const styles = useThemedStyles(makeStyles);
  const { t } = useT();
  return (
    <Sheet visible={visible} onClose={onClose} title={t('office.projectHealth.title', 'Project health')} subtitle={projectName} size="dialog" testID="joblevel-reason">
      {children ? <View style={styles.vial}>{children}</View> : null}
      <Text style={styles.label} testID="joblevel-reason-label">{reading.label}</Text>
      <View style={styles.reasons}>
        {reading.reasons.map((r, i) => (
          <Text key={i} style={styles.reason} testID={`joblevel-reason-${i}`}>{r}</Text>
        ))}
      </View>
      <View style={styles.legend} testID="joblevel-legend">
        <Text style={styles.legendLine}>{t('office.projectHealth.legend.bubble', 'The bubble moves right when the finish slips past the baseline.')}</Text>
        <Text style={styles.legendLine}>{t('office.projectHealth.legend.colour', 'The colour is margin risk.')}</Text>
        <Text style={styles.legendLine}>{t('office.projectHealth.legend.listed', 'Open punch, late RFIs and late tasks are listed, not drawn.')}</Text>
        <Text style={styles.legendLine}>{t('office.projectHealth.legend.empty', 'A grey, hollow level means there is not enough data yet.')}</Text>
      </View>
    </Sheet>
  );
}

export default JobLevelReason;

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  vial: { alignItems: 'center', paddingVertical: 12 },
  label: { ...Type.subheadEmphasized, color: t.text },
  reasons: { marginTop: 8, gap: 6 },
  reason: { ...Type.footnote, color: t.textSecondary },
  legend: { marginTop: 14, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line, gap: 4 },
  legendLine: { ...Type.caption1, color: t.textSecondary },
});
