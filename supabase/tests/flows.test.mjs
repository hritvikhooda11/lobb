// Runs every migration in PGlite (real Postgres in WASM) with stand-ins for Supabase's auth/storage/cron,
// then plays four students through every flow, including the attacks RLS must stop. Run: npm run test:db
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
-- Mirrors "Automatically expose new tables" = OFF: no default table grants; the migration must grant.
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
for (const [k, email] of [['alex', 'alex@uw.edu'], ['bri', 'bri@uw.edu'], ['cam', 'cam@uw.edu'], ['dan', 'dan@uw.edu'], ['eve', 'eve@uw.edu']]) {
  ids[k] = one(await db.query(`insert into auth.users (email) values ($1) returning id`, [email])).id;
}
const prof = one(await db.query(`select name from public.profiles where id = $1`, [ids.alex]));
prof?.name === 'Alex' ? ok('profile auto-created as "Alex"') : bad(`profile name: ${prof?.name}`);

console.log('\nProfiles and rooms');
await expectOk('alex sets building + room', ids.alex, `select public.set_home('standard', '912')`);
await expectOk('bri sets building + room', ids.bri, `select public.set_home('standard', '407')`);
await expectOk('dan sets building + room', ids.dan, `select public.set_home('standard', '204')`);
await expectOk('cam sets other building', ids.cam, `select public.set_home('west-campus', '15b')`);
await expectFail('room number is required', ids.alex, `select public.set_home('standard', '  ')`, [], /room number/);
await expectFail('unknown building rejected', ids.alex, `select public.set_home('nowhere', '1')`, [], /building/);
const myRoom = one(await as(ids.alex, `select room from public.home_details`))?.room;
myRoom === '912' ? ok('alex can read her own room') : bad(`room ${myRoom}`);
(await as(ids.alex, `select * from public.home_details`)).rows.length === 1 ? ok('alex sees only her own room row') : bad('rooms leaked to a neighbor');
one(await as(ids.cam, `select room from public.home_details`))?.room === '15B' ? ok('rooms are stored upper-case (15B)') : bad('room case');
await expectFail('cannot edit own rating', ids.alex, `update public.profiles set rating_avg = 1 where id = auth.uid()`, [], /permission denied/);
await expectFail('cannot read price quotes', ids.alex, `select * from public.price_quotes`, [], /permission denied/);
await expectFail('cannot read the email allowlist', ids.alex, `select * from public.allowed_email_domains`, [], /permission denied/);
await expectFail('cannot delete requests', ids.alex, `delete from public.requests`, [], /permission denied/);

console.log('\nBuy flow');
await expectFail('cannot request an item nobody lists', ids.alex, `select public.create_request('coke-12', '')`, [], /Nobody nearby/);
await expectOk('dan lists Coke (5)', ids.dan, `insert into public.listings (item_id, quantity) values ('coke-12', 5)`);
await expectOk('dan lists water (3)', ids.dan, `insert into public.listings (item_id, quantity) values ('water-16', 3)`);
await expectFail('cam (other building) still can’t request Coke', ids.cam, `select public.create_request('coke-12', '')`, [], /Nobody nearby/);
await expectFail('cannot insert a request directly', ids.alex, `insert into public.requests (kind, buyer_id, item_id, community_id, item_price, deliverer_fee, platform_fee, total) values ('buy', auth.uid(), 'coke-12', 'standard', 1, 1, 1, 3)`);
const req = one(await expectOk('alex requests a Coke (lobby meetup)', ids.alex, `select * from public.create_request('coke-12', '', null, 'lobby')`));
req?.total === 225 && req?.fulfillment === 'lobby' && req?.fulfillment_adjust === 0 ? ok('lobby = base price $2.25 (matches app)') : bad(`total ${req?.total} ${req?.fulfillment}`);
(await as(ids.alex, `select * from public.request_private where request_id = $1`, [req.id])).rows.length === 0 ? ok('lobby meetup stores no room') : bad('room stored for lobby');
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
(await as(ids.dan, `select * from public.item_counts()`)).rows.some((c) => c.item_id === 'ti84') ? bad('TI-84 still offered while it is on loan') : ok('TI-84 disappears for neighbors while on loan');
const renting = one(await as(ids.alex, `select status, return_by from public.requests where id = $1`, [rent.id]));
renting?.status === 'renting' && renting?.return_by ? ok('status renting with return_by set') : bad(`rental ${renting?.status}`);
await expectOk('alex starts return', ids.alex, `select public.start_return($1)`, [rent.id]);
const retCode = one(await as(ids.alex, `select code from public.handoff_codes where request_id = $1 and purpose = 'return'`, [rent.id]))?.code;
const returned = one(await expectOk('bri scans return code', ids.bri, `select public.confirm_return($1, $2) as r`, [rent.id, retCode]))?.r;
returned?.status === 'returned' ? ok('status returned') : bad(`status ${JSON.stringify(returned)}`);
(await as(ids.dan, `select * from public.item_counts()`)).rows.some((c) => c.item_id === 'ti84' && c.sellers === 1) ? ok('TI-84 is available again after it’s returned') : bad('TI-84 not restored');

