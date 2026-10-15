// Runs every migration in PGlite (real Postgres in WASM) with stand-ins for Supabase's auth/storage/cron,
// then plays three students through every flow, including the attacks RLS must stop. Run: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const migration = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), 'utf8'))
  .join('\n')
  .replace('create extension if not exists pg_cron;', '-- pg_cron stubbed');
const db = new PGlite({ extensions: { pgcrypto } });

const SUPABASE_STUBS = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema extensions; create schema auth; create schema storage; create schema cron;
grant usage on schema public, auth, extensions, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text not null);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create function cron.schedule(a text, b text, c text) returns bigint language sql as $$ select 1::bigint $$;
create publication supabase_realtime;
`;

let failures = 0;
const ok = (msg) => console.log('  ✓', msg);
const bad = (msg) => {
  failures++;
  console.log('  ✗', msg);
};

async function as(userId, sql, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`);
  await db.exec('set role authenticated;');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('reset role;');
  }
}
async function expectOk(label, userId, sql, params) {
  try {
    const r = await as(userId, sql, params);
    ok(label);
    return r;
  } catch (e) {
    bad(`${label} — unexpected error: ${e.message}`);
  }
}
async function expectFail(label, userId, sql, params, pattern) {
  try {
    await as(userId, sql, params);
    bad(`${label} — expected an error`);
  } catch (e) {
    if (pattern && !pattern.test(e.message)) bad(`${label} — wrong error: ${e.message}`);
    else ok(`${label} (${e.message})`);
  }
}
const one = (r) => r?.rows?.[0];

await db.exec(SUPABASE_STUBS);
try {
  await db.exec(migration);
  ok('migration applied');
} catch (e) {
  console.log('MIGRATION FAILED:', e.message);
  process.exit(1);
}

console.log('\nSign-up gate');
try {
  await db.query(`insert into auth.users (email) values ('someone@gmail.com')`);
  bad('non-UW email allowed');
} catch (e) {
  ok(`gmail rejected (${e.message})`);
}
const ids = {};
for (const [k, email] of [['alex', 'alex@uw.edu'], ['bri', 'bri@uw.edu'], ['cam', 'cam@uw.edu']]) {
  ids[k] = one(await db.query(`insert into auth.users (email) values ($1) returning id`, [email])).id;
}
const prof = one(await db.query(`select name from public.profiles where id = $1`, [ids.alex]));
prof?.name === 'Alex' ? ok('profile auto-created as "Alex"') : bad(`profile name: ${prof?.name}`);

console.log('\nProfiles');
await expectOk('alex sets community', ids.alex, `update public.profiles set community_id = 'standard' where id = auth.uid()`);
await expectOk('bri sets community', ids.bri, `update public.profiles set community_id = 'standard' where id = auth.uid()`);
await expectOk('cam sets other community', ids.cam, `update public.profiles set community_id = 'west-campus' where id = auth.uid()`);
await expectFail('cannot edit own rating', ids.alex, `update public.profiles set rating_avg = 1 where id = auth.uid()`, [], /permission denied/);

console.log('\nBuy flow');
await expectFail('cannot insert a request directly', ids.alex, `insert into public.requests (kind, buyer_id, item_id, community_id, item_price, deliverer_fee, platform_fee, total) values ('buy', auth.uid(), 'coke-12', 'standard', 1, 1, 1, 3)`);
const req = one(await expectOk('alex requests a Coke', ids.alex, `select * from public.create_request('coke-12', 'Unit 912')`));
req?.total === 225 ? ok('server price total = $2.25 (matches app)') : bad(`total ${req?.total}`);
await expectFail('second live request blocked', ids.alex, `select public.create_request('water-16', 'x')`, [], /Finish your current/);

