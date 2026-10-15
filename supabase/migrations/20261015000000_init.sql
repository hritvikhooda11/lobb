-- Lobb Phase 1 schema.
--
-- Rule of thumb: the app is untrusted. Prices, first-come-first-serve accepts and handoff
-- codes are all decided here, through SECURITY DEFINER functions. Tables are read through
-- row-level security and are never written directly by clients (except listings + own profile).

create extension if not exists pgcrypto with schema extensions;

-- ── Communities ─────────────────────────────────────────────────────────────

create table public.communities (
  id text primary key,
  name text not null,
  type text not null check (type in ('dorm', 'high-rise', 'apartment'))
);

insert into public.communities (id, name, type) values
  ('standard', 'The Standard', 'high-rise'),
  ('west-campus', 'West Campus Dorms', 'dorm'),
  ('north-campus', 'North Campus Dorms', 'dorm'),
  ('m-housing', 'M Housing', 'apartment');

-- ── Sign-up gate: only allowed email domains (uw.edu) ──────────────────────

create table public.allowed_email_domains (domain text primary key);
insert into public.allowed_email_domains values ('uw.edu');

create or replace function public.enforce_email_domain()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.allowed_email_domains d
    where lower(split_part(new.email, '@', 2)) = d.domain
  ) then
    raise exception 'Lobb is only open to @uw.edu email addresses';
  end if;
  return new;
end $$;

create trigger enforce_email_domain
  before insert on auth.users
  for each row execute function public.enforce_email_domain();

-- ── Profiles ────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null,
  community_id text references public.communities,
  rating_avg numeric(2, 1) not null default 5.0,
  rating_count int not null default 0,
  reliability_score int not null default 100,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  local_part text := split_part(new.email, '@', 1);
begin
  insert into public.profiles (id, name)
  values (new.id, upper(left(local_part, 1)) || substr(local_part, 2));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_community()
returns text language sql stable security definer set search_path = public as $$
  select community_id from public.profiles where id = auth.uid()
$$;

-- ── Catalog ─────────────────────────────────────────────────────────────────

create table public.items (
  id text primary key default 'user-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10),
  kind text not null check (kind in ('buy', 'rent')),
  barcode text,
  name text not null check (length(name) between 2 and 80),
  size text not null default '',
  category text not null check (category in ('snacks', 'drinks', 'instant', 'toiletries', 'electronics', 'household')),
  emoji text not null default '📦',
  image_url text,
  market_price int not null check (market_price between 25 and 100000),
  created_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  check (kind = 'buy' or category in ('electronics', 'household'))
);

create unique index items_barcode_unique on public.items (kind, ltrim(barcode, '0')) where barcode is not null;

-- Seed catalog. Ids match the app's bundled photos (src/data/catalog.ts).
insert into public.items (id, kind, barcode, name, size, category, emoji, market_price) values
  ('coke-12', 'buy', '10603499', 'Coca-Cola', '12 oz can', 'drinks', '🥤', 125),
  ('redbull-8', 'buy', '9002490100070', 'Red Bull', '8.4 oz can', 'drinks', '⚡️', 299),
  ('water-16', 'buy', '075720481279', 'Poland Spring water', '16.9 oz', 'drinks', '💧', 100),
  ('celsius', 'buy', '889392000917', 'Celsius', '12 oz can', 'drinks', '🫧', 279),
  ('hot-cheetos', 'buy', '028400589895', 'Flamin’ Hot Cheetos', '2.5 oz bag', 'snacks', '🌶️', 229),
  ('oreos', 'buy', '044000047009', 'Oreo snack pack', '6 cookies', 'snacks', '🍪', 179),
  ('kind-bar', 'buy', '602652431142', 'KIND bar', '1.4 oz', 'snacks', '🥜', 199),
  ('goldfish', 'buy', '014100048145', 'Goldfish', '1.5 oz bag', 'snacks', '🐟', 129),
  ('cup-noodles', 'buy', '070662030035', 'Cup Noodles', 'Chicken', 'instant', '🍜', 109),
  ('shin-ramyun', 'buy', '031146022861', 'Shin Ramyun', '4.2 oz pack', 'instant', '🔥', 189),
  ('mac-cup', 'buy', '021000053834', 'Easy Mac cup', '2.05 oz', 'instant', '🧀', 159),
  ('toothpaste', 'buy', null, 'Colgate toothpaste', 'Travel size', 'toiletries', '🪥', 149),
  ('deodorant', 'buy', null, 'Dove deodorant', 'Travel size', 'toiletries', '🧴', 199),
  ('lightning', 'buy', null, 'Lightning cable', '3 ft, sealed', 'electronics', '🔋', 999),
  ('tissues', 'buy', null, 'Tissues', 'Box', 'household', '🤧', 199),
  ('aa-batteries', 'buy', null, 'AA batteries', '4-pack, sealed', 'household', '🪫', 549),
  ('ti84', 'rent', null, 'TI-84 Plus calculator', 'Graphing', 'electronics', '🧮', 11999),
  ('hdmi', 'rent', null, 'HDMI cable', '6 ft', 'electronics', '📺', 1099),
  ('power-strip', 'rent', null, 'Power strip', '6 outlets', 'electronics', '🔌', 1999),
  ('umbrella', 'rent', null, 'Umbrella', 'Full size', 'household', '☂️', 1500),
  ('iron', 'rent', null, 'Steam iron', 'Clothes iron', 'household', '👔', 2999);

