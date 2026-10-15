import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';

import { Button, Card, Divider, Icon, Row, Screen, SectionHeader, StateBadge, Txt } from '@/components/ui';
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
  // Earned = money from selling and lending; spent = what you paid as a buyer or renter.
  const earned = state.wallet.filter((w) => w.kind === 'earn').reduce((s, w) => s + w.amount, 0);
  const spent = state.wallet.filter((w) => w.kind === 'spend').reduce((s, w) => s - w.amount, 0);

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
          {money(earned)}
        </Txt>
        <Row style={{ marginTop: space.lg }}>
          <Button label="Cash out" kind="accent" icon="cash" onPress={() => {}} style={{ flex: 1, height: 48 }} />
        </Row>
        <Txt variant="caption" tone="onPrimary" style={{ opacity: 0.7, marginTop: space.sm }}>
          Payouts go to your bank via Stripe. Coming soon.
        </Txt>
      </LinearGradient>

      <Row style={{ marginTop: space.md }} gap={space.md}>
        <Card style={{ flex: 1 }}>
          <Row gap={6}>
            <Icon name="arrow-down-circle" size={16} tone="success" />
            <Txt variant="caption" tone="muted">
              Earned
            </Txt>
          </Row>
          <Txt variant="heading" tone="success">
            {money(earned)}
          </Txt>
        </Card>
        <Card style={{ flex: 1 }}>
          <Row gap={6}>
            <Icon name="arrow-up-circle" size={16} tone="danger" />
            <Txt variant="caption" tone="muted">
              Spent
            </Txt>
          </Row>
          <Txt variant="heading">{money(spent)}</Txt>
        </Card>
      </Row>

      <SectionHeader title="History" subtitle="Everything you bought, rented, sold and lent" />
      {state.wallet.length === 0 ? (
        <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xl }}>
          <StateBadge icon="receipt" tone="muted" size={72} />
          <Txt tone="muted" center>
            Nothing yet. Your first order or sale will show up here.
          </Txt>
        </View>
      ) : (
        <Card>
          {state.wallet.map((w, i) => (
            <View key={w.id}>
              {i > 0 ? <Divider /> : null}
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ flex: 1 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: w.kind === 'earn' ? colors.successSoft : colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={w.kind === 'earn' ? 'arrow-down' : 'arrow-up'} size={18} color={w.kind === 'earn' ? colors.success : colors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt variant="label" numberOfLines={1}>
                      {w.label}
                    </Txt>
                    <Txt variant="caption" tone="muted">
                      {when(w.at)}
                    </Txt>
                  </View>
                </Row>
                <Txt variant="label" tone={w.kind === 'earn' ? 'success' : 'default'}>
                  {w.amount > 0 ? '+' : '−'}
                  {money(Math.abs(w.amount))}
                </Txt>
              </Row>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
