-- Everyone accepts the Terms of Use once before using Lobb (also required by the App Store for apps
-- with user-generated content: listings, shout-outs, chat).

alter table public.profiles add column terms_accepted_at timestamptz;

create or replace function public.accept_terms()
returns void language sql security definer set search_path = public as $$
  update public.profiles set terms_accepted_at = now() where id = auth.uid() and terms_accepted_at is null
$$;
revoke execute on function public.accept_terms() from public, anon;
grant execute on function public.accept_terms() to authenticated;
