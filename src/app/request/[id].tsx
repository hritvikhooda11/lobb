import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { BUY_STEPS, CountdownRing, RadarPulse, RENT_STEPS, StatusSteps } from '@/components/live';
import { Button, Card, Icon, ItemBadge, ItemPhoto, Pill, Row, Screen, StateBadge, Txt, tap } from '@/components/ui';
import { communities } from '@/data/catalog';
import { FULFILLMENT, money, type Fulfillment } from '@/data/pricing';
import { attempt } from '@/lib/alert';
import { DELIVERY_WINDOW_MS, LIVE_STATUSES, useItem, useNow, useStore, type RequestStatus } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

const goHome = () => (router.canGoBack() ? router.back() : router.replace('/'));

const STEP: Record<RequestStatus, number> = { open: 0, accepted: 1, arriving: 2, delivered: 3, renting: 2, returning: 2, returned: 3, expired: 0, cancelled: 0 };

const formatDue = (ms: number) => {
  if (ms <= 0) return 'Overdue';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export default function RequestStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const r = state.requests.find((x) => x.id === id);
  const item = useItem(r?.itemId);
  const now = useNow(!!r && LIVE_STATUSES.includes(r.status));

  const status = r?.status;
  useEffect(() => {
    if (status === 'accepted' || status === 'arriving' || status === 'renting') tap('success');
  }, [status]);

  if (!r || !item) return null;
  const rent = r.kind === 'rent';
  const community = communities.find((c) => c.id === state.profile?.communityId);
  const remaining = r.deadlineAt ? r.deadlineAt - now : DELIVERY_WINDOW_MS;
  const total = r.rental ? r.rental.total : r.price.total;
  const name = r.deliverer?.name ?? 'Your neighbor';
  const f = r.fulfillment;
  const whereShort = { dropoff: r.buyerRoom ? `Door drop-off · Room ${r.buyerRoom}` : 'Door drop-off', lobby: 'Lobby meetup', pickup: 'Pickup' }[f];
  const countdownCaption = remaining <= 0 ? 'running late' : { dropoff: 'until it’s at your door', lobby: 'until you meet in the lobby', pickup: 'to pick it up' }[f];

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={goHome} hitSlop={12}>
          <Txt variant="label" tone="primary">
            ‹ Home
          </Txt>
        </Pressable>
        <Pill label={money(total)} />
      </Row>

      <Row style={{ marginTop: space.lg }}>
        <ItemBadge item={item} size={44} />
        <View style={{ flex: 1 }}>
          <Txt variant="heading">{item.name}</Txt>
          <Txt variant="caption" tone="muted">
            {rent && r.rental ? `${r.rental.hours >= 24 ? `${r.rental.hours / 24} day` : `${r.rental.hours} hours`} rental` : item.size} · {whereShort}
          </Txt>
        </View>
      </Row>

      {r.status !== 'cancelled' ? (
        <View style={{ marginTop: space.xl }}>
          <StatusSteps step={STEP[r.status]} steps={rent ? RENT_STEPS : BUY_STEPS} />
        </View>
      ) : null}

      <View style={{ alignItems: 'center', marginTop: space.xxl, gap: space.lg }}>
        {r.status === 'open' ? (
          <>
            <RadarPulse emoji={item.emoji} />
            <Txt variant="title" center>
              Asking your neighbors…
            </Txt>
            <Txt tone="muted" center>
              Sent to {item.nearbyCount} {item.nearbyCount === 1 ? 'neighbor' : 'neighbors'} with it listed first, then everyone in {community?.name}. You're not charged until someone accepts.
            </Txt>
          </>
        ) : null}

        {r.status === 'accepted' ? (
          <>
            <CountdownRing remainingMs={remaining} totalMs={DELIVERY_WINDOW_MS} caption={countdownCaption} />
            <DelivererCard name={name} rating={r.deliverer?.rating ?? 5} rent={rent} fulfillment={f} />
            <WherePanel fulfillment={f} name={name} buyerRoom={r.buyerRoom} sellerRoom={r.sellerRoom} />
            {r.locationNote ? (
              <Txt variant="caption" tone="muted" center>
                Your note: “{r.locationNote}”
              </Txt>
            ) : null}
            {r.code ? (
              <Txt variant="caption" tone="muted" center>
                Your handoff code is <Txt variant="caption" style={{ fontFamily: fonts.display, letterSpacing: 2 }}>{r.code}</Txt>. We’ll show the QR when {f === 'pickup' ? `${name} says it’s ready` : name === 'Your neighbor' ? 'they arrive' : `${name} arrives`}.
              </Txt>
            ) : null}
            {remaining <= 0 ? (
              <Txt tone="warning" center>
                {name} is past the 10-minute window. Keep waiting or cancel for free.
              </Txt>
            ) : null}
          </>
        ) : null}

        {r.status === 'arriving' ? (
          <HandoffQR
            code={r.code}
            title={f === 'dropoff' ? `${name} is at your door` : f === 'lobby' ? `${name} is in the lobby` : `${name} is ready for you`}
            body={`${f === 'pickup' && r.sellerRoom ? `Head to Room ${r.sellerRoom}. ` : ''}${rent ? `Check it works, then let ${name} scan this. Your rental starts on scan.` : `Check the seal, then let ${name} scan this. Payment is released on scan.`}`}
          />
        ) : null}

        {r.status === 'renting' && r.returnBy ? (
          <>
            <ItemPhoto item={item} height={160} radius={radius.lg} />
            <View style={{ alignItems: 'center' }}>
              <Txt variant="caption" tone="muted">
                DUE BACK IN
              </Txt>
              <Txt style={{ fontFamily: fonts.display, fontSize: 44, lineHeight: 50 }}>{formatDue(r.returnBy - now)}</Txt>
              <Txt variant="caption" tone="muted">
                to {name}
              </Txt>
            </View>
            <Button label="Return it now" icon="return-down-back" onPress={() => attempt(() => actions.startReturn(r.id))} style={{ alignSelf: 'stretch' }} />
            <Txt variant="caption" tone="muted" center>
              Your {money(r.rental!.hold)} hold is released the moment {name} scans it back.
            </Txt>
          </>
        ) : null}

        {r.status === 'returning' ? <HandoffQR code={r.code} title={`Hand it back to ${name}`} body={`${name} scans this to confirm the return. Then your hold is released.`} /> : null}

        {r.status === 'delivered' ? <Done requestId={r.id} name={name} rated={r.rating} title="Delivered!" /> : null}
        {r.status === 'returned' ? <Done requestId={r.id} name={name} rated={r.rating} title="Returned!" subtitle={`Your ${money(r.rental!.hold)} hold is released.`} /> : null}

        {r.status === 'expired' ? (
          <>
            <StateBadge icon="moon" tone="muted" />
            <Txt variant="title" center>
              Nobody was free
            </Txt>
            <Txt tone="muted" center>
              No charge. Try again in a bit — more neighbors are around in the evening.
            </Txt>
            <Button label="Back home" kind="ghost" onPress={goHome} style={{ alignSelf: 'stretch' }} />
          </>
        ) : null}

        {r.status === 'cancelled' ? (
          <>
            <StateBadge icon="close" tone="muted" />
            <Txt variant="title" center>
              Request cancelled
            </Txt>
            <Txt tone="muted" center>
              No charge. Your card was never touched.
            </Txt>
            <Button label="Back home" kind="ghost" onPress={goHome} style={{ alignSelf: 'stretch' }} />
          </>
        ) : null}
      </View>

      {r.status === 'open' || (r.status === 'accepted' && remaining <= 0) ? (
        <Button label="Cancel request" kind="danger" onPress={() => attempt(() => actions.cancelRequest(r.id))} style={{ marginTop: space.xxl }} />
      ) : null}

    </Screen>
  );
}

