/**
 * POST /api/pay/settle — charges handed-over orders, releases cancelled ones and pays neighbors out.
 * Safe to call any time (it only acts on what the database says is due). Called by the app after a
 * handoff or cancel, and on a schedule with the x-lobb-cron-secret header (LOBB_CRON_SECRET).
 */
import { settle } from '@/lib/server/payments';
import { userIdFromRequest } from '@/lib/supabase-admin';

export async function POST(request: Request): Promise<Response> {
  const cron = process.env.LOBB_CRON_SECRET && request.headers.get('x-lobb-cron-secret') === process.env.LOBB_CRON_SECRET;
  if (!cron && !(await userIdFromRequest(request))) return Response.json({ error: 'Sign in first' }, { status: 401 });
  try {
    return Response.json({ done: await settle() });
  } catch (e) {
    console.error('[pay/settle]', e);
    return Response.json({ error: 'Settling failed' }, { status: 502 });
  }
}
