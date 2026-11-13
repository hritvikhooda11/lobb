import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { ChatButton } from '@/components/chat-button';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { CountdownRing } from '@/components/live';
import { Button, Card, Icon, ItemBadge, Pill, Row, Screen, StateBadge, Txt, tap, type IconName } from '@/components/ui';
import { FULFILLMENT, money } from '@/data/pricing';
import { attempt, showError } from '@/lib/alert';
import { useAiPhotoConsent } from '@/lib/ai-consent';
import { identifyPhoto, matchesItem } from '@/lib/identify';
import { takePhoto, type Photo } from '@/lib/photo';
import { DELIVERY_WINDOW_MS, useItem, useNow, useStore, type Job } from '@/store/app-store';
import { fonts, space, useTheme } from '@/theme';

const goHome = () => (router.canGoBack() ? router.back() : router.replace('/'));
const sameBarcode = (a: string, b: string) => a.replace(/^0+/, '') === b.replace(/^0+/, '');

const formatDue = (ms: number) => {
  if (ms <= 0) return 'overdue';
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/**
 * Deliverer flow, all enforced by the database:
 * accept → verify (sale: barcode + seal photo; rental: condition photo) → at the door
 * → scan the buyer's QR → handoff photo → paid. Rentals end with scanning the return QR.
 */
export default function Deliver() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useStore();
  const job = state.jobs.find((j) => j.id === id);
  const item = useItem(job?.itemId);
  const live = !!job && ['accepted', 'verified', 'arrived'].includes(job.status);
  const now = useNow(live || job?.status === 'delivered');
  if (!job || !item) {
    return (
      <Screen>
        <Pressable onPress={goHome} hitSlop={12}>
          <Txt variant="label" tone="primary">
            ‹ Home
          </Txt>
        </Pressable>
        <Txt tone="muted" style={{ marginTop: space.xxl }} center>
          This request is no longer available.
        </Txt>
      </Screen>
    );
  }
  const rent = job.kind === 'rent';
  const remaining = (job.deadlineAt ?? (job.acceptedAt ?? now) + DELIVERY_WINDOW_MS) - now;

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Pressable onPress={goHome} hitSlop={12}>
          <Txt variant="label" tone="primary">
            ‹ Home
          </Txt>
        </Pressable>
        <Row gap={space.sm}>
          {job.buyer ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Report or block ${job.buyerName}`}
              hitSlop={8}
              onPress={() => router.push({ pathname: '/report', params: { type: 'request', id: job.id, user: job.buyer!.id, name: job.buyerName } })}>
              <Icon name="flag-outline" size={20} tone="muted" />
            </Pressable>
          ) : null}
          {job.status !== 'incoming' && job.status !== 'closed' && job.status !== 'returned' ? (
            <ChatButton thread={{ requestId: job.id }} label={`Message ${job.buyerName.split(' ')[0]}`} />
          ) : null}
          <Pill label={`You get ${money(job.earnings)}`} tone="success" />
        </Row>
      </Row>

      <Row style={{ marginTop: space.lg }}>
        <ItemBadge item={item} size={44} />
        <View style={{ flex: 1 }}>
          <Txt variant="heading">
            {item.name} {rent ? 'to' : 'for'} {job.buyerName}
          </Txt>
          <Txt variant="caption" tone="muted">
            {FULFILLMENT[job.fulfillment].label}
            {job.buyerRoom ? ` · Room ${job.buyerRoom}` : ''}
            {rent ? ` · ${job.rentalLabel} rental` : ''}
          </Txt>
        </View>
      </Row>

      {live ? (
        <View style={{ alignItems: 'center', marginTop: space.xl }}>
          <CountdownRing remainingMs={remaining} totalMs={DELIVERY_WINDOW_MS} size={160} caption="to hand it over" />
        </View>
      ) : null}

      {job.status === 'incoming' ? <AcceptPrompt job={job} /> : null}
      {job.status === 'accepted' ? rent ? <ConditionCheck jobId={job.id} /> : <SealCheck jobId={job.id} barcode={item.barcode} /> : null}
      {job.status === 'verified' || job.status === 'arrived' ? <Handoff job={job} /> : null}

      {job.status === 'delivered' ? (
        <View style={{ alignItems: 'center', marginTop: space.xxxl, gap: space.lg }}>
          <StateBadge icon="cash" tone="success" />
          <Txt variant="hero" tone="success">
            +{money(job.earnings)}
          </Txt>
          <Txt tone="muted" center>
            {rent && job.returnBy ? `Added to your wallet. ${job.buyerName} returns it in ${formatDue(job.returnBy - now)}.` : 'Added to your wallet. Nice hustle.'}
          </Txt>
          <RateBuyer job={job} />
          <Button label="Back to requests" kind="accent" onPress={goHome} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}

      {job.status === 'returning' ? <ReturnScan job={job} /> : null}

      {job.status === 'returned' ? (
        <View style={{ alignItems: 'center', marginTop: space.xxxl, gap: space.lg }}>
          <StateBadge icon="checkmark-done" tone="success" />
          <Txt variant="title" center>
            You got it back
          </Txt>
          <Button label="Back to requests" kind="accent" onPress={goHome} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : null}

      {job.status === 'closed' ? (
        <Txt tone="muted" style={{ marginTop: space.xxl }} center>
          This request was cancelled or expired.
        </Txt>
      ) : null}
    </Screen>
  );
}

function AcceptPrompt({ job }: { job: Job }) {
  const { actions } = useStore();
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ marginTop: space.xl, gap: space.md }}>
      <Txt tone="muted">First neighbor to accept gets it. You’ll have 10 minutes.</Txt>
      <Button
        label={busy ? 'Accepting…' : 'Accept · 10 min'}
        kind="accent"
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          await attempt(() => actions.acceptJob(job.id));
          setBusy(false);
        }}
      />
    </View>
  );
}

function SealCheck({ jobId, barcode }: { jobId: string; barcode?: string }) {
  const { state, actions } = useStore();
  const item = useItem(state.jobs.find((j) => j.id === jobId)?.itemId);
  const [scanned, setScanned] = useState(!barcode);
  const [checkedBy, setCheckedBy] = useState<'barcode' | 'photo' | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const allowAiPhotos = useAiPhotoConsent();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);

  /** Barcode won't scan: snap the label and let Lobb confirm it's the same product. */
  async function checkWithPhoto() {
    if (scannerOpen) {
      setScannerOpen(false);
      // Let the scanner finish closing before the camera opens (iOS won't stack them).
      await new Promise((r) => setTimeout(r, 600));
    }
    if (!(await allowAiPhotos())) {
      showError('Checking by photo uses AI, which you turned off. Scan the barcode instead.', 'Scan it');
      return;
    }
    const p = await takePhoto({ base64: true });
    if (!p?.base64 || !item) return;
    setChecking(true);
    try {
      const found = await identifyPhoto(p.base64);
      const match = matchesItem(found, item);
      if (match === 'no') {
        showError(`That looks like ${found.name}, not ${item.name}. Bring the item they asked for.`, 'Wrong item');
        return;
      }
      tap('success');
      setScanned(true);
      setCheckedBy('photo');
      // The label photo also works as the seal photo if they haven't taken one.
      setPhoto((prev) => prev ?? p);
    } catch (e) {
      showError(`${e instanceof Error ? e.message : 'Couldn’t check the photo.'} Try a clearer photo of the label, or scan the barcode.`, 'Couldn’t check it');
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={{ marginTop: space.xl, gap: space.md }}>
      <Txt variant="title">Verify the seal</Txt>
      <Txt tone="muted">Required before every delivery. Keeps everyone safe.</Txt>
      {barcode ? (
        <>
          <StepCard
            done={scanned}
            icon="barcode-outline"
            label="1. Scan the barcode"
            doneLabel={checkedBy === 'photo' ? 'Photo matches the item' : 'Barcode matches'}
            onPress={() => setScannerOpen(true)}
          />
          {!scanned ? (
            <Pressable onPress={checkWithPhoto} disabled={checking} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' }}>
              {checking ? <ActivityIndicator size="small" /> : <Icon name="camera-outline" size={16} tone="primary" />}
              <Txt variant="label" tone="primary">
                {checking ? 'Checking your photo…' : 'Won’t scan? Check it with a photo'}
              </Txt>
            </Pressable>
          ) : null}
        </>
      ) : (
        <Txt variant="caption" tone="muted">
          This item has no barcode on file, so just snap the seal.
        </Txt>
      )}
      <PhotoStep label={barcode ? '2. Photo of the intact seal' : 'Photo of the intact seal'} hint="Show the factory seal clearly" disabled={!scanned} photo={photo} onPhoto={setPhoto} />
      <Button
        label={busy ? 'Saving…' : "I'm heading out"}
        icon="walk"
        kind="accent"
        disabled={!scanned || !photo?.base64 || busy}
        onPress={async () => {
          setBusy(true);
          await attempt(() => actions.verifySeal(jobId, photo!.base64!));
          setBusy(false);
        }}
        style={{ marginTop: space.sm }}
      />
      <BarcodeScanner
        visible={scannerOpen}
        busy={false}
        onClose={() => setScannerOpen(false)}
        onPhotoInstead={checkWithPhoto}
        onScanned={(code) => {
          setScannerOpen(false);
          if (barcode && sameBarcode(code, barcode)) {
            tap('success');
            setScanned(true);
            setCheckedBy('barcode');
          } else {
            showError('That barcode doesn’t match the item they asked for.', 'Wrong item');
          }
        }}
      />
    </View>
  );
}

function ConditionCheck({ jobId }: { jobId: string }) {
  const { actions } = useStore();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ marginTop: space.xl, gap: space.md }}>
      <Txt variant="title">Snap its condition</Txt>
      <Txt tone="muted">A quick photo before you lend it protects you if it comes back damaged.</Txt>
      <PhotoStep label="Photo of the item" hint="Show any scratches or wear" photo={photo} onPhoto={setPhoto} />
      <Button
        label={busy ? 'Saving…' : "I'm heading out"}
        icon="walk"
        kind="accent"
        disabled={!photo?.base64 || busy}
        onPress={async () => {
          setBusy(true);
          await attempt(() => actions.verifySeal(jobId, photo!.base64!));
          setBusy(false);
        }}
        style={{ marginTop: space.sm }}
      />
    </View>
  );
}

function Handoff({ job }: { job: Job }) {
  const { colors } = useTheme();
  const { actions } = useStore();
  const [code, setCode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [idChecked, setIdChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const arrived = job.status === 'arrived';
  const alcohol = useItem(job.itemId)?.category === 'alcohol';
  const f = job.fulfillment;
  const option = FULFILLMENT[f];

  const title = arrived
    ? f === 'pickup'
      ? `Waiting for ${job.buyerName}`
      : `Hand it to ${job.buyerName}`
    : f === 'pickup'
      ? `${job.buyerName} is coming to you`
      : f === 'lobby'
        ? `Meet ${job.buyerName} in the lobby`
        : `Head to ${job.buyerName}`;
  const where =
    f === 'dropoff'
      ? job.buyerRoom
        ? `Room ${job.buyerRoom}`
        : 'Their door'
      : f === 'lobby'
        ? 'The lobby'
        : job.myRoom
          ? `Your room (${job.myRoom})`
          : 'Your room';
  const readyLabel = f === 'dropoff' ? "I'm at their door" : f === 'lobby' ? "I'm in the lobby" : "I'm ready, send them over";

  return (
    <View style={{ marginTop: space.xl, gap: space.md }}>
      <Txt variant="title">{title}</Txt>
      {job.buyerHereAt ? (
        <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accent }}>
          <Row gap={space.sm}>
            <Icon name="notifications" size={20} tone="accent" />
            <Txt variant="label" style={{ flex: 1 }}>
              {job.buyerName} {f === 'pickup' ? 'is at your door' : 'is waiting in the lobby'}
            </Txt>
          </Row>
        </Card>
      ) : null}
      <Card>
        <Row gap={6}>
          <Icon name={option.icon} size={16} tone="primary" />
          <Txt variant="label">
            {option.label} · {where}
          </Txt>
        </Row>
        {job.location ? (
          <Txt variant="caption" tone="muted" style={{ marginTop: 4 }}>
            Note from {job.buyerName}: “{job.location}”
          </Txt>
        ) : null}
        <Txt variant="caption" tone="muted" style={{ marginTop: 4 }}>
          {job.buyerName} will show a QR code. Scan it, then snap a quick photo of the handoff.
        </Txt>
      </Card>
      {!arrived ? (
        <Button
          label={busy ? 'Letting them know…' : readyLabel}
          icon={option.icon}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            await attempt(() => actions.markArrived(job.id));
            setBusy(false);
          }}
        />
      ) : null}
      <StepCard done={!!code} icon="qr-code-outline" label={`1. Scan ${job.buyerName}'s QR`} doneLabel={`Code ${code} ready`} onPress={() => setScannerOpen(true)} />
      <PhotoStep label="2. Quick photo of the handoff" hint="The item in their hands, or at the door" disabled={!code} photo={photo} onPhoto={setPhoto} />
      {alcohol ? (
        <StepCard
          done={idChecked}
          icon="id-card-outline"
          label="3. Check their ID: 21 or older?"
          doneLabel="ID checked: 21+"
          onPress={() => setIdChecked(!idChecked)}
        />
      ) : null}
      {alcohol ? (
        <Txt variant="caption" tone="muted">
          Look at a government photo ID. If they’re under 21, or it’s not their ID, don’t hand it over. Cancel and keep the item.
        </Txt>
      ) : null}
      <Button
        label={busy ? 'Confirming…' : 'Complete handoff'}
        kind="accent"
        icon="checkmark-circle"
        disabled={!code || !photo?.base64 || busy || (alcohol && !idChecked)}
        onPress={async () => {
          setBusy(true);
          const ok = await attempt(() => actions.confirmHandoff(job.id, code!, photo!.base64!, idChecked));
          setBusy(false);
          if (ok) tap('success');
          else setCode(null);
        }}
      />
      <BarcodeScanner
        mode="handoff"
        visible={scannerOpen}
        busy={false}
        onClose={() => setScannerOpen(false)}
        onScanned={(c) => {
          setScannerOpen(false);
          setCode(c);
        }}
      />
    </View>
  );
}

