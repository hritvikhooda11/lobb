import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';

import { Button, Card, Pill, Row, Screen, Txt, tap } from '@/components/ui';
import { communities } from '@/data/catalog';
import { attempt } from '@/lib/alert';
import { useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

const isUwEmail = (e: string) => /^[^\s@]+@uw\.edu$/i.test(e.trim());

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
          <Txt style={{ fontSize: 64, lineHeight: 70 }}>🙌📦</Txt>
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
              style={inputStyle(isUwEmail(email))}
            />
            <Txt variant="caption" tone="muted">
              Only @uw.edu addresses, so everyone in your building is a verified student. We’ll email you a 6-digit code.
            </Txt>
            <Button
              label={busy ? 'Sending…' : 'Email me a code'}
              disabled={!isUwEmail(email) || busy}
              onPress={() => run(() => actions.sendCode(email)).then((ok) => ok && setCodeSent(true))}
              style={{ marginTop: space.sm }}
            />
          </View>
        ) : null}

        {step === 'code' ? (
          <View style={{ gap: space.md }}>
            <Txt variant="label">Enter the code we sent to {email.trim().toLowerCase()}</Txt>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
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
              icon="🙌"
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
