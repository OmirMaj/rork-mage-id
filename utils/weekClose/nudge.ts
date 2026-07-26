// utils/weekClose/nudge.ts — the local Friday Close nudge.
//
// One OS-scheduled local notification ("Friday close is ready — bill what
// you earned.") at 15:00 local every Friday. The nudge is the doorbell;
// the close itself composes fresh when the user opens /week-close.
//
// ARM-TIME PREDICATE (G10, plan §F2): armed only when ≥1 active project had
// activity in the last 14 days — computed at each re-arm inside
// WeekCloseCard's foreground effect. If nothing qualifies, armWeekCloseNudge
// is simply not called.
//
// FIXED OS IDENTIFIER (same strategy as armDailyBriefNudge): no stored id
// needed — we name the request, so cancel/re-arm never needs AsyncStorage.
//
// Respects the `weekClose` toggle in profiles.notification_preferences
// (flat jsonb, no migration — notifications-settings.tsx write pattern).
// Callers pass enabled:false to short-circuit without side-effecting.
//
// G8: no background runtime. The nudge text is static; the close composes on
// open, same as the morning brief.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { nextFridayFireDate } from '@/utils/brief/nudgeTime';

export const WEEK_CLOSE_NUDGE_IDENTIFIER = 'mageid-week-close-nudge';

/** Fire hour for the Friday close nudge (15 = 3 PM local). */
export const WEEK_CLOSE_NUDGE_HOUR = 15;
export const WEEK_CLOSE_NUDGE_MINUTE = 0;

async function ensurePermission(prompt: boolean): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  if (!prompt) return false;
  const res = await Notifications.requestPermissionsAsync();
  return res.status === 'granted';
}

/**
 * (Re)schedule the Friday close nudge for the next Friday at 15:00 local.
 * Pass `prompt: true` only from user-initiated toggle (never cold-prompt).
 * Returns false when skipped (web, no permission, not enabled, error).
 */
export async function armWeekCloseNudge(opts: {
  enabled?: boolean;
  prompt?: boolean;
}): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (opts.enabled === false) return false;
  try {
    if (!(await ensurePermission(opts.prompt === true))) return false;

    if (Platform.OS === 'android') {
      // Idempotent channel setup — mirrors armDailyBriefNudge.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1A6B3C',
      });
    }

    await Notifications.cancelScheduledNotificationAsync(WEEK_CLOSE_NUDGE_IDENTIFIER).catch(() => {});

    const fireAt = nextFridayFireDate(WEEK_CLOSE_NUDGE_HOUR, WEEK_CLOSE_NUDGE_MINUTE, new Date());
    const seconds = Math.max(60, Math.round((fireAt.getTime() - Date.now()) / 1000));

    await Notifications.scheduleNotificationAsync({
      identifier: WEEK_CLOSE_NUDGE_IDENTIFIER,
      content: {
        title: 'Friday close',
        body: 'Friday close is ready — bill what you earned.',
        data: { kind: 'week_close' },
        sound: 'default',
      },
      trigger: { seconds, channelId: Platform.OS === 'android' ? 'default' : undefined } as never,
    });
    return true;
  } catch (err) {
    console.log('[WeekCloseNudge] arm failed:', err);
    return false;
  }
}

/** Cancel the pending nudge (toggled off). Safe on web / no-op. */
export async function disarmWeekCloseNudge(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(WEEK_CLOSE_NUDGE_IDENTIFIER);
  } catch {
    // Nothing scheduled — fine.
  }
}
