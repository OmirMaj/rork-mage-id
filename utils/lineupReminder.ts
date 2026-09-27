// utils/lineupReminder.ts — the 3 pm weekday "tomorrow's lineup" reminder.
//
// Five OS-scheduled WEEKLY local notifications (Mon–Fri, 15:00 local), each
// under a FIXED identifier (mageid-lineup-reminder-<weekday>), so cancel and
// re-arm never need a stored id — the OS schedule is the only source of truth
// and there is no stored key to sweep on sign-out.
//
// It is a doorbell, not a report: it cannot see the schedule, so it rings even
// when tomorrow is empty, and it sends nothing to any sub. The content carries
// NO project, sub or schedule data (a shared phone after sign-out must not leak
// anything); a tap opens /tomorrow-lineup for whoever is signed in
// (NotificationContext → notificationRoute('tomorrow_lineup')).
//
// Opt-in only. The OS permission prompt is raised only from his tap on the
// toggle in app/tomorrow-lineup.tsx (prompt: true) — never cold. Pattern:
// utils/weekClose/nudge.ts (ensurePermission, Android 'default' channel,
// `type` REQUIRED on every trigger, web no-op).

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { BRAND_ACCENT } from '@/constants/colors';

/** The stem of the five OS notification identifiers (the same family as
 *  'mageid-week-close-nudge'). An OS schedule id, NOT a local-storage key —
 *  nothing is written to device storage under it. */
const LINEUP_REMINDER_IDENTIFIER_STEM = 'mageid-lineup-reminder-';
export const LINEUP_REMINDER_ID_PREFIX = LINEUP_REMINDER_IDENTIFIER_STEM;
export const LINEUP_REMINDER_HOUR = 15;
export const LINEUP_REMINDER_MINUTE = 0;
/** expo-notifications weekday numbering: 1 = Sunday … 7 = Saturday. Mon–Fri. */
export const LINEUP_REMINDER_WEEKDAYS = [2, 3, 4, 5, 6] as const;

export const lineupReminderCopy = {
  title: 'Tomorrow’s lineup',
  body: 'It’s 3 pm — check tomorrow’s lineup and send each sub their message.',
  toggle: 'Remind me at 3 pm on weekdays',
  help: 'A reminder on this phone at 3:00 pm, Monday to Friday. It can’t see your schedule, so it rings even when tomorrow is empty. Nothing is sent to your subs — you still tap Send for each one.',
  web: 'Reminders work in the iPhone app.',
  noPermission: 'Notifications are off for MAGE ID. Turn them on in Settings to get this reminder.',
  failed: 'Couldn’t set the reminder on this phone — try again.',
  readFailed: 'Couldn’t check whether the reminder is on.',
};

export type LineupReminderArmResult = 'armed' | 'no_permission' | 'web' | 'failed';

const IDS: readonly string[] = LINEUP_REMINDER_WEEKDAYS.map(w => `${LINEUP_REMINDER_ID_PREFIX}${w}`);

/** The five schedule requests. Pure: no project, sub or schedule data. */
export function lineupReminderRequests(): Notifications.NotificationRequestInput[] {
  return LINEUP_REMINDER_WEEKDAYS.map(weekday => ({
    identifier: `${LINEUP_REMINDER_ID_PREFIX}${weekday}`,
    content: {
      title: lineupReminderCopy.title,
      body: lineupReminderCopy.body,
      data: { kind: 'tomorrow_lineup' },
      sound: 'default',
    },
    // `type` is REQUIRED — a trigger without it parses to null, and a null
    // trigger fires IMMEDIATELY (see utils/weekClose/nudge.ts).
    trigger: {
      type: SchedulableTriggerInputTypes.WEEKLY,
      weekday,
      hour: LINEUP_REMINDER_HOUR,
      minute: LINEUP_REMINDER_MINUTE,
      channelId: Platform.OS === 'android' ? 'default' : undefined,
    },
  }));
}

async function ensurePermission(prompt: boolean): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  if (!prompt) return false;
  const res = await Notifications.requestPermissionsAsync();
  return res.status === 'granted';
}

async function cancelAll(): Promise<void> {
  await Promise.all(IDS.map(id => Notifications.cancelScheduledNotificationAsync(id).catch(() => {})));
}

/**
 * Schedule the five weekday reminders. Pass `prompt: true` only from his tap on
 * the toggle (never cold-prompt). Any failure cancels whatever was scheduled so
 * a half-armed week never lingers.
 */
export async function armLineupReminder(opts: { prompt?: boolean }): Promise<LineupReminderArmResult> {
  if (Platform.OS === 'web') return 'web';
  try {
    if (!(await ensurePermission(opts.prompt === true))) return 'no_permission';

    if (Platform.OS === 'android') {
      // Idempotent channel setup — mirrors armDailyBriefNudge / armWeekCloseNudge.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: BRAND_ACCENT,
      });
    }

    await cancelAll();
    for (const req of lineupReminderRequests()) {
      await Notifications.scheduleNotificationAsync(req);
    }
    return 'armed';
  } catch (err) {
    console.warn('[LineupReminder] arm failed:', err);
    await cancelAll();
    return 'failed';
  }
}

/** Cancel the five reminders (toggled off). Web no-op. */
export async function disarmLineupReminder(): Promise<void> {
  if (Platform.OS === 'web') return;
  await cancelAll();
}

/**
 * Whether the reminder is on, read from the OS schedule: true when all five
 * are scheduled, false when none — or only some (the toggle then reads off and
 * a tap re-arms cleanly). null when the schedule could not be read. Web → false.
 */
export async function isLineupReminderArmed(): Promise<boolean | null> {
  if (Platform.OS === 'web') return false;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const have = new Set((scheduled ?? []).map(n => n.identifier));
    return IDS.every(id => have.has(id));
  } catch {
    return null;
  }
}
