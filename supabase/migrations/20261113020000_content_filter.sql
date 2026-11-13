-- Filters objectionable material before it's posted (App Store guideline 1.2): slurs, sexually
-- explicit text and threats are refused in chat messages, shout-outs, listings and display names.
-- Reports and blocking (previous migration) handle anything that gets past it.

create or replace function public.objectionable(p_text text)
returns boolean language sql immutable as $$
  select coalesce(p_text, '') ~* (
    -- Slurs (stems, so plurals and variants match too).
    '\m(n[i1!]gg|f[a@]gg?[o0]?t|tr[a@]nn(y|ie)|r[e3]t[a@]rd(s|ed)?\M|ch[i1]nk|sp[i1]c\M|k[i1]ke\M|w[e3]tb[a@]ck|g[o0]{2}k\M|dyke\M|c[o0]{2}n\M)'
    -- Sexually explicit.
    || '|\m(porn|nudes?\M|sexting|blowjob|handjob|dick ?pic|send (me )?(nudes|pics)|onlyfans|escort service)'
    -- Threats and self-harm encouragement.
    || '|\m(i(''| wi)ll kill you|kill yourself|kys\M|i(''| a)m going to (hurt|kill) you|shoot you)'
  )
$$;

create or replace function public.refuse_objectionable() returns trigger language plpgsql as $$
declare v_text text;
begin
  -- Separate branches: each table only has its own columns.
  if tg_table_name = 'messages' then v_text := new.body;
  elsif tg_table_name = 'shoutouts' then v_text := new.text || ' ' || coalesce(new.note, '');
  elsif tg_table_name = 'items' then v_text := new.name || ' ' || coalesce(new.size, '');
  elsif tg_table_name = 'profiles' then v_text := new.name;
  end if;
  if public.objectionable(v_text) then
    raise exception 'That has language Lobb doesn’t allow. Please keep it respectful.';
  end if;
  return new;
end $$;

create trigger messages_filter before insert on public.messages for each row execute function public.refuse_objectionable();
create trigger shoutouts_filter before insert or update of text, note on public.shoutouts for each row execute function public.refuse_objectionable();
create trigger items_filter before insert or update of name, size on public.items for each row execute function public.refuse_objectionable();
create trigger profiles_filter before insert or update of name on public.profiles for each row execute function public.refuse_objectionable();

-- Permission to send item photos to Anthropic's Claude (identify the product, read the label for
-- pricing). Asked once, before the first photo is sent (App Store guideline 5.1.2: third-party AI).
alter table public.profiles add column ai_photo_consent boolean;
grant update (ai_photo_consent) on public.profiles to authenticated;
