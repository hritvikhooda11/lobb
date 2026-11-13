-- Safety for user-generated content (App Store guideline 1.2): reports that reach Lobb, and blocking.
--
-- Reports: anyone can report a person, listing, shout-out, chat message or order. Lobb reviews them
-- (Supabase dashboard → reports). Reporters can see their own reports; nobody else can.
--
-- Blocks work both ways: once either person blocks the other, they don't see each other's shout-outs
-- or open orders, can't chat, and can't be matched on a delivery.

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid default auth.uid() references public.profiles on delete set null,
  target_type text not null check (target_type in ('user', 'item', 'shoutout', 'message', 'request', 'other')),
  target_id text,
  reported_user_id uuid references public.profiles on delete set null,
  reason text not null check (length(btrim(reason)) between 2 and 80),
  details text not null default '' check (length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved')),
  created_at timestamptz not null default now()
);
create index reports_open on public.reports (created_at desc) where status = 'open';

alter table public.reports enable row level security;
create policy "file a report" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy "see own reports" on public.reports for select to authenticated using (reporter_id = auth.uid());
grant select, insert (target_type, target_id, reported_user_id, reason, details) on public.reports to authenticated;
grant all on public.reports to service_role;

create table public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles on delete cascade,
  blocked_id uuid not null references public.profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.blocks enable row level security;
create policy "manage own blocks" on public.blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());
grant select, insert (blocked_id), delete on public.blocks to authenticated;
grant all on public.blocks to service_role;

-- True if either person has blocked the other.
create or replace function public.blocked_between(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

-- Shout-outs from (or to) someone blocked are hidden.
drop policy "building sees shout-outs" on public.shoutouts;
create policy "building sees shout-outs" on public.shoutouts for select to authenticated
  using (user_id = auth.uid() or (community_id = public.my_community() and status <> 'pending_payment' and not public.blocked_between(auth.uid(), user_id)));

-- Open orders from someone blocked aren't offered.
drop policy "see relevant requests" on public.requests;
create policy "see relevant requests" on public.requests for select to authenticated using (
  buyer_id = auth.uid()
  or accepted_by = auth.uid()
  or (
    status = 'open'
    and community_id = public.my_community()
    and not public.blocked_between(auth.uid(), buyer_id)
    and (
      created_at < now() - interval '20 seconds'
      or exists (
        select 1 from public.listings l
        where l.seller_id = auth.uid() and l.item_id = requests.item_id and l.active and l.quantity > 0
      )
    )
  )
);

-- Nobody can be matched with someone they blocked (accepting an order, or claiming a shout-out).
create or replace function public.refuse_blocked_match() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.accepted_by is not null and (tg_op = 'INSERT' or old.accepted_by is distinct from new.accepted_by)
     and public.blocked_between(new.accepted_by, new.buyer_id) then
    raise exception 'You can’t deliver to this neighbor';
  end if;
  return new;
end $$;
create trigger requests_refuse_blocked_match before insert or update of accepted_by on public.requests
  for each row execute function public.refuse_blocked_match();

-- No chatting with someone blocked (either way).
create or replace function public.can_chat(p_request uuid, p_shoutout uuid, p_neighbor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when p_request is not null then exists (
      select 1 from public.requests r
      where r.id = p_request and r.accepted_by is not null and auth.uid() in (r.buyer_id, r.accepted_by)
        and not public.blocked_between(r.buyer_id, r.accepted_by))
    else exists (
      select 1 from public.shoutouts s
      where s.id = p_shoutout and p_neighbor <> s.user_id
        and (s.user_id = auth.uid() or (p_neighbor = auth.uid() and s.community_id = public.my_community()))
        and not public.blocked_between(s.user_id, p_neighbor))
  end
$$;

revoke execute on function public.blocked_between(uuid, uuid), public.refuse_blocked_match() from public, anon;
grant execute on function public.blocked_between(uuid, uuid) to authenticated, service_role;
