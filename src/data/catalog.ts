/**
 * Item catalog. In production this lives in the database and is keyed by UPC barcode.
 * Only factory-sealed, shelf-stable, non-TCS items are eligible (see PRODUCT_CONTEXT §8).
 * No alcohol, tobacco, vapes, cannabis, medications, or age-restricted items.
 */
import type { categoryTint } from '@/theme';

export type CategoryId = keyof typeof categoryTint;

export type Category = { id: CategoryId; label: string; emoji: string };

export const categories: Category[] = [
  { id: 'snacks', label: 'Snacks', emoji: '🍿' },
  { id: 'drinks', label: 'Drinks', emoji: '🥤' },
  { id: 'instant', label: 'Instant food', emoji: '🍜' },
  { id: 'toiletries', label: 'Toiletries', emoji: '🧴' },
  { id: 'electronics', label: 'Chargers', emoji: '🔌' },
  { id: 'household', label: 'Household', emoji: '🧻' },
];

export type Item = {
  id: string;
  barcode: string;
  name: string;
  size: string;
  category: CategoryId;
  emoji: string;
  /** Retail market price in cents (looked up from retail sources in production). */
  marketPrice: number;
  /** How many neighbors in your community have this listed right now (mock). */
  nearbyCount: number;
};

export const catalog: Item[] = [
  { id: 'coke-12', barcode: '049000028911', name: 'Coca-Cola', size: '12 oz can', category: 'drinks', emoji: '🥤', marketPrice: 125, nearbyCount: 6 },
  { id: 'redbull-8', barcode: '611269991000', name: 'Red Bull', size: '8.4 oz can', category: 'drinks', emoji: '⚡️', marketPrice: 299, nearbyCount: 3 },
  { id: 'water-16', barcode: '012000161155', name: 'Water bottle', size: '16.9 oz', category: 'drinks', emoji: '💧', marketPrice: 100, nearbyCount: 9 },
  { id: 'celsius', barcode: '889392000429', name: 'Celsius', size: '12 oz can', category: 'drinks', emoji: '🫧', marketPrice: 279, nearbyCount: 2 },
  { id: 'hot-cheetos', barcode: '028400314053', name: 'Flamin’ Hot Cheetos', size: '2.5 oz bag', category: 'snacks', emoji: '🌶️', marketPrice: 229, nearbyCount: 4 },
  { id: 'oreos', barcode: '044000032029', name: 'Oreo snack pack', size: '6 cookies', category: 'snacks', emoji: '🍪', marketPrice: 179, nearbyCount: 2 },
  { id: 'kind-bar', barcode: '602652171000', name: 'KIND bar', size: '1.4 oz', category: 'snacks', emoji: '🥜', marketPrice: 199, nearbyCount: 5 },
  { id: 'goldfish', barcode: '014100085478', name: 'Goldfish', size: '1.5 oz bag', category: 'snacks', emoji: '🐟', marketPrice: 129, nearbyCount: 3 },
  { id: 'cup-noodles', barcode: '070662030011', name: 'Cup Noodles', size: 'Chicken', category: 'instant', emoji: '🍜', marketPrice: 109, nearbyCount: 7 },
  { id: 'shin-ramyun', barcode: '031146150605', name: 'Shin Ramyun', size: '4.2 oz pack', category: 'instant', emoji: '🔥', marketPrice: 189, nearbyCount: 4 },
  { id: 'mac-cup', barcode: '021000012916', name: 'Easy Mac cup', size: '2.05 oz', category: 'instant', emoji: '🧀', marketPrice: 159, nearbyCount: 2 },
  { id: 'toothpaste', barcode: '035000521019', name: 'Travel toothpaste', size: '0.85 oz', category: 'toiletries', emoji: '🪥', marketPrice: 149, nearbyCount: 3 },
  { id: 'deodorant', barcode: '012044001356', name: 'Deodorant', size: 'Travel size', category: 'toiletries', emoji: '🧴', marketPrice: 199, nearbyCount: 1 },
  { id: 'usbc-cable', barcode: '848061041573', name: 'USB-C cable', size: '3 ft, sealed', category: 'electronics', emoji: '🔌', marketPrice: 899, nearbyCount: 2 },
  { id: 'lightning', barcode: '190199532608', name: 'Lightning cable', size: '3 ft, sealed', category: 'electronics', emoji: '🔋', marketPrice: 999, nearbyCount: 1 },
  { id: 'tissues', barcode: '036000123456', name: 'Tissues', size: 'Pocket pack', category: 'household', emoji: '🤧', marketPrice: 99, nearbyCount: 4 },
  { id: 'aa-batteries', barcode: '041333424019', name: 'AA batteries', size: '4-pack, sealed', category: 'household', emoji: '🪫', marketPrice: 549, nearbyCount: 1 },
];

export const getItem = (id: string) => catalog.find((i) => i.id === id);

export type Community = { id: string; name: string; type: 'dorm' | 'high-rise' | 'apartment'; members: number };

export const communities: Community[] = [
  { id: 'standard', name: 'The Standard', type: 'high-rise', members: 412 },
  { id: 'west-campus', name: 'West Campus Dorms', type: 'dorm', members: 1260 },
  { id: 'north-campus', name: 'North Campus Dorms', type: 'dorm', members: 980 },
  { id: 'm-housing', name: 'M Housing', type: 'apartment', members: 230 },
];
