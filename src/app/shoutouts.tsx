import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, categoryIcon, Icon, Pill, Row, StateBadge, Txt, tap } from '@/components/ui';
import { FULFILLMENT, money, shoutoutPayout } from '@/data/pricing';
import { attempt, confirm } from '@/lib/alert';
import { LIVE_STATUSES, useNow, useStore, type Shoutout } from '@/store/app-store';
import { categoryTint, space, useTheme } from '@/theme';

/** Shout-outs in your building: say "I have one" to earn, or see your own. */
export default function Shoutouts() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { state } = useStore();
  const now = useNow();
  const open = state.shoutouts.filter((s) => !s.mine && s.status === 'open' && s.expiresAt > now);
  const mine = state.shoutouts.filter((s) => s.mine && (s.status !== 'open' || s.expiresAt > now)).slice(0, 5);
  const delivering = state.jobs.some((j) => ['accepted', 'verified', 'arrived'].includes(j.status));

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xxl, gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="title">Shout-outs</Txt>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Txt variant="label" tone="muted">
            Done
          </Txt>
        </Pressable>
      </Row>
      <Txt tone="muted">Neighbors asking for things nobody has listed. Have one? Say so and it’s yours to deliver.</Txt>
      <Button label="Shout for something" icon="megaphone" onPress={() => router.push('/shoutout-new')} />

      <Txt variant="heading" style={{ marginTop: space.md }}>
        In your building
      </Txt>
      {open.length === 0 ? (
        <View style={{ alignItems: 'center', gap: space.sm, paddingVertical: space.lg }}>
          <StateBadge icon="megaphone-outline" tone="muted" size={72} />
          <Txt tone="muted" center>
            No shout-outs right now. We’ll notify you when a neighbor needs something.
          </Txt>
        </View>
      ) : (
        open.map((s) => <OpenShoutout key={s.id} shoutout={s} blocked={delivering} now={now} />)
      )}

      {mine.length ? (
        <>
          <Txt variant="heading" style={{ marginTop: space.md }}>
            Yours
          </Txt>
          {mine.map((s) => (
            <MyShoutout key={s.id} shoutout={s} now={now} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const minutesLeft = (s: Shoutout, now: number) => Math.max(0, Math.round((s.expiresAt - now) / 60_000));
const ago = (at: number, now: number) => {
  const m = Math.round((now - at) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

function Header({ s }: { s: Shoutout }) {
  const tint = categoryTint[s.category];
  return (
    <Row>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tint + '26', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={categoryIcon[s.category]} size={22} color={tint} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="heading" numberOfLines={1}>
          {s.text}
        </Txt>
        <Txt variant="caption" tone="muted">
          {s.mine ? 'You' : s.posterName} · {s.kind === 'rent' ? `borrow for ${s.rentalLabel}` : 'buy'} · {FULFILLMENT[s.fulfillment].label}
        </Txt>
      </View>
    </Row>
  );
}

function OpenShoutout({ shoutout: s, blocked, now }: { shoutout: Shoutout; blocked: boolean; now: number }) {
  const { colors } = useTheme();
  const { actions } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <Card style={{ gap: space.md }}>
      <Header s={s} />
      {s.note ? <Txt variant="caption">“{s.note}”</Txt> : null}
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="caption" tone="muted">
          {ago(s.createdAt, now)} · {minutesLeft(s, now)} min left
        </Txt>
        <Txt variant="label" tone="success">
          You get {money(shoutoutPayout(s.offer))}
        </Txt>
      </Row>
      <Button
        label={busy ? 'Claiming…' : blocked ? 'Finish your current delivery first' : s.kind === 'rent' ? 'I can lend one' : 'I have one'}
        icon={blocked ? undefined : 'hand-right'}
        kind="accent"
        disabled={busy || blocked}
        onPress={async () => {
          if (s.kind === 'buy' && !(await confirm('Is it new and sealed?', 'Things you sell on Lobb must be unopened. You’ll snap a photo of the seal before you hand it over.', 'Yes, it’s sealed'))) return;
          setBusy(true);
          let requestId = '';
          const ok = await attempt(async () => {
            requestId = await actions.claimShoutout(s.id);
          });
          setBusy(false);
          if (!ok) return;
          tap('success');
          router.replace({ pathname: '/deliver/[id]', params: { id: requestId } });
        }}
        style={{ backgroundColor: blocked ? colors.surfaceHigh : undefined }}
      />
    </Card>
  );
}

function MyShoutout({ shoutout: s, now }: { shoutout: Shoutout; now: number }) {
  const { state, actions } = useStore();
  const request = state.requests.find((r) => r.id === s.requestId);
  const live = !!request && LIVE_STATUSES.includes(request.status);
  return (
    <Card style={{ gap: space.md }}>
      <Header s={s} />
      <Row style={{ justifyContent: 'space-between' }}>
        {s.status === 'open' ? (
          <Pill icon="time" label={`WAITING · ${minutesLeft(s, now)} MIN LEFT`} tone="warning" />
        ) : s.status === 'claimed' ? (
          <Pill icon="checkmark-circle" label={live ? 'A NEIGHBOR HAS IT' : 'DONE'} tone="success" />
        ) : (
          <Pill label="CANCELLED" />
        )}
        <Txt variant="label">{money(s.offer)}</Txt>
      </Row>
      {s.status === 'open' ? (
        <Button
          label="Cancel shout-out"
          kind="ghost"
          onPress={async () => {
            if (await confirm('Cancel this shout-out?', 'Neighbors will no longer see it.', 'Cancel it')) await attempt(() => actions.cancelShoutout(s.id));
          }}
        />
      ) : live ? (
        <Button label="Track it" icon="navigate" onPress={() => router.push({ pathname: '/request/[id]', params: { id: s.requestId! } })} />
      ) : null}
    </Card>
  );
}
