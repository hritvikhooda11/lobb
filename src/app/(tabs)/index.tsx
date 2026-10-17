import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';

import { AlertDot, useIncomingCount } from '@/components/seller-alerts';
import { CategoryCircles, ItemGrid, ItemRow, PromoCarousel } from '@/components/shop';
import { Button, Card, Icon, IconButton, ItemBadge, Pill, Row, Screen, SectionHeader, StateBadge, Txt, tap, type IconName } from '@/components/ui';
import { canRent, categories, communities, type CategoryId, type ItemKind } from '@/data/catalog';
import { FULFILLMENT, money, priceFor, rentPerDay, sellerEarnings } from '@/data/pricing';
import { attempt } from '@/lib/alert';
import { LIVE_STATUSES, useItem, useNow, useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

type Mode = 'buy' | 'rent' | 'sell';

export default function Home() {
  const { state, actions } = useStore();
  const community = communities.find((c) => c.id === state.profile?.communityId);
  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt variant="caption" tone="muted">
            {state.mode === 'sell' ? 'Selling in' : 'Delivering to'}
          </Txt>
          <Row gap={4}>
            <Txt style={{ fontFamily: fonts.display, fontSize: 20 }}>{community?.name}</Txt>
            <Icon name="chevron-down" size={18} tone="primary" />
          </Row>
        </View>
        <IconButton icon="receipt-outline" onPress={() => router.push('/activity')} />
      </Row>
      <ModeToggle mode={state.mode} onChange={actions.setMode} />
      {state.mode === 'sell' ? <SellMode /> : <Browse kind={state.mode} />}
    </Screen>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const { colors } = useTheme();
  const waiting = useIncomingCount();
  const options: { id: Mode; label: string; icon: IconName }[] = [
    { id: 'buy', label: 'Buy', icon: 'bag-handle' },
    { id: 'rent', label: 'Rent', icon: 'repeat' },
    { id: 'sell', label: 'Sell', icon: 'cash' },
  ];
  return (
    <Row gap={4} style={{ backgroundColor: colors.surfaceHigh, borderRadius: radius.pill, padding: 4, marginTop: space.lg }}>
      {options.map(({ id, label, icon }) => {
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
            style={{ flex: 1, height: 42, borderRadius: radius.pill, backgroundColor: bg, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={17} color={fg} />
            <Txt style={{ fontFamily: fonts.display, fontSize: 15, color: fg }}>{label}</Txt>
            {id === 'sell' && waiting > 0 ? (
              <View style={{ position: 'absolute', top: -4, right: 10 }}>
                <AlertDot />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </Row>
  );
}

function Browse({ kind }: { kind: ItemKind }) {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CategoryId | null>(null);
  const live = state.requests.find((r) => LIVE_STATUSES.includes(r.status));
  const community = communities.find((c) => c.id === state.profile?.communityId);
  // The 21+ section only exists in buildings where Lobb has turned it on.
  const alcoholOn = !!state.profile?.alcoholEnabled;
  const cats = categories.filter((c) => (kind === 'rent' ? canRent(c.id) : !c.ageRestricted || alcoholOn));

  // Only items a neighbor can actually bring you right now. Sold out (or lent out) items leave the store.
  const all = useMemo(
    () => state.items.filter((i) => i.kind === kind && i.nearbyCount > 0 && !i.special && (i.category !== 'alcohol' || alcoholOn)),
    [state.items, kind, alcoholOn],
  );
  const filtering = !!query.trim() || !!cat;
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((i) => (!cat || i.category === cat) && (!q || i.name.toLowerCase().includes(q)));
  }, [all, query, cat]);

  const popular = [...all].sort((a, b) => b.nearbyCount - a.nearbyCount).slice(0, 8);
  const cheap = all.filter((i) => priceFor(i).total <= 300);
  const fromNeighbors = all.filter((i) => !bundledCatalogId(i.id));

  return (
    <View>
      {live ? <LiveBanner requestId={live.id} /> : null}

      <Row gap={space.sm} style={{ marginTop: space.lg, height: 50, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh, paddingHorizontal: space.lg }}>
        <Icon name="search" size={18} tone="muted" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={kind === 'buy' ? 'Search snacks, drinks, chargers' : 'Search calculators, cables, umbrellas'}
          placeholderTextColor={colors.textMuted}
          style={{ flex: 1, height: '100%', color: colors.text, fontSize: 16 }}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Icon name="close-circle" size={18} tone="muted" />
          </Pressable>
        ) : null}
      </Row>

      {all.length === 0 ? (
        <View style={{ alignItems: 'center', gap: space.md, marginTop: space.xxl, paddingHorizontal: space.lg }}>
          <StateBadge icon="storefront" tone="muted" />
          <Txt variant="title" center>
            Nothing listed yet
          </Txt>
          <Txt tone="muted" center>
            {kind === 'buy' ? 'No one in your building has anything to sell right now.' : 'No one in your building is lending anything right now.'} Be the first: list something and your neighbors can request it.
          </Txt>
          <Button
            label="List an item"
            icon="add-circle"
            onPress={() => {
              actions.setMode('sell');
              router.push('/list-item');
            }}
            style={{ alignSelf: 'stretch' }}
          />
        </View>
      ) : null}

      {all.length > 0 && !filtering ? <PromoCarousel kind={kind} onPick={(c) => setCat(c ?? null)} /> : null}
      {!filtering ? <ShoutoutCard /> : null}
      {all.length > 0 ? <CategoryCircles kind={kind} cats={cats} active={cat} onPick={setCat} /> : null}

      {all.length === 0 ? null : filtering ? (
        <>
          <SectionHeader
            title={cat ? categories.find((c) => c.id === cat)!.label : `Results for “${query.trim()}”`}
            subtitle={`${results.length} ${results.length === 1 ? 'item' : 'items'}`}
            action="Clear"
            onAction={() => {
              setCat(null);
              setQuery('');
            }}
          />
          {results.length ? (
            <ItemGrid items={results} />
          ) : (
            <View style={{ gap: space.md, marginTop: space.md }}>
              <Txt tone="muted">Nobody nearby has listed that yet.</Txt>
              {query.trim() ? (
                <Button
                  label={`Shout for “${query.trim()}”`}
                  icon="megaphone"
                  onPress={() => router.push({ pathname: '/shoutout-new', params: { text: query.trim() } })}
                />
              ) : null}
            </View>
          )}
        </>
      ) : kind === 'buy' ? (
        <>
          <ItemRow title={`Popular in ${community?.name ?? 'your building'}`} subtitle="Most neighbors have these on hand" items={popular} />
          <ItemRow title="Under $3" subtitle="Total price, delivery included" items={cheap} />
          <ItemRow title="New from neighbors" subtitle="Just listed in your building" items={fromNeighbors} />
        </>
      ) : (
        <>
          <ItemRow title="Borrow for tonight" subtitle="Return it when you’re done" items={popular} />
          <ItemRow title="Study essentials" items={all.filter((i) => i.category === 'electronics')} />
          <ItemRow title="Around the house" items={all.filter((i) => i.category === 'household')} />
        </>
      )}
    </View>
  );
}

const bundledCatalogId = (id: string) => !id.startsWith('user-');

/** "Can't find it? Shout it out", plus how many neighbors are asking right now. */
function ShoutoutCard() {
  const { colors } = useTheme();
  const { state } = useStore();
  const now = useNow();
  const asking = state.shoutouts.filter((s) => !s.mine && s.status === 'open' && s.expiresAt > now).length;
  return (
    <Card onPress={() => router.push(asking ? '/shoutouts' : '/shoutout-new')} style={{ marginTop: space.lg }}>
      <Row>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="megaphone" size={22} tone="primary" />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="label">Can’t find it? Shout it out</Txt>
          <Txt variant="caption" tone="muted">
            {asking ? `${asking} ${asking === 1 ? 'neighbor is' : 'neighbors are'} asking for something right now` : 'Ask your building for anything that isn’t listed'}
          </Txt>
        </View>
        <Icon name="chevron-forward" size={20} tone="muted" />
      </Row>
    </Card>
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
    <Card onPress={() => router.push({ pathname: '/request/[id]', params: { id: r.id } })} style={{ marginTop: space.lg, backgroundColor: colors.primary }}>
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
        <Icon name="chevron-forward" size={22} tone="onPrimary" />
      </Row>
    </Card>
  );
}

function SellMode() {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const incoming = state.jobs.filter((j) => j.status === 'incoming');
  const active = state.jobs.find((j) => ['accepted', 'verified', 'arrived', 'returning'].includes(j.status));
  const today = state.wallet.filter((w) => w.kind === 'earn' && Date.now() - w.at < 24 * 3600_000).reduce((s, w) => s + w.amount, 0);
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
          {incoming.length} {incoming.length === 1 ? 'neighbor needs' : 'neighbors need'} something right now
        </Txt>
      </Card>

      <Button label="List an item" icon="add-circle" onPress={() => router.push('/list-item')} style={{ marginTop: space.md }} />

      {active && activeItem ? (
        <Card highlight onPress={() => router.push({ pathname: '/deliver/[id]', params: { id: active.id } })} style={{ marginTop: space.md }}>
          <Row>
            <ItemBadge item={activeItem} size={44} />
            <View style={{ flex: 1 }}>
              <Txt variant="label">{active.status === 'returning' ? `${active.buyerName} is returning it` : active.kind === 'rent' ? 'Lending in progress' : 'Delivery in progress'}</Txt>
              <Txt variant="caption" tone="muted">
                {active.buyerName} · {FULFILLMENT[active.fulfillment].label}
              </Txt>
            </View>
            <Icon name="chevron-forward" size={22} tone="primary" />
          </Row>
        </Card>
      ) : null}

      <ShoutoutsForSellers />

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

function ShoutoutsForSellers() {
  const { state } = useStore();
  const now = useNow();
  const open = state.shoutouts.filter((s) => !s.mine && s.status === 'open' && s.expiresAt > now);
  if (open.length === 0) return null;
  return (
    <Card highlight onPress={() => router.push('/shoutouts')} style={{ marginTop: space.md }}>
      <Row>
        <Icon name="megaphone" size={24} tone="primary" />
        <View style={{ flex: 1 }}>
          <Txt variant="label">
            {open.length} {open.length === 1 ? 'shout-out' : 'shout-outs'} near you
          </Txt>
          <Txt variant="caption" tone="muted" numberOfLines={1}>
            {open.map((s) => s.text).join(' · ')}
          </Txt>
        </View>
        <Icon name="chevron-forward" size={20} tone="primary" />
      </Row>
    </Card>
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
        {job.priority ? <Pill icon="star" label="MATCHES YOUR LISTING" tone="primary" /> : null}
        {job.kind === 'rent' ? <Pill icon="repeat" label={`RENT · ${job.rentalLabel}`} tone="warning" /> : null}
        <Pill icon={FULFILLMENT[job.fulfillment].icon} label={FULFILLMENT[job.fulfillment].label.toUpperCase()} tone="accent" />
      </Row>
      <Row>
        <ItemBadge item={item} />
        <View style={{ flex: 1 }}>
          <Txt variant="label">{item.name}</Txt>
          <Txt variant="caption" tone="muted">
            {job.buyerName}
            {job.location ? ` · “${job.location}”` : ''}
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
          onPress={async () => {
            if (await attempt(() => actions.acceptJob(job.id))) router.push({ pathname: '/deliver/[id]', params: { id: job.id } });
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
  const soldOut = item.kind === 'buy' && l.quantity === 0;
  return (
    <Card style={{ paddingVertical: space.md, opacity: l.active && !soldOut ? 1 : 0.6 }}>
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
        {soldOut ? (
          <Row gap={space.sm}>
            <Pill label="SOLD OUT" tone="danger" />
            <IconButton icon="add" tone="accent" size={36} onPress={() => void attempt(() => actions.addListing(l.itemId, l.adjustPct))} />
          </Row>
        ) : (
          <Switch value={l.active} onValueChange={() => void attempt(() => actions.toggleListing(l.itemId))} trackColor={{ true: colors.accent, false: colors.surfaceHigh }} thumbColor="#fff" />
        )}
      </Row>
    </Card>
  );
}
