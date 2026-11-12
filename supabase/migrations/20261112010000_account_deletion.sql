-- Account deletion (required by the App Store). Deleting a user removes their profile, listings,
-- shout-outs, chats, ratings they hold, and payment account rows (cascades). Orders they delivered stay
-- in the buyer's history without the link to them.

alter table public.requests drop constraint requests_accepted_by_fkey;
alter table public.requests add constraint requests_accepted_by_fkey foreign key (accepted_by) references public.profiles on delete set null;
alter table public.shoutouts drop constraint shoutouts_claimed_by_fkey;
alter table public.shoutouts add constraint shoutouts_claimed_by_fkey foreign key (claimed_by) references public.profiles on delete set null;

-- Why this user can't be deleted right now (an order in progress), or null if they can.
create or replace function public.account_deletion_blocker(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.requests where buyer_id = p_user and status in ('open', 'accepted', 'arriving', 'renting', 'returning'))
      then 'Finish or cancel your current order first.'
    when exists (select 1 from public.requests where accepted_by = p_user and status in ('accepted', 'arriving', 'renting', 'returning'))
      then 'Finish your current delivery (or get your item back) first.'
  end
$$;
revoke execute on function public.account_deletion_blocker(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_blocker(uuid) to service_role;

-- App Review: Lobb's own @getlobb.com addresses (e.g. the App Store review account) can sign in with a
-- password instead of an emailed code. Only Lobb creates these accounts; it controls the domain.
insert into public.allowed_email_domains (domain) values ('getlobb.com') on conflict do nothing;
