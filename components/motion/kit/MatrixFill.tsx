// MatrixFill — Matrix Fill (pattern 12), the app's form: no pan, ever (the
// user owns the scroll).
//
// Rows fill top → bottom, 35 ms apart, for the first 8 rows. In each row the
// LABEL cell fades in (160 ms) and its paired EVIDENCE follows 60 ms later
// (160 ms + translateX 6 → 0). Pairs stay aligned because the row containers
// never move — only the cells' opacity / translateX do. ≤ 16 animated layers
// (8 rows × label + evidence); rows past the 8th land with no motion.
//
// Reduce Motion: every row appears together over 100 ms.
// Web (desktop): the fade / pairX6 classes.

import React from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/components/ui/motion';
import { entranceOf, planMatrixFill, stepFor } from '@/utils/motion/kit/plans';
import { useEntrance } from './useEntrance';

export type MatrixRow = { key: string; label: React.ReactNode; evidence: readonly React.ReactNode[] };

export type MatrixFillProps = {
  rows: readonly MatrixRow[];
  armed: boolean;
  /** Lay a row out yourself: put `styles.label` / `styles.evidence` on two Animated.Views. */
  renderRow?: (row: MatrixRow, i: number, styles: { label: ViewStyle | null; evidence: ViewStyle | null }) => React.ReactNode;
  rowStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function Row({ row, index, count, armed, renderRow, rowStyle }: {
  row: MatrixRow; index: number; count: number; armed: boolean;
  renderRow?: MatrixFillProps['renderRow']; rowStyle?: StyleProp<ViewStyle>;
}) {
  const reduce = useReducedMotion();
  const plan = planMatrixFill(reduce, count);
  const l = stepFor(plan, `label-${index}`);
  const e = stepFor(plan, `evidence-${index}`);
  const label = useEntrance(armed && !!l, l ? { ...entranceOf(l), web: 'fade' } : { fadeMs: 0 }, { desktopWebOnly: true });
  const evidence = useEntrance(armed && !!e, e ? { ...entranceOf(e), web: 'pairX6' } : { fadeMs: 0 }, { desktopWebOnly: true });
  if (renderRow) return <>{renderRow(row, index, { label, evidence })}</>;
  return (
    <View style={[styles.row, rowStyle]}>
      <Animated.View style={[styles.label, label]}>{row.label}</Animated.View>
      <Animated.View style={[styles.evidence, evidence]}>{row.evidence}</Animated.View>
    </View>
  );
}

export function MatrixFill({ rows, armed, renderRow, rowStyle, style, testID }: MatrixFillProps) {
  return (
    <View testID={testID} style={style}>
      {rows.map((r, i) => (
        <Row key={r.key} row={r} index={i} count={rows.length} armed={armed} renderRow={renderRow} rowStyle={rowStyle} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  label: { flexShrink: 0 },
  evidence: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
});

export default MatrixFill;
