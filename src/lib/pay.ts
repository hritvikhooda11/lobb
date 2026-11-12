/**
 * App side of payments: opens Stripe (Checkout, or payouts setup) and asks the server to settle.
 * Native: an in-app browser that closes itself when Stripe sends the user back (lobb://pay-return).
 * Web: a normal redirect; Stripe sends the user back to the right screen.
 */
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const platform = Platform.OS === 'web' ? 'web' : 'native';

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? 'Something went wrong. Try again.');
  return json;
}

/** Opens a Stripe page. Resolves when the user is back in the app (native); on web the page navigates away. */
async function open(url: string) {
  if (platform === 'web') {
    window.location.assign(url);
    return;
  }
  await WebBrowser.openAuthSessionAsync(url, 'lobb://pay-return');
}

/** Pay for an order or shout-out that's waiting for payment. */
export async function payFor(kind: 'request' | 'shoutout', id: string) {
  const { url } = await api<{ url: string }>('/api/pay/checkout', { body: { kind, id, platform } });
  await open(url);
}

/** Set up (or open) the neighbor's Stripe payouts. */
export async function openPayouts(action: 'onboard' | 'dashboard') {
  const { url } = await api<{ url: string }>('/api/pay/payouts', { body: { action, platform } });
  await open(url);
}

export const payoutStatus = () => api<{ hasAccount: boolean; payoutsEnabled: boolean }>('/api/pay/payouts');

/** Charge / release / pay out whatever is due. Fire and forget after handoffs and cancels. */
export function settlePayments() {
  api('/api/pay/settle', { body: {} }).catch(() => {});
}
