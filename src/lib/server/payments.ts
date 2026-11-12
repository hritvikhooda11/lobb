/**
 * SERVER ONLY. Payments with Stripe.
 *
 *  - Buyers pay with Stripe Checkout. The card is only authorized (capture_method: manual); it's
 *    charged when the item changes hands, or, for rentals, when it comes back (the deposit part of the
 *    hold is released then).
 *  - Neighbors who deliver are paid with Stripe Connect (Express accounts) by a transfer after the
 *    charge. If they haven't set up payouts yet, the money waits and is sent once they do.
 *  - The database decides what needs doing (public.payments_to_settle); settle() does it. It's
 *    idempotent, so it's safe to call from the app after a handoff, from the webhook, and on a schedule.
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and optionally LOBB_ORIGIN (default https://lobb.expo.app).
 */
import Stripe from 'stripe';

import { supabaseAdmin } from '@/lib/supabase-admin';

const key = process.env.STRIPE_SECRET_KEY;
export const stripe = key ? new Stripe(key, { httpClient: Stripe.createFetchHttpClient() }) : null;
export const stripeCrypto = Stripe.createSubtleCryptoProvider();

export const ORIGIN = (process.env.LOBB_ORIGIN ?? 'https://lobb.expo.app').replace(/\/$/, '');

export type PayKind = 'request' | 'shoutout';
export type Platform = 'web' | 'native';

function services() {
  if (!stripe || !supabaseAdmin) throw new PaymentError('Payments aren’t set up on the server yet.', 503);
  return { stripe, db: supabaseAdmin };
}

export class PaymentError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Where Stripe sends people back to. The return route bounces native users back into the app. */
export const returnUrl = (params: Record<string, string>) => `${ORIGIN}/api/pay/return?${new URLSearchParams(params).toString()}`;

async function accountRow(userId: string) {
  const { db } = services();
  const { data } = await db.from('payment_accounts').select('*').eq('user_id', userId).maybeSingle();
  return data as { user_id: string; stripe_customer_id: string | null; stripe_account_id: string | null; payouts_enabled: boolean } | null;
}

