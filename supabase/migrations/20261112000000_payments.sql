-- Real payments with Stripe.
--
-- Buyers pay with Stripe Checkout. The card is authorized when they order and only captured when the
-- item changes hands (rentals: when it comes back, so the deposit hold can be released). The neighbor
-- who delivered is paid out through Stripe Connect; Lobb keeps the rest (its fee).
--
-- Payments are switched on with app_config.payments_required. While it's off (local tests, and until
-- the Stripe account is verified), orders and shout-outs go live right away like before. While it's on,
-- they start as 'pending_payment', invisible to neighbors, until Stripe confirms the card
-- (payment_authorized, called by the server's Stripe webhook).

-- ── Switch ──────────────────────────────────────────────────────────────────

create table public.app_config (
  id int primary key default 1 check (id = 1),
  payments_required boolean not null default false
);
insert into public.app_config default values;
alter table public.app_config enable row level security;
create policy "anyone signed in can read the config" on public.app_config for select to authenticated using (true);
grant select on public.app_config to authenticated;
grant all on public.app_config to service_role;

create or replace function public.payments_required() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select payments_required from public.app_config where id = 1), false)
$$;

-- ── Stripe accounts (written only by the server) ────────────────────────────

create table public.payment_accounts (
  user_id uuid primary key references public.profiles on delete cascade,
  stripe_customer_id text unique,
  -- Stripe Connect Express account the neighbor is paid out to.
  stripe_account_id text unique,
  payouts_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.payment_accounts enable row level security;
create policy "see own payment account" on public.payment_accounts for select to authenticated using (user_id = auth.uid());
grant select (user_id, payouts_enabled) on public.payment_accounts to authenticated;
grant all on public.payment_accounts to service_role;

-- ── Payment state on orders and shout-outs ──────────────────────────────────

alter table public.requests drop constraint requests_status_check;
alter table public.requests add constraint requests_status_check
  check (status in ('pending_payment', 'open', 'accepted', 'arriving', 'delivered', 'renting', 'returning', 'returned', 'expired', 'cancelled'));

alter table public.requests
  add column payment_intent_id text unique,
  add column payment_status text not null default 'none'
    check (payment_status in ('none', 'authorized', 'captured', 'canceled', 'failed')),
  -- What the card was authorized for: the total, plus the deposit hold for rentals.
  add column amount_authorized int,
  add column amount_captured int,
  add column payout_status text not null default 'none' check (payout_status in ('none', 'pending', 'paid')),
  -- What the neighbor is paid (seller_payout, plus the deposit if a rental never came back).
  add column payout_amount int,
  add column transfer_id text;

alter table public.shoutouts drop constraint shoutouts_status_check;
alter table public.shoutouts add constraint shoutouts_status_check check (status in ('pending_payment', 'open', 'claimed', 'cancelled'));
alter table public.shoutouts
  add column payment_intent_id text unique,
  add column payment_status text not null default 'none' check (payment_status in ('none', 'authorized', 'captured', 'canceled', 'failed'));

-- Neighbors never see a shout-out before it's paid for.
drop policy "building sees shout-outs" on public.shoutouts;
create policy "building sees shout-outs" on public.shoutouts for select to authenticated
  using (user_id = auth.uid() or (community_id = public.my_community() and status <> 'pending_payment'));

-- New orders and shout-outs wait for payment when payments are on. An abandoned checkout is replaced
-- by the next one.
create or replace function public.hold_for_payment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' and public.payments_required() then
    new.status := 'pending_payment';
    if tg_table_name = 'requests' then
      update public.requests set status = 'cancelled' where buyer_id = new.buyer_id and status = 'pending_payment';
    else
      update public.shoutouts set status = 'cancelled' where user_id = new.user_id and status = 'pending_payment';
    end if;
  end if;
  return new;
end $$;

create trigger requests_hold_for_payment before insert on public.requests for each row execute function public.hold_for_payment();
create trigger shoutouts_hold_for_payment before insert on public.shoutouts for each row execute function public.hold_for_payment();

-- A claimed shout-out becomes a request; it carries the shout-out's payment with it.
create or replace function public.shoutout_payment_to_request() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.request_id is not null and old.request_id is null and new.payment_intent_id is not null then
    update public.requests set payment_intent_id = new.payment_intent_id, payment_status = new.payment_status,
      amount_authorized = new.offer + new.boost
    where id = new.request_id;
    update public.shoutouts set payment_intent_id = null where id = new.id;
  end if;
  return new;
end $$;
create trigger shoutouts_payment_to_request after update of request_id on public.shoutouts for each row execute function public.shoutout_payment_to_request();

-- ── Called by the server when Stripe confirms the card ──────────────────────
-- Returns false if the order or shout-out is no longer waiting (cancelled, replaced): the server then
-- cancels the authorization so the buyer isn't charged.

alter table public.request_events alter column request_id drop not null;
alter table public.request_events add column shoutout_id uuid references public.shoutouts on delete cascade;
alter table public.request_events drop constraint request_events_kind_check;
alter table public.request_events add constraint request_events_kind_check
  check (kind in ('seller_arrived', 'buyer_here', 'opened', 'shoutout_opened'));
alter table public.request_events add constraint request_events_target check ((request_id is null) <> (shoutout_id is null));

create or replace function public.payment_authorized(p_kind text, p_id uuid, p_payment_intent text, p_amount int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_kind = 'request' then
    update public.requests set status = 'open', payment_intent_id = p_payment_intent, payment_status = 'authorized',
      amount_authorized = p_amount,
      -- The 10-minute window and the listed-sellers-first window start now, not at checkout.
      created_at = now()
    where id = p_id and status = 'pending_payment';
    if not found then return false; end if;
    insert into public.request_events (request_id, kind) values (p_id, 'opened');
  elsif p_kind = 'shoutout' then
    update public.shoutouts set status = 'open', payment_intent_id = p_payment_intent, payment_status = 'authorized',
      created_at = now(), expires_at = now() + interval '2 hours'
    where id = p_id and status = 'pending_payment';
    if not found then return false; end if;
    insert into public.request_events (shoutout_id, kind) values (p_id, 'shoutout_opened');
  else
    raise exception 'Unknown kind %', p_kind;
  end if;
  return true;
end $$;

-- Unpaid checkouts are dropped after 30 minutes.
select cron.schedule('drop-unpaid-checkouts', '*/5 * * * *', $$
  update public.requests set status = 'cancelled' where status = 'pending_payment' and created_at < now() - interval '30 minutes';
  update public.shoutouts set status = 'cancelled' where status = 'pending_payment' and created_at < now() - interval '30 minutes';
$$);

-- ── What the server has to settle with Stripe ───────────────────────────────
-- capture: handed over (sales) or returned (rentals). capture_all: a rental 48h overdue, so the deposit
-- goes to the lender. cancel: never happened. payout: captured, neighbor not paid yet.

create or replace function public.payments_to_settle()
returns table (action text, kind text, id uuid, payment_intent_id text, amount int, seller_id uuid, payout int)
language sql stable security definer set search_path = public as $$
  select 'capture', 'request', r.id, r.payment_intent_id, r.total, r.accepted_by, r.seller_payout
  from public.requests r
  where r.payment_status = 'authorized' and ((r.kind = 'buy' and r.status = 'delivered') or (r.kind = 'rent' and r.status = 'returned'))
  union all
  select 'capture_all', 'request', r.id, r.payment_intent_id, r.amount_authorized, r.accepted_by, r.seller_payout + coalesce(r.hold_amount, 0)
  from public.requests r
  where r.payment_status = 'authorized' and r.kind = 'rent' and r.status in ('renting', 'returning') and r.return_by < now() - interval '48 hours'
  union all
  select 'cancel', 'request', r.id, r.payment_intent_id, 0, null, 0
  from public.requests r
  where r.payment_status = 'authorized' and r.status in ('cancelled', 'expired')
  union all
  select 'cancel', 'shoutout', s.id, s.payment_intent_id, 0, null, 0
  from public.shoutouts s
  where s.payment_status = 'authorized' and s.payment_intent_id is not null
    and (s.status = 'cancelled' or (s.status = 'open' and s.expires_at < now()))
  union all
  select 'payout', 'request', r.id, r.payment_intent_id, r.amount_captured, r.accepted_by, coalesce(r.payout_amount, r.seller_payout)
  from public.requests r
  join public.payment_accounts a on a.user_id = r.accepted_by and a.payouts_enabled and a.stripe_account_id is not null
  where r.payment_status = 'captured' and r.payout_status = 'pending'
$$;

-- Shout-outs that expired unclaimed also get closed, so they stop showing as open.
select cron.schedule('close-expired-shoutouts', '*/5 * * * *', $$
  update public.shoutouts set status = 'cancelled' where status = 'open' and expires_at < now() - interval '5 minutes';
$$);

-- ── Push: paid orders and shout-outs go out when the payment clears ─────────

create or replace function public.push_messages(p_table text, p_id uuid)
returns table (token text, title text, body text, url text, kind text)
language sql stable security definer set search_path = public as $$
  -- A new shout-out → everyone else in the building with shout-out alerts on. Payments off: on insert.
  -- Payments on: when it's paid for (request_events 'shoutout_opened').
  select t.expo_push_token,
         case when s.boost > 0 then '🔥 RUSH: ' else '📣 ' end || s.text || '?',
         poster.name || ' pays you ' || public.push_money(s.offer - public.shoutout_fee(s.offer) + s.boost)
           || case when s.kind = 'rent' then ' to borrow one. Have it?' else '. Have one?' end,
         '/shoutouts',
         'shoutout'
  from public.shoutouts s
  join public.profiles poster on poster.id = s.user_id
  join public.profiles p on p.community_id = s.community_id and p.id <> s.user_id and p.notify_shoutouts
  join public.push_tokens t on t.user_id = p.id
  where s.status = 'open' and s.expires_at > now()
    and ((p_table = 'shoutouts' and s.id = p_id)
      or (p_table = 'request_events' and s.id = (select e.shoutout_id from public.request_events e where e.id = p_id and e.kind = 'shoutout_opened')))
  union all
  -- A new open order → neighbors who list that item and have it in stock (the priority window).
  -- Alcohol only goes to admins, the only people allowed to deliver it.
  select t.expo_push_token,
         buyer.name || ' wants ' || i.name,
         case when r.kind = 'rent' then 'Lend it for ' || public.push_money(r.deliverer_fee + r.fulfillment_adjust) || '. First to accept gets it.'
              else 'First to accept gets it. Tap to see what you earn.' end,
         '/deliver/' || r.id,
         'order'
  from public.requests r
  join public.items i on i.id = r.item_id
  join public.profiles buyer on buyer.id = r.buyer_id
  join lateral (select distinct a.seller_id from public.available_listings(r.community_id) a
                where a.item_id = r.item_id and a.seller_id <> r.buyer_id) a on true
  join public.profiles seller on seller.id = a.seller_id
  join public.push_tokens t on t.user_id = a.seller_id
  where r.status = 'open' and (i.category <> 'alcohol' or seller.role = 'admin')
    and ((p_table = 'requests' and r.id = p_id)
      or (p_table = 'request_events' and r.id = (select e.request_id from public.request_events e where e.id = p_id and e.kind = 'opened')))
  union all
  -- A chat message → the other person in the thread.
  select t.expo_push_token,
         sender.name,
         left(m.body, 140),
         case
           when m.request_id is not null then '/chat?request=' || m.request_id
           else '/chat?shoutout=' || m.shoutout_id || '&neighbor=' || m.neighbor_id
         end,
         'message'
  from public.messages m
  join public.profiles sender on sender.id = m.sender_id
  left join public.requests r on r.id = m.request_id
  left join public.shoutouts s on s.id = m.shoutout_id
  join public.push_tokens t on t.user_id = case
      when r.id is not null then case when m.sender_id = r.buyer_id then r.accepted_by else r.buyer_id end
      else case when m.sender_id = s.user_id then m.neighbor_id else s.user_id end
    end
  where p_table = 'messages' and m.id = p_id
  union all
  -- Someone is here: the seller at the door / in the lobby / ready for pickup → the buyer;
  -- the buyer waiting in the lobby / at the seller's door → the seller.
  select t.expo_push_token,
         case
           when e.kind = 'seller_arrived' then case r.fulfillment
             when 'dropoff' then '🚪 ' || seller.name || ' is at your door'
             when 'lobby' then '🛋️ ' || seller.name || ' is in the lobby'
             else '✅ ' || seller.name || ' is ready for you' end
           else case r.fulfillment
             when 'pickup' then '🚪 ' || buyer.name || ' is at your door'
             else '🛋️ ' || buyer.name || ' is waiting in the lobby' end
         end,
         case
           when e.kind = 'seller_arrived' then case r.fulfillment
             when 'pickup' then 'Head over to get your ' || i.name || '. Have your QR code ready.'
             else 'They have your ' || i.name || '. Have your QR code ready.' end
           else 'They’re ready for the ' || i.name || '.'
         end,
         case when e.kind = 'seller_arrived' then '/request/' || r.id else '/deliver/' || r.id end,
         'arrival'
  from public.request_events e
  join public.requests r on r.id = e.request_id
  join public.items i on i.id = r.item_id
  join public.profiles buyer on buyer.id = r.buyer_id
  join public.profiles seller on seller.id = r.accepted_by
  join public.push_tokens t on t.user_id = case when e.kind = 'seller_arrived' then r.buyer_id else r.accepted_by end
  where p_table = 'request_events' and e.id = p_id and e.kind in ('seller_arrived', 'buyer_here')
$$;

-- ── Access ──────────────────────────────────────────────────────────────────

revoke execute on function public.payment_authorized(text, uuid, text, int), public.payments_to_settle(),
  public.hold_for_payment(), public.shoutout_payment_to_request() from public, anon, authenticated;
grant execute on function public.payment_authorized(text, uuid, text, int), public.payments_to_settle() to service_role;
revoke execute on function public.payments_required() from public, anon;
grant execute on function public.payments_required() to authenticated, service_role;
revoke execute on function public.push_messages(text, uuid) from public, anon, authenticated;
grant execute on function public.push_messages(text, uuid) to service_role;
