import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import type { ComponentProps, ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { categoryTint, fonts, radius, space, useTheme, type ThemeColors } from '@/theme';
import type { CategoryId, Item } from '@/data/catalog';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** One icon set everywhere (Ionicons). Pass a theme tone or an explicit color. */
export function Icon({ name, size = 20, tone = 'default', color }: { name: IconName; size?: number; tone?: TxtTone; color?: string }) {
  const { colors } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? toneColor(colors, tone)} />;
}

export const categoryIcon: Record<CategoryId, IconName> = {
  snacks: 'fast-food',
  drinks: 'water',
  instant: 'restaurant',
  toiletries: 'sparkles',
  electronics: 'battery-charging',
  household: 'home',
};

/** Soft drop shadow for light mode; dark mode uses a hairline border instead. */
export function useElevation() {
  const { dark, colors } = useTheme();
  return dark
    ? { borderWidth: 1, borderColor: colors.border }
    : { borderWidth: 0, shadowColor: '#2A1A55', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 3 };
}

export function tap(style: 'light' | 'medium' | 'success' = 'light') {
  if (Platform.OS === 'web') return;
  if (style === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else Haptics.impactAsync(style === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
}

export function Screen({ children, scroll = true, padded = true }: { children: ReactNode; scroll?: boolean; padded?: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const content = { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xxxl, paddingHorizontal: padded ? space.lg : 0 };
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: colors.bg }, content]}>{children}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {children}
    </ScrollView>
  );
}

type TxtVariant = 'hero' | 'title' | 'heading' | 'body' | 'label' | 'caption';
type TxtTone = 'default' | 'muted' | 'primary' | 'accent' | 'danger' | 'success' | 'warning' | 'onAccent' | 'onPrimary';

const variantStyle: Record<TxtVariant, TextStyle> = {
  hero: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, letterSpacing: -1 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.5 },
  heading: { fontFamily: fonts.display, fontSize: 19, lineHeight: 24 },
  body: { fontSize: 16, lineHeight: 22 },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12.5, lineHeight: 16 },
};

const toneColor = (c: ThemeColors, tone: TxtTone) =>
  ({
    default: c.text,
    muted: c.textMuted,
    primary: c.primary,
    accent: c.accent,
    danger: c.danger,
    success: c.success,
    warning: c.warning,
    onAccent: c.onAccent,
    onPrimary: c.onPrimary,
  })[tone];

