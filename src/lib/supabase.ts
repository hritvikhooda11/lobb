/**
 * Supabase client for the app. Reads the project URL and *publishable* key from
 * EXPO_PUBLIC_* env vars (safe to ship in the app — row-level security protects the data).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';
import { AppState, Platform } from 'react-native';

import { secureSessionStorage } from './secure-session';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const supabaseConfigured = !!url && !!key;

export const supabase = createClient(url || 'https://not-configured.supabase.co', key || 'not-configured', {
  auth: {
    // Phones: session encrypted at rest (key in Keychain/Keystore). Web: browser storage; server render: none.
    storage: Platform.OS === 'web' ? (typeof window === 'undefined' ? undefined : AsyncStorage) : secureSessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Only refresh tokens while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Uploads a base64 JPEG to Storage and returns its path. */
export async function uploadPhoto(bucket: 'item-photos' | 'handoff-photos', userId: string, name: string, base64: string) {
  const path = `${userId}/${name}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(bucket).upload(path, decode(base64), { contentType: 'image/jpeg' });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return path;
}

export const publicPhotoUrl = (path: string) => supabase.storage.from('item-photos').getPublicUrl(path).data.publicUrl;

/** Turns a Postgres exception from our functions into a readable message. */
export function friendlyError(error: unknown) {
  const message = (error as { message?: string })?.message ?? String(error);
  if (/Database error saving new user/i.test(message)) return 'Lobb is only open to @uw.edu email addresses.';
  return message.replace(/^.*?exception:\s*/i, '');
}

/**
 * A Realtime channel with a unique name. Supabase reuses a channel with the same name, so when a
 * screen re-subscribes (React re-running an effect, or reopening a screen) before the old channel is
 * removed, adding listeners to the reused, already-subscribed channel throws.
 */
export const uniqueChannel = (name: string) => supabase.channel(`${name}-${Math.random().toString(36).slice(2, 10)}`);
