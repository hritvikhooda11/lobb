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
import { sellerEarnings, type Fulfillment, type PriceBreakdown } from '@/data/pricing';
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
  rental?: { rent: number; platform: number; fulfillment: number; total: number; hold: number; hours: number };
  status: RequestStatus;
  fulfillment: Fulfillment;
  /** Optional note from the buyer ("knock twice"). */
  locationNote: string;
  /** The deliverer's room, shown to the buyer for a pickup once someone accepts. */
  sellerRoom?: string;
  /** The buyer's own room, kept for a door drop-off. */
  buyerRoom?: string;
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
  fulfillment: Fulfillment;
  /** The buyer's optional note. */
  location: string;
  /** The buyer's room, only visible to the deliverer after accepting a door drop-off. */
  buyerRoom?: string;
  /** Your own room, shown on a pickup. */
  myRoom?: string;
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
/** One line of money history: positive = earned as a seller, negative = spent as a buyer. */
export type WalletEntry = { id: string; kind: 'earn' | 'spend'; label: string; amount: number; at: number };
export type Profile = {
  id: string;
  name: string;
  communityId: string | null;
  room: string | null;
  rating: number;
  reliability: number;
  /** Lobb admins can sell alcohol. Set by Lobb staff only. */
  isAdmin: boolean;
  notifyShoutouts: boolean;
  /** Age from the birthdate the user confirmed (private). Null until they confirm it. */
  age: number | null;
  /** Whether Lobb has turned on the alcohol section in this building. */
  alcoholEnabled: boolean;
};

/** "Anyone have a plunger?" A request for something nobody lists. */
export type Shoutout = {
  id: string;
  userId: string;
  posterName: string;
  text: string;
  note: string;
  kind: ItemKind;
  category: CategoryId;
  /** All-in price the poster will pay, in cents. */
  offer: number;
  fulfillment: Fulfillment;
  rentalLabel?: string;
  status: 'open' | 'claimed' | 'cancelled';
  claimedBy: string | null;
  requestId: string | null;
  createdAt: number;
  expiresAt: number;
  mine: boolean;
};

type DbShoutout = {
  id: string;
  user_id: string;
  text: string;
  note: string;
  kind: ItemKind;
  category: CategoryId;
  offer: number;
  fulfillment: Fulfillment;
  rental_hours: number | null;
  status: Shoutout['status'];
  claimed_by: string | null;
  request_id: string | null;
  created_at: string;
  expires_at: string;
};

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
  fulfillment: Fulfillment;
  fulfillment_adjust: number;
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

type DbItem = {
  id: string;
  kind: ItemKind;
  barcode: string | null;
  name: string;
  size: string;
  category: CategoryId;
  emoji: string;
  image_url: string | null;
  market_price: number;
  lobb_price: number | null;
  price_source: string | null;
  price_source_url: string | null;
  special: boolean;
  created_by: string | null;
};

const ITEM_COLUMNS = 'id, kind, barcode, name, size, category, emoji, image_url, market_price, lobb_price, price_source, price_source_url, special, created_by';

const yearsSince = (isoDate: string) => {
  const b = new Date(isoDate);
  const now = new Date();
  return now.getFullYear() - b.getFullYear() - (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate()) ? 1 : 0);
};

type State = {
  ready: boolean;
  /** True once the first requests/jobs load has finished (so old requests don't trigger alerts). */
  activityLoaded: boolean;
  userId: string | null;
  email: string | null;
  profile: Profile | null;
  mode: 'buy' | 'rent' | 'sell';
  items: Item[];
  requests: Request[];
  jobs: Job[];
  listings: Listing[];
  wallet: WalletEntry[];
  /** Open shout-outs in your building, plus your own (any status). */
  shoutouts: Shoutout[];
  shoutoutsLoaded: boolean;
};

