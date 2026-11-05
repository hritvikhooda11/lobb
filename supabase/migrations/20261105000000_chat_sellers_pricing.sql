-- November round: chat, registered sellers, real photos, higher prices, rush shout-outs,
-- and "Snacks & food" (instant food folded into snacks).

-- ── Categories: instant food is now part of snacks ──────────────────────────
-- The check constraints still accept 'instant' so old rows and old app builds keep working.

update public.items set category = 'snacks' where category = 'instant';
update public.price_quotes set category = 'snacks' where category = 'instant';
update public.shoutouts set category = 'snacks' where category = 'instant';

-- ── Prices ──────────────────────────────────────────────────────────────────
-- Convenience pricing. The neighbor who delivers gets 30% of the item price (at least $1.50) on top
-- of being paid back for the item; Lobb keeps 10% (at least 50¢). A $10 item costs $14 in the lobby.
-- Mirrors priceFor() in src/data/pricing.ts.

create or replace function public.buy_price(market int, adjust int default 0)
returns table (item_price int, deliverer_fee int, platform_fee int, total int)
language sql immutable as $$
  with p as (select public.round5(market * (1 + adjust / 100.0)) as item),
       f as (select item, greatest(150, public.round5(item * 0.3)) as deliverer, greatest(50, public.round5(item * 0.1)) as platform from p)
  select item, deliverer, platform, item + deliverer + platform from f
$$;

-- Rentals: 10% of retail per day, at least $1.50 (was 6% / $1).
create or replace function public.rent_per_day(market int, adjust int default 0) returns int language sql immutable as $$
  select greatest(150, public.round5(market * 0.10 * (1 + adjust / 100.0)))
$$;

-- Lobb's cut of a shout-out: 10%, at least 50¢ (was a flat 25¢). Mirrors shoutoutFee() in the app.
create or replace function public.shoutout_fee(p_offer int) returns int language sql immutable as $$
  select greatest(50, public.round5(p_offer * 0.1))
$$;

-- ── Real photos ─────────────────────────────────────────────────────────────
-- image_url is the store picture (product database) when there is one; photo_url is the seller's own
-- photo of the actual item, shown next to it.

alter table public.items add column photo_url text;

drop function public.create_item(uuid, text, text, text, int, int);
create or replace function public.create_item(p_quote_id uuid, p_size text, p_image_url text, p_barcode text, p_adjust_pct int, p_price int default null, p_photo_url text default null)
returns public.items language plpgsql security definer set search_path = public as $$
declare
  v_quote public.price_quotes;
  v_item public.items;
  v_price int;
begin
  select * into v_quote from public.price_quotes
  where id = p_quote_id and user_id = auth.uid() and created_at > now() - interval '1 hour';
  if not found then raise exception 'Price quote expired. Get a new Lobb price.'; end if;
  if not v_quote.eligible then raise exception 'This item can’t be listed on Lobb'; end if;
  if v_quote.category = 'alcohol' and not public.is_admin() then
    raise exception 'Only Lobb-verified sellers can sell alcohol';
  end if;

  v_price := coalesce(p_price, v_quote.market_price);
  if not public.price_within_limits(v_price, v_quote.market_price) then
    raise exception 'That price is too far from the store price. Lobb allows up to 50%% above or below.';
  end if;

  insert into public.items (kind, barcode, name, size, category, image_url, photo_url, market_price, lobb_price, price_source, price_source_url, created_by)
  values (v_quote.kind, nullif(p_barcode, ''), v_quote.name, coalesce(nullif(p_size, ''), v_quote.size),
          case when v_quote.category = 'instant' then 'snacks' else v_quote.category end,
          p_image_url, nullif(p_photo_url, ''), v_price, v_quote.market_price, v_quote.price_source, v_quote.price_source_url, auth.uid())
  returning * into v_item;

  insert into public.listings (seller_id, item_id, adjust_pct) values (auth.uid(), v_item.id, greatest(-5, least(5, coalesce(p_adjust_pct, 0))));
  delete from public.price_quotes where id = p_quote_id;
  return v_item;
end $$;

-- ── Registered sellers ──────────────────────────────────────────────────────
-- Neighbors Lobb pays to keep items stocked in their apartment. They get the seller badge and the
-- quick-stock screen. Lobb hands out invite codes (insert into seller_invites in the dashboard);
-- nobody can make themselves a seller without one. Alcohol stays admin-only.

alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('member', 'seller', 'admin'));

create or replace function public.is_seller() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('seller', 'admin') from public.profiles where id = auth.uid()), false)
$$;

create table public.seller_invites (
  code text primary key check (code = upper(code) and length(code) between 6 and 32),
  note text not null default '',
  created_at timestamptz not null default now(),
  used_by uuid references public.profiles on delete set null,
  used_at timestamptz
);
-- No policies: only the service role / dashboard can read or create codes.
alter table public.seller_invites enable row level security;
grant all on public.seller_invites to service_role;