const seenBefore = (await as(ids.bri, `select id from public.requests where status = 'open'`)).rows.length;
seenBefore === 0 ? ok('bri (no listing) does not see it during the 20s priority window') : bad('priority window leaked');
await expectOk('bri lists Coke', ids.bri, `insert into public.listings (item_id, quantity, adjust_pct) values ('coke-12', 3, 5)`);
const seenAfter = (await as(ids.bri, `select id from public.requests where status = 'open'`)).rows.length;
seenAfter === 1 ? ok('bri (has listing) sees it immediately') : bad('listing holder cannot see request');
(await as(ids.cam, `select id from public.requests`)).rows.length === 0 ? ok('cam (other building) sees nothing') : bad('cross-community leak');
await expectFail('listing adjust capped at ±5%', ids.bri, `update public.listings set adjust_pct = 9 where item_id = 'coke-12'`, [], /check/);

await expectFail('buyer cannot accept own request', ids.alex, `select public.accept_request($1)`, [req.id], /Someone else/);
await expectFail('other building cannot accept', ids.cam, `select public.accept_request($1)`, [req.id], /Someone else/);
const acc = one(await expectOk('bri accepts', ids.bri, `select * from public.accept_request($1)`, [req.id]));
acc?.seller_payout === 205 ? ok('payout uses bri’s +5% ($2.05)') : bad(`payout ${acc?.seller_payout}`);
await expectFail('nobody can accept twice', ids.bri, `select public.accept_request($1)`, [req.id], /Finish your current|Someone else/);

(await as(ids.bri, `select * from public.handoff_codes`)).rows.length === 0 ? ok('deliverer cannot read the handoff code') : bad('code leaked to deliverer');
const code = one(await as(ids.alex, `select code from public.handoff_codes where request_id = $1`, [req.id]))?.code;
/^[A-Z2-9]{6}$/.test(code ?? '') ? ok(`buyer reads code ${code}`) : bad(`bad code ${code}`);

await expectFail('handoff before seal check blocked', ids.bri, `select public.confirm_handoff($1, $2, 'x')`, [req.id, code], /Verify|not found/i);
await expectOk('bri verifies seal', ids.bri, `select public.verify_seal($1, 'bri/seal.jpg')`, [req.id]);
await expectOk('bri marks arrived', ids.bri, `select public.mark_arrived($1)`, [req.id]);
const wrong = one(await as(ids.bri, `select public.confirm_handoff($1, 'AAAAAA', 'x') as r`, [req.id]))?.r;
wrong?.ok === false && /match/.test(wrong.error) ? ok(`wrong code rejected (${wrong.error})`) : bad(`wrong code: ${JSON.stringify(wrong)}`);
const done = one(await expectOk('right code completes handoff', ids.bri, `select public.confirm_handoff($1, $2, 'bri/handoff.jpg') as r`, [req.id, code]))?.r;
done?.status === 'delivered' ? ok('status delivered') : bad(`status ${JSON.stringify(done)}`);
const qty = one(await as(ids.bri, `select quantity from public.listings where item_id = 'coke-12'`))?.quantity;
qty === 2 ? ok('listing quantity 3 → 2') : bad(`quantity ${qty}`);
await expectOk('alex rates 4 stars', ids.alex, `select public.rate_request($1, 4)`, [req.id]);
const rating = one(await db.query(`select rating_avg, rating_count from public.profiles where id = $1`, [ids.bri]));
Number(rating?.rating_avg) === 4 && rating?.rating_count === 1 ? ok('bri rating now 4.0') : bad(`rating ${JSON.stringify(rating)}`);

