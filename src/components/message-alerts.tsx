/**
 * New chat message alerts: a phone notification (or an in-app banner when notifications aren't
 * allowed, and on web), unless that chat is already open. Remote push covers it when Lobb is closed.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Txt } from '@/components/ui';
import { chatHref, isThreadOpen, threadKey, type Thread } from '@/lib/chat';
import { notify, systemNotificationsSupported } from '@/lib/notify';
import { supabase, uniqueChannel } from '@/lib/supabase';
import { useStore } from '@/store/app-store';
import { radius, space, useTheme } from '@/theme';

type Toast = { title: string; body: string; thread: Thread };

export function MessageAlerts() {
  const { state } = useStore();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const [slide] = useState(() => new Animated.Value(0));
  const userId = state.userId;

  useEffect(() => {
    if (!userId) return;
    const channel = uniqueChannel('lobb-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
        const m = payload.new as { request_id: string | null; shoutout_id: string | null; neighbor_id: string | null; sender_id: string; body: string };
        if (m.sender_id === userId) return;
        const thread: Thread = m.request_id ? { requestId: m.request_id } : { shoutoutId: m.shoutout_id!, neighborId: m.neighbor_id! };
        if (isThreadOpen(threadKey(thread))) return;
        const { data } = await supabase.from('profiles').select('name').eq('id', m.sender_id).maybeSingle();
        const title = `💬 ${(data?.name as string) ?? 'A neighbor'}`;
        const url = m.request_id ? `/chat?request=${m.request_id}` : `/chat?shoutout=${m.shoutout_id}&neighbor=${m.neighbor_id}`;
        if (systemNotificationsSupported && (await notify(title, m.body, url, 'message'))) return;
        setToast({ title, body: m.body, thread });
        slide.setValue(0);
        Animated.sequence([
          Animated.spring(slide, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 160 }),
          Animated.delay(4000),
          Animated.timing(slide, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start(({ finished }) => finished && setToast(null));
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, slide]);

  if (!toast) return null;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: insets.top + space.sm,
        left: space.md,
        right: space.md,
        zIndex: 1002,
        opacity: slide,
        transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-100, 0] }) }],
      }}>
      <Pressable
        onPress={() => {
          setToast(null);
          router.push(chatHref(toast.thread));
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chatbubble-ellipses" size={20} tone="onPrimary" />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="label" numberOfLines={1}>
            {toast.title}
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={2}>
            {toast.body}
          </Txt>
        </View>
      </Pressable>
    </Animated.View>
  );
}
