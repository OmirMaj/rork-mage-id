import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Register for push notifications. The `prompt` flag controls whether
 * we'll fire the iOS / Android system permission dialog.
 *
 * Audit found we were prompting on first authenticated render — before
 * the user had done anything in the app. iOS denial is permanent (until
 * Settings dive), so a cold-prompt with no rationale tanks acceptance.
 *
 * Default `prompt: false` means "register IF the user already said yes
 * in a previous session." Pass `prompt: true` from a user-initiated
 * action (Settings toggle, a "Get notified when this CO is signed?"
 * inline button, etc.) so the prompt has context.
 */
export async function registerForPushNotifications(opts: { prompt?: boolean } = {}): Promise<string | null> {
  if (Platform.OS === 'web') {
    console.log('[Notifications] Web platform — skipping push registration');
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      if (!opts.prompt) {
        // Caller doesn't want to prompt cold — bail without firing the
        // system dialog. The user can opt in later from Settings.
        console.log('[Notifications] Permission not granted; not prompting (caller opted out).');
        return null;
      }
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission not granted');
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ??
      process.env.EXPO_PUBLIC_PROJECT_ID;

    if (!projectId) {
      console.log('[Notifications] No project ID found for push token');
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('[Notifications] Push token:', tokenData.data);

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#1A6B3C',
      });
    }

    return tokenData.data;
  } catch (err) {
    console.log('[Notifications] Registration error:', err);
    return null;
  }
}

export async function sendLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: null,
    });
    console.log('[Notifications] Local notification sent:', title);
  } catch (err) {
    console.log('[Notifications] Failed to send local notification:', err);
  }
}

/**
 * Schedule a local notification to fire at a future date. Used by the
 * Time Tracking screen to alert the GC when a crew member hits their
 * shift threshold (default 8h). Returns the OS identifier so the caller
 * can cancel it later (e.g. on clock-out / break).
 *
 * Web: expo-notifications is a no-op on web, so we return null and let
 * the screen fall back to its in-app banner.
 */
export async function scheduleLocalNotificationAt(opts: {
  title: string;
  body: string;
  fireAt: Date;
  data?: Record<string, unknown>;
}): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const seconds = Math.max(1, Math.round((opts.fireAt.getTime() - Date.now()) / 1000));
  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: { title: opts.title, body: opts.body, data: opts.data, sound: 'default' },
      // The DATE trigger type is the cleanest fit but we use the seconds
      // form because expo's DateTriggerInput has been finicky across SDKs.
      // Seconds-from-now is rock solid and lets the OS keep the alarm
      // queued even if the app is killed.
      trigger: { seconds, channelId: Platform.OS === 'android' ? 'default' : undefined } as any,
    });
    return id;
  } catch (err) {
    console.log('[Notifications] Failed to schedule notification:', err);
    return null;
  }
}

/**
 * Cancel a previously-scheduled notification. Safe to call with a null
 * id (no-op) so the caller doesn't have to null-check.
 */
export async function cancelScheduledNotification(id: string | null | undefined): Promise<void> {
  if (!id || Platform.OS === 'web') return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (err) {
    console.log('[Notifications] Failed to cancel notification:', err);
  }
}

export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void,
) {
  return Notifications.addNotificationReceivedListener(callback);
}

export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void,
) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}
