/**
 * POST /api/stripe/webhook — Stripe events (signed with STRIPE_WEBHOOK_SECRET).
 *  checkout.session.completed → the order / shout-out goes live
 *  account.updated            → a neighbor finished payouts setup
 * Each event also runs settle(), so anything due is charged, released or paid out.
 */
import { accountUpdated, checkoutCompleted, settle, stripe, stripeCrypto } from '@/lib/server/payments';

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get('stripe-signature');
  if (!stripe || !secret || !signature) return new Response('Not configured', { status: 400 });
  const payload = await request.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(payload, signature, secret, undefined, stripeCrypto);
  } catch {
    return new Response('Bad signature', { status: 400 });
  }
  try {
    if (event.type === 'checkout.session.completed') await checkoutCompleted(event.data.object.id);
    if (event.type === 'account.updated') await accountUpdated(event.data.object);
    await settle();
  } catch (e) {
    console.error('[stripe/webhook]', event.type, e);
    return new Response('Retry', { status: 500 });
  }
  return Response.json({ received: true });
}
