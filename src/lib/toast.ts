/** In-app banner for when a phone notification can't be shown (web, or notifications not allowed). See ToastHost. */
export type Toast = { title: string; body: string; url: string; icon?: string };

type Listener = (t: Toast) => void;
const listeners = new Set<Listener>();

export function showToast(t: Toast) {
  listeners.forEach((l) => l(t));
}

export function onToast(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
