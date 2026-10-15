import * as ImagePicker from 'expo-image-picker';
import { Alert, Platform } from 'react-native';

export type Photo = { uri: string; base64?: string | null };

/**
 * Takes a photo with the camera. Falls back to the photo library when there is no
 * camera (iOS Simulator, web) or camera permission is denied.
 */
export async function takePhoto({ base64 = false }: { base64?: boolean } = {}): Promise<Photo | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.5, base64, allowsEditing: true, aspect: [1, 1] };

  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (permission.granted) {
      try {
        const result = await ImagePicker.launchCameraAsync(options);
        if (result.canceled) return null;
        return result.assets[0];
      } catch {
        // No camera available (e.g. Simulator) — fall through to the library.
      }
    } else if (!permission.canAskAgain) {
      Alert.alert('Camera is off', 'Turn on camera access for Lobb in Settings, or pick a photo instead.');
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  return result.assets[0];
}
