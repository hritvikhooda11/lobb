import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Divider, ItemBadge, Pill, Row, Txt, tap } from '@/components/ui';
import { getItem } from '@/data/catalog';
import { money, priceFor } from '@/data/pricing';
import { useStore } from '@/store/app-store';
import { radius, space, useTheme } from '@/theme';

export default function ConfirmRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, actions } = useStore();
  const [note, setNote] = useState('My door');
  const item = getItem(id);
  if (!item) return null;
  const price = priceFor(item);
  const hasLive = state.requests.some((r) => ['open', 'accepted', 'arriving'].includes(r.status));

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl }}>
      <Row gap={space.lg}>
        <ItemBadge item={item} size={84} />
        <View style={{ flex: 1, gap: 6 }}>
          <Txt variant="title">{item.name}</Txt>
          <Txt tone="muted">{item.size}</Txt>
        </View>
      </Row>
      <Row gap={space.sm} style={{ marginTop: space.lg, flexWrap: 'wrap' }}>
        <Pill label="🔒 Factory sealed" tone="success" />
        <Pill label={`● ${item.nearbyCount} in your building`} tone="accent" />
        <Pill label="⏱ ≤ 10 min" tone="primary" />
      </Row>

      <View style={{ marginTop: space.xl, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border }}>
        <PriceRow label="Item (store price)" value={money(price.item)} />
        <PriceRow label="Your neighbor earns" value={money(price.deliverer)} tone="success" />
        <PriceRow label="Knock fee" value={money(price.platform)} />
        <Divider />
        <PriceRow label="Total" value={money(price.total)} bold />
        <Txt variant="caption" tone="muted" style={{ marginTop: space.sm }}>
          Prices are set by Knock from retail prices. You're only charged once a neighbor accepts.
        </Txt>
      </View>

      <Txt variant="label" style={{ marginTop: space.xl, marginBottom: space.sm }}>
        Meet at
      </Txt>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Unit 1204, or lobby"
        placeholderTextColor={colors.textMuted}
        style={{ height: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, color: colors.text, fontSize: 16 }}
      />

      <Button
        label={hasLive ? 'Finish your current request first' : `Knock · ${money(price.total)}`}
        icon={hasLive ? undefined : '✊'}
        disabled={hasLive}
        style={{ marginTop: space.xl }}
        onPress={() => {
          tap('success');
          const requestId = actions.createRequest(item.id, note.trim() || 'My door');
          router.dismiss();
          router.push({ pathname: '/request/[id]', params: { id: requestId } });
        }}
      />
    </ScrollView>
  );
}

function PriceRow({ label, value, tone, bold }: { label: string; value: string; tone?: 'success'; bold?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Txt tone={bold ? 'default' : 'muted'} variant={bold ? 'heading' : 'body'}>
        {label}
      </Txt>
      <Txt tone={tone ?? 'default'} variant={bold ? 'heading' : 'body'}>
        {value}
      </Txt>
    </Row>
  );
}
