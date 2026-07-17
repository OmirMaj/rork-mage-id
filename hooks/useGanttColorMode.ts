// useGanttColorMode — persisted "how should Gantt bars be colored?" preference.
//
// Two modes:
//   'status' (DEFAULT) — bar fill = task STATUS (done/in-progress/on-hold/
//                         not-started). This is the progress-tracking signal
//                         field teams actually read at a glance.
//   'trade'            — bar fill = task TRADE (concrete/electrical/…). Useful
//                         when you're coordinating who's on site, but most real
//                         schedules are "General crew" tasks that fall back to
//                         one color, so this is the opt-in, not the default.
//
// Why status is the default: trade inference (utils/scheduleColors) is
// deliberately conservative, so generic task titles collapse to `general`
// (brand amber) and EVERY bar renders the same orange — a useless signal. A
// contractor flagged that the old status coloring tracked progress far better.
//
// Persistence mirrors the GridPane column-width pattern (AsyncStorage, seed on
// mount, debounce-free single write on change) — a scheduler-wide view pref,
// not server state, so it never touches the offline queue.

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type GanttColorMode = 'status' | 'trade';

export const GANTT_COLOR_MODE_KEY = 'mageid_gantt_color_mode';
export const DEFAULT_GANTT_COLOR_MODE: GanttColorMode = 'status';

function isValidMode(v: unknown): v is GanttColorMode {
  return v === 'status' || v === 'trade';
}

export function useGanttColorMode(): {
  colorMode: GanttColorMode;
  setColorMode: (mode: GanttColorMode) => void;
  toggleColorMode: () => void;
} {
  const [colorMode, setColorModeState] = useState<GanttColorMode>(DEFAULT_GANTT_COLOR_MODE);

  // Hydrate the saved preference on mount. Bad/missing data falls back to the
  // status default — never throws.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(GANTT_COLOR_MODE_KEY)
      .then(raw => {
        if (cancelled || !raw) return;
        if (isValidMode(raw)) setColorModeState(raw);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const setColorMode = useCallback((mode: GanttColorMode) => {
    setColorModeState(mode);
    void AsyncStorage.setItem(GANTT_COLOR_MODE_KEY, mode).catch(() => {});
  }, []);

  const toggleColorMode = useCallback(() => {
    setColorModeState(prev => {
      const next: GanttColorMode = prev === 'status' ? 'trade' : 'status';
      void AsyncStorage.setItem(GANTT_COLOR_MODE_KEY, next).catch(() => {});
      return next;
    });
  }, []);

  return { colorMode, setColorMode, toggleColorMode };
}
