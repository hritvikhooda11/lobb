import { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Row, Txt } from '@/components/ui';
import { fonts, space, useTheme } from '@/theme';

export const formatClock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** Circular countdown. Violet → amber under 4 min → coral under 2 min. */
export function CountdownRing({ remainingMs, totalMs, size = 220, caption }: { remainingMs: number; totalMs: number; size?: number; caption?: string }) {
  const { colors } = useTheme();
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remainingMs / totalMs));
  const tint = remainingMs < 2 * 60_000 ? colors.danger : remainingMs < 4 * 60_000 ? colors.warning : colors.primary;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surfaceHigh} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={tint}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - frac)}
        />
      </Svg>
      <Txt style={{ fontFamily: fonts.display, fontSize: size * 0.24, lineHeight: size * 0.28, color: tint, fontVariant: ['tabular-nums'] }}>{formatClock(remainingMs)}</Txt>
      {caption ? (
        <Txt variant="caption" tone="muted">
          {caption}
        </Txt>
      ) : null}
    </View>
  );
}

/** Pulsing radar shown while a request is broadcasting to the building. */
export function RadarPulse({ size = 220, emoji }: { size?: number; emoji: string }) {
  const { colors } = useTheme();
  const anims = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    const loops = anims.map((a, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 700),
          Animated.timing(a, { toValue: 1, duration: 2100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(a, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [anims]);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {anims.map((a, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: colors.primary,
            opacity: a.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
            transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
          }}
        />
      ))}
      <View
        style={{
          width: size * 0.4,
          height: size * 0.4,
          borderRadius: size,
          backgroundColor: colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Txt style={{ fontSize: size * 0.18 }}>{emoji}</Txt>
      </View>
    </View>
  );
}

export const BUY_STEPS = ['Sent', 'Accepted', 'On the way', 'Delivered'];
export const RENT_STEPS = ['Sent', 'Accepted', 'Borrowing', 'Returned'];

export function StatusSteps({ step, steps = BUY_STEPS }: { step: number; steps?: string[] }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Row gap={6}>
        {steps.map((_, i) => (
          <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= step ? colors.primary : colors.surfaceHigh }} />
        ))}
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        {steps.map((s, i) => (
          <Txt key={s} variant="caption" tone={i <= step ? 'default' : 'muted'} style={{ fontWeight: i === step ? '700' : '400' }}>
            {s}
          </Txt>
        ))}
      </Row>
    </View>
  );
}
