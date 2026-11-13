import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Button, Card, Row, Screen, Txt } from '@/components/ui';
import { attempt } from '@/lib/alert';
import { useStore } from '@/store/app-store';
import { space } from '@/theme';

/** People you've blocked, with Unblock. */
export default function Blocked() {
  const { actions } = useStore();
  const [people, setPeople] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    actions.blockedPeople().then(setPeople, () => setPeople([]));
  }, [actions]);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt variant="title">Blocked people</Txt>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))} hitSlop={12}>
          <Txt variant="label" tone="primary">
            Done
          </Txt>
        </Pressable>
      </Row>
      <Txt tone="muted" style={{ marginTop: space.sm, marginBottom: space.lg }}>
        You don’t see each other’s shout-outs or orders, and you can’t message each other. They aren’t told.
      </Txt>
      {people === null ? null : people.length === 0 ? (
        <Txt tone="muted">You haven’t blocked anyone.</Txt>
      ) : (
        <View style={{ gap: space.sm }}>
          {people.map((p) => (
            <Card key={p.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt variant="label">{p.name}</Txt>
                <Button
                  label="Unblock"
                  kind="ghost"
                  onPress={async () => {
                    if (await attempt(() => actions.unblock(p.id))) setPeople((list) => (list ?? []).filter((x) => x.id !== p.id));
                  }}
                  style={{ height: 38, paddingHorizontal: space.lg }}
                />
              </Row>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