async function saveAccount(userId: string, fields: Record<string, unknown>) {
  const { db } = services();
  const { error } = await db.from('payment_accounts').upsert({ user_id: userId, ...fields, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

async function userEmail(userId: string) {
  const { db } = services();
  const { data } = await db.auth.admin.getUserById(userId);
  return data.user?.email ?? undefined;
}

async function customerFor(userId: string) {
  const { stripe } = services();
  const row = await accountRow(userId);
  if (row?.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripe.customers.create({ email: await userEmail(userId), metadata: { user_id: userId } }, { idempotencyKey: `customer-${userId}` });
  await saveAccount(userId, { stripe_customer_id: customer.id });
  return customer.id;
}

// ── Checkout ────────────────────────────────────────────────────────────────

/** A Stripe Checkout page for an order or shout-out that's waiting for payment. Returns its URL. */
export async function createCheckout(userId: string, kind: PayKind, id: string, platform: Platform) {
  const { stripe, db } = services();
  const lines: { name: string; amount: number }[] = [];
  let description = '';

  if (kind === 'request') {
    const { data: r } = await db.from('requests').select('id, buyer_id, status, kind, total, hold_amount, item_id').eq('id', id).maybeSingle();
    if (!r || r.buyer_id !== userId) throw new PaymentError('Order not found', 404);
    if (r.status !== 'pending_payment') throw new PaymentError('This order is already paid for or closed.');
    const { data: item } = await db.from('items').select('name').eq('id', r.item_id).maybeSingle();
    const name = item?.name ?? 'Lobb order';
    description = r.kind === 'rent' ? `Borrow ${name}` : name;
    lines.push({ name: r.kind === 'rent' ? `Borrow: ${name}` : name, amount: r.total });
    if (r.kind === 'rent' && r.hold_amount) lines.push({ name: 'Refundable deposit hold (released when you return it)', amount: r.hold_amount });
  } else {
    const { data: s } = await db.from('shoutouts').select('id, user_id, status, text, offer, boost').eq('id', id).maybeSingle();
    if (!s || s.user_id !== userId) throw new PaymentError('Shout-out not found', 404);
    if (s.status !== 'pending_payment') throw new PaymentError('This shout-out is already paid for or closed.');
    description = `Shout-out: ${s.text}`;
    lines.push({ name: description, amount: s.offer });
    if (s.boost) lines.push({ name: 'Rush tip (all of it goes to your neighbor)', amount: s.boost });
  }

  const base = { kind, id, native: platform === 'native' ? '1' : '0' };
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: await customerFor(userId),
    line_items: lines.map((l) => ({ quantity: 1, price_data: { currency: 'usd', unit_amount: l.amount, product_data: { name: l.name } } })),
    payment_intent_data: {
      capture_method: 'manual',
      description,
      metadata: { kind, id, user_id: userId },
    },
    metadata: { kind, id, user_id: userId },
    saved_payment_method_options: { payment_method_save: 'enabled' },
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    success_url: returnUrl({ ...base, status: 'paid' }) + '&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: returnUrl({ ...base, status: 'cancelled' }),
  });
  if (!session.url) throw new Error('Stripe didn’t return a checkout page');
  return session.url;
}

/** Called for a completed Checkout (webhook, or the return page if the webhook is slow). Idempotent. */
export async function checkoutCompleted(sessionId: string) {
  const { stripe, db } = services();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const kind = session.metadata?.kind as PayKind | undefined;
  const id = session.metadata?.id;
  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (session.status !== 'complete' || !kind || !id || !paymentIntent) return false;
  const { data: accepted, error } = await db.rpc('payment_authorized', { p_kind: kind, p_id: id, p_payment_intent: paymentIntent, p_amount: session.amount_total ?? 0 });
  if (error) throw new Error(error.message);
  if (accepted === false) {
    // Already live (a repeat), or the order was cancelled/replaced meanwhile: then release the card.
    const table = kind === 'request' ? 'requests' : 'shoutouts';
    const { data: row } = await db.from(table).select('payment_intent_id').eq('id', id).maybeSingle();
    if (row?.payment_intent_id !== paymentIntent) await stripe.paymentIntents.cancel(paymentIntent).catch(() => {});
  }
  return true;
}

// ── Payouts (Stripe Connect) ────────────────────────────────────────────────

/** Link to Stripe's onboarding, so a neighbor can get paid to their bank. */
export async function payoutOnboardingUrl(userId: string, platform: Platform) {
  const { stripe } = services();
  let accountId = (await accountRow(userId))?.stripe_account_id;
  if (!accountId) {
    const account = await stripe.accounts.create(
      {
        type: 'express',
        country: 'US',
        email: await userEmail(userId),
        business_type: 'individual',
        capabilities: { transfers: { requested: true } },
        business_profile: { product_description: 'Delivers items to neighbors in their building through Lobb', url: ORIGIN },
        metadata: { user_id: userId },
      },
      { idempotencyKey: `connect-${userId}` },
    );
    accountId = account.id;
    await saveAccount(userId, { stripe_account_id: accountId });
  }
  const back = { flow: 'payouts', native: platform === 'native' ? '1' : '0' };
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: returnUrl({ ...back, status: 'refresh' }),
    return_url: returnUrl({ ...back, status: 'done' }),
  });
  return link.url;
}

/** Link to the neighbor's Stripe Express dashboard (payout history, bank account). */
export async function payoutDashboardUrl(userId: string) {
  const { stripe } = services();
  const accountId = (await accountRow(userId))?.stripe_account_id;
  if (!accountId) throw new PaymentError('Set up payouts first');
  return (await stripe.accounts.createLoginLink(accountId)).url;
}

/** Re-reads the neighbor's Stripe account and saves whether they can be paid. */
export async function refreshPayoutStatus(userId: string) {
  const { stripe } = services();
  const accountId = (await accountRow(userId))?.stripe_account_id;
  if (!accountId) return { hasAccount: false, payoutsEnabled: false };
  const account = await stripe.accounts.retrieve(accountId);
  const payoutsEnabled = account.capabilities?.transfers === 'active' && !!account.payouts_enabled;
  await saveAccount(userId, { payouts_enabled: payoutsEnabled });
  return { hasAccount: true, payoutsEnabled };
}

