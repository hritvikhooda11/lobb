import { Image } from 'expo-image';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { BarcodeResponse } from '@/app/api/barcode+api';
import type { IdentifyResponse } from '@/app/api/identify+api';
import type { PriceResponse } from '@/app/api/price+api';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { Button, Card, categoryIcon, Icon, ItemBadge, Pill, Row, Txt, tap } from '@/components/ui';
import { canRent, categories, findByBarcode, findDuplicate, getCategory, type CategoryId, type Item, type ItemKind } from '@/data/catalog';
import { bannedReason } from '@/data/rules';
import { checkPrice, MAX_ADJUST_PCT, money, PRICE_MAX_PCT, PRICE_WARN_PCT, rentPerDay, sellerEarnings } from '@/data/pricing';
import { attempt, confirm, showError } from '@/lib/alert';
import { takePhoto, type Photo } from '@/lib/photo';
import { supabase } from '@/lib/supabase';
import { useStore } from '@/store/app-store';
import { categoryTint, fonts, radius, space, useTheme } from '@/theme';

export default function ListItem() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { state, actions } = useStore();

  const [kind, setKind] = useState<ItemKind>('buy');
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [sealed, setSealed] = useState(false);
  const [pricing, setPricing] = useState<'idle' | 'loading'>('idle');
  const [quote, setQuote] = useState<PriceResponse | null>(null);
  /** The seller's own price in cents (null = use the Lobb price). */
  const [customPrice, setCustomPrice] = useState<number | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [scan, setScan] = useState<BarcodeResponse | null>(null);
  const [identifying, setIdentifying] = useState(false);
  /** What the AI thinks the photo shows, waiting for the seller to confirm. */
  const [candidate, setCandidate] = useState<(Extract<IdentifyResponse, { identified: true }> & { photo: Photo }) | null>(null);
  const nameInput = useRef<ComponentRef<typeof TextInput>>(null);
  const warning = category === 'alcohol' ? null : bannedReason([name]);

  const duplicate = useMemo(
    () => (scan && findByBarcode(state.items, scan.barcode, kind)) || (name.trim().length >= 3 ? findDuplicate(state.items, name, kind) : undefined),
    [state.items, name, kind, scan],
  );
  // Alcohol: only Lobb admins can sell it.
  const allowedCategories = categories.filter((c) => (kind === 'rent' ? canRent(c.id) : !c.ageRestricted || state.profile?.isAdmin));
  const needsSealCheck = kind === 'buy' && category !== null;
  const ready = name.trim().length >= 2 && photo && category && (!needsSealCheck || sealed);

  const resetQuote = () => {
    setQuote(null);
    setCustomPrice(null);
  };

  async function onScanned(code: string) {
    setLookingUp(true);
    try {
      const res = await fetch(`/api/barcode?code=${code}`);
      const result: BarcodeResponse = res.ok ? await res.json() : { found: false, barcode: code };
      // A miss shouldn't leave the previous scan's product filled in.
      if (!result.found && scan?.found) {
        setName('');
        setPhoto(null);
        setCategory(null);
      }
      setScan(result);
      resetQuote();
      if (result.found) {
        setName(result.name);
        if (result.imageUrl) setPhoto({ uri: result.imageUrl });
        if (result.category && (kind === 'buy' || canRent(result.category))) setCategory(result.category);
      }
    } catch {
      setScan({ found: false, barcode: code });
    } finally {
      setLookingUp(false);
      setScannerOpen(false);
    }
  }

  /** Barcode won't scan: snap the item and let the AI say what it is, then the seller confirms. */
  async function identifyFromPhoto() {
    if (scannerOpen) {
      setScannerOpen(false);
      // Let the scanner finish closing before the camera opens (iOS won't stack them).
      await new Promise((r) => setTimeout(r, 600));
    }
    const p = await takePhoto({ base64: true });
    if (!p?.base64) return;
    setIdentifying(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({ imageBase64: p.base64 }),
      });
      const body = (await res.json().catch(() => ({}))) as IdentifyResponse & { error?: string };
      if (!res.ok || !body.identified) {
        setPhoto(p);
        resetQuote();
        showError(body.error ?? (body.identified === false ? body.reason : 'Couldn’t identify it.'), 'Type it in instead');
        nameInput.current?.focus();
        return;
      }
      setCandidate({ ...body, photo: p });
    } catch {
      setPhoto(p);
      showError('Couldn’t reach Lobb to identify the photo. Type the name instead.');
    } finally {
      setIdentifying(false);
    }
  }

  function acceptCandidate() {
    if (!candidate) return;
    tap('success');
    setName([candidate.name, candidate.size].filter(Boolean).join(', '));
    setPhoto(candidate.photo);
    if (candidate.category && (kind === 'buy' || canRent(candidate.category))) setCategory(candidate.category);
    setScan(
      candidate.barcode
        ? { found: true, barcode: candidate.barcode, name: candidate.name, size: candidate.size, imageUrl: candidate.imageUrl, category: candidate.category, source: 'photo' }
        : null,
    );
    resetQuote();
    setCandidate(null);
  }

  function rejectCandidate() {
    if (!candidate) return;
    setPhoto(candidate.photo);
    setName('');
    setScan(null);
    resetQuote();
    setCandidate(null);
    setTimeout(() => nameInput.current?.focus(), 200);
  }

  async function getPrice() {
    if (!ready) return;
    setPricing('loading');
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch('/api/price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
        body: JSON.stringify({
          name: name.trim(),
          category,
          kind,
          barcode: scan?.barcode,
          imageBase64: photo?.base64 ?? undefined,
          imageUrl: !photo?.base64 && photo?.uri.startsWith('https://') ? photo.uri : undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setQuote(await res.json());
      tap('success');
    } catch {
      showError('Couldn’t reach the Lobb pricing service. Check your connection and try again.');
    } finally {
      setPricing('idle');
    }
  }

  async function listNew() {
    if (!quote || !photo || !category) return;
    const price = customPrice ?? quote.retailPriceCents;
    const check = checkPrice(price, quote.retailPriceCents);
    if (check.level === 'blocked') return;
    if (check.level === 'warn') {
      const above = check.pct > 0;
      const sure = await confirm(
        above ? `${check.pct}% above the store price` : `${-check.pct}% below the store price`,
        above
          ? `Stores sell this for about ${money(quote.retailPriceCents)}. Neighbors can see that, so they may skip yours at ${money(price)}.`
          : `Stores sell this for about ${money(quote.retailPriceCents)}. You’ll earn less than it’s worth at ${money(price)}.`,
        'List anyway',
      );
      if (!sure) return;
    }
    if (!quote.quoteId) {
      showError('The pricing service isn’t connected to the database yet (SUPABASE_SERVICE_ROLE_KEY missing), so new items can’t be saved.');
      return;
    }
    setPricing('loading');
    const ok = await attempt(() =>
      actions.createItem({ quoteId: quote.quoteId!, size: quote.size || (scan?.found ? scan.size : ''), barcode: scan?.barcode, photo, price: customPrice ?? undefined }),
    );
    setPricing('idle');
    if (!ok) return;
    tap('success');
    router.back();
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.xl, paddingBottom: insets.bottom + space.xxl, gap: space.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="title">List an item</Txt>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Txt variant="label" tone="muted">
            Cancel
          </Txt>
        </Pressable>
      </Row>

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
                resetQuote();
              }}
              style={{ flex: 1, height: 40, borderRadius: radius.pill, backgroundColor: active ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              <Row gap={6}>
                <Icon name={k === 'buy' ? 'cash' : 'repeat'} size={16} color={active ? colors.onAccent : colors.textMuted} />
                <Txt variant="label" style={{ color: active ? colors.onAccent : colors.textMuted }}>
                  {k === 'buy' ? 'Sell it' : 'Rent it out'}
                </Txt>
              </Row>
            </Pressable>
          );
        })}
      </Row>

      {kind === 'buy' ? (
        <Pressable
          onPress={() => {
            tap();
            setScannerOpen(true);
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.primary }}>
          <Icon name="barcode-outline" size={30} tone="onPrimary" />
          <View style={{ flex: 1 }}>
            <Txt variant="heading" tone="onPrimary">
              {scan ? 'Scan another barcode' : 'Scan the barcode'}
            </Txt>
            <Txt variant="caption" tone="onPrimary" style={{ opacity: 0.8 }}>
              Fills in the name and photo for you
            </Txt>
          </View>
          <Icon name="chevron-forward" size={22} tone="onPrimary" />
        </Pressable>
      ) : null}

      <Pressable
        onPress={identifyFromPhoto}
        disabled={identifying}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
        {identifying ? <ActivityIndicator color={colors.primary} /> : <Icon name="sparkles" size={22} tone="primary" />}
        <View style={{ flex: 1 }}>
          <Txt variant="label">{identifying ? 'Looking at your photo…' : 'No barcode? Identify it from a photo'}</Txt>
          <Txt variant="caption" tone="muted">
            Snap the front of the package. You confirm before anything is filled in.
          </Txt>
        </View>
      </Pressable>

      {candidate ? <CandidateCard candidate={candidate} onYes={acceptCandidate} onNo={rejectCandidate} /> : null}

      {scan ? (
        scan.found ? (
          <Row gap={space.sm}>
            <Pill icon="checkmark-circle" label={`Found via ${scan.source}`} tone="success" />
            <Txt variant="caption" tone="muted">
              {scan.barcode}
            </Txt>
          </Row>
        ) : (
          <Card style={{ borderColor: colors.warning, backgroundColor: colors.warningSoft, paddingVertical: space.md }}>
            <Txt variant="label" tone="warning">
              No match for {scan.barcode}
            </Txt>
            <Txt variant="caption" tone="muted">
              Identify it from a photo instead, or type the name and add a photo below. The barcode is saved with your listing.
            </Txt>
            <Button label="Identify from a photo" kind="ghost" icon="sparkles" onPress={identifyFromPhoto} style={{ marginTop: space.sm, height: 42 }} />
          </Card>
        )
      ) : null}

      <View style={{ gap: space.sm }}>
        <Txt variant="label">{kind === 'buy' && !scan ? 'Or type what it is' : 'What is it?'}</Txt>
        <TextInput
          ref={nameInput}
          value={name}
          onChangeText={(t) => {
            setName(t);
            resetQuote();
          }}
          placeholder={kind === 'buy' ? 'e.g. Coca-Cola can' : 'e.g. TI-84 calculator'}
          placeholderTextColor={colors.textMuted}
          style={{ height: 52, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.lg, color: colors.text, fontSize: 17 }}
        />
      </View>

      {warning ? (
        <Card style={{ borderColor: colors.danger, backgroundColor: colors.dangerSoft }}>
          <Txt variant="label" tone="danger">
            Not allowed on Lobb
          </Txt>
          <Txt variant="caption">{warning}</Txt>
        </Card>
      ) : null}

      {duplicate ? (
        <DuplicateCard item={duplicate} existingListing={state.listings.some((l) => l.itemId === duplicate.id)} />
      ) : (
        <>
          <View style={{ gap: space.sm }}>
            <Txt variant="label">Photo</Txt>
            <Pressable
              onPress={async () => {
                const p = await takePhoto({ base64: true });
                if (p) {
                  setPhoto(p);
                  resetQuote();
                }
              }}
              style={{ height: 180, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: photo ? 'solid' : 'dashed', borderColor: photo ? colors.border : colors.primary, backgroundColor: colors.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              {photo ? (
                <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <View style={{ alignItems: 'center', gap: 6 }}>
                  <Icon name="camera" size={36} tone="primary" />
                  <Txt variant="label" tone="primary">
                    Take a photo
                  </Txt>
                  <Txt variant="caption" tone="muted">
                    The real item, label facing the camera
                  </Txt>
                </View>
              )}
            </Pressable>
          </View>

          <View style={{ gap: space.sm }}>
            <Txt variant="label">Category</Txt>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {allowedCategories.map((c) => {
                const active = c.id === category;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      tap();
                      setCategory(c.id);
                      resetQuote();
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
                Only non-food items can be rented. No toiletries.
              </Txt>
            ) : null}
          </View>

          {needsSealCheck ? (
            <Pressable onPress={() => setSealed(!sealed)}>
              <Row>
                <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: sealed ? colors.success : colors.border, backgroundColor: sealed ? colors.success : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {sealed ? <Icon name="checkmark" size={16} color="#fff" /> : null}
                </View>
                <Txt style={{ flex: 1 }}>
                  It's factory-sealed{getCategory(category!).edible ? ' and doesn’t need a fridge' : ''}
                </Txt>
              </Row>
            </Pressable>
          ) : null}

          {!quote ? (
            <Button
              label={pricing === 'loading' ? 'Checking prices…' : 'Get Lobb price'}
              icon={pricing === 'loading' ? undefined : 'sparkles'}
              disabled={!ready || pricing === 'loading'}
              onPress={getPrice}
            />
          ) : null}
          {pricing === 'loading' ? <ActivityIndicator color={colors.primary} /> : null}

          {quote ? <QuoteCard quote={quote} kind={kind} category={category!} price={customPrice ?? quote.retailPriceCents} onPrice={setCustomPrice} onList={listNew} /> : null}
        </>
      )}

      <BarcodeScanner visible={scannerOpen} busy={lookingUp} onScanned={onScanned} onClose={() => setScannerOpen(false)} onPhotoInstead={identifyFromPhoto} />
    </ScrollView>
  );
}

/** "12 pack", "6-pk", "24 ct": stores often price the case, not one can. */
const MULTIPACK = /\b\d+\s?-?(pack|pk|ct|count)\b/i;

/** "Is this it?" for a photo the AI identified. */
function CandidateCard({ candidate, onYes, onNo }: { candidate: Extract<IdentifyResponse, { identified: true }> & { photo: Photo }; onYes: () => void; onNo: () => void }) {
  const { colors } = useTheme();
  return (
    <Card highlight style={{ gap: space.md, backgroundColor: colors.primarySoft }}>
      <Pill label="IS THIS IT?" tone="primary" icon="sparkles" />
      <Row>
        <Image source={{ uri: candidate.imageUrl ?? candidate.photo.uri }} style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: '#fff' }} contentFit="contain" />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="heading">{candidate.name}</Txt>
          {candidate.size ? (
            <Txt variant="caption" tone="muted">
              {candidate.size}
            </Txt>
          ) : null}
          <Txt variant="caption" tone={candidate.confidence === 'high' ? 'success' : 'warning'}>
            {candidate.confidence === 'high' ? 'Matched a real product' : candidate.confidence === 'medium' ? 'Pretty sure. Check the size and flavor.' : 'Not sure. Check carefully.'}
            {candidate.barcode ? ` · barcode ${candidate.barcode}` : ''}
          </Txt>
        </View>
      </Row>
      {candidate.notAllowed ? (
        <Txt variant="caption" tone="danger">
          {candidate.notAllowed}
        </Txt>
      ) : null}
      <Row gap={space.sm}>
        <Button label="No, I’ll type it" kind="ghost" onPress={onNo} style={{ flex: 1 }} />
        <Button label="Yes, that’s it" kind="accent" icon="checkmark" onPress={onYes} style={{ flex: 1 }} disabled={!!candidate.notAllowed} />
      </Row>
    </Card>
  );
}