console.log('\nRental flow');
await expectOk('bri lists TI-84 for rent', ids.bri, `insert into public.listings (item_id) values ('ti84')`);
const rent = one(await expectOk('alex rents TI-84 for 1 day', ids.alex, `select * from public.create_request('ti84', 'Study room', '1d')`));
rent?.deliverer_fee === 720 && rent?.hold_amount === 11999 ? ok('rent $7.20, hold $119.99 (matches app)') : bad(`rent ${rent?.deliverer_fee} hold ${rent?.hold_amount}`);
await expectFail('cam cannot lend what she doesn’t list', ids.cam, `select public.accept_request($1)`, [rent.id]);
await expectOk('bri accepts rental', ids.bri, `select public.accept_request($1)`, [rent.id]);
await expectOk('bri condition photo', ids.bri, `select public.verify_seal($1, 'bri/cond.jpg')`, [rent.id]);
const rcode = one(await as(ids.alex, `select code from public.handoff_codes where request_id = $1 and purpose = 'handoff'`, [rent.id]))?.code;
await expectOk('handoff starts rental', ids.bri, `select public.confirm_handoff($1, $2, 'p')`, [rent.id, rcode]);
const renting = one(await as(ids.alex, `select status, return_by from public.requests where id = $1`, [rent.id]));
renting?.status === 'renting' && renting?.return_by ? ok('status renting with return_by set') : bad(`rental ${renting?.status}`);
await expectOk('alex starts return', ids.alex, `select public.start_return($1)`, [rent.id]);
const retCode = one(await as(ids.alex, `select code from public.handoff_codes where request_id = $1 and purpose = 'return'`, [rent.id]))?.code;
const returned = one(await expectOk('bri scans return code', ids.bri, `select public.confirm_return($1, $2) as r`, [rent.id, retCode]))?.r;
returned?.status === 'returned' ? ok('status returned') : bad(`status ${JSON.stringify(returned)}`);

console.log('\nCode brute force');
const r3 = one(await as(ids.alex, `select * from public.create_request('water-16', 'x')`));
await as(ids.bri, `select public.accept_request($1)`, [r3.id]);
await as(ids.bri, `select public.verify_seal($1, 'x')`, [r3.id]);
for (let i = 0; i < 5; i++) await as(ids.bri, `select public.confirm_handoff($1, 'ZZZZZZ', 'x')`, [r3.id]).catch(() => {});
const c3 = one(await as(ids.alex, `select code from public.handoff_codes where request_id = $1`, [r3.id]))?.code;
const locked = one(await as(ids.bri, `select public.confirm_handoff($1, $2, 'x') as r`, [r3.id, c3]))?.r;
locked?.ok === false && /Too many/.test(locked.error) ? ok(`locked after 5 wrong tries, even with the right code (${locked.error})`) : bad(`not locked: ${JSON.stringify(locked)}`);
const still = one(await as(ids.alex, `select status from public.requests where id = $1`, [r3.id]))?.status;
still === 'accepted' ? ok('request stays undelivered') : bad(`status ${still}`);

console.log('\nNew items');
await expectFail('create_item without a quote fails', ids.bri, `select public.create_item(gen_random_uuid(), '', null, null, 0)`, [], /quote/);
const quote = one(await db.query(`insert into public.price_quotes (user_id, kind, name, category, market_price, eligible) values ($1, 'buy', 'Takis Fuego', 'snacks', 249, true) returning id`, [ids.bri]));
await expectFail('cam cannot use bri’s quote', ids.cam, `select public.create_item($1, '', null, null, 0)`, [quote.id], /quote/);
const item = one(await expectOk('bri creates item from quote', ids.bri, `select * from public.create_item($1, '4 oz', 'https://x/y.jpg', '757528004706', 3)`, [quote.id]));
item?.market_price === 249 ? ok('item price comes from the quote') : bad(`price ${item?.market_price}`);
await expectFail('quote is single-use', ids.bri, `select public.create_item($1, '', null, null, 0)`, [quote.id], /quote/);
await expectFail('price_quotes not writable by users', ids.bri, `insert into public.price_quotes (user_id, kind, name, category, market_price, eligible) values (auth.uid(), 'buy', 'x', 'snacks', 99999, true)`);
const counts = (await as(ids.alex, `select * from public.item_counts()`)).rows;
counts.some((c) => c.item_id === 'coke-12' && c.sellers === 1) ? ok('alex sees 1 neighbor selling Coke') : bad(`counts ${JSON.stringify(counts)}`);

console.log('\nRows to check');
const hasPriceFns = one(await db.query(`select (select total from public.buy_price(11999)) as a, public.rent_per_day(1500) as b`));
console.log('  buy_price(119.99).total =', hasPriceFns.a, '· rent_per_day($15) =', hasPriceFns.b);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
