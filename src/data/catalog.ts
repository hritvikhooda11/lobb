/**
 * Item catalog. In production this lives in the database and is keyed by UPC barcode.
 *
 * Two kinds of items:
 *  - `buy`:  factory-sealed, shelf-stable, non-TCS goods (PRODUCT_CONTEXT §8).
 *  - `rent`: non-edible items (chargers, calculators, umbrellas…) borrowed and returned.
 * No alcohol, tobacco, vapes, cannabis, medications, or age-restricted items.
 *
 * Photos live in assets/items (credits in assets/items/CREDITS.md).
 */
import type { ImageSourcePropType } from 'react-native';

import type { categoryTint } from '@/theme';

export type CategoryId = keyof typeof categoryTint;
export type ItemKind = 'buy' | 'rent';

export type Category = { id: CategoryId; label: string; emoji: string; edible: boolean };

export const categories: Category[] = [
  { id: 'snacks', label: 'Snacks', emoji: '🍿', edible: true },
  { id: 'drinks', label: 'Drinks', emoji: '🥤', edible: true },
  { id: 'instant', label: 'Instant food', emoji: '🍜', edible: true },
  { id: 'toiletries', label: 'Toiletries', emoji: '🧴', edible: false },
  { id: 'electronics', label: 'Tech', emoji: '🔌', edible: false },
  { id: 'household', label: 'Household', emoji: '🧻', edible: false },
];

export const getCategory = (id: CategoryId) => categories.find((c) => c.id === id)!;

/** Rentals: anything non-edible except toiletries (hygiene). */
export const canRent = (category: CategoryId) => !getCategory(category).edible && category !== 'toiletries';

export type Item = {
  id: string;
  kind: ItemKind;
  barcode?: string;
  name: string;
  size: string;
  category: CategoryId;
  emoji: string;
  image?: ImageSourcePropType;
  /** Retail market price in cents (looked up from retail sources in production). */
  marketPrice: number;
  /** How many neighbors in your community have this listed right now (mock). */
  nearbyCount: number;
  /** Set when a user added this item themselves. */
  addedByMe?: boolean;
};

