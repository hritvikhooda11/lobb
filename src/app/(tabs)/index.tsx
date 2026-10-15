import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';

import { Button, Card, ItemBadge, Pill, Row, Screen, SectionHeader, Txt, tap } from '@/components/ui';
import { catalog, categories, communities, getItem, type CategoryId } from '@/data/catalog';
import { money, priceFor, sellerEarnings } from '@/data/pricing';
import { useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

export default function Home() {
  const { state, actions } = useStore();
  const community = communities.find((c) => c.id === state.user?.communityId);
  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt variant="caption" tone="muted">
            📍 {community?.name}
          </Txt>
          <Txt variant="title">{state.mode === 'buy' ? 'What do you need?' : 'Make some cash'}</Txt>
        </View>
      </Row>
      <ModeToggle mode={state.mode} onChange={actions.setMode} />
      {state.mode === 'buy' ? <BuyMode /> : <SellMode />}
    </Screen>
  );
}

function ModeToggle({ mode, onChange }: { mode: 'buy' | 'sell'; onChange: (m: 'buy' | 'sell') => void }) {
  const { colors } = useTheme();
  return (
    <Row gap={4} style={{ backgroundColor: colors.surfaceHigh, borderRadius: radius.pill, padding: 4, marginTop: space.lg }}>
      {(['buy', 'sell'] as const).map((m) => {
        const active = m === mode;
        const bg = active ? (m === 'buy' ? colors.primary : colors.accent) : 'transparent';
        const fg = active ? (m === 'buy' ? colors.onPrimary : colors.onAccent) : colors.textMuted;
        return (
          <Pressable
            key={m}
            onPress={() => {
              tap();
              onChange(m);
            }}
            style={{ flex: 1, height: 44, borderRadius: radius.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            <Txt style={{ fontFamily: fonts.display, fontSize: 16, color: fg }}>{m === 'buy' ? '🛍️  Buy' : '💸  Sell'}</Txt>
          </Pressable>
        );
      })}
    </Row>
  );
}

function BuyMode() {
  const { colors } = useTheme();
  const { state } = useStore();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CategoryId | null>(null);
  const live = state.requests.find((r) => ['open', 'accepted', 'arriving'].includes(r.status));

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.filter((i) => (!cat || i.category === cat) && (!q || i.name.toLowerCase().includes(q)));
  }, [query, cat]);

  return (
    <View>
      {live ? <LiveBanner requestId={live.id} /> : null}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="🔍  Search snacks, drinks, chargers…"
        placeholderTextColor={colors.textMuted}
        style={{
          marginTop: space.lg,
          height: 50,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          paddingHorizontal: space.lg,
          color: colors.text,
          fontSize: 16,
        }}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.md, marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
        {categories.map((c) => {
          const active = c.id === cat;
          return (
            <Pressable
              key={c.id}
              onPress={() => {
                tap();
                setCat(active ? null : c.id);
              }}
              style={{
                paddingHorizontal: 14,
                height: 38,
                borderRadius: radius.pill,
                justifyContent: 'center',
                backgroundColor: active ? colors.primarySoft : colors.surface,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}>
              <Txt variant="label" tone={active ? 'primary' : 'default'}>
                {c.emoji} {c.label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>

      <SectionHeader title={cat ? categories.find((c) => c.id === cat)!.label : 'Available in your building'} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {items.map((item) => (
          <Card key={item.id} onPress={() => router.push({ pathname: '/item/[id]', params: { id: item.id } })} style={{ width: '47.8%', padding: space.md, gap: space.sm }}>
            <ItemBadge item={item} size={52} />
            <View>
              <Txt variant="label" numberOfLines={1}>
                {item.name}
              </Txt>
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {item.size}
              </Txt>
            </View>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 18 }}>{money(priceFor(item).total)}</Txt>
              <Txt variant="caption" tone="success">
                ● {item.nearbyCount} near
              </Txt>
            </Row>
          </Card>
        ))}
        {items.length === 0 ? (
          <Txt tone="muted" style={{ marginTop: space.lg }}>
            Nothing matches. Only sealed, shelf-stable items are on Knock.
          </Txt>
        ) : null}
      </View>
    </View>
  );
}

function LiveBanner({ requestId }: { requestId: string }) {
  const { colors } = useTheme();
  const { state } = useStore();
  const r = state.requests.find((x) => x.id === requestId)!;
  const item = getItem(r.itemId)!;
  const label = r.status === 'open' ? 'Finding a neighbor…' : r.status === 'arriving' ? `${r.deliverer?.name} is at your door!` : `${r.deliverer?.name} is on the way`;
  return (
    <Card onPress={() => router.push({ pathname: '/request/[id]', params: { id: r.id } })} style={{ marginTop: space.lg, backgroundColor: colors.primary, borderColor: colors.primary }}>
      <Row>
        <ItemBadge item={item} size={44} />
        <View style={{ flex: 1 }}>
          <Txt variant="label" tone="onPrimary">
            {label}
          </Txt>
          <Txt variant="caption" tone="onPrimary" style={{ opacity: 0.8 }}>
            {item.name} · tap to track
          </Txt>
        </View>
        <Txt tone="onPrimary" style={{ fontSize: 22 }}>
          →
        </Txt>
      </Row>
    </Card>
  );
}

function SellMode() {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const incoming = state.jobs.filter((j) => j.status === 'incoming');
  const active = state.jobs.find((j) => j.status === 'accepted' || j.status === 'verified');
  const today = state.wallet.filter((w) => Date.now() - w.at < 24 * 3600_000).reduce((s, w) => s + w.amount, 0);
  const [adding, setAdding] = useState(false);

  return (
    <View>
      <Card style={{ marginTop: space.lg, backgroundColor: colors.accent, borderColor: colors.accent }}>
        <Txt variant="caption" tone="onAccent" style={{ opacity: 0.7 }}>
          EARNED TODAY
        </Txt>
        <Txt variant="hero" tone="onAccent">
          {money(today)}
        </Txt>
        <Txt variant="caption" tone="onAccent" style={{ opacity: 0.7 }}>
          {incoming.length} neighbors need something right now
        </Txt>
      </Card>

      {active ? (
        <Card highlight onPress={() => router.push({ pathname: '/deliver/[id]', params: { id: active.id } })} style={{ marginTop: space.md }}>
          <Row>
            <ItemBadge item={getItem(active.itemId)!} size={44} />
            <View style={{ flex: 1 }}>
              <Txt variant="label">Delivery in progress</Txt>
              <Txt variant="caption" tone="muted">
                {active.buyerName} · {active.location}
              </Txt>
            </View>
            <Txt tone="primary" style={{ fontSize: 22 }}>
              →
            </Txt>
          </Row>
        </Card>
      ) : null}

      <SectionHeader title="Incoming requests" />
      <View style={{ gap: space.md }}>
        {incoming.length === 0 ? <Txt tone="muted">All quiet. We'll ping you when a neighbor needs something.</Txt> : null}
        {incoming.map((job) => {
          const item = getItem(job.itemId)!;
          return (
            <Card key={job.id} highlight={job.priority}>
              {job.priority ? (
                <View style={{ marginBottom: space.sm }}>
                  <Pill label="⭐ MATCHES YOUR LISTING · FIRST DIBS" tone="primary" />
                </View>
              ) : null}
              <Row>
                <ItemBadge item={item} />
                <View style={{ flex: 1 }}>
                  <Txt variant="label">{item.name}</Txt>
                  <Txt variant="caption" tone="muted">
                    {job.buyerName} · {job.location}
                  </Txt>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Txt variant="caption" tone="muted">
                    you earn
                  </Txt>
                  <Txt style={{ fontFamily: fonts.display, fontSize: 20, color: colors.success }}>{money(job.earnings)}</Txt>
                </View>
              </Row>
              <Row style={{ marginTop: space.md }} gap={space.sm}>
                <Button label="Pass" kind="ghost" onPress={() => actions.declineJob(job.id)} style={{ flex: 1, height: 46 }} />
                <Button
                  label="Accept · 10 min"
                  kind="accent"
                  disabled={!!active}
                  onPress={() => {
                    actions.acceptJob(job.id);
                    router.push({ pathname: '/deliver/[id]', params: { id: job.id } });
                  }}
                  style={{ flex: 2, height: 46 }}
                />
              </Row>
            </Card>
          );
        })}
      </View>

      <SectionHeader title="My listings" action={adding ? 'Done' : '+ Add'} onAction={() => setAdding(!adding)} />
      <Txt variant="caption" tone="muted" style={{ marginTop: -space.sm, marginBottom: space.md }}>
        Listed items get first dibs on matching requests. Prices are set by Knock.
      </Txt>

      {adding ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -space.lg, marginBottom: space.md }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
          {catalog.map((item) => (
            <Card key={item.id} onPress={() => actions.addListing(item.id)} style={{ width: 110, padding: space.md, gap: 6 }}>
              <ItemBadge item={item} size={40} />
              <Txt variant="caption" numberOfLines={1}>
                {item.name}
              </Txt>
              <Txt variant="caption" tone="success">
                +{money(sellerEarnings(item))}
              </Txt>
            </Card>
          ))}
        </ScrollView>
      ) : null}

      <View style={{ gap: space.sm }}>
        {state.listings.map((l) => {
          const item = getItem(l.itemId)!;
          return (
            <Card key={l.itemId} style={{ paddingVertical: space.md, opacity: l.active ? 1 : 0.55 }}>
              <Row>
                <ItemBadge item={item} size={40} />
                <View style={{ flex: 1 }}>
                  <Txt variant="label">
                    {item.name} <Txt variant="caption" tone="muted">×{l.quantity}</Txt>
                  </Txt>
                  <Txt variant="caption" tone="success">
                    Earn {money(sellerEarnings(item))} each
                  </Txt>
                </View>
                <Switch
                  value={l.active}
                  onValueChange={() => actions.toggleListing(l.itemId)}
                  trackColor={{ true: colors.accent, false: colors.surfaceHigh }}
                  thumbColor="#fff"
                />
              </Row>
            </Card>
          );
        })}
      </View>
    </View>
  );
}
