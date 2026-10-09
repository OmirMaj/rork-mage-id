// components/roomScan/ClearanceView.tsx — Clearance Check: the distances an
// inspector commonly looks at, measured off the scan, and which are worth a
// tape (Scan The Room, lane CLEARANCE; owner preview, behind its own gate,
// utils/roomScan/clearanceAllowed).
//
// The maths is utils/roomScan/clearanceCore (pure). This file draws what it is
// handed: the plan, a row for each measurement, and the standing sentences.
// Tapping a row draws that measurement on the plan as a dimension line.
//
// WHAT THIS SCREEN NEVER DOES. It has ONE action besides choosing a row: the
// door into Code Check. No state here enables, disables, hides or changes
// anything else, and nothing outside this screen reads a state. It never
// colours a row green and never shows a tick: "Roomy" is a neutral pill, the
// two tape-it states are the same amber pill, and the words carry the meaning.
// A row with no label says so. The sentences that a phone scan can be off by
// an inch or more, that no label means not checked against anything, and that
// nothing here stops an action, are always drawn.
import React, { useMemo, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { G, Line, Polygon, Rect } from 'react-native-svg';
import { Ruler } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ScanClearanceCopy } from '@/hooks/useScanClearanceCopy';
import { Button } from '@/components/ui';
import type { ClearanceCheck, ClearanceMeasure } from '@/utils/roomScan/clearanceCore';
import { planForDisplay } from '@/utils/roomScan/geometryCore';
import type { RoomScan } from '@/utils/roomScan/types';
import { makeRoomScanStyles } from './styles';

const PLAN_H = 260;
const PAD = 28;
const TICK = 6;

export interface ClearanceViewProps {
  scan: RoomScan;
  check: ClearanceCheck;
  copy: ScanClearanceCopy;
  /** Opens the existing Code Check for this project. The only action on the screen. */
  onOpenCodeCheck: () => void;
}

