/**
 * Sets up "Maple Hall" (id lobb-review), a building only Apple's App Review account lives in, so the reviewer
 * sees a working store instead of an empty one. Real students never see it: it isn't offered at
 * sign-up, and the store only shows items stocked in your own building.
 *
 * A demo seller (Lobb staff, @getlobb.com) lists real products priced live by /api/price, with
 * Lobb's licensed product photos. Re-runnable.
 * Usage: node --env-file=.env scripts/setup-review-building.cjs
 */
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_KEY;
const API = process.env.LOBB_ORIGIN ?? 'https://lobb.expo.app';
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PRODUCTS = [
  { name: 'Coca-Cola 12 oz can', category: 'drinks', kind: 'buy', size: '12 oz can', photo: 'coke.jpg' },
  { name: 'Red Bull 8.4 oz can', category: 'drinks', kind: 'buy', size: '8.4 oz can', photo: 'redbull.jpg' },
  { name: 'Flamin Hot Cheetos 2.5 oz', category: 'snacks', kind: 'buy', size: '2.5 oz bag', photo: 'cheetos.jpg' },
  { name: 'Cup Noodles Chicken', category: 'snacks', kind: 'buy', size: '2.25 oz cup', photo: 'cupnoodles.jpg' },
  { name: 'Goldfish crackers 1.5 oz', category: 'snacks', kind: 'buy', size: '1.5 oz bag', photo: 'goldfish.jpg' },
  { name: 'Colgate toothpaste travel size', category: 'toiletries', kind: 'buy', size: 'Travel size', photo: 'toothpaste.jpg' },
  { name: 'Umbrella', category: 'household', kind: 'rent', size: 'Full size', photo: 'umbrella.jpg' },
  { name: 'TI-84 Plus graphing calculator', category: 'electronics', kind: 'rent', size: 'Graphing', photo: 'ti84.jpg' },
];

async function account(email, name, room) {
  const password = 'Lobb-' + crypto.randomBytes(8).toString('hex');
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let user = list.users.find((u) => u.email === email);
  if (user) await admin.auth.admin.updateUserById(user.id, { password });
  else user = (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user;
  const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
  const s = await sb.auth.signInWithPassword({ email, password });
  if (s.error) throw new Error(`${email}: ${s.error.message}`);
  const h = await sb.rpc('set_home', { p_community: 'lobb-review', p_room: room });
  if (h.error) throw new Error(`set_home: ${h.error.message}`);
  await admin.from('profiles').update({ name }).eq('id', user.id);
  return { id: user.id, sb, token: s.data.session.access_token, password };
}

(async () => {
  const { error: ce } = await admin.from('communities').upsert({ id: 'lobb-review', name: 'Maple Hall', type: 'apartment', alcohol_enabled: false });
  if (ce) throw new Error('community: ' + ce.message);
  console.log('✓ building "Lobb Review House"');

  const seller = await account('demo-seller@getlobb.com', 'Maya', '3C');
  await admin.from('profiles').update({ terms_accepted_at: new Date().toISOString() }).eq('id', seller.id);
  console.log('✓ demo seller Maya (room 3C)');

  // The reviewer account moves into the review building (keeps its saved password).
  const kv = Object.fromEntries(fs.readFileSync('.review-account', 'utf8').trim().split('\n').map((l) => l.split('=')));
  const reviewer = createClient(URL_, ANON, { auth: { persistSession: false } });
  const rs = await reviewer.auth.signInWithPassword({ email: kv.email, password: kv.password });
  if (rs.error) throw new Error('reviewer sign-in: ' + rs.error.message);
  const rh = await reviewer.rpc('set_home', { p_community: 'lobb-review', p_room: '1201' });
  if (rh.error) throw new Error('reviewer set_home: ' + rh.error.message);
  console.log('✓ App Review account lives in Lobb Review House (room 1201)');

  // Remove old demo listings/items so re-runs don't pile up.
  const { data: oldItems } = await admin.from('items').select('id').eq('created_by', seller.id);
  if (oldItems?.length) {
    await admin.from('listings').delete().eq('seller_id', seller.id);
    await admin.from('items').delete().in('id', oldItems.map((i) => i.id));
  }

  for (const p of PRODUCTS) {
    const file = fs.readFileSync(path.join(__dirname, '..', 'assets', 'items', p.photo));
    const objectPath = `${seller.id}/demo-${p.photo}`;
    await admin.storage.from('item-photos').upload(objectPath, file, { contentType: 'image/jpeg', upsert: true });
    const imageUrl = admin.storage.from('item-photos').getPublicUrl(objectPath).data.publicUrl;

    const res = await fetch(`${API}/api/price`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${seller.token}` },
      body: JSON.stringify({ name: p.name, category: p.category, kind: p.kind }),
    });
    const quote = await res.json();
    if (!quote.quoteId) {
      console.log(`✗ ${p.name}: ${JSON.stringify(quote).slice(0, 160)}`);
      continue;
    }
    const it = await seller.sb.rpc('create_item', { p_quote_id: quote.quoteId, p_size: p.size, p_image_url: imageUrl, p_barcode: null, p_adjust_pct: 0, p_price: null, p_photo_url: null });
    if (it.error) {
      console.log(`✗ ${p.name}: ${it.error.message}`);
      continue;
    }
    await seller.sb.from('listings').update({ quantity: 5 }).eq('item_id', it.data.id);
    console.log(`✓ ${p.name.padEnd(32)} store $${(quote.retailPriceCents / 100).toFixed(2)} · ${quote.confidence} · ${quote.sources?.[0]?.store ?? quote.priceSource ?? 'estimate'}`);
  }
  console.log('Done. Reviewer sign-in is unchanged (.review-account).');
})().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
