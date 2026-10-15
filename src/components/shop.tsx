/**
 * Storefront building blocks for the Buy/Rent home: promo banners, category circles,
 * horizontal item rows and item cards. Photo-first, delivery-app style.
 */
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { categoryIcon, Icon, IconButton, Pill, SectionHeader, Txt, tap, useElevation } from '@/components/ui';
import { bundledItem, type Category, type CategoryId, type Item, type ItemKind } from '@/data/catalog';
import { money, priceFor, rentPerDay } from '@/data/pricing';
import { categoryTint, fonts, radius, space, useTheme } from '@/theme';

const openItem = (item: Item) => router.push({ pathname: '/item/[id]', params: { id: item.id } });

/** Rough arrival estimate from how many neighbors have it listed. */
export const etaMinutes = (item: Item) => (item.nearbyCount > 0 ? Math.max(4, 12 - item.nearbyCount) : null);

export function itemPrice(item: Item) {
  return item.kind === 'buy' ? money(priceFor(item).total) : money(rentPerDay(item));
}

// ── Promo banners ───────────────────────────────────────────────────────────

type Promo = { id: string; title: string; subtitle: string; cta: string; itemId: string; colors: [string, string]; category?: CategoryId };

const PROMOS: Record<ItemKind, Promo[]> = {
  buy: [
    { id: 'late-night', title: 'Late-night cravings', subtitle: 'Snacks from down the hall, in minutes', cta: 'Shop snacks', itemId: 'hot-cheetos', colors: ['#6D3CF0', '#2A1A55'], category: 'snacks' },
    { id: 'exam-fuel', title: 'Exam-week fuel', subtitle: 'Red Bull, Celsius and more, delivered', cta: 'Shop drinks', itemId: 'redbull-8', colors: ['#0E7C86', '#0B3B4A'], category: 'drinks' },
    { id: 'ramen', title: 'Ramen o’clock', subtitle: 'Shin, Cup Noodles and Easy Mac', cta: 'Shop instant', itemId: 'shin-ramyun', colors: ['#E8384F', '#7A1230'], category: 'instant' },
  ],
  rent: [
    { id: 'midterms', title: 'Midterm tomorrow?', subtitle: 'Borrow a TI-84 from a neighbor tonight', cta: 'Borrow tech', itemId: 'ti84', colors: ['#6D3CF0', '#2A1A55'], category: 'electronics' },
    { id: 'rain', title: 'Seattle rain again', subtitle: 'Grab an umbrella for a buck a day', cta: 'Borrow gear', itemId: 'umbrella', colors: ['#2563EB', '#1E2A5A'], category: 'household' },
  ],
};

