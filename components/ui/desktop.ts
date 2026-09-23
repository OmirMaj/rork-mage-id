// components/ui/desktop.ts — the desktop-web layout vocabulary (wave 6b).
//
// WHY THIS FILE EXISTS. The web app was the phone app stretched across a
// monitor: ~205 hand-rolled button styles (row, centred, vertical padding, NO
// width) filled whatever column they sat in — the home "AI briefing" toggle
// measured 1368×37, TodayView's empty box 1368×115, daily-report's "No
// incidents today" 1022 px. Nothing here is a component; these are layout-only
// objects a screen appends BEHIND the desktop gate:
//
//     style={[styles.x, isDesktop && desktopCta]}
//
// On a phone `isDesktop` is false, React Native's style flattening drops the
// `false`, and the phone renders exactly what it rendered before. That is the
// whole safety argument, so every object here is layout-only: no colours
// (they would not survive the green rebrand) and no typography.
//
// It is also the home of the primitives' PURE maths (tile columns, segment
// sizing, sheet widths, the Cmd/Ctrl+Enter test, the sidebar inset). They live
// here, not in the .tsx files, so scripts/validate-ui-desktop-primitives.ts can
// import them under bun without dragging in lucide / expo-haptics / contexts.
// The only runtime imports are react, react-native (Platform, for the web
// check) and the Layout tokens.

import React from 'react';
import { Platform, type TextStyle, type ViewStyle } from 'react-native';
import { Layout, Radius, Shadow } from '@/constants/designTokens';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';

// ─────────────────────────────────────────────────────────────────────────────
// The gate
// ─────────────────────────────────────────────────────────────────────────────

/** The single desktop gate (web >= 900 CSS px, or any platform >= 1024). The
 *  iPhone app can never reach it: supportsTablet is false and no iPhone is
 *  1024 wide. */
export function useIsDesktop(): boolean {
  return useResponsiveLayout().isDesktop;
}

/** Desktop AND web. For rules that lean on CSS-only values RN native cannot
 *  parse (`width: 'fit-content'`) or on the DOM (focus, key listeners). */
export function useIsDesktopWeb(): boolean {
  const { isDesktop } = useResponsiveLayout();
  return isDesktop && Platform.OS === 'web';
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout-only helpers for the long tail of hand-rolled controls
// ─────────────────────────────────────────────────────────────────────────────

/** A hand-rolled primary/secondary button: hugs its label instead of the
 *  column. minWidth keeps a one-word label from looking like a chip. */
export const desktopCta: ViewStyle = {
  alignSelf: 'flex-start',
  paddingHorizontal: 20,
  minWidth: 160,
  maxWidth: 320,
  height: Layout.control.md,
};

/** '+ Add item' / '+ Add line' rows. Smaller than a CTA — it is a list verb. */
export const desktopAddRow: ViewStyle = {
  alignSelf: 'flex-start',
  paddingHorizontal: 14,
  height: 36,
};

/** A disclosure ("Show AI briefing ▾"): the chevron sits right after the label
 *  instead of 1,300 px away at the far edge. */
export const desktopToggle: ViewStyle = {
  alignSelf: 'flex-start',
  justifyContent: 'flex-start',
  gap: 8,
  paddingHorizontal: 12,
  height: Layout.control.sm,
};

/** A "nothing here yet" box inside a section becomes one muted inline row.
 *  Use DESKTOP_INLINE_EMPTY_ICON for its icon. */
export const desktopInlineEmpty: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  alignSelf: 'flex-start',
  paddingVertical: 10,
  paddingHorizontal: 14,
  borderWidth: 0,
  backgroundColor: 'transparent',
};
export const DESKTOP_INLINE_EMPTY_ICON = 18;

/** Any Text that can wrap past one line: ~75 characters, not 250. */
export const desktopProse: TextStyle = { maxWidth: Layout.prose };

/** An icon/text/chevron entry row. With 2 or more, use <TileGrid preset="nav">. */
export const desktopLauncher: ViewStyle = { maxWidth: 640 };

// ─────────────────────────────────────────────────────────────────────────────
// Form fields
// ─────────────────────────────────────────────────────────────────────────────

