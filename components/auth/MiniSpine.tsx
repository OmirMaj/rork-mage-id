// components/auth/MiniSpine.tsx — the five-chip reprise of the spine, over the sign-in sheet.
//
// Ask, Estimate, Contract (the signature writes in once), Schedule (6 weeks,
// on track), Paid. The chips share one left edge and one width, like the
// welcome cards; each dims a little as the next one lands. ~2 s, once per
// mount; Reduce Motion shows the final state. The whole strip is the one
// sample job the "Sample project" pill above it names. Decoration only:
// pointerEvents="none" and a single accessible summary.
import React from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DISPLAY_FONT } from '@/constants/typography';
import { ASK_ADDRESS, MINI_DIM, miniPlan, planTotal, type Beat } from '@/utils/auth/spineSequence';
import { arriveStyle, useSpineClock } from '@/components/auth/spineClock';
import SignatureStroke from '@/components/auth/SignatureStroke';
import {
  AiBadge, CARD, DimVeil, EndNode, KLabel, LineNode, LineSegment, OnTrack, PaidGlow, PaidRim, PaidState,
} from '@/components/auth/SpineParts';

/** The strip's own size, in design points. */
export const MINI_RIG = { width: 390, height: 212 } as const;

const X = 34;
const NODE_Y = [21, 62, 103, 144, 187] as const;
const CHIP_TOP = [2, 43, 84, 125, 166] as const;
const CHIP_RADIUS = 12;

const A11Y_SUMMARY =
  'Sample project: ask about 418 Atlantic Ave, Brooklyn; estimate $31,870; contract signed Sep 4; ' +
  'schedule 6 weeks, on track; invoice #12, $12,400.00, paid.';

