-- Settles payments on a schedule, so money never gets stuck when the app's own call fails.
-- Until now /api/pay/settle only ran when a phone asked it to: a dropped handoff request left the
-- buyer's card on hold and the neighbor unpaid, and a seller who set up payouts after a sale
-- waited for someone else's order to trigger it. Every few minutes the database now calls it itself.
create extension if not exists pg_net;

-- Private settings (the API origin and the cron secret), kept out of the repo and out of the API.
-- No grants: only the owner and security-definer functions can read it, never anon or authenticated.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.config (key text primary key, value text not null);
revoke all on private.config from public, anon, authenticated;

-- Fires the settle endpoint. Returns silently when the config isn't set yet, so a fresh database
-- (or the test harness) doesn't error every few minutes.
create or replace function private.settle_payments()
returns void language plpgsql security definer set search_path = private, public as $$
declare v_origin text; v_secret text; v_schema text;
begin
  select value into v_origin from private.config where key = 'api_origin';
  select value into v_secret from private.config where key = 'cron_secret';
  if v_origin is null or v_secret is null then return; end if;
  -- pg_net lives in "net" on some projects and "extensions" on others, so find it rather than guess.
  select n.nspname into v_schema
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post' limit 1;
  if v_schema is null then
    raise warning 'settle_payments: pg_net is not installed';
    return;
  end if;
  execute format('select %I.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 20000)', v_schema)
    using v_origin || '/api/pay/settle',
          jsonb_build_object('Content-Type', 'application/json', 'x-lobb-cron-secret', v_secret),
          '{}'::jsonb;
end $$;

revoke all on function private.settle_payments() from public, anon, authenticated;

-- Every 5 minutes: captures handed-over orders, releases cancelled holds and pays neighbors out.
-- The endpoint only acts on what payments_to_settle() reports, so extra runs are harmless.
select cron.schedule('settle-payments', '*/5 * * * *', $$select private.settle_payments()$$);
