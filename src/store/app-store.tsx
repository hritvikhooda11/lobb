/**
 * Client-side app state, mocked. Shapes follow the draft data model in PRODUCT_CONTEXT §16
 * so this can be swapped for a real backend (Supabase) without touching screens.
 *
 * `simulate*` actions stand in for events that will come from other users in production
 * (a neighbor accepting, a deliverer scanning your QR).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { getItem } from '@/data/catalog';
import { priceFor, sellerEarnings, type PriceBreakdown } from '@/data/pricing';

export const DELIVERY_WINDOW_MS = 10 * 60 * 1000;

export type User = { name: string; email: string; communityId: string };

export type RequestStatus = 'open' | 'accepted' | 'arriving' | 'delivered' | 'expired' | 'cancelled';

export type Request = {
  id: string;
  itemId: string;
  price: PriceBreakdown;
  status: RequestStatus;
  locationNote: string;
  createdAt: number;
  acceptedAt?: number;
  deliveredAt?: number;
  deliverer?: { name: string; rating: number; floor: string };
  qrToken: string;
  rating?: number;
};

export type JobStatus = 'incoming' | 'accepted' | 'verified' | 'delivered';

export type Job = {
  id: string;
  itemId: string;
  buyerName: string;
  location: string;
  earnings: number;
  status: JobStatus;
  /** True if the request matched one of your listings (priority window). */
  priority: boolean;
  acceptedAt?: number;
};

export type Listing = { itemId: string; quantity: number; active: boolean };

export type WalletEntry = { id: string; label: string; amount: number; at: number };

type State = {
  user: User | null;
  mode: 'buy' | 'sell';
  requests: Request[];
  jobs: Job[];
  listings: Listing[];
  wallet: WalletEntry[];
};

const uid = () => Math.random().toString(36).slice(2, 10);
const minutesAgo = (m: number) => Date.now() - m * 60_000;

const seedJobs = (): Job[] => [
  { id: uid(), itemId: 'coke-12', buyerName: 'Jordan', location: 'Floor 9 · Unit 912', earnings: sellerEarnings(getItem('coke-12')!), status: 'incoming', priority: true },
  { id: uid(), itemId: 'shin-ramyun', buyerName: 'Priya', location: 'Floor 4 · Lobby side', earnings: sellerEarnings(getItem('shin-ramyun')!), status: 'incoming', priority: false },
  { id: uid(), itemId: 'usbc-cable', buyerName: 'Alex', location: 'Floor 12 · Study lounge', earnings: sellerEarnings(getItem('usbc-cable')!), status: 'incoming', priority: false },
];

const initialState: State = {
  user: null,
  mode: 'buy',
  requests: [],
  jobs: seedJobs(),
  listings: [
    { itemId: 'coke-12', quantity: 4, active: true },
    { itemId: 'cup-noodles', quantity: 3, active: true },
    { itemId: 'kind-bar', quantity: 2, active: false },
  ],
  wallet: [
    { id: uid(), label: 'Delivered Red Bull', amount: 359, at: minutesAgo(60 * 26) },
    { id: uid(), label: 'Delivered Cup Noodles', amount: 184, at: minutesAgo(60 * 50) },
  ],
};

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
      signOut: () => setState({ ...initialState, jobs: seedJobs() }),
      setMode: (mode: State['mode']) => setState((s) => ({ ...s, mode })),

      /** Buyer: create a request. Returns its id. */
      createRequest: (itemId: string, locationNote: string) => {
        const item = getItem(itemId);
        if (!item) throw new Error(`Unknown item ${itemId}`);
        const id = uid();
        const request: Request = {
          id,
          itemId,
          price: priceFor(item),
          status: 'open',
          locationNote,
          createdAt: Date.now(),
          qrToken: `knock:${id}:${uid()}`,
        };
        setState((s) => ({ ...s, requests: [request, ...s.requests] }));
        // Mock: a neighbor accepts after a few seconds.
        timers.current.push(
          setTimeout(() => {
            setState((s) => {
              const r = s.requests.find((x) => x.id === id);
              if (!r || r.status !== 'open') return s;
              const deliverer = MOCK_DELIVERERS[Math.floor(Math.random() * MOCK_DELIVERERS.length)];
              return {
                ...s,
                requests: s.requests.map((x) => (x.id === id ? { ...x, status: 'accepted', acceptedAt: Date.now(), deliverer } : x)),
              };
            });
          }, 3500),
        );
        return id;
      },
      cancelRequest: (id: string) => patchRequest(id, { status: 'cancelled' }),
      simulateArriving: (id: string) => patchRequest(id, { status: 'arriving' }),
      simulateHandoffScanned: (id: string) => patchRequest(id, { status: 'delivered', deliveredAt: Date.now() }),
      rateRequest: (id: string, rating: number) => patchRequest(id, { rating }),

      /** Seller: first-come-first-serve accept. */
      acceptJob: (id: string) => patchJob(id, { status: 'accepted', acceptedAt: Date.now() }),
      declineJob: (id: string) => setState((s) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id) })),
      markSealVerified: (id: string) => patchJob(id, { status: 'verified' }),
      completeJob: (id: string) =>
        setState((s) => {
          const job = s.jobs.find((j) => j.id === id);
          if (!job) return s;
          const item = getItem(job.itemId);
          return {
            ...s,
            jobs: s.jobs.map((j) => (j.id === id ? { ...j, status: 'delivered' } : j)),
            listings: s.listings.map((l) => (l.itemId === job.itemId ? { ...l, quantity: Math.max(0, l.quantity - 1) } : l)),
            wallet: [{ id: uid(), label: `Delivered ${item?.name ?? 'item'}`, amount: job.earnings, at: Date.now() }, ...s.wallet],
          };
        }),

      addListing: (itemId: string) =>
        setState((s) => {
          const existing = s.listings.find((l) => l.itemId === itemId);
          if (existing) {
            return { ...s, listings: s.listings.map((l) => (l.itemId === itemId ? { ...l, quantity: l.quantity + 1, active: true } : l)) };
          }
          return { ...s, listings: [{ itemId, quantity: 1, active: true }, ...s.listings] };
        }),
      toggleListing: (itemId: string) =>
        setState((s) => ({ ...s, listings: s.listings.map((l) => (l.itemId === itemId ? { ...l, active: !l.active } : l)) })),
      removeListing: (itemId: string) => setState((s) => ({ ...s, listings: s.listings.filter((l) => l.itemId !== itemId) })),
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