function DuplicateCard({ item, existingListing }: { item: Item; existingListing: boolean }) {
  const { colors } = useTheme();
  const { actions } = useStore();
  const [adjust, setAdjust] = useState(0);
  const verb = item.kind === 'buy' ? 'selling' : 'renting it out';
  return (
    <Card highlight style={{ gap: space.md, backgroundColor: colors.primarySoft }}>
      <Pill label="ALREADY ON LOBB" tone="primary" />
      <Row>
        <ItemBadge item={item} size={64} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt variant="heading">{item.name}</Txt>
          <Txt variant="caption" tone="muted">
            {item.size}
          </Txt>
          <Txt variant="caption" tone="success">
            {item.nearbyCount} {item.nearbyCount === 1 ? 'neighbor is' : 'neighbors are'} {verb}
          </Txt>
        </View>
      </Row>
      <Txt variant="caption" tone="muted">
        This item already exists and is being {item.kind === 'buy' ? 'sold' : 'rented'} on Lobb, so it keeps its photo and price. You can add yours to it.
      </Txt>
      <AdjustRow item={item} adjust={adjust} onAdjust={setAdjust} />
      <Button
        label={existingListing ? 'Add one more of mine' : 'Add mine to this listing'}
        kind="accent"
        onPress={async () => {
          if (!(await attempt(() => actions.addListing(item.id, adjust)))) return;
          tap('success');
          router.back();
        }}
      />
    </Card>
  );
}

