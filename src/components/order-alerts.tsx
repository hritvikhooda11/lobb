/**
 * Order alerts as phone notifications:
 *  - Buyer: a neighbor accepted your order, and they're at your door / in the lobby / ready for pickup.
 *  - Seller: the buyer is waiting in the lobby (or at your door for a pickup).
 * Arrivals also come as remote push on dev/TestFlight builds (request_events), so the local copy is
 * skipped when push is active. Nothing is shown for the screen you're already looking at.
 */
import { usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { notify } from '@/lib/notify';
import { showToast } from '@/lib/toast';
import { useStore, type Job, type Request } from '@/store/app-store';

/** Phone notification when possible; otherwise (web, or not allowed) an in-app banner, plus a buzz where supported. */
async function alert(title: string, body: string, url: string, pushedAs?: 'arrival') {
  if (await notify(title, body, url, pushedAs)) return;
  showToast({ title, body, url });
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(200);
}

export function OrderAlerts() {
  const { state } = useStore();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const seenRequests = useRef<Map<string, Request['status']> | null>(null);
  const seenHere = useRef<Map<string, number | undefined> | null>(null);

  useEffect(() => {
    if (!state.activityLoaded) return;
    const nameOf = (itemId: string) => state.items.find((i) => i.id === itemId)?.name ?? 'order';

    // Buyer side.
    if (seenRequests.current === null) {
      seenRequests.current = new Map(state.requests.map((r) => [r.id, r.status]));
    } else {
      for (const r of state.requests) {
        const before = seenRequests.current.get(r.id);
        seenRequests.current.set(r.id, r.status);
        if (before === r.status || pathRef.current === `/request/${r.id}`) continue;
        const who = r.deliverer?.name ?? 'A neighbor';
        const url = `/request/${r.id}`;
        if (before === 'open' && r.status === 'accepted') {
          void alert(`🎉 ${who} accepted`, `They’re bringing your ${nameOf(r.itemId)}.`, url);
        } else if (before === 'accepted' && r.status === 'arriving') {
          const title =
            r.fulfillment === 'dropoff' ? `🚪 ${who} is at your door` : r.fulfillment === 'lobby' ? `🛋️ ${who} is in the lobby` : `✅ ${who} is ready for you`;
          const body = r.fulfillment === 'pickup' ? `Head over to get your ${nameOf(r.itemId)}. Have your QR code ready.` : `They have your ${nameOf(r.itemId)}. Have your QR code ready.`;
          void alert(title, body, url, 'arrival');
        }
      }
    }

    // Seller side.
    if (seenHere.current === null) {
      seenHere.current = new Map(state.jobs.map((j) => [j.id, j.buyerHereAt]));
    } else {
      for (const j of state.jobs as Job[]) {
        const before = seenHere.current.get(j.id);
        seenHere.current.set(j.id, j.buyerHereAt);
        if (!j.buyerHereAt || j.buyerHereAt === before || pathRef.current === `/deliver/${j.id}`) continue;
        const title = j.fulfillment === 'pickup' ? `🚪 ${j.buyerName} is at your door` : `🛋️ ${j.buyerName} is waiting in the lobby`;
        void alert(title, `They’re ready for the ${nameOf(j.itemId)}.`, `/deliver/${j.id}`, 'arrival');
      }
    }
  }, [state.activityLoaded, state.requests, state.jobs, state.items]);

  return null;
}
