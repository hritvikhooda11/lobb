-- Remote push notifications. Each phone registers its Expo push token after sign-in; the `push`
-- Edge Function (supabase/functions/push) is called by database webhooks on new shout-outs and
-- requests, asks push_messages() who to notify and with what text, and sends via Expo's push API.

create table public.push_tokens (
  -- One row per device. The token is the key, so a phone that signs in to a second account
  -- moves to that account instead of notifying both.
  expo_push_token text primary key check (expo_push_token ~ '^Expo(nent)?PushToken\[[^\]]+\]$'),
  user_id uuid not null references public.profiles on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);

create index push_tokens_user on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
create policy "own push tokens" on public.push_tokens for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_tokens to authenticated;
grant all on public.push_tokens to service_role;

-- Upsert that also takes over a token another account registered on the same phone (RLS alone
-- would block that update, and the old account must stop getting this phone's notifications).
create or replace function public.register_push_token(p_token text, p_platform text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.push_tokens (expo_push_token, user_id, platform) values (p_token, auth.uid(), p_platform)
  on conflict (expo_push_token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end $$;

-- ── What to send ────────────────────────────────────────────────────────────
-- Only what's needed for the banner: first names, item names and prices. Never rooms or birthdates.

create or replace function public.push_money(p_cents int) returns text language sql immutable as $$
  select '$' || to_char(p_cents / 100.0, 'FM9990.00')
$$;

create or replace function public.push_messages(p_table text, p_id uuid)
returns table (token text, title text, body text, url text, kind text)
language sql stable security definer set search_path = public as $$
  -- A new shout-out → everyone else in the building with shout-out alerts on.
  select t.expo_push_token,
         '📣 ' || s.text || '?',
         poster.name || case when s.kind = 'rent' then ' will pay ' || public.push_money(s.offer) || ' to borrow one. Have it?'
                             else ' will pay ' || public.push_money(s.offer) || '. Have one?' end,
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
$$;

-- Called by the Edge Function when Expo says a phone uninstalled the app or turned off notifications.
create or replace function public.forget_push_tokens(p_tokens text[])
returns void language sql security definer set search_path = public as $$
  delete from public.push_tokens where expo_push_token = any (p_tokens)
$$;

revoke execute on function public.register_push_token(text, text), public.push_messages(text, uuid),
  public.forget_push_tokens(text[]), public.push_money(int) from public, anon, authenticated;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.push_messages(text, uuid), public.forget_push_tokens(text[]), public.push_money(int) to service_role;