console.log('\nDelivery options and price differences');
const door = one(await expectOk('alex requests Coke for door drop-off', ids.alex, `select * from public.create_request('coke-12', 'knock twice', null, 'dropoff')`));
door?.total === 260 && door?.fulfillment_adjust === 35 ? ok('door drop-off +15% = $2.60 (+$0.35)') : bad(`door total ${door?.total} adjust ${door?.fulfillment_adjust}`);
one(await as(ids.alex, `select buyer_room from public.request_private where request_id = $1`, [door.id]))?.buyer_room === '912' ? ok('buyer’s room is saved for the drop-off') : bad('buyer room missing');
(await as(ids.bri, `select * from public.request_private where request_id = $1`, [door.id])).rows.length === 0 ? ok('neighbors can’t see the room before accepting') : bad('room leaked before accept');
await expectOk('bri accepts the drop-off', ids.bri, `select public.accept_request($1)`, [door.id]);
one(await as(ids.bri, `select buyer_room from public.request_private where request_id = $1`, [door.id]))?.buyer_room === '912' ? ok('deliverer sees the room after accepting') : bad('deliverer cannot see room');
(await as(ids.dan, `select * from public.request_private where request_id = $1`, [door.id])).rows.length === 0 ? ok('other neighbors still can’t see it') : bad('room leaked to a bystander');
one(await db.query(`select seller_payout from public.requests where id = $1`, [door.id]))?.seller_payout === 240 ? ok('drop-off pays the seller more ($2.40)') : bad('drop-off payout');
await db.exec(`update public.requests set status = 'cancelled' where id = '${door.id}'`);

const pick = one(await expectOk('alex requests Coke for pickup', ids.alex, `select * from public.create_request('coke-12', '', null, 'pickup')`));
pick?.total === 200 && pick?.fulfillment_adjust === -25 ? ok('pickup −10% = $2.00 (−$0.25)') : bad(`pickup total ${pick?.total} adjust ${pick?.fulfillment_adjust}`);
await expectOk('bri accepts the pickup', ids.bri, `select public.accept_request($1)`, [pick.id]);
one(await as(ids.alex, `select seller_room from public.request_private where request_id = $1`, [pick.id]))?.seller_room === '407' ? ok('buyer is told which room to go to (407)') : bad('seller room missing');
one(await db.query(`select seller_payout from public.requests where id = $1`, [pick.id]))?.seller_payout === 180 ? ok('pickup pays the seller less ($1.80)') : bad('pickup payout');
await db.exec(`update public.requests set status = 'cancelled' where id = '${pick.id}'`);

const rentDoor = one(await expectOk('alex rents TI-84 with door drop-off', ids.alex, `select * from public.create_request('ti84', '', '3h', 'dropoff')`));
rentDoor?.total === 445 ? ok('rental door drop-off: ($3.60 + $0.25) +15% = $4.45') : bad(`rental door total ${rentDoor?.total}`);
await db.exec(`update public.requests set status = 'cancelled' where id = '${rentDoor.id}'`);
await expectOk('eve joins The Standard but skips the room (old account)', ids.eve, `update public.profiles set community_id = 'standard' where id = auth.uid()`);
await expectFail('door drop-off needs a room number', ids.eve, `select public.create_request('coke-12', '', null, 'dropoff')`, [], /room number/);
await expectOk('lobby meetup works without a room', ids.eve, `select public.create_request('coke-12', '', null, 'lobby')`);
await db.exec(`update public.requests set status = 'cancelled' where buyer_id = '${ids.eve}'`);
await expectFail('unknown option rejected', ids.alex, `select public.create_request('coke-12', '', null, 'teleport')`, [], /how you want/);

