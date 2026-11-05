/**
 * SERVER ONLY. Real product data and store prices.
 *
 *  - UPCitemdb (upcitemdb.com): product names, photos and recent prices at many US retailers,
 *    by barcode or by name. Works with no key on the free trial (100 lookups/day). Set
 *    UPCITEMDB_KEY for a paid plan. Knows store brands like Target's Good & Gather and up&up.
 *  - Kroger Products API (developer.kroger.com, free): today's shelf price at the QFC closest to
 *    campus (QFC is a Kroger store). Needs KROGER_CLIENT_ID and KROGER_CLIENT_SECRET.
 *
 * Prices are combined by `consensus()`, which drops stale offers and outliers (wrong pack sizes,
 * marketplace sellers), so one bad listing can't swing the Lobb price.
 */
import { overlap } from '@/lib/text-match';

export { overlap };

export type Offer = { store: string; priceCents: number; url?: string; title?: string; updatedAt?: number; source: 'kroger' | 'upcitemdb' | 'web' };
export type ProductMatch = { title: string; brand: string; upc: string | null; imageUrl: string | null; category: string; offers: Offer[] };

const DAY = 86_400_000;
const cache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ── UPCitemdb ───────────────────────────────────────────────────────────────

type UpcItem = {
  title?: string;
  brand?: string;
  upc?: string;
  ean?: string;
  category?: string;
  images?: string[];
  offers?: { merchant?: string; price?: number; link?: string; title?: string; updated_t?: number }[];
};

// Marketplaces and resellers whose prices aren't a normal store price.
const SKIP_MERCHANTS = /ebay|rakuten|buy\.com|newegg marketplace|bonanza|wish|alibaba|aliexpress/i;

