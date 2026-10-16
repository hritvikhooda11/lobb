// Demo helper: stocks a seller account with ~16 catalog items so the store looks full.
// Usage: node --env-file=.env scripts/seed-listings.mjs [seller-email]
import { createClient } from '@supabase/supabase-js';

const email = process.argv[2] ?? 'hritvikhooda11+seller@gmail.com';
const db = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const items = [
  'coke-12', 'redbull-8', 'water-16', 'celsius', 'hot-cheetos', 'oreos', 'kind-bar', 'goldfish',
  'cup-noodles', 'shin-ramyun', 'mac-cup', 'toothpaste', 'deodorant', 'lightning', 'tissues', 'aa-batteries',
  'ti84', 'hdmi', 'power-strip', 'umbrella',
];

const { data: users, error: e1 } = await db.auth.admin.listUsers({ perPage: 200 });
if (e1) throw e1;
const seller = users.users.find((u) => u.email === email);
if (!seller) throw new Error(`No user ${email} — sign in once with that email first.`);

const { error } = await db.from('listings').upsert(
  items.map((item_id) => ({ seller_id: seller.id, item_id, quantity: 3, adjust_pct: 0, active: true })),
  { onConflict: 'seller_id,item_id' },
);
if (error) throw error;
console.log(`Stocked ${items.length} items for ${email}`);