export function PromoCarousel({ kind, onPick }: { kind: ItemKind; onPick: (category?: CategoryId) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      snapToInterval={312}
      decelerationRate="fast"
      style={{ marginHorizontal: -space.lg, marginTop: space.lg }}
      contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md }}>
      {PROMOS[kind].map((p) => {
        const image = bundledItem(p.itemId)?.image;
        return (
          <Pressable
            key={p.id}
            onPress={() => {
              tap();
              onPick(p.category);
            }}
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
            <LinearGradient colors={p.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 300, height: 150, borderRadius: radius.lg, padding: space.lg, overflow: 'hidden' }}>
              <View style={{ width: 170, gap: 6 }}>
                <Txt style={{ fontFamily: fonts.display, fontSize: 22, lineHeight: 25, color: '#fff' }}>{p.title}</Txt>
                <Txt variant="caption" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  {p.subtitle}
                </Txt>
              </View>
              <View style={{ position: 'absolute', left: space.lg, bottom: space.lg, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Txt variant="label" style={{ color: p.colors[1] }}>
                  {p.cta}
                </Txt>
                <Icon name="arrow-forward" size={14} color={p.colors[1]} />
              </View>
              {image ? (
                <View style={{ position: 'absolute', right: -14, bottom: -14, width: 128, height: 128, borderRadius: 64, backgroundColor: '#fff', overflow: 'hidden', transform: [{ rotate: '-8deg' }] }}>
                  <Image source={image} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                </View>
              ) : null}
            </LinearGradient>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── Category circles ────────────────────────────────────────────────────────

const CATEGORY_PHOTO: Record<ItemKind, Partial<Record<CategoryId, string>>> = {
  buy: { snacks: 'hot-cheetos', drinks: 'coke-12', instant: 'cup-noodles', toiletries: 'toothpaste', electronics: 'lightning', household: 'tissues' },
  rent: { electronics: 'ti84', household: 'umbrella' },
};

export function CategoryCircles({ kind, cats, active, onPick }: { kind: ItemKind; cats: Category[]; active: CategoryId | null; onPick: (id: CategoryId | null) => void }) {
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg, marginTop: space.xl }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.lg }}>
      {cats.map((c) => {
        const selected = c.id === active;
        const photoId = CATEGORY_PHOTO[kind][c.id];
        const image = photoId ? bundledItem(photoId)?.image : undefined;
        return (
          <Pressable
            key={c.id}
            onPress={() => {
              tap();
              onPick(selected ? null : c.id);
            }}
            style={{ alignItems: 'center', gap: 6, width: 68 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                overflow: 'hidden',
                backgroundColor: image ? '#fff' : categoryTint[c.id] + '2E',
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: selected ? 3 : 0,
                borderColor: colors.primary,
              }}>
              {image ? <Image source={image} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <Icon name={categoryIcon[c.id]} size={28} color={categoryTint[c.id]} />}
            </View>
            <Txt variant="caption" tone={selected ? 'primary' : 'default'} style={{ fontWeight: selected ? '700' : '500' }} numberOfLines={1}>
              {c.label}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ── Item cards ──────────────────────────────────────────────────────────────

export function ItemCard({ item, width = 156 }: { item: Item; width?: number | `${number}%` }) {
  const elevation = useElevation();
  const eta = etaMinutes(item);
  const mine = !!item.addedByMe;
  return (
    <Pressable
      disabled={mine}
      onPress={() => {
        tap();
        openItem(item);
      }}
      style={({ pressed }) => [{ width, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View style={[{ height: 132, borderRadius: radius.md, backgroundColor: '#fff', overflow: 'hidden' }, elevation]}>
        {item.image ? (
          <Image source={item.image} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={150} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: categoryTint[item.category] + '2E' }}>
            <Icon name={categoryIcon[item.category]} size={44} color={categoryTint[item.category]} />
          </View>
        )}
        <View style={{ position: 'absolute', top: 8, left: 8 }}>
          {mine ? <Pill label="Yours" tone="primary" /> : eta ? <EtaBadge minutes={eta} /> : null}
        </View>
        {!mine ? (
          <View style={{ position: 'absolute', right: 8, bottom: 8 }}>
            <IconButton icon={item.kind === 'buy' ? 'add' : 'repeat'} tone="primary" size={34} onPress={() => openItem(item)} />
          </View>
        ) : null}
      </View>
      <View style={{ paddingTop: space.sm, gap: 1 }}>
        <Txt style={{ fontFamily: fonts.display, fontSize: 16 }}>
          {itemPrice(item)}
          {item.kind === 'rent' ? <Txt variant="caption" tone="muted"> /day</Txt> : null}
        </Txt>
        <Txt variant="label" numberOfLines={1}>
          {item.name}
        </Txt>
        <Txt variant="caption" tone="muted" numberOfLines={1}>
          {item.size || ' '}
          {item.nearbyCount > 0 && !mine ? ` · ${item.nearbyCount} nearby` : ''}
        </Txt>
      </View>
    </Pressable>
  );
}

export function EtaBadge({ minutes }: { minutes: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(13,10,20,0.78)', borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Icon name="flash" size={11} color="#C8FF3D" />
      <Txt style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{minutes} min</Txt>
    </View>
  );
}

export function ItemRow({ title, subtitle, items }: { title: string; subtitle?: string; items: Item[] }) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionHeader title={title} subtitle={subtitle} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.md, paddingBottom: space.sm }}>
        {items.map((item) => (
          <ItemCard key={item.id} item={item} />
        ))}
      </ScrollView>
    </View>
  );
}

export function ItemGrid({ items }: { items: Item[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: space.lg }}>
      {items.map((item) => (
        <ItemCard key={item.id} item={item} width="47.5%" />
      ))}
    </View>
  );
}
