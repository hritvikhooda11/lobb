import { View } from 'react-native';

import { Card, Screen, Txt } from '@/components/ui';
import { space } from '@/theme';

/** Shown in development when the Supabase env vars are missing. */
export function SetupNeeded() {
  return (
    <Screen>
      <View style={{ marginTop: space.xxxl, gap: space.lg }}>
        <Txt variant="title">Connect the backend</Txt>
        <Txt tone="muted">Lobb needs a Supabase project. Add these to the `.env` file next to package.json, then restart `npx expo start`:</Txt>
        <Card style={{ gap: space.sm }}>
          <Txt variant="caption" style={{ fontFamily: 'monospace' }}>
            EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
          </Txt>
          <Txt variant="caption" style={{ fontFamily: 'monospace' }}>
            EXPO_PUBLIC_SUPABASE_KEY=sb_publishable_…
          </Txt>
        </Card>
        <Txt variant="caption" tone="muted">
          Full steps are in SUPABASE_SETUP.md.
        </Txt>
      </View>
    </Screen>
  );
}
