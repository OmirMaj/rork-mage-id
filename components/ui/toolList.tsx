// components/ui/toolList.tsx — "Plain trade": the one treatment for every list
// of tools / features (Discover > Tools, the project page's tile groups and
// field action row, Home's Ask section, the Create sheet).
//
// WHY THIS EXISTS (2026-10-05, founder pick: direction A + B's locked hatch).
// The same atom was drawn 5+ ways: a pastel rounded square (28 / 32 / 36 / 40 /
// 48 pt, radii 8-14) holding a line icon (16-22 pt, strokes 1.6-2.5) in a hue
// picked by hand per row. "Photo triage" was blue, "Punch list" green, "Change
// orders" teal — a colour that told the contractor nothing — and the bespoke
// MAGE glyphs drew their detail in brand green on top, so a blue chip carried a
// green question mark. That chip is the generated-app look.
//
// THE RULE (pinned by scripts/validate-tool-list.ts — bun run test:tool-list):
//   - No container. The glyph sits in a fixed 24 pt column on the ground it is
//     on. No chip, no tint, no card around a row.
//   - One glyph: 24 pt, stroke 2.0, lucide and MAGE glyphs alike, in ink
//     (`t.text`) — the bespoke glyphs' detail too (toolGlyphInk). A row can
//     not choose a hue.
//   - Rows are separated by a 1 pt hairline (ink at 18%, 14% in dark).
//   - A group opens with a title block: 2 pt ink rule, mono sheet number, the
//     name in Barlow caps, mono count.
//   - Counts that matter are set in Barlow 600 18 pt at the right edge.
//   - Green appears only on the ONE primary action and on the pressed / active
//     state. It is never a background here.
//   - State colours stay on status WORDS (pending, overdue, signed).
//   - A locked tool is hatched at 45 degrees (a drawing's "not in contract"
//     hatch), its glyph drops to muted ink, and the row says why in words.
//
// Everything here is JS + react-native-svg (already shipped) — OTA-safe.

import React, { memo } from 'react';
import { View, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Lock } from 'lucide-react-native';
import { DISPLAY_FONT, Type } from '@/constants/typography';
import { useTheme } from '@/contexts/ThemeContext';
import type { ThemeColors } from '@/constants/colors';

/** The one glyph size in a tool list. */
export const TOOL_GLYPH_SIZE = 24;
/** The one stroke in a tool list — lucide and MAGE glyphs alike. */
export const TOOL_GLYPH_STROKE = 2;
/** Trailing chevron: 16 pt, muted ink at half strength. */
export const TOOL_CHEVRON_SIZE = 16;
export const TOOL_CHEVRON_OPACITY = 0.5;

export type ToolIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/**
 * The bespoke MAGE glyphs (and the AI mark) draw a DETAIL in a second ink —
 * brand green by default. In a tool list that detail takes the glyph's own
 * ink: spread this next to `color`. Lucide icons carry no `acceptsAccent`
 * flag, get nothing, and so are never handed a prop they do not know.
 */
export function toolGlyphInk(Icon: ToolIcon, ink: string): { accentColor: string } | null {
  return (Icon as { acceptsAccent?: boolean }).acceptsAccent ? { accentColor: ink } : null;
}

/** `t.text` is a light colour only in the dark theme. */
function isDarkGround(t: ThemeColors): boolean {
  const m = /^#([0-9a-fA-F]{2})/.exec(t.text);
  return !!m && parseInt(m[1], 16) > 128;
}

/**
 * The hairline between rows: ink at 18% on a light ground, 14% on dark. An
 * 8-digit hex, because `t.text` is a solid hex in both themes (an alpha suffix
 * on an rgba() token is silently dropped by RN's normalizeColor).
 */
export function toolRule(t: ThemeColors): string {
  return t.text + (isDarkGround(t) ? '24' : '2E');
}

/** The trailing chevron's colour (muted ink; pair with TOOL_CHEVRON_OPACITY). */
export function toolChevronColor(t: ThemeColors): string {
  return t.textMuted;
}

