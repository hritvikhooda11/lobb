/** Asks the server what product a photo shows (Claude vision + product database). See /api/identify. */
import type { IdentifyResponse } from '@/app/api/identify+api';
import { supabase } from '@/lib/supabase';
import { overlap } from '@/lib/text-match';

export type Identified = Extract<IdentifyResponse, { identified: true }>;

/** Throws with a friendly message when the photo can't be identified. */
export async function identifyPhoto(imageBase64: string): Promise<Identified> {
  const { data } = await supabase.auth.getSession();
  let body: IdentifyResponse & { error?: string };
  let ok = false;
  try {
    const res = await fetch('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
      body: JSON.stringify({ imageBase64 }),
    });
    ok = res.ok;
    body = (await res.json().catch(() => ({}))) as typeof body;
  } catch {
    throw new Error('Couldn’t reach Lobb to identify the photo.');
  }
  if (!ok || !body.identified) throw new Error(body.error ?? (body.identified === false ? body.reason : 'Couldn’t identify it.'));
  return body;
}

const digits = (s: string) => s.replace(/\D/g, '').replace(/^0+/, '');

/**
 * Is the identified product the item that was ordered? 'yes' (barcode or name matches), 'no' (clearly
 * something else), or 'unsure'.
 */
export function matchesItem(found: Identified, item: { name: string; barcode?: string }): 'yes' | 'no' | 'unsure' {
  if (found.barcode && item.barcode) return digits(found.barcode) === digits(item.barcode) ? 'yes' : 'no';
  const score = Math.max(overlap(item.name, found.name), overlap(found.name, item.name));
  if (score >= 0.6) return 'yes';
  if (score === 0 && found.confidence !== 'low') return 'no';
  return 'unsure';
}