export function ClearanceView({ scan, check, copy, onOpenCodeCheck }: ClearanceViewProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  const [width, setWidth] = useState(340);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const onLayout = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - width) > 1) setWidth(w); };

  const draw = useMemo(() => {
    const d = planForDisplay(scan);
    const k = Math.min((width - 2 * PAD) / Math.max(d.width, 0.01), (PLAN_H - 2 * PAD) / Math.max(d.height, 0.01));
    const ox = (width - d.width * k) / 2;
    const oy = (PLAN_H - d.height * k) / 2;
    const at = (pt: { x: number; y: number }) => ({ x: ox + pt.x * k, y: oy + pt.y * k });
    return { d, k, at };
  }, [scan, width]);

  const counts = useMemo(() => ({
    toilets: scan.objects.filter((o) => o.category === 'toilet').length,
    sinks: scan.objects.filter((o) => o.category === 'sink').length,
    doors: scan.openings.filter((o) => o.kind === 'door').length,
    windows: scan.openings.filter((o) => o.kind === 'window').length,
  }), [scan]);

  const chosen: ClearanceMeasure | null = check.measures.find((m) => m.id === chosenId) ?? null;
  // The chosen measurement as a line on the screen, with a short tick square to it at each end.
  const dimension = useMemo(() => {
    if (!chosen || !chosen.line) return null;
    const a = draw.at(draw.d.place(chosen.line.a));
    const b = draw.at(draw.d.place(chosen.line.b));
    const n = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const px = (-(b.y - a.y) / n) * TICK;
    const py = ((b.x - a.x) / n) * TICK;
    return { a, b, px, py, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }, [chosen, draw]);

  return (
    <View style={styles.body} testID="scan-clearance">
      <Text style={styles.para}>{copy.introBody}</Text>
      <View style={styles.blocked} testID="scan-clearance-notice">
        <Text style={styles.blockedText}>{copy.scanNoticeBody}</Text>
      </View>

      <View style={[styles.planBox, { height: PLAN_H }]} onLayout={onLayout} accessible accessibilityLabel={copy.planA11yLabel} testID="scan-clearance-plan">
        <Svg width={width} height={PLAN_H}>
          {draw.d.floor.length >= 3 && (
            <Polygon points={draw.d.floor.map((pt) => { const s = draw.at(pt); return `${s.x},${s.y}`; }).join(' ')} fill={colors.surfaceAlt} />
          )}
          {draw.d.objects.map((o) => {
            const src = scan.objects.find((x) => x.id === o.id);
            if (!src) return null;
            const c = draw.at(o.center);
            const w = Math.max(6, src.widthM * draw.k);
            const h = Math.max(6, src.depthM * draw.k);
            return (
              <G key={o.id} rotation={(o.rotationRad * 180) / Math.PI} origin={`${c.x}, ${c.y}`}>
                <Rect x={c.x - w / 2} y={c.y - h / 2} width={w} height={h} rx={3} fill="none" stroke={chosen?.objectId === o.id ? colors.text : colors.textMuted} strokeWidth={chosen?.objectId === o.id ? 2 : 1} />
              </G>
            );
          })}
          {draw.d.walls.map((dw) => {
            const a = draw.at(dw.a);
            const b = draw.at(dw.b);
            return <Line key={dw.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors.text} strokeWidth={chosen?.wallIds.includes(dw.id) ? 4 : 2} strokeLinecap="round" />;
          })}
          {dimension && (
            <G testID="scan-clearance-dimension">
              <Line x1={dimension.a.x} y1={dimension.a.y} x2={dimension.b.x} y2={dimension.b.y} stroke={colors.accent} strokeWidth={2} />
              <Line x1={dimension.a.x - dimension.px} y1={dimension.a.y - dimension.py} x2={dimension.a.x + dimension.px} y2={dimension.a.y + dimension.py} stroke={colors.accent} strokeWidth={2} />
              <Line x1={dimension.b.x - dimension.px} y1={dimension.b.y - dimension.py} x2={dimension.b.x + dimension.px} y2={dimension.b.y + dimension.py} stroke={colors.accent} strokeWidth={2} />
            </G>
          )}
        </Svg>
        {dimension && chosen && (
          <View
            style={[styles.dim, styles.dimTyped, { left: Math.max(2, Math.min(width - 96, dimension.mid.x - 44)), top: Math.max(2, Math.min(PLAN_H - 28, dimension.mid.y - 30)) }]}
            pointerEvents="none"
            testID="scan-clearance-dimension-value"
          >
            <Text style={styles.dimText}>{copy.valueText(chosen)}</Text>
          </View>
        )}
      </View>
      <Text style={styles.note}>{copy.tapBody}</Text>

      <View style={styles.card} testID="scan-clearance-measures">
        <Text style={styles.cardHeading} accessibilityRole="header">{copy.measuresHeadingLabel}</Text>
        {check.measures.length === 0 && <Text style={styles.note} testID="scan-clearance-empty">{copy.emptyBody}</Text>}
        {check.measures.map((m, i) => {
          const label = copy.measureLabel(m, counts);
          const value = copy.valueText(m);
          const stateText = m.state ? copy.stateLabel(m.state) : copy.noStateSub;
          const on = chosenId === m.id;
          const notes = copy.measureNotes(m);
          return (
            <Pressable
              key={m.id}
              onPress={() => setChosenId(on ? null : m.id)}
              style={[styles.row, i === 0 && styles.rowFirst]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={copy.rowA11yLabel(label, value, stateText)}
              testID={`scan-clearance-row-${m.id}`}
            >
              <View style={styles.rowMain}>
                <Text style={styles.rowLabel}>{label}</Text>
                <Text style={styles.rowValue} testID={`scan-clearance-value-${m.id}`}>{value}</Text>
                <View style={[styles.pill, m.state === 'close' || m.state === 'tight' ? { backgroundColor: colors.warningSoft } : null]}>
                  <Text style={[styles.pillText, m.state === 'close' || m.state === 'tight' ? { color: colors.warningLabel } : null]} testID={`scan-clearance-state-${m.id}`}>{stateText}</Text>
                </View>
                {m.figures.map((f) => (
                  <View key={f.refId} style={{ gap: 2 }} testID={`scan-clearance-figure-${m.id}-${f.refId}`}>
                    <Text style={styles.factText}>{copy.figureBody(f.refId)}</Text>
                    <Text style={styles.note}>{copy.figureLocalBody}</Text>
                  </View>
                ))}
                {notes.map((note) => <Text key={note} style={styles.note}>{note}</Text>)}
                <View style={styles.legendRow}>
                  <Ruler size={12} color={colors.textMuted} />
                  <Text style={styles.rowSub} testID={`scan-clearance-basis-${m.id}`}>{m.restsOnTaped ? copy.restsOnTapedSub : copy.fromScanSub}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.para} testID="scan-clearance-not-checked">{copy.notCheckedBody}</Text>
      <Text style={styles.note} testID="scan-clearance-never">{copy.neverClearedBody} {copy.neverBlocksBody}</Text>

      <View style={styles.card} testID="scan-clearance-margin">
        <Text style={styles.cardHeading} accessibilityRole="header">{copy.marginHeadingLabel}</Text>
        <Text style={styles.factText} testID="scan-clearance-margin-body">{copy.marginBody(check.margin)}</Text>
        <Text style={styles.factText}>{copy.tapedMarginBody(check.margin)}</Text>
        {check.tapedCount > 0 && <Text style={styles.factText} testID="scan-clearance-taped-count">{copy.tapedCountBody(check.tapedCount)}</Text>}
      </View>

      <View style={styles.card} testID="scan-clearance-states">
        <Text style={styles.cardHeading} accessibilityRole="header">{copy.statesHeadingLabel}</Text>
        {(['roomy', 'close', 'tight'] as const).map((s) => (
          <View key={s} style={{ gap: 2 }}>
            <Text style={styles.rowLabel}>{copy.stateLabel(s)}</Text>
            <Text style={styles.note}>{copy.stateMeaningBody(s)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card} testID="scan-clearance-left-out">
        <Text style={styles.cardHeading} accessibilityRole="header">{copy.leftOutHeadingLabel}</Text>
        {check.leftOut.map((l) => (
          <Text key={l.kind} style={styles.factText} testID={`scan-clearance-left-${l.kind}`}>{copy.leftOutBody(l)}</Text>
        ))}
      </View>

      <Text style={styles.note}>{copy.starterBody}</Text>
      <Text style={styles.note}>{copy.codeCheckBody}</Text>
      <Button label={copy.codeCheckLabel} variant="secondary" onPress={onOpenCodeCheck} testID="scan-clearance-code-check" />
    </View>
  );
}
