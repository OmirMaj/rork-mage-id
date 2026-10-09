// components/roomScan/CutLayoutView.tsx — one wall's (or the ceiling's) drywall
// cut layout, drawn from utils/roomScan/cutPlanCore, with every piece written
// out under it.
//
// THE DRAWING. Each rectangle is one piece of board, with the number of the
// sheet it was cut from. A piece cut from an earlier offcut is STRIPED (lines
// across it, not only a different colour) and the list under the drawing says
// "from an offcut" in words, so the difference never depends on telling two
// colours apart. A hole for a door, a window or an opening is drawn dashed,
// once. A ceiling shows the room's true outline over the pieces, so a piece
// that is cut to an angled wall can be seen. The drawing is to scale and
// nothing more: it does not know where the studs are.
//
// THE LIST. One line for each piece, in the order they are drawn (top course
// first, left to right): "Sheet 3: 92 by 48 in, from an offcut, window cut
// out". It is what a hanger reads, and it is also what a screen reader reads:
// the drawing's accessibility label is its title followed by these lines.
//
// Memoised: the order list is worked out again on every choice, and a wall
// whose layout did not change is not drawn again.
import React from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { SurfacePlan } from '@/utils/roomScan/cutPlanCore';
import { makeRoomScanStyles } from './styles';

const MAX_H = 190;
const PAD = 10;
/** Screen points between the stripes on a piece cut from an offcut. */
const STRIPE = 7;

export interface CutLayoutViewProps {
  surface: SurfacePlan;
  /** The drawing's title for a screen reader ("Drywall cut layout for Wall 3"). */
  a11yLabel: string;
  /** The heading over the piece list. */
  listLabel: string;
  /** One line for each piece of `surface.pieces`, in the same order. */
  pieceLines: readonly string[];
  testID?: string;
}

function CutLayout({ surface, a11yLabel, listLabel, pieceLines, testID }: CutLayoutViewProps) {
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
    <View testID={testID}>
      <View style={styles.planBox} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={[a11yLabel, ...pieceLines].join('. ')} testID={testID ? `${testID}-drawing` : undefined}>
        <Svg width={width} height={height}>
          {surface.pieces.map((p, i) => {
            const w = p.w * k;
            const h = p.h * k;
            const x0 = sx(p.x);
            const y0 = sy(p.y + p.h);
            // Stripes for a piece cut from an offcut: upright lines, so it reads without colour.
            const stripes: number[] = [];
            if (p.fromOffcut) for (let x = x0 + STRIPE; x < x0 + w - 1; x += STRIPE) stripes.push(x);
            return (
              <React.Fragment key={`piece-${i}`}>
                <Rect x={x0} y={y0} width={w} height={h} fill={colors.surfaceAlt} stroke={colors.text} strokeWidth={1} />
                {stripes.map((x) => <Line key={`stripe-${i}-${x}`} x1={x} y1={y0 + 1} x2={x} y2={y0 + h - 1} stroke={colors.textMuted} strokeWidth={1} />)}
                {w > 16 && h > 14 ? (
                  <>
                    <Rect x={x0 + w / 2 - 9} y={y0 + h / 2 - 8} width={18} height={16} fill={colors.surfaceAlt} />
                    <SvgText x={x0 + w / 2} y={y0 + h / 2 + 4} fontSize={11} fontWeight="700" fill={colors.textSecondary} textAnchor="middle">{String(p.sheet)}</SvgText>
                  </>
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
      <View style={styles.choice} testID={testID ? `${testID}-pieces` : undefined}>
        <Text style={styles.eyebrow}>{listLabel}</Text>
        {pieceLines.map((line, i) => (
          <Text key={`line-${i}`} style={styles.rowSub} testID={testID ? `${testID}-piece-${i}` : undefined}>{line}</Text>
        ))}
      </View>
    </View>
  );
}

/** The same surface plan and the same words draw the same thing. */
export const CutLayoutView = React.memo(CutLayout, (a, b) =>
  a.surface === b.surface && a.a11yLabel === b.a11yLabel && a.listLabel === b.listLabel && a.testID === b.testID
  && a.pieceLines.length === b.pieceLines.length && a.pieceLines.every((line, i) => line === b.pieceLines[i]));
