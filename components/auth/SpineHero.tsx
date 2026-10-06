// components/auth/SpineHero.tsx — the welcome spine: one sample job, five even stops.
//
// Ask (Construction AI) → Estimate → Contract (the signature writes itself) →
// Schedule (bars grow in, Today, On track) → Paid. Every card is the same
// size, on one left edge, on an even 86-pt pitch, with each node at its card's
// center (the design's 390 × 452 rig, scaled to the room it is given). Every
// card says "Sample", and the line under the spine says to confirm
// requirements with the building department.
//
// Motion: one clock, ~6.5 s, once per mount (components/auth/spineClock.ts;
// beats in utils/auth/spineSequence.ts). Reduce Motion shows the final state.
// The rig is decoration: pointerEvents="none", one accessible summary.
import React from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { DISPLAY_FONT } from '@/constants/typography';
import {
  ASK_QUESTION, CARD_DIM, planTotal, welcomePlan, type Beat,
} from '@/utils/auth/spineSequence';
import { arriveStyle, beatValue, fadeStyle, popStyle, useSpineClock } from '@/components/auth/spineClock';
import SignatureStroke from '@/components/auth/SignatureStroke';
import {
  AiBadge, CARD, DimVeil, EndNode, KLabel, LineNode, LineSegment, OnTrack, PaidGlow, PaidRim, PaidState, SampleTag, Tick,
} from '@/components/auth/SpineParts';

/** The rig's own size, in design points. */
export const SPINE_RIG = { width: 390, height: 452 } as const;

// The rig: five stops evenly spaced. Cards are 76 pt tall on an 86 pt pitch
// (a 10 pt gap), so each node sits at its card's vertical center.
const SPINE_X = 30;
const NODE_Y = [44, 130, 216, 302, 388] as const;
const CARD_LEFT = 50;
const CARD_W = 326;
const CARD_H = 76;
const CARD_TOP = [6, 92, 178, 264, 350] as const;
const CARD_RADIUS = 14;
const INNER_W = CARD_W - 22;
const LABEL_W = 50;
const TRACK_W = INNER_W - LABEL_W;

const A11Y_SUMMARY =
  'Sample project. Ask: 418 Atlantic Ave, Brooklyn, kitchen remodel. Estimate: $31,870. ' +
  'Contract signed by Dana Ruiz. Schedule: 6 weeks, on track. Invoice #12: $12,400.00, paid. ' +
  'Sample. Confirm requirements with your building department.';

export type SpineHeroProps = {
  /** The room the rig may use; it scales down (never up past `maxScale`) to fit. */
  width: number;
  height: number;
  maxScale?: number;
  /** Tests only: force the play on or off. Real users: Reduce Motion decides. */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

function Card({ clock, beat, dim, top, children, last = false, rim }: {
  clock: Animated.Value; beat: Beat; dim: Beat | null; top: number; children: React.ReactNode; last?: boolean; rim?: Beat;
}) {
  return (
    <Animated.View style={[styles.cardWrap, { top }, arriveStyle(clock, beat)]}>
      <View style={[styles.card, last && styles.cardLast]}>
        {children}
        {dim ? <DimVeil clock={clock} beat={dim} to={CARD_DIM} radius={CARD_RADIUS} /> : null}
        {rim ? <PaidRim clock={clock} beat={rim} radius={CARD_RADIUS} /> : null}
      </View>
    </Animated.View>
  );
}

function Bar({ clock, beat, label, x, w, kind }: {
  clock: Animated.Value; beat: Beat; label: string; x: number; w: number; kind: 'done' | 'part' | 'todo';
}) {
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.barTrack}>
        <Animated.View
          style={[styles.bar, { left: x * TRACK_W, width: w * TRACK_W }, kind !== 'done' && styles.barTodo, {
            transformOrigin: 'left',
            transform: [{ scaleX: beatValue(clock, beat, 0, 1) }],
          }]}
        >
          {kind === 'part' ? <View style={styles.barPart} /> : null}
        </Animated.View>
      </View>
    </View>
  );
}

