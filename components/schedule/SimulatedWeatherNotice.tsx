// SimulatedWeatherNotice — THE marker for invented weather.
//
// WHY THIS FILE EXISTS: five surfaces used to render getSimulatedForecast()
// output with nothing saying it was invented — the Gantt seed, the vertical
// Gantt, the task-detail "Weather Impact" panel, and TodayView, which is what
// a superintendent reads at 6am before deciding whether to call off a pour.
//
// LookaheadView already had the right treatment (amber banner + per-day SIM
// chips). Rather than let four more variants of that treatment grow, the
// banner and the chip are lifted here verbatim — same palette, same copy, same
// CloudOff icon — so every weather surface in the app disclaims fabricated
// data in exactly one visual language. Changing the wording or the styling in
// one place changes it everywhere, which is the point.
//
// The gate is data, not configuration: `DayForecast.source` is required on
// every day, so any renderer can ask "is any of what I'm showing invented?"
// without new plumbing. Both components render NOTHING for a fully live
// window, so they are safe to mount unconditionally.

import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { CloudOff } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import {
  hasSimulatedDays,
  countSimulatedDays,
  SIMULATED_WEATHER_HEADLINE,
  SIMULATED_WEATHER_BODY,
  SIMULATED_DAY_LABEL,
  type ForecastSource,
} from '@/utils/weatherProvenance';

/** Structural — takes anything carrying provenance, not just DayForecast, so
 *  this module never has to import weatherService. */
interface SourcedDay {
  source: ForecastSource;
}

export interface SimulatedWeatherBannerProps {
  /**
   * The days actually being DISPLAYED — not the raw fetch. If a simulated day
   * is filtered out before render there is nothing to disclaim; if one is on
   * screen, it must be marked.
   */
  days: readonly SourcedDay[];
  /** Layout only (margins/width). Never used to alter the warning treatment. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Unmissable, always-on marker — not a tooltip. Mount it directly above the
 * weather it disclaims so the label and the data can't be seen apart.
 * Renders null when every displayed day is a real reading.
 */
export function SimulatedWeatherBanner({ days, style }: SimulatedWeatherBannerProps) {
  if (!hasSimulatedDays(days)) return null;
  const simulatedDayCount = countSimulatedDays(days);
  const allSimulated = simulatedDayCount === days.length;

  return (
    <View style={[s.simBanner, style]} accessibilityRole="alert">
      <View style={s.simBannerIcon}>
        <CloudOff size={16} color={Colors.warningDark} strokeWidth={1.75} />
      </View>
      <View style={s.simBannerBody}>
        <Text style={s.simBannerTitle}>{SIMULATED_WEATHER_HEADLINE}</Text>
        <Text style={s.simBannerText}>
          {allSimulated
            ? SIMULATED_WEATHER_BODY
            : `${simulatedDayCount} of ${days.length} days shown are simulated (marked ${SIMULATED_DAY_LABEL}). ${SIMULATED_WEATHER_BODY}`}
        </Text>
      </View>
    </View>
  );
}

export interface SimulatedDayChipProps {
  /** Provenance of the single day this chip sits on. */
  source: ForecastSource;
  style?: StyleProp<ViewStyle>;
}

/**
 * Per-day provenance chip. The banner says the window contains invented
 * weather; this says WHICH days, so a part-live / part-padded window can't be
 * read as all-real. Renders null for a live day.
 */
export function SimulatedDayChip({ source, style }: SimulatedDayChipProps) {
  if (source === 'live') return null;
  return (
    <View style={[s.simDayChip, style]}>
      <Text style={s.simDayChipText}>{SIMULATED_DAY_LABEL}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // Amber warning treatment (never the neutral/info palette): this is a trust
  // warning, not a hint. Full-width, above the data it disclaims.
  simBanner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: Colors.warningLight,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  simBannerIcon: {
    width: 28,
    height: 28,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: Colors.surface,
  },
  simBannerBody: { flex: 1, gap: 3 },
  simBannerTitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '800' as const,
    color: Colors.warningDark,
    letterSpacing: 0.4,
  },
  simBannerText: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textSecondary,
    lineHeight: 15,
  },
  simDayChip: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: Tokens.radius.xs,
    backgroundColor: Colors.warningLight,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  simDayChipText: {
    fontSize: 9,
    fontWeight: '800' as const,
    color: Colors.warningDark,
    letterSpacing: 0.3,
  },
});
