-- Shout-outs (ask the building for something nobody lists), seller-set prices with guardrails
-- and price sources, and an alcohol section that only Lobb admins can sell.

-- ── Roles and preferences ───────────────────────────────────────────────────

-- Admins are set by Lobb staff in the dashboard; users can never grant it to themselves.
alter table public.profiles
  add column role text not null default 'member' check (role in ('member', 'admin')),
  add column notify_shoutouts boolean not null default true;
grant update (notify_shoutouts) on public.profiles to authenticated;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

-- Birthdate is private (same table as the room). It can be set once; changing it needs support.
alter table public.home_details add column birthdate date;
alter table public.home_details alter column room drop not null;

create or replace function public.set_birthdate(p_birthdate date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_birthdate is null or p_birthdate > current_date - interval '13 years' or p_birthdate < current_date - interval '100 years' then
    raise exception 'Enter your real date of birth';
  end if;
  if exists (select 1 from public.home_details where user_id = auth.uid() and birthdate is not null) then
    raise exception 'Your date of birth is already saved. Contact support to change it.';
  end if;
  insert into public.home_details (user_id, birthdate) values (auth.uid(), p_birthdate)
  on conflict (user_id) do update set birthdate = excluded.birthdate;
end $$;

-- ── Alcohol ─────────────────────────────────────────────────────────────────

-- Off everywhere until Lobb has cleared the legal side for a building.
alter table public.communities add column alcohol_enabled boolean not null default false;

alter table public.items drop constraint items_category_check;
alter table public.items add constraint items_category_check
  check (category in ('snacks', 'drinks', 'instant', 'toiletries', 'electronics', 'household', 'alcohol'));

insert into public.items (id, kind, barcode, name, size, category, emoji, market_price) values
  ('white-claw', 'buy', null, 'White Claw Black Cherry', '12 oz can', 'alcohol', '🍒', 299),
  ('modelo', 'buy', null, 'Modelo Especial', '12 oz can', 'alcohol', '🍺', 249),
  ('smirnoff-ice', 'buy', null, 'Smirnoff Ice', '11.2 oz bottle', 'alcohol', '🍋', 279);

create or replace function public.check_can_buy_alcohol(p_community text)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_birth date;
begin
  if not coalesce((select alcohol_enabled from public.communities where id = p_community), false) then
    raise exception 'Alcohol isn’t available in your building yet';
  end if;
  select birthdate into v_birth from public.home_details where user_id = auth.uid();
  if v_birth is null then raise exception 'Confirm your date of birth first'; end if;
  if v_birth > current_date - interval '21 years' then raise exception 'You must be 21 or older to buy alcohol'; end if;
end $$;

-- Only admins can list alcohol (also enforced in create_item and accept_request).
drop policy "own listings" on public.listings;
create policy "own listings" on public.listings for all to authenticated
  using (seller_id = auth.uid())
  with check (
    seller_id = auth.uid()
    and (public.is_admin() or not exists (select 1 from public.items i where i.id = item_id and i.category = 'alcohol'))
  );

-- ── Prices: sources and seller-set prices ───────────────────────────────────

alter table public.price_quotes
  add column price_source text,
  add column price_source_url text;

alter table public.items
  add column lobb_price int,
  add column price_source text,
  add column price_source_url text,
  -- One-off items made from a shout-out. Never shown in the store.
  add column special boolean not null default false;

-- A seller may change the Lobb price by up to ±50%; the app warns past ±15%.
create or replace function public.price_within_limits(p_price int, p_lobb int) returns boolean language sql immutable as $$
  select p_price between ceil(p_lobb * 0.5) and floor(p_lobb * 1.5)
$$;

drop function public.create_item(uuid, text, text, text, int);
create or replace function public.create_item(p_quote_id uuid, p_size text, p_image_url text, p_barcode text, p_adjust_pct int, p_price int default null)
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

  insert into public.items (kind, barcode, name, size, category, image_url, market_price, lobb_price, price_source, price_source_url, created_by)
  values (v_quote.kind, nullif(p_barcode, ''), v_quote.name, coalesce(nullif(p_size, ''), v_quote.size), v_quote.category,
          p_image_url, v_price, v_quote.market_price, v_quote.price_source, v_quote.price_source_url, auth.uid())
  returning * into v_item;

  insert into public.listings (seller_id, item_id, adjust_pct) values (auth.uid(), v_item.id, greatest(-5, least(5, coalesce(p_adjust_pct, 0))));
  delete from public.price_quotes where id = p_quote_id;
  return v_item;
end $$;

-- ── Requests: alcohol and shout-out rules ───────────────────────────────────

create or replace function public.create_request(p_item_id text, p_location_note text, p_duration_id text default null, p_fulfillment text default 'lobby')
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_community text := public.my_community();
  v_price record;
  v_duration record;
  v_request public.requests;
  v_room text;
  v_rent int;
  v_base int;
  v_adjust int;
  v_note text := coalesce(btrim(p_location_note), '');
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if v_community is null then raise exception 'Pick your building first'; end if;
  if p_fulfillment not in ('dropoff', 'lobby', 'pickup') then raise exception 'Pick how you want to get it'; end if;
  if length(v_note) > 80 then raise exception 'Keep the note under 80 characters'; end if;
  if exists (select 1 from public.requests where buyer_id = auth.uid() and status in ('open', 'accepted', 'arriving', 'renting', 'returning')) then
    raise exception 'Finish your current request first';
  end if;

  select * into v_item from public.items where id = p_item_id and not special;
  if not found then raise exception 'Item not found'; end if;
  if v_item.category = 'alcohol' then perform public.check_can_buy_alcohol(v_community); end if;

  if not exists (select 1 from public.available_listings(v_community) a where a.item_id = v_item.id and a.seller_id <> auth.uid()) then
    raise exception 'Nobody nearby has this right now';
  end if;

  if p_fulfillment = 'dropoff' then
    select room into v_room from public.home_details where user_id = auth.uid();
    if v_room is null then raise exception 'Add your room number first'; end if;
  end if;

  if v_item.kind = 'buy' then
    select * into v_price from public.buy_price(v_item.market_price);
    v_base := v_price.total;
    v_adjust := public.round5_signed(v_base * public.fulfillment_pct(p_fulfillment) / 100.0);
    insert into public.requests (kind, buyer_id, item_id, community_id, location_note, item_price, deliverer_fee, platform_fee, total, fulfillment, fulfillment_adjust)
    values ('buy', auth.uid(), v_item.id, v_community, v_note, v_price.item_price, v_price.deliverer_fee, v_price.platform_fee, v_base + v_adjust, p_fulfillment, v_adjust)
    returning * into v_request;
  else
    select * into v_duration from public.rental_duration(p_duration_id);
    if not found then raise exception 'Pick how long you need it'; end if;
    v_rent := greatest(100, public.round5(public.rent_per_day(v_item.market_price) * v_duration.multiplier));
    v_base := v_rent + 25;
    v_adjust := public.round5_signed(v_base * public.fulfillment_pct(p_fulfillment) / 100.0);
    insert into public.requests (kind, buyer_id, item_id, community_id, location_note, item_price, deliverer_fee, platform_fee, total, rental_hours, hold_amount, fulfillment, fulfillment_adjust)
    values ('rent', auth.uid(), v_item.id, v_community, v_note, 0, v_rent, 25, v_base + v_adjust, v_duration.hours, v_item.market_price, p_fulfillment, v_adjust)
    returning * into v_request;
  end if;

  insert into public.handoff_codes (request_id, purpose, code) values (v_request.id, 'handoff', public.new_handoff_code());
  if v_room is not null then
    insert into public.request_private (request_id, buyer_room) values (v_request.id, v_room);
  end if;
  return v_request;
end $$;

create or replace function public.accept_request(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_request public.requests;
  v_adjust int;
  v_fulfillment text;
  v_category text;
  v_room text;
begin
  if exists (select 1 from public.requests where accepted_by = auth.uid() and status in ('accepted', 'arriving')) then
    raise exception 'Finish your current delivery first';
  end if;

  select r.fulfillment, i.category into v_fulfillment, v_category
  from public.requests r join public.items i on i.id = r.item_id where r.id = p_id;
  if v_category = 'alcohol' and not public.is_admin() then
    raise exception 'Only Lobb-verified sellers can deliver alcohol';
  end if;
  if v_fulfillment = 'pickup' then
    select room into v_room from public.home_details where user_id = auth.uid();
    if v_room is null then raise exception 'Add your room number first so the buyer can find you'; end if;
  end if;

  select coalesce(adjust_pct, 0) into v_adjust from public.listings r_l
  where r_l.seller_id = auth.uid() and r_l.item_id = (select item_id from public.requests where id = p_id);
  v_adjust := coalesce(v_adjust, 0);

  update public.requests r set
    status = 'accepted',
    accepted_by = auth.uid(),
    accepted_at = now(),
    deadline_at = now() + interval '10 minutes',
    seller_payout = case
      when r.kind = 'buy' then (select b.item_price + b.deliverer_fee from public.items i, public.buy_price(i.market_price, v_adjust) b where i.id = r.item_id) + r.fulfillment_adjust
      else r.deliverer_fee + r.fulfillment_adjust
    end
  where r.id = p_id
    and r.status = 'open'
    and r.buyer_id <> auth.uid()
    and r.community_id = public.my_community()
    and (r.kind = 'buy' or exists (select 1 from public.listings l where l.seller_id = auth.uid() and l.item_id = r.item_id))
  returning * into v_request;

  if not found then raise exception 'Someone else got this one'; end if;

  if v_request.fulfillment = 'pickup' then
    insert into public.request_private (request_id, seller_room) values (v_request.id, v_room)
    on conflict (request_id) do update set seller_room = excluded.seller_room;
  end if;
  return v_request;
end $$;

-- Alcohol can only be handed over after the seller has checked the buyer's ID in person.
alter table public.requests add column id_checked_at timestamptz;

drop function public.confirm_handoff(uuid, text, text);
create or replace function public.confirm_handoff(p_id uuid, p_code text, p_photo_path text, p_id_checked boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_request public.requests;
  v_error text;
  v_alcohol boolean;
begin
  select * into v_request from public.requests where id = p_id and accepted_by = auth.uid() and status in ('accepted', 'arriving');
  if not found then raise exception 'Request not found'; end if;
  if v_request.seal_verified_at is null then raise exception 'Verify the item first'; end if;
  select category = 'alcohol' into v_alcohol from public.items where id = v_request.item_id;
  if v_alcohol and not coalesce(p_id_checked, false) then
    raise exception 'Check their ID first: they must be 21 or older';
  end if;
  v_error := public.check_code(p_id, 'handoff', p_code);
  if v_error is not null then return jsonb_build_object('ok', false, 'error', v_error); end if;

  update public.requests set
    status = case when kind = 'rent' then 'renting' else 'delivered' end,
    delivered_at = now(),
    handoff_photo_path = p_photo_path,
    id_checked_at = case when v_alcohol then now() end,
    return_by = case when kind = 'rent' then now() + make_interval(hours => rental_hours) end
  where id = p_id
  returning * into v_request;

  if v_request.kind = 'buy' then
    update public.listings set quantity = greatest(0, quantity - 1)
    where seller_id = auth.uid() and item_id = v_request.item_id;
  end if;
  return jsonb_build_object('ok', true, 'status', v_request.status);
end $$;

-- ── Shout-outs ──────────────────────────────────────────────────────────────
-- "Anyone have a plunger?" Posted to your building; neighbors with notifications on get pinged.
-- The first neighbor to say "I have one" gets it, and it becomes a normal delivery (or loan).
-- The poster names their price up front; Lobb keeps its usual 25¢ fee.

create table public.shoutouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  community_id text not null references public.communities,
  text text not null check (length(btrim(text)) between 2 and 60),
  note text not null default '' check (length(note) <= 120),
  kind text not null check (kind in ('buy', 'rent')),
  category text not null check (category in ('snacks', 'drinks', 'instant', 'toiletries', 'electronics', 'household')),
  offer int not null check (offer between 100 and 5000),
  fulfillment text not null default 'lobby' check (fulfillment in ('dropoff', 'lobby', 'pickup')),
  rental_hours int,
  status text not null default 'open' check (status in ('open', 'claimed', 'cancelled')),
  claimed_by uuid references public.profiles,
  request_id uuid references public.requests,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours',
  check (kind = 'buy' or category in ('electronics', 'household'))
);

create index shoutouts_open_by_community on public.shoutouts (community_id, created_at desc) where status = 'open';

alter table public.shoutouts enable row level security;
create policy "building sees shout-outs" on public.shoutouts for select to authenticated
  using (user_id = auth.uid() or community_id = public.my_community());
grant select on public.shoutouts to authenticated;
grant all on public.shoutouts to service_role;

alter publication supabase_realtime add table public.shoutouts;

create or replace function public.create_shoutout(p_text text, p_kind text, p_category text, p_offer int, p_fulfillment text default 'lobby', p_note text default '', p_hours int default null)
returns public.shoutouts language plpgsql security definer set search_path = public as $$
declare
  v_community text := public.my_community();
  v_text text := btrim(coalesce(p_text, ''));
  v_shoutout public.shoutouts;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if v_community is null then raise exception 'Pick your building first'; end if;
  if length(v_text) < 2 or length(v_text) > 60 then raise exception 'Say what you need in 2–60 characters'; end if;
  if v_text ~* '\m(alcohol|beer|wine|vodka|whiskey|tequila|rum|liquor|seltzer|weed|cannabis|thc|vape|nicotine|cigarettes?|juul|adderall|xanax|pills?|gun|ammo)\M' then
    raise exception 'That can’t be requested on Lobb';
  end if;
  if p_kind not in ('buy', 'rent') then raise exception 'Pick buy or borrow'; end if;
  if p_category not in ('snacks', 'drinks', 'instant', 'toiletries', 'electronics', 'household') then raise exception 'Pick a category'; end if;
  if p_kind = 'rent' and p_category not in ('electronics', 'household') then raise exception 'Only non-food items can be borrowed'; end if;
  if p_offer is null or p_offer not between 100 and 5000 then raise exception 'Offer between $1 and $50'; end if;
  if p_fulfillment not in ('dropoff', 'lobby', 'pickup') then raise exception 'Pick how you want to get it'; end if;
  if p_fulfillment = 'dropoff' and not exists (select 1 from public.home_details where user_id = auth.uid() and room is not null) then
    raise exception 'Add your room number first';
  end if;
  if (select count(*) from public.shoutouts where user_id = auth.uid() and status = 'open' and expires_at > now()) >= 3 then
    raise exception 'You already have 3 shout-outs out. Cancel one first.';
  end if;

  insert into public.shoutouts (user_id, community_id, text, note, kind, category, offer, fulfillment, rental_hours)
  values (auth.uid(), v_community, v_text, coalesce(btrim(p_note), ''), p_kind, p_category, p_offer, p_fulfillment,
          case when p_kind = 'rent' then coalesce(p_hours, 24) end)
  returning * into v_shoutout;
  return v_shoutout;
end $$;

create or replace function public.cancel_shoutout(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.shoutouts set status = 'cancelled' where id = p_id and user_id = auth.uid() and status = 'open';
  if not found then raise exception 'This shout-out can’t be cancelled now'; end if;
end $$;

-- First come, first served (one conditional UPDATE), then the shout-out becomes an accepted request.
create or replace function public.claim_shoutout(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_shoutout public.shoutouts;
  v_item public.items;
  v_request public.requests;
  v_buyer_room text;
  v_seller_room text;
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

  insert into public.items (kind, name, size, category, emoji, market_price, special, created_by)
  values (v_shoutout.kind, v_shoutout.text, case when v_shoutout.kind = 'rent' then 'Borrowed' else 'Shout-out' end,
          v_shoutout.category, '📣', v_shoutout.offer, true, v_shoutout.user_id)
  returning * into v_item;

  insert into public.requests (kind, buyer_id, item_id, community_id, status, location_note, item_price, deliverer_fee, platform_fee, total,
                               rental_hours, fulfillment, seller_payout, accepted_by, accepted_at, deadline_at)
  values (v_shoutout.kind, v_shoutout.user_id, v_item.id, v_shoutout.community_id, 'accepted', v_shoutout.note,
          case when v_shoutout.kind = 'buy' then v_shoutout.offer - 25 else 0 end,
          case when v_shoutout.kind = 'rent' then v_shoutout.offer - 25 else 0 end,
          25, v_shoutout.offer, v_shoutout.rental_hours, v_shoutout.fulfillment, v_shoutout.offer - 25,
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

-- ── Function access ─────────────────────────────────────────────────────────

revoke execute on function public.is_admin(), public.set_birthdate(date), public.check_can_buy_alcohol(text),
  public.price_within_limits(int, int), public.create_item(uuid, text, text, text, int, int),
  public.confirm_handoff(uuid, text, text, boolean), public.create_shoutout(text, text, text, int, text, text, int),
  public.cancel_shoutout(uuid), public.claim_shoutout(uuid) from public, anon;
revoke execute on function public.check_can_buy_alcohol(text) from authenticated;
grant execute on function public.is_admin(), public.set_birthdate(date), public.price_within_limits(int, int),
  public.create_item(uuid, text, text, text, int, int), public.confirm_handoff(uuid, text, text, boolean),
  public.create_shoutout(text, text, text, int, text, text, int), public.cancel_shoutout(uuid), public.claim_shoutout(uuid)
  to authenticated;
