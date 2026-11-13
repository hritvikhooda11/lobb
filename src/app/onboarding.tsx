import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';

import { Button, Card, Icon, Pill, Row, Screen, Txt, tap } from '@/components/ui';
import { LegalBody } from '@/components/legal-page';
import { communities } from '@/data/catalog';
import { TERMS } from '@/data/terms';
import { attempt } from '@/lib/alert';
import { useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

/** Only UW students: the database's allowed_email_domains is the real gate. */
const isUwEmail = (e: string) => /^[^\s@]+@(uw\.edu|getlobb\.com)$/i.test(e.trim());
/** Lobb's own addresses (the App Store review account) sign in with a password, not an emailed code. */
const isStaffEmail = (e: string) => /@getlobb\.com$/i.test(e.trim());

/** Email sign-in codes are 6–8 digits (Supabase Auth → Email OTP length). */
const CODE_MIN = 6;
const CODE_MAX = 8;
export default function Onboarding() {
  const { colors } = useTheme();
  const { state, actions } = useStore();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [communityId, setCommunityId] = useState<string | null>(state.profile?.communityId ?? null);
  const [room, setRoom] = useState(state.profile?.room ?? '');

  const hasHome = !!state.profile?.communityId && !!state.profile?.room;
  const step = state.userId ? (hasHome ? 'terms' : 'community') : codeSent ? 'code' : 'email';

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
                if (!isUwEmail(email) || isStaffEmail(email) || busy) return;
                run(() => actions.sendCode(email)).then((ok) => ok && setCodeSent(true));
              }}
              style={inputStyle(isUwEmail(email))}
            />
            {isStaffEmail(email) ? (
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password"
                returnKeyType="go"
                onSubmitEditing={() => password && !busy && run(() => actions.signInWithPassword(email, password))}
                style={inputStyle(password.length > 0)}
              />
            ) : null}
            <Txt variant="caption" tone="muted">
              Only @uw.edu addresses, so everyone in your building is a verified student. We’ll email you a sign-in code.
            </Txt>
            {isStaffEmail(email) ? (
              <Button
                label={busy ? 'Signing in…' : 'Sign in'}
                disabled={!password || busy}
                onPress={() => run(() => actions.signInWithPassword(email, password))}
                style={{ marginTop: space.sm }}
              />
            ) : (
              <Button
                label={busy ? 'Sending…' : 'Email me a code'}
                disabled={!isUwEmail(email) || busy}
                onPress={() => run(() => actions.sendCode(email)).then((ok) => ok && setCodeSent(true))}
                style={{ marginTop: space.sm }}
              />
            )}
          </View>
        ) : null}

        {step === 'code' ? (
          <View style={{ gap: space.md }}>
            <Txt variant="label">Enter the code we sent to {email.trim().toLowerCase()}</Txt>
            <TextInput
              value={code}
              onChangeText={(t) => {
                // Supabase sends 6–8 digits depending on the project's OTP length setting.
                const next = t.replace(/\D/g, '').slice(0, CODE_MAX);
                setCode(next);
                if (next.length === CODE_MAX) Keyboard.dismiss();
              }}
              placeholder="12345678"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              autoFocus
              style={[inputStyle(code.length >= CODE_MIN), { fontFamily: fonts.display, fontSize: 28, letterSpacing: 8, textAlign: 'center' }]}
            />
            <Button label={busy ? 'Checking…' : 'Sign in'} disabled={code.length < CODE_MIN || busy} onPress={() => run(() => actions.verifyCode(email, code))} />
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
              Requests only go to neighbors in your building.
            </Txt>
            {communities.filter((c) => !c.hidden || c.id === communityId).map((c) => {
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
            <View style={{ gap: space.sm, marginTop: space.sm }}>
              <Txt variant="label">Your room number</Txt>
              <TextInput
                value={room}
                onChangeText={(t) => setRoom(t.toUpperCase().slice(0, 12))}
                placeholder="e.g. 912 or 4B"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                style={inputStyle(room.trim().length > 0)}
              />
              <Row gap={6} style={{ alignItems: 'flex-start' }}>
                <Icon name="lock-closed" size={13} tone="muted" />
                <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
                  Private. Only the neighbor delivering to you sees it, and only after they accept. Used for door drop-offs.
                </Txt>
              </Row>
            </View>
            <Button
              label={busy ? 'Saving…' : "Let's go"}
              icon="arrow-forward"
              disabled={!communityId || !room.trim() || busy}
              onPress={() => {
                tap('success');
                Keyboard.dismiss();
                run(() => actions.setHome(communityId!, room.trim()));
              }}
              style={{ marginTop: space.sm }}
            />
          </View>
        ) : null}

        {step === 'terms' ? (
          <View style={{ gap: space.xl }}>
            <LegalBody {...TERMS} />
            <Pressable onPress={() => router.push('/privacy')} hitSlop={8}>
              <Txt variant="label" tone="primary">
                Read the Privacy Policy
              </Txt>
            </Pressable>
            <Button
              label={busy ? 'Saving…' : 'I’m 18 or older and I agree'}
              icon="checkmark"
              disabled={busy}
              onPress={() => {
                tap('success');
                run(() => actions.acceptTerms());
              }}
            />
          </View>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
