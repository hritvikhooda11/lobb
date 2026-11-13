import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';

import { Button, Card, Icon, Row, Screen, StateBadge, Txt } from '@/components/ui';
import { attempt } from '@/lib/alert';
import { useStore } from '@/store/app-store';
import { radius, space, useTheme } from '@/theme';

type TargetType = 'user' | 'item' | 'shoutout' | 'message' | 'request' | 'other';

const REASONS: Record<TargetType, string[]> = {
  user: ['Harassment or bullying', 'Hate or threats', 'Sexual or inappropriate', 'Scam or fraud', 'Spam', 'Something else'],
  message: ['Harassment or bullying', 'Hate or threats', 'Sexual or inappropriate', 'Scam or fraud', 'Spam', 'Something else'],
  shoutout: ['Not allowed on Lobb', 'Offensive', 'Spam or scam', 'Something else'],
  item: ['Not allowed on Lobb', 'Opened or unsafe', 'Wrong or misleading', 'Offensive photo', 'Something else'],
  request: ['Wrong item', 'Seal was broken', 'Never arrived', 'Buyer no-show', 'Safety concern', 'Something else'],
  other: ['Something isn’t working', 'Safety concern', 'Payment problem', 'Something else'],
};

/**
 * Report a person, chat, shout-out, listing or order. Saved for Lobb to review (within 24 hours);
 * you can also block the person right here. Params: type, id (what's reported), user + name (who).
 */
export default function Report() {
  const { colors } = useTheme();
  const { actions } = useStore();
  const params = useLocalSearchParams<{ type?: TargetType; id?: string; user?: string; name?: string }>();
  const type: TargetType = params.type && params.type in REASONS ? params.type : 'other';
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(type === 'user' || type === 'message');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (sent) {
    return (
      <Screen>
        <View style={{ alignItems: 'center', marginTop: space.xxxl, gap: space.lg }}>
          <StateBadge icon="shield-checkmark" />
          <Txt variant="title" center>
            Thanks, we’re on it
          </Txt>
          <Txt tone="muted" center>
            Lobb reviews every report within 24 hours and removes anything that breaks the rules.
            {params.user && alsoBlock ? ` You’ve blocked ${params.name ?? 'them'}.` : ''}
          </Txt>
          <Button label="Done" kind="ghost" onPress={close} style={{ alignSelf: 'stretch' }} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Txt variant="title">{params.name ? `Report ${params.name}` : 'Report a problem'}</Txt>
      <Txt tone="muted" style={{ marginTop: space.sm, marginBottom: space.lg }}>
        What’s wrong?
      </Txt>
      <View style={{ gap: space.sm }}>
        {REASONS[type].map((r) => (
          <Card key={r} highlight={r === reason} onPress={() => setReason(r)} style={[{ paddingVertical: space.md }, r === reason && { backgroundColor: colors.primarySoft }]}>
            <Row>
              <Txt style={{ flex: 1 }}>{r}</Txt>
              <Icon name={r === reason ? 'radio-button-on' : 'radio-button-off'} size={22} tone="primary" />
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
        maxLength={1000}
        style={{ marginTop: space.lg, minHeight: 100, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: space.lg, color: colors.text, fontSize: 16, textAlignVertical: 'top' }}
      />
      {params.user ? (
        <Pressable onPress={() => setAlsoBlock(!alsoBlock)}>
          <Row style={{ marginTop: space.lg, justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Txt variant="label">Block {params.name ?? 'this person'}</Txt>
              <Txt variant="caption" tone="muted">
                You won’t see each other’s shout-outs or orders, and they can’t message you.
              </Txt>
            </View>
            <Switch value={alsoBlock} onValueChange={setAlsoBlock} trackColor={{ true: colors.danger, false: colors.surfaceHigh }} thumbColor="#fff" />
          </Row>
        </Pressable>
      ) : null}
      <Button
        label={busy ? 'Sending…' : 'Send report'}
        kind="danger"
        disabled={!reason || busy}
        onPress={async () => {
          setBusy(true);
          const ok = await attempt(async () => {
            await actions.report({ targetType: type, targetId: params.id ?? params.user, reportedUserId: params.user, reason: reason!, details });
            if (params.user && alsoBlock) await actions.block(params.user);
          });
          setBusy(false);
          if (ok) setSent(true);
        }}
        style={{ marginTop: space.lg }}
      />
      <Button label="Cancel" kind="ghost" onPress={close} style={{ marginTop: space.sm }} />
    </Screen>
  );
}
