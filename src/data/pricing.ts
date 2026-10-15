/**
 * Platform-assigned pricing. Users never set prices (PRODUCT_CONTEXT §8.4).
 * All amounts are integer cents. The fee model is a placeholder until the
 * business model is decided (§11) — keep every pricing rule in this file.
 */
import type { Item } from './catalog';

const DELIVERER_MIN = 75; // cents
const DELIVERER_RATE = 0.2;
const PLATFORM_FEE = 25;

export type PriceBreakdown = {
  item: number;
  deliverer: number;
  platform: number;
  total: number;
};

export function priceFor(item: Item): PriceBreakdown {
  const deliverer = Math.max(DELIVERER_MIN, Math.round((item.marketPrice * DELIVERER_RATE) / 5) * 5);
  const total = item.marketPrice + deliverer + PLATFORM_FEE;
  return { item: item.marketPrice, deliverer, platform: PLATFORM_FEE, total };
}

/** What a seller receives: they're reimbursed for the item plus the delivery cut. */
export function sellerEarnings(item: Item) {
  const p = priceFor(item);
  return p.item + p.deliverer;
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
