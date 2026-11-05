import { router } from 'expo-router';
import { Pressable } from 'react-native';

import { Icon, Txt, tap } from '@/components/ui';
import { chatHref, type Thread } from '@/lib/chat';
import { radius, useTheme } from '@/theme';

/** "Message <name>" pill that opens a chat thread. */
export function ChatButton({ thread, label }: { thread: Thread; label: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        tap();
        router.push(chatHref(thread));
      }}
      hitSlop={6}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 34,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        backgroundColor: colors.primary,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      })}>
      <Icon name="chatbubble-ellipses" size={16} tone="onPrimary" />
      <Txt variant="label" tone="onPrimary">
        {label}
      </Txt>
    </Pressable>
  );
}
