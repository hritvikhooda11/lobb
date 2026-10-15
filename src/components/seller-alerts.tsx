/**
 * In-app alerts for sellers when a neighbor asks for something:
 *  1. a full-screen takeover for requests that match what you listed (first to accept wins),
 *  2. a banner that drops from the top of every screen while requests are waiting,
 *  3. a pulsing "!" dot (used on the Sell button and the Home tab).
 * These work while the app is open. Alerts when the app is closed need real push notifications,
 * which come with the TestFlight build (Expo Go can't receive them).
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router, usePathname } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, ItemPhoto, Pill, Row, Txt, tap } from '@/components/ui';
import { FULFILLMENT, money } from '@/data/pricing';
import { attempt } from '@/lib/alert';
import { useStore, type Job } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

const ACTIVE_DELIVERY: Job['status'][] = ['accepted', 'verified', 'arrived', 'returning'];

/** Pulsing red "!" badge. */
export function AlertDot({ size = 18 }: { size?: number }) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.danger,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.2] }) }],
      }}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.7, lineHeight: size * 0.85 }}>!</Text>
    </Animated.View>
  );
}

/** How many requests are waiting for you to accept. */
export function useIncomingCount() {
  const { state } = useStore();
  return state.jobs.filter((j) => j.status === 'incoming').length;
}

export function SellerAlerts() {
  const { state, actions } = useStore();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();

  const incoming = useMemo(() => state.jobs.filter((j) => j.status === 'incoming'), [state.jobs]);
  const delivering = state.jobs.some((j) => ACTIVE_DELIVERY.includes(j.status));
  const seen = useRef<Set<string> | null>(null);
  const [takeoverId, setTakeoverId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  // Start fresh for each signed-in user.
  useEffect(() => {
    seen.current = null;
    setTakeoverId(null);
  }, [state.userId]);

  // Requests that were already waiting when the app opened don't trigger the takeover (the banner covers those).
  const incomingKey = incoming.map((j) => j.id).join(',');
  useEffect(() => {
    if (!state.activityLoaded) return;
    if (seen.current === null) {
      seen.current = new Set(incoming.map((j) => j.id));
      return;
    }
    const fresh = incoming.filter((j) => !seen.current!.has(j.id));
    fresh.forEach((j) => seen.current!.add(j.id));
    const urgent = fresh.find((j) => j.priority);
    if (urgent && !delivering) {
      setTakeoverId(urgent.id);
      tap('success');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activityLoaded, incomingKey]);

  const takeover = incoming.find((j) => j.id === takeoverId);
  const item = state.items.find((i) => i.id === takeover?.itemId);

  // ── Top banner ────────────────────────────────────────────────────────────
  const onSellHome = state.mode === 'sell' && pathname === '/';
  const showBanner = incoming.length > 0 && !takeover && !onSellHome && !pathname.startsWith('/deliver');
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: showBanner ? 1 : 0, useNativeDriver: true, damping: 16, stiffness: 160 }).start();
  }, [showBanner, slide]);

  const bannerJob = incoming[0];
  const bannerItem = state.items.find((i) => i.id === bannerJob?.itemId);

  return (
    <>
      <Animated.View
        pointerEvents={showBanner ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top + space.sm,
          paddingHorizontal: space.md,
          zIndex: 1000,
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-140, 0] }) }],
        }}>
        <Pressable
          onPress={() => {
            tap();
            actions.setMode('sell');
            router.navigate('/');
          }}
          style={{ backgroundColor: colors.primary, borderRadius: radius.lg, padding: space.md, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}>
          <Row>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="notifications" size={22} color={colors.onAccent} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="label" tone="onPrimary" numberOfLines={1}>
                {incoming.length > 1 ? `${incoming.length} neighbors need something` : `${bannerJob?.buyerName ?? 'A neighbor'} wants ${bannerItem?.name ?? 'an item'}`}
              </Txt>
              <Txt variant="caption" tone="onPrimary" style={{ opacity: 0.85 }} numberOfLines={1}>
                {incoming.length > 1 ? 'Tap to see them' : `Earn ${money(bannerJob?.earnings ?? 0)} · tap to accept`}
              </Txt>
            </View>
            <Icon name="chevron-forward" size={20} tone="onPrimary" />
          </Row>
        </Pressable>
      </Animated.View>

      <Modal visible={!!takeover && !!item} animationType="fade" transparent statusBarTranslucent onRequestClose={() => setTakeoverId(null)}>
        {takeover && item ? (
          <LinearGradient colors={['#6D3CF0', '#2A1A55']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl, paddingHorizontal: space.xl }}>
            <View style={{ alignItems: 'center', gap: space.sm }}>
              <Pill label="NEW ORDER" tone="accent" icon="flash" />
              <Txt style={{ color: 'rgba(255,255,255,0.8)' }} center>
                Matches something you listed
              </Txt>
            </View>

            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg }}>
              <View style={{ width: 190, height: 190, borderRadius: 95, backgroundColor: '#fff', overflow: 'hidden', borderWidth: 6, borderColor: colors.accent }}>
                <ItemPhoto item={item} height={178} radius={0} />
              </View>
              <Txt style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: '#fff', textAlign: 'center' }}>
                {takeover.buyerName} wants {item.name}
              </Txt>
              <Row gap={space.sm} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                <Pill label={FULFILLMENT[takeover.fulfillment].label} tone="default" icon={FULFILLMENT[takeover.fulfillment].icon} />
                {takeover.kind === 'rent' ? <Pill label={`Rent · ${takeover.rentalLabel}`} tone="warning" icon="repeat" /> : null}
              </Row>
              <View style={{ alignItems: 'center' }}>
                <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.7)' }}>
                  YOU EARN
                </Txt>
                <Txt style={{ fontFamily: fonts.display, fontSize: 56, lineHeight: 62, color: colors.accent }}>{money(takeover.earnings)}</Txt>
              </View>
              <Txt style={{ color: 'rgba(255,255,255,0.8)' }} center>
                Hurry: the first neighbor to accept gets it, and you’ll have 10 minutes to hand it over.
              </Txt>
            </View>

            <View style={{ gap: space.sm }}>
              <Button
                label={accepting ? 'Accepting…' : 'Accept · 10 min'}
                icon="checkmark-circle"
                kind="accent"
                disabled={accepting}
                onPress={async () => {
                  setAccepting(true);
                  const ok = await attempt(() => actions.acceptJob(takeover.id));
                  setAccepting(false);
                  if (ok) {
                    setTakeoverId(null);
                    router.push({ pathname: '/deliver/[id]', params: { id: takeover.id } });
                  }
                }}
              />
              <Pressable onPress={() => setTakeoverId(null)} hitSlop={12} style={{ alignItems: 'center', paddingVertical: space.md }}>
                <Txt variant="label" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  Not now
                </Txt>
              </Pressable>
            </View>
          </LinearGradient>
        ) : null}
      </Modal>
    </>
  );
}
