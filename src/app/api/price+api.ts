/**
 * POST /api/price — prices an item a seller wants to list.
 *
 * Claude searches the web for the current US retail price, looks at the seller's photo,
 * and checks the item against Lobb's rules (sealed / shelf-stable food only, nothing
 * age-restricted). Runs server-side so ANTHROPIC_API_KEY never ships in the app.
 * Without a key, returns an offline category estimate so the app still works in dev.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { categories, type CategoryId, type ItemKind } from '@/data/catalog';
import { fallbackRetailPrice } from '@/data/pricing';
import { supabaseAdmin, userIdFromRequest } from '@/lib/supabase-admin';

export type PriceRequest = { name: string; category: CategoryId; kind: ItemKind; barcode?: string; imageBase64?: string; imageUrl?: string };

export type PriceResponse = {
  name: string;
  size: string;
  retailPriceCents: number;
  source: string;
  eligible: boolean;
  reason: string;
  estimated: boolean;
  /** Server-issued quote id; the database only creates items from a quote. */
  quoteId?: string;
};

const PriceResult = z.object({
  name: z.string().describe('Clean product name, e.g. "Coca-Cola"'),
  size: z.string().describe('Short size/variant, e.g. "12 oz can" or "3 ft"'),
  retail_price_usd: z.number().describe('Typical current US retail price for ONE unit, in dollars'),
  source: z.string().describe('Where the price came from, e.g. "Target.com"'),
  eligible: z.boolean().describe('Whether this item is allowed on Lobb'),
  reason: z.string().describe('One short sentence explaining eligibility or the price'),
});

const RULES = `Lobb is a marketplace where college students sell or lend everyday items to neighbors in their building.
Allowed to SELL: factory-sealed, shelf-stable, non-refrigerated packaged goods (snacks, drinks, instant food), sealed toiletries, sealed chargers/batteries/household goods.
Allowed to RENT (lend and get back): non-edible items like calculators, cables, umbrellas, irons, power strips. Never toiletries or food.
NEVER allowed: alcohol, tobacco, vapes, cannabis, medications or supplements, weapons, anything age-restricted, homemade or opened food, anything needing refrigeration.`;

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
${body.barcode ? `Barcode (UPC/EAN): ${body.barcode}` : 'No barcode.'}
${hasPhoto ? 'Their photo is attached — use it to identify the exact product and check it looks sealed (for selling).' : 'No photo.'}

Search the web for the typical current US retail price of one unit, then decide if it's eligible.`,
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

    return withQuote(request, body, {
      name: result.name,
      size: result.size,
      retailPriceCents: Math.max(25, Math.round(result.retail_price_usd * 100)),
      source: result.source,
      eligible: result.eligible,
      reason: result.reason,
      estimated: false,
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
    .insert({ user_id: userId, kind: body.kind, name: quote.name, size: quote.size, category: body.category, market_price: quote.retailPriceCents, eligible: quote.eligible })
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
    source: 'Lobb estimate',
    eligible: true,
    reason: 'Live price lookup is offline, so this is a category estimate.',
    estimated: true,
  };
}
