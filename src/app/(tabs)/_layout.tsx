import { Tabs } from 'expo-router/js-tabs';
import { Text } from 'react-native';

import { useStore } from '@/store/app-store';
import { useTheme } from '@/theme';

const icon = (emoji: string) =>
  function TabIcon({ focused }: { focused: boolean }) {
    return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>;
  };

export default function TabsLayout() {
  const { colors } = useTheme();
  const { state } = useStore();
  const live = state.requests.filter((r) => ['open', 'accepted', 'arriving'].includes(r.status)).length;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontWeight: '600' },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('🏠') }} />
      <Tabs.Screen
        name="activity"
        options={{ title: 'Activity', tabBarIcon: icon('⚡️'), tabBarBadge: live || undefined, tabBarBadgeStyle: { backgroundColor: colors.primary } }}
      />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', tabBarIcon: icon('💸') }} />
      <Tabs.Screen name="profile" options={{ title: 'You', tabBarIcon: icon('🙂') }} />
    </Tabs>
  );
}
