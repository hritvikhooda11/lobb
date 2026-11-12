import { Redirect, useLocalSearchParams } from 'expo-router';

/** lobb://pay-return — where Stripe sends people back (usually caught by the in-app browser first). */
export default function PayReturn() {
  const { flow, kind, id } = useLocalSearchParams<{ flow?: string; kind?: string; id?: string }>();
  if (flow === 'payouts') return <Redirect href="/profile" />;
  if (kind === 'shoutout') return <Redirect href="/shoutouts" />;
  if (kind === 'request' && id) return <Redirect href={{ pathname: '/request/[id]', params: { id } }} />;
  return <Redirect href="/" />;
}
