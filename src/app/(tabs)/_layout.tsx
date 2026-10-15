import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';

import type { IconName } from '@/components/ui';
import { LIVE_STATUSES, useStore } from '@/store/app-store';
import { useTheme } from '@/theme';

const icon = (active: IconName, inactive: IconName) =>
  function TabIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
    return <Ionicons name={focused ? active : inactive} size={24} color={color as string} />;
  };

export default function TabsLayout() {
  const { colors } = useTheme();
  const { state } = useStore();
  const live = state.requests.filter((r) => LIVE_STATUSES.includes(r.status)).length;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontWeight: '600', fontSize: 11 },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen
        name="activity"
        options={{ title: 'Activity', tabBarIcon: icon('receipt', 'receipt-outline'), tabBarBadge: live || undefined, tabBarBadgeStyle: { backgroundColor: colors.danger } }}
      />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', tabBarIcon: icon('wallet', 'wallet-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Account', tabBarIcon: icon('person-circle', 'person-circle-outline') }} />
    </Tabs>
  );
}
