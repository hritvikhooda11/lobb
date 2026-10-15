import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Divider, ItemPhoto, Pill, Row, Txt, tap } from '@/components/ui';
import { money, priceFor, rentalDurations, rentalPriceFor } from '@/data/pricing';
import { attempt } from '@/lib/alert';
import { LIVE_STATUSES, useItem, useStore } from '@/store/app-store';
import { radius, space, useTheme } from '@/theme';

export default function ConfirmRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, actions } = useStore();
  const [note, setNote] = useState('My door');
  const [durationId, setDurationId] = useState(rentalDurations[1].id);
  const [busy, setBusy] = useState(false);
  const item = useItem(id);
  if (!item) return null;

  const rent = item.kind === 'rent';
  const duration = rentalDurations.find((d) => d.id === durationId)!;
  const price = priceFor(item);
  const rental = rentalPriceFor(item, duration);
  const total = rent ? rental.total : price.total;
  const hasLive = state.requests.some((r) => LIVE_STATUSES.includes(r.status));

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl }}>
      <ItemPhoto item={item} height={200} radius={radius.lg} />
      <View style={{ marginTop: space.lg, gap: 4 }}>
        <Txt variant="title">{item.name}</Txt>
        <Txt tone="muted">{item.size}</Txt>
      </View>
      <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
        {rent ? <Pill label="🔁 Borrow & return" tone="warning" /> : <Pill label="🔒 Factory sealed" tone="success" />}
        <Pill label={`● ${item.nearbyCount} in your building`} tone="accent" />
        <Pill label="⏱ ≤ 10 min" tone="primary" />
      </Row>

      {rent ? (
        <View style={{ marginTop: space.xl, gap: space.sm }}>
          <Txt variant="label">How long?</Txt>
          <Row gap={space.sm}>
            {rentalDurations.map((d) => {
              const active = d.id === durationId;
              return (
                <Pressable
                  key={d.id}
                  onPress={() => {
                    tap();
                    setDurationId(d.id);
                  }}
                  style={{ flex: 1, paddingVertical: space.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: active ? colors.primarySoft : colors.surface, borderWidth: 1.5, borderColor: active ? colors.primary : colors.border }}>
                  <Txt variant="label" tone={active ? 'primary' : 'default'}>
                    {d.label}
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    {money(rentalPriceFor(item, d).rent)}
                  </Txt>
                </Pressable>
              );
            })}
          </Row>
        </View>
      ) : null}

      <View style={{ marginTop: space.xl, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border }}>
        {rent ? (
          <>
            <PriceRow label={`Rent · ${duration.label}`} value={money(rental.rent)} tone="success" />
            <PriceRow label="Lobb fee" value={money(rental.platform)} />
          </>
        ) : (
          <>
            <PriceRow label="Item (store price)" value={money(price.item)} />
            <PriceRow label="Your neighbor earns" value={money(price.deliverer)} tone="success" />
            <PriceRow label="Lobb fee" value={money(price.platform)} />
          </>
        )}
        <Divider />
        <PriceRow label="Total" value={money(total)} bold />
        <Txt variant="caption" tone="muted" style={{ marginTop: space.sm }}>
          {rent
            ? `We place a ${money(rental.hold)} hold on your card while you have it. It's released as soon as you return it.`
            : 'Prices are set by Lobb from retail prices. You’re only charged once a neighbor accepts.'}
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
        label={hasLive ? 'Finish your current request first' : `${rent ? 'Borrow it' : 'Lobb it'} · ${money(total)}`}
        icon={hasLive ? undefined : rent ? '🔁' : '🙌'}
        disabled={hasLive || busy}
        style={{ marginTop: space.xl }}
        onPress={async () => {
          setBusy(true);
          let requestId = '';
          const ok = await attempt(async () => {
            requestId = await actions.createRequest(item, note.trim() || 'My door', rent ? durationId : undefined);
          });
          setBusy(false);
          if (!ok) return;
          tap('success');
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
