/**
 * Neighbors' payouts (Stripe Connect).
 * GET  → { hasAccount, payoutsEnabled }
 * POST { action: 'onboard' | 'dashboard', platform } → { url }
 */
import { payoutDashboardUrl, payoutOnboardingUrl, PaymentError, refreshPayoutStatus, settle } from '@/lib/server/payments';
import { userIdFromRequest } from '@/lib/supabase-admin';

export async function GET(request: Request): Promise<Response> {
  const userId = await userIdFromRequest(request);
  if (!userId) return Response.json({ error: 'Sign in first' }, { status: 401 });
  try {
    const status = await refreshPayoutStatus(userId);
    // Money that was waiting for this neighbor goes out as soon as payouts are on.
    if (status.payoutsEnabled) await settle().catch(() => {});
    return Response.json(status);
  } catch (e) {
    return Response.json({ error: e instanceof PaymentError ? e.message : 'Couldn’t check payouts' }, { status: e instanceof PaymentError ? e.status : 502 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await userIdFromRequest(request);
  if (!userId) return Response.json({ error: 'Sign in first' }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: string; platform?: string } | null;
  const platform = body?.platform === 'web' ? 'web' : 'native';
  try {
    const url = body?.action === 'dashboard' ? await payoutDashboardUrl(userId) : await payoutOnboardingUrl(userId, platform);
    return Response.json({ url });
  } catch (e) {
    console.error('[pay/payouts]', e);
    return Response.json({ error: e instanceof PaymentError ? e.message : 'Couldn’t open Stripe. Try again.' }, { status: e instanceof PaymentError ? e.status : 502 });
  }
}
