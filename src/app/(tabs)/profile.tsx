import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, Divider, Pill, Row, Screen, SectionHeader, Txt } from '@/components/ui';
import { communities } from '@/data/catalog';
import { useStore } from '@/store/app-store';
import { space, useTheme } from '@/theme';

export default function Profile() {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const user = state.user!;
  const community = communities.find((c) => c.id === user.communityId);
  const delivered = state.jobs.filter((j) => j.status === 'delivered').length + state.wallet.length;

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
          <Pill label="✓ UW verified" tone="success" />
          <Pill label={`📍 ${community?.name}`} tone="primary" />
        </Row>
      </View>

      <Row style={{ marginTop: space.xl }} gap={space.md}>
        <Stat label="Rating" value="★ 4.9" />
        <Stat label="Reliability" value="98%" />
        <Stat label="Deliveries" value={String(delivered)} />
      </Row>

      <SectionHeader title="Settings" />
      <Card>
        <SettingRow label="Email" value={user.email} />
        <Divider />
        <SettingRow label="Payment method" value="Add card" />
        <Divider />
        <SettingRow label="Payout account" value="Connect bank" />
        <Divider />
        <SettingRow label="Notifications" value="On" />
      </Card>

      <SectionHeader title="Help" />
      <Card onPress={() => router.push('/report')}>
        <SettingRow label="Report a problem" value="→" />
      </Card>
      <Txt variant="caption" tone="muted" style={{ marginTop: space.md }}>
        Lobb only sells factory-sealed, shelf-stable items and rents non-food items. No alcohol, tobacco, vapes, or medication.
      </Txt>

      <Button label="Sign out" kind="ghost" onPress={actions.signOut} style={{ marginTop: space.xl }} />
    </Screen>
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
