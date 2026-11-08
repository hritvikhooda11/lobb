import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, Txt, type IconName } from '@/components/ui';
import { onToast, type Toast } from '@/lib/toast';
import { radius, space, useTheme } from '@/theme';

/** Shows banners from showToast() at the top of the screen for a few seconds; tap to open. */
export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const [slide] = useState(() => new Animated.Value(0));

  useEffect(
    () =>
      onToast((t) => {
        setToast(t);
        slide.setValue(0);
        Animated.sequence([
          Animated.spring(slide, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 160 }),
          Animated.delay(5000),
          Animated.timing(slide, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start(({ finished }) => finished && setToast(null));
      }),
    [slide],
  );

  if (!toast) return null;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: insets.top + space.sm,
        left: space.md,
        right: space.md,
        zIndex: 1003,
        opacity: slide,
        transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-100, 0] }) }],
      }}>
      <Pressable
        onPress={() => {
          setToast(null);
          router.push(toast.url as never);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.accent, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={(toast.icon ?? 'notifications') as IconName} size={20} tone="onAccent" />
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