-- AI price quotes, written only by the server (/api/price, service role).
-- create_item() only accepts a price that came from here, so sellers can't invent prices.
create table public.price_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  kind text not null check (kind in ('buy', 'rent')),
  name text not null,
  size text not null default '',
  category text not null,
  market_price int not null check (market_price between 25 and 100000),
  eligible boolean not null,
  created_at timestamptz not null default now()
);

-- ── Listings ────────────────────────────────────────────────────────────────

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null default auth.uid() references public.profiles on delete cascade,
  item_id text not null references public.items on delete cascade,
  quantity int not null default 1 check (quantity between 0 and 99),
  adjust_pct int not null default 0 check (adjust_pct between -5 and 5),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (seller_id, item_id)
);

-- ── Requests ────────────────────────────────────────────────────────────────

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('buy', 'rent')),
  buyer_id uuid not null references public.profiles on delete cascade,
  item_id text not null references public.items,
  community_id text not null references public.communities,
  status text not null default 'open'
    check (status in ('open', 'accepted', 'arriving', 'delivered', 'renting', 'returning', 'returned', 'expired', 'cancelled')),
  location_note text not null default 'My door' check (length(location_note) <= 80),
  -- Prices in cents, fixed at creation (buyer) and acceptance (seller payout).
  item_price int not null,
  deliverer_fee int not null,
  platform_fee int not null,
  total int not null,
  rental_hours int,
  hold_amount int,
  seller_payout int,
  accepted_by uuid references public.profiles,
  accepted_at timestamptz,
  deadline_at timestamptz,
  seal_verified_at timestamptz,
  seal_photo_path text,
  delivered_at timestamptz,
  handoff_photo_path text,
  return_by timestamptz,
  returned_at timestamptz,
  rating int check (rating between 1 and 5),
  created_at timestamptz not null default now()
);

create index requests_open_by_community on public.requests (community_id, created_at) where status = 'open';
create index requests_buyer on public.requests (buyer_id, created_at desc);
create index requests_deliverer on public.requests (accepted_by, created_at desc);

-- Handoff codes: readable only by the buyer, who shows them as a QR. The deliverer
-- must scan the code in person; wrong guesses are capped.
create table public.handoff_codes (
  request_id uuid not null references public.requests on delete cascade,
  purpose text not null check (purpose in ('handoff', 'return')),
  code text not null,
  attempts int not null default 0,
  used_at timestamptz,
  primary key (request_id, purpose)
);

-- ── Pricing (mirrors src/data/pricing.ts — keep them in sync) ───────────────

create or replace function public.round5(x numeric) returns int language sql immutable as $$
  select (round(x / 5.0) * 5)::int
$$;

create or replace function public.buy_price(market int, adjust int default 0)
returns table (item_price int, deliverer_fee int, platform_fee int, total int)
language sql immutable as $$
  with p as (select public.round5(market * (1 + adjust / 100.0)) as item)
  select item, greatest(75, public.round5(item * 0.2)), 25, item + greatest(75, public.round5(item * 0.2)) + 25 from p
