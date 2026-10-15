/**
 * Lobb assigns every price. Sellers may nudge their own listing within ±5%
 * (founder decision, 2026-10-14 — replaces "users cannot set prices").
 * All amounts are integer cents. The fee model is a placeholder until the
 * business model is decided (PRODUCT_CONTEXT §11) — keep every pricing rule in this file.
 */
import type { Item } from './catalog';

const DELIVERER_MIN = 75;
const DELIVERER_RATE = 0.2;
const PLATFORM_FEE = 25;

export const MAX_ADJUST_PCT = 5;

const round5 = (cents: number) => Math.round(cents / 5) * 5;
export const clampAdjust = (pct: number) => Math.max(-MAX_ADJUST_PCT, Math.min(MAX_ADJUST_PCT, Math.round(pct)));

export type PriceBreakdown = {
  item: number;
  deliverer: number;
  platform: number;
  total: number;
};

/** Buy price. `adjustPct` is the seller's ±5% nudge on the item price. */
export function priceFor(item: Item, adjustPct = 0): PriceBreakdown {
  const itemPrice = round5(item.marketPrice * (1 + clampAdjust(adjustPct) / 100));
  const deliverer = Math.max(DELIVERER_MIN, round5(itemPrice * DELIVERER_RATE));
  return { item: itemPrice, deliverer, platform: PLATFORM_FEE, total: itemPrice + deliverer + PLATFORM_FEE };
}

/** What a seller receives: reimbursed for the item plus the delivery cut. */
export function sellerEarnings(item: Item, adjustPct = 0) {
  const p = priceFor(item, adjustPct);
  return p.item + p.deliverer;
}

// ── Rentals ────────────────────────────────────────────────────────────────

export type RentalDuration = { id: string; label: string; hours: number; dayMultiplier: number };

export const rentalDurations: RentalDuration[] = [
  { id: '3h', label: '3 hours', hours: 3, dayMultiplier: 0.5 },
  { id: '1d', label: '1 day', hours: 24, dayMultiplier: 1 },
  { id: '3d', label: '3 days', hours: 72, dayMultiplier: 2.5 },
];

/** Daily rate: ~6% of retail, at least $1. */
export function rentPerDay(item: Item, adjustPct = 0) {
  return Math.max(100, round5(item.marketPrice * 0.06 * (1 + clampAdjust(adjustPct) / 100)));
}

export type RentalBreakdown = {
  rent: number;
  platform: number;
  total: number;
  /** Card hold for the item's value, released when it's returned. */
  hold: number;
};

export function rentalPriceFor(item: Item, duration: RentalDuration, adjustPct = 0): RentalBreakdown {
  const rent = Math.max(100, round5(rentPerDay(item, adjustPct) * duration.dayMultiplier));
  return { rent, platform: PLATFORM_FEE, total: rent + PLATFORM_FEE, hold: item.marketPrice };
}

/** Rough offline estimate by category, used when the AI price lookup is unavailable. */
export const fallbackRetailPrice: Record<Item['category'], number> = {
  snacks: 199,
  drinks: 179,
  instant: 159,
  toiletries: 399,
  electronics: 1499,
  household: 999,
};

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
