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
//
// The other half (2026-10-02, content rights): REAL weather carries its
// source's credit. WeatherCredit prints "Weather data provided by OpenWeather"
// (plus "© OpenStreetMap contributors" beside a geocoded place name) only when
// a live day is on screen — never over simulated days, which are the app's
// invention and keep the SIMULATED marking instead.

import React from 'react';
import { View, Text, StyleSheet, Linking, type StyleProp, type ViewStyle } from 'react-native';
import { CloudOff, MapPin } from 'lucide-react-native';
import { Colors, type ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
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
import {
  OPENWEATHER_CREDIT,
  OPENWEATHER_URL,
  OSM_CREDIT,
  OSM_COPYRIGHT_URL,
  showsOpenWeatherCredit,
} from '@/utils/contentCredits';

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
  /**
   * WHY these days are simulated, in plain words — from
   * utils/weatherProvenance.describeForecast (no jobsite address vs live
   * weather unreachable vs past the 5-day horizon). Appended to the body.
   */
  cause?: string | null;
}

/**
 * Unmissable, always-on marker — not a tooltip. Mount it directly above the
 * weather it disclaims so the label and the data can't be seen apart.
 * Renders null when every displayed day is a real reading.
 */
export function SimulatedWeatherBanner({ days, style, cause }: SimulatedWeatherBannerProps) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  if (!hasSimulatedDays(days)) return null;
  const simulatedDayCount = countSimulatedDays(days);
  const allSimulated = simulatedDayCount === days.length;

  return (
    <View style={[s.simBanner, style]} accessibilityRole="alert">
      <View style={s.simBannerIcon}>
        <CloudOff size={16} color={t.warningLabel} strokeWidth={1.75} />
      </View>
      <View style={s.simBannerBody}>
        <Text style={s.simBannerTitle}>{SIMULATED_WEATHER_HEADLINE}</Text>
        <Text style={s.simBannerText}>
          {(allSimulated
            ? SIMULATED_WEATHER_BODY
            : `${simulatedDayCount} of ${days.length} days shown are simulated (marked ${SIMULATED_DAY_LABEL}). ${SIMULATED_WEATHER_BODY}`)
            + (cause ? ` ${cause}` : '')}
        </Text>
      </View>
    </View>
  );
}

export interface WeatherPlaceLineProps {
  /** "Weather for Park Slope, Brooklyn" — describeForecast().placeLine (or,
   *  over the Gantt, its `cause` when there is no place to name). */
  text: string | null;
  /** The forecast days this line describes. Required, so no surface can name
   *  a place for live weather without the credit coming with it: when any of
   *  them is a live OpenWeather reading the OpenWeather and OpenStreetMap
   *  credits render under the place (see WeatherCredit). */
  days: readonly SourcedDay[];
  style?: StyleProp<ViewStyle>;
}

/**
 * Names the place a forecast is for, directly above it. Two jobs addressed
 * "United States" showed Kansas weather with nothing on screen to say where it
 * was from (2026-09-24); a named place is checkable at a glance. Renders
 * nothing when there is no live reading to attribute.
 */
export function WeatherPlaceLine({ text, days, style }: WeatherPlaceLineProps) {
  const { colors: t } = useTheme();
  const s = useThemedStyles(makeStyles);
  if (!text) return null;
  const place = (
    <>
      <MapPin size={11} color={t.textSecondary} strokeWidth={1.75} />
      <Text style={s.placeLineText} numberOfLines={2}>{text}</Text>
    </>
  );
  // No live day (the line is a cause, over simulated weather): exactly the
  // line it always was — no credit, because none of it is OpenWeather's data.
  if (!showsOpenWeatherCredit(days)) return <View style={[s.placeLine, style]}>{place}</View>;
  return (
    <View style={[s.placeBlock, style]}>
      <View style={s.placeLine}>{place}</View>
      <WeatherCredit days={days} place />
    </View>
  );
}

function openLink(url: string): void {
  void Linking.openURL(url).catch(() => {});
}

