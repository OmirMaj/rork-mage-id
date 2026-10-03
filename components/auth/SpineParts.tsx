// components/auth/SpineParts.tsx — small pieces shared by the welcome spine and the mini spine.
//
// The card label, the "Sample" tag, the Sent → Paid state, the spine's line
// segments, its nodes and its ticks. Every moving part reads the spine clock
// (components/auth/spineClock.ts) through a beat of the plan.
import React from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Check, Sparkles } from 'lucide-react-native';
import { DISPLAY_FONT } from '@/constants/typography';
import type { Beat } from '@/utils/auth/spineSequence';
import { beatValue, fadeStyle } from '@/components/auth/spineClock';

/** The sample palette: ink and greys on the white sample cards. */
export const CARD = {
  ink: '#151816',
  body: '#3C433E',
  mute: '#5B625D',
  faint: '#9AA19C',
  rule: '#E2E4DF',
  brand: '#2F6B3A',
  brandSoft: '#BFDCC4',
  teal: '#12806E',
  tealSoft: '#E1F1EC',
  tealInk: '#0E6B5C',
  tagBg: '#ECEDE9',
  tagInk: '#4A524C',
  dim: '#06100A',
} as const;

export function KLabel({ children, size = 11 }: { children: string; size?: number }) {
  return <Text style={[styles.k, { fontSize: size }]} numberOfLines={1}>{children}</Text>;
}

/** "Sample": every card on the spine carries it. */
export function SampleTag({ small = false, style }: { small?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.tag, small && styles.tagSmall, style]}>
      <Text style={[styles.tagText, small && styles.tagTextSmall]}>Sample</Text>
    </View>
  );
}

/** The Construction AI badge (brand green, the Sparkles glyph). `bare` shows the glyph only. */
export function AiBadge({ bare = false }: { bare?: boolean }) {
  return (
    <View style={[styles.ai, bare && styles.aiBare]}>
      <Sparkles size={bare ? 12 : 11} color="#FFFFFF" strokeWidth={2} />
      {bare ? null : <Text style={styles.aiText} numberOfLines={1}>Construction AI</Text>}
    </View>
  );
}

/** Invoice state: Sent leaves upward as Paid arrives, at the flip. */
export function PaidState({ clock, sentOut, paidIn, width = 70 }: {
  clock: Animated.Value; sentOut: Beat; paidIn: Beat; width?: number;
}) {
  return (
    <View style={{ width, height: 22 }}>
      <Animated.View
        style={[styles.st, styles.stSent, {
          opacity: beatValue(clock, sentOut, 1, 0, 'linear'),
          transform: [{ translateY: beatValue(clock, sentOut, 0, -8, 'linear') }],
        }]}
      >
        <Text style={[styles.stText, { color: CARD.tagInk }]}>Sent</Text>
      </Animated.View>
      <Animated.View
        style={[styles.st, styles.stPaid, {
          opacity: beatValue(clock, paidIn, 0, 1),
          transform: [{ translateY: beatValue(clock, paidIn, 8, 0) }, { scale: beatValue(clock, paidIn, 0.85, 1) }],
        }]}
      >
        <Check size={12} color="#FFFFFF" strokeWidth={2.6} />
        <Text style={[styles.stText, { color: '#FFFFFF' }]}>Paid</Text>
      </Animated.View>
    </View>
  );
}

/** "On track": the teal state on the sample schedule. */
export function OnTrack({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.ok, compact && styles.okCompact]}>
      <View style={[styles.okDot, compact && styles.okDotCompact]} />
      <Text style={[styles.okText, compact && styles.okTextCompact]}>On track</Text>
    </View>
  );
}

// ── The line ──────────────────────────────────────────────────────────────

/** One drawn segment of the spine: grows downward from its top over its beat. */
export function LineSegment({ clock, beat, x, top, height, colors }: {
  clock: Animated.Value; beat: Beat; x: number; top: number; height: number; colors: 'start' | 'mid' | 'end';
}) {
  const fill = colors === 'start' ? '#A4DAAE' : colors === 'end' ? '#2BA58E' : '#B9E4C1';
  return (
    <Animated.View
      style={{
        position: 'absolute', left: x, top, width: 2, height, borderRadius: 1, backgroundColor: fill,
        transformOrigin: 'top',
        transform: [{ scaleY: beatValue(clock, beat, 0, 1, 'sine') }],
      }}
    />
  );
}

/** A plain node on the line: a dark ring whose light center pops in when the line arrives. */
export function LineNode({ clock, beat, cx, cy, size = 14 }: {
  clock: Animated.Value; beat: Beat; cx: number; cy: number; size?: number;
}) {
  const inset = size > 13 ? 3 : 2.5;
  return (
    <View style={[styles.nd, { left: cx - size / 2, top: cy - size / 2, width: size, height: size, borderRadius: size / 2 }]}>
      <Animated.View
        style={[styles.ndIn, { top: inset - 1.5, left: inset - 1.5, right: inset - 1.5, bottom: inset - 1.5 }, {
          opacity: beatValue(clock, beat, 0, 1), transform: [{ scale: beatValue(clock, beat, 0.9, 1) }],
        }]}
      />
    </View>
  );
}

