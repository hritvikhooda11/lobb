/**
 * Phone notifications (the normal banner that drops from the top and lands in Notification Center).
 *
 * Two sources:
 *  - **Remote push** (development build / TestFlight on a real phone): after sign-in the phone
 *    registers an Expo push token, and the `push` Edge Function sends new shout-outs and orders
 *    through APNs/FCM, so they arrive even when Lobb is fully closed.
 *  - **Local** notifications as the fallback (Expo Go, Simulator, permission for push missing): the
 *    app shows them itself when Realtime reports something new, so they only work while Lobb is open
 *    or was just backgrounded.
 * When remote push is active, callers skip the local copy of events the server already pushes, so
 * nobody gets the same banner twice. On web there are no system notifications; callers show a toast.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export const systemNotificationsSupported = Platform.OS === 'ios' || Platform.OS === 'android';

/** Events the server pushes (matches `kind` in public.push_messages). */
export type PushKind = 'shoutout' | 'order';

let pushToken: string | null = null;

/** True once this phone is registered for remote push, so the server delivers shout-outs and orders. */
export const remotePushActive = () => pushToken !== null;

if (systemNotificationsSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      // A pushed order while Lobb is open: the in-app takeover/banner already shows it.
      const order = notification.request.content.data?.kind === 'order';
      // Otherwise show the banner even while Lobb is open (iOS hides foreground notifications by default).
      return { shouldShowBanner: !order, shouldShowList: true, shouldPlaySound: !order, shouldSetBadge: false };
    },
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

/**
 * Registers this phone for remote push and saves its token for the signed-in user. Does nothing
 * (and local notifications stay in charge) in Expo Go, on a simulator, without an EAS project ID,
 * or without notification permission.
 */
export async function registerForRemotePush(): Promise<boolean> {
  if (!systemNotificationsSupported || !Device.isDevice) return false;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false; // Expo Go
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return false;
  if (!(await ensureNotificationPermission())) return false;
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    if (error) throw error;
    pushToken = token;
    return true;
  } catch (e) {
    console.warn('[lobb] push registration failed; using local notifications', e);
    return false;
  }
}

/** Call before signing out so this phone stops getting the old account's notifications. */
export async function unregisterRemotePush() {
  if (!pushToken) return;
  const token = pushToken;
  pushToken = null;
  await supabase.from('push_tokens').delete().eq('expo_push_token', token);
}

/**
 * Shows a notification right away. `url` is the in-app route to open when it's tapped. Pass
 * `pushedAs` for events the server also pushes; the local copy is then skipped when push is active.
 */
export async function notify(title: string, body: string, url: string, pushedAs?: PushKind) {
  if (!systemNotificationsSupported) return;
  if (pushedAs && remotePushActive()) return;
  await Notifications.scheduleNotificationAsync({ content: { title, body, data: { url }, sound: true }, trigger: null });
}

/**
 * Calls `onOpen(url)` when someone taps a Lobb notification, including the one that launched the
 * app from closed. Returns an unsubscribe function.
 */
export function onNotificationTap(onOpen: (url: string) => void) {
  if (!systemNotificationsSupported) return () => {};
  const open = (response: Notifications.NotificationResponse | null) => {
    const url = response?.notification.request.content.data?.url;
    if (typeof url === 'string') onOpen(url);
  };
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    open(response);
    void Notifications.clearLastNotificationResponseAsync();
  });
  const sub = Notifications.addNotificationResponseReceivedListener(open);
  return () => sub.remove();
}
