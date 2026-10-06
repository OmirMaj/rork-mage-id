// components/roomScan/FloorPlanView.tsx — The Floor Plan: the room drawn from
// the model, with every number tappable.
//
// The drawing is react-native-svg. The numbers are ordinary Pressables laid
// over it, so each is a real button with a label a screen reader can say. A
// wall the scan was not sure of is dashed. A number typed by hand is outlined,
// so the plan always shows which lengths came from the scan and which from a
// tape. Nothing here promises how right a number is: the note under the plan
// says a phone scan can be off by an inch or more.
import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import Svg, { G, Line, Polygon, Rect } from 'react-native-svg';
import { AlertTriangle, Check } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Button } from '@/components/ui';
import type { RoomScanCopy } from '@/hooks/useRoomScanCopy';
import { planForDisplay } from '@/utils/roomScan/geometryCore';
import { ROOM_TYPES } from '@/utils/roomScan/recipesCore';
import type { RoomScan, RoomType, ScanFact, ScanOpening, ScanQuantities } from '@/utils/roomScan/types';
import { formatFeetInches, formatSqFt } from '@/utils/roomScan/units';
import { makeRoomScanStyles } from './styles';

const PLAN_H = 300;
const PAD = 46;

export interface FloorPlanViewProps {
  scan: RoomScan;
  quantities: ScanQuantities;
  facts: ScanFact[];
  copy: RoomScanCopy;
  scannedSub: string;
  saveState: 'idle' | 'saved' | 'failed';
  onEditWall: (wallId: string) => void;
  onEditCeiling: () => void;
  onEditOpening: (openingId: string, field: 'widthM' | 'heightM') => void;
  onRename: (name: string) => void;
  onRoomType: (t: RoomType) => void;
  onSave: () => void;
  onNext: () => void;
}

