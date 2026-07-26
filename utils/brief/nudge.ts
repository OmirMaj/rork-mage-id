// utils/brief/nudge.ts — the local morning-brief nudge.
//
// One OS-scheduled local notification ("Your morning brief is ready") at the
// user's digest hour. There is NO background runtime in this build (no
// TaskManager / background-fetch), so the nudge text is static and the brief
// itself composes fresh when the user opens it — the notification is the
// doorbell, not the letter. Re-armed on every app foreground (and on digest
// setting changes), so it stays one-shot: schedule the next fire (today if
// the hour is still ahead, else tomorrow), let it fire, re-arm on next open.
// Server push (Wave 7's morning-digest edge fn) REPLACES this doorbell when
// it can reach the device — callers skip arming (and disarm) when a push
// token is registered and the digest's in-app channel is on, otherwise the
// user gets two morning notifications for the same brief. Tapping either
// lands on /brief via the NotificationContext kind switch.
//
// FIXED OS IDENTIFIER instead of a stored id: expo-notifications lets us
// name the scheduled request, so cancel/re-arm needs no AsyncStorage key —
// nothing to register in LOCAL_USER_CACHE_KEYS, nothing to orphan on
// sign-out.
//
// Permission philosophy (utils/notifications.ts precedent): never prompt
// cold. `prompt: true` is passed ONLY from the user-initiated moment — the
// digest toggle in notifications-settings — so the iOS dialog always has
// context. Foreground re-arms pass prompt:false and silently no-op until
// permission exists.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { nextMorningFireDate } from './nudgeTime';

export const BRIEF_NUDGE_IDENTIFIER = 'mageid-morning-brief-nudge';

/** Default fire minute: half past the digest hour (default hour 6 → 6:30),
 *  clear of the :05 server cron so email + nudge don't stack. */
export const BRIEF_NUDGE_MINUTE = 30;

async function ensurePermission(prompt: boolean): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  if (!prompt) return false;
  const res = await Notifications.requestPermissionsAsync();
  return res.status === 'granted';
}

/**
 * (Re)schedule the nudge for the next hour:BRIEF_NUDGE_MINUTE local — today
 * when still ahead, else tomorrow (nudgeTime.ts).
 * Native only; returns false when skipped (web, no permission, error).
 */
export async function armDailyBriefNudge(opts: {
  hour: number;
  minute?: number;
  prompt?: boolean;
}): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    if (!(await ensurePermission(opts.prompt === true))) return false;

    if (Platform.OS === 'android') {
      // Idempotent — the channel may not exist yet when permission was
      // granted here rather than through registerForPushNotifications.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1A6B3C',
      });
    }

    await Notifications.cancelScheduledNotificationAsync(BRIEF_NUDGE_IDENTIFIER).catch(() => {});

    const fireAt = nextMorningFireDate(opts.hour, opts.minute ?? BRIEF_NUDGE_MINUTE, new Date());
    // Seconds-from-now trigger — utils/notifications.ts precedent: the DATE
    // trigger form has been finicky across SDKs; seconds is rock solid and
    // the OS keeps the alarm queued even if the app is killed.
    const seconds = Math.max(60, Math.round((fireAt.getTime() - Date.now()) / 1000));
    await Notifications.scheduleNotificationAsync({
      identifier: BRIEF_NUDGE_IDENTIFIER,
      content: {
        title: 'Morning brief',
        body: 'Your morning brief is ready.',
        data: { kind: 'morning_brief' },
        sound: 'default',
      },
      trigger: { seconds, channelId: Platform.OS === 'android' ? 'default' : undefined } as never,
    });
    return true;
  } catch (err) {
    console.log('[BriefNudge] arm failed:', err);
    return false;
  }
}

/** Cancel the pending nudge (digest toggled off). Safe on web / no-op. */
export async function disarmDailyBriefNudge(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(BRIEF_NUDGE_IDENTIFIER);
  } catch {
    // Nothing scheduled — fine.
  }
}