create or replace function public.redeem_seller_code(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if public.is_seller() then return; end if;
  update public.seller_invites set used_by = auth.uid(), used_at = now()
  where code = v_code and used_by is null;
  if not found then raise exception 'That code isn’t valid or was already used'; end if;
  update public.profiles set role = 'seller' where id = auth.uid() and role = 'member';
end $$;

-- ── Shout-outs: rush boost and the new fee ──────────────────────────────────
-- A poster can add a rush tip ($2 or $5) on top of their offer. The whole tip goes to the neighbor
-- who brings it; rush shout-outs are shown first and flagged in the notification.

alter table public.shoutouts add column boost int not null default 0 check (boost in (0, 200, 500));

drop function public.create_shoutout(text, text, text, int, text, text, int);
create or replace function public.create_shoutout(p_text text, p_kind text, p_category text, p_offer int, p_fulfillment text default 'lobby', p_note text default '', p_hours int default null, p_boost int default 0)
returns public.shoutouts language plpgsql security definer set search_path = public as $$
declare
  v_community text := public.my_community();
  v_text text := btrim(coalesce(p_text, ''));
  v_category text := case when p_category = 'instant' then 'snacks' else p_category end;
  v_shoutout public.shoutouts;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if v_community is null then raise exception 'Pick your building first'; end if;
  if length(v_text) < 2 or length(v_text) > 60 then raise exception 'Say what you need in 2–60 characters'; end if;
  if v_text ~* '\m(alcohol|beer|wine|vodka|whiskey|tequila|rum|liquor|seltzer|weed|cannabis|thc|vape|nicotine|cigarettes?|juul|adderall|xanax|pills?|gun|ammo)\M' then
    raise exception 'That can’t be requested on Lobb';
  end if;
  if p_kind not in ('buy', 'rent') then raise exception 'Pick buy or borrow'; end if;
  if v_category not in ('snacks', 'drinks', 'toiletries', 'electronics', 'household') then raise exception 'Pick a category'; end if;
  if p_kind = 'rent' and v_category not in ('electronics', 'household') then raise exception 'Only non-food items can be borrowed'; end if;
  if p_offer is null or p_offer not between 100 and 5000 then raise exception 'Offer between $1 and $50'; end if;
  if coalesce(p_boost, 0) not in (0, 200, 500) then raise exception 'Pick a rush tip'; end if;
  if p_fulfillment not in ('dropoff', 'lobby', 'pickup') then raise exception 'Pick how you want to get it'; end if;
  if p_fulfillment = 'dropoff' and not exists (select 1 from public.home_details where user_id = auth.uid() and room is not null) then
    raise exception 'Add your room number first';
  end if;
  if (select count(*) from public.shoutouts where user_id = auth.uid() and status = 'open' and expires_at > now()) >= 3 then
    raise exception 'You already have 3 shout-outs out. Cancel one first.';
  end if;

  insert into public.shoutouts (user_id, community_id, text, note, kind, category, offer, boost, fulfillment, rental_hours)
  values (auth.uid(), v_community, v_text, coalesce(btrim(p_note), ''), p_kind, v_category, p_offer, coalesce(p_boost, 0), p_fulfillment,
          case when p_kind = 'rent' then coalesce(p_hours, 24) end)
  returning * into v_shoutout;
  return v_shoutout;
end $$;

create or replace function public.claim_shoutout(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_shoutout public.shoutouts;
  v_item public.items;
  v_request public.requests;
  v_buyer_room text;
  v_seller_room text;
  v_fee int;
  v_payout int;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.requests where accepted_by = auth.uid() and status in ('accepted', 'arriving')) then
    raise exception 'Finish your current delivery first';
  end if;

  select * into v_shoutout from public.shoutouts where id = p_id;
  if not found then raise exception 'Shout-out not found'; end if;
  if v_shoutout.user_id = auth.uid() then raise exception 'That’s your own shout-out'; end if;
  if v_shoutout.status <> 'open' or v_shoutout.expires_at <= now() then raise exception 'Someone else got this one'; end if;
  if exists (select 1 from public.requests where buyer_id = v_shoutout.user_id and status in ('open', 'accepted', 'arriving', 'renting', 'returning')) then
    raise exception 'They’re in the middle of another order. Try again in a few minutes.';
  end if;
  if v_shoutout.fulfillment = 'pickup' then
    select room into v_seller_room from public.home_details where user_id = auth.uid();
    if v_seller_room is null then raise exception 'Add your room number first so they can find you'; end if;
  end if;

  update public.shoutouts set status = 'claimed', claimed_by = auth.uid()
  where id = p_id and status = 'open' and expires_at > now() and community_id = public.my_community() and user_id <> auth.uid()
  returning * into v_shoutout;
  if not found then raise exception 'Someone else got this one'; end if;

  v_fee := public.shoutout_fee(v_shoutout.offer);
  v_payout := v_shoutout.offer - v_fee + v_shoutout.boost;

  insert into public.items (kind, name, size, category, emoji, market_price, special, created_by)
  values (v_shoutout.kind, v_shoutout.text, case when v_shoutout.kind = 'rent' then 'Borrowed' else 'Shout-out' end,
          v_shoutout.category, '📣', v_shoutout.offer, true, v_shoutout.user_id)
  returning * into v_item;

  insert into public.requests (kind, buyer_id, item_id, community_id, status, location_note, item_price, deliverer_fee, platform_fee, total,
                               rental_hours, fulfillment, seller_payout, accepted_by, accepted_at, deadline_at)
  values (v_shoutout.kind, v_shoutout.user_id, v_item.id, v_shoutout.community_id, 'accepted', v_shoutout.note,
          case when v_shoutout.kind = 'buy' then v_payout else 0 end,
          case when v_shoutout.kind = 'rent' then v_payout else 0 end,
          v_fee, v_shoutout.offer + v_shoutout.boost, v_shoutout.rental_hours, v_shoutout.fulfillment, v_payout,
          auth.uid(), now(), now() + interval '15 minutes')
  returning * into v_request;

  insert into public.handoff_codes (request_id, purpose, code) values (v_request.id, 'handoff', public.new_handoff_code());
  if v_shoutout.fulfillment = 'dropoff' then
    select room into v_buyer_room from public.home_details where user_id = v_shoutout.user_id;
  end if;
  if v_buyer_room is not null or v_seller_room is not null then
    insert into public.request_private (request_id, buyer_room, seller_room) values (v_request.id, v_buyer_room, v_seller_room);
  end if;
  update public.shoutouts set request_id = v_request.id where id = p_id;
  return v_request;
end $$;

-- ── Chat ────────────────────────────────────────────────────────────────────
-- Two kinds of threads:
--  - an order: the buyer and the neighbor delivering it, once someone has accepted;
--  - a shout-out: the poster and one neighbor (neighbor_id) asking about it before claiming.

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests on delete cascade,
  shoutout_id uuid references public.shoutouts on delete cascade,
  -- Shout-out threads only: the neighbor talking to the poster.
  neighbor_id uuid references public.profiles on delete cascade,
  sender_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  check ((request_id is null) <> (shoutout_id is null)),
  check (shoutout_id is null or neighbor_id is not null)
);

