import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { CountdownRing, DemoControls } from '@/components/live';
import { Button, Card, ItemBadge, Pill, Row, Screen, Txt, tap } from '@/components/ui';
import { money } from '@/data/pricing';
import { takePhoto } from '@/lib/photo';
import { DELIVERY_WINDOW_MS, useItem, useNow, useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

const goHome = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * Deliverer flow: accept → verify (sale: barcode + seal photo; rental: condition photo)
 * → walk over → scan buyer QR → quick handoff photo → paid.
 * Barcode and QR scanning are mocked; production uses expo-camera's barcode scanner.
 */
export default function Deliver() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, actions } = useStore();
  const job = state.jobs.find((j) => j.id === id);
  const item = useItem(job?.itemId);
  const now = useNow(job?.status !== 'delivered');
  const [qrScanned, setQrScanned] = useState(false);
  if (!job || !item) return null;
  const rent = job.kind === 'rent';
  const remaining = (job.acceptedAt ?? now) + DELIVERY_WINDOW_MS - now;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={goHome} hitSlop={12}>
          <Txt variant="label" tone="primary">
            ‹ Home
          </Txt>
        </Pressable>
        <Pill label={`You get ${money(job.earnings)}`} tone="success" />
      </Row>

      <Row style={{ marginTop: space.lg }}>
        <ItemBadge item={item} size={44} />
        <View style={{ flex: 1 }}>
          <Txt variant="heading">
            {item.name} {rent ? 'to' : 'for'} {job.buyerName}
          </Txt>
          <Txt variant="caption" tone="muted">
            {job.location}
            {rent ? ` · ${job.rentalLabel} rental` : ''}
          </Txt>
        </View>
      </Row>

      {job.status !== 'delivered' ? (
        <View style={{ alignItems: 'center', marginTop: space.xl }}>
          <CountdownRing remainingMs={remaining} totalMs={DELIVERY_WINDOW_MS} size={160} caption="to hand it over" />
        </View>
      ) : null}

      {job.status === 'accepted' ? (
        rent ? <ConditionCheck onDone={() => actions.markVerified(job.id)} /> : <SealCheck barcode={item.barcode} onDone={() => actions.markVerified(job.id)} />
      ) : null}

      {job.status === 'verified' ? (
        <View style={{ marginTop: space.xl, gap: space.md }}>
          <Txt variant="title">Head to {job.buyerName}</Txt>
          <Card>
            <Txt variant="label">📍 {job.location}</Txt>
            <Txt variant="caption" tone="muted" style={{ marginTop: 4 }}>
              {job.buyerName} will show a QR code. Scan it, then snap a quick photo of the handoff.
            </Txt>
          </Card>
          <ScanStep label={`1. Scan ${job.buyerName}'s QR`} doneLabel="QR confirmed" onDone={() => setQrScanned(true)} />
          <PhotoStep
            label="2. Quick photo of the handoff"
            hint={`${item.name} in ${job.buyerName}'s hands, or at the door`}
            disabled={!qrScanned}
            onDone={(uri) => actions.completeJob(job.id, uri)}
          />
        </View>
      ) : null}

      {job.status === 'delivered' ? (
        <View style={{ alignItems: 'center', marginTop: space.xxxl, gap: space.lg }}>
          <Txt style={{ fontSize: 72, lineHeight: 86 }}>💸</Txt>
          <Txt variant="hero" tone="success">
            +{money(job.earnings)}
          </Txt>
          <Txt tone="muted" center>
            {rent ? `Added to your wallet. ${job.buyerName} returns it in ${job.rentalLabel}.` : 'Added to your wallet. Nice hustle.'}
          </Txt>
          {job.handoffPhotoUri ? (
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Image source={{ uri: job.handoffPhotoUri }} style={{ width: 120, height: 120, borderRadius: radius.md }} contentFit="cover" />
              <Txt variant="caption" tone="muted">
                Handoff photo saved
              </Txt>
            </View>
          ) : null}
          <Button label="Back to requests" kind="accent" onPress={goHome} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}

      {__DEV__ && job.status === 'accepted' ? <DemoControls label={rent ? 'Skip condition photo' : 'Skip seal check'} onPress={() => actions.markVerified(job.id)} /> : null}
    </Screen>
  );
}

function SealCheck({ barcode, onDone }: { barcode?: string; onDone: () => void }) {
  const [scanned, setScanned] = useState(false);
  const [photo, setPhoto] = useState(false);
  return (
    <View style={{ marginTop: space.xl, gap: space.md }}>
      <Txt variant="title">Verify the seal</Txt>
      <Txt tone="muted">Required before every delivery. Keeps everyone safe.</Txt>
      <ScanStep label="1. Scan the barcode" doneLabel={`Barcode matches${barcode ? ` · ${barcode}` : ''}`} onDone={() => setScanned(true)} />
      <PhotoStep label="2. Photo of the intact seal" hint="Show the factory seal clearly" disabled={!scanned} onDone={() => setPhoto(true)} />
      <Button label="I'm heading out" icon="🏃" kind="accent" disabled={!scanned || !photo} onPress={onDone} style={{ marginTop: space.sm }} />
    </View>
  );
}

function ConditionCheck({ onDone }: { onDone: () => void }) {
  const [photo, setPhoto] = useState(false);
  return (
    <View style={{ marginTop: space.xl, gap: space.md }}>
      <Txt variant="title">Snap its condition</Txt>
      <Txt tone="muted">A quick photo before you lend it protects you if it comes back damaged.</Txt>
      <PhotoStep label="Photo of the item" hint="Show any scratches or wear" onDone={() => setPhoto(true)} />
      <Button label="I'm heading out" icon="🏃" kind="accent" disabled={!photo} onPress={onDone} style={{ marginTop: space.sm }} />
    </View>
  );
}

/** A real camera step: opens the camera (or library on Simulator), shows a thumbnail when done. */
function PhotoStep({ label, hint, onDone, disabled }: { label: string; hint: string; onDone: (uri: string) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  return (
    <Card
      highlight={!!uri}
      style={[{ opacity: disabled ? 0.45 : 1 }, uri && { backgroundColor: colors.successSoft, borderColor: colors.success }]}
      onPress={
        disabled || uri
          ? undefined
          : async () => {
              const photo = await takePhoto();
              if (!photo) return;
              tap('success');
              setUri(photo.uri);
              onDone(photo.uri);
            }
      }>
      <Row>
        {uri ? <Image source={{ uri }} style={{ width: 40, height: 40, borderRadius: 8 }} contentFit="cover" /> : <Txt style={{ fontSize: 26 }}>📸</Txt>}
        <View style={{ flex: 1 }}>
          <Txt style={{ fontFamily: fonts.displayMedium, fontSize: 16, color: uri ? colors.success : colors.text }}>{uri ? 'Photo saved' : label}</Txt>
          {!uri ? (
            <Txt variant="caption" tone="muted">
              {hint}
            </Txt>
          ) : null}
        </View>
      </Row>
    </Card>
  );
}

/** A mocked scanner step: tap → brief "scanning" state → done. */
function ScanStep({ label, doneLabel, onDone, disabled }: { label: string; doneLabel: string; onDone: () => void; disabled?: boolean }) {
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
        <Txt style={{ fontSize: 26 }}>{done ? '✅' : '📷'}</Txt>
        <Txt style={{ flex: 1, fontFamily: fonts.displayMedium, fontSize: 16, color: done ? colors.success : colors.text }}>{done ? doneLabel : label}</Txt>
        {phase === 'scanning' ? <ActivityIndicator color={colors.primary} /> : null}
      </Row>
    </Card>
  );
}
