// Sends remote push notifications for new shout-outs and new orders.
//
// Two database webhooks (Database → Webhooks, see SUPABASE_SETUP.md) call this on INSERT into
// public.shoutouts and public.requests. Who gets notified and the exact text come from the
// database (public.push_messages, tested in supabase/tests/flows.test.mjs), so this function only
// batches the messages to Expo's push API and forgets phones Expo says are gone.
//
// Secrets: PUSH_WEBHOOK_SECRET (required, sent by the webhooks as the x-lobb-webhook-secret header)
// and EXPO_ACCESS_TOKEN (only if "enhanced push security" is on in the EAS dashboard).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
import { createClient } from 'jsr:@supabase/supabase-js@2';

type WebhookPayload = { type: 'INSERT' | 'UPDATE' | 'DELETE'; table: string; schema: string; record: { id: string } | null };
type PushMessage = { token: string; title: string; body: string; url: string; kind: 'shoutout' | 'order' };
type Ticket = { status: 'ok'; id: string } | { status: 'error'; message: string; details?: { error?: string } };

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo's limit per request

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_WEBHOOK_SECRET');
  if (!secret || req.headers.get('x-lobb-webhook-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = (await req.json()) as WebhookPayload;
  if (payload.type !== 'INSERT' || payload.schema !== 'public' || !payload.record?.id || !['shoutouts', 'requests'].includes(payload.table)) {
    return Response.json({ sent: 0, skipped: 'not a new shout-out or request' });
  }

  const { data, error } = await supabase.rpc('push_messages', { p_table: payload.table, p_id: payload.record.id });
  if (error) {
    console.error('push_messages failed', error);
    return new Response(error.message, { status: 500 });
  }
  const messages = (data ?? []) as PushMessage[];

  let sent = 0;
  const gone: string[] = [];
  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    const tickets = await sendBatch(
      batch.map((m) => ({
        to: m.token,
        title: m.title,
        body: m.body,
        // `url` opens the right screen when tapped; `kind` lets the open app skip duplicate banners.
        data: { url: m.url, kind: m.kind },
        sound: 'default',
        channelId: 'default',
        priority: 'high',
        // An order is only worth accepting for a few minutes; a shout-out expires in 2 hours.
        ttl: m.kind === 'order' ? 600 : 7200,
      })),
    );
    tickets.forEach((t, j) => {
      if (t.status === 'ok') sent++;
      else if (t.details?.error === 'DeviceNotRegistered') gone.push(batch[j].token);
      else console.warn('push ticket error', t.message);
    });
  }

  if (gone.length) await supabase.rpc('forget_push_tokens', { p_tokens: gone });
  return Response.json({ sent, forgotten: gone.length });
});

/** POSTs one batch to Expo, retrying 429/5xx with backoff. Returns one ticket per message. */
async function sendBatch(messages: object[]): Promise<Ticket[]> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (token) headers.authorization = `Bearer ${token}`;

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
    if (res.ok) return ((await res.json()) as { data: Ticket[] }).data;
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    console.error('Expo push failed', res.status, await res.text());
    return messages.map(() => ({ status: 'error', message: `HTTP ${res.status}` }));
  }
}