export type FieldSize = keyof typeof Layout.field;

/** Cap a short-value input at its field width on desktop (the contacts search
 *  box measured 1736 px live). Text areas do NOT use this — they take the
 *  form column. */
export function desktopField(size: FieldSize): ViewStyle {
  return { maxWidth: Layout.field[size], alignSelf: 'flex-start' };
}

/** The default field size a keyboard type implies, for the TextField primitive
 *  that lands later: numbers are short, money a little longer. Anything else
 *  has no implied size (null) — the caller picks md/lg by meaning. */
export function fieldSizeForKeyboard(keyboardType: string | undefined): FieldSize | null {
  if (keyboardType === 'number-pad' || keyboardType === 'numeric') return 'xs';
  if (keyboardType === 'decimal-pad') return 'sm';
  return null;
}

/** Label-left / value-right rows (company profile, settings inline inputs,
 *  quick-quote): on desktop the value sat 800-1990 px from its label. The row
 *  caps at the form column, the label column is 200, the value is left-aligned. */
export const desktopLabelRow: { row: ViewStyle; label: TextStyle; value: TextStyle } = {
  row: { maxWidth: 720 },
  label: { width: 200, flexGrow: 0, flexShrink: 0 },
  value: { flexGrow: 0, flexShrink: 1, textAlign: 'left' },
};