console.log('\nSold-out items disappear');
await expectOk('dan lists Celsius (just 1)', ids.dan, `insert into public.listings (item_id, quantity) values ('celsius', 1)`);
(await as(ids.alex, `select * from public.item_counts()`)).rows.some((c) => c.item_id === 'celsius' && c.sellers === 1) ? ok('Celsius shows 1 nearby') : bad('celsius not counted');
const cel = one(await as(ids.alex, `select * from public.create_request('celsius', '', null, 'lobby')`));
await as(ids.dan, `select public.accept_request($1)`, [cel.id]);
await as(ids.dan, `select public.verify_seal($1, 'dan/s.jpg')`, [cel.id]);
const celCode = one(await as(ids.alex, `select code from public.handoff_codes where request_id = $1`, [cel.id]))?.code;
await as(ids.dan, `select public.confirm_handoff($1, $2, 'dan/h.jpg')`, [cel.id, celCode]);
(await as(ids.alex, `select * from public.item_counts()`)).rows.some((c) => c.item_id === 'celsius') ? bad('sold-out Celsius still listed') : ok('Celsius is gone from the store after the sale');
await expectFail('can’t request a sold-out item', ids.alex, `select public.create_request('celsius', '', null, 'lobby')`, [], /Nobody nearby/);
await expectOk('dan can restock', ids.dan, `update public.listings set quantity = 2 where item_id = 'celsius'`);
(await as(ids.alex, `select * from public.item_counts()`)).rows.some((c) => c.item_id === 'celsius') ? ok('restocked Celsius is back') : bad('restock not reflected');

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
counts.some((c) => c.item_id === 'coke-12' && c.sellers === 2) ? ok('alex sees 2 neighbors selling Coke') : bad(`counts ${JSON.stringify(counts)}`);

console.log('\nSeller-set prices');
const q2 = async () => one(await db.query(`insert into public.price_quotes (user_id, kind, name, category, market_price, eligible, price_source, price_source_url) values ($1, 'buy', 'Hi-Chew', 'snacks', 200, true, 'Target', 'https://target.com/x') returning id`, [ids.bri])).id;
const priced = one(await expectOk('bri lists at $2.60 (+30%, a warning in the app)', ids.bri, `select * from public.create_item($1, '', null, null, 0, 260)`, [await q2()]));
priced?.market_price === 260 && priced?.lobb_price === 200 && priced?.price_source === 'Target' ? ok('item keeps her price, the Lobb price and the source') : bad(`priced ${JSON.stringify(priced)}`);
await expectFail('a crazy price is blocked (+150%)', ids.bri, `select public.create_item($1, '', null, null, 0, 500)`, [await q2()], /too far/);
await expectFail('a giveaway price is blocked (−60%)', ids.bri, `select public.create_item($1, '', null, null, 0, 80)`, [await q2()], /too far/);

console.log('\nAlcohol');
await db.exec(`update public.requests set status = 'cancelled' where status in ('open', 'accepted', 'arriving')`);
await db.exec(`update public.profiles set role = 'admin' where id = '${ids.dan}'`);
await expectFail('users cannot make themselves admin', ids.bri, `update public.profiles set role = 'admin' where id = auth.uid()`, [], /permission denied/);
await expectFail('a regular seller cannot list alcohol', ids.bri, `insert into public.listings (item_id, quantity) values ('modelo', 2)`, [], /row-level security/);
const aq = one(await db.query(`insert into public.price_quotes (user_id, kind, name, category, market_price, eligible) values ($1, 'buy', 'Coors Light', 'alcohol', 199, true) returning id`, [ids.bri]));
await expectFail('a regular seller cannot create an alcohol item', ids.bri, `select public.create_item($1, '', null, null, 0)`, [aq.id], /Lobb-verified/);
await expectOk('an admin can list alcohol', ids.dan, `insert into public.listings (item_id, quantity) values ('modelo', 6)`);
await expectFail('alcohol is off until the building is cleared', ids.alex, `select public.create_request('modelo', '', null, 'lobby')`, [], /isn’t available/);
await db.exec(`update public.communities set alcohol_enabled = true where id = 'standard'`);
await expectFail('buyer must confirm age first', ids.alex, `select public.create_request('modelo', '', null, 'lobby')`, [], /date of birth/);
await expectFail('a fake birthdate is rejected', ids.alex, `select public.set_birthdate('2020-01-01')`, [], /real date/);
await expectOk('eve (20) saves her birthdate', ids.eve, `select public.set_birthdate((current_date - interval '20 years')::date)`);
await expectFail('under 21 cannot buy', ids.eve, `select public.create_request('modelo', '', null, 'lobby')`, [], /21 or older/);
await expectFail('birthdate cannot be changed later', ids.eve, `select public.set_birthdate('1990-01-01')`, [], /already saved/);
await expectOk('alex (25) saves her birthdate', ids.alex, `select public.set_birthdate((current_date - interval '25 years')::date)`);
const beer = one(await expectOk('alex (25) can order', ids.alex, `select * from public.create_request('modelo', '', null, 'lobby')`));
await db.exec(`update public.requests set created_at = now() - interval '1 minute' where id = '${beer.id}'`);
await expectFail('a regular neighbor cannot deliver alcohol', ids.bri, `select public.accept_request($1)`, [beer.id], /Lobb-verified/);
await expectOk('the admin accepts', ids.dan, `select public.accept_request($1)`, [beer.id]);
await as(ids.dan, `select public.verify_seal($1, 'dan/s.jpg')`, [beer.id]);
const beerCode = one(await as(ids.alex, `select code from public.handoff_codes where request_id = $1`, [beer.id]))?.code;
await expectFail('handoff needs an ID check', ids.dan, `select public.confirm_handoff($1, $2, 'dan/h.jpg')`, [beer.id, beerCode], /Check their ID/);
const beerDone = one(await expectOk('handoff with ID checked', ids.dan, `select public.confirm_handoff($1, $2, 'dan/h.jpg', true) as r`, [beer.id, beerCode]))?.r;
const stamped = one(await db.query(`select id_checked_at from public.requests where id = $1`, [beer.id]));
beerDone?.ok && stamped?.id_checked_at ? ok('ID check is recorded on the request') : bad('id check not stamped');