export default function SpineHero({ width, height, maxScale = 1, animate, style, testID }: SpineHeroProps) {
  const [plan] = React.useState(() => welcomePlan());
  // Plays once per mount; under Reduce Motion the clock starts past every beat (final state).
  const { clock, ink } = useSpineClock(planTotal(plan), plan.signature, animate);
  const s = Math.max(0.5, Math.min(maxScale, width / SPINE_RIG.width, height / SPINE_RIG.height));
  const p = plan;

  return (
    <View
      style={[{ width: SPINE_RIG.width * s, height: SPINE_RIG.height * s }, style]}
      pointerEvents="none"
      accessible
      accessibilityRole="image"
      accessibilityLabel={A11Y_SUMMARY}
      testID={testID}
    >
      <View
        style={[styles.rig, {
          transform: [
            { translateX: (SPINE_RIG.width * s - SPINE_RIG.width) / 2 },
            { translateY: (SPINE_RIG.height * s - SPINE_RIG.height) / 2 },
            { scale: s },
          ],
        }]}
      >
        <PaidGlow clock={clock} beat={p.glow} left={-10} top={NODE_Y[4] - 125} width={420} height={250} />

        {/* the track, then the drawn segments over it */}
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.14)']}
          style={[styles.track, { top: 0, height: NODE_Y[0] }]}
        />
        <View style={[styles.track, styles.trackMid, { top: NODE_Y[0], height: NODE_Y[4] - NODE_Y[0] }]} />
        <LineSegment clock={clock} beat={p.line0} x={SPINE_X} top={NODE_Y[0]} height={NODE_Y[1] - NODE_Y[0]} colors="start" />
        <LineSegment clock={clock} beat={p.line1} x={SPINE_X} top={NODE_Y[1]} height={NODE_Y[2] - NODE_Y[1]} colors="mid" />
        <LineSegment clock={clock} beat={p.line2} x={SPINE_X} top={NODE_Y[2]} height={NODE_Y[3] - NODE_Y[2]} colors="mid" />
        <LineSegment clock={clock} beat={p.line3} x={SPINE_X} top={NODE_Y[3]} height={NODE_Y[4] - NODE_Y[3]} colors="end" />
        <Animated.View style={[styles.tail, { top: NODE_Y[4] }, fadeStyle(clock, p.glow)]}>
          <LinearGradient colors={['#12806E', 'rgba(18,128,110,0)']} style={StyleSheet.absoluteFill} />
        </Animated.View>

        <Tick clock={clock} beat={p.askNode} left={41} cy={NODE_Y[0]} width={9} color="#5DB36E" />
        <Tick clock={clock} beat={p.node1} left={38} cy={NODE_Y[1]} width={12} />
        <Tick clock={clock} beat={p.node2} left={38} cy={NODE_Y[2]} width={12} />
        <Tick clock={clock} beat={p.node3} left={38} cy={NODE_Y[3]} width={12} />
        <Tick clock={clock} beat={p.paidNode} left={41} cy={NODE_Y[4]} width={9} color="#2BA58E" />

        <EndNode clock={clock} beat={p.askNode} cx={SPINE_X + 1} cy={NODE_Y[0]} kind="ask" />
        <LineNode clock={clock} beat={p.node1} cx={SPINE_X + 1} cy={NODE_Y[1]} />
        <LineNode clock={clock} beat={p.node2} cx={SPINE_X + 1} cy={NODE_Y[2]} />
        <LineNode clock={clock} beat={p.node3} cx={SPINE_X + 1} cy={NODE_Y[3]} />
        <EndNode clock={clock} beat={p.paidNode} cx={SPINE_X + 1} cy={NODE_Y[4]} kind="paid" />

        {/* ASK: the address types itself in, then a one-row sample answer resolves in three parts */}
        <Card clock={clock} beat={p.askCard} dim={p.dimAsk} top={CARD_TOP[0]}>
          <View style={styles.askHead}>
            <AiBadge />
            <View style={styles.askQ}>
              <Text style={styles.askQText} numberOfLines={1} ellipsizeMode="clip">{ASK_QUESTION}</Text>
              <Animated.View
                style={[styles.typeCover, {
                  transform: [{ translateX: beatValue(clock, p.askType, 0, 220, 'linear') }],
                }]}
              >
                <View style={styles.caret} />
              </Animated.View>
            </View>
          </View>
          <View style={styles.askAnswer}>
            <View style={styles.askAnsRow}>
              <Animated.Text style={[styles.ans, fadeStyle(clock, p.ans0, 4)]} numberOfLines={1}>
                <Text style={styles.ansB}>Alt-2</Text> + plumbing, electrical
              </Animated.Text>
              <Animated.Text style={[styles.ansDot, fadeStyle(clock, p.ans1)]}> · </Animated.Text>
              <Animated.Text style={[styles.ans, fadeStyle(clock, p.ans1, 4)]} numberOfLines={1}>
                <Text style={styles.ansB}>~3–6 wk</Text> review
              </Animated.Text>
              <Animated.Text style={[styles.ansDot, fadeStyle(clock, p.ans2)]}> · </Animated.Text>
              <Animated.Text style={[styles.ans, fadeStyle(clock, p.ans2, 4)]} numberOfLines={1}>
                <Text style={styles.ansB}>0</Text> open violations
              </Animated.Text>
            </View>
            <Animated.View style={popStyle(clock, p.ansTag)}>
              <SampleTag small />
            </Animated.View>
          </View>
        </Card>

        {/* ESTIMATE */}
        <Card clock={clock} beat={p.estimateCard} dim={p.dimEstimate} top={CARD_TOP[1]}>
          <View style={styles.head}><KLabel>Estimate</KLabel><SampleTag /></View>
          <View style={styles.estLine}>
            <Text style={styles.estText} numberOfLines={1}>Kitchen Remodel · 5 lines</Text>
            <Text style={styles.estAmt}>$31,870</Text>
          </View>
        </Card>

        {/* CONTRACT: Dana Ruiz's signature writes itself */}
        <Card clock={clock} beat={p.contractCard} dim={p.dimContract} top={CARD_TOP[2]}>
          <View style={styles.head}><KLabel>Contract</KLabel><SampleTag /></View>
          <View style={styles.sigBox}>
            <Text style={styles.sigX}>X</Text>
            <View style={styles.sigBase} />
            <View style={styles.sigInk}><SignatureStroke ink={ink} width={120} height={29} /></View>
            <Animated.Text style={[styles.sigBy, fadeStyle(clock, p.signedBy)]}>Dana Ruiz · Sep 4</Animated.Text>
          </View>
        </Card>

        {/* SCHEDULE: four bars grow in, then Today draws, then On track */}
        <Card clock={clock} beat={p.scheduleCard} dim={p.dimSchedule} top={CARD_TOP[3]}>
          <View style={styles.head}>
            <View style={styles.schHead}>
              <KLabel>Schedule</KLabel>
              <Text style={styles.schMeta} numberOfLines={1}>· Kitchen Remodel · 6 weeks</Text>
            </View>
            <SampleTag />
          </View>
          <View style={styles.gantt}>
            {[1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={[styles.week, { left: LABEL_W + (TRACK_W * i) / 6 }]} />
            ))}
            <Bar clock={clock} beat={p.bar0} label="Demo" x={0} w={0.17} kind="done" />
            <Bar clock={clock} beat={p.bar1} label="Rough-in" x={0.15} w={0.32} kind="done" />
            <Bar clock={clock} beat={p.bar2} label="Drywall" x={0.45} w={0.26} kind="part" />
            <Bar clock={clock} beat={p.bar3} label="Finishes" x={0.7} w={0.3} kind="todo" />
            <Animated.View
              style={[styles.now, { left: LABEL_W + TRACK_W * 0.5 - 0.75 }, {
                transformOrigin: 'top',
                transform: [{ scaleY: beatValue(clock, p.today, 0, 1) }],
              }]}
            />
            <Animated.Text style={[styles.nowLabel, { right: TRACK_W * 0.5 + 4 }, fadeStyle(clock, p.todayLabel)]}>
              Today
            </Animated.Text>
            <Animated.View style={[styles.okAt, popStyle(clock, p.onTrack)]}>
              <OnTrack compact />
            </Animated.View>
          </View>
        </Card>

        {/* PAID: the invoice lands nearest, turns Paid, teal light rises under it */}
        <Card clock={clock} beat={p.paidCard} dim={null} top={CARD_TOP[4]} last rim={p.rim}>
          <View style={styles.head}>
            <KLabel>Invoice #12</KLabel>
            <PaidState clock={clock} sentOut={p.sentOut} paidIn={p.paidIn} />
          </View>
          <View style={styles.invLine}>
            <Text style={styles.invAmt}>$12,400.00</Text>
            <View style={styles.invRight}>
              <Text style={styles.invMeta} numberOfLines={1}>Progress billing, 2 of 4</Text>
              <SampleTag small />
            </View>
          </View>
        </Card>

        <Animated.Text style={[styles.fine, fadeStyle(clock, p.fine)]} numberOfLines={1}>
          Sample. Confirm requirements with your building department.
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rig: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: SPINE_RIG.width,
    height: SPINE_RIG.height,
  },
  track: { position: 'absolute', left: SPINE_X, width: 2, borderRadius: 1 },
  trackMid: { backgroundColor: 'rgba(255,255,255,0.14)' },
  tail: { position: 'absolute', left: SPINE_X, width: 2, height: 40, borderRadius: 1, overflow: 'hidden' },
  cardWrap: {
    position: 'absolute',
    left: CARD_LEFT,
    width: CARD_W,
    height: CARD_H,
  },
  card: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: CARD_RADIUS,
    backgroundColor: '#FFFFFF',
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 22,
    elevation: 8,
  },
  cardLast: { shadowOpacity: 0.7 },
  head: { height: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  askHead: { height: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
  askQ: { flex: 1, minWidth: 0, height: 20, justifyContent: 'center', overflow: 'hidden' },
  askQText: { fontFamily: DISPLAY_FONT.semibold, fontSize: 10.5, color: CARD.ink },
  typeCover: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 240, backgroundColor: '#FFFFFF',
  },
  caret: { position: 'absolute', left: 0, top: 4, width: 1.5, height: 12, borderRadius: 1, backgroundColor: CARD.brand },
  askAnswer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: CARD.rule,
  },
  askAnsRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  ans: { fontFamily: DISPLAY_FONT.semibold, fontSize: 9.5, lineHeight: 14, color: CARD.tagInk },
  ansB: { color: CARD.ink },
  ansDot: { fontFamily: DISPLAY_FONT.semibold, fontSize: 9.5, lineHeight: 14, color: CARD.faint },
  estLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 7,
    borderTopWidth: 1.5,
    borderTopColor: CARD.ink,
  },
  estText: { fontSize: 12.5, color: CARD.body, flexShrink: 1 },
  estAmt: { fontFamily: DISPLAY_FONT.bold, fontSize: 17, color: CARD.ink, fontVariant: ['tabular-nums'] },
  sigBox: {
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F1F3EE',
    borderWidth: 1,
    borderColor: '#E1E4DD',
  },
  sigX: { position: 'absolute', left: 8, top: 9, fontFamily: DISPLAY_FONT.semibold, fontSize: 12, color: CARD.faint },
  sigBase: { position: 'absolute', left: 7, right: 7, bottom: 6, height: 1, backgroundColor: '#C6CCC3' },
  sigInk: { position: 'absolute', left: 21, top: 2 },
  sigBy: { position: 'absolute', right: 8, bottom: 9, fontFamily: DISPLAY_FONT.semibold, fontSize: 10.5, color: CARD.mute },
  schHead: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  schMeta: { fontSize: 11, color: CARD.mute, flexShrink: 1 },
  gantt: { height: 37, justifyContent: 'space-between' },
  week: { position: 'absolute', top: -3, bottom: -3, width: 1, backgroundColor: '#E2E5DF' },
  barRow: { height: 7, flexDirection: 'row', alignItems: 'center' },
  barLabel: { width: LABEL_W, fontFamily: DISPLAY_FONT.semibold, fontSize: 9, lineHeight: 9, color: CARD.mute },
  barTrack: { width: TRACK_W, height: 7 },
  bar: { position: 'absolute', top: 0.5, height: 6, borderRadius: 2, backgroundColor: CARD.brand, overflow: 'hidden' },
  barTodo: { backgroundColor: CARD.brandSoft },
  barPart: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '20%', backgroundColor: CARD.brand },
  now: { position: 'absolute', top: -4, bottom: -4, width: 1.5, borderRadius: 1, backgroundColor: CARD.teal },
  nowLabel: {
    position: 'absolute', top: 0, fontFamily: DISPLAY_FONT.semibold, fontSize: 8.5, lineHeight: 8, letterSpacing: 0.2, color: CARD.tealInk,
  },
  okAt: { position: 'absolute', right: 0, top: 0 },
  invLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  invAmt: { fontFamily: DISPLAY_FONT.bold, fontSize: 22, letterSpacing: -0.44, color: CARD.ink, fontVariant: ['tabular-nums'] },
  invRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  invMeta: { fontSize: 11.5, color: CARD.mute, flexShrink: 1 },
  fine: {
    position: 'absolute',
    left: CARD_LEFT,
    top: 436,
    fontSize: 10,
    lineHeight: 13,
    color: 'rgba(255,255,255,0.55)',
  },
});
