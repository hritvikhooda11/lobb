-- Two-way ratings that can be changed, and "I'm here" notifications for both sides of a handoff.

-- ── Ratings ─────────────────────────────────────────────────────────────────
-- The buyer rates the neighbor who delivered (requests.rating) and the neighbor rates the buyer
-- (requests.buyer_rating). Either can change their rating. A profile's rating is the average of every
-- rating they've received, both ways; rating_count = 0 means "new" (the app shows no stars yet).

alter table public.requests
  add column buyer_rating int check (buyer_rating between 1 and 5),
  -- The buyer tapped "I'm here" (in the lobby, or at the seller's door for a pickup).
  add column buyer_here_at timestamptz;

create or replace function public.refresh_rating(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update public.profiles p set
    rating_avg = coalesce(r.avg, 5.0),
    rating_count = r.n
  from (
    select round(avg(x), 1) as avg, count(*)::int as n from (
      select rating as x from public.requests where accepted_by = p_user and rating is not null
      union all
      select buyer_rating from public.requests where buyer_id = p_user and buyer_rating is not null
    ) t
  ) r
  where p.id = p_user
$$;

create or replace function public.rate_request(p_id uuid, p_stars int)
returns void language plpgsql security definer set search_path = public as $$
declare v_request public.requests;
begin
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'Stars must be 1–5'; end if;
  select * into v_request from public.requests
  where id = p_id and status in ('delivered', 'renting', 'returning', 'returned') and auth.uid() in (buyer_id, accepted_by);
  if not found then raise exception 'You can rate this once it’s handed over'; end if;

  if v_request.buyer_id = auth.uid() then
    update public.requests set rating = p_stars where id = p_id;
    perform public.refresh_rating(v_request.accepted_by);
  else
    update public.requests set buyer_rating = p_stars where id = p_id;
    perform public.refresh_rating(v_request.buyer_id);
  end if;
end $$;

-- ── "I'm here" ──────────────────────────────────────────────────────────────
-- Each arrival is also written to request_events, which a database webhook sends to the push
-- function, so the other person gets a notification even with Lobb closed.

create table public.request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests on delete cascade,
  kind text not null check (kind in ('seller_arrived', 'buyer_here')),
  created_at timestamptz not null default now()
);
alter table public.request_events enable row level security;
grant all on public.request_events to service_role;

create or replace function public.mark_arrived(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare v_request public.requests;
begin
  update public.requests set status = 'arriving'
  where id = p_id and accepted_by = auth.uid() and status = 'accepted' and seal_verified_at is not null
  returning * into v_request;
  if not found then raise exception 'Verify the item first'; end if;
  insert into public.request_events (request_id, kind) values (p_id, 'seller_arrived');
  return v_request;
end $$;

-- The buyer is waiting: in the lobby, or at the seller's door for a pickup. (Door drop-off buyers are home.)
create or replace function public.buyer_here(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare v_request public.requests;
begin
  update public.requests set buyer_here_at = now()
  where id = p_id and buyer_id = auth.uid() and status in ('accepted', 'arriving') and fulfillment in ('lobby', 'pickup')
    and (buyer_here_at is null or buyer_here_at < now() - interval '1 minute')
  returning * into v_request;
  if not found then
    if exists (select 1 from public.requests where id = p_id and buyer_id = auth.uid() and buyer_here_at >= now() - interval '1 minute') then
      raise exception 'We just told them. Give it a minute.';
    end if;
    raise exception 'This order isn’t waiting on you right now';
  end if;
  insert into public.request_events (request_id, kind) values (p_id, 'buyer_here');
  return v_request;
end $$;

-- ── Push text ───────────────────────────────────────────────────────────────

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
  where p_table = 'request_events' and e.id = p_id
$$;

revoke execute on function public.refresh_rating(uuid) from public, anon, authenticated;
revoke execute on function public.buyer_here(uuid) from public, anon;
grant execute on function public.buyer_here(uuid) to authenticated;
revoke execute on function public.push_messages(text, uuid) from public, anon, authenticated;
grant execute on function public.push_messages(text, uuid) to service_role;
