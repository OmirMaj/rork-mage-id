// components/livingModel/ModelPlan.tsx — one floor of the job model, drawn flat.
//
// The Room Editor and the flat replay both draw through this file, so a room
// looks the same in each. It only draws: it is handed a fill per room and
// changes nothing. Drawn with react-native-svg; the names sit above the
// drawing as ordinary text so they take the app's type.
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Line, Polygon, Rect } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { roomBounds, roomCentre, worldFloor, worldWalls } from '@/utils/livingModel/modelCore';
import { gridLines, toPx, type PlanView } from '@/utils/livingModel/planView';
import type { JobModel } from '@/utils/livingModel/types';
import { makeLivingModelStyles } from './styles';

export interface ModelPlanProps {
  model: JobModel;
  level: number;
  view: PlanView;
  /** The fill for each room's floor. */
  fillFor: (roomId: string) => string;
  /** A second, faint fill drawn as a band inside the room (the plan, past today). */
  ghostFor?: (roomId: string) => string | null;
  /** The line under a room's name. */
  subFor?: (roomId: string) => string | null;
  selectedId?: string | null;
  /** The wall to mark on the selected room. */
  selectedWallId?: string | null;
  showGrid?: boolean;
  testID?: string;
}

export function ModelPlan({ model, level, view, fillFor, ghostFor, subFor, selectedId, selectedWallId, showGrid = false, testID }: ModelPlanProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const rooms = useMemo(() => model.rooms.filter((r) => r.level === level), [model, level]);
  const grid = useMemo(() => (showGrid ? gridLines(view) : null), [showGrid, view]);
  const drawn = useMemo(() => rooms.map((r) => ({
    room: r,
    floor: worldFloor(r).map((p) => toPx(view, p)),
    walls: worldWalls(r).map((w) => ({ w, a: toPx(view, w.a), b: toPx(view, w.b) })),
    centre: roomCentre(r),
  })), [rooms, view]);

  return (
    <View style={{ width: view.width, height: view.height }} testID={testID}>
      <Svg width={view.width} height={view.height} pointerEvents="none">
        <Rect x={0} y={0} width={view.width} height={view.height} fill={colors.surfaceAlt} />
        {grid?.xs.map((x, i) => <Line key={`gx${i}`} x1={x} y1={0} x2={x} y2={view.height} stroke={colors.line} strokeWidth={1} />)}
        {grid?.ys.map((y, i) => <Line key={`gy${i}`} x1={0} y1={y} x2={view.width} y2={y} stroke={colors.line} strokeWidth={1} />)}
        {drawn.map(({ room, floor }) => (floor.length >= 3 ? (
          <Polygon key={`f${room.id}`} points={floor.map((p) => `${p.x},${p.y}`).join(' ')} fill={fillFor(room.id)} />
        ) : null))}
        {drawn.map(({ room, floor }) => {
          const ghost = ghostFor?.(room.id);
          if (!ghost || floor.length < 3) return null;
          return <Polygon key={`g${room.id}`} points={floor.map((p) => `${p.x},${p.y}`).join(' ')} fill={ghost} fillOpacity={0.3} stroke={ghost} strokeWidth={2} strokeDasharray="6 5" />;
        })}
        {drawn.map(({ room, walls }) => walls.map(({ w, a, b }) => {
          const on = room.id === selectedId;
          const marked = on && w.id === selectedWallId;
          const stroke = marked ? colors.accent : colors.text;
          const width = marked ? 6 : on ? 4 : 3;
          const len = w.lengthM || 1;
          const at = (s: number) => ({ x: a.x + ((b.x - a.x) * s) / len, y: a.y + ((b.y - a.y) * s) / len });
          const parts: React.ReactNode[] = [];
          let cur = 0;
          w.openings.forEach((o, i) => {
            if (o.s0 > cur) { const p = at(cur); const q = at(o.s0); parts.push(<Line key={`s${i}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={stroke} strokeWidth={width} strokeLinecap="square" />); }
            cur = Math.max(cur, o.s1);
          });
          if (cur < len) { const p = at(cur); parts.push(<Line key="end" x1={p.x} y1={p.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={width} strokeLinecap="square" />); }
          return <React.Fragment key={`w${w.id}`}>{parts}</React.Fragment>;
        }))}
        {/* Doors and windows go on last, over every wall: two rooms that touch each draw the wall between them, and one room's wall would cover the other's doorway. A door is a clear gap with two jambs; a window is a thin line. */}
        {drawn.map(({ walls }) => walls.map(({ w, a, b }) => w.openings.map((o) => {
          const len = w.lengthM || 1;
          const at = (s: number) => ({ x: a.x + ((b.x - a.x) * s) / len, y: a.y + ((b.y - a.y) * s) / len });
          const p = at(o.s0);
          const q = at(o.s1);
          const nx = w.inward.x * 5;
          const ny = w.inward.y * 5;
          return (
            <React.Fragment key={`o${o.id}`}>
              <Line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={colors.surface} strokeWidth={7} />
              {o.kind === 'window'
                ? <Line x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke={colors.info} strokeWidth={2} />
                : (
                  <>
                    <Line x1={p.x - nx} y1={p.y - ny} x2={p.x + nx} y2={p.y + ny} stroke={colors.text} strokeWidth={2} />
                    <Line x1={q.x - nx} y1={q.y - ny} x2={q.x + nx} y2={q.y + ny} stroke={colors.text} strokeWidth={2} />
                  </>
                )}
            </React.Fragment>
          );
        })))}
      </Svg>
      {drawn.map(({ room, centre }) => {
        if (!centre) return null;
        const p = toPx(view, centre);
        const box = roomBounds(room);
        const wide = box ? (box.maxX - box.minX) * view.scale : 0;
        // A narrow room shows its name alone: a second line would run into the room beside it.
        const sub = wide >= 132 ? subFor?.(room.id) : null;
        const width = Math.max(44, wide - 6);
        return (
          <View key={`l${room.id}`} pointerEvents="none" style={[styles.planLabel, { left: p.x - width / 2, top: p.y - (sub ? 16 : 9), width }]}>
            <Text style={styles.planLabelName} numberOfLines={1}>{room.name}</Text>
            {sub ? <Text style={styles.planLabelSub} numberOfLines={1}>{sub}</Text> : null}
          </View>
        );
      })}
    </View>
  );
}
