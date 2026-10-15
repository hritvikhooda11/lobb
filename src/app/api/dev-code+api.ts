/**
 * POST /api/dev-code { email } → { code } — DEVELOPMENT / DEMO ONLY.
 *
 * Returns a real 6-digit sign-in code without sending an email, so we can test with
 * several accounts (and give App Review a demo login). The database still enforces the
 * email-domain allowlist. Disabled unless LOBB_DEV_LOGIN=1 is set on the server, and
 * never in production builds.
 */
import { supabaseAdmin } from '@/lib/supabase-admin';

const enabled = () => process.env.LOBB_DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production';

export async function POST(request: Request) {
  if (!enabled()) return Response.json({ error: 'Not found' }, { status: 404 });
  if (!supabaseAdmin) return Response.json({ error: 'SUPABASE_SERVICE_ROLE_KEY is missing from .env' }, { status: 500 });

  let email = '';
  try {
    email = String((await request.json()).email ?? '').trim().toLowerCase();
  } catch {
    // fall through to validation
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: 'Enter a valid email' }, { status: 400 });

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) {
    const message = /Database error/i.test(error.message) ? 'That email domain isn’t allowed on Lobb.' : error.message;
    return Response.json({ error: message }, { status: 400 });
  }
  return Response.json({ code: data.properties.email_otp });
}
