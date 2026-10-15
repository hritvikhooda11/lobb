import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { CountdownRing, DemoControls } from '@/components/live';
import { Button, Card, ItemBadge, Pill, Row, Screen, Txt, tap } from '@/components/ui';
import { getItem } from '@/data/catalog';
import { money } from '@/data/pricing';
import { DELIVERY_WINDOW_MS, useNow, useStore } from '@/store/app-store';
import { fonts, space, useTheme } from '@/theme';

const goHome = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * Deliverer flow: accept → seal verification (barcode + photo) → walk over → scan buyer QR → paid.
 * Barcode/photo/QR scanning are mocked; production uses expo-camera's barcode scanner.
 */
export default function Deliver() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const job = state.jobs.find((j) => j.id === id);
  const now = useNow(job?.status !== 'delivered');
  if (!job) return null;
  const item = getItem(job.itemId)!;
  const remaining = (job.acceptedAt ?? now) + DELIVERY_WINDOW_MS - now;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={goHome} hitSlop={12}>
          <Txt variant="label" tone="primary">
            ‹ Home
          </Txt>
        </Pressable>
        <Pill label={`You earn ${money(job.earnings)}`} tone="success" />
      </Row>

      <Row style={{ marginTop: space.lg }}>
        <ItemBadge item={item} size={44} />
        <View style={{ flex: 1 }}>
          <Txt variant="heading">
            {item.name} for {job.buyerName}
          </Txt>
          <Txt variant="caption" tone="muted">
            {job.location}
          </Txt>
        </View>
      </Row>

      {job.status !== 'delivered' ? (
        <View style={{ alignItems: 'center', marginTop: space.xl }}>
          <CountdownRing remainingMs={remaining} totalMs={DELIVERY_WINDOW_MS} size={160} caption="to deliver" />
        </View>
      ) : null}

      {job.status === 'accepted' ? <SealCheck barcode={item.barcode} onDone={() => actions.markSealVerified(job.id)} /> : null}

      {job.status === 'verified' ? (
        <View style={{ marginTop: space.xl, gap: space.md }}>
          <Txt variant="title">Head to {job.buyerName}</Txt>
          <Card>
            <Txt variant="label">📍 {job.location}</Txt>
            <Txt variant="caption" tone="muted" style={{ marginTop: 4 }}>
              When you arrive, {job.buyerName} will show a QR code. Scan it to get paid.
            </Txt>
          </Card>
          <ScanStep label={`Scan ${job.buyerName}'s QR`} doneLabel="Handoff confirmed" onDone={() => actions.completeJob(job.id)} />
        </View>
      ) : null}

      {job.status === 'delivered' ? (
        <View style={{ alignItems: 'center', marginTop: space.xxxl, gap: space.lg }}>
          <Txt style={{ fontSize: 72, lineHeight: 86 }}>💸</Txt>
          <Txt variant="hero" tone="success">
            +{money(job.earnings)}
          </Txt>
          <Txt tone="muted" center>
            Added to your wallet. Nice hustle.
          </Txt>
          <Button label="Back to requests" kind="accent" onPress={goHome} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}

      {__DEV__ && job.status === 'accepted' ? <DemoControls label="Skip seal check" onPress={() => actions.markSealVerified(job.id)} /> : null}
    </Screen>
  );
}

function SealCheck({ barcode, onDone }: { barcode: string; onDone: () => void }) {
  const [scanned, setScanned] = useState(false);
  const [photo, setPhoto] = useState(false);
  return (
    <View style={{ marginTop: space.xl, gap: space.md }}>
      <Txt variant="title">Verify the seal</Txt>
      <Txt tone="muted">Required before every delivery. Keeps everyone safe.</Txt>
      <ScanStep label="1. Scan the barcode" doneLabel={`Barcode matches · ${barcode}`} onDone={() => setScanned(true)} />
      <ScanStep label="2. Photo of the intact seal" doneLabel="Seal photo saved" icon="📸" disabled={!scanned} onDone={() => setPhoto(true)} />
      <Button label="I'm heading out" icon="🏃" kind="accent" disabled={!scanned || !photo} onPress={onDone} style={{ marginTop: space.sm }} />
    </View>
  );
}

/** A mocked camera step: tap → brief "scanning" state → done. */
function ScanStep({ label, doneLabel, onDone, icon = '📷', disabled }: { label: string; doneLabel: string; onDone: () => void; icon?: string; disabled?: boolean }) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'done'>('idle');
  const done = phase === 'done';
  return (
    <Card
      highlight={done}
      style={[{ opacity: disabled ? 0.45 : 1 }, done && { backgroundColor: colors.successSoft, borderColor: colors.success }]}
      onPress={
        disabled || phase !== 'idle'
          ? undefined
          : () => {
              setPhase('scanning');
              setTimeout(() => {
                tap('success');
                setPhase('done');
                onDone();
              }, 1100);
            }
      }>
      <Row>
        <Txt style={{ fontSize: 26 }}>{done ? '✅' : icon}</Txt>
        <Txt style={{ flex: 1, fontFamily: fonts.displayMedium, fontSize: 16, color: done ? colors.success : colors.text }}>{done ? doneLabel : label}</Txt>
        {phase === 'scanning' ? <ActivityIndicator color={colors.primary} /> : null}
      </Row>
    </Card>
  );
}