const initialState: State = {
  ready: false,
  activityLoaded: false,
  userId: null,
  email: null,
  profile: null,
  mode: 'buy',
  items: [],
  requests: [],
  jobs: [],
  listings: [],
  wallet: [],
  shoutouts: [],
  shoutoutsLoaded: false,
};

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
    addedByMe: !!userId && row.created_by === userId && !row.special,
    lobbPrice: row.lobb_price ?? undefined,
    priceSource: row.price_source ?? undefined,
    priceSourceUrl: row.price_source_url ?? undefined,
    special: row.special,
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
    const [row, home] = await Promise.all([
      must(supabase.from('profiles').select('id, name, community_id, rating_avg, reliability_score, role, notify_shoutouts').eq('id', userId).maybeSingle()),
      must(supabase.from('home_details').select('room, birthdate').eq('user_id', userId).maybeSingle()),
    ]);
    const community = row?.community_id
      ? await must(supabase.from('communities').select('alcohol_enabled').eq('id', row.community_id).maybeSingle())
      : null;
    const profile: Profile | null = row
      ? {
          id: row.id,
          name: row.name,
          communityId: row.community_id,
          room: home?.room ?? null,
          rating: Number(row.rating_avg),
          reliability: row.reliability_score,
          isAdmin: row.role === 'admin',
          notifyShoutouts: row.notify_shoutouts,
          age: home?.birthdate ? yearsSince(home.birthdate) : null,
          alcoholEnabled: !!community?.alcohol_enabled,
        }
      : null;
    stateRef.current = { ...stateRef.current, profile };
    setState((s) => ({ ...s, profile }));
    return profile;
  }, []);

  const loadCatalog = useCallback(async () => {
    const userId = stateRef.current.userId;
    const [rows, counts] = await Promise.all([
      must(supabase.from('items').select(ITEM_COLUMNS).order('created_at', { ascending: false })),
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
    // Rooms are private to the two people in a request, so this only returns rows we're a party to.
    const roomIds = [...myRequests.map((r) => r.id), ...jobRows.filter((r) => r.accepted_by === userId).map((r) => r.id)];
    const [people, codes, rooms] = await Promise.all([
      peopleIds.length ? must(supabase.from('profiles').select('id, name, rating_avg').in('id', peopleIds)) : Promise.resolve([]),
      liveIds.length ? must(supabase.from('handoff_codes').select('request_id, purpose, code').in('request_id', liveIds)) : Promise.resolve([]),
      roomIds.length ? must(supabase.from('request_private').select('request_id, buyer_room, seller_room').in('request_id', roomIds)) : Promise.resolve([]),
    ]);
    const roomsFor = (id: string) => (rooms ?? []).find((x) => x.request_id === id);
    const myRoom = stateRef.current.profile?.room ?? undefined;
    const personById = new Map((people ?? []).map((p) => [p.id, { name: p.name as string, rating: Number(p.rating_avg) }]));
    const codeFor = (id: string, purpose: string) => (codes ?? []).find((c) => c.request_id === id && c.purpose === purpose)?.code as string | undefined;

    const requests: Request[] = myRequests.map((r) => ({
      id: r.id,
      kind: r.kind,
      itemId: r.item_id,
      price: { item: r.item_price, deliverer: r.deliverer_fee, platform: r.platform_fee, fulfillment: r.fulfillment_adjust, total: r.total },
      rental: r.kind === 'rent' ? { rent: r.deliverer_fee, platform: r.platform_fee, fulfillment: r.fulfillment_adjust, total: r.total, hold: r.hold_amount ?? 0, hours: r.rental_hours ?? 0 } : undefined,
      status: r.status,
      fulfillment: r.fulfillment,
      locationNote: r.location_note,
      sellerRoom: roomsFor(r.id)?.seller_room ?? undefined,
      buyerRoom: roomsFor(r.id)?.buyer_room ?? undefined,
      createdAt: ms(r.created_at)!,
      acceptedAt: ms(r.accepted_at),
      deadlineAt: ms(r.deadline_at),
      deliveredAt: ms(r.delivered_at),
      returnBy: ms(r.return_by),
      deliverer: r.accepted_by ? personById.get(r.accepted_by) : undefined,
      code: codeFor(r.id, r.status === 'returning' ? 'return' : 'handoff'),
      rating: r.rating ?? undefined,
    }));

    const { items, listings, profile } = stateRef.current;
    const isAlcohol = (itemId: string) => items.find((i) => i.id === itemId)?.category === 'alcohol';
    const jobs: Job[] = jobRows
      // Only Lobb admins can deliver alcohol, so nobody else is offered those requests.
      .filter((r) => (r.status === 'open' && (profile?.isAdmin || !isAlcohol(r.item_id))) || r.accepted_by === userId)
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
        const estimate = (r.kind === 'buy' && item ? sellerEarnings(item, listing?.adjustPct ?? 0) : r.deliverer_fee) + r.fulfillment_adjust;
        return {
          id: r.id,
          kind: r.kind,
          itemId: r.item_id,
          buyerName: personById.get(r.buyer_id)?.name ?? 'A neighbor',
          fulfillment: r.fulfillment,
          location: r.location_note,
          buyerRoom: roomsFor(r.id)?.buyer_room ?? undefined,
          myRoom: r.fulfillment === 'pickup' ? myRoom : undefined,
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

    const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? 'item';
    const earned: WalletEntry[] = jobs
      .filter((j) => j.deliveredAt && ['delivered', 'returning', 'returned'].includes(j.status))
      .map((j) => ({ id: `earn-${j.id}`, kind: 'earn', label: `${j.kind === 'rent' ? 'Rented out' : 'Sold'} ${nameOf(j.itemId)}`, amount: j.earnings, at: j.deliveredAt! }));
    // What you paid as a buyer counts once the item has actually changed hands.
    const spent: WalletEntry[] = myRequests
      .filter((r) => ['delivered', 'renting', 'returning', 'returned'].includes(r.status))
      .map((r) => ({ id: `spend-${r.id}`, kind: 'spend', label: `${r.kind === 'rent' ? 'Rented' : 'Bought'} ${nameOf(r.item_id)}`, amount: -r.total, at: ms(r.delivered_at) ?? ms(r.created_at)! }));
    const wallet = [...earned, ...spent].sort((a, b) => b.at - a.at);

    setState((s) => ({ ...s, requests, jobs, wallet, activityLoaded: true }));
  }, []);

  const loadShoutouts = useCallback(async () => {
    const userId = stateRef.current.userId;
    if (!userId) return;
    const rows = (await must(
      supabase
        .from('shoutouts')
        .select('id, user_id, text, note, kind, category, offer, fulfillment, rental_hours, status, claimed_by, request_id, created_at, expires_at')
        .or(`user_id.eq.${userId},and(status.eq.open,expires_at.gt.${new Date().toISOString()})`)
        .order('created_at', { ascending: false })
        .limit(40),
    )) as DbShoutout[];
    const posterIds = [...new Set(rows.map((r) => r.user_id))];
    const people = posterIds.length ? await must(supabase.from('profiles').select('id, name').in('id', posterIds)) : [];
    const nameOf = new Map((people ?? []).map((p) => [p.id as string, p.name as string]));
    const shoutouts: Shoutout[] = rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      posterName: nameOf.get(r.user_id) ?? 'A neighbor',
      text: r.text,
      note: r.note,
      kind: r.kind,
      category: r.category,
      offer: r.offer,
      fulfillment: r.fulfillment,
      rentalLabel: rentalLabel(r.rental_hours),
      status: r.status,
      claimedBy: r.claimed_by,
      requestId: r.request_id,
      createdAt: ms(r.created_at)!,
      expiresAt: ms(r.expires_at)!,
      mine: r.user_id === userId,
    }));
    setState((s) => ({ ...s, shoutouts, shoutoutsLoaded: true }));
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadCatalog(), loadListings()]);
    await Promise.all([loadActivity(), loadShoutouts()]);
  }, [loadActivity, loadCatalog, loadListings, loadShoutouts]);

  // ── Session ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let currentUser: string | null | undefined;
    const apply = async (userId: string | null, email: string | null) => {
      // Supabase re-emits SIGNED_IN whenever the app/tab regains focus. Resetting state then
      // would unmount the navigator and throw people out of a live delivery, so for the same
      // user just refresh quietly.
      if (userId === currentUser) {
        if (userId) refreshAll().catch(() => {});
        return;
      }
      const firstLoad = currentUser === undefined;
      currentUser = userId;
      setState((s) => ({ ...initialState, mode: s.mode, ready: !firstLoad && s.ready, userId, email }));
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

  const signedIn = !!state.userId && !!state.profile?.communityId && !!state.profile?.room;
  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (timer) clearTimeout(timer);
      // Catalog first: a sale or loan changes who has what, so "nearby" counts must refresh too.
      timer = setTimeout(() => refreshAll().catch(() => {}), 250);
    };
    const channel: RealtimeChannel = supabase
      .channel('lobb-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shoutouts' }, soon)
      .subscribe();
    const poll = setInterval(soon, 10_000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [signedIn, refreshAll]);

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
      /** Onboarding: pick your building and enter your room number (kept private; shared only with the other person in a request). */
      setHome: async (communityId: string, room: string) => {
        await must(supabase.rpc('set_home', { p_community: communityId, p_room: room }));
        await loadProfile(uid());
        await refreshAll();
      },
      signOut: () => supabase.auth.signOut(),
      /** Demo only: clears this account's requests, deliveries and listings (/api/dev-reset). */
      resetDemo: async () => {
        const { data } = await supabase.auth.getSession();
        const res = await fetch('/api/dev-reset', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` } });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(res.status === 404 ? 'Demo reset is off. Set LOBB_DEV_LOGIN=1 in .env and restart.' : (body.error ?? 'Reset failed'));
        await refreshAll();
      },
      setMode: (mode: State['mode']) => setState((s) => ({ ...s, mode })),
      refresh: refreshAll,

      createRequest: async (item: Item, locationNote: string, fulfillment: Fulfillment, durationId?: string) => {
        const request = await rpc('create_request', { p_item_id: item.id, p_location_note: locationNote, p_duration_id: durationId ?? null, p_fulfillment: fulfillment });
        await loadCatalog();
        return request.id;
      },
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
      /** `idChecked`: the seller confirmed the buyer's ID shows 21+ (required for alcohol). */
      confirmHandoff: async (id: string, code: string, photoBase64: string, idChecked = false) => {
        const path = await uploadPhoto('handoff-photos', uid(), `${id}-handoff`, photoBase64);
        await checked('confirm_handoff', { p_id: id, p_code: code, p_photo_path: path, p_id_checked: idChecked });
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
      /**
       * Creates a brand-new item from a server price quote. `photo` is a local base64 photo or a product
       * image URL. `price` is the seller's own price (cents), allowed within ±50% of the quote.
       */
      createItem: async (input: { quoteId: string; size: string; barcode?: string; photo: { base64?: string | null; uri: string }; price?: number }) => {
        const imageUrl = input.photo.base64 ? publicPhotoUrl(await uploadPhoto('item-photos', uid(), 'item', input.photo.base64)) : input.photo.uri;
        await must(
          supabase.rpc('create_item', { p_quote_id: input.quoteId, p_size: input.size, p_image_url: imageUrl, p_barcode: input.barcode ?? null, p_adjust_pct: 0, p_price: input.price ?? null }),
        );
        await Promise.all([loadCatalog(), loadListings()]);
      },

      // Shout-outs
      createShoutout: async (input: { text: string; kind: ItemKind; category: CategoryId; offer: number; fulfillment: Fulfillment; note: string }) => {
        await must(
          supabase.rpc('create_shoutout', {
            p_text: input.text,
            p_kind: input.kind,
            p_category: input.category,
            p_offer: input.offer,
            p_fulfillment: input.fulfillment,
            p_note: input.note,
          }),
        );
        await loadShoutouts();
      },
      cancelShoutout: async (id: string) => {
        await must(supabase.rpc('cancel_shoutout', { p_id: id }));
        await loadShoutouts();
      },
      /** "I have one": the first neighbor wins, and it becomes a delivery you've already accepted. Returns the request id. */
      claimShoutout: async (id: string) => {
        const request = (await must(supabase.rpc('claim_shoutout', { p_id: id }))) as DbRequest;
        await refreshAll();
        return request.id;
      },
      setNotifyShoutouts: async (on: boolean) => {
        setState((s) => (s.profile ? { ...s, profile: { ...s.profile, notifyShoutouts: on } } : s));
        await must(supabase.from('profiles').update({ notify_shoutouts: on }).eq('id', uid()));
      },
      /** Saved once (needed for alcohol). Format: YYYY-MM-DD. */
      setBirthdate: async (isoDate: string) => {
        await must(supabase.rpc('set_birthdate', { p_birthdate: isoDate }));
        await loadProfile(uid());
      },
    };
  }, [loadActivity, loadCatalog, loadListings, loadProfile, loadShoutouts, refreshAll]);

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
