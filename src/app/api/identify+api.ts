/**
 * POST /api/identify — "What is this?" from a photo, for when the barcode won't scan.
 *
 * Claude looks at the seller's photo and reads the product: brand, name, size, and the barcode
 * digits if they're visible. We then look that up in UPCitemdb to get the real product (barcode,
 * catalog photo), so pricing can use real store prices. The app always asks the seller to confirm
 * ("Is this it?") before using it. Needs ANTHROPIC_API_KEY.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import type { CategoryId } from '@/data/catalog';
import { bannedReason } from '@/data/rules';
import { upcLookup, upcSearch } from '@/lib/server/products';

export type IdentifyResponse =
  | { identified: false; reason: string }
  | {
      identified: true;
      name: string;
      size: string;
      category: CategoryId | null;
      barcode: string | null;
      /** Catalog photo of the matched product, when we found it in a product database. */
      imageUrl: string | null;
      confidence: 'high' | 'medium' | 'low';
      /** Set when the item isn't allowed on Lobb. */
      notAllowed: string | null;
    };

const Result = z.object({
  identified: z.boolean().describe('False if the photo does not clearly show one retail product'),
  brand: z.string().describe('Brand on the package, e.g. "Vitafusion" or "Good & Gather". Empty if unknown.'),
  name: z.string().describe('Product name without the brand, e.g. "Women’s Multivitamin Gummies"'),
  size: z.string().describe('Size or count printed on the package, e.g. "12 fl oz", "150 ct". Empty if not visible.'),
  category: z.enum(['snacks', 'drinks', 'instant', 'toiletries', 'electronics', 'household', 'other']),
  barcode_digits: z.string().describe('The UPC/EAN digits if they are readable in the photo, else empty'),
  confidence: z.enum(['high', 'medium', 'low']).describe('How sure you are of the exact product (brand + variant + size)'),
});

const client = new Anthropic();

export async function POST(request: Request): Promise<Response> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'Photo identify needs ANTHROPIC_API_KEY on the server. Type the name instead for now.' }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { imageBase64?: string } | null;
  if (!body?.imageBase64 || body.imageBase64.length < 1000) return Response.json({ error: 'Send a photo' }, { status: 400 });

  try {
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 2000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(Result) },
      system: 'You identify packaged retail products from phone photos for a student marketplace. Read the brand, product and size exactly as printed. Never guess a brand you cannot see.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: body.imageBase64 } },
            { type: 'text', text: 'What exact product is this?' },
          ],
        },
      ],
    });
    const r = response.parsed_output;
    if (!r || !r.identified || !r.name.trim()) {
      return Response.json({ identified: false, reason: 'Couldn’t tell what this is. Try a clearer photo of the front label, or type it in.' } satisfies IdentifyResponse);
    }

    const label = [r.brand, r.name].filter(Boolean).join(' ').trim();
    const digits = r.barcode_digits.replace(/\D/g, '');
    // Prefer the barcode if the AI could read it; otherwise search by what's printed on the front.
    const match = (digits.length >= 8 ? await upcLookup(digits) : null) ?? (await upcSearch([label, r.size].filter(Boolean).join(' ')));
    return Response.json({
      identified: true,
      name: label,
      size: r.size,
      category: r.category === 'other' ? null : r.category,
      barcode: match?.upc ?? (digits.length >= 8 ? digits : null),
      imageUrl: match?.imageUrl ?? null,
      confidence: match ? r.confidence : r.confidence === 'high' ? 'medium' : r.confidence,
      notAllowed: bannedReason([label, match?.title]),
    } satisfies IdentifyResponse);
  } catch (error) {
    console.error('[identify]', error);
    return Response.json({ error: 'Couldn’t identify the photo right now. Type the name instead.' }, { status: 502 });
  }
}