export const catalog: Item[] = [
  // Buy: sealed goods
  { id: 'coke-12', kind: 'buy', barcode: '10603499', name: 'Coca-Cola', size: '12 oz can', category: 'drinks', emoji: '🥤', image: require('@/assets/items/coke.jpg'), marketPrice: 125, nearbyCount: 6 },
  { id: 'redbull-8', kind: 'buy', barcode: '9002490100070', name: 'Red Bull', size: '8.4 oz can', category: 'drinks', emoji: '⚡️', image: require('@/assets/items/redbull.jpg'), marketPrice: 299, nearbyCount: 3 },
  { id: 'water-16', kind: 'buy', barcode: '075720481279', name: 'Poland Spring water', size: '16.9 oz', category: 'drinks', emoji: '💧', image: require('@/assets/items/water.jpg'), marketPrice: 100, nearbyCount: 9 },
  { id: 'celsius', kind: 'buy', barcode: '889392000917', name: 'Celsius', size: '12 oz can', category: 'drinks', emoji: '🫧', image: require('@/assets/items/celsius.jpg'), marketPrice: 279, nearbyCount: 2 },
  { id: 'hot-cheetos', kind: 'buy', barcode: '028400589895', name: 'Flamin’ Hot Cheetos', size: '2.5 oz bag', category: 'snacks', emoji: '🌶️', image: require('@/assets/items/cheetos.jpg'), marketPrice: 229, nearbyCount: 4 },
  { id: 'oreos', kind: 'buy', barcode: '044000047009', name: 'Oreo snack pack', size: '6 cookies', category: 'snacks', emoji: '🍪', image: require('@/assets/items/oreo.jpg'), marketPrice: 179, nearbyCount: 2 },
  { id: 'kind-bar', kind: 'buy', barcode: '602652431142', name: 'KIND bar', size: '1.4 oz', category: 'snacks', emoji: '🥜', image: require('@/assets/items/kind.jpg'), marketPrice: 199, nearbyCount: 5 },
  { id: 'goldfish', kind: 'buy', barcode: '014100048145', name: 'Goldfish', size: '1.5 oz bag', category: 'snacks', emoji: '🐟', image: require('@/assets/items/goldfish.jpg'), marketPrice: 129, nearbyCount: 3 },
  { id: 'cup-noodles', kind: 'buy', barcode: '070662030035', name: 'Cup Noodles', size: 'Chicken', category: 'instant', emoji: '🍜', image: require('@/assets/items/cupnoodles.jpg'), marketPrice: 109, nearbyCount: 7 },
  { id: 'shin-ramyun', kind: 'buy', barcode: '031146022861', name: 'Shin Ramyun', size: '4.2 oz pack', category: 'instant', emoji: '🔥', image: require('@/assets/items/shin.jpg'), marketPrice: 189, nearbyCount: 4 },
  { id: 'mac-cup', kind: 'buy', barcode: '021000053834', name: 'Easy Mac cup', size: '2.05 oz', category: 'instant', emoji: '🧀', image: require('@/assets/items/easymac.jpg'), marketPrice: 159, nearbyCount: 2 },
  { id: 'toothpaste', kind: 'buy', name: 'Colgate toothpaste', size: 'Travel size', category: 'toiletries', emoji: '🪥', image: require('@/assets/items/toothpaste.jpg'), marketPrice: 149, nearbyCount: 3 },
  { id: 'deodorant', kind: 'buy', name: 'Dove deodorant', size: 'Travel size', category: 'toiletries', emoji: '🧴', image: require('@/assets/items/deodorant.jpg'), marketPrice: 199, nearbyCount: 1 },
  { id: 'lightning', kind: 'buy', name: 'Lightning cable', size: '3 ft, sealed', category: 'electronics', emoji: '🔋', image: require('@/assets/items/lightning.jpg'), marketPrice: 999, nearbyCount: 1 },
  { id: 'tissues', kind: 'buy', name: 'Tissues', size: 'Box', category: 'household', emoji: '🤧', image: require('@/assets/items/tissues.jpg'), marketPrice: 199, nearbyCount: 4 },
  { id: 'aa-batteries', kind: 'buy', name: 'AA batteries', size: '4-pack, sealed', category: 'household', emoji: '🪫', image: require('@/assets/items/aa.jpg'), marketPrice: 549, nearbyCount: 1 },

  // Rent: borrow and return
  { id: 'ti84', kind: 'rent', name: 'TI-84 Plus calculator', size: 'Graphing', category: 'electronics', emoji: '🧮', image: require('@/assets/items/ti84.jpg'), marketPrice: 11999, nearbyCount: 3 },
  { id: 'hdmi', kind: 'rent', name: 'HDMI cable', size: '6 ft', category: 'electronics', emoji: '📺', image: require('@/assets/items/hdmi.jpg'), marketPrice: 1099, nearbyCount: 4 },
  { id: 'power-strip', kind: 'rent', name: 'Power strip', size: '6 outlets', category: 'electronics', emoji: '🔌', image: require('@/assets/items/powerstrip.jpg'), marketPrice: 1999, nearbyCount: 2 },
  { id: 'umbrella', kind: 'rent', name: 'Umbrella', size: 'Full size', category: 'household', emoji: '☂️', image: require('@/assets/items/umbrella.jpg'), marketPrice: 1500, nearbyCount: 5 },
  { id: 'iron', kind: 'rent', name: 'Steam iron', size: 'Clothes iron', category: 'household', emoji: '👔', image: require('@/assets/items/iron.jpg'), marketPrice: 2999, nearbyCount: 2 },
];

export type Community = { id: string; name: string; type: 'dorm' | 'high-rise' | 'apartment'; members: number };

export const communities: Community[] = [
  { id: 'standard', name: 'The Standard', type: 'high-rise', members: 412 },
  { id: 'west-campus', name: 'West Campus Dorms', type: 'dorm', members: 1260 },
  { id: 'north-campus', name: 'North Campus Dorms', type: 'dorm', members: 980 },
  { id: 'm-housing', name: 'M Housing', type: 'apartment', members: 230 },
];

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

/**
 * Finds an existing item that matches a name a seller typed, so we don't create duplicates.
 * Matches when every word the seller typed appears in an item name (or vice versa).
 */
export function findDuplicate(items: Item[], name: string, kind: ItemKind): Item | undefined {
  const typed = normalize(name);
  if (typed.length === 0) return undefined;
  return items.find((item) => {
    if (item.kind !== kind) return false;
    const words = normalize(item.name);
    const typedInItem = typed.every((t) => words.some((w) => w.startsWith(t) || t.startsWith(w)));
    const itemInTyped = words.every((w) => typed.some((t) => t.startsWith(w) || w.startsWith(t)));
    return typedInItem || itemInTyped;
  });
}

const stripZeros = (code: string) => code.replace(/^0+/, '');

/** Exact barcode match (UPC-A and EAN-13 differ only by a leading zero). */
export function findByBarcode(items: Item[], barcode: string, kind: ItemKind): Item | undefined {
  const target = stripZeros(barcode);
  return items.find((i) => i.kind === kind && i.barcode && stripZeros(i.barcode) === target);
}
