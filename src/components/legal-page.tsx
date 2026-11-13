import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Txt } from '@/components/ui';
import { space, useTheme } from '@/theme';

export type LegalSection = { heading: string; body: string[] };

/** The text of a legal page, so onboarding can show it with its own Accept button. */
export function LegalBody({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: LegalSection[] }) {
  return (
    <View style={{ gap: space.md }}>
      <Txt variant="title">{title}</Txt>
      <Txt variant="caption" tone="muted">
        Last updated {updated}
      </Txt>
      <Txt>{intro}</Txt>
      {sections.map((s) => (
        <View key={s.heading} style={{ gap: space.xs, marginTop: space.sm }}>
          <Txt variant="heading">{s.heading}</Txt>
          {s.body.map((p) => (
            <Txt key={p} tone="muted">
              {p}
            </Txt>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * A full legal page (privacy policy, terms), also served on the web for the App Store. The button at the
 * bottom closes it; pass `footer` to replace it (onboarding's "I agree").
 */
export function LegalPage({ footer, ...body }: Parameters<typeof LegalBody>[0] & { footer?: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xxl, maxWidth: 720, width: '100%', alignSelf: 'center', gap: space.xl }}>
      <LegalBody {...body} />
      {footer ?? <Button label="Done" kind="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}
    </ScrollView>
  );
}