/** account.updated webhook. */
export async function accountUpdated(account: Stripe.Account) {
  const userId = account.metadata?.user_id;
  if (!userId) return;
  await saveAccount(userId, { stripe_account_id: account.id, payouts_enabled: account.capabilities?.transfers === 'active' && !!account.payouts_enabled });
}

// ── Settling ────────────────────────────────────────────────────────────────

type SettleRow = { action: 'capture' | 'capture_all' | 'cancel' | 'payout'; kind: PayKind; id: string; payment_intent_id: string; amount: number; seller_id: string | null; payout: number };

/** Captures, releases and pays out whatever the database says is due. Returns what it did. */
export async function settle() {
  const { stripe, db } = services();
  const { data, error } = await db.rpc('payments_to_settle');
  if (error) throw new Error(error.message);
  const done: string[] = [];

  for (const row of (data ?? []) as SettleRow[]) {
    try {
      if (row.action === 'capture' || row.action === 'capture_all') {
        const pi = await stripe.paymentIntents.retrieve(row.payment_intent_id);
        const captured =
          pi.status === 'requires_capture'
            ? await stripe.paymentIntents.capture(row.payment_intent_id, row.action === 'capture' ? { amount_to_capture: row.amount } : {}, { idempotencyKey: `capture-${row.id}` })
            : pi;
        if (captured.status !== 'succeeded') throw new Error(`payment is ${captured.status}`);
        await db
          .from('requests')
          .update({ payment_status: 'captured', amount_captured: captured.amount_received, payout_status: 'pending', payout_amount: row.payout })
          .eq('id', row.id);
        done.push(`captured ${row.id}`);
        await payOut(row.id);
      } else if (row.action === 'cancel') {
        const pi = await stripe.paymentIntents.retrieve(row.payment_intent_id);
        if (pi.status === 'requires_capture' || pi.status === 'requires_payment_method' || pi.status === 'requires_confirmation') {
          await stripe.paymentIntents.cancel(row.payment_intent_id);
        }
        await db.from(row.kind === 'request' ? 'requests' : 'shoutouts').update({ payment_status: 'canceled' }).eq('id', row.id);
        done.push(`released ${row.id}`);
      } else if (row.action === 'payout') {
        await payOut(row.id);
        done.push(`paid out ${row.id}`);
      }
    } catch (e) {
      console.error('[payments] settle failed', row.action, row.id, e);
    }
  }
  return done;
}

/** Sends the neighbor their share of a captured order, if they've set up payouts. */
async function payOut(requestId: string) {
  const { stripe, db } = services();
  const { data: r } = await db.from('requests').select('id, accepted_by, payment_intent_id, payout_status, payout_amount, seller_payout').eq('id', requestId).maybeSingle();
  if (!r || r.payout_status !== 'pending' || !r.accepted_by || !r.payment_intent_id) return;
  const account = await accountRow(r.accepted_by);
  if (!account?.stripe_account_id || !account.payouts_enabled) return; // Waits until they set up payouts.
  const amount = r.payout_amount ?? r.seller_payout;
  if (!amount || amount <= 0) return;
  const pi = await stripe.paymentIntents.retrieve(r.payment_intent_id);
  const charge = typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id;
  const transfer = await stripe.transfers.create(
    {
      amount,
      currency: 'usd',
      destination: account.stripe_account_id,
      transfer_group: `request-${r.id}`,
      // Ties the transfer to this charge, so it goes out as soon as the charge's funds are available.
      ...(charge ? { source_transaction: charge } : {}),
      metadata: { request_id: r.id },
    },
    { idempotencyKey: `payout-${r.id}` },
  );
  await db.from('requests').update({ payout_status: 'paid', transfer_id: transfer.id }).eq('id', r.id);
}