function QuoteCard({ quote, kind, category, price, onPrice, onList }: { quote: PriceResponse; kind: ItemKind; category: CategoryId; price: number; onPrice: (cents: number | null) => void; onList: () => void }) {
  const { colors } = useTheme();
  if (!quote.eligible) {
    return (
      <Card style={{ borderColor: colors.danger, backgroundColor: colors.dangerSoft, gap: space.sm }}>
        <Txt variant="heading" tone="danger">
          Can’t list this one
        </Txt>
        <Txt>{quote.reason}</Txt>
      </Card>
    );
  }
  const check = checkPrice(price, quote.retailPriceCents);
  const item: Item = { id: 'preview', kind, name: quote.name, size: quote.size, category, emoji: '📦', marketPrice: price, nearbyCount: 0 };
  const earn = kind === 'buy' ? `You earn ${money(sellerEarnings(item))} per sale` : `Renters pay ${money(rentPerDay(item))}/day`;
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="label" tone="muted">
          {kind === 'buy' ? 'Lobb price' : 'Retail value'}
        </Txt>
        <Pill
          label={quote.confidence === 'low' ? 'ROUGH ESTIMATE' : quote.confidence === 'high' ? 'HIGH CONFIDENCE' : 'CHECK IT'}
          tone={quote.confidence === 'high' ? 'success' : 'warning'}
          icon={quote.confidence === 'high' ? 'checkmark-circle' : 'alert-circle'}
        />
      </Row>
      {quote.matchedTitle ? (
        <Txt variant="caption" tone="muted">
          Matched: {quote.matchedTitle}
        </Txt>
      ) : null}
      {quote.matchedTitle && MULTIPACK.test(quote.matchedTitle) && !MULTIPACK.test(quote.name) ? (
        <Row gap={6} style={{ alignItems: 'flex-start' }}>
          <Icon name="warning" size={16} tone="warning" />
          <Txt variant="caption" tone="warning" style={{ flex: 1 }}>
            Stores list this as a multipack. If you’re selling one, set your price for a single one below.
          </Txt>
        </Row>
      ) : null}
      <Txt style={{ fontFamily: fonts.display, fontSize: 34, lineHeight: 40 }}>{money(quote.retailPriceCents)}</Txt>
      <SourceList quote={quote} />

      <View style={{ gap: space.sm }}>
        <Txt variant="label">{kind === 'buy' ? 'Your price' : 'Its value (sets the daily rate and deposit)'}</Txt>
        <PriceInput cents={price} onChange={(c) => onPrice(c === quote.retailPriceCents ? null : c)} invalid={check.level === 'blocked'} />
        {check.level === 'blocked' ? (
          <Txt variant="caption" tone="danger">
            That’s {Math.abs(check.pct)}% {check.pct > 0 ? 'above' : 'below'} the store price. Lobb only allows up to {PRICE_MAX_PCT}% either way ({money(Math.ceil(quote.retailPriceCents * 0.5))} to {money(Math.floor(quote.retailPriceCents * 1.5))}).
          </Txt>
        ) : check.level === 'warn' ? (
          <Row gap={6} style={{ alignItems: 'flex-start' }}>
            <Icon name="warning" size={16} tone="warning" />
            <Txt variant="caption" tone="warning" style={{ flex: 1 }}>
              {Math.abs(check.pct)}% {check.pct > 0 ? 'above' : 'below'} the store price. Buyers see the store price too, so prices more than {PRICE_WARN_PCT}% off usually don’t sell.
            </Txt>
          </Row>
        ) : (
          <Txt variant="caption" tone="muted">
            {price === quote.retailPriceCents ? 'Matches the store price. You can change it.' : `${check.pct > 0 ? '+' : ''}${check.pct}% from the store price.`}
          </Txt>
        )}
      </View>

      <Txt variant="caption" tone="success">
        {earn}
      </Txt>
      <Button label="List it" icon="rocket" kind="accent" onPress={onList} disabled={check.level === 'blocked'} />
    </Card>
  );
}