async function upcitemdb(path: string): Promise<UpcItem[]> {
  const key = process.env.UPCITEMDB_KEY;
  const base = key ? 'https://api.upcitemdb.com/prod/v1' : 'https://api.upcitemdb.com/prod/trial';
  try {
    const res = await fetch(`${base}/${path}`, {
      headers: { Accept: 'application/json', ...(key ? { user_key: key, key_type: '3scale' } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      if (res.status === 429) console.warn('[products] UPCitemdb daily limit reached');
      return [];
    }
    const body = (await res.json()) as { code?: string; items?: UpcItem[] };
    return body.code === 'OK' ? (body.items ?? []) : [];
  } catch {
    return [];
  }
}

function toMatch(item: UpcItem): ProductMatch {
  const fresh = Date.now() - 3 * 365 * DAY;
  return {
    title: item.title?.trim() ?? '',
    brand: item.brand?.trim() ?? '',
    upc: item.upc ?? item.ean ?? null,
    imageUrl: item.images?.find((u) => u.startsWith('https://')) ?? null,
    category: item.category ?? '',
    offers: (item.offers ?? [])
      .filter((o) => o.price && o.price > 0 && o.merchant && !SKIP_MERCHANTS.test(o.merchant) && (o.updated_t ?? 0) * 1000 > fresh)
      .map((o) => ({ store: o.merchant!, priceCents: Math.round(o.price! * 100), url: o.link, title: o.title, updatedAt: (o.updated_t ?? 0) * 1000, source: 'upcitemdb' as const })),
  };
}

export function upcLookup(barcode: string) {
  return cached(`upc:${barcode}`, DAY, async () => {
    const [item] = await upcitemdb(`lookup?upc=${encodeURIComponent(barcode)}`);
    return item?.title ? toMatch(item) : null;
  });
}

/** Best product for a name, only if it really matches (most of the words). */
export function upcSearch(query: string) {
  return cached(`upcs:${query.toLowerCase()}`, DAY, async () => {
    const items = await upcitemdb(`search?s=${encodeURIComponent(query)}&match_mode=0&type=product`);
    const best = items.map((i) => ({ i, score: overlap(query, `${i.brand ?? ''} ${i.title ?? ''}`) })).sort((a, b) => b.score - a.score)[0];
    return best && best.score >= 0.75 ? toMatch(best.i) : null;
  });
}

// ── Kroger / QFC ────────────────────────────────────────────────────────────

const KROGER = 'https://api.kroger.com/v1';
let krogerToken: { value: string; expires: number } | null = null;

async function krogerAuth() {
  const id = process.env.KROGER_CLIENT_ID;
  const secret = process.env.KROGER_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (krogerToken && krogerToken.expires > Date.now() + 60_000) return krogerToken.value;
  const res = await fetch(`${KROGER}/connect/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${id}:${secret}`)}` },
    body: 'grant_type=client_credentials&scope=product.compact',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    console.error('[products] Kroger auth failed', res.status);
    return null;
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  krogerToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return krogerToken.value;
}

async function kroger<T>(path: string): Promise<T | null> {
  const token = await krogerAuth();
  if (!token) return null;
  try {
    const res = await fetch(`${KROGER}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The QFC (or other Kroger store) nearest the campus ZIP. */
function krogerStore() {
  return cached('kroger:store', 7 * DAY, async () => {
    const zip = process.env.KROGER_ZIP ?? '98105';
    const body = await kroger<{ data?: { locationId: string; name: string }[] }>(`/locations?filter.zipCode.near=${zip}&filter.limit=1`);
    return body?.data?.[0] ?? null;
  });
}

type KrogerProduct = { upc?: string; description?: string; brand?: string; items?: { size?: string; price?: { regular?: number; promo?: number } }[] };

/** Kroger product ids are 13-digit UPCs without the check digit (some stores use the full code). */
const krogerIds = (barcode: string) => {
  const d = barcode.replace(/\D/g, '');
  return [...new Set([d.slice(0, -1).padStart(13, '0'), d.padStart(13, '0')])];
};

export async function krogerOffer(barcode: string | null, name: string): Promise<Offer | null> {
  const store = await krogerStore();
  if (!store) return null;
  return cached(`kroger:${barcode ?? name.toLowerCase()}`, DAY / 2, async () => {
    let product: KrogerProduct | undefined;
    if (barcode) {
      for (const id of krogerIds(barcode)) {
        const body = await kroger<{ data?: KrogerProduct[] }>(`/products?filter.productId=${id}&filter.locationId=${store.locationId}`);
        product = body?.data?.[0];
        if (product) break;
      }
    } else {
      const body = await kroger<{ data?: KrogerProduct[] }>(`/products?filter.term=${encodeURIComponent(name.slice(0, 60))}&filter.locationId=${store.locationId}&filter.limit=5`);
      product = body?.data?.find((p) => overlap(name, `${p.brand ?? ''} ${p.description ?? ''}`) >= 0.75);
    }
    const price = product?.items?.[0]?.price;
    // The regular shelf price, not a temporary sale.
    const dollars = price?.regular || price?.promo;
    if (!product || !dollars) return null;
    return { store: store.name || 'QFC', priceCents: Math.round(dollars * 100), title: `${product.brand ?? ''} ${product.description ?? ''} ${product.items?.[0]?.size ?? ''}`.trim(), updatedAt: Date.now(), source: 'kroger' as const };
  });
}

// ── Combining prices ────────────────────────────────────────────────────────

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export type Consensus = { priceCents: number; used: Offer[]; confidence: 'high' | 'medium' };

/**
 * One price from many offers. Today's local QFC price wins when we have it; otherwise the median of
 * offers that agree with each other (within −40%/+70% of the median, which drops other pack sizes
 * and resellers). High confidence = a local shelf price, or 3+ stores that agree.
 */
export function consensus(offers: Offer[]): Consensus | null {
  if (!offers.length) return null;
  const local = offers.find((o) => o.source === 'kroger');
  const m = median(offers.map((o) => o.priceCents));
  const agree = offers.filter((o) => o.priceCents >= m * 0.6 && o.priceCents <= m * 1.7);
  const used = (agree.length ? agree : offers).sort((a, b) => a.priceCents - b.priceCents);
  if (local) return { priceCents: local.priceCents, used: [local, ...used.filter((o) => o !== local)].slice(0, 4), confidence: 'high' };
  return { priceCents: median(used.map((o) => o.priceCents)), used: used.slice(0, 4), confidence: used.length >= 3 ? 'high' : 'medium' };
}
