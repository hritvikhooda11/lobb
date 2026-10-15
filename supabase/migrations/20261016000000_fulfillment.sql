-- Room numbers, delivery options (door / lobby / pickup), price differences, and stock rules.

-- ── Room numbers (private) ──────────────────────────────────────────────────
-- A room number is only ever shown to the other person in an accepted request, never to
-- the whole building, so it lives in its own table instead of on profiles (which neighbors can read).

create table public.home_details (
  user_id uuid primary key references public.profiles on delete cascade,
  room text not null check (length(btrim(room)) between 1 and 12)
);

alter table public.home_details enable row level security;
create policy "own room" on public.home_details for select to authenticated using (user_id = auth.uid());
grant select on public.home_details to authenticated;
grant all on public.home_details to service_role;

create or replace function public.set_home(p_community text, p_room text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from public.communities where id = p_community) then raise exception 'Pick your building'; end if;
  if length(btrim(coalesce(p_room, ''))) not between 1 and 12 then raise exception 'Enter your room number (up to 12 characters)'; end if;
  update public.profiles set community_id = p_community where id = auth.uid();
  insert into public.home_details (user_id, room) values (auth.uid(), upper(btrim(p_room)))
  on conflict (user_id) do update set room = excluded.room;
end $$;

-- ── Delivery options ────────────────────────────────────────────────────────

alter table public.requests
  add column fulfillment text not null default 'lobby' check (fulfillment in ('dropoff', 'lobby', 'pickup')),
  add column fulfillment_adjust int not null default 0;

-- Only the two people in a request can see the rooms it involves: the buyer's room for a door
-- drop-off, the seller's room for a pickup. Lobby meetups never store a room.
create table public.request_private (
  request_id uuid primary key references public.requests on delete cascade,
  buyer_room text,
  seller_room text
);

alter table public.request_private enable row level security;
create policy "parties see rooms" on public.request_private for select to authenticated using (
  exists (select 1 from public.requests r where r.id = request_id and (r.buyer_id = auth.uid() or r.accepted_by = auth.uid()))
);
grant select on public.request_private to authenticated;
grant all on public.request_private to service_role;

-- Price difference per option (mirrors src/data/pricing.ts). Lobby is the base price.
create or replace function public.fulfillment_pct(p text) returns int language sql immutable as $$
  select case p when 'pickup' then -10 when 'dropoff' then 15 else 0 end
$$;

-- Rounds to the nearest 5 cents, away from zero (so -22.5 → -25, like the app).
create or replace function public.round5_signed(x numeric) returns int language sql immutable as $$
  select (sign(x) * round(abs(x) / 5.0) * 5)::int
$$;

-- ── Stock ───────────────────────────────────────────────────────────────────

-- Who in a community can actually fulfil an item right now. A rental that's out on loan
-- is unavailable until it's returned.
create or replace function public.available_listings(p_community text)
returns table (item_id text, seller_id uuid) language sql stable security definer set search_path = public as $$
  select l.item_id, l.seller_id
  from public.listings l
  join public.profiles p on p.id = l.seller_id
  join public.items i on i.id = l.item_id
  where l.active and l.quantity > 0 and p.community_id = p_community
    and not (
      i.kind = 'rent' and exists (
        select 1 from public.requests r
        where r.accepted_by = l.seller_id and r.item_id = l.item_id and r.status in ('accepted', 'arriving', 'renting', 'returning')
      )
    )
$$;

create or replace function public.item_counts()
returns table (item_id text, sellers int) language sql stable security definer set search_path = public as $$
  select a.item_id, count(distinct a.seller_id)::int
  from public.available_listings(public.my_community()) a
  where a.seller_id <> auth.uid()
  group by a.item_id
$$;

-- ── Requests ────────────────────────────────────────────────────────────────

drop function if exists public.create_request(text, text, text);

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

  select * into v_item from public.items where id = p_item_id;
  if not found then raise exception 'Item not found'; end if;

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

-- First come, first served (same as before), plus: the seller's payout includes the option's price
-- difference, and a pickup records the seller's room so the buyer knows where to go.
create or replace function public.accept_request(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_request public.requests;
  v_adjust int;
  v_fulfillment text;
  v_room text;
begin
  if exists (select 1 from public.requests where accepted_by = auth.uid() and status in ('accepted', 'arriving')) then
    raise exception 'Finish your current delivery first';
  end if;

  select fulfillment into v_fulfillment from public.requests where id = p_id;
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

-- New functions are callable only by signed-in users (internal helpers by nobody).
revoke execute on function public.available_listings(text) from public, anon, authenticated;
revoke execute on function public.set_home(text, text) from public, anon;
revoke execute on function public.create_request(text, text, text, text) from public, anon;
grant execute on function public.set_home(text, text), public.create_request(text, text, text, text) to authenticated;