$$;

create or replace function public.rent_per_day(market int, adjust int default 0) returns int language sql immutable as $$
  select greatest(100, public.round5(market * 0.06 * (1 + adjust / 100.0)))
$$;

create or replace function public.rental_duration(duration_id text)
returns table (hours int, multiplier numeric) language sql immutable as $$
  select d.hours, d.multiplier from (values ('3h', 3, 0.5), ('1d', 24, 1.0), ('3d', 72, 2.5)) d(id, hours, multiplier) where d.id = duration_id
$$;

create or replace function public.new_handoff_code() returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
  from extensions.gen_random_bytes(6) b, generate_series(0, 5) i
$$;

-- ── Row-level security ──────────────────────────────────────────────────────

alter table public.communities enable row level security;
alter table public.allowed_email_domains enable row level security;
alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.price_quotes enable row level security;
alter table public.listings enable row level security;
alter table public.requests enable row level security;
alter table public.handoff_codes enable row level security;

create policy "communities are public" on public.communities for select using (true);

create policy "see neighbors' profiles" on public.profiles for select to authenticated
  using (id = auth.uid() or community_id = public.my_community());
create policy "edit own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (name, community_id) on public.profiles to authenticated;

create policy "catalog is readable" on public.items for select to authenticated using (true);

create policy "own listings" on public.listings for all to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());

-- Open requests go first to neighbors who listed the item, then to everyone after 20s.
create policy "see relevant requests" on public.requests for select to authenticated using (
  buyer_id = auth.uid()
  or accepted_by = auth.uid()
  or (
    status = 'open'
    and community_id = public.my_community()
    and (
      created_at < now() - interval '20 seconds'
      or exists (
        select 1 from public.listings l
        where l.seller_id = auth.uid() and l.item_id = requests.item_id and l.active and l.quantity > 0
      )
    )
  )
);

create policy "buyer sees own codes" on public.handoff_codes for select to authenticated using (
  exists (select 1 from public.requests r where r.id = request_id and r.buyer_id = auth.uid())
);

-- ── Functions the app calls ─────────────────────────────────────────────────

-- How many neighbors in my community list each item.
create or replace function public.item_counts()
returns table (item_id text, sellers int) language sql stable security definer set search_path = public as $$
  select l.item_id, count(distinct l.seller_id)::int
  from public.listings l join public.profiles p on p.id = l.seller_id
  where l.active and l.quantity > 0 and p.community_id = public.my_community() and l.seller_id <> auth.uid()
  group by l.item_id
$$;

create or replace function public.create_request(p_item_id text, p_location_note text, p_duration_id text default null)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_item public.items;
  v_community text := public.my_community();
  v_price record;
  v_duration record;
  v_request public.requests;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if v_community is null then raise exception 'Pick your building first'; end if;
  if exists (select 1 from public.requests where buyer_id = auth.uid() and status in ('open', 'accepted', 'arriving', 'renting', 'returning')) then
    raise exception 'Finish your current request first';
  end if;

  select * into v_item from public.items where id = p_item_id;
  if not found then raise exception 'Item not found'; end if;

  if v_item.kind = 'buy' then
    select * into v_price from public.buy_price(v_item.market_price);
    insert into public.requests (kind, buyer_id, item_id, community_id, location_note, item_price, deliverer_fee, platform_fee, total)
    values ('buy', auth.uid(), v_item.id, v_community, coalesce(nullif(trim(p_location_note), ''), 'My door'),
            v_price.item_price, v_price.deliverer_fee, v_price.platform_fee, v_price.total)
    returning * into v_request;
  else
    select * into v_duration from public.rental_duration(p_duration_id);
    if not found then raise exception 'Pick how long you need it'; end if;
    insert into public.requests (kind, buyer_id, item_id, community_id, location_note, item_price, deliverer_fee, platform_fee, total, rental_hours, hold_amount)
    values ('rent', auth.uid(), v_item.id, v_community, coalesce(nullif(trim(p_location_note), ''), 'My door'),
            0, greatest(100, public.round5(public.rent_per_day(v_item.market_price) * v_duration.multiplier)), 25,
            greatest(100, public.round5(public.rent_per_day(v_item.market_price) * v_duration.multiplier)) + 25,
            v_duration.hours, v_item.market_price)
    returning * into v_request;
  end if;

  insert into public.handoff_codes (request_id, purpose, code) values (v_request.id, 'handoff', public.new_handoff_code());
  return v_request;