function ReturnScan({ job }: { job: Job }) {
  const { actions } = useStore();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <View style={{ marginTop: space.xl, gap: space.md }}>
      <Txt variant="title">{job.buyerName} is returning it</Txt>
      <Txt tone="muted">Check it’s in the same condition, then scan their return QR code.</Txt>
      <Button label={busy ? 'Confirming…' : 'Scan return QR'} icon="qr-code" kind="accent" disabled={busy} onPress={() => setScannerOpen(true)} />
      <BarcodeScanner
        mode="handoff"
        visible={scannerOpen}
        busy={busy}
        onClose={() => setScannerOpen(false)}
        onScanned={async (c) => {
          setBusy(true);
          await attempt(() => actions.confirmReturn(job.id, c));
          setBusy(false);
          setScannerOpen(false);
        }}
      />
    </View>
  );
}

/** The neighbor rates the buyer (can be changed). */
function RateBuyer({ job }: { job: Job }) {
  const { colors } = useTheme();
  const { actions } = useStore();
  const [stars, setStars] = useState(job.buyerRating ?? 0);
  return (
    <View style={{ alignItems: 'center', gap: space.sm }}>
      <Txt tone="muted">How was {job.buyerName}?</Txt>
      <Row gap={space.sm}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            hitSlop={6}
            onPress={async () => {
              tap();
              const before = stars;
              setStars(n);
              if (!(await attempt(() => actions.rateRequest(job.id, n)))) setStars(before);
            }}>
            <Icon name={n <= stars ? 'star' : 'star-outline'} size={32} color={n <= stars ? colors.warning : colors.textMuted} />
          </Pressable>
        ))}
      </Row>
      {stars ? (
        <Txt variant="caption" tone="muted">
          Thanks! Tap a star to change it.
        </Txt>
      ) : null}
    </View>
  );
}

