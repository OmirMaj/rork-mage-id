// useScreenReaderMode.ts: is VoiceOver / TalkBack on? (moments wave, lane CAPSULE)
//
// A slide is not accessible by itself: with a screen reader on, the Commit
// Capsule becomes ONE button that opens a Confirm / Cancel pair instead.
//
// The web answers false. react-native-web's isScreenReaderEnabled() resolves
// TRUE unconditionally, which would turn every web slide into button mode;
// the web keeps the focusable head with press-and-hold Space / Enter instead.

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export function useScreenReaderMode(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    let alive = true;
    try {
      const p = AccessibilityInfo.isScreenReaderEnabled?.();
      if (p && typeof p.then === 'function') {
        p.then((v) => { if (alive) setOn(!!v); }, () => {});
      }
    } catch {
      // no accessibility module: stay in slide mode.
    }
    let sub: { remove?: () => void } | undefined;
    try {
      sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', (v: boolean) => { if (alive) setOn(!!v); });
    } catch {
      sub = undefined;
    }
    return () => {
      alive = false;
      try { sub?.remove?.(); } catch { /* already gone */ }
    };
  }, []);
  return on;
}
