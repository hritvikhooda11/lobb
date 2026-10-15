/**
 * App state backed by Supabase (schema: supabase/migrations).
 *
 * Reads go through row-level security; every write that matters (requests, accepts,
 * handoffs, new items) goes through a database function so the app can't cheat.
 * Request changes stream in over Realtime, with a 10s poll as a safety net (it also
 * picks up requests that leave the listed-seller priority window).
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { bundledItem, type CategoryId, type Item, type ItemKind } from '@/data/catalog';
import { sellerEarnings, type PriceBreakdown } from '@/data/pricing';
import { friendlyError, publicPhotoUrl, supabase, uploadPhoto } from '@/lib/supabase';

export const DELIVERY_WINDOW_MS = 10 * 60 * 1000;

export type RequestStatus = 'open' | 'accepted' | 'arriving' | 'delivered' | 'renting' | 'returning' | 'returned' | 'expired' | 'cancelled';

export const LIVE_STATUSES: RequestStatus[] = ['open', 'accepted', 'arriving', 'renting', 'returning'];

export type Person = { name: string; rating: number };

/** A request you made, shaped for the buyer screens. */
export type Request = {
  id: string;
  kind: ItemKind;
  itemId: string;
  price: PriceBreakdown;
  rental?: { rent: number; platform: number; total: number; hold: number; hours: number };
  status: RequestStatus;
  locationNote: string;
  createdAt: number;
  acceptedAt?: number;
  deadlineAt?: number;
  deliveredAt?: number;
  returnBy?: number;
  deliverer?: Person;
  /** The code to show as a QR right now (handoff, or return while returning). */
  code?: string;
  rating?: number;
};

export type JobStatus = 'incoming' | 'accepted' | 'verified' | 'arrived' | 'delivered' | 'returning' | 'returned' | 'closed';

/** A request you can deliver (or are delivering), shaped for the seller screens. */
export type Job = {
  id: string;
  kind: ItemKind;
  itemId: string;
  buyerName: string;
  location: string;
  earnings: number;
  status: JobStatus;
  priority: boolean;
  createdAt: number;
  acceptedAt?: number;
  deadlineAt?: number;
  deliveredAt?: number;
  returnBy?: number;
  rentalLabel?: string;
};

export type Listing = { itemId: string; quantity: number; active: boolean; adjustPct: number };
export type WalletEntry = { id: string; label: string; amount: number; at: number };
export type Profile = { id: string; name: string; communityId: string | null; rating: number; reliability: number };

type DbRequest = {
  id: string;
  kind: ItemKind;
  buyer_id: string;
  item_id: string;
  status: RequestStatus;
  location_note: string;
  item_price: number;
  deliverer_fee: number;
  platform_fee: number;
  total: number;
  rental_hours: number | null;
  hold_amount: number | null;
  seller_payout: number | null;
  accepted_by: string | null;
  accepted_at: string | null;
  deadline_at: string | null;
  seal_verified_at: string | null;
  delivered_at: string | null;
  return_by: string | null;
  rating: number | null;
  created_at: string;
};

type DbItem = { id: string; kind: ItemKind; barcode: string | null; name: string; size: string; category: CategoryId; emoji: string; image_url: string | null; market_price: number; created_by: string | null };

type State = {
  ready: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  mode: 'buy' | 'rent' | 'sell';
  items: Item[];
  requests: Request[];
  jobs: Job[];
  listings: Listing[];
  wallet: WalletEntry[];
};

const initialState: State = { ready: false, userId: null, email: null, profile: null, mode: 'buy', items: [], requests: [], jobs: [], listings: [], wallet: [] };

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : undefined);
const rentalLabel = (hours: number | null) => (!hours ? undefined : hours >= 24 ? `${hours / 24} day${hours > 24 ? 's' : ''}` : `${hours} hours`);

function toItem(row: DbItem, sellers: Map<string, number>, userId: string | null): Item {
  const bundled = bundledItem(row.id);
  return {
    id: row.id,
    kind: row.kind,
    barcode: row.barcode ?? undefined,
    name: row.name,
    size: row.size,
    category: row.category,
    emoji: row.emoji,
    image: row.image_url ? { uri: row.image_url } : bundled?.image,
    marketPrice: row.market_price,
    nearbyCount: sellers.get(row.id) ?? 0,
    addedByMe: !!userId && row.created_by === userId,
  };
}

