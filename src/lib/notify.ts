/**
 * Phone notifications (the normal banner that drops from the top and lands in Notification Center).
 *
 * Today these are *local* notifications: the app shows them when Realtime tells it about something
 * new, so they work in Expo Go and while Lobb is open or was just backgrounded. Getting them when
 * the app is fully closed needs remote push (APNs) from the server, which needs a TestFlight /
 * development build. On web there are no system notifications, so callers show an in-app toast.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const systemNotificationsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

if (systemNotificationsSupported) {
  // Show the banner even while Lobb is open (iOS hides foreground notifications by default).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

/** Asks once; returns whether Lobb may show notifications. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!systemNotificationsSupported) return false;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Lobb', importance: Notifications.AndroidImportance.HIGH });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

/** Shows a notification right away. `url` is the in-app route to open when it's tapped. */
export async function notify(title: string, body: string, url: string) {
  if (!systemNotificationsSupported) return;
  await Notifications.scheduleNotificationAsync({ content: { title, body, data: { url }, sound: true }, trigger: null });
}

/** Calls `onOpen(url)` when someone taps a Lobb notification. Returns an unsubscribe function. */
export function onNotificationTap(onOpen: (url: string) => void) {
  if (!systemNotificationsSupported) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = response.notification.request.content.data?.url;
    if (typeof url === 'string') onOpen(url);
  });
  return () => sub.remove();
}
