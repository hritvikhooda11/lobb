import { router } from 'expo-router';
import { Pressable, Switch, View } from 'react-native';

import { Button, Card, Divider, Icon, Pill, Row, Screen, SectionHeader, Txt, tap } from '@/components/ui';
import { attempt, confirm } from '@/lib/alert';
import { communities } from '@/data/catalog';
import { ratingLabel, useStore } from '@/store/app-store';
import { space, useTheme } from '@/theme';

const DEMO_TOOLS = __DEV__ && process.env.EXPO_PUBLIC_DEMO_LOGIN === '1';

export default function Profile() {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const user = state.profile!;
  const community = communities.find((c) => c.id === user.communityId);
  const delivered = state.wallet.filter((w) => w.kind === 'earn').length;

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginTop: space.lg, gap: space.sm }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Txt variant="hero" tone="onPrimary">
            {user.name[0]}
          </Txt>
        </View>
        <Txt variant="title">{user.name}</Txt>
        <Row gap={space.sm}>
          <Pill icon="checkmark-circle" label="UW verified" tone="success" />
          <Pill icon="location" label={community?.name ?? ''} tone="primary" />
        </Row>
        {user.isAdmin ? (
          <Pill icon="shield-checkmark" label="Lobb admin · verified seller" tone="accent" />
        ) : user.isSeller ? (
          <Pill icon="storefront" label="Wholesale seller" tone="accent" />
        ) : null}
      </View>

      <Row style={{ marginTop: space.xl }} gap={space.md}>
        <Stat label={user.ratingCount ? `Rating (${user.ratingCount})` : 'Rating'} value={ratingLabel(user)} />
        <Stat label="Reliability" value={`${user.reliability}%`} />
        <Stat label="Deliveries" value={String(delivered)} />
      </Row>

      <SellerSection />

      <SectionHeader title="Settings" />
      <Card>
        <SettingRow label="Email" value={state.email ?? ''} />
        <Divider />
        <SettingRow label="Room" value={user.room ?? ''} />
        <Divider />
        <SettingRow label="Payment method" value="Add card" />
        <Divider />
        <SettingRow label="Payout account" value="Connect bank" />
        <Divider />
        <SettingRow label="Age" value={user.age !== null ? (user.age >= 21 ? '21+ confirmed' : 'Under 21') : 'Not confirmed'} />
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Txt>Shout-out alerts</Txt>
            <Txt variant="caption" tone="muted">
              Get a notification when a neighbor needs something
            </Txt>
          </View>
          <Switch
            value={user.notifyShoutouts}
            onValueChange={(on) => void attempt(() => actions.setNotifyShoutouts(on))}
            trackColor={{ true: colors.accent, false: colors.surfaceHigh }}
            thumbColor="#fff"
          />
        </Row>
      </Card>

      <SectionHeader title="Help" />
      <Card onPress={() => router.push('/report')}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt>Report a problem</Txt>
          <Icon name="chevron-forward" size={18} tone="muted" />
        </Row>
      </Card>
      <Txt variant="caption" tone="muted" style={{ marginTop: space.md }}>
        Lobb only sells factory-sealed, shelf-stable items and rents non-food items. Alcohol is 21+ only, sold by Lobb-verified sellers who check ID at the door. No tobacco, vapes, or medication.
      </Txt>

      {DEMO_TOOLS ? (
        <>
          <SectionHeader title="Demo tools" subtitle="Only on your dev server" />
          <Button
            label="Reset demo"
            icon="refresh"
            kind="ghost"
            onPress={async () => {
              if (!(await confirm('Reset demo?', 'Clears this account’s requests, deliveries and listings so you can run the demo again.', 'Reset'))) return;
              if (await attempt(() => actions.resetDemo())) router.replace('/');
            }}
          />
        </>
      ) : null}

      <Button label="Sign out" icon="log-out-outline" kind="danger" onPress={actions.signOut} style={{ marginTop: space.md }} />
    </Screen>
  );
}

/** Wholesale sellers stock items in their room for Lobb: a small link to quick stock, or to enter a seller code. */
function SellerSection() {
  const { state } = useStore();
  const user = state.profile!;
  const stocked = state.listings.filter((l) => l.active && l.quantity > 0).reduce((n, l) => n + l.quantity, 0);
  return (
    <Pressable
      onPress={() => {
        tap();
        router.push(user.isSeller ? '/stock' : '/seller-code');
      }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: space.lg, paddingVertical: 6, paddingHorizontal: 12, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={user.isSeller ? 'cube-outline' : 'storefront-outline'} size={16} tone="primary" />
      <Txt variant="label" tone="primary">
        {user.isSeller ? `Quick stock${stocked ? ` · ${stocked} in stock` : ''}` : 'Wholesale seller? Enter your code'}
      </Txt>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1, alignItems: 'center', paddingVertical: space.md }}>
      <Txt variant="heading">{value}</Txt>
      <Txt variant="caption" tone="muted">
        {label}
      </Txt>
    </Card>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Txt>{label}</Txt>
      <Txt tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        {value}
      </Txt>
    </Row>
  );
}
