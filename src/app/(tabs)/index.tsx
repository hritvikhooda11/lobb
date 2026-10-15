import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';

import { Button, Card, ItemBadge, ItemPhoto, Pill, Row, Screen, SectionHeader, Txt, tap } from '@/components/ui';
import { canRent, categories, communities, type CategoryId, type ItemKind } from '@/data/catalog';
import { money, priceFor, rentPerDay, sellerEarnings } from '@/data/pricing';
import { LIVE_STATUSES, useItem, useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

type Mode = 'buy' | 'rent' | 'sell';

const TITLES: Record<Mode, string> = { buy: 'What do you need?', rent: 'Borrow it for a bit', sell: 'Make some cash' };

export default function Home() {
  const { state, actions } = useStore();
  const community = communities.find((c) => c.id === state.user?.communityId);
  return (
    <Screen>
      <Txt variant="caption" tone="muted">
        📍 {community?.name}
      </Txt>
      <Txt variant="title">{TITLES[state.mode]}</Txt>
      <ModeToggle mode={state.mode} onChange={actions.setMode} />
      {state.mode === 'sell' ? <SellMode /> : <Browse kind={state.mode} />}
    </Screen>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const { colors } = useTheme();
  const options: { id: Mode; label: string }[] = [
    { id: 'buy', label: '🛍️ Buy' },
    { id: 'rent', label: '🔁 Rent' },
    { id: 'sell', label: '💸 Sell' },
  ];
  return (
    <Row gap={4} style={{ backgroundColor: colors.surfaceHigh, borderRadius: radius.pill, padding: 4, marginTop: space.lg }}>
      {options.map(({ id, label }) => {
        const active = id === mode;
        const bg = active ? (id === 'sell' ? colors.accent : colors.primary) : 'transparent';
        const fg = active ? (id === 'sell' ? colors.onAccent : colors.onPrimary) : colors.textMuted;
        return (
          <Pressable
            key={id}
            onPress={() => {
              tap();
              onChange(id);
            }}
            style={{ flex: 1, height: 44, borderRadius: radius.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            <Txt style={{ fontFamily: fonts.display, fontSize: 15, color: fg }}>{label}</Txt>
          </Pressable>
        );
      })}
    </Row>
  );
}

function Browse({ kind }: { kind: ItemKind }) {
  const { colors } = useTheme();
  const { state } = useStore();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CategoryId | null>(null);
  const live = state.requests.find((r) => LIVE_STATUSES.includes(r.status));
  const cats = categories.filter((c) => (kind === 'rent' ? canRent(c.id) : true));

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.items.filter((i) => i.kind === kind && (!cat || i.category === cat) && (!q || i.name.toLowerCase().includes(q)));
  }, [state.items, kind, query, cat]);

  return (
    <View>
      {live ? <LiveBanner requestId={live.id} /> : null}

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={kind === 'buy' ? '🔍  Search snacks, drinks, chargers…' : '🔍  Search calculators, cables, umbrellas…'}
        placeholderTextColor={colors.textMuted}
        style={{ marginTop: space.lg, height: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, color: colors.text, fontSize: 16 }}
      />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: space.md, marginHorizontal: -space.lg }} contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}>
        {cats.map((c) => {
          const active = c.id === cat;
          return (
            <Pressable
              key={c.id}
              onPress={() => {
                tap();
                setCat(active ? null : c.id);
              }}
              style={{ paddingHorizontal: 14, height: 38, borderRadius: radius.pill, justifyContent: 'center', backgroundColor: active ? colors.primarySoft : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
              <Txt variant="label" tone={active ? 'primary' : 'default'}>
                {c.emoji} {c.label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>

      <SectionHeader title={kind === 'buy' ? 'Available in your building' : 'Borrow from neighbors'} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        {items.map((item) => (
          <Card
            key={item.id}
            onPress={item.addedByMe ? undefined : () => router.push({ pathname: '/item/[id]', params: { id: item.id } })}
            style={{ width: '47.8%', padding: space.sm, gap: space.sm }}>
            <ItemPhoto item={item} height={112} />
            <View style={{ paddingHorizontal: 4 }}>
              <Txt variant="label" numberOfLines={1}>
                {item.name}
              </Txt>
              <Txt variant="caption" tone="muted" numberOfLines={1}>
                {item.size || ' '}
              </Txt>
            </View>
            <Row style={{ justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 4 }}>
              <Txt style={{ fontFamily: fonts.display, fontSize: 17 }}>
                {kind === 'buy' ? money(priceFor(item).total) : `${money(rentPerDay(item))}`}
                {kind === 'rent' ? <Txt variant="caption" tone="muted">/day</Txt> : null}
              </Txt>
              {item.addedByMe ? (
                <Pill label="Yours" tone="primary" />
              ) : (
                <Txt variant="caption" tone="success">
                  ● {item.nearbyCount}
                </Txt>
              )}
            </Row>
          </Card>
        ))}
        {items.length === 0 ? (
          <Txt tone="muted" style={{ marginTop: space.lg }}>
            Nothing matches yet. {kind === 'buy' ? 'Only sealed, shelf-stable items are on Lobb.' : 'Neighbors add new rentals all the time.'}
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
  const item = useItem(r.itemId)!;
  const name = r.deliverer?.name;
  const label = {
    open: 'Asking your neighbors…',
    accepted: `${name} is on the way`,
    arriving: `${name} is at your door!`,
    renting: 'You’re borrowing this',
    returning: `Returning to ${name}`,
  }[r.status as 'open' | 'accepted' | 'arriving' | 'renting' | 'returning'];
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
  const activeItem = useItem(active?.itemId);

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

      <Button label="List an item" icon="📸" onPress={() => router.push('/list-item')} style={{ marginTop: space.md }} />

      {active && activeItem ? (
        <Card highlight onPress={() => router.push({ pathname: '/deliver/[id]', params: { id: active.id } })} style={{ marginTop: space.md }}>
          <Row>
            <ItemBadge item={activeItem} size={44} />
            <View style={{ flex: 1 }}>
              <Txt variant="label">{active.kind === 'rent' ? 'Lending in progress' : 'Delivery in progress'}</Txt>
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
        {incoming.map((job) => (
          <IncomingCard key={job.id} jobId={job.id} blocked={!!active} />
        ))}
      </View>

      <SectionHeader title="My listings" />
      <View style={{ gap: space.sm }}>
        {state.listings.map((l) => (
          <ListingRow key={l.itemId} itemId={l.itemId} />
        ))}
      </View>
    </View>
  );
}

function IncomingCard({ jobId, blocked }: { jobId: string; blocked: boolean }) {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const job = state.jobs.find((j) => j.id === jobId)!;
  const item = useItem(job.itemId)!;
  return (
    <Card highlight={job.priority}>
      <Row gap={space.sm} style={{ marginBottom: space.sm, flexWrap: 'wrap' }}>
        {job.priority ? <Pill label="⭐ MATCHES YOUR LISTING" tone="primary" /> : null}
        {job.kind === 'rent' ? <Pill label={`🔁 RENT · ${job.rentalLabel}`} tone="warning" /> : null}
      </Row>
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
            you get
          </Txt>
          <Txt style={{ fontFamily: fonts.display, fontSize: 20, color: colors.success }}>{money(job.earnings)}</Txt>
        </View>
      </Row>
      <Row style={{ marginTop: space.md }} gap={space.sm}>
        <Button label="Pass" kind="ghost" onPress={() => actions.declineJob(job.id)} style={{ flex: 1, height: 46 }} />
        <Button
          label="Accept · 10 min"
          kind="accent"
          disabled={blocked}
          onPress={() => {
            actions.acceptJob(job.id);
            router.push({ pathname: '/deliver/[id]', params: { id: job.id } });
          }}
          style={{ flex: 2, height: 46 }}
        />
      </Row>
    </Card>
  );
}

function ListingRow({ itemId }: { itemId: string }) {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const l = state.listings.find((x) => x.itemId === itemId)!;
  const item = useItem(itemId);
  if (!item) return null;
  const earn = item.kind === 'buy' ? `Earn ${money(sellerEarnings(item, l.adjustPct))} each` : `${money(rentPerDay(item, l.adjustPct))}/day`;
  return (
    <Card style={{ paddingVertical: space.md, opacity: l.active ? 1 : 0.55 }}>
      <Row>
        <ItemBadge item={item} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="label" numberOfLines={1}>
            {item.name} {item.kind === 'buy' ? <Txt variant="caption" tone="muted">×{l.quantity}</Txt> : null}
          </Txt>
          <Txt variant="caption" tone="success">
            {earn}
            {l.adjustPct ? ` (${l.adjustPct > 0 ? '+' : ''}${l.adjustPct}%)` : ''}
          </Txt>
        </View>
        {item.kind === 'rent' ? <Pill label="RENT" tone="warning" /> : null}
        <Switch value={l.active} onValueChange={() => actions.toggleListing(l.itemId)} trackColor={{ true: colors.accent, false: colors.surfaceHigh }} thumbColor="#fff" />
      </Row>
    </Card>
  );
}
