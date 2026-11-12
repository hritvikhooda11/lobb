import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { space, useTheme } from '@/theme';

export type LegalSection = { heading: string; body: string[] };

/** Plain text page for the privacy policy and terms (also served on the web for the App Store). */
export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: string; sections: LegalSection[] }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: space.xl, paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxxl, maxWidth: 720, width: '100%', alignSelf: 'center', gap: space.md }}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={12}>
        <Txt variant="label" tone="primary">
          ‹ Back
        </Txt>
      </Pressable>
      <Txt variant="title">{title}</Txt>
      <Txt variant="caption" tone="muted">
        Last updated {updated}
      </Txt>
      <Txt>{intro}</Txt>
      {sections.map((s) => (
        <View key={s.heading} style={{ gap: space.sm, marginTop: space.md }}>
          <Txt variant="heading">{s.heading}</Txt>
          {s.body.map((p) => (
            <Txt key={p} tone="muted">
              {p}
            </Txt>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