console.log('\nShout-outs');
await expectFail('banned things can’t be shouted for', ids.alex, `select public.create_shoutout('cheap vodka', 'buy', 'drinks', 500)`, [], /can’t be requested/);
await expectFail('food can’t be borrowed', ids.alex, `select public.create_shoutout('ramen', 'rent', 'instant', 300)`, [], /non-food/);
await expectFail('offer must be $1–$50', ids.alex, `select public.create_shoutout('plunger', 'rent', 'household', 9000)`, [], /between/);
const so = one(await expectOk('alex shouts for a plunger (borrow, $3, door)', ids.alex, `select * from public.create_shoutout('Plunger', 'rent', 'household', 300, 'dropoff', 'urgent!!')`));
(await as(ids.bri, `select id from public.shoutouts where status = 'open'`)).rows.length === 1 ? ok('bri (same building) sees it') : bad('bri cannot see shout-out');
(await as(ids.cam, `select id from public.shoutouts`)).rows.length === 0 ? ok('cam (other building) does not') : bad('shout-out leaked across buildings');
await expectFail('can’t claim your own', ids.alex, `select public.claim_shoutout($1)`, [so.id], /your own/);
await expectFail('cam can’t claim from another building', ids.cam, `select public.claim_shoutout($1)`, [so.id], /Someone else/);
const claim = one(await expectOk('bri says “I have one”', ids.bri, `select * from public.claim_shoutout($1)`, [so.id]));
claim?.status === 'accepted' && claim?.total === 300 && claim?.seller_payout === 275 && claim?.rental_hours === 24 ? ok('it becomes an accepted 1-day loan: alex pays $3, bri gets $2.75') : bad(`claim ${JSON.stringify(claim)}`);
await expectFail('nobody else can claim it now', ids.dan, `select public.claim_shoutout($1)`, [so.id], /Someone else|Finish/);
one(await as(ids.bri, `select buyer_room from public.request_private where request_id = $1`, [claim.id]))?.buyer_room === '912' ? ok('bri gets alex’s room for the drop-off') : bad('room missing on shout-out');
const special = one(await db.query(`select special from public.items i join public.requests r on r.item_id = i.id where r.id = $1`, [claim.id]));
special?.special ? ok('the one-off item is hidden from the store') : bad('special flag missing');
const specialId = one(await db.query(`select item_id from public.requests where id = $1`, [claim.id])).item_id;
await expectFail('nobody can order the one-off item', ids.dan, `select public.create_request($1, '')`, [specialId], /not found/);
await as(ids.bri, `select public.verify_seal($1, 'bri/c.jpg')`, [claim.id]);
const soCode = one(await as(ids.alex, `select code from public.handoff_codes where request_id = $1`, [claim.id]))?.code;
const soDone = one(await expectOk('the normal handoff works', ids.bri, `select public.confirm_handoff($1, $2, 'bri/h.jpg') as r`, [claim.id, soCode]))?.r;
soDone?.status === 'renting' ? ok('plunger is on loan (renting)') : bad(`status ${JSON.stringify(soDone)}`);
const so2 = one(await as(ids.dan, `select * from public.create_shoutout('Phone tripod', 'rent', 'electronics', 200)`));
await expectOk('dan cancels his own shout-out', ids.dan, `select public.cancel_shoutout($1)`, [so2.id]);
await expectFail('alex can’t cancel dan’s', ids.alex, `select public.cancel_shoutout($1)`, [so2.id], /can’t be cancelled/);
await expectFail('users can’t write shout-outs directly', ids.alex, `insert into public.shoutouts (user_id, community_id, text, kind, category, offer) values (auth.uid(), 'standard', 'x y', 'buy', 'snacks', 100)`, [], /permission denied/);

console.log('\nRows to check');
const hasPriceFns = one(await db.query(`select (select total from public.buy_price(11999)) as a, public.rent_per_day(1500) as b`));
console.log('  buy_price(119.99).total =', hasPriceFns.a, '· rent_per_day($15) =', hasPriceFns.b);

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
