// utils/weatherIcons.ts — the weather condition as a LUCIDE ICON.
//
// WHY IT IS NOT IN weatherService.ts, where it started. That module is
// deliberately dependency-free at RUNTIME: its only import is
// `import type { ForecastSource }`, which the compiler erases, and
// scripts/validate-weather-provenance.ts imports getSimulatedForecast() from
// it directly to exercise the real function rather than a copy of it. Adding
// `import { Sun, … } from 'lucide-react-native'` there pulled react-native's
// Flow-typed index.js into that script's module graph and the whole guard —
// 109 checks — died at parse time with "Unexpected typeof" before it ran a
// single one. Caught in review on 2026-09-07. A React-Native component map
// belongs on the UI side of that line; the data module stays importable.
//
// WHY IT EXISTS AT ALL. The house rule is one icon vocabulary,
// lucide-react-native. weatherService's CONDITION_ICONS maps every condition
// to an EMOJI and getConditionIcon() renders it into real <Text> on the
// Schedule tab, Today, Lookahead, the vertical Gantt and both weather-
// reschedule surfaces. It survived for months because
// scripts/validate-app-slop.ts walks app/, components/ and constants/ and
// weatherService is in utils/, one directory outside that walk. An emoji is
// also not a neutral choice: it renders in the platform's own colour and
// style, so a jobsite forecast strip picks up Apple's yellow sun next to a
// screen of MAGE orange-and-ink line icons, and it is unreadable at the
// 12-14pt those strips actually use.
//
// Use it as `const Icon = CONDITION_ICON[f.condition];` then
// `<Icon size={16} color={t.textSecondary} strokeWidth={1.75} />`.
//
// The migration off the emoji is counted by scripts/validate-weather-icons.ts.

import { Sun, Cloud, CloudRain, CloudLightning, CloudSnow, Wind, type LucideIcon } from 'lucide-react-native';

import type { DayForecast } from '@/utils/weatherService';

export const CONDITION_ICON: Record<DayForecast['condition'], LucideIcon> = {
  clear: Sun,
  cloudy: Cloud,
  rain: CloudRain,
  storm: CloudLightning,
  snow: CloudSnow,
  wind: Wind,
};
