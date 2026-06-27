// MageIntelligence — MAGE ID's proprietary "AI" mark.
//
// Replaces the generic Sparkles/Wand/Brain cliché (used 53× across the app) that
// makes every AI feature read as a stock LLM wrapper. This is a **drafting
// compass striking a dimension arc, sparked at the pivot** — precision-
// instrument, not glitter. The two ink legs also read as an implicit A-frame,
// so it whispers "AI" as geometry, never as type; the amber 4-point spark at the
// pivot is the magic, and the struck dashed arc + amber node are real blueprint
// annotation. Mage × construction in one mark.
//
// Two-tone: `color` draws the instrument (compass legs, arc, pivot, tick),
// `accentColor` is the amber spark + node. Pass the same value for both to get a
// clean monochrome drop-in. Reads from ~14px up; scales as a square app-icon.

import React from 'react';
import Svg, { Path, Line, Circle } from 'react-native-svg';

export interface MageIntelligenceProps {
  size?: number;
  /** Instrument color (compass legs / arc / pivot). Inherit the surrounding text/accent color. */
  color?: string;
  /** The amber spark + node — the intelligence. Defaults to brand amber. */
  accentColor?: string;
}

export default function MageIntelligence({
  size = 20,
  color = '#0B0D10',
  accentColor = '#FF6A1A',
}: MageIntelligenceProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* dimension arc — the drafted / struck line */}
      <Path
        d="M4 18.5 A 8.5 8.5 0 0 1 20 18.5"
        stroke={color}
        strokeWidth={1.5}
        fill="none"
        strokeDasharray={[0.1, 3.1]}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* compass legs (thinned) — left = wand shaft, right = pencil */}
      <Line x1={12} y1={4.3} x2={6.2} y2={18.8} stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1={12} y1={4.3} x2={17.8} y2={18.8} stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      {/* pivot hinge (thinned) */}
      <Circle cx={12} cy={4.3} r={1.45} fill={color} />
      {/* amber spark at the pivot — the magic */}
      <Path d="M12 0.6 L12.8 3.5 L15.7 4.3 L12.8 5.1 L12 8 L11.2 5.1 L8.3 4.3 L11.2 3.5 Z" fill={accentColor} />
      {/* amber node on the arc — annotation */}
      <Circle cx={14.6} cy={14.4} r={1.5} fill={accentColor} />
      {/* dimension tick at the left foot — annotation */}
      <Line x1={5} y1={18.4} x2={7.4} y2={19.2} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
