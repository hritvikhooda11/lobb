/**
 * POST /api/account/delete — deletes the signed-in user's account and data (App Store requirement).
 * Refuses while they have an order or delivery in progress. Their photos are removed too.
 */
import { supabaseAdmin, userIdFromRequest } from '@/lib/supabase-admin';

export async function POST(request: Request): Promise<Response> {
  const userId = await userIdFromRequest(request);
  if (!userId || !supabaseAdmin) return Response.json({ error: 'Sign in first' }, { status: 401 });
  const db = supabaseAdmin;

  const { data: blocker, error } = await db.rpc('account_deletion_blocker', { p_user: userId });
  if (error) return Response.json({ error: 'Couldn’t delete your account. Try again.' }, { status: 502 });
  if (blocker) return Response.json({ error: blocker }, { status: 409 });

  for (const bucket of ['item-photos', 'handoff-photos']) {
    const { data: files } = await db.storage.from(bucket).list(userId, { limit: 1000 });
    if (files?.length) await db.storage.from(bucket).remove(files.map((f) => `${userId}/${f.name}`));
  }
  const { error: deleteError } = await db.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('[account/delete]', deleteError);
    return Response.json({ error: 'Couldn’t delete your account. Try again.' }, { status: 502 });
  }
  return Response.json({ deleted: true });
}
