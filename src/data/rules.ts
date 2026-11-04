/**
 * What neighbors can't sell or lend each other on Lobb, as code (not left to the AI to decide).
 * Used by the server before pricing and by the app to warn early. The database has its own
 * alcohol check too (looks_like_alcohol in the migrations).
 */
const BANNED: { reason: string; pattern: RegExp; alcohol?: true }[] = [
  {
    alcohol: true,
    reason: 'Alcohol can’t be sold between neighbors.',
    pattern: /\b(alcohol|alcoholic|beers?|wines?|vodka|whiske?y|tequila|rum|liquor|hard seltzers?|hard cider|soju|champagne|prosecco|bourbon|brandy|cognac|mezcal|ipa|lager|white ?claw|modelo|bud ?light|budweiser|coors|heineken|smirnoff|four ?loko)\b/i,
  },
  {
    reason: 'Vitamins and supplements count as health products, which Lobb doesn’t allow.',
    pattern: /\b(vitamins?|multi-?vitamins?|supplements?|melatonin|creatine|pre-?workout|probiotics?|biotin|collagen|elderberry|ashwagandha|protein powder|fish oil|electrolyte tablets?)\b/i,
  },
  {
    reason: 'Medications aren’t allowed on Lobb, even over-the-counter ones.',
    pattern: /\b(medicine|medication|ibuprofen|acetaminophen|tylenol|advil|aleve|motrin|naproxen|aspirin|nyquil|dayquil|benadryl|zyrtec|claritin|allegra|sudafed|mucinex|pepto|tums|imodium|antacid|cough syrup|pain reliever|sleep aid)\b/i,
  },
  {
    reason: 'Tobacco and nicotine products aren’t allowed on Lobb.',
    pattern: /\b(tobacco|nicotine|cigarettes?|cigars?|vapes?|vaping|e-?cig|juul|zyn|snus|hookah)\b/i,
  },
  { reason: 'Cannabis products aren’t allowed on Lobb.', pattern: /\b(cannabis|marijuana|weed|thc|cbd|delta[- ]?8|edibles?)\b/i },
  { reason: 'Weapons aren’t allowed on Lobb.', pattern: /\b(knife|knives|pepper spray|taser|stun gun|gun|ammo|ammunition)\b/i },
];

/**
 * Why this item can't be listed, or null if nothing in the name rules it out.
 * `allowAlcohol`: the admin-only Alcohol 21+ category, where the database enforces who may sell.
 */
export function bannedReason(texts: (string | null | undefined)[], { allowAlcohol = false } = {}): string | null {
  const text = texts.filter(Boolean).join(' ');
  return BANNED.find((b) => !(allowAlcohol && b.alcohol) && b.pattern.test(text))?.reason ?? null;
}
