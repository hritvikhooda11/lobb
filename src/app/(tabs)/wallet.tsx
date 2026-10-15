import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import { Button, Card, Divider, Row, Screen, SectionHeader, Txt } from '@/components/ui';
import { money } from '@/data/pricing';
import { useStore } from '@/store/app-store';
import { radius, space, useTheme } from '@/theme';

const when = (at: number) => {
  const mins = Math.round((Date.now() - at) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export default function Wallet() {
  const { colors } = useTheme();
  const { state } = useStore();
  const balance = state.wallet.reduce((s, w) => s + w.amount, 0);
  const spent = state.requests.filter((r) => r.status === 'delivered').reduce((s, r) => s + r.price.total, 0);

  return (
    <Screen>
      <Txt variant="title">Wallet</Txt>
      <LinearGradient
        colors={[colors.primary, '#4C1D95']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ borderRadius: radius.xl, padding: space.xl, marginTop: space.lg }}>
        <Txt variant="caption" tone="onPrimary" style={{ opacity: 0.75 }}>
          AVAILABLE TO CASH OUT
        </Txt>
        <Txt variant="hero" tone="onPrimary" style={{ fontSize: 48, lineHeight: 54 }}>
          {money(balance)}
        </Txt>
        <Row style={{ marginTop: space.lg }}>
          <Button label="Cash out" kind="accent" onPress={() => {}} style={{ flex: 1, height: 48 }} />
        </Row>
        <Txt variant="caption" tone="onPrimary" style={{ opacity: 0.7, marginTop: space.sm }}>
          Payouts go to your bank via Stripe. Coming soon.
        </Txt>
      </LinearGradient>

      <Row style={{ marginTop: space.md }} gap={space.md}>
        <Card style={{ flex: 1 }}>
          <Txt variant="caption" tone="muted">
            Earned all time
          </Txt>
          <Txt variant="heading" tone="success">
            {money(balance)}
          </Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Txt variant="caption" tone="muted">
            Spent on Lobb
          </Txt>
          <Txt variant="heading">{money(spent)}</Txt>
        </Card>
      </Row>

      <SectionHeader title="History" />
      <Card>
        {state.wallet.map((w, i) => (
          <View key={w.id}>
            {i > 0 ? <Divider /> : null}
            <Row style={{ justifyContent: 'space-between' }}>
              <View>
                <Txt variant="label">{w.label}</Txt>
                <Txt variant="caption" tone="muted">
                  {when(w.at)}
                </Txt>
              </View>
              <Txt variant="label" tone="success">
                +{money(w.amount)}
              </Txt>
            </Row>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
