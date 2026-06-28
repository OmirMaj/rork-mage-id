// MAGE bespoke construction glyph set (icon-audit §4). Trade-true marks for the
// brand-defining surfaces — the tab bar and the core domain documents — so RFI,
// Submittal, Pay App, etc. stop all rendering the same generic FileText and the
// nav stops looking like a fintech demo.
//
// Every glyph is a forwardRef accepting LucideProps (+ optional accentColor), so
// each is a drop-in for a lucide icon — JSX or icon-reference. `color` draws the
// structure, `accentColor` the amber detail. Stroke 1.75 to match the app.

import React from 'react';
import Svg, { Line, Path, Rect, Circle, Polyline, Polygon } from 'react-native-svg';
import type { LucideProps } from 'lucide-react-native';

export interface MageGlyphProps extends LucideProps {
  accentColor?: string;
}

type RenderArgs = { c: string; a: string; w: number };

function glyph(render: (args: RenderArgs) => React.ReactNode) {
  const C = React.forwardRef<React.ComponentRef<typeof Svg>, MageGlyphProps>(
    ({ size = 24, color = '#0B0D10', accentColor = '#FF6A1A', strokeWidth = 1.75 }, ref) => (
      <Svg ref={ref} width={size} height={size} viewBox="0 0 24 24" fill="none">
        {render({ c: color as string, a: accentColor, w: Number(strokeWidth) || 1.75 })}
      </Svg>
    ),
  );
  return C;
}