/** The first node (Ask, green, Sparkles) or the last (Paid, teal, a check). */
export function EndNode({ clock, beat, cx, cy, kind }: {
  clock: Animated.Value; beat: Beat; cx: number; cy: number; kind: 'ask' | 'paid';
}) {
  const ask = kind === 'ask';
  return (
    <Animated.View
      style={[styles.endNode, ask ? styles.askNode : styles.paidNode, { left: cx - 10, top: cy - 10 }, {
        opacity: beatValue(clock, beat, 0, 1),
        transform: [{ scale: beatValue(clock, { at: beat.at, dur: beat.dur }, 0.4, 1) }],
      }]}
    >
      {ask
        ? <Sparkles size={12} color="#FFFFFF" strokeWidth={2} />
        : <Check size={12} color="#FFFFFF" strokeWidth={3} />}
    </Animated.View>
  );
}

/** A tick from the line to the cards' shared left edge. */
export function Tick({ clock, beat, left, cy, width, color = 'rgba(255,255,255,0.28)' }: {
  clock: Animated.Value; beat: Beat; left: number; cy: number; width: number; color?: string;
}) {
  return (
    <Animated.View
      style={{
        position: 'absolute', left, top: cy - 0.75, width, height: 1.5, backgroundColor: color,
        transformOrigin: 'left',
        transform: [{ scaleX: beatValue(clock, beat, 0, 1) }],
      }}
    />
  );
}

/** The teal light that rises under Paid (concentric ellipses: a soft radial). */
export function PaidGlow({ clock, beat, left, top, width, height }: {
  clock: Animated.Value; beat: Beat; left: number; top: number; width: number; height: number;
}) {
  const rings = [1, 0.78, 0.56, 0.36];
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', left, top, width, height }, {
        opacity: beatValue(clock, beat, 0, 1),
        transform: [{ translateY: beatValue(clock, beat, 64, 0) }, { scale: beatValue(clock, beat, 0.84, 1) }],
      }]}
    >
      {rings.map((r) => (
        <View
          key={r}
          style={{
            position: 'absolute', left: (width * (1 - r)) / 2, top: (height * (1 - r)) / 2,
            width: width * r, height: height * r, borderRadius: (width * r) / 2,
            backgroundColor: CARD.teal, opacity: 0.11,
          }}
        />
      ))}
    </Animated.View>
  );
}

/** A dim veil over a card or chip, deepening to `to` as the line leaves it. */
export function DimVeil({ clock, beat, to, radius }: { clock: Animated.Value; beat: Beat; to: number; radius: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: CARD.dim }, {
        opacity: beatValue(clock, beat, 0, to, 'linear'),
      }]}
    />
  );
}

/** The teal rim the paid card or chip lights with. */
export function PaidRim({ clock, beat, radius }: { clock: Animated.Value; beat: Beat; radius: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.rim, { borderRadius: radius }, fadeStyle(clock, beat)]}
    />
  );
}

const styles = StyleSheet.create({
  k: {
    fontFamily: DISPLAY_FONT.semibold,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: CARD.brand,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 99,
    backgroundColor: CARD.tagBg,
  },
  tagSmall: { paddingHorizontal: 5, paddingVertical: 3 },
  tagText: { fontFamily: DISPLAY_FONT.semibold, fontSize: 10.5, color: CARD.tagInk },
  tagTextSmall: { fontSize: 9 },
  ai: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 6,
    paddingRight: 7,
    borderRadius: 99,
    backgroundColor: CARD.brand,
  },
  aiBare: { paddingHorizontal: 6, gap: 0 },
  aiText: { fontFamily: DISPLAY_FONT.semibold, fontSize: 10, color: '#FFFFFF' },
  st: {
    position: 'absolute',
    right: 0,
    top: 0,
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    borderRadius: 99,
  },
  stSent: { backgroundColor: CARD.tagBg },
  stPaid: { backgroundColor: CARD.teal },
  stText: { fontFamily: DISPLAY_FONT.semibold, fontSize: 11.5 },
  ok: {
    height: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 7,
    paddingRight: 8,
    borderRadius: 99,
    backgroundColor: CARD.tealSoft,
  },
  okCompact: { height: 15, paddingLeft: 5, paddingRight: 6 },
  okDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: CARD.teal },
  okDotCompact: { width: 5, height: 5, borderRadius: 2.5 },
  okText: { fontFamily: DISPLAY_FONT.semibold, fontSize: 11, color: CARD.tealInk },
  okTextCompact: { fontSize: 9.5 },
  nd: {
    position: 'absolute',
    backgroundColor: '#132419',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.36)',
  },
  ndIn: { position: 'absolute', borderRadius: 99, backgroundColor: '#B9E4C1' },
  endNode: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  askNode: {
    backgroundColor: CARD.brand,
    borderWidth: 3,
    borderColor: 'rgba(93,179,110,0.45)',
  },
  paidNode: {
    backgroundColor: CARD.teal,
    borderWidth: 3,
    borderColor: 'rgba(43,165,142,0.5)',
  },
  rim: {
    borderWidth: 1.5,
    borderColor: '#2BA58E',
    shadowColor: CARD.teal,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 16,
  },
});
