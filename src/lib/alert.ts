import { Alert, Platform } from 'react-native';

export function showError(message: string, title = 'Hmm') {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

/** Runs an async action and shows its error to the user instead of throwing. Returns true on success. */
export async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn();
    return true;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

/** Yes/no confirmation that works on iOS, Android and web. */
export function confirm(title: string, message: string, confirmLabel = 'OK'): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}
