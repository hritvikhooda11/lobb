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

// ── Delivery options ───────────────────────────────────────────────────────

export type Fulfillment = 'dropoff' | 'lobby' | 'pickup';

/** Lobby meetup is the base price; door drop-off costs more, pickup costs less (mirrors SQL fulfillment_pct). */
export const FULFILLMENT: Record<Fulfillment, { label: string; short: string; pct: number; icon: 'home' | 'people' | 'walk' }> = {
  dropoff: { label: 'Door drop-off', short: 'Drop-off', pct: 15, icon: 'home' },
  lobby: { label: 'Lobby meetup', short: 'Lobby', pct: 0, icon: 'people' },
  pickup: { label: 'Pickup', short: 'Pickup', pct: -10, icon: 'walk' },
};

export const FULFILLMENT_ORDER: Fulfillment[] = ['dropoff', 'lobby', 'pickup'];

/** Rounds to the nearest 5¢, away from zero, so -22.5 → -25 exactly like Postgres (Math.round alone would give -20). */
const round5Signed = (cents: number) => Math.sign(cents) * Math.round(Math.abs(cents) / 5) * 5;

/** Extra (or discount) in cents for a delivery option on top of a base total. */
export const fulfillmentAdjust = (baseTotal: number, f: Fulfillment) => round5Signed((baseTotal * FULFILLMENT[f].pct) / 100);

export type PriceBreakdown = {
  item: number;
  deliverer: number;
  platform: number;
  /** Delivery-option difference in cents: positive for door drop-off, negative for pickup. */
  fulfillment: number;
  total: number;
};

/** Buy price. `adjustPct` is the seller's ±5% nudge on the item price; `f` is the delivery option. */
export function priceFor(item: Item, adjustPct = 0, f: Fulfillment = 'lobby'): PriceBreakdown {
  const itemPrice = round5(item.marketPrice * (1 + clampAdjust(adjustPct) / 100));
  const deliverer = Math.max(DELIVERER_MIN, round5(itemPrice * DELIVERER_RATE));
  const base = itemPrice + deliverer + PLATFORM_FEE;
  const fulfillment = fulfillmentAdjust(base, f);
  return { item: itemPrice, deliverer, platform: PLATFORM_FEE, fulfillment, total: base + fulfillment };
}

/** What a seller receives: reimbursed for the item plus the delivery cut (and the option's difference). */
export function sellerEarnings(item: Item, adjustPct = 0, f: Fulfillment = 'lobby') {
  const p = priceFor(item, adjustPct, f);
  return p.item + p.deliverer + p.fulfillment;
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
  fulfillment: number;
  total: number;
  /** Card hold for the item's value, released when it's returned. */
  hold: number;
};

export function rentalPriceFor(item: Item, duration: RentalDuration, adjustPct = 0, f: Fulfillment = 'lobby'): RentalBreakdown {
  const rent = Math.max(100, round5(rentPerDay(item, adjustPct) * duration.dayMultiplier));
  const base = rent + PLATFORM_FEE;
  const fulfillment = fulfillmentAdjust(base, f);
  return { rent, platform: PLATFORM_FEE, fulfillment, total: base + fulfillment, hold: item.marketPrice };
}

/** Rough offline estimate by category, used when the AI price lookup is unavailable. */
export const fallbackRetailPrice: Record<Item['category'], number> = {
  snacks: 199,
  drinks: 179,
  instant: 159,
  toiletries: 399,
  electronics: 1499,
  household: 999,
  alcohol: 299,
};

// ── Seller-set prices (mirrors SQL price_within_limits) ────────────────────

/** Past this, the app warns that buyers may skip it. */
export const PRICE_WARN_PCT = 15;
/** Past this, the database refuses the price. */
export const PRICE_MAX_PCT = 50;

export type PriceCheck = { level: 'ok' | 'warn' | 'blocked'; pct: number };

/** How far a seller's price is from the Lobb (store) price. */
export function checkPrice(price: number, lobbPrice: number): PriceCheck {
  const pct = Math.round(((price - lobbPrice) / lobbPrice) * 100);
  const inLimits = price >= Math.ceil(lobbPrice * 0.5) && price <= Math.floor(lobbPrice * 1.5);
  return { pct, level: !inLimits ? 'blocked' : Math.abs(pct) > PRICE_WARN_PCT ? 'warn' : 'ok' };
}

// ── Shout-outs ─────────────────────────────────────────────────────────────

/** The poster names an all-in price; Lobb keeps its usual fee and the neighbor gets the rest. */
export const SHOUTOUT_MIN = 100;
export const SHOUTOUT_MAX = 5000;
export const shoutoutPayout = (offer: number) => offer - PLATFORM_FEE;

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
