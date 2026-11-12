/**
 * POST /api/stripe/webhook — Stripe events (signed with STRIPE_WEBHOOK_SECRET, or
 * STRIPE_CONNECT_WEBHOOK_SECRET for connected accounts' events).
 *  checkout.session.completed → the order / shout-out goes live
 *  account.updated            → a neighbor finished payouts setup
 * Each event also runs settle(), so anything due is charged, released or paid out.
 */
import { accountUpdated, checkoutCompleted, settle, stripe, stripeCrypto } from '@/lib/server/payments';

export async function POST(request: Request): Promise<Response> {
  // Two endpoints share this URL: Lobb's own events, and connected accounts' (neighbors' payouts).
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((x): x is string => !!x);
  const signature = request.headers.get('stripe-signature');
  if (!stripe || !secrets.length || !signature) return new Response('Not configured', { status: 400 });
  const payload = await request.text();
  let event: Awaited<ReturnType<typeof stripe.webhooks.constructEventAsync>> | null = null;
  for (const secret of secrets) {
    try {
      event = await stripe.webhooks.constructEventAsync(payload, signature, secret, undefined, stripeCrypto);
      break;
    } catch {
      // Try the other endpoint's secret.
    }
  }
  if (!event) return new Response('Bad signature', { status: 400 });
  try {
    if (event.type === 'checkout.session.completed') await checkoutCompleted(event.data.object.id);
    if (event.type === 'account.updated') await accountUpdated(event.data.object.id);
    await settle();
  } catch (e) {
    console.error('[stripe/webhook]', event.type, e);
    return new Response('Retry', { status: 500 });
  }
  return Response.json({ received: true });
}
