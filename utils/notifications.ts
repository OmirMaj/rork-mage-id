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
