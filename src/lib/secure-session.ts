/**
 * Encrypted storage for the Supabase session on iOS/Android.
 *
 * The session (access + refresh token) is too big for the Keychain/Keystore on some devices,
 * so it is AES-256-GCM encrypted with expo-crypto and the ciphertext goes in AsyncStorage.
 * Only the 32-byte key lives in SecureStore (Keychain on iOS, Keystore on Android), readable
 * after the first unlock so token refresh still works when a push wakes the app.
 *
 * Anything stored by an older build in plain text is read once and re-saved encrypted.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY_PREFIX = 'lobb.session-key.';
const PREFIX = 'enc1:';
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

// SecureStore keys may only contain letters, digits, ".", "-" and "_".
const secureKeyName = (key: string) => KEY_PREFIX + key.replace(/[^A-Za-z0-9._-]/g, '_');

// AES input/output strings are base64, so round-trip text through UTF-8 base64.
const toBase64 = (text: string) => btoa(unescape(encodeURIComponent(text)));
const fromBase64 = (b64: string) => decodeURIComponent(escape(atob(b64)));

async function encryptionKey(key: string, create: boolean) {
  const name = secureKeyName(key);
  const hex = await SecureStore.getItemAsync(name, options);
  if (hex) return AESEncryptionKey.import(hex, 'hex');
  if (!create) return null;
  const fresh = await AESEncryptionKey.generate();
  await SecureStore.setItemAsync(name, await fresh.encoded('hex'), options);
  return fresh;
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (stored == null) return null;
    if (!stored.startsWith(PREFIX)) {
      // Plain-text session from a build before encryption: upgrade it in place.
      await secureSessionStorage.setItem(key, stored);
      return stored;
    }
    try {
      const aes = await encryptionKey(key, false);
      if (!aes) throw new Error('missing key');
      const plain = await aesDecryptAsync(AESSealedData.fromCombined(stored.slice(PREFIX.length)), aes, { output: 'base64' });
      return fromBase64(plain as string);
    } catch {
      // Key lost (e.g. restored to a new phone) or data tampered with: sign the user out cleanly.
      await secureSessionStorage.removeItem(key);
      return null;
    }
  },

  async setItem(key: string, value: string) {
    const aes = await encryptionKey(key, true);
    const sealed = await aesEncryptAsync(toBase64(value), aes!);
    await AsyncStorage.setItem(key, PREFIX + (await sealed.combined('base64')));
  },

  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(secureKeyName(key), options);
  },
};
