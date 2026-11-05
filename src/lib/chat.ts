/**
 * Chat between the two people in an order (buyer ↔ neighbor delivering), or between a shout-out's
 * poster and one neighbor asking about it. Stored in public.messages; row-level security only lets
 * the two people in a thread read or write it, and Realtime streams new messages in.
 */
import { useCallback, useEffect, useState } from 'react';

import { friendlyError, supabase, uniqueChannel } from '@/lib/supabase';

export type Thread = { requestId: string } | { shoutoutId: string; neighborId: string };

export type Message = { id: string; senderId: string; body: string; at: number; pending?: boolean };

type DbMessage = { id: string; request_id: string | null; shoutout_id: string | null; neighbor_id: string | null; sender_id: string; body: string; created_at: string };

const toMessage = (m: DbMessage): Message => ({ id: m.id, senderId: m.sender_id, body: m.body, at: new Date(m.created_at).getTime() });

export const threadKey = (t: Thread) => ('requestId' in t ? `r:${t.requestId}` : `s:${t.shoutoutId}:${t.neighborId}`);

/** Route to a thread's chat screen. */
export const chatHref = (t: Thread) =>
  'requestId' in t ? { pathname: '/chat' as const, params: { request: t.requestId } } : { pathname: '/chat' as const, params: { shoutout: t.shoutoutId, neighbor: t.neighborId } };

const inThread = (m: DbMessage, t: Thread) => ('requestId' in t ? m.request_id === t.requestId : m.shoutout_id === t.shoutoutId && m.neighbor_id === t.neighborId);

/** The chat screen that's open right now, so alerts don't ping for messages you're already reading. */
let openThread: string | null = null;
export const isThreadOpen = (key: string) => openThread === key;

/** Messages in one thread, live. */
export function useThread(thread: Thread | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loaded, setLoaded] = useState(false);
  const key = thread ? threadKey(thread) : null;

  useEffect(() => {
    if (!thread || !key) return;
    openThread = key;
    let cancelled = false;
    const query = supabase.from('messages').select('*').order('created_at', { ascending: true }).limit(200);
    const scoped = 'requestId' in thread ? query.eq('request_id', thread.requestId) : query.eq('shoutout_id', thread.shoutoutId).eq('neighbor_id', thread.neighborId);
    void scoped.then(({ data }) => {
      if (cancelled) return;
      setMessages(((data ?? []) as DbMessage[]).map(toMessage));
      setLoaded(true);
    });
    const channel = uniqueChannel(`chat-${key}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as DbMessage;
        if (!inThread(row, thread)) return;
        setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev.filter((m) => !(m.pending && m.body === row.body && m.senderId === row.sender_id)), toMessage(row)]));
      })
      .subscribe();
    return () => {
      cancelled = true;
      if (openThread === key) openThread = null;
      void supabase.removeChannel(channel);
    };
    // `key` identifies the thread; the object itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const send = useCallback(
    async (body: string, myId: string) => {
      const text = body.trim();
      if (!thread || !text) return;
      const temp: Message = { id: `pending-${Date.now()}`, senderId: myId, body: text, at: Date.now(), pending: true };
      setMessages((prev) => [...prev, temp]);
      const row: Record<string, string> =
        'requestId' in thread ? { request_id: thread.requestId, body: text } : { shoutout_id: thread.shoutoutId, neighbor_id: thread.neighborId, body: text };
      const { data, error } = await supabase.from('messages').insert(row).select('*').single();
      if (error) {
        setMessages((prev) => prev.filter((m) => m.id !== temp.id));
        throw new Error(friendlyError(error));
      }
      const saved = toMessage(data as DbMessage);
      setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev.filter((m) => m.id !== temp.id) : prev.map((m) => (m.id === temp.id ? saved : m))));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return { messages, loaded, send };
}

export type ShoutoutThread = { neighborId: string; neighborName: string; lastBody: string; lastAt: number; count: number };

/** For a shout-out you posted: the neighbors who've messaged you about it. */
export function useShoutoutThreads(shoutoutId: string, enabled = true) {
  const [threads, setThreads] = useState<ShoutoutThread[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from('messages').select('*').eq('shoutout_id', shoutoutId).order('created_at', { ascending: true }).limit(300);
      const rows = (data ?? []) as DbMessage[];
      const ids = [...new Set(rows.map((r) => r.neighbor_id!))];
      const { data: people } = ids.length ? await supabase.from('profiles').select('id, name').in('id', ids) : { data: [] };
      const names = new Map((people ?? []).map((p) => [p.id as string, p.name as string]));
      const byNeighbor = new Map<string, ShoutoutThread>();
      for (const r of rows) {
        const id = r.neighbor_id!;
        const t = byNeighbor.get(id) ?? { neighborId: id, neighborName: names.get(id) ?? 'A neighbor', lastBody: '', lastAt: 0, count: 0 };
        byNeighbor.set(id, { ...t, lastBody: r.body, lastAt: new Date(r.created_at).getTime(), count: t.count + 1 });
      }
      if (!cancelled) setThreads([...byNeighbor.values()].sort((a, b) => b.lastAt - a.lastAt));
    };
    void load();
    const channel = uniqueChannel(`shoutout-threads-${shoutoutId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `shoutout_id=eq.${shoutoutId}` }, () => void load())
      .subscribe();
    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [shoutoutId, enabled]);
  return threads;
}
