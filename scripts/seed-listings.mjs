// Demo helper: stocks a seller account with the catalog so the store looks full.
// For the demo it also makes that seller a Lobb admin (the only people who can sell alcohol) and
// turns on the 21+ section in their building. Don't run this against a real launch database.
// Usage: node --env-file=.env scripts/seed-listings.mjs [seller-email]
import { createClient } from '@supabase/supabase-js';

const email = process.argv[2] ?? 'hritvikhooda11+seller@gmail.com';
const db = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const items = [
  'coke-12', 'redbull-8', 'water-16', 'celsius', 'hot-cheetos', 'oreos', 'kind-bar', 'goldfish',
  'cup-noodles', 'shin-ramyun', 'mac-cup', 'toothpaste', 'deodorant', 'lightning', 'tissues', 'aa-batteries',
  'ti84', 'hdmi', 'power-strip', 'umbrella',
  'white-claw', 'modelo', 'smirnoff-ice',
];

const { data: users, error: e1 } = await db.auth.admin.listUsers({ perPage: 200 });
if (e1) throw e1;
const seller = users.users.find((u) => u.email === email);
if (!seller) throw new Error(`No user ${email} — sign in once with that email first.`);

const { data: profile, error: e2 } = await db.from('profiles').update({ role: 'admin' }).eq('id', seller.id).select('community_id').single();
if (e2) throw e2;
if (profile.community_id) {
  const { error: e3 } = await db.from('communities').update({ alcohol_enabled: true }).eq('id', profile.community_id);
  if (e3) throw e3;
}

const { error } = await db.from('listings').upsert(
  items.map((item_id) => ({ seller_id: seller.id, item_id, quantity: 3, adjust_pct: 0, active: true })),
  { onConflict: 'seller_id,item_id' },
);
if (error) throw error;
console.log(`Stocked ${items.length} items for ${email} (admin; 21+ section on in ${profile.community_id})`);