async function must<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(friendlyError(error));
  return data;
}

function useAppState() {
  const [state, setState] = useState<State>(initialState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // ── Loading ──────────────────────────────────────────────────────────────

  const loadProfile = useCallback(async (userId: string) => {
    const row = await must(supabase.from('profiles').select('id, name, community_id, rating_avg, reliability_score').eq('id', userId).maybeSingle());
    const profile: Profile | null = row ? { id: row.id, name: row.name, communityId: row.community_id, rating: Number(row.rating_avg), reliability: row.reliability_score } : null;
    setState((s) => ({ ...s, profile }));
    return profile;
  }, []);

  const loadCatalog = useCallback(async () => {
    const userId = stateRef.current.userId;
    const [rows, counts] = await Promise.all([
      must(supabase.from('items').select('id, kind, barcode, name, size, category, emoji, image_url, market_price, created_by').order('created_at', { ascending: false })),
      must(supabase.rpc('item_counts')),
    ]);
    const sellers = new Map<string, number>((counts as { item_id: string; sellers: number }[]).map((c) => [c.item_id, c.sellers]));
    const items = (rows as DbItem[]).map((r) => toItem(r, sellers, userId));
    // Catalog items first (in their bundled order), then user-added ones.
    items.sort((a, b) => (bundledItem(a.id) ? 0 : 1) - (bundledItem(b.id) ? 0 : 1));
    stateRef.current = { ...stateRef.current, items };
    setState((s) => ({ ...s, items }));
  }, []);

  const loadListings = useCallback(async () => {
    const rows = await must(supabase.from('listings').select('item_id, quantity, active, adjust_pct').order('created_at', { ascending: false }));
    const listings = (rows ?? []).map((l) => ({ itemId: l.item_id, quantity: l.quantity, active: l.active, adjustPct: l.adjust_pct }));
    stateRef.current = { ...stateRef.current, listings };
    setState((s) => ({ ...s, listings }));
  }, []);

  const loadActivity = useCallback(async () => {
    const userId = stateRef.current.userId;
    if (!userId) return;
    const [mine, others] = await Promise.all([
      must(supabase.from('requests').select('*').eq('buyer_id', userId).order('created_at', { ascending: false }).limit(30)),
      must(supabase.from('requests').select('*').neq('buyer_id', userId).order('created_at', { ascending: false }).limit(50)),
    ]);
    const myRequests = (mine ?? []) as DbRequest[];
    const jobRows = (others ?? []) as DbRequest[];

    const peopleIds = [...new Set([...myRequests.map((r) => r.accepted_by), ...jobRows.map((r) => r.buyer_id)].filter((x): x is string => !!x))];
    const liveIds = myRequests.filter((r) => LIVE_STATUSES.includes(r.status)).map((r) => r.id);
    const [people, codes] = await Promise.all([
      peopleIds.length ? must(supabase.from('profiles').select('id, name, rating_avg').in('id', peopleIds)) : Promise.resolve([]),
      liveIds.length ? must(supabase.from('handoff_codes').select('request_id, purpose, code').in('request_id', liveIds)) : Promise.resolve([]),
    ]);
    const personById = new Map((people ?? []).map((p) => [p.id, { name: p.name as string, rating: Number(p.rating_avg) }]));
    const codeFor = (id: string, purpose: string) => (codes ?? []).find((c) => c.request_id === id && c.purpose === purpose)?.code as string | undefined;

    const requests: Request[] = myRequests.map((r) => ({
      id: r.id,
      kind: r.kind,
      itemId: r.item_id,
      price: { item: r.item_price, deliverer: r.deliverer_fee, platform: r.platform_fee, total: r.total },
      rental: r.kind === 'rent' ? { rent: r.deliverer_fee, platform: r.platform_fee, total: r.total, hold: r.hold_amount ?? 0, hours: r.rental_hours ?? 0 } : undefined,
      status: r.status,
      locationNote: r.location_note,
      createdAt: ms(r.created_at)!,
      acceptedAt: ms(r.accepted_at),
      deadlineAt: ms(r.deadline_at),
      deliveredAt: ms(r.delivered_at),
      returnBy: ms(r.return_by),
      deliverer: r.accepted_by ? personById.get(r.accepted_by) : undefined,
      code: codeFor(r.id, r.status === 'returning' ? 'return' : 'handoff'),
      rating: r.rating ?? undefined,
    }));

    const { items, listings } = stateRef.current;
    const jobs: Job[] = jobRows
      .filter((r) => r.status === 'open' || r.accepted_by === userId)
      .map((r) => {
        const item = items.find((i) => i.id === r.item_id);
        const listing = listings.find((l) => l.itemId === r.item_id);
        const status: JobStatus =
          r.status === 'open'
            ? 'incoming'
            : r.status === 'accepted'
              ? r.seal_verified_at
                ? 'verified'
                : 'accepted'
              : r.status === 'arriving'
                ? 'arrived'
                : r.status === 'delivered' || r.status === 'renting'
                  ? 'delivered'
                  : r.status === 'returning'
                    ? 'returning'
                    : r.status === 'returned'
                      ? 'returned'
                      : 'closed';
        const estimate = r.kind === 'buy' && item ? sellerEarnings(item, listing?.adjustPct ?? 0) : r.deliverer_fee;
        return {
          id: r.id,
          kind: r.kind,
          itemId: r.item_id,
          buyerName: personById.get(r.buyer_id)?.name ?? 'A neighbor',
          location: r.location_note,
          earnings: r.seller_payout ?? estimate,
          status,
          priority: !!listing?.active,
          createdAt: ms(r.created_at)!,
          acceptedAt: ms(r.accepted_at),
          deadlineAt: ms(r.deadline_at),
          deliveredAt: ms(r.delivered_at),
          returnBy: ms(r.return_by),
          rentalLabel: rentalLabel(r.rental_hours),
        };
      });

    const wallet: WalletEntry[] = jobs
      .filter((j) => j.deliveredAt && ['delivered', 'returning', 'returned'].includes(j.status))
      .map((j) => ({ id: j.id, label: `${j.kind === 'rent' ? 'Rented out' : 'Sold'} ${items.find((i) => i.id === j.itemId)?.name ?? 'item'}`, amount: j.earnings, at: j.deliveredAt! }));

    setState((s) => ({ ...s, requests, jobs, wallet }));
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadCatalog(), loadListings()]);
    await loadActivity();
  }, [loadActivity, loadCatalog, loadListings]);

  // ── Session ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const apply = async (userId: string | null, email: string | null) => {
      setState((s) => ({ ...initialState, mode: s.mode, ready: false, userId, email }));
      stateRef.current = { ...stateRef.current, userId, email };
      if (userId) {
        try {
          await loadProfile(userId);
          await refreshAll();
        } catch (e) {
          console.warn('[lobb] initial load failed', e);
        }
      }
      setState((s) => ({ ...s, ready: true }));
    };
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user.id ?? null, data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') apply(session?.user.id ?? null, session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile, refreshAll]);

  // ── Live updates ─────────────────────────────────────────────────────────

  const signedIn = !!state.userId && !!state.profile?.communityId;
  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => loadActivity().catch(() => {}), 250);
    };
    const channel: RealtimeChannel = supabase
      .channel('lobb-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, soon)
      .subscribe();
    const poll = setInterval(soon, 10_000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [signedIn, loadActivity]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const actions = useMemo(() => {
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const data = await must(supabase.rpc(fn, args));
      await loadActivity();
      return data as DbRequest;
    };
    /** For functions that return {ok, error} instead of raising (so failed code attempts are counted). */
    const checked = async (fn: string, args: Record<string, unknown>) => {
      const result = (await must(supabase.rpc(fn, args))) as { ok: boolean; error?: string };
      await loadActivity();
      if (!result.ok) throw new Error(result.error ?? 'Something went wrong');
    };
    const uid = () => {
      const id = stateRef.current.userId;
      if (!id) throw new Error('Sign in first');
      return id;
    };

    return {
      sendCode: async (email: string) => {
        const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } });
        if (error) throw new Error(friendlyError(error));
      },
      verifyCode: async (email: string, token: string) => {
        const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: token.trim(), type: 'email' });
        if (error) throw new Error(error.message.includes('expired') || error.message.includes('invalid') ? 'That code is wrong or expired.' : friendlyError(error));
      },
      setCommunity: async (communityId: string) => {
        await must(supabase.from('profiles').update({ community_id: communityId }).eq('id', uid()));
        await loadProfile(uid());
        await refreshAll();
      },
      signOut: () => supabase.auth.signOut(),
      setMode: (mode: State['mode']) => setState((s) => ({ ...s, mode })),
      refresh: refreshAll,

      createRequest: async (item: Item, locationNote: string, durationId?: string) =>
        (await rpc('create_request', { p_item_id: item.id, p_location_note: locationNote, p_duration_id: durationId ?? null })).id,
      cancelRequest: (id: string) => rpc('cancel_request', { p_id: id }),
      startReturn: (id: string) => rpc('start_return', { p_id: id }),
      rateRequest: async (id: string, stars: number) => {
        await must(supabase.rpc('rate_request', { p_id: id, p_stars: stars }));
      },

      acceptJob: (id: string) => rpc('accept_request', { p_id: id }),
      declineJob: (id: string) => setState((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id) })),
      verifySeal: async (id: string, photoBase64: string) => {
        const path = await uploadPhoto('handoff-photos', uid(), `${id}-seal`, photoBase64);
        await rpc('verify_seal', { p_id: id, p_photo_path: path });
      },
      markArrived: (id: string) => rpc('mark_arrived', { p_id: id }),
      confirmHandoff: async (id: string, code: string, photoBase64: string) => {
        const path = await uploadPhoto('handoff-photos', uid(), `${id}-handoff`, photoBase64);
        await checked('confirm_handoff', { p_id: id, p_code: code, p_photo_path: path });
        await loadListings();
      },
      confirmReturn: (id: string, code: string) => checked('confirm_return', { p_id: id, p_code: code }),

      addListing: async (itemId: string, adjustPct = 0) => {
        const existing = stateRef.current.listings.find((l) => l.itemId === itemId);
        await must(
          supabase
            .from('listings')
            .upsert({ seller_id: uid(), item_id: itemId, quantity: (existing?.quantity ?? 0) + 1, adjust_pct: adjustPct, active: true }, { onConflict: 'seller_id,item_id' }),
        );
        await Promise.all([loadListings(), loadCatalog()]);
      },
      toggleListing: async (itemId: string) => {
        const listing = stateRef.current.listings.find((l) => l.itemId === itemId);
        if (!listing) return;
        setState((s) => ({ ...s, listings: s.listings.map((l) => (l.itemId === itemId ? { ...l, active: !l.active } : l)) }));
        await must(supabase.from('listings').update({ active: !listing.active }).eq('seller_id', uid()).eq('item_id', itemId));
      },
      /** Creates a brand-new item from a server price quote. `photo` is a local base64 photo or a product image URL. */
      createItem: async (input: { quoteId: string; size: string; barcode?: string; photo: { base64?: string | null; uri: string } }, adjustPct: number) => {
        const imageUrl = input.photo.base64 ? publicPhotoUrl(await uploadPhoto('item-photos', uid(), 'item', input.photo.base64)) : input.photo.uri;
        await must(supabase.rpc('create_item', { p_quote_id: input.quoteId, p_size: input.size, p_image_url: imageUrl, p_barcode: input.barcode ?? null, p_adjust_pct: adjustPct }));
        await Promise.all([loadCatalog(), loadListings()]);
      },
    };
  }, [loadActivity, loadCatalog, loadListings, loadProfile, refreshAll]);

  return { state, actions };
}

type Store = ReturnType<typeof useAppState>;
const StoreContext = createContext<Store | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const store = useAppState();
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside AppStoreProvider');
  return store;
}

/** Looks up an item from the catalog or user-added items. */
export function useItem(id: string | undefined) {
  const { state } = useStore();
  return state.items.find((i) => i.id === id);
}

/** Re-renders every second while `active`; returns now. */
export function useNow(active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