function StepCard({ done, icon, label, doneLabel, onPress }: { done: boolean; icon: IconName; label: string; doneLabel: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Card highlight={done} style={done && { backgroundColor: colors.successSoft, borderColor: colors.success }} onPress={done ? undefined : onPress}>
      <Row>
        <Icon name={done ? 'checkmark-circle' : icon} size={26} tone={done ? 'success' : 'primary'} />
        <Txt style={{ flex: 1, fontFamily: fonts.displayMedium, fontSize: 16, color: done ? colors.success : colors.text }}>{done ? doneLabel : label}</Txt>
      </Row>
    </Card>
  );
}

/** A real camera step (library on Simulator/web). Shows a thumbnail once taken; tap to retake. */
function PhotoStep({ label, hint, photo, onPhoto, disabled }: { label: string; hint: string; photo: Photo | null; onPhoto: (p: Photo) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Card
      highlight={!!photo}
      style={[{ opacity: disabled ? 0.45 : 1 }, photo && { backgroundColor: colors.successSoft, borderColor: colors.success }]}
      onPress={
        disabled
          ? undefined
          : async () => {
              const p = await takePhoto({ base64: true });
              if (!p) return;
              tap('success');
              onPhoto(p);
            }
      }>
      <Row>
        {photo ? <Image source={{ uri: photo.uri }} style={{ width: 40, height: 40, borderRadius: 8 }} contentFit="cover" /> : <Icon name="camera-outline" size={26} tone="primary" />}
        <View style={{ flex: 1 }}>
          <Txt style={{ fontFamily: fonts.displayMedium, fontSize: 16, color: photo ? colors.success : colors.text }}>{photo ? 'Photo ready · tap to retake' : label}</Txt>
          {!photo ? (
            <Txt variant="caption" tone="muted">
              {hint}
            </Txt>
          ) : null}
        </View>
      </Row>
    </Card>
  );
}
