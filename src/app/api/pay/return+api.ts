/**
 * GET /api/pay/return — where Stripe sends people back after Checkout or payouts onboarding.
 * Confirms the payment right away (in case the webhook is slow), then:
 *  - native app: bounces to lobb://pay-return so the in-app browser closes;
 *  - web: redirects to the right screen.
 */
import { checkoutCompleted, ORIGIN } from '@/lib/server/payments';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const p = url.searchParams;
  const sessionId = p.get('session_id');
  if (sessionId && p.get('status') === 'paid') await checkoutCompleted(sessionId).catch((e) => console.error('[pay/return]', e));

  const kind = p.get('kind');
  const id = p.get('id') ?? '';
  const params = new URLSearchParams({ status: p.get('status') ?? '', flow: p.get('flow') ?? 'checkout', kind: kind ?? '', id });
  if (p.get('native') === '1') {
    const deep = `lobb://pay-return?${params.toString()}`;
    const html = `<!doctype html><meta name="viewport" content="width=device-width"><title>Back to Lobb</title>
<body style="font-family:-apple-system,system-ui;background:#16111F;color:#F5F2FF;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<a href="${deep}" style="color:#C8FF3D;font-size:18px">Back to Lobb</a><script>location.replace(${JSON.stringify(deep)})</script></body>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const to = p.get('flow') === 'payouts' ? '/profile' : kind === 'shoutout' ? '/shoutouts' : id ? `/request/${id}` : '/';
  return Response.redirect(`${ORIGIN}${to}`, 302);
}