export function Txt({
  children,
  variant = 'body',
  tone = 'default',
  style,
  center,
  numberOfLines,
}: {
  children: ReactNode;
  variant?: TxtVariant;
  tone?: TxtTone;
  style?: StyleProp<TextStyle>;
  center?: boolean;
  numberOfLines?: number;
}) {
  const { colors } = useTheme();
  return (
    <Text numberOfLines={numberOfLines} style={[variantStyle[variant], { color: toneColor(colors, tone) }, center && { textAlign: 'center' }, style]}>
      {children}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'accent' | 'ghost' | 'danger';
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const bg = { primary: colors.primary, accent: colors.accent, ghost: colors.surfaceHigh, danger: colors.dangerSoft }[kind];
  const fg = { primary: colors.onPrimary, accent: colors.onAccent, ghost: colors.text, danger: colors.danger }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={() => {
        tap(kind === 'accent' || kind === 'primary' ? 'medium' : 'light');
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        kind === 'primary' && !disabled && { shadowColor: colors.primary, shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } },
        style,
      ]}>
      {icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
      <Text style={{ color: fg, fontFamily: fonts.display, fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style, onPress, highlight }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; highlight?: boolean }) {
  const { colors } = useTheme();
  const elevation = useElevation();
  const base = [styles.card, elevation, { backgroundColor: colors.surface }, highlight && { borderWidth: 1.5, borderColor: colors.primary }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [...base, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      {children}
    </Pressable>
  );
}

export function Pill({ label, tone = 'default', icon }: { label: string; tone?: 'default' | 'accent' | 'warning' | 'danger' | 'success' | 'primary'; icon?: IconName }) {
  const { colors, dark } = useTheme();
  const map = {
    default: [colors.surfaceHigh, colors.textMuted],
    accent: [colors.accentSoft, dark ? colors.accent : colors.text],
    warning: [colors.warningSoft, colors.warning],
    danger: [colors.dangerSoft, colors.danger],
    success: [colors.successSoft, colors.success],
    primary: [colors.primarySoft, colors.primary],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700', letterSpacing: 0.2 }}>{label}</Text>
    </View>
  );
}

/** Item photo (falls back to a category icon on a tinted tile). */
export function ItemBadge({ item, size = 56 }: { item: Item; size?: number }) {
  const tint = categoryTint[item.category];
  const box = { width: size, height: size, borderRadius: size * 0.28 };
  if (item.image) {
    return (
      <View style={[box, { backgroundColor: '#fff', overflow: 'hidden' }]}>
        <Image source={item.image} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={150} />
      </View>
    );
  }
  return (
    <View style={[box, { backgroundColor: tint + '2E', alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name={categoryIcon[item.category]} size={size * 0.45} color={tint} />
    </View>
  );
}

/** Full-width item photo for grids and detail sheets. */
export function ItemPhoto({ item, height = 120, radius: r = radius.md }: { item: Item; height?: number; radius?: number }) {
  const tint = categoryTint[item.category];
  return (
    <View style={{ height, alignSelf: 'stretch', borderRadius: r, overflow: 'hidden', backgroundColor: item.image ? '#fff' : tint + '2E', alignItems: 'center', justifyContent: 'center' }}>
      {item.image ? (
        <Image source={item.image} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={150} />
      ) : (
        <Ionicons name={categoryIcon[item.category]} size={height * 0.4} color={tint} />
      )}
    </View>
  );
}

export function Row({ children, style, gap = space.md }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.md }} />;
}

export function SectionHeader({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.md }}>
      <View style={{ flex: 1 }}>
        <Txt variant="heading">{title}</Txt>
        {subtitle ? (
          <Txt variant="caption" tone="muted">
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Txt variant="label" tone="primary">
            {action}
          </Txt>
          <Icon name="chevron-forward" size={16} tone="primary" />
        </Pressable>
      ) : null}
    </Row>
  );
}

/** Big round status illustration (replaces emoji on success/empty/error states). */
export function StateBadge({ icon, tone = 'primary', size = 96 }: { icon: IconName; tone?: 'primary' | 'success' | 'warning' | 'danger' | 'muted'; size?: number }) {
  const { colors } = useTheme();
  const c = { primary: colors.primary, success: colors.success, warning: colors.warning, danger: colors.danger, muted: colors.textMuted }[tone];
  return (
    <View style={{ width: size * 1.5, height: size * 1.5, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size * 1.5, height: size * 1.5, borderRadius: size, backgroundColor: c, opacity: 0.1 }} />
      <LinearGradient colors={[c, c + 'B3']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={size * 0.46} color="#fff" />
      </LinearGradient>
    </View>
  );
}

/** Small round icon button (header actions, quick-add). */
export function IconButton({ icon, onPress, tone = 'surface', size = 40 }: { icon: IconName; onPress?: () => void; tone?: 'surface' | 'primary' | 'accent'; size?: number }) {
  const { colors } = useTheme();
  const bg = { surface: colors.surfaceHigh, primary: colors.primary, accent: colors.accent }[tone];
  const fg = { surface: colors.text, primary: colors.onPrimary, accent: colors.onAccent }[tone];
  return (
    <Pressable
      onPress={
        onPress &&
        (() => {
          tap();
          onPress();
        })
      }
      hitSlop={6}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', transform: [{ scale: pressed ? 0.92 : 1 }] })}>
      <Ionicons name={icon} size={size * 0.5} color={fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 56,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  card: { borderRadius: radius.lg, padding: space.lg },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
});