export function FloorPlanView(p: FloorPlanViewProps) {
  const { scan, quantities: q, copy } = p;
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  const [width, setWidth] = useState(340);
  const onLayout = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - width) > 1) setWidth(w); };

  const draw = useMemo(() => {
    const d = planForDisplay(scan);
    const k = Math.min((width - 2 * PAD) / Math.max(d.width, 0.01), (PLAN_H - 2 * PAD) / Math.max(d.height, 0.01));
    const ox = (width - d.width * k) / 2;
    const oy = (PLAN_H - d.height * k) / 2;
    const at = (pt: { x: number; y: number }) => ({ x: ox + pt.x * k, y: oy + pt.y * k });
    const cx = width / 2;
    const cy = PLAN_H / 2;
    return { d, k, at, cx, cy };
  }, [scan, width]);

  const wallById = useMemo(() => new Map(scan.walls.map((w) => [w.id, w])), [scan.walls]);
  const openingName = (o: ScanOpening) => (o.kind === 'door' ? copy.doorLabel : o.kind === 'window' ? copy.windowLabel : copy.openingLabel);
  const ceiling = scan.ceilingHeightM;
  const hasTyped = scan.walls.some((w) => w.lengthSource === 'typed');
  const hasAdjusted = scan.walls.some((w) => w.lengthSource === 'adjusted');
  const hasLow = scan.walls.some((w) => w.confidence === 'low' && w.lengthSource === 'scan');

  return (
    <View style={styles.body} testID="scan-plan">
      <View style={{ gap: 2 }}>
        <Text style={styles.eyebrow}>{copy.nameLabel}</Text>
        <TextInput
          testID="scan-name"
          style={styles.input}
          defaultValue={scan.name}
          placeholder={copy.namePlaceholder}
          placeholderTextColor={colors.textMuted}
          onEndEditing={(e) => p.onRename(e.nativeEvent.text)}
          accessibilityLabel={copy.nameLabel}
          maxLength={60}
        />
        <Text style={styles.rowSub}>{p.scannedSub}</Text>
      </View>

      <View style={{ gap: 6 }}>
        <Text style={styles.eyebrow}>{copy.roomTypeLabel}</Text>
        <View style={styles.chips}>
          {ROOM_TYPES.map((rt) => {
            const on = scan.roomType === rt;
            return (
              <Pressable key={rt} onPress={() => p.onRoomType(rt)} style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`scan-room-type-${rt}`}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{copy.roomTypeName(rt)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.planBox, { height: PLAN_H }]} onLayout={onLayout}>
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
                <Rect x={c.x - w / 2} y={c.y - h / 2} width={w} height={h} rx={4} fill="none" stroke={colors.textMuted} strokeWidth={1} />
              </G>
            );
          })}
          {draw.d.walls.map((dw) => {
            const w = wallById.get(dw.id);
            if (!w) return null;
            const a = draw.at(dw.a);
            const b = draw.at(dw.b);
            const low = w.confidence === 'low' && w.lengthSource === 'scan';
            return (
              <Line
                key={dw.id}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={low ? colors.warningLabel : w.lengthSource === 'scan' ? colors.text : colors.accent}
                strokeWidth={w.onOutline ? 4 : 2}
                strokeDasharray={low || !w.onOutline ? '6 5' : undefined}
                strokeLinecap="round"
              />
            );
          })}
          {scan.openings.map((o) => {
            const dw = draw.d.walls.find((x) => x.id === o.wallId);
            const w = o.wallId ? wallById.get(o.wallId) : undefined;
            if (!dw || !w || !(w.lengthM > 0)) return null;
            const a = draw.at(dw.a);
            const b = draw.at(dw.b);
            const t0 = Math.max(0, Math.min(1, o.offsetM / w.lengthM));
            const t1 = Math.max(0, Math.min(1, (o.offsetM + o.widthM) / w.lengthM));
            const x1 = a.x + (b.x - a.x) * t0;
            const y1 = a.y + (b.y - a.y) * t0;
            const x2 = a.x + (b.x - a.x) * t1;
            const y2 = a.y + (b.y - a.y) * t1;
            return (
              <G key={o.id}>
                <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={colors.surface} strokeWidth={6} />
                <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={o.kind === 'window' ? colors.info : colors.success} strokeWidth={2} />
              </G>
            );
          })}
        </Svg>
        {draw.d.walls.map((dw) => {
          const w = wallById.get(dw.id);
          if (!w) return null;
          const a = draw.at(dw.a);
          const b = draw.at(dw.b);
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          // Push the number outward from the middle of the plan so it sits beside its wall.
          const vx = mx - draw.cx;
          const vy = my - draw.cy;
          const n = Math.hypot(vx, vy) || 1;
          const left = Math.max(2, Math.min(width - 78, mx + (vx / n) * 22 - 36));
          const top = Math.max(2, Math.min(PLAN_H - 28, my + (vy / n) * 20 - 12));
          const low = w.confidence === 'low' && w.lengthSource === 'scan';
          const value = formatFeetInches(w.lengthM);
          return (
            <Pressable
              key={`dim-${dw.id}`}
              testID={`scan-dim-${w.label.replace(/\s+/g, '-').toLowerCase()}`}
              onPress={() => p.onEditWall(w.id)}
              style={[styles.dim, { left, top }, w.lengthSource !== 'scan' && styles.dimTyped, low && styles.dimLow]}
              accessibilityRole="button"
              accessibilityLabel={copy.dimensionA11y(copy.wallName(w.label), value)}
              hitSlop={8}
            >
              <Text style={styles.dimText}>{value}</Text>
            </Pressable>
          );
        })}
      </View>

      {(hasTyped || hasAdjusted || hasLow) && (
        <View style={{ gap: 4 }}>
          {hasTyped && <View style={styles.legendRow}><View style={styles.legendSwatch} /><Text style={styles.note}>{copy.legendTypedSub}</Text></View>}
          {hasAdjusted && <View style={styles.legendRow}><View style={styles.legendSwatch} /><Text style={styles.note}>{copy.legendAdjustedSub}</Text></View>}
          {hasLow && <View style={styles.legendRow}><View style={[styles.legendSwatch, styles.legendSwatchLow]} /><Text style={styles.note}>{copy.legendLowSub}</Text></View>}
        </View>
      )}

      <View style={styles.strip}>
        <Pressable style={styles.stripCell} onPress={p.onEditCeiling} accessibilityRole="button" testID="scan-ceiling"
          accessibilityLabel={copy.dimensionA11y(copy.ceilingLabel, ceiling.known ? formatFeetInches(ceiling.typical) : copy.notKnownLabel)}>
          <Text style={styles.eyebrow}>{copy.ceilingLabel}</Text>
          <Text style={styles.stripValue}>{ceiling.known ? formatFeetInches(ceiling.typical) : copy.notKnownLabel}</Text>
        </Pressable>
        <View style={styles.stripCell}>
          <Text style={styles.eyebrow}>{copy.floorLabel}</Text>
          <Text style={styles.stripValue} testID="scan-floor-area">{q.floorAreaSF == null ? copy.notKnownLabel : formatSqFt(q.floorAreaSF)}</Text>
        </View>
        <View style={styles.stripCell}>
          <Text style={styles.eyebrow}>{copy.wallsFoundLabel}</Text>
          <Text style={styles.stripValue} testID="scan-walls-found">{copy.wallsFoundValue(p.facts[0]?.found ?? 0, p.facts[0]?.needed ?? 0)}</Text>
        </View>
      </View>

      {scan.openings.length > 0 && (
        <View style={styles.card}>
          {scan.openings.map((o, i) => (
            <View key={o.id} style={[styles.row, i === 0 && styles.rowFirst]}>
              <View style={styles.rowMain}><Text style={styles.rowLabel}>{openingName(o)}</Text></View>
              <Pressable onPress={() => p.onEditOpening(o.id, 'widthM')} style={[styles.chip, o.widthSource === 'typed' && styles.chipOn]} accessibilityRole="button"
                accessibilityLabel={copy.dimensionA11y(`${openingName(o)}, ${copy.editTitleLabel('width')}`, formatFeetInches(o.widthM))}>
                <Text style={styles.chipText}>{formatFeetInches(o.widthM)}</Text>
              </Pressable>
              <Pressable onPress={() => p.onEditOpening(o.id, 'heightM')} style={[styles.chip, o.heightSource === 'typed' && styles.chipOn]} accessibilityRole="button"
                accessibilityLabel={copy.dimensionA11y(`${openingName(o)}, ${copy.editTitleLabel('height')}`, formatFeetInches(o.heightM))}>
                <Text style={styles.chipText}>{formatFeetInches(o.heightM)}</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View style={{ gap: 6 }} testID="scan-facts">
        {p.facts.map((f, i) => (
          <View key={`${f.kind}-${i}`} style={styles.factRow}>
            {f.tone === 'check' ? <AlertTriangle size={14} color={colors.warningLabel} /> : <Check size={14} color={colors.successLabel} />}
            <Text style={[styles.factText, f.tone === 'check' && styles.factCheck]}>{copy.fact(f)}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.note}>{copy.planNoteBody}</Text>

      {p.saveState === 'saved' && <Text style={styles.okText}>{copy.savedNote}</Text>}
      {p.saveState === 'failed' && <Text style={styles.errorText}>{copy.saveFailedBody}</Text>}
      <Button label={copy.saveLabel} variant="secondary" onPress={p.onSave} testID="scan-save" />
      <Button label={copy.seeQuantitiesLabel} variant="primary" onPress={p.onNext} testID="scan-see-quantities" />
    </View>
  );
}
