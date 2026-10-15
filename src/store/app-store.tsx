/**
 * Client-side app state, mocked. Shapes follow the draft data model in PRODUCT_CONTEXT §16
 * so this can be swapped for a real backend (Supabase) without touching screens.
 *
 * `simulate*` actions stand in for events that will come from other users in production
 * (a neighbor accepting, a deliverer scanning your QR).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { catalog, type Item, type ItemKind } from '@/data/catalog';
import { priceFor, rentalDurations, rentalPriceFor, sellerEarnings, type PriceBreakdown, type RentalBreakdown } from '@/data/pricing';

export const DELIVERY_WINDOW_MS = 10 * 60 * 1000;

export type User = { name: string; email: string; communityId: string };

export type RequestStatus =
  | 'open'
  | 'accepted'
  | 'arriving'
  | 'delivered'
  // rentals only
  | 'renting'
  | 'returning'
  | 'returned'
  | 'expired'
  | 'cancelled';

export const LIVE_STATUSES: RequestStatus[] = ['open', 'accepted', 'arriving', 'renting', 'returning'];

export type Request = {
  id: string;
  kind: ItemKind;
  itemId: string;
  price: PriceBreakdown;
  rental?: RentalBreakdown & { durationId: string; hours: number };
  status: RequestStatus;
  locationNote: string;
  createdAt: number;
  acceptedAt?: number;
  deliveredAt?: number;
  returnBy?: number;
  deliverer?: { name: string; rating: number; floor: string };
  qrToken: string;
  rating?: number;
};

export type JobStatus = 'incoming' | 'accepted' | 'verified' | 'delivered';

export type Job = {
  id: string;
  kind: ItemKind;
  itemId: string;
  buyerName: string;
  location: string;
  earnings: number;
  status: JobStatus;
  /** True if the request matched one of your listings (priority window). */
  priority: boolean;
  acceptedAt?: number;
  rentalLabel?: string;
  handoffPhotoUri?: string;
};

export type Listing = { itemId: string; quantity: number; active: boolean; adjustPct: number };

export type WalletEntry = { id: string; label: string; amount: number; at: number };

export type NewItem = Pick<Item, 'name' | 'size' | 'category' | 'kind' | 'marketPrice'> & { photoUri: string };

type State = {
  user: User | null;
  mode: 'buy' | 'rent' | 'sell';
  items: Item[];
  requests: Request[];
  jobs: Job[];
  listings: Listing[];
  wallet: WalletEntry[];
};

const uid = () => Math.random().toString(36).slice(2, 10);
const minutesAgo = (m: number) => Date.now() - m * 60_000;
const byId = (id: string) => catalog.find((i) => i.id === id)!;

const seedJobs = (): Job[] => [
  { id: uid(), kind: 'buy', itemId: 'coke-12', buyerName: 'Jordan', location: 'Floor 9 · Unit 912', earnings: sellerEarnings(byId('coke-12')), status: 'incoming', priority: true },
  { id: uid(), kind: 'rent', itemId: 'ti84', buyerName: 'Sam', location: 'Floor 6 · Study room', earnings: rentalPriceFor(byId('ti84'), rentalDurations[1]).rent, status: 'incoming', priority: false, rentalLabel: '1 day' },
  { id: uid(), kind: 'buy', itemId: 'shin-ramyun', buyerName: 'Priya', location: 'Floor 4 · Lobby side', earnings: sellerEarnings(byId('shin-ramyun')), status: 'incoming', priority: false },
];

const initialState = (): State => ({
  user: null,
  mode: 'buy',
  items: catalog,
  requests: [],
  jobs: seedJobs(),
  listings: [
    { itemId: 'coke-12', quantity: 4, active: true, adjustPct: 0 },
    { itemId: 'cup-noodles', quantity: 3, active: true, adjustPct: 0 },
    { itemId: 'umbrella', quantity: 1, active: true, adjustPct: 0 },
  ],
  wallet: [
    { id: uid(), label: 'Sold Red Bull', amount: 359, at: minutesAgo(60 * 26) },
    { id: uid(), label: 'Rented out HDMI cable', amount: 65, at: minutesAgo(60 * 50) },
  ],
});

const MOCK_DELIVERERS = [
  { name: 'Maya', rating: 4.9, floor: 'Floor 7' },
  { name: 'Sam', rating: 4.8, floor: 'Floor 3' },
  { name: 'Leo', rating: 5.0, floor: 'Floor 11' },
];

