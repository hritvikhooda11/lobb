/**
 * POST /api/price — prices an item a seller wants to list.
 *
 * In order:
 *  1. Lobb's rules (src/data/rules.ts) rule out banned items in code, before anything else.
 *  2. Real store prices: by barcode (or an exact name match) from UPCitemdb and, when configured,
 *     today's shelf price at the nearest QFC (Kroger API). Combined by consensus() so a stray
 *     listing (wrong pack size, reseller) can't skew the price.
 *  3. Only if no store has it: Claude searches the web (needs ANTHROPIC_API_KEY).
 *  4. Last resort: a category estimate, clearly labeled, that the seller must check.
 * The app shows every store price with a link and a confidence level. Server-side so no keys ship
 * in the app. Alcohol is only priced for Lobb admins.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { categories, type CategoryId, type ItemKind } from '@/data/catalog';
import { fallbackRetailPrice } from '@/data/pricing';
import { bannedReason } from '@/data/rules';
import { consensus, krogerOffer, upcLookup, upcSearch, type Offer } from '@/lib/server/products';
import { supabaseAdmin, userIdFromRequest } from '@/lib/supabase-admin';

export type PriceRequest = { name: string; category: CategoryId; kind: ItemKind; barcode?: string; imageBase64?: string; imageUrl?: string };

export type PriceSource = { store: string; url?: string; priceCents: number; title?: string };

export type PriceResponse = {
  name: string;
  size: string;
  retailPriceCents: number;
  /** The store the Lobb price is based on, and its link. */
  source: string;
  sourceUrl?: string;
  /** Every store price found (cheapest first). */
  sources: PriceSource[];
  eligible: boolean;
  reason: string;
  estimated: boolean;
  /** high = today's local shelf price or 3+ stores agree; medium = 1–2 stores or web search; low = estimate. */
  confidence: 'high' | 'medium' | 'low';
  /** The exact product the stores list, so the seller can catch a wrong match or pack size. */
  matchedTitle?: string;
  /** Server-issued quote id; the database only creates items from a quote. */
  quoteId?: string;
};

const PriceResult = z.object({
  name: z.string().describe('Clean product name, e.g. "Coca-Cola"'),
  size: z.string().describe('Short size/variant, e.g. "12 oz can" or "3 ft"'),
  retail_price_usd: z.number().describe('Typical current US retail price for ONE unit, in dollars (the median of the stores you found)'),
  sources: z
    .array(
      z.object({
        store: z.string().describe('Store name, e.g. "Target"'),
        url: z.string().describe('Product page URL you found the price on'),
        price_usd: z.number().describe('Price for ONE unit at that store, in dollars'),
      }),
    )
    .describe('Up to 3 real US stores where you saw this exact product and its price. Empty if you found none.'),
  eligible: z.boolean().describe('Whether this item is allowed on Lobb'),
  reason: z.string().describe('One short sentence explaining eligibility or the price'),
});

const RULES = `Lobb is a marketplace where college students sell or lend everyday items to neighbors in their building.
Allowed to SELL: factory-sealed, shelf-stable, non-refrigerated packaged goods (snacks, drinks, instant food), sealed toiletries, sealed chargers/batteries/household goods.
Allowed to RENT (lend and get back): non-edible items like calculators, cables, umbrellas, irons, power strips. Never toiletries or food.
ALCOHOL: only allowed when the category is "Alcohol 21+": sealed, factory-packaged single cans/bottles of beer, hard seltzer, wine or spirits. Never anywhere else.
NEVER allowed: tobacco, vapes, cannabis, medications, vitamins or supplements, weapons, homemade or opened food, anything needing refrigeration.`;

/** Price for ONE unit: if every store lists a multipack (e.g. "12 pack") of what the seller has, the AI path is safer. */
const ONE_UNIT_HINT = 'Price ONE unit (one can, one bag, one box). If stores sell it in multipacks, divide to the single-unit price.';

const client = new Anthropic();

