/**
 * POST /api/dev-reset — DEVELOPMENT / DEMO ONLY.
 *
 * Clears the signed-in user's requests (as buyer or deliverer), listings and price quotes so a
 * demo can be run again from scratch. Disabled unless LOBB_DEV_LOGIN=1 on the server, and
 * never in production builds.
 */
import { supabaseAdmin, userIdFromRequest } from '@/lib/supabase-admin';

const enabled = () => process.env.LOBB_DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production';

export async function POST(request: Request) {
  if (!enabled()) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!supabaseAdmin) return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is missing from .env' }, { status: 500 });

  const userId = await userIdFromRequest(request);
  if (!userId) return Response.json({ error: 'Sign in first' }, { status: 401 });

  const results = await Promise.all([
    supabaseAdmin.from('requests').delete().or(`buyer_id.eq.${userId},accepted_by.eq.${userId}`),
    supabaseAdmin.from('listings').delete().eq('seller_id', userId),
    supabaseAdmin.from('price_quotes').delete().eq('user_id', userId),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 });
  return Response.json({ ok: true });
}