function useAppState() {
  const [state, setState] = useState<State>(initialState);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const patchRequest = useCallback((id: string, patch: Partial<Request>) => {
    setState((s) => ({ ...s, requests: s.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  }, []);

  const patchJob = useCallback((id: string, patch: Partial<Job>) => {
    setState((s) => ({ ...s, jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) }));
  }, []);

  const actions = useMemo(
    () => ({
      signIn: (user: User) => setState((s) => ({ ...s, user })),
      signOut: () => setState(initialState()),
      setMode: (mode: State['mode']) => setState((s) => ({ ...s, mode })),

      /** Buyer: request to buy (or, with `durationId`, to rent). Returns the request id. */
      createRequest: (item: Item, locationNote: string, durationId?: string) => {
        const id = uid();
        const duration = rentalDurations.find((d) => d.id === durationId);
        const request: Request = {
          id,
          kind: item.kind,
          itemId: item.id,
          price: priceFor(item),
          rental: item.kind === 'rent' && duration ? { ...rentalPriceFor(item, duration), durationId: duration.id, hours: duration.hours } : undefined,
          status: 'open',
          locationNote,
          createdAt: Date.now(),
          qrToken: `lobb:${id}:${uid()}`,
        };
        setState((s) => ({ ...s, requests: [request, ...s.requests] }));
        // Mock: a neighbor accepts after a few seconds.
        timers.current.push(
          setTimeout(() => {
            setState((s) => {
              const r = s.requests.find((x) => x.id === id);
              if (!r || r.status !== 'open') return s;
              const deliverer = MOCK_DELIVERERS[Math.floor(Math.random() * MOCK_DELIVERERS.length)];
              return { ...s, requests: s.requests.map((x) => (x.id === id ? { ...x, status: 'accepted', acceptedAt: Date.now(), deliverer } : x)) };
            });
          }, 3500),
        );
        return id;
      },
      cancelRequest: (id: string) => patchRequest(id, { status: 'cancelled' }),
      simulateArriving: (id: string) => patchRequest(id, { status: 'arriving' }),
      /** Deliverer scanned the buyer's QR. Purchases complete; rentals start the clock. */
      simulateHandoffScanned: (id: string) =>
        setState((s) => ({
          ...s,
          requests: s.requests.map((r) => {
            if (r.id !== id) return r;
            if (r.kind === 'rent' && r.rental) return { ...r, status: 'renting', deliveredAt: Date.now(), returnBy: Date.now() + r.rental.hours * 3600_000 };
            return { ...r, status: 'delivered', deliveredAt: Date.now() };
          }),
        })),
      startReturn: (id: string) => patchRequest(id, { status: 'returning', qrToken: `lobb:return:${id}:${uid()}` }),
      simulateReturnScanned: (id: string) => patchRequest(id, { status: 'returned' }),
      rateRequest: (id: string, rating: number) => patchRequest(id, { rating }),

      /** Seller: first-come-first-serve accept. */
      acceptJob: (id: string) => patchJob(id, { status: 'accepted', acceptedAt: Date.now() }),
      declineJob: (id: string) => setState((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id) })),
      markVerified: (id: string) => patchJob(id, { status: 'verified' }),
      completeJob: (id: string, handoffPhotoUri: string) =>
        setState((s) => {
          const job = s.jobs.find((j) => j.id === id);
          if (!job) return s;
          const item = s.items.find((i) => i.id === job.itemId);
          const label = `${job.kind === 'rent' ? 'Rented out' : 'Sold'} ${item?.name ?? 'item'}`;
          return {
            ...s,
            jobs: s.jobs.map((j) => (j.id === id ? { ...j, status: 'delivered', handoffPhotoUri } : j)),
            listings: job.kind === 'buy' ? s.listings.map((l) => (l.itemId === job.itemId ? { ...l, quantity: Math.max(0, l.quantity - 1) } : l)) : s.listings,
            wallet: [{ id: uid(), label, amount: job.earnings, at: Date.now() }, ...s.wallet],
          };
        }),

      /** Seller: list one more of an existing item (or update the price nudge). */
      addListing: (itemId: string, adjustPct = 0) =>
        setState((s) => {
          const existing = s.listings.find((l) => l.itemId === itemId);
          if (existing) {
            return { ...s, listings: s.listings.map((l) => (l.itemId === itemId ? { ...l, quantity: l.quantity + 1, active: true, adjustPct } : l)) };
          }
          return { ...s, listings: [{ itemId, quantity: 1, active: true, adjustPct }, ...s.listings] };
        }),
      /** Seller: add a brand-new item to the catalog and list it. Returns the new item id. */
      createItem: (input: NewItem, adjustPct: number) => {
        const id = `user-${uid()}`;
        const item: Item = {
          id,
          kind: input.kind,
          name: input.name,
          size: input.size,
          category: input.category,
          emoji: '📦',
          image: { uri: input.photoUri },
          marketPrice: input.marketPrice,
          nearbyCount: 1,
          addedByMe: true,
        };
        setState((s) => ({ ...s, items: [item, ...s.items], listings: [{ itemId: id, quantity: 1, active: true, adjustPct }, ...s.listings] }));
        return id;
      },
      toggleListing: (itemId: string) =>
        setState((s) => ({ ...s, listings: s.listings.map((l) => (l.itemId === itemId ? { ...l, active: !l.active } : l)) })),
    }),
    [patchJob, patchRequest],
  );

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
