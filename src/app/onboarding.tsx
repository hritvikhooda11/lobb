import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';

import { Button, Card, Pill, Row, Screen, Txt, tap } from '@/components/ui';
import { communities } from '@/data/catalog';
import { useStore } from '@/store/app-store';
import { fonts, radius, space, useTheme } from '@/theme';

const isUwEmail = (e: string) => /^[^\s@]+@uw\.edu$/i.test(e.trim());

export default function Onboarding() {
  const { colors } = useTheme();
  const { actions } = useStore();
  const [step, setStep] = useState<'email' | 'community'>('email');
  const [email, setEmail] = useState('');
  const [communityId, setCommunityId] = useState<string | null>(null);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient colors={[colors.primarySoft, colors.bg]} style={{ position: 'absolute', inset: 0, height: 420 }} />
      <Screen>
        <View style={{ marginTop: space.xxxl, marginBottom: space.xxl }}>
          <Txt style={{ fontSize: 64, lineHeight: 70 }}>🚪✊</Txt>
          <Txt variant="hero" style={{ fontSize: 56, lineHeight: 58 }}>
            knock<Txt variant="hero" tone="accent" style={{ fontSize: 56, lineHeight: 58 }}>.</Txt>
          </Txt>
          <Txt variant="body" tone="muted" style={{ marginTop: space.sm, fontSize: 18, lineHeight: 25 }}>
            Snacks, drinks and chargers from the neighbor down the hall. At your door in under 10 minutes.
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
              style={{
                height: 56,
                borderRadius: radius.lg,
                borderWidth: 1.5,
                borderColor: isUwEmail(email) ? colors.primary : colors.border,
                backgroundColor: colors.surface,
                color: colors.text,
                paddingHorizontal: space.lg,
                fontSize: 17,
              }}
            />
            <Txt variant="caption" tone="muted">
              Only @uw.edu addresses, so everyone in your building is a verified student.
            </Txt>
            <Button label="Continue" disabled={!isUwEmail(email)} onPress={() => setStep('community')} style={{ marginTop: space.sm }} />
          </View>
        ) : (
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
                    <View style={{ gap: 4 }}>
                      <Txt style={{ fontFamily: fonts.displayMedium, fontSize: 17 }}>{c.name}</Txt>
                      <Txt variant="caption" tone="muted">
                        {c.members.toLocaleString()} neighbors on Knock
                      </Txt>
                    </View>
                    <Pill label={c.type} tone={selected ? 'primary' : 'default'} />
                  </Row>
                </Card>
              );
            })}
            <Button
              label="Let's go"
              icon="✊"
              disabled={!communityId}
              onPress={() => {
                tap('success');
                const name = email.split('@')[0];
                actions.signIn({ name: name.charAt(0).toUpperCase() + name.slice(1), email: email.trim().toLowerCase(), communityId: communityId! });
              }}
              style={{ marginTop: space.sm }}
            />
          </View>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
