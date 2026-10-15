import { router } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { Button, Card, Row, Screen, Txt } from '@/components/ui';
import { radius, space, useTheme } from '@/theme';

const REASONS = ['Wrong item', 'Seal was broken', 'Never arrived', 'Buyer no-show', 'Safety concern', 'Something else'];

export default function Report() {
  const { colors } = useTheme();
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <Screen>
        <View style={{ alignItems: 'center', marginTop: space.xxxl, gap: space.lg }}>
          <Txt style={{ fontSize: 64, lineHeight: 78 }}>🛟</Txt>
          <Txt variant="title" center>
            We're on it
          </Txt>
          <Txt tone="muted" center>
            Our team reviews every report. If you're owed a refund it'll land in your wallet.
          </Txt>
          <Button label="Close" kind="ghost" onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Txt variant="title">Report a problem</Txt>
      <Txt tone="muted" style={{ marginTop: space.sm, marginBottom: space.lg }}>
        What went wrong?
      </Txt>
      <View style={{ gap: space.sm }}>
        {REASONS.map((r) => (
          <Card key={r} highlight={r === reason} onPress={() => setReason(r)} style={[{ paddingVertical: space.md }, r === reason && { backgroundColor: colors.primarySoft }]}>
            <Row>
              <Txt style={{ flex: 1 }}>{r}</Txt>
              <Txt tone="primary">{r === reason ? '●' : '○'}</Txt>
            </Row>
          </Card>
        ))}
      </View>
      <TextInput
        value={details}
        onChangeText={setDetails}
        placeholder="Tell us more (optional)"
        placeholderTextColor={colors.textMuted}
        multiline
        style={{ marginTop: space.lg, minHeight: 100, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: space.lg, color: colors.text, fontSize: 16, textAlignVertical: 'top' }}
      />
      <Button label="Submit report" disabled={!reason} onPress={() => setSent(true)} style={{ marginTop: space.lg }} />
      <Button label="Cancel" kind="ghost" onPress={() => router.back()} style={{ marginTop: space.sm }} />
    </Screen>
  );
}
