import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, categoryIcon, Icon, Row, Txt, tap } from '@/components/ui';
import { canRent, shoutoutCategories, type CategoryId, type ItemKind } from '@/data/catalog';
import { FULFILLMENT, FULFILLMENT_ORDER, money, SHOUTOUT_MAX, SHOUTOUT_MIN, shoutoutPayout, type Fulfillment } from '@/data/pricing';
import { attempt } from '@/lib/alert';
import { useStore } from '@/store/app-store';
import { categoryTint, fonts, radius, space, useTheme } from '@/theme';

const STEP = 50;

/** Post a shout-out: "Anyone have a plunger? I'll pay $3." */
export default function NewShoutout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { actions } = useStore();
  const params = useLocalSearchParams<{ text?: string }>();
  const [text, setText] = useState(params.text ?? '');
  const [kind, setKind] = useState<ItemKind>('buy');
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [offer, setOffer] = useState(300);
  const [fulfillment, setFulfillment] = useState<Fulfillment>('lobby');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const cats = shoutoutCategories.filter((c) => (kind === 'rent' ? canRent(c.id) : true));
  const ready = text.trim().length >= 2 && category && !busy;
  const step = (d: number) => {
    const next = Math.max(SHOUTOUT_MIN, Math.min(SHOUTOUT_MAX, offer + d));
    if (next !== offer) {
      tap();
      setOffer(next);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="title">Shout it out</Txt>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Txt variant="label" tone="muted">
            Cancel
          </Txt>
        </Pressable>
      </Row>
      <Txt tone="muted">Can’t find it on Lobb? Neighbors with alerts on get a notification. The first one who has it brings it over.</Txt>

      <View style={{ gap: space.sm }}>
        <Txt variant="label">What do you need?</Txt>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="e.g. Plunger, packing tape, HDMI adapter"
          placeholderTextColor={colors.textMuted}
          maxLength={60}
          autoFocus={!params.text}
          style={{ height: 52, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, color: colors.text, fontSize: 17 }}
        />
      </View>

      <Row gap={4} style={{ backgroundColor: colors.surfaceHigh, borderRadius: radius.pill, padding: 4 }}>
        {(['buy', 'rent'] as const).map((k) => {
          const active = k === kind;
          return (
            <Pressable
              key={k}
              onPress={() => {
                tap();
                setKind(k);
                if (category && k === 'rent' && !canRent(category)) setCategory(null);
              }}
              style={{ flex: 1, height: 40, borderRadius: radius.pill, backgroundColor: active ? colors.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              <Txt variant="label" style={{ color: active ? colors.onPrimary : colors.textMuted }}>
                {k === 'buy' ? 'Buy one' : 'Borrow one'}
              </Txt>
            </Pressable>
          );
        })}
      </Row>

      <View style={{ gap: space.sm }}>
        <Txt variant="label">Category</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {cats.map((c) => {
            const active = c.id === category;
            return (
              <Pressable
                key={c.id}
                onPress={() => {
                  tap();
                  setCategory(c.id);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: radius.pill, backgroundColor: active ? colors.primarySoft : colors.surface, borderWidth: 1, borderColor: active ? colors.primary : colors.border }}>
                <Icon name={categoryIcon[c.id]} size={16} color={active ? colors.primary : categoryTint[c.id]} />
                <Txt variant="label" tone={active ? 'primary' : 'default'}>
                  {c.label}
                </Txt>
              </Pressable>
            );
          })}
        </View>
        {kind === 'rent' ? (
          <Txt variant="caption" tone="muted">
            Borrowing is for non-food items, for 1 day.
          </Txt>
        ) : null}
      </View>

      <View style={{ gap: space.sm }}>
        <Txt variant="label">{kind === 'rent' ? 'You’ll pay to borrow it' : 'You’ll pay (all-in)'}</Txt>
        <Row style={{ justifyContent: 'space-between' }}>
          <StepButton label="−" disabled={offer <= SHOUTOUT_MIN} onPress={() => step(-STEP)} />
          <View style={{ alignItems: 'center' }}>
            <Txt style={{ fontFamily: fonts.display, fontSize: 34, lineHeight: 40 }}>{money(offer)}</Txt>
            <Txt variant="caption" tone="muted">
              your neighbor gets {money(shoutoutPayout(offer))}
            </Txt>
          </View>
          <StepButton label="+" disabled={offer >= SHOUTOUT_MAX} onPress={() => step(STEP)} />
        </Row>
      </View>

      <View style={{ gap: space.sm }}>
        <Txt variant="label">How do you want it?</Txt>
        <Row gap={space.sm}>
          {FULFILLMENT_ORDER.map((f) => {
            const active = f === fulfillment;
            return (
              <Pressable
                key={f}
                onPress={() => {
                  tap();
                  setFulfillment(f);
                }}
                style={{ flex: 1, alignItems: 'center', gap: 4, paddingVertical: space.md, borderRadius: radius.md, backgroundColor: active ? colors.primarySoft : colors.surface, borderWidth: 1.5, borderColor: active ? colors.primary : colors.border }}>
                <Icon name={FULFILLMENT[f].icon} size={20} color={active ? colors.primary : colors.textMuted} />
                <Txt variant="caption" tone={active ? 'primary' : 'default'}>
                  {FULFILLMENT[f].short}
                </Txt>
              </Pressable>
            );
          })}
        </Row>
      </View>

      <View style={{ gap: space.sm }}>
        <Txt variant="label">Note (optional)</Txt>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. any size is fine"
          placeholderTextColor={colors.textMuted}
          maxLength={120}
          style={{ height: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, color: colors.text, fontSize: 16 }}
        />
      </View>

      <Button
        label={busy ? 'Shouting…' : `Shout it out · ${money(offer)}`}
        icon="megaphone"
        disabled={!ready}
        onPress={async () => {
          setBusy(true);
          const ok = await attempt(() => actions.createShoutout({ text: text.trim(), kind, category: category!, offer, fulfillment, note: note.trim() }));
          setBusy(false);
          if (!ok) return;
          tap('success');
          router.replace('/shoutouts');
        }}
      />
      <Txt variant="caption" tone="muted" center>
        You’re only charged if a neighbor brings it. Shout-outs expire after 2 hours. No alcohol, tobacco, vapes or medication.
      </Txt>
    </ScrollView>
  );
}

function StepButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 26, lineHeight: 30 }}>{label}</Txt>
    </Pressable>
  );
}
