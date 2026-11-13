-- Let buyers cancel orders and shout-outs they haven't paid for yet (they were stuck until the 30-minute sweep).
create or replace function public.cancel_request(p_id uuid)
returns public.requests language plpgsql security definer set search_path = public as $$
declare v_request public.requests;
begin
  update public.requests set status = 'cancelled'
  where id = p_id and buyer_id = auth.uid()
    and (status in ('pending_payment', 'open') or (status = 'accepted' and deadline_at < now()))
  returning * into v_request;
  if not found then raise exception 'This request can’t be cancelled now'; end if;
  return v_request;
end $$;

create or replace function public.cancel_shoutout(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.shoutouts set status = 'cancelled' where id = p_id and user_id = auth.uid() and status in ('pending_payment', 'open');
  if not found then raise exception 'This shout-out can’t be cancelled now'; end if;
end $$;