end $$;

create or replace function public.cancel_request(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare v_request public.requests;
begin
  update public.requests set status = 'cancelled'
  where id = p_id and buyer_id = auth.uid()
    and (status = 'open' or (status = 'accepted' and deadline_at < now()))
  returning * into v_request;
  if not found then raise exception 'This request can’t be cancelled now'; end if;
  return v_request;
end $$;

-- First come, first served: a single conditional UPDATE, so two neighbors can never both win.
create or replace function public.accept_request(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare
  v_request public.requests;
  v_adjust int;
begin
  if exists (select 1 from public.requests where accepted_by = auth.uid() and status in ('accepted', 'arriving')) then
    raise exception 'Finish your current delivery first';
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
      when r.kind = 'buy' then (select b.item_price + b.deliverer_fee from public.items i, public.buy_price(i.market_price, v_adjust) b where i.id = r.item_id)
      else r.deliverer_fee
    end
  where r.id = p_id
    and r.status = 'open'
    and r.buyer_id <> auth.uid()
    and r.community_id = public.my_community()
    and (r.kind = 'buy' or exists (select 1 from public.listings l where l.seller_id = auth.uid() and l.item_id = r.item_id))
  returning * into v_request;

  if not found then raise exception 'Someone else got this one'; end if;
  return v_request;
end $$;

create or replace function public.verify_seal(p_id uuid, p_photo_path text)
returns public.requests language plpgsql security definer set search_path = public as $$
declare v_request public.requests;
begin
  update public.requests set seal_verified_at = now(), seal_photo_path = p_photo_path
  where id = p_id and accepted_by = auth.uid() and status = 'accepted'
  returning * into v_request;
  if not found then raise exception 'Request not found'; end if;
  return v_request;
end $$;

create or replace function public.mark_arrived(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare v_request public.requests;
begin
  update public.requests set status = 'arriving'
  where id = p_id and accepted_by = auth.uid() and status = 'accepted' and seal_verified_at is not null
  returning * into v_request;
  if not found then raise exception 'Verify the item first'; end if;
  return v_request;
end $$;

-- Checks a scanned code. Five wrong tries locks it. Returns an error message, or null when it
-- matches. It must NOT raise on a wrong code: raising would roll back the attempt counter.
create or replace function public.check_code(p_id uuid, p_purpose text, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare v_code public.handoff_codes;
begin
  select * into v_code from public.handoff_codes where request_id = p_id and purpose = p_purpose for update;
  if not found or v_code.used_at is not null then return 'This code isn’t active'; end if;
  if v_code.attempts >= 5 then return 'Too many tries. Ask them to contact support.'; end if;
  if upper(trim(p_code)) <> v_code.code then
    update public.handoff_codes set attempts = attempts + 1 where request_id = p_id and purpose = p_purpose;
    return 'That code doesn’t match';
  end if;
  update public.handoff_codes set used_at = now() where request_id = p_id and purpose = p_purpose;
  return null;
end $$;

-- Returns {ok, error?, status?} instead of raising on a wrong code (see check_code).
create or replace function public.confirm_handoff(p_id uuid, p_code text, p_photo_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_request public.requests;
  v_error text;
begin
  select * into v_request from public.requests where id = p_id and accepted_by = auth.uid() and status in ('accepted', 'arriving');
  if not found then raise exception 'Request not found'; end if;
  if v_request.seal_verified_at is null then raise exception 'Verify the item first'; end if;
  v_error := public.check_code(p_id, 'handoff', p_code);
  if v_error is not null then return jsonb_build_object('ok', false, 'error', v_error); end if;

  update public.requests set
    status = case when kind = 'rent' then 'renting' else 'delivered' end,
    delivered_at = now(),
    handoff_photo_path = p_photo_path,
    return_by = case when kind = 'rent' then now() + make_interval(hours => rental_hours) end
  where id = p_id
  returning * into v_request;

  if v_request.kind = 'buy' then
    update public.listings set quantity = greatest(0, quantity - 1)
    where seller_id = auth.uid() and item_id = v_request.item_id;
  end if;
  return jsonb_build_object('ok', true, 'status', v_request.status);
end $$;

create or replace function public.start_return(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare v_request public.requests;
begin
  update public.requests set status = 'returning'
  where id = p_id and buyer_id = auth.uid() and status = 'renting'
  returning * into v_request;
  if not found then raise exception 'Nothing to return'; end if;
  insert into public.handoff_codes (request_id, purpose, code) values (p_id, 'return', public.new_handoff_code())
  on conflict (request_id, purpose) do nothing;
  return v_request;
end $$;

-- The lender scans the renter's return QR.
create or replace function public.confirm_return(p_id uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_error text;
begin
  if not exists (select 1 from public.requests where id = p_id and accepted_by = auth.uid() and status = 'returning') then
    raise exception 'Request not found';
  end if;
  v_error := public.check_code(p_id, 'return', p_code);
  if v_error is not null then return jsonb_build_object('ok', false, 'error', v_error); end if;
  update public.requests set status = 'returned', returned_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'returned');
end $$;

create or replace function public.rate_request(p_id uuid, p_stars int)
returns void language plpgsql security definer set search_path = public as $$
declare v_request public.requests;
begin
  if p_stars not between 1 and 5 then raise exception 'Stars must be 1–5'; end if;
  update public.requests set rating = p_stars
  where id = p_id and buyer_id = auth.uid() and status in ('delivered', 'returned') and rating is null
  returning * into v_request;
  if not found then return; end if;
  update public.profiles set
    rating_avg = round(((rating_avg * rating_count) + p_stars) / (rating_count + 1.0), 1),
    rating_count = rating_count + 1
  where id = v_request.accepted_by;
end $$;

-- Sellers add a brand-new item using a server-issued price quote.
create or replace function public.create_item(p_quote_id uuid, p_size text, p_image_url text, p_barcode text, p_adjust_pct int)
returns public.items language plpgsql security definer set search_path = public as $$
declare
  v_quote public.price_quotes;
  v_item public.items;
begin
  select * into v_quote from public.price_quotes
  where id = p_quote_id and user_id = auth.uid() and created_at > now() - interval '1 hour';
  if not found then raise exception 'Price quote expired. Get a new Lobb price.'; end if;
  if not v_quote.eligible then raise exception 'This item can’t be listed on Lobb'; end if;

  insert into public.items (kind, barcode, name, size, category, image_url, market_price, created_by)
  values (v_quote.kind, nullif(p_barcode, ''), v_quote.name, coalesce(nullif(p_size, ''), v_quote.size), v_quote.category,
          p_image_url, v_quote.market_price, auth.uid())
  returning * into v_item;

  insert into public.listings (seller_id, item_id, adjust_pct) values (auth.uid(), v_item.id, greatest(-5, least(5, coalesce(p_adjust_pct, 0))));
  delete from public.price_quotes where id = p_quote_id;
  return v_item;
end $$;

-- Functions are callable only by signed-in users.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.item_counts, public.create_request, public.cancel_request, public.accept_request,
  public.verify_seal, public.mark_arrived, public.confirm_handoff, public.start_return, public.confirm_return,
  public.rate_request, public.create_item, public.my_community to authenticated;

-- ── Realtime ────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.requests;

-- ── Expire requests nobody accepted within 10 minutes ───────────────────────

create extension if not exists pg_cron;
select cron.schedule('expire-open-requests', '* * * * *', $$
  update public.requests set status = 'expired' where status = 'open' and created_at < now() - interval '10 minutes'
$$);

-- ── Photo storage ───────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public) values
  ('item-photos', 'item-photos', true),
  ('handoff-photos', 'handoff-photos', false)
on conflict (id) do nothing;

-- Uploads go in a folder named after the user: <user id>/<file>.jpg
create policy "upload own photos" on storage.objects for insert to authenticated with check (
  bucket_id in ('item-photos', 'handoff-photos') and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "read own handoff photos" on storage.objects for select to authenticated using (
  bucket_id = 'handoff-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