function WherePanel({ fulfillment, name, buyerRoom, sellerRoom }: { fulfillment: Fulfillment; name: string; buyerRoom?: string; sellerRoom?: string }) {
  const { colors } = useTheme();
  const option = FULFILLMENT[fulfillment];
  const line =
    fulfillment === 'pickup'
      ? sellerRoom
        ? `Go to Room ${sellerRoom} to pick it up`
        : 'Waiting for their room number…'
      : fulfillment === 'lobby'
        ? `${name} will meet you in the lobby`
        : `${name} is bringing it to ${buyerRoom ? `Room ${buyerRoom}` : 'your door'}`;
  return (
    <Card highlight style={{ alignSelf: 'stretch', backgroundColor: colors.primarySoft }}>
      <Row>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={option.icon} size={22} tone="onPrimary" />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="caption" tone="muted">
            {option.label.toUpperCase()}
          </Txt>
          <Txt variant="label">{line}</Txt>
        </View>
      </Row>
    </Card>
  );
}

function DelivererCard({ name, rating, rent, fulfillment }: { name: string; rating: number; rent: boolean; fulfillment: Fulfillment }) {
  const { colors } = useTheme();
  const status = rent
    ? 'grabbing it now'
    : { dropoff: 'checking the seal, then heading to your door', lobby: 'checking the seal, then heading to the lobby', pickup: 'checking the seal and getting it ready' }[fulfillment];
  return (
    <Card style={{ alignSelf: 'stretch' }}>
      <Row>
        <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
          <Txt variant="heading" tone="primary">
            {name[0]}
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="label">{name} accepted</Txt>
          <Txt variant="caption" tone="muted">
            ★ {rating.toFixed(1)} · UW verified · {status}
          </Txt>
        </View>
      </Row>
    </Card>
  );
}

