// haptics.ts: the commit moment's haptic and VoiceOver beats (moments wave, lane CAPSULE).
//
// Beats (morph.md 4, CAPSULE spec 8): grab selection · notch selection (<= 3)
// · lock medium · unlock selection · dock rigid @140 · success @340 (the frame
// the check completes) · neutral-done medium · queued light · refused error ·
// timeout warning · disabled attempt warning.
//
// Every call is guarded: a haptic is decoration and must never break a commit.
// The web has no haptics, so momentHaptic is a no-op there.

import { AccessibilityInfo, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export type MomentHaptic = 'selection' | 'light' | 'medium' | 'rigid' | 'success' | 'warning' | 'error';

export function momentHaptic(k: MomentHaptic): void {
  if (Platform.OS === 'web') return;
  try {
    let p: Promise<unknown> | undefined;
    switch (k) {
      case 'selection': p = Haptics.selectionAsync(); break;
      case 'light': p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); break;
      case 'medium': p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); break;
      case 'rigid': p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid); break;
      case 'success': p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); break;
      case 'warning': p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); break;
      case 'error': p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); break;
    }
    p?.catch(() => {});
  } catch {
    // no haptics engine, a hostile environment: the commit goes on.
  }
}

/** Post `text` to VoiceOver / TalkBack. A no-op for an empty string; never throws. */
export function announce(text: string): void {
  if (!text) return;
  try {
    AccessibilityInfo.announceForAccessibility?.(text);
  } catch {
    // an announcement is never allowed to break the commit it describes.
  }
}
