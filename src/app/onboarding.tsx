import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';

import { Button, Card, Icon, Pill, Row, Screen, Txt, tap } from '@/components/ui';
import { communities } from '@/data/catalog';
import { attempt } from '@/lib/alert';
import { useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

// Release builds only accept @uw.edu. Dev builds accept any address so test domains
// can be allowed temporarily; the database's allowed_email_domains is the real gate.
/** Demo mode (dev builds + EXPO_PUBLIC_DEMO_LOGIN=1): the main button signs in instantly, no email. */
const DEMO_LOGIN = __DEV__ && process.env.EXPO_PUBLIC_DEMO_LOGIN === '1';

/** Dev/demo only: asks the server (LOBB_DEV_LOGIN=1) for a sign-in code instead of emailing it. */
async function devSignIn(email: string, verify: (email: string, code: string) => Promise<void>) {
  const res = await fetch('/api/dev-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const body = (await res.json().catch(() => ({}))) as { code?: string; error?: string };
  if (!res.ok || !body.code) throw new Error(res.status === 404 ? 'Dev sign-in is off. Set LOBB_DEV_LOGIN=1 in .env and restart.' : (body.error ?? 'Dev sign-in failed'));
  await verify(email, body.code);
}

const isUwEmail = (e: string) => (__DEV__ ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/ : /^[^\s@]+@uw\.edu$/i).test(e.trim());

export default function Onboarding() {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [communityId, setCommunityId] = useState<string | null>(null);

  const step = state.userId ? 'community' : codeSent ? 'code' : 'email';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    const ok = await attempt(fn);
    setBusy(false);
    return ok;
  };

  const inputStyle = (active: boolean) => ({
    height: 56,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: active ? colors.primary : colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: space.lg,
    fontSize: 17,
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={[colors.primarySoft, colors.bg]} style={{ position: 'absolute', inset: 0, height: 420 }} />
      <Screen>
        <View style={{ marginTop: space.xxxl, marginBottom: space.xxl }}>
          <LinearGradient colors={[colors.primary, '#2A1A55']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: space.md }}>
            <Icon name="bag-handle" size={32} color="#fff" />
            <View style={{ position: 'absolute', right: 10, bottom: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent }} />
          </LinearGradient>
          <Txt variant="hero" style={{ fontSize: 56, lineHeight: 58 }}>
            lobb<Txt variant="hero" tone="accent" style={{ fontSize: 56, lineHeight: 58 }}>.</Txt>
          </Txt>
          <Txt variant="body" tone="muted" style={{ marginTop: space.sm, fontSize: 18, lineHeight: 25 }}>
            Snacks, drinks and chargers from the neighbor down the hall, plus stuff you can borrow. At your door in under 10 minutes.
          </Txt>
        </View>

        {step === 'email' ? (
          <View style={{ gap: space.md }}>
            <Txt variant="label">Your UW email</Txt>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="husky@uw.edu"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="go"
              onSubmitEditing={() => {
                if (!isUwEmail(email) || busy) return;
                if (DEMO_LOGIN) run(() => devSignIn(email, actions.verifyCode));
                else run(() => actions.sendCode(email)).then((ok) => ok && setCodeSent(true));
              }}
              style={inputStyle(isUwEmail(email))}
            />
            <Txt variant="caption" tone="muted">
              Only @uw.edu addresses, so everyone in your building is a verified student.{DEMO_LOGIN ? '' : ' We’ll email you a 6-digit code.'}
            </Txt>
            <Button
              label={busy ? (DEMO_LOGIN ? 'Signing in…' : 'Sending…') : DEMO_LOGIN ? 'Continue' : 'Email me a code'}
              disabled={!isUwEmail(email) || busy}
              onPress={() =>
                DEMO_LOGIN ? run(() => devSignIn(email, actions.verifyCode)) : run(() => actions.sendCode(email)).then((ok) => ok && setCodeSent(true))
              }
              style={{ marginTop: space.sm }}
            />
            {__DEV__ && !DEMO_LOGIN ? (
              <Pressable
                disabled={!isUwEmail(email) || busy}
                onPress={() => run(() => devSignIn(email, actions.verifyCode))}
                hitSlop={8}
                style={{ alignSelf: 'center', opacity: isUwEmail(email) ? 1 : 0.4 }}>
                <Txt variant="caption" tone="primary">
                  Dev: sign in without email
                </Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {step === 'code' ? (
          <View style={{ gap: space.md }}>
            <Txt variant="label">Enter the code we sent to {email.trim().toLowerCase()}</Txt>
            <TextInput
              value={code}
              onChangeText={(t) => {
                const next = t.replace(/\D/g, '').slice(0, 6);
                setCode(next);
                if (next.length === 6) Keyboard.dismiss();
              }}
              placeholder="123456"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              autoFocus
              style={[inputStyle(code.length === 6), { fontFamily: fonts.display, fontSize: 28, letterSpacing: 8, textAlign: 'center' }]}
            />
            <Button label={busy ? 'Checking…' : 'Sign in'} disabled={code.length !== 6 || busy} onPress={() => run(() => actions.verifyCode(email, code))} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Pressable onPress={() => setCodeSent(false)} hitSlop={8}>
                <Txt variant="caption" tone="primary">
                  Use a different email
                </Txt>
              </Pressable>
              <Pressable onPress={() => run(() => actions.sendCode(email))} hitSlop={8}>
                <Txt variant="caption" tone="primary">
                  Resend code
                </Txt>
              </Pressable>
            </Row>
          </View>
        ) : null}

        {step === 'community' ? (
          <View style={{ gap: space.md }}>
            <Txt variant="heading">Where do you live?</Txt>
            <Txt variant="body" tone="muted">
              Requests only go to neighbors in your community.
            </Txt>
            {communities.map((c) => {
              const selected = c.id === communityId;
              return (
                <Card key={c.id} highlight={selected} onPress={() => setCommunityId(c.id)} style={selected && { backgroundColor: colors.primarySoft }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Txt style={{ fontFamily: fonts.displayMedium, fontSize: 17 }}>{c.name}</Txt>
                    <Pill label={c.type} tone={selected ? 'primary' : 'default'} />
                  </Row>
                </Card>
              );
            })}
            <Button
              label={busy ? 'Saving…' : "Let's go"}
              icon="arrow-forward"
              disabled={!communityId || busy}
              onPress={() => {
                tap('success');
                run(() => actions.setCommunity(communityId!));
              }}
              style={{ marginTop: space.sm }}
            />
          </View>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
