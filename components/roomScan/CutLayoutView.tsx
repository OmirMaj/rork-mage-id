// components/roomScan/CutLayoutView.tsx — one wall's (or the ceiling's) drywall
// cut layout, drawn from utils/roomScan/cutPlanCore.
//
// Each rectangle is one piece of board, with the number of the sheet it was cut
// from. A piece cut from an earlier offcut is shaded. A hole for a door, a
// window or an opening is drawn dashed, once. A ceiling shows the room's true
// outline over the pieces, so a piece that is cut to an angled wall can be
// seen. The drawing is to scale and nothing more: it does not know where the
// studs are.
import React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { SurfacePlan } from '@/utils/roomScan/cutPlanCore';
import { makeRoomScanStyles } from './styles';

const MAX_H = 190;
const PAD = 10;

export interface CutLayoutViewProps {
  surface: SurfacePlan;
  a11yLabel: string;
  testID?: string;
}

export function CutLayoutView({ surface, a11yLabel, testID }: CutLayoutViewProps) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  const [width, setWidth] = React.useState(340);
  const onLayout = (e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; if (w > 0 && Math.abs(w - width) > 1) setWidth(w); };
  const W = Math.max(surface.widthIn, 1);
  const H = Math.max(surface.heightIn, 1);
  const k = Math.min((width - 2 * PAD) / W, (MAX_H - 2 * PAD) / H);
  const height = H * k + 2 * PAD;
  const ox = (width - W * k) / 2;
  // y runs up the wall and down the screen.
  const sx = (x: number) => ox + x * k;
  const sy = (y: number) => PAD + (H - y) * k;
  return (
    <View style={styles.planBox} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={a11yLabel} testID={testID}>
      <Svg width={width} height={height}>
        {surface.pieces.map((p, i) => {
          const w = p.w * k;
          const h = p.h * k;
          return (
            <React.Fragment key={`piece-${i}`}>
              <Rect x={sx(p.x)} y={sy(p.y + p.h)} width={w} height={h} fill={p.fromOffcut ? colors.accentSoft : colors.surfaceAlt} stroke={colors.text} strokeWidth={1} />
              {w > 16 && h > 14 ? (
                <SvgText x={sx(p.x) + w / 2} y={sy(p.y + p.h) + h / 2 + 4} fontSize={11} fontWeight="700" fill={colors.textSecondary} textAnchor="middle">{String(p.sheet)}</SvgText>
              ) : null}
            </React.Fragment>
          );
        })}
        {surface.openings.map((o, i) => (
          <Rect key={`hole-${i}`} x={sx(o.x0)} y={sy(o.y1)} width={(o.x1 - o.x0) * k} height={(o.y1 - o.y0) * k} fill={colors.bg} stroke={colors.textMuted} strokeWidth={1.5} strokeDasharray="4 3" />
        ))}
        {surface.outline.length >= 3 ? (
          <Polygon points={surface.outline.map((pt) => `${sx(pt.x)},${sy(pt.y)}`).join(' ')} fill="none" stroke={colors.accent} strokeWidth={2} />
        ) : (
          <Rect x={sx(0)} y={sy(H)} width={W * k} height={H * k} fill="none" stroke={colors.text} strokeWidth={2} />
        )}
      </Svg>
    </View>
  );
}
