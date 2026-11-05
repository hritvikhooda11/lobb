/**
 * GET /api/barcode?code=049000050103 — looks up a scanned product.
 *
 * Checks the free Open Food Facts family of databases (food, then beauty, then general
 * products), then UPCitemdb, which also covers store brands (Target's Good & Gather and up&up,
 * Kirkland…) that Open Food Facts often misses. Returns a clean name, size, photo and a
 * best-guess Lobb category. Runs server-side so the app makes one request.
 */
import type { CategoryId } from '@/data/catalog';
import { upcLookup } from '@/lib/server/products';

export type BarcodeResponse =
  | { found: false; barcode: string }
  | { found: true; barcode: string; name: string; size: string; imageUrl: string | null; category: CategoryId | null; source: string };

const SOURCES = [
  { host: 'world.openfoodfacts.org', label: 'Open Food Facts', fallback: null },
  { host: 'world.openbeautyfacts.org', label: 'Open Beauty Facts', fallback: 'toiletries' },
  { host: 'world.openproductsfacts.org', label: 'Open Products Facts', fallback: null },
] as const;

const FIELDS = 'product_name,product_name_en,brands,quantity,image_front_url,categories_tags';

type OffProduct = {
  product_name?: string;
  product_name_en?: string;
  brands?: string;
  quantity?: string;
  image_front_url?: string;
  categories_tags?: string[];
};

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('code') ?? '';
  const barcode = raw.replace(/\D/g, '');
  if (barcode.length < 8 || barcode.length > 14) {
    return Response.json({ error: 'Barcodes are 8–14 digits' }, { status: 400 });
  }

  for (const source of SOURCES) {
    const product = await fetchProduct(source.host, barcode);
    const name = product?.product_name_en?.trim() || product?.product_name?.trim();
    if (!product || !name) continue;
    return Response.json({
      found: true,
      barcode,
      name: withBrand(name, product.brands),
      size: cleanSize(product.quantity),
      imageUrl: product.image_front_url ?? null,
      category: guessCategory(product.categories_tags ?? []) ?? source.fallback,
      source: source.label,
    } satisfies BarcodeResponse);
  }

  const upc = await upcLookup(barcode);
  if (upc?.title) {
    return Response.json({
      found: true,
      barcode,
      name: withBrand(cleanTitle(upc.title), upc.brand),
      size: sizeFromTitle(upc.title),
      imageUrl: upc.imageUrl,
      category: categoryFromPath(upc.category),
      source: 'UPCitemdb',
    } satisfies BarcodeResponse);
  }
  return Response.json({ found: false, barcode } satisfies BarcodeResponse);
}

/** "Zen Party Trail Mix - 21oz - Good & Gather™" → "Zen Party Trail Mix" */
function cleanTitle(title: string) {
  return title.replace(/[™®]/g, '').split(/\s+-\s+/)[0].replace(/,\s*\d.*$/, '').trim();
}

/** Pulls "21oz" / "12 fl oz" / "4 ct" out of a retailer title. */
function sizeFromTitle(title: string) {
  return /(\d+(?:\.\d+)?\s?(?:fl\.? ?oz|oz|ct|count|pk|pack|ml|l|g|lb|in|ft))\b/i.exec(title)?.[1] ?? '';
}

/** UPCitemdb categories look like "Food, Beverages & Tobacco > Beverages > Soda". */
function categoryFromPath(path: string): CategoryId | null {
  const p = path.toLowerCase();
  if (/beverage|drink|soda|water|juice|coffee|tea\b/.test(p)) return 'drinks';
  if (/noodle|soup|pasta|meal/.test(p)) return 'snacks';
  if (/snack|candy|chip|cookie|cracker|nut|chocolate|food/.test(p)) return 'snacks';
  if (/personal care|health & beauty|oral|deodorant|soap|shampoo|cosmetic/.test(p)) return 'toiletries';
  if (/electronic|cable|charger|batter|computer|phone/.test(p)) return 'electronics';
  if (/household|home|kitchen|cleaning|paper/.test(p)) return 'household';
  return null;
}

async function fetchProduct(host: string, barcode: string): Promise<OffProduct | null> {
  try {
    const res = await fetch(`https://${host}/api/v2/product/${barcode}.json?fields=${FIELDS}`, {
      headers: { 'User-Agent': 'LobbApp/0.1' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: number; product?: OffProduct };
    return data.status === 1 && data.product ? data.product : null;
  } catch {
    return null;
  }
}

const CORPORATE = /\b(gmbh|inc|llc|ltd|co|corp|company|foods?|america)\b\.?/gi;
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Flamin' Hot Crunchy" + "Cheetos" → "Cheetos Flamin' Hot Crunchy". Skips the brand when the name already has it. */
function withBrand(name: string, brands?: string) {
  const title = titleCase(name);
  const brand = titleCase(brands?.split(',')[0]?.replace(CORPORATE, '').replace(/\s+/g, ' ').trim() ?? '');
  if (!brand || squash(title).includes(squash(brand))) return title;
  return `${brand} ${title}`;
}

/** Fixes ALL-CAPS database entries: "NONGSHIM SHIN RAMYUN" → "Nongshim Shin Ramyun". */
function titleCase(s: string) {
  if (s !== s.toUpperCase()) return s.trim();
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();
}

/** "8.5 oz (240.9 g)" → "8.5 oz" */
function cleanSize(quantity?: string) {
  return quantity?.replace(/\s*\(.*\)\s*/, '').trim() ?? '';
}

const CATEGORY_TAGS: Record<string, CategoryId> = Object.fromEntries(
  (
    [
      ['drinks', ['beverages', 'carbonated-drinks', 'sodas', 'colas', 'waters', 'spring-waters', 'energy-drinks', 'juices', 'teas', 'iced-teas', 'coffees', 'sports-drinks']],
      ['snacks', ['instant-noodles', 'instant-noodle-soups', 'noodles', 'instant-pasta', 'dehydrated-soups', 'dried-meals', 'pasta-dishes', 'macaroni-and-cheese']],
      ['snacks', ['snacks', 'sweet-snacks', 'salty-snacks', 'biscuits', 'cookies', 'crackers', 'chips-and-fries', 'crisps', 'candies', 'confectioneries', 'chocolates', 'cereal-bars', 'nuts', 'popcorn']],
      ['toiletries', ['toothpastes', 'deodorants', 'shampoos', 'soaps', 'body-hygiene', 'oral-care']],
      ['electronics', ['batteries', 'cables', 'chargers', 'electronics']],
      ['household', ['tissues', 'paper-towels', 'cleaning-products', 'household']],
    ] as [CategoryId, string[]][]
  ).flatMap(([category, tags]) => tags.map((t) => [t, category])),
);

/** Tags run general → specific, so the most specific match wins. */
function guessCategory(tags: string[]): CategoryId | null {
  for (const tag of [...tags].reverse()) {
    const match = CATEGORY_TAGS[tag.replace(/^[a-z]{2}:/, '')];
    if (match) return match;
  }
  return null;
}