/**
 * Style fragments, for screens that keep their own pressable (the project
 * page's HardHatTap tiles, the Create sheet's keyboard rows). Spread these
 * rather than re-typing the numbers.
 */
export function toolListStyles(t: ThemeColors) {
  return {
    /** A row: glyph column, body, trailing. No surface, hairline on top. */
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 14,
      paddingVertical: 12,
      paddingHorizontal: 2,
      borderTopWidth: 1,
      borderTopColor: toolRule(t),
    },
    /** The dense row (project page, Create sheet): 11 pt pad, 16 pt name. */
    rowTight: { paddingVertical: 11 },
    /** Pressed: the row fills surfaceAlt and bleeds 8 pt past the column. */
    rowPressed: { backgroundColor: t.surfaceAlt, marginHorizontal: -8, paddingHorizontal: 10 },
    body: { flex: 1, minWidth: 0 },
    name: { fontSize: Type.headline.fontSize, lineHeight: Type.headline.lineHeight, fontWeight: '600' as const, color: t.text },
    nameTight: { fontSize: Type.callout.fontSize, lineHeight: Type.callout.lineHeight },
    desc: { fontSize: Type.footnote.fontSize, lineHeight: Type.footnote.lineHeight, color: t.textSecondary },
    /** A status WORD under the name. The caller supplies the state colour. */
    status: { fontSize: Type.caption1.fontSize, lineHeight: 15, fontWeight: '600' as const },
    /** A count that matters: Barlow 600 18 pt, tabular. */
    count: {
      fontFamily: DISPLAY_FONT.semibold,
      fontSize: Type.subheadline.fontSize,
      lineHeight: 22,
      color: t.text,
      fontVariant: ['tabular-nums' as const],
    },
    /** Mono tier tag at the right of a locked row. */
    tag: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
    tagText: {
      fontFamily: Type.monoLabel.fontFamily,
      fontSize: Type.monoLabel.fontSize,
      lineHeight: 12,
      letterSpacing: 0.8,
      textTransform: 'uppercase' as const,
      color: t.textMuted,
    },
    /** Title block: 2 pt ink rule, then number / name / count on one line. */
    header: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
      borderTopWidth: 2,
      borderTopColor: t.text,
      paddingTop: 8,
      paddingBottom: 9,
    },
    headerMono: {
      fontFamily: Type.monoLabel.fontFamily,
      fontSize: Type.monoEyebrow.fontSize,
      lineHeight: 14,
      letterSpacing: 0.44,
      color: t.textMuted,
    },
    headerLabel: {
      flex: 1,
      fontFamily: DISPLAY_FONT.semibold,
      fontSize: Type.subhead.fontSize,
      lineHeight: 18,
      letterSpacing: 1.5,
      textTransform: 'uppercase' as const,
      color: t.text,
    },
    /** A strip of equal action columns under one 2 pt rule (the field row). */
    strip: {
      flexDirection: 'row' as const,
      borderTopWidth: 2,
      borderTopColor: t.text,
      borderBottomWidth: 1,
      borderBottomColor: toolRule(t),
    },
    stripCell: {
      flexBasis: 0,
      flexGrow: 1,
      flexDirection: 'column' as const,
      alignItems: 'center' as const,
      justifyContent: 'flex-start' as const,
      gap: 7,
      paddingTop: 13,
      paddingBottom: 11,
      borderLeftWidth: 1,
      borderLeftColor: toolRule(t),
    },
    stripCellFirst: { borderLeftWidth: 0 },
    /** The ONE primary action: a 2 pt green rule over the ink one. */
    stripPrimaryRule: { position: 'absolute' as const, left: 0, right: 0, top: -2, height: 2, backgroundColor: t.accent },
    stripLabel: { fontSize: 11.5, lineHeight: 14, fontWeight: '600' as const, textAlign: 'center' as const, color: t.text },
  };
}

