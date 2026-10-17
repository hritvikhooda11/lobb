/**
 * Shout-out alerts. Unlike orders for something you listed (full-screen takeover), a shout-out is
 * a normal phone notification: a banner from the top that goes to Notification Center.
 *  - A neighbor shouts for something → everyone in the building with shout-out alerts on is pinged.
 *  - Someone says "I have one" to your shout-out → you're pinged.
 * On web (no system notifications) the same message shows as a small toast for a few seconds.
 */
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Txt } from '@/components/ui';
import { money } from '@/data/pricing';
import { ensureNotificationPermission, notify, onNotificationTap, systemNotificationsSupported } from '@/lib/notify';
import { useStore, type Shoutout } from '@/store/app-store';
import { radius, space, useTheme } from '@/theme';

type Toast = { title: string; body: string; url: string };

const pitch = (s: Shoutout) =>
  s.kind === 'rent' ? `${s.posterName} will pay ${money(s.offer)} to borrow one. Have it?` : `${s.posterName} will pay ${money(s.offer)}. Have one?`;

export function ShoutoutAlerts() {
  const { state } = useStore();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const seen = useRef<Map<string, Shoutout['status']> | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const slide = useRef(new Animated.Value(0)).current;

  function show(t: Toast) {
    if (systemNotificationsSupported) {
      void notify(t.title, t.body, t.url);
      return;
    }
    setToast(t);
    slide.setValue(0);
    Animated.sequence([
      Animated.spring(slide, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 160 }),
      Animated.delay(4000),
      Animated.timing(slide, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(({ finished }) => finished && setToast(null));
  }

  // Ask for permission once you're signed in, and open the right screen when a notification is tapped.
  useEffect(() => {
    void ensureNotificationPermission();
    return onNotificationTap((url) => router.push(url as never));
  }, []);

  useEffect(() => {
    seen.current = null;
  }, [state.userId]);

  useEffect(() => {
    if (!state.shoutoutsLoaded) return;
    if (seen.current === null) {
      // Don't ping for shout-outs that already existed when the app opened.
      seen.current = new Map(state.shoutouts.map((s) => [s.id, s.status]));
      return;
    }
    const previous = seen.current;
    for (const s of state.shoutouts) {
      const before = previous.get(s.id);
      previous.set(s.id, s.status);
      if (!s.mine && before === undefined && s.status === 'open' && state.profile?.notifyShoutouts) {
        show({ title: `📣 ${s.text}?`, body: pitch(s), url: '/shoutouts' });
      }
      if (s.mine && before === 'open' && s.status === 'claimed') {
        show({ title: `🎉 A neighbor has your ${s.text}`, body: 'They’re on it. Tap to track it.', url: s.requestId ? `/request/${s.requestId}` : '/shoutouts' });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.shoutouts, state.shoutoutsLoaded]);

  if (!toast) return null;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: insets.top + space.sm,
        left: space.md,
        right: space.md,
        zIndex: 1001,
        opacity: slide,
        transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-100, 0] }) }],
      }}>
      <Pressable
        onPress={() => {
          setToast(null);
          router.push(toast.url as never);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="megaphone" size={20} tone="onPrimary" />
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