export type MiniSpineProps = {
  width: number;
  maxScale?: number;
  /** Tests only: force the play on or off. Real users: Reduce Motion decides. */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function Chip({ clock, beat, dim, dimTo, top, tall = false, rim, children }: {
  clock: Animated.Value; beat: Beat; dim?: Beat; dimTo?: number; top: number; tall?: boolean; rim?: Beat; children: React.ReactNode;
}) {
  return (
    <Animated.View style={[styles.chip, { top, height: tall ? 42 : 38 }, arriveStyle(clock, beat, 28, 10, 1.04)]}>
      {children}
      {dim && dimTo != null ? <DimVeil clock={clock} beat={dim} to={dimTo} radius={CHIP_RADIUS} /> : null}
      {rim ? <PaidRim clock={clock} beat={rim} radius={CHIP_RADIUS} /> : null}
    </Animated.View>
  );
}

export default function MiniSpine({ width, maxScale = 1, animate, style, testID }: MiniSpineProps) {
  const [plan] = React.useState(() => miniPlan());
  // Plays once per mount; under Reduce Motion the clock starts past every beat (final state).
  const { clock, ink } = useSpineClock(planTotal(plan), plan.signature, animate);
  const s = Math.max(0.5, Math.min(maxScale, width / MINI_RIG.width));
  const p = plan;

  return (
    <View
      style={[{ width: MINI_RIG.width * s, height: MINI_RIG.height * s }, style]}
      pointerEvents="none"
      accessible
      accessibilityRole="image"
      accessibilityLabel={A11Y_SUMMARY}
      testID={testID}
    >
      <View
        style={[styles.rig, {
          transform: [
            { translateX: (MINI_RIG.width * s - MINI_RIG.width) / 2 },
            { translateY: (MINI_RIG.height * s - MINI_RIG.height) / 2 },
            { scale: s },
          ],
        }]}
      >
        <PaidGlow clock={clock} beat={p.glow} left={-20} top={96} width={430} height={200} />
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.14)']}
          style={[styles.track, { top: 0, height: NODE_Y[0] }]}
        />
        <View style={[styles.track, styles.trackMid, { top: NODE_Y[0], height: NODE_Y[4] - NODE_Y[0] }]} />
        <LineSegment clock={clock} beat={p.line0} x={X} top={NODE_Y[0]} height={NODE_Y[1] - NODE_Y[0]} colors="start" />
        <LineSegment clock={clock} beat={p.line1} x={X} top={NODE_Y[1]} height={NODE_Y[2] - NODE_Y[1]} colors="mid" />
        <LineSegment clock={clock} beat={p.line2} x={X} top={NODE_Y[2]} height={NODE_Y[3] - NODE_Y[2]} colors="mid" />
        <LineSegment clock={clock} beat={p.line3} x={X} top={NODE_Y[3]} height={NODE_Y[4] - NODE_Y[3]} colors="end" />

        <EndNode clock={clock} beat={p.askNode} cx={X + 1} cy={NODE_Y[0]} kind="ask" />
        <LineNode clock={clock} beat={p.node1} cx={X + 1} cy={NODE_Y[1]} size={12} />
        <LineNode clock={clock} beat={p.node2} cx={X + 1} cy={NODE_Y[2]} size={12} />
        <LineNode clock={clock} beat={p.node3} cx={X + 1} cy={NODE_Y[3]} size={12} />
        <EndNode clock={clock} beat={p.paidNode} cx={X + 1} cy={NODE_Y[4]} kind="paid" />

        <Chip clock={clock} beat={p.chip0} dim={p.dim0} dimTo={MINI_DIM[0]} top={CHIP_TOP[0]}>
          <AiBadge bare />
          <KLabel size={10.5}>Ask</KLabel>
          <Text style={styles.t} numberOfLines={1}>{ASK_ADDRESS}</Text>
        </Chip>
        <Chip clock={clock} beat={p.chip1} dim={p.dim1} dimTo={MINI_DIM[1]} top={CHIP_TOP[1]}>
          <KLabel size={10.5}>Estimate</KLabel>
          <Text style={styles.t} numberOfLines={1}>Kitchen remodel</Text>
          <Text style={styles.b}>$31,870</Text>
        </Chip>
        <Chip clock={clock} beat={p.chip2} dim={p.dim2} dimTo={MINI_DIM[2]} top={CHIP_TOP[2]}>
          <KLabel size={10.5}>Contract</KLabel>
          <View style={styles.sig}><SignatureStroke ink={ink} width={104} height={25} /></View>
          <Text style={styles.b}>Sep 4</Text>
        </Chip>
        <Chip clock={clock} beat={p.chip3} dim={p.dim3} dimTo={MINI_DIM[3]} top={CHIP_TOP[3]}>
          <KLabel size={10.5}>Schedule</KLabel>
          <Text style={styles.t} numberOfLines={1}>6 weeks</Text>
          <OnTrack />
        </Chip>
        <Chip clock={clock} beat={p.chip4} top={CHIP_TOP[4]} tall rim={p.rim}>
          <KLabel size={10.5}>Invoice #12</KLabel>
          <View style={styles.tWrap}><Text style={styles.b}>$12,400.00</Text></View>
          <PaidState clock={clock} sentOut={p.sentOut} paidIn={p.paidIn} width={62} />
        </Chip>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rig: { position: 'absolute', left: 0, top: 0, width: MINI_RIG.width, height: MINI_RIG.height },
  track: { position: 'absolute', left: X, width: 2, borderRadius: 1 },
  trackMid: { backgroundColor: 'rgba(255,255,255,0.14)' },
  chip: {
    position: 'absolute',
    left: 56,
    width: 300,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    borderRadius: CHIP_RADIUS,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 6,
  },
  t: { flex: 1, minWidth: 0, fontSize: 13, color: CARD.body },
  tWrap: { flex: 1, minWidth: 0 },
  b: { fontFamily: DISPLAY_FONT.bold, fontSize: 14, color: CARD.ink, fontVariant: ['tabular-nums'] },
  sig: { flex: 1, height: 28, justifyContent: 'center' },
});