/** Line-item columns on desktop (Qty / Unit / Unit price / Total / Description). */
export const desktopLineItem: {
  qty: ViewStyle; unit: ViewStyle; unitPrice: ViewStyle; total: TextStyle; description: ViewStyle;
} = {
  qty: { width: 88, flexGrow: 0, flexShrink: 0 },
  unit: { width: 72, flexGrow: 0, flexShrink: 0 },
  unitPrice: { width: 128, flexGrow: 0, flexShrink: 0 },
  total: { width: 128, flexGrow: 0, flexShrink: 0, textAlign: 'right' },
  description: { flex: 1, maxWidth: 480 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure maths — covered by scripts/validate-ui-desktop-primitives.ts
// ─────────────────────────────────────────────────────────────────────────────

export type TilePreset = keyof typeof Layout.tile;

export interface TileSpec { min: number; maxCols: number; gap: number }

/**
 * Column count and tile width for a container W px wide.
 *
 *   cols  = clamp(floor((W + gap) / (min + gap)), 1, maxCols)
 *   width = floor((W − gap·(cols − 1)) / cols)
 *
 * Before the first onLayout W is unknown (<= 0): the tile paints at the
 * preset's minimum so nothing flashes at full width. A container narrower than
 * one minimum tile still gets one column, as wide as the container.
 */
export function tileGridColumns(W: number, spec: TileSpec): { cols: number; width: number } {
  if (!(W > 0)) return { cols: 1, width: spec.min };
  const fit = Math.floor((W + spec.gap) / (spec.min + spec.gap));
  const cols = Math.max(1, Math.min(spec.maxCols, fit));
  const width = Math.floor((W - spec.gap * (cols - 1)) / cols);
  return { cols, width: Math.max(0, width) };
}

/** tileGridColumns for a named Layout.tile preset. */
export function tileGridForPreset(W: number, preset: TilePreset): { cols: number; width: number } {
  return tileGridColumns(W, Layout.tile[preset]);
}

/** Past this many options a segmented control is drawn as underline tabs:
 *  seven pills in a 640 cap would be ~88 px each and read as a button bar. */
export const SEGMENT_UNDERLINE_AFTER = 6;

export type SegmentedVariant = 'auto' | 'pill' | 'underline' | 'numeric';

/** Which look a segmented control gets. 'auto' = pills up to 6, underline past. */
export function resolveSegmentedVariant(
  optionCount: number,
  variant: SegmentedVariant = 'auto',
): 'pill' | 'underline' | 'numeric' {
  if (variant !== 'auto') return variant;
  return optionCount > SEGMENT_UNDERLINE_AFTER ? 'underline' : 'pill';
}

/** The width box one segment gets on desktop: a fixed 56 for numeric
 *  quick-picks (0/25/50/75/100, FS/SS/FF/SF), 88-200 intrinsic otherwise. */
export function segmentBox(kind: 'text' | 'numeric'): { width?: number; minWidth?: number; maxWidth?: number } {
  if (kind === 'numeric') return { width: Layout.segment.numeric };
  return { minWidth: Layout.segment.minWidth, maxWidth: Layout.segment.maxWidth };
}

/** The widest a pill-segmented control of n segments can get on desktop:
 *  the sum of the segment maxima + gaps + padding, capped at controlMax. It is
 *  intrinsic below that — this is the ceiling, and why it can never again span
 *  an 881 px column. */
export function segmentedMaxWidth(n: number, kind: 'text' | 'numeric' = 'text'): number {
  if (n <= 0) return 0;
  const seg = kind === 'numeric' ? Layout.segment.numeric : Layout.segment.maxWidth;
  const raw = n * seg + (n - 1) * SEGMENTED_GAP + 2 * SEGMENTED_PAD;
  return Math.min(Layout.segment.controlMax, raw);
}
export const SEGMENTED_GAP = 2;
export const SEGMENTED_PAD = 3;

export type SheetSize = keyof typeof Layout.sheet;

/** Gutter a desktop sheet keeps from the content column's edge (overlay padding 32). */
export const SHEET_GUTTER = 32;

/**
 * The card width a desktop sheet ends up at inside a content column `container`
 * px wide: min(Layout.sheet[size], container − 2·gutter). The right-docked
 * panel has no gutter — it is flush to the window's right edge.
 */
export function sheetCardWidth(size: SheetSize, container: number): number {
  const cap = Layout.sheet[size];
  const room = size === 'panel' ? container : container - 2 * SHEET_GUTTER;
  return Math.max(0, Math.min(cap, room));
}

/** The layout half of useSheetFrame()'s result on desktop. */
export interface SheetFrameStyles {
  overlay: ViewStyle | null;
  scrollContent: ViewStyle | null;
  card: ViewStyle | null;
  footer: ViewStyle | null;
  footerButton: ViewStyle | null;
}

/** The desktop frame for a size. Pure apart from the theme line colour and the
 *  measured sidebar inset, which are passed in. Lives here (not in Sheet.tsx) so the bun validator can import it. */
export function desktopSheetFrame(size: SheetSize, line: string, shellInset: number): SheetFrameStyles {
  const allCorners = (r: number): ViewStyle => ({
    borderRadius: r,
    borderTopLeftRadius: r,
    borderTopRightRadius: r,
    borderBottomLeftRadius: r,
    borderBottomRightRadius: r,
  });
  // Every padding longhand is spelled out: RN resolves a caller's
  // `paddingHorizontal: 20` / `paddingBottom: insets.bottom + 16` over a plain
  // `padding` no matter the array order, so `padding: 24` alone would lose to
  // the phone sheet it is appended to.
  const pad = (n: number): ViewStyle => ({
    padding: n,
    paddingHorizontal: n,
    paddingVertical: n,
    paddingTop: n,
    paddingBottom: n,
    paddingLeft: n,
    paddingRight: n,
  });
  // A phone sheet is often `position: 'absolute', bottom: 0` or pushed down with
  // `marginTop: 'auto'`; either would pin the desktop card to the bottom edge
  // instead of the centre. Relative + zero vertical margins neutralise both.
  const unpin: ViewStyle = { position: 'relative', marginTop: 0, marginBottom: 0 };
  const footer: ViewStyle = { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 };
  const footerButton: ViewStyle = {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    minWidth: 104,
    height: Layout.control.md,
    paddingHorizontal: 20,
  };
  if (size === 'panel') {
    return {
      overlay: { alignItems: 'flex-end', justifyContent: 'flex-start', ...pad(0), marginLeft: shellInset },
      scrollContent: { flexGrow: 1, alignItems: 'flex-end', justifyContent: 'flex-start' },
      card: {
        width: '100%',
        height: '100%',
        maxWidth: Layout.sheet.panel,
        maxHeight: '100%',
        ...allCorners(0),
        borderLeftWidth: 1,
        borderLeftColor: line,
        ...pad(24),
        ...unpin,
        ...Shadow.heavy,
      },
      footer,
      footerButton,
    };
  }
  return {
    overlay: { justifyContent: 'center', alignItems: 'center', ...pad(SHEET_GUTTER), marginLeft: shellInset },
    // flexGrow so a ScrollView's content box is tall enough to centre in.
    scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
    card: {
      width: '100%',
      maxWidth: Layout.sheet[size],
      maxHeight: '85%',
      ...allCorners(Radius.xl),
      ...pad(24),
      ...unpin,
      ...Shadow.heavy,
    },
    footer,
    footerButton,
  };
}

/** Cmd+Enter (mac) / Ctrl+Enter (everything else) runs a sheet's primary
 *  action. Plain Enter never does — it belongs to the focused field (a
 *  textarea newline, a picker's own choice). */
export function isPrimaryHotkey(e: { key?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): boolean {
  return e.key === 'Enter' && (!!e.metaKey || !!e.ctrlKey) && !e.altKey && !e.shiftKey;
}

/**
 * The left inset a desktop overlay keeps so its scrim never covers the sidebar.
 *
 * RN-web mounts every Modal position:fixed over the WHOLE window
 * (react-native-web ModalContent.js), sidebar included. The sidebar's
 * right edge is where the content column starts. A hidden sidebar (display:none
 * on shell-exempt routes) measures width 0 and yields 0, so an exempt route's
 * sheet still centres on the full window.
 */
export function shellInsetFromRect(rect: { right: number; width: number } | null | undefined): number {
  if (!rect || !(rect.width > 0) || !(rect.right > 0)) return 0;
  return Math.round(rect.right);
}

/** DesktopSidebar renders `accessibilityRole="navigation"` +
 *  `accessibilityLabel="Primary navigation"`, which RN-web writes to the DOM as
 *  role/aria-label. The validator pins that label so a rename fails the build
 *  instead of quietly putting every sheet's scrim back over the sidebar. */
export const SIDEBAR_DOM_SELECTOR = '[aria-label="Primary navigation"]';

/** Measure the live sidebar (web only). 0 anywhere it cannot be measured. */
export function measureShellInset(): number {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return 0;
  try {
    const el = document.querySelector(SIDEBAR_DOM_SELECTOR) as { getBoundingClientRect?: () => { right: number; width: number } } | null;
    return shellInsetFromRect(el?.getBoundingClientRect?.() ?? null);
  } catch {
    return 0;
  }
}

/** The sidebar inset, re-measured whenever `active` turns true and on window
 *  resize. Always 0 off desktop web. */
export function useDesktopShellInset(active: boolean): number {
  const desktopWeb = useIsDesktopWeb();
  const [inset, setInset] = React.useState(0);
  React.useEffect(() => {
    if (!desktopWeb || !active) return;
    setInset(measureShellInset());
    if (typeof window === 'undefined' || !window.addEventListener) return;
    const onResize = () => setInset(measureShellInset());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [desktopWeb, active]);
  return desktopWeb ? inset : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Children helpers for the primitives that restyle their children
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flatten fragments and drop null/false/true so a primitive can cloneElement
 * each real child. `<>{a}{b}</>` inside a bar is common (invoice's draft
 * buttons), and cloning `style` onto a Fragment is a React warning and a no-op.
 */
export function flattenElements(children: React.ReactNode, keyPrefix = ''): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // toArray drops null/undefined/booleans, flattens nested arrays and gives
  // every child a key; fragments it leaves alone, so they are unwrapped here
  // with the fragment's key as a prefix (two fragments both have a '.0').
  for (const child of React.Children.toArray(children)) {
    if (React.isValidElement(child) && child.type === React.Fragment) {
      out.push(...flattenElements((child.props as { children?: React.ReactNode }).children, `${keyPrefix}${String(child.key)}/`));
      continue;
    }
    if (keyPrefix && React.isValidElement(child)) {
      out.push(React.cloneElement(child, { key: `${keyPrefix}${String(child.key)}` }));
      continue;
    }
    out.push(child);
  }
  return out;
}