/** Every store the AI found the price at, with links. */
function SourceList({ quote }: { quote: PriceResponse }) {
  const { colors } = useTheme();
  if (quote.estimated || quote.sources.length === 0) {
    return (
      <Txt variant="caption" tone="muted">
        {quote.reason}
      </Txt>
    );
  }
  return (
    <View style={{ gap: 6 }}>
      <Txt variant="caption" tone="muted">
        Checked just now at:
      </Txt>
      {quote.sources.map((s) => (
        <Pressable
          key={s.store + s.priceCents}
          onPress={() => s.url && void WebBrowser.openBrowserAsync(s.url)}
          disabled={!s.url}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.surfaceHigh }}>
          <Row gap={6}>
            <Icon name="storefront-outline" size={16} tone="muted" />
            <Txt variant="label">{s.store}</Txt>
            {s.url ? <Icon name="open-outline" size={14} tone="primary" /> : null}
          </Row>
          <Txt variant="label">{money(s.priceCents)}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

/** Dollar input that keeps a cents value. */
function PriceInput({ cents, onChange, invalid }: { cents: number; onChange: (cents: number) => void; invalid?: boolean }) {
  const { colors } = useTheme();
  const [text, setText] = useState((cents / 100).toFixed(2));
  return (
    <Row
      gap={4}
      style={{ height: 56, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: invalid ? colors.danger : colors.border, paddingHorizontal: space.lg }}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 22, color: colors.textMuted }}>$</Txt>
      <TextInput
        value={text}
        onChangeText={(t) => {
          const clean = t.replace(/[^0-9.]/g, '');
          setText(clean);
          const value = Math.round(parseFloat(clean) * 100);
          if (Number.isFinite(value) && value > 0) onChange(value);
        }}
        onBlur={() => setText((cents / 100).toFixed(2))}
        keyboardType="decimal-pad"
        returnKeyType="done"
        selectTextOnFocus
        style={{ flex: 1, height: '100%', fontFamily: fonts.display, fontSize: 22, color: colors.text }}
      />
    </Row>
  );
}

/** ±5% price nudge with a live preview of what the seller earns. */
function AdjustRow({ item, adjust, onAdjust }: { item: Item; adjust: number; onAdjust: (n: number) => void }) {
  const { colors } = useTheme();
  const earn = item.kind === 'buy' ? money(sellerEarnings(item, adjust)) : `${money(rentPerDay(item, adjust))}/day`;
  const step = (d: number) => {
    const next = Math.max(-MAX_ADJUST_PCT, Math.min(MAX_ADJUST_PCT, adjust + d));
    if (next !== adjust) {
      tap();
      onAdjust(next);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <StepButton label="−" disabled={adjust <= -MAX_ADJUST_PCT} onPress={() => step(-1)} />
        <View style={{ alignItems: 'center' }}>
          <Txt style={{ fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.success }}>{earn}</Txt>
          <Txt variant="caption" tone="muted">
            you {item.kind === 'buy' ? 'earn' : 'charge'} · {adjust === 0 ? 'Lobb price' : `${adjust > 0 ? '+' : ''}${adjust}%`}
          </Txt>
        </View>
        <StepButton label="+" disabled={adjust >= MAX_ADJUST_PCT} onPress={() => step(1)} />
      </Row>
      <Txt variant="caption" tone="muted" center>
        You can adjust up to ±{MAX_ADJUST_PCT}% from the Lobb price.
      </Txt>
    </View>
  );
}

function StepButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.35 : 1 }}>
      <Txt style={{ fontFamily: fonts.display, fontSize: 24, lineHeight: 28 }}>{label}</Txt>
    </Pressable>
  );
}
