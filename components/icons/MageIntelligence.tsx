// MageIntelligence — MAGE ID's proprietary "AI" mark.
//
// Replaces the generic Sparkles/Wand/Brain cliché (used 53× across the app) that
// makes every AI feature read as a stock LLM wrapper. This is a surveyor's
// reticle / level-bubble: a *precision instrument*, not a sparkle — so MAGE's
// intelligence reads as construction-grade and ours, not bolted-on.
//
// Two-tone capable: `color` draws the instrument (reticle + lens), `accentColor`
// fills the center "bubble" (the measured point / spark of intelligence). Pass
// the same value for both to get a clean monochrome drop-in. Reads from ~14–36px.

import React from 'react';
import Svg, { Circle, Line } from 'react-native-svg';

export interface MageIntelligenceProps {
  size?: number;
  /** Instrument stroke (reticle + lens). Inherit the surrounding text/accent color. */
  color?: string;
  /** The center "bubble" fill — the intelligence point. Defaults to brand amber. */
  accentColor?: string;
  strokeWidth?: number;
}

export default function MageIntelligence({
  size = 20,
  color = '#0B0D10',
  accentColor = '#FF6A1A',
  strokeWidth = 1.75,
}: MageIntelligenceProps) {
  const s = { stroke: color, strokeWidth, strokeLinecap: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* reticle ticks — N / S / W / E, the surveyor's-scope cue */}
      <Line x1={12} y1={2.5} x2={12} y2={5} {...s} />
      <Line x1={12} y1={19} x2={12} y2={21.5} {...s} />
      <Line x1={2.5} y1={12} x2={5} y2={12} {...s} />
      <Line x1={19} y1={12} x2={21.5} y2={12} {...s} />
      {/* the lens */}
      <Circle cx={12} cy={12} r={7} stroke={color} strokeWidth={strokeWidth} fill="none" />
      {/* the intelligence bubble — the measured point */}
      <Circle cx={12} cy={12} r={2.4} fill={accentColor} />
    </Svg>
  );
}