create index messages_by_request on public.messages (request_id, created_at) where request_id is not null;
create index messages_by_shoutout on public.messages (shoutout_id, neighbor_id, created_at) where shoutout_id is not null;

create or replace function public.can_chat(p_request uuid, p_shoutout uuid, p_neighbor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_request is not null then exists (
      select 1 from public.requests r
      where r.id = p_request and r.accepted_by is not null and auth.uid() in (r.buyer_id, r.accepted_by))
    else exists (
      select 1 from public.shoutouts s
      where s.id = p_shoutout and p_neighbor <> s.user_id
        and (s.user_id = auth.uid() or (p_neighbor = auth.uid() and s.community_id = public.my_community())))
  end
$$;

alter table public.messages enable row level security;
create policy "people in the thread read it" on public.messages for select to authenticated
  using (public.can_chat(request_id, shoutout_id, neighbor_id));
create policy "people in the thread write to it" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_chat(request_id, shoutout_id, neighbor_id));
grant select, insert (request_id, shoutout_id, neighbor_id, body) on public.messages to authenticated;
grant all on public.messages to service_role;

alter publication supabase_realtime add table public.messages;

-- ── Push text: rush shout-outs, the new payout, and chat messages ───────────

create or replace function public.push_messages(p_table text, p_id uuid)
returns table (token text, title text, body text, url text, kind text)
language sql stable security definer set search_path = public as $$
  -- A new shout-out → everyone else in the building with shout-out alerts on.
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
  where p_table = 'shoutouts' and s.id = p_id and s.status = 'open' and s.expires_at > now()
  union all
  -- A new open request → neighbors who list that item and have it in stock (the priority window).
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
  where p_table = 'requests' and r.id = p_id and r.status = 'open'
    and (i.category <> 'alcohol' or seller.role = 'admin')
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
$$;

-- ── Function access ─────────────────────────────────────────────────────────

revoke execute on function public.shoutout_fee(int), public.is_seller(), public.redeem_seller_code(text),
  public.create_item(uuid, text, text, text, int, int, text),
  public.create_shoutout(text, text, text, int, text, text, int, int), public.can_chat(uuid, uuid, uuid) from public, anon;
grant execute on function public.shoutout_fee(int), public.is_seller(), public.redeem_seller_code(text),
  public.create_item(uuid, text, text, text, int, int, text),
  public.create_shoutout(text, text, text, int, text, text, int, int), public.can_chat(uuid, uuid, uuid) to authenticated;
revoke execute on function public.push_messages(text, uuid) from public, anon, authenticated;
grant execute on function public.push_messages(text, uuid) to service_role;
