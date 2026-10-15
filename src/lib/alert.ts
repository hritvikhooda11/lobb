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
