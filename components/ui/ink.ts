// components/ui/ink.ts — the two colour decisions a chip cannot get right by eye.
//
// WHY THIS EXISTS (2026-09-07 app-experience audit, "worth doing" 4 and 5).
//
// Two defect classes kept recurring because both are invisible in review — the
// colour looks *semantically* right in the diff, and only a real ratio says it
// is not:
//
//   1. `#9AA3AD` — the DARK theme's `textSecondary` — hardcoded on a LIGHT
//      surface, in 82 places. It is the right grey in dark mode (6.37:1 on
//      the dark surface #1D211F) and 2.23-2.56:1 in light mode (measured on
//      the pre-rebrand cream grounds), which is where every one of
//      those 82 actually rendered. The fix for most of them is the theme token;
//      the ones that ALSO have to work as a solid fill (a status dot, a chip
//      that inverts when selected, anything alpha-suffixed `+ '20'`) cannot use
//      `textSecondary`, because it is an `rgba()` string in light theme and
//      RN's normalizeColor silently DROPS the suffix off an rgba. Those need a
//      solid hex that themes — which is `neutralInk` below.
//
//   2. Hardcoding the label on a coloured fill as white. White on the schedule
//      chips' `#34C759` is 2.22:1; on `#FF9500`, 2.20:1. `labelOn` picks the
//      legal one by MEASUREMENT rather than by eye.
//
// Not in constants/colors.ts because these are derived, not tokens: `labelOn`
// is a function of whatever fill it is handed, and `neutralInk` is a function
// of the ground the caller is standing on.
//
// Pinned by scripts/validate-contrast.ts (checks 13 and 14).

import type { ThemeColors } from '@/constants/colors';

/** WCAG 2.x relative luminance of an `#RRGGBB` / `#RGB` colour. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  // Unparseable → 1 (treat as a light ground). Both callers below then fall to
  // their light-theme answer, which is the safe side: the defect this module
  // exists to stop is a DARK-theme value landing on a LIGHT surface.
  if (!m) return 1;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  const ch = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The near-black this app uses for a label on a light fill. Same value
 * `utils/scheduleColors.ts:barLabelColorFor` returns, so a Gantt bar and a
 * status chip that land on the same fill agree.
 */
export const INK_ON_LIGHT_FILL = '#1F2937';

/**
 * Pick the label colour for text sitting ON `fill`, by measured ratio.
 *
 * `barLabelColorFor` answers the same question with a YIQ≥150 heuristic that
 * was hand-checked against `Colors.tradeColors` and is correct there — but it
 * is a brightness proxy, not a ratio, and it returns WHITE on
 * `Colors.statusFills.not_started` (#8E9299) at 3.13:1. A Gantt bar label can
 * live with that under the 3:1 large-graphic floor; a chip label carrying the
 * word "Not started" at 11pt cannot. So this measures both candidates and
 * returns the winner, which is never worse and is usually the same answer.
 */
export function labelOn(fill: string): string {
  const l = luminance(fill);
  return ratio(l, 1) >= ratio(l, luminance(INK_ON_LIGHT_FILL)) ? '#FFFFFF' : INK_ON_LIGHT_FILL;
}

/**
 * A SOLID neutral ink that themes — for the places `#9AA3AD` was hardcoded and
 * `t.textSecondary` cannot go because the value has to be a hex (alpha-suffixed
 * as a fill, or inverted under `labelOn`).
 *
 * Light: `#5A6472` — the ink hue (#2B3038) opened up ~2.1x, so it stays in the
 * same slate family as `text` rather than introducing a new grey. Measured on
 * this theme's own (concrete) grounds: 6.00:1 on surface #FFFFFF, 5.10:1 on
 * bg #ECEDE9, 4.68:1 on surfaceAlt #E2E4DF, and 5.06:1 as a label on its own
 * `+ '20'` tint over white. White on it as a fill: 6.00:1.
 *
 * Dark: `#9AA3AD` — unchanged, because on a dark ground that value was always
 * right (6.37:1 on surface #1D211F, 5.15:1 on its own `+ '20'` tint). The bug was never
 * the colour, it was that a dark-theme constant was frozen into light screens.
 *
 * Chosen by measuring the ground rather than by asking for the theme name, so
 * a caller that only has `ThemeColors` in hand (a module-scope palette turned
 * into a factory) does not have to also thread `resolved` through.
 */
export function neutralInk(t: Pick<ThemeColors, 'bg'>): string {
  return luminance(t.bg) > 0.5 ? '#5A6472' : '#9AA3AD';
}

/**
 * The four schedule-task statuses as LABEL inks — one table, so the Pro
 * scheduler's inspector and the mobile Schedule tab's edit sheet stop each
 * inventing their own.
 *
 * Before 2026-09-07 they had two different tables and neither cleared AA:
 * TaskInspector painted `in_progress` in the raw (then orange) brand accent (2.87:1
 * as text) and `not_started` in the dark theme's grey; the Schedule tab's sheet
 * used `{done:'#34C759', in_progress:'#007AFF', on_hold:'#FF9500',
 * not_started:'#8E8E93'}`, which fails in BOTH directions — 2.22 / 4.02 / 2.20
 * / 3.26:1 as text on white, and the same four numbers again for the white
 * label the sheet put on the selected chip's fill.
 *
 * These are theme tokens constants/colors.ts already derives and
 * scripts/validate-contrast.ts check 5 already measures on the app's `+ '15'`
 * chip tint, so a chip built from them inherits that proof. Hues follow
 * `utils/scheduleColors.ts:statusColor` — done teal, in-progress BLUE, on-hold
 * amber, not-started neutral — so a Gantt bar and a chip for the same task
 * never disagree.
 *
 * in_progress is `info`, not `accentLabel`. Amber was the obvious pick (it is
 * what TaskInspector used) and it is wrong for a reason contrast alone will not
 * catch: the light accentLabel was then #B23E08 (the pre-rebrand orange; it
 * is MAGE green #2C6436 now) and warningLabel is #B84A00, so "In progress"
 * and "On hold" would have rendered as the same burnt orange sitting next to
 * each other. Legible and indistinguishable is still broken —
 * see validate-contrast check 5b, which exists because an earlier fix made a
 * yellow health dot identical to a red one.
 *
 * Measured on `surface` in each theme (#FFFFFF / #1D211F), as a bare label /
 * on its own `+ '15'` (CHIP_TINT_SUFFIX) tint:
 *   light  done 7.20 / 6.34   in_progress 5.75 / 5.10
 *          on_hold 5.23 / 4.65   not_started 6.00 / 5.35
 *   dark   done 6.79 / 5.93   in_progress 6.43 / 5.65
 *          on_hold 7.41 / 6.42   not_started 6.37 / 5.55
 *
 * A FILLED chip pairs these with `labelOn`, never with a literal white.
 */
export function taskStatusInk(
  t: Pick<ThemeColors, 'bg' | 'successLabel' | 'warningLabel' | 'info'>,
): Record<'not_started' | 'in_progress' | 'on_hold' | 'done', string> {
  return {
    not_started: neutralInk(t),
    in_progress: t.info,
    on_hold: t.warningLabel,
    done: t.successLabel,
  };
}

/**
 * The alpha suffix the app's chip idiom uses for "a label on a wash of itself".
 * Named because the ratios above are measured at exactly this value, and
 * check 5 of validate-contrast pins the same one — a chip that deepens the wash
 * to `'22'` (13%) drops `warningLabel` to 4.32:1 without changing a colour.
 */
export const CHIP_TINT_SUFFIX = '15';