function HandoffQR({ code, title, body }: { code?: string; title: string; body: string }) {
  const { colors } = useTheme();
  return (
    <>
      <Txt variant="title" center>
        {title}
      </Txt>
      <View style={{ padding: space.xl, backgroundColor: '#fff', borderRadius: radius.xl, shadowColor: colors.primary, shadowOpacity: 0.5, shadowRadius: 30 }}>
        {code ? <QRCode value={code} size={200} color="#0D0A14" backgroundColor="#fff" /> : <View style={{ width: 200, height: 200 }} />}
      </View>
      {code ? (
        <Txt style={{ fontFamily: fonts.display, fontSize: 28, letterSpacing: 6 }} center>
          {code}
        </Txt>
      ) : null}
      <Txt tone="muted" center>
        {body}
      </Txt>
    </>
  );
}

function Done({ requestId, name, rated, title, subtitle }: { requestId: string; name: string; rated?: number; title: string; subtitle?: string }) {
  const { colors } = useTheme();
  const { actions } = useStore();
  const [stars, setStars] = useState(rated ?? 0);
  return (
    <>
      <StateBadge icon="checkmark" tone="success" />
      <Txt variant="title" center>
        {title}
      </Txt>
      {subtitle ? (
        <Txt tone="success" center>
          {subtitle}
        </Txt>
      ) : null}
      <Txt tone="muted" center>
        How was {name}?
      </Txt>
      <Row gap={space.sm}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            hitSlop={6}
            onPress={() => {
              tap();
              setStars(n);
              attempt(() => actions.rateRequest(requestId, n));
            }}>
            <Icon name={n <= stars ? 'star' : 'star-outline'} size={36} color={n <= stars ? colors.warning : colors.textMuted} />
          </Pressable>
        ))}
      </Row>
      <Button label="Done" onPress={goHome} style={{ alignSelf: 'stretch', marginTop: space.lg }} />
      <Pressable onPress={() => router.push('/report')} hitSlop={8}>
        <Txt variant="caption" tone="muted">
          Something wrong with the item? Report it
        </Txt>
      </Pressable>
    </>
  );
}