// ── The locked hatch ────────────────────────────────────────────────────────
// 45 degree lines across a square a little larger than the glyph. One <Path>,
// segments clipped by arithmetic (no <ClipPath>: one node in every snapshot,
// and no id to collide between rows).
const HATCH_BOX = 32;
const HATCH_PITCH = 5.5;
const HATCH_D = (() => {
  const S = HATCH_BOX;
  const parts: string[] = [];
  for (let k = HATCH_PITCH; k < 2 * S; k += HATCH_PITCH) {
    const x1 = Math.max(0, k - S);
    const y1 = Math.min(k, S);
    const x2 = Math.min(k, S);
    const y2 = Math.max(0, k - S);
    parts.push(`M${x1} ${y1}L${x2} ${y2}`);
  }
  return parts.join('');
})();

const hatchStyle: ViewStyle = {
  position: 'absolute',
  left: (TOOL_GLYPH_SIZE - HATCH_BOX) / 2,
  top: (TOOL_GLYPH_SIZE - HATCH_BOX) / 2,
};

export interface ToolGlyphProps {
  Icon: ToolIcon;
  /** Hatched + muted. The row must also say why in words. */
  locked?: boolean;
  /** Pressed / active / the one primary action: the caller passes
   *  `t.accentLabel`. Never a per-row hue. */
  color?: string;
  testID?: string;
}

/** The glyph column: 24 pt, stroke 2, ink. Hatched when locked. */
function ToolGlyphImpl({ Icon, locked = false, color, testID }: ToolGlyphProps) {
  const { colors } = useTheme();
  const ink = locked ? colors.textMuted : (color ?? colors.text);
  return (
    <View style={glyphBox} testID={testID}>
      {locked ? (
        <Svg width={HATCH_BOX} height={HATCH_BOX} viewBox={`0 0 ${HATCH_BOX} ${HATCH_BOX}`} style={hatchStyle} pointerEvents="none">
          <Path d={HATCH_D} stroke={toolRule(colors)} strokeWidth={1.25} fill="none" />
        </Svg>
      ) : null}
      <View style={locked ? lockedGlyph : undefined}>
        <Icon size={TOOL_GLYPH_SIZE} color={ink} strokeWidth={TOOL_GLYPH_STROKE} {...toolGlyphInk(Icon, ink)} />
      </View>
    </View>
  );
}
export const ToolGlyph = memo(ToolGlyphImpl);

const glyphBox: ViewStyle = { width: TOOL_GLYPH_SIZE, height: TOOL_GLYPH_SIZE, flexShrink: 0 };
const lockedGlyph: ViewStyle = { opacity: 0.7 };

export interface ToolGroupHeaderProps {
  /** Mono sheet number: "01", "F", "AI". */
  index?: string;
  label: string;
  /** Mono count at the right. Omitted when undefined. */
  count?: number | string;
  /** A status line between the name and the count (caller colours it). */
  note?: React.ReactNode;
  /** After the count — the project page's collapse chevron. */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  testID?: string;
}

/** The title block that opens a group. Not pressable: wrap it if it folds. */
function ToolGroupHeaderImpl({ index, label, count, note, trailing, style, labelStyle, testID }: ToolGroupHeaderProps) {
  const { colors } = useTheme();
  const s = toolListStyles(colors);
  return (
    <View style={[s.header, style]} testID={testID}>
      {index ? <Text style={s.headerMono}>{index}</Text> : null}
      <Text style={[s.headerLabel, labelStyle]} numberOfLines={1} accessibilityRole="header">{label}</Text>
      {note}
      {count !== undefined && count !== null ? <Text style={s.headerMono}>{count}</Text> : null}
      {trailing}
    </View>
  );
}
export const ToolGroupHeader = memo(ToolGroupHeaderImpl);

/** Mono tier tag with an 11 pt lock, at the right edge of a locked row. */
function ToolLockTagImpl({ label }: { label?: string }) {
  const { colors } = useTheme();
  const s = toolListStyles(colors);
  return (
    <View style={s.tag}>
      <Lock size={11} color={colors.textMuted} strokeWidth={2.25} />
      {label ? <Text style={s.tagText}>{label}</Text> : null}
    </View>
  );
}
export const ToolLockTag = memo(ToolLockTagImpl);
