// MageAIMark — the STATIC MAGE-AI glyph for inline icon spots (the end-frame of
// the crane animation, minus the crane). The "A" is an A-frame, the "I" a steel
// I-beam, crowned by the amber spark — the bespoke replacement for the generic
// Sparkles / Wand2 / Zap / BrainCircuit / Lightbulb / Bot clichés used 53× today.
//
// Drop-in for a lucide icon: takes `size` + `color` (the structure), plus
// `accentColor` for the spark (defaults to brand amber). For a flat monochrome
// look pass the same value for both. Reads from ~14px up.

import React from 'react';
import Svg, { Line, Path } from 'react-native-svg';

export interface MageAIMarkProps {
  size?: number;
  /** The "AI" structure color. Inherit the surrounding text/icon color. */
  color?: string;
  /** The crowning spark. Defaults to brand amber. */
  accentColor?: string;
}

export default function MageAIMark({
  size = 20,
  color = '#0B0D10',
  accentColor = '#FF6A1A',
}: MageAIMarkProps) {
  const s = { stroke: color, strokeWidth: 2.1, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* A — A-frame */}
      <Line x1={2.5} y1={21} x2={6.75} y2={6.5} {...s} />
      <Line x1={11} y1={21} x2={6.75} y2={6.5} {...s} />
      <Line x1={4.4} y1={14.5} x2={9.1} y2={14.5} {...s} />
      {/* I — steel I-beam */}
      <Line x1={14.5} y1={8} x2={22} y2={8} {...s} />
      <Line x1={18.25} y1={8} x2={18.25} y2={21} {...s} />
      <Line x1={14.5} y1={21} x2={22} y2={21} {...s} />
      {/* amber spark, on the A's apex */}
      <Path d="M6.75 0 L7.6 2.7 L10.3 3.5 L7.6 4.3 L6.75 7 L5.9 4.3 L3.2 3.5 L5.9 2.7 Z" fill={accentColor} />
    </Svg>
  );
}