export async function POST(request: Request): Promise<Response> {
  let body: PriceRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const name = body.name?.trim();
  const category = categories.find((c) => c.id === body.category);
  if (!name || !category || (body.kind !== 'buy' && body.kind !== 'rent')) {
    return Response.json({ error: 'name, category and kind are required' }, { status: 400 });
  }

  if (category.ageRestricted && !(await isAdmin(request))) {
    return Response.json({ ...offlineEstimate(name, category.id), eligible: false, reason: 'Only Lobb-verified sellers can sell alcohol.' } satisfies PriceResponse);
  }

  // 1. Rules first, in code.
  const barcode = body.barcode?.replace(/\D/g, '') || null;
  const match = barcode ? await upcLookup(barcode) : await upcSearch(name);
  const banned = bannedReason([name, match?.title], { allowAlcohol: !!category.ageRestricted });
  if (banned) return withQuote(request, body, { ...offlineEstimate(name, category.id), eligible: false, reason: banned, confidence: 'low' });

  // 2. Real store prices.
  const local = await krogerOffer(barcode, name).catch(() => null);
  const offers: Offer[] = [...(local ? [local] : []), ...(match?.offers ?? [])];
  const found = consensus(offers);
  if (found) {
    const sources = found.used.map((o) => ({ store: o.store, url: o.url, priceCents: o.priceCents, title: o.title }));
    const cited = found.used[0];
    return withQuote(request, body, {
      name,
      size: '',
      retailPriceCents: Math.max(25, found.priceCents),
      source: cited.store,
      sourceUrl: cited.url,
      sources,
      eligible: true,
      reason:
        found.confidence === 'high'
          ? local
            ? `Today’s shelf price at ${local.store}.`
            : `${found.used.length} stores agree on this price.`
          : 'Only a couple of stores list this product, so double-check it.',
      estimated: false,
      confidence: found.confidence,
      matchedTitle: local?.title || match?.title,
    });
  }

  // 3. Nobody lists it: web search.
  if (!process.env.ANTHROPIC_API_KEY) return withQuote(request, body, offlineEstimate(name, category.id));

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (body.imageBase64) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.imageBase64 } });
  } else if (body.imageUrl?.startsWith('https://')) {
    content.push({ type: 'image', source: { type: 'url', url: body.imageUrl } });
  }
  const hasPhoto = !!(body.imageBase64 || body.imageUrl);
  content.push({
    type: 'text',
    text: `A seller wants to ${body.kind === 'buy' ? 'sell' : 'rent out'} this item.
Name they typed: "${name}"
Category they picked: ${category.label}
${barcode ? `Barcode (UPC/EAN): ${barcode}` : 'No barcode.'}
${match?.title ? `Product databases call it: "${match.title}"` : ''}
${hasPhoto ? 'Their photo is attached — use it to identify the exact product and check it looks sealed (for selling).' : 'No photo.'}

Search the web for this exact product's current US retail price at up to 3 stores (Target, Walmart, Amazon, CVS, Walgreens, Safeway, QFC...), then decide if it's eligible. ${ONE_UNIT_HINT}`,
  });

  try {
    const params = {
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
      output_config: { effort: 'low' as const, format: betaZodOutputFormat(PriceResult) },
      system: `You price items for a student marketplace.\n\n${RULES}`,
      tools: [{ type: 'web_search_20260209' as const, name: 'web_search' as const, max_uses: 3 }],
    };
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content }];

    let response = await client.beta.messages.parse({ ...params, messages });
    // Long web-search turns can pause; hand the partial turn back to let it finish.
    for (let i = 0; i < 3 && response.stop_reason === 'pause_turn'; i++) {
      messages.push({ role: 'assistant', content: response.content });
      response = await client.beta.messages.parse({ ...params, messages });
    }

    if (response.stop_reason === 'refusal') {
      return withQuote(request, body, { ...offlineEstimate(name, category.id), eligible: false, reason: 'This item can’t be listed on Lobb.' });
    }
    const result = response.parsed_output;
    if (!result) return withQuote(request, body, offlineEstimate(name, category.id));

    const sources: PriceSource[] = result.sources
      .filter((s) => s.price_usd > 0 && /^https:\/\//.test(s.url))
      .map((s) => ({ store: s.store, url: s.url, priceCents: Math.round(s.price_usd * 100) }))
      .sort((a, b) => a.priceCents - b.priceCents)
      .slice(0, 3);
    const retail = Math.max(25, Math.round(result.retail_price_usd * 100));
    // Cite the store closest to the price we use.
    const cited = [...sources].sort((a, b) => Math.abs(a.priceCents - retail) - Math.abs(b.priceCents - retail))[0];
    return withQuote(request, body, {
      name: result.name,
      size: result.size,
      retailPriceCents: retail,
      source: cited?.store ?? 'Web search',
      sourceUrl: cited?.url,
      sources,
      eligible: result.eligible && !bannedReason([result.name], { allowAlcohol: !!category.ageRestricted }),
      reason: bannedReason([result.name], { allowAlcohol: !!category.ageRestricted }) ?? result.reason,
      estimated: false,
      confidence: sources.length ? 'medium' : 'low',
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) console.error('[price] Invalid ANTHROPIC_API_KEY');
    else if (error instanceof Anthropic.RateLimitError) console.error('[price] Rate limited');
    else if (error instanceof Anthropic.APIError) console.error(`[price] API error ${error.status}: ${error.message}`);
    else console.error('[price]', error);
    return withQuote(request, body, offlineEstimate(name, category.id));
  }
}

/** Records the quote in the database (when Supabase is configured) so create_item() can trust the price. */
async function withQuote(request: Request, body: PriceRequest, quote: PriceResponse): Promise<Response> {
  const userId = await userIdFromRequest(request);
  if (!supabaseAdmin || !userId) return Response.json(quote);
  const { data, error } = await supabaseAdmin
    .from('price_quotes')
    .insert({
      user_id: userId,
      kind: body.kind,
      name: quote.name,
      size: quote.size,
      category: body.category,
      market_price: quote.retailPriceCents,
      eligible: quote.eligible,
      price_source: quote.source,
      price_source_url: quote.sourceUrl ?? null,
    })
    .select('id')
    .single();
  if (error) console.error('[price] could not save quote', error.message);
  return Response.json({ ...quote, quoteId: data?.id } satisfies PriceResponse);
}

function offlineEstimate(name: string, category: CategoryId): PriceResponse {
  return {
    name,
    size: '',
    retailPriceCents: fallbackRetailPrice[category],
    source: 'Lobb category estimate',
    sources: [],
    eligible: true,
    reason: 'No store lists this product, so this is only a rough category estimate. Check a store and type the real price.',
    estimated: true,
    confidence: 'low',
  };
}

async function isAdmin(request: Request) {
  const userId = await userIdFromRequest(request);
  if (!supabaseAdmin || !userId) return false;
  const { data } = await supabaseAdmin.from('profiles').select('role').eq('id', userId).maybeSingle();
  return data?.role === 'admin';
}
