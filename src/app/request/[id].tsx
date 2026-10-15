import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { CountdownRing, DemoControls, RadarPulse, StatusSteps } from '@/components/live';
import { Button, Card, ItemBadge, Pill, Row, Screen, Txt, tap } from '@/components/ui';
import { communities, getItem } from '@/data/catalog';
import { money } from '@/data/pricing';
import { DELIVERY_WINDOW_MS, useNow, useStore } from '@/store/app-store';
import { radius, space, useTheme } from '@/theme';

const goHome = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function RequestStatus() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const r = state.requests.find((x) => x.id === id);
  const live = !!r && ['open', 'accepted', 'arriving'].includes(r.status);
  const now = useNow(live);

  const status = r?.status;
  useEffect(() => {
    if (status === 'accepted' || status === 'arriving') tap('success');
  }, [status]);

  if (!r) return null;
  const item = getItem(r.itemId)!;
  const community = communities.find((c) => c.id === state.user?.communityId);
  const remaining = r.acceptedAt ? r.acceptedAt + DELIVERY_WINDOW_MS - now : DELIVERY_WINDOW_MS;
  const step = { open: 0, accepted: 1, arriving: 2, delivered: 3, expired: 0, cancelled: 0 }[r.status];

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={goHome} hitSlop={12}>
          <Txt variant="label" tone="primary">
            ‹ Home
          </Txt>
        </Pressable>
        <Pill label={money(r.price.total)} />
      </Row>

      <Row style={{ marginTop: space.lg }}>
        <ItemBadge item={item} size={44} />
        <View style={{ flex: 1 }}>
          <Txt variant="heading">{item.name}</Txt>
          <Txt variant="caption" tone="muted">
            {item.size} · meet at {r.locationNote}
          </Txt>
        </View>
      </Row>

      {r.status !== 'cancelled' ? (
        <View style={{ marginTop: space.xl }}>
          <StatusSteps step={step} />
        </View>
      ) : null}

      <View style={{ alignItems: 'center', marginTop: space.xxl, gap: space.lg }}>
        {r.status === 'open' ? (
          <>
            <RadarPulse emoji={item.emoji} />
            <Txt variant="title" center>
              Knocking on doors…
            </Txt>
            <Txt tone="muted" center>
              Sent to {item.nearbyCount} neighbors with it listed first, then everyone in {community?.name}. You're not charged until someone accepts.
            </Txt>
          </>
        ) : null}

        {r.status === 'accepted' ? (
          <>
            <CountdownRing remainingMs={remaining} totalMs={DELIVERY_WINDOW_MS} caption={remaining > 0 ? 'until delivery' : 'running late'} />
            <DelivererCard name={r.deliverer!.name} rating={r.deliverer!.rating} floor={r.deliverer!.floor} />
            {remaining <= 0 ? (
              <Txt tone="warning" center>
                {r.deliverer!.name} is past the 10-minute window. Keep waiting or cancel for free.
              </Txt>
            ) : null}
          </>
        ) : null}

        {r.status === 'arriving' ? <HandoffQR token={r.qrToken} name={r.deliverer!.name} /> : null}

        {r.status === 'delivered' ? <Delivered requestId={r.id} name={r.deliverer!.name} rated={r.rating} /> : null}

        {r.status === 'cancelled' ? (
          <>
            <Txt style={{ fontSize: 64, lineHeight: 78 }}>🫡</Txt>
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
        <Button label="Cancel request" kind="danger" onPress={() => actions.cancelRequest(r.id)} style={{ marginTop: space.xxl }} />
      ) : null}

      {__DEV__ && (r.status === 'accepted' || r.status === 'arriving') ? (
        <DemoControls
          label={r.status === 'accepted' ? `Simulate: ${r.deliverer!.name} arrives` : `Simulate: ${r.deliverer!.name} scans your QR`}
          onPress={() => (r.status === 'accepted' ? actions.simulateArriving(r.id) : actions.simulateHandoffScanned(r.id))}
        />
      ) : null}
    </Screen>
  );
}

function DelivererCard({ name, rating, floor }: { name: string; rating: number; floor: string }) {
  const { colors } = useTheme();
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
            ★ {rating.toFixed(1)} · {floor} · checking the seal, then heading over
          </Txt>
        </View>
      </Row>
    </Card>
  );
}

function HandoffQR({ token, name }: { token: string; name: string }) {
  const { colors } = useTheme();
  return (
    <>
      <Txt variant="title" center>
        {name} is at your door 🚪
      </Txt>
      <View style={{ padding: space.xl, backgroundColor: '#fff', borderRadius: radius.xl, shadowColor: colors.primary, shadowOpacity: 0.5, shadowRadius: 30 }}>
        <QRCode value={token} size={200} color="#0D0A14" backgroundColor="#fff" />
      </View>
      <Txt tone="muted" center>
        Check the seal, then let {name} scan this. Payment is released on scan.
      </Txt>
    </>
  );
}

function Delivered({ requestId, name, rated }: { requestId: string; name: string; rated?: number }) {
  const { colors } = useTheme();
  const { actions } = useStore();
  const [stars, setStars] = useState(rated ?? 0);
  return (
    <>
      <Txt style={{ fontSize: 72, lineHeight: 86 }}>🎉</Txt>
      <Txt variant="title" center>
        Delivered!
      </Txt>
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
              actions.rateRequest(requestId, n);
            }}>
            <Txt style={{ fontSize: 38, color: n <= stars ? colors.warning : colors.border }}>★</Txt>
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
