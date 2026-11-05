import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ItemBadge, Pill, Row, Txt, tap } from '@/components/ui';
import { categories, type CategoryId, type Item } from '@/data/catalog';
import { money, sellerEarnings } from '@/data/pricing';
import { showError } from '@/lib/alert';
import { useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

/**
 * Quick stock for registered sellers: every item in the store with a − / + counter, so a seller can
 * restock their whole shelf in one pass instead of listing items one by one.
 */
export default function Stock() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { state } = useStore();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryId | null>(null);
  const isAdmin = !!state.profile?.isAdmin;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.items.filter(
      (i) =>
        i.kind === 'buy' &&
        !i.special &&
        (isAdmin || i.category !== 'alcohol') &&
        (!category || i.category === category) &&
        (!q || i.name.toLowerCase().includes(q)),
    );
  }, [state.items, query, category, isAdmin]);

  const stocked = state.listings.filter((l) => l.active && l.quantity > 0);
  const units = stocked.reduce((n, l) => n + l.quantity, 0);

  if (!state.profile?.isSeller) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.xl, paddingTop: insets.top + space.xl, gap: space.lg }}>
        <Txt variant="title">Quick stock</Txt>
        <Txt tone="muted">Quick stock is for Lobb wholesale sellers. Enter your seller code on your Account page.</Txt>
        <Button label="Back" kind="ghost" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xxl, gap: space.md }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="title">Quick stock</Txt>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Txt variant="label" tone="primary">
            Done
          </Txt>
        </Pressable>
      </Row>
      <Txt tone="muted">
        Set how many of each you have in your room. Neighbors who order get sent to you first. {units > 0 ? `You’re stocking ${units} ${units === 1 ? 'item' : 'items'}.` : ''}
      </Txt>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search the store"
        placeholderTextColor={colors.textMuted}
        style={{ height: 46, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, color: colors.text, fontSize: 16 }}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.xl }} contentContainerStyle={{ paddingHorizontal: space.xl, gap: space.sm }}>
        {[null, ...categories.filter((c) => isAdmin || !c.ageRestricted).map((c) => c.id)].map((id) => {
          const active = id === category;
          return (
            <Pressable
              key={id ?? 'all'}
              onPress={() => {
                tap();
                setCategory(id);
              }}
              style={{ paddingHorizontal: 14, height: 34, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: active ? colors.primary : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
              <Txt variant="label" style={{ color: active ? colors.onPrimary : colors.text }}>
                {id ? categories.find((c) => c.id === id)!.label : 'All'}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>

      {items.map((item) => (
        <StockRow key={item.id} item={item} />
      ))}

      <Button label="List something new" icon="add" kind="ghost" onPress={() => router.push('/list-item')} style={{ marginTop: space.md }} />
    </ScrollView>
  );
}

function StockRow({ item }: { item: Item }) {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const listing = state.listings.find((l) => l.itemId === item.id);
  const qty = listing?.active ? listing.quantity : 0;
  const change = (d: number) => {
    const next = Math.max(0, Math.min(99, qty + d));
    if (next === qty) return;
    tap();
    actions.setStock(item.id, next).catch((e) => showError(e instanceof Error ? e.message : 'Couldn’t save that.'));
  };
  return (
    <Row style={{ backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: qty > 0 ? colors.primary : colors.border }}>
      <ItemBadge item={item} size={48} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="label" numberOfLines={1}>
          {item.name}
        </Txt>
        <Row gap={6}>
          <Txt variant="caption" tone="muted">
            {item.size}
          </Txt>
          <Pill label={`earn ${money(sellerEarnings(item, listing?.adjustPct ?? 0))}`} tone="success" />
        </Row>
      </View>
      <Row gap={space.sm}>
        <Counter label="−" disabled={qty === 0} onPress={() => change(-1)} />
        <Txt style={{ fontFamily: fonts.display, fontSize: 18, minWidth: 22, textAlign: 'center' }}>{qty}</Txt>
        <Counter label="+" onPress={() => change(1)} accent />
      </Row>
    </Row>
  );
}

function Counter({ label, onPress, disabled, accent }: { label: string; onPress: () => void; disabled?: boolean; accent?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: accent ? colors.primary : colors.surfaceHigh, opacity: disabled ? 0.35 : 1 }}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 20, lineHeight: 22, color: accent ? colors.onPrimary : colors.text }}>{label}</Txt>
    </Pressable>
  );
}
