/**
 * SERVER ONLY (import from +api.ts routes, never from screens).
 * Uses the service-role key, which bypasses row-level security.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

/** Returns the signed-in user's id from the request's `Authorization: Bearer <jwt>` header. */
export async function userIdFromRequest(request: Request) {
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  return error ? null : data.user.id;
}
