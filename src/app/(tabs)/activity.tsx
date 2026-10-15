import { router } from 'expo-router';
import { View } from 'react-native';

import { Card, ItemBadge, Pill, Row, Screen, SectionHeader, Txt } from '@/components/ui';
import { money } from '@/data/pricing';
import { useStore, type RequestStatus } from '@/store/app-store';
import { space } from '@/theme';

const statusPill: Record<RequestStatus, { label: string; tone: 'primary' | 'warning' | 'success' | 'danger' | 'default' }> = {
  open: { label: 'Finding neighbor', tone: 'warning' },
  accepted: { label: 'On the way', tone: 'primary' },
  arriving: { label: 'At your door', tone: 'primary' },
  delivered: { label: 'Delivered', tone: 'success' },
  renting: { label: 'Borrowing', tone: 'primary' },
  returning: { label: 'Returning', tone: 'warning' },
  returned: { label: 'Returned', tone: 'success' },
  expired: { label: 'Expired', tone: 'default' },
  cancelled: { label: 'Cancelled', tone: 'default' },
};

export default function Activity() {
  const { state } = useStore();
  const deliveries = state.jobs.filter((j) => j.status !== 'incoming');
  return (
    <Screen>
      <Txt variant="title">Activity</Txt>

      <SectionHeader title="Your requests" />
      <View style={{ gap: space.sm }}>
        {state.requests.length === 0 ? <Txt tone="muted">Nothing yet. Your first Lobb is two taps away.</Txt> : null}
        {state.requests.map((r) => {
          const item = state.items.find((i) => i.id === r.itemId)!;
          const pill = statusPill[r.status];
          return (
            <Card key={r.id} onPress={() => router.push({ pathname: '/request/[id]', params: { id: r.id } })} style={{ paddingVertical: space.md }}>
              <Row>
                <ItemBadge item={item} size={40} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt variant="label">{item.name}</Txt>
                  <Pill label={pill.label} tone={pill.tone} />
                </View>
                <Txt variant="label">{money(r.rental ? r.rental.total : r.price.total)}</Txt>
              </Row>
            </Card>
          );
        })}
      </View>

      <SectionHeader title="Your deliveries" />
      <View style={{ gap: space.sm }}>
        {deliveries.length === 0 ? <Txt tone="muted">Switch to Sell on Home to start earning.</Txt> : null}
        {deliveries.map((j) => {
          const item = state.items.find((i) => i.id === j.itemId)!;
          return (
            <Card key={j.id} onPress={() => router.push({ pathname: '/deliver/[id]', params: { id: j.id } })} style={{ paddingVertical: space.md }}>
              <Row>
                <ItemBadge item={item} size={40} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Txt variant="label">
                    {item.name} → {j.buyerName}{j.kind === 'rent' ? ' (rent)' : ''}
                  </Txt>
                  <Pill label={j.status === 'delivered' ? 'Paid' : 'In progress'} tone={j.status === 'delivered' ? 'success' : 'primary'} />
                </View>
                <Txt variant="label" tone="success">
                  +{money(j.earnings)}
                </Txt>
              </Row>
            </Card>
          );
        })}
      </View>
    </Screen>
  );
}
