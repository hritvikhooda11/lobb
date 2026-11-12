# Stripe integration: what's left

Lobb uses **hosted Stripe Checkout**: the buyer is sent to a Stripe-hosted payment page (an in-app
browser on iPhone, a redirect on the web). The card is **authorized** at checkout and **captured** when
the item changes hands. The neighbor who delivered is paid with **Stripe Connect** (Accounts v2,
recipient configuration).

## Values to Replace

None. The Checkout Session already uses real values, not placeholders.

**Files:** [src/lib/server/payments.ts](src/lib/server/payments.ts) (`createCheckout`)

| Field | Current value | Notes |
|-------|---------------|-------|
| mode | `payment` | One-time charges (correct for Lobb). |
| success_url | `https://lobb.expo.app/api/pay/return?…&status=paid&session_id={CHECKOUT_SESSION_ID}` | Confirms the payment, then returns the user to the app (native) or the order screen (web). Set `LOBB_ORIGIN` if the domain changes. |
| cancel_url | `https://lobb.expo.app/api/pay/return?…&status=cancelled` | Back to the app; the order stays "Finish paying" for 30 minutes. |
| line_items | `price_data` built per order | Every order has its own price (store price + neighbor fee + Lobb fee), so there are no Dashboard Price IDs. Rentals add a refundable deposit line. |

## Configured Parameters

Set in Stripe Checkout Studio and applied as-is.

**Files:** [src/lib/server/payments.ts](src/lib/server/payments.ts)

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted_page` (Stripe SDK 23.x) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| allow_promotion_codes | `false` |
| submit_type | `auto` |
| integration_identifier | `hosted_web_0001` |
| origin_context | `web` |
| payment_method_collection | not set (only applies to subscriptions) |

Kept because Lobb depends on them (the Studio prompt said to remove parameters it doesn't list, but
removing these would break payments):

| Parameter | Why |
|-----------|-----|
| payment_intent_data.capture_method = `manual` | Charge only at the handoff; release the hold if the order is cancelled. |
| metadata / payment_intent_data.metadata | Links the payment to the order or shout-out. |
| customer, saved_payment_method_options | Saved cards for faster repeat orders. |
| expires_at (30 min) | Matches how long an unpaid order is kept. |

## Setup

| Variable | Where | Status |
|----------|-------|--------|
| STRIPE_SECRET_KEY | `.env` and EAS (production, preview) | Set (test mode) |
| STRIPE_WEBHOOK_SECRET | `.env` and EAS | Set |
| STRIPE_CONNECT_WEBHOOK_SECRET | `.env` and EAS | Set |
| LOBB_CRON_SECRET | `.env` and EAS | Set |
| LOBB_ORIGIN | optional | Defaults to `https://lobb.expo.app` |

Webhooks (both pointing at `https://lobb.expo.app/api/stripe/webhook`):
- Platform: `checkout.session.completed`, `account.updated`
- Connected accounts: `account.updated`

No publishable key is needed: Checkout is hosted by Stripe.

## Files

- [src/lib/server/payments.ts](src/lib/server/payments.ts): Checkout, payouts, settling
- [src/app/api/pay/checkout+api.ts](src/app/api/pay/checkout+api.ts): start Checkout
- [src/app/api/pay/return+api.ts](src/app/api/pay/return+api.ts): where Stripe sends people back
- [src/app/api/pay/settle+api.ts](src/app/api/pay/settle+api.ts): capture, release, pay out
- [src/app/api/pay/payouts+api.ts](src/app/api/pay/payouts+api.ts): neighbor payouts setup
- [src/app/api/stripe/webhook+api.ts](src/app/api/stripe/webhook+api.ts): Stripe events
- [src/lib/pay.ts](src/lib/pay.ts): app side
- [supabase/migrations/20261112000000_payments.sql](supabase/migrations/20261112000000_payments.sql): payment state and rules

## How it works

1. Buyer orders → order is `pending_payment` (invisible to neighbors) → Stripe Checkout.
2. Card authorized → webhook → order goes live and neighbors are notified.
3. Handoff QR scanned → `/api/pay/settle` captures the charge (rentals: at return, releasing the deposit).
4. Neighbor's share is transferred to their Stripe account (or waits until they set up payouts).
5. Cancelled or expired orders → the hold is released.

## Remaining steps

- [ ] **Sandbox:** Connect → Platform profile → acknowledge *Refunds and chargebacks liability* (needed before test payouts work).
- [ ] Turn payments on: `update public.app_config set payments_required = true;` (Supabase SQL editor).
- [ ] Test with test cards: `4242 4242 4242 4242` (works), `4000 0000 0000 9995` (declined), any future date and any CVC.
- [ ] Schedule `/api/pay/settle` every 5 minutes (Supabase → Integrations → Cron → HTTP request, `POST https://lobb.expo.app/api/pay/settle` with header `x-lobb-cron-secret: <LOBB_CRON_SECRET>`), so overdue rentals and expired holds settle even if nobody opens the app.
- [ ] **Going live:** finish Connect onboarding and the liability acknowledgement on the live account, create live webhooks, swap in the live keys (`sk_live_…`) in EAS.
- [ ] **Sales tax:** `automatic_tax` is off. Washington's marketplace-facilitator rules may require Lobb to collect sales tax once sales pass the state threshold. Check with an accountant before scaling.

## Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
