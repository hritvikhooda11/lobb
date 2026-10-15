import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Divider, Icon, ItemPhoto, Pill, Row, Txt, tap } from '@/components/ui';
import { FULFILLMENT, FULFILLMENT_ORDER, money, priceFor, rentalDurations, rentalPriceFor, type Fulfillment } from '@/data/pricing';
import { attempt } from '@/lib/alert';
import { LIVE_STATUSES, useItem, useStore } from '@/store/app-store';
import { radius, space, useTheme } from '@/theme';

export default function ConfirmRequest() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, actions } = useStore();
  const [note, setNote] = useState('');
  const [fulfillment, setFulfillment] = useState<Fulfillment>('lobby');
  const [durationId, setDurationId] = useState(rentalDurations[1].id);
  const [busy, setBusy] = useState(false);
  const item = useItem(id);
  if (!item) return null;

  const rent = item.kind === 'rent';
  const duration = rentalDurations.find((d) => d.id === durationId)!;
  const price = priceFor(item, 0, fulfillment);
  const rental = rentalPriceFor(item, duration, 0, fulfillment);
  const total = rent ? rental.total : price.total;
  const adjust = rent ? rental.fulfillment : price.fulfillment;
  const totalFor = (f: Fulfillment) => (rent ? rentalPriceFor(item, duration, 0, f).total : priceFor(item, 0, f).total);
  const baseTotal = totalFor('lobby');
  const hasLive = state.requests.some((r) => LIVE_STATUSES.includes(r.status));
  const soldOut = item.nearbyCount === 0;
  const myRoom = state.profile?.room;

  const optionInfo: Record<Fulfillment, string> = {
    dropoff: myRoom ? `A neighbor brings it to Room ${myRoom}` : 'A neighbor brings it to your door',
    lobby: 'Meet a neighbor in the lobby',
    pickup: 'You go to their room (we’ll tell you which once they accept)',
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xl }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <ItemPhoto item={item} height={200} radius={radius.lg} />
      <View style={{ marginTop: space.lg, gap: 4 }}>
        <Txt variant="title">{item.name}</Txt>
        <Txt tone="muted">{item.size}</Txt>
      </View>
      <Row gap={space.sm} style={{ marginTop: space.md, flexWrap: 'wrap' }}>
        {rent ? <Pill icon="repeat" label="Borrow & return" tone="warning" /> : <Pill icon="lock-closed" label="Factory sealed" tone="success" />}
        <Pill icon="people" label={`${item.nearbyCount} in your building`} tone="accent" />
        <Pill icon="time" label="≤ 10 min" tone="primary" />
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

      <View style={{ marginTop: space.xl, gap: space.sm }}>
        <Txt variant="label">How do you want it?</Txt>
        {FULFILLMENT_ORDER.map((f) => {
          const active = f === fulfillment;
          const option = FULFILLMENT[f];
          const diff = totalFor(f) - baseTotal;
          return (
            <Pressable
              key={f}
              onPress={() => {
                tap();
                setFulfillment(f);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: active ? colors.primarySoft : colors.surface,
                borderWidth: 1.5,
                borderColor: active ? colors.primary : colors.border,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              })}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: active ? colors.primary : colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={option.icon} size={20} color={active ? colors.onPrimary : colors.textMuted} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt variant="label" tone={active ? 'primary' : 'default'}>
                  {option.label}
                </Txt>
                <Txt variant="caption" tone="muted">
                  {optionInfo[f]}
                </Txt>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Txt variant="label">{money(totalFor(f))}</Txt>
                <Txt variant="caption" tone={diff < 0 ? 'success' : diff > 0 ? 'warning' : 'muted'}>
                  {diff === 0 ? 'Base price' : diff < 0 ? `Save ${money(-diff)}` : `+${money(diff)}`}
                </Txt>
              </View>
            </Pressable>
          );
        })}
      </View>

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
        {adjust !== 0 ? <PriceRow label={adjust > 0 ? `${FULFILLMENT[fulfillment].label} (+${FULFILLMENT[fulfillment].pct}%)` : `Pickup discount (${FULFILLMENT[fulfillment].pct}%)`} value={`${adjust > 0 ? '+' : '−'}${money(Math.abs(adjust))}`} tone={adjust < 0 ? 'success' : undefined} /> : null}
        <Divider />
        <PriceRow label="Total" value={money(total)} bold />
        <Txt variant="caption" tone="muted" style={{ marginTop: space.sm }}>
          {rent
            ? `We place a ${money(rental.hold)} hold on your card while you have it. It's released as soon as you return it.`
            : 'Prices are set by Lobb from retail prices. You’re only charged once a neighbor accepts.'}
        </Txt>
      </View>

      <Txt variant="label" style={{ marginTop: space.xl, marginBottom: space.sm }}>
        Note for your neighbor (optional)
      </Txt>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="e.g. knock twice"
        placeholderTextColor={colors.textMuted}
        maxLength={80}
        returnKeyType="done"
        style={{ height: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, color: colors.text, fontSize: 16 }}
      />

      <Button
        label={soldOut ? 'No one has this right now' : hasLive ? 'Finish your current request first' : `${rent ? 'Borrow it' : 'Lobb it'} · ${money(total)}`}
        icon={soldOut || hasLive ? undefined : rent ? 'repeat' : 'flash'}
        disabled={hasLive || busy || soldOut}
        style={{ marginTop: space.xl }}
        onPress={async () => {
          setBusy(true);
          let requestId = '';
          const ok = await attempt(async () => {
            requestId = await actions.createRequest(item, note.trim(), fulfillment, rent ? durationId : undefined);
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
      <Txt tone={bold ? 'default' : 'muted'} variant={bold ? 'heading' : 'body'} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      <Txt tone={tone ?? 'default'} variant={bold ? 'heading' : 'body'}>
        {value}
      </Txt>
    </Row>
  );
}
