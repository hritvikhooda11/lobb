/** POST /api/pay/checkout { kind: 'request' | 'shoutout', id, platform: 'web' | 'native' } → { url } (Stripe Checkout). */
import { createCheckout, PaymentError, type PayKind, type Platform } from '@/lib/server/payments';
import { userIdFromRequest } from '@/lib/supabase-admin';

export async function POST(request: Request): Promise<Response> {
  const userId = await userIdFromRequest(request);
  if (!userId) return Response.json({ error: 'Sign in first' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { kind?: PayKind; id?: string; platform?: Platform } | null;
  if (!body?.id || (body.kind !== 'request' && body.kind !== 'shoutout')) return Response.json({ error: 'Bad request' }, { status: 400 });
  try {
    return Response.json({ url: await createCheckout(userId, body.kind, body.id, body.platform === 'web' ? 'web' : 'native') });
  } catch (e) {
    console.error('[pay/checkout]', e);
    return Response.json({ error: e instanceof PaymentError ? e.message : 'Couldn’t start checkout. Try again.' }, { status: e instanceof PaymentError ? e.status : 502 });
  }
}