export interface WeatherCreditProps {
  /** The forecast days on screen. The credit renders only when at least one
   *  is a live OpenWeather reading — simulated days are invented by the app,
   *  are not OpenWeather's data, and keep their SIMULATED marking instead. */
  days: readonly SourcedDay[];
  /** True when a place name sits next to the weather: that name (and the map
   *  pin behind the forecast) comes from OpenStreetMap's geocoder
   *  (utils/geocodeProject.ts), whose license asks for its own credit. */
  place?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * "Weather data provided by OpenWeather" (linked to openweathermap.org), plus
 * "© OpenStreetMap contributors" (linked to its copyright page) beside a place
 * name. OpenWeather's plans require the first line wherever its forecast is
 * shown; OpenStreetMap's license requires the second wherever its geocoder
 * named the place (contentfix-specs/RIGHTS-VERDICT.md). Renders nothing for a
 * window with no live day, so it is safe to mount unconditionally.
 */
export function WeatherCredit({ days, place = false, style }: WeatherCreditProps) {
  const s = useThemedStyles(makeStyles);
  if (!showsOpenWeatherCredit(days)) return null;
  return (
    <View style={[s.creditLine, style]} testID="weather-credit">
      <Text
        style={s.creditLink}
        onPress={() => openLink(OPENWEATHER_URL)}
        accessibilityRole="link"
        accessibilityLabel={`${OPENWEATHER_CREDIT}. Opens openweathermap.org.`}
      >
        {OPENWEATHER_CREDIT}
      </Text>
      {place ? (
        <>
          <Text style={s.creditSep}>·</Text>
          <Text
            style={s.creditLink}
            onPress={() => openLink(OSM_COPYRIGHT_URL)}
            accessibilityRole="link"
            accessibilityLabel={`${OSM_CREDIT}. Opens openstreetmap.org.`}
          >
            {OSM_CREDIT}
          </Text>
        </>
      ) : null}
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
  const s = useThemedStyles(makeStyles);
  if (source === 'live') return null;
  return (
    <View style={[s.simDayChip, style]}>
      <Text style={s.simDayChipText}>{SIMULATED_DAY_LABEL}</Text>
    </View>
  );
}

// Built per theme. The card used to be a fixed pale-amber #FFF3E0 (warningLight)
// carrying `Colors.textSecondary` body copy baked at import — and the pairing is
// only safe by accident: unfreeze the ink alone and dark mode paints cream type
// on a pale card. The *Soft/*Label pair composites over whichever ground is
// actually behind it, so tint and ink move together (audit 2026-09-07).
const makeStyles = (t: ThemeColors) => StyleSheet.create({
  // Amber warning treatment (never the neutral/info palette): this is a trust
  // warning, not a hint. Full-width, above the data it disclaims.
  simBanner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  simBannerIcon: {
    width: 28,
    height: 28,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: t.surface,
  },
  simBannerBody: { flex: 1, gap: 3 },
  simBannerTitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '800' as const,
    color: t.warningLabel,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  simBannerText: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    lineHeight: 15,
  },
  placeBlock: { gap: 2 },
  placeLine: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
  },
  placeLineText: {
    flexShrink: 1,
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
  },
  // The credit is small print: caption2 in the secondary ink, underlined so it
  // reads as a link without a second accent competing with the forecast.
  creditLine: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    columnGap: 4,
  },
  creditLink: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
    textDecorationLine: 'underline' as const,
  },
  creditSep: {
    fontSize: Type.caption2.fontSize,
    color: t.textSecondary,
  },
  simDayChip: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: Tokens.radius.xs,
    backgroundColor: t.warningSoft,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  simDayChipText: {
    // 9pt, carried over verbatim from LookaheadView's original chip. Below
    // Type's smallest token (caption2, 11) on purpose: the chip has to sit
    // under a weather glyph inside an ~60px day column and inside the
    // vertical Gantt's 80px date gutter without wrapping. Do not "fix" this
    // to a token without re-checking both of those columns.
    fontSize: 9,
    fontWeight: '800' as const,
    color: t.warningLabel,
    letterSpacing: 0.3,
  },
});