const cap = { strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

// ── Tab bar ───────────────────────────────────────────────────────────────

// Projects — a framed structure (roof line + stud wall) on a slab.
export const MageProject = glyph(({ c, w }) => (
  <>
    <Polyline points="3.5,11 12,4 20.5,11" stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Line x1={4.5} y1={11} x2={4.5} y2={20} stroke={c} strokeWidth={w} {...cap} />
    <Line x1={19.5} y1={11} x2={19.5} y2={20} stroke={c} strokeWidth={w} {...cap} />
    <Line x1={12} y1={11.5} x2={12} y2={20} stroke={c} strokeWidth={w} {...cap} />
    <Line x1={3} y1={20} x2={21} y2={20} stroke={c} strokeWidth={w} {...cap} />
  </>
));

// Discover — a carpenter's level with an amber bubble (finding true).
export const MageDiscover = glyph(({ c, a, w }) => (
  <>
    <Rect x={2.5} y={8.5} width={19} height={7} rx={1.6} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Line x1={8} y1={11} x2={8} y2={13} stroke={c} strokeWidth={w} {...cap} />
    <Line x1={16} y1={11} x2={16} y2={13} stroke={c} strokeWidth={w} {...cap} />
    <Circle cx={12} cy={12} r={1.7} fill={a} />
  </>
));

// Summary — stacked WIP bars rising, amber cap on the tallest.
export const MageSummary = glyph(({ c, a, w }) => (
  <>
    <Line x1={3.5} y1={20.5} x2={20.5} y2={20.5} stroke={c} strokeWidth={w} {...cap} />
    <Rect x={5} y={13} width={3.4} height={7.5} rx={0.8} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Rect x={10.3} y={9} width={3.4} height={11.5} rx={0.8} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Rect x={15.6} y={5} width={3.4} height={15.5} rx={0.8} stroke={a} strokeWidth={w} fill="none" {...cap} />
  </>
));

// ── Core documents (kills the triple-FileText) ─────────────────────────────

const docFold = (c: string, w: number) => (
  <>
    <Path d="M6 3 H14 L18 7 V20 A1 1 0 0 1 17 21 H7 A1 1 0 0 1 6 20 Z" stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Polyline points="14,3 14,7 18,7" stroke={c} strokeWidth={w} fill="none" {...cap} />
  </>
);

// RFI — a document asking a question.
export const MageRFI = glyph(({ c, a, w }) => (
  <>
    {docFold(c, w)}
    <Path d="M10.4 12 a1.6 1.6 0 0 1 3.2 0 c0 1.2 -1.6 1.4 -1.6 2.6" stroke={a} strokeWidth={w} fill="none" {...cap} />
    <Circle cx={12} cy={17.6} r={0.7} fill={a} />
  </>
));

// Submittal — a stamped/approved sheet.
export const MageSubmittal = glyph(({ c, a, w }) => (
  <>
    {docFold(c, w)}
    <Circle cx={12} cy={14} r={3.1} stroke={a} strokeWidth={w} fill="none" />
    <Polyline points="10.5,14 11.6,15.1 13.6,12.9" stroke={a} strokeWidth={w} fill="none" {...cap} />
  </>
));

// AIA Pay App — a lined G703 sheet with an amber total row.
export const MagePayApp = glyph(({ c, a, w }) => (
  <>
    {docFold(c, w)}
    <Line x1={8.5} y1={11.5} x2={15.5} y2={11.5} stroke={c} strokeWidth={w * 0.85} {...cap} />
    <Line x1={8.5} y1={14.2} x2={15.5} y2={14.2} stroke={c} strokeWidth={w * 0.85} {...cap} />
    <Line x1={8.5} y1={17.2} x2={15.5} y2={17.2} stroke={a} strokeWidth={w} {...cap} />
  </>
));

// Change Order — a document carrying a delta.
export const MageChangeOrder = glyph(({ c, a, w }) => (
  <>
    {docFold(c, w)}
    <Polygon points="12,10.5 15,17 9,17" stroke={a} strokeWidth={w} fill="none" {...cap} />
  </>
));

// ── Domain ─────────────────────────────────────────────────────────────────

// Takeoff — a measured area with dimension ticks.
export const MageTakeoff = glyph(({ c, a, w }) => (
  <>
    <Rect x={4.5} y={4.5} width={15} height={10} rx={1} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Line x1={4.5} y1={20} x2={19.5} y2={20} stroke={a} strokeWidth={w} {...cap} />
    <Line x1={4.5} y1={18.5} x2={4.5} y2={21.5} stroke={a} strokeWidth={w} {...cap} />
    <Line x1={19.5} y1={18.5} x2={19.5} y2={21.5} stroke={a} strokeWidth={w} {...cap} />
  </>
));

// Schedule — gantt bars + an amber milestone diamond.
export const MageSchedule = glyph(({ c, a, w }) => (
  <>
    <Rect x={3.5} y={5.5} width={8} height={2.6} rx={1.3} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Rect x={7} y={10.7} width={9} height={2.6} rx={1.3} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Rect x={5} y={15.9} width={6.5} height={2.6} rx={1.3} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Polygon points="18.5,15.4 20.6,17.2 18.5,19 16.4,17.2" fill={a} />
  </>
));

// Estimate — a line-item grid with an amber running total.
export const MageEstimate = glyph(({ c, a, w }) => (
  <>
    <Rect x={4} y={4} width={16} height={16} rx={2} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Line x1={4} y1={9.5} x2={20} y2={9.5} stroke={c} strokeWidth={w * 0.85} {...cap} />
    <Line x1={13.5} y1={4} x2={13.5} y2={15} stroke={c} strokeWidth={w * 0.85} {...cap} />
    <Line x1={4} y1={15} x2={20} y2={15} stroke={c} strokeWidth={w * 0.85} {...cap} />
    <Line x1={7} y1={17.6} x2={17} y2={17.6} stroke={a} strokeWidth={w} {...cap} />
  </>
));

// Margin / Risk — a gauge needle swung into the amber band.
export const MageMargin = glyph(({ c, a, w }) => (
  <>
    <Path d="M4 17 A8 8 0 0 1 20 17" stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Path d="M14.5 9.2 A8 8 0 0 1 20 17" stroke={a} strokeWidth={w} fill="none" {...cap} />
    <Line x1={12} y1={17} x2={15.5} y2={12.5} stroke={c} strokeWidth={w} {...cap} />
    <Circle cx={12} cy={17} r={1.5} fill={c} />
  </>
));

// Plans — a rolled blueprint with a pin.
export const MagePlans = glyph(({ c, a, w }) => (
  <>
    <Path d="M5 6 a2 2 0 0 1 4 0 V18 a2 2 0 0 1 -4 0" stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Line x1={9} y1={6} x2={19} y2={6} stroke={c} strokeWidth={w} {...cap} />
    <Line x1={9} y1={18} x2={19} y2={18} stroke={c} strokeWidth={w} {...cap} />
    <Line x1={13} y1={10.5} x2={17} y2={10.5} stroke={c} strokeWidth={w * 0.85} {...cap} />
    <Circle cx={16.5} cy={14} r={1.6} fill={a} />
  </>
));

// Cost Database — stacked price tags / a ledger spine.
export const MageCostDb = glyph(({ c, a, w }) => (
  <>
    <Path d="M4 8 L11 8 L19 16 L15 20 L7 12 Z" stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Circle cx={8} cy={12} r={1.3} fill={a} />
  </>
));

// Materials — stacked brick / pallet.
export const MageMaterials = glyph(({ c, w }) => (
  <>
    <Rect x={3.5} y={6} width={7} height={5} rx={0.8} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Rect x={13.5} y={6} width={7} height={5} rx={0.8} stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Rect x={8.5} y={13} width={7} height={5} rx={0.8} stroke={c} strokeWidth={w} fill="none" {...cap} />
  </>
));

// Equipment — a forklift silhouette.
export const MageEquipment = glyph(({ c, a, w }) => (
  <>
    <Path d="M4 5 V14 H13" stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Path d="M4 14 H10 V17.5 H6 A2 2 0 0 1 4 15.5 Z" stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Line x1={13} y1={5} x2={13} y2={16} stroke={c} strokeWidth={w} {...cap} />
    <Line x1={13} y1={16} x2={20} y2={16} stroke={a} strokeWidth={w} {...cap} />
    <Circle cx={8} cy={19} r={1.6} stroke={c} strokeWidth={w} fill="none" />
    <Circle cx={15.5} cy={19} r={1.6} stroke={c} strokeWidth={w} fill="none" />
  </>
));

// Punch list — a checklist with a dropped pin.
export const MagePunch = glyph(({ c, a, w }) => (
  <>
    <Polyline points="4,6.5 5.4,7.9 7.4,5.5" stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Polyline points="4,13 5.4,14.4 7.4,12" stroke={c} strokeWidth={w} fill="none" {...cap} />
    <Line x1={10} y1={6.7} x2={20} y2={6.7} stroke={c} strokeWidth={w} {...cap} />
    <Line x1={10} y1={13.2} x2={17} y2={13.2} stroke={c} strokeWidth={w} {...cap} />
    <Path d="M16 16.5 C18.2 16.5 19.2 18.2 18.9 19.8 C18.6 21.4 17 22.4 16 24 C15 22.4 13.4 21.4 13.1 19.8 C12.8 18.2 13.8 16.5 16 16.5 Z" fill={a} />
  </>
));
